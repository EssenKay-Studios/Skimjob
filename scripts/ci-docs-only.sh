#!/usr/bin/env bash
# Reads changed paths (one per line) on stdin; prints `true` if every one is a
# `*.md` file, else `false`. An empty list is `false` (fail safe). Used by CI's
# `changes` job.
set -euo pipefail
n=0
while IFS= read -r f || [ -n "$f" ]; do
  [ -z "$f" ] && continue
  n=$((n + 1))
  case "$f" in
    *.md) ;;
    *) echo false; exit 0 ;;
  esac
done
[ "$n" -gt 0 ] && echo true || echo false
