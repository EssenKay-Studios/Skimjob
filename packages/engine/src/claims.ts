// Role claims: a formal, public, possibly false "I'm the Lookout". design §8, §12.1
//
// Like an alibi (§5.4) a claim changes no rule: it is talk, put on the ledger
// so it is structured and lasting (recaps, the reveal, bots in the simulator
// and on the server, which don't read chat). Any role in the content may be
// claimed, whether or not it can be in this game: refusing a role outside the
// game's pool would tell players what the (hidden) pool holds.
import type { GameEvent, GameState } from "./types";
import { PUBLIC } from "./types";
import { playerFor, show } from "./check";
import { actOfRound } from "./acts";
import { rolesFor } from "./overrides";

/** design §8, §12.1: once per player per act, any role id the game's content knows. */
export function claimRole(state: GameState, command: Record<string, unknown>): GameEvent[] | string {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  const role = command.role;
  if (typeof role !== "string" || !Object.hasOwn(rolesFor(state.config), role)) return `unknown role ${show(role)}`;
  const act = actOfRound(state.round);
  if (state.log.some((e) => e.type === "roleClaimed" && e.player === player.id && e.act === act)) {
    return `you already claimed a role in act ${act}`;
  }
  return [{ type: "roleClaimed", visibility: PUBLIC, player: player.id, role, act }];
}
