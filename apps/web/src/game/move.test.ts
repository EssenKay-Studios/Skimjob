// The move panel's helpers, from real engine views. design §3.2, §5.2, §11.1
import { type RoleId } from "@skimjob/content";
import { viewFor, type GameConfig, type PlayerView } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { createGame } from "./deal.testkit";
import { roomOptions } from "./hud";
import { abilityOf, bagsOf, bellPreview, grabOf, mayRunShort, moveCoin, powerControl, sameMove, shareEach } from "./move";

const config = (n = 5): GameConfig => ({
  seed: "move-test",
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isBot: i > 0 })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
});
const viewAs = (role: RoleId, n = 5): PlayerView => viewFor(createGame(config(n), [role]), "p1");
const option = (view: PlayerView, id: string) => roomOptions(view).find((o) => o.id === id)!;

describe("the grab and the two bags (design §3.2)", () => {
  it("grabs 1 up to the room's limit in a coin room and nothing where there are no coins", () => {
    expect(grabOf(3, null)).toBe(3);
    expect(grabOf(3, 2)).toBe(2);
    expect(grabOf(3, 0)).toBe(1); // at least 1 coin
    expect(grabOf(2, 9)).toBe(2); // never above the limit
    expect(grabOf(0, 2)).toBe(0); // Security, Rooftop
  });

  it("splits the grab into the bags, the pocket never above the grab", () => {
    expect(bagsOf(3, 1)).toEqual({ duffel: 2, pocket: 1 });
    expect(bagsOf(2, 5)).toEqual({ duffel: 0, pocket: 2 });
    expect(bagsOf(0, 2)).toEqual({ duffel: 0, pocket: 0 });
  });

  it("moves one coin to the other bag, and nothing when that bag has none", () => {
    expect(moveCoin({ duffel: 2, pocket: 0 }, "pocket")).toEqual({ duffel: 1, pocket: 1 });
    expect(moveCoin({ duffel: 1, pocket: 1 }, "duffel")).toEqual({ duffel: 2, pocket: 0 });
    expect(moveCoin({ duffel: 0, pocket: 2 }, "pocket")).toEqual({ duffel: 0, pocket: 2 });
    expect(moveCoin({ duffel: 2, pocket: 0 }, "duffel")).toEqual({ duffel: 2, pocket: 0 });
  });

  it("compares moves whatever order the fields come in", () => {
    const a = { room: "vault", duffel: 1, pocket: 2, ability: { kind: "hide" as const, room: "office" } };
    expect(sameMove(a, JSON.parse('{"ability":{"room":"office","kind":"hide"},"pocket":2,"duffel":1,"room":"vault"}'))).toBe(true);
    expect(sameMove(a, { ...a, pocket: 1 })).toBe(false);
    expect(sameMove(a, null)).toBe(false);
  });
});

describe("the bell preview (design §5.2, §5.3)", () => {
  it("lights the rings of the grab: the first Office coin is quiet, every Vault coin rings", () => {
    const v = viewAs("detective");
    expect(bellPreview(v, option(v, "office"), 1)).toMatchObject({ bulbs: 4, lit: 0, adds: 0, raid: false });
    expect(bellPreview(v, option(v, "office"), 2)).toMatchObject({ adds: 1 });
    expect(bellPreview(v, option(v, "vault"), 3)).toMatchObject({ adds: 3, raid: false });
    expect(bellPreview(v, option(v, "lobby"), 1)).toMatchObject({ adds: 0 });
  });

  it("shows the bulbs already lit and caps what the grab adds at the last bulb", () => {
    const v = viewAs("detective");
    const lit = { ...v, bells: { ...v.bells, vault: 2 } };
    expect(bellPreview(lit, option(lit, "vault"), 3)).toMatchObject({ lit: 2, adds: 2 });
  });

  it("warns of a raid when your grab alone lights the last bulb", () => {
    const v = viewAs("detective");
    // The Vault's 3 coins ring 3 times: one short of 4 bulbs, unless the job's bell has fewer.
    expect(bellPreview(v, option(v, "vault"), 3).raid).toBe(false);
    const three = viewFor(createGame({ ...config(), contentOverrides: { alarm: { bulbs: 3 } } }, ["detective"]), "p1");
    expect(bellPreview(three, option(three, "vault"), 3)).toMatchObject({ bulbs: 3, adds: 3, raid: true });
  });

  it("is silent for the Locksmith (design §5.2) and with Soft shoes (design §12)", () => {
    const smith = viewAs("locksmith");
    expect(bellPreview(smith, option(smith, "vault"), 3).adds).toBe(0);
    const v = viewAs("detective");
    const shoes = {
      ...v,
      round: 2,
      caseFile: [{ seq: 1, event: { type: "perkBought", visibility: { kind: "private", player: "p1" }, player: "p1", round: 1, perk: { kind: "softShoes" }, cost: 1 } }],
    } as unknown as PlayerView;
    expect(bellPreview(shoes, option(shoes, "vault"), 3).adds).toBe(0);
    // Bought for another round, it does nothing now.
    expect(bellPreview({ ...shoes, round: 3 }, option(shoes, "vault"), 3).adds).toBe(3);
  });

  it("shows no count while a Hacker hides the bell (design §5.1)", () => {
    const v = viewAs("detective");
    const { vault: _hidden, ...bells } = v.bells;
    const hidden = { ...v, bells, hiddenBells: ["vault"] };
    expect(bellPreview(hidden, option(hidden, "vault"), 2)).toMatchObject({ lit: null, adds: 2 });
  });
});

describe("the share preview (design §7.1)", () => {
  it("divides your duffel coins by the crew", () => {
    expect(shareEach(viewAs("lookout", 5), 3)).toBeCloseTo(0.6);
    expect(shareEach(viewAs("lookout", 4), 0)).toBe(0);
  });
});

describe("the bank may run short (design §3.2)", () => {
  it("is true when every player's biggest possible grab adds up to more than the bank", () => {
    const v = viewAs("lookout", 5);
    const opts = roomOptions(v);
    expect(mayRunShort({ ...v, bank: 80 }, opts)).toBe(false);
    expect(mayRunShort({ ...v, bank: 15 }, opts)).toBe(false); // 5 players x 3 = 15: exactly covered
    expect(mayRunShort({ ...v, bank: 14 }, opts)).toBe(true);
  });

  it("counts only the rooms still open: a closed Vault lowers the biggest grab to 2", () => {
    const v = { ...viewAs("lookout", 5), bank: 14, taped: { vault: 3 } };
    expect(mayRunShort(v, roomOptions(v))).toBe(false);
  });

  it("counts a Shift change surge", () => {
    const v = { ...viewAs("lookout", 5), bank: 15 };
    const surged = { ...v, card: { round: v.round, id: "shiftChange", room: null } };
    expect(mayRunShort(surged, roomOptions(surged))).toBe(true); // 4 x 5 = 20 > 15
  });
});

describe("the move powers (design §11.1)", () => {
  it("offers each role the target its power takes", () => {
    const all = viewAs("lookout").rooms;
    expect(powerControl(viewAs("lookout"))).toEqual({ kind: "lookout", target: "room", pick: 1, rooms: all });
    expect(powerControl(viewAs("electrician"))).toEqual({ kind: "blackout", target: "room", pick: 1, rooms: all });
    expect(powerControl(viewAs("priest"))).toEqual({ kind: "absolve", target: "player" });
    expect(powerControl(viewAs("hacker"))).toMatchObject({ kind: "hide", rooms: all });
  });

  it("gives no control to a passive power or one used outside a move", () => {
    for (const role of ["locksmith", "smoothTalker", "detective", "auditor"] as const) expect(powerControl(viewAs(role))).toBeNull();
  });

  it("keeps taped-off rooms away from the Hacker and the Mole, the Rooftop too for the Mole, and gives them to the Fixer", () => {
    const taped = (role: RoleId) => ({ ...viewAs(role), taped: { vault: 3 } });
    const rooms = (c: ReturnType<typeof powerControl>) => (c && "rooms" in c ? c.rooms : []);
    expect(rooms(powerControl(taped("hacker")))).not.toContain("vault");
    expect(rooms(powerControl(taped("hacker")))).toContain("office");
    const mole = rooms(powerControl(taped("mole")));
    expect(mole).not.toContain("vault");
    expect(mole).not.toContain("rooftop");
    expect(mole).toContain("office");
    expect(rooms(powerControl(viewAs("mole")))).toContain("vault");
    expect(powerControl(taped("fixer"))).toMatchObject({ kind: "reopen", rooms: ["vault"] });
    expect(powerControl(viewAs("fixer"))).toMatchObject({ kind: "reopen", rooms: [] });
  });

  it("offers nothing once the power is spent: since the last meeting, or this game", () => {
    const spent = (role: RoleId, roleState: Partial<PlayerView["me"]["roleState"]>) => {
      const v = viewAs(role);
      return { ...v, me: { ...v.me, roleState: { ...v.me.roleState, ...roleState } } };
    };
    expect(powerControl(spent("hacker", { usedThisStretch: 1 }))).toBeNull();
    expect(powerControl(spent("fixer", { usedThisGame: 1 }))).toBeNull();
    expect(powerControl(spent("fixer", { usedThisStretch: 1 }))).not.toBeNull(); // the Fixer counts per game
    expect(powerControl(spent("lookout", { usedThisStretch: 3 }))).not.toBeNull(); // every round
  });

  it("builds the move's ability from what is picked, and none when nothing valid is", () => {
    const hacker = powerControl(viewAs("hacker"));
    expect(abilityOf(hacker, ["office"], null)).toEqual({ kind: "hide", room: "office" });
    expect(abilityOf(hacker, [], null)).toBeUndefined();
    expect(abilityOf(hacker, ["nowhere"], null)).toBeUndefined();
    expect(abilityOf(powerControl(viewAs("lookout")), ["vault", "office"], null)).toEqual({ kind: "lookout", rooms: ["vault"] }); // 1 extra room
    expect(abilityOf(powerControl(viewAs("priest")), [], "p2")).toEqual({ kind: "absolve", target: "p2" });
    expect(abilityOf(powerControl(viewAs("priest")), [], null)).toBeUndefined();
    expect(abilityOf(null, ["vault"], "p2")).toBeUndefined();
  });
});
