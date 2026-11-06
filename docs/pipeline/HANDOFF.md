# Orchestrator handoff

Read this with `docs/STATUS.md` (where things stand; it links the GitHub issues and the R7 board, which hold the tasks, follow-ups and the owner's open questions). This file covers how the work is run, the current state and how to resume.

**Standing rule: keep status and orchestration docs clean.** Update in place, delete stale or contradictory content, no history narratives (history lives in git, the PRs and `docs/archive/decisions-history.md`).

## Current state (6 Nov 2026)
- **Merged:** R7 S0, S1 (`docs/design.md` is the single spec, owner-approved 6 Nov), C1, C2a-C2e. **In flight:** nothing. **Next:** C3 guardrails (#87) and S2 mockups (#81); they can run in parallel. The board is the task list.
- **Review:** the Claude review Action (Pro subscription, Opus) reviews every PR automatically and its verdict counts, except on PRs touching `.github/`, `docs/pipeline/` or Claude config, where the PM's Opus reviewer is required. The PM posts a `Review focus:` comment on each PR.
- **Owner questions** are open issues labelled `owner-decision` (none open as of 6 Nov).
- **Mac:** prefix `gh` with `GH_TOKEN=$(gh auth token --user karthik24iyer)`, because a work account may be active. Merges work from the cloud too (the gate pages manually).
- **Parked by the owner:** M2-14 playtest pass and M2-15 offline demo. **Out of scope for now:** Skimjob Advanced (`docs/advanced.md`), the recruited Mole.
- **Specs:** `docs/design.md` (rules), `docs/simplified.md` (R7 plan), `docs/decisions.md` (current decisions).
- **Live:** https://skimjob.duckdns.org on the owner's AWS Lightsail box, Google sign-in on. Runbook: `docs/deploy.md`. Connection details are in the owner's local `ssh-relay` skill, never in the repo.

## How to resume
Run milestone **R7 Simplified** exactly as `docs/simplified.md` "How to run it" says (roles and models, kickoff prompt, steps S0–S5 with owner checkpoints). Tasks are GitHub issues in the milestone "R7 Simplified" (one per task, labelled `type:task`, `step:*`, `feature:*`); the owner's open questions are issues labelled `owner-decision`.

## How the pipeline works
- **Where it runs:** three setups, all covered in `common.md` "Where you run": (a) the owner's Mac directly (main clone `~/Documents/Misc/Skimjob`, one worktree per agent under `…/Misc/skimjob-wt/<name>`); (b) a cloud session whose agents run commands on the Mac through the local terminal tool (≈60 s per call: background long runs with nohup and poll logs; never `/tmp`); (c) a cloud session working entirely in its Linux container (clone under `/home/claude`, Node 22 preinstalled, GraphQL blocked so REST only, slow 2-core box: run only affected specs and rely on CI). Tell each agent which setup it is in.
- The orchestrator (PM) never writes code itself. It spawns subagents, one per task, up to about 3–5 at once. Each pipeline brief lives in this folder:
  - `builder.md` writes code and opens a PR (REST `gh api …/pulls`).
  - `reviewer.md` posts a review (`gh api …/pulls/N/reviews -f event=COMMENT`); first line `VERDICT: APPROVE` or `VERDICT: CHANGES REQUESTED`, second line `Head: <40-char sha reviewed>`. It now runs automatically as the **"Claude review" GitHub Action** (`.github/workflows/claude-review.yml`) on the owner's Claude Pro subscription; see "Automatic review (Claude review Action)" below.
  - `qa.md` adds `*.qa.test.ts` (and e2e `*.qa.spec.ts`) tests, pushes once, and comments; first line `QA: PASS` or `QA: FAIL`, second line `Head: <40-char head after its push>`.
- Every agent reads `common.md` first. Agent reports are at most 80 words; the details go on the PR.
- **Merge gate (SHA-bound):** `docs/pipeline/verdicts.sh <PR>` prints the head, both verdicts and the sha each names, commits since the review, CI on the head and authorship, then `MERGEABLE: yes|no (<reasons>)`. Mergeable iff:
  - only reviews/comments by `GATE_AUTHORS` (default `karthik24iyer`; the repo is public) count, PENDING reviews never; the review bots in `GATE_REVIEW_BOTS` (default `github-actions[bot]`, the Action's post job) also count, for reviewer `VERDICT:` reviews only, never `QA:`, and only on PRs that change nothing under `.github/` or `docs/pipeline/` (file list unreadable: no); DISMISSED reviews never count; the newest verdict of either kind wins;
  - the newest verdict-like review/comment is exactly `VERDICT: APPROVE` + `Head: S_r`, and the newest QA-like one is exactly `QA: PASS` + `Head: <current head>` (malformed newest = no; never falls back to an older verdict);
  - every commit in S_r..head only touches QA test files (`*.qa.test.ts`, `*.qa.spec.ts`; old and new paths of renames); otherwise get a delta re-review;
  - any gh/API error on any page fails closed (`MERGEABLE: no`);
  - every check-run on the head completed as success/skipped/neutral (the always-on `CI ok` job among them), and every commit status is success (docs-only PRs too);
  - the PR is open, not a draft, REST `mergeable_state` `clean` (asked again once while GitHub is still computing it);
  - every commit is authored by `karthik24iyer <karthik24iyer@gmail.com>` and no message has a co-authored-by / claude-session / generated-by line.
- Merge with `docs/pipeline/merge.sh <PR>`: it runs the gate, then `PUT …/pulls/N/merge` (squash, `sha=<gated head>`) and `DELETE …/git/refs/heads/<branch>`, and prints `merged #N -> main <sha> | next: #<lowest open R7 task issue>` (or `next: see the board` if the API call fails). Both scripts use only the REST API (`gh api`), so they work in all three setups; `bash docs/pipeline/gate.qa.test.sh` tests them offline.
- **Automatic review (Claude review Action):**
  - `.github/workflows/claude-review.yml` reviews each same-repo, non-draft PR authored by karthik24iyer on `opened` / `synchronize` / `reopened` / `ready_for_review`, in the `reviewer.md` format, on the owner's Pro subscription (repo secret `CLAUDE_CODE_OAUTH_TOKEN`; the Claude GitHub App is not needed). Delta re-reviews therefore happen automatically on every non-QA push (it reads the earlier reviews and says which earlier blocking items are fixed). A push whose commits since the last review only touch `*.qa.test.ts` / `*.qa.spec.ts` is skipped (the gate accepts those).
  - **Two jobs so an injected run can write nothing but one review:** job `review` (AI) has a read-only `GITHUB_TOKEN` (passed as the action's `github_token`, so no Claude-app write token exists), works in a checkout of trusted `main` (the PR's tree is never on disk, so a PR cannot plant `.claude/` hooks, `.mcp.json` or symlinks), reads the PR's diff and the contents of its changed files as plain files under `pr/` written by a non-AI step, has only Read/Grep/Glob (no Bash, `gh`, Write), never runs PR code (CI and QA run tests); its final message is the review, which a non-AI step saves as `review.md`. Job `post` (no AI, no PR code, `pull-requests: write` only) validates it (<= 60 KB, line 1 an exact verdict, line 2 `Head: <the head it reviewed>` and still the PR head, no line starting `QA:`, no secret-looking text) and posts ONE `COMMENT` review as `github-actions[bot]`.
  - **Gate:** `github-actions[bot]` (`GATE_REVIEW_BOTS`) counts for `VERDICT:` only, never `QA:`, and only when the PR changes nothing under `.github/` or `docs/pipeline/` (otherwise a PR could add a workflow that posts a fake verdict as that login). **PRs touching `.github/`, `docs/pipeline/` or Claude config (`.claude/`, `.claude.json`, `.mcp.json`, `CLAUDE.md`, `CLAUDE.local.md`) always need the Opus reviewer subagent** (posted as karthik24iyer). The `github-actions[bot]` login can be produced by anyone who can push a branch with a workflow (those credentials can already post a trusted verdict directly), but not by outsiders: fork PRs get a read-only token and no workflow uses `pull_request_target`, `issue_comment` or `workflow_run`. `ci.yml` has `permissions: contents: read`; keep every workflow that runs PR code read-only, and keep the repo's default workflow permissions read-only (Settings > Actions > General).
  - **Re-run:** Actions > "Claude review" > Run workflow with the `pr` number (`gh api repos/EssenKay-Studios/Skimjob/actions/workflows/claude-review.yml/dispatches -f ref=main -f 'inputs[pr]=N'`); it reviews the PR's current head even if already reviewed.
  - **Review focus:** the PM posts a PR comment starting `Review focus:` (as karthik24iyer) listing what to check closely. Only such comments by karthik24iyer reach the Action as instructions; other PR text is untrusted data and other people's comments are not shown to it.
  - **Fallback and shadow:** if the Action is skipped, fails or hits Pro's usage limit (the job still ends green, with a warning), the PM runs an Opus reviewer subagent instead. The PM also runs an Opus reviewer subagent in addition for engine / bots / case-board-data PRs. For the first 2-3 PRs the Action runs in shadow alongside the subagent reviewer (the newest verdict is the one the gate uses).
- **Merge order and rebases:** merge one PR at a time; after each merge, the remaining open PRs rebase onto the new main (and a non-QA-test change in the rebase needs a delta re-review).
- **Issues and the board:** every task is a GitHub issue; the PM gives each builder an issue number. Builders put "Closes #N" in the PR body, so merging closes the issue. The PM moves the board card (Todo / In progress / In review / Owner review / Done, field PR) and closes issues on merge, from the Mac: the cloud can't reach Projects (GraphQL is blocked), but it can read and write issues, labels and milestones over REST.
- Builders do NOT edit `docs/decisions.md` or `STATUS.md`, and write no "STATUS updates". They put provisional rule calls under `## Decisions` in the PR body (the PM folds them into `docs/decisions.md` once, concisely, after merging) and new follow-ups under `## Follow-ups` (the PM creates the issues: `type:follow-up`, plus `flaky` / `feature:*` where they fit).
- Send the owner a short progress update about every 15 minutes while work is running.

## Agent quirks and testing
- **Never `gh pr checks --watch`:** it gets backgrounded and stalls agents. Poll the check-runs in short calls instead (common.md). On the Mac directly, run long commands in the foreground; through the terminal tool, background them with nohup and poll.
- **Testing policy:** `pnpm typecheck` and `pnpm test:scoped` before pushing (QA too), push once, and let CI run the scoped set; the full tier runs on `main` after each merge and nightly. Never skip or disable a test.
- **Known flaky tests** (rerun once; if it fails again, treat it as real). E2E files are in `apps/web/e2e/`; `[project]` is the Playwright project:
  - `responsive.qa.spec.ts` "landing behaviour › reduced motion › turns off the sheet entrance and toast animations" [mobile]; not reproduced in 80 runs under load on 7 Nov;
  - `notes.spec.ts` "the recap shows what changed while you were away, once, and the board stays private" [desktop]; not reproduced in 40 runs under load on 7 Nov.
- **QA pushes once,** at the end (each push restarts CI); its comment names the head after that push.
- **Verdicts name a sha.** After any non-QA-test commit, get a delta re-review naming the new head.
- **The PM can't self-QA a docs PR:** spawn a QA agent to check it before merging.
- **One worktree per agent,** never the main clone's working tree; don't `git stash` or switch branches in a worktree while its e2e run is serving from it.

## Environment gotchas
- Setup per environment (paths, Node 22, ports, the terminal tool's limits, the cloud container): `common.md` "Where you run".
- Concurrent agents on the Mac must use their own `E2E_*` ports; a killed run can leave vite/server processes holding them (`lsof -iTCP:<port> -sTCP:LISTEN`, kill by PID). Several agents share the machine, so local runs are slower under load.
- `pnpm test:pg` needs a local Postgres (`scripts/db.sh`); optional, CI covers PGlite.
- Rebase, `reset --hard` and force-push to an agent's own feature branch are fine. Never force-push `main`.
- Never add Co-Authored-By or Claude-Session lines; the gate refuses them.

## Owner direction and constraints
- Goal: a solid game on the live Lightsail site, which the owner playtests himself.
- Ask the owner only for real decisions, as MCQs with a recommended option; batch technical defaults (about 4 at a time). Otherwise keep going.
- UI: the cityrt-style cartoon notebook on every screen (`docs/ui-style.md`, CLAUDE.md UI rules). Style only: never their logo, name or art.
- **The repo is public.** Never commit secrets, SSH key names, connection details (host, IP, user) or any off-box backup destination or its credentials. On-box paths, service and file names, and the backup script and schedule may be named (`docs/deploy.md` does).
- Player rulebook: claude.ai doc "Skimjob — How to play" (https://claude.ai/artifact/3dEyv4wdmiJ3a9DhrtsBtN). Exact roles dealt is the default.
