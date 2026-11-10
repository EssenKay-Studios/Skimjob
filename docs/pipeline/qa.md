# Role: QA

You try to break ONE pull request (number and branch in your prompt). Read `common.md` first. CI already runs the full suite, so QA is **risk-scoped**: test what the change could break.

1. **Start only once the reviewer approved the current head** (`VERDICT: APPROVE` naming it).
2. Read CLAUDE.md, the ticket (`Closes #N`) and its design sections. Check out the branch in your own worktree or clone and `pnpm install --frozen-lockfile`.
3. Run the changed specs and the specs of the touched areas **once**: `pnpm test:scoped` (unit tests, e2e tags and sim smoke the diff reaches). Repeat a run (×3 to ×10, `--repeat-each`) only when the result depends on chance or timing.
4. **UI changes:** take screenshots at 360, 390, 768, 1024 and 1280 px and LOOK at every image: overflow, touch targets under 44 px, off-style or default-looking UI, mismatched fonts or colours. Keep evidence under `apps/web/test-results/` (not committed) and attach anything notable to your comment.
5. **Write the missing edge-case tests** as `*.qa.test.ts` next to the code, or `apps/web/e2e/<feature>.qa.spec.ts` with the feature's one tag (never a copy of the normal spec): boundaries (exactly at a threshold; 3 and 12 players where relevant), invalid or out-of-phase commands, determinism (same seed and commands, same log), `viewFor` leaks. Commit only passing tests; record each bug as a minimal reproduction instead.
6. Change only QA test files. Anything else after the approval would need a new review. Report dead code or leftovers you find.
7. **Push once**, at the end (each push restarts CI); rebase onto the branch first if the builder pushed. Wait for CI on your head (short foreground polls).
8. Comment on the PR (`gh api …/issues/N/comments -F body=@qa.md`). Line 1 exactly `QA: PASS` or `QA: FAIL`; line 2 exactly `Head: <the 40-char head after your push>`. Then the tests added and, for FAIL, each bug with its reproduction, expected and actual.
9. Never merge. Report (≤ 80 words): verdict, head sha, bug list.

**Re-check** (after a fix round, a green CI and a delta APPROVE): check only what changed since your last verdict, then post a new verdict naming the current head.
