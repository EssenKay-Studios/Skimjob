# Skimjob Rebuild: jobs design, master plan and rework review

*2 Nov 2026 · Karthik. Proposal, not approved for build. Companion proposal: [`extension.md`](extension.md).*

## Summary

The Rebuild turns Skimjob from a game of secret role powers into a game of **public jobs**. Each player keeps one of the crew's records by hand, may lie in it, and the crew polices the liars by vote.

*Names used here:* **the current game** is Skimjob as it stands, including the changes in [`extension.md`](extension.md). **The Rebuild** is this proposal, which would replace them.

- **What changes from the current game:** no acts or checkpoints; no secret roles or factions; Haul and Heat are no longer shown by the app; a fixed bank that runs out; a duty-point perk shop; one possible Rat recruited by the cops mid-game.
- **What stays:** the core round (pick a room, split the loot), alibis, shakedowns, meetings, chat, no elimination, one winner.
- **Rework:** about half the source code and most of the rules tests would change. The engine's foundations, the server, chat and art carry over. Every balance result so far would have to be redone.
- **Bottom line:** the Rebuild has the stronger hook, but nothing yet shows players prefer it. The current game is close to a playable demo. Playtest both before rewriting anything (see the last section).

## The game in one minute

*Steal from your crew — just don't sink the job.* A crew robs one bank together. The biggest stash wins, but only if the heist succeeds. Each player also holds a public job, keeping one of the crew's records, and every record can be faked.

- **Players:** 4–15+, with bots to fill seats. 4–5 players double up on jobs, and 11+ get duplicate jobs.
- **Length:** set by the host as a time limit. Shifts run back to back with no acts. Meetings happen when the crew needs one.
- **Where:** browser or app. Talk happens in the in-app chat, on WhatsApp or in person.

A session runs like this:

1. **Setup.** The seed picks which jobs are in play, then jobs are dealt at random or drafted. Everyone sees who holds which job.
2. **Shifts.** Everyone secretly picks a room and splits its loot between the Haul and their own stash. Job holders get their private feeds.
3. **Between shifts.** Players post alibis, and job holders file their records and earn duty points. Players can buy and use perks.
4. **Meetings.** These come at the Driver's call, by petition, by emergency, or when enough accusations pile up. The crew argues using the records, then votes on motions: shake someone down, swap jobs, a non-binding poll, or the getaway.
5. **The end.** The crew votes to leave, the cops raid, the bank runs out, or time is up. Then comes the reveal: every real number, every feed, every lie.

## Jobs

Every job is public. Each one gets a private raw feed, publishes a record the crew relies on, and is checked by at least one other record. The game never checks whether a record is accurate. Duty points are starting values for the simulator.

| Job | Sees privately | Publishes | Checked by | Duty points |
| --- | --- | --- | --- | --- |
| Banker | How much the Haul changed each shift | The books (Haul total, what went missing) | Fence, Inside Man, alibis | 2 per shift |
| Scanner | Each shift's Heat changes as numbers, never the total | Current Heat | A second Scanner, Situations | 2 per shift |
| Inside Man | Loot left in each room | Remaining loot per room | Banker, Fence | 1 per shift |
| Fence | The crew's combined stash total | Total pocketed so far | Banker | 1 per shift |
| Lookout | One chosen room's camera, after alibis are posted | Who was in that room | Whoever was in that room | 1 per shift |
| Hacker | Door logs: headcount per room, no names | Headcounts | Alibis, Lookout | 1 per shift |
| Clerk | Every real ballot (secret ballots only) | Who voted for whom | Each voter's own vote | 2 per meeting |
| Detective | Accusations filed privately | The case board; sets the meeting agenda | Whoever filed each accusation | 2 per meeting |
| Driver | The next Situation, one shift early | Meeting and getaway schedule; only one who can call special meetings | Petition override, job swap | 2 per meeting |
| Lawyer | Sealed private statements | A defence at each shakedown | The other records | 1 per meeting, +1 per defence |

**Who is in play**

- **Always dealt:** Banker, Scanner, Driver.
- **From 5 players:** one Banker check as well, either the Fence or the Inside Man, at random.
- **The rest** are drawn at random from the remaining jobs.
- **11+ players:** jobs are duplicated in this order: Banker, Scanner, Lookout, Hacker, Detective.
- **4–5 players:** some players hold two jobs.
- **Handing out:** the seed decides which jobs are in play. The host then picks random dealing (the default) or a draft in random order.

**Fallbacks when a job isn't dealt**

- No Clerk: ballots follow the host's vote-visibility setting.
- No Detective: the Driver sets the agenda.
- No Lookout or Hacker: no cameras or door logs.
- No Inside Man: remaining loot stays hidden.
- No Lawyer: shakedown targets defend themselves.

Filing on time earns the job's duty points. An empty or late record earns nothing, and the crew is blind for that shift. If a holder misses two filings in a row, the job is offered to another player.

## Shifts, rooms, the bank and Heat

The bank holds a fixed amount of loot that runs out as rooms are looted, and Heat climbs every shift, so a crew that stays too long gets raided.

**A shift**

1. **Plan in secret:** pick a room and a split (how much goes to the Haul, how much to your stash). Others see that you've locked in, never your choice. A missed move means the Lobby, with everything handed in.
2. **Resolve:** loot moves, Heat changes, and each player learns who else was in their room. Job holders get their feeds. The app publishes neither the Haul nor Heat.
3. **Alibis:** each player may post one, naming a room in play. It can be a lie.
4. **Filing:** job holders publish their records before the next shift ends.

A shift ends early once everyone has locked in. The host sets shift length; shifts pause while a meeting is open.

**Rooms.** Each visitor takes up to the room's yield per shift, while loot lasts.

| Room | Yield per visitor | Effect | Players |
| --- | --- | --- | --- |
| Vault | 6 | Raises Heat | All |
| Office | 4 | — | All |
| Lobby | 2 | Where missed moves go | All |
| Security | 0 | See who was in one room | All |
| Rooftop | 0 | Lowers Heat | All |
| Deposit boxes | 5 (4 each if more than 2 visit) | Raises Heat | 5+ |
| Server room | 0 | Learn how many pocketed, not who | 5+ |
| Teller line | 4 | — | 9+ |
| Manager's office | 4 | Raises Heat (half the Vault's) | 9+ |

**The bank.** It starts with about 30 × crew size, spread across the loot rooms, with the Vault the richest. When a room is empty it pays nothing. Only the Inside Man sees what's left. Everything ever taken out, minus the Haul, is everything pocketed: one number that catches skimming across the whole game. The exact total and split are for the simulator to set.

**Heat**, per shift:

- +4 every shift, no matter what. This is the game's clock.
- Vault: up to +20, by the share of the crew in it (a quarter of the crew = +5). Deposit boxes and Manager's office: up to +10.
- Rooftop: up to −20, by the share laying low.
- Situations, and the Anonymous tip perk.
- It never drops below 0. **At 100 the cops raid and the heist fails on the spot.** Only the Scanner sees the changes, and nobody is shown the total.

## Meetings and votes

The crew, not the game, punishes bad records. Every punishment goes through a vote at a meeting.

**How a meeting opens**

- **Regular:** the Driver schedules one. If no meeting has been held for about 3 shifts, the game opens one itself.
- **Special:** only the Driver can call one, often because players ask.
- **Petition:** if a third of the crew asks, a meeting opens without the Driver.
- **Emergency:** each player can call one per game. The Fire alarm perk adds one.
- Players who can't attend can leave a sealed vote. Shifts pause while a meeting is open.

**Motions (the game enforces these)**

| Motion | What happens if it passes |
| --- | --- |
| Shakedown | The target's stash is revealed and goes into the Haul. A stash under 6 is "clean": the crew pays the target 8 out of the Haul. |
| Job swap | Two players trade jobs. The removed player must take the other's job, so nobody is ever left without one. |
| Getaway | The game checks the real Haul against the target. At or above it, the heist succeeds; below it, the heist fails. |
| Meeting time | Locks the next regular meeting's time. |

**Polls** are on any question at all ("everyone to the Vault next shift?"). They are recorded but not enforced, and people can break them.

**Voting rules**

- Vote for a motion's target, or to skip. You can't vote for yourself.
- A motion passes if at least half the crew votes and it gets more than half of the votes cast.
- The game always announces the result itself. Ballots are secret when a Clerk is dealt, and otherwise follow the host setting.
- The Detective sets the order of motions. Anyone can propose a motion; the Detective decides when it comes up, but must bring it up in that meeting.

Shakedown numbers (6 and 8) and the getaway target are starting values for the simulator. Since nobody is shown the Haul, voting to leave is an act of trust in the Banker.

## Duty points and perks

Doing your job earns duty points, and points buy perks from a shop of 9: three to learn things, three to protect yourself, three to hurt others.

**Rules**

- Every perk costs 1, 2 or 3 points. Points are worth nothing at the end, so spend them.
- Each game deals 3 perks from each category of the pool below. If the Rat is on, Background check is always included.
- You can use a perk any time after buying it, at most one per shift. Information perks act instantly. Effects act on the next shift.
- An earned perk stays yours after a job swap.
- A used effect is announced ("the power went out") but never who caused it.

**Purchase visibility** (host setting): who bought is always public.

| Setting | What everyone sees |
| --- | --- |
| Open | Who bought, and which perk |
| Price only (default) | Who bought, and the price (1, 2 or 3) |
| Sealed | Only that a purchase happened |

**Perk pool**

| Category | Perk | Cost | Effect |
| --- | --- | --- | --- |
| Information | Tail | 1 | See which room one player went to last shift |
| Information | Tip-off | 1 | Learn whether anyone has accused you |
| Information | Peek | 2 | See one player's real stash |
| Information | Audit | 2 | See one job's raw feed for last shift |
| Information | Background check | 3 | Learn whether one player is the Rat |
| Protect | Lie low | 1 | Your visit adds no Heat next shift |
| Protect | Verified alibi | 1 | Your real room is marked verified for one shift |
| Protect | Fire alarm | 1 | Call a meeting without the Driver |
| Protect | Bribe | 2 | +1 vote on one motion |
| Protect | Bail | 2 | Your next shakedown takes half your stash |
| Protect | Clean hands | 2 | One shift's skim doesn't show in the Fence's total |
| Hurt | Anonymous tip | 1 | +5 Heat |
| Hurt | Lockdown | 2 | Close one room next shift |
| Hurt | Power cut | 2 | No cameras or door logs next shift |
| Hurt | Static | 2 | Scramble one job's feed next shift; its holder isn't told |
| Hurt | Gag | 3 | One player's vote doesn't count on the next motion |
| Hurt | Frame | 3 | Plant a fake sighting in the Lookout's feed |
| Hurt | Pickpocket | 3 | Steal 3 from another player's stash |

## The cops and the Rat

The cops aren't players; they are the game. They act in two ways: the raid at Heat 100, and one secret offer to turn a crew member into the Rat.

- **When:** at a hidden, random moment between about 20% and 40% of the host's time limit.
- **To whom:** one random player, privately.
- **Refusing:** allowed. The cops quietly try another random player next shift, up to two more times, then give up. Nobody is told who refused, so nobody can be sure a Rat exists.
- **The Rat's goal:** wins if the cops raid. Stash doesn't matter.
- **On accepting:** the Rat gets 3 duty points of informant money and keeps their public job.
- **Host setting:** *maybe* (the default, as above), *always* (the first offer must be accepted) or *off*. At 12 or more players, up to two offers can succeed. Two Rats learn each other.

The Rat has no special powers. Their weapon is their job (a Scanner who plays Heat down, a Banker hiding the shortfall) plus harmful perks, which anyone can also buy.

## Situations

One Situation happens at the start of each shift from shift 2 on, and the Driver sees it a shift early. Some Situations have the same effect as a perk and are announced the same way. That gives the harmful perks cover, because the crew can't tell bad luck from sabotage.

| Situation | Effect this shift | Same announcement as |
| --- | --- | --- |
| Police patrol | Heat +5 | Anonymous tip (as a Heat change the Scanner sees) |
| Quiet night | Heat −10 | — |
| Shift change | The Vault pays double, with 1.5× its Heat | — |
| Payday | The Lobby pays 4 | — |
| Power cut | No cameras or door logs | Power cut perk |
| Lockdown | One room is closed | Lockdown perk |
| Audit | Everyone sees what went missing in each room | — |
| Raid rumour | The biggest stash secretly loses 3 | — |
| Double-cross | Two random players are offered a job swap; it happens only if both accept | — |
| Crossed wires | A random job's feed is scrambled; its holder isn't told | Static perk |

The Audit Situation is the only public check on the Banker that doesn't depend on another player. In crews under 5, Situation Heat is scaled down. Situations can be turned off in host settings.

## Winning, losing and the reveal

At most one player wins: the biggest stash on a successful heist, or the Rat on a raid.

| How the game ends | Result |
| --- | --- |
| Getaway vote passes, the real Haul meets the target, Heat below 100 | Heist succeeds: the biggest stash wins (the Rat too, if they hold it) |
| Getaway vote passes but the Haul is short | Heist fails: nobody wins |
| Heat reaches 100 | Raid: the Rat wins; with no Rat, nobody wins |
| The bank runs dry or time runs out | Counts as a forced getaway vote: the Haul is checked against the target |

- **Score** is your stash. There are no multipliers or role bonuses.
- **Ties** go to whoever was shaken down fewer times, then whoever handed in more. Players still level after that share the win.
- **On a failed heist**, the stash ranking is still shown, marked as a loss.

**The reveal.** Everything opens: the real Haul and Heat over time, every feed next to every published record (so each lie is shown), every room and split, every perk bought and used, and who was offered the Rat deal and what they answered.

## Host settings

| Setting | Options (default first) |
| --- | --- |
| Time limit | Hard stop for the whole game |
| Shift length | Set by the host; shifts end early once everyone locks in |
| Job handout | Random, or a draft in random order |
| Rat | Maybe, always, off |
| Purchase visibility | Price only, open, sealed |
| Vote visibility (when no Clerk) | Hidden until the meeting closes, open, secret |
| Situations | On, off |
| Quiet hours | No shifts resolve and no notifications go out |
| During the game | Pause, extend a shift, swap an inactive player for a bot |

The job system needs time to file records between shifts. I'd only offer it for games of a day or longer. Short games (15 minutes to 3 hours) would need a lighter mode, or stay on the current game.

## Drift review: what the rework costs

The Rebuild keeps the engine's architecture but replaces most of its rules. I estimate about half of the roughly 20,700 lines of source code would change, along with most of the 24,000 lines of tests, because the tests encode the rules. These are estimates from reading the `main` branch of the repo, not a line-by-line audit.

**What fits the Rebuild as it is.** The engine is already deterministic and event-sourced, with seeded randomness, content as data, and events tagged public, private or reveal-only, filtered through `viewFor()`. A job's private feed is just another private event. That is the expensive part to build, and the Rebuild needs it exactly as it is.

| Area | Source lines | Fate | Why |
| --- | --- | --- | --- |
| Engine core: RNG, event log, reducer, command handling, `viewFor` | ~1,000 | Keep | The Rebuild relies on private events even more than the current game |
| Engine round loop (`round.ts`) | ~370 | Change | Bank depletion; Haul and Heat move from public to private; perk effects |
| Engine meetings (`meeting.ts`) | ~460 | Rewrite | New motions (swap, getaway, polls), petition, agenda, no checkpoints |
| Engine acts, checkpoints, duel | ~100 | Remove | No acts in the Rebuild |
| Engine roles, factions, accomplices, dark side, claims, current perks | ~1,400 | Replace | Jobs, the duty-point shop and the Rat replace the 20-role deck |
| Content (rooms, roles, events, numbers) | ~790 | Replace mostly | Rooms survive; roles become jobs; events become Situations |
| Bots | ~1,400 | Rewrite | Bots must file records, compute books, decide when to lie, and buy perks |
| Simulator | ~2,500 | Change partly | The harness and parallel suite survive; metrics and every balance result start over |
| Server (lobby, identity, live socket, chat, scheduler) | ~2,300 | Keep mostly | The scheduler loses act windows and gains the Driver's scheduling and petitions |
| Web: chat, lobby, art, PWA, design system | ~4,500 | Keep | Art fits; the bank cutaway still works |
| Web: game and meeting screens | ~4,300 | Rewrite much of it | New: 10 job ledger forms, the shop, motions, purchase log; Haul and Heat leave the main screen |
| CI, Playwright setup | — | Keep | Most e2e scenarios need rewriting |

**What gets thrown away beyond code:** three balance passes and the R5 role-parity work, and the 20-role deck design. **New risks with no equivalent in the current game:** bots that lie believably, a ledger UI that works on a phone, and a crew blinded when a job holder goes quiet in an async game.

## Which version will people want to play?

No data exists for this exact choice. The outside evidence leans toward the Rebuild's core idea but warns against its biggest risk. My neutral read is that **the Rebuild is the more distinctive game and the current game is the safer one**, and only a playtest can settle it.

**Evidence that favours the Rebuild**

- "Everyone has something to do" is the main reason players say they prefer Blood on the Clocktower to Werewolf. Werewolf's plain villagers mostly guess, while every Clocktower player has an ability and information keeps flowing ([Draughts London](https://draughtslondon.com/mastering-blood-on-the-clocktower/), [Miami University class reflections](https://sites.miamioh.edu/tabletop/?p=3546)). The current game already gives everyone a role power, though. The Rebuild's real difference is that the work is *visible and shared*.
- Among Us gives crewmates tasks partly so they have something to do when they aren't talking to anyone. Players describe crewmates as more active than Werewolf villagers ([Mechanics of Magic](https://mechanicsofmagic.com/?p=15347), [Mechanics of Magic](https://mechanicsofmagic.com/?p=950)).
- "The person keeping the books might be lying" is a clear, theme-fitting hook. Secret Hitler's whole game rests on players relaying hidden information they are free to lie about ([official rules](https://secrethitler.io/rules)).

**Evidence that favours the current game, or warns about the Rebuild**

- In Captain Sonar, the closest game to "do the work by hand," reviewers report players fighting over the two lively roles while the others get passive, repetitive tasks ([Tabletop Gaming](https://www.tabletopgaming.co.uk/reviews/captain-sonar-review/)). The Rebuild's Hacker, Fence and Inside Man are at risk of feeling the same.
- Clocktower's flood of information can daunt new players and slow the game ([Mechanics of Magic](https://mechanicsofmagic.com/?p=25318)). It also relies on a human Storyteller, and the Rebuild has none.
- Async mobile sessions are short: the top mobile games average about 5–6 minutes a session ([GameRefinery on GameAnalytics data](https://gamerefinery.com/gameanalytics-studied-3-billion-mobile-gamers-5-things-know)). Filing a record every shift has to fit inside that, or it becomes homework. When one person goes quiet, the Rebuild blinds the whole crew; the current game only loses that player's power.
- On BoardGameGeek, heavier games are rated higher (about 35% of the variation in rating follows complexity) ([BG Data](https://bgdata.substack.com/p/bgg-complexity-and-rating)). But BGG users are enthusiasts. A casual friend group is a different audience, so this is weak support for either side.

**My read**

- The current game's problem, which you felt yourself, is rule load: 20 roles and their powers are invisible to everyone else. The Rebuild cuts rule load (one loop, one shop, public jobs) but adds *workload*. Players usually forgive work more readily than rules they don't understand, as long as the work is short and someone reads the result.
- The Rebuild is also more original. The current game sits close to existing hidden-role games; "a crew that keeps its own books" doesn't have an obvious competitor I could find.
- Neither of these is evidence that your friends will prefer it. That needs a playtest.

## Recommended next steps

Test the Rebuild cheaply before committing to the rewrite, and keep the current game moving so nothing is lost either way. The lighter version of the current game is described in [`extension.md`](extension.md).

1. **Finish the current demo (M2-15) as planned.** It is nearly done, and it is the baseline to compare against.
2. **Run the Rebuild as a paper prototype.** Play one 2–3 day game with 6–8 friends over WhatsApp. You act as the game: hold the true numbers in a private Google Sheet, DM each job holder their feed, and run votes as polls. That needs no code.
3. **Play one game of the current version with the same group** in the existing web prototype.
4. **Measure both the same way:**
   - Did each player open the game daily?
   - How long did filing take?
   - Could each player explain how they win?
   - Which moments did people talk about afterwards?
   - Which version would they play again?
5. **Decide from that.** If the Rebuild wins, rebuild on the existing engine, starting with content and rules and keeping the core, server, chat and art. If the current game wins, take the Extension's ideas into it.
