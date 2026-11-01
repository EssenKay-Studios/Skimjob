// Geometry of the bank cutaway (M2-9): where each room sits in the building
// for the rooms in play, in a wide (desktop/tablet) or stacked (phone) layout,
// and where crooks stand inside a room. Pure and deterministic, no React.
//
// The building is a side-view dollhouse: Rooftop on top, an upper floor
// (Security, Office, then Manager's office and Server room for bigger crews),
// the ground floor (Lobby, Teller line) and the basement (Vault, Deposit
// boxes) below street level. design §6, §18; ui-style "Bank cutaway".

/** The bank's rooms (ids as in `BANK_JOB.rooms`, packages/content/src/jobs.ts). */
export const BANK_ROOMS = [
  "rooftop",
  "security",
  "office",
  "managersOffice",
  "serverRoom",
  "lobby",
  "tellerLine",
  "vault",
  "depositBoxes",
] as const;
export type BankRoomId = (typeof BANK_ROOMS)[number];

/** Default labels; the game screen should pass the names from content. */
export const BANK_ROOM_NAMES: Record<BankRoomId, string> = {
  rooftop: "Rooftop",
  security: "Security",
  office: "Office",
  managersOffice: "Manager's office",
  serverRoom: "Server room",
  lobby: "Lobby",
  tellerLine: "Teller line",
  vault: "Vault",
  depositBoxes: "Deposit boxes",
};

export type FloorKind = "roof" | "upper" | "ground" | "basement";
export type BankLayoutMode = "wide" | "stacked";

/** Floor of each room, in left-to-right order, and its share of the row width. */
const FLOORS: readonly { kind: FloorKind; rooms: readonly [BankRoomId, number][] }[] = [
  { kind: "roof", rooms: [["rooftop", 1]] },
  {
    kind: "upper",
    rooms: [
      ["security", 1],
      ["office", 1.2],
      ["managersOffice", 1.2],
      ["serverRoom", 0.95],
    ],
  },
  {
    kind: "ground",
    rooms: [
      ["tellerLine", 1],
      ["lobby", 1.5],
    ],
  },
  {
    kind: "basement",
    rooms: [
      ["vault", 1.35],
      ["depositBoxes", 1],
    ],
  },
];

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface RoomBox extends Rect {
  readonly id: BankRoomId;
  readonly floor: FloorKind;
  /** Index of the storey (row) from the top, 0 = rooftop. */
  readonly row: number;
}

export interface Storey extends Rect {
  readonly floor: FloorKind;
  readonly rooms: readonly BankRoomId[];
}

export interface BankLayout {
  readonly mode: BankLayoutMode;
  /** viewBox size. */
  readonly width: number;
  readonly height: number;
  /** Outer face of the side walls. */
  readonly shell: { readonly x0: number; readonly x1: number; readonly wall: number };
  /** Street level (top of the ground-floor slab). */
  readonly streetY: number;
  /** Top of the roof slab (the rooftop's floor). */
  readonly roofY: number;
  /** Bottom of the foundations. */
  readonly footY: number;
  readonly slab: number;
  /** The roof slab is a deeper cornice (it carries the bank's name). */
  readonly roofSlab: number;
  readonly storeys: readonly Storey[];
  readonly rooms: readonly RoomBox[];
}

const DIM: Record<BankLayoutMode, { width: number; shellX: number; wall: number; gap: number; slab: number; roofSlab: number; sky: number; under: number; perRow: number; h: Record<FloorKind, number> }> = {
  wide: { width: 960, shellX: 70, wall: 18, gap: 10, slab: 14, roofSlab: 22, sky: 34, under: 34, perRow: 4, h: { roof: 118, upper: 150, ground: 162, basement: 150 } },
  stacked: { width: 400, shellX: 14, wall: 14, gap: 8, slab: 12, roofSlab: 20, sky: 30, under: 26, perRow: 2, h: { roof: 112, upper: 136, ground: 150, basement: 140 } },
};

/**
 * Lays out the rooms in play. Unknown ids are ignored; rooms keep the
 * building's order whatever order they're given in.
 */
export function bankLayout(inPlay: readonly string[], mode: BankLayoutMode): BankLayout {
  const d = DIM[mode];
  const set = new Set(inPlay);
  const x0 = d.shellX;
  const x1 = d.width - d.shellX;
  const innerX = x0 + d.wall;
  const innerW = x1 - d.wall - innerX;

  const storeys: Storey[] = [];
  const rooms: RoomBox[] = [];
  let y = d.sky;
  let streetY = 0;
  let roofY = 0;
  let row = 0;
  for (const floor of FLOORS) {
    const present = floor.rooms.filter(([id]) => set.has(id));
    if (present.length === 0 && floor.kind !== "roof") continue;
    const chunks: (typeof present)[] = [];
    for (let i = 0; i < present.length; i += d.perRow) chunks.push(present.slice(i, i + d.perRow));
    if (chunks.length === 0) chunks.push([]);
    for (const chunk of chunks) {
      const h = d.h[floor.kind];
      // The rooftop is open air over the whole roof; other storeys sit inside the walls.
      const rx = floor.kind === "roof" ? x0 + 4 : innerX;
      const rw = floor.kind === "roof" ? x1 - x0 - 8 : innerW;
      // Stacked rows are only two rooms wide: split them evenly.
      const weight = (wgt: number) => (mode === "stacked" ? 1 : wgt);
      const total = chunk.reduce((s, [, wgt]) => s + weight(wgt), 0);
      const free = rw - d.gap * Math.max(0, chunk.length - 1);
      let x = rx;
      chunk.forEach(([id, wgt], i) => {
        const w = i === chunk.length - 1 ? rx + rw - x : Math.round((free * weight(wgt)) / total);
        rooms.push({ id, floor: floor.kind, row, x, y, w, h });
        x += w + d.gap;
      });
      storeys.push({ floor: floor.kind, rooms: chunk.map(([id]) => id), x: rx, y, w: rw, h });
      y += h;
      if (floor.kind === "roof") roofY = y;
      y += floor.kind === "roof" ? d.roofSlab : d.slab;
      if (floor.kind === "ground") streetY = y - d.slab;
      row++;
    }
  }
  // No ground or basement rooms in play: the street is under the last storey.
  if (!streetY) streetY = y - d.slab;
  const footY = y;
  return {
    mode,
    width: d.width,
    height: footY + d.under,
    shell: { x0, x1, wall: d.wall },
    streetY,
    roofY,
    footY,
    slab: d.slab,
    roofSlab: d.roofSlab,
    storeys,
    rooms,
  };
}

/** The box of a room in the layout, if it's in play. */
export function roomBox(layout: BankLayout, id: string): RoomBox | undefined {
  return layout.rooms.find((r) => r.id === id);
}

/**
 * A room's box as percentages of the drawing, for placing HTML (avatars,
 * badges) over the SVG with `position: absolute` in a same-aspect wrapper.
 */
export function roomBoxPercent(layout: BankLayout, id: string): { left: string; top: string; width: string; height: string } | undefined {
  const r = roomBox(layout, id);
  if (!r) return undefined;
  const pc = (n: number, of: number) => `${Math.round((n / of) * 10000) / 100}%`;
  return { left: pc(r.x, layout.width), top: pc(r.y, layout.height), width: pc(r.w, layout.width), height: pc(r.h, layout.height) };
}

export interface Slot {
  /** Feet position, in the room's local units (0,0 = room top-left). */
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  /** Back-row figures are drawn first. */
  readonly back: boolean;
}

/** Figure width at scale 1 (body ≈ 48 units). */
const FIG_W = 50;

/**
 * Where `count` crooks stand in a w×h room: one row along the floor, spread
 * out and centred; a crowded room shrinks them a little, then adds a back row.
 * `size` scales the crooks (e.g. 1.3 for a small decorative drawing).
 */
export function roomSlots(w: number, h: number, count: number, size = 1): Slot[] {
  if (count <= 0) return [];
  const base = Math.min(0.86, (h * 0.5) / 72) * size;
  const room = (pad: number) => Math.max(FIG_W * base, w - pad * 2);
  let usable = room(14);
  const fit = (scale: number, gap: number) => Math.max(1, Math.floor((usable + gap) / (FIG_W * scale + gap)));
  let scale = base;
  let perRow = fit(scale, -12 * scale);
  if (perRow < count) {
    // Crowded: smaller crooks, closer to the walls, so their name tags keep room.
    scale = base * 0.86;
    usable = room(7);
    perRow = fit(scale, -14 * scale);
  }
  const rows = perRow >= count ? 1 : 2;
  const front = rows === 1 ? count : Math.ceil(count / 2);
  const back = count - front;
  const place = (n: number, s: number, y: number, isBack: boolean, offset: number): Slot[] => {
    if (n === 0) return [];
    const step = Math.min(FIG_W * s + 6, n > 1 ? (usable - FIG_W * s) / (n - 1) : 0);
    const span = step * (n - 1);
    const start = w / 2 - span / 2 + offset;
    return Array.from({ length: n }, (_, i) => ({ x: Math.round((start + i * step) * 10) / 10, y, scale: Math.round(s * 1000) / 1000, back: isBack }));
  };
  const floorY = h - 5;
  // The back row stands a little higher, so its faces show over the front row's hats.
  return [...place(back, scale * 0.9, Math.round(floorY - 12 - 22 * scale), true, (FIG_W * scale) / 4), ...place(front, scale, floorY, false, 0)];
}
