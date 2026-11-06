// The suspicion model over real (scripted) engine games, read through viewFor
// only. design §17.3; §5.3 shortfall, §5.4 alibis, §6.1 Security, §6.2 Server
// room, §11.3 shakedown results
import { describe, expect, it } from "vitest";
import { viewFor, type GameState, type PlayerId } from "@skimjob/engine";
import { SUSPICION_WEIGHTS as W, mostSuspicious, suspicion } from "./suspicion";
import { closeAlibis, game, round, run, type Plan } from "./testkit";

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

  it("my own Detective and Auditor results count (v2 §2)", () => {
    // Everyone hands in, so only the powers' results move the scores.
    const s = closeAlibis(round(game(3), { ana: { room: "office" }, ben: { room: "vault" }, carl: { room: "vault" } }));
    const mine = (ability: object): GameState => ({
      ...s,
      log: [...s.log, { type: "abilityResolved", visibility: { kind: "private", player: "ana" }, player: "ana", round: 2, ability } as GameState["log"][number]],
    });
    expect(scoresOf(mine({ kind: "checkStash", target: "carl", threshold: 3, dirty: true }), "ana").get("carl")).toBe(W.checkedDirty);
    // A Vault shortfall of 4 (made up), shared by ben and carl who both claimed it.
    const audited = scoresOf(mine({ kind: "audit", round: 1, room: "vault", shortfall: 4 }), "ana");
    expect([audited.get("ben"), audited.get("carl")]).toEqual([2 * W.audited, 2 * W.audited]);
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

  it("the Server room's count clears a gap when nobody else pocketed — design §6.2", () => {
    // Dee hands in the Lobby's 2 but claims the Vault: 4 unexplained, yet the count says nobody pocketed.
    const plan: Plan = {
      ana: { room: "serverRoom" },
      ben: { room: "office" },
      carl: { room: "office" },
      dee: { room: "lobby", alibi: "vault" },
      eve: { room: "lobby" },
    };
    const s = round(game(5), plan);
    expect([...scoresOf(s, "ana").values()]).toEqual([0, 0, 0, 0]);
    // Ben has no count, so he blames the claimers.
    expect(scoresOf(s, "ben").get("dee")).toBeGreaterThan(0);
  });

  it("a shakedown resets the target's score: low if clean, a little raised if not — design §11.3", () => {
    let s = game(3);
    for (let r = 1; r <= 3; r++) s = round(s, { ana: { room: "vault" }, ben: { room: "vault", pocket: 3, alibi: "lobby" }, carl: { room: "lobby" } });
    expect(scoresOf(s, "ana").get("ben")).toBe(3 * W.lie);
    // Act 1 meeting: Ana and Carl shake Ben down (9 in stash: not clean), then Carl, who is clean.
    s = run(
      closeAlibis(s),
      { type: "scheduleMeeting", act: 1, slot: "x" },
      { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } },
      { type: "castVote", player: "ana", vote: { kind: "shakedown", target: "ben" } },
      { type: "castVote", player: "carl", vote: { kind: "shakedown", target: "ben" } },
      { type: "advance", deadline: { kind: "closeMeeting", meetingId: "act-1" } },
    );
    // A Shield in the shop opens the shakedown window first (design §8.3).
    const resolve = (x: GameState) => (x.pendingShakedown ? run(x, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: x.pendingShakedown.meetingId } }) : x);
    s = resolve(s);
    expect(scoresOf(s, "ana").get("ben")).toBe(W.afterDirty);
    s = run(
      s,
      { type: "callEmergency", player: "ana" },
      { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-ana" } },
      { type: "castVote", player: "ana", vote: { kind: "shakedown", target: "carl" } },
      { type: "castVote", player: "ben", vote: { kind: "shakedown", target: "carl" } },
      { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-ana" } },
    );
    s = resolve(s);
    expect(scoresOf(s, "ana").get("carl")).toBe(W.afterClean);
  });
});
