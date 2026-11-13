// Render checks for the alibi pop-up, the snapshot card, its key and the trust-mark pop-over. design §10
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SeatLook } from "../game/board";
import type { Snapshot } from "../game/snapshot";
import { AlibiPopup } from "./AlibiPopup";
import { CardKey, MarkPopover, SnapshotCard } from "./SnapshotCard";

const rooms = [
  { id: "vault", name: "Vault" },
  { id: "lobby", name: "Lobby" },
];
const popup = (round: number | null) => renderToStaticMarkup(createElement(AlibiPopup, { round, rooms, left: { text: "0:14", share: 0.5 }, onPost: async () => {} }));

describe("the alibi pop-up (design §10)", () => {
  it("asks where you were, with the countdown and a tile per room, and waits for a pick", () => {
    const out = popup(3);
    expect(out).toContain("Psst. Where were you?");
    expect(out).toContain("Round 3 alibi");
    expect(out).toContain("closes in <b class=\"num\">0:14</b>");
    expect(out).toContain("--left:50%");
    expect(out.match(/class="alibi__tile"/g)).toHaveLength(2);
    expect(out).toContain("Up to 3 coins"); // the room's note, from content
    expect(out).toMatch(/disabled=""[^>]*>.*Pick a room/);
  });

  it("has no close button: its only buttons are the tiles, the post and the InfoTip's own", () => {
    const buttons = [...popup(3).matchAll(/<button[^>]*class="([^"]*)"/g)].map((m) => m[1]!.split(" ")[0]!);
    expect(buttons.filter((c) => !c.startsWith("infotip"))).toEqual(["alibi__tile", "alibi__tile", "btn"]);
  });

  it("shows nothing while no window is open", () => {
    expect(popup(null)).not.toContain("Where were you");
  });
});

const crew = new Map<string, SeatLook>(["Sam", "Ava", "Ben", "Cleo"].map((name, i) => [`p${i + 1}`, { look: i, name, bot: false, tag: name.slice(0, 2) }]));
const snap: Snapshot = {
  round: 2,
  floors: [
    [{ id: "lobby", name: "Lobby", bell: 1, raided: null, quiet: true, crooks: [] }],
    [
      { id: "vault", name: "Vault", bell: 5, raided: 4, quiet: false, crooks: [{ player: "p1", kind: "says" }, { player: "p2", kind: "says" }, { player: "p3", kind: "fact" }] },
      { id: "office", name: "Office", bell: "hidden", raided: null, quiet: false, crooks: [{ player: "p4", kind: "says" }] },
    ],
  ],
  card: "shiftChange",
  missing: 4,
};
const card = (marks = new Map<string, "trusted" | "liar">()) => renderToStaticMarkup(createElement(SnapshotCard, { snap, crew, me: "p1", marks, bulbs: 5, onMark: () => {} }));

describe("the snapshot card (design §10)", () => {
  it("puts one row per floor and each room's icon, name and bell", () => {
    const out = card();
    expect(out.match(/class="snap__floor"/g)).toHaveLength(2);
    expect(out).toContain("Bell: 5 of 5 lit");
    expect(out).toContain("Bell: hidden");
  });

  it("rings a said crook dashed and a no-alibi crook solid, and never offers a mark on you", () => {
    const out = card();
    expect(out).toContain('class="snap__crook snap__crook--says" aria-label="Ava says the Vault. Mark Ava"');
    expect(out).toContain('class="snap__crook snap__crook--fact" aria-label="Ben gave no alibi: in the Vault. Mark Ben"');
    expect(out).toMatch(/<span class="snap__crook snap__crook--says">/);
    expect(out).not.toContain("Mark Sam");
  });

  it("shows the raid, a quiet ring, the event and the missing coins", () => {
    const out = card();
    expect(out).toContain("raided −4");
    expect(out).toMatch(/class="snap__room is-raided"[^>]*data-room="vault"/);
    expect(out).toMatch(/class="snap__room is-quiet"[^>]*data-room="lobby"/);
    expect(out).toContain("Shift change");
    expect(out).toContain("<b class=\"num\">4</b> coins missing");
  });

  it("badges a crook you marked", () => {
    const out = card(new Map([["2/p2", "liar"], ["2/p4", "trusted"]]));
    expect(out).toContain("Ava says the Vault, marked Liar");
    expect(out).toContain("snap__badge--liar");
    expect(out).toContain("snap__badge--trusted");
  });
});

describe("the card's key (design §10)", () => {
  it("is closed by default, with its chevron button", () => {
    const out = renderToStaticMarkup(createElement(CardKey));
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain("How to read the card");
    expect(out).not.toContain("you trust them");
  });

  it("open: the two looks, the two marks and the tip, word for word", () => {
    const out = renderToStaticMarkup(createElement(CardKey, { defaultOpen: true }));
    expect(out).toContain('aria-expanded="true"');
    for (const t of ["says", "no alibi", "you trust them", "you think they lied"]) expect(out).toContain(t);
    expect(out).toContain("Tap a crook to mark them Trusted or Liar. Only you see your marks, and they go in your case board.");
  });
});

describe("the trust-mark pop-over (design §10)", () => {
  const pop = (mark: "trusted" | "liar" | null) => renderToStaticMarkup(createElement(MarkPopover, { name: "Ava", mark, anchor: null, onPick: () => {}, onClose: () => {} }));
  const labels = (out: string) => [...out.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);

  it("offers the two states it isn't in", () => {
    expect(labels(pop(null))).toEqual(["Mark Ava Trusted", "Mark Ava Liar"]);
    expect(labels(pop("trusted"))).toEqual(["Clear your mark on Ava", "Mark Ava Liar"]);
    expect(labels(pop("liar"))).toEqual(["Mark Ava Trusted", "Clear your mark on Ava"]);
  });

  it("names the crook in a tag, as a light-dismiss popover", () => {
    const out = pop(null);
    expect(out).toContain('popover="auto"');
    expect(out).toContain('<span class="markpop__name">Ava</span>');
  });
});

describe("alibi styles", () => {
  const code = readFileSync(new URL("./alibi.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("keep every crook, mark button, tile and the key's button a 44 px target", () => {
    for (const sel of ["snap__crook", "markpop__btn"]) expect(code, sel).toMatch(new RegExp(`\\.${sel}\\s*\\{[^}]*width: 44px;[^}]*height: 44px`));
    for (const sel of ["alibi__tile", "cardkey__btn"]) expect(code, sel).toMatch(new RegExp(`\\.${sel}\\s*\\{[^}]*min-height: 44px`));
  });

  it("draw the key in one size, with 16 px icons", () => {
    for (const sel of ["cardkey__chev", "cardkey__ring", "cardkey__mark"]) expect(code, sel).toMatch(new RegExp(`\\.${sel}\\s*\\{[^}]*width: 16px;[^}]*height: 16px`));
    expect(code).toMatch(/\.cardkey\s*\{[^}]*font-size: var\(--fs-key\)/);
  });
});
