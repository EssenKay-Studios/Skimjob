// Plain lines for the end-of-game reveal (design §15.5): what earned each token,
// which roles also win a heist sunk by theft (★), who won and why, and the
// worked-out timeline items. Pure; the switches are exhaustive. design §8;
// extension.md "Tokens and the perk shop" (until S3a.7)
import { BUST_ROLE_TEXT, type RoleId, type TokenTrigger } from "@skimjob/content";
import { roleHandler, type RevealEnding, type RevealItem, type RevealRound, type RevealSummary } from "@skimjob/engine";
import { describeEvent, roleName, type DescribeContext } from "./describeEvent";

/** What earned a token, after "for". */
export function triggerText(t: TokenTrigger): string {
  switch (t) {
    case "watchedShakenDirty":
      return "catching someone they watched";
    case "auditedShakenDirty":
      return "catching someone in a room they audited";
    case "checkedShakenDirty":
      return "catching someone they looked into";
    case "wonDirtyShakedown":
      return "voting for a dirty shakedown";
  }
}

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
  const reason = "sunk by theft: under two-thirds of the coins taken reached the crew";
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
    case "token":
      return cap(`${who(item.player)} earned a token for ${triggerText(item.trigger)}.`);
    case "claim":
      return item.claimed === item.real
        ? cap(`${who(item.player)} claimed ${roleName(item.claimed)}, and it was true.`)
        : cap(`${who(item.player)} claimed ${roleName(item.claimed)}, but ${you(item.player) ? "were" : "was"} really the ${roleName(item.real)}.`);
  }
}

/** Whether an item is one the game hid until now (to mark it in the timeline). */
export function isHidden(item: RevealItem): boolean {
  if (item.kind !== "event") return item.kind !== "claim";
  return item.event.visibility.kind !== "public";
}

/** A round's label: "Setup" or "Round 3". */
export const roundLabel = (r: Pick<RevealRound, "round">): string => (r.round === 0 ? "Setup" : `Round ${r.round}`);

/** One player's stash after each round of the timeline (safe included). */
export const stashTrend = (summary: RevealSummary, player: string): number[] => summary.rounds.map((r) => r.stashes[player] ?? 0);
