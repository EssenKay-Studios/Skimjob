// The snapshot card (design §10): one round as the crew tells it, next to what everyone saw.
// One row per floor, each split into its rooms: wall colour, icon, name, bell; who says they
// were there (dashed ring) or was shown there for giving no alibi (solid ring, a fact); a raid,
// a room that rang with nobody in it, the event card and the missing coins. Tapping a crook
// opens your private trust mark for them. Built by game/snapshot.ts from public facts only.
// At the reveal (design §18) the same card is told true: each alibi stamped TRUE or LIE, and
// each liar drawn again, in a red ring under "really:", in the room they were really in.
import type { RoomId } from "@skimjob/content";
import type { AlibiMark, PlayerId } from "@skimjob/engine";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { RoomIcon } from "../art/RoomIcon";
import { ROOM_WALL } from "../art/rooms";
import type { BankRoomId } from "../art/bankLayout";
import type { SeatLook } from "../game/board";
import { cardName } from "../game/describeEvent";
import type { Snapshot, SnapshotCrook, SnapshotRoom } from "../game/snapshot";
import { useMedia } from "../game/useMedia";
import { Avatar } from "./Avatar";
import { AlarmBell } from "./Bell";
import { SHELL_WIDE_QUERY } from "./GameShell";
import { InfoTip } from "./InfoTip";
import { Close, Tick } from "./icons";
import { BagArt } from "./CoinBags";
import { SketchFrame } from "./SketchFrame";
import "./alibi.css";

export interface SnapshotCardProps {
  readonly snap: Snapshot;
  /** Everyone's seat look (game/board.ts `seatLooks`). */
  readonly crew: ReadonlyMap<PlayerId, SeatLook>;
  readonly me: PlayerId;
  /** Your trust marks by "round/target" (game/snapshot.ts `myMarks`). */
  readonly marks: ReadonlyMap<string, AlibiMark>;
  /** Bulbs on a bell, from content. */
  readonly bulbs: number;
  /** Marks a crook; without it the card is read-only (the reveal). */
  readonly onMark?: (round: number, target: PlayerId, mark: AlibiMark | null) => void;
  /** The heading under "After the alibis"; the case board passes "Round N". */
  readonly title?: string | undefined;
  /** The reveal (design §18): where everyone really was. Stamps each alibi TRUE or LIE. */
  readonly truth?: ReadonlyMap<PlayerId, RoomId>;
}

const MARK_WORD: Record<AlibiMark, string> = { trusted: "Trusted", liar: "Liar" };

export function SnapshotCard({ snap, crew, me, marks, bulbs, onMark, title = `Round ${snap.round}, as told`, truth }: SnapshotCardProps) {
  const size = useMedia(SHELL_WIDE_QUERY) ? 24 : 22;
  const [open, setOpen] = useState<{ target: PlayerId; anchor: HTMLElement } | null>(null);
  const name = (p: PlayerId) => crew.get(p)?.name ?? p;
  const said = new Map(snap.floors.flat().flatMap((r) => r.crooks.flatMap((c) => (c.kind === "says" ? [[c.player, r.id] as const] : []))));
  const lied = (p: PlayerId) => truth !== undefined && truth.has(p) && truth.get(p) !== said.get(p);
  const crook = (c: SnapshotCrook, room: string) => {
    const look = crew.get(c.player);
    const mark = truth ? undefined : marks.get(`${snap.round}/${c.player}`);
    const stamp = truth && c.kind === "says" ? (lied(c.player) ? "LIE" : "TRUE") : null;
    const what = `${c.player === me ? "You" : name(c.player)} ${c.kind === "says" ? `say${c.player === me ? "" : "s"} the ${room}` : `gave no alibi: in the ${room}`}${mark ? `, marked ${MARK_WORD[mark]}` : ""}${stamp ? `: ${stamp}` : ""}`;
    const face = (
      <>
        <Avatar name={name(c.player)} initials={look?.tag} seat={look?.look} size={size} title={what} />
        {mark && <span className={`snap__badge snap__badge--${mark}`} aria-hidden="true">{mark === "trusted" ? <Tick /> : <Close />}</span>}
        {stamp && <span className={`snap__stamp snap__stamp--${stamp.toLowerCase()}`}>{stamp}</span>}
      </>
    );
    const cls = `snap__crook snap__crook--${c.kind}`;
    return (
      <li key={c.player}>
        {c.player === me || !onMark ? (
          <span className={cls}>{face}</span>
        ) : (
          <button type="button" className={cls} aria-label={`${what}. Mark ${name(c.player)}`} aria-haspopup="true" onClick={(e) => setOpen({ target: c.player, anchor: e.currentTarget })}>
            {face}
          </button>
        )}
      </li>
    );
  };
  /** design §18: the liars who were really in this room, each in a red ring under "really:". */
  const really = (room: SnapshotRoom) => {
    const liars = [...said.keys()].filter((p) => lied(p) && truth?.get(p) === room.id);
    return (
      liars.length > 0 && (
        <li className="snap__really">
          <span className="snap__really-h">really:</span>
          {liars.map((p) => (
            <span key={p} className="snap__liar">
              <Avatar name={name(p)} initials={crew.get(p)?.tag} seat={crew.get(p)?.look} size={size} title={`${p === me ? "You were" : `${name(p)} was`} really in the ${room.name}`} />
            </span>
          ))}
        </li>
      )
    );
  };
  return (
    <SketchFrame as="section" seed={`snap-${snap.round}`} radius={14} shadow={0.4} className="snap" aria-labelledby={`snap-h-${snap.round}`}>
      <div className="snap__head">
        <div className="snap__title">
          <p className="snap__kicker meta">{truth ? "Every alibi, checked" : "After the alibis"}</p>
          <h3 id={`snap-h-${snap.round}`} className="hand">
            {title}
          </h3>
        </div>
        <InfoTip info={{ kind: "tip", id: "snapshot" }} />
        {snap.card && <span className="snap__event">{cardName(snap.card)}</span>}
      </div>
      {snap.floors.map((floor, i) => (
        <div key={i} className="snap__floor">
          {floor.map((r) => (
            <div key={r.id} className={["snap__room", r.quiet && "is-quiet", r.raided !== null && "is-raided"].filter(Boolean).join(" ")} data-room={r.id} style={{ "--wall": ROOM_WALL[r.id as BankRoomId] ?? "var(--art-wall-roof)" } as CSSProperties}>
              <div className="snap__room-head">
                <span className="snap__room-title">
                  <RoomIcon room={r.id as BankRoomId} size={16} />
                  <span className="snap__room-name hand">{r.name}</span>
                </span>
                {r.raided !== null ? <span className="snap__raid">raided −{r.raided}</span> : r.bell !== null && <AlarmBell bulbs={bulbs} lit={r.bell === "hidden" ? 0 : r.bell} hidden={r.bell === "hidden"} size="xs" />}
              </div>
              {r.quiet && !truth && <p className="snap__quiet">rang, nobody says they were here</p>}
              <ul className="snap__crooks" aria-label={`Crew in the ${r.name}`}>
                {r.crooks.map((c) => crook(c, r.name))}
                {really(r)}
              </ul>
            </div>
          ))}
        </div>
      ))}
      <p className="snap__duffel">
        <BagArt bag="duffel" />
        <span>
          <b className="num">
            {snap.missing} {snap.missing === 1 ? "coin" : "coins"}
          </b>{" "}
          never reached the duffel
        </span>
      </p>
      {open && (
        <MarkPopover
          name={name(open.target)}
          mark={marks.get(`${snap.round}/${open.target}`) ?? null}
          anchor={open.anchor}
          onPick={(m) => {
            onMark?.(snap.round, open.target, m);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </SketchFrame>
  );
}

const MARGIN = 8;

/**
 * design §10: a crook's trust mark, floating at their avatar: their name, then the two
 * states it isn't in (unmarked: Trusted, Liar; Trusted: Clear, Liar; Liar: Trusted, Clear).
 * A native popover: a tap elsewhere or Esc closes it with no change.
 */
export function MarkPopover({ name, mark, anchor, onPick, onClose }: { name: string; mark: AlibiMark | null; anchor: HTMLElement | null; onPick: (mark: AlibiMark | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.showPopover();
    const r = anchor?.getBoundingClientRect();
    if (r) {
      el.style.left = `${Math.min(Math.max(r.left + r.width / 2 - el.offsetWidth / 2, MARGIN), window.innerWidth - el.offsetWidth - MARGIN)}px`;
      el.style.top = `${Math.min(r.bottom, window.innerHeight - el.offsetHeight - MARGIN)}px`;
    }
    el.querySelector("button")?.focus();
  }, [anchor]);
  const options: (AlibiMark | null)[] = mark === null ? ["trusted", "liar"] : mark === "trusted" ? [null, "liar"] : ["trusted", null];
  return (
    <div ref={ref} className="markpop" popover="auto" role="group" aria-label={`Your mark on ${name}`} onToggle={(e) => (e as unknown as ToggleEvent).newState === "closed" && onClose()}>
      <span className="markpop__name">{name}</span>
      <span className="markpop__opts">
        {options.map((m) => (
          <button key={m ?? "clear"} type="button" className={`markpop__btn markpop__btn--${m ?? "clear"}`} aria-label={m ? `Mark ${name} ${MARK_WORD[m]}` : `Clear your mark on ${name}`} onClick={() => onPick(m)}>
            <span className="markpop__dot">{m === "trusted" ? <Tick /> : m === "liar" ? <Close /> : null}</span>
          </button>
        ))}
      </span>
    </div>
  );
}

/** design §10: "How to read the card", closed by default. One 12 px size, every icon 16 px. */
export function CardKey({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="cardkey">
      <button type="button" className="cardkey__btn" aria-expanded={open} aria-controls="cardkey-body" onClick={() => setOpen(!open)}>
        How to read the card
        <svg className="cardkey__chev" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 6l4.6 4.4L12.6 6" />
        </svg>
      </button>
      <InfoTip info={{ kind: "tip", id: "cardKey" }} />
      {open && (
        <div id="cardkey-body" className="cardkey__body">
          <ul className="cardkey__rows">
            <li>
              <span className="cardkey__ring cardkey__ring--says" aria-hidden="true" /> says
            </li>
            <li>
              <span className="cardkey__ring cardkey__ring--fact" aria-hidden="true" /> no alibi
            </li>
            <li>
              <span className="cardkey__mark snap__badge--trusted" aria-hidden="true">
                <Tick />
              </span>{" "}
              you trust them
            </li>
            <li>
              <span className="cardkey__mark snap__badge--liar" aria-hidden="true">
                <Close />
              </span>{" "}
              you think they lied
              <InfoTip info={{ kind: "tip", id: "trustMarks" }} />
            </li>
          </ul>
          <p className="cardkey__tip">Tap a crook to mark them Trusted or Liar. Only you see your marks, and they go in your case board.</p>
        </div>
      )}
    </div>
  );
}
