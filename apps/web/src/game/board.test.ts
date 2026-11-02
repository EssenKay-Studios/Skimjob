// The bank board on the game screen, from real engine views. M2-9 acceptance:
// the figures come only from the player's case file and the public alibis.
// design §5, §5.4, §6, §18
import { createGame, handleCommand, viewFor, type GameConfig, type GameState, type PlayerCommand, type PlayerView, type SystemCommand } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { boardScene, seatLooks, timeOfRound } from "./board";

const config = (n = 4): GameConfig => ({
  seed: "board-test",
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: i === 0 ? "Ana" : `Bot · B${i}`, isBot: i > 0 })),
  job: "bank",
  rolePool: ["rookie"],
  mole: "off",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  starterMode: true,
  uniqueRoles: false,
});

function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
const move = (player: string, room: string): PlayerCommand => ({ type: "submitMove", player, move: { room, pocket: 0 } }) as PlayerCommand;
const alibi = (player: string, room: string): PlayerCommand => ({ type: "postAlibi", player, room }) as PlayerCommand;
const round = (r: number): SystemCommand => ({ type: "advance", deadline: { kind: "round", round: r } });

/** p1 + p2 in the vault, p3 in the lobby, p4 in the office; round 1 resolved. */
function afterRound1(): GameState {
  return run(createGame(config()), move("p1", "vault"), move("p2", "vault"), move("p3", "lobby"), move("p4", "office"), round(1));
}

const figures = (scene: ReturnType<typeof boardScene>) =>
  Object.entries(scene.occupants)
    .flatMap(([room, list]) => list.map((o) => `${o.id}@${room}${o.ghost ? "?" : ""}`))
    .sort();

describe("board scene (M2-9 wiring)", () => {
  it("while planning shows only you, in the room you picked (design §5)", () => {
    const s = createGame(config());
    const v = viewFor(s, "p1");
    expect(figures(boardScene(v))).toEqual([]);
    const picked = boardScene(v, "vault");
    expect(picked).toMatchObject({ round: 1, mode: "pick", selected: "vault", time: "day" });
    expect(figures(picked)).toEqual(["p1@vault"]);
    // A locked move is the default pick; other players' locked moves never show.
    const locked = viewFor(run(s, move("p1", "office"), move("p2", "vault")), "p1");
    expect(figures(boardScene(locked))).toEqual(["p1@office"]);
  });

  it("after a round shows you and who your case file says was in your room (design §6)", () => {
    const v = viewFor(afterRound1(), "p1");
    const scene = boardScene(v);
    expect(scene).toMatchObject({ round: 1, mode: "seen", selected: "vault" });
    expect(figures(scene)).toEqual(["p1@vault", "p2@vault"]);
    // p3's view: alone in the lobby.
    expect(figures(boardScene(viewFor(afterRound1(), "p3")))).toEqual(["p3@lobby"]);
  });

  it("draws alibi claims as ghosts, true or not, but not a claim you already see (design §5.4)", () => {
    // p3 lies (says vault), p4 tells the truth (office) but p1 didn't see it; p2's claim matches what p1 saw.
    const s = run(afterRound1(), alibi("p3", "vault"), alibi("p4", "office"), alibi("p2", "vault"));
    const v = viewFor(s, "p1");
    expect(figures(boardScene(v))).toEqual(["p1@vault", "p2@vault", "p3@vault?", "p4@office?"]);
  });

  it("figures come only from the case file and the alibis: strip them and only you are left (M2-9 acceptance)", () => {
    const s = run(afterRound1(), alibi("p3", "vault"), alibi("p4", "office"));
    const v = viewFor(s, "p1");
    const stripped: PlayerView = {
      ...v,
      caseFile: v.caseFile.filter((x) => x.event.type !== "roomSighting"),
      ledger: v.ledger.filter((x) => x.event.type !== "alibiPosted"),
    };
    expect(figures(boardScene(stripped))).toEqual(["p1@vault"]);
    // Every non-ghost figure other than you is backed by a roomSighting in your case file.
    const seenIds = new Set(v.caseFile.flatMap((x) => (x.event.type === "roomSighting" ? x.event.others : [])));
    for (const list of Object.values(boardScene(v).occupants))
      for (const o of list ?? []) if (!o.ghost && o.id !== "p1") expect(seenIds.has(o.id), o.id).toBe(true);
    // The scene is a function of the view alone: a JSON round trip (what the socket sends) gives the same board.
    expect(boardScene(JSON.parse(JSON.stringify(v)) as PlayerView)).toEqual(boardScene(v));
  });

  it("tapes off the room Lockdown shut for that round (design §10)", () => {
    const v = viewFor(createGame(config()), "p1");
    const locked: PlayerView = { ...v, card: { round: 1, id: "lockdown", room: "office" } };
    expect(boardScene(locked).closed).toEqual(["office"]);
    expect(boardScene({ ...v, card: { round: 1, id: "lockdown", room: null } }).closed).toEqual([]);
    expect(boardScene({ ...locked, card: { round: 0, id: "lockdown", room: "office" } }).closed).toEqual([]);
  });

  it("lights the bank by act: day, dusk, night (ui-style, design §4)", () => {
    expect([1, 3, 4, 6, 7, 9].map(timeOfRound)).toEqual(["day", "day", "dusk", "dusk", "night", "night"]);
  });

  it("gives each seat its index as the look and a crew-unique tag, bot prefix dropped", () => {
    const looks = seatLooks(viewFor(createGame(config()), "p2"));
    expect([...looks.values()].map((l) => l.look)).toEqual([0, 1, 2, 3]);
    expect(looks.get("p2")).toMatchObject({ name: "B1", bot: true });
    expect(new Set([...looks.values()].map((l) => l.tag)).size).toBe(4);
  });
});
