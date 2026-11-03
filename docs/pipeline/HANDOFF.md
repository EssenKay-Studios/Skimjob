# Orchestrator handoff (snapshot 2026-11-02 evening, paused by the owner)

Read this together with `docs/STATUS.md`, which holds the canonical task list. This file covers how the work is run and what was in flight at the snapshot.

## How the pipeline works
- The pipeline runs on the owner's Mac. Main clone: `/Users/karthikeyaniyer/Documents/Misc/Skimjob`; every agent works in its own git worktree under `/Users/karthikeyaniyer/Documents/Misc/skimjob-wt/<name>` (`git worktree add`, removed with `git worktree remove` when done). Setup and rules: `common.md`.
- The orchestrator (PM) never writes code itself. It spawns Opus subagents, one per task, up to about 3–5 at once. Each pipeline brief lives in this folder:
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
- Builders do NOT edit `docs/decisions.md` or `STATUS.md`. They put `## Decisions` and `## STATUS updates` sections in the PR body, and the PM folds those into the docs later. This avoids constant conflicts.
- Send the owner a short progress update about every 15 minutes.

## Environment gotchas
- Node 22 only: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH` before node/pnpm (the system node is newer). `.nvmrc` pins 22 for fnm/nvm.
- macOS is case-insensitive: never add two paths, or two modules (`Crook.tsx` + `crook.ts`), that differ only in case. CI checks it.
- Playwright: `cd apps/web && npx playwright install chromium` once (normal Mac cache). Concurrent agents must use their own `E2E_*` ports; a killed run can leave vite/server processes holding them (`lsof -iTCP:<port> -sTCP:LISTEN`, kill by PID).
- `pnpm test:pg` needs Homebrew postgres; optional, CI covers PGlite.
- `gh pr`, GraphQL, rebase, `reset --hard` and force-push to an agent's own feature branch all work. Never force-push `main`.
- Several agents share the machine: local runs are slower under load. Run affected e2e specs while iterating and the full e2e once before the final push; CI check-runs are still the merge gate.
- Never add Co-Authored-By or Claude-Session lines; the gate refuses them.

## State at snapshot
- **PAUSED:** the owner asked to pause all work at 16:23 IST on 2 Nov, after M2-10. Nothing is in flight; don't start a task until he resumes.
- **Open PR:** #45 (draft, `docs/roles-v3`): the roles v3 spec (`docs/roles-v3.md`), waiting for owner approval. Nothing of it is built.
- **Merged through #46** on 2 Nov: #41 (bank board + Claim role), #42 (owner answers docs), #43 (R5 parity balance, provisional), #44 (lock-in marks, presence, early round end, human-majority meeting lock), #46 (M2-10 ledger, case file, "While you were away", suspicion board), plus this docs fold.
- **The repo is public** (owner, 2 Nov: Actions minutes had run out). Never commit secrets; they stay in repo secrets.
- Player rulebook: claude.ai doc "Skimjob — How to play" (https://claude.ai/artifact/3dEyv4wdmiJ3a9DhrtsBtN). Open there: Exact vs Possible as the default role list.

## Remaining plan
1. **Roles v3 approval** (PR #45). Direction is in decisions.md "Owner answers, 2 Nov (afternoon)".
2. **R6a rules:** roles v3 plus the 2 Nov answers (role list setting, deck presets + toggles, deal modes Balanced / Truly random, Fence safe revealed, tip-off any time, shakedown window under Exact), the bots for all of it, and one background balance pass run locally with a tuning script (parity ≤ 0.10, success 55–70%).
3. **R6b roles UI:** lobby deck picker, Roles rulebook + tap-to-explain, visual cues for every power, last round shown faded while planning.
4. M2-11: end-of-game reveal.
5. M2-13: host controls (pause, extend, replace with bot).
6. M2-12: Google sign-in, stub-ready (needs a client id from the owner).
7. M2-14: playtest pass.
8. **M2-15: offline demo build.** Run the in-browser engine and bots with the same UI, and publish it as a claude.ai artifact the owner can verify. This is the deliverable the owner asked for.

Follow-ups from reviews: see STATUS "Open follow-ups" (board rate-limiter test, CaseFile memo names, double notes fetch, Quick-game e2e flake, R5 and #44 review notes, SHA-pinning the Actions).

## Process lessons
- **QA pushes once:** a QA agent pushes its tests in a single push at the end, not commit by commit (each push restarts CI). Its comment names the head after that push.
- **Verdicts name a sha.** A verdict without `Head: <sha>` can't gate a merge; after any non-QA-test commit, get a delta re-review naming the new head.
- **Agents run e2e locally before pushing:** affected specs while iterating, the full e2e (all specs, all projects) once before the final push; CI-only e2e failures cost a fix round each.
- **The PM can't self-QA a docs PR:** spawn a QA agent to check it before merging.
- **One worktree per agent**, never the main clone's working tree; don't `git stash` or switch branches in a worktree while its e2e run is serving from it.
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
