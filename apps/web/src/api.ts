// The lobby API (apps/server lobby.ts, M2-2) as the browser sees it: every call
// goes to `/api/...` (the dev proxy strips the prefix). Refusals are `{ error }`.

export type SessionLength = "quick" | "1h" | "3h" | "1d" | "3d" | "1w";
export type VoteVisibility = "hiddenThenRevealed" | "open" | "secret";
export type MoleSetting = "off" | "maybe" | "on";

export interface LobbySettings {
  readonly sessionLength: SessionLength;
  readonly voteVisibility: VoteVisibility;
  readonly mole: MoleSetting;
  readonly eventsEnabled: boolean;
  readonly starterMode: boolean;
  readonly dmNotices: boolean;
  readonly uniqueRoles: boolean;
}

export interface Seat {
  readonly seat: number;
  readonly nickname: string;
  readonly bot: string | null;
  readonly host: boolean;
  readonly you: boolean;
  readonly playerId: string | null;
}

export interface LobbyView {
  readonly id: string;
  readonly status: "lobby" | "running" | "ended";
  readonly inviteCode: string;
  readonly settings: LobbySettings;
  readonly youAreHost: boolean;
  /** Meetings open by themselves after each act (short presets): no slot proposals. design §11.1 */
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

export async function api<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
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

/** Server messages are lower-case fragments ("that nickname is taken…"): make them a sentence. */
export const sentence = (msg: string) => {
  const s = msg.charAt(0).toUpperCase() + msg.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
};

export const inviteLink = (code: string) => `${location.origin}/join/${code}`;
