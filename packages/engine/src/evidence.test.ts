// revealsRole: role cards never become verified chat evidence. design §8 (claims
// "true or as a bluff"), §12.1 evidence cards; PM decision on PR #38.
import { describe, expect, it } from "vitest";
import { revealsRole } from "./evidence";
import { sampleEvents } from "./types/samples";

describe("revealsRole (design §8, §12.1)", () => {
  it("flags the role deal and every entry that states a role or faction", () => {
    for (const t of ["roleDealt", "insideTip"] as const) {
      expect(revealsRole(sampleEvents[t]), t).toBe(true);
    }
  });

  it("leaves ability results and moves shareable (sightings, cameras, audits, splits)", () => {
    for (const t of ["roomSighting", "roomWatched", "coinsGrabbed", "moveSubmitted", "abilityResolved", "voteCast", "perkBought", "perkSold", "bailChosen", "bellsRung", "roomRaided", "shopDealt"] as const) {
      expect(revealsRole(sampleEvents[t]), t).toBe(false);
    }
  });
});
