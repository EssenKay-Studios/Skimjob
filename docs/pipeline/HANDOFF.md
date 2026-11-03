# Orchestrator handoff (snapshot 2026-11-03 morning, resumed on the owner's Mac)

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
  - Local tests are slow under load; CI check-runs are the merge gate, but run the full e2e locally before pushing (see process lessons).
- Builders do NOT edit `docs/decisions.md` or `STATUS.md`. They put `## Decisions` and `## STATUS updates` sections in the PR body, and the PM folds those into the docs later. This avoids constant conflicts.
- Never add Co-Authored-By or Claude-Session lines; `merge.sh` aborts if it finds them.
- Send the owner a short progress update about every 15 minutes.

## State at snapshot
- **RESUMED 3 Nov:** the pipeline runs again, now on the owner's Mac (setup in the ops PR `ops/mac-pipeline`).
- **Roles v3 approved as amended by the Extension** (owner, 3 Nov morning; decisions.md "Owner answers, 3 Nov (morning)"). The docs PR `docs/extension-approved` folds it into `docs/roles-v3.md`, `docs/design.md` v0.2 and `docs/extension.md`, and closes draft #45. Nothing of it is built yet. Out of scope: `docs/rebuild.md`, Books mode, the recruited Mole.
- **Merged through #46** on 2 Nov: #41 (bank board + Claim role), #42 (owner answers docs), #43 (R5 parity balance, provisional), #44 (lock-in marks, presence, early round end, human-majority meeting lock), #46 (M2-10 ledger, case file, "While you were away", suspicion board), plus the 2 Nov docs fold.
- **The repo is public** (owner, 2 Nov: Actions minutes had run out). Never commit secrets; they stay in repo secrets.
- **Deploy workflow is manual-only** until a host is chosen (owner, 3 Nov; done in the ops PR).
- Player rulebook: claude.ai doc "Skimjob — How to play" (https://claude.ai/artifact/3dEyv4wdmiJ3a9DhrtsBtN); the role-list default there is now settled as Exact roles dealt.

## Remaining plan
1. **R6a + Extension rules** (engine, content, bots): roles v3, tokens and the 3-perk shop, "once between meetings", fixed shakedown numbers (clean 6, pay 8), one vote rule, whole-number scoring, "police activity" and "camera offline" cover, Heat breakdown, Standard deck, Quick uses Starter, the 3 Nov owner rulings. Spec: `docs/roles-v3.md` + `docs/design.md` v0.2 (the Extension wins on conflict).
2. **One balance pass** for all of it on the sharded "Sim suite" GitHub workflow: per-role parity ≤ 0.10, success 55–70%; the Extension's numbers (clean 6, pay 8, shop costs) are starting values to tune.
3. **R6b + Extension UI:** role cards and Roles rulebook, "between meetings" wording, gap box, Haul target bar, Heat breakdown, shop sheet, lobby deck picker, visual cues for every power, last round shown faded while planning.
4. M2-11: end-of-game reveal (include tokens and purchases).
5. M2-13: host controls (pause, extend, replace with bot).
6. M2-12: Google sign-in, stub-ready (needs a client id from the owner).
7. M2-14: playtest pass.
8. **M2-15: offline demo build.** Run the in-browser engine and bots with the same UI, and publish it as a **GitHub Pages** site the owner can verify (owner, 3 Nov). This is the deliverable the owner asked for.

Follow-ups from reviews: see STATUS "Open follow-ups" (board rate-limiter test, CaseFile memo names, double notes fetch, Quick-game e2e flake, R5 and #44 review notes, SHA-pinning the Actions).

## Process lessons (2 Nov)
- **QA pushes once:** a QA agent pushes its tests in a single push at the end, not commit by commit (each push restarts CI and the review).
- **Agents run the full e2e locally before pushing** (all specs, both projects); CI-only e2e failures cost a fix round each.
- **The PM can't self-QA a docs PR:** spawn a QA agent to check it before merging.
- GitHub squash merges are fine.

## Owner direction and constraints
- 1 Nov: "finish the entire development, testing, integration testing, everything, and just give it to me as an artifact to verify." Deployment is decided later (AWS Lightsail or Fly).
  - Fly: the account is flagged high-risk. The owner must unlock it at fly.io/high-risk-unlock, then re-run `deploy.yml`. `FLY_API_TOKEN` is already a repo secret.
  - Lightsail would need the secrets `LIGHTSAIL_SSH_KEY`, `LIGHTSAIL_HOST` and `LIGHTSAIL_USER`, a subdomain A record, and answers on Docker, the proxy and RAM.
- Ask the owner only for real decisions, as MCQs with a recommended option. Otherwise keep going. Technical defaults go to the owner in batches of 4 (2 Nov).
- UI: the cityrt-style cartoon notebook on every screen (`docs/ui-style.md`, CLAUDE.md UI rules). Style only: never their logo, name or art.
- Earlier preview artifact (landing page + gallery): https://claude.ai/artifact/Bss1QfARNq9WM8qwdC4CAY

## PM notes (follow-ups found by reviews)
See `pm-notes.md` in this folder.
