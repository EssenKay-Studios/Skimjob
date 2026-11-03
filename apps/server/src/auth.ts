// Identity: users, sessions and sign-in. docs/m2-plan.md M2-2
//
// A session is a random token in an httpOnly, SameSite=Lax cookie; the
// database keeps only its SHA-256. Two ways to get one:
// - guest: a nickname (from an invite link, or to host), no account;
// - an AuthProvider (Google, google.ts; the `dev` stub with DEV_LOGIN=1): a
//   redirect round trip with a `state`, PKCE verifier and OIDC `nonce` held in
//   a short-lived cookie. A guest who signs in keeps their user (and seats)
//   when the account is new here.
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
 * A redirect sign-in (OAuth code flow). The server makes `state`, the PKCE
 * `verifier` and the OIDC `nonce`, keeps them in a cookie, and checks `state`
 * on the way back; the provider checks `nonce` in what it gets for the code.
 */
export interface AuthProvider {
  /** URL segment and the prefix of `users.external_id`, e.g. "google". */
  readonly name: string;
  /**
   * The callback URL registered with the provider. Unset: this server's own
   * `/auth/<name>/callback` as the request reached it.
   */
  readonly redirectUri?: string;
  /** Where to send the browser. `hint` is a provider-specific login hint. */
  authorizeUrl(p: { state: string; verifier: string; nonce: string; redirectUri: string; hint: string | null }): string;
  /** The identity for the callback's `code`, or null if the provider refuses it. */
  identify(p: { code: string; verifier: string; nonce: string; redirectUri: string }): Promise<Identity | null>;
}

/**
 * Dev stub for "Sign in with Google" (only with DEV_LOGIN=1, never in
 * production). `/auth/dev/start?hint=Riya` comes straight back signed in as
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

/**
 * The user for an external account, made on first sign-in. A guest signing in
 * keeps their seats (m2-plan M2-12): to an account that's new here, the guest
 * user becomes that account; to one that already exists, the guest's seats and
 * host roles move to it (adoptGuest).
 */
async function userForIdentity(db: Db, provider: string, who: Identity, guest: User | null): Promise<User> {
  const externalId = `${provider}:${who.subject}`;
  if (guest?.guest) {
    try {
      const [linked] = await db.query<{ id: string; display_name: string }>(
        `update users set external_id = $1 where id = $2 and external_id is null
         and not exists (select 1 from users where external_id = $1)
         returning id, display_name`,
        [externalId, guest.id],
      );
      if (linked) return { id: linked.id, name: linked.display_name, guest: false };
    } catch {
      // the same account signed in at the same moment elsewhere: use that user
    }
  }
  const [row] = await db.query<{ id: string; display_name: string }>(
    `insert into users (display_name, external_id) values ($1, $2)
     on conflict (external_id) do update set external_id = excluded.external_id
     returning id, display_name`,
    [who.displayName, externalId],
  );
  if (!row) throw new Error("user not created");
  if (guest?.guest && guest.id !== row.id) await adoptGuest(db, guest.id, row.id);
  return { id: row.id, name: row.display_name, guest: false };
}

/**
 * Moves what a guest holds to the account they just signed in to, in one
 * transaction: every host role, and every seat in a game the account isn't in.
 * Where both sit in the same game the account keeps its own seat; the guest's
 * is removed if the game is still a lobby, and otherwise stays with the guest
 * user (the engine player must keep existing; it just goes quiet). Only ever
 * runs for the guest of the signed-in browser's own session, after the
 * provider proved the account, so nobody can pull seats out of another account.
 */
export async function adoptGuest(db: Db, guestId: string, accountId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [g] = await tx.query("select id from users where id = $1 and external_id is null for update", [guestId]);
    if (!g) return; // not a guest (any more)
    await tx.query("update games set host_user_id = $2 where host_user_id = $1", [guestId, accountId]);
    await tx.query(
      `update seats s set user_id = $2 where s.user_id = $1
       and not exists (select 1 from seats o where o.game_id = s.game_id and o.user_id = $2)`,
      [guestId, accountId],
    );
    await tx.query("delete from seats s using games g where s.game_id = g.id and g.status = 'lobby' and s.user_id = $1", [guestId]);
  });
}

export interface Sessions {
  /** Signs `user` in on this reply (new session cookie). */
  start(reply: FastifyReply, user: User): Promise<void>;
  /** The signed-in user, or null. */
  user(req: FastifyRequest): Promise<User | null>;
  end(req: FastifyRequest, reply: FastifyReply): Promise<void>;
}

export function sessions(db: Db, clock: Clock): Sessions {
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
      const t = req.cookies[SESSION_COOKIE];
      if (!t) return null;
      const [row] = await db.query<{ id: string; display_name: string; external_id: string | null }>(
        `select u.id, u.display_name, u.external_id from sessions s join users u on u.id = s.user_id
         where s.token_hash = $1 and s.expires_at > $2`,
        [sha256(t), new Date(clock.now())],
      );
      return row ? { id: row.id, name: row.display_name, guest: row.external_id === null } : null;
    },
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
  const redirectUri = (req: FastifyRequest, p: AuthProvider) => p.redirectUri ?? `${req.protocol}://${req.host}/auth/${p.name}/callback`;

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
      const nonce = token();
      const pending = JSON.stringify({ provider: provider.name, state, verifier, nonce, returnTo: safeReturnTo(req.query.returnTo) });
      reply.setCookie(SIGNIN_COOKIE, pending, { path: "/", httpOnly: true, sameSite: "lax", maxAge: SIGNIN_TTL_S });
      const hint = typeof req.query.hint === "string" ? req.query.hint : null;
      return reply.redirect(provider.authorizeUrl({ state, verifier, nonce, redirectUri: redirectUri(req, provider), hint }));
    },
  );

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/:provider/callback",
    async (req, reply) => {
      const provider = byName.get(req.params.provider);
      if (!provider) return reply.code(404).send({ error: "unknown sign-in provider" });
      let pending: { provider?: unknown; state?: unknown; verifier?: unknown; nonce?: unknown; returnTo?: unknown } = {};
      try {
        pending = JSON.parse(req.cookies[SIGNIN_COOKIE] ?? "{}") ?? {};
      } catch {
        // a mangled cookie is just a failed sign-in
      }
      reply.clearCookie(SIGNIN_COOKIE, { path: "/" });
      const { code, state, error } = req.query;
      const stateOk = pending.provider === provider.name && typeof pending.state === "string" && state === pending.state;
      const returnTo = safeReturnTo(pending.returnTo); // checked before anything is written
      // "Cancel" on the provider's page (error=access_denied): back where they were, still signed out.
      if (stateOk && typeof error === "string" && code === undefined) return reply.redirect(returnTo);
      if (!stateOk || typeof code !== "string" || typeof pending.verifier !== "string" || typeof pending.nonce !== "string") {
        return reply.code(400).send({ error: "sign-in expired or was not started here; try again" });
      }
      let who: Identity | null;
      try {
        who = await provider.identify({ code, verifier: pending.verifier, nonce: pending.nonce, redirectUri: redirectUri(req, provider) });
      } catch (err) {
        req.log.warn({ err, provider: provider.name }, "sign-in provider unreachable");
        return reply.code(502).send({ error: "the sign-in service didn't answer; try again" });
      }
      if (!who) return reply.code(401).send({ error: "sign-in refused" });
      const current = await s.user(req);
      const user = await userForIdentity(db, provider.name, who, current);
      // A new session on every sign-in (no session fixation); the old one ends.
      const old = req.cookies[SESSION_COOKIE];
      if (old) {
        await s.end(req, reply);
        onSignOut(old);
      }
      await s.start(reply, user);
      return reply.redirect(returnTo);
    },
  );
}
