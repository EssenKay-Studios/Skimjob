import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  Command,
  GameEvent,
  PrivateVisibility,
  PublicVisibility,
  RevealVisibility,
  SecretVisibility,
  Visibility,
} from "./index";
import { PUBLIC, REVEAL, canSee, privateTo, secretTo } from "./index";
import { sampleCommands, sampleEvents } from "./samples";

describe("visibility — design §17.2, §13", () => {
  const cases: Array<[string, Visibility, string, boolean, boolean]> = [
    ["public, during game", PUBLIC, "ana", false, true],
    ["private to self, during game", privateTo("ana"), "ana", false, true],
    ["private to someone else, during game", privateTo("ben"), "ana", false, false],
    ["reveal-only, during game", REVEAL, "ana", false, false],
    ["private to someone else, after the game", privateTo("ben"), "ana", true, true],
    ["reveal-only, after the game", REVEAL, "ana", true, true],
    // design §11.2: in secret vote mode only the tally is ever shown
    ["secret to self, during game", secretTo("ana"), "ana", false, true],
    ["secret to someone else, during game", secretTo("ben"), "ana", false, false],
    ["secret to self, after the game", secretTo("ana"), "ana", true, true],
    ["secret to someone else, after the game", secretTo("ben"), "ana", true, false],
  ];
  it.each(cases)("%s", (_label, visibility, viewer, gameOver, expected) => {
    expect(canSee(visibility, viewer, gameOver)).toBe(expected);
  });
});

describe("event samples", () => {
  it("there is one sample per event type, keyed by its own type", () => {
    for (const [key, event] of Object.entries(sampleEvents)) {
      expect(event.type).toBe(key);
      expect(["public", "private", "reveal", "secret"]).toContain(event.visibility.kind);
    }
  });

  it("there is one sample per command type, keyed by its own type", () => {
    for (const [key, command] of Object.entries(sampleCommands)) {
      expect(command.type).toBe(key);
    }
  });

  it("the public setup event does not carry the seed — design §17.2", () => {
    expect(JSON.stringify(sampleEvents.gameCreated)).not.toContain("seed");
    expect(sampleEvents.rngSeeded.visibility.kind).toBe("reveal");
  });
});

// Compile-time checks (enforced by `pnpm typecheck`): secrets can't be tagged public.
describe("event visibility is fixed by type — design §17.2", () => {
  it("secret events only accept their own visibility", () => {
    expectTypeOf<Extract<GameEvent, { type: "roleDealt" }>["visibility"]>().toEqualTypeOf<PrivateVisibility>();
    expectTypeOf<Extract<GameEvent, { type: "lootSplit" }>["visibility"]>().toEqualTypeOf<PrivateVisibility>();
    expectTypeOf<Extract<GameEvent, { type: "moveSubmitted" }>["visibility"]>().toEqualTypeOf<PrivateVisibility>();
    expectTypeOf<Extract<GameEvent, { type: "rngSeeded" }>["visibility"]>().toEqualTypeOf<RevealVisibility>();
    expectTypeOf<Extract<GameEvent, { type: "roundResolved" }>["visibility"]>().toEqualTypeOf<PublicVisibility>();
    expectTypeOf<Extract<GameEvent, { type: "voteCast" }>["visibility"]>().toEqualTypeOf<
      PublicVisibility | PrivateVisibility | SecretVisibility
    >();

    // @ts-expect-error a dealt role can never be public
    const leak: GameEvent = { type: "roleDealt", visibility: PUBLIC, player: "ana", role: "fence" };
    expect(leak).toBeDefined();
  });
});

// The engine has no clock and several deadlines can be pending at once, so the
// scheduler must say which one passed. design §4.1, §11.1
describe("advance names its deadline — design §4.1, §11.1", () => {
  it("a bare advance does not type-check", () => {
    // @ts-expect-error advance must name the deadline that passed
    const bare: Command = { type: "advance" };
    expect(bare).toBeDefined();
  });
});
