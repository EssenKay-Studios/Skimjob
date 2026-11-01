// Meters (ui-style "Heat meter", "Haul counter"): a horizontal hatched bar with
// an optional gold target notch, and the vertical Heat thermometer.
import type { CSSProperties } from "react";

export interface MeterProps {
  readonly value: number;
  readonly max: number;
  /** A gold notch at this value (the Haul's target). */
  readonly notch?: number | undefined;
  /** Fill colour token, e.g. "var(--olive)". */
  readonly tone?: string;
  /** Accessible name, e.g. "Haul". */
  readonly label: string;
}

const pct = (v: number, max: number) => `${Math.max(0, Math.min(100, max > 0 ? (v / max) * 100 : 0))}%`;

export function Meter({ value, max, notch, tone = "var(--olive)", label }: MeterProps) {
  const style = { "--m-fill": pct(value, max), "--m-tone": tone, ...(notch !== undefined && { "--m-notch": pct(notch, max) }) } as CSSProperties;
  return (
    <span className="meter" style={style} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span className="meter__fill" aria-hidden="true" />
      {notch !== undefined && <span className="meter__notch" aria-hidden="true" />}
    </span>
  );
}

/** Heat bands: calm, warm, hot, critical (ui-style: olive → gold → clay → bad). */
export const heatBand = (heat: number, max = 100) => (heat >= 0.9 * max ? "crit" : heat >= 0.7 * max ? "hot" : heat >= 0.4 * max ? "warm" : "calm");

export function HeatMeter({ heat, max = 100, size = "md" }: { heat: number; max?: number; size?: "sm" | "md" }) {
  const band = heatBand(heat, max);
  return (
    <span
      className={`thermo thermo--${band} thermo--${size}`}
      style={{ "--m-fill": pct(heat, max) } as CSSProperties}
      role="meter"
      aria-label="Heat"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={heat}
    >
      <span className="thermo__fill" aria-hidden="true" />
    </span>
  );
}
