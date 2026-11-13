// QA for End game early (#239): the host's abort from every phase a game passes through,
// 3 and 12 players. Nobody wins, nothing is scored, no reveal, and the abort itself must
// not open anything a viewer couldn't already see. design §6.2, §16, §13, §17.2
import { describe, expect, it } from "vitest";
import type { Command, GameConfig, GameState, PlayerId } from "./types";
import { sampleCommands } from "./types/samples";
import { createGame } from "./setup";
import { handleCommand } from "./handle";
import { replay } from "./reduce";
import { viewFor } from "./view";
import { isOver } from "./end";

const config = (players: number, seed: string): GameConfig => ({
  seed,
  players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
  job: "bank",
  eventsEnabled: true,
  voteVisibility: "hiddenThenRevealed",
});

const must = (s: GameState, c: unknown): GameState => {
  const r = handleCommand(s, c);
  if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
  return r.state;
};

/** The next deadline(s) the scheduler would fire. */
function next(s: GameState): Command[] {
  const p = s.phase;
  if (p.kind === "meeting") return [{ type: "advance", deadline: { kind: "closeMeeting", meetingId: p.meetingId } }];
  if (p.kind === "shakedownPending") return [{ type: "advance", deadline: { kind: "resolveShakedown", meetingId: p.meetingId } }];
  if (s.pendingEmergency) return [{ type: "advance", deadline: { kind: "openMeeting", meetingId: s.pendingEmergency.meetingId } }];
  if (p.kind === "planning") return [{ type: "advance", deadline: { kind: "round", round: p.round } }];
  if (p.kind === "alibi") return [{ type: "advance", deadline: { kind: "alibi", round: p.round } }];
  if (p.kind === "result") return [{ type: "advance", deadline: { kind: "result", round: p.round } }];
  if (p.kind === "awaitingMeeting") {
    const schedule: Command[] = s.scheduledMeeting ? [] : [{ type: "scheduleMeeting", meetingId: p.meetingId, slot: `slot-${p.meetingId}` }];
    return [...schedule, { type: "advance", deadline: { kind: "openMeeting", meetingId: p.meetingId } }];
  }
  return [];
}

/** A whole game (moves with some pocketing, ballots in meetings), every state along the way. */
function play(players: number, seed: string): GameState[] {
  let s = createGame(config(players, seed));
  const states = [s];
  for (let guard = 0; !isOver(s.phase) && guard < 500; guard++) {
    if (s.phase.kind === "planning") {
      for (const [i, id] of s.playerOrder.entries()) {
        const room = s.rooms[i % s.rooms.length]!;
        const r = handleCommand(s, { type: "submitMove", player: id, move: { room, duffel: 1, pocket: i % 2 } });
        if (r.ok) s = r.state;
      }
      states.push(s);
    }
    if (s.phase.kind === "meeting") {
      const target = s.playerOrder[0] as PlayerId;
      for (const id of s.playerOrder.slice(1)) {
        const r = handleCommand(s, { type: "castVote", player: id, vote: { kind: "shakedown", target } });
        if (r.ok) s = r.state;
      }
      states.push(s);
    }
    for (const c of next(s)) s = must(s, c);
    states.push(s);
  }
  expect(s.phase.kind).toBe("ended");
  return states;
}

describe("End game early from every phase — design §6.2, §16", () => {
  for (const [players, seed] of [[3, "abort-qa-3"], [12, "abort-qa-12"]] as const) {
    const states = play(players, seed);
    const live = states.filter((s) => !isOver(s.phase));

    it(`${players} players: passes through planning, result and a meeting`, () => {
      const kinds = new Set(live.map((s) => s.phase.kind));
      for (const k of ["planning", "result", "meeting"]) expect(kinds).toContain(k);
    });

    it(`${players} players: from every live phase, one public event, aborted, no outcome, nothing new opened`, () => {
      for (const before of live) {
        const r = handleCommand(before, { type: "abortGame" });
        if (!r.ok) throw new Error(`${before.phase.kind}: ${r.reason}`);
        expect(r.events).toEqual([{ type: "gameAborted", visibility: { kind: "public" } }]);
        expect(r.state.phase).toEqual({ kind: "aborted" });
        // Not scored: no stash, duffel, bank or Wanted moves; no gameEnded event.
        expect({ ...r.state, phase: before.phase, log: before.log }).toEqual(before);
        expect(r.state.log.some((e) => e.type === "gameEnded")).toBe(false);
        for (const id of before.playerOrder) {
          const was = viewFor(before, id);
          const now = viewFor(r.state, id);
          expect(now.reveal).toBeNull();
          expect(now.caseFile).toEqual(was.caseFile);
          expect(now.ledger.slice(0, -1)).toEqual(was.ledger);
          expect(now.ledger.at(-1)!.event.type).toBe("gameAborted");
          expect(now.me).toEqual(was.me);
        }
      }
    });

    it(`${players} players: the aborted game replays from its log and takes no further command`, () => {
      const mid = live[Math.floor(live.length / 2)]!;
      const aborted = must(mid, { type: "abortGame" });
      expect(replay(aborted.config, aborted.log)).toEqual(aborted);
      for (const c of Object.values(sampleCommands)) {
        expect(handleCommand(aborted, c)).toEqual({ ok: false, reason: "the game is over" });
      }
      for (const c of next(mid)) expect(handleCommand(aborted, c)).toEqual({ ok: false, reason: "the game is over" });
    });
  }

  it("deterministic: same seed and commands, same log", () => {
    const a = play(3, "abort-det");
    const b = play(3, "abort-det");
    const i = 4;
    expect(must(a[i]!, { type: "abortGame" }).log).toEqual(must(b[i]!, { type: "abortGame" }).log);
  });

  it("refused before the game starts and after it has ended", () => {
    const c = config(3, "abort-edges");
    expect(handleCommand(replay(c, []), { type: "abortGame" })).toEqual({ ok: false, reason: "the game has not started" });
    const ended = play(3, "abort-edges").at(-1)!;
    expect(handleCommand(ended, { type: "abortGame" })).toEqual({ ok: false, reason: "the game is over" });
  });

  it("a bare abortGame carrying a player or extra fields aborts the same way (the server, not the engine, checks who asked)", () => {
    const s = createGame(config(3, "abort-extra"));
    const r = handleCommand(s, { type: "abortGame", player: "p1", reason: "x" });
    expect(r.ok && r.events).toEqual([{ type: "gameAborted", visibility: { kind: "public" } }]);
  });
});
