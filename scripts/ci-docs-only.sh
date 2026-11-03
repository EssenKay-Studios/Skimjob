#!/usr/bin/env bash
# Reads changed paths (one per line) on stdin; prints `true` if every one is
# documentation, else `false`. An empty list is `false` (fail safe).
# Docs: any `*.md`, and anything under `docs/` except non-`.md` files under
# `docs/pipeline/` (the gate scripts and their test). Used by CI's `changes` job.
set -euo pipefail
n=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  n=$((n + 1))
  case "$f" in
    *.md) ;;
    docs/pipeline/*) echo false; exit 0 ;;
    docs/*) ;;
    *) echo false; exit 0 ;;
  esac
done
[ "$n" -gt 0 ] && echo true || echo false
