// Perks and the shop (extension.md "Tokens and the perk shop"). Roles earn
// tokens; each game deals one perk per column into a shop of three, and
// tokens buy them. A bought perk is private until used. design §8.3

/** One perk token kind. */
export type PerkId = "peek" | "shield" | "extraVote" | "ballot" | "tail" | "alibi" | "recharge" | "rig" | "emergency";

export interface PerkDef {
  readonly id: PerkId;
  readonly name: string;
  readonly effect: string;
  /** "use": spent with `useAbility`; "auto": spent by the engine when it applies (Shield; Emergency, by calling one). */
  readonly spent: "use" | "auto";
  /** Shop column: one perk of each is dealt per game. */
  readonly column: PerkColumn;
  /** Tokens it costs in the shop. */
  readonly cost: number;
}

/** The shop's three columns. extension.md "Tokens and the perk shop" */
export type PerkColumn = "learn" | "protect" | "sway";

export const PERKS: Readonly<Record<PerkId, PerkDef>> = {
  peek: { id: "peek", name: "Peek", effect: "Learn one player's role.", spent: "use", column: "learn", cost: 2 },
  shield: { id: "shield", name: "Shield", effect: "Your next passed shakedown is cancelled.", spent: "auto", column: "protect", cost: 2 },
  extraVote: { id: "extraVote", name: "+Vote", effect: "+1 ballot weight in this meeting.", spent: "use", column: "sway", cost: 1 },
  ballot: { id: "ballot", name: "Ballot", effect: "See one player's ballot in this meeting, also in Secret mode.", spent: "use", column: "learn", cost: 1 },
  tail: { id: "tail", name: "Tail", effect: "This round, also see who was in one more room.", spent: "use", column: "learn", cost: 1 },
  alibi: { id: "alibi", name: "Alibi", effect: "Your alibi for the last round is stamped Verified.", spent: "use", column: "protect", cost: 1 },
  recharge: { id: "recharge", name: "Recharge", effect: "A used-up use of your power comes back (this stretch's, or a once-per-game one).", spent: "use", column: "protect", cost: 1 },
  rig: { id: "rig", name: "Rig", effect: "Pick the next event card from two.", spent: "use", column: "sway", cost: 1 },
  emergency: { id: "emergency", name: "Emergency", effect: "Call one more emergency meeting this game.", spent: "auto", column: "sway", cost: 1 },
};

export const PERK_IDS: readonly PerkId[] = Object.keys(PERKS) as PerkId[];

/** Perk numbers (placeholders for the sim). design §8.3 */
export const PERK_RULES = {
  /** Ballot weight a +Vote adds in the meeting it's spent in. */
  extraVoteWeight: 1,
  /** Cards a Rig draws for its holder to pick from. */
  rigOptions: 2,
} as const;

/** The shop's columns, in display order, and the perks each may deal. extension.md "Tokens and the perk shop" */
export const SHOP_COLUMNS: Readonly<Record<PerkColumn, readonly PerkId[]>> = {
  learn: ["peek", "ballot", "tail"],
  protect: ["shield", "alibi", "recharge"],
  sway: ["extraVote", "emergency", "rig"],
};

/**
 * Shop dealing variants (extension.md gap-fills "Shop dealing"): with events
 * off the Sway perk is dealt from these; Duel deals one perk from each of
 * these that work without meetings, and Rig with events on (else a pick from
 * the Learn and Protect perks not dealt).
 */
export const SHOP_RULES = {
  swayEventsOff: ["extraVote", "emergency"] as readonly PerkId[],
  duel: [["peek", "tail"], ["alibi", "recharge"]] as readonly (readonly PerkId[])[],
  duelThird: "rig" as PerkId,
} as const;
