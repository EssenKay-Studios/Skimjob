// QA (PR #8): counterfactual leak tests for viewFor. design §13, §17.2, §11.2
//
// Two games run side by side from the same seed and the same commands, except
// that one or two players make different hidden choices in game B (split, room,
// watch, Fence safe, missed move, move churn, ballots, sealed votes). After every
// step, every other player's view must be byte-identical in both games — lengths,
// seq numbers, ids and order included — until the rules make a difference public
// (a shakedown of an involved player, the ballots at close or as cast, the end).
// Swapping two players' roles is checked the same way.
// The first public difference must be one of those; anything else is a leak.
import { STARTER_ROLES } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState, PlayerId, PlayerState, PlayerView, VoteVisibility } from "./types";
import { createGame } from "./setup";
import { handleCommand } from "./handle";
import { eventsSince, viewFor } from "./view";

type Cmd = Record<string, unknown>;
type Kind = "role" | "split" | "swap" | "fence" | "watch" | "miss" | "churn" | "voteChurn" | "ballotSwap" | "seal" | "control";
const MODES: readonly VoteVisibility[] = ["hiddenThenRevealed", "open", "secret"];
const LOOT: Record<string, number> = { vault: 6, office: 4, lobby: 2, depositBoxes: 5, tellerLine: 3, managersOffice: 4 };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const config = (n: number, voteVisibility: VoteVisibility, seed: string): GameConfig => ({
  seed,
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: i % 2 === 0 })),
  job: "bank",
  rolePool: [...STARTER_ROLES], // no Muscle, so no shakedown window (task 12)
  mole: "off",
  eventsEnabled: false,
  voteVisibility,
  starterMode: false,
});

function apply(s: GameState, c: Cmd, game: string): GameState {
  const r = handleCommand(s, c);
  if (!r.ok) throw new Error(`game ${game} rejected ${JSON.stringify(c)}: ${r.reason}`);
  return r.state;
}

const seen = (v: PlayerView): number => v.ledger.length + v.caseFile.length;

interface Pair {
  readonly a: GameState;
  readonly applied: boolean;
  readonly diverged: GameEvent | null;
  readonly effective: boolean;
  readonly compared: number;
}

/**
 * Plays a random game (seeded) in A and B. At the first chance from a random
 * round on, B gets the `kind` change. Throws on a leak.
 */
function runPair(kind: Kind, n: number, mode: VoteVisibility, seed: number): Pair {
  const rand = mulberry32(seed);
  const int = (k: number): number => Math.floor(rand() * k);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)] as T;
  let A = createGame(config(n, mode, `qa-${seed}`));
  let B = A;
  const ids = A.playerOrder;
  const involved = new Set<PlayerId>();
  const tainted = new Set<PlayerId>();
  const start = 1 + int(7);
  let applied = false;
  let diverged: GameEvent | null = null;
  let effective = false;
  let compared = 0;
  const lastSeen = new Map<PlayerId, number>(ids.map((id) => [id, 0]));
  const strict = mode === "secret" && (kind === "voteChurn" || kind === "ballotSwap" || kind === "seal");
  const allowed = (e: GameEvent | undefined): boolean => {
    if (!e) return false;
    if (e.type === "gameEnded") return kind !== "control" && !strict;
    if (e.type === "shakedownResolved") return ["split", "swap", "fence"].includes(kind) && involved.has(e.target);
    if (e.type === "voteCast") return mode === "open" && involved.has(e.player);
    if (e.type === "meetingClosed") return mode === "hiddenThenRevealed" && kind === "ballotSwap";
    return false;
  };
  const over = (): boolean => A.phase.kind === "ended";

  // "role": two players' secret roles are swapped in B (design §8). Their moves stay valid under both.
  const restricted = new Set<PlayerId>();
  const pairs = ids.flatMap((x) => ids.filter((z) => A.players[z]?.role !== A.players[x]?.role).map((z) => [x, z] as const));
  if (kind === "role" && pairs.length > 0) {
    const [x, z] = pick(pairs);
    const [px, pz] = [A.players[x], A.players[z]] as [PlayerState, PlayerState];
    applied = true;
    involved.add(x).add(z);
    restricted.add(x).add(z);
    B = {
      ...A,
      players: { ...A.players, [x]: { ...px, role: pz.role }, [z]: { ...pz, role: px.role } },
      log: A.log.map((e) => (e.type === "roleDealt" && (e.player === x || e.player === z) ? { ...e, role: e.player === x ? pz.role : px.role } : e)),
    };
  }
  const noPocket = [...restricted].some((id) => A.players[id]?.role === "insider");

  const compare = (): void => {
    const end = over();
    for (const x of involved) effective ||= JSON.stringify(viewFor(A, x)) !== JSON.stringify(viewFor(B, x));
    for (const y of ids) {
      if (involved.has(y) || tainted.has(y)) continue;
      const va = viewFor(A, y);
      const vb = viewFor(B, y);
      const from = (lastSeen.get(y) as number) - 1;
      const key = (v: PlayerView): string =>
        JSON.stringify({ ...v, ledger: v.ledger.length, caseFile: v.caseFile.length, recent: eventsSince(v, from), reveal: end && !strict ? null : v.reveal });
      lastSeen.set(y, seen(va));
      if (key(va) === key(vb) && (!end || JSON.stringify({ ...va, reveal: null }) === JSON.stringify({ ...vb, reveal: null }))) {
        compared++;
        continue;
      }
      const i = va.ledger.findIndex((e, k) => JSON.stringify(e) !== JSON.stringify(vb.ledger[k]));
      const at = i === -1 && vb.ledger.length > va.ledger.length ? va.ledger.length : i;
      const first = [va.ledger[at]?.event, vb.ledger[at]?.event].filter((e) => e !== undefined);
      if (at === -1 || !first.some(allowed)) {
        const what = at === -1 ? "same ledger, different view" : `A ${JSON.stringify(first[0] ?? null)} vs B ${JSON.stringify(first[1] ?? null)}`;
        throw new Error(`leak (${kind}, ${n}p, ${mode}, seed ${seed}) to ${y} [involved ${[...involved]}]: ${what}`);
      }
      diverged = first[0] ?? null;
      return;
    }
  };
  /** One step: A gets `a`, B gets `b`; then every view is compared. */
  const step = (a: readonly Cmd[], b: readonly Cmd[] = a): void => {
    if (over()) return;
    for (const c of a) if (!over()) A = apply(A, c, "A");
    if (diverged) return;
    for (const c of b) if (B.phase.kind !== "ended") B = apply(B, c, "B");
    compare();
  };

  const randomMove = (id: PlayerId, round: number): Cmd => {
    const role = A.players[id]?.role;
    const room = pick(A.rooms);
    const loot = LOOT[room] ?? 0;
    const keep = role !== "insider" && !(noPocket && restricted.has(id));
    const move: Cmd = { room, pocket: keep && loot > 0 && rand() < 0.5 ? int(loot + 1) : 0 };
    if (room === "security") move.watch = pick(A.rooms);
    if (restricted.has(id)) return move;
    if (role === "lookout" && rand() < 0.8) move.ability = { kind: "lookout", rooms: [pick(A.rooms)] };
    // The safe only in an act's first round, so a changed amount in B is never refused later.
    if (role === "fence" && round % 3 === 1 && rand() < 0.7) move.ability = { kind: "fenceSafe", amount: 1 + int(5) };
    return move;
  };
  const submit = (player: PlayerId, move: Cmd): Cmd => ({ type: "submitMove", player, move });
  const randomVote = (id: PlayerId, target: PlayerId): Cmd => {
    const t = rand() < 0.65 ? target : pick(ids);
    return t === id || rand() < 0.15 ? { kind: "skip" } : { kind: "shakedown", target: t };
  };
  const roleHolder = (role: string): PlayerId | undefined => ids.find((id) => A.players[id]?.role === role);
  const canPocket = (id: PlayerId): boolean => A.players[id]?.role !== "insider";
  const due = (round: number): boolean => !applied && round >= start;

  function planRound(round: number): void {
    const plan = new Map<PlayerId, Cmd[]>();
    for (const id of ids) {
      if (rand() < 0.1) plan.set(id, []); // misses the deadline
      else plan.set(id, [...(rand() < 0.15 ? [submit(id, randomMove(id, round))] : []), submit(id, randomMove(id, round))]);
    }
    const planB = new Map(plan);
    const last = (id: PlayerId): Cmd => ((plan.get(id) ?? []).at(-1)?.move as Cmd | undefined) ?? { room: "lobby", pocket: 0 };
    const pair = (): [PlayerId, PlayerId] | null => {
      const ok = ids.filter(canPocket);
      if (ok.length < 2) return null;
      const x = pick(ok);
      return [x, pick(ok.filter((id) => id !== x))];
    };

    if (due(round)) {
      if (kind === "split" || kind === "control") {
        const p = pair();
        if (p) {
          const [x, z] = p;
          applied = true;
          (kind === "split" ? [x, z] : [x]).forEach((id) => involved.add(id));
          // design §5.3: same Haul, same pocket count, same room — only the two stashes differ.
          const keep = (id: PlayerId, pocket: number, room = "office"): Cmd => submit(id, { ...last(id), room, pocket, watch: undefined });
          plan.set(x, [keep(x, 1)]);
          plan.set(z, [keep(z, 2)]);
          planB.set(x, [kind === "split" ? keep(x, 2) : keep(x, 1, "lobby")]);
          planB.set(z, [kind === "split" ? keep(z, 1) : keep(z, 2)]);
        }
      } else if (kind === "swap") {
        const p = pair();
        const [x, z] = p ?? [];
        const bare = (m: Cmd): string => JSON.stringify({ ...m, ability: undefined });
        if (x && z && bare(last(x)) !== bare(last(z))) {
          applied = true;
          involved.add(x).add(z);
          const mx = last(x);
          const mz = last(z);
          const { ability: ax } = mx;
          const { ability: az } = mz;
          planB.set(x, [submit(x, { ...mz, ability: ax })]);
          planB.set(z, [submit(z, { ...mx, ability: az })]);
          // Rules let anyone in, watching, or looking out at either room see the swap.
          const rooms = new Set([mx.room, mz.room]);
          for (const y of ids) {
            const m = last(y);
            const looked = (m.ability as { rooms?: string[] } | undefined)?.rooms ?? [];
            if (rooms.has(m.room) || rooms.has(m.watch) || looked.some((r) => rooms.has(r))) tainted.add(y);
          }
        }
      } else if (kind === "fence") {
        const f = roleHolder("fence");
        if (f && round % 3 === 1) {
          applied = true;
          involved.add(f);
          const m = { ...last(f), room: "office", pocket: 4, watch: undefined };
          plan.set(f, [submit(f, { ...m, ability: undefined })]);
          planB.set(f, [submit(f, { ...m, ability: { kind: "fenceSafe", amount: 1 + int(4) } })]);
        }
      } else if (kind === "watch") {
        const x = pick(ids);
        const [r1, r2] = [pick(A.rooms), pick(A.rooms)];
        if (r1 !== r2) {
          applied = true;
          involved.add(x);
          const isLookout = A.players[x]?.role === "lookout";
          const m = (watch: string, look: string): Cmd => ({
            room: "security",
            pocket: 0,
            watch,
            ...(isLookout ? { ability: { kind: "lookout", rooms: [look] } } : {}),
          });
          plan.set(x, [submit(x, m(r1, r2))]);
          planB.set(x, [submit(x, m(r2, r1))]);
        }
      } else if (kind === "miss") {
        const x = pick(ids);
        applied = true;
        involved.add(x);
        plan.set(x, []);
        planB.set(x, [submit(x, { room: "lobby", pocket: 0 })]); // exactly the default move (§5.1)
      } else if (kind === "churn") {
        const x = pick(ids);
        applied = true;
        involved.add(x);
        const final = plan.get(x)?.at(-1) ?? submit(x, { room: "lobby", pocket: 0 });
        plan.set(x, [final]);
        planB.set(x, [submit(x, randomMove(x, round)), submit(x, randomMove(x, round)), final]);
      }
    }
    for (const id of ids) step(plan.get(id) ?? [], planB.get(id) ?? []);
  }

  function meeting(open: Cmd): void {
    const target = pick(ids);
    const seals = new Map<PlayerId, Cmd[]>();
    const ballots = new Map<PlayerId, Cmd[]>();
    for (const id of ids) {
      if (rand() < 0.2) seals.set(id, [{ type: "sealVote", player: id, vote: randomVote(id, target) }]);
      const r = rand();
      if (r < 0.2) continue; // stays away
      const votes: Cmd[] = [{ type: "castVote", player: id, vote: randomVote(id, target) }];
      if (r > 0.85) votes.unshift({ type: "castVote", player: id, vote: randomVote(id, target) });
      ballots.set(id, votes);
    }
    const sealsB = new Map(seals);
    const ballotsB = new Map(ballots);
    const lastVote = (id: PlayerId): Cmd | undefined => ballots.get(id)?.at(-1)?.vote as Cmd | undefined;
    if (due(A.round)) {
      const voters = ids.filter((id) => lastVote(id));
      if (kind === "voteChurn" && voters.length > 0) {
        const x = pick(voters);
        applied = true;
        involved.add(x);
        const final = ballots.get(x)?.at(-1) as Cmd;
        ballots.set(x, [final]);
        ballotsB.set(x, [...[1, 2].map((): Cmd => ({ type: "castVote", player: x, vote: randomVote(x, target) })), final]);
      } else if (kind === "ballotSwap") {
        const pairs = voters.flatMap((x) => voters.map((z) => [x, z] as const));
        const ok = pairs.filter(([x, z]) => {
          const vx = lastVote(x) as Cmd;
          const vz = lastVote(z) as Cmd;
          return x !== z && JSON.stringify(vx) !== JSON.stringify(vz) && vx.target !== z && vz.target !== x;
        });
        if (ok.length > 0) {
          const [x, z] = pick(ok);
          applied = true;
          involved.add(x).add(z);
          ballotsB.set(x, [{ type: "castVote", player: x, vote: lastVote(z) }]);
          ballotsB.set(z, [{ type: "castVote", player: z, vote: lastVote(x) }]);
        }
      } else if (kind === "seal") {
        const free = voters.filter((id) => !seals.has(id) && A.players[id]?.sealedVote === null);
        if (free.length > 0) {
          const x = pick(free);
          applied = true;
          involved.add(x);
          // A votes live; B leaves the same ballot sealed and stays away (§11.2).
          sealsB.set(x, [{ type: "sealVote", player: x, vote: lastVote(x) }]);
          ballots.set(x, ballots.get(x)?.slice(-1) ?? []);
          ballotsB.set(x, []);
        }
      }
    }
    for (const id of ids) step(seals.get(id) ?? [], sealsB.get(id) ?? []);
    step([open]);
    for (const id of ids) step(ballots.get(id) ?? [], ballotsB.get(id) ?? []);
    step([{ type: "advance", deadline: { kind: "closeMeeting", meetingId: A.meeting?.id } }]);
  }

  for (let round = 1; round <= 9 && !over(); round++) {
    const act = Math.ceil(round / 3);
    const caller = ids.find((id) => !A.players[id]?.emergencyMeetingUsed);
    if (caller && rand() < 0.2) {
      step([{ type: "callEmergency", player: caller }]);
      meeting({ type: "advance", deadline: { kind: "openMeeting", meetingId: `emergency-${caller}` } });
      if (over()) break;
    }
    planRound(round);
    step([{ type: "advance", deadline: { kind: "round", round } }]);
    for (const id of ids) if (!over() && rand() < 0.7) step([{ type: "postAlibi", player: id, room: pick(A.rooms) }]);
    if (!over()) step([{ type: "advance", deadline: { kind: "alibis", round } }]); // design §5.4
    if (round % 3 === 0 && !over()) {
      if (rand() < 0.5) {
        step([{ type: "proposeMeeting", player: pick(ids), slot: `slot-${act}` }]);
        const proposal = A.proposals[0];
        for (const id of ids) if (proposal && !A.scheduledMeeting && !proposal.acceptedBy.includes(id)) step([{ type: "acceptMeeting", player: id, proposalId: proposal.id }]);
      }
      if (!A.scheduledMeeting) step([{ type: "scheduleMeeting", act, slot: `server-${act}` }]);
      meeting({ type: "advance", deadline: { kind: "openMeeting", meetingId: A.scheduledMeeting?.meetingId } });
    }
  }
  expect(over(), "the random game finishes").toBe(true);
  if (!diverged) compare(); // final full check at the end of the game
  return { a: A, applied, diverged, effective, compared };
}

const KINDS: readonly Kind[] = ["role", "split", "swap", "fence", "watch", "miss", "churn", "voteChurn", "ballotSwap", "seal"];
const COUNTS = [2, 3, 4, 6, 9, 12];
/** Seeds per player count; raise locally (QA_SEEDS=20) for a wider sweep. */
const SEEDS = Number(process.env.QA_SEEDS ?? 1);

describe("QA: changing one player's hidden choices never changes another player's view — design §13, §17.2, §11.2", () => {
  it.each(KINDS.flatMap((k) => MODES.map((m) => [k, m] as const)))("%s, %s votes", (kind, mode) => {
    let applied = 0;
    let compared = 0;
    const firstPublic = new Set<string>();
    COUNTS.forEach((n, i) => {
      for (let s = 0; s < SEEDS; s++) {
        const r = runPair(kind, n, mode, 1000 * KINDS.indexOf(kind) + 100 * MODES.indexOf(mode) + 10 * i + s);
        if (!r.applied) continue;
        applied++;
        compared += r.compared;
        expect(r.effective, `${kind} ${n}p seed ${s}: the change reached the involved player's own view`).toBe(true);
        if (r.diverged) firstPublic.add(r.diverged.type);
      }
    });
    expect(applied, "the change was made in most games").toBeGreaterThanOrEqual((kind === "fence" ? 3 : 4) * SEEDS);
    expect(compared).toBeGreaterThan(200 * SEEDS);
    // design §11.2: in Secret mode ballots never surface, not even in the reveal.
    if (mode === "secret" && ["voteChurn", "ballotSwap", "seal"].includes(kind)) expect([...firstPublic]).toEqual([]);
    // Open mode: a changed ballot is public as cast, and the harness sees it.
    if (mode === "open" && ["voteChurn", "ballotSwap", "seal"].includes(kind)) expect(firstPublic).toContain("voteCast");
    if (mode === "hiddenThenRevealed" && kind === "ballotSwap") expect([...firstPublic]).toEqual(["meetingClosed"]);
  }, 60_000);

  it("control: the harness catches a real public difference (other room, Haul changes)", () => {
    expect(() => runPair("control", 5, "hiddenThenRevealed", 7)).toThrow(/leak \(control/);
  });
});

describe("QA: viewFor edges — design §13, §11.2", () => {
  const ended = (mode: VoteVisibility, seed: number): GameState => runPair("churn", 6, mode, seed).a;

  it("throws for anyone not seated, including prototype keys", () => {
    const game = createGame(config(6, "open", "unknown"));
    for (const id of ["p6", "", "P0", "__proto__", "constructor", "toString", "hasOwnProperty"]) expect(() => viewFor(game, id)).toThrow(/unknown player/);
  });

  it("works for seats named like Object.prototype members (__proto__ / constructor / prototype are refused at setup)", () => {
    const seats = (ids: string[]) => ({ ...config(3, "open", "proto"), players: ids.map((id) => ({ id, name: id, isBot: false })) });
    expect(() => createGame(seats(["__proto__", "constructor", "toString"]))).toThrow(/player ids/);
    const s = createGame(seats(["toString", "hasOwnProperty", "valueOf"]));
    for (const id of s.playerOrder) {
      const v = viewFor(s, id);
      expect([v.me.id, v.players.map((p) => p.id)]).toEqual([id, s.playerOrder.filter((p) => p !== id)]);
      expect(v.caseFile.map((e) => e.event.type)).toEqual(["roleDealt"]);
    }
  });

  it("after the game: reveal opens every role, split and move, never others' secret ballots", () => {
    for (const [state, secret] of [[ended("secret", 42), true], [ended("hiddenThenRevealed", 43), false]] as const) {
      expect(state.phase.kind).toBe("ended");
      const rounds = state.log.filter((e) => e.type === "roundResolved").length;
      for (const y of state.playerOrder) {
        const v = viewFor(state, y);
        const log = v.reveal?.log ?? [];
        expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i));
        const end = v.ledger.at(-1)?.event;
        expect(end?.type === "gameEnded" && v.reveal?.outcome).toEqual(end?.type === "gameEnded" && end.outcome);
        const types = (t: string) => log.filter((e) => e.event.type === t).map((e) => e.event);
        expect(types("roleDealt")).toHaveLength(state.playerOrder.length);
        expect(types("lootSplit")).toHaveLength(rounds * state.playerOrder.length);
        expect(types("moveSubmitted")).toEqual(state.log.filter((e) => e.type === "moveSubmitted"));
        const ballots = state.log.filter((e) => e.type === "voteCast" || e.type === "voteSealed");
        expect(ballots.length).toBeGreaterThan(0);
        const shown = log.map((e) => e.event).filter((e) => e.type === "voteCast" || e.type === "voteSealed");
        expect(shown).toEqual(secret ? ballots.filter((e) => e.player === y) : ballots);
        // The ledger and case file stay what they were during the game.
        expect(v.ledger.every((e) => e.event.visibility.kind === "public")).toBe(true);
        expect(v.caseFile.every((e) => "player" in e.event.visibility && e.event.visibility.player === y)).toBe(true);
      }
    }
  });

  it("eventsSince: cursors are stable all game, and the boundaries are exact", () => {
    let s = createGame(config(4, "hiddenThenRevealed", "since"));
    const prev = new Map<PlayerId, string[]>();
    const check = (): void => {
      for (const y of s.playerOrder) {
        const v = viewFor(s, y);
        const all = eventsSince(v, -1);
        const last = all.length - 1;
        expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i));
        const now = all.map((e) => JSON.stringify(e));
        const before = prev.get(y) ?? [];
        expect(now.slice(0, before.length)).toEqual(before); // old seqs keep their events
        expect(eventsSince(v, before.length - 1).map((e) => JSON.stringify(e))).toEqual(now.slice(before.length));
        expect(eventsSince(v, last)).toEqual([]);
        expect(eventsSince(v, last + 10)).toEqual([]);
        expect(eventsSince(v, -50)).toEqual(all);
        expect(eventsSince(v, 0).map((e) => e.seq)[0]).toBe(1);
        expect(eventsSince(v, 1.5).map((e) => e.seq)[0]).toBe(2);
        prev.set(y, now);
      }
    };
    check();
    for (let round = 1; round <= 9 && s.phase.kind !== "ended"; round++) {
      for (const id of s.playerOrder) s = apply(s, { type: "submitMove", player: id, move: { room: id === "p0" ? "rooftop" : "lobby", pocket: 0 } }, "A");
      check();
      s = apply(s, { type: "advance", deadline: { kind: "round", round } }, "A");
      check();
      if (s.phase.kind === "alibis") s = apply(s, { type: "advance", deadline: { kind: "alibis", round } }, "A");
      if (round % 3 === 0) {
        s = apply(s, { type: "scheduleMeeting", act: round / 3, slot: "x" }, "A");
        s = apply(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId } }, "A");
        s = apply(s, { type: "castVote", player: "p1", vote: { kind: "skip" } }, "A");
        check();
        s = apply(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } }, "A");
        check();
      }
    }
    expect(s.phase.kind).toBe("ended");
  });
});
