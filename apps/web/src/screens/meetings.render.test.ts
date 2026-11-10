// Render checks for the meeting screens: the briefing, the shakedown result (board 5b)
// and the Bail prompt, from real engine views. design §9.1–§9.7, §17.4
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyEvent, handleCommand, privateTo, viewFor, type GameState, type PlayerCommand, type PlayerView, type SystemCommand } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/deal.testkit";
import type { PinsChannel } from "../game/notes";
import { DecidingPanel, MeetingNow, ResultDialog, resultCardOf } from "./Meetings";

const config = {
  seed: "meeting-render",
  players: ["Ana", "Ben", "Cy", "Dee", "Eve"].map((name, i) => ({ id: `p${i + 1}`, name, isBot: false })),
  job: "bank" as const,
  eventsEnabled: false,
  voteVisibility: "open" as const,
};
const NO_BAIL = ["tail", "softShoes", "plantEvidence"] as const;

function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
const shake = (player: string, target: string): PlayerCommand => ({ type: "castVote", player, vote: { kind: "shakedown", target } });
/** p3 calls an emergency in round 1's result window; p1, p3 and p4 vote for p2 and p5 skips. */
const meeting = (shop: readonly string[], bail = false): GameState => {
  let s: GameState = { ...createGame(config), shop: shop as GameState["shop"] };
  if (bail) s = applyEvent(s, { type: "perkBought", visibility: privateTo("p2"), player: "p2", round: 1, perk: { kind: "bail" }, cost: 0 });
  return run(s, { type: "advance", deadline: { kind: "round", round: 1 } }, { type: "callEmergency", player: "p3" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-1" } });
};
const voted = (s: GameState) => run(s, shake("p1", "p2"), shake("p3", "p2"), shake("p4", "p2"), { type: "castVote", player: "p5", vote: { kind: "skip" } });
const closed = (s: GameState) => run(voted(s), { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-1" } });

const send = async () => ({ ok: true as const });
const pins: PinsChannel = { pins: new Set(), ready: true, error: null, toggle: () => {} };
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const nowOf = (v: PlayerView) => html(createElement(MeetingNow, { view: v, timers: [], offset: 0, send }));
const resultOf = (v: PlayerView) => html(createElement(ResultDialog, { view: v, pins, dismissed: null, onDismiss: () => {} }));
const decidingOf = (v: PlayerView) => html(createElement(DecidingPanel, { view: v, timers: [], offset: 0, send }));

describe("the meeting briefing (design §9.1–§9.3, §9.7)", () => {
  it("says why the meeting is on, the pool left, and leaves protected players out of the picker", () => {
    const open = nowOf(viewFor(meeting(NO_BAIL), "p1"));
    expect(open).toContain("Called from the crew&#x27;s emergency pool. Nothing recharges.");
    expect(open).toContain("Emergency pool:");
    expect(open).not.toContain("until the next regular meeting, so not on the list");
    // After p2's shakedown, a later vote lists them as protected and has no button for them.
    const s = closed(meeting(NO_BAIL));
    const v = viewFor(s, "p1");
    expect(v.protected).toEqual(["p2"]);
  });
});

describe("the shakedown result (board 5b, design §9.6, §9.7)", () => {
  it("a clean shakedown: tally, stash and share rows, no set-aside row, and the protection banner", () => {
    const out = resultOf(viewFor(closed(meeting(NO_BAIL)), "p1"));
    expect(out).toContain("Ben shaken down");
    expect(out).toContain("Emergency meeting after R1");
    expect(out).toContain("Ben&#x27;s stash");
    expect(out).toContain("Share");
    expect(out).toContain("Clean: nothing above the share.");
    expect(out).not.toContain("Into the next split");
    expect(out).not.toContain("set aside");
    expect(out).toContain("Protected");
    expect(out).toContain("until the next regular meeting");
    expect(out).toContain("Back to the bank");
    expect(out).toContain("Pin");
  });

  it("a shakedown that took coins shows them going into the next split", () => {
    const v = viewFor(closed(meeting(NO_BAIL)), "p1");
    const dirty: PlayerView = { ...v, ledger: v.ledger.map((e) => (e.event.type === "shakedownResolved" ? { ...e, event: { ...e.event, clean: false, taken: 3, stashRevealed: v.share + 3 } } : e)) };
    const out = resultOf(dirty);
    expect(out).toContain("Into the next split");
    expect(out).toContain("+3");
    expect(out).not.toContain("Clean: nothing above the share.");
  });

  it("the target reads it as theirs", () => {
    const out = resultOf(viewFor(closed(meeting(NO_BAIL)), "p2"));
    expect(out).toContain("You were shaken down");
    expect(out).toContain("Your stash");
  });

  it("a Bail used: the shakedown fell through, no stash opens, and they are still protected", () => {
    let s = run(voted(meeting(["bail", "tail", "softShoes"], true)), { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-1" } });
    s = run(s, { type: "chooseBail", player: "p2", use: true }, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "emergency-1" } });
    const out = resultOf(viewFor(s, "p1"));
    expect(out).toContain("A shakedown fell through");
    expect(out).toContain("Nobody&#x27;s stash was opened.");
    expect(out).not.toContain("stash</dt>");
    expect(out).toContain("until the next regular meeting");
  });

  it("a skip or a tie shows the tally and no stash or protection", () => {
    const s = run(meeting(NO_BAIL), shake("p1", "p2"), { type: "castVote", player: "p3", vote: { kind: "skip" } }, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-1" } });
    const out = resultOf(viewFor(s, "p1"));
    expect(out).toMatch(/Too few votes|No majority/);
    expect(out).not.toContain("Protected");
    expect(out).not.toContain("stash");
  });
});

describe("the result card's visibility (design §9.6, §20.6)", () => {
  it("shows for a fresh closed meeting until its id is dismissed, so the teaching pop-ups can step aside for it", () => {
    const v = viewFor(closed(meeting(NO_BAIL)), "p1");
    expect(resultCardOf(v, null)?.meetingId).toBe("emergency-1");
    expect(resultCardOf(v, "emergency-1")).toBeNull();
    expect(resultCardOf(viewFor(meeting(NO_BAIL), "p1"), null)).toBeNull(); // the vote window is not a result
  });
});

describe("the Bail prompt (design §9.6, §17.4)", () => {
  const pending = () => run(voted(meeting(["bail", "tail", "softShoes"], true)), { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-1" } });

  it("only the target holding a Bail sees it; no answer means don't use", () => {
    const s = pending();
    const mine = decidingOf(viewFor(s, "p2"));
    expect(mine).toContain("Use your Bail?");
    expect(mine).toContain("No answer means don&#x27;t use it.");
    expect(mine).toContain("No answer yet: it counts as keeping it.");
    for (const me of ["p1", "p3", "p4", "p5"]) {
      const other = decidingOf(viewFor(s, me));
      expect(other).toContain("The vote went against");
      expect(other).not.toContain("Bail");
    }
  });

  it("a target without a Bail sees the same window as everyone", () => {
    const s = run(voted(meeting(["bail", "tail", "softShoes"])), { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-1" } });
    expect(decidingOf(viewFor(s, "p2"))).not.toContain("Bail");
  });

  it("shows the latest answer", () => {
    const s = run(pending(), { type: "chooseBail", player: "p2", use: true });
    expect(decidingOf(viewFor(s, "p2"))).toContain("Your answer: use Bail.");
  });
});
