// The end-of-game reveal summary (design §13; extension.md "Winning and
// losing", "Tokens and the perk shop", "Police activity", "Situations").
import { describe, expect, it } from "vitest";
import { ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent, Outcome, RankEntry } from "./types";
import { PUBLIC, REVEAL, privateTo, secretTo } from "./types";
import { revealSummary } from "./reveal";
import { createGame } from "./setup";
import { viewFor } from "./view";

const TABLES = { roles: ROLES };

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

  it("shows who looped a feed that read \"camera offline\" (extension.md \"Situations\")", () => {
    const watched = (round: number): GameEvent => ({ type: "roomWatched", visibility: privateTo("p2"), player: "p2", round, source: "security", room: "vault", seen: [], offline: true });
    const log: GameEvent[] = [
      ...SETUP,
      started(1),
      { type: "abilityResolved", visibility: privateTo("p1"), player: "p1", round: 1, ability: { kind: "loopCameras", room: "vault" } },
      watched(1),
    ];
    const s = revealSummary(log, success([rank("p1", "hacker", 0)]), TABLES);
    const offline = s.rounds.map((r) => r.items.filter((i) => i.kind === "cameraOffline"));
    expect(offline).toEqual([
      [{ kind: "cameraOffline", watcher: "p2", room: "vault", source: "security", hackers: ["p1"] }],
    ]);
  });

  it("shows each seat's role, its winsOn and a claim next to the truth (design §10)", () => {
    const log: GameEvent[] = [
      dealt("p0", "mole"),
      dealt("p1", "rookie"),
      started(2),
      { type: "roleClaimed", visibility: PUBLIC, player: "p0", role: "rookie", act: 1 },
    ];
    const outcome: Outcome = { result: "failed", reason: "heat", ranking: [rank("p0", "mole", 9), rank("p1", "rookie", 3)], winners: ["p0"] };
    const s = revealSummary(log, outcome, TABLES);
    expect(s.seats.map((x) => [x.player, x.dealtRole, x.role, x.winsOn, x.winner])).toEqual([
      ["p0", "mole", "mole", ROLES.mole?.winsOn, true],
      ["p1", "rookie", "rookie", [], false],
    ]);
    const items = s.rounds[0]?.items ?? [];
    expect(items).toContainEqual({ kind: "claim", player: "p0", claimed: "rookie", real: "mole" });
    expect(s.ending).toEqual({ result: "failed", reason: "heat", topGroup: ["p0"], winners: ["p0"], why: "failedTopWins" });
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
    };
    const state = createGame(cfg);
    for (const p of state.playerOrder) expect(viewFor(state, p).reveal).toBeNull();
  });
});
