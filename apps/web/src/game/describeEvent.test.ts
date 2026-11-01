// describeEvent: one line for every event type. docs/m2-plan.md M2-6; design §13
import type { GameEvent, ResolvedAbility, ResolvedPerk } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { sampleEvents } from "../../../../packages/engine/src/types/samples";
import { describeEvent } from "./describeEvent";

const NAMES: Record<string, string> = { ana: "Ana", ben: "Ben" };
const asAna = { me: "ana", name: (p: string) => NAMES[p] ?? p };
const asCyd = { me: "cyd", name: (p: string) => NAMES[p] ?? p };

/** A line is a real sentence: capitalised, no leaked placeholders. */
function expectSentence(text: string) {
  expect(text.length).toBeGreaterThan(8);
  expect(text).toMatch(/^[A-Z0-9]/);
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
  it.each([
    [{ kind: "shakedown", target: "ana" }, "The crew voted to shake you down (1 vote)."],
    [{ kind: "skipped" }, "The crew voted to skip (1 vote)."],
    [{ kind: "noMajority" }, "No majority: nobody is shaken down."],
    [{ kind: "noQuorum" }, "Too few votes: nothing happens."],
  ] as const)("describes the meeting result %j", (result, text) => {
    expect(describeEvent({ ...sampleEvents.meetingClosed, result }, asAna)).toBe(text);
  });

  // design §8: every ability's result.
  const abilities: ResolvedAbility[] = [
    { kind: "lookout", rooms: ["vault", "office"] },
    { kind: "fenceSafe", amount: 2 },
    { kind: "loopCameras", room: "vault" },
    { kind: "blackmail", target: "ben", role: "fence", correct: true, stolen: 3 },
    { kind: "blackmail", target: "ben", role: "fence", correct: false, stolen: 0 },
    { kind: "cancelShakedown", meetingId: "m1", target: "ben" },
    { kind: "tipOff", heat: 6 },
    { kind: "audit", round: 2, room: "office", shortfall: 1 },
    { kind: "checkStash", target: "ben", threshold: 3, dirty: true },
    { kind: "checkStash", target: "ben", threshold: 3, dirty: false },
  ];
  it.each(abilities)("describes the $kind ability", (ability) => {
    expectSentence(describeEvent({ ...sampleEvents.abilityResolved, ability }, asAna));
  });
  it("describes abilities exactly", () => {
    expect(describeEvent({ ...sampleEvents.abilityResolved, ability: abilities[0]! }, asAna)).toBe("Round 1: you kept lookout on the Vault and Office.");
    expect(describeEvent({ ...sampleEvents.abilityResolved, ability: abilities[8]! }, asAna)).toBe("Stash check: Ben holds 3 or more (not clean).");
  });

  // design §8.3: every perk spent.
  const perks: ResolvedPerk[] = [
    { kind: "peek", target: "ben", role: "mole" },
    { kind: "shield", meetingId: "m1" },
    { kind: "extraVote", meetingId: "m1" },
    { kind: "ballot", meetingId: "m1", target: "ben" },
    { kind: "tail", room: "vault" },
    { kind: "alibi", round: 2, room: "lobby" },
    { kind: "recharge" },
    { kind: "rig", round: 3, cards: ["audit", "payday"] },
  ];
  it.each(perks)("describes the $kind perk", (perk) => {
    expectSentence(describeEvent({ ...sampleEvents.perkUsed, perk }, asAna));
    expectSentence(describeEvent({ ...sampleEvents.perkUsed, perk }, asCyd));
  });
  it("names perks and cards", () => {
    expect(describeEvent(sampleEvents.perkUsed, asAna)).toBe("Peek: Ben is the Mole.");
    expect(describeEvent(sampleEvents.perkGranted, asAna)).toBe("You earned a Peek perk: Learn one player's role.");
    expect(describeEvent({ ...sampleEvents.perkUsed, perk: perks[7]! }, asAna)).toBe("You rigged round 3's card: Audit and Payday to pick from.");
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
