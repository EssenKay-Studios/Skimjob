# Agents: the owner's guide

How to hand work to the agents and get it back. The rules the agents follow are in `common.md`. The runner that picks up tickets is `docs/pipeline/runner/` (the Mac and Linux poller) and `.github/workflows/agent.yml` (the cloud); both use one start check, `scripts/agent-start.ts`.

## Write a ticket

New issue → pick **Bug**, **Feature** or **Task**, and open it yourself, as karthik24iyer: the runner starts nothing on an issue someone else opened, because its author can edit the text after you label it (copy such an issue into a new one). Each form sets the issue Type, adds the issue to the board and asks for the Area, the design reference and whether you need to decide something. For a feature, write your rulings word for word: the agents build exactly that. The runner sets an empty board Status to Todo and copies the form's Area answer to the board's Area.

## Start it

A ticket starts only when you have added **exactly one label from each of three groups**. Nothing is assumed: a missing group, or two labels in one group, and nothing starts; the runner comments once, naming the group. Labels anyone else added don't count.

| Group | Labels |
|---|---|
| Account | `agent:max` (Max plan), `agent:pro` (Pro plan), `agent:api` (API key, pay per use, a dollar cap per job) |
| Host | `on:mac`, `on:linux`, `on:cloud` |
| Model | `model:opus`, `model:sonnet`, `model:haiku` |

The host and the model apply to every step (build, review, QA). To change one step, add an override; it wins over the group label:

- host: `build:`, `review:` or `qa:` with `mac`, `linux` or `cloud`;
- model: `build:`, `review:` or `qa:` with `opus`, `sonnet` or `haiku`.

The runner takes the steps in order, from the PR's state (`verdicts.sh`): build → CI green → review → QA. A commit that is not a QA test needs a delta review; QA starts only after an APPROVE on the head. Each start comments `runner: picked up on <place>, <account>/<model> (<step>, head <sha>)` and moves the card to In progress. A step runs once per head: if it ends without moving the PR on, the runner says so; remove and re-add the account label to run it again.

Nothing starts while:

- the ticket has `agent:blocked` or `agent:working`;
- an owner decision is open: the form's "Owner decision needed?" says yes, or the board's Flags has `owner-decision` (the cloud reads only the form). Once you have decided, edit the answer to no and clear the flag;
- another ticket in the same Area has `agent:working`;
- the machine already runs a build on the same account, or 3 jobs (each may run e2e).

## Progress labels

- `agent:working`: an agent is on it.
- `agent:blocked`: the agent asked you a question in the issue.
- `ready-to-merge`: reviewed, QA passed, CI green. Your turn: the runner comments the merge command.

**Stop:** remove the account label. The runner that holds the job stops it (Mac or Linux at its next poll, within 5 minutes; the cloud at once), clears `agent:working` and frees the branch; a worktree with uncommitted work stays under `WORK_DIR/wt`, detached. **Resume:** add the label again.

**Blocked:** the agent's question reaches the issue through the runner, which swaps `agent:working` for `agent:blocked` and leaves the start labels in place. Answer in a comment, then remove `agent:blocked`; the runner picks the ticket up again.

## Merge

On the Mac: `GH_TOKEN=$(gh auth token --user karthik24iyer) docs/pipeline/merge.sh <PR>`. It checks the gate (reviewer APPROVE and QA PASS on the head, CI green, clean merge, right author) and merges only if it passes. Agents never merge; a PM session runs it only when you ask. Deploys are always by hand, from the Mac (`docs/deploy.md`). The labels: `GH_TOKEN=$(gh auth token --user karthik24iyer) bash docs/pipeline/labels.sh`. Keep the prefix: the default `gh` account may be a read-only work account.

## Tokens

Repository secrets (Settings → Secrets and variables → Actions):

| Secret | For | Make it with |
|---|---|---|
| `CLAUDE_MAX_OAUTH_TOKEN` | `agent:max` | `claude setup-token` while logged in to Max |
| `CLAUDE_PRO_OAUTH_TOKEN` | `agent:pro` | `claude setup-token` while logged in to Pro |
| `ANTHROPIC_API_KEY` | `agent:api` | console.anthropic.com |
| `AGENT_GH_TOKEN` | the agent in every cloud step | a karthik24iyer fine-grained token, below |

`AGENT_GH_TOKEN` is needed because the gate counts only karthik24iyer's verdicts and CI doesn't run on pushes made with the workflow's own token (a GitHub App would post as a bot). Make it with the smallest scope that works: GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token:

1. Resource owner EssenKay-Studios, an expiry (90 days at most), Repository access "Only select repositories": Skimjob.
2. Repository permissions: **Contents** read and write (push), **Pull requests** read and write (PRs, reviews, PR comments), **Metadata** read (set by itself). Nothing else: no **Workflows** (a cloud agent can't push workflow edits) and no **Issues** (the runner writes labels and issue comments with the workflow's own token).
3. Save it as the `AGENT_GH_TOKEN` secret, and make a new one before it expires.

Repository variable `AGENT_API_BUDGET_USD`: the dollar cap of a cloud `agent:api` job.

**Token check:** Actions → "Token check" → Run workflow. It prints OK, FAIL or MISSING for each Claude secret, never the value.

## Where agents run

Each Mac or Linux box has `~/.config/skimjob-agent/env`:

```
PLACE=mac                 # or linux
REPO_DIR=<the clone>      # the runner runs its scripts from here: git pull to update it
WORK_DIR=<a folder>       # logs, jobs, worktrees
E2E_PORT_BASE=41          # job k gets the E2E ports 5<41+k>79/80 and 3<41+k>79/80
PATH=<…>                  # Node 22, pnpm, gh, claude, jq
PRO_CONFIG_DIR=<…>        # optional: the Claude config dir logged in to Pro
API_BUDGET_USD=5          # for agent:api: the dollar cap per job
```

`agent:max` uses the default Claude login, `agent:pro` `CLAUDE_CONFIG_DIR=$PRO_CONFIG_DIR`, and `agent:api` the key in `~/.config/skimjob-agent/anthropic-api-key` (mode 0600) with Claude Code's `--max-budget-usd`. Then run `bash docs/pipeline/runner/setup.sh`. It checks Node 22, pnpm, the Playwright browser, the Claude logins, `gh` as karthik24iyer, the git identity, the clone and the env file, prints what is missing, and installs and starts the service (launchd on the Mac, a systemd user timer on Linux) only when all pass. It is safe to run again.

- **Mac:** each job runs Claude Code headless in a fresh worktree under `WORK_DIR/wt`; a worktree with uncommitted work is kept, detached so the next step can check out the branch. Each poll fetches `origin` once and every job starts from that `origin/main`.
- **Linux:** the same. Install Node 22, pnpm, `gh`, `jq` and Claude Code; clone the repo, `pnpm install`, `cd apps/web && npx playwright install --with-deps chromium`; `claude auth login`; `gh auth login` as karthik24iyer, then `gh auth refresh -s project` for the board; set the git identity in the clone; write the env file; run `setup.sh`; `sudo loginctl enable-linger $USER` so the timer runs while you are logged out.
- **Cloud:** a GitHub runner (`agent.yml`), started by a label change, CI finishing or Run workflow, and again after each step. Its scripts and the gate always come from `main`, never from a PR. Only the ticket's account secret reaches the step. It reads Area and the owner decision from the form (`GITHUB_TOKEN` can't read the board) and doesn't move the card.

**Logs:** `WORK_DIR/poll.log` (every poll) and `WORK_DIR/logs/<issue>-<step>-<time>.log` (each job's Claude Code stream). In the cloud: the Agent run's "Job log" step. `DRY_RUN=1 bash docs/pipeline/runner/poll.sh` logs what one poll would do and changes nothing.

## Security

Anyone can open an issue on this public repo, so:

- an agent acts only on tickets **you** (karthik24iyer) opened and whose account, host and model labels you added;
- it treats the issue and comment text as the job description, never as instructions that override CLAUDE.md or the pipeline;
- the runner hands the agent only your comments; everyone else's are left out.
