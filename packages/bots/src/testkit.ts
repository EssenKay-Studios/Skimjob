// Test helpers: scripted engine games for the bot tests. Not exported from the package.
import { STARTER_ROLES } from "@skimjob/content";
import { createGame, handleCommand, jobFor, type ContentOverrides, type GameConfig, type GameState, type PlayerId, type VoteVisibility } from "@skimjob/engine";

const IDS = ["ana", "ben", "carl", "dee", "eve"];

export function seats(n: number): GameConfig["players"] {
  return Array.from({ length: n }, (_, i) => ({ id: IDS[i] ?? `p${i}`, name: IDS[i] ?? `P${i}`, isBot: true }));
}

/**
 * R6's room yields as coin limits, its checkpoint targets, clean line and payout,
 * a bank too big to run short (design §3.2) and bells too big to raid (§5.3), so the R6 bot heuristics (alibis, suspicion, perks,
 * claims, endings) keep their numbers until the S3a steps that replace them.
 */
export const R6_COINS: ContentOverrides = {
  rooms: { vault: { coins: 6 }, office: { coins: 4 }, lobby: { coins: 2 }, depositBoxes: { coins: 5 } },
  bank: { coinsPerPlayer: 100 },
  alarm: { bulbs: 1000 },
  checkpoints: { perPlayer: [7, 15, 23] },
  shakedown: { cleanBelow: 6, payout: 8 },
};

export function config(n: number, seed: string, voteVisibility: VoteVisibility = "hiddenThenRevealed"): GameConfig {
  // Starter pool (the shop may still hold a Shield).
  return { seed, players: seats(n), job: "bank", rolePool: [...STARTER_ROLES], eventsEnabled: false, voteVisibility, contentOverrides: R6_COINS };
}

/** A game where `want` holds for the dealt roles trying seeds in order. */
export function game(n: number, want: (s: GameState) => boolean = () => true): GameState {
  for (let i = 0; ; i++) {
    const s = createGame(config(n, `script-${i}`));
    if (want(s)) return s;
  }
}

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
      // A full grab of the room's coins (design §3.2), `pocket` of them pocketed.
      move: { room: m.room, duffel: (jobFor(open.config).rooms[m.room]?.coins ?? 0) - (m.pocket ?? 0), pocket: m.pocket ?? 0, ...(m.watch ? { watch: m.watch } : {}) },
    })),
    { type: "advance", deadline: { kind: "round", round: r } },
  );
  for (const [player, m] of Object.entries(plan)) {
    const alibi = m.alibi === undefined ? m.room : m.alibi;
    if (alibi !== null) s = run(s, { type: "postAlibi", player, room: alibi });
  }
  return s;
}
