// Role cards (design §11, §15.6, §20.2), the "This game" rulebook (§12, §13, §20)
// and endings, from real engine views.
import { BANK_JOB, ROOM_TEXT, EMERGENCY_POOL, EVENTS, EVENT_CHANCE, PERKS, PERK_TEXT, ROLES, ROLE_TEXT, ROLE_WIN, TERMS } from "@skimjob/content";
import { createGame, privateTo, viewFor, type GameConfig } from "@skimjob/engine";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EndingNote } from "../components/Reveal";
import { RoleCardBody, RolesInPlay } from "../components/RoleCard";
import { Rulebook } from "../components/Rulebook";
import { describeEvent } from "./describeEvent";
import { endingText } from "./reveal";
import { KIND_LABEL, abilityFor, abilityTargets, cadenceOf, explainSpot, eventsNote, numberRows, powerUse, roleInfo, roleListInfo } from "./roles";

const config = (extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "ext-test",
  players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i + 1}`, name: i === 0 ? "Ana" : `Bot · ${i}`, isBot: i > 0 })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  ...extra,
});
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
/** The text as React escapes it in markup. */
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

describe("role cards — design §11.1, §20.2", () => {
  it("gives every role its kind, cadence, power, How you win, bust and How to spot it lines from content", () => {
    for (const id of Object.keys(ROLES)) {
      const info = roleInfo(id)!;
      expect(info.kindLabel, id).toBe(KIND_LABEL[ROLES[id]!.kind]);
      expect(info.power, id).toBe(ROLE_TEXT[id]!.power);
      expect(info.howYouWin, id).toBe(ROLE_WIN[ROLE_TEXT[id]!.win]);
      expect(info.spot, id).toBe(ROLE_TEXT[id]!.spot);
      expect(info.bust).toBe("On a bust, only the Rooftop gets away.");
    }
    expect(roleInfo("hacker")).toMatchObject({ kind: "shadows", kindLabel: "Shadows", cadence: "Once between meetings" });
    expect(roleInfo("priest")).toMatchObject({ kind: "eyes", kindLabel: "Eyes" });
    expect(roleInfo("nobody")).toBeUndefined();
    expect(roleInfo("constructor")).toBeUndefined();
  });

  it("names each power's cadence (design §11.2) and how it is used", () => {
    expect(Object.keys(ROLES).map((id) => [id, cadenceOf(ROLES[id]!.power)])).toEqual([
      ["lookout", "Every round"],
      ["locksmith", "Every round"],
      ["detective", "Every round"],
      ["auditor", "Once between meetings"],
      ["smoothTalker", "Every meeting"],
      ["hacker", "Once between meetings"],
      ["electrician", "Once between meetings"],
      ["priest", "Once between meetings"],
      ["mole", "Once between meetings"],
      ["fixer", "Once a game"],
    ]);
    expect(Object.keys(ROLES).map((id) => powerUse(ROLES[id]!.power))).toEqual(["move", "passive", "instant", "instant", "passive", "move", "move", "move", "move", "move"]);
  });

  it("renders the card: icon, name, badges, power, how you win, how to spot it", () => {
    const ui = html(createElement(RoleCardBody, { info: roleInfo("lookout")! }));
    for (const t of ["Lookout", "Eyes", "Every round", ROLE_TEXT.lookout!.power, ROLE_WIN.crew, "On a bust, only the Rooftop gets away.", "How to spot it", ROLE_TEXT.lookout!.spot]) expect(ui).toContain(esc(t));
    expect(ui).toContain('aria-label="About Lookout"');
    expect(ui).toContain("role-icon");
  });
});

describe("the role list on the roles-in-play panel — design §11.3", () => {
  const view = (roleList: "exact" | "possible" | "hidden") => viewFor(createGame(config({ roleList, seed: "rl" })), "p1");

  it("exact lists the roles dealt, once each, with the count dealt", () => {
    const v = view("exact");
    const info = roleListInfo(v);
    expect(info).toMatchObject({ mode: "exact", title: "Roles in play", note: "exact list · 4 dealt" });
    expect(info.roles.map((r) => r.id).sort()).toEqual([...v.roleList!.roles].sort());
    const ui = html(createElement(RolesInPlay, { view: v }));
    expect(ui).toContain("exact list · 4 dealt");
    expect(ui).toContain(`${ROLES[v.me.role]!.name} (you)`);
  });

  it("possible lists what could be in play; hidden shows no chips", () => {
    expect(roleListInfo(view("possible"))).toMatchObject({ mode: "possible", title: "Roles that could be in play" });
    const hidden = roleListInfo(view("hidden"));
    expect(hidden).toMatchObject({ mode: "hidden", note: "hidden in this game", roles: [] });
    const ui = html(createElement(RolesInPlay, { view: view("hidden") }));
    expect(ui).toContain("hidden in this game");
    expect(ui).not.toContain("<li");
  });

  it("counts a role dealt twice (11–12 players, design §11.3)", () => {
    const v = viewFor(createGame(config({ players: Array.from({ length: 12 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isBot: i > 0 })), seed: "twelve" })), "p1");
    const list = roleListInfo(v);
    expect(list.roles.reduce((n, r) => n + r.count, 0)).toBe(12);
    expect(list.roles.some((r) => r.count === 2)).toBe(true);
  });
});

describe("the This game rulebook — design §12, §13, §15.6, §20", () => {
  const game = (extra: Partial<GameConfig> = {}) => viewFor({ ...createGame(config(extra)), shop: ["tail", "softShoes", "bail"] }, "p1");

  it("lists only this game's roles (exact list), its three perks with costs and the §20 lines", () => {
    const v = game();
    const ui = html(createElement(Rulebook, { view: v }));
    const inGame = new Set(v.roleList!.roles);
    for (const [id, def] of Object.entries(ROLES)) {
      if (inGame.has(id)) expect(ui, id).toContain(`${def.name}</b>`);
      else expect(ui, id).not.toContain(`${def.name}</b>`);
    }
    for (const id of inGame) expect(ui, id).toContain(esc(`Spot it: ${ROLE_TEXT[id]!.spot}`));
    for (const p of ["tail", "softShoes", "bail"] as const) expect(ui).toContain(PERK_TEXT[p]!.text);
    expect(ui).not.toContain(PERK_TEXT.plantEvidence!.text);
    expect(ui).toContain(`${PERKS.bail.cost} coins`);
    expect(ui).not.toMatch(/token/i);
  });

  it("hides the roles when the list is hidden, and lists Possible roles once each", () => {
    expect(html(createElement(Rulebook, { view: game({ roleList: "hidden" }) }))).toContain("The role list is hidden in this game.");
    const ui = html(createElement(Rulebook, { view: game({ roleList: "possible" }) }));
    expect(ui).toContain("possible list");
  });

  it("lists the events only when the game has them, with the §13 chance", () => {
    expect(html(createElement(Rulebook, { view: game() }))).not.toContain("Lockdown");
    const ui = html(createElement(Rulebook, { view: game({ eventsEnabled: true }) }));
    for (const e of Object.values(EVENTS)) expect(ui).toContain(`${e.name}</b>`);
    expect(ui).toContain(eventsNote);
    expect(eventsNote).toBe(`from round 2 · ${EVENT_CHANCE.in} in ${EVENT_CHANCE.of}`);
  });

  it("reads every number from content and the game's overrides (4th bulb, Wanted 3, honesty ⅔, the pool)", () => {
    const rows = Object.fromEntries(numberRows(game()).map((r) => [r.label, r.value]));
    expect(rows).toEqual({
      Bank: `${4 * BANK_JOB.bank.coinsPerPlayer} coins (${BANK_JOB.bank.coinsPerPlayer} a player)`,
      Rounds: `up to ${BANK_JOB.roundCap}`,
      Bell: "4 bulbs; the 4th is a raid",
      Raid: `seized grab, closed ${BANK_JOB.alarm.tapedRounds} rounds, Wanted +1`,
      Wanted: "3 stars is a bust",
      "Honesty line": "⅔ of what's taken",
      Meetings: "each third of the bank, after every raid",
      Emergencies: `${EMERGENCY_POOL[4]} for the crew (3–6 players)`,
    });
    // A game with other numbers shows them: the tips and the rulebook never say "4th" or "3" by hand.
    const odd = numberRows(game({ contentOverrides: { alarm: { bulbs: 5 } } }));
    expect(odd.find((r) => r.label === "Bell")!.value).toBe("5 bulbs; the 5th is a raid");
    expect(odd.find((r) => r.label === "Wanted")!.value).toBe("3 stars is a bust");
  });

  it("lists only the rooms in play, with their §20.1 lines (design §15.6)", () => {
    const v = game();
    const ui = html(createElement(Rulebook, { view: v }));
    expect(v.rooms.length).toBeGreaterThan(0);
    for (const id of v.rooms) {
      expect(ui, id).toContain(`${BANK_JOB.rooms[id]!.name}</b>`);
      expect(ui, id).toContain(esc(ROOM_TEXT[id]!));
    }
    for (const [id, room] of Object.entries(BANK_JOB.rooms)) if (!v.rooms.includes(id)) expect(ui, id).not.toContain(`${room.name}</b>`);
  });

  it("has the Terms glossary", () => {
    const ui = html(createElement(Rulebook, { view: game() }));
    for (const t of Object.values(TERMS)) expect(ui).toContain(esc(t.text));
  });

  it("never shows 'More in This game' inside itself", () => {
    expect(html(createElement(Rulebook, { view: game() }))).not.toContain("More in This game");
  });
});

describe("no tells — design §11.1", () => {
  it("reads a blacked-out room's feed as cameras offline, with no source", () => {
    const ctx = { me: "p1", name: (p: string) => p };
    const feed = { type: "roomWatched", visibility: privateTo("p1"), player: "p1", round: 3, source: "security", room: "vault", seen: [], offline: true } as const;
    // A dark Security takes its own cameras offline too: never claim the watched room is dark (#173 review).
    expect(describeEvent(feed, ctx)).toBe("Round 3, on the cameras: cameras offline (Security or the Vault is dark), nobody seen.");
    expect(describeEvent({ ...feed, source: "lookout" }, ctx)).toBe("Round 3, on lookout: cameras offline (the Vault is dark), nobody seen.");
  });
});

describe("endings — design §8", () => {
  it("says how it ended and marks a failure with no qualified winner as a loss", () => {
    expect(endingText({ result: "success", winners: ["p1"] })).toEqual({ title: "Job done: honest enough, and no bust", badge: "Biggest stash", loss: false });
    expect(endingText({ result: "failed", reason: "bust", winners: [] })).toMatchObject({ badge: "Wins over the Rooftop", loss: true });
    expect(endingText({ result: "failed", reason: "theft", winners: [] })).toMatchObject({ badge: "Wins a heist sunk by theft", loss: true });
  });

  it("doesn't call a failure with a winner a loss", () => {
    expect(endingText({ result: "failed", reason: "bust", winners: ["p2"] })).toMatchObject({ title: "Busted. On a bust, only the Rooftop gets away", badge: "Wins over the Rooftop", loss: false });
    expect(endingText({ result: "failed", reason: "theft", winners: ["p3"] }).loss).toBe(false);
    const note = (winners: string[]) => renderToStaticMarkup(createElement(EndingNote, { outcome: { result: "failed", reason: "bust", winners }, name: (id: string) => (id === "p1" ? "You" : id === "p2" ? "Ben" : "Cy") }));
    expect(note(["p2"])).toContain("Ben wins over the Rooftop.");
    expect(note(["p2"])).not.toContain("loss");
    expect(note(["p1", "p3"])).toContain("You and Cy win over the Rooftop.");
    expect(note([])).toContain("The ranking is marked as a loss.");
  });
});

describe("opponents' explanations — design §15.6", () => {
  const view = (roleList: "exact" | "possible" | "hidden", seed = "rl") => viewFor(createGame(config({ roleList, seed })), "p1");

  it("names the role that could explain a tell, or says someone is lying", () => {
    const v = view("exact");
    const dealt = new Set(v.roleList!.roles);
    for (const id of Object.keys(ROLES)) {
      const text = explainSpot(v, id)!;
      expect(text.startsWith(ROLE_TEXT[id]!.spot.replace(/\.$/, ":")), id).toBe(true);
      if (dealt.has(id)) expect(text, id).toContain(`the ${ROLES[id]!.name}, or someone lying.`);
      else expect(text, id).toContain("nobody in this game has that power, so someone is lying.");
    }
  });

  it("says 'could be' when the role list is hidden, and knows no role it doesn't have", () => {
    expect(explainSpot(view("hidden"), "mole")).toBe("A bell rang more than the people in the room can explain: could be the Mole, or someone lying.");
    expect(explainSpot(view("exact"), "nobody")).toBeUndefined();
  });
});

describe("Use power from the card — design §11.1, §17.2", () => {
  const v = viewFor(createGame(config({ seed: "ability" })), "p1");

  it("the Detective's targets are the other players, never yourself (§11.1 Readings)", () => {
    const ids = abilityTargets(v, "detective").map((t) => t.id);
    expect(ids).toEqual(v.players.map((p) => p.id));
    expect(ids).not.toContain(v.me.id);
  });

  it("the Auditor's targets are the rooms in play", () => {
    expect(abilityTargets(v, "auditor").map((t) => t.id)).toEqual(v.rooms);
  });

  it("sends {detect, target} and {audit, room}", () => {
    expect(abilityFor("detective", "p2")).toEqual({ kind: "detect", target: "p2" });
    expect(abilityFor("auditor", "vault")).toEqual({ kind: "audit", room: "vault" });
  });
});
