// QA (S3a.7, #94): adversarial tests for the black market and its perks: the
// shop, buying at its boundaries, each perk's timing, Check ballot in Open
// mode, Bail's private choice and protection, the Rig's removal next to
// S3a.8's redraw, determinism, and viewFor leaks. design §7.7, §9.5, §9.6, §9.7, §12, §13, §18
import { describe, expect, it } from "vitest";
import { PERKS, PERK_IDS, type PerkId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { fullGrab } from "./grab.testkit";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "qa-black-market",
    players: Array.from({ length: players }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      isBot: true,
    })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  };
}

/** Every seat a Lookout (acts only when used) unless `roles` says otherwise; `shop` is the black market. */
function game(
  players = 3,
  extra: Partial<GameConfig> = {},
  shop: readonly PerkId[] = PERK_IDS,
  roles: Record<string, string> = {},
): GameState {
  const cfg = config(players, extra);
  return replay(
    cfg,
    setupEvents(cfg).map((e): GameEvent =>
      e.type === "roleDealt"
        ? ({ ...e, role: roles[e.player] ?? "lookout" } as GameEvent)
        : e.type === "shopDealt"
          ? { ...e, perks: shop }
          : e,
    ),
  );
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    if (Array.isArray(command)) return run(s, ...(command as Cmd[]));
    const r = handleCommand(s, command);
    if (!r.ok)
      throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const before = JSON.stringify(state);
  const r = handleCommand(state, command);
  if (r.ok)
    throw new Error(`expected a rejection of ${JSON.stringify(command)}`);
  expect(JSON.stringify(state)).toBe(before);
  return r.reason;
}
const since = (before: GameState, after: GameState): GameEvent[] =>
  after.log.slice(before.log.length);
const ofType = <T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const withStash = (
  s: GameState,
  stashes: Record<string, number>,
): GameState => ({
  ...s,
  players: Object.fromEntries(
    Object.entries(s.players).map(([id, p]) => [
      id,
      id in stashes ? { ...p, stash: stashes[id] as number } : p,
    ]),
  ),
});
const player = (s: GameState, id: string): PlayerState =>
  s.players[id] as PlayerState;

const buy = (p: string, perk: unknown) => ({
  type: "buyPerk",
  player: p,
  perk,
});
const mv = (p: string, room: string, pocket = 0, extra: object = {}) => ({
  type: "submitMove",
  player: p,
  move: { ...fullGrab(room, pocket), ...extra },
});
const lobby = (n: number) =>
  Array.from({ length: n }, (_, i) => mv(`p${i}`, "lobby"));
const watch = (p: string, room: string) =>
  mv(p, "security", 0, { watch: room });
const ROUND = (s: GameState) => ({
  type: "advance",
  deadline: { kind: "round", round: s.round },
});
const ALIBIS = (s: GameState) => ({
  type: "advance",
  deadline: { kind: "alibis", round: s.resolvedRound },
});
const RESULT = (s: GameState) => ({
  type: "advance",
  deadline: { kind: "result", round: s.resolvedRound },
});
const NEXT = [ROUND, ALIBIS, RESULT];
const CLOSE = (s: GameState) => ({
  type: "advance",
  deadline: { kind: "closeMeeting", meetingId: s.meeting?.id },
});
const RESOLVE = (s: GameState) => ({
  type: "advance",
  deadline: {
    kind: "resolveShakedown",
    meetingId: s.pendingShakedown?.meetingId,
  },
});
const vote = (p: string, target: string) => ({
  type: "castVote",
  player: p,
  vote: { kind: "shakedown", target },
});
const emergency = (by: string): Cmd[] => [
  ROUND,
  ALIBIS,
  { type: "callEmergency", player: by },
  (s: GameState) => ({
    type: "advance",
    deadline: { kind: "openMeeting", meetingId: s.pendingEmergency?.meetingId },
  }),
];
/** Opens the meeting this state is waiting for. */
const OPEN = (s: GameState): Cmd[] => {
  if (s.phase.kind !== "awaitingMeeting")
    throw new Error(`no meeting due: ${s.phase.kind}`);
  const meetingId = s.phase.meetingId;
  return [
    { type: "scheduleMeeting", meetingId, slot: "x" },
    { type: "advance", deadline: { kind: "openMeeting", meetingId } },
  ];
};

describe("QA: the shop — design §12", () => {
  it("every seed at 3, 8 and 12 players deals exactly one perk per tier, in tier order, the same for the same seed", () => {
    for (const n of [3, 8, 12])
      for (let i = 0; i < 40; i++) {
        const cfg = config(n, { seed: `qa-shop-${n}-${i}` });
        const shop = ofType(setupEvents(cfg), "shopDealt");
        expect(shop).toHaveLength(1);
        expect(shop[0]?.perks.map((p) => PERKS[p].tier)).toEqual([1, 2, 3]);
        expect(ofType(setupEvents(cfg), "shopDealt")).toEqual(shop);
      }
  });

  it("a stash of exactly the cost buys it (stash 0, spent += cost); one coin short is refused, for every perk", () => {
    const uses: Record<PerkId, object> = {
      tail: { kind: "tail", room: "vault" },
      alibi: { kind: "alibi" },
      ballot: { kind: "ballot", target: "p1" },
      softShoes: { kind: "softShoes" },
      blackout: { kind: "blackout", room: "office" },
      bail: { kind: "bail" },
      plantEvidence: { kind: "plantEvidence", target: "p1", room: "vault" },
    };
    for (const id of PERK_IDS) {
      const cost = PERKS[id].cost;
      const s = game(3);
      expect(
        reason(withStash(s, { p0: cost - 1 }), buy("p0", uses[id])),
      ).toMatch(/costs \d coins?; your stash holds \d/);
      const after = run(withStash(s, { p0: cost }), buy("p0", uses[id]));
      expect([player(after, "p0").stash, after.spent]).toEqual([0, cost]);
    }
  });

  it("a refused purchase (bad target, too poor) doesn't use up the round's one purchase", () => {
    const s = withStash(game(3), { p0: 5 });
    expect(reason(s, buy("p0", { kind: "tail", room: "moon" }))).toBe(
      "tail a room in play",
    );
    expect(
      reason(
        s,
        buy("p0", { kind: "plantEvidence", target: "p0", room: "vault" }),
      ),
    ).toBe("pick another player");
    expect(handleCommand(s, buy("p0", { kind: "softShoes" })).ok).toBe(true);
  });

  it("one per round, across every perk kind, also after a Bail; again the next round", () => {
    let s = run(withStash(game(3), { p0: 9 }), buy("p0", { kind: "bail" }));
    for (const perk of [
      { kind: "alibi" },
      { kind: "softShoes" },
      { kind: "bail" },
      { kind: "tail", room: "vault" },
    ])
      expect(reason(s, buy("p0", perk))).toBe(
        "you have already bought a perk this round",
      );
    s = run(s, ...lobby(3), ...NEXT);
    s = run(s, buy("p0", { kind: "alibi" }));
    expect([s.spent, player(s, "p0").roleState.bail]).toEqual([4, true]);
  });

  it("refused outside planning: alibis, result window, an open meeting, after the game ends; and for strangers", () => {
    let s = withStash(game(3, { contentOverrides: { roundCap: 1 } }), {
      p0: 9,
    });
    expect(reason(s, buy("p9", { kind: "alibi" }))).toMatch(/p9/);
    s = withStash(game(3), { p0: 9 });
    s = run(s, mv("p1", "vault", 3), ROUND);
    expect(s.phase.kind).toBe("alibis");
    expect(reason(s, buy("p0", { kind: "alibi" }))).toBe(
      "perks are bought while a round is being planned",
    );
    s = run(s, ALIBIS);
    expect(s.phase.kind).toBe("result");
    expect(reason(s, buy("p0", { kind: "alibi" }))).toBe(
      "perks are bought while a round is being planned",
    );
    s = run(s, { type: "callEmergency", player: "p2" }, (x: GameState) => ({
      type: "advance",
      deadline: {
        kind: "openMeeting",
        meetingId: x.pendingEmergency?.meetingId,
      },
    }));
    expect(s.phase.kind).toBe("meeting");
    expect(reason(s, buy("p0", { kind: "alibi" }))).toBe(
      "perks are bought while a round is being planned",
    );
    const ended = run(
      withStash(game(3, { contentOverrides: { roundCap: 1 } }), { p0: 9 }),
      ROUND,
    );
    expect(ended.phase.kind).toBe("ended");
    expect(reason(ended, buy("p0", { kind: "alibi" }))).toBe(
      "the game is over",
    );
  });

  it("this round's pocket never pays, even after the move is in; coins spent are never taken back by a shakedown (§9.6)", () => {
    // p1 pockets 3 in round 1 and spends it all on Plant evidence in round 2; a shakedown then takes only what's above the share.
    let s = run(
      game(3, {}, ["tail", "softShoes", "plantEvidence"]),
      mv("p1", "vault", 3),
      ...NEXT,
    );
    expect(player(s, "p1").stash).toBe(3);
    s = run(s, mv("p1", "office", 2));
    s = run(
      s,
      buy("p1", { kind: "plantEvidence", target: "p0", room: "office" }),
    );
    expect(reason(s, buy("p1", { kind: "tail", room: "office" }))).toBe(
      "you have already bought a perk this round",
    );
    expect(player(s, "p1").stash).toBe(0);
    s = run(s, ...emergency("p2"), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    const shaken = ofType(s.log, "shakedownResolved")[0];
    // Stash: 0 + this round's 2 pocketed + share; above the share 2 is taken, the 3 spent are gone.
    expect(shaken?.taken).toBe(2);
    expect(s.spent).toBe(3);
  });
});

describe("QA: each perk at its boundaries — design §12", () => {
  it("Tail: not the round bought, the next round, not the one after; bought in the last round, nothing and no error", () => {
    let s = run(
      withStash(game(3), { p0: 1 }),
      buy("p0", { kind: "tail", room: "vault" }),
    );
    const tails = (x: GameState) =>
      ofType(x.log, "roomWatched")
        .filter((e) => e.source === "tail")
        .map((e) => [e.round, e.seen]);
    s = run(
      s,
      mv("p0", "lobby"),
      mv("p1", "office"),
      mv("p2", "lobby"),
      ...NEXT,
    );
    expect(tails(s)).toEqual([]);
    s = run(
      s,
      mv("p0", "lobby"),
      mv("p1", "lobby"),
      mv("p2", "vault"),
      ...NEXT,
    );
    expect(tails(s)).toEqual([[2, ["p2"]]]);
    s = run(
      s,
      mv("p0", "lobby"),
      mv("p1", "lobby"),
      mv("p2", "lobby"),
      ...NEXT,
    );
    expect(tails(s)).toEqual([[2, ["p2"]]]);
    const last = run(
      withStash(game(3, { contentOverrides: { roundCap: 1 } }), { p0: 1 }),
      buy("p0", { kind: "tail", room: "vault" }),
      ROUND,
    );
    expect(last.phase.kind).toBe("ended");
  });

  it("Tail survives an emergency between the rounds; its buyer missing next round's move still gets the feed", () => {
    let s = run(
      withStash(game(3), { p0: 1 }),
      buy("p0", { kind: "tail", room: "vault" }),
      ...emergency("p2"),
      CLOSE,
    );
    expect(s.phase.kind).toBe("planning");
    s = run(s, mv("p1", "vault"), ROUND);
    expect(
      ofType(s.log, "roomWatched")
        .filter((e) => e.source === "tail")
        .map((e) => [e.player, e.round, e.seen]),
    ).toEqual([["p0", 2, ["p1"]]]);
  });

  it("Soft shoes: rings the round bought; silent only the next round; rings again the round after", () => {
    // The Office (2 coins, 1 quiet) rings 1 per full grab; compare with the same game unbought.
    const office = (x: GameState, round: number) =>
      ofType(x.log, "bellsRung").find((e) => e.round === round)?.bells.office;
    const play = (bought: boolean) => {
      let s = withStash(game(3), { p0: 2 });
      if (bought) s = run(s, buy("p0", { kind: "softShoes" }));
      for (let r = 0; r < 3; r++)
        s = run(
          s,
          mv("p0", "office"),
          mv("p1", "lobby"),
          mv("p2", "lobby"),
          ...NEXT,
        );
      return s;
    };
    const [yes, no] = [play(true), play(false)];
    expect(office(yes, 1)).toBe(office(no, 1));
    expect(office(yes, 2)).toBe((office(no, 2) as number) - 1);
    expect([office(yes, 2), office(yes, 3), office(no, 3)]).toEqual([0, 1, 1]);
  });

  it("Blackout: dark only the next round; the same room as an Electrician's cut is announced once; two buyers' rooms both go dark", () => {
    let s = run(
      withStash(game(4, {}, PERK_IDS, { p3: "electrician" }), { p0: 2, p1: 2 }),
      buy("p0", { kind: "blackout", room: "office" }),
      buy("p1", { kind: "blackout", room: "vault" }),
    );
    s = run(
      s,
      mv("p0", "lobby"),
      mv("p1", "lobby"),
      mv("p2", "lobby"),
      mv("p3", "lobby", 0, { ability: { kind: "blackout", room: "office" } }),
      ...NEXT,
    );
    expect(ofType(s.log, "powerCut").map((e) => [e.round, e.room])).toEqual([
      [2, "office"],
      [2, "vault"],
    ]);
    expect([...s.dark].sort()).toEqual(["office", "vault"]);
    s = run(s, ...lobby(4), ...NEXT);
    expect(s.dark).toEqual([]);
    expect(ofType(s.log, "powerCut")).toHaveLength(2);
  });

  it("Stamped alibi: stamps only the round it was bought; a true alibi the round after is not stamped", () => {
    let s = run(
      withStash(game(3), { p0: 1 }),
      buy("p0", { kind: "alibi" }),
      mv("p0", "office"),
      mv("p1", "lobby"),
      mv("p2", "lobby"),
      ROUND,
    );
    s = run(
      s,
      { type: "postAlibi", player: "p0", room: "office" },
      ALIBIS,
      RESULT,
    );
    s = run(
      s,
      mv("p0", "office"),
      mv("p1", "lobby"),
      mv("p2", "lobby"),
      ROUND,
      { type: "postAlibi", player: "p0", room: "office" },
    );
    expect(ofType(s.log, "alibiVerified").map((e) => e.round)).toEqual([1]);
  });

  it("Stamped alibi: a buyer who missed their move is stamped only for the room the default move put them in", () => {
    const s = run(
      withStash(game(3), { p0: 1 }),
      buy("p0", { kind: "alibi" }),
      mv("p1", "lobby"),
      mv("p2", "lobby"),
      ROUND,
    );
    const real = ofType(s.log, "coinsGrabbed").find((e) => e.player === "p0")
      ?.room as string;
    const wrong = real === "office" ? "vault" : "office";
    expect(
      ofType(
        since(s, run(s, { type: "postAlibi", player: "p0", room: wrong })),
        "alibiVerified",
      ),
    ).toEqual([]);
    expect(
      ofType(
        since(s, run(s, { type: "postAlibi", player: "p0", room: real })),
        "alibiVerified",
      ),
    ).toHaveLength(1);
  });

  it("Plant evidence: in a dark room nobody is seen; never twice in a feed when two buyers plant the same player or they really were there", () => {
    let s = run(
      withStash(game(4), { p0: 9 }),
      buy("p0", { kind: "blackout", room: "office" }),
      ...lobby(4),
      ...NEXT,
    );
    expect(s.dark).toEqual(["office"]);
    s = withStash(s, { p0: 3, p3: 3 });
    s = run(
      s,
      buy("p0", { kind: "plantEvidence", target: "p1", room: "office" }),
      buy("p3", { kind: "plantEvidence", target: "p1", room: "vault" }),
    );
    const before = s;
    s = run(
      s,
      watch("p2", "office"),
      mv("p0", "lobby", 0, { ability: { kind: "lookout", rooms: ["vault"] } }),
      mv("p1", "vault"),
      mv("p3", "lobby"),
      ROUND,
    );
    expect(
      ofType(since(before, s), "roomWatched").map((e) => [
        e.player,
        e.room,
        e.seen,
        e.offline,
      ]),
    ).toEqual([
      ["p0", "vault", ["p1"], false],
      ["p2", "office", [], true],
    ]);
  });

  it("Plant evidence also shows in a Tail feed bought last round; a Lookout watching where they're planted sees the planted player, never themselves", () => {
    let s = run(
      withStash(game(4), { p2: 1 }),
      buy("p2", { kind: "tail", room: "office" }),
      ...lobby(4),
      ...NEXT,
    );
    s = withStash(s, { p3: 3 });
    s = run(
      s,
      buy("p3", { kind: "plantEvidence", target: "p0", room: "office" }),
    );
    const before = s;
    s = run(
      s,
      mv("p0", "lobby", 0, { ability: { kind: "lookout", rooms: ["office"] } }),
      mv("p1", "office"),
      mv("p2", "lobby"),
      mv("p3", "lobby"),
      ROUND,
    );
    expect(
      ofType(since(before, s), "roomWatched").map((e) => [
        e.player,
        e.source,
        e.seen,
      ]),
    ).toEqual([
      ["p0", "lookout", ["p1"]],
      ["p2", "tail", ["p0", "p1"]],
    ]);
  });
});

describe("QA: Check ballot — design §9.5, §12", () => {
  it("refused in Open mode for every target, with no coins taken; dealt shop unchanged", () => {
    const s = withStash(
      game(3, { voteVisibility: "open" }, ["ballot", "softShoes", "bail"]),
      { p0: 9 },
    );
    for (const target of ["p1", "p2", "p0", "p9"])
      expect(reason(s, buy("p0", { kind: "ballot", target }))).toBe(
        "ballots are already public in this game",
      );
    expect(s.shop).toEqual(["ballot", "softShoes", "bail"]);
    // Still a purchase left this round.
    expect(handleCommand(s, buy("p0", { kind: "softShoes" })).ok).toBe(true);
  });

  it("Hidden-then-revealed: the buyer sees the target's sealed ballot at the next meeting of any kind (a briefing), nobody else does", () => {
    // Round 1: p0 checks p1; p1 seals a vote on p2; p1 and p2 raid the Vault (3 + 3 rings of 4 bulbs) to call a briefing.
    let s = run(
      withStash(game(3), { p0: 1 }),
      buy("p0", { kind: "ballot", target: "p1" }),
      {
        type: "sealVote",
        player: "p1",
        vote: { kind: "shakedown", target: "p2" },
      },
    );
    s = run(s, mv("p1", "vault"), mv("p2", "vault"), ROUND, ALIBIS);
    s = run(s, OPEN);
    expect(s.meeting?.kind).toBe("briefing");
    expect(viewFor(s, "p0").me.seenBallots).toEqual({
      p1: { kind: "shakedown", target: "p2" },
    });
    expect(viewFor(s, "p2").me.seenBallots).toEqual({});
    expect(JSON.stringify(viewFor(s, "p2").ledger)).not.toContain(
      '"sealed":true',
    );
  });
});

describe("QA: Bail — design §9.6, §9.7, §12", () => {
  const shop: PerkId[] = ["tail", "softShoes", "bail"];
  /** p1 pockets the Vault's 3 in round 1 (holding Bail if `bail`), then p0 and p2 vote p1 down in an emergency. */
  const passed = (bail: boolean, players = 3) => {
    let s = withStash(game(players, {}, shop), { p1: 3 });
    if (bail) s = run(s, buy("p1", { kind: "bail" }));
    s = run(s, mv("p1", "vault", 3), ...emergency("p2"));
    for (let i = 0; i < players; i++)
      if (i !== 1) s = run(s, vote(`p${i}`, "p1"));
    return run(s, CLOSE);
  };

  it("no window when no shakedown passes (a failed vote), even with Bail held and in the shop", () => {
    let s = withStash(game(3, {}, shop), { p1: 3 });
    s = run(
      s,
      buy("p1", { kind: "bail" }),
      mv("p1", "vault", 3),
      ...emergency("p2"),
      vote("p0", "p1"),
      vote("p2", "p0"),
      CLOSE,
    );
    expect(s.log.some((e) => e.type === "shakedownPending")).toBe(false);
    expect(reason(s, { type: "chooseBail", player: "p1", use: true })).toBe(
      "no shakedown is waiting for a Bail choice",
    );
    expect(player(s, "p1").roleState.bail).toBe(true);
  });

  it("the choice is private: before the window ends, every other view is identical whether the target chose use, don't, or nothing (12 players)", () => {
    const base = passed(true, 12);
    const used = run(base, { type: "chooseBail", player: "p1", use: true });
    const declined = run(base, {
      type: "chooseBail",
      player: "p1",
      use: false,
    });
    for (const viewer of ["p0", "p2", "p11"]) {
      expect(viewFor(used, viewer)).toEqual(viewFor(base, viewer));
      expect(viewFor(declined, viewer)).toEqual(viewFor(base, viewer));
      expect(JSON.stringify(viewFor(used, viewer))).not.toMatch(
        /bailChosen|useBail/,
      );
    }
    expect(viewFor(used, "p1").caseFile.at(-1)?.event).toMatchObject({
      type: "bailChosen",
      use: true,
    });
  });

  it('after the window: a Bail used publicly shows only "fell through" with no stash; the choice opens at the reveal', () => {
    let s = run(
      passed(true),
      { type: "chooseBail", player: "p1", use: true },
      RESOLVE,
    );
    const cancelled = ofType(
      viewFor(s, "p0").ledger.map((e) => e.event),
      "shakedownCancelled",
    );
    expect(cancelled).toEqual([
      {
        type: "shakedownCancelled",
        visibility: { kind: "public" },
        meetingId: "emergency-1",
        target: "p1",
      },
    ]);
    expect(JSON.stringify(viewFor(s, "p0"))).not.toMatch(
      /bailChosen|stashRevealed/,
    );
    while (s.phase.kind !== "ended") {
      if (s.phase.kind === "planning") s = run(s, ROUND);
      else if (s.phase.kind === "alibis") s = run(s, ALIBIS);
      else if (s.phase.kind === "result") s = run(s, RESULT);
      else if (s.phase.kind === "awaitingMeeting") s = run(s, OPEN);
      else if (s.phase.kind === "meeting") s = run(s, CLOSE);
      else if (s.phase.kind === "shakedownPending") s = run(s, RESOLVE);
      else throw new Error(s.phase.kind);
    }
    expect(
      viewFor(s, "p0").reveal?.log.some(
        ({ event }) =>
          event.type === "bailChosen" && event.player === "p1" && event.use,
      ),
    ).toBe(true);
  });

  it("no answer keeps the Bail, and it still works at a later shakedown once the next regular meeting lifts the protection", () => {
    let s = run(passed(true), RESOLVE);
    expect([player(s, "p1").roleState.bail, s.protected]).toEqual([
      true,
      ["p1"],
    ]);
    // Protected until the next regular meeting: an emergency (none left at 3 players) or a briefing doesn't lift it.
    expect(reason(s, vote("p0", "p1"))).toBeTruthy();
    while (
      s.phase.kind !== "awaitingMeeting" ||
      s.phase.meeting !== "regular"
    ) {
      if (s.phase.kind === "planning") {
        // Grab wherever isn't taped off (a raid tapes a room, §5.3).
        for (const [p, rooms] of [
          ["p0", ["lobby"]],
          ["p1", ["vault", "office", "lobby"]],
          ["p2", ["office", "lobby"]],
        ] as const)
          for (const room of rooms)
            if (handleCommand(s, mv(p, room)).ok) {
              s = run(s, mv(p, room));
              break;
            }
        s = run(s, ROUND);
      } else if (s.phase.kind === "alibis") s = run(s, ALIBIS);
      else if (s.phase.kind === "result") s = run(s, RESULT);
      else if (s.phase.kind === "awaitingMeeting") {
        // A briefing: p1 is still protected there.
        s = run(s, OPEN);
        expect(s.protected).toContain("p1");
        expect(reason(s, vote("p0", "p1"))).toBeTruthy();
        s = run(s, CLOSE);
      } else throw new Error(`unexpected phase ${s.phase.kind}`);
    }
    s = run(s, OPEN);
    expect(s.protected).toEqual([]);
    s = run(s, vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(s.phase.kind).toBe("shakedownPending");
    s = run(s, { type: "chooseBail", player: "p1", use: true }, RESOLVE);
    expect(ofType(s.log, "shakedownCancelled")).toHaveLength(1);
    expect([player(s, "p1").roleState.bail, s.protected]).toEqual([
      false,
      ["p1"],
    ]);
  });

  it("a used Bail lets its holder buy another later (one at a time)", () => {
    let s = run(
      passed(true),
      { type: "chooseBail", player: "p1", use: true },
      RESOLVE,
    );
    s = withStash(s, { p1: 3 });
    expect(s.phase.kind).toBe("planning");
    s = run(s, buy("p1", { kind: "bail" }));
    expect(player(s, "p1").roleState.bail).toBe(true);
  });

  it("only the target answers; a non-target holding Bail is refused; no Bail in the shop means no window and no choice", () => {
    let s = withStash(game(3, {}, shop), { p0: 3, p1: 3 });
    s = run(
      s,
      buy("p0", { kind: "bail" }),
      mv("p1", "vault", 3),
      ...emergency("p2"),
      vote("p0", "p1"),
      vote("p2", "p1"),
      CLOSE,
    );
    expect(reason(s, { type: "chooseBail", player: "p0", use: true })).toBe(
      "only the shakedown's target can use Bail",
    );
    const noBail = run(
      withStash(game(3, {}, ["tail", "blackout", "plantEvidence"]), { p1: 3 }),
      mv("p1", "vault", 3),
      ...emergency("p2"),
      vote("p0", "p1"),
      vote("p2", "p1"),
      CLOSE,
    );
    expect(noBail.phase.kind).toBe("planning");
    expect(
      reason(noBail, { type: "chooseBail", player: "p1", use: true }),
    ).toBe("no shakedown is waiting for a Bail choice");
    expect(reason(noBail, buy("p1", { kind: "bail" }))).toBe(
      "perk bail is not on this game's black market",
    );
  });
});

describe("QA: viewFor leaks around purchases — design §12, §18", () => {
  it('"someone bought X": every other view is identical whoever bought it, for every perk kind', () => {
    const uses: Record<PerkId, (buyer: string) => object> = {
      tail: () => ({ kind: "tail", room: "vault" }),
      alibi: () => ({ kind: "alibi" }),
      ballot: () => ({ kind: "ballot", target: "p3" }),
      softShoes: () => ({ kind: "softShoes" }),
      blackout: () => ({ kind: "blackout", room: "office" }),
      bail: () => ({ kind: "bail" }),
      plantEvidence: () => ({
        kind: "plantEvidence",
        target: "p3",
        room: "vault",
      }),
    };
    for (const id of PERK_IDS) {
      const s = withStash(game(4), { p0: 3, p1: 3, p2: 3, p3: 3 });
      const byP0 = run(s, buy("p0", uses[id]("p0")));
      const byP1 = run(s, buy("p1", uses[id]("p1")));
      expect(viewFor(byP0, "p2"), id).toEqual(viewFor(byP1, "p2"));
      expect(viewFor(byP0, "p3"), id).toEqual(viewFor(byP1, "p3"));
      // Through the next round too (Blackout's cut, Tail's feed, Soft shoes' silence affect only the buyer's private view or carry no source).
      const later = (x: GameState) => run(x, ...lobby(4), ...NEXT);
      expect(viewFor(later(byP0), "p2"), id).toEqual(
        viewFor(later(byP1), "p2"),
      );
    }
  });

  it("the purchase is logged as planning closes and public: the perk and cost only, no player field", () => {
    const s = withStash(game(3), { p0: 3 });
    const sold = ofType(
      viewFor(run(s, buy("p0", { kind: "bail" }), ROUND), "p1").ledger.map(
        (e) => e.event,
      ),
      "perkSold",
    );
    expect(sold).toHaveLength(1);
    expect(Object.keys(sold[0] as object).sort()).toEqual([
      "cost",
      "perk",
      "round",
      "type",
      "visibility",
    ]);
  });
});

describe("QA: the Rig is gone next to S3a.8's redraw — design §12, §13", () => {
  it("no Rig on any market, rigPick is not a command, and every flip with perks bought lands a card that applies", () => {
    expect(PERK_IDS).not.toContain("rig" as PerkId);
    expect(
      handleCommand(game(3), {
        type: "rigPick",
        player: "p0",
        card: "lockdown",
      }).ok,
    ).toBe(false);
    expect(
      handleCommand(
        withStash(game(3), { p0: 9 }),
        buy("p0", { kind: "rig", cards: ["lockdown"] }),
      ).ok,
    ).toBe(false);
    let flips = 0;
    for (let i = 0; i < 12; i++) {
      let s = withStash(game(4, { eventsEnabled: true, seed: `qa-rig-${i}` }), {
        p0: 20,
        p1: 20,
      });
      for (let round = 1; round <= 6 && s.phase.kind === "planning"; round++) {
        s = run(
          s,
          buy("p0", { kind: "blackout", room: "office" }),
          buy("p1", { kind: "tail", room: "vault" }),
          ...lobby(4),
          ROUND,
        );
        if (s.phase.kind === "ended") break;
        s = run(s, ALIBIS);
        while (s.phase.kind !== "planning" && s.phase.kind !== "ended") {
          if (s.phase.kind === "result") s = run(s, RESULT);
          else if (s.phase.kind === "awaitingMeeting") s = run(s, OPEN, CLOSE);
          else throw new Error(s.phase.kind);
        }
      }
      for (const e of ofType(s.log, "eventFlipped")) {
        flips++;
        if (e.card === "lockdown")
          expect(["lobby", "rooftop", null]).not.toContain(e.room);
      }
    }
    expect(flips).toBeGreaterThan(0);
  });
});

describe("QA: determinism — design §19.1", () => {
  /** Coins earned in play (no test-only stashes), every perk kind but Check ballot bought, and a Bail used. */
  const script = (): GameState => {
    let s = game(4, { seed: "qa-det", eventsEnabled: true });
    s = run(
      s,
      mv("p0", "vault", 3),
      mv("p1", "office", 2),
      mv("p2", "lobby", 1),
      mv("p3", "office", 2),
      ...NEXT,
    );
    s = run(
      s,
      buy("p0", { kind: "bail" }),
      buy("p1", { kind: "softShoes" }),
      buy("p2", { kind: "tail", room: "vault" }),
      buy("p3", { kind: "blackout", room: "office" }),
      mv("p1", "office", 2),
      mv("p2", "lobby", 1),
      ...emergency("p2"),
      vote("p1", "p0"),
      vote("p2", "p0"),
      vote("p3", "p0"),
      CLOSE,
    );
    s = run(s, { type: "chooseBail", player: "p0", use: true }, RESOLVE);
    return run(
      s,
      buy("p1", { kind: "tail", room: "office" }),
      buy("p2", { kind: "alibi" }),
      mv("p2", "office"),
      ROUND,
      ALIBIS,
    );
  };

  it("same seed and commands give the same log, and replaying the log rebuilds the same state", () => {
    const a = script();
    const b = script();
    expect(a.log).toEqual(b.log);
    expect(ofType(a.log, "perkSold")).toHaveLength(6);
    expect(ofType(a.log, "shakedownCancelled")).toHaveLength(1);
    expect(replay(a.config, a.log)).toEqual(a);
  });
});
