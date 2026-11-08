// Bots buy perks sensibly and choose Bail by their personality. Bot settings,
// not game rules. design §9.6, §12, §19.3
import { describe, expect, it } from "vitest";
import { applyEvent, handleCommand, viewFor, type GameState, type Move, type PlayerCommand } from "@skimjob/engine";
import type { PerkId } from "@skimjob/content";
import { PERSONALITIES, type Personality } from "./personalities";
import { decide } from "./bot";
import { bailChoice, buyPerk } from "./perks";
import { emergencyMeeting, game, round, run } from "./testkit";

/** Always shops (when a perk fits), never at random. */
const keen: Personality = { ...PERSONALITIES.greedy, noise: 0, misread: 0, hunch: 0, shop: 1 };
const always = () => 0;
const withShop = (s: GameState, shop: PerkId[]): GameState => ({ ...s, shop });
const withStash = (s: GameState, id: string, stash: number): GameState => ({ ...s, players: { ...s.players, [id]: { ...s.players[id]!, stash } } });
const bought = (cmds: PlayerCommand[]) => cmds.flatMap((c) => (c.type === "buyPerk" ? [c.perk] : []));
const vault = (pocket: number): Move => ({ room: "vault", duffel: 6 - pocket, pocket });

describe("buying a perk — design §12", () => {
  it("the first of the game's perks that fits the move and the stash; at most one a round", () => {
    const s = withStash(withShop(game(5), ["tail", "blackout", "plantEvidence"]), "ana", 9);
    // The richest coin room other than its own (the testkit's Deposit boxes hold 5).
    expect(bought(buyPerk(viewFor(s, "ana"), keen, always, vault(0)))).toEqual([{ kind: "tail", room: "depositBoxes" }]);
    // An empty stash buys nothing, not even the 1-coin Tail.
    expect(bought(buyPerk(viewFor(withStash(s, "ana", 0), "ana"), keen, always, vault(2)))).toEqual([]);
    const after = run(s, { type: "buyPerk", player: "ana", perk: { kind: "tail", room: "depositBoxes" } });
    expect(buyPerk(viewFor(after, "ana"), keen, always, vault(0))).toEqual([]);
    // The personality's chance: no draw under it, no purchase.
    expect(buyPerk(viewFor(s, "ana"), { ...keen, shop: 0 }, always, vault(0))).toEqual([]);
  });

  it("each perk when it fits: Blackout and Plant evidence on a skim, Bail with something above the share, Soft shoes once Wanted is up; never a Check ballot", () => {
    const at = (shop: PerkId[], extra: Partial<GameState> = {}) => viewFor({ ...withStash(withShop(game(5), shop), "ana", 9), ...extra }, "ana");
    const one = (shop: PerkId[], move: Move, extra: Partial<GameState> = {}) => bought(buyPerk(at(shop, extra), keen, always, move));
    expect(one(["blackout"], vault(0))).toEqual([]);
    expect(one(["blackout"], vault(3))).toEqual([{ kind: "blackout", room: "vault" }]);
    expect(one(["plantEvidence"], vault(0))).toEqual([]);
    expect(one(["plantEvidence"], vault(3))[0]).toMatchObject({ kind: "plantEvidence", room: "vault" });
    expect(one(["bail"], vault(0))).toEqual([{ kind: "bail" }]); // a stash of 9 against a share of 0
    expect(one(["bail"], vault(0), { share: 9 })).toEqual([]);
    expect(one(["softShoes"], vault(0))).toEqual([]);
    expect(one(["softShoes"], vault(0), { wanted: 1 })).toEqual([{ kind: "softShoes" }]);
    expect(one(["ballot"], vault(0))).toEqual([]);
  });

  it("decide buys with the round's move, and the engine accepts it", () => {
    const s = withStash(withShop(game(5), ["tail", "softShoes", "plantEvidence"]), "ana", 9);
    const cmds = decide(viewFor(s, "ana"), keen, always, "crew");
    expect(cmds.map((c) => c.type)).toEqual(["submitMove", "buyPerk"]);
    let t = s;
    for (const c of cmds) {
      const r = handleCommand(t, c);
      expect(r.ok).toBe(true);
      if (r.ok) t = r.state;
    }
    // Once the move is in, it buys nothing more this round.
    expect(decide(viewFor(t, "ana"), keen, always, "crew").some((c) => c.type === "buyPerk")).toBe(false);
  });
});

describe("Bail's choice — design §9.6, §19.3", () => {
  /** ben pockets 4 in the Vault in round 1, holding Bail; the others vote him down in an emergency. */
  const pending = (bail = true): GameState => {
    let s = withShop(game(5), ["tail", "softShoes", "bail"]);
    if (bail) s = applyEvent(s, { type: "perkBought", visibility: { kind: "private", player: "ben" }, player: "ben", round: 1, perk: { kind: "bail" }, cost: 0 });
    s = emergencyMeeting(round(s, { ben: { room: "vault", pocket: 4 } }), "ana");
    for (const id of ["ana", "carl", "dee", "eve"]) s = run(s, { type: "castVote", player: id, vote: { kind: "shakedown", target: "ben" } });
    return run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
  };
  const choice = (s: GameState, p: Personality) => bailChoice(viewFor(s, "ben"), { ...p, noise: 0 }, always);

  it("uses Bail when the shakedown would take at least its `bailAt`; answers once; only the target holding one", () => {
    const s = pending();
    expect(s.phase.kind).toBe("shakedownPending");
    expect(choice(s, { ...keen, bailAt: 1 })).toEqual([{ type: "chooseBail", player: "ben", use: true }]);
    expect(choice(s, { ...keen, bailAt: 5 })).toEqual([{ type: "chooseBail", player: "ben", use: false }]);
    expect(choice(s, { ...keen, bailAt: null })).toEqual([{ type: "chooseBail", player: "ben", use: false }]);
    const chosen = run(s, ...choice(s, { ...keen, bailAt: 1 }));
    expect(choice(chosen, keen)).toEqual([]);
    expect(bailChoice(viewFor(s, "ana"), keen, always)).toEqual([]);
    expect(choice(pending(false), keen)).toEqual([]);
    // Used: the shakedown falls through.
    const end = run(chosen, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "emergency-1" } });
    expect(end.log.some((e) => e.type === "shakedownCancelled")).toBe(true);
  });

  it("every personality has a shop chance and a Bail policy (design §19.3)", () => {
    for (const p of Object.values(PERSONALITIES)) {
      expect(p.shop, p.name).toBeGreaterThanOrEqual(0);
      expect(p.shop, p.name).toBeLessThanOrEqual(1);
      expect(p.bailAt === null || p.bailAt >= 1, p.name).toBe(true);
    }
  });
});
