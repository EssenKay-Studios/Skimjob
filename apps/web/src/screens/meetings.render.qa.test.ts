// QA (PR #218, S4.8): the meeting screens rendered from real engine states, 6 and 12 seats, 24-character names:
// no secret ballot on anyone's screen, no protected player on the live picker, the emergency button only in the result
// window, the Bail prompt for the target alone and only before the stash opens, and no set-aside line on a clean card.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyEvent, handleCommand, privateTo, viewFor, type GameState, type PlayerCommand, type PlayerView, type SystemCommand, type VoteVisibility } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/deal.testkit";
import type { PinsChannel } from "../game/notes";
import { DecidingPanel, MeetingNow, MeetingsPanel, ResultDialog } from "./Meetings";

const FIRST = ["Ana", "Ben", "Cy", "Dee", "Eve", "Fox", "Gus", "Hal", "Ida", "Jo", "Kit", "Lu"];
const crew = (n: number) => FIRST.slice(0, n).map((f, i) => ({ id: `p${i + 1}`, name: `${f} Wolfeschlegelsteinhausen`.slice(0, 24), isBot: false }));
const ids = (n: number) => crew(n).map((p) => p.id);
const nameOf = (id: string) => crew(12).find((p) => p.id === id)!.name;

function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
const game = (n: number, mode: VoteVisibility, bail = false): GameState => {
  let s: GameState = { ...createGame({ seed: "qa218-render", players: crew(n), job: "bank", eventsEnabled: false, voteVisibility: mode }), shop: ["bail", "tail", "softShoes"] as GameState["shop"] };
  if (bail) s = applyEvent(s, { type: "perkBought", visibility: privateTo("p2"), player: "p2", round: 1, perk: { kind: "bail" }, cost: 0 });
  return run(s, { type: "advance", deadline: { kind: "round", round: 1 } });
};
const open = (s: GameState, id = "emergency-1") => run(s, { type: "callEmergency", player: "p3" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: id } });
/** Everyone votes: all but p2 and the last seat shake p2 down, those two skip. */
const vote = (s: GameState, n: number) =>
  run(s, ...ids(n).map((p): PlayerCommand => ({ type: "castVote", player: p, vote: p === "p2" || p === `p${n}` ? { kind: "skip" } : { kind: "shakedown", target: "p2" } })));
const close = (s: GameState, id = "emergency-1") => run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: id } });
const resolve = (s: GameState, id = "emergency-1") => run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: id } });

const send = async () => ({ ok: true as const });
const pins: PinsChannel = { pins: new Set(), ready: true, error: null, toggle: () => {} };
const props = (view: PlayerView) => ({ view, timers: [], offset: 0, send });
const html = (s: GameState, me: string) => {
  const v = viewFor(s, me);
  return [
    renderToStaticMarkup(createElement(ResultDialog, { view: v, pins, dismissed: null, onDismiss: () => {} })),
    v.phase.kind === "meeting" ? renderToStaticMarkup(createElement(MeetingNow, props(v))) : "",
    v.phase.kind === "shakedownPending" ? renderToStaticMarkup(createElement(DecidingPanel, props(v))) : "",
    v.phase.kind !== "meeting" && v.phase.kind !== "shakedownPending" ? renderToStaticMarkup(createElement(MeetingsPanel, { ...props(v), autoMeetings: true })) : "",
  ].join("");
};
/** "<Name>: shake down …" or "<Name>: skip" for anyone but the viewer: a ballot on screen. */
const ballotOf = (out: string, p: string) => new RegExp(`${nameOf(p)}</b>: (shake down|skip)`).test(out);

describe("QA #218: no secret ballot on anyone's screen (design §11.2)", () => {
  for (const n of [6, 12])
    it(`${n} seats: the vote window, the Bail window and the result card`, () => {
      let s = vote(open(game(n, "secret")), n);
      for (const st of [s, (s = close(s)), resolve(s)])
        for (const me of ids(n)) {
          const out = html(st, me);
          for (const p of ids(n)) if (p !== me) expect(ballotOf(out, p), `${me} sees ${p}'s ballot at ${st.phase.kind}`).toBe(false);
          expect(out).not.toContain("How everyone voted");
          expect(out).not.toContain("Live tally");
        }
    });

  it("the Open control: the same check finds the ballots on the result card, so it would catch a leak", () => {
    expect(ballotOf(html(resolve(close(vote(open(game(6, "open")), 6))), "p1"), "p4")).toBe(true);
  });
});

describe("QA #218: no protected player on the live picker (design §9.5, §9.7)", () => {
  it("12 seats: at the second emergency p2 (shaken down at the first) has no button; the sealed picker keeps them", () => {
    let s = resolve(close(vote(open(game(12, "open")), 12)));
    if (s.phase.kind === "result") s = run(s, { type: "advance", deadline: { kind: "result", round: s.resolvedRound } });
    s = open(run(s, { type: "advance", deadline: { kind: "round", round: 2 } }), "emergency-2");
    expect(s.protected).toEqual(["p2"]);
    for (const me of ids(12).filter((p) => p !== "p2")) {
      const picker = html(s, me).split('aria-label="Your vote"')[1]!.split("</div>")[0]!;
      expect(picker).not.toContain(nameOf("p2"));
      expect(picker).toContain(nameOf(me === "p4" ? "p5" : "p4"));
      expect(html(s, me)).toContain("so not on the list");
    }
  });
});

describe("QA #218: the emergency button only in the result window (design §9.3)", () => {
  const button = "Call an emergency meeting";
  it("6 seats: offered in round 1's result window, never in planning, the vote, the Bail window or after the pool is spent", () => {
    const planning = createGame({ seed: "qa218-render", players: crew(6), job: "bank", eventsEnabled: false, voteVisibility: "open" });
    const result = game(6, "open");
    const meeting = vote(open(result), 6);
    const deciding = close(meeting);
    const after = resolve(deciding);
    expect(result.phase.kind).toBe("result");
    for (const me of ids(6)) {
      expect(renderToStaticMarkup(createElement(MeetingsPanel, { ...props(viewFor(planning, me)), autoMeetings: true }))).not.toContain(button);
      expect(html(result, me)).toContain(button);
      for (const st of [meeting, deciding, after]) expect(html(st, me), `${me} at ${st.phase.kind}`).not.toContain(button);
    }
  });
});

describe("QA #218: the Bail prompt is the target's alone, only before the stash opens (design §9.6)", () => {
  for (const n of [6, 12])
    it(`${n} seats`, () => {
      const deciding = close(vote(open(game(n, "open", true)), n));
      expect(html(deciding, "p2")).toContain("Use your Bail?");
      for (const me of ids(n).filter((p) => p !== "p2")) expect(html(deciding, me), me).not.toContain("Bail");
      // Once the stash opens (kept or used), nobody sees the prompt, the target included.
      for (const st of [resolve(deciding), resolve(run(deciding, { type: "chooseBail", player: "p2", use: true }))])
        for (const me of ids(n)) expect(html(st, me)).not.toContain("Use your Bail?");
      // Before the vote closes, not even the target.
      expect(html(vote(open(game(n, "open", true)), n), "p2")).not.toContain("Use your Bail?");
    });
});

describe("QA #218: a clean shakedown's card has no set-aside line (#109)", () => {
  for (const mode of ["open", "secret"] as const)
    it(`${mode}: every viewer`, () => {
      const s = resolve(close(vote(open(game(6, mode)), 6)));
      for (const me of ids(6)) {
        const out = html(s, me);
        expect(out).toContain("Clean: nothing above the share.");
        expect(out).not.toMatch(/Into the next split|set aside/);
      }
    });
});
