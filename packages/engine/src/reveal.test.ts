// The end-of-game reveal summary (design §8, §12, §15.5).
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, Outcome, RankEntry } from "./types";
import { PUBLIC, REVEAL, privateTo, secretTo } from "./types";
import { revealSummary } from "./reveal";
import { createGame } from "./setup";
import { viewFor } from "./view";

const dealt = (player: string, role: string): GameEvent => ({ type: "roleDealt", visibility: privateTo(player), player, role });
const started = (round: number): GameEvent => ({ type: "roundStarted", visibility: PUBLIC, round });
const rank = (player: string, role: string, stash: number): RankEntry => ({ player, role, stash });

/** A three-seat game: p0 Mole, p1 Hacker, p2 Lookout with Security. */
const SETUP: GameEvent[] = [dealt("p0", "mole"), dealt("p1", "hacker"), dealt("p2", "lookout")];
const success = (ranking: RankEntry[]): Outcome => ({ result: "success", ranking, winners: [ranking[0]?.player ?? ""], getaway: 0 });

describe("reveal summary — design §13", () => {

  it("shows every hidden power use, a use already done and an absolve, and takes the absolve out of the stash (design §11.1, §11.4)", () => {
    const log: GameEvent[] = [
      ...SETUP,
      started(1),
      { type: "coinsGrabbed", visibility: privateTo("p2"), player: "p2", round: 1, room: "vault", duffel: 0, pocket: 3, seized: 0 },
      { type: "abilityResolved", visibility: privateTo("p1"), player: "p1", round: 1, ability: { kind: "hide", room: "vault", bulbs: 2 } },
      { type: "abilityAlreadyDone", visibility: privateTo("p0"), player: "p0", round: 1, ability: { kind: "hide", room: "vault" } },
      { type: "sinsAbsolved", visibility: privateTo("p2"), player: "p2", round: 1, taken: 3 },
      { type: "powerCut", visibility: PUBLIC, round: 1, room: "office" },
    ];
    const s = revealSummary(log, success([rank("p1", "hacker", 0)]));
    expect(s.rounds[0]?.items.map((i) => (i.kind === "event" ? i.event.type : i.kind))).toEqual(["abilityResolved", "abilityAlreadyDone", "sinsAbsolved", "powerCut"]);
    expect(s.rounds[0]?.stashes.p2).toBe(0);
  });

  // design §3.3, §15.5: a missed move into a taped-off Lobby has no `coinsGrabbed`; the reveal still says who sat out.
  it("names who sat a round out, apart from a default move that was played, (design §3.3, §15.5)", () => {
    const grab = (p: string, room: string): GameEvent => ({ type: "coinsGrabbed", visibility: privateTo(p), player: p, round: 2, room, duffel: 1, pocket: 0, seized: 0 });
    const log: GameEvent[] = [
      ...SETUP,
      started(2),
      { type: "defaultMoveAssigned", visibility: privateTo("p1"), player: "p1", round: 2, move: null },
      { type: "defaultMoveAssigned", visibility: privateTo("p2"), player: "p2", round: 2, move: { room: "lobby", duffel: 1, pocket: 0 } },
      grab("p0", "office"),
      grab("p2", "lobby"),
    ];
    const round = revealSummary(log, success([rank("p0", "mole", 0)])).rounds.find((r) => r.round === 2);
    expect(round?.satOut).toEqual(["p1"]);
    expect(round?.moves.map((m) => [m.player, m.room, m.missed])).toEqual([
      ["p0", "office", false],
      ["p2", "lobby", true],
    ]);
  });

  // design §5.1, §11.1: the final board still shows "?" for a bell the Hacker hid in the last round; the reveal has their result.
  it("shows the Hacker's real result in the round the game ended (design §11.1, §15.5)", () => {
    const log: GameEvent[] = [
      ...SETUP,
      started(1),
      { type: "abilityResolved", visibility: privateTo("p1"), player: "p1", round: 1, ability: { kind: "hide", room: "vault", bulbs: 2 } },
    ];
    const last = revealSummary(log, success([rank("p0", "mole", 0)])).rounds.at(-1);
    expect(last?.round).toBe(1);
    expect(last?.items).toEqual([{ kind: "event", event: log.at(-1) }]);
  });

  it("shows each seat's role and a claim next to the truth (design §11.3, §15.5)", () => {
    const log: GameEvent[] = [
      dealt("p0", "mole"),
      dealt("p1", "lookout"),
      started(2),
      { type: "said", visibility: PUBLIC, statement: { kind: "role", player: "p0", role: "lookout", stretch: 1 } },
    ];
    const outcome: Outcome = { result: "failed", reason: "theft", ranking: [rank("p0", "mole", 9), rank("p1", "lookout", 3)], winners: ["p0"], getaway: 0 };
    const s = revealSummary(log, outcome);
    expect(s.seats.map((x) => [x.player, x.dealtRole, x.role, x.winner])).toEqual([
      ["p0", "mole", "mole", true],
      ["p1", "lookout", "lookout", false],
    ]);
    const items = s.rounds[0]?.items ?? [];
    expect(items).toContainEqual({ kind: "claim", player: "p0", claimed: "lookout", real: "mole" });
    expect(s.ending).toEqual({ result: "failed", reason: "theft", topGroup: ["p0"], winners: ["p0"], why: "failedTopWins" });
  });

  it("says who won and why: the top group on a success, a Mole or Fixer at the top or nobody on a failure (design §8)", () => {
    const tied = [rank("p0", "lookout", 5), rank("p1", "lookout", 5), rank("p2", "mole", 1)];
    expect(revealSummary(SETUP, { result: "success", ranking: tied, winners: ["p0", "p1"], getaway: 0 }).ending).toMatchObject({ topGroup: ["p0", "p1"], why: "success" });
    const nobody = revealSummary(SETUP, { result: "failed", reason: "theft", ranking: tied, winners: [], getaway: 0 });
    expect(nobody.ending).toEqual({ result: "failed", reason: "theft", topGroup: ["p0", "p1"], winners: [], why: "failedNobody" });
    expect(nobody.seats.map((x) => [x.place, x.topGroup, x.winner])).toEqual([
      [1, true, false],
      [2, true, false],
      [3, false, false],
    ]);
  });
});

describe("reveal summary leaks nothing — design §13, §11.2, §17.2", () => {
  // design §18: a secret ballot never opens, not even at the reveal; the timeline shows the meeting's result and nothing of who voted for whom.
  it("never shows a Secret-mode ballot (design §18)", () => {
    const log: GameEvent[] = [
      ...SETUP,
      started(1),
      { type: "voteCast", visibility: secretTo("p0"), meetingId: "m1", player: "p0", vote: { kind: "shakedown", target: "p2" }, sealed: false },
      { type: "meetingClosed", visibility: PUBLIC, meetingId: "m1", tally: { skip: 0, targets: { p2: 1 } }, ballots: null, result: { kind: "shakedown", target: "p2" } },
    ];
    const items = revealSummary(log, success([rank("p0", "mole", 0)])).rounds[0]?.items ?? [];
    expect(items.map((i) => (i.kind === "event" ? i.event.type : i.kind))).toEqual(["meetingClosed"]);
    expect(JSON.stringify(items)).not.toContain("voteCast");
  });

  it("is not in any view before the game ends", () => {
    const cfg: GameConfig = {
      seed: "reveal-null",
      players: [0, 1, 2, 3].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
      job: "bank",
      eventsEnabled: true,
      voteVisibility: "secret",
    };
    const state = createGame(cfg);
    for (const p of state.playerOrder) expect(viewFor(state, p).reveal).toBeNull();
  });
});
