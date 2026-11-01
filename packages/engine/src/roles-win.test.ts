// Win-condition roles: the Mole (tip-off, Mole allies, wins only on failure)
// and the Auditor (wins a Heat failure with the biggest stash). design §3, §8, §8.1
// The winning rules themselves are also in end.test.ts.
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { DEFAULT_ROLE_POOL, MOLE_ROLE, ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { createGame, moleAllies, setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "win-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: ["rookie", "lookout", "fence", "auditor"], // no Muscle (no shakedown window), no Snitch
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    ...extra,
  };
}

/** A new game with chosen roles (seat i gets roles[i], Rookie if missing). */
function game(players: number, roles: string[], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  const log = setupEvents(cfg).map((e, i, all): GameEvent => {
    if (e.type !== "roleDealt") return e;
    const seat = all.slice(0, i).filter((x) => x.type === "roleDealt").length;
    return { ...e, role: roles[seat] ?? "rookie" };
  });
  return replay(cfg, log);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, typeof c === "function" ? c(s) : c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(typeof c === "function" ? c(s) : c)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const r = handleThroughAlibis(state, command);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
}
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const TIP = { ability: { kind: "tipOff" } };
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const OPEN = (s: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const vote = (player: string, target: string) => ({ type: "castVote", player, vote: { kind: "shakedown", target } });
const roundResolved = (events: readonly GameEvent[]) => events.find((e) => e.type === "roundResolved") as Extract<GameEvent, { type: "roundResolved" }>;

const TIP_HEAT = (ROLES.mole?.power as { heat: number }).heat;

describe("Mole tip-off — design §7, §8", () => {
  /** One round of 3 players in the Lobby; p0 is the Mole and tips off if `tip`. */
  const oneRound = (tip: boolean, extra: Partial<GameConfig> = {}) => {
    const s = game(3, ["mole", "auditor", "rookie"], extra);
    const after = run(s, mv("p0", "lobby", 0, tip ? TIP : {}), mv("p1", "lobby"), mv("p2", "lobby"), ROUND);
    return { before: s, after, events: since(s, after) };
  };

  it("adds the content Heat (+6 since balance pass 2) to the round's Heat, inside the public total", () => {
    expect(TIP_HEAT).toBe(6);
    const plain = oneRound(false);
    const tipped = oneRound(true);
    expect(roundResolved(tipped.events).heatDelta - roundResolved(plain.events).heatDelta).toBe(TIP_HEAT);
    expect(tipped.after.heat - plain.after.heat).toBe(TIP_HEAT);
  });

  it("is hidden: only the Mole is told, and the public events are the same apart from the Heat numbers", () => {
    const plain = oneRound(false);
    const tipped = oneRound(true);
    const resolved = tipped.events.filter((e) => e.type === "abilityResolved");
    expect(resolved).toEqual([{ type: "abilityResolved", visibility: { kind: "private", player: "p0" }, player: "p0", round: 1, ability: { kind: "tipOff", heat: TIP_HEAT } }]);
    const publicTypes = (events: readonly GameEvent[]) => events.filter((e) => e.visibility.kind === "public").map((e) => e.type);
    expect(publicTypes(tipped.events)).toEqual(publicTypes(plain.events));
    // Other players' views differ only in the round's Heat figures.
    for (const viewer of ["p1", "p2"]) {
      const strip = (s: GameState) => JSON.stringify(viewFor(s, viewer), (k, v) => (k === "heat" || k === "heatDelta" ? 0 : v));
      expect(strip(tipped.after)).toBe(strip(plain.after));
    }
  });

  it("can be used once per act, and again in the next act", () => {
    let s = run(game(3, ["mole"]), mv("p0", "lobby", 0, TIP), ROUND);
    expect(s.players.p0?.roleState.usedThisAct).toBe(1);
    expect(reason(s, mv("p0", "lobby", 0, TIP))).toBe("you have already tipped off the cops this act");
    s = run(s, ROUND, ROUND, { type: "scheduleMeeting", act: 1, slot: "x" }, OPEN, CLOSE);
    expect(s.round).toBe(4);
    expect(s.players.p0?.roleState.usedThisAct).toBe(0);
    const before = s;
    s = run(s, mv("p0", "lobby", 0, TIP), ROUND);
    expect(since(before, s).some((e) => e.type === "abilityResolved" && e.ability.kind === "tipOff")).toBe(true);
  });

  it("re-submitting a move with the tip-off in the same round counts once", () => {
    const s = run(game(3, ["mole"]), mv("p0", "lobby", 0, TIP), mv("p0", "vault", 0, TIP), ROUND);
    expect(s.players.p0?.roleState.usedThisAct).toBe(1);
  });

  it("only the Mole can tip off", () => {
    const s = game(3, ["mole", "auditor", "rookie"]);
    expect(reason(s, mv("p1", "lobby", 0, TIP))).toBe("your role has no tipOff ability");
    expect(reason(s, mv("p2", "lobby", 0, TIP))).toBe("your role has no tipOff ability");
  });

  it("the Heat number is content: a config override changes it", () => {
    const plain = oneRound(false, { contentOverrides: { roles: { mole: { heat: 15 } } } });
    const tipped = oneRound(true, { contentOverrides: { roles: { mole: { heat: 15 } } } });
    expect(tipped.after.heat - plain.after.heat).toBe(15);
  });

  it("a tip-off can bring the raid: Heat failure, the Mole wins, not the top-stash Auditor (design §3, role deck v2 §0)", () => {
    let s = game(3, ["mole", "auditor", "rookie"]);
    s = { ...s, heat: 90 };
    s = run(s, mv("p0", "lobby", 0, TIP), mv("p1", "vault", 4), mv("p2", "lobby"), ROUND);
    expect(s.heat).toBe(100);
    expect(s.log.some((e) => e.type === "copsRaided")).toBe(true);
    expect(s.phase).toMatchObject({ kind: "ended", outcome: { result: "failed", reason: "heat" } });
    if (s.phase.kind !== "ended") throw new Error("not ended");
    expect(s.phase.outcome.winners).toEqual(["p0"]);
  });
});

describe("Mole dealing and Mole allies — design §8.1", () => {
  const moles = (events: readonly GameEvent[]): PlayerId[] =>
    events.flatMap((e) => (e.type === "roleDealt" && e.role === MOLE_ROLE ? [e.player] : []));

  it("the Auditor is in the default pool; the Mole stays out of it (dealt by the Mole setting)", () => {
    expect(DEFAULT_ROLE_POOL).toContain("auditor");
    expect(DEFAULT_ROLE_POOL).not.toContain(MOLE_ROLE);
  });

  it("two Moles each get a private moleAllies naming the other; a lone Mole gets none", () => {
    let singles = 0;
    for (const n of [5, 8, 9, 12]) {
      for (let seed = 0; seed < 10; seed++) {
        const cfg = config(n, { mole: "maybe", rolePool: [], seed: `allies-${n}-${seed}` });
        const events = setupEvents(cfg);
        // design §8.1 (owner answers, 1 Nov): the shipped rules never deal two.
        expect(moles(events).length).toBeLessThan(2);
        expect(events.filter((e) => e.type === "moleAllies")).toEqual([]);
        if (moles(events).length === 1) {
          singles++;
          // With content that deals two, both learn the other and nobody else learns anything.
          const log = withTwoMoles(cfg);
          const dealt = moles(log);
          expect(log.filter((e) => e.type === "moleAllies")).toEqual(
            dealt.map((id) => ({ type: "moleAllies", visibility: { kind: "private", player: id }, player: id, allies: dealt.filter((m) => m !== id) })),
          );
          const s = replay(cfg, log);
          for (const id of s.playerOrder) {
            const view = viewFor(s, id);
            const seen = view.caseFile.filter((l) => l.event.type === "moleAllies");
            expect(seen.length).toBe(dealt.includes(id) ? 1 : 0);
            expect(view.me.roleState.allies).toEqual(dealt.includes(id) ? dealt.filter((m) => m !== id) : []);
            expect(view.ledger.some((l) => (l.event as GameEvent).type === "moleAllies")).toBe(false);
          }
        }
      }
    }
    expect(singles).toBeGreaterThan(0);
  });

  it("Mole 'on' deals 1 Mole at 4–12 (design §8.1, role deck v2 §3: the only saboteur, at most once), none at 2–3", () => {
    expect(moles(setupEvents(config(5, { mole: "on" })))).toHaveLength(1);
    expect(moles(setupEvents(config(9, { mole: "on" })))).toHaveLength(1);
    expect(moles(setupEvents(config(12, { mole: "on" })))).toHaveLength(1);
    expect(moles(setupEvents(config(4, { mole: "on" })))).toHaveLength(1);
    expect(moles(setupEvents(config(3, { mole: "on" })))).toHaveLength(0);
  });
});

/**
 * The shipped Mole rules deal at most one Mole (design §8.1, owner answers 1 Nov).
 * For content that deals two: `cfg`'s setup with a second seat (not a Snitch)
 * turned Mole and the `moleAllies` setup would then emit.
 */
function withTwoMoles(cfg: GameConfig): GameEvent[] {
  const events = setupEvents(cfg);
  const dealt = events.filter((e): e is Extract<GameEvent, { type: "roleDealt" }> => e.type === "roleDealt");
  const extra = dealt.find((e) => e.role !== MOLE_ROLE && e.role !== "snitch");
  if (!extra || dealt.filter((e) => e.role === MOLE_ROLE).length !== 1) throw new Error("withTwoMoles needs exactly one Mole dealt");
  const roles = dealt.map((e) => (e === extra ? MOLE_ROLE : e.role));
  const swapped = events.map((e): GameEvent => (e === extra ? { ...extra, role: MOLE_ROLE } : e));
  const at = swapped.indexOf(swapped.filter((e) => e.type === "roleDealt").at(-1) as GameEvent) + 1;
  return [...swapped.slice(0, at), ...moleAllies(cfg, roles), ...swapped.slice(at)];
}

describe("shakedowns reveal the stash, not the role — design §8.2", () => {
  it("shaking down the Mole shows its stash and nothing about its role", () => {
    let s = game(3, ["mole", "auditor", "rookie"]);
    s = run(s, mv("p0", "vault", 3), mv("p1", "lobby"), mv("p2", "lobby"), ROUND, ROUND, ROUND);
    s = run(s, { type: "scheduleMeeting", act: 1, slot: "x" }, OPEN, vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    const shakedown = s.log.find((e) => e.type === "shakedownResolved");
    expect(shakedown).toMatchObject({ target: "p0", stashRevealed: 3, taken: 3 });
    expect(Object.keys(shakedown ?? {}).sort()).toEqual(["clean", "compensation", "meetingId", "stashRevealed", "taken", "target", "type", "visibility"]);
    // No public event after setup names a role; the roles only come out at the reveal.
    const publicAfterSetup = s.log.filter((e) => e.visibility.kind === "public" && e.type !== "gameCreated");
    expect(JSON.stringify(publicAfterSetup)).not.toMatch(/"mole"|"auditor"/);
    expect(viewFor(s, "p1").players.find((p) => p.id === "p0")).not.toHaveProperty("role");
  });
});
