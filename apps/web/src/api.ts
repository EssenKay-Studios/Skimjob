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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Something went wrong (${res.status}).`);
  return data as T;
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
