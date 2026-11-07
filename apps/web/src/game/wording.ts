// Player-facing names for the meetings (extension.md: "No acts to learn. The
// crew meets every 3 rounds"). The engine keeps acts internally; players only
// ever see meetings and "between meetings".
import { ROUNDS_PER_ACT } from "@skimjob/content";

/** "meeting 1", "meeting 2": the regular meeting that closes stretch `act` (none after the last round, design §6.2). */
export const meetingName = (act: number): string => `meeting ${act}`;
/** "Meeting 1", "Meeting 2". */
export const MeetingName = (act: number): string => `Meeting ${act}`;
/** The last round before that meeting (3, 6, 9). */
export const meetingAfter = (act: number): number => act * ROUNDS_PER_ACT;
