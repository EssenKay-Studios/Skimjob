// "Sign in with Google" (M2-12): OpenID Connect authorization code flow with
// PKCE (S256), `state` (checked by authRoutes) and `nonce` (checked here, in
// the ID token). The ID token comes straight from Google's token endpoint over
// TLS, and is still verified: RS256 signature against Google's JWKS, issuer,
// audience (our client id), expiry and nonce. The user is keyed by `sub`.
// Setup (client id, secret, redirect URIs): docs/deploy.md "Google sign-in".
import { createHash, createPublicKey, verify, type JsonWebKey, type KeyObject } from "node:crypto";
import type { AuthProvider, Identity } from "./auth";
import { parseNickname } from "./settings";

export interface GoogleAuthOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Must be listed under "Authorized redirect URIs" in the Google Cloud console. */
  readonly redirectUri: string;
  /** Tests pass a fake Google here. */
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly endpoints?: Partial<GoogleEndpoints>;
}

export interface GoogleEndpoints {
  readonly authorize: string;
  readonly token: string;
  readonly jwks: string;
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  jwks: "https://www.googleapis.com/oauth2/v3/certs",
};
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
/** Clock skew allowed on `exp` / `iat`. */
const SKEW_S = 60;
/** JWKS cache when Google sends no max-age, and the least time between refetches for an unknown `kid`. */
const JWKS_DEFAULT_TTL_MS = 60 * 60 * 1000;
const JWKS_MIN_REFETCH_MS = 60 * 1000;
const FALLBACK_NAME = "Crook";

/** The PKCE S256 challenge for a verifier (RFC 7636 §4.2). */
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function googleAuthProvider(opts: GoogleAuthOptions): AuthProvider {
  const http = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const ep = { ...GOOGLE_ENDPOINTS, ...opts.endpoints };
  let keys = new Map<string, KeyObject>();
  let keysExpire = 0;
  let keysFetched = -Infinity;

  async function loadKeys(): Promise<void> {
    keysFetched = now();
    const res = await http(ep.jwks);
    if (!res.ok) throw new Error(`Google JWKS answered ${res.status}`);
    const body = (await res.json()) as { keys?: unknown };
    const next = new Map<string, KeyObject>();
    for (const jwk of Array.isArray(body.keys) ? (body.keys as (JsonWebKey & { kid?: unknown; kty?: unknown })[]) : []) {
      if (typeof jwk.kid !== "string" || jwk.kty !== "RSA") continue;
      try {
        next.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
      } catch {
        // a key we can't read is a key we don't trust
      }
    }
    const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "");
    keys = next;
    keysExpire = now() + (maxAge ? Number(maxAge[1]) * 1000 : JWKS_DEFAULT_TTL_MS);
  }

  async function keyFor(kid: string): Promise<KeyObject | null> {
    if (now() >= keysExpire || (!keys.has(kid) && now() - keysFetched >= JWKS_MIN_REFETCH_MS)) await loadKeys();
    return keys.get(kid) ?? null;
  }

  /** The verified claims of `idToken`, or null. */
  async function verifyIdToken(idToken: string, nonce: string): Promise<Record<string, unknown> | null> {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    let header: { alg?: unknown; kid?: unknown };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
      claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !claims || typeof claims !== "object") return null;
    const key = await keyFor(header.kid);
    if (!key || !verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"))) return null;
    const t = now() / 1000;
    const aud = claims.aud;
    if (!ISSUERS.includes(claims.iss as string)) return null;
    if (!(aud === opts.clientId || (Array.isArray(aud) && aud.includes(opts.clientId)))) return null;
    if (Array.isArray(aud) && aud.length > 1 && claims.azp !== opts.clientId) return null;
    if (typeof claims.exp !== "number" || claims.exp + SKEW_S < t) return null;
    if (typeof claims.iat === "number" && claims.iat - SKEW_S > t) return null;
    if (typeof claims.nonce !== "string" || claims.nonce !== nonce) return null;
    if (typeof claims.sub !== "string" || claims.sub.length === 0 || claims.sub.length > 255) return null;
    return claims;
  }

  return {
    name: "google",
    redirectUri: opts.redirectUri,
    authorizeUrl: ({ state, verifier, nonce, redirectUri }) =>
      `${ep.authorize}?${new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid profile",
        state,
        nonce,
        code_challenge: pkceChallenge(verifier),
        code_challenge_method: "S256",
        prompt: "select_account",
      })}`,
    async identify({ code, verifier, nonce, redirectUri }): Promise<Identity | null> {
      const res = await http(ep.token, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          redirect_uri: redirectUri,
        }).toString(),
      });
      if (!res.ok) return null; // a used, expired or forged code
      const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
      if (typeof body?.id_token !== "string") return null;
      const claims = await verifyIdToken(body.id_token, nonce);
      if (!claims) return null;
      return { subject: claims.sub as string, displayName: displayName(claims) };
    },
  };
}

/** Google's name if it passes the nickname rules (as a guest's), else the first name, else a stand-in. */
const displayName = (c: Record<string, unknown>) => parseNickname(c.name) ?? parseNickname(c.given_name) ?? FALLBACK_NAME;
