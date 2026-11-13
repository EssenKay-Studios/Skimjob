// The snapshot card's data, from real engine views. design §10
import { handleCommand, PUBLIC, viewFor, type GameConfig, type GameState, type PlayerCommand, type PlayerView, type SystemCommand } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { createGame } from "./deal.testkit";
import { myMarks, snapshotOf, snapshotRounds } from "./snapshot";

const config: GameConfig = {
  seed: "snapshot-test",
  players: ["Ana", "Ben", "Cy", "Dee"].map((name, i) => ({ id: `p${i + 1}`, name, isBot: false })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
};
function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}

/**
 * Round 1: Ana grabs 2 in the Office (1 pocketed) but says the Lobby; Ben and Cy take 3 each
 * in the Vault (6 rings: raided), Ben says so and Cy says nothing; Dee misses the deadline
 * (the default room, the Lobby) and says nothing.
 */
function played(): GameState {
  return run(
    createGame(config),
    { type: "submitMove", player: "p1", move: { room: "office", duffel: 1, pocket: 1 } },
    { type: "submitMove", player: "p2", move: { room: "vault", duffel: 3, pocket: 0 } },
    { type: "submitMove", player: "p3", move: { room: "vault", duffel: 3, pocket: 0 } },
    { type: "advance", deadline: { kind: "round", round: 1 } },
    { type: "postAlibi", player: "p1", round: 1, room: "lobby" },
    { type: "postAlibi", player: "p2", round: 1, room: "vault" },
  );
}
const closed = (s: GameState) => run(s, { type: "advance", deadline: { kind: "alibi", round: 1 } });
const roomOf = (v: PlayerView, id: string) => snapshotOf(v, 1)!.floors.flat().find((r) => r.id === id)!;

describe("snapshot card (design §10)", () => {
  it("exists for a round only once its alibi window has closed", () => {
    const open = played();
    expect(snapshotOf(viewFor(open, "p1"), 1)).toBeNull();
    expect(snapshotRounds(viewFor(open, "p1"))).toEqual([]);
    const s = closed(open);
    expect(snapshotRounds(viewFor(s, "p1"))).toEqual([1]);
    expect(snapshotOf(viewFor(s, "p1"), 1)?.round).toBe(1);
    expect(snapshotOf(viewFor(s, "p1"), 2)).toBeNull();
  });

  it("lays the rooms in play out by floor, top down", () => {
    const snap = snapshotOf(viewFor(closed(played()), "p1"), 1)!;
    expect(snap.floors.map((f) => f.map((r) => r.id))).toEqual([["rooftop"], ["security", "office"], ["lobby"], ["vault"]]);
  });

  it("draws an alibi as said (dashed) and a missing one as a fact in the real room (solid)", () => {
    const v = viewFor(closed(played()), "p4");
    expect(roomOf(v, "lobby").crooks).toEqual([
      { player: "p1", kind: "says" },
      { player: "p4", kind: "fact" },
    ]);
    expect(roomOf(v, "vault").crooks).toEqual([
      { player: "p2", kind: "says" },
      { player: "p3", kind: "fact" },
    ]);
  });

  it("marks a raid with the coins seized, and the bell as the round rang it", () => {
    const v = viewFor(closed(played()), "p1");
    expect(roomOf(v, "vault")).toMatchObject({ raided: 6, bell: 5 });
    expect(roomOf(v, "office")).toMatchObject({ raided: null, bell: 2 });
  });

  it("glows a room that rang with nobody saying or shown there, never a silent or occupied one", () => {
    const v = viewFor(closed(played()), "p1");
    expect(roomOf(v, "office")).toMatchObject({ quiet: true, crooks: [] });
    expect(roomOf(v, "vault").quiet).toBe(false);
    expect(roomOf(v, "security").quiet).toBe(false);
  });

  it("tags the round's event card and puts the missing coins on the duffel line", () => {
    const v = viewFor(closed(played()), "p1");
    expect(snapshotOf(v, 1)).toMatchObject({ card: null, missing: 1 });
    const flipped = { ...v, ledger: [...v.ledger, { seq: 9999, event: { type: "eventFlipped" as const, visibility: PUBLIC, round: 1, card: "shiftChange", room: null } }] };
    expect(snapshotOf(flipped, 1)?.card).toBe("shiftChange");
  });

  it("reads only the public ledger: the same card for every seat, with or without a case file", () => {
    const s = closed(played());
    const card = snapshotOf(viewFor(s, "p1"), 1);
    for (const p of ["p2", "p3", "p4"]) expect(snapshotOf(viewFor(s, p), 1)).toEqual(card);
    const v = viewFor(s, "p2");
    expect(snapshotOf({ ...v, caseFile: [] }, 1)).toEqual(card);
  });

  it("keeps your trust marks to yourself (design §10)", () => {
    const s = run(closed(played()), { type: "markAlibi", player: "p1", round: 1, target: "p2", mark: "liar" });
    expect([...myMarks(viewFor(s, "p1"))]).toEqual([["1/p2", "liar"]]);
    expect(myMarks(viewFor(s, "p2")).size).toBe(0);
  });
});
