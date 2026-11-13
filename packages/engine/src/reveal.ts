// The end-of-game reveal summary (design §15.5): every role, who won and why,
// each round's real moves and hidden actions, and the stash over time. Pure, and read only from the log handed in, which in a view
// is the viewer's own reveal log (`visibleLog(..., true)`), so it can't say
// anything that log doesn't (others' Secret-mode ballots stay hidden).
import type { RoleId, RoomId, PerkId } from "@skimjob/content";
import { leadersOf } from "./end";
import type { PlayerId } from "./types/config";
import type { GameEvent, Outcome } from "./types/events";
import type { RevealEnding, RevealItem, RevealMove, RevealRound, RevealSeat, RevealSummary } from "./types/reveal";

/** Hidden or deciding events the timeline shows as they are. */
const SHOWN: ReadonlySet<GameEvent["type"]> = new Set<GameEvent["type"]>([
  "perkBought",
  "bailChosen",
  "insideTip",
  "meetingClosed",
  "shakedownResolved",
  "shakedownCancelled",
  "roomRaided",
  "roomReopened",
  "powerCut",
  "abilityAlreadyDone",
  "sinsAbsolved",
]);

interface Draft {
  card: RevealRound["card"];
  items: RevealItem[];
  resolved: RevealRound["resolved"];
  split: RevealRound["split"];
  stashes: Record<PlayerId, number>;
}

/** The reveal summary of a finished game from `log` (a reveal log, in order) and its `outcome`. design §15.5 */
export function revealSummary(log: readonly GameEvent[], outcome: Outcome): RevealSummary {
  const ranking = outcome.ranking;
  const seatOrder: PlayerId[] = [];
  const dealt = new Map<PlayerId, RoleId>();
  const role = new Map<PlayerId, RoleId>();
  const bought = new Map<PlayerId, PerkId[]>();
  const stash = new Map<PlayerId, number>();
  const add = (p: PlayerId, n: number) => stash.set(p, (stash.get(p) ?? 0) + n);
  const push = <T>(m: Map<PlayerId, T[]>, p: PlayerId, v: T) => m.set(p, [...(m.get(p) ?? []), v]);

  const drafts: Draft[] = [];
  let current: Draft = { card: null, items: [], resolved: null, split: null, stashes: {} };
  drafts[0] = current;
  const grabs = new Map<number, Map<PlayerId, Omit<RevealMove, "missed" | "alibi">>>();
  const missed = new Set<string>();
  const satOut = new Set<string>();
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
        break;
      case "eventFlipped":
        current.card = { id: e.card, room: e.room };
        break;
      case "defaultMoveAssigned":
        missed.add(key(e.player, e.round));
        // design §3.3: with the default room taped off, a missed move sits the round out (no move, no grab).
        if (e.move === null) satOut.add(key(e.player, e.round));
        break;
      case "said": {
        const said = e.statement;
        if (said.kind === "alibi") alibi.set(key(said.player, said.round), said.room);
        else items.push({ kind: "claim", player: said.player, claimed: said.role, real: role.get(said.player) ?? said.role });
        break;
      }
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
      case "abilityResolved":
        items.push({ kind: "event", event: e });
        break;
      case "sinsAbsolved":
        // design §7.6, §11.1: the Priest took it back.
        add(e.player, -e.taken);
        break;
      case "perkBought":
        // design §7.6, §12: paid from the stash.
        push(bought, e.player, e.perk.kind);
        add(e.player, -e.cost);
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
    rounds.push({ round, card: d.card, moves, satOut: seatOrder.filter((p) => satOut.has(key(p, round))), resolved: d.resolved, split: d.split, items: d.items, stashes: d.stashes });
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
    stash: r.stash,
    topGroup: top.includes(r.player),
    winner: outcome.winners.includes(r.player),
    perksBought: bought.get(r.player) ?? [],
  }));
  return { ending, seats, rounds };
}
