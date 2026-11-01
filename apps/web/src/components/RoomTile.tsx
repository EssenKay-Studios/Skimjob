// A room in the move picker (ui-style "Round-move panel"): an item tile with
// the room's name, a loot swatch and a Heat hint. Selected: clay outline that
// boils, plus a pin.
import { FrameArt, useElementSize } from "./SketchFrame";

export type HeatHint = "up" | "down" | "none";

export interface RoomTileProps {
  readonly name: string;
  readonly loot: number;
  readonly heat: HeatHint;
  readonly notes?: readonly string[];
  readonly selected?: boolean;
  readonly disabled?: boolean;
  /** Shown instead of the notes when disabled (e.g. "Closed by Lockdown"). */
  readonly disabledNote?: string;
  readonly onSelect?: () => void;
  readonly seed: string;
}

const HEAT_TEXT: Record<HeatHint, string> = { up: "Heat ↑", down: "Heat ↓", none: "No Heat" };

export function RoomTile({ name, loot, heat, notes = [], selected, disabled, disabledNote, onSelect, seed }: RoomTileProps) {
  const [ref, size] = useElementSize<HTMLButtonElement>();
  const cls = ["room-tile", selected && "is-selected", disabled && "is-closed"].filter(Boolean).join(" ");
  return (
    <button ref={ref} type="button" className={cls} aria-pressed={!!selected} disabled={disabled} onClick={onSelect} data-room={name}>
      {size && <FrameArt w={size.w} h={size.h} seed={seed} radius={12} stroke={1.6} wobble={0.9} shadow={selected ? 0.5 : 0.3} grain={false} boil={!!selected} />}
      {selected && <span className="room-tile__pin" aria-hidden="true" />}
      <span className="room-tile__name">{name}</span>
      <span className="room-tile__loot">
        {loot > 0 && (
          <span className="room-tile__bar" aria-hidden="true">
            {Array.from({ length: Math.min(loot, 8) }, (_, i) => (
              <i key={i} />
            ))}
          </span>
        )}
        <span className="num">{loot === 0 ? "No loot" : `Loot ${loot}`}</span>
      </span>
      <span className={`room-tile__heat room-tile__heat--${heat}`}>{HEAT_TEXT[heat]}</span>
      {(disabled && disabledNote ? [disabledNote] : notes).map((n) => (
        <span key={n} className="room-tile__note">
          {n}
        </span>
      ))}
    </button>
  );
}
