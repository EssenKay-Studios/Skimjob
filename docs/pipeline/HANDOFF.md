# Orchestrator (PM) handoff

Read with `docs/STATUS.md` (where things stand), `common.md` (the flow and rules every agent follows) and `agents.md` (the owner's side). Keep these docs clean: update in place, delete what is stale, no history (git and the PRs hold it).

## State

- **Specs:** `docs/design.md` (rules), `docs/simplified.md` (the R7 plan), `docs/decisions.md` (current decisions).
- **Tasks:** GitHub issues in the milestone "R7 Simplified", on the org Projects board #2 ("Skimjob R7"). Bug / Feature / Task is the issue **Type**. **Area**, **Step**, **Model**, **PR** and **Flags** (`owner-decision`, `provisional`, `flaky`, `owner-reported`, `follow-up`) are board fields. The only labels are the 9 agent labels (`agents.md`, `labels.sh`).
- **Parked by the owner:** M2-14 playtest pass, M2-15 offline demo. **Out of scope:** Skimjob Advanced (`docs/advanced.md`), the recruited Mole.
- **Live:** https://skimjob.duckdns.org on the owner's AWS Lightsail box, Google sign-in on. Runbook: `docs/deploy.md`. Connection details live only in the owner's local `ssh-relay` skill. Deploys are Mac only and never automatic.

## How to resume

Run milestone R7 as `docs/simplified.md` "How to run it" says. Rebuild the live state from GitHub: list the open PRs and run `bash docs/pipeline/verdicts.sh <PR>` on each. Treat agents from earlier sessions as dead.

## Running the pipeline

- You never write code. The runner (`agents.md`, `docs/pipeline/runner/`, `.github/workflows/agent.yml`) starts each step on the host the ticket's label chooses, the builder on the model its Effort field picks and review and QA on Opus, in the order of `common.md` "The flow", sets `agent:working` / `agent:blocked`, and merges with `merge.sh` when the gate passes. You watch the tickets and PRs, and step in when a ticket stalls. agy (Gemini) only for menial, conflict-free rebases.
- The runner merges; run `merge.sh <PR>` yourself only when the owner asks.
- **Merge order:** one PR at a time. After each merge the other open PRs rebase onto `main`; a rebase that changes more than QA tests needs a delta review.
- **Your own docs PRs:** you can't QA yourself; spawn a QA agent.
- **Issues and the board** (from the Mac or Linux; the cloud can't reach Projects): move the card (Todo / In progress / In review / Owner review / Done, set PR). After a merge, fold the PR's `## Decisions` into `docs/decisions.md` (in your own docs PR, concisely) and open one issue per `## Follow-ups` line: the right Type, plus Area, Step and Flags on the board (`follow-up`, `owner-decision`, `flaky`, … as they fit).
- **Owner questions:** ask only for real decisions, as multiple-choice questions with a recommended option; batch technical defaults (about 4 at a time). Otherwise keep going. Send a short progress update about every 15 minutes while work runs.
- If `main` or the nightly run goes red, stop merging until a fix-forward PR is green.

## Owner direction

- Goal: a solid game on the live Lightsail site, which the owner playtests.
- UI: the cityrt-style cartoon notebook on every screen (`docs/ui-style.md`, CLAUDE.md "UI rules"). Style only: never their logo, name or art.
- Player rulebook: claude.ai doc "Skimjob — How to play" (https://claude.ai/artifact/3dEyv4wdmiJ3a9DhrtsBtN). Exact roles dealt is the default.
