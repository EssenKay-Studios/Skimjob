// Seeded "hand-drawn" frame geometry (ui-style §4). Pure and deterministic:
// the same (w, h, seed, options) always gives the same paths, so a frame looks
// identical on every render. Our own generator, written from the style guide.

export type Seed = string | number;

/** FNV-1a hash of a seed, as a 32-bit unsigned integer. */
export function hashSeed(seed: Seed): number {
  const s = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded RNG returning floats in [0, 1). UI only, never the engine. */
export function rngFrom(seed: Seed): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FrameOptions {
  /** Base corner radius in px (12 for cards, 18–26 for big sheets). */
  readonly radius?: number;
  /** Wobble amplitude of the ink line in px (about 1.1). */
  readonly wobble?: number;
  /** Average ink width in px (about 1.8); thicker at the corners. */
  readonly stroke?: number;
}

export interface FramePaths {
  /** Closed centre line: the body fill, the shadow and the clip shape. */
  readonly body: string;
  /** Variable-width ink outline as a filled ring (fill-rule evenodd). */
  readonly ink: string;
  /** Thin pencil construction line, slightly off the ink line. */
  readonly ghost: string;
}

interface Pt {
  x: number;
  y: number;
}
interface Sample extends Pt {
  nx: number;
  ny: number;
  /** Perimeter position in [0, 1). */
  t: number;
  /** 1 in the middle of a corner, 0 on the straight parts. */
  corner: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Smooth closed spline (Catmull–Rom → cubic Bézier) through the points. */
function closedPath(pts: readonly Pt[]): string {
  const n = pts.length;
  const at = (i: number) => pts[((i % n) + n) % n]!;
  let d = `M${r1(at(0).x)} ${r1(at(0).y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${r1(c1x)} ${r1(c1y)} ${r1(c2x)} ${r1(c2y)} ${r1(p2.x)} ${r1(p2.y)}`;
  }
  return d + "Z";
}

/** A loop-seamless smooth noise: a few sines with whole-number cycles round the perimeter. */
function loopNoise(rand: () => number, perimeter: number, wavelengths: readonly number[]): (t: number) => number {
  const waves = wavelengths.map((lambda) => ({
    cycles: Math.max(1, Math.round(perimeter / lambda)),
    phase: rand() * Math.PI * 2,
    amp: 0.6 + rand() * 0.4,
  }));
  const total = waves.reduce((s, w) => s + w.amp, 0);
  return (t) => waves.reduce((s, w) => s + w.amp * Math.sin(w.cycles * t * Math.PI * 2 + w.phase), 0) / total;
}

/**
 * Samples a slightly skewed rounded rectangle, inset so the ink stays inside
 * the w×h box. Each corner gets its own radius and a small offset.
 */
function samplePerimeter(w: number, h: number, rand: () => number, radius: number, inset: number): Sample[] {
  const skew = Math.min(2.2, 0.01 * (w + h));
  const jitter = () => (rand() * 2 - 1) * skew;
  const maxR = Math.max(1, Math.min(w, h) / 2 - inset - 1);
  // Corners clockwise from top-left: centre of the arc and its start angle.
  const corners = [
    { x: inset, y: inset, a0: Math.PI },
    { x: w - inset, y: inset, a0: -Math.PI / 2 },
    { x: w - inset, y: h - inset, a0: 0 },
    { x: inset, y: h - inset, a0: Math.PI / 2 },
  ].map((c, i) => {
    const r = Math.min(maxR, radius * (0.78 + rand() * 0.44));
    const sx = i === 0 || i === 3 ? 1 : -1;
    const sy = i < 2 ? 1 : -1;
    const dx = jitter() * 0.5;
    const dy = jitter() * 0.5;
    return { cx: c.x + sx * r + dx, cy: c.y + sy * r + dy, r, a0: c.a0 };
  });

  const out: Omit<Sample, "t">[] = [];
  const step = 5;
  for (let i = 0; i < 4; i++) {
    const c = corners[i]!;
    const next = corners[(i + 1) % 4]!;
    // Arc: a quarter turn clockwise.
    const arcSteps = Math.max(3, Math.ceil((c.r * Math.PI) / 2 / step));
    for (let k = 0; k < arcSteps; k++) {
      const f = k / arcSteps;
      const a = c.a0 + (f * Math.PI) / 2;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      out.push({ x: c.cx + nx * c.r, y: c.cy + ny * c.r, nx, ny, corner: Math.sin(f * Math.PI) });
    }
    // Straight side from the end of this arc to the start of the next.
    const a1 = c.a0 + Math.PI / 2;
    const sx0 = c.cx + Math.cos(a1) * c.r;
    const sy0 = c.cy + Math.sin(a1) * c.r;
    const sx1 = next.cx + Math.cos(next.a0) * next.r;
    const sy1 = next.cy + Math.sin(next.a0) * next.r;
    const len = Math.hypot(sx1 - sx0, sy1 - sy0);
    const sideSteps = Math.max(1, Math.ceil(len / (step * 3)));
    const tx = (sx1 - sx0) / (len || 1);
    const ty = (sy1 - sy0) / (len || 1);
    for (let k = 0; k < sideSteps; k++) {
      const f = k / sideSteps;
      // Outward normal of a clockwise loop (screen coordinates): (ty, -tx).
      out.push({ x: sx0 + (sx1 - sx0) * f, y: sy0 + (sy1 - sy0) * f, nx: ty, ny: -tx, corner: 0 });
    }
  }
  // Perimeter positions by arc length.
  let acc = 0;
  const lens = out.map((p, i) => {
    const q = out[(i + 1) % out.length]!;
    const l = acc;
    acc += Math.hypot(q.x - p.x, q.y - p.y);
    return l;
  });
  return out.map((p, i) => ({ ...p, t: lens[i]! / acc }));
}

function perimeterLength(w: number, h: number): number {
  return 2 * (w + h);
}

const cache = new Map<string, FramePaths>();
const CACHE_MAX = 400;

/** The frame's paths in a w×h box. Cached by (w, h, seed, options). */
export function framePaths(w: number, h: number, seed: Seed, opts: FrameOptions = {}): FramePaths {
  const radius = opts.radius ?? 12;
  const wobble = opts.wobble ?? 1.1;
  const stroke = opts.stroke ?? 1.8;
  const W = Math.max(8, Math.round(w));
  const H = Math.max(8, Math.round(h));
  const key = `${W}x${H}|${seed}|${radius}|${wobble}|${stroke}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rand = rngFrom(seed);
  const inset = stroke / 2 + wobble + 0.6;
  const samples = samplePerimeter(W, H, rand, radius, inset);
  const P = perimeterLength(W, H);
  const drift = loopNoise(rand, P, [260, 90, 37]);
  const thick = loopNoise(rand, P, [120, 45]);
  const ghostDrift = loopNoise(rand, P, [180, 70]);
  const gx = (rand() - 0.5) * 1.6;
  const gy = (rand() - 0.5) * 1.6;

  const centre: Pt[] = [];
  const outer: Pt[] = [];
  const inner: Pt[] = [];
  const ghost: Pt[] = [];
  for (const s of samples) {
    const d = drift(s.t) * wobble;
    const half = (stroke * (0.82 + 0.28 * thick(s.t)) + s.corner * stroke * 0.45) / 2;
    const cx = s.x + s.nx * d;
    const cy = s.y + s.ny * d;
    centre.push({ x: cx, y: cy });
    outer.push({ x: cx + s.nx * half, y: cy + s.ny * half });
    inner.push({ x: cx - s.nx * half, y: cy - s.ny * half });
    const g = ghostDrift(s.t) * wobble * 1.4;
    ghost.push({ x: s.x + s.nx * g + gx, y: s.y + s.ny * g + gy });
  }

  const paths: FramePaths = {
    body: closedPath(centre),
    ink: closedPath(outer) + closedPath(inner.reverse()),
    ghost: closedPath(ghost),
  };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, paths);
  return paths;
}
