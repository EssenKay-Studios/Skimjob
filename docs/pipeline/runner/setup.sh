#!/bin/bash
# usage: bash docs/pipeline/runner/setup.sh
# Checks this Mac or Linux box can run the agents, prints exactly what is missing, and installs and
# starts the runner service (launchd or a systemd user timer: poll.sh every 5 minutes) only when every
# check passes. Idempotent: run it again after fixing something, or to reinstall the service.
set -uo pipefail
CONF=$HOME/.config/skimjob-agent
ENV_FILE=$CONF/env
OWNER=karthik24iyer
here=$(cd "$(dirname "$0")" && pwd)
missing=()
need() { missing+=("$1"); }

case $(uname -s) in Darwin) os=mac ;; Linux) os=linux ;; *) echo "unsupported OS: $(uname -s)"; exit 1 ;; esac

if [ -f "$ENV_FILE" ]; then
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  [ "${PLACE:-}" = "$os" ] || need "$ENV_FILE: PLACE=$os"
  [ -n "${WORK_DIR:-}" ] || need "$ENV_FILE: WORK_DIR=<folder for logs, jobs and worktrees>"
  [[ ${E2E_PORT_BASE:-} =~ ^[1-5][0-9]$ ]] && [ "$E2E_PORT_BASE" -le 57 ] || need "$ENV_FILE: E2E_PORT_BASE=<10..57> (job k uses ports 5<base+k>79/80, 3<base+k>79/80)"
  if [ -n "${REPO_DIR:-}" ]; then
    [[ $(git -C "$REPO_DIR" remote get-url origin 2>/dev/null) == *EssenKay-Studios/Skimjob* ]] || need "a clone of EssenKay-Studios/Skimjob at REPO_DIR ($REPO_DIR)"
    [ "$(git -C "$REPO_DIR" config user.name)" = $OWNER ] && [ "$(git -C "$REPO_DIR" config user.email)" = $OWNER@gmail.com ] \
      || need "git identity in $REPO_DIR: git config user.name $OWNER && git config user.email $OWNER@gmail.com"
  else need "$ENV_FILE: REPO_DIR=<the Skimjob clone>"; fi
  if [ -f "$CONF/anthropic-api-key" ]; then
    [ -n "$(find "$CONF/anthropic-api-key" -maxdepth 0 -perm 600)" ] || need "chmod 600 $CONF/anthropic-api-key"
    [[ ${API_BUDGET_USD:-} =~ ^[0-9]+(\.[0-9]+)?$ ]] || need "$ENV_FILE: API_BUDGET_USD=<dollar cap per API job> (the API key file is there)"
  fi
else
  need "$ENV_FILE with PLACE=$os, REPO_DIR, WORK_DIR, E2E_PORT_BASE and PATH (node 22, pnpm, gh, claude, jq); optional PRO_CONFIG_DIR, API_BUDGET_USD"
fi

# 22.18+ runs scripts/agent-start.ts without a build step (type stripping).
[[ $(node -v 2>/dev/null) =~ ^v22\.(1[89]|[2-9][0-9])\. ]] || need "Node 22.18 or later 22.x on PATH (have: $(node -v 2>/dev/null || echo none))"
command -v pnpm >/dev/null || need "pnpm on PATH"
command -v jq >/dev/null || need "jq on PATH"
command -v perl >/dev/null || need "perl on PATH"
if [ $os = mac ]; then pw=$HOME/Library/Caches/ms-playwright; else pw=$HOME/.cache/ms-playwright; fi
compgen -G "${PLAYWRIGHT_BROWSERS_PATH:-$pw}/chromium*" >/dev/null || need "Playwright Chromium: cd apps/web && npx playwright install chromium (Linux: --with-deps)"
if command -v claude >/dev/null; then
  env -u ANTHROPIC_API_KEY -u CLAUDE_CONFIG_DIR claude auth status 2>/dev/null | grep -q '"loggedIn": true' || need "Claude Code logged in to Max: claude auth login"
  if [ -n "${PRO_CONFIG_DIR:-}" ]; then
    CLAUDE_CONFIG_DIR=$PRO_CONFIG_DIR claude auth status 2>/dev/null | grep -q '"loggedIn": true' || need "Claude Code logged in to Pro: CLAUDE_CONFIG_DIR=$PRO_CONFIG_DIR claude auth login"
  fi
else need "Claude Code on PATH (npm install -g @anthropic-ai/claude-code)"; fi
gh auth token --user $OWNER >/dev/null 2>&1 || need "gh logged in as $OWNER: gh auth login (with the project scope: gh auth refresh -s project)"

if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing:"; printf '  - %s\n' "${missing[@]}"
  echo "Nothing installed."
  exit 1
fi

mkdir -p "$WORK_DIR"
fill() { sed -e "s|@REPO_DIR@|$REPO_DIR|g" -e "s|@WORK_DIR@|$WORK_DIR|g" "$1"; }
if [ $os = mac ]; then
  plist=$HOME/Library/LaunchAgents/com.skimjob.agent.plist
  mkdir -p "$(dirname "$plist")"
  fill "$here/com.skimjob.agent.plist" >"$plist"
  launchctl bootout "gui/$(id -u)/com.skimjob.agent" 2>/dev/null
  launchctl bootstrap "gui/$(id -u)" "$plist" || { echo "launchctl bootstrap failed"; exit 1; }
  echo "installed $plist (every 5 minutes); log $WORK_DIR/poll.log"
else
  units=$HOME/.config/systemd/user
  mkdir -p "$units"
  fill "$here/skimjob-agent.service" >"$units/skimjob-agent.service"
  cp "$here/skimjob-agent.timer" "$units/skimjob-agent.timer"
  if ! { systemctl --user daemon-reload && systemctl --user enable --now skimjob-agent.timer; }; then echo "systemctl failed"; exit 1; fi
  loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q yes || echo "note: run 'sudo loginctl enable-linger $USER' so the timer runs while you are logged out"
  echo "installed skimjob-agent.timer (every 5 minutes); log $WORK_DIR/poll.log"
fi
