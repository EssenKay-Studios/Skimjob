// <SketchFrame>: a seeded hand-drawn SVG frame behind its content (ui-style §4).
// Layers, bottom to top: hatched shadow, body fill, paper grain, edge burn,
// ink outline, pencil ghost line. Optional masking tape, punch holes, line boil.
import {
  createElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { framePaths, type FrameOptions, type Seed } from "./sketch";

/** Shared SVG patterns and filters. Render once, near the root. */
export function SketchDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
      <defs>
        <pattern id="sk-hatch" width="4.2" height="4.2" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
          <line x1="0" y1="0" x2="0" y2="4.2" stroke="#2a2320" strokeWidth="1.15" strokeOpacity="0.62" />
        </pattern>
        <filter id="sk-grain-f" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.75 0.4" numOctaves="2" seed="7" stitchTiles="stitch" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.42  0 0 0 0 0.33  0 0 0 0 0.24  0 0 0 3 -1.45"
          />
        </filter>
        <pattern id="sk-grain" width="220" height="220" patternUnits="userSpaceOnUse">
          <rect width="220" height="220" filter="url(#sk-grain-f)" opacity="0.22" />
        </pattern>
        <linearGradient id="sk-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6bc45" />
          <stop offset="1" stopColor="#e9a92c" />
        </linearGradient>
        <linearGradient id="sk-pass" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#3b2c62" />
          <stop offset="1" stopColor="#2b2449" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export interface Size {
  readonly w: number;
  readonly h: number;
}

/** The element's border-box size, kept up to date with a ResizeObserver. */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, Size | null] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export interface FrameArtProps extends FrameOptions {
  readonly w: number;
  readonly h: number;
  readonly seed: Seed;
  /** Hatched shadow opacity: 0.62 sheets, 0.35–0.4 buttons, 0 for none. */
  readonly shadow?: number;
  /** Paper grain and edge burn (off for small or coloured fills). */
  readonly grain?: boolean;
  /** Cycle three outline variants (hot / focused / alert elements). */
  readonly boil?: boolean;
}

/** The frame's SVG on its own. Fill and ink come from `--fr-fill` and `--fr-ink`. */
export function FrameArt({ w, h, seed, shadow = 0.62, grain = true, boil = false, ...opts }: FrameArtProps) {
  const clip = useId().replace(/:/g, "");
  const base = framePaths(w, h, seed, opts);
  const variants = boil ? [base, framePaths(w, h, `${seed}/b1`, opts), framePaths(w, h, `${seed}/b2`, opts)] : [base];
  return (
    <svg className="sk-art" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      {shadow > 0 && (
        <path d={base.body} transform="translate(3.5 4.5)" fill="url(#sk-hatch)" opacity={shadow} className="sk-shadow" />
      )}
      <path d={base.body} className="sk-body" />
      {grain && (
        <>
          <clipPath id={clip}>
            <path d={base.body} />
          </clipPath>
          <g clipPath={`url(#${clip})`} className="sk-paper">
            <rect width={w} height={h} fill="url(#sk-grain)" />
            <path d={base.body} fill="none" stroke="#c9a383" strokeOpacity="0.2" strokeWidth="20" />
          </g>
        </>
      )}
      <g className={boil ? "sk-boil" : undefined}>
        {variants.map((v, i) => (
          <g key={i}>
            <path d={v.ink} className="sk-ink" fillRule="evenodd" />
            <path d={v.ghost} className="sk-ghost" />
          </g>
        ))}
      </g>
    </svg>
  );
}

export interface SketchFrameProps extends HTMLAttributes<HTMLElement>, FrameOptions {
  readonly seed: Seed;
  readonly as?: "div" | "section" | "article" | "aside" | "header" | "li";
  /** Body fill (any CSS colour or `url(#…)`); default `var(--paper)`. */
  readonly fill?: string;
  /** Outline colour; default `var(--ink)`. */
  readonly ink?: string;
  readonly shadow?: number;
  readonly grain?: boolean;
  readonly boil?: boolean;
  /** Two masking-tape strips across the top edge. */
  readonly tape?: boolean;
  /** A column of punch holes down the left edge. */
  readonly holes?: boolean;
  /** Small resting rotation in degrees (dialogs, promos: -0.5 to +0.8). */
  readonly tilt?: number;
  readonly children?: ReactNode;
}

export function SketchFrame({
  seed,
  as = "div",
  fill,
  ink,
  shadow,
  grain,
  boil,
  tape,
  holes,
  tilt,
  radius,
  wobble,
  stroke,
  className,
  style,
  children,
  ...rest
}: SketchFrameProps) {
  const [ref, size] = useElementSize<HTMLElement>();
  const vars: Record<string, string> = {};
  if (fill) vars["--fr-fill"] = fill;
  if (ink) vars["--fr-ink"] = ink;
  if (tilt) vars["--tilt"] = `${tilt}deg`;
  const opts: FrameOptions = {
    ...(radius !== undefined && { radius }),
    ...(wobble !== undefined && { wobble }),
    ...(stroke !== undefined && { stroke }),
  };
  return createElement(
    as,
    {
      ...rest,
      ref,
      className: ["sk-frame", holes && "sk-frame--holes", tilt && "sk-frame--tilt", className].filter(Boolean).join(" "),
      style: { ...vars, ...style } as CSSProperties,
    },
    size && (
      <FrameArt
        w={size.w}
        h={size.h}
        seed={seed}
        {...opts}
        {...(shadow !== undefined && { shadow })}
        {...(grain !== undefined && { grain })}
        {...(boil !== undefined && { boil })}
      />
    ),
    tape && <span className="sk-tape sk-tape--l" aria-hidden="true" />,
    tape && <span className="sk-tape sk-tape--r" aria-hidden="true" />,
    holes && <span className="sk-holes" aria-hidden="true" />,
    children,
  );
}
