# Orchestrator handoff (snapshot 2026-11-02 00:30 IST)

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
The agents belonged to the old session. If that session is gone they are dead: resume from what is on GitHub. Anything they never pushed is lost.

| PR | Branch | State | Next |
|---|---|---|---|
| #35 M2-7 meetings UI | `m2/meetings-ui` | QA PASS. Review CHANGES REQUESTED: e2e exceeded 20 min in CI, being sharded into 4 jobs | Builder finishes sharding → delta review → merge |
| #36 R3b Blackmailer/Forger/Embezzler | `roles/r3b-dark` | QA PASS. Review CHANGES REQUESTED: Embezzler skim can make the public "Haul grew by" negative (a tell) | Builder fix → re-review + QA re-check → merge. Record owner decision: Blackmail victim's vote counts 0, Blackmailer gets +1 |
| #37 R4b bot claims | `bots/claims` | Review and QA both flagged `crewHunch` (bot.ts ~397), seeded only by meeting id + seat id, so every game has the same seat bias | Builder adds per-game entropy plus a regression test → re-review/QA → merge |
| (new) hostile-test flake | `fix/hostile-flake` | `live.hostile.qa.test.ts` Lookout+lobby case is flaky in CI and predates #37 | Builder finds the root cause and loops the test 30× → review → merge |
| (new) M2-8b chat UI | `m2/chat-ui` | Being built: crew tab + DMs, plain-text rendering, bottom sheet on phones, 2-context e2e | Review + QA → merge |

If a branch exists but has no PR, or a PR has no fix commit after its review, spawn a fresh builder in FIX mode for it.

## Remaining plan after those
1. R5 parity balance with `pnpm sim:suite`:
   - no two roles' normalized win rates more than 10% apart
   - success 55–70%
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
9. Fold the Decisions and STATUS sections from merged PR bodies into `docs/decisions.md` and `docs/STATUS.md`.

## Owner direction and constraints
- 1 Nov: "finish the entire development, testing, integration testing, everything, and just give it to me as an artifact to verify." Deployment is decided later (AWS Lightsail or Fly).
  - Fly: the account is flagged high-risk. The owner must unlock it at fly.io/high-risk-unlock, then re-run `deploy.yml`. `FLY_API_TOKEN` is already a repo secret.
  - Lightsail would need the secrets `LIGHTSAIL_SSH_KEY`, `LIGHTSAIL_HOST` and `LIGHTSAIL_USER`, a subdomain A record, and answers on Docker, the proxy and RAM.
- Ask the owner only for real decisions, as MCQs with a recommended option. Otherwise keep going.
- UI: the cityrt-style cartoon notebook on every screen (`docs/ui-style.md`, CLAUDE.md UI rules). Style only: never their logo, name or art.
- Earlier preview artifact (landing page + gallery): https://claude.ai/artifact/Bss1QfARNq9WM8qwdC4CAY

## PM notes (follow-ups found by reviews)
See `pm-notes.md` in this folder.
