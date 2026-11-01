import { describe, expect, it } from "vitest";
import { CREW_SIZE, crewLooks, crookLabel, crookLook, HATS } from "./crook";

describe("crook looks (M2-9 avatars)", () => {
  it("gives 12 seats 12 different colours", () => {
    const looks = crewLooks(12);
    expect(new Set(looks.map((l) => l.colour)).size).toBe(CREW_SIZE);
  });

  it("neighbouring seats wear different hats", () => {
    const looks = crewLooks(12);
    for (let i = 1; i < looks.length; i++) expect(looks[i]!.hat).not.toBe(looks[i - 1]!.hat);
    expect(new Set(looks.map((l) => l.hat)).size).toBe(HATS.length);
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
