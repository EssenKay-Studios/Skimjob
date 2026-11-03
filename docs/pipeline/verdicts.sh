#!/bin/bash
# usage: verdicts.sh PR
# Prints the PR head, the latest reviewer and QA verdicts with the head each names,
# commits since the review, CI on the head, authorship, and a last line
# `MERGEABLE: yes|no (<reasons>)`. Exit 0 if mergeable, 1 if not (including any
# gh/API error: the gate fails closed), 2 on bad input.
# Read-only. Works from any directory (REPO overrides the repo).
#
# Mergeable iff: the latest review mentioning VERDICT is exactly
# `VERDICT: APPROVE` + `Head: <sha S_r>` (a malformed latest one is a no, never a
# fall-back to an older one); the latest comment mentioning `QA:` is exactly
# `QA: PASS` + `Head: <current head>`; every commit (old and new paths) in
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

# Any gh failure (on any page) is a no: never fall back to partial or older data.
fatal() { echo "MERGEABLE: no ($1)"; exit 1; }

pr=$(gh pr view "$N" -R "$REPO" --json headRefOid,isDraft,mergeStateStatus,state \
  --jq '[.headRefOid, .isDraft, .mergeStateStatus, .state] | @tsv') || fatal "cannot read PR #$N"
IFS=$'\t' read -r head draft mstate state <<<"$pr"
[[ $head =~ ^[0-9a-f]{40}$ ]] || fatal "cannot read the head sha of PR #$N"
# GitHub computes the merge state lazily; ask again once if it is still UNKNOWN.
if [ "$mstate" = UNKNOWN ]; then
  sleep 3
  mstate=$(gh pr view "$N" -R "$REPO" --json mergeStateStatus --jq .mergeStateStatus) || fatal "cannot read the merge state"
fi
echo "PR #$N  state $state  draft $draft  merge-state $mstate"
echo "head:   $head"
[ "$state" = OPEN ] || no "PR is $state"
[ "$draft" = false ] || no "PR is a draft"
[ "$mstate" = CLEAN ] || no "merge state $mstate (want CLEAN)"

# One line per review / comment that looks like a verdict (mentions "verdict", or
# "qa:", anywhere, any case, e.g. `**Verdict: approve**`, `> qa: fail`): its first two raw lines. The newest
# one is used and must be in the exact format; there is no fall-back to older ones.
first2='(.body | gsub("\r"; "") | split("\n")) as $l | [$l[0], ($l[1] // "")] | @tsv'
rvs=$(gh api --paginate "$A/pulls/$N/reviews" \
  --jq ".[] | select((.body // \"\") | test(\"verdict\"; \"i\")) | $first2") || fatal "cannot read reviews"
qas=$(gh api --paginate "$A/issues/$N/comments" \
  --jq ".[] | select((.body // \"\") | test(\"\\\\bqa\\\\s*:\"; \"i\")) | $first2") || fatal "cannot read PR comments"
IFS=$'\t' read -r rv1 rv2 <<<"$(tail -1 <<<"$rvs")"
IFS=$'\t' read -r qa1 qa2 <<<"$(tail -1 <<<"$qas")"
sha_of() { [[ $1 =~ ^Head:\ ([0-9a-f]{40})[[:space:]]*$ ]] && echo "${BASH_REMATCH[1]}"; }
rsha=$(sha_of "$rv2"); qsha=$(sha_of "$qa2")
echo "review: ${rv1:-none}  @ ${rsha:-<no Head: line>}"
echo "qa:     ${qa1:-none}  @ ${qsha:-<no Head: line>}"

case "$rv1" in
  "VERDICT: APPROVE") [ -n "$rsha" ] || no "review has no 'Head: <40-char sha>' second line" ;;
  "VERDICT: CHANGES REQUESTED") rsha=; no "review is CHANGES REQUESTED" ;;
  "") rsha=; no "no reviewer verdict" ;;
  *) rsha=; no "malformed latest verdict: '${rv1:0:60}' (want 'VERDICT: APPROVE' / 'VERDICT: CHANGES REQUESTED')" ;;
esac
case "$qa1" in
  "QA: PASS")
    if [ -z "$qsha" ]; then no "QA has no 'Head: <40-char sha>' second line"
    elif [ "$qsha" != "$head" ]; then no "QA PASS is for ${qsha:0:7}, head is ${head:0:7}"; fi ;;
  "QA: FAIL") no "QA is FAIL" ;;
  "") no "no QA verdict" ;;
  *) no "malformed latest QA verdict: '${qa1:0:60}' (want 'QA: PASS' / 'QA: FAIL')" ;;
esac

# Commits pushed after the reviewed sha: only QA's test files may change
# (*.qa.test.ts unit tests and *.qa.spec.ts e2e specs).
if [ -n "$rsha" ] && [ "$rsha" != "$head" ]; then
  # compare lists at most 250 commits: more than that is a no (total_commits check).
  cmp=$(gh api "$A/compare/$rsha...$head" \
    --jq '[.status, (.total_commits | tostring), ([.commits[].sha] | join(" "))] | @tsv' 2>/dev/null) || cmp=
  IFS=$'\t' read -r cstatus ctotal csha <<<"$cmp"
  if [ -z "$cmp" ]; then
    echo "since review: cannot compare ${rsha:0:7}...${head:0:7}"
    no "cannot compare reviewed sha ${rsha:0:7} with head: re-review needed"
  elif [ "$cstatus" != ahead ]; then
    echo "since review: reviewed sha is not an ancestor of head (${cstatus:-unknown})"
    no "reviewed sha ${rsha:0:7} is not behind head (${cstatus:-not found}): re-review needed"
  else
    bad=(); apierr=
    for c in $csha; do
      # Old and new path of every file (renames, removals too) must be a QA test file.
      if ! files=$(gh api --paginate "$A/commits/$c" --jq '.files[] | .filename, (.previous_filename // empty)'); then
        apierr+=" ${c:0:7}"; continue
      fi
      # A commit with no files (e.g. an empty merge) also needs a look.
      if [ -z "$files" ] || grep -qvE '\.qa\.(test|spec)\.ts$' <<<"$files"; then bad+=("${c:0:7}"); fi
    done
    n=$(wc -w <<<"$csha" | tr -d ' ')
    if [ -n "$apierr" ]; then
      echo "since review: cannot read commit(s)$apierr"
      no "cannot read commit(s)$apierr since review"
    elif [ "$ctotal" != "$n" ] || [ "$n" -eq 0 ]; then
      echo "since review: compare listed $n of ${ctotal:-?} commits"
      no "cannot list all commits since review ($n of ${ctotal:-?}): re-review needed"
    elif [ ${#bad[@]} -gt 0 ]; then
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
  --jq '.check_runs[] | [.name, .status, (.conclusion // "")] | @tsv') || fatal "cannot read check-runs on head"
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
   ((.messageHeadline + "\n" + .messageBody) | test("(?im)^\\s*(co-authored-by|claude-session|generated-by)")) ] | @tsv') || fatal "cannot read the PR's commits"
[ -n "$commits" ] || fatal "no commits read for PR #$N"
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
