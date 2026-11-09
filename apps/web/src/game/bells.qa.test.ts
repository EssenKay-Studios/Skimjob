// QA (PR #199, S4.1): adversarial checks on the board's bells, tape and bank count —
// content overrides from a real engine game, hidden bells through the rendered markup,
// the preview only on your own pick, and long names in a full crew. design §5.1–§5.4, §6.1
import {
  handleCommand,
  viewFor,
  type GameConfig,
  type GameState,
  type PlayerCommand,
  type PlayerView,
  type SystemCommand,
} from "@skimjob/engine";
import { BANK_JOB } from "@skimjob/content";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BankCutaway } from "../art/BankCutaway";
import { createGame } from "./deal.testkit";
import { boardScene } from "./board";
import { bankTotal, jobOf } from "./hud";

const config = (n: number, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "bells-qa",
  players: Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `${"Q".repeat(22)}${String(i + 1).padStart(2, "0")}`,
    isBot: i > 0,
  })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  ...extra,
});

function run(
  state: GameState,
  ...commands: (PlayerCommand | SystemCommand)[]
): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
const move = (player: string, room: string): PlayerCommand =>
  ({
    type: "submitMove",
    player,
    move: { room, duffel: BANK_JOB.rooms[room]?.coins ?? 0, pocket: 0 },
  }) as PlayerCommand;
const round = (r: number): SystemCommand => ({
  type: "advance",
  deadline: { kind: "round", round: r },
});

/** Steps the phases (result, meetings) until round `r` is being planned. */
function toPlanning(s: GameState, r: number): GameState {
  for (let guard = 0; guard < 20; guard++) {
    const p = s.phase;
    if (p.kind === "planning" && p.round === r) return s;
    const deadline =
      p.kind === "result"
        ? { kind: "result", round: p.round }
        : p.kind === "awaitingMeeting"
          ? { kind: "openMeeting", meetingId: p.meetingId }
          : p.kind === "meeting"
            ? { kind: "closeMeeting", meetingId: p.meetingId }
            : p.kind === "shakedownPending"
              ? { kind: "resolveShakedown", meetingId: p.meetingId }
              : null;
    if (!deadline) throw new Error(`unexpected phase ${p.kind}`);
    if (p.kind === "awaitingMeeting" && !s.scheduledMeeting)
      s = run(s, {
        type: "scheduleMeeting",
        meetingId: p.meetingId,
        slot: `s-${p.meetingId}`,
      } as SystemCommand);
    s = run(s, { type: "advance", deadline } as SystemCommand);
  }
  throw new Error("no planning");
}

/** The board as the game screen draws it (Game.tsx BankBoard). */
const render = (view: PlayerView, pick: string | null = null) => {
  const scene = boardScene(view, pick);
  return renderToStaticMarkup(
    createElement(BankCutaway, {
      rooms: view.rooms,
      selected: scene.selected,
      closed: scene.closed,
      taped: scene.taped,
      bells: scene.bells,
      bulbs: jobOf(view).alarm.bulbs,
      pile: view.bank / bankTotal(view),
      occupants: scene.occupants,
    }),
  );
};
/** One room's bell markup. */
const bellOf = (html: string, room: string) =>
  html.match(new RegExp(`data-bell="${room}"[^>]*>(.*?)</span></div>`))?.[1] ??
  null;

describe("QA #199: content overrides reach the board (design §5.1, §5.3, §17.4)", () => {
  it("6 bulbs, 3 taped rounds and coinsPerPlayer 5 from a real game: bells, CLOSED 3, Bank 60/60", () => {
    const overrides = {
      alarm: { bulbs: 6, tapedRounds: 3, bustStars: 5 },
      bank: { coinsPerPlayer: 5 },
    };
    const v = viewFor(
      createGame(config(12, { contentOverrides: overrides })),
      "p1",
    );
    expect(bankTotal(v)).toBe(60);
    expect(v.bank).toBe(60);
    expect(jobOf(v).alarm.bustStars).toBe(5);
    const html = render(v, "vault");
    for (const room of v.rooms)
      expect(bellOf(html, room)?.match(/<i class="bulb/g), room).toHaveLength(
        6,
      );
    expect(html).toContain('aria-label="Bell: 0 of 6 lit, your grab adds 3"');
  });

  it("a raid with 2 bulbs and 3 taped rounds: CLOSED 3 → 3 → 2 → 1, no bell, then the bell is back at 0", () => {
    const overrides = { alarm: { bulbs: 2, tapedRounds: 3 } };
    let s = run(
      createGame(config(4, { contentOverrides: overrides })),
      move("p1", "vault"),
      move("p2", "vault"),
      move("p3", "vault"),
      move("p4", "lobby"),
      round(1),
    );
    const counts: (number | undefined)[] = [];
    const after = viewFor(s, "p1");
    expect(after.taped).toHaveProperty("vault");
    counts.push(boardScene(after).taped.vault);
    let html = render(after);
    expect(html).toContain("CLOSED 3");
    expect(bellOf(html, "vault")).toBeNull();
    for (let r = 2; r <= 4; r++) {
      s = toPlanning(s, r);
      counts.push(boardScene(viewFor(s, "p1")).taped.vault);
      s = run(
        s,
        move("p1", "lobby"),
        move("p2", "lobby"),
        move("p3", "lobby"),
        move("p4", "lobby"),
        round(r),
      );
    }
    expect(counts.slice(0, 4)).toEqual([3, 3, 2, 1]);
    html = render(viewFor(toPlanning(s, 5), "p1"));
    expect(html).not.toContain("CLOSED");
    expect(bellOf(html, "vault")).toContain("Bell: 0 of 2 lit");
  });
});

describe("QA #199: a hidden bell never leaks its count (design §5.1, §11.1)", () => {
  it("non-Hackers see '?' with no lit bulb, no count in any label, attribute or text", () => {
    const base = viewFor(createGame(config(6)), "p2");
    const { office: _real, ...rest } = base.bells;
    const v: PlayerView = {
      ...base,
      bells: { ...rest, vault: 1 },
      hiddenBells: ["office"],
    };
    for (const pick of [null, "office", "vault"]) {
      const bell = bellOf(render(v, pick), "office")!;
      expect(bell).toContain('aria-label="Bell: hidden"');
      expect(bell).not.toMatch(/bulb--(l\d|pv|off)/);
      expect(bell).not.toMatch(/\d+ of \d+|grab adds/);
    }
  });
});

describe("QA #199: the preview is only on the room you picked, only while planning (design §5.2)", () => {
  it("a locked Office move, re-picking the Vault: only the Vault previews; no preview after the round", () => {
    const s = run(createGame(config(6)), move("p1", "office"));
    const v = viewFor(s, "p1");
    const html = render(v, "vault");
    expect(html.match(/grab adds/g)).toHaveLength(1);
    expect(bellOf(html, "vault")).toContain("grab adds 3");
    expect(bellOf(html, "office")).not.toContain("grab adds");
    expect(render(v)).toMatch(/data-bell="office".*?grab adds 1/);
    const done = viewFor(
      run(
        s,
        ...["p2", "p3", "p4", "p5", "p6"].map((p) => move(p, "lobby")),
        round(1),
      ),
      "p1",
    );
    expect(render(done)).not.toContain("grab adds");
    expect(render(done)).not.toContain("bulb--pv");
  });
});

describe("QA #199: 12 seats with 24-character names (design §6)", () => {
  it("every name is on the board and every open room has one bell", () => {
    const v = viewFor(run(createGame(config(12)), move("p1", "vault")), "p1");
    const html = render(v);
    expect(html).toContain("Q".repeat(22) + "01");
    expect(html.match(/data-bell="/g)).toHaveLength(v.rooms.length);
  });
});
