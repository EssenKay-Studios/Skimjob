// Perks and the black market. design §12
//
// Each game deals one perk per tier into a shop of three. A perk is bought
// with coins from your own stash (they leave the game) and is single-use; the
// text players read is `PERK_TEXT` (text.ts, §20.3).

/** A perk on the black market. Ids match `PERK_TEXT`. design §12, §20.3 */
export type PerkId = "tail" | "alibi" | "ballot" | "softShoes" | "blackout" | "bail" | "plantEvidence";

/** The black market's three tiers: one perk of each is dealt per game. design §12 */
export type PerkTier = 1 | 2 | 3;

export interface PerkDef {
  readonly id: PerkId;
  readonly tier: PerkTier;
  /** Coins it costs, paid from the buyer's stash [tunable]. */
  readonly cost: number;
}

/** Every perk, in the order the rulebook lists them. design §12 */
export const PERKS: Readonly<Record<PerkId, PerkDef>> = {
  tail: { id: "tail", tier: 1, cost: 1 },
  alibi: { id: "alibi", tier: 1, cost: 1 },
  ballot: { id: "ballot", tier: 1, cost: 1 },
  softShoes: { id: "softShoes", tier: 2, cost: 2 },
  blackout: { id: "blackout", tier: 2, cost: 2 },
  bail: { id: "bail", tier: 3, cost: 3 },
  plantEvidence: { id: "plantEvidence", tier: 3, cost: 3 },
};

export const PERK_IDS: readonly PerkId[] = Object.keys(PERKS) as PerkId[];

/** The tiers in shop order. design §12 */
export const PERK_TIERS: readonly PerkTier[] = [1, 2, 3];
