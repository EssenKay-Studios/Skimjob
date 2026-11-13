// The ⚠ checks (design §15.4), each with its edge cases, over hand-made rounds.
import { BANK_JOB, EVENTS } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import { bellChecks, overClaimed, storyChecks, type CheckContext, type RoomRound, type RoundFacts } from "./caseChecks";

const name = (p: string) => ({ p1: "Sam", p2: "Ava", p3: "Ben", p4: "Cleo", p5: "Dev" })[p] ?? p;
const room = (r: Partial<RoomRound> = {}): RoomRound => ({ rings: 0, raided: false, dark: false, watched: false, seen: new Map(), myCoins: null, ...r });
const round = (r: Partial<RoundFacts> = {}): RoundFacts => ({
  round: 4,
  card: null,
  rooms: new Map(),
  plan: new Map(),
  alibis: new Map(),
  softShoes: 0,
  planted: 0,
  mySoftShoes: false,
  bankEmptied: false,
  ...r,
});
const ctx = (c: Partial<CheckContext> = {}): CheckContext => ({
  me: "p1",
  myRole: "lookout",
  job: BANK_JOB,
  events: EVENTS,
  roleList: { list: "exact", roles: ["lookout", "detective", "hacker", "mole", "fixer"] },
  crewSize: 5,
  ...c,
});
const kinds = (found: { warning: { kind: string } }[]) => found.map((f) => f.warning.kind);

describe("Seen elsewhere — design §15.4", () => {
  it("names a player you saw in one room whose plan spot or alibi says another", () => {
    const r = round({ rooms: new Map([["vault", room({ watched: true, seen: new Map([["p5", "feed"]]) })]]), alibis: new Map([["p5", "security"]]) });
    const [f] = storyChecks(r, "p1", name);
    expect(f).toEqual({ round: 4, room: "vault", warning: { kind: "seenElsewhere", names: ["p5"], text: "Said Security in R4; you saw Dev in the Vault." } });
    // The plan spot when there is no alibi.
    const planned = storyChecks({ ...r, alibis: new Map(), plan: new Map([["p5", "office"]]) }, "p1", name);
    expect(planned[0]?.warning.text).toBe("Planned Office in R4; you saw Dev in the Vault.");
  });

  it("is quiet when the story matches, when there is no story, and never about you", () => {
    const rooms = new Map([["vault", room({ watched: true, seen: new Map([["p5", "room"]]) })]]);
    expect(storyChecks(round({ rooms, alibis: new Map([["p5", "vault"]]) }), "p1", name)).toEqual([]);
    expect(storyChecks(round({ rooms }), "p1", name)).toEqual([]);
    expect(storyChecks(round({ rooms, alibis: new Map([["p5", "office"]]) }), "p5", name)).toEqual([]);
  });

  it("says a feed sighting can be planted when Plant evidence was bought that round; your own room's sighting can't be", () => {
    const alibis = new Map([["p5", "office"]]);
    const feed = storyChecks(round({ rooms: new Map([["vault", room({ watched: true, seen: new Map([["p5", "feed"]]) })]]), alibis, planted: 1 }), "p1", name);
    expect(feed[0]?.warning.text).toMatch(/A sighting can be planted\.$/);
    const inRoom = storyChecks(round({ rooms: new Map([["vault", room({ watched: true, seen: new Map([["p5", "room"]]) })]]), alibis, planted: 1 }), "p1", name);
    expect(inRoom[0]?.warning.text).not.toMatch(/planted/);
  });
});

describe("Not seen — design §15.4", () => {
  it("names a player who claims a room you watched and wasn't seen there", () => {
    const r = round({ rooms: new Map([["vault", room({ watched: true, seen: new Map([["p4", "feed"]]) })]]), plan: new Map([["p3", "vault"]]) });
    expect(storyChecks(r, "p1", name)).toEqual([
      { round: 4, room: "vault", warning: { kind: "notSeen", names: ["p3"], text: "Planned Vault in R4; you watched the Vault and didn't see Ben." } },
    ]);
  });

  it("is skipped for a blacked-out room, for a room you didn't watch, and for you", () => {
    const plan = new Map([["p3", "vault"]]);
    expect(storyChecks(round({ rooms: new Map([["vault", room({ watched: true, dark: true })]]), plan }), "p1", name)).toEqual([]);
    expect(storyChecks(round({ rooms: new Map([["vault", room()]]), plan }), "p1", name)).toEqual([]);
    expect(storyChecks(round({ rooms: new Map([["vault", room({ watched: true })]]), plan: new Map([["p1", "vault"]]) }), "p1", name)).toEqual([]);
  });
});

describe("Changed story — design §15.4 (the plan snapshot, #179)", () => {
  it("names a player whose alibi differs from their plan spot, on the planned room", () => {
    const r = round({ plan: new Map([["p5", "office"]]), alibis: new Map([["p5", "security"]]) });
    expect(storyChecks(r, "p1", name)).toEqual([{ round: 4, room: "office", warning: { kind: "changedStory", names: ["p5"], text: "Planned Office in R4; later said Security." } }]);
  });

  it("is quiet when they agree, or when either is missing", () => {
    expect(storyChecks(round({ plan: new Map([["p5", "office"]]), alibis: new Map([["p5", "office"]]) }), "p1", name)).toEqual([]);
    expect(storyChecks(round({ plan: new Map([["p5", "office"]]) }), "p1", name)).toEqual([]);
    expect(storyChecks(round({ alibis: new Map([["p5", "office"]]) }), "p1", name)).toEqual([]);
  });
});

describe("Too quiet — design §15.4", () => {
  const vault = (r: Partial<RoomRound>) => new Map([["vault", room(r)]]);
  it("names everyone counted when the room rang less than their quietest grabs", () => {
    // Two seen in the Vault: each rings at least 1 (no Locksmith on the Exact list), it rang once.
    const r = round({ rooms: vault({ rings: 1, watched: true, seen: new Map([["p4", "feed"], ["p5", "feed"]]) }) });
    expect(bellChecks(r, ctx(), name)).toEqual([
      { round: 4, room: "vault", warning: { kind: "tooQuiet", names: ["p4", "p5"], text: "The Vault rang once in R4; Cleo and Dev there should ring at least 2." } },
    ]);
  });

  it("counts claimants too, and you with your real grab", () => {
    const r = round({ rooms: vault({ rings: 2, myCoins: 2 }), plan: new Map([["p3", "vault"]]) });
    expect(bellChecks(r, ctx(), name).map((f) => f.warning)).toEqual([{ kind: "tooQuiet", names: ["p3"], text: "The Vault rang 2 times in R4; Ben there should ring at least 3 with you." }]);
    // You wore Soft shoes: your coins rang nothing.
    expect(bellChecks({ ...r, mySoftShoes: true }, ctx(), name)).toEqual([]);
  });

  it("allows a Locksmith when the role list says one could be there, but not when you hold the only one", () => {
    const r = round({ rooms: vault({ rings: 0, watched: true, seen: new Map([["p5", "room"]]) }) });
    const withLocksmith = { list: "exact" as const, roles: ["lookout", "locksmith", "hacker", "mole", "fixer"] };
    expect(bellChecks(r, ctx({ roleList: withLocksmith }), name)).toEqual([]);
    expect(kinds(bellChecks(r, ctx({ roleList: withLocksmith, myRole: "locksmith" }), name))).toEqual(["tooQuiet"]);
    // Hidden list: anyone could be.
    expect(bellChecks(r, ctx({ roleList: null }), name)).toEqual([]);
    // Possible list without the Locksmith: nobody.
    expect(kinds(bellChecks(r, ctx({ roleList: { list: "possible", roles: ["lookout", "hacker"] } }), name))).toEqual(["tooQuiet"]);
  });

  it("lets Soft shoes bought the round before silence that many of them", () => {
    const seen = new Map<string, "room" | "feed">([["p4", "room"], ["p5", "room"]]);
    const r = round({ rooms: vault({ rings: 1, watched: true, seen }), softShoes: 1 });
    expect(bellChecks(r, ctx(), name)).toEqual([]);
    // One pair of Soft shoes silences one of the two, not both.
    expect(kinds(bellChecks({ ...r, rooms: vault({ rings: 0, watched: true, seen }) }, ctx(), name))).toEqual(["tooQuiet"]);
    expect(bellChecks({ ...r, rooms: vault({ rings: 0, watched: true, seen }), softShoes: 2 }, ctx(), name)).toEqual([]);
  });

  it("drops a feed sighting that may be planted, but never one from your own room or a claimant", () => {
    const seen = new Map<string, "room" | "feed">([["p4", "room"], ["p5", "feed"]]);
    const r = round({ rooms: vault({ rings: 1, watched: true, seen }), planted: 1 });
    expect(bellChecks(r, ctx(), name)).toEqual([]);
    expect(kinds(bellChecks({ ...r, plan: new Map([["p5", "vault"]]) }, ctx(), name))).toEqual(["tooQuiet"]);
    expect(kinds(bellChecks({ ...r, rooms: vault({ rings: 1, watched: true, seen: new Map([["p4", "room"], ["p5", "room"]]) }) }, ctx(), name))).toEqual(["tooQuiet"]);
  });

  it("counts a player you saw elsewhere only there, not in the room their story claims (Opus review repro)", () => {
    // Ava's alibi (the Vault) is true and it rang once; Dev also says the Vault, but you saw him in your own room, the Office.
    const r = round({
      rooms: new Map([
        ["vault", room({ rings: 1 })],
        ["office", room({ rings: 1, watched: true, myCoins: 2, seen: new Map([["p5", "room"]]) })],
      ]),
      alibis: new Map([["p2", "vault"], ["p5", "vault"]]),
    });
    expect(bellChecks(r, ctx(), name).filter((f) => f.room === "vault")).toEqual([]);
    // Dev's lie is still caught, by Seen elsewhere.
    expect(kinds(storyChecks(r, "p1", name))).toContain("seenElsewhere");
  });

  it("never runs on a hidden or unknown bell, nor on a raid (the capped bell only says at least)", () => {
    const seen = new Map<string, "room" | "feed">([["p4", "room"], ["p5", "room"]]);
    expect(bellChecks(round({ rooms: vault({ rings: null, watched: true, seen }) }), ctx(), name)).toEqual([]);
    expect(bellChecks(round({ rooms: vault({ rings: 1, raided: true, watched: true, seen }) }), ctx(), name)).toEqual([]);
  });

  it("allows a grab cut to 0 when the bank ran dry (design §3.2), and a silent Lobby", () => {
    const seen = new Map<string, "room" | "feed">([["p5", "room"]]);
    expect(bellChecks(round({ rooms: vault({ rings: 0, watched: true, seen }), bankEmptied: true }), ctx(), name)).toEqual([]);
    expect(bellChecks(round({ rooms: new Map([["lobby", room({ rings: 0, watched: true, seen })]]) }), ctx(), name)).toEqual([]);
  });

  it("still runs in a blacked-out room on what its claimants say (its bell rings)", () => {
    const r = round({ rooms: vault({ rings: 0, dark: true }), alibis: new Map([["p5", "vault"]]) });
    expect(kinds(bellChecks(r, ctx(), name))).toEqual(["tooQuiet"]);
  });
});

describe("Too loud — design §15.4", () => {
  const seen = new Map<string, "room" | "feed">([["p5", "room"]]);
  it("names nobody when the room rang more than everyone counted could", () => {
    const [f] = bellChecks(round({ rooms: new Map([["office", room({ rings: 3, watched: true, seen })]]) }), ctx(), name);
    expect(f?.warning).toEqual({ kind: "tooLoud", names: [], text: "The Office rang 3 times in R4; who was there can ring at most 2." });
  });

  it("counts Shift change's extra coin, and a raid's capped bell as at least", () => {
    const vault = (r: Partial<RoomRound>) => new Map([["vault", room({ watched: true, seen, ...r })]]);
    expect(bellChecks(round({ rooms: vault({ rings: 4 }) }), ctx(), name)[0]?.warning.kind).toBe("tooLoud");
    expect(bellChecks(round({ rooms: vault({ rings: 4 }), card: { round: 4, id: "shiftChange", room: null } }), ctx(), name)).toEqual([]);
    expect(bellChecks(round({ rooms: vault({ rings: 4, raided: true }) }), ctx(), name)[0]?.warning.text).toBe("The Vault rang at least 4 times in R4; who was there can ring at most 3.");
  });

  it("needs someone counted or a room you watched: an unwatched, unclaimed room rings for anyone", () => {
    expect(bellChecks(round({ rooms: new Map([["vault", room({ rings: 3 })]]) }), ctx(), name)).toEqual([]);
    expect(kinds(bellChecks(round({ rooms: new Map([["vault", room({ rings: 1, watched: true })]]) }), ctx(), name))).toEqual(["tooLoud"]);
  });
});

describe("Over-claimed role — design §15.4, §11.3", () => {
  const claims = (xs: [string, string, number][]) => new Map(xs.map(([p, role, round]) => [p, { role, round }]));
  it("names every claimant when more claim a role than the Exact list dealt, on the latest claim's round", () => {
    const found = overClaimed(claims([["p2", "detective", 2], ["p5", "detective", 3]]), ctx(), name);
    expect(found).toEqual([{ round: 3, room: null, warning: { kind: "overClaimed", names: ["p2", "p5"], text: "Ava and Dev claim the Detective; 1 was dealt." } }]);
  });

  it("counts your own copy: one claim of your role is already one too many", () => {
    expect(overClaimed(claims([["p2", "lookout", 1]]), ctx(), name)[0]?.warning.text).toBe("Ava claims the Lookout; 1 was dealt, and you are one.");
    expect(overClaimed(claims([["p2", "lookout", 1]]), ctx({ roleList: { list: "exact", roles: ["lookout", "lookout"] } }), name)).toEqual([]);
  });

  it("reads a Possible list (absent: 0) and a Hidden one (1 each, 2 from 11 players)", () => {
    expect(overClaimed(claims([["p2", "priest", 1]]), ctx({ roleList: { list: "possible", roles: ["lookout"] } }), name)[0]?.warning.text).toBe("Ava claims the Priest; it isn't in play.");
    // An Exact list without the role says the same, not "0 were dealt".
    expect(overClaimed(claims([["p2", "priest", 1]]), ctx(), name)[0]?.warning.text).toBe("Ava claims the Priest; it isn't in play.");
    const two = claims([["p2", "priest", 1], ["p3", "priest", 1]]);
    expect(kinds(overClaimed(two, ctx({ roleList: null }), name))).toEqual(["overClaimed"]);
    expect(overClaimed(two, ctx({ roleList: null, crewSize: 11 }), name)).toEqual([]);
  });

  it("ignores your own claim", () => {
    expect(overClaimed(claims([["p1", "detective", 1], ["p2", "detective", 1]]), ctx(), name)).toEqual([]);
  });
});
