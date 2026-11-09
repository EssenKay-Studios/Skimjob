// Test helpers: scripted engine games for the bot tests. Not exported from the package.
import { ROLES } from "@skimjob/content";
import { handleCommand, jobFor, replay, setupEvents, type ContentOverrides, type GameConfig, type GameState, type PlayerId, type VoteVisibility } from "@skimjob/engine";

const IDS = ["ana", "ben", "carl", "dee", "eve"];

export function seats(n: number): GameConfig["players"] {
  return Array.from({ length: n }, (_, i) => ({ id: IDS[i] ?? `p${i}`, name: IDS[i] ?? `P${i}`, isBot: true }));
}

/**
 * R6's room yields as coin limits,
 * a bank too big to run short (design §3.2) and bells too big to raid (§5.3), so the R6 bot heuristics (alibis, suspicion,
 * claims, endings) keep their numbers until the S3a steps that replace them.
 */
export const R6_COINS: ContentOverrides = {
  rooms: { vault: { coins: 6 }, office: { coins: 4 }, lobby: { coins: 2 }, depositBoxes: { coins: 5 } },
  bank: { coinsPerPlayer: 100 },
  alarm: { bulbs: 1000 },
};

export function config(n: number, seed: string, voteVisibility: VoteVisibility = "hiddenThenRevealed"): GameConfig {
  // The black market may hold Bail, so a passed shakedown may wait for its Bail choice (design §9.6).
  return { seed, players: seats(n), job: "bank", eventsEnabled: false, voteVisibility, contentOverrides: R6_COINS };
}

/**
 * A new game whose seats hold `roles` (by player id); every other seat is a
 * Lookout, whose power is inert unless a move uses it, so other roles' powers
 * don't touch tests that aren't about them. The deal itself is the engine's
 * (design §11.3); this rewrites the dealt roles in the setup log.
 */
export function game(n: number, roles: Readonly<Record<PlayerId, string>> = {}, seed = "script-0"): GameState {
  const cfg = config(n, seed);
  const roleFor = (id: PlayerId) => (Object.hasOwn(roles, id) ? (roles[id] as string) : "lookout");
  const order = Object.keys(ROLES);
  // The Exact role list follows the roles set here, in content order.
  const list = cfg.players.map((p) => roleFor(p.id)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return replay(
    cfg,
    setupEvents(cfg).map((e) => (e.type === "roleDealt" ? { ...e, role: roleFor(e.player) } : e.type === "roleListShown" ? { ...e, roles: list } : e)),
  );
}

export function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleCommand(s, c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}

export type Plan = Record<PlayerId, { room: string; pocket?: number; watch?: string; alibi?: string | null }>;

/** Pass the result window's deadline if nobody called an emergency (design §9.3). */
export function closeResult(state: GameState): GameState {
  return state.phase.kind === "result" && !state.pendingEmergency ? run(state, { type: "advance", deadline: { kind: "result", round: state.phase.round } }) : state;
}

/** `caller` spends the crew's emergency in the result window, and its meeting opens (design §9.3). */
export function emergencyMeeting(state: GameState, caller: PlayerId): GameState {
  const s = run(state, { type: "callEmergency", player: caller });
  return run(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: s.pendingEmergency?.meetingId } });
}

/**
 * One round: everyone's move, the deadline, then the alibis (default the truth;
 * null = none posted, design §11.3). The round's result window is left open
 * (design §9.3); the next `round` closes it first.
 */
export function round(state: GameState, plan: Plan): GameState {
  const open = closeResult(state);
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
    if (alibi !== null) s = run(s, { type: "postAlibi", player, round: r, room: alibi });
  }
  return s;
}
