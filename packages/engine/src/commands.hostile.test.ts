// Hostile command values: every field of every command type, sent with values
// a JSON client can build to trip up lookups and reason strings — objects with
// no string form ({"toString":null}), prototype keys ("__proto__",
// "constructor", …), and values of the wrong type. Each must be refused, never
// thrown, and leave the state as it was. design §17.2 (commands arrive as
// untrusted JSON; bad input is a rejection).
//
// Every mutation starts from a command the engine *accepts* in that state, so
// the hostile value is what gets it refused; the coverage check at the end
// makes sure every field was tried that way at least once.
import { describe, expect, it } from "vitest";
import type { PerkId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { powerOf } from "./overrides";
import { actOfRound } from "./acts";
import { grantPerks } from "./perks.testkit";

// ---------------------------------------------------------------- states

/** Every perk spent with `useAbility` (the Shield spends itself). design §8.3 */
const ALL_PERKS: readonly PerkId[] = ["peek", "extraVote", "ballot", "tail", "alibi", "recharge", "rig"];

const ROLES_BY_SEAT = ["lookout", "fence", "hacker", "blackmailer", "muscle", "auditor", "detective", "mole", "rookie"];

function config(extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "hostile-seed",
    players: ROLES_BY_SEAT.map((_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
    job: "bank",
    rolePool: ROLES_BY_SEAT.filter((r) => r !== "mole"),
    mole: "off",
    eventsEnabled: true,
    // Secret mode, so the Ballot perk can be spent (it's refused in Open mode).
    voteVisibility: "secret",
    starterMode: false,
    ...extra,
  };
}

/** A new game with seat i dealt roles[i]. */
function game(cfg: GameConfig, roles: readonly string[]): GameState {
  const log = setupEvents(cfg).map((e, i, all): GameEvent => {
    if (e.type !== "roleDealt") return e;
    const seat = all.slice(0, i).filter((x) => x.type === "roleDealt").length;
    return { ...e, role: roles[seat] ?? "rookie" };
  });
  return replay(cfg, log);
}

function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleCommand(s, c);
    if (!r.ok) throw new Error(`script command refused: ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}

const mv = (player: string, room: string) => ({ type: "submitMove", player, move: { room, pocket: 0 } });
const round = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const alibis = (s: GameState) => ({ type: "advance", deadline: { kind: "alibis", round: s.resolvedRound } });

/** States across the phases where each command can be accepted. */
function scenarioStates(): GameState[] {
  const out: GameState[] = [];
  const keep = (s: GameState): GameState => (out.push(s), s);
  let s = game(config(), ROLES_BY_SEAT);
  for (const id of s.playerOrder) s = grantPerks(s, id, ...ALL_PERKS, ...ALL_PERKS);
  keep(s); // planning round 1
  s = keep(run(s, { type: "useAbility", player: "p8", ability: { kind: "rig" } })); // the Rig's pick is open
  s = keep(run(s, ...s.playerOrder.map((id) => mv(id, "lobby"))));
  s = keep(run(s, { type: "proposeMeeting", player: "p0", slot: "slot-a" }));
  s = keep(run(s, round(s))); // alibis for round 1
  s = keep(run(s, { type: "postAlibi", player: "p8", room: "lobby" })); // a true alibi, for the Alibi perk
  s = keep(run(s, { type: "useAbility", player: "p5", ability: { kind: "audit", room: "lobby" } })); // a power used, for the Recharge perk
  s = keep(run(s, { type: "callEmergency", player: "p1" })); // waiting to open
  s = keep(run(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-p1" } })); // voting
  s = run(s, ...["p0", "p1", "p2", "p3", "p4", "p5", "p6"].map((id) => ({ type: "castVote", player: id, vote: { kind: "shakedown", target: "p8" } })));
  s = keep(run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-p1" } })); // the Muscle's window
  expect(s.phase.kind).toBe("shakedownPending");
  s = keep(run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "emergency-p1" } }));
  s = keep(run(s, alibis(s))); // planning round 2
  s = run(s, round(s));
  s = run(s, alibis(s));
  s = run(s, round(s));
  s = keep(run(s, alibis(s))); // awaiting the act 1 meeting
  expect(s.phase.kind).toBe("awaitingMeeting");
  s = keep(run(s, { type: "scheduleMeeting", act: 1, slot: "server" }));
  // A Double-cross offer to p0 and p1 this round (design §10), forged onto planning.
  const planning = out[2] as GameState;
  keep({ ...planning, card: { round: planning.round, id: "doubleCross", room: null, offer: { players: ["p0", "p1"], accepted: [] } } });
  // Duel mode (design §16.1): call-outs.
  const duel = config({ players: [0, 1].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })), rolePool: [], voteVisibility: "hiddenThenRevealed", duel: true });
  keep(game(duel, ["rookie", "rookie"]));
  return out;
}

// ---------------------------------------------------------------- commands

/** A command that is meant to be accepted in `s`, for every command type and every field it reads. */
function baseCommands(s: GameState): Record<string, unknown>[] {
  const ids = s.playerOrder;
  const other = (id: string) => ids.find((x) => x !== id) as string;
  const room = s.rooms.find((r) => r !== "security") as string;
  const out: Record<string, unknown>[] = [];
  for (const player of ids) {
    const p = s.players[player] as PlayerState;
    // Moves: a plain one, one from a watcher room, and one using the role's power. design §5.1, §6.1, §8
    out.push(mv(player, room));
    if (s.rooms.includes("security")) out.push({ type: "submitMove", player, move: { room: "security", pocket: 0, watch: room } });
    const power = powerOf(s.config, p.role);
    const ability =
      power.kind === "lookout"
        ? { kind: "lookout", rooms: [room] }
        : power.kind === "fenceSafe"
          ? { kind: "fenceSafe", amount: 1 }
          : power.kind === "loopCameras"
            ? { kind: "loopCameras", room }
            : power.kind === "blackmail"
              ? { kind: "blackmail", target: other(player), role: "fence" }
              : power.kind === "tipOff"
                ? { kind: "tipOff" }
                : null;
    if (ability) out.push({ type: "submitMove", player, move: { room, pocket: 0, ability } });
    // Powers used outside a move. design §8
    if (power.kind === "cancelShakedown") out.push({ type: "useAbility", player, ability: { kind: "cancelShakedown" } });
    if (power.kind === "audit") out.push({ type: "useAbility", player, ability: { kind: "audit", room } });
    if (power.kind === "checkStash") out.push({ type: "useAbility", player, ability: { kind: "checkStash", target: other(player) } });
    // Perks. design §8.3
    for (const ability of [
      { kind: "peek", target: other(player) },
      { kind: "extraVote" },
      { kind: "ballot", target: other(player) },
      { kind: "tail", room },
      { kind: "alibi" },
      { kind: "recharge" },
      { kind: "rig" },
      ...s.rigs.filter((r) => r.player === player).flatMap((r) => r.cards.map((card) => ({ kind: "rigPick", card }))),
    ]) {
      out.push({ type: "useAbility", player, ability });
    }
    out.push({ type: "postAlibi", player, room });
    out.push({ type: "proposeMeeting", player, slot: `slot-${s.log.length}` });
    for (const proposal of s.proposals) out.push({ type: "acceptMeeting", player, proposalId: proposal.id });
    out.push({ type: "callEmergency", player });
    for (const type of ["castVote", "sealVote"]) {
      out.push({ type, player, vote: { kind: "shakedown", target: other(player) } });
      out.push({ type, player, vote: { kind: "skip" } });
    }
    out.push({ type: "answerDoubleCross", player, accept: true });
    out.push({ type: "callOut", player });
  }
  const meetingIds = [s.scheduledMeeting?.meetingId, s.pendingEmergency?.meetingId, s.meeting?.id, s.pendingShakedown?.meetingId];
  out.push({ type: "advance", deadline: { kind: "round", round: s.round } });
  out.push({ type: "advance", deadline: { kind: "alibis", round: s.resolvedRound } });
  for (const kind of ["openMeeting", "closeMeeting", "resolveShakedown"]) {
    for (const meetingId of meetingIds) if (meetingId) out.push({ type: "advance", deadline: { kind, meetingId } });
  }
  out.push({ type: "scheduleMeeting", act: actOfRound(s.round), slot: "server-slot" });
  return out;
}

// ---------------------------------------------------------------- hostile values

/** Fields whose strings are free text the engine only stores and compares (`slot`, design §11.1): any string is fine there. */
const FREE_TEXT = new Set(["slot"]);

const OF_ANOTHER_TYPE: readonly unknown[] = [
  JSON.parse('{"toString":null}'),
  JSON.parse('{"toString":null,"valueOf":null}'),
  JSON.parse('{"__proto__":{"toString":null}}'),
  Object.create(null),
  {},
  [],
  [JSON.parse('{"toString":null}')],
  null,
  -1,
  1.5,
  Number.NaN,
  true,
  "__proto__",
];
const PROTOTYPE_KEYS: readonly string[] = ["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", ""];

/** The hostile values to try in place of `value` at `field`. */
function hostileFor(field: string, value: unknown): unknown[] {
  const others = OF_ANOTHER_TYPE.filter((h) => typeof h !== typeof value);
  return typeof value === "string" && !FREE_TEXT.has(field) ? [...others, ...PROTOTYPE_KEYS] : others;
}

type Path = readonly (string | number)[];

/** Every leaf of a command except its `type`. */
function leaves(value: unknown, path: Path = []): Path[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, [...path, i]));
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([k, v]) => (path.length === 0 && k === "type" ? [] : leaves(v, [...path, k])));
  return [path];
}

function withValue(command: Record<string, unknown>, path: Path, value: unknown): unknown {
  const copy = structuredClone(command);
  let at: Record<string | number, unknown> = copy;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string | number, unknown>;
  at[path[path.length - 1] as string | number] = value;
  return copy;
}

const get = (command: unknown, path: Path): unknown => path.reduce<unknown>((v, k) => (v as Record<string | number, unknown>)[k], command);

/** The command type and the kind it names (ability, vote, deadline), plus the field: what coverage is counted by. */
function fieldKey(command: Record<string, unknown>, path: Path): string {
  const kinded = (command.move as { ability?: { kind: string } } | undefined)?.ability ?? command.ability ?? command.vote ?? command.deadline;
  const kind = (kinded as { kind?: unknown } | undefined)?.kind;
  return `${String(command.type)}${typeof kind === "string" ? `(${kind})` : ""}.${path.join(".")}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

const describeValue = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return "(unprintable)";
  }
};

describe("hostile command values are refused, never thrown — design §17.2", () => {
  it("every field of every command type, with every hostile value, against every phase", () => {
    const tried = new Set<string>();
    const covered = new Set<string>();
    const failures: string[] = [];
    let attempts = 0;
    for (const state of scenarioStates().map(deepFreeze)) {
      const before = JSON.stringify(state);
      for (const base of baseCommands(state)) {
        const accepted = handleCommand(state, base).ok;
        for (const path of leaves(base)) {
          const key = fieldKey(base, path);
          tried.add(key);
          if (accepted) covered.add(key);
          for (const hostile of hostileFor(String(path[path.length - 1]), get(base, path))) {
            attempts++;
            const command = withValue(base, path, hostile);
            const where = `${key} = ${describeValue(hostile)} in phase ${state.phase.kind}`;
            try {
              const r = handleCommand(state, command);
              if (r.ok) failures.push(`accepted: ${where}`);
              else if (typeof r.reason !== "string" || r.reason === "") failures.push(`no reason: ${where}`);
            } catch (err) {
              failures.push(`threw ${err instanceof Error ? err.message : "?"}: ${where}`);
            }
          }
        }
      }
      // States are deep-frozen, so a mutation would have thrown above; this catches anything else.
      expect(JSON.stringify(state)).toBe(before);
    }
    expect(failures).toEqual([]);
    // Every field was mutated starting from a command that was accepted at least once.
    expect([...tried].filter((k) => !covered.has(k)).sort()).toEqual([]);
    expect(tried.size).toBeGreaterThan(40);
    expect(attempts).toBeGreaterThan(10_000);
  });
});
