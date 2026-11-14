// Rulesets as content (design §19.2 seam 3) and the Learn the game ruleset
// (design §14): the ruleset selects the roles dealt, the black market, the
// event deck and the bank and round cap; the engine never reads its name.
import { BANK_JOB, DEFAULT_RULESET, EVENT_DECK, RULESETS } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import { createGame, setupEvents, validateConfig } from "./setup";
import { jobFor, rulesetOf } from "./overrides";
import type { GameConfig } from "./types";

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: i > 0 }));
const config = (seed: string, extra: Partial<GameConfig> = {}, n = 4): GameConfig => ({
  seed,
  players: seats(n),
  job: "bank",
  eventsEnabled: true,
  voteVisibility: "hiddenThenRevealed",
  ...extra,
});
const learn = (seed: string, extra: Partial<GameConfig> = {}) => config(seed, { ruleset: "learn", ...extra });

describe("Learn the game ruleset — design §14", () => {
  it("deals one each of the Lookout, Locksmith, Detective and Hacker to a crew of 4, whatever the seed", () => {
    for (let i = 0; i < 40; i++) {
      const state = createGame(learn(`learn-${i}`));
      const dealt = state.playerOrder.map((p) => state.players[p]!.role).sort();
      expect(dealt).toEqual(["detective", "hacker", "locksmith", "lookout"]);
    }
  });

  it("has no shop: the black market deals no perks", () => {
    expect(createGame(learn("shop")).shop).toEqual([]);
  });

  it("has a small bank and a 6-round cap", () => {
    const state = createGame(learn("bank"));
    expect(jobFor(state.config).roundCap).toBe(6);
    expect(state.bank).toBe(10 * 4);
    expect(state.bank).toBeLessThan(BANK_JOB.bank.coinsPerPlayer * 4);
  });

  it("names its ruleset in the public setup event", () => {
    const created = setupEvents(learn("named")).find((e) => e.type === "gameCreated");
    expect(created).toMatchObject({ visibility: { kind: "public" }, ruleset: "learn" });
  });

  it("shows only its own roles as the Possible role list", () => {
    const shown = setupEvents(learn("possible", { roleList: "possible" })).find((e) => e.type === "roleListShown");
    expect(shown).toMatchObject({ roles: ["lookout", "locksmith", "detective", "hacker"] });
  });
});

describe("rulesets as content — design §19.2 seam 3", () => {
  it("a game that names no ruleset plays the default, the same game as naming it", () => {
    expect(rulesetOf({})).toBe(RULESETS[DEFAULT_RULESET]);
    const named = setupEvents(config("same", { ruleset: DEFAULT_RULESET }));
    expect(setupEvents(config("same"))).toEqual(named);
    expect(createGame(config("same")).shop).toHaveLength(3);
    expect(rulesetOf({}).events).toEqual(EVENT_DECK);
  });

  it("refuses an unknown ruleset", () => {
    expect(validateConfig(config("x", { ruleset: "nope" }))).toContain("unknown ruleset nope");
    expect(validateConfig(config("x", { ruleset: "__proto__" }))).toContain("unknown ruleset __proto__");
  });

  it("refuses a crew its roles can't deal (two of each kind, at most two copies: up to 8 players)", () => {
    expect(validateConfig(learn("8", { players: seats(8) }))).toEqual([]);
    expect(validateConfig(learn("9", { players: seats(9) }))).toContain("the ruleset's roles can't deal 9 players");
    expect(validateConfig(config("9", {}, 9))).toEqual([]);
  });
});
