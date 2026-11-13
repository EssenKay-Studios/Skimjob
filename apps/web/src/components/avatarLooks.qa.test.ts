// QA (PR #296, issue #261): a player's seat, read from the engine id, fixes the blob colour and the crook look
// in the game, case board and reveal, even when a leaver left a gap in the seats. design §15; ui-style "Player avatars"
import { viewFor, type GameConfig } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/deal.testkit";
import { seatLooks } from "../game/board";
import { crewColour, seatOfPlayer } from "./avatarLooks";

const config = (seats: readonly number[]): GameConfig => ({
  seed: "seat-colours-qa",
  players: seats.map((s) => ({ id: `p${s + 1}`, name: `S${s}`, isBot: s > 0 })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
});

describe("QA: seat colours in a game", () => {
  it("12 players: p1..p12 get 12 different blob colours and 12 different crook looks", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
    expect(new Set(ids.map((id) => crewColour(seatOfPlayer(id)!))).size).toBe(12);
    const looks = seatLooks(viewFor(createGame(config(ids.map((_, i) => i))), "p5"));
    expect(new Set([...looks.values()].map((l) => l.look)).size).toBe(12);
  });

  it("a gap in the seats (p1, p3, p4) keeps each player's seat colour and look, not their list position", () => {
    const view = viewFor(createGame(config([0, 2, 3])), "p3");
    expect([...seatLooks(view).entries()].map(([id, l]) => [id, l.look])).toEqual([["p1", 0], ["p3", 2], ["p4", 3]]);
    expect(crewColour(seatOfPlayer("p3")!)).toBe("var(--seat-3)");
  });

  it("ids that aren't plain p<n> fall back to no seat (name hash)", () => {
    for (const id of ["p", "P1", "p1x", "xp1", " p1"]) expect(seatOfPlayer(id)).toBeUndefined();
  });
});
