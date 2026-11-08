// QA (S3a.6): the sim CLI has no role pool (every player gets a role from the
// one deal, design §11.3), and bots play full games at 3, 6 and 12 with only
// the ten R7 roles, no refused command, deterministically.
import { describe, expect, it } from "vitest";
import { ROLES } from "@skimjob/content";
import { PERSONALITIES, createBots, runBotGame } from "@skimjob/bots";
import { parseSimArgs, type SimOptions } from "./args";
import { setupGame } from "./crew";
import { checkOptions } from "./run";

const opts = (argv: string[]): SimOptions => {
  const r = parseSimArgs(argv);
  if (r.kind !== "run") throw new Error(`expected a run, got ${JSON.stringify(r)}`);
  return r.options;
};

describe("sim CLI: no role pool or mole flag", () => {
  it("--role-pool and --mole are not options any more: a clean parse error, not a run", () => {
    for (const argv of [["--role-pool", "lookout"], ["--mole", "off"]]) {
      let r: ReturnType<typeof parseSimArgs> | undefined;
      expect(() => (r = parseSimArgs(argv))).not.toThrow();
      expect(r!.kind).toBe("error");
    }
  });
});

describe("bots play full games with the R7 roles — design §11.3, §19.3", () => {
  for (const n of [3, 6, 12]) {
    it(`${n} players: 6 games end, 0 refused commands, a role per player from the ten, same seed = same log`, () => {
      const o = opts(["--events", "--seed", `qa-s3a6-${n}`, "--no-files"]);
      expect(checkOptions({ ...o, playerCounts: [n] })).toEqual([]);
      for (let i = 0; i < 6; i++) {
        const play = () => {
          const { config, crew } = setupGame(o, n, i);
          const agents = createBots(config.players, (_s, k) => PERSONALITIES[crew[k] as keyof typeof PERSONALITIES], config.seed);
          return runBotGame(config, agents);
        };
        const a = play();
        expect(a.state.phase.kind).toBe("ended");
        expect(a.rejections).toEqual([]);
        const roles = Object.values(a.state.players).map((p) => p.role);
        expect(roles).toHaveLength(n);
        for (const role of roles) expect(Object.hasOwn(ROLES, role)).toBe(true);
        if (n <= 10) expect(new Set(roles).size).toBe(n);
        if (i < 2) expect(play().state.log).toEqual(a.state.log);
      }
    });
  }
});
