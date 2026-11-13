// /dev/gallery: the host controls (M2-13), live with local state.
import { useState, type ReactNode } from "react";
import { HostPanel, PausedBanner, StandInBanner } from "../components/HostPanel";
import { SketchFrame } from "../components/SketchFrame";
import { useToast } from "../components/Toast";
import { Underline } from "../components/Underline";
import { seatOffers, type Control } from "../game/host";

const SEATS = [
  { seat: 0, playerId: "p1", name: "You (host)" },
  { seat: 1, playerId: "p2", name: "Ben" },
  { seat: 2, playerId: "p3", name: "Cyrillia Featherstonehaugh" },
];

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <SketchFrame as="section" seed={`g-${id}`} radius={16} shadow={0.5} className="g-section" aria-labelledby={`g-${id}`}>
      <header className="g-section__head">
        <h3 id={`g-${id}`}>
          <Underline seed={id}>{title}</Underline>
        </h3>
        {note && <p className="meta">{note}</p>}
      </header>
      {children}
    </SketchFrame>
  );
}

export function HostSection() {
  const toast = useToast();
  const [control, setControl] = useState<Control>({ pausedAt: null, standIns: ["p3"], idle: ["p2"] });
  const [mine, setMine] = useState(true);
  const seat = (id: number) => SEATS.find((s) => s.seat === id)!.playerId;
  return (
    <Section id="host" title="Host controls" note="M2-13 · pause / resume, add time, replace an idle seat with a bot, hand back, end the game early">
      <div className="game-host">
        {control.pausedAt !== null && <PausedBanner />}
        {mine && <StandInBanner busy={false} onTakeBack={() => setMine(false)} />}
        <HostPanel
          paused={control.pausedAt !== null}
          canExtend
          offers={seatOffers(control, SEATS, "p1")}
          busy={false}
          onPause={() => setControl((c) => ({ ...c, pausedAt: Date.now() }))}
          onResume={() => setControl((c) => ({ ...c, pausedAt: null }))}
          onExtend={() => toast("Added 2 min.", "good")}
          onReplace={(s) => setControl((c) => ({ ...c, standIns: [...c.standIns, seat(s)], idle: c.idle.filter((p) => p !== seat(s)) }))}
          onHandBack={(s) => setControl((c) => ({ ...c, standIns: c.standIns.filter((p) => p !== seat(s)) }))}
          onEnd={() => toast("Ended early (gallery only).", "good")}
        />
      </div>
    </Section>
  );
}
