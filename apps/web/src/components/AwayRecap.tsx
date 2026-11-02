// "While you were away" (design §13; ui-style "Ledger / case file"): the
// recap at the top of the game screen when you come back, as stacked feed
// chirps from the crew's raccoon narrator. Lines come from game/away.ts.
import { RaccoonNarrator } from "../art/Raccoon";
import { Button } from "./Button";
import { SketchFrame } from "./SketchFrame";
import "./casefile.css";

export function AwayRecap({ lines, onDismiss, seed = "away" }: { lines: readonly string[]; onDismiss: () => void; seed?: string }) {
  if (lines.length === 0) return null;
  return (
    <SketchFrame as="section" seed={seed} radius={18} shadow={0.5} tape tilt={-0.4} fill="var(--paper-hi)" className="away" aria-labelledby={`${seed}-h`}>
      <RaccoonNarrator className="away__narrator" size={60} />
      <div className="away__body">
        <h2 id={`${seed}-h`} className="away__title">
          While you were away
        </h2>
        <ul className="away__lines" aria-live="polite">
          {lines.map((l, i) => (
            <li key={`${i}:${l}`} className="away__line" style={{ animationDelay: `${i * 70}ms` }}>
              {l}
            </li>
          ))}
        </ul>
      </div>
      <Button variant="secondary" seed={`${seed}-ok`} className="away__ok" onClick={onDismiss}>
        Caught up
      </Button>
    </SketchFrame>
  );
}
