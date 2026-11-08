// QA (PR #52, R6b; S3a.6): adversarial checks of the role cards, the rulebook
// and the shop, on real engine games (no fabricated events where the engine can
// make them): the shop's edges and privacy (extension.md, until S3a.7), no tells
// for cameras offline, role facts vs design §11 and §20.2, and the end screen on
// a failed heist (§8).
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BANK_JOB, PERKS, ROLES, ROLE_TEXT, ROLE_WIN, SHOP_COLUMNS, type PerkId, type RoleId } from "@skimjob/content";
import {
  createGame,
  handleCommand,
  privateTo,
  replay,
  setupEvents,
  viewFor,
  type GameConfig,
  type GameEvent,
  type GameState,
  type PlayerView,
} from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { describeEvent } from "../game/describeEvent";
import { namesOf } from "../game/hud";
import { perkUses, roleInfo, roleListInfo, shopState } from "../game/extension";
import { RoleList, RulebookSheet, Tokens } from "./Extension";
import { GameOver } from "../screens/Game";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const noop = async () => ({ ok: true as const });

function config(n: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "ext-ui-qa",
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    // These scripts revisit one room; a quiet alarm keeps raids (design §5) out of the rules under test.
    contentOverrides: { alarm: { bulbs: 1000 } },
    ...extra,
  };
}

interface Setup {
  readonly roles?: readonly RoleId[];
  readonly shop?: readonly PerkId[];
  readonly tokens?: Readonly<Record<string, number>>;
}
/** A new game with its setup events rewritten (seat i gets roles[i], a Lookout if missing; every seat a Lookout without roles). */
function game(cfg: GameConfig, setup: Setup = {}): GameState {
  let seat = 0;
  const log = setupEvents(cfg).flatMap((e): GameEvent[] => {
    if (e.type === "roleDealt") {
      const role = setup.roles?.[seat] ?? "lookout";
      seat++;
      const earned: GameEvent[] = Array.from({ length: setup.tokens?.[e.player] ?? 0 }, () => ({ type: "tokenEarned", visibility: privateTo(e.player), player: e.player, trigger: "watchedShakenDirty" }));
      return [{ ...e, role }, ...earned];
    }
    if (e.type === "shopDealt" && setup.shop) return [{ ...e, perks: setup.shop }];
    return [e];
  });
  return replay(cfg, log);
}

type Cmd = object | ((s: GameState) => object);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const cmd = typeof c === "function" ? c(s) : c;
    const r = handleCommand(s, cmd);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(cmd)}: ${r.reason}`);
    return r.state;
  }, state);
}
const refused = (s: GameState, cmd: object) => !handleCommand(s, cmd).ok;
const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, duffel: Math.max(0, (BANK_JOB.rooms[room]?.coins ?? 0) - pocket), pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const ALIBIS = (s: GameState) => ({ type: "advance", deadline: { kind: "alibis", round: s.phase.kind === "alibis" ? s.phase.round : s.round } });
/** The result window closes with no emergency called (design §9.3). */
const RESULT = (s: GameState) => ({ type: "advance", deadline: { kind: "result", round: s.resolvedRound } });
const buy = (player: string, perk: string) => ({ type: "buyPerk", player, perk });
const use = (player: string, ability: object) => ({ type: "useAbility", player, ability });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

/** Plays the game to its end: everyone in `room`, meetings scheduled, opened and closed. */
function playOut(s: GameState, room: (s: GameState, p: string) => string, pocket = 0): GameState {
  for (let guard = 0; guard < 200 && s.phase.kind !== "ended"; guard++) {
    const p = s.phase;
    if (p.kind === "planning") s = run(s, ...s.playerOrder.map((id) => mv(id, room(s, id), pocket)), ROUND);
    else if (p.kind === "alibis") s = run(s, ALIBIS);
    else if (p.kind === "result") s = run(s, { type: "advance", deadline: { kind: "result", round: p.round } });
    else if (p.kind === "awaitingMeeting") s = run(s, { type: "scheduleMeeting", meetingId: p.meetingId, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: p.meetingId } });
    else if (p.kind === "meeting" || p.kind === "shakedownPending") s = run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
    else throw new Error(`stuck in ${p.kind}`);
  }
  return s;
}

// ---------------------------------------------------------------- shop

describe("the shop's edges (extension.md \"Tokens and the perk shop\")", () => {
  const SHOP: PerkId[] = ["peek", "alibi", "extraVote"];
  const base = (tokens: number) => game(config(5), { shop: SHOP, tokens: { p0: tokens } });

  it("one token short: Buy is disabled in the sheet's data and the engine refuses", () => {
    const s = base(PERKS.peek.cost - 1);
    const item = shopState(viewFor(s, "p0")).items.find((i) => i.perk === "peek")!;
    expect(item.affordable).toBe(false);
    expect(refused(s, buy("p0", "peek"))).toBe(true);
    // Exactly enough is affordable (boundary).
    expect(shopState(viewFor(base(PERKS.peek.cost), "p0")).items.find((i) => i.perk === "peek")!.affordable).toBe(true);
  });

  it("buying twice: the second buy needs the tokens again; the sheet counts both", () => {
    let s = base(PERKS.peek.cost * 2);
    s = run(s, buy("p0", "peek"));
    expect(shopState(viewFor(s, "p0")).tokens).toBe(PERKS.peek.cost);
    s = run(s, buy("p0", "peek"));
    const st = shopState(viewFor(s, "p0"));
    expect(st.tokens).toBe(0);
    expect(st.items.find((i) => i.perk === "peek")!.owned).toBe(2);
    expect(refused(s, buy("p0", "peek"))).toBe(true);
  });

  it("a perk from a column this game didn't deal can't be bought and isn't listed", () => {
    const s = base(5);
    const notDealt = Object.values(SHOP_COLUMNS).flat().filter((p) => !SHOP.includes(p));
    expect(notDealt.length).toBeGreaterThan(0);
    for (const perk of notDealt) expect(refused(s, buy("p0", perk)), perk).toBe(true);
    expect(shopState(viewFor(s, "p0")).items.map((i) => i.perk)).toEqual(SHOP);
    expect(shopState(viewFor(s, "p0")).items.map((i) => i.column)).toEqual(["learn", "protect", "sway"]);
  });

  it("buying is allowed after using a perk this round, but the new perk waits for the next round", () => {
    let s = base(PERKS.peek.cost + PERKS.alibi.cost);
    s = run(s, buy("p0", "peek"), use("p0", { kind: "peek", target: "p1" }), buy("p0", "alibi"));
    const v = viewFor(s, "p0");
    expect(shopState(v).usedThisRound).toBe(true);
    expect(perkUses(v)).toEqual([]);
  });

  it("you can't buy for someone else: a buy names its own seat and the other seat's tokens stay put", () => {
    const s = game(config(5), { shop: SHOP, tokens: { p0: 3, p1: 0 } });
    expect(refused(s, buy("p1", "peek"))).toBe(true);
    expect(shopState(viewFor(s, "p0")).tokens).toBe(3);
  });

  it("tokens and purchases never reach another player's view or rendered UI", () => {
    let s = base(PERKS.peek.cost + PERKS.alibi.cost + 1);
    s = run(s, buy("p0", "peek"), buy("p0", "alibi"));
    for (const other of ["p1", "p2", "p3", "p4"]) {
      const v = viewFor(s, other);
      const json = JSON.stringify(v);
      expect(json).not.toMatch(/"tokenEarned"|"perkBought"|"perkPurchased"/);
      expect(v.players.find((x) => x.id === "p0")).not.toHaveProperty("roleState");
      expect(shopState(v).tokens).toBe(0);
      expect(shopState(v).items.every((i) => i.owned === 0)).toBe(true);
      const ui = html(createElement(Tokens, { view: v, send: noop }));
      expect(ui).toContain(">0<");
      expect(ui).toContain("only you see this");
    }
    // My own view counts what I bought.
    expect(html(createElement(Tokens, { view: viewFor(s, "p0"), send: noop }))).toContain(">1<");
  });

  it("Peek never offers yourself as a target", () => {
    const s = run(base(PERKS.peek.cost), buy("p0", "peek"));
    const peek = perkUses(viewFor(s, "p0")).find((u) => u.kind === "peek");
    expect(peek).toBeDefined();
    expect(peek!.kind === "peek" && peek!.targets).not.toContain("p0");
  });
});

// ---------------------------------------------------------------- no tells

describe("no tells: cameras offline (design §11.1)", () => {
  /** The Electrician (p0) blacks out the Vault for round 2; p1 watches it from Security; p2 is in it. */
  function cameraWorld() {
    let s = game(config(5, { seed: "cam" }), { roles: ["electrician"] });
    const cut = { ability: { kind: "blackout", room: "vault" } };
    s = run(s, mv("p0", "office", 0, cut), ...ids(5).slice(1).map((p) => mv(p, "office")), ROUND, ALIBIS, RESULT);
    const moves = [mv("p0", "office"), mv("p1", "security", 0, { watch: "vault" }), mv("p2", "vault", 2), mv("p3", "office"), mv("p4", "office")];
    return run(s, ...moves, ROUND);
  }

  it("a blacked-out room reads as plain \"cameras offline\" on the watcher's feed, never naming the source", () => {
    const v = viewFor(cameraWorld(), "p1");
    const e = v.caseFile.map((x) => x.event).filter((x) => x.type === "roomWatched" && x.round === 2);
    expect(e).toHaveLength(1);
    const text = describeEvent(e[0]!, { me: "p1", name: namesOf(v) });
    expect(text).toMatch(/cameras offline in the Vault/);
    expect(text).not.toMatch(/electric|P0/i);
  });
});

/** One step of play (as in playOut). */
function playOut1(s: GameState): GameState {
  const p = s.phase;
  if (p.kind === "planning") return run(s, ...s.playerOrder.map((id) => mv(id, "office")), ROUND);
  if (p.kind === "alibis") return run(s, ALIBIS);
  if (p.kind === "result") return run(s, { type: "advance", deadline: { kind: "result", round: p.round } });
  if (p.kind === "awaitingMeeting") return run(s, { type: "scheduleMeeting", meetingId: p.meetingId, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: p.meetingId } });
  return run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
}

// ---------------------------------------------------------------- roles and rulebook vs the spec

describe("role cards and the rulebook match design §11.1 and §20.2", () => {
  const EYES = ["lookout", "detective", "auditor", "smoothTalker", "priest"];
  const SHADOWS = ["locksmith", "hacker", "electrician", "mole", "fixer"];
  const STARS = ["mole", "fixer"]; // design §8.4
  // Tokens go in S3a.7; until then only these four roles earn one.
  const TOKENS = ["lookout", "detective", "auditor", "smoothTalker"];

  it("every one of the 10 roles has its kind, ★, §20.2 power and win lines, and a token line where it earns one", () => {
    expect(Object.keys(ROLES).sort()).toEqual([...EYES, ...SHADOWS].sort());
    for (const id of Object.keys(ROLES) as RoleId[]) {
      const info = roleInfo(id);
      expect(info.kindLabel, id).toBe(EYES.includes(id) ? "Eyes" : "Shadows");
      expect(info.star, id).toBe(STARS.includes(id));
      if (TOKENS.includes(id)) expect(info.earns, `${id} earns a token`).toMatch(/^A token when: /);
      else expect(info.earns, id).toBeNull();
      expect(info.power, id).toBe(ROLE_TEXT[id]!.power);
      expect(info.howYouWin, id).toBe(STARS.includes(id) ? ROLE_WIN.sunk : ROLE_WIN.crew);
    }
  });

  it("powers follow the frequency rule (design §11.2)", () => {
    for (const r of ["auditor", "hacker", "electrician", "priest", "mole"] as const) expect(roleInfo(r).power, r).toMatch(/^Once between meetings/);
    for (const r of ["lookout", "detective"] as const) expect(roleInfo(r).power, r).toMatch(/^Each round/);
    expect(roleInfo("fixer").power).toMatch(/^Once a game/);
    expect(roleInfo("smoothTalker").power).toBe("Your vote counts twice.");
  });

  it("the rulebook lists all 10 roles, the endings with the Mole and Fixer, and marks the roles in this game", () => {
    const s = createGame(config(5, { seed: "rb" }));
    const ui = html(createElement(RulebookSheet, { open: true, onClose: () => {}, view: viewFor(s, "p0") }));
    for (const def of Object.values(ROLES)) expect(ui, def.name).toContain(def.name);
    expect(ui).toMatch(/Busted \(Wanted 3\)<\/td><td>Only the Rooftop gets away/);
    expect(ui).toMatch(/Sunk by theft<\/td><td>Nobody, unless [^<]*Mole[^<]*Fixer[^<]* has the biggest stash of all/);
    expect(ui).toContain("in this game");
    expect(ui).toContain("Eyes");
    expect(ui).toContain("Shadows");
    expect(ui).toContain("Unspent tokens are worth nothing at the end.");
    expect(ui).not.toMatch(/\bact\b|this act|per act|Team player|Wildcard|Lone wolf/i);
  });
});

// ---------------------------------------------------------------- role list

describe("role list views (design §11.3: exact, possible, nothing)", () => {
  it("Exact lists the dealt roles; Possible lists what could be in play; Hidden shows nothing", () => {
    const cfg = (roleList: "exact" | "possible" | "hidden") => config(5, { roleList, seed: "rl" });
    const exact = viewFor(createGame(cfg("exact")), "p0");
    const dealt = Object.values(createGame(cfg("exact")).players).map((p) => p.role).sort();
    expect([...roleListInfo(exact).roles].sort()).toEqual(dealt);
    expect(roleListInfo(exact).title).toBe("Roles in play");

    const possible = viewFor(createGame(cfg("possible")), "p0");
    expect(roleListInfo(possible).title).toBe("Roles that could be in play");
    expect(html(createElement(RoleList, { view: possible }))).toContain("Roles that could be in play");

    const hidden = viewFor(createGame(cfg("hidden")), "p0");
    const ui = html(createElement(RoleList, { view: hidden }));
    expect(ui).toContain("hidden");
    expect(ui).not.toContain("<li");
    for (const def of Object.values(ROLES)) expect(ui).not.toContain(def.name);
  });
});

// ---------------------------------------------------------------- end screen

describe("the end screen on a failed heist (design §8)", () => {
  it("a bust with nobody on the Rooftop shows the full ranking marked as a loss, with no Winner (design §5.5)", () => {
    let s = game(config(4, { seed: "raid", contentOverrides: null }));
    // Everyone in the richest open room, never the Rooftop: raids until Wanted hits 3.
    const loud = ["vault", "office", "depositBoxes", "serverRoom", "managersOffice", "lobby"];
    s = playOut(s, (st) => loud.find((r) => st.rooms.includes(r) && !Object.hasOwn(st.taped, r)) ?? "security", 1);
    expect(s.phase.kind === "ended" && s.phase.outcome.result === "failed" && s.phase.outcome.reason).toBe("bust");
    const out = s.phase.kind === "ended" ? s.phase.outcome : null;
    expect(out?.result).toBe("failed");
    const v = viewFor(s, "p0");
    const ui = html(createElement(GameOver, { view: v }));
    expect(ui).toContain("The heist failed");
    expect(ui).toContain("marked as a loss");
    expect(ui).toContain('aria-label="Final ranking, marked as a loss"');
    expect((ui.match(/<li/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(ui).not.toContain(">Winner<");
    expect((ui.match(/>Loss</g) ?? []).length).toBe(4);
    expect(ui).not.toMatch(/\bAct \d\b/);
  });

  it("a success names the winner and its reason, and never says Loss", () => {
    let s = game(config(4, { seed: "win", contentOverrides: null }));
    // The Vault until its first raid, then the silent Lobby: no bust.
    s = playOut(s, (st) => (st.wanted > 0 || Object.hasOwn(st.taped, "vault") ? "lobby" : "vault"), 0);
    expect(s.phase.kind === "ended" && s.phase.outcome.result).toBe("success");
    const ui = html(createElement(GameOver, { view: viewFor(s, "p0") }));
    expect(ui).toContain(">Winner<");
    expect(ui).toContain("Biggest stash");
    expect(ui).not.toContain(">Loss<");
  });
});
