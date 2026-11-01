#!/bin/bash
# usage: merge.sh PR_NUMBER BRANCH  -> rebase-merge, verify main green, print one line
set -e
N=$1; B=$2; R=repos/EssenKay-Studios/Skimjob; cd ${CLONE:-/home/claude/skimjob}
git fetch -q origin +refs/heads/$B:refs/remotes/origin/$B +refs/heads/main:refs/remotes/origin/main
if git log --format=%B origin/main..origin/$B | grep -qiE "co-authored-by|claude-session"; then echo "ABORT: attribution lines on branch"; exit 1; fi
gh api -X PUT $R/pulls/$N/merge -f merge_method=${3:-rebase} --jq '.merged' >/dev/null
git fetch -q origin +refs/heads/main:refs/remotes/origin/main
git checkout -q -B main origin/main
if [ -z "$FAST" ]; then pnpm install --silent >/dev/null 2>&1
T=$(pnpm test 2>&1 | grep -E "^\s+Tests" | tr -s ' ')
pnpm typecheck >/dev/null 2>&1 && TC=ok || TC=FAIL
else T=" (local tests skipped; CI on main checked separately)"; TC=skipped; fi
echo "merged #$N -> main $(git rev-parse --short HEAD) |$T | typecheck $TC | next: $(grep -m1 -E '^[0-9]+\. \[ \]' docs/STATUS.md | cut -c1-80)"
