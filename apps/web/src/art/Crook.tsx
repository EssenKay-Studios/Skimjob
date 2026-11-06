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
import { accVar, crookLabel, crookLook, crewVar, isLightBody, nameTag, type CrookLook, type Expression, type Hat } from "./crookLooks";

const INK = "var(--art-ink)";
const MASK = "var(--ink)";
const line = { stroke: INK, strokeWidth: 2.2, strokeLinejoin: "round", strokeLinecap: "round" } as const;

/** Body silhouettes in a 64-wide box; feet rest at y = 64. */
const BODY: Record<0 | 1 | 2, { d: string; top: number }> = {
  0: { d: "M32 10C47.5 10 56 21 56 36.5C56 52 49 64 32 64C15 64 8 52 8 36.5C8 21 16.5 10 32 10Z", top: 10 },
  1: { d: "M32 6.5C45 6.5 53 16.5 53 32C53 50 50 64 32 64C14 64 11 50 11 32C11 16.5 19 6.5 32 6.5Z", top: 6.5 },
  2: { d: "M32 11C43 11 49.5 19 50.5 30.5C51.5 40 58 47 56.5 55.5C55 62.5 45.5 64.5 32 64.5C18.5 64.5 9 62.5 7.5 55.5C6 47 12.5 40 13.5 30.5C14.5 19 21 11 32 11Z", top: 11 },
};

/** Top of each hat (y in the 64 box, head top at 10), for the bot antenna and head tags. */
const HAT_TOP: Record<Hat, number> = {
  beanie: 6.6,
  stripes: 6.6,
  pompom: 0.2,
  cap: 7.5,
  bandana: 7.4,
  none: 4.4,
  tophat: -3.4,
  beret: 1.4,
  fedora: 5.4,
  earmuffs: 7,
  goggles: 4.6,
  propeller: -1.2,
};

function Beanie({ colour, clipId, stripes }: { colour: string; clipId: string; stripes: boolean }) {
  const crown = "M12.6 21.5C12.2 11 20 6.6 32 6.6S51.8 11 51.4 21.5Z";
  return (
    <>
      <path d={crown} fill={colour} {...line} />
      {stripes ? (
        <>
          <clipPath id={clipId}>
            <path d={crown} />
          </clipPath>
          <g clipPath={`url(#${clipId})`}>
            <path d="M8 10.6C24 8.6 40 8.6 56 10.6M8 16.4C24 14.4 40 14.4 56 16.4" fill="none" stroke="var(--paper-hi)" strokeWidth="3.4" />
          </g>
          <path d={crown} fill="none" {...line} />
        </>
      ) : (
        <path d="M20 10.5c-.6 3 -.8 7-.6 11M32 7v14.5M44 10.5c.6 3 .8 7 .6 11" fill="none" stroke={INK} strokeOpacity=".35" strokeWidth="1.4" />
      )}
      <path d="M10.8 19.6C24 17.6 40 17.6 53.2 19.6L53 26.6C40 24.8 24 24.8 11 26.6Z" fill={stripes ? "var(--paper-hi)" : colour} {...line} />
      <path d="M11 23.4C24 21.6 40 21.6 53 23.4L53 26.6C40 24.8 24 24.8 11 26.6Z" fill="var(--art-shade-2)" />
    </>
  );
}

function Hat({ hat, colour, top, clipId }: { hat: Hat; colour: string; top: number; clipId: string }) {
  const dy = top - 10;
  return (
    <g transform={`translate(0 ${dy})`}>
      {(hat === "beanie" || hat === "pompom" || hat === "stripes") && (
        <>
          {hat === "pompom" && <circle cx="32" cy="4.6" r="4.4" fill={colour} {...line} strokeWidth={1.9} />}
          <Beanie colour={colour} clipId={clipId} stripes={hat === "stripes"} />
        </>
      )}
      {hat === "cap" && (
        <>
          <path d="M13 24C11.5 13 20 7.5 32 7.5C43 7.5 50.5 12.5 51.5 20C55.5 20.5 60.5 22 61 24.6C61.2 26.2 57 26.8 51 26C38 24.8 24 24.6 13 24Z" fill={colour} {...line} />
          <path d="M51.5 20C51 22.6 51 24.4 51 26" fill="none" stroke={INK} strokeWidth="1.5" />
          <path d="M17 13c5-3 12-4 19-3" fill="none" stroke="var(--art-hi)" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="32" cy="8" r="1.8" fill={INK} />
        </>
      )}
      {hat === "bandana" && (
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
      {hat === "none" && <path d="M28.5 10.6c-1.6-3.6.6-6.6 4.2-6.2M33.6 10.4c.8-3.2 3.8-4.6 6.4-3" fill="none" {...line} strokeWidth={2} />}
      {hat === "tophat" && (
        <>
          <path d="M18.6 21.4L17.2-2.6C24-4.2 40-4.2 46.8-2.6L45.4 21.4Z" fill={colour} {...line} />
          <path d="M18.2 13.6C27 12.6 37 12.6 45.8 13.6L45.5 19.2C37 18.4 27 18.4 18.5 19.2Z" fill="var(--bad)" {...line} strokeWidth={1.6} />
          <path d="M22 1v10" fill="none" stroke="var(--art-hi)" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M7.6 23C7.6 19.6 19.6 18.8 32 18.8S56.4 19.6 56.4 23C56.4 26.2 44 26.6 32 26.6S7.6 26.2 7.6 23Z" fill={colour} {...line} />
        </>
      )}
      {hat === "beret" && (
        <>
          <path d="M33.4 3.6l.8-2.6" fill="none" {...line} strokeWidth={2.6} />
          <path d="M6.6 17.6C3.6 10.6 17 3.2 33.4 3.6C49 4 59.6 9.6 57.2 16C55.4 20.6 46 21.6 32.6 21.2S9 21.8 6.6 17.6Z" fill={colour} {...line} />
          <path d="M12.6 19.6C24 22.6 42 22.6 51.4 19.6L51.2 23.6C42 25.6 24 25.6 12.8 23.6Z" fill={colour} {...line} strokeWidth={1.8} />
          <path d="M14 11c6-4 14-5.4 21-5" fill="none" stroke="var(--art-hi)" strokeWidth="2.2" strokeLinecap="round" />
        </>
      )}
      {hat === "fedora" && (
        <>
          <path d="M16.2 21C15 13 17 6.2 24 5.6C28 5.2 30 7.8 32 7.8S36 5.2 40 5.6C47 6.2 49 13 47.8 21Z" fill={colour} {...line} />
          <path d="M16.2 15.6C26 14.6 38 14.6 47.8 15.6L47.8 20.4C38 19.6 26 19.6 16.2 20.4Z" fill="var(--ink)" />
          <path d="M2.6 22.6C8 17.8 56 17.8 61.4 22.6C60 26.6 53 26 46 24.4C37 22.6 27 22.6 18 24.4C11 26 4 26.6 2.6 22.6Z" fill={colour} {...line} />
        </>
      )}
      {hat === "earmuffs" && (
        <>
          <path d="M11.4 26C10 12 18 7 32 7S54 12 52.6 26" fill="none" {...line} strokeWidth={6.6} />
          <path d="M11.4 26C10 12 18 7 32 7S54 12 52.6 26" fill="none" stroke={colour} strokeWidth="3" strokeLinecap="round" />
          {[10.4, 53.6].map((x) => (
            <g key={x}>
              <ellipse cx={x} cy="27" rx="7.2" ry="8" fill={colour} {...line} />
              <path d={`M${x - 3.4} 23.6c1.8-1.8 4.6-1.8 6.4 0`} fill="none" stroke="var(--art-hi)" strokeWidth="1.8" strokeLinecap="round" />
            </g>
          ))}
        </>
      )}
      {hat === "goggles" && (
        <>
          <path d="M11.6 21.6C24 17.6 40 17.6 52.4 21.6L52.6 16.4C40 12.6 24 12.6 11.4 16.4Z" fill="var(--ink)" {...line} strokeWidth={1.6} />
          {[23, 41].map((x) => (
            <g key={x}>
              <circle cx={x} cy="12.4" r="7.6" fill={colour} {...line} />
              <circle cx={x} cy="12.4" r="4.6" fill="var(--art-glass)" {...line} strokeWidth={1.5} />
              <path d={`M${x - 2.4} 11c.6-1.4 1.6-2 2.8-2.2`} fill="none" stroke="var(--paper-hi)" strokeWidth="1.5" strokeLinecap="round" />
            </g>
          ))}
        </>
      )}
      {hat === "propeller" && (
        <>
          <path d="M32 7.4V2.6" fill="none" {...line} strokeWidth={2} />
          <path d="M32 1.6c-4-3-12-3.4-14-1.2 2 2.4 10 2.6 14 1.2zM32 1.6c4-3 12-3.4 14-1.2-2 2.4-10 2.6-14 1.2z" fill="var(--sky)" {...line} strokeWidth={1.5} />
          <path d="M12.4 22C12 11.6 20 7 32 7S52 11.6 51.6 22Z" fill={colour} {...line} />
          <path d="M32 7C26 10 24.6 16 24.6 22.4H39.4C39.4 16 38 10 32 7Z" fill="var(--gold)" {...line} strokeWidth={1.6} />
          <path d="M9.6 21.6C24 19.6 40 19.6 54.4 21.6C54.6 24.4 52 25.2 47 24.6C37 23.4 27 23.4 17 24.6C12 25.2 9.4 24.4 9.6 21.6Z" fill={colour} {...line} strokeWidth={1.8} />
          <circle cx="32" cy="2.4" r="1.8" fill="var(--bad)" {...line} strokeWidth={1.2} />
        </>
      )}
    </g>
  );
}

/** Width of a name tag for `text` at font size `size` (Pangolin bold: capitals ≈ .74 em, others ≈ .58 em). */
export const nameTagWidth = (text: string, size: number) =>
  Array.from(text).reduce((w, c) => w + (c !== c.toLowerCase() ? 0.74 : 0.58), 0.44) * size;

/**
 * A visible name tag (initials), centred on (x, y): a little paper badge,
 * so a crook is identifiable without colour or hover (touch). `dashed` for
 * a claimed (ghost) crook.
 */
function NameTag({ text, x, y, size, dashed = false, unflip = false }: { text: string; x: number; y: number; size: number; dashed?: boolean; unflip?: boolean }) {
  const w = nameTagWidth(text, size);
  const h = size * 1.24;
  return (
    <g className="crook-tag" transform={`translate(${x} ${y})${unflip ? " scale(-1 1)" : ""} rotate(-3)`} aria-hidden="true">
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={size * 0.28} fill="var(--paper-hi)" stroke={INK} strokeWidth={Math.max(1.2, size * 0.085)} {...(dashed && { strokeDasharray: `${size * 0.26} ${size * 0.18}` })} />
      <text x="0" y={size * 0.36} textAnchor="middle" className="crook-tag__text" style={{ fontSize: size }}>
        {text}
      </text>
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
      <Hat hat={l.hat} colour={accVar(l.hatColour)} top={body.top} clipId={`${clipId}-hat`} />
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
        <g transform={`translate(0 ${HAT_TOP[l.hat] + body.top - 10})`}>
          <path d="M32 0V-7" {...line} strokeWidth={2} />
          <circle cx="32" cy="-9.4" r="3.2" fill="var(--sky)" {...line} strokeWidth={1.8} />
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
  /** ready: locked in a move this round (clay stamp with a tick, public); away: grey wash. design §5.1 */
  readonly status?: "ready" | "away" | undefined;
  /**
   * A person's presence (owner decision, 2 Nov): online, a filled green dot
   * top-left; offline, a hollow one. Not for bots (their badge says bot).
   */
  readonly presence?: "online" | "offline" | undefined;
  /** Visible name tag; default: the name's initials (`nameTag`). Pass `crewTags()` output for crew-unique tags. */
  readonly tag?: string | undefined;
  readonly className?: string;
}

/** The avatar's initials badge, bottom-left; at least ~10.5 px text at any avatar size. */
function AvatarTag({ text, size }: { text: string; size: number }) {
  const font = Math.min(24, Math.max(15, (10.5 * 64) / size));
  const w = nameTagWidth(text, font);
  return <NameTag text={text} x={Math.max(w / 2 + 1, 15)} y={64 - font * 0.62 - 1} size={font} />;
}

/** A round crook portrait: a slightly-off circle in a tint of the crew colour. */
export function CrookAvatar({ name, look, expression = "neutral", bot = false, size = 44, status, presence, tag, className }: CrookAvatarProps) {
  const id = useId().replace(/:/g, "");
  const l = lookOf(look);
  const here = bot ? undefined : presence;
  const label =
    crookLabel(name, expression, bot) +
    (status === "ready" ? ", locked in" : status === "away" ? ", away" : "") +
    (here === "online" ? ", online" : here === "offline" ? ", offline" : "");
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
      {status === "ready" && (
        <g className="crook-avatar__locked">
          <circle cx="54" cy="10" r="7" fill="var(--clay)" stroke={INK} strokeWidth="1.8" />
          <path d="M50.6 10.2L53.1 12.8L57.6 7.4" fill="none" stroke="var(--paper-hi)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {here && (
        <circle
          className={`crook-avatar__here crook-avatar__here--${here}`}
          cx="9"
          cy="9"
          r="5"
          fill={here === "online" ? "var(--good)" : "var(--paper-hi)"}
          stroke={INK}
          strokeWidth="1.6"
          strokeDasharray={here === "offline" ? "2.4 1.8" : undefined}
        />
      )}
      <AvatarTag text={tag ?? nameTag(name)} size={size} />
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
  /**
   * Seen on camera (Security, the Lookout, a Tail perk), not in person: the
   * crook drawn faded behind a blue CCTV wash with scanlines and a camera
   * badge. Solid figures are people you stood with; ghosts are claims.
   * design §6.1, §8, §8.3
   */
  readonly camera?: boolean;
  /** Accessible name; becomes an SVG <title>. */
  readonly label?: string;
  /** Visible name tag (initials), so the crook is identifiable on touch and without colour. */
  readonly tag?: string | undefined;
  /** Tag font size in the figure's own units (64-wide body). Default 16. */
  readonly tagSize?: number;
  /** body: a badge on the belly; head: floating above the hat (back rows in a crowd). */
  readonly tagAt?: "body" | "head";
}

/** A whole crook as an SVG group, standing with its feet at (x, y). */
export function CrookFigure({
  look,
  expression = "neutral",
  bot = false,
  x,
  y,
  scale = 1,
  flip = false,
  sack = false,
  armsUp,
  ghost = false,
  camera = false,
  label,
  tag,
  tagSize = 16,
  tagAt = "body",
}: CrookFigureProps) {
  const id = useId().replace(/:/g, "");
  const l = lookOf(look);
  const body = BODY[l.shape];
  const t = `translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale}) translate(-32 -69)`;
  const headTop = HAT_TOP[l.hat] + body.top - 10 - (bot ? 13 : 0);
  const tagEl = tag ? (
    <NameTag text={tag} x={32} y={tagAt === "head" ? headTop - tagSize * 0.62 - 1 : 64 - tagSize * 0.3} size={tagSize} dashed={ghost} unflip={flip} />
  ) : null;
  if (ghost) {
    // A claim: the claimant's outline (crew colour, dashed) and hat shape, washed out, with a "?".
    const crew = crewVar(l.colour);
    return (
      <g transform={t} className="crook-fig crook-fig--ghost">
        {label && <title>{label}</title>}
        <path d={body.d} fill={`color-mix(in srgb, ${crew} 34%, var(--paper-hi))`} fillOpacity=".9" />
        <g opacity=".7">
          <Hat hat={l.hat} colour={`color-mix(in srgb, ${crew} 40%, var(--paper-hi))`} top={body.top} clipId={`${id}-hat`} />
        </g>
        <path d={body.d} fill="none" stroke={crew} strokeWidth="5" strokeDasharray="6 4.5" strokeLinecap="round" />
        <path d={body.d} fill="none" stroke={INK} strokeWidth="2.2" strokeDasharray="6 4.5" strokeLinecap="round" />
        <text x="32" y={tag && tagAt === "body" ? 45 : 49} textAnchor="middle" className="crook-fig__q" transform={flip ? "translate(64 0) scale(-1 1)" : undefined}>
          ?
        </text>
        {tagEl}
      </g>
    );
  }
  return (
    <g transform={t} className={camera ? "crook-fig crook-fig--camera" : "crook-fig"}>
      {label && <title>{label}</title>}
      <g opacity={camera ? 0.62 : undefined}>
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
      </g>
      {camera && (
        <g pointerEvents="none">
          <clipPath id={`${id}-cam`}>
            <path d={body.d} />
          </clipPath>
          <g clipPath={`url(#${id}-cam)`}>
            <rect x="0" y="0" width="64" height="72" fill="var(--sky)" opacity=".38" />
            {[8, 16, 24, 32, 40, 48, 56, 64].map((y) => (
              <path key={y} d={`M0 ${y}H64`} stroke="var(--art-ink)" strokeWidth="1.1" opacity=".3" />
            ))}
          </g>
          <path d={body.d} fill="none" stroke="var(--sky)" strokeWidth="2.4" />
        </g>
      )}
      {bot && (
        <g transform={tag && tagAt === "body" ? "translate(47 36) scale(.9)" : "translate(40 50) scale(.95)"}>
          <BotBadge />
        </g>
      )}
      {camera && (
        <g transform={flip ? "translate(64 0) scale(-1 1) translate(-2 4)" : "translate(-2 4)"}>
          <CameraBadge />
        </g>
      )}
      {tagEl}
    </g>
  );
}

/** "Seen on camera": a little CCTV camera on a sky disc, in its own 18-unit box. */
function CameraBadge() {
  return (
    <>
      <circle cx="9" cy="9" r="8.6" fill="var(--sky)" stroke={INK} strokeWidth="1.6" />
      <path d="M3.6 6.4h7.6l1.6 2.2v2.6H3.6z" fill="var(--paper-hi)" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M12.8 9.2l2.4-1.4v3.4l-2.4-1" fill="var(--paper-hi)" stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="5.6" cy="8.8" r=".9" fill="var(--bad)" />
      <path d="M6 11.2v2.6" stroke={INK} strokeWidth="1.3" strokeLinecap="round" />
    </>
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
