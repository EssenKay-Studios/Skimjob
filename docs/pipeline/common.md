# Skimjob pipeline — common rules for every agent

- **Repo:** https://github.com/EssenKay-Studios/Skimjob (default branch `main`). Main clone: `/Users/karthikeyaniyer/Documents/Misc/Skimjob` on the owner's Mac. Don't work in the main clone's working tree.
- **Your own worktree.** Every agent works in its own git worktree under `/Users/karthikeyaniyer/Documents/Misc/skimjob-wt/<name>` (`<name>` from your prompt):
  ```
  cd /Users/karthikeyaniyer/Documents/Misc/Skimjob && git fetch origin
  git worktree add ../skimjob-wt/<name> -b <branch> origin/main     # new branch
  git worktree add ../skimjob-wt/<name> -B <branch> origin/<branch>  # existing PR branch
  cd ../skimjob-wt/<name>
  git config user.name karthik24iyer && git config user.email karthik24iyer@gmail.com
  pnpm install --frozen-lockfile
  ```
  It's a full clone: plain `git fetch origin` updates every remote-tracking ref. When the task is done, leave nothing uncommitted and remove it: `git worktree remove ../skimjob-wt/<name>` (from the main clone). A branch can be checked out in only one worktree at a time.
- **Node 22.** Before every shell command that runs node or pnpm: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH` (the system node is newer and unsupported; `.nvmrc` says 22 for fnm/nvm users). pnpm is on PATH.
- **Read CLAUDE.md first** and obey it (engine rules, UI rules, conventions, git rules).
- **Commits:** author `karthik24iyer <karthik24iyer@gmail.com>`. NEVER add Co-Authored-By, Claude-Session, Generated-by or any AI attribution lines; the merge gate refuses them.
- **GitHub:** `gh` is logged in. Prefer `gh pr create`, `gh pr view`, `gh pr diff`, `gh pr review N --comment --body-file F`, `gh pr comment N --body-file F`; `gh api` (REST or GraphQL) for the rest. Rebase, `git reset --hard` and `git push --force-with-lease` to **your own feature branch** are fine. Never force-push `main`, and never push to someone else's branch while they work on it.
- **Commands** (repo root): `pnpm test`, `pnpm typecheck`. Postgres tests (`pnpm test:pg`) need Homebrew postgres and are optional.
- **E2E:** install the browser once: `cd apps/web && npx playwright install chromium` (normal Mac cache, no `PLAYWRIGHT_BROWSERS_PATH`). 3–5 agents (Opus subagents) run at once on this Mac, so:
  - give your run its own ports: `E2E_PORT=5<NN>79 E2E_SERVER_PORT=3<NN>79 E2E_FAST_PORT=5<NN>80 E2E_FAST_SERVER_PORT=3<NN>80` (pick an unused `<NN>`; defaults are 5179/3179/5180/3180);
  - while iterating, run only the affected specs: `npx playwright test e2e/chat.spec.ts e2e/chat.qa.spec.ts`;
  - run the full e2e (`npx playwright test`, all projects) once before the final push.
  - If you kill a run, check `lsof -iTCP:<port> -sTCP:LISTEN` and kill the leftover vite/server processes by PID.
- **Status docs:** builders and QA don't edit `docs/STATUS.md` or `docs/decisions.md`. Put `## Decisions` and `## STATUS updates` sections in the PR body; the PM folds them in after merge.
- **Merge gate** (`docs/pipeline/verdicts.sh N`, `merge.sh N`): only the PM merges. A PR merges when the latest review is `VERDICT: APPROVE` naming `Head: <sha>`, the latest QA comment is `QA: PASS` naming the current head, commits after the reviewed sha only touch QA tests (`*.qa.test.ts` / `*.qa.spec.ts`, old and new paths), CI is green on the head, and every commit is cleanly authored. Only reviews/comments by the pipeline account (`GATE_AUTHORS`, default `karthik24iyer`; the repo is public) count, and not PENDING reviews. The newest verdict-like review or comment of each kind is used (any case, either channel: first line starting `verdict`/`qa`, a review mentioning "verdict", a comment with "qa:"); if it isn't in the exact format the gate says no, so don't write those in other reviews/comments. Any gh/API error is also a no.
- **Report SHORT:** at most 80 words (PR number, verdict/result, head sha, provisional decisions, blockers). Details go on the PR.
