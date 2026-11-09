// QA (PR #207, S4.5): the "This game" rulebook follows the game's content
// overrides (design §17.4, §20), Possible and Hidden role lists reveal nothing
// about who holds what (design §11.3, §18), the Bail chip's tip is a real
// focusable button (§15.6), and the §20.5 lines read their numbers from content.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BANK_JOB, PERKS, TERMS, TIPS, type RoleId } from "@skimjob/content";
import { replay, setupEvents, viewFor, type GameConfig, type PlayerView } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { RoleCard } from "../screens/Meetings";
import { RolesInPlay } from "./RoleCard";
import { Rulebook } from "./Rulebook";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const config = (extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "qa207",
  players: Array.from({ length: 5 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isBot: i > 0 })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  ...extra,
});
/** p1's view of a new game with these roles dealt in seat order. */
function view(cfg: GameConfig, roles?: readonly RoleId[]): PlayerView {
  let seat = 0;
  const log = setupEvents(cfg).map((e) => (e.type === "roleDealt" && roles ? { ...e, role: roles[seat++]! } : e));
  return viewFor(replay(cfg, log), "p1");
}
const text = (v: PlayerView) => html(createElement(Rulebook, { view: v })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("QA: the rulebook follows content overrides — design §17.4, §20", () => {
  it("shows overridden bank, rounds, bulbs, raid, Wanted and perk prices, not the defaults", () => {
    const shop = viewFor(replay(config(), setupEvents(config())), "p1").shop.map((s) => s.perk);
    const perks = Object.fromEntries(shop.map((p, i) => [p, { cost: 7 + i }]));
    const v = view(config({ contentOverrides: { bank: { coinsPerPlayer: 20 }, alarm: { bulbs: 5, tapedRounds: 3, bustStars: 4 }, roundCap: 9, perks } }));
    const t = text(v);
    expect(t).toContain("100 coins (20 a player)");
    expect(t).toContain("up to 9");
    expect(t).toContain("5 bulbs; the 5th is a raid");
    expect(t).toContain("closed 3 rounds");
    expect(t).toContain("4 stars is a bust");
    for (const [i, p] of shop.entries()) {
      expect(v.shop.find((s) => s.perk === p)!.cost).toBe(7 + i);
      expect(t).toContain(`${7 + i} coins`);
    }
    expect(t).not.toContain(`${BANK_JOB.alarm.bulbs} bulbs`);
    expect(t).not.toContain(`up to ${BANK_JOB.roundCap}`);
  });

  it("a 1-coin perk says coin, not coins, and the 1st/2nd/3rd/11th–13th ordinals read right", () => {
    const shop = viewFor(replay(config(), setupEvents(config())), "p1").shop.map((s) => s.perk);
    const t = text(view(config({ contentOverrides: { perks: { [shop[0]!]: { cost: 1 } } } })));
    expect(t).toMatch(/\b1 coin\b(?!s)/);
    for (const [bulbs, line] of [[1, "1st"], [2, "2nd"], [3, "3rd"], [11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [22, "22nd"]] as const)
      expect(text(view(config({ contentOverrides: { alarm: { bulbs } } })))).toContain(`${bulbs} bulbs; the ${line} is a raid`);
    // design §5: the shop's prices are the content prices without overrides.
    const plain = viewFor(replay(config(), setupEvents(config())), "p1");
    for (const s of plain.shop) expect(s.cost).toBe(PERKS[s.perk]!.cost);
  });
});

describe("QA: role lists reveal nothing about who holds what — design §11.3, §18", () => {
  const A: RoleId[] = ["lookout", "mole", "hacker", "detective", "priest"];
  const B: RoleId[] = ["lookout", "priest", "detective", "mole", "hacker"]; // the same roles, other seats
  const C: RoleId[] = ["lookout", "locksmith", "smoothTalker", "auditor", "fixer"]; // other roles altogether

  it("an exact list renders the same whoever holds which role", () => {
    const cfg = config({ roleList: "exact" });
    expect(html(createElement(RolesInPlay, { view: view(cfg, A) }))).toBe(html(createElement(RolesInPlay, { view: view(cfg, B) })));
    expect(html(createElement(Rulebook, { view: view(cfg, A) }))).toBe(html(createElement(Rulebook, { view: view(cfg, B) })));
  });

  for (const list of ["possible", "hidden"] as const)
    it(`a ${list} list renders the same whatever was dealt (DOM and ARIA)`, () => {
      const cfg = config({ roleList: list });
      for (const el of [RolesInPlay, Rulebook]) {
        const a = html(createElement(el, { view: view(cfg, A) }));
        expect(html(createElement(el, { view: view(cfg, B) }))).toBe(a);
        expect(html(createElement(el, { view: view(cfg, C) }))).toBe(a);
        // No counts and no seat names (P2…P5) anywhere in the markup.
        expect(a).not.toMatch(/×\d|P[2-5]\b|dealt/);
      }
      // The engine view itself carries no other seat's role.
      const v = view(cfg, A);
      expect(JSON.stringify(v)).not.toMatch(/"role":"(mole|hacker|detective|priest)"/);
    });

  it("a hidden list shows no role chips and says so", () => {
    const h = html(createElement(RolesInPlay, { view: view(config({ roleList: "hidden" }), A) }));
    expect(h).not.toContain("<button");
    expect(h).toContain("hidden in this game");
  });
});

describe("QA: the Bail chip's InfoTip — design §12, §15.6", () => {
  it("is a native button with an accessible name, reachable by Tab (no tabindex=-1)", () => {
    const v = view(config(), ["lookout", "mole", "hacker", "detective", "priest"]);
    const withBail = { ...v, me: { ...v.me, roleState: { ...v.me.roleState, bail: true } } } as PlayerView;
    const h = html(createElement(RoleCard, { view: withBail, send: async () => ({ ok: true }) as never, claim: false }));
    const perks = h.slice(h.indexOf('aria-label="Your perks"'));
    expect(perks).toMatch(/<button[^>]*aria-label="About Bail"/);
    expect(perks.match(/<button[^>]*aria-label="About Bail"[^>]*>/)![0]).not.toContain('tabindex="-1"');
  });
});

describe("QA: no plain-string numbers in the §20.5 lines — design §20.5", () => {
  const { bulbs, bustStars } = BANK_JOB.alarm;
  it("the bell, raid, Wanted, bust and honesty lines carry content's numbers", () => {
    expect(TIPS.bell.text).toContain(`the ${bulbs}th`);
    expect(TERMS.raid.text).toContain(`${bulbs}th bulb`);
    expect(TERMS.bust.text).toContain(`Wanted ${bustStars}`);
    expect(TERMS.honesty.text).toContain(BANK_JOB.honestyLine === 2 / 3 ? "⅔" : "%");
  });
  it("text.ts writes those numbers only through BANK_JOB, ordinal() and lineText()", () => {
    const src = readFileSync(new URL("../../../../packages/content/src/text.ts", import.meta.url), "utf8");
    const lines = src.split("\n").filter((l) => /(wanted|raid|bust|honesty|bell):\s*\{/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const l of lines) expect(l, l).not.toMatch(/\b\d+(st|nd|rd|th)\b|Wanted \d|\b(Three|Four)\b|⅔|2\/3/);
  });
});
