// The end-of-game reveal summary (design §13; extension.md "Winning and
// losing", "Tokens and the perk shop", "Police activity", "Situations").
import { describe, expect, it } from "vitest";
import { EVENTS, ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent, Outcome, RankEntry } from "./types";
import { PUBLIC, REVEAL, privateTo, secretTo } from "./types";
import { revealSummary } from "./reveal";
import { createGame } from "./setup";
import { viewFor } from "./view";

const TABLES = { roles: ROLES, events: EVENTS };

const dealt = (player: string, role: string): GameEvent => ({ type: "roleDealt", visibility: privateTo(player), player, role });
const started = (round: number): GameEvent => ({ type: "roundStarted", visibility: PUBLIC, round, act: 1 });
const split = (player: string, round: number, room: string, loot: number, toStash: number): GameEvent => ({
  type: "lootSplit",
  visibility: privateTo(player),
  player,
  round,
  room,
  loot,
  toHaul: loot - toStash,
  toStash,
});
const rank = (player: string, role: string, score: number, extra: Partial<RankEntry> = {}): RankEntry => ({
  player,
  role,
  score,
  stash: score,
  safe: 0,
  timesShakenDown: 0,
  totalHandedIn: 0,
  ...extra,
});

/** A three-seat game: p0 Mole, p1 Hacker, p2 Rookie with Security. */
const SETUP: GameEvent[] = [dealt("p0", "mole"), dealt("p1", "hacker"), dealt("p2", "rookie")];
const success = (ranking: RankEntry[]): Outcome => ({ result: "success", ranking, winners: [ranking[0]?.player ?? ""] });

describe("reveal summary — design §13", () => {
  it("tells a police patrol from a Mole's tip-off (extension.md \"Police activity\")", () => {
    const log: GameEvent[] = [
      ...SETUP,
      started(1),
      { type: "abilityResolved", visibility: privateTo("p0"), player: "p0", round: 1, ability: { kind: "tipOff" } },
      { type: "policeActivity", visibility: PUBLIC, round: 1, heatAdded: 8, heat: 30 },
      { type: "policeCause", visibility: REVEAL, round: 1, cause: "patrol", mole: null },
      { type: "policeActivity", visibility: PUBLIC, round: 1, heatAdded: 8, heat: 38 },
      { type: "policeCause", visibility: REVEAL, round: 1, cause: "tipOff", mole: "p0" },
      { type: "tipOffLanded", visibility: privateTo("p0"), player: "p0", round: 1 },
    ];
    const s = revealSummary(log, success([rank("p0", "mole", 0)]), TABLES);
    const police = s.rounds[0]?.items.filter((i) => i.kind === "police");
    expect(police).toEqual([
      { kind: "police", heatAdded: 8, heat: 30, cause: "patrol", mole: null },
      { kind: "police", heatAdded: 8, heat: 38, cause: "tipOff", mole: "p0" },
    ]);
  });

  it("tells a Hacker's loop from a Power cut on \"camera offline\" (extension.md \"Situations\")", () => {
    const watched = (round: number): GameEvent => ({ type: "roomWatched", visibility: privateTo("p2"), player: "p2", round, source: "security", room: "vault", seen: [], offline: true });
    const log: GameEvent[] = [
      ...SETUP,
      started(1),
      { type: "abilityResolved", visibility: privateTo("p1"), player: "p1", round: 1, ability: { kind: "loopCameras", room: "vault" } },
      watched(1),
      started(2),
      { type: "eventFlipped", visibility: PUBLIC, round: 2, card: "powerCut", room: null },
      { type: "abilityResolved", visibility: privateTo("p1"), player: "p1", round: 2, ability: { kind: "loopCameras", room: "vault" } },
      watched(2),
    ];
    const s = revealSummary(log, success([rank("p1", "hacker", 0)]), TABLES);
    const offline = s.rounds.map((r) => r.items.filter((i) => i.kind === "cameraOffline"));
    expect(offline).toEqual([
      [{ kind: "cameraOffline", watcher: "p2", room: "vault", source: "security", cause: "hackerLoop", hackers: ["p1"] }],
      [{ kind: "cameraOffline", watcher: "p2", room: "vault", source: "security", cause: "powerCut", hackers: [] }],
    ]);
    expect(s.rounds[1]?.card).toEqual({ id: "powerCut", room: null });
  });

  it("marks a Blackmailer's stolen votes from votesStolen, decided or not, with or without its token (ruling 5)", () => {
    const closed = (id: string): GameEvent => ({ type: "meetingClosed", visibility: PUBLIC, meetingId: id, tally: { skip: 0, targets: { p1: 2 } }, ballots: null, result: { kind: "shakedown", target: "p1" } });
    const log: GameEvent[] = [
      dealt("p0", "blackmailer"),
      dealt("p1", "rookie"),
      started(1),
      { type: "abilityResolved", visibility: privateTo("p0"), player: "p0", round: 1, ability: { kind: "blackmail", target: "p1", role: "rookie", correct: true } },
      { type: "voteCompromised", visibility: privateTo("p1"), player: "p1", round: 1 },
      { type: "meetingOpened", visibility: PUBLIC, meetingId: "m1", kind: "regular", act: 1 },
      closed("m1"),
      { type: "votesStolen", visibility: REVEAL, meetingId: "m1", steals: [{ victim: "p1", blackmailer: "p0", decided: true }] },
      { type: "tokenEarned", visibility: privateTo("p0"), player: "p0", trigger: "stolenVoteDecided" },
      started(2),
      // A Double-cross moved the role away: the steal still decided it, but nobody earns the token.
      { type: "doubleCrossResolved", visibility: privateTo("p0"), player: "p0", round: 2, partner: "p1", swap: { role: "rookie", roleState: { usedThisAct: 0, usedThisGame: 0, target: null, tokens: 1, perks: [], tail: null } } },
      { type: "meetingOpened", visibility: PUBLIC, meetingId: "m2", kind: "regular", act: 2 },
      closed("m2"),
      { type: "votesStolen", visibility: REVEAL, meetingId: "m2", steals: [{ victim: "p1", blackmailer: "p0", decided: true }] },
    ];
    const s = revealSummary(log, success([rank("p0", "rookie", 0), rank("p1", "rookie", 0)]), TABLES);
    const stolen = (r: number) => (s.rounds[r]?.items ?? []).filter((i) => i.kind === "voteStolen");
    expect(stolen(0)).toEqual([{ kind: "voteStolen", blackmailer: "p0", victim: "p1", meetingId: "m1", decided: true }]);
    expect(stolen(1)).toEqual([{ kind: "voteStolen", blackmailer: "p0", victim: "p1", meetingId: "m2", decided: true }]);
    expect(s.seats[0]?.tokens).toEqual(["stolenVoteDecided"]);
  });

  it("puts tokens, perks and forged sightings in the round they happened, and tracks every stash (extension.md \"Tokens and the perk shop\")", () => {
    const log: GameEvent[] = [
      ...SETUP,
      { type: "snitchTargetAssigned", visibility: privateTo("p2"), player: "p2", target: "p0" },
      started(1),
      split("p0", 1, "vault", 10, 4),
      split("p1", 1, "lobby", 6, 0),
      split("p2", 1, "security", 0, 0),
      { type: "alibiPosted", visibility: PUBLIC, player: "p0", round: 1, room: "lobby" },
      { type: "sightingForged", visibility: REVEAL, forger: "p1", round: 1, target: "p0", room: "lobby", shownTo: ["p2"] },
      { type: "roundResolved", visibility: PUBLIC, round: 1, haulDelta: 12, haul: 12, heatDelta: 5, heat: 25, heatParts: { base: 5, rooms: {}, events: 0 } },
      { type: "tokenEarned", visibility: privateTo("p2"), player: "p2", trigger: "checkpointMade" },
      started(2),
      { type: "defaultMoveAssigned", visibility: privateTo("p2"), player: "p2", round: 2, move: { room: "lobby", pocket: 0 } },
      split("p0", 2, "vault", 10, 10),
      split("p1", 2, "lobby", 6, 0),
      split("p2", 2, "lobby", 6, 0),
      { type: "abilityResolved", visibility: privateTo("p0"), player: "p0", round: 2, ability: { kind: "fenceSafe", amount: 5 } },
      { type: "perkBought", visibility: privateTo("p2"), player: "p2", perk: "peek", cost: 1 },
      { type: "perkUsed", visibility: privateTo("p2"), player: "p2", round: 2, perk: { kind: "peek", target: "p0", role: "mole" } },
      { type: "meetingOpened", visibility: PUBLIC, meetingId: "m1", kind: "regular", act: 1 },
      { type: "voteSealed", visibility: secretTo("p1"), player: "p1", vote: { kind: "skip" } } as GameEvent,
      { type: "shakedownResolved", visibility: PUBLIC, meetingId: "m1", target: "p0", stashRevealed: 9, safeRevealed: 5, taken: 9, clean: false, compensation: 0 },
    ];
    const ranking = [rank("p0", "mole", 5, { safe: 5 }), rank("p2", "rookie", 2), rank("p1", "hacker", 0)];
    const s = revealSummary(log, success(ranking), TABLES);
    expect(s.rounds.map((r) => r.round)).toEqual([0, 1, 2]);
    expect(s.rounds[0]?.items).toEqual([{ kind: "event", event: log[3] }]);
    expect(s.rounds[1]?.moves).toEqual([
      { player: "p0", room: "vault", loot: 10, toHaul: 6, toStash: 4, missed: false, alibi: "lobby" },
      { player: "p1", room: "lobby", loot: 6, toHaul: 6, toStash: 0, missed: false, alibi: null },
      { player: "p2", room: "security", loot: 0, toHaul: 0, toStash: 0, missed: false, alibi: null },
    ]);
    expect(s.rounds[2]?.moves.find((m) => m.player === "p2")?.missed).toBe(true);
    expect(s.rounds[1]?.items.map((i) => i.kind)).toEqual(["event", "token"]);
    expect(s.rounds[1]?.resolved).toEqual({ haulDelta: 12, haul: 12, heatDelta: 5, heat: 25 });
    expect(s.rounds[2]?.items.map((i) => (i.kind === "event" ? i.event.type : i.kind))).toEqual([
      "abilityResolved",
      "perkBought",
      "perkUsed",
      "shakedownResolved",
    ]);
    // Stash with the safe: p0 4, then 14 (the Fence safe moves nothing out), then shaken down for 9.
    expect(s.rounds[1]?.stashes).toEqual({ p0: 4, p1: 0, p2: 0 });
    expect(s.rounds[2]?.stashes).toEqual({ p0: 5, p1: 0, p2: 0 });
    expect(s.seats.find((x) => x.player === "p2")).toMatchObject({ tokens: ["checkpointMade"], perksBought: ["peek"], perksUsed: 1 });
  });

  it("follows a Double-cross swap: dealt role, end role, and its winsOn (design §10)", () => {
    const log: GameEvent[] = [
      dealt("p0", "mole"),
      dealt("p1", "rookie"),
      started(2),
      { type: "roleClaimed", visibility: PUBLIC, player: "p0", role: "rookie", act: 1 },
      { type: "doubleCrossResolved", visibility: privateTo("p0"), player: "p0", round: 2, partner: "p1", swap: { role: "rookie", roleState: { usedThisAct: 0, usedThisGame: 0 } } } as GameEvent,
      { type: "doubleCrossResolved", visibility: privateTo("p1"), player: "p1", round: 2, partner: "p0", swap: { role: "mole", roleState: { usedThisAct: 0, usedThisGame: 0 } } } as GameEvent,
    ];
    const outcome: Outcome = { result: "failed", reason: "heat", ranking: [rank("p1", "mole", 9), rank("p0", "rookie", 3)], winners: ["p1"] };
    const s = revealSummary(log, outcome, TABLES);
    expect(s.seats.map((x) => [x.player, x.dealtRole, x.role, x.winsOn, x.winner])).toEqual([
      ["p1", "rookie", "mole", ROLES.mole?.winsOn, true],
      ["p0", "mole", "rookie", [], false],
    ]);
    const items = s.rounds[0]?.items ?? [];
    expect(items).toContainEqual({ kind: "claim", player: "p0", claimed: "rookie", real: "mole" });
    expect(items.filter((i) => i.kind === "doubleCross")).toEqual([{ kind: "doubleCross", players: ["p0", "p1"], swapped: true }]);
    expect(s.ending).toEqual({ result: "failed", reason: "heat", topGroup: ["p1"], winners: ["p1"], why: "failedTopWins" });
  });

  it("says who won and why: the top group on a success, ★ roles or nobody on a failure (extension.md \"Winning and losing\")", () => {
    const tied = [rank("p0", "rookie", 5), rank("p1", "rookie", 5), rank("p2", "mole", 1)];
    expect(revealSummary(SETUP, { result: "success", ranking: tied, winners: ["p0", "p1"] }, TABLES).ending).toMatchObject({ topGroup: ["p0", "p1"], why: "success" });
    const nobody = revealSummary(SETUP, { result: "failed", reason: "target", ranking: tied, winners: [] }, TABLES);
    expect(nobody.ending).toEqual({ result: "failed", reason: "target", topGroup: ["p0", "p1"], winners: [], why: "failedNobody" });
    expect(nobody.seats.map((x) => [x.place, x.topGroup, x.winner])).toEqual([
      [1, true, false],
      [2, true, false],
      [3, false, false],
    ]);
  });
});

describe("reveal summary leaks nothing — design §13, §11.2, §17.2", () => {
  it("is not in any view before the game ends", () => {
    const cfg: GameConfig = {
      seed: "reveal-null",
      players: [0, 1, 2, 3].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
      job: "bank",
      rolePool: [],
      eventsEnabled: true,
      voteVisibility: "secret",
      starterMode: false,
    };
    const state = createGame(cfg);
    for (const p of state.playerOrder) expect(viewFor(state, p).reveal).toBeNull();
  });

});
