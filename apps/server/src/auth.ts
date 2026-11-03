// Identity: users, sessions and sign-in. docs/m2-plan.md M2-2
//
// A session is a random token in an httpOnly, SameSite=Lax cookie; the
// database keeps only its SHA-256. Two ways to get one:
// - guest: a nickname (from an invite link, or to host), no account;
// - an AuthProvider (Google in M2-12; the `dev` stub until then): a redirect
//   round trip with a `state` (and PKCE verifier) held in a short-lived cookie.
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Clock } from "./clock";
import type { Db, Queryable } from "./db";
import { checkNickname, parseNickname, SESSION_TTL_MS } from "./settings";

export const SESSION_COOKIE = "sj_session";
const SIGNIN_COOKIE = "sj_signin";
const SIGNIN_TTL_S = 10 * 60;

export interface User {
  readonly id: string;
  readonly name: string;
  /** No external account (invite link + nickname). */
  readonly guest: boolean;
}

/** Who an AuthProvider says the browser is. */
export interface Identity {
  /** Stable per provider (Google's `sub`). */
  readonly subject: string;
  readonly displayName: string;
}

/**
 * A redirect sign-in (OAuth code flow). The server makes `state` and the PKCE
 * `verifier`, keeps them in a cookie, and checks `state` on the way back.
 */
export interface AuthProvider {
  /** URL segment and the prefix of `users.external_id`, e.g. "google". */
  readonly name: string;
  /** Where to send the browser. `hint` is a provider-specific login hint. */
  authorizeUrl(p: { state: string; verifier: string; redirectUri: string; hint: string | null }): string;
  /** The identity for the callback's `code`, or null if the provider refuses it. */
  identify(p: { code: string; verifier: string; redirectUri: string }): Promise<Identity | null>;
}

/**
 * Dev stub for "Sign in with Google" until M2-12 has a client id (only with
 * DEV_LOGIN=1). `/auth/dev/start?hint=Riya` comes straight back signed in as
 * the dev account "Riya": same round trip as Google, no Google.
 */
export function devAuthProvider(): AuthProvider {
  return {
    name: "dev",
    authorizeUrl: ({ state, redirectUri, hint }) =>
      `${redirectUri}?${new URLSearchParams({ state, code: hint ?? "dev" })}`,
    identify: async ({ code }) => {
      const name = parseNickname(code);
      return name ? { subject: name, displayName: name } : null;
    },
  };
}

const sha256 = (token: string) => createHash("sha256").update(token).digest();
const token = () => randomBytes(32).toString("base64url");

export async function createGuestUser(db: Queryable, name: string): Promise<User> {
  const [row] = await db.query<{ id: string }>("insert into users (display_name) values ($1) returning id", [name]);
  if (!row) throw new Error("user not created");
  return { id: row.id, name, guest: true };
}

/** The user for an external account, made on first sign-in. */
async function userForIdentity(db: Queryable, provider: string, who: Identity): Promise<User> {
  const [row] = await db.query<{ id: string; display_name: string }>(
    `insert into users (display_name, external_id) values ($1, $2)
     on conflict (external_id) do update set external_id = excluded.external_id
     returning id, display_name`,
    [who.displayName, `${provider}:${who.subject}`],
  );
  if (!row) throw new Error("user not created");
  return { id: row.id, name: row.display_name, guest: false };
}

export interface Sessions {
  /** Signs `user` in on this reply (new session cookie). */
  start(reply: FastifyReply, user: User): Promise<void>;
  /** The signed-in user, or null. */
  user(req: FastifyRequest): Promise<User | null>;
  /** The signed-in user and when the session expires (epoch ms), or null. */
  session(req: FastifyRequest): Promise<{ readonly user: User; readonly expiresAt: number } | null>;
  end(req: FastifyRequest, reply: FastifyReply): Promise<void>;
}

export function sessions(db: Db, clock: Clock): Sessions {
  const session: Sessions["session"] = async (req) => {
    const t = req.cookies[SESSION_COOKIE];
    if (!t) return null;
    const [row] = await db.query<{ id: string; display_name: string; external_id: string | null; expires: number }>(
      `select u.id, u.display_name, u.external_id, (extract(epoch from s.expires_at) * 1000)::float8 as expires
       from sessions s join users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > $2`,
      [sha256(t), new Date(clock.now())],
    );
    return row ? { user: { id: row.id, name: row.display_name, guest: row.external_id === null }, expiresAt: Math.round(Number(row.expires)) } : null;
  };
  return {
    async start(reply, user) {
      const t = token();
      await db.query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [
        sha256(t),
        user.id,
        new Date(clock.now() + SESSION_TTL_MS),
      ]);
      reply.setCookie(SESSION_COOKIE, t, { path: "/", httpOnly: true, sameSite: "lax", maxAge: SESSION_TTL_MS / 1000 });
    },
    async user(req) {
      return (await session(req))?.user ?? null;
    },
    session,
    async end(req, reply) {
      const t = req.cookies[SESSION_COOKIE];
      if (t) await db.query("delete from sessions where token_hash = $1", [sha256(t)]);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
    },
  };
}

/**
 * Only same-site paths, so a sign-in link can't bounce the browser elsewhere
 * (or break the Location header): one leading "/", then only URL path/query
 * characters — no "//", backslash, whitespace or control characters. Else "/".
 */
export const safeReturnTo = (v: unknown): string =>
  typeof v === "string" && v.length <= 512 && /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/.test(v) ? v : "/";

/** `onSignOut` gets the token of a session that was just ended (the live channel closes its sockets). */
export function authRoutes(
  app: FastifyInstance,
  db: Db,
  s: Sessions,
  providers: readonly AuthProvider[],
  onSignOut: (token: string) => void = () => {},
): void {
  const byName = new Map(providers.map((p) => [p.name, p]));
  const redirectUri = (req: FastifyRequest, name: string) => `${req.protocol}://${req.host}/auth/${name}/callback`;

  app.get("/auth/providers", async () => ({ providers: providers.map((p) => p.name) }));

  app.get("/me", async (req, reply) => {
    const user = await s.user(req);
    return user ? { user } : reply.code(401).send({ error: "not signed in" });
  });

  // Guest sign-in to host a game (joining by invite signs a guest in by itself).
  app.post("/auth/guest", async (req, reply) => {
    const nick = checkNickname((req.body as { nickname?: unknown } | null)?.nickname);
    if (!nick.ok) return reply.code(400).send({ error: nick.error });
    const user = await createGuestUser(db, nick.name);
    await s.start(reply, user);
    return { user };
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    await s.end(req, reply);
    if (token) onSignOut(token);
    return { ok: true };
  });

  app.get<{ Params: { provider: string }; Querystring: { returnTo?: string; hint?: string } }>(
    "/auth/:provider/start",
    async (req, reply) => {
      const provider = byName.get(req.params.provider);
      if (!provider) return reply.code(404).send({ error: "unknown sign-in provider" });
      const state = token();
      const verifier = token();
      const pending = JSON.stringify({ provider: provider.name, state, verifier, returnTo: safeReturnTo(req.query.returnTo) });
      reply.setCookie(SIGNIN_COOKIE, pending, { path: "/auth", httpOnly: true, sameSite: "lax", maxAge: SIGNIN_TTL_S });
      const hint = typeof req.query.hint === "string" ? req.query.hint : null;
      return reply.redirect(provider.authorizeUrl({ state, verifier, redirectUri: redirectUri(req, provider.name), hint }));
    },
  );

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string } }>(
    "/auth/:provider/callback",
    async (req, reply) => {
      const provider = byName.get(req.params.provider);
      if (!provider) return reply.code(404).send({ error: "unknown sign-in provider" });
      let pending: { provider?: unknown; state?: unknown; verifier?: unknown; returnTo?: unknown } = {};
      try {
        pending = JSON.parse(req.cookies[SIGNIN_COOKIE] ?? "{}");
      } catch {
        // a mangled cookie is just a failed sign-in
      }
      reply.clearCookie(SIGNIN_COOKIE, { path: "/auth" });
      const { code, state } = req.query;
      if (pending.provider !== provider.name || typeof pending.state !== "string" || state !== pending.state || typeof code !== "string") {
        return reply.code(400).send({ error: "sign-in expired or was not started here; try again" });
      }
      const who = await provider.identify({ code, verifier: String(pending.verifier), redirectUri: redirectUri(req, provider.name) });
      if (!who) return reply.code(401).send({ error: "sign-in refused" });
      const returnTo = safeReturnTo(pending.returnTo); // checked before anything is written
      await s.start(reply, await userForIdentity(db, provider.name, who));
      return reply.redirect(returnTo);
    },
  );
}
