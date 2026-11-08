// QA (PR #130, R7 C2c): the 11 cut R6 roles and the legacy `mole?` setting are gone.
// Overrides naming them are refused (or the dead setting ignored) without a crash;
// the Shield's shakedown window still works. extension.md, design §11.1, §17.2
import { describe, expect, it } from "vitest";
import { ROLES, type PerkId, type RoleId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { PUBLIC, privateTo } from "./types";
import { createGame, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { opensShakedownWindow } from "./meeting";
import { grantPerks } from "./perks.testkit";

const CUT = ["insideMan", "getawayDriver", "fence", "blackmailer", "forger", "muscle", "snitch", "bagman", "cleaner", "mastermind", "embezzler"];
const R7_ROLES = ["lookout", "locksmith", "detective", "auditor", "smoothTalker", "hacker", "electrician", "priest", "mole", "fixer"];

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "qa-c2c",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  };
}

describe("cut roles and the old mole setting at engine setup", () => {
  it("the content table holds exactly the 10 R7 roles (design §11.1)", () => {
    expect(Object.keys(ROLES).sort()).toEqual([...R7_ROLES].sort());
    for (const cut of CUT) expect(Object.values(createGame(config(12)).players).map((p) => p.role)).not.toContain(cut);
  });
  it.each(CUT)("content overrides for %s are refused, never a throw", (cut) => {
    let errors: string[] = [];
    expect(() => (errors = validateConfig(config(5, { contentOverrides: { roles: { [cut]: { perStretch: 2 } } } as never })))).not.toThrow();
    expect(errors.length).toBeGreaterThan(0);
  });
  it.each(["off", "maybe", "on", 7, null])("a stored config still carrying mole: %s neither crashes nor changes the deal", (mole) => {
    for (const n of [3, 5, 8, 12]) {
      const plain = config(n, { seed: `mole-${n}` });
      const legacy = { ...plain, mole } as unknown as GameConfig;
      expect(() => validateConfig(legacy)).not.toThrow();
      expect(validateConfig(legacy)).toEqual([]);
      expect(setupEvents(legacy)).toEqual(setupEvents(plain));
    }
  });
});

// Helpers as in perks.test.ts.
type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    // A step may be several commands, worked out from the state as it reaches them.
    if (Array.isArray(command)) return run(s, ...(command as Cmd[]));
    const r = handleCommand(s, command);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    return r.state;
  }, state);
}
function game(players: number, roles: string[], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  const log = setupEvents(cfg).map((e, i, all): GameEvent => {
    if (e.type !== "roleDealt") return e;
    const seat = all.slice(0, i).filter((x) => x.type === "roleDealt").length;
    return { ...e, role: (roles[seat] ?? "lookout") as RoleId };
  });
  return replay(cfg, log);
}
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
/** Round 1 resolves and, in its result window, `by` calls the crew's emergency, which opens at once. design §9.3 */
const emergency = (by: string): Cmd[] => [
  { type: "advance", deadline: { kind: "round", round: 1 } },
  { type: "advance", deadline: { kind: "alibis", round: 1 } },
  { type: "callEmergency", player: by },
  (s: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.pendingEmergency?.meetingId } }),
];
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
const vote = (player: string, target: string) => ({ type: "castVote", player, vote: { kind: "shakedown", target } });
const withShop = (s: GameState, shop: PerkId[]): GameState => ({ ...s, shop });
const withStash = (s: GameState, id: string, stash: number): GameState => ({ ...s, players: { ...s.players, [id]: { ...(s.players[id] as PlayerState), stash } } });
const shakedownOfP0 = (s: GameState) => run(s, ...emergency("p1"), vote("p1", "p0"), vote("p2", "p0"), vote("p3", "p0"), CLOSE);

describe("the shakedown window without the Muscle (Shield only)", () => {
  it("opens only when the shop holds a Shield", () => {
    expect(opensShakedownWindow(["shield"])).toBe(true);
    expect(opensShakedownWindow([])).toBe(false);
    expect(opensShakedownWindow(["peek", "extraVote"] as PerkId[])).toBe(false);
  });
  it("no Shield in the shop: a passed shakedown resolves at once, no window", () => {
    const s = withStash(withShop(game(4, ["lookout", "lookout", "hacker"]), ["peek"] as PerkId[]), "p0", 6);
    const after = shakedownOfP0(s);
    expect(after.phase.kind).not.toBe("shakedownPending");
    expect(since(s, after).some((e) => e.type === "shakedownResolved")).toBe(true);
  });
  it("Shield in the shop, target holds none: the window opens and resolves to a shakedown; refuses a wrong-meeting resolve", () => {
    const s = withStash(withShop(game(4, ["lookout", "lookout", "hacker"]), ["shield"]), "p0", 6);
    const pending = shakedownOfP0(s);
    expect(pending.phase.kind).toBe("shakedownPending");
    expect(handleCommand(pending, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "nope" } }).ok).toBe(false);
    const after = run(pending, RESOLVE);
    expect(since(pending, after).some((e) => e.type === "shakedownResolved")).toBe(true);
    expect(after.phase.kind).not.toBe("shakedownPending");
  });
  it("a shakedown against a Shield holder is cancelled (private perkUsed, public cancel, stash kept), deterministically", () => {
    const build = () => grantPerks(withStash(withShop(game(4, ["lookout", "lookout", "hacker"]), ["shield"]), "p0", 6), "p0", "shield");
    const s = build();
    const after = (() => {
      const x = shakedownOfP0(s);
      return x.phase.kind === "shakedownPending" ? run(x, RESOLVE) : x;
    })();
    const events = since(s, after);
    expect(events).toContainEqual({ type: "perkUsed", visibility: privateTo("p0"), player: "p0", round: 1, perk: { kind: "shield", meetingId: "emergency-1" } });
    expect(events).toContainEqual({ type: "shakedownCancelled", visibility: PUBLIC, meetingId: "emergency-1", target: "p0" });
    expect(events.some((e) => e.type === "shakedownResolved")).toBe(false);
    // Kept: the 6, plus round 1's cut.
    expect(after.players.p0).toMatchObject({ stash: 6 + after.share });
    expect(shakedownOfP0(build()).log).toEqual(shakedownOfP0(build()).log);
  });
});
