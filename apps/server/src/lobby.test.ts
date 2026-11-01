// Identity, invites and lobby API. docs/m2-plan.md M2-2; design §15 setup, §16
import { isSafePlayerId } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devAuthProvider, SESSION_COOKIE } from "./auth";
import { fakeClock, type FakeClock } from "./clock";
import type { Db } from "./db";
import { playerIdOf, type LobbyView } from "./lobby";
import { buildServer } from "./server";
import { DEFAULT_SETTINGS, SESSION_TTL_MS } from "./settings";
import { createGameStore, type GameStore } from "./store";
import { testDb } from "./testkit";

let db: Db;
let app: FastifyInstance;
let clock: FakeClock;
let store: GameStore;
beforeAll(async () => {
  db = await testDb();
  clock = fakeClock(Date.UTC(2026, 10, 1));
  store = createGameStore(db);
  app = buildServer({ db, clock, store, auth: [devAuthProvider()] });
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

type Who = string | null; // a session token
const call = async (method: "GET" | "POST" | "DELETE" | "PATCH", url: string, who: Who = null, payload?: Record<string, unknown>) => {
  const cookies: Record<string, string> = who ? { [SESSION_COOKIE]: who } : {};
  const res = await app.inject(payload ? { method, url, payload, cookies } : { method, url, cookies });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
  return { status: res.statusCode, body: res.json() as Record<string, unknown> & Partial<LobbyView>, session: set ?? null, res };
};
const guest = async (nickname: string) => (await call("POST", "/auth/guest", null, { nickname })).session!;
const host = async (settings?: object) => {
  const who = await guest("Karthik");
  const res = await call("POST", "/games", who, settings ? { settings } : {});
  expect(res.status).toBe(201);
  return { who, game: res.body as unknown as LobbyView };
};
const join = async (code: string, nickname: string, who: Who = null) => call("POST", `/invites/${code}/join`, who, { nickname });

describe("guest sign-in (invite link + nickname)", () => {
  it("makes a guest user and an httpOnly SameSite=Lax session cookie; the DB keeps only a hash", async () => {
    const res = await call("POST", "/auth/guest", null, { nickname: "  Zoë   the 🦝 " });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: "Zoë the 🦝", guest: true });
    const cookie = res.res.cookies.find((c) => c.name === SESSION_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    const count = async (sql: string) => (await db.query<{ n: number }>(`select count(*)::int as n from sessions where ${sql}`, [cookie.value]))[0]!.n;
    expect(await count("token_hash = sha256(convert_to($1, 'UTF8'))")).toBe(1);
    expect(await count("token_hash = convert_to($1, 'UTF8')")).toBe(0);
    expect((await call("GET", "/me", cookie.value)).body.user).toMatchObject({ name: "Zoë the 🦝", guest: true });
  });

  it.each([
    [""],
    ["   "],
    ["x".repeat(25)],
    ["bad\u0000name"],
    [42],
    [null],
    ["\u200b"], // zero-width space only
    ["a\u202eb"], // bidi override
    ["a\u2066b\u2069"], // bidi isolates
    ["\u3164"], // Hangul filler (blank letter)
    ["a\u00adb"], // soft hyphen (invisible)
    ["\u200d"], // lone zero-width joiner
    ["\ufe0f"], // lone variation selector 16
    ["\u0301"], // bare combining mark
    ["\u034f \u200d \ufe0f"], // only invisible characters and spaces
    ["B\u200dot · Riya"], // a bot name with a ZWJ hidden in it
    ["Bot · Riya"],
    ["bot-riya"],
    ["BOT: Max"],
    ["Bot•Max"],
    ["ＢＯＴ · Max"], // fullwidth
    ["Bot"],
  ])("refuses nickname %j", async (nickname) => {
    expect((await call("POST", "/auth/guest", null, { nickname })).status).toBe(400);
  });

  it("allows names that merely start with the letters b-o-t, and emoji joined with ZWJ", async () => {
    for (const nickname of ["Botswana Bob", "Bottle", "👨\u200d👩\u200d👧"]) {
      expect((await call("POST", "/auth/guest", null, { nickname })).status).toBe(200);
    }
  });

  it("401s /me without a session, with a bogus one, after logout and after expiry", async () => {
    expect((await call("GET", "/me")).status).toBe(401);
    expect((await call("GET", "/me", "nonsense")).status).toBe(401);
    const a = await guest("A");
    await call("POST", "/auth/logout", a);
    expect((await call("GET", "/me", a)).status).toBe(401);
    const b = await guest("B");
    clock.advance(SESSION_TTL_MS + 1);
    expect((await call("GET", "/me", b)).status).toBe(401);
  });
});

describe("dev sign-in stub (stands in for Google until M2-12)", () => {
  const signIn = async (hint: string, returnTo = "/games") => {
    const start = await app.inject({ method: "GET", url: `/auth/dev/start?hint=${encodeURIComponent(hint)}&returnTo=${encodeURIComponent(returnTo)}` });
    expect(start.statusCode).toBe(302);
    const pending = start.cookies.find((c) => c.name === "sj_signin")!;
    const back = new URL(start.headers.location as string);
    expect(back.pathname).toBe("/auth/dev/callback");
    const cb = await app.inject({ method: "GET", url: back.pathname + back.search, cookies: { sj_signin: pending.value } });
    return { cb, back, pending };
  };

  it("lists only the configured providers", async () => {
    expect((await call("GET", "/auth/providers")).body).toEqual({ providers: ["dev"] });
    const bare = buildServer({ db, clock });
    expect((await bare.inject({ method: "GET", url: "/auth/providers" })).json()).toEqual({ providers: [] });
    expect((await bare.inject({ method: "GET", url: "/auth/dev/start" })).statusCode).toBe(404);
    await bare.close();
  });

  it("round-trips to a session for a non-guest user, the same user every time", async () => {
    const one = await signIn("Riya");
    expect(one.cb.statusCode).toBe(302);
    expect(one.cb.headers.location).toBe("/games");
    const t1 = one.cb.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    const me1 = (await call("GET", "/me", t1)).body.user as { id: string; guest: boolean };
    expect(me1.guest).toBe(false);
    const two = await signIn("Riya");
    const t2 = two.cb.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    expect(((await call("GET", "/me", t2)).body.user as { id: string }).id).toBe(me1.id);
  });

  it("refuses a callback whose state doesn't match the sign-in cookie, or with no cookie", async () => {
    const { back, pending } = await signIn("Max");
    const forged = new URLSearchParams(back.search);
    forged.set("state", "forged");
    const bad = await app.inject({ method: "GET", url: `${back.pathname}?${forged}`, cookies: { sj_signin: pending.value } });
    expect(bad.statusCode).toBe(400);
    const none = await app.inject({ method: "GET", url: back.pathname + back.search });
    expect(none.statusCode).toBe(400);
    expect(none.cookies.some((c) => c.name === SESSION_COOKIE)).toBe(false);
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example",
    "javascript:alert(1)",
    "/\t/evil.example",
    "/\n/evil.example",
    "/x\r\nSet-Cookie: a=b",
    "/ /evil.example",
    "/x\u0000",
    "/é",
    "/" + "a".repeat(600),
  ])("never redirects off-site or breaks the redirect (returnTo %j): falls back to /", async (returnTo) => {
    const { cb } = await signIn("Nico", returnTo);
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe("/");
  });

  it.each(["/", "/games/abc?tab=chat#top", "/invite/abc-def_~.%20"])("keeps a same-site path (returnTo %j)", async (returnTo) => {
    expect((await signIn("Nico", returnTo)).cb.headers.location).toBe(returnTo);
  });
});

describe("create a game (design §15 setup)", () => {
  it("needs a session", async () => {
    expect((await call("POST", "/games", null, {})).status).toBe(401);
  });

  it("seats the host (guests may host) with the default settings and an invite code", async () => {
    const { game } = await host();
    expect(game.status).toBe("lobby");
    expect(game.settings).toEqual(DEFAULT_SETTINGS);
    expect(game.inviteCode).toMatch(/^[a-z2-9]{10}$/);
    expect(game.youAreHost).toBe(true);
    expect(game.seats).toEqual([{ seat: 0, nickname: "Karthik", bot: null, host: true, you: true, playerId: null }]);
  });

  it("takes the host's settings: session length, vote visibility, Mole, events, starter mode, DM notices", async () => {
    const settings = { sessionLength: "quick", voteVisibility: "secret", mole: "off", eventsEnabled: false, starterMode: true, dmNotices: false, uniqueRoles: false };
    expect((await host(settings)).game.settings).toEqual(settings);
  });

  it.each([
    [{ sessionLength: "2h" }],
    [{ voteVisibility: "loud" }],
    [{ mole: "yes" }],
    [{ dmNotices: "no" }],
    [{ seed: "mine" }],
    [{ starterMode: true }], // design §8.1: starter mode has no Mole and no events
    ["settings"],
  ])("refuses settings %j", async (settings) => {
    const who = await guest("H");
    expect((await call("POST", "/games", who, { settings })).status).toBe(400);
  });
});

describe("invites", () => {
  it("previews a lobby without sign-in; unknown codes are 404", async () => {
    const { game } = await host();
    expect((await call("GET", `/invites/${game.inviteCode}`)).body).toEqual({ host: "Karthik", seats: 1, maxSeats: 12 });
    expect((await call("GET", "/invites/nope")).status).toBe(404);
    expect((await join("nope", "Ana")).status).toBe(404);
  });

  it("joining without a session signs a guest in with the nickname; codes are case-insensitive", async () => {
    const { who, game } = await host();
    const ana = await join(game.inviteCode.toUpperCase(), "Ana");
    expect(ana.status).toBe(200);
    expect(ana.session).toBeTruthy();
    expect(ana.body.seats!.map((s) => [s.nickname, s.you, s.host])).toEqual([
      ["Karthik", false, true],
      ["Ana", true, false],
    ]);
    expect(ana.body.youAreHost).toBe(false);
    expect((await call("GET", `/games/${game.id}`, who)).body.seats!.length).toBe(2);
    expect((await call("GET", "/me", ana.session)).body.user).toMatchObject({ name: "Ana", guest: true });
  });

  it("needs a nickname without a session; a signed-in user may join without one; a second join is a no-op", async () => {
    const { game } = await host();
    expect((await call("POST", `/invites/${game.inviteCode}/join`, null, {})).status).toBe(400);
    expect((await join(game.inviteCode, "")).status).toBe(400);
    const ben = await guest("Ben");
    const first = await call("POST", `/invites/${game.inviteCode}/join`, ben, {});
    expect(first.status).toBe(200);
    expect(first.session).toBeNull(); // kept the existing session
    const again = await join(game.inviteCode, "Benny", ben);
    expect(again.status).toBe(200);
    expect(again.body.seats!.map((s) => s.nickname)).toEqual(["Karthik", "Ben"]);
  });

  it("enforces 12 seats, including under concurrent joins (design §16)", async () => {
    const { game } = await host();
    const joins = await Promise.all(Array.from({ length: 14 }, (_, i) => join(game.inviteCode, `P${i}`)));
    expect(joins.filter((r) => r.status === 200)).toHaveLength(11);
    expect(joins.filter((r) => r.status === 409)).toHaveLength(3);
    expect(joins.find((r) => r.status === 409)!.body.error).toMatch(/full/);
  });

  it("nicknames are unique in a game, ignoring case, width and whitespace (409; no guest is made)", async () => {
    const { game } = await host();
    await join(game.inviteCode, "Ana Lee");
    for (const dup of ["ana lee", "  ANA   LEE ", "AnaLee", "Ａｎａ Ｌｅｅ", "karthik", "Karthik\u200d", "Kar\ufe0fthik", "K\u034farthik"]) {
      const res = await join(game.inviteCode, dup);
      expect(res.status).toBe(409);
      expect(res.session).toBeNull();
    }
    const kim = await guest("karthik"); // a signed-in user whose name clashes, joining without a nickname
    expect((await call("POST", `/invites/${game.inviteCode}/join`, kim, {})).status).toBe(409);
    expect((await join(game.inviteCode, "Kim", kim)).status).toBe(200);
  });

  it.each(["%00", "abc%00defgh", "%E2%80%AE", "abcdefghij%0A", "o0o0o0o0o0", "abcdefghijk"])("a malformed invite code (%s) is a clean 404", async (code) => {
    expect((await call("GET", `/invites/${code}`)).status).toBe(404);
    expect((await join(code, "Sam")).status).toBe(404);
  });

  it("a code is used once its game has started: 410 for newcomers, the game for those seated", async () => {
    const { who, game } = await host();
    const ana = (await join(game.inviteCode, "Ana")).session;
    expect((await call("POST", `/games/${game.id}/start`, who)).status).toBe(200);
    expect((await call("GET", `/invites/${game.inviteCode}`)).status).toBe(410);
    expect((await join(game.inviteCode, "Late")).status).toBe(410);
    expect((await join(game.inviteCode, "Ana", ana)).body.status).toBe("running");
  });

  it("a game is not found for anyone not seated in it", async () => {
    const { game } = await host();
    expect((await call("GET", `/games/${game.id}`, await guest("Stranger"))).status).toBe(404);
    expect((await call("GET", `/games/${game.id}`)).status).toBe(401);
    expect((await call("GET", "/games/not-a-uuid", await guest("S"))).status).toBe(404);
  });
});

describe("leave", () => {
  it("a player may leave the lobby; the host may not until they hand over", async () => {
    const { who, game } = await host();
    const ana = (await join(game.inviteCode, "Ana")).session;
    const refused = await call("POST", `/games/${game.id}/leave`, who);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/hand the host role/);
    expect((await call("POST", `/games/${game.id}/leave`, ana)).status).toBe(200);
    expect((await call("GET", `/games/${game.id}`, who)).body.seats!.map((s) => s.nickname)).toEqual(["Karthik"]);
    expect((await call("GET", `/games/${game.id}`, ana)).status).toBe(404);
  });
});

// Owner request (decisions.md M2-5b): before the start the host can hand the host role to another person, then leave.
// PR #27 review: hosting under another name must not swap the session (a guest would lose their other games).
describe("host nickname per game", () => {
  it("POST /games { nickname } seats the host under that name and keeps the session", async () => {
    const who = await guest("Karthik");
    const first = await call("POST", "/games", who, {});
    const res = await call("POST", "/games", who, { nickname: "  Kay  " });
    expect(res.status).toBe(201);
    expect(res.session).toBeNull(); // no new cookie
    expect(res.body.seats!.map((s) => [s.nickname, s.you, s.host])).toEqual([["Kay", true, true]]);
    expect((await call("GET", "/me", who)).body.user).toMatchObject({ name: "Karthik" });
    expect((await call("GET", `/games/${first.body.id}`, who)).status).toBe(200); // the other game is still yours
    for (const nickname of ["", "Bot · X", 7]) expect((await call("POST", "/games", who, { nickname })).status).toBe(400);
  });
});

describe("host hand-over", () => {
  it("moves the host role to another person, who can then run the lobby; the old host can leave", async () => {
    const { who, game } = await host();
    const ana = (await join(game.inviteCode, "Ana")).session!;
    const handed = await call("POST", `/games/${game.id}/host`, who, { seat: 1 });
    expect(handed.status).toBe(200);
    expect(handed.body.youAreHost).toBe(false);
    expect(handed.body.seats!.map((s) => [s.nickname, s.host])).toEqual([["Karthik", false], ["Ana", true]]);
    expect((await call("GET", `/games/${game.id}`, ana)).body.youAreHost).toBe(true);
    // The old host is now a player: no host actions, but may leave.
    expect((await call("POST", `/games/${game.id}/bots`, who, {})).status).toBe(403);
    expect((await call("POST", `/games/${game.id}/host`, who, { seat: 0 })).status).toBe(403);
    expect((await call("POST", `/games/${game.id}/leave`, who)).status).toBe(200);
    // The new host adds a bot and starts.
    expect((await call("POST", `/games/${game.id}/bots`, ana, {})).status).toBe(201);
    const started = await call("POST", `/games/${game.id}/start`, ana);
    expect(started.status).toBe(200);
    expect(started.body.seats!.map((s) => [s.nickname, s.playerId])).toEqual([["Ana", "p1"], ["Bot · Riya", "p2"]]);
  });

  it("refuses a bot, yourself, an empty seat, a non-host, and after the start", async () => {
    const { who, game } = await host();
    const ana = (await join(game.inviteCode, "Ana")).session!;
    await call("POST", `/games/${game.id}/bots`, who, {});
    expect((await call("POST", `/games/${game.id}/host`, who, { seat: 2 })).status).toBe(409); // bot
    expect((await call("POST", `/games/${game.id}/host`, who, { seat: 0 })).status).toBe(409); // yourself
    for (const seat of [7, "1", null, undefined]) expect((await call("POST", `/games/${game.id}/host`, who, { seat })).status).toBe(404);
    expect((await call("POST", `/games/${game.id}/host`, ana, { seat: 1 })).status).toBe(403);
    expect((await call("POST", `/games/${game.id}/start`, who)).status).toBe(200);
    expect((await call("POST", `/games/${game.id}/host`, who, { seat: 1 })).status).toBe(409);
  });
});

describe("host settings in the lobby", () => {
  it("the host changes settings before the start; fields not sent are kept; others can't", async () => {
    const { who, game } = await host({ sessionLength: "quick" });
    const ana = (await join(game.inviteCode, "Ana")).session!;
    const res = await call("PATCH", `/games/${game.id}/settings`, who, { settings: { uniqueRoles: false, mole: "on" } });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ ...DEFAULT_SETTINGS, sessionLength: "quick", uniqueRoles: false, mole: "on" });
    expect((await call("GET", `/games/${game.id}`, ana)).body.settings).toMatchObject({ uniqueRoles: false, mole: "on" });
    expect((await call("PATCH", `/games/${game.id}/settings`, ana, { settings: { mole: "off" } })).status).toBe(403);
  });

  it.each([[{ mole: "yes" }], [{ seed: "x" }], [{ starterMode: true }], ["x"], [[]], [null]])("refuses %j", async (settings) => {
    const { who, game } = await host();
    expect((await call("PATCH", `/games/${game.id}/settings`, who, { settings })).status).toBe(400);
    expect((await call("GET", `/games/${game.id}`, who)).body.settings).toEqual(DEFAULT_SETTINGS);
  });

  // design §8.1: uniqueRoles reaches the engine config (absent = true).
  it("uniqueRoles goes into the game config", async () => {
    const { gameConfig } = await import("./lobby");
    const seats = [{ nickname: "A", bot_personality: null }, { nickname: "B", bot_personality: null }];
    expect(gameConfig(DEFAULT_SETTINGS, seats, "s").uniqueRoles).toBe(true);
    expect(gameConfig({ ...DEFAULT_SETTINGS, uniqueRoles: false }, seats, "s").uniqueRoles).toBe(false);
  });

  it("lists bot personalities and the seat limits", async () => {
    const { game } = await host();
    expect(game.personalities!.map((p) => p.id)).toContain("opportunist");
    expect([game.minSeats, game.maxSeats]).toEqual([2, 12]);
  });

  // design §11.1, M2-7: the game screen offers slot proposals only when the group schedules meetings.
  it("says whether meetings open by themselves (short presets) or at a slot the crew picks", async () => {
    expect((await host({ sessionLength: "quick" })).game.autoMeetings).toBe(true);
    expect((await host({ sessionLength: "3h" })).game.autoMeetings).toBe(true);
    expect((await host({ sessionLength: "1d" })).game.autoMeetings).toBe(false);
    expect((await host({ sessionLength: "1w" })).game.autoMeetings).toBe(false);
  });
});

describe("bots fill seats", () => {
  it("only the host adds or removes bots; bots are marked with their personality and a Bot name", async () => {
    const { who, game } = await host();
    const ana = (await join(game.inviteCode, "Ana")).session;
    expect((await call("POST", `/games/${game.id}/bots`, ana, { personality: "greedy" })).status).toBe(403);
    const one = await call("POST", `/games/${game.id}/bots`, who, { personality: "greedy" });
    expect(one.status).toBe(201);
    const two = await call("POST", `/games/${game.id}/bots`, who, {});
    expect(two.body.seats!.slice(2).map((s) => [s.seat, s.nickname, s.bot])).toEqual([
      [2, "Bot · Riya", "greedy"],
      [3, "Bot · Max", "opportunist"],
    ]);
    expect((await call("DELETE", `/games/${game.id}/bots/2`, ana)).status).toBe(403);
    expect((await call("DELETE", `/games/${game.id}/bots/1`, who)).status).toBe(404); // Ana is no bot
    const left = await call("DELETE", `/games/${game.id}/bots/2`, who);
    expect(left.body.seats!.map((s) => s.nickname)).toEqual(["Karthik", "Ana", "Bot · Max"]);
    expect((await call("POST", `/games/${game.id}/bots`, who, {})).body.seats!.at(-1)).toMatchObject({ seat: 4, nickname: "Bot · Riya" });
  });

  it.each([["evil"], ["__proto__"], [7]])("refuses personality %j", async (personality) => {
    const { who, game } = await host();
    expect((await call("POST", `/games/${game.id}/bots`, who, { personality })).status).toBe(400);
  });

  it("bots count towards the 12 seats", async () => {
    const { who, game } = await host();
    for (let i = 0; i < 11; i++) expect((await call("POST", `/games/${game.id}/bots`, who, {})).status).toBe(201);
    expect((await call("POST", `/games/${game.id}/bots`, who, {})).status).toBe(409);
    expect((await join(game.inviteCode, "Ana")).status).toBe(409);
  });
});

describe("start", () => {
  it("needs the host and at least 2 seats (design §16)", async () => {
    const { who, game } = await host();
    expect((await call("POST", `/games/${game.id}/start`, who)).status).toBe(409);
    const ana = (await join(game.inviteCode, "Ana")).session;
    expect((await call("POST", `/games/${game.id}/start`, ana)).status).toBe(403);
  });

  it("makes safe player ids, a fresh seed and the config; stores the setup; never sends the config", async () => {
    const { who, game } = await host({ voteVisibility: "open", mole: "on" });
    await join(game.inviteCode, "__proto__"); // a nickname, never an id
    await call("POST", `/games/${game.id}/bots`, who, { personality: "cautious" });
    const started = await call("POST", `/games/${game.id}/start`, who);
    expect(started.status).toBe(200);
    expect(started.body.status).toBe("running");
    expect(started.body.seats!.map((s) => s.playerId)).toEqual(["p1", "p2", "p3"]);
    expect(started.body.seats!.every((s) => isSafePlayerId(s.playerId))).toBe(true);
    expect(JSON.stringify(started.body)).not.toMatch(/seed|config/);

    const state = (await store.load(game.id))!;
    expect(state.phase.kind).toBe("planning");
    expect(state.config.players).toEqual([
      { id: "p1", name: "Karthik", isBot: false },
      { id: "p2", name: "__proto__", isBot: false },
      { id: "p3", name: "Bot · Riya", isBot: true },
    ]);
    expect(state.config).toMatchObject({ job: "bank", voteVisibility: "open", mole: "on", eventsEnabled: true, starterMode: false });
    expect(state.config.seed).toMatch(/^[0-9a-f]{32}$/);

    expect((await call("POST", `/games/${game.id}/start`, who)).status).toBe(409);
    expect((await call("POST", `/games/${game.id}/bots`, who, {})).status).toBe(409);
  });

  it("maps a session's user to its seat's player id (the only source of command.player)", async () => {
    const { who, game } = await host();
    const ana = (await join(game.inviteCode, "Ana")).session;
    const anaId = ((await call("GET", "/me", ana)).body.user as { id: string }).id;
    const hostId = ((await call("GET", "/me", who)).body.user as { id: string }).id;
    expect(await playerIdOf(db, game.id, anaId)).toBeNull(); // lobby: no ids yet
    await call("POST", `/games/${game.id}/start`, who);
    expect([await playerIdOf(db, game.id, hostId), await playerIdOf(db, game.id, anaId)]).toEqual(["p1", "p2"]);
    expect(await playerIdOf(db, game.id, ((await call("GET", "/me", await guest("X"))).body.user as { id: string }).id)).toBeNull();
    expect(await playerIdOf(db, "nope", anaId)).toBeNull();
  });

  it("seeds differ between games", async () => {
    const seeds = [];
    for (let i = 0; i < 2; i++) {
      const { who, game } = await host();
      await call("POST", `/games/${game.id}/bots`, who, {});
      await call("POST", `/games/${game.id}/start`, who);
      seeds.push((await store.load(game.id))!.config.seed);
    }
    expect(seeds[0]).not.toBe(seeds[1]);
  });
});
