// QA (PR #50, R6a): the saboteur-setting migration and Quick forcing Starter,
// against docs/extension.md Build notes "Tags, decks and dealing" and "Host settings".
import { describe, expect, it } from "vitest";
import { DECKS, ROLES } from "@skimjob/content";
import { createGame, viewFor } from "@skimjob/engine";
import { gameConfig } from "./lobby";
import { DEFAULT_SETTINGS, parseSettings, storedSettings, type LobbySettings } from "./settings";

const ok = (input: unknown): LobbySettings => {
  const r = parseSettings(input);
  if (!r.ok) throw new Error(r.error);
  return r.settings;
};
const tagOf = (r: string) => ROLES[r as keyof typeof ROLES]?.tag;
const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ nickname: `P${i}`, bot_personality: i === 0 ? null : ("honest" as const) }));

describe("a stored saboteur setting is migrated on read, never kept", () => {
  it("Off: the deck with every Wildcard and Lone wolf toggled off, Balanced deal", () => {
    for (const deck of ["standard", "everything"] as const) {
      for (const s of [ok({ mole: "off", deck }), storedSettings({ mole: "off", deck })]) {
        expect(s).not.toHaveProperty("mole");
        expect(s.roles.length).toBeGreaterThan(0);
        expect(s.roles.every((r) => tagOf(r) === "teamPlayer")).toBe(true);
        expect([...s.roles].sort()).toEqual(DECKS[deck].filter((r) => tagOf(r) === "teamPlayer").sort());
        expect(s.deal).toBe("balanced");
      }
    }
    // Explicit toggles keep only their team players.
    const s = ok({ mole: "off", roles: ["mole", "fence", "lookout", "auditor"] });
    expect([...s.roles].sort()).toEqual(["auditor", "lookout"]);
  });

  it("Maybe and On: the plain deck; any other stored value is dropped, not an error on read", () => {
    for (const mole of ["maybe", "on"]) {
      const s = ok({ mole, deck: "everything" });
      expect(s).not.toHaveProperty("mole");
      expect(s.roles).toEqual([]);
    }
    for (const mole of ["garbage", 7, null, { off: true }]) expect(storedSettings({ mole })).toEqual(DEFAULT_SETTINGS);
  });

  it("a game made from a migrated Off setting never deals a Wildcard or Lone wolf and runs no police", () => {
    const s = storedSettings({ mole: "off", deck: "everything" });
    for (let i = 0; i < 40; i++) {
      for (const n of [4, 8, 12]) {
        const g = createGame(gameConfig({ ...s, roleList: "possible" }, seats(n), `mig-${n}-${i}`));
        for (const p of Object.values(g.players)) expect(tagOf(p.role), p.role).toBe("teamPlayer");
        expect(g.police).toBeNull();
      }
    }
  });
});

describe("Quick forces Starter with events off (no shop, no tokens), whatever else the host chose", () => {
  it("everything deck, events on, Possible list: Quick still deals Starter, no shop, no police", () => {
    const s = { ...ok({ deck: "everything", roleList: "possible", eventsEnabled: true }), sessionLength: "quick" as const };
    for (const n of [3, 5, 8, 12]) {
      for (let i = 0; i < 10; i++) {
        const cfg = gameConfig(s, seats(n), `quick-${n}-${i}`);
        expect(cfg).toMatchObject({ starterMode: true, eventsEnabled: false, rolePool: [] });
        const g = createGame(cfg);
        expect(g.shop).toEqual([]);
        expect(g.police).toBeNull();
        for (const p of Object.values(g.players)) expect(DECKS.starter, p.role).toContain(p.role);
        expect(viewFor(g, g.playerOrder[0]!).shop).toEqual([]);
      }
    }
  });

  it("the host's stored choices survive for when the length changes back", () => {
    const s = ok({ deck: "everything", roleList: "hidden", eventsEnabled: true, sessionLength: "quick" });
    expect(s).toMatchObject({ deck: "everything", roleList: "hidden", eventsEnabled: true });
    expect(gameConfig({ ...s, sessionLength: "1h" }, seats(5), "x")).toMatchObject({ starterMode: false, eventsEnabled: true });
  });
});
