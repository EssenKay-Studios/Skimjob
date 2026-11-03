// The Extension rules not covered by a role's own tests: the perk shop, buying
// perks, hidden police activity and the Mole's queued tip-off, "camera
// offline", the Heat breakdown, the gap box and the role list.
// docs/extension.md (THE spec for R6a)
import { describe, expect, it } from "vitest";
import { PERKS, POLICE_ACTIVITY, SHOP_COLUMNS, SHOP_RULES, type PerkId } from "@skimjob/content";
import { handleThroughAlibis } from "./alibis.testkit";
import { handleCommand } from "./handle";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { PUBLIC, privateTo } from "./types";
import { createGame, dealableRoles, setupEvents } from "./setup";
import { replay } from "./reduce";
import { gapBox, heatBreakdown, viewFor } from "./view";
import { ranking } from "./end";

function config(n: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "extension",
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    ...extra,
  };
}

interface Setup {
  /** Seat i is dealt roles[i] (Rookie if missing). */
  readonly roles?: readonly string[];
  /** The shop, replacing the dealt one. */
  readonly shop?: readonly PerkId[];
  /** Tokens each player holds at the start. */
  readonly tokens?: Readonly<Record<PlayerId, number>>;
  /** Whether the first police moment is a patrol (when police are scheduled). */
  readonly patrol?: boolean;
}

/** A new game, with the setup events rewritten as `setup` asks. */
function game(cfg: GameConfig, setup: Setup = {}): GameState {
  let seat = 0;
  const log = setupEvents(cfg).flatMap((e): GameEvent[] => {
    if (e.type === "roleDealt") {
      const role = setup.roles ? (setup.roles[seat] ?? "rookie") : e.role;
      seat++;
      const tokens = setup.tokens?.[e.player] ?? 0;
      const earned: GameEvent[] = Array.from({ length: tokens }, () => ({ type: "tokenEarned", visibility: privateTo(e.player), player: e.player, trigger: "checkpointMade" }));
      return [{ ...e, role }, ...earned];
    }
    if (e.type === "snitchTargetAssigned" && setup.roles) return [];
    if (e.type === "roleListShown" && setup.roles && e.list === "exact") return [];
    if (e.type === "shopDealt" && setup.shop) return [{ ...e, perks: setup.shop }];
    if (e.type === "policeScheduled" && setup.patrol !== undefined && e.moment === 1) return [{ ...e, patrol: setup.patrol }];
    return [e];
  });
  return replay(cfg, log);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const cmd = typeof c === "function" ? (c as (s: GameState) => unknown)(s) : c;
    const r = handleThroughAlibis(s, cmd);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(cmd)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const r = handleThroughAlibis(state, command);
  if (r.ok) throw new Error(`expected a rejection of ${JSON.stringify(command)}`);
  return r.reason;
}
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const shopOf = (cfg: GameConfig) => ofType(setupEvents(cfg), "shopDealt")[0]?.perks ?? [];

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const MOMENT = (s: GameState) => ({ type: "advance", deadline: { kind: "policeMoment", moment: s.police?.moment } });
const buy = (player: string, perk: string) => ({ type: "buyPerk", player, perk });
const tipOff = (player: string) => ({ type: "useAbility", player, ability: { kind: "tipOff" } });
const views = (s: GameState, ids: readonly PlayerId[]) => ids.map((id) => JSON.stringify(viewFor(s, id)));
const SEEDS = Array.from({ length: 60 }, (_, i) => `shop-${i}`);

describe("the perk shop — extension.md \"Tokens and the perk shop\", gap-fills \"Shop dealing\"", () => {
  it("deals three perks, one per column (Learn / Protect / Sway), with the seeded RNG; public at setup", () => {
    const sway = new Set<PerkId>();
    for (const seed of SEEDS) {
      const shop = shopOf(config(5, { seed, eventsEnabled: true }));
      expect(shop).toHaveLength(3);
      expect(SHOP_COLUMNS.learn).toContain(shop[0]);
      expect(SHOP_COLUMNS.protect).toContain(shop[1]);
      expect(SHOP_COLUMNS.sway).toContain(shop[2]);
      sway.add(shop[2] as PerkId);
      expect(shopOf(config(5, { seed, eventsEnabled: true }))).toEqual(shop);
    }
    expect([...sway].sort()).toEqual([...SHOP_COLUMNS.sway].sort());
    const s = createGame(config(5, { eventsEnabled: true }));
    expect(ofType(s.log, "shopDealt")[0]?.visibility).toEqual(PUBLIC);
    for (const id of s.playerOrder) expect(viewFor(s, id).shop.map((o) => o.perk)).toEqual(s.shop);
  });

  it("with events off the Sway perk is +Vote or Emergency; starter mode has no shop", () => {
    for (const seed of SEEDS) expect(SHOP_RULES.swayEventsOff).toContain(shopOf(config(5, { seed }))[2]);
    expect(shopOf(config(5, { starterMode: true }))).toEqual([]);
  });

  it("Duel deals Peek or Tail, Alibi or Recharge, and Rig with events on (else another Learn or Protect perk)", () => {
    for (const seed of SEEDS) {
      const on = shopOf(config(2, { seed, duel: true, eventsEnabled: true }));
      expect(SHOP_RULES.duel[0]).toContain(on[0]);
      expect(SHOP_RULES.duel[1]).toContain(on[1]);
      expect(on[2]).toBe("rig");
      const off = shopOf(config(2, { seed, duel: true }));
      expect(off).toHaveLength(3);
      expect([...SHOP_COLUMNS.learn, ...SHOP_COLUMNS.protect]).toContain(off[2]);
      expect(new Set(off).size).toBe(3);
    }
  });

  it("costs come from content: Peek and Shield 2, the rest 1; overridable", () => {
    for (const [id, perk] of Object.entries(PERKS)) expect(perk.cost, id).toBe(id === "peek" || id === "shield" ? 2 : 1);
    const s = game(config(5, { contentOverrides: { perks: { tail: { cost: 3 } } } }), { shop: ["tail", "shield", "extraVote"] });
    expect(viewFor(s, "p0").shop).toEqual([
      { perk: "tail", cost: 3 },
      { perk: "shield", cost: 2 },
      { perk: "extraVote", cost: 1 },
    ]);
  });
});

describe("buying perks — extension.md \"Tokens and the perk shop\"", () => {
  const SHOP: PerkId[] = ["peek", "shield", "extraVote"];

  it("spends the perk's cost in tokens; private to the buyer until used", () => {
    const s = game(config(5), { shop: SHOP, tokens: { p0: 3 } });
    const after = run(s, buy("p0", "peek"));
    expect(since(s, after)).toEqual([{ type: "perkBought", visibility: privateTo("p0"), player: "p0", perk: "peek", cost: 2 }]);
    expect(after.players.p0?.roleState).toMatchObject({ tokens: 1, perks: ["peek"] });
    expect(viewFor(after, "p0").me.roleState).toMatchObject({ tokens: 1, perks: ["peek"] });
    for (const id of ["p1", "p2", "p3", "p4"]) expect(JSON.stringify(viewFor(after, id))).toBe(JSON.stringify(viewFor(s, id)));
  });

  it("refuses a perk not in the shop, not enough tokens, a non-player, and outside play", () => {
    const s = game(config(5), { shop: SHOP, tokens: { p0: 1 } });
    expect(reason(s, buy("p0", "tail"))).toMatch(/not in this game's shop/);
    expect(reason(s, buy("p0", "peek"))).toMatch(/token/);
    expect(reason(s, buy("p1", "extraVote"))).toMatch(/token/);
    expect(reason(s, buy("zz", "extraVote"))).toMatch(/not in this game|unknown|player/);
    expect(reason(game(config(5, { starterMode: true }), { tokens: { p0: 3 } }), buy("p0", "peek"))).toMatch(/shop/);
  });

  it("unspent tokens are worth nothing at the end", () => {
    const plain = game(config(3, { contentOverrides: { heat: { perRound: 40 } } }));
    const rich = game(config(3, { contentOverrides: { heat: { perRound: 40 } } }), { roles: [plain.players.p0?.role ?? "rookie", plain.players.p1?.role ?? "rookie", plain.players.p2?.role ?? "rookie"], tokens: { p0: 5 } });
    const end = (s: GameState) => run(s, ROUND, ROUND, ROUND);
    expect(end(plain).phase.kind).toBe("ended");
    expect(ranking(end(rich)).map((r) => r.score)).toEqual(ranking(end(plain)).map((r) => r.score));
  });
});

describe("police activity — extension.md \"Police activity\" (owner, 3 Nov), Build notes", () => {
  // 5 players; the "Possible" role list names the Mole, so the police are in play whoever was dealt.
  const cfg = config(5, { rolePool: ["rookie", "lookout", "mole"], roleList: "possible" });
  const others = ["p1", "p2", "p3", "p4"];

  it("only when a Mole could be in the game: none without one; scheduled (reveal-only) with one", () => {
    const none = createGame(config(5, { rolePool: ["rookie", "lookout"] }));
    expect(none.police).toBeNull();
    expect(ofType(none.log, "policeScheduled")).toEqual([]);
    expect(reason(none, { type: "advance", deadline: { kind: "policeMoment", moment: 1 } })).toMatch(/no police moment/);
    const s = game(cfg, { roles: ["mole"] });
    expect(s.police).toMatchObject({ moment: 1, queue: [] });
    const [scheduled] = ofType(s.log, "policeScheduled");
    expect(scheduled?.visibility).toEqual({ kind: "reveal" });
    expect(scheduled?.gapPermille).toBeGreaterThanOrEqual(POLICE_ACTIVITY.gapMinPermille);
    expect(scheduled?.gapPermille).toBeLessThanOrEqual(POLICE_ACTIVITY.gapMaxPermille);
    // Never in a view during play: no player can tell when the next moment comes.
    for (const id of s.playerOrder) expect(JSON.stringify(viewFor(s, id))).not.toMatch(/policeScheduled|gapPermille|patrol/);
  });

  it("a patrol moment adds +4 Heat as a public \"police activity\", then the next moment is drawn", () => {
    const s = game(cfg, { roles: ["mole"], patrol: true });
    const after = run(s, MOMENT);
    const events = since(s, after);
    expect(events[0]).toEqual({ type: "policeActivity", visibility: PUBLIC, round: 1, heatAdded: POLICE_ACTIVITY.heat, heat: s.heat + 4 });
    expect(ofType(events, "policeScheduled")).toMatchObject([{ moment: 2 }]);
    expect(after.heat).toBe(s.heat + 4);
    expect(after.police?.moment).toBe(2);
  });

  it("a quiet moment does nothing visible", () => {
    const s = game(cfg, { roles: ["mole"], patrol: false });
    const after = run(s, MOMENT);
    expect(since(s, after).map((e) => e.type).filter((t) => t !== "rngAdvanced")).toEqual(["policeScheduled"]);
    for (const id of s.playerOrder) expect(viewFor(after, id).ledger).toEqual(viewFor(s, id).ledger);
  });

  it("the Mole's tip-off is queued and lands at the next moment, replacing a patrol: one activity, and the crew can't tell", () => {
    for (const patrol of [true, false]) {
      const base = game(cfg, { roles: ["mole"], patrol });
      const tipped = run(base, tipOff("p0"));
      expect(since(base, tipped)).toEqual([{ type: "abilityResolved", visibility: privateTo("p0"), player: "p0", round: 1, ability: { kind: "tipOff" } }]);
      expect(tipped.police?.queue).toEqual(["p0"]);
      const landed = run(tipped, MOMENT);
      const events = since(tipped, landed);
      expect(ofType(events, "policeActivity")).toHaveLength(1);
      expect(ofType(events, "tipOffLanded")).toEqual([{ type: "tipOffLanded", visibility: privateTo("p0"), player: "p0", round: 1 }]);
      expect(ofType(events, "tokenEarned")).toEqual([{ type: "tokenEarned", visibility: privateTo("p0"), player: "p0", trigger: "tipOffLanded" }]);
      expect(landed.police?.queue).toEqual([]);
      // Everyone else sees exactly what a plain patrol shows.
      const patrolled = run(game(cfg, { roles: ["mole"], patrol: true }), MOMENT);
      expect(views(landed, others)).toEqual(views(patrolled, others));
    }
  });

  it("once between meetings: emergencies don't reset it, the regular meeting after round 3 does", () => {
    let s = run(game(cfg, { roles: ["mole"], patrol: false }), tipOff("p0"));
    expect(reason(s, tipOff("p0"))).toMatch(/already tipped off the cops since the last meeting/);
    s = run(s, { type: "callEmergency", player: "p1" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-p1" } });
    s = run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-p1" } });
    expect(reason(s, tipOff("p0"))).toMatch(/already tipped off/);
    s = run(s, ROUND, ROUND, ROUND, { type: "scheduleMeeting", act: 1, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } });
    s = run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "act-1" } });
    expect(s.round).toBe(4);
    expect(run(s, tipOff("p0")).police?.queue.length).toBeGreaterThan(0);
  });

  it("refused while a meeting is open, for the wrong moment, and for anyone but the Mole", () => {
    const s = game(cfg, { roles: ["mole"] });
    expect(reason(s, { type: "advance", deadline: { kind: "policeMoment", moment: 2 } })).toMatch(/not the next one/);
    const meeting = run(s, { type: "callEmergency", player: "p1" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-p1" } });
    expect(reason(meeting, MOMENT(meeting))).toMatch(/paused/);
    expect(reason(s, tipOff("p1"))).toMatch(/no tipOff/);
    expect(reason(s, mv("p0", "lobby", 0, { ability: { kind: "tipOff" } }))).toMatch(/any time with useAbility|not in a move/);
  });

  it("is deterministic and replays", () => {
    const play = () => run(game(cfg, { roles: ["mole"] }), tipOff("p0"), MOMENT, ROUND, MOMENT, MOMENT);
    expect(play().log).toEqual(play().log);
    const s = play();
    expect(replay(s.config, s.log)).toEqual(s);
  });
});

describe("camera offline — extension.md \"Camera offline\"", () => {
  it("a Hacker loop on a watched room and a Power cut read the same to Security", () => {
    // Round 1: p0 Hacker loops the Vault; p1 in Security watches it; p2 pockets there.
    const looped = run(game(config(3), { roles: ["hacker"] }), mv("p0", "office", 0, { ability: { kind: "loopCameras", room: "vault" } }), mv("p1", "security", 0, { watch: "vault" }), mv("p2", "vault", 2), ROUND);
    const fromLoop = ofType(looped.log, "roomWatched").find((e) => e.player === "p1");
    expect(fromLoop).toEqual({ type: "roomWatched", visibility: privateTo("p1"), player: "p1", round: 1, source: "security", room: "vault", seen: [], offline: true });
    // Round 2 under a Power cut (events on), nobody loops.
    let cut = run(game(config(3, { eventsEnabled: true }), { roles: ["rookie"] }), ROUND);
    while (cut.phase.kind === "alibis") cut = run(cut, { type: "advance", deadline: { kind: "alibis", round: cut.resolvedRound } });
    const log = cut.log.map((e) => (e.type === "eventFlipped" && e.round === 2 ? { ...e, card: "powerCut", room: null } : e));
    cut = run(replay(cut.config, log), mv("p1", "security", 0, { watch: "vault" }), mv("p2", "vault", 2), ROUND);
    const fromCut = ofType(cut.log, "roomWatched").find((e) => e.player === "p1");
    expect({ ...fromCut, round: 1 }).toEqual(fromLoop);
  });
});

describe("the Heat breakdown and the gap box — extension.md \"What the app works out for you\"", () => {
  it("each round's summary carries its Heat parts, which add up to the change; police activity sits under the round", () => {
    const cfg = config(5, { rolePool: ["rookie", "mole"], roleList: "possible" });
    let s = game(cfg, { roles: ["mole"], patrol: true });
    s = run(s, mv("p0", "vault", 0), mv("p1", "vault", 0), MOMENT, ROUND);
    const summary = ofType(s.log, "roundResolved")[0];
    const parts = summary?.heatParts;
    expect(parts).toBeDefined();
    const total = (parts?.base ?? 0) + Object.values(parts?.rooms ?? {}).reduce((a, b) => a + b, 0) + (parts?.events ?? 0);
    expect(total).toBe(summary?.heatDelta);
    expect(parts?.rooms.vault).toBeGreaterThan(0);
    expect(heatBreakdown(s.log, 1)).toEqual({ round: 1, ...parts, police: [4], missedTarget: 0 });
    // The view's ledger is enough to work it out (public events only).
    const ledger = viewFor(s, "p3").ledger.map((e) => e.event);
    expect(heatBreakdown(ledger, 1)).toEqual(heatBreakdown(s.log, 1));
  });

  it("a missed target's penalty shows under the stretch's last round", () => {
    let s = game(config(3), { roles: [] });
    s = run(s, ROUND, ROUND, ROUND, { type: "scheduleMeeting", act: 1, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } });
    s = run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "act-1" } });
    const missed = ofType(s.log, "checkpointChecked")[0];
    expect(missed?.met).toBe(false);
    expect(heatBreakdown(s.log, 3)?.missedTarget).toBe(missed?.heatPenalty);
    expect(heatBreakdown(s.log, 2)?.missedTarget).toBe(0);
  });

  it("the gap box sets the alibis' room loot against the Haul's growth, event effects included", () => {
    // Round 1: p0 Vault (pockets 2), p1 Lobby, p2 Office. Then all three post true alibis.
    let s = game(config(3), { roles: [] });
    s = run(s, mv("p0", "vault", 2), mv("p1", "lobby"), mv("p2", "office"));
    const r = handleCommand(s, ROUND(s));
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
    expect(s.phase.kind).toBe("alibis");
    expect(gapBox(s)).toMatchObject({ round: 1, posted: 0, alibis: 0 });
    for (const [p, room] of [["p0", "vault"], ["p1", "lobby"], ["p2", "office"]] as const) s = run(s, { type: "postAlibi", player: p, room });
    const box = gapBox(s);
    expect(box).toMatchObject({ round: 1, posted: 3, unaccounted: 2 });
    expect(box?.alibis).toBe((box?.haulGrowth ?? 0) + 2);
    for (const id of s.playerOrder) expect(viewFor(s, id).gap).toEqual(box);
  });
});

describe("the role list — extension.md \"Host settings\"", () => {
  const roles = (cfg: GameConfig) => ofType(setupEvents(cfg), "roleDealt").map((e) => e.role);

  it("Exact (default) shows every dealt role, in content order, never by seat", () => {
    const cfg = config(6, { deck: "everything" });
    const s = createGame(cfg);
    const shown = viewFor(s, "p0").roleList;
    expect(shown?.list).toBe("exact");
    expect([...(shown?.roles ?? [])].sort()).toEqual([...roles(cfg)].sort());
  });

  it("Possible shows every role that could be dealt; Hidden shows nothing", () => {
    const cfg = config(6, { roleList: "possible" });
    expect(viewFor(createGame(cfg), "p0").roleList).toEqual({ list: "possible", roles: expect.arrayContaining([...dealableRoles(cfg)]) });
    expect(viewFor(createGame(cfg), "p0").roleList?.roles).toHaveLength(dealableRoles(cfg).length);
    const hidden = createGame(config(6, { roleList: "hidden" }));
    expect(viewFor(hidden, "p0").roleList).toBeNull();
    expect(ofType(hidden.log, "roleListShown")).toEqual([]);
  });
});
