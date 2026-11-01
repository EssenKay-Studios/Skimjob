// Simulator CLI: runs batches of all-bot games and reports the balance
// metrics. See docs/design.md §17.4 and `pnpm sim -- --help`.
import { resolve } from "node:path";
import { CONTENT_VERSION, ENGINE_VERSION } from "@skimjob/engine";
import { USAGE, invocationDir, parseSimArgs, type SimOptions } from "./args";
import { checkOptions, runBatch } from "./run";
import { summarize } from "./metrics";
import { formatReport } from "./report";
import { prepareOutDir, writeOutputs } from "./output";

function title(o: SimOptions, seconds: number): string {
  const counts = o.playerCounts.length === 1 ? `${o.playerCounts[0]} players` : `players ${o.playerCounts.join(",")}`;
  const mix = o.mix.map((m) => `${m.personality}:${m.weight}`).join(",");
  const settings = [o.job, o.starterMode ? "starter" : `pool ${o.rolePool.length ? o.rolePool.join(",") : "default"}`, `mole ${o.mole}`, `votes ${o.voteVisibility}`, `events ${o.eventsEnabled ? "on" : "off"}`];
  if (o.contentOverrides) settings.push(`overrides ${JSON.stringify(o.contentOverrides)}`);
  return [
    `Skimjob simulator (engine ${ENGINE_VERSION}, content ${CONTENT_VERSION})`,
    `${o.games} games × ${counts}, bots ${mix}, seed "${o.seed}", ${settings.join(", ")} — ${seconds.toFixed(1)}s`,
  ].join("\n");
}

function main(argv: readonly string[]): number {
  const parsed = parseSimArgs(argv);
  if (parsed.kind === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.kind === "error") {
    process.stderr.write(`sim: ${parsed.message}\n\n${USAGE}`);
    return 2;
  }
  const options = parsed.options;
  const errors = checkOptions(options);
  if (errors.length > 0) {
    process.stderr.write(`sim: invalid game settings:\n${errors.map((e) => `  - ${e}`).join("\n")}\n`);
    return 2;
  }

  // Fail before the games run, not after (PR #10 QA).
  const outDir = options.outDir === null ? null : resolve(invocationDir(), options.outDir);
  const outProblem = outDir === null ? null : prepareOutDir(outDir);
  if (outProblem !== null) {
    process.stderr.write(`sim: ${outProblem}\n`);
    return 2;
  }

  const started = performance.now();
  const records = runBatch(options, (n, games) => process.stderr.write(`  ${games} games at ${n} players done\n`));
  const seconds = (performance.now() - started) / 1000;
  const summary = summarize(records);

  if (outDir !== null) {
    try {
      const files = writeOutputs(outDir, records, summary, options);
      process.stderr.write(`  wrote ${files.join(", ")}\n`);
    } catch (e) {
      process.stderr.write(`sim: couldn't write to ${outDir}: ${(e as Error).message}\n`);
      return 1;
    }
  }
  process.stdout.write(options.json ? JSON.stringify(summary, null, 2) + "\n" : "\n" + formatReport(summary, title(options, seconds)));
  return 0;
}

process.exitCode = main(process.argv.slice(2));
