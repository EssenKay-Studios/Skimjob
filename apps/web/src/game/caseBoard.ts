// The case board's data shape and the pure helpers over it (design §15.4). The
// board shows what the adapter (caseLeads.ts) returns from the player's own view.
import type { PlayerId } from "@skimjob/engine";

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

/** No leads and no suspect: a game with nothing on the board yet. */
export const NO_LEADS: CaseData = { leads: [], suspect: null };

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

/**
 * design §15.4 Suspect card: the most likely liar. With 2+ pins it reads only the
 * pinned leads (a lead pinned whole, or holding a pinned fact); otherwise every
 * lead. One point per contradiction that names a player; ties go to the most
 * recent contradiction (the later round, then the later lead), then seat order.
 * The reason quotes their most recent one. Never you; nobody without a contradiction.
 */
export function suspectOf(leads: readonly Lead[], pins: ReadonlySet<string>, me: PlayerId, seats: readonly PlayerId[]): Suspect | null {
  const pinned = pinnedItems(leads, pins);
  const basis = pinned.length >= 2 ? new Set(pinned.map((i) => i.lead.id)) : null;
  /** How recent a contradiction is: its round, then the lead's place, then the warning's. */
  const later = (a: readonly number[], b: readonly number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
  const score = new Map<PlayerId, { points: number; latest: number[]; reason: string }>();
  leads.forEach((lead, i) => {
    if (basis && !basis.has(lead.id)) return;
    lead.warnings.forEach((w, j) => {
      for (const p of w.names) {
        if (p === me) continue;
        const at = [lead.round, i, j];
        const s = score.get(p);
        if (!s) score.set(p, { points: 1, latest: at, reason: w.text });
        else score.set(p, later(at, s.latest) > 0 ? { points: s.points + 1, latest: at, reason: w.text } : { ...s, points: s.points + 1 });
      }
    });
  });
  const ranked = [...score].sort(([a, x], [b, y]) => y.points - x.points || later(y.latest, x.latest) || seats.indexOf(a) - seats.indexOf(b));
  const top = ranked[0];
  return top ? { player: top[0], reason: top[1].reason } : null;
}
