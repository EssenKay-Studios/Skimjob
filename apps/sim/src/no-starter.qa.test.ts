// QA (PR #128): the sim CLI has no starter mode any more; --deck starter is the only way to the Starter roles.
import { describe, expect, it } from "vitest";
import { STARTER_ROLES } from "@skimjob/content";
import { parseSimArgs } from "./args";
import { checkOptions, runOne } from "./run";

describe("QA: --starter is gone from the sim", () => {
  it("--starter (alone, with --events, =true) is a clean usage error, not a crash", () => {
    for (const argv of [["--starter"], ["--starter", "--events"], ["--starter=true"], ["-p", "5", "--starter"]]) {
      const r = parseSimArgs(argv);
      expect(r.kind, argv.join(" ")).toBe("error");
      if (r.kind === "error") expect(r.message).toMatch(/starter/);
    }
  });

  it("--deck starter --events is a valid normal game: Starter roles, events allowed", () => {
    const r = parseSimArgs(["--deck", "starter", "--events", "-p", "3,8,12", "-n", "1"]);
    expect(r.kind).toBe("run");
    if (r.kind !== "run") return;
    expect(r.options).not.toHaveProperty("starterMode");
    expect(checkOptions(r.options)).toEqual([]);
    for (const n of [3, 8, 12]) {
      const rec = runOne(r.options, n, 0);
      expect(JSON.stringify(rec)).toBeTruthy();
    }
    expect(STARTER_ROLES.length).toBeGreaterThan(0);
  });
});
