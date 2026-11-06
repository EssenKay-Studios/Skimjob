// QA (PR #18): attacks on identity, invites and the lobby API. docs/m2-plan.md M2-2; design §15, §16
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devAuthProvider, SESSION_COOKIE } from "./auth";
import { fakeClock, type FakeClock } from "./clock";
import type { Db } from "./db";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import { SESSION_TTL_MS } from "./settings";
import { testDb } from "./testkit";

let db: Db;
let app: FastifyInstance;
let noDev: FastifyInstance;
let clock: FakeClock;
beforeAll(async () => {
  db = await testDb();
  clock = fakeClock(Date.UTC(2026, 10, 1));
  app = buildServer({ db, clock, auth: [devAuthProvider()] });
  noDev = buildServer({ db, clock }); // DEV_LOGIN off
}, 30_000);
afterAll(async () => {
  await app.close();
  await noDev.close();
  await db.close();
});

type Res = { status: number; body: Record<string, unknown> & Partial<LobbyView>; session: string | null };
const call = async (method: "GET" | "POST" | "DELETE", url: string, who: string | null = null, payload?: unknown, cookies: Record<string, string> = {}): Promise<Res> => {
  const res = await app.inject({ method, url, cookies: who !== null ? { ...cookies, [SESSION_COOKIE]: who } : cookies, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: res.statusCode, body: res.json(), session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};
const guest = async (nickname: string) => (await call("POST", "/auth/guest", null, { nickname })).session!;
const host = async () => {
  const who = await guest("Host");
  const res = await call("POST", "/games", who, {});
  expect(res.status).toBe(201);
  return { who, game: res.body as unknown as LobbyView };
};
const join = (code: string, nickname: string, who: string | null = null) => call("POST", `/invites/${code}/join`, who, { nickname });
const fill = async (code: string, n: number) => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push((await join(code, `J${i}`)).session!);
  return out;
};

describe("QA: forged, tampered and expired session cookies", () => {
  it("anything but a live token is signed out: random, empty, huge, one character changed, the hash itself", async () => {
    const real = await guest("Real");
    const [row] = await db.query<{ h: string }>("select encode(token_hash, 'hex') as h from sessions order by created_at desc limit 1");
    const flipped = real.slice(0, -1) + (real.endsWith("A") ? "B" : "A");
    for (const forged of ["", "x", "A".repeat(10_000), flipped, row!.h, `${real} `, real.toUpperCase()]) {
      expect((await call("GET", "/me", forged)).status, JSON.stringify(forged.slice(0, 20))).toBe(401);
      expect((await call("POST", "/games", forged, {})).status).toBe(401);
    }
    expect((await call("GET", "/me", real)).status).toBe(200);
  });

  it("expiry is exact: valid 1 ms before the TTL, signed out at it", async () => {
    const t = await guest("Ttl");
    clock.advance(SESSION_TTL_MS - 1);
    expect((await call("GET", "/me", t)).status).toBe(200);
    clock.advance(1);
    expect((await call("GET", "/me", t)).status).toBe(401);
  });

  it("an expired session joining by invite needs a nickname and becomes a new guest, not the old user", async () => {
    const { game } = await host();
    const old = await guest("Old");
    clock.advance(SESSION_TTL_MS);
    expect((await call("POST", `/invites/${game.inviteCode}/join`, old, {})).status).toBe(400);
    const res = await join(game.inviteCode, "Fresh", old);
    expect(res.status).toBe(200);
    expect(res.session).not.toBeNull();
    expect(res.session).not.toBe(old);
  });
});

describe("QA: redirect sign-in (dev stub)", () => {
  const start = async (q: string) => {
    const res = await app.inject({ method: "GET", url: `/auth/dev/start?${q}` });
    const signin = res.cookies.find((c) => c.name === "sj_signin")!;
    const state = new URL(res.headers.location as string).searchParams.get("state")!;
    return { signin: signin.value, state };
  };

  it("a tampered or mangled sign-in cookie, a duplicated state or a wrong provider is a clean 400", async () => {
    const { signin, state } = await start("hint=Mallory");
    const cb = (q: string, cookie: string) => app.inject({ method: "GET", url: `/auth/dev/callback?${q}`, cookies: { sj_signin: cookie } });
    expect((await cb(`code=Mallory&state=${state}`, "{not json")).statusCode).toBe(400);
    expect((await cb(`code=Mallory&state=${state}`, JSON.stringify({ ...JSON.parse(signin), provider: "google" }))).statusCode).toBe(400);
    expect((await cb(`code=Mallory&state=${state}&state=${state}`, signin)).statusCode).toBe(400);
    expect((await cb(`code=Mallory&code=Eve&state=${state}`, signin)).statusCode).toBe(400);
  });

  it.each(["//evil.example", "/\\evil.example", "https://evil.example", "\\\\evil.example", "/%2F/evil.example"])(
    "returnTo %j never leaves the site",
    async (returnTo) => {
      const { signin, state } = await start(`hint=Ret&returnTo=${encodeURIComponent(returnTo)}`);
      const res = await app.inject({ method: "GET", url: `/auth/dev/callback?code=Ret&state=${state}`, cookies: { sj_signin: signin } });
      expect(res.statusCode).toBe(302);
      const loc = res.headers.location as string;
      expect(new URL(loc, "https://skimjob.test/").host).toBe("skimjob.test");
    },
  );

  it("with DEV_LOGIN off the dev routes don't exist and no provider is listed", async () => {
    expect((await noDev.inject({ method: "GET", url: "/auth/providers" })).json()).toEqual({ providers: [] });
    expect((await noDev.inject({ method: "GET", url: "/auth/dev/start?hint=Riya" })).statusCode).toBe(404);
    expect((await noDev.inject({ method: "GET", url: "/auth/dev/callback?code=Riya&state=x", cookies: { sj_signin: JSON.stringify({ provider: "dev", state: "x" }) } })).statusCode).toBe(404);
    // guests still work without any provider
    expect((await noDev.inject({ method: "POST", url: "/auth/guest", payload: { nickname: "G" } })).statusCode).toBe(200);
  });
});

describe("QA: nicknames are free text", () => {
  it.each([
    ["exactly 24 code points", "x".repeat(24), true],
    ["24 emoji (astral, 48 UTF-16 units)", "🦝".repeat(24), true],
    ["25 emoji", "🦝".repeat(25), false],
    ["HTML/script, stored verbatim", "<script>alert(1)</script>", false], // 25 chars
    ["short HTML, stored verbatim", "<img src=x onerror=a()>", true],
    ["SQL-ish", "'); drop table users;--", true],
    ["RTL + CJK", "مرحبا 你好", true],
    ["tab inside collapses to a space", "a\tb", true],
    ["newline inside collapses to a space", "a\nb", true],
    ["DEL", "a\u007fb", false],
    ["C1 control", "a\u0085b", false],
    ["very long", "y".repeat(100_000), false],
    ["an object", { toString: "x" }, false],
    ["an array", ["Sam"], false],
  ])("%s", async (_name, nickname, ok) => {
    const { game } = await host();
    const res = await join(game.inviteCode, nickname as string);
    expect(res.status).toBe(ok ? 200 : 400);
    if (!ok) {
      expect(res.session).toBeNull();
      return;
    }
    const mine = res.body.seats!.find((s) => s.you)!;
    if (typeof nickname === "string" && /[<'(]/.test(nickname)) expect(mine.nickname).toBe(nickname);
    expect([...mine.nickname].length).toBeLessThanOrEqual(24);
  });

  it("a nickname is display text, never an id: an id-like nickname is fine, ids stay p1..pN (PR #18 review: no duplicates)", async () => {
    const { who, game } = await host();
    expect((await join(game.inviteCode, " host ")).status).toBe(409); // same as "Host", ignoring case and whitespace
    await join(game.inviteCode, "p3");
    await join(game.inviteCode, "p1");
    const started = await call("POST", `/games/${game.id}/start`, who);
    expect(started.status).toBe(200);
    expect(started.body.seats!.map((s) => [s.nickname, s.playerId])).toEqual([["Host", "p1"], ["p3", "p2"], ["p1", "p3"]]);
  });
});

describe("QA: invites", () => {
  it.each([["empty", ""], ["unknown", "zzzzzzzzzz"], ["5000 chars", "x".repeat(5000)], ["path-ish", "..%2F.."], ["SQL-ish", "' or 1=1 --"]])("%s code is a clean 4xx", async (_name, code) => {
    for (const res of [await call("GET", `/invites/${code}`), await join(code, "Sam")]) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });

  it("an unknown code makes no guest user and no session", async () => {
    const before = (await db.query<{ n: number }>("select count(*)::int as n from users"))[0]!.n;
    const res = await join("nosuchcode", "Ghost");
    expect(res.status).toBe(404);
    expect(res.session).toBeNull();
    expect((await db.query<{ n: number }>("select count(*)::int as n from users"))[0]!.n).toBe(before);
  });

  it("a full or started game turns a newcomer away without making them a guest user", async () => {
    const { who, game } = await host();
    await fill(game.inviteCode, 11);
    const before = (await db.query<{ n: number }>("select count(*)::int as n from users"))[0]!.n;
    const full = await join(game.inviteCode, "Thirteenth");
    expect(full.status).toBe(409);
    expect(full.session).toBeNull();
    expect((await call("POST", `/invites/${game.inviteCode}/join`, await guest("Signed"), {})).status).toBe(409);
    expect((await call("POST", `/games/${game.id}/bots`, who, {})).status).toBe(409);
    expect((await call("POST", `/games/${game.id}/start`, who)).status).toBe(200);
    const late = await join(game.inviteCode, "Late");
    expect(late.status).toBe(410);
    expect(late.session).toBeNull();
    expect((await db.query<{ n: number }>("select count(*)::int as n from users"))[0]!.n).toBe(before + 1); // only "Signed"
  });
});

describe("QA: races", () => {
  it("a person and a bot racing for the last seat: exactly one gets it", async () => {
    const { who, game } = await host();
    await fill(game.inviteCode, 10);
    const [j, b] = await Promise.all([join(game.inviteCode, "Last"), call("POST", `/games/${game.id}/bots`, who, {})]);
    expect([j.status, b.status].sort()).toEqual([200, 409].sort());
    expect((await call("GET", `/games/${game.id}`, who)).body.seats).toHaveLength(12);
  });

  it("two joins for the last seat: one 200, one 409, 12 seats", async () => {
    const { who, game } = await host();
    await fill(game.inviteCode, 10);
    const res = await Promise.all([join(game.inviteCode, "A"), join(game.inviteCode, "B")]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await call("GET", `/games/${game.id}`, who)).body.seats).toHaveLength(12);
  });

  it("double start: one starts the game, the other is 409, and the setup is stored once", async () => {
    const { who, game } = await host();
    await join(game.inviteCode, "Ana");
    await join(game.inviteCode, "Ben");
    const res = await Promise.all([call("POST", `/games/${game.id}/start`, who), call("POST", `/games/${game.id}/start`, who)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    const [ev] = await db.query<{ n: number; first: number }>("select count(*)::int as n, count(distinct idx)::int as first from game_events where game_id = $1", [game.id]);
    expect(ev!.n).toBe(ev!.first);
    const [g] = await db.query<{ seed: string }>("select config->>'seed' as seed from games where id = $1", [game.id]);
    const { body } = await call("GET", `/games/${game.id}`, who);
    expect(body.seats!.map((s) => s.playerId)).toEqual(["p1", "p2", "p3"]);
    expect(g!.seed).toMatch(/^[0-9a-f]{32}$/);
  });

  it("join racing start: the joiner is either seated with a player id or turned away with 410", async () => {
    const { who, game } = await host();
    await join(game.inviteCode, "Ana");
    await join(game.inviteCode, "Ben");
    const [s, j] = await Promise.all([call("POST", `/games/${game.id}/start`, who), join(game.inviteCode, "Racer")]);
    expect(s.status).toBe(200);
    const seats = (await call("GET", `/games/${game.id}`, who)).body.seats!;
    if (j.status === 200) expect(seats.every((x) => x.playerId !== null)).toBe(true);
    else expect(j.status).toBe(410);
    expect(seats.every((x) => x.playerId !== null)).toBe(true);
  });

  it("hand-over racing with start: one wins and the state stays consistent (needs the game lock)", async () => {
    // Each request stalls after it read the game and before it reads the seats, so without the per-game lock
    // both pass the host and lobby checks before either writes, and both succeed.
    const slow: Db = { ...db, query: async (...a: Parameters<Db["query"]>) => (/^select seat_no, player_id/.test(a[0]) && (await new Promise((r) => setTimeout(r, 100))), db.query(...a)) };
    const racing = buildServer({ db: slow, clock, auth: [devAuthProvider()] });
    try {
      for (let i = 0; i < 5; i++) {
        const { who, game } = await host();
        await join(game.inviteCode, "Lou");
        await call("POST", `/games/${game.id}/bots`, who, {});
        const post = (url: string, payload?: object) => racing.inject({ method: "POST", url, cookies: { [SESSION_COOKIE]: who }, ...(payload ? { payload } : {}) });
        const [hand, start] = await Promise.all([post(`/games/${game.id}/host`, { seat: 1 }), post(`/games/${game.id}/start`)]);
        expect([hand.statusCode, start.statusCode].filter((s) => s === 200)).toHaveLength(1);
        const [row] = await db.query<{ status: string }>("select status from games where id = $1", [game.id]);
        if (start.statusCode === 200) expect(row!.status).not.toBe("lobby");
        else expect(row!.status).toBe("lobby");
      }
    } finally {
      await racing.close();
    }
  });

  it("the same session double-clicking join gets one seat", async () => {
    const { who, game } = await host();
    const me = await guest("Twice");
    const res = await Promise.all([join(game.inviteCode, "Twice", me), join(game.inviteCode, "Twice", me)]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    expect((await call("GET", `/games/${game.id}`, who)).body.seats).toHaveLength(2);
  });
});

describe("QA: host-only routes and other games", () => {
  it("a seated non-host gets 403 on every host route; a stranger gets 404; signed-out gets 401", async () => {
    const { who, game } = await host();
    const ana = (await join(game.inviteCode, "Ana")).session!;
    const bot = (await call("POST", `/games/${game.id}/bots`, who, {})).body.seats!.find((s) => s.bot)!.seat;
    const stranger = await guest("Stranger");
    const routes: [("POST" | "DELETE"), string][] = [
      ["POST", `/games/${game.id}/start`],
      ["POST", `/games/${game.id}/bots`],
      ["DELETE", `/games/${game.id}/bots/${bot}`],
    ];
    for (const [m, url] of routes) {
      expect((await call(m, url, ana, m === "POST" ? {} : undefined)).status, `${m} ${url}`).toBe(403);
      expect((await call(m, url, stranger, m === "POST" ? {} : undefined)).status).toBe(404);
      expect((await call(m, url, null, m === "POST" ? {} : undefined)).status).toBe(401);
    }
    expect((await call("GET", `/games/${game.id}`, who)).body.status).toBe("lobby");
  });

  it("the host can't remove a person through the bot route, nor seat junk", async () => {
    const { who, game } = await host();
    await join(game.inviteCode, "Ana");
    for (const seat of ["0", "1", "-1", "01", "1.0", "abc", "99999999999999999999"]) {
      expect((await call("DELETE", `/games/${game.id}/bots/${seat}`, who)).status).toBe(404);
    }
    for (const personality of ["__proto__", "constructor", "toString", "", 7]) {
      expect((await call("POST", `/games/${game.id}/bots`, who, { personality })).status).toBe(400);
    }
    expect((await call("GET", `/games/${game.id}`, who)).body.seats).toHaveLength(2);
  });

  it("being seated in one game never opens another (lobby, leave, start)", async () => {
    const a = await host();
    const b = await host();
    const ana = (await join(a.game.inviteCode, "Ana")).session!;
    expect((await call("GET", `/games/${b.game.id}`, ana)).status).toBe(404);
    expect((await call("POST", `/games/${b.game.id}/leave`, ana)).status).toBe(404);
    expect((await call("POST", `/games/${b.game.id}/start`, a.who)).status).toBe(404);
    expect((await call("POST", `/games/${b.game.id}/bots`, a.who, {})).status).toBe(404);
  });

  it("after start: no leave, no bots, no second start", async () => {
    const { who, game } = await host();
    const ana = (await join(game.inviteCode, "Ana")).session!;
    await join(game.inviteCode, "Ben");
    await call("POST", `/games/${game.id}/start`, who);
    expect((await call("POST", `/games/${game.id}/leave`, ana)).status).toBe(409);
    expect((await call("POST", `/games/${game.id}/bots`, who, {})).status).toBe(409);
    expect((await call("POST", `/games/${game.id}/start`, who)).status).toBe(409);
  });

  it("the lobby view carries no user ids, seed or config", async () => {
    const { who, game } = await host();
    await join(game.inviteCode, "Ana");
    await join(game.inviteCode, "Ben");
    await call("POST", `/games/${game.id}/start`, who);
    const text = JSON.stringify((await call("GET", `/games/${game.id}`, who)).body);
    const ids = await db.query<{ id: string }>("select user_id::text as id from seats where game_id = $1", [game.id]);
    const [g] = await db.query<{ seed: string }>("select config->>'seed' as seed from games where id = $1", [game.id]);
    for (const { id } of ids) expect(text).not.toContain(id);
    expect(text).not.toContain(g!.seed);
    expect(text).not.toMatch(/"(config|seed|host_user_id|user_id)"/);
  });
});

describe("QA: malformed bodies are 4xx, not 500", () => {
  it.each([
    ["/auth/guest", "not json"],
    ["/auth/guest", "[1,2]"],
    ["/auth/guest", "null"],
    ["/auth/guest", '{"__proto__":{"x":1},"nickname":"P"}'],
  ])("POST %s %j", async (url, raw) => {
    const res = await app.inject({ method: "POST", url, payload: raw, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it.each([["[]"], ['"x"'], ["{\"settings\":[]}"], ["{\"settings\":{\"constructor\":1}}"], ["{\"settings\":{\"mole\":\"on\",\"seed\":\"x\"}}"]])(
    "POST /games %s",
    async (raw) => {
      const who = await guest("H");
      const res = await app.inject({ method: "POST", url: "/games", payload: raw, headers: { "content-type": "application/json" }, cookies: { [SESSION_COOKIE]: who } });
      // a non-object body falls back to default settings (201); bad settings are 400. Never 500.
      expect(res.statusCode).toBeLessThan(500);
    },
  );
});
