import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEAT_COLOURS, crewColour, initialsOf, seatOfPlayer } from "./avatarLooks";

const theme = readFileSync(new URL("../theme.css", import.meta.url), "utf8");
const token = (name: string) => theme.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))![1]!;
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

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

describe("seat colours", () => {
  const hexes = Array.from({ length: SEAT_COLOURS }, (_, i) => token(`seat-${i + 1}`));
  it("has 12 distinct tokens that the cream initials read on (4.5:1)", () => {
    expect(SEAT_COLOURS).toBe(12);
    expect(new Set(hexes).size).toBe(12);
    for (const hex of hexes) expect(contrast(hex, token("paper"))).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps every pair of colours visibly apart", () => {
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    for (const [i, a] of hexes.entries()) {
      for (const b of hexes.slice(i + 1)) expect(Math.hypot(...rgb(a).map((v, k) => v - rgb(b)[k]!))).toBeGreaterThan(30);
    }
  });
  it("gives seats 0-11 twelve different colours, stable per seat", () => {
    const colours = Array.from({ length: 12 }, (_, i) => crewColour(i));
    expect(new Set(colours).size).toBe(12);
    expect(crewColour(0)).toBe("var(--seat-1)");
    expect(crewColour(12)).toBe(crewColour(0));
  });
  it("reads the seat from an engine player id", () => {
    expect(seatOfPlayer("p1")).toBe(0);
    expect(seatOfPlayer("p12")).toBe(11);
    expect(seatOfPlayer("alice")).toBeUndefined();
  });
});

describe("crewColour by name", () => {
  it("is stable per name, ignoring case and spaces, and is a seat token", () => {
    expect(crewColour("Lou")).toBe(crewColour(" lou "));
    expect(crewColour("anyone")).toMatch(/^var\(--seat-\d+\)$/);
  });
});
