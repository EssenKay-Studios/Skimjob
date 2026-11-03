// /dev/gallery section for M2-11: the end-of-game reveal on a small hand-made
// game (no server), summarised by the engine's own `revealSummary`, with each
// ending: a success, a Heat failure a ★ role wins, and a missed target nobody wins.
import { useMemo, useState, type ReactNode } from "react";
import { EVENTS, ROLES } from "@skimjob/content";
import { PUBLIC, REVEAL, privateTo, revealSummary, type GameEvent, type Outcome, type RankEntry } from "@skimjob/engine";
import { Reveal } from "../components/Reveal";
import { Segmented } from "../components/Segmented";
import { SketchFrame } from "../components/SketchFrame";
import { Underline } from "../components/Underline";

const NAMES: Record<string, string> = { p1: "Ana", p2: "Ben", p3: "Cy", p4: "Bot · Dot" };
const ctx = { me: "p1", name: (p: string) => NAMES[p] ?? p };
const looks = new Map([
  ["p1", { look: 0, bot: false }],
  ["p2", { look: 1, bot: false }],
  ["p3", { look: 2, bot: false }],
  ["p4", { look: 3, bot: true }],
]);

const split = (player: string, round: number, room: string, loot: number, toStash: number): GameEvent => ({
  type: "lootSplit",
  visibility: privateTo(player),
  player,
  round,
  room,
  loot,
  toHaul: loot - toStash,
  toStash,
});
const resolved = (round: number, haulDelta: number, haul: number, heatDelta: number, heat: number): GameEvent => ({
  type: "roundResolved",
  visibility: PUBLIC,
  round,
  haulDelta,
  haul,
  heatDelta,
  heat,
  heatParts: { base: heatDelta, rooms: {}, events: 0 },
});

/** Ana (Rookie, you), Ben (Mole), Cy (Hacker), Dot (Blackmailer): three rounds and a meeting. */
const LOG: GameEvent[] = [
  { type: "roleDealt", visibility: privateTo("p1"), player: "p1", role: "rookie" },
  { type: "roleDealt", visibility: privateTo("p2"), player: "p2", role: "mole" },
  { type: "roleDealt", visibility: privateTo("p3"), player: "p3", role: "hacker" },
  { type: "roleDealt", visibility: privateTo("p4"), player: "p4", role: "blackmailer" },
  { type: "shopDealt", visibility: PUBLIC, perks: ["peek", "shield", "tail"] },
  { type: "roundStarted", visibility: PUBLIC, round: 1, act: 1 },
  { type: "abilityResolved", visibility: privateTo("p3"), player: "p3", round: 1, ability: { kind: "loopCameras", room: "vault" } },
  split("p1", 1, "security", 0, 0),
  split("p2", 1, "vault", 6, 3),
  split("p3", 1, "office", 4, 0),
  split("p4", 1, "vault", 6, 2),
  { type: "roomWatched", visibility: privateTo("p1"), player: "p1", round: 1, source: "security", room: "vault", seen: [], offline: true },
  resolved(1, 11, 11, 18, 38),
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
  { type: "abilityResolved", visibility: privateTo("p4"), player: "p4", round: 2, ability: { kind: "blackmail", target: "p1", role: "rookie", correct: true } },
  { type: "voteCompromised", visibility: privateTo("p1"), player: "p1", round: 2 },
  split("p1", 2, "tellerLine", 4, 1),
  split("p2", 2, "vault", 6, 4),
  split("p3", 2, "lobby", 2, 0),
  split("p4", 2, "office", 4, 0),
  { type: "sightingForged", visibility: REVEAL, forger: "p4", round: 2, target: "p3", room: "vault", shownTo: [] },
  resolved(2, 11, 22, 14, 64),
  { type: "perkBought", visibility: privateTo("p1"), player: "p1", perk: "peek", cost: 1 },
  { type: "perkUsed", visibility: privateTo("p1"), player: "p1", round: 2, perk: { kind: "peek", target: "p2", role: "mole" } },
  { type: "meetingOpened", visibility: PUBLIC, meetingId: "m1", kind: "regular", act: 1 },
  { type: "roleClaimed", visibility: PUBLIC, player: "p2", role: "lookout", act: 1 },
  { type: "meetingClosed", visibility: PUBLIC, meetingId: "m1", tally: { skip: 1, targets: { p3: 2 } }, ballots: null, result: { kind: "shakedown", target: "p3" } },
  { type: "votesStolen", visibility: REVEAL, meetingId: "m1", steals: [{ victim: "p1", blackmailer: "p4", decided: true }] },
  { type: "tokenEarned", visibility: privateTo("p4"), player: "p4", trigger: "stolenVoteDecided" },
  { type: "shakedownResolved", visibility: PUBLIC, meetingId: "m1", target: "p3", stashRevealed: 0, safeRevealed: 0, taken: 0, clean: true, compensation: 3 },
  { type: "checkpointChecked", visibility: PUBLIC, act: 1, target: 20, haul: 19, met: false, heatPenalty: 10 },
  { type: "roundStarted", visibility: PUBLIC, round: 3, act: 2 },
  { type: "eventFlipped", visibility: PUBLIC, round: 3, card: "powerCut", room: null },
  split("p1", 3, "security", 0, 0),
  split("p2", 3, "depositBoxes", 5, 5),
  split("p3", 3, "vault", 6, 2),
  split("p4", 3, "lobby", 2, 0),
  { type: "roomWatched", visibility: privateTo("p1"), player: "p1", round: 3, source: "security", room: "depositBoxes", seen: [], offline: true },
  resolved(3, 6, 25, 12, 86),
];

const rank = (player: string, role: string, score: number, totalHandedIn: number): RankEntry => ({
  player,
  role,
  score,
  stash: score,
  safe: 0,
  timesShakenDown: player === "p3" ? 1 : 0,
  totalHandedIn,
});

type Ending = "success" | "heat" | "target";
const BEN_TOP = [rank("p2", "mole", 12, 5), rank("p3", "hacker", 5, 10), rank("p4", "blackmailer", 2, 10), rank("p1", "rookie", 1, 3)];
const OUTCOMES: Record<Ending, Outcome> = {
  success: { result: "success", ranking: BEN_TOP, winners: ["p2"] },
  heat: { result: "failed", reason: "heat", ranking: BEN_TOP, winners: ["p2"] },
  // Here Ben hands round 3 in and Cy pockets it all, so the Hacker (no ★) leads and nobody wins.
  target: { result: "failed", reason: "target", ranking: [rank("p3", "hacker", 9, 6), rank("p2", "mole", 7, 10), rank("p4", "blackmailer", 2, 10), rank("p1", "rookie", 1, 3)], winners: [] },
};
const logFor = (ending: Ending): GameEvent[] =>
  ending !== "target"
    ? LOG
    : LOG.map((e) => (e.type === "lootSplit" && e.round === 3 && e.player === "p2" ? split("p2", 3, "depositBoxes", 5, 0) : e.type === "lootSplit" && e.round === 3 && e.player === "p3" ? split("p3", 3, "vault", 6, 6) : e));

export function RevealSection() {
  const [ending, setEnding] = useState<Ending>("success");
  const summary = useMemo(() => revealSummary(logFor(ending), OUTCOMES[ending], { roles: ROLES, events: EVENTS }), [ending]);
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
