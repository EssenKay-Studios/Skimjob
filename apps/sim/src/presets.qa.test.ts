// QA (PR #51): with the 0.17.0 numbers, the Starter deck
// still plays to the end with no refused bot command, at 3–12 players.
// design §8.1 (Starter), extension.md "Tags, decks and dealing"
import { PERSONALITIES, createBots, runBotGame } from "@skimjob/bots";
import { describe, expect, it } from "vitest";
import { parseSimArgs } from "./args";
import { setupGame } from "./crew";

const opts = (argv: string[]) => {
  const r = parseSimArgs(argv);
  if (r.kind !== "run") throw new Error(JSON.stringify(r));
  return r.options;
};
const PLAYERS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function play(argv: string[], players: readonly number[], games = 2) {
  const o = opts([...argv, "-s", "qa51", "--no-files"]);
  for (const n of players) {
    for (let i = 0; i < games; i++) {
      const { config, crew } = setupGame(o, n, i);
      const r = runBotGame(config, createBots(config.players, (_s, k) => PERSONALITIES[crew[k]!], config.seed));
      expect(r.rejections, `${argv.join(" ")} ${n}p #${i}`).toEqual([]);
      expect(r.state.phase.kind, `${argv.join(" ")} ${n}p #${i}`).toBe("ended");
    }
  }
}

describe("QA #51: the Starter deck still plays at 3–12 players", { timeout: 120_000 }, () => {
  it("Starter deck, events on and off", () => {
    play(["--deck", "starter"], PLAYERS);
    play(["--deck", "starter", "--events"], PLAYERS, 1);
  });
});
