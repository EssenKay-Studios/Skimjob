import type { ReactNode } from "react";

export function Chip({ children, colour, on }: { children: ReactNode; colour?: string; on?: boolean }) {
  return (
    <span className={on ? "chip is-on" : "chip"} style={colour ? ({ "--c": colour } as React.CSSProperties) : undefined}>
      {!on && colour && <span className="chip__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
