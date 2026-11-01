#!/bin/sh
# Container entrypoint (Dockerfile). A fresh Fly volume (or Docker volume) is
# mounted owned by root, so as root: make PGlite's directory, hand it to the
# unprivileged `node` user, then run the server as `node`. docs/deploy.md
set -eu

if [ "$(id -u)" = "0" ]; then
  if [ -z "${DATABASE_URL:-}" ] && [ -n "${PGLITE_DIR:-}" ] && [ "$PGLITE_DIR" != "memory" ]; then
    mkdir -p "$PGLITE_DIR"
    chown -R node:node "$PGLITE_DIR"
  fi
  exec su-exec node "$@"
fi
exec "$@"
