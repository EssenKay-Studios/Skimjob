// A crooked clay pencil underline under a heading (ui-style §3, panel h3).
import { useMemo, type ReactNode } from "react";
import { rngFrom, type Seed } from "./sketch";

export function Underline({ children, seed = "u", colour = "var(--clay)" }: { children: ReactNode; seed?: Seed; colour?: string }) {
  const d = useMemo(() => {
    const r = rngFrom(seed);
    const y0 = 4 + r() * 2;
    const y1 = 3 + r() * 3;
    const y2 = 4 + r() * 2.5;
    return `M1 ${y0.toFixed(1)} C 30 ${(y0 - 2).toFixed(1)}, 55 ${(y1 + 1.5).toFixed(1)}, 70 ${y1.toFixed(1)} S 96 ${(y2 - 1).toFixed(1)}, 99 ${y2.toFixed(1)}`;
  }, [seed]);
  return (
    <span className="underline">
      {children}
      <svg viewBox="0 0 100 9" preserveAspectRatio="none" aria-hidden="true">
        <path d={d} fill="none" stroke={colour} strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}
