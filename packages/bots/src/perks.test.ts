// Bots spend perks minimally and sensibly. docs/roles-v2.md §1, §4 "Play"; design §8.3
import { describe, expect, it } from "vitest";
import { applyEvent, createGame, viewFor, type GameState, type PlayerCommand } from "@skimjob/engine";
import type { PerkId } from "@skimjob/content";
import { PERSONALITIES, type Personality } from "./personalities";
import { botRandom, decide } from "./bot";
import { alibiPerk, cardHeatScore, meetingPerks, planningPerks } from "./perks";
import { closeAlibis, config, game, notInsider, round, run } from "./testkit";

const exact = (base: Personality): Personality => ({ ...base, noise: 0, misread: 0, hunch: 0 });
const grant = (s: GameState, player: string, ...perks: PerkId[]): GameState =>
  perks.reduce((st, perk) => applyEvent(st, { type: "perkBought", visibility: { kind: "private", player }, player, perk, cost: 0 }), s);
const spends = (cmds: PlayerCommand[]) => cmds.flatMap((c) => (c.type === "useAbility" ? [c.ability] : []));
const lobby = { room: "lobby" };
/** Round 1: ben pockets in the Vault and claims the Lobby: ana's top suspect. */
const suspect = () => closeAlibis(round(game(5, notInsider("ben")), { ana: { room: "vault" }, ben: { room: "vault", pocket: 4, alibi: "lobby" }, carl: lobby, dee: lobby, eve: lobby }));

describe("bot perks — v2 §1, §4", () => {
  it("Peek: its top suspect, once per suspect (Inside Man / Lookout: 'Peeks its top suspect')", () => {
    const s = grant(suspect(), "ana", "peek");
    expect(spends(planningPerks(viewFor(s, "ana")))).toEqual([{ kind: "peek", target: "ben" }]);
    const after = run(s, ...planningPerks(viewFor(s, "ana")));
    expect(after.log.at(-1)).toMatchObject({ type: "perkUsed", perk: { kind: "peek", target: "ben" } });
    // Nobody suspected: keeps it.
    expect(planningPerks(viewFor(grant(game(5), "ana", "peek"), "ana"))).toEqual([]);
  });

  it("Tail: the richest looting room other than its own (Rookie)", () => {
    const s = grant(game(5), "ana", "tail");
    expect(spends(planningPerks(viewFor(s, "ana"), "lobby"))).toEqual([{ kind: "tail", room: "vault" }]);
    expect(spends(planningPerks(viewFor(s, "ana"), "vault"))[0]).toMatchObject({ kind: "tail" });
    expect(spends(planningPerks(viewFor(s, "ana"), "vault"))[0]).not.toEqual({ kind: "tail", room: "vault" });
    // decide() spends it along with the move, and the engine accepts both.
    const cmds = decide(viewFor(s, "ana"), exact(PERSONALITIES.honest), botRandom("t"), "test-crew");
    expect(spends(cmds).map((a) => a.kind)).toContain("tail");
    run(s, ...cmds);
  });

  it("+Vote: only with a shakedown ballot in an open meeting (Cleaner)", () => {
    const s = grant(run(suspect(), { type: "callEmergency", player: "carl" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-carl" } }), "ana", "extraVote");
    const view = viewFor(s, "ana");
    expect(spends(meetingPerks(view, { kind: "shakedown", target: "ben" }))).toEqual([{ kind: "extraVote" }]);
    expect(meetingPerks(view, { kind: "skip" })).toEqual([]);
    run(s, ...decide(view, exact(PERSONALITIES.honest), botRandom("v"), "test-crew"));
  });

  it("Recharge: once its power is used up (Muscle), never before", () => {
    const muscle = (used: number): GameState => {
      const s = grant(game(5), "ana", "recharge");
      const me = s.players.ana as GameState["players"][string];
      return { ...s, players: { ...s.players, ana: { ...me, role: "muscle", roleState: { ...me.roleState, usedThisGame: used } } } };
    };
    expect(spends(planningPerks(viewFor(muscle(0), "ana")))).toEqual([]);
    expect(spends(planningPerks(viewFor(muscle(1), "ana")))).toEqual([{ kind: "recharge" }]);
    run(muscle(1), ...planningPerks(viewFor(muscle(1), "ana")));
  });

  it("Alibi: stamps a true alibi when the crew could suspect it, or before the act's meeting; never a false one (Bagman)", () => {
    const plan = { ana: { room: "vault", alibi: null }, ben: lobby, carl: lobby, dee: lobby, eve: lobby };
    const r1 = grant(round(game(5), plan), "ana", "alibi");
    // The alibi window for round 1 is open; ana was in the Vault and nobody suspects her yet.
    expect(alibiPerk(viewFor(r1, "ana"), "vault")).toEqual([]);
    const r3 = grant(round(closeAlibis(round(closeAlibis(round(game(5), plan)), plan)), plan), "ana", "alibi");
    expect(alibiPerk(viewFor(r3, "ana"), "lobby")).toEqual([]); // a lie can't be stamped
    expect(spends(alibiPerk(viewFor(r3, "ana"), "vault"))).toEqual([{ kind: "alibi" }]); // the act's meeting is next
    const after = run(r3, { type: "postAlibi", player: "ana", room: "vault" }, ...alibiPerk(viewFor(r3, "ana"), "vault"));
    expect(after.log.some((e) => e.type === "alibiVerified")).toBe(true);
  });

  it("Rig: the Mastermind rigs, then picks the most Heat-calming card", () => {
    const view = viewFor(game(5), "ana");
    expect(cardHeatScore(view, "quietNight")).toBeLessThan(cardHeatScore(view, "audit"));
    expect(cardHeatScore(view, "shiftChange")).toBeGreaterThan(cardHeatScore(view, "audit"));
    for (let i = 0; i < 20; i++) {
      const base = createGame({ ...config(5, `rig-${i}`), eventsEnabled: true });
      let s = grant({ ...base, players: { ...base.players, ana: { ...(base.players.ana as GameState["players"][string]), role: "mastermind" } } }, "ana", "rig");
      expect(spends(planningPerks(viewFor(s, "ana"), "lobby"))).toEqual([{ kind: "rig" }]);
      s = run(s, ...planningPerks(viewFor(s, "ana"), "lobby"));
      const rig = s.rigs.find((r) => r.player === "ana");
      const picks = planningPerks(viewFor(s, "ana"), "lobby");
      s = run(s, ...picks);
      const chosen = s.rigs.find((r) => r.player === "ana")?.pick;
      const calmest = Math.min(...(rig?.cards ?? []).map((c) => cardHeatScore(view, c)));
      expect(cardHeatScore(view, chosen as string)).toBe(calmest);
      expect(planningPerks(viewFor(s, "ana"), "lobby")).toEqual([]); // done for this round
    }
  });
});
