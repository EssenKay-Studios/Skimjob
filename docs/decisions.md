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
- **Commands are untrusted JSON:** refusal reasons print values with `show()` (never throws, cuts long strings); a meeting slot is at most 64 characters. *Provisional.*
- **Content overrides** replace numbers only (rooms, Heat, checkpoints, shakedown, role powers, event numbers), validated as untrusted JSON; they can't add rooms or roles. `gameCreated` carries the content version and overrides. *Confirmed.*
- **No new runtime dependencies in the engine** without an entry here; `fast-check` is a test-only devDependency for the property tests. *Confirmed.*

## Rules and roles

The rules are `docs/design.md` and `docs/extension.md`. The choices behind them:

- **One crew, no teams.** Success: the top stash wins, any role. Failure: nobody wins except a ★ role (Getaway Driver, Fence, Mole, Embezzler) whose ending it is and that holds the top stash. A glorified prisoner's dilemma, not hidden teams. *Confirmed.*
- **No automatic reveals;** roles are learned only by choice (Peek, Inside tip, Detective, the Blackmailer's guess, claims, evidence). Shakedowns reveal the stash and any Fence safe, never the role. *Confirmed.*
- **No player elimination;** getting caught costs loot, never the seat (essential for week-long games). *Confirmed.*
- **The final meeting comes before the final target check,** so the crew can still rescue a failing heist. *Confirmed.*
- **Revealing your role is risky by design;** claims can be bluffs. *Confirmed.*
- **Rewards are one private token each,** spent in a dealt shop of three perks (one per column), at most one perk per round. *Confirmed.* Automatic perks (Shield, Emergency) don't count toward the one per round. *Provisional.*
- **"Once between meetings"** is what players see; only regular meetings (after rounds 3, 6, 9) recharge, never emergencies. Duel resets after rounds 3 and 6. *Confirmed.*
- **Dealing:** Balanced (default; a fixed mix per crew size from the balance pass) or Truly random; decks Starter / Standard (default) / Everything plus per-role toggles; the role list shown defaults to **Exact roles dealt**. *Confirmed.* Balanced 4–6 players deal 1 Lone wolf / 1 Wildcard; Quick forces Starter with no shop or tokens; a legacy stored `mole` setting is migrated, not refused. *Provisional.*
- **Police activity:** the patrol is not a card but a hidden background chance (+4 at a random game-time moment), announced exactly like the Mole's tip-off. *Confirmed.* It runs only when a Mole could be in the game; a tip-off lands at the next free police moment; moments are frozen by meetings and host pauses. *Provisional.*
- **The Mole earns a token per tip-off, at most 3 tip-offs a game** (Recharge included); **the Blackmailer earns one when a stolen vote decides a shakedown** and keeps it if that shakedown is then cancelled; **a Muscle that saves an innocent** gets a token and its power back. *Confirmed* (the cap and the keep-on-cancel reading are *provisional*).
- **The Detective's dirty line and the shakedown's clean line are one number (6),** tuned together. *Confirmed.* A wrong Duel call-out pays the rival 8 (the clean payout). *Provisional.*
- **Gap-fills from the R6 review:** session default 1 h; Duel's shop and events-off dealing; the Fixer stops any raid, including mid-round; Forger from 7 players; R6a's token triggers, view readings and bot tunables (archive "R6a provisional decisions"). *Provisional.*
- **Votes:** group-scheduled live windows; one regular meeting per act, one emergency per player; sealed votes for absentees; hidden while voting and revealed after by default (prevents bandwagoning); one vote rule for every crew size. *Confirmed.* The **Ballot perk works in Secret mode** (the one exception to secret ballots). *Confirmed.*
- **A meeting slot locks once more than half of the human seats back it;** bots only back, never propose. *Confirmed.*
- **Lock-in marks and presence are public** (who has locked in, never what; online dot and last seen). **Rounds end early once everyone has locked in,** after a short grace that is set once. *Confirmed;* grace lengths per preset *provisional*.
- **Discussion can happen anywhere** (in-app chat and DMs, WhatsApp, in person); verified evidence cards keep facts trustworthy. Bare role-deal and `voteCompromised` cards are blocked; ability results are shareable; Secret-mode ballots never. *Confirmed.*
- **Earlier provisional rule readings** (1–2 Nov, M1 to M2-10; partly accepted 2 Nov) stand until the owner revisits them; they are listed in the archive with *(provisional)*. *Provisional.*

## Balance gates

- **Heist success 55–70%** in the gated cells (Balanced, 4–12 players). *Confirmed.*
- **Role parity: the target is spread ≤ 0.10.** *Confirmed.* The gate is split: Team roles only, gated at ≤ 0.20 until the M2-14 playtests; each ★ role within 0.9–1.8× the Team-role average; ★ lean point 0.8; the all-role spread is report-only. *Provisional* (`docs/balance/r6-balance.md`).
- **A check passes or fails only when its whole 95% interval is in or out of the target;** otherwise it is inconclusive. Parity fails only if even the closest the intervals allow is over the line. *Provisional.*
- **Content 0.17.0** is the shipped balance; `docs/balance/baseline.json` is the comparison baseline. Re-run the suite after any rule, number or bot change. *Confirmed.*
- Heat share of failures (target 10–20%), Starter and Duel success are report-only for now. *Provisional.*

## Server and timing

- **Node + Fastify + Postgres (`pg`), PGlite** for tests and zero-setup dev; plain SQL, add-only numbered migrations, no ORM. Replay inputs are `json`, not `jsonb` (key order must survive). *Confirmed.*
- **One server process** (per-game lock, in-memory rate limits, scheduler). *Confirmed.*
- **Sign-in:** invite link + nickname (guests may host), plus Google for a persistent identity (on when both Google env vars are set). The redirect URI comes from env, never the Host header. *Confirmed;* the guest-to-account merge (the account's seat wins a same-game clash), display-name fallback and `prompt=select_account` are *provisional*.
- **Scheduler reconciles, never schedules by events:** `planDeadlines` lists what the state calls for, one rule per kind in `DEADLINE_RULES`; a restart changes no due time; refused deadlines are dropped, other failures retried with backoff. *Confirmed.*
- **No timing leaks:** a view is pushed only when it changed; bots act only when their own view changed; a Muscle window always runs its full length; police moments never reach clients as timers. *Confirmed.*
- **Preset timings** (Quick to 1 week) and the auto-meeting presets (Quick/1h/3h) are server data; tune after playtests. *Provisional.*
- **Host controls:** pause/resume (players can still act; only clocks stop), Extend per preset with no cap, replace a seat with a bot after 2 missed rounds (never the host; handed back by host or player), lobby kick of any non-host seat. *Provisional.*
- **Chat** is server-only, plain text, random UUID ids, 500 characters, 8 per 10 s; DM notices on by default; bots don't chat. *Provisional* limits.
- **Notes** (case-file seen marks, suspicion board) live outside the engine log, over REST. *Confirmed;* recap and rate-limit details *provisional*.
- **One origin:** the server serves the built web app, the API (a leading `/api` is stripped) and the sockets, so a client route must not equal an API `GET` route. `NODE_ENV=production` means secure cookies, trusted proxy and no dev stub. *Confirmed.*

## Web and UI

- **Web-first launch:** the browser app is the product, responsive from 360 to 1280 px, ≥ 44 px targets for mouse and touch, no hover-only interaction, safe-area insets, installable as a PWA. Native apps come later in **Flutter** as thin clients. *Confirmed.*
- **One look everywhere:** the hand-drawn notebook style (`docs/ui-style.md`) from the shared kit and `theme.css` tokens only; style from CityRT, never its logo, name or art. *Confirmed.*
- **React + Vite, no router, state or UI library;** committed woff2 fonts (Pangolin, Inter); our own sketch-frame generator; `/dev/gallery` shows every component and is dev-only. *Confirmed.*
- **Art:** our own SVG bank cutaway in side view, stacked layout on phones, gumdrop crooks. *Confirmed* (approved for now, 2 Nov).
- **The web app imports engine and content for types, names and numbers only;** no game logic runs in the browser beyond reading the view. One `describeEvent()` covers every event. *Confirmed.*
- **Claim role** is on the role card any time the engine allows, and the board draws watched rooms as "seen on camera". *Confirmed.*
- **Builder UI readings** (Starter deck ≠ starter mode, Heat breakdown parts, reveal attribution of tip-offs, loops and stolen votes, board and results-banner details). *Provisional.*

## Ops and deploy

- **Hosting: AWS Lightsail,** https://skimjob.duckdns.org, on the owner's box beside Arcway, which no Skimjob step may touch. systemd service, releases with a `current` symlink, nginx, Postgres, weekly `pg_dump`. Built on the Mac and uploaded by hand; nothing deploys from CI. Runbook: `docs/deploy.md`. *Confirmed.*
- **The repo is public** (free CI minutes), so nothing secret or connection detail is ever committed. *Confirmed.*
- **CI:** typecheck and tests, 6 e2e shards (with a fast-clock server), sim smoke; docs-only PRs (every path `*.md`) skip e2e and sim smoke. *Confirmed.*
- **The M2-15 offline demo is a GitHub Pages site** (engine and bots in the browser, same UI). *Confirmed;* paused by the owner.
- **Out of scope:** `docs/rebuild.md` (a proposal), Books mode, the recruited Mole. *Confirmed.*

## Pipeline and git

- **Everything goes through a PR; only the PM merges,** with `docs/pipeline/merge.sh` once the SHA-bound gate (`verdicts.sh`) passes: an APPROVE review naming the reviewed head, a QA PASS naming the current head, only QA-test commits after the review, green CI, a clean merge state, clean authorship. Any API error fails closed. *Confirmed.*
- **The gate scripts use only the GitHub REST API** (`gh api`), so the pipeline runs from the Mac and from cloud sessions where GraphQL is blocked. *Confirmed.*
- **Commits are authored as karthik24iyer <karthik24iyer@gmail.com>, with no AI attribution lines;** the gate refuses them. *Confirmed.*
- **Builders and QA don't edit STATUS or this file;** they put `## Decisions` and `## STATUS updates` in the PR body and the PM folds them in. *Confirmed.*
- **Testing speed:** run only the specs you touched, push once, let CI run the full suite; never skip or disable a test. *Confirmed.*
- **Reveal-overflow regression** (#62): covered by a gallery toggle plus a deterministic spec, not by changing `game.qa.spec.ts`; the gallery's long names are `Bot · ` + 24 W's, stricter than real bot names. *Provisional.*
