// QA (PR #10): hostile CLI input, same seed → same files, and the §17.4
// metrics hand-checked against the engine's own state on a small fixed set.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERSONALITIES, createBots, runBotGame } from "@skimjob/bots";
import { checkpointTarget, jobFor, leadersOf, ranking, replay, rolesFor, scoreFor, type GameEvent, type GameState } from "@skimjob/engine";
import { parseSimArgs, type SimOptions } from "./args";
import { setupGame } from "./crew";
import { summarize } from "./metrics";
import { writeOutputs } from "./output";
import { recordGame } from "./record";
import { checkOptions, runBatch, runOne } from "./run";

const opts = (argv: string[]): SimOptions => {
  const r = parseSimArgs(argv);
  if (r.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(r)}`);
  return r.options;
};

describe("design §17.4 inputs — bad arguments are clean errors, never throws", () => {
  const bad: string[][] = [
    ["-n", "0"], ["-n", "1.5"], ["-n", "1e400"], ["-n", "-3"], ["-n"], ["-p", "1"], ["-p", "13"], ["-p", "12-2"], ["-p", "6,"],
    ["-b", "__proto__"], ["-b", "constructor:2"], ["-b", "honest:0"], ["-b", "honest:Infinity"], ["-b", "honest,honest"], ["-b", ""],
    ["--mole", "__proto__"], ["--votes", "toString"], ["--bogus"], ["positional"], ["--overrides", '{"heat":'],
    ["--overrides", "/nonexistent/qa.json"], ["--overrides", ""],
  ];
  it.each(bad.map((a) => [a.join(" "), a]))("%s → error", (_label, argv) => {
    const r = parseSimArgs(argv as string[], () => {
      throw new Error("ENOENT");
    });
    expect(r.kind).toBe("error");
  });

  it("an override file is read through the given reader and parsed", () => {
    const r = parseSimArgs(["--overrides", "x.json"], () => '{"heat":{"perRound":5}}');
    expect(r.kind === "run" && r.options.contentOverrides).toEqual({ heat: { perRound: 5 } });
  });
});

describe("design §17.4 config overrides — hostile JSON is refused, nothing polluted", () => {
  const hostile = [
    '{"__proto__":{"polluted":1}}',
    '{"rooms":{"__proto__":{"loot":1}}}',
    '{"rooms":{"vault":{"__proto__":{"loot":99}}}}',
    '{"rooms":{"depositBoxes":{"capacity":{"__proto__":{"max":0}}}}}',
    '{"rooms":{"constructor":{"loot":1}}}',
    '{"heat":{"__proto__":{"max":1}}}',
    '{"heat":{"constructor":1}}',
    '{"checkpoints":{"__proto__":[1,2,3]}}',
    '{"shakedown":{"__proto__":{"cleanBelowPerAct":0}}}',
    '{"roles":{"__proto__":{"stashMultiplier":9}}}',
    '{"roles":{"rookie":{"__proto__":{"stashMultiplier":9}}}}',
    '{"roles":{"toString":{}}}',
    '{"heat":{"max":0}}', '{"heat":{"perRound":"5"}}', '{"rooms":{"vault":{"loot":1.5}}}', '{"rooms":{"vault":{"loot":-1}}}',
    '{"checkpoints":{"perPlayer":[1,2]}}', '{"checkpoints":{"perPlayer":[1,2,-3]}}', '{"roles":{"lookout":{"perAct":1}}}',
    '{"rooms":{"vault":{"capacity":{"max":2}}}}', '{"rooms":[]}', '{"heat":null}',
  ];
  it.each(hostile)("%s", (json) => {
    const o = opts(["-p", "2,12", "--overrides", json]);
    expect(checkOptions(o).length).toBeGreaterThan(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).loot).toBeUndefined();
    expect(({} as Record<string, unknown>).max).toBeUndefined();
  });

  it("a file holding an array, a string or a number is refused; null means none", () => {
    for (const text of ["[1,2]", '"x"', "0", "true"]) {
      const r = parseSimArgs(["--overrides", "f.json"], () => text);
      if (r.kind !== "run") throw new Error("expected run");
      expect(checkOptions(r.options)).not.toEqual([]);
    }
    const r = parseSimArgs(["--overrides", "f.json"], () => "null");
    expect(r.kind === "run" && checkOptions(r.options)).toEqual([]);
  });

  it("an unknown job (prototype names too) is an error, not a throw", () => {
    for (const job of ["__proto__", "constructor", "toString", "museum"]) {
      expect(checkOptions(opts(["--job", job, "--overrides", "{}"])).length).toBeGreaterThan(0);
    }
  });
});

describe("design §17.4 outputs — same seed, same files; files only in the out dir", () => {
  it("default out dir is sim-output; --no-files is none", () => {
    expect(opts([]).outDir).toBe("sim-output");
    expect(opts(["--no-files"]).outDir).toBeNull();
  });

  it("two runs with the same options write byte-identical files, and only the four files", () => {
    const o = opts(["-n", "3", "-p", "2,3,8,12", "-s", "qa-det", "--overrides", '{"heat":{"perRound":4}}']);
    const dirs = [mkdtempSync(join(tmpdir(), "sim-qa-")), mkdtempSync(join(tmpdir(), "sim-qa-"))];
    try {
      for (const d of dirs) {
        const records = runBatch(o);
        writeOutputs(d, records, summarize(records), o);
      }
      const [a, b] = dirs.map((d) => readdirSync(d).sort());
      expect(a).toEqual(["games.csv", "games.json", "players.csv", "summary.json"]);
      expect(b).toEqual(a);
      for (const f of a ?? []) expect(readFileSync(join(dirs[1] as string, f))).toEqual(readFileSync(join(dirs[0] as string, f)));
      // A different seed changes the games.
      const other = runBatch({ ...o, seed: "qa-det-2" });
      expect(JSON.stringify(other) + "\n").not.toBe(readFileSync(join(dirs[0] as string, "games.json"), "utf8"));
    } finally {
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    }
  });
});

// Hand-check: rebuild each record from the engine's state (replaying the log up
// to each checkpoint) and recompute the headline metrics straight from the logs.
describe("design §17.4 metrics — hand-checked against the engine on a fixed set", () => {
  const o = opts(["-n", "4", "-p", "2,3,8,12", "-s", "qa-hand"]);
  const games: { state: GameState; rejections: number; n: number; i: number }[] = [];
  for (const n of o.playerCounts) {
    for (let i = 0; i < o.games; i++) {
      const { config, crew } = setupGame(o, n, i);
      const agents = createBots(config.players, (_s, k) => PERSONALITIES[crew[k] as keyof typeof PERSONALITIES], config.seed);
      const r = runBotGame(config, agents);
      games.push({ state: r.state, rejections: r.rejections.length, n, i });
    }
  }
  const records = games.map((g) => runOne(o, g.n, g.i));

  it("the set covers a failure and shakedowns, with no refused bot commands", () => {
    expect(records.some((r) => r.result === "failed")).toBe(true);
    expect(records.some((r) => r.shakedowns.length > 0)).toBe(true);
    expect(games.every((g) => g.rejections === 0)).toBe(true);
  });

  it("records match the finished state and the checkpoint standings match a replay", () => {
    games.forEach((g, k) => {
      const rec = records[k]!;
      const { state } = g;
      if (state.phase.kind !== "ended") throw new Error("not ended");
      const { outcome } = state.phase;
      expect(rec.result).toBe(outcome.result);
      expect(rec.haul).toBe(state.haul);
      expect(rec.winners).toEqual(outcome.winners);
      for (const p of rec.playerRecords) {
        const ps = state.players[p.id]!;
        expect(p.stash).toBe(ps.stash + ps.safe);
        expect(p.role).toBe(ps.role);
        expect(p.pocketed).toBeLessThanOrEqual(p.looted);
      }
      const roles = rolesFor(state.config);
      const finalTarget = checkpointTarget(jobFor(state.config), 3, rec.players);
      const log = state.log as readonly GameEvent[];
      for (const act of [1, 2] as const) {
        const at = log.findIndex((e) => e.type === "checkpointChecked" && e.act === act);
        const recorded = act === 1 ? rec.afterAct1 : rec.afterAct2;
        if (at < 0) {
          expect(recorded).toBeNull();
          continue;
        }
        const mid = replay(state.config, log.slice(0, at + 1));
        const scores = mid.playerOrder.map((id) => {
          const ps = mid.players[id]!;
          return { id, s: scoreFor(ps, roles[ps.role as keyof typeof roles], Math.max(0, mid.haul - finalTarget)) };
        });
        const top = Math.max(...scores.map((x) => x.s));
        expect(recorded?.topScore).toBe(top);
        // Leaders use the engine's tie-breaks (PR #10 review): a subset of the top scorers.
        expect(recorded?.leaders).toEqual(leadersOf(ranking(mid)));
        for (const id of recorded?.leaders ?? []) expect(scores.find((x) => x.id === id)?.s).toBe(top);
      }
    });
  });

  it("summary metrics equal the same numbers counted from the raw logs", () => {
    const s = summarize(records).overall;
    const ended = games.map((g) => (g.state.phase.kind === "ended" ? g.state.phase.outcome : null)!);
    const failed = ended.filter((e) => e.result === "failed");
    expect(s.games).toBe(16);
    expect(s.successRate).toBe((16 - failed.length) / 16);
    expect(s.heatBustShare).toBe(failed.filter((e) => e.result === "failed" && e.reason === "heat").length / failed.length);
    const sd = games.flatMap((g) => (g.state.log as readonly GameEvent[]).filter((e) => e.type === "shakedownResolved"));
    expect(s.shakedowns.count).toBe(sd.length);
    expect(s.shakedowns.accuracy).toBe(sd.filter((e) => e.type === "shakedownResolved" && !e.clean).length / sd.length);
    // Role win share in successful games: each joint winner gets 1 ÷ winners.
    const insiderSeats = records.filter((r) => r.result === "success").flatMap((r) => r.playerRecords.filter((p) => p.role === "insideMan").map((p) => ({ r, p })));
    const credit = insiderSeats.reduce((t, { r, p }) => t + (r.winners.includes(p.id) ? 1 / r.winners.length : 0), 0);
    expect(s.roles.insideMan?.successWinShare).toBeCloseTo(credit / insiderSeats.length, 12);
    // Per-count summaries partition the games.
    expect(Object.values(summarize(records).byPlayers).reduce((t, m) => t + m.games, 0)).toBe(16);
  });
});
