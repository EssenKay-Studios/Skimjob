// A room in the move picker (ui-style "Round-move panel"): an item tile with
// the room's name, a loot swatch and its bell. Selected: clay outline that
// boils, plus a pin.
import type { ReactNode } from "react";
import { FrameArt, useElementSize } from "./SketchFrame";

export interface RoomTileProps {
  readonly name: string;
  readonly loot: number;
  /** The room's bell, e.g. "Bell 2 of 4". design §5.1 */
  readonly bell: string;
  readonly notes?: readonly string[];
  readonly selected?: boolean;
  readonly disabled?: boolean;
  /** Shown instead of the notes when disabled (e.g. "Closed by Lockdown", "Taped off through round 4"). */
  readonly disabledNote?: string;
  readonly onSelect?: () => void;
  readonly seed: string;
  /** A room icon before the name (e.g. `<RoomIcon>`), decorative. */
  readonly icon?: ReactNode;
}

export function RoomTile({ name, loot, bell, notes = [], selected, disabled, disabledNote, onSelect, seed, icon }: RoomTileProps) {
  const [ref, size] = useElementSize<HTMLButtonElement>();
  const cls = ["room-tile", selected && "is-selected", disabled && "is-closed"].filter(Boolean).join(" ");
  return (
    <button ref={ref} type="button" className={cls} aria-pressed={!!selected} disabled={disabled} onClick={onSelect} data-room={name}>
      {size && <FrameArt w={size.w} h={size.h} seed={seed} radius={12} stroke={1.6} wobble={0.9} shadow={selected ? 0.5 : 0.3} grain={false} boil={!!selected} />}
      {selected && <span className="room-tile__pin" aria-hidden="true" />}
      <span className="room-tile__head">
        {icon && (
          <span className="room-tile__icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="room-tile__name">{name}</span>
      </span>
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
      <span className="room-tile__bell">{bell}</span>
      {(disabled && disabledNote ? [disabledNote] : notes).map((n) => (
        <span key={n} className="room-tile__note">
          {n}
        </span>
      ))}
    </button>
  );
}
