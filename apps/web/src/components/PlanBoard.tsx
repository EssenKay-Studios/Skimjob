// The plan board's body (design §10; the panel around it gives the heading): a miniature bank where anyone puts crew avatars on
// rooms, your own room claim and pledge, "I agree", and the plan ledger linked both
// ways with the heads. After a round the same panel shows its snapshot (the final
// plan and how it changed, by time left, never wall time) and offers an alibi for it
// (§11.3). Edits go out through `onEdit`; the board comes from the live channel.
import { useState } from "react";
import type { PlanSnapshot, PlayerId } from "@skimjob/engine";
import { CrookAvatar } from "../art/Crook";
import { agreedText, beforeDeadline, editText, historyOrder, pledgeAims, pledgeRoles, type PlanBoard as Board, type PlanEdit, type PlanEntry } from "../game/plan";
import { Button } from "./Button";
import { InfoTip } from "./InfoTip";
import { Bolt, Door } from "./icons";
import "./planboard.css";

export interface PlanSeat {
  readonly id: PlayerId;
  readonly name: string;
  readonly isBot: boolean;
  readonly you: boolean;
  readonly look: number;
}
export interface PlanRoom {
  readonly id: string;
  readonly name: string;
  /** Why nobody can go there this round (taped off, Lockdown), or null. */
  readonly closed: string | null;
}

export interface PlanBoardProps {
  readonly seats: readonly PlanSeat[];
  readonly rooms: readonly PlanRoom[];
  /** The live board while a round is being planned; null when none is (the last snapshot shows instead). */
  readonly board: Board | null;
  readonly onEdit: (edit: PlanEdit) => Promise<void>;
  /** The latest round with a snapshot (the engine logs none when nobody used the board). */
  readonly last: { readonly round: number; readonly plan: PlanSnapshot } | null;
  /** The latest resolved round, and the room you claimed for it. */
  readonly alibi: { readonly round: number; readonly posted: string | null } | null;
  readonly onAlibi: (round: number, room: string) => Promise<void>;
  readonly seed?: string;
}

const roleName = (id: string) => pledgeRoles().find((r) => r.id === id)?.name ?? id;

export function PlanBoard({ seats, rooms, board, onEdit, last, alibi, onAlibi, seed = "plan" }: PlanBoardProps) {
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? id;
  const name = (id: PlayerId) => seats.find((s) => s.id === id)?.name ?? id;
  return (
    <div className="plan">
      <div className="plan__head">
        <InfoTip info={{ kind: "tip", id: "planBoard" }} />
        {board && <Agreed board={board} seats={seats.length} />}
      </div>
      {board ? <Live seats={seats} rooms={rooms} board={board} onEdit={onEdit} roomName={roomName} name={name} seed={seed} /> : <p className="meta plan__none">The board opens with the next round.</p>}
      {last && <Snapshot last={last} seats={seats} name={name} roomName={roomName} />}
      {alibi && <Alibi alibi={alibi} rooms={rooms} roomName={roomName} onAlibi={onAlibi} seed={seed} />}
    </div>
  );
}

function Agreed({ board, seats }: { board: Board; seats: number }) {
  return (
    <span className="plan__agreedbox">
      <span className="num plan__agreed" aria-live="polite">
        {agreedText(board.entries, seats)}
      </span>
      <InfoTip info={{ kind: "tip", id: "iAgree" }} />
    </span>
  );
}

interface LiveProps {
  readonly seats: readonly PlanSeat[];
  readonly rooms: readonly PlanRoom[];
  readonly board: Board;
  readonly onEdit: (edit: PlanEdit) => Promise<void>;
  readonly roomName: (id: string) => string;
  readonly name: (id: PlayerId) => string;
  readonly seed: string;
}

function Live({ seats, rooms, board, onEdit, roomName, name, seed }: LiveProps) {
  // The player tapped (a head or a ledger line): marks both, shows their claims, and the next room tapped moves them.
  const [sel, setSel] = useState<PlayerId | null>(null);
  const [pledging, setPledging] = useState(false);
  const entry = (id: PlayerId): PlanEntry | undefined => board.entries.find((e) => e.player === id);
  const me = seats.find((s) => s.you)!;
  const mine = entry(me.id);
  const toggle = (id: PlayerId) => setSel(sel === id ? null : id);
  const place = (player: PlayerId, room: string | null) => {
    setSel(null);
    return onEdit({ place: { player, room } });
  };
  const roomTap = (room: PlanRoom) => {
    if (room.closed) return;
    if (sel) return place(sel, room.id);
    return onEdit({ room: mine?.room === room.id ? null : room.id });
  };
  const head = (s: PlanSeat) => (
    <button
      key={s.id}
      type="button"
      className={["plan__head-btn", sel === s.id && "is-sel"].filter(Boolean).join(" ")}
      aria-pressed={sel === s.id}
      aria-label={`${s.you ? `${s.name} (you)` : s.name}${entry(s.id)?.agreed ? ", agreed" : ""}. Show claims`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", s.id)}
      onClick={() => toggle(s.id)}
    >
      <CrookAvatar name={s.name} look={s.look} bot={s.isBot} size={30} />
      {entry(s.id)?.agreed && <span className="plan__tick" aria-hidden="true">✓</span>}
    </button>
  );
  const shown = seats.find((s) => s.id === sel);
  const shownEntry = shown && entry(shown.id);
  return (
    <>
      <div className="plan__bank" role="group" aria-label="Plan board: put crew on rooms">
        {rooms.map((r) => (
          <div
            key={r.id}
            className="plan__room"
            data-room={r.id}
            onDragOver={(e) => !r.closed && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const player = e.dataTransfer.getData("text/plain");
              if (!r.closed && seats.some((s) => s.id === player)) void place(player, r.id);
            }}
          >
            <button type="button" className="plan__room-btn" disabled={!!r.closed} aria-label={`${r.name}${r.closed ? `, closed` : sel ? `: put ${name(sel)} here` : mine?.room === r.id ? ": your spot, tap to drop it" : ": claim as your spot"}`} onClick={() => void roomTap(r)}>
              <span className="plan__room-name">{r.name}</span>
              {r.closed && <span className="plan__closed">Closed</span>}
              {mine?.room === r.id && (
                <span className="plan__spot" aria-hidden="true">
                  <Door />
                </span>
              )}
            </button>
            <span className="plan__heads">{seats.filter((s) => entry(s.id)?.placed === r.id).map(head)}</span>
          </div>
        ))}
      </div>
      <div className="plan__tray" role="group" aria-label="Crew not on the plan">
        {seats.filter((s) => !entry(s.id)?.placed).map(head)}
        {sel && entry(sel)?.placed && (
          <Button variant="small" seed={`${seed}-off`} onClick={() => void place(sel, null)}>
            Take {name(sel)} off
          </Button>
        )}
      </div>
      <ul className="plan__ledger" aria-label="Claims this round">
        {seats.map((s) => {
          const e = entry(s.id);
          return (
            <li key={s.id}>
              <button type="button" className={["plan__line", sel === s.id && "is-sel"].filter(Boolean).join(" ")} aria-pressed={sel === s.id} aria-label={`${s.name}: ${claimWords(e, roomName, name)}. Show ${s.name}`} onClick={() => toggle(s.id)}>
                <span className="plan__who">{s.name}</span>
                <Claims entry={e} roomName={roomName} name={name} />
              </button>
            </li>
          );
        })}
      </ul>
      {shown && (
        <div className="plan__pop" role="group" aria-label={`${shown.name}'s claims`}>
          <b className="hand">{shown.name}</b>
          <Claims entry={shownEntry} roomName={roomName} name={name} full />
          <Button variant="small" seed={`${seed}-pop-x`} onClick={() => setSel(null)}>
            Close
          </Button>
        </div>
      )}
      {pledging ? (
        <Pledge rooms={rooms} seats={seats} current={mine?.power ?? null} seed={seed} onSave={(power) => onEdit({ power }).then(() => setPledging(false))} onCancel={() => setPledging(false)} />
      ) : (
        <div className="plan__actions">
          <Button variant="small" seed={`${seed}-claim`} icon={<Bolt />} onClick={() => setPledging(true)}>
            {mine?.power ? "Change pledge" : "Claim a power"}
          </Button>
          <Button variant="primary" seed={`${seed}-agree`} pressed={!!mine?.agreed} onClick={() => void onEdit({ agree: !mine?.agreed })}>
            {mine?.agreed ? "Agreed" : "I agree"}
          </Button>
        </div>
      )}
    </>
  );
}

const claimWords = (e: PlanEntry | undefined, room: (id: string) => string, name: (id: PlayerId) => string): string => {
  const parts = [e?.room ? room(e.room) : null, e?.power ? `${roleName(e.power.role)} on ${pledgeAims(e.power.role) === "player" ? name(e.power.target) : room(e.power.target)}` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : "no claims";
};

/** One player's claims: a door for the room, a bolt for the pledge. */
function Claims({ entry, roomName, name, full }: { entry: PlanEntry | undefined; roomName: (id: string) => string; name: (id: PlayerId) => string; full?: boolean }) {
  if (!entry?.room && !entry?.power) return <span className="meta plan__nothing">{full ? "No claims yet" : "–"}</span>;
  return (
    <span className="plan__claims">
      {entry.room && (
        <span className="plan__claim">
          <Door />
          {roomName(entry.room)}
        </span>
      )}
      {entry.power && (
        <span className="plan__claim">
          <Bolt />
          {roleName(entry.power.role)} → {pledgeAims(entry.power.role) === "player" ? name(entry.power.target) : roomName(entry.power.target)}
        </span>
      )}
    </span>
  );
}

function Pledge({ rooms, seats, current, seed, onSave, onCancel }: { rooms: readonly PlanRoom[]; seats: readonly PlanSeat[]; current: { role: string; target: string } | null; seed: string; onSave: (p: { role: string; target: string } | null) => Promise<void>; onCancel: () => void }) {
  const [role, setRole] = useState<string | null>(current?.role ?? null);
  const [target, setTarget] = useState<string | null>(current?.target ?? null);
  const aims = role ? pledgeAims(role) : undefined;
  const targets = aims === "player" ? seats.filter((s) => !s.you).map((s) => ({ id: s.id, name: s.name })) : rooms.map((r) => ({ id: r.id, name: r.name }));
  return (
    <div className="plan__pledge">
      <div className="plan__chips" role="group" aria-label="Role to pledge">
        {pledgeRoles().map((r) => (
          <Button key={r.id} variant="toggle" seed={`${seed}-role-${r.id}`} pressed={role === r.id} onClick={() => { setRole(r.id); setTarget(null); }}>
            {r.name}
          </Button>
        ))}
      </div>
      {role && (
        <div className="plan__chips" role="group" aria-label={aims === "player" ? "Player to pledge on" : "Room to pledge on"}>
          {targets.map((t) => (
            <Button key={t.id} variant="toggle" seed={`${seed}-to-${t.id}`} pressed={target === t.id} onClick={() => setTarget(t.id)}>
              {t.name}
            </Button>
          ))}
        </div>
      )}
      <div className="plan__actions">
        <Button variant="primary" seed={`${seed}-pledge`} disabled={!role || !target} onClick={() => void onSave({ role: role!, target: target! })}>
          Pledge
        </Button>
        {current && (
          <Button variant="small" seed={`${seed}-unpledge`} onClick={() => void onSave(null)}>
            Drop pledge
          </Button>
        )}
        <Button variant="ghost" seed={`${seed}-pledge-x`} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** A resolved round's plan: who claimed what, and how it changed (most time left first, never a wall time). */
function Snapshot({ last, seats, name, roomName }: { last: NonNullable<PlanBoardProps["last"]>; seats: readonly PlanSeat[]; name: (id: PlayerId) => string; roomName: (id: string) => string }) {
  const { round, plan } = last;
  return (
    <details className="plan__snap">
      <summary>Round {round} plan</summary>
      <ul className="plan__ledger" aria-label={`Round ${round} claims`}>
        {seats.map((s) => (
          <li key={s.id} className="plan__line">
            <span className="plan__who">{s.name}</span>
            <Claims entry={plan.entries.find((e) => e.player === s.id)} roomName={roomName} name={name} />
          </li>
        ))}
      </ul>
      {plan.history.length > 0 && (
        <ol className="plan__history" aria-label={`How the round ${round} plan changed`}>
          {historyOrder(plan.history).map((e, i) => (
            <li key={i}>
              {editText(e, name, roomName, roleName)}
              <span className="meta"> · {beforeDeadline(e.msBeforeDeadline)}</span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

/** An alibi for the latest resolved round: a room, true or not; everyone sees it. design §11.3 */
function Alibi({ alibi, rooms, roomName, onAlibi, seed }: { alibi: NonNullable<PlanBoardProps["alibi"]>; rooms: readonly PlanRoom[]; roomName: (id: string) => string; onAlibi: (round: number, room: string) => Promise<void>; seed: string }) {
  const [room, setRoom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (alibi.posted) {
    return (
      <p className="plan__alibi">
        You told the crew you were in the <b>{roomName(alibi.posted)}</b> in round {alibi.round}. Everyone can see it.
      </p>
    );
  }
  return (
    <div className="plan__alibi">
      <p className="hand">Round {alibi.round} alibi: where were you?</p>
      <div className="plan__chips" role="group" aria-label="Alibi room">
        {rooms.map((r) => (
          <Button key={r.id} variant="toggle" seed={`${seed}-alibi-${r.id}`} pressed={room === r.id} onClick={() => setRoom(r.id)}>
            {r.name}
          </Button>
        ))}
      </div>
      <Button variant="secondary" seed={`${seed}-alibi-post`} disabled={!room || busy} onClick={async () => { setBusy(true); await onAlibi(alibi.round, room!); setBusy(false); }}>
        Post alibi
      </Button>
    </div>
  );
}
