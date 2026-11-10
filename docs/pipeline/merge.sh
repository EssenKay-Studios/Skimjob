#!/bin/bash
# usage: merge.sh PR
# Runs the verdicts.sh gate; if MERGEABLE: yes, squash-merges exactly the gated
# head (REST `PUT pulls/N/merge` with sha=<head>, so a newer push is refused) and
# deletes the branch, then prints one line:
#   merged #N -> main <sha> | next: #<lowest open R7 Task issue>
# Aborts with the gate's reasons otherwise. Docs-only PRs need green CI too.
# GitHub REST API only (`gh api`), like verdicts.sh: works on the Mac and in cloud sessions.
set -o pipefail
N=$1
[[ $N =~ ^[0-9]+$ ]] || { echo "usage: merge.sh PR_NUMBER" >&2; exit 2; }
REPO=${REPO:-EssenKay-Studios/Skimjob}
export REPO
A=repos/$REPO
out=$(bash "$(dirname "$0")/verdicts.sh" "$N"); rc=$?
last=$(tail -1 <<<"$out")
if [ $rc -ne 0 ] || [ "$last" != "MERGEABLE: yes" ]; then
  echo "$out"
  echo "ABORT: #$N not merged ${last#MERGEABLE: no }"
  exit 1
fi
head=$(awk '$1 == "head:" {print $2}' <<<"$out")
[[ $head =~ ^[0-9a-f]{40}$ ]] || { echo "ABORT: could not read the gated head sha" >&2; exit 1; }
ref=$(gh api "$A/pulls/$N" --jq '[.head.ref, .head.repo.full_name] | @tsv') || { echo "ABORT: cannot read the branch of #$N" >&2; exit 1; }
IFS=$'\t' read -r branch headrepo <<<"$ref"
sha=$(gh api -X PUT "$A/pulls/$N/merge" -f merge_method=squash -f sha="$head" --jq .sha) \
  || { echo "ABORT: merge failed for #$N (head moved or not mergeable)" >&2; exit 1; }
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "ABORT: merge of #$N returned no commit sha" >&2; exit 1; }
# Delete the remote branch only (never a local one an agent's worktree has checked out),
# and only when it lives in this repo.
if [ "$headrepo" = "$REPO" ] && [ -n "$branch" ]; then
  gh api -X DELETE "$A/git/refs/heads/$branch" >/dev/null 2>&1 || echo "warning: could not delete branch $branch" >&2
fi
# Next task: the lowest-numbered open issue of Type Task in the R7 milestone (REST). Fail-safe.
next=$(gh api "$A/issues?milestone=${MILESTONE:-1}&state=open&type=Task&per_page=100" \
  --jq '[.[] | select(.pull_request == null)] | if length == 0 then empty else (min_by(.number) | "#\(.number) \(.title)") end' 2>/dev/null | cut -c1-80) || next=
[ -n "$next" ] || next="see the board"
echo "merged #$N -> main ${sha:0:7} | next: $next"
