// Perks: the shared reward vocabulary of role deck v2 (docs/roles-v2.md §1).
// A perk is a private token a player holds; roles earn them (R2/R3 wire the
// triggers) and players spend them. design §8.3

/** One perk token kind. */
export type PerkId = "peek" | "shield" | "extraVote" | "ballot" | "tail" | "alibi" | "recharge" | "rig" | "emergency";

export interface PerkDef {
  readonly id: PerkId;
  readonly name: string;
  readonly effect: string;
  /** "use": spent with `useAbility`; "auto": spent by the engine when it applies (Shield; Emergency, by calling one). */
  readonly spent: "use" | "auto";
}

export const PERKS: Readonly<Record<PerkId, PerkDef>> = {
  peek: { id: "peek", name: "Peek", effect: "Learn one player's role.", spent: "use" },
  shield: { id: "shield", name: "Shield", effect: "Your next passed shakedown is cancelled.", spent: "auto" },
  extraVote: { id: "extraVote", name: "+Vote", effect: "+1 ballot weight in this meeting.", spent: "use" },
  ballot: { id: "ballot", name: "Ballot", effect: "See one player's ballot in this meeting, also in Secret mode.", spent: "use" },
  tail: { id: "tail", name: "Tail", effect: "This round, also see who was in one more room.", spent: "use" },
  alibi: { id: "alibi", name: "Alibi", effect: "Your alibi for the last round is stamped Verified.", spent: "use" },
  recharge: { id: "recharge", name: "Recharge", effect: "Your once-per-act or once-per-game power comes back.", spent: "use" },
  rig: { id: "rig", name: "Rig", effect: "Pick the next event card from two.", spent: "use" },
  // Smooth Talker's reward (role deck v2 §2: "an extra emergency meeting"); spent by calling it.
  emergency: { id: "emergency", name: "Emergency", effect: "Call one more emergency meeting this game.", spent: "auto" },
};

export const PERK_IDS: readonly PerkId[] = Object.keys(PERKS) as PerkId[];

/** Perk numbers (placeholders for the sim). design §8.3 */
export const PERK_RULES = {
  /** Ballot weight a +Vote adds in the meeting it's spent in. */
  extraVoteWeight: 1,
  /** Cards a Rig draws for its holder to pick from. */
  rigOptions: 2,
} as const;
