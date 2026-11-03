// QA: adversarial tests for "Sign in with Google" (docs/m2-plan.md M2-12)
// against a fake Google (token endpoint + JWKS behind `fetch`): forged ID
// tokens, state/nonce/PKCE abuse, open redirects, cookie flags, guest linking
// without seat hijack, sign-out closing sockets, and Google off.
import { createHash, createHmac, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { devAuthProvider, safeReturnTo, SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import { loadConfig } from "./config";
import type { Db } from "./db";
import { GOOGLE_ENDPOINTS, googleAuthProvider } from "./google";
import { CLOSE_SIGNED_OUT } from "./live";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import { serverDeps } from "./startup";
import { createGameStore } from "./store";
import { testDb } from "./testkit";

const CLIENT_ID = "qa-client.apps.googleusercontent.com";
const CLIENT_SECRET = "qa-secret";
const REDIRECT = "http://localhost:5173/api/auth/google/callback";
const clock = fakeClock(Date.UTC(2026, 10, 3, 12));
const nowS = () => Math.floor(clock.now() / 1000);
const b64 = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } });

const k1 = { kid: "k1", ...generateKeyPairSync("rsa", { modulusLength: 2048 }) };
const evil = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rs256 = (header: Record<string, unknown>, claims: unknown, key: KeyObject = k1.privateKey) => {
  const hp = `${b64(header)}.${b64(claims)}`;
  return `${hp}.${sign("RSA-SHA256", Buffer.from(hp), key).toString("base64url")}`;
};

type Grant = { challenge: string; redirectUri: string; claims: Record<string, unknown> };
/** How the fake token endpoint answers a good code: an ID token (string), or a whole Response. */
type Mint = (claims: Record<string, unknown>) => string | Response;
const google = {
  codes: new Map<string, Grant>(),
  calls: { token: 0, jwks: 0 },
  jwksStatus: 200,
  mint: null as Mint | null,
  n: 0,
};
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url === GOOGLE_ENDPOINTS.jwks) {
    google.calls.jwks++;
    if (google.jwksStatus !== 200) return json({}, { status: google.jwksStatus });
    return json({ keys: [{ ...k1.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] }, { headers: { "cache-control": "max-age=3600" } });
  }
  if (url === GOOGLE_ENDPOINTS.token && init?.method === "POST") {
    google.calls.token++;
    const f = new URLSearchParams(String(init.body));
    const grant = google.codes.get(f.get("code") ?? "");
    google.codes.delete(f.get("code") ?? "");
    const pkce = createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url");
    if (!grant || f.get("client_secret") !== CLIENT_SECRET || f.get("redirect_uri") !== grant.redirectUri || pkce !== grant.challenge) {
      return json({ error: "invalid_grant" }, { status: 400 });
    }
    const out = (google.mint ?? ((c) => rs256({ alg: "RS256", kid: "k1", typ: "JWT" }, c)))(grant.claims);
    return typeof out === "string" ? json({ access_token: "at", id_token: out }) : out;
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

/** The user picks an account on Google's page: the callback URL Google sends the browser to. */
function approve(authorize: string, sub: string, claims: Record<string, unknown> = {}) {
  const q = new URL(authorize).searchParams;
  const code = `qa-code-${++google.n}`;
  const t = nowS();
  google.codes.set(code, {
    challenge: q.get("code_challenge")!,
    redirectUri: q.get("redirect_uri")!,
    claims: { iss: "https://accounts.google.com", aud: CLIENT_ID, azp: CLIENT_ID, sub, name: sub, iat: t, exp: t + 3600, nonce: q.get("nonce"), ...claims },
  });
  return `/auth/google/callback?${new URLSearchParams({ code, state: q.get("state")!, scope: "openid profile" })}`;
}

let db: Db;
let app: FastifyInstance;
beforeAll(async () => {
  db = await testDb();
  const providers = [
    googleAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT, fetch: fakeFetch, now: () => clock.now() }),
    devAuthProvider(),
  ];
  app = buildServer({ db, clock, auth: providers, store: createGameStore(db) });
  await app.ready();
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});
beforeEach(() => {
  google.mint = null;
  google.jwksStatus = 200;
});

type Res = Awaited<ReturnType<FastifyInstance["inject"]>>;
const cookieOf = (res: Res, name: string) => res.cookies.find((c) => c.name === name);
const sessionOf = (res: Res) => cookieOf(res, SESSION_COOKIE)?.value || null;
const get = (url: string, cookies: Record<string, string> = {}) => app.inject({ method: "GET", url, cookies });
const me = async (session: string | null) => {
  const res = await get("/me", session ? { [SESSION_COOKIE]: session } : {});
  return res.statusCode === 200 ? (res.json().user as { id: string; name: string; guest: boolean }) : null;
};
async function start(q = "", session?: string) {
  const res = await get(`/auth/google/start${q}`, session ? { [SESSION_COOKIE]: session } : {});
  expect(res.statusCode).toBe(302);
  return { res, location: res.headers.location as string, signin: cookieOf(res, "sj_signin")!.value };
}
const callback = (url: string, signin: string | null, session?: string | null) =>
  get(url, { ...(signin ? { sj_signin: signin } : {}), ...(session ? { [SESSION_COOKIE]: session } : {}) });
/** A whole Google sign-in; `claims` override what Google puts in the ID token. */
async function signIn(sub: string, opts: { claims?: Record<string, unknown>; session?: string | null; returnTo?: string } = {}) {
  const s = await start(opts.returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(opts.returnTo)}`, opts.session ?? undefined);
  const cb = await callback(approve(s.location, sub, opts.claims), s.signin, opts.session);
  return { ...s, cb, session: sessionOf(cb) };
}
const refusedWith = async (sub: string, mintOrClaims: Mint | Record<string, unknown>) => {
  if (typeof mintOrClaims === "function") google.mint = mintOrClaims;
  const r = await signIn(sub, typeof mintOrClaims === "function" ? {} : { claims: mintOrClaims });
  return { status: r.cb.statusCode, session: r.session };
};

describe("forged ID tokens are refused (401, no session)", () => {
  it("accepts the honest token (control)", async () => {
    const r = await signIn("qa-honest");
    expect(r.cb.statusCode).toBe(302);
    expect((await me(r.session))?.guest).toBe(false);
  });

  it.each<[string, Mint]>([
    ["alg none, no signature", (c) => `${b64({ alg: "none", kid: "k1" })}.${b64(c)}.`],
    ["alg none with a stolen RS256 signature", (c) => `${b64({ alg: "none", kid: "k1" })}.${b64(c)}.${rs256({ alg: "RS256", kid: "k1" }, c).split(".")[2]}`],
    ["HS256 keyed with Google's public key (alg confusion)", (c) => {
      const hp = `${b64({ alg: "HS256", kid: "k1" })}.${b64(c)}`;
      const pem = k1.publicKey.export({ format: "pem", type: "spki" });
      return `${hp}.${createHmac("sha256", pem).update(hp).digest("base64url")}`;
    }],
    ["RS512 header", (c) => rs256({ alg: "RS512", kid: "k1" }, c)],
    ["signed by another key under Google's kid", (c) => rs256({ alg: "RS256", kid: "k1" }, c, evil.privateKey)],
    ["claims swapped after signing (sub changed)", (c) => {
      const [h, , s] = rs256({ alg: "RS256", kid: "k1" }, c).split(".");
      return `${h}.${b64({ ...c, sub: "someone-else" })}.${s}`;
    }],
    ["no kid", (c) => rs256({ alg: "RS256" }, c)],
    ["numeric kid", (c) => rs256({ alg: "RS256", kid: 1 }, c)],
    ["two parts", (c) => rs256({ alg: "RS256", kid: "k1" }, c).split(".").slice(0, 2).join(".")],
    ["four parts", (c) => `${rs256({ alg: "RS256", kid: "k1" }, c)}.x`],
    ["payload not JSON", () => rs256({ alg: "RS256", kid: "k1" }, "not json")],
    ["payload JSON null", () => rs256({ alg: "RS256", kid: "k1" }, null)],
    ["empty string", () => ""],
    ["id_token missing from the token response", () => json({ access_token: "at" })],
    ["id_token not a string", () => json({ access_token: "at", id_token: 42 })],
    ["token response not JSON", () => new Response("<html>", { status: 200 })],
    ["token endpoint 500", () => json({ error: "server_error" }, { status: 500 })],
  ])("%s", async (_, mint) => {
    const r = await refusedWith(`qa-forged-${google.n}`, mint);
    expect(r.status).toBe(401);
    expect(r.session).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ["expired past the 60 s skew", { exp: nowS() - 61 }],
    ["no exp", { exp: undefined }],
    ["exp as a string", { exp: String(nowS() + 3600) }],
    ["issued more than 60 s in the future", { iat: nowS() + 61 }],
    ["wrong aud", { aud: "someone-else.apps.googleusercontent.com" }],
    ["aud missing", { aud: undefined }],
    ["aud array without us", { aud: ["a", "b"] }],
    ["aud array with us but azp someone else", { aud: [CLIENT_ID, "other"], azp: "other" }],
    ["aud array with us and no azp", { aud: [CLIENT_ID, "other"], azp: undefined }],
    ["iss look-alike", { iss: "https://accounts.google.com.evil.example" }],
    ["iss over http", { iss: "http://accounts.google.com" }],
    ["iss missing", { iss: undefined }],
    ["nonce from another sign-in", { nonce: "replayed-nonce" }],
    ["nonce missing", { nonce: undefined }],
    ["sub not a string", { sub: 12345 }],
    ["sub longer than 255", { sub: "x".repeat(256) }],
  ])("%s", async (_, claims) => {
    const r = await refusedWith(`qa-claims-${google.n}`, claims);
    expect(r.status).toBe(401);
    expect(r.session).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ["exp exactly 60 s ago (skew boundary)", { exp: nowS() - 60 }],
    ["iat exactly 60 s ahead (skew boundary)", { iat: nowS() + 60 }],
    ["iss without https://", { iss: "accounts.google.com" }],
    ["aud array of just us", { aud: [CLIENT_ID], azp: undefined }],
    ["aud array with us and azp us", { aud: [CLIENT_ID, "other"] }],
  ])("accepts %s", async (_, claims) => {
    const r = await signIn(`qa-ok-${google.n}`, { claims });
    expect(r.cb.statusCode).toBe(302);
    expect(r.session).not.toBeNull();
  });

  it("an unknown kid refetches the JWKS at most once a minute (no fetch amplification)", async () => {
    await signIn("qa-warm"); // keys cached
    const unknownKid: Mint = (c) => rs256({ alg: "RS256", kid: "rotated-away" }, c, evil.privateKey);
    clock.advance(61_000);
    const before = google.calls.jwks;
    for (let i = 0; i < 4; i++) expect((await refusedWith(`qa-kid-${i}`, unknownKid)).status).toBe(401);
    expect(google.calls.jwks - before).toBe(1);
    clock.advance(61_000);
    expect((await refusedWith("qa-kid-later", unknownKid)).status).toBe(401);
    expect(google.calls.jwks - before).toBe(2);
  });

  it("a JWKS outage is a 502 with no session", async () => {
    clock.advance(2 * 60 * 60 * 1000); // past the cached keys' max-age
    google.jwksStatus = 503;
    const r = await signIn("qa-jwks-down");
    expect(r.cb.statusCode).toBe(502);
    expect(r.session).toBeNull();
    google.jwksStatus = 200;
    expect((await signIn("qa-jwks-back")).cb.statusCode).toBe(302);
  });
});

describe("state, nonce and PKCE abuse", () => {
  it("a callback with no prior start is refused before Google is asked", async () => {
    const before = google.calls.token;
    const res = await callback("/auth/google/callback?code=anything&state=anything", null);
    expect(res.statusCode).toBe(400);
    expect(sessionOf(res)).toBeNull();
    expect(google.calls.token).toBe(before);
  });

  it("a callback with an error= but no matching start doesn't redirect", async () => {
    const res = await callback("/auth/google/callback?error=access_denied&state=x", null);
    expect(res.statusCode).toBe(400);
  });

  it("login CSRF: the attacker's code + state on the victim's own sign-in cookie is refused", async () => {
    const attacker = await start();
    const attackerCb = approve(attacker.location, "qa-attacker");
    const victim = await start();
    const before = google.calls.token;
    const res = await callback(attackerCb, victim.signin);
    expect(res.statusCode).toBe(400);
    expect(sessionOf(res)).toBeNull();
    expect(google.calls.token).toBe(before);
  });

  it("a dev sign-in cookie can't be spent on Google's callback (provider bound)", async () => {
    const dev = await get("/auth/dev/start?hint=Mallory");
    const signin = cookieOf(dev, "sj_signin")!.value;
    const state = new URL(dev.headers.location as string, "http://x").searchParams.get("state")!;
    const res = await callback(`/auth/google/callback?code=c&state=${state}`, signin);
    expect(res.statusCode).toBe(400);
  });

  it("a replayed callback (same URL, same cookie) is refused by Google's single-use code", async () => {
    const s = await start();
    const url = approve(s.location, "qa-replay");
    expect((await callback(url, s.signin)).statusCode).toBe(302);
    const again = await callback(url, s.signin);
    expect(again.statusCode).toBe(401);
    expect(sessionOf(again)).toBeNull();
  });

  it("the callback clears the sign-in cookie, even when it fails", async () => {
    const s = await start();
    const res = await callback("/auth/google/callback?code=c&state=wrong", s.signin);
    expect(res.statusCode).toBe(400);
    const cleared = cookieOf(res, "sj_signin")!;
    expect(cleared.value).toBe("");
    expect(cleared.path).toBe("/");
  });

  it("the nonce in the ID token is bound to the browser's cookie, not just any recent sign-in", async () => {
    const a = await start();
    const b = await start();
    // Google's page for b, but the ID token carries a's nonce.
    const url = approve(b.location, "qa-nonce-swap", { nonce: new URL(a.location).searchParams.get("nonce") });
    expect((await callback(url, b.signin)).statusCode).toBe(401);
  });

  it("a missing or tampered PKCE verifier never gets a session", async () => {
    const s = await start();
    const pending = JSON.parse(s.signin) as Record<string, unknown>;
    const url = approve(s.location, "qa-pkce");
    const before = google.calls.token;
    const { verifier: _, ...noVerifier } = pending;
    expect((await callback(url, JSON.stringify(noVerifier))).statusCode).toBe(400);
    expect((await callback(url, JSON.stringify({ ...pending, verifier: 7 }))).statusCode).toBe(400);
    expect(google.calls.token).toBe(before); // never sent to Google without one
    const wrong = await callback(url, JSON.stringify({ ...pending, verifier: "attacker-chosen" }));
    expect(wrong.statusCode).toBe(401);
    expect(sessionOf(wrong)).toBeNull();
  });

  it("each start gets fresh state, verifier and nonce; the challenge is S256 of the verifier", async () => {
    const a = await start();
    const b = await start();
    const pa = JSON.parse(a.signin) as { state: string; verifier: string; nonce: string };
    const pb = JSON.parse(b.signin) as { state: string; verifier: string; nonce: string };
    expect(new Set([pa.state, pa.verifier, pa.nonce, pb.state, pb.verifier, pb.nonce]).size).toBe(6);
    const q = new URL(a.location).searchParams;
    expect(q.get("code_challenge")).toBe(createHash("sha256").update(pa.verifier).digest("base64url"));
    expect(q.get("code_challenge")).not.toBe(pa.verifier);
    expect(q.get("redirect_uri")).toBe(REDIRECT);
    expect(q.get("scope")).toBe("openid profile");
  });

  it("the redirect URI ignores a spoofed Host header", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/google/start", headers: { host: "evil.example", "x-forwarded-host": "evil.example" } });
    expect(new URL(res.headers.location as string).searchParams.get("redirect_uri")).toBe(REDIRECT);
  });

  it("a mangled sign-in cookie is a 400, not a crash", async () => {
    for (const bad of ["{", "null", "[]", '"str"', "%7B"]) {
      expect((await callback("/auth/google/callback?code=c&state=s", bad)).statusCode).toBe(400);
    }
  });
});

describe("open redirects via returnTo", () => {
  const hostile = [
    "//evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "/\t/evil.example",
    "/\n/evil.example",
    "/ /evil.example",
    "evil.example",
    "",
    "/" + "a".repeat(600),
  ];

  it.each(hostile)("returnTo %j lands on / after a Google round trip", async (returnTo) => {
    const r = await signIn(`qa-redirect-${google.n}`, { returnTo });
    expect(r.cb.statusCode).toBe(302);
    expect(r.cb.headers.location).toBe("/");
  });

  it("a same-site path survives (control)", async () => {
    const r = await signIn("qa-redirect-ok", { returnTo: "/game/abc?tab=chat" });
    expect(r.cb.headers.location).toBe("/game/abc?tab=chat");
  });

  it("a hand-edited sign-in cookie can't smuggle a hostile returnTo (sign-in or cancel)", async () => {
    for (const bad of hostile) {
      const s = await start();
      const pending = { ...(JSON.parse(s.signin) as Record<string, unknown>), returnTo: bad };
      const state = new URL(s.location).searchParams.get("state")!;
      const cancel = await callback(`/auth/google/callback?error=access_denied&state=${state}`, JSON.stringify(pending));
      expect(cancel.statusCode).toBe(302);
      expect(cancel.headers.location).toBe("/");
      const ok = await callback(approve(s.location, `qa-cookie-redirect-${google.n}`), JSON.stringify(pending));
      expect(ok.headers.location).toBe("/");
    }
  });

  it("every safeReturnTo result resolves on our own origin", () => {
    const base = "https://skimjob.example";
    for (const v of [...hostile, "/%2F%2Fevil.example", "/..//evil.example", "/@evil.example", "/;//evil", "/#//evil"]) {
      expect(new URL(safeReturnTo(v), base).origin).toBe(base);
    }
  });
});

describe("cookies", () => {
  it("the sign-in cookie is httpOnly, SameSite=Lax, path /, 10 minutes; the session cookie path /", async () => {
    const s = await start();
    const c = cookieOf(s.res, "sj_signin")!;
    expect(c).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", maxAge: 600 });
    const cb = await callback(approve(s.location, "qa-cookies"), s.signin);
    expect(cookieOf(cb, SESSION_COOKIE)).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  });

  it("an expired sign-in (cookie gone after 10 min) is refused", async () => {
    const s = await start();
    const url = approve(s.location, "qa-late");
    expect((await callback(url, null)).statusCode).toBe(400);
  });

  it("with secure cookies (production) both cookies are Secure", async () => {
    const prod = buildServer({
      db,
      clock,
      secureCookies: true,
      auth: [googleAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT, fetch: fakeFetch, now: () => clock.now() })],
    });
    try {
      const s = await prod.inject({ method: "GET", url: "/auth/google/start" });
      expect(cookieOf(s, "sj_signin")?.secure).toBe(true);
      const signin = cookieOf(s, "sj_signin")!.value;
      const cb = await prod.inject({ method: "GET", url: approve(s.headers.location as string, "qa-secure"), cookies: { sj_signin: signin } });
      expect(cb.statusCode).toBe(302);
      expect(cookieOf(cb, SESSION_COOKIE)?.secure).toBe(true);
    } finally {
      await prod.close();
    }
  });
});

describe("guests and seats", () => {
  const post = async (url: string, session: string | null, payload: Record<string, unknown> = {}) => {
    const res = await app.inject({ method: "POST", url, payload, cookies: session ? { [SESSION_COOKIE]: session } : {} });
    return { res, body: res.json() as LobbyView, session: sessionOf(res) };
  };
  /** A lobby hosted by a fresh guest, joined by another guest; returns the joiner's session. */
  async function lobbyWithGuest(nick: string) {
    const host = (await post("/auth/guest", null, { nickname: `H${nick}` })).session!;
    const game = (await post("/games", host)).body;
    const joiner = (await post(`/invites/${game.inviteCode}/join`, null, { nickname: nick })).session!;
    return { gameId: game.id, host, joiner };
  }
  const seatedAs = async (gameId: string, session: string) => {
    const res = await get(`/games/${gameId}`, { [SESSION_COOKIE]: session });
    return res.statusCode === 200 ? (res.json() as LobbyView).seats.find((s) => s.you) ?? null : null;
  };
  const seatUsers = async (gameId: string) =>
    (await db.query<{ user_id: string | null }>("select user_id from seats where game_id = $1 and bot_personality is null order by seat_no", [gameId])).map((r) => r.user_id);

  it("guest → new Google account: same user, nickname and seat; the old guest session ends", async () => {
    const { gameId, joiner } = await lobbyWithGuest("Rookie");
    const before = (await me(joiner))!;
    expect(before.guest).toBe(true);
    const r = await signIn("qa-new-for-guest", { session: joiner, claims: { name: "Different Name" } });
    expect(r.cb.statusCode).toBe(302);
    const after = (await me(r.session))!;
    expect(after).toEqual({ id: before.id, name: "Rookie", guest: false });
    expect((await seatedAs(gameId, r.session!))?.nickname).toBe("Rookie");
    expect(r.session).not.toBe(joiner);
    expect(await me(joiner)).toBeNull(); // no session fixation
  });

  it("guest → existing Google account: becomes that account; the guest's seat moves in, nothing moves out", async () => {
    // Alice: a Google user hosting her own lobby.
    const alice = (await signIn("qa-alice", { claims: { name: "Alice" } })).session!;
    const aliceUser = (await me(alice))!;
    const aliceGame = (await post("/games", alice)).body.id;
    // Mallory: a guest seated elsewhere, who then signs in as Alice's Google account.
    const { gameId: malloryGame, joiner: mallory } = await lobbyWithGuest("Mallory");
    const malloryUser = (await me(mallory))!;
    const aliceSeatsBefore = await seatUsers(aliceGame);
    const r = await signIn("qa-alice", { session: mallory });
    expect(r.cb.statusCode).toBe(302);
    expect((await me(r.session))!.id).toBe(aliceUser.id);
    expect((await me(r.session))!.name).toBe("Alice");
    // Alice's game is unchanged; the guest's seat (under its nickname) is now the account's (adoptGuest).
    expect(await seatUsers(aliceGame)).toEqual(aliceSeatsBefore);
    expect(await seatUsers(malloryGame)).not.toContain(malloryUser.id);
    expect(await seatUsers(malloryGame)).toContain(aliceUser.id);
    expect((await seatedAs(malloryGame, r.session!))?.nickname).toBe("Mallory");
    // The guest user was not given Alice's external id.
    const [row] = await db.query<{ external_id: string | null }>("select external_id from users where id = $1", [malloryUser.id]);
    expect(row?.external_id).toBeNull();
    // Alice's own session still works.
    expect((await me(alice))!.id).toBe(aliceUser.id);
  });

  it("adoption only takes the signed-in browser's own guest: other guests' and accounts' seats stay put", async () => {
    const { gameId, host, joiner: bystander } = await lobbyWithGuest("Bystander");
    const hostUser = (await me(host))!;
    const bystanderUser = (await me(bystander))!;
    const before = await seatUsers(gameId);
    // An unrelated guest signs in to an existing account: nothing in this lobby changes.
    await signIn("qa-adopt-target");
    const other = (await post("/auth/guest", null, { nickname: "Other" })).session!;
    await signIn("qa-adopt-target", { session: other });
    expect(await seatUsers(gameId)).toEqual(before);
    // A Google user (not a guest) switching accounts carries nothing along.
    const bob = (await signIn("qa-bob")).session!;
    const bobUser = (await me(bob))!;
    const bobGame = (await post("/games", bob)).body.id;
    await signIn("qa-adopt-target", { session: bob });
    expect(await seatUsers(bobGame)).toEqual([bobUser.id]);
    expect(await seatUsers(gameId)).toEqual([hostUser.id, bystanderUser.id]);
  });

  it("guest and account in the same lobby: the account keeps its seat, the guest's goes, host role moves", async () => {
    const acct = (await signIn("qa-same-lobby", { claims: { name: "Acct" } })).session!;
    const acctUser = (await me(acct))!;
    const guestHost = (await post("/auth/guest", null, { nickname: "GuestHost" })).session!;
    const game = (await post("/games", guestHost)).body;
    expect((await post(`/invites/${game.inviteCode}/join`, acct, { nickname: "AcctSeat" })).res.statusCode).toBe(200);
    expect(await seatUsers(game.id)).toHaveLength(2);
    const r = await signIn("qa-same-lobby", { session: guestHost });
    expect(await seatUsers(game.id)).toEqual([acctUser.id]);
    const view = (await get(`/games/${game.id}`, { [SESSION_COOKIE]: r.session! })).json() as LobbyView & { youAreHost?: boolean };
    expect(view.seats.find((s) => s.you)?.nickname).toBe("AcctSeat");
    const [g] = await db.query<{ host_user_id: string }>("select host_user_id from games where id = $1", [game.id]);
    expect(g?.host_user_id).toBe(acctUser.id);
  });

  it("guest and account in the same started game: both seats stay, the guest's with the guest user", async () => {
    const acct = (await signIn("qa-same-run")).session!;
    const acctUser = (await me(acct))!;
    const guestHost = (await post("/auth/guest", null, { nickname: "RunHost" })).session!;
    const guestUser = (await me(guestHost))!;
    const game = (await post("/games", guestHost)).body;
    await post(`/invites/${game.inviteCode}/join`, acct, { nickname: "RunAcct" });
    expect((await post(`/games/${game.id}/start`, guestHost)).res.statusCode).toBe(200);
    await signIn("qa-same-run", { session: guestHost });
    expect(await seatUsers(game.id)).toEqual([guestUser.id, acctUser.id]);
  });

  it("GET /me/games: signed out is 401; lists only your own seats; follows an adoption", async () => {
    expect((await get("/me/games")).statusCode).toBe(401);
    const { gameId, host, joiner } = await lobbyWithGuest("Lister");
    const games = async (s: string) => ((await get("/me/games", { [SESSION_COOKIE]: s })).json() as { games: { id: string; nickname: string; youAreHost: boolean }[] }).games;
    expect(await games(joiner)).toEqual([expect.objectContaining({ id: gameId, nickname: "Lister", youAreHost: false })]);
    expect((await games(host)).map((g) => g.id)).toEqual([gameId]);
    const stranger = (await signIn("qa-lister-acct")).session!;
    expect(await games(stranger)).toEqual([]);
    const r = await signIn("qa-lister-acct", { session: joiner });
    expect((await games(r.session!)).map((g) => g.id)).toEqual([gameId]);
    expect(await games(stranger)).toEqual([expect.objectContaining({ id: gameId, nickname: "Lister" })]);
  });

  it("GET /me/games leaks nothing hidden: no roles, player ids, invite codes or other seats' users", async () => {
    const host = (await signIn("qa-mg-host")).session!;
    const game = (await post("/games", host)).body;
    await post(`/invites/${game.inviteCode}/join`, null, { nickname: "MgPal" });
    expect((await post(`/games/${game.id}/start`, host)).res.statusCode).toBe(200);
    const res = await get("/me/games", { [SESSION_COOKIE]: host });
    const [row] = (res.json() as { games: Record<string, unknown>[] }).games;
    expect(Object.keys(row!).sort()).toEqual(["host", "id", "nickname", "seats", "sessionLength", "status", "youAreHost"]);
    expect(row).toMatchObject({ id: game.id, status: "running", youAreHost: true, seats: 2 });
    const text = res.body;
    expect(text).not.toContain(game.inviteCode);
    expect(text).not.toMatch(/"(role|playerId|player_id|user_id|userId|seed|faction|stash)"/);
  });

  it("a Google user signing in to another Google account doesn't relink either account", async () => {
    const one = (await signIn("qa-one")).session!;
    const oneUser = (await me(one))!;
    const two = await signIn("qa-two", { session: one });
    const twoUser = (await me(two.session))!;
    expect(twoUser.id).not.toBe(oneUser.id);
    expect((await me((await signIn("qa-one")).session))!.id).toBe(oneUser.id);
    expect(await me(one)).toBeNull();
  });

  it("two guests racing to claim the same new account: one links, the other becomes that account", async () => {
    const a = (await post("/auth/guest", null, { nickname: "RaceA" })).session!;
    const b = (await post("/auth/guest", null, { nickname: "RaceB" })).session!;
    const [ra, rb] = await Promise.all([signIn("qa-race", { session: a }), signIn("qa-race", { session: b })]);
    expect([ra.cb.statusCode, rb.cb.statusCode]).toEqual([302, 302]);
    expect((await me(ra.session))!.id).toBe((await me(rb.session))!.id);
    const [{ n }] = (await db.query<{ n: number }>("select count(*)::int as n from users where external_id = 'google:qa-race'")) as [{ n: number }];
    expect(n).toBe(1);
  });

  it("an expired guest session signing in doesn't link the old guest", async () => {
    const g = (await post("/auth/guest", null, { nickname: "Stale" })).session!;
    const gUser = (await me(g))!;
    clock.advance(31 * 24 * 60 * 60 * 1000);
    const r = await signIn("qa-after-expiry", { session: g });
    expect((await me(r.session))!.id).not.toBe(gUser.id);
  });
});

describe("sign-out and re-sign-in close sockets", () => {
  class Sock {
    closed: number | null = null;
    constructor(readonly ws: WebSocket) {
      ws.on("close", (code) => (this.closed = code));
    }
  }
  async function startedGameWithGoogleHost(sub: string) {
    const host = (await signIn(sub, { claims: { name: "Boss" } })).session!;
    const game = (await app.inject({ method: "POST", url: "/games", payload: {}, cookies: { [SESSION_COOKIE]: host } })).json() as LobbyView;
    const guest = sessionOf(await app.inject({ method: "POST", url: `/invites/${game.inviteCode}/join`, payload: { nickname: "Pal" } }))!;
    const started = await app.inject({ method: "POST", url: `/games/${game.id}/start`, payload: {}, cookies: { [SESSION_COOKIE]: host } });
    expect(started.statusCode).toBe(200);
    const open = async (s: string) => new Sock(await app.injectWS(`/games/${game.id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${s}` } }));
    return { host, guest, open };
  }
  const quick = { interval: 2, timeout: 5000 };

  it("POST /auth/logout from a Google session closes its sockets (4401), not others'", async () => {
    const { host, guest, open } = await startedGameWithGoogleHost("qa-sock-1");
    const h = await open(host);
    const g = await open(guest);
    await app.inject({ method: "POST", url: "/auth/logout", cookies: { [SESSION_COOKIE]: host } });
    await vi.waitFor(() => expect(h.closed).toBe(CLOSE_SIGNED_OUT), quick);
    expect(g.closed).toBeNull();
    expect(await me(host)).toBeNull();
    g.ws.close();
  });

  it("signing in again over a live session closes the old session's sockets", async () => {
    const { host, open } = await startedGameWithGoogleHost("qa-sock-2");
    const h = await open(host);
    const r = await signIn("qa-sock-2", { session: host });
    expect(r.cb.statusCode).toBe(302);
    await vi.waitFor(() => expect(h.closed).toBe(CLOSE_SIGNED_OUT), quick);
    const fresh = await open(r.session!);
    expect(fresh.closed).toBeNull();
    fresh.ws.close();
  });
});

describe("Google off (no GOOGLE_CLIENT_ID/SECRET)", () => {
  let off: FastifyInstance;
  beforeAll(async () => {
    off = buildServer({ db, clock, ...serverDeps(loadConfig({ DEV_LOGIN: "1" })) });
    await off.ready();
  });
  afterAll(() => off.close());

  it("lists only dev; Google's start and callback 404 and never touch Google", async () => {
    expect((await off.inject({ method: "GET", url: "/auth/providers" })).json()).toEqual({ providers: ["dev"] });
    const before = { ...google.calls };
    expect((await off.inject({ method: "GET", url: "/auth/google/start?returnTo=/" })).statusCode).toBe(404);
    const cb = await off.inject({ method: "GET", url: "/auth/google/callback?code=c&state=s", cookies: { sj_signin: JSON.stringify({ provider: "google", state: "s", verifier: "v", nonce: "n" }) } });
    expect(cb.statusCode).toBe(404);
    expect(sessionOf(cb)).toBeNull();
    expect(google.calls).toEqual(before);
  });

  it("dev login still works", async () => {
    const s = await off.inject({ method: "GET", url: "/auth/dev/start?hint=Riya&returnTo=/games" });
    const loc = new URL(s.headers.location as string);
    const cb = await off.inject({ method: "GET", url: `${loc.pathname}${loc.search}`, cookies: { sj_signin: cookieOf(s, "sj_signin")!.value } });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe("/games");
    const u = await off.inject({ method: "GET", url: "/me", cookies: { [SESSION_COOKIE]: sessionOf(cb)! } });
    expect(u.json().user).toMatchObject({ name: "Riya", guest: false });
  });

  it("production without Google lists no providers at all", async () => {
    expect(serverDeps(loadConfig({ NODE_ENV: "production", DEV_LOGIN: "1", PUBLIC_ORIGIN: "https://skimjob.example" })).auth).toEqual([]);
  });
});

describe("callback under /api (dev proxy and production)", () => {
  const PROD_REDIRECT = "https://skimjob.duckdns.org/api/auth/google/callback";
  // A production-shaped server: Google from loadConfig, Secure cookies, serving a web app (SPA fallback on).
  let prod: FastifyInstance;
  beforeAll(async () => {
    const config = loadConfig({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, NODE_ENV: "production", PUBLIC_ORIGIN: "https://skimjob.duckdns.org" });
    expect(config.google?.redirectUri).toBe(PROD_REDIRECT);
    prod = buildServer({
      db,
      clock,
      secureCookies: true,
      webDir: fileURLToPath(new URL("../../web", import.meta.url)), // has an index.html
      auth: [googleAuthProvider({ ...config.google!, fetch: fakeFetch, now: () => clock.now() })],
    });
    await prod.ready();
  });
  afterAll(() => prod.close());
  const pget = (url: string, cookies: Record<string, string> = {}) => prod.inject({ method: "GET", url, cookies });

  it("production: /api/auth/google/start → Google → /api/auth/google/callback signs in and returns to returnTo", async () => {
    const s = await pget("/api/auth/google/start?returnTo=/games");
    expect(s.statusCode).toBe(302);
    expect(new URL(s.headers.location as string).searchParams.get("redirect_uri")).toBe(PROD_REDIRECT);
    const signin = cookieOf(s, "sj_signin")!;
    expect(signin).toMatchObject({ path: "/", secure: true, httpOnly: true });
    const back = new URL(approve(s.headers.location as string, "qa-prod-api"), "https://x");
    const registered = new URL(s.headers.location as string).searchParams.get("redirect_uri")!;
    // The browser comes back to exactly the registered URI's path.
    const cb = await pget(`${new URL(registered).pathname}${back.search}`, { sj_signin: signin.value });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe("/games");
    expect(cookieOf(cb, SESSION_COOKIE)?.secure).toBe(true);
    const who = await prod.inject({ method: "GET", url: "/api/me", cookies: { [SESSION_COOKIE]: sessionOf(cb)! } });
    expect(who.json().user).toMatchObject({ guest: false });
  });

  it("production: the callback is never the SPA page, under /api or at the old bare path", async () => {
    for (const path of ["/api/auth/google/callback", "/auth/google/callback"]) {
      const res = await pget(`${path}?code=c&state=s`);
      expect(res.statusCode, path).toBe(400);
      expect(res.headers["content-type"], path).toMatch(/json/);
      expect(res.body, path).not.toContain("<div id=\"root\">");
    }
  });

  it("the old bare path is the same route: a sign-in started under /api finishes there too, with the registered redirect_uri", async () => {
    const s = await pget("/api/auth/google/start");
    const back = new URL(approve(s.headers.location as string, "qa-prod-bare"), "https://x");
    // The fake token endpoint refuses unless redirect_uri equals the one sent to Google.
    const cb = await pget(`/auth/google/callback${back.search}`, { sj_signin: cookieOf(s, "sj_signin")!.value });
    expect(cb.statusCode).toBe(302);
    expect(sessionOf(cb)).not.toBeNull();
  });

  it("dev: the Vite proxy strips /api, so the bare route is what the server sees; the redirect URI defaults to Vite's /api path", async () => {
    const dev = loadConfig({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, DEV_LOGIN: "1" });
    expect(dev.google?.redirectUri).toBe("http://localhost:5173/api/auth/google/callback");
    // `app` (dev-shaped, REDIRECT under Vite's /api) via the proxied path and the direct /api one.
    for (const path of ["/auth/google/callback", "/api/auth/google/callback"]) {
      const s = await start();
      expect(new URL(s.location).searchParams.get("redirect_uri")).toBe(REDIRECT);
      const back = new URL(approve(s.location, `qa-dev-${path.length}`), "http://x");
      const cb = await callback(`${path}${back.search}`, s.signin);
      expect(cb.statusCode, path).toBe(302);
      expect(sessionOf(cb), path).not.toBeNull();
    }
  });

  it("an /api look-alike prefix isn't stripped (no route confusion)", async () => {
    expect((await pget("/apiauth/google/callback?code=c&state=s")).headers["content-type"]).not.toMatch(/json/);
    expect((await get("/apix/auth/google/start")).statusCode).toBe(404);
  });
});
