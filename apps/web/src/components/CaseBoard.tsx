// The case board (design §15.4): the suspect card, the Players strip (tap a seat
// for the leads that name them and your private note on them, §15.3), your pins,
// a round picker (a round's snapshot card and its leads, design §10) and one
// Leads list, newest first. It only draws what the adapter
// (game/caseLeads.ts) gave it; pins are private to the seat. Few words, "i" InfoTips.
import { useId, useMemo, useState, type ReactNode } from "react";
import type { PlayerId } from "@skimjob/engine";
import { CrookAvatar } from "../art/Crook";
import { leadsNaming, newestFirst, pinnedItems, playerStat, TRUST_LABELS, type CaseData, type Fact, type Lead } from "../game/caseBoard";
import type { BoardChannel, PinsChannel } from "../game/notes";
import { Button } from "./Button";
import { InfoTip } from "./InfoTip";
import { Bell, Lock, Pin, Warn } from "./icons";
import { SeatNote } from "./SeatNote";
import { SketchFrame } from "./SketchFrame";
import { Underline } from "./Underline";
import "./caseboard.css";

interface BoardPerson {
  readonly id: PlayerId;
  readonly name: string;
  readonly look: number;
  readonly tag?: string | undefined;
  readonly isBot: boolean;
}

export interface CaseBoardProps {
  readonly data: CaseData;
  /** Everyone but you. */
  readonly people: readonly BoardPerson[];
  readonly pins: PinsChannel;
  /** Your private notes on the others (design §15.3). */
  readonly board: BoardChannel;
  /** The picked round's snapshot card (components/SnapshotCard.tsx), drawn above its leads. */
  readonly card?: (round: number) => ReactNode;
  readonly seed?: string;
}

export function CaseBoard({ data, people, pins, board, card, seed = "case" }: CaseBoardProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [who, setWho] = useState<PlayerId | null>(null);
  const [round, setRound] = useState<number | null>(null);
  const toggleOpen = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const selected = people.find((p) => p.id === who) ?? null;
  const leads = useMemo(() => {
    const all = selected ? leadsNaming(data.leads, selected.id) : newestFirst(data.leads);
    return round === null ? all : all.filter((l) => l.round === round);
  }, [data.leads, selected, round]);
  const pinned = useMemo(() => pinnedItems(data.leads, pins.pins), [data.leads, pins.pins]);
  const suspect = data.suspect && people.find((p) => p.id === data.suspect!.player);
  const uid = useId();
  const row = { open, onOpen: toggleOpen, pins, uid };
  return (
    <SketchFrame as="section" seed={`${seed}-board`} radius={16} shadow={0.45} fill="var(--manilla)" tape holes className="panel cb" aria-label="Case board">
      <h2 className="cb__heading">
        <Underline seed={`${seed}-heading`}>Case board</Underline>
      </h2>
      <div className="cb__card" aria-label="Most likely liar">
        <div className="cb__kicker">
          <span className="cb__icon" aria-hidden="true">
            <Warn />
          </span>
          <span className="cb__kicker-text">Most likely liar · {pinned.length >= 2 ? `from ${pinned.length} pins` : "from all leads"}</span>
          <InfoTip info={{ kind: "tip", id: "suspect" }} />
        </div>
        {data.suspect ? (
          <div className="cb__suspect">
            {suspect && <CrookAvatar name={suspect.name} look={suspect.look} tag={suspect.tag} size={44} bot={suspect.isBot} expression="nervous" />}
            <div>
              <p className="cb__who">{suspect?.name ?? data.suspect.player}</p>
              <p>{data.suspect.reason}</p>
            </div>
          </div>
        ) : (
          <p className="meta">Nobody yet.</p>
        )}
      </div>

      <div>
        <h3 className="cb__h">Players</h3>
        <ul className="cb__players" aria-label="Players">
          {people.map((p) => {
            const stat = playerStat(data.leads, pins.pins, p.id);
            return (
              <li key={p.id}>
                <button type="button" className="cb__player" aria-pressed={who === p.id} aria-label={`${p.name}, ${stat.warnings} warnings, ${stat.pins} pins`} onClick={() => setWho(who === p.id ? null : p.id)}>
                  <CrookAvatar name={p.name} look={p.look} tag={p.tag} size={36} bot={p.isBot} />
                  <span className="cb__pname">{p.name}</span>
                  {(stat.warnings > 0 || stat.pins > 0) && (
                    <span className="cb__counts" aria-hidden="true">
                      {stat.warnings > 0 && (
                        <span className="cb__warn">
                          <Warn />
                          {stat.warnings}
                        </span>
                      )}
                      {stat.pins > 0 && (
                        <span className="cb__pinct">
                          <Pin on />
                          {stat.pins}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {selected && <SeatNote key={selected.id} person={selected} board={board} seed={`${seed}-note-${selected.id}`} />}

      {pins.error && (
        <p className="cb__error" role="alert">
          {pins.error}
        </p>
      )}

      {pinned.length > 0 && (
        <div className="cb__group" role="group" aria-label="Pinned">
          <h3 className="cb__h">
            Pinned
            <InfoTip info={{ kind: "tip", id: "pins" }} />
            <span className="meta cb__private">
              <span className="cb__lock" aria-hidden="true">
                <Lock />
              </span>
              Only you
            </span>
          </h3>
          <ul className="cb__list cb__card-list">
            {pinned.map(({ lead, fact }) => (
              <li key={fact?.id ?? lead.id} className="cb__pinned">
                <p>
                  <span className="cb__round">R{lead.round}</span> {fact && <span className="cb__trust">{TRUST_LABELS[fact.trust]}</span>} {fact ? fact.text : lead.title}
                  {fact && <span className="meta"> · {lead.title}</span>}
                </p>
                <PinButton pins={pins} id={fact?.id ?? lead.id} label={fact ? fact.text : lead.title} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="cb__picker" role="group" aria-label="Round">
        <span className="cb__h">Round:</span>
        {Array.from({ length: data.roundCap }, (_, i) => i + 1).map((r) => (
          <button key={r} type="button" className="cb__rbtn num" aria-pressed={round === r} disabled={r > data.played} onClick={() => setRound(round === r ? null : r)}>
            {r}
          </button>
        ))}
      </div>
      {round !== null && card?.(round)}

      <div className="cb__group" role="group" aria-label="Leads">
        <h3 className="cb__h">
          Leads
          <InfoTip info={{ kind: "tip", id: "leads" }} />
        </h3>
        {selected && (
          <p className="cb__filter">
            <span>
              About <b>{selected.name}</b>
            </span>
            <Button variant="ghost" onClick={() => setWho(null)}>
              All leads
            </Button>
          </p>
        )}
        {leads.length === 0 ? (
          <p className="meta">{selected ? "Nothing about them yet." : round !== null ? `Nothing in round ${round}.` : "Nothing yet."}</p>
        ) : (
          <ul className="cb__list cb__card-list">
            {leads.map((l) => (
              <LeadRow key={l.id} lead={l} {...row} />
            ))}
          </ul>
        )}
      </div>
    </SketchFrame>
  );
}

function PinButton({ pins, id, label }: { pins: PinsChannel; id: string; label: string }) {
  const on = pins.pins.has(id);
  return (
    <button type="button" className={on ? "cb__pin is-on" : "cb__pin"} aria-pressed={on} aria-label={`${on ? "Unpin" : "Pin"}: ${label}`} disabled={!pins.ready} onClick={() => pins.toggle(id)}>
      <Pin on={on} />
    </button>
  );
}

interface RowProps {
  readonly open: ReadonlySet<string>;
  readonly onOpen: (id: string) => void;
  readonly pins: PinsChannel;
  /** Keeps element ids unique when the board is drawn more than once. */
  readonly uid: string;
}

function LeadRow({ lead, open, onOpen, pins, uid }: RowProps & { lead: Lead }) {
  const isOpen = open.has(lead.id);
  const panel = `${uid}-${lead.id}-facts`;
  return (
    <li className={lead.warnings.length ? "cb__lead has-warning" : "cb__lead"}>
      <div className="cb__lead-head">
        <button type="button" className="cb__lead-btn" aria-expanded={isOpen} aria-controls={panel} onClick={() => onOpen(lead.id)}>
          <span className="cb__round">R{lead.round}</span>
          <span className="cb__lead-text">
            <span className="cb__line">
              <span className="cb__title">{lead.title}</span>
              {lead.warnings.length > 0 && (
                <span className="cb__icon" role="img" aria-label="Doesn't add up">
                  <Warn />
                </span>
              )}
              {lead.bell && (
                <span className="cb__icon" role="img" aria-label="Bell rang">
                  <Bell />
                </span>
              )}
            </span>
            {lead.summary && <span className="cb__summary">{lead.summary}</span>}
          </span>
        </button>
        <PinButton pins={pins} id={lead.id} label={lead.title} />
      </div>
      {isOpen && (
        <ul id={panel} className="cb__facts">
          {lead.warnings.map((w, i) => (
            <li key={`${w.kind}-${i}`} className="cb__fact is-warning">
              <span className="cb__icon" aria-hidden="true">
                <Warn />
              </span>
              <p>{w.text}</p>
            </li>
          ))}
          {lead.facts.map((f) => (
            <FactRow key={f.id} fact={f} pins={pins} />
          ))}
        </ul>
      )}
    </li>
  );
}

function FactRow({ fact, pins }: { fact: Fact; pins: PinsChannel }) {
  return (
    <li className={`cb__fact cb__fact--${fact.trust}`}>
      <p>
        <span className="cb__trust">{TRUST_LABELS[fact.trust]}</span> {fact.text}
      </p>
      <PinButton pins={pins} id={fact.id} label={fact.text} />
    </li>
  );
}
