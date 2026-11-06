# Orchestrator handoff

Read this with `docs/STATUS.md` (where things stand; it links the GitHub issues and the R7 board, which hold the tasks, follow-ups and the owner's open questions). This file covers how the work is run, the current state and how to resume.

**Standing rule: keep status and orchestration docs clean.** Update in place, delete stale or contradictory content, no history narratives (history lives in git, the PRs and `docs/archive/decisions-history.md`).

## Current state (4 Nov 2026)
- **In flight:** R7 step S1 (spec freeze, PR #76); nothing else.
- **Parked by the owner:** M2-14 playtest pass and M2-15 offline demo.
- **Out of scope for now:** Skimjob Advanced (`docs/advanced.md`, a later paid version built on R7), the recruited Mole.
- **Specs:** `docs/design.md` is the single rules spec; `docs/simplified.md` is the R7 plan. Current decisions: `docs/decisions.md`.
- **Live:** https://skimjob.duckdns.org on the owner's AWS Lightsail box, running 1a4e083 with Google sign-in on. Runbook: `docs/deploy.md`. Connection details are in the owner's local `ssh-relay` skill, never in the repo.

## How to resume
Run milestone **R7 Simplified** exactly as `docs/simplified.md` "How to run it" says (roles and models, kickoff prompt, steps S0–S5 with owner checkpoints). Tasks are GitHub issues in the milestone "R7 Simplified" (one per task, labelled `type:task`, `step:*`, `feature:*`); the owner's open questions are issues labelled `owner-decision`.

## How the pipeline works
- **Where it runs:** three setups, all covered in `common.md` "Where you run": (a) the owner's Mac directly (main clone `~/Documents/Misc/Skimjob`, one worktree per agent under `…/Misc/skimjob-wt/<name>`); (b) a cloud session whose agents run commands on the Mac through the local terminal tool (≈60 s per call: background long runs with nohup and poll logs; never `/tmp`); (c) a cloud session working entirely in its Linux container (clone under `/home/claude`, Node 22 preinstalled, GraphQL blocked so REST only, slow 2-core box: run only affected specs and rely on CI). Tell each agent which setup it is in.
- The orchestrator (PM) never writes code itself. It spawns subagents, one per task, up to about 3–5 at once. Each pipeline brief lives in this folder:
  - `builder.md` writes code and opens a PR (REST `gh api …/pulls`).
  - `reviewer.md` posts a review (`gh api …/pulls/N/reviews -f event=COMMENT`); first line `VERDICT: APPROVE` or `VERDICT: CHANGES REQUESTED`, second line `Head: <40-char sha reviewed>`.
  - `qa.md` adds `*.qa.test.ts` (and e2e `*.qa.spec.ts`) tests, pushes once, and comments; first line `QA: PASS` or `QA: FAIL`, second line `Head: <40-char head after its push>`.
- Every agent reads `common.md` first. Agent reports are at most 80 words; the details go on the PR.
- **Merge gate (SHA-bound):** `docs/pipeline/verdicts.sh <PR>` prints the head, both verdicts and the sha each names, commits since the review, CI on the head and authorship, then `MERGEABLE: yes|no (<reasons>)`. Mergeable iff:
  - only reviews/comments by `GATE_AUTHORS` (default `karthik24iyer`; the repo is public) count, PENDING reviews never;
  - the newest verdict-like review/comment is exactly `VERDICT: APPROVE` + `Head: S_r`, and the newest QA-like one is exactly `QA: PASS` + `Head: <current head>` (malformed newest = no; never falls back to an older verdict);
  - every commit in S_r..head only touches QA test files (`*.qa.test.ts`, `*.qa.spec.ts`; old and new paths of renames); otherwise get a delta re-review;
  - any gh/API error on any page fails closed (`MERGEABLE: no`);
  - every check-run on the head completed as success/skipped/neutral, and every commit status is success (docs-only PRs too);
  - the PR is open, not a draft, REST `mergeable_state` `clean` (asked again once while GitHub is still computing it);
  - every commit is authored by `karthik24iyer <karthik24iyer@gmail.com>` and no message has a co-authored-by / claude-session / generated-by line.
- Merge with `docs/pipeline/merge.sh <PR>`: it runs the gate, then `PUT …/pulls/N/merge` (squash, `sha=<gated head>`) and `DELETE …/git/refs/heads/<branch>`, and prints `merged #N -> main <sha> | next: #<lowest open R7 task issue>` (or `next: see the board` if the API call fails). Both scripts use only the REST API (`gh api`), so they work in all three setups; `bash docs/pipeline/gate.qa.test.sh` tests them offline.
- **Merge order and rebases:** merge one PR at a time; after each merge, the remaining open PRs rebase onto the new main (and a non-QA-test change in the rebase needs a delta re-review).
- **Issues and the board:** every task is a GitHub issue; the PM gives each builder an issue number. Builders put "Closes #N" in the PR body, so merging closes the issue. The PM moves the board card (Todo / In progress / In review / Owner review / Done, field PR) and closes issues on merge, from the Mac: the cloud can't reach Projects (GraphQL is blocked), but it can read and write issues, labels and milestones over REST.
- Builders do NOT edit `docs/decisions.md` or `STATUS.md`, and write no "STATUS updates". They put provisional rule calls under `## Decisions` in the PR body (the PM folds them into `docs/decisions.md` once, concisely, after merging) and new follow-ups under `## Follow-ups` (the PM creates the issues: `type:follow-up`, plus `flaky` / `feature:*` where they fit).
- Send the owner a short progress update about every 15 minutes while work is running.

## Agent quirks and testing
- **Never `gh pr checks --watch`:** it gets backgrounded and stalls agents. Poll the check-runs in short calls instead (common.md). On the Mac directly, run long commands in the foreground; through the terminal tool, background them with nohup and poll.
- **Testing policy:** run only the specs and unit tests the PR touches, `pnpm typecheck` before pushing (QA too), push once, and let CI's unit suite and 6 e2e shards run the rest. Never skip or disable a test.
- **Known flaky tests** (rerun once; if it fails again, treat it as real). E2E files are in `apps/web/e2e/`; `[project]` is the Playwright project:
  - `responsive.qa.spec.ts` "landing behaviour › reduced motion › turns off the sheet entrance and toast animations" [mobile];
  - `responsive.qa.spec.ts` "<width>x<height> touch › touch targets are at least 44px on /" [mobile];
  - `responsive.qa.spec.ts` "landing behaviour › invite field: links, spaces and dashes are tidied; junk is refused without a request" (project not recorded);
  - `notes.spec.ts` "the recap shows what changed while you were away, once, and the board stays private" [desktop];
  - `packages/bots/src/hunch.test.ts` timed out once under load (vitest).
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
