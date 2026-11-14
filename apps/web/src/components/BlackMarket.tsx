// The black market sheet (design §12, mockup 5a): your stash, "1 perk a round",
// this game's three perks with their content prices, Buy with a target picker
// for the perks that name a player or a room (never yourself, §11.1 Readings),
// and the latest round's nameless "Someone bought …" notices (§18).
import { useState } from "react";
import type { PerkId } from "@skimjob/content";
import type { PlayerView, RoomId } from "@skimjob/engine";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./Button";
import { Coin, Warn } from "./icons";
import { InfoTip } from "./InfoTip";
import { SketchFrame } from "./SketchFrame";
import { describeEvent } from "../game/describeEvent";
import { namesOf } from "../game/hud";
import { latestSales, marketOf, perkUse, type Market, type Offer } from "../game/market";
import type { ClientCommand, Reply } from "../game/useGame";
import "./market.css";

type Send = (cmd: ClientCommand, done?: string) => Promise<Reply>;

/** The "Black market" button and its sheet. */
/** Nothing when the game has no black market (a ruleset without perks, design §14). */
export function MarketButton({ view, send }: { view: PlayerView; send: Send }) {
  const [open, setOpen] = useState(false);
  if (view.shop.length === 0) return null;
  return (
    <>
      <Button variant="secondary" seed="market-open" icon={<Coin />} onClick={() => setOpen(true)} aria-haspopup="dialog">
        Black market
      </Button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        seed="market"
        title={
          <>
            Black market <InfoTip info={{ kind: "tip", id: "market" }} />
          </>
        }
      >
        <MarketBody view={view} send={send} />
      </BottomSheet>
    </>
  );
}

export function MarketBody({ view, send }: { view: PlayerView; send: Send }) {
  const market = marketOf(view);
  const [chosen, setChosen] = useState<PerkId | null>(null);
  const sales = latestSales(view);
  const ctx = { me: view.me.id, name: namesOf(view) };
  return (
    <div className="market">
      <div className="market__stash">
        <span className="market__coin">
          <Coin />
        </span>
        <span>
          Stash <b className="num">{market.stash}</b>
        </span>
        <InfoTip info={{ kind: "tip", id: "marketStash" }} />
        <span className="meta market__limit">1 perk a round</span>
      </div>
      {market.bought && (
        <p className="market__bought" role="status">
          You bought {market.offers.find((o) => o.perk === market.bought)?.name ?? market.bought} this round. The crew hears "someone bought" it, with no name, as the round resolves.
        </p>
      )}
      <ul className="market__perks" aria-label="This game's perks">
        {market.offers.map((o) => (
          <li key={o.perk}>
            <PerkCard offer={o} market={market} open={chosen === o.perk && !o.blocked} onOpen={() => setChosen(chosen === o.perk ? null : o.perk)} onDone={() => setChosen(null)} send={send} />
          </li>
        ))}
      </ul>
      {sales.length > 0 && (
        <section className="market__sales" aria-labelledby="market-sales">
          <h3 id="market-sales" className="meta">
            Round {sales[0]!.round}'s purchases
          </h3>
          <ul>
            {sales.map((e, i) => (
              <li key={i} className="market__sale">
                {describeEvent(e, ctx)} <span className="meta">R{e.round}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PerkCard({ offer, market, open, onOpen, onDone, send }: { offer: Offer; market: Market; open: boolean; onOpen: () => void; onDone: () => void; send: Send }) {
  const [player, setPlayer] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomId | null>(null);
  const [busy, setBusy] = useState(false);
  const use = perkUse(offer, { player, room });
  const pay = async () => {
    if (!use) return;
    setBusy(true);
    const r = await send({ type: "buyPerk", perk: use }, `Bought ${offer.name}.`);
    setBusy(false);
    if (r.ok) onDone();
  };
  const id = `perk-${offer.perk}`;
  return (
    <SketchFrame seed={id} radius={14} shadow={0.35} fill="var(--paper-hi)" className={open ? "perk is-open" : "perk"} aria-labelledby={`${id}-h`}>
      <div className="perk__row">
        <span className="perk__price" role="img" aria-label={`${offer.cost} coin${offer.cost === 1 ? "" : "s"}`}>
          <span className="perk__coins" aria-hidden="true">
            {Array.from({ length: offer.cost }, (_, i) => (
              <Coin key={i} />
            ))}
          </span>
          <b className="num" aria-hidden="true">
            {offer.cost}
          </b>
        </span>
        <span className="perk__body">
          <h3 id={`${id}-h`} className="perk__name">
            {offer.name}
          </h3>
          <span className="perk__text">{offer.text}</span>
          {offer.blocked && <span className="meta perk__blocked">{offer.blocked}</span>}
        </span>
        <Button variant={open ? "primary" : "secondary"} seed={`${id}-buy`} disabled={offer.blocked !== null} aria-expanded={open} onClick={onOpen} aria-label={`Buy ${offer.name}`}>
          Buy
        </Button>
      </div>
      {open && (
        <div className="perk__aim">
          {offer.player && (
            <div className="perk__pick" role="group" aria-label="Player">
              {market.players.map((p) => (
                <Button key={p.id} variant="toggle" seed={`${id}-p-${p.id}`} pressed={player === p.id} onClick={() => setPlayer(p.id)}>
                  {p.name}
                </Button>
              ))}
            </div>
          )}
          {offer.room && (
            <div className="perk__pick" role="group" aria-label="Room">
              {market.rooms.map((r) => (
                <Button key={r.id} variant="toggle" seed={`${id}-r-${r.id}`} pressed={room === r.id} onClick={() => setRoom(r.id)}>
                  {r.name}
                </Button>
              ))}
            </div>
          )}
          {offer.wasted && (
            <p className="perk__warn" role="note">
              <Warn /> {offer.wasted}
            </p>
          )}
          <Button variant="primary" seed={`${id}-pay`} disabled={!use || busy} onClick={pay}>
            Pay {offer.cost} coin{offer.cost === 1 ? "" : "s"}
          </Button>
        </div>
      )}
    </SketchFrame>
  );
}
