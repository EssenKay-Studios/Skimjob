- Mole task: Mole wins only if heist fails, never on success (best non-Mole wins success). Driver wins success normally AND on Heat-caused failure if top stash; do NOT key exclusion off winsOnFailure. Fix STATUS note accordingly (PR #7 review).
- Morning question already in STATUS: Fence safe vs clean check.
- Task 9 bots: viewFor returns objects shared with state — bots could mutate state; ensure views are copies/frozen (PR #8 review). M2: evidence cards shown to others must not carry seq.
- After M2-3 merges: M2-2b lobby host hand-over (owner: host can transfer host role, then leave).
- Next in /home/claude/skimjob after owner-decisions merges: sim suite parallel (worker_threads), deterministic per-game seeds, fixed matrix, Wilson CIs, role parity check (max-min normalized win rate <=10%), baseline compare.
- Roles v2 APPROVED (owner): build after owner-decisions merges; Ballot perk works in Secret mode too (override secret ballots for perk holder). Plan: R1 factions+win rule+perks+deal; R2a/b crew roles; R3 accomplices+Embezzler; R4 bot claims + parallel sim suite; R5 parity balance (≤10% normalized).
- Bug from PR #23: engine throws (instead of refusing) on JSON {"toString":null} as room/proposalId — fix in a small PR (own-key checks everywhere commands index content/state); un-pin the it.fails test.
- Reviewer nit: bots run.test.ts:225 needs explicit timeout.
- R1 follow-ups (for R2/R3/R5): floor(n/3) cap cuts 5p 1/1, 7p/9p/11p mixes — fix the dealing table to respect the cap (R5 balance); Recharge must not refill Fence safe cap (R3); Duel must not deal Blackmailer (R3); Double-cross makes second-Rig refusal reachable with unique roles → leak (fix in R2: make Rig refusal indistinguishable or allow).
- PROCESS: docs/decisions.md + STATUS.md conflict on almost every parallel PR. Consider: new decisions as separate files docs/decisions/YYYY-MM-DD-<slug>.md (index generated) — do it in a small docs PR when the pipeline is quieter.
- After R2b QA: builder must merge main into roles/r2b-crew (decisions.md conflict).
- PR #31 after QA finishes: builder (new agent, clone skimjob-t2) merge main + gate TIME_SCALE off in production (+ QA findings).
## Owner direction (1 Nov 20:52): finish ALL dev + testing, deliver a verifiable ARTIFACT; deployment (AWS Lightsail vs Fly) decided later when he's home.
Remaining plan: #31 game screen → M2-7 meetings UI, M2-8b chat UI, M2-10 ledger/away, M2-11 reveal, M2-13 host controls (+ wire art M2-9 into game screen), M2-12 Google sign-in = stub-ready (needs client id), R3 accomplices (+R3b), R4b bot claims/bluffs, R5 parity balance (≤10%), M2-14 playtest pass, M2-15 OFFLINE DEMO BUILD: in-browser engine+bots adapter, same UI, published as claude.ai artifact for owner to verify; final hosted-verify artifact.
Lightsail needs: LIGHTSAIL_SSH_KEY, LIGHTSAIL_HOST, LIGHTSAIL_USER secrets; subdomain DNS A record; docker? proxy (nginx/caddy)? RAM.
- PM call: 5p never gets an accomplice (floor(n/3)=1) — accepted; revisit in R5 if parity fails at 5p.
- Bot fix before M2-14: bots must only BACK human meeting proposals (not propose first); queue small PR.
