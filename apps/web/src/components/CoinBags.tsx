// The move's coins (docs/ui-style.md "Round-move panel", approved mockup 1b):
// the coins you grab, each one dragged (or tapped) into the crew duffel or your
// own pocket. A tap on a coin sends it to the other bag, so dragging is never
// the only way. design §3.2
import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { Bags } from "../game/move";
import { InfoTip } from "./InfoTip";
import { SketchFrame } from "./SketchFrame";

type Bag = keyof Bags;

/** A pointer must travel this far (px) before a press on a coin is a drag, not a tap. */
const DRAG_FROM = 6;

const OTHER: Record<Bag, Bag> = { duffel: "pocket", pocket: "duffel" };
const BAG_NAME: Record<Bag, string> = { duffel: "the duffel", pocket: "your pocket" };

function CoinButton({ bag, index, onMove }: { bag: Bag; index: number; onMove: (to: Bag) => void }) {
  const press = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const finish = (e: PointerEvent<HTMLButtonElement>) => {
    const drag = offset !== null;
    press.current = null;
    setOffset(null);
    if (!drag) return;
    dragged.current = true;
    const target = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.hasAttribute("data-bag"))?.getAttribute("data-bag");
    if ((target === "duffel" || target === "pocket") && target !== bag) onMove(target);
  };
  return (
    <button
      type="button"
      className={offset ? "coin-btn is-dragging" : "coin-btn"}
      data-coin={bag}
      style={offset ? { translate: `${offset.x}px ${offset.y}px` } : undefined}
      aria-label={`Coin ${index + 1} in ${BAG_NAME[bag]}. Tap to move it to ${BAG_NAME[OTHER[bag]]}`}
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
        else onMove(OTHER[bag]);
      }}
    >
      <i className="coin" />
    </button>
  );
}

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

function BagBox({ bag, coins, onMove }: { bag: Bag; coins: number; onMove: (to: Bag) => void }) {
  const title = bag === "duffel" ? "Duffel" : "Pocket";
  return (
    <SketchFrame seed={`bag-${bag}`} radius={12} shadow={0.35} fill={bag === "duffel" ? "var(--good-l)" : "var(--clay-l)"} className={`bag bag--${bag}`} data-bag={bag}>
      <div className="bag__head">
        <BagArt bag={bag} />
        <span className="hand bag__name">{title}</span>
        <b className="num bag__count" aria-label={`${coins} in ${BAG_NAME[bag]}`}>
          {coins}
        </b>
        <InfoTip info={{ kind: "tip", id: bag === "duffel" ? "moveDuffel" : "movePocket" }} />
      </div>
      <div className="bag__coins">
        {coins === 0 ? <span className="meta">Tap or drag a coin here</span> : Array.from({ length: coins }, (_, i) => <CoinButton key={i} bag={bag} index={i} onMove={onMove} />)}
      </div>
    </SketchFrame>
  );
}

export interface CoinBagsProps {
  /** The most coins this room lets you grab (design §3.1). */
  readonly limit: number;
  readonly grab: number;
  readonly bags: Bags;
  /** Grab `n` coins (1 up to the limit). */
  readonly onGrab: (n: number) => void;
  /** One coin goes to `bag`. */
  readonly onMove: (bag: Bag) => void;
  /** The room's bell with what your grab adds (an `AlarmBell`), beside the coins you grab. */
  readonly bell?: ReactNode;
}

/** The row of coins you grab, with the bell preview, and the two bags they go into. */
export function CoinBags({ limit, grab, bags, onGrab, onMove, bell }: CoinBagsProps) {
  return (
    <div className="coin-bags">
      <div className="coin-bags__grab" role="group" aria-label="Coins to grab">
        <span className="hand coin-bags__label">Grab</span>
        {Array.from({ length: limit }, (_, i) => (
          <button
            key={i}
            type="button"
            className="coin-btn"
            aria-pressed={i < grab}
            aria-label={`Coin ${i + 1}, ${i < grab ? "grabbed" : "left"}`}
            onClick={() => onGrab(i < grab ? Math.max(1, i) : i + 1)}
          >
            <i className={i < grab ? "coin" : "coin is-left"} />
          </button>
        ))}
        <span className="coin-bags__fill" />
        {bell}
      </div>
      <div className="coin-bags__bags">
        <BagBox bag="duffel" coins={bags.duffel} onMove={onMove} />
        <BagBox bag="pocket" coins={bags.pocket} onMove={onMove} />
      </div>
    </div>
  );
}
