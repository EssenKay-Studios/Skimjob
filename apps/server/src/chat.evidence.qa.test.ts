// QA for PR #38 (PM decision: role cards can't be shared as evidence). The
// server refuses role-deal, faction/ally and compromised-vote entries, while
// sightings and audits still go through: on sample entries, on a real game's
// case files, and through `chat.post` itself. design §8, §11.2, §12.1
import { describe, expect, it } from "vitest";
import { handleCommand, replay, setupEvents, viewFor, type GameConfig, type GameEvent, type GameState, type PlayerView } from "@skimjob/engine";
import { sampleEvents } from "../../../packages/engine/src/types/samples";
import { createChat, evidenceCard } from "./chat";
import { fakeClock } from "./clock";
import type { Db } from "./db";

const ROLE_REASON = "role cards can't be shared: role claims stay unverified";

/** A view whose case file holds just `event` at seq 3 (evidenceCard reads only caseFile and ledger). */
const holding = (event: Record<string, unknown>): PlayerView =>
  ({ caseFile: [{ seq: 3, event: { visibility: { kind: "private", player: "ana" }, player: "ana", ...event } }], ledger: [] }) as unknown as PlayerView;

describe("QA: role and faction cards are refused (design §8, PR #38)", () => {
  it.each([
    ["the deal", sampleEvents.roleDealt],
    ["a token earned (its trigger names the role, extension.md \"Tokens and the perk shop\")", sampleEvents.tokenEarned],
    ["a landed tip-off (says you're the Mole, extension.md \"Police activity\")", sampleEvents.tipOffLanded],
    ["an Inside tip naming a role", sampleEvents.insideTip],
    ["a Peek naming a role", sampleEvents.perkUsed],
    ["a Double-cross swap naming roles", sampleEvents.doubleCrossResolved],
  ] as [string, GameEvent][])("%s", (_label, event) => {
    const { visibility: _v, ...rest } = event as GameEvent & Record<string, unknown>;
    expect(evidenceCard(holding(rest), 3)).toEqual({ ok: false, reason: ROLE_REASON });
  });

  it("a faction or role key anywhere in the payload, however deep, is refused", () => {
    for (const extra of [{ faction: "loneWolf" }, { info: { faction: "accomplice" } }, { list: [{ x: [{ role: "mole" }] }] }, { roles: {} }, { allies: [] }]) {
      expect(evidenceCard(holding({ type: "roomSighting", round: 1, room: "vault", others: [], ...extra }), 3), JSON.stringify(extra)).toEqual({ ok: false, reason: ROLE_REASON });
    }
  });

  it.each([
    ["a sighting", { type: "roomSighting", round: 1, room: "vault", others: ["ben"] }],
    ["a watched room", { type: "roomWatched", round: 1, source: "security", room: "vault", seen: ["ben"] }],
    ["an audit", { type: "abilityResolved", round: 2, ability: { kind: "audit", round: 1, room: "vault", shortfall: 4 } }],
    ["a stash check", { type: "abilityResolved", round: 2, ability: { kind: "checkStash", target: "ben", threshold: 12, dirty: true } }],
    ["a loot split", { type: "lootSplit", round: 1, room: "vault", loot: 6, toHaul: 4, toStash: 2 }],
    ["a pocket count", { type: "pocketCount", round: 1, pocketed: 1 }],
  ])("%s still goes through, verified, with its payload intact", (_label, event) => {
    const r = evidenceCard(holding(event), 3);
    const { type, ...payload } = event;
    expect(r).toEqual({ ok: true, value: { type, payload: { player: "ana", ...payload } } });
  });
});

// ---------- A real game (engine), and chat.post itself ----------

const config: GameConfig = {
  seed: "qa-38-evidence",
  players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
  job: "bank",
  rolePool: [],
  eventsEnabled: false,
  voteVisibility: "open",
} as GameConfig;

/** Seat i dealt roles[i] (Rookie if missing). */
function game(roles: readonly string[]): GameState {
  const log = setupEvents(config).map((e, i, all): GameEvent => (e.type !== "roleDealt" ? e : { ...e, role: roles[all.slice(0, i).filter((x) => x.type === "roleDealt").length] ?? "rookie" }));
  return replay(config, log);
}
function run(s: GameState, ...commands: unknown[]): GameState {
  for (const c of commands) {
    const r = handleCommand(s, typeof c === "function" ? (c as (x: GameState) => unknown)(s) : c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    s = r.state;
    if (s.phase.kind === "alibis") s = run(s, { type: "advance", deadline: { kind: "alibis", round: s.phase.round } });
  }
  return s;
}
const mv = (player: string, room: string) => ({ type: "submitMove", player, move: { room, pocket: 0 } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });

/** The real chat with a Db that only answers the insert. */
function chatOn() {
  let n = 0;
  const db = {
    async query(_sql: string, params: unknown[] = []) {
      const [, from, to, sentAt, text, card] = params as [string, string, string | null, Date, string | null, string | null];
      return [{ id: `m${++n}`, from_player: from, to_player: to, sent_at: sentAt, text, card }];
    },
  } as unknown as Db;
  return createChat(db, fakeClock(1_000_000));
}

describe("QA: in a real game, the Auditor's deal is refused but its sighting and audit go through (design §8, §12.1)", () => {
  // p0 Auditor and p1 in the Vault, p2 in the Office; then p0 audits the Vault.
  const s = run(game(["auditor"]), mv("p0", "vault"), mv("p1", "vault"), mv("p2", "office"), ROUND, { type: "useAbility", player: "p0", ability: { kind: "audit", room: "vault" } });
  const view = viewFor(s, "p0");
  const entry = (type: string, pred: (e: GameEvent) => boolean = () => true) => {
    const e = view.caseFile.find((x) => x.event.type === type && pred(x.event));
    expect(e, type).toBeDefined();
    return e!;
  };

  it("evidenceCard on the player's own view", () => {
    expect(evidenceCard(view, entry("roleDealt").seq)).toEqual({ ok: false, reason: ROLE_REASON });
    expect(evidenceCard(view, entry("roomSighting").seq)).toMatchObject({ ok: true, value: { type: "roomSighting", payload: { player: "p0", room: "vault", others: ["p1"] } } });
    const audit = entry("abilityResolved", (e) => (e as { ability?: { kind?: string } }).ability?.kind === "audit");
    expect(evidenceCard(view, audit.seq)).toMatchObject({ ok: true, value: { type: "abilityResolved", payload: { ability: { kind: "audit", room: "vault" } } } });
  });

  it("chat.post refuses the deal to the crew and in a DM, and sends the sighting and the audit as verified cards", async () => {
    const chat = chatOn();
    for (const to of [null, "p1"]) expect(await chat.post("g1", s, "p0", { to, evidence: entry("roleDealt").seq })).toEqual({ ok: false, reason: ROLE_REASON });
    const sighting = await chat.post("g1", s, "p0", { to: null, evidence: entry("roomSighting").seq });
    expect(sighting).toMatchObject({ ok: true, value: { message: { from: "p0", verified: true, card: { type: "roomSighting" } } } });
    const audit = entry("abilityResolved", (e) => (e as { ability?: { kind?: string } }).ability?.kind === "audit");
    expect(await chat.post("g1", s, "p0", { to: "p1", evidence: audit.seq })).toMatchObject({ ok: true, value: { message: { to: "p1", verified: true, card: { type: "abilityResolved" } } } });
    // Refused cards don't spend the rate limit: six more go through.
    for (let i = 0; i < 6; i++) expect((await chat.post("g1", s, "p0", { to: null, text: `t${i}` })).ok).toBe(true);
  });

  it("every seat's deal is refused, for every seat", () => {
    for (const p of ["p0", "p1", "p2", "p3"]) {
      const v = viewFor(s, p);
      const deal = v.caseFile.find((e) => e.event.type === "roleDealt")!;
      expect(evidenceCard(v, deal.seq), p).toEqual({ ok: false, reason: ROLE_REASON });
    }
  });
});
