// QA (PR #174, S3a.8, round 2): a raided room's Audit 0 blames nobody, for
// the Audit card and for my own Auditor's result; a raid elsewhere or in
// another round excuses nothing. design §5.3, §11.1, §13
import { describe, expect, it } from "vitest";
import { viewFor, type GameState } from "@skimjob/engine";
import { SUSPICION_WEIGHTS as W, suspicion } from "./suspicion";
import { closeResult, game, round } from "./testkit";

type Ev = GameState["log"][number];
const raid = (room: string, r = 1): Ev =>
  ({ type: "roomRaided", visibility: { kind: "public" }, round: r, room, seized: 12, closedThrough: r + 2, wanted: 1 }) as Ev;
const auditCard = (duffel: Record<string, number>, r = 1): Ev => ({ type: "auditReport", visibility: { kind: "public" }, round: r, duffel }) as Ev;
const myAudit = (room: string, duffel: number): Ev =>
  ({ type: "abilityResolved", visibility: { kind: "private", player: "ana" }, player: "ana", round: 2, ability: { kind: "audit", round: 1, room, duffel } }) as Ev;

// ben and carl claim the Vault (6 coins each); ana is in the Office.
const base = () => closeResult(round(game(3), { ana: { room: "office" }, ben: { room: "vault" }, carl: { room: "vault" } }));
const scores = (s: GameState, extra: Ev[]) => suspicion(viewFor({ ...s, log: [...s.log, ...extra] }, "ana"));
const vaultPair = (m: Map<string, number>) => [m.get("ben"), m.get("carl")];

describe("QA §5.3, §13: the Audit of a raided room", () => {
  it("round-1 repro: the Audit card's 0 for a raided Vault adds nothing, before or after the raid in the log", () => {
    const s = base();
    expect(vaultPair(scores(s, [raid("vault")]))).toEqual([0, 0]);
    expect(vaultPair(scores(s, [raid("vault"), auditCard({ vault: 0, office: 2, lobby: 0 })]))).toEqual([0, 0]);
    expect(vaultPair(scores(s, [auditCard({ vault: 0, office: 2, lobby: 0 }), raid("vault")]))).toEqual([0, 0]);
  });

  it("my own Auditor result on a raided room blames nobody either", () => {
    const s = base();
    expect(vaultPair(scores(s, [raid("vault"), myAudit("vault", 0)]))).toEqual([0, 0]);
    // Control: the same 0 without a raid is 12 short, shared.
    expect(vaultPair(scores(s, [myAudit("vault", 0)]))).toEqual([6 * W.audited, 6 * W.audited]);
  });

  it("a raid on another room, or on the Vault in another round, excuses nothing", () => {
    const s = base();
    const short = [6 * W.audited, 6 * W.audited];
    expect(vaultPair(scores(s, [auditCard({ vault: 0, office: 2, lobby: 0 })]))).toEqual(short);
    expect(vaultPair(scores(s, [raid("office"), auditCard({ vault: 0, office: 0, lobby: 0 })]))).toEqual(short);
    expect(vaultPair(scores(s, [raid("vault", 2), auditCard({ vault: 0, office: 2, lobby: 0 })]))).toEqual(short);
  });
});
