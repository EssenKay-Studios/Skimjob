// The lobby API (apps/server lobby.ts, M2-2) as the browser sees it: every call
// goes to `/api/...` (the dev proxy strips the prefix). Refusals are `{ error }`.

export type SessionLength = "15m" | "1h" | "3h" | "1d" | "3d" | "1w";
export type VoteVisibility = "hiddenThenRevealed" | "open" | "secret";
/** design §11.3, §16 */
export type RoleListSetting = "exact" | "possible" | "hidden";

export interface LobbySettings {
  readonly sessionLength: SessionLength;
  readonly voteVisibility: VoteVisibility;
  readonly roleList: RoleListSetting;
  readonly eventsEnabled: boolean;
  readonly dmNotices: boolean;
}

export interface Seat {
  readonly seat: number;
  readonly nickname: string;
  readonly bot: string | null;
  readonly host: boolean;
  readonly you: boolean;
  readonly playerId: string | null;
  /** The bot playing this person's seat for now (host controls, M2-13); null if none. */
  readonly standIn?: string | null;
}

export interface LobbyView {
  readonly id: string;
  readonly status: "lobby" | "running" | "ended";
  readonly inviteCode: string;
  readonly settings: LobbySettings;
  readonly youAreHost: boolean;
  /** Meetings open by themselves when due (short presets): no slot proposals. design §9.4 */
  readonly autoMeetings: boolean;
  readonly minSeats: number;
  readonly maxSeats: number;
  readonly personalities: readonly { readonly id: string; readonly name: string }[];
  readonly seats: readonly Seat[];
}

export interface InvitePreview {
  readonly host: string | null;
  readonly seats: number;
  readonly maxSeats: number;
}

export interface Me {
  readonly id: string;
  readonly name: string;
  readonly guest: boolean;
  /** The Tips setting: teaching pop-ups and tips on (default) or off. */
  readonly tips: boolean;
}

/** What every "server unreachable" case says (offline, proxy 502/503/504, a non-JSON body). */
const REQUEST_TIMEOUT_MS = 8000;
export const UNREACHABLE = "Can't reach the hideout. Check your connection and try again.";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /** The server couldn't be reached (no response, a gateway error, or not our JSON). */
  get unreachable(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

export async function api<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  // A request that hangs (server down behind a proxy) counts as unreachable after a while.
  const init: RequestInit = { method, credentials: "same-origin", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, UNREACHABLE);
  }
  const data = (await res.json().catch(() => null)) // a timed-out body read is unreachable too as { error?: string } | null;
  if (res.ok && data) return data as T;
  // Our server always answers JSON; anything else came from a proxy in front of it.
  if (!data || typeof data.error !== "string") {
    const status = res.ok || res.status < 500 ? 502 : res.status;
    throw new ApiError(status === 500 ? 500 : status, status === 500 ? "Something went wrong on our side. Try again in a moment." : UNREACHABLE);
  }
  throw new ApiError(res.status, data.error);
}

/** The signed-in user, or null. */
export const fetchMe = () =>
  api<{ user: Me }>("GET", "/me").then(
    (r) => r.user,
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    },
  );

/** Saves the Tips setting; answers the updated user. */
export const setTips = (tips: boolean) => api<{ user: Me }>("PATCH", "/me", { tips }).then((r) => r.user);

/** The redirect sign-in providers the server has on ("google" with a client id, "dev" with DEV_LOGIN=1). */
export const fetchProviders = () =>
  api<{ providers: string[] }>("GET", "/auth/providers").then(
    (r) => r.providers,
    () => [] as string[],
  );

/** One row of "My games" (GET /me/games, M2-12). */
export interface MyGame {
  id: string;
  status: "lobby" | "running" | "ended";
  /** Your seat name in that game. */
  nickname: string;
  youAreHost: boolean;
  /** The host's seat name. */
  host: string | null;
  seats: number;
  sessionLength: SessionLength;
}
export const fetchMyGames = () => api<{ games: MyGame[] }>("GET", "/me/games").then((r) => r.games);

/** A full-page visit (not fetch): the server redirects to Google and back to `returnTo`. M2-12 */
export const googleSignInUrl = (returnTo: string) => `/api/auth/google/start?${new URLSearchParams({ returnTo })}`;

/** Server messages are lower-case fragments ("that nickname is taken…"): make them a sentence. */
export const sentence = (msg: string) => {
  const s = msg.charAt(0).toUpperCase() + msg.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
};

export const inviteLink = (code: string) => `${location.origin}/join/${code}`;
