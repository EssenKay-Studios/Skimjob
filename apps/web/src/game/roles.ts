// Pure helpers for the role cards and the "This game" rulebook (design §11,
// §15.6, §20.2). Every line and number comes from content (with the game's
// overrides) or the view.
import {
  BUST_ROLE_TEXT,
  EMERGENCY_POOL,
  EVENT_CHANCE,
  EVENTS_FROM_ROUND,
  ROLES,
  ROLE_TEXT,
  ROLE_WIN,
  lineText,
  ordinal,
  type RoleDef,
  type RoleId,
  type RoleKind,
  type RolePower,
} from "@skimjob/content";
import { rolesFor, type PlayerView } from "@skimjob/engine";
import { crewSize, jobOf, setupOf } from "./hud";

export const KIND_LABEL: Readonly<Record<RoleKind, string>> = {
  eyes: "Eyes",
  shadows: "Shadows",
};

/** The role table of a game (content overrides included), or plain content outside a game. */
export const rolesOf = (view: PlayerView | null): Readonly<Record<RoleId, RoleDef>> =>
  view ? rolesFor({ contentOverrides: setupOf(view)?.contentOverrides ?? null }) : ROLES;

/** How often a power can be used, from the power itself (design §11.2). */
export function cadenceOf(power: RolePower): string {
  if ("perGame" in power) return "Once a game";
  if ("perStretch" in power) return "Once between meetings";
  return power.kind === "voteWeight" ? "Every meeting" : "Every round";
}

/** How a power is used: in the move, instantly from the card (`useAbility`), or not at all (passive). design §11.1, §17.2 */
export type PowerUse = "move" | "instant" | "passive";
export const powerUse = (power: RolePower): PowerUse =>
  power.kind === "detect" || power.kind === "audit" ? "instant" : power.kind === "muffle" || power.kind === "voteWeight" ? "passive" : "move";

export interface RoleInfo {
  readonly id: RoleId;
  readonly name: string;
  readonly kind: RoleKind;
  readonly kindLabel: string;
  readonly cadence: string;
  readonly use: PowerUse;
  /** The power's line (design §20.2). */
  readonly power: string;
  readonly howYouWin: string;
  /** Said once for every role. */
  readonly bust: string;
  /** How the others can tell. */
  readonly spot: string;
}

/** A role's card text; undefined for an id content doesn't know. */
export function roleInfo(id: RoleId, roles: Readonly<Record<RoleId, RoleDef>> = ROLES): RoleInfo | undefined {
  const def = Object.hasOwn(roles, id) ? roles[id] : undefined;
  const text = Object.hasOwn(ROLE_TEXT, id) ? ROLE_TEXT[id] : undefined;
  if (!def || !text) return undefined;
  return {
    id,
    name: def.name,
    kind: def.kind,
    kindLabel: KIND_LABEL[def.kind],
    cadence: cadenceOf(def.power),
    use: powerUse(def.power),
    power: text.power,
    howYouWin: ROLE_WIN[text.win],
    bust: BUST_ROLE_TEXT,
    spot: text.spot,
  };
}

export interface RoleListInfo {
  readonly mode: "exact" | "possible" | "hidden";
  /** The panel's title. */
  readonly title: string;
  /** Its right-hand note: "exact list · 6 dealt". */
  readonly note: string;
  /** Each role once, in content order, with how many were dealt (exact list only; else 1). */
  readonly roles: readonly { readonly id: RoleId; readonly count: number }[];
}

/** The role list as the host set it to show (design §11.3): exact (with counts), possible or hidden. */
export function roleListInfo(view: PlayerView): RoleListInfo {
  const l = view.roleList;
  if (!l)
    return {
      mode: "hidden",
      title: "Roles in play",
      note: "hidden in this game",
      roles: [],
    };
  const counts = new Map<RoleId, number>();
  for (const r of l.roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  const roles = Object.keys(rolesOf(view)).flatMap((id) => (counts.has(id) ? [{ id, count: l.list === "exact" ? counts.get(id)! : 1 }] : []));
  return l.list === "exact"
    ? {
        mode: "exact",
        title: "Roles in play",
        note: `exact list · ${l.roles.length} dealt`,
        roles,
      }
    : {
        mode: "possible",
        title: "Roles that could be in play",
        note: `possible list · ${roles.length} roles`,
        roles,
      };
}

/** A label and a value in the rulebook's Numbers block. */
export interface NumberRow {
  readonly label: string;
  readonly value: string;
}

/** "3–6": the crew sizes that share one emergency pool. */
function poolBand(crew: number): string {
  const same = Object.keys(EMERGENCY_POOL)
    .map(Number)
    .filter((n) => EMERGENCY_POOL[n] === EMERGENCY_POOL[crew]);
  return `${Math.min(...same)}–${Math.max(...same)}`;
}

/** The rulebook's numbers, all from content and the game's setup (design §20; §5, §6, §7.5, §9). */
export function numberRows(view: PlayerView): NumberRow[] {
  const job = jobOf(view);
  const crew = crewSize(view);
  const { bulbs, tapedRounds, bustStars } = job.alarm;
  const perPlayer = `${job.bank.coinsPerPlayer} a player`;
  return [
    {
      label: "Bank",
      value: `${job.bank.coinsPerPlayer * crew} coins (${perPlayer})`,
    },
    { label: "Rounds", value: `up to ${job.roundCap}` },
    { label: "Bell", value: `${bulbs} bulbs; the ${ordinal(bulbs)} is a raid` },
    {
      label: "Raid",
      value: `seized grab, closed ${tapedRounds} rounds, Wanted +1`,
    },
    { label: "Wanted", value: `${bustStars} stars is a bust` },
    {
      label: "Honesty line",
      value: `${lineText(job.honestyLine)} of what's taken`,
    },
    // design §9.1: thirds of the bank are structural, not a tunable.
    { label: "Meetings", value: "each third of the bank, after every raid" },
    ...(!EMERGENCY_POOL[crew]
      ? []
      : [
          {
            label: "Emergencies",
            value: `${EMERGENCY_POOL[crew]} for the crew (${poolBand(crew)} players)`,
          },
        ]),
  ];
}

/** "from round 2 · 4 in 10": when the events deck may flip a card (design §13). */
export const eventsNote = `from round ${EVENTS_FROM_ROUND} · ${EVENT_CHANCE.in} in ${EVENT_CHANCE.of}`;
