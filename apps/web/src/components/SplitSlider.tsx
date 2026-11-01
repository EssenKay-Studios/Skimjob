// The split slider (ui-style "Round-move panel"): how much of a room's loot
// goes to the crew's Haul and how much you pocket. A native range input, so
// keys, touch and screen readers work; drawn as a hatched paper track. Its
// value is the Haul share: left of the handle is "To Haul", right is "Pocket".
import type { CSSProperties } from "react";

export interface SplitSliderProps {
  readonly id: string;
  /** The room's listed loot (the real yield can be lower: the pocket is capped then). */
  readonly loot: number;
  readonly pocket: number;
  readonly onChange: (pocket: number) => void;
  readonly disabled?: boolean;
}

export function SplitSlider({ id, loot, pocket, onChange, disabled }: SplitSliderProps) {
  const p = Math.max(0, Math.min(loot, pocket));
  const greedy = loot > 0 && p / loot > 0.5;
  const style = { "--split": `${loot > 0 ? ((loot - p) / loot) * 100 : 100}%` } as CSSProperties;
  return (
    <div className={["split", disabled && "is-disabled"].filter(Boolean).join(" ")} style={style}>
      <div className="split__nums" aria-hidden="true">
        <span className="split__haul">
          To Haul <b className="num">{loot - p}</b>
        </span>
        <span className={greedy ? "split__pocket is-greedy" : "split__pocket"} key={greedy ? "g" : "n"}>
          Pocket → Stash <b className="num">{p}</b>
        </span>
      </div>
      <input
        id={id}
        className="split__input"
        type="range"
        min={0}
        max={loot}
        step={1}
        value={loot - p}
        disabled={disabled}
        aria-label="Hand in to the Haul"
        aria-valuetext={`${loot - p} to the Haul, pocket ${p}`}
        onChange={(e) => onChange(loot - Number(e.target.value))}
      />
    </div>
  );
}
