// QA (S3a.9, #96): the live board's snapshot as the round deadline logs it.
// One said plan per round, none when nobody said anything, the history in a
// fixed order whatever order the edits came in (so a retried deadline logs the
// same), and no wall time in the log. design §10, §18, §19.1
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "@skimjob/engine";
import { SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import type { LobbyView } from "./lobby";
import { createPlan, type PlanEditRecord } from "./plan";
import { buildServer } from "./server";
import { createGameStore } from "./store";
import { testDb } from "./testkit";

const clock = fakeClock(Date.UTC(2026, 10, 9));
let db: Db;
let app: FastifyInstance;
beforeAll(async () => {
  db = await testDb();
  app = buildServer({ db, clock });
  await app.ready();
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

const call = async (url: string, who: string | null, payload: Record<string, unknown> = {}) => {
  const res = await app.inject({ method: "POST", url, payload, cookies: who ? { [SESSION_COOKIE]: who } : {} });
  return { body: res.json() as LobbyView, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};

/** A started game of `people` guests and `bots` bots: its id, the people's seats, the bots' seats. */
async function startGame(people: number, bots = 0) {
  const host = (await call("/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await call("/games", host, {})).body;
  const sessions = [host];
  for (let i = 1; i < people; i++) sessions.push((await call(`/invites/${game.inviteCode}/join`, null, { nickname: `Guest ${i}` })).session!);
  for (let i = 0; i < bots; i++) await call(`/games/${game.id}/bots`, host, {});
  const started = (await call(`/games/${game.id}/start`, host)).body;
  const humans: string[] = [];
  for (const who of sessions) {
    const res = await app.inject({ method: "GET", url: `/games/${game.id}`, cookies: { [SESSION_COOKIE]: who } });
    humans.push((res.json() as LobbyView).seats.find((s) => s.you)!.playerId!);
  }
  return { id: game.id, humans, botIds: started.seats.filter((s) => s.bot !== null).map((s) => s.playerId!) };
}

const load = async (id: string): Promise<GameState> => (await createGameStore(db).load(id))!;
const plans = (log: readonly GameEvent[]) => log.filter((e) => e.type === "said" && e.statement.kind === "plan");
const order = (h: Pick<PlanEditRecord, "msBeforeDeadline" | "kind" | "subject" | "actor">) => [h.msBeforeDeadline, h.kind, h.subject, h.actor];

describe("QA: the round deadline's said plan — design §10", () => {
  it("edits in any order, ties in time left included, give the same history order: time left (most first), then kind, subject, actor", async () => {
    const plan = createPlan(db, clock);
    const histories: unknown[][] = [];
    for (const reverse of [false, true]) {
      const { id, humans } = await startGame(3);
      const [a, b, c] = humans as [string, string, string];
      const rooms = (await load(id)).rooms as readonly [string, string, string];
      // Three seats edit in the same instant (equal time left), then one more a second later.
      const edits: [string, Parameters<typeof plan.edit>[3]][] = [
        [a, { room: rooms[0], agree: true }],
        [b, { place: { player: a, room: rooms[1] }, power: { role: "hacker", target: rooms[0] } }],
        [c, { place: { player: b, room: rooms[0] }, room: rooms[2] }],
      ];
      for (const [actor, edit] of reverse ? [...edits].reverse() : edits) expect(await plan.edit(id, await load(id), actor, edit)).toEqual({ ok: true, value: undefined });
      clock.advance(1000);
      expect(await plan.edit(id, await load(id), b, { agree: true })).toEqual({ ok: true, value: undefined });

      const history = (await plan.snapshot(id, await load(id))).history;
      expect(history).toHaveLength(7);
      // Ordered: the latest edit (least time left) last; equal time left by kind, subject, actor.
      expect(history.at(-1)).toMatchObject({ actor: b, kind: "agree" });
      const keys = history.map(order);
      const sorted = [...keys].sort((x, y) => {
        const [mx, ...rx] = x as [number, ...string[]];
        const [my, ...ry] = y as [number, ...string[]];
        if (mx !== my) return my - mx;
        for (let i = 0; i < rx.length; i++) if (rx[i] !== ry[i]) return rx[i]! < ry[i]! ? -1 : 1;
        return 0;
      });
      expect(keys).toEqual(sorted);
      // The same edits by seat position, whichever came first.
      const seat = (p: string) => humans.indexOf(p);
      histories.push(history.map((h) => [seat(h.actor), h.kind, seat(h.subject), h.value, h.target]));

      // The deadline logs exactly that, once; a retry is refused and logs nothing more.
      await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
      await expect(app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } })).rejects.toThrow(/not pending|no round deadline/);
      const said = plans((await load(id)).log);
      expect(said).toHaveLength(1);
      expect(said[0]).toMatchObject({ visibility: { kind: "public" }, statement: { round: 1, plan: { history } } });
    }
    expect(histories[1]).toEqual(histories[0]);
  });

  it("no wall time reaches the log: no `at`, no ISO date, no epoch ms anywhere in the said plan", async () => {
    const { id, humans } = await startGame(3);
    const rooms = (await load(id)).rooms as readonly [string, string, string];
    const plan = createPlan(db, clock);
    expect(await plan.edit(id, await load(id), humans[0]!, { room: rooms[0], power: { role: "detective", target: humans[1]! }, agree: true })).toMatchObject({ ok: true });
    expect((await plan.history(id, 1)).every((h) => typeof h.at === "string")).toBe(true); // the server keeps it
    await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
    const said = JSON.stringify(plans((await load(id)).log));
    expect(said).not.toMatch(/"at"/);
    expect(said).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(said).not.toContain(String(clock.now()).slice(0, 8));
  });

  it("nothing said, nothing logged: a round nobody touched the board in logs no said plan, and the next round's board starts empty", async () => {
    const { id } = await startGame(3);
    await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
    expect(plans((await load(id)).log)).toEqual([]);
  });

  it("a board that was used and then fully cleared still says something: its history (who cleared what)", async () => {
    const { id, humans } = await startGame(3);
    const rooms = (await load(id)).rooms as readonly [string, string, string];
    const plan = createPlan(db, clock);
    expect(await plan.edit(id, await load(id), humans[0]!, { room: rooms[0] })).toMatchObject({ ok: true });
    expect(await plan.edit(id, await load(id), humans[0]!, { room: null })).toMatchObject({ ok: true });
    await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
    const said = plans((await load(id)).log);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ statement: { plan: { entries: [], history: [{ actor: humans[0], kind: "room", value: null }] } } });
  });

  it("bots' spots: every bot seat has an agreed room claim in the said plan, and its edits are the only ones with no time left (made before the deadline row)", async () => {
    const { id, humans, botIds } = await startGame(1, 2);
    const rooms = (await load(id)).rooms as readonly [string, string, string];
    clock.advance(1000);
    expect(await createPlan(db, clock).edit(id, await load(id), humans[0]!, { room: rooms[0] })).toMatchObject({ ok: true });
    await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
    const said = plans((await load(id)).log)[0];
    if (said?.type !== "said" || said.statement.kind !== "plan") throw new Error("no said plan");
    const { entries, history } = said.statement.plan;
    for (const b of botIds) expect(entries.find((e) => e.player === b)).toMatchObject({ agreed: true, room: expect.any(String) });
    expect(history.filter((h) => h.msBeforeDeadline === null).every((h) => botIds.includes(h.actor))).toBe(true);
    expect(history.find((h) => h.actor === humans[0])?.msBeforeDeadline).toEqual(expect.any(Number));
  });
});
