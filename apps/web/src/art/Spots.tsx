// Spot illustrations (M2-9) for empty states and the end of the game, in the
// same ink-and-flat-fill look as the cutaway. Each is a 240×170 drawing on a
// plinth oval (ui-style §4 item cards) with an accessible title.
import { useId, type ReactNode } from "react";
import { CrookFigure } from "./Crook";

const INK = "var(--art-ink)";
const L = { stroke: INK, strokeWidth: 2.2, strokeLinejoin: "round", strokeLinecap: "round" } as const;
const T = { stroke: INK, strokeWidth: 1.5, strokeLinejoin: "round", strokeLinecap: "round" } as const;

function Spot({ title, className, children }: { title: string; className?: string | undefined; children: ReactNode }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={["spot", className].filter(Boolean).join(" ")} viewBox="0 0 240 170" role="img" aria-label={title}>
      <title>{title}</title>
      <defs>
        <filter id={`${id}-wob`} x="-4%" y="-4%" width="108%" height="108%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale="2.2" />
        </filter>
      </defs>
      <ellipse cx="122" cy="152" rx="104" ry="14" fill="var(--art-shade)" />
      <ellipse cx="120" cy="150" rx="104" ry="14" fill="var(--plinth)" />
      <path d="M30 146c26-8 66-11 106-10" fill="none" stroke="var(--art-hi)" strokeWidth="3" strokeLinecap="round" />
      <g filter={`url(#${id}-wob)`}>{children}</g>
    </svg>
  );
}

function Coin({ x, y, r = 7, tilt = 0 }: { x: number; y: number; r?: number; tilt?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`}>
      <ellipse cx="0" cy="1.6" rx={r} ry={r * 0.56} fill="var(--art-gold-d)" {...T} />
      <ellipse cx="0" cy="0" rx={r} ry={r * 0.56} fill="var(--gold)" {...T} />
      <path d={`M${-r * 0.4} ${-r * 0.1}h${r * 0.5}`} stroke="var(--art-hi)" strokeWidth="1.6" strokeLinecap="round" />
    </g>
  );
}

function Spark({ x, y, s = 1, c = "var(--gold)" }: { x: number; y: number; s?: number; c?: string }) {
  return <path transform={`translate(${x} ${y}) scale(${s})`} d="M0-8C1-2 2-1 8 0 2 1 1 2 0 8-1 2-2 1-8 0-2-1-1-2 0-8Z" fill={c} {...T} strokeWidth={1.2} />;
}

function Sack({ x, y, s = 1, spill = false }: { x: number; y: number; s?: number; spill?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path
        d={spill ? "M-20 0c-6-10 0-22 12-26l-4-6 10-1 6 6c12 2 22 12 20 22-2 6-8 7-14 6l-6-6-6 8z" : "M-4-30c-2-4 0-7 4-7s6 3 4 7c9 3 15 11 14 20-1 8-8 11-18 11s-17-3-18-11c-1-9 5-17 14-20z"}
        fill="var(--art-sack)"
        {...L}
      />
      {!spill && <path d="M2.4-21c-3-2-7 0-6 3s7 2 6 5-6 3-8 1M0-24v16" fill="none" {...L} strokeWidth={1.8} />}
      <path d="M-11-14c0-5 3-9 6-11" fill="none" stroke="var(--art-hi)" strokeWidth="2.4" strokeLinecap="round" />
    </g>
  );
}

function Bar({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M0 0l5-13h22l5 13z" fill="var(--gold)" {...T} strokeWidth={1.7} />
      <path d="M27-13l5 13h-5z" fill="var(--art-gold-d)" />
      <path d="M6-9h14" stroke="var(--art-hi)" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

/** Lobby with nobody in it yet: a crook peeks round the door. */
export function WaitingSpot({ className }: { className?: string }) {
  return (
    <Spot title="A masked crook peeking round a door, waiting for the rest of the crew" className={className}>
      {/* Door frame and the dark room behind */}
      <path d="M78 146V44h70v102" fill="var(--art-stone)" {...L} />
      <path d="M86 146V52h54v94z" fill="var(--art-slate-d)" {...L} />
      <CrookFigure look={5} expression="nervous" x={118} y={146} scale={1.05} flip />
      {/* Door leaf swung open towards us */}
      <path d="M140 146l26 8V40l-26 12z" fill="var(--art-wood)" {...L} />
      <path d="M146 64l14-5v26l-14 5zM146 102l14-4v30l-14 4z" fill="none" stroke="var(--art-wood-d)" strokeWidth="1.8" />
      <circle cx="161" cy="100" r="2.6" fill="var(--gold)" {...T} />
      {/* Mat and a note */}
      <path d="M70 152h86l6 6H64z" fill="var(--art-velvet)" {...L} strokeWidth={1.8} />
      <g transform="translate(40 66) rotate(-6)">
        <rect x="0" y="0" width="36" height="30" rx="2" fill="var(--paper-hi)" {...T} />
        <path d="M6 10h22M6 16h18M6 22h12" stroke="var(--mute)" strokeWidth="1.6" strokeLinecap="round" />
        <rect x="10" y="-4" width="16" height="7" fill="var(--kraft)" opacity=".75" transform="rotate(4 18 0)" />
      </g>
      <g transform="translate(190 70)">
        <path d="M-16-24c0-10 32-10 32 0v14c0 8-20 8-26 8l-8 8 2-10c-2-2-0-14 0-20z" fill="var(--paper-hi)" {...L} strokeWidth={1.8} />
        <text x="0" y="-6" textAnchor="middle" className="crook-fig__q" style={{ fontSize: 20 }}>
          ?
        </text>
      </g>
    </Spot>
  );
}

/** An empty case file: nothing on record yet. */
export function EmptyFileSpot({ className }: { className?: string }) {
  return (
    <Spot title="An empty manila case file with a magnifying glass" className={className}>
      <g transform="translate(120 98) rotate(-4)">
        {/* Folder back, tab, pages */}
        <path d="M-90 44V-46h40l8-10h34l6 10h96v90z" fill="var(--art-stucco-d)" {...L} />
        <path d="M-84 40V-40h80v80zM2 40V-40h80v80z" fill="var(--paper-hi)" {...L} />
        <path d="M-74-24h56M-74-12h44M-74 0h52M12-24h56M12-12h40" stroke="var(--rule)" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
        <path d="M-90 44l4-6h172l4 6z" fill="var(--manilla)" {...L} />
        {/* Paper clip */}
        <path d="M58-48v26c0 6 10 6 10 0v-30c0-10-16-10-16 0v24" fill="none" {...L} stroke="var(--art-steel-d)" strokeWidth={2.6} />
        <path d="M58-48v26c0 6 10 6 10 0v-30c0-10-16-10-16 0v24" fill="none" {...T} strokeWidth={0.9} />
        {/* Coffee ring */}
        <circle cx="-44" cy="20" r="13" fill="none" stroke="var(--art-wood-l)" strokeWidth="3" opacity=".5" />
      </g>
      {/* Magnifying glass */}
      <g transform="translate(170 104) rotate(28)">
        <path d="M0 22v34" {...L} strokeWidth={9} />
        <path d="M0 24v30" stroke="var(--art-wood)" strokeWidth="5" strokeLinecap="round" />
        <circle cx="0" cy="0" r="22" fill="var(--art-glass)" fillOpacity=".65" {...L} strokeWidth={5} />
        <circle cx="0" cy="0" r="22" fill="none" stroke="var(--art-steel-l)" strokeWidth="2" />
        <path d="M-12-8c2-6 6-9 11-10" fill="none" stroke="var(--paper-hi)" strokeWidth="3" strokeLinecap="round" />
      </g>
    </Spot>
  );
}

/** Game over, job done: the winner on top of the haul. */
export function JobDoneSpot({ className, look = 0 }: { className?: string; look?: number }) {
  return (
    <Spot title="A masked crook cheering on top of a pile of gold and loot sacks" className={className}>
      {/* Pile */}
      <Sack x={62} y={146} s={1.1} />
      <Sack x={182} y={146} s={1.05} />
      {[78, 110, 142].map((x) => (
        <Bar key={x} x={x} y={146} />
      ))}
      {[94, 126].map((x) => (
        <Bar key={x} x={x} y={133} />
      ))}
      <Bar x={110} y={120} />
      <CrookFigure look={look} expression="smug" armsUp x={126} y={121} scale={1.05} sack />
      {/* Coins in the air and sparkles */}
      <Coin x={52} y={70} tilt={-20} />
      <Coin x={196} y={54} r={6} tilt={25} />
      <Coin x={36} y={112} r={6} tilt={10} />
      <Coin x={210} y={104} tilt={-12} />
      <Spark x={74} y={34} />
      <Spark x={176} y={24} s={0.8} c="var(--clay)" />
      <Spark x={222} y={76} s={0.7} />
      <Spark x={22} y={84} s={0.7} c="var(--sky)" />
    </Spot>
  );
}

/** Game over, busted: caught in the spotlight, the loot spilt. */
export function BustedSpot({ className, look = 1 }: { className?: string; look?: number }) {
  return (
    <Spot title="A masked crook caught in a spotlight with hands up, the loot sack spilt on the floor" className={className}>
      {/* Spotlight cone */}
      <path d="M20 0L60 0 168 150H66z" fill="var(--art-window-hi)" opacity=".55" />
      <ellipse cx="117" cy="148" rx="54" ry="10" fill="var(--art-window-hi)" opacity=".75" />
      {/* Police light */}
      <g transform="translate(200 46)">
        <path d="M-20-8l-10-6M-22 2h-12M-12-18l-6-9" fill="none" {...L} stroke="var(--art-siren-r)" strokeWidth={3} className="spot-anim bank-siren" />
        <path d="M20-8l10-6M22 2h12M12-18l6-9" fill="none" {...L} stroke="var(--art-siren-b)" strokeWidth={3} className="spot-anim bank-siren bank-siren--b" />
        <path d="M-16 8c0-18 32-18 32 0z" fill="var(--art-siren-r)" {...L} />
        <path d="M0-10c9 0 16 7 16 18H0z" fill="var(--art-siren-b)" />
        <path d="M-16 8c0-18 32-18 32 0z" fill="none" {...L} />
        <rect x="-20" y="8" width="40" height="9" rx="2" fill="var(--art-slate)" {...L} />
        <path d="M-10-2c2-4 5-6 8-6" fill="none" stroke="var(--paper-hi)" strokeWidth="2.4" strokeLinecap="round" />
      </g>
      <CrookFigure look={look} expression="caught" x={116} y={146} scale={1.08} />
      {/* Spilt sack */}
      <Sack x={176} y={148} s={0.9} spill />
      <Coin x={150} y={148} r={6} tilt={-8} />
      <Coin x={160} y={140} r={5} tilt={20} />
      <Coin x={196} y={150} r={6} tilt={6} />
      {/* Alarm ticks */}
      <path d="M44 66l-12-6M42 86h-14M46 104l-12 6" fill="none" {...L} stroke="var(--bad)" />
    </Spot>
  );
}
