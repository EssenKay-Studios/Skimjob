// The bots' reading of the bells, the tape and Wanted. design §5
import { describe, expect, it } from "vitest";
import { BANK_JOB, STARTER_ROLES } from "@skimjob/content";
import { createGame, viewFor, type GameConfig, type PlayerView } from "@skimjob/engine";
import { bustDanger, jobThisRound, openRooms, quietGrab, raidRisk } from "./alarm";
import { seats } from "./testkit";

const config: GameConfig = { seed: "alarm", players: seats(3), job: "bank", rolePool: [...STARTER_ROLES], eventsEnabled: false, voteVisibility: "hiddenThenRevealed" };
const view = (patch: Partial<PlayerView> = {}): PlayerView => ({ ...viewFor(createGame(config), "ana"), ...patch });

describe("bot bell reading — design §5", () => {
  it("open rooms leave out taped-off rooms (their bell is off) and a Lockdown room (design §5.3, §13)", () => {
    const v = view({ bells: { vault: 0, office: 1, lobby: 0, rooftop: 0 }, taped: { security: 3 }, card: { round: 1, id: "lockdown", room: "office" } });
    expect(openRooms(v)).toEqual(["vault", "lobby", "rooftop"]);
  });

  it("raid risk is the lit bulbs plus the grab's own rings, ÷ the bell (design §5.2, §5.3)", () => {
    const v = view({ bells: { ...view().bells, vault: 1, office: 3 } });
    expect(raidRisk(v, BANK_JOB, "vault", 3)).toBe(1);
    expect(raidRisk(v, BANK_JOB, "office", 1)).toBe(0.75);
    expect(raidRisk(v, BANK_JOB, "office", 2)).toBe(1);
    expect(raidRisk(v, BANK_JOB, "lobby", 1)).toBe(0);
  });

  it("a quiet grab is the most coins that don't raid the room alone, at least 1", () => {
    const v = view({ bells: { ...view().bells, vault: 1, office: 3 } });
    expect(quietGrab(v, BANK_JOB, "vault", 3)).toBe(2);
    expect(quietGrab(v, BANK_JOB, "office", 2)).toBe(1);
    expect(quietGrab({ ...v, bells: { ...v.bells, vault: 3 } }, BANK_JOB, "vault", 3)).toBe(3);
  });

  it("bust danger reaches 1 one raid short of the bust line (design §5.5)", () => {
    expect([0, 1, 2].map((wanted) => bustDanger(view({ wanted })))).toEqual([0, 0.5, 1]);
  });

  it("the job this round includes Shift change's extra Vault coin (design §13)", () => {
    expect(jobThisRound(view({ round: 2, card: { round: 2, id: "shiftChange", room: null } })).rooms.vault?.coins).toBe(4);
    expect(jobThisRound(view()).rooms.vault?.coins).toBe(3);
  });
});
