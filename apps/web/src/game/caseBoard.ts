// The case board's data shape and the pure helpers over it (design §15.4). The
// board shows what a `CaseAdapter` returns; the adapter reads only the player's
// own view. S3b.5 builds the shell around this seam; S4.4 writes the real adapter
// (the leads, the ⚠ checks and the suspect ranking).
import type { PlayerId, PlayerView } from "@skimjob/engine";

/** Where a fact comes from (§15.4 trust levels). */
export type Trust = "fact" | "seen" | "shared" | "said";
export const TRUST_LABELS: Readonly<Record<Trust, string>> = { fact: "Fact", seen: "Seen by you", shared: "Shared evidence", said: "Said" };

/** The ⚠ kinds (§15.4). */
export type WarningKind = "seenElsewhere" | "notSeen" | "changedStory" | "tooQuiet" | "tooLoud" | "overClaimed";

export interface Fact {
  /** Unique across the board and stable between views: it is what a pin remembers. */
  readonly id: string;
  readonly text: string;
  readonly trust: Trust;
}

export interface Warning {
  readonly kind: WarningKind;
  /** One short line: what doesn't add up. */
  readonly text: string;
  /** The players it points at (none for "too loud"). */
  readonly names: readonly PlayerId[];
}

export interface Lead {
  /** Unique and stable, like a fact's id. */
  readonly id: string;
  readonly round: number;
  readonly title: string;
  /** The one line under the title, e.g. "rang 1 · 2 inside" or "raid · 3 seized". */
  readonly summary?: string;
  /** A bell rang in it (a room, a raid): shows the small bell. */
  readonly bell: boolean;
  /** Empty: nothing contradicts. */
  readonly warnings: readonly Warning[];
  /** Players the lead mentions. */
  readonly names: readonly PlayerId[];
  readonly facts: readonly Fact[];
}

/** The most likely liar and why, or nobody. */
export interface Suspect {
  readonly player: PlayerId;
  /** One line, e.g. "Said Security in R4; you saw Dev in the Vault." */
  readonly reason: string;
}

export interface CaseData {
  readonly leads: readonly Lead[];
  readonly suspect: Suspect | null;
}

/** No leads and no suspect: what the live game shows until S4.4 writes the adapter. */
export const NO_LEADS: CaseData = { leads: [], suspect: null };

/** Your own view and your pins in, the board's data out. With 2+ pins the suspect reads only the pinned facts (§15.4). */
export type CaseAdapter = (view: PlayerView, pins: ReadonlySet<string>) => CaseData;

/** The live game's adapter until S4.4: no leads, no suspect. */
export const noLeads: CaseAdapter = () => NO_LEADS;

/** Newest first: the later round first, and within a round the adapter's order. */
export const newestFirst = (leads: readonly Lead[]): Lead[] => leads.map((l, i) => ({ l, i })).sort((a, b) => b.l.round - a.l.round || a.i - b.i).map((x) => x.l);

/** The pin list with `id` added, or removed if it was there. */
export const togglePin = (pins: readonly string[], id: string): string[] => (pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id]);

/** One entry under "Pinned": a whole lead, or one fact with the lead it sits in. */
export type PinnedItem = { readonly lead: Lead; readonly fact: Fact | null };

/** Everything pinned, newest first. A pinned lead is one entry; its facts are not listed again unless pinned too. */
export function pinnedItems(leads: readonly Lead[], pins: ReadonlySet<string>): PinnedItem[] {
  return newestFirst(leads).flatMap((lead) => [
    ...(pins.has(lead.id) ? [{ lead, fact: null }] : []),
    ...lead.facts.filter((f) => pins.has(f.id)).map((fact) => ({ lead, fact })),
  ]);
}

/** What the Players strip shows for one player. */
export interface PlayerStat {
  /** Warnings that name them. */
  readonly warnings: number;
  /** Pinned leads that mention them, and pinned facts inside those leads. */
  readonly pins: number;
}

export function playerStat(leads: readonly Lead[], pins: ReadonlySet<string>, id: PlayerId): PlayerStat {
  let warnings = 0;
  let count = 0;
  for (const lead of leads) {
    warnings += lead.warnings.filter((w) => w.names.includes(id)).length;
    if (lead.names.includes(id)) count += (pins.has(lead.id) ? 1 : 0) + lead.facts.filter((f) => pins.has(f.id)).length;
  }
  return { warnings, pins: count };
}

/** The leads that mention or warn about a player, newest first. */
export const leadsNaming = (leads: readonly Lead[], id: PlayerId): Lead[] =>
  newestFirst(leads).filter((l) => l.names.includes(id) || l.warnings.some((w) => w.names.includes(id)));
