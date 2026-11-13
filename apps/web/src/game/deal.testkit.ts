// Test helper: a new engine game with chosen roles. Every player gets a role by
// the standard deal (design §11.3), so tests that need a steady crew rewrite the
// dealt roles in the setup log: seat i gets roles[i], a Lookout if missing (its
// power acts only when a move uses it). The Exact role list follows the roles.
import { ROLES, type RoleId } from "@skimjob/content";
import { handleCommand, replay, setupEvents, type GameConfig, type GameEvent, type GameState } from "@skimjob/engine";

const ORDER = Object.keys(ROLES);

export function createGame(config: GameConfig, roles: readonly RoleId[] = []): GameState {
  const dealt = config.players.map((_, i) => roles[i] ?? "lookout");
  let seat = 0;
  const log = setupEvents(config).map((e): GameEvent => {
    if (e.type === "roleDealt") return { ...e, role: dealt[seat++] as RoleId };
    if (e.type === "roleListShown" && e.list === "exact") return { ...e, roles: [...dealt].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)) };
    return e;
  });
  return replay(config, log);
}

/** design §10: closes the alibi window the game is in, if any (nobody posts), for tests about what follows it. */
export function pastAlibi(state: GameState): GameState {
  if (state.phase.kind !== "alibi") return state;
  const r = handleCommand(state, { type: "advance", deadline: { kind: "alibi", round: state.phase.round } });
  if (!r.ok) throw new Error(`alibi deadline refused: ${r.reason}`);
  return r.state;
}
