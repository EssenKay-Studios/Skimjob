// Host controls (M2-13, design §15, §16): the paused note everyone sees, the note
// for a player whose seat a bot is keeping warm, and the host's panel in the game
// Menu (pause / resume, add time, replace an idle seat with a bot, hand a seat
// back, end the game early).
import type { SeatOffer } from "../game/host";
import { Button, DangerButton } from "./Button";
import { Chip } from "./Chip";
import { Banner } from "./MeetingKit";
import "./host.css";

/** Everyone: the host stopped every clock. */
export function PausedBanner() {
  return (
    <Banner seed="paused" title="Paused by the host">
      Every clock is stopped until the host resumes. You can still plan and chat.
    </Banner>
  );
}

/** The player whose seat a stand-in bot plays: take it back to act again. */
export function StandInBanner({ busy, onTakeBack }: { busy: boolean; onTakeBack: () => void }) {
  return (
    <Banner tone="bad" seed="stand-in" title="A bot is playing your seat">
      <div className="host-note">
        <span>It moved for you while you were away. Take your seat back to play again.</span>
        <Button variant="primary" seed="take-back" disabled={busy} onClick={onTakeBack}>
          Take my seat back
        </Button>
      </div>
    </Banner>
  );
}

export interface HostPanelProps {
  readonly paused: boolean;
  /** There's a phase clock to add time to (planning or an open meeting). */
  readonly canExtend: boolean;
  readonly offers: readonly SeatOffer[];
  readonly busy: boolean;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onExtend: () => void;
  readonly onReplace: (seat: number) => void;
  readonly onHandBack: (seat: number) => void;
  /** After the confirm step. design §6.2 */
  readonly onEnd: () => void;
}

/** The host's panel, in the game Menu. */
export function HostPanel({ paused, canExtend, offers, busy, onPause, onResume, onExtend, onReplace, onHandBack, onEnd }: HostPanelProps) {
  return (
    <section className="host-panel" aria-labelledby="host-panel-h">
      <h3 id="host-panel-h" className="host-panel__summary">
        <span>Host controls</span>
        {paused && (
          <span className="host-panel__state">
            <Chip colour="var(--gold)">Paused</Chip>
          </span>
        )}
      </h3>
      <div className="host-panel__body">
        <div className="host-panel__row">
          {paused ? (
            <Button variant="primary" seed="host-resume" disabled={busy} onClick={onResume}>
              Resume the game
            </Button>
          ) : (
            <Button seed="host-pause" disabled={busy} onClick={onPause}>
              Pause the game
            </Button>
          )}
          <Button seed="host-extend" disabled={busy || !canExtend} onClick={onExtend}>
            Add time
          </Button>
        </div>
        {offers.length > 0 && (
          <ul className="host-panel__seats">
            {offers.map((o) => (
              <li key={o.seat.seat} className="host-panel__seat">
                <span className="host-panel__name">
                  {o.seat.name}
                  <span className="meta">{o.kind === "replace" ? " · missed rounds in a row" : " · a bot is playing"}</span>
                </span>
                {o.kind === "replace" ? (
                  <DangerButton seed={`host-bot-${o.seat.seat}`} disabled={busy} armedLabel="Replace?" aria-label={`Replace ${o.seat.name} with a bot`} onConfirm={() => onReplace(o.seat.seat)}>
                    Replace with a bot
                  </DangerButton>
                ) : (
                  <Button variant="small" seed={`host-back-${o.seat.seat}`} disabled={busy} aria-label={`Hand the seat back to ${o.seat.name}`} onClick={() => onHandBack(o.seat.seat)}>
                    Hand back
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="meta host-panel__hint">Pausing stops every clock. Add time gives the current phase a little longer.</p>
        <DangerButton seed="host-end" disabled={busy} armedLabel="End it for everyone?" onConfirm={onEnd}>
          End game early
        </DangerButton>
        <p className="meta host-panel__hint">Ends the job for everyone: nobody wins, nothing is scored and there is no reveal.</p>
      </div>
    </section>
  );
}
