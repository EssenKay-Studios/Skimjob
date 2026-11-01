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
  /** Each pool role at most once (design §8.1, `GameConfig.uniqueRoles`). */
  readonly uniqueRoles: boolean;
}

export const DEFAULT_SETTINGS: LobbySettings = {
  sessionLength: "1h",
  voteVisibility: "hiddenThenRevealed",
  mole: "maybe",
  eventsEnabled: true,
  starterMode: false,
  dmNotices: true,
  uniqueRoles: true,
};

/** Session cookie lifetime. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const NICKNAME_MAX = 24;

/** Chat limits (M2-8a): characters per message, messages per window per player, history sent on connect. */
export const CHAT_MAX_CHARS = 500;
export const CHAT_RATE = { messages: 8, windowMs: 10_000 } as const;
export const CHAT_HISTORY_LIMIT = 200;
/** Most combining marks in a row (stacked "zalgo" text); real scripts need far fewer. */
export const CHAT_MAX_MARKS = 8;

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
  for (const k of ["eventsEnabled", "starterMode", "dmNotices", "uniqueRoles"] as const) {
    if (typeof s[k] !== "boolean") return { ok: false, error: `${k} must be true or false` };
  }
  if (s.starterMode === true && (s.mole !== "off" || s.eventsEnabled !== false)) {
    return { ok: false, error: "starter mode needs mole \"off\" and eventsEnabled false" };
  }
  return { ok: true, settings: s as unknown as LobbySettings };
}

// Control characters, and invisible / bidi-control ones (format characters
// except the zero-width joiner inside emoji, plus blank "letters").
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\p{Cc}\u115f\u1160\u2800\u3164\uffa0]|(?!\u200d)\p{Cf}/u;

/** NFKC, lower case, without default-ignorable characters (ZWJ, variation selectors, U+034F …). */
const fold = (name: string) => name.normalize("NFKC").toLowerCase().replace(/\p{Default_Ignorable_Code_Point}/gu, "");

/** "Bot ·", "bot-", "BOT:", "Bot" … (any separator after "bot") are reserved for bot seats. */
export const looksLikeBot = (name: string) => /^bot(?:[^\p{L}\p{N}]|$)/u.test(fold(name).trim());

/** Two nicknames are the same if they match ignoring case, width, whitespace and invisible characters. */
export const nicknameKey = (name: string) => fold(name).replace(/\s+/gu, "");

/** Letters that draw nothing: the Hangul fillers and the braille blank. */
const BLANK_LETTERS = /[\u115f\u1160\u2800\u3164\uffa0]/gu;

/**
 * Something visible is left once default-ignorable and format characters
 * (ZWJ, LRM/RLM/ALM, tag characters …), blank letters, combining marks and
 * whitespace are gone. Nicknames and chat text.
 */
export const hasVisibleText = (text: string) => fold(text).replace(BLANK_LETTERS, "").replace(/[\p{Cf}\p{M}\s]/gu, "").length > 0;
const visible = hasVisibleText;

/**
 * A person's display name: free text, trimmed, inner whitespace collapsed,
 * 1–24 characters, nothing invisible, not bot-like. Never an id.
 */
export function checkNickname(input: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof input !== "string") return { ok: false, error: "nickname must be 1–24 characters" };
  const name = input.trim().replace(/\s+/gu, " ");
  if (name.length === 0 || [...name].length > NICKNAME_MAX || HIDDEN.test(name) || !visible(name)) return { ok: false, error: "nickname must be 1–24 visible characters" };
  if (looksLikeBot(name)) return { ok: false, error: "nicknames starting with \"Bot\" are for bots" };
  return { ok: true, name };
}

export function parseNickname(input: unknown): string | null {
  const r = checkNickname(input);
  return r.ok ? r.name : null;
}
