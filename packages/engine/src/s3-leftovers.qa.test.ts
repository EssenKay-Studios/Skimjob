// QA for #193 (PR #304): the Hacker can't hide a locked-down room's bell
// (design §3.2, §13), checked in real seeded games; a refusal changes nothing
// and spends no charge; the bust ending must name its escapees (design §5.5, §8.3).
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { createGame, setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { closeResultWindow } from "./result.testkit";
import { fullGrab } from "./grab.testkit";
import { closedRoom } from "./deck";
import { gameEnded, outcomeFor } from "./end";

import { NO_RAIDS } from "./v01-numbers.testkit";

function game(players: number, seed: string): GameState {
  const cfg: GameConfig = {
    seed,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: true,
    voteVisibility: "open",
    contentOverrides: NO_RAIDS,
  };
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: e.player === "p0" ? "hacker" : "lookout" } : e)));
}

const ok = (s: GameState, cmd: unknown): GameState => {
  const r = handleCommand(s, cmd);
  if (!r.ok) throw new Error(`rejected ${JSON.stringify(cmd)}: ${r.reason}`);
  return r.state;
};

/** Past the result, alibi and any meeting to the next planning; null once the game is over. */
function toPlanning(state: GameState): GameState | null {
  let s = state;
  for (let i = 0; i < 20 && s.phase.kind !== "planning"; i++) {
    if (s.phase.kind === "ended" || s.phase.kind === "aborted") return null;
    if (s.phase.kind === "result" || s.phase.kind === "alibi") {
      const r = closeResultWindow(s);
      if (!r.ok) throw new Error(r.reason);
      s = r.state;
    } else if (s.phase.kind === "awaitingMeeting") {
      const meetingId = s.phase.meetingId;
      s = ok(s, { type: "scheduleMeeting", meetingId, slot: `slot-${meetingId}` });
      s = ok(s, { type: "advance", deadline: { kind: "openMeeting", meetingId } });
      s = ok(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId } });
    } else throw new Error(`unexpected phase ${s.phase.kind}`);
  }
  return s.phase.kind === "planning" ? s : null;
}

/** Everyone grabs in the Lobby (never locked down) and the round resolves. */
function lobbyRound(s: GameState): GameState {
  let x = s;
  for (const id of x.playerOrder) x = ok(x, { type: "submitMove", player: id, move: fullGrab("lobby") });
  return ok(x, { type: "advance", deadline: { kind: "round", round: x.round } });
}

/** The first planning state, over a few seeds, whose round has a Lockdown card. */
function firstLockdown(players: number): GameState {
  for (let i = 0; i < 60; i++) {
    let s: GameState | null = toPlanning(game(players, `qa193-${players}-${i}`));
    while (s) {
      if (closedRoom(s)) return s;
      s = toPlanning(lobbyRound(s));
    }
  }
  throw new Error("no Lockdown in 60 seeds");
}

const hide = (room: string) => ({ type: "submitMove", player: "p0", move: { ...fullGrab("lobby"), ability: { kind: "hide", room } } });

describe("QA #193: the Hacker and a real Lockdown — design §3.2, §13", () => {
  for (const n of [3, 12]) {
    it(`at ${n} players: the locked-down room is refused with nothing changed; another room, or the same room next round, is accepted`, () => {
      const s = firstLockdown(n);
      const locked = closedRoom(s) as string;
      const before = JSON.stringify(s);
      const r = handleCommand(s, hide(locked));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("a locked-down room is closed this round");
      expect(JSON.stringify(s)).toBe(before);
      // The refusal spent no charge: an open room's bell can still be hidden this round.
      const other = s.rooms.find((room) => room !== locked && !Object.hasOwn(s.taped, room) && room !== "lobby") as string;
      expect(handleCommand(s, hide(other)).ok).toBe(true);
      // Lockdown closes the room for its round only (§13): next round it can be hidden.
      const next = toPlanning(lobbyRound(s)) as GameState;
      expect(closedRoom(next)).not.toBe(locked);
      expect(next.players.p0?.roleState.usedThisStretch).toBe(0);
      expect(handleCommand(next, hide(locked)).ok).toBe(true);
    });
  }

  it("a room both taped off and locked down is refused (the taped-off reason wins)", () => {
    const s = firstLockdown(3);
    const locked = closedRoom(s) as string;
    const both: GameState = { ...s, taped: { ...s.taped, [locked]: s.round + 1 } };
    const r = handleCommand(both, hide(locked));
    expect(r.ok ? "" : r.reason).toBe("a taped-off room's bell is off");
  });

  it("same seed and commands give the same log, refusal included (determinism)", () => {
    const a = firstLockdown(5);
    const b = firstLockdown(5);
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    const room = closedRoom(a) as string;
    expect(handleCommand(a, hide(room))).toEqual(handleCommand(b, hide(room)));
  });
});

describe("QA #193: a bust always names its escapees — design §5.5, §8.3", () => {
  const s = createGame({
    seed: "qa193-end",
    players: ["p0", "p1", "p2"].map((id) => ({ id, name: id, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "open",
  });
  const rich: GameState = { ...s, players: { ...s.players, p0: { ...s.players.p0!, stash: 9 }, p1: { ...s.players.p1!, stash: 4 }, p2: { ...s.players.p2!, stash: 4 } } };

  it("the type refuses a bust without escapees and escapees on any other ending", () => {
    // @ts-expect-error a bust must name its escapees
    expect(() => outcomeFor(rich, "bust")).toThrow();
    // @ts-expect-error a bust must name its escapees
    expect(() => gameEnded(rich, [], "bust")).toThrow();
    // @ts-expect-error only a bust has escapees
    outcomeFor(rich, null, ["p0"]);
    // @ts-expect-error only a bust has escapees
    outcomeFor(rich, "theft", ["p0"]);
  });

  it("the escapees tied for the biggest stash among them win, whoever is richer outside (§5.5, §8.5)", () => {
    expect(outcomeFor(rich, "bust", ["p1", "p2"]).winners).toEqual<PlayerId[]>(["p1", "p2"]);
    expect(outcomeFor(rich, "bust", ["p0", "p2"]).winners).toEqual<PlayerId[]>(["p0"]);
    expect(outcomeFor(rich, "bust", []).winners).toEqual([]);
    const ended = gameEnded(rich, [], "bust", ["p2"]);
    expect(ended.outcome).toMatchObject({ result: "failed", reason: "bust", escapees: ["p2"], winners: ["p2"] });
    expect(gameEnded(rich, [], null).outcome.winners).toEqual(["p0"]);
  });
});
