// The end-of-game reveal's lines and render (M2-11): every hidden cause told
// apart, who won and why, and nothing but theme tokens. design §13;
// extension.md "Winning and losing", "Police activity", "Situations"
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RevealEnding, RevealSummary } from "@skimjob/engine";
import { Reveal } from "../components/Reveal";
import { itemText, whyText, winsOnText } from "./reveal";

const NAMES: Record<string, string> = { p1: "Ana", p2: "Ben", p3: "Cy" };
const ctx = { me: "p1", name: (p: string) => NAMES[p] ?? p };

describe("reveal lines", () => {
  it("tell a patrol from a tip-off, and a Power cut from a Hacker loop", () => {
    expect(itemText({ kind: "police", heatAdded: 6, heat: 40, cause: "patrol", mole: null }, ctx)).toBe("Police activity (Heat +6) was a routine patrol.");
    expect(itemText({ kind: "police", heatAdded: 6, heat: 46, cause: "tipOff", mole: "p2" }, ctx)).toBe("Police activity (Heat +6) was Ben's tip-off.");
    expect(itemText({ kind: "cameraOffline", watcher: "p1", room: "vault", source: "security", cause: "hackerLoop", hackers: ["p3"] }, ctx)).toBe(
      "Your camera on the Vault went offline: Cy looped it.",
    );
    expect(itemText({ kind: "cameraOffline", watcher: "p2", room: "vault", source: "lookout", cause: "powerCut", hackers: [] }, ctx)).toBe(
      "Ben's lookout on the Vault went offline in the Power cut.",
    );
    expect(itemText({ kind: "voteStolen", blackmailer: "p3", victim: "p1", meetingId: "m1", decided: true }, ctx)).toBe("Cy stole your vote, and it decided the shakedown.");
    expect(itemText({ kind: "token", player: "p2", trigger: "tipOffLanded" }, ctx)).toBe("Ben earned a token for a tip-off landing.");
    expect(itemText({ kind: "claim", player: "p2", claimed: "lookout", real: "mole" }, ctx)).toBe("Ben claimed Lookout, but was really the Mole.");
  });

  it("say who won and why, and what a ★ role also wins on", () => {
    const base: RevealEnding = { result: "success", reason: null, topGroup: ["p1", "p2"], winners: ["p1", "p2"], why: "success" };
    expect(whyText(base, ctx)).toBe("Job done, so the top of the ranking wins: you and Ben.");
    expect(whyText({ ...base, result: "failed", reason: "heat", winners: ["p2"], why: "failedTopWins" }, ctx)).toContain("A ★ role wins this ending from the top of the ranking: Ben.");
    expect(whyText({ ...base, result: "failed", reason: "target", winners: [], why: "failedNobody" }, ctx)).toContain("nobody wins: the ranking is a loss");
    expect(winsOnText([])).toBe("");
    expect(winsOnText(["heat", "target"])).toBe("★ Also wins if the cops raid or the target is missed");
  });
});

describe("<Reveal>", () => {
  const seat = (player: string, role: string, place: number, winner: boolean) => ({
    player,
    place,
    dealtRole: role,
    role,
    winsOn: role === "mole" ? (["heat", "target"] as const) : [],
    score: 10 - place,
    stash: 10 - place,
    safe: 0,
    timesShakenDown: 0,
    totalHandedIn: 4,
    topGroup: place === 1,
    winner,
    tokens: role === "mole" ? (["tipOffLanded", "tipOffLanded"] as const) : [],
    perksBought: [],
    perksUsed: 0,
  });
  const summary: RevealSummary = {
    ending: { result: "failed", reason: "heat", topGroup: ["p2"], winners: ["p2"], why: "failedTopWins" },
    seats: [seat("p2", "mole", 1, true), seat("p1", "rookie", 2, false), seat("p3", "hacker", 3, false)],
    rounds: [
      {
        round: 1,
        card: null,
        moves: [{ player: "p2", room: "vault", loot: 6, toHaul: 2, toStash: 4, missed: false, alibi: "lobby" }],
        resolved: { haulDelta: 2, haul: 2, heatDelta: 20, heat: 40 },
        items: [{ kind: "police", heatAdded: 6, heat: 46, cause: "tipOff", mole: "p2" }],
        stashes: { p1: 0, p2: 4, p3: 0 },
      },
      { round: 2, card: { id: "powerCut", room: null }, moves: [], resolved: null, items: [], stashes: { p1: 0, p2: 9, p3: 0 } },
    ],
  };
  const html = renderToStaticMarkup(createElement(Reveal, { summary, ctx, looks: new Map() }));

  it("opens every role, marks the ★ winner and voids the rest on a failure", () => {
    for (const role of ["Mole", "Rookie", "Hacker"]) expect(html).toContain(role);
    expect(html).toContain("★ Also wins if the cops raid or the target is missed");
    expect(html).toContain("2 tokens");
    expect(html.match(/reveal__void/g)).toHaveLength(2);
    expect(html).toContain("stash over time: 4, 9");
  });

  it("shows the first round with the real room, the lie and the hidden cause", () => {
    expect(html).toContain('aria-label="Round 1"');
    expect(html).toContain("said Lobby: lie");
    expect(html).toContain("Police activity (Heat +6) was Ben&#x27;s tip-off.");
    expect(html).toContain("reveal__item is-hidden");
  });

  it("uses theme tokens only and never injects HTML (UI rules)", () => {
    for (const f of ["../components/Reveal.tsx", "../components/reveal.css", "./reveal.ts", "../screens/GalleryReveal.tsx"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
      expect(src.replace(/^\s*(\/\/|\/?\*).*$/gm, ""), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
    const css = readFileSync(new URL("../components/reveal.css", import.meta.url), "utf8");
    for (const m of css.matchAll(/(border-radius|box-shadow):\s*([^;]+);/g)) expect(m[2], m[0]).toMatch(/^(var\(--[\w-]+\)|0|none)$/);
  });
});
