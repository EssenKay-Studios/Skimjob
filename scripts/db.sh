#!/usr/bin/env bash
# Local Postgres for `pnpm dev` and the real-Postgres test run, without Docker:
# a throwaway cluster in .pgdata/ (gitignored). Trust auth on localhost only.
#   scripts/db.sh start | stop | status | url
# Env: PGPORT (default 5433), PG_BIN (default: newest /usr/lib/postgresql/*/bin
# or whatever is on PATH). Running as root, the cluster runs as `postgres`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.pgdata"
PORT="${PGPORT:-5433}"
USER_NAME=skimjob
DB_NAME=skimjob
URL="postgres://$USER_NAME@127.0.0.1:$PORT/$DB_NAME"

if [[ -z "${PG_BIN:-}" ]]; then
  PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  [[ -n "$PG_BIN" ]] || PG_BIN="$(dirname "$(command -v pg_ctl || echo /nonexistent/pg_ctl)")"
fi
[[ -x "$PG_BIN/pg_ctl" ]] || { echo "pg_ctl not found; set PG_BIN or use docker compose up -d" >&2; exit 1; }

# Postgres refuses to run as root: run its tools as the postgres user instead.
as_pg() {
  if [[ "$(id -u)" == 0 ]]; then runuser -u postgres -- "$@"; else "$@"; fi
}

case "${1:-}" in
  start)
    if [[ ! -f "$DATA/PG_VERSION" ]]; then
      mkdir -p "$DATA"
      [[ "$(id -u)" == 0 ]] && chown postgres "$DATA"
      as_pg "$PG_BIN/initdb" -D "$DATA" -U "$USER_NAME" --auth=trust -E UTF8 >/dev/null
    fi
    if ! as_pg "$PG_BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      as_pg "$PG_BIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w \
        -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" start >/dev/null
    fi
    if ! as_pg "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U "$USER_NAME" -d postgres -tAc \
        "select 1 from pg_database where datname = '$DB_NAME'" | grep -q 1; then
      as_pg "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U "$USER_NAME" "$DB_NAME"
    fi
    echo "$URL"
    ;;
  stop)
    if [[ -f "$DATA/PG_VERSION" ]] && as_pg "$PG_BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      as_pg "$PG_BIN/pg_ctl" -D "$DATA" -w stop >/dev/null
    fi
    ;;
  status) as_pg "$PG_BIN/pg_ctl" -D "$DATA" status ;;
  url) echo "$URL" ;;
  *) echo "usage: scripts/db.sh start|stop|status|url" >&2; exit 2 ;;
esac
