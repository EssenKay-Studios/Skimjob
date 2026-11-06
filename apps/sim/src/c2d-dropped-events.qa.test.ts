// QA (PR #132, R7 C2d): sim options naming a dropped event card or the old Server-room
// pocket count are refused with a message before any game runs; --events games only flip kept cards. design §10, §17.4
import { describe, expect, it } from "vitest";
import { parseSimArgs, type SimOptions } from "./args";
import { checkOptions, runBatch } from "./run";

const options = (argv: string[]): SimOptions => {
  const r = parseSimArgs(argv);
  if (r.kind !== "run") throw new Error(`expected options, got ${JSON.stringify(r)}`);
  return r.options;
};
const DROPPED = ["quietNight", "payday", "powerCut", "raidRumour", "doubleCross"];

describe("QA: sim --overrides naming dropped content", () => {
  it.each(DROPPED)("--overrides for %s: checkOptions refuses it, never a throw", (card) => {
    const o = options(["--events", "--players", "3,6,12", "--overrides", JSON.stringify({ events: { [card]: { amount: 1 } } })]);
    let errors: string[] = [];
    expect(() => (errors = checkOptions(o))).not.toThrow();
    expect(errors).toContain(`contentOverrides.events.${card}: no such event card`);
  });
  it("--overrides giving the Server room an info power or a pocketCount is refused", () => {
    for (const room of [{ info: "pocketCount" }, { pocketCount: 1 }]) {
      const errors = checkOptions(options(["--players", "6", "--overrides", JSON.stringify({ rooms: { serverRoom: room } })]));
      expect(errors.join("\n")).toMatch(/contentOverrides\.rooms\.serverRoom\.\w+ is not an overridable field/);
    }
  });
  it("Shift change's dropped `amount` / `loss` fields are refused", () => {
    const errors = checkOptions(options(["--players", "6", "--overrides", JSON.stringify({ events: { shiftChange: { amount: 1, loss: 2 } } })]));
    expect(errors).toEqual(expect.arrayContaining(["contentOverrides.events.shiftChange.amount is not an overridable field", "contentOverrides.events.shiftChange.loss is not an overridable field"]));
  });
  it("--events bot games at 3 / 6 / 12: only kept cards flip, no refusals, same seed same records", { timeout: 120_000 }, () => {
    const o = options(["--events", "--players", "3,6,12", "--games", "6", "--seed", "qa-c2d-sim"]);
    expect(checkOptions(o)).toEqual([]);
    const a = runBatch(o);
    expect(a).toHaveLength(18);
    const text = JSON.stringify(a);
    for (const card of DROPPED) expect(text).not.toContain(card);
    expect(JSON.stringify(runBatch(o))).toBe(text);
  });
});
