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
import { createGame } from "./deal.testkit";
import { describe, expect, it } from "vitest";
import {
  abilityOffers,
  claimState,
  decidingOf,
  emergencyOf,
  latestOutcome,
  localInputValue,
  openMeetingOf,
  plannerOf,
  slotFromLocal,
  tallyRows,
} from "./meeting";

/** A new game with a pinned shop of no Shield, whatever the seed: a Shield opens a shakedown window at every meeting. */
const newGame = (cfg: GameConfig, roles: readonly string[] = []): GameState => ({ ...createGame(cfg, roles), shop: ["peek", "alibi", "extraVote"] });

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
    state = r.state;
  }
  return state;
}
const shake = (player: PlayerId, target: PlayerId): PlayerCommand => ({ type: "castVote", player, vote: { kind: "shakedown", target } });
const skip = (player: PlayerId): PlayerCommand => ({ type: "castVote", player, vote: { kind: "skip" } });
const open = (id: string): SystemCommand => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: id } });
const close = (id: string): SystemCommand => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: id } });
/** Round 1 resolves and its alibis close: the result window, when an emergency can be called (design §9.3). */
const RESULT_WINDOW: SystemCommand[] = [{ type: "advance", deadline: { kind: "round", round: 1 } }, { type: "advance", deadline: { kind: "alibis", round: 1 } }];

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

  it("Ballot perk: its holder sees the one ballot they unlocked, also in Secret mode (design §8.3)", () => {
    let s = newGame(config("secret"));
    s = applyEvent(s, { type: "perkBought", visibility: privateTo("p1"), player: "p1", perk: "ballot", cost: 0 });
    s = run(s, ...RESULT_WINDOW, { type: "callEmergency", player: "p2" }, open("emergency-1"), shake("p3", "p2"), skip("p4"));
    expect(abilityOffers(viewFor(s, "p1"))).toContainEqual({ kind: "ballot", targets: ["p2", "p3", "p4", "p5"] });
    s = run(s, { type: "useAbility", player: "p1", ability: { kind: "ballot", target: "p3" } });
    const m = openMeetingOf(viewFor(s, "p1"))!;
    expect(m.seen).toEqual([{ player: "p3", vote: { kind: "shakedown", target: "p2" } }]);
    expect(m.ballots).toEqual([]);
    expect(othersBallots(m)).not.toMatch(/"p4"/);
    // Nobody else sees it.
    expect(openMeetingOf(viewFor(s, "p2"))!.seen).toEqual([]);
    expect(abilityOffers(viewFor(s, "p1")).some((o) => o.kind === "ballot")).toBe(false);
  });

  it("Ballot is never offered in Open mode, where ballots are public anyway", () => {
    let s = newGame(config("open"));
    s = applyEvent(s, { type: "perkBought", visibility: privateTo("p1"), player: "p1", perk: "ballot", cost: 0 });
    s = run(s, ...RESULT_WINDOW, { type: "callEmergency", player: "p2" }, open("emergency-1"));
    expect(abilityOffers(viewFor(s, "p1"))).toEqual([]);
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
    expect(abilityOffers(viewFor(s, "p1"))).toEqual([]);
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
    expect(emergencyOf(viewFor(s, "p1"))).toMatchObject({ canCall: false, note: "Only after a round's result, before the next planning (1 left for the crew)." });
    s = run(s, ...RESULT_WINDOW);
    expect(emergencyOf(viewFor(s, "p1"))).toMatchObject({ canCall: true, note: "1 left for the crew. Everyone is told who called it." });
    s = run(s, { type: "callEmergency", player: "p1" });
    expect(emergencyOf(viewFor(s, "p2"))).toMatchObject({ canCall: false, note: "The crew's emergency meetings are all spent." });
    s = run(s, open("emergency-1"), close("emergency-1"));
    expect(emergencyOf(viewFor(s, "p1"))).toMatchObject({ canCall: false, note: "The crew's emergency meetings are all spent." });
  });
});

describe("the shakedown window and results (design §9.6)", () => {
  const smoothTalkerMeeting = (mode: VoteVisibility = "hiddenThenRevealed") => run(voting(mode, {}, ["smoothTalker", "smoothTalker", "smoothTalker", "smoothTalker", "smoothTalker"]), close("emergency-1"));

  it("results: a clean shakedown takes nothing; the banner stays until the next round resolves (design §9.6)", () => {
    // No Shield in the shop: no window, the shakedown lands as the meeting closes.
    const s = run(voting("hiddenThenRevealed"), close("emergency-1"));
    const o = latestOutcome(viewFor(s, "p1"))!;
    expect(o).toMatchObject({ kind: "emergency", deciding: false, fresh: true, cancelled: false });
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
