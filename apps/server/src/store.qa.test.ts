// QA (PR #16, M2-1): store round-trips at 2/6/12 players, every event type
// through the json column, concurrent appends, rollback, concurrent migrate.
// design §17.2 (event-sourced, deterministic), §17.5; docs/m2-plan.md M2-1
import { createBots, PERSONALITIES, runBotGame, type PersonalityId } from "@skimjob/bots";
import { replay, type GameConfig, type GameEvent, type GameState } from "@skimjob/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sampleEvents } from "../../../packages/engine/src/types/samples";
import type { Db, Queryable } from "./db";
import { migrate } from "./migrate";
import { createGameStore, type GameStore } from "./store";
import { freshDb, insertUser, testDb } from "./testkit";

const MIX: PersonalityId[] = ["honest", "opportunist", "cautious", "greedy", "random"];

function config(n: number, seed: string, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    mole: "on",
    eventsEnabled: true,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    ...extra,
  };
}

const played = new Map<string, GameState>();
function botGame(c: GameConfig): GameState {
  const hit = played.get(c.seed);
  if (hit) return hit;
  const result = runBotGame(c, createBots(c.players, (_, i) => PERSONALITIES[MIX[i % MIX.length]!], `bots-${c.seed}`));
  expect(result.state.phase.kind).toBe("ended");
  played.set(c.seed, result.state);
  return result.state;
}

let db: Db;
let store: GameStore;
let host: string;
let n = 0;
const newGame = (s: GameStore = store) => s.create({ hostUserId: host, inviteCode: `QA${n++}` });
const idxs = async (id: string) =>
  (await db.query<{ idx: number }>("select idx from game_events where game_id = $1 order by idx", [id])).map((r) => r.idx);
const status = async (id: string) => (await db.query<{ status: string }>("select status from games where id = $1", [id]))[0]?.status;
const contiguous = (xs: number[]) => xs.every((x, i) => x === i);

beforeAll(async () => {
  db = await testDb();
  store = createGameStore(db);
  host = await insertUser(db);
}, 60_000);
afterAll(() => db.close());

describe("QA: round-trips at 2 / 6 / 12 players — design §17.2", () => {
  const allRoles = ["rookie", "lookout", "insideMan", "fence", "hacker", "smoothTalker", "muscle", "blackmailer", "snitch", "auditor", "detective", "bagman", "cleaner", "priest", "fixer", "mastermind"];
  it.each([
    ["2 players (not Duel)", config(2, "qa-2", { mole: "off" })],
    ["6 players, full role pool, Open votes", config(6, "qa-6", { rolePool: allRoles, voteVisibility: "open" })],
    ["12 players, Secret votes, Mole maybe", config(12, "qa-12", { voteVisibility: "secret", mole: "maybe" })],
  ])("saved in uneven batches and reloaded by a fresh store is the same game (%s)", { timeout: 60_000 }, async (_name, c) => {
    const game = botGame(c);
    const id = await newGame();
    const started = await store.start(id, c);
    let at = started.log.length;
    // Batch sizes 1..7 cycling, so batch boundaries fall everywhere.
    for (let k = 1; at < game.log.length; k = (k % 7) + 1) {
      await store.append(id, game.log.slice(at, at + k));
      at += k;
    }
    expect(contiguous(await idxs(id))).toBe(true);
    expect((await idxs(id)).length).toBe(game.log.length);
    expect(await status(id)).toBe("ended");
    const reloaded = await createGameStore(db).load(id);
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify(game));
    expect(reloaded).toEqual(replay(c, game.log));
    const rows = await db.query<{ text: string }>("select event::text as text from game_events where game_id = $1 order by idx", [id]);
    expect(rows.map((r) => r.text)).toEqual(game.log.map((e) => JSON.stringify(e)));
  });

  it("a whole 12-player log stored as one batch reloads the same", { timeout: 60_000 }, async () => {
    const c = config(12, "qa-12", { voteVisibility: "secret", mole: "maybe" });
    const game = botGame(c);
    const id = await newGame();
    const started = await store.start(id, c);
    await store.append(id, game.log.slice(started.log.length));
    expect(JSON.stringify(await createGameStore(db).load(id))).toBe(JSON.stringify(game));
  });

  it("every event type survives the json column byte for byte and deep-equal", async () => {
    const id = await newGame();
    // A running game row to hang raw events on (the store would fold them; samples don't fold in order).
    await store.start(id, config(3, "qa-samples"));
    await db.query("delete from game_events where game_id = $1", [id]);
    const samples = Object.values(sampleEvents) as GameEvent[];
    await db.query(
      "insert into game_events (game_id, idx, event) select $1, t.ord::int - 1, t.e from json_array_elements($2::json) with ordinality as t(e, ord)",
      [id, JSON.stringify(samples)],
    );
    const rows = await db.query<{ event: GameEvent; text: string }>(
      "select event, event::text as text from game_events where game_id = $1 order by idx",
      [id],
    );
    expect(rows.map((r) => r.text)).toEqual(samples.map((e) => JSON.stringify(e)));
    expect(rows.map((r) => r.event)).toEqual(samples);
  });
});

describe("QA: concurrent appends to one game", () => {
  it("two unlocked appends at the same position: one wins, no duplicate, no gap", { timeout: 30_000 }, async () => {
    const c = config(4, "qa-race");
    const game = botGame(c);
    const id = await newGame();
    const started = await store.start(id, c);
    const at = started.log.length;
    const results = await Promise.allSettled([
      store.append(id, game.log.slice(at, at + 1)),
      store.append(id, game.log.slice(at, at + 3)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const stored = await idxs(id);
    expect(contiguous(stored)).toBe(true);
    expect([at + 1, at + 3]).toContain(stored.length);
    // Whatever the cache says now, it agrees with the database.
    expect(await store.load(id)).toEqual(await createGameStore(db).load(id));
    expect((await store.load(id))!.log.length).toBe(stored.length);
  });

  it("two stores (two processes) on one game: the stale one is refused and then re-reads", { timeout: 30_000 }, async () => {
    const c = config(4, "qa-two-stores");
    const game = botGame(c);
    const a = createGameStore(db);
    const b = createGameStore(db);
    const id = await newGame(a);
    const started = await a.start(id, c);
    const at = started.log.length;
    expect(await b.load(id)).toEqual(started); // b caches the same state
    await a.append(id, game.log.slice(at, at + 2));
    await expect(b.append(id, game.log.slice(at, at + 1))).rejects.toThrow();
    expect(await idxs(id)).toHaveLength(at + 2);
    const reread = await b.load(id);
    expect(reread!.log).toEqual(game.log.slice(0, at + 2));
    // and b can carry on from the truth
    await b.append(id, game.log.slice(at + 2, at + 4));
    expect(contiguous(await idxs(id))).toBe(true);
    expect(await createGameStore(db).load(id)).toEqual(replay(c, game.log.slice(0, at + 4)));
  });

  it("many appends under withGameLock land in order with no gaps", { timeout: 30_000 }, async () => {
    const c = config(5, "qa-locked");
    const game = botGame(c);
    const id = await newGame();
    const started = await store.start(id, c);
    const rest = game.log.slice(started.log.length);
    await Promise.all(rest.map((e) => store.withGameLock(id, () => store.append(id, [e]))));
    expect(contiguous(await idxs(id))).toBe(true);
    expect(JSON.stringify(await createGameStore(db).load(id))).toBe(JSON.stringify(game));
    expect(await status(id)).toBe("ended");
  });

  it("rolls the events back when the status update fails, including on the game-ending event", { timeout: 30_000 }, async () => {
    const c = config(3, "qa-rollback");
    const game = botGame(c);
    let fail = true;
    const failing = (tx: Queryable): Queryable => ({
      ...tx,
      query: (sql, params) => (fail && /^update games set status/.test(sql) ? Promise.reject(new Error("boom")) : tx.query(sql, params)),
    });
    const flaky: Db = { ...db, transaction: (fn) => db.transaction((tx) => fn(failing(tx))) };
    const s = createGameStore(flaky);
    const id = await newGame(s);
    fail = false;
    const started = await s.start(id, c);
    const at = started.log.length;
    await s.append(id, game.log.slice(at, game.log.length - 1));
    fail = true;
    await expect(s.append(id, game.log.slice(-1))).rejects.toThrow("boom");
    expect(await idxs(id)).toHaveLength(game.log.length - 1);
    expect(await status(id)).toBe("running");
    expect((await s.load(id))!.phase.kind).not.toBe("ended");
    fail = false;
    await s.append(id, game.log.slice(-1));
    expect(await status(id)).toBe("ended");
    expect(JSON.stringify(await createGameStore(db).load(id))).toBe(JSON.stringify(game));
  });
});

describe("QA: migrations", () => {
  it("two migrators at once on a fresh database: one applies, the other finds nothing to do", { timeout: 60_000 }, async () => {
    const fresh = await freshDb();
    try {
      const runs = await Promise.all([migrate(fresh), migrate(fresh), migrate(fresh)]);
      const all = ["001_init.sql", "002_identity.sql", "003_chat.sql", "004_deadline_pause.sql", "005_bot_seen.sql", "006_seat_last_seen.sql"];
      expect(runs.flat().sort()).toEqual(all);
      expect(await fresh.query("select version from schema_migrations order by version")).toEqual(all.map((version) => ({ version })));
      expect(await migrate(fresh)).toEqual([]);
    } finally {
      await fresh.close();
    }
  });
});
