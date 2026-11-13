// The move panel on real views. design §3.2, §11.1
import { type RoleId } from "@skimjob/content";
import { viewFor, type GameConfig, type PlayerView } from "@skimjob/engine";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/deal.testkit";
import { MovePanel } from "./MovePanel";

const config = (n = 5): GameConfig => ({
  seed: "move-panel",
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isBot: i > 0 })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
});
const viewAs = (role: RoleId): PlayerView => viewFor(createGame(config(), [role]), "p1");
const html = (view: PlayerView, room: string | null = null) =>
  renderToStaticMarkup(createElement(MovePanel, { view, round: 1, timers: [], offset: 0, send: async () => ({ ok: true as const }), pick: { room, setRoom: () => {} } }));

describe("the move panel", () => {
  it("offers the rooms to pick while none is picked, and no coins yet", () => {
    const out = html(viewAs("detective"));
    expect(out).toContain('aria-label="Rooms"');
    expect(out).not.toContain("data-pile");
    expect(out).toContain("Lock it in");
  });

  it("shows the picked room with the Change button, the bags and the previews (design §3.2, §5.2)", () => {
    const out = html(viewAs("detective"), "office");
    expect(out).toContain("Change");
    expect(out).toContain('data-pile="duffel"');
    // A fresh move holds nothing yet: the bags and the bell show with 0 coins grabbed.
    expect(out).toContain("Bell: 0 of 4 lit");
    expect(out).toContain("Nothing from you goes to the share.");
    expect(out).toContain('move__lock" disabled=""'); // design §3.2: Lock it in waits for 1 coin in a bag
  });

  it("has no coins to grab in Security or on the Rooftop (design §3.1)", () => {
    const out = html(viewAs("detective"), "rooftop");
    expect(out).toContain("No coins to grab here.");
    expect(out).not.toContain("data-pile");
  });

  it("warns that the bank may run short (design §3.2) only when it may", () => {
    const v = viewAs("detective");
    expect(html(v)).not.toContain("may run short");
    expect(html({ ...v, bank: 14 })).toContain("The bank may run short this round: grabs can be cut (14 coins left).");
  });

  it("shows the role's power with its targets, and none for a role without one (design §11.1)", () => {
    const hacker = html(viewAs("hacker"));
    expect(hacker).toContain("Your power · Hacker");
    expect(hacker).toContain('data-power-room="vault"');
    const priest = html(viewAs("priest"));
    expect(priest).toContain("Your power · Priest");
    expect(priest).toContain("P2");
    expect(html(viewAs("detective"))).not.toContain("Your power");
  });

  it("gives the Fixer nothing to pick until a room is taped off (design §5.3)", () => {
    expect(html(viewAs("fixer"))).toContain("No room to use it on right now.");
    expect(html({ ...viewAs("fixer"), taped: { vault: 3 } })).toContain('data-power-room="vault"');
  });

  it("says which rooms are closed and why (design §5.3)", () => {
    expect(html({ ...viewAs("detective"), taped: { vault: 3 } })).toContain("Vault: Taped off through round 3");
  });
});
