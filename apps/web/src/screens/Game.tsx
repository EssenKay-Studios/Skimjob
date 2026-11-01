// /game/:id: the game screen, thin slice (docs/m2-plan.md M2-6). HUD, seats,
// move panel, alibis, ledger and case file, and the game-over ranking, all
// from the player's own view over the live channel. Meetings and votes (M2-7),
// chat (M2-8b), the bank art (M2-9) and the full reveal (M2-11) come later.
import { useEffect, useMemo, useState } from "react";
import type { CaseFileEvent, LoggedEvent, PlayerView, PublicEvent, RoomId } from "@skimjob/engine";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { Clock, Lock, Play } from "../components/icons";
import { HeatMeter, Meter } from "../components/Meter";
import { RoomTile } from "../components/RoomTile";
import { SketchFrame } from "../components/SketchFrame";
import { SplitSlider } from "../components/SplitSlider";
import { useToast } from "../components/Toast";
import { Underline } from "../components/Underline";
import { Wordmark } from "../components/Wordmark";
import { cardName, describeEvent, roleName, roomName } from "../game/describeEvent";
import {
  alibiState,
  canPocket,
  defaultRoom,
  formatCountdown,
  justMissed,
  namesOf,
  nextTarget,
  outcomeOf,
  phaseInfo,
  remainingMs,
  roomOptions,
  seatsOf,
  timerFor,
  type Timer,
} from "../game/hud";
import { useGame, useNow, type ClientCommand, type Connection, type Reply } from "../game/useGame";
import { linkClick, navigate } from "../router";
import "./game.css";

type Access = { kind: "checking" } | { kind: "ok" } | { kind: "lobby" } | { kind: "error"; title: string; text: string };

const sentence = (msg: string) => {
  const s = msg.charAt(0).toUpperCase() + msg.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
};

/** Before opening the socket: is this a started game you sit in? (The upgrade's own 401/404 can't be read by a browser.) */
function useAccess(id: string): Access {
  const [access, setAccess] = useState<Access>({ kind: "checking" });
  useEffect(() => {
    let live = true;
    fetch(`/api/games/${encodeURIComponent(id)}`, { credentials: "same-origin" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
        if (!live) return;
        if (res.ok) return setAccess(body.status === "lobby" ? { kind: "lobby" } : { kind: "ok" });
        if (res.status === 401) return setAccess({ kind: "error", title: "Sign in first", text: "Join the crew from your invite link, then come back to this game." });
        setAccess({ kind: "error", title: "No job here", text: sentence(body.error ?? "This game doesn't exist, or you're not in it") });
      })
      .catch(() => live && setAccess({ kind: "error", title: "Can't reach the server", text: "Check your connection and reload." }));
    return () => {
      live = false;
    };
  }, [id]);
  return access;
}

export function Game({ id }: { id: string }) {
  const access = useAccess(id);
  const channel = useGame(id, access.kind === "ok");
  const toast = useToast();
  const send = async (cmd: ClientCommand, done?: string): Promise<Reply> => {
    const r = await channel.send(cmd);
    if (!r.ok) toast(sentence(r.reason), "bad");
    else if (done) toast(done, "good");
    return r;
  };

  if (access.kind === "error" || access.kind === "lobby") {
    return (
      <div className="page game-page">
        <GameTop connection={null} />
        <main>
          <SketchFrame as="section" seed="game-err" radius={20} tape tilt={-0.5} className="sheet game-msg enter-sheet" aria-labelledby="game-msg">
            <h1 id="game-msg">{access.kind === "lobby" ? "Not started yet" : access.title}</h1>
            <p>{access.kind === "lobby" ? "The host hasn't started this job. Wait in the lobby." : access.text}</p>
            <Button variant="primary" seed="game-err-go" onClick={() => navigate(access.kind === "lobby" ? `/lobby/${id}` : "/")}>
              {access.kind === "lobby" ? "Go to the lobby" : "Back to the start"}
            </Button>
          </SketchFrame>
        </main>
      </div>
    );
  }

  const view = channel.view;
  return (
    <div className="page game-page">
      <GameTop connection={access.kind === "ok" ? channel.connection : null} />
      <main className="game" aria-busy={!view}>
        {!view ? (
          <SketchFrame seed="game-load" radius={20} className="sheet game-msg" aria-live="polite">
            <h1>Casing the joint…</h1>
            <p>Opening the game.</p>
          </SketchFrame>
        ) : (
          <Board view={view} timers={channel.timers} offset={channel.offset} send={send} />
        )}
      </main>
    </div>
  );
}

function GameTop({ connection }: { connection: Connection | null }) {
  const label = connection === "reconnecting" ? "Reconnecting…" : connection === "connecting" ? "Connecting…" : connection === "signedOut" ? "Signed out" : null;
  return (
    <header className="topbar game-top">
      <a href="/" className="topbar__home" onClick={linkClick} aria-label="Skimjob home">
        <Wordmark size={24} />
      </a>
      <span aria-live="polite">{label && <Chip colour={connection === "signedOut" ? "var(--bad)" : "var(--gold)"}>{label}</Chip>}</span>
    </header>
  );
}

interface BoardProps {
  readonly view: PlayerView;
  readonly timers: readonly Timer[];
  readonly offset: number;
  readonly send: (cmd: ClientCommand, done?: string) => Promise<Reply>;
}

function Board({ view, timers, offset, send }: BoardProps) {
  const outcome = outcomeOf(view);
  return (
    <div className={outcome ? "game-grid is-over" : "game-grid"}>
      <Hud view={view} timers={timers} offset={offset} />
      <Seats view={view} />
      <div className="game-grid__action">
        {outcome ? <GameOver view={view} /> : <Actions view={view} timers={timers} offset={offset} send={send} />}
      </div>
      <Records view={view} />
      {/* M2-8b: the crew chat feed goes here (a column on wide screens, a bottom-sheet tab on phones). */}
      <div className="game-grid__chat" data-slot="chat" hidden />
    </div>
  );
}

/** The countdown for `key`, on the server's clock. */
function useCountdown(timers: readonly Timer[], key: string | null, offset: number): { text: string; paused: boolean } | null {
  const now = useNow(500) + offset;
  const t = timerFor(timers, key);
  return t ? { text: formatCountdown(remainingMs(t, now)), paused: t.pausedAt !== null } : null;
}

function Hud({ view, timers, offset }: { view: PlayerView; timers: readonly Timer[]; offset: number }) {
  const phase = phaseInfo(view);
  const countdown = useCountdown(timers, phase.timerKey, offset);
  const emergency = view.pendingEmergency;
  const emergencyIn = useCountdown(timers, emergency ? `openMeeting:${emergency.meetingId}` : null, offset);
  const target = nextTarget(view);
  const max = 100;
  return (
    <SketchFrame as="section" seed="game-hud" radius={18} shadow={0.5} className="hud" aria-label="Heist status">
      <div className="hud__phase">
        <p className="kicker hud__kicker">
          {view.round > 0 ? `Round ${view.round} of 9 · Act ${view.act}` : "Setting up"}
        </p>
        <h1 className="hud__title">{phase.title}</h1>
        {countdown && (
          <p className="hud__timer">
            <span className="hud__clock" aria-hidden="true">
              <Clock />
            </span>
            <span>
              {phase.timerLabel} <b className="num">{countdown.text}</b>
              {countdown.paused && " (paused for the meeting)"}
            </span>
          </p>
        )}
        {emergency && emergencyIn && (
          <p className="hud__alert">
            Emergency meeting in <b className="num">{emergencyIn.text}</b>
          </p>
        )}
      </div>
      <div className="hud__stat hud__haul">
        <span className="meta">Haul</span>
        <span className="num hud__big">{view.haul}</span>
        <Meter value={view.haul} max={Math.max(target.target, view.haul) * 1.15} notch={target.target} tone="var(--olive)" label="Haul" />
        <span className="meta">
          {target.final ? "final target" : `Act ${target.act} target`} <b className="num">{target.target}</b>
        </span>
      </div>
      <div className="hud__stat hud__heat">
        <HeatMeter heat={view.heat} max={max} />
        <span className="hud__heat-text">
          <span className="meta">Heat</span>
          <span className="num hud__big">
            {view.heat}
            <small>/{max}</small>
          </span>
          {view.card && view.card.round === view.round && <span className="meta">Card: {cardLabel(view)}</span>}
        </span>
      </div>
    </SketchFrame>
  );
}

const cardLabel = (view: PlayerView) => `${cardName(view.card!.id)}${view.card!.room ? ` (${roomName(view.card!.room)} closed)` : ""}`;

function Seats({ view }: { view: PlayerView }) {
  const seats = seatsOf(view);
  return (
    <SketchFrame as="section" seed="game-seats" radius={16} shadow={0.4} className="seats" aria-labelledby="seats-h">
      <div className="seats__head">
        <h2 id="seats-h" className="seats__title">
          The crew
        </h2>
        <span className="meta">
          You're the <b className="seats__role">{roleName(view.me.role)}</b> · stash <b className="num">{view.me.stash}</b>
          {view.me.safe > 0 && (
            <>
              {" "}
              · safe <b className="num">{view.me.safe}</b>
            </>
          )}
        </span>
      </div>
      <ul className="seats__list">
        {seats.map((s) => (
          <li key={s.id} className={s.you ? "seat is-you" : "seat"}>
            <Avatar name={s.name.replace(/^Bot · /, "")} size={38} bot={s.isBot} status={s.moved ? "ready" : undefined} title={`${s.name}${s.you ? " (you)" : ""}${s.moved ? ", move locked in" : ""}`} />
            <span className="seat__name">
              {s.you ? "You" : s.name}
              {s.moved && <span className="seat__mark">move in</span>}
            </span>
          </li>
        ))}
      </ul>
    </SketchFrame>
  );
}

function Actions({ view, timers, offset, send }: BoardProps) {
  const alibi = alibiState(view);
  const p = view.phase;
  return (
    <>
      {alibi && <AlibiPanel view={view} round={alibi.round} posted={alibi.posted} send={send} />}
      {p.kind === "planning" ? (
        <MovePanel key={p.round} view={view} round={p.round} timers={timers} offset={offset} send={send} />
      ) : p.kind === "alibis" ? null : (
        <WaitPanel view={view} />
      )}
    </>
  );
}

function WaitPanel({ view }: { view: PlayerView }) {
  const p = view.phase;
  const text =
    p.kind === "meeting"
      ? "The crew is meeting. Voting from this screen arrives in the next build; the meeting closes by itself."
      : p.kind === "shakedownPending"
        ? "A shakedown passed. It lands when the window closes."
        : p.kind === "awaitingMeeting"
          ? `Act ${p.act} is over. The crew meeting opens next, then the checkpoint.`
          : "Hang tight.";
  return (
    <SketchFrame as="section" seed="game-wait" radius={16} shadow={0.4} className="panel" aria-live="polite">
      <h2 className="panel__title">
        <Underline seed="wait">{p.kind === "meeting" ? "Meeting in progress" : "Between rounds"}</Underline>
      </h2>
      <p>{text}</p>
    </SketchFrame>
  );
}

function MovePanel({ view, round, timers, offset, send }: BoardProps & { round: number }) {
  const options = useMemo(() => roomOptions(view), [view]);
  const mine = view.me.move;
  const [room, setRoom] = useState<RoomId | null>(mine?.room ?? null);
  const [pocket, setPocket] = useState(mine?.pocket ?? 0);
  const [watch, setWatch] = useState<RoomId | null>(mine?.watch ?? null);
  const [busy, setBusy] = useState(false);
  const countdown = useCountdown(timers, `round:${round}`, offset);
  const picked = options.find((o) => o.id === room) ?? null;
  const pocketOk = canPocket(view);
  const loot = picked?.loot ?? 0;
  const p = pocketOk ? Math.min(pocket, loot) : 0;
  const missed = justMissed(view);
  const changed = !mine || mine.room !== room || mine.pocket !== p || (mine.watch ?? null) !== (picked?.watcher ? watch : null);
  const ready = picked !== null && !picked.closed && (!picked.watcher || watch !== null);

  const lock = async () => {
    if (!picked || !ready) return;
    setBusy(true);
    await send({ type: "submitMove", move: { room: picked.id, pocket: p, ...(picked.watcher && watch ? { watch } : {}) } }, mine ? "Move updated." : "Locked in.");
    setBusy(false);
  };

  return (
    <SketchFrame as="section" seed="game-move" radius={18} shadow={0.5} className="panel move" aria-labelledby="move-h">
      <div className="panel__head">
        <h2 id="move-h" className="panel__title">
          <Underline seed={`move-${round}`}>Round {round} · Pick your room</Underline>
        </h2>
        {countdown && <span className="meta">locks in {countdown.text}</span>}
      </div>
      {missed && (
        <p className="move__missed" role="status">
          You missed round {missed.round}: the default move sent you to the {roomName(missed.room)}, handing everything in.
        </p>
      )}
      <div className="move__rooms" role="group" aria-label="Rooms">
        {options.map((o) => (
          <RoomTile
            key={o.id}
            seed={`room-${o.id}`}
            name={o.name}
            loot={o.loot}
            heat={o.heat}
            notes={o.notes}
            selected={room === o.id}
            disabled={o.closed}
            disabledNote="Closed by Lockdown"
            onSelect={() => setRoom(o.id)}
          />
        ))}
      </div>
      {picked?.watcher && (
        <div className="move__watch">
          <p className="meta">Which room do the cameras watch?</p>
          <div className="move__chips" role="group" aria-label="Room to watch">
            {options
              .filter((o) => o.id !== picked.id)
              .map((o) => (
                <Button key={o.id} variant="toggle" seed={`watch-${o.id}`} pressed={watch === o.id} onClick={() => setWatch(o.id)}>
                  {o.name}
                </Button>
              ))}
          </div>
        </div>
      )}
      {picked && loot > 0 && (
        pocketOk ? (
          <SplitSlider id="split" loot={loot} pocket={p} onChange={setPocket} />
        ) : (
          <p className="meta">As the {roleName(view.me.role)} you hand everything in.</p>
        )
      )}
      <div className="move__foot">
        <Button variant="primary" seed="lock" icon={<Play />} disabled={!ready || busy || !changed} onClick={lock} className="move__lock">
          {mine && !changed ? "Locked in" : mine ? "Update move" : "Lock it in"}
        </Button>
        <p className="meta move__status" aria-live="polite">
          {mine
            ? `Locked in: ${roomName(mine.room)}${mine.pocket > 0 ? `, pocket ${mine.pocket}` : ", all to the Haul"}. You can change it until the deadline.`
            : `Miss the deadline and you go to the ${roomName(defaultRoom(view))}, handing everything in.`}
        </p>
      </div>
    </SketchFrame>
  );
}

function AlibiPanel({ view, round, posted, send }: { view: PlayerView; round: number; posted: RoomId | null; send: BoardProps["send"] }) {
  const [room, setRoom] = useState<RoomId | null>(null);
  const [busy, setBusy] = useState(false);
  const post = async () => {
    if (!room) return;
    setBusy(true);
    await send({ type: "postAlibi", room }, "Alibi posted.");
    setBusy(false);
  };
  return (
    <SketchFrame as="section" seed="game-alibi" radius={16} shadow={0.45} fill="var(--card-sand)" className="panel alibi" aria-labelledby="alibi-h">
      <div className="panel__head">
        <h2 id="alibi-h" className="panel__title">
          <Underline seed={`alibi-${round}`}>Round {round} alibi</Underline>
        </h2>
      </div>
      {posted ? (
        <p>
          You told the crew you were in the <b>{roomName(posted)}</b>. Everyone can see it.
        </p>
      ) : (
        <>
          <p>Where do you say you were? Everyone sees it; it doesn't have to be true.</p>
          <div className="move__chips" role="group" aria-label="Alibi room">
            {view.rooms.map((r) => (
              <Button key={r} variant="toggle" seed={`alibi-${r}`} pressed={room === r} onClick={() => setRoom(r)}>
                {roomName(r)}
              </Button>
            ))}
          </div>
          <Button variant="secondary" seed="alibi-post" disabled={!room || busy} onClick={post}>
            Post alibi
          </Button>
        </>
      )}
    </SketchFrame>
  );
}

type Tab = "ledger" | "case";

function Records({ view }: { view: PlayerView }) {
  const [tab, setTab] = useState<Tab>("ledger");
  const name = namesOf(view);
  const ctx = { me: view.me.id, name, slot: slotText };
  const rows: readonly LoggedEvent<PublicEvent | CaseFileEvent>[] = tab === "ledger" ? view.ledger : view.caseFile;
  return (
    <SketchFrame as="section" seed="game-records" radius={18} shadow={0.5} fill="var(--manilla)" holes className="records" aria-label="Ledger and case file">
      <div className="records__tabs" role="group" aria-label="Show">
        <Button variant="toggle" seed="tab-ledger" pressed={tab === "ledger"} onClick={() => setTab("ledger")}>
          Ledger <span className="num">{view.ledger.length}</span>
        </Button>
        <Button variant="toggle" seed="tab-case" pressed={tab === "case"} onClick={() => setTab("case")}>
          Case file <span className="num">{view.caseFile.length}</span>
        </Button>
      </div>
      <p className="meta records__note">{tab === "ledger" ? "What everyone sees." : "Only you see these."}</p>
      <ol className={tab === "case" ? "records__list is-private" : "records__list"} aria-label={tab === "ledger" ? "Ledger" : "Case file"}>
        {[...rows].reverse().map(({ seq, event }) => (
          <li key={seq} className="records__row">
            {tab === "case" && (
              <span className="records__lock" aria-label="Only you">
                <Lock />
              </span>
            )}
            <span>{describeEvent(event, ctx)}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="records__row meta">Nothing yet.</li>}
      </ol>
    </SketchFrame>
  );
}

/** A meeting slot for people: ISO times as a local time, "act-2" as "the end of Act 2", other labels as they are. */
function slotText(slot: string): string {
  const act = /^act-(\d)$/.exec(slot);
  if (act) return `the end of Act ${act[1]}`;
  const t = /^\d{4}-\d{2}-\d{2}T/.test(slot) ? new Date(slot) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : slot;
}

function GameOver({ view }: { view: PlayerView }) {
  const outcome = outcomeOf(view)!;
  const name = namesOf(view);
  const seats = new Map(seatsOf(view).map((s) => [s.id, s]));
  const won = outcome.result === "success";
  const end = view.ledger.find((x) => x.event.type === "gameEnded");
  return (
    <SketchFrame as="section" seed="game-over" radius={20} shadow={0.55} tape className={won ? "panel over" : "panel over is-busted"} aria-labelledby="over-h">
      <p className={won ? "over__stamp" : "over__stamp is-busted"} aria-hidden="true">
        {won ? "JOB DONE" : "BUSTED"}
      </p>
      <h2 id="over-h" className="over__title">
        {won ? "The crew got away with it" : "The heist failed"}
      </h2>
      {end && <p>{describeEvent(end.event, { me: view.me.id, name })}</p>}
      <ol className="ranking" aria-label="Final ranking">
        {outcome.ranking.map((r, i) => {
          const seat = seats.get(r.player);
          const winner = outcome.winners.includes(r.player);
          return (
            <li key={r.player} className={["ranking__row", winner && "is-winner", !won && "is-void", seat?.you && "is-you"].filter(Boolean).join(" ")}>
              <span className="ranking__pos num">{i + 1}</span>
              <Avatar name={name(r.player).replace(/^Bot · /, "")} size={36} bot={seat?.isBot} title={name(r.player)} />
              <span className="ranking__who">
                <b>{seat?.you ? "You" : name(r.player)}</b>
                <span className="meta">{roleName(r.role)}</span>
              </span>
              <span className="ranking__score">
                <b className="num">{r.score}</b>
                <span className="meta">
                  stash {r.stash}
                  {r.safe > 0 ? ` (safe ${r.safe})` : ""}
                </span>
              </span>
              {winner && <Chip on>Winner</Chip>}
            </li>
          );
        })}
      </ol>
      <Button variant="secondary" seed="over-home" onClick={() => navigate("/")}>
        Back to the start
      </Button>
    </SketchFrame>
  );
}
