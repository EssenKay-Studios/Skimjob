// The game screen's host strip (M2-13, design §15): the paused note and the
// stand-in note, which every player needs, and the host's panel in the game
// Menu, over REST (apps/server host.ts); the live view brings the new control
// state back.
import { useState } from "react";
import type { PlayerView } from "@skimjob/engine";
import { HostPanel, PausedBanner, StandInBanner } from "../components/HostPanel";
import { useToast } from "../components/Toast";
import { seatOffers, type Control, type HostSeat } from "../game/host";
import { api, sentence, type LobbyView } from "../api";

const EXTENDABLE = new Set(["planning", "meeting"]);

const minutes = (ms: number) => (ms >= 3_600_000 ? `${Math.round(ms / 3_600_000)} h` : ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`);

interface HostProps {
  readonly gameId: string;
  readonly game: LobbyView;
  readonly view: PlayerView;
  readonly control: Control;
}

/** One host request at a time, its outcome toasted. */
function useHostAct(gameId: string) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const act = async (method: "POST" | "DELETE", path: string, done: (r: { extendedMs?: number }) => string) => {
    setBusy(true);
    try {
      toast(done(await api<{ extendedMs?: number }>(method, `/games/${encodeURIComponent(gameId)}${path}`)), "good");
    } catch (e) {
      toast(sentence(e instanceof Error ? e.message : String(e)), "bad");
    } finally {
      setBusy(false);
    }
  };
  return { busy, act };
}

/** In "This round": what every player needs to see (the host's controls are in the Menu). */
export function GameHost({ gameId, game, view, control }: HostProps) {
  const { busy, act } = useHostAct(gameId);
  if (view.phase.kind === "ended") return null;
  const mine = game.seats.find((s) => s.you);
  const paused = control.pausedAt !== null;
  const standIn = control.standIns.includes(view.me.id);
  if (!paused && !standIn) return null;
  return (
    <div className="game-host">
      {paused && <PausedBanner />}
      {standIn && mine && <StandInBanner busy={busy} onTakeBack={() => void act("DELETE", `/seats/${mine.seat}/stand-in`, () => "Your seat is yours again.")} />}
    </div>
  );
}

/** In the game Menu, for the host while the game runs. */
export function HostMenu({ gameId, game, view, control }: HostProps) {
  const { busy, act } = useHostAct(gameId);
  const seats: HostSeat[] = game.seats.flatMap((s) => (s.playerId && !s.bot ? [{ seat: s.seat, playerId: s.playerId, name: s.nickname }] : []));
  const mine = game.seats.find((s) => s.you);
  return (
    <HostPanel
      paused={control.pausedAt !== null}
      canExtend={EXTENDABLE.has(view.phase.kind)}
      offers={seatOffers(control, seats, mine?.playerId ?? null)}
      busy={busy}
      onPause={() => void act("POST", "/pause", () => "Paused. Every clock is stopped.")}
      onResume={() => void act("POST", "/resume", () => "Back on. The clocks run again.")}
      onExtend={() => void act("POST", "/extend", (r) => `Added ${minutes(r.extendedMs ?? 0)}.`)}
      onReplace={(seat) => void act("POST", `/seats/${seat}/stand-in`, () => "A bot plays that seat until it's handed back.")}
      onHandBack={(seat) => void act("DELETE", `/seats/${seat}/stand-in`, () => "Seat handed back.")}
      onEnd={() => void act("POST", "/end", () => "The game is over.")}
    />
  );
}
