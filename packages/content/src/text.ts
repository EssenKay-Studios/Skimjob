// The one-line texts the UI, the rulebook and the InfoTips read, so they never
// drift: rooms, roles, perks, events, the Terms glossary and the other tips.
// Plain, short and friendly. Data only. design §20
import { EVENTS } from "./events";
import type { RoleId, RoomId } from "./index";
import { BANK_JOB, type JobDef } from "./jobs";

const { bulbs, bustStars } = BANK_JOB.alarm;

/** 0 to 10 in words, for the lines that start a sentence with a count. */
const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"] as const;
const word = (n: number): string => WORDS[n] ?? String(n);

/** "4th": the count as an ordinal. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
}

/** The honesty line as the rulebook writes it: ⅔ for two-thirds, else a percentage. */
export function lineText(line: number): string {
  return Math.abs(line - 2 / 3) < 1e-9 ? "⅔" : `${Math.round(line * 100)}%`;
}

/** The honesty line in a sentence: "two-thirds", else a percentage. */
export function lineWords(line: number): string {
  return Math.abs(line - 2 / 3) < 1e-9 ? "two-thirds" : `${Math.round(line * 100)}%`;
}

/** What an InfoTip shows: a short name and one line. */
export interface InfoText {
  readonly name: string;
  readonly text: string;
}

/** Room text by room id (the name is the room's own). design §20.1 */
export const ROOM_TEXT: Readonly<Record<RoomId, string>> = {
  lobby: "1 coin, and not a sound. The safe choice.",
  office: "Up to 2 coins. Each coin rings the bell once.",
  depositBoxes: "Up to 2 coins. Each coin rings the bell once.",
  managersOffice: "Up to 2 coins. Each coin rings the bell once.",
  serverRoom: "Up to 2 coins. Each coin rings the bell once.",
  vault: "Up to 3 coins, and they ring the bell. Big money, big noise.",
  security: "No coins, but you watch one room's cameras and see who was there.",
  rooftop: "No coins. Lie low, cool the hottest bell, and it's the only way out of a bust.",
};

/** How a role wins, in the two wordings §20.2 uses. */
export const ROLE_WIN = {
  crew: "Like everyone: the biggest stash (or a tie for it) on a good heist.",
  sunk: "The biggest stash (or a tie for it) on a good heist, or the biggest of all on a heist sunk by theft.",
} as const;

/** Said once for every role. design §20.2 */
export const BUST_ROLE_TEXT = "On a bust, only the Rooftop gets away.";

export interface RoleText {
  readonly name: string;
  /** What the role's power does. */
  readonly power: string;
  readonly win: keyof typeof ROLE_WIN;
  /** How the others can tell. */
  readonly spot: string;
}

/** Role text by role id. design §20.2 */
export const ROLE_TEXT: Readonly<Record<RoleId, RoleText>> = {
  lookout: {
    name: "Lookout",
    power: "Each round, also see who was in one more room.",
    win: "crew",
    spot: "Knows who was where, sometimes a little too well.",
  },
  locksmith: {
    name: "Locksmith",
    power: "Each of your coins rings one time less.",
    win: "crew",
    spot: "A room rang less than its visitors' alibis add up to.",
  },
  detective: {
    name: "Detective",
    power: "Each round, learn how many coins one player grabbed last round.",
    win: "crew",
    spot: "Knows exact grab counts nobody announced.",
  },
  auditor: {
    name: "Auditor",
    power: "Once between meetings, learn how many coins reached the duffel from one room last round.",
    win: "crew",
    spot: "Talks about one room's hand-ins with odd certainty.",
  },
  smoothTalker: { name: "Smooth Talker", power: "Your vote counts twice.", win: "crew", spot: "A vote passed with fewer hands than it should have." },
  hacker: {
    name: "Hacker",
    power: "Once between meetings, hide one open room's bell from everyone this round.",
    win: "crew",
    spot: 'A bell shows "?" and someone seems calm about it.',
  },
  electrician: {
    name: "Electrician",
    power: "Once between meetings, cut the power in one room next round: no sightings, no cameras.",
    win: "crew",
    spot: "A power cut lands where someone wanted no witnesses.",
  },
  priest: {
    name: "Priest",
    power: "Once between meetings, secretly take back whatever one player holds above their share (not on a bust).",
    win: "crew",
    spot: "Coins come back with no shakedown.",
  },
  mole: {
    name: "Mole",
    power: "Once between meetings, secretly ring any room once (not the Rooftop or a taped-off room).",
    win: "sunk",
    spot: "A bell rang more than the people in the room can explain.",
  },
  fixer: {
    name: "Fixer",
    power: "Once a game, tear the police tape off a raided room and reopen it.",
    win: "sunk",
    spot: "A taped-off room is suddenly open again.",
  },
};

/** Perk text by perk id. design §20.3 */
export const PERK_TEXT: Readonly<Record<string, InfoText>> = {
  tail: { name: "Tail", text: "Next round, also see who was in one more room." },
  ballot: { name: "Check ballot", text: "See one player's vote at the next meeting." },
  softShoes: { name: "Soft shoes", text: "Next round, your coins make no sound at all." },
  blackout: { name: "Blackout", text: "Next round, one room goes dark: no sightings, no cameras." },
  bail: { name: "Bail", text: "When a shakedown passes against you, you can make it fall through." },
  plantEvidence: { name: "Plant evidence", text: "Put one player on one room's cameras this round." },
};

/** Event card text by event id (the name is the card's own). design §20.4 */
export const EVENT_TEXT: Readonly<Record<string, string>> = {
  lockdown: "One room is closed this round.",
  shiftChange: "Vault visitors can grab 1 extra coin this round.",
  audit: "This round, every room shows how many coins reached the duffel from it.",
  insideTip: "Someone just learned another player's role.",
};

/** The glossary for a job's numbers (a game may override them); each line is also the InfoTip wherever its word appears. design §20.5 */
export const termsFor = ({ alarm, honestyLine }: Pick<JobDef, "alarm" | "honestyLine">) => ({
  duffel: { name: "Duffel", text: "The crew bag. Split equally every round." },
  share: { name: "Share", text: "Your equal cut of every split so far." },
  pocket: { name: "Pocket", text: "Coins you skimmed. Yours alone." },
  stash: { name: "Stash", text: "Your private total: share + pocket. The biggest wins." },
  kitty: { name: "Kitty", text: "Leftover change, carried into the next split." },
  shakedown: { name: "Shakedown", text: "A vote that opens one stash; what's above the share goes into the next split." },
  protected: { name: "Protected", text: "Shaken down already: safe until the next regular meeting." },
  wanted: { name: "Wanted", text: `One star per raid. ${word(alarm.bustStars)} is a bust.` },
  raid: { name: "Raid", text: `The ${ordinal(alarm.bulbs)} bulb lights: grabs there are seized.` },
  bust: { name: "Bust", text: `Wanted ${alarm.bustStars}. Only the Rooftop gets away.` },
  honesty: { name: "Honesty", text: `Coins that reached the duffel ÷ coins taken. Line: ${lineText(honestyLine)}.` },
}) as const satisfies Record<string, InfoText>;

/** The glossary at content's own numbers. */
export const TERMS = termsFor(BANK_JOB);

/** The InfoTips that are not glossary words. design §20.5 */
export const TIPS = {
  bell: { name: "Bell", text: `Every noisy coin lights a bulb. Light the ${ordinal(bulbs)} and the police raid the room.` },
  bank: { name: "Bank", text: "Coins left to steal. The game ends when it's empty, or after the last round." },
  moveDuffel: { name: "Duffel", text: "Coins here are shared equally by the whole crew." },
  movePocket: { name: "Pocket", text: "Coins here are yours alone. Nobody sees them, unless you're shaken down or absolved." },
  missing: { name: "Missing", text: "Coins taken this round that never reached the duffel. Nobody knows whose." },
  tapedOff: { name: "Taped off", text: "A raided room stays closed for a couple of rounds. The sign counts down." },
  emergency: { name: "Emergency", text: "The crew shares a few emergency meetings. Anyone can call one after a round's result." },
  planBoard: { name: "Plan board", text: "Drag the crew onto rooms. Nothing is binding." },
  iAgree: { name: "I agree", text: "Tap when the plan suits you. Anyone can still break it." },
  alibiPopup: { name: "Where were you?", text: "After each round, say which room you were in, true or a lie. One alibi a round, and you can't change it." },
  snapshot: { name: "Snapshot card", text: "Where everyone says they were this round, with what everyone saw: bells, raids, the event and missing coins." },
  trustMarks: { name: "Your marks", text: "Mark any crook's alibi Trusted or Liar for your own notes. Only you see your marks." },
  cardKey: { name: "How to read the card", text: "A dashed ring is what someone says. A solid ring is a fact: they gave no alibi, so the game shows where they really were." },
  leads: { name: "Leads", text: "What happened, newest first. ⚠ means two facts don't add up." },
  pins: { name: "Pins", text: "Pin a lead or one fact. Only you see your pins." },
  suspect: { name: "Suspect", text: "Who your facts point at: your pins if you have 2 or more, otherwise every lead. A hunch, not proof." },
  market: { name: "Black market", text: "Perks cost coins from your stash; they leave the game. Every purchase is logged without a name." },
  marketStash: { name: "Paying from your stash", text: "You pay from your stash as it stood when the round began. This round's pocket can't pay." },
} as const satisfies Record<string, InfoText>;

/** The teaching pop-ups, shown once per player the first time each thing happens (design §15.6, §20.6). */
export interface Lesson {
  readonly title: string;
  readonly happened: string;
  readonly means: string;
  readonly canDo: string;
}

/** Teaching pop-up text by lesson id. design §20.6 */
export const LESSONS = {
  bell: {
    title: "A bell rang",
    happened: "Someone's noisy coin lit a bulb on a room's bell.",
    means: TIPS.bell.text,
    canDo: "Pick quiet rooms, or share the noise. The Rooftop cools the hottest bell.",
  },
  raid: {
    title: "Raid!",
    happened: `A room's ${ordinal(bulbs)} bulb lit and the police raided it.`,
    means: "Every grab there was seized, the room is taped off for a couple of rounds, and Wanted went up by one star.",
    canDo: `Go somewhere else while the tape is up. ${word(bustStars)} stars is a bust.`,
  },
  oneStar: {
    title: "One star from a bust",
    happened: `Wanted is at ${bustStars - 1} of ${bustStars}.`,
    means: "One more raid is a bust, and on a bust only the Rooftop gets away.",
    canDo: "Keep the bells low, or hide on the Rooftop.",
  },
  powerCut: {
    title: "A power cut",
    happened: "The lights went out in one room.",
    means: "Nobody there sees who else is there this round, and its cameras are offline. Its bell still rings.",
    canDo: "Ask the crew who wanted no witnesses. An Electrician can do this.",
  },
  shakedown: {
    title: "A shakedown",
    happened: "The crew voted to open one stash.",
    means: TERMS.shakedown.text,
    canDo: "Keep your pocket modest, or bring a Bail. A shaken-down player is protected until the next regular meeting.",
  },
  missing: {
    title: "Coins went missing",
    happened: "The round's result shows coins that were taken but never handed in.",
    means: TIPS.missing.text,
    canDo: `Watch the honesty meter: under ${lineWords(BANK_JOB.honestyLine)} and the heist fails for everyone. Talk it over at the meeting.`,
  },
} as const satisfies Record<string, Lesson>;

export type LessonId = keyof typeof LESSONS;

export type TermId = keyof typeof TERMS;
export type TipId = keyof typeof TIPS;

/** Anything an InfoTip can explain. */
export type InfoRef =
  | { readonly kind: "term"; readonly id: TermId }
  | { readonly kind: "tip"; readonly id: TipId }
  | { readonly kind: "room"; readonly id: RoomId }
  | { readonly kind: "role"; readonly id: RoleId }
  | { readonly kind: "perk"; readonly id: string }
  | { readonly kind: "event"; readonly id: string };

/** The name and line to show for `ref`; undefined when content has none for that id. */
export function infoText(ref: InfoRef): InfoText | undefined {
  switch (ref.kind) {
    case "term":
      return TERMS[ref.id];
    case "tip":
      return TIPS[ref.id];
    case "room": {
      const room = BANK_JOB.rooms[ref.id];
      const text = ROOM_TEXT[ref.id];
      return room && text ? { name: room.name, text } : undefined;
    }
    case "role": {
      const role = ROLE_TEXT[ref.id];
      return role && { name: role.name, text: role.power };
    }
    case "perk":
      return PERK_TEXT[ref.id];
    case "event": {
      const event = EVENTS[ref.id];
      const text = EVENT_TEXT[ref.id];
      return event && text ? { name: event.name, text } : undefined;
    }
  }
}
