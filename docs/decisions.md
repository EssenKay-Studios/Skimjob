# Decisions

The decisions that hold today, one short entry each with its why, grouped by topic. Each is **confirmed** (the owner decided or accepted it) or **provisional** (a PM or builder call, owner to confirm; STATUS "Questions for the owner" lists them). Rules themselves live in `docs/design.md` and, for roles, tokens and the shop, `docs/extension.md` (it wins on conflict); this file records the choices behind them. The full history (3 Nov 2026 and before) is in `docs/archive/decisions-history.md`.

Update in place: change or delete an entry when a decision changes; never add "was X" notes.

## Architecture and engine

- **One pnpm monorepo** (engine, content, bots, sim, server, web) so rule changes and their callers land together. *Confirmed.*
- **The engine is pure, deterministic and event-sourced:** seeded RNG only, no clock, state = fold over the log, content as data. It enables replays, the reveal, recaps, fair bots and mass simulation. *Confirmed.*
- **Visibility is fixed per event type in the type system** (`public`, `private`, `reveal`, `secret`). Private and reveal events open at the end of the game; `secret` (Secret-mode ballots) never does. The seed is only in a reveal-only `rngSeeded`. *Confirmed.*
- **`viewFor()` returns a deep copy, and a view's `seq` counts only what that player can see**, so nothing a client or bot holds can change the game or count hidden events. *Confirmed.*
- **Bots are players:** they get only `viewFor()`, emit normal commands, use their own seeded RNG (never the game seed) and rebuild suspicion from the view each time. Personalities are parameter sets in `packages/bots`, not content. *Confirmed.*
- **`GameConfig` holds only settings that change the rules;** session length, deadlines, pauses and bot replacement are the server's. Only resting phases are modelled; `advance` names the deadline that passed. *Confirmed.*
- **Player ids** match `/^[A-Za-z0-9_-]{1,32}$/` and are never `__proto__`/`constructor`/`prototype` (they are record keys). *Confirmed.*
- **Commands are untrusted JSON:** refusal reasons print values with `show()` (never throws, cuts long strings); a meeting slot is at most 64 characters. *Confirmed* (accepted 2 Nov).
- **Content overrides** replace numbers only (rooms, Heat, checkpoints, shakedown, role powers, event numbers), validated as untrusted JSON; they can't add rooms or roles. `gameCreated` carries the content version and overrides. *Confirmed.*
- **No new runtime dependencies in the engine** without an entry here; `fast-check` is a test-only devDependency for the property tests. *Confirmed.*

## Rules and roles

The rules are `docs/design.md` and `docs/extension.md`. The choices behind them:

- **One crew, no teams.** Success: the top stash wins, any role. Failure: nobody wins except a ★ role (Getaway Driver, Fence, Mole, Embezzler) whose ending it is and that holds the top stash. A glorified prisoner's dilemma, not hidden teams. *Confirmed.*
- **No automatic reveals;** roles are learned only by choice (Peek, Inside tip, Detective, the Blackmailer's guess, claims, evidence). Shakedowns reveal the stash and any Fence safe, never the role. *Confirmed.*
- **No player elimination;** getting caught costs loot, never the seat (essential for week-long games). *Confirmed.*
- **The final meeting comes before the final target check,** so the crew can still rescue a failing heist. *Confirmed.*
- **Revealing your role is risky by design;** claims can be bluffs. *Confirmed.*
- **Rewards are one private token each,** spent in a dealt shop of three perks (one per column), at most one perk per round. *Confirmed.* (The Shield/Emergency exemption is under "R6a readings, tokens and perks".)
- **"Once between meetings"** is what players see; only regular meetings (after rounds 3, 6, 9) recharge, never emergencies. Duel resets after rounds 3 and 6. *Confirmed.*
- **Dealing:** Balanced (default; a fixed mix per crew size from the balance pass) or Truly random; decks Starter / Standard (default) / Everything plus per-role toggles; the role list shown defaults to **Exact roles dealt**. *Confirmed.* The Balanced mixes, Quick = Starter and the legacy `mole` migration are provisional (gap-fills and R6a readings below; Balanced 4p 1 / 1 and 8p 2 / 1 under "Balance gates").
- **Police activity:** the patrol is not a card but a hidden background chance (+4 at a random game-time moment), announced exactly like the Mole's tip-off. *Confirmed.* Provisional, owner to confirm: it runs only when a Mole could be in the game (dealt or possible under the role-list setting); the Mole's tip-off is used any time but lands at the next free hidden police moment (at most one activity per moment; a tip-off replaces a patrol drawn for it).
- **The Mole earns a token per tip-off, at most 3 tip-offs a game** (Recharge included); **the Blackmailer earns one when a stolen vote decides a shakedown** and keeps it if that shakedown is then cancelled; **a Muscle that saves an innocent** gets a token and its power back. *Confirmed.* Provisional, owner to confirm: the Blackmailer keeps its token if the shakedown its stolen vote decided is then cancelled (Muscle); the Mole tips off at most 3 times a game, even with Recharge (the cap applies to tip-offs, so to tokens too).
- **The Detective's dirty line and the shakedown's clean line are one number (6),** tuned together. *Confirmed.* A wrong Duel call-out pays the rival 8 (the clean payout). *Provisional.*
- **Gap-fills from the R6 review** (provisional, owner to confirm): when a "between meetings" stretch ends (at the close of the next regular meeting, after its vote, shakedown and target check) and how Recharge works (it refills a used once-between-meetings power); session default 1 h; Quick forces Starter with no shop; Duel's shop (Peek or Tail, Alibi or Recharge, Rig or a seeded pick) and events-off dealing; the Fixer stops any raid, including mid-round; Forger from 7 players.
- **R6a readings, deal and setup** (provisional, owner to confirm): Balanced 5–6 players is 1 Lone wolf / 1 Wildcard; the Exact role list is in content order; a Hidden role list falls back to the deck preset for bots; the Mole and Embezzler can be dealt in Duel; Starter has no shop or tokens.
- **R6a readings, tokens and perks** (provisional, owner to confirm): Hacker token when the looped room had a Security watcher and another visitor there pocketed; the Blackmailer's token is emitted at the vote; the Embezzler's first take is its first non-zero take; the Fixer's save also stops a police raid; tokens and perks stay with the player on a Double-cross; automatic perks (Shield, Emergency) are exempt from one per round.
- **R6a readings, police** (provisional, owner to confirm): police moments run on game time and are refused while a meeting is open (the server freezes them while a meeting is open or waiting to open, and during a host pause); the next moment is due from when the previous one fired; police Heat is scaled by min(1, crew ÷ 5); the sim runs one moment per round.
- **R6a readings, views and settings** (provisional, owner to confirm): a Hacker loop shows that room's Security feed offline, a Power cut all feeds; the gap box is the alibi room's loot minus the Haul change; in the Heat breakdown the base absorbs rounding and a missed target sits under the stretch's last round; the legacy `mole` lobby input is migrated rather than refused (off → Team players only; other values → plain deck).
- **R6a readings, bots and sim** (provisional, owner to confirm): forecast Heat = clamp((danger − 0.75) × 2); target = clamp((final − projected) ÷ final × 4 + 0.5); TOP_FACTOR 2; ★ lean point 0.8; Muscle rescue threshold 2; the Mole tips off when Heat + card + 2 × perRound ≥ 70%; buy order shield, peek, extraVote, alibi, tail, recharge, rig, emergency, with the last round spending the rest; ★ roles refuse the Double-cross; bots skip a second audit of the same round after Recharge. The sim setup axis is balanced / random / possible / hidden (default the first three) on the Standard deck; only Balanced 4–12 gates; sim-smoke uses the Everything deck. In-progress games logged with removed event types won't replay, so drain them before a deploy.
- **Votes:** group-scheduled live windows; one regular meeting per act, one emergency per player; sealed votes for absentees; hidden while voting and revealed after by default (prevents bandwagoning); one vote rule for every crew size. *Confirmed.* The **Ballot perk works in Secret mode** (the one exception to secret ballots). *Confirmed.*
- **A meeting slot locks once more than half of the human seats back it;** bots only back, never propose. *Confirmed.*
- **Lock-in marks and presence are public** (who has locked in, never what; online dot and last seen). **Rounds end early once everyone has locked in,** after a short grace that is set once. *Confirmed;* grace lengths per preset (Quick 5 s, 1h 10 s, 3h 30 s, 1d 2 min, 3d 5 min, 1w 5 min) *provisional*.
- **Discussion can happen anywhere** (in-app chat and DMs, WhatsApp, in person); verified evidence cards keep facts trustworthy. Bare role-deal and `voteCompromised` cards are blocked; ability results are shareable; Secret-mode ballots never. *Confirmed.*
- **Earlier provisional rule readings** (1–2 Nov, M1 to M2-10, not covered by "Owner answers, 2 Nov" "Accepted as is") stand until the owner revisits them; they are listed in the archive with *(provisional)*. *Provisional, owner to confirm.*

## Balance gates

- **Heist success 55–70%** in the gated cells (Balanced, 4–12 players). *Confirmed.*
- **Role parity: the target is spread ≤ 0.10.** *Confirmed.* PM calls on the R6 parity gate, provisional, owner to confirm (`docs/balance/r6-balance.md`): (1) the gate is split: Team roles only, the all-role spread report-only; (2) each ★ role within 0.9–1.8× the Team-role average; (3) ★ lean point 0.8 with content 0.17.0's numbers (Teller line 6 loot and +10 Heat × share); (4) Balanced 4p 1 Lone wolf / 1 Wildcard (one over the n ÷ 3 cap) and 8p 2 / 1, Starter left as is; (5) Team-role parity gated at ≤ 0.20 until the owner's playtests, with the Muscle bot's rescue threshold at suspicion 2.
- **A check passes or fails only when its whole 95% interval is in or out of the target;** otherwise it is inconclusive. Parity fails only if even the closest the intervals allow is over the line. *Confirmed* (the R4a suite checks, accepted 2 Nov).
- **Content 0.17.0 is what ships,** and `docs/balance/baseline.json` is the comparison baseline; re-run the suite after any rule, number or bot change. 0.17.0's numbers are a provisional PM call (parity-gate call 3 above), owner to confirm.
- Heat share of failures (target 10–20%), Starter and Duel success are report-only for now. *Provisional.*

## Server and timing

- **Node + Fastify + Postgres (`pg`), PGlite** for tests and zero-setup dev; plain SQL, add-only numbered migrations, no ORM. Replay inputs are `json`, not `jsonb` (key order must survive). *Confirmed.*
- **One server process** (per-game lock, in-memory rate limits, scheduler). *Confirmed.*
- **Sign-in:** invite link + nickname (guests may host), plus Google for a persistent identity (on when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set). *Confirmed.* Provisional, owner to confirm (M2-12, #53): the redirect URI from env (`GOOGLE_REDIRECT_URL`, else `PUBLIC_ORIGIN` + `/api/auth/google/callback`), never the Host header; a guest signing in keeps or moves its seats, and the account's seat is kept on a same-game clash; display name `name` → `given_name` → "Crook"; scopes `openid profile` (no email); `prompt=select_account`.
- **Scheduler reconciles, never schedules by events:** `planDeadlines` lists what the state calls for, one rule per kind in `DEADLINE_RULES`; a restart changes no due time; refused deadlines are dropped, other failures retried with backoff. *Confirmed.*
- **No timing leaks:** a view is pushed only when it changed; bots act only when their own view changed; a Muscle window always runs its full length; police moments never reach clients as timers. *Confirmed.*
- **Preset timings** (Quick to 1 week) and the auto-meeting presets (Quick/1h/3h) are server data; tune after playtests. *Confirmed* (accepted 2 Nov).
- **Host controls** (M2-13, #54), provisional, owner to confirm: players can still act while paused (only the clocks stop; a pause also freezes hidden police moments, early round ends and group-scheduled slots); Extend per preset (Quick 20 s, 1h 2 min, 3h 5 min, 1d 30 min, 3d 1 h, 1w 2 h), no cap, police moments never extended; replace a seat with a bot only after 2 missed rounds in a row, never the host's seat, default Opportunist, handed back by the host or the seat's player; lobby kick of any non-host seat.
- **Chat** is server-only, plain text, random UUID ids, 500 characters, 8 per 10 s; DM notices on by default; bots don't chat. *Confirmed* (limits accepted 2 Nov).
- **Notes** (case-file seen marks, suspicion board) live outside the engine log, over REST (M2-10, #46). Provisional, owner to confirm, with the recap and rate-limit details.
- **One origin:** the server serves the built web app, the API (a leading `/api` is stripped) and the sockets, so a client route must not equal an API `GET` route. `NODE_ENV=production` means secure cookies, trusted proxy and no dev stub. *Confirmed.*

## Web and UI

- **Web-first launch:** the browser app is the product, responsive from 360 to 1280 px, ≥ 44 px targets for mouse and touch, no hover-only interaction, safe-area insets, installable as a PWA. Native apps come later in **Flutter** as thin clients. *Confirmed.*
- **One look everywhere:** the hand-drawn notebook style (`docs/ui-style.md`) from the shared kit and `theme.css` tokens only; style from CityRT, never its logo, name or art. *Confirmed.*
- **React + Vite, no router, state or UI library;** committed woff2 fonts (Pangolin, Inter); our own sketch-frame generator; `/dev/gallery` shows every component and is dev-only. *Confirmed.*
- **Art:** our own SVG bank cutaway in side view, stacked layout on phones, gumdrop crooks. *Confirmed* (approved for now, 2 Nov).
- **The web app imports engine and content for types, names and numbers only;** no game logic runs in the browser beyond reading the view. One `describeEvent()` covers every event. *Confirmed.*
- **Claim role** is on the role card any time the engine allows, and the board draws watched rooms as "seen on camera". *Confirmed.*
- **Extension UI readings** (R6b, #52), provisional, owner to confirm: the Starter deck keeps tokens, the shop and per-role toggles with events off, and only Quick (starter mode) drops tokens and the shop; per-role toggles send `roles: []` when the pick equals the preset, and the last role can't be switched off; meeting perks are hidden once a perk was used by choice this round; Heat breakdown data (rounding remainder to the room lines so `base` is exactly `heat.perRound`, a `clamp` part, police folded in, a stopped raid shown as `stopped`); the case file's "All rounds" chip reads "Whole job".
- **End-of-game reveal readings** (M2-11, #55), provisional, owner to confirm: the summary is built only from the viewer's own log after the end; a `policeActivity` straight followed by `tipOffLanded` is a tip-off, anything else a patrol; an offline camera is a Power cut if a blackout card was flipped that round, else a Hacker loop credited to the looping hackers; a stolen vote's `decided` is true only with a `stolenVoteDecided` token (so always false in starter mode); tokens and purchases are filed by log position and meetings belong to the round before; a round 0 sheet shows only if something happened before round 1; the stash trend includes the safe.
- **Earlier UI readings** (board, results banner, role card, slot picker; 1–2 Nov) are listed in the archive with *(provisional)*. *Provisional, owner to confirm.*

## Ops and deploy

- **Hosting: AWS Lightsail,** https://skimjob.duckdns.org, on the owner's box beside Arcway, which no Skimjob step may touch. systemd service, releases with a `current` symlink, nginx, Postgres, weekly `pg_dump`. Built on the Mac and uploaded by hand; nothing deploys from CI. Runbook: `docs/deploy.md`. *Confirmed.*
- **The repo is public** (free CI minutes), so nothing secret or connection detail is ever committed. *Confirmed.*
- **CI:** typecheck and tests, 6 e2e shards (with a fast-clock server), sim smoke; docs-only PRs (every path `*.md`) skip e2e and sim smoke. *Confirmed.*
- **The M2-15 offline demo is a GitHub Pages site** (engine and bots in the browser, same UI). *Confirmed;* parked by the owner (3 Nov): not needed while the live site exists.
- **M2-14 playtest pass is parked** (owner, 3 Nov): the owner playtests on the live site himself. *Confirmed.*
- **Out of scope:** `docs/rebuild.md` (a proposal), Books mode, the recruited Mole. *Confirmed.*

## Pipeline and git

- **Everything goes through a PR; only the PM merges,** with `docs/pipeline/merge.sh` once the SHA-bound gate (`verdicts.sh`) passes: an APPROVE review naming the reviewed head, a QA PASS naming the current head, only QA-test commits after the review, green CI, a clean merge state, clean authorship. Any API error fails closed. *Confirmed.*
- **The gate scripts use only the GitHub REST API** (`gh api`), so the pipeline runs from the Mac and from cloud sessions where GraphQL is blocked. *Confirmed.*
- **Commits are authored as karthik24iyer <karthik24iyer@gmail.com>, with no AI attribution lines;** the gate refuses them. *Confirmed.*
- **Builders and QA don't edit STATUS or this file;** they put `## Decisions` and `## STATUS updates` in the PR body and the PM folds them in. *Confirmed.*
- **Testing speed:** run only the specs you touched, push once, let CI run the full suite; never skip or disable a test. *Confirmed.*
- **Reveal-overflow regression** (#62): covered by a gallery toggle plus a deterministic spec, not by changing `game.qa.spec.ts`; the gallery's long names are `Bot · ` + 24 W's, stricter than real bot names. *Provisional.*
