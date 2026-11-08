// Hostile command values: every field of every command type (nested objects
// and lists as well as their leaves), replaced by values a JSON client can
// build to trip up lookups and reason strings — objects with no string form
// ({"toString":null}), prototype keys ("__proto__", "constructor", …), values
// of the wrong type, over-long strings, or left out. Each must be refused, never
// thrown, and leave the state as it was. design §17.2 (commands arrive as
// untrusted JSON; bad input is a rejection).
//
// Every mutation starts from a command the engine *accepts* in that state, so
// the hostile value is what gets it refused; the coverage check at the end
// makes sure every field was tried that way at least once.
import { describe, expect, it } from "vitest";
import { MAX_SLOT_LENGTH, type PerkId } from "@skimjob/content";
import { privateTo, type GameConfig, type GameEvent, type GameState, type PlayerState } from "./types";
import { setupEvents } from "./setup";
import { applyEvent, replay } from "./reduce";
import { COMMAND_TYPES, handleCommand } from "./handle";
import { powerOf } from "./overrides";
import { grantPerks } from "./perks.testkit";
import { show } from "./check";
import { fullGrab } from "./grab.testkit";

// ---------------------------------------------------------------- states

/** Every perk spent with `useAbility` (the Shield spends itself). design §8.3 */
const ALL_PERKS: readonly PerkId[] = ["peek", "extraVote", "ballot", "tail", "alibi", "recharge", "rig"];

const ROLES_BY_SEAT = ["lookout", "fixer", "hacker", "locksmith", "smoothTalker", "auditor", "detective", "mole", "priest", "electrician", "lookout", "lookout"];

function config(extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "hostile-seed",
    players: ROLES_BY_SEAT.map((_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
    job: "bank",
    // The role list may name roles nobody holds.
    roleList: "possible",
    eventsEnabled: true,
    // Secret mode, so the Ballot perk can be spent (it's refused in Open mode).
    voteVisibility: "secret",
    ...extra,
  };
}

/** A new game with seat i dealt roles[i]. */
function game(cfg: GameConfig, roles: readonly string[]): GameState {
  const log = setupEvents(cfg).map((e, i, all): GameEvent => {
    if (e.type !== "roleDealt") return e;
    const seat = all.slice(0, i).filter((x) => x.type === "roleDealt").length;
    return { ...e, role: roles[seat] ?? "lookout" };
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

const mv = (player: string, room: string) => ({ type: "submitMove", player, move: fullGrab(room) });
const round = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const alibis = (s: GameState) => ({ type: "advance", deadline: { kind: "alibis", round: s.resolvedRound } });

/** States across the phases where each command can be accepted. */
function scenarioStates(): GameState[] {
  const out: GameState[] = [];
  const keep = (s: GameState): GameState => (out.push(s), s);
  let s = game(config(), ROLES_BY_SEAT);
  for (const id of s.playerOrder) {
    s = grantPerks(s, id, ...ALL_PERKS, ...ALL_PERKS);
    // Tokens to buy from the shop. extension.md "Tokens and the perk shop"
    for (let i = 0; i < 4; i++) s = applyEvent(s, { type: "tokenEarned", visibility: privateTo(id), player: id, trigger: "watchedShakenDirty" });
  }
  keep(s); // planning round 1
  s = keep(run(s, { type: "useAbility", player: "p8", ability: { kind: "rig" } })); // the Rig's pick is open
  s = keep(run(s, ...s.playerOrder.map((id) => mv(id, "lobby"))));
  s = keep(run(s, { type: "proposeMeeting", player: "p0", slot: "slot-a" }));
  s = keep(run(s, round(s))); // alibis for round 1
  s = keep(run(s, { type: "postAlibi", player: "p8", room: "lobby" })); // a true alibi, for the Alibi perk
  s = keep(run(s, { type: "useAbility", player: "p5", ability: { kind: "audit", room: "lobby" } })); // a power used, for the Recharge perk
  s = keep(run(s, alibis(s))); // the result window after round 1 (design §9.3)
  expect(s.phase.kind).toBe("result");
  s = keep(run(s, { type: "callEmergency", player: "p1" })); // waiting to open
  s = keep(run(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-1" } })); // voting
  s = run(s, ...["p0", "p1", "p2", "p3", "p4", "p5", "p6"].map((id) => ({ type: "castVote", player: id, vote: { kind: "shakedown", target: "p8" } })));
  s = keep(run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-1" } })); // the shakedown window
  expect(s.phase.kind).toBe("shakedownPending");
  s = keep(run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "emergency-1" } })); // planning round 2
  // Round 2: everyone in the Vault rings it past its last bulb: the raid calls a police briefing (design §9.2).
  s = run(s, ...s.playerOrder.map((id) => mv(id, "vault")), round(s));
  s = keep(run(s, alibis(s)));
  expect(s.phase.kind).toBe("awaitingMeeting");
  s = keep(run(s, (s.phase.kind === "awaitingMeeting" ? { type: "scheduleMeeting", meetingId: s.phase.meetingId, slot: "server" } : null)));
  // A Lockdown card forged onto planning (design §10).
  const planning = out[2] as GameState;
  keep({ ...planning, card: { round: planning.round, id: "lockdown", room: "vault" } });
  // A raided Office, taped off, forged onto planning: the Fixer's reopen (design §5.3).
  const { office: _off, ...bells } = planning.bells;
  keep({ ...planning, bells, taped: { office: planning.round + 1 } });
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
    if (s.rooms.includes("security")) out.push({ type: "submitMove", player, move: { ...fullGrab("security"), watch: room } });
    const kind = powerOf(s.config, p.role)?.kind;
    const ability =
      kind === "lookout"
        ? { kind: "lookout", rooms: [room] }
        : kind === "hide" || kind === "blackout" || kind === "ring"
          ? { kind, room }
          : kind === "absolve"
            ? { kind, target: other(player) }
            : kind === "reopen"
              ? { kind: "reopen", room: Object.keys(s.taped)[0] ?? room }
              : null;
    if (ability) out.push({ type: "submitMove", player, move: { ...fullGrab(room), ability } });
    // Powers used outside a move. design §11.1
    if (kind === "audit") out.push({ type: "useAbility", player, ability: { kind: "audit", room } });
    if (kind === "detect") out.push({ type: "useAbility", player, ability: { kind: "detect", target: other(player) } });
    // Perks. extension.md "Tokens and the perk shop"
    for (const perk of s.shop) out.push({ type: "buyPerk", player, perk });
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
    out.push({ type: "claimRole", player, role: "lookout" }); // design §8, §12.1
    out.push({ type: "proposeMeeting", player, slot: `slot-${s.log.length}` });
    for (const proposal of s.proposals) out.push({ type: "acceptMeeting", player, proposalId: proposal.id });
    out.push({ type: "callEmergency", player });
    for (const type of ["castVote", "sealVote"]) {
      out.push({ type, player, vote: { kind: "shakedown", target: other(player) } });
      out.push({ type, player, vote: { kind: "skip" } });
    }
  }
  const meetingIds = [s.scheduledMeeting?.meetingId, s.pendingEmergency?.meetingId, s.meeting?.id, s.pendingShakedown?.meetingId];
  out.push({ type: "advance", deadline: { kind: "round", round: s.round } });
  out.push({ type: "advance", deadline: { kind: "alibis", round: s.resolvedRound } });
  out.push({ type: "advance", deadline: { kind: "result", round: s.resolvedRound } });
  for (const kind of ["openMeeting", "closeMeeting", "resolveShakedown"]) {
    for (const meetingId of meetingIds) if (meetingId) out.push({ type: "advance", deadline: { kind, meetingId } });
  }
  if (s.phase.kind === "awaitingMeeting") out.push({ type: "scheduleMeeting", meetingId: s.phase.meetingId, slot: "server-slot" });
  return out;
}

// ---------------------------------------------------------------- hostile values

/** Fields whose strings are free text the engine only stores and compares (`slot`, design §9.4): any short string is fine there. */
const FREE_TEXT = new Set(["slot"]);
/** Fields a command may leave out (a move without a power). */
const OPTIONAL = new Set(["move.ability"]);
/** Stands for "the field is left out". */
const ABSENT = Symbol("absent");

const NO_STRING_FORM = JSON.parse('{"toString":null}') as unknown;
/** Hostile values of every JSON type; each is tried wherever the field holds another type, and all of them in place of objects and lists. */
const HOSTILE_VALUES: readonly unknown[] = [
  NO_STRING_FORM,
  JSON.parse('{"toString":null,"valueOf":null}'),
  JSON.parse('{"__proto__":{"toString":null}}'),
  Object.create(null),
  {},
  [],
  [NO_STRING_FORM],
  null,
  -1,
  1.5,
  Number.NaN,
  true,
  "__proto__",
];
const PROTOTYPE_KEYS: readonly string[] = ["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "", "x".repeat(12_000)];

type Path = readonly (string | number)[];

const isContainer = (v: unknown): boolean => typeof v === "object" && v !== null;

/** The hostile values to try in place of `value` at `path`. */
function hostileFor(path: Path, value: unknown): unknown[] {
  const field = path.filter((k) => typeof k === "string").join(".");
  // A list item can't be left out in JSON (no holes), so only object fields are.
  const missing = OPTIONAL.has(field) ? [] : typeof path[path.length - 1] === "number" ? [undefined] : [ABSENT, undefined];
  // Objects and lists are replaced by every hostile value, objects with no string form included.
  if (isContainer(value)) return [...HOSTILE_VALUES, ...missing];
  const others = HOSTILE_VALUES.filter((h) => typeof h !== typeof value);
  if (typeof value !== "string") return [...others, ...missing];
  // design §17.2: free text is capped (content), so an over-long slot is refused too.
  const extra = FREE_TEXT.has(field) ? ["x".repeat(MAX_SLOT_LENGTH + 1)] : PROTOTYPE_KEYS;
  return [...others, ...extra, ...missing];
}

/** Every field of a command, nested objects and lists as well as their leaves, except its `type`. */
function fields(value: unknown, path: Path = []): Path[] {
  const self = path.length > 0 ? [path] : [];
  if (Array.isArray(value)) return [...self, ...value.flatMap((v, i) => fields(v, [...path, i]))];
  if (isContainer(value)) {
    return [...self, ...Object.entries(value as object).flatMap(([k, v]) => (path.length === 0 && k === "type" ? [] : fields(v, [...path, k])))];
  }
  return self;
}

function withValue(command: Record<string, unknown>, path: Path, value: unknown): unknown {
  const copy = structuredClone(command);
  let at: Record<string | number, unknown> = copy;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string | number, unknown>;
  const last = path[path.length - 1] as string | number;
  if (value === ABSENT) delete at[last];
  else at[last] = value;
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
  if (v === ABSENT) return "(left out)";
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return "(unprintable)";
  }
};

describe("hostile command values are refused, never thrown — design §17.2", () => {
  it("every field of every command type, with every hostile value, against every phase", () => {
    const tried = new Set<string>();
    const types = new Set<string>();
    const covered = new Set<string>();
    const failures: string[] = [];
    let attempts = 0;
    for (const state of scenarioStates().map(deepFreeze)) {
      const before = JSON.stringify(state);
      for (const base of baseCommands(state)) {
        const accepted = handleCommand(state, base).ok;
        types.add(base.type as string);
        for (const path of fields(base)) {
          const key = fieldKey(base, path);
          tried.add(key);
          if (accepted) covered.add(key);
          for (const hostile of hostileFor(path, get(base, path))) {
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
    // Every command type the engine handles is in baseCommands.
    expect([...types].sort()).toEqual([...COMMAND_TYPES].sort());
    expect(tried.size).toBeGreaterThan(40);
    expect(attempts).toBeGreaterThan(10_000);
  }, 60_000);

  it("show() prints any command value without throwing, and cuts long strings short", () => {
    expect([NO_STRING_FORM, Object.create(null), [NO_STRING_FORM], null, undefined, 3, true].map(show)).toEqual([
      "(an object)",
      "(an object)",
      "(a list)",
      "null",
      "undefined",
      "3",
      "true",
    ]);
    expect(show("p1")).toBe("p1");
    expect(show("x".repeat(12_000))).toBe(`${"x".repeat(40)}…`);
  });
});
