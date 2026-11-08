// QA (PR #10): hostile CLI input, same seed → same files, and the §17.4
// metrics hand-checked against the engine's own state on a small fixed set.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERSONALITIES, createBots, runBotGame } from "@skimjob/bots";
import { BANK_JOB } from "@skimjob/content";
import { honesty, viewFor, type GameEvent, type GameState } from "@skimjob/engine";
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
    ["--deck", "__proto__"], ["--role-list", "toString"], ["--votes", "toString"], ["--bogus"], ["positional"], ["--overrides", '{"alarm":'],
    ["--overrides", "/nonexistent/qa.json"], ["--overrides", ""],
  ];
  it.each(bad.map((a) => [a.join(" "), a]))("%s → error", (_label, argv) => {
    const r = parseSimArgs(argv as string[], () => {
      throw new Error("ENOENT");
    });
    expect(r.kind).toBe("error");
  });

  it("an override file is read through the given reader and parsed", () => {
    const r = parseSimArgs(["--overrides", "x.json"], () => '{"alarm":{"bulbs":5}}');
    expect(r.kind === "run" && r.options.contentOverrides).toEqual({ alarm: { bulbs: 5 } });
  });
});

describe("design §17.4 config overrides — hostile JSON is refused, nothing polluted", () => {
  const hostile = [
    '{"__proto__":{"polluted":1}}',
    '{"rooms":{"__proto__":{"coins":1}}}',
    '{"rooms":{"vault":{"__proto__":{"coins":99}}}}',
    '{"rooms":{"depositBoxes":{"capacity":{"__proto__":{"max":0}}}}}',
    '{"rooms":{"constructor":{"coins":1}}}',
    '{"alarm":{"__proto__":{"bulbs":1}}}',
    '{"alarm":{"constructor":1}}',
    '{"roundCap":{"__proto__":12}}',
    '{"shakedown":{"__proto__":{"cleanBelowPerAct":0}}}',
    '{"roles":{"__proto__":{"stashMultiplier":9}}}',
    '{"roles":{"rookie":{"__proto__":{"stashMultiplier":9}}}}',
    '{"roles":{"toString":{}}}',
    '{"alarm":{"bulbs":0}}', '{"alarm":{"bulbs":"5"}}', '{"rooms":{"vault":{"coins":1.5}}}', '{"rooms":{"vault":{"coins":-1}}}',
    '{"roundCap":0}', '{"roundCap":"12"}', '{"roundCap":2.5}', '{"checkpoints":{"perPlayer":[1,2,3]}}', '{"roles":{"lookout":{"perStretch":1}}}',
    '{"rooms":{"vault":{"capacity":{"max":2}}}}', '{"rooms":[]}', '{"alarm":null}',
  ];
  it.each(hostile)("%s", (json) => {
    const o = opts(["-p", "3,12", "--overrides", json]);
    expect(checkOptions(o).length).toBeGreaterThan(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).coins).toBeUndefined();
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
    const o = opts(["-n", "3", "-p", "3,8,12", "-s", "qa-det", "--overrides", '{"alarm":{"bulbs":5}}']);
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

// Hand-check: rebuild each record from the engine's state and recompute the headline metrics straight from the logs.
describe("design §17.4 metrics — hand-checked against the engine on a fixed set", () => {
  const o = opts(["-n", "4", "-p", "3,8,12", "-s", "qa-hand"]);
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

  it("records match the finished state, and the bank, the round cap or a bust ended it", () => {
    games.forEach((g, k) => {
      const rec = records[k]!;
      const { state } = g;
      if (state.phase.kind !== "ended") throw new Error("not ended");
      const { outcome } = state.phase;
      expect(rec.result).toBe(outcome.result);
      expect(rec.honesty).toBe(honesty(viewFor(state, state.playerOrder[0]!).honesty));
      expect(rec.winners).toEqual(outcome.winners);
      for (const p of rec.playerRecords) {
        const ps = state.players[p.id]!;
        expect(p.stash).toBe(ps.stash);
        expect(p.role).toBe(ps.role);
        expect(p.pocketed).toBeLessThanOrEqual(p.grabbed);
      }
      // design §6.2: the bank, the round cap or a bust ended it, in the round recorded.
      expect(rec.endedRound).toBe(state.resolvedRound);
      if (rec.reason !== "bust") expect(state.bank === 0 || rec.endedRound === BANK_JOB.roundCap).toBe(true);
      expect(rec.bankLeft).toBe(state.bank);
    });
  });

  it("summary metrics equal the same numbers counted from the raw logs", () => {
    const s = summarize(records).overall;
    const ended = games.map((g) => (g.state.phase.kind === "ended" ? g.state.phase.outcome : null)!);
    const failed = ended.filter((e) => e.result === "failed");
    expect(s.games).toBe(12);
    expect(s.successRate).toBe((12 - failed.length) / 12);
    expect(s.bustRate).toBe(failed.filter((e) => e.result === "failed" && e.reason === "bust").length / 12);
    expect(s.raids.perGame).toBe(games.reduce((n, g) => n + g.state.log.filter((e) => e.type === "roomRaided").length, 0) / 12);
    const sd = games.flatMap((g) => (g.state.log as readonly GameEvent[]).filter((e) => e.type === "shakedownResolved"));
    expect(s.shakedowns.count).toBe(sd.length);
    expect(s.shakedowns.accuracy).toBe(sd.filter((e) => e.type === "shakedownResolved" && !e.clean).length / sd.length);
    // Role win share in successful games: each joint winner gets 1 ÷ winners.
    const lookoutSeats = records.filter((r) => r.result === "success").flatMap((r) => r.playerRecords.filter((p) => p.role === "lookout").map((p) => ({ r, p })));
    const credit = lookoutSeats.reduce((t, { r, p }) => t + (r.winners.includes(p.id) ? 1 / r.winners.length : 0), 0);
    expect(s.roles.lookout?.successWinShare).toBeCloseTo(credit / lookoutSeats.length, 12);
    // Per-count summaries partition the games.
    expect(Object.values(summarize(records).byPlayers).reduce((t, m) => t + m.games, 0)).toBe(12);
  });
});
