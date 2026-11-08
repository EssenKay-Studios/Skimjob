// What a stash holds above the share, and every role's tokens. design §7.6,
// §9.6; extension.md "Tokens and the perk shop" (until S3a.7)
//
// Every reward is one private `tokenEarned`, emitted where its trigger
// happens: after a shakedown (`dirtyShakedownRewards`).
import type { TokenTrigger } from "@skimjob/content";
import type { GameEvent, GameState, PlayerId, PlayerState } from "./types";
import { privateTo } from "./types";
import { roleDefIn, rolesFor } from "./overrides";

/** What `target` holds above the share (the pocketed coins still held; 0 at or below it): what a shakedown takes. design §7.6, §9.6 */
export const aboveShare = (state: GameState, target: PlayerId): number => Math.max(0, (state.players[target] as PlayerState).stash - state.share);

/**
 * `count` tokens (one per `tokenEarned`) for each player whose role has a
 * reward on `trigger` and for whom `earned` holds. extension.md "Tokens and the perk shop", gap-fills
 */
function grantRewards(state: GameState, trigger: TokenTrigger, earned: (player: PlayerState) => boolean): GameEvent[] {
  const roles = rolesFor(state.config);
  const out: GameEvent[] = [];
  for (const id of state.playerOrder) {
    const player = state.players[id] as PlayerState;
    for (const reward of roleDefIn(roles, player.role)?.rewards ?? []) {
      if (reward.on !== trigger || !earned(player)) continue;
      for (let i = 0; i < reward.count; i++) out.push({ type: "tokenEarned", visibility: privateTo(id), player: id, trigger });
    }
  }
  return out;
}

/**
 * extension.md "Roles": `target` was just caught (shaken down dirty). A token
 * for: the Lookout if its power saw them; the Auditor if they visited a room
 * it audited, in that round; the Detective if it looked into them (earlier this
 * game, by this player, provisional); the Smooth Talker if its last ballot in `meetingId` was for them. Nobody earns
 * one for their own shakedown.
 */
export function dirtyShakedownRewards(state: GameState, target: PlayerId, meetingId: string): GameEvent[] {
  // Each voter's last ballot in this meeting (a later one replaces an earlier, sealed votes included).
  const ballots = new Map<PlayerId, string>();
  for (const e of state.log) if (e.type === "voteCast" && e.meetingId === meetingId) ballots.set(e.player, e.vote.kind === "shakedown" ? e.vote.target : "");
  const mine = (player: PlayerState) => state.log.filter((e) => "player" in e && e.player === player.id && e.player !== target);
  const roomOf = (round: number): string | undefined => {
    const split = state.log.find((e) => e.type === "coinsGrabbed" && e.player === target && e.round === round);
    return split?.type === "coinsGrabbed" ? split.room : undefined;
  };
  return [
    ...grantRewards(state, "watchedShakenDirty", (p) => mine(p).some((e) => e.type === "roomWatched" && e.source === "lookout" && e.seen.includes(target))),
    ...grantRewards(state, "auditedShakenDirty", (p) =>
      mine(p).some((e) => e.type === "abilityResolved" && e.ability.kind === "audit" && roomOf(e.ability.round) === e.ability.room),
    ),
    ...grantRewards(state, "checkedShakenDirty", (p) => mine(p).some((e) => e.type === "abilityResolved" && e.ability.kind === "detect" && e.ability.target === target)),
    ...grantRewards(state, "wonDirtyShakedown", (p) => p.id !== target && ballots.get(p.id) === target),
  ];
}
