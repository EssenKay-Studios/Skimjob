#!/bin/bash
# usage: bash docs/pipeline/gate.qa.test.sh
# Offline tests for verdicts.sh / merge.sh: a fake `gh` first on PATH serves canned JSON
# (filtered with jq, as gh's --jq would), records the merge PUT and branch DELETE, and
# refuses anything that isn't `gh api` REST (the scripts must run where GraphQL is blocked). Needs jq.
set -u
DIR=$(cd "$(dirname "$0")" && pwd)
WORK=$(cd "$DIR/../.." && pwd)/.gate-qa-test
rm -rf "$WORK"; mkdir -p "$WORK/bin"; trap 'rm -rf "$WORK"' EXIT
FIX=$WORK/fix
cat >"$WORK/bin/gh" <<'EOF'
#!/bin/bash
# REST only: anything but `gh api` (gh pr …, GraphQL) is a test failure.
FIX=${GATE_FIX:?}
q=.; path=; method=GET; sub=$1
[ "$sub" = api ] || { echo "fake gh: not REST: $*" >&2; echo "$*" >>"$FIX/NOT_REST"; exit 1; }
shift
while [ $# -gt 0 ]; do
  case $1 in --jq) q=$2; shift ;; -X) method=$2; shift ;; -H|-f|-F) shift ;; --paginate) ;;
    repos/*) path=${1%%\?*} ;; graphql) echo graphql >>"$FIX/NOT_REST"; exit 1 ;; esac; shift
done
case "$method $path" in
  "PUT "*/pulls/*/merge) echo merged >"$FIX/MERGED"; f=merge.json ;;
  "DELETE "*/git/refs/heads/*) echo "${path#*/git/refs/heads/}" >"$FIX/DELETED"; exit 0 ;;
  "GET "*/pulls/*/reviews) f=reviews.json ;; "GET "*/issues/*/comments) f=comments.json ;;
  "GET "*/pulls/*/commits) f=pr-commits.json ;; "GET "*/pulls/*) f=pr.json ;;
  "GET "*/compare/*) f=compare.json ;; "GET "*/check-runs) f=checks.json ;; "GET "*/status) f=status.json ;;
  "GET "*/commits/*) f=commit-${path##*/}.json ;; "GET "*/contents/*) exit 0 ;;
  *) echo "fake gh: unexpected: $method $path" >&2; exit 1 ;;
esac
[ -f "$FIX/$f" ] || { echo "fake gh: no $f" >&2; exit 1; }
# fail-<file>: print the data (an earlier page), then fail (a later page).
if [ -f "$FIX/fail-$f" ]; then jq -r "$q" "$FIX/$f"; echo "fake gh: HTTP 502" >&2; exit 1; fi
jq -r "$q" "$FIX/$f"
EOF
chmod +x "$WORK/bin/gh"
export PATH=$WORK/bin:$PATH GATE_FIX=$FIX

H=$(printf 'a%.0s' {1..40}); R=$(printf 'b%.0s' {1..40}); C=$(printf 'c%.0s' {1..40})
OK_AUTHOR='{"name":"karthik24iyer","email":"karthik24iyer@gmail.com"}'
# Fixture defaults: everything mergeable at head H.
reset() {
  rm -rf "$FIX"; mkdir -p "$FIX"
  draft=false; mstate=clean; mable=true; state=open; merged=false; authors=$OK_AUTHOR; body=""
  review="VERDICT: APPROVE\nHead: $H"; qa="QA: PASS\nHead: $H"; review_new=""; qa_new=""
  review_new_by=karthik24iyer; qa_new_by=karthik24iyer; review_new_state=COMMENTED
  qa_as_review=""; review_as_comment=""; statuses=""
  checks='{"name":"Typecheck","status":"completed","conclusion":"success"}'
  compare_status=ahead; since_files='["apps/web/src/x.qa.test.ts"]'; prev=""
}
write() {
  cat >"$FIX/pr.json" <<J
{"head":{"sha":"$H","ref":"feat/x","repo":{"full_name":"EssenKay-Studios/Skimjob"}},"draft":$draft,
 "mergeable_state":"$mstate","mergeable":$mable,"state":"$state","merged":$merged}
J
  jq -n --arg c "$C" --argjson a "$authors" --arg m "feat: x\n\n$body" \
    '[{sha: $c, commit: {author: $a, message: ($m | gsub("\\\\n"; "\n"))}}]' >"$FIX/pr-commits.json"
  echo "{\"merged\":true,\"sha\":\"$(printf 'd%.0s' {1..40})\"}" >"$FIX/merge.json"
  # *_new: a newer review / comment after the first one.
  # Times: review, then QA, then the *_new ones, then the cross-channel ones (newest).
  jq -n --arg a "$review" --arg b "$review_new" --arg by "$review_new_by" --arg st "$review_new_state" --arg x "$qa_as_review" '[
      {body: $a, user: {login: "karthik24iyer"}, state: "COMMENTED", submitted_at: "2026-01-01T00:00:01Z"},
      {body: $b, user: {login: $by}, state: $st, submitted_at: "2026-01-01T00:00:03Z"},
      {body: $x, user: {login: "karthik24iyer"}, state: "COMMENTED", submitted_at: "2026-01-01T00:00:05Z"}
    ] | map(select(.body != "") | .body |= gsub("\\\\n"; "\n"))' >"$FIX/reviews.json"
  jq -n --arg a "$qa" --arg b "$qa_new" --arg by "$qa_new_by" --arg x "$review_as_comment" '[
      {body: $a, user: {login: "karthik24iyer"}, created_at: "2026-01-01T00:00:02Z"},
      {body: $b, user: {login: $by}, created_at: "2026-01-01T00:00:04Z"},
      {body: $x, user: {login: "karthik24iyer"}, created_at: "2026-01-01T00:00:06Z"}
    ] | map(select(.body != "") | .body |= gsub("\\\\n"; "\n"))' >"$FIX/comments.json"
  echo "{\"statuses\":[$statuses]}" >"$FIX/status.json"
  echo "{\"check_runs\":[$checks]}" >"$FIX/checks.json"
  echo "{\"status\":\"$compare_status\",\"total_commits\":1,\"commits\":[{\"sha\":\"$C\"}]}" >"$FIX/compare.json"
  jq -n --argjson f "$since_files" --arg p "$prev" \
    '{files: [$f[] | {filename: .} + (if $p == "" then {} else {previous_filename: $p, status: "renamed"} end)]}' \
    >"$FIX/commit-$C.json"
}
fails=0
# expect yes|no NAME: runs verdicts.sh and merge.sh; merge must be attempted iff yes.
expect() {
  write
  out=$(bash "$DIR/verdicts.sh" 1); rc=$?
  mout=$(bash "$DIR/merge.sh" 1 2>&1)
  did=no; [ -f "$FIX/MERGED" ] && did=yes
  want_rc=1; [ "$1" = yes ] && want_rc=0
  why=
  [ $rc -eq $want_rc ] && [ $did = "$1" ] || why="verdicts rc=$rc, merge called=$did"
  [ -f "$FIX/NOT_REST" ] && why="non-REST gh call: $(head -1 "$FIX/NOT_REST")"
  if [ "$1" = yes ] && [ -z "$why" ]; then
    [ "$(cat "$FIX/DELETED" 2>/dev/null)" = feat/x ] || why="branch not deleted"
    [[ $(tail -1 <<<"$mout") == "merged #1 -> main ddddddd | next: "* ]] || why="merge line: $(tail -1 <<<"$mout")"
  fi
  if [ -z "$why" ]; then echo "ok   $2"
  else echo "FAIL $2 ($why)"; echo "$out" | tail -1; fails=$((fails + 1)); fi
}

reset; expect yes "all green, review and QA on head"
reset; review="VERDICT: APPROVE\nHead: $R"; expect yes "approved older sha, only *.qa.test.ts since"
reset; review="VERDICT: APPROVE\nHead: $R"; since_files='["apps/web/e2e/notes.qa.spec.ts"]'; expect yes "approved older sha, only *.qa.spec.ts since"
reset; review=""; expect no "no reviews"
reset; review="VERDICT: APPROVE"; expect no "APPROVE without Head line"
reset; review="VERDICT: APPROVE\nHead: ${H:0:7}"; expect no "APPROVE with short sha"
reset; review="VERDICT: REQUEST_CHANGES\nHead: $H"; expect no "latest review requests changes"
reset; review="VERDICT: APPROVE\nHead: $R"; since_files='["packages/engine/src/rules.ts","x.qa.test.ts"]'; expect no "approved older sha, non-QA commit since"
reset; review="VERDICT: APPROVE\nHead: $R"; since_files='[]'; expect no "approved older sha, empty commit since"
reset; review="VERDICT: APPROVE\nHead: $R"; since_files='["src/x.qa.test.tsx"]'; expect no "approved older sha, .qa.test.tsx is not a QA file"
reset; review="VERDICT: APPROVE\nHead: $R"; compare_status=diverged; expect no "reviewed sha not an ancestor (rebase)"
reset; qa=""; expect no "no QA verdict"
reset; qa="QA: PASS\nHead: $R"; expect no "QA PASS on stale head"
reset; qa="QA: FAIL\nHead: $H"; expect no "QA FAIL"
reset; checks='{"name":"e2e","status":"in_progress","conclusion":null}'; expect no "CI pending"
reset; checks='{"name":"e2e","status":"completed","conclusion":"failure"}'; expect no "CI failing"
reset; checks='{"name":"e2e","status":"completed","conclusion":"cancelled"}'; expect no "CI cancelled"
reset; checks=''; expect no "no check-runs"
reset; authors='{"name":"someone","email":"someone@example.com"}'; expect no "commit by another author"
reset; authors='{"name":"karthik24iyer","email":"noreply@anthropic.com"}'; expect no "right name, wrong email"
reset; body='more\n\nCo-authored-by: Claude <noreply@anthropic.com>'; expect no "Co-authored-by line in message"
reset; body='Claude-Session: abc'; expect no "Claude-Session line in message"
reset; draft=true; expect no "draft PR"
reset; state=closed; expect no "closed PR"
reset; state=closed; merged=true; expect no "merged PR"
reset; mstate=blocked; expect no "merge state blocked"
reset; mstate=unstable; expect no "merge state unstable"
reset; mstate=unknown; mable=null; expect no "mergeability still unknown after the retry"
# Renames and removals: the old path counts too.
reset; review="VERDICT: APPROVE\nHead: $R"; since_files='["src/rules.qa.test.ts"]'; prev=src/rules.ts; expect no "source renamed to a QA name since review"
reset; review="VERDICT: APPROVE\nHead: $R"; since_files='["src/old.qa.test.ts"]'; prev=src/older.qa.test.ts; expect yes "QA test renamed to another QA test since review"
reset; review="VERDICT: APPROVE\nHead: $R"; since_files='["src/removed.ts"]'; expect no "non-QA file removed since review"
# The newest verdict-looking review / comment is used; malformed = no, never an older APPROVE / PASS.
reset; review_new="**VERDICT: CHANGES REQUESTED**\nHead: $H"; expect no "newer bold verdict is malformed"
reset; review_new="## VERDICT: APPROVE\nHead: $H"; expect no "newer heading verdict is malformed"
reset; review_new="\nVERDICT: APPROVE\nHead: $H"; expect no "newer verdict after a blank line is malformed"
reset; review_new="VERDICT: CHANGES REQUESTED\nHead: $H"; expect no "newer CHANGES REQUESTED wins"
reset; review_new="Looks fine, no comments"; expect yes "newer non-verdict review is ignored"
reset; qa_new="**QA: FAIL**\nHead: $H"; expect no "newer bold QA verdict is malformed"
reset; review_new="Verdict: changes requested\nHead: $H"; expect no "newer lower-case verdict is malformed"
reset; review_new="**verdict: approve**\nHead: $H"; expect no "newer bold lower-case verdict is malformed"
reset; review_new="> VERDICT: changes requested\nHead: $H"; expect no "newer quoted verdict is malformed"
reset; qa_new="qa: fail\nHead: $H"; expect no "newer lower-case QA verdict is malformed"
reset; qa_new="**Qa: Pass**\nHead: $H"; expect no "newer bold mixed-case QA verdict is malformed"
reset; qa_new="> QA : FAIL\nHead: $H"; expect no "newer quoted QA verdict is malformed"
reset; qa_new="QA:PASS\nHead: $H"; expect no "newer QA verdict without a space is malformed"
# Only GATE_AUTHORS count (public repo); PENDING reviews don't count.
reset; review="VERDICT: CHANGES REQUESTED\nHead: $H"; review_new="VERDICT: APPROVE\nHead: $H"; review_new_by=mallory; expect no "foreign APPROVE newer than a real CHANGES REQUESTED"
reset; qa="QA: FAIL\nHead: $H"; qa_new="QA: PASS\nHead: $H"; qa_new_by=mallory; expect no "foreign PASS newer than a real QA FAIL"
reset; review_new="VERDICT: CHANGES REQUESTED\nHead: $H"; review_new_by=mallory; expect yes "foreign CHANGES REQUESTED doesn't block"
reset; qa_new="QA: FAIL\nHead: $H"; qa_new_by=mallory; expect yes "foreign QA FAIL doesn't block"
reset; review_new="VERDICT: CHANGES REQUESTED\nHead: $H"; review_new_by=pm-bot; export GATE_AUTHORS=karthik24iyer,pm-bot; expect no "GATE_AUTHORS adds an account"; unset GATE_AUTHORS
reset; review="VERDICT: CHANGES REQUESTED\nHead: $H"; review_new="VERDICT: APPROVE\nHead: $H"; review_new_state=PENDING; expect no "pending APPROVE doesn't count"
# Verdicts on the wrong channel still count; malformed QA without a colon too.
reset; review_as_comment="VERDICT: CHANGES REQUESTED\nHead: $H"; expect no "CHANGES REQUESTED posted as a comment"
reset; qa_as_review="QA: FAIL\nHead: $H"; expect no "QA FAIL posted as a review"
reset; qa_new="QA FAIL\nHead: $H"; expect no "newer QA verdict without a colon is malformed"
reset; qa_new="QA: PASS\nHead: $H\n\nThe reviewer's verdict stands."; expect yes "QA comment mentioning verdict is still a QA verdict"
# Commit statuses (besides check-runs).
reset; statuses='{"context":"ext/ci","state":"failure"}'; expect no "failing commit status"
reset; statuses='{"context":"ext/ci","state":"pending"}'; expect no "pending commit status"
reset; statuses='{"context":"ext/ci","state":"success"}'; expect yes "green commit status"
reset; touch "$FIX/fail-status.json"; expect no "commit status read fails"
# gh errors on any page fail closed (the fake prints the data, then fails).
reset; touch "$FIX/fail-reviews.json"; expect no "reviews read fails"
reset; touch "$FIX/fail-comments.json"; expect no "comments read fails"
reset; touch "$FIX/fail-checks.json"; expect no "check-runs read fails"
reset; touch "$FIX/fail-pr-commits.json"; expect no "PR commits read fails"
reset; review="VERDICT: APPROVE\nHead: $R"; touch "$FIX/fail-compare.json"; expect no "compare fails"
reset; review="VERDICT: APPROVE\nHead: $R"; touch "$FIX/fail-commit-$C.json"; expect no "commit files read fails"
reset; touch "$FIX/fail-pr.json"; expect no "PR read fails"

[ $fails -eq 0 ] && echo "all gate tests passed" || { echo "$fails gate test(s) failed"; exit 1; }
