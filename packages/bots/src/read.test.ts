// Bots read the game's rules from their own view, content overrides included. design §17.3, §17.4
import { describe, expect, it } from "vitest";
import { BANK_JOB } from "@skimjob/content";
import { createGame, viewFor, type GameState } from "@skimjob/engine";
import { jobOf, roleOf } from "./read";
import { config } from "./testkit";

function gameWith(contentOverrides: unknown, want: (s: GameState) => boolean = () => true): GameState {
  for (let i = 0; ; i++) {
    const s = createGame({ ...config(4, `read-${i}`), contentOverrides: contentOverrides as never });
    if (want(s)) return s;
  }
}

describe("jobOf / roleOf with content overrides (design §17.4)", () => {
  it("no overrides: the shipped job", () => {
    expect(jobOf(viewFor(createGame(config(4, "x")), "ana"))).toBe(BANK_JOB);
  });

  it("uses the overridden numbers from the public gameCreated", () => {
    const s = gameWith({ rooms: { vault: { loot: 9 } }, heat: { perRound: 7 }, roles: { lookout: { extraRooms: 2 } } }, (g) => g.players.ana?.role === "lookout");
    const view = viewFor(s, "ana");
    expect(jobOf(view).rooms.vault?.loot).toBe(9);
    expect(jobOf(view).heat.perRound).toBe(7);
    expect(roleOf(view).power).toEqual({ kind: "lookout", extraRooms: 2 });
  });
});
