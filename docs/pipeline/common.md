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
- **Ports:** 3–5 agents share the Mac, so give each e2e run its own: `E2E_PORT=5<NN>79 E2E_SERVER_PORT=3<NN>79 E2E_FAST_PORT=5<NN>80 E2E_FAST_SERVER_PORT=3<NN>80` (pick an unused `<NN>`; defaults 5179/3179/5180/3180). Playwright reuses a server already listening on your ports (`reuseExistingServer`, not in CI): it serves the code it started with, so after switching branch or commit, or killing a run, `lsof -iTCP:<port> -sTCP:LISTEN` and kill leftovers by PID. The PM lets at most 2 e2e runs go on the Mac at once (HANDOFF); an agent the PM gave no slot works in setup (c), where e2e runs in the cloud and CI.
- Never write to `/tmp`; use a scratch folder under `~/Documents/Misc`. macOS is case-insensitive: never add two paths that differ only in case (CI checks).

**(b) A cloud session that runs commands on the Mac** through the local terminal tool. Everything in (a) applies, plus:
- Each call is a fresh zsh with a short limit (about 60 s): start every call with `export PATH=/opt/homebrew/opt/node@22/bin:$PATH; cd ~/Documents/Misc/skimjob-wt/<name> &&`.
- Run anything longer (install, `pnpm precheck`, test suites, e2e) with `scripts/bg.sh`, one short call each, never `/tmp`, never `pkill`:
  ```
  bash scripts/bg.sh start <step> -- pnpm precheck   # detached; log, pid and exit code kept in `.skimjob-bg` in the worktree's parent folder (`BG_DIR`), so under `~/Documents/Misc` on the Mac
  bash scripts/bg.sh wait <step> [secs]               # waits up to 40 s (the cap; the terminal tool allows 60 s and a loaded Mac overran 50), prints running/exited N and the log's last 20 lines
  bash scripts/bg.sh stop <step>                      # kills the command and its children by pid
  ```
  Repeat `wait` until it says `exited`. Names are per machine, so prefix yours with `<name>-`. Pass an env prefix or a `cd` as `-- bash -c 'E2E_PORT=… pnpm precheck'`.
- Edit files with quoted heredocs or small python/perl scripts on the Mac.

**(c) A cloud session working entirely in its Linux container.**
- Clone under `/home/claude` (`git clone https://github.com/EssenKay-Studios/Skimjob.git`), branch from `origin/main`, set the git user as above. Node 22 is preinstalled; `pnpm install --frozen-lockfile`.
- **GraphQL is blocked:** `gh pr create/view/checks/merge` fail. Use `gh api` (REST) for everything, as in the commands below; the gate scripts already do.
- The box is slow (2 cores): run only the affected unit tests and specs (`pnpm precheck` scopes itself), and rely on CI for the rest. Install Chromium with `cd apps/web && npx playwright install --with-deps chromium` if you need e2e.

## Rules

- **Commits:** author `karthik24iyer <karthik24iyer@gmail.com>`. NEVER add Co-Authored-By, Claude-Session, Generated-by or any AI attribution lines; the merge gate refuses them.
- **GitHub, REST commands that work everywhere** (`R=repos/EssenKay-Studios/Skimjob`):
  - open a PR: `gh api $R/pulls -f title="…" -f head=<branch> -f base=main -F body=@pr.md --jq .number`
  - head sha: `gh api $R/pulls/N --jq .head.sha`; files: `gh api "$R/pulls/N/files?per_page=100" --jq '.[].filename'` (add `&page=2`… for more; `--paginate` fails from the cloud proxy); diff: `git diff origin/main...origin/<branch>` in your worktree
  - review: `gh api $R/pulls/N/reviews -f event=COMMENT -F body=@review.md`; comment: `gh api $R/issues/N/comments -F body=@qa.md`
  - CI: `gh api "$R/commits/<sha>/check-runs?per_page=100" --jq '.check_runs[] | [.name, .status, .conclusion] | @tsv'`
  - The `gh pr …` forms also work on the Mac, but prefer these. Rebase, `git reset --hard` and `git push --force-with-lease` to **your own feature branch** are fine. Never force-push `main`, and never push to someone else's branch while they work on it.
- **CI:** poll in short calls; never `gh pr checks --watch` (it gets backgrounded and stalls).
- **Testing speed:** run `pnpm precheck` before every push: typecheck, knip, the theme-token lint (`pnpm lint:theme`, no raw colours, fonts, shadows or radii outside `theme.css`) and `scope.mjs --check` (feature tags), run in parallel, then `pnpm test:scoped` (it scopes your diff against `origin/main` exactly as CI does, runs the tests that diff needs and prints what it chose), then Playwright `--repeat-each=3` on the e2e specs you added or changed. It exits at once when only docs changed. Push once and let CI run the same checks and the scoped set. The full tier runs on `main` after each merge and nightly (`docs/testing.md` "Scoped tests"). For one spec or test file: `npx vitest run <files>`, `npx playwright test e2e/chat.spec.ts`. Never skip or disable a test. Known flaky tests: `docs/pipeline/HANDOFF.md`.
- **Commands** (repo root): `pnpm precheck` (before every push), `pnpm test:scoped`, `pnpm test` (everything), `pnpm typecheck`, `pnpm knip` (fails on unused files, exports and dependencies; CI runs it), `pnpm lint:theme`. `pnpm test:pg` needs a local Postgres (`scripts/db.sh`) and is optional. E2E: install Chromium once with `cd apps/web && npx playwright install chromium` (the normal Playwright cache).
- **Scoped CI:** the "Changed files" job runs `scripts/scope.mjs` on the PR's diff and CI runs only what it names: unit tests of the changed packages and what depends on them, the e2e tags of the entry points the diff reaches through the import graph (`apps/web/e2e/features.json`), and a 50-game sim smoke for engine, content or bots changes. Anything it cannot place (config, `.github/`, `scripts/`, `features.json`, a module that reaches no entry or 3+ tags) runs the full tier. A docs-only PR runs the typecheck, knip and the unit tests, and e2e and sim smoke report skipped, which the gate accepts. The always-on **CI ok** job passes when every other job passed or was skipped on purpose; branch protection requires it. Review APPROVE and QA PASS are still required.
- **Full tier on `main`:** every push to `main` and a nightly run execute all unit tests, all e2e on 6 shards and the 200-game sim smoke. If one fails, the PM stops merging until a fix-forward PR is green; that PR adds the test (and the `features.json` mapping) that would have caught it in the scoped tier.
- **Issues and status docs:** your prompt gives an issue number; put "Closes #N" in the PR body. Builders and QA don't edit `docs/STATUS.md` or `docs/decisions.md`. Provisional rule decisions go under `## Decisions` in the PR body (the PM folds them into `docs/decisions.md` after merge); new follow-ups go under `## Follow-ups` (the PM creates the issues). The PM moves board cards and closes issues; the cloud can't reach Projects.
- **Merge gate** (`docs/pipeline/verdicts.sh N`, `merge.sh N`; REST only, runs in every setup): only the PM merges. A PR merges when the latest review is `VERDICT: APPROVE` naming `Head: <sha>`, the latest QA comment is `QA: PASS` naming the current head, commits after the reviewed sha only touch QA tests (`*.qa.test.ts` / `*.qa.spec.ts`, old and new paths), CI is green on the head (every check-run, and `CI ok` must be present and a success), the merge state is clean, and every commit is cleanly authored. Only reviews/comments by the pipeline account (`GATE_AUTHORS`, default `karthik24iyer`; the repo is public) count, and not PENDING reviews; the "Claude review" Action's posting login (`GATE_REVIEW_BOTS`, default `github-actions[bot]`) also counts, for reviewer `VERDICT:` reviews only, never `QA:`, and only on PRs that change nothing under `.github/`, `docs/pipeline/` or Claude config. The newest verdict-like review or comment of each kind is used (any case, either channel: first line starting `verdict`/`qa`, a review mentioning "verdict", a comment with "qa:"); if it isn't in the exact format the gate says no, so don't write those in other reviews/comments. Any API error is also a no.
- **Reviews run automatically:** the "Claude review" Action (`.github/workflows/claude-review.yml`, owner's Pro subscription) reviews every non-draft PR by karthik24iyer on each non-QA push, so builders don't spawn a reviewer. It cannot run code, so CI and QA still run the tests. The PM may post a `Review focus:` PR comment (only those by karthik24iyer are trusted instructions) and falls back to an Opus reviewer subagent if the Action is skipped, fails or hits the usage limit; PRs touching `.github/`, `docs/pipeline/` or Claude config (`.claude/`, `.mcp.json`, `CLAUDE.md`, ...) always need the subagent reviewer (the gate ignores the Action's verdict there). Don't write `VERDICT`-style text in other PR reviews or comments.
- **Report SHORT:** at most 80 words (PR number, verdict/result, head sha, provisional decisions, blockers). Details go on the PR.
