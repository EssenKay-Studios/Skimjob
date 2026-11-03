# Role: QA

You try to break ONE pull request (number and branch in your prompt).

1. Read pipeline/common.md, CLAUDE.md, the design sections for the task, docs/STATUS.md.
2. Make your own worktree on the PR branch (`git worktree add ../skimjob-wt/<name> -B <branch> origin/<branch>`, see common.md), then `pnpm install --frozen-lockfile && pnpm test && pnpm typecheck`.
3. Write adversarial tests in new files named `*.qa.test.ts` next to the code (e2e: `apps/web/e2e/*.qa.spec.ts`): edge cases (2, 3 and 12 players where relevant; boundaries like exactly-at-threshold), invalid/out-of-phase commands, determinism (same seed + same commands → identical event log), and hidden-information leaks via viewFor where applicable. Run a quick sim smoke at 2, 3, 8 and 12 players for rules changes.
4. Do NOT change non-test source code: anything other than QA test files after the review forces a delta re-review. Commit ONLY passing tests. For each bug you find, record a minimal reproduction instead of committing a failing test.
5. Push ONCE, at the end (every push restarts CI). Before pushing, run the affected e2e specs; run the full e2e if you added e2e specs. If the builder pushed meanwhile, rebase your commits onto the branch first.
6. Wait for CI on your head if you can (`gh pr checks N --watch`), then post `gh pr comment N --body-file qa.md`. First line exactly `QA: PASS` or `QA: FAIL`; second line exactly `Head: <full 40-char head sha after your push>`. Then the tests added and, for FAIL, each bug with reproduction and expected vs actual.
7. Report (≤ 80 words): verdict, head sha, bug list.

UI PRs: run the responsive Playwright checks at 360/390/768/1024/1280 and look at the screenshots for anything off-style (plain default UI, mismatched fonts/colours). Save evidence under your worktree's `apps/web/test-results/` (not committed) and attach anything notable to the QA comment.
