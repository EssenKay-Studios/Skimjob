// /game/:id: the game screen, thin slice (docs/m2-plan.md M2-6). HUD, seats,
// move panel, alibis, ledger and case file, and the game-over ranking, all
// from the player's own view over the live channel, and the chat (M2-8b,
// GameChat.tsx), meetings and votes (M2-7, Meetings.tsx) and the bank board
// (M2-9 art, figures from the view only: game/board.ts). The full reveal
// (M2-11) comes later.
import { useEffect, useMemo, useState } from "react";
import type { CaseFileEvent, LoggedEvent, PlayerView, PublicEvent, RoomId } from "@skimjob/engine";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { Clock, Lock, Play } from "../components/icons";
import { HeatMeter, Meter } from "../components/Meter";
import { BankCutaway } from "../art/BankCutaway";
import { BANK_ROOMS, type BankRoomId } from "../art/bankLayout";
import { CrookAvatar } from "../art/Crook";
import { RoomIcon } from "../art/RoomIcon";
import { BustedSpot, EmptyFileSpot, JobDoneSpot, WaitingSpot } from "../art/Spots";
import { RoomTile } from "../components/RoomTile";
import { SketchFrame } from "../components/SketchFrame";
import { SplitSlider } from "../components/SplitSlider";
import { useToast } from "../components/Toast";
import { Underline } from "../components/Underline";
import { boardScene, seatLooks } from "../game/board";
import { cardName, describeEvent, roleName, roomName } from "../game/describeEvent";
import {
  alibiState,
  canPocket,
  defaultRoom,
  justMissed,
  namesOf,
  nextTarget,
  outcomeOf,
  phaseInfo,
  presenceInfo,
  roomOptions,
  seatsOf,
  type Presence,
  type Timer,
} from "../game/hud";
import { hasMeetings, pluralityRule, slotText } from "../game/meeting";
import { ClaimRole, DecidingPanel, MeetingNow, MeetingsPanel, ResultsBanner, RoleCard } from "./Meetings";
import { useCountdown, useGame, useNow, type ClientCommand, type Connection, type GameChannel, type Reply } from "../game/useGame";
import { api, ApiError, sentence, UNREACHABLE, type LobbyView } from "../api";
import { navigate } from "../router";
import { GameChat } from "./GameChat";
import { TopBar } from "./TopBar";
import "./game.css";

type Access = { kind: "checking" } | { kind: "ok"; autoMeetings: boolean; dmNotices: boolean } | { kind: "lobby" } | { kind: "error"; title: string; text: string };

/** Before opening the socket: is this a started game you sit in? (The upgrade's own 401/404 can't be read by a browser.) */
function useAccess(id: string): Access {
  const [access, setAccess] = useState<Access>({ kind: "checking" });
  useEffect(() => {
    let live = true;
    api<LobbyView>("GET", `/games/${encodeURIComponent(id)}`).then(
      (game) =>
        live &&
        setAccess(game.status === "lobby" ? { kind: "lobby" } : { kind: "ok", autoMeetings: game.autoMeetings !== false, dmNotices: game.settings.dmNotices !== false }),
      (e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 401) return setAccess({ kind: "error", title: "Sign in first", text: "Join the crew from your invite link, then come back to this game." });
        if (e instanceof ApiError && e.status > 0 && e.status < 500) return setAccess({ kind: "error", title: "No job here", text: sentence(e.message) });
        setAccess({ kind: "error", title: "Can't reach the hideout", text: e instanceof ApiError ? e.message : UNREACHABLE });
      },
    );
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
          <Board
            view={view}
            timers={channel.timers}
            offset={channel.offset}
            send={send}
            autoMeetings={access.kind === "ok" ? access.autoMeetings : true}
            gameId={id}
            channel={channel}
            dmNotices={access.kind === "ok" && access.dmNotices}
          />
        )}
      </main>
    </div>
  );
}

function GameTop({ connection }: { connection: Connection | null }) {
  const label = connection === "reconnecting" ? "Reconnecting…" : connection === "connecting" ? "Connecting…" : connection === "signedOut" ? "Signed out" : null;
  return (
    <TopBar>
      <span aria-live="polite">{label && <Chip colour={connection === "signedOut" ? "var(--bad)" : "var(--gold)"}>{label}</Chip>}</span>
    </TopBar>
  );
}

interface BoardProps {
  readonly view: PlayerView;
  readonly timers: readonly Timer[];
  readonly offset: number;
  readonly send: (cmd: ClientCommand, done?: string) => Promise<Reply>;
  /** Meetings open by themselves after each act (no slot proposals). design §11.1 */
  readonly autoMeetings: boolean;
}

/** The room picked (on the board or in the move panel) for the round being planned, not yet locked in. */
interface Pick {
  readonly room: RoomId | null;
  readonly setRoom: (room: RoomId) => void;
}

const isBankRoom = (r: string): r is BankRoomId => (BANK_ROOMS as readonly string[]).includes(r);

function Board({ view, timers, offset, send, autoMeetings, gameId, channel, dmNotices }: BoardProps & { gameId: string; channel: GameChannel; dmNotices: boolean }) {
  const outcome = outcomeOf(view);
  const planning = view.phase.kind === "planning" ? view.phase.round : null;
  const [picked, setPicked] = useState<{ round: number; room: RoomId } | null>(null);
  const pick: Pick = {
    room: (picked && picked.round === planning ? picked.room : null) ?? view.me.move?.room ?? null,
    setRoom: (room) => planning !== null && setPicked({ round: planning, room }),
  };
  return (
    <div className={outcome ? "game-grid is-over" : "game-grid"}>
      <Hud view={view} timers={timers} offset={offset} />
      <BankBoard view={view} pick={planning !== null ? pick : null} />
      <Seats view={view} presence={channel.presence} offset={offset} />
      <div className="game-grid__action">
        {outcome ? <GameOver view={view} /> : <Actions view={view} timers={timers} offset={offset} send={send} autoMeetings={autoMeetings} pick={pick} />}
      </div>
      {/* From 1024 px the chat and the records share the right column; below that the chat is a sheet. */}
      <div className="game-grid__side">
        <GameChat gameId={gameId} view={view} channel={channel} dmNotices={dmNotices} />
        <Records view={view} />
      </div>
    </div>
  );
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

/**
 * The main board: the bank cut away (M2-9 art). While planning, tap a room to
 * pick it (drives the move panel); afterwards it shows the round as your view
 * knows it: you, who you saw in your room, and alibi claims as dashed ghosts.
 */
function BankBoard({ view, pick }: { view: PlayerView; pick: Pick | null }) {
  const scene = boardScene(view, pick?.room ?? null);
  const names = useMemo(() => Object.fromEntries(roomOptions(view).map((o) => [o.id, o.name])), [view]);
  const caption =
    scene.round === 0
      ? "The job hasn't started."
      : scene.mode === "pick"
        ? scene.selected
          ? `Round ${scene.round}: you're heading for the ${names[scene.selected] ?? roomName(scene.selected)}. Tap another room to change.`
          : `Round ${scene.round}: tap a room to pick it.`
        : `Round ${scene.round} as you saw it. Dashed figures are alibi claims, true or not.`;
  return (
    <SketchFrame as="section" seed="game-bank" radius={18} shadow={0.5} className="board" aria-labelledby="board-h">
      <div className="board__head">
        <h2 id="board-h" className="panel__title">
          <Underline seed="board">The bank</Underline>
        </h2>
        <p className="meta board__caption" aria-live="polite">
          {caption}
        </p>
      </div>
      <BankCutaway
        className="board__bank"
        rooms={view.rooms}
        names={names}
        time={scene.time}
        heat={view.heat}
        selected={scene.selected}
        closed={scene.closed}
        occupants={scene.occupants}
        title={scene.mode === "pick" ? "The bank: pick a room" : `The bank in round ${scene.round}`}
        {...(pick ? { onRoomSelect: (r: BankRoomId) => pick.setRoom(r) } : {})}
      />
    </SketchFrame>
  );
}

/**
 * The crew: who has locked in this round (public, owner decision 2 Nov) and
 * each person's presence, online now or last seen; bots show as bots. design §5.1
 */
function Seats({ view, presence, offset }: { view: PlayerView; presence: Presence | null; offset: number }) {
  const seats = seatsOf(view);
  const looks = seatLooks(view);
  const now = useNow(30_000) + offset;
  return (
    <SketchFrame as="section" seed="game-crew" radius={16} shadow={0.4} className="crew" aria-labelledby="crew-h">
      <div className="crew__head">
        <h2 id="crew-h" className="crew__title">
          The crew
        </h2>
      </div>
      <ul className="crew__list">
        {seats.map((s) => {
          const here = presenceInfo(s, presence, now);
          return (
            <li key={s.id} className={s.you ? "crew-seat is-you" : "crew-seat"}>
              <CrookAvatar
                name={`${s.name}${s.you ? " (you)" : ""}`}
                look={looks.get(s.id)?.look ?? 0}
                tag={looks.get(s.id)?.tag}
                size={44}
                bot={s.isBot}
                status={s.lockedIn ? "ready" : undefined}
                presence={here.kind === "online" ? "online" : here.kind === "seen" || here.kind === "never" ? "offline" : undefined}
              />
              <span className="crew-seat__name">
                {s.you ? "You" : s.name}
                {s.lockedIn && <span className="crew-seat__mark">locked in</span>}
                {here.text && !s.you && <span className={`crew-seat__here crew-seat__here--${here.kind}`}>{here.text}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </SketchFrame>
  );
}

function Actions({ view, timers, offset, send, autoMeetings, pick }: BoardProps & { pick: Pick }) {
  const alibi = alibiState(view);
  const p = view.phase;
  const meetings = hasMeetings(view);
  const voting = p.kind === "meeting" || p.kind === "shakedownPending";
  return (
    <>
      {meetings && <ResultsBanner view={view} />}
      {p.kind === "meeting" && <MeetingNow view={view} timers={timers} offset={offset} send={send} />}
      {p.kind === "shakedownPending" && <DecidingPanel view={view} timers={timers} offset={offset} />}
      {alibi && <AlibiPanel view={view} round={alibi.round} posted={alibi.posted} send={send} />}
      {p.kind === "planning" ? (
        <MovePanel key={p.round} view={view} round={p.round} timers={timers} offset={offset} send={send} autoMeetings={autoMeetings} pick={pick} />
      ) : p.kind === "alibis" || voting ? null : (
        <WaitPanel view={view} />
      )}
      {/* During the alibi window the claim sits next to the alibi button instead of on the card. */}
      <RoleCard view={view} send={send} claim={!alibi} />
      {meetings && !voting && <MeetingsPanel view={view} timers={timers} offset={offset} send={send} autoMeetings={autoMeetings} />}
    </>
  );
}

function WaitPanel({ view }: { view: PlayerView }) {
  const p = view.phase;
  const text = p.kind === "awaitingMeeting" ? `Act ${p.act} is over. The crew meeting opens next, then the checkpoint.` : "Hang tight.";
  return (
    <SketchFrame as="section" seed="game-wait" radius={16} shadow={0.4} className="panel wait" aria-live="polite">
      <h2 className="panel__title">
        <Underline seed="wait">Between rounds</Underline>
      </h2>
      <p>{text}</p>
      <WaitingSpot className="panel__spot" />
    </SketchFrame>
  );
}

function MovePanel({ view, round, timers, offset, send, pick }: BoardProps & { round: number; pick: Pick }) {
  const options = useMemo(() => roomOptions(view), [view]);
  const mine = view.me.move;
  const { room, setRoom } = pick;
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
            {...(isBankRoom(o.id) ? { icon: <RoomIcon room={o.id} size={22} /> } : {})}
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
        </>
      )}
      <div className="alibi__actions">
        {!posted && (
          <Button variant="secondary" seed="alibi-post" disabled={!room || busy} onClick={post}>
            Post alibi
          </Button>
        )}
        <ClaimRole view={view} send={send} where="alibi" />
      </div>
    </SketchFrame>
  );
}

type Tab = "ledger" | "case";

function Records({ view }: { view: PlayerView }) {
  const [tab, setTab] = useState<Tab>("ledger");
  const name = namesOf(view);
  const ctx = { me: view.me.id, name, slot: slotText, plurality: pluralityRule(view) };
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
      {rows.length === 0 && tab === "case" && <EmptyFileSpot className="records__spot" />}
    </SketchFrame>
  );
}

function GameOver({ view }: { view: PlayerView }) {
  const outcome = outcomeOf(view)!;
  const name = namesOf(view);
  const seats = new Map(seatsOf(view).map((s) => [s.id, s]));
  const looks = seatLooks(view);
  const won = outcome.result === "success";
  const end = view.ledger.find((x) => x.event.type === "gameEnded");
  return (
    <SketchFrame as="section" seed="game-over" radius={20} shadow={0.55} tape className={won ? "panel over" : "panel over is-busted"} aria-labelledby="over-h">
      <p className={won ? "over__stamp" : "over__stamp is-busted"} aria-hidden="true">
        {won ? "JOB DONE" : "BUSTED"}
      </p>
      {won ? <JobDoneSpot className="over__spot" look={seatLooks(view).get(outcome.winners[0] ?? view.me.id)?.look ?? 0} /> : <BustedSpot className="over__spot" look={seatLooks(view).get(view.me.id)?.look ?? 1} />}
      <h2 id="over-h" className="over__title">
        {won ? "The crew got away with it" : "The heist failed"}
      </h2>
      {end && <p>{describeEvent(end.event, { me: view.me.id, name, plurality: pluralityRule(view) })}</p>}
      <ol className="ranking" aria-label="Final ranking">
        {outcome.ranking.map((r, i) => {
          const seat = seats.get(r.player);
          const winner = outcome.winners.includes(r.player);
          return (
            <li key={r.player} className={["ranking__row", winner && "is-winner", !won && "is-void", seat?.you && "is-you"].filter(Boolean).join(" ")}>
              <span className="ranking__pos num">{i + 1}</span>
              <CrookAvatar name={name(r.player).replace(/^Bot · /, "")} look={looks.get(r.player)?.look ?? 0} tag={looks.get(r.player)?.tag} size={44} bot={seat?.isBot ?? false} expression={winner ? "smug" : won ? "neutral" : "caught"} />
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
