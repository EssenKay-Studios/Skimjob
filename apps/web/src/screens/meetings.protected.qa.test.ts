// QA (PR #226, the lost vote): the smallest crew, 3 seats, from real engine states. A round-1 raid's police briefing
// shakes p2 down, so the live picker in the next meeting must offer only the one other player (and Skip); with p3 protected
// too, the live picker is Skip alone. The sealed picker keeps protected players.
// design §9.2, §9.3, §9.5, §9.7
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BANK_JOB } from "@skimjob/content";
import { handleCommand, viewFor, type GameState, type PlayerCommand, type SystemCommand } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/deal.testkit";
import { MeetingNow, MeetingsPanel } from "./Meetings";

const NAMES = { p1: "Ana", p2: "Ben", p3: "Cy" } as const;
type Id = keyof typeof NAMES;
const IDS = Object.keys(NAMES) as Id[];

function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
const move = (player: Id, room: string): PlayerCommand => ({ type: "submitMove", player, move: { room, duffel: BANK_JOB.rooms[room]?.coins ?? 0, pocket: 0 } }) as PlayerCommand;
const shake = (player: Id, target: Id | null): PlayerCommand => ({ type: "castVote", player, vote: target ? { kind: "shakedown", target } : { kind: "skip" } });
/** Everyone grabs the whole `room`: three full grabs raid it, so a police briefing is due (design §9.2). */
const raid = (s: GameState, room: string, round: number) => run(s, ...IDS.map((p) => move(p, room)), { type: "advance", deadline: { kind: "round", round } });
const openMeeting = (s: GameState, meetingId: string) => run(s, { type: "scheduleMeeting", meetingId, slot: "now" }, { type: "advance", deadline: { kind: "openMeeting", meetingId } });
/** Closes the vote and, if a shakedown passed, opens the stash; back to the result window. */
function settle(s: GameState, meetingId: string): GameState {
  s = run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId } });
  return s.phase.kind === "shakedownPending" ? run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId } }) : s;
}

const send = async () => ({ ok: true as const });
const props = (s: GameState, me: Id) => ({ view: viewFor(s, me), timers: [], offset: 0, send });
/** Who each button in the picker group `label` names ("Your vote" live, "Sealed vote" in the meetings panel); "skip" for Skip. */
function picker(out: string, label: string): (Id | "skip")[] {
  const group = out.split(`aria-label="${label}"`)[1];
  if (group === undefined) throw new Error(`no "${label}" picker`);
  return [...group.split("</div>")[0]!.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => {
    const text = m[1]!.replace(/<[^>]+>/g, "");
    return text.trim() === "Skip" ? "skip" : IDS.find((p) => text.endsWith(NAMES[p]))!;
  });
}
const live = (s: GameState, me: Id) => renderToStaticMarkup(createElement(MeetingNow, props(s, me)));
const panel = (s: GameState, me: Id) => renderToStaticMarkup(createElement(MeetingsPanel, { ...props(s, me), autoMeetings: true }));

/** Round 1 raids the Vault; its briefing shakes p2 down (p1 and p3 vote p2, p2 skips): p2 is protected in the result window. */
function afterBriefing(): GameState {
  const players = IDS.map((id) => ({ id, name: NAMES[id], isBot: id !== "p1" }));
  let s = raid(createGame({ seed: "qa226-three", players, job: "bank", eventsEnabled: false, voteVisibility: "hiddenThenRevealed" }), "vault", 1);
  expect(s.phase).toMatchObject({ kind: "awaitingMeeting", meeting: "briefing", meetingId: "meeting-1" });
  s = settle(run(openMeeting(s, "meeting-1"), shake("p1", "p2"), shake("p3", "p2"), shake("p2", null)), "meeting-1");
  expect([s.phase.kind, s.protected]).toEqual(["result", ["p2"]]);
  return s;
}

/** p1 spends the crew's one emergency in round 1's result window; its vote opens. design §9.3 */
const emergency = () => run(afterBriefing(), { type: "callEmergency", player: "p1" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-1" } });

describe("QA #226: 3 seats, a briefing's shakedown protects a player (design §9.5, §9.7)", () => {
  it("the next live vote offers each voter only the one other unprotected player and Skip; the protected player still votes", () => {
    const s = emergency();
    expect(s.phase.kind).toBe("meeting");
    expect(picker(live(s, "p1"), "Your vote")).toEqual(["p3", "skip"]);
    expect(picker(live(s, "p3"), "Your vote")).toEqual(["p1", "skip"]);
    expect(picker(live(s, "p2"), "Your vote")).toEqual(["p1", "p3", "skip"]);
    for (const me of ["p1", "p3"] as const) expect(live(s, me)).toMatch(/so not on the list: Ben\./);
    // Every button the picker offers is a vote the engine takes (the lost vote: a protected target was refused).
    for (const me of IDS) for (const b of picker(live(s, me), "Your vote")) expect(handleCommand(s, shake(me, b === "skip" ? null : b)).ok, `${me} → ${b}`).toBe(true);
  });

  it("the sealed picker still lists the protected player (it counts as a skip if they are still protected, §9.5)", () => {
    const s = afterBriefing();
    expect(picker(panel(s, "p1"), "Sealed vote")).toEqual(["p2", "p3", "skip"]);
    expect(handleCommand(s, { type: "sealVote", player: "p1", vote: { kind: "shakedown", target: "p2" } } as PlayerCommand).ok).toBe(true);
  });

  it("both other players protected: the live picker is Skip alone, and Skip is taken", () => {
    // Set directly: the protection a second passed shakedown (before any regular meeting) would leave on p3 too.
    const s = { ...emergency(), protected: ["p2", "p3"] };
    expect(picker(live(s, "p1"), "Your vote")).toEqual(["skip"]);
    expect(live(s, "p1")).toMatch(/so not on the list: Ben, Cy\./);
    expect(handleCommand(s, shake("p1", null)).ok).toBe(true);
    expect(picker(live(s, "p2"), "Your vote")).toEqual(["p1", "skip"]);
  });
});
