# Orchestrator handoff

Read this with `docs/STATUS.md` (the canonical task list and the owner's open questions). This file covers how the work is run, the current state and how to resume.

**Standing rule: keep status and orchestration docs clean.** Update in place, delete stale or contradictory content, no history narratives (history lives in git, the PRs and `docs/decisions.md`).

## Current state (3 Nov 2026)
- **Development is halted** (owner): every code PR is merged (M2-1 to M2-13 and R6, through #55); start nothing new until the owner says so.
- **In flight:** nothing.
- **Paused by the owner:** M2-14 playtest pass, M2-15 offline demo (GitHub Pages).
- **Out of scope:** `docs/rebuild.md` (jobs redesign), Books mode, the recruited Mole.
- **Specs:** `docs/design.md` plus `docs/extension.md` (the single R6 spec). Roles v3 is retired; `docs/roles-v2.md` is the historical R1–R5 record.
- **Live:** https://skimjob.duckdns.org on the owner's AWS Lightsail box, running 1a4e083 with Google sign-in on (release `20261103-172121-1a4e083`; the 38002fd release is kept, but is not a safe rollback target: see `docs/deploy.md` step 8). Runbook: `docs/deploy.md`. Connection details are in the owner's local `ssh-relay` skill, never in the repo. Fly is unused.

## How to resume
1. Ask the owner to confirm the provisional decisions in STATUS "Questions for the owner".
2. M2-14 playtest pass, then M2-15 offline demo: the in-browser engine and bots with the same UI, published as a GitHub Pages site the owner can verify.

## How the pipeline works
- The pipeline runs on the owner's Mac. Main clone: `/Users/karthikeyaniyer/Documents/Misc/Skimjob`; every agent works in its own git worktree under `/Users/karthikeyaniyer/Documents/Misc/skimjob-wt/<name>` (`git worktree add`, removed with `git worktree remove` when done). Setup and rules: `common.md`.
- The orchestrator (PM) never writes code itself. It spawns subagents, one per task, up to about 3–5 at once. Each pipeline brief lives in this folder:
  - `builder.md` writes code and opens a PR (`gh pr create`).
  - `reviewer.md` posts `gh pr review N --comment`; first line `VERDICT: APPROVE` or `VERDICT: CHANGES REQUESTED`, second line `Head: <40-char sha reviewed>`.
  - `qa.md` adds `*.qa.test.ts` (and e2e `*.qa.spec.ts`) tests, pushes once, and comments; first line `QA: PASS` or `QA: FAIL`, second line `Head: <40-char head after its push>`.
- Every agent reads `common.md` first. Agent reports are at most 80 words; the details go on the PR.
- **Merge gate (SHA-bound):** `docs/pipeline/verdicts.sh <PR>` prints the head, both verdicts and the sha each names, commits since the review, CI on the head and authorship, then `MERGEABLE: yes|no (<reasons>)`. Mergeable iff:
  - only reviews/comments by `GATE_AUTHORS` (default `karthik24iyer`; the repo is public) count, PENDING reviews never;
  - the newest verdict-like review/comment is exactly `VERDICT: APPROVE` + `Head: S_r`, and the newest QA-like one is exactly `QA: PASS` + `Head: <current head>` (malformed newest = no; never falls back to an older verdict);
  - every commit in S_r..head only touches QA test files (`*.qa.test.ts`, `*.qa.spec.ts`; old and new paths of renames); otherwise get a delta re-review;
  - any gh/API error on any page fails closed (`MERGEABLE: no`);
  - every check-run on the head completed as success/skipped/neutral, and every commit status is success (docs-only PRs too);
  - the PR is open, not a draft, merge state CLEAN;
  - every commit is authored by `karthik24iyer <karthik24iyer@gmail.com>` and no message has a co-authored-by / claude-session / generated-by line.
- Merge with `docs/pipeline/merge.sh <PR>`: it runs the gate, then `gh pr merge --squash --match-head-commit <head> --delete-branch`, and prints `merged #N -> main <sha> | next: <first unticked STATUS task>`.
- **Merge order and rebases:** merge one PR at a time; after each merge, the remaining open PRs rebase onto the new main (and a non-QA-test change in the rebase needs a delta re-review).
- Builders do NOT edit `docs/decisions.md` or `STATUS.md`. They put `## Decisions` and `## STATUS updates` sections in the PR body, and the PM folds those in (once, concisely) after merging.
- Send the owner a short progress update about every 15 minutes while work is running.

## Agent quirks and testing
- **Never `gh pr checks --watch`:** it gets backgrounded and stalls agents. Poll `gh pr checks N` in short calls instead. Run long commands in the foreground.
- **Testing policy:** while iterating, run only the tests relevant to the PR (affected unit tests and e2e specs); rely on CI for the full suite. Never skip or disable a test.
- **Known flaky tests** (rerun once; if it fails again, treat it as real). E2E files are in `apps/web/e2e/`; `[project]` is the Playwright project:
  - `game.qa.spec.ts` "12 seats, 24-char names: a Quick game to the end with moves changed, alibis, no leaks, no overflow" [mobile-fast], also flaky in CI;
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
- Node 22 only: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH` before node/pnpm (the system node is newer). `.nvmrc` pins 22 for fnm/nvm.
- Never write to `/tmp`; use a scratch folder under `/Users/karthikeyaniyer/Documents/Misc`.
- macOS is case-insensitive: never add two paths, or two modules (`Crook.tsx` + `crook.ts`), that differ only in case. CI checks it.
- Playwright: `cd apps/web && npx playwright install chromium` once. Concurrent agents must use their own `E2E_*` ports; a killed run can leave vite/server processes holding them (`lsof -iTCP:<port> -sTCP:LISTEN`, kill by PID).
- `pnpm test:pg` needs Homebrew postgres; optional, CI covers PGlite.
- `gh pr`, GraphQL, rebase, `reset --hard` and force-push to an agent's own feature branch all work. Never force-push `main`.
- Several agents share the machine: local runs are slower under load.
- Never add Co-Authored-By or Claude-Session lines; the gate refuses them.

## Owner direction and constraints
- Goal: finish development and testing and hand over an artifact to verify (the M2-15 offline demo), with the live Lightsail site for playtests.
- Ask the owner only for real decisions, as MCQs with a recommended option; batch technical defaults (about 4 at a time). Otherwise keep going.
- UI: the cityrt-style cartoon notebook on every screen (`docs/ui-style.md`, CLAUDE.md UI rules). Style only: never their logo, name or art.
- **The repo is public.** Never commit secrets, SSH key names, connection details (host, IP, user) or any off-box backup destination or its credentials. On-box paths, service and file names, and the backup script and schedule may be named (`docs/deploy.md` does).
- Player rulebook: claude.ai doc "Skimjob — How to play" (https://claude.ai/artifact/3dEyv4wdmiJ3a9DhrtsBtN). Exact roles dealt is the default.
