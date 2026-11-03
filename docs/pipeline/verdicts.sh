#!/bin/bash
# usage: verdicts.sh PR
# Prints the PR head, the latest reviewer and QA verdicts with the head each names,
# commits since the review, CI on the head, authorship, and a last line
# `MERGEABLE: yes|no (<reasons>)`. Exit 0 if mergeable, 1 if not, 2 on bad input.
# Read-only. Works from any directory (REPO overrides the repo).
#
# Mergeable iff: latest `VERDICT:` review is APPROVE and names `Head: <sha S_r>`;
# latest `QA:` comment is PASS and names the current head; every commit in
# S_r..head touches only *.qa.test.ts / *.qa.spec.ts (else a delta re-review is needed); every
# check-run on the head completed as success/skipped/neutral; PR open, not draft,
# merge state CLEAN; every commit authored by karthik24iyer <karthik24iyer@gmail.com>
# and no commit message has a co-authored-by / claude-session / generated-by line.
set -o pipefail
N=$1
[[ $N =~ ^[0-9]+$ ]] || { echo "usage: verdicts.sh PR_NUMBER" >&2; exit 2; }
REPO=${REPO:-EssenKay-Studios/Skimjob}
A=repos/$REPO
AUTHOR_NAME=karthik24iyer
AUTHOR_EMAIL=karthik24iyer@gmail.com
reasons=()
no() { reasons+=("$1"); }
# join SEP ITEMS...
join() { local sep=$1 out=$2; shift 2; for x in "$@"; do out+="$sep$x"; done; echo "$out"; }

pr=$(gh pr view "$N" -R "$REPO" --json headRefOid,isDraft,mergeStateStatus,state \
  --jq '[.headRefOid, .isDraft, .mergeStateStatus, .state] | @tsv') || { echo "cannot read PR #$N" >&2; exit 2; }
IFS=$'\t' read -r head draft mstate state <<<"$pr"
# GitHub computes the merge state lazily; ask again once if it is still UNKNOWN.
if [ "$mstate" = UNKNOWN ]; then
  sleep 3
  mstate=$(gh pr view "$N" -R "$REPO" --json mergeStateStatus --jq .mergeStateStatus)
fi
echo "PR #$N  state $state  draft $draft  merge-state $mstate"
echo "head:   $head"
[ "$state" = OPEN ] || no "PR is $state"
[ "$draft" = false ] || no "PR is a draft"
[ "$mstate" = CLEAN ] || no "merge state $mstate (want CLEAN)"

# First two lines of the latest body starting with PREFIX: "<line1>\t<line2>".
first2='(.body | gsub("\r"; "") | split("\n")) as $l | [$l[0], ($l[1] // "")] | @tsv'
rv=$(gh api --paginate "$A/pulls/$N/reviews" \
  --jq ".[] | select(.body | startswith(\"VERDICT: \")) | $first2" | tail -1)
qa=$(gh api --paginate "$A/issues/$N/comments" \
  --jq ".[] | select(.body | startswith(\"QA: \")) | $first2" | tail -1)
IFS=$'\t' read -r rv1 rv2 <<<"$rv"
IFS=$'\t' read -r qa1 qa2 <<<"$qa"
sha_of() { [[ $1 =~ ^Head:\ ([0-9a-f]{40})[[:space:]]*$ ]] && echo "${BASH_REMATCH[1]}"; }
rsha=$(sha_of "$rv2"); qsha=$(sha_of "$qa2")
echo "review: ${rv1:-none}  @ ${rsha:-<no Head: line>}"
echo "qa:     ${qa1:-none}  @ ${qsha:-<no Head: line>}"

case "$rv1" in
  "VERDICT: APPROVE") [ -n "$rsha" ] || no "review has no 'Head: <40-char sha>' second line" ;;
  "") no "no reviewer verdict" ;;
  *) no "review is '${rv1#VERDICT: }'" ;;
esac
case "$qa1" in
  "QA: PASS")
    if [ -z "$qsha" ]; then no "QA has no 'Head: <40-char sha>' second line"
    elif [ "$qsha" != "$head" ]; then no "QA PASS is for ${qsha:0:7}, head is ${head:0:7}"; fi ;;
  "") no "no QA verdict" ;;
  *) no "QA is '${qa1#QA: }'" ;;
esac

# Commits pushed after the reviewed sha: only QA's test files may change
# (*.qa.test.ts unit tests and *.qa.spec.ts e2e specs).
if [ -n "$rsha" ] && [ "$rsha" != "$head" ]; then
  cmp=$(gh api "$A/compare/$rsha...$head" --jq '[.status, ([.commits[].sha] | join(" "))] | @tsv' 2>/dev/null) || cmp=
  IFS=$'\t' read -r cstatus csha <<<"$cmp"
  if [ "$cstatus" != ahead ]; then
    echo "since review: reviewed sha is not an ancestor of head (${cstatus:-unknown})"
    no "reviewed sha ${rsha:0:7} is not behind head (${cstatus:-not found}): re-review needed"
  else
    bad=()
    for c in $csha; do
      files=$(gh api "$A/commits/$c" --jq '.files[].filename')
      # A commit with no files (e.g. an empty merge) also needs a look.
      if [ -z "$files" ] || grep -qvE '\.qa\.(test|spec)\.ts$' <<<"$files"; then bad+=("${c:0:7}"); fi
    done
    n=$(wc -w <<<"$csha" | tr -d ' ')
    if [ ${#bad[@]} -gt 0 ]; then
      echo "since review: $n commit(s); non-QA changes in ${bad[*]}"
      no "commits since review touch more than QA tests (${bad[*]}): delta re-review needed"
    else
      echo "since review: $n QA-test-only commit(s)"
    fi
  fi
elif [ -n "$rsha" ]; then
  echo "since review: none (review is on head)"
fi

# CI: latest check-run per name on the head.
runs=$(gh api --paginate "$A/commits/$head/check-runs?per_page=100" \
  --jq '.check_runs[] | [.name, .status, (.conclusion // "")] | @tsv')
total=0; failing=(); pending=()
while IFS=$'\t' read -r name st concl; do
  [ -z "$name" ] && continue
  total=$((total + 1))
  if [ "$st" != completed ]; then pending+=("$name")
  else case "$concl" in success|skipped|neutral) ;; *) failing+=("$name ($concl)") ;; esac; fi
done <<<"$runs"
if [ $total -eq 0 ]; then echo "ci:     no check-runs on head"; no "no CI check-runs on head"
elif [ ${#failing[@]} -eq 0 ] && [ ${#pending[@]} -eq 0 ]; then echo "ci:     green ($total check-runs)"
else
  echo "ci:     $total check-runs"
  [ ${#failing[@]} -gt 0 ] && { printf '  failing: %s\n' "${failing[@]}"; no "CI failing: $(join ", " "${failing[@]}")"; }
  [ ${#pending[@]} -gt 0 ] && { printf '  pending: %s\n' "${pending[@]}"; no "CI pending: $(join ", " "${pending[@]}")"; }
fi

# Authorship and attribution lines, every commit on the branch.
commits=$(gh pr view "$N" -R "$REPO" --json commits --jq '.commits[] |
  [.oid[0:7], ([.authors[] | "\(.name) <\(.email)>"] | join(", ")),
   ((.messageHeadline + "\n" + .messageBody) | test("(?im)^\\s*(co-authored-by|claude-session|generated-by)")) ] | @tsv')
badauth=(); badmsg=()
while IFS=$'\t' read -r c who attr; do
  [ -z "$c" ] && continue
  [ "$who" = "$AUTHOR_NAME <$AUTHOR_EMAIL>" ] || badauth+=("$c: $who")
  [ "$attr" = true ] && badmsg+=("$c")
done <<<"$commits"
if [ ${#badauth[@]} -eq 0 ] && [ ${#badmsg[@]} -eq 0 ]; then echo "commits: $(grep -c . <<<"$commits") ok (author $AUTHOR_NAME, no attribution lines)"
else
  [ ${#badauth[@]} -gt 0 ] && { printf 'commits: wrong author %s\n' "${badauth[@]}"; no "commits not authored by $AUTHOR_NAME <$AUTHOR_EMAIL>"; }
  [ ${#badmsg[@]} -gt 0 ] && { echo "commits: attribution lines in ${badmsg[*]}"; no "attribution lines in ${badmsg[*]}"; }
fi

if [ ${#reasons[@]} -eq 0 ]; then echo "MERGEABLE: yes"; exit 0; fi
echo "MERGEABLE: no ($(join "; " "${reasons[@]}"))"
exit 1
