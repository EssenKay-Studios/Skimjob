// Role claims (design §8 "players can claim any role", §12.1 claim button; R4b).
import { STARTER_ROLES } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import type { Command, GameConfig, GameEvent, GameState } from "./types";
import { canSee } from "./types";
import { createGame } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { handleThroughAlibis } from "./alibis.testkit";
import { sampleEvents } from "./types/samples";

const cfg: GameConfig = {
  seed: "claim-seed",
  players: ["p0", "p1", "p2", "p3"].map((id) => ({ id, name: id.toUpperCase(), isBot: false })),
  job: "bank",
  rolePool: [...STARTER_ROLES],
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
};

const claim = (player: unknown, role: unknown): Command => ({ type: "claimRole", player, role }) as Command;

function ok(state: GameState, command: Command): { state: GameState; events: readonly GameEvent[] } {
  const r = handleCommand(state, command);
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r;
}

function reason(state: GameState, command: Command): string {
  const r = handleCommand(state, command);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
}

describe("role claims — design §8, §12.1", () => {
  const start = createGame(cfg);

  it("puts a public roleClaimed on everyone's ledger and changes nothing else", () => {
    const { state, events } = ok(start, claim("p0", "lookout"));
    expect(events).toEqual([{ type: "roleClaimed", visibility: { kind: "public" }, player: "p0", role: "lookout", act: 1 }]);
    for (const viewer of cfg.players) expect(canSee(events[0]!.visibility, viewer.id, false)).toBe(true);
    for (const viewer of ["p1", "p2", "p3"]) {
      expect(viewFor(state, viewer).ledger.at(-1)?.event).toEqual(events[0]);
    }
    expect({ ...state, log: start.log }).toEqual(start);
    expect(replay(cfg, state.log)).toEqual(state);
  });

  it("a claim can be a bluff: any role the content knows, even one this game's pool can't deal (so the pool stays hidden)", () => {
    // The pool is the starter set; the Detective and the Mole aren't in it.
    expect(ok(start, claim("p1", "detective")).events[0]).toMatchObject({ role: "detective" });
    expect(ok(start, claim("p1", "mole")).events[0]).toMatchObject({ role: "mole" });
  });

  it("once per player per act; the next act opens a new claim", () => {
    let s = ok(start, claim("p0", "rookie")).state;
    expect(reason(s, claim("p0", "auditor"))).toMatch(/already claimed a role since the last meeting/);
    expect(reason(s, claim("p0", "rookie"))).toMatch(/already claimed/);
    s = ok(s, claim("p1", "rookie")).state; // a double claim is allowed: the crew judges it
    // Play out act 1 to its meeting, then into act 2.
    for (let round = 1; round <= 3; round++) {
      const r = handleThroughAlibis(s, { type: "advance", deadline: { kind: "round", round } });
      if (!r.ok) throw new Error(r.reason);
      s = r.state;
    }
    expect(s.phase.kind).toBe("awaitingMeeting");
    expect(reason(s, claim("p0", "auditor"))).toMatch(/already claimed/); // the stretch runs until its meeting closes
    s = ok(s, { type: "scheduleMeeting", act: 1, slot: "now" }).state;
    s = ok(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } }).state;
    expect(ok(s, claim("p2", "fixer")).events[0]).toMatchObject({ act: 1 }); // during the vote window too
    s = ok(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "act-1" } }).state;
    expect(s.round).toBe(4);
    expect(ok(s, claim("p0", "auditor")).events[0]).toMatchObject({ role: "auditor", act: 2 });
  });

  it("refuses unknown players and roles, prototype keys included, never throwing", () => {
    expect(reason(start, claim("nobody", "rookie"))).toMatch(/unknown player/);
    for (const role of ["", "constructor", "__proto__", "toString", "notARole", 3, null, {}, ["rookie"]]) {
      expect(reason(start, claim("p0", role))).toMatch(/unknown role/);
    }
  });

  it("leaks nothing: the same claim reads the same to others whatever the claimant was really dealt — design §13, §17.2", () => {
    const dealt = (role: string): GameState => {
      const log = start.log.map((e) => (e.type === "roleDealt" && e.player === "p0" ? { ...e, role } : e));
      return ok(replay(cfg, log), claim("p0", "auditor")).state;
    };
    const [truth, bluff] = [dealt("auditor"), dealt("lookout")];
    for (const viewer of ["p1", "p2", "p3"]) expect(viewFor(bluff, viewer)).toEqual(viewFor(truth, viewer));
  });

  it("is refused after the game", () => {
    const ended: GameState = { ...start, phase: { kind: "ended", outcome: sampleEvents.gameEnded.outcome } };
    expect(reason(ended, claim("p0", "rookie"))).toMatch(/over/);
  });
});
