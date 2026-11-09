// QA (PR #52, R6b; S3a.6): adversarial checks of the role cards, the rulebook
// and the black market, on real engine games (no fabricated events where the engine can
// make them): purchases' privacy (design §12), no tells
// for cameras offline, role facts vs design §11 and §20.2, and the end screen on
// a failed heist (§8).
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BANK_JOB, PERK_TEXT, ROLES, ROLE_TEXT, ROLE_WIN, type PerkId, type RoleId } from "@skimjob/content";
import {
  createGame,
  handleCommand,
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
import { roleInfo, roleListInfo } from "../game/roles";
import { RoleCardDialog, RolesInPlay } from "./RoleCard";
import { Rulebook } from "./Rulebook";
import { GameOver } from "../screens/Game";

const html = (el: ReactElement) => renderToStaticMarkup(el);

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
}
/** A new game with its setup events rewritten (seat i gets roles[i], a Lookout if missing; every seat a Lookout without roles). */
function game(cfg: GameConfig, setup: Setup = {}): GameState {
  let seat = 0;
  const log = setupEvents(cfg).flatMap((e): GameEvent[] => {
    if (e.type === "roleDealt") {
      const role = setup.roles?.[seat] ?? "lookout";
      seat++;
      return [{ ...e, role }];
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
/** The result window closes with no emergency called (design §9.3). */
const RESULT = (s: GameState) => ({ type: "advance", deadline: { kind: "result", round: s.resolvedRound } });
const buy = (player: string, perk: object) => ({ type: "buyPerk", player, perk });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

/** Plays the game to its end: everyone in `room`, meetings scheduled, opened and closed. */
function playOut(s: GameState, room: (s: GameState, p: string) => string, pocket = 0): GameState {
  for (let guard = 0; guard < 200 && s.phase.kind !== "ended"; guard++) {
    const p = s.phase;
    if (p.kind === "planning") s = run(s, ...s.playerOrder.map((id) => mv(id, room(s, id), pocket)), ROUND);
    else if (p.kind === "result") s = run(s, { type: "advance", deadline: { kind: "result", round: p.round } });
    else if (p.kind === "awaitingMeeting") s = run(s, { type: "scheduleMeeting", meetingId: p.meetingId, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: p.meetingId } });
    else if (p.kind === "meeting") s = run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
    else if (p.kind === "shakedownPending") s = run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: p.meetingId } });
    else throw new Error(`stuck in ${p.kind}`);
  }
  return s;
}

// ---------------------------------------------------------------- black market

describe("purchases stay private (design §12, §18)", () => {
  const SHOP: PerkId[] = ["tail", "softShoes", "bail"];
  const rich = () => {
    const s = game(config(5), { shop: SHOP });
    return { ...s, players: { ...s.players, p0: { ...s.players.p0!, stash: 9 } } };
  };

  it("others see only the nameless sale, once planning closes; nobody's view shows who bought it or that they hold a Bail", () => {
    const bought = run(rich(), buy("p0", { kind: "bail" }));
    for (const other of ["p1", "p2", "p3", "p4"]) expect(viewFor(bought, other)).toEqual(viewFor(rich(), other));
    const s = run(bought, { type: "advance", deadline: { kind: "round", round: bought.round } });
    for (const other of ["p1", "p2", "p3", "p4"]) {
      const v = viewFor(s, other);
      const json = JSON.stringify(v);
      expect(json).not.toContain('"perkBought"');
      expect(v.ledger.find(({ event }) => event.type === "perkSold")?.event).toMatchObject({ type: "perkSold", perk: "bail", cost: 3 });
      expect(json).not.toMatch(/"player":"p0"[^}]*"perkSold"|"perkSold"[^}]*"player"/);
      expect(v.me.roleState.bail).toBe(false);
    }
    expect(viewFor(s, "p0").me.roleState.bail).toBe(true);
  });

  it("you can't buy what this game's black market doesn't sell, or for someone else", () => {
    const s = rich();
    expect(refused(s, buy("p0", { kind: "plantEvidence", target: "p1", room: "vault" }))).toBe(true);
    expect(refused(s, buy("p1", { kind: "bail" }))).toBe(true); // p1's stash is empty
    expect(refused(s, { type: "buyPerk", player: "p0", perk: "bail" })).toBe(true);
  });
});

// ---------------------------------------------------------------- no tells

describe("no tells: cameras offline (design §11.1)", () => {
  /** The Electrician (p0) blacks out the Vault for round 2; p1 watches it from Security; p2 is in it. */
  function cameraWorld() {
    let s = game(config(5, { seed: "cam" }), { roles: ["electrician"] });
    const cut = { ability: { kind: "blackout", room: "vault" } };
    s = run(s, mv("p0", "office", 0, cut), ...ids(5).slice(1).map((p) => mv(p, "office")), ROUND, RESULT);
    const moves = [mv("p0", "office"), mv("p1", "security", 0, { watch: "vault" }), mv("p2", "vault", 2), mv("p3", "office"), mv("p4", "office")];
    return run(s, ...moves, ROUND);
  }

  it("a blacked-out room reads as plain \"cameras offline\" on the watcher's feed, never naming the source", () => {
    const v = viewFor(cameraWorld(), "p1");
    const e = v.caseFile.map((x) => x.event).filter((x) => x.type === "roomWatched" && x.round === 2);
    expect(e).toHaveLength(1);
    const text = describeEvent(e[0]!, { me: "p1", name: namesOf(v) });
    expect(text).toMatch(/cameras offline \(Security or the Vault is dark\), nobody seen/);
    expect(text).not.toMatch(/electric|P0/i);
  });
});

/** One step of play (as in playOut). */
function playOut1(s: GameState): GameState {
  const p = s.phase;
  if (p.kind === "planning") return run(s, ...s.playerOrder.map((id) => mv(id, "office")), ROUND);
  if (p.kind === "result") return run(s, { type: "advance", deadline: { kind: "result", round: p.round } });
  if (p.kind === "awaitingMeeting") return run(s, { type: "scheduleMeeting", meetingId: p.meetingId, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: p.meetingId } });
  return run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
}

// ---------------------------------------------------------------- roles and rulebook vs the spec

describe("role cards and the rulebook match design §11.1 and §20.2", () => {
  const EYES = ["lookout", "detective", "auditor", "smoothTalker", "priest"];
  const SHADOWS = ["locksmith", "hacker", "electrician", "mole", "fixer"];
  it("every one of the 10 roles has its kind, §20.2 power, win and spot lines", () => {
    expect(Object.keys(ROLES).sort()).toEqual([...EYES, ...SHADOWS].sort());
    for (const id of Object.keys(ROLES) as RoleId[]) {
      const info = roleInfo(id)!;
      expect(info.kindLabel, id).toBe(EYES.includes(id) ? "Eyes" : "Shadows");
      expect(info.power, id).toBe(ROLE_TEXT[id]!.power);
      expect(info.howYouWin, id).toBe(id === "mole" || id === "fixer" ? ROLE_WIN.sunk : ROLE_WIN.crew); // design §8.4
      expect(info.spot, id).toBe(ROLE_TEXT[id]!.spot);
    }
  });

  it("powers follow the frequency rule (design §11.2)", () => {
    for (const r of ["auditor", "hacker", "electrician", "priest", "mole"] as const) expect(roleInfo(r)!.power, r).toMatch(/^Once between meetings/);
    for (const r of ["lookout", "detective"] as const) expect(roleInfo(r)!.power, r).toMatch(/^Each round/);
    expect(roleInfo("fixer")!.power).toMatch(/^Once a game/);
    expect(roleInfo("smoothTalker")!.power).toBe("Your vote counts twice.");
  });

  it("the rulebook lists this game's roles and its three perks, and no tokens or 'act' wording", () => {
    const s = createGame(config(5, { seed: "rb" }));
    const v = viewFor(s, "p0");
    const ui = html(createElement(Rulebook, { view: v }));
    for (const id of v.roleList!.roles) expect(ui, id).toContain(`${ROLES[id]!.name}</b>`);
    expect(ui).toContain("Eyes");
    // design §12, §20.3: this game's three perks on the black market, and no tokens.
    expect(v.shop).toHaveLength(3);
    for (const p of v.shop) expect(ui).toContain(`${PERK_TEXT[p.perk]!.name}</b>`);
    expect(ui).not.toMatch(/token/i);
    expect(ui).not.toMatch(/\bact\b|this act|per act|Team player|Wildcard|Lone wolf/i);
  });
});

// ---------------------------------------------------------------- use power

describe("the role card's Use power button — design §11.1, §17.2", () => {
  const card = (role: RoleId) => html(createElement(RoleCardDialog, { view: viewFor(game(config(4), { roles: [role] }), "p0"), open: true, onClose: () => {}, send: async () => ({ ok: true as const }), claim: null }));

  it("move powers and Detective/Auditor have it; passive powers (Locksmith, Smooth Talker) have none", () => {
    for (const r of ["lookout", "hacker", "electrician", "priest", "mole", "fixer", "detective", "auditor"]) expect(card(r), r).toContain("Use power");
    for (const r of ["locksmith", "smoothTalker"]) expect(card(r), r).not.toContain("Use power");
  });

  it("shows your own card with no opponent explanation, and the role list chips beneath elsewhere", () => {
    expect(card("mole")).toContain("Your role · secret");
    expect(card("mole")).not.toContain("someone lying");
  });
});

// ---------------------------------------------------------------- role list

describe("role list views (design §11.3: exact, possible, nothing)", () => {
  it("Exact lists the dealt roles; Possible lists what could be in play; Hidden shows nothing", () => {
    const cfg = (roleList: "exact" | "possible" | "hidden") => config(5, { roleList, seed: "rl" });
    const exact = viewFor(createGame(cfg("exact")), "p0");
    const dealt = Object.values(createGame(cfg("exact")).players).map((p) => p.role).sort();
    expect(roleListInfo(exact).roles.map((r) => r.id).sort()).toEqual([...new Set(dealt)].sort());
    expect(roleListInfo(exact).title).toBe("Roles in play");

    const possible = viewFor(createGame(cfg("possible")), "p0");
    expect(roleListInfo(possible).title).toBe("Roles that could be in play");
    expect(html(createElement(RolesInPlay, { view: possible }))).toContain("Roles that could be in play");

    const hidden = viewFor(createGame(cfg("hidden")), "p0");
    const ui = html(createElement(RolesInPlay, { view: hidden }));
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
