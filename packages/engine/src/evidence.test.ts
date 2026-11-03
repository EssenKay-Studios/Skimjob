// revealsRole: role cards never become verified chat evidence. design §8 (claims
// "true or as a bluff"), §12.1 evidence cards; PM decision on PR #38.
import { describe, expect, it } from "vitest";
import { revealsRole } from "./evidence";
import type { GameEvent } from "./types";
import { sampleEvents } from "./types/samples";

describe("revealsRole (design §8, §12.1)", () => {
  it("flags the role deal and every entry that states a role or faction", () => {
    for (const t of ["roleDealt", "snitchTargetAssigned", "tokenEarned", "tipOffLanded", "voteCompromised", "insideTip", "doubleCrossResolved"] as const) {
      expect(revealsRole(sampleEvents[t]), t).toBe(true);
    }
    // A Peek names the target's role; a Blackmail guess names one too.
    expect(revealsRole(sampleEvents.perkUsed)).toBe(true);
    const blackmail = { ...sampleEvents.abilityResolved, ability: { kind: "blackmail", target: "ben", role: "mole", correct: true } } as GameEvent;
    expect(revealsRole(blackmail)).toBe(true);
  });

  it("leaves ability results and moves shareable (sightings, cameras, audits, splits)", () => {
    for (const t of ["roomSighting", "roomWatched", "pocketCount", "lootSplit", "moveSubmitted", "abilityResolved", "raidRumourHit", "voteCast", "perkBought", "policeActivity", "shopDealt"] as const) {
      expect(revealsRole(sampleEvents[t]), t).toBe(false);
    }
  });
});
