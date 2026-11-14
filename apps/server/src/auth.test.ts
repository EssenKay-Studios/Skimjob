// Redirect sign-in (docs/m2-plan.md M2-12): the dev stub and Google share one
// suite; Google is the real provider with a fake Google behind its `fetch`
// (authorize page played by the test, token endpoint, JWKS).
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devAuthProvider, SESSION_COOKIE, type AuthProvider } from "./auth";
import { fakeClock, type FakeClock } from "./clock";
import { loadConfig, StartupError } from "./config";
import type { Db } from "./db";
import { GOOGLE_ENDPOINTS, googleAuthProvider } from "./google";
import { buildServer } from "./server";
import { serverDeps } from "./startup";
import { testDb } from "./testkit";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const CLIENT_SECRET = "test-secret";
const REDIRECT = "http://localhost:5173/api/auth/google/callback";

/** A Google stand-in: issues codes on "consent", swaps them for signed ID tokens, serves its JWKS. */
function fakeGoogle(clock: FakeClock) {
  const newKey = (kid: string) => ({ kid, ...generateKeyPairSync("rsa", { modulusLength: 2048 }) });
  let keys = [newKey("k1")];
  const codes = new Map<string, { challenge: string; redirectUri: string; claims: Record<string, unknown>; kid?: string | undefined; signWith?: KeyObject | undefined }>();
  const calls = { token: 0, jwks: 0 };
  let n = 0;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } });

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === GOOGLE_ENDPOINTS.jwks) {
      calls.jwks++;
      return json({ keys: keys.map((k) => ({ ...k.publicKey.export({ format: "jwk" }), kid: k.kid, alg: "RS256", use: "sig" })) }, { headers: { "cache-control": "public, max-age=3600" } });
    }
    if (url === GOOGLE_ENDPOINTS.token && init?.method === "POST") {
      calls.token++;
      const f = new URLSearchParams(String(init.body));
      const grant = codes.get(f.get("code") ?? "");
      codes.delete(f.get("code") ?? ""); // single use
      const pkce = createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url");
      if (
        !grant ||
        f.get("grant_type") !== "authorization_code" ||
        f.get("client_id") !== CLIENT_ID ||
        f.get("client_secret") !== CLIENT_SECRET ||
        f.get("redirect_uri") !== grant.redirectUri ||
        pkce !== grant.challenge
      ) {
        return json({ error: "invalid_grant" }, { status: 400 });
      }
      const kid = grant.kid ?? keys[0]!.kid;
      const head = b64({ alg: "RS256", kid, typ: "JWT" });
      const body = b64(grant.claims);
      const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), grant.signWith ?? keys.find((k) => k.kid === kid)!.privateKey);
      return json({ access_token: "at", token_type: "Bearer", expires_in: 3599, id_token: `${head}.${body}.${sig.toString("base64url")}` });
    }
    return new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;

  return {
    fetch,
    calls,
    rotate: () => (keys = [newKey(`k${keys.length + 1}`), ...keys]),
    otherKey: () => newKey("evil").privateKey,
    /** The user clicks "Continue" on Google's page: the callback URL Google sends the browser to. */
    approve(authorize: string, sub: string, opts: { claims?: Record<string, unknown>; kid?: string; signWith?: KeyObject } = {}) {
      const q = new URL(authorize).searchParams;
      const code = `code-${++n}`;
      const t = Math.floor(clock.now() / 1000);
      codes.set(code, {
        challenge: q.get("code_challenge")!,
        redirectUri: q.get("redirect_uri")!,
        claims: { iss: "https://accounts.google.com", aud: CLIENT_ID, azp: CLIENT_ID, sub, name: sub, iat: t, exp: t + 3600, nonce: q.get("nonce"), ...opts.claims },
        kid: opts.kid,
        signWith: opts.signWith,
      });
      return `${q.get("redirect_uri")}?${new URLSearchParams({ code, state: q.get("state")!, scope: "openid profile" })}`;
    },
  };
}

let db: Db;
let clock: FakeClock;
let google: ReturnType<typeof fakeGoogle>;
let app: FastifyInstance;
beforeAll(async () => {
  db = await testDb();
  clock = fakeClock(Date.UTC(2026, 10, 3));
  google = fakeGoogle(clock);
  const providers: AuthProvider[] = [
    googleAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT, fetch: google.fetch, now: () => clock.now() }),
    devAuthProvider(),
  ];
  app = buildServer({ db, clock, auth: providers });
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

const sessionOf = (res: { cookies: { name: string; value: string }[] }) => res.cookies.find((c) => c.name === SESSION_COOKIE && c.value)?.value ?? null;
const me = async (session: string | null) => {
  const res = await app.inject({ method: "GET", url: "/me", cookies: session ? { [SESSION_COOKIE]: session } : {} });
  return res.statusCode === 200 ? (res.json().user as { id: string; name: string; guest: boolean; tips: boolean }) : null;
};
const guest = async (nickname: string) => sessionOf(await app.inject({ method: "POST", url: "/auth/guest", payload: { nickname } }))!;
const api = async (method: "GET" | "POST", url: string, session: string, payload?: object) =>
  app.inject({ method, url, cookies: { [SESSION_COOKIE]: session }, ...(payload ? { payload } : {}) });
/** A new lobby hosted by `session`: its id and invite code. */
const hostGame = async (session: string) => {
  const res = await api("POST", "/games", session, {});
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; inviteCode: string };
};
const joinGame = async (code: string, session: string, nickname: string) => expect((await api("POST", `/invites/${code}/join`, session, { nickname })).statusCode).toBeLessThan(300);
const seatsIn = (gameId: string) => db.query<{ user_id: string; nickname: string }>("select user_id, nickname from seats where game_id = $1 order by seat_no", [gameId]);
const hostOf = async (gameId: string) => (await db.query<{ host_user_id: string }>("select host_user_id from games where id = $1", [gameId]))[0]!.host_user_id;

/** /auth/<p>/start: the provider URL and the sign-in cookie. */
async function start(provider: string, q = "", session?: string) {
  const res = await app.inject({ method: "GET", url: `/auth/${provider}/start${q}`, cookies: session ? { [SESSION_COOKIE]: session } : {} });
  expect(res.statusCode).toBe(302);
  return { location: res.headers.location as string, signin: res.cookies.find((c) => c.name === "sj_signin")! };
}
/** The browser arrives at the callback URL (path + query only; the host is the redirect URI's). */
const callback = (url: string, signin: string | null, session?: string) => {
  const u = new URL(url);
  const cookies: Record<string, string> = {};
  if (signin) cookies.sj_signin = signin;
  if (session) cookies[SESSION_COOKIE] = session;
  // The path as registered (Google's is under /api, which the server serves like the bare route).
  return app.inject({ method: "GET", url: `${u.pathname}${u.search}`, cookies });
};

/** The two providers, as the browser sees them: start → (provider page) → callback URL. */
const flows = {
  dev: { consent: (location: string) => location, hint: (who: string) => `?hint=${who}` },
  google: { consent: (location: string, who: string) => google.approve(location, who), hint: () => "" },
};

describe.each(Object.entries(flows))("redirect sign-in: %s (m2-plan M2-12, shared suite)", (name, flow) => {
  const signIn = async (who: string, returnTo = "/games", session?: string) => {
    const sep = flow.hint(who) ? "&" : "?";
    const s = await start(name, `${flow.hint(who)}${sep}returnTo=${encodeURIComponent(returnTo)}`, session);
    return { ...s, cb: await callback(flow.consent(s.location, who), s.signin.value, session) };
  };

  it("signs in a non-guest user, the same one every time, and returns to returnTo", async () => {
    const one = await signIn("Riya");
    expect(one.cb.statusCode).toBe(302);
    expect(one.cb.headers.location).toBe("/games");
    const u1 = await me(sessionOf(one.cb));
    expect(u1).toMatchObject({ name: "Riya", guest: false });
    const two = await signIn("Riya");
    expect((await me(sessionOf(two.cb)))!.id).toBe(u1!.id);
    const rows = await db.query<{ external_id: string }>("select external_id from users where id = $1", [u1!.id]);
    expect(rows[0]!.external_id).toBe(`${name}:Riya`);
  });

  it("refuses a forged state, a missing sign-in cookie, and a replayed callback", async () => {
    const s = await start(name, flow.hint("Max"));
    const back = new URL(flow.consent(s.location, "Max"));
    const forged = new URL(back);
    forged.searchParams.set("state", "forged");
    expect((await callback(forged.href, s.signin.value)).statusCode).toBe(400);
    expect((await callback(back.href, null)).statusCode).toBe(400);
    const ok = await callback(back.href, s.signin.value);
    expect(ok.statusCode).toBe(302);
    // The sign-in cookie is cleared on the way back, so the same callback can't be used again.
    expect(ok.cookies.find((c) => c.name === "sj_signin")?.value).toBe("");
    expect((await callback(back.href, null)).statusCode).toBe(400);
  });

  it("a guest who signs in with a new account keeps their user (and so their seats)", async () => {
    const g = await guest("Tamsin");
    const before = await me(g);
    const { cb } = await signIn(`fresh-${name}`, "/", g);
    const after = await me(sessionOf(cb));
    expect(after).toMatchObject({ id: before!.id, name: "Tamsin", guest: false });
    // The guest session was replaced, not reused.
    expect(sessionOf(cb)).not.toBe(g);
    expect(await me(g)).toBeNull();
  });

  it("a guest who signs in to an account that already exists becomes that account", async () => {
    const owner = await me(sessionOf((await signIn("Owner")).cb));
    const g = await guest("Drifter");
    const { cb } = await signIn("Owner", "/", g);
    expect((await me(sessionOf(cb)))!.id).toBe(owner!.id);
  });

  it("a guest who signs in to an existing account brings their seats and host roles along", async () => {
    const ownerSession = sessionOf((await signIn(`Keeper-${name}`)).cb)!;
    const owner = (await me(ownerSession))!;
    const g = await guest("Stray");
    const gid = (await me(g))!.id;
    const other = await guest("Bystander");
    const otherId = (await me(other))!.id;
    // hosted: the guest hosts a lobby the account isn't in; joined: someone else's lobby the guest sits in.
    const hosted = await hostGame(g);
    await joinGame(hosted.inviteCode, other, "Bystander");
    const joined = await hostGame(other);
    await joinGame(joined.inviteCode, g, "Stray");
    // clashLobby / clashRunning: both the guest and the account are seated.
    const clashLobby = await hostGame(g);
    await joinGame(clashLobby.inviteCode, ownerSession, "Keeper");
    const clashRunning = await hostGame(other);
    await joinGame(clashRunning.inviteCode, g, "Stray");
    await joinGame(clashRunning.inviteCode, ownerSession, "Keeper");
    await db.query("update games set status = 'running', config = '{}'::json where id = $1", [clashRunning.id]);

    const { cb } = await signIn(`Keeper-${name}`, "/", g);
    const session = sessionOf(cb)!;
    expect((await me(session))!.id).toBe(owner.id);

    expect(await hostOf(hosted.id)).toBe(owner.id);
    expect(await seatsIn(hosted.id)).toEqual([{ user_id: owner.id, nickname: "Stray" }, { user_id: otherId, nickname: "Bystander" }]);
    expect(await hostOf(joined.id)).toBe(otherId);
    expect(await seatsIn(joined.id)).toEqual([{ user_id: otherId, nickname: "Bystander" }, { user_id: owner.id, nickname: "Stray" }]);
    // Same game twice: the account keeps its own seat (and takes the host role); the lobby drops the guest's.
    expect(await hostOf(clashLobby.id)).toBe(owner.id);
    expect(await seatsIn(clashLobby.id)).toEqual([{ user_id: owner.id, nickname: "Keeper" }]);
    // A started game can't lose a player, so the guest's seat stays (with nobody signed in as it).
    expect(await seatsIn(clashRunning.id)).toEqual([
      { user_id: otherId, nickname: "Bystander" },
      { user_id: gid, nickname: "Stray" },
      { user_id: owner.id, nickname: "Keeper" },
    ]);
    // The account can open every game it now holds.
    for (const id of [hosted.id, joined.id, clashLobby.id]) expect((await api("GET", `/games/${id}`, session)).statusCode).toBe(200);
    // Nothing of the bystander's moved, and a later guest can't pull the account's seats away.
    expect((await me(other))!.id).toBe(otherId);
    const thief = await guest("Thief");
    await signIn(`Thief-${name}`, "/", thief);
    expect(await hostOf(hosted.id)).toBe(owner.id);
  });

  it("cancelling on the provider's page goes back signed out", async () => {
    const s = await start(name, `${flow.hint("Nope")}${flow.hint("Nope") ? "&" : "?"}returnTo=%2Flobby%2F1`);
    const state = new URL(s.location).searchParams.get("state")!;
    const res = await callback(`http://x/auth/${name}/callback?error=access_denied&state=${state}`, s.signin.value);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/lobby/1");
    expect(sessionOf(res)).toBeNull();
    // ...but only for a sign-in this browser started.
    expect((await callback(`http://x/auth/${name}/callback?error=access_denied&state=other`, s.signin.value)).statusCode).toBe(400);
  });
});

// design §15.6: the Tips setting is one field on the user, on by default.
describe("Tips setting (S3b.3)", () => {
  const patch = (session: string | null, payload: unknown) =>
    app.inject({ method: "PATCH", url: "/me", cookies: session ? { [SESSION_COOKIE]: session } : {}, payload: payload as object });
  const tipsOf = async (session: string) => (await me(session))!.tips;

  it("is on by default for a guest and for an account", async () => {
    expect(await tipsOf(await guest("Tipsy"))).toBe(true);
    const s = await start("dev", "?hint=TipsAcct");
    expect(await tipsOf(sessionOf(await callback(s.location, s.signin.value))!)).toBe(true);
  });

  it("saves on the signed-in user, across sessions, and only for them", async () => {
    const a = await guest("Offa");
    const b = await guest("Staysa");
    const res = await patch(a, { tips: false });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ name: "Offa", tips: false });
    expect(await tipsOf(a)).toBe(false);
    expect(await tipsOf(b)).toBe(true);
    expect((await patch(a, { tips: true })).json().user.tips).toBe(true);
    expect(await tipsOf(a)).toBe(true);
  });

  it("follows an account to a new session and survives a guest signing in to it", async () => {
    const g = await guest("Wasguest");
    expect((await patch(g, { tips: false })).statusCode).toBe(200);
    const s = await start("dev", "?hint=Linked", g);
    const signedIn = sessionOf(await callback(s.location, s.signin.value, g))!;
    expect(await tipsOf(signedIn)).toBe(false);
    const again = await start("dev", "?hint=Linked");
    expect(await tipsOf(sessionOf(await callback(again.location, again.signin.value))!)).toBe(false);
  });

  it("refuses a signed-out caller and anything that is not a boolean", async () => {
    expect((await patch(null, { tips: false })).statusCode).toBe(401);
    const g = await guest("Strict");
    for (const bad of [{}, { tips: "no" }, { tips: 0 }, { tips: null }, { tips: false, name: "Hacked" }, { tips: false, guest: false }, null]) expect((await patch(g, bad)).statusCode).toBe(400);
    expect(await tipsOf(g)).toBe(true);
  });
});

describe("Google provider (OIDC: PKCE, nonce, ID token checks)", () => {
  const begin = async () => start("google", "?returnTo=%2F");

  it("asks Google for the code flow with PKCE S256, state, nonce and our redirect URI", async () => {
    const { location, signin } = await begin();
    const u = new URL(location);
    expect(`${u.origin}${u.pathname}`).toBe(GOOGLE_ENDPOINTS.authorize);
    const q = u.searchParams;
    const pending = JSON.parse(signin.value) as { state: string; verifier: string; nonce: string };
    expect(Object.fromEntries(q)).toMatchObject({ client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: "code", scope: "openid profile", code_challenge_method: "S256", state: pending.state, nonce: pending.nonce });
    expect(q.get("code_challenge")).toBe(createHash("sha256").update(pending.verifier).digest("base64url"));
    expect(location).not.toContain(pending.verifier);
    expect(location).not.toContain(CLIENT_SECRET);
    expect(signin).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  });

  it("refuses an ID token whose nonce isn't this sign-in's (replayed or injected token)", async () => {
    const { location, signin } = await begin();
    const res = await callback(google.approve(location, "Nonce", { claims: { nonce: "someone-elses" } }), signin.value);
    expect(res.statusCode).toBe(401);
    expect(sessionOf(res)).toBeNull();
    const none = await begin();
    expect((await callback(google.approve(none.location, "Nonce", { claims: { nonce: undefined } }), none.signin.value)).statusCode).toBe(401);
  });

  it("refuses a sign-in cookie without a nonce or verifier", async () => {
    const { location, signin } = await begin();
    const back = google.approve(location, "NoNonce");
    const { nonce: _n, ...noNonce } = JSON.parse(signin.value) as Record<string, unknown>;
    expect((await callback(back, JSON.stringify(noNonce))).statusCode).toBe(400);
    const { verifier: _v, ...noVerifier } = JSON.parse(signin.value) as Record<string, unknown>;
    expect((await callback(back, JSON.stringify(noVerifier))).statusCode).toBe(400);
  });

  it("refuses a code redeemed with the wrong PKCE verifier", async () => {
    const { location, signin } = await begin();
    const back = google.approve(location, "Pkce");
    const res = await callback(back, JSON.stringify({ ...JSON.parse(signin.value), verifier: "not-the-verifier" }));
    expect(res.statusCode).toBe(401);
  });

  it.each([
    ["another app's audience", { aud: "other.apps.googleusercontent.com" }],
    ["a foreign issuer", { iss: "https://evil.example" }],
    ["an expired token", { exp: Math.floor(Date.UTC(2026, 10, 3) / 1000) - 3600 }],
    ["a token issued in the future", { iat: Math.floor(Date.UTC(2026, 10, 3) / 1000) + 3600 }],
    ["no subject", { sub: "" }],
    ["several audiences without azp = us", { aud: [CLIENT_ID, "other"], azp: "other" }],
  ])("refuses %s", async (_label, claims) => {
    const { location, signin } = await begin();
    const res = await callback(google.approve(location, "Claims", { claims }), signin.value);
    expect(res.statusCode).toBe(401);
  });

  it("refuses a token not signed by Google's keys, or with an unknown key id", async () => {
    const forged = await begin();
    expect((await callback(google.approve(forged.location, "Forged", { signWith: google.otherKey() }), forged.signin.value)).statusCode).toBe(401);
    const unknown = await begin();
    expect((await callback(google.approve(unknown.location, "Forged", { kid: "nope", signWith: google.otherKey() }), unknown.signin.value)).statusCode).toBe(401);
  });

  it("caches the JWKS and refetches it when Google rotates its keys", async () => {
    const a = await begin();
    expect((await callback(google.approve(a.location, "Rot"), a.signin.value)).statusCode).toBe(302);
    const fetched = google.calls.jwks;
    const b = await begin();
    expect((await callback(google.approve(b.location, "Rot"), b.signin.value)).statusCode).toBe(302);
    expect(google.calls.jwks).toBe(fetched);
    google.rotate();
    clock.advance(61_000);
    const c = await begin();
    expect((await callback(google.approve(c.location, "Rot"), c.signin.value)).statusCode).toBe(302);
    expect(google.calls.jwks).toBe(fetched + 1);
  });

  it("uses a Google name that breaks the nickname rules only as far as it can", async () => {
    const long = await begin();
    const cb = await callback(google.approve(long.location, "sub-long", { claims: { name: "A".repeat(40), given_name: "Ada" } }), long.signin.value);
    expect((await me(sessionOf(cb)))!.name).toBe("Ada");
    const bot = await begin();
    const cb2 = await callback(google.approve(bot.location, "sub-bot", { claims: { name: "RiyaB", given_name: undefined } }), bot.signin.value);
    expect((await me(sessionOf(cb2)))!.name).toBe("Crook");
  });

  it("a Google outage is a 502, not a crash", async () => {
    const down = googleAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT, fetch: async () => { throw new TypeError("fetch failed"); } });
    const downApp = buildServer({ db, clock, auth: [down] });
    const s = await downApp.inject({ method: "GET", url: "/auth/google/start" });
    const state = new URL(s.headers.location as string).searchParams.get("state");
    const signin = s.cookies.find((c) => c.name === "sj_signin")!.value;
    const res = await downApp.inject({ method: "GET", url: `/auth/google/callback?code=c&state=${state}`, cookies: { sj_signin: signin } });
    expect(res.statusCode).toBe(502);
    await downApp.close();
  });
});

describe("Google sign-in config (docs/deploy.md)", () => {
  const keys = { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET };

  it("is off without a client id, and the dev stub works as before", () => {
    expect(loadConfig({}).google).toBeNull();
    expect(serverDeps(loadConfig({ DEV_LOGIN: "1" })).auth?.map((p) => p.name)).toEqual(["dev"]);
  });

  it("is on with id + secret; the callback is GOOGLE_REDIRECT_URL, else PUBLIC_ORIGIN's (dev: Vite's) /api/auth/google/callback", () => {
    const local = loadConfig({ ...keys, GOOGLE_REDIRECT_URL: REDIRECT, DEV_LOGIN: "1" });
    expect(local.google).toEqual({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT });
    expect(serverDeps(local).auth?.map((p) => p.name)).toEqual(["google", "dev"]);
    const prod = loadConfig({ ...keys, NODE_ENV: "production", PUBLIC_ORIGIN: "https://skimjob.fly.dev" });
    expect(prod.google?.redirectUri).toBe("https://skimjob.fly.dev/api/auth/google/callback");
    expect(serverDeps(prod).auth?.map((p) => p.name)).toEqual(["google"]);
    // The owner's OAuth client (Lightsail, docs/deploy.md): these exact URIs are registered.
    expect(loadConfig({ ...keys, NODE_ENV: "production", PUBLIC_ORIGIN: "https://skimjob.duckdns.org" }).google?.redirectUri).toBe(
      "https://skimjob.duckdns.org/api/auth/google/callback",
    );
    expect(loadConfig(keys).google?.redirectUri).toBe("http://localhost:5173/api/auth/google/callback");
  });

  it.each([
    [{ GOOGLE_CLIENT_ID: CLIENT_ID }, /both/],
    [{ GOOGLE_CLIENT_SECRET: CLIENT_SECRET }, /both/],
    [{ ...keys, NODE_ENV: "production" }, /GOOGLE_REDIRECT_URL/],
    [{ ...keys, GOOGLE_REDIRECT_URL: "https://skimjob.fly.dev/elsewhere" }, /ending in/],
    [{ ...keys, GOOGLE_REDIRECT_URL: "ftp://x/api/auth/google/callback" }, /ending in/],
    // Not under /api: Vite's dev proxy wouldn't reach it.
    [{ ...keys, GOOGLE_REDIRECT_URL: "http://localhost:5173/auth/google/callback" }, /ending in \/api\/auth\/google\/callback/],
    [{ ...keys, GOOGLE_REDIRECT_URL: "not a url" }, /ending in/],
  ])("refuses to start with %j", (env, message) => {
    expect(() => loadConfig(env)).toThrow(StartupError);
    expect(() => loadConfig(env)).toThrow(message);
  });
});
