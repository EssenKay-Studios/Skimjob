// QA (PR #172, S3a.5): the Priest's text after the bank-paid blessing was deleted. design §9.6
import { ROLES, type RoleId } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import { roleInfo } from "./extension";

describe("no role promises the deleted compensation (design §9.6: clean means nothing happens)", () => {
  it("the Priest earns a token when a player it blessed is shaken down clean; nobody is paid", () => {
    expect(roleInfo("priest").earns).toBe("A token when: a player it blessed is shaken down clean.");
  });

  it("no role's power or reward mentions a payout or compensation", () => {
    for (const id of Object.keys(ROLES) as RoleId[]) {
      const info = roleInfo(id);
      expect(`${info.power} ${info.earns ?? ""}`, id).not.toMatch(/compensat|pays? out|bank pays/i);
    }
  });
});
