// The black market sheet, worked out from the player's own view (design §12,
// §18): this game's three perks with their content prices, what each needs
// aimed (another player, a room in play), and the round's nameless notices.
import { PERK_TEXT, type PerkId } from "@skimjob/content";
import type { GameEvent, PerkUse, PlayerView, RoomId } from "@skimjob/engine";
import { perkName } from "./describeEvent";
import { jobOf, roomOptions, seatsOf } from "./hud";

/** The perks that act next round: bought in the last round they do nothing. design §12 */
const NEXT_ROUND: ReadonlySet<PerkId> = new Set(["tail", "softShoes", "blackout"]);
/** What a perk is aimed at; `buyPerk` carries it, so a purchase is its use. design §12 */
const AIM: Readonly<Record<PerkId, { readonly player: boolean; readonly room: boolean }>> = {
  tail: { player: false, room: true },
  alibi: { player: false, room: false },
  ballot: { player: true, room: false },
  softShoes: { player: false, room: false },
  blackout: { player: false, room: true },
  bail: { player: false, room: false },
  plantEvidence: { player: true, room: true },
};

export interface Offer {
  readonly perk: PerkId;
  readonly name: string;
  readonly text: string;
  readonly cost: number;
  readonly player: boolean;
  readonly room: boolean;
  /** Why it can't be bought now, or null. */
  readonly blocked: string | null;
  /** A "next round" perk in the last round: it would do nothing. */
  readonly wasted: boolean;
}

export interface Market {
  readonly stash: number;
  /** The perk you bought this round, if any: one a round. */
  readonly bought: PerkId | null;
  readonly offers: readonly Offer[];
  /** Everyone else, the players a perk can name (never yourself, design §11.1 Readings). */
  readonly players: readonly { readonly id: string; readonly name: string }[];
  readonly rooms: readonly { readonly id: RoomId; readonly name: string }[];
}

const coins = (n: number) => `${n} coin${n === 1 ? "" : "s"}`;

export function marketOf(view: PlayerView): Market {
  const round = view.phase.kind === "planning" ? view.phase.round : null;
  const mine = view.caseFile.find((x) => x.event.type === "perkBought" && x.event.round === round)?.event;
  const bought = mine?.type === "perkBought" ? mine.perk.kind : null;
  const last = round !== null && round >= jobOf(view).roundCap;
  const stash = view.me.stash;
  const offers = view.shop.map(({ perk, cost }): Offer => {
    const blocked =
      round === null
        ? "Perks are bought while a round is planned."
        : bought
          ? `You bought ${perkName(bought)} this round. One perk a round.`
          : perk === "ballot" && view.voteVisibility === "open"
            ? "Ballots are already public in this game."
            : perk === "bail" && view.me.roleState.bail
              ? "You already hold a Bail."
              : stash < cost
                ? `It costs ${coins(cost)}; your stash holds ${stash}.`
                : null;
    return { perk, name: perkName(perk), text: PERK_TEXT[perk]?.text ?? "", cost, ...AIM[perk], blocked, wasted: last && NEXT_ROUND.has(perk) };
  });
  return {
    stash,
    bought,
    offers,
    players: seatsOf(view).filter((s) => !s.you).map((s) => ({ id: s.id, name: s.name })),
    rooms: roomOptions(view).map((r) => ({ id: r.id, name: r.name })),
  };
}

/** The `buyPerk` use for `offer` with its aim, or null while an aim is missing. */
export function perkUse(offer: Offer, aim: { readonly player: string | null; readonly room: RoomId | null }): PerkUse | null {
  if ((offer.player && !aim.player) || (offer.room && !aim.room)) return null;
  switch (offer.perk) {
    case "tail":
    case "blackout":
      return { kind: offer.perk, room: aim.room! };
    case "ballot":
      return { kind: "ballot", target: aim.player! };
    case "plantEvidence":
      return { kind: "plantEvidence", target: aim.player!, room: aim.room! };
    default:
      return { kind: offer.perk };
  }
}

/**
 * The latest round's "Someone bought …" notices, as the engine released them:
 * together, as that round resolved, in the black market's order, with no name
 * (design §12, §18). Before any purchase, none.
 */
export function latestSales(view: PlayerView): Extract<GameEvent, { type: "perkSold" }>[] {
  const sold = view.ledger.flatMap((x) => (x.event.type === "perkSold" ? [x.event] : []));
  const round = sold.at(-1)?.round;
  return sold.filter((e) => e.round === round);
}
