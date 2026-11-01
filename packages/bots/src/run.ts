// Plays one all-bot game to the end: the engine plus agents, with a minimal
// stand-in for the server's scheduler (every deadline passes as soon as each
// agent has had its say). For bot tests and the simulator (task 10).
//
// Only the scheduler here reads the full game state, as the real server does;
// agents only ever get viewFor() output. design §17.3, §17.4
import {
  createGame,
  handleCommand,
  viewFor,
  type Command,
  type GameConfig,
  type GameState,
  type PlayerCommand,
  type PlayerId,
  type PlayerSeat,
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
  /** Give up (throw) after this many steps; a game takes about 20. */
  readonly maxSteps?: number;
}

/** One bot per seat, each with its own seed derived from `seed` and its seat id. */
export function createBots(
  seats: readonly PlayerSeat[],
  personalityFor: (seat: PlayerSeat, index: number) => Personality,
  seed: string,
): Agent[] {
  return seats.map((seat, i) => createBot({ player: seat.id, personality: personalityFor(seat, i), seed: `${seed}/${seat.id}` }));
}

/**
 * Run a game to the end. Each step, every agent (in seat order) sees its view
 * and sends its commands; then one deadline passes: an open meeting closes, a
 * pending shakedown's window ends, a called emergency opens, the round resolves, its alibis close, or the act's meeting opens (the
 * server picks a slot if nobody locked one in). Seats without an agent just
 * get default moves, like an absent player.
 */
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
    if (state.phase.kind === "ended") return { state, rejections, steps };
    if (steps >= maxSteps) throw new Error(`game not over after ${maxSteps} steps`);
    for (const agent of agents) {
      for (const command of agent.act(viewFor(state, agent.player))) {
        if (state.phase.kind === "ended") break;
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
    } else if (state.pendingEmergency && (phase.kind === "planning" || phase.kind === "alibis" || phase.kind === "awaitingMeeting")) {
      system({ type: "advance", deadline: { kind: "openMeeting", meetingId: state.pendingEmergency.meetingId } });
    } else if (phase.kind === "planning") {
      system({ type: "advance", deadline: { kind: "round", round: phase.round } });
    } else if (phase.kind === "alibis") {
      // design §5.4: the bots have posted their alibis this step, so the alibi deadline passes.
      system({ type: "advance", deadline: { kind: "alibis", round: phase.round } });
    } else if (phase.kind === "awaitingMeeting") {
      if (!state.scheduledMeeting) system({ type: "scheduleMeeting", act: phase.act, slot: `server-act-${phase.act}` });
      const meetingId = state.scheduledMeeting?.meetingId;
      system({ type: "advance", deadline: { kind: "openMeeting", meetingId: meetingId as string } });
    }
  }
}
