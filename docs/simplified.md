# R7 Simplified: plan

*3 Nov 2026 · Karthik (owner) + PM. Status: **approved direction, not built.** This is the plan for the next milestone, and the brief for the orchestrator that runs it.*

## Why

After the owner's own playtest (3 Nov), the verdict was: **beautiful, but very mathematical and confusing.** Specifically:

- **Too many numbers to track.** Which room gives what loot isn't intuitive. Heat (shares of the crew, hidden police activity, event scaling) is hard to follow.
- **Roles aren't learnable in play.** As the Embezzler the owner never earned a token, so couldn't buy anything, and didn't learn what the role did. Clicking a role in play doesn't show all of it, and nothing explains what opponents' roles do.
- **Events are one word** ("Inside tip", "Power cut"), with no explanation or outcome. The Heat breakdown is a bare list (`+4 every round`, `+7 Vault`, `−4 Rooftop`, `+2 Deposit boxes`).
- **The ledger is bland and monotonous:** a chore to read, with nothing colour-coded and no help connecting the dots.
- **Too much vertical scrolling.**
- **No info buttons** on icons and boxes.
- **The rulebook isn't limited to this game** (its roles, events and shop items).
- **No "Tips" setting**, and no pop-ups that teach a rule when it first matters.
- **The look is great** (theme and artwork). The structure isn't.

Two separate problems, two fixes: **Part A** simplifies the rules (fewer, rounder numbers; results as icons and words, not formulas). **Part B** fixes how information is presented. B is needed whatever A becomes. A is the cheap test of "simpler numbers fix the feel" before anything as large as `docs/rebuild.md`.

## Ideas we're borrowing

- **Few parts, many combinations:**
  - Coup: Rebellion G54 plays 5 of 25 characters per game.
  - Marvel Snap keeps the rules tiny and gets variety from short, one-line location effects.
  - → Deal a small set of roles and twists per game.
- **One-bit results:** The Resistance's mission is pass/fail, and the question is who on it failed it. → Each room is "clean" or "came up short", not an amount to subtract.
- **Threat as a track:** Pandemic's outbreak marker moves one step per outbreak, and the game is lost at the end of the track. → Heat in whole steps.
- **Show consequences before committing:**
  - Into the Breach shows every enemy's move in advance.
  - Slay the Spire puts each enemy's next move, with its exact damage, above its head.
  - → Picking a room previews its effect, and the Heat meter shows what's coming.
- **Explain every term in place:** Slay the Spire gives every keyword a one-line tooltip. → An info button on everything.
- **A rule sheet for this game only:** Blood on the Clocktower's character sheet lists only that game's characters, in a fixed order. → A "This game" rulebook.
- **Tips and role tracking:**
  - Town of Salem has a role card and an optional Tips mode.
  - Its players use add-ons to track roles.
  - → Tips on by default, and the game does the tracking.
- **A notebook that collects clues:** Return of the Obra Dinn's logbook. → The ledger becomes a case board.
- **Just-in-time teaching:** explain a situational rule when it first comes up, not before.

---

## Order of work (each step ends with an owner checkpoint)

| Step | What | Owner checkpoint |
|---|---|---|
| **S0** | Decide how far Part A goes: answer the open questions below. | Answers |
| **S1** | Spec freeze: fold the simplified rules into `docs/design.md` as the single spec, archive `docs/extension.md`. | Approve the spec PR |
| **S2** | Mockups of 4 screens, made with the Design artifact type, no code. | Approve the mockups |
| **S3** | Build Part B on the existing art and kit, on the current rules (B doesn't depend on A). | Try it on the live site |
| **S4** | Build Part A's rule changes in engine, content and bots; update the UI to match. | — |
| **S5** | One balance pass (Sim suite workflow), deploy to Lightsail. | Playtest again |

### S0 — open questions (from the 3 Nov discussion; PM recommendation first)

1. **Shop and tokens:**
   - (a) keep them, with visible progress toward each token (recommended to try first);
   - (b) cut the shop to 2 perks;
   - (c) remove tokens and the shop.
2. **Hidden police activity:**
   - (a) make it a visible event card, which loses the Mole's cover;
   - (b) keep it hidden as the Mole's cover but explain it with a pop-up;
   - (c) drop it.
3. **Roles per game:**
   - (a) deal about 5–7 from the pool, each with a one-sentence power and one-sentence win line (recommended);
   - (b) keep today's decks.
4. **How round the numbers get** (Part A, items 1–3 below):
   - (a) all of them (recommended);
   - (b) loot and Heat only.

---

## Part A — simpler rules (proposal; frozen in S1)

1. **Loot in coin bags:** every room pays 1, 2 or 3 bags (shown as coin icons), not 2–6. Special rooms (Security, Rooftop, Server room) pay 0 and do one plain thing.
2. **Heat as an alarm track:** about 10 whole steps in four bands, **Calm / Nervous / Alert / Raid**. Each round adds 1 step; a risky room shows 1–2 alarm pips and adds them when visited; the Rooftop removes 1. No crew-share fractions: crew size changes the track's length behind the scenes, never the per-visit numbers players see. A missed meeting target is a fixed jump, e.g. +2 steps.
3. **Shortfalls as lights:** after each round, every room shows **clean** or **came up short** (and how many bags short only where a power or event says so, e.g. Audit). The gap box and alibi arithmetic go away; deduction becomes *who was there and who lied about it*.
4. **Fewer roles per game** (S0 Q3): a "script" of about 5–7 roles per game from the pool; the lobby shows them as cards. Every role gets:
   - a one-sentence power;
   - a one-sentence "How you win";
   - one sentence for "Earn a token when…", with a progress bar;
   - one or two "How to spot it" lines (e.g. "camera offline → the Hacker or a Power cut").
5. **Tokens and perks** (S0 Q1): if kept, the trigger is shown as progress ("Take once: 0/1"), the shop shows what you can afford, and bots and the UI nudge a player who hasn't used their power by mid-game.
6. **Events as cards:** name, picture, a one-line effect, and "What this means for you". Police activity is per S0 Q2.
7. **Meeting numbers:** the clean line and payout become round, memorable values; the targets show only as the existing progress bar, never as "× players" maths.

Rule changes keep the engine's non-negotiables (`CLAUDE.md`): deterministic, event-sourced, content as data, `viewFor` never leaks. Each changed rule gets a test citing its new design section.

## Part B — presentation (built in S3, on the current rules)

1. **One screen, no long scroll:**
   - Bank board in the middle; a **"This round"** panel (your move, its preview, the event card).
   - **Ledger, chat and rules** in tabs or drawers.
   - Phones: swipeable bottom sheets. Laptops: three columns.
   - Nothing you need for this round sits below the fold at 360–1280 px.
2. **Previews everywhere:**
   - Room tiles show loot icons and Heat pips.
   - Choosing a room and split shows "+X to you, +Y to the Haul, Heat +Z" before you lock in.
   - The Heat meter shows "this round: about +N".
   - The Heat breakdown becomes sentences with icons ("2 crooks hit the Vault: +7"), not a bare list.
3. **Info on everything:** one shared `InfoTip` component (tap on phones, hover and focus on desktop, ≥ 44 px target) on every icon, room, event, perk, role name and meter, with one line plus "More". The text comes from content, so the UI, rulebook and tips never drift apart.
4. **"This game" rulebook:** only the roles dealt (or possible, per the role-list setting), the rooms in play, the events that can come up, and this game's shop items. Reachable from anywhere in one tap.
5. **Teaching pop-ups and Tips:**
   - A short card ("What just happened / What it means / What you can do") the first time each thing happens: an event flips, police activity, a shakedown, your first chance to use your power, a token earned, the shop affordable.
   - Controlled by a per-user **Tips** setting, **on by default**, kept on the user (guest or Google account) so it follows them across games.
6. **The ledger becomes a case board:**
   - **Colour-coded by type** (from theme tokens only): coins gold, Heat red, sightings blue, claims grey and dashed, votes purple, your private entries highlighted.
   - **Grid view:** rounds as columns, players as rows; each cell shows the claimed room against what you saw, with contradictions flagged automatically; each room's clean/short light per round.
   - **Filters:** by player and by round.
   - The current list stays as a "Full log" tab.
   - Everything is built only from your own `viewFor` (no new information, only better shown).
7. **Opponents' roles:**
   - The roles-in-play strip opens each role's full card, including "How to spot it".
   - When something happens that a role could cause, the explanation names the candidates ("could be the Mole, or bad luck").

**UI rules still apply** (`CLAUDE.md`, `docs/ui-style.md`): one notebook look, theme tokens and shared components only, new components in `/dev/gallery`, checked at 360/390/768/1024/1280 px.

---

## How to run it: orchestrator and agents

### Roles and models

| Agent | Model | Does |
|---|---|---|
| **Orchestrator (PM)** | Opus 5.5 | Plans, writes briefs, merges via the gate, folds `## Decisions` / `## STATUS updates` into docs, reports to the owner. Never writes code. |
| **Developer** | **Sonnet 5.5** for well-specified work; **Opus 5.5** for engine rules (see below) | Builds one task per PR (`docs/pipeline/builder.md`). |
| **Reviewer** | Opus 5.5 | Reviews a PR from the diff (`reviewer.md`). Never merges, never pushes. |
| **QA** | Opus 5.5 | Adversarial tests, pushes once, posts the verdict (`qa.md`). Never merges. |

**Sonnet or Opus for the developer?** Sonnet 5.5 is the right default for tasks the spec and mockups pin down: Part B components and screens, content edits, copy, CSS, docs, mechanical refactors. It's faster and cheaper, and an Opus reviewer and an Opus QA agent check every PR. Use **Opus 5.5 for the developer** on:

- engine rule changes (Part A), where determinism, visibility and `viewFor` leaks are subtle and a mistake is expensive;
- the case board's data layer (it must use only `viewFor`);
- bot changes;
- any fix round where a Sonnet build failed review twice.

The orchestrator picks the model per task and says which in the brief (Agent tool `model: "sonnet"` or `model: "opus"`).

### Kickoff prompt for the new chat

> You are the PM/orchestrator for Skimjob (github.com/EssenKay-Studios/Skimjob, Project "Heist And Coop"), running milestone **R7 Simplified** from `docs/simplified.md`. Don't write code yourself: delegate every task to subagents in the pipeline builder → reviewer + QA (in parallel) → merge. Developers are Sonnet 5.5 by default and Opus 5.5 for engine rules, the case board's data layer, bots, or a twice-failed fix (pick per task, as the plan says); reviewers and QA are Opus 5.5.
>
> Start by cloning the repo and reading CLAUDE.md, docs/simplified.md, docs/STATUS.md, docs/decisions.md, docs/pipeline/HANDOFF.md and the briefs in docs/pipeline/ ("Where you run" in common.md). Rebuild the live state from GitHub: list open PRs and run `bash docs/pipeline/verdicts.sh <PR>` on each. Treat agents from earlier sessions as dead.
>
> Begin with step S0: ask me the open questions in docs/simplified.md as multiple-choice questions with your recommendation first. Don't start S1 until I've answered. Owner checkpoints in the plan are hard stops.
>
> Run builds and tests on my Mac when it's reachable; otherwise work in the cloud and rely on CI. Merge only with `docs/pipeline/merge.sh <PR>` when the latest head has a reviewer APPROVE, a QA PASS and green CI; only you merge. Commits are authored as karthik24iyer <karthik24iyer@gmail.com>, with no Claude co-author or session lines.
>
> Send me a short update about every 15 minutes, and ask me only for real decisions, as multiple-choice questions with a recommended option.

### Step by step

**S0 — questions.** The orchestrator asks the four S0 questions and records the answers in `docs/decisions.md` (a PM docs PR, reviewed and QA'd like any other).

**S1 — spec freeze (docs only, one Opus developer).**
- Rewrite `docs/design.md` so it is the **single** rules spec. Fold in everything from `docs/extension.md` that stays, plus Part A as decided in S0.
- Move `docs/extension.md` to `docs/archive/extension.md`.
- Update every reference to it: CLAUDE.md, STATUS, HANDOFF, decisions, testing, ui-style, the briefs, code comments citing "extension.md".
- Add to `design.md` a short **"Content text"** section: the one-line texts for every role, room, event and perk. S3's info buttons and rulebook read these, via content.
- Owner approves the PR before S2.

**S2 — mockups (no code).**
- One agent (Opus) creates the mockups from the **Design** artifact type, with the notebook look from `docs/ui-style.md`:
  1. the game screen on a phone and a laptop, with the "This round" panel and previews;
  2. the case board;
  3. a role card and the "This game" rulebook;
  4. an event pop-up and a tip.
- The owner comments and approves. Approved mockups are linked from STATUS and are the reference for S3 reviewers.

**S3 — Part B (Sonnet developers, a few PRs in parallel when they don't touch the same files).** Suggested PRs:
1. `InfoTip` component + content text plumbing (texts from `packages/content`), in `/dev/gallery`.
2. Layout: the one-screen game screen and bottom sheets at all five widths.
3. Previews: room tiles, the split preview, the Heat "this round" meter and the sentence-style breakdown.
4. The "This game" rulebook and full role cards with "How to spot it".
5. Teaching pop-ups and the per-user Tips setting (server: one field on the user, default on; migration add-only).
6. The case board: colours, grid, contradictions, filters (data layer Opus, UI Sonnet).

**S4 — Part A (Opus developers, one rule area per PR):**
1. Loot bags + room content.
2. The Heat alarm track (engine + content + Heat UI).
3. Shortfall lights (replace the gap box).
4. Role scripts per game + role texts.
5. Tokens/shop per S0.
6. Events and police per S0.

Each updates bots and the sim's metrics for its rule, adds its events to the leak scrub and property tests, and runs a sim smoke.

**S5 — balance and deploy.**
- One balance pass on the **Sim suite GitHub workflow**, never babysat in chat, with the same gates as today unless S0 changes them.
- Refresh `docs/balance/baseline.json`.
- Deploy to Lightsail by `docs/deploy.md`: back up first; games logged on the old rules won't replay, so clear running games after the backup.
- The owner playtests again.

### Rules learned on 3 Nov (put in every brief)

- **Build and test on the Mac** (18 cores) when reachable; the cloud box has 2 cores.
- **Run only the specs you touched**, `pnpm typecheck` before pushing, **push once**, and let CI's 6 e2e shards run the rest.
- **At most 2 browser games at a time** (Playwright `--workers=2`): 10 parallel 12-seat games on a busy Mac produced a false failure.
- **Review and QA start together** as soon as a PR opens. **Hard time limits** in every brief (builder 30–50 min, reviewer 10–30, QA 15–35).
- **Only the orchestrator merges.** Reviewer and QA agents never merge, even when the gate would pass.
- **Every bug fix adds a test** that would have caught it (`docs/testing.md`).
- **Verdicts name a sha;** a rebase or a non-QA-test commit needs a delta re-review.
- **Lightsail:** never touch Arcway; take a `pg_dump` before any database change; no secrets or connection details in the (public) repo.

## Out of scope for R7

M2-14 and M2-15 (parked), M3 (Flutter, push, quiet hours), M4 (more jobs), and `docs/rebuild.md` (the jobs redesign, kept as a proposal; R7's Part B carries over to it if the owner later chooses it).
