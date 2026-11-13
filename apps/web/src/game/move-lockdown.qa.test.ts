// QA for #193 (PR #304): under a Lockdown card the move panel's power pickers
// offer exactly the rooms the engine then accepts, with and without a taped
// room; the Hacker never gets the locked-down room. design §3.2, §11.1, §13
import type { RoleId } from "@skimjob/content";
import { handleCommand, replay, viewFor, type GameConfig, type GameEvent, type GameState, type Move } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { createGame } from "./deal.testkit";
import { abilityOf, powerControl } from "./move";

const config: GameConfig = {
  seed: "move-lockdown-qa",
  players: Array.from({ length: 5 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isBot: i > 0 })),
  job: "bank",
  eventsEnabled: true,
  voteVisibility: "hiddenThenRevealed",
};

/** A game in round 1 planning with `role` at p1 and this round's card set to Lockdown on `room`. */
function lockedDown(role: RoleId, room: string): GameState {
  const s = createGame(config, [role]);
  const at = s.log.map((e) => e.type).lastIndexOf("roundStarted");
  const rest = s.log.slice(at + 1).filter((e) => e.type !== "eventFlipped" && e.type !== "insideTip");
  const flipped = { type: "eventFlipped", visibility: { kind: "public" }, round: s.round, card: "lockdown", room } as unknown as GameEvent;
  return replay(config, [...s.log.slice(0, at + 1), flipped, ...rest]);
}

const ROOM_POWERS = ["lookout", "hacker", "electrician", "mole", "fixer"] as const;
const base: Move = { room: "lobby", duffel: 1, pocket: 0 };

describe("QA #193: the room pickers under Lockdown match the engine (design §3.2, §13)", () => {
  it("the Hacker is never offered the locked-down room, and the engine refuses it", () => {
    for (const locked of ["vault", "office", "security"]) {
      const s = lockedDown("hacker", locked);
      expect(s.card).toMatchObject({ id: "lockdown", room: locked });
      const control = powerControl(viewFor(s, "p1"));
      expect(control?.kind).toBe("hide");
      const rooms = control && "rooms" in control ? control.rooms : [];
      expect(rooms).not.toContain(locked);
      expect(rooms.length).toBe(s.rooms.length - 1);
      const r = handleCommand(s, { type: "submitMove", player: "p1", move: { ...base, ability: { kind: "hide", room: locked } } });
      expect(r.ok).toBe(false);
    }
  });

  it("for every room power, a room is offered exactly when the engine accepts it, with or without a taped room", () => {
    for (const role of ROOM_POWERS) {
      for (const taped of [{}, { vault: 3 }]) {
        const s0 = lockedDown(role, "office");
        const s: GameState = { ...s0, taped, bells: Object.fromEntries(Object.entries(s0.bells).filter(([r]) => !(r in taped))) };
        const control = powerControl(viewFor(s, "p1"));
        if (!control) {
          expect(role === "fixer" && Object.keys(taped).length === 0, role).toBe(true);
          continue;
        }
        for (const r of s.rooms) {
          const offered = "rooms" in control && control.rooms.includes(r);
          const ability = (role === "lookout" ? { kind: "lookout", rooms: [r] } : { kind: control.kind, room: r }) as Move["ability"];
          const accepted = handleCommand(s, { type: "submitMove", player: "p1", move: { ...base, ability } }).ok;
          expect(accepted, `${role} ${r} ${JSON.stringify(taped)}`).toBe(offered);
          if (offered) expect(abilityOf(control, [r], null), `${role} ${r}`).toBeDefined();
        }
      }
    }
  });
});
