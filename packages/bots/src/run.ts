// Plays one all-bot game to the end: the engine plus agents, with a minimal
// stand-in for the server's scheduler (every deadline passes as soon as each
// agent has had its say). For bot tests and the simulator (task 10).
//
// Only the scheduler here reads the full game state, as the real server does;
// agents only ever get viewFor() output. design §17.3, §17.4
import {
  isOver,
  createGame,
  handleCommand,
  viewFor,
  type Command,
  type GameConfig,
  type GameState,
  type PlayerCommand,
  type PlayerId,
  type PlayerSeat,
  type PlanEntry,
  type PlanSnapshot,
} from "@skimjob/engine";
import { createBot, type Agent } from "./bot";
import type { Personality } from "./personalities";

export interface Rejection {
  readonly player: PlayerId;
  readonly command: PlayerCommand;
  readonly reason: string;
}

export interface BotGameResult {
  /** The finished game. Its log is the full record (and the reveal). */
  readonly state: GameState;
  /** Agent commands the engine refused. A correct bot makes none. */
  readonly rejections: readonly Rejection[];
  /** Scheduler steps taken. */
  readonly steps: number;
}

export interface BotGameOptions {
  /** Give up (throw) after this many steps; a game takes about 30. */
  readonly maxSteps?: number;
}

/**
 * One bot per seat, each with its own seed derived from `seed` and its seat id,
 * and one shared `crewSeed` for the crew's hunch (from `seed`, which the
 * players never see: the sim and tests pass the game's seed).
 */
export function createBots(
  seats: readonly PlayerSeat[],
  personalityFor: (seat: PlayerSeat, index: number) => Personality,
  seed: string,
): Agent[] {
  return seats.map((seat, i) => createBot({ player: seat.id, personality: personalityFor(seat, i), seed: `${seed}/${seat.id}`, crewSeed: `${seed}/crew` }));
}

/**
 * Run a game to the end. Each step, every agent (in seat order) sees its view
 * and sends its commands; then one deadline passes: an open meeting closes, a
 * pending shakedown's window ends, a called emergency opens, the round resolves
 * (with the bots' plan-board spots, design §10), the meeting it called opens (the server picks a slot if
 * nobody locked one in), or its result window closes. Seats without an agent just
 * get default moves, like an absent player.
 */
/**
 * design §10: the plan board as the round resolves, from each agent's spot:
 * its avatar placed where it claims, and agreed. No clock here, so no edit history.
 */
function planBoard(state: GameState, agents: readonly Agent[]): PlanSnapshot {
  // One line per seat (a seat may have more than one agent asking).
  const bySeat = new Map<PlayerId, PlanEntry>();
  for (const agent of agents) {
    const spot = agent.spot?.(viewFor(state, agent.player));
    if (spot) bySeat.set(agent.player, { player: agent.player, placed: spot.room, room: spot.room, power: spot.power, agreed: true });
  }
  return { entries: [...bySeat.values()], history: [] };
}

export function runBotGame(config: GameConfig, agents: readonly Agent[], options: BotGameOptions = {}): BotGameResult {
  const maxSteps = options.maxSteps ?? 200;
  let state = createGame(config);
  for (const agent of agents) {
    if (!state.playerOrder.includes(agent.player)) throw new Error(`agent for unknown seat ${agent.player}`);
  }
  const rejections: Rejection[] = [];
  const system = (command: Command): void => {
    const r = handleCommand(state, command);
    if (!r.ok) throw new Error(`scheduler command refused: ${JSON.stringify(command)}: ${r.reason}`);
    state = r.state;
  };

  for (let steps = 0; ; steps++) {
    if (isOver(state.phase)) return { state, rejections, steps };
    if (steps >= maxSteps) throw new Error(`game not over after ${maxSteps} steps`);
    for (const agent of agents) {
      for (const command of agent.act(viewFor(state, agent.player))) {
        if (isOver(state.phase)) break;
        const r = handleCommand(state, command);
        if (r.ok) state = r.state;
        else rejections.push({ player: agent.player, command, reason: r.reason });
      }
    }
    const phase = state.phase;
    if (phase.kind === "meeting") {
      system({ type: "advance", deadline: { kind: "closeMeeting", meetingId: phase.meetingId } });
    } else if (phase.kind === "shakedownPending") {
      system({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: phase.meetingId } });
    } else if (state.pendingEmergency) {
      system({ type: "advance", deadline: { kind: "openMeeting", meetingId: state.pendingEmergency.meetingId } });
    } else if (phase.kind === "planning") {
      system({ type: "advance", deadline: { kind: "round", round: phase.round, plan: planBoard(state, agents) } });
    } else if (phase.kind === "result") {
      // design §9.3: the bots had their say; nobody called an emergency, so the window closes.
      system({ type: "advance", deadline: { kind: "result", round: phase.round } });
    } else if (phase.kind === "awaitingMeeting") {
      if (!state.scheduledMeeting) system({ type: "scheduleMeeting", meetingId: phase.meetingId, slot: `server-${phase.meetingId}` });
      system({ type: "advance", deadline: { kind: "openMeeting", meetingId: phase.meetingId } });
    }
  }
}
