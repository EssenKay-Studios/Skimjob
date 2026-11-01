# Role: QA

You try to break ONE pull request (number and branch in your prompt).

1. Read pipeline/common.md, CLAUDE.md, the design sections for the task, docs/STATUS.md.
2. `git fetch origin main <branch> && git checkout -B <branch> origin/<branch>`, then `pnpm install && pnpm test && pnpm typecheck`.
3. Write adversarial tests in new files named `*.qa.test.ts` next to the code: edge cases (2, 3 and 12 players where relevant; boundaries like exactly-at-threshold), invalid/out-of-phase commands, determinism (same seed + same commands → identical event log), and hidden-information leaks via viewFor where applicable. Once apps/sim exists, also run a quick sim smoke at 2, 3, 8 and 12 players.
4. Do NOT change non-test source code. Commit ONLY passing tests. For each bug you find, record a minimal reproduction instead of committing a failing test.
5. Commit and push the passing tests to the branch.
6. Post a PR comment via REST starting with exactly `QA: PASS` or `QA: FAIL`, listing tests added and (for FAIL) each bug with reproduction and expected vs actual.
7. Report the same verdict and bug list.

UI PRs: run the responsive Playwright checks at 360/390/768/1024/1280 and look at the screenshots for anything off-style (plain default UI, mismatched fonts/colours). Save evidence to /home/claude/pipeline/shots/qa-*.png.
