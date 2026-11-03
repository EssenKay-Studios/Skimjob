// QA (PR #52, R6b): adversarial checks of the Extension UI against docs/extension.md,
// on real engine games (no fabricated events where the engine can make them):
// the shop's edges and privacy, no tells for police activity / camera offline,
// the Heat breakdown against the real Heat change, the gap box and target bar,
// "between meetings" wording, lobby deck settings, role facts vs the spec tables,
// and the end screen on a failed heist.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BANK_JOB, DECKS, PERKS, POLICE_ACTIVITY, ROLES, SHOP_COLUMNS, type PerkId, type RoleId } from "@skimjob/content";
import {
  checkpointTarget,
  createGame,
  roundHeatDelta,
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
import { gapInfo, heatRound, perkUses, roleInfo, roleListInfo, shopState, targetBar } from "../game/extension";
import { GapBox, HeatBreakdown, RoleList, RulebookSheet, TargetBar, Tokens } from "./Extension";
import { DeckSettings, deckPatch, deckRoles, effectiveDeck, rolePatch } from "./DeckSettings";
import { GameOver } from "../screens/Game";
import type { LobbySettings } from "../api";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const noop = async () => ({ ok: true as const });

function config(n: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "ext-ui-qa",
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
    job: "bank",
    rolePool: [],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    ...extra,
  };
}

interface Setup {
  readonly roles?: readonly RoleId[];
  readonly shop?: readonly PerkId[];
  readonly tokens?: Readonly<Record<string, number>>;
  readonly patrol?: boolean;
}
/** A new game with its setup events rewritten (seat i gets roles[i], Rookie if missing). */
function game(cfg: GameConfig, setup: Setup = {}): GameState {
  let seat = 0;
  const log = setupEvents(cfg).flatMap((e): GameEvent[] => {
    if (e.type === "roleDealt") {
      const role = setup.roles ? (setup.roles[seat] ?? "rookie") : e.role;
      seat++;
      const earned: GameEvent[] = Array.from({ length: setup.tokens?.[e.player] ?? 0 }, () => ({ type: "tokenEarned", visibility: privateTo(e.player), player: e.player, trigger: "checkpointMade" }));
      return [{ ...e, role }, ...earned];
    }
    if (e.type === "snitchTargetAssigned" && setup.roles) return [];
    if (e.type === "shopDealt" && setup.shop) return [{ ...e, perks: setup.shop }];
    if (e.type === "policeScheduled" && setup.patrol !== undefined) return [{ ...e, patrol: setup.patrol }];
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
const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const ALIBIS = (s: GameState) => ({ type: "advance", deadline: { kind: "alibis", round: s.phase.kind === "alibis" ? s.phase.round : s.round } });
const MOMENT = (s: GameState) => ({ type: "advance", deadline: { kind: "policeMoment", moment: s.police?.moment } });
const buy = (player: string, perk: string) => ({ type: "buyPerk", player, perk });
const use = (player: string, ability: object) => ({ type: "useAbility", player, ability });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

/** Plays the game to its end: everyone in `room`, meetings scheduled, opened and closed. */
function playOut(s: GameState, room: (s: GameState, p: string) => string, pocket = 0): GameState {
  for (let guard = 0; guard < 200 && s.phase.kind !== "ended"; guard++) {
    const p = s.phase;
    if (p.kind === "planning") s = run(s, ...s.playerOrder.map((id) => mv(id, room(s, id), pocket)), ROUND);
    else if (p.kind === "alibis") s = run(s, ALIBIS);
    else if (p.kind === "awaitingMeeting") s = run(s, { type: "scheduleMeeting", player: "p0", act: p.act, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `act-${p.act}` } });
    else if (p.kind === "meeting" || p.kind === "shakedownPending") s = run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
    else throw new Error(`stuck in ${p.kind}`);
  }
  return s;
}

// ---------------------------------------------------------------- shop

describe("the shop's edges (extension.md \"Tokens and the perk shop\")", () => {
  const SHOP: PerkId[] = ["peek", "alibi", "extraVote"];
  const base = (tokens: number) => game(config(5, { rolePool: ["rookie"] }), { shop: SHOP, tokens: { p0: tokens } });

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
    const s = game(config(5, { rolePool: ["rookie"] }), { shop: SHOP, tokens: { p0: 3, p1: 0 } });
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

  it("Starter and Quick (starterMode) games show no tokens and no shop", () => {
    const v = viewFor(createGame(config(5, { starterMode: true, eventsEnabled: false })), "p0");
    expect(shopState(v).open).toBe(false);
    expect(html(createElement(Tokens, { view: v, send: noop }))).toBe("");
  });
});

// ---------------------------------------------------------------- no tells

describe("no tells: police activity and camera offline (extension.md \"Situations\", Build notes \"Police activity\")", () => {
  // 5 players, the Possible list names the Mole, so police moments run.
  const MOLE = config(5, { rolePool: ["rookie", "lookout", "mole"], roleList: "possible" });

  /** The world as p1 (not the Mole) sees it after one round and a police moment. */
  function policeWorld(tipOff: boolean) {
    let s = game(MOLE, { roles: ["mole"], patrol: !tipOff });
    expect(s.police).not.toBeNull();
    if (tipOff) s = run(s, use("p0", { kind: "tipOff" }));
    s = run(s, ...ids(5).map((p) => mv(p, "office")), ROUND, ALIBIS, MOMENT);
    expect(s.log.filter((e) => e.type === "policeActivity")).toHaveLength(1);
    return s;
  }

  it("a background patrol and a Mole's tip-off give every other player the same view, text and Heat lines", () => {
    const patrol = policeWorld(false);
    const tip = policeWorld(true);
    for (const p of ["p1", "p2", "p3", "p4"]) {
      const a = viewFor(patrol, p);
      const b = viewFor(tip, p);
      expect(JSON.stringify(b), p).toBe(JSON.stringify(a));
      expect(html(createElement(HeatBreakdown, { view: b }))).toBe(html(createElement(HeatBreakdown, { view: a })));
      const say = (v: PlayerView) => v.ledger.map((x) => describeEvent(x.event, { me: p, name: namesOf(v) }));
      expect(say(b)).toEqual(say(a));
    }
    const landed = tip.log.find((e) => e.type === "policeActivity") as Extract<GameEvent, { type: "policeActivity" }>;
    const police = heatRound(viewFor(tip, "p1"), landed.round)!.lines.filter((l) => l.kind === "police");
    expect(police).toEqual([{ label: "police activity", value: POLICE_ACTIVITY.heat, kind: "police" }]);
    // Only the Mole learns it was its own.
    expect(JSON.stringify(viewFor(tip, "p0"))).toContain("tipOffLanded");
    expect(JSON.stringify(viewFor(patrol, "p0"))).not.toContain("tipOffLanded");
  });

  it("no view carries a police moment, schedule or deadline (no client-visible timer)", () => {
    const s = game(MOLE, { roles: ["mole"], patrol: true });
    for (const p of ids(5)) {
      const json = JSON.stringify(viewFor(s, p));
      expect(json).not.toMatch(/policeScheduled|policeMoment|gapPermille|"police"\s*:/);
    }
  });

  /** p1 watches the Vault from Security; p2 is in the Vault; either a Hacker loop or a Power cut. */
  function cameraWorld(cause: "loop" | "powerCut") {
    const cfg = config(5, { rolePool: ["rookie", "hacker"], eventsEnabled: cause === "powerCut", seed: "cam" });
    let s = game(cfg, { roles: ["hacker"] });
    // Round 1 plain, so round 2 has a card; force it to Power cut (or anything harmless for the loop).
    s = run(s, ...ids(5).map((p) => mv(p, "office")), ROUND, ALIBIS);
    if (cause === "powerCut") {
      s = replay(s.config, s.log.map((e) => (e.type === "eventFlipped" && e.round === 2 ? { ...e, card: "powerCut", room: null } : e)));
      expect(s.log.some((e) => e.type === "eventFlipped" && e.round === 2 && e.card === "powerCut")).toBe(true);
    }
    const hacker = cause === "loop" ? { ability: { kind: "loopCameras", room: "vault" } } : {};
    const moves = [mv("p0", "office", 0, hacker), mv("p1", "security", 0, { watch: "vault" }), mv("p2", "vault", 2), mv("p3", "office"), mv("p4", "office")];
    s = run(s, ...moves, ROUND);
    return s;
  }

  it("a Hacker's loop and a Power cut read the same on the watcher's feed (text, case file markup)", () => {
    const loop = cameraWorld("loop");
    const cut = cameraWorld("powerCut");
    const feed = (s: GameState) => {
      const v = viewFor(s, "p1");
      const e = v.caseFile.map((x) => x.event).filter((x) => x.type === "roomWatched" && x.round === 2);
      expect(e).toHaveLength(1);
      return { event: { ...e[0]!, visibility: undefined }, text: describeEvent(e[0]!, { me: "p1", name: namesOf(v) }) };
    };
    const a = feed(loop);
    const b = feed(cut);
    expect(a.event).toEqual(b.event);
    expect(a.text).toBe(b.text);
    expect(a.text).toMatch(/camera offline in the Vault/);
    expect(a.text).not.toMatch(/hack|loop|power cut/i);
  });
});

// ---------------------------------------------------------------- Heat breakdown, gap box, target bar

describe("the Heat breakdown adds up to the real Heat change (extension.md \"What the app works out for you\")", () => {
  /** Heat before and after `round`, from the public ledger (round summary + police + a missed target). */
  function heatChange(v: PlayerView, round: number): number {
    const log = v.ledger.map((x) => x.event);
    let before = 0;
    let after = 0;
    let seen = false;
    for (const e of log) {
      const heat = "heat" in e && typeof e.heat === "number" ? e.heat : null;
      const inRound =
        (e.type === "roundResolved" && e.round === round) ||
        (e.type === "policeActivity" && e.round === round) ||
        (e.type === "checkpointChecked" && e.act * 3 === round);
      if (inRound && heat !== null) {
        if (!seen) before = e.type === "roundResolved" ? e.heat - e.heatDelta : before;
        seen = true;
        after = heat;
      } else if (!seen && heat !== null) before = heat;
    }
    if (!seen) return 0;
    return after - before;
  }

  it("on ordinary rounds with mixed rooms, every line sums to the round's Heat change", () => {
    let s = createGame(config(6, { rolePool: ["rookie"], seed: "heat-sum" }));
    const rooms = ["vault", "office", "rooftop", "lobby", "vault", "office"];
    for (let r = 1; r <= 3; r++) {
      s = run(s, ...ids(6).map((p, i) => mv(p, rooms[(i + r) % rooms.length]!)), ROUND, ALIBIS);
      const v = viewFor(s, "p0");
      const h = heatRound(v, r)!;
      expect(h.lines.reduce((a, l) => a + l.value, 0)).toBe(h.total);
      expect(h.total, `round ${r}: ${h.text}`).toBe(heatChange(v, r));
    }
  });

  it("the missed-target +Heat sits in the breakdown of the meeting's round", () => {
    let s = createGame(config(4, { rolePool: ["rookie"], seed: "miss" }));
    s = playOut(s, () => "rooftop", 0);
    const v = viewFor(s, "p0");
    const r3 = heatRound(v, 3)!;
    const missed = v.ledger.map((x) => x.event).find((e) => e.type === "checkpointChecked" && e.act === 1);
    expect(missed?.type === "checkpointChecked" && !missed.met).toBe(true);
    expect(r3.lines.find((l) => l.kind === "missed")?.value).toBe(BANK_JOB.heat.missedCheckpoint);
  });

  it("the gap box matches the view's arithmetic, Payday's double Lobby included", () => {
    const cfg = config(5, { rolePool: ["rookie"], eventsEnabled: true, seed: "payday" });
    let s = run(createGame(cfg), ...ids(5).map((p) => mv(p, "office")), ROUND, ALIBIS);
    s = replay(s.config, s.log.map((e) => (e.type === "eventFlipped" && e.round === 2 ? { ...e, card: "payday", room: null } : e)));
    // Everyone honest in the Lobby, everyone posts the truth: the gap must add up.
    s = run(s, ...ids(5).map((p) => mv(p, "lobby")), ROUND, ...ids(5).map((p) => ({ type: "postAlibi", player: p, room: "lobby" })));
    const v = viewFor(s, "p0");
    const g = gapInfo(v)!;
    expect(g.round).toBe(2);
    expect(g.posted).toBe(5);
    expect(v.gap!.haulGrowth).toBe(v.gap!.alibis);
    expect(g.text).toMatch(/it adds up\.$/);
    expect(html(createElement(GapBox, { view: v }))).toContain("5 of 5 alibis in");
    // A pocketer lying about it shows as unaccounted.
    let t = run(createGame(cfg), mv("p0", "office", 2), ...ids(5).slice(1).map((p) => mv(p, "office")), ROUND, ...ids(5).map((p) => ({ type: "postAlibi", player: p, room: "office" })));
    const g2 = gapInfo(viewFor(t, "p1"))!;
    expect(g2.unaccounted).toBe(2);
    expect(g2.text).toBe(`Alibis say +${viewFor(t, "p1").gap!.alibis}, the Haul grew ${viewFor(t, "p1").gap!.haulGrowth}: 2 unaccounted for.`);
  });

  it("the target bar tracks each meeting's cumulative target and says what missing it costs", () => {
    let s = createGame(config(4, { rolePool: ["rookie"], seed: "target" }));
    const at = (st: GameState) => targetBar(viewFor(st, "p0"));
    expect(at(s)).toMatchObject({ target: checkpointTarget(BANK_JOB, 1, 4), final: false, ifMissed: `+${BANK_JOB.heat.missedCheckpoint} Heat if missed` });
    expect(at(s).target).toBe(BANK_JOB.checkpoints.perPlayer[0]! * 4);
    // Through meeting 1: the bar moves on to meeting 2's target, then the final.
    for (let guard = 0; guard < 60 && viewFor(s, "p0").act < 3; guard++) s = playOut1(s);
    expect(viewFor(s, "p0").act).toBe(3);
    expect(at(s)).toMatchObject({ target: checkpointTarget(BANK_JOB, 3, 4), final: true, ifMissed: "the heist fails if missed" });
    const ui = html(createElement(TargetBar, { view: viewFor(s, "p0") }));
    expect(ui).toContain("needed by the final meeting");
    expect(ui).toContain(`${s.haul} / ${checkpointTarget(BANK_JOB, 3, 4)}`);
  });
});

/** One step of play (as in playOut). */
function playOut1(s: GameState): GameState {
  const p = s.phase;
  if (p.kind === "planning") return run(s, ...s.playerOrder.map((id) => mv(id, "office")), ROUND);
  if (p.kind === "alibis") return run(s, ALIBIS);
  if (p.kind === "awaitingMeeting") return run(s, { type: "scheduleMeeting", player: "p0", act: p.act, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `act-${p.act}` } });
  return run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
}

// ---------------------------------------------------------------- roles and rulebook vs the spec

describe("role cards and the rulebook match extension.md \"Roles\"", () => {
  const TEAM = ["rookie", "insideMan", "lookout", "auditor", "detective", "snitch", "smoothTalker", "muscle", "priest", "bagman", "cleaner", "fixer", "mastermind"];
  const WILD = ["getawayDriver", "fence", "hacker", "blackmailer", "forger"];
  const LONE = ["mole", "embezzler"];
  const STARS = ["getawayDriver", "fence", "mole", "embezzler"];
  const MIN: Record<string, number> = { snitch: 4, detective: 4, insideMan: 5, smoothTalker: 5, muscle: 5, priest: 5, blackmailer: 7, forger: 7 };

  it("every one of the 20 roles has the spec's tag, ★, minimum crew and a token line", () => {
    expect(Object.keys(ROLES).sort()).toEqual([...TEAM, ...WILD, ...LONE].sort());
    for (const id of Object.keys(ROLES) as RoleId[]) {
      const info = roleInfo(id);
      const tag = TEAM.includes(id) ? "Team player" : WILD.includes(id) ? "Wildcard" : "Lone wolf";
      expect(info.tagLabel, id).toBe(tag);
      expect(info.star, id).toBe(STARS.includes(id));
      expect(info.minPlayers ?? 0, id).toBe(MIN[id] ?? 0);
      expect(info.earns, `${id} earns a token`).toMatch(/^A token when: /);
      expect(info.power.length, id).toBeGreaterThan(0);
      expect(`${info.power} ${info.earns}`, id).not.toMatch(/\bact\b|per act/i);
      expect(info.howYouWin).toMatch(/^Have the biggest stash when the job succeeds/);
    }
  });

  it("★ win lines follow the endings table", () => {
    expect(roleInfo("getawayDriver").howYouWin).toMatch(/cops raid/);
    expect(roleInfo("getawayDriver").howYouWin).not.toMatch(/target/);
    expect(roleInfo("embezzler").howYouWin).toMatch(/final target is missed/);
    expect(roleInfo("embezzler").howYouWin).not.toMatch(/raid/);
    for (const r of ["mole", "fence"] as const) expect(roleInfo(r).howYouWin).toMatch(/fails either way/);
  });

  it("powers say \"between meetings\" where the spec does, and spec numbers", () => {
    for (const r of ["auditor", "detective", "priest", "hacker", "blackmailer", "forger", "mole", "embezzler"] as const) {
      expect(roleInfo(r).power, r).toMatch(/^Once between meetings/);
    }
    expect(roleInfo("muscle").power).toMatch(/^Once per game/);
    expect(roleInfo("detective").power).toContain(`(${BANK_JOB.shakedown.cleanBelow} or more)`);
    expect(roleInfo("smoothTalker").power).toBe("Its vote counts double.");
    expect(roleInfo("cleaner").power).toBe("Its Rooftop visit cools Heat like two people.");
    expect(roleInfo("mole").earns).toMatch(/each tip-off/i);
  });

  it("the rulebook lists all 20 roles, the endings with the right ★ roles, and marks the roles in this game", () => {
    const s = createGame(config(5, { rolePool: ["rookie", "hacker"], seed: "rb" }));
    const ui = html(createElement(RulebookSheet, { open: true, onClose: () => {}, view: viewFor(s, "p0") }));
    for (const def of Object.values(ROLES)) expect(ui, def.name).toContain(def.name);
    expect(ui).toMatch(/Cops raid \(Heat 100\)<\/td><td>Nobody, unless [^<]*Getaway Driver[^<]* has the biggest stash/);
    expect(ui).toMatch(/Final target missed<\/td><td>Nobody, unless [^<]*Embezzler[^<]* has the biggest stash/);
    expect(ui).not.toMatch(/Final target missed<\/td><td>[^<]*Getaway Driver/);
    expect(ui).toContain("in this game");
    expect(ui).toContain("Unspent tokens are worth nothing at the end.");
    expect(ui).not.toMatch(/\bact\b|this act|per act/i);
  });
});

// ---------------------------------------------------------------- role list

describe("role list views (extension.md \"Host settings\": exact, possible, nothing)", () => {
  it("Exact lists the dealt roles; Possible lists what could be in play; Hidden shows nothing", () => {
    const cfg = (roleList: "exact" | "possible" | "hidden") => config(5, { rolePool: ["rookie", "hacker", "lookout"], roleList, seed: "rl" });
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
    for (const def of Object.values(ROLES)) if (def.name !== "Rookie") expect(ui).not.toContain(def.name);
  });
});

// ---------------------------------------------------------------- lobby

describe("lobby deck settings (extension.md \"Host settings\", gap-fill \"Quick forces Starter\")", () => {
  const base: LobbySettings = {
    sessionLength: "1h",
    voteVisibility: "hiddenThenRevealed",
    deck: "standard",
    roles: [],
    deal: "balanced",
    roleList: "exact",
    eventsEnabled: true,
    starterMode: false,
    dmNotices: true,
    uniqueRoles: true,
  };
  const render = (s: LobbySettings, readOnly = false) => html(createElement(DeckSettings, { settings: s, readOnly, disabled: false, onChange: () => {} }));

  it("Standard is the default deck with the spec's 11 roles; Starter has its 5", () => {
    expect([...DECKS.standard].sort()).toEqual(["auditor", "cleaner", "detective", "embezzler", "fence", "getawayDriver", "hacker", "lookout", "mole", "muscle", "smoothTalker"]);
    expect([...DECKS.starter].sort()).toEqual(["bagman", "cleaner", "insideMan", "lookout", "rookie"]);
    expect(deckRoles(base)).toEqual(DECKS.standard);
  });

  it("Quick forces Starter but keeps the host's stored choices for when the length changes", () => {
    const custom = { ...base, deck: "everything" as const, roles: ["fence", "mole"], sessionLength: "quick" as const };
    expect(effectiveDeck(custom)).toBe("starter");
    const ui = render(custom);
    expect(ui).toContain("Quick games play the Starter deck");
    expect(ui).not.toContain("Pick roles one by one");
    expect(ui).not.toMatch(/<button[^>]*>Everything</);
    const back = { ...custom, sessionLength: "1h" as const };
    expect(effectiveDeck(back)).toBe("everything");
    expect(deckRoles(back)).toEqual(["fence", "mole"]);
  });

  it("per-role toggles add any role to a preset and keep the pick in content order", () => {
    const p = rolePatch(base, "priest")!;
    expect(p.roles).toContain("priest");
    expect(p.roles).toHaveLength(DECKS.standard.length + 1);
    expect(rolePatch({ ...base, ...p }, "priest")).toEqual({ roles: [] });
  });

  it("switching decks clears the per-role pick; leaving Starter turns starter mode off", () => {
    const picked = { ...base, roles: ["fence"] };
    expect(deckPatch(picked, "everything").roles).toEqual([]);
    expect(deckPatch({ ...base, deck: "starter", starterMode: true }, "standard")).toMatchObject({ starterMode: false });
  });

  it("all three role-list options and both deal styles are offered; a guest sees them read-only", () => {
    const ui = render(base);
    for (const t of ["Exact", "Possible", "Hidden", "Balanced", "Truly random", "Starter", "Standard", "Everything"]) expect(ui, t).toContain(`>${t}<`);
    const guest = render(base, true);
    expect(guest).not.toContain("Pick roles one by one");
    expect(guest).not.toMatch(/aria-pressed/);
  });
});

// ---------------------------------------------------------------- end screen

describe("the end screen on a failed heist (extension.md \"Winning and losing\")", () => {
  it("a raid shows the full ranking marked as a loss, with no Winner for a non-★ top stash", () => {
    let s = createGame(config(4, { rolePool: ["rookie"], seed: "raid" }));
    s = playOut(s, () => "vault", 1);
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
    let s = createGame(config(4, { rolePool: ["rookie"], seed: "win" }));
    s = playOut(s, (st) => (st.heat > 60 ? "rooftop" : "vault"), 0);
    expect(s.phase.kind === "ended" && s.phase.outcome.result).toBe("success");
    const ui = html(createElement(GameOver, { view: viewFor(s, "p0") }));
    expect(ui).toContain(">Winner<");
    expect(ui).toContain("Biggest stash");
    expect(ui).not.toContain(">Loss<");
  });
});


describe("the Heat breakdown is exact (extension.md \"Heat\", \"What the app works out for you\"; PR #52 QA round 2)", () => {
  const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const MAX = BANK_JOB.heat.max;
  const BASE = BANK_JOB.heat.perRound;
  const at = (s: GameState, heat: number): GameState => ({ ...s, heat });

  /** Round 1 of an n-player game from `start` Heat, each seat in the room `pick` gives; the lines and the real change. */
  function oneRound(n: number, start: number, pick: (i: number, rooms: readonly string[]) => string, extra: Partial<GameConfig> = {}) {
    const s0 = at(createGame(config(n, { rolePool: ["rookie"], seed: `exact-${n}-${start}`, ...extra })), start);
    const s = run(s0, ...ids(n).map((p, i) => mv(p, pick(i, s0.rooms), 0, pick(i, s0.rooms) === "security" ? { watch: "vault" } : {})), ROUND);
    const counts: Record<string, number> = {};
    ids(n).forEach((_, i) => (counts[pick(i, s0.rooms)] = (counts[pick(i, s0.rooms)] ?? 0) + 1));
    return { h: heatRound(viewFor(s, "p0"), 1)!, change: s.heat - start, after: s.heat, counts };
  }

  it("at every crew size 2–12 and many room mixes, the baseline is exactly +4, rooms are honest and the lines sum to the change", () => {
    for (let n = 2; n <= 12; n++) {
      const r = rng(n * 7919);
      for (let trial = 0; trial < 40; trial++) {
        const picks = ids(n).map(() => r());
        const { h, change, counts } = oneRound(n, 50, (i, rooms) => rooms[Math.floor(picks[i]! * rooms.length)]!);
        const tag = `${n}p ${JSON.stringify(counts)}: ${h.text}`;
        expect(h.lines.filter((l) => l.kind === "base"), tag).toEqual([{ label: "every round", value: BASE, kind: "base" }]);
        expect(h.total, tag).toBe(change);
        expect(h.lines.every((l) => Number.isInteger(l.value) && l.value !== 0), tag).toBe(true);
        expect(h.lines.some((l) => l.kind === "clamp"), tag).toBe(false);
        // Each room line is its exact share, rounded one way or the other (never more than 1 off).
        for (const l of h.lines.filter((x) => x.kind === "room")) {
          const room = Object.values(BANK_JOB.rooms).find((d) => d.name === l.label)!;
          const exact = (room.heatPressure * (counts[room.id] ?? 0)) / n;
          expect(Math.abs(l.value - exact), `${tag} (${l.label} exact ${exact})`).toBeLessThan(1);
        }
      }
    }
  });

  it("a crew laying low at or near Heat 0 shows a clamp line and the lines sum to the real change", () => {
    for (const n of [2, 3, 4, 5, 8, 12]) {
      for (const start of [0, 1, 5, 9]) {
        const { h, change, after } = oneRound(n, start, () => "rooftop");
        const tag = `${n}p from ${start}: ${h.text}`;
        expect(after, tag).toBe(0);
        expect(h.total, tag).toBe(change);
        expect(h.lines.find((l) => l.kind === "base")?.value, tag).toBe(BASE);
        const clamp = h.lines.filter((l) => l.kind === "clamp");
        expect(clamp, tag).toEqual([{ label: "Heat can't go below 0", value: expect.any(Number), kind: "clamp" }]);
        expect(clamp[0]!.value, tag).toBeGreaterThan(0);
        expect(h.text, tag).toContain("Heat can't go below 0");
      }
    }
  });

  it("no clamp line when Heat lands exactly on 0 or the floor isn't reached", () => {
    // 4p, all on the Rooftop: +4 − 20 = −16, so from 16 Heat lands exactly on 0.
    const exact = oneRound(4, 16, () => "rooftop");
    expect(exact.after).toBe(0);
    expect(exact.h.lines.some((l) => l.kind === "clamp"), exact.h.text).toBe(false);
    expect(exact.h.total).toBe(-16);
  });

  it("a crew piling into the Vault at the top of the Heat track shows the top clamp and the lines sum to the real change", () => {
    for (const n of [2, 3, 5, 8, 12]) {
      for (const start of [MAX - 1, MAX - 5, MAX - 20]) {
        const { h, change, after } = oneRound(n, start, () => "vault");
        const tag = `${n}p from ${start}: ${h.text}`;
        expect(after, tag).toBe(MAX);
        expect(h.total, tag).toBe(change);
        const clamp = h.lines.filter((l) => l.kind === "clamp");
        expect(clamp.length, tag).toBe(1);
        expect(clamp[0]!.value, tag).toBeLessThan(0);
        expect(clamp[0]!.label, tag).toBe("Heat is at the top");
      }
    }
  });

  it("a Quiet night card at low Heat is clamped too, and the card keeps its own line", () => {
    let s = createGame(config(5, { rolePool: ["rookie"], eventsEnabled: true, seed: "quiet" }));
    s = run(s, ...ids(5).map((p) => mv(p, "office")), ROUND, ALIBIS);
    s = replay(s.config, s.log.map((e) => (e.type === "eventFlipped" && e.round === 2 ? { ...e, card: "quietNight", room: null } : e)));
    expect(s.log.some((e) => e.type === "eventFlipped" && e.round === 2 && e.card === "quietNight")).toBe(true);
    // Heat 0, so the tuned Quiet night (−5, content 0.17.0, r6-balance.md) still clamps: 0 + 4 − 5 → 0.
    s = at(s, 0);
    s = run(s, ...ids(5).map((p) => mv(p, "office")), ROUND);
    const h = heatRound(viewFor(s, "p0"), 2)!;
    expect(s.heat).toBe(0);
    expect(h.total, h.text).toBe(0);
    expect(h.lines.map((l) => l.kind)).toEqual(["base", "event", "clamp"]);
    expect(h.lines.find((l) => l.kind === "event")).toMatchObject({ label: "Quiet night", value: -5 });
  });

  /**
   * Plays real rounds (meetings included) until Heat sits in [lo, hi], each round
   * picking the room mix whose Heat lands closest under `hi`. No Heat is set by hand,
   * so the log the breakdown reads is the real one.
   */
  function climb(s: GameState, lo: number, hi: number): GameState {
    for (let guard = 0; guard < 40 && !(s.phase.kind === "planning" && s.heat >= lo && s.heat <= hi); guard++) {
      if (s.phase.kind !== "planning") {
        s = playOut1(s);
        continue;
      }
      const n = s.playerOrder.length;
      const hot = s.rooms.filter((r) => r === "vault" || r === "depositBoxes");
      let best: string[] = s.playerOrder.map(() => "office");
      let bestHeat = -1;
      for (let v = 0; v <= n; v++)
        for (let d = 0; d <= Math.min(1, n - v); d++)
          for (let r = 0; r <= n - v - d; r++) {
            const rooms = s.playerOrder.map((_, i) => (i < v ? "vault" : i < v + d && hot.includes("depositBoxes") ? "depositBoxes" : i < v + d + r ? "rooftop" : "office"));
            const counts: Record<string, number> = {};
            for (const room of rooms) counts[room] = (counts[room] ?? 0) + 1;
            const heat = s.heat + roundHeatDelta(BANK_JOB, n, counts);
            // Leave room for a missed target's penalty before a meeting.
            const cap = s.round % 3 === 0 ? hi - BANK_JOB.heat.missedCheckpoint : hi;
            if (heat <= cap && heat > bestHeat) [best, bestHeat] = [rooms, heat];
          }
      s = run(s, ...s.playerOrder.map((p, i) => mv(p, best[i]!)), ROUND);
    }
    expect(s.phase.kind).toBe("planning");
    expect(s.heat).toBeGreaterThanOrEqual(lo);
    expect(s.heat).toBeLessThanOrEqual(hi);
    return s;
  }

  it("police activity right below the top (no Heat set by hand): +4 police, a clamp line, and the lines sum to the real change", () => {
    const MOLE = config(5, { rolePool: ["rookie", "lookout", "mole"], roleList: "possible", seed: "police-top" });
    let s = climb(game(MOLE, { roles: ["mole"], patrol: true }), BANK_JOB.heat.max - POLICE_ACTIVITY.heat + 1, BANK_JOB.heat.max - 1);
    const before = s.heat;
    const round = s.round;
    const lines = (st: GameState) => heatRound(viewFor(st, "p1"), round)?.lines ?? [];
    const prior = lines(s).reduce((a, l) => a + l.value, 0);
    s = run(s, MOMENT);
    expect(s.log.filter((e) => e.type === "policeActivity")).toHaveLength(1);
    expect(s.log.some((e) => e.type === "copsRaided")).toBe(true);
    const after = lines(s);
    expect(after.filter((l) => l.kind === "police")).toEqual([{ label: "police activity", value: POLICE_ACTIVITY.heat, kind: "police" }]);
    expect(after.filter((l) => l.kind === "clamp")).toEqual([{ label: "Heat is at the top", value: BANK_JOB.heat.max - before - POLICE_ACTIVITY.heat, kind: "clamp" }]);
    expect(after.reduce((a, l) => a + l.value, 0) - prior).toBe(BANK_JOB.heat.max - before);
  });

  it("police activity below the top has no clamp line", () => {
    const MOLE = config(5, { rolePool: ["rookie", "lookout", "mole"], roleList: "possible", seed: "police-mid" });
    let s = climb(game(MOLE, { roles: ["mole"], patrol: true }), 40, 60);
    const before = s.heat;
    s = run(s, MOMENT);
    const h = heatRound(viewFor(s, "p1"), s.round)!;
    expect(h.lines.some((l) => l.kind === "clamp"), h.text).toBe(false);
    expect(s.heat - before).toBe(POLICE_ACTIVITY.heat);
  });

  it("a Fixer stopping a raid after a round: a 'raid stopped' line (no name) and the lines sum to the real change", () => {
    let s = climb(game(config(5, { rolePool: ["rookie", "fixer"], seed: "fixer-top" }), { roles: ["fixer"] }), 85, 90);
    const before = s.heat;
    const round = s.round;
    s = run(s, ...ids(5).map((p) => mv(p, "vault")), ROUND);
    expect(s.log.some((e) => e.type === "raidStopped")).toBe(true);
    expect(s.log.some((e) => e.type === "copsRaided")).toBe(false);
    for (const p of ids(5)) {
      const h = heatRound(viewFor(s, p), round)!;
      expect(h.total, `${p}: ${h.text}`).toBe(s.heat - before);
      const stopped = h.lines.filter((l) => l.kind === "stopped");
      expect(stopped, h.text).toEqual([{ label: "raid stopped", value: expect.any(Number), kind: "stopped" }]);
      expect(stopped[0]!.value).toBeLessThan(0);
      expect(h.text).not.toMatch(/fixer|P0/i);
    }
  });

  it("a missed target near the top adds only what fits, and its line says so", () => {
    let s = createGame(config(3, { rolePool: ["rookie"], seed: "missed-top" }));
    for (let r = 1; r <= 3; r++) {
      s = run(s, ...ids(3).map((p) => mv(p, "rooftop")), ROUND, ALIBIS);
      if (r < 3) s = at(s, 50);
    }
    // Rooftop all game: the target is missed. Push Heat near the top, then close the meeting.
    s = at(s, MAX - 6);
    const before = s.heat;
    for (let guard = 0; guard < 4 && !s.log.some((e) => e.type === "checkpointChecked"); guard++) s = playOut1(s);
    const checked = s.log.find((e) => e.type === "checkpointChecked") as Extract<GameEvent, { type: "checkpointChecked" }> | undefined;
    if (!checked) throw new Error(`no checkpoint (phase ${s.phase.kind})`);
    expect(checked.met).toBe(false);
    const line = heatRound(viewFor(s, "p0"), 3)!.lines.find((l) => l.kind === "missed");
    expect(line?.value).toBe(Math.min(BANK_JOB.heat.missedCheckpoint, MAX - before));
  });
});
