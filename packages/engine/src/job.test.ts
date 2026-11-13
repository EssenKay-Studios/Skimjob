// Job helpers: rooms by crew size and rings.
// design §3.1
import { describe, expect, it } from "vitest";
import { BANK_JOB } from "@skimjob/content";
import { jobById, ringsOf, roomDef, roomsInPlay } from "./job";

const bank = BANK_JOB;

describe("jobById", () => {
  it("finds the bank and rejects unknown or inherited ids", () => {
    expect(jobById("bank")).toBe(BANK_JOB);
    for (const id of ["museum", "toString", "__proto__", ""]) expect(() => jobById(id)).toThrow(/unknown job/);
  });
});

describe("rooms in play — design §3.1", () => {
  it("5 rooms at 3–4, 7 at 5–8, 8 at 9–12", () => {
    for (let n = 3; n <= 12; n++) expect(roomsInPlay(bank, n)).toHaveLength(n <= 4 ? 5 : n <= 8 ? 7 : 8);
  });

  it("roomDef rejects rooms the job doesn't have", () => {
    expect(roomDef(bank, "vault").coins).toBe(3);
    expect(() => roomDef(bank, "casinoFloor")).toThrow(/no room/);
    expect(() => roomDef(bank, "constructor")).toThrow(/no room/);
  });
});

describe("rings — design §3.1, §5.2", () => {
  it("every coin rings once, except in the Lobby; the Locksmith's rings are 0", () => {
    const ring = (room: string, coins: number) => ringsOf(roomDef(bank, room), coins);
    // The Lobby is silent; every coin elsewhere rings once.
    expect(ring("lobby", 1)).toBe(0);
    expect([1, 2].map((n) => ring("office", n))).toEqual([1, 2]);
    for (const room of ["depositBoxes", "managersOffice", "serverRoom"]) expect(ring(room, 2), room).toBe(2);
    expect([1, 2, 3].map((n) => ring("vault", n))).toEqual([1, 2, 3]);
    // Nothing grabbed, nothing rung (Security, the Rooftop, a cut grab).
    for (const room of ["security", "rooftop", "vault", "office"]) expect(ring(room, 0), room).toBe(0);
    // The Locksmith's coins each ring one fewer (so none); Soft shoes ring nothing.
    for (const room of ["office", "vault", "depositBoxes", "managersOffice", "serverRoom"]) expect(ringsOf(roomDef(bank, room), 3, 1), room).toBe(0);
  });
});
