#!/usr/bin/env bash
# Run a long command in the background across the terminal tool's ~60 s calls (docs/pipeline/common.md).
#   bash scripts/bg.sh start <name> -- <cmd...>   run <cmd> detached; log and exit code are kept
#   bash scripts/bg.sh wait <name> [secs]         wait up to secs (max 35, default 35, measured against a deadline) for it to end; print status and log tail
#   bash scripts/bg.sh stop <name>                kill the command and everything it started, by pid
# Files live in $BG_DIR (default: .skimjob-bg next to the worktree, i.e. in its parent folder): <name>.log, .pid, .start, .exit.
# Never /tmp, never pkill.
set -u
dir=${BG_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/.skimjob-bg}
mkdir -p "$dir"
cmd=${1:-}; name=${2:-}
case $name in ""|*[!A-Za-z0-9._-]*) sed -n '2,6p' "$0" >&2; echo "name: letters, digits, . _ - only" >&2; exit 2 ;; esac
log=$dir/$name.log pidf=$dir/$name.pid exitf=$dir/$name.exit startf=$dir/$name.start

# Ours only if it has not exited and the pid still started when we started it (guards against a reused pid).
alive() { [ -f "$pidf" ] && [ ! -f "$exitf" ] && [ "$(ps -o lstart= -p "$(cat "$pidf")" 2>/dev/null)" = "$(cat "$startf" 2>/dev/null)" ]; }
tree() { local c; echo "$1"; for c in $(pgrep -P "$1"); do tree "$c"; done; }
status() {
  if [ -f "$exitf" ]; then echo "$name: $(sed "s/^[0-9]/exited &/" "$exitf")"
  elif alive; then echo "$name: running (pid $(cat "$pidf"))"
  else echo "$name: gone without an exit code"; fi
}

case $cmd in
  start)
    shift 2; [ "${1:-}" = -- ] && shift
    [ $# -gt 0 ] || { echo "usage: bg.sh start <name> -- <cmd...>" >&2; exit 2; }
    alive && { echo "$name is already running (pid $(cat "$pidf")); stop it first" >&2; exit 1; }
    rm -f "$exitf"
    nohup bash -c '"$@"; echo $? > "$0"' "$exitf" "$@" >"$log" 2>&1 </dev/null &
    echo $! > "$pidf"; ps -o lstart= -p $! > "$startf"
    echo "$name: started (pid $!), log $log" ;;
  wait)
    secs=${3:-35}; case $secs in *[!0-9]*|"") secs=35 ;; esac; [ "$secs" -gt 35 ] && secs=35
    # A deadline, not a countdown: a loaded Mac stretches each sleep, so count elapsed time. 35 s + the last sleep + the tail stays under 40 s.
    SECONDS=0
    while [ "$SECONDS" -lt "$secs" ] && [ ! -f "$exitf" ] && alive; do sleep 1; done
    status; tail -n 20 "$log" 2>/dev/null ;;
  stop)
    if alive; then pids=$(tree "$(cat "$pidf")"); kill $pids 2>/dev/null; sleep 0.3; echo stopped > "$exitf"; fi
    status ;;
  *) echo "usage: bg.sh start|wait|stop <name> ..." >&2; exit 2 ;;
esac
