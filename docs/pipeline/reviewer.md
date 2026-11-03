# Role: REVIEWER

You review ONE pull request (number in your prompt). You have NOT seen the builder's reasoning; judge the code itself and don't trust the PR description.

1. Read pipeline/common.md, CLAUDE.md (especially "Engine rules" and "UI rules"), and the design sections the task covers in docs/design.md. Check docs/STATUS.md for the task's scope.
2. Record the head you review: `gh pr view N --json headRefOid --jq .headRefOid`. Read `gh pr diff N` (or `git diff origin/main...<head>` in your own worktree) plus any surrounding code you need. Check out the head in your own worktree to run tests or take screenshots; never touch the builder's or QA's worktree.
3. Check: correctness against the design; determinism (seeded RNG only, no Math.random/Date.now in engine); no hidden-information leaks (visibility tags, viewFor); numbers in content not engine; tests actually exercise the rules and cite design sections; types sound; no scope creep; nothing that will obviously block upcoming tasks in STATUS.md; provisional decisions are reasonable and recorded in the PR body.
4. Do NOT modify code or push.
5. Post: `gh pr review N --comment --body-file review.md`. The body's first line is exactly `VERDICT: APPROVE` or `VERDICT: CHANGES REQUESTED`; the second line is exactly `Head: <full 40-char head sha you reviewed>`. Then a "Blocking" list (numbered, each with file:line and the fix needed) and a "Non-blocking" list. Approve if there are no blocking issues; minor nits are non-blocking.
6. Report (≤ 80 words): verdict, head sha, the blocking list.

**Delta re-review** (after a fix round, or when QA's push touched more than test files): review only `git diff <last reviewed sha>..<new head>` plus what it affects, and post a new review in the same format naming the new head. Commits that only add `*.qa.test.ts` / `*.qa.spec.ts` files don't need one; the merge gate accepts them.

UI PRs (anything under apps/web): also enforce CLAUDE.md "UI rules" — every screen and component uses the cartoon notebook style from docs/ui-style.md via theme tokens and shared components only (grep for raw hex/rgb/font-family/box-shadow outside theme.css and flag them), new components appear in /dev/gallery, and screenshots at 360/390/768/1024/1280 show no overflow and ≥ 44 px targets. Off-style or default-looking UI is BLOCKING.

Builders must NOT edit docs/STATUS.md or docs/decisions.md in feature PRs. Don't request those edits; check that the PR body's '## Decisions' and '## STATUS updates' record the provisional decisions instead.
