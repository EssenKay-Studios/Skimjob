// The suspicion model over real (scripted) engine games, read through viewFor
// only. design §19.3; §5.3 shortfall, §5.4 alibis, §3.4 Security, §11.1
// powers, §13 the Audit card, §9.6 shakedown results
import { describe, expect, it } from "vitest";
import { viewFor, type GameState, type PlayerId } from "@skimjob/engine";
import { SUSPICION_WEIGHTS as W, mostSuspicious, suspicion } from "./suspicion";
import { closeAlibis, emergencyMeeting, game, round, run, toResult, type Plan } from "./testkit";

const scoresOf = (s: GameState, viewer: PlayerId) => suspicion(viewFor(s, viewer));

describe("suspicion — design §17.3", () => {
  it("starts at zero for everyone else", () => {
    const scores = scoresOf(game(3), "ana");
    expect([...scores]).toEqual([
      ["ben", 0],
      ["carl", 0],
    ]);
  });

  it("a shortfall is shared by who could have taken it, weighted by their claimed room's loot — design §5.3", () => {
    // Ben loots the Vault and pockets 4, truthfully claiming the Vault; Carl hands in the Lobby's 2.
    const s = round(game(3), {
      ana: { room: "office" },
      ben: { room: "vault", pocket: 4 },
      carl: { room: "lobby" },
    });
    const scores = scoresOf(s, "ana");
    // Others claimed 6 + 2 = 8 but handed in 4: 4 unexplained, split 7 : 3 (loot + 1).
    expect(scores.get("ben")).toBeCloseTo((4 * 7) / 10);
    expect(scores.get("carl")).toBeCloseTo((4 * 3) / 10);
    expect(mostSuspicious(scores)?.player).toBe("ben");
  });

  it("my own Detective and Auditor results count against the alibis — design §11.1", () => {
    // Everyone hands in, so only the powers' results move the scores.
    const s = closeAlibis(round(game(3), { ana: { room: "office" }, ben: { room: "vault" }, carl: { room: "vault" } }));
    const mine = (ability: object): GameState => ({
      ...s,
      log: [...s.log, { type: "abilityResolved", visibility: { kind: "private", player: "ana" }, player: "ana", round: 2, ability } as GameState["log"][number]],
    });
    // Detective: carl claimed the Vault (6 coins); a grab of 6 fits, a grab of 7 can't.
    expect(scoresOf(mine({ kind: "detect", round: 1, target: "carl", grabbed: 6 }), "ana").get("carl")).toBe(0);
    expect(scoresOf(mine({ kind: "detect", round: 1, target: "carl", grabbed: 7 }), "ana").get("carl")).toBe(W.lie);
    // Auditor: ben and carl both claimed the Vault (6 coins each), but only 8 reached the duffel from it: 4 short, shared.
    const audited = scoresOf(mine({ kind: "audit", round: 1, room: "vault", duffel: 8 }), "ana");
    expect([audited.get("ben"), audited.get("carl")]).toEqual([2 * W.audited, 2 * W.audited]);
    expect(scoresOf(mine({ kind: "audit", round: 1, room: "vault", duffel: 12 }), "ana").get("ben")).toBe(0);
  });

  it("the Audit card counts like my Auditor's result, for every room — design §13", () => {
    const s = closeAlibis(round(game(3), { ana: { room: "office" }, ben: { room: "vault" }, carl: { room: "vault" } }));
    const audit = (duffel: Record<string, number>): GameState => ({
      ...s,
      log: [...s.log, { type: "auditReport", visibility: { kind: "public" }, round: 1, duffel } as GameState["log"][number]],
    });
    // ben and carl claimed the Vault (6 coins each), but only 8 reached the duffel from it: 4 short, shared.
    const audited = scoresOf(audit({ vault: 8, office: 2, lobby: 0 }), "ana");
    expect([audited.get("ben"), audited.get("carl")]).toEqual([2 * W.audited, 2 * W.audited]);
    expect(scoresOf(audit({ vault: 12, office: 2, lobby: 0 }), "ana").get("ben")).toBe(0);
  });

  it("a blacked-out room's feed shows nobody, which clears or blames nobody — design §11.1", () => {
    // Ana watches the Vault from Security; carl claims the Vault but is in the Lobby.
    const s = round(game(3), { ana: { room: "security", watch: "vault" }, ben: { room: "office" }, carl: { room: "lobby", alibi: "vault" } });
    expect(scoresOf(s, "ana").get("carl")).toBeGreaterThanOrEqual(W.lie);
    const dark: GameState = {
      ...s,
      log: s.log.map((e) => (e.type === "roomWatched" ? { ...e, seen: [], offline: true } : e)),
    };
    expect(scoresOf(dark, "ana").get("carl")).toBeLessThan(W.lie);
  });

  it("no shortfall, no blame", () => {
    const s = round(game(3), { ana: { room: "office" }, ben: { room: "vault" }, carl: { room: "lobby" } });
    expect([...scoresOf(s, "ana").values()]).toEqual([0, 0]);
  });

  it("an alibi that contradicts my own sighting is a lie — design §5.4, §5.2", () => {
    // Ana and Ben were both in the Vault; Ben pockets 4 and claims the Lobby (which covers the gap).
    const s = round(game(3), {
      ana: { room: "vault" },
      ben: { room: "vault", pocket: 4, alibi: "lobby" },
      carl: { room: "office" },
    });
    const scores = scoresOf(s, "ana");
    expect(scores.get("ben")).toBe(W.lie);
    expect(scores.get("carl")).toBe(0); // no shortfall: the lie covered it exactly
    // Carl saw nothing, so the same lie fools him.
    expect(scoresOf(s, "carl").get("ben")).toBe(0);
  });

  it("Security catches an alibi for the watched room from someone not in it, and one elsewhere from someone in it — design §6.1", () => {
    const s = round(game(4), {
      ana: { room: "security", watch: "vault" },
      ben: { room: "vault", alibi: "office" }, // seen in the Vault
      carl: { room: "lobby", alibi: "vault" }, // claims the Vault but wasn't seen there
      dee: { room: "office" },
    });
    const scores = scoresOf(s, "ana");
    expect(scores.get("ben")).toBeGreaterThanOrEqual(W.lie);
    expect(scores.get("carl")).toBeGreaterThanOrEqual(W.lie);
    expect(scores.get("dee")).toBeLessThan(W.lie);
  });

  it("seeing someone where they said they were lowers suspicion", () => {
    const s = round(game(3), { ana: { room: "office" }, ben: { room: "office" }, carl: { room: "lobby" } });
    expect(scoresOf(s, "ana").get("ben")).toBe(-W.verified);
  });

  it("no alibi counts once the round's alibi window has closed — design §5.4", () => {
    let s = round(game(3), { ana: { room: "office" }, ben: { room: "office" }, carl: { room: "lobby", alibi: null } });
    expect(scoresOf(s, "ana").get("carl")).toBe(0); // still open: Carl may yet post it
    s = round(s, { ana: { room: "office" }, ben: { room: "office" }, carl: { room: "lobby" } });
    expect(scoresOf(s, "ana").get("carl")).toBe(W.noAlibi);
  });

  it("a shakedown resets the target's score: low if clean, a little raised if not — design §11.3", () => {
    let s = game(3);
    for (let r = 1; r <= 3; r++) s = round(s, { ana: { room: "vault" }, ben: { room: "vault", pocket: 3, alibi: "lobby" }, carl: { room: "lobby" } });
    expect(scoresOf(s, "ana").get("ben")).toBe(3 * W.lie);
    // An emergency: Ana and Carl shake Ben down (9 above the share: not clean); then a regular meeting shakes Carl down, who is clean.
    s = run(
      emergencyMeeting(s, "carl"),
      { type: "castVote", player: "ana", vote: { kind: "shakedown", target: "ben" } },
      { type: "castVote", player: "carl", vote: { kind: "shakedown", target: "ben" } },
      { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-1" } },
    );
    // A Shield in the shop opens the shakedown window first (design §8.3).
    const resolve = (x: GameState) => (x.pendingShakedown ? run(x, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: x.pendingShakedown.meetingId } }) : x);
    s = resolve(s);
    expect(scoresOf(s, "ana").get("ben")).toBe(W.afterDirty);
    // The bank (300) is far from a third, so a regular meeting is forced as a third would call it.
    s = toResult(round(s, { ana: { room: "lobby" }, ben: { room: "lobby" }, carl: { room: "lobby" } }));
    s = run(
      { ...s, phase: { kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" }, meetingDue: "regular" },
      { type: "scheduleMeeting", meetingId: "meeting-1", slot: "x" },
      { type: "advance", deadline: { kind: "openMeeting", meetingId: "meeting-1" } },
      { type: "castVote", player: "ana", vote: { kind: "shakedown", target: "carl" } },
      { type: "castVote", player: "ben", vote: { kind: "shakedown", target: "carl" } },
      { type: "advance", deadline: { kind: "closeMeeting", meetingId: "meeting-1" } },
    );
    s = resolve(s);
    expect(scoresOf(s, "ana").get("carl")).toBe(W.afterClean);
  });
});
