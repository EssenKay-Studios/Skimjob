// The plan board's wire frames on the client. design §10 (S3b.4)
import { describe, expect, it } from "vitest";
import type { PlanEditRecord, PlayerView } from "@skimjob/engine";
import { agreedText, asPlanBoard, beforeDeadline, editText, historyOrder, lastPlan, pledgeAims, pledgeRoles } from "./plan";

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

const name = (p: string) => ({ p1: "Ana", p2: "Ben" })[p] ?? p;
const room = (r: string) => ({ vault: "Vault", office: "Office" })[r] ?? r;
const role = (r: string) => ({ hacker: "Hacker", detective: "Detective" })[r] ?? r;
const edit = (e: Partial<PlanEditRecord>): PlanEditRecord => ({ actor: "p2", kind: "place", subject: "p2", value: "vault", target: null, msBeforeDeadline: 120_000, ...e });

describe("the plan panel's words (design §10)", () => {
  it("counts the agreed out of every seat", () => {
    expect(agreedText([{ agreed: true }, { agreed: false }, { agreed: true }], 6)).toBe("2 of 6 agreed");
  });

  it("knows which pledges name a room and which a player, and lists the pledgeable roles", () => {
    expect(pledgeAims("detective")).toBe("player");
    expect(pledgeAims("hacker")).toBe("room");
    expect(pledgeAims("nobody")).toBeUndefined();
    expect(pledgeRoles().every((r) => pledgeAims(r.id) !== undefined)).toBe(true);
    expect(pledgeRoles().map((r) => r.id)).toContain("detective");
  });

  it("says how long before the deadline, never a wall time; no time left on record is a bot", () => {
    expect(beforeDeadline(null)).toBe("bot");
    expect(beforeDeadline(20_000)).toBe("under a minute before the deadline");
    expect(beforeDeadline(2 * 60_000)).toBe("2 min before the deadline");
    expect(beforeDeadline(95 * 60_000)).toBe("1 h 35 min before the deadline");
    expect(beforeDeadline(26 * 3_600_000)).toBe("1 d 2 h before the deadline");
  });

  it("orders the history by time left, most first, with a bot's edit (no time) leading and ties kept in order", () => {
    const a = edit({ msBeforeDeadline: 60_000 });
    const b = edit({ msBeforeDeadline: 5_400_000 });
    const bot = edit({ actor: "p1", msBeforeDeadline: null });
    const c = edit({ msBeforeDeadline: 60_000, kind: "agree", value: "true" });
    expect(historyOrder([a, b, bot, c])).toEqual([bot, b, a, c]);
  });

  it("writes each kind of edit as a sentence", () => {
    expect(editText(edit({}), name, room, role)).toBe("Ben moved themselves to the Vault");
    expect(editText(edit({ actor: "p1", subject: "p2" }), name, room, role)).toBe("Ana moved Ben to the Vault");
    expect(editText(edit({ value: null }), name, room, role)).toBe("Ben took themselves off the board");
    expect(editText(edit({ kind: "room", value: "office" }), name, room, role)).toBe("Ben claimed the Office");
    expect(editText(edit({ kind: "room", value: null }), name, room, role)).toBe("Ben dropped their room claim");
    expect(editText(edit({ kind: "power", value: "hacker", target: "vault" }), name, room, role)).toBe("Ben pledged Hacker → Vault");
    expect(editText(edit({ kind: "power", value: "detective", target: "p1" }), name, room, role)).toBe("Ben pledged Detective → Ana");
    expect(editText(edit({ kind: "power", value: null }), name, room, role)).toBe("Ben dropped their pledge");
    expect(editText(edit({ kind: "agree", value: "true" }), name, room, role)).toBe("Ben agreed");
    expect(editText(edit({ kind: "agree", value: "false" }), name, room, role)).toBe("Ben took back their agreement");
  });

  it("finds the newest plan snapshot in the ledger, and none when nobody used the board", () => {
    const said = (round: number) => ({ event: { type: "said", statement: { kind: "plan", round, plan: { entries: [], history: [] } } } });
    expect(lastPlan({ ledger: [said(1), { event: { type: "said", statement: { kind: "alibi" } } }, said(3)] } as unknown as PlayerView)?.round).toBe(3);
    expect(lastPlan({ ledger: [] } as unknown as PlayerView)).toBeNull();
  });
});
