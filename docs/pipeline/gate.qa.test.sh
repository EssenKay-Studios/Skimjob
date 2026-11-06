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
q=.; path=; method=GET; page=1; sub=$1
[ "$sub" = api ] || { echo "fake gh: not REST: $*" >&2; echo "$*" >>"$FIX/NOT_REST"; exit 1; }
shift
while [ $# -gt 0 ]; do
  case $1 in --jq) q=$2; shift ;; -X) method=$2; shift ;; -H|-f|-F) shift ;; --paginate) ;;
    repos/*) path=${1%%\?*}; pg=${1##*[?&]page=}; [[ $1 == *[?\&]page=* && $pg =~ ^[0-9]+$ ]] && page=$pg ;; graphql) echo graphql >>"$FIX/NOT_REST"; exit 1 ;; esac; shift
done
case "$method $path" in
  "PUT "*/pulls/*/merge) echo merged >"$FIX/MERGED"; f=merge.json ;;
  "DELETE "*/git/refs/heads/*) echo "${path#*/git/refs/heads/}" >"$FIX/DELETED"; exit 0 ;;
  "GET "*/pulls/*/reviews) f=reviews.json ;; "GET "*/issues/*/comments) f=comments.json ;;
  "GET "*/pulls/*/files) f=pr-files.json ;; "GET "*/pulls/*/commits) f=pr-commits.json ;; "GET "*/pulls/*) f=pr.json ;;
  "GET "*/compare/*) f=compare.json ;; "GET "*/check-runs) f=checks.json ;; "GET "*/status) f=status.json ;;
  "GET "*/commits/*) f=commit-${path##*/}.json ;; "GET "*/issues) [ -f "$FIX/NO_ISSUES" ] && exit 1; f=issues.json ;;
  *) echo "fake gh: unexpected: $method $path" >&2; exit 1 ;;
esac
[ -f "$FIX/$f" ] || { echo "fake gh: no $f" >&2; exit 1; }
[ -f "$FIX/IGNORE_PAGE" ] && page=1   # an API that ignores `page` (the 100-page cap must stop it)
# Pages: page 1 is <file>, page N is <file>.pN, past the last one the arrays are empty.
# failp2-<file>: page 2 fails (an error on a later page).
if [ "$page" -gt 1 ]; then
  [ -f "$FIX/failp2-$f" ] && [ "$page" = 2 ] && { echo "fake gh: HTTP 502" >&2; exit 1; }
  if [ -f "$FIX/$f.p$page" ]; then f=$f.p$page
  else jq 'if type == "array" then [] else map_values(if type == "array" then [] else . end) end' "$FIX/$f" >"$FIX/empty.json"; f=empty.json; fi
fi
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
  rm -rf "$FIX"; mkdir -p "$FIX"; after=
  draft=false; mstate=clean; mable=true; state=open; merged=false; authors=$OK_AUTHOR; body=""
  review="VERDICT: APPROVE\nHead: $H"; qa="QA: PASS\nHead: $H"; review_new=""; qa_new=""
  review_new_by=karthik24iyer; qa_new_by=karthik24iyer; review_new_state=COMMENTED
  qa_as_review=""; review_as_comment=""; statuses=""
  checks='{"name":"Typecheck","status":"completed","conclusion":"success"}'
  pr_files='[{"filename":"apps/web/src/x.ts"},{"filename":"apps/web/src/x.qa.test.ts"}]'
  compare_status=ahead; since_files='["apps/web/src/x.qa.test.ts"]'; prev=""
}
write() {
  cat >"$FIX/pr.json" <<J
{"head":{"sha":"$H","ref":"feat/x","repo":{"full_name":"EssenKay-Studios/Skimjob"}},"draft":$draft,
 "mergeable_state":"$mstate","mergeable":$mable,"state":"$state","merged":$merged}
J
  jq -n --arg c "$C" --argjson a "$authors" --arg m "feat: x\n\n$body" \
    '[{sha: $c, commit: {author: $a, message: ($m | gsub("\\\\n"; "\n"))}}]' >"$FIX/pr-commits.json"
  echo '[{"number":90,"title":"S3a.3 — later"},{"number":79,"title":"S1 — Spec freeze: design.md single spec"}]' >"$FIX/issues.json"
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
  echo "$pr_files" >"$FIX/pr-files.json"
  echo "{\"statuses\":[$statuses]}" >"$FIX/status.json"
  echo "{\"check_runs\":[$checks]}" >"$FIX/checks.json"
  echo "{\"status\":\"$compare_status\",\"total_commits\":1,\"commits\":[{\"sha\":\"$C\"}]}" >"$FIX/compare.json"
  jq -n --argjson f "$since_files" --arg p "$prev" \
    '{files: [$f[] | {filename: .} + (if $p == "" then {} else {previous_filename: $p, status: "renamed"} end)]}' \
    >"$FIX/commit-$C.json"
}
# split FILE [KEY]: page 1 keeps the first item of the array (at .KEY), page 2 gets the rest.
split() {
  local k=${2:-}
  jq "(.$k) |= .[:1]" "$FIX/$1" >"$FIX/$1.tmp"
  jq "(.$k) |= .[1:]" "$FIX/$1" >"$FIX/$1.p2"; mv "$FIX/$1.tmp" "$FIX/$1"
}
fails=0
# expect yes|no NAME: runs verdicts.sh and merge.sh; merge must be attempted iff yes.
# `after` (eval'd once the fixtures are written) edits them, e.g. to split a list over two pages.
expect() {
  write
  [ -z "$after" ] || eval "$after"
  out=$(bash "$DIR/verdicts.sh" 1); rc=$?
  mout=$(bash "$DIR/merge.sh" 1 2>&1)
  did=no; [ -f "$FIX/MERGED" ] && did=yes
  want_rc=1; [ "$1" = yes ] && want_rc=0
  why=
  [ $rc -eq $want_rc ] && [ $did = "$1" ] || why="verdicts rc=$rc, merge called=$did"
  [ -f "$FIX/NOT_REST" ] && why="non-REST gh call: $(head -1 "$FIX/NOT_REST")"
  if [ "$1" = yes ] && [ -z "$why" ]; then
    [ "$(cat "$FIX/DELETED" 2>/dev/null)" = feat/x ] || why="branch not deleted"
    [[ $(tail -1 <<<"$mout") == "merged #1 -> main ddddddd | next: #79 S1 — Spec freeze: design.md single spec" ]] || why="merge line: $(tail -1 <<<"$mout")"
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
# Review bots (github-actions[bot]): reviewer VERDICTs only, never QA; same exact format and newest-wins rules.
reset; review=""; review_new="VERDICT: APPROVE\nHead: $H"; review_new_by='github-actions[bot]'; expect yes "bot APPROVE on head counts"
reset; review="VERDICT: CHANGES REQUESTED\nHead: $H"; review_new="VERDICT: APPROVE\nHead: $H"; review_new_by='github-actions[bot]'; expect yes "newer bot APPROVE after a human CHANGES REQUESTED"
reset; review_new="VERDICT: CHANGES REQUESTED\nHead: $H"; review_new_by='github-actions[bot]'; expect no "newer bot CHANGES REQUESTED blocks a human APPROVE"
reset; review_new="VERDICT: CHANGES REQUESTED\nHead: $H"; review_new_by='github-actions[bot]'; review_as_comment="VERDICT: APPROVE\nHead: $H"; expect yes "newest of bot and human counts (human newer)"
reset; review=""; review_new="VERDICT: APPROVE\nHead: $R"; review_new_by='github-actions[bot]'; since_files='["packages/engine/src/rules.ts"]'; expect no "bot APPROVE on an old head with a non-QA commit since"
reset; review=""; review_new="VERDICT: APPROVE\nHead: $R"; review_new_by='github-actions[bot]'; expect yes "bot APPROVE on an older head, only QA tests since"
reset; review=""; review_new="**VERDICT: APPROVE**\nHead: $H"; review_new_by='github-actions[bot]'; expect no "bot verdict in a malformed format"
reset; review=""; review_new="VERDICT: APPROVE"; review_new_by='github-actions[bot]'; expect no "bot APPROVE without a Head line"
reset; qa="QA: FAIL\nHead: $H"; qa_new="QA: PASS\nHead: $H"; qa_new_by='github-actions[bot]'; expect no "bot QA: PASS does not override a QA FAIL"
reset; qa=""; qa_new="QA: PASS\nHead: $H"; qa_new_by='github-actions[bot]'; expect no "bot QA: PASS alone is not a QA verdict"
reset; qa_new="QA: FAIL\nHead: $H"; qa_new_by='github-actions[bot]'; expect yes "bot QA: FAIL is ignored"
reset; qa_as_review="QA: FAIL\nHead: $H"; review_new="QA: PASS\nHead: $H"; review_new_by='github-actions[bot]'; qa=""; expect no "bot QA: PASS posted as a review is not a QA verdict"
reset; review=""; review_new="VERDICT: APPROVE\nHead: $H"; review_new_by=mallory; expect no "a random user's VERDICT does not count"
reset; review=""; review_new="VERDICT: APPROVE\nHead: $H"; review_new_by=claude; expect no "login claude (no [bot]) does not count"
reset; review=""; review_new="VERDICT: APPROVE\nHead: $H"; review_new_by='claude-bot[bot]'; expect no "another bot does not count"
reset; review=""; review_new="VERDICT: APPROVE\nHead: $H"; review_new_by='github-actions[bot]'; export GATE_REVIEW_BOTS=; expect no "GATE_REVIEW_BOTS empty trusts no bot"; unset GATE_REVIEW_BOTS
reset; review=""; review_new="VERDICT: APPROVE\nHead: $H"; review_new_by='other[bot]'; export GATE_REVIEW_BOTS='github-actions[bot],other[bot]'; expect yes "GATE_REVIEW_BOTS adds a bot"; unset GATE_REVIEW_BOTS
reset; review=""; review_new="VERDICT: APPROVE\nHead: $H"; review_new_by='github-actions[bot]'; export GATE_REVIEW_BOTS='bad login'; expect no "bad GATE_REVIEW_BOTS fails closed"; unset GATE_REVIEW_BOTS
reset; review="VERDICT: CHANGES REQUESTED\nHead: $H"; review_new="VERDICT: APPROVE\nHead: $H"; review_new_by='github-actions[bot]'; review_new_state=PENDING; expect no "pending bot APPROVE doesn't count"
reset; review=""; review_new="VERDICT: APPROVE\nHead: $H"; review_new_by='claude[bot]'; expect no "claude[bot] is no longer trusted (default is github-actions[bot])"
# Bots count only when the PR touches nothing under .github/ or docs/pipeline/ (old or new path); humans always count.
bot_approve() { reset; review=""; review_new="VERDICT: APPROVE\nHead: $H"; review_new_by='github-actions[bot]'; }
bot_approve; pr_files='[{"filename":".github/workflows/ci.yml"}]'; expect no "bot APPROVE on a PR that touches .github/"
bot_approve; pr_files='[{"filename":"apps/web/a.ts"},{"filename":"docs/pipeline/verdicts.sh"}]'; expect no "bot APPROVE on a PR that touches docs/pipeline/"
bot_approve; pr_files='[{"filename":"docs/x.md","previous_filename":".github/workflows/old.yml"}]'; expect no "bot APPROVE when a rename leaves .github/"
bot_approve; pr_files='[{"filename":".github/workflows/x.yml","previous_filename":"docs/x.md"}]'; expect no "bot APPROVE when a rename enters .github/"
bot_approve; pr_files='[{"filename":".GitHub/workflows/x.yml"}]'; expect no "bot APPROVE: .github path match ignores case"
bot_approve; pr_files='[{"filename":".githubx/a.yml"},{"filename":"docs/pipeline-notes.md"},{"filename":"docs/pipelines/a.md"}]'; expect yes "bot APPROVE: look-alike paths are not .github/ or docs/pipeline/"
bot_approve; pr_files='[{"filename":".claude/settings.json"}]'; expect no "bot APPROVE on a PR that touches .claude/"
bot_approve; pr_files='[{"filename":".mcp.json"}]'; expect no "bot APPROVE on a PR that touches .mcp.json"
bot_approve; pr_files='[{"filename":"CLAUDE.md"}]'; expect no "bot APPROVE on a PR that touches CLAUDE.md"
bot_approve; pr_files='[{"filename":"apps/web/CLAUDE.md"}]'; expect no "bot APPROVE on a PR that touches a nested CLAUDE.md"
bot_approve; pr_files='[{"filename":"packages/x/CLAUDE.local.md"}]'; expect no "bot APPROVE on a PR that touches a nested CLAUDE.local.md"
bot_approve; pr_files='[{"filename":"CLAUDE.local.md"}]'; expect no "bot APPROVE on a PR that touches CLAUDE.local.md"
bot_approve; pr_files='[{"filename":".claude.json"}]'; expect no "bot APPROVE on a PR that touches .claude.json"
bot_approve; pr_files='[{"filename":"apps/web/.claude/settings.json"}]'; expect no "bot APPROVE on a PR that touches a nested .claude/"
bot_approve; pr_files='[{"filename":"docs/CLAUDE.md.bak"},{"filename":"apps/web/claude.ts"},{"filename":".claudex/a"}]'; expect yes "bot APPROVE: look-alike Claude paths are fine"
bot_approve; touch "$FIX/fail-pr-files.json"; expect no "file list unreadable fails closed"
bot_approve; pr_files='[]'; expect yes "bot APPROVE on a PR with an empty file list"
reset; pr_files='[{"filename":".github/workflows/ci.yml"},{"filename":"docs/pipeline/gate.qa.test.sh"}]'; expect yes "human APPROVE still counts on a PR that touches .github/ and docs/pipeline/"
reset; review="VERDICT: CHANGES REQUESTED\nHead: $H"; review_new="VERDICT: APPROVE\nHead: $H"; review_new_by='github-actions[bot]'; pr_files='[{"filename":".github/workflows/ci.yml"}]'; expect no "bot APPROVE ignored on .github/ PR: the human CHANGES REQUESTED stands"
reset; review="VERDICT: CHANGES REQUESTED\nHead: $H"; review_new="VERDICT: APPROVE\nHead: $H"; review_new_by=karthik24iyer; pr_files='[{"filename":".github/workflows/ci.yml"}]'; expect yes "human APPROVE newer than a human CHANGES REQUESTED on a .github/ PR"
reset; review="VERDICT: APPROVE\nHead: $H"; review_new="VERDICT: CHANGES REQUESTED\nHead: $H"; review_new_by='github-actions[bot]'; pr_files='[{"filename":".github/workflows/ci.yml"}]'; expect yes "bot CHANGES REQUESTED is ignored on a .github/ PR (human APPROVE stands)"
# DISMISSED reviews never count.
reset; review="VERDICT: CHANGES REQUESTED\nHead: $H"; review_new="VERDICT: APPROVE\nHead: $H"; review_new_state=DISMISSED; expect no "dismissed APPROVE doesn't count"
reset; review_new="VERDICT: CHANGES REQUESTED\nHead: $H"; review_new_state=DISMISSED; expect yes "dismissed CHANGES REQUESTED doesn't block"
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

# Paging (no --paginate: the cloud proxy blocks the Link-header URLs): data on page 2 counts; an error on page 2 is a no.
reset; review_new="VERDICT: CHANGES REQUESTED\nHead: $H"; after='split reviews.json'; expect no "reviews: CHANGES REQUESTED on page 2 is seen"
reset; qa_new="QA: FAIL\nHead: $H"; after='split comments.json'; expect no "comments: QA FAIL on page 2 is seen"
reset; review="VERDICT: CHANGES REQUESTED\nHead: $H"; review_new="VERDICT: APPROVE\nHead: $H"; after='split reviews.json'; expect yes "reviews: APPROVE on page 2 is seen"
bot_approve; pr_files='[{"filename":"apps/web/a.ts"},{"filename":".github/x.yml"}]'; after='split pr-files.json'; expect no "files: a .github/ file on page 2 is seen"
reset; checks='{"name":"a","status":"completed","conclusion":"success"},{"name":"b","status":"completed","conclusion":"failure"}'; after='split checks.json check_runs'; expect no "check-runs: a failure on page 2 is seen"
reset; checks='{"name":"a","status":"completed","conclusion":"success"},{"name":"b","status":"completed","conclusion":"success"}'; after='split checks.json check_runs'; expect yes "check-runs: green over two pages"
reset; after='jq ".[1:] = [.[0] | .commit.author.name = \"x\"]" "$FIX/pr-commits.json" >"$FIX/pr-commits.json.p2"'; expect no "PR commits: a wrong author on page 2 is seen"
reset; review="VERDICT: APPROVE\nHead: $R"; since_files='["x.qa.test.ts","src/rules.ts"]'; after='split commit-$C.json files'; expect no "commit files: a non-QA file on page 2 is seen"
reset; statuses='{"context":"a","state":"success"},{"context":"b","state":"failure"}'; after='split status.json statuses'; expect no "statuses: a failure on page 2 is seen"
reset; review_new="VERDICT: CHANGES REQUESTED\nHead: $H"; after='split reviews.json'; touch "$FIX/failp2-reviews.json"; expect no "reviews: error on page 2"
reset; qa_new="QA: FAIL\nHead: $H"; after='split comments.json'; touch "$FIX/failp2-comments.json"; expect no "comments: error on page 2"
bot_approve; pr_files='[{"filename":"a.ts"},{"filename":"b.ts"}]'; after='split pr-files.json'; touch "$FIX/failp2-pr-files.json"; expect no "files: error on page 2"
reset; checks='{"name":"a","status":"completed","conclusion":"success"},{"name":"b","status":"completed","conclusion":"success"}'; after='split checks.json check_runs'; touch "$FIX/failp2-checks.json"; expect no "check-runs: error on page 2"
reset; after='jq ".[1:] = [.[0]]" "$FIX/pr-commits.json" >"$FIX/pr-commits.json.p2"'; touch "$FIX/failp2-pr-commits.json"; expect no "PR commits: error on page 2"
reset; review="VERDICT: APPROVE\nHead: $R"; since_files='["x.qa.test.ts","y.qa.test.ts"]'; after='split commit-$C.json files'; touch "$FIX/failp2-commit-$C.json"; expect no "commit files: error on page 2"
reset; statuses='{"context":"a","state":"success"},{"context":"b","state":"success"}'; after='split status.json statuses'; touch "$FIX/failp2-status.json"; expect no "statuses: error on page 2"
# A later page without the expected key fails closed; an API that ignores `page` hits the 100-page cap.
reset; checks='{"name":"a","status":"completed","conclusion":"success"},{"name":"b","status":"completed","conclusion":"success"}'; after='split checks.json check_runs; echo "{}" >"$FIX/checks.json.p2"'; expect no "check-runs: page 2 without check_runs"
reset; statuses='{"context":"a","state":"success"},{"context":"b","state":"success"}'; after='split status.json statuses; echo "{}" >"$FIX/status.json.p2"'; expect no "statuses: page 2 without statuses"
reset; review="VERDICT: APPROVE\nHead: $R"; since_files='["x.qa.test.ts","y.qa.test.ts"]'; after='split commit-$C.json files; echo "{}" >"$FIX/commit-$C.json.p2"'; expect no "commit files: page 2 without files"
reset; touch "$FIX/IGNORE_PAGE"; expect no "API ignores page: the 100-page cap fails closed"

# The "next" lookup is fail-safe: an issues API error still merges and prints a fallback.
reset; write; touch "$FIX/NO_ISSUES"; mout=$(bash "$DIR/merge.sh" 1 2>&1)
if [[ $(tail -1 <<<"$mout") == "merged #1 -> main ddddddd | next: see the board" ]]; then echo "ok   next lookup fails safe"
else echo "FAIL next lookup fails safe ($(tail -1 <<<"$mout"))"; fails=$((fails + 1)); fi

[ $fails -eq 0 ] && echo "all gate tests passed" || { echo "$fails gate test(s) failed"; exit 1; }
