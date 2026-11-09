// QA round 2 (S3a.7, #94): attacks on the anonymous purchase. A round's
// "Someone bought …" notices are held until planning closes; try to tie one to
// its buyer by event order, seq, timing, the number of notices, ledger
// position, the buyer's own view against others', and a single-buyer round.
// design §12, §18
import { describe, expect, it } from "vitest";
import { PERK_IDS } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { PUBLIC } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { fullGrab } from "./grab.testkit";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "qa-perk-anonymity",
    players: ids(players).map((id, i) => ({ id, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  };
}

/** Every seat a Lookout (acts only when used), all seven perks on sale, every stash at 9 coins. */
function game(players: number): GameState {
  const cfg = config(players);
  const s = replay(
    cfg,
    setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "lookout" } : e.type === "shopDealt" ? { ...e, perks: PERK_IDS } : e)),
  );
  return { ...s, players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...(p as PlayerState), stash: 9 }])) };
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    if (Array.isArray(command)) return run(s, ...(command as Cmd[]));
    const r = handleCommand(s, command);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    return r.state;
  }, state);
}

const buy = (p: string, perk: unknown) => ({ type: "buyPerk", player: p, perk });
const mv = (p: string) => ({ type: "submitMove", player: p, move: fullGrab("lobby", 0) });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const ALIBIS = (s: GameState) => ({ type: "advance", deadline: { kind: "alibis", round: s.resolvedRound } });
const RESULT = (s: GameState) => ({ type: "advance", deadline: { kind: "result", round: s.resolvedRound } });

const ledger = (s: GameState, id: string) => viewFor(s, id).ledger.map(({ event }) => event);
const json = (x: unknown) => JSON.stringify(x);

describe("anonymous purchases: the public log can't name a buyer — design §12, §18", () => {
  it("a purchase changes no view but the buyer's, at 3, 8 and 12 players, before or after its lock-in, for every perk", () => {
    for (const n of [3, 8, 12]) {
      const perks = {
        tail: { kind: "tail", room: "vault" },
        alibi: { kind: "alibi" },
        ballot: { kind: "ballot", target: "p0" },
        softShoes: { kind: "softShoes" },
        blackout: { kind: "blackout", room: "office" },
        bail: { kind: "bail" },
        plantEvidence: { kind: "plantEvidence", target: "p0", room: "vault" },
      };
      for (const perk of Object.values(perks)) {
        for (const locked of [false, true]) {
          const before = locked ? run(game(n), mv("p1")) : game(n);
          const after = run(before, buy("p1", perk));
          for (const id of ids(n).filter((x) => x !== "p1")) expect(json(viewFor(after, id)), `${n}p ${perk.kind} ${id}`).toBe(json(viewFor(before, id)));
          // Not even the lock-in marks: buying is not a lock-in.
          expect(viewFor(after, "p0").lockedIn).toEqual(locked ? ["p1"] : []);
        }
      }
    }
  });

  it("a bystander's whole view (ledger, case file, every seq) is the same whoever bought and whenever, into the next round", () => {
    // p0, p1 and p3 lock in, in that order; p2 never does (its default move). p3 watches.
    const perks: unknown[] = [
      { kind: "tail", room: "vault" },
      { kind: "alibi" },
      { kind: "ballot", target: "p3" },
      { kind: "softShoes" },
      { kind: "blackout", room: "office" },
      { kind: "bail" },
      { kind: "plantEvidence", target: "p3", room: "vault" },
    ];
    const locks = ["p0", "p1", "p3"];
    const timings = ["first", "afterOwnLock", "last"] as const;
    for (const perk of perks) {
      const seen = new Set<string>();
      for (const buyer of ["p0", "p1", "p2"]) {
        for (const when of timings) {
          const steps: Cmd[] = [];
          if (when === "first") steps.push(buy(buyer, perk));
          for (const id of locks) {
            steps.push(mv(id));
            if (when === "afterOwnLock" && id === buyer) steps.push(buy(buyer, perk));
          }
          if (when === "last" || (when === "afterOwnLock" && !locks.includes(buyer))) steps.push(buy(buyer, perk));
          const s = run(game(4), ...steps, ROUND, ALIBIS, RESULT);
          expect(s.phase.kind).toBe("planning");
          const view = viewFor(s, "p3");
          // The seq of the bystander's view counts only what it sees: no gaps where others' private events sit.
          expect([...view.ledger, ...view.caseFile].map((e) => e.seq).sort((a, b) => a - b)).toEqual([...view.ledger, ...view.caseFile].map((_, i) => i));
          expect(ofType(view.caseFile.map((e) => e.event), "perkBought")).toEqual([]);
          seen.add(json(view));
        }
      }
      expect(seen.size, json(perk)).toBe(1);
    }
  });

  it("a single-buyer round at 12 players: one notice, the resolution's first event, right after the last lock-in, whichever seat bought", () => {
    const n = 12;
    const observer = "p11";
    const ledgers = new Set<string>();
    for (const buyer of ids(n - 1)) {
      // Every seat locks in in seat order; the buyer buys straight after its own lock-in.
      const planned = run(game(n), ...ids(n).flatMap((id) => (id === buyer ? [mv(id), buy(id, { kind: "softShoes" })] : [mv(id)])));
      const s = run(planned, ROUND);
      const fresh = s.log.slice(planned.log.length);
      // The notice opens the resolution, before anything else (private events included).
      expect(fresh[0]).toEqual({ type: "perkSold", visibility: PUBLIC, round: 1, perk: "softShoes", cost: 2 });
      expect(ofType(fresh, "perkSold")).toHaveLength(1);
      const pub = ledger(s, observer);
      const at = pub.findIndex((e) => e.type === "perkSold");
      expect(pub[at - 1]).toEqual({ type: "moveLocked", visibility: PUBLIC, player: "p11", round: 1 });
      // The buyer's own public ledger is everyone's.
      expect(ledger(s, buyer)).toEqual(pub);
      ledgers.add(json(pub));
    }
    expect(ledgers.size).toBe(1);
  });

  it("only the buyer's case file holds its purchase until the reveal; its ledger is the same as a bystander's", () => {
    const s = run(game(3), mv("p0"), buy("p0", { kind: "tail", room: "vault" }), mv("p1"), mv("p2"), ROUND);
    const cases = (id: string) => ofType(viewFor(s, id).caseFile.map((e) => e.event), "perkBought");
    expect(cases("p0").map((e) => e.player)).toEqual(["p0"]);
    expect([cases("p1"), cases("p2")]).toEqual([[], []]);
    expect(ledger(s, "p0")).toEqual(ledger(s, "p1"));
    expect(ledger(s, "p2")).toEqual(ledger(s, "p1"));
  });

  it("as many notices as purchases, two of one perk alike, in the black market's order whatever the order bought and whoever bought", () => {
    const tail = { kind: "tail", room: "vault" };
    const bail = { kind: "bail" };
    const plant = { kind: "plantEvidence", target: "p1", room: "lobby" };
    const notices = (purchases: [string, unknown][]) => {
      const s = run(game(5), ...purchases.map(([b, perk]) => buy(b, perk)), ...ids(5).map(mv), ROUND);
      return { sold: ofType(ledger(s, "p1"), "perkSold"), view: json(viewFor(s, "p1")) };
    };
    const a = notices([["p4", plant], ["p0", tail], ["p2", tail], ["p3", bail]]);
    expect(a.sold.map((e) => [e.perk, e.cost])).toEqual([["tail", 1], ["tail", 1], ["bail", 3], ["plantEvidence", 3]]);
    expect(a.sold[0]).toEqual(a.sold[1]);
    // Another order, and the tail and bail buyers swapped: the bystander (the plant's target) sees the same.
    for (const other of [
      notices([["p3", bail], ["p2", tail], ["p0", tail], ["p4", plant]]),
      notices([["p0", bail], ["p3", tail], ["p4", plant], ["p2", tail]]),
    ]) {
      expect(other.view).toBe(a.view);
    }
  });

  it("nothing is announced for a round with no purchase, and a purchase is announced only for its own round", () => {
    let s = run(game(3), buy("p0", { kind: "softShoes" }), ...ids(3).map(mv), ROUND, ALIBIS, RESULT);
    const before = s;
    s = run(s, ...ids(3).map(mv), ROUND);
    expect(ofType(s.log.slice(before.log.length), "perkSold")).toEqual([]);
    expect(ofType(s.log, "perkSold").map((e) => e.round)).toEqual([1]);
  });

  it("determinism: the same seed and commands with purchases give the same log", () => {
    const play = () => run(game(4), mv("p0"), buy("p0", { kind: "blackout", room: "vault" }), buy("p2", { kind: "alibi" }), ...ids(4).map(mv), ROUND, ALIBIS, RESULT, ...ids(4).map(mv), ROUND);
    expect(json(play().log)).toBe(json(play().log));
  });
});

const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) => events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
