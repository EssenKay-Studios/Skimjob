// Role claims (design §11.3 "Claims": any role, true or a bluff; R4b).
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
  // A bank of 12: round 1's default moves (4 coins) take a third of it, so a regular meeting follows (design §9.1).
  contentOverrides: { bank: { coinsPerPlayer: 3 } },
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

describe("role claims — design §11.3", () => {
  const start = createGame(cfg);

  it("puts a public roleClaimed on everyone's ledger and changes nothing else", () => {
    const { state, events } = ok(start, claim("p0", "lookout"));
    expect(events).toEqual([{ type: "roleClaimed", visibility: { kind: "public" }, player: "p0", role: "lookout", stretch: 1 }]);
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

  it("once per player per stretch; the next regular meeting opens a new claim — design §11.3, §9.1", () => {
    let s = ok(start, claim("p0", "rookie")).state;
    expect(reason(s, claim("p0", "auditor"))).toMatch(/already claimed a role since the last meeting/);
    expect(reason(s, claim("p0", "rookie"))).toMatch(/already claimed/);
    s = ok(s, claim("p1", "rookie")).state; // a double claim is allowed: the crew judges it
    // Round 1 takes a third of the bank: the regular meeting is due after its alibis.
    const r = handleThroughAlibis(s, { type: "advance", deadline: { kind: "round", round: 1 } });
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
    expect(s.phase).toMatchObject({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" });
    expect(reason(s, claim("p0", "auditor"))).toMatch(/already claimed/); // the stretch runs until the regular meeting opens
    s = ok(s, { type: "scheduleMeeting", meetingId: "meeting-1", slot: "now" }).state;
    s = ok(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: "meeting-1" } }).state;
    expect(s.stretch).toBe(2);
    expect(ok(s, claim("p2", "fixer")).events[0]).toMatchObject({ stretch: 2 }); // during the vote window too
    expect(ok(s, claim("p0", "auditor")).events[0]).toMatchObject({ role: "auditor", stretch: 2 });
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
