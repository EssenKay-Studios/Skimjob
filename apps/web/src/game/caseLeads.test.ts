// The case board adapter over real engine views (design §15.4, §18): leads, ⚠,
// the suspect and stable pin ids, all from viewFor() alone.
import { handleCommand, viewFor, type GameConfig, type GameState, type Move, type PlanSnapshot, type PlayerCommand, type PlayerView, type SystemCommand } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { caseData } from "./caseLeads";
import { createGame } from "./deal.testkit";

const config: GameConfig = {
  seed: "case-leads",
  players: ["Sam", "Ava", "Ben", "Cleo", "Dev"].map((name, i) => ({ id: `p${i + 1}`, name, isBot: false })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  contentOverrides: null,
};

function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
const move = (player: string, m: Move): PlayerCommand => ({ type: "submitMove", player, move: m });
const PLAN: PlanSnapshot = {
  entries: [
    { player: "p3", placed: null, room: "vault", power: null, agreed: true },
    { player: "p5", placed: null, room: "office", power: null, agreed: true },
  ],
  history: [],
};

/**
 * Round 1: you (p1, Lookout) sit in Security watching the Vault; Ava and Dev
 * grab in the Vault, Ben in the Office, Cleo `cleo`. The plan put Ben in the
 * Vault and Dev in the Office; afterwards Dev says he was in Security.
 */
function game(roles: string[], cleo: Move): GameState {
  let s = createGame(config, roles);
  s = run(
    s,
    move("p1", { room: "security", duffel: 0, pocket: 0, watch: "vault" }),
    move("p2", { room: "vault", duffel: 1, pocket: 0 }),
    move("p3", { room: "office", duffel: 1, pocket: 0 }),
    move("p4", cleo),
    move("p5", { room: "vault", duffel: 1, pocket: 0 }),
    { type: "advance", deadline: { kind: "round", round: 1, plan: PLAN } },
  );
  return run(s, { type: "postAlibi", player: "p5", round: 1, room: "security" });
}
const ROLES = ["lookout", "detective", "hacker", "mole", "fixer"];
const view = (s: GameState) => viewFor(s, "p1");

describe("the case board adapter — design §15.4", () => {
  const data = caseData(view(game(ROLES, { room: "lobby", duffel: 1, pocket: 0 })), new Set());
  const lead = (id: string) => data.leads.find((l) => l.id === id)!;

  it("gathers a room's facts into one lead with each trust level", () => {
    const vault = lead("r1.room.vault");
    expect(vault.title).toBe("Vault");
    expect(vault.bell).toBe(true);
    expect(vault.facts.map((f) => f.trust)).toEqual(expect.arrayContaining(["fact", "seen", "said"]));
    expect(vault.facts.map((f) => f.text)).toEqual(expect.arrayContaining(["The bell rang 2 times (2 lit).", "Round 1, on the cameras: Ava and Dev in the Vault.", "Plan: Ben → Vault"]));
    expect(vault.summary).toBe("rang 2 · seen Ava, Dev · claimed Ben");
    expect(vault.names).toEqual(expect.arrayContaining(["p2", "p3", "p5"]));
  });

  it("fires Seen elsewhere, Not seen and Changed story from the plan snapshot and the alibi", () => {
    const warnings = data.leads.flatMap((l) => l.warnings.map((w) => [l.id, w.kind, w.names.join()]));
    expect(warnings).toEqual(
      expect.arrayContaining([
        ["r1.room.vault", "seenElsewhere", "p5"],
        ["r1.room.vault", "notSeen", "p3"],
        ["r1.room.office", "changedStory", "p5"],
        // You sat in Security yourself, where Dev says he was.
        ["r1.room.security", "notSeen", "p5"],
        // Ben's plan spot counts him in the Vault: three there ring at least 3, it rang 2.
        ["r1.room.vault", "tooQuiet", "p2,p5,p3"],
      ]),
    );
    expect(warnings).toHaveLength(5);
  });

  it("names the most likely liar with their most recent contradiction", () => {
    expect(data.suspect).toEqual({ player: "p5", reason: "Said Security in R1; you watched Security and didn't see Dev." });
  });

  it("keeps lead and fact ids stable as the game goes on, and unique", () => {
    let s = game(ROLES, { room: "lobby", duffel: 1, pocket: 0 });
    const before = caseData(view(s), new Set());
    s = run(s, { type: "advance", deadline: { kind: "result", round: 1 } });
    for (const p of ["p1", "p2", "p3", "p4", "p5"]) s = run(s, move(p, { room: "lobby", duffel: 1, pocket: 0 }));
    s = run(s, { type: "advance", deadline: { kind: "round", round: 2 } }, { type: "claimRole", player: "p2", role: "lookout" });
    const after = caseData(view(s), new Set());
    const ids = (d: typeof after) => d.leads.flatMap((l) => [l.id, ...l.facts.map((f) => `${f.id}=${f.text}`)]);
    expect(ids(after)).toEqual(expect.arrayContaining(ids(before)));
    const all = after.leads.flatMap((l) => [l.id, ...l.facts.map((f) => f.id)]);
    expect(new Set(all).size).toBe(all.length);
    // Ava claims your role, the only Lookout dealt: over-claimed, on the crew lead.
    expect(after.leads.find((l) => l.id === "r2.crew")?.warnings.map((w) => w.kind)).toEqual(["overClaimed"]);
  });

  it("reads only the pinned leads for the suspect once you have 2 pins", () => {
    const vault = lead("r1.room.vault");
    const v = view(game(ROLES, { room: "lobby", duffel: 1, pocket: 0 }));
    // The Vault alone: Ben and Dev both have 2, and their latest is the same ⚠: seat order picks Ben.
    expect(caseData(v, new Set([vault.id, vault.facts[0]!.id])).suspect).toEqual({ player: "p3", reason: "The Vault rang 2 times in R1; Ava, Dev and Ben there should ring at least 3." });
    // The Office too: Dev has 3, the latest on the Office lead.
    expect(caseData(v, new Set(["r1.room.office", vault.facts[0]!.id])).suspect).toEqual({ player: "p5", reason: "Planned Office in R1; later said Security." });
    const elsewhere = caseData(view(game(ROLES, { room: "lobby", duffel: 1, pocket: 0 })), new Set(["r1.haul", lead("r1.haul").facts[0]!.id]));
    expect(elsewhere.suspect).toBeNull();
  });
});

describe("your own Plant evidence — design §12, §15.4", () => {
  it("isn't evidence: the feed sighting you planted gives no Seen elsewhere, and doesn't count in Too quiet", () => {
    const v = view(game(ROLES, { room: "lobby", duffel: 1, pocket: 0 }));
    // You put Dev on the Vault's cameras; the feed you watched shows him there.
    const planted: PlayerView = {
      ...v,
      ledger: [...v.ledger, { seq: 9001, event: { type: "perkSold", visibility: { kind: "public" }, round: 1, perk: "plantEvidence", cost: 3 } }],
      caseFile: [...v.caseFile, { seq: 9000, event: { type: "perkBought", visibility: { kind: "private", player: "p1" }, player: "p1", round: 1, perk: { kind: "plantEvidence", target: "p5", room: "vault" }, cost: 3 } }],
    } as PlayerView;
    const vault = caseData(planted, new Set()).leads.find((l) => l.id === "r1.room.vault")!;
    expect(vault.warnings.filter((w) => w.names.includes("p5"))).toEqual([]);
    // Without Dev, Ava and Ben ring at least 2 and the Vault rang 2: only Ben's Not seen is left.
    expect(vault.warnings.map((w) => [w.kind, w.names.join()])).toEqual([["notSeen", "p3"]]);
  });
});

describe("leaks — design §18: the board uses only viewFor", () => {
  it("doesn't change when only hidden facts change (other players' roles and private feeds)", () => {
    // Ben and Cleo swap roles (the Exact list stays the same), and Cleo watches a different room from Security.
    const a = game(ROLES, { room: "security", duffel: 0, pocket: 0, watch: "office" });
    const b = game(["lookout", "detective", "mole", "hacker", "fixer"], { room: "security", duffel: 0, pocket: 0, watch: "lobby" });
    expect(a.log).not.toEqual(b.log);
    expect(caseData(view(a), new Set())).toEqual(caseData(view(b), new Set()));
  });

  it("never reads the end-of-game reveal", () => {
    const v = view(game(ROLES, { room: "lobby", duffel: 1, pocket: 0 }));
    const leaky = { ...v, reveal: { log: game(ROLES, { room: "lobby", duffel: 1, pocket: 0 }).log.map((event, seq) => ({ seq, event })) } } as unknown as PlayerView;
    expect(caseData(leaky, new Set())).toEqual(caseData(v, new Set()));
  });
});
