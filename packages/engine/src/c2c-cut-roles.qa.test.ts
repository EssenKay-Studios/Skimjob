// QA (PR #130, R7 C2c): the 11 cut R6 roles and the legacy `mole?` setting are gone.
// Overrides naming them are refused (or the dead setting ignored) without a crash.
// design §11.1, §17.2
import { describe, expect, it } from "vitest";
import { ROLES } from "@skimjob/content";
import type { GameConfig } from "./types";
import { createGame, setupEvents, validateConfig } from "./setup";

const CUT = ["insideMan", "getawayDriver", "fence", "blackmailer", "forger", "muscle", "snitch", "bagman", "cleaner", "mastermind", "embezzler"];
const R7_ROLES = ["lookout", "locksmith", "detective", "auditor", "smoothTalker", "hacker", "electrician", "priest", "mole", "fixer"];

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "qa-c2c",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  };
}

describe("cut roles and the old mole setting at engine setup", () => {
  it("the content table holds exactly the 10 R7 roles (design §11.1)", () => {
    expect(Object.keys(ROLES).sort()).toEqual([...R7_ROLES].sort());
    for (const cut of CUT) expect(Object.values(createGame(config(12)).players).map((p) => p.role)).not.toContain(cut);
  });
  it.each(CUT)("content overrides for %s are refused, never a throw", (cut) => {
    let errors: string[] = [];
    expect(() => (errors = validateConfig(config(5, { contentOverrides: { roles: { [cut]: { perStretch: 2 } } } as never })))).not.toThrow();
    expect(errors.length).toBeGreaterThan(0);
  });
  it.each(["off", "maybe", "on", 7, null])("a stored config still carrying mole: %s neither crashes nor changes the deal", (mole) => {
    for (const n of [3, 5, 8, 12]) {
      const plain = config(n, { seed: `mole-${n}` });
      const legacy = { ...plain, mole } as unknown as GameConfig;
      expect(() => validateConfig(legacy)).not.toThrow();
      expect(validateConfig(legacy)).toEqual([]);
      expect(setupEvents(legacy)).toEqual(setupEvents(plain));
    }
  });
});
