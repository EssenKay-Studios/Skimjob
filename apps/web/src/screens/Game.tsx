// /game/:id: the game screen, thin slice (docs/m2-plan.md M2-6). HUD, seats,
// move panel, alibis, ledger and case file, and the game-over ranking, all
// from the player's own view over the live channel, and the chat (M2-8b,
// GameChat.tsx), meetings and votes (M2-7, Meetings.tsx) and the bank board
// (M2-9 art, figures from the view only: game/board.ts), and (M2-10) the
// ledger / case file sheet, the "While you were away" recap and the private
// suspicion board (game/notes.ts), the host strip (M2-13, GameHost.tsx) and
// (M2-11) the end-of-game reveal (components/Reveal.tsx, from `view.reveal.summary`).
import { useEffect, useMemo, useState } from "react";
import type { PlayerView, RoomId } from "@skimjob/engine";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { Clock, Play } from "../components/icons";
import { WantedStars } from "../components/Bell";
import { InfoTip } from "../components/InfoTip";
import { EndingNote } from "../components/Extension";
import { endingText } from "../game/extension";
import { MEETING_TITLE } from "../game/meeting";
import { BankCutaway } from "../art/BankCutaway";
import { BANK_ROOMS, type BankRoomId } from "../art/bankLayout";
import { CrookAvatar } from "../art/Crook";
import { PlanBoard } from "../components/PlanBoard";
import { Reveal } from "../components/Reveal";
import { AwayRecap } from "../components/AwayRecap";
import { CaseBoard } from "../components/CaseBoard";
import { SuspicionBoard, SuspicionMark } from "../components/SuspicionBoard";
import { useAwayRecap, usePins, useSeatNotes, useSuspicionBoard, type Board as SuspicionMarks, type BoardChannel, type NotesLoad } from "../game/notes";
import { caseData } from "../game/caseLeads";
import type { DescribeContext } from "../game/describeEvent";
import { RoomIcon } from "../art/RoomIcon";
import { BustedSpot, JobDoneSpot, WaitingSpot } from "../art/Spots";
import { RoomTile } from "../components/RoomTile";
import { SketchFrame } from "../components/SketchFrame";
import { SplitSlider } from "../components/SplitSlider";
import { useToast } from "../components/Toast";
import { Underline } from "../components/Underline";
import { boardScene, seatLooks } from "../game/board";
import { cardName, describeEvent, roleName, roomName } from "../game/describeEvent";
import {
  alibiState,
  bankTotal,
  defaultRoom,
  jobOf,
  justMissed,
  namesOf,
  outcomeOf,
  phaseInfo,
  presenceInfo,
  roomOptions,
  seatsOf,
  type Presence,
  type Timer,
} from "../game/hud";
import { lastPlan } from "../game/plan";
import { slotText } from "../game/meeting";
import { DecidingPanel, MeetingNow, MeetingsPanel, ResultsBanner, RoleCard } from "./Meetings";
import { useCountdown, useGame, useNow, type ClientCommand, type Connection, type GameChannel, type Reply } from "../game/useGame";
import { api, ApiError, sentence, UNREACHABLE, type LobbyView } from "../api";
import { navigate } from "../router";
import { GameChat } from "./GameChat";
import { GameHost } from "./GameHost";
import { TopBar } from "./TopBar";
import "./game.css";

type Access = { kind: "checking" } | { kind: "ok"; autoMeetings: boolean; dmNotices: boolean; game: LobbyView } | { kind: "lobby" } | { kind: "error"; title: string; text: string };

/** Before opening the socket: is this a started game you sit in? (The upgrade's own 401/404 can't be read by a browser.) */
function useAccess(id: string): Access {
  const [access, setAccess] = useState<Access>({ kind: "checking" });
  useEffect(() => {
    let live = true;
    api<LobbyView>("GET", `/games/${encodeURIComponent(id)}`).then(
      (game) =>
        live &&
        setAccess(game.status === "lobby" ? { kind: "lobby" } : { kind: "ok", autoMeetings: game.autoMeetings !== false, dmNotices: game.settings.dmNotices !== false, game }),
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
          <>
          {access.kind === "ok" && <GameHost gameId={id} game={access.game} view={view} control={channel.control} />}
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
          </>
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
  /** Meetings open by themselves when due (no slot proposals). design §9.4 */
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
  const ctx = useMemo(() => ({ me: view.me.id, name: namesOf(view), slot: slotText }), [view]);
  // M2-10: the private suspicion board, kept per seat on the server (the recap lives in `Away`).
  // One GET /notes per game page, shared by the recap, the suspicion board and the pins.
  const notes = useSeatNotes(gameId);
  const board = useSuspicionBoard(gameId, notes);
  const pins = usePins(gameId, notes);
  const caseBoard = useMemo(() => caseData(view, pins.pins), [view, pins.pins]);
  const people = otherSeats(view);
  return (
    <>
      <Away gameId={gameId} view={view} ctx={ctx} notes={notes} />
      <div className={outcome ? "game-grid is-over" : "game-grid"}>
        <Hud view={view} timers={timers} offset={offset} hostPaused={channel.control.pausedAt !== null} />
        <BankBoard view={view} pick={planning !== null ? pick : null} />
        <Seats view={view} presence={channel.presence} offset={offset} marks={board.board} />
        <div className="game-grid__action">
          {outcome ? <GameOver view={view} /> : <Actions view={view} timers={timers} offset={offset} send={send} autoMeetings={autoMeetings} pick={pick} channel={channel} />}
          {!outcome && <CrewBoard people={people} board={board} />}
          {view.reveal && <Reveal summary={view.reveal.summary} ctx={ctx} looks={seatLooks(view)} />}
        </div>
        {/* From 1024 px the chat and the records share the right column; below that the chat is a sheet. */}
        <div className="game-grid__side">
          <GameChat gameId={gameId} view={view} channel={channel} dmNotices={dmNotices} />
          <CaseBoard data={caseBoard} people={people} pins={pins} marks={board.board} />
        </div>
      </div>
    </>
  );
}

/** design §13: the recap on return. Its own component, so following the view never re-renders the whole screen. */
function Away({ gameId, view, ctx, notes }: { gameId: string; view: PlayerView; ctx: DescribeContext; notes: NotesLoad }) {
  const away = useAwayRecap(gameId, view, ctx, notes);
  return <AwayRecap lines={away.lines} onDismiss={away.dismiss} />;
}

/** design §12.3: your private tags on everyone else. */
function CrewBoard({ people, board }: { people: ReturnType<typeof otherSeats>; board: BoardChannel }) {
  return <SuspicionBoard people={people} board={board.board} error={board.error} onSave={board.save} />;
}

/** Everyone but you, as the case board and the suspicion board draw them. */
function otherSeats(view: PlayerView) {
  const looks = seatLooks(view);
  return seatsOf(view)
    .filter((s) => !s.you)
    .map((s) => ({ id: s.id, name: s.name, isBot: s.isBot, look: looks.get(s.id)?.look ?? 0, tag: looks.get(s.id)?.tag }));
}

function Hud({ view, timers, offset, hostPaused }: { view: PlayerView; timers: readonly Timer[]; offset: number; hostPaused: boolean }) {
  const phase = phaseInfo(view);
  const countdown = useCountdown(timers, phase.timerKey, offset);
  const emergency = view.pendingEmergency;
  const emergencyIn = useCountdown(timers, emergency ? `openMeeting:${emergency.meetingId}` : null, offset);
  const bust = bustOf(view);
  const { roundCap } = jobOf(view); // design §6.2
  return (
    <SketchFrame as="section" seed="game-hud" radius={18} shadow={0.5} className="hud" aria-label="Heist status">
      <div className="hud__phase">
        <p className="kicker hud__kicker">
          {view.round > 0 ? `Round ${view.round} of ${roundCap}` : "Setting up"}
        </p>
        <h1 className="hud__title">{phase.title}</h1>
        {countdown && (
          <p className="hud__timer">
            <span className="hud__clock" aria-hidden="true">
              <Clock />
            </span>
            <span>
              {phase.timerLabel} <b className="num">{countdown.text}</b>
              {countdown.paused && (hostPaused ? " (the host paused the game)" : " (paused for the meeting)")}
            </span>
          </p>
        )}
        {emergency && emergencyIn && (
          <p className="hud__alert">
            Emergency meeting in <b className="num">{emergencyIn.text}</b>
          </p>
        )}
      </div>
      {/* design §7.3: the share is public. */}
      <div className="hud__stat hud__share">
        <span className="meta">Share</span>
        <span className="num hud__big">{view.share}</span>
      </div>
      {/* design §6.1: the bank's coins left, public. */}
      <div className="hud__stat hud__bank">
        <span className="meta">
          Bank <InfoTip info={{ kind: "tip", id: "bank" }} />
        </span>
        <span className="num hud__big">
          {view.bank}
          <small>/{bankTotal(view)}</small>
        </span>
      </div>
      {/* design §5.4: Wanted stars, public; at the bust line the heist is busted (§5.5). */}
      <div className="hud__stat hud__wanted">
        <span className="meta">
          Wanted <InfoTip info={{ kind: "term", id: "wanted" }} />
        </span>
        <WantedStars stars={view.wanted} max={bust} />
        {view.card && view.card.round === view.round && <span className="meta">Card: {cardLabel(view)}</span>}
      </div>
    </SketchFrame>
  );
}

/** Wanted stars that make a bust. design §5.5 */
const bustOf = (view: PlayerView) => jobOf(view).alarm.bustStars;

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
        alarm={view.wanted / bustOf(view)}
        selected={scene.selected}
        closed={scene.closed}
        taped={scene.taped}
        bells={scene.bells}
        bulbs={jobOf(view).alarm.bulbs}
        pile={view.bank / bankTotal(view)}
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
function Seats({ view, presence, offset, marks }: { view: PlayerView; presence: Presence | null; offset: number; marks: SuspicionMarks | null }) {
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
                {!s.you && <SuspicionMark tag={marks?.[s.id]?.tag} />}
              </span>
            </li>
          );
        })}
      </ul>
    </SketchFrame>
  );
}

function Actions({ view, timers, offset, send, autoMeetings, pick, channel }: BoardProps & { pick: Pick; channel: GameChannel }) {
  const p = view.phase;
  const voting = p.kind === "meeting" || p.kind === "shakedownPending";
  return (
    <>
      <ResultsBanner view={view} />
      {p.kind === "meeting" && <MeetingNow view={view} timers={timers} offset={offset} send={send} />}
      {p.kind === "shakedownPending" && <DecidingPanel view={view} timers={timers} offset={offset} />}
      <PlanPanel view={view} send={send} channel={channel} />
      {p.kind === "planning" ? (
        <MovePanel key={p.round} view={view} round={p.round} timers={timers} offset={offset} send={send} autoMeetings={autoMeetings} pick={pick} />
      ) : voting ? null : (
        <WaitPanel view={view} />
      )}
      <RoleCard view={view} send={send} />
      {!voting && <MeetingsPanel view={view} timers={timers} offset={offset} send={send} autoMeetings={autoMeetings} />}
    </>
  );
}

/** design §10: the live board while a round is planned, its snapshot after, and where you post an alibi for the round that just resolved (§11.3). */
function PlanPanel({ view, send, channel }: { view: PlayerView; send: BoardProps["send"]; channel: GameChannel }) {
  const toast = useToast();
  const looks = seatLooks(view);
  const round = view.phase.kind === "planning" ? view.phase.round : null;
  const live = channel.plan;
  return (
    <PlanBoard
      seats={seatsOf(view).map((s) => ({ ...s, look: looks.get(s.id)?.look ?? 0 }))}
      rooms={roomOptions(view).map((r) => ({ id: r.id, name: r.name, closed: r.closed }))}
      board={round === null ? null : live?.round === round ? live : { round, entries: [] }}
      onEdit={async (edit) => {
        const r = await channel.sendPlan(edit);
        if (!r.ok) toast(sentence(r.reason), "bad");
      }}
      last={lastPlan(view)}
      alibi={alibiState(view)}
      onAlibi={async (round, room) => void (await send({ type: "postAlibi", round, room: room as RoomId }, "Alibi posted."))}
    />
  );
}

function WaitPanel({ view }: { view: PlayerView }) {
  const p = view.phase;
  // design §9.1–§9.3: a regular meeting or briefing is due, or the result window (an emergency can be called).
  const text =
    p.kind === "awaitingMeeting"
      ? `${MEETING_TITLE[p.meeting]} opens next.`
      : p.kind === "result" && view.emergencies > 0
        ? `Round ${p.round}'s result is in. Anyone can call an emergency meeting before the next round.`
        : "Hang tight.";
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
  const loot = picked?.loot ?? 0;
  const p = Math.min(pocket, loot);
  const missed = justMissed(view);
  const changed = !mine || mine.room !== room || mine.pocket !== p || (mine.watch ?? null) !== (picked?.watcher ? watch : null);
  const ready = picked !== null && picked.closed === null && (!picked.watcher || watch !== null);

  const lock = async () => {
    if (!picked || !ready) return;
    setBusy(true);
    // design §3.2: the old panel grabs the room's whole limit; the slider splits it between the two bags.
    await send({ type: "submitMove", move: { room: picked.id, duffel: loot - p, pocket: p, ...(picked.watcher && watch ? { watch } : {}) } }, mine ? "Move updated." : "Locked in.");
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
          {missed.room === null
            ? `You missed round ${missed.round}: the default room is taped off, so you sat the round out.`
            : `You missed round ${missed.round}: the default move sent you to the ${roomName(missed.room)}, handing everything in.`}
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
            bell={o.bell}
            notes={o.notes}
            selected={room === o.id}
            disabled={o.closed !== null}
            {...(o.closed !== null ? { disabledNote: o.closed } : {})}
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
      {picked && loot > 0 && <SplitSlider id="split" loot={loot} pocket={p} onChange={setPocket} />}
      <div className="move__foot">
        <Button variant="primary" seed="lock" icon={<Play />} disabled={!ready || busy || !changed} onClick={lock} className="move__lock">
          {mine && !changed ? "Locked in" : mine ? "Update move" : "Lock it in"}
        </Button>
        <p className="meta move__status" aria-live="polite">
          {mine
            ? `Locked in: ${roomName(mine.room)}${mine.pocket > 0 ? `, pocket ${mine.pocket}` : ", all to the duffel"}. You can change it until the deadline.`
            : `Miss the deadline and you go to the ${roomName(defaultRoom(view))}, handing everything in.`}
        </p>
      </div>
    </SketchFrame>
  );
}

export function GameOver({ view }: { view: PlayerView }) {
  const outcome = outcomeOf(view)!;
  const name = namesOf(view);
  const seats = new Map(seatsOf(view).map((s) => [s.id, s]));
  const looks = seatLooks(view);
  const won = outcome.result === "success";
  const ending = endingText(outcome);
  const end = view.ledger.find((x) => x.event.type === "gameEnded");
  return (
    <SketchFrame as="section" seed="game-over" radius={20} shadow={0.55} tape className={won ? "panel over" : "panel over is-busted"} aria-labelledby="over-h" data-ending={won ? "success" : outcome.reason}>
      <p className={won ? "over__stamp" : "over__stamp is-busted"} aria-hidden="true">
        {won ? "JOB DONE" : "BUSTED"}
      </p>
      {won ? <JobDoneSpot className="over__spot" look={seatLooks(view).get(outcome.winners[0] ?? view.me.id)?.look ?? 0} /> : <BustedSpot className="over__spot" look={seatLooks(view).get(view.me.id)?.look ?? 1} />}
      <h2 id="over-h" className="over__title">
        {won ? "The crew got away with it" : "The heist failed"}
      </h2>
      <EndingNote outcome={outcome} name={(id) => (id === view.me.id ? "You" : name(id))} />
      {end && <p>{describeEvent(end.event, { me: view.me.id, name })}</p>}
      <ol className="ranking" aria-label={ending.loss ? "Final ranking, marked as a loss" : "Final ranking"}>
        {outcome.ranking.map((r, i) => {
          const seat = seats.get(r.player);
          const winner = outcome.winners.includes(r.player);
          return (
            <li key={r.player} className={["ranking__row", winner && "is-winner", !won && !winner && "is-void", seat?.you && "is-you"].filter(Boolean).join(" ")}>
              <span className="ranking__pos num">{i + 1}</span>
              <CrookAvatar name={name(r.player).replace(/^Bot · /, "")} look={looks.get(r.player)?.look ?? 0} tag={looks.get(r.player)?.tag} size={44} bot={seat?.isBot ?? false} expression={winner ? "smug" : won ? "neutral" : "caught"} />
              <span className="ranking__who">
                <b>{seat?.you ? "You" : name(r.player)}</b>
                <span className="meta">{roleName(r.role)}</span>
                {winner && <span className="meta ranking__badge">{ending.badge}</span>}
              </span>
              <span className="ranking__score">
                <b className="num">{r.stash}</b>
                <span className="meta">stash</span>
              </span>
              {winner && <Chip on>Winner</Chip>}
              {!winner && ending.loss && <span className="meta ranking__loss">Loss</span>}
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
