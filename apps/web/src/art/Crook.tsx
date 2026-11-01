// Masked-crook characters (M2-9): a gumdrop blob in a crew colour with a
// domino mask, a hat and one of four expressions. Our own design, drawn in
// the notebook style (warm ink, flat fill, one cel-shade tone).
//
// - <CrookAvatar>: round portrait for lists, chat and the lobby.
// - <CrookFigure>: the whole crook (feet, arms, optional sack) as an SVG <g>,
//   for placing inside the bank cutaway or any other SVG.
// - <CrookSvg>: a standalone figure (gallery, spots).
import { useId } from "react";
import type { Seed } from "../components/sketch";
import { accVar, crookLabel, crookLook, crewVar, isLightBody, type CrookLook, type Expression } from "./crook";

const INK = "var(--art-ink)";
const MASK = "var(--ink)";
const line = { stroke: INK, strokeWidth: 2.2, strokeLinejoin: "round", strokeLinecap: "round" } as const;

/** Body silhouettes in a 64-wide box; feet rest at y = 64. */
const BODY: Record<0 | 1 | 2, { d: string; top: number }> = {
  0: { d: "M32 10C47.5 10 56 21 56 36.5C56 52 49 64 32 64C15 64 8 52 8 36.5C8 21 16.5 10 32 10Z", top: 10 },
  1: { d: "M32 6.5C45 6.5 53 16.5 53 32C53 50 50 64 32 64C14 64 11 50 11 32C11 16.5 19 6.5 32 6.5Z", top: 6.5 },
  2: { d: "M32 11C43 11 49.5 19 50.5 30.5C51.5 40 58 47 56.5 55.5C55 62.5 45.5 64.5 32 64.5C18.5 64.5 9 62.5 7.5 55.5C6 47 12.5 40 13.5 30.5C14.5 19 21 11 32 11Z", top: 11 },
};

function Hat({ hat, colour, top, bot }: { hat: CrookLook["hat"]; colour: string; top: number; bot: boolean }) {
  const dy = top - 10;
  const kind = bot && hat === "pompom" ? "beanie" : hat;
  return (
    <g transform={`translate(0 ${dy})`}>
      {(kind === "beanie" || kind === "pompom") && (
        <>
          {kind === "pompom" && <circle cx="32" cy="4.6" r="4.4" fill={colour} {...line} strokeWidth={1.9} />}
          <path d="M12.6 21.5C12.2 11 20 6.6 32 6.6S51.8 11 51.4 21.5Z" fill={colour} {...line} />
          <path d="M20 10.5c-.6 3 -.8 7-.6 11M32 7v14.5M44 10.5c.6 3 .8 7 .6 11" fill="none" stroke={INK} strokeOpacity=".35" strokeWidth="1.4" />
          <path d="M10.8 19.6C24 17.6 40 17.6 53.2 19.6L53 26.6C40 24.8 24 24.8 11 26.6Z" fill={colour} {...line} />
          <path d="M11 23.4C24 21.6 40 21.6 53 23.4L53 26.6C40 24.8 24 24.8 11 26.6Z" fill="var(--art-shade-2)" />
        </>
      )}
      {kind === "cap" && (
        <>
          <path d="M13 24C11.5 13 20 7.5 32 7.5C43 7.5 50.5 12.5 51.5 20C55.5 20.5 60.5 22 61 24.6C61.2 26.2 57 26.8 51 26C38 24.8 24 24.6 13 24Z" fill={colour} {...line} />
          <path d="M51.5 20C51 22.6 51 24.4 51 26" fill="none" stroke={INK} strokeWidth="1.5" />
          <path d="M17 13c5-3 12-4 19-3" fill="none" stroke="var(--art-hi)" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="32" cy="8" r="1.8" fill={INK} />
        </>
      )}
      {kind === "bandana" && (
        <>
          <path d="M11.5 25C10 13 19 7.4 32 7.4S54 13 52.6 25C40 21.6 24 21.6 11.5 25Z" fill={colour} {...line} />
          <path d="M12 21c-3-2-6.6-1.4-7.4 1.2-.6 2.6 2.6 3.8 6 2.6M12.6 22.6c-3.4 1.8-4.6 5.4-2.6 7 1.8 1.4 4-.8 4.6-4.4" fill={colour} {...line} strokeWidth={1.8} />
          {[
            [24, 13],
            [36, 11.5],
            [44, 16.5],
            [29, 19],
          ].map(([x, y]) => (
            <circle key={`${x}`} cx={x} cy={y} r="1.5" fill="var(--paper)" opacity=".85" />
          ))}
        </>
      )}
      {kind === "none" && (
        <path d="M28.5 10.6c-1.6-3.6.6-6.6 4.2-6.2M33.6 10.4c.8-3.2 3.8-4.6 6.4-3" fill="none" {...line} strokeWidth={2} />
      )}
    </g>
  );
}

function Face({ expression, top, light }: { expression: Expression; top: number; light: boolean }) {
  const y = top + 23; // eye line
  const m = y + 15; // mouth line
  const eyes = [23, 41];
  const big = expression === "caught";
  const wide = expression === "nervous";
  const rx = big ? 6.6 : wide ? 6 : 5.6;
  const ry = big ? 6.4 : wide ? 5.4 : 4.7;
  const pr = big ? 1.5 : wide ? 1.6 : 2.3;
  const px = expression === "smug" ? 1.8 : wide ? -1.8 : 0.4;
  const py = expression === "smug" ? 1 : 0.4;
  return (
    <>
      {eyes.map((x) => (
        <g key={x}>
          <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="var(--paper-hi)" stroke={light ? INK : MASK} strokeWidth="1.2" />
          <circle cx={x + px} cy={y + py} r={pr} fill={INK} />
          {!big && <circle cx={x + px - 0.9} cy={y + py - 0.9} r={0.7} fill="var(--paper-hi)" />}
          {expression === "smug" && (
            <path
              d={`M${x - rx - 0.4} ${y + 0.6}Q${x} ${y - 3.2} ${x + rx + 0.4} ${y + 0.6}L${x + rx + 0.6} ${y - ry - 1}L${x - rx - 0.6} ${y - ry - 1}Z`}
              fill={MASK}
            />
          )}
        </g>
      ))}
      {expression === "neutral" && <path d={`M27 ${m}q5 2.4 10 0`} fill="none" {...line} strokeWidth={2} />}
      {expression === "smug" && (
        <>
          <path d={`M25.6 ${m + 0.6}q7 3.4 12.6 -3`} fill="none" {...line} strokeWidth={2} />
          <path d={`M37 ${m - 3.8}l2.2 1.6`} fill="none" {...line} strokeWidth={1.6} />
        </>
      )}
      {expression === "nervous" && (
        <>
          <path d={`M24.6 ${m + 0.6}q2.4-2.6 4.9 0t4.9 0t4.9 0`} fill="none" {...line} strokeWidth={1.9} />
        </>
      )}
      {expression === "caught" && (
        <>
          <ellipse cx="32" cy={m + 1.4} rx="3.8" ry="4.6" fill={INK} />
          <ellipse cx="32" cy={m + 3.6} rx="2.2" ry="1.6" fill="var(--clay)" />
        </>
      )}
    </>
  );
}

export interface CrookProps {
  /** A seat number (0-based, distinct colours for 12) or any seed, or an explicit look. */
  readonly look: CrookLook | Seed;
  readonly expression?: Expression;
  readonly bot?: boolean;
}

const lookOf = (look: CrookLook | Seed): CrookLook => (typeof look === "object" ? look : crookLook(look));

/** The blob, mask, face and hat in a 64-wide box (head top ≈ y 6–11, base y 64). */
function CrookBody({ look, expression = "neutral", bot = false, clipId }: CrookProps & { clipId: string }) {
  const l = lookOf(look);
  const body = BODY[l.shape];
  const fill = crewVar(l.colour);
  const light = isLightBody(l.colour);
  const y = body.top + 23;
  return (
    <>
      <clipPath id={clipId}>
        <path d={body.d} />
      </clipPath>
      <path d={body.d} fill={fill} />
      <g clipPath={`url(#${clipId})`}>
        {/* Cel shade: the body nudged up-left leaves a crescent of shade on the right. */}
        <rect x="0" y="0" width="64" height="72" fill="var(--art-shade-2)" />
        <path d={body.d} fill={fill} transform="translate(-5.5 -3.5)" />
        {/* Domino mask band */}
        <path d={`M4 ${y - 4.6}C18 ${y - 7.6} 46 ${y - 7.6} 60 ${y - 4.6}L60 ${y + 5.4}C46 ${y + 8.6} 18 ${y + 8.6} 4 ${y + 5.4}Z`} fill={MASK} />
      </g>
      {/* Mask ties fluttering on the left */}
      <path
        d={`M${l.shape === 1 ? 11.6 : 8.6} ${y - 1}c-3.6-2.6-6.6-2.4-8.4-.6 2.2.4 4 1.6 5 3.2-2.4 1.2-3.6 3.4-3.4 5.4 2.4-1.8 5-2.8 7.4-2.6`}
        fill={MASK}
        stroke={MASK}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M15 22c3-5 8-8 13-8.6" fill="none" stroke="var(--art-hi)" strokeWidth="2.6" strokeLinecap="round" transform={`translate(0 ${body.top - 10})`} />
      <path d={body.d} fill="none" {...line} />
      <Face expression={expression} top={body.top} light={light} />
      <Hat hat={l.hat} colour={accVar(l.hatColour)} top={body.top} bot={bot} />
      {expression === "nervous" && (
        <path
          d={`M50 ${body.top + 9}c2 3.6 3.8 5.8 3.8 8.2a3.8 3.8 0 0 1-7.6 0c0-2.4 1.8-4.6 3.8-8.2z`}
          fill="var(--sky)"
          stroke={INK}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      )}
      {bot && (
        <g>
          <path d={`M32 ${body.top - 1}V${body.top - 9}`} {...line} strokeWidth={2} />
          <circle cx="32" cy={body.top - 11} r="3.2" fill="var(--sky)" {...line} strokeWidth={1.8} />
        </g>
      )}
      {expression === "caught" && (
        <path
          d={`M9 ${body.top + 1}l-4.4-4.4M32 ${body.top - 5}v-5.4M55 ${body.top + 1}l4.4-4.4`}
          fill="none"
          {...line}
          stroke="var(--clay-d)"
          strokeWidth={2.2}
        />
      )}
    </>
  );
}

/** The robot badge for bots (ui-style §6 badges), in its own 16-unit box. */
function BotBadge() {
  return (
    <>
      <circle cx="8" cy="8" r="7.4" fill="var(--sky)" stroke={INK} strokeWidth="1.5" />
      <rect x="3.6" y="5" width="8.8" height="6.8" rx="2.2" fill="var(--paper-hi)" stroke={INK} strokeWidth="1.2" />
      <path d="M8 5V3.2" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="6.1" cy="8.3" r="1" fill={INK} />
      <circle cx="9.9" cy="8.3" r="1" fill={INK} />
    </>
  );
}

export interface CrookAvatarProps extends CrookProps {
  readonly name: string;
  /** Diameter in px. */
  readonly size?: number;
  /** ready: move in (clay dot); away: grey wash. */
  readonly status?: "ready" | "away" | undefined;
  readonly className?: string;
}

/** A round crook portrait: a slightly-off circle in a tint of the crew colour. */
export function CrookAvatar({ name, look, expression = "neutral", bot = false, size = 44, status, className }: CrookAvatarProps) {
  const id = useId().replace(/:/g, "");
  const l = lookOf(look);
  const label = crookLabel(name, expression, bot) + (status === "ready" ? ", move in" : status === "away" ? ", away" : "");
  const ring = "M32 2.4C49 2.2 61.8 14.6 61.6 32.4C61.4 49.4 48.6 61.8 31.6 61.6C14.6 61.4 2.2 48.8 2.4 31.8C2.6 14.8 15.2 2.6 32 2.4Z";
  return (
    <svg
      className={["crook-avatar", status && `crook-avatar--${status}`, className].filter(Boolean).join(" ")}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <clipPath id={`${id}-ring`}>
        <path d={ring} />
      </clipPath>
      <path d={ring} fill={`color-mix(in srgb, ${crewVar(l.colour)} 26%, var(--paper))`} />
      <g clipPath={`url(#${id}-ring)`}>
        <path d="M0 52C14 47 50 47 64 52V64H0Z" fill="var(--art-shade)" />
        <g transform="translate(1.6 7.4) scale(.95)">
          <CrookBody look={l} expression={expression} bot={bot} clipId={`${id}-body`} />
        </g>
      </g>
      <path d={ring} fill="none" stroke={INK} strokeWidth="2.2" />
      {bot && (
        <g transform="translate(44 44)">
          <BotBadge />
        </g>
      )}
      {status === "ready" && <circle cx="54" cy="10" r="6" fill="var(--clay)" stroke={INK} strokeWidth="1.8" />}
    </svg>
  );
}

export interface CrookFigureProps extends CrookProps {
  /** Where the feet touch the floor, in the parent SVG's units. */
  readonly x: number;
  readonly y: number;
  /** 1 = 72 units tall (body plus feet and antenna). */
  readonly scale?: number;
  /** Mirror (face left). */
  readonly flip?: boolean;
  /** Carry a loot sack over the shoulder. */
  readonly sack?: boolean;
  /** Arms up (cheering, or hands up when caught). Default: up only when caught. */
  readonly armsUp?: boolean;
  /**
   * Draw a dashed outline with a "?" instead of the crook: a room someone
   * *claims* (alibi) but nobody saw them in. design §5.4, m2-plan M2-9.
   */
  readonly ghost?: boolean;
  /** Accessible name; becomes an SVG <title>. */
  readonly label?: string;
}

/** A whole crook as an SVG group, standing with its feet at (x, y). */
export function CrookFigure({ look, expression = "neutral", bot = false, x, y, scale = 1, flip = false, sack = false, armsUp, ghost = false, label }: CrookFigureProps) {
  const id = useId().replace(/:/g, "");
  const l = lookOf(look);
  const body = BODY[l.shape];
  const t = `translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale}) translate(-32 -69)`;
  if (ghost) {
    return (
      <g transform={t} className="crook-fig crook-fig--ghost">
        {label && <title>{label}</title>}
        <path d={body.d} fill="var(--paper-hi)" fillOpacity=".55" stroke={INK} strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
        <text x="32" y="49" textAnchor="middle" className="crook-fig__q" transform={flip ? "translate(64 0) scale(-1 1)" : undefined}>
          ?
        </text>
      </g>
    );
  }
  return (
    <g transform={t} className="crook-fig">
      {label && <title>{label}</title>}
      <ellipse cx="32" cy="69.5" rx="21" ry="3.6" fill="var(--art-shade-2)" />
      <ellipse cx="23" cy="66.4" rx="6.6" ry="3.8" fill="var(--ink)" {...line} strokeWidth={1.6} />
      <ellipse cx="41" cy="66.4" rx="6.6" ry="3.8" fill="var(--ink)" {...line} strokeWidth={1.6} />
      {sack && (
        <g>
          <path d="M44 27c-2-6 2-10 6-10 2 0 3 1 4 3 7 2 11 9 10 17-1 9-8 13-15 11-6-2-9-9-5-21z" fill="var(--art-sack)" {...line} strokeWidth={2} />
          <path d="M50 17l-3-4M54 20l3-4" fill="none" {...line} strokeWidth={1.8} />
          <path d="M54.5 30.5c-2.6-1.6-5.6.2-4.6 2.6s5.4 1.6 4.8 4.2-4.4 2.6-5.8 1M52 28.6v12" fill="none" {...line} strokeWidth={1.6} />
        </g>
      )}
      <CrookBody look={l} expression={expression} bot={bot} clipId={`${id}-body`} />
      {/* Arm nubs */}
      {(armsUp ?? expression === "caught") ? (
        <>
          <path d="M10 38c-5-4-7-10-6-16" fill="none" {...line} strokeWidth={6.4} />
          <path d="M10 38c-5-4-7-10-6-16" fill="none" stroke={crewVar(l.colour)} strokeWidth="3" strokeLinecap="round" />
          <path d="M54 38c5-4 7-10 6-16" fill="none" {...line} strokeWidth={6.4} />
          <path d="M54 38c5-4 7-10 6-16" fill="none" stroke={crewVar(l.colour)} strokeWidth="3" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M10.5 44c-3 3-4 7-3 10" fill="none" {...line} strokeWidth={6.4} />
          <path d="M10.5 44c-3 3-4 7-3 10" fill="none" stroke={crewVar(l.colour)} strokeWidth="3" strokeLinecap="round" />
          <path d={sack ? "M53 44c4-3 4-8 2-14" : "M53.5 44c3 3 4 7 3 10"} fill="none" {...line} strokeWidth={6.4} />
          <path d={sack ? "M53 44c4-3 4-8 2-14" : "M53.5 44c3 3 4 7 3 10"} fill="none" stroke={crewVar(l.colour)} strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {bot && (
        <g transform="translate(40 50) scale(.95)">
          <BotBadge />
        </g>
      )}
    </g>
  );
}

/** A standalone crook figure (gallery, spot art). */
export function CrookSvg({ name, size = 72, className, ...props }: Omit<CrookFigureProps, "x" | "y" | "scale" | "label"> & { name: string; size?: number; className?: string }) {
  const label = crookLabel(name, props.expression, props.bot);
  return (
    <svg className={className} viewBox="-4 -12 72 86" width={(size * 72) / 86} height={size} role="img" aria-label={label}>
      <title>{label}</title>
      <CrookFigure {...props} x={32} y={69} />
    </svg>
  );
}
