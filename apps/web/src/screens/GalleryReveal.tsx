// /dev/gallery section for M2-11: the end-of-game reveal on a small hand-made
// game (no server), summarised by the engine's own `revealSummary`, with each
// ending: a success, a Heat failure a ★ role wins, and a missed target nobody wins.
// The names can switch to 24-character ones (the cap; "W" is the widest glyph
// and has no break points) to check nothing pushes past a phone's edge.
import { useMemo, useState, type ReactNode } from "react";
import { ROLES } from "@skimjob/content";
import { PUBLIC, REVEAL, privateTo, revealSummary, type GameEvent, type Outcome, type RankEntry } from "@skimjob/engine";
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
});
const resolved = (round: number, bank: number, haulDelta: number, haul: number, heatDelta: number, heat: number): GameEvent => ({
  type: "roundResolved",
  visibility: PUBLIC,
  round,
  bank,
  haulDelta,
  haul,
  heatDelta,
  heat,
  heatParts: { base: heatDelta, rooms: {} },
});

/** Ana (Rookie, you), Ben (Mole), Cy (Hacker), Dot (Detective): three rounds and a meeting. */
const LOG: GameEvent[] = [
  { type: "roleDealt", visibility: privateTo("p1"), player: "p1", role: "rookie" },
  { type: "roleDealt", visibility: privateTo("p2"), player: "p2", role: "mole" },
  { type: "roleDealt", visibility: privateTo("p3"), player: "p3", role: "hacker" },
  { type: "roleDealt", visibility: privateTo("p4"), player: "p4", role: "detective" },
  { type: "shopDealt", visibility: PUBLIC, perks: ["peek", "shield", "tail"] },
  { type: "roundStarted", visibility: PUBLIC, round: 1, act: 1 },
  { type: "abilityResolved", visibility: privateTo("p3"), player: "p3", round: 1, ability: { kind: "loopCameras", room: "vault" } },
  split("p1", 1, "security", 0, 0),
  split("p2", 1, "vault", 6, 3),
  split("p3", 1, "office", 4, 0),
  split("p4", 1, "vault", 6, 2),
  { type: "roomWatched", visibility: privateTo("p1"), player: "p1", round: 1, source: "security", room: "vault", seen: [], offline: true },
  resolved(1, 48, 11, 11, 18, 38),
  { type: "tokenEarned", visibility: privateTo("p3"), player: "p3", trigger: "loopHidPocketer" },
  { type: "alibiPosted", visibility: PUBLIC, player: "p2", round: 1, room: "lobby" },
  { type: "alibiPosted", visibility: PUBLIC, player: "p3", round: 1, room: "office" },
  { type: "roundStarted", visibility: PUBLIC, round: 2, act: 1 },
  { type: "abilityResolved", visibility: privateTo("p2"), player: "p2", round: 2, ability: { kind: "tipOff" } },
  { type: "policeActivity", visibility: PUBLIC, round: 2, heatAdded: 6, heat: 44 },
  { type: "policeCause", visibility: REVEAL, round: 2, cause: "patrol", mole: null },
  { type: "policeActivity", visibility: PUBLIC, round: 2, heatAdded: 6, heat: 50 },
  { type: "policeCause", visibility: REVEAL, round: 2, cause: "tipOff", mole: "p2" },
  { type: "tipOffLanded", visibility: privateTo("p2"), player: "p2", round: 2 },
  { type: "tokenEarned", visibility: privateTo("p2"), player: "p2", trigger: "tipOffLanded" },
  { type: "abilityResolved", visibility: privateTo("p4"), player: "p4", round: 2, ability: { kind: "checkStash", target: "p2", threshold: 6, dirty: true } },
  split("p1", 2, "office", 4, 1),
  split("p2", 2, "vault", 6, 4),
  split("p3", 2, "lobby", 2, 0),
  split("p4", 2, "office", 4, 0),
  resolved(2, 32, 11, 22, 14, 64),
  { type: "perkBought", visibility: privateTo("p1"), player: "p1", perk: "peek", cost: 1 },
  { type: "perkUsed", visibility: privateTo("p1"), player: "p1", round: 2, perk: { kind: "peek", target: "p2", role: "mole" } },
  { type: "meetingOpened", visibility: PUBLIC, meetingId: "m1", kind: "regular", act: 1 },
  { type: "roleClaimed", visibility: PUBLIC, player: "p2", role: "lookout", act: 1 },
  { type: "meetingClosed", visibility: PUBLIC, meetingId: "m1", tally: { skip: 1, targets: { p3: 2 } }, ballots: null, result: { kind: "shakedown", target: "p3" } },
  { type: "shakedownResolved", visibility: PUBLIC, meetingId: "m1", target: "p3", stashRevealed: 0, taken: 0, clean: true, compensation: 3 },
  { type: "checkpointChecked", visibility: PUBLIC, act: 1, target: 20, haul: 19, met: false, heatPenalty: 10 },
  { type: "roundStarted", visibility: PUBLIC, round: 3, act: 2 },
  { type: "eventFlipped", visibility: PUBLIC, round: 3, card: "shiftChange", room: null },
  split("p1", 3, "security", 0, 0),
  split("p2", 3, "depositBoxes", 5, 5),
  split("p3", 3, "vault", 6, 2),
  split("p4", 3, "lobby", 2, 0),
  resolved(3, 19, 6, 25, 12, 86),
];

const rank = (player: string, role: string, score: number, totalHandedIn: number): RankEntry => ({
  player,
  role,
  score,
  stash: score,
  timesShakenDown: player === "p3" ? 1 : 0,
  totalHandedIn,
});

type Ending = "success" | "heat" | "target";
const BEN_TOP = [rank("p2", "mole", 12, 5), rank("p3", "hacker", 5, 10), rank("p4", "detective", 2, 10), rank("p1", "rookie", 1, 3)];
const OUTCOMES: Record<Ending, Outcome> = {
  success: { result: "success", ranking: BEN_TOP, winners: ["p2"] },
  heat: { result: "failed", reason: "heat", ranking: BEN_TOP, winners: ["p2"] },
  // Here Ben hands round 3 in and Cy pockets it all, so the Hacker (no ★) leads and nobody wins.
  target: { result: "failed", reason: "target", ranking: [rank("p3", "hacker", 9, 6), rank("p2", "mole", 7, 10), rank("p4", "detective", 2, 10), rank("p1", "rookie", 1, 3)], winners: [] },
};
const logFor = (ending: Ending): GameEvent[] =>
  ending !== "target"
    ? LOG
    : LOG.map((e) => (e.type === "coinsGrabbed" && e.round === 3 && e.player === "p2" ? split("p2", 3, "depositBoxes", 5, 0) : e.type === "coinsGrabbed" && e.round === 3 && e.player === "p3" ? split("p3", 3, "vault", 6, 6) : e));

export function RevealSection() {
  const [ending, setEnding] = useState<Ending>("success");
  const [long, setLong] = useState(false);
  const ctx = useMemo(() => ctxFor(long ? LONG_NAMES : NAMES), [long]);
  const summary = useMemo(() => revealSummary(logFor(ending), OUTCOMES[ending], { roles: ROLES }), [ending]);
  return (
    <Section id="reveal" title="End-of-game reveal" note="M2-11 · role envelopes, who won and why, round timeline with every hidden action">
      <Segmented
        label="Ending"
        seed="g-reveal-ending"
        value={ending}
        onChange={setEnding}
        options={[
          { value: "success", label: "Job done" },
          { value: "heat", label: "Raided (★ wins)" },
          { value: "target", label: "Missed (nobody)" },
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
