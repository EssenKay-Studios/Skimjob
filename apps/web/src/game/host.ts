// Host controls (M2-13, design §15): the public control state the server sends
// with each view (live.ts `Control`), checked, and what the host panel offers.

export interface Control {
  /** When the host paused the game (server ms), or null while it runs. */
  readonly pausedAt: number | null;
  /** Seats a stand-in bot plays for now (engine player ids). */
  readonly standIns: readonly string[];
  /** Seats that missed rounds in a row and may be replaced with a bot. */
  readonly idle: readonly string[];
}

export const NO_CONTROL: Control = { pausedAt: null, standIns: [], idle: [] };

const ids = (xs: unknown): string[] => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string") : []);

/** A view frame's `control`, checked (bad parts dropped); null if there isn't one. */
export function controlOf(msg: Record<string, unknown>): Control | null {
  const c = msg.control;
  if (typeof c !== "object" || c === null || Array.isArray(c)) return null;
  const { pausedAt, standIns, idle } = c as Record<string, unknown>;
  return {
    pausedAt: typeof pausedAt === "number" && Number.isFinite(pausedAt) ? pausedAt : null,
    standIns: ids(standIns),
    idle: ids(idle),
  };
}

export interface HostSeat {
  readonly seat: number;
  readonly playerId: string;
  readonly name: string;
}

export type SeatOffer = { readonly kind: "replace" | "handBack"; readonly seat: HostSeat };

/** Who the host can replace with a bot (idle, not the host, not already replaced) or hand back, in seat order. */
export function seatOffers(control: Control, seats: readonly HostSeat[], hostPlayerId: string | null): SeatOffer[] {
  const out: SeatOffer[] = [];
  for (const seat of seats) {
    if (control.standIns.includes(seat.playerId)) out.push({ kind: "handBack", seat });
    else if (control.idle.includes(seat.playerId) && seat.playerId !== hostPlayerId) out.push({ kind: "replace", seat });
  }
  return out;
}
