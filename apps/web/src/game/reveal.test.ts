// The end-of-game reveal's lines and render (M2-11): every hidden cause told
// apart, who won and why. design §8, §11.1, §15.5
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RevealEnding, RevealSummary } from "@skimjob/engine";
import type { Snapshot } from "./snapshot";
import { Reveal } from "../components/Reveal";
import { sampleEvents } from "../../../../packages/engine/src/types/samples";
import { itemText, lieText, roundLies, satOutText, starText, whyText } from "./reveal";

const NAMES: Record<string, string> = { p1: "Ana", p2: "Ben", p3: "Cy" };
const ctx = { me: "p1", name: (p: string) => NAMES[p] ?? p };
const RING = "Round 1: Ben tipped off the police: the Office's bell rang once more.";

describe("reveal lines", () => {
  // design §5.2, §11.1: the Mole's hidden ring, the Hacker's hidden bell and the Electrician's cut are told.
  it("tell the Mole's ring, the Hacker's hidden bell and the Electrician's power cut", () => {
    const ring = { ...sampleEvents.abilityResolved, player: "p2", ability: { kind: "ring", room: "office" } } as const;
    expect(itemText({ kind: "event", event: ring }, ctx)).toBe(RING);
    const hide = { ...sampleEvents.abilityResolved, player: "p3", ability: { kind: "hide", room: "vault", bulbs: 3 } } as const;
    expect(itemText({ kind: "event", event: hide }, ctx)).toBe("Round 1: Cy hid the Vault's bell; it really shows 3 lit.");
    const cut = { ...sampleEvents.abilityResolved, player: "p3", ability: { kind: "blackout", room: "vault" } } as const;
    expect(itemText({ kind: "event", event: cut }, ctx)).toBe("Round 1: Cy cut the power in the Vault for next round.");
    expect(itemText({ kind: "claim", player: "p2", claimed: "lookout", real: "mole" }, ctx)).toBe("Ben claimed Lookout, but was really the Mole.");
  });

  it("say who won and why, and that the Mole and the Fixer also win a heist sunk by theft (design §8.4)", () => {
    const base: RevealEnding = { result: "success", reason: null, topGroup: ["p1", "p2"], winners: ["p1", "p2"], why: "success" };
    expect(whyText(base, ctx)).toBe("Job done, so the top of the ranking wins: you and Ben.");
    expect(whyText({ ...base, result: "failed", reason: "theft", winners: ["p2"], why: "failedTopWins" }, ctx)).toContain("A Mole or Fixer with the biggest stash of all wins it: Ben.");
    // design §5.5: on a bust only the Rooftop gets away.
    expect(whyText({ ...base, result: "failed", reason: "bust", winners: ["p2"], why: "failedTopWins" }, ctx)).toContain("Busted. On a bust, only the Rooftop gets away. The biggest stash up there wins: Ben.");
    expect(whyText({ ...base, result: "failed", reason: "bust", winners: [], why: "failedNobody" }, ctx)).toContain("Nobody was on the Rooftop, so nobody wins");
    expect(whyText({ ...base, result: "failed", reason: "theft", winners: [], why: "failedNobody" }, ctx)).toContain("nobody wins: the ranking is a loss");
    expect(starText("lookout")).toBe("");
    expect(starText("mole")).toBe("★ Also wins if the heist is sunk by theft");
    expect(starText("fixer")).toBe("★ Also wins if the heist is sunk by theft");
  });
});

describe("each round's lies — design §15.5, §18 board 5", () => {
  const move = (player: string, room: string, alibi: string | null) => ({ player, room, duffel: 1, pocket: 0, missed: false, alibi });
  const round = (moves: ReturnType<typeof move>[]) => ({ round: 3, card: null, moves, satOut: [], resolved: null, split: null, items: [], stashes: {} });
  const r = round([move("p1", "vault", "vault"), move("p2", "office", "vault"), move("p3", "lobby", null)]);

  it("lists the round's lies with the viewer's own mark, if they made one (design §10)", () => {
    const lies = (marks: Map<string, "trusted" | "liar">) => roundLies(r, marks).map((l) => lieText(l, ctx));
    expect(lies(new Map())).toEqual(["Ben said the Vault; really the Office."]);
    expect(lies(new Map([["3/p2", "liar"]]))).toEqual(["Ben said the Vault; really the Office. You had marked Ben a liar."]);
    expect(lies(new Map([["3/p2", "trusted"]]))).toEqual(["Ben said the Vault; really the Office. You had trusted Ben."]);
    // A mark from another round, or on a true alibi, adds nothing.
    expect(lies(new Map([["2/p2", "liar"], ["3/p1", "liar"]]))).toEqual(["Ben said the Vault; really the Office."]);
    expect(lieText({ player: "p1", said: "security", real: "vault", mark: null }, ctx)).toBe("You said Security; really the Vault.");
    expect(roundLies(round([move("p2", "vault", "vault")]), new Map())).toEqual([]);
  });

  it("says a player sat the round out, you or another", () => {
    expect(satOutText("p1", ctx)).toBe("You sat the round out: the Lobby was taped off.");
    expect(satOutText("p3", ctx)).toBe("Cy sat the round out: the Lobby was taped off.");
  });
});

describe("<Reveal>", () => {
  const seat = (player: string, role: string, place: number, winner: boolean) => ({
    player,
    place,
    dealtRole: role,
    role,
    stash: 10 - place,
    safe: 0,
    topGroup: place === 1,
    winner,
    perksBought: role === "hacker" ? (["bail"] as const) : [],
  });
  const summary: RevealSummary = {
    ending: { result: "failed", reason: "theft", topGroup: ["p2"], winners: ["p2"], why: "failedTopWins" },
    seats: [seat("p2", "mole", 1, true), seat("p1", "locksmith", 2, false), seat("p3", "hacker", 3, false)],
    rounds: [
      {
        round: 1,
        card: null,
        moves: [{ player: "p2", room: "vault", duffel: 2, pocket: 4, missed: false, alibi: "lobby" }],
        satOut: ["p3"],
        resolved: { taken: 6, missing: 4 },
        split: { cut: 0, share: 0 },
        items: [{ kind: "event", event: { ...sampleEvents.abilityResolved, player: "p2", ability: { kind: "ring", room: "office" } } }],
        stashes: { p1: 0, p2: 4, p3: 0 },
      },
      { round: 2, card: { id: "audit", room: null }, moves: [], satOut: [], resolved: null, split: null, items: [], stashes: { p1: 0, p2: 9, p3: 0 } },
    ],
  };
    // Round 1's card: Ben says the Lobby (he was in the Vault). Round 2, the last, had no alibi window.
  const card1: Snapshot = {
    round: 1,
    floors: [[{ id: "lobby", name: "Lobby", bell: 0, raided: null, quiet: false, crooks: [{ player: "p2", kind: "says" }] }], [{ id: "vault", name: "Vault", bell: 3, raided: null, quiet: false, crooks: [] }]],
    card: null,
    missing: 4,
  };
  const html = renderToStaticMarkup(createElement(Reveal, { summary, ctx, looks: new Map(), marks: new Map([["1/p2", "liar" as const]]), cards: new Map([[1, card1]]), bulbs: 5 }));

  it("opens every role, marks the ★ winner and voids the rest on a failure", () => {
    for (const role of ["Mole", "Locksmith", "Hacker"]) expect(html).toContain(role);
    expect(html).toContain("★ Also wins if the heist is sunk by theft");
    expect(html).toContain("Bought:"); // design §12, §15.5: who bought what opens at the reveal
    expect(html.match(/reveal__void/g)).toHaveLength(2);
    expect(html).toContain("stash over time: 4, 9");
  });

  it("shows the first round with the real room, the lie and the hidden cause", () => {
    expect(html).toContain('aria-label="Round 1"');
    expect(html).toContain("Lies in round 1");
    expect(html).toContain("Ben said the Lobby; really the Vault. You had marked Ben a liar.");
    expect(html).toContain(RING.replace(/'/g, "&#x27;"));
    expect(html).toContain("reveal__item is-hidden");
  });

  // design §15.5, §18 board 5: the round's snapshot card told true replaces the plan replay; who sat the round out (§3.3).
  it("draws the round's card told true: the alibi stamped LIE, the liar ringed under \"really:\"; and says who sat the round out", () => {
    expect(html).toContain("Round 1, the truth");
    expect(html).toMatch(/class="snap__stamp snap__stamp--lie">LIE</);
    expect(html).toMatch(/data-room="vault".*?really:<\/span><span class="snap__liar">/);
    expect(html).toContain("Went: Vault");
    expect(html).toContain("Cy sat the round out: the Lobby was taped off.");
  });

  it("says the last round had no alibi window (design §10.1)", () => {
    const last = renderToStaticMarkup(createElement(Reveal, { summary: { ...summary, rounds: summary.rounds.slice(1) }, ctx, looks: new Map(), marks: new Map(), cards: new Map(), bulbs: 5 }));
    expect(last).toContain("No alibi window: the game ended.");
    expect(html).not.toContain("No alibi window");
  });

  it("never injects HTML (UI rules)", () => {
    for (const f of ["../components/Reveal.tsx", "../components/reveal.css", "./reveal.ts", "../screens/GalleryReveal.tsx"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    }
  });
});
