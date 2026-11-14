// A hand-made case board for /dev/gallery and tests: the shape the adapter (caseLeads.ts)
// must fill, with every trust level (and your own mark), a ⚠, a bell and a suspect (design §15.4).
import type { CaseData, Lead } from "./caseBoard";

export const FIXTURE_LEADS: readonly Lead[] = [
  {
    id: "lead:r4.vault",
    kind: "room",
    round: 4,
    title: "Vault",
    summary: "rang 3 · Ben, Cy inside",
    bell: true,
    names: ["p2", "p3"],
    warnings: [{ kind: "seenElsewhere", names: ["p2"], text: "You saw Ben in the Vault; he said Security." }],
    facts: [
      { id: "fact:r4.vault.bell", text: "The bell rang 3 times.", trust: "fact" },
      { id: "fact:r4.vault.saw", text: "You saw Ben here.", trust: "seen" },
      { id: "fact:r4.vault.claim", text: "Ben: “I was in Security.”", trust: "said" },
      { id: "fact:r4.vault.noalibi", text: "Dot had no alibi: in the Vault, round 4", trust: "fact" },
      { id: "fact:r4.vault.mark", text: "You trust Cy's alibi: the Vault, round 4", trust: "mark" },
    ],
  },
  {
    id: "lead:r4.market",
    kind: "market",
    round: 4,
    title: "Black market",
    summary: "Somebody bought Soft shoes · 1",
    bell: false,
    names: [],
    warnings: [],
    facts: [{ id: "fact:r4.market.buy", text: "Somebody bought Soft shoes.", trust: "fact" }],
  },
  {
    id: "lead:r3.crew",
    kind: "crew",
    round: 3,
    title: "The crew",
    summary: "Cy shared a claim",
    bell: false,
    names: ["p3"],
    warnings: [],
    facts: [{ id: "fact:r3.crew.claim", text: "Cy shared: “Dot claimed Lookout.”", trust: "shared" }],
  },
  { id: "lead:r2.lobby", kind: "room", round: 2, title: "Lobby", summary: "rang once · claimed nobody", bell: true, names: ["p4"], warnings: [], facts: [{ id: "fact:r2.lobby.bell", text: "The bell rang once.", trust: "fact" }] },
];

export const FIXTURE: CaseData = {
  leads: FIXTURE_LEADS,
  suspect: { player: "p2", reason: "Said Security in R4; you saw him in the Vault." },
  roundCap: 12,
  played: 4,
};
