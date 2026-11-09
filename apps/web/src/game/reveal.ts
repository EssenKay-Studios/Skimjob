// Plain lines for the end-of-game reveal (design §15.5): which roles also win a
// heist sunk by theft (★), who won and why, and the worked-out timeline items.
// Pure; the switches are exhaustive. design §8
import { BANK_JOB, BUST_ROLE_TEXT, lineWords, type RoleId } from "@skimjob/content";
import { roleHandler, type RevealEnding, type RevealItem, type RevealMove, type RevealRound, type RevealSummary } from "@skimjob/engine";
import { describeEvent, roleName, roomName, type DescribeContext } from "./describeEvent";

/** "★ Also wins if the heist is sunk by theft" for the Mole and the Fixer (their handlers, design §8.4), else "". */
export function starText(role: RoleId): string {
  return roleHandler(role).winsSunk ? "★ Also wins if the heist is sunk by theft" : "";
}

const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Who won, and why. */
export function whyText(ending: RevealEnding, ctx: DescribeContext): string {
  const who = (p: string) => (p === ctx.me ? "you" : ctx.name(p));
  const top = list(ending.topGroup.map(who));
  // design §5.5, §20.2: "On a bust, only the Rooftop gets away", whatever the role.
  if (ending.reason === "bust") {
    return ending.winners.length > 0
      ? `Busted. ${BUST_ROLE_TEXT} The biggest stash up there wins: ${list(ending.winners.map(who))}.`
      : `Busted. ${BUST_ROLE_TEXT} Nobody was on the Rooftop, so nobody wins: the ranking is a loss.`;
  }
  const reason = `sunk by theft: under ${lineWords(BANK_JOB.honestyLine)} of the coins taken reached the crew`;
  switch (ending.why) {
    case "success":
      return `Job done, so the top of the ranking wins: ${top}.`;
    case "failedTopWins":
      return `The heist failed (${reason}). A Mole or Fixer with the biggest stash of all wins it: ${list(ending.winners.map(who))}.`;
    case "failedNobody":
      return `The heist failed (${reason}). No Mole or Fixer has the biggest stash (${top}), so nobody wins: the ranking is a loss.`;
  }
}

/** One timeline line. */
export function itemText(item: RevealItem, ctx: DescribeContext): string {
  const you = (p: string) => p === ctx.me;
  const who = (p: string) => (you(p) ? "you" : ctx.name(p));
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  switch (item.kind) {
    case "event":
      return describeEvent(item.event, ctx);
    case "claim":
      return item.claimed === item.real
        ? cap(`${who(item.player)} claimed ${roleName(item.claimed)}, and it was true.`)
        : cap(`${who(item.player)} claimed ${roleName(item.claimed)}, but ${you(item.player) ? "were" : "was"} really the ${roleName(item.real)}.`);
  }
}

/** Whether an item is one the game hid until now (to mark it in the timeline). */
export function isHidden(item: RevealItem): boolean {
  if (item.kind !== "event") return false;
  return item.event.visibility.kind !== "public";
}

/** A round's label: "Setup" or "Round 3". */
export const roundLabel = (r: Pick<RevealRound, "round">): string => (r.round === 0 ? "Setup" : `Round ${r.round}`);

/** One player's stash after each round of the timeline (safe included). */
export const stashTrend = (summary: RevealSummary, player: string): number[] => summary.rounds.map((r) => r.stashes[player] ?? 0);

type Ending = ({ readonly result: "success" } | { readonly result: "failed"; readonly reason: "bust" | "theft" }) & { readonly winners: readonly string[] };

/**
 * How the game ended, in one line, and why each winner won. A failed heist's
 * ranking is a loss only when nobody won it (design §8.3, §8.4, §8.6).
 */
export function endingText(outcome: Ending): { title: string; badge: string; loss: boolean } {
  if (outcome.result === "success") return { title: "Job done: honest enough, and no bust", badge: "Biggest stash", loss: false };
  const loss = outcome.winners.length === 0;
  return outcome.reason === "bust"
    ? { title: `Busted. ${BUST_ROLE_TEXT.replace(/\.$/, "")}`, badge: "Wins over the Rooftop", loss } // design §20.2
    : { title: "Sunk by theft: too many coins went missing", badge: "Wins a heist sunk by theft", loss };
}

/** Plan against move (design §10, §15.5): the plan spot the player held as the round resolved, and whether they went elsewhere. */
export const planOf = (m: RevealMove): { spot: string; broken: boolean } =>
  m.planned === null ? { spot: "no plan spot", broken: false } : { spot: roomName(m.planned), broken: m.planned !== m.room };

/** design §15.4 "Changed story", told in the reveal: the plan spot and the alibi posted later differ. Null when either is missing or they agree. */
export const changedStory = (m: RevealMove): string | null =>
  m.planned !== null && m.alibi !== null && m.planned !== m.alibi ? `Changed story: planned ${roomName(m.planned)}, later said ${roomName(m.alibi)}.` : null;

/** design §3.3: a missed move into a taped-off Lobby has no move at all, so the reveal says so. */
export const satOutText = (player: string, ctx: DescribeContext): string =>
  `${player === ctx.me ? "You" : ctx.name(player)} sat the round out: the Lobby was taped off.`;
