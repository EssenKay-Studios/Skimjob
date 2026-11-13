// <BankCutaway>: First National Bank as a side-view dollhouse (design §18,
// m2-plan M2-9). One cutaway room per room in play, each a separately
// addressable <g data-room="…">, so the game screen can highlight a room,
// make rooms pickable and stand crooks in them.
//
// Placing avatars into rooms
// --------------------------
// Pass `occupants`: room id → the crooks to draw standing in that room.
//
//   <BankCutaway
//     rooms={view.rooms}                      // the rooms in play, any order
//     names={{ vault: "Vault", … }}           // labels from content (optional)
//     selected={myMove?.room}
//     onRoomSelect={(room) => pick(room)}     // makes rooms buttons
//     occupants={{
//       vault: [{ id: me.id, name: me.name, look: me.seat, expression: "smug" }],
//       lobby: [{ id: p.id, name: p.name, look: p.seat, ghost: true }], // a claim
//     }}
//   />
//
// `look` is the player's seat number (0-based; 12 seats get 12 colours and 12
// hats) or any seed. Every crook wears a visible name tag (initials, unique
// among the occupants); pass `tag` from `crewTags(allPlayerNames)` so the
// tags match the avatars elsewhere on the screen. Tags are sized to stay
// legible (≥ ~10 px) on a phone. Crooks are spread along the room's floor by
// `roomSlots()`; a crowded room shrinks them and adds a back row (tags above
// their heads). Only pass what the player's view knows: their own room, who
// they saw there, who they watched on camera as `camera`, and alibi claims as `ghost`.
//
// Rooms in `closed` (Lockdown) are taped off and can't be picked: no click
// or key handling, `aria-disabled="true"`, no hover lift. Rooms in `taped`
// (raided, design §5.3) are closed too, and also show "CLOSED 2" counting down
// and a spinning siren light; their bell is off.
//
// Bells: `bells` is each open room's lit bulbs, your preview, or hidden ("?");
// they sit over the drawing as HTML so they stay a readable size. `pile` is the
// share of the bank still to steal (0–1): the Vault's gold shrinks with it.
//
// For HTML overlays instead (badges, counters), use `bankLayout(rooms, mode)`
// with `roomBoxPercent(layout, id)` inside a wrapper with the drawing's aspect.
import { BANK_JOB } from "@skimjob/content";
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { AlarmBell, bellWidth } from "../components/Bell";
import type { Seed } from "../components/sketch";
import { BANK_ROOM_NAMES, bankLayout, roomBoxPercent, roomSlots, type BankLayout, type BankLayoutMode, type BankRoomId, type RoomBox, type Slot } from "./bankLayout";
import { CrookFigure, nameTagWidth } from "./Crook";
import { crewTags, type CrookLook, type Expression } from "./crookLooks";
import { RoomGlyph } from "./RoomIcon";
import { ROOM_WALL, RoomInterior } from "./rooms";

export const CORE_ROOMS: readonly BankRoomId[] = ["vault", "office", "lobby", "security", "rooftop"];

export interface BankOccupant {
  readonly id: string;
  readonly name: string;
  /** Seat number (0-based) or any seed; default: the id. */
  readonly look?: CrookLook | Seed;
  readonly expression?: Expression;
  readonly bot?: boolean;
  /** Carrying a loot sack. */
  readonly sack?: boolean;
  /** Claimed (alibi), not seen: the claimant's dashed outline with a "?". */
  readonly ghost?: boolean;
  /** Seen on camera (Security, the Lookout, a Tail perk), not in person: faded, CCTV wash, camera badge. */
  readonly camera?: boolean;
  /** Visible name tag; default: initials, unique among the drawing's occupants. */
  readonly tag?: string;
}

export type TimeOfDay = "day" | "dusk" | "night";

/** One room's bell: lit bulbs, the bulbs your own grab would add, or hidden (shows "?"). design §5.1, §5.2 */
export interface RoomBell {
  readonly lit: number;
  readonly preview?: number;
  readonly hidden?: boolean;
}

export interface BankCutawayProps {
  /** Room ids in play (`view.rooms`); unknown ids are ignored. Default: the five core rooms. */
  readonly rooms?: readonly string[];
  /** Room labels, e.g. from content; defaults to the bank's names. */
  readonly names?: Partial<Record<string, string>>;
  /** auto: stacked below 600 px of width, wide above. */
  readonly layout?: "auto" | BankLayoutMode;
  readonly time?: TimeOfDay;
  /** Wanted ÷ the bust line, 0–1 (design §5.4): the sky reddens past 0.4 and sirens glow from 0.6. */
  readonly alarm?: number;
  /** The highlighted room: clay outline and a pin. */
  readonly selected?: string | null | undefined;
  /** Makes each room a button (Enter / Space too). */
  readonly onRoomSelect?: (room: BankRoomId) => void;
  /** Rooms shut this round (Lockdown, or taped off after a raid, design §5.3): taped and washed out. */
  readonly closed?: readonly string[];
  /** Raided rooms and the rounds each stays taped off: "CLOSED 2", a siren, no bell. design §5.3 */
  readonly taped?: Readonly<Record<string, number>>;
  /** Each open room's bell. design §5.1 */
  readonly bells?: Readonly<Partial<Record<string, RoomBell>>>;
  /** Bulbs on every bell, from content. */
  readonly bulbs?: number;
  /** The bank pile still to steal, 0–1: the Vault's gold shrinks. design §6.1 */
  readonly pile?: number;
  readonly occupants?: Partial<Record<string, readonly BankOccupant[]>>;
  /** Room name tags (off for small decorative uses). */
  readonly labels?: boolean;
  /** Crooks' initials tags. Default on; off only for decorative drawings with no players (landing doodle). */
  readonly nameTags?: boolean;
  /** Lamp post and hedge at the sides (wide layout). */
  readonly scenery?: boolean;
  /** Crook size multiplier (bigger for small decorative drawings). */
  readonly figureScale?: number;
  /** Accessible name. */
  readonly title?: string;
  readonly className?: string | undefined;
}

const INK = "var(--art-ink)";
const L = { stroke: INK, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" } as const;

function useWidth(): [React.RefObject<HTMLDivElement | null>, number | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.round(el.clientWidth));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Estimated tag width for a Pangolin label (no layout pass needed). */
const tagWidth = (text: string, size: number) => Math.round(text.length * size * 0.45 + size * 1.25 + 18);

function RoomTag({ name, room, size, on }: { name: string; room: BankRoomId; size: number; on: boolean }) {
  const w = tagWidth(name, size);
  const h = size + 11;
  return (
    <g className="bank-tag" transform="translate(8 7) rotate(-1.8)">
      <rect x="2.2" y="2.8" width={w} height={h} rx="5" fill="url(#sk-hatch)" opacity=".5" />
      <rect width={w} height={h} rx="5" fill={on ? "var(--clay)" : "var(--paper-hi)"} stroke={INK} strokeWidth="1.5" />
      <g transform={`translate(6 ${(h - size * 1.1) / 2}) scale(${(size * 1.1) / 24})`} style={{ color: "var(--art-ink)" }}>
        <RoomGlyph room={room} />
      </g>
      <text x={size * 1.25 + 10} y={h / 2 + size * 0.36} className="bank-tag__text" style={{ fontSize: size }}>
        {name}
      </text>
    </g>
  );
}

function Pin({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="bank-pin">
        <ellipse cx="0" cy="2" rx="7" ry="2.4" fill="var(--art-shade-2)" className="bank-pin__ring" />
        <path d="M0 0C-4-8-11-13-11-21a11 11 0 0 1 22 0C11-13 4-8 0 0Z" fill="var(--clay)" {...L} />
        <circle cx="0" cy="-21" r="4.2" fill="var(--paper-hi)" {...L} strokeWidth={1.6} />
      </g>
    </g>
  );
}

/** Smallest on-screen size of a crook's name tag text, in CSS px. */
export const MIN_TAG_PX = 10.5;

/**
 * Interaction props for a room: a button when pickable; a closed (Lockdown)
 * room stays announced as a button but is disabled and never calls `pick`.
 */
export function roomButtonProps({
  id,
  label,
  selected,
  closed,
  pick,
}: {
  id: BankRoomId;
  label: string;
  selected: boolean;
  closed: boolean;
  pick: ((room: BankRoomId) => void) | undefined;
}) {
  if (!pick) return { role: "group", "aria-label": label } as const;
  if (closed) return { role: "button", tabIndex: 0, "aria-label": label, "aria-disabled": true, "aria-pressed": selected } as const;
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    "aria-pressed": selected,
    onClick: () => pick(id),
    onKeyDown: (e: KeyboardEvent<SVGGElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pick(id);
      }
    },
  } as const;
}

/**
 * Font size (room units) for the name tags in a room: at least MIN_TAG_PX on
 * screen, but no wider than the gap to the next crook in the row.
 */
export function tagFont(slots: readonly Slot[], tags: readonly string[], pxPerUnit: number): number {
  const want = Math.max(12, MIN_TAG_PX / pxPerUnit);
  let fit = 22;
  for (const row of [true, false]) {
    const xs = slots.map((s, i) => ({ x: s.x, i })).filter(({ i }) => slots[i]!.back === row).sort((a, b) => a.x - b.x);
    for (let k = 1; k < xs.length; k++) {
      const gap = xs[k]!.x - xs[k - 1]!.x - 1.5;
      const half = (nameTagWidth(tags[xs[k]!.i] ?? "?", 1) + nameTagWidth(tags[xs[k - 1]!.i] ?? "?", 1)) / 2;
      fit = Math.min(fit, gap / half);
    }
  }
  return Math.min(want, fit);
}

const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A taped room's siren: a ceiling light and its red and blue beams spinning across the room (design §5.3). */
function Siren({ x, y, reach, clip }: { x: number; y: number; reach: number; clip: string }) {
  return (
    <g aria-hidden="true">
      <g clipPath={clip}>
        <g transform={`translate(${x} ${y})`}>
          <g className="bank-beams">
            <path d={`M0 0L${-reach} -17L${-reach} 17Z`} fill="var(--art-siren-r)" opacity=".4" />
            <path d={`M0 0L${reach} -17L${reach} 17Z`} fill="var(--art-siren-b)" opacity=".4" />
          </g>
        </g>
      </g>
      <g transform={`translate(${x} ${y})`}>
        <rect x="-10" y="3" width="20" height="5.5" rx="1.6" fill="var(--art-slate)" {...L} strokeWidth={1.5} />
        <path className="bank-siren" d="M-7 3.5A7 7 0 0 1 0 -3.5V3.5Z" fill="var(--art-siren-r)" />
        <path className="bank-siren bank-siren--b" d="M0 -3.5A7 7 0 0 1 7 3.5H0Z" fill="var(--art-siren-b)" />
        <path d="M-7 3.5A7 7 0 0 1 7 3.5Z" fill="none" {...L} strokeWidth={1.5} />
      </g>
    </g>
  );
}

function Room({
  box,
  name,
  uid,
  labels,
  selected,
  closed,
  tapedLeft,
  pile,
  occupants,
  pick,
  figureScale,
  tags,
  nameTags,
  pxPerUnit,
}: {
  figureScale: number;
  nameTags: boolean;
  tags: ReadonlyMap<string, string>;
  pxPerUnit: number;
  box: RoomBox;
  name: string;
  uid: string;
  labels: boolean;
  selected: boolean;
  closed: boolean;
  /** Rounds left taped off (raided), or undefined. */
  tapedLeft: number | undefined;
  pile: number;
  occupants: readonly BankOccupant[];
  pick: ((room: BankRoomId) => void) | undefined;
}) {
  const { id, x, y, w, h } = box;
  const wall = ROOM_WALL[id];
  const slots = roomSlots(w, h, occupants.length, figureScale);
  const order = slots.map((s, i) => ({ s, o: occupants[i]!, i })).sort((a, b) => Number(b.s.back) - Number(a.s.back));
  const who = occupants.filter((o) => !o.ghost && !o.camera).map((o) => o.name);
  const filmed = occupants.filter((o) => !o.ghost && o.camera).map((o) => o.name);
  const claims = occupants.filter((o) => o.ghost).map((o) => o.name);
  const label = [
    name,
    selected ? "selected" : "",
    tapedLeft !== undefined ? `closed ${tapedLeft}` : closed ? "closed" : "",
    who.length ? `here: ${who.join(", ")}` : "",
    filmed.length ? `on camera: ${filmed.join(", ")}` : "",
    claims.length ? `claimed: ${claims.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const tagSize = 15;
  const signW = tapedLeft === undefined ? 76 : 96;
  const twoRows = slots.some((s) => s.back);
  const tagOf = (o: BankOccupant) => o.tag ?? tags.get(o.id) ?? "?";
  const font = tagFont(slots, occupants.map(tagOf), pxPerUnit);
  return (
    <g
      className={["bank-room", selected && "is-selected", closed && "is-closed"].filter(Boolean).join(" ")}
      data-room={id}
      transform={`translate(${x} ${y})`}
      {...roomButtonProps({ id, label, selected, closed, pick })}
    >
      <title>{label}</title>
      <g className="bank-room__lift">
        <g filter={`url(#${uid}-wob)`}>
          {wall && <rect width={w} height={h} fill={wall} />}
          {wall && <rect width={w} height={9} fill="var(--art-shade)" />}
          <RoomInterior id={id} w={w} h={h} uid={`${uid}-${id}`} pile={pile} />
        </g>
        {closed && (
          <g className="bank-room__closed">
            <rect width={w} height={h} fill="var(--paper)" opacity=".5" />
            <clipPath id={`${uid}-${id}-clip`}>
              <rect width={w} height={h} />
            </clipPath>
            <g clipPath={`url(#${uid}-${id}-clip)`}>
              <rect x={-w} y={h / 2 - 9} width={w * 3} height="18" fill={`url(#${uid}-tape)`} stroke={INK} strokeWidth="1.6" transform={`rotate(-9 ${w / 2} ${h / 2})`} />
              <rect x={-w} y={h / 2 - 9} width={w * 3} height="18" fill={`url(#${uid}-tape)`} stroke={INK} strokeWidth="1.6" transform={`rotate(7 ${w / 2} ${h / 2 + 22})`} />
            </g>
            {tapedLeft !== undefined && <Siren x={w - 20} y={20} reach={clampN(w * 0.44, 60, 140)} clip={`url(#${uid}-${id}-clip)`} />}
          </g>
        )}
        {order.map(({ s, o, i }) => (
          <CrookFigure
            key={o.id}
            look={o.look ?? o.id}
            expression={o.expression ?? "neutral"}
            bot={!!o.bot}
            sack={!!o.sack}
            ghost={!!o.ghost}
            camera={!!o.camera && !o.ghost}
            x={s.x}
            y={s.y}
            scale={s.scale}
            flip={i % 2 === 1}
            label={`${o.name}${o.ghost ? " (claimed)" : o.camera ? " (on camera)" : ""}${o.bot ? " (bot)" : ""}`}
            tag={nameTags ? tagOf(o) : undefined}
            tagSize={font / s.scale}
            tagAt={twoRows && s.back ? "head" : "body"}
          />
        ))}
        {/* The CLOSED card goes over the crooks, so a hat never hides it. */}
        {closed && (
          <g className="bank-room__card">
            <g transform={`translate(${w / 2} ${h / 2 + 10}) rotate(-4)`} className="bank-room__closed-sign">
              <rect x={-signW / 2} y="-13" width={signW} height="26" rx="4" fill="url(#sk-hatch)" opacity=".5" transform="translate(2.5 3)" />
              <rect x={-signW / 2} y="-13" width={signW} height="26" rx="4" fill="var(--paper-hi)" stroke={INK} strokeWidth="1.8" />
              <text x="0" y="6" textAnchor="middle" className="bank-closed__text">
                {tapedLeft === undefined ? "CLOSED" : `CLOSED ${tapedLeft}`}
              </text>
            </g>
          </g>
        )}
        {labels && <RoomTag name={name} room={id} size={tagSize} on={selected} />}
        <rect className="bank-room__focus" x="3" y="3" width={w - 6} height={h - 6} rx="8" />
        {selected && (
          <>
            <g className="bank-boil">
              <rect x="2.5" y="2.5" width={w - 5} height={h - 5} rx="7" fill="none" stroke="var(--clay-d)" strokeWidth="4.5" />
              <rect x="3.5" y="2" width={w - 6} height={h - 4.5} rx="8" fill="none" stroke="var(--clay-d)" strokeWidth="4.5" />
              <rect x="2" y="3.2" width={w - 4.5} height={h - 6} rx="6" fill="none" stroke="var(--clay-d)" strokeWidth="4.5" />
            </g>
            {/* With a back row of crooks the pin's corner is their name tags: the outline and the room's tag mark the pick. */}
            {!twoRows && <Pin x={w - 26} y={80} />}
          </>
        )}
      </g>
    </g>
  );
}

function Sky({ layout, uid, time }: { layout: BankLayout; uid: string; time: TimeOfDay }) {
  const { width: W, streetY } = layout;
  const wide = layout.mode === "wide";
  return (
    <g>
      <rect width={W} height={streetY} fill={`url(#${uid}-sky)`} />
      {time === "night" ? (
        <g>
          {[
            [0.08, 0.05],
            [0.2, 0.12],
            [0.36, 0.03],
            [0.52, 0.09],
            [0.66, 0.04],
            [0.94, 0.14],
            [0.04, 0.3],
            [0.97, 0.36],
          ].map(([fx, fy], i) => (
            <circle key={i} cx={fx! * W} cy={fy! * streetY} r={i % 3 === 0 ? 1.8 : 1.2} fill="var(--art-window-hi)" />
          ))}
          <g transform={`translate(${W * 0.8} ${wide ? 26 : 20})`}>
            <circle r="13" fill="var(--art-window-hi)" {...L} strokeWidth={1.6} />
            <circle cx="6" cy="-4" r="12" fill="var(--art-sky-night)" />
          </g>
        </g>
      ) : (
        <g>
          <circle cx={W * 0.82} cy={wide ? 30 : 22} r={wide ? 17 : 13} fill={time === "dusk" ? "var(--clay)" : "var(--gold)"} {...L} strokeWidth={1.6} />
          {[
            [W * 0.24, wide ? 26 : 20, 1],
            [W * 0.6, wide ? 16 : 14, 0.8],
          ].map(([x, y, s], i) => (
            <path
              key={i}
              transform={`translate(${x} ${y}) scale(${s})`}
              d="M-30 6c-6 0-8-8-1-10 0-7 9-9 13-4 3-6 13-6 15 1 7-1 10 7 4 9 2 4-1 6-5 6h-26c-4 0-6-1-6-2z"
              fill="var(--paper-hi)"
              fillOpacity=".9"
              {...L}
              strokeWidth={1.5}
            />
          ))}
        </g>
      )}
    </g>
  );
}

function Scenery({ layout, uid, time }: { layout: BankLayout; uid: string; time: TimeOfDay }) {
  const { width: W, streetY } = layout;
  const night = time !== "day";
  return (
    <g>
      {/* Lamp post */}
      <g transform={`translate(34 ${streetY})`}>
        {night && <circle cx="0" cy="-118" r="44" fill={`url(#${uid}-glow)`} />}
        <path d="M0 0V-112M-8 0h16" {...L} strokeWidth={4} />
        <path d="M0 0V-112" stroke="var(--art-slate)" strokeWidth="1.6" />
        <path d="M-9-112h18l-4-16h-10z" fill={night ? "var(--art-window-hi)" : "var(--art-glass)"} {...L} strokeWidth={1.8} />
        <path d="M-11-128h22" {...L} strokeWidth={3} />
      </g>
      {/* Hedge by the wall */}
      <g transform={`translate(${layout.shell.x0 - 14} ${streetY})`}>
        <path d="M-22 0c-6-4-4-14 4-14 0-8 12-10 16-4 6-6 16-2 14 6 6 2 6 10 2 12z" fill="var(--art-leaf)" {...L} strokeWidth={1.8} />
        <path d="M-12-8c3 2 7 2 10 0M4-6c2-3 5-4 8-3" fill="none" stroke="var(--art-leaf-d)" strokeWidth="1.8" strokeLinecap="round" />
      </g>
    </g>
  );
}

function Shell({ layout, uid, time }: { layout: BankLayout; uid: string; time: TimeOfDay }) {
  const { width: W, height: H, shell, streetY, roofY, footY, slab, roofSlab, storeys, rooms } = layout;
  const { x0, x1, wall } = shell;
  const wide = layout.mode === "wide";
  const ground = storeys.filter((s) => s.floor === "ground").at(-1);
  const doorTop = ground ? streetY - Math.min(84, ground.h - 30) : streetY;
  const margin = W - x1;
  const leaf = Math.min(22, margin - 6);
  return (
    <g>
      {/* Earth around the basement, cut in section */}
      <rect x="0" y={streetY} width={W} height={H - streetY} fill="var(--art-earth)" />
      <rect x="0" y={streetY} width={W} height={H - streetY} fill={`url(#${uid}-soil)`} />
      <rect x="0" y={streetY} width={W} height={H - streetY} fill="url(#sk-hatch)" opacity=".16" />
      {/* Footing */}
      <rect x={x0 - 12} y={footY - slab} width={x1 - x0 + 24} height={slab + 6} fill="var(--art-stone-d)" {...L} />
      <rect x={x0 - 12} y={footY - slab} width={x1 - x0 + 24} height={slab + 6} fill="url(#sk-hatch)" opacity=".35" />

      {/* Side walls: brick above the street, concrete below */}
      {[x0, x1 - wall].map((x, i) => (
        <g key={x}>
          <rect x={x} y={roofY} width={wall} height={streetY - roofY} fill="var(--art-brick)" {...L} />
          <rect x={x} y={roofY} width={wall} height={streetY - roofY} fill={`url(#${uid}-brick)`} />
          {i === 1 && <rect x={x + wall - 6} y={roofY} width={6} height={streetY - roofY} fill="var(--art-shade)" />}
          <rect x={x} y={streetY} width={wall} height={footY - slab - streetY} fill="var(--art-stone-d)" {...L} />
          <rect x={x} y={streetY} width={wall} height={footY - slab - streetY} fill="url(#sk-hatch)" opacity=".4" />
        </g>
      ))}
      {/* Doorway in the right wall at street level */}
      {ground && <rect x={x1 - wall - 1} y={doorTop} width={wall + 2} height={streetY - doorTop} fill="var(--art-wall-lobby)" />}
      {ground && <path d={`M${x1 - wall} ${doorTop}h${wall}`} {...L} strokeWidth={3} />}

      {/* Interior walls between rooms */}
      {storeys.map((s) => {
        const rs = rooms.filter((r) => s.rooms.includes(r.id));
        return rs.slice(0, -1).map((r) => {
          const next = rs[rs.indexOf(r) + 1]!;
          return (
            <g key={r.id}>
              <rect x={r.x + r.w} y={s.y} width={next.x - r.x - r.w} height={s.h} fill="var(--art-stone-d)" {...L} strokeWidth={1.8} />
              <rect x={r.x + r.w} y={s.y} width={next.x - r.x - r.w} height={s.h} fill="url(#sk-hatch)" opacity=".3" />
            </g>
          );
        });
      })}

      {/* Floor slabs */}
      {storeys
        .filter((s) => s.floor !== "roof")
        .map((s, i) => (
          <g key={i}>
            <rect x={x0} y={s.y + s.h} width={x1 - x0} height={slab} fill="var(--art-stone-d)" {...L} />
            <rect x={x0} y={s.y + s.h} width={x1 - x0} height={slab} fill="url(#sk-hatch)" opacity=".38" />
          </g>
        ))}

      {/* Sidewalk */}
      <rect x="0" y={streetY} width={x0} height="8" fill="var(--art-sidewalk)" {...L} />
      <rect x={x1} y={streetY} width={W - x1} height="8" fill="var(--art-sidewalk)" {...L} />
      {/* Steps up to the door */}
      {ground && wide && <path d={`M${x1} ${streetY}h${margin * 0.5}v-6h${-margin * 0.32}v-5h${-margin * 0.18}z`} fill="var(--art-stone)" {...L} strokeWidth={1.8} />}

      {/* Cornice with the bank's name */}
      <rect x={x0 - 10} y={roofY} width={x1 - x0 + 20} height={roofSlab} rx="2" fill="var(--art-stone)" {...L} />
      <rect x={x0 - 10} y={roofY + roofSlab - 6} width={x1 - x0 + 20} height="6" fill="var(--art-stone-d)" {...L} strokeWidth={1.6} />
      <text x={W / 2} y={roofY + roofSlab * 0.62} textAnchor="middle" className="bank-sign" style={{ fontSize: wide ? 13 : 11.5 }}>
        FIRST NATIONAL BANK
      </text>
      {/* Door leaf swung out, with an awning on wide drawings */}
      {ground && (
        <g>
          {time !== "day" && <path d={`M${x1} ${doorTop + 6}L${x1 + leaf + 14} ${streetY}H${x1}z`} fill="var(--art-window-hi)" opacity=".4" />}
          <path d={`M${x1} ${streetY - 2}l${leaf} -7v${-(streetY - doorTop) + 12}l${-leaf} -5z`} fill="var(--art-wood-d)" {...L} strokeWidth={1.8} />
          <circle cx={x1 + leaf * 0.7} cy={(streetY + doorTop) / 2} r="1.8" fill="var(--gold)" />
          {wide && (
            <g>
              <path d={`M${x1} ${doorTop - 18}h${margin - 12}l-6 16h${-(margin - 18)}z`} fill={`url(#${uid}-awning)`} {...L} strokeWidth={1.8} />
              <path d={`M${x1 + 6} ${doorTop - 2}q${(margin - 18) / 8} 6 ${(margin - 18) / 4} 0t${(margin - 18) / 4} 0t${(margin - 18) / 4} 0t${(margin - 18) / 4} 0`} fill="none" {...L} strokeWidth={1.6} />
            </g>
          )}
        </g>
      )}
    </g>
  );
}

export function BankCutaway({
  rooms = CORE_ROOMS,
  names,
  layout = "auto",
  time = "day",
  alarm = 0,
  selected,
  onRoomSelect,
  closed = [],
  taped = {},
  bells = {},
  bulbs = BANK_JOB.alarm.bulbs,
  pile = 1,
  occupants = {},
  labels = true,
  nameTags = true,
  scenery = true,
  figureScale = 1,
  title = "First National Bank, cut away to show its rooms",
  className,
}: BankCutawayProps) {
  const uid = useId().replace(/:/g, "");
  const [ref, width] = useWidth();
  const mode: BankLayoutMode = layout === "auto" ? (width !== null && width < 600 ? "stacked" : "wide") : layout;
  const lay = bankLayout(rooms, mode);
  const tint = Math.max(0, Math.min(1, (alarm - 0.4) / 0.6));
  const shut = new Set([...closed, ...Object.keys(taped)]);
  const pickable = !!onRoomSelect;
  const nameOf = (id: BankRoomId) => names?.[id] ?? BANK_ROOM_NAMES[id];
  const people = new Map<string, string>();
  for (const list of Object.values(occupants)) for (const o of list ?? []) if (!people.has(o.id)) people.set(o.id, o.name);
  const auto = crewTags([...people.values()]);
  const tags = new Map([...people.keys()].map((id, i) => [id, auto[i]!] as const));
  const pxPerUnit = width ? width / lay.width : 1;
  return (
    <div
      ref={ref}
      className={["bank", `bank--${time}`, `bank--${mode}`, pickable && "bank--pickable", className].filter(Boolean).join(" ")}
      style={{ "--bank-aspect": lay.width / lay.height } as CSSProperties}
    >
      <svg
        viewBox={`0 0 ${lay.width} ${lay.height}`}
        className="bank__svg"
        {...(pickable ? { role: "group", "aria-label": title } : { role: "img", "aria-label": `${title}: ${lay.rooms.map((r) => nameOf(r.id)).join(", ")}` })}
      >
        <title>{title}</title>
        <defs>
          <filter id={`${uid}-wob`} x="-3%" y="-3%" width="106%" height="106%">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="5" />
            <feDisplacementMap in="SourceGraphic" scale={mode === "wide" ? 2.6 : 2.1} />
          </filter>
          <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--bank-sky-top)" />
            <stop offset="1" stopColor="var(--bank-sky-bottom)" />
          </linearGradient>
          <pattern id={`${uid}-brick`} width="24" height="12" patternUnits="userSpaceOnUse">
            <path d="M0 .6H24M0 6.6H24M8 .6V6.6M20 6.6V12.6" stroke="var(--art-brick-d)" strokeWidth="1.3" />
          </pattern>
          <pattern id={`${uid}-soil`} width="46" height="30" patternUnits="userSpaceOnUse">
            <ellipse cx="9" cy="8" rx="4" ry="2.6" fill="var(--art-earth-d)" />
            <ellipse cx="32" cy="21" rx="5" ry="3" fill="var(--art-earth-d)" />
            <circle cx="38" cy="6" r="1.6" fill="var(--art-earth-d)" />
            <circle cx="18" cy="24" r="1.3" fill="var(--art-earth-d)" />
          </pattern>
          <pattern id={`${uid}-tape`} width="22" height="18" patternUnits="userSpaceOnUse" patternTransform="skewX(-30)">
            <rect width="22" height="18" fill="var(--gold)" />
            <rect width="11" height="18" fill="var(--ink)" />
          </pattern>
          <pattern id={`${uid}-awning`} width="14" height="20" patternUnits="userSpaceOnUse">
            <rect width="14" height="20" fill="var(--paper-hi)" />
            <rect width="7" height="20" fill="var(--clay)" />
          </pattern>
          {(
            [
              ["siren-r", "var(--art-siren-r)", 0.6],
              ["siren-b", "var(--art-siren-b)", 0.6],
              ["glow", "var(--art-window-hi)", 0.7],
            ] as const
          ).map(([k, c, o]) => (
            <radialGradient key={k} id={`${uid}-${k}`}>
              <stop offset="0" stopColor={c} stopOpacity={o} />
              <stop offset="1" stopColor={c} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>

        <Sky layout={lay} uid={uid} time={time} />
        {tint > 0 && <rect width={lay.width} height={lay.streetY} fill="var(--art-siren-r)" opacity={tint * 0.3} className="bank-alarm" />}
        {scenery && mode === "wide" && <Scenery layout={lay} uid={uid} time={time} />}
        <g filter={`url(#${uid}-wob)`}>
          <Shell layout={lay} uid={uid} time={time} />
        </g>
        {lay.rooms.map((box) => (
          <Room
            key={box.id}
            box={box}
            name={nameOf(box.id)}
            uid={uid}
            labels={labels}
            selected={selected === box.id}
            closed={shut.has(box.id)}
            tapedLeft={taped[box.id]}
            pile={pile}
            occupants={occupants[box.id] ?? []}
            pick={onRoomSelect}
            figureScale={figureScale}
            tags={tags}
            nameTags={nameTags}
            pxPerUnit={pxPerUnit}
          />
        ))}
        {/* Parapets and cornice sit in front of the rooftop's props */}
        <g filter={`url(#${uid}-wob)`} pointerEvents="none">
          {[lay.shell.x0 - 8, lay.shell.x1 - 10].map((x) => (
            <g key={x}>
              <rect x={x} y={lay.roofY - 22} width="18" height="22" fill="var(--art-stone)" {...L} />
              <rect x={x - 3} y={lay.roofY - 26} width="24" height="6" rx="1.5" fill="var(--art-stone-d)" {...L} strokeWidth={1.6} />
            </g>
          ))}
        </g>
        {alarm >= 0.6 && (
          <g className="bank-sirens" pointerEvents="none">
            <circle cx={lay.width * 0.04} cy={lay.streetY - 10} r={lay.width * 0.12} fill={`url(#${uid}-siren-r)`} className="bank-siren bank-siren--r" />
            <circle cx={lay.width * 0.96} cy={lay.streetY - 10} r={lay.width * 0.12} fill={`url(#${uid}-siren-b)`} className="bank-siren bank-siren--b" />
          </g>
        )}
      </svg>
      {lay.rooms.map((box) => {
        const bell = bells[box.id];
        const at = roomBoxPercent(lay, box.id);
        if (!bell || !at || taped[box.id] !== undefined) return null;
        const wPx = box.w * pxPerUnit;
        const size = wPx < 200 ? "xs" : "md";
        // Beside the room's name when there is space for both, else under it, or on the room's top edge when a crowd fills the room.
        const crowded = roomSlots(box.w, box.h, occupants[box.id]?.length ?? 0, figureScale).some((s) => s.back);
        const nameEnd = labels ? (8 + tagWidth(nameOf(box.id), 15)) * pxPerUnit + 4 : 0;
        const beside = nameEnd + 6 + bellWidth({ bulbs, size, hidden: !!bell.hidden }) + 6 <= wPx;
        return (
          <div key={box.id} className={crowded ? "bank__ov bank__ov--over" : beside ? "bank__ov" : "bank__ov bank__ov--under"} data-bell={box.id} style={{ ...at, "--bell-top": `${Math.round(37 * pxPerUnit)}px` } as CSSProperties}>
            <AlarmBell bulbs={bulbs} lit={bell.lit} {...(bell.preview !== undefined && { preview: bell.preview })} {...(bell.hidden && { hidden: true })} size={size} />
          </div>
        );
      })}
    </div>
  );
}
