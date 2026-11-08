// GameStore: the event log in the database, state = replay(log).
// design §17.2 (event-sourced, deterministic), §17.5 (server stores the logs)
import { createBots, PERSONALITIES, runBotGame, type PersonalityId } from "@skimjob/bots";
import { replay, type GameConfig, type GameEvent, type GameState } from "@skimjob/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import { createGameStore, type GameStore } from "./store";
import { insertUser, testDb } from "./testkit";

const MIX: PersonalityId[] = ["honest", "opportunist", "cautious", "greedy", "random"];

function config(n: number, seed: string, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: true,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  };
}

function botGame(c: GameConfig): GameState {
  const result = runBotGame(c, createBots(c.players, (_, i) => PERSONALITIES[MIX[i % MIX.length]!], `bots-${c.seed}`));
  expect(result.state.phase.kind).toBe("ended");
  return result.state;
}

let db: Db;
let store: GameStore;
let host: string;
let n = 0;
const newGame = () => store.create({ hostUserId: host, inviteCode: `INV${n++}` });
const status = async (id: string) => (await db.query<{ status: string }>("select status from games where id = $1", [id]))[0]?.status;
const eventCount = async (id: string) => (await db.query<{ n: number }>("select count(*)::int as n from game_events where game_id = $1", [id]))[0]?.n;

beforeAll(async () => {
  db = await testDb();
  store = createGameStore(db);
  host = await insertUser(db);
}, 30_000);
afterAll(() => db.close());

describe("GameStore — design §17.2", () => {
  it.each([
    ["5 players, Mole and events", config(5, "store-5")],
    ["9 players, Secret votes", config(9, "store-9", { voteVisibility: "secret" })],
  ])("a bot game saved event by event and reloaded is the same game (%s)", { timeout: 30_000 }, async (_name, c) => {
    const played = botGame(c);
    const id = await newGame();
    expect(await status(id)).toBe("lobby");

    const started = await store.start(id, c);
    expect(played.log.slice(0, started.log.length)).toEqual(started.log);
    for (const event of played.log.slice(started.log.length)) await store.append(id, [event]);

    expect(await status(id)).toBe("ended");
    expect(await eventCount(id)).toBe(played.log.length);
    // A new store has no cache: this is a replay of what the database holds.
    const reloaded = await createGameStore(db).load(id);
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify(played));
    expect(reloaded).toEqual(replay(c, played.log));
  });

  it("keeps events byte for byte (json, not jsonb, which re-sorts keys)", async () => {
    const c = config(4, "bytes");
    const id = await newGame();
    const started = await store.start(id, c);
    const rows = await db.query<{ text: string }>("select event::text as text from game_events where game_id = $1 order by idx", [id]);
    expect(rows.map((r) => r.text)).toEqual(started.log.map((e) => JSON.stringify(e)));
    const [row] = await db.query<{ text: string }>("select config::text as text from games where id = $1", [id]);
    expect(row?.text).toBe(JSON.stringify(c));
  });

  it("stores a batch of events all or none", { timeout: 30_000 }, async () => {
    const c = config(4, "atomic");
    const played = botGame(c);
    const id = await newGame();
    const started = await store.start(id, c);
    const at = started.log.length;
    // Someone else already wrote position at + 1: the batch must fail as a whole.
    await db.query("insert into game_events (game_id, idx, event) values ($1, $2, '{}')", [id, at + 1]);
    await expect(store.append(id, played.log.slice(at, at + 3))).rejects.toThrow();
    expect(await eventCount(id)).toBe(at + 1);
    expect(await db.query("select idx from game_events where game_id = $1 and idx = $2", [id, at])).toEqual([]);
    expect(await status(id)).toBe("running");
  });

  it("refuses to fold an event the engine can't apply, before writing anything", async () => {
    const id = await newGame();
    const started = await store.start(id, config(3, "bad-event"));
    await expect(store.append(id, [{ type: "noSuchEvent" } as unknown as GameEvent])).rejects.toThrow();
    expect(await eventCount(id)).toBe(started.log.length);
    expect(await store.load(id)).toBe(started);
  });

  it("appending nothing is a no-op", async () => {
    const id = await newGame();
    const started = await store.start(id, config(3, "noop"));
    expect(await store.append(id, [])).toBe(started);
  });

  it("starts a game only once, only from the lobby, and only with a valid config", async () => {
    const id = await newGame();
    await expect(store.start(id, config(1, "too-few"))).rejects.toThrow();
    expect(await status(id)).toBe("lobby");
    expect(await eventCount(id)).toBe(0);
    await store.start(id, config(3, "once"));
    await expect(store.start(id, config(3, "twice"))).rejects.toThrow(/not in the lobby/);
    await expect(store.start("00000000-0000-0000-0000-000000000000", config(3, "ghost"))).rejects.toThrow(/not in the lobby/);
  });

  it("loads nothing for a lobby game, an unknown id or a malformed id", async () => {
    const id = await newGame();
    expect(await store.load(id)).toBeNull();
    expect(await store.load("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await store.load("not-a-uuid'; --")).toBeNull();
    await expect(store.append(id, [])).rejects.toThrow(/has not started/);
  });

  it("serves the cache, and re-reads the database after a failed append", async () => {
    const id = await newGame();
    const started = await store.start(id, config(3, "cache"));
    expect(await store.load(id)).toBe(started);
    await db.query("insert into game_events (game_id, idx, event) values ($1, $2, '{}')", [id, started.log.length]);
    await expect(store.append(id, [started.log[0]!])).rejects.toThrow();
    await db.query("delete from game_events where game_id = $1 and idx = $2", [id, started.log.length]);
    const reread = await store.load(id);
    expect(reread).not.toBe(started);
    expect(reread).toEqual(started);
  });

  it("runs one locked task per game at a time, and other games don't wait", async () => {
    const order: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const a1 = store.withGameLock("a", async () => {
      order.push("a1 start");
      await gate;
      order.push("a1 end");
      return 1;
    });
    const a2 = store.withGameLock("a", async () => {
      order.push("a2");
      throw new Error("a2 fails");
    });
    const a3 = store.withGameLock("a", async () => {
      order.push("a3");
      return 3;
    });
    const b = store.withGameLock("b", async () => {
      order.push("b");
      return "b";
    });
    expect(await b).toBe("b");
    open();
    expect(await a1).toBe(1);
    await expect(a2).rejects.toThrow("a2 fails");
    expect(await a3).toBe(3);
    expect(order).toEqual(["a1 start", "b", "a1 end", "a2", "a3"]);
  });
});
