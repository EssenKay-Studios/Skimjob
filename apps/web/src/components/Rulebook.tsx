// The "This game" rulebook (design §15.6, §20): only this game's roles (per the
// role list), this game's three black-market perks, the events deck and the
// numbers, plus the Terms glossary. Every line and number comes from content
// or the player's own view.
import { ROOM_TEXT, infoText, termsFor } from "@skimjob/content";
import type { PlayerView } from "@skimjob/engine";
import { RoleIcon } from "../art/RoleIcon";
import { jobOf, rulesetOfView, setupOf } from "../game/hud";
import { eventsNote, numberRows, roleInfo, roleListInfo, rolesOf } from "../game/roles";
import { Button } from "./Button";
import { InfoTip, MoreInGame } from "./InfoTip";
import { DialogSheet } from "./MeetingKit";
import "./rulebook.css";

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rulebook__sec" aria-labelledby={`rb-${id}`}>
      <header>
        <h3 id={`rb-${id}`}>{title}</h3>
        {note && <p className="meta">{note}</p>}
      </header>
      {children}
    </section>
  );
}

/** The rulebook's content, in columns that follow the width it has. */
export function Rulebook({ view }: { view: PlayerView }) {
  const list = roleListInfo(view);
  const roles = rolesOf(view);
  const deck = setupOf(view)?.eventsEnabled ? rulesetOfView(view).events : [];
  return (
    // The tips in here are already in This game: no "More in This game" link.
    <MoreInGame.Provider value={null}>
      <div className="rulebook">
        <Section id="roles" title={list.title} note={list.note}>
          {list.roles.length === 0 ? (
            <p className="meta">The role list is hidden in this game.</p>
          ) : (
            <ul className="rulebook__rows">
              {list.roles.map(({ id, count }) => {
                const info = roleInfo(id, roles)!;
                return (
                  <li key={id}>
                    <div className="rulebook__name">
                      <RoleIcon role={id} size={26} />
                      <b className="hand">
                        {info.name}
                        {count > 1 ? ` ×${count}` : ""}
                      </b>
                      <span className={`tag tag--${info.kind}`}>{info.kindLabel}</span>
                      <InfoTip info={{ kind: "role", id }} />
                    </div>
                    <p>{info.power}</p>
                    <p className="meta">Spot it: {info.spot}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        {view.shop.length > 0 && (
        <Section id="market" title="Black market" note="One perk a round.">
          <ul className="rulebook__rows" aria-label="This game's black market">
            {view.shop.map(({ perk, cost }) => (
              <li key={perk}>
                <div className="rulebook__name">
                  <b className="hand">{infoText({ kind: "perk", id: perk })?.name ?? perk}</b>
                  <span className="rulebook__price num">
                    {cost} {cost === 1 ? "coin" : "coins"}
                  </span>
                  <InfoTip info={{ kind: "perk", id: perk }} />
                </div>
                <p>{infoText({ kind: "perk", id: perk })?.text}</p>
              </li>
            ))}
          </ul>
        </Section>
        )}
        <Section id="rooms" title="Rooms" note={`${view.rooms.length} in play`}>
          <ul className="rulebook__rows">
            {view.rooms.map((id) => (
              <li key={id}>
                <div className="rulebook__name">
                  <b className="hand">{jobOf(view).rooms[id]?.name ?? id}</b>
                  <InfoTip info={{ kind: "room", id }} />
                </div>
                <p>{ROOM_TEXT[id]}</p>
              </li>
            ))}
          </ul>
        </Section>
        {deck.length > 0 && (
          <Section id="events" title="Events" note={eventsNote}>
            <ul className="rulebook__rows">
              {deck.map((id) => (
                <li key={id}>
                  <div className="rulebook__name">
                    <b className="hand">{infoText({ kind: "event", id })?.name}</b>
                    <InfoTip info={{ kind: "event", id }} />
                  </div>
                  <p>{infoText({ kind: "event", id })?.text}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section id="numbers" title="Numbers">
          <dl className="rulebook__numbers">
            {numberRows(view).map((r) => (
              <div key={r.label}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section id="terms" title="Terms">
          <dl className="rulebook__numbers">
            {Object.values(termsFor(jobOf(view))).map((t) => (
              <div key={t.name}>
                <dt>{t.name}</dt>
                <dd>{t.text}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </MoreInGame.Provider>
  );
}

/** The rulebook as a dialog: "More in This game" from any tip, and the Rules button. */
export function RulebookSheet({ open, onClose, view }: { open: boolean; onClose: () => void; view: PlayerView }) {
  return (
    <DialogSheet open={open} onClose={onClose} seed="rulebook" labelledBy="rulebook-h">
      <div className="rulebook__sheet">
        <div className="rulebook__head">
          <h2 id="rulebook-h">This game</h2>
          <Button variant="small" seed="rulebook-close" onClick={onClose}>
            Close
          </Button>
        </div>
        <Rulebook view={view} />
      </div>
    </DialogSheet>
  );
}
