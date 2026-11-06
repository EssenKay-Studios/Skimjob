// QA (PR #130, R7 C2c): the sim CLI refuses a cut R6 role or the dropped mole flag cleanly, and
// bots play full games at 3, 6 and 12 on every deck with no refused command, deterministically.
import { describe, expect, it } from "vitest";
import { PERSONALITIES, createBots, runBotGame } from "@skimjob/bots";
import { parseSimArgs, type SimOptions } from "./args";
import { setupGame } from "./crew";
import { checkOptions } from "./run";

const CUT = ["insideMan", "getawayDriver", "fence", "blackmailer", "forger", "muscle", "snitch", "bagman", "cleaner", "mastermind", "embezzler"];
const KEPT = new Set(["rookie", "lookout", "hacker", "smoothTalker", "auditor", "detective", "priest", "fixer", "mole"]);
const opts = (argv: string[]): SimOptions => {
  const r = parseSimArgs(argv);
  if (r.kind !== "run") throw new Error(`expected a run, got ${JSON.stringify(r)}`);
  return r.options;
};

describe("sim CLI: cut roles and the mole flag", () => {
  it.each(CUT)("--role-pool naming %s is refused by checkOptions with 'unknown role', no throw", (cut) => {
    const o = opts(["--role-pool", `lookout,${cut}`, "-p", "3,6,12", "--no-files"]);
    let errors: string[] = [];
    expect(() => (errors = checkOptions(o))).not.toThrow();
    expect(errors).toContain(`unknown role ${cut}`);
  });
  it("--mole is not an option any more: a clean parse error, not a run", () => {
    let r: ReturnType<typeof parseSimArgs> | undefined;
    expect(() => (r = parseSimArgs(["--mole", "off"]))).not.toThrow();
    expect(r!.kind).not.toBe("run");
  });
});

describe("bots play full games with kept roles only", () => {
  for (const deck of ["starter", "standard", "everything"]) {
    for (const n of [3, 6, 12]) {
      it(`${deck} at ${n}: 6 games end, 0 refused commands, only kept roles, same seed = same log`, () => {
        const o = opts(["--deck", deck, "--events", "--seed", `qa130-${deck}`, "--no-files"]);
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
          for (const p of Object.values(a.state.players)) expect(KEPT.has(p.role)).toBe(true);
          if (i < 2) expect(play().state.log).toEqual(a.state.log);
        }
      });
    }
  }
});
