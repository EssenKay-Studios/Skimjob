// Which facts are public is content (design §19 seam 1): the engine emits each
// public fact through one helper that reads its visibility here. In R7 every
// fact is public; Skimjob Advanced adds other visibilities.

/** A fact the engine emits through the fact helper. design §19 seam 1 */
export type FactId = "bells" | "bank" | "duffel" | "missing" | "honesty";

/** Who sees a fact. R7: everyone. design §18, §19 seam 1 */
export type FactVisibility = "public";

/** design §5.1, §6.1, §7.3–§7.5: the bells, the bank pile, the duffel split (and the share), missing coins and honesty are public. */
export const FACTS: Readonly<Record<FactId, FactVisibility>> = { bells: "public", bank: "public", duffel: "public", missing: "public", honesty: "public" };
