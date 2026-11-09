// The bank board on the game screen, from real engine views. M2-9 acceptance:
// the figures come only from the player's case file and the public alibis.
// design §5, §5.4, §6, §18
import { handleCommand, viewFor, type GameConfig, type GameState, type PlayerCommand, type PlayerView, type SystemCommand } from "@skimjob/engine";
import { createGame } from "./deal.testkit";
import { describe, expect, it } from "vitest";
import { boardScene, seatLooks, timeOfRound } from "./board";
import { BANK_JOB } from "@skimjob/content";

const config = (n = 4): GameConfig => ({
  seed: "board-test",
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: i === 0 ? "Ana" : `Bot · B${i}`, isBot: i > 0 })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
});

function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
const move = (player: string, room: string, watch?: string): PlayerCommand =>
  ({ type: "submitMove", player, move: { room, duffel: BANK_JOB.rooms[room]?.coins ?? 0, pocket: 0, ...(watch ? { watch } : {}) } }) as PlayerCommand;
const alibi = (player: string, room: string): PlayerCommand => ({ type: "postAlibi", player, round: 1, room }) as PlayerCommand;
const round = (r: number): SystemCommand => ({ type: "advance", deadline: { kind: "round", round: r } });

/** p1 + p2 in the vault, p3 in the lobby, p4 in the office; round 1 resolved. */
function afterRound1(): GameState {
  return run(createGame(config()), move("p1", "vault"), move("p2", "vault"), move("p3", "lobby"), move("p4", "office"), round(1));
}

const figures = (scene: ReturnType<typeof boardScene>) =>
  Object.entries(scene.occupants)
    .flatMap(([room, list]) => list.map((o) => `${o.id}@${room}${o.ghost ? "?" : o.camera ? "~cam" : ""}`))
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

  it("draws alibi claims as ghosts, true or not, but not a claim you already see (design §11.3)", () => {
    // p3 lies (says vault), p4 tells the truth (office) but p1 didn't see it; p2's claim matches what p1 saw.
    const s = run(afterRound1(), alibi("p3", "vault"), alibi("p4", "office"), alibi("p2", "vault"));
    const v = viewFor(s, "p1");
    expect(figures(boardScene(v))).toEqual(["p1@vault", "p2@vault", "p3@vault?", "p4@office?"]);
  });

  it("draws the room you watched as seen on camera, never twice (design §6.1 Security)", () => {
    // p1 is Security watching the lobby; p2 stands with p1; p3 is in the lobby; p4 in the office.
    const s = run(createGame(config()), move("p1", "security", "lobby"), move("p2", "security", "office"), move("p3", "lobby"), move("p4", "office"), round(1));
    const v = viewFor(s, "p1");
    expect(v.caseFile.some((x) => x.event.type === "roomWatched")).toBe(true);
    expect(figures(boardScene(v))).toEqual(["p1@security", "p2@security", "p3@lobby~cam"]);
    // A claim that matches the camera adds nothing; a lie about the camera's room shows up as a ghost elsewhere.
    const claims = run(s, alibi("p3", "lobby"), alibi("p4", "lobby"));
    expect(figures(boardScene(viewFor(claims, "p1")))).toEqual(["p1@security", "p2@security", "p3@lobby~cam", "p4@lobby?"]);
    // p3 watched nobody: no camera figures in their view.
    expect(figures(boardScene(viewFor(s, "p3")))).toEqual(["p3@lobby"]);
  });

  it("figures come only from the case file and the alibis: strip them and only you are left (M2-9 acceptance)", () => {
    const s = run(
      createGame(config()),
      move("p1", "vault"),
      move("p2", "vault"),
      move("p3", "lobby"),
      move("p4", "security", "vault"),
      round(1),
      alibi("p3", "vault"),
      alibi("p1", "office"),
    );
    for (const viewer of ["p1", "p4"]) {
      const v = viewFor(s, viewer);
      const stripped: PlayerView = {
        ...v,
        caseFile: v.caseFile.filter((x) => x.event.type !== "roomSighting" && x.event.type !== "roomWatched"),
        ledger: v.ledger.filter((x) => x.event.type !== "said"),
      };
      expect(figures(boardScene(stripped)), viewer).toEqual([viewer === "p1" ? "p1@vault" : "p4@security"]);
      // Every non-ghost figure other than you is backed by a roomSighting or roomWatched in your case file.
      const seenIds = new Set(
        v.caseFile.flatMap((x) => (x.event.type === "roomSighting" ? x.event.others : x.event.type === "roomWatched" ? x.event.seen : [])),
      );
      for (const list of Object.values(boardScene(v).occupants))
        for (const o of list ?? []) if (!o.ghost && o.id !== viewer) expect(seenIds.has(o.id), `${viewer} sees ${o.id}`).toBe(true);
      expect(boardScene(JSON.parse(JSON.stringify(v)) as PlayerView)).toEqual(boardScene(v));
    }
    expect(figures(boardScene(viewFor(s, "p4")))).toEqual(["p1@office?", "p1@vault~cam", "p2@vault~cam", "p3@vault?", "p4@security"]);
  });

  it("acceptance, single viewer with sightings only (M2-9)", () => {
    const s = run(afterRound1(), alibi("p3", "vault"), alibi("p4", "office"));
    const v = viewFor(s, "p1");
    const stripped: PlayerView = {
      ...v,
      caseFile: v.caseFile.filter((x) => x.event.type !== "roomSighting"),
      ledger: v.ledger.filter((x) => x.event.type !== "said"),
    };
    expect(figures(boardScene(stripped))).toEqual(["p1@vault"]);
    const seenIds = new Set(v.caseFile.flatMap((x) => (x.event.type === "roomSighting" ? x.event.others : [])));
    for (const list of Object.values(boardScene(v).occupants))
      for (const o of list ?? []) if (!o.ghost && o.id !== "p1") expect(seenIds.has(o.id), o.id).toBe(true);
    // The scene is a function of the view alone: a JSON round trip (what the socket sends) gives the same board.
    expect(boardScene(JSON.parse(JSON.stringify(v)) as PlayerView)).toEqual(boardScene(v));
  });

  it("tapes off the room Lockdown shut for that round (design §13)", () => {
    const v = viewFor(createGame(config()), "p1");
    const locked: PlayerView = { ...v, card: { round: 1, id: "lockdown", room: "office" } };
    expect(boardScene(locked).closed).toEqual(["office"]);
    expect(boardScene({ ...v, card: { round: 1, id: "lockdown", room: null } }).closed).toEqual([]);
    expect(boardScene({ ...locked, card: { round: 0, id: "lockdown", room: "office" } }).closed).toEqual([]);
  });

  describe("bells (design §5.1, §5.2, §5.3, §11.1)", () => {
    const bulbs = BANK_JOB.alarm.bulbs;
    const planning = () => viewFor(createGame(config(6)), "p1");

    it("shows every open room's lit bulbs, no preview before you pick", () => {
      const v: PlayerView = { ...planning(), bells: { vault: 2, office: 0 } };
      const { bells } = boardScene(v);
      expect(bells.vault).toEqual({ lit: 2 });
      expect(bells.office).toEqual({ lit: 0 });
    });

    it("previews the rings of the room you picked: the coins past the quiet ones (Office: 2 coins, 1 quiet)", () => {
      const v = planning();
      const office = BANK_JOB.rooms.office!;
      expect(boardScene(v, "office").bells.office).toEqual({ lit: v.bells.office ?? 0, preview: office.coins - office.quietCoins });
      expect(boardScene(v, "vault").bells.vault?.preview).toBe(BANK_JOB.rooms.vault!.coins - BANK_JOB.rooms.vault!.quietCoins);
      // A room with no noisy coin (the Lobby: 1 quiet coin) previews nothing, and so does the room you didn't pick.
      expect(boardScene(v, "lobby").bells.lobby).not.toHaveProperty("preview");
      expect(boardScene(v, "vault").bells.office).not.toHaveProperty("preview");
    });

    it("a Locksmith's Office or Vault grab is silent: nothing to preview (design §5.2)", () => {
      const v = planning();
      const locksmith: PlayerView = { ...v, me: { ...v.me, role: "locksmith" } };
      for (const room of ["office", "vault"]) expect(boardScene(locksmith, room).bells[room]).not.toHaveProperty("preview");
    });

    it("a Locksmith's muffle follows this game's content overrides: fewerRings 0 rings like anyone's (design §5.2, §11.1)", () => {
      const v = viewFor(createGame({ ...config(6), contentOverrides: { roles: { locksmith: { fewerRings: 0 } } } }), "p1");
      const locksmith: PlayerView = { ...v, me: { ...v.me, role: "locksmith" } };
      expect(boardScene(locksmith, "vault").bells.vault?.preview).toBe(BANK_JOB.rooms.vault!.coins - BANK_JOB.rooms.vault!.quietCoins);
    });

    it("after Soft shoes your coins ring nothing, so nothing is previewed that round (design §5.2, §12)", () => {
      const v = planning();
      const bought = (round: number, perk: object = { kind: "softShoes" }) =>
        ({ seq: 99, event: { type: "perkBought", visibility: { kind: "private", to: v.me.id }, player: v.me.id, round, perk, cost: 2 } }) as unknown as PlayerView["caseFile"][number];
      expect(boardScene(v, "vault").bells.vault?.preview).toBeGreaterThan(0);
      // Bought the round before this one: silent.
      const shod: PlayerView = { ...v, round: 2, caseFile: [...v.caseFile, bought(1)] };
      expect(boardScene(shod, "vault").bells.vault).not.toHaveProperty("preview");
      // Bought this round for the next one, or another perk, or someone else's: no effect yet.
      const other = (e: PlayerView["caseFile"][number]) => ({ ...v, round: 2, caseFile: [...v.caseFile, e] });
      expect(boardScene(other(bought(2)), "vault").bells.vault?.preview).toBeGreaterThan(0);
      expect(boardScene(other(bought(1, { kind: "tail", target: "p2" })), "vault").bells.vault?.preview).toBeGreaterThan(0);
    });

    it("a hidden bell shows '?' unless the view carries the real count (the Hacker who hid it)", () => {
      const v = planning();
      const rest = Object.fromEntries(Object.entries(v.bells).filter(([room]) => room !== "office"));
      const seen = boardScene({ ...v, bells: rest, hiddenBells: ["office"] });
      expect(seen.bells.office).toEqual({ lit: 0, hidden: true });
      expect(seen.bells.vault).toEqual({ lit: 0 });
      expect(boardScene({ ...v, bells: { ...rest, office: 2 }, hiddenBells: ["office"] }).bells.office).toEqual({ lit: 2 });
    });

    it("a taped-off room has no bell and counts its rounds down: CLOSED 2, then CLOSED 1", () => {
      // Raided in round 1: closed through round 1 + tapedRounds.
      const raided = (phase: PlayerView["phase"], round: number): PlayerView => ({ ...planning(), round, phase, taped: { vault: 1 + BANK_JOB.alarm.tapedRounds } });
      const result = boardScene(raided({ kind: "result", round: 1 } as PlayerView["phase"], 1));
      expect(result.bells).not.toHaveProperty("vault");
      expect(result.closed).toContain("vault");
      expect(result.taped).toEqual({ vault: BANK_JOB.alarm.tapedRounds });
      expect(boardScene(raided({ kind: "planning", round: 2 } as PlayerView["phase"], 2)).taped).toEqual({ vault: BANK_JOB.alarm.tapedRounds });
      expect(boardScene(raided({ kind: "planning", round: 3 } as PlayerView["phase"], 3)).taped).toEqual({ vault: 1 });
    });
  });

  it("lights the bank by thirds of the round cap: day, dusk, night (ui-style, design §6.2)", () => {
    expect([1, 4, 5, 8, 9, 12].map(timeOfRound)).toEqual(["day", "day", "dusk", "dusk", "night", "night"]);
  });

  it("gives each seat its index as the look and a crew-unique tag, bot prefix dropped", () => {
    const looks = seatLooks(viewFor(createGame(config()), "p2"));
    expect([...looks.values()].map((l) => l.look)).toEqual([0, 1, 2, 3]);
    expect(looks.get("p2")).toMatchObject({ name: "B1", bot: true });
    expect(new Set([...looks.values()].map((l) => l.tag)).size).toBe(4);
  });
});
