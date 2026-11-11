import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// docs/pipeline/runner/poll.sh, setup.sh and .github/workflows/agent.yml (docs/pipeline/agents.md), run against a
// throwaway git repo with stub `gh`, `claude`, `env` and `launchctl` on PATH. No network, nothing outside the temp dir.
const ROOT = process.cwd();
const tmp = mkdtempSync(join(ROOT, "..", ".skimjob-runner-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const R = "repos/EssenKay-Studios/Skimjob";

const GH_STUB = `#!/bin/bash
# Logs every call. Reads answer from $GH_FIX/<path with non-alphanumerics as _>.json (through --jq like gh);
# writes (-X, -f) succeed silently; GraphQL (the board) and a missing fixture fail like an API error.
echo "gh $*" >> "$GH_LOG"
[ "$1" = auth ] && { echo tok; exit 0; }
shift
path= jq= write=
while [ $# -gt 0 ]; do case $1 in
  -X) [ "$2" = GET ] || write=1; shift 2 ;;
  -f|-F) write=1; shift 2 ;;
  --jq) jq=$2; shift 2 ;;
  --silent|--paginate) shift ;;
  *) path=$1; shift ;;
esac; done
[ "$path" = graphql ] && exit 1
[ -n "$write" ] && exit 0
f=$GH_FIX/$(printf %s "$path" | tr -c 'A-Za-z0-9' _).json
[ -f "$f" ] || exit 1
if [ -n "$jq" ]; then jq -r "$jq" "$f"; else cat "$f"; fi
`;

let worlds = 0;
/** A temp repo (origin at .../EssenKay-Studios/Skimjob.git), stubs, an env file and helpers. */
function world(place = "mac") {
  const dir = join(tmp, `w${worlds++}`);
  const bin = join(dir, "bin"), fix = join(dir, "fix"), home = join(dir, "home"), work = join(dir, "work");
  const origin = join(dir, "EssenKay-Studios", "Skimjob.git"), repo = join(dir, "repo");
  for (const d of [bin, fix, home, work, join(work, "jobs")]) mkdirSync(d, { recursive: true });
  const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "--bare", "-b", "main", origin);
  git("clone", "-q", origin, repo);
  git("-C", repo, "config", "user.name", "karthik24iyer");
  git("-C", repo, "config", "user.email", "karthik24iyer@gmail.com");
  mkdirSync(join(repo, "scripts"));
  copyFileSync(join(ROOT, "scripts/agent-start.ts"), join(repo, "scripts/agent-start.ts"));
  git("-C", repo, "add", ".");
  git("-C", repo, "commit", "-qm", "seed");
  git("-C", repo, "push", "-q", "origin", "HEAD:main");
  git("-C", repo, "fetch", "-q", "origin");
  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  };
  stub("gh", GH_STUB);
  const envFile = join(dir, "env");
  writeFileSync(envFile, `PLACE=${place}\nREPO_DIR=${repo}\nWORK_DIR=${work}\nE2E_PORT_BASE=41\n`);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, ENV_FILE: envFile, GH_LOG: join(dir, "gh.log"), GH_FIX: fix, GH_TOKEN: "tok" };
  const fixture = (path: string, data: unknown) => writeFileSync(join(fix, `${path.replace(/[^A-Za-z0-9]/g, "_")}.json`), JSON.stringify(data));
  const poll = (...a: string[]) => spawnSync("bash", [join(ROOT, "docs/pipeline/runner/poll.sh"), ...a], { env, encoding: "utf8" });
  const ghLog = () => (existsSync(env.GH_LOG) ? readFileSync(env.GH_LOG, "utf8") : "");
  return { dir, bin, home, work, repo, origin, git, stub, env, fixture, poll, ghLog };
}

/** A stub claude that runs SCRIPT in the job's worktree and prints a stream-json result. */
const claudeStub = (script: string, result = "Done.") =>
  `#!/bin/bash\n${script}\necho "not json: a stderr line"\nprintf '%s\\n' '{"type":"result","result":${JSON.stringify(result)}}'\n`;

describe("poll.sh job", () => {
  it("keeps a worktree with uncommitted work but detaches it, so the next step can check out the branch (review blocking 3)", () => {
    const w = world();
    w.stub("claude", claudeStub("git checkout -q -b feat && echo wip > wip.txt"));
    mkdirSync(join(w.work, "jobs/5"));
    writeFileSync(join(w.dir, "prompt"), "p");
    const r = w.poll("job", "5", "build", "max", "haiku", join(w.dir, "prompt"), "0");
    expect(r.status).toBe(0);
    const wt = w.git("-C", w.repo, "worktree", "list", "--porcelain").split("\n").find((l) => l.includes("/wt/5-build-"))!.slice("worktree ".length);
    expect(readFileSync(join(wt, "wip.txt"), "utf8")).toBe("wip\n");
    expect(spawnSync("git", ["-C", wt, "symbolic-ref", "-q", "HEAD"]).status).not.toBe(0); // detached
    expect(() => w.git("-C", w.repo, "worktree", "add", "-q", join(w.dir, "next"), "feat")).not.toThrow();
    expect(w.ghLog()).toContain(`gh api -X DELETE ${R}/issues/5/labels/agent:working`);
  });

  it("removes a clean worktree", () => {
    const w = world();
    w.stub("claude", claudeStub("true"));
    mkdirSync(join(w.work, "jobs/5"));
    writeFileSync(join(w.dir, "prompt"), "p");
    w.poll("job", "5", "review", "max", "opus", join(w.dir, "prompt"), "0");
    expect(w.git("-C", w.repo, "worktree", "list")).not.toContain("/wt/5-review-");
  });

  it("gives the API key to claude through the environment, never in a command line (review: argv)", () => {
    const w = world();
    const seen = join(w.dir, "seen");
    w.stub("claude", claudeStub(`echo "key=\${ANTHROPIC_API_KEY:-none} args=$*" > ${seen}`));
    w.stub("env", `#!/bin/bash\necho "$*" >> ${join(w.dir, "env.argv")}\nexec /usr/bin/env "$@"\n`);
    mkdirSync(join(w.home, ".config/skimjob-agent"), { recursive: true });
    const kf = join(w.home, ".config/skimjob-agent/anthropic-api-key");
    writeFileSync(kf, "sk-test-secret");
    chmodSync(kf, 0o600);
    writeFileSync(w.env.ENV_FILE, readFileSync(w.env.ENV_FILE, "utf8") + "API_BUDGET_USD=2\n");
    mkdirSync(join(w.work, "jobs/5"));
    writeFileSync(join(w.dir, "prompt"), "p");
    expect(w.poll("job", "5", "build", "api", "haiku", join(w.dir, "prompt"), "0").status).toBe(0);
    expect(readFileSync(seen, "utf8")).toContain("key=sk-test-secret");
    expect(readFileSync(seen, "utf8")).toContain("--max-budget-usd 2");
    expect(readFileSync(join(w.dir, "env.argv"), "utf8")).not.toContain("sk-test-secret");
  });

  it("runs Claude Code with its commit and PR attribution switched off in its settings (#267)", () => {
    const w = world();
    const seen = join(w.dir, "seen");
    w.stub("claude", claudeStub(`for a in "$@"; do echo "$a"; done > ${seen}`));
    mkdirSync(join(w.work, "jobs/5"));
    writeFileSync(join(w.dir, "prompt"), "p");
    w.poll("job", "5", "build", "max", "haiku", join(w.dir, "prompt"), "0");
    const args = readFileSync(seen, "utf8").split("\n");
    expect(JSON.parse(args[args.indexOf("--settings") + 1])).toEqual({ attribution: { commit: "", pr: "" } });
  });

  it("swaps agent:working for agent:blocked and posts the question after the marker", () => {
    const w = world();
    w.stub("claude", claudeStub("true", "Report.\nNEEDS-OWNER: Blue or red?\nA) blue (recommended)"));
    mkdirSync(join(w.work, "jobs/5"));
    writeFileSync(join(w.dir, "prompt"), "p");
    w.poll("job", "5", "build", "max", "haiku", join(w.dir, "prompt"), "0");
    const log = w.ghLog();
    expect(log).toContain(`gh api ${R}/issues/5/labels -f labels[]=agent:blocked`);
    expect(log).toContain(`gh api -X DELETE ${R}/issues/5/labels/agent:working`);
    expect(log).toContain("needs you:\nBlue or red?\nA) blue (recommended)");
  });
});

describe("poll.sh, one poll", () => {
  it("fetches origin once, then stops a job whose account label was removed and frees its branch (review blocking 3)", async () => {
    const w = world();
    // A new commit on origin: the poll's one fetch must see it.
    const other = join(w.dir, "other");
    w.git("clone", "-q", w.origin, other);
    w.git("-C", other, "-c", "user.name=k", "-c", "user.email=k@x", "commit", "-q", "--allow-empty", "-m", "new");
    w.git("-C", other, "push", "-q", "origin", "HEAD:main");
    const newHead = w.git("-C", other, "rev-parse", "HEAD");
    // A running job on #5 with agent:pro, its worktree on branch b5; the ticket has lost agent:pro.
    const wt = join(w.work, "wt/5-build-1");
    w.git("-C", w.repo, "worktree", "add", "-q", "-b", "b5", wt, "origin/main");
    const job = spawn("perl", ["-e", "setpgrp(0, 0); exec @ARGV", "sleep", "60"], { detached: true, stdio: "ignore" });
    const exited = new Promise((r) => job.on("exit", r));
    const jd = join(w.work, "jobs/5");
    mkdirSync(jd);
    writeFileSync(join(jd, "pid"), `${job.pid}\n`);
    writeFileSync(join(jd, "account"), "pro\n");
    writeFileSync(join(jd, "step"), "build\n");
    writeFileSync(join(jd, "wt"), `${wt}\n`);
    w.fixture(`${R}/issues/5`, { number: 5, labels: [{ name: "on:mac" }, { name: "agent:working" }] });
    w.fixture(`${R}/issues?state=open&per_page=100`, []);
    const r = w.poll();
    expect(r.status).toBe(0);
    expect(w.git("-C", w.repo, "rev-parse", "origin/main")).toBe(newHead);
    expect(r.stdout).toContain("#5: agent:pro removed: stopping the job");
    await expect(Promise.race([exited, new Promise((_, no) => setTimeout(() => no(new Error("job still running")), 3000))])).resolves.toBeDefined();
    expect(spawnSync("git", ["-C", wt, "symbolic-ref", "-q", "HEAD"]).status).not.toBe(0);
    expect(() => w.git("-C", w.repo, "worktree", "add", "-q", join(w.dir, "next"), "b5")).not.toThrow();
    expect(existsSync(jd)).toBe(false);
    expect(w.ghLog()).toContain(`gh api -X DELETE ${R}/issues/5/labels/agent:working`);
    expect(w.ghLog()).toContain("runner: stopped on mac: the account label was removed.");
  });
});

describe("poll.sh check", () => {
  it("passes the issue's author to the start check: a stranger's issue starts nothing (review blocking 1)", () => {
    const w = world();
    const at = "2026-11-10T10:00:00Z";
    w.fixture(`${R}/issues/9`, {
      number: 9, title: "T", user: { login: "mallory" }, type: { name: "Feature" }, body: "### Area\n\nci",
      labels: ["agent:max", "on:mac"].map((name) => ({ name })),
    });
    w.fixture(`${R}/issues/9/events?per_page=100`, ["agent:max", "on:mac"].map((name) => ({ event: "labeled", label: { name }, actor: { login: "karthik24iyer" }, created_at: at })));
    w.fixture(`${R}/issues/9/comments?per_page=100`, []);
    w.fixture(`${R}/issues?state=open&labels=agent:working&per_page=100`, []);
    w.fixture(`${R}/pulls?state=open&per_page=100`, []);
    const r = w.poll("check", "9");
    expect(r.stdout).toContain("#9: comment: runner: not started: opened by mallory, not karthik24iyer");
    expect(w.ghLog()).toContain(`gh api ${R}/issues/9/comments -f body=runner: not started: opened by mallory`);
    expect(w.ghLog()).not.toContain("agent:working --silent");
  });
});

describe("poll.sh check: the Effort field", () => {
  const ticket = (w: ReturnType<typeof world>, fields: unknown) => {
    const at = "2026-11-10T10:00:00Z";
    w.fixture(`${R}/issues/9`, {
      number: 9, title: "T", user: { login: "karthik24iyer" }, type: { name: "Task" }, body: "### Area\n\nci",
      labels: ["agent:max", "on:mac"].map((name) => ({ name })), issue_field_values: fields,
    });
    w.fixture(`${R}/issues/9/events?per_page=100`, ["agent:max", "on:mac"].map((name) => ({ event: "labeled", label: { name }, actor: { login: "karthik24iyer" }, created_at: at })));
    w.fixture(`${R}/issues/9/comments?per_page=100`, []);
    w.fixture(`${R}/issues?state=open&labels=agent:working&per_page=100`, []);
    w.fixture(`${R}/pulls?state=open&per_page=100`, []);
  };
  const effort = (name: string) => [{ issue_field_name: "Priority", single_select_option: { name: "High" } }, { issue_field_name: "Effort", single_select_option: { name } }];

  it.each([["High", "opus"], ["Medium", "sonnet"], ["Low", "haiku"]])("Effort %s: the dry run starts the builder on %s", (name, model) => {
    const w = world();
    ticket(w, effort(name));
    const r = spawnSync("bash", [join(ROOT, "docs/pipeline/runner/poll.sh"), "check", "9"], { env: { ...w.env, DRY_RUN: "1" }, encoding: "utf8" });
    expect(r.stdout).toContain(`#9: start build on mac, max/${model}`);
    expect(r.stdout).toContain(`claude -p --model ${model}`);
  });

  it("no Effort: comments once to set it and starts nothing", () => {
    const w = world();
    ticket(w, []);
    const r = w.poll("check", "9");
    expect(r.stdout).toContain("#9: comment: runner: not started: set the Effort field.");
    expect(w.ghLog()).not.toContain("agent:working --silent");
  });
});

describe("poll.sh merges once the gate passes (#270)", () => {
  /** Ticket 9 with start labels on:HOST and an open PR #12 that closes it; verdicts.sh and merge.sh stubbed. */
  function ready(host: string, place = "mac", merge = 'echo "merged #12 -> main abc1234 | next: #13 x"') {
    const w = world(place);
    const labels = ["agent:max", `on:${host}`];
    w.fixture(`${R}/issues/9`, {
      number: 9, title: "T", user: { login: "karthik24iyer" }, type: { name: "Feature" }, body: "### Area\n\nci",
      labels: labels.map((name) => ({ name })), issue_field_values: [{ issue_field_name: "Effort", single_select_option: { name: "Low" } }],
    });
    w.fixture(`${R}/issues/9/events?per_page=100`, labels.map((name) => ({ event: "labeled", label: { name }, actor: { login: "karthik24iyer" }, created_at: "2026-11-10T10:00:00Z" })));
    w.fixture(`${R}/issues/9/comments?per_page=100`, []);
    w.fixture(`${R}/issues?state=open&labels=agent:working&per_page=100`, []);
    w.fixture(`${R}/pulls?state=open&per_page=100`, [{ number: 12, body: "Closes #9" }]);
    mkdirSync(join(w.repo, "docs/pipeline"), { recursive: true });
    writeFileSync(join(w.repo, "docs/pipeline/verdicts.sh"), 'echo "MERGEABLE: yes"\n');
    writeFileSync(join(w.repo, "docs/pipeline/merge.sh"), `echo "GH_TOKEN=$GH_TOKEN" > ${join(w.dir, "merged")}\n${merge}\n`);
    return w;
  }

  it("merges on the ticket's host and comments the merge", () => {
    const w = ready("mac");
    expect(w.poll("check", "9").stdout).toContain("PR #12 passed the gate: merging");
    expect(readFileSync(join(w.dir, "merged"), "utf8")).toBe("GH_TOKEN=tok\n");
    expect(w.ghLog()).toContain(`gh api ${R}/issues/9/comments -f body=runner: merged #12 → main abc1234 --silent`);
    expect(w.ghLog()).not.toContain("agent:blocked");
  });

  it("leaves the merge to the ticket's host", () => {
    const w = ready("cloud");
    expect(w.poll("check", "9").stdout).toContain("PR #12 passed the gate: cloud merges it");
    expect(existsSync(join(w.dir, "merged"))).toBe(false);
  });

  it("in the cloud, hands the merge to the workflow's Merge step, which merges with AGENT_GH_TOKEN", () => {
    const w = ready("cloud", "cloud");
    const out = join(w.dir, "out");
    const r = spawnSync("bash", [join(ROOT, "docs/pipeline/runner/poll.sh"), "check", "9"], { env: { ...w.env, GITHUB_OUTPUT: out }, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(readFileSync(out, "utf8")).toBe("merge=12\n");
    expect(existsSync(join(w.dir, "merged"))).toBe(false);
    spawnSync("bash", [join(ROOT, "docs/pipeline/runner/poll.sh"), "merge", "9", "12"], { env: { ...w.env, AGENT_GH_TOKEN: "agent-tok" } });
    expect(readFileSync(join(w.dir, "merged"), "utf8")).toBe("GH_TOKEN=agent-tok\n");
  });

  it("a refused merge is never merged: it comments the gate's reason and sets agent:blocked", () => {
    const w = ready("mac", "mac", 'echo "MERGEABLE: no (CI failing: e2e (failure))"; echo "ABORT: #12 not merged (CI failing: e2e (failure))"; exit 1');
    w.poll("check", "9");
    expect(w.ghLog()).toContain(`gh api ${R}/issues/9/labels -f labels[]=agent:blocked`);
    expect(w.ghLog()).toContain("runner: merge refused: #12 not merged (CI failing: e2e (failure))\nFix it, then remove `agent:blocked`.");
    expect(w.ghLog()).not.toContain("runner: merged");
  });
});

describe("poll.sh stop (the cloud)", () => {
  const pickup = (place: string) => [{ user: { login: "github-actions[bot]" }, body: `runner: picked up on ${place}, max/opus (build, head none)` }];

  it("leaves agent:working alone when a Mac or Linux step holds it (review: cloud reacts to the Mac's labels)", () => {
    const w = world("cloud");
    w.fixture(`${R}/issues/6/comments?per_page=100`, pickup("mac"));
    w.fixture(`${R}/issues/6`, { labels: [{ name: "agent:working" }] });
    expect(w.poll("stop", "6").stdout).toContain("no cloud step holds it");
    expect(w.ghLog()).not.toContain("DELETE");
  });

  it("clears agent:working and says so when a cloud step holds it", () => {
    const w = world("cloud");
    w.fixture(`${R}/issues/6/comments?per_page=100`, [...pickup("mac"), ...pickup("cloud")]);
    w.fixture(`${R}/issues/6`, { labels: [{ name: "agent:working" }] });
    w.poll("stop", "6");
    expect(w.ghLog()).toContain(`gh api -X DELETE ${R}/issues/6/labels/agent:working`);
    expect(w.ghLog()).toContain("runner: stopped on cloud: the account label was removed.");
  });
});

describe("setup.sh", () => {
  function mac() {
    const w = world();
    w.stub("uname", "#!/bin/bash\necho Darwin\n");
    w.stub("node", "#!/bin/bash\necho v22.20.0\n");
    w.stub("pnpm", "#!/bin/bash\nexit 0\n");
    w.stub("claude", `#!/bin/bash\necho '{ "loggedIn": true }'\n`);
    // bootstrap fails once (error 5) right after a bootout, as launchd does while the bootout finishes.
    w.stub("launchctl", `#!/bin/bash\necho "$*" >> ${join(w.dir, "launchctl.log")}\nif [ "$1" = bootstrap ] && [ ! -f ${join(w.dir, "booted")} ]; then touch ${join(w.dir, "booted")}; exit 5; fi\n`);
    mkdirSync(join(w.home, "Library/Caches/ms-playwright/chromium-1"), { recursive: true });
    mkdirSync(join(w.home, ".config/skimjob-agent"), { recursive: true });
    const run = () => spawnSync("bash", [join(ROOT, "docs/pipeline/runner/setup.sh")], { env: w.env, encoding: "utf8" });
    return { w, run };
  }

  it("prints what is missing and installs nothing", () => {
    const { w, run } = mac();
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`Missing:\n  - ${join(w.home, ".config/skimjob-agent/env")} with PLACE=mac`);
    expect(r.stdout).toContain("Nothing installed.");
    expect(existsSync(join(w.home, "Library/LaunchAgents/com.skimjob.agent.plist"))).toBe(false);
  });

  it("refuses a REPO_DIR or WORK_DIR under ~/Documents, ~/Desktop or ~/Downloads (the service can't read them)", () => {
    const { w, run } = mac();
    writeFileSync(join(w.home, ".config/skimjob-agent/env"), `PLACE=mac\nREPO_DIR=${w.home}/Documents/Skimjob\nWORK_DIR=${w.home}/Downloads/work\nE2E_PORT_BASE=41\n`);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("REPO_DIR outside ~/Documents");
    expect(r.stdout).toContain("WORK_DIR outside ~/Downloads");
  });

  it("installs the service when every check passes, retrying a bootstrap that races the bootout, and is idempotent (review: launchctl)", () => {
    const { w, run } = mac();
    copyFileSync(w.env.ENV_FILE, join(w.home, ".config/skimjob-agent/env"));
    const first = run();
    expect(first.stdout).toContain("installed");
    expect(first.status).toBe(0);
    expect(run().status).toBe(0);
    const plist = readFileSync(join(w.home, "Library/LaunchAgents/com.skimjob.agent.plist"), "utf8");
    expect(plist).toContain(`<string>${w.repo}/docs/pipeline/runner/poll.sh</string>`);
    expect(readFileSync(join(w.dir, "launchctl.log"), "utf8").match(/^bootstrap /gm)).toHaveLength(3);
  });
});

describe("agent.yml", () => {
  const yml = readFileSync(join(ROOT, ".github/workflows/agent.yml"), "utf8");
  it("has no pull_request trigger and checks out main, so a PR's scripts never run with the secrets (review blocking 2)", () => {
    expect(yml).not.toMatch(/^\s*pull_request(_target)?:/m);
    expect(yml).toContain("ref: ${{ github.event.repository.default_branch }}");
  });
  it("leaves no token in .git/config; only the steps that run the agent or the merge get AGENT_GH_TOKEN", () => {
    expect(yml).toContain("persist-credentials: false");
    expect(yml).not.toMatch(/token: \$\{\{ secrets\.AGENT_GH_TOKEN/);
    expect(yml.match(/secrets\.AGENT_GH_TOKEN/g)).toHaveLength(2);
    expect(yml).toMatch(/- name: Merge\n {8}if: steps\.check\.outputs\.merge != ''\n {8}env:\n.*\n {10}AGENT_GH_TOKEN: \$\{\{ secrets\.AGENT_GH_TOKEN \}\}/);
    expect(yml).toContain("GH_TOKEN=$AGENT_GH_TOKEN gh auth setup-git");
  });
  it("ignores the runner's own label writes and stops only a cloud step", () => {
    expect(yml).toContain("&& github.event.label.name != 'agent:working'");
    expect(yml).toContain("!(github.event.action == 'labeled' && github.event.label.name == 'agent:blocked')");
    expect(yml).toContain('poll.sh stop "$N"');
  });
});
