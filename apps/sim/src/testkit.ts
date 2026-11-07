// Small builders for synthetic game records in the simulator's tests.
import type { GameRecord, PlayerRecord, ShakedownRecord } from "./record";

export function seat(over: Partial<PlayerRecord> = {}): PlayerRecord {
  return {
    id: "p1",
    personality: "honest",
    role: "rookie",
    tag: "teamPlayer",
    tokensEarned: 0,
    tokensSpent: 0,
    star: false,
    score: 0,
    stash: 0,
    grabbed: 20,
    pocketed: 0,
    timesShakenDown: 0,
    winner: false,
    winCredit: 0,
    ...over,
  };
}

export function shake(over: Partial<ShakedownRecord> = {}): ShakedownRecord {
  return { act: 1, emergency: false, target: "p1", stashRevealed: 10, clean: false, targetHadPocketed: true, ...over };
}

/** A game record; `winners` also sets the seats' winner flags and credit. */
export function gameRec(over: Partial<GameRecord> = {}): GameRecord {
  const base: GameRecord = {
    seed: "s",
    players: 4,
    result: "success",
    reason: null,
    endedRound: 12,
    haul: 100,
    bankLeft: 4,
    capWithBankLeft: false,
    wanted: 1,
    raids: 1,
    stalls: 0,
    meetings: 3,
    shakedowns: [],
    winners: [],
    playerRecords: [],
    rejections: 0,
    ...over,
  };
  const winners = base.winners;
  return {
    ...base,
    playerRecords: base.playerRecords.map((p) => ({
      ...p,
      winner: winners.includes(p.id),
      winCredit: winners.includes(p.id) ? 1 / winners.length : 0,
    })),
  };
}
