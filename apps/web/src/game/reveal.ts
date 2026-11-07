// Plain lines for the end-of-game reveal (design §13): what earned each token,
// what each ★ role also wins on, who won and why, and the worked-out timeline
// items. Pure; the switches are exhaustive. extension.md "Winning and losing",
// "Tokens and the perk shop", "Police activity", "Situations"
import type { FailureReason, TokenTrigger } from "@skimjob/content";
import type { RevealEnding, RevealItem, RevealRound, RevealSummary } from "@skimjob/engine";
import { describeEvent, roleName, roomName, type DescribeContext } from "./describeEvent";

/** What earned a token, after "for". */
export function triggerText(t: TokenTrigger): string {
  switch (t) {
    case "checkpointMade":
      return "a checkpoint made";
    case "watchedShakenDirty":
      return "catching someone they watched";
    case "auditedShakenDirty":
      return "catching someone in a room they audited";
    case "checkedShakenDirty":
      return "catching someone they checked";
    case "wonDirtyShakedown":
      return "voting for a dirty shakedown";
    case "blessedShakenClean":
      return "a blessed player shaken down clean";
    case "loopHidPocketer":
      return "a loop that hid a pocketer";
  }
}

const FAILURE: Record<FailureReason, string> = { bust: "the crew is busted", target: "the target is missed" };

/** "★ Also wins if the target is missed", or "" for a role that wins only a success. */
export function winsOnText(winsOn: readonly FailureReason[]): string {
  return winsOn.length === 0 ? "" : `★ Also wins if ${winsOn.map((r) => FAILURE[r]).join(" or ")}`;
}

const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Who won, and why. */
export function whyText(ending: RevealEnding, ctx: DescribeContext): string {
  const who = (p: string) => (p === ctx.me ? "you" : ctx.name(p));
  const top = list(ending.topGroup.map(who));
  // design §5.5, §20.2: "On a bust, only the Rooftop gets away", whatever the role.
  if (ending.reason === "bust") {
    return ending.winners.length > 0
      ? `Busted: on a bust, only the Rooftop gets away. The biggest stash up there wins: ${list(ending.winners.map(who))}.`
      : "Busted: on a bust, only the Rooftop gets away, and nobody was on the Rooftop, so nobody wins: the ranking is a loss.";
  }
  const reason = "the crew missed the Haul target";
  switch (ending.why) {
    case "success":
      return `Job done, so the top of the ranking wins: ${top}.`;
    case "failedTopWins":
      return `The heist failed (${reason}). A ★ role wins this ending from the top of the ranking: ${list(ending.winners.map(who))}.`;
    case "failedNobody":
      return `The heist failed (${reason}). Nobody at the top (${top}) holds a role that wins this ending, so nobody wins: the ranking is a loss.`;
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
    case "cameraOffline": {
      const feed = item.source === "security" ? "camera" : item.source === "lookout" ? "lookout" : "tail";
      const whose = you(item.watcher) ? "your" : `${ctx.name(item.watcher)}'s`;
      return cap(`${whose} ${feed} on the ${roomName(item.room)} went offline: ${list(item.hackers.map(who))} looped it.`);
    }
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
