import { describe, expect, it } from "vitest";
import { parseInviteCode } from "./inviteCode";

// Landing "join with invite code" (m2-plan M2-5): tidy input, the server has the final say.
describe("parseInviteCode", () => {
  it("lower-cases and drops spaces and dashes", () => {
    expect(parseInviteCode(" K7QX-M2PA ")).toBe("k7qxm2pa");
    expect(parseInviteCode("ab cd ef")).toBe("abcdef");
  });
  it("reads the code out of a pasted invite link", () => {
    expect(parseInviteCode("http://localhost:5173/join/k7qxm2pa9z")).toBe("k7qxm2pa9z");
    expect(parseInviteCode("https://skimjob.example/invite/ABCD1234?ref=chat")).toBe("abcd1234");
  });
  it("rejects what can't be a code", () => {
    expect(parseInviteCode("")).toBeNull();
    expect(parseInviteCode("abc")).toBeNull();
    expect(parseInviteCode("a".repeat(17))).toBeNull();
    expect(parseInviteCode("abcd!efg")).toBeNull();
    expect(parseInviteCode("<script>")).toBeNull();
  });
});
