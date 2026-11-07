// The content text (design §20): every room, event and role has a line, the
// numbers in the lines match the data, and infoText finds what an InfoTip asks for.
import { describe, expect, it } from "vitest";
import {
  BANK_JOB,
  BUST_ROLE_TEXT,
  EVENTS,
  EVENT_TEXT,
  PERK_TEXT,
  ROLES,
  ROLE_TEXT,
  ROLE_WIN,
  ROOM_TEXT,
  TERMS,
  TIPS,
  infoText,
} from "./index";

const oneLine = (s: string) => !s.includes("\n") && s.trim() === s && s.length > 0;

describe("room text — design §20.1", () => {
  it("has a line for every room and no other", () => {
    expect(Object.keys(ROOM_TEXT).sort()).toEqual(Object.keys(BANK_JOB.rooms).sort());
  });

  it("says the room's real coin count", () => {
    for (const [id, room] of Object.entries(BANK_JOB.rooms)) {
      const said = ROOM_TEXT[id]?.match(/^(?:Up to )?(\d) coins?/)?.[1];
      expect(said === undefined ? 0 : Number(said), id).toBe(room.coins);
    }
  });
});

describe("event text — design §20.4", () => {
  it("has a line for every card and no other", () => {
    expect(Object.keys(EVENT_TEXT).sort()).toEqual(Object.keys(EVENTS).sort());
  });

  it("Shift change says the extra coins it really gives", () => {
    const effect = EVENTS.shiftChange?.effect;
    expect(effect?.kind === "roomSurge" ? effect.extraCoins : undefined).toBe(1);
    expect(EVENT_TEXT.shiftChange).toContain("1 extra coin");
  });
});

describe("role text — design §20.2", () => {
  it("covers every role in play, names them as the data does, and the two new roles", () => {
    for (const [id, role] of Object.entries(ROLES)) if (id !== "rookie") expect(ROLE_TEXT[id]?.name, id).toBe(role.name);
    expect(Object.keys(ROLE_TEXT)).toEqual(expect.arrayContaining(["locksmith", "electrician"]));
  });

  it("the Mole and the Fixer also win on a heist sunk by theft; the rest win like everyone", () => {
    for (const [id, role] of Object.entries(ROLE_TEXT)) expect(role.win, id).toBe(id === "mole" || id === "fixer" ? "sunk" : "crew");
    expect(ROLE_WIN.sunk).toContain("sunk by theft");
    expect(BUST_ROLE_TEXT).toContain("Rooftop");
  });
});

describe("every text is one plain line", () => {
  const all: [string, string][] = [
    ...Object.entries(ROOM_TEXT),
    ...Object.entries(EVENT_TEXT),
    ...Object.entries(ROLE_TEXT).flatMap(([id, r]) => [[`${id}.power`, r.power], [`${id}.spot`, r.spot]] as [string, string][]),
    ...Object.entries(PERK_TEXT).map(([id, p]) => [id, p.text] as [string, string]),
    ...Object.entries(TERMS).map(([id, t]) => [id, t.text] as [string, string]),
    ...Object.entries(TIPS).map(([id, t]) => [id, t.text] as [string, string]),
  ];
  it("has no blank, padded or multi-line text, and no \"table\" (the money words are duffel, share, pocket, stash, kitty)", () => {
    for (const [id, text] of all) {
      expect(oneLine(text), id).toBe(true);
      expect(text, id).not.toMatch(/\btable\b/i);
    }
  });
});

describe("infoText — design §20.5", () => {
  it("finds a term, a tip, a room, a role, a perk and an event", () => {
    expect(infoText({ kind: "term", id: "pocket" })).toEqual(TERMS.pocket);
    expect(infoText({ kind: "tip", id: "bell" })).toEqual(TIPS.bell);
    expect(infoText({ kind: "room", id: "vault" })).toEqual({ name: "Vault", text: ROOM_TEXT.vault });
    expect(infoText({ kind: "role", id: "mole" })).toEqual({ name: "Mole", text: ROLE_TEXT.mole?.power });
    expect(infoText({ kind: "perk", id: "softShoes" })).toEqual(PERK_TEXT.softShoes);
    expect(infoText({ kind: "event", id: "lockdown" })).toEqual({ name: "Lockdown", text: EVENT_TEXT.lockdown });
  });

  it("returns nothing for an id content does not have", () => {
    expect(infoText({ kind: "room", id: "attic" })).toBeUndefined();
    expect(infoText({ kind: "role", id: "rookie" })).toBeUndefined();
    expect(infoText({ kind: "perk", id: "nope" })).toBeUndefined();
    expect(infoText({ kind: "event", id: "nope" })).toBeUndefined();
  });
});
