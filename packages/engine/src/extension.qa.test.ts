// QA (PR #50, R6a): adversarial tests against docs/extension.md, the R6 rules spec.
// Written against the spec, not the implementation: police activity, tokens and
// the shop, the win rule, "between meetings" windows, fixed shakedown numbers,
// the one vote rule, whole-number scoring, camera offline, the Heat breakdown.
import { describe, expect, it } from "vitest";
import { PERKS, POLICE_ACTIVITY, ROLES, SHOP_COLUMNS, type PerkId } from "@skimjob/content";
import { handleThroughAlibis } from "./alibis.testkit";
import { handleCommand } from "./handle";
import type { GameConfig, GameEvent, GameState, PlayerId, PlayerState } from "./types";
import { privateTo } from "./types";
import { createGame, setupEvents } from "./setup";
import { applyEvent, replay } from "./reduce";
import { heatBreakdown, viewFor } from "./view";
import { outcomeFor, ranking } from "./end";
import { meetingResult } from "./meeting";
import { V015_NUMBERS } from "./v01-numbers.testkit";

function config(n: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "ext-qa",
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  };
}

interface Setup {
  readonly roles?: readonly string[];
  readonly shop?: readonly PerkId[];
  readonly tokens?: Readonly<Record<PlayerId, number>>;
  /** Patrol draws for police moments 1.. (when police are scheduled). */
  readonly patrol?: boolean;
  readonly gap?: number;
}

/** A new game with the setup events rewritten as `setup` asks (seat i gets roles[i], Rookie if missing). */
function game(cfg: GameConfig, setup: Setup = {}): GameState {
  let seat = 0;
  const log = setupEvents(cfg).flatMap((e): GameEvent[] => {
    if (e.type === "roleDealt") {
      const role = setup.roles ? (setup.roles[seat] ?? "rookie") : e.role;
      seat++;
      const earned: GameEvent[] = Array.from({ length: setup.tokens?.[e.player] ?? 0 }, () => ({ type: "tokenEarned", visibility: privateTo(e.player), player: e.player, trigger: "checkpointMade" }));
      return [{ ...e, role }, ...earned];
    }
    if (e.type === "roleListShown" && setup.roles && e.list === "exact") return [];
    if (e.type === "shopDealt" && setup.shop) return [{ ...e, perks: setup.shop }];
    if (e.type === "policeScheduled") return [{ ...e, ...(setup.patrol !== undefined && { patrol: setup.patrol }), ...(setup.gap !== undefined && { gapPermille: setup.gap }) }];
    return [e];
  });
  return replay(cfg, log);
}

/** Every later police moment drawn is forced to `patrol` (rewrites the log and replays). */
function forcePatrols(s: GameState, patrol: boolean): GameState {
  return replay(
    s.config,
    s.log.map((e) => (e.type === "policeScheduled" ? { ...e, patrol } : e)),
  );
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
  const r = handleCommand(state, command);
  if (r.ok) throw new Error(`expected a rejection of ${JSON.stringify(command)}`);
  return r.reason;
}
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) => events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const tokensOf = (s: GameState, p: PlayerId, trigger?: string) => ofType(s.log, "tokenEarned").filter((e) => e.player === p && (trigger === undefined || e.trigger === trigger)).length;

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const MOMENT = (s: GameState) => ({ type: "advance", deadline: { kind: "policeMoment", moment: s.police?.moment } });
const buy = (player: string, perk: string) => ({ type: "buyPerk", player, perk });
const use = (player: string, ability: object) => ({ type: "useAbility", player, ability });
const tipOff = (player: string) => use(player, { kind: "tipOff" });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
const emergency = (p: string) => [{ type: "callEmergency", player: p }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `emergency-${p}` } }];
const closeEm = (p: string) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: `emergency-${p}` } });
/** Rounds until the act's regular meeting is open (scheduling it). */
const toActMeeting = (s: GameState): GameState => {
  while (s.phase.kind === "planning") s = run(s, ROUND);
  const act = s.phase.kind === "awaitingMeeting" ? s.phase.act : 0;
  return run(s, { type: "scheduleMeeting", act, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `act-${act}` } });
};
const closeAct = (s: GameState) => run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const views = (s: GameState, ids: readonly PlayerId[]) => ids.map((id) => JSON.stringify(viewFor(s, id)));
const withPlayers = (s: GameState, patch: Record<PlayerId, Partial<PlayerState>>): GameState => ({
  ...s,
  players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, ...(patch[id] ?? {}) }])),
});

// 5 players, the Possible list names the Mole: police run whoever is dealt.
const MOLE_CFG = config(5, { rolePool: ["rookie", "lookout", "mole"], roleList: "possible" });

describe("police activity: hidden moments never leak (extension.md Build notes \"Police activity\", \"No leak\")", () => {
  it("no player's view depends on the hidden draws (gap, patrol) until a moment fires: the Mole's included", () => {
    const variants = [
      game(MOLE_CFG, { roles: ["mole"], patrol: true, gap: 500 }),
      game(MOLE_CFG, { roles: ["mole"], patrol: false, gap: 1500 }),
      game(MOLE_CFG, { roles: ["mole"], patrol: true, gap: 1000 }),
    ];
    const ids = variants[0]!.playerOrder;
    const base = views(variants[0]!, ids);
    for (const v of variants) expect(views(v, ids)).toEqual(base);
    // Still identical after a round and a tip-off (queued, not landed).
    const later = variants.map((v) => run(v, tipOff("p0"), ROUND));
    for (const v of later) expect(views(v, ids)).toEqual(views(later[0]!, ids));
  });

  it("whether police run at all is invisible under the Possible and Hidden role lists (whether or not a Mole was dealt)", () => {
    for (const roleList of ["possible", "hidden"] as const) {
      for (let i = 0; i < 30; i++) {
        const s = createGame(config(6, { seed: `pl-${i}`, roleList, deck: "everything" }));
        // The Mole is in the eligible deck, so the police run whether or not it was dealt.
        expect(s.police, `${roleList} seed ${i}`).not.toBeNull();
      }
    }
  });

  it("only when a Mole could be in the game: Starter and no-Mole decks have none", () => {
    expect(createGame(config(5, { deck: "starter", rolePool: [] })).police).toBeNull();
    expect(createGame(config(8, { rolePool: ["rookie", "lookout", "auditor", "hacker"] })).police).toBeNull();
    // Exact list: runs exactly when a Mole was dealt.
    for (let i = 0; i < 40; i++) {
      const s = createGame(config(6, { seed: `ex-${i}`, deck: "everything" }));
      const mole = Object.values(s.players).some((p) => p.role === "mole");
      expect(s.police !== null, `seed ${i}`).toBe(mole);
    }
  });

  it("the police run whatever the events setting (events on: the 9-card deck never has a Police patrol card)", () => {
    const on = createGame(config(5, { rolePool: ["rookie", "mole"], roleList: "possible", eventsEnabled: true }));
    expect(on.police).not.toBeNull();
    const s = closeAct(toActMeeting(closeAct(toActMeeting(on))));
    expect(ofType(s.log, "eventFlipped").length).toBeGreaterThanOrEqual(5);
    for (const e of ofType(s.log, "eventFlipped")) expect(String(e.card).toLowerCase()).not.toMatch(/police|patrol/);
  });

  it("no tip-off without a Mole possible; non-Moles can't tip off; tip-off only once between meetings", () => {
    // Exact list, a Mole in the deck but not dealt: no police and nobody can tip off.
    const s = game(config(5, { rolePool: ["rookie", "lookout"] }), { roles: ["rookie"] });
    expect(s.police).toBeNull();
    expect(reason(s, tipOff("p0"))).toBeTruthy();
    const m = game(MOLE_CFG, { roles: ["mole"], patrol: false });
    for (const p of ["p1", "p2", "p3", "p4"]) expect(() => reason(m, tipOff(p))).not.toThrow();
    const once = run(m, tipOff("p0"));
    expect(() => reason(once, tipOff("p0"))).not.toThrow();
    // Landing the first doesn't free a second use in the same stretch.
    const landed = run(once, MOMENT, ROUND);
    expect(() => reason(landed, tipOff("p0"))).not.toThrow();
  });

  it("one activity per moment: two queued tip-offs land at two successive moments, +4 each, never +8 at once", () => {
    let s = game(MOLE_CFG, { roles: ["mole"], patrol: true });
    // Stretch 1: tip off in round 3, not landed before the meeting.
    s = run(s, ROUND, ROUND, tipOff("p0"));
    s = closeAct(toActMeeting(s));
    expect(s.round).toBe(4);
    s = run(s, tipOff("p0"));
    expect(s.police?.queue).toEqual(["p0", "p0"]);
    const first = run(s, MOMENT);
    const firstActs = ofType(first.log.slice(s.log.length), "policeActivity");
    expect(firstActs).toHaveLength(1);
    expect(firstActs[0]?.heatAdded).toBe(POLICE_ACTIVITY.heat);
    expect(first.police?.queue).toEqual(["p0"]);
    const second = run(first, MOMENT);
    expect(ofType(second.log.slice(first.log.length), "policeActivity")).toHaveLength(1);
    expect(second.police?.queue).toEqual([]);
    expect(tokensOf(second, "p0", "tipOffLanded")).toBe(2);
  });

  it("a police moment is refused while a meeting is open, a shakedown is pending, or the game is over; fine during the alibi window", () => {
    const s = game(MOLE_CFG, { roles: ["mole"], patrol: true });
    const meeting = run(s, ...emergency("p1"));
    expect(reason(meeting, MOMENT(meeting))).toMatch(/paused|meeting/);
    // After it closes, the frozen moment lands.
    const after = run(meeting, closeEm("p1"), MOMENT);
    expect(ofType(after.log, "policeActivity")).toHaveLength(1);
    // Alibi window: game time runs (planning and the alibi window both count).
    const r = handleCommand(s, ROUND(s));
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.phase.kind).toBe("alibis");
    const inAlibis = run(r.state, MOMENT);
    const act = ofType(inAlibis.log, "policeActivity")[0];
    expect(act?.heat).toBe(r.state.heat + POLICE_ACTIVITY.heat);
    // The police line sits under round 1, whose summary is already posted.
    expect(heatBreakdown(inAlibis.log, 1)?.police).toEqual([POLICE_ACTIVITY.heat]);
  });

  it("a tip-off still queued when the game ends is lost: no landing and no token", () => {
    let s = game(config(5, { rolePool: ["rookie", "mole"], roleList: "possible", contentOverrides: { heat: { perRound: 0 } } }), { roles: ["mole"], patrol: false });
    s = closeAct(toActMeeting(s));
    s = closeAct(toActMeeting(s));
    s = toActMeeting(s);
    s = run(s, tipOff("p0"));
    s = closeAct(s);
    expect(s.phase.kind).toBe("ended");
    expect(ofType(s.log, "tipOffLanded")).toEqual([]);
    expect(tokensOf(s, "p0", "tipOffLanded")).toBe(0);
  });

  it("police activity can raid: Heat 100 ends the game at once (Mole with the biggest stash wins); a Fixer stops it at 95", () => {
    const hot = config(5, { rolePool: ["rookie", "mole", "fixer"], roleList: "possible" });
    let s = game(hot, { roles: ["mole", "rookie"], patrol: true });
    s = { ...s, heat: 98 };
    s = withPlayers(s, { p0: { stash: 20 } });
    const raided = run(s, MOMENT);
    expect(raided.phase.kind).toBe("ended");
    if (raided.phase.kind !== "ended") return;
    expect(raided.phase.outcome).toMatchObject({ result: "failed", reason: "heat", winners: ["p0"] });
    const fixed = withPlayers(game(hot, { roles: ["mole", "fixer"], patrol: true }), { p1: { stash: 8 } });
    const hotFixed = run({ ...fixed, heat: 98 }, MOMENT);
    expect(hotFixed.phase.kind).not.toBe("ended");
    expect(hotFixed.heat).toBe(95);
    expect(tokensOf(hotFixed, "p1", "raidStopped")).toBe(1);
  });
});

describe("tokens: every trigger (extension.md \"Roles\", owner rulings 1, 4, 5, 6, gap-fills \"Token triggers\")", () => {
  it("tokens are private: earning one changes no other player's view", () => {
    const s = game(MOLE_CFG, { roles: ["mole"], patrol: false });
    const after = applyEvent(s, { type: "tokenEarned", visibility: privateTo("p0"), player: "p0", trigger: "tipOffLanded" });
    expect(views(after, ["p1", "p2", "p3", "p4"])).toEqual(views(s, ["p1", "p2", "p3", "p4"]));
    expect(viewFor(after, "p0").me.roleState.tokens).toBe(1);
    // Nor is any other player's token count anywhere in a view.
    for (const id of ["p1", "p2"]) expect(JSON.stringify(viewFor(after, id).players)).not.toMatch(/token/i);
  });
});

describe("buyPerk (extension.md \"Tokens and the perk shop\")", () => {
  const SHOP: PerkId[] = ["tail", "alibi", "extraVote"];
  const s0 = () => game(config(5), { shop: SHOP, tokens: { p0: 2, p1: 1 } });

  it("refuses a perk from another column or not dealt, an unknown or hostile perk name, and a spectator", () => {
    const s = s0();
    for (const perk of ["peek", "shield", "recharge", "emergency", "rig", "ballot", "nope", "__proto__", "constructor", 7, null]) {
      expect(handleCommand(s, buy("p0", perk as string)).ok, String(perk)).toBe(false);
    }
    for (const who of ["spectator", "p9", "", "__proto__"]) expect(handleCommand(s, buy(who, "tail")).ok, who).toBe(false);
  });

  it("insufficient tokens is refused at the exact boundary; costs are whole tokens and never go negative", () => {
    const s = game(config(5), { shop: ["peek", "shield", "extraVote"], tokens: { p0: 1, p1: 2 } });
    expect(reason(s, buy("p0", "peek"))).toMatch(/token/);
    expect(reason(s, buy("p0", "shield"))).toMatch(/token/);
    const ok = run(s, buy("p1", "peek"));
    expect(ok.players.p1?.roleState.tokens).toBe(0);
    expect(reason(ok, buy("p1", "extraVote"))).toMatch(/token/);
    expect(PERKS.peek.cost + PERKS.shield.cost).toBe(4);
  });

  it("buying twice in a round is fine; using two perks in one round is not", () => {
    let s = run(s0(), buy("p0", "tail"), buy("p0", "tail"));
    expect(s.players.p0?.roleState.perks).toEqual(["tail", "tail"]);
    s = run(s, use("p0", { kind: "tail", room: "vault" }));
    expect(reason(s, use("p0", { kind: "tail", room: "office" }))).toMatch(/already/);
    // Next round it works.
    s = run(s, ROUND, use("p0", { kind: "tail", room: "office" }));
    expect(s.players.p0?.roleState.perks).toEqual([]);
  });

  it("can buy any time: during the alibi window and during a meeting; never after the game ends", () => {
    const s = s0();
    const r = handleCommand(s, ROUND(s));
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.phase.kind).toBe("alibis");
    expect(handleCommand(r.state, buy("p0", "tail")).ok).toBe(true);
    const meeting = run(s, ...emergency("p2"));
    expect(handleCommand(meeting, buy("p1", "extraVote")).ok).toBe(true);
    const ended = run(game(config(3, { contentOverrides: { heat: { perRound: 60 } } }), { shop: SHOP, tokens: { p0: 2 } }), ROUND, ROUND);
    expect(ended.phase.kind).toBe("ended");
    expect(reason(ended, buy("p0", "tail"))).toMatch(/over/);
  });

  it("a bought perk is private: other views don't change", () => {
    const s = s0();
    const after = run(s, buy("p0", "alibi"));
    expect(views(after, ["p1", "p2", "p3", "p4"])).toEqual(views(s, ["p1", "p2", "p3", "p4"]));
  });

  it("the shop is three different perks, one per column, the same for every player count and seed replay (3..12)", () => {
    for (let n = 3; n <= 12; n++) {
      for (let i = 0; i < 10; i++) {
        const cfg = config(n, { seed: `shop-${n}-${i}`, eventsEnabled: true });
        const a = createGame(cfg).shop;
        expect(a).toHaveLength(3);
        expect(new Set(a).size).toBe(3);
        expect(createGame(cfg).shop).toEqual(a);
        expect(SHOP_COLUMNS.learn).toContain(a[0]);
        expect(SHOP_COLUMNS.protect).toContain(a[1]);
        expect(SHOP_COLUMNS.sway).toContain(a[2]);
      }
    }
  });
});

describe("the win rule (extension.md \"Winning and losing\", Build notes \"Win rule\")", () => {
  const base = () => game(config(4), { roles: ["rookie", "hacker", "mole"] });
  const flat = { stash: 10, timesShakenDown: 0, totalHandedIn: 5 };

  it("success: the top group wins, whatever the roles; full ties share", () => {
    const s = withPlayers(base(), { p0: flat, p1: flat, p2: { ...flat, stash: 9 }, p3: { ...flat, stash: 1 } });
    expect([...outcomeFor(s, null).winners].sort()).toEqual(["p0", "p1"]);
  });

  it("ties: fewer shakedowns first, then more handed in", () => {
    const s = withPlayers(base(), { p0: { ...flat, timesShakenDown: 1 }, p1: flat, p2: { ...flat, totalHandedIn: 9 }, p3: { ...flat, stash: 0 } });
    expect(outcomeFor(s, null).winners).toEqual(["p2"]);
  });

  it("a raid: only top-group members whose role wins on heat; a ★ outside the top group never wins", () => {
    const tied = withPlayers(base(), { p0: flat, p1: flat, p2: flat, p3: flat });
    // Top group = all four; only the Mole (★) wins on heat or target.
    expect([...outcomeFor(tied, "heat").winners].sort()).toEqual(["p2"]);
    expect([...outcomeFor(tied, "target").winners].sort()).toEqual(["p2"]);
    const rookieTop = withPlayers(base(), { p0: { ...flat, stash: 30 }, p1: flat, p2: flat, p3: flat });
    const out = outcomeFor(rookieTop, "heat");
    expect(out.winners).toEqual([]);
    expect(out).toMatchObject({ result: "failed", reason: "heat" });
    // The full ranking is still shown on a failure.
    expect(out.ranking.map((r) => r.player)).toEqual(["p0", "p1", "p2", "p3"]);
    // A non-★ role top on a raid: nobody.
    expect(outcomeFor(withPlayers(base(), { p3: { ...flat, stash: 30 } }), "heat").winners).toEqual([]);
  });
});

describe("one vote rule for every crew size, 3..12 (extension.md \"Voting\")", () => {
  it("passes when at least half the crew votes and one player has more than half the votes cast", () => {
    for (let n = 3; n <= 12; n++) {
      const half = Math.ceil(n / 2);
      expect(meetingResult(n, half, 0, new Map([["x", half]]), half), `n=${n} quorum`).toEqual({ kind: "shakedown", target: "x" });
      expect(meetingResult(n, half - 1, 0, new Map([["x", half - 1]]), half - 1).kind, `n=${n} below quorum`).toBe("noQuorum");
      // Exactly half of the votes cast is not more than half.
      if (n % 2 === 0) expect(meetingResult(n, n, 0, new Map([["x", n / 2], ["y", n / 2]]), n).kind, `n=${n} split`).toBe("noMajority");
      else expect(meetingResult(n, n, 0, new Map([["x", (n + 1) / 2], ["y", (n - 1) / 2]]), n), `n=${n} bare majority`).toEqual({ kind: "shakedown", target: "x" });
      // Skip wins with more than half; exactly half of each is no majority.
      if (n % 2 === 0) expect(meetingResult(n, n, n / 2, new Map([["x", n / 2]]), n).kind).toBe("noMajority");
    }
    expect(meetingResult(12, 12, 2, new Map([["x", 5], ["y", 3], ["z", 2]]), 12).kind).toBe("noMajority");
    expect(meetingResult(9, 9, 1, new Map([["x", 4], ["y", 2], ["z", 2]]), 9).kind).toBe("noMajority");
  });
});

describe("fixed shakedown numbers (extension.md \"Shakedowns (fixed numbers)\")", () => {
  const shaken = (roles: string[], move: object) => {
    let s = game(config(5), { roles });
    s = run(s, move, ROUND);
    return run(s, ...emergency("p1"), vote("p1", "p2"), vote("p3", "p2"), vote("p4", "p2"), closeEm("p1"));
  };

  it("stash 5 is clean and paid 8 out of the Haul; stash 6 is dirty and taken", () => {
    const clean = shaken([], mv("p2", "vault", 5));
    const r5 = ofType(clean.log, "shakedownResolved")[0];
    expect(r5).toMatchObject({ clean: true, compensation: 8, stashRevealed: 5 });
    const dirty = shaken([], mv("p2", "vault", 6));
    expect(ofType(dirty.log, "shakedownResolved")[0]).toMatchObject({ clean: false, compensation: 0, stashRevealed: 6, taken: 6 });
    expect(dirty.players.p2?.stash).toBe(0);
  });
});

describe("between-meetings windows (extension.md Build notes \"Between meetings\", gap-fills 2 and 7)", () => {
  const loop = (p: string, room = "vault") => mv(p, "lobby", 0, { ability: { kind: "loopCameras", room } });

  it("a once-between-meetings power stays spent through an emergency meeting and recharges only when the regular meeting closes", () => {
    let s = game(config(5), { roles: ["hacker"] });
    s = run(s, loop("p0"), ROUND);
    expect(handleCommand(s, loop("p0")).ok).toBe(false);
    s = run(s, ...emergency("p1"), closeEm("p1"));
    expect(handleCommand(s, loop("p0")).ok).toBe(false);
    s = run(s, ROUND, ROUND);
    s = toActMeeting(s);
    s = closeAct(s);
    expect(s.phase.kind).toBe("planning");
    expect(handleCommand(s, loop("p0")).ok).toBe(true);
  });

  it("a tip-off used during the regular meeting spends the old stretch's charge; the next stretch has a fresh one", () => {
    let s = game(MOLE_CFG, { roles: ["mole"], patrol: false });
    s = run(s, ROUND, ROUND, ROUND);
    s = toActMeeting(s);
    expect(s.phase.kind).toBe("meeting");
    s = run(s, tipOff("p0"));
    expect(handleCommand(s, tipOff("p0")).ok).toBe(false);
    s = closeAct(s);
    expect(handleCommand(s, tipOff("p0")).ok).toBe(true);
  });
});

describe("\"camera offline\" (extension.md \"Situations\": the Hacker's loop)", () => {
  it("a looped feed reads the same whether the room was empty, visited, or pocketed in", () => {
    const watched = (visitor: object | null) => {
      let s = game(config(4), { roles: ["hacker", "rookie"] });
      s = run(s, mv("p0", "lobby", 0, { ability: { kind: "loopCameras", room: "vault" } }), mv("p1", "security", 0, { watch: "vault" }));
      if (visitor) s = run(s, visitor);
      s = run(s, ROUND);
      return viewFor(s, "p1").caseFile.map((l) => l.event).filter((e) => e.type === "roomWatched");
    };
    const empty = watched(null);
    expect(empty).toEqual([expect.objectContaining({ offline: true, seen: [] })]);
    expect(watched(mv("p2", "vault"))).toEqual(empty);
    expect(watched(mv("p2", "vault", 6))).toEqual(empty);
  });
});

describe("shared numbers: Detective line, Haul-paid compensation (extension.md gap-fills 3)", () => {
  it("the Detective's dirty line is the same 6 as the clean line: 5 reads clean, 6 dirty", () => {
    for (const [stash, dirty] of [[5, false], [6, true]] as const) {
      const s = run(withPlayers(game(config(5), { roles: ["detective"] }), { p2: { stash } }), use("p0", { kind: "checkStash", target: "p2" }));
      const r = ofType(s.log, "abilityResolved").at(-1);
      expect(r?.ability).toMatchObject({ kind: "checkStash", threshold: 6, dirty });
    }
  });
});

describe("QA re-check (PR #50 fixes): locked in", () => {
  it("Mole: at most 3 tip-offs (so 3 tokens) a game, Recharge included; a 4th is refused privately", () => {
    let s = game(MOLE_CFG, { roles: ["mole"], patrol: false, shop: ["peek", "recharge", "extraVote"], tokens: { p0: 3 } });
    s = run(s, tipOff("p0"), MOMENT, buy("p0", "recharge"), use("p0", { kind: "recharge" }), tipOff("p0"), MOMENT);
    expect(tokensOf(s, "p0", "tipOffLanded")).toBe(2);
    s = closeAct(toActMeeting(s));
    s = run(s, tipOff("p0"), MOMENT);
    expect(tokensOf(s, "p0", "tipOffLanded")).toBe(3);
    s = closeAct(toActMeeting(s));
    const others = views(s, ["p1", "p2", "p3", "p4"]);
    expect(reason(s, tipOff("p0"))).toMatch(/3 times/);
    expect(views(s, ["p1", "p2", "p3", "p4"])).toEqual(others);
    expect(ofType(s.log, "tipOffLanded")).toHaveLength(3);
  });

  it("Mole: tip-offs still queued count toward the 3 (Recharge each round, no police moment in between)", () => {
    let s = game(MOLE_CFG, { roles: ["mole"], patrol: false, shop: ["peek", "recharge", "extraVote"], tokens: { p0: 5 } });
    s = run(s, tipOff("p0"), ROUND, buy("p0", "recharge"), use("p0", { kind: "recharge" }), tipOff("p0"), ROUND, buy("p0", "recharge"), use("p0", { kind: "recharge" }), tipOff("p0"), ROUND);
    expect(ofType(s.log, "tipOffLanded")).toHaveLength(0);
    s = closeAct(toActMeeting(s));
    expect(handleCommand(s, tipOff("p0")).ok).toBe(false);
    for (let i = 0; i < 6 && s.phase.kind === "planning"; i++) s = run(s, MOMENT);
    expect(ofType(s.log, "tipOffLanded")).toHaveLength(3);
    expect(tokensOf(s, "p0", "tipOffLanded")).toBe(3);
  });

  const ALL = Object.keys(ROLES) as GameConfig["rolePool"][number][];
  const cfgFor = (n: number, seed: string, extra: Partial<GameConfig>) => config(n, { seed, rolePool: ALL, ...extra });

  it("Balanced at 3 players: no police and the Possible list names only roles that can be dealt", () => {
    for (const n of [3]) {
      for (const pool of [ALL, []]) {
        for (const roleList of ["possible", "hidden"] as const) {
          const dealt = new Set<string>();
          let listed: readonly string[] | null = null;
          for (let i = 0; i < 150; i++) {
            const g = createGame(cfgFor(n, `bal-${n}-${i}`, { rolePool: pool, roleList }));
            expect(g.police, `${n}p ${roleList}`).toBeNull();
            for (const p of Object.values(g.players)) dealt.add(p.role);
            const shown = viewFor(g, "p0").roleList;
            if (roleList === "possible") {
              expect(shown?.roles).toBeDefined();
              if (listed) expect(shown?.roles).toEqual(listed);
              listed = shown!.roles;
            }
          }
          expect(dealt.has("mole")).toBe(false);
          if (listed) {
            expect(listed).not.toContain("mole");
            // Everything dealt is listed; nothing listed is undealable (no Lone wolf or Wildcard at 3p Balanced).
            for (const r of dealt) expect(listed, r).toContain(r);
            for (const r of listed) expect(ROLES[r as keyof typeof ROLES]?.tag, r).toBe("teamPlayer");
          }
        }
      }
    }
  });

  it("the fix doesn't over-reach: Truly random at 3p and Balanced at 4p+ can deal a Mole, list it, and run police", () => {
    for (const [n, deal] of [[3, "random"], [4, "balanced"], [12, "balanced"]] as const) {
      let moles = 0;
      for (let i = 0; i < 150; i++) {
        const g = createGame(cfgFor(n, `over-${n}-${i}`, { deal, roleList: "possible" }));
        expect(g.police, `${n}p ${deal}`).not.toBeNull();
        expect(viewFor(g, "p0").roleList?.roles).toContain("mole");
        if (Object.values(g.players).some((p) => p.role === "mole")) moles++;
      }
      expect(moles, `${n}p ${deal}`).toBeGreaterThan(0);
    }
  });
});
