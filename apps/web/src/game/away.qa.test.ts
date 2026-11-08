// QA (M2-10, PR #46): "While you were away" (design §13) at 2, 3 and 12 seats; recaps after a meeting, a shakedown, the
// end and a reconnect-style catch-up; nothing from anyone else's case file.
import { createGame, eventsSince, handleCommand, viewFor, type GameConfig, type GameState, type PlayerCommand, type PlayerId, type SystemCommand } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { recap, recapItems, RECAP_MAX_LINES, topSeq } from "./away";
import { namesOf } from "./hud";
import { BANK_JOB } from "@skimjob/content";

const NAMES = ["Ana", "Ben", "Cy", "Dee", "Eve", "Fay", "Gus", "Hal", "Ivy", "Jo", "Kit", "Lu"];
const config = (n: number, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: `away-qa-${n}`,
  players: NAMES.slice(0, n).map((name, i) => ({ id: `p${i + 1}`, name, isBot: false })),
  job: "bank",
  rolePool: n >= 5 ? ["rookie", "lookout", "priest", "hacker", "auditor", "detective"] : ["rookie"],
  eventsEnabled: n >= 5,
  voteVisibility: "hiddenThenRevealed",
  uniqueRoles: false,
  ...extra,
});
const ids = (s: GameState) => s.config.players.map((p) => p.id);
const tryRun = (s: GameState, c: PlayerCommand | SystemCommand) => {
  const r = handleCommand(s, c);
  return r.ok ? r.state : s;
};
function run(s: GameState, ...cs: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of cs) {
    const r = handleCommand(s, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    s = r.state;
  }
  return s;
}
const shake = (player: PlayerId, target: PlayerId): PlayerCommand => ({ type: "castVote", player, vote: { kind: "shakedown", target } });

/** A scheduler-ish step: varied rooms and pockets, alibis, meetings (the second shakes down p2), result windows, shakedowns resolve. */
function step(s: GameState): GameState {
  const p = s.phase;
  if (p.kind === "planning") {
    const rooms = s.rooms.filter((r) => !(s.card?.round === p.round && s.card.room === r));
    for (const [i, id] of ids(s).entries()) {
      const room = rooms[(i * 3 + p.round) % rooms.length]!;
      s = tryRun(s, { type: "submitMove", player: id, move: { room, duffel: Math.max(0, (BANK_JOB.rooms[room]?.coins ?? 0) - ((i + p.round) % 3)), pocket: (i + p.round) % 3, ...(room === "security" ? { watch: rooms[(i + 1) % rooms.length] } : {}) } } as PlayerCommand);
    }
    return run(s, { type: "advance", deadline: { kind: "round", round: p.round } });
  }
  if (p.kind === "alibis") return run(tryRun(s, { type: "postAlibi", player: "p2", room: s.rooms[0] } as PlayerCommand), { type: "advance", deadline: { kind: "alibis", round: p.round } });
  if (p.kind === "result") return run(s, { type: "advance", deadline: { kind: "result", round: p.round } });
  if (p.kind === "awaitingMeeting") {
    if (!s.scheduledMeeting) s = run(s, { type: "scheduleMeeting", meetingId: p.meetingId, slot: `s-${p.meetingId}` } as SystemCommand);
    return run(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: p.meetingId } });
  }
  if (p.kind === "meeting") {
    if (p.meetingId === "meeting-2") for (const x of ids(s).filter((x) => x !== "p2")) s = tryRun(s, shake(x, "p2"));
    return run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: p.meetingId } });
  }
  if (p.kind === "shakedownPending") return run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: p.meetingId } });
  throw new Error(`unexpected phase ${p.kind}`);
}
function playAll(cfg: GameConfig): GameState[] {
  let s = createGame(cfg);
  const states = [s];
  for (let guard = 0; guard < 400 && s.phase.kind !== "ended"; guard++) states.push((s = step(s)));
  return states;
}
/** Your own deliberate actions (away.ts): not news. */
const OWN = new Set(["moveSubmitted", "voteSealed", "voteCast", "coinsGrabbed"]);
const ctxOf = (view: ReturnType<typeof viewFor>, me: PlayerId) => ({ me, name: namesOf(view) });

describe("QA: recaps at 3 and 12 seats only ever hold the viewer's own view (design §13, §17.2)", () => {
  for (const n of [3, 12]) {
    it(`${n} seats, every (last seen, came back) pair: at most ${RECAP_MAX_LINES} lines, sources all in the viewer's view`, () => {
      const states = playAll(config(n));
      const end = states.at(-1)!;
      expect(end.phase.kind).toBe("ended");
      let lines = 0;
      for (const id of ids(end)) {
        for (let i = 0; i < states.length; i += 2) {
          for (const j of [i + 1, i + 3, states.length - 1]) {
            if (j >= states.length || j <= i) continue;
            const view = viewFor(states[j]!, id);
            const own = new Map([...view.ledger, ...view.caseFile].map((e) => [e.seq, e.event]));
            const items = recapItems(eventsSince(view, topSeq(viewFor(states[i]!, id))), view, ctxOf(view, id));
            expect(items.length).toBeLessThanOrEqual(RECAP_MAX_LINES);
            // Lines are unique: a recap never says the same thing twice.
            expect(new Set(items.map((x) => x.text)).size).toBe(items.length);
            for (const item of items) {
              lines++;
              for (const seq of item.from) {
                const e = own.get(seq);
                expect(e, `seq ${seq} in ${id}'s view`).toBeDefined();
                if (e!.visibility.kind !== "public") expect(e!.visibility).toMatchObject({ player: id });
              }
            }
          }
        }
      }
      expect(lines).toBeGreaterThan(0);
    });
  }

  it("the same seed and commands give the same recaps (determinism)", () => {
    const a = playAll(config(6));
    const b = playAll(config(6));
    for (const id of ids(a.at(-1)!)) {
      for (let i = 0; i < a.length; i += 5) {
        const va = viewFor(a.at(-1)!, id);
        const vb = viewFor(b.at(-1)!, id);
        const since = topSeq(viewFor(a[i]!, id));
        expect(recap(eventsSince(va, since), va, ctxOf(va, id))).toEqual(recap(eventsSince(vb, since), vb, ctxOf(vb, id)));
      }
    }
  });

  it("the recap never names another player's private entry, even when that player was in the same room", () => {
    // Everyone in Security watching the vault: each gets their own camera result and sightings.
    const s = createGame(config(12));
    const after = run(
      s,
      ...ids(s).map((p) => ({ type: "submitMove", player: p, move: { room: "security", duffel: 0, pocket: 0, watch: "vault" } }) as PlayerCommand),
      { type: "advance", deadline: { kind: "round", round: 1 } },
    );
    for (const id of ids(s)) {
      const view = viewFor(after, id);
      const mine = new Set(view.caseFile.map((e) => JSON.stringify(e.event)));
      const others = after.log.filter((e) => e.visibility.kind === "private" && e.visibility.player !== id && !mine.has(JSON.stringify(e)));
      const lines = recap(eventsSince(view, topSeq(viewFor(s, id))), view, ctxOf(view, id)).join("\n");
      expect(lines).toMatch(/Only you:|new entries in your case file/);
      // The count is of this seat's entries only.
      const count = /^(\d+) new entries/m.exec(lines);
      if (count) expect(Number(count[1])).toBe(eventsSince(view, topSeq(viewFor(s, id))).filter((e) => e.event.visibility.kind !== "public" && !OWN.has(e.event.type)).length);
      expect(others.length).toBeGreaterThan(0);
    }
  });
});

describe("QA: recap after a meeting, a shakedown, the end and a reconnect (design §13)", () => {
  const states = playAll(config(5));
  const end = states.at(-1)!;
  const at = (pred: (s: GameState) => boolean) => states.findIndex(pred);

  it("a meeting just closed: says how it went and what's next, within 2–4 lines", () => {
    const i = at((s) => s.phase.kind === "meeting");
    const j = at((s) => s.phase.kind === "planning" && s.round > states[i]!.round);
    const view = viewFor(states[j]!, "p1");
    const lines = recap(eventsSince(view, topSeq(viewFor(states[i]!, "p1"))), view, ctxOf(view, "p1"));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(RECAP_MAX_LINES);
    expect(lines.join("\n")).toMatch(/votes?|shaken|skip/i);
    expect(lines.at(-1)).toMatch(/^Now: round \d+/);
  });

  it("a shakedown: the target and the others each get its result, not the vote", () => {
    const i = at((s) => s.phase.kind === "meeting" && s.phase.meetingId === "meeting-2");
    expect(i).toBeGreaterThan(0);
    const j = at((s) => s.log.some((e) => e.type === "shakedownResolved"));
    expect(j).toBeGreaterThan(i);
    for (const id of ids(end)) {
      const view = viewFor(states[j]!, id);
      const lines = recap(eventsSince(view, topSeq(viewFor(states[i]!, id))), view, ctxOf(view, id));
      expect(lines.some((l) => /shaken down/.test(l)), `${id}: ${lines.join(" | ")}`).toBe(true);
      expect(lines.some((l) => /voted to shake down/.test(l))).toBe(false);
    }
  });

  it("the end: away since round 1 or since the very last step, the end is always said", () => {
    for (const i of [1, states.length - 2]) {
      for (const id of ids(end)) {
        const view = viewFor(end, id);
        const lines = recap(eventsSince(view, topSeq(viewFor(states[i]!, id))), view, ctxOf(view, id));
        expect(lines.length).toBeGreaterThanOrEqual(1);
        expect(lines.length).toBeLessThanOrEqual(RECAP_MAX_LINES);
        expect(lines.some((l) => /^(Job done|Busted|The heist was sunk by theft)/.test(l)), lines.join(" | ")).toBe(true);
        expect(lines.some((l) => l.startsWith("Now:"))).toBe(false);
        // The reveal opens others' case files, but the recap stays on the seat's own ledger and case file.
        expect(view.reveal).not.toBeNull();
      }
    }
  });

  it("a reconnect that catches up in one view equals catching up step by step: same recap from the same mark", () => {
    // The client recaps eventsSince(view, mark) for whatever view it holds; a burst after a reconnect is one view.
    const i = 3;
    for (const id of ids(end)) {
      const mark = topSeq(viewFor(states[i]!, id));
      const j = Math.min(i + 6, states.length - 1);
      const burst = viewFor(states[j]!, id);
      const lines = recap(eventsSince(burst, mark), burst, ctxOf(burst, id));
      // Recapping again from the same mark after a reload gives the same lines (nothing depends on time or order of arrival).
      const again = viewFor(states[j]!, id);
      expect(recap(eventsSince(again, mark), again, ctxOf(again, id))).toEqual(lines);
      // Caught up: from the top, nothing.
      expect(recap(eventsSince(burst, topSeq(burst)), burst, ctxOf(burst, id))).toEqual([]);
    }
  });
});
