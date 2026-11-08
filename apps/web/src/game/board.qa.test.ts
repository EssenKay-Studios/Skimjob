// QA (PR #41): the bank board must be a function of the viewer's own view only.
// Hidden-information leaks, every phase of a whole game, 2 / 3 / 12 seats,
// Lockdown from a real card flip, and determinism. design §5, §5.4, §6, §10, §18
import {
  handleCommand,
  viewFor,
  type GameConfig,
  type GameState,
  type PlayerCommand,
  type PlayerId,
  type PlayerView,
  type RoomId,
  type SystemCommand,
} from "@skimjob/engine";
import { createGame } from "./deal.testkit";
import { describe, expect, it } from "vitest";
import { boardScene, seatLooks } from "./board";
import { BANK_JOB } from "@skimjob/content";

const config = (n: number, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "board-qa",
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: i === 0 ? "Ana" : `Bot · B${i}`, isBot: i > 0 })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  ...extra,
});

function step(state: GameState, c: PlayerCommand | SystemCommand): GameState {
  const r = handleCommand(state, c);
  if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
  return r.state;
}
const move = (player: string, room: string): PlayerCommand => ({ type: "submitMove", player, move: { room, duffel: BANK_JOB.rooms[room]?.coins ?? 0, pocket: 0 } }) as PlayerCommand;
const ids = (s: GameState): PlayerId[] => Object.keys(s.players);

const figures = (scene: ReturnType<typeof boardScene>) =>
  Object.entries(scene.occupants)
    .flatMap(([room, list]) => list.map((o) => `${o.id}@${room}${o.ghost ? "?" : o.camera ? "~cam" : ""}`))
    .sort();

/** Every non-ghost figure other than you is backed by your own roomSighting / roomWatched for the board's round. */
function backed(v: PlayerView): void {
  const scene = boardScene(v);
  const ok = new Set<string>();
  for (const { event: e } of v.caseFile) {
    if (e.type === "roomSighting" && e.player === v.me.id && e.round === scene.round) for (const o of e.others) ok.add(`${o}@${e.room}`);
    if (e.type === "roomWatched" && e.player === v.me.id && e.round === scene.round) for (const o of e.seen) ok.add(`${o}@${e.room}`);
  }
  for (const [room, list] of Object.entries(scene.occupants))
    for (const o of list) {
      if (o.id === v.me.id) continue;
      if (o.ghost) {
        expect(v.ledger.some((x) => x.event.type === "alibiPosted" && x.event.player === o.id && x.event.room === room && x.event.round === scene.round), `ghost ${o.id}@${room}`).toBe(true);
      } else expect(ok.has(`${o.id}@${room}`), `${v.me.id} sees ${o.id}@${room} (round ${scene.round}, ${v.phase.kind})`).toBe(true);
    }
  if (scene.mode === "pick") expect(Object.values(scene.occupants).flat().every((o) => o.id === v.me.id)).toBe(true);
}

/** Play a whole game: everyone moves (a spread over the rooms), some alibis, meetings that skip. Returns every state. */
function playAll(cfg: GameConfig, max = 400, roles: readonly string[] = []): GameState[] {
  let s = createGame(cfg, roles);
  const states: GameState[] = [s];
  const push = (c: PlayerCommand | SystemCommand) => {
    s = step(s, c);
    states.push(s);
  };
  for (let guard = 0; guard < max && s.phase.kind !== "ended"; guard++) {
    const p = s.phase;
    if (p.kind === "planning") {
      const rooms = s.rooms.filter((r) => !(s.card?.round === p.round && s.card.room === r));
      ids(s).forEach((id, i) => {
        const room = rooms[(i + p.round) % rooms.length]!;
        const c = { type: "submitMove", player: id, move: { room, duffel: Math.max(0, (BANK_JOB.rooms[room]?.coins ?? 0) - (i % 2)), pocket: i % 2, ...(room === "security" ? { watch: rooms[0] } : {}) } } as PlayerCommand;
        const r = handleCommand(s, c);
        if (r.ok) {
          s = r.state;
          states.push(s);
        }
      });
      push({ type: "advance", deadline: { kind: "round", round: p.round } });
    } else if (p.kind === "alibis") {
      ids(s).forEach((id, i) => {
        if (i % 2) return;
        const r = handleCommand(s, { type: "postAlibi", player: id, room: s.rooms[i % s.rooms.length] } as PlayerCommand);
        if (r.ok) {
          s = r.state;
          states.push(s);
        }
      });
      push({ type: "advance", deadline: { kind: "alibis", round: p.round } });
    } else if (p.kind === "result") {
      push({ type: "advance", deadline: { kind: "result", round: p.round } });
    } else if (p.kind === "awaitingMeeting") {
      if (!s.scheduledMeeting) push({ type: "scheduleMeeting", meetingId: p.meetingId, slot: `qa-${p.meetingId}` });
      push({ type: "advance", deadline: { kind: "openMeeting", meetingId: p.meetingId } });
    } else if (p.kind === "meeting") {
      push({ type: "advance", deadline: { kind: "closeMeeting", meetingId: p.meetingId } });
    } else if (p.kind === "shakedownPending") {
      push({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: p.meetingId } });
    } else throw new Error(`unexpected phase ${p.kind}`);
  }
  expect(s.phase.kind).toBe("ended");
  return states;
}

describe("QA: board figures come only from the viewer's view (PR #41)", () => {
  for (const n of [3, 12]) {
    it(`whole game at ${n} seats: every figure on every board, every phase, is backed by your own view`, () => {
      const states = playAll(config(n), 400, n === 12 ? ["locksmith", "auditor", "lookout"] : []);
      const phases = new Set<string>();
      const kinds = new Set<string>();
      for (const s of states)
        for (const id of Object.keys(s.players)) {
          const v = viewFor(s, id);
          phases.add(v.phase.kind);
          backed(v);
          for (const o of Object.values(boardScene(v).occupants).flat()) if (o.id !== id) kinds.add(o.ghost ? "ghost" : o.camera ? "camera" : "here");
        }
      expect(phases.has("planning") && phases.has("alibis") && phases.has("ended")).toBe(true);
      // The game really drew others: room-mates and alibi ghosts (and, with a Security room in play, cameras).
      expect(kinds.has("here") && kinds.has("ghost")).toBe(true);
      if (n === 12) expect(kinds.has("camera")).toBe(true);
    });
  }

  it("at 12 seats the looks are 0..11 and the tags are unique for every viewer", () => {
    const s = createGame(config(12));
    for (const id of Object.keys(s.players)) {
      const looks = [...seatLooks(viewFor(s, id)).values()];
      expect(looks.map((l) => l.look)).toEqual([...Array(12).keys()]);
      expect(new Set(looks.map((l) => l.tag)).size).toBe(12);
    }
  });

  it("another player's hidden move never changes your board (3 seats, same view in, same board out)", () => {
    // p1 alone in the vault; p2 is in the lobby in one world, the office in the other. p1 never saw p2.
    const world = (p2Room: RoomId) =>
      step(step(step(step(createGame(config(3)), move("p1", "vault")), move("p2", p2Room)), move("p3", "lobby")), { type: "advance", deadline: { kind: "round", round: 1 } });
    const a = boardScene(viewFor(world("lobby"), "p1"));
    const b = boardScene(viewFor(world("office"), "p1"));
    expect(figures(a)).toEqual(["p1@vault"]);
    expect(b).toEqual(a);
    // And during planning: p2's locked move never shows.
    const planning = step(step(createGame(config(3)), move("p2", "vault")), move("p3", "vault"));
    expect(figures(boardScene(viewFor(planning, "p1")))).toEqual([]);
    expect(figures(boardScene(viewFor(planning, "p1"), "vault"))).toEqual(["p1@vault"]);
  });

  it("round 2 planning shows only your pick, not round 1's sightings or alibis", () => {
    let s = createGame(config(3));
    for (const id of ["p1", "p2", "p3"]) s = step(s, move(id, "vault"));
    s = step(s, { type: "advance", deadline: { kind: "round", round: 1 } });
    s = step(s, { type: "postAlibi", player: "p2", room: "office" } as PlayerCommand);
    expect(figures(boardScene(viewFor(s, "p1")))).toEqual(["p1@vault", "p2@office?", "p2@vault", "p3@vault"]);
    s = step(s, { type: "advance", deadline: { kind: "alibis", round: 1 } });
    // Three Vault grabs raid it: the police briefing (design §9.2), then the result window (§9.3).
    expect(s.phase).toMatchObject({ kind: "awaitingMeeting", meeting: "briefing", meetingId: "meeting-1" });
    s = step(s, { type: "scheduleMeeting", meetingId: "meeting-1", slot: "now" });
    s = step(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: "meeting-1" } });
    s = step(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "meeting-1" } });
    s = step(s, { type: "advance", deadline: { kind: "result", round: 1 } });
    const v = viewFor(s, "p1");
    expect(v.phase).toEqual({ kind: "planning", round: 2 });
    expect(boardScene(v)).toMatchObject({ round: 2, mode: "pick", selected: null });
    expect(figures(boardScene(v))).toEqual([]);
    expect(figures(boardScene(v, "lobby"))).toEqual(["p1@lobby"]);
  });

  it("same seed and commands give the same board for every viewer (determinism)", () => {
    const a = playAll(config(3));
    const b = playAll(config(3));
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 3)
      for (const id of ["p1", "p2", "p3"]) expect(boardScene(viewFor(b[i]!, id))).toEqual(boardScene(viewFor(a[i]!, id)));
  });
});

describe("QA: Lockdown on the board from a real card flip (design §10)", () => {
  // design §5.4: a raided room is taped off too, while its tape lasts.
  it("tapes off the shut room while planning that round, and only that round, besides raided rooms", () => {
    let found = false;
    for (let k = 0; k < 60 && !found; k++) {
      const states = playAll(config(3, { seed: `lock-${k}`, eventsEnabled: true }));
      for (const s of states) {
        const v = viewFor(s, "p1");
        const scene = boardScene(v);
        const lock = s.card && s.card.id === "lockdown" && s.card.room ? s.card : null;
        const taped = scene.round === v.round ? Object.keys(v.taped) : [];
        if (v.phase.kind === "planning") {
          if (lock && lock.round === v.phase.round) {
            found = true;
            expect(scene.closed).toEqual([lock.room, ...taped]);
          } else expect(scene.closed).toEqual(taped);
        }
        // Never closes a room that neither the card of the board's round named nor a raid taped off.
        for (const r of scene.closed) expect(taped.includes(r) || (v.card?.id === "lockdown" && v.card.round === scene.round && v.card.room === r)).toBe(true);
      }
    }
    expect(found, "a Lockdown with a room in 60 seeded games").toBe(true);
  });
});
