#!/usr/bin/env bash
# Simulator smoke test (CI): all-bot games at 3, 6 and 12 players with events,
# every role dealt by the standard deal; fails if any game errors or any bot command is refused.
# Usage: bash scripts/sim-smoke.sh [games-per-size]   (default 200). docs/testing.md
set -euo pipefail
games="${1:-200}"
out="$(mktemp)"
trap 'rm -f "$out"' EXIT
pnpm -s sim -- -n "$games" -p 3,6,12 --events --seed ci-smoke --no-files --json > "$out"
node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).overall;
  const want = 3 * Number(process.argv[2]);
  console.log(`sim smoke: ${s.games} games, success ${(100 * s.successRate).toFixed(1)}%, refused bot commands ${s.rejections}`);
  if (s.games !== want) { console.error(`expected ${want} games`); process.exit(1); }
  if (s.rejections !== 0) { console.error("bots sent refused commands (should be 0)"); process.exit(1); }
' "$out" "$games"
