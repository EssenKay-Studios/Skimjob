// The end-of-game reveal on a small hand-made game (no server), summarised by the
// engine's own `revealSummary`, on its own page (/dev/gallery/reveal, so the big gallery
// page stays out of its tests) with each ending: a success, a bust only the Rooftop
// escapee wins, and a heist sunk by theft nobody wins.
// The names can switch to 24-character ones (the cap; "W" is the widest glyph
// and has no break points) to check nothing pushes past a phone's edge.
import { useMemo, useState, type ReactNode } from "react";
import { BANK_JOB, type RoomId } from "@skimjob/content";
import { PUBLIC, privateTo, revealSummary, type GameEvent, type Outcome, type RankEntry } from "@skimjob/engine";
import { Button } from "../components/Button";
import { ArrowBack } from "../components/icons";
import { Reveal } from "../components/Reveal";
import { Segmented } from "../components/Segmented";
import { SketchFrame } from "../components/SketchFrame";
import { Underline } from "../components/Underline";
import { navigate } from "../router";
import type { Snapshot } from "../game/snapshot";
import { TopBar } from "./TopBar";

const NAMES: Record<string, string> = {
  p1: "Ana",
  p2: "Ben",
  p3: "Cy",
  p4: "Bot · Dot",
};
const LONG_NAMES: Record<string, string> = {
  p1: "Maximiliana Wolfensteins",
  p2: "WWWWWWWWWWWWWWWWWWWWWWWW",
  p3: "MMMMMMMMMMMMMMMMMMMMMMMM",
  p4: "Bot · WWWWWWWWWWWWWWWWWWWWWWWW",
};
const ctxFor = (names: Record<string, string>) => ({
  me: "p1",
  name: (p: string) => names[p] ?? p,
});
const looks = new Map([
  ["p1", { look: 0, bot: false }],
  ["p2", { look: 1, bot: false }],
  ["p3", { look: 2, bot: false }],
  ["p4", { look: 3, bot: true }],
]);
/** Ana's own trust marks (design §10): Ben marked a liar in round 1, trusted in round 2. */
const marks = new Map([
  ["1/p2", "liar" as const],
  ["2/p2", "trusted" as const],
]);

/**
 * The snapshot cards of rounds 1 and 2, as the log below plays them (round 3 ends the game, so it
 * has no alibi window and no card). Each room: its bell and who says, or was shown, there.
 */
const FLOORS: RoomId[][] = [["rooftop"], ["security", "office", "managersOffice", "serverRoom"], ["lobby"], ["vault", "depositBoxes"]];
const snapCard = (round: number, missing: number, at: Partial<Record<RoomId, { bell?: number; raided?: number; crooks?: [string, "says" | "fact"][] }>>): Snapshot => ({
  round,
  floors: FLOORS.map((f) =>
    f.map((id) => ({
      id,
      name: BANK_JOB.rooms[id]!.name,
      bell: at[id]?.bell ?? 0,
      raided: at[id]?.raided ?? null,
      quiet: false,
      crooks: (at[id]?.crooks ?? []).map(([player, kind]) => ({ player, kind })),
    })),
  ),
  card: null,
  missing,
});
const CARDS = new Map([
  [1, snapCard(1, 5, { security: { crooks: [["p1", "fact"]] }, office: { bell: 1, crooks: [["p3", "says"]] }, lobby: { crooks: [["p2", "says"]] }, vault: { bell: 4, crooks: [["p4", "fact"]] } })],
  [2, snapCard(2, 5, { office: { bell: 2, crooks: [["p1", "fact"], ["p2", "says"]] }, lobby: { bell: 5, raided: 4, crooks: [["p4", "fact"]] }, vault: { bell: 3, crooks: [["p3", "says"]] } })],
]);

/** `player` grabbed `coins` in `room`, pocketing `pocket` of them. design §3.2 */
const split = (player: string, round: number, room: string, coins: number, pocket: number, seized = 0): GameEvent => ({
  type: "coinsGrabbed",
  visibility: privateTo(player),
  player,
  round,
  room,
  duffel: seized ? 0 : coins - pocket,
  pocket: seized ? 0 : pocket,
  seized,
});
const resolved = (round: number, bank: number, taken: number, missing: number, reached: number): GameEvent => ({
  type: "roundResolved",
  visibility: PUBLIC,
  round,
  bank,
  taken,
  missing,
  honesty: { reached, taken: 64 - bank },
});
/** The plan board as the round resolved: each seat's room claim. design §10 */
const plan = (round: number, claims: Record<string, string>): GameEvent => ({
  type: "said",
  visibility: PUBLIC,
  statement: {
    kind: "plan",
    round,
    plan: {
      entries: Object.entries(claims).map(([player, room]) => ({
        player,
        placed: null,
        room,
        power: null,
        agreed: false,
      })),
      history: [],
    },
  },
});
const alibi = (player: string, round: number, room: string): GameEvent => ({
  type: "said",
  visibility: PUBLIC,
  statement: { kind: "alibi", player, round, room },
});
const raided = (round: number, room: string, seized: number, wanted: number): GameEvent => ({
  type: "roomRaided",
  visibility: PUBLIC,
  round,
  room,
  seized,
  closedThrough: round + 1,
  wanted,
});

/**
 * Ana (Locksmith, you), Ben (Mole), Cy (Hacker), Dot (Detective): three rounds and a meeting.
 * Ben changes his story in round 1; Dot breaks the plan in round 2 and the Lobby raid tapes it off,
 * so Dot's missed move in round 3 sits the round out (design §3.3); the game ends in round 3,
 * where Cy hides the Vault's bell (design §11.1).
 */
const LOG: GameEvent[] = [
  {
    type: "roleDealt",
    visibility: privateTo("p1"),
    player: "p1",
    role: "locksmith",
  },
  {
    type: "roleDealt",
    visibility: privateTo("p2"),
    player: "p2",
    role: "mole",
  },
  {
    type: "roleDealt",
    visibility: privateTo("p3"),
    player: "p3",
    role: "hacker",
  },
  {
    type: "roleDealt",
    visibility: privateTo("p4"),
    player: "p4",
    role: "detective",
  },
  {
    type: "shopDealt",
    visibility: PUBLIC,
    perks: ["tail", "softShoes", "bail"],
  },
  { type: "roundStarted", visibility: PUBLIC, round: 1 },
  plan(1, { p1: "security", p2: "vault", p3: "office", p4: "vault" }),
  split("p1", 1, "security", 0, 0),
  split("p2", 1, "vault", 6, 3),
  split("p3", 1, "office", 4, 0),
  split("p4", 1, "vault", 6, 2),
  {
    type: "roomWatched",
    visibility: privateTo("p1"),
    player: "p1",
    round: 1,
    source: "security",
    room: "vault",
    seen: ["p2", "p4"],
    offline: false,
  },
  resolved(1, 48, 16, 5, 11),
  alibi("p2", 1, "lobby"),
  alibi("p3", 1, "office"),
  { type: "roundStarted", visibility: PUBLIC, round: 2 },
  plan(2, { p1: "office", p2: "vault", p3: "lobby", p4: "vault" }),
  {
    type: "abilityResolved",
    visibility: privateTo("p2"),
    player: "p2",
    round: 2,
    ability: { kind: "ring", room: "office" },
  },
  {
    type: "abilityResolved",
    visibility: privateTo("p4"),
    player: "p4",
    round: 2,
    ability: { kind: "detect", round: 1, target: "p2", grabbed: 6 },
  },
  split("p1", 2, "office", 4, 1),
  split("p2", 2, "vault", 6, 4),
  split("p3", 2, "vault", 2, 0),
  split("p4", 2, "lobby", 4, 0, 4),
  raided(2, "lobby", 4, 1),
  resolved(2, 32, 12, 5, 22),
  alibi("p2", 2, "office"),
  alibi("p3", 2, "vault"),
  {
    type: "meetingOpened",
    visibility: PUBLIC,
    meetingId: "m1",
    kind: "regular",
  },
  {
    type: "said",
    visibility: PUBLIC,
    statement: { kind: "role", player: "p2", role: "lookout", stretch: 1 },
  },
  {
    type: "meetingClosed",
    visibility: PUBLIC,
    meetingId: "m1",
    tally: { skip: 1, targets: { p3: 2 } },
    ballots: null,
    result: { kind: "shakedown", target: "p3" },
  },
  {
    type: "shakedownResolved",
    visibility: PUBLIC,
    meetingId: "m1",
    target: "p3",
    stashRevealed: 0,
    taken: 0,
    clean: true,
  },
  { type: "roundStarted", visibility: PUBLIC, round: 3 },
  {
    type: "eventFlipped",
    visibility: PUBLIC,
    round: 3,
    card: "shiftChange",
    room: null,
  },
  // design §12: Ana spends round 2's pocketed coin on a Tail.
  { type: "perkSold", visibility: PUBLIC, round: 3, perk: "tail", cost: 1 },
  {
    type: "perkBought",
    visibility: privateTo("p1"),
    player: "p1",
    round: 3,
    perk: { kind: "tail", room: "vault" },
    cost: 1,
  },
  plan(3, { p1: "rooftop", p2: "depositBoxes", p3: "vault", p4: "lobby" }),
  // design §3.3: the Lobby is taped off through round 3, so Dot's missed move sits the round out.
  {
    type: "defaultMoveAssigned",
    visibility: privateTo("p4"),
    player: "p4",
    round: 3,
    move: null,
  },
  {
    type: "abilityResolved",
    visibility: privateTo("p3"),
    player: "p3",
    round: 3,
    ability: { kind: "hide", room: "vault", bulbs: 2 },
  },
  split("p1", 3, "rooftop", 0, 0),
  split("p2", 3, "depositBoxes", 5, 5),
  split("p3", 3, "vault", 6, 5),
  resolved(3, 19, 13, 10, 25),
];
// design §5.4: a bust is three raids' worth of Wanted; round 3 adds two (the Lobby's was round 2's).
const BUST_RAIDS = [raided(3, "vault", 6, 2), raided(3, "depositBoxes", 5, 3)];

const rank = (player: string, role: string, stash: number): RankEntry => ({
  player,
  role,
  stash,
});

type Ending = "success" | "bust" | "theft";
const BEN_TOP = [rank("p2", "mole", 12), rank("p3", "hacker", 5), rank("p4", "detective", 2), rank("p1", "locksmith", 0)];
const OUTCOMES: Record<Ending, Outcome> = {
  success: { result: "success", ranking: BEN_TOP, winners: ["p2"], getaway: 1 },
  // design §5.5: a bust in round 3; only Ana was on the Rooftop.
  bust: {
    result: "failed",
    reason: "bust",
    escapees: ["p1"],
    ranking: BEN_TOP,
    winners: ["p1"],
  },
  // Here Ben hands rounds 2 and 3 in and Cy pockets round 3's grab, so the Hacker (no ★) leads and nobody wins.
  theft: {
    result: "failed",
    reason: "theft",
    ranking: [rank("p3", "hacker", 6), rank("p2", "mole", 3), rank("p4", "detective", 2), rank("p1", "locksmith", 0)],
    winners: [],
    getaway: 1,
  },
};
const logFor = (ending: Ending): GameEvent[] =>
  ending === "bust"
    ? [...LOG, ...BUST_RAIDS]
    : ending === "success"
      ? LOG
      : LOG.map((e) =>
          e.type !== "coinsGrabbed" || e.round === 1
            ? e
            : e.player === "p2"
              ? split("p2", e.round, e.room, e.duffel + e.pocket, 0)
              : e.player === "p3" && e.round === 3
                ? split("p3", 3, "vault", 6, 6)
                : e,
        );

/** The reveal demo's own page. */
export function RevealDemo() {
  const [ending, setEnding] = useState<Ending>("success");
  const [long, setLong] = useState(false);
  const ctx = useMemo(() => ctxFor(long ? LONG_NAMES : NAMES), [long]);
  const summary = useMemo(() => revealSummary(logFor(ending), OUTCOMES[ending]), [ending]);
  return (
    <div className="page">
      <TopBar>
        <Button variant="back" seed="reveal-back" icon={<ArrowBack />} onClick={() => navigate("/dev/gallery")}>
          Gallery
        </Button>
      </TopBar>
      <Section id="reveal" title="End-of-game reveal" note="S4.9 · every role, who won and why, and each round's card told true: TRUE or LIE, where each liar really was, and your own marks">
        <Segmented
          label="Ending"
          seed="g-reveal-ending"
          value={ending}
          onChange={setEnding}
          options={[
            { value: "success", label: "Job done" },
            { value: "bust", label: "Busted (Rooftop)" },
            { value: "theft", label: "Sunk by theft (nobody)" },
          ]}
          wide
        />
        <Segmented
          label="Names"
          seed="g-reveal-names"
          value={long}
          onChange={setLong}
          options={[
            { value: false, label: "Short" },
            { value: true, label: "24 characters" },
          ]}
        />
        <Reveal key={ending} summary={summary} ctx={ctx} looks={looks} marks={marks} cards={CARDS} bulbs={BANK_JOB.alarm.bulbs} />
      </Section>
    </div>
  );
}

/** The gallery's entry for the reveal: a link to its page. */
export function RevealSection() {
  return (
    <Section id="reveal-link" title="End-of-game reveal" note="S4.9 · design §15.5 · each round's card told true, sat-out rounds, the Hacker's hidden bell">
      <Button variant="primary" seed="g-reveal-open" onClick={() => navigate("/dev/gallery/reveal")}>
        Open the reveal demo
      </Button>
    </Section>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <SketchFrame as="section" seed={`g-${id}`} radius={16} shadow={0.5} className="g-section" aria-labelledby={`g-${id}`}>
      <header className="g-section__head">
        <h3 id={`g-${id}`}>
          <Underline seed={id}>{title}</Underline>
        </h3>
        {note && <p className="meta">{note}</p>}
      </header>
      {children}
    </SketchFrame>
  );
}
