# Skimjob pipeline — common rules for every agent

- Repo clone: /home/claude/skimjob (remote: https://github.com/EssenKay-Studios/Skimjob, default branch `main`). Shallow clone: always fetch with an explicit refspec, e.g. `git fetch origin +refs/heads/main:refs/remotes/origin/main` (plain `git fetch origin <branch>` may not update the remote-tracking ref).
- Read /home/claude/skimjob/CLAUDE.md first and obey it (engine rules, conventions, git rules).
- Git identity is already configured in the repo (karthik24iyer <karthik24iyer@gmail.com>). NEVER add Co-Authored-By, Claude-Session or any Claude attribution lines to commit messages.
- GitHub: `gh pr ...` and any GraphQL call are BLOCKED. Use the REST API through `gh api`, e.g.
  - create PR: `gh api repos/EssenKay-Studios/Skimjob/pulls -f title=... -f head=BRANCH -f base=main -f body=...`
  - PR files: `gh api repos/EssenKay-Studios/Skimjob/pulls/N/files`
  - post review: `gh api repos/EssenKay-Studios/Skimjob/pulls/N/reviews -f event=COMMENT -f body=...`
  - PR comment: `gh api repos/EssenKay-Studios/Skimjob/issues/N/comments -f body=...`
- Commands: `pnpm install`, `pnpm test`, `pnpm typecheck` (run from repo root).
- Only one agent works in the clone at a time. Leave the working tree clean (everything committed or discarded) when you finish.
- Keep your final report SHORT: at most 80 words (PR number, verdict/result, provisional decisions, blockers). Details belong on the PR, not in the report.
