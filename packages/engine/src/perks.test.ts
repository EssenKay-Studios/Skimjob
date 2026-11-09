// Perks and the black market: the shop deal, buying with coins from your
// stash, each perk's effect, and Bail's choice when a shakedown passes.
// design §7.6, §7.7, §9.6, §9.7, §12, §18
import { describe, expect, it } from "vitest";
import { PERKS, PERK_IDS, type PerkId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { PUBLIC, privateTo } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { opensShakedownWindow } from "./meeting";
import { viewFor } from "./view";
import { fullGrab } from "./grab.testkit";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "perks-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  };
}

/** A new game, every seat a Lookout (its power acts only when used), with `shop` as its black market. */
function game(players = 3, extra: Partial<GameConfig> = {}, shop: readonly PerkId[] = PERK_IDS): GameState {
  const cfg = config(players, extra);
  return replay(
    cfg,
    setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "lookout" } : e.type === "shopDealt" ? { ...e, perks: shop } : e)),
  );
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    // A step may be several commands, worked out from the state as it reaches them.
    if (Array.isArray(command)) return run(s, ...(command as Cmd[]));
    const r = handleCommand(s, command);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const before = JSON.stringify(state);
  const r = handleCommand(state, command);
  if (r.ok) throw new Error(`expected a rejection of ${JSON.stringify(command)}`);
  expect(JSON.stringify(state)).toBe(before);
  return r.reason;
}
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const withStash = (s: GameState, id: string, stash: number): GameState => ({ ...s, players: { ...s.players, [id]: { ...(s.players[id] as PlayerState), stash } } });
const player = (s: GameState, id: string): PlayerState => s.players[id] as PlayerState;

const buy = (p: string, perk: unknown) => ({ type: "buyPerk", player: p, perk });
const mv = (p: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player: p, move: { ...fullGrab(room, pocket), ...extra } });
const watch = (p: string, room: string) => mv(p, "security", 0, { watch: room });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const RESULT = (s: GameState) => ({ type: "advance", deadline: { kind: "result", round: s.resolvedRound } });
/** The round being planned resolves and nobody calls an emergency: the next round is being planned. */
const NEXT = [ROUND, RESULT];
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
const vote = (p: string, target: string) => ({ type: "castVote", player: p, vote: { kind: "shakedown", target } });
/** The round being planned resolves and, in its result window, `by` calls the crew's emergency, which opens at once. design §9.3 */
const emergency = (by: string): Cmd[] => [
  ROUND,
  { type: "callEmergency", player: by },
  (s: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.pendingEmergency?.meetingId } }),
];

describe("the black market — design §12", () => {
  const shops = Array.from({ length: 60 }, (_, i) => ofType(setupEvents(config(3, { seed: `shop-${i}` })), "shopDealt")[0]?.perks ?? []);

  it("deals one perk per tier with the game's seed, public at setup; every perk can be dealt", () => {
    for (const shop of shops) expect(shop.map((p) => PERKS[p].tier)).toEqual([1, 2, 3]);
    expect(new Set(shops.flat())).toEqual(new Set(PERK_IDS));
    expect(ofType(setupEvents(config(3, { seed: "shop-7" })), "shopDealt")).toEqual([{ type: "shopDealt", visibility: PUBLIC, perks: shops[7] }]);
  });

  it("costs come from content (1, 2 or 3 coins by tier) and can be overridden; every view shows them", () => {
    expect(viewFor(game(), "p1").shop).toEqual(PERK_IDS.map((perk) => ({ perk, cost: PERKS[perk].tier })));
    const cheap = withStash(game(3, { contentOverrides: { perks: { bail: { cost: 1 } } } }), "p0", 1);
    expect(viewFor(cheap, "p0").shop.find((o) => o.perk === "bail")?.cost).toBe(1);
    expect(ofType(since(cheap, run(cheap, buy("p0", { kind: "bail" }), ROUND)), "perkSold")[0]?.cost).toBe(1);
  });
});

describe("buying a perk — design §7.6, §7.7, §12", () => {
  // Round 1: p0 pockets the Vault's 3 (no raid: 3 of the bell's 4 bulbs), p1 and p2 hand in a Lobby coin each.
  const rich = () => run(game(3, { contentOverrides: { roundCap: 2 } }), mv("p0", "vault", 3), mv("p1", "lobby"), mv("p2", "lobby"), ...NEXT);

  it("the coins leave the buyer's stash and the game; logged without a name as planning closes; who bought it opens at the reveal", () => {
    const s = rich();
    expect(player(s, "p0").stash).toBe(3);
    const after = run(s, buy("p0", { kind: "softShoes" }));
    expect(since(s, after)).toEqual([{ type: "perkBought", visibility: privateTo("p0"), player: "p0", round: 2, perk: { kind: "softShoes" }, cost: 2 }]);
    expect([player(after, "p0").stash, after.spent]).toEqual([1, 2]);
    // Buying doesn't change the duffel or honesty, or anyone else's view.
    expect([after.kitty, after.setAside, after.reached, after.share]).toEqual([s.kitty, s.setAside, s.reached, s.share]);
    expect(viewFor(after, "p1")).toEqual(viewFor(s, "p1"));
    // Planning closes: the notice is the round's first event.
    const ended = run(after, mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "lobby"), ROUND);
    expect(since(run(after, mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "lobby")), ended)[0]).toEqual({ type: "perkSold", visibility: PUBLIC, round: 2, perk: "softShoes", cost: 2 });
    // The reveal: the buyer, and the stash over time less the coins spent.
    expect(ended.phase.kind).toBe("ended");
    const reveal = viewFor(ended, "p1").reveal;
    expect(reveal?.log.some(({ event }) => event.type === "perkBought" && event.player === "p0")).toBe(true);
    expect(reveal?.summary.seats.find((x) => x.player === "p0")?.perksBought).toEqual(["softShoes"]);
    expect(reveal?.summary.rounds.find((r) => r.round === 2)?.stashes.p0).toBe(player(ended, "p0").stash);
  });

  it("leak: the order of public events can't tell who bought, or when; the notices come out together in the black market's order", () => {
    const seats = ["p0", "p1", "p2", "p3"];
    const start = seats.reduce((s, id) => withStash(s, id, 9), game(4));
    const ledger = (s: GameState) => viewFor(s, "p3").ledger.map(({ event }) => event);
    // Every seat locks in, in seat order; a buyer buys straight after its own lock-in (as a bot does).
    const play = (purchases: [string, unknown][]) => {
      const planned = run(start, ...seats.flatMap((id) => [mv(id, "lobby"), ...purchases.filter(([b]) => b === id).map(([b, perk]) => buy(b, perk))]));
      expect(ledger(planned)).toEqual(ledger(run(start, ...seats.map((id) => mv(id, "lobby")))));
      return ledger(run(planned, ROUND));
    };
    const tail = { kind: "tail", room: "vault" };
    const alibi = { kind: "alibi" };
    const seen = play([["p0", alibi], ["p1", tail]]);
    expect(play([["p1", alibi], ["p0", tail]])).toEqual(seen);
    expect(play([["p2", tail], ["p0", alibi]])).toEqual(seen);
    expect(ofType(seen, "perkSold").map((e) => e.perk)).toEqual(["tail", "alibi"]);
  });

  it("one perk per player per round, bought while planning; refused outside planning", () => {
    let s = withStash(game(), "p0", 9);
    s = run(s, buy("p0", { kind: "tail", room: "vault" }));
    expect(reason(s, buy("p0", { kind: "softShoes" }))).toBe("you have already bought a perk this round");
    expect(handleCommand(withStash(s, "p1", 1), buy("p1", { kind: "alibi" })).ok).toBe(true);
    s = run(s, ROUND);
    expect(reason(s, buy("p0", { kind: "softShoes" }))).toBe("perks are bought while a round is being planned");
    s = run(s, RESULT);
    expect(handleCommand(s, buy("p0", { kind: "softShoes" })).ok).toBe(true);
  });

  it("paid from the stash as it stood at the start of the round: this round's pocket can't pay", () => {
    const s = run(game(), mv("p0", "vault", 3));
    expect(reason(s, buy("p0", { kind: "tail", room: "vault" }))).toBe("Tail costs 1 coin; your stash holds 0");
    expect(reason(withStash(s, "p0", 2), buy("p0", { kind: "bail" }))).toBe("Bail costs 3 coins; your stash holds 2");
  });

  it("only this game's perks, aimed at a room in play or another player; Check ballot not in Open mode", () => {
    const s = withStash(game(3, {}, ["tail", "blackout", "plantEvidence"]), "p0", 9);
    expect(reason(s, buy("p0", { kind: "bail" }))).toBe("perk bail is not on this game's black market");
    expect(reason(s, buy("p0", { kind: "jetpack" }))).toMatch(/not on this game's black market/);
    expect(reason(s, buy("p0", "tail"))).toBe("perk must be an object with a kind");
    // Rooms in play at 3 players (design §3.1): no Manager's office.
    expect(reason(s, buy("p0", { kind: "tail", room: "managersOffice" }))).toBe("tail a room in play");
    expect(reason(s, buy("p0", { kind: "blackout", room: "moon" }))).toBe("black out a room in play");
    expect(reason(s, buy("p0", { kind: "plantEvidence", target: "p0", room: "vault" }))).toBe("pick another player");
    expect(reason(s, buy("p0", { kind: "plantEvidence", target: "p9", room: "vault" }))).toBe("unknown player p9");
    expect(reason(s, buy("p0", { kind: "plantEvidence", target: "p1", room: "moon" }))).toBe("plant evidence in a room in play");
    const ballots = (voteVisibility: GameConfig["voteVisibility"]) => withStash(game(3, { voteVisibility }, ["ballot", "softShoes", "bail"]), "p0", 9);
    expect(reason(ballots("hiddenThenRevealed"), buy("p0", { kind: "ballot", target: "p0" }))).toBe("pick another player");
    expect(reason(ballots("open"), buy("p0", { kind: "ballot", target: "p1" }))).toBe("ballots are already public in this game");
    expect(handleCommand(ballots("secret"), buy("p0", { kind: "ballot", target: "p1" })).ok).toBe(true);
  });
});

describe("Tail: next round, also see who was in one more room — design §12", () => {
  it("watches the room as the next round resolves, like the Lookout; nothing this round", () => {
    let s = run(withStash(game(), "p0", 1), buy("p0", { kind: "tail", room: "vault" }));
    let before = s;
    s = run(s, mv("p0", "lobby"), mv("p1", "office"), mv("p2", "lobby"), ...NEXT);
    expect(ofType(since(before, s), "roomWatched")).toEqual([]);
    before = s;
    s = run(s, mv("p0", "lobby"), mv("p1", "vault"), mv("p2", "office"), ROUND);
    expect(ofType(since(before, s), "roomWatched")).toEqual([
      { type: "roomWatched", visibility: privateTo("p0"), player: "p0", round: 2, source: "tail", room: "vault", seen: ["p1"], offline: false },
    ]);
  });
});

describe("Stamped alibi: a true alibi for this round is stamped \"verified\" — design §12", () => {
  const posted = (buyer: string | null, alibi: string): GameEvent[] => {
    let s = withStash(game(), "p0", 1);
    if (buyer) s = run(s, buy(buyer, { kind: "alibi" }));
    s = run(s, mv("p0", "office"), mv("p1", "lobby"), mv("p2", "lobby"), ROUND);
    return since(s, run(s, { type: "postAlibi", player: "p0", round: 1, room: alibi }));
  };

  it("only if the alibi is true and the poster bought one that round; the stamp is public", () => {
    expect(posted("p0", "office")).toEqual([
      { type: "said", visibility: PUBLIC, statement: { kind: "alibi", player: "p0", round: 1, room: "office" } },
      { type: "alibiVerified", visibility: PUBLIC, player: "p0", round: 1, room: "office" },
    ]);
    expect(posted("p0", "lobby").map((e) => e.type)).toEqual(["said"]);
    expect(posted(null, "office").map((e) => e.type)).toEqual(["said"]);
  });
});

describe("Check ballot: see one player's vote at the next meeting — design §9.5, §12", () => {
  it("the buyer alone sees the target's live ballot in the next meeting, also in Secret mode; then it is used up", () => {
    let s = run(withStash(game(3, { voteVisibility: "secret" }), "p0", 1), buy("p0", { kind: "ballot", target: "p1" }), mv("p1", "vault", 3));
    s = run(s, ...emergency("p2"));
    expect(viewFor(s, "p0").me.seenBallots).toEqual({ p1: null });
    s = run(s, vote("p1", "p2"));
    expect(viewFor(s, "p0").me.seenBallots).toEqual({ p1: { kind: "shakedown", target: "p2" } });
    expect(viewFor(s, "p2").me.seenBallots).toEqual({});
    expect(JSON.stringify(viewFor(s, "p2"))).not.toContain('"target":"p2"');
    s = run(s, CLOSE);
    expect(viewFor(s, "p0").me.seenBallots).toEqual({});
    expect([s.ballotChecks, s.meeting]).toEqual([[], null]);
  });
});

describe("Soft shoes: next round, your coins don't ring at all — design §5.2, §12", () => {
  it("the buyer's grab rings nothing the round after; everyone else's still rings", () => {
    let s = run(withStash(game(), "p0", 2), buy("p0", { kind: "softShoes" }), mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "lobby"), ...NEXT);
    const before = s;
    // 3 + 3 rings would raid the Vault (4 bulbs); the buyer's 3 are silent.
    s = run(s, mv("p0", "vault"), mv("p1", "vault"), mv("p2", "lobby"), ROUND);
    expect(ofType(since(before, s), "bellsRung")[0]?.bells.vault).toBe(3);
    expect(ofType(since(before, s), "roomRaided")).toEqual([]);
  });
});

describe("Blackout: next round, one room goes dark, announced like a power cut — design §11.1, §12", () => {
  it("announced as the next round starts, with no source; no sightings or cameras there; its bell still rings", () => {
    let s = run(withStash(game(4), "p0", 2), buy("p0", { kind: "blackout", room: "office" }));
    expect(s.dark).toEqual([]);
    s = run(s, mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "lobby"), mv("p3", "lobby"), ...NEXT);
    expect(ofType(s.log, "powerCut")).toEqual([{ type: "powerCut", visibility: PUBLIC, round: 2, room: "office" }]);
    expect(viewFor(s, "p1").dark).toEqual(["office"]);
    const before = s;
    s = run(s, watch("p0", "office"), mv("p1", "office"), mv("p2", "office"), mv("p3", "lobby"), ROUND);
    const events = since(before, s);
    expect(ofType(events, "roomSighting").filter((e) => e.room === "office").map((e) => e.others)).toEqual([[], []]);
    expect(ofType(events, "roomWatched").map((e) => [e.seen, e.offline])).toEqual([[[], true]]);
    expect(ofType(events, "bellsRung")[0]?.bells.office).toBe(2);
  });

  it("leak: a round's cuts are announced in the game's room order, whatever their source (perk or Electrician) or the order bought — design §11.1, §12, §18", () => {
    // p3 is the Electrician; p0 and p1 can afford a Blackout.
    const cfg = config(4);
    const dealt = replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: e.player === "p3" ? "electrician" : "lookout" } : e.type === "shopDealt" ? { ...e, perks: PERK_IDS } : e)));
    const start = withStash(withStash(dealt, "p0", 9), "p1", 9);
    const cut = (room: string) => mv("p3", "lobby", 0, { ability: { kind: "blackout", room } });
    // The bystander p2's ledger once round 2 has started.
    const ledger = (...commands: Cmd[]) => viewFor(run(start, ...commands, mv("p2", "lobby"), ...NEXT), "p2").ledger.map(({ event }) => event);
    const ordered = start.rooms.filter((r) => r === "office" || r === "vault");
    const bought = ledger(buy("p0", { kind: "blackout", room: "office" }), mv("p0", "lobby"), buy("p1", { kind: "blackout", room: "vault" }), mv("p1", "lobby"), mv("p3", "lobby"));
    expect(ofType(bought, "powerCut").map((e) => e.room)).toEqual(ordered);
    // The same lock-ins; the purchases the other way round (rooms swapped between buyers, bought in the opposite order).
    expect(ledger(buy("p1", { kind: "blackout", room: "office" }), mv("p0", "lobby"), buy("p0", { kind: "blackout", room: "vault" }), mv("p1", "lobby"), mv("p3", "lobby"))).toEqual(bought);
    // A perk's cut and the Electrician's: the same announcements whichever room each one cut.
    const mixed = ledger(buy("p0", { kind: "blackout", room: "office" }), mv("p0", "lobby"), mv("p1", "lobby"), cut("vault"));
    expect(ofType(mixed, "powerCut").map((e) => e.room)).toEqual(ordered);
    expect(ledger(buy("p0", { kind: "blackout", room: "vault" }), mv("p0", "lobby"), mv("p1", "lobby"), cut("office"))).toEqual(mixed);
  });
});

describe("Plant evidence: one player appears in one room's feeds this round — design §3.4, §12", () => {
  it("in the room's camera and Lookout feeds, in seat order; still in their real room; not in room-mates' sightings; this round only", () => {
    let s = run(withStash(game(4), "p0", 3), buy("p0", { kind: "plantEvidence", target: "p1", room: "vault" }));
    const before = s;
    s = run(
      s,
      mv("p0", "lobby", 0, { ability: { kind: "lookout", rooms: ["vault"] } }),
      mv("p1", "lobby"),
      watch("p2", "vault"),
      mv("p3", "vault"),
      ROUND,
    );
    const events = since(before, s);
    expect(ofType(events, "roomWatched").map((e) => [e.player, e.source, e.seen])).toEqual([
      ["p0", "lookout", ["p1", "p3"]],
      ["p2", "security", ["p1", "p3"]],
    ]);
    expect(ofType(events, "roomSighting").map((e) => [e.player, e.room, e.others])).toEqual([
      ["p0", "lobby", ["p1"]],
      ["p1", "lobby", ["p0"]],
      ["p2", "security", []],
      ["p3", "vault", []],
    ]);
    // The next round, the feed shows only who was there.
    s = run(s, RESULT, mv("p0", "lobby"), mv("p1", "lobby"), watch("p2", "vault"), mv("p3", "vault"), ROUND);
    expect(ofType(s.log, "roomWatched").at(-1)?.seen).toEqual(["p3"]);
  });

  it("a player planted on their own watch doesn't see themselves", () => {
    const s = run(withStash(game(4), "p0", 3), buy("p0", { kind: "plantEvidence", target: "p2", room: "vault" }));
    const after = run(s, mv("p0", "lobby"), mv("p1", "lobby"), watch("p2", "vault"), mv("p3", "vault"), ROUND);
    expect(ofType(since(s, after), "roomWatched").map((e) => e.seen)).toEqual([["p3"]]);
  });
});

describe("Bail: held until a shakedown passes, then a private choice — design §9.6, §9.7, §12", () => {
  /** p1 pockets the Vault's 3 in round 1 (holding Bail if `bail`), then p0 and p2 vote p1 down in an emergency. */
  const passed = (bail: boolean, shop: readonly PerkId[] = ["tail", "softShoes", "bail"]) => {
    let s = withStash(game(3, {}, shop), "p1", 3);
    if (bail) s = run(s, buy("p1", { kind: "bail" }));
    s = run(s, mv("p1", "vault", 3), ...emergency("p2"));
    return run(s, vote("p0", "p1"), vote("p2", "p1"), CLOSE);
  };

  it("one Bail at a time, held in your own view only; a Bail bought changes no one else's view", () => {
    const s = run(withStash(game(), "p1", 6), buy("p1", { kind: "bail" }));
    expect(player(s, "p1").roleState.bail).toBe(true);
    expect(viewFor(s, "p1").me.roleState.bail).toBe(true);
    const next = run(s, ...NEXT);
    expect(reason(next, buy("p1", { kind: "bail" }))).toBe("you already hold a Bail");
    // Who bought it is hidden: p0 sees the same whether p1 or p2 did.
    const other = run(withStash(game(), "p2", 6), buy("p2", { kind: "bail" }));
    expect(viewFor(s, "p0")).toEqual(viewFor(other, "p0"));
  });

  it("the window opens after every passed shakedown when Bail is in the shop, holder or not; without it, the stash opens at once", () => {
    expect(opensShakedownWindow(["tail", "softShoes", "plantEvidence"])).toBe(false);
    expect(opensShakedownWindow(["tail", "softShoes", "bail"])).toBe(true);
    for (const bail of [true, false]) {
      const s = passed(bail);
      expect(s.phase).toEqual({ kind: "shakedownPending", meetingId: "emergency-1", target: "p1" });
      expect(s.log.at(-1)).toEqual({ type: "shakedownPending", visibility: PUBLIC, meetingId: "emergency-1", kind: "emergency", target: "p1" });
    }
    // Every other view is the same whether the target holds a Bail or not (the purchase itself aside).
    const strip = (s: GameState) => {
      const v = viewFor(s, "p0");
      return { ...v, ledger: v.ledger.filter(({ event }) => event.type !== "perkSold").map(({ event }) => event), caseFile: v.caseFile.map(({ event }) => event) };
    };
    expect(strip(passed(true))).toEqual(strip(passed(false)));
    const plain = passed(false, ["tail", "softShoes", "plantEvidence"]);
    expect(plain.log.some((e) => e.type === "shakedownPending")).toBe(false);
    expect(player(plain, "p1").stash).toBe(plain.share);
  });

  it("used: the shakedown falls through, the stash stays closed, the Bail is spent and the target is protected", () => {
    const s = run(passed(true), { type: "chooseBail", player: "p1", use: true });
    expect(s.log.at(-1)).toEqual({ type: "bailChosen", visibility: privateTo("p1"), player: "p1", meetingId: "emergency-1", use: true });
    const after = run(s, RESOLVE);
    expect(since(s, after).map((e) => e.type)).toEqual(["shakedownCancelled", "roundStarted"]);
    expect(ofType(after.log, "shakedownCancelled")).toEqual([{ type: "shakedownCancelled", visibility: PUBLIC, meetingId: "emergency-1", target: "p1" }]);
    expect([player(after, "p1").stash, player(after, "p1").roleState.bail, after.protected]).toEqual([3 + after.share, false, ["p1"]]);
    expect(JSON.stringify(viewFor(after, "p0"))).not.toContain("bailChosen");
  });

  it("no answer, or don't use: the stash opens as normal and the Bail is kept; the latest choice counts", () => {
    for (const choices of [[], [false], [true, false]]) {
      let s = passed(true);
      for (const use of choices) s = run(s, { type: "chooseBail", player: "p1", use });
      s = run(s, RESOLVE);
      expect(ofType(s.log, "shakedownResolved")[0]).toMatchObject({ target: "p1", taken: 3, clean: false });
      expect([player(s, "p1").roleState.bail, s.protected]).toEqual([true, ["p1"]]);
    }
  });

  it("only the target, holding a Bail, chooses, and only while the window is open", () => {
    const s = passed(true);
    expect(reason(s, { type: "chooseBail", player: "p0", use: true })).toBe("only the shakedown's target can use Bail");
    expect(reason(s, { type: "chooseBail", player: "p1", use: "yes" })).toBe("use must be true or false");
    expect(reason(passed(false), { type: "chooseBail", player: "p1", use: true })).toBe("you hold no Bail");
    expect(reason(run(s, RESOLVE), { type: "chooseBail", player: "p1", use: true })).toBe("no shakedown is waiting for a Bail choice");
  });

  it("after a regular meeting the result window follows once the window ends (design §9.3)", () => {
    let s = run(game(3, {}, ["tail", "softShoes", "bail"]), mv("p1", "vault", 3), ...NEXT);
    while (s.phase.kind === "planning") s = run(s, mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "lobby"), ROUND, (x: GameState) => (x.phase.kind === "result" ? RESULT(x) : []));
    expect(s.phase.kind).toBe("awaitingMeeting");
    const meetingId = s.phase.kind === "awaitingMeeting" ? s.phase.meetingId : "";
    const round = s.resolvedRound;
    s = run(s, { type: "scheduleMeeting", meetingId, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId } }, vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(s.phase.kind).toBe("shakedownPending");
    const after = run(s, RESOLVE);
    expect(since(s, after).map((e) => e.type)).toEqual(["shakedownResolved"]);
    expect(after.phase).toEqual({ kind: "result", round });
  });

  it("while the window is open: no rounds, no purchases, no new meetings, and only the pending meeting's deadline", () => {
    const s = passed(false);
    expect(reason(s, ROUND(s))).toMatch(/no round deadline/);
    expect(reason(s, mv("p0", "lobby"))).toMatch(/round is being planned/);
    expect(reason(s, buy("p1", { kind: "tail", room: "vault" }))).toBe("perks are bought while a round is being planned");
    expect(reason(s, { type: "callEmergency", player: "p0" })).toMatch(/between a round's result and the next planning/);
    expect(reason(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "meeting-1" } })).toMatch(/no shakedown is pending/);
    expect(reason(s, CLOSE(s))).toMatch(/not open/);
  });
});
