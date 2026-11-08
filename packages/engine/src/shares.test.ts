// Equal shares, the kitty, the share, missing and honesty; the getaway car and
// the whole-crew win they lead to. design §4.2 step 5, §6.3, §7, §8.2
import { describe, expect, it } from "vitest";
import { FACTS } from "@skimjob/content";
import { handleThroughAlibis } from "./alibis.testkit";
import type { Command, ContentOverrides, GameConfig, GameEvent, GameState, Outcome } from "./types";
import { PUBLIC } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { viewFor } from "./view";
import { factVisibility } from "./bells";
import { honesty } from "./shares";
import { NO_RAIDS } from "./v01-numbers.testkit";

function game(players: number, contentOverrides: ContentOverrides | null = NO_RAIDS): GameState {
  const cfg: GameConfig = {
    seed: "shares-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    contentOverrides,
  };
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "lookout" } : e)));
}

function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, typeof c === "function" ? c(s) : c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}

const mv = (player: string, room: string, duffel = 0, pocket = 0): Command => ({ type: "submitMove", player, move: { room, duffel, pocket } }) as Command;
const ROUND = (s: GameState): Command => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const ofType = <T extends GameEvent["type"]>(s: GameState, type: T) => s.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const stashes = (s: GameState) => s.playerOrder.map((id) => s.players[id]?.stash);
const outcome = (s: GameState): Outcome => {
  if (s.phase.kind !== "ended") throw new Error(`game not over (${s.phase.kind})`);
  return s.phase.outcome;
};

describe("the split and the kitty — design §7.1, §7.2, §4.2 step 5", () => {
  it("the duffel is split equally among all players, the Rooftop too; the change is the kitty, carried into the next split", () => {
    // Round 1: 5 handed in, 4 ways: 1 each, kitty 1. Round 2: 3 handed in + the kitty: 1 each, kitty 0.
    let s = run(game(4), mv("p0", "vault", 3), mv("p1", "office", 2), mv("p2", "rooftop"), mv("p3", "rooftop"), ROUND);
    s = run(s, mv("p0", "vault", 2, 1), mv("p1", "lobby", 1), mv("p2", "rooftop"), mv("p3", "rooftop"), ROUND);
    expect(ofType(s, "duffelSplit")).toEqual([
      { type: "duffelSplit", visibility: PUBLIC, round: 1, handedIn: 5, setAside: 0, kittyIn: 0, cut: 1, kitty: 1, share: 1 },
      { type: "duffelSplit", visibility: PUBLIC, round: 2, handedIn: 3, setAside: 0, kittyIn: 1, cut: 1, kitty: 0, share: 2 },
    ]);
    // design §7.6: stash = share received + coins pocketed.
    expect(stashes(s)).toEqual([2 + 1, 2, 2, 2]);
    // design §7.5: a coin counts once; the kitty's coin re-split in round 2 doesn't count again.
    expect([s.share, s.kitty, s.reached]).toEqual([2, 0, 5 + 3]);
  });

  it("coins set aside since the last split join it, then the next split starts from none (design §7.1)", () => {
    const before = { ...game(3), setAside: 4 }; // as a shakedown would leave them (design §9.6)
    const s = run(before, mv("p0", "lobby", 1), mv("p1", "rooftop"), mv("p2", "rooftop"), ROUND);
    expect(ofType(s, "duffelSplit")[0]).toMatchObject({ handedIn: 1, setAside: 4, kittyIn: 0, cut: 1, kitty: 2 });
    expect(stashes(s)).toEqual([1, 1, 1]);
    // design §7.5, §9.6: set-aside coins count toward honesty as they reach the split, like hand-ins.
    expect([s.setAside, s.reached]).toEqual([0, 1 + 4]);
  });

  it("a bust skips the split: the round's hand-ins and the kitty reach no stash (design §4.2 step 4, §5.5)", () => {
    // Round 1: 2 handed in, 3 ways: the kitty is 2. Round 2: Wanted 2 and the Vault one bulb short; p0 rings it.
    let s = run(game(3, null), mv("p0", "rooftop"), mv("p1", "office", 2), mv("p2", "rooftop"), ROUND);
    expect([s.share, s.kitty]).toEqual([0, 2]);
    s = run({ ...s, wanted: 2, bells: { ...s.bells, vault: 3 } }, mv("p0", "vault", 1), mv("p1", "office", 2), mv("p2", "rooftop"), ROUND);
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "bust", escapees: ["p2"] });
    expect(ofType(s, "duffelSplit").map((e) => e.round)).toEqual([1]);
    expect(stashes(s)).toEqual([0, 0, 0]);
    expect(outcome(s)).not.toHaveProperty("getaway");
  });
});

describe("the round summary: taken, missing and honesty — design §7.4, §7.5, §19 seam 1", () => {
  it("\"N coins went missing\": coins taken less coins handed in, never who; public in every view", () => {
    const s = run(game(3), mv("p0", "vault", 1, 2), mv("p1", "office", 2), mv("p2", "lobby", 0, 1), ROUND);
    const [summary] = ofType(s, "roundResolved");
    expect(summary).toEqual({ type: "roundResolved", visibility: PUBLIC, round: 1, bank: 48 - 6, taken: 6, missing: 3, honesty: { reached: 3, taken: 6 } });
    for (const id of s.playerOrder) {
      const view = viewFor(s, id);
      expect(view.ledger.map((e) => e.event)).toContainEqual(summary);
      expect(view.ledger.map((e) => e.event)).toContainEqual(ofType(s, "duffelSplit")[0]);
      expect([view.share, view.kitty, view.honesty]).toEqual([1, 0, { reached: 3, taken: 6 }]);
    }
  });

  it("honesty reads full before any coin is taken, then coins that reached the duffel ÷ coins taken", () => {
    const s = game(3);
    expect(viewFor(s, "p0").honesty).toEqual({ reached: 0, taken: 0 });
    expect(honesty(viewFor(s, "p0").honesty)).toBe(1);
    const after = run(s, mv("p0", "vault", 1, 2), mv("p1", "office", 2), mv("p2", "lobby", 0, 1), ROUND);
    expect(honesty(viewFor(after, "p1").honesty)).toBe(3 / 6);
  });

  it("the bank, the duffel split, missing coins and honesty are public facts from the content catalogue", () => {
    expect(FACTS).toMatchObject({ bank: "public", duffel: "public", missing: "public", honesty: "public" });
    expect(factVisibility("bank", "missing", "honesty")).toEqual(PUBLIC);
    expect(factVisibility("duffel")).toEqual(PUBLIC);
  });
});

describe("the getaway car and the whole-crew win — design §6.3, §8.1, §8.2", () => {
  it("an honest crew's stashes are all the share, so the whole crew wins; the kitty pays for the getaway car", () => {
    // One round: 5 handed in, 3 ways: 1 each and 2 left over.
    const s = run(game(3, { ...NO_RAIDS, roundCap: 1 }), mv("p0", "vault", 3), mv("p1", "office", 2), mv("p2", "rooftop"), ROUND);
    expect(stashes(s)).toEqual([1, 1, 1]);
    expect(outcome(s)).toMatchObject({ result: "success", winners: ["p0", "p1", "p2"], getaway: 2 });
  });

  it("one coin pocketed above the share breaks the tie: only that player wins", () => {
    const s = run(game(3, { ...NO_RAIDS, roundCap: 1 }), mv("p0", "vault", 2, 1), mv("p1", "office", 2), mv("p2", "rooftop"), ROUND);
    expect(stashes(s)).toEqual([1 + 1, 1, 1]);
    expect(outcome(s)).toMatchObject({ result: "success", winners: ["p0"], getaway: 1 });
  });
});
