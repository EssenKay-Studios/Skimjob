# R7 Simplified: plan

*3–4 Nov 2026 · Karthik (owner) + PM. Status: **approved, not built.** Built straight on `main`; cleanup first (S0 docs, C code). Every rule below was agreed with the owner on 4 Nov; numbers marked [tunable] are starting values for the simulator. This is the plan for the next milestone, and the brief for the orchestrator that runs it. A later, separate paid version, **Skimjob Advanced**, builds on this one: `docs/advanced.md`.*

**Words used throughout:** a **raid** is the police hitting one room; a **bust** is the whole heist failing because Wanted reached 3.

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

Two fixes: **Part A** remakes the rules around a few visible things (coins, bells, a bank, equal shares) and the players' own choices. **Part B** fixes how information is presented.

**Design principle (owner, 4 Nov):** no role is good or evil, and nothing pays anyone to be nice. Every player faces the same temptation: hand in or pocket. It is the players' own attitude that makes a crew honest or greedy, and the crew's attitude decides how well everyone does. Roles are tools that can be used either way; perks are for the buyer's own benefit.

## Ideas we're borrowing

- **Few parts, many combinations:**
  - Coup: Rebellion G54 plays 5 of 25 characters per game.
  - Marvel Snap keeps the rules tiny and gets variety from short, one-line location effects.
  - → Deal a small set of roles and perks per game.
- **Detection meters** (Payday, Hitman): a bar that fills as you get noticed. → Each room's alarm bell.
- **Push your luck together** (Incan Gold): everyone secretly decides how far to push, and if it blows, everyone there loses. → Raids.
- **The public-goods dilemma:** what you hand in is shared by all; what you keep is yours alone. → The equal split.
- **Show consequences before committing:**
  - Into the Breach shows every enemy's move in advance.
  - Slay the Spire puts each enemy's next move above its head.
  - → Picking a room and coins previews the rings; every bell is always visible.
- **Explain every term in place:** Slay the Spire gives every keyword a one-line tooltip. → An info button on everything.
- **A rule sheet for this game only:** Blood on the Clocktower's character sheet lists only that game's characters. → A "This game" rulebook.
- **Tips and role tracking:** Town of Salem has a role card and an optional Tips mode; its players use add-ons to track roles. → Tips on by default, and the game does the tracking.
- **A notebook that collects clues:** Return of the Obra Dinn's logbook. → The ledger becomes a case board.
- **Just-in-time teaching:** explain a situational rule when it first comes up, not before.

---

## Part A — the new rules (agreed 4 Nov; frozen into `design.md` in S1)

### A1. A round: pick a room, grab coins, split them

1. **Pick a room.** Each room offers a number of coins per visitor per round [tunable]:

   | Room | Coins per visitor | Noise | Players |
   |---|---|---|---|
   | Lobby | 1 | Silent | All |
   | Office | 2 | The 1st coin is silent; each extra coin rings once | All |
   | Deposit boxes | 2 | As the Office | 5+ |
   | Manager's office | 2 | As the Office | 9+ |
   | Vault | 3 | Every coin rings (or the 1st is silent: the simulator picks) | All |
   | Security | 0 | Watch one room's cameras: see who was in it | All |
   | Server room | 2 | As the Office | 5+ |
   | Rooftop | 0 | Lie low: automatically cools the hottest room (A2), and it's the only escape on a bust (A5) | All |

2. **Grab 1 coin up to the room's limit** (tap the coins). Fewer coins mean less noise. A visitor's coins are their own; several visitors don't share a room's limit.
3. **Split your coins in secret:** drag each into the **crew duffel** or **your pocket**.
4. **Lock in.** The round ends when everyone has locked in or at its deadline. A missed move is the Lobby, 1 coin, handed in.

### A2. Bells, raids and Wanted (replaces Heat 0–100)

- **Every room has an alarm bell with 4 bulbs** [tunable], public to everyone.
- **Rings add bulbs:** each ring lights one bulb in that room. Rings from everyone in the room add up.
- **Cooling, at the end of every round:**
  1. every room turns off 1 bulb;
  2. then **each player on the Rooftop automatically cools the hottest room by 1 more bulb**. Several Rooftop players cool one after another, each time the room that is hottest at that moment. Ties are broken at random, with the game's seeded randomness. Nobody chooses a room; it's what a crew lying low would do anyway.
- **Raid:** when a room's 4th bulb lights, the police raid it:
  - everyone inside loses that round's grab (the police seize it; it leaves the game);
  - the room is taped off for 2 rounds [tunable];
  - **Wanted** goes up 1 star;
  - a **police briefing** meeting is called.
- **Wanted 3 stars** [tunable] = **bust**: the heist fails at once (who escapes: A5).
- **Crew size:** bigger crews get more rooms (5+, 9+). If big crews still get raided too often, the raid line rises behind the scenes; players only see a strip of bulbs.
- **No room has a visitor limit,** the Rooftop included: a limit would reveal secret moves ("the Office is full") and reward whoever locks in first, which is unfair in async games.

### A3. The bank and the end of the game (replaces acts, checkpoints and fixed rounds)

- **The bank holds about 16 coins per player** [tunable], shown as a pile of money in the Vault art that visibly shrinks.
- Every coin grabbed comes out of the bank, whether it's handed in or pocketed (seized coins too).
- **The game ends** when the bank is empty, at a **round cap of about 12** [tunable], or at a bust (Wanted 3). The host's session length is divided by the round cap, so long games keep a predictable end; a game that empties the bank early simply ends early.

### A4. Equal shares, the kitty and the fair share

- **Each round, the crew take is split equally among all players:** everything handed in, plus coins returned by shakedowns and the Priest, plus last round's leftover.
- **The kitty:** whatever doesn't divide evenly stays on the table for next round. At the end, what's left pays for the getaway car and leaves the game.
- **Fair share:** the coins split to each player so far, the same for everyone, and public.
- **Missing:** each round the game shows coins taken from the bank, the crew take, and **"N coins went missing"**, never who.
- **Stashes stay private.** A stash = fair share received + coins pocketed − coins seized in raids − coins spent on perks.

### A5. The honesty line and winning

- **Crew honesty** = crew take ÷ coins taken from the bank (seized coins don't count as taken). It's shown as a meter against the line.
- **The honesty line is two-thirds:** at the end, if less than two-thirds of everything taken reached the table, **the heist fails** (too much was stolen).
- **The heist succeeds** if the game ends by the bank or the round cap, with honesty at or above two-thirds and no bust. Then **the biggest stash wins**. If nobody stole, everyone is level and **the whole crew wins together**. Only stealing and getting away with it separates players.
- **Bust (Wanted 3):** only the players **on the Rooftop that round escape**; everyone else is arrested and loses everything. **The biggest stash among the escapees wins** (any role, the Mole and Fixer included). If nobody was on the Rooftop, nobody wins. This makes the endgame tense: at Wanted 2, every player weighs "keep grabbing, or go up and wait?".
- **Sunk by theft (honesty below two-thirds at the end):** nobody wins, **except the Mole or the Fixer, if one of them holds the biggest stash**.
- Ties go to fewer shakedowns, then share the win.

### A6. Meetings and shakedowns

- **Regular meetings** each time a third of the bank is gone. Only these recharge "once between meetings" powers.
- **A police briefing** after every raid (no recharge).
- **One emergency meeting per player** per game, as today.
- **Voting** as today: shake down one player or skip; a shakedown passes with at least half the crew voting and more than half of the votes cast. Vote visibility stays a host setting.
- **A shakedown opens the target's stash** and compares it with the fair share. Whatever is above the fair share (the pocketed coins still held) goes back on the table, to be split next round. **Coins already spent on perks are gone and are not taken.** A target at or below the fair share is clean, and nothing happens.

### A7. The plan board (planning without meetings)

- **A shared board for each round**, open the whole round: a miniature of the bank where anyone drags crew avatars onto rooms ("A → Office"), and each player marks their own spot (✋).
- **Pledges:** "I'll use my power on the Vault." A pledge is a claim, not a commitment, and can be a bluff.
- **Nothing is binding;** breaking the plan is the betrayal. Seats show who has agreed.
- **Async-friendly:** the plan persists and can change until the deadline.
- **Bots** take a sensible spot and sometimes break it.
- **The plan is evidence** (see B6): each round's final plan, its pledges and a compact edit history ("B moved themselves to the Vault 2 minutes before the deadline") go into the ledger when the round resolves.
- **Build note:** the live board can work like chat (server-side, fast to update); only the per-round snapshot is written into the game log, so bots, the case board and the reveal can read it.

### A8. Roles: tools, not sides

Each game deals about **5–7 roles** [tunable]. Every role has a one-sentence power, a "How you win" line and a "How to spot it" line.

| Role | Power | Frequency |
|---|---|---|
| **Lookout** | You also see who was in one extra room. | Every round |
| **Locksmith** | Your coins ring one less time. | Every round (passive) |
| **Detective** | Learn how many coins one player grabbed last round (not how many they kept). | Every round |
| **Auditor** | Learn how many coins reached the duffel from one room last round. | Once between meetings |
| **Smooth Talker** | Your vote counts twice. | Every meeting (passive) |
| **Hacker** | One room's bell is hidden from everyone this round (it shows "?"). | Once between meetings |
| **Electrician** | Black out one room next round: nobody there sees who else is there, and its cameras are offline. Its bell still rings. Announced at the start of the round as "Power cut in the Office", with no source. | Once between meetings |
| **Priest** | Secretly absolve one player: whatever they hold above the fair share goes back on the table (coins spent on perks are not taken). The Priest learns how much that was. Not the same player twice in a row; the absolved player is told "your sins were absolved". | Once between meetings |
| **Mole** | Secretly ring any room once (a police tip-off). **Wins a heist sunk by theft** with the biggest stash; on a bust, the Rooftop rule applies like for anyone. | Once between meetings |
| **Fixer** | Tear the tape off a raided room and reopen it. **Wins a heist sunk by theft** with the biggest stash; on a bust, the Rooftop rule applies like for anyone. | Once per game |

**The frequency rule:**
- powers that only narrow suspicion are **every round**;
- powers that can prove theft, or that open blind spots, are **once between meetings**;
- a big swing is **once per game**.

**Dealing:** every role, the Mole and Fixer included, is dealt at random from the pool, within the eyes/shadows balance below.

**Balancing a deal, eyes vs. shadows:** eyes (Lookout, Detective, Auditor, Priest, Smooth Talker) spot theft; shadows (Locksmith, Hacker, Electrician, Mole, Fixer) make it possible. A deal has roughly equal numbers of each. No role should be so strong or so weak that claiming it puts its holder at a disadvantage; the simulator checks each role's win rate against fair share.

**Cut from R6:** Cleaner, Bagman and Muscle (and the other R6-only roles). Muscle: with a single winner, nobody has a reason to protect anyone but themselves.

### A9. Perks: a black market paid in coins (replaces tokens)

- **There are no tokens.** Perks are bought with coins **from your own stash**, which lowers your score.
- **The coins leave the game** (paid to fixers and cops); buying doesn't change the crew take or honesty.
- **Each game's shop deals one perk per tier**, so 3 items, picked by the game's seed. The "This game" rulebook lists only those.
- **One perk per player per round**, each single-use.
- **Every purchase is logged at once, without a name:** "🛒 Someone bought Soft shoes (2 coins)".
- **Laundering is allowed:** stolen coins spent on perks are gone, so shakedowns and the Priest can't take them, but they no longer count toward winning.

| Cost | Perk | Effect |
|---|---|---|
| 1 | **Tail** | Next round, also see who was in one extra room. |
| 1 | **Stamped alibi** | Your real room this round is stamped "verified" in the ledger (only if your alibi is true). |
| 1 | **Check ballot** | See one player's vote at the next meeting. |
| 2 | **Soft shoes** | Next round, your coins don't ring at all. |
| 2 | **Blackout** | Next round, one room goes dark: no sightings, cameras offline. Its bell still rings. |
| 3 | **Bail** | Your next shakedown is cancelled automatically (the ledger says only "a shakedown fell through"). |
| 3 | **Plant evidence** | One player of your choice appears in one room's camera and Lookout feeds this round. |

### A10. What goes away from R6

Tokens and their 20 triggers; the R6 shop and perk pool; temperament tags; the R6 role list; acts; checkpoint targets (7 / 15 / 23 × players); fixed 9 rounds; Heat 0–100 and its crew-share formula; hidden police moments; the gap box; the clean line (6) and payout (8). The finite bank comes from the earlier jobs redesign (archived as `docs/archive/rebuild-2026-11-02.md`).

### A11. Also decided (4 Nov)

1. **Event cards:** from round 2, each round has a **4-in-10 chance** that one card flips (6 in 10: nothing happens). The deck has 4 cards, each a sentence:
   - **Lockdown:** one room is closed this round.
   - **Shift change:** Vault visitors can grab 1 extra coin this round.
   - **Audit:** every room shows how many coins reached the duffel from it this round.
   - **Inside tip:** one random player privately learns another player's role.

   Dropped: Payday, Double-cross, Power cut (now the Electrician and Blackout), Quiet night, Police patrol, Raid rumour.
2. **Duel mode is removed.** Games need 3+ players; bots fill seats.
3. **"Learn the game"** replaces Quick:
   - a **single-player** game (you plus bots), about 5 minutes;
   - a small bank and about 6 short rounds;
   - a fixed set of roles (Lookout, Locksmith, Detective, Hacker), no shop and no events;
   - scripted pop-ups and guides at every step.

   It is built as **its own PR after the core game works** (S4).
4. **The Server room** becomes an ordinary 2-coin room for 5+ players (A1); its old "how many pocketed" power is redundant now that missing coins are public.
5. **Mole and Fixer** are dealt at random like every other role.

### A12. Built so Skimjob Advanced can follow

`docs/advanced.md` is a later, separate paid version in which **players keep some of the facts by hand** (and can fake them) instead of the system showing them. For it to be a layer on R7 rather than another rewrite, R7 builds in ten seams. They are seams, not stub code: nothing for Advanced is built now. The reviewer checks them on every S3/S4 PR.

1. **Which facts are public is content, never hard-coded.** Bells, the duffel total per round, the bank pile, missing coins and honesty are entries in a content fact catalogue with a visibility setting (all public in R7). The engine emits every such fact through one helper that reads it. Advanced switches some to private-to-a-job.
2. **The case board's trust levels are generic.** "Fact", "Seen by you", "Shared evidence" and "Said" are data, and an entry's level comes from its event's source, so Advanced adds one level per role ("Reported by the Teller", "Reported by the Lookout"), each with its badge from content, without redesigning the ledger.
3. **Rulesets are content.** A game names its ruleset (`simplified`), and the ruleset only selects content (fact visibility, rooms, its own role list, perks, events). The engine and UI never branch on the ruleset's name; Advanced is another ruleset entry with its own roles, never a fork.
4. **Roles, perks and events register by id:** a content entry plus one handler, **including any role-specific win rule** (the Mole's and Fixer's win lives in their handlers, not in the end-of-game code). A role can be removed from or added to a ruleset without touching anything else.
5. **Player statements are one "said" event type** (plans, claims, alibis, pledges). Advanced's records are **one generic record command** whose per-job format comes from content, so a 10th role needs no new command, event type or screen; records show in the case board through seam 2.
6. **Bots read facts only through `viewFor`,** so hidden facts need no bot rewrite.
7. **Whether a role's holder is secret or announced, and whether its result goes privately to the holder or into a record they file, is a content setting per role.** In R7 every holder is secret and every result private, and **R7 builds only that path**: the setting exists as data, with no unused announced/filed code until Advanced.
8. **The deal reads its counts from content:** how many roles of which kinds, by player count. Nothing hard-codes a number of roles.
9. **Holding a role is an event, not a setup field.** The current holder of each role is derived from the log, and "once between meetings" style uses are tracked per role and holder, so a role can change hands mid-game (Advanced's swap vote) with one more event.
10. **Meeting motions register by id** (the shakedown in R7), so Advanced's role-swap vote is one more motion.

Rule changes keep the engine's non-negotiables (`CLAUDE.md`): deterministic, event-sourced, content as data, `viewFor` never leaks. Each changed rule gets a test citing its new design section.

---

## Part B — presentation

1. **One screen, no long scroll:**
   - The bank board in the middle, with every room's coins, bell and tape.
   - A **"This round"** panel: your move, its preview, the plan board and the event card.
   - **The ledger, chat and rules** in tabs or drawers.
   - Phones: swipeable bottom sheets. Laptops: three columns.
   - Nothing needed for this round sits below the fold at 360–1280 px.
2. **The move as a picture:** tap coins on the room's counter, then drag each into the **crew duffel** or **your pocket**. The bell previews the rings before you lock in.
3. **The artwork carries the state:**
   - a 4-bulb alarm bell over each door, glowing green → amber → red, with a wobble when it rings;
   - a raided room: police tape, a blue-red siren light, and a "CLOSED 2" sign counting down;
   - **Wanted** as 3 sheriff stars at the top of the screen;
   - the bank as a pile of money in the Vault, visibly shrinking;
   - the honesty meter against its two-thirds line.
4. **Info on everything:** one shared `InfoTip` component (tap on phones, hover and focus on desktop, ≥ 44 px target) on every icon, room, bell, perk, role name and meter, with one line plus "More". The text comes from content, so the UI, rulebook and tips never drift apart.
5. **"This game" rulebook:** only the roles dealt (or possible, per the role-list setting), the rooms in play, the events that can come up, and this game's 3 shop items. Reachable from anywhere in one tap.
6. **The ledger becomes a case board:**
   - **Evidence only.** Lock-in marks, presence, meeting-time proposals and other housekeeping move to the seats and the meeting panel. The ledger keeps public facts (coins taken, crew take, missing, bells, raids, Wanted, purchases, events), what you saw or learned, what people said (plans, pledges, alibis, role claims), and what the crew did (votes, shakedowns).
   - **Every entry shows how far to trust it:**
     - **Fact:** a solid card in print, from the game.
     - **Seen by you:** a solid card with an eye icon, from you or your power.
     - **Shared evidence:** stamped "from X's case file".
     - **Said:** a dashed outline in handwriting (plans, alibis, claims, pledges).
   - **Colour by type** (theme tokens only): money gold, noise and police red/blue, sightings blue, said grey, votes purple, events their card art.
   - **Three views of the same entries, one tap apart:**
     - **Rounds:** the default, newest open. Each round's header reads "Taken · Crew take · Missing · Honesty"; older rounds collapse to one line.
     - **Players:** a grid of players by rounds; each cell shows planned / claimed / seen.
     - **Rooms:** a grid of rooms by rounds, with bells, raids and claimed vs. seen visitors.
   - **⚠ "doesn't add up" flags, never verdicts:**
     - a claim contradicts what you saw;
     - a claim differs from the plan;
     - more claims than a bell allows;
     - a role claimed twice.

     A **"Show only ⚠"** filter lists the open questions. The checks are pure functions over your own view, with tests.
   - **Dossiers:** tap a player for their row, claims, votes, shakedowns, ⚠ count and your own tag and notes. Tap a room for its bell history, raids and visitors.
   - **Filters:** player, room, round, type, "first-hand only", "⚠ only".
   - **Pins: your own evidence board.** Pin any entry (or row) to your private board, alongside your trusted / unsure / suspicious tags and notes.
   - **A "Full log" tab** keeps the raw chronological list.
   - **On phones,** Rounds and dossiers are the default; the grids scroll sideways inside their own frame, so the page never overflows.
   - **Built only from your own `viewFor`:** nothing new is revealed, it's only shown better.
   - **The usability test for S2:** a new player can answer "who might have stolen in round 4?" within about 10 seconds, starting from the Rounds view and following one ⚠.
7. **Teaching pop-ups and Tips:**
   - A short card ("What just happened / What it means / What you can do") the first time each thing happens: a bell rings, a raid, the crew one star from a bust, a power cut, a shakedown, coins go missing, your first chance to use your power, the shop affordable.
   - Controlled by a per-user **Tips** setting, **on by default**, kept on the user (guest or Google account) so it follows them across games.
8. **Opponents' roles:**
   - The roles-in-play strip opens each role's full card, including "How to spot it".
   - When something happens that a role could cause, the explanation names the candidates ("a room rang with nobody claiming it: the Mole, or someone lying").
9. **The reveal** replays each round's plan against what everyone really did.

**UI rules still apply** (`CLAUDE.md`, `docs/ui-style.md`): one notebook look, theme tokens and shared components only, new components in `/dev/gallery`, checked at 360/390/768/1024/1280 px.

---

## Order of work

**Approach (owner, 4 Nov):** the live game has no real players, so R7 is built **straight on `main`** with no concern for downtime: no integration branch, no feature flags, no R6 path kept alive. The goal is a codebase **and** docs set with nothing dead, bloated or out of date in them.

| Step | What | Checkpoint |
|---|---|---|
| **S0** | Record the 4 Nov decisions; **clean the docs** so every live `.md` describes R7 only. | Reviewer + QA |
| **S1** | Spec freeze: `docs/design.md` becomes the single spec. | **Owner approves the spec** |
| **C** | **Clean the code** (audit, then delete), before any R7 code. Runs alongside S2. | Reviewer + QA approve the audit; owner sees a one-page summary |
| **S2** | Mockups of 5 screens (Design artifact type), no code. | **Owner approves the mockups** |
| **S3** | The new rules (engine, content, bots, sim) ∥ interface foundations. Replace, don't add. | Reviewer + QA per PR |
| **S4** | Wire the screens (Part B); "Learn the game" as its own PR. | **Owner tries a test deploy** |
| **S5** | Final dead-code audit by a fresh agent, balance pass, deploy. | **Owner playtests** |

Three cleanup rules hold from start to finish:
1. **Replace, don't add.** A PR that supersedes R6 code deletes it in the same PR. No flags, fallbacks, compatibility shims, "legacy" folders or commented-out code.
2. **Docs say only what is true now.** Anything no longer applicable leaves the live docs. History lives only in `docs/archive/` (and git); nothing live links to it as guidance.
3. **No placeholders for Advanced.** Advanced gets seams (A12), not stub code.

"Straight on `main`" means each PR merges into `main` through the usual gate (`CLAUDE.md`: never push to `main`); there is just no integration branch.

---

## How to run it: orchestrator and agents

### Roles and models

| Agent | Model | Does |
|---|---|---|
| **Orchestrator (PM)** | Opus 5.5 | Plans, writes briefs, merges via the gate, folds `## Decisions` / `## STATUS updates` into docs, reports to the owner. Never writes code. |
| **Developer** | **Sonnet 5.5** for well-specified work; **Opus 5.5** for engine rules (see below) | Builds one task per PR (`docs/pipeline/builder.md`). |
| **Reviewer** | Opus 5.5 | Reviews a PR from the diff (`reviewer.md`). Never merges, never pushes. |
| **QA** | Opus 5.5 | Adversarial tests, pushes once, posts the verdict (`qa.md`). Never merges. |

**Sonnet or Opus for the developer?** Sonnet 5.5 is the right default for tasks the spec and mockups pin down: components and screens, content edits, copy, CSS, docs, mechanical refactors. It's faster and cheaper, and an Opus reviewer and an Opus QA agent check every PR. Use **Opus 5.5 for the developer** on:

- engine rule changes (S3a), where determinism, visibility and `viewFor` leaks are subtle and a mistake is expensive;
- the case board's data layer and its ⚠ checks (it must use only `viewFor`);
- bot changes;
- any fix round where a Sonnet build failed review twice.

The orchestrator picks the model per task and says which in the brief (Agent tool `model: "sonnet"` or `model: "opus"`).

### Kickoff prompt for the new chat

> You are the PM/orchestrator for Skimjob (github.com/EssenKay-Studios/Skimjob, Project "Heist And Coop"), running milestone **R7 Simplified** from `docs/simplified.md`. Don't write code yourself: delegate every task to subagents in the pipeline builder → reviewer + QA (in parallel) → merge. Developers are Sonnet 5.5 by default and Opus 5.5 for engine rules, the case board's data layer, bots, or a twice-failed fix (pick per task, as the plan says); reviewers and QA are Opus 5.5.
>
> Start by cloning the repo and reading CLAUDE.md, docs/simplified.md, docs/STATUS.md, docs/decisions.md, docs/pipeline/HANDOFF.md and the briefs in docs/pipeline/ ("Where you run" in common.md). Rebuild the live state from GitHub: list open PRs and run `bash docs/pipeline/verdicts.sh <PR>` on each. Treat agents from earlier sessions as dead.
>
> Begin with step S0 (record the agreed decisions and clean the docs), then S1, then the code cleanup (C) alongside the mockups (S2). Build straight on main: no downtime concerns, no R6 code kept alive. Owner checkpoints in the plan are hard stops: don't pass one without my approval.
>
> Run builds and tests on my Mac when it's reachable; otherwise work in the cloud and rely on CI. Merge only with `docs/pipeline/merge.sh <PR>` when the latest head has a reviewer APPROVE, a QA PASS and green CI; only you merge. Commits are authored as karthik24iyer <karthik24iyer@gmail.com>, with no Claude co-author or session lines.
>
> Send me a short update about every 15 minutes, and ask me only for real decisions, as multiple-choice questions with a recommended option.

### Step by step

**S0 — record decisions and clean the docs (PM docs PR, reviewed and QA'd).**
- Write Part A into `docs/decisions.md` as the current decisions. Every R6-era entry that R7 overrides or makes moot is **removed** from it (git and `docs/archive/decisions-history.md` already hold the history), including the "listed in the archive" pointers to old provisional readings; `decisions.md` ends up short and R7-only.
- Go through **every** live `.md` (CLAUDE.md, STATUS, HANDOFF, the pipeline briefs, testing, deploy, ui-style) and remove or rewrite anything that no longer applies: R6 rules and numbers, tokens, Heat, Duel, Quick, the cut roles, old follow-ups, finished-milestone detail beyond a one-line record. STATUS keeps only: where things stand, the R7 task list, open items.
- Fold in the review notes from #69: crew take vs. the kitty and seized coins (A4/A5), the end-of-round order, Books mode.
- Ask the owner only about genuinely new questions.

**S1 — spec freeze (docs only, one Opus developer).**
- Rewrite `docs/design.md` as the **single** rules spec from Part A: rooms and coins, bells, raids and busts, the bank and the end, equal shares and the kitty, honesty and winning, meetings and shakedowns, the plan board, roles, perks, events. Nothing from R6 that R7 drops stays in it.
- Move `docs/extension.md`, `docs/m2-plan.md` and `docs/balance/r6-balance.md` to `docs/archive/`; fix every reference (including code comments citing "extension.md" or old design sections).
- Add a **"Content text"** section: the one-line texts for every room, role ("power", "How you win", "How to spot it"), perk and event, read by the UI through content.
- Set the S5 balance gates.
- Owner approves the PR.

**C — clean the code (before any R7 code; runs alongside S2).**
- **C1 Audit (one Opus agent; deletes nothing).** Its PR adds only the checker and the audit file. Run a dead-code checker (`knip`, added as a root dev dependency) across every workspace, then read each area by hand. Produce `docs/cleanup-audit.md` (deleted again at S5) sorting every file and module into:
  1. **Dead now:** nothing uses it.
  2. **Cut by R7 regardless:** Duel, Quick, Cleaner/Bagman/Muscle, the dropped events (A11.1), the Server room's old power, the old bot fallbacks, v0.1 number testkits, anything only they use.
  3. **Replaced in S3/S4:** Heat arithmetic, loot formulas, acts and checkpoints, tokens, the R6 shop, the R6 ledger/case file/suspicion board. Each is assigned to the S3/S4 PR that deletes it.
  4. **Keep:** seeded RNG, event log and reduce, visibility and `viewFor`, meetings and voting, chat, server, lobby, auth, scheduler, host controls, the UI kit, the art.
  Plus a **test audit:** duplicated coverage between `*.test.ts` and `*.qa.test.ts`, tests of removed rules, slow tests with no unique value.
- **The reviewer and QA review the audit itself** (their verdicts on the audit PR), and the owner gets a one-page summary (for information, not a hard stop). Deletion starts only after both pass.
- **C2 Delete lists 1 and 2** in about four PRs: engine + content + bots + sim; server; web + e2e; test consolidation. Sonnet developers (Opus for the engine PR). After each, the game still runs (R6 minus the cut features).
  - Reviewer: every deletion is on the approved audit; nothing on the keep list changed behaviour.
  - QA: full suite on the Mac, the 12-seat game, a sim smoke, and one game played start to finish.
- **C3 Guardrails, permanent:** the scoped test setup (see "Test plan" below); `knip` in CI fails on unused files, exports or dependencies; each PR body reports lines added/removed per package; `builder.md` gets the three cleanup rules; `reviewer.md` checks them.

**S2 — mockups (no code).**
- One agent (Opus) creates the mockups from the **Design** artifact type, with the notebook look from `docs/ui-style.md`:
  1. the game screen on a phone and a laptop: the board with coins, bells, tape and Wanted stars, the "This round" panel with the coins-into-two-bags move, and the plan board;
  2. the case board's Rounds, Players and Rooms views, with ⚠ flags and pins;
  3. a role card and the "This game" rulebook;
  4. a teaching pop-up and a tip;
  5. the black market and a shakedown result.
- The owner comments and approves. Approved mockups are linked from STATUS and are the reference for S4 reviewers.

**S3 — two tracks in parallel, straight on `main`.**
- **(a) New rules (Opus developers, one area per PR, in order):**
  1. rooms, coins and grabs;
  2. bells, cooling (including the Rooftop's automatic cooling), raids, Wanted, and the bust with the Rooftop escape;
  3. the bank, round cap and endings;
  4. equal shares, the kitty, fair share, missing and honesty;
  5. meetings at bank thirds and briefings, and shakedowns against the fair share;
  6. roles (A8), with powers and frequencies, including the Mole and Fixer's win rule in their handlers (A12 seam 4; step 4 builds the ending without it);
  7. perks and the shop (A9);
  8. the 4-card event deck at a 4-in-10 chance;
  9. the plan-board snapshot as a public event.

  Each PR deletes the R6 code it replaces (its audit list-3 items), updates bots and the sim's metrics for its rule, adds its events to the leak scrub and property tests, and runs a sim smoke. The web app may show the old screens against new rules in between; that is fine.
- **(b) Interface foundations (Sonnet developers):**
  1. `InfoTip` + content-text plumbing, in `/dev/gallery`;
  2. the one-screen layout shell and bottom sheets at all five widths;
  3. the per-user Tips setting (one field on the user, default on);
  4. the plan board's live server channel (like chat);
  5. the case board shell: views, filters, pins (data from a typed adapter, filled in S4).

**Seams for Skimjob Advanced:** every S3/S4 PR follows A12's ten seams; the reviewer checks them.

**S4 — wire the screens (Sonnet for UI, Opus for the case board's data layer):**
1. the board art (bells, tape, Wanted, the bank pile);
2. the move (coins into two bags) with previews;
3. the plan board UI;
4. the case board data and ⚠ checks;
5. role cards, the rulebook and opponents' explanations;
6. teaching pop-ups;
7. the black market;
8. the meeting and shakedown screens;
9. the reveal (plan vs. what happened);
10. **Learn the game**, the single-player guided mode (A11.3), as its own PR.

Each deletes the old screen, component, gallery page and e2e spec it replaces. Then a test deploy for the owner.

**S5 — final audit, balance and deploy.**
- **Final audit by a fresh Opus agent** that built nothing: `knip` clean, no R6 names left (tokens, Heat, acts, Duel, Quick, cut roles) in code, tests, content or live docs, every audit list-3 item gone; delete `docs/cleanup-audit.md`. Reviewer + QA pass it.
- One balance pass on the **Sim suite GitHub workflow**, never babysat in chat, against the gates set in S1 (heist success; raid and bust rates and Rooftop stalls; each role's win rate within a band; the share of all-honest wins; perks not deciding games). Tune the [tunable] numbers; refresh `docs/balance/baseline.json`.
- Deploy to Lightsail by `docs/deploy.md`: back up, then clear old games (R6 logs won't replay).
- The owner playtests again.

### Test plan: scoped per feature, full suite after merge

**Goal:** a PR waits only for the tests of what it touched, while `main` is still fully tested. Target: a typical PR's CI finishes in **about 5–8 minutes**.

**1. Feature tags, worked out from imports.**
- Every e2e spec carries exactly one feature tag in its title: `@board`, `@move`, `@plan`, `@caseboard`, `@meeting`, `@chat`, `@shop`, `@roles`, `@reveal`, `@lobby`, `@auth`, `@host`, `@learn`.
- `apps/web/e2e/features.json` maps only **entry points** to tags: screens and top-level panels on the web side, and the engine, bots and server modules that implement a feature (for example `packages/engine/src/meeting.ts` → `@meeting`, `apps/server/src/chat.ts` → `@chat`).
- For a changed file, CI follows the **import graph** up to the entry points that depend on it and runs the union of their tags. A shared module (`api.ts`, `router.ts`, game state, `InfoTip`) therefore runs every feature that uses it. If a changed file reaches **no** entry point, or **3+ tags**, CI runs everything.
- A CI check fails if any e2e spec has no tag or any screen/panel/feature module has no entry. Everything is in the repo, so nothing depends on PR-body text, and a re-push re-runs it.

**2. What a PR runs (the `changes` job decides from the diff):**

| Changed | Runs |
|---|---|
| Docs only | Typecheck, unit tests (as today) |
| Any code | Typecheck and `knip` across the repo (fast); unit, property and server tests **only for changed packages and those depending on them** (`pnpm --filter "...[origin/main]"`); the always-on `@smoke` e2e (2 specs: create a game, play one round with bots, finish); the tags from step 1 |
| Engine, content or bots | Also the engine property tests and the `viewFor` leak scrub (always, whichever rule changed), and a **50-game** sim smoke at 3/6/12 players |
| Server | Also `@lobby @host`; the live channel or store (`live.ts`, `store.ts`, `db.ts`) count as shared and run everything |
| Shared kit (`theme.css`, `SketchFrame`, `Button`, layout shell), any root or workspace config (`package.json`, lockfile, `tsconfig*`, `vitest`/`playwright` config, `.github/`, `scripts/`), `features.json` or the scoping script itself | **Everything** (the full tier) |

A single always-on **"CI ok"** job depends on all the others and passes when each either passed or was deliberately skipped; branch protection and `merge.sh` gate on it.

**3. The full tier runs on every push to `main`** (after each merge), nightly, and at owner checkpoints (S4 test deploy, S5): all unit tests, all e2e on 6 shards (including the 12-seat game), and the 200-game sim smoke.
- If a post-merge run fails, the orchestrator **stops merging** until a fix-forward PR (with a test that would have caught it in the scoped tier) is green.
- `features.json` gets the missing mapping, so the same gap can't recur.

**4. Lean tests, rebuilt with the features.**
- Rules are tested in the engine (fast, deterministic, citing the design section), not through the browser.
- e2e covers user journeys only: per feature, one happy path plus its key edge cases, at 360 and 1280 px; the full tier adds the five widths.
- Each R7 PR **replaces** the specs for the feature it rebuilds. QA's adversarial cases go in `<feature>.qa.spec.ts` under the same tag, never a parallel copy of the normal spec.
- Bot games in e2e use the fastest timing preset and a fixed seed. Only the full tier runs 12 seats.
- CI caches the Playwright browser and pnpm store.

**5. Review and QA stay solid:**
- **Reviewer:**
  - checks that `features.json` has an entry for every new screen, panel or feature module, and that the scoped run listed in CI covers the change;
  - that each new rule has an engine test naming its design section;
  - that each new event type is in the leak scrub;
  - that deleted R6 tests went with their code.
- **QA:**
  - runs the PR's scoped set on the Mac (`pnpm test:scoped`, which uses the same diff logic as CI, plus `--workers=2` for the browser);
  - writes adversarial tests inside the feature;
  - for engine PRs, also a 200-game sim run locally.
- **The gate** is unchanged: APPROVE + PASS on the head, green scoped CI. The full tier on `main` is the safety net, not the gate.

**Built in step C (C3):** the tags, `features.json` with its coverage check, the import-graph scoping script, `pnpm test:scoped`, the "CI ok" job, and the post-merge/nightly full tier; plus the docs that describe testing (CLAUDE.md, `docs/testing.md`, `builder.md`, `qa.md`, `reviewer.md`, `common.md`) updated in the same PR. They land before any R7 code, so every R7 PR uses them.

### Rules learned on 3 Nov (put in every brief)

- **Build and test on the Mac** (18 cores) when reachable; the cloud box has 2 cores.
- **Run only the scoped set** (`pnpm test:scoped`, see the Test plan), `pnpm typecheck` before pushing, **push once**; the full suite runs on `main` after the merge.
- **At most 2 browser games at a time** (Playwright `--workers=2`): 10 parallel 12-seat games on a busy Mac produced a false failure.
- **Review and QA start together** as soon as a PR opens. **Hard time limits** in every brief (builder 30–50 min, reviewer 10–30, QA 15–35).
- **Only the orchestrator merges.** Reviewer and QA agents never merge, even when the gate would pass.
- **Every bug fix adds a test** that would have caught it (`docs/testing.md`).
- **Verdicts name a sha;** a rebase or a non-QA-test commit needs a delta re-review.
- **Branch deletion after a merge can fail from a cloud session;** delete it from the Mac.
- **Lightsail:** never touch Arcway; take a `pg_dump` before any database change; no secrets or connection details in the (public) repo.

## Out of scope for R7

M2-14 and M2-15 (parked), M3 (Flutter, push, quiet hours), M4 (more content), and **Skimjob Advanced** (`docs/advanced.md`), the later paid version.
