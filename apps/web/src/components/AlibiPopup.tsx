// The alibi pop-up (design §10): as a round resolves, "Psst. Where were you?" Pick the room
// you say you were in (true or a lie) before the window's countdown runs out. One alibi a
// round, never changed. It has no close button: posting closes it, and it leaves on its own
// when the window ends, answered or not.
import { ROOM_TEXT, type RoomId } from "@skimjob/content";
import { useState, type CSSProperties } from "react";
import { RaccoonNarrator } from "../art/Raccoon";
import { RoomIcon } from "../art/RoomIcon";
import { ROOM_WALL, RoomInterior } from "../art/rooms";
import type { BankRoomId } from "../art/bankLayout";
import { Button } from "./Button";
import { InfoTip } from "./InfoTip";
import { DialogSheet } from "./MeetingKit";
import "./alibi.css";

export interface AlibiPopupProps {
  /** The round whose window is open and you haven't answered; null: closed. */
  readonly round: number | null;
  readonly rooms: readonly { readonly id: RoomId; readonly name: string }[];
  /** Time left in the window ("0:14") and its share of the whole, 0–1; null while unknown. */
  readonly left: { readonly text: string; readonly share: number } | null;
  readonly onPost: (round: number, room: RoomId) => Promise<void>;
}

const ART_W = 160;
const ART_H = 80;

/** Stays mounted while closed, so the browser can hand focus back to where it was. */
export function AlibiPopup({ round, rooms, left, onPost }: AlibiPopupProps) {
  const [pick, setPick] = useState<{ round: number; room: RoomId } | null>(null);
  const [busy, setBusy] = useState(false);
  const room = pick && pick.round === round ? rooms.find((r) => r.id === pick.room) : undefined;
  return (
    // ponytail: no way to dismiss it but posting or the window ending (the owner's call); Esc and a tap outside do nothing.
    <DialogSheet open={round !== null} onClose={() => {}} seed="alibi" labelledBy="alibi-h">
      {round !== null && (
        <div className="alibi">
          <div className="alibi__head">
            <RaccoonNarrator size={52} />
            <div>
              <p className="meta">Round {round} alibi</p>
              <h2 id="alibi-h">Psst. Where were you?</h2>
            </div>
          </div>
          {left && (
            <p className="alibi__time meta">
              <span className="alibi__bar" aria-hidden="true">
                <i style={{ "--left": `${Math.round(left.share * 100)}%` } as CSSProperties} />
              </span>
              closes in <b className="num">{left.text}</b>
            </p>
          )}
          <div className="alibi__rooms" role="group" aria-label="Where you say you were">
            {rooms.map((r) => (
              <button key={r.id} type="button" className="alibi__tile" aria-pressed={room?.id === r.id} onClick={() => setPick({ round, room: r.id })}>
                <svg className="alibi__art" viewBox={`0 0 ${ART_W} ${ART_H}`} aria-hidden="true" style={{ "--wall": ROOM_WALL[r.id as BankRoomId] ?? "var(--art-wall-roof)" } as CSSProperties}>
                  <rect width={ART_W} height={ART_H} />
                  <RoomInterior id={r.id as BankRoomId} w={ART_W} h={ART_H} uid={`alibi-${r.id}`} />
                </svg>
                <span className="alibi__name">
                  <RoomIcon room={r.id as BankRoomId} size={20} />
                  {r.name}
                </span>
                <span className="alibi__note">{ROOM_TEXT[r.id]}</span>
              </button>
            ))}
          </div>
          {/* The tip comes after the tiles: the dialog focuses its first control as it opens, and a focused "i" opens its tip over them. */}
          <div className="alibi__foot">
            <Button
              variant="primary"
              seed="alibi-post"
              disabled={!room || busy}
              onClick={async () => {
                setBusy(true);
                await onPost(round, room!.id);
                setBusy(false);
              }}
            >
              {room ? `I was in the ${room.name}` : "Pick a room"}
            </Button>
            <InfoTip info={{ kind: "tip", id: "alibiPopup" }} />
          </div>
        </div>
      )}
    </DialogSheet>
  );
}
