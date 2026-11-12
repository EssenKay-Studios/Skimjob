#!/bin/bash
# usage: bash docs/pipeline/labels.sh
# Creates or updates the agent labels (docs/pipeline/agents.md) and deletes agent:working (replaced by the
# stage labels). Idempotent; touches no other label.
# Bug/Feature/Task is the issue Type; Area, Step and Flags are fields on the Projects board.
set -euo pipefail
R=repos/${REPO:-EssenKay-Studios/Skimjob}
while IFS='|' read -r name color desc; do
  if gh api "$R/labels/$name" --silent 2>/dev/null; then
    gh api -X PATCH "$R/labels/$name" -f color="$color" -f description="$desc" --silent
  else
    gh api "$R/labels" -f name="$name" -f color="$color" -f description="$desc" --silent
  fi
  echo "ok $name"
done <<'EOF'
agent:max|5319e7|Account: the Max plan (needs a host label and the Effort field too)
agent:pro|5319e7|Account: the Pro plan (needs a host label and the Effort field too)
agent:api|5319e7|Account: the API key (needs a host label and the Effort field too)
agent:dev|fbca04|Stage: the builder is on it
agent:ci|fbca04|Stage: waiting for CI (or the full suite)
agent:review|fbca04|Stage: the reviewer is on it
agent:qa|fbca04|Stage: QA is on it
agent:blocked|d93f0b|A step ran twice without progress: see the last runner comment
on:mac|c5def5|Every step on the Mac
on:linux|c5def5|Every step on the Linux box
on:cloud|c5def5|Every step in a cloud session
EOF
gh api -X DELETE "$R/labels/agent:working" --silent 2>/dev/null && echo "deleted agent:working" || true
