import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREW_SIZE, crewLooks, crewTags, crookLabel, crookLook, HATS, nameTag } from "./crookLooks";

const theme = readFileSync(new URL("../theme.css", import.meta.url), "utf8");
const token = (name: string) => theme.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))![1]!;
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

describe("crook looks (M2-9 avatars)", () => {
  it("keeps the 12 crew colours distinct and readable under the cream avatar initials (4.5:1)", () => {
    const hexes = Array.from({ length: CREW_SIZE }, (_, i) => token(`crew-${i + 1}`));
    expect(new Set(hexes).size).toBe(CREW_SIZE);
    for (const hex of hexes) expect(contrast(hex, token("paper"))).toBeGreaterThanOrEqual(4.5);
  });

  it("gives 12 seats 12 different colours", () => {
    const looks = crewLooks(12);
    expect(new Set(looks.map((l) => l.colour)).size).toBe(CREW_SIZE);
  });

  it("gives 12 seats 12 different hats, so seats differ without colour vision (red-green CVD)", () => {
    const looks = crewLooks(12);
    expect(HATS).toHaveLength(CREW_SIZE);
    expect(new Set(looks.map((l) => l.hat)).size).toBe(CREW_SIZE);
    // Colour pairs that merge under deuteranopia/protanopia (seats 1-based): very different hats.
    for (const [a, b] of [
      [4, 9],
      [3, 8],
      [6, 11],
      [1, 3],
    ] as const)
      expect(looks[a - 1]!.hat).not.toBe(looks[b - 1]!.hat);
    // A second lap of seats doesn't repeat seat 0's colour + hat.
    expect(crookLook(12).hat).not.toBe(crookLook(0).hat);
  });

  it("never paints a hat in its wearer's body colour family", () => {
    for (let i = 0; i < 12; i++) {
      const l = crookLook(i);
      expect([l.colour, l.hatColour], `seat ${i}`).not.toEqual([2, 4]);
      expect([l.colour, l.hatColour], `seat ${i}`).not.toEqual([7, 3]);
    }
  });

  it("name tags: initials or two letters, unique within a crew", () => {
    expect(nameTag("Mara Vox")).toBe("MV");
    expect(nameTag("dez")).toBe("De");
    expect(nameTag("  ")).toBe("?");
    expect(crewTags(["Mara", "Max", "Mara", "Dez"])).toEqual(["Ma", "Mx", "Mr", "De"]);
    const twelve = crewTags(["Mara", "Dez", "Lou", "Priya", "Otto", "Sam", "Ines", "Kofi", "Wren", "Bea", "Juno", "Tam"]);
    expect(new Set(twelve).size).toBe(12);
    expect(twelve.every((t) => t.length <= 2)).toBe(true);
  });

  it("is deterministic for seats and for string seeds", () => {
    expect(crookLook(3)).toEqual(crookLook(3));
    expect(crookLook("Mara Vox")).toEqual(crookLook(" mara vox "));
    expect(crookLook("Mara Vox").colour).toBeGreaterThanOrEqual(1);
    expect(crookLook("Mara Vox").colour).toBeLessThanOrEqual(CREW_SIZE);
  });

  it("labels say the mood and mark bots", () => {
    expect(crookLabel("Dez")).toBe("Dez");
    expect(crookLabel("Dez", "smug", true)).toBe("Dez, looking smug (bot)");
    expect(crookLabel("Lou", "caught")).toBe("Lou, caught");
  });
});
