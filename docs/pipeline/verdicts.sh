#!/bin/bash
# usage: verdicts.sh PR -> latest review verdict + latest QA verdict
R=repos/EssenKay-Studios/Skimjob
v=$(gh api $R/pulls/$1/reviews --jq '.[-1].body' 2>/dev/null | grep -m1 -o 'VERDICT: [A-Z ]*')
q=$(gh api $R/issues/$1/comments --jq '[.[]|select(.body|startswith("QA:"))][-1].body' 2>/dev/null | head -1)
echo "review: ${v:-none} | qa: ${q:-none}"
