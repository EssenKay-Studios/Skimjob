// Bots read the game's rules from their own view, content overrides included. design §11.3, §19.3
import { describe, expect, it } from "vitest";
import { BANK_JOB } from "@skimjob/content";
import { createGame, viewFor, type GameState } from "@skimjob/engine";
import { copiesOf, couldBeDealt, jobOf, myPower, winsSunk } from "./read";
import { config, game } from "./testkit";

function gameWith(contentOverrides: unknown, want: (s: GameState) => boolean = () => true): GameState {
  for (let i = 0; ; i++) {
    const s = createGame({ ...config(4, `read-${i}`), contentOverrides: contentOverrides as never });
    if (want(s)) return s;
  }
}

describe("jobOf / myPower with content overrides (design §17.4)", () => {
  it("no overrides: the shipped job", () => {
    expect(jobOf(viewFor(createGame({ ...config(4, "x"), contentOverrides: null }), "ana"))).toBe(BANK_JOB);
  });

  it("uses the overridden numbers from the public gameCreated", () => {
    const s = gameWith({ rooms: { vault: { coins: 9 } }, alarm: { bulbs: 7 }, roles: { lookout: { extraRooms: 2 } } }, (g) => g.players.ana?.role === "lookout");
    const view = viewFor(s, "ana");
    expect(jobOf(view).rooms.vault?.coins).toBe(9);
    expect(jobOf(view).alarm.bulbs).toBe(7);
    expect(myPower(view)).toEqual({ kind: "lookout", extraRooms: 2 });
  });
});

describe("what the public setup says about roles — design §11.3, §15.4", () => {
  const withList = (s: GameState, list: "exact" | "possible" | null, roles: string[]) => {
    const v = viewFor(s, "ana");
    return { ...v, roleList: list === null ? null : { list, roles } };
  };

  it("how many can hold a role: its count on the Exact list; else one up to 10 players, two at 11–12", () => {
    const s = game(5);
    expect(copiesOf(withList(s, "exact", ["lookout", "lookout", "mole"]), "lookout")).toBe(2);
    expect(copiesOf(withList(s, "exact", ["lookout", "mole"]), "hacker")).toBe(0);
    expect(copiesOf(withList(s, "possible", []), "hacker")).toBe(1);
    expect(copiesOf(withList(game(10), null, []), "hacker")).toBe(1);
    expect(copiesOf(withList(game(11), null, []), "hacker")).toBe(2);
    expect(copiesOf(withList(game(12), "possible", []), "hacker")).toBe(2);
  });

  it("could a role be dealt: the shown list, else any role in content", () => {
    const s = game(5);
    expect(couldBeDealt(withList(s, "exact", ["mole"]), "mole")).toBe(true);
    expect(couldBeDealt(withList(s, "exact", ["mole"]), "fixer")).toBe(false);
    expect(couldBeDealt(withList(s, null, []), "fixer")).toBe(true);
    expect(couldBeDealt(withList(s, null, []), "muscle")).toBe(false);
  });

  it("only the Mole and the Fixer have their own win rule (design §8.4)", () => {
    expect(["mole", "fixer", "lookout", "priest", "muscle"].map(winsSunk)).toEqual([true, true, false, false, false]);
  });
});
