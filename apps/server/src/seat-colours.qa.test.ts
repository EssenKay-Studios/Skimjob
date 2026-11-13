// QA (PR #296, issue #261): a seat number fixes a player's avatar colour and engine id. design §15; ui-style "Player avatars"
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_PLAYERS } from "@skimjob/content";
import { viewFor } from "@skimjob/engine";
import { devAuthProvider, SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import { createGameStore } from "./store";
import { testDb } from "./testkit";

let db: Db;
let app: FastifyInstance;
beforeAll(async () => {
  db = await testDb();
  app = buildServer({ db, clock: fakeClock(Date.UTC(2026, 10, 13)), auth: [devAuthProvider()] });
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

type Res = { status: number; body: Partial<LobbyView>; session: string | null };
const call = async (method: "POST" | "DELETE", url: string, who: string | null = null, payload: unknown = {}): Promise<Res> => {
  const res = await app.inject({ method, url, cookies: who ? { [SESSION_COOKIE]: who } : {}, payload: payload as object });
  return { status: res.statusCode, body: res.json(), session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};
const host = async () => {
  const who = (await call("POST", "/auth/guest", null, { nickname: "Host" })).session!;
  const res = await call("POST", "/games", who);
  return { who, game: res.body as LobbyView };
};
const join = (code: string, nickname: string) => call("POST", `/invites/${code}/join`, null, { nickname });
const seatsBy = (v: Partial<LobbyView>) => Object.fromEntries(v.seats!.map((s) => [s.nickname, s.seat]));

describe("QA: seat numbers in a 12-player lobby", () => {
  it("12 seats get seats 0-11; a middle leaver's seat goes to the next joiner and nobody else moves; ids follow seats", async () => {
    const { who, game } = await host();
    const sessions: string[] = [];
    for (let i = 1; i < MAX_PLAYERS; i++) sessions.push((await join(game.inviteCode, `J${i}`)).session!);
    expect((await join(game.inviteCode, "Late")).status).toBe(409);
    expect((await call("POST", `/games/${game.id}/leave`, sessions[4]!)).status).toBe(200);
    const rejoin = (await join(game.inviteCode, "Late")).body;
    const seats = seatsBy(rejoin);
    expect(Object.values(seats).sort((a, b) => a! - b!)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(seats["Late"]).toBe(5); // J5 sat at seat 5
    for (let i = 1; i < MAX_PLAYERS; i++) if (i !== 5) expect(seats[`J${i}`]).toBe(i);
    const started = await call("POST", `/games/${game.id}/start`, who);
    expect(started.status).toBe(200);
    for (const s of started.body.seats!) expect(s.playerId).toBe(`p${s.seat + 1}`);
  });

  it("the host handing over and leaving frees seat 0 for the next bot; the rest keep their seats", async () => {
    const { who, game } = await host();
    const ana = await join(game.inviteCode, "Ana");
    await join(game.inviteCode, "Bo");
    expect((await call("POST", `/games/${game.id}/host`, who, { seat: 1 })).status).toBeLessThan(300);
    expect((await call("POST", `/games/${game.id}/leave`, who)).status).toBe(200);
    const after = await call("POST", `/games/${game.id}/bots`, ana.session, {});
    expect(after.status).toBe(201);
    expect(after.body.seats!.map((s) => s.seat)).toEqual([0, 1, 2]);
    expect(seatsBy(after.body)).toMatchObject({ Ana: 1, Bo: 2 });
  });
});

describe("QA: a game started with a gap in the seats", () => {
  it("ids skip the empty seat (p1, p3, p4) and every player gets a working view", async () => {
    const { who, game } = await host();
    const ana = (await join(game.inviteCode, "Ana")).session!;
    await join(game.inviteCode, "Bo");
    await join(game.inviteCode, "Cy");
    await call("POST", `/games/${game.id}/leave`, ana);
    const started = await call("POST", `/games/${game.id}/start`, who);
    expect(started.status).toBe(200);
    expect(started.body.seats!.map((s) => [s.nickname, s.seat, s.playerId])).toEqual([["Host", 0, "p1"], ["Bo", 2, "p3"], ["Cy", 3, "p4"]]);
    const state = (await createGameStore(db).load(game.id))!;
    for (const id of ["p1", "p3", "p4"]) expect(viewFor(state, id).me.id).toBe(id);
  });
});
