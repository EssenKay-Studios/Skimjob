import { describe, expect, it } from "vitest";
// Relative import: apps/web doesn't depend on @skimjob/content yet (M2-6 adds it).
import { BANK_JOB } from "../../../../packages/content/src/jobs";
import { BANK_ROOM_NAMES, BANK_ROOMS, bankLayout, roomBox, roomBoxPercent, roomSlots, type BankLayoutMode } from "./bankLayout";
import { ROOMS_WITH_ART } from "./rooms";

const tiers = BANK_JOB.roomTiers.map((_, i) => BANK_JOB.roomTiers.slice(0, i + 1).flatMap((t) => t.rooms));
const modes: BankLayoutMode[] = ["wide", "stacked"];

describe("bank cutaway layout (m2-plan M2-9, design §6, §18)", () => {
  it("every room in BANK_JOB has art, a label and a place in the building", () => {
    const ids = Object.keys(BANK_JOB.rooms).sort();
    expect([...BANK_ROOMS].sort()).toEqual(ids);
    expect([...ROOMS_WITH_ART].sort()).toEqual(ids);
    for (const id of ids) expect(BANK_ROOM_NAMES[id as keyof typeof BANK_ROOM_NAMES]).toBe(BANK_JOB.rooms[id]!.name);
  });

  for (const mode of modes)
    for (const rooms of tiers)
      it(`${mode}, ${rooms.length} rooms: each room once, inside the drawing, no overlaps`, () => {
        const lay = bankLayout(rooms, mode);
        expect(lay.rooms.map((r) => r.id).sort()).toEqual([...rooms].sort());
        for (const r of lay.rooms) {
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w).toBeLessThanOrEqual(lay.width);
          expect(r.y + r.h).toBeLessThanOrEqual(lay.height);
          // Wide enough for a label and a couple of crooks.
          expect(r.w).toBeGreaterThanOrEqual(150);
        }
        for (const a of lay.rooms)
          for (const b of lay.rooms) {
            if (a === b) continue;
            const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
            expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
          }
      });

  it("keeps the floors in order: rooftop on top, vault below the street", () => {
    const lay = bankLayout(tiers.at(-1)!, "wide");
    const box = (id: string) => roomBox(lay, id)!;
    expect(box("rooftop").y).toBeLessThan(box("office").y);
    expect(box("office").y).toBeLessThan(box("lobby").y);
    expect(box("lobby").y + box("lobby").h).toBeLessThanOrEqual(lay.streetY);
    expect(box("vault").y).toBeGreaterThan(lay.streetY);
  });

  it("ignores unknown ids and gives percentages for HTML overlays", () => {
    const lay = bankLayout(["vault", "lobby", "rooftop", "nope"], "stacked");
    expect(lay.rooms.map((r) => r.id)).toEqual(["rooftop", "lobby", "vault"]);
    expect(roomBox(lay, "office")).toBeUndefined();
    const pc = roomBoxPercent(lay, "vault")!;
    expect(parseFloat(pc.left)).toBeGreaterThan(0);
    expect(parseFloat(pc.top) + parseFloat(pc.height)).toBeLessThanOrEqual(100);
  });
});

describe("room slots (placing crooks in a room)", () => {
  it("puts nobody in an empty room", () => {
    expect(roomSlots(200, 150, 0)).toEqual([]);
  });

  it("keeps every crook inside the room, even all 12 in a narrow one", () => {
    for (const [w, h] of [
      [166, 136],
      [400, 150],
      [804, 162],
    ] as const)
      for (let n = 1; n <= 12; n++) {
        const slots = roomSlots(w, h, n);
        expect(slots).toHaveLength(n);
        for (const s of slots) {
          expect(s.x).toBeGreaterThan(0);
          expect(s.x).toBeLessThan(w);
          expect(s.y).toBeLessThanOrEqual(h);
          expect(s.y).toBeGreaterThan(h / 2);
        }
      }
  });

  it("a crowded narrow room gets a back row, drawn first", () => {
    const slots = roomSlots(166, 136, 8);
    expect(slots.some((s) => s.back)).toBe(true);
    const firstFront = slots.findIndex((s) => !s.back);
    expect(slots.slice(firstFront).every((s) => !s.back)).toBe(true);
  });
});
