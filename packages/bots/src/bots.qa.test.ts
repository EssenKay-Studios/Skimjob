// QA (PR #9): adversarial checks on the bots and the all-bot runner. design §17.3
// (bots play by the same rules and see only their own view), §17.2 (determinism),
// §5.1 (absent players get default moves), §8 (Inside Man can't pocket), §11.2 (votes).
import { describe, expect, it } from "vitest";
import {
  createGame,
  handleCommand,
  viewFor,
  type Command,
  type GameConfig,
  type GameState,
  type MoleSetting,
  type PlayerCommand,
  type PlayerView,
  type VoteVisibility,
} from "@skimjob/engine";
import { createBot, type Agent } from "./bot";
import { PERSONALITIES, type Personality, type PersonalityId } from "./personalities";
import { createBots, runBotGame, type BotGameResult } from "./run";

const IDS: PersonalityId[] = ["honest", "opportunist", "greedy", "cautious", "random"];
const SIZES = [2, 3, 8, 12];
const VOTE_MODES: readonly VoteVisibility[] = ["hiddenThenRevealed", "open", "secret"];
const cyc = <T>(xs: readonly T[], i: number): T => xs[i % xs.length] as T;

function config(n: number, seed: string, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `q${i}`, name: `Q${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    ...extra,
  };
}

const only = (id: PersonalityId) => (): Personality => PERSONALITIES[id];
const rotate = (offset: number) => (_: unknown, i: number): Personality => PERSONALITIES[IDS[(i + offset) % IDS.length] as PersonalityId];

/** Wraps agents so every command they send is recorded, with the view it answered. */
function recording(agents: readonly Agent[]) {
  const sent: { view: PlayerView; command: PlayerCommand }[] = [];
  const wrapped = agents.map((a): Agent => ({
    player: a.player,
    act: (view) => {
      const out = a.act(view);
      for (const command of out) sent.push({ view, command });
      return out;
    },
  }));
  return { sent, wrapped };
}

const expectClean = (r: BotGameResult, label: string) => {
  expect(r.state.phase.kind, label).toBe("ended");
  expect(r.rejections, label).toEqual([]);
};

describe("QA: sweep — every personality at 2, 3, 8, 12 players over many seeds (design §17.3)", () => {
  const MODES = VOTE_MODES;
  const MOLES: MoleSetting[] = ["off", "maybe", "on"];

  it.each(IDS)("%s crews: zero refused commands, no exceptions, every game ends", (id) => {
    for (const n of SIZES) {
      for (let s = 0; s < 6; s++) {
        const c = config(n, `sweep-${id}-${n}-${s}`, { voteVisibility: cyc(MODES, s), mole: cyc(MOLES, s) });
        expectClean(runBotGame(c, createBots(c.players, only(id), `b-${s}`)), `${id} n=${n} s=${s}`);
      }
    }
  });

  it("mixed crews in every seat order, vote mode, Mole setting and starter mode", () => {
    for (const n of SIZES) {
      for (let s = 0; s < 10; s++) {
        const c = config(n, `mix-${n}-${s}`, {
          voteVisibility: cyc(MODES, s),
          mole: s % 2 === 0 ? cyc(MOLES, s) : "off",
          starterMode: s % 2 === 1,
        });
        expectClean(runBotGame(c, createBots(c.players, rotate(s), `m-${s}`)), `n=${n} s=${s}`);
      }
    }
  });

  it("all-Mole-setting 'on' at 12 players (one Mole, design §8.1) still plays clean", () => {
    for (let s = 0; s < 5; s++) {
      const c = config(12, `moles-${s}`, { mole: "on" });
      const r = runBotGame(c, createBots(c.players, rotate(s), `mo-${s}`));
      expectClean(r, `s=${s}`);
      expect(Object.values(r.state.players).filter((p) => p.role === "mole").length).toBe(1);
    }
  });
});

describe("QA: determinism — design §17.2", () => {
  it.each(SIZES)("same game seed + bot seed → identical log and identical command stream (%i players)", (n) => {
    const once = () => {
      const c = config(n, `det-${n}`, { mole: "maybe" });
      const rec = recording(createBots(c.players, rotate(n), "det-bots"));
      const r = runBotGame(c, rec.wrapped);
      return { log: JSON.stringify(r.state.log), cmds: JSON.stringify(rec.sent.map((x) => x.command)), steps: r.steps };
    };
    expect(once()).toEqual(once());
  });

  it("a bot's commands depend only on (its seed, the views it has seen): two bots with one seed agree", () => {
    const c = config(5, "twin");
    const s = createGame(c);
    const a = createBot({ player: "q1", personality: PERSONALITIES.random, seed: "twin" });
    const b = createBot({ player: "q1", personality: PERSONALITIES.random, seed: "twin" });
    for (let i = 0; i < 20; i++) expect(a.act(viewFor(s, "q1"))).toEqual(b.act(viewFor(s, "q1")));
  });
});

describe("QA: bots never read the state, only their view — design §17.3", () => {
  /** Every object reachable from a value. */
  const objects = (root: unknown): Set<object> => {
    const seen = new Set<object>();
    const walk = (v: unknown) => {
      if (typeof v !== "object" || v === null || seen.has(v)) return;
      seen.add(v);
      for (const x of Object.values(v)) walk(x);
    };
    walk(root);
    return seen;
  };

  it("a view shares no object with the game state, so nothing hidden is reachable from it", () => {
    for (const n of [2, 12]) {
      const c = config(n, `reach-${n}`);
      const { state } = runBotGame(c, createBots(c.players, rotate(0), "reach"));
      const mid = midGame(c);
      for (const s of [mid, state]) {
        const stateObjs = objects(s);
        for (const id of s.playerOrder) {
          const view = viewFor(s, id);
          for (const o of objects(view)) expect(stateObjs.has(o)).toBe(false);
          // The view is plain data: nothing to call back into the engine with.
          expect(JSON.parse(JSON.stringify(view))).toEqual(view);
        }
      }
    }
  });

  it("a mid-game view holds neither the game seed nor anyone else's role, move or split", () => {
    const c = config(8, "secret-seed-XYZZY");
    const s = midGame(c);
    expect(s.phase.kind).toBe("planning");
    for (const id of s.playerOrder) {
      const text = JSON.stringify(viewFor(s, id));
      expect(text).not.toContain("secret-seed-XYZZY");
      const view = viewFor(s, id);
      for (const { event } of view.caseFile) {
        if ("player" in event) expect(event.player).toBe(id);
      }
      expect(view.reveal).toBeNull();
    }
  });

  it("a bot fed a detached JSON copy of each view plays the identical game (it reaches nothing beyond the view)", () => {
    for (const n of SIZES) {
      const c = config(n, `json-${n}`);
      const normal = runBotGame(c, createBots(c.players, rotate(1), "json"));
      const detached = runBotGame(
        c,
        createBots(c.players, rotate(1), "json").map((a): Agent => ({ player: a.player, act: (v) => a.act(JSON.parse(JSON.stringify(v)) as PlayerView) })),
      );
      expect(JSON.stringify(detached.state.log)).toBe(JSON.stringify(normal.state.log));
    }
  });

  it("hidden facts don't change a bot's commands: same view from two games with different secret seeds", () => {
    // Find two seeds whose public setup (shop included) and q0's role agree; q0's view (and so its commands) must then agree.
    // A Hidden role list, so the deal itself isn't public. extension.md "Role list"
    const hidden = (seed: string) => createGame(config(4, seed, { roleList: "hidden" }));
    const base = hidden("hid-0");
    const key = (s: GameState) => JSON.stringify(viewFor(s, "q0"));
    let other: GameState | null = null;
    for (let i = 1; i < 2000 && !other; i++) {
      const s = hidden(`hid-${i}`);
      if (key(s) === key(base) && JSON.stringify(s.players) !== JSON.stringify(base.players)) other = s;
    }
    expect(other).not.toBeNull();
    const bot = () => createBot({ player: "q0", personality: PERSONALITIES.random, seed: "hid" });
    expect(bot().act(viewFor(other as GameState, "q0"))).toEqual(bot().act(viewFor(base, "q0")));
  });
});

/** A game stopped in round 2's planning, after round 1 resolved with bots playing. */
function midGame(c: GameConfig): GameState {
  let state = createGame(c);
  const bots = createBots(c.players, rotate(2), "mid");
  const apply = (cmd: Command | PlayerCommand) => {
    const r = handleCommand(state, cmd);
    if (r.ok) state = r.state;
  };
  for (const b of bots) for (const cmd of b.act(viewFor(state, b.player))) apply(cmd);
  apply({ type: "advance", deadline: { kind: "round", round: 1 } });
  for (const b of bots) for (const cmd of b.act(viewFor(state, b.player))) apply(cmd);
  apply({ type: "advance", deadline: { kind: "alibis", round: 1 } }); // design §5.4
  for (const b of bots) for (const cmd of b.act(viewFor(state, b.player))) apply(cmd);
  return state;
}

describe("QA: vandalising a view doesn't touch the game — design §17.3", () => {
  const vandalise = (v: unknown): void => {
    if (typeof v !== "object" || v === null) return;
    for (const key of Object.keys(v)) {
      const x = (v as Record<string, unknown>)[key];
      vandalise(x);
      if (typeof x === "number") (v as Record<string, unknown>)[key] = 999;
      else if (typeof x === "string" && key !== "type") (v as Record<string, unknown>)[key] = "zzz";
    }
    if (Array.isArray(v)) v.push({ type: "junk" });
  };

  it.each(SIZES)("an agent that wrecks every view after answering leaves the game identical (%i players)", (n) => {
    const c = config(n, `vandal-${n}`);
    const clean = runBotGame(c, createBots(c.players, rotate(3), "vandal"));
    const wrecked = runBotGame(
      c,
      createBots(c.players, rotate(3), "vandal").map((a): Agent => ({
        player: a.player,
        act: (view) => {
          const out = a.act(view);
          vandalise(view);
          return out;
        },
      })),
    );
    expect(JSON.stringify(wrecked.state.log)).toBe(JSON.stringify(clean.state.log));
    expect(wrecked.rejections).toEqual([]);
  });
});

describe("QA: mixed crews with absent humans (default moves) — design §5.1", () => {
  it.each(SIZES)("one seat never acts (%i players): clean game, that seat gets default moves every round", (n) => {
    for (let s = 0; s < 4; s++) {
      const c = config(n, `idle-${n}-${s}`);
      const idle = `q${s % n}`;
      const bots = createBots(c.players, rotate(s), `idle-${s}`).map((a): Agent => (a.player === idle ? { player: idle, act: () => [] } : a));
      const r = runBotGame(c, bots);
      expectClean(r, `n=${n} s=${s}`);
      const defaults = r.state.log.filter((e) => e.type === "defaultMoveAssigned" && e.player === idle).length;
      const rounds = r.state.log.filter((e) => e.type === "roundResolved").length;
      expect(defaults).toBe(rounds);
    }
  });

  it.each(SIZES)("only one bot, every other seat absent (%i players)", (n) => {
    for (const id of IDS) {
      const c = config(n, `lone-${n}-${id}`);
      expectClean(runBotGame(c, createBots(c.players.slice(n - 1), only(id), "lone")), `${id} n=${n}`);
    }
  });

  it("no agents at all: the server alone still finishes the game", () => {
    for (const n of SIZES) expect(runBotGame(config(n, `empty-${n}`), []).state.phase.kind).toBe("ended");
  });

  it("bots asked twice per step (the runner re-asks whenever the view may have changed) send no duplicate or refused commands", () => {
    for (const n of SIZES) {
      for (let s = 0; s < 3; s++) {
        const c = config(n, `twice-${n}-${s}`, { voteVisibility: cyc(VOTE_MODES, s) });
        const bots = createBots(c.players, rotate(s), `twice-${s}`);
        expectClean(runBotGame(c, [...bots, ...bots]), `n=${n} s=${s}`);
      }
    }
  });
});

describe("QA: commands are well-formed — design §8, §11.2", () => {
  // One batch of recorded games shared by the checks below.
  const games = SIZES.flatMap((n) =>
    Array.from({ length: 5 }, (_, s) => {
      const c = config(n, `cmd-${n}-${s}`, { voteVisibility: cyc(VOTE_MODES, s), deck: s % 2 ? "everything" : "standard" });
      const rec = recording(createBots(c.players, rotate(s), `cmd-${s}`));
      const r = runBotGame(c, rec.wrapped);
      return { n, r, sent: rec.sent };
    }),
  );

  it("the batch is not vacuous: it has emergencies, shakedowns, Fence and Lookout uses", () => {
    const log = games.flatMap(({ r }) => r.state.log);
    const has = (test: (e: (typeof log)[number]) => boolean) => expect(log.some(test)).toBe(true);
    has((e) => e.type === "emergencyMeetingCalled");
    has((e) => e.type === "shakedownResolved");
    // Since R3b five accomplices share the dark seats, so any accomplice's move power counts here.
    has((e) => e.type === "abilityResolved" && ["fenceSafe", "loopCameras", "forge", "blackmail"].includes(e.ability.kind));
    has((e) => e.type === "abilityResolved" && e.ability.kind === "lookout");
  });

  it("every command is in the bot's own name", () => {
    for (const { sent } of games) for (const { view, command } of sent) expect(command.player).toBe(view.me.id);
  });

  it("Inside Man bots never try to pocket, whatever the personality (Random included)", () => {
    let insiderMoves = 0;
    for (const { sent } of games) {
      for (const { view, command } of sent) {
        if (command.type !== "submitMove" || view.me.role !== "insideMan") continue;
        insiderMoves++;
        expect(command.move.pocket).toBe(0);
      }
    }
    expect(insiderMoves).toBeGreaterThan(20);
  });

  it("Inside Man bots never pocket: forced Inside Man seat for every personality at every size", () => {
    for (const id of IDS) {
      for (const n of SIZES) {
        // rolePool ["insideMan"] guarantees exactly one Inside Man; find it from the full state (scheduler side).
        const c = config(n, `ins-${id}-${n}`, { rolePool: ["insideMan"] });
        const rec = recording(createBots(c.players, only(id), `ins-${id}`));
        const r = runBotGame(c, rec.wrapped);
        expectClean(r, `${id} n=${n}`);
        const insider = r.state.playerOrder.find((p) => r.state.players[p]?.role === "insideMan");
        // design §8.1 (owner answers, 1 Nov): no Inside Man below 5 players.
        if (n < 5) {
          expect(insider).toBeUndefined();
          continue;
        }
        expect(insider).toBeDefined();
        const moves = rec.sent.filter((x) => x.command.player === insider && x.command.type === "submitMove");
        expect(moves.length).toBeGreaterThan(0);
        for (const { command } of moves) if (command.type === "submitMove") expect(command.move.pocket).toBe(0);
      }
    }
  });

  it("votes are a skip or a shakedown of another seated player — never self, never unknown", () => {
    let votes = 0;
    for (const { r, sent } of games) {
      for (const { view, command } of sent) {
        if (command.type !== "castVote") continue;
        votes++;
        expect(view.phase.kind).toBe("meeting");
        if (command.vote.kind === "skip") continue;
        expect(command.vote.kind).toBe("shakedown");
        if (command.vote.kind !== "shakedown") continue;
        expect(command.vote.target).not.toBe(command.player);
        expect(r.state.playerOrder).toContain(command.vote.target);
      }
    }
    expect(votes).toBeGreaterThan(50);
  });

  it("moves name a room in play, a pocket within the room's loot, and Security watches a room in play", () => {
    for (const { sent } of games) {
      for (const { view, command } of sent) {
        if (command.type !== "submitMove") continue;
        expect(view.rooms).toContain(command.move.room);
        expect(Number.isInteger(command.move.pocket)).toBe(true);
        expect(command.move.pocket).toBeGreaterThanOrEqual(0);
        if (command.move.watch !== undefined) expect(view.rooms).toContain(command.move.watch);
      }
    }
  });

  it("an ended game gets no commands from any bot", () => {
    for (const { r } of games.slice(0, 4)) {
      for (const id of r.state.playerOrder) {
        for (const p of IDS) expect(createBot({ player: id, personality: PERSONALITIES[p], seed: "end" }).act(viewFor(r.state, id))).toEqual([]);
      }
    }
  });
});
