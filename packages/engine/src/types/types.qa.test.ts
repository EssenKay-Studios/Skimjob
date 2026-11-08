// QA tests for the core types (STATUS.md task 1).
// Compile-time assertions (expectTypeOf, expect-error directives) are enforced by
// `pnpm typecheck`; vitest only runs the runtime parts.
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  Command,
  EventOfType,
  GameEvent,
  GameEventType,
  OtherPlayerView,
  PlayerCommand,
  PlayerView,
  SystemCommand,
  Visibility,
} from "./index";
import { PUBLIC, REVEAL, canSee, privateTo, secretTo } from "./index";
import { sampleCommands, sampleEvents } from "./samples";
import { fullGrab } from "../grab.testkit";

type VisKind<T extends GameEventType> = EventOfType<T>["visibility"]["kind"];

// design §13 table + §17.2: ledger items public, case-file items private, seed reveal-only.
// Pins every event type so a secret can't silently become public.
type ExpectedVisibility = {
  gameCreated: "public";
  rngSeeded: "reveal";
  roomsSet: "public";
  bankFilled: "public"; // design §6.1, §18: the bank count is public
  roleDealt: "private";
  roleListShown: "public"; // extension.md "Host settings": the Exact / Possible list
  shopDealt: "public"; // design §12: the three perks on the black market
  rngAdvanced: "reveal";
  roundStarted: "public";
  moveLocked: "public";
  moveSubmitted: "private";
  defaultMoveAssigned: "private";
  coinsGrabbed: "private";
  abilityAlreadyDone: "private"; // design §11.4: "already done this round", to the holder only
  sinsAbsolved: "private"; // design §11.1: told to the absolved player only
  powerCut: "public"; // design §11.1: announced with no source
  abilityResolved: "private";
  roomSighting: "private";
  roomWatched: "private";
  roundResolved: "public";
  duffelSplit: "public"; // design §7.3: the split and the share are public
  bellsRung: "public"; // design §5.1: every bell is public
  roomRaided: "public"; // design §5.3, §5.4: raids and Wanted are public, never who was inside
  bellsCooled: "public"; // design §5.6
  roomReopened: "public"; // design §11.1: "a taped-off room is suddenly open again", no name
  eventFlipped: "public"; // design §13: the card is shown to everyone
  insideTip: "private"; // design §13: private to the recipient
  auditReport: "public"; // design §13: per-room coins that reached the duffel, on the ledger
  alibiPosted: "public";
  alibisClosed: "public";
  roleClaimed: "public"; // design §8, §12.1: a role claim is public talk
  meetingProposed: "public";
  meetingProposalAccepted: "public";
  meetingScheduled: "public";
  emergencyMeetingCalled: "public";
  meetingOpened: "public";
  voteSealed: "private" | "secret"; // secret in "secret" vote mode, design §9.5
  voteCast: "public" | "private" | "secret";
  meetingClosed: "public";
  shakedownPending: "public";
  shakedownCancelled: "public"; // design §9.6: only "a shakedown fell through"
  shakedownResolved: "public";
  perkSold: "public"; // design §12: every purchase is logged at once, without a name
  perkBought: "private"; // design §12: who bought it opens at the reveal
  bailChosen: "private"; // design §9.6: the Bail choice is private until the reveal
  alibiVerified: "public"; // design §12: the "verified" stamp is in the ledger
  gameEnded: "public";
};

describe("event visibility per type — design §13, §17.2", () => {
  it("every event type has exactly the expected visibility kind(s)", () => {
    expectTypeOf<{ [T in GameEventType]: VisKind<T> }>().toEqualTypeOf<ExpectedVisibility>();
  });

  it("secret events cannot be constructed with a looser tag", () => {
    // @ts-expect-error the seed must never be public
    const seed: GameEvent = { type: "rngSeeded", visibility: PUBLIC, seed: "s" };
    // @ts-expect-error a real grab is private, not reveal-only
    const split: GameEvent = {
      type: "coinsGrabbed",
      visibility: REVEAL,
      player: "ana",
      round: 1,
      room: "vault",
      duffel: 3,
      pocket: 0,
    };
    // @ts-expect-error a sealed vote is private to the voter
    const sealed: GameEvent = { type: "voteSealed", visibility: PUBLIC, player: "ana", vote: { kind: "skip" } };
    expect([seed, split, sealed]).toHaveLength(3);
  });

  it("private samples are owned by the player they are about, and that player is seated", () => {
    const seated = new Set(sampleEvents.gameCreated.players.map((p) => p.id));
    const owners = new Set<string>();
    for (const event of Object.values(sampleEvents) as GameEvent[]) {
      if (event.visibility.kind !== "private") continue;
      expect("player" in event && event.player).toBe(event.visibility.player);
      expect(seated.has(event.visibility.player)).toBe(true);
      owners.add(event.visibility.player);
    }
    // Both seats own at least one private sample, so leak tests exercise owner and non-owner.
    expect(owners).toEqual(seated);
  });
});

describe("commands — design §17.2", () => {
  it("advance must name its deadline; a bare advance does not compile — design §4.1, §9.4", () => {
    // @ts-expect-error a bare advance is ambiguous when several deadlines are pending
    const bare: Command = { type: "advance" };
    // @ts-expect-error meeting deadlines must say which meeting
    const noId: Command = { type: "advance", deadline: { kind: "openMeeting" } };
    // @ts-expect-error the round deadline carries no meeting id
    const roundWithId: Command = { type: "advance", deadline: { kind: "round", round: 1, meetingId: "m1" } };
    // @ts-expect-error the round deadline must name its round
    const noRound: Command = { type: "advance", deadline: { kind: "round" } };
    expect([bare, noId, roundWithId, noRound]).toHaveLength(4);
  });

  it("system commands are not player commands and carry no player", () => {
    expectTypeOf<Extract<PlayerCommand, { type: SystemCommand["type"] }>>().toBeNever();
    expectTypeOf<Extract<SystemCommand, { player: unknown }>>().toBeNever();

    // @ts-expect-error a client can't send advance as a player command
    const asPlayer: PlayerCommand = { type: "advance", deadline: { kind: "round", round: 1 } };
    // @ts-expect-error advance can't be attributed to a player
    const attributed: Command = { type: "advance", player: "ana", deadline: { kind: "round", round: 1 } };
    // @ts-expect-error a player can't pick the server's meeting slot
    const pick: PlayerCommand = { type: "scheduleMeeting", player: "ana", meetingId: "meeting-1", slot: "x" };
    expect([asPlayer, attributed, pick]).toHaveLength(3);
  });

  it("every player command names its player", () => {
    expectTypeOf<PlayerCommand["player"]>().toEqualTypeOf<string>();
    // @ts-expect-error submitMove without a player
    const anon: Command = { type: "submitMove", move: fullGrab("vault") };
    expect(anon).toBeDefined();
  });

  it("samples cover every command type with matching keys", () => {
    expectTypeOf<keyof typeof sampleCommands>().toEqualTypeOf<Command["type"]>();
    expectTypeOf<keyof typeof sampleEvents>().toEqualTypeOf<GameEventType>();
    for (const [key, command] of Object.entries(sampleCommands)) expect(command.type).toBe(key);
  });
});

describe("PlayerView shape does not expose hidden fields — design §13, §17.2", () => {
  it("other players show only seat info (id, name, isBot)", () => {
    expectTypeOf<keyof OtherPlayerView>().toEqualTypeOf<"id" | "name" | "isBot">();
  });

  it("the view has no seed, rng, config, raw moves or raw log", () => {
    type Forbidden = "config" | "rng" | "seed" | "moves" | "log" | "meeting";
    expectTypeOf<Extract<keyof PlayerView, Forbidden>>().toBeNever();
  });
});

describe("canSee — design §17.2, §13", () => {
  it("after the game, own private and public events stay visible", () => {
    expect(canSee(privateTo("ana"), "ana", true)).toBe(true);
    expect(canSee(PUBLIC, "ana", true)).toBe(true);
  });

  it("private ownership is an exact id match", () => {
    expect(canSee(privateTo("ana"), "Ana", false)).toBe(false);
    expect(canSee(privateTo("ana"), "an", false)).toBe(false);
    expect(canSee(privateTo("ana"), "", false)).toBe(false);
    expect(canSee(privateTo(""), "ana", false)).toBe(false);
  });

  it("fails closed on an unknown visibility kind during the game", () => {
    const bogus = { kind: "everyone" } as unknown as Visibility;
    expect(canSee(bogus, "ana", false)).toBeFalsy();
  });

  it("over every sample: during the game only public + own private; after, everything but others' secrets", () => {
    const viewers = ["ana", "ben", "carl"]; // carl: a third seat that owns nothing
    for (const event of Object.values(sampleEvents) as GameEvent[]) {
      const v = event.visibility;
      for (const viewer of viewers) {
        const owns = (v.kind === "private" || v.kind === "secret") && v.player === viewer;
        const expected = v.kind === "public" || owns;
        expect(canSee(v, viewer, false), `${event.type} for ${viewer}`).toBe(expected);
        const expectedAfter = v.kind !== "secret" || owns;
        expect(canSee(v, viewer, true), `${event.type} for ${viewer} after end`).toBe(expectedAfter);
      }
    }
  });

  // design §9.5: in Secret mode only the tally is ever shown, even at the reveal (QA bug 1, PR #1).
  it("secret-mode ballots stay hidden from everyone but the voter, during and after the game", () => {
    const cast: GameEvent = {
      type: "voteCast",
      visibility: secretTo("ben"),
      meetingId: "m1",
      player: "ben",
      vote: { kind: "shakedown", target: "ana" },
      sealed: false,
    };
    const sealed: GameEvent = { type: "voteSealed", visibility: secretTo("ben"), player: "ben", vote: { kind: "skip" } };
    for (const event of [cast, sealed]) {
      for (const gameOver of [false, true]) {
        expect(canSee(event.visibility, "ben", gameOver), `${event.type} owner, gameOver=${gameOver}`).toBe(true);
        for (const other of ["ana", "carl", "Ben", ""]) {
          expect(canSee(event.visibility, other, gameOver), `${event.type} for ${other}, gameOver=${gameOver}`).toBe(false);
        }
      }
    }
  });

  it("fails closed on an unknown visibility kind after the game too", () => {
    const bogus = { kind: "everyone" } as unknown as Visibility;
    expect(canSee(bogus, "ana", true)).toBe(false);
  });

  it("only ballots can be secret — design §9.5", () => {
    // @ts-expect-error a dealt role is revealed at the end, it can't be secret
    const role: GameEvent = { type: "roleDealt", visibility: secretTo("ana"), player: "ana", role: "hacker" };
    expect(role).toBeDefined();
  });
});
