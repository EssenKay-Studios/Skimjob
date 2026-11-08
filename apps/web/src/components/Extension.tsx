// Role facts with a "How you win" line (design §11, §20.2), tappable role
// names and the rulebook sheet, with this game's black market (§12, §20.3).
// Everything is read from the player's own view (or content, outside a game).
import { useId, useState, type ReactNode } from "react";
import { BANK_JOB, PERKS, PERK_IDS, PERK_TEXT, ROLES, type RoleDef, type RoleId } from "@skimjob/content";
import type { PlayerView } from "@skimjob/engine";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { DialogSheet } from "./MeetingKit";
import { KIND_BLURB, endingText, roleInfo, roleListInfo, rolesByKind, rolesOf, type RoleInfo } from "../game/extension";
import { jobOf } from "../game/hud";
import "./extension.css";

type Roles = Readonly<Record<RoleId, RoleDef>>;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- roles

/** A role name you can tap to see its kind and win line. design §11.1, §20.2 */
export function RoleTip({ id, roles, label }: { id: RoleId; roles?: Roles; label?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const tip = useId();
  const info = roleInfo(id, roles);
  return (
    <span className="role-tip">
      <button type="button" className="role-tip__name" aria-expanded={open} aria-controls={tip} onClick={() => setOpen(!open)}>
        {label ?? info.name}
        {info.star && <span aria-label=" (can win a heist sunk by theft)"> ★</span>}
      </button>
      {open && (
        <span id={tip} className="role-tip__pop" role="note">
          <b>{info.kindLabel}.</b> {info.howYouWin}
        </span>
      )}
    </span>
  );
}

/** A role's kind, power and "How you win" line. */
export function RoleFacts({ info, compact = false }: { info: RoleInfo; compact?: boolean }) {
  return (
    <dl className={compact ? "role-facts is-compact" : "role-facts"}>
      <div className="role-facts__row role-facts__tag">
        <dt className="visually-hidden">Kind</dt>
        <dd>
          <span className={`tag tag--${info.kind}`}>{info.kindLabel}</span>
          {info.star && (
            <span className="tag tag--star" title="Can also win a heist sunk by theft">
              ★ also wins a heist sunk by theft
            </span>
          )}
        </dd>
      </div>
      <div className="role-facts__row">
        <dt>Power</dt>
        <dd>{info.power}</dd>
      </div>
      <div className="role-facts__row role-facts__win">
        <dt>How you win</dt>
        <dd>{info.howYouWin}</dd>
      </div>
    </dl>
  );
}

/** Your role's facts on the role card. */
export function MyRoleFacts({ view }: { view: PlayerView }) {
  return <RoleFacts info={roleInfo(view.me.role, rolesOf(view))} />;
}

/** The roles the crew is told about: exact (with counts), possible or hidden (host setting, design §11.3). */
export function RoleList({ view }: { view: PlayerView }) {
  const roles = rolesOf(view);
  const list = roleListInfo(view);
  const counts = new Map<RoleId, number>();
  for (const r of list.roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  return (
    <div className="role-list">
      <p className="meta">{list.title}</p>
      {counts.size > 0 && (
        <ul className="role-list__names" aria-label={list.title}>
          {[...counts].map(([r, n]) => (
            <li key={r}>
              <RoleTip id={r} roles={roles} label={`${roles[r]?.name ?? r}${n > 1 ? ` ×${n}` : ""}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- rulebook

/** The rulebook sheet: the game in a minute, endings, roles by kind and the black market. */
export function RulebookSheet({ open, onClose, view }: { open: boolean; onClose: () => void; view: PlayerView | null }) {
  const roles = rolesOf(view);
  const job = view ? jobOf(view) : BANK_JOB;
  const ids = Object.keys(ROLES).filter((r) => roles[r]);
  const inGame = new Set(view?.roleList?.roles ?? []);
  const stars = ids.filter((r) => roleInfo(r, roles).star).map((r) => roles[r]!.name);
  // design §12: this game's three perks; outside a game, all seven at their content costs.
  const shop = view && view.shop.length > 0 ? view.shop : PERK_IDS.map((perk) => ({ perk, cost: PERKS[perk].cost }));
  return (
    <DialogSheet open={open} onClose={onClose} seed="rulebook" labelledBy="rulebook-h">
      <div className="rulebook">
        <div className="rulebook__head">
          <h2 id="rulebook-h">Rulebook</h2>
          <Button variant="small" seed="rulebook-close" onClick={onClose}>
            Close
          </Button>
        </div>
        <section aria-labelledby="rb-minute">
          <h3 id="rb-minute">The game in one minute</h3>
          <ul className="rulebook__list">
            <li>One crew robs one bank. Whoever ends with the biggest stash wins, every tie for it too.</li>
            <li>
              Each round, pick a room in secret and drag each coin into the crew duffel or your own pocket.
            </li>
            <li>
              The game ends when the bank is empty, or after round {job.roundCap}. If less than two-thirds of the coins taken reached the
              crew, the heist is sunk by theft.
            </li>
            <li>
              Noisy coins light the room's alarm bell. When all {job.alarm.bulbs} bulbs light, the police raid it: its grabs are seized, it is taped off for{" "}
              {job.alarm.tapedRounds} rounds and Wanted goes up a star. At {job.alarm.bustStars} stars it's a bust.
            </li>
            <li>Nobody is knocked out. Getting caught costs loot, never your seat.</li>
          </ul>
        </section>
        <section aria-labelledby="rb-endings">
          <h3 id="rb-endings">Endings</h3>
          <table className="rulebook__table">
            <thead>
              <tr>
                <th scope="col">How the game ends</th>
                <th scope="col">Who wins</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Bank empty or round {job.roundCap}, two-thirds handed in, no bust</td>
                <td>The biggest stash</td>
              </tr>
              <tr>
                <td>Busted (Wanted {job.alarm.bustStars})</td>
                <td>Only the Rooftop gets away: the biggest stash up there</td>
              </tr>
              <tr>
                <td>Sunk by theft</td>
                <td>Nobody, unless {orList(stars)} has the biggest stash of all</td>
              </tr>
            </tbody>
          </table>
          <p className="meta">On a failed heist the ranking is still shown, marked as a loss.</p>
        </section>
        <section aria-labelledby="rb-roles">
          <h3 id="rb-roles">Roles</h3>
          <p className="meta">Every player gets a role. No role is good or evil; it isn't a team. ★ marks the roles that can also win a heist sunk by theft.</p>
          {rolesByKind(ids, roles).map((g) => (
            <div key={g.kind} className="rulebook__tag">
              <h4>
                <span className={`tag tag--${g.kind}`}>{g.label}</span> <span className="meta">{KIND_BLURB[g.kind]}</span>
              </h4>
              <ul className="rulebook__roles">
                {g.roles.map((r) => {
                  const info = roleInfo(r, roles);
                  return (
                    <li key={r} className={inGame.has(r) ? "rulebook__role is-in" : "rulebook__role"}>
                      <p className="rulebook__role-name">
                        <b>
                          {info.name}
                          {info.star ? " ★" : ""}
                        </b>
                        {inGame.has(r) && <Chip on>in this game</Chip>}
                      </p>
                      <RoleFacts info={info} compact />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
        <section aria-labelledby="rb-shop">
          <h3 id="rb-shop">The black market</h3>
          <ul className="rulebook__list">
            <li>Perks cost coins from your own stash: they leave the game and lower your score.</li>
            <li>One perk a round, bought and used while planning. Bail is the one you keep until a shakedown passes against you.</li>
            <li>Every purchase is logged at once, without a name.</li>
          </ul>
          <ul className="rulebook__perks" aria-label={view && view.shop.length > 0 ? "This game's black market" : "The black market"}>
            {shop.map((s) => (
              <li key={s.perk}>
                <b>{PERK_TEXT[s.perk]?.name ?? s.perk}</b> <span className="num">({s.cost})</span>: {PERK_TEXT[s.perk]?.text}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </DialogSheet>
  );
}

const orList = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "nobody") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);

/** A small "Rulebook" button that opens the sheet. */
export function RulebookButton({ view, seed = "rulebook-open" }: { view: PlayerView | null; seed?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="small" seed={seed} onClick={() => setOpen(true)} aria-haspopup="dialog">
        Rulebook
      </Button>
      <RulebookSheet open={open} onClose={() => setOpen(false)} view={view} />
    </>
  );
}

// ---------------------------------------------------------------- end of game

/** How the game ended, and on a failure that the ranking is a loss. extension.md "Winning and losing" */
export function EndingNote({ outcome, name }: { outcome: Parameters<typeof endingText>[0]; name: (id: string) => string }) {
  const e = endingText(outcome);
  const who = outcome.winners.map(name);
  const winners = who.length > 1 ? `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]}` : (who[0] ?? "");
  const verb = who.length > 1 || who[0] === "You" ? e.badge.replace(/^Wins/, "win") : e.badge.replace(/^Wins/, "wins");
  return (
    <p className={e.loss ? "ending is-loss" : "ending"}>
      <b>{e.title}.</b> {outcome.result === "success" ? "The biggest stash wins." : e.loss ? "The ranking is marked as a loss." : `${winners} ${verb}.`}
    </p>
  );
}

