// SCRATCH, not committed: room choice by personality, Heat curve.
import { parseSimArgs as parseArgs } from "./src/args";
import { setupGame } from "./src/crew";
import { PERSONALITIES, createBots, runBotGame } from "@skimjob/bots";

const argv = process.argv.slice(2);
const opts = parseArgs(argv);
if (!("options" in opts)) throw new Error(JSON.stringify(opts));
const options = (opts as any).options;
const rooms: Record<string, Record<string, number>> = {};
const heatByRound: number[][] = [];
let n = 0; let lootSum = 0; let lootN = 0;
for (const players of options.playerCounts) {
  for (let i = 0; i < options.games; i++) {
    const { config, crew } = setupGame(options, players, i);
    const agents = createBots(config.players, (_s, k) => PERSONALITIES[crew[k] as keyof typeof PERSONALITIES], config.seed);
    const { state } = runBotGame(config, agents);
    n++;
    const pers = new Map(config.players.map((s, k) => [s.id, crew[k] as string]));
    for (const e of state.log) {
      if (e.type === "moveSubmitted" || e.type === "defaultMoveAssigned") {
        const p = pers.get(e.player)!;
        rooms[p] ??= {};
        rooms[p][e.move.room] = (rooms[p][e.move.room] ?? 0) + 1;
      }
      if (e.type === "roundResolved") (heatByRound[e.round] ??= []).push(e.heat);
      if (e.type === "lootSplit") { lootSum += e.loot; lootN++; }
    }
  }
}
for (const [p, r] of Object.entries(rooms)) {
  const t = Object.values(r).reduce((a, b) => a + b, 0);
  console.log(p.padEnd(12), Object.entries(r).sort().map(([k, v]) => `${k}:${((100 * v) / t).toFixed(0)}%`).join(" "));
}
console.log("mean heat by round", heatByRound.slice(1).map((h) => (h.reduce((a, b) => a + b, 0) / h.length).toFixed(0)).join(" "));
console.log("mean loot per player-round", (lootSum / lootN).toFixed(2), "splits", lootN);
