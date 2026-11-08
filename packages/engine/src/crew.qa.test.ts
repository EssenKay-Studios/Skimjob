// QA for the Lookout, Auditor and Detective with their tokens: power limits,
// generic refusals, exact token triggers at the share, a view-diff leak check
// with them dealt, determinism.
// extension.md "Shakedowns", "Tokens and the perk shop"; design §9.6, §11.1, §11.2, §18
import { describe, expect, it } from "vitest";
import { closeResultWindow } from "./alibis.testkit";
import { handleCommand, type CommandResult } from "./handle";
import { ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { outcomeFor } from "./end";
import { viewFor } from "./view";
import { grantPerks } from "./perks.testkit";
import { fullGrab } from "./grab.testkit";
import { R6_COINS } from "./v01-numbers.testkit";

const SIX = ["locksmith", "priest", "lookout", "auditor", "detective"];

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "crew-qa",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
    // R6 room yields as coins (the scripts' numbers), and a bank of 20 a player, so regular meetings come every few rounds (design §9.1).
    contentOverrides: { ...R6_COINS, bank: { coinsPerPlayer: 20 }, ...extra.contentOverrides },
  };
}

/** Seat i gets roles[i] (a Lookout if missing: it acts only when its power is used). */
function game(players: number, roles: string[], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  let seat = 0;
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "lookout" } : e)));
}

/**
 * A command, with a round deadline followed by its alibi deadline (nobody
 * posts). The result window (design §9.3) stays open, so an emergency can be
 * called in it, until a move or a round deadline closes it.
 */
function handleThroughAlibis(state: GameState, command: unknown): CommandResult {
  const c = command as { type?: unknown; deadline?: { kind?: unknown } } | null;
  const planning = c?.type === "submitMove" || c?.deadline?.kind === "round";
  const s = state.phase.kind === "result" && !state.pendingEmergency && planning ? must(closeResultWindow(state)) : state;
  const r = handleCommand(s, command);
  if (!r.ok || r.state.phase.kind !== "alibis" || c?.deadline?.kind !== "round") return r;
  return handleCommand(r.state, { type: "advance", deadline: { kind: "alibis", round: r.state.phase.round } });
}
const must = (r: CommandResult): GameState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    const r = handleThroughAlibis(s, command);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    return passWindow(r.state);
  }, state);
}
/** The shop may hold a Shield, so a passed shakedown waits for its window; nobody here cancels. */
function passWindow(s: GameState): GameState {
  if (s.phase.kind !== "shakedownPending") return s;
  const r = handleThroughAlibis(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.phase.meetingId } });
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}
function reason(state: GameState, command: unknown): string {
  const r = handleThroughAlibis(state, command);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
}
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const granted = (s: GameState, player: string) => ofType(s.log, "tokenEarned").filter((e) => e.player === player).map((e) => e.trigger);
const lastAbility = (s: GameState) => ofType(s.log, "abilityResolved").at(-1)?.ability;

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { ...fullGrab(room, pocket, R6_COINS), ...extra } });
/** The round being planned; from the result window, the next one (closing the window first). */
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.phase.kind === "result" ? s.round + 1 : s.round } });
const vote = (player: string, target: string) => ({ type: "castVote", player, vote: { kind: "shakedown", target } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const use = (player: string, ability: object) => ({ type: "useAbility", player, ability });
/** `caller` spends the crew's emergency in the result window (design §9.3). */
const emergency = (s: GameState, caller: string) =>
  run(s, { type: "callEmergency", player: caller }, (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.pendingEmergency?.meetingId } }));
/** A meeting the round called (design §9.1, §9.2), else `caller`'s emergency; everyone else but `target` votes to shake `target` down. */
const shakeDown = (s: GameState, caller: string, target: string): GameState => {
  const p = s.phase;
  s =
    p.kind === "awaitingMeeting"
      ? run(s, { type: "scheduleMeeting", meetingId: p.meetingId, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: p.meetingId } })
      : emergency(s, caller);
  for (const id of s.playerOrder) if (id !== target) s = run(s, vote(id, target));
  return run(s, CLOSE);
};
/** Play rounds with `moves` until a third of the bank is gone; the regular meeting runs `inMeeting` then closes (design §9.1). */
const finishStretch = (s: GameState, moves: Cmd[], inMeeting: (s: GameState) => GameState = (x) => x): GameState => {
  while (s.phase.kind !== "awaitingMeeting") {
    if (s.phase.kind === "ended") throw new Error("the game ended before a regular meeting");
    s = run(s, ...moves, ROUND);
  }
  const { meetingId } = s.phase;
  s = run(s, { type: "scheduleMeeting", meetingId, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId } });
  return run(inMeeting(s), CLOSE);
};
const STEADY = [mv("p0", "office"), mv("p1", "office"), mv("p2", "lobby")];

describe("QA: refusals are generic and power limits hold — design §11.1, §11.2", () => {
  it("every role without the power gets the same reason; the game being over refuses even the holder", () => {
    const s = run(game(6, SIX), ROUND);
    for (const kind of [{ kind: "audit", room: "vault" }, { kind: "detect", target: "p0" }]) {
      const holder = kind.kind === "audit" ? "p3" : "p4";
      const reasons = new Set(s.playerOrder.filter((p) => p !== holder).map((p) => reason(s, use(p, kind))));
      expect([...reasons]).toEqual([`your role has no ${kind.kind} ability to use now`]);
    }
    let end = game(3, ["auditor", "detective"]);
    for (let stretch = 1; stretch <= 2; stretch++) end = finishStretch(end, STEADY);
    while (end.phase.kind !== "ended") end = run(end, ...STEADY, ROUND); // until the bank runs out (design §6.2)
    expect(end.phase.kind).toBe("ended");
    expect(reason(end, use("p0", { kind: "audit", room: "office" }))).toBe("the game is over");
    expect(reason(end, use("p1", { kind: "detect", target: "p0" }))).toBe("the game is over");
  });

  it("the Auditor once between meetings, the Detective once a round, across meeting and planning; a refused use spends nothing; a regular meeting recharges the Auditor — design §11.1, §11.2", () => {
    let s = run(game(3, ["auditor", "detective"]), mv("p2", "vault", 3), ROUND);
    expect(reason(s, use("p1", { kind: "detect", target: "p1" }))).toMatch(/another player/);
    expect(reason(s, use("p0", { kind: "audit", room: "moon" }))).toMatch(/room in play/);
    s = emergency(s, "p2");
    // Usable during a meeting ("any time"), and the refused tries above spent nothing.
    s = run(s, use("p0", { kind: "audit", room: "vault" }), use("p1", { kind: "detect", target: "p2" }), CLOSE);
    expect(s.players.p0?.roleState.usedThisStretch).toBe(1);
    expect(reason(s, use("p0", { kind: "audit", room: "office" }))).toMatch(/already audited/);
    expect(reason(s, use("p1", { kind: "detect", target: "p0" }))).toMatch(/already looked into round 1/);
    s = finishStretch(s, STEADY);
    expect(s.stretch).toBe(2);
    s = run(s, use("p0", { kind: "audit", room: "office" }), use("p1", { kind: "detect", target: "p0" }));
    // Both read the latest resolved round, the one that called the meeting.
    expect(ofType(s.log, "abilityResolved").at(-2)?.ability).toMatchObject({ kind: "audit", round: s.resolvedRound, room: "office", duffel: 8 });
    expect(lastAbility(s)).toMatchObject({ kind: "detect", round: s.resolvedRound, target: "p0", grabbed: 4 });
  });
});

describe("QA: dirty vs clean at exactly the share — design §9.6", () => {
  /** Round 1: p1 pockets `pocket` in the Vault; the Detective p0 looks into p1, the Lookout p2 watched the Vault. */
  const caught = (pocket: number) => {
    let s = run(
      game(4, ["detective", "locksmith", "lookout", "auditor"]),
      mv("p1", "vault", pocket),
      mv("p2", "lobby", 0, { ability: { kind: "lookout", rooms: ["vault"] } }),
      ROUND,
      use("p0", { kind: "detect", target: "p1" }),
      use("p3", { kind: "audit", room: "vault" }),
    );
    s = shakeDown(s, "p3", "p1");
    return s;
  };

  it("one coin above the share: the shakedown is dirty, and all three readers are rewarded", () => {
    const s = caught(1);
    // The Detective learns the grab, not what was kept (design §11.1).
    const check = ofType(s.log, "abilityResolved").find((e) => e.ability.kind === "detect")?.ability;
    expect(check).toEqual({ kind: "detect", round: 1, target: "p1", grabbed: 6 });
    expect(ofType(s.log, "shakedownResolved")[0]?.clean).toBe(false);
    expect(granted(s, "p0")).toEqual(["checkedShakenDirty"]);
    expect(granted(s, "p2")).toEqual(["watchedShakenDirty"]);
    expect(granted(s, "p3")).toEqual(["auditedShakenDirty"]);
  });

  it("at the share: the shakedown is clean, and nobody is rewarded", () => {
    const s = caught(0);
    expect(ofType(s.log, "shakedownResolved")[0]?.clean).toBe(true);
    expect(ofType(s.log, "tokenEarned")).toEqual([]);
  });

  it("dirty before a regular meeting stays dirty after it at the same stash above the share → a token (extension.md \"Shakedowns\")", () => {
    let s = run(game(3, ["detective"]), mv("p1", "vault", 3), mv("p0", "office"), mv("p2", "office"), ROUND);
    s = run(s, use("p0", { kind: "detect", target: "p1" }));
    expect(lastAbility(s)).toMatchObject({ grabbed: 6 });
    s = finishStretch(s, [mv("p0", "office"), mv("p1", "office"), mv("p2", "office")]);
    expect(s.stretch).toBe(2);
    // design §7.6, §9.6: what the stash holds above the share.
    expect((s.players.p1?.stash ?? 0) - s.share).toBe(3);
    s = shakeDown(s, "p2", "p1");
    expect(ofType(s.log, "shakedownResolved")[0]?.clean).toBe(false);
    expect(granted(s, "p0")).toEqual(["checkedShakenDirty"]);
  });
});

describe("QA: Lookout sightings and reward counts — design §11.1; extension.md \"Roles\"", () => {
  it("a sighting in one stretch pays in the next; one token per dirty shakedown however often it saw them; Security sightings don't count", () => {
    let s = game(3, ["lookout"]);
    const watchVault = mv("p0", "lobby", 0, { ability: { kind: "lookout", rooms: ["vault"] } });
    s = run(s, watchVault, mv("p1", "vault", 2), mv("p2", "office"), ROUND, watchVault, mv("p1", "vault", 2), mv("p2", "office"), ROUND);
    s = finishStretch(s, [mv("p0", "lobby"), mv("p1", "office", 4), mv("p2", "office")]);
    expect(s.stretch).toBe(2);
    expect(s.players.p1!.stash).toBeGreaterThan(s.share);
    s = shakeDown(s, "p2", "p1");
    expect(ofType(s.log, "shakedownResolved")[0]?.clean).toBe(false);
    expect(granted(s, "p0")).toEqual(["watchedShakenDirty"]);

    // Security (the room, not the power) saw p1: no token.
    let t = run(game(3, ["lookout"]), mv("p0", "security", 0, { watch: "vault" }), mv("p1", "vault", 3), mv("p2", "office"), ROUND);
    expect(ofType(t.log, "roomWatched").map((e) => e.source)).toEqual(["security"]);
    t = shakeDown(t, "p2", "p1");
    expect(granted(t, "p0")).toEqual([]);
  });

  it("nobody is rewarded for their own dirty shakedown (Lookout, Auditor, Detective)", () => {
    let s = run(game(4, ["lookout", "auditor", "detective"]), mv("p0", "vault", 3, { ability: { kind: "lookout", rooms: ["vault"] } }), mv("p1", "vault"), mv("p2", "vault"), ROUND);
    s = run(s, use("p1", { kind: "audit", room: "vault" }), use("p2", { kind: "detect", target: "p1" }));
    // p1 (Auditor) audited its own room and is checked by the Detective; p0 (Lookout) saw p1 and p2.
    s = run(s, mv("p1", "vault", 3), ROUND);
    s = shakeDown(s, "p3", "p1");
    expect(ofType(s.log, "shakedownResolved")[0]?.clean).toBe(false);
    expect(granted(s, "p1")).toEqual([]); // not for its own shakedown
    expect(granted(s, "p0")).toEqual(["watchedShakenDirty"]);
    expect(granted(s, "p2")).toEqual(["checkedShakenDirty"]);
  });
});

describe("QA: view-diff with all six dealt, and determinism — design §13, §17.2", () => {
  // Variant A: every reader points at p0, who is caught dirty; B: they point elsewhere. Same public play.
  const play = (a: boolean): GameState => {
    let s = game(6, SIX);
    s = run(
      s,
      mv("p0", "vault", 6),
      mv("p2", "lobby", 0, { ability: { kind: "lookout", rooms: [a ? "vault" : "rooftop"] } }),
      ROUND,
      use("p3", { kind: "audit", room: a ? "vault" : "office" }),
      use("p4", { kind: "detect", target: a ? "p0" : "p1" }),
    );
    s = emergency(s, "p1");
    for (const id of s.playerOrder) if (id !== "p0") s = run(s, vote(id, "p0"));
    s = run(s, CLOSE);
    if (s.pendingShakedown) s = run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown.meetingId } });
    return run(s, ROUND);
  };

  it("the uninvolved players' views and rejections are identical whether or not three rewards fired", () => {
    const [a, b] = [play(true), play(false)];
    expect(ofType(a.log, "shakedownResolved")[0]?.clean).toBe(false);
    expect(ofType(a.log, "tokenEarned").map((e) => e.trigger).sort()).toEqual(["auditedShakenDirty", "checkedShakenDirty", "watchedShakenDirty"]);
    expect(ofType(b.log, "tokenEarned")).toEqual([]);
    for (const viewer of ["p0", "p1"]) {
      expect(viewFor(a, viewer)).toEqual(viewFor(b, viewer));
      expect(reason(a, use(viewer, { kind: "audit", room: "vault" }))).toBe(reason(b, use(viewer, { kind: "audit", room: "vault" })));
    }
    for (const viewer of a.playerOrder) {
      const json = JSON.stringify(viewFor(a, viewer));
      for (const other of a.playerOrder) if (other !== viewer) expect(json).not.toContain(`"private:${other}"`);
    }
  });

  it("same seed + same commands → identical log, and replay rebuilds the state", () => {
    const [a, b] = [play(true), play(true)];
    expect(a.log).toEqual(b.log);
    expect(replay(a.config, a.log)).toEqual(a);
  });
});
