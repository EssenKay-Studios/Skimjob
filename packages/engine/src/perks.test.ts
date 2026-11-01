// Perks: tokens, spending with useAbility, and each perk's effect.
// design §8.3 (role deck v2 §1, docs/roles-v2.md). Tokens come from the
// test-only `grantPerks` hook until R2/R3 wire the role triggers.
import { describe, expect, it } from "vitest";
import { EVENT_DECK, PERK_RULES, ROLES, type PerkId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { PUBLIC, privateTo } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { opensShakedownWindow } from "./meeting";
import { grantPerks } from "./perks.testkit";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "perk-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: ["rookie", "lookout", "fence", "hacker"], // no Muscle: no shakedown window
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    ...extra,
  };
}

/** A new game with chosen roles (seat i gets roles[i], Rookie if missing). */
function game(players: number, roles: string[] = [], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  const log = setupEvents(cfg).map((e, i, all): GameEvent => {
    if (e.type !== "roleDealt") return e;
    const seat = all.slice(0, i).filter((x) => x.type === "roleDealt").length;
    return { ...e, role: roles[seat] ?? "rookie" };
  });
  return replay(cfg, log);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    const r = handleCommand(s, command);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const r = handleCommand(state, command);
  if (r.ok) throw new Error(`expected a rejection of ${JSON.stringify(command)}`);
  return r.reason;
}
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const use = (player: string, ability: object) => ({ type: "useAbility", player, ability });
const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const ALIBIS = (s: GameState) => ({ type: "advance", deadline: { kind: "alibis", round: s.resolvedRound } });
const emergency = (by: string) => [{ type: "callEmergency", player: by }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `emergency-${by}` } }];
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target ? { kind: "shakedown", target } : { kind: "skip" } });
const perks = (s: GameState, id: string): readonly PerkId[] => (s.players[id] as PlayerState).roleState.perks;
const withStash = (s: GameState, id: string, stash: number): GameState => ({ ...s, players: { ...s.players, [id]: { ...(s.players[id] as PlayerState), stash } } });

describe("perk tokens — design §8.3", () => {
  it("perkGranted is private; your view shows your own perks only, and nobody else's view changes", () => {
    const s = game(4);
    const granted = grantPerks(s, "p0", "peek", "shield", "peek");
    expect(since(s, granted)).toEqual([
      { type: "perkGranted", visibility: privateTo("p0"), player: "p0", perk: "peek" },
      { type: "perkGranted", visibility: privateTo("p0"), player: "p0", perk: "shield" },
      { type: "perkGranted", visibility: privateTo("p0"), player: "p0", perk: "peek" },
    ]);
    expect(viewFor(granted, "p0").me.roleState.perks).toEqual(["peek", "shield", "peek"]);
    for (const other of ["p1", "p2", "p3"]) expect(JSON.stringify(viewFor(granted, other))).toBe(JSON.stringify(viewFor(s, other)));
  });

  it("spending needs a token; a refusal keeps it and writes nothing; one token goes per spend", () => {
    let s = game(4, ["rookie", "lookout", "fence"]);
    expect(reason(s, use("p0", { kind: "peek", target: "p1" }))).toMatch(/no Peek perk/);
    s = grantPerks(s, "p0", "peek", "peek");
    expect(reason(s, use("p0", { kind: "peek", target: "p0" }))).toMatch(/another player/);
    expect(reason(s, use("p0", { kind: "peek", target: "nobody" }))).toMatch(/unknown player/);
    expect(reason(s, use("p0", { kind: "shield" }))).toMatch(/by itself/);
    expect(reason(s, use("p0", { kind: "wish" }))).toMatch(/no wish ability|unknown perk/);
    expect(perks(s, "p0")).toEqual(["peek", "peek"]);
    s = run(s, use("p0", { kind: "peek", target: "p1" }));
    expect(perks(s, "p0")).toEqual(["peek"]);
  });

  it("the log replays to the same state (event-sourced, design §17.2)", () => {
    let s = grantPerks(game(4, [], { eventsEnabled: true }), "p0", "peek", "tail", "rig");
    s = run(s, use("p0", { kind: "peek", target: "p2" }), use("p0", { kind: "tail", room: "vault" }), use("p0", { kind: "rig" }));
    expect(replay(s.config, s.log)).toEqual(s);
  });
});

describe("Peek — design §8.3", () => {
  it("learn one player's role, privately", () => {
    const s = grantPerks(game(4, ["rookie", "lookout", "fence"]), "p0", "peek");
    const after = run(s, use("p0", { kind: "peek", target: "p2" }));
    expect(since(s, after)).toEqual([{ type: "perkUsed", visibility: privateTo("p0"), player: "p0", round: 1, perk: { kind: "peek", target: "p2", role: "fence" } }]);
  });
});

describe("Shield — design §8.3, §11.3", () => {
  const shakedownOfP0 = (s: GameState): GameState => run(s, ...emergency("p1"), vote("p1", "p0"), vote("p2", "p0"), vote("p3", "p0"), CLOSE);

  it("cancels the next passed shakedown of its holder by itself: private perkUsed, public cancel, stash kept", () => {
    const s = grantPerks(withStash(game(4), "p0", 6), "p0", "shield");
    const after = shakedownOfP0(s);
    const events = since(s, after);
    expect(events).toContainEqual({ type: "perkUsed", visibility: privateTo("p0"), player: "p0", round: 1, perk: { kind: "shield", meetingId: "emergency-p1" } });
    expect(events).toContainEqual({ type: "shakedownCancelled", visibility: PUBLIC, meetingId: "emergency-p1", target: "p0" });
    expect(events.some((e) => e.type === "shakedownResolved")).toBe(false);
    expect(after.players.p0).toMatchObject({ stash: 6, timesShakenDown: 0 });
    expect(perks(after, "p0")).toEqual([]);
    // Spent: the next one goes through.
    const again = run(after, ...emergency("p2"), vote("p1", "p0"), vote("p2", "p0"), vote("p3", "p0"), CLOSE);
    expect(since(after, again).some((e) => e.type === "shakedownResolved")).toBe(true);
  });

  it("with a shakedown window, it applies when the window ends; a Muscle cancel first keeps the Shield", () => {
    const pool = ["rookie", "muscle", "fixer"]; // the Fixer (a Shield earner) opens the window below 5 players, where no Muscle is dealt
    const s = grantPerks(withStash(game(4, ["rookie", "muscle"], { rolePool: pool }), "p0", 6), "p0", "shield");
    const pending = run(s, ...emergency("p2"), vote("p1", "p0"), vote("p2", "p0"), vote("p3", "p0"), CLOSE);
    expect(pending.phase.kind).toBe("shakedownPending");
    expect(perks(pending, "p0")).toEqual(["shield"]); // nothing shown before the window ends
    const shielded = run(pending, RESOLVE);
    expect(since(pending, shielded).map((e) => e.type)).toEqual(["perkUsed", "shakedownCancelled"]);
    const muscled = run(pending, use("p1", { kind: "cancelShakedown" }), RESOLVE);
    expect(perks(muscled, "p0")).toEqual(["shield"]);
    expect(since(pending, muscled).filter((e) => e.type === "perkUsed")).toEqual([]);
  });

  it("the window opens whenever a Muscle or any role that can earn a Shield could be dealt (role deck v2 §1)", () => {
    const shieldEarner = { ...ROLES.rookie, id: "detective", rewards: [{ on: "checkedShakenDirty", perk: "shield", count: 1 }] } as (typeof ROLES)[string];
    const roles = { ...ROLES, detective: shieldEarner };
    expect(opensShakedownWindow(roles, ["rookie", "lookout"])).toBe(false);
    expect(opensShakedownWindow(roles, ["rookie", "muscle"])).toBe(true);
    expect(opensShakedownWindow(roles, ["rookie", "detective"])).toBe(true);
    const noShield = { ...roles, detective: { ...shieldEarner, rewards: [{ on: "checkedShakenDirty", perk: "peek", count: 1 }] } } as typeof roles;
    expect(opensShakedownWindow(noShield, ["detective"])).toBe(false);
  });
});

describe("+Vote — design §8.3, §11.2", () => {
  it("adds 1 to your ballot's weight in the open meeting; the public tally still counts ballots", () => {
    const base = run(grantPerks(game(5), "p0", "extraVote"), ...emergency("p0"));
    const votes = [vote("p0", "p4"), vote("p1", "p4"), vote("p2", null), vote("p3", null)];
    const plain = run(base, ...votes, CLOSE);
    expect(plain.log.find((e) => e.type === "meetingClosed")).toMatchObject({ result: { kind: "noMajority" } });
    const boosted = run(base, use("p0", { kind: "extraVote" }), ...votes, CLOSE);
    expect(boosted.log.find((e) => e.type === "meetingClosed")).toMatchObject({
      tally: { skip: 2, targets: { p4: 2 } },
      result: { kind: "shakedown", target: "p4" },
    });
    expect(PERK_RULES.extraVoteWeight).toBe(1);
  });

  it("only while a meeting is open, once per meeting", () => {
    const s = grantPerks(game(5), "p0", "extraVote", "extraVote");
    expect(reason(s, use("p0", { kind: "extraVote" }))).toMatch(/meeting is open/);
    const open = run(s, ...emergency("p1"), use("p0", { kind: "extraVote" }));
    expect(reason(open, use("p0", { kind: "extraVote" }))).toMatch(/already/);
  });
});

describe("Ballot — design §8.3, §11.2", () => {
  it.each(["hiddenThenRevealed", "secret"] as const)("%s votes: the holder sees one ballot live, nobody else does", (mode) => {
    const s = run(grantPerks(game(4, [], { voteVisibility: mode }), "p0", "ballot", "ballot"), ...emergency("p0"), vote("p1", "p2"));
    const seen = run(s, use("p0", { kind: "ballot", target: "p1" }));
    const spent = since(s, seen);
    // The spend names the target only: the ballot itself is never in an event.
    expect(spent).toEqual([{ type: "perkUsed", visibility: privateTo("p0"), player: "p0", round: 1, perk: { kind: "ballot", meetingId: "emergency-p0", target: "p1" } }]);
    expect(viewFor(seen, "p0").me.seenBallots).toEqual({ p1: { kind: "shakedown", target: "p2" } });
    for (const other of ["p1", "p2", "p3"]) expect(viewFor(seen, other).me.seenBallots).toEqual({});
    // Live: a changed ballot shows; a second Ballot on someone who hasn't voted shows null.
    const changed = run(seen, vote("p1", null), use("p0", { kind: "ballot", target: "p3" }));
    expect(viewFor(changed, "p0").me.seenBallots).toEqual({ p1: { kind: "skip" }, p3: null });
    expect(reason(changed, use("p0", { kind: "ballot", target: "p1" }))).toMatch(/no Ballot perk|already/);
    // Gone once the meeting closes.
    expect(viewFor(run(changed, CLOSE), "p0").me.seenBallots).toEqual({});
  });

  it("Secret mode is the one exception: the target's ballot reaches the holder's view and no one else's, ever (owner decision)", () => {
    let s = run(grantPerks(game(4, [], { voteVisibility: "secret" }), "p0", "ballot"), ...emergency("p0"), vote("p1", "p2"));
    s = run(s, use("p0", { kind: "ballot", target: "p1" }));
    // Nothing about p1's ballot is in p0's ledger or case file: only the live view has it.
    const p0 = viewFor(s, "p0");
    expect([...p0.ledger, ...p0.caseFile].some(({ event }) => (event.type === "voteCast" || event.type === "voteSealed") && event.player === "p1")).toBe(false);
    expect(p0.me.seenBallots).toEqual({ p1: { kind: "shakedown", target: "p2" } });
  });

  it("refused outside a meeting, in Open mode (ballots are public there), and on yourself", () => {
    const s = grantPerks(game(4), "p0", "ballot");
    expect(reason(s, use("p0", { kind: "ballot", target: "p1" }))).toMatch(/meeting is open/);
    expect(reason(run(s, ...emergency("p1")), use("p0", { kind: "ballot", target: "p0" }))).toMatch(/another player/);
    const open = run(grantPerks(game(4, [], { voteVisibility: "open" }), "p0", "ballot"), ...emergency("p1"));
    expect(reason(open, use("p0", { kind: "ballot", target: "p1" }))).toMatch(/already public/);
  });
});

describe("Tail — design §8.3", () => {
  it("while planning, also see who is in one more room when the round resolves; then it's gone", () => {
    const s = grantPerks(game(4), "p0", "tail", "tail");
    const tailed = run(s, use("p0", { kind: "tail", room: "vault" }));
    expect(reason(tailed, use("p0", { kind: "tail", room: "office" }))).toMatch(/already tailing/);
    expect(reason(s, use("p0", { kind: "tail", room: "attic" }))).toMatch(/room in play/);
    const resolved = run(tailed, mv("p0", "lobby"), mv("p1", "vault"), mv("p2", "vault"), mv("p3", "office"), ROUND);
    expect(since(tailed, resolved)).toContainEqual({ type: "roomWatched", visibility: privateTo("p0"), player: "p0", round: 1, source: "tail", room: "vault", seen: ["p1", "p2"] });
    expect(resolved.players.p0?.roleState.tail).toBeNull();
    // Not outside planning (the round's alibis are open now).
    expect(reason(resolved, use("p0", { kind: "tail", room: "vault" }))).toMatch(/being planned/);
  });

  it("a Power cut blinds it, as it does the Lookout (design §10)", () => {
    const s = grantPerks(game(4), "p0", "tail");
    const dark: GameState = { ...s, card: { round: 1, id: "powerCut", room: null, offer: null } };
    const resolved = run(dark, use("p0", { kind: "tail", room: "vault" }), mv("p1", "vault"), ROUND);
    expect(since(dark, resolved).some((e) => e.type === "roomWatched")).toBe(false);
  });
});

describe("Alibi — design §8.3, §5.4", () => {
  const afterRound1 = (): GameState =>
    run(grantPerks(grantPerks(game(4), "p0", "alibi", "alibi"), "p1", "alibi"), mv("p0", "office"), mv("p1", "lobby"), mv("p2", "vault"), mv("p3", "vault"), ROUND);

  it("stamps your true alibi for the last round as Verified, in public", () => {
    const s = run(afterRound1(), { type: "postAlibi", player: "p0", room: "office" });
    const after = run(s, use("p0", { kind: "alibi" }));
    expect(since(s, after)).toEqual([
      { type: "perkUsed", visibility: privateTo("p0"), player: "p0", round: 1, perk: { kind: "alibi", round: 1, room: "office" } },
      { type: "alibiVerified", visibility: PUBLIC, player: "p0", round: 1, room: "office" },
    ]);
    expect(viewFor(after, "p2").ledger.at(-1)?.event).toEqual({ type: "alibiVerified", visibility: PUBLIC, player: "p0", round: 1, room: "office" });
    expect(reason(after, use("p0", { kind: "alibi" }))).toMatch(/already verified/);
  });

  it("refused (token kept) for a false alibi or none; refused before any round has resolved", () => {
    const s = run(afterRound1(), { type: "postAlibi", player: "p1", room: "vault" });
    expect(reason(s, use("p1", { kind: "alibi" }))).toMatch(/isn't where you were/);
    expect(reason(s, use("p0", { kind: "alibi" }))).toMatch(/post your alibi/);
    expect(perks(s, "p1")).toEqual(["alibi"]);
    expect(reason(grantPerks(game(4), "p0", "alibi"), use("p0", { kind: "alibi" }))).toMatch(/no round/);
  });

  it("a stamp is for one round: the next round's alibi can be stamped again", () => {
    let s = run(afterRound1(), { type: "postAlibi", player: "p0", room: "office" }, use("p0", { kind: "alibi" }), ALIBIS);
    s = run(s, mv("p0", "vault"), ROUND, { type: "postAlibi", player: "p0", room: "vault" });
    expect(s.alibisVerified).toEqual([]);
    expect(since(s, run(s, use("p0", { kind: "alibi" }))).at(-1)).toMatchObject({ type: "alibiVerified", round: 2, room: "vault" });
  });
});

describe("Recharge — design §8.3", () => {
  it("gives a once-per-act power back (Hacker), and refuses when nothing is used", () => {
    let s = grantPerks(game(4, ["hacker"]), "p0", "recharge");
    expect(reason(s, use("p0", { kind: "recharge" }))).toMatch(/nothing to recharge/);
    s = run(s, mv("p0", "lobby", 0, { ability: { kind: "loopCameras", room: "vault" } }), ROUND, ALIBIS);
    expect(s.players.p0?.roleState.usedThisAct).toBe(1);
    s = run(s, use("p0", { kind: "recharge" }));
    expect(s.players.p0?.roleState.usedThisAct).toBe(0);
    s = run(s, mv("p0", "lobby", 0, { ability: { kind: "loopCameras", room: "office" } }));
    expect(s.moves.p0?.ability).toEqual({ kind: "loopCameras", room: "office" });
  });

  it("gives a once-per-game use back (Muscle)", () => {
    let s = grantPerks(game(4, ["muscle"], { rolePool: ["rookie", "muscle", "fixer"] }), "p0", "recharge");
    s = run(s, ...emergency("p1"), vote("p1", "p2"), vote("p2", "p3"), vote("p3", "p2"), CLOSE, use("p0", { kind: "cancelShakedown" }), RESOLVE);
    expect(s.players.p0?.roleState.usedThisGame).toBe(1);
    expect(run(s, use("p0", { kind: "recharge" })).players.p0?.roleState.usedThisGame).toBe(0);
  });
});

describe("Rig — design §8.3, §10", () => {
  it("someone else's Rig of the same round never refuses yours (no refusal tells you who holds what; PR #25 review): the oldest pick flips", () => {
    const s = grantPerks(rigged(), "p1", "rig");
    const first = spentRig(s);
    const both = run(s, use("p1", { kind: "rig" }));
    const second = since(s, both).find((e) => e.type === "perkUsed");
    expect(second).toMatchObject({ player: "p1", perk: { kind: "rig", round: 2 } });
    if (second?.type !== "perkUsed" || second.perk.kind !== "rig") throw new Error("no second Rig");
    const p1Pick = second.perk.cards.find((c) => c !== first.cards[0]) as string;
    const picked = run(both, use("p1", { kind: "rigPick", card: p1Pick }), use("p0", { kind: "rigPick", card: first.cards[1] }));
    expect(run(picked, ROUND, ALIBIS).card?.id).toBe(first.cards[1]);
  });

  const rigged = (): GameState => run(grantPerks(game(4, [], { eventsEnabled: true }), "p0", "rig", "rig"), use("p0", { kind: "rig" }));
  const toRound2 = (s: GameState): GameState => run(s, ROUND, ALIBIS);
  const spentRig = (s: GameState) => {
    const e = s.log.find((x) => x.type === "perkUsed" && x.perk.kind === "rig");
    if (e?.type !== "perkUsed" || e.perk.kind !== "rig") throw new Error("no Rig spent");
    return e.perk;
  };

  it("draws two different cards for the next round, privately; the first flips unless another is picked", () => {
    const s = rigged();
    const rig = spentRig(s);
    expect(rig.round).toBe(2);
    expect(rig.cards).toHaveLength(PERK_RULES.rigOptions);
    expect(new Set(rig.cards).size).toBe(2);
    for (const c of rig.cards) expect(EVENT_DECK).toContain(c);
    expect(viewFor(s, "p1").caseFile.some(({ event }) => event.type === "perkUsed")).toBe(false);
    expect(toRound2(s).card?.id).toBe(rig.cards[0]);
    const picked = run(s, use("p0", { kind: "rigPick", card: rig.cards[1] }));
    expect(since(s, picked)).toEqual([{ type: "rigPicked", visibility: privateTo("p0"), player: "p0", round: 2, card: rig.cards[1] }]);
    const next = toRound2(picked);
    expect(next.card?.id).toBe(rig.cards[1]);
    expect(next.rigs).toEqual([]);
  });

  it("refused: a card not drawn, someone else's pick, your own second Rig of a round, events off", () => {
    const s = grantPerks(rigged(), "p1", "rig");
    const other = EVENT_DECK.find((c) => !spentRig(s).cards.includes(c));
    expect(reason(s, use("p0", { kind: "rigPick", card: other }))).toMatch(/pick one of/);
    expect(reason(s, use("p1", { kind: "rigPick", card: spentRig(s).cards[0] }))).toMatch(/no rigged card/);
    expect(reason(s, use("p0", { kind: "rig" }))).toMatch(/you already rigged/);
    expect(reason(grantPerks(game(4), "p0", "rig"), use("p0", { kind: "rig" }))).toMatch(/no next event card/);
    // After round 2 starts, the next card (round 3) can be rigged again.
    const round2 = toRound2(run(grantPerks(s, "p1", "rig"), use("p1", { kind: "rig" })));
    expect(since(round2, run(round2, use("p1", { kind: "rig" }))).find((e) => e.type === "perkUsed")).toMatchObject({ perk: { kind: "rig", round: 3 } });
  });
});
