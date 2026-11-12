#!/bin/bash
# shellcheck disable=SC2016  # single-quoted GraphQL and jq programs, with their own $ variables
# The runner (docs/pipeline/agents.md). The same file on macOS, Linux and in .github/workflows/agent.yml.
#   poll.sh                 one poll: reap and stop jobs, tidy the board, check every labelled open ticket
#                           and start the steps this place may run (the service repeats it every 5 minutes)
#   poll.sh stop N          the cloud: clear the stage label after the account label was removed, if a cloud step holds it
#   poll.sh check N         check one ticket (the cloud workflow; prints step/account/model/prompt, or action/pr/head, to $GITHUB_OUTPUT)
#   poll.sh merge N PR      merge PR with merge.sh (the gate passed), close ticket N and say so
#   poll.sh sync N PR HEAD  rebase PR's branch onto main as karthik24iyer (authors reset, attribution lines dropped) and push
#   poll.sh full N PR HEAD  run ci.yml in full on PR's branch (the merge-time suite)
#   poll.sh rerun N PR HEAD re-run the failed CI jobs on PR's head once
#   poll.sh job N STEP ACCOUNT MODEL PROMPT_FILE [SLOT]
#                           run one step in the foreground: Claude Code headless in a fresh worktree
# Settings: ~/.config/skimjob-agent/env (ENV_FILE overrides; the cloud sets them in the workflow):
#   PLACE=mac|linux|cloud  REPO_DIR=<clone>  WORK_DIR=<logs, jobs, worktrees>  E2E_PORT_BASE=<10..57>
#   PRO_CONFIG_DIR=<Claude config dir of the Pro login>  API_BUDGET_USD=<cap per API job>  PATH=<node 22, pnpm, gh, claude, jq>
# DRY_RUN=1 logs what it would do and changes nothing.
set -uo pipefail
CONF=$HOME/.config/skimjob-agent
ENV_FILE=${ENV_FILE:-$CONF/env}
# shellcheck source=/dev/null
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
: "${PLACE:?PLACE not set}" "${REPO_DIR:?REPO_DIR not set}" "${WORK_DIR:?WORK_DIR not set}"
REPO=${REPO:-EssenKay-Studios/Skimjob}
R=repos/$REPO
OWNER=karthik24iyer
SELF=$REPO_DIR/docs/pipeline/runner/poll.sh
JOBS=$WORK_DIR/jobs
MAX_JOBS=3 # each job may run one e2e run: at most 3 per machine (common.md "Hard rules")
# Every gh call as karthik24iyer: the default account may be a read-only work account.
# The cloud workflow sets GH_TOKEN itself.
if [ "$PLACE" != cloud ]; then GH_TOKEN=$(gh auth token --user $OWNER) || { echo "gh: not logged in as $OWNER" >&2; exit 1; }; fi
export GH_TOKEN
mkdir -p "$JOBS"

log() { echo "$(date -u +%FT%TZ) $*"; }
# act CMD...: run a command that changes something, or only log it in a dry run.
act() { if [ -n "${DRY_RUN:-}" ]; then log "DRY: $*"; else "$@"; fi; }
comment() { act gh api "$R/issues/$1/comments" -f body="$2" --silent; }
label_add() { act gh api "$R/issues/$1/labels" -f "labels[]=$2" --silent; }
label_rm() { act gh api -X DELETE "$R/issues/$1/labels/$2" --silent 2>/dev/null; }
alive() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null; }
# The stage labels (scripts/agent-start.ts STAGE): exactly one on a ticket while the pipeline works on it.
STAGES="agent:dev agent:ci agent:review agent:qa agent:working"
# stage N [LABEL]: set LABEL as the ticket's one stage label (none: clear them all).
stage() {
  local n=$1 want=${2:-} have l
  have=$(gh api "$R/issues/$n" --jq '[.labels[].name] | join(" ")') || return 0
  for l in $STAGES; do [ "$l" != "$want" ] && [[ " $have " == *" $l "* ]] && label_rm "$n" "$l"; done
  [ -z "$want" ] || [[ " $have " == *" $want "* ]] || label_add "$n" "$want"
}
step_label() { case $1 in build) echo agent:dev ;; review) echo agent:review ;; qa) echo agent:qa ;; esac; }

# ---- the board (GraphQL, project scope: the Mac and Linux only) ----
board=
board_load() {
  [ "$PLACE" = cloud ] && return
  board=$(gh api graphql --paginate -f query='query($endCursor: String) { organization(login: "EssenKay-Studios") { projectV2(number: 2) {
      id fields(first: 30) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } }
      items(first: 100, after: $endCursor) { pageInfo { hasNextPage endCursor } nodes { id
        content { ... on Issue { number state body } }
        status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        area: fieldValueByName(name: "Area") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        flags: fieldValueByName(name: "Flags") { ... on ProjectV2ItemFieldTextValue { text } } } } } } }' \
    --jq '.data.organization.projectV2' | jq -s '{id: .[0].id, fields: .[0].fields.nodes, items: [.[].items.nodes[]]}') || { board=; log "board: cannot read"; }
}
# board_set ITEM FIELD OPTION: set a single-select field by names.
board_set() {
  local ids
  ids=$(jq -r --arg f "$2" --arg o "$3" '.id as $p | .fields[] | select(.name == $f) | [$p, .id, (.options[] | select(.name == $o) | .id)] | @tsv' <<<"$board")
  [ -n "$ids" ] || return 0
  IFS=$'\t' read -r p f o <<<"$ids"
  [ -n "${DRY_RUN:-}" ] && { log "DRY: board $1 $2 -> $3"; return 0; }
  gh api graphql --silent -f query='mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) {
    updateProjectV2ItemFieldValue(input: {projectId: $p, itemId: $i, fieldId: $f, value: {singleSelectOptionId: $o}}) { clientMutationId } }' \
    -f p="$p" -f i="$1" -f f="$f" -f o="$o"
}
# Status Todo where it is empty; the form's Area answer copied to the board's Area.
board_tidy() {
  [ -n "$board" ] || return 0
  local item status area form
  # \x1f, not a tab: read collapses empty tab-separated fields.
  while IFS=$'\x1f' read -r item status area form; do
    [ -n "$status" ] || { log "board: $item Status -> Todo"; board_set "$item" Status Todo; }
    [ -n "$form" ] && [ "$form" != "$area" ] && { log "board: $item Area -> $form"; board_set "$item" Area "$form"; }
  done < <(jq -r '.items[] | select(.content.state == "OPEN") | [.id, (.status.name // ""), (.area.name // ""),
      ((.content.body // "") | gsub("\r"; "") | capture("(?m)^### Area\\s*\\n+(?<a>[^\\n]+)").a // "" | ltrimstr(" ") | rtrimstr(" "))] | join("\u001f")' <<<"$board")
}
board_item() { [ -n "$board" ] && jq -r --argjson n "$1" '.items[] | select(.content.number == $n) | .id' <<<"$board" | head -1; }

# ---- the start check ----
prs=
# gather N: the start check's input for issue N (scripts/agent-start.ts).
gather() {
  local n=$1 issue events comments working pr='' v builders
  issue=$(gh api "$R/issues/$n" --jq '{number, author: .user.login, title, type: .type.name, effort: ([.issue_field_values[]? | select(.issue_field_name == "Effort") | .single_select_option.name] | first), body: (.body // ""), labels: [.labels[].name]}') || return 1
  events=$(gh api --paginate "$R/issues/$n/events?per_page=100" --jq '.[] | select(.event == "labeled" or .event == "unlabeled")
    | {event, label: .label.name, actor: .actor.login, at: .created_at}' | jq -s .) || return 1
  comments=$(gh api --paginate "$R/issues/$n/comments?per_page=100" --jq '.[] | {author: .user.login, body: (.body // ""), at: .created_at}' | jq -s .) || return 1
  working=$(gh api "$R/issues?state=open&per_page=100" --jq '[.[] | select(.pull_request == null)
    | select([.labels[].name] | any(. == "agent:dev" or . == "agent:review" or . == "agent:qa" or . == "agent:working")) | {number, body: (.body // "")}]') || return 1
  [ -n "$prs" ] || prs=$(gh api --paginate "$R/pulls?state=open&per_page=100" --jq '.[] | {number, body: (.body // "")}' | jq -s .) || return 1
  pr=$(jq -r --argjson n "$n" '[.[] | select(.body | test("(?i)\\b(close[sd]?|fix(e[sd])?|resolve[sd]?) #\($n)\\b"))] | min_by(.number) | .number // empty' <<<"$prs")
  if [ -n "$pr" ]; then
    v=$(bash "$REPO_DIR/docs/pipeline/verdicts.sh" "$pr" 2>&1)
    pr=$(jq -n --argjson p "$pr" --arg v "$v" '{number: $p, verdicts: $v}')
  else pr=null; fi
  builders=$(for d in "$JOBS"/*/; do [ -f "$d/step" ] && [ "$(cat "$d/step")" = build ] && cat "$d/account"; done | jq -R . | jq -s .)
  jq -n --arg place "$PLACE" --argjson issue "$issue" --argjson events "$events" --argjson comments "$comments" \
    --argjson working "$working" --argjson pr "$pr" --argjson builders "$builders" \
    '{place: $place, issue: $issue, events: $events, comments: $comments, working: $working, pr: $pr, builders: $builders}'
}

running() { local n=0 d; for d in "$JOBS"/*/; do [ -f "$d/pid" ] && n=$((n + 1)); done; echo $n; }
free_slot() { local s; for s in 0 1 2; do grep -qx "$s" "$JOBS"/*/slot 2>/dev/null || { echo $s; return; }; done; }

# check N: decide for ticket N and act on the decision.
check() {
  local n=$1 in d kind
  in=$(gather "$n") || { log "#$n: cannot read the ticket"; return 1; }
  d=$(node "$REPO_DIR/scripts/agent-start.ts" <<<"$in") || { log "#$n: start check failed"; return 1; }
  kind=$(jq -r .kind <<<"$d")
  case $kind in
    wait)
      log "#$n: wait: $(jq -r .reason <<<"$d")"
      local st; st=$(jq -r '.stage // empty' <<<"$d"); [ -z "$st" ] || stage "$n" "$st" ;;
    comment) log "#$n: comment: $(jq -r .text <<<"$d")"; comment "$n" "$(jq -r .text <<<"$d")" ;;
    block) log "#$n: block: $(jq -r .text <<<"$d")"; label_add "$n" agent:blocked; comment "$n" "$(jq -r .text <<<"$d")" ;;
    ready|sync|full|rerun)
      local pr host hd action=$kind
      [ "$kind" = ready ] && action=merge
      IFS=$'\t' read -r pr host hd < <(jq -r '[.pr, .host, .head] | @tsv' <<<"$d")
      # Only the ticket's host acts, so two runners never race for one PR.
      if [ "$host" != "$PLACE" ]; then log "#$n: PR #$pr: $action on $host"; return 0; fi
      log "#$n: PR #$pr: $action"
      # The cloud acts in its own step, the only other one with AGENT_GH_TOKEN (agent.yml).
      if [ "$PLACE" = cloud ]; then printf 'action=%s\npr=%s\nhead=%s\n' "$action" "$pr" "$hd" >>"${GITHUB_OUTPUT:-/dev/stdout}"
      else "$action" "$n" "$pr" "$hd"; fi ;;
    start)
      local step host account model
      IFS=$'\t' read -r step host account model < <(jq -r '[.step, .host, .account, .model] | @tsv' <<<"$d")
      if [ "$host" != "$PLACE" ]; then log "#$n: $step runs on $host"; return 0; fi
      if [ "$PLACE" != cloud ] && [ "$(running)" -ge $MAX_JOBS ]; then log "#$n: $step waits: $MAX_JOBS jobs running here"; return 0; fi
      local dir=$JOBS/$n
      # mkdir is the lock: one job per ticket on this machine.
      if [ "$PLACE" != cloud ] && [ -z "${DRY_RUN:-}" ] && ! mkdir "$dir" 2>/dev/null; then log "#$n: a job is already here"; return 0; fi
      log "#$n: start $step on $PLACE, $account/$model"
      stage "$n" "$(step_label "$step")"
      comment "$n" "$(jq -r .pickup <<<"$d")"
      local item; item=$(board_item "$n"); [ -n "$item" ] && board_set "$item" Status "In progress"
      if [ -n "${DRY_RUN:-}" ]; then log "DRY: would run: poll.sh job $n $step $account $model <prompt> (claude -p --model $model)"; return 0; fi
      if [ "$PLACE" = cloud ]; then
        local pf=$WORK_DIR/prompt-$n.txt
        mkdir -p "$WORK_DIR"; jq -r .prompt <<<"$d" >"$pf"
        { echo "step=$step"; echo "account=$account"; echo "model=$model"; echo "prompt=$pf"; } >>"${GITHUB_OUTPUT:-/dev/stdout}"
        return 0
      fi
      jq -r .prompt <<<"$d" >"$dir/prompt"
      echo "$step" >"$dir/step"; echo "$account" >"$dir/account"; free_slot >"$dir/slot"
      # Its own process group (perl setpgrp: macOS has no setsid), so a stop kills the whole tree.
      nohup perl -e 'setpgrp(0, 0); exec @ARGV' bash "$SELF" job "$n" "$step" "$account" "$model" "$dir/prompt" "$(cat "$dir/slot")" \
        >>"$WORK_DIR/poll.log" 2>&1 </dev/null &
      echo $! >"$dir/pid" ;;
  esac
}

# merge N PR: merge.sh as karthik24iyer (in the cloud AGENT_GH_TOKEN: a merge by GITHUB_TOKEN starts no CI on main),
# then close the ticket. A refused merge (the gate changed since the check) is retried at the next check.
merge() {
  local n=$1 pr=$2 out
  if [ -n "${DRY_RUN:-}" ]; then log "DRY: merge.sh $pr"; return 0; fi
  if out=$(GH_TOKEN=${AGENT_GH_TOKEN:-$GH_TOKEN} bash "$REPO_DIR/docs/pipeline/merge.sh" "$pr" 2>&1); then
    log "#$n: $out"
    stage "$n"
    comment "$n" "runner: merged #$pr → main $(sed -n 's/^merged #[0-9]* -> main \([0-9a-f]*\).*/\1/p' <<<"$out")"
    gh api -X PATCH "$R/issues/$n" -f state=closed -f state_reason=completed --silent || log "#$n: cannot close"
  else
    log "#$n: merge of #$pr refused: $(tail -1 <<<"$out")"
  fi
}

# sync N PR HEAD: rebase the PR's branch onto main, every commit re-authored as karthik24iyer and without
# attribution lines, and push it (only if the branch is still at HEAD). A conflict goes to the builder.
sync() {
  local n=$1 pr=$2 hd=$3 branch wt msg
  branch=$(gh api "$R/pulls/$pr" --jq .head.ref) || return 1
  wt=$WORK_DIR/wt/$n-sync-$$
  mkdir -p "$WORK_DIR/wt"
  if [ -n "${DRY_RUN:-}" ]; then log "DRY: rebase $branch onto main and push"; return 0; fi
  git -C "$REPO_DIR" fetch -q origin main "+refs/heads/$branch:refs/remotes/origin/$branch" || return 1
  # Someone pushed since the check: the next check decides on the new head.
  [ "$(git -C "$REPO_DIR" rev-parse "origin/$branch")" = "$hd" ] || { log "#$n: $branch moved since the check: not synced"; return 0; }
  git -C "$REPO_DIR" worktree add -q --detach "$wt" "$hd" || return 1
  # shellcheck disable=SC2016 # the exec line runs in the rebase
  if (cd "$wt" && git config user.name $OWNER && git config user.email $OWNER@gmail.com &&
      git rebase -q origin/main --exec 'git log -1 --format=%B | grep -viE "^[[:space:]]*(co-authored-by|claude-session|generated-by):" | git commit -q --amend --no-verify --reset-author -F -' &&
      GH_TOKEN=${AGENT_GH_TOKEN:-$GH_TOKEN} git push -q --force-with-lease="$branch:$hd" origin "HEAD:refs/heads/$branch"); then
    msg="runner: synced with main from head ${hd:0:7}: new head $(git -C "$wt" rev-parse --short HEAD). Review and QA carry over when the changes are the same."
  else
    git -C "$wt" rebase --abort 2>/dev/null
    msg="runner: synced with main from head ${hd:0:7}: the rebase or push failed (conflicts?), the builder takes it."
  fi
  git -C "$REPO_DIR" worktree remove --force "$wt" 2>/dev/null
  log "#$n: $msg"; comment "$n" "$msg"
}

# full N PR HEAD: the merge-time run, the whole of ci.yml on the PR's branch (Full suite is its check).
full() {
  local n=$1 pr=$2 hd=$3 branch
  branch=$(gh api "$R/pulls/$pr" --jq .head.ref) || return 1
  # As karthik24iyer in the cloud too (AGENT_GH_TOKEN), so the run's end starts the next check.
  GH_TOKEN=${AGENT_GH_TOKEN:-$GH_TOKEN} act gh api "$R/actions/workflows/ci.yml/dispatches" -f ref="$branch" --silent || { log "#$n: cannot start the full suite"; return 1; }
  stage "$n" agent:ci
  comment "$n" "runner: full suite started on head ${hd:0:7} (merges when it is green)."
}

# rerun N PR HEAD: re-run the failed jobs of the head's failed CI runs once (a flaky test or the network);
# if they fail again, the builder takes it.
rerun() {
  local n=$1 hd=$3 id ids
  ids=$(gh api "$R/actions/runs?head_sha=$hd&per_page=20" --jq '.workflow_runs[] | select(.name == "CI" and .conclusion == "failure") | .id') || return 1
  for id in $ids; do GH_TOKEN=${AGENT_GH_TOKEN:-$GH_TOKEN} act gh api -X POST "$R/actions/runs/$id/rerun-failed-jobs" --silent || log "#$n: cannot re-run $id"; done
  stage "$n" agent:ci
  comment "$n" "runner: re-ran failed CI jobs on head ${hd:0:7}${ids:+ (run $(paste -sd, <<<"$ids"))}. If they fail again, the builder fixes them."
}

# Claude Code's own commit and PR attribution off in every step (common.md "Hard rules": the gate refuses it).
NO_ATTRIBUTION='{"attribution":{"commit":"","pr":""}}'

# job N STEP ACCOUNT MODEL PROMPT_FILE [SLOT]: one step, in the foreground.
job() {
  local n=$1 step=$2 account=$3 model=$4 pf=$5 slot=${6:-0} wt out result
  local logf
  logf=$WORK_DIR/logs/$n-$step-$(date -u +%Y%m%dT%H%M%SZ).log
  mkdir -p "$WORK_DIR/logs" "$WORK_DIR/wt"
  wt=$WORK_DIR/wt/$n-$step-$$
  local acc=(env -u ANTHROPIC_API_KEY -u CLAUDE_CONFIG_DIR) budget=() keyf=''
  case $account in
    max) [ "$PLACE" = cloud ] && acc=(env -u ANTHROPIC_API_KEY) ;; # cloud: CLAUDE_CODE_OAUTH_TOKEN from the workflow
    pro) if [ "$PLACE" = cloud ]; then acc=(env -u ANTHROPIC_API_KEY); else acc=(env -u ANTHROPIC_API_KEY CLAUDE_CONFIG_DIR="${PRO_CONFIG_DIR:?PRO_CONFIG_DIR not set}"); fi ;;
    api)
      : "${API_BUDGET_USD:?API_BUDGET_USD not set: the API account needs a dollar cap}"
      budget=(--max-budget-usd "$API_BUDGET_USD")
      if [ "$PLACE" = cloud ]; then acc=(env -u CLAUDE_CODE_OAUTH_TOKEN)
      else
        local kf=$CONF/anthropic-api-key
        [ -n "$(find "$kf" -maxdepth 0 -perm 600 2>/dev/null)" ] || { log "#$n: $kf missing or not mode 0600"; finish "$n" "" "runner: not started: the API key file is missing or not mode 0600."; return 1; }
        acc=(env -u CLAUDE_CODE_OAUTH_TOKEN -u CLAUDE_CONFIG_DIR) keyf=$kf
      fi ;;
  esac
  local nn=$((${E2E_PORT_BASE:-41} + slot))
  log "#$n: $step on $PLACE, $account/$model, log $logf"
  # origin/main as of this poll's fetch (one fetch per poll: parallel fetches race for the ref lock).
  if ! git -C "$REPO_DIR" worktree add -q --detach "$wt" origin/main; then
    finish "$n" "" "runner: $step stopped: cannot make a worktree on $PLACE."; return 1
  fi
  [ "$PLACE" = cloud ] || echo "$wt" >"$JOBS/$n/wt"
  (
    cd "$wt" && git config user.name $OWNER && git config user.email $OWNER@gmail.com
    # Exported here, not passed to env: an env argument shows in ps.
    if [ -n "$keyf" ]; then ANTHROPIC_API_KEY=$(cat "$keyf"); export ANTHROPIC_API_KEY; fi
    # In the cloud the agent writes as karthik24iyer with AGENT_GH_TOKEN; GITHUB_TOKEN can't (the gate only counts karthik24iyer).
    GH_TOKEN=${AGENT_GH_TOKEN:-$GH_TOKEN} E2E_PORT=5${nn}79 E2E_SERVER_PORT=3${nn}79 E2E_FAST_PORT=5${nn}80 E2E_FAST_SERVER_PORT=3${nn}80 \
      "${acc[@]}" claude -p "$(cat "$pf")" --model "$model" --dangerously-skip-permissions --settings "$NO_ATTRIBUTION" \
      --output-format stream-json --verbose ${budget[@]+"${budget[@]}"} </dev/null
  ) >"$logf" 2>&1
  log "#$n: $step exited $?"
  # The log mixes the JSON stream with any stderr lines: skip what isn't JSON.
  result=$(jq -nrR '[inputs | fromjson? | objects | select(.type == "result")] | last | .result // ""' "$logf")
  # The agent's own summary goes on the ticket, so the owner can follow every step there.
  out=$(printf '%s' "$result" | head -c 1500)
  finish "$n" "" "runner: $step finished on $PLACE:
${out:-(no summary: the log is $logf on $PLACE)}"
  # Remove a clean worktree; keep one with uncommitted work, detached so the next step can check out its branch.
  git -C "$REPO_DIR" worktree remove "$wt" 2>/dev/null || { git -C "$wt" checkout -q --detach; log "#$n: kept $wt (uncommitted changes)"; }
}

# free_wt JOB_DIR: detach the job's worktree (its changes stay), so its branch is free for the next step.
free_wt() { [ -f "$1/wt" ] && act git -C "$(cat "$1/wt")" checkout -q --detach; }

# finish N [blocked] [COMMENT]: the job is over: clear its stage label (and set agent:blocked).
finish() {
  [ "$2" = blocked ] && label_add "$1" agent:blocked
  stage "$1"
  [ -n "${3:-}" ] && comment "$1" "$3"
  [ "$PLACE" = cloud ] || rm -rf "${JOBS:?}/$1"
}

# Reap finished jobs; stop a job whose account label was removed.
reap() {
  local d n pid acct labels
  for d in "$JOBS"/*/; do
    [ -d "$d" ] || continue
    n=$(basename "$d"); pid=$(cat "$d/pid" 2>/dev/null)
    # Polls never overlap, so a job dir without a live pid is over.
    if ! alive "$pid"; then
      log "#$n: job ended without cleaning up"; free_wt "$d"; act rm -rf "$d"; stage "$n"; continue
    fi
    acct=$(cat "$d/account"); labels=$(gh api "$R/issues/$n" --jq '[.labels[].name] | join(" ")') || continue
    if [[ " $labels " != *" agent:$acct "* ]]; then
      log "#$n: agent:$acct removed: stopping the job"
      act kill -TERM -- "-$pid"
      free_wt "$d"
      stage "$n"
      comment "$n" "runner: stopped on $PLACE: the account label was removed. Add it again to resume."
      act rm -rf "$d"
    fi
  done
}

# stop N (the cloud, when the account label was removed): clear the stage label only if a cloud step holds it.
stop() {
  local held
  held=$(gh api --paginate "$R/issues/$1/comments?per_page=100" --jq '.[] | select((.user.login == "'$OWNER'" or .user.login == "github-actions[bot]")
    and ((.body // "") | startswith("runner: picked up on "))) | .body' | tail -1)
  case $held in
    "runner: picked up on cloud,"*) ;;
    *) log "#$1: no cloud step holds it"; return 0 ;;
  esac
  gh api "$R/issues/$1" --jq '.labels[].name' | grep -qxE 'agent:(dev|review|qa|working)' || return 0
  stage "$1"
  comment "$1" "runner: stopped on cloud: the account label was removed. Add it again to resume."
}

case ${1:-} in
  job) shift; job "$@"; exit ;;
  stop) stop "$2"; exit ;;
  merge|sync|full|rerun) "$1" "$2" "$3" "${4:-}"; exit ;;
  check) [ "$PLACE" = cloud ] || board_load; check "$2"; exit ;;
  "") ;;
  *) echo "usage: poll.sh [check N | stop N | merge|sync|full|rerun N PR [HEAD] | job N STEP ACCOUNT MODEL PROMPT_FILE [SLOT]]" >&2; exit 2 ;;
esac

# Keep the runner on the newest main: pipeline fixes reach this machine without anyone pulling. Only a clean
# checkout moves (main fast-forwards, a detached HEAD moves to origin/main); then this poll starts again from
# the new scripts. A running job keeps the copy it started with.
update() {
  [ "$PLACE" != cloud ] && [ -z "${SKIMJOB_UPDATED:-}" ] || return 0
  git -C "$REPO_DIR" fetch -q origin main 2>/dev/null || return 0
  [ -z "$(git -C "$REPO_DIR" status --porcelain -uno)" ] || { log "update: $REPO_DIR has local changes: not updated"; return 0; }
  [ "$(git -C "$REPO_DIR" rev-parse HEAD)" != "$(git -C "$REPO_DIR" rev-parse origin/main)" ] || return 0
  case $(git -C "$REPO_DIR" symbolic-ref -q --short HEAD) in
    main) act git -C "$REPO_DIR" merge -q --ff-only origin/main ;;
    "") act git -C "$REPO_DIR" checkout -q --detach origin/main ;;
    *) log "update: $REPO_DIR is on another branch: not updated"; return 0 ;;
  esac || return 0
  log "updated to $(git -C "$REPO_DIR" rev-parse --short HEAD)"
  SKIMJOB_UPDATED=1 exec bash "$0"
}
update

# One poll at a time.
lock=$WORK_DIR/poll.lock
if ! mkdir "$lock" 2>/dev/null; then
  alive "$(cat "$lock/pid" 2>/dev/null)" && exit 0
  rm -rf "$lock"; mkdir "$lock" || exit 0
fi
echo $$ >"$lock/pid"
trap 'rm -rf "$lock"' EXIT
log "poll on $PLACE${DRY_RUN:+ (dry run)}"
git -C "$REPO_DIR" fetch -q origin || log "fetch failed: jobs start from the last fetched origin/main"
reap
board_load
board_tidy
# Open tickets with any start label.
tickets=$(gh api --paginate "$R/issues?state=open&per_page=100" --jq '.[] | select(.pull_request == null)
  | select([.labels[].name] | any(test("^(agent:(max|pro|api)|on:(mac|linux|cloud))$"))) | .number') \
  || { log "cannot list issues"; exit 1; }
for n in $tickets; do check "$n"; done
