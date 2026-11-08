// /dev/gallery section for M2-11: the end-of-game reveal on a small hand-made
// game (no server), summarised by the engine's own `revealSummary`, with each
// ending: a success, a bust only the Rooftop escapee wins, and a heist sunk by theft nobody wins.
// The names can switch to 24-character ones (the cap; "W" is the widest glyph
// and has no break points) to check nothing pushes past a phone's edge.
import { useMemo, useState, type ReactNode } from "react";
import { PUBLIC, privateTo, revealSummary, type GameEvent, type Outcome, type RankEntry } from "@skimjob/engine";
import { Reveal } from "../components/Reveal";
import { Segmented } from "../components/Segmented";
import { SketchFrame } from "../components/SketchFrame";
import { Underline } from "../components/Underline";

const NAMES: Record<string, string> = { p1: "Ana", p2: "Ben", p3: "Cy", p4: "Bot · Dot" };
const LONG_NAMES: Record<string, string> = {
  p1: "Maximiliana Wolfensteins",
  p2: "WWWWWWWWWWWWWWWWWWWWWWWW",
  p3: "MMMMMMMMMMMMMMMMMMMMMMMM",
  p4: "Bot · WWWWWWWWWWWWWWWWWWWWWWWW",
};
const ctxFor = (names: Record<string, string>) => ({ me: "p1", name: (p: string) => names[p] ?? p });
const looks = new Map([
  ["p1", { look: 0, bot: false }],
  ["p2", { look: 1, bot: false }],
  ["p3", { look: 2, bot: false }],
  ["p4", { look: 3, bot: true }],
]);

/** `player` grabbed `coins` in `room`, pocketing `pocket` of them. design §3.2 (the R6 story's amounts, until S4.9 redraws the reveal) */
const split = (player: string, round: number, room: string, coins: number, pocket: number): GameEvent => ({
  type: "coinsGrabbed",
  visibility: privateTo(player),
  player,
  round,
  room,
  duffel: coins - pocket,
  pocket,
  seized: 0,
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

/** Ana (Locksmith, you), Ben (Mole), Cy (Hacker), Dot (Detective): three rounds and a meeting. */
const LOG: GameEvent[] = [
  { type: "roleDealt", visibility: privateTo("p1"), player: "p1", role: "locksmith" },
  { type: "roleDealt", visibility: privateTo("p2"), player: "p2", role: "mole" },
  { type: "roleDealt", visibility: privateTo("p3"), player: "p3", role: "hacker" },
  { type: "roleDealt", visibility: privateTo("p4"), player: "p4", role: "detective" },
  { type: "shopDealt", visibility: PUBLIC, perks: ["peek", "shield", "tail"] },
  { type: "roundStarted", visibility: PUBLIC, round: 1 },
  split("p1", 1, "security", 0, 0),
  split("p2", 1, "vault", 6, 3),
  split("p3", 1, "office", 4, 0),
  split("p4", 1, "vault", 6, 2),
  { type: "abilityResolved", visibility: privateTo("p3"), player: "p3", round: 1, ability: { kind: "hide", room: "vault", bulbs: 3 } },
  { type: "roomWatched", visibility: privateTo("p1"), player: "p1", round: 1, source: "security", room: "vault", seen: ["p2", "p4"], offline: false },
  resolved(1, 48, 16, 5, 11),
  { type: "alibiPosted", visibility: PUBLIC, player: "p2", round: 1, room: "lobby" },
  { type: "alibiPosted", visibility: PUBLIC, player: "p3", round: 1, room: "office" },
  { type: "roundStarted", visibility: PUBLIC, round: 2 },
  { type: "abilityResolved", visibility: privateTo("p2"), player: "p2", round: 2, ability: { kind: "ring", room: "office" } },
  { type: "abilityResolved", visibility: privateTo("p4"), player: "p4", round: 2, ability: { kind: "detect", round: 1, target: "p2", grabbed: 6 } },
  split("p1", 2, "office", 4, 1),
  split("p2", 2, "vault", 6, 4),
  split("p3", 2, "lobby", 2, 0),
  split("p4", 2, "office", 4, 0),
  resolved(2, 32, 16, 5, 22),
  { type: "perkBought", visibility: privateTo("p1"), player: "p1", perk: "peek", cost: 1 },
  { type: "perkUsed", visibility: privateTo("p1"), player: "p1", round: 2, perk: { kind: "peek", target: "p2", role: "mole" } },
  { type: "meetingOpened", visibility: PUBLIC, meetingId: "m1", kind: "regular" },
  { type: "roleClaimed", visibility: PUBLIC, player: "p2", role: "lookout", stretch: 1 },
  { type: "meetingClosed", visibility: PUBLIC, meetingId: "m1", tally: { skip: 1, targets: { p3: 2 } }, ballots: null, result: { kind: "shakedown", target: "p3" } },
  { type: "shakedownResolved", visibility: PUBLIC, meetingId: "m1", target: "p3", stashRevealed: 0, taken: 0, clean: true },
  { type: "roundStarted", visibility: PUBLIC, round: 3 },
  { type: "eventFlipped", visibility: PUBLIC, round: 3, card: "shiftChange", room: null },
  split("p1", 3, "rooftop", 0, 0),
  split("p2", 3, "depositBoxes", 5, 5),
  split("p3", 3, "vault", 6, 5),
  split("p4", 3, "lobby", 2, 0),
  resolved(3, 19, 13, 10, 25),
];

const rank = (player: string, role: string, stash: number): RankEntry => ({ player, role, stash });

type Ending = "success" | "bust" | "theft";
const BEN_TOP = [rank("p2", "mole", 12), rank("p3", "hacker", 5), rank("p4", "detective", 2), rank("p1", "locksmith", 1)];
const OUTCOMES: Record<Ending, Outcome> = {
  success: { result: "success", ranking: BEN_TOP, winners: ["p2"], getaway: 1 },
  // design §5.5: a bust in round 3; only Ana was on the Rooftop.
  bust: { result: "failed", reason: "bust", escapees: ["p1"], ranking: BEN_TOP, winners: ["p1"] },
  // Here Ben hands rounds 2 and 3 in and Cy pockets round 3's grab, so the Hacker (no ★) leads and nobody wins.
  theft: { result: "failed", reason: "theft", ranking: [rank("p3", "hacker", 6), rank("p2", "mole", 3), rank("p4", "detective", 2), rank("p1", "locksmith", 1)], winners: [], getaway: 1 },
};
const logFor = (ending: Ending): GameEvent[] =>
  ending !== "theft"
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

export function RevealSection() {
  const [ending, setEnding] = useState<Ending>("success");
  const [long, setLong] = useState(false);
  const ctx = useMemo(() => ctxFor(long ? LONG_NAMES : NAMES), [long]);
  const summary = useMemo(() => revealSummary(logFor(ending), OUTCOMES[ending]), [ending]);
  return (
    <Section id="reveal" title="End-of-game reveal" note="M2-11 · role envelopes, who won and why, round timeline with every hidden action">
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
      <Reveal key={ending} summary={summary} ctx={ctx} looks={looks} />
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
