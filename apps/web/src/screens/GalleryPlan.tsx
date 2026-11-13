// /dev/gallery: the plan board (design §10) on a made-up crew, edited in the browser
// only (no server): rooms, heads, claims, pledges, "I agree", a snapshot with its
// history.
import { useState } from "react";
import type { PlanSnapshot } from "@skimjob/engine";
import { PlanBoard, type PlanRoom, type PlanSeat } from "../components/PlanBoard";
import type { PlanBoard as Board, PlanEdit } from "../game/plan";

const SEATS: readonly PlanSeat[] = ["Sam", "Ava", "Ben", "Cleo", "Dev", "Eli"].map((name, i) => ({ id: `p${i + 1}`, name, isBot: name === "Eli", you: i === 0, look: i }));
const ROOMS: readonly PlanRoom[] = [
  { id: "rooftop", name: "Rooftop", closed: null },
  { id: "security", name: "Security", closed: null },
  { id: "office", name: "Office", closed: null },
  { id: "serverRoom", name: "Server room", closed: null },
  { id: "lobby", name: "Lobby", closed: null },
  { id: "depositBoxes", name: "Deposit boxes", closed: "Taped off" },
  { id: "vault", name: "Vault", closed: null },
];
const LAST: PlanSnapshot = {
  entries: [
    { player: "p2", placed: "vault", room: "vault", power: null, agreed: true },
    { player: "p5", placed: "security", room: "security", power: { role: "hacker", target: "vault" }, agreed: true },
  ],
  history: [
    { actor: "p6", kind: "room", subject: "p6", value: "serverRoom", target: null, msBeforeDeadline: null },
    { actor: "p5", kind: "place", subject: "p3", value: "vault", target: null, msBeforeDeadline: 2 * 60_000 },
    { actor: "p2", kind: "room", subject: "p2", value: "vault", target: null, msBeforeDeadline: 95 * 60_000 },
  ],
};

/** The server applies edits to the live board; this applies them to a local one. */
function apply(board: Board, me: string, e: PlanEdit): Board {
  const touch = (player: string, patch: Partial<Board["entries"][number]>) => {
    const old = board.entries.find((x) => x.player === player) ?? { player, placed: null, room: null, power: null, agreed: false };
    return { ...board, entries: SEATS.flatMap((s) => (s.id === player ? [{ ...old, ...patch }] : board.entries.filter((x) => x.player === s.id))) };
  };
  if (e.place) return touch(e.place.player, { placed: e.place.room });
  return touch(me, { ...(e.room !== undefined && { room: e.room }), ...(e.power !== undefined && { power: e.power }), ...(e.agree !== undefined && { agreed: e.agree }) });
}

export function PlanDemo({ seed = "g-plan" }: { seed?: string }) {
  const [board, setBoard] = useState<Board>({ round: 5, entries: [{ player: "p6", placed: "serverRoom", room: "serverRoom", power: null, agreed: true }] });
  return (
    <PlanBoard
      seed={seed}
      seats={SEATS}
      rooms={ROOMS}
      board={board}
      onEdit={async (e) => setBoard((b) => apply(b, "p1", e))}
      last={{ round: 4, plan: LAST }}
    />
  );
}
