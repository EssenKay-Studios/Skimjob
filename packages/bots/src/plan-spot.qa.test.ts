// QA (S3a.9, #96): the bots on the plan board. A bot takes the room it goes
// to and pledges only a power it really holds and may show; it breaks the plan
// only when pocketing and its lie roll hits, draws no random number when it
// can't break it, sticks to a cover story in its alibi, and whole bot games
// with boards stay deterministic. design §10, §11.3, §19.3
import { describe, expect, it } from "vitest";
import { checkPowerClaim, jobFor, roomDef, viewFor, type GameEvent, type Move, type Statement } from "@skimjob/engine";
import { PERSONALITIES, type Personality, type PersonalityId } from "./personalities";
import { chooseSpot, createBot, type Random } from "./bot";
import { bluffs } from "./claims";
import { runBotGame } from "./run";
import { config, game } from "./testkit";

/** Random numbers from a list (then 0.5 forever), counting the draws. */
function rolls(...values: number[]): Random & { readonly drawn: () => number } {
  let n = 0;
  const r = (() => {
    n++;
    return values.shift() ?? 0.5;
  }) as Random & { drawn: () => number };
  r.drawn = () => n;
  return r;
}
const liar: Personality = { ...PERSONALITIES.greedy, lie: 1, lieOnlyWhenAlone: false };

describe("QA: a bot's spot — design §10", () => {
  // design §11.1: every power a move can aim, with the role that holds it.
  const aimed: [string, NonNullable<Move["ability"]>][] = [
    ["lookout", { kind: "lookout", rooms: ["vault"] }],
    ["priest", { kind: "absolve", target: "ben" }],
    ["hacker", { kind: "hide", room: "vault" }],
    ["electrician", { kind: "blackout", room: "vault" }],
    ["mole", { kind: "ring", room: "vault" }],
    ["fixer", { kind: "reopen", room: "vault" }],
  ];

  it("pledges only roles that show their power, always its own real role and a target the engine takes; the others keep quiet", () => {
    for (const [role, ability] of aimed) {
      const s = game(5, { ana: role });
      const view = viewFor(s, "ana");
      for (const p of Object.values(PERSONALITIES)) {
        const spot = chooseSpot(view, p, rolls(0), { room: "office", duffel: 2, pocket: 0, ability });
        if (bluffs(role)) expect(spot.power, role).toBeNull();
        else {
          expect(spot.power, role).toMatchObject({ role });
          expect(checkPowerClaim(s, "ana", spot.power)).toEqual(spot.power);
        }
      }
    }
  });

  it("never breaks the plan when it hands everything in, and then draws no random number (so its later choices don't shift)", () => {
    const view = viewFor(game(4), "ana");
    for (const p of [liar, ...Object.values(PERSONALITIES)]) {
      const r = rolls(0);
      expect(chooseSpot(view, p, r, { room: "vault", duffel: 6, pocket: 0 }).room).toBe("vault");
      expect(r.drawn()).toBe(0);
    }
    // Honest (lie 0) and one that lies only when unseen draw nothing either, even pocketing.
    for (const p of [PERSONALITIES.honest, { ...liar, lieOnlyWhenAlone: true }]) {
      const r = rolls(0);
      expect(chooseSpot(view, p, r, { room: "vault", duffel: 2, pocket: 4 }).room).toBe("vault");
      expect(r.drawn()).toBe(0);
    }
  });

  it("a broken plan claims an open room other than its own, worth no more than it handed in, the richest such; one roll decides", () => {
    const s = game(4);
    const view = viewFor(s, "ana");
    const job = jobFor(s.config);
    for (const room of s.rooms) {
      const coins = roomDef(job, room).coins;
      for (let duffel = 0; duffel <= coins; duffel++) {
        const move: Move = { room, duffel, pocket: coins - duffel || 1 };
        const r = rolls(0);
        const spot = chooseSpot(view, liar, r, move);
        const covers = s.rooms.filter((x) => x !== room && roomDef(job, x).coins <= duffel);
        if (covers.length === 0) {
          expect(spot.room).toBe(room);
          continue;
        }
        expect(r.drawn()).toBe(1);
        expect(spot.room).not.toBe(room);
        expect(roomDef(job, spot.room).coins).toBe(Math.max(...covers.map((x) => roomDef(job, x).coins)));
      }
    }
  });
});

/** Every said statement of `kind` in a log. */
const said = <K extends Statement["kind"]>(log: readonly GameEvent[], kind: K) =>
  log.flatMap((e) => (e.type === "said" && e.statement.kind === kind ? [e.statement as Extract<Statement, { kind: K }>] : []));

describe("QA: bot games with boards — design §10, §11.3, §19.1", () => {
  const MIX: PersonalityId[] = ["honest", "opportunist", "greedy", "cautious", "random"];
  const play = (n: number, seed: string) => {
    const c = { ...config(n, seed), eventsEnabled: true };
    return runBotGame(
      c,
      c.players.map((p, i) => createBot({ player: p.id, personality: PERSONALITIES[MIX[i % MIX.length]!], seed: `${seed}/${p.id}`, crewSeed: `${seed}/crew` })),
    );
  };

  for (const n of [3, 8, 12]) {
    it(`${n} players: same seed, same log; one board per resolved round, in seat order; pledges are true; a cover story is kept in the alibi`, () => {
      const a = play(n, `qa179-${n}`);
      expect(play(n, `qa179-${n}`).state.log).toEqual(a.state.log);
      expect(a.rejections).toEqual([]);
      const log = a.state.log;
      const plans = said(log, "plan");
      expect(plans.map((p) => p.round)).toEqual(log.flatMap((e) => (e.type === "roundResolved" ? [e.round] : [])));
      const role = new Map(log.flatMap((e) => (e.type === "roleDealt" ? [[e.player, e.role] as const] : [])));
      const real = new Map<string, string>(log.flatMap((e) => (e.type === "coinsGrabbed" ? [[`${e.round}/${e.player}`, e.room] as const] : [])));
      const alibi = new Map<string, string>(said(log, "alibi").map((x) => [`${x.round}/${x.player}`, x.room] as const));
      let covered = 0;
      for (const p of plans) {
        expect(p.plan.entries.map((e) => e.player)).toEqual(a.state.playerOrder);
        expect(p.plan.history).toEqual([]); // the sim has no clock
        for (const e of p.plan.entries) {
          expect(e).toMatchObject({ placed: e.room, agreed: true });
          if (e.power) expect(e.power.role).toBe(role.get(e.player));
          const key = `${p.round}/${e.player}`;
          // design §10: a bot that lied on the board sticks to that story.
          if (e.room !== real.get(key) && alibi.has(key)) {
            expect(alibi.get(key)).toBe(e.room);
            covered++;
          }
        }
      }
      expect(covered, "a broken plan whose alibi was posted").toBeGreaterThan(0);
      // No bot posts two alibis for one round, nor claims twice in a stretch (design §11.3, owner 9 Nov).
      const alibis = said(log, "alibi").map((x) => `${x.round}/${x.player}`);
      expect(new Set(alibis).size).toBe(alibis.length);
      const claims = said(log, "role").map((x) => `${x.stretch}/${x.player}`);
      expect(new Set(claims).size).toBe(claims.length);
    });
  }
});
