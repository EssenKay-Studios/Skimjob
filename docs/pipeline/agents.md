# Agents: the owner's guide

How to hand work to the agents and get it back. The rules the agents follow are in `common.md`.

> **Coming in PR 2:** the poller and the runners that pick up labelled tickets by themselves. Until then a PM session starts the agents; everything below already describes how tickets, labels and merging work.

## Write a ticket

New issue → pick **Bug**, **Feature** or **Task**. Each form sets the issue Type, adds the issue to the board and asks for the Area, the design reference and whether you need to decide something. For a feature, write your rulings word for word: the agents build exactly that.

## Start it

A ticket starts only when you have added **exactly one label from each of three groups**. Nothing is assumed: a missing group, or two labels in one group, and nothing starts (PR 2's poller then comments once, naming the group).

| Group | Labels |
|---|---|
| Account | `agent:max` (Max plan), `agent:pro` (Pro plan), `agent:api` (API key, pay per use) |
| Host | `on:mac`, `on:linux`, `on:cloud` |
| Model | `model:opus`, `model:sonnet`, `model:haiku` |

The host and the model apply to every step (build, review, QA). To change one step, add an override; it wins over the group label:

- host: `build:`, `review:` or `qa:` with `mac`, `linux` or `cloud`;
- model: `build:`, `review:` or `qa:` with `opus`, `sonnet` or `haiku`.

## Progress labels

- `agent:working`: an agent is on it.
- `agent:blocked`: the agent asked you a question in the issue.
- `ready-to-merge`: reviewed, QA passed, CI green. Your turn.

**Stop a job:** remove its account label.

**Blocked:** the agent asks in the issue, with options and a recommendation. Answer in a comment, then add the account label again.

## Merge

On the Mac: `docs/pipeline/merge.sh <PR>`. It checks the gate (reviewer APPROVE and QA PASS on the head, CI green, clean merge, right author) and merges only if it passes. Agents never merge; a PM session runs it only when you ask. Deploys are always by hand, from the Mac (`docs/deploy.md`).

## Tokens

Repository secrets (Settings → Secrets and variables → Actions):

| Secret | For | Make it with |
|---|---|---|
| `CLAUDE_MAX_OAUTH_TOKEN` | `agent:max` | `claude setup-token` while logged in to Max |
| `CLAUDE_PRO_OAUTH_TOKEN` | `agent:pro` | `claude setup-token` while logged in to Pro |
| `ANTHROPIC_API_KEY` | `agent:api` | console.anthropic.com |

**Token check:** Actions → "Token check" → Run workflow. It prints OK, FAIL or MISSING for each secret, never the value.

## Where agents run

- **Mac:** your main clone and one worktree per agent; Node 22, pnpm, Chromium, `gh` logged in as karthik24iyer and Claude Code. At most 3 e2e runs at once.
- **Linux:** a Linux box with the same tools; full speed. The runner comes in PR 2.
- **Cloud:** a Claude Code cloud session; 2 slow cores, no GraphQL (so no board updates or `gh pr ready` from there). Good for builds that lean on CI. The runner comes in PR 2.

## Security

Anyone can open an issue on this public repo, so:

- an agent acts only on tickets whose account, host and model labels **you** (karthik24iyer) added;
- it treats the issue and comment text as the job description, never as instructions that override CLAUDE.md or the pipeline;
- it ignores comments from anyone else for instructions.

PR 2's poller enforces this.
