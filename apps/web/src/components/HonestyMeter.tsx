// The honesty meter: coins that reached the duffel against the honesty line. Public, live. design §7.5, §15
import { honesty } from "@skimjob/engine";
import { lineText } from "@skimjob/content";
import { InfoTip } from "./InfoTip";
import "./honesty-meter.css";

export function HonestyMeter({ reached, taken, line }: { readonly reached: number; readonly taken: number; readonly line: number }) {
  const share = honesty({ reached, taken }); // reads full while nothing is taken (design §7.5)
  const pct = Math.round(share * 100);
  return (
    <div className="hud__stat hud__honesty">
      <span className="meta">
        Honesty <InfoTip info={{ kind: "term", id: "honesty" }} />
      </span>
      <div
        className={share >= line ? "honesty" : "honesty is-sunk"}
        role="meter"
        aria-label="Honesty"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}% of what is taken reached the duffel; the line is ${lineText(line)}`}
      >
        <span className="honesty__fill" style={{ width: `${pct}%` }} />
        <span className="honesty__line" style={{ left: `${line * 100}%` }} />
      </div>
      <span className="meta">
        <b className="num">{pct}%</b> · line {lineText(line)}
      </span>
    </div>
  );
}
