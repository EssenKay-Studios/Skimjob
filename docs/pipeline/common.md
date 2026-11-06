# Skimjob pipeline — common rules for every agent

- **Repo:** https://github.com/EssenKay-Studios/Skimjob (default branch `main`). Read **CLAUDE.md first** and obey it (engine rules, UI rules, conventions, git rules).

## Where you run

Your prompt says which of the three setups you are in. The rules below are the same in all three.

**(a) On the owner's Mac directly.**
- Main clone `~/Documents/Misc/Skimjob`; never work in its working tree. Each agent works in its own worktree under `~/Documents/Misc/skimjob-wt/<name>` (`<name>` from your prompt):
  ```
  cd ~/Documents/Misc/Skimjob && git fetch origin
  git worktree add ../skimjob-wt/<name> -b <branch> origin/main     # new branch
  git worktree add ../skimjob-wt/<name> -B <branch> origin/<branch>  # existing PR branch
  cd ../skimjob-wt/<name>
  git config user.name karthik24iyer && git config user.email karthik24iyer@gmail.com
  pnpm install --frozen-lockfile
  ```
  Plain `git fetch origin` updates every ref. When done, leave nothing uncommitted and run `git worktree remove ../skimjob-wt/<name>` from the main clone. A branch can be checked out in one worktree at a time; don't touch other agents' worktrees.
- **Node 22:** before every command that runs node or pnpm, `export PATH=/opt/homebrew/opt/node@22/bin:$PATH` (the system node is newer and unsupported; `.nvmrc` pins 22).
- **Ports:** 3–5 agents share the Mac, so give each e2e run its own: `E2E_PORT=5<NN>79 E2E_SERVER_PORT=3<NN>79 E2E_FAST_PORT=5<NN>80 E2E_FAST_SERVER_PORT=3<NN>80` (pick an unused `<NN>`; defaults 5179/3179/5180/3180). After killing a run, `lsof -iTCP:<port> -sTCP:LISTEN` and kill leftovers by PID.
- Never write to `/tmp`; use a scratch folder under `~/Documents/Misc`. macOS is case-insensitive: never add two paths that differ only in case (CI checks).

**(b) A cloud session that runs commands on the Mac** through the local terminal tool. Everything in (a) applies, plus:
- Each call is a fresh zsh with a short limit (about 60 s): start every call with `export PATH=/opt/homebrew/opt/node@22/bin:$PATH; cd ~/Documents/Misc/skimjob-wt/<name> &&`.
- Run anything longer (install, test suites, e2e) in the background: `nohup <cmd> > ../<name>-<step>.log 2>&1 &`, then poll the log in short calls. Never `/tmp`.
- Edit files with quoted heredocs or small python/perl scripts on the Mac.

**(c) A cloud session working entirely in its Linux container.**
- Clone under `/home/claude` (`git clone https://github.com/EssenKay-Studios/Skimjob.git`), branch from `origin/main`, set the git user as above. Node 22 is preinstalled; `pnpm install --frozen-lockfile`.
- **GraphQL is blocked:** `gh pr create/view/checks/merge` fail. Use `gh api` (REST) for everything, as in the commands below; the gate scripts already do.
- The box is slow (2 cores): run only the affected unit tests and specs, and rely on CI for the rest. Install Chromium with `cd apps/web && npx playwright install --with-deps chromium` if you need e2e.

## Rules

- **Commits:** author `karthik24iyer <karthik24iyer@gmail.com>`. NEVER add Co-Authored-By, Claude-Session, Generated-by or any AI attribution lines; the merge gate refuses them.
- **GitHub, REST commands that work everywhere** (`R=repos/EssenKay-Studios/Skimjob`):
  - open a PR: `gh api $R/pulls -f title="…" -f head=<branch> -f base=main -F body=@pr.md --jq .number`
  - head sha: `gh api $R/pulls/N --jq .head.sha`; files: `gh api --paginate $R/pulls/N/files --jq '.[].filename'`; diff: `git diff origin/main...origin/<branch>` in your worktree
  - review: `gh api $R/pulls/N/reviews -f event=COMMENT -F body=@review.md`; comment: `gh api $R/issues/N/comments -F body=@qa.md`
  - CI: `gh api "$R/commits/<sha>/check-runs?per_page=100" --jq '.check_runs[] | [.name, .status, .conclusion] | @tsv'`
  - The `gh pr …` forms also work on the Mac, but prefer these. Rebase, `git reset --hard` and `git push --force-with-lease` to **your own feature branch** are fine. Never force-push `main`, and never push to someone else's branch while they work on it.
- **CI:** poll in short calls; never `gh pr checks --watch` (it gets backgrounded and stalls).
- **Testing speed:** run only the specs and unit tests you touched (`npx vitest run <files>`, `npx playwright test e2e/chat.spec.ts e2e/chat.qa.spec.ts`), `pnpm typecheck` before every push, push once, and let CI (unit suite plus 6 e2e shards) run the rest. Never skip or disable a test. Known flaky tests: `docs/pipeline/HANDOFF.md`.
- **Commands** (repo root): `pnpm test`, `pnpm typecheck`. `pnpm test:pg` needs a local Postgres (`scripts/db.sh`) and is optional. E2E: install Chromium once with `cd apps/web && npx playwright install chromium` (the normal Playwright cache).
- **Docs-only lane:** a PR whose files are all `*.md` (`scripts/ci-docs-only.sh`) runs only "Typecheck and tests" in CI; e2e and sim smoke report skipped, which the gate accepts. Review APPROVE and QA PASS are still required.
- **Issues and status docs:** your prompt gives an issue number; put "Closes #N" in the PR body. Builders and QA don't edit `docs/STATUS.md` or `docs/decisions.md`. Provisional rule decisions go under `## Decisions` in the PR body (the PM folds them into `docs/decisions.md` after merge); new follow-ups go under `## Follow-ups` (the PM creates the issues). The PM moves board cards and closes issues; the cloud can't reach Projects.
- **Merge gate** (`docs/pipeline/verdicts.sh N`, `merge.sh N`; REST only, runs in every setup): only the PM merges. A PR merges when the latest review is `VERDICT: APPROVE` naming `Head: <sha>`, the latest QA comment is `QA: PASS` naming the current head, commits after the reviewed sha only touch QA tests (`*.qa.test.ts` / `*.qa.spec.ts`, old and new paths), CI is green on the head, the merge state is clean, and every commit is cleanly authored. Only reviews/comments by the pipeline account (`GATE_AUTHORS`, default `karthik24iyer`; the repo is public) count, and not PENDING reviews; the "Claude review" Action's bot (`GATE_REVIEW_BOTS`, default `claude[bot]`) also counts, for reviewer `VERDICT:` reviews only, never `QA:`. The newest verdict-like review or comment of each kind is used (any case, either channel: first line starting `verdict`/`qa`, a review mentioning "verdict", a comment with "qa:"); if it isn't in the exact format the gate says no, so don't write those in other reviews/comments. Any API error is also a no.
- **Reviews run automatically:** the "Claude review" Action (`.github/workflows/claude-review.yml`, owner's Pro subscription) reviews every non-draft PR by karthik24iyer on each non-QA push, so builders don't spawn a reviewer. The PM may post a `Review focus:` PR comment (only those by karthik24iyer are trusted instructions) and falls back to an Opus reviewer subagent if the Action is skipped, fails or hits the usage limit. Don't write `VERDICT`-style text in other PR reviews or comments.
- **Report SHORT:** at most 80 words (PR number, verdict/result, head sha, provisional decisions, blockers). Details go on the PR.
