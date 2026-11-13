// Meetings and voting UI helpers, from real engine views: each vote mode shows
// only what the view allows. docs/m2-plan.md M2-7; design §11.1–§11.5
import {
  applyEvent,
  handleCommand,
  privateTo,
  viewFor,
  type GameConfig,
  type GameState,
  type PlayerCommand,
  type PlayerId,
  type SystemCommand,
  type VoteVisibility,
} from "@skimjob/engine";
import { caseData } from "./caseLeads";
import { createGame, pastAlibi } from "./deal.testkit";
import { describe, expect, it } from "vitest";
import {
  bailPromptOf,
  claimState,
  decidingOf,
  emergencyOf,
  latestOutcome,
  localInputValue,
  openMeetingOf,
  plannerOf,
  protectedPlayers,
  slotFromLocal,
  tallyRows,
  voteTargets,
} from "./meeting";

/** A new game with a pinned black market without Bail, whatever the seed: Bail opens a choice window after every passed shakedown (design §9.6). */
const newGame = (cfg: GameConfig, roles: readonly string[] = []): GameState => ({ ...createGame(cfg, roles), shop: ["tail", "softShoes", "plantEvidence"] });

const config = (mode: VoteVisibility, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "meeting-ui",
  players: ["Ana", "Ben", "Cy", "Dee", "Eve"].map((name, i) => ({ id: `p${i + 1}`, name, isBot: false })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: mode,
  ...extra,
});

function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = pastAlibi(r.state);
  }
  return state;
}
const shake = (player: PlayerId, target: PlayerId): PlayerCommand => ({ type: "castVote", player, vote: { kind: "shakedown", target } });
const skip = (player: PlayerId): PlayerCommand => ({ type: "castVote", player, vote: { kind: "skip" } });
const open = (id: string): SystemCommand => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: id } });
const close = (id: string): SystemCommand => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: id } });
/** Round 1 resolves into the result window, when an emergency can be called (design §9.3). */
const RESULT_WINDOW: SystemCommand[] = [{ type: "advance", deadline: { kind: "round", round: 1 } }];

/** p2 calls an emergency meeting; p1 (the viewer) votes Ben, p3 and p4 vote Ben, p5 skips. */
function voting(mode: VoteVisibility, extra: Partial<GameConfig> = {}, roles: readonly string[] = []): GameState {
  let s = newGame(config(mode, extra), roles);
  s = run(s, ...RESULT_WINDOW, { type: "callEmergency", player: "p2" }, open("emergency-1"));
  return run(s, shake("p1", "p2"), shake("p3", "p2"), shake("p4", "p2"), skip("p5"));
}

/** Every other player's id that appears anywhere in `x` as a ballot target or voter. */
const othersBallots = (x: unknown) => JSON.stringify(x);

describe("the vote window per vote mode (design §11.2)", () => {
  it("Hidden: you see only your own ballot while it's open, everyone's once it closes", () => {
    const s = voting("hiddenThenRevealed");
    const m = openMeetingOf(viewFor(s, "p1"))!;
    expect(m).toMatchObject({ meetingId: "emergency-1", kind: "emergency", calledBy: "p2", mode: "hiddenThenRevealed", mine: { kind: "shakedown", target: "p2" }, fromSealed: false });
    expect(m.ballots).toEqual([]);
    expect(m.seen).toEqual([]);
    expect(m.live).toBeNull();
    // Nothing in what the dialog reads names another voter.
    expect(othersBallots(m)).not.toMatch(/"p[345]"/);

    const after = latestOutcome(viewFor(run(s, close("emergency-1")), "p1"))!;
    expect(after.ballots).toEqual([
      { player: "p1", vote: { kind: "shakedown", target: "p2" } },
      { player: "p3", vote: { kind: "shakedown", target: "p2" } },
      { player: "p4", vote: { kind: "shakedown", target: "p2" } },
      { player: "p5", vote: { kind: "skip" } },
    ]);
    expect(after.result).toEqual({ kind: "shakedown", target: "p2" });
  });

  it("Open: everyone's ballot and a live tally while it's open", () => {
    const m = openMeetingOf(viewFor(voting("open"), "p1"))!;
    expect(m.ballots).toEqual([
      { player: "p3", vote: { kind: "shakedown", target: "p2" } },
      { player: "p4", vote: { kind: "shakedown", target: "p2" } },
      { player: "p5", vote: { kind: "skip" } },
    ]);
    expect(m.live).toEqual({ skip: 1, targets: { p2: 3 } });
    // A changed ballot replaces the earlier one in the live view.
    const changed = openMeetingOf(viewFor(run(voting("open"), skip("p3")), "p1"))!;
    expect(changed.live).toEqual({ skip: 2, targets: { p2: 2 } });
  });

  it("Secret: only your own ballot while open, and only the tally after it closes, even at the end", () => {
    const s = voting("secret");
    const m = openMeetingOf(viewFor(s, "p1"))!;
    expect(m.ballots).toEqual([]);
    expect(m.live).toBeNull();
    expect(othersBallots(m)).not.toMatch(/"p[345]"/);
    const after = latestOutcome(viewFor(run(s, close("emergency-1")), "p1"))!;
    expect(after.ballots).toBeNull();
    expect(after.tally).toEqual({ skip: 1, targets: { p2: 3 } });
  });

  it("Check ballot: its buyer sees the one ballot they bought at the next meeting, also in Secret mode (design §12)", () => {
    let s = newGame(config("secret"));
    s = applyEvent(s, { type: "perkBought", visibility: privateTo("p1"), player: "p1", round: 1, perk: { kind: "ballot", target: "p3" }, cost: 0 });
    s = run(s, ...RESULT_WINDOW, { type: "callEmergency", player: "p2" }, open("emergency-1"), shake("p3", "p2"), skip("p4"));
    const m = openMeetingOf(viewFor(s, "p1"))!;
    expect(m.seen).toEqual([{ player: "p3", vote: { kind: "shakedown", target: "p2" } }]);
    expect(m.ballots).toEqual([]);
    expect(othersBallots(m)).not.toMatch(/"p4"/);
    // Nobody else sees it.
    expect(openMeetingOf(viewFor(s, "p2"))!.seen).toEqual([]);
  });

  it("a sealed vote is marked as yours when the window opens (design §11.2)", () => {
    let s = newGame(config("hiddenThenRevealed"));
    s = run(s, { type: "sealVote", player: "p1", vote: { kind: "skip" } }, ...RESULT_WINDOW, { type: "callEmergency", player: "p2" }, open("emergency-1"));
    expect(openMeetingOf(viewFor(s, "p1"))).toMatchObject({ mine: { kind: "skip" }, fromSealed: true });
    s = run(s, shake("p1", "p3"));
    expect(openMeetingOf(viewFor(s, "p1"))).toMatchObject({ mine: { kind: "shakedown", target: "p3" }, fromSealed: false });
  });

  it("the Smooth Talker's double weight never shows in the live tally (design §9.5, §11.1)", () => {
    const s = voting("open", {}, ["smoothTalker", "smoothTalker", "smoothTalker", "smoothTalker", "smoothTalker"]);
    expect(openMeetingOf(viewFor(s, "p1"))!.live).toEqual({ skip: 1, targets: { p2: 3 } });
  });
});

describe("tally bars (ui-style 'Vote window')", () => {
  it("marks the single leader and the passed option", () => {
    const rows = tallyRows({ skip: 1, targets: { p2: 3, p3: 1 } }, { kind: "shakedown", target: "p2" });
    expect(rows.map((r) => [r.key, r.votes, r.share, r.leading, r.passed])).toEqual([
      ["p2", 3, 1, true, true],
      ["p3", 1, 1 / 3, false, false],
      ["skip", 1, 1 / 3, false, false],
    ]);
  });
  it("a tie has no leader; skipped marks Skip as passed", () => {
    expect(tallyRows({ skip: 2, targets: { p2: 2 } }, { kind: "noMajority" }).some((r) => r.leading || r.passed)).toBe(false);
    expect(tallyRows({ skip: 3, targets: {} }, { kind: "skipped" }).find((r) => r.key === "skip")).toMatchObject({ leading: true, passed: true });
  });
});

describe("scheduling and emergencies (design §9.3, §9.4)", () => {
  it("proposals, backers and the locked slot", () => {
    let s = newGame(config("hiddenThenRevealed"));
    s = run(s, { type: "proposeMeeting", player: "p2", slot: "2026-11-03T15:30:00.000Z" });
    let p = plannerOf(viewFor(s, "p1"));
    expect(p).toMatchObject({ locked: null, needed: 3, open: true });
    expect(p.proposals).toEqual([{ id: "proposal-1", slot: "2026-11-03T15:30:00.000Z", by: "p2", backers: 1, backed: false }]);
    s = run(s, { type: "acceptMeeting", player: "p1", proposalId: "proposal-1" });
    expect(plannerOf(viewFor(s, "p1")).proposals[0]).toMatchObject({ backers: 2, backed: true });
    s = run(s, { type: "acceptMeeting", player: "p3", proposalId: "proposal-1" });
    p = plannerOf(viewFor(s, "p1"));
    expect(p.locked).toEqual({ meetingId: "meeting-1", slot: "2026-11-03T15:30:00.000Z" });
    expect(p.open).toBe(false);
  });

  it("a time picker value becomes an ISO slot and back", () => {
    const ms = new Date(2026, 10, 3, 21, 30).getTime();
    expect(localInputValue(ms)).toBe("2026-11-03T21:30");
    expect(slotFromLocal("2026-11-03T21:30")).toBe(new Date(ms).toISOString());
    expect(slotFromLocal("")).toBeNull();
    expect(slotFromLocal("tomorrow")).toBeNull();
  });

  it("the crew's emergency pool: only in the result window, one waiting at a time, until it is spent (design §9.3)", () => {
    let s = newGame(config("hiddenThenRevealed"));
    expect(emergencyOf(viewFor(s, "p1"))).toMatchObject({ left: 1, inWindow: false, canCall: false, note: "Only after a round's result, before the next planning." });
    s = run(s, ...RESULT_WINDOW);
    expect(emergencyOf(viewFor(s, "p1"))).toMatchObject({ left: 1, inWindow: true, canCall: true, note: "Everyone is told who called it." });
    s = run(s, { type: "callEmergency", player: "p1" });
    // One per window: the pool is spent at once, and the window is still open until the meeting does.
    expect(emergencyOf(viewFor(s, "p2"))).toMatchObject({ left: 0, canCall: false, note: "The crew's emergency meetings are all spent." });
    s = run(s, open("emergency-1"), close("emergency-1"));
    expect(emergencyOf(viewFor(s, "p1"))).toMatchObject({ left: 0, inWindow: false, canCall: false, note: "The crew's emergency meetings are all spent." });
  });

  it("a bigger crew has two emergencies; a second call in the same window waits for the first (design §9.3)", () => {
    const names = ["Ana", "Ben", "Cy", "Dee", "Eve", "Fay", "Gus"];
    let s = newGame(config("open", { players: names.map((name, i) => ({ id: `p${i + 1}`, name, isBot: false })) }));
    s = run(s, ...RESULT_WINDOW, { type: "callEmergency", player: "p1" });
    expect(emergencyOf(viewFor(s, "p2"))).toMatchObject({ left: 1, inWindow: true, canCall: false, note: "An emergency meeting has already been called." });
  });
});

describe("the shakedown window and results (design §9.6)", () => {
  const smoothTalkerMeeting = (mode: VoteVisibility = "hiddenThenRevealed") => run(voting(mode, {}, ["smoothTalker", "smoothTalker", "smoothTalker", "smoothTalker", "smoothTalker"]), close("emergency-1"));

  it("results: a clean shakedown takes nothing; the banner stays until the next round resolves (design §9.6)", () => {
    // No Bail on the black market: no window, the shakedown lands as the meeting closes.
    const s = run(voting("hiddenThenRevealed"), close("emergency-1"));
    const o = latestOutcome(viewFor(s, "p1"))!;
    expect(o).toMatchObject({ kind: "emergency", round: 1, deciding: false, fresh: true, cancelled: false });
    expect(o.shakedown).toMatchObject({ target: "p2", stashRevealed: s.share, taken: 0, clean: true });
    const later = run(s, { type: "advance", deadline: { kind: "round", round: 2 } });
    expect(latestOutcome(viewFor(later, "p1"))!.fresh).toBe(false);
  });

  it("a regular meeting at a third of the bank goes straight on: no checkpoint (design §6.2, §9.1)", () => {
    // A small bank: round 1's default moves take a third of it.
    let s = newGame(config("open", { contentOverrides: { bank: { coinsPerPlayer: 3 } } }));
    s = run(s, ...RESULT_WINDOW);
    expect(s.phase).toMatchObject({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" });
    s = run(s, { type: "scheduleMeeting", meetingId: "meeting-1", slot: "meeting-1" }, open("meeting-1"), skip("p1"), skip("p2"), skip("p3"), close("meeting-1"));
    const o = latestOutcome(viewFor(s, "p4"))!;
    expect(o.result).toEqual({ kind: "skipped" });
    expect(o).not.toHaveProperty("checkpoint");
    expect(o.fresh).toBe(true);
  });
});

describe("protection and the vote picker (design §9.5, §9.7)", () => {
  // p2 is voted out in the emergency meeting; with no Bail on the market the shakedown lands as it closes.
  const afterShakedown = () => run(voting("open"), close("emergency-1"));

  it("a protected player is public, and left out of every picker; nobody else is", () => {
    const s = afterShakedown();
    expect(voteTargets(viewFor(newGame(config("open")), "p1")).map((t) => t.id)).toEqual(["p2", "p3", "p4", "p5"]);
    for (const me of ["p1", "p3", "p5"]) {
      const v = viewFor(s, me);
      expect(protectedPlayers(v)).toEqual(["p2"]);
      expect(voteTargets(v).map((t) => t.id)).not.toContain("p2");
    }
    // The protected player may still vote on the others, and never gets themselves in the list.
    expect(voteTargets(viewFor(s, "p2")).map((t) => t.id)).toEqual(["p1", "p3", "p4", "p5"]);
  });

  // The engine refuses a live vote for them (engine/meeting.test.ts); a sealed one is allowed and counts as a skip while they are protected.
  it("a sealed vote may still name a protected player, so only the sealed picker lists them", () => {
    const s = afterShakedown();
    const v = viewFor(s, "p1");
    expect(voteTargets(v, true).map((t) => t.id)).toEqual(["p2", "p3", "p4", "p5"]);
    expect(handleCommand(s, { type: "sealVote", player: "p1", vote: { kind: "shakedown", target: "p2" } }).ok).toBe(true);
  });

  // design §9.7: protection limits only shakedowns, so a protected player's Open ballot still counts and shows.
  it("Open mode: a protected player's ballot stays in the list and the live tally", () => {
    // Seven seats: the pool holds two emergencies. p2 is shaken down in the first; the second comes in round 2's result window.
    const players = ["Ana", "Ben", "Cy", "Dee", "Eve", "Fay", "Gus"].map((name, i) => ({ id: `p${i + 1}`, name, isBot: false }));
    let s = run(voting("open", { players }), close("emergency-1"), { type: "advance", deadline: { kind: "round", round: 2 } });
    expect(s.protected).toEqual(["p2"]);
    s = run(s, { type: "callEmergency", player: "p3" }, open("emergency-2"), shake("p2", "p4"), shake("p5", "p4"));
    const m = openMeetingOf(viewFor(s, "p1"))!;
    expect(m.ballots.map((b) => b.player)).toEqual(["p2", "p5"]);
    expect(m.live).toEqual({ skip: 0, targets: { p4: 2 } });
  });

  // design §9.6: a clean shakedown has nothing set aside, so its case board lead doesn't say "0 back".
  it("the case board lead for a clean shakedown says clean", () => {
    const lead = caseData(viewFor(afterShakedown(), "p1"), new Set()).leads.find((l) => l.summary?.includes("shaken down"));
    expect(lead?.summary).toContain("shaken down · clean");
    expect(lead?.summary).not.toContain("back");
  });

  it("nobody is protected before a shakedown", () => {
    expect(protectedPlayers(viewFor(newGame(config("open")), "p1"))).toEqual([]);
  });
});

describe("the Bail choice prompt (design §9.6)", () => {
  /** Bail on the market and in p2's hands; p2 is voted out in an emergency meeting. */
  function bailed(): GameState {
    let s: GameState = { ...createGame(config("open")), shop: ["bail", "tail", "softShoes"] };
    s = applyEvent(s, { type: "perkBought", visibility: privateTo("p2"), player: "p2", round: 1, perk: { kind: "bail" }, cost: 0 });
    s = run(s, ...RESULT_WINDOW, { type: "callEmergency", player: "p3" }, open("emergency-1"), shake("p1", "p2"), shake("p3", "p2"), shake("p4", "p2"), skip("p5"));
    return run(s, close("emergency-1"));
  }

  it("goes only to the target, and only if they hold a Bail; no answer means don't use", () => {
    const s = bailed();
    expect(s.phase.kind).toBe("shakedownPending");
    expect(bailPromptOf(viewFor(s, "p2"))).toEqual({ meetingId: "emergency-1", use: false, answered: false });
    // Everyone else sees the same neutral window, and no prompt.
    for (const me of ["p1", "p3", "p4", "p5"]) {
      expect(bailPromptOf(viewFor(s, me))).toBeNull();
      expect(decidingOf(viewFor(s, me))).toEqual({ meetingId: "emergency-1", target: "p2" });
    }
  });

  it("the latest answer counts and is private to the holder", () => {
    let s = run(bailed(), { type: "chooseBail", player: "p2", use: true });
    expect(bailPromptOf(viewFor(s, "p2"))).toMatchObject({ use: true, answered: true });
    s = run(s, { type: "chooseBail", player: "p2", use: false });
    expect(bailPromptOf(viewFor(s, "p2"))).toMatchObject({ use: false, answered: true });
    expect(JSON.stringify(viewFor(s, "p1"))).not.toContain("bailChosen");
  });

  it("a target without a Bail gets no prompt, even when the window is open", () => {
    // Bail is on the market but nobody bought it: the window still opens for the target.
    let s: GameState = { ...createGame(config("open")), shop: ["bail", "tail", "softShoes"] };
    s = run(s, ...RESULT_WINDOW, { type: "callEmergency", player: "p3" }, open("emergency-1"), shake("p1", "p2"), shake("p3", "p2"), shake("p4", "p2"), skip("p5"), close("emergency-1"));
    expect(s.phase.kind).toBe("shakedownPending");
    expect(bailPromptOf(viewFor(s, "p2"))).toBeNull();
  });

  it("a Bail used makes it fall through; the target is still protected (design §9.6, §9.7)", () => {
    let s = run(bailed(), { type: "chooseBail", player: "p2", use: true }, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "emergency-1" } });
    const v = viewFor(s, "p1");
    expect(latestOutcome(v)).toMatchObject({ cancelled: true, shakedown: null });
    expect(protectedPlayers(v)).toEqual(["p2"]);
  });
});

describe("role claims (R4b, design §11.3)", () => {
  it("offers every content role, once per stretch", () => {
    let s = newGame(config("open"));
    const before = claimState(viewFor(s, "p1"))!;
    expect(before.stretch).toBe(1);
    expect(before.claimed).toBeNull();
    expect(before.options.map((o) => o.id)).toEqual(expect.arrayContaining(["lookout", "locksmith", "mole"]));
    s = run(s, { type: "claimRole", player: "p1", role: "lookout" });
    expect(claimState(viewFor(s, "p1"))!.claimed).toBe("lookout");
    expect(claimState(viewFor(s, "p2"))!.claimed).toBeNull();
  });
});
