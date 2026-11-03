import { describe, expect, it } from "vitest";
import { CREW_COLOURS, crewColour, initialsOf } from "./avatarLooks";

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

describe("crewColour", () => {
  it("is stable per name, ignoring case and spaces", () => {
    expect(crewColour("Lou")).toBe(crewColour(" lou "));
    expect(CREW_COLOURS).toContain(crewColour("anyone"));
  });
  it("maps seat indexes round the palette", () => {
    expect(crewColour(0)).toBe(CREW_COLOURS[0]);
    expect(crewColour(CREW_COLOURS.length + 2)).toBe(CREW_COLOURS[2]);
  });
});
