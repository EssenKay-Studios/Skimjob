# Agents: the owner's guide

How to hand work to the agents and get it back. The rules the agents follow are in `common.md`. The runner that picks up tickets is `docs/pipeline/runner/` (the Mac and Linux poller) and `.github/workflows/agent.yml` (the cloud); both use one start check, `scripts/agent-start.ts`.

## Write a ticket

New issue → pick **Bug**, **Feature** or **Task**, and open it yourself, as karthik24iyer: the runner starts nothing on an issue someone else opened, because its author can edit the text after you label it (copy such an issue into a new one). Each form sets the issue Type, adds the issue to the board and asks for the Area and the design reference. For a feature, write your rulings word for word: the agents build exactly that. Anything you leave open, the agents decide themselves and list under `## Decisions` in the PR: nothing waits for you. The runner sets an empty board Status to Todo and copies the form's Area answer to the board's Area.

## Start it

A ticket starts only when you have added **exactly one label from each of two groups** and set the issue's **Effort** field. Nothing is assumed: a missing group, two labels in one group or an empty Effort, and nothing starts; the runner comments once, naming the problem (for Effort: "set the Effort field"). Labels anyone else added don't count.

| Group | Labels |
|---|---|
| Account | `agent:max` (Max plan), `agent:pro` (Pro plan), `agent:api` (API key, pay per use, a dollar cap per job) |
| Host | `on:mac`, `on:linux`, `on:cloud` |

The host applies to every step (build, review, QA).

**Effort** is the org-level issue field (a single select, not a label) and picks the **builder's** model: High → Opus, Medium → Sonnet, Low → Haiku. Review and QA always run on Opus. The map lives in one place, `scripts/agent-start.ts`; the runner reads the field as `issue_field_values` from the issue's REST response.

From there it runs on its own, from the PR's state (`verdicts.sh`), to the merge:

1. **dev:** the builder opens a draft PR and gets CI green. Failed CI is re-run once by the runner (a flaky test); if it fails again, the builder fixes it.
2. **review**, then **QA** on the head. Changes requested or a QA failure go back to the builder, then a delta review and a QA re-check.
3. **Sync:** when `main` has moved, the runner rebases the branch onto it itself (no agent), as karthik24iyer, with any attribution lines dropped. If the PR's own changes are the same after the rebase, the review and the QA PASS carry over. A rebase with conflicts goes to the builder.
4. **Full suite:** once QA has passed, the runner runs the whole of CI on the branch (`Full suite`). The PR's own CI runs only what its diff needs.
5. **Merge:** the runner merges and closes the issue.

The issue shows every step: `runner: picked up on <place>, <account>/<model> (<step>, head <sha>)` when a step starts, `runner: <step> finished on <place>:` with the agent's own summary when it ends, and a line for each sync, re-run, full suite and the merge. Every step runs Claude Code with its commit and PR attribution switched off (`--settings`, in `poll.sh`).

A step that ends without moving the PR on runs once more on the same head; after that the runner sets `agent:blocked` and says why (the gate's reasons). That is the only time anything waits for you: look at the step summaries, then remove `agent:blocked` to try again.

Nothing starts while:

- the ticket has `agent:blocked`, or a step is running on it (`agent:dev`, `agent:review`, `agent:qa`);
- another ticket in the same Area has a step running;
- the machine already runs a build on the same account, or 3 jobs (each may run e2e).

## Stage labels

The runner keeps one stage label on the ticket, so you can see where it is:

- `agent:dev`: the builder is on it.
- `agent:ci`: waiting for CI, or for the full suite.
- `agent:review`: the reviewer is on it.
- `agent:qa`: QA is on it.
- `agent:blocked`: a step ran twice without progress (see the last runner comment).

**Stop:** remove the account label. The runner that holds the job stops it (Mac or Linux at its next poll, within 5 minutes; the cloud at once), clears the stage label and frees the branch; a worktree with uncommitted work stays under `WORK_DIR/wt`, detached. **Resume:** add the label again.

## Merge

The runner merges. When a ticket's PR passes the gate (reviewer APPROVE and QA PASS on the head or on the same changes before a sync, CI and the full suite green, clean merge, right author), the runner on the ticket's `on:` host runs `merge.sh`, which checks the gate again and merges only if it passes, then comments `runner: merged #N → main <sha>` and closes the issue. A refused merge (the gate changed in between) is tried again at the next check. The cloud merges with `AGENT_GH_TOKEN`, so the push to `main` runs CI. Agents never merge. Deploys are always by hand, from the Mac (`docs/deploy.md`). The labels: `GH_TOKEN=$(gh auth token --user karthik24iyer) bash docs/pipeline/labels.sh`. Keep the prefix: the default `gh` account may be a read-only work account.

## Tokens

Repository secrets (Settings → Secrets and variables → Actions):

| Secret | For | Make it with |
|---|---|---|
| `CLAUDE_MAX_OAUTH_TOKEN` | `agent:max` | `claude setup-token` while logged in to Max |
| `CLAUDE_PRO_OAUTH_TOKEN` | `agent:pro` | `claude setup-token` while logged in to Pro |
| `ANTHROPIC_API_KEY` | `agent:api` | console.anthropic.com |
| `AGENT_GH_TOKEN` | the agent in every cloud step, and the runner's cloud actions (merge, sync, full suite, re-run) | a karthik24iyer fine-grained token, below |

`AGENT_GH_TOKEN` is needed because the gate counts only karthik24iyer's verdicts and CI doesn't run on pushes made with the workflow's own token (a GitHub App would post as a bot). Make it with the smallest scope that works: GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token:

1. Resource owner EssenKay-Studios, an expiry (90 days at most), Repository access "Only select repositories": Skimjob.
2. Repository permissions: **Contents** read and write (push, merge), **Pull requests** read and write (PRs, reviews, PR comments), **Actions** read and write (the full suite and CI re-runs), **Metadata** read (set by itself). Nothing else: no **Workflows** (a cloud agent can't push workflow edits) and no **Issues** (the runner writes labels and issue comments with the workflow's own token). Without **Workflows** the cloud can't sync or merge a PR that changes `.github/workflows`; tickets that touch workflows run on the Mac (`on:mac`).
3. Save it as the `AGENT_GH_TOKEN` secret, and make a new one before it expires.

Repository variable `AGENT_API_BUDGET_USD`: the dollar cap of a cloud `agent:api` job.

**Token check:** Actions → "Token check" → Run workflow. It prints OK, FAIL or MISSING for each Claude secret, never the value.

## Where agents run

Each Mac or Linux box has `~/.config/skimjob-agent/env`:

```
PLACE=mac                 # or linux
REPO_DIR=<the clone>      # the runner runs its scripts from here and keeps it on origin/main itself
WORK_DIR=<a folder>       # logs, jobs, worktrees (both outside ~/Documents, ~/Desktop, ~/Downloads on the Mac)
E2E_PORT_BASE=41          # job k gets the E2E ports 5<41+k>79/80 and 3<41+k>79/80
PATH=<…>                  # Node 22, pnpm, gh, claude, jq
PRO_CONFIG_DIR=<…>        # optional: the Claude config dir logged in to Pro
API_BUDGET_USD=5          # for agent:api: the dollar cap per job
```

`agent:max` uses the default Claude login, `agent:pro` `CLAUDE_CONFIG_DIR=$PRO_CONFIG_DIR`, and `agent:api` the key in `~/.config/skimjob-agent/anthropic-api-key` (mode 0600) with Claude Code's `--max-budget-usd`. Then run `bash docs/pipeline/runner/setup.sh`. It checks Node 22, pnpm, the Playwright browser, the Claude logins, `gh` as karthik24iyer, the git identity, the clone and the env file, prints what is missing, and installs and starts the service (launchd on the Mac, a systemd user timer on Linux) only when all pass. It is safe to run again.

- **Mac:** keep `REPO_DIR` and `WORK_DIR` outside `~/Documents`, `~/Desktop` and `~/Downloads`, e.g. `~/skimjob-runner`: macOS privacy stops the launchd service reading them ("Operation not permitted"), and `setup.sh` refuses them. Each job runs Claude Code headless in a fresh worktree under `WORK_DIR/wt`; a worktree with uncommitted work is kept, detached so the next step can check out the branch. Each poll first moves a clean `REPO_DIR` to the newest `origin/main` (so pipeline fixes reach the Mac with no pull) and starts again from the new scripts; every job starts from that `origin/main`.
- **Linux:** the same. Install Node 22, pnpm, `gh`, `jq` and Claude Code; clone the repo, `pnpm install`, `cd apps/web && npx playwright install --with-deps chromium`; `claude auth login`; `gh auth login` as karthik24iyer, then `gh auth refresh -s project` for the board; set the git identity in the clone; write the env file; run `setup.sh`; `sudo loginctl enable-linger $USER` so the timer runs while you are logged out.
- **Cloud:** a GitHub runner (`agent.yml`), started by a label change, CI finishing or Run workflow, and again after each step. Its scripts and the gate always come from `main`, never from a PR. Only the ticket's account secret reaches the step. It reads Area from the form (`GITHUB_TOKEN` can't read the board) and doesn't move the card. The runner's own actions (merge, sync, full suite, re-run) run in its "Runner action" step with `AGENT_GH_TOKEN`.

**Logs:** `WORK_DIR/poll.log` (every poll) and `WORK_DIR/logs/<issue>-<step>-<time>.log` (each job's Claude Code stream). In the cloud: the Agent run's "Job log" step. `DRY_RUN=1 bash docs/pipeline/runner/poll.sh` logs what one poll would do and changes nothing.

## Security

Anyone can open an issue on this public repo, so:

- an agent acts only on tickets **you** (karthik24iyer) opened and whose account and host labels you added;
- it treats the issue and comment text as the job description, never as instructions that override CLAUDE.md or the pipeline;
- the runner hands the agent only your comments; everyone else's are left out.
