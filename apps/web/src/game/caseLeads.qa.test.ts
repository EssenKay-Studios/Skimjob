// QA (S4.4, #105): adversarial games against the case board adapter, over real
// engine views (design §15.4, §18): leaks, false ⚠ on innocent players, the
// suspect, and pin ids.
import { handleCommand, viewFor, type GameConfig, type GameState, type Move, type PlanSnapshot, type PlayerCommand, type PlayerView, type SystemCommand } from "@skimjob/engine";
import { BANK_JOB, EVENTS } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import { suspectOf, type Lead } from "./caseBoard";
import { bellChecks, type CheckContext, type RoundFacts } from "./caseChecks";
import { caseData } from "./caseLeads";
import { createGame } from "./deal.testkit";

const config: GameConfig = {
  seed: "case-leads-qa",
  players: ["Sam", "Ava", "Ben", "Cleo", "Dev"].map((name, i) => ({ id: `p${i + 1}`, name, isBot: false })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  contentOverrides: null,
};
const ROLES = ["lookout", "detective", "hacker", "mole", "fixer"];

function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
const move = (player: string, m: Move): PlayerCommand => ({ type: "submitMove", player, move: m });
const grab = (room: string, coins = 1): Move => ({ room, duffel: coins, pocket: 0 });
const plan = (spots: [string, string][]): PlanSnapshot => ({ entries: spots.map(([player, room]) => ({ player, placed: null, room, power: null, agreed: true })), history: [] });

/** Round 1 with the given roles, moves (p1..p5) and plan spots, then the given commands. */
function round1(roles: string[], moves: Move[], spots: [string, string][], ...after: (PlayerCommand | SystemCommand)[]): GameState {
  let s = createGame(config, roles);
  s = run(s, ...moves.map((m, i) => move(`p${i + 1}`, m)), { type: "advance", deadline: { kind: "round", round: 1, plan: plan(spots) } });
  return run(s, ...after);
}
const warned = (s: GameState) => caseData(viewFor(s, "p1"), new Set()).leads.flatMap((l) => l.warnings.map((w) => ({ lead: l.id, kind: w.kind, names: w.names })));

describe("QA: Too quiet must not point at an innocent player — design §15.4", () => {
  it("doesn't count in the Vault a liar you saw in your own room, so Ava alone in the Vault isn't named", () => {
    // Ben says the Vault, but you stood in the Office with him.
    // Ava grabbed 1 in the Vault, says so truthfully, and it rang once, exactly her grab. The best case for Ben is that he was
    // where you saw him, so nothing in the Vault fails to add up for Ava.
    const s = round1(
      ROLES,
      [grab("office"), grab("vault"), grab("office"), grab("lobby"), grab("lobby")],
      [],
      { type: "postAlibi", player: "p2", round: 1, room: "vault" },
      { type: "postAlibi", player: "p3", round: 1, room: "vault" },
    );
    const w = warned(s);
    // Ben's own contradiction is still there.
    expect(w).toContainEqual({ lead: "r1.room.office", kind: "seenElsewhere", names: ["p3"] });
    expect(w.filter((x) => x.names.includes("p2"))).toEqual([]);
  });

  it("allows a Locksmith (per the Exact list) who grabbed 1 in the Vault and says so: no ⚠", () => {
    const s = round1(
      ["lookout", "locksmith", "detective", "mole", "fixer"],
      [grab("office"), grab("vault"), grab("office"), grab("lobby"), grab("lobby")],
      [["p2", "vault"]],
      { type: "postAlibi", player: "p2", round: 1, room: "vault" },
    );
    expect(warned(s)).toEqual([]);
  });
});

describe("QA: leaks — design §18", () => {
  it("a hidden bell: who really grabbed in the hidden Vault changes nothing on the board", () => {
    // Ben (Hacker, in the Office with you) hides the Vault. Ava and Dev swap Vault and Lobby (1 coin each:
    // same taken, Lobby silent). Both say Lobby. You see neither.
    const hide: Move = { ...grab("office"), ability: { kind: "hide", room: "vault" } };
    const alibis: PlayerCommand[] = [
      { type: "postAlibi", player: "p2", round: 1, room: "lobby" },
      { type: "postAlibi", player: "p5", round: 1, room: "lobby" },
    ];
    const a = round1(ROLES, [grab("office"), grab("vault"), hide, grab("lobby"), grab("lobby")], [], ...alibis);
    const b = round1(ROLES, [grab("office"), grab("lobby"), hide, grab("lobby"), grab("vault")], [], ...alibis);
    expect(a.log).not.toEqual(b.log);
    const da = caseData(viewFor(a, "p1"), new Set());
    expect(da).toEqual(caseData(viewFor(b, "p1"), new Set()));
    expect(da.leads.flatMap((l) => l.warnings)).toEqual([]);
  });

  it("another player's private sightings and secret coins don't change your leads, ⚠ or suspect", () => {
    // Cleo (Security) watches the Vault or the Lobby; Ben pockets or hands in. Neither is in your view.
    const a = round1(ROLES, [grab("office"), grab("vault"), grab("office"), { room: "security", duffel: 0, pocket: 0, watch: "vault" }, grab("lobby")], [["p5", "vault"]]);
    const b = round1(ROLES, [grab("office"), grab("vault"), { room: "office", duffel: 0, pocket: 1 }, { room: "security", duffel: 0, pocket: 0, watch: "lobby" }, grab("lobby")], [["p5", "vault"]]);
    expect(a.log).not.toEqual(b.log);
    // The round summary's "missing" is public, so compare what the ⚠ and suspect read.
    const pick = (s: GameState) => {
      const d = caseData(viewFor(s, "p1"), new Set());
      return { warnings: d.leads.map((l) => [l.id, l.warnings]), suspect: d.suspect };
    };
    expect(pick(a)).toEqual(pick(b));
  });
});

describe("QA: pin ids — design §15.4", () => {
  it("every lead and fact id passes the server's pin id rule and is unique", () => {
    // With the "no alibi" facts and your own marks (design §10).
    const s = round1(
      ROLES,
      [grab("office"), grab("vault"), grab("office"), grab("lobby"), grab("lobby")],
      [["p3", "vault"], ["p5", "office"]],
      { type: "postAlibi", player: "p5", round: 1, room: "security" },
      { type: "advance", deadline: { kind: "alibi", round: 1 } },
      { type: "markAlibi", player: "p1", round: 1, target: "p5", mark: "liar" },
      { type: "markAlibi", player: "p1", round: 1, target: "p2", mark: "trusted" },
    );
    const ids = caseData(viewFor(s, "p1"), new Set()).leads.flatMap((l) => [l.id, ...l.facts.map((f) => f.id)]);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_.:-]{1,80}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ids don't change when a later alibi and a role claim arrive", () => {
    let s = round1(ROLES, [grab("office"), grab("vault"), grab("office"), grab("lobby"), grab("lobby")], [["p3", "vault"]]);
    const ids = (st: GameState) => caseData(viewFor(st, "p1"), new Set()).leads.flatMap((l) => [l.id, ...l.facts.map((f) => `${f.id}=${f.text}`)]);
    const before = ids(s);
    s = run(s, { type: "postAlibi", player: "p3", round: 1, room: "office" }, { type: "claimRole", player: "p4", role: "fixer" });
    expect(ids(s)).toEqual(expect.arrayContaining(before));
  });
});

describe("QA: the suspect — design §15.4", () => {
  const lead = (id: string, round: number, warnings: { names: string[]; text: string }[]): Lead => ({
    id,
    round,
    title: id,
    bell: false,
    names: [],
    facts: [],
    warnings: warnings.map((w) => ({ kind: "tooQuiet", ...w })),
  });
  const seats = ["p1", "p2", "p3", "p4", "p5"];

  it("never names you, even when you top every ⚠", () => {
    const leads = [lead("a", 1, [{ names: ["p1"], text: "x" }, { names: ["p1", "p4"], text: "y" }])];
    expect(suspectOf(leads, new Set(), "p1", seats)?.player).toBe("p4");
    expect(suspectOf([lead("a", 1, [{ names: ["p1"], text: "x" }])], new Set(), "p1", seats)).toBeNull();
  });

  it("breaks a full tie by seat order, whatever order the warning lists them in", () => {
    const one = suspectOf([lead("a", 2, [{ names: ["p5", "p3"], text: "x" }])], new Set(), "p1", seats);
    const two = suspectOf([lead("a", 2, [{ names: ["p3", "p5"], text: "x" }])], new Set(), "p1", seats);
    expect(one?.player).toBe("p3");
    expect(two?.player).toBe("p3");
  });

  it("on equal points, picks the most recent round's contradiction, not the first lead", () => {
    const leads = [lead("late", 5, [{ names: ["p5"], text: "late" }]), lead("early", 1, [{ names: ["p2"], text: "early" }])];
    expect(suspectOf(leads, new Set(), "p1", seats)).toEqual({ player: "p5", reason: "late" });
  });
});

describe("QA: Too quiet best cases combined — design §15.4", () => {
  const ctx: CheckContext = { me: "p1", myRole: "lookout", job: BANK_JOB, events: EVENTS, roleList: { list: "exact", roles: ROLES }, crewSize: 5 };
  const base: RoundFacts = { round: 3, card: null, rooms: new Map(), alibis: new Map(), noAlibi: new Map(), softShoes: 0, planted: 0, mySoftShoes: false, bankEmptied: false };
  const vault = (seen: [string, "room" | "feed"][], rings: number) =>
    new Map([["vault", { rings, raided: false, dark: false, watched: true, seen: new Map(seen), myCoins: null }]]);

  it("a planted feed sighting and Soft shoes together can silence both players", () => {
    const r = { ...base, rooms: vault([["p2", "feed"], ["p3", "feed"]], 0), planted: 1, softShoes: 1 };
    expect(bellChecks(r, ctx, (p) => p)).toEqual([]);
  });

  it("a dry bank lets the Vault ring nothing with two players there", () => {
    const r = { ...base, rooms: vault([["p2", "room"], ["p3", "room"]], 0), bankEmptied: true };
    expect(bellChecks(r, ctx, (p) => p)).toEqual([]);
  });

  it("a blacked-out Vault you stood in, with nobody counted, gets no Too quiet", () => {
    const r = { ...base, rooms: new Map([["vault", { rings: 1, raided: false, dark: true, watched: false, seen: new Map(), myCoins: 1 }]]) };
    expect(bellChecks(r, ctx, (p) => p).filter((f) => f.warning.kind === "tooQuiet")).toEqual([]);
  });
});

describe("QA re-run: count a player only where seen, and your own plant — design §12, §15.4", () => {
  it("a Lookout feed sighting elsewhere also keeps a liar out of the Vault's count, so Ava alone there isn't named", () => {
    // You (Lookout) grab in the Office and watch the Lobby: Ben is on its feed. Ben says the Vault; Ava really grabbed 1 there.
    const s = round1(
      ROLES,
      [{ ...grab("office"), ability: { kind: "lookout", rooms: ["lobby"] } }, grab("vault"), grab("lobby"), grab("office"), grab("lobby")],
      [],
      { type: "postAlibi", player: "p2", round: 1, room: "vault" },
      { type: "postAlibi", player: "p3", round: 1, room: "vault" },
    );
    const w = warned(s);
    expect(w.filter((x) => x.names.includes("p2"))).toEqual([]);
    // Ben's lie is still flagged where the feed showed him.
    expect(w.some((x) => x.kind === "seenElsewhere" && x.names.includes("p3"))).toBe(true);
  });

  it("drops only the exact sighting you planted: another round, another room or another player keeps its ⚠", () => {
    // You sit in Security watching the Vault; Ava and Dev grab there. Dev says the Lobby, so the feed catches him.
    const s = round1(
      ROLES,
      [{ room: "security", duffel: 0, pocket: 0, watch: "vault" }, grab("vault"), grab("office"), grab("office"), grab("vault")],
      [],
      { type: "postAlibi", player: "p5", round: 1, room: "lobby" },
    );
    const v = viewFor(s, "p1");
    const withPlant = (round: number, target: string, room: string): PlayerView =>
      ({
        ...v,
        caseFile: [...v.caseFile, { seq: 9000, event: { type: "perkBought", visibility: { kind: "private", player: "p1" }, player: "p1", round, perk: { kind: "plantEvidence", target, room }, cost: 3 } }],
      }) as PlayerView;
    const devFlagged = (view: PlayerView) =>
      caseData(view, new Set()).leads.some((l) => l.warnings.some((w) => w.kind === "seenElsewhere" && w.names.includes("p5")));
    expect(devFlagged(v)).toBe(true);
    expect(devFlagged(withPlant(2, "p5", "vault"))).toBe(true);
    expect(devFlagged(withPlant(1, "p5", "office"))).toBe(true);
    expect(devFlagged(withPlant(1, "p2", "vault"))).toBe(true);
    // Control: the plant you really made (Dev on the Vault, round 1) is dropped.
    expect(devFlagged(withPlant(1, "p5", "vault"))).toBe(false);
  });
});
