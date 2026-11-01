// Render checks for the M2-9 art: addressable rooms, accessible names, no raw
// colours (UI rules: colours only from theme.css tokens).
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BankCutaway } from "./BankCutaway";
import { BANK_ROOMS } from "./bankLayout";
import { CrookAvatar } from "./Crook";
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
  });

  it("gives avatars, icons and spots accessible names", () => {
    expect(html(createElement(CrookAvatar, { name: "Lou", look: 2, expression: "nervous", bot: true }))).toContain('aria-label="Lou, looking nervous (bot)"');
    expect(html(createElement(RoomIcon, { room: "vault", title: "Vault" }))).toContain("<title>Vault</title>");
    expect(html(createElement(RoomIcon, { room: "vault" }))).toContain('aria-hidden="true"');
    for (const S of [WaitingSpot, EmptyFileSpot, JobDoneSpot, BustedSpot]) expect(html(createElement(S))).toMatch(/role="img" aria-label="[^"]+"/);
  });

  it("uses theme tokens only: no raw colours and no raster images in the art", () => {
    const dir = new URL(".", import.meta.url);
    for (const f of readdirSync(dir).filter((f) => /\.(tsx|css)$/.test(f))) {
      const src = readFileSync(new URL(f, dir), "utf8");
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, f).not.toMatch(/<image\b|data:image/);
    }
  });
});
