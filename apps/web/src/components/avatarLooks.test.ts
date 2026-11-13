import { describe, expect, it } from "vitest";
import { initialsOf } from "./avatarLooks";

// ui-style "Player avatars": initials in Pangolin on a crew colour from §2.
describe("initialsOf", () => {
  it("takes the first letters of the first two words", () => {
    expect(initialsOf("Lucky Lou")).toBe("LL");
    expect(initialsOf("  karthik  ")).toBe("K");
    expect(initialsOf("ana-maria de souza")).toBe("AM");
    expect(initialsOf("the.fox")).toBe("TF");
  });
  it("skips punctuation and copes with empty and non-latin names", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("!!!")).toBe("?");
    expect(initialsOf("(Mo) Salah")).toBe("MS");
    expect(initialsOf("émile zola")).toBe("ÉZ");
    expect(initialsOf("खुशी")).toBe("ख");
  });
});
