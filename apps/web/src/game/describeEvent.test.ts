// describeEvent: one line for every event type. docs/m2-plan.md M2-6; design §13
import type { GameEvent, MeetingResult, ResolvedAbility, ResolvedPerk } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { sampleEvents } from "../../../../packages/engine/src/types/samples";
import { describeEvent } from "./describeEvent";

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
    expect(describeEvent(sampleEvents.lootSplit, asAna)).toBe("Round 1, Vault: you found 6 loot, 4 to the Haul and 2 pocketed.");
    expect(describeEvent(sampleEvents.lootSplit, asCyd)).toBe("Round 1, Vault: Ana found 6 loot, 4 to the Haul and 2 pocketed.");
    expect(describeEvent(sampleEvents.alibiPosted, asAna)).toBe("You say you were in the Lobby in round 1.");
    expect(describeEvent(sampleEvents.alibiPosted, asCyd)).toBe("Ana says they were in the Lobby in round 1.");
    expect(describeEvent(sampleEvents.roleDealt, asAna)).toBe("You were dealt the Fence.");
    expect(describeEvent(sampleEvents.roleDealt, asCyd)).toBe("Ana was the Fence."); // the reveal
  });

  // v2 §2 (R3a): what the dark side learns says who and how, never a role, and names nobody else.
  it("describes alliesLearned for each way it is learned, without naming roles", () => {
    const lines = (["deal", "fence", "getaway", "tipOff"] as const).map((via) => describeEvent({ ...sampleEvents.alliesLearned, via }, asAna));
    expect(lines).toEqual([
      "You were told at the deal that Ben is on the dark side.",
      "Your full safe paid off: Ben is on the dark side.",
      "The Heat ran high: you and Ben now know you're on the same side.",
      "Your tip-off named a dark-side ally: Ben.",
    ]);
    for (const l of lines) expect(l).not.toMatch(/Mole|Hacker|Fence|Getaway|Driver|saboteur|accomplice|Cyd/i);
    expect(describeEvent({ ...sampleEvents.alliesLearned, via: "getaway" }, asCyd)).toBe("The Heat ran high: Ana and Ben now know they're on the same side.");
  });

  // design §5.1: a missed deadline shows the default move.
  it("says when the default move was made", () => {
    expect(describeEvent(sampleEvents.defaultMoveAssigned, { ...asAna, me: "ben" })).toBe(
      "You missed round 1's deadline: the default move went to the Lobby, handing everything in.",
    );
  });

  it("gives the round summary, card and checkpoint with signs", () => {
    expect(describeEvent(sampleEvents.roundResolved, asAna)).toBe("Round 1: Haul +6 (now 6), Heat +14 (now 14).");
    expect(describeEvent({ ...sampleEvents.roundResolved, heatDelta: -6, heat: 8 }, asAna)).toBe("Round 1: Haul +6 (now 6), Heat −6 (now 8).");
    expect(describeEvent(sampleEvents.eventFlipped, asAna)).toBe("Round 2 event: Lockdown (the Vault is closed).");
    expect(describeEvent(sampleEvents.checkpointChecked, asAna)).toBe("Act 1 checkpoint: Haul 10, target 12, missed (Heat +15).");
    expect(describeEvent({ ...sampleEvents.checkpointChecked, act: 3, met: true, heatPenalty: 0 }, asAna)).toBe("Final target: Haul 10, target 12, made it.");
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
  // design §11.2: 9–12 players shake down on a plurality, so a failed vote there has no clear winner rather than no majority.
  it("says 'no clear winner' when the crew uses the plurality rule", () => {
    expect(describeEvent({ ...sampleEvents.meetingClosed, result: { kind: "noMajority" } }, { ...asAna, plurality: true })).toBe("No clear winner: nobody is shaken down.");
  });

  // design §8: every ability's result.
  const abilities: SamplesOf<ResolvedAbility> = {
    lookout: [{ kind: "lookout", rooms: ["vault", "office"] }],
    fenceSafe: [{ kind: "fenceSafe", amount: 2 }],
    loopCameras: [{ kind: "loopCameras", room: "vault" }],
    blackmail: [
      { kind: "blackmail", target: "ben", role: "fence", correct: true, stolen: 3 },
      { kind: "blackmail", target: "ben", role: "fence", correct: false, stolen: 0 },
    ],
    cancelShakedown: [{ kind: "cancelShakedown", meetingId: "m1", target: "ben" }],
    tipOff: [{ kind: "tipOff", heat: 6 }],
    audit: [{ kind: "audit", round: 2, room: "office", shortfall: 1 }],
    checkStash: [
      { kind: "checkStash", target: "ben", threshold: 3, dirty: true },
      { kind: "checkStash", target: "ben", threshold: 3, dirty: false },
    ],
    bless: [{ kind: "bless", target: "ben", act: 2 }],
    bagman: [{ kind: "bagman", bonus: 1 }],
    fixer: [{ kind: "fixer", lost: 3 }],
  };
  it.each(flat(abilities))("describes the $kind ability", (ability) => {
    expectSentence(describeEvent({ ...sampleEvents.abilityResolved, ability }, asAna));
    expectSentence(describeEvent({ ...sampleEvents.abilityResolved, ability }, asCyd));
  });
  it("describes abilities exactly", () => {
    const as = (ability: ResolvedAbility) => describeEvent({ ...sampleEvents.abilityResolved, ability }, asAna);
    expect(as(abilities.lookout[0])).toBe("Round 1: you kept lookout on the Vault and Office.");
    expect(as(abilities.checkStash[0])).toBe("Stash check: Ben holds 3 or more (not clean).");
    // design §8 (v2 §2): Priest, Bagman, Fixer
    expect(as(abilities.bless[0])).toBe("You blessed Ben for Act 2.");
    expect(as(abilities.bagman[0])).toBe("Round 1: you handed everything in, so the bank added +1 to the Haul.");
    expect(as(abilities.fixer[0])).toBe("Round 1: you stopped the raid and lost 3 from your stash.");
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
    rig: [{ kind: "rig", round: 3, cards: ["audit", "payday"] }],
    emergency: [{ kind: "emergency", meetingId: "m2" }],
  };
  it.each(flat(perks))("describes the $kind perk", (perk) => {
    expectSentence(describeEvent({ ...sampleEvents.perkUsed, perk }, asAna));
    expectSentence(describeEvent({ ...sampleEvents.perkUsed, perk }, asCyd));
  });
  it("names perks and cards", () => {
    expect(describeEvent(sampleEvents.perkUsed, asAna)).toBe("Peek: Ben is the Mole.");
    expect(describeEvent(sampleEvents.perkGranted, asAna)).toBe("You earned a Peek perk: Learn one player's role.");
    expect(describeEvent({ ...sampleEvents.perkUsed, perk: perks.rig[0] }, asAna)).toBe("You rigged round 3's card: Audit and Payday to pick from.");
    // design §8.3: the Smooth Talker's Emergency
    expect(describeEvent({ ...sampleEvents.perkUsed, perk: perks.emergency[0] }, asAna)).toBe("You spent an Emergency perk to call an extra emergency meeting.");
  });

  // design §7, §8 (v2 §2): the R2b public lines never name who acted unless the rule does.
  it("describes the R2b events without naming hidden actors", () => {
    expect(describeEvent(sampleEvents.raidStopped, asCyd)).toBe("The cops were about to raid in round 4, but the raid was stopped: Heat is back to 95.");
    expect(describeEvent(sampleEvents.blessingPaid, asCyd)).toBe("Ana was blessed: the bank paid the compensation, so 5 went back into the Haul.");
    expect(describeEvent(sampleEvents.muscleNamed, asCyd)).toBe("Ben was named as the Muscle: they called off the shakedown of Ana, who wasn't clean.");
    expect(describeEvent(sampleEvents.cardForeseen, { ...asAna, me: "ben" })).toBe("You foresaw round 3's card: Police patrol.");
  });

  // design §16.1: Duel call-outs both ways.
  it("describes call-outs", () => {
    expect(describeEvent(sampleEvents.callOutResolved, asCyd)).toBe("Call-out, Act 1: Ana caught Ben skimming; 4 moves to Ana.");
    expect(describeEvent({ ...sampleEvents.callOutResolved, caught: false }, asAna)).toBe("Call-out, Act 1: you got it wrong and pay Ben 4.");
  });

  // design §3: every ending.
  it("describes every ending", () => {
    expect(describeEvent(sampleEvents.gameEnded, asCyd)).toBe("Job done! The crew got away with it: Ana wins.");
    expect(describeEvent(sampleEvents.gameEnded, asAna)).toBe("Job done! The crew got away with it: you win.");
    const ranking = sampleEvents.gameEnded.outcome.ranking;
    expect(describeEvent({ ...sampleEvents.gameEnded, outcome: { result: "failed", reason: "heat", ranking, winners: [] } }, asAna)).toBe(
      "Busted: the heist failed (the Heat hit the top); nobody wins.",
    );
    expect(describeEvent({ ...sampleEvents.gameEnded, outcome: { result: "failed", reason: "target", ranking, winners: ["ben"] } }, asAna)).toBe(
      "Busted: the heist failed (the target was missed); Ben wins.",
    );
  });

  it("formats meeting slots through the context", () => {
    expect(describeEvent(sampleEvents.meetingScheduled, { ...asAna, slot: () => "7 pm" })).toBe("The Act 1 meeting is set for 7 pm.");
  });
});
