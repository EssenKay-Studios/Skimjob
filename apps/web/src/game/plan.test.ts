// The plan board's wire frames on the client. design §10 (S3b.4)
import { describe, expect, it } from "vitest";
import { asPlanBoard } from "./plan";

describe("asPlanBoard", () => {
  it("reads a server board, keeping seat order", () => {
    const frame = {
      round: 2,
      entries: [
        { player: "p1", placed: "office", room: "vault", power: { role: "hacker", target: "office" }, agreed: true },
        { player: "p2", placed: null, room: null, power: null, agreed: false },
      ],
    };
    expect(asPlanBoard(frame)).toEqual(frame);
  });

  it("drops what isn't a board, and bad entries, instead of half-rendering them", () => {
    for (const bad of [null, "x", [], {}, { round: "1", entries: [] }, { round: 1 }, { round: Number.NaN, entries: [] }]) expect(asPlanBoard(bad)).toBeNull();
    const board = asPlanBoard({
      round: 1,
      entries: [
        { player: "p1", placed: null, room: 5, power: null, agreed: false },
        { player: "p2", placed: null, room: "vault", power: { role: "hacker" }, agreed: false },
        { player: "p3", placed: null, room: "vault", power: null, agreed: "yes" },
        { player: "p4", placed: null, room: "vault", power: null, agreed: true, extra: "ignored" },
      ],
    });
    expect(board).toEqual({ round: 1, entries: [{ player: "p4", placed: null, room: "vault", power: null, agreed: true }] });
  });
});
