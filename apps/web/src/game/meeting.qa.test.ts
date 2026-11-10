// QA (PR #218, S4.8): try to break the meeting screens' helpers with real engine states.
import { applyEvent, handleCommand, privateTo, viewFor, type GameState, type PlayerCommand, type PlayerView, type SystemCommand, type VoteVisibility } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { createGame } from "./deal.testkit";
import { describeEvent } from "./describeEvent";
import { bailPromptOf, emergencyOf, latestOutcome, openMeetingOf, voteTargets } from "./meeting";

const crew = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`.padEnd(24, "W"), isBot: false }));
const ids = (n: number) => crew(n).map((p) => p.id);

function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
const game = (n: number, mode: VoteVisibility, bail = false): GameState => {
  let s: GameState = { ...createGame({ seed: "qa218", players: crew(n), job: "bank", eventsEnabled: false, voteVisibility: mode }), shop: ["bail", "tail", "softShoes"] as GameState["shop"] };
  if (bail) s = applyEvent(s, { type: "perkBought", visibility: privateTo("p2"), player: "p2", round: 1, perk: { kind: "bail" }, cost: 0 });
  return s;
};
/** Round `round` resolves, p3 calls an emergency and it opens. */
const emergency = (s: GameState, round: number, id: string) =>
  run(s, { type: "advance", deadline: { kind: "round", round } }, { type: "callEmergency", player: "p3" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: id } });
/** Everyone but p2 votes to shake p2 down; p2 skips. */
const allOnP2 = (s: GameState, n: number) => run(s, ...ids(n).map((p): PlayerCommand => ({ type: "castVote", player: p, vote: p === "p2" ? { kind: "skip" } : { kind: "shakedown", target: "p2" } })));
const close = (s: GameState, id: string) => run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: id } });
const resolve = (s: GameState, id: string) => run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: id } });
/** On to the next planning (if the result window is still open). */
const onward = (s: GameState) => (s.phase.kind === "result" ? run(s, { type: "advance", deadline: { kind: "result", round: s.resolvedRound } }) : s);

/** Every other player's ballot that reached this viewer's view, in any event or field. */
function othersBallots(v: PlayerView): string[] {
  const out: string[] = [];
  for (const { event: e } of [...v.ledger, ...v.caseFile]) {
    if (e.type === "voteCast" && e.player !== v.me.id) out.push(`voteCast ${e.player}`);
    if (e.type === "meetingClosed" && e.ballots) out.push(`ballots ${Object.keys(e.ballots).join(",")}`);
  }
  for (const p of Object.keys(v.me.seenBallots)) out.push(`seen ${p}`);
  return out;
}

describe("QA #218: a secret ballot is never visible to anyone else (design §11.2)", () => {
  for (const n of [3, 6, 12]) {
    it(`${n} seats: in the window, at the close, after the shakedown and in the next round`, () => {
      let s = allOnP2(emergency(game(n, "secret"), 1, "emergency-1"), n);
      const stages = [s, (s = close(s, "emergency-1")), (s = resolve(s, "emergency-1")), onward(s)];
      for (const st of stages)
        for (const me of ids(n)) {
          const v = viewFor(st, me);
          expect(othersBallots(v), `${me} at ${st.phase.kind}`).toEqual([]);
          expect(openMeetingOf(v)?.ballots ?? [], me).toEqual([]);
          expect(openMeetingOf(v)?.live ?? null).toBeNull();
          expect(latestOutcome(v)?.ballots ?? null).toBeNull();
        }
    });
  }

  it("a voter's own secret ballot stays theirs (case file, not the ledger)", () => {
    const s = allOnP2(emergency(game(6, "secret"), 1, "emergency-1"), 6);
    const v = viewFor(s, "p4");
    expect(v.ledger.some((e) => e.event.type === "voteCast")).toBe(false);
    expect(openMeetingOf(v)?.mine).toEqual({ kind: "shakedown", target: "p2" });
  });
});

describe("QA #218: a protected player is never offered in a live vote (design §9.5, §9.7)", () => {
  // 7–12 seats get two emergencies: p2 is shaken down at the first and still protected at the second.
  const second = (n: number, mode: VoteVisibility) => {
    let s = resolve(close(allOnP2(emergency(game(n, mode), 1, "emergency-1"), n), "emergency-1"), "emergency-1");
    s = onward(s);
    expect(s.phase.kind).toBe("planning");
    return emergency(s, 2, "emergency-2");
  };
  for (const n of [7, 12])
    it(`${n} seats: at the second emergency nobody sees p2 on the live list; the sealed list still has them`, () => {
      const s = second(n, "open");
      expect(s.protected).toEqual(["p2"]);
      for (const me of ids(n)) {
        const v = viewFor(s, me);
        expect(voteTargets(v).map((t) => t.id)).not.toContain("p2");
        expect(voteTargets(v)).toHaveLength(me === "p2" ? n - 1 : n - 2);
        if (me !== "p2") expect(voteTargets(v, true).map((t) => t.id)).toContain("p2");
      }
      // Whatever the picker offers, the engine takes.
      for (const t of voteTargets(viewFor(s, "p1"))) expect(handleCommand(s, { type: "castVote", player: "p1", vote: { kind: "shakedown", target: t.id } }).ok).toBe(true);
      expect(handleCommand(s, { type: "castVote", player: "p1", vote: { kind: "shakedown", target: "p2" } }).ok).toBe(false);
    });

  // Re-check round: protection limits shakedowns, not votes, so p2's Open ballot shows and counts for every viewer.
  for (const n of [7, 12])
    it(`${n} seats, Open: the protected player's ballot is in every viewer's list and live tally`, () => {
      const s = run(second(n, "open"), ...["p2", "p5", "p6"].map((p): PlayerCommand => ({ type: "castVote", player: p, vote: { kind: "shakedown", target: "p4" } })), { type: "castVote", player: "p7", vote: { kind: "skip" } });
      for (const me of ids(n)) {
        const m = openMeetingOf(viewFor(s, me))!;
        const others = ["p2", "p5", "p6", "p7"].filter((p) => p !== me);
        expect(m.ballots.map((b) => b.player), me).toEqual(others);
        expect(m.live, me).toEqual({ skip: 1, targets: { p4: 3 } });
      }
    });
});

describe("QA #218: the emergency button only in the result window (design §9.3)", () => {
  it("offered in the result window only: never in planning, the vote, the shakedown window, or once called", () => {
    const n = 7;
    let s = game(n, "open");
    const offered = (st: GameState) => ids(n).map((me) => emergencyOf(viewFor(st, me))).map((e) => e.inWindow && e.canCall);
    expect(s.phase.kind).toBe("planning");
    expect(offered(s)).toEqual(ids(n).map(() => false));
    expect(ids(n).map((me) => emergencyOf(viewFor(s, me)).inWindow)).toEqual(ids(n).map(() => false));
    s = run(s, { type: "advance", deadline: { kind: "round", round: 1 } });
    expect(s.phase.kind).toBe("result");
    expect(offered(s)).toEqual(ids(n).map(() => true));
    s = run(s, { type: "callEmergency", player: "p3" });
    expect(offered(s)).toEqual(ids(n).map(() => false));
    s = run(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-1" } });
    expect(s.phase.kind).toBe("meeting");
    expect(ids(n).map((me) => emergencyOf(viewFor(s, me)).inWindow)).toEqual(ids(n).map(() => false));
    s = close(allOnP2(s, n), "emergency-1");
    expect(s.phase.kind).toBe("shakedownPending");
    expect(ids(n).map((me) => emergencyOf(viewFor(s, me)).inWindow)).toEqual(ids(n).map(() => false));
    expect(handleCommand(s, { type: "callEmergency", player: "p1" }).ok).toBe(false);
  });
});

describe("QA #218: the Bail prompt is the target's alone, and only before the stash opens (design §9.6)", () => {
  const pending = () => close(allOnP2(emergency(game(6, "open", true), 1, "emergency-1"), 6), "emergency-1");
  it("nobody but the target ever gets it", () => {
    const s = pending();
    expect(bailPromptOf(viewFor(s, "p2"))).toEqual({ meetingId: "emergency-1", use: false, answered: false });
    for (const me of ["p1", "p3", "p4", "p5", "p6"]) expect(bailPromptOf(viewFor(s, me)), me).toBeNull();
    // The target's answer never reaches anyone else's view.
    const answered = run(s, { type: "chooseBail", player: "p2", use: true });
    for (const me of ["p1", "p3", "p4", "p5", "p6"]) {
      expect(bailPromptOf(viewFor(answered, me))).toBeNull();
      expect(JSON.stringify(viewFor(answered, me))).not.toContain("bailChosen");
    }
  });
  it("gone once the stash opens, used or kept, and never before the vote closes", () => {
    const s = pending();
    expect(bailPromptOf(viewFor(allOnP2(emergency(game(6, "open", true), 1, "emergency-1"), 6), "p2"))).toBeNull();
    expect(bailPromptOf(viewFor(resolve(s, "emergency-1"), "p2"))).toBeNull();
    expect(bailPromptOf(viewFor(resolve(run(s, { type: "chooseBail", player: "p2", use: true }), "emergency-1"), "p2"))).toBeNull();
  });
  it("latest answer counts: use, then keep", () => {
    const s = run(pending(), { type: "chooseBail", player: "p2", use: true }, { type: "chooseBail", player: "p2", use: false });
    expect(bailPromptOf(viewFor(s, "p2"))).toEqual({ meetingId: "emergency-1", use: false, answered: true });
  });
});

describe("QA #218: a clean shakedown never shows the set-aside clause (#109)", () => {
  it("a real clean shakedown's ledger line, for the target and for everyone else", () => {
    const s = resolve(close(allOnP2(emergency(game(6, "open"), 1, "emergency-1"), 6), "emergency-1"), "emergency-1");
    for (const me of ids(6)) {
      const v = viewFor(s, me);
      const e = v.ledger.find((x) => x.event.type === "shakedownResolved")!.event;
      expect(e.type === "shakedownResolved" && e.clean).toBe(true);
      const text = describeEvent(e, { me, name: (p) => p });
      expect(text).toContain("Clean: nothing above the share.");
      expect(text).not.toMatch(/set aside|next split/);
    }
  });
});
