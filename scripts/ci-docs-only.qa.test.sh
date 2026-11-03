#!/bin/bash
# usage: bash scripts/ci-docs-only.qa.test.sh
# QA for the CI docs-only lane (PR #60): runs scripts/ci-docs-only.sh over path
# lists, then runs the `changes` job's step exactly as written in ci.yml against
# real commits in a scratch repo (renames, deletions, spaces, empty diffs).
set -u
DIR=$(cd "$(dirname "$0")/.." && pwd)
WORK=$DIR/.ci-docs-only-qa
rm -rf "$WORK"; mkdir -p "$WORK"; trap 'rm -rf "$WORK"' EXIT
fails=0
check() { # NAME WANT GOT
  if [ "$2" = "$3" ]; then echo "ok   $1 -> $3"; else echo "FAIL $1: want $2, got $3"; fails=$((fails + 1)); fi
}

# 1. The classifier over path lists.
classify() { printf '%s' "$1" | bash "$DIR/scripts/ci-docs-only.sh"; }
nl=$'\n'
check "README.md"                       true  "$(classify "README.md$nl")"
check "docs/x.md"                       true  "$(classify "docs/x.md$nl")"
check "docs/pipeline/x.md"              true  "$(classify "docs/pipeline/x.md$nl")"
check "docs/pipeline/verdicts.sh"       false "$(classify "docs/pipeline/verdicts.sh$nl")"
check "docs/pipeline/merge.sh"          false "$(classify "docs/pipeline/merge.sh$nl")"
check "docs/balance/baseline.json"      false "$(classify "docs/balance/baseline.json$nl")"
check "apps/web/src/x.ts"               false "$(classify "apps/web/src/x.ts$nl")"
check ".github/workflows/ci.yml"        false "$(classify ".github/workflows/ci.yml$nl")"
check "package.json + docs/a.md"        false "$(classify "package.json${nl}docs/a.md$nl")"
check "docs/a.md + package.json"        false "$(classify "docs/a.md${nl}package.json$nl")"
check "rename a.md -> a.ts (both paths)" false "$(classify "a.md${nl}a.ts$nl")"
check "deleted x.ts"                    false "$(classify "packages/engine/src/x.ts$nl")"
check "docs/my notes.md"                true  "$(classify "docs/my notes.md$nl")"
check "my file.ts"                      false "$(classify "my file.ts$nl")"
check "empty list"                      false "$(classify "")"
check "blank lines only"                false "$(classify "$nl$nl")"
check "no trailing newline"             false "$(classify "docs/a.md${nl}x.ts")"
check "no trailing newline, all md"     true  "$(classify "docs/a.md${nl}b.md")"
check "docs/notes.txt"                  false "$(classify "docs/notes.txt$nl")"
check "docs (no slash)"                 false "$(classify "docs$nl")"
check "x.md.ts"                         false "$(classify "x.md.ts$nl")"
check "x.MD (case)"                     false "$(classify "x.MD$nl")"

# 2. The workflow step itself, extracted from ci.yml (the `run: |` block of step id `diff`).
STEP=$WORK/step.sh
awk '/^  changes:/ {j=1} j && /id: diff/ {s=1} s && /run: \|/ {r=1; next}
     r { if ($0 !~ /^          / && $0 != "") exit; sub(/^          /, ""); print }' \
  "$DIR/.github/workflows/ci.yml" >"$STEP"
grep -q 'ci-docs-only.sh' "$STEP" || { echo "FAIL could not extract the changes step from ci.yml"; exit 1; }

R=$WORK/repo
git init -q -b main "$R"; mkdir -p "$R/scripts" "$R/docs" "$R/src"
cp "$DIR/scripts/ci-docs-only.sh" "$R/scripts/"
echo a >"$R/a.md"; echo t >"$R/src/x.ts"; echo d >"$R/docs/x.md"
g() { git -C "$R" -c user.name=qa -c user.email=qa@example.com "$@"; }
g add -A; g commit -qm base; BASE0=$(g rev-parse HEAD)
# run_step EVENT BASE HEAD -> the docs_only value written to GITHUB_OUTPUT
run_step() {
  : >"$WORK/out"
  (cd "$R" && EVENT=$1 BASE=$2 HEAD=$3 GITHUB_OUTPUT=$WORK/out bash --noprofile --norc -eo pipefail "$STEP" >/dev/null 2>&1)
  sed -n 's/^docs_only=//p' "$WORK/out"
}
# branch NAME CMDS: a commit on a fresh branch from base; prints its sha
branch() { g checkout -q -B "$1" "$BASE0"; (cd "$R" && eval "$2"); g add -A; g commit -q --allow-empty -m "$1"; g rev-parse HEAD; }

H=$(branch md 'echo b >>docs/x.md');                 check "step: docs/x.md edit"        true  "$(run_step pull_request "$BASE0" "$H")"
check "step: same commit on push"     false "$(run_step push "$BASE0" "$H")"
check "step: same commit on dispatch" false "$(run_step workflow_dispatch "" "")"
H=$(branch rn 'git mv a.md a.ts');                   check "step: rename a.md -> a.ts"   false "$(run_step pull_request "$BASE0" "$H")"
H=$(branch rnmd 'git mv docs/x.md docs/y.md');       check "step: rename docs md -> md"  true  "$(run_step pull_request "$BASE0" "$H")"
H=$(branch del 'git rm -q src/x.ts');                check "step: delete src/x.ts"       false "$(run_step pull_request "$BASE0" "$H")"
H=$(branch sp 'echo s >"docs/my notes.md"');         check "step: docs/my notes.md"      true  "$(run_step pull_request "$BASE0" "$H")"
H=$(branch spts 'echo s >"src/my file.ts"');         check "step: src/my file.ts"        false "$(run_step pull_request "$BASE0" "$H")"
H=$(branch utf 'echo u >"docs/café.md"');            check "step: non-ASCII docs name"   false "$(run_step pull_request "$BASE0" "$H")"
H=$(branch mix 'echo m >>docs/x.md; echo {} >package.json'); check "step: package.json + docs" false "$(run_step pull_request "$BASE0" "$H")"
H=$(branch empty ':');                               check "step: empty diff"            false "$(run_step pull_request "$BASE0" "$H")"
check "step: unknown head sha"        false "$(run_step pull_request "$BASE0" 0123456789012345678901234567890123456789)"
check "step: empty BASE/HEAD"         false "$(run_step pull_request "" "")"
# base moved on after the branch point: three-dot diff ignores main's own changes.
H=$(branch side 'echo c >>docs/x.md')
g checkout -q -B main2 "$BASE0"; echo t2 >>"$R/src/x.ts"; g commit -qam main-moved; M=$(g rev-parse HEAD)
check "step: docs PR, main moved on with code" true "$(run_step pull_request "$M" "$H")"

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
