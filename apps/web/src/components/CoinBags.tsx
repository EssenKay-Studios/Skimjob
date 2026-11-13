// The move's coins (docs/ui-style.md "Round-move panel", approved mockup 1b):
// the room's coins in the Grab row and the coins you grab, each in the crew
// duffel or your own pocket. Tap a coin to pick it up (it lifts), then tap where
// it goes: the Duffel, the Pocket, or the Grab row to leave it in the room. Or
// drag it there. Mouse, touch and keyboard work the same. design §3.2, §15.6
import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { moveCoin, type Bags, type Pile } from "../game/move";
import { InfoTip } from "./InfoTip";
import { SketchFrame } from "./SketchFrame";

type Bag = keyof Bags;

/** A pointer must travel this far (px) before a press on a coin is a drag, not a tap. */
const DRAG_FROM = 6;

const PILE_NAME: Record<Pile, string> = { room: "the room", duffel: "the duffel", pocket: "your pocket" };

/** The coin picked up: which pile it came from, and which of its coins it is. */
interface Held {
  readonly from: Pile;
  readonly index: number;
}

function CoinButton({ pile, index, picked, onTap, onDrop }: { pile: Pile; index: number; picked: boolean; onTap: () => void; onDrop: (to: Pile) => void }) {
  const press = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const finish = (e: PointerEvent<HTMLButtonElement>) => {
    const drag = offset !== null;
    press.current = null;
    setOffset(null);
    if (!drag) return;
    dragged.current = true;
    const target = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.hasAttribute("data-pile"))?.getAttribute("data-pile");
    if ((target === "room" || target === "duffel" || target === "pocket") && target !== pile) onDrop(target);
  };
  return (
    <button
      type="button"
      className={`coin-btn${offset ? " is-dragging" : ""}${picked ? " is-picked" : ""}`}
      style={offset ? { translate: `${offset.x}px ${offset.y}px` } : undefined}
      aria-pressed={picked}
      aria-label={`Coin ${index + 1} in ${PILE_NAME[pile]}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        dragged.current = false;
        press.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const from = press.current;
        if (!from) return;
        const x = e.clientX - from.x;
        const y = e.clientY - from.y;
        if (offset || Math.hypot(x, y) > DRAG_FROM) setOffset({ x, y });
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        press.current = null;
        setOffset(null);
      }}
      onClick={() => {
        if (dragged.current) dragged.current = false;
        else onTap();
      }}
    >
      <i className="coin" />
    </button>
  );
}

/** Where the picked-up coin can be dropped: an empty, dashed coin place. */
function DropSlot({ pile, onDrop }: { pile: Pile; onDrop: (to: Pile) => void }) {
  return (
    <button type="button" className="coin-btn" aria-label={`Drop the coin in ${PILE_NAME[pile]}`} onClick={() => onDrop(pile)}>
      <i className="coin is-slot" />
    </button>
  );
}

/** A tap on an open pile's free space (not on one of its buttons) drops the held coin there. */
const onPileTap = (pile: Pile, open: boolean, onDrop: (to: Pile) => void) => (e: MouseEvent) => {
  if (open && !(e.target as Element).closest("button")) onDrop(pile);
};

function BagArt({ bag }: { bag: Bag }) {
  return bag === "duffel" ? (
    <svg width="34" height="27" viewBox="0 0 50 40" aria-hidden="true">
      <path d="M14 12c0-6 22-6 22 0" fill="none" stroke="var(--art-ink)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M5 16c0-3 3-5 6-5h28c3 0 6 2 6 5l1 16c0 3-2 5-5 5H9c-3 0-5-2-5-5z" fill="var(--olive)" stroke="var(--art-ink)" strokeWidth="2" />
      <path d="M5 22h40" stroke="var(--art-ink)" strokeWidth="1.6" strokeDasharray="3 2" />
      <rect x="21" y="18" width="8" height="7" rx="1.5" fill="var(--gold)" stroke="var(--art-ink)" strokeWidth="1.4" />
    </svg>
  ) : (
    <svg width="34" height="27" viewBox="0 0 50 40" aria-hidden="true">
      <path d="M8 5h34v18c0 8-8 14-17 14S8 31 8 23z" fill="var(--clay)" stroke="var(--art-ink)" strokeWidth="2" />
      <path d="M8 11h34" stroke="var(--art-ink)" strokeWidth="1.6" />
      <path d="M12 15c4 2 22 2 26 0" fill="none" stroke="var(--art-ink)" strokeWidth="1.4" strokeDasharray="3 2" />
    </svg>
  );
}

interface PileProps {
  readonly held: Held | null;
  /** Whether the held coin may be dropped here. */
  readonly open: boolean;
  readonly onTap: (pile: Pile, index: number) => void;
  readonly onDrop: (from: Pile, to: Pile) => void;
}

function BagBox({ bag, coins, held, open, onTap, onDrop }: PileProps & { bag: Bag; coins: number }) {
  const title = bag === "duffel" ? "Duffel" : "Pocket";
  const drop = (to: Pile) => held && onDrop(held.from, to);
  return (
    <SketchFrame
      seed={`bag-${bag}`}
      radius={12}
      shadow={0.35}
      fill={bag === "duffel" ? "var(--good-l)" : "var(--clay-l)"}
      className={`bag bag--${bag}`}
      data-pile={bag}
      onClick={onPileTap(bag, open, drop)}
    >
      <div className="bag__head">
        <BagArt bag={bag} />
        <span className="hand bag__name">{title}</span>
        <b className="num bag__count" aria-label={`${coins} in ${PILE_NAME[bag]}`}>
          {coins}
        </b>
        <InfoTip info={{ kind: "tip", id: bag === "duffel" ? "moveDuffel" : "movePocket" }} />
      </div>
      <div className="bag__coins">
        {Array.from({ length: coins }, (_, i) => (
          <CoinButton key={i} pile={bag} index={i} picked={held?.from === bag && held.index === i} onTap={() => onTap(bag, i)} onDrop={(to) => onDrop(bag, to)} />
        ))}
        {open ? <DropSlot pile={bag} onDrop={drop} /> : coins === 0 && <span className="meta">Tap or drag a coin here</span>}
      </div>
    </SketchFrame>
  );
}

export interface CoinBagsProps {
  /** The most coins this room lets you grab (design §3.1). */
  readonly limit: number;
  /** The coins grabbed, split into the two bags (none up to the limit in all). */
  readonly bags: Bags;
  /** A coin moved: the bags after it. */
  readonly onBags: (bags: Bags) => void;
  /** The room's bell with what your grab adds (an `AlarmBell`), beside the coins you grab. */
  readonly bell?: ReactNode;
}

/** The Grab row (the room's coins, with the bell preview) and the two bags the grabbed coins go into. */
export function CoinBags({ limit, bags, onBags, bell }: CoinBagsProps) {
  const [held, setHeld] = useState<Held | null>(null);
  const grab = bags.duffel + bags.pocket;
  const left = limit - grab;
  const move = (from: Pile, to: Pile) => {
    setHeld(null);
    onBags(moveCoin(bags, from, to, limit));
  };
  // The held coin may go to any other pile. design §3.2 step 2
  const open = (pile: Pile) => held !== null && held.from !== pile;
  // A tap on a coin drops the held one in that coin's pile when it may go there; otherwise it picks this coin up (or puts it down).
  const tap = (pile: Pile, index: number) => {
    if (held && open(pile)) move(held.from, pile);
    else setHeld(held?.from === pile && held.index === index ? null : { from: pile, index });
  };
  const drop = (to: Pile) => held && move(held.from, to);
  const pile = { held, onTap: tap, onDrop: move };
  return (
    <div
      className="coin-bags"
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key !== "Escape" || !held) return;
        // Esc puts the coin down; it doesn't also close the sheet the panel sits in.
        e.preventDefault();
        e.stopPropagation();
        setHeld(null);
      }}
    >
      <div className="coin-bags__grab" role="group" aria-label="Coins to grab" data-pile="room" onClick={onPileTap("room", open("room"), drop)}>
        <span className="hand coin-bags__label">Grab</span>
        {Array.from({ length: left }, (_, i) => (
          <CoinButton key={i} pile="room" index={i} picked={held?.from === "room" && held.index === i} onTap={() => tap("room", i)} onDrop={(to) => move("room", to)} />
        ))}
        {open("room") && <DropSlot pile="room" onDrop={drop} />}
        {Array.from({ length: open("room") ? grab - 1 : grab }, (_, i) => (
          <span key={i} className="coin-place" aria-hidden="true">
            <i className="coin is-slot" />
          </span>
        ))}
        <span className="coin-bags__fill" />
        {bell}
      </div>
      <p className="meta coin-bags__hint" aria-live="polite">
        {!held
          ? "Tap a coin to pick it up, or drag it."
          : held.from === "room"
            ? "Tap the Duffel or the Pocket to drop it."
            : `Tap the ${held.from === "duffel" ? "Pocket" : "Duffel"} to drop it, or the Grab row to leave it.`}
      </p>
      <div className="coin-bags__bags">
        <BagBox bag="duffel" coins={bags.duffel} open={open("duffel")} {...pile} />
        <BagBox bag="pocket" coins={bags.pocket} open={open("pocket")} {...pile} />
      </div>
    </div>
  );
}
