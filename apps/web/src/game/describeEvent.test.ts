// describeEvent: one line for every event type. docs/m2-plan.md M2-6; design §13
import type { GameEvent, MeetingResult, PerkUse, ResolvedAbility } from "@skimjob/engine";
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
  expect(text).toMatch(/^(🛒 )?[A-Z0-9]/); // design §12: a purchase reads "🛒 Someone bought …"
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
    // design §11.3: alibis and role claims are said entries, true or not.
    const said = (statement: Extract<GameEvent, { type: "said" }>["statement"]): GameEvent => ({ type: "said", visibility: { kind: "public" }, statement });
    const alibi = said({ kind: "alibi", player: "ana", round: 1, room: "lobby" });
    expect(describeEvent(alibi, asAna)).toBe("You say you were in the Lobby in round 1.");
    expect(describeEvent(alibi, asCyd)).toBe("Ana says they were in the Lobby in round 1.");
    const claim = said({ kind: "role", player: "ana", role: "lookout", stretch: 1 });
    expect(describeEvent(claim, asAna)).toBe("You claim to be the Lookout.");
    expect(describeEvent(claim, asCyd)).toBe("Ana claims to be the Lookout.");
    // design §10: the plan board as the round resolved, a pledge on a room and one on a player.
    const plan = said({
      kind: "plan",
      round: 2,
      plan: {
        entries: [
          { player: "ana", placed: null, room: "office", power: { role: "hacker", target: "vault" }, agreed: true },
          { player: "ben", placed: "vault", room: null, power: { role: "detective", target: "ana" }, agreed: false },
        ],
        history: [],
      },
    });
    expect(describeEvent(plan, asCyd)).toBe("The plan for round 2: Ana Office, Ana Hacker → Vault and Ben Detective → Ana.");
    expect(describeEvent(plan, asAna)).toBe("The plan for round 2: you Office, you Hacker → Vault and Ben Detective → you.");
    expect(describeEvent(said({ kind: "plan", round: 3, plan: { entries: [{ player: "ben", placed: "vault", room: null, power: null, agreed: true }], history: [] } }), asCyd)).toBe("The plan for round 3 had no claims.");
    expect(describeEvent(sampleEvents.roleDealt, asAna)).toBe("You were dealt the Hacker.");
    expect(describeEvent(sampleEvents.roleDealt, asCyd)).toBe("Ana was the Hacker."); // the reveal
  });

  // design §11.1, §11.4, §5.1: the power cut, the absolved player, a copy's use already done, a hidden bell.
  it("describes the power cut, absolution, an already-done use and a hidden bell", () => {
    expect(describeEvent(sampleEvents.powerCut, asCyd)).toBe("Power cut in the Office this round.");
    expect(describeEvent(sampleEvents.sinsAbsolved, asAna)).toBe("Round 1: your sins were absolved.");
    expect(describeEvent(sampleEvents.abilityAlreadyDone, { ...asAna, me: "ben" })).toBe(
      "Round 1: already done this round by another copy of your role; your power is not spent.",
    );
  });

  // design §9.6, §12: a purchase is public without a name; the buyer's own line and the Bail choice are private.
  it("describes the black market, purchases and Bail", () => {
    expect(describeEvent(sampleEvents.shopDealt, asCyd)).toBe("The black market sells Tail, Soft shoes and Plant evidence.");
    expect(describeEvent(sampleEvents.perkSold, asCyd)).toBe("🛒 Someone bought Plant evidence (3 coins).");
    expect(describeEvent(sampleEvents.perkBought, asAna)).toBe("Round 2: you bought Plant evidence for 3 coins: Ben on the Vault's cameras this round.");
    expect(describeEvent(sampleEvents.bailChosen, asAna)).toBe("You chose to use Bail.");
    expect(describeEvent(sampleEvents.shakedownCancelled, asCyd)).toBe("A shakedown fell through.");
  });

  // design §9.6: what is above the share is set aside; a clean shakedown has nothing to set aside, so its line says so once.
  it("a dirty shakedown says what was set aside; a clean one drops that clause", () => {
    const resolved = sampleEvents.shakedownResolved;
    expect(describeEvent(resolved, asCyd)).toBe("Ana was shaken down: a stash of 7, 2 set aside for the next split.");
    const clean = describeEvent({ ...resolved, taken: 0, clean: true }, asCyd);
    expect(clean).toBe("Ana was shaken down: a stash of 7. Clean: nothing above the share.");
    expect(clean).not.toContain("set aside");
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

  it("gives the round summary, the split and the card (design §7.2–§7.4)", () => {
    expect(describeEvent(sampleEvents.roundResolved, asAna)).toBe("Round 1: 6 taken, 1 coin went missing, 58 coins left in the bank.");
    expect(describeEvent({ ...sampleEvents.roundResolved, missing: 2 }, asAna)).toBe("Round 1: 6 taken, 2 coins went missing, 58 coins left in the bank.");
    expect(describeEvent(sampleEvents.duffelSplit, asAna)).toBe("Round 1: the duffel split 2 each (share now 2, kitty 1).");
    expect(describeEvent(sampleEvents.eventFlipped, asAna)).toBe("Round 2 event: Lockdown (the Vault is closed).");
    expect(describeEvent(sampleEvents.auditReport, asAna)).toBe("Audit of round 6: Vault 4 reached the duffel.");
    expect(describeEvent({ ...sampleEvents.auditReport, duffel: { vault: 0, office: 0 } }, asAna)).toBe("Audit of round 6: no coins reached the duffel."); // design §13
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

  // design §11.1: every power's result.
  const abilities: SamplesOf<ResolvedAbility> = {
    lookout: [{ kind: "lookout", rooms: ["vault", "office"] }],
    detect: [{ kind: "detect", round: 2, target: "ben", grabbed: 3 }],
    audit: [{ kind: "audit", round: 2, room: "office", duffel: 1 }],
    hide: [
      { kind: "hide", room: "vault", bulbs: 3 },
      { kind: "hide", room: "vault", bulbs: null },
    ],
    blackout: [{ kind: "blackout", room: "office" }],
    absolve: [
      { kind: "absolve", target: "ben", taken: 2 },
      { kind: "absolve", target: "ben", taken: null },
    ],
    ring: [{ kind: "ring", room: "office" }],
    reopen: [{ kind: "reopen", room: "vault" }],
  };
  it.each(flat(abilities))("describes the $kind ability", (ability) => {
    expectSentence(describeEvent({ ...sampleEvents.abilityResolved, ability }, asAna));
    expectSentence(describeEvent({ ...sampleEvents.abilityResolved, ability }, asCyd));
  });
  it("describes abilities exactly", () => {
    const as = (ability: ResolvedAbility) => describeEvent({ ...sampleEvents.abilityResolved, ability }, asAna);
    expect(as(abilities.lookout[0])).toBe("Round 1: you kept lookout on the Vault and Office.");
    // design §11.1: the Detective, the Auditor, the Hacker (it sees the real bell), the Electrician and the Priest.
    expect(as(abilities.detect[0])).toBe("Round 2: Ben grabbed 3 coins.");
    expect(as(abilities.audit[0])).toBe("Audit: 1 coin reached the duffel from the Office in round 2.");
    expect(as(abilities.hide[0])).toBe("Round 1: you hid the Vault's bell; it really shows 3 lit.");
    expect(as(abilities.hide[1]!)).toBe("Round 1: you hid the Vault's bell.");
    expect(as(abilities.blackout[0])).toBe("Round 1: you cut the power in the Office for next round.");
    expect(as(abilities.absolve[0])).toBe("Round 1: you absolved Ben: 2 set aside for the next split.");
    // design §11.1: on a bust the absolve never resolves.
    expect(as(abilities.absolve[1]!)).toBe("Round 1: you absolved Ben, but the bust came first.");
    // design §5.2, §5.3, §11.1: the Mole's ring and the Fixer's reopen
    expect(as(abilities.ring[0])).toBe("Round 1: you tipped off the police: the Office's bell rang once more.");
    expect(as(abilities.reopen[0])).toBe("Round 1: you tore the tape off the Vault.");
  });

  // design §12: every perk bought.
  const perks: SamplesOf<PerkUse> = {
    tail: [{ kind: "tail", room: "vault" }],
    alibi: [{ kind: "alibi" }],
    ballot: [{ kind: "ballot", target: "ben" }],
    softShoes: [{ kind: "softShoes" }],
    blackout: [{ kind: "blackout", room: "office" }],
    bail: [{ kind: "bail" }],
    plantEvidence: [{ kind: "plantEvidence", target: "ben", room: "vault" }],
  };
  it.each(flat(perks))("describes buying the $kind perk", (perk) => {
    expectSentence(describeEvent({ ...sampleEvents.perkBought, perk }, asAna));
    expectSentence(describeEvent({ ...sampleEvents.perkBought, perk }, asCyd));
  });

  // design §5, §11.1: the public lines never name who acted unless the rule does; a hidden bell shows "?".
  it("describes bells, raids and a reopened room without naming hidden actors", () => {
    expect(describeEvent(sampleEvents.bellsRung, asCyd)).toBe("Round 1 bells: Vault 4 bulbs; Office ?.");
    expect(describeEvent({ ...sampleEvents.bellsRung, bells: { vault: 4, office: 1 }, hidden: [] }, asCyd)).toBe("Round 1 bells: Vault 4 bulbs and Office 1 bulb.");
    expect(describeEvent(sampleEvents.roomRaided, asCyd)).toBe("Raid! The police hit the Vault in round 1 and seized 3 coins. It is taped off through round 3. Wanted 1.");
    expect(describeEvent(sampleEvents.bellsCooled, asCyd)).toBe("After round 1 the bells cooled: all dark.");
    expect(describeEvent(sampleEvents.roomReopened, asCyd)).toBe("The tape is off the Vault: it opens again next round.");
    expect(describeEvent({ ...sampleEvents.coinsGrabbed, duffel: 0, pocket: 0, seized: 3 }, asAna)).toBe("Round 1, Vault: you grabbed 3 coins, and the police seized them all.");
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
    expect(describeEvent({ ...sampleEvents.gameEnded, outcome: { result: "failed", reason: "theft", ranking, winners: ["ben"], getaway: 0 } }, asAna)).toBe(
      "The heist was sunk by theft: under two-thirds of the coins taken reached the crew; Ben wins.",
    );
  });

  it("formats meeting slots through the context", () => {
    expect(describeEvent(sampleEvents.meetingScheduled, { ...asAna, slot: () => "7 pm" })).toBe("The next meeting is set for 7 pm.");
  });
});
