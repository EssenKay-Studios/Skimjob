// Scratch only (not committed): renders mockup fragments from the real kit.
import "../src/theme.css";
import "../src/components/components.css";
import "../src/components/game-kit.css";
import "../src/components/shell.css";
import "../src/art/art.css";
import "../src/components/bell.css";
import "../src/components/caseboard.css";
import { writeFileSync } from "node:fs";
import type { CSSProperties, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FrameArt, SketchDefs } from "../src/components/SketchFrame";
import { CrookAvatar } from "../src/art/Crook";
import { RoomIcon } from "../src/art/RoomIcon";
import { RoomInterior, ROOM_WALL } from "../src/art/rooms";
import { RaccoonNarrator } from "../src/art/Raccoon";
import { AlarmBell, WantedStars } from "../src/components/Bell";
import { Avatar } from "../src/components/Avatar";
import { ArrowBack, Clock, Coin, Door, Play } from "../src/components/icons";
import type { BankRoomId } from "../src/art/bankLayout";

const OUT = process.argv[2]!;

function Frame({ w, h, seed, tape, holes, fill, shadow, tilt, style, children, as = "div", boil }: {
  w: number; h: number; seed: string; tape?: boolean; holes?: boolean; fill?: string; shadow?: number; tilt?: number; style?: CSSProperties; children?: ReactNode; as?: "div" | "section"; boil?: boolean;
}) {
  const Tag = as;
  const vars = { ...(fill && { "--fr-fill": fill }), ...(tilt && { rotate: `${tilt}deg` }) } as CSSProperties;
  return (
    <Tag className={["sk-frame", holes && "sk-frame--holes"].filter(Boolean).join(" ")} style={{ width: w, height: h, boxSizing: "border-box", ...vars, ...style }}>
      <FrameArt w={w} h={h} seed={seed} shadow={shadow ?? 0.62} grain={!fill} boil={boil ?? false} />
      {tape && (
        <>
          <span className="sk-tape sk-tape--l" aria-hidden="true" />
          <span className="sk-tape sk-tape--r" aria-hidden="true" />
        </>
      )}
      {holes && <span className="sk-holes" aria-hidden="true" />}
      {children}
    </Tag>
  );
}

const HAND: CSSProperties = { fontFamily: "Pangolin, cursive" };
const wall = (id: BankRoomId) => ROOM_WALL[id] ?? "var(--sky-l, #cfe0ee)";

/* ---------- 1. The alibi pop-up ---------- */
const POP_ROOMS: { id: BankRoomId; name: string; note: string }[] = [
  { id: "rooftop", name: "Rooftop", note: "no coins" },
  { id: "security", name: "Security", note: "watched a room" },
  { id: "office", name: "Office", note: "2 coins" },
  { id: "lobby", name: "Lobby", note: "1 coin" },
  { id: "vault", name: "Vault", note: "raided" },
];

function RoomTile({ id, name, note, picked }: { id: BankRoomId; name: string; note: string; picked: boolean }) {
  const W = 163, H = 104;
  return (
    <button type="button" role="radio" aria-checked={picked} style={{ all: "unset", cursor: "pointer", display: "block" }}>
      <Frame w={W} h={H} seed={`tile-${id}`} shadow={picked ? 0.62 : 0.35} fill={picked ? "var(--clay-l)" : "var(--paper-hi)"} tilt={picked ? -1.5 : 0} boil={picked}>
        <div style={{ position: "absolute", left: 7, right: 7, top: 7, height: 58, borderRadius: "9px 11px 8px 10px", overflow: "hidden", border: "1.6px solid var(--ink)", background: wall(id) }}>
          <svg width="100%" height="100%" viewBox="0 0 150 58" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
            <RoomInterior id={id} w={150} h={58} uid={`p-${id}`} pile={0.6} />
          </svg>
          {id === "vault" && (
            <div style={{ position: "absolute", left: -6, right: -6, top: 22, height: 15, rotate: "-6deg", background: "repeating-linear-gradient(-45deg, var(--gold) 0 10px, var(--ink) 10px 15px)", border: "1.4px solid var(--ink)" }} />
          )}
        </div>
        <div style={{ position: "absolute", left: 10, right: 8, bottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <RoomIcon room={id} size={20} />
          <span style={{ ...HAND, fontSize: 17, lineHeight: 1, flex: 1 }}>{name}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink2)" }}>{note}</span>
        </div>
        {picked && (
          <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" style={{ position: "absolute", right: -8, top: -10, rotate: "10deg" }}>
            <circle cx="12" cy="12" r="10" fill="var(--clay)" stroke="var(--ink)" strokeWidth="1.8" />
            <path d="M7 12.5l3.2 3.2L17 8.6" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </Frame>
    </button>
  );
}

function Popup() {
  const W = 370, H = 596;
  return (
    <div style={{ width: 390, height: 844, position: "relative", overflow: "hidden", background: "var(--paper2)" }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, padding: 12, display: "flex", flexDirection: "column", gap: 10, filter: "blur(1.5px)" }}>
        <Frame w={366} h={58} seed="hud" shadow={0.4}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, height: "100%", padding: "0 14px" }}>
            <span style={{ ...HAND, fontSize: 17 }}>Round 3</span>
            <span className="bell" style={{ fontSize: 12 }}>Share 6</span>
            <span style={{ fontSize: 12 }}>Bank 41/64</span>
            <WantedStars stars={1} max={3} />
          </div>
        </Frame>
        <div style={{ height: 200, borderRadius: 18, border: "2px solid var(--ink)", background: "var(--art-wall-lobby)" }} />
      </div>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "radial-gradient(#f3ede06b 0%, #f3ede09e 60%, #d6c4aabf 100%)" }} />

      <section role="dialog" aria-modal="true" aria-labelledby="alibi-h" style={{ position: "absolute", left: 10, bottom: 16 }}>
        <Frame w={W} h={H} seed="alibi-sheet" tape holes tilt={-0.5}>
          <div style={{ position: "absolute", inset: "24px 18px 18px 30px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <RaccoonNarrator size={64} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--mute)" }}>Round 3 is over</div>
                <h2 id="alibi-h" style={{ ...HAND, margin: 0, fontWeight: 700, fontSize: 25, lineHeight: 1.1 }}>Psst. Where were you?</h2>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }} role="timer" aria-label="12 seconds left">
              <span className="btn__icon" style={{ width: 22, height: 22 }}><Clock /></span>
              <div style={{ flex: 1, height: 11, border: "1.4px solid var(--ink)", borderRadius: "4px 6px 3px 5px", background: "var(--paper2)", overflow: "hidden" }}>
                <div style={{ width: "62%", height: "100%", background: "repeating-linear-gradient(-55deg, #2a23204d 0 1px, transparent 1px 3px), var(--clay)" }} />
              </div>
              <b style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>0:12</b>
            </div>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.4, color: "var(--ink2)" }}>Tell the crew which room you were in. True or not, everyone sees it.</p>
            <div role="radiogroup" aria-label="Rooms in round 3" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 8px" }}>
              {POP_ROOMS.map((r) => <RoomTile key={r.id} {...r} picked={r.id === "office"} />)}
            </div>
            <button type="button" className="btn btn--primary btn--block" style={{ position: "relative", height: 48, isolation: "isolate" }}>
              <FrameArt w={322} h={48} seed="post" shadow={0.4} grain={false} />
              <span className="btn__icon"><Play /></span>
              <span>I was in the Office</span>
            </button>
          </div>
        </Frame>
      </section>
    </div>
  );
}

/* ---------- 2. The snapshot card ---------- */
type Kind = "said" | "fact";
interface P { name: string; seat: number; kind: Kind; bot?: boolean; mark?: "trust" | "liar"; really?: string }

type MarkKind = "trust" | "liar" | "clear";
function Mark({ mark, size = 14 }: { mark: MarkKind; size?: number }) {
  if (mark === "clear") return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 22 22" style={{ flex: "none" }}>
      <circle cx="11" cy="11" r="9.5" fill="var(--paper-hi)" stroke="var(--ink)" strokeWidth="1.6" />
      <path d="M6.8 11h8.4" stroke="var(--ink2)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 22 22" style={{ flex: "none" }}>
      <circle cx="11" cy="11" r="9.5" fill={mark === "trust" ? "var(--good)" : "var(--bad)"} stroke="var(--ink)" strokeWidth="1.6" />
      {mark === "trust"
        ? <path d="M6.5 11.5l3 3 6-7" fill="none" stroke="#fff7ee" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M7.5 7.5l7 7M14.5 7.5l-7 7" fill="none" stroke="#fff7ee" strokeWidth="2.6" strokeLinecap="round" />}
    </svg>
  );
}

function Who({ p, size, reveal = false }: { p: P; size: number; reveal?: boolean }) {
  const ring: CSSProperties = p.kind === "said" ? { outline: "1.6px dashed var(--ink)", outlineOffset: 2 } : { outline: "2.6px solid var(--ink)", outlineOffset: 1 };
  const how = p.kind === "said" ? "says they were here" : "no alibi: a fact, they were here";
  const mine = p.mark ? (p.mark === "trust" ? ". You marked them trusted" : ". You marked them a liar") : "";
  return (
    <button type="button" aria-label={`${p.name}${p.bot ? " (bot)" : ""}: ${how}${mine}. Tap to mark`} style={{ all: "unset", cursor: "pointer", position: "relative", display: "inline-flex", borderRadius: "50%", ...ring }}>
      <Avatar name={p.name} size={size} colour={`var(--crew-${p.seat + 1})`} title={p.name} />
      {!reveal && p.mark && <span style={{ position: "absolute", right: -6, bottom: -5, display: "inline-flex" }}><Mark mark={p.mark} size={13} /></span>}
      {reveal && p.kind === "said" && (
        <span style={{ position: "absolute", left: "50%", bottom: -9, translate: "-50% 0", rotate: p.really ? "-6deg" : "0deg", fontSize: 8, fontWeight: 800, letterSpacing: "0.04em", lineHeight: 1.25, padding: "0 3px", borderRadius: 3, border: "1.2px solid var(--ink)", background: p.really ? "var(--bad)" : "var(--paper-hi)", color: p.really ? "#fff7ee" : "var(--good)" }}>{p.really ? "LIE" : "TRUE"}</span>
      )}
    </button>
  );
}

interface Cell { id: BankRoomId; name: string; lit?: number; people?: P[]; raid?: boolean; tell?: boolean; flex?: number }
const ROWS: Cell[][] = [
  [{ id: "rooftop", name: "Rooftop", lit: 1, people: [{ name: "Eli", seat: 4, kind: "said" }, { name: "Lia", seat: 11, kind: "said", really: "Lobby" }] }],
  [
    { id: "security", name: "Security", lit: 0, people: [{ name: "Dev", seat: 3, kind: "fact", bot: true }, { name: "Fay", seat: 5, kind: "said" }] },
    { id: "office", name: "Office", lit: 4, flex: 1.45, people: [{ name: "You", seat: 0, kind: "said" }, { name: "Cleo", seat: 2, kind: "said", mark: "trust" }, { name: "Gus", seat: 6, kind: "said" }, { name: "Hana", seat: 7, kind: "said", really: "Lobby" }, { name: "Ivo", seat: 8, kind: "said", bot: true }] },
  ],
  [{ id: "lobby", name: "Lobby", lit: 2, tell: true }],
  [{ id: "vault", name: "Vault", raid: true, people: [{ name: "Ben", seat: 1, kind: "said", mark: "liar", really: "Office" }, { name: "Jo", seat: 9, kind: "said" }, { name: "Kai", seat: 10, kind: "fact" }] }],
];

function CellBox({ c, rowH, av, reveal = false }: { c: Cell; rowH: number; av: number; reveal?: boolean }) {
  const people = c.people ?? [];
  const really = reveal ? ROWS.flat().flatMap((x) => x.people ?? []).filter((q) => q.really === c.name) : [];
  return (
    <div style={{
      flex: c.flex ?? 1, minWidth: 0, height: rowH, position: "relative", overflow: "hidden", boxSizing: "border-box",
      padding: "4px 7px 8px", display: "flex", flexDirection: "column", justifyContent: "space-between",
      background: c.tell ? "var(--clay-l)" : wall(c.id),
      border: c.tell ? "2px dashed var(--clay-d)" : "1.6px solid var(--ink)",
      borderRadius: "8px 10px 7px 9px / 9px 7px 10px 8px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <RoomIcon room={c.id} size={14} />
        <span style={{ ...HAND, fontSize: 13, lineHeight: 1, flex: 1, minWidth: 0 }}>{c.name}</span>
        {c.raid ? (
          <span style={{ fontSize: 10, fontWeight: 700, padding: "0 5px", borderRadius: 4, background: "var(--bad)", color: "#fff7ee" }}>raided −3</span>
        ) : (
          <AlarmBell bulbs={5} lit={c.lit ?? 0} size="xs" />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: av + 6, paddingLeft: 4 }}>
        {reveal && really.length > 0 ? (
          <>
            {people.map((p) => <Who key={p.name} p={p} size={av} reveal />)}
            <span style={{ fontSize: 9, fontWeight: 800, color: "var(--bad)", marginLeft: 2 }}>really:</span>
            {really.map((p) => <span key={p.name} style={{ display: "inline-flex", borderRadius: "50%", outline: "2.4px solid var(--bad)", outlineOffset: 1 }}><Avatar name={p.name} size={av} colour={`var(--crew-${p.seat + 1})`} title={`${p.name} was really here`} /></span>)}
          </>
        ) : reveal ? people.map((p) => <Who key={p.name} p={p} size={av} reveal />) : c.tell ? (
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: "var(--clay-d)" }}>
            <span style={{ width: 15, height: 15, display: "inline-flex" }} aria-hidden="true"><Door /></span>
            rang, nobody says they were here
          </span>
        ) : people.map((p) => <Who key={p.name} p={p} size={av} />)}
      </div>
      {c.raid && (
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 5, background: "repeating-linear-gradient(-45deg, var(--gold) 0 7px, var(--ink) 7px 10px)" }} />
      )}
    </div>
  );
}

function SnapshotCard({ w, rowH = 58, av = 22, title = "Round 3, as the crew tells it", reveal = false, kicker = "After the alibis" }: { w: number; rowH?: number; av?: number; title?: string; reveal?: boolean; kicker?: string }) {
  const h = ROWS.length * rowH + 112;
  return (
    <Frame w={w} h={h} seed={`snap-${w}`} tape tilt={-0.4} as="section">
      <div style={{ position: "absolute", inset: "16px 12px 12px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--mute)" }}>{kicker}</div>
            <h3 style={{ ...HAND, margin: 0, fontWeight: 700, fontSize: 17, lineHeight: 1.05 }}>{title}</h3>
          </div>
          <span style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 7px 2px 4px", background: "var(--gold)", border: "1.5px solid var(--ink)", borderRadius: "7px 9px 6px 8px", rotate: "2deg", fontSize: 10.5, fontWeight: 700 }}>
            <span style={{ width: 16, height: 16, display: "inline-flex" }} aria-hidden="true"><Coin /></span>
            Shift change: Vault +2
          </span>
        </div>
        {ROWS.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 5 }}>
            {row.map((c) => <CellBox key={c.id} c={c} rowH={rowH} av={av} reveal={reveal} />)}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 4, fontSize: 11.5 }}>
          <svg width="26" height="20" viewBox="0 0 50 40" aria-hidden="true"><path d="M14 12c0-6 22-6 22 0" fill="none" stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round" /><path d="M5 16c0-3 3-5 6-5h28c3 0 6 2 6 5l1 16c0 3-2 5-5 5H9c-3 0-5-2-5-5z" fill="var(--olive)" stroke="var(--ink)" strokeWidth="2.2" /><path d="M30 25l9 9M39 25l-9 9" stroke="#fff7ee" strokeWidth="2.6" strokeLinecap="round" /></svg>
          <span><b>4 coins</b> never reached the duffel</span>
        </div>
      </div>
    </Frame>
  );
}

function Legend({ open = false }: { open?: boolean }) {
  const G = 16;
  const ring = (border: string) => <span style={{ width: G, height: G, boxSizing: "border-box", borderRadius: "50%", border, background: "var(--paper-hi)", flex: "none" }} />;
  const it: CSSProperties = { display: "flex", alignItems: "center", gap: 6, flex: 1 };
  const row: CSSProperties = { display: "flex", gap: 12 };
  return (
    <details open={open} style={{ fontSize: 12, lineHeight: 1.35, color: "var(--ink2)", border: "1.6px solid var(--ink)", borderRadius: "10px 12px 9px 11px", background: "var(--paper-hi)", padding: "0 12px" }}>
      <summary className="key-sum" style={{ ...HAND, fontSize: 15, color: "var(--ink)", minHeight: 44, display: "flex", alignItems: "center", cursor: "pointer", listStyle: "none" }}>
        <span style={{ flex: 1 }}>How to read the card</span>
        <svg className="key-chev" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M7.4 4.4c2.4 1.8 4.4 3.6 6.2 5.6-1.8 2-3.8 3.8-6.2 5.6" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 0 10px" }}>
        <div style={row}>
          <span style={it}>{ring("1.8px dashed var(--ink)")}says (their alibi)</span>
          <span style={it}>{ring("2.6px solid var(--ink)")}no alibi: a fact</span>
        </div>
        <div style={row}>
          <span style={it}><Mark mark="trust" size={G} />you trust them</span>
          <span style={it}><Mark mark="liar" size={G} />you think they lied</span>
        </div>
        <span>Tap a crook to mark them Trusted or Liar. Only you see your marks, and they go in your case board.</span>
      </div>
    </details>
  );
}

function Hud({ w, big }: { w: number; big?: boolean }) {
  return (
    <Frame w={w} h={58} seed={`hud-${w}`} shadow={0.4} as="div">
      <div style={{ display: "flex", alignItems: "center", gap: big ? 30 : 11, height: "100%", padding: "0 12px", fontSize: 12, fontWeight: 600, color: "var(--mute)" }}>
        <span style={{ ...HAND, fontSize: big ? 19 : 17, color: "var(--ink)", fontWeight: 700 }}>Round 4{big ? " · Pick your room" : ""}</span>
        <span>Share <b style={{ color: "var(--ink)", fontSize: 15 }}>6</b></span>
        <span>Bank <b style={{ color: "var(--ink)", fontSize: 16 }}>35</b>/64</span>
        <WantedStars stars={2} max={3} />
        <Honesty w={big ? 200 : 64} label={big} />
      </div>
    </Frame>
  );
}

function Honesty({ w, label }: { w: number; label?: boolean }) {
  return (
    <span role="meter" aria-label="Honesty: 82% of coins taken reached the duffel; the heist fails below 67%" aria-valuenow={82} aria-valuemin={0} aria-valuemax={100} style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
      {label && <span>Honesty</span>}
      <span style={{ position: "relative", width: w, height: 12, border: "1.5px solid var(--ink)", borderRadius: "4px 6px 3px 5px", background: "var(--bad-l, #f2d3cc)", overflow: "visible" }}>
        <span style={{ position: "absolute", inset: 0, width: "82%", background: "repeating-linear-gradient(-55deg, #2a23204d 0 1px, transparent 1px 3px), var(--good)", borderRadius: "3px 0 0 3px" }} />
        <span aria-hidden="true" style={{ position: "absolute", left: "66.7%", top: -4, bottom: -4, width: 2, background: "var(--ink)" }} />
      </span>
      <b style={{ color: "var(--ink)", fontSize: 13 }}>82%</b>
    </span>
  );
}

function MoveStub({ w }: { w: number; h?: number }) {
  return (
    <div style={{ width: w, minHeight: 48, boxSizing: "border-box", border: "1.6px dashed var(--mute)", borderRadius: "10px 12px 9px 11px", display: "flex", alignItems: "center", gap: 8, padding: "0 14px", color: "var(--mute)", fontSize: 12, fontWeight: 600 }}>
      <span style={{ ...HAND, fontSize: 15, color: "var(--ink2)" }}>Your move</span>
      placeholder: the move panel, unchanged
    </div>
  );
}

function MarkPopover({ name, state, left, top }: { name: string; state: "none" | "trust" | "liar"; left: number; top: number }) {
  const opts: [MarkKind, string][] = state === "none" ? [["trust", "trusted"], ["liar", "a liar"]] : state === "trust" ? [["clear", "clear the mark"], ["liar", "a liar"]] : [["trust", "trusted"], ["clear", "clear the mark"]];
  return (
    <div role="dialog" aria-label={`Mark ${name}`} style={{ position: "absolute", left, top, zIndex: 5, display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
      <span style={{ ...HAND, fontSize: 15, lineHeight: 1.3, padding: "0 8px", background: "color-mix(in srgb, var(--gold) 30%, var(--paper))", border: "1.6px solid var(--ink)", borderRadius: 10 }}>{name}</span>
      <div style={{ display: "flex", marginTop: -6 }}>
        {opts.map(([m, label]) => (
          <button key={m} type="button" aria-label={m === "clear" ? `Clear ${name}'s mark` : `Mark ${name} ${label}`} style={{ all: "unset", cursor: "pointer", width: 44, height: 44, display: "grid", placeItems: "center", filter: "drop-shadow(1.5px 2px 0 #2a232055)" }}>
            <Mark mark={m} size={22} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Phone() {
  return (
    <div style={{ width: 390, height: 844, boxSizing: "border-box", padding: 12, display: "flex", flexDirection: "column", gap: 14, background: "var(--paper2)" }}>
      <Hud w={366} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ ...HAND, fontSize: 20, fontWeight: 700 }}>This round</span>
      </div>
      <div style={{ position: "relative" }}>
        <SnapshotCard w={366} title="Round 3, as told" />
        <MarkPopover name="Hana" state="none" left={216} top={172} />
      </div>
      <Legend />
      <MoveStub w={366} h={150} />
    </div>
  );
}

function CaseBoard() {
  const tabs = ["Crew", "Case", "Notes", "Chat"];
  return (
    <div style={{ width: 390, height: 844, boxSizing: "border-box", padding: 12, display: "flex", flexDirection: "column", gap: 12, background: "var(--paper2)" }}>
      <Hud w={366} />
      <div role="tablist" aria-label="Game panels" style={{ display: "flex", gap: 6 }}>
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === "Case"} style={{ all: "unset", cursor: "pointer", flex: 1, minHeight: 44, display: "grid", placeItems: "center", fontFamily: "Pangolin, cursive", fontSize: 16, border: "1.8px solid var(--ink)", borderRadius: "10px 12px 9px 11px", background: t === "Case" ? "var(--clay)" : "var(--paper-hi)", rotate: t === "Case" ? "-1deg" : "0deg" }}>{t}</button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h2 className="cb__heading" style={{ margin: 0, ...HAND, fontSize: 22 }}>Case board</h2>
        <span style={{ fontSize: 12, color: "var(--mute)", fontWeight: 600 }}>every round's snapshot</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ ...HAND, fontSize: 16, marginRight: 2 }}>Round:</span>
        <div role="tablist" aria-label="Round" style={{ display: "flex", gap: 6 }}>
          {[1, 2, 3, 4].map((r) => (
            <button key={r} type="button" role="tab" aria-selected={r === 3} aria-label={r === 4 ? "Round 4, not played yet" : `Round ${r}`} disabled={r === 4} style={{ all: "unset", cursor: r === 4 ? "default" : "pointer", width: 44, height: 44, display: "grid", placeItems: "center", boxSizing: "border-box", fontWeight: 700, fontSize: 15, border: r === 4 ? "1.6px dashed var(--mute)" : "1.6px solid var(--ink)", color: r === 4 ? "var(--mute)" : "var(--ink)", borderRadius: "10px 12px 9px 11px", background: r === 3 ? "var(--gold)" : r === 4 ? "transparent" : "var(--paper-hi)", rotate: r === 3 ? "-3deg" : "0deg" }}>{r}</button>
          ))}
        </div>
      </div>
      <div style={{ position: "relative" }}>
        <SnapshotCard w={366} title="Round 3" />
        <MarkPopover name="Ben" state="liar" left={4} top={298} />
      </div>
      <Legend />
      <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.4 }}>
        <b style={{ ...HAND, fontSize: 16, fontWeight: 700, display: "block", color: "var(--ink)" }}>Leads</b>
        Seen elsewhere, Not seen and Too quiet stay, built from the alibis.
        <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          <li style={{ display: "flex", alignItems: "center", gap: 6 }}><Mark mark="liar" /><span><b>Your mark:</b> Ben lied about the Vault, round 3</span></li>
          <li style={{ display: "flex", alignItems: "center", gap: 6 }}><Mark mark="trust" /><span><b>Your mark:</b> you trust Cleo's Office, round 3</span></li>
          <li style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 9.5, fontWeight: 700, padding: "0 5px", borderRadius: 4, background: "var(--ink)", color: "#fff7ee" }}>FACT</span><span>Kai had no alibi: in the Vault, round 3</span></li>
        </ul>
      </div>
    </div>
  );
}

function Reveal() {
  return (
    <div style={{ width: 390, height: 844, boxSizing: "border-box", padding: 12, display: "flex", flexDirection: "column", gap: 12, background: "var(--paper2)" }}>
      <Frame w={366} h={58} seed="rv-hud" shadow={0.4}>
        <div style={{ display: "flex", alignItems: "center", height: "100%", padding: "0 14px", gap: 10 }}>
          <span style={{ ...HAND, fontSize: 18, fontWeight: 700 }}>The reveal</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mute)" }}>game over · scrub the rounds</span>
        </div>
      </Frame>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ ...HAND, fontSize: 16, marginRight: 2 }}>Round:</span>
        {[1, 2, 3, 4, 5, 6].map((r) => (
          <button key={r} type="button" aria-pressed={r === 3} style={{ all: "unset", cursor: "pointer", width: 44, height: 44, display: "grid", placeItems: "center", boxSizing: "border-box", fontWeight: 700, fontSize: 15, border: "1.6px solid var(--ink)", borderRadius: "10px 12px 9px 11px", background: r === 3 ? "var(--gold)" : "var(--paper-hi)", rotate: r === 3 ? "-3deg" : "0deg" }}>{r}</button>
        ))}
      </div>
      <SnapshotCard w={366} av={20} title="Round 3, the truth" kicker="Every alibi, checked" reveal />
      <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--ink2)", display: "flex", flexDirection: "column", gap: 4 }}>
        <b style={{ ...HAND, fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>Lies in round 3</b>
        <span>Ben said Vault, was in the Office. <i>You had marked him a liar.</i></span>
        <span>Lia and Hana said Rooftop and Office, were in the Lobby.</span>
      </div>
    </div>
  );
}

function Laptop() {
  return (
    <div style={{ width: 1280, height: 800, boxSizing: "border-box", padding: 14, display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 420px", gridTemplateRows: "58px minmax(0, 1fr)", gap: 16, background: "var(--paper2)" }}>
      <div style={{ gridColumn: "1 / -1" }}><Hud w={1252} big /></div>
      <Frame w={280} h={698} seed="crew" shadow={0.4}>
        <div style={{ position: "absolute", inset: 14, display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5, color: "var(--mute)", fontWeight: 600 }}>
          <span style={{ ...HAND, fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>Crew · Case · Chat</span>
          Left column unchanged.
        </div>
      </Frame>
      <div style={{ borderRadius: 18, border: "2px dashed var(--mute)", display: "grid", placeItems: "center", color: "var(--mute)", fontWeight: 600, fontSize: 13 }}>The bank cutaway for picking your room, unchanged</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={{ ...HAND, fontSize: 20, fontWeight: 700 }}>This round</span>
        <div style={{ position: "relative" }}>
          <SnapshotCard w={420} rowH={62} av={24} />
          <MarkPopover name="Cleo" state="trust" left={186} top={178} />
        </div>
        <Legend open />
        <MoveStub w={420} h={190} />
      </div>
    </div>
  );
}

const html = (node: ReactNode) => renderToStaticMarkup(<>{node}</>);
writeFileSync(`${OUT}/popup.html`, html(<><SketchDefs /><Popup /></>));
writeFileSync(`${OUT}/phone.html`, html(<><SketchDefs /><Phone /></>));
writeFileSync(`${OUT}/case.html`, html(<><SketchDefs /><CaseBoard /></>));
writeFileSync(`${OUT}/reveal.html`, html(<><SketchDefs /><Reveal /></>));
writeFileSync(`${OUT}/laptop.html`, html(<><SketchDefs /><Laptop /></>));
