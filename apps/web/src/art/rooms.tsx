// Room interiors for the bank cutaway (M2-9). Each draws in its own local
// box (0,0 top-left, w×h, floor at the bottom) and adapts to its width: props
// anchor to the left/right edges and repeated details (columns, racks,
// windows, box grids) fill whatever width the layout gives. Our own designs.
import type { CSSProperties, ReactNode } from "react";
import type { BankRoomId } from "./bankLayout";

export interface RoomCtx {
  readonly w: number;
  readonly h: number;
  /** Unique prefix for pattern ids. */
  readonly uid: string;
  /** The Vault only: the share of the bank pile still to steal, 0–1 (design §6.1). */
  readonly pile?: number;
}

const INK = "var(--art-ink)";
const L = { stroke: INK, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" } as const;
const T = { stroke: INK, strokeWidth: 1.4, strokeLinejoin: "round", strokeLinecap: "round" } as const;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function Shadow({ cx, y, rx }: { cx: number; y: number; rx: number }) {
  return <ellipse cx={cx} cy={y} rx={rx} ry={3.2} fill="var(--art-shade)" />;
}

/** Floor strip with an optional pattern fill. */
function Floor({ w, h, fill, depth = 12 }: { w: number; h: number; fill: string; depth?: number }) {
  return (
    <>
      <rect x="0" y={h - depth} width={w} height={depth} fill={fill} />
      <path d={`M0 ${h - depth}H${w}`} {...T} strokeOpacity=".7" />
    </>
  );
}

/** Skirting board along the back wall. */
function Skirting({ w, h, fill = "var(--art-wood-d)" }: { w: number; h: number; fill?: string }) {
  return <rect x="0" y={h - 18} width={w} height={6} fill={fill} opacity=".8" />;
}

function Plant({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <Shadow cx={0} y={0} rx={15} />
      <path d="M-2-24c-10-6-20-4-24 2 8 0 15 2 22 6M2-24c8-8 18-9 24-4-8 1-15 4-21 9M0-22c-2-12 2-22 10-26 0 9-3 17-8 24M-1-22c-6-10-14-14-21-12 5 4 11 9 17 15" fill="var(--art-leaf)" {...L} strokeWidth={1.7} />
      <path d="M-2-24c-6-3-12-4-16-1M3-22c5-4 10-6 15-5" fill="none" stroke="var(--art-leaf-d)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M-10-20h20l-3 20h-14z" fill="var(--art-roof)" {...L} />
      <path d="M-10-20h20v4h-20z" fill="var(--art-roof-d)" {...L} strokeWidth={1.6} />
    </g>
  );
}

function Stanchions({ x0, x1, y }: { x0: number; x1: number; y: number }) {
  const n = Math.max(2, Math.round((x1 - x0) / 44) + 1);
  const step = (x1 - x0) / (n - 1);
  const xs = Array.from({ length: n }, (_, i) => x0 + i * step);
  return (
    <g>
      {xs.slice(1).map((x, i) => (
        <path key={i} d={`M${xs[i]! + 1} ${y - 26}Q${(xs[i]! + x) / 2} ${y - 13} ${x - 1} ${y - 26}`} fill="none" stroke="var(--art-velvet)" strokeWidth="3.6" strokeLinecap="round" />
      ))}
      {xs.map((x, i) => (
        <g key={i}>
          <Shadow cx={x} y={y} rx={7} />
          <path d={`M${x} ${y - 2}V${y - 28}`} {...L} strokeWidth={4.4} />
          <path d={`M${x} ${y - 2}V${y - 28}`} stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" />
          <path d={`M${x - 6} ${y}h12`} {...L} strokeWidth={3} />
          <circle cx={x} cy={y - 30} r="3.2" fill="var(--gold)" {...T} />
        </g>
      ))}
    </g>
  );
}

function Chair({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`}>
      <Shadow cx={0} y={0} rx={13} />
      <path d="M-11 0l11-4 11 4M0-4v-10" fill="none" {...L} strokeWidth={1.8} />
      <path d="M-12-20h22v6h-22z" fill="var(--art-slate)" {...L} strokeWidth={1.8} />
      <path d="M-14-46c0-3 2-5 5-5h4c3 0 4 2 4 5v24h-13z" fill="var(--art-slate-l)" {...L} strokeWidth={1.8} />
      <path d="M-11-44v20" stroke="var(--art-hi)" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

function Sack({ x, y, s = 1, flip = false }: { x: number; y: number; s?: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      <Shadow cx={0} y={0} rx={17} />
      <path d="M-4-30c-2-4 0-7 4-7s6 3 4 7c9 3 15 11 14 20-1 8-8 11-18 11s-17-3-18-11c-1-9 5-17 14-20z" fill="var(--art-sack)" {...L} />
      <path d="M-5-30c3 2 7 2 10 0" fill="none" {...T} />
      <path d="M2.4-21c-3-2-7 0-6 3s7 2 6 5-6 3-8 1M0-24v16" fill="none" {...L} strokeWidth={1.7} />
      <path d="M-12-14c0-5 3-9 6-11" fill="none" stroke="var(--art-hi)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M8-27c4 2 8 6 9 10" fill="none" stroke="var(--art-sack-d)" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

/** Bars in a pyramid of `rows` rows. */
const barsIn = (rows: number) => (rows * (rows + 1)) / 2;

/** A pyramid of gold bars; `show` bars are left, the top ones going first (the pile shrinking). */
function GoldStack({ x, y, rows = 3, show = barsIn(rows) }: { x: number; y: number; rows?: number; show?: number }) {
  const bars: ReactNode[] = [];
  let left = show;
  for (let r = 0; r < rows; r++) {
    const n = rows - r;
    for (let i = 0; i < n && left > 0; i++) {
      left--;
      const bx = x + i * 26 + r * 13;
      const by = y - (r + 1) * 11;
      bars.push(
        <g key={`${r}-${i}`} className="gold-bar">
          <path d={`M${bx} ${by + 11}l4-11h18l4 11z`} fill="var(--gold)" {...T} strokeWidth={1.6} />
          <path d={`M${bx + 4} ${by + 2.5}h12`} stroke="var(--art-hi)" strokeWidth="1.8" strokeLinecap="round" />
          <path d={`M${bx + 22} ${by}l4 11h-4z`} fill="var(--art-gold-d)" />
        </g>,
      );
    }
  }
  return (
    <g>
      <Shadow cx={x + rows * 13} y={y} rx={rows * 14} />
      {bars}
    </g>
  );
}

function CashCart({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Shadow cx={26} y={0} rx={30} />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={2 + i * 11} y={-46 + (i % 2) * 3} width="10" height="14" rx="1.4" fill="var(--art-leaf)" {...T} />
          <path d={`M${2 + i * 11} ${-40 + (i % 2) * 3}h10`} stroke="var(--paper-hi)" strokeWidth="2.4" />
        </g>
      ))}
      <path d="M-4-36h56l-5 24H1z" fill="var(--art-steel-l)" {...L} />
      <path d="M2-28h44M4-20h40" {...T} strokeOpacity=".5" />
      <path d="M52-36l10-14" {...L} strokeWidth={3} />
      <circle cx="9" cy="-6" r="5.4" fill="var(--art-slate)" {...L} strokeWidth={1.8} />
      <circle cx="40" cy="-6" r="5.4" fill="var(--art-slate)" {...L} strokeWidth={1.8} />
    </g>
  );
}

/** A window onto the outside: the glass follows the time of day (--bank-glass). */
function Window({ x, y, w, h, arch = false, frame = "var(--art-stone-l)" }: { x: number; y: number; w: number; h: number; arch?: boolean; frame?: string }) {
  const r = w / 2;
  const d = arch ? `M${x} ${y + h}V${y + r}a${r} ${r} 0 0 1 ${w} 0V${y + h}z` : `M${x} ${y}h${w}v${h}h${-w}z`;
  return (
    <g>
      <path d={d} fill="var(--bank-glass)" stroke={frame} strokeWidth="7" strokeLinejoin="round" />
      <path d={d} fill="none" {...L} />
      <path d={`M${x + w / 2} ${y + (arch ? 2 : 0)}V${y + h}M${x} ${y + h * 0.55}h${w}`} {...T} strokeWidth={2.2} stroke={frame} />
      <path d={`M${x + w / 2} ${y + (arch ? 2 : 0)}V${y + h}M${x} ${y + h * 0.55}h${w}`} {...T} strokeWidth={1} />
      <path d={`M${x + 6} ${y + h * 0.5}l${w * 0.22} ${-h * 0.22}`} stroke="var(--art-hi)" strokeWidth="2.6" strokeLinecap="round" className="bank-glint" />
      <path d={`M${x - 5} ${y + h + 1}h${w + 10}`} {...L} strokeWidth={3.4} />
    </g>
  );
}

// ---------------------------------------------------------------- Rooftop

function Rooftop({ w, h, uid }: RoomCtx) {
  const F = h - 9;
  const narrow = w < 420;
  const tower = w - (narrow ? 86 : 118);
  const mast = narrow ? w * 0.5 : w * 0.56;
  return (
    <g>
      <defs>
        <pattern id={`${uid}-gravel`} width="18" height="9" patternUnits="userSpaceOnUse">
          <rect width="18" height="9" fill="var(--art-stone-d)" />
          <circle cx="4" cy="3" r="1.1" fill="var(--art-stucco-d)" />
          <circle cx="12" cy="6" r="1.3" fill="var(--art-shade-2)" />
          <circle cx="15" cy="2" r=".8" fill="var(--art-stucco-d)" />
        </pattern>
      </defs>
      <rect x="0" y={F} width={w} height={h - F} fill={`url(#${uid}-gravel)`} />
      <path d={`M0 ${F}H${w}`} {...T} />

      {/* HVAC unit with a spinning fan */}
      <g transform={`translate(${narrow ? 22 : 34} ${F})`}>
        <Shadow cx={40} y={0} rx={44} />
        <path d="M-2 0v-6h84v6" fill="var(--art-steel-d)" {...L} strokeWidth={1.8} />
        <rect x="0" y="-48" width="80" height="42" rx="3" fill="var(--art-steel-l)" {...L} />
        <rect x="64" y="-48" width="16" height="42" fill="var(--art-shade)" />
        <path d="M8-40h20M8-33h20M8-26h20M8-19h20" {...T} strokeOpacity=".7" />
        <circle cx="50" cy="-27" r="15" fill="var(--art-steel-d)" {...L} />
        <g className="bank-fan" style={{ transformOrigin: "50px -27px" }}>
          <path d="M50-27c-2-7 0-12 4-13 2 4 0 9-4 13zM50-27c7-1 11 2 11 6-4 1-8-2-11-6zM50-27c-4 5-9 7-12 4 1-4 6-5 12-4z" fill="var(--art-steel-l)" {...T} />
        </g>
        <circle cx="50" cy="-27" r="2.6" fill={INK} />
        <path d="M80-14h12v14" fill="none" {...L} strokeWidth={5.6} />
        <path d="M80-14h12v14" fill="none" stroke="var(--art-steel)" strokeWidth="2.6" />
      </g>

      {/* Stair hut with its door ajar */}
      {!narrow && (
        <g transform={`translate(${mast - 120} ${F})`}>
          <Shadow cx={24} y={0} rx={28} />
          <rect x="0" y="-50" width="48" height="50" fill="var(--art-stone)" {...L} />
          <rect x="34" y="-50" width="14" height="50" fill="var(--art-shade)" />
          <path d="M-5-50h58v-7h-58z" fill="var(--art-stone-d)" {...L} strokeWidth={1.8} />
          <path d="M10 0v-36h22V0" fill="var(--art-slate-d)" {...L} strokeWidth={1.8} />
          <path d="M10 0l-8 3v-38l8-1z" fill="var(--art-wood)" {...L} strokeWidth={1.8} />
        </g>
      )}

      {/* Radio mast with the crew's flag */}
      <g transform={`translate(${mast} ${F})`}>
        <path d="M-12 0L0-82 12 0M-8-28h16M-5-52h10" fill="none" {...L} />
        <path d="M0-82v-10" {...L} />
        <path d="M1-91c7-4 12 3 21-1v12c-9 4-14-3-21 1z" fill="var(--clay)" {...L} strokeWidth={1.8} className="bank-flag" />
        <circle cx="0" cy="-82" r="2.6" fill="var(--bad)" className="bank-beacon" />
      </g>

      {/* Water tower */}
      <g transform={`translate(${tower} ${F})`}>
        <Shadow cx={30} y={0} rx={34} />
        <path d="M6 0l4-30M54 0l-4-30M10-30L50 0M50-30L10 0" fill="none" {...L} strokeWidth={1.8} />
        <path d="M2-30h56" {...L} strokeWidth={3} />
        <path d="M4-30v-46c0-3 52-3 52 0v46z" fill="var(--art-wood-l)" {...L} />
        <path d="M17-32v-46M30-31v-48M43-32v-46" {...T} strokeOpacity=".55" />
        <path d="M4-42c17 3 35 3 52 0M4-64c17 3 35 3 52 0" fill="none" {...L} strokeWidth={2.4} stroke="var(--art-slate)" />
        <path d="M4-42c17 3 35 3 52 0M4-64c17 3 35 3 52 0" fill="none" {...T} />
        <path d="M45-32v-44" stroke="var(--art-shade-2)" strokeWidth="9" />
        <path d="M0-75L30-96 60-75c-20 4-40 4-60 0z" fill="var(--art-roof)" {...L} />
        <path d="M30-96 60-75c-8 2-16 3-24 3z" fill="var(--art-roof-d)" />
      </g>

      {/* A pigeon on the parapet */}
      <g transform={`translate(${w - 18} ${F - 18})`}>
        <path d="M-9 0c0-7 5-11 11-10 3-4 8-3 9 1l4 1-4 2c1 6-3 9-9 9-6 0-11-1-11-3z" fill="var(--art-slate-l)" {...T} />
        <circle cx="7" cy="-8" r="1" fill={INK} />
        <path d="M-2 3v3M2 3v3" {...T} />
      </g>
    </g>
  );
}

// ---------------------------------------------------------------- Security

function Security({ w, h, uid }: RoomCtx) {
  const F = h - 8;
  const cols = clamp(Math.floor((w - 84) / 40), 2, 4);
  const gridW = cols * 40 - 6;
  const gx = w - gridW - 16;
  const scenes = ["door", "dot", "line", "vault", "dot", "door", "line", "vault"];
  return (
    <g>
      <defs>
        <pattern id={`${uid}-panel`} width="34" height="20" patternUnits="userSpaceOnUse">
          <path d="M0 .5H34M.5 0V20" stroke="var(--art-shade)" strokeWidth="1.2" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${uid}-panel)`} />
      <Floor w={w} h={h} fill="var(--art-slate-d)" />

      {/* Key rack */}
      <g transform="translate(16 48)">
        <rect x="0" y="0" width="40" height="18" rx="2" fill="var(--art-wood)" {...T} />
        {[8, 20, 32].map((x, i) => (
          <g key={x}>
            <path d={`M${x} 6v6`} {...T} />
            <circle cx={x} cy={15 + (i % 2) * 2} r="2.6" fill="var(--gold)" {...T} strokeWidth={1.1} />
            <path d={`M${x} ${18 + (i % 2) * 2}v6`} stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" />
          </g>
        ))}
      </g>

      {/* Ceiling camera */}
      <g transform={`translate(${gx - 14} 0)`}>
        <path d="M0 0v10" {...L} />
        <path d="M-14 10l18-2 3 10-17 4z" fill="var(--art-steel-l)" {...L} strokeWidth={1.8} />
        <path d="M-14 10l-4 7 2 5 2-8" fill="var(--art-steel-d)" {...T} />
        <circle cx="-9" cy="16" r="1.8" fill="var(--bad)" className="bank-beacon" />
      </g>

      {/* Monitor wall */}
      {Array.from({ length: cols * 2 }, (_, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const x = gx + c * 40;
        const y = 30 + r * 32;
        const s = scenes[i % scenes.length];
        return (
          <g key={i}>
            <rect x={x} y={y} width="34" height="27" rx="3" fill="var(--art-slate-d)" {...L} strokeWidth={1.7} />
            <rect x={x + 3.5} y={y + 3.5} width="27" height="20" rx="1.6" fill="var(--art-screen)" className={i === 1 ? "bank-flicker" : undefined} />
            <path d={`M${x + 4} ${y + 17}h26`} stroke="var(--art-screen-d)" strokeWidth="1.2" />
            {s === "door" && <path d={`M${x + 20} ${y + 17}v-8h5v8`} fill="var(--art-screen-d)" />}
            {s === "dot" && <circle cx={x + 12 + (i % 3) * 4} cy={y + 13} r="3" fill="var(--art-screen-d)" />}
            {s === "vault" && <circle cx={x + 17} cy={y + 12} r="4.6" fill="none" stroke="var(--art-screen-d)" strokeWidth="1.6" />}
            {s === "line" && <path d={`M${x + 7} ${y + 9}h12M${x + 7} ${y + 12.5}h8`} stroke="var(--art-screen-d)" strokeWidth="1.4" />}
            <path d={`M${x + 6} ${y + 6}l6 0`} stroke="var(--art-hi)" strokeWidth="1.6" strokeLinecap="round" />
          </g>
        );
      })}

      {/* Console desk */}
      <g transform={`translate(${gx - 8} ${F})`}>
        <Shadow cx={(gridW + 16) / 2} y={0} rx={(gridW + 16) / 2} />
        <path d={`M0 0V-30h${gridW + 16}V0`} fill="var(--art-slate)" {...L} />
        <path d={`M-4 -30l6-10h${gridW + 12}l6 10z`} fill="var(--art-slate-l)" {...L} />
        {Array.from({ length: Math.floor(gridW / 14) }, (_, i) => (
          <circle key={i} cx={10 + i * 14} cy={-35} r="2.2" fill={["var(--art-led)", "var(--bad)", "var(--gold)"][i % 3]} />
        ))}
        <path d={`M8-20h${gridW}M8-12h${gridW}`} {...T} strokeOpacity=".5" />
        {/* Mug */}
        <g transform={`translate(${gridW - 6} -40)`}>
          <path d="M0 0v-10h10v10z" fill="var(--paper-hi)" {...T} />
          <path d="M10-8c4 0 4 6 0 6" fill="none" {...T} />
          <path d="M3-13c-1-2 1-3 0-5M7-13c-1-2 1-3 0-5" fill="none" stroke="var(--paper)" strokeOpacity=".7" strokeWidth="1.2" strokeLinecap="round" />
        </g>
      </g>
      <Chair x={gx - 26} y={F} />
    </g>
  );
}

// ---------------------------------------------------------------- Office

function Office({ w, h, uid }: RoomCtx) {
  const F = h - 8;
  const deskW = 108;
  const deskX = w - deskW - 14;
  const roomy = w >= 330;
  const winX = roomy ? Math.round((62 + deskX) / 2 - 32) : Math.max(58, deskX - 30);
  return (
    <g>
      <defs>
        <pattern id={`${uid}-paper`} width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M4 0V16" stroke="var(--art-stucco)" strokeWidth="3" opacity=".55" />
          <circle cx="12" cy="8" r="1.1" fill="var(--art-stucco-d)" opacity=".5" />
        </pattern>
      </defs>
      <rect width={w} height={h - 18} fill={`url(#${uid}-paper)`} />
      <Skirting w={w} h={h} />
      <Floor w={w} h={h} fill="var(--art-wood-l)" />

      <Window x={winX} y={roomy ? 30 : 38} w={roomy ? 64 : 50} h={roomy ? 56 : 32} frame="var(--paper-hi)" />

      {roomy && (
        <g transform={`translate(${deskX + 30} 24)`}>
          <rect x="0" y="0" width="50" height="38" fill="var(--paper-hi)" {...T} transform="rotate(2 25 19)" />
          <path d="M8 30l10-10 8 6 16-16" fill="none" stroke="var(--good)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M38 10h5v5" fill="none" stroke="var(--good)" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="25" cy="-1" r="2" fill="var(--bad)" {...T} strokeWidth={1} />
        </g>
      )}

      {/* Filing cabinet, top drawer pulled out */}
      <g transform={`translate(14 ${F})`}>
        <Shadow cx={20} y={0} rx={22} />
        <rect x="0" y="-66" width="38" height="66" rx="2" fill="var(--art-steel)" {...L} />
        <rect x="28" y="-66" width="10" height="66" fill="var(--art-shade)" />
        {[-44, -22].map((y) => (
          <g key={y}>
            <path d={`M0 ${y}h38`} {...T} />
            <path d={`M14 ${y + 10}h10`} {...L} strokeWidth={2.6} />
          </g>
        ))}
        <rect x="-4" y="-64" width="38" height="20" rx="1.6" fill="var(--art-steel-l)" {...L} strokeWidth={1.8} />
        <path d="M4-64l2-8h6l-1 8M14-64l1-10h7l1 10" fill="var(--paper-hi)" {...T} />
        <path d="M10-52h10" {...L} strokeWidth={2.6} />
      </g>
      {roomy && <Plant x={78} y={F} />}

      {/* Desk with a computer and a lamp */}
      <g transform={`translate(${deskX} ${F})`}>
        <Shadow cx={deskW / 2} y={0} rx={deskW / 2 + 4} />
        <path d={`M4 0v-36M${deskW - 4} 0v-36`} {...L} strokeWidth={3} />
        <rect x={deskW - 40} y="-36" width="36" height="36" fill="var(--art-wood)" {...L} />
        <path d={`M${deskW - 40} -20h36`} {...T} />
        <path d={`M${deskW - 26} -28h8M${deskW - 26} -12h8`} {...L} strokeWidth={2.4} />
        <rect x="-4" y="-42" width={deskW + 8} height="7" rx="2" fill="var(--art-wood-l)" {...L} />
        {/* The desk lamp's light flicks off and on (design §15.6) */}
        <g className="bank-lamp" aria-hidden="true">
          <path d={`M${deskW - 34} -66L${deskW - 14} -72L${deskW - 22} -42L${deskW - 56} -42Z`} fill="var(--art-window)" opacity=".55" />
          <circle cx={deskW - 24} cy="-69" r="2.8" fill="var(--art-window-hi)" />
        </g>
        {/* Computer: the screen cycles notes, a chart and a coin */}
        <rect x="18" y="-80" width="44" height="34" rx="4" fill="var(--art-stone)" {...L} />
        <rect x="23" y="-75" width="34" height="23" rx="2" fill="var(--art-screen)" />
        <g className="bank-scr" aria-hidden="true">
          <path d="M27-68h16M27-63h22M27-58h10" stroke="var(--art-screen-d)" strokeWidth="1.6" strokeLinecap="round" />
          <g fill="var(--art-screen-d)">
            <rect x="28" y="-60" width="4" height="6" />
            <rect x="34" y="-65" width="4" height="11" />
            <rect x="40" y="-62" width="4" height="8" />
            <rect x="46" y="-69" width="4" height="15" />
          </g>
          <g>
            <circle cx="40" cy="-63.5" r="6.2" fill="var(--gold)" {...T} strokeWidth={1.3} />
            <path d="M40-66.6v6.2" fill="none" {...T} />
          </g>
        </g>
        <path d="M34-46l-2 4h16l-2-4z" fill="var(--art-stone-d)" {...T} />
        {/* Lamp */}
        <path d={`M${deskW - 18} -42v-22l-8-8`} fill="none" {...L} />
        <path d={`M${deskW - 34} -66l12-14 8 8z`} fill="var(--clay)" {...L} strokeWidth={1.8} />
        {/* Papers */}
        <path d={`M${deskW - 46} -42l2-4h16l1 4z`} fill="var(--paper-hi)" {...T} />
      </g>
      <Chair x={deskX + 40} y={F} flip />
    </g>
  );
}

// ---------------------------------------------------------------- Manager's office

function ManagersOffice({ w, h }: RoomCtx) {
  const F = h - 8;
  const deskW = clamp(w * 0.5, 96, 140);
  const deskX = Math.round(w / 2 - deskW / 2 + (w > 260 ? 16 : 6));
  const panels = Math.max(2, Math.floor(w / 46));
  const pw = w / panels;
  return (
    <g>
      {/* Wainscot */}
      <rect x="0" y={h - 64} width={w} height={52} fill="var(--art-wood)" />
      <path d={`M0 ${h - 64}H${w}`} {...L} strokeWidth={3} stroke="var(--art-wood-d)" />
      {Array.from({ length: panels }, (_, i) => (
        <rect key={i} x={i * pw + 6} y={h - 56} width={pw - 12} height={36} rx="2" fill="none" stroke="var(--art-wood-d)" strokeWidth="1.6" />
      ))}
      <Floor w={w} h={h} fill="var(--art-wood-d)" />
      <path d={`M${w * 0.2} ${h - 4}h${w * 0.6}`} stroke="var(--art-velvet)" strokeWidth="6" strokeLinecap="round" opacity=".85" />

      {/* Portrait of the founder (our own: bowler hat, monocle, moustache) */}
      <g transform={`translate(${w > 260 ? 22 : 14} 30)`}>
        <rect x="0" y="0" width="44" height="54" rx="2" fill="var(--gold)" {...L} />
        <rect x="5" y="5" width="34" height="44" fill="var(--art-leaf-d)" {...T} />
        <path d="M10 49c0-10 5-15 12-15s12 5 12 15z" fill="var(--art-slate)" />
        <circle cx="22" cy="26" r="8" fill="var(--art-stucco)" />
        <path d="M13 21h18M16 21c0-7 12-7 12 0" fill="var(--ink)" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
        <path d="M17 30c2-2 3-1 5 0 2-1 3-2 5 0" fill="none" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="25" cy="25.6" r="2.4" fill="none" stroke="var(--gold)" strokeWidth="1.2" />
      </g>

      {/* Wall safe */}
      {w > 210 && (
        <g transform={`translate(${w - 50} 34)`}>
          <rect x="0" y="0" width="34" height="32" rx="2.4" fill="var(--art-steel)" {...L} />
          <rect x="4" y="4" width="26" height="24" rx="1.6" fill="none" {...T} />
          <circle cx="17" cy="16" r="6" fill="var(--art-steel-l)" {...T} />
          <path d="M17 11v3" {...T} />
        </g>
      )}

      {/* Big desk */}
      <g transform={`translate(${deskX} ${F})`}>
        <Shadow cx={deskW / 2} y={0} rx={deskW / 2 + 6} />
        <path d={`M2 0v-38h${deskW - 4}v38`} fill="var(--art-wood-l)" {...L} />
        <rect x="10" y="-30" width={deskW - 20} height="22" rx="2" fill="none" stroke="var(--art-wood-d)" strokeWidth="1.6" />
        <rect x="-6" y="-45" width={deskW + 12} height="8" rx="2" fill="var(--art-wood)" {...L} />
        {/* Banker's lamp */}
        <path d="M18-45v-10" {...L} />
        <path d="M6-55c0-7 26-7 26 0z" fill="var(--art-leaf)" {...L} strokeWidth={1.8} />
        <path d="M6-55h26" stroke="var(--art-window-hi)" strokeWidth="2" />
        {/* Name plate and papers */}
        <path d={`M${deskW - 46} -45l3-7h20l3 7z`} fill="var(--gold)" {...T} />
        <path d={`M${deskW / 2 - 8} -46h18l-2-4h-15z`} fill="var(--paper-hi)" {...T} />
      </g>
      {/* Leather armchair behind the desk */}
      <g transform={`translate(${deskX + deskW / 2} ${F - 45})`}>
        <path d="M-16 0v-26c0-6 32-6 32 0V0" fill="var(--art-velvet)" {...L} />
        <path d="M-8-20v12M0-21v13M8-20v12" stroke="var(--art-shade-2)" strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </g>
  );
}

// ---------------------------------------------------------------- Server room

function ServerRoom({ w, h, uid }: RoomCtx) {
  const F = h - 8;
  const n = clamp(Math.floor((w - 24) / 50), 2, 6);
  const rackW = 40;
  const gap = (w - 24 - n * rackW) / Math.max(1, n - 1);
  const top = 36;
  const units = Math.floor((F - top - 8) / 13);
  return (
    <g>
      <defs>
        <pattern id={`${uid}-tile`} width="20" height="12" patternUnits="userSpaceOnUse">
          <rect width="20" height="12" fill="var(--art-steel-d)" />
          <path d="M.5 0V12M0 .5H20" stroke="var(--art-slate-d)" strokeWidth="1" />
          <circle cx="10" cy="6" r="1.1" fill="var(--art-slate-d)" />
        </pattern>
      </defs>
      <Floor w={w} h={h} fill={`url(#${uid}-tile)`} />
      {/* Cable tray */}
      <path d={`M0 16H${w}`} {...L} strokeWidth={5} stroke="var(--art-slate-d)" />
      {Array.from({ length: n }, (_, i) => {
        const x = 12 + i * (rackW + gap);
        return (
          <g key={i}>
            <path d={`M${x + 10} 18c-2 8 2 12 0 ${top - 18}M${x + 30} 18c3 6-2 12 0 ${top - 18}`} fill="none" stroke={["var(--sky)", "var(--clay)", "var(--gold)"][i % 3]} strokeWidth="2.2" strokeLinecap="round" />
            <Shadow cx={x + rackW / 2} y={F} rx={rackW / 2 + 4} />
            <rect x={x} y={top} width={rackW} height={F - top} rx="3" fill="var(--art-slate-d)" {...L} />
            <rect x={x + rackW - 7} y={top + 2} width={5} height={F - top - 4} fill="var(--art-slate)" opacity=".6" />
            {Array.from({ length: units }, (_, u) => {
              const y = top + 6 + u * 13;
              const blink = (i * 7 + u * 3) % 5;
              return (
                <g key={u}>
                  <rect x={x + 4} y={y} width={rackW - 12} height={9} rx="1.4" fill="var(--art-slate)" />
                  <circle cx={x + 9} cy={y + 4.5} r="1.8" fill={blink === 0 ? "var(--gold)" : "var(--art-led)"} className={`bank-led bank-led--${blink}`} />
                  <path d={`M${x + 15} ${y + 4.5}h${rackW - 24}`} stroke="var(--art-slate-d)" strokeWidth="1.4" strokeLinecap="round" />
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------- Lobby

function Lobby({ w, h, uid }: RoomCtx) {
  const F = h - 8;
  const bay = w > 600 ? 150 : 120;
  const bays = Math.max(1, Math.round(w / bay));
  const bw = w / bays;
  return (
    <g>
      <defs>
        <pattern id={`${uid}-check`} width="24" height="12" patternUnits="userSpaceOnUse">
          <rect width="24" height="12" fill="var(--art-stone-l)" />
          <path d="M0 0h12v6H0zM12 6h12v6H12z" fill="var(--art-stone-d)" />
        </pattern>
      </defs>
      <Skirting w={w} h={h} fill="var(--art-stone-d)" />
      <Floor w={w} h={h} fill={`url(#${uid}-check)`} />

      {/* Arched windows between pilasters */}
      {Array.from({ length: bays }, (_, i) => {
        const cx = i * bw + bw / 2;
        return <Window key={i} x={cx - 24} y={36} w={48} h={Math.min(78, h - 76)} arch frame="var(--art-stone-l)" />;
      })}
      {Array.from({ length: bays + 1 }, (_, i) => {
        if (i === 0 || i === bays) return null;
        const x = i * bw;
        return (
          <g key={i}>
            <rect x={x - 11} y={18} width={22} height={h - 36} fill="var(--art-stone-l)" {...L} />
            <rect x={x + 3} y={20} width={6} height={h - 40} fill="var(--art-shade)" />
            <path d={`M${x - 15} 18h30v-6h-30zM${x - 15} ${h - 18}h30v-6h-30z`} fill="var(--art-stone-d)" {...L} strokeWidth={1.8} />
          </g>
        );
      })}

      {/* Clock */}
      <g transform={`translate(${bays > 1 ? bw : w - 30} 30)`}>
        <circle r="15" fill="var(--paper-hi)" {...L} strokeWidth={2.4} />
        <circle r="15" fill="none" stroke="var(--gold)" strokeWidth="2" transform="scale(.86)" />
        <path d="M0 0V-9M0 0l6 3" {...L} strokeWidth={2} />
      </g>

      {/* A security camera pans across the room (design §15.6) */}
      <g transform={`translate(${bays > 1 ? w - 38 : 28} 10)`} aria-hidden="true">
        <rect x="-6" y="-2" width="12" height="4" rx="1" fill="var(--art-slate)" {...T} />
        <g className="bank-cam">
          <path d="M0 0L-17 62L17 62Z" fill="var(--sky)" opacity=".18" />
          <path d="M0 0v5" fill="none" {...L} strokeWidth={1.8} />
          <rect x="-5" y="4" width="10" height="15" rx="2.6" fill="var(--art-steel-l)" {...L} strokeWidth={1.6} />
          <rect x="-3.6" y="17" width="7.2" height="5" rx="1.2" fill="var(--art-slate-d)" {...T} strokeWidth={1.3} />
          <circle className="bank-led bank-led--1" cx="0" cy="8.4" r="1.4" fill="var(--art-led)" />
        </g>
      </g>

      {/* Pendant lamps */}
      {Array.from({ length: bays > 1 ? bays - 1 : w > 260 ? 1 : 0 }, (_, i) => {
        const x = bays > 1 ? (i + 0.5) * bw + bw / 2 : w * 0.72;
        return (
          <g key={i}>
            <path d={`M${x} 0v18`} {...T} />
            <path d={`M${x - 11} 28c0-8 22-8 22 0z`} fill="var(--art-window)" {...L} strokeWidth={1.8} />
          </g>
        );
      })}

      {/* Palms at the ends, a bench, a rope line */}
      <Plant x={24} y={F} s={1.15} />
      {w > 260 && <Plant x={w - 24} y={F} s={1.15} />}
      {w > 380 && (
        <g transform={`translate(${w * 0.3} ${F})`}>
          <Shadow cx={30} y={0} rx={34} />
          <path d="M4 0v-14M56 0v-14" {...L} strokeWidth={3} />
          <rect x="-2" y="-20" width="64" height="7" rx="2" fill="var(--art-wood)" {...L} />
          <path d="M2-20v-14h56v14" fill="none" {...L} strokeWidth={2.4} />
        </g>
      )}
      {w > 300 && <Stanchions x0={w * 0.58} x1={w - 64} y={F} />}
    </g>
  );
}

// ---------------------------------------------------------------- Vault

/** Props that keep an outline one line wide while the door is squeezed edge-on. */
const NS = { vectorEffect: "non-scaling-stroke" } as const;

/**
 * The Vault door: a thick round door on a hinge at (hx, cy), swinging shut and
 * open (design §15.6). Far face, edge band and near face; art.css turns them
 * with the one angle --vd-a, so the door keeps its thickness at every angle.
 */
function VaultDoor({ R, hx, cy }: { R: number; hx: number; cy: number }) {
  const spokes = [0, 60, 120];
  const bolts = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  return (
    <g transform={`translate(${hx} ${cy})`} className="bank-vd" style={{ "--vd-t": R * 0.1, "--vd-r": R } as CSSProperties}>
      <circle className="bank-vd__far" cx={-R} r={R} fill="var(--art-steel-d)" {...L} {...NS} />
      <g className="bank-vd__band">
        <rect y={-R} width="1" height={R * 2} fill="var(--art-steel-d)" />
        <path d={`M0 ${-R}H1M0 ${R}H1`} {...L} {...NS} />
      </g>
      <g className="bank-vd__near">
        <circle cx={-R} r={R} fill="var(--art-steel)" {...L} {...NS} />
        <circle cx={-R} r={R * 0.65} fill="none" {...T} {...NS} strokeOpacity=".6" />
        {bolts.map((a) => (
          <circle key={a} cx={-R + R * 0.82 * Math.cos(a)} cy={R * 0.82 * Math.sin(a)} r={Math.max(1.6, R * 0.05)} fill="var(--art-steel-l)" {...T} {...NS} strokeWidth={1.1} />
        ))}
        {spokes.map((a) => (
          <path key={a} d={`M${-R} ${-R * 0.37}V${R * 0.37}`} {...L} {...NS} strokeWidth={2.6} transform={`rotate(${a} ${-R} 0)`} />
        ))}
        <circle cx={-R} r={R * 0.14} fill="var(--art-steel-l)" {...L} {...NS} strokeWidth={1.8} />
      </g>
    </g>
  );
}

function Vault({ w, h, uid, pile = 1 }: RoomCtx) {
  const F = h - 8;
  const R = Math.round(clamp(Math.min((h - 34) / 2 - 6, w * 0.22), 30, 54));
  const cx = 18 + R + 4;
  const cy = F - R - 6;
  const roomy = w >= 300;
  // The pile: the floor stack first, then the extras, the stack in the doorway last (design §6.1).
  const stacks = [
    { id: "floor", rows: roomy ? 3 : 2 },
    ...(w > 520 ? [{ id: "extra", rows: 2 }] : []),
    { id: "door", rows: 2 },
  ];
  let left = Math.ceil(clamp(pile, 0, 1) * stacks.reduce((n, k) => n + barsIn(k.rows), 0));
  const shown: Record<string, number> = {};
  for (const k of stacks) {
    shown[k.id] = Math.min(left, barsIn(k.rows));
    left -= shown[k.id]!;
  }
  return (
    <g>
      <defs>
        <pattern id={`${uid}-plate`} width="48" height="36" patternUnits="userSpaceOnUse">
          <path d="M0 .6H48M.6 0V36" stroke="var(--art-steel-d)" strokeWidth="1.4" />
          <circle cx="6" cy="5" r="1.4" fill="var(--art-steel-d)" />
          <circle cx="42" cy="5" r="1.4" fill="var(--art-steel-d)" />
          <circle cx="6" cy="31" r="1.4" fill="var(--art-steel-d)" />
          <circle cx="42" cy="31" r="1.4" fill="var(--art-steel-d)" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${uid}-plate)`} />
      <Floor w={w} h={h} fill="var(--art-steel-d)" />


      {/* The vault doorway: a frame, a dark opening with the pile's last bars inside */}
      <circle cx={cx} cy={cy} r={R + 7} fill="var(--art-steel-l)" {...L} strokeWidth={2.4} />
      <clipPath id={`${uid}-door`}>
        <circle cx={cx} cy={cy} r={R} />
      </clipPath>
      <circle cx={cx} cy={cy} r={R} fill="var(--art-slate-d)" />
      <g clipPath={`url(#${uid}-door)`}>
        <rect x={cx - R} y={cy + R * 0.62} width={R * 2} height={R} fill="var(--art-slate)" />
        <path d={`M${cx - R * 0.5} ${cy - R * 0.5}h${R}M${cx - R * 0.5} ${cy - R * 0.1}h${R}`} stroke="var(--art-slate)" strokeWidth="3" />
        <GoldStack x={cx - 26} y={cy + R * 0.7} rows={2} show={shown.door!} />
      </g>
      <circle cx={cx} cy={cy} r={R} fill="none" {...L} />
      <Shadow cx={cx + R * 0.6} y={F} rx={R * 1.3} />
      <VaultDoor R={R} hx={cx + R + 2} cy={cy} />
      {[-0.62, 0, 0.62].map((f) => (
        <rect key={f} x={cx + R - 3} y={cy + f * R - 4} width="10" height="8" rx="2" fill="var(--art-steel-l)" {...T} />
      ))}

      {roomy ? (
        <>
          <GoldStack x={w - 112} y={F} rows={3} show={shown.floor!} />
          <Sack x={w - 136} y={F} s={0.95} flip />
          {w > 520 && (
            <>
              <CashCart x={w * 0.3} y={F} />
              <GoldStack x={w * 0.62} y={F} rows={2} show={shown.extra!} />
            </>
          )}
        </>
      ) : (
        <>
          <GoldStack x={w - 60} y={F} rows={2} show={shown.floor!} />
          <Sack x={w - 24} y={F} s={0.8} flip />
        </>
      )}
    </g>
  );
}

// ---------------------------------------------------------------- Deposit boxes

function DepositBoxes({ w, h, uid }: RoomCtx) {
  const F = h - 8;
  const cw = 26;
  const ch = 18;
  const cols = Math.max(4, Math.floor((w - 28) / cw));
  const rows = Math.max(2, Math.floor((F - 52 - 32) / ch));
  const gx = Math.round((w - cols * cw) / 2);
  const gy = 32;
  const open = [
    [1, 1],
    [cols - 2, 0],
    [Math.floor(cols / 2), rows - 1],
  ].slice(0, cols >= 8 ? 3 : 2);
  return (
    <g>
      <defs>
        <pattern id={`${uid}-boxes`} x={gx} y={gy} width={cw} height={ch} patternUnits="userSpaceOnUse">
          <rect width={cw} height={ch} fill="var(--art-steel-l)" />
          <rect x="1" y="1" width={cw - 2} height={ch - 2} rx="1.6" fill="none" stroke="var(--art-ink)" strokeWidth="1.1" />
          <rect x="5" y="5" width="8" height="3" rx=".8" fill="var(--art-stucco-d)" />
          <circle cx={cw - 7} cy={ch / 2} r="1.6" fill="var(--art-ink)" />
        </pattern>
      </defs>
      <Floor w={w} h={h} fill="var(--art-stone-d)" />
      <rect x={gx - 5} y={gy - 5} width={cols * cw + 10} height={rows * ch + 10} rx="3" fill="var(--art-steel)" {...L} />
      <rect x={gx} y={gy} width={cols * cw} height={rows * ch} fill={`url(#${uid}-boxes)`} />
      {open.map(([c, r], i) => {
        const x = gx + c! * cw;
        const y = gy + r! * ch;
        return (
          <g key={i}>
            <rect x={x + 1} y={y + 1} width={cw - 2} height={ch - 2} fill="var(--art-slate-d)" />
            <path d={`M${x - 4} ${y + 4}h${cw + 4}l-3 7h${-cw + 2}z`} fill="var(--art-slate)" {...T} />
            <path d={`M${x - 4} ${y + 11}h${cw + 4}v${ch - 2}h${-cw - 4}z`} fill="var(--art-steel-l)" {...L} strokeWidth={1.6} />
            <path d={`M${x + cw / 2 - 4} ${y + ch + 2}h8`} {...T} strokeWidth={2.2} />
            {i === 0 && <circle cx={x + cw / 2} cy={y + 6} r="3.4" fill="var(--gold)" {...T} strokeWidth={1} />}
            {i === 1 && <path d={`M${x + 3} ${y + 8}l2-6h12l2 6z`} fill="var(--art-leaf)" {...T} strokeWidth={1} />}
            {i === 2 && <path d={`M${x + 8} ${y + 7}l4-5 4 5-4 3z`} fill="var(--clay)" {...T} strokeWidth={1} />}
          </g>
        );
      })}

      {/* Viewing table with an opened box */}
      <g transform={`translate(${w / 2} ${F})`}>
        <Shadow cx={0} y={0} rx={44} />
        <path d="M-34 0v-24M34 0v-24" {...L} strokeWidth={3} />
        <rect x="-42" y="-30" width="84" height="7" rx="2" fill="var(--art-wood-l)" {...L} />
        {/* Open box: lid flipped back, pearls spilling over the front */}
        <path d="M-22-44l-6-16h40l6 16z" fill="var(--art-steel)" {...L} strokeWidth={1.8} />
        <path d="M-22-30v-14h40v14z" fill="var(--art-steel-l)" {...L} strokeWidth={1.8} />
        <path d="M-22-44h40" stroke="var(--art-slate-d)" strokeWidth="3" />
        <path d="M-14-44c2 8 8 12 16 10" fill="none" stroke="var(--paper-hi)" strokeWidth="4.4" strokeLinecap="round" strokeDasharray="0.1 5.2" />
        <circle cx="10" cy="-47" r="3.4" fill="none" stroke="var(--gold)" strokeWidth="2.2" />
        <path d="M8.4-50.6l1.6-2.4 1.6 2.4z" fill="var(--sky)" />
        <path d="M24-30l3-8h10l2 8z" fill="var(--gold)" {...T} />
      </g>
    </g>
  );
}

const ROOMS: Record<BankRoomId, (c: RoomCtx) => ReactNode> = {
  rooftop: Rooftop,
  security: Security,
  office: Office,
  managersOffice: ManagersOffice,
  serverRoom: ServerRoom,
  lobby: Lobby,
  vault: Vault,
  depositBoxes: DepositBoxes,
};

/** Back-wall colour of each room (the rooftop is open sky). */
export const ROOM_WALL: Record<BankRoomId, string | null> = {
  rooftop: null,
  security: "var(--art-wall-security)",
  office: "var(--art-wall-office)",
  managersOffice: "var(--art-wall-manager)",
  serverRoom: "var(--art-wall-server)",
  lobby: "var(--art-wall-lobby)",
  vault: "var(--art-wall-vault)",
  depositBoxes: "var(--art-wall-boxes)",
};

/** The room's props, drawn in its local box. */
export function RoomInterior({ id, ...ctx }: RoomCtx & { id: BankRoomId }) {
  const Draw = ROOMS[id];
  return <>{Draw(ctx)}</>;
}

/** Which rooms have art: every room the bank job can put in play. */
export const ROOMS_WITH_ART = Object.keys(ROOMS) as BankRoomId[];
