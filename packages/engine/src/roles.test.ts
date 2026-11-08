// The R7 roles: the deal, each role's power and frequency, copies on the same
// target, per-holder charges and the Mole's and Fixer's own win rule; the
// Smooth Talker's vote and the shakedown window. design §11, §8.4, §9.5
import { describe, expect, it } from "vitest";
import { closeResultWindow } from "./alibis.testkit";
import { BANK_JOB, MAX_PLAYERS, MIN_PLAYERS, ROLES } from "@skimjob/content";
import type { ContentOverrides, GameConfig, GameEvent, GameState, PlayerState, RoleListSetting, VoteVisibility } from "./types";
import { createGame, setupEvents, validateConfig } from "./setup";
import { opensShakedownWindow } from "./meeting";
import { replay } from "./reduce";
import { handleCommand, type CommandResult } from "./handle";
import { viewFor } from "./view";
import { fullGrab } from "./grab.testkit";
import { grantPerks } from "./perks.testkit";
import { ringsOf, roomDef } from "./job";
import { outcomeFor } from "./end";
import { ROLE_HANDLERS } from "./roles";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "roles-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  };
}

/** A new game with chosen roles (seat i gets roles[i], a Lookout if missing: its power acts only when used). */
function game(players: number, roles: string[], overrides: ContentOverrides | null = null, extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, { ...extra, contentOverrides: overrides });
  let seat = 0;
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "lookout" } : e)));
}

/**
 * A command; a round deadline is followed by its alibi deadline (nobody
 * posts). The result window (design §9.3) stays open until a move or a round
 * deadline closes it, so an emergency can be called in it.
 */
function handleThroughAlibis(state: GameState, command: unknown): CommandResult {
  const c = command as { type?: unknown; deadline?: { kind?: unknown } } | null;
  const planning = c?.type === "submitMove" || c?.deadline?.kind === "round";
  const s = state.phase.kind === "result" && !state.pendingEmergency && planning ? must(closeResultWindow(state)) : state;
  const r = handleCommand(s, command);
  if (!r.ok || r.state.phase.kind !== "alibis" || c?.deadline?.kind !== "round") return r;
  return handleCommand(r.state, { type: "advance", deadline: { kind: "alibis", round: r.state.phase.round } });
}
const must = (r: CommandResult): GameState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, typeof c === "function" ? c(s) : c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(typeof c === "function" ? c(s) : c)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: Cmd): string {
  const before = JSON.stringify(state);
  const r = handleThroughAlibis(state, typeof command === "function" ? command(state) : command);
  if (r.ok) throw new Error("expected a rejection");
  expect(JSON.stringify(state)).toBe(before);
  return r.reason;
}
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const used = (s: GameState, id: string) => (s.players[id] as PlayerState).roleState;

/** A move grabbing `room`'s whole limit, `pocket` of it pocketed. */
const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { ...fullGrab(room, pocket), ...extra } });
const watch = (player: string, room: string, extra: object = {}) => mv(player, "security", 0, { watch: room, ...extra });
/** The round being planned; from the result window, the next one (closing the window first). */
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.phase.kind === "result" ? s.round + 1 : s.round } });
/** Resolve the round being planned and stop in its alibi window (before the next round starts). */
const resolve = (s: GameState): GameState => must(handleCommand(s.phase.kind === "result" ? must(closeResultWindow(s)) : s, ROUND(s)));
const use = (player: string, ability: object) => ({ type: "useAbility", player, ability });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
/** `caller` calls an emergency meeting in the result window (resolving the round being planned first) and it opens at once. design §9.3 */
const emergency = (s: GameState, caller: string): GameState =>
  run(
    s,
    ...(s.phase.kind === "planning" ? [ROUND] : []),
    { type: "callEmergency", player: caller },
    (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.pendingEmergency?.meetingId } }),
  );
/** The meeting the game is waiting for (a regular meeting or a briefing), opened. design §9.4 */
const openDue = (s: GameState): GameState => {
  if (s.phase.kind !== "awaitingMeeting") throw new Error(`no meeting is due (${s.phase.kind})`);
  return run(s, { type: "scheduleMeeting", meetingId: s.phase.meetingId, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: s.phase.meetingId } });
};
/** After a raid: its police briefing, held with no votes. design §9.2 */
const pastBriefing = (s: GameState): GameState => run(openDue(s), CLOSE);
/** Play quiet Lobby rounds for 3 players until a regular meeting is due, and open it (design §9.1). */
const toRegularMeeting = (s: GameState): GameState => {
  let x = s;
  while (x.phase.kind !== "awaitingMeeting") x = run(x, mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "lobby"), ROUND);
  return openDue(x);
};

describe("the deal — design §11.3, §19.2 seam 8", () => {
  const dealt = (players: number, seed: string): string[] => {
    const s = createGame(config(players, { seed }));
    return s.playerOrder.map((id) => (s.players[id] as PlayerState).role);
  };
  const seeds = Array.from({ length: 30 }, (_, i) => `deal-${i}`);

  it("every player gets a role: distinct up to 10 players, at most 2 copies at 11–12, eyes and shadows within one", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      for (const seed of seeds) {
        const roles = dealt(n, seed);
        expect(roles).toHaveLength(n);
        for (const r of roles) expect(Object.keys(ROLES)).toContain(r);
        const counts = new Map<string, number>();
        for (const r of roles) counts.set(r, (counts.get(r) ?? 0) + 1);
        expect(counts.size, `${n} players, ${seed}`).toBe(Math.min(n, 10));
        expect(Math.max(...counts.values())).toBeLessThanOrEqual(n <= 10 ? 1 : 2);
        const eyes = roles.filter((r) => ROLES[r]?.kind === "eyes").length;
        expect(Math.abs(eyes - (n - eyes))).toBeLessThanOrEqual(1);
      }
    }
  });

  it("dealt with the seeded RNG: the same seed deals the same roles; every role, the Mole and Fixer included, can be dealt at 3", () => {
    expect(dealt(7, "same")).toEqual(dealt(7, "same"));
    const seen = new Set(seeds.flatMap((seed) => dealt(3, seed)));
    expect([...seen].sort()).toEqual(Object.keys(ROLES).sort());
    // An odd crew's extra seat goes either way.
    const eyes = new Set(seeds.map((seed) => dealt(3, seed).filter((r) => ROLES[r]?.kind === "eyes").length));
    expect([...eyes].sort()).toEqual([1, 2]);
  });

  it("the role list: Exact lists every role dealt with its count, Possible all ten, Hidden nothing", () => {
    const list = (players: number, roleList: RoleListSetting) => {
      const s = createGame(config(players, { roleList, seed: "list" }));
      return { s, shown: ofType(s.log, "roleListShown") };
    };
    const { s, shown } = list(12, "exact");
    const roles = s.playerOrder.map((id) => (s.players[id] as PlayerState).role);
    expect(shown[0]?.roles).toHaveLength(12);
    expect([...(shown[0]?.roles ?? [])].sort()).toEqual([...roles].sort());
    // In content order, so the list never tells seats apart.
    const order = Object.keys(ROLES);
    expect(shown[0]?.roles).toEqual([...roles].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(list(3, "possible").shown[0]?.roles).toEqual(order);
    expect(list(3, "hidden").shown).toEqual([]);
    expect(list(3, undefined as unknown as RoleListSetting).shown[0]?.list).toBe("exact");
  });

  it("every role has one handler, by id; only the Mole's and Fixer's carry a win rule (design §19.2 seam 4)", () => {
    expect(Object.keys(ROLE_HANDLERS).sort()).toEqual(Object.keys(ROLES).sort());
    expect(Object.entries(ROLE_HANDLERS).filter(([, h]) => h.winsSunk).map(([id]) => id).sort()).toEqual(["fixer", "mole"]);
  });

  it("content overrides tune each power's own numbers, never another role's (design §17.4)", () => {
    const ok = { hacker: { perStretch: 2 }, smoothTalker: { weight: 3 }, mole: { perStretch: 2 }, locksmith: { fewerRings: 0 }, fixer: { perGame: 2 } };
    expect(validateConfig(config(5, { contentOverrides: { roles: ok } }))).toEqual([]);
    expect(validateConfig(config(5, { contentOverrides: { roles: { hacker: { weight: 5 } } } }))).toEqual([expect.stringMatching(/hacker\.weight/)]);
    expect(validateConfig(config(5, { contentOverrides: { roles: { detective: { perStretch: 1 } } } }))).toEqual([expect.stringMatching(/detective\.perStretch/)]);
    expect(validateConfig(config(5, { contentOverrides: { roles: { mole: { perStretch: 0 } } } }))).toEqual([expect.stringMatching(/mole\.perStretch/)]);
  });
});

describe("Lookout: each round, also see who was in one more room — design §11.1", () => {
  it("sees who was in the watched room; one extra room only, in play", () => {
    const s = game(3, ["lookout"]);
    const after = resolve(run(s, mv("p0", "lobby", 0, { ability: { kind: "lookout", rooms: ["vault"] } }), mv("p1", "vault"), mv("p2", "vault")));
    expect(ofType(since(s, after), "roomWatched")).toEqual([
      { type: "roomWatched", visibility: { kind: "private", player: "p0" }, player: "p0", round: 1, source: "lookout", room: "vault", seen: ["p1", "p2"], offline: false },
    ]);
    expect(reason(s, mv("p0", "lobby", 0, { ability: { kind: "lookout", rooms: ["vault", "office"] } }))).toMatch(/1 to 1 room/);
    expect(reason(s, mv("p0", "lobby", 0, { ability: { kind: "lookout", rooms: ["serverRoom"] } }))).toMatch(/rooms in play/);
    expect(reason(s, mv("p1", "lobby", 0, { ability: { kind: "ring", room: "vault" } }))).toMatch(/your role has no ring ability/);
  });
});

describe("Locksmith: each coin rings one time fewer — design §5.2, §11.1", () => {
  it("a Locksmith's Office or Vault grab is silent; everyone else rings as usual", () => {
    const office = roomDef(BANK_JOB, "office");
    const vault = roomDef(BANK_JOB, "vault");
    expect([ringsOf(office, 2), ringsOf(office, 2, 1), ringsOf(vault, 3), ringsOf(vault, 3, 1), ringsOf(vault, 3, 0)]).toEqual([1, 0, 3, 0, 3]);
    const s = game(3, ["locksmith"]);
    const vaultOnly = ofType(since(s, resolve(run(s, mv("p0", "vault"), mv("p1", "office"), mv("p2", "lobby")))), "bellsRung")[0];
    expect(vaultOnly?.bells).toMatchObject({ vault: 0, office: 1 });
    const officeToo = ofType(since(s, resolve(run(s, mv("p0", "office"), mv("p1", "vault"), mv("p2", "lobby")))), "bellsRung")[0];
    expect(officeToo?.bells).toMatchObject({ vault: 3, office: 0 });
  });

  it("passive: it can't be used in a move", () => {
    expect(reason(game(3, ["locksmith"]), mv("p0", "lobby", 0, { ability: { kind: "muffle" } }))).toMatch(/isn't used in a move/);
  });
});

describe("Detective: each round, learn how many coins one player grabbed last round — design §11.1", () => {
  it("private, the grab not what was kept, seized coins included; once per resolved round", () => {
    let s = game(3, ["detective"]);
    expect(reason(s, use("p0", { kind: "detect", target: "p1" }))).toMatch(/no round has resolved/);
    // p1 and p2 ring the Vault 6 times: raided, both grabs seized (design §5.3).
    s = run(s, mv("p0", "lobby"), mv("p1", "vault", 2), mv("p2", "vault"), ROUND);
    expect(reason(s, use("p0", { kind: "detect", target: "p0" }))).toMatch(/another player/);
    const before = s;
    s = run(s, use("p0", { kind: "detect", target: "p1" }));
    expect(since(before, s)).toEqual([
      { type: "abilityResolved", visibility: { kind: "private", player: "p0" }, player: "p0", round: 1, ability: { kind: "detect", round: 1, target: "p1", grabbed: 3 } },
    ]);
    expect(reason(s, use("p0", { kind: "detect", target: "p2" }))).toMatch(/already looked into round 1/);
    expect(reason(s, use("p1", { kind: "detect", target: "p2" }))).toMatch(/no detect ability/);
    // Every round: the next resolved round can be looked into again; a player who grabbed in Security grabbed 0.
    s = run(pastBriefing(s), mv("p0", "lobby"), watch("p1", "lobby"), mv("p2", "office", 1), ROUND, use("p0", { kind: "detect", target: "p1" }));
    expect(ofType(s.log, "abilityResolved").at(-1)?.ability).toEqual({ kind: "detect", round: 2, target: "p1", grabbed: 0 });
    expect(used(s, "p0").usedThisStretch).toBe(0);
  });
});

describe("Auditor: once between meetings, coins that reached the duffel from one room — design §11.1, §11.2", () => {
  it("the room's hand-ins in the latest resolved round; once between meetings, back only at a regular meeting", () => {
    let s = game(3, ["auditor"]);
    s = run(s, mv("p0", "lobby"), mv("p1", "office"), mv("p2", "office", 1), ROUND, use("p0", { kind: "audit", room: "office" }));
    expect(ofType(s.log, "abilityResolved").at(-1)).toMatchObject({ player: "p0", visibility: { kind: "private", player: "p0" }, ability: { kind: "audit", round: 1, room: "office", duffel: 3 } });
    expect(reason(s, use("p0", { kind: "audit", room: "vault" }))).toMatch(/already audited a room since the last meeting/);
    // An emergency recharges nothing (design §9.3).
    s = run(emergency(s, "p1"), CLOSE);
    expect(reason(s, use("p0", { kind: "audit", room: "vault" }))).toMatch(/since the last meeting/);
    s = toRegularMeeting(s);
    expect(s.stretch).toBe(2);
    s = run(s, CLOSE, mv("p0", "lobby"), mv("p1", "vault", 1), mv("p2", "office"), ROUND, use("p0", { kind: "audit", room: "vault" }));
    expect(ofType(s.log, "abilityResolved").at(-1)?.ability).toMatchObject({ kind: "audit", room: "vault", duffel: 2 });
    expect(reason(s, use("p0", { kind: "audit", room: "office" }))).toMatch(/since the last meeting/);
  });

  it("one audit of a round is enough: a second charge can't audit the same round again", () => {
    const s = run(game(3, ["auditor"], { roles: { auditor: { perStretch: 2 } } }), ROUND, use("p0", { kind: "audit", room: "lobby" }));
    expect(reason(s, use("p0", { kind: "audit", room: "vault" }))).toMatch(/already audited round 1/);
  });

  it("refused before any round, for a room not in play, and for other roles", () => {
    const s = game(3, ["auditor"]);
    expect(reason(s, use("p0", { kind: "audit", room: "vault" }))).toMatch(/no round has resolved/);
    const after = run(s, ROUND);
    expect(reason(after, use("p0", { kind: "audit", room: "managersOffice" }))).toMatch(/room in play/);
    expect(reason(after, use("p1", { kind: "audit", room: "vault" }))).toMatch(/no audit ability/);
  });

  it("two Auditors keep their own charges (design §11.3, seam 9)", () => {
    const s = run(game(3, ["auditor", "auditor"]), ROUND, use("p0", { kind: "audit", room: "lobby" }), use("p1", { kind: "audit", room: "lobby" }));
    expect(ofType(s.log, "abilityResolved").map((e) => e.player)).toEqual(["p0", "p1"]);
    expect([used(s, "p0").usedThisStretch, used(s, "p1").usedThisStretch]).toEqual([1, 1]);
  });
});

describe("Smooth Talker: their vote counts twice — design §9.5, §11.1", () => {
  // 5 players: p0 Smooth Talker. p0 → p4, p1 → p4, p2 + p3 skip (p4 stays away). Weight 3 of 5: passes.
  const play = (roles: string[], mode: VoteVisibility = "hiddenThenRevealed") => {
    const s = emergency(game(5, roles, null, { voteVisibility: mode }), "p3");
    return run(s, vote("p0", "p4"), vote("p1", "p4"), vote("p2", null), vote("p3", null), CLOSE);
  };

  it.each(["hiddenThenRevealed", "open", "secret"] as const)(
    "%s: the double vote decides the result; the public tally counts one per ballot, so it never singles the Smooth Talker out",
    (mode) => {
      const closed = ofType(play(["smoothTalker"], mode).log, "meetingClosed").at(-1);
      expect(closed?.result).toEqual({ kind: "shakedown", target: "p4" });
      expect(closed?.tally).toEqual({ skip: 2, targets: { p4: 2 } });
      expect(closed?.ballots === null).toBe(mode === "secret");
      // Without a Smooth Talker the same ballots are a tie.
      expect(ofType(play([], mode).log, "meetingClosed").at(-1)?.result).toEqual({ kind: "noMajority" });
    },
  );

  it("two Smooth Talkers' ballots each count twice (design §11.4)", () => {
    // p0, p1 Smooth Talkers skip (4), p2, p3 → p4 (2): skipped.
    const s = emergency(game(5, ["smoothTalker", "smoothTalker"]), "p3");
    const after = run(s, vote("p0", null), vote("p1", null), vote("p2", "p4"), vote("p3", "p4"), CLOSE);
    expect(ofType(after.log, "meetingClosed").at(-1)).toMatchObject({ tally: { skip: 2, targets: { p4: 2 } }, result: { kind: "skipped" } });
  });

  it("quorum counts voters, not weight: 2 voters in a crew of 5 is no quorum even with a double vote", () => {
    const s = emergency(game(5, ["smoothTalker"]), "p3");
    const after = run(s, vote("p0", "p4"), vote("p1", "p4"), CLOSE);
    expect(ofType(after.log, "meetingClosed").at(-1)?.result).toEqual({ kind: "noQuorum" });
  });

  it("a sealed vote counts double too; skips weigh double as well", () => {
    let s = run(game(5, ["smoothTalker"]), { type: "sealVote", player: "p0", vote: { kind: "skip" } });
    s = emergency(s, "p3");
    s = run(s, vote("p1", "p4"), vote("p2", "p4"), vote("p3", null), CLOSE); // skip weight 3 of 5
    expect(ofType(s.log, "meetingClosed").at(-1)).toMatchObject({ tally: { skip: 2, targets: { p4: 2 } }, result: { kind: "skipped" } });
  });

  it("the power is passive: it can't be used in a move", () => {
    expect(reason(game(3, ["smoothTalker"]), mv("p0", "lobby", 0, { ability: { kind: "voteWeight" } }))).toMatch(/isn't used in a move/);
  });
});

describe("Hacker: once between meetings, hide one open room's bell this round — design §5.1, §11.1", () => {
  const hide = (room: string) => ({ ability: { kind: "hide", room } });

  it("the bell is left out of the public events and everyone else's view, shows as hidden, and the Hacker sees the real one", () => {
    const s = game(3, ["hacker"]);
    const after = resolve(run(s, mv("p0", "lobby", 0, hide("vault")), mv("p1", "vault"), mv("p2", "office")));
    const events = since(s, after);
    const rung = ofType(events, "bellsRung")[0];
    expect(rung?.hidden).toEqual(["vault"]);
    expect(rung?.bells).not.toHaveProperty("vault");
    expect(rung?.bells).toMatchObject({ office: 1 });
    expect(ofType(events, "bellsCooled")[0]?.bells).not.toHaveProperty("vault");
    // 3 rings, then cooled by 1.
    expect(ofType(events, "abilityResolved")).toEqual([
      { type: "abilityResolved", visibility: { kind: "private", player: "p0" }, player: "p0", round: 1, ability: { kind: "hide", room: "vault", bulbs: 2 } },
    ]);
    expect(after.bells.vault).toBe(2);
    for (const id of ["p1", "p2"]) {
      const v = viewFor(after, id);
      expect(v.bells).not.toHaveProperty("vault");
      expect(v.hiddenBells).toEqual(["vault"]);
      expect(JSON.stringify([...v.ledger, ...v.caseFile])).not.toMatch(/"bulbs"/);
    }
    expect(viewFor(after, "p0").bells.vault).toBe(2);
    expect(used(after, "p0").usedThisStretch).toBe(1);
    // design §11.1: it reappears when the next round starts.
    const next = must(closeResultWindow(run(after, { type: "advance", deadline: { kind: "alibis", round: 1 } })));
    expect(next.phase).toEqual({ kind: "planning", round: 2 });
    expect(viewFor(next, "p1").hiddenBells).toEqual([]);
    expect(viewFor(next, "p1").bells.vault).toBe(2);
  });

  it("a raid is always public: the raided room's bell is off, and the Hacker learns no bulbs", () => {
    const s = game(3, ["hacker"], { roles: { hacker: { perStretch: 2 } } });
    const after = resolve(run(s, mv("p0", "lobby", 0, hide("vault")), mv("p1", "vault"), mv("p2", "vault")));
    expect(ofType(since(s, after), "roomRaided")).toMatchObject([{ room: "vault", wanted: 1 }]);
    expect(ofType(since(s, after), "abilityResolved")[0]?.ability).toEqual({ kind: "hide", room: "vault", bulbs: null });
    expect(after.hidden).toEqual([]);
    expect(after.bells).not.toHaveProperty("vault");
    // A taped-off room's bell is off: it can't be hidden (design §5.3).
    const next = pastBriefing(run(after, { type: "advance", deadline: { kind: "alibis", round: 1 } }));
    expect(reason(next, mv("p0", "lobby", 0, hide("vault")))).toMatch(/taped-off room's bell is off/);
  });

  it("once between meetings; only a room in play", () => {
    const s = run(game(3, ["hacker"]), mv("p0", "lobby", 0, hide("office")), ROUND);
    expect(reason(s, mv("p0", "lobby", 0, hide("vault")))).toMatch(/already hidden a bell since the last meeting/);
    expect(reason(game(3, ["hacker"]), mv("p0", "lobby", 0, hide("serverRoom")))).toMatch(/room in play/);
  });
});

describe("Electrician: once between meetings, black out one room next round — design §11.1", () => {
  const cut = (room: string) => ({ ability: { kind: "blackout", room } });

  it("announced as the next round starts with no source; nobody there is seen, feeds are offline, its bell still rings", () => {
    // p0 Electrician; p1 Lookout; p2 and p3 in the Office in round 2.
    let s = must(closeResultWindow(run(game(4, ["electrician", "lookout"]), mv("p0", "lobby", 0, cut("office")), ROUND)));
    expect(ofType(s.log, "abilityResolved").at(-1)).toMatchObject({ player: "p0", visibility: { kind: "private", player: "p0" }, ability: { kind: "blackout", room: "office" } });
    expect(used(s, "p0").usedThisStretch).toBe(1);
    expect(ofType(s.log, "powerCut")).toEqual([{ type: "powerCut", visibility: { kind: "public" }, round: 2, room: "office" }]);
    expect(viewFor(s, "p3").dark).toEqual(["office"]);
    s = grantPerks(s, "p0", "tail");
    s = run(s, use("p0", { kind: "tail", room: "office" }));
    const before = s;
    s = resolve(run(s, watch("p0", "office"), mv("p1", "lobby", 0, { ability: { kind: "lookout", rooms: ["office"] } }), mv("p2", "office"), mv("p3", "office")));
    const events = since(before, s);
    expect(ofType(events, "roomSighting").filter((e) => e.room === "office").map((e) => e.others)).toEqual([[], []]);
    expect(ofType(events, "roomWatched").map((e) => [e.source, e.seen, e.offline])).toEqual([
      ["security", [], true],
      ["tail", [], true],
      ["lookout", [], true],
    ]);
    expect(ofType(events, "bellsRung")[0]?.bells.office).toBe(2);
    // The power cut ends with the round.
    s = run(s, { type: "advance", deadline: { kind: "alibis", round: 2 } }, (x: GameState) => ({ type: "advance", deadline: { kind: "result", round: x.resolvedRound } }));
    expect(s.dark).toEqual([]);
    expect(ofType(s.log, "powerCut")).toHaveLength(1);
  });

  it("a use in the last round is spent and harmless; once between meetings", () => {
    const last = run(game(3, ["electrician"], { roundCap: 1 }), mv("p0", "lobby", 0, cut("vault")), ROUND);
    expect(last.phase.kind).toBe("ended");
    expect(ofType(last.log, "powerCut")).toEqual([]);
    const s = run(game(3, ["electrician"]), mv("p0", "lobby", 0, cut("vault")), ROUND);
    expect(reason(s, mv("p0", "lobby", 0, cut("office")))).toMatch(/already cut the power/);
  });
});

describe("Priest: once between meetings, absolve one player at the split — design §4.2 step 5, §7.1, §11.1", () => {
  const absolve = (target: string) => ({ ability: { kind: "absolve", target } });

  it("takes what the target holds above the share before this split, sets it aside for the next split, and tells the target once", () => {
    const s = game(3, ["priest"]);
    // p1 pockets the Vault's 3 this round; p0 and p2 hand in the Lobby's 1 each.
    const r1 = resolve(run(s, mv("p0", "lobby", 0, absolve("p1")), mv("p1", "vault", 3), mv("p2", "lobby")));
    const events = since(s, r1);
    const types = events.map((e) => e.type);
    expect(types.indexOf("sinsAbsolved")).toBeLessThan(types.indexOf("duffelSplit"));
    expect(ofType(events, "abilityResolved")).toEqual([
      { type: "abilityResolved", visibility: { kind: "private", player: "p0" }, player: "p0", round: 1, ability: { kind: "absolve", target: "p1", taken: 3 } },
    ]);
    expect(ofType(events, "sinsAbsolved")).toEqual([{ type: "sinsAbsolved", visibility: { kind: "private", player: "p1" }, player: "p1", round: 1, taken: 3 }]);
    // Not in this split: the duffel is this round's 2 hand-ins only.
    expect(ofType(events, "duffelSplit")[0]).toMatchObject({ handedIn: 2, setAside: 0, cut: 0, kitty: 2 });
    expect(r1.setAside).toBe(3);
    expect(r1.players.p1?.stash).toBe(0);
    expect(viewFor(r1, "p2").caseFile.some((e) => e.event.type === "sinsAbsolved" || e.event.type === "abilityResolved")).toBe(false);
    expect(ofType(events, "roundResolved")[0]?.honesty).toEqual({ reached: 2, taken: 5 });
    // The next split shares them out, and they count toward honesty as they reach it (design §7.5).
    const r2 = run(r1, { type: "advance", deadline: { kind: "alibis", round: 1 } }, mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "lobby"), ROUND);
    expect(ofType(r2.log, "duffelSplit").at(-1)).toMatchObject({ handedIn: 3, setAside: 3, kittyIn: 2, cut: 2, kitty: 2 });
    expect(ofType(r2.log, "roundResolved").at(-1)?.honesty).toEqual({ reached: 8, taken: 8 });
    expect(r2.setAside).toBe(0);
  });

  it("works on a protected player; refused on yourself; never the same player twice in a row", () => {
    let s = game(3, ["priest"], { roles: { priest: { perStretch: 2 } } });
    s = run(s, mv("p1", "vault", 3), ROUND);
    s = run(emergency(s, "p2"), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    if (s.phase.kind === "shakedownPending") s = run(s, RESOLVE);
    expect(s.protected).toEqual(["p1"]);
    expect(reason(s, mv("p0", "lobby", 0, absolve("p0")))).toMatch(/another player/);
    expect(reason(s, mv("p0", "lobby", 0, absolve("ghost")))).toMatch(/unknown player/);
    s = run(s, mv("p0", "lobby", 0, absolve("p1")), mv("p1", "office", 2), ROUND);
    expect(ofType(s.log, "sinsAbsolved").at(-1)).toMatchObject({ player: "p1", round: 2 });
    expect(reason(s, mv("p0", "lobby", 0, absolve("p1")))).toMatch(/same player twice in a row/);
    s = run(s, mv("p0", "lobby", 0, absolve("p2")), ROUND);
    expect(used(s, "p0").usedThisStretch).toBe(2);
    expect(reason(s, mv("p0", "lobby", 0, absolve("p1")))).toMatch(/already absolved someone since the last meeting/);
  });

  it("on a bust it never resolves: the target keeps the stash and the Priest's use is spent", () => {
    // Bells of 3 bulbs and a bust at 1 star: the Vault's 3 coins raid it.
    let s = game(3, ["priest"], { alarm: { bulbs: 3, bustStars: 1 } });
    s = run(s, mv("p0", "lobby"), mv("p1", "office", 1), mv("p2", "lobby"), ROUND);
    const stash = s.players.p1?.stash;
    const after = run(s, mv("p0", "lobby", 0, absolve("p1")), mv("p1", "rooftop"), mv("p2", "vault"), ROUND);
    expect(after.phase.kind).toBe("ended");
    expect(ofType(since(s, after), "abilityResolved")[0]?.ability).toEqual({ kind: "absolve", target: "p1", taken: null });
    expect(ofType(since(s, after), "sinsAbsolved")).toEqual([]);
    expect(after.players.p1?.stash).toBe(stash);
    expect(used(after, "p0").usedThisStretch).toBe(1);
    expect(after.phase.kind === "ended" && after.phase.outcome.winners).toEqual(["p1"]);
  });

  it("in the last round the coins set aside go to the getaway car (design §6.3)", () => {
    const after = run(game(3, ["priest"], { roundCap: 1 }), mv("p0", "lobby", 0, absolve("p1")), mv("p1", "vault", 3), mv("p2", "lobby"), ROUND);
    expect(after.phase.kind === "ended" && after.phase.outcome).toMatchObject({ result: "failed", reason: "theft", getaway: 5 });
  });
});

describe("Mole: once between meetings, ring any room once — design §5.2, §11.1", () => {
  const ring = (room: string) => ({ ability: { kind: "ring", room } });

  it("an ordinary ring that can cause a raid; two Moles' rings stack (design §11.4)", () => {
    const s = game(3, ["mole", "mole"]);
    const rung = resolve(run(s, mv("p0", "lobby", 0, ring("office")), mv("p1", "lobby", 0, ring("office")), mv("p2", "lobby")));
    expect(ofType(since(s, rung), "bellsRung")[0]?.bells.office).toBe(2);
    expect([used(rung, "p0").usedThisStretch, used(rung, "p1").usedThisStretch]).toEqual([1, 1]);
    const raid = resolve(run(s, mv("p0", "lobby", 0, ring("vault")), mv("p1", "lobby"), mv("p2", "vault")));
    expect(ofType(since(s, raid), "roomRaided")).toMatchObject([{ room: "vault" }]);
  });

  it("never the Rooftop or a taped-off room; once between meetings", () => {
    const s = game(3, ["mole"]);
    expect(reason(s, mv("p0", "lobby", 0, ring("rooftop")))).toMatch(/Rooftop/);
    const raided = pastBriefing(run(s, mv("p0", "lobby", 0, ring("vault")), mv("p1", "vault"), ROUND));
    expect(raided.taped).toHaveProperty("vault");
    expect(reason(raided, mv("p0", "lobby", 0, ring("office")))).toMatch(/already rung a bell/);
    const fresh = pastBriefing(run(game(3, ["mole"], { roles: { mole: { perStretch: 2 } } }), mv("p1", "vault"), mv("p2", "vault"), ROUND));
    expect(reason(fresh, mv("p0", "lobby", 0, ring("vault")))).toMatch(/taped-off room's bell is off/);
  });
});

describe("Fixer: once per game, reopen a taped-off room — design §5.3, §11.1", () => {
  const reopen = (room: string) => ({ ability: { kind: "reopen", room } });
  const raidVault = (s: GameState) => pastBriefing(run(s, mv("p1", "vault"), mv("p2", "vault"), ROUND));

  it("open again from the next round with its bell at 0; once per game; only a taped-off room", () => {
    let s = raidVault(game(3, ["fixer"]));
    expect(s.taped).toEqual({ vault: 3 });
    expect(reason(s, mv("p0", "lobby", 0, reopen("office")))).toMatch(/taped-off room/);
    s = run(s, mv("p0", "lobby", 0, reopen("vault")), ROUND);
    expect(ofType(s.log, "roomReopened")).toEqual([{ type: "roomReopened", visibility: { kind: "public" }, round: 2, room: "vault" }]);
    expect(s.taped).toEqual({});
    expect(s.bells.vault).toBe(0);
    expect(used(s, "p0").usedThisGame).toBe(1);
    s = raidVault(s);
    expect(reason(s, mv("p0", "lobby", 0, reopen("vault")))).toMatch(/already reopened a room this game/);
  });
});

describe("copies of a role on the same target — design §11.4", () => {
  // 11 players: copies only happen at 11–12 (design §11.3).
  const eleven = (roles: string[], seed = "roles-seed", overrides: ContentOverrides | null = null) => game(11, roles, overrides, { seed });
  const idle = (from: number) => Array.from({ length: 11 - from }, (_, i) => mv(`p${from + i}`, "lobby"));
  const round = (s: GameState, ...moves: object[]) => {
    const after = resolve(run(s, ...moves, ...idle(moves.length)));
    return { after, events: since(s, after) };
  };

  it("a second Hacker, Electrician or Fixer on the same target has no effect, isn't spent, and is told it was already done", () => {
    for (const [role, ability] of [
      ["hacker", { kind: "hide", room: "vault" }],
      ["electrician", { kind: "blackout", room: "vault" }],
    ] as const) {
      const { after, events } = round(eleven([role, role]), mv("p0", "lobby", 0, { ability }), mv("p1", "lobby", 0, { ability }));
      const [done] = ofType(events, "abilityAlreadyDone");
      const [first] = ofType(events, "abilityResolved");
      expect(new Set([done?.player, first?.player])).toEqual(new Set(["p0", "p1"]));
      expect(done).toMatchObject({ visibility: { kind: "private", player: done?.player }, round: 1, ability });
      expect(used(after, done?.player as string).usedThisStretch).toBe(0);
      expect(used(after, first?.player as string).usedThisStretch).toBe(1);
      // The seat order was drawn, once.
      expect(ofType(events, "rngAdvanced")).toHaveLength(1);
    }
    const raided = pastBriefing(run(eleven(["fixer", "fixer"]), mv("p2", "vault"), mv("p3", "vault"), ...idle(4), ROUND));
    const reopen = { ability: { kind: "reopen", room: "vault" } };
    const { after, events } = round(raided, mv("p0", "lobby", 0, reopen), mv("p1", "lobby", 0, reopen));
    expect(ofType(events, "roomReopened")).toHaveLength(1);
    const done = ofType(events, "abilityAlreadyDone")[0]?.player as string;
    expect(used(after, done).usedThisGame).toBe(0);
  });

  it("the seat order comes from the seeded draw: either copy can go first, and the same seed repeats it", () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const play = () => round(eleven(["hacker", "hacker"], `copies-${i}`), mv("p0", "lobby", 0, { ability: { kind: "hide", room: "vault" } }), mv("p1", "lobby", 0, { ability: { kind: "hide", room: "vault" } }));
      const a = play().events;
      expect(a).toEqual(play().events);
      firsts.add(ofType(a, "abilityResolved")[0]?.player as string);
    }
    expect([...firsts].sort()).toEqual(["p0", "p1"]);
  });

  it("different targets: both act, and nothing is drawn", () => {
    const { events } = round(eleven(["hacker", "hacker"]), mv("p0", "lobby", 0, { ability: { kind: "hide", room: "vault" } }), mv("p1", "lobby", 0, { ability: { kind: "hide", room: "office" } }));
    expect(ofType(events, "abilityResolved")).toHaveLength(2);
    expect(ofType(events, "bellsRung")[0]?.hidden).toEqual(["vault", "office"]);
    expect(ofType(events, "rngAdvanced")).toEqual([]);
  });

  it("Priest: the second absolve finds nothing left, learns 0 as already done, isn't spent, and may absolve that player next", () => {
    const s = eleven(["priest", "priest"], "roles-seed", { roles: { priest: { perStretch: 2 } } });
    const absolve = { ability: { kind: "absolve", target: "p2" } };
    const { after, events } = round(s, mv("p0", "lobby", 0, absolve), mv("p1", "lobby", 0, absolve), mv("p2", "vault", 3));
    expect(ofType(events, "abilityResolved").map((e) => e.ability)).toEqual([{ kind: "absolve", target: "p2", taken: 3 }]);
    expect(ofType(events, "sinsAbsolved")).toHaveLength(1);
    const first = ofType(events, "abilityResolved")[0]?.player as string;
    const second = ofType(events, "abilityAlreadyDone")[0]?.player as string;
    expect(used(after, second).usedThisStretch).toBe(0);
    const next = run(after, { type: "advance", deadline: { kind: "alibis", round: 1 } });
    expect(reason(next, mv(first, "lobby", 0, absolve))).toMatch(/twice in a row/);
    run(next, mv(second, "lobby", 0, absolve));
  });

  it("Priest: on a target who was already clean, the second is an ordinary absolve: spent, learns 0; the target is told once", () => {
    const absolve = { ability: { kind: "absolve", target: "p2" } };
    const { after, events } = round(eleven(["priest", "priest"]), mv("p0", "lobby", 0, absolve), mv("p1", "lobby", 0, absolve), mv("p2", "vault"));
    expect(ofType(events, "abilityResolved").map((e) => e.ability)).toEqual([
      { kind: "absolve", target: "p2", taken: 0 },
      { kind: "absolve", target: "p2", taken: 0 },
    ]);
    expect(ofType(events, "abilityAlreadyDone")).toEqual([]);
    expect(ofType(events, "sinsAbsolved")).toHaveLength(1);
    expect([used(after, "p0").usedThisStretch, used(after, "p1").usedThisStretch]).toEqual([1, 1]);
  });
});

describe("the Mole's and Fixer's win on a heist sunk by theft, in their handlers — design §8.4, §8.5", () => {
  const ended = (roles: string[], stashes: number[]): GameState => {
    const s = game(roles.length, roles);
    const players = Object.fromEntries(s.playerOrder.map((id, i) => [id, { ...(s.players[id] as PlayerState), stash: stashes[i] as number }]));
    return { ...s, players };
  };

  it("each copy that holds or ties for the biggest stash of all wins, a tie with a player who can't win included; otherwise nobody", () => {
    expect(outcomeFor(ended(["mole", "lookout", "fixer"], [5, 5, 4]), "theft").winners).toEqual(["p0"]);
    expect(outcomeFor(ended(["mole", "mole", "fixer"], [5, 5, 5]), "theft").winners).toEqual(["p0", "p1", "p2"]);
    expect(outcomeFor(ended(["mole", "lookout", "fixer"], [4, 5, 4]), "theft").winners).toEqual([]);
    // On a success they win like everyone.
    expect(outcomeFor(ended(["mole", "lookout", "fixer"], [4, 5, 4]), null).winners).toEqual(["p1"]);
  });
});

describe("the shakedown window (a Shield in the shop) — design §8.3, §9.6", () => {
  // The shop pinned with a Shield, so a passed shakedown waits for its window (extension.md "Shakedowns").
  const shielded = (s: GameState): GameState => ({ ...s, shop: ["peek", "shield", "extraVote"] });
  // 3 players; p1 pockets the Vault's 3 in round 1, then p0 and p2 vote p1 down.
  const setup = () => {
    const s = run(shielded(game(3, [])), mv("p1", "vault", 3), ROUND);
    return run(emergency(s, "p2"), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
  };

  it("the window opens only when the shop holds a Shield", () => {
    expect(opensShakedownWindow(["peek", "alibi", "extraVote"])).toBe(false);
    expect(opensShakedownWindow(["peek", "shield", "extraVote"])).toBe(true);
    // No Shield in the shop: a passed shakedown is applied at once, no shakedownPending.
    const s = run({ ...game(3, []), shop: ["peek", "alibi", "extraVote"] }, mv("p1", "vault", 3), ROUND);
    const closed = run(emergency(s, "p2"), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(closed.log.some((e) => e.type === "shakedownPending")).toBe(false);
    expect(closed.players.p1?.stash).toBe(closed.share);
  });

  it("a passed shakedown waits in a public window; nothing is taken yet", () => {
    const s = setup();
    expect(s.phase).toEqual({ kind: "shakedownPending", meetingId: "emergency-1", target: "p1" });
    expect(s.log.at(-1)).toEqual({ type: "shakedownPending", visibility: { kind: "public" }, meetingId: "emergency-1", kind: "emergency", target: "p1" });
    expect(s.players.p1?.stash).toBe(3 + s.share);
  });

  it("without a Shield, the shakedown is applied when the window ends", () => {
    const s = setup();
    const after = run(s, RESOLVE);
    expect(since(s, after).map((e) => e.type)).toEqual(["shakedownResolved", "roundStarted"]);
    expect(after.players.p1?.stash).toBe(after.share);
    expect(after.phase).toEqual({ kind: "planning", round: 2 });
  });

  it("after a regular meeting the result window follows once the window ends (design §9.3)", () => {
    let s = shielded(game(3, []));
    s = run(s, mv("p1", "vault", 3), ROUND);
    while (s.phase.kind !== "awaitingMeeting") s = run(s, mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "lobby"), ROUND);
    const round = s.resolvedRound;
    s = run(s, { type: "scheduleMeeting", meetingId: s.phase.meetingId, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: s.phase.meetingId } });
    s = run(s, vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(s.phase.kind).toBe("shakedownPending");
    const after = run(s, RESOLVE);
    expect(since(s, after).map((e) => e.type)).toEqual(["shakedownResolved"]);
    expect(after.phase).toEqual({ kind: "result", round });
  });

  it("while the window is open: no rounds, no new meetings or proposals, and only the pending meeting's deadline", () => {
    const s = setup();
    expect(reason(s, ROUND(s))).toMatch(/no round deadline/);
    expect(reason(s, mv("p0", "lobby"))).toMatch(/round is being planned/);
    expect(reason(s, { type: "callEmergency", player: "p0" })).toMatch(/between a round's result and the next planning/);
    expect(reason(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "meeting-1" } })).toMatch(/no shakedown is pending/);
    expect(reason(s, CLOSE(s))).toMatch(/not open/);
  });
});
