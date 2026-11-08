// The end-of-game reveal summary (design §13): every role and what it wins
// on, who won and why, each round's real moves and hidden actions, and the
// stash over time. Pure, and read only from the log handed in, which in a view
// is the viewer's own reveal log (`visibleLog(..., true)`), so it can't say
// anything that log doesn't (others' Secret-mode ballots stay hidden).
import type { RoleId, RoomId, TokenTrigger, PerkId } from "@skimjob/content";
import type { RoleTable } from "./overrides";
import { roleDefIn } from "./overrides";
import { leadersOf } from "./end";
import type { PlayerId } from "./types/config";
import type { GameEvent, Outcome } from "./types/events";
import type { RevealEnding, RevealItem, RevealMove, RevealRound, RevealSeat, RevealSummary } from "./types/reveal";

/** Hidden or deciding events the timeline shows as they are. */
const SHOWN: ReadonlySet<GameEvent["type"]> = new Set<GameEvent["type"]>([
  "perkBought",
  "perkUsed",
  "rigPicked",
  "insideTip",
  "meetingClosed",
  "shakedownResolved",
  "shakedownCancelled",
  "roomRaided",
  "roomReopened",
]);

interface Draft {
  card: RevealRound["card"];
  items: RevealItem[];
  resolved: RevealRound["resolved"];
  split: RevealRound["split"];
  stashes: Record<PlayerId, number>;
}

/**
 * The reveal summary of a finished game from `log` (a reveal log, in order)
 * and its `outcome`. `roles` is the game's table
 * (`rolesFor(config)`). design §13
 */
export function revealSummary(log: readonly GameEvent[], outcome: Outcome, tables: { readonly roles: RoleTable }): RevealSummary {
  const ranking = outcome.ranking;
  const seatOrder: PlayerId[] = [];
  const dealt = new Map<PlayerId, RoleId>();
  const role = new Map<PlayerId, RoleId>();
  const tokens = new Map<PlayerId, TokenTrigger[]>();
  const bought = new Map<PlayerId, PerkId[]>();
  const used = new Map<PlayerId, number>();
  const stash = new Map<PlayerId, number>();
  const add = (p: PlayerId, n: number) => stash.set(p, (stash.get(p) ?? 0) + n);
  const push = <T>(m: Map<PlayerId, T[]>, p: PlayerId, v: T) => m.set(p, [...(m.get(p) ?? []), v]);

  const drafts: Draft[] = [];
  let current: Draft = { card: null, items: [], resolved: null, split: null, stashes: {} };
  drafts[0] = current;
  /** This round's Hackers by looped room. */
  let loops = new Map<RoomId, PlayerId[]>();
  const grabs = new Map<number, Map<PlayerId, Omit<RevealMove, "missed" | "alibi">>>();
  const missed = new Set<string>();
  const alibi = new Map<string, RoomId>();
  const key = (p: PlayerId, round: number) => `${round}\u0000${p}`;

  for (let i = 0; i < log.length; i++) {
    const e = log[i] as GameEvent;
    const items = current.items;
    switch (e.type) {
      case "roleDealt":
        seatOrder.push(e.player);
        dealt.set(e.player, e.role);
        role.set(e.player, e.role);
        stash.set(e.player, 0);
        break;
      case "roundStarted":
        current.stashes = Object.fromEntries(stash);
        current = { card: null, items: [], resolved: null, split: null, stashes: {} };
        drafts[e.round] = current;
        loops = new Map();
        break;
      case "eventFlipped":
        current.card = { id: e.card, room: e.room };
        break;
      case "defaultMoveAssigned":
        missed.add(key(e.player, e.round));
        break;
      case "alibiPosted":
        alibi.set(key(e.player, e.round), e.room);
        break;
      case "coinsGrabbed": {
        const byPlayer = grabs.get(e.round) ?? new Map();
        byPlayer.set(e.player, { player: e.player, room: e.room, duffel: e.duffel, pocket: e.pocket });
        grabs.set(e.round, byPlayer);
        add(e.player, e.pocket);
        break;
      }
      case "roundResolved":
        current.resolved = { taken: e.taken, missing: e.missing };
        break;
      case "duffelSplit":
        // design §7.6: every stash gets this round's cut.
        current.split = { cut: e.cut, share: e.share };
        for (const p of seatOrder) add(p, e.cut);
        break;
      case "abilityResolved": {
        const a = e.ability;
        if (a.kind === "loopCameras") loops.set(a.room, [...(loops.get(a.room) ?? []), e.player]);
        items.push({ kind: "event", event: e });
        break;
      }
      case "roomWatched":
        if (e.offline) {
          items.push({ kind: "cameraOffline", watcher: e.player, room: e.room, source: e.source, hackers: loops.get(e.room) ?? [] });
        }
        break;
      case "tokenEarned": {
        push(tokens, e.player, e.trigger);
        items.push({ kind: "token", player: e.player, trigger: e.trigger });
        break;
      }
      case "perkBought":
        push(bought, e.player, e.perk);
        break;
      case "perkUsed":
        used.set(e.player, (used.get(e.player) ?? 0) + 1);
        break;
      case "roleClaimed":
        items.push({ kind: "claim", player: e.player, claimed: e.role, real: role.get(e.player) ?? e.role });
        break;
      case "shakedownResolved":
        add(e.target, -e.taken);
        break;
      default:
        break;
    }
    if (SHOWN.has(e.type)) current.items.push({ kind: "event", event: e });
  }
  current.stashes = Object.fromEntries(stash);

  const rounds: RevealRound[] = [];
  drafts.forEach((d, round) => {
    if (!d) return;
    const byPlayer = grabs.get(round);
    const moves: RevealMove[] = byPlayer
      ? seatOrder.flatMap((p) => {
          const m = byPlayer.get(p);
          return m ? [{ ...m, missed: missed.has(key(p, round)), alibi: alibi.get(key(p, round)) ?? null }] : [];
        })
      : [];
    if (round === 0 && d.items.length === 0) return;
    rounds.push({ round, card: d.card, moves, resolved: d.resolved, split: d.split, items: d.items, stashes: d.stashes });
  });

  const top = leadersOf(ranking);
  const reason = outcome.result === "failed" ? outcome.reason : null;
  const ending: RevealEnding = {
    result: outcome.result,
    reason,
    topGroup: top,
    winners: outcome.winners,
    why: outcome.result === "success" ? "success" : outcome.winners.length > 0 ? "failedTopWins" : "failedNobody",
  };
  const seats: RevealSeat[] = ranking.map((r, i) => ({
    player: r.player,
    place: i + 1,
    dealtRole: dealt.get(r.player) ?? r.role,
    role: r.role,
    winsOn: roleDefIn(tables.roles, r.role)?.winsOn ?? [],
    stash: r.stash,
    topGroup: top.includes(r.player),
    winner: outcome.winners.includes(r.player),
    tokens: tokens.get(r.player) ?? [],
    perksBought: bought.get(r.player) ?? [],
    perksUsed: used.get(r.player) ?? 0,
  }));
  return { ending, seats, rounds };
}
