// QA (PR #201, S4.2): the move panel's previews and commands against what the
// engine then does. Each case builds a view, computes the preview and the move
// the panel would send, runs the round in the engine and compares. design §3.2, §5.2, §5.3, §11.1, §12
import { ROLES, type RoleId } from "@skimjob/content";
import {
  applyEvent,
  handleCommand,
  privateTo,
  viewFor,
  type GameConfig,
  type GameEvent,
  type GameState,
  type Move,
  type PlayerView,
} from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { createGame } from "./deal.testkit";
import { roomOptions } from "./hud";
import {
  abilityOf,
  bagsOf,
  bellPreview,
  grabOf,
  mayRunShort,
  moveCoin,
  powerControl,
  type Bags,
} from "./move";

const config = (
  n = 5,
  contentOverrides: GameConfig["contentOverrides"] = null,
): GameConfig => ({
  seed: "move-qa",
  players: Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `P${i + 1}`,
    isBot: i > 0,
  })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  ...(contentOverrides ? { contentOverrides } : {}),
});
const game = (
  role: RoleId,
  n = 5,
  overrides: GameConfig["contentOverrides"] = null,
) => createGame(config(n, overrides), [role]);
const view = (s: GameState): PlayerView => viewFor(s, "p1");
const option = (v: PlayerView, id: string) =>
  roomOptions(v).find((o) => o.id === id)!;

function run(s: GameState, cmd: unknown): GameState {
  const r = handleCommand(s, cmd);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}
const submit = (s: GameState, move: Move) =>
  run(s, { type: "submitMove", player: "p1", move });
/** Resolves the round (everyone else gets the default move); returns the round's events. */
function resolve(s: GameState): {
  state: GameState;
  events: readonly GameEvent[];
} {
  const r = handleCommand(s, {
    type: "advance",
    deadline: { kind: "round", round: s.round },
  });
  if (!r.ok) throw new Error(r.reason);
  return { state: r.state, events: r.events };
}
const rungIn = (events: readonly GameEvent[], room: string) => {
  const e = events.find((x) => x.type === "bellsRung");
  return e?.type === "bellsRung" ? e.bells[room] : undefined;
};

/** The panel's grab of `n` coins in `room`, all to the duffel, and what the bell preview says. */
function previewThenRun(s: GameState, room: string, n: number) {
  const v = view(s);
  const o = option(v, room);
  const grab = grabOf(o.coins, n);
  const preview = bellPreview(v, o, grab);
  const { events } = resolve(submit(s, { room, duffel: grab, pocket: 0 }));
  return {
    preview,
    lit: rungIn(events, room),
    raided: events.some((e) => e.type === "roomRaided" && e.room === room),
  };
}

describe("QA: the bell preview matches the engine's rings (design §5.2)", () => {
  it("plain Vault and Office grabs", () => {
    for (const [room, n] of [
      ["vault", 1],
      ["vault", 3],
      ["office", 1],
      ["office", 2],
      ["lobby", 1],
    ] as const) {
      const { preview, lit } = previewThenRun(game("detective"), room, n);
      expect(lit, `${room} ${n}`).toBe((preview.lit ?? 0) + preview.adds);
    }
  });

  it("the Locksmith's Vault grab is silent, as previewed", () => {
    const { preview, lit } = previewThenRun(game("locksmith"), "vault", 3);
    expect(preview.adds).toBe(0);
    expect(lit).toBe(0);
  });

  it("Soft shoes bought last round: the preview and the engine both ring nothing", () => {
    const s0 = game("detective");
    const s = applyEvent(s0, {
      type: "perkBought",
      visibility: privateTo("p1"),
      player: "p1",
      round: s0.round - 1,
      perk: { kind: "softShoes" },
      cost: 0,
    });
    const { preview, lit } = previewThenRun(s, "vault", 3);
    expect(preview.adds).toBe(0);
    expect(lit).toBe(0);
  });

  it("content overrides (room coins and quiet coins, the Locksmith's fewer rings, 5 bulbs)", () => {
    const overrides = {
      rooms: { vault: { coins: 5, quietCoins: 2 } },
      alarm: { bulbs: 5 },
    } as GameConfig["contentOverrides"];
    const s = game("detective", 5, overrides);
    expect(option(view(s), "vault").coins).toBe(5);
    const { preview, lit } = previewThenRun(s, "vault", 5);
    expect(preview).toMatchObject({ bulbs: 5, adds: 3 });
    expect(lit).toBe(3);
  });
});

describe("QA: 'the bank may run short' against the engine's short bank (design §3.2)", () => {
  it("never cuts a grab when the preview stays quiet, at the exact boundary too", () => {
    for (const n of [3, 5, 8, 12]) {
      const s0 = game("detective", n);
      const v0 = view(s0);
      const most = Math.max(
        ...roomOptions(v0)
          .filter((o) => o.closed === null)
          .map((o) => o.coins),
      );
      for (const bank of [most * n, most * n - 1]) {
        const s = { ...s0, bank };
        const short = mayRunShort(view(s), roomOptions(view(s)));
        expect(short, `n=${n} bank=${bank}`).toBe(bank < most * n);
        // Everyone grabs the most: a cut happens exactly when the preview warned.
        let t: GameState = s;
        for (const p of s.playerOrder) {
          const room = roomOptions(view(t)).find(
            (o) => o.coins === most && o.closed === null,
          )!.id;
          t = run(t, {
            type: "submitMove",
            player: p,
            move: { room, duffel: most, pocket: 0 },
          });
        }
        const { events } = resolve(t);
        const got = events
          .filter((e) => e.type === "coinsGrabbed")
          .reduce(
            (sum, e) =>
              e.type === "coinsGrabbed"
                ? sum + e.duffel + e.pocket + e.seized
                : sum,
            0,
          );
        expect(got < most * n, `n=${n} bank=${bank} cut`).toBe(short);
      }
    }
  });

  it("a dry bank (0 coins) warns", () => {
    const s = { ...game("detective"), bank: 0 };
    expect(mayRunShort(view(s), roomOptions(view(s)))).toBe(true);
  });
});

describe("QA: the split never loses or invents a coin (design §3.2 step 3)", () => {
  it("every tap sequence keeps duffel + pocket = grab, and the engine's coinsGrabbed agrees", () => {
    for (let grab = 1; grab <= 4; grab++) {
      let bags: Bags = bagsOf(grab, 0);
      const seq: ("duffel" | "pocket")[] = [
        "pocket",
        "pocket",
        "duffel",
        "pocket",
        "pocket",
        "pocket",
        "duffel",
        "duffel",
        "duffel",
        "duffel",
      ];
      for (const to of seq) {
        bags = moveCoin(bags, to);
        expect(bags.duffel + bags.pocket).toBe(grab);
        expect(bags.duffel).toBeGreaterThanOrEqual(0);
        expect(bags.pocket).toBeGreaterThanOrEqual(0);
      }
    }
    // Cutting the grab after a split: the panel keeps `pocket` and re-splits.
    for (let pocket = 0; pocket <= 5; pocket++)
      for (let grab = 0; grab <= 4; grab++)
        expect(
          Object.values(bagsOf(grab, pocket)).reduce((a, b) => a + b),
        ).toBe(grab);
    const s = game("detective");
    const bags2 = bagsOf(grabOf(option(view(s), "vault").coins, null), 2);
    const { events } = resolve(submit(s, { room: "vault", ...bags2 }));
    expect(
      events.find((e) => e.type === "coinsGrabbed" && e.player === "p1"),
    ).toMatchObject({ duffel: bags2.duffel, pocket: bags2.pocket });
  });
});

describe("QA: a move power is offered only where the engine accepts it (design §11.1, §11.2)", () => {
  const MOVE_POWERS = [
    "lookout",
    "hacker",
    "electrician",
    "priest",
    "mole",
    "fixer",
  ] as const;

  it("every offered target is accepted with the move, and no room outside the list is", () => {
    for (const role of Object.keys(ROLES) as RoleId[]) {
      for (const taped of [{}, { vault: 3 }]) {
        const s0 = game(role);
        const s = {
          ...s0,
          taped,
          bells: Object.fromEntries(
            Object.entries(s0.bells).filter(([r]) => !(r in taped)),
          ),
        };
        const v = view(s);
        const control = powerControl(v);
        if (!(MOVE_POWERS as readonly string[]).includes(role)) {
          expect(control, role).toBeNull();
          continue;
        }
        if (!control) {
          expect(
            role === "fixer" && Object.keys(taped).length === 0,
            `${role} has a control`,
          ).toBe(true);
          continue;
        }
        const base: Move = { room: "lobby", duffel: 1, pocket: 0 };
        if (control.kind === "absolve") {
          for (const p of v.players)
            expect(
              handleCommand(s, {
                type: "submitMove",
                player: "p1",
                move: { ...base, ability: abilityOf(control, [], p.id) },
              }).ok,
              `${role} → ${p.id}`,
            ).toBe(true);
          continue;
        }
        for (const r of s.rooms) {
          const ability = abilityOf(control, [r], null);
          const offered = control.rooms.includes(r);
          expect(ability !== undefined, `${role} ${r}`).toBe(offered);
          if (ability)
            expect(
              handleCommand(s, {
                type: "submitMove",
                player: "p1",
                move: { ...base, ability },
              }).ok,
              `${role} ${r} ${JSON.stringify(taped)}`,
            ).toBe(true);
        }
      }
    }
  });

  it("the Lookout can pick up to its extra rooms, and the panel never sends more", () => {
    const v = view(game("lookout"));
    const control = powerControl(v)!;
    expect(control.kind).toBe("lookout");
    const a = abilityOf(control, v.rooms, null);
    expect(a?.kind === "lookout" && a.rooms.length).toBe(
      control.kind === "lookout" ? control.pick : 0,
    );
  });

  it("a spent once-per-stretch power is not offered", () => {
    for (const role of ["hacker", "electrician", "priest", "mole"] as const) {
      const s0 = game(role);
      const p1 = s0.players.p1!;
      const s = {
        ...s0,
        players: {
          ...s0.players,
          p1: { ...p1, roleState: { ...p1.roleState, usedThisStretch: 1 } },
        },
      };
      expect(powerControl(view(s)), role).toBeNull();
    }
  });
});

describe("QA re-check: the two FAIL findings of the first round", () => {
  it("the raid warning is on exactly when the engine raids, for every lit count and grab (design §5.3)", () => {
    const s0 = game("detective");
    const bulbs = bellPreview(view(s0), option(view(s0), "vault"), 0).bulbs;
    const most = option(view(s0), "vault").coins;
    for (let lit = 0; lit < bulbs; lit++) {
      for (let n = 1; n <= most; n++) {
        const s = { ...s0, bells: { ...s0.bells, vault: lit } };
        // Everyone else lies low in the Lobby so only p1's rings count.
        let t: GameState = s;
        for (const p of s.playerOrder.filter((x) => x !== "p1"))
          t = run(t, { type: "submitMove", player: p, move: { room: "lobby", duffel: 1, pocket: 0 } });
        const { preview, raided } = previewThenRun(t, "vault", n);
        expect(preview.raid, `lit=${lit} grab=${n}`).toBe(raided);
      }
    }
  });

  it("after absolving P2, the Priest is offered everyone but P2, and the engine accepts each one (design §11.1)", () => {
    let s = game("priest");
    s = submit(s, { room: "lobby", duffel: 1, pocket: 0, ability: { kind: "absolve", target: "p2" } });
    s = resolve(s).state;
    s = run(s, { type: "advance", deadline: { kind: "result", round: 1 } });
    const p1 = s.players.p1!;
    s = { ...s, players: { ...s.players, p1: { ...p1, roleState: { ...p1.roleState, usedThisStretch: 0 } } } };
    const control = powerControl(view(s));
    expect(control?.kind === "absolve" && control.players).toEqual(["p3", "p4", "p5"]);
    for (const target of ["p3", "p4", "p5"]) {
      const r = handleCommand(s, { type: "submitMove", player: "p1", move: { room: "lobby", duffel: 1, pocket: 0, ability: abilityOf(control, [], target) } });
      expect(r.ok, target).toBe(true);
    }
    expect(abilityOf(control, [], "p2")).toBeUndefined();
  });
});
