// QA round 2 for S3a.6 (PR #173): the owner's 8 Nov ruling that an
// Electrician cut on Security takes Security's own cameras offline (and leaks
// nothing through viewFor), and the Smooth Talker's double-weight sealed skip
// that the meeting.qa e2e spec branches on. design §9.5, §11.1, §18
import { describe, expect, it } from "vitest";
import type { GameEvent, GameState, VoteVisibility } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand, type CommandResult } from "./handle";
import { viewFor } from "./view";
import { closeAlibiWindow, closeResultWindow } from "./result.testkit";
import { fullGrab } from "./grab.testkit";
import { giveTail } from "./perks.testkit";

function game(players: number, roles: string[], voteVisibility: VoteVisibility = "hiddenThenRevealed"): GameState {
  const cfg = {
    seed: "qa173-r2",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility,
  };
  let seat = 0;
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "lookout" } : e)));
}
const must = (r: CommandResult): GameState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};
type Cmd = unknown | ((s: GameState) => unknown);
const planningOpen = (s: GameState): GameState => (s.phase.kind === "result" && !s.pendingEmergency ? must(closeResultWindow(s)) : s);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const cmd = typeof c === "function" ? c(s) : c;
    const planning = (cmd as { type?: string }).type === "submitMove" || (cmd as { type?: string }).type === "useAbility";
    const r = handleCommand(planning ? planningOpen(s) : s, cmd);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(cmd)}: ${r.reason}`);
    // design §10: a round's alibi window closes at once, nobody posting.
    return must(closeAlibiWindow(r.state));
  }, state);
}
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) => events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const mv = (player: string, room: string, extra: object = {}) => ({ type: "submitMove", player, move: { ...fullGrab(room, 0), ...extra } });
const watch = (player: string, room: string, extra: object = {}) => mv(player, "security", { watch: room, ...extra });
const cut = (player: string, room: string) => mv(player, "lobby", { ability: { kind: "blackout", room } });
const json = (s: GameState, id: string) => JSON.stringify(viewFor(s, id));
/**
 * Resolve the round being planned with everyone posting the same alibi `room`, so the closed
 * window shows nobody's real room (design §10) and only what the test is about can differ.
 */
const resolveAlibied = (s: GameState, room: string): GameState => {
  let x = must(handleCommand(s, ROUND(s)));
  for (const player of x.playerOrder) x = must(handleCommand(x, { type: "postAlibi", player, round: s.round, room }));
  return must(closeAlibiWindow(x));
};


/** Round 1 with the given cuts (other seats in the Lobby), on to round 2's planning with those rooms dark. */
function darkRound2(players: number, roles: string[], cuts: [string, string][]): GameState {
  const cutters = cuts.map(([p]) => p);
  const rest = Array.from({ length: players }, (_, i) => `p${i}`).filter((id) => !cutters.includes(id));
  const s = planningOpen(run(game(players, roles), ...cuts.map(([p, r]) => cut(p, r)), ...rest.map((id) => mv(id, "lobby")), ROUND));
  expect(s.phase.kind).toBe("planning");
  expect([...s.dark].sort()).toEqual(cuts.map(([, r]) => r).sort());
  return s;
}

describe("QA an Electrician cut on Security takes Security's own cameras offline — design §11.1 (owner, 8 Nov)", () => {
  it("a watcher in a dark Security sees nothing of any room, dark or lit, and the feed reads offline", () => {
    // p0 and p1 Electricians: Security and the Vault go dark in round 2.
    const s = darkRound2(6, ["electrician", "electrician"], [["p0", "security"], ["p1", "vault"]]);
    for (const target of ["office", "vault", "lobby", "rooftop"]) {
      const r2 = run(s, mv("p0", "lobby"), mv("p1", "lobby"), watch("p2", target), mv("p3", "office"), mv("p4", "vault"), mv("p5", "rooftop"), ROUND);
      expect(ofType(since(s, r2), "roomWatched")).toEqual([
        { type: "roomWatched", visibility: { kind: "private", player: "p2" }, player: "p2", round: 2, source: "security", room: target, seen: [], offline: true },
      ]);
    }
  });

  it("a lit Security still watches a lit room normally, and feeds into another dark room read offline", () => {
    const s = darkRound2(5, ["electrician"], [["p0", "vault"]]);
    const lit = run(s, mv("p0", "lobby"), watch("p1", "office"), mv("p2", "office"), mv("p3", "office"), mv("p4", "vault"), ROUND);
    expect(ofType(since(s, lit), "roomWatched").map((e) => [e.room, e.seen, e.offline])).toEqual([["office", ["p2", "p3"], false]]);
    const dark = run(s, mv("p0", "lobby"), watch("p1", "vault"), mv("p2", "vault"), mv("p3", "office"), mv("p4", "vault"), ROUND);
    expect(ofType(since(s, dark), "roomWatched").map((e) => [e.room, e.seen, e.offline])).toEqual([["vault", [], true]]);
  });

  it("room-mates in a dark Security see nobody; the lit rooms they watch still see each other", () => {
    const s = darkRound2(5, ["electrician"], [["p0", "security"]]);
    const r2 = run(s, mv("p0", "lobby"), watch("p1", "office"), watch("p2", "vault"), mv("p3", "office"), mv("p4", "office"), ROUND);
    const events = since(s, r2);
    expect(ofType(events, "roomSighting").filter((e) => e.room === "security").map((e) => [e.player, e.others])).toEqual([
      ["p1", []],
      ["p2", []],
    ]);
    expect(ofType(events, "roomWatched").map((e) => [e.player, e.seen, e.offline])).toEqual([
      ["p1", [], true],
      ["p2", [], true],
    ]);
    expect(ofType(events, "roomSighting").filter((e) => e.room === "office").map((e) => e.others)).toEqual([["p4"], ["p3"]]);
  });

  it("only Security's cameras go dark: a Lookout's and a Tail's feeds into lit rooms still work, and into dark Security read offline", () => {
    let s = darkRound2(5, ["electrician", "lookout"], [["p0", "security"]]);
    s = giveTail(s, "p2", "security");
    const r2 = run(s, mv("p0", "lobby"), mv("p1", "lobby", { ability: { kind: "lookout", rooms: ["office"] } }), mv("p2", "lobby"), mv("p3", "office"), watch("p4", "office"), ROUND);
    const feeds = ofType(since(s, r2), "roomWatched").map((e) => [e.player, e.source, e.room, e.seen, e.offline]);
    expect(feeds).toContainEqual(["p1", "lookout", "office", ["p3"], false]);
    expect(feeds).toContainEqual(["p2", "tail", "security", [], true]);
    expect(feeds).toContainEqual(["p4", "security", "office", [], true]);
  });

  it("the cut lasts one round: the round after, the same Security watch sees the room again", () => {
    const s = darkRound2(4, ["electrician"], [["p0", "security"]]);
    const r2 = run(s, mv("p0", "lobby"), watch("p1", "office"), mv("p2", "office"), mv("p3", "lobby"), ROUND);
    const r3start = planningOpen(r2);
    expect(r3start.dark).toEqual([]);
    const r3 = run(r3start, mv("p0", "lobby"), watch("p1", "office"), mv("p2", "office"), mv("p3", "lobby"), ROUND);
    expect(ofType(since(r3start, r3), "roomWatched").map((e) => [e.seen, e.offline])).toEqual([[["p2"], false]]);
  });

  it("viewFor: the dark-Security watcher's view is the same whoever is in the room they watch, in the result window", () => {
    const s = darkRound2(5, ["electrician"], [["p0", "security"]]);
    const a = resolveAlibied(run(s, mv("p0", "lobby"), watch("p1", "office"), mv("p2", "office"), mv("p3", "office"), mv("p4", "lobby")), "lobby");
    // Same public facts (two in the Office, the same alibis), different people.
    const b = resolveAlibied(run(s, mv("p0", "lobby"), watch("p1", "office"), mv("p2", "lobby"), mv("p3", "office"), mv("p4", "office")), "lobby");
    expect(json(a, "p1")).toBe(json(b, "p1"));
    // Sanity: with the lights on, the same watch tells the games apart.
    const lit = darkRound2(5, ["electrician"], [["p0", "vault"]]);
    const la = resolveAlibied(run(lit, mv("p0", "lobby"), watch("p1", "office"), mv("p2", "office"), mv("p3", "office"), mv("p4", "lobby")), "lobby");
    const lb = resolveAlibied(run(lit, mv("p0", "lobby"), watch("p1", "office"), mv("p2", "lobby"), mv("p3", "office"), mv("p4", "office")), "lobby");
    expect(json(la, "p1")).not.toBe(json(lb, "p1"));
  });

  it("viewFor: which room a dark-Security watcher picked never reaches anyone else; the cut names no Electrician", () => {
    const s = darkRound2(5, ["electrician"], [["p0", "security"]]);
    const a = run(s, mv("p0", "lobby"), watch("p1", "office"), mv("p2", "office"), mv("p3", "vault"), mv("p4", "lobby"), ROUND);
    const b = run(s, mv("p0", "lobby"), watch("p1", "vault"), mv("p2", "office"), mv("p3", "vault"), mv("p4", "lobby"), ROUND);
    for (const id of ["p0", "p2", "p3", "p4"]) {
      expect(json(a, id)).toBe(json(b, id));
    }
    const shown = viewFor(s, "p3").ledger.filter((e) => e.event.type === "powerCut").map((e) => e.event);
    expect(shown).toEqual([{ type: "powerCut", visibility: { kind: "public" }, round: 2, room: "security" }]);
    expect(JSON.stringify(shown)).not.toContain("p0");
  });

  it("determinism: the same commands give the same log, and replay rebuilds the state", () => {
    const play = () => {
      const s = darkRound2(6, ["electrician", "electrician"], [["p0", "security"], ["p1", "office"]]);
      return run(s, mv("p0", "lobby"), mv("p1", "lobby"), watch("p2", "office"), watch("p3", "vault"), mv("p4", "office"), mv("p5", "vault"), ROUND);
    };
    const a = play();
    expect(JSON.stringify(play().log)).toBe(JSON.stringify(a.log));
    expect(replay(a.config, a.log)).toEqual(a);
  });
});

describe("QA the meeting.qa spec's Smooth Talker branch at the engine level — design §9.5, §11.1", () => {
  // The e2e: 3 seats, p2 (Guest 2) seals a skip and stays away; p1 (Guest 1) calls an emergency after
  // round 1; p0 (host) votes p2; p1 votes skip, then changes to p2. Ballots: p2 ×2, skip ×1.
  const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
  const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
  function play(roles: string[], mode: VoteVisibility): GameState {
    let s = run(game(3, roles, mode), mv("p0", "office"), mv("p1", "lobby"), mv("p2", "lobby"));
    s = run(s, { type: "sealVote", player: "p2", vote: { kind: "skip" } }, ROUND);
    expect(s.phase.kind).toBe("result");
    s = run(s, { type: "callEmergency", player: "p1" }, (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.pendingEmergency?.meetingId } }));
    s = run(s, vote("p0", "p2"), vote("p1", null), vote("p1", "p2"), CLOSE);
    // With Bail on the black market, a passed shakedown waits for its Bail choice window (design §9.6); nobody holds one.
    return s.phase.kind === "shakedownPending" ? run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.phase.meetingId } }) : s;
  }
  const closed = (s: GameState) => ofType(s.log, "meetingClosed").at(-1);
  const MODES = ["hiddenThenRevealed", "open", "secret"] as const;

  it.each(MODES)("%s: Guest 2 as the Smooth Talker: the sealed skip weighs 2 against 2, so no majority; the tally shows one per ballot", (mode) => {
    const s = play(["lookout", "auditor", "smoothTalker"], mode);
    const c = closed(s);
    expect(c?.result).toEqual({ kind: "noMajority" });
    expect(c?.tally).toEqual({ skip: 1, targets: { p2: 2 } });
    expect(c?.ballots).toEqual(mode === "secret" ? null : { p0: { kind: "shakedown", target: "p2" }, p1: { kind: "shakedown", target: "p2" }, p2: { kind: "skip" } });
    expect(ofType(s.log, "voteCast").find((e) => e.player === "p2")).toMatchObject({ sealed: true, vote: { kind: "skip" } });
    expect(ofType(s.log, "shakedownResolved")).toEqual([]);
    // Nothing in the public views marks who the Smooth Talker is.
    expect(JSON.stringify(viewFor(s, "p0").ledger.map((e) => e.event))).not.toContain("smoothTalker");
  });

  it.each(MODES)("%s: with the Smooth Talker on the host's or Guest 1's seat, or none, the shakedown of Guest 2 passes and finds them clean", (mode) => {
    for (const roles of [["smoothTalker", "lookout", "auditor"], ["lookout", "smoothTalker", "auditor"], ["lookout", "auditor", "priest"]]) {
      const s = play(roles, mode);
      expect(closed(s)?.result).toEqual({ kind: "shakedown", target: "p2" });
      expect(closed(s)?.tally).toEqual({ skip: 1, targets: { p2: 2 } });
      const res = ofType(s.log, "shakedownResolved").at(-1);
      expect(res).toMatchObject({ target: "p2", taken: 0, clean: true });
    }
  });

  it("a changed vote leaves no weight behind: the Smooth Talker's skip switched to a target counts 2 for it, 0 for skip", () => {
    // 3 seats, p1 Smooth Talker votes skip then p2; p0 skips; p2 sealed skip: p2 gets 2 of 4 → no majority, skip 2 of 4 → no majority.
    let s = run(game(3, ["lookout", "smoothTalker", "auditor"]), mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "lobby"));
    s = run(s, { type: "sealVote", player: "p2", vote: { kind: "skip" } }, ROUND);
    s = run(s, { type: "callEmergency", player: "p0" }, (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.pendingEmergency?.meetingId } }));
    s = run(s, vote("p1", null), vote("p0", null), vote("p1", "p2"), CLOSE);
    expect(closed(s)).toMatchObject({ tally: { skip: 2, targets: { p2: 1 } }, result: { kind: "noMajority" } });
  });

  it("the Smooth Talker's live vote overrides their sealed skip; the double weight follows the live vote", () => {
    let s = run(game(3, ["lookout", "auditor", "smoothTalker"]), mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "lobby"));
    s = run(s, { type: "sealVote", player: "p2", vote: { kind: "skip" } }, ROUND);
    s = run(s, { type: "callEmergency", player: "p1" }, (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.pendingEmergency?.meetingId } }));
    // p2 now votes p1 live (2), p0 votes p1 (1): 3 of 4 passes.
    s = run(s, vote("p2", "p1"), vote("p0", "p1"), vote("p1", null), CLOSE);
    expect(closed(s)).toMatchObject({ tally: { skip: 1, targets: { p1: 2 } }, result: { kind: "shakedown", target: "p1" } });
  });
});
