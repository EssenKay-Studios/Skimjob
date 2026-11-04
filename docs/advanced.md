# Skimjob Advanced: plan

*4 Nov 2026 · Karthik (owner) + PM. Status: **direction agreed, not built; starts after R7 Simplified (`docs/simplified.md`) is built and playtested.** A separate, paid version of the game. It replaces the original jobs redesign, archived word for word in `docs/archive/rebuild-2026-11-02.md`.*

## The idea in one paragraph

Skimjob (R7) has the **system** show the facts: every room's bell, how many coins left the bank, how many went missing, the honesty meter. **Skimjob Advanced hands some of those facts to players.** A few players get public **jobs**: they privately see one kind of fact and publish it for the crew, and they **can fake it**. Everything else (rooms, coins, bells, raids, the bank, equal shares, roles, perks, meetings, the plan board, the case board) is R7 unchanged. Advanced is R7 plus one layer, not a different game.

**What it adds:** the strongest hook of the original redesign. The crew relies on records that its own members keep, and the record keeper might be lying.

## What changes from R7

### Facts that become hidden

| Fact | R7 | Advanced |
|---|---|---|
| Every room's bulbs | Public | **Private to the Bellkeeper**, who publishes them. Raids are still public: the tape on the door is real. |
| Coins taken from the bank this round (the pile) | Public | **Private to the Teller**, who publishes the count. |
| Coins missing this round, and crew honesty | Public | Not shown. The crew works it out from the Teller's count and what each player received; the true honesty is revealed only at the end. |
| Everything else (your own share, sightings, votes, raids, Wanted, purchases) | As R7 | As R7 |

Each player still sees **their own share** each round, so the crew take is always known exactly (share × players + kitty). That's what makes the Teller's count checkable against the crew take, and what makes "N missing" a deduction instead of a display.

### Jobs (public, dealt on top of the secret roles)

| Job | Sees privately | Publishes each round | Checked by |
|---|---|---|---|
| **Teller** | Coins that left the bank | "Taken this round: N" | The crew take (everyone's share), sightings, the Auditor and Detective |
| **Bellkeeper** | Every room's bulbs | Each room's bulbs | Raids (a room raided at "2 bulbs" exposes a lie), rings people claim, the Lookout |

- **Who:** in 3–4 player games one player holds both jobs; from 5 players, two different players. The deal is random and public.
- **Filing:** a job holder publishes during the next round's planning. A late or empty record leaves the crew blind for that round. After 2 missed filings in a row, the crew can vote the job to someone else at the next meeting.
- **No pay for jobs** (R7's principle: nothing pays anyone to be nice). A job holder files because they also want the heist to work, and because a missing record makes them the suspect.
- **Job swap:** a meeting can vote to move a job to another player instead of a shakedown.

### What the case board does with records

Records are a new reliability level: **"Reported by the Teller"**, shown with the job's badge. The ⚠ checks compare them with your own evidence:
- "the Teller says 12 taken, but the crew take is 9 and nobody reports pocketing: 3 missing, or the Teller is lying";
- "the Bellkeeper said the Office was at 2, then it was raided".

That's R7's ledger with one more source type, built on A12's seam 2 in `docs/simplified.md`.

### Roles in Advanced

The same R7 roles. Some gain a second use against records; for example the Auditor's result can expose the Teller. No new roles are needed for v1.

## Parity with R7, and the effort

R7 is built with six seams (`docs/simplified.md` A12), above all:
1. **which facts are public is content, never hard-coded;**
2. **the case board's trust levels are generic;**
3. **rulesets select content, and nothing branches on the ruleset's name.**

With those in place, Advanced reuses almost all of R7:

| Area | Shared with R7 | New for Advanced |
|---|---|---|
| Engine | Rooms, coins, bells, raids, bank, shares, roles, perks, meetings, endings | The job deal, private feeds (a content switch on fact visibility), a `fileRecord` command and its events, missed filings, the job-swap motion |
| Content | Everything | Job texts, which facts are hidden in Advanced |
| Bots | Everything | Filing records and sometimes lying plausibly, reading others' records |
| Simulator | Everything | Metrics on lies told and caught |
| Server | Everything | Filing deadlines (like alibi windows), the Advanced setting and paid access |
| Web | Everything | The job panel and record form, the "Reported by" level in the case board, a Learn chapter for jobs |

**Rough size:** about **80–85% shared**. The new work is about 15–25% of R7's size: roughly 3–5k lines of source plus tests, about 10–15 PRs, 1–2 days of agent work through the same pipeline. **It is not a rewrite**, provided A12's seams are followed in R7. If they're skipped, every hard-coded "public" fact has to be found and reworked later, which roughly doubles the cost.

## Paid version

- **One codebase and one server.** Advanced is a game mode chosen in the lobby, available when the host's account has access. Players who join a host's Advanced game don't need to pay (to be decided).
- **Payments are out of scope until Advanced is built:** web checkout first (for example Stripe), app-store purchases with the Flutter apps (M3). Google sign-in already gives a stable account to attach access to.

## Open questions (for when Advanced starts)

1. Should players who join a paid host's game get Advanced free?
2. Does the crew see the true honesty meter at meetings (a strong check on the Teller), or only at the end?
3. Should a third job, the **Clerk** (sees real ballots in Secret vote mode and publishes the tally), join in larger crews?
4. Do 3–4 player games keep both jobs on one player, or drop the Bellkeeper there?

## Order of work (after R7 is playtested)

1. Spec: an "Advanced" section added to `docs/design.md`.
2. Engine and content: jobs, hidden facts, filing, missed filings, job swap.
3. Bots and the simulator.
4. Web: the job panel, the record form, "Reported by" in the case board, a Learn chapter.
5. Paid access, then a playtest against R7 with the same group.

The run method is the same as R7's (`docs/simplified.md`, "How to run it").
