#!/usr/bin/env bash
# Lines added and removed per package, as the table for a PR body (docs/pipeline/builder.md).
# Usage: bash scripts/pr-stats.sh [base]   (default origin/main; run on the PR branch)
set -euo pipefail
git diff --numstat --no-renames "${1:-origin/main}...HEAD" | awk -F'\t' '
  $1 != "-" {
    split($3, p, "/")
    k = $3 ~ /^(apps|packages)\// ? p[1] "/" p[2] : $3 ~ /^docs\// ? "docs" : "other"
    add[k] += $1; del[k] += $2
  }
  END { for (k in add) print k "\t" add[k] "\t" del[k] }' | sort | awk -F'\t' '
  BEGIN { print "| Package | Added | Removed |"; print "|---|---:|---:|" }
  { print "| " $1 " | +" $2 " | -" $3 " |"; a += $2; d += $3 }
  END { print "| **Total** | +" a " | -" d " |" }'
