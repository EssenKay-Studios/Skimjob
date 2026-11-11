#!/bin/bash
# usage: bash docs/pipeline/labels.sh
# Creates or updates the 21 agent labels (docs/pipeline/agents.md). Idempotent; touches no other label.
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
agent:max|5319e7|Account: the Max plan (needs a host and a model label too)
agent:pro|5319e7|Account: the Pro plan (needs a host and a model label too)
agent:api|5319e7|Account: the API key (needs a host and a model label too)
agent:working|fbca04|An agent is working on it
agent:blocked|d93f0b|The agent asked a question in the issue
ready-to-merge|0e8a16|Reviewed, QA passed, CI green: the owner merges
on:mac|c5def5|Every step on the Mac
on:linux|c5def5|Every step on the Linux box
on:cloud|c5def5|Every step in a cloud session
build:mac|bfd4f2|Build on the Mac
build:linux|bfd4f2|Build on the Linux box
build:cloud|bfd4f2|Build in a cloud session
review:mac|bfd4f2|Review on the Mac
review:linux|bfd4f2|Review on the Linux box
review:cloud|bfd4f2|Review in a cloud session
qa:mac|bfd4f2|QA on the Mac
qa:linux|bfd4f2|QA on the Linux box
qa:cloud|bfd4f2|QA in a cloud session
model:opus|d4c5f9|Every step on Opus
model:sonnet|d4c5f9|Every step on Sonnet
model:haiku|d4c5f9|Every step on Haiku
EOF
