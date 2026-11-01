// QA for PR #36 (role deck v2 R3b): Blackmailer and Forger (accomplices), Embezzler (saboteur).
// Adversarial edges the PR's dark.test.ts doesn't cover. design §3, §8, §8.1, §11.2, §11.3, §11.5, §13
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { handleThroughAlibis } from "./alibis.testkit";
import { createGame, setupEvents } from "./setup";
import { dealtKnowledge } from "./accomplices";
import { applyEvent, replay } from "./reduce";
import { seedRng } from "./rng";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { outcomeFor } from "./end";
import { checkpointTarget } from "./job";
import { BANK_JOB } from "@skimjob/content";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "dark-r3b-qa",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
    job: "bank",
    rolePool: [],
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "open",
    starterMode: false,
    ...extra,
  };
}

/** A new game with seat i dealt roles[i] (Rookie if missing), the deal's knowledge recomputed (as in dark.test.ts). */
function game(players: number, roles: readonly string[], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  const dealt = cfg.players.map((_, i) => roles[i] ?? "rookie");
  const real = setupEvents(cfg).filter((e) => e.type !== "moleAllies" && e.type !== "alliesLearned" && e.type !== "snitchTargetAssigned");
  const log = real.map((e, i): GameEvent => (e.type === "roleDealt" ? { ...e, role: dealt[real.slice(0, i).filter((x) => x.type === "roleDealt").length] as string } : e));
  const at = log.findIndex((e) => e.type === "roundStarted");
  return replay(cfg, [...log.slice(0, at), ...dealtKnowledge(cfg, dealt, seedRng("x")).value, ...log.slice(at)]);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const cmd = typeof c === "function" ? c(s) : c;
    const r = handleThroughAlibis(s, cmd);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(cmd)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const r = handleCommand(state, command);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
}
const mv = (player: string, room: string, pocket = 0, extra: Record<string, unknown> = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const watch = (player: string, room: string, extra: Record<string, unknown> = {}) => mv(player, "security", 0, { watch: room, ...extra });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) => events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const lastResult = (s: GameState) => ofType(s.log, "meetingClosed").at(-1);
const withHaul = (s: GameState, haul: number): GameState => ({ ...s, haul });

/** Open a meeting (emergency by `caller`, or the scheduled one when caller is null), cast these ballots, close it. */
function meeting(s: GameState, caller: PlayerId | null, ballots: Record<PlayerId, PlayerId | null>): GameState {
  s =
    caller === null
      ? run(s, { type: "scheduleMeeting", act: s.round / 3, slot: "s" }, (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.scheduledMeeting?.meetingId } }))
      : run(s, { type: "callEmergency", player: caller }, (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.pendingEmergency?.meetingId } }));
  for (const [player, target] of Object.entries(ballots)) s = run(s, { type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
  s = run(s, (x: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: x.meeting?.id } }));
  return s.phase.kind === "shakedownPending" ? run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.phase.meetingId } }) : s;
}

describe("QA Blackmailer — the stolen vote at the next meeting (design §8, §11.2)", () => {
  const guess = (target: string, role: string, by = "p0") => mv(by, "lobby", 0, { ability: { kind: "blackmail", target, role } });

  it("a Smooth Talker victim's 2 weight moves to the Blackmailer and turns the result", () => {
    // p0 Blackmailer, p1 Smooth Talker, p2 Mole. 7 players: p1 (2) + p3 alone for p4 = 3 of 6 weight: no majority.
    const base = game(7, ["blackmailer", "smoothTalker", "mole"]);
    const ballots = { p0: "p4", p1: "p5", p3: "p5", p5: null, p6: "p4" };
    // Plain: p5 has 3 (p1 ×2 + p3), p4 2, skip 1, of 6 → no majority.
    expect(lastResult(meeting(run(base, guess("p1", "rookie"), ROUND), "p3", ballots))?.result).toEqual({ kind: "noMajority" });
    // Stolen: p1 weighs 0, p0 weighs 1 + 2 = 3 → p4 has 4 of 6. The public tally still counts ballots.
    const s = meeting(run(base, guess("p1", "smoothTalker"), ROUND), "p3", ballots);
    expect(lastResult(s)).toMatchObject({ tally: { skip: 1, targets: { p4: 2, p5: 2 } }, result: { kind: "shakedown", target: "p4" } });
  });

  it("the victim's sealed vote is cast but weighs nothing, and still counts toward quorum", () => {
    const base = game(7, ["blackmailer", "rookie", "mole"]);
    let s = run(base, guess("p1", "rookie"), ROUND);
    s = run(s, { type: "sealVote", player: "p1", vote: { kind: "shakedown", target: "p4" } });
    // p1 sealed (weight 0), p3 and p5 vote p4: 2 of 3 weight (the Blackmailer doesn't vote, so p1's weight is gone).
    const done = meeting(s, "p3", { p3: "p4", p5: "p4", p6: null });
    const closed = lastResult(done);
    expect(closed?.tally).toEqual({ skip: 1, targets: { p4: 3 } });
    expect(closed?.result).toEqual({ kind: "shakedown", target: "p4" });
    // Quorum: 4 voters of 7 incl. the sealed victim; without the victim's ballot it would be 3 (no quorum).
    const quorum = meeting(run(run(base, guess("p1", "rookie"), ROUND), { type: "sealVote", player: "p1", vote: { kind: "skip" } }), "p3", { p3: "p4", p5: "p4", p6: "p4" });
    expect(lastResult(quorum)?.result).toEqual({ kind: "shakedown", target: "p4" });
  });

  it("plurality at 9+: the stolen vote can make a lone leader (§11.2 plurality, ⅓ share)", () => {
    // p0 Blackmailer, p1 victim. 9 voters: p4 ← p0,p2 ; p5 ← p1,p3 ; p6 ← p7 ; skip p8: tie 2/2 → no majority.
    const base = game(9, ["blackmailer", "rookie", "mole"]);
    const ballots = { p0: "p4", p2: "p4", p1: "p5", p3: "p5", p7: "p6", p8: null, p6: null };
    expect(lastResult(meeting(run(base, guess("p1", "smoothTalker"), ROUND), "p3", ballots))?.result).toEqual({ kind: "noMajority" });
    // Stolen: p4 = 3 weight, p5 = 1, p6 = 1, skip 2 of 7 → p4 alone on top with ≥ ⅓ (7/3) → shakedown.
    expect(lastResult(meeting(run(base, guess("p1", "rookie"), ROUND), "p3", ballots))?.result).toEqual({ kind: "shakedown", target: "p4" });
  });

  it("a guess in an act's last round steals the vote at the regular act meeting; one vote per right guess", () => {
    const base = game(7, ["blackmailer", "rookie", "mole"]);
    const s = run(base, ROUND, ROUND, guess("p1", "rookie"), ROUND);
    expect(s.round).toBe(3);
    const ballots = { p0: null, p1: "p4", p3: "p4", p5: "p4", p6: "p4", p2: null };
    const done = meeting(s, null, ballots);
    expect(ofType(done.log, "meetingOpened").at(-1)?.kind).toBe("regular");
    expect(lastResult(done)?.result).toEqual({ kind: "noMajority" });
  });

  it("a wrong guess emits nothing to anyone but the Blackmailer; guessing a saboteur by the Mole id works too", () => {
    const base = game(7, ["blackmailer", "rookie", "mole"]);
    const wrong = run(base, guess("p2", "embezzler"), ROUND);
    expect(ofType(since(base, wrong), "voteCompromised")).toEqual([]);
    expect(ofType(since(base, wrong), "alliesLearned")).toEqual([]);
    const right = run(base, guess("p2", "mole"), ROUND);
    expect(ofType(since(base, right), "alliesLearned").map((e) => e.player)).toEqual(["p0", "p2"]);
    expect(ofType(since(base, right), "voteCompromised").map((e) => e.player)).toEqual(["p2"]);
  });

  it("refuses hostile guesses", () => {
    const base = game(7, ["blackmailer"]);
    for (const role of ["__proto__", "constructor", "toString", 7, null]) expect(reason(base, guess("p1", role as string))).toMatch(/unknown role/);
    for (const target of [7, null, "hasOwnProperty", "p99"]) expect(reason(base, guess(target as string, "rookie"))).toMatch(/unknown player/);
    expect(reason(base, guess("p0", "blackmailer"))).toMatch(/yourself/);
  });
});

describe("QA Forger — fake sightings (design §8, §13)", () => {
  // p0 Forger, p1 Lookout, p2 Hacker, p3 Mole; p4–p6 Rookies.
  const base = game(7, ["forger", "lookout", "hacker", "mole"]);
  const forge = (target: string, room: string, at = "lobby") => mv("p0", at, 0, { ability: { kind: "forge", target, room } });
  const seen = (s: GameState, player: string) => ofType(since(base, s), "roomWatched").filter((e) => e.player === player);

  it("a Hacker loop blanks Security but the Lookout still sees the forged player", () => {
    const s = run(base, forge("p5", "vault"), watch("p4", "vault"), mv("p1", "office", 0, { ability: { kind: "lookout", rooms: ["vault"] } }), mv("p2", "lobby", 0, { ability: { kind: "loopCameras", room: "vault" } }), ROUND);
    expect(seen(s, "p4")[0]?.seen).toEqual([]);
    expect(seen(s, "p1")[0]?.seen).toEqual(["p5"]);
    expect(ofType(s.log, "sightingForged")[0]?.shownTo).toEqual(["p1"]);
  });

  it("a forged saboteur in a looped room earns the Hacker no Peek (only a real one does)", () => {
    const s = run(base, forge("p3", "vault"), watch("p4", "vault"), mv("p2", "lobby", 0, { ability: { kind: "loopCameras", room: "vault" } }), mv("p3", "office"), ROUND);
    expect(ofType(since(base, s), "perkGranted").filter((e) => e.player === "p2")).toEqual([]);
  });

  it("the Forger can forge itself, and sees its own forgery on Security; two watchers both listed", () => {
    const s = run(base, mv("p0", "security", 0, { watch: "vault", ability: { kind: "forge", target: "p0", room: "vault" } }), watch("p4", "vault"), ROUND);
    // The Forger's own feed excludes itself (a feed of the target itself doesn't show it).
    expect(seen(s, "p0")[0]?.seen).toEqual([]);
    expect(seen(s, "p4")[0]?.seen).toEqual(["p0"]);
    expect(ofType(s.log, "sightingForged")[0]).toMatchObject({ target: "p0", shownTo: ["p4"] });
  });

  it("the reveal (after the game) carries sightingForged; during the game nobody sees it", () => {
    const s = run(base, forge("p5", "vault"), watch("p4", "vault"), ROUND);
    for (const id of s.playerOrder) expect(viewFor(s, id).reveal).toBeNull();
    const ended = applyEvent(s, { type: "gameEnded", visibility: { kind: "public" }, outcome: outcomeFor(s, "heat") } as GameEvent);
    for (const id of ["p0", "p4", "p6"]) {
      const forged = (viewFor(ended, id).reveal?.log ?? []).filter((e) => e.event.type === "sightingForged");
      expect(forged.map((e) => e.event)).toMatchObject([{ forger: "p0", target: "p5", room: "vault", shownTo: ["p4"] }]);
    }
  });

  it("refuses hostile forgeries; per-act use resets in Act 2", () => {
    for (const room of [7, null, "constructor", "toString"]) expect(reason(base, forge("p5", room as string))).toMatch(/room in play/);
    for (const target of [7, null, "constructor"]) expect(reason(base, forge(target as string, "vault"))).toMatch(/unknown player/);
    let s = run(base, forge("p5", "vault"), ROUND, ROUND, ROUND);
    s = meeting(s, null, {});
    expect(s.round).toBe(4);
    expect(() => run(s, forge("p5", "vault"), ROUND)).not.toThrow();
  });
});

describe("QA Embezzler — Haul cap, checkpoints, Mole (design §8, §11.5)", () => {
  // p0 Embezzler, p1 Mole, p2 Hacker (accomplice), the rest Rookies. 9 players, everyone on the Rooftop (0 loot).
  const base = game(9, ["embezzler", "mole", "hacker"]);
  const take = (at = "rooftop") => mv("p0", at, 0, { ability: { kind: "embezzle" } });
  const roof = (s: GameState, skip: readonly string[] = ["p0"]) => s.playerOrder.filter((id) => !skip.includes(id)).map((id) => mv(id, "rooftop"));
  const rr = (s: GameState) => ofType(s.log, "roundResolved").at(-1);

  it("takes at most this round's inflow, never the Haul from earlier rounds, so the public Haul change is never negative (PR #36 review)", () => {
    const none = run(withHaul(base, 10), take(), ...roof(base), ROUND);
    expect([none.haul, none.players.p0?.stash, rr(none)?.haulDelta]).toEqual([10, 0, 0]);
    // One player hands in the Lobby's 2: the take is 2 and the change shows 0.
    const lobby = run(withHaul(base, 10), take(), mv("p3", "lobby"), ...roof(base, ["p0", "p3"]), ROUND);
    expect([lobby.haul, lobby.players.p0?.stash, rr(lobby)?.haulDelta]).toEqual([10, 2, 0]);
  });

  it("ignores a hostile amount in the command (always the content's take)", () => {
    const s = run(withHaul(base, 50), mv("p0", "rooftop", 0, { ability: { kind: "embezzle", amount: 999 } }), ...base.playerOrder.slice(1).map((id) => mv(id, "vault")), ROUND);
    expect(s.players.p0?.stash).toBe(4);
    expect(reason(base, { type: "useAbility", player: "p0", ability: { kind: "embezzle" } })).toBeTruthy();
  });

  it("a take in an act's last round can miss the checkpoint: +Heat penalty (design §11.5)", () => {
    const target = checkpointTarget(BANK_JOB, 1, 9);
    let s = run(base, ROUND, ROUND);
    // p3 hands in the Lobby's 2, which make the target; the take (capped at the round's inflow, PR #36 review) misses it.
    s = withHaul(s, target - 2);
    const made = meeting(run(s, mv("p3", "lobby"), ...roof(s, ["p3"]), ROUND), null, {});
    expect(ofType(made.log, "checkpointChecked").at(-1)).toMatchObject({ act: 1, met: true, heatPenalty: 0 });
    const missed = meeting(run(s, take(), mv("p3", "lobby"), ...roof(s, ["p0", "p3"]), ROUND), null, {});
    const cp = ofType(missed.log, "checkpointChecked").at(-1);
    expect(cp).toMatchObject({ act: 1, haul: target - 2, met: false });
    expect(cp?.heatPenalty).toBeGreaterThan(0);
  });

  it("Mole tip-off and Embezzler take in one round: both hidden in public numbers, each learns an accomplice", () => {
    const s = run(withHaul(base, 10), take("lobby"), mv("p1", "lobby", 0, { ability: { kind: "tipOff" } }), ...roof(base, ["p0", "p1"]), ROUND);
    const fresh = since(base, s);
    const learned = ofType(fresh, "alliesLearned");
    expect(learned.map((e) => [e.player, e.via, e.allies])).toEqual(
      expect.arrayContaining([
        ["p0", "embezzle", ["p2"]],
        ["p1", "tipOff", ["p2"]],
      ]),
    );
    // Public events carry no trace of either power.
    const pub = fresh.filter((e) => e.visibility.kind === "public");
    expect(JSON.stringify(pub)).not.toMatch(/embezzle|tipOff/);
  });

  it("the Mole and the Embezzler learn each other at the deal (saboteur mates)", () => {
    const real = createGame(config(12, { mole: "on", seed: findSeed(12, (roles) => roles.includes("mole") && roles.includes("embezzler")) }));
    const roles = real.playerOrder.map((id) => real.players[id]?.role);
    const mole = real.playerOrder[roles.indexOf("mole")] as string;
    const emb = real.playerOrder[roles.indexOf("embezzler")] as string;
    const mates = ofType(real.log, "moleAllies");
    expect(mates.find((e) => e.player === mole)?.allies).toEqual([emb]);
    expect(mates.find((e) => e.player === emb)?.allies).toEqual([mole]);
  });
});

/** The first seed `qa-<i>` whose deal at `n` players satisfies `pred`. */
function findSeed(n: number, pred: (roles: string[]) => boolean): string {
  for (let i = 0; i < 400; i++) {
    const s = createGame(config(n, { mole: "on", seed: `qa-${i}` }));
    if (pred(s.playerOrder.map((id) => s.players[id]?.role as string))) return `qa-${i}`;
  }
  throw new Error("no seed found");
}

describe("QA dealing and winning with two saboteurs (design §3, §8.1)", () => {
  const SABOTEURS = ["mole", "embezzler"];
  it("7–12 players: at most two distinct saboteurs; two-saboteur deals happen; Blackmailer/Forger only from 7", () => {
    for (let n = 2; n <= 12; n++) {
      let two = 0;
      for (let i = 0; i < 60; i++) {
        const s = createGame(config(n, { mole: "on", seed: `deal-${n}-${i}`, rolePool: ["blackmailer", "forger", "hacker", "fence", "getawayDriver", "lookout"] }));
        const roles = s.playerOrder.map((id) => s.players[id]?.role as string);
        const sab = roles.filter((r) => SABOTEURS.includes(r));
        expect(new Set(sab).size, `n=${n}`).toBe(sab.length);
        expect(sab.length).toBeLessThanOrEqual(n < 7 ? 1 : 2);
        if (sab.length === 2) two++;
        if (n < 7) expect(roles.filter((r) => r === "blackmailer" || r === "forger"), `n=${n}`).toEqual([]);
      }
      if (n >= 7) expect(two, `n=${n}`).toBeGreaterThan(0);
    }
    for (let i = 0; i < 30; i++) {
      const duel = createGame(config(2, { mole: "on", duel: true, seed: `duel-${i}`, rolePool: ["blackmailer", "forger"] }));
      for (const id of duel.playerOrder) expect(["blackmailer", "forger", "mole", "embezzler"]).not.toContain(duel.players[id]?.role);
    }
  });

  it("with two saboteurs, a failure is won by the best dark-side stash (Embezzler or Mole), a success by crew only", () => {
    const base = game(9, ["embezzler", "mole", "forger"]);
    const stash = (s: GameState, values: Record<string, number>): GameState => ({
      ...s,
      players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, stash: values[id] ?? 1 }])),
    });
    expect(outcomeFor(stash(base, { p0: 9, p1: 5, p2: 3, p3: 20 }), "heat").winners).toEqual(["p0"]);
    expect(outcomeFor(stash(base, { p0: 2, p1: 8, p2: 3, p3: 20 }), "target").winners).toEqual(["p1"]);
    expect(outcomeFor(stash(base, { p0: 9, p1: 8, p2: 30, p3: 20 }), "heat").winners).toEqual(["p2"]);
    expect(outcomeFor(stash(base, { p0: 90, p1: 80, p2: 30, p3: 20 }), null).winners).toEqual(["p3"]);
  });
});

describe("QA view-diff leak test: every dark power used vs none (design §13, CLAUDE.md visibility)", () => {
  // p0 Blackmailer, p1 Forger, p2 Embezzler, p3 Mole, p4 Hacker; p5–p8 Rookies. p8 sits out (Rooftop, no watch).
  const base = withHaul(game(9, ["blackmailer", "forger", "embezzler", "mole", "hacker"]), 20);
  const quiet = [mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "lobby"), mv("p3", "lobby"), mv("p4", "lobby"), mv("p5", "lobby"), watch("p6", "vault"), mv("p7", "vault"), mv("p8", "rooftop")];
  const loud = [
    mv("p0", "lobby", 0, { ability: { kind: "blackmail", target: "p5", role: "rookie" } }),
    mv("p1", "lobby", 0, { ability: { kind: "forge", target: "p8", room: "office" } }),
    mv("p2", "lobby", 0, { ability: { kind: "embezzle" } }),
    mv("p3", "lobby", 0, { ability: { kind: "tipOff" } }),
    mv("p4", "lobby", 0, { ability: { kind: "loopCameras", room: "office" } }),
    mv("p5", "lobby"),
    watch("p6", "vault"),
    mv("p7", "vault"),
    mv("p8", "rooftop"),
  ];
  // The Embezzler's take and the tip-off are meant to show only inside the public Haul and Heat numbers.
  const strip = (s: GameState, id: string) => JSON.stringify(viewFor(s, id), (k, v) => (["haul", "haulDelta", "heat", "heatDelta"].includes(k) ? "#" : v));

  it("an uninvolved crew player (and the Security watcher of another room) see exactly the same game", () => {
    const a = run(base, ...quiet, ROUND);
    const b = run(base, ...loud, ROUND);
    // Every power really fired.
    expect(ofType(since(base, b), "abilityResolved").map((e) => e.ability.kind).sort()).toEqual(["blackmail", "embezzle", "forge", "loopCameras", "tipOff"]);
    expect(b.haul).toBeLessThan(a.haul);
    for (const id of ["p6", "p7", "p8"]) expect(strip(b, id), id).toBe(strip(a, id));
  });

  it("the victim gains only an anonymous voteCompromised; the planted player's own view doesn't change", () => {
    const a = run(base, ...quiet, ROUND);
    const b = run(base, ...loud, ROUND);
    const extra = viewFor(b, "p5").caseFile.filter((e) => !viewFor(a, "p5").caseFile.some((x) => JSON.stringify(x.event) === JSON.stringify(e.event)));
    expect(extra.map((e) => e.event)).toEqual([{ type: "voteCompromised", visibility: { kind: "private", player: "p5" }, player: "p5", round: 1 }]);
    expect(JSON.stringify(viewFor(b, "p5"))).not.toMatch(/blackmail|forg|embezzl|tipOff/i);
  });

  it("same seed + same commands → identical event log (determinism)", () => {
    expect(run(base, ...loud, ROUND).log).toEqual(run(base, ...loud, ROUND).log);
  });
});
