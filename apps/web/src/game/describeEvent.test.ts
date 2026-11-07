// describeEvent: one line for every event type. docs/m2-plan.md M2-6; design §13
import type { GameEvent, MeetingResult, ResolvedAbility, ResolvedPerk } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { sampleEvents } from "../../../../packages/engine/src/types/samples";
import { EVIDENCE_CARD_NOTE, describeEvent } from "./describeEvent";

const NAMES: Record<string, string> = { ana: "Ana", ben: "Ben" };
const asAna = { me: "ana", name: (p: string) => NAMES[p] ?? p };
const asCyd = { me: "cyd", name: (p: string) => NAMES[p] ?? p };

/**
 * One or more samples of every `kind` in a union. The mapped type makes this
 * file fail typecheck when the engine adds a kind without a sample here.
 */
type SamplesOf<U extends { readonly kind: string }> = { readonly [K in U["kind"]]: readonly [Extract<U, { readonly kind: K }>, ...Extract<U, { readonly kind: K }>[]] };
const flat = <U extends { readonly kind: string }>(samples: SamplesOf<U>): U[] => Object.values<readonly U[]>(samples).flat();

/**
 * A line is a real sentence: capitalised, no leaked placeholders, and not the
 * exhaustive switch's fallback (the bare type or kind name, one word).
 */
function expectSentence(text: string) {
  expect(text.length).toBeGreaterThan(8);
  expect(text).toMatch(/^[A-Z0-9]/);
  expect(text).toMatch(/ /);
  expect(text).toMatch(/[.!]$/);
  expect(text).not.toMatch(/undefined|null|NaN|\[object|\bana\b|\bben\b/);
}

describe("describeEvent", () => {
  // design §13: every event a ledger, case file or reveal can hold has a line.
  it.each(Object.values(sampleEvents) as GameEvent[])("describes $type", (event) => {
    expectSentence(describeEvent(event, asAna));
    expectSentence(describeEvent(event, asCyd));
  });

  it("speaks to the viewer as you", () => {
    expect(describeEvent(sampleEvents.coinsGrabbed, asAna)).toBe("Round 1, Vault: you grabbed 3 coins, 1 to the duffel and 2 pocketed.");
    expect(describeEvent(sampleEvents.coinsGrabbed, asCyd)).toBe("Round 1, Vault: Ana grabbed 3 coins, 1 to the duffel and 2 pocketed.");
    expect(describeEvent(sampleEvents.alibiPosted, asAna)).toBe("You say you were in the Lobby in round 1.");
    expect(describeEvent(sampleEvents.alibiPosted, asCyd)).toBe("Ana says they were in the Lobby in round 1.");
    // design §8, §12.1: a role claim, true or not.
    expect(describeEvent(sampleEvents.roleClaimed, asAna)).toBe("You claim to be the Lookout.");
    expect(describeEvent(sampleEvents.roleClaimed, asCyd)).toBe("Ana claims to be the Lookout.");
    expect(describeEvent(sampleEvents.roleDealt, asAna)).toBe("You were dealt the Hacker.");
    expect(describeEvent(sampleEvents.roleDealt, asCyd)).toBe("Ana was the Hacker."); // the reveal
  });

  // extension.md "Tokens and the shop": tokens never say why.
  it("describes tokens and the shop", () => {
    expect(describeEvent(sampleEvents.tokenEarned, asAna)).toBe("You earned a token.");
    expect(describeEvent(sampleEvents.perkBought, asAna)).toBe("You bought a Peek perk for 2 tokens: Learn one player's role.");
    expect(describeEvent(sampleEvents.shopDealt, asCyd)).toBe("The shop has Peek, Alibi and +Vote on sale.");
  });

  // design §5.1: a missed deadline shows the default move.
  it("says when the default move was made", () => {
    expect(describeEvent(sampleEvents.defaultMoveAssigned, { ...asAna, me: "ben" })).toBe(
      "You missed round 1's deadline: the default move went to the Lobby, handing everything in.",
    );
    // design §3.3 (owner, 7 Nov): with the default room taped off, the round is sat out.
    expect(describeEvent({ ...sampleEvents.defaultMoveAssigned, move: null }, { ...asAna, me: "ben" })).toBe(
      "You missed round 1's deadline: the default room is taped off, so you sat the round out.",
    );
  });

  it("gives the round summary and card with signs", () => {
    expect(describeEvent(sampleEvents.roundResolved, asAna)).toBe("Round 1: Haul +6 (now 6), 58 coins left in the bank.");
    expect(describeEvent(sampleEvents.eventFlipped, asAna)).toBe("Round 2 event: Lockdown (the Vault is closed).");
    expect(describeEvent(sampleEvents.auditReport, asAna)).toBe("Audit of round 6: Vault 4 short.");
  });

  // design §11.2: every meeting result.
  const results: SamplesOf<MeetingResult> = {
    shakedown: [{ kind: "shakedown", target: "ana" }],
    skipped: [{ kind: "skipped" }],
    noMajority: [{ kind: "noMajority" }],
    noQuorum: [{ kind: "noQuorum" }],
  };
  it.each(flat(results))("describes the $kind meeting result", (result) => {
    expectSentence(describeEvent({ ...sampleEvents.meetingClosed, result }, asAna));
  });
  it.each([
    [results.shakedown[0], "The crew voted to shake you down (1 vote)."],
    [results.skipped[0], "The crew voted to skip (1 vote)."],
    [results.noMajority[0], "No majority: nobody is shaken down."],
    [results.noQuorum[0], "Too few votes: nothing happens."],
  ] as const)("describes the meeting result %j exactly", (result, text) => {
    expect(describeEvent({ ...sampleEvents.meetingClosed, result }, asAna)).toBe(text);
  });

  // design §8: every ability's result.
  const abilities: SamplesOf<ResolvedAbility> = {
    lookout: [{ kind: "lookout", rooms: ["vault", "office"] }],
    loopCameras: [{ kind: "loopCameras", room: "vault" }],
    ring: [{ kind: "ring", room: "office" }],
    reopen: [{ kind: "reopen", room: "vault" }],
    audit: [{ kind: "audit", round: 2, room: "office", shortfall: 1 }],
    checkStash: [
      { kind: "checkStash", target: "ben", threshold: 3, dirty: true },
      { kind: "checkStash", target: "ben", threshold: 3, dirty: false },
    ],
    bless: [{ kind: "bless", target: "ben", act: 2 }],
  };
  it.each(flat(abilities))("describes the $kind ability", (ability) => {
    expectSentence(describeEvent({ ...sampleEvents.abilityResolved, ability }, asAna));
    expectSentence(describeEvent({ ...sampleEvents.abilityResolved, ability }, asCyd));
  });
  it("describes abilities exactly", () => {
    const as = (ability: ResolvedAbility) => describeEvent({ ...sampleEvents.abilityResolved, ability }, asAna);
    expect(as(abilities.lookout[0])).toBe("Round 1: you kept lookout on the Vault and Office.");
    expect(as(abilities.checkStash[0])).toBe("Stash check: Ben holds 3 or more (not clean).");
    // design §8 (v2 §2): Priest; §5.2, §5.3, §11.1: the Mole's ring and the Fixer's reopen
    expect(as(abilities.bless[0])).toBe("You blessed Ben until the next meeting.");
    expect(as(abilities.ring[0])).toBe("Round 1: you tipped off the police: the Office's bell rang once more.");
    expect(as(abilities.reopen[0])).toBe("Round 1: you tore the tape off the Vault.");
  });

  // design §8.3: every perk spent.
  const perks: SamplesOf<ResolvedPerk> = {
    peek: [{ kind: "peek", target: "ben", role: "mole" }],
    shield: [{ kind: "shield", meetingId: "m1" }],
    extraVote: [{ kind: "extraVote", meetingId: "m1" }],
    ballot: [{ kind: "ballot", meetingId: "m1", target: "ben" }],
    tail: [{ kind: "tail", room: "vault" }],
    alibi: [{ kind: "alibi", round: 2, room: "lobby" }],
    recharge: [{ kind: "recharge" }],
    rig: [{ kind: "rig", round: 3, cards: ["audit", "lockdown"] }],
    emergency: [{ kind: "emergency", meetingId: "m2" }],
  };
  it.each(flat(perks))("describes the $kind perk", (perk) => {
    expectSentence(describeEvent({ ...sampleEvents.perkUsed, perk }, asAna));
    expectSentence(describeEvent({ ...sampleEvents.perkUsed, perk }, asCyd));
  });
  it("names perks and cards", () => {
    expect(describeEvent(sampleEvents.perkUsed, asAna)).toBe("Peek: Ben is the Mole.");
    expect(describeEvent({ ...sampleEvents.perkUsed, perk: perks.rig[0] }, asAna)).toBe("You rigged round 3's card: Audit and Lockdown to pick from.");
    // design §8.3: the Smooth Talker's Emergency
    expect(describeEvent({ ...sampleEvents.perkUsed, perk: perks.emergency[0] }, asAna)).toBe("You spent an Emergency perk to call an extra emergency meeting.");
  });

  // design §5, §8 (v2 §2): the public lines never name who acted unless the rule does.
  it("describes bells, raids, a reopened room and a blessing without naming hidden actors", () => {
    expect(describeEvent(sampleEvents.bellsRung, asCyd)).toBe("Round 1 bells: Vault 4 bulbs and Office 1 bulb.");
    expect(describeEvent(sampleEvents.roomRaided, asCyd)).toBe("Raid! The police hit the Vault in round 1 and seized 3 coins. It is taped off through round 3. Wanted 1.");
    expect(describeEvent(sampleEvents.bellsCooled, asCyd)).toBe("After round 1 the bells cooled: all dark.");
    expect(describeEvent(sampleEvents.roomReopened, asCyd)).toBe("The tape is off the Vault: it opens again next round.");
    expect(describeEvent({ ...sampleEvents.coinsGrabbed, duffel: 0, pocket: 0, seized: 3 }, asAna)).toBe("Round 1, Vault: you grabbed 3 coins, and the police seized them all.");
    expect(describeEvent(sampleEvents.blessingPaid, asCyd)).toBe("Ana was blessed: the bank paid the compensation, so 5 went back into the Haul.");
  });

  // design §3: every ending.
  it("describes every ending", () => {
    expect(describeEvent(sampleEvents.gameEnded, asCyd)).toBe("Job done! The crew got away with it: Ana wins.");
    expect(describeEvent(sampleEvents.gameEnded, asAna)).toBe("Job done! The crew got away with it: you win.");
    const ranking = sampleEvents.gameEnded.outcome.ranking;
    // design §5.5: a bust; only the Rooftop gets away.
    expect(describeEvent({ ...sampleEvents.gameEnded, outcome: { result: "failed", reason: "bust", escapees: [], ranking, winners: [] } }, asAna)).toBe(
      "Busted: Wanted hit the bust line and the heist failed; nobody was on the Rooftop; nobody wins.",
    );
    expect(describeEvent({ ...sampleEvents.gameEnded, outcome: { result: "failed", reason: "bust", escapees: ["ana"], ranking, winners: ["ana"] } }, asCyd)).toBe(
      "Busted: Wanted hit the bust line and the heist failed; Ana got away over the Rooftop; Ana wins.",
    );
    expect(describeEvent({ ...sampleEvents.gameEnded, outcome: { result: "failed", reason: "theft", ranking, winners: ["ben"] } }, asAna)).toBe(
      "The heist was sunk by theft: under two-thirds of the coins taken reached the crew; Ben wins.",
    );
  });

  it("formats meeting slots through the context", () => {
    expect(describeEvent(sampleEvents.meetingScheduled, { ...asAna, slot: () => "7 pm" })).toBe("Meeting 1 is set for 7 pm.");
  });
});
