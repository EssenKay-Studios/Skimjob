// Player-facing names for the meetings (extension.md: "No acts to learn. The
// crew meets every 3 rounds"). The engine keeps acts internally; players only
// ever see meetings and "between meetings".
import { ROUNDS_PER_ACT } from "@skimjob/content";

/** "meeting 1", "meeting 2", "the final meeting": the regular meeting that closes stretch `act`. */
export const meetingName = (act: number): string => (act >= 3 ? "the final meeting" : `meeting ${act}`);
/** "Meeting 1", "Meeting 2", "Final meeting". */
export const MeetingName = (act: number): string => (act >= 3 ? "Final meeting" : `Meeting ${act}`);
/** The last round before that meeting (3, 6, 9). */
export const meetingAfter = (act: number): number => act * ROUNDS_PER_ACT;
/** The Haul target checked at that meeting: "Meeting 1 target", "Final target". */
export const targetName = (act: number): string => (act >= 3 ? "Final target" : `Meeting ${act} target`);
