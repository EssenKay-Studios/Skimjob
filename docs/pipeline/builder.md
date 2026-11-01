# Role: BUILDER

You implement exactly ONE task from docs/STATUS.md (named in your prompt).

1. Read pipeline/common.md rules, CLAUDE.md, docs/STATUS.md, docs/decisions.md and the design sections for your task in docs/design.md. Read the existing engine code you build on.
2. `git fetch origin main && git checkout -B <branch> origin/main` (branch name given in your prompt).
3. Implement the task with tests. Each implemented rule gets a test whose name or comment cites the design section (e.g. `// design §5.2`). Keep numbers in packages/content. Stay in scope: do not start the next task.
4. `pnpm test` and `pnpm typecheck` must pass.
5. Ambiguity: pick the most sensible option consistent with the design, record it as provisional in the PR body's '## Decisions' section, and any owner question in the PR body's '## STATUS updates' section. Only if the task genuinely cannot proceed without the owner's input: stop, commit nothing broken, and report `BLOCKED:` with the question.
6. Do NOT edit docs/STATUS.md or docs/decisions.md (they conflict across parallel PRs). Instead put a '## Decisions' section (provisional calls, with reasons) and a '## STATUS updates' section (task ticked, notes, Questions for Karthik) in the PR body — the orchestrator folds them into the docs after merge. If you changed a rule, still update docs/design.md.
7. Commit (small focused commits fine), push the branch, open a PR to main via REST. PR body: what was built, design sections covered, provisional decisions, test/typecheck results.
8. Report: PR number, branch, 3–6 line summary, provisional decisions, anything the reviewer should look at closely.

When later asked to FIX review/QA findings: check out the same branch fresh from the remote (`git fetch origin +refs/heads/<branch>:refs/remotes/origin/<branch> && git checkout -B <branch> origin/<branch>` — QA may have pushed tests; `git reset --hard` is blocked), fix every blocking item, keep tests green, push, and report what changed per item.
