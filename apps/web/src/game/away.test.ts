// "While you were away" (design §13), from real engine views. M2-10 acceptance:
// recaps for a quiet round, a meeting, a shakedown and a checkpoint; nothing
// in a recap comes from outside the viewer's own view.
import { createGame, eventsSince, handleCommand, viewFor, type GameConfig, type GameState, type PlayerCommand, type PlayerId, type SystemCommand } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { nextUp, recap, recapItems, RECAP_MAX_LINES, topSeq } from "./away";
import { namesOf } from "./hud";
import { BANK_JOB } from "@skimjob/content";

const config = (n = 5, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "away-test",
  players: ["Ana", "Ben", "Cy", "Dee", "Eve", "Fay", "Gus", "Hal", "Ivy", "Jo", "Kit", "Lu"].slice(0, n).map((name, i) => ({ id: `p${i + 1}`, name, isBot: false })),
  job: "bank",
  rolePool: ["rookie"],
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  uniqueRoles: false,
  ...extra,
});

function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
const ids = (s: GameState) => s.config.players.map((p) => p.id);
const allMove = (s: GameState, room = "office") => run(s, ...ids(s).map((p) => ({ type: "submitMove", player: p, move: { room, duffel: BANK_JOB.rooms[room]?.coins ?? 0, pocket: 0 } }) as PlayerCommand));
const round = (r: number): SystemCommand => ({ type: "advance", deadline: { kind: "round", round: r } });
const alibisClose = (r: number): SystemCommand => ({ type: "advance", deadline: { kind: "alibis", round: r } });
const open = (id: string): SystemCommand => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: id } });
const close = (id: string): SystemCommand => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: id } });
const shake = (player: PlayerId, target: PlayerId): PlayerCommand => ({ type: "castVote", player, vote: { kind: "shakedown", target } });
const skip = (player: PlayerId): PlayerCommand => ({ type: "castVote", player, vote: { kind: "skip" } });

/** Plays a round (everyone to `room`, all in) through its alibi window, if one opens. */
function playRound(s: GameState, room = "office"): GameState {
  const r = s.phase.kind === "planning" ? s.phase.round : -1;
  s = run(allMove(s, room), round(r));
  return s.phase.kind === "alibis" ? run(s, alibisClose(r)) : s;
}

/** The recap `player` would get on returning to `after`, having last looked at `before`. */
function recapBetween(before: GameState, after: GameState, player: PlayerId = "p1") {
  const seen = topSeq(viewFor(before, player));
  const view = viewFor(after, player);
  const ctx = { me: player, name: namesOf(view) };
  return recap(eventsSince(view, seen), view, ctx);
}

describe("while you were away (design §13)", () => {
  it("says nothing when nothing happened, or only lock-in marks", () => {
    const s = createGame(config());
    expect(recapBetween(s, s)).toEqual([]);
    const locked = run(s, { type: "submitMove", player: "p2", move: { room: "vault", duffel: 3, pocket: 0 } });
    expect(recapBetween(s, locked)).toEqual([]);
  });

  it("a quiet round: the round's Haul and Heat, then what's next", () => {
    const s = createGame(config());
    const lines = recapBetween(s, playRound(s));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(RECAP_MAX_LINES);
    expect(lines.find((l) => l.startsWith("Round 1 done"))).toMatch(/^Round 1 done: Haul \+\d+ \(now \d+\), Heat [+−]\d+ \(now \d+\)\.$/);
    expect(lines.at(-1)).toBe("Now: round 2. Pick your room before the deadline.");
  });

  it("several rounds away add up into one line", () => {
    const s = createGame(config());
    const after = playRound(playRound(s));
    const lines = recapBetween(s, after);
    const last = after.log.filter((e) => e.type === "roundResolved").at(-1) as { haul: number };
    expect(lines.find((l) => l.startsWith("Rounds"))).toMatch(new RegExp(`^Rounds 1–2 done: Haul \\+\\d+ \\(now ${last.haul}\\)`));
  });

  it("a meeting: the vote result", () => {
    const s = createGame(config());
    const met = run(s, { type: "callEmergency", player: "p2" }, open("emergency-p2"), skip("p1"), skip("p3"), skip("p4"), skip("p5"), close("emergency-p2"));
    const lines = recapBetween(s, met);
    expect(lines).toContain("Ben called an emergency meeting.");
    expect(lines.some((l) => /^The crew voted to skip/.test(l))).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(RECAP_MAX_LINES);
  });

  it("a shakedown: the result, not the vote that called it", () => {
    let s = playRound(createGame(config()));
    const before = s;
    s = run(s, { type: "callEmergency", player: "p2" }, open("emergency-p2"), shake("p1", "p2"), shake("p3", "p2"), shake("p4", "p2"), close("emergency-p2"));
    if (s.phase.kind === "shakedownPending") s = run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.phase.meetingId } });
    const lines = recapBetween(before, s);
    expect(lines.some((l) => /^Ben was shaken down: a stash of \d+/.test(l))).toBe(true);
    expect(lines.some((l) => /voted to shake down/.test(l))).toBe(false);
  });

  it("a checkpoint: made or missed, with the Haul and the target", () => {
    let s = createGame(config());
    while (s.phase.kind === "planning") s = playRound(s);
    expect(s.phase.kind).toBe("awaitingMeeting");
    const before = s;
    s = run(s, { type: "scheduleMeeting", act: 1, slot: "act-1" }, open("act-1"), ...ids(s).map(skip), close("act-1"));
    const lines = recapBetween(before, s);
    expect(lines.some((l) => /^Meeting 1 target: Haul \d+, target \d+, (made it|missed)/.test(l))).toBe(true);
    expect(lines.at(-1)).toBe("Now: round 4. Pick your room before the deadline.");
  });

  it("your case file: one entry in full, several as a count; your own moves aren't news", () => {
    const s = createGame(config());
    // Everyone goes to the Security room and watches the vault: a sighting and a camera result each.
    const after = run(s, ...ids(s).map((p) => ({ type: "submitMove", player: p, move: { room: "security", duffel: 0, pocket: 0, watch: "vault" } }) as PlayerCommand), round(1));
    const lines = recapBetween(s, after);
    const news = lines.filter((l) => /case file|^Only you:/.test(l));
    expect(news).toHaveLength(1);
    expect(lines.join("\n")).not.toMatch(/picked the/);
  });

  it("the game's end comes first and nothing is 'next'", () => {
    let s = createGame(config(3));
    const before = s;
    for (let guard = 0; guard < 200 && s.phase.kind !== "ended"; guard++) s = step(s);
    expect(s.phase.kind).toBe("ended");
    const items = recapBetween(before, s);
    expect(items.length).toBeLessThanOrEqual(RECAP_MAX_LINES);
    expect(items.some((l) => /^(Job done|Busted)/.test(l))).toBe(true);
    expect(nextUp(viewFor(s, "p1"))).toBeNull();
  });
});

/** One scheduler-ish step: everyone moves (Ana pockets 1), alibis close, meetings open and close with skips. */
function step(s: GameState): GameState {
  const p = s.phase;
  if (p.kind === "planning") {
    const rooms = s.rooms.filter((r) => !(s.card?.round === p.round && s.card.room === r));
    for (const [i, id] of ids(s).entries()) {
      const room = rooms[(i + p.round) % rooms.length]!;
      const r = handleCommand(s, { type: "submitMove", player: id, move: { room, duffel: Math.max(0, (BANK_JOB.rooms[room]?.coins ?? 0) - (i % 2)), pocket: i % 2, ...(room === "security" ? { watch: rooms[0] } : {}) } } as PlayerCommand);
      if (r.ok) s = r.state;
    }
    return run(s, round(p.round));
  }
  if (p.kind === "alibis") {
    const r = handleCommand(s, { type: "postAlibi", player: "p2", room: s.rooms[0] } as PlayerCommand);
    return run(r.ok ? r.state : s, alibisClose(p.round));
  }
  if (p.kind === "awaitingMeeting") {
    if (!s.scheduledMeeting) s = run(s, { type: "scheduleMeeting", act: p.act, slot: `s-${p.act}` });
    return run(s, open(s.scheduledMeeting!.meetingId));
  }
  if (p.kind === "meeting") {
    // Act 2: shake down p2 to cover shakedowns in the sweep.
    const votes = p.meetingId === "act-2" ? ids(s).filter((x) => x !== "p2").map((x) => shake(x, "p2")) : [];
    for (const v of votes) {
      const r = handleCommand(s, v);
      if (r.ok) s = r.state;
    }
    return run(s, close(p.meetingId));
  }
  if (p.kind === "shakedownPending") return run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: p.meetingId } });
  throw new Error(`unexpected phase ${p.kind}`);
}

describe("leaks: a recap holds only the viewer's own view (design §13, §17.2)", () => {
  for (const n of [3, 5, 9]) {
    it(`whole game at ${n} seats: every line comes from the viewer's ledger or own case file`, () => {
      const roles = n >= 5 ? ["rookie", "lookout", "priest", "hacker", "auditor", "detective"] : ["rookie"];
      let s = createGame(config(n, { rolePool: roles, eventsEnabled: true }));
      const states = [s];
      for (let guard = 0; guard < 300 && s.phase.kind !== "ended"; guard++) states.push((s = step(s)));
      expect(s.phase.kind).toBe("ended");
      let lines = 0;
      for (const id of ids(s)) {
        // Every pair of a "last looked" state and a later "came back" state, a few rounds apart.
        for (let i = 0; i < states.length; i += 3) {
          for (const j of [i + 1, i + 4, states.length - 1]) {
            if (j >= states.length || j <= i) continue;
            const view = viewFor(states[j]!, id);
            const own = new Map([...view.ledger, ...view.caseFile].map((e) => [e.seq, e.event]));
            const items = recapItems(eventsSince(view, topSeq(viewFor(states[i]!, id))), view, { me: id, name: namesOf(view) });
            expect(items.length).toBeLessThanOrEqual(RECAP_MAX_LINES);
            for (const item of items) {
              lines++;
              for (const seq of item.from) {
                const e = own.get(seq);
                expect(e, `seq ${seq} is in ${id}'s view`).toBeDefined();
                // A private source is the viewer's own; never someone else's (nor the reveal's).
                if (e!.visibility.kind !== "public") expect(e!.visibility).toMatchObject({ player: id });
              }
            }
          }
        }
      }
      expect(lines).toBeGreaterThan(0);
    });
  }
});
