// Host lobby settings and the server's own limits (not game rules, so not in
// @skimjob/content). design §15 setup, docs/m2-plan.md M2-2
import { DECKS, POOL_ROLES, ROLES, type DeckId, type RoleId } from "@skimjob/content";
import type { DealStyle, RoleListSetting, VoteVisibility } from "@skimjob/engine";

/** Session-length presets (design §4.1, plus "quick" for playtests). M2-4 gives them their timings. */
export const SESSION_LENGTHS = ["quick", "1h", "3h", "1d", "3d", "1w"] as const;
export type SessionLength = (typeof SESSION_LENGTHS)[number];

const VOTE_VISIBILITIES: readonly VoteVisibility[] = ["hiddenThenRevealed", "open", "secret"];
const DECK_IDS: readonly DeckId[] = ["starter", "standard", "everything"];
const DEAL_STYLES: readonly DealStyle[] = ["balanced", "random"];
const ROLE_LISTS: readonly RoleListSetting[] = ["exact", "possible", "hidden"];
/** The dropped saboteur setting: still read from stored games and old clients, never kept. extension.md Build notes "Tags, decks and dealing" */
const LEGACY_MOLE = "mole";

export interface LobbySettings {
  readonly sessionLength: SessionLength;
  readonly voteVisibility: VoteVisibility;
  /** Deck preset (extension.md "Decks"). */
  readonly deck: DeckId;
  /** Per-role toggles: the roles in the deck; empty = the preset's. */
  readonly roles: readonly RoleId[];
  /** Balanced or Truly random deal; Exact, Possible or Hidden role list. extension.md "Host settings" */
  readonly deal: DealStyle;
  readonly roleList: RoleListSetting;
  readonly eventsEnabled: boolean;
  /** Others see that a DM happened (design §12.1). Server-only; M2-8. */
  readonly dmNotices: boolean;
  /** Each pool role at most once (design §8.1, `GameConfig.uniqueRoles`). */
  readonly uniqueRoles: boolean;
}

export const DEFAULT_SETTINGS: LobbySettings = {
  sessionLength: "1h",
  voteVisibility: "hiddenThenRevealed",
  deck: "standard",
  roles: [],
  deal: "balanced",
  roleList: "exact",
  eventsEnabled: true,
  dmNotices: true,
  uniqueRoles: true,
};

/** Session cookie lifetime. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const NICKNAME_MAX = 24;

/** "My games" (M2-12): the most games listed for one user. */
export const MY_GAMES_LIMIT = 50;

/** Chat limits (M2-8a): characters per message, messages per window per player, history sent on connect. */
export const CHAT_MAX_CHARS = 500;
export const CHAT_RATE = { messages: 8, windowMs: 10_000 } as const;
export const CHAT_HISTORY_LIMIT = 200;
/** Most combining marks in a row (stacked "zalgo" text); real scripts need far fewer. */
export const CHAT_MAX_MARKS = 8;

/** Themed names for bot seats, used in order; shown as "Bot · <name>". */
export const BOT_NAMES = ["Riya", "Max", "Nico", "Juno", "Kofi", "Lena", "Omar", "Suki", "Tavi", "Wren", "Yara", "Zed"] as const;

const own = (o: object, k: string) => Object.hasOwn(o, k);

/** A setting key the server reads: the current ones, plus the dropped saboteur setting (migrated). */
export const isSettingKey = (k: string) => own(DEFAULT_SETTINGS, k) || k === LEGACY_MOLE;

/**
 * The dropped saboteur setting, read from a stored game or an old client: a
 * saved "off" becomes the deck with every Wildcard and Lone wolf toggled off;
 * "maybe" and "on" become the plain deck. extension.md Build notes "Tags, decks and dealing"
 */
function migrateMole(raw: Record<string, unknown>): Record<string, unknown> {
  if (!own(raw, LEGACY_MOLE)) return raw;
  const { [LEGACY_MOLE]: mole, ...rest } = raw;
  if (mole !== "off") return rest;
  const deck = typeof rest.deck === "string" && (DECK_IDS as readonly string[]).includes(rest.deck) ? (rest.deck as DeckId) : DEFAULT_SETTINGS.deck;
  const from = Array.isArray(rest.roles) && rest.roles.length > 0 ? (rest.roles as RoleId[]) : DECKS[deck];
  return { ...rest, roles: from.filter((r) => Object.hasOwn(ROLES, r) && ROLES[r]?.tag === "teamPlayer") };
}

/**
 * Host settings from untrusted JSON: missing fields take the defaults, unknown
 * fields are refused, a stored saboteur setting is migrated.
 */
export function parseSettings(input: unknown): { ok: true; settings: LobbySettings } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, settings: DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "settings must be an object" };
  for (const k of Object.keys(input)) if (!isSettingKey(k)) return { ok: false, error: `unknown setting ${JSON.stringify(k)}` };
  const raw = migrateMole(input as Record<string, unknown>);
  const s = { ...DEFAULT_SETTINGS, ...raw } as Record<keyof LobbySettings, unknown>;
  if (!(SESSION_LENGTHS as readonly unknown[]).includes(s.sessionLength)) return { ok: false, error: `sessionLength must be one of ${SESSION_LENGTHS.join(", ")}` };
  if (!(VOTE_VISIBILITIES as readonly unknown[]).includes(s.voteVisibility)) return { ok: false, error: `voteVisibility must be one of ${VOTE_VISIBILITIES.join(", ")}` };
  if (!(DECK_IDS as readonly unknown[]).includes(s.deck)) return { ok: false, error: `deck must be one of ${DECK_IDS.join(", ")}` };
  if (!(DEAL_STYLES as readonly unknown[]).includes(s.deal)) return { ok: false, error: `deal must be one of ${DEAL_STYLES.join(", ")}` };
  if (!(ROLE_LISTS as readonly unknown[]).includes(s.roleList)) return { ok: false, error: `roleList must be one of ${ROLE_LISTS.join(", ")}` };
  const roles = s.roles;
  if (!Array.isArray(roles) || !roles.every((r) => (POOL_ROLES as readonly unknown[]).includes(r)) || new Set(roles).size !== roles.length) {
    return { ok: false, error: "roles must be a list of distinct role ids" };
  }
  for (const k of ["eventsEnabled", "dmNotices", "uniqueRoles"] as const) {
    if (typeof s[k] !== "boolean") return { ok: false, error: `${k} must be true or false` };
  }
  return { ok: true, settings: s as unknown as LobbySettings };
}

/**
 * A game's stored settings as the server uses them: missing fields take the
 * defaults (games made before a setting existed) and a saboteur setting is
 * migrated. A row that no longer parses keeps its own fields over the defaults.
 */
export function storedSettings(stored: unknown): LobbySettings {
  const raw = typeof stored === "object" && stored !== null && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const known = Object.fromEntries(Object.entries(raw).filter(([k]) => isSettingKey(k)));
  const parsed = parseSettings({ ...DEFAULT_SETTINGS, ...known });
  return parsed.ok ? parsed.settings : ({ ...DEFAULT_SETTINGS, ...migrateMole(known) } as LobbySettings);
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

/** Suspicion board (design §12.3, M2-10): characters per note. */
export const BOARD_NOTE_MAX_CHARS = 280;
/** Suspicion board writes per window per seat, and "last seen" marks (a page sends at most one a second or so). */
export const BOARD_RATE = { writes: 20, windowMs: 10_000 } as const;
export const SEEN_RATE = { writes: 60, windowMs: 10_000 } as const;
