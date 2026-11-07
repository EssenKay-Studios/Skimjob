#!/usr/bin/env bash
# Run a long command in the background across the terminal tool's ~60 s calls (docs/pipeline/common.md).
#   bash scripts/bg.sh start <name> -- <cmd...>   run <cmd> detached; log and exit code are kept
#   bash scripts/bg.sh wait <name> [secs]         wait up to secs (max 50, default 50) for it to end; print status and log tail
#   bash scripts/bg.sh stop <name>                kill the command and everything it started, by pid
# Files live in $BG_DIR (default ~/.cache/skimjob-bg): <name>.log, <name>.pid, <name>.exit. Never /tmp, never pkill.
set -u
dir=${BG_DIR:-$HOME/.cache/skimjob-bg}
mkdir -p "$dir"
cmd=${1:-}; name=${2:-}
[ -n "$name" ] || { sed -n '2,6p' "$0" >&2; exit 2; }
log=$dir/$name.log pidf=$dir/$name.pid exitf=$dir/$name.exit

alive() { [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; }
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
    echo $! > "$pidf"
    echo "$name: started (pid $!), log $log" ;;
  wait)
    secs=${3:-50}; [ "$secs" -gt 50 ] && secs=50
    while [ "$secs" -gt 0 ] && [ ! -f "$exitf" ] && alive; do sleep 1; secs=$((secs - 1)); done
    status; tail -n 20 "$log" 2>/dev/null ;;
  stop)
    if alive; then pids=$(tree "$(cat "$pidf")"); kill $pids 2>/dev/null; sleep 0.3; echo stopped > "$exitf"; fi
    status ;;
  *) echo "usage: bg.sh start|wait|stop <name> ..." >&2; exit 2 ;;
esac
