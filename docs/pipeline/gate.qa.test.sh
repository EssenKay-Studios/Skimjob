#!/bin/bash
# usage: bash docs/pipeline/gate.qa.test.sh
# Offline tests for verdicts.sh / merge.sh: a fake `gh` first on PATH serves canned JSON
# (filtered with jq, as gh's --jq would) and records any `gh pr merge` call. Needs jq.
set -u
DIR=$(cd "$(dirname "$0")" && pwd)
WORK=$(cd "$DIR/../.." && pwd)/.gate-qa-test
rm -rf "$WORK"; mkdir -p "$WORK/bin"; trap 'rm -rf "$WORK"' EXIT
FIX=$WORK/fix
cat >"$WORK/bin/gh" <<'EOF'
#!/bin/bash
FIX=${GATE_FIX:?}
q=.; path=; json=; sub="$1 $2"
while [ $# -gt 0 ]; do
  case $1 in --jq) q=$2; shift ;; --json) json=$2; shift ;; -R|-H|--match-head-commit) shift ;;
    repos/*) path=$1 ;; esac; shift
done
case $sub in
  "pr merge") echo merged >"$FIX/MERGED"; exit 0 ;;
  "pr view") f=pr.json; [ "$json" = commits ] && key=pr-commits ;;
  api*) case $path in
      */reviews) f=reviews.json ;; */comments) f=comments.json ;;
      */compare/*) f=compare.json ;; */check-runs*) f=checks.json ;;
      */commits/*) f=commit-${path##*/}.json ;; *) exit 0 ;; esac ;;
  *) echo "fake gh: unexpected: $sub" >&2; exit 1 ;;
esac
[ -f "$FIX/$f" ] || { echo "fake gh: no $f" >&2; exit 1; }
# fail-<file|pr-commits>: print the data (an earlier page), then fail (a later page).
if [ -f "$FIX/fail-${key:-$f}" ]; then jq -r "$q" "$FIX/$f"; echo "fake gh: HTTP 502" >&2; exit 1; fi
jq -r "$q" "$FIX/$f"
EOF
chmod +x "$WORK/bin/gh"
export PATH=$WORK/bin:$PATH GATE_FIX=$FIX

H=$(printf 'a%.0s' {1..40}); R=$(printf 'b%.0s' {1..40}); C=$(printf 'c%.0s' {1..40})
OK_AUTHOR='[{"name":"karthik24iyer","email":"karthik24iyer@gmail.com"}]'
# Fixture defaults: everything mergeable at head H.
reset() {
  rm -rf "$FIX"; mkdir -p "$FIX"
  draft=false; mstate=CLEAN; state=OPEN; authors=$OK_AUTHOR; body=""
  review="VERDICT: APPROVE\nHead: $H"; qa="QA: PASS\nHead: $H"; review_new=""; qa_new=""
  checks='{"name":"Typecheck","status":"completed","conclusion":"success"}'
  compare_status=ahead; since_files='["apps/web/src/x.qa.test.ts"]'; prev=""
}
write() {
  cat >"$FIX/pr.json" <<J
{"headRefOid":"$H","isDraft":$draft,"mergeStateStatus":"$mstate","state":"$state",
 "commits":[{"oid":"$C","authors":$authors,"messageHeadline":"feat: x","messageBody":"$body"}]}
J
  # *_new: a newer review / comment after the first one.
  jq -n --arg a "$review" --arg b "$review_new" '[$a, $b | select(. != "") | {body: gsub("\\\\n"; "\n")}]' >"$FIX/reviews.json"
  jq -n --arg a "$qa" --arg b "$qa_new" '[$a, $b | select(. != "") | {body: gsub("\\\\n"; "\n")}]' >"$FIX/comments.json"
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
  bash "$DIR/merge.sh" 1 >/dev/null 2>&1
  merged=no; [ -f "$FIX/MERGED" ] && merged=yes
  want_rc=1; [ "$1" = yes ] && want_rc=0
  if [ $rc -eq $want_rc ] && [ $merged = "$1" ]; then echo "ok   $2"
  else echo "FAIL $2 (verdicts rc=$rc, merge called=$merged)"; echo "$out" | tail -1; fails=$((fails + 1)); fi
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
reset; authors='[{"name":"someone","email":"someone@example.com"}]'; expect no "commit by another author"
reset; authors='[{"name":"karthik24iyer","email":"karthik24iyer@gmail.com"},{"name":"Claude","email":"noreply@anthropic.com"}]'; expect no "co-author in authors list"
reset; body='more\n\nCo-authored-by: Claude <noreply@anthropic.com>'; expect no "Co-authored-by line in message"
reset; body='Claude-Session: abc'; expect no "Claude-Session line in message"
reset; draft=true; expect no "draft PR"
reset; state=CLOSED; expect no "closed PR"
reset; mstate=BLOCKED; expect no "merge state BLOCKED"
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
# gh errors on any page fail closed (the fake prints the data, then fails).
reset; touch "$FIX/fail-reviews.json"; expect no "reviews read fails"
reset; touch "$FIX/fail-comments.json"; expect no "comments read fails"
reset; touch "$FIX/fail-checks.json"; expect no "check-runs read fails"
reset; touch "$FIX/fail-pr-commits"; expect no "PR commits read fails"
reset; review="VERDICT: APPROVE\nHead: $R"; touch "$FIX/fail-compare.json"; expect no "compare fails"
reset; review="VERDICT: APPROVE\nHead: $R"; touch "$FIX/fail-commit-$C.json"; expect no "commit files read fails"
reset; touch "$FIX/fail-pr.json"; expect no "PR read fails"

[ $fails -eq 0 ] && echo "all gate tests passed" || { echo "$fails gate test(s) failed"; exit 1; }
