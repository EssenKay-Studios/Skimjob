#!/bin/bash
# usage: merge.sh PR
# Runs the verdicts.sh gate; if MERGEABLE: yes, squash-merges exactly the gated
# head (--match-head-commit) and deletes the branch, then prints one line:
#   merged #N -> main <sha> | next: <first unticked STATUS task>
# Aborts with the gate's reasons otherwise. Docs-only PRs need green CI too.
set -o pipefail
N=$1
[[ $N =~ ^[0-9]+$ ]] || { echo "usage: merge.sh PR_NUMBER" >&2; exit 2; }
REPO=${REPO:-EssenKay-Studios/Skimjob}
export REPO
out=$(bash "$(dirname "$0")/verdicts.sh" "$N"); rc=$?
last=$(tail -1 <<<"$out")
if [ $rc -ne 0 ] || [ "$last" != "MERGEABLE: yes" ]; then
  echo "$out"
  echo "ABORT: #$N not merged ${last#MERGEABLE: no }"
  exit 1
fi
head=$(awk '$1 == "head:" {print $2}' <<<"$out")
[[ $head =~ ^[0-9a-f]{40}$ ]] || { echo "ABORT: could not read the gated head sha" >&2; exit 1; }
# Run outside any clone so gh only deletes the remote branch, not a local
# branch that may be checked out in an agent's worktree.
(cd / && gh pr merge "$N" -R "$REPO" --squash --match-head-commit "$head" --delete-branch) || { echo "ABORT: gh pr merge failed for #$N" >&2; exit 1; }
sha=$(gh pr view "$N" -R "$REPO" --json mergeCommit --jq '.mergeCommit.oid')
next=$(gh api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/docs/STATUS.md?ref=main" \
  | grep -m1 -E '^[0-9]+\. \[ \]' | cut -c1-80)
echo "merged #$N -> main ${sha:0:7} | next: ${next:-<none unticked>}"
