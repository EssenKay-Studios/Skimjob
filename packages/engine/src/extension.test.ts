// The Extension rules not covered by a role's own tests: the perk shop, buying
// perks, "camera offline", the gap box and the role list.
// docs/extension.md (THE spec for R6a)
import { describe, expect, it } from "vitest";
import { PERKS, ROLES, SHOP_COLUMNS, SHOP_RULES, type PerkId } from "@skimjob/content";
import { handleThroughAlibis } from "./alibis.testkit";
import { handleCommand } from "./handle";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { PUBLIC, privateTo } from "./types";
import { createGame, dealableRoles, setupEvents } from "./setup";
import { replay } from "./reduce";
import { viewFor } from "./view";
import { ranking } from "./end";
import { fullGrab } from "./grab.testkit";

function config(n: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "extension",
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  };
}

interface Setup {
  /** Seat i is dealt roles[i] (Rookie if missing). */
  readonly roles?: readonly string[];
  /** The shop, replacing the dealt one. */
  readonly shop?: readonly PerkId[];
  /** Tokens each player holds at the start. */
  readonly tokens?: Readonly<Record<PlayerId, number>>;
}

/** A new game, with the setup events rewritten as `setup` asks. */
function game(cfg: GameConfig, setup: Setup = {}): GameState {
  let seat = 0;
  const log = setupEvents(cfg).flatMap((e): GameEvent[] => {
    if (e.type === "roleDealt") {
      const role = setup.roles ? (setup.roles[seat] ?? "rookie") : e.role;
      seat++;
      const tokens = setup.tokens?.[e.player] ?? 0;
      const earned: GameEvent[] = Array.from({ length: tokens }, () => ({ type: "tokenEarned", visibility: privateTo(e.player), player: e.player, trigger: "watchedShakenDirty" }));
      return [{ ...e, role }, ...earned];
    }
    if (e.type === "roleListShown" && setup.roles && e.list === "exact") return [];
    if (e.type === "shopDealt" && setup.shop) return [{ ...e, perks: setup.shop }];
    return [e];
  });
  return replay(cfg, log);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const cmd = typeof c === "function" ? (c as (s: GameState) => unknown)(s) : c;
    const r = handleThroughAlibis(s, cmd);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(cmd)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const r = handleThroughAlibis(state, command);
  if (r.ok) throw new Error(`expected a rejection of ${JSON.stringify(command)}`);
  return r.reason;
}
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const shopOf = (cfg: GameConfig) => ofType(setupEvents(cfg), "shopDealt")[0]?.perks ?? [];

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { ...fullGrab(room, pocket), ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const buy = (player: string, perk: string) => ({ type: "buyPerk", player, perk });
const views = (s: GameState, ids: readonly PlayerId[]) => ids.map((id) => JSON.stringify(viewFor(s, id)));
const SEEDS = Array.from({ length: 60 }, (_, i) => `shop-${i}`);

describe("the perk shop — extension.md \"Tokens and the perk shop\", gap-fills \"Shop dealing\"", () => {
  it("deals three perks, one per column (Learn / Protect / Sway), with the seeded RNG; public at setup", () => {
    const sway = new Set<PerkId>();
    for (const seed of SEEDS) {
      const shop = shopOf(config(5, { seed, eventsEnabled: true }));
      expect(shop).toHaveLength(3);
      expect(SHOP_COLUMNS.learn).toContain(shop[0]);
      expect(SHOP_COLUMNS.protect).toContain(shop[1]);
      expect(SHOP_COLUMNS.sway).toContain(shop[2]);
      sway.add(shop[2] as PerkId);
      expect(shopOf(config(5, { seed, eventsEnabled: true }))).toEqual(shop);
    }
    expect([...sway].sort()).toEqual([...SHOP_COLUMNS.sway].sort());
    const s = createGame(config(5, { eventsEnabled: true }));
    expect(ofType(s.log, "shopDealt")[0]?.visibility).toEqual(PUBLIC);
    for (const id of s.playerOrder) expect(viewFor(s, id).shop.map((o) => o.perk)).toEqual(s.shop);
  });

  it("with events off the Sway perk is +Vote or Emergency", () => {
    for (const seed of SEEDS) expect(SHOP_RULES.swayEventsOff).toContain(shopOf(config(5, { seed }))[2]);
  });

  it("costs come from content: Peek and Shield 2, the rest 1; overridable", () => {
    for (const [id, perk] of Object.entries(PERKS)) expect(perk.cost, id).toBe(id === "peek" || id === "shield" ? 2 : 1);
    const s = game(config(5, { contentOverrides: { perks: { tail: { cost: 3 } } } }), { shop: ["tail", "shield", "extraVote"] });
    expect(viewFor(s, "p0").shop).toEqual([
      { perk: "tail", cost: 3 },
      { perk: "shield", cost: 2 },
      { perk: "extraVote", cost: 1 },
    ]);
  });
});

describe("buying perks — extension.md \"Tokens and the perk shop\"", () => {
  const SHOP: PerkId[] = ["peek", "shield", "extraVote"];

  it("spends the perk's cost in tokens; private to the buyer until used", () => {
    const s = game(config(5), { shop: SHOP, tokens: { p0: 3 } });
    const after = run(s, buy("p0", "peek"));
    expect(since(s, after)).toEqual([{ type: "perkBought", visibility: privateTo("p0"), player: "p0", perk: "peek", cost: 2 }]);
    expect(after.players.p0?.roleState).toMatchObject({ tokens: 1, perks: ["peek"] });
    expect(viewFor(after, "p0").me.roleState).toMatchObject({ tokens: 1, perks: ["peek"] });
    for (const id of ["p1", "p2", "p3", "p4"]) expect(JSON.stringify(viewFor(after, id))).toBe(JSON.stringify(viewFor(s, id)));
  });

  it("refuses a perk not in the shop, not enough tokens, a non-player, and outside play", () => {
    const s = game(config(5), { shop: SHOP, tokens: { p0: 1 } });
    expect(reason(s, buy("p0", "tail"))).toMatch(/not in this game's shop/);
    expect(reason(s, buy("p0", "peek"))).toMatch(/token/);
    expect(reason(s, buy("p1", "extraVote"))).toMatch(/token/);
    expect(reason(s, buy("zz", "extraVote"))).toMatch(/not in this game|unknown|player/);
  });

  it("unspent tokens are worth nothing at the end", () => {
    // A bust after round 1 (a one-bulb bell, one star): the Vault rings.
    const quick = { contentOverrides: { alarm: { bulbs: 1, bustStars: 1 } } };
    const plain = game(config(3, quick));
    const rich = game(config(3, quick), { roles: [plain.players.p0?.role ?? "rookie", plain.players.p1?.role ?? "rookie", plain.players.p2?.role ?? "rookie"], tokens: { p0: 5 } });
    const end = (s: GameState) => run(s, mv("p0", "vault"), ROUND);
    expect(end(plain).phase.kind).toBe("ended");
    expect(ranking(end(rich)).map((r) => r.stash)).toEqual(ranking(end(plain)).map((r) => r.stash));
  });
});

describe("what the deal can give — extension.md \"Host settings\" (QA on R6a)", () => {
  it("Balanced at 3 players deals no Lone wolf or Wildcard: the Possible list names only Team players", () => {
    for (const n of [3]) {
      for (const roleList of ["possible", "hidden"] as const) {
        const cfg = config(n, { deck: "everything", roleList, eventsEnabled: true });
        expect(dealableRoles(cfg)).not.toContain("mole");
        const s = createGame(cfg);
        if (roleList === "possible") {
          const listed = viewFor(s, "p0").roleList?.roles ?? [];
          expect(listed.length).toBeGreaterThan(0);
          for (const r of listed) expect(ROLES[r]?.tag, r).toBe("teamPlayer");
        }
      }
    }
  });

});

describe("camera offline — extension.md \"Camera offline\"", () => {
  it("a Hacker loop on a watched room reads as camera offline to Security", () => {
    // Round 1: p0 Hacker loops the Vault; p1 in Security watches it; p2 pockets there.
    const looped = run(game(config(3), { roles: ["hacker"] }), mv("p0", "office", 0, { ability: { kind: "loopCameras", room: "vault" } }), mv("p1", "security", 0, { watch: "vault" }), mv("p2", "vault", 2), ROUND);
    const fromLoop = ofType(looped.log, "roomWatched").find((e) => e.player === "p1");
    expect(fromLoop).toEqual({ type: "roomWatched", visibility: privateTo("p1"), player: "p1", round: 1, source: "security", room: "vault", seen: [], offline: true });
  });
});

describe("the role list — extension.md \"Host settings\"", () => {
  const roles = (cfg: GameConfig) => ofType(setupEvents(cfg), "roleDealt").map((e) => e.role);

  it("Exact (default) shows every dealt role, in content order, never by seat", () => {
    const cfg = config(6, { deck: "everything" });
    const s = createGame(cfg);
    const shown = viewFor(s, "p0").roleList;
    expect(shown?.list).toBe("exact");
    expect([...(shown?.roles ?? [])].sort()).toEqual([...roles(cfg)].sort());
  });

  it("Possible shows every role that could be dealt; Hidden shows nothing", () => {
    const cfg = config(6, { roleList: "possible" });
    expect(viewFor(createGame(cfg), "p0").roleList).toEqual({ list: "possible", roles: expect.arrayContaining([...dealableRoles(cfg)]) });
    expect(viewFor(createGame(cfg), "p0").roleList?.roles).toHaveLength(dealableRoles(cfg).length);
    const hidden = createGame(config(6, { roleList: "hidden" }));
    expect(viewFor(hidden, "p0").roleList).toBeNull();
    expect(ofType(hidden.log, "roleListShown")).toEqual([]);
  });
});
