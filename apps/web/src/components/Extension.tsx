// The Extension's player-facing pieces (docs/extension.md): role facts with a
// "How you win" line, tappable role names, the rulebook sheet, the Haul target
// bar, the Heat breakdown, the gap box, and your tokens with the perk shop.
// Everything is read from the player's own view (or content, outside a game).
import { useId, useState, type ReactNode } from "react";
import { BANK_JOB, PERKS, POOL_ROLES, ROUNDS_PER_ACT, SHOP_COLUMNS, type FailureReason, type PerkColumn, type RoleDef, type RoleId } from "@skimjob/content";
import type { PlayerId, PlayerView, RoomId } from "@skimjob/engine";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { DialogSheet } from "./MeetingKit";
import { Meter } from "./Meter";
import { cardName, roomName } from "../game/describeEvent";
import {
  COLUMN_LABEL,
  TAG_BLURB,
  endingText,
  gapInfo,
  heatRounds,
  perkUses,
  roleInfo,
  roleListInfo,
  rolesByTag,
  rolesOf,
  shopState,
  signedText,
  targetBar,
  type HeatRound,
  type PerkUse,
  type RoleInfo,
} from "../game/extension";
import { jobOf, namesOf } from "../game/hud";
import type { ClientCommand, Reply } from "../game/useGame";
import "./extension.css";

type Send = (cmd: ClientCommand, done?: string) => Promise<Reply>;
type Roles = Readonly<Record<RoleId, RoleDef>>;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- roles

/** A role name you can tap to see its tag and win line. extension.md Build notes (2 Nov answers) */
export function RoleTip({ id, roles, label }: { id: RoleId; roles?: Roles; label?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const tip = useId();
  const info = roleInfo(id, roles);
  return (
    <span className="role-tip">
      <button type="button" className="role-tip__name" aria-expanded={open} aria-controls={tip} onClick={() => setOpen(!open)}>
        {label ?? info.name}
        {info.star && <span aria-label=" (can win a failed heist)"> ★</span>}
      </button>
      {open && (
        <span id={tip} className="role-tip__pop" role="note">
          <b>{info.tagLabel}.</b> {info.howYouWin}
        </span>
      )}
    </span>
  );
}

/** A role's tag, power, token trigger and "How you win" line. */
export function RoleFacts({ info, compact = false }: { info: RoleInfo; compact?: boolean }) {
  return (
    <dl className={compact ? "role-facts is-compact" : "role-facts"}>
      <div className="role-facts__row role-facts__tag">
        <dt className="visually-hidden">Tag</dt>
        <dd>
          <span className={`tag tag--${info.tag}`}>{info.tagLabel}</span>
          {info.star && (
            <span className="tag tag--star" title="Can also win when the heist fails">
              ★ also wins a failed heist
            </span>
          )}
        </dd>
      </div>
      <div className="role-facts__row">
        <dt>Power</dt>
        <dd>{info.power}</dd>
      </div>
      {info.earns && (
        <div className="role-facts__row">
          <dt>Tokens</dt>
          <dd>{info.earns}</dd>
        </div>
      )}
      <div className="role-facts__row role-facts__win">
        <dt>How you win</dt>
        <dd>{info.howYouWin}</dd>
      </div>
    </dl>
  );
}

/** Your role's facts on the role card. */
export function MyRoleFacts({ view }: { view: PlayerView }) {
  return <RoleFacts info={roleInfo(view.me.role, rolesOf(view), jobOf(view))} />;
}

/** The roles the crew is told about: exact, possible or hidden (host setting). */
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

const REASON_TEXT: Record<FailureReason, string> = { heat: "Cops raid (Heat 100)", target: "Final target missed" };

/** The rulebook sheet: the game in a minute, endings, roles by tag and the shop. extension.md */
export function RulebookSheet({ open, onClose, view }: { open: boolean; onClose: () => void; view: PlayerView | null }) {
  const roles = rolesOf(view);
  const job = view ? jobOf(view) : BANK_JOB;
  const rounds = 3 * ROUNDS_PER_ACT;
  const ids = POOL_ROLES.filter((r) => roles[r]);
  const inGame = new Set(view?.roleList?.roles ?? []);
  const stars = (reason: FailureReason) => ids.filter((r) => roles[r]!.winsOn.includes(reason)).map((r) => roles[r]!.name);
  const shop: { perk: keyof typeof PERKS; cost: number }[] = view && view.shop.length > 0 ? [...view.shop] : [];
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
            <li>One crew robs one bank. Only one player wins: whoever ends with the biggest stash.</li>
            <li>
              Each round, pick a room in secret and split its loot between the crew's Haul and your own stash.
            </li>
            <li>
              {rounds} rounds, with a crew meeting after rounds {ROUNDS_PER_ACT}, {2 * ROUNDS_PER_ACT} and {rounds}. Each meeting checks the Haul against its target; a
              missed target adds +{job.heat.missedCheckpoint} Heat, and missing the final one fails the heist.
            </li>
            <li>
              Heat goes up +{job.heat.perRound} every round and with each room's own Heat. At {job.heat.max} the cops raid.
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
                <td>Final target met and Heat below {job.heat.max}</td>
                <td>The biggest stash</td>
              </tr>
              {(["heat", "target"] as const).map((reason) => (
                <tr key={reason}>
                  <td>{REASON_TEXT[reason]}</td>
                  <td>Nobody, unless {orList(stars(reason))} has the biggest stash</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="meta">On a failed heist the ranking is still shown, marked as a loss.</p>
        </section>
        <section aria-labelledby="rb-roles">
          <h3 id="rb-roles">Roles</h3>
          <p className="meta">The tag only says how selfish a power is; it isn't a team. ★ marks the roles that can also win when the heist fails.</p>
          {rolesByTag(ids, roles).map((g) => (
            <div key={g.tag} className="rulebook__tag">
              <h4>
                <span className={`tag tag--${g.tag}`}>{g.label}</span> <span className="meta">{TAG_BLURB[g.tag]}</span>
              </h4>
              <ul className="rulebook__roles">
                {g.roles.map((r) => {
                  const info = roleInfo(r, roles, job);
                  return (
                    <li key={r} className={inGame.has(r) ? "rulebook__role is-in" : "rulebook__role"}>
                      <p className="rulebook__role-name">
                        <b>
                          {info.name}
                          {info.star ? " ★" : ""}
                        </b>
                        {inGame.has(r) && <Chip on>in this game</Chip>}
                        {info.minPlayers && <span className="meta">{info.minPlayers}+ players</span>}
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
          <h3 id="rb-shop">Tokens and the perk shop</h3>
          <ul className="rulebook__list">
            <li>Your role earns tokens; tokens buy perks. Each game's shop has one perk from each column.</li>
            <li>Tokens and what you buy stay private until you use a perk. Use at most one per round.</li>
            <li>Unspent tokens are worth nothing at the end. Quick and Starter games have no shop.</li>
          </ul>
          {shop.length > 0 ? (
            <ul className="rulebook__perks" aria-label="This game's shop">
              {shop.map((s) => (
                <li key={s.perk}>
                  <b>{PERKS[s.perk]?.name ?? s.perk}</b> <span className="num">({s.cost})</span>: {PERKS[s.perk]?.effect}
                </li>
              ))}
            </ul>
          ) : (
            <div className="rulebook__columns">
              {(Object.keys(SHOP_COLUMNS) as PerkColumn[]).map((c) => (
                <div key={c}>
                  <h4>{COLUMN_LABEL[c]}</h4>
                  <ul className="rulebook__perks">
                    {SHOP_COLUMNS[c].map((p) => (
                      <li key={p}>
                        <b>{PERKS[p].name}</b> <span className="num">({PERKS[p].cost})</span>: {PERKS[p].effect}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
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

// ---------------------------------------------------------------- target bar, Heat breakdown, gap box

/** "Haul 40 / 63 needed by the next meeting". extension.md "What the app works out for you" */
export function TargetBar({ view }: { view: PlayerView }) {
  const t = targetBar(view);
  return (
    <div className="target-bar">
      <span className="meta">Haul</span>
      <span className="num hud__big">{t.haul}</span>
      <Meter value={Math.min(t.haul, t.target)} max={Math.max(t.target, 1)} tone={t.haul >= t.target ? "var(--good)" : "var(--olive)"} label={t.text} />
      <span className="meta target-bar__text">
        <b className="num">
          {t.haul} / {t.target}
        </b>{" "}
        needed by {t.final ? "the final meeting" : "the next meeting"}
        <span className="target-bar__miss"> ({t.ifMissed})</span>
      </span>
    </div>
  );
}

function HeatLines({ h }: { h: HeatRound }) {
  return (
    <ul className="heat-parts__lines" aria-label={`Round ${h.round} Heat`}>
      {h.lines.length === 0 && <li className="meta">No change.</li>}
      {h.lines.map((l, i) => (
        <li key={i} className={`heat-parts__line is-${l.kind}`}>
          <b className="num">{signedText(l.value)}</b> {l.label}
        </li>
      ))}
    </ul>
  );
}

/** The Heat change of each round by part, newest first. extension.md "What the app works out for you" */
export function HeatBreakdown({ view }: { view: Pick<PlayerView, "ledger" | "round"> }) {
  const rounds = heatRounds(view);
  const [latest, ...earlier] = rounds;
  if (!latest) return null;
  return (
    <section className="heat-parts" aria-label="Heat breakdown">
      <p className="heat-parts__head">
        <span className="meta">
          Heat, round {latest.round}: <b className="num">{signedText(latest.total)}</b>
        </span>
      </p>
      <HeatLines h={latest} />
      {earlier.length > 0 && (
        <details className="heat-parts__more">
          <summary className="meta">Earlier rounds</summary>
          {earlier.map((h) => (
            <div key={h.round} className="heat-parts__round">
              <p className="meta">
                Round {h.round}: <b className="num">{signedText(h.total)}</b>
              </p>
              <HeatLines h={h} />
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

/** "Alibis say +14, the Haul grew 9: 5 unaccounted for." extension.md "The gap box" */
export function GapBox({ view }: { view: PlayerView }) {
  const g = gapInfo(view);
  if (!g) return null;
  const tone = g.posted === 0 ? "" : g.unaccounted > 0 ? " is-short" : g.unaccounted < 0 ? " is-over" : " is-even";
  return (
    <section className={`gap-box${tone}`} aria-label={`Round ${g.round} gap`} aria-live="polite">
      <p className="gap-box__kicker meta">
        Round {g.round} · {g.posted} of {g.crew} alibis in
      </p>
      <p className="gap-box__text">{g.text}</p>
      {g.posted > 0 && g.unaccounted !== 0 && <p className="meta">Event effects are already counted.</p>}
    </section>
  );
}

// ---------------------------------------------------------------- tokens and the shop

/** Your tokens and the shop button, on the role card. Nothing in games without a shop (Starter, Quick). */
export function Tokens({ view, send }: { view: PlayerView; send: Send }) {
  const shop = shopState(view);
  const [open, setOpen] = useState(false);
  if (!shop.open) return null;
  return (
    <div className="tokens">
      <span className="tokens__count">
        <span className="tokens__coin" aria-hidden="true" />
        <b className="num">{shop.tokens}</b> <span className="meta">{shop.tokens === 1 ? "token" : "tokens"} · only you see this</span>
      </span>
      <Button variant="small" seed="shop-open" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Shop
      </Button>
      <ShopSheet view={view} send={send} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

/** The three-perk shop: buy with tokens; what you own stays private until you use it. extension.md "Tokens and the perk shop" */
export function ShopSheet({ view, send, open, onClose }: { view: PlayerView; send: Send; open: boolean; onClose: () => void }) {
  const shop = shopState(view);
  const [busy, setBusy] = useState(false);
  const buy = async (perk: (typeof shop.items)[number]) => {
    setBusy(true);
    await send({ type: "buyPerk", perk: perk.perk }, `Bought ${perk.name}.`);
    setBusy(false);
  };
  return (
    <DialogSheet open={open} onClose={onClose} seed="shop" labelledBy="shop-h">
      <div className="shop">
        <div className="rulebook__head">
          <h2 id="shop-h">The shop</h2>
          <Button variant="small" seed="shop-close" onClick={onClose}>
            Close
          </Button>
        </div>
        <p className="shop__tokens">
          <span className="tokens__coin" aria-hidden="true" />
          You have <b className="num">{shop.tokens}</b> {shop.tokens === 1 ? "token" : "tokens"}.
        </p>
        <p className="meta">Private: nobody sees your tokens or what you buy until you use it. Use at most one perk per round.</p>
        <ul className="shop__items" aria-label="Perks on sale">
          {shop.items.map((it) => (
            <li key={it.perk} className="shop__item">
              <span className="shop__col meta">{COLUMN_LABEL[it.column]}</span>
              <span className="shop__what">
                <b>{it.name}</b> <span className="meta">{it.effect}</span>
                {it.auto && <span className="meta"> Spent by itself when it applies.</span>}
              </span>
              <span className="shop__buy">
                <span className="num shop__cost" aria-label={`costs ${it.cost}`}>
                  {it.cost}
                </span>
                <Button variant="secondary" seed={`buy-${it.perk}`} disabled={!it.affordable || busy} onClick={() => void buy(it)} aria-label={`Buy ${it.name} for ${it.cost}`}>
                  Buy
                </Button>
              </span>
              {it.owned > 0 && <span className="shop__owned meta">You own {it.owned > 1 ? `${it.owned}` : "one"}.</span>}
            </li>
          ))}
        </ul>
        {shop.extra.length > 0 && (
          <p className="meta">Also yours: {shop.extra.map((x) => `${PERKS[x.perk]?.name ?? x.perk}${x.count > 1 ? ` ×${x.count}` : ""}`).join(", ")}.</p>
        )}
        <PerkUses view={view} send={send} />
      </div>
    </DialogSheet>
  );
}

const USE_TITLE: Record<PerkUse["kind"], string> = {
  peek: "Peek",
  tail: "Tail",
  alibi: "Alibi",
  recharge: "Recharge",
  rig: "Rig",
  rigPick: "Rig: pick the card",
};

/** The perks you can spend now (meeting perks are on the vote screen); the engine has the last word. */
export function PerkUses({ view, send }: { view: PlayerView; send: Send }) {
  const uses = perkUses(view);
  const shop = shopState(view);
  const owned = view.me.roleState.perks.length > 0;
  if (!owned && uses.length === 0 && !shop.usedThisRound) return null;
  return (
    <div className="perk-uses" aria-label="Use a perk">
      <h3 className="perk-uses__title">Your perks</h3>
      {shop.usedThisRound && <p className="meta perk-uses__note">You've used a perk this round. The next one waits for the next round.</p>}
      {uses.map((u) => (
        <PerkUseRow key={u.kind} view={view} use={u} send={send} />
      ))}
      {!shop.usedThisRound && uses.length === 0 && <p className="meta">Nothing to use right now. Meeting perks are offered on the vote screen.</p>}
    </div>
  );
}

function PerkUseRow({ view, use, send }: { view: PlayerView; use: PerkUse; send: Send }) {
  const who = namesOf(view);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (cmd: ClientCommand, done: string) => {
    setBusy(true);
    const r = await send(cmd, done);
    setBusy(false);
    if (r.ok) setPick(null);
  };
  const chips = (ids: readonly string[], label: string, name: (id: string) => string) => (
    <div className="move__chips" role="group" aria-label={label}>
      {ids.map((id) => (
        <Button key={id} variant="toggle" seed={`perk-${use.kind}-${id}`} pressed={pick === id} onClick={() => setPick(id)}>
          {name(id)}
        </Button>
      ))}
    </div>
  );
  const perk = use.kind === "rigPick" ? PERKS.rig : PERKS[use.kind];
  return (
    <div className="perk-use">
      <p>
        <b>{USE_TITLE[use.kind]}:</b> {use.kind === "rigPick" ? `Round ${use.round}'s card. Now: ${cardName(use.picked)}.` : perk.effect}
      </p>
      {use.kind === "peek" && (
        <>
          {chips(use.targets, "Player to peek at", (id) => cap(who(id as PlayerId)))}
          <Button variant="secondary" seed="perk-peek" disabled={!pick || busy} onClick={() => pick && void go({ type: "useAbility", ability: { kind: "peek", target: pick } }, "Peeked.")}>
            Peek
          </Button>
        </>
      )}
      {use.kind === "tail" && (
        <>
          {chips(use.rooms, "Room to tail", (id) => roomName(id))}
          <Button variant="secondary" seed="perk-tail" disabled={!pick || busy} onClick={() => pick && void go({ type: "useAbility", ability: { kind: "tail", room: pick as RoomId } }, "Tailing.")}>
            Tail
          </Button>
        </>
      )}
      {use.kind === "alibi" && (
        <Button variant="secondary" seed="perk-alibi" disabled={busy} onClick={() => void go({ type: "useAbility", ability: { kind: "alibi" } }, "Alibi verified.")}>
          Verify my round {use.round} alibi ({roomName(use.room)})
        </Button>
      )}
      {use.kind === "recharge" && (
        <Button variant="secondary" seed="perk-recharge" disabled={busy} onClick={() => void go({ type: "useAbility", ability: { kind: "recharge" } }, "Power recharged.")}>
          Recharge my power
        </Button>
      )}
      {use.kind === "rig" && (
        <Button variant="secondary" seed="perk-rig" disabled={busy} onClick={() => void go({ type: "useAbility", ability: { kind: "rig" } }, "Rigged: pick the card.")}>
          Rig the next card
        </Button>
      )}
      {use.kind === "rigPick" && (
        <>
          {chips(use.cards, "Card to play", (id) => cardName(id))}
          <Button variant="secondary" seed="perk-rigpick" disabled={!pick || busy || pick === use.picked} onClick={() => pick && void go({ type: "useAbility", ability: { kind: "rigPick", card: pick } }, "Card picked.")}>
            Pick this card
          </Button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- end of game

/** How the game ended, and on a failure that the ranking is a loss. extension.md "Winning and losing" */
export function EndingNote({ outcome }: { outcome: Parameters<typeof endingText>[0] }) {
  const e = endingText(outcome);
  return (
    <p className={e.loss ? "ending is-loss" : "ending"}>
      <b>{e.title}.</b> {e.loss ? "The ranking is marked as a loss." : "The biggest stash wins."}
    </p>
  );
}

