import { describe, expect, it } from "vitest";
import { controlOf, seatOffers, type Control } from "./host";

describe("controlOf", () => {
  it("reads a view frame's control, dropping bad parts", () => {
    expect(controlOf({ control: { pausedAt: 5, standIns: ["p1", 3], idle: ["p2"] } })).toEqual({ pausedAt: 5, standIns: ["p1"], idle: ["p2"] });
    expect(controlOf({ control: { pausedAt: "soon", standIns: null } })).toEqual({ pausedAt: null, standIns: [], idle: [] });
    expect(controlOf({ view: {} })).toBeNull();
    expect(controlOf({ control: [] })).toBeNull();
  });
});

describe("seatOffers (design §15)", () => {
  const seats = [
    { seat: 0, playerId: "p0", name: "Host" },
    { seat: 1, playerId: "p1", name: "Ana" },
    { seat: 2, playerId: "p2", name: "Bo" },
    { seat: 3, playerId: "p3", name: "Cy" },
  ];
  it("offers a bot for idle seats but the host's own, and the hand-back for stand-ins", () => {
    const c: Control = { pausedAt: null, standIns: ["p2"], idle: ["p0", "p1", "p2"] };
    expect(seatOffers(c, seats, "p0").map((o) => [o.kind, o.seat.name])).toEqual([
      ["replace", "Ana"],
      ["handBack", "Bo"],
    ]);
  });
});
