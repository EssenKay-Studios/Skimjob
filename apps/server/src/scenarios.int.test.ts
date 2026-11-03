// Integration scenarios: named end-to-end stories through the real HTTP lobby
// API and the game WebSocket, on PGlite (or real Postgres with DATABASE_URL).
// Each story plays to the end and checks the reveal/ranking, and that no
// socket ever received anything it may not see. docs/testing.md
//
// The scheduler (M2-4) doesn't exist yet, so deadlines are sent through
// app.live.system as soon as everyone has acted (like runBotGame's stand-in).
// People are played by bot logic (or a script) over their own sockets.
// design §17.2, §17.3, §13, §11, §16.1, §7
import { createBot, PERSONALITIES, type Agent } from "@skimjob/bots";
import { POOL_ROLES, MOLE_ROLE, DECKS, ROLES } from "@skimjob/content";
import { canSee, replay, viewFor, type GameConfig, type GameEvent, type GameState, type PlayerView, type SystemCommand } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import type { ChatMessage, DmNotice } from "./chat";
import type { ServerMessage } from "./live";
import { gameConfig, playerIdFor, type LobbyView } from "./lobby";
import { buildServer } from "./server";
import type { LobbySettings } from "./settings";
import { createGameStore, type GameStore } from "./store";
import { testDb } from "./testkit";

/** The Standard deck with every Wildcard and Lone wolf toggled off: no Mole, so no police moments (was saboteur "off"). */
const TEAM_ROLES = DECKS.standard.filter((r) => ROLES[r]?.tag === "teamPlayer");

const quick = { interval: 1, timeout: 5000 };
const clock = fakeClock(Date.UTC(2026, 10, 1));

let db: Db;
let store: GameStore;
let app: FastifyInstance;
const boot = async () => {
  store = createGameStore(db);
  const a = buildServer({ db, clock, store });
  await a.ready();
  return a;
};
beforeAll(async () => {
  db = await testDb();
  app = await boot();
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

// ---------------------------------------------------------------- lobby (HTTP)

const post = async (url: string, who: string | null, payload: Record<string, unknown> = {}) => {
  const res = await app.inject({ method: "POST", url, payload, cookies: who ? { [SESSION_COOKIE]: who } : {} });
  return { status: res.statusCode, body: res.json() as LobbyView, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};
const lobby = async (id: string, who: string) =>
  (await app.inject({ method: "GET", url: `/games/${id}`, cookies: { [SESSION_COOKIE]: who } })).json() as LobbyView;

interface Human {
  readonly who: string;
  readonly player: string;
}
interface Game {
  readonly id: string;
  readonly humans: readonly Human[];
}

/** Host signs in as a guest, creates the game, guests join by the invite code, the host adds bots. */
async function openLobby(people: number, bots: number, settings: Partial<LobbySettings>) {
  const host = (await post("/auth/guest", null, { nickname: "Host" })).session!;
  const created = await post("/games", host, { settings });
  expect(created.status).toBe(201);
  const game = created.body;
  const sessions = [host];
  for (let i = 1; i < people; i++) {
    const joined = await post(`/invites/${game.inviteCode}/join`, null, { nickname: `Guest ${i}` });
    expect(joined.status).toBe(200);
    sessions.push(joined.session!);
  }
  const personalities = ["opportunist", "greedy", "honest", "cautious", "random"] as const;
  for (let i = 0; i < bots; i++) expect((await post(`/games/${game.id}/bots`, host, { personality: personalities[i % 5] })).status).toBe(201);
  return { id: game.id, sessions };
}

async function seated(id: string, sessions: readonly string[]): Promise<Game> {
  const humans: Human[] = [];
  for (const who of sessions) humans.push({ who, player: (await lobby(id, who)).seats.find((s) => s.you)!.playerId! });
  return { id, humans };
}

async function startGame(people: number, bots: number, settings: Partial<LobbySettings> = {}): Promise<Game> {
  const { id, sessions } = await openLobby(people, bots, settings);
  const started = await post(`/games/${id}/start`, sessions[0]!);
  expect(started.status).toBe(200);
  expect(started.body.status).toBe("running");
  return seated(id, sessions);
}

// ---------------------------------------------------------------- sockets

let tabs = 0;
/** A test socket that keeps every message it got. Reply ids carry a per-socket tag, so a stray reply shows. */
class Client {
  readonly raw: string[] = [];
  closed: number | null = null;
  private n = 0;
  readonly tag = `t${++tabs}`;
  ws!: WebSocket;
  constructor(readonly player: string) {}
  static async open(gameId: string, h: Human): Promise<Client> {
    const c = new Client(h.player);
    const onInit = (ws: WebSocket) => {
      ws.on("message", (data) => c.raw.push(String(data)));
      ws.on("close", (code) => (c.closed = code));
    };
    c.ws = await app.injectWS(`/games/${gameId}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${h.who}` } }, { onInit });
    await vi.waitFor(() => expect(c.views().length).toBe(1), quick);
    return c;
  }
  get messages(): ServerMessage[] {
    return this.raw.map((t) => JSON.parse(t) as ServerMessage);
  }
  views(): PlayerView[] {
    return this.messages.flatMap((m) => ("view" in m ? [m.view] : []));
  }
  lastView(): PlayerView {
    return this.views().at(-1)!;
  }
  async send(cmd: unknown): Promise<ServerMessage> {
    return this.sendRaw({ cmd });
  }
  /** A chat message (M2-8a): `{ to?, text }` or `{ to?, evidence }`. */
  async chat(chat: unknown): Promise<ServerMessage> {
    return this.sendRaw({ chat });
  }
  async sendRaw(msg: Record<string, unknown>): Promise<ServerMessage> {
    const id = `${this.tag}-${++this.n}`;
    this.ws.send(JSON.stringify({ ...msg, id }));
    let reply: ServerMessage | undefined;
    await vi.waitFor(() => {
      reply = this.messages.find((m) => "id" in m && m.id === id);
      expect(reply).toBeDefined();
    }, quick);
    return reply!;
  }
  /** Waits until everything queued for this socket so far has arrived (a no-op goes through the game lock). */
  async barrier(): Promise<void> {
    await this.send({ type: "noop" });
  }
  close(): void {
    this.ws.close();
  }
}

const load = async (id: string) => (await store.load(id))!;

// ---------------------------------------------------------------- scheduler stand-in

/** The deadline that would pass next (runBotGame's order). M2-4 replaces this with real timers. */
function nextDeadline(state: GameState): SystemCommand[] {
  const phase = state.phase;
  if (phase.kind === "meeting") return [{ type: "advance", deadline: { kind: "closeMeeting", meetingId: phase.meetingId } }];
  if (phase.kind === "shakedownPending") return [{ type: "advance", deadline: { kind: "resolveShakedown", meetingId: phase.meetingId } }];
  if (state.pendingEmergency && (phase.kind === "planning" || phase.kind === "alibis" || phase.kind === "awaitingMeeting")) {
    return [{ type: "advance", deadline: { kind: "openMeeting", meetingId: state.pendingEmergency.meetingId } }];
  }
  if (phase.kind === "planning") return [{ type: "advance", deadline: { kind: "round", round: phase.round } }];
  // design §5.4: the alibi deadline after each round.
  if (phase.kind === "alibis") return [{ type: "advance", deadline: { kind: "alibis", round: phase.round } }];
  if (phase.kind === "awaitingMeeting") {
    const schedule: SystemCommand[] = state.scheduledMeeting ? [] : [{ type: "scheduleMeeting", act: phase.act, slot: `server-act-${phase.act}` }];
    return [...schedule, { type: "advance", deadline: { kind: "openMeeting", meetingId: state.scheduledMeeting?.meetingId ?? `act-${phase.act}` } }];
  }
  return [];
}
const passDeadline = async (id: string) => {
  for (const command of nextDeadline(await load(id))) await app.live.system(id, command);
};

/** What a person does with their view: a list of commands (sent with no `player`; the server sets it). */
type Brain = (view: PlayerView) => readonly unknown[];
const botBrain = (agent: Agent): Brain => (view) => agent.act(view).map(({ player: _, ...rest }) => rest);
const brainsFor = (game: Game): Brain[] =>
  game.humans.map((h, i) => botBrain(createBot({ player: h.player, personality: PERSONALITIES[(["greedy", "honest", "cautious"] as const)[i % 3]!], seed: `person/${i}` })));

interface Refusal {
  readonly player: string;
  readonly command: unknown;
  readonly reply: ServerMessage;
}

/**
 * Each step every connected person acts on their latest view, then one
 * deadline passes. `until` stops early (checked before each step).
 */
async function play(game: Game, clients: readonly (Client | null)[], brains: readonly (Brain | null)[], until: (s: GameState) => boolean = () => false) {
  const refused: Refusal[] = [];
  for (let steps = 0; ; steps++) {
    const state = await load(game.id);
    if (state.phase.kind === "ended" || until(state)) return refused;
    expect(steps).toBeLessThan(300);
    for (const [i, c] of clients.entries()) {
      const brain = brains[i];
      if (!c || !brain) continue;
      await c.barrier();
      for (const command of brain(c.lastView())) {
        if ((await load(game.id)).phase.kind === "ended") break;
        const reply = await c.send(command);
        if (!("ok" in reply)) refused.push({ player: c.player, command, reply });
      }
    }
    await passDeadline(game.id);
  }
}

// ---------------------------------------------------------------- the checks every story makes

/**
 * Nothing forbidden ever reached this socket: only its own views, ledger
 * public, case file its own, no reveal (or seed) before the end, the reveal
 * only what canSee allows after it, no server-only fields, every event real,
 * and replies only to its own commands. Ends on the final view. design §13, §17.2, §11.2
 */
async function assertCleanSocket(c: Client, final: GameState) {
  if (c.closed === null) await c.barrier();
  // Chat (M2-8a, design §12.1): crew messages and this seat's own DMs only;
  // others' DMs at most as a bare notice { from, to, at }.
  const chatFor = (m: ChatMessage) => {
    expect(m.to === null || m.from === c.player || m.to === c.player).toBe(true);
    expect(Object.keys(m).sort().join()).toBe(m.verified ? "at,card,from,id,to,verified" : "at,from,id,text,to,verified");
    if (m.verified) expect(JSON.stringify(m.card)).not.toMatch(/"seq"|"visibility"/);
  };
  const noticeFor = (n: DmNotice) => {
    expect(Object.keys(n).sort().join()).toBe("at,from,to");
    expect(n.from !== c.player && n.to !== c.player).toBe(true);
  };
  const real = new Set(final.log.map((e) => JSON.stringify(e)));
  const seed = JSON.stringify(final.config.seed);
  const isReal = (e: GameEvent) => real.has(JSON.stringify(e));
  for (const text of c.raw) {
    expect(text).not.toMatch(/"idx"|"config"/); // server-only fields (docs/m2-plan.md "Never send")
    const msg = JSON.parse(text) as ServerMessage;
    if ("view" in msg) {
      const v = msg.view;
      expect(v.me.id).toBe(c.player);
      expect(v.ledger.every(({ event }) => event.visibility.kind === "public" && isReal(event))).toBe(true);
      expect(v.caseFile.every(({ event }) => canSee(event.visibility, c.player, false) && isReal(event))).toBe(true);
      expect(v.players.every((o) => Object.keys(o).sort().join() === "emergencyMeetingUsed,id,isBot,name")).toBe(true);
      // The seed and RNG state are reveal-only (rngSeeded / rngAdvanced). design §17.2
      if (v.reveal === null) expect(text).not.toMatch(new RegExp(`${seed.replace(/[^a-z0-9]/gi, ".")}|"words"|"seed"|"rngSeeded"`));
      else expect(v.reveal.log.every(({ event }) => canSee(event.visibility, c.player, true) && isReal(event))).toBe(true);
    } else if ("presence" in msg) {
      // Owner decision (2 Nov): human seats' online / last seen only; server-only, never in the log.
      const humans = new Set(final.config.players.filter((p) => !p.isBot).map((p) => p.id));
      for (const [player, p] of Object.entries(msg.presence)) {
        expect(humans.has(player)).toBe(true);
        expect(Object.keys(p).sort().join()).toBe("lastSeen,online");
      }
    } else if ("chatHistory" in msg) {
      msg.chatHistory.messages.forEach(chatFor);
      msg.chatHistory.dmNotices.forEach(noticeFor);
    } else if ("chat" in msg) {
      chatFor(msg.chat);
    } else if ("dmNotice" in msg) {
      noticeFor(msg.dmNotice);
    } else {
      expect(Object.keys(msg).sort()).toEqual("ok" in msg ? ["id", "ok"] : ["id", "reason", "rejected"]);
      expect(String((msg as { id?: unknown }).id).startsWith(`${c.tag}-`)).toBe(true);
    }
  }
  if (c.closed === null) expect(c.lastView()).toEqual(viewFor(final, c.player));
}

/** The reveal every socket ends on: the engine's outcome, a full ranking that matches the final stashes. design §3, §13 */
function assertReveal(c: Client, final: GameState) {
  expect(final.phase.kind).toBe("ended");
  if (final.phase.kind !== "ended") return;
  const reveal = c.lastView().reveal!;
  expect(reveal).not.toBeNull();
  expect(reveal.outcome).toEqual(final.phase.outcome);
  const { ranking, winners } = reveal.outcome;
  expect(ranking.map((r) => r.player).sort()).toEqual([...final.playerOrder].sort());
  for (const r of ranking) {
    const p = final.players[r.player]!;
    expect([r.role, r.stash, r.safe]).toEqual([p.role, p.stash + p.safe, p.safe]);
  }
  for (let i = 1; i < ranking.length; i++) expect(ranking[i - 1]!.score).toBeGreaterThanOrEqual(ranking[i]!.score);
  if (reveal.outcome.result === "success") expect(winners.length).toBeGreaterThan(0);
  // The reveal shows every role. design §13
  expect(reveal.log.filter((e) => e.event.type === "roleDealt")).toHaveLength(final.playerOrder.length);
}

async function finish(game: Game, clients: readonly Client[], refused: readonly Refusal[], botRefusalsBefore: number) {
  const final = await load(game.id);
  expect(final.phase.kind).toBe("ended");
  expect(refused).toEqual([]);
  expect(app.live.botRefusals.slice(botRefusalsBefore)).toEqual([]);
  // The store's state is the fold of its log. design §17.2
  expect(replay(final.config, final.log)).toEqual(final);
  for (const c of clients) {
    await assertCleanSocket(c, final);
    if (c.closed === null) assertReveal(c, final);
    c.close();
  }
  return final;
}

/** A person who plays a fixed room with nothing pocketed, votes skip, and does nothing else. */
const steadyBrain =
  (room: string): Brain =>
  (view) => {
    if (view.phase.kind === "meeting") return view.me.vote ? [] : [{ type: "castVote", vote: { kind: "skip" } }];
    if (view.phase.kind !== "planning" || view.me.move) return [];
    const closed = view.card?.room;
    const pick = room === closed ? (room === "lobby" ? "office" : "lobby") : room;
    return [{ type: "submitMove", move: pick === "security" ? { room: pick, pocket: 0, watch: "vault" } : { room: pick, pocket: 0 } }];
  };

const typesIn = (s: GameState) => new Set(s.log.map((e) => e.type));

// ---------------------------------------------------------------- the stories

describe("scenarios: end-to-end stories over HTTP + WebSocket", () => {
  it("host creates a game, guests join by invite, bots fill the seats, and a full game plays to the reveal", async () => {
    const before = app.live.botRefusals.length;
    const game = await startGame(3, 5, { voteVisibility: "hiddenThenRevealed", eventsEnabled: true });
    const clients = await Promise.all(game.humans.map((h) => Client.open(game.id, h)));
    // Some talk on the way (M2-8a): crew chat, a DM between seats 1 and 2, an evidence card.
    const [p0, p1, p2] = clients as [Client, Client, Client];
    expect(await p0.chat({ text: "let's be careful" })).toMatchObject({ ok: true });
    expect(await p0.chat({ to: p1.player, text: "side deal: vault, split 50/50" })).toMatchObject({ ok: true });
    // Role cards are refused (design §8, PR #38).
    const role = p1.lastView().caseFile.find((e) => e.event.type === "roleDealt")!;
    expect(await p1.chat({ to: p0.player, evidence: role.seq })).toMatchObject({ rejected: true });
    const refused = await play(game, clients, brainsFor(game));
    const final = await finish(game, clients, refused, before);
    expect(p2.raw.join()).not.toMatch(/side deal|"verified":true/);
    expect(p2.messages.filter((m) => "dmNotice" in m)).toHaveLength(1); // the refused role card sent no notice
    expect(final.playerOrder).toEqual(Array.from({ length: 8 }, (_, i) => playerIdFor(i)));
    expect(typesIn(final)).toContain("meetingClosed");
    // The lobby shows the game as ended.
    expect((await lobby(game.id, game.humans[0]!.who)).status).toBe("ended");
  }, 60_000);

  it("a player disconnects mid-meeting and reconnects: they get the current view with their own ballot, and play on", async () => {
    const before = app.live.botRefusals.length;
    const game = await startGame(3, 3, { voteVisibility: "open" });
    const clients: (Client | null)[] = await Promise.all(game.humans.map((h) => Client.open(game.id, h)));
    const brains = brainsFor(game);
    // Play until the first meeting is open.
    expect(await play(game, clients, brains, (s) => s.phase.kind === "meeting")).toEqual([]);
    const meetingId = (await load(game.id)).meeting!.id;
    const leaver = clients[0]!;
    const target = game.humans[1]!.player;
    expect(await leaver.send({ type: "castVote", vote: { kind: "shakedown", target } })).toMatchObject({ ok: true });
    leaver.close();
    await vi.waitFor(() => expect(leaver.closed).not.toBeNull(), quick);
    // While they're away, the others vote (open votes: public changes they'll miss).
    clients[0] = null;
    for (const c of clients) if (c) expect(await c.send({ type: "castVote", vote: { kind: "skip" } })).toMatchObject({ ok: true });
    await clients[1]!.barrier(); // the bots' answers to the last vote land after its reply
    const mid = await load(game.id);
    expect(mid.meeting?.id).toBe(meetingId);
    const back = await Client.open(game.id, game.humans[0]!);
    expect(back.lastView()).toEqual(viewFor(mid, game.humans[0]!.player));
    expect(back.lastView().me.vote).toEqual({ kind: "shakedown", target });
    expect(back.lastView().ledger.length).toBeGreaterThan(leaver.lastView().ledger.length);
    clients[0] = back;
    const refused = await play(game, clients, brains);
    await finish(game, [leaver, ...(clients as Client[])], refused, before);
  }, 60_000);

  it("two tabs for one seat: both get the same views in the same order; replies go only to the tab that sent", async () => {
    const before = app.live.botRefusals.length;
    const game = await startGame(2, 2);
    const tabA = await Client.open(game.id, game.humans[0]!);
    const tabB = await Client.open(game.id, game.humans[0]!);
    const other = await Client.open(game.id, game.humans[1]!);
    const [brain0, brain1] = brainsFor(game);
    // The seat's commands alternate between its tabs.
    let flip = false;
    const refused: Refusal[] = [];
    for (let steps = 0; (await load(game.id)).phase.kind !== "ended"; steps++) {
      expect(steps).toBeLessThan(300);
      for (const [c, brain] of [[tabA, brain0], [other, brain1]] as const) {
        await c.barrier();
        for (const command of brain!(c.lastView())) {
          if ((await load(game.id)).phase.kind === "ended") break;
          const tab = c === tabA && (flip = !flip) ? tabB : c;
          const reply = await tab.send(command);
          if (!("ok" in reply)) refused.push({ player: tab.player, command, reply });
        }
      }
      await passDeadline(game.id);
    }
    await tabB.barrier();
    await tabA.barrier();
    expect(tabA.views()).toEqual(tabB.views());
    expect(tabA.views().length).toBeGreaterThan(10);
    await finish(game, [tabA, tabB, other], refused, before);
  }, 60_000);

  it("idle people get the default move every round, and still get the reveal", async () => {
    const before = app.live.botRefusals.length;
    const game = await startGame(2, 4, { roles: TEAM_ROLES });
    const clients = await Promise.all(game.humans.map((h) => Client.open(game.id, h)));
    const refused = await play(game, clients, clients.map(() => null));
    const final = await finish(game, clients, refused, before);
    // design §5.1: anyone without a move gets the Lobby, everything handed in.
    for (const h of game.humans) {
      const defaults = final.log.filter((e) => e.type === "defaultMoveAssigned" && e.player === h.player);
      expect(defaults).toHaveLength(final.resolvedRound);
      expect(final.log.some((e) => e.type === "moveSubmitted" && e.player === h.player)).toBe(false);
      expect(final.players[h.player]!.consecutiveMissedMoves).toBe(final.resolvedRound);
    }
  }, 60_000);

  it("the server restarts mid-round: the log survives as is, people reconnect to the same view and the game finishes", async () => {
    const before = app.live.botRefusals.length;
    const game = await startGame(2, 3);
    const clients = await Promise.all(game.humans.map((h) => Client.open(game.id, h)));
    const brains = brainsFor(game);
    expect(await play(game, clients, brains, (s) => s.phase.kind === "planning" && s.round === 5)).toEqual([]);
    await clients[0]!.send({ type: "submitMove", move: { room: "lobby", pocket: 0 } });
    const mid = await load(game.id);
    await app.close();
    for (const c of clients) await vi.waitFor(() => expect(c.closed).not.toBeNull(), quick);
    app = await boot(); // a new process: fresh store, cache and bots
    const botsBefore = app.live.botRefusals.length;
    expect(await load(game.id)).toEqual(mid);
    const again = await Promise.all(game.humans.map((h) => Client.open(game.id, h)));
    for (const [i, c] of again.entries()) expect(c.lastView()).toEqual(viewFor(mid, game.humans[i]!.player));
    expect(again[0]!.lastView().me.move).toEqual({ room: "lobby", pocket: 0 });
    const refused = await play(game, again, brains);
    const final = await finish(game, [...clients, ...again], refused, botsBefore);
    expect(final.log.slice(0, mid.log.length)).toEqual(mid.log);
    expect(app.live.botRefusals.length).toBe(botsBefore);
    void before;
  }, 60_000);

  it("an emergency meeting during its notice period: planning goes on, a second call is refused, the round waits for the vote", async () => {
    const game = await startGame(4, 0, { roles: TEAM_ROLES, eventsEnabled: false });
    const clients = await Promise.all(game.humans.map((h) => Client.open(game.id, h)));
    const [a, b, c, d] = clients as [Client, Client, Client, Client];
    // design §11.1: one emergency per player; the notice period is the server's.
    expect(await a.send({ type: "callEmergency" })).toMatchObject({ ok: true });
    for (const x of clients) {
      await x.barrier();
      expect(x.lastView().pendingEmergency).toEqual({ meetingId: `emergency-${a.player}`, by: a.player });
    }
    expect(await b.send({ type: "submitMove", move: { room: "office", pocket: 0 } })).toMatchObject({ ok: true });
    expect(await c.send({ type: "callEmergency" })).toMatchObject({ rejected: true });
    await app.live.system(game.id, { type: "advance", deadline: { kind: "openMeeting", meetingId: `emergency-${a.player}` } });
    // design §4.1: rounds pause while the vote window is open.
    await expect(app.live.system(game.id, { type: "advance", deadline: { kind: "round", round: 1 } })).rejects.toThrow(/refused/);
    expect(await d.send({ type: "submitMove", move: { room: "office", pocket: 0 } })).toMatchObject({ rejected: true });
    for (const x of [b, c, d]) expect(await x.send({ type: "castVote", vote: { kind: "shakedown", target: a.player } })).toMatchObject({ ok: true });
    expect(await a.send({ type: "callEmergency" })).toMatchObject({ rejected: true });
    await passDeadline(game.id); // close
    while ((await load(game.id)).phase.kind === "shakedownPending") await passDeadline(game.id);
    const after = await load(game.id);
    expect(after.phase).toEqual({ kind: "planning", round: 1 });
    await b.barrier();
    expect(b.lastView().me.move).toEqual({ room: "office", pocket: 0 }); // kept through the meeting
    expect(after.log.some((e) => e.type === "shakedownResolved" && e.target === a.player)).toBe(true);
    const refused = await play(game, clients, clients.map(() => steadyBrain("office")));
    const final = await finish(game, clients, refused, app.live.botRefusals.length);
    expect(final.log.filter((e) => e.type === "meetingOpened" && e.kind === "emergency")).toHaveLength(1);
  }, 60_000);

  it("a Duel game: no meetings over the socket, call-outs settle at the act's end, and the reveal ranks both (design §16.1)", async () => {
    // The lobby has no Duel setting yet, so this one game starts through the store with duel: true.
    const { id, sessions } = await openLobby(2, 0, { roles: TEAM_ROLES });
    const seats = (await lobby(id, sessions[0]!)).seats;
    const config: GameConfig = {
      ...gameConfig({ ...(await lobby(id, sessions[0]!)).settings }, seats.map((x) => ({ nickname: x.nickname, bot_personality: x.bot })), "duel-scenario"),
      duel: true,
    };
    await store.start(id, config, async (tx) => {
      for (const [i, seat] of seats.entries()) await tx.query("update seats set player_id = $3 where game_id = $1 and seat_no = $2", [id, seat.seat, playerIdFor(i)]);
    });
    const game = await seated(id, sessions);
    const clients = await Promise.all(game.humans.map((h) => Client.open(game.id, h)));
    const a = clients[0]!;
    for (const cmd of [{ type: "callEmergency" }, { type: "proposeMeeting", slot: "now" }, { type: "sealVote", vote: { kind: "skip" } }]) {
      expect(await a.send(cmd)).toMatchObject({ rejected: true, reason: expect.stringMatching(/Duel/) });
    }
    // b skims; a calls b out in act 1 (caught) and act 2.
    expect(await a.send({ type: "callOut" })).toMatchObject({ ok: true });
    expect(await a.send({ type: "callOut" })).toMatchObject({ rejected: true });
    const skimmer: Brain = (view) =>
      view.phase.kind === "planning" && !view.me.move
        ? [{ type: "submitMove", move: { room: view.card?.room === "office" ? "vault" : "office", pocket: view.me.role === "insideMan" ? 0 : 2 } }]
        : [];
    const caller: Brain = (view) => {
      const out: unknown[] = steadyBrain("lobby")(view).slice();
      if (view.phase.kind === "planning" && view.round === 4) out.push({ type: "callOut" });
      return out;
    };
    const refused = await play(game, clients, [caller, skimmer]);
    const final = await finish(game, clients, refused, app.live.botRefusals.length);
    const resolved = final.log.filter((e) => e.type === "callOutResolved");
    expect(resolved.length).toBeGreaterThanOrEqual(2);
    expect(typesIn(final).has("meetingOpened")).toBe(false);
  }, 60_000);

  it("a 12-player Everything game deals different roles, and plays to the reveal (extension.md \"Decks and dealing\")", async () => {
    const before = app.live.botRefusals.length;
    const game = await startGame(2, 10, { deck: "everything", eventsEnabled: true, voteVisibility: "secret" });
    const clients = await Promise.all(game.humans.map((h) => Client.open(game.id, h)));
    const state = await load(game.id);
    const roles = state.playerOrder.map((p) => state.players[p]!.role).sort();
    // Unique roles (the default) from the 20-role Everything deck: twelve different roles.
    expect(new Set(roles).size).toBe(12);
    for (const r of roles) expect(POOL_ROLES).toContain(r);
    const refused = await play(game, clients, brainsFor(game));
    const final = await finish(game, clients, refused, before);
    expect(final.playerOrder).toHaveLength(12);
  }, 90_000);

  it("the heist fails by Heat: everyone hits the Vault until the cops raid at 100 (design §7)", async () => {
    const game = await startGame(3, 0, { roles: TEAM_ROLES, eventsEnabled: false });
    const clients = await Promise.all(game.humans.map((h) => Client.open(game.id, h)));
    const refused = await play(game, clients, clients.map(() => steadyBrain("vault")));
    const final = await finish(game, clients, refused, app.live.botRefusals.length);
    expect(final.phase).toMatchObject({ kind: "ended", outcome: { result: "failed", reason: "heat" } });
    expect(final.heat).toBe(100);
    for (const c of clients) expect(c.lastView().ledger.some((e) => e.event.type === "copsRaided")).toBe(true);
  }, 60_000);

  it("the heist fails by target: a crew on the Rooftop misses every checkpoint and the final target (design §11.5)", async () => {
    const game = await startGame(3, 0, { roles: TEAM_ROLES, eventsEnabled: false });
    const clients = await Promise.all(game.humans.map((h) => Client.open(game.id, h)));
    const refused = await play(game, clients, clients.map(() => steadyBrain("rooftop")));
    const final = await finish(game, clients, refused, app.live.botRefusals.length);
    expect(final.phase).toMatchObject({ kind: "ended", outcome: { result: "failed", reason: "target" } });
    expect(final.haul).toBe(0);
    const checks = final.log.filter((e) => e.type === "checkpointChecked");
    expect(checks.map((e) => [e.act, e.met])).toEqual([[1, false], [2, false], [3, false]]);
    // design §11.5: a missed Act 1/2 checkpoint adds Heat; the final check doesn't.
    expect(checks.map((e) => e.heatPenalty > 0)).toEqual([true, true, false]);
  }, 60_000);

  it("hostile input over a socket is refused and the game carries on (bad shapes, forged ids, system commands)", async () => {
    const game = await startGame(2, 1, { roles: TEAM_ROLES });
    const [a] = await Promise.all(game.humans.map((h) => Client.open(game.id, h)));
    const before = await load(game.id);
    const hostile: unknown[] = [
      { type: "advance", deadline: { kind: "round", round: 1 } },
      { type: "scheduleMeeting", act: 1, slot: "now" },
      { type: "submitMove", move: { room: "vault", pocket: 999 } },
      { type: "submitMove", move: { room: "lobby", pocket: -1 } },
      { type: "castVote", vote: { kind: "shakedown", target: "p99" } },
      // A value with no string form (JSON can make one). The engine throws on it (see the
      // engine's invariants.prop.test.ts, HOSTILE); the server must still just refuse.
      JSON.parse('{"type":"submitMove","move":{"room":{"toString":null},"pocket":0}}'),
      JSON.parse('{"type":"acceptMeeting","proposalId":{"toString":null}}'),
    ];
    for (const cmd of hostile) expect(await a!.send(cmd)).toMatchObject({ rejected: true });
    expect((await load(game.id)).log).toEqual(before.log);
    expect(await a!.send({ type: "submitMove", move: { room: "lobby", pocket: 0 } })).toMatchObject({ ok: true });
    a!.close();
  }, 30_000);
});
