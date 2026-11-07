# Skimjob Advanced: plan

*4 Nov 2026 · Karthik (owner) + PM. Status: **direction agreed, not built; starts after R7 Simplified (`docs/simplified.md`) is built and playtested.** A separate, paid version of the game. It replaces the original jobs redesign, archived word for word in `docs/archive/rebuild-2026-11-02.md`.*

## The idea in one paragraph

Skimjob (R7) hides **who you are**: roles are secret, and the system shows the facts (every room's bell, how many coins left the bank, how many went missing, the honesty meter). **Skimjob Advanced flips it: every role is public, and every player has a task.** Roles are **announced at the start** and can **change hands mid-game by a crew vote**. Most of the facts R7 shows are instead seen privately by the player whose job it is, who publishes them for the crew, and **can fake them**. The only place to cheat is the job itself (and the pocket). The question stops being "who is the Mole?" and becomes "is the Teller's count true?". Rooms, coins, bells, raids, the bank, equal shares, perks, meetings, the plan board and the case board are R7's.

**What it adds:** the strongest hook of the original redesign. The crew relies on records that its own members keep, and any record keeper might be lying.

## What changes from R7

### Every role is public

- **The deal is announced:** every player gets one role, and everyone sees who holds what from the start. No secret roles exist in Advanced.
- **Every player has a task:** each role has a job to do each round or between meetings (see a fact, publish a record, act on a room). A player who doesn't file is visible at once, and that is what looks suspicious.
- **Role swap:** at a meeting the crew can vote to move a role to another player (instead of a shakedown), for example after two missed or doubtful filings. The new holder takes over from the next round; what the old holder gets is open question 4.
- **Up to about 10 roles in play,** one per player, scaled by crew size.

### Advanced has its own role list

Roles that only work in secret (in R7: the **Mole, Fixer, Electrician, Priest and Hacker**) are **left out of the Advanced ruleset or redesigned as new handlers**. New roles are added so every player in a 10-player game has a job. The list is designed when Advanced starts; candidates:

| Role | Sees privately | Publishes | Checked by |
|---|---|---|---|
| **Teller** (new) | Coins that left the bank | "Taken this round: N" | The duffel split (everyone's share), the Auditor, the Detective |
| **Bellkeeper** (new) | Every room's bulbs | Each room's bulbs | Raids (a room raided at "2 bulbs" exposes a lie), the Lookout |
| **Lookout** (from R7) | Who was in a room | The sighting | Other sightings, claims |
| **Detective** (from R7) | Coins one player grabbed | The finding | The Teller's count, the duffel split |
| **Auditor** (redesigned from R7) | Whether a player's hand-in adds up | The audit | The duffel split |
| **Camera keeper** (from the Hacker) | The camera feed for a room | Who the camera saw | The Lookout, claims |
| **Getaway driver** (new) | Who reached the Rooftop | The roll call | Claims, the bells |
| **Fence** (new) | Black-market purchases | The purchase log | The shop's public "a perk was bought" |
| **Security** (from the Electrician) | Power cuts and blackouts | Its own blackouts | The Bellkeeper, the cameras |
| **Clerk** (new) | Real ballots in Secret vote mode | The tally | The meeting result |

The Locksmith and Smooth Talker may carry over as public perks of a role rather than roles of their own.

### Facts that become private to a role

| Fact | R7 | Advanced |
|---|---|---|
| Every room's bulbs | Public | Private to the Bellkeeper. Raids stay public: the tape on the door is real. |
| Coins taken from the bank this round | Public | Private to the Teller. |
| Coins missing this round, and crew honesty | Public | Not shown; the crew works it out from the records and what each player received. The true honesty is revealed at the end. |
| Sightings, cameras, Rooftop roll call, purchases, ballots | Per R7 role or public | Private to the role that sees them, published as records |
| Your own share, raids, Wanted | As R7 | As R7 |

Each player still sees **their own share** each round, so the duffel split is always known exactly (share × players + kitty). That makes the Teller's count checkable and turns "N missing" into a deduction instead of a display.

### Records

- **Filing:** each role publishes during the next round's planning through one record form (its fields come from the role's content). A late or empty record leaves the crew blind for that round and is shown on the role's seat.
- **No pay for roles** (R7's principle: nothing pays anyone to be nice). A holder files because they want the heist to work, and because a missing record makes them the suspect.
- **The case board** shows each record at its own trust level, "Reported by the Teller", with the role's badge. The ⚠ checks compare records with each other and with your evidence: "the Teller says 12 taken, but the duffel split is 9", "the Bellkeeper said the Office was at 2, then it was raided".

### Events

R7's **Inside tip** card (learn a player's role) has no use when roles are public, so Advanced drops it and deals the other three cards (Lockdown, Shift change, Audit). *Confirmed (owner, 6 Nov).*

### Winning

As R7: on success, the biggest stash wins; a heist sunk by theft has no winner. Role-specific wins in R7 (the Mole and Fixer) don't exist in Advanced, since those roles don't.

## Parity with R7, and the effort

R7 is built with ten seams (`docs/design.md` §19.2) so Advanced is mostly content. The ones that matter most here:
- which facts are public is content (seam 1);
- each ruleset brings its own role list, and role-specific win rules live in role handlers (seams 3–4);
- whether a holder is announced, and whether a result is private or filed, is a per-role content setting (seam 7);
- deal counts come from content (seam 8);
- holding a role is an event, so roles can change hands (seam 9);
- meeting motions register by id, so the role swap is one more motion (seam 10);
- records are one generic command, with per-role trust levels on the case board (seams 2 and 5).

| Area | Shared with R7 | New for Advanced |
|---|---|---|
| Engine | Rooms, coins, bells, raids, bank, shares, perks, meetings, endings, the deal, role handlers' framework | Handlers for new and redesigned roles, the role-swap motion, missed filings |
| Content | Rooms, perks, events, texts framework | The Advanced ruleset: its role list, per-role visibility, record formats, texts |
| Bots | Framework, reading `viewFor` | Doing each new role's task, filing (and sometimes faking) records, judging others' records, voting swaps |
| Simulator | Everything | Metrics on lies told and caught, swaps |
| Server | Everything | Filing deadlines (like alibi windows), the Advanced setting and paid access |
| Web | Everything | The record form (generic), role badges and the "Reported by" levels, the swap vote, a Learn chapter |

**Rough size:** about **70–80% shared**. The new work is **added code**: about 40–50% of R7's size measured in PRs (about 15–20 PRs, against R7's 30–35), about 3–5 days of agent work through the same pipeline, mostly content, role handlers and bot behaviour. Edits to existing R7 code stay small: registering the new pieces plus the pre-approved general extensions listed under "Additive only" (point 2), roughly 1–2k lines in all, against several times that added. **It is not a rewrite**, provided R7 keeps A12's seams; if they're skipped (for example roles fixed at setup, or the Mole's win in the end-of-game code), R7 code has to be found and reworked, which roughly doubles the cost.

## Additive only (owner, 4 Nov)

Advanced **adds** to R7 and does not replace it. R7 stays a complete game on its own, and every Advanced PR keeps it that way:

1. **New code goes in new files:** the Advanced ruleset in content, new and redesigned roles as new handlers, the record command, the swap motion, bots for the new roles, the record form and badges. R7's roles (the Mole, Fixer and the rest) are never deleted or rewritten; the Advanced ruleset simply doesn't include them, and a redesigned role (for example the Advanced Auditor) is a separate handler. Roles marked "from R7" (the Lookout, Detective) reuse their R7 handler, made announced and filed by seam 7's content setting, not copied.
2. **R7 code changes only at registration points and pre-approved general extensions.**
   - **Registration points:** the registries for rulesets, roles, perks, events, motions, trust levels, ⚠ checks and record formats.
   - **Pre-approved general extensions** (A12 defers these paths to Advanced, so R7 holds none of their code):
     - seam 1's private-to-a-role visibility value in the fact helper and `viewFor`;
     - seam 7's announced-holder deal and result-into-a-record routing in the deal, the role framework and `viewFor`;
     - the seat's role badge and missed-filing marker;
     - the lobby's mode choice;
     - the scheduler's filing deadline;
     - the paid-access gate.

     Each is built generically, driven by content, and backward-compatible: R7 behaves exactly as before.
   - **Any other change to an R7 file** needs a written reason in the PR body and the orchestrator's approval, and is made the same way, as a general extension (a new seam), never as an Advanced-specific branch.
3. **R7's whole test suite passes unchanged on every Advanced PR.** Because extensions stay backward-compatible, no R7 test is edited or deleted; new tests are added alongside. CI runs the full suite on every PR.
4. **Reviewers reject** an Advanced PR that rewrites R7 behaviour, branches on the ruleset's name, or touches R7 files beyond point 2 (or its approved exceptions). Each PR body lists its edits to existing files.

## Paid version

- **One codebase and one server.** Advanced is a game mode chosen in the lobby, available when the host's account has access. Players who join a host's Advanced game don't need to pay (to be decided).
- **Payments are out of scope until Advanced is built:** web checkout first (for example Stripe), app-store purchases with the Flutter apps (M3). Google sign-in already gives a stable account to attach access to.

## Open questions (for when Advanced starts)

1. Should players who join a paid host's game get Advanced free?
2. The final role list: which candidates above, and how many per crew size?
3. Does the crew see the true honesty meter at meetings (a strong check on the Teller), or only at the end?
4. On a role swap, does the old holder take the other player's role, or a spare one?
5. In 3–4 player games, does a player hold two roles, or do some roles sit out?

## Order of work (after R7 is playtested)

1. Spec: an "Advanced" section added to `docs/design.md`.
2. Engine and content: the Advanced ruleset and its roles, hidden facts, filing, missed filings, the role swap.
3. Bots and the simulator.
4. Web: role badges and tasks, the record form, "Reported by" in the case board, the swap vote, a Learn chapter.
5. Paid access, then a playtest against R7 with the same group.

The run method is the same as R7's (`docs/simplified.md`, "How to run it").
