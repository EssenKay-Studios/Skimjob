// The end-of-game reveal (design §13, ui-style "End-of-game reveal"): every
// player's role card opened like a manila envelope (role, ★ ending, score,
// perks, stash over time), who won and why, and a round-by-round
// timeline: each round's card told true (every alibi stamped TRUE or LIE, each
// liar drawn where they really were, design §18 board 5), the real moves and
// every hidden action, now in the open. Reads `PlayerView.reveal.summary`
// (engine `revealSummary`) and the viewer's own trust marks.
import { useState } from "react";
import { PERK_TEXT } from "@skimjob/content";
import type {
  AlibiMark,
  PlayerId,
  RevealRound,
  RevealSeat,
  RevealSummary,
} from "@skimjob/engine";
import { CrookAvatar } from "../art/Crook";
import { initialsOf } from "./avatarLooks";
import {
  cardName,
  perkName,
  roleName,
  roomName,
  type DescribeContext,
} from "../game/describeEvent";
import {
  isHidden,
  itemText,
  lieText,
  roundLabel,
  roundLies,
  satOutText,
  stashTrend,
  whyText,
  starText,
  endingText,
} from "../game/reveal";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { Lock } from "./icons";
import { SketchFrame } from "./SketchFrame";
import { SnapshotCard } from "./SnapshotCard";
import type { Snapshot } from "../game/snapshot";
import "./reveal.css";

export interface RevealLook {
  readonly look: number;
  readonly tag?: string;
  readonly bot: boolean;
}

export interface RevealProps {
  readonly summary: RevealSummary;
  readonly ctx: DescribeContext;
  readonly looks: ReadonlyMap<PlayerId, RevealLook>;
  /** Your own trust marks by "round/target" (game/snapshot.ts `myMarks`): still only yours. design §10 */
  readonly marks: ReadonlyMap<string, AlibiMark>;
  /** Each round's snapshot card (game/snapshot.ts), told true here. The last round has none. design §18 */
  readonly cards: ReadonlyMap<number, Snapshot>;
  /** Bulbs on a bell, from content. */
  readonly bulbs: number;
}

export function Reveal({ summary, ctx, looks, marks, cards, bulbs }: RevealProps) {
  const failed = summary.ending.result === "failed";
  return (
    <SketchFrame
      as="section"
      seed="reveal"
      radius={20}
      shadow={0.5}
      holes
      className="panel reveal"
      aria-labelledby="reveal-h"
      data-ending={
        summary.ending.result === "success" ? "success" : summary.ending.reason
      }
    >
      <header className="reveal__head">
        <h2 id="reveal-h">The reveal</h2>
        <p className="reveal__why">{whyText(summary.ending, ctx)}</p>
      </header>
      <ol className="reveal__crew" aria-label="Every role, best first">
        {summary.seats.map((s, i) => (
          <RoleEnvelope
            key={s.player}
            seat={s}
            index={i}
            failed={failed}
            ctx={ctx}
            look={looks.get(s.player)}
            trend={stashTrend(summary, s.player)}
          />
        ))}
      </ol>
      <Timeline summary={summary} ctx={ctx} looks={looks} marks={marks} cards={cards} bulbs={bulbs} />
    </SketchFrame>
  );
}

function RoleEnvelope({
  seat: s,
  index,
  failed,
  ctx,
  look,
  trend,
}: {
  seat: RevealSeat;
  index: number;
  failed: boolean;
  ctx: DescribeContext;
  look: RevealLook | undefined;
  trend: number[];
}) {
  const you = s.player === ctx.me;
  const name = ctx.name(s.player).replace(/^Bot · /, "");
  const star = starText(s.role);
  const cls = [
    "reveal__card",
    s.winner && "is-winner",
    failed && !s.winner && "is-void",
    you && "is-you",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li className={cls} style={{ "--i": index } as React.CSSProperties}>
      <SketchFrame
        seed={`reveal-${s.player}`}
        radius={12}
        shadow={0.4}
        className="reveal__envelope"
      >
        <div className="reveal__top">
          <span className="reveal__place num" aria-label={`Place ${s.place}`}>
            {s.place}
          </span>
          <CrookAvatar
            name={name}
            look={look?.look ?? 0}
            tag={look?.tag}
            size={48}
            bot={look?.bot ?? false}
            expression={s.winner ? "smug" : failed ? "caught" : "neutral"}
          />
          <span className="reveal__who">
            <b>{you ? "You" : ctx.name(s.player)}</b>
            <span className="reveal__role">
              {roleName(s.role)}
              {s.dealtRole !== s.role && (
                <span className="meta"> (dealt {roleName(s.dealtRole)})</span>
              )}
            </span>
          </span>
          <span className="reveal__score">
            <b className="num">{s.stash}</b>
            <span className="meta">stash</span>
          </span>
        </div>
        {star && <p className="reveal__star">{star}</p>}
        <dl className="reveal__facts">
          <div>
            <dt>Stash</dt>
            <dd className="num">{s.stash}</dd>
          </div>
        </dl>
        <StashLine
          values={trend}
          label={`${you ? "Your" : `${name}'s`} stash over time: ${trend.join(", ")}`}
        />
        {s.perksBought.length > 0 && (
          <div className="reveal__shop">
            <p className="reveal__perks">
              <span className="meta">Bought:</span>
              {s.perksBought.map((p, k) => (
                <span key={`${p}-${k}`} title={PERK_TEXT[p]?.text}>
                  <Chip>{perkName(p)}</Chip>
                </span>
              ))}
            </p>
          </div>
        )}
        <div className="reveal__badges">
          {s.winner && <Chip on>Winner</Chip>}
          {s.topGroup && !s.winner && <Chip>Top of the ranking</Chip>}
        </div>
        {failed && !s.winner && (
          <span className="reveal__void" aria-hidden="true">
            VOID
          </span>
        )}
      </SketchFrame>
    </li>
  );
}

/** A tiny pencil line of the stash after each round. */
function StashLine({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 28;
  const lo = Math.min(0, ...values);
  const hi = Math.max(1, ...values);
  const pts = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 2 - ((v - lo) / (hi - lo)) * (h - 4)).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      className="reveal__trend"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      role="img"
      aria-label={label}
    >
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface SheetProps {
  ctx: DescribeContext;
  looks: ReadonlyMap<PlayerId, RevealLook>;
  marks: ReadonlyMap<string, AlibiMark>;
  cards: ReadonlyMap<number, Snapshot>;
  bulbs: number;
}

function Timeline({ summary, ...sheet }: SheetProps & { summary: RevealSummary }) {
  const rounds = summary.rounds;
  const [at, setAt] = useState(0);
  const round = rounds[Math.min(at, rounds.length - 1)];
  if (!round) return null;
  const go = (i: number) => setAt(Math.max(0, Math.min(rounds.length - 1, i)));
  return (
    <section className="reveal__timeline" aria-labelledby="reveal-tl-h">
      <h3 id="reveal-tl-h">The timeline</h3>
      <div className="reveal__scrub">
        <Button
          variant="small"
          seed="reveal-prev"
          onClick={() => go(at - 1)}
          disabled={at === 0}
          aria-label="Previous round"
        >
          ‹
        </Button>
        <div className="reveal__rounds" role="group" aria-label="Rounds">
          {rounds.map((r, i) => (
            <Button
              key={r.round}
              variant="toggle"
              seed={`reveal-r${r.round}`}
              pressed={i === at}
              onClick={() => go(i)}
              aria-label={roundLabel(r)}
            >
              {r.round === 0 ? "Setup" : r.round}
            </Button>
          ))}
        </div>
        <Button
          variant="small"
          seed="reveal-next"
          onClick={() => go(at + 1)}
          disabled={at === rounds.length - 1}
          aria-label="Next round"
        >
          ›
        </Button>
      </div>
      <RoundSheet round={round} last={rounds.at(-1)!.round} {...sheet} />
    </section>
  );
}

function RoundSheet({ round, last, ctx, looks, marks, cards, bulbs }: SheetProps & { round: RevealRound; last: number }) {
  const who = (p: PlayerId) => (p === ctx.me ? "You" : ctx.name(p));
  const snap = cards.get(round.round);
  const lies = roundLies(round, marks);
  const crew = new Map(
    [...looks].map(([p, l]) => {
      const name = ctx.name(p).replace(/^Bot · /, "");
      return [p, { look: l.look, tag: l.tag ?? initialsOf(name), bot: l.bot, name }];
    }),
  );
  return (
    <article
      className="reveal__round"
      aria-live="polite"
      aria-label={roundLabel(round)}
    >
      <header className="reveal__round-head">
        <h4>{roundLabel(round)}</h4>
        {round.card && (
          <Chip>
            {cardName(round.card.id)}
            {round.card.room ? `: ${roomName(round.card.room)} closed` : ""}
          </Chip>
        )}
        {round.resolved && (
          <span className="meta num">
            {round.resolved.taken} taken, {round.resolved.missing} missing
            {round.split ? `, share ${round.split.share}` : ""}
          </span>
        )}
      </header>
      {round.round === last && !snap && <p className="meta">No alibi window: the game ended.</p>}
      {snap && (
        <>
          <SnapshotCard
            snap={snap}
            crew={crew}
            me={ctx.me}
            marks={marks}
            bulbs={bulbs}
            title={`Round ${round.round}, the truth`}
            truth={new Map(round.moves.map((m) => [m.player, m.room]))}
          />
          <div className="reveal__lies">
            <h5>Lies in round {round.round}</h5>
            {lies.length > 0 ? (
              <ul>
                {lies.map((l) => (
                  <li key={l.player}>{lieText(l, ctx)}</li>
                ))}
              </ul>
            ) : (
              <p className="meta">Nobody lied.</p>
            )}
          </div>
        </>
      )}
      {(round.moves.length > 0 || round.satOut.length > 0) && (
        <ul className="reveal__moves" aria-label="What everyone really did">
          {round.moves.map((m) => (
            <li key={m.player} className="reveal__move">
              <b className="reveal__mover">{who(m.player)}</b>
              <span className="reveal__facts">
                <span>
                  Went: {roomName(m.room)}
                  {m.missed && (
                    <span className="meta"> (missed the deadline)</span>
                  )}
                </span>
                <span className="num">
                  {m.duffel + m.pocket} grabbed · {m.pocket} pocketed
                </span>
                <span className="meta num">
                  stash {round.stashes[m.player] ?? 0}
                </span>
              </span>
            </li>
          ))}
          {round.satOut.map((p) => (
            <li key={p} className="reveal__move reveal__sat-out">
              {satOutText(p, ctx)}
            </li>
          ))}
        </ul>
      )}
      {round.items.length > 0 ? (
        <ul className="reveal__items" aria-label="What happened">
          {round.items.map((it, k) => {
            const hidden = isHidden(it);
            return (
              <li
                key={k}
                className={hidden ? "reveal__item is-hidden" : "reveal__item"}
              >
                {hidden && (
                  <span className="reveal__lock" title="Hidden until now">
                    <Lock />
                  </span>
                )}
                <span>{itemText(it, ctx)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="meta">Nothing hidden happened.</p>
      )}
    </article>
  );
}

/** How the game ended, and on a failure that the ranking is a loss. */
export function EndingNote({
  outcome,
  name,
}: {
  outcome: Parameters<typeof endingText>[0];
  name: (id: string) => string;
}) {
  const e = endingText(outcome);
  const who = outcome.winners.map(name);
  const winners =
    who.length > 1
      ? `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]}`
      : (who[0] ?? "");
  const verb =
    who.length > 1 || who[0] === "You"
      ? e.badge.replace(/^Wins/, "win")
      : e.badge.replace(/^Wins/, "wins");
  return (
    <p className={e.loss ? "ending is-loss" : "ending"}>
      <b>{e.title}.</b>{" "}
      {outcome.result === "success"
        ? "The biggest stash wins."
        : e.loss
          ? "The ranking is marked as a loss."
          : `${winners} ${verb}.`}
    </p>
  );
}
