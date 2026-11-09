// Render checks for the M2-9 art: addressable rooms, accessible names, no
// raster images.
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BankCutaway, CORE_ROOMS, MIN_TAG_PX, roomButtonProps, tagFont } from "./BankCutaway";
import { BANK_ROOMS, roomSlots } from "./bankLayout";
import { CrookAvatar, CrookSvg, nameTagWidth } from "./Crook";
import { RoomIcon } from "./RoomIcon";
import { BustedSpot, EmptyFileSpot, JobDoneSpot, WaitingSpot } from "./Spots";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("M2-9 art", () => {
  it("draws each room as its own addressable, labelled group", () => {
    for (const layout of ["wide", "stacked"] as const) {
      const out = html(createElement(BankCutaway, { rooms: BANK_ROOMS, layout, selected: "vault", onRoomSelect: () => {} }));
      for (const id of BANK_ROOMS) expect(out).toContain(`data-room="${id}"`);
      expect(out.match(/role="button"/g)).toHaveLength(BANK_ROOMS.length);
      expect(out).toContain('aria-label="Vault, selected"');
      expect(out).toContain('aria-pressed="true"');
    }
  });

  it("names who stands in a room, marking claims and bots", () => {
    const out = html(
      createElement(BankCutaway, {
        layout: "wide",
        occupants: {
          lobby: [
            { id: "a", name: "Mara", look: 0 },
            { id: "b", name: "Dez", look: 1, ghost: true },
            { id: "c", name: "Bot", look: 2, bot: true },
          ],
        },
      }),
    );
    expect(out).toContain("Lobby, here: Mara, Bot, claimed: Dez");
    expect(out).toContain("<title>Dez (claimed)</title>");
    expect(out).toContain("<title>Bot (bot)</title>");
  });

  it("marks closed rooms (Lockdown)", () => {
    const out = html(createElement(BankCutaway, { layout: "wide", closed: ["office"] }));
    expect(out).toContain("Office, closed");
    expect(out).toContain("CLOSED");
  });

  it("a closed room (Lockdown) can't be picked: aria-disabled and no click or key handler", () => {
    const picked: string[] = [];
    const pick = (r: string) => void picked.push(r);
    const shut = roomButtonProps({ id: "office", label: "Office, closed", selected: false, closed: true, pick });
    expect(shut).toMatchObject({ role: "button", "aria-disabled": true });
    expect("onClick" in shut).toBe(false);
    expect("onKeyDown" in shut).toBe(false);
    const open = roomButtonProps({ id: "lobby", label: "Lobby", selected: false, closed: false, pick });
    expect("aria-disabled" in open).toBe(false);
    (open as { onClick: () => void }).onClick();
    expect(picked).toEqual(["lobby"]);

    const out = html(createElement(BankCutaway, { layout: "wide", closed: ["office"], onRoomSelect: pick }));
    expect(out).toMatch(/data-room="office"[^>]*aria-disabled="true"/);
    expect(out.match(/aria-disabled="true"/g)).toHaveLength(1);
  });

  it("gives every crook and alibi ghost a visible name tag, unique in the drawing", () => {
    const out = html(
      createElement(BankCutaway, {
        layout: "stacked",
        occupants: {
          vault: [
            { id: "a", name: "Mara", look: 0 },
            { id: "b", name: "Max", look: 1 },
          ],
          lobby: [{ id: "c", name: "Dez Ono", look: 2, ghost: true }, { id: "d", name: "Lou", look: 3, tag: "L!" }],
        },
      }),
    );
    for (const t of ["Ma", "Mx", "DO", "L!"]) expect(out).toContain(`>${t}</text>`);
    expect(out.match(/class="crook-tag"/g)).toHaveLength(4);
    expect(html(createElement(CrookAvatar, { name: "Mara Vox", look: 0 }))).toContain(">MV</text>");
    expect(html(createElement(CrookAvatar, { name: "Mara", look: 0, tag: "M2" }))).toContain(">M2</text>");
    expect(html(createElement(CrookSvg, { name: "Ines", look: 6, ghost: true, tag: "In" }))).toContain(">In</text>");
  });

  it("sizes tags to stay legible on a phone (12 in one room at 390 px)", () => {
    // Stacked vault ≈ 168 × 140 units; at 390 px the 400-unit drawing is ≈ 366 px wide.
    const pxPerUnit = 366 / 400;
    const slots = roomSlots(168, 140, 12);
    const tags = ["Ma", "De", "Lo", "Pr", "Ot", "Sa", "In", "Ko", "Wr", "Be", "Ju", "Ta"];
    const f = tagFont(slots, tags, pxPerUnit);
    expect(f * pxPerUnit).toBeGreaterThanOrEqual(MIN_TAG_PX);
    // …and neighbouring tags on a row don't overlap.
    for (const back of [true, false]) {
      const xs = slots.filter((s) => s.back === back).map((s) => s.x);
      for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(nameTagWidth("Wr", f));
    }
  });

  it("gives avatars, icons and spots accessible names", () => {
    expect(html(createElement(CrookAvatar, { name: "Lou", look: 2, expression: "nervous", bot: true }))).toContain('aria-label="Lou, looking nervous (bot)"');
    expect(html(createElement(RoomIcon, { room: "vault", title: "Vault" }))).toContain("<title>Vault</title>");
    expect(html(createElement(RoomIcon, { room: "vault" }))).toContain('aria-hidden="true"');
    for (const S of [WaitingSpot, EmptyFileSpot, JobDoneSpot, BustedSpot]) expect(html(createElement(S))).toMatch(/role="img" aria-label="[^"]+"/);
  });

  it("draws no raster images", () => {
    const dir = new URL(".", import.meta.url);
    for (const f of readdirSync(dir).filter((f) => /\.(tsx|css)$/.test(f))) {
      const src = readFileSync(new URL(f, dir), "utf8");
      expect(src, f).not.toMatch(/<image\b|data:image/);
    }
  });

  // design §5.1, §5.3, §6.1, §15.6: the board art for bells, tape, the bank pile and the motion notes.
  describe("S4.1 board art", () => {
    const wide = { rooms: BANK_ROOMS, layout: "wide" as const };

    it("puts a bell over each open room, with its bulbs, a preview and a hidden '?'", () => {
      const out = html(
        createElement(BankCutaway, {
          ...wide,
          bulbs: 4,
          bells: { vault: { lit: 3 }, office: { lit: 1, preview: 2 }, lobby: { lit: 0, hidden: true }, security: { lit: 0 } },
        }),
      );
      expect(out.match(/data-bell="/g)).toHaveLength(4);
      expect(out).toContain('aria-label="Bell: 3 of 4 lit"');
      expect(out).toContain("your grab adds 2");
      expect(out).toContain('aria-label="Bell: hidden"');
      expect(html(createElement(BankCutaway, wide))).not.toContain("data-bell");
    });

    it("tapes a raided room: CLOSED with its rounds, a siren, no bell, and it can't be picked", () => {
      const out = html(createElement(BankCutaway, { ...wide, bells: { depositBoxes: { lit: 0 }, vault: { lit: 1 } }, taped: { depositBoxes: 2 }, onRoomSelect: () => {} }));
      expect(out).toContain("CLOSED 2");
      expect(out).toContain('aria-label="Deposit boxes, closed 2"');
      expect(out).toContain('aria-disabled="true"');
      expect(out.match(/bank-beams/g)).toHaveLength(1);
      expect(out.match(/data-bell="/g)).toHaveLength(1);
      expect(out).toContain('data-bell="vault"');
    });

    it("a Lockdown room is closed but has no siren, and keeps its bell", () => {
      const out = html(createElement(BankCutaway, { ...wide, closed: ["office"], bells: { office: { lit: 0 } } }));
      expect(out).toContain(">CLOSED<");
      expect(out).not.toContain("bank-beams");
      expect(out).toContain('data-bell="office"');
    });

    it("shrinks the Vault's pile: more bars full than half, one left at the last coin, none empty", () => {
      const bars = (pile: number) => html(createElement(BankCutaway, { ...wide, pile })).match(/gold-bar/g)?.length ?? 0;
      const [full, half, last, empty] = [1, 0.5, 0.01, 0].map(bars);
      expect(full).toBeGreaterThan(half!);
      expect(half).toBeGreaterThan(last!);
      expect(last).toBe(1);
      expect(empty).toBe(0);
      // Narrow rooms (a phone) show the pile too.
      expect(html(createElement(BankCutaway, { rooms: CORE_ROOMS, layout: "stacked", pile: 1 })).match(/gold-bar/g)!.length).toBeGreaterThan(3);
    });

    it("draws the Vault door thick: a far face, an edge band and a near face with a wheel and bolts", () => {
      const out = html(createElement(BankCutaway, wide));
      for (const part of ["bank-vd__far", "bank-vd__band", "bank-vd__near"]) expect(out.match(new RegExp(part, "g"))).toHaveLength(1);
      expect(out.match(/vector-effect="non-scaling-stroke"/g)!.length).toBeGreaterThan(14);
    });

    it("has the Office screen and lamp and the Lobby camera", () => {
      const out = html(createElement(BankCutaway, wide));
      expect(out.match(/bank-scr/g)).toHaveLength(1);
      expect(out.match(/bank-lamp/g)).toHaveLength(1);
      expect(out.match(/bank-cam"/g)).toHaveLength(1);
    });

    it("stops all the board motion under reduced motion", () => {
      const css = readFileSync(new URL("./art.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const reduced = css.slice(css.lastIndexOf("prefers-reduced-motion"));
      for (const c of [".bank-beams", ".bank-vd", ".bank-scr > *", ".bank-lamp", ".bank-cam", ".bank-siren"]) expect(reduced, c).toContain(c);
      expect(reduced).toMatch(/animation: none/);
      // At rest the door is open.
      expect(css).toMatch(/\.bank-vd \{\s*--vd-a: 115deg;/);
    });
  });
});
