// Host lobby settings and the server's own limits (not game rules, so not in
// @skimjob/content). design §15 setup, docs/m2-plan.md M2-2
import type { MoleSetting, VoteVisibility } from "@skimjob/engine";

/** Session-length presets (design §4.1, plus "quick" for playtests). M2-4 gives them their timings. */
export const SESSION_LENGTHS = ["quick", "1h", "3h", "1d", "3d", "1w"] as const;
export type SessionLength = (typeof SESSION_LENGTHS)[number];

const VOTE_VISIBILITIES: readonly VoteVisibility[] = ["hiddenThenRevealed", "open", "secret"];
const MOLE_SETTINGS: readonly MoleSetting[] = ["off", "maybe", "on"];

export interface LobbySettings {
  readonly sessionLength: SessionLength;
  readonly voteVisibility: VoteVisibility;
  readonly mole: MoleSetting;
  readonly eventsEnabled: boolean;
  readonly starterMode: boolean;
  /** Others see that a DM happened (design §12.1). Server-only; M2-8. */
  readonly dmNotices: boolean;
}

export const DEFAULT_SETTINGS: LobbySettings = {
  sessionLength: "1h",
  voteVisibility: "hiddenThenRevealed",
  mole: "maybe",
  eventsEnabled: true,
  starterMode: false,
  dmNotices: true,
};

/** Session cookie lifetime. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const NICKNAME_MAX = 24;

/** Themed names for bot seats, used in order; shown as "Bot · <name>". */
export const BOT_NAMES = ["Riya", "Max", "Nico", "Juno", "Kofi", "Lena", "Omar", "Suki", "Tavi", "Wren", "Yara", "Zed"] as const;

const own = (o: object, k: string) => Object.hasOwn(o, k);

/**
 * Host settings from untrusted JSON: missing fields take the defaults, unknown
 * fields are refused. Starter mode needs the Mole off and events off (the
 * engine refuses the mix, decisions.md "Starter mode requires…").
 */
export function parseSettings(input: unknown): { ok: true; settings: LobbySettings } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, settings: DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "settings must be an object" };
  const raw = input as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (!own(DEFAULT_SETTINGS, k)) return { ok: false, error: `unknown setting ${JSON.stringify(k)}` };
  const s = { ...DEFAULT_SETTINGS, ...raw } as Record<keyof LobbySettings, unknown>;
  if (!(SESSION_LENGTHS as readonly unknown[]).includes(s.sessionLength)) return { ok: false, error: `sessionLength must be one of ${SESSION_LENGTHS.join(", ")}` };
  if (!(VOTE_VISIBILITIES as readonly unknown[]).includes(s.voteVisibility)) return { ok: false, error: `voteVisibility must be one of ${VOTE_VISIBILITIES.join(", ")}` };
  if (!(MOLE_SETTINGS as readonly unknown[]).includes(s.mole)) return { ok: false, error: `mole must be one of ${MOLE_SETTINGS.join(", ")}` };
  for (const k of ["eventsEnabled", "starterMode", "dmNotices"] as const) {
    if (typeof s[k] !== "boolean") return { ok: false, error: `${k} must be true or false` };
  }
  if (s.starterMode === true && (s.mole !== "off" || s.eventsEnabled !== false)) {
    return { ok: false, error: "starter mode needs mole \"off\" and eventsEnabled false" };
  }
  return { ok: true, settings: s as unknown as LobbySettings };
}

/** A display name: free text, trimmed, 1–24 characters, no control characters. Never an id. */
export function parseNickname(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim().replace(/\s+/g, " ");
  // eslint-disable-next-line no-control-regex
  if (name.length === 0 || [...name].length > NICKNAME_MAX || /[\u0000-\u001f\u007f-\u009f]/.test(name)) return null;
  return name;
}
