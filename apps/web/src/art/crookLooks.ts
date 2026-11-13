// Masked-crook looks (M2-9): a crew colour, a hat and a body shape, all
// deterministic. Seats 0–11 always get 12 different colours AND 12 different
// hats (shape or pattern), so a full crew of 12 reads apart at a glance even
// without colour vision (red-green CVD); free-form seeds (names) hash into the
// same palette. Pure: no React, no DOM.
import { hashSeed, type Seed } from "../components/sketch";

/** Number of crew colours (`--crew-1` … `--crew-12` in theme.css). */
export const CREW_SIZE = 12;

/**
 * Twelve hats with different silhouettes (or, for `stripes`, a bold pattern),
 * in seat order: seat N wears HATS[N]. The order keeps the pairs of crew
 * colours that merge under deuteranopia/protanopia (1/3, 3/8, 4/9, 6/11) in
 * very different hats.
 */
export const HATS = [
  "beanie", // 1 clay
  "cap", // 2 navy
  "none", // 3 olive: a hair tuft
  "pompom", // 4 pink
  "bandana", // 5 violet
  "beret", // 6 sky
  "fedora", // 7 gold
  "tophat", // 8 brown
  "earmuffs", // 9 teal
  "goggles", // 10 grey
  "stripes", // 11 purple: a striped beanie
  "propeller", // 12 red
] as const;
export type Hat = (typeof HATS)[number];

export const EXPRESSIONS = ["neutral", "smug", "nervous", "caught"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export interface CrookLook {
  /** 1-based crew colour, `var(--crew-N)`. */
  readonly colour: number;
  readonly hat: Hat;
  /** 1-based accessory colour for the hat, `var(--acc-N)`. */
  readonly hatColour: number;
  /** Body silhouette: 0 round, 1 tall bean, 2 pear. */
  readonly shape: 0 | 1 | 2;
}

/** Each hat's own colour (dark, red, gold, navy, olive, paper). */
const HAT_COLOUR: Record<Hat, number> = {
  beanie: 1,
  cap: 3,
  none: 1,
  pompom: 4,
  bandana: 3,
  beret: 2,
  fedora: 4,
  tophat: 1,
  earmuffs: 3,
  goggles: 4,
  stripes: 4,
  propeller: 2,
};

// Hat colours that would vanish on a body colour (navy on navy, gold on dark gold…).
const CLASH: Partial<Record<number, number>> = { 2: 4, 3: 5, 7: 3 };

const hatColourFor = (hat: Hat, colour: number) => {
  const c = HAT_COLOUR[hat];
  return CLASH[colour] === c ? (c === 1 ? 2 : 1) : c;
};

/**
 * The look for a seat (a number: 0-based seat order) or any other seed
 * (string: hashed). Seats 0–11 get distinct colours and distinct hats.
 */
export function crookLook(key: Seed): CrookLook {
  if (typeof key === "number" && Number.isInteger(key) && key >= 0) {
    const colour = (key % CREW_SIZE) + 1;
    const round = Math.floor(key / CREW_SIZE);
    // Seats past 12 shift the hats (5 is coprime with 12), so seat 12 isn't seat 0's twin.
    const hat = HATS[(key + round * 5) % HATS.length]!;
    const shape = ((key + round) % 3) as 0 | 1 | 2;
    return { colour, hat, hatColour: hatColourFor(hat, colour), shape };
  }
  const h = hashSeed(String(key).trim().toLowerCase());
  const colour = (h % CREW_SIZE) + 1;
  const hat = HATS[(h >>> 8) % HATS.length]!;
  return { colour, hat, hatColour: hatColourFor(hat, colour), shape: ((h >>> 16) % 3) as 0 | 1 | 2 };
}

/** Looks for a crew in seat order: always distinct colours up to 12 players. */
export function crewLooks(count: number): CrookLook[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => crookLook(i));
}

export const crewVar = (n: number) => `var(--crew-${n})`;
export const accVar = (n: number) => `var(--acc-${n})`;

const EXPRESSION_WORDS: Record<Expression, string> = {
  neutral: "",
  smug: "looking smug",
  nervous: "looking nervous",
  caught: "caught",
};

/** Accessible label: "Mara, looking smug (bot)". */
export function crookLabel(name: string, expression: Expression = "neutral", bot = false): string {
  const mood = EXPRESSION_WORDS[expression];
  return `${name}${mood ? `, ${mood}` : ""}${bot ? " (bot)" : ""}`;
}

/**
 * A short visible name tag (1–2 characters): initials for "Mara Vox" (MV),
 * the first two letters for "Dez" (De). Used on avatars and figures so
 * players are identifiable without colour or hover.
 */
export function nameTag(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = (w: string) => Array.from(w)[0]!.toUpperCase();
  if (words.length >= 2) return first(words[0]!) + first(words[1]!);
  const chars = Array.from(words[0]!);
  return chars[0]!.toUpperCase() + (chars[1] ?? "").toLowerCase();
}

/**
 * Name tags for a whole crew, unique within it: clashes ("Mara", "Max") try
 * another letter of the name ("Ma", "Mx"), then a number ("Ma2").
 */
export function crewTags(names: readonly string[]): string[] {
  const base = names.map(nameTag);
  const used = new Set<string>();
  const take = (t: string) => (used.add(t), t);
  return base.map((t, i) => {
    if (!used.has(t)) return take(t);
    const free = (alt: string) => !used.has(alt) && !base.includes(alt);
    for (const c of Array.from(names[i]!.replace(/\s+/g, "")).slice(1)) {
      const alt = t[0]! + c.toLowerCase();
      if (free(alt)) return take(alt);
    }
    for (let n = 2; ; n++) if (free(`${t}${n}`)) return take(`${t}${n}`);
  });
}
