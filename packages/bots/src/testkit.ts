// Test helpers: scripted engine games for the bot tests. Not exported from the package.
import { STARTER_ROLES } from "@skimjob/content";
import { createGame, handleCommand, type GameConfig, type GameState, type PlayerId, type VoteVisibility } from "@skimjob/engine";

const IDS = ["ana", "ben", "carl", "dee", "eve"];

export function seats(n: number): GameConfig["players"] {
  return Array.from({ length: n }, (_, i) => ({ id: IDS[i] ?? `p${i}`, name: IDS[i] ?? `P${i}`, isBot: true }));
}

export function config(n: number, seed: string, voteVisibility: VoteVisibility = "hiddenThenRevealed"): GameConfig {
  // Starter pool: no Muscle, so scripted shakedowns need no window (task 12).
  return { seed, players: seats(n), job: "bank", rolePool: [...STARTER_ROLES], mole: "off", eventsEnabled: false, voteVisibility, starterMode: false };
}

/** A game where `want` holds for the dealt roles (e.g. a pocketer who isn't the Inside Man), trying seeds in order. */
export function game(n: number, want: (s: GameState) => boolean = () => true): GameState {
  for (let i = 0; ; i++) {
    const s = createGame(config(n, `script-${i}`));
    if (want(s)) return s;
  }
}

export const notInsider =
  (...ids: PlayerId[]) =>
  (s: GameState): boolean =>
    ids.every((id) => s.players[id]?.role !== "insideMan");

export function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleCommand(s, c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}

export type Plan = Record<PlayerId, { room: string; pocket?: number; watch?: string; alibi?: string | null }>;

/** Pass the alibi deadline if the last round's alibi window is still open (design §5.4). */
export function closeAlibis(state: GameState): GameState {
  return state.phase.kind === "alibis" ? run(state, { type: "advance", deadline: { kind: "alibis", round: state.phase.round } }) : state;
}

/**
 * One round: everyone's move, the deadline, then the alibis (default the truth;
 * null = none posted). The round's alibi window is left open (design §5.4);
 * the next `round` closes it first.
 */
export function round(state: GameState, plan: Plan): GameState {
  const open = closeAlibis(state);
  const r = open.phase.kind === "planning" ? open.phase.round : 0;
  let s = run(
    open,
    ...Object.entries(plan).map(([player, m]) => ({
      type: "submitMove",
      player,
      move: { room: m.room, pocket: m.pocket ?? 0, ...(m.watch ? { watch: m.watch } : {}) },
    })),
    { type: "advance", deadline: { kind: "round", round: r } },
  );
  for (const [player, m] of Object.entries(plan)) {
    const alibi = m.alibi === undefined ? m.room : m.alibi;
    if (alibi !== null) s = run(s, { type: "postAlibi", player, room: alibi });
  }
  return s;
}
