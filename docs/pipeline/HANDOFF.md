# Orchestrator handoff (snapshot 2026-11-02 04:30 IST)

Read this together with `docs/STATUS.md`, which holds the canonical task list. This file covers how the work is run and what was in flight at the snapshot.

## How the pipeline works
- The orchestrator (PM) never writes code itself. It spawns Opus subagents, one per task. Each pipeline brief lives in this folder:
  - `builder.md` writes code and opens a PR.
  - `reviewer.md` posts a review whose last line is `VERDICT: APPROVE` or `VERDICT: CHANGES REQUESTED`.
  - `qa.md` adds `*.qa.test.ts` tests and posts a `QA: PASS` or `QA: FAIL` comment.
- Every agent reads `common.md` first. Agent reports are at most 80 words; the details go on the PR.
- Merge rule: merge only when the **latest head** has a reviewer APPROVE **and** QA PASS. After any code-touching fix, get a delta re-review first. Use:
  `FAST=1 CLONE=<clone> docs/pipeline/merge.sh <PR> <branch> squash`
- Check a PR's status with `docs/pipeline/verdicts.sh <PR>`.
- Give each concurrent agent its own clone (`/home/claude/skimjob-<name>`), a shallow clone with git identity `karthik24iyer <karthik24iyer@gmail.com>`. Fetch with explicit refspecs.
- Environment gotchas:
  - `gh pr` and GraphQL are blocked, so use `gh api` REST.
  - Actions logs and secrets endpoints are blocked.
  - `git reset --hard`, rebase and force-push are denied, so use `checkout -B` and `git merge origin/main`.
  - Local tests are slow under load, so trust the CI check-runs.
- Builders do NOT edit `docs/decisions.md` or `STATUS.md`. They put `## Decisions` and `## STATUS updates` sections in the PR body, and the PM folds those into the docs later. This avoids constant conflicts.
- Never add Co-Authored-By or Claude-Session lines; `merge.sh` aborts if it finds them.
- Send the owner a short progress update about every 15 minutes.

## In flight at snapshot
Nothing. No agents are running, and every PR through #39 is merged (#35, #36, #37, #38 chat UI, #39 e2e target check; the separate flake PR was dropped because #36 fixed the root cause). Docs PR #40 folds the PR notes into `docs/decisions.md` and `docs/STATUS.md`.

## Remaining plan
1. R5 parity balance with `pnpm sim:suite`:
   - no two roles' normalized win rates more than 10% apart (today: spread 0.96 / 1.86 / 2.46 at 4/6/8p)
   - success 55–70% (8p is 51%)
   - saboteur win 30–40%
   - Inside Man at 2–3 players
   - revisit the 5-player Accomplice cut
2. Wire the M2-9 art into the game screen.
3. M2-10: ledger, case file, "While you were away", suspicion board.
4. M2-11: end-of-game reveal.
5. M2-13: host controls (pause, extend, replace with bot).
6. M2-12: Google sign-in, stub-ready (needs a client id from the owner).
7. M2-14: playtest pass.
8. **M2-15: offline demo build.** Run the in-browser engine and bots with the same UI, and publish it as a claude.ai artifact the owner can verify. This is the deliverable the owner asked for.

Follow-ups from reviews (see STATUS "Open follow-ups"):
- Bots: a hidden `crewSeed` from the harness for the shared hunch (#37 review).
- Bot scheduling: bots only back proposals, never propose first; fix before M2-14 (#35 review).
- SHA-pin the GitHub Actions in `ci.yml`, `deploy.yml` and `sim-suite.yml` (now `@v4` tags).

## Owner direction and constraints
- 1 Nov: "finish the entire development, testing, integration testing, everything, and just give it to me as an artifact to verify." Deployment is decided later (AWS Lightsail or Fly).
  - Fly: the account is flagged high-risk. The owner must unlock it at fly.io/high-risk-unlock, then re-run `deploy.yml`. `FLY_API_TOKEN` is already a repo secret.
  - Lightsail would need the secrets `LIGHTSAIL_SSH_KEY`, `LIGHTSAIL_HOST` and `LIGHTSAIL_USER`, a subdomain A record, and answers on Docker, the proxy and RAM.
- Ask the owner only for real decisions, as MCQs with a recommended option. Otherwise keep going.
- UI: the cityrt-style cartoon notebook on every screen (`docs/ui-style.md`, CLAUDE.md UI rules). Style only: never their logo, name or art.
- Earlier preview artifact (landing page + gallery): https://claude.ai/artifact/Bss1QfARNq9WM8qwdC4CAY

## PM notes (follow-ups found by reviews)
See `pm-notes.md` in this folder.
