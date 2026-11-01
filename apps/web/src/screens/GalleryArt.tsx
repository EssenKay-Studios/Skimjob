// /dev/gallery: the M2-9 art (bank cutaway, room icons, crooks, spots), live.
import { useState, type ReactNode } from "react";
import { Segmented } from "../components/Segmented";
import { SketchFrame } from "../components/SketchFrame";
import { Underline } from "../components/Underline";
import { BankCutaway, CORE_ROOMS, type BankOccupant, type TimeOfDay } from "../art/BankCutaway";
import { BANK_ROOMS, BANK_ROOM_NAMES, type BankRoomId } from "../art/bankLayout";
import { CrookAvatar, CrookSvg } from "../art/Crook";
import { EXPRESSIONS } from "../art/crook";
import { RoomIcon } from "../art/RoomIcon";
import { BustedSpot, EmptyFileSpot, JobDoneSpot, WaitingSpot } from "../art/Spots";
import "./gallery-art.css";

const CREW_NAMES = ["Mara", "Dez", "Lou", "Priya", "Otto", "Sam", "Ines", "Kofi", "Wren", "Bea", "Juno", "Tam"];

const TIERS = {
  small: CORE_ROOMS,
  mid: [...CORE_ROOMS, "depositBoxes", "serverRoom"],
  big: BANK_ROOMS,
} as const;

export function ArtSection({ id, title, note, wide, children }: { id: string; title: string; note?: string; wide?: boolean; children: ReactNode }) {
  return (
    <SketchFrame as="section" seed={`g-${id}`} radius={16} shadow={0.5} className={wide ? "g-section g-section--wide" : "g-section"} aria-labelledby={`g-${id}`}>
      <header className="g-section__head">
        <h3 id={`g-${id}`}>
          <Underline seed={id}>{title}</Underline>
        </h3>
        {note && <p className="meta">{note}</p>}
      </header>
      {children}
    </SketchFrame>
  );
}

/** The cutaway with its knobs: crew size, time, layout, Heat, Lockdown. */
export function BankSection() {
  const [tier, setTier] = useState<keyof typeof TIERS>("big");
  const [time, setTime] = useState<TimeOfDay>("day");
  const [layout, setLayout] = useState<"auto" | "wide" | "stacked">("auto");
  const [hot, setHot] = useState<"calm" | "hot">("calm");
  const [lock, setLock] = useState<"open" | "lockdown">("open");
  const [room, setRoom] = useState<BankRoomId | null>("vault");
  const rooms: readonly string[] = TIERS[tier];
  const crew = (seat: number, extra: Partial<BankOccupant> = {}): BankOccupant => ({ id: `p${seat}`, name: CREW_NAMES[seat]!, look: seat, ...extra });
  const occupants: Partial<Record<string, BankOccupant[]>> = {
    vault: [crew(0, { expression: "smug", sack: true }), crew(3, { expression: "nervous" })],
    lobby: [crew(1), crew(5, { bot: true }), crew(2, { ghost: true })],
    rooftop: [crew(4, { expression: "neutral" })],
    ...(rooms.includes("serverRoom") && { serverRoom: [crew(6, { bot: true, expression: "smug" })] }),
    ...(rooms.includes("tellerLine") && { tellerLine: [crew(7), crew(8, { expression: "caught" })] }),
    ...(rooms.includes("managersOffice") && { managersOffice: [crew(9), crew(10, { expression: "smug" }), crew(11, { bot: true })] }),
  };
  return (
    <ArtSection id="bank" title="Bank cutaway" note="M2-9 · tap a room to select it · dashed crook = an alibi claim · Lockdown rooms can't be picked" wide>
      <div className="g-knobs">
        <Segmented
          seed="g-tier"
          label="Crew size"
          options={[
            { value: "small", label: "2–4" },
            { value: "mid", label: "5–8" },
            { value: "big", label: "9–12" },
          ]}
          value={tier}
          onChange={setTier}
        />
        <Segmented
          seed="g-time"
          label="Time"
          options={[
            { value: "day", label: "Day" },
            { value: "dusk", label: "Dusk" },
            { value: "night", label: "Night" },
          ]}
          value={time}
          onChange={setTime}
        />
        <Segmented
          seed="g-layout"
          label="Layout"
          options={[
            { value: "auto", label: "Auto" },
            { value: "wide", label: "Wide" },
            { value: "stacked", label: "Stacked" },
          ]}
          value={layout}
          onChange={setLayout}
        />
        <Segmented
          seed="g-heat"
          label="Heat"
          options={[
            { value: "calm", label: "12" },
            { value: "hot", label: "88" },
          ]}
          value={hot}
          onChange={setHot}
        />
        <Segmented
          seed="g-lock"
          label="Event"
          options={[
            { value: "open", label: "None" },
            { value: "lockdown", label: "Lockdown" },
          ]}
          value={lock}
          onChange={setLock}
        />
      </div>
      <div className="g-bank">
        <BankCutaway
          rooms={rooms}
          layout={layout}
          time={time}
          heat={hot === "hot" ? 88 : 12}
          selected={room}
          onRoomSelect={(r) => setRoom((cur) => (cur === r ? null : r))}
          closed={lock === "lockdown" ? ["office"] : []}
          occupants={occupants}
        />
      </div>
      <p className="meta">Selected: {room ? BANK_ROOM_NAMES[room] : "none"}</p>
    </ArtSection>
  );
}

/** Room icons, crooks and spot art. */
export function ArtSections() {
  return (
    <>
      <ArtSection id="room-icons" title="Room icons" note="24-unit ink glyphs · on a colour blob for pickers">
        <div className="g-room-icons">
          {BANK_ROOMS.map((r, i) => (
            <figure key={r} className="g-room-icon">
              <span className="g-room-icon__blob" style={{ background: `color-mix(in srgb, var(--crew-${(i % 12) + 1}) 38%, var(--paper))` }}>
                <RoomIcon room={r} size={34} title={BANK_ROOM_NAMES[r]} />
              </span>
              <figcaption className="meta">{BANK_ROOM_NAMES[r]}</figcaption>
            </figure>
          ))}
        </div>
        <div className="g-row g-row--center">
          {BANK_ROOMS.map((r) => (
            <RoomIcon key={r} room={r} size={20} />
          ))}
          <span className="meta">20 px</span>
        </div>
      </ArtSection>

      <ArtSection id="crooks" title="Crook avatars" note="12 seats: 12 colours and 12 hat shapes (tell apart without colour) · initials tag · bot badge + antenna">
        <div className="g-crew">
          {CREW_NAMES.map((n, i) => (
            <figure key={n} className="g-crew__seat">
              <CrookAvatar name={n} look={i} size={48} bot={i === 5 || i === 11} />
              <figcaption className="meta">{n}</figcaption>
            </figure>
          ))}
        </div>
        <div className="g-row g-row--center">
          {EXPRESSIONS.map((e) => (
            <figure key={e} className="g-crew__seat">
              <CrookAvatar name="Mara" look={0} expression={e} size={60} />
              <figcaption className="meta">{e}</figcaption>
            </figure>
          ))}
        </div>
        <div className="g-row g-row--center">
          <CrookAvatar name="Dez" look={1} size={28} />
          <CrookAvatar name="Dez" look={1} size={36} status="ready" />
          <CrookAvatar name="Dez" look={1} size={44} status="away" />
          <CrookAvatar name="Bot Opportunist" look="Bot Opportunist" size={44} bot expression="smug" />
          <span className="meta">28 · 36 ready · 44 away · seeded bot</span>
        </div>
      </ArtSection>

      <ArtSection id="figures" title="Crook figures" note="for the cutaway · name tag · sack · claimed (ghost, in the claimant's colour)">
        <div className="g-row g-row--center g-figures">
          {EXPRESSIONS.map((e, i) => (
            <CrookSvg key={e} name={`${CREW_NAMES[i]}`} look={i} expression={e} size={84} tag={CREW_NAMES[i]!.slice(0, 2)} />
          ))}
          <CrookSvg name="Otto with the loot" look={4} expression="smug" sack size={84} tag="Ot" />
          <CrookSvg name="Sam (bot)" look={5} bot size={84} tag="Sa" />
          <CrookSvg name="Ines, claimed" look={6} ghost size={84} tag="In" />
        </div>
      </ArtSection>

      <ArtSection id="spots" title="Spot illustrations" note="empty states · game over: job done / busted">
        <div className="g-spots">
          <figure>
            <WaitingSpot />
            <figcaption className="meta">Waiting for the crew</figcaption>
          </figure>
          <figure>
            <EmptyFileSpot />
            <figcaption className="meta">Nothing in the case file yet</figcaption>
          </figure>
          <figure>
            <JobDoneSpot />
            <figcaption className="meta">Job done (win)</figcaption>
          </figure>
          <figure>
            <BustedSpot />
            <figcaption className="meta">Busted (lose)</figcaption>
          </figure>
        </div>
      </ArtSection>
    </>
  );
}
