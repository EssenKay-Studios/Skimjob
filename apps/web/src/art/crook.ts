// Masked-crook looks (M2-9): a crew colour, a hat and a body shape, all
// deterministic. Seats 0–11 always get 12 different colours, so a full crew
// of 12 reads apart at a glance; free-form seeds (names) hash into the same
// palette. Pure: no React, no DOM.
import { hashSeed, type Seed } from "../components/sketch";

/** Number of crew colours (`--crew-1` … `--crew-12` in theme.css). */
export const CREW_SIZE = 12;

export const HATS = ["beanie", "pompom", "cap", "bandana", "none"] as const;
export type Hat = (typeof HATS)[number];

/** Number of accessory colours (`--acc-1` … `--acc-6`). */
export const ACC_COLOURS = 6;

export const EXPRESSIONS = ["neutral", "smug", "nervous", "caught"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export interface CrookLook {
  /** 1-based crew colour, `var(--crew-N)`. */
  readonly colour: number;
  readonly hat: Hat;
  /** 1-based accessory colour for the hat or bandana, `var(--acc-N)`. */
  readonly hatColour: number;
  /** Body silhouette: 0 round, 1 tall bean, 2 pear. */
  readonly shape: 0 | 1 | 2;
}

// Hat colours that read on each body colour (no navy hat on a navy crook).
const HAT_COLOUR_FOR: readonly number[] = [1, 3, 6, 1, 3, 2, 4, 3, 1, 2, 1, 2];

/**
 * The look for a seat (a number: 0-based seat order) or any other seed
 * (string: hashed). Seats 0–11 get distinct colours and a spread of hats.
 */
export function crookLook(key: Seed): CrookLook {
  if (typeof key === "number" && Number.isInteger(key) && key >= 0) {
    const colour = (key % CREW_SIZE) + 1;
    const round = Math.floor(key / CREW_SIZE);
    // A stride coprime with the hat count, so neighbours differ in hat too.
    const hat = HATS[(key * 2 + round) % HATS.length]!;
    const shape = ((key + round) % 3) as 0 | 1 | 2;
    return { colour, hat, hatColour: HAT_COLOUR_FOR[colour - 1]!, shape };
  }
  const h = hashSeed(String(key).trim().toLowerCase());
  const colour = (h % CREW_SIZE) + 1;
  return {
    colour,
    hat: HATS[(h >>> 8) % HATS.length]!,
    hatColour: HAT_COLOUR_FOR[colour - 1]!,
    shape: ((h >>> 16) % 3) as 0 | 1 | 2,
  };
}

/** Looks for a crew in seat order: always distinct colours up to 12 players. */
export function crewLooks(count: number): CrookLook[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => crookLook(i));
}

export const crewVar = (n: number) => `var(--crew-${n})`;
export const accVar = (n: number) => `var(--acc-${n})`;

/** Light-bodied crooks (mustard, lilac, cream) get a darker mask outline. */
export function isLightBody(colour: number): boolean {
  return colour === 7 || colour === 11 || colour === 12;
}

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
