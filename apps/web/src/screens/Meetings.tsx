// Meetings and shakedowns on the game screen: the slot planner, the emergency
// pool and the sealed vote; the vote dialog with its briefing; the Bail choice
// window ("the crew is deciding…"); the shakedown result card; and your role
// card. Everything reads the player's own view through game/meeting.ts.
// design §9.1–§9.7, §12, ui-style "Vote window"
import { useContext, useEffect, useId, useState } from "react";
import { PERK_TEXT } from "@skimjob/content";
import type { MeetingKind, PlayerId, PlayerView, VoteChoice } from "@skimjob/engine";
import { Avatar } from "../components/Avatar";
import { seatOfPlayer } from "../components/avatarLooks";
import { Button, DangerButton } from "../components/Button";
import { Chip } from "../components/Chip";
import { Banner, ClockFace, DialogSheet, ProtectedBanner, TallyBars, type TallyBar } from "../components/MeetingKit";
import { SketchFrame } from "../components/SketchFrame";
import { TextField } from "../components/TextField";
import { InfoTip, MoreInGame } from "../components/InfoTip";
import { RoleCardDialog, RolesInPlay } from "../components/RoleCard";
import { Pin, Shield } from "../components/icons";
import { useToast } from "../components/Toast";
import { Underline } from "../components/Underline";
import { RoleIcon } from "../art/RoleIcon";
import { roleName } from "../game/describeEvent";
import { namesOf, type Timer } from "../game/hud";
import type { PinsChannel } from "../game/notes";
import {
  bailPromptOf,
  claimState,
  decidingOf,
  emergencyOf,
  latestOutcome,
  localInputValue,
  MEETING_TITLE,
  MEETING_WHY,
  MODE_NAME,
  MODE_NOTE,
  openMeetingOf,
  plannerOf,
  protectedPlayers,
  sameVote,
  slotFromLocal,
  slotText,
  tallyRows,
  voteTargets,
  type MeetingOutcome,
  type Tally,
} from "../game/meeting";
import { roleInfo, rolesOf } from "../game/roles";
import { useCountdown, type ClientCommand, type Reply } from "../game/useGame";
import "./meetings.css";

type Send = (cmd: ClientCommand, done?: string) => Promise<Reply>;

interface Props {
  readonly view: PlayerView;
  readonly timers: readonly Timer[];
  readonly offset: number;
  readonly send: Send;
}

const plain = (name: string) => name.replace(/^Bot · /, "");
const useWho = (view: PlayerView) => {
  const name = namesOf(view);
  return (p: PlayerId) => (p === view.me.id ? "you" : name(p));
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function voteText(v: VoteChoice | null, who: (p: PlayerId) => string): string {
  if (!v) return "no vote yet";
  return v.kind === "skip" ? "skip" : `shake down ${who(v.target)}`;
}

/** Pick a player to shake down, or Skip: avatar toggles. */
function VotePicker({ view, value, onChange, label, seed, sealed = false }: { view: PlayerView; value: VoteChoice | null; onChange: (v: VoteChoice) => void; label: string; seed: string; sealed?: boolean }) {
  return (
    <div className="vote-picker" role="group" aria-label={label}>
      {voteTargets(view, sealed).map((t) => (
        <Button
          key={t.id}
          variant="toggle"
          seed={`${seed}-${t.id}`}
          className="vote-pick"
          pressed={value?.kind === "shakedown" && value.target === t.id}
          icon={<Avatar name={plain(t.name)} seat={seatOfPlayer(t.id)} size={26} bot={t.isBot} />}
          onClick={() => onChange({ kind: "shakedown", target: t.id })}
        >
          {t.name}
        </Button>
      ))}
      <Button variant="toggle" seed={`${seed}-skip`} className="vote-pick vote-pick--skip" pressed={value?.kind === "skip"} onClick={() => onChange({ kind: "skip" })}>
        Skip
      </Button>
    </div>
  );
}

const bars = (tally: Tally, who: (p: PlayerId) => string, result: Parameters<typeof tallyRows>[1] = null): TallyBar[] =>
  tallyRows(tally, result).map((r) => ({ ...r, label: r.target === null ? "Skip" : cap(who(r.target)) }));

// ---------------------------------------------------------------- planner, emergency, sealed vote (§11.1, §11.2)

export function MeetingsPanel({ view, timers, offset, send, autoMeetings }: Props & { autoMeetings: boolean }) {
  const planner = plannerOf(view);
  const emergency = emergencyOf(view);
  const who = useWho(view);
  const opensIn = useCountdown(timers, planner.locked ? `openMeeting:${planner.locked.meetingId}` : null, offset);
  return (
    <SketchFrame as="section" seed="game-meetings" radius={16} shadow={0.45} className="panel meetings" aria-labelledby="meetings-h">
      <div className="panel__head">
        <h2 id="meetings-h" className="panel__title">
          <Underline seed="meet">Crew meetings</Underline>
        </h2>
        <span className="meta">votes: {MODE_NAME[view.voteVisibility]}</span>
      </div>

      <div className="meetings__block">
        <h3 className="meetings__sub">Next meeting</h3>
        {planner.locked ? (
          <p>
            Set for <b>{slotText(planner.locked.slot)}</b>
            {autoMeetings ? "." : ". It opens then, or once it's due if that's later."}
            {opensIn && (
              <>
                {" "}
                Opens in <b className="num">{opensIn.text}</b>.
              </>
            )}
          </p>
        ) : autoMeetings ? (
          <p>It opens by itself when it's due: each time a third of the bank is gone, or after a raid.</p>
        ) : (
          <SlotPlanner view={view} send={send} offset={offset} who={who} />
        )}
      </div>

      <div className="meetings__block">
        <h3 className="meetings__sub">
          Emergency pool <InfoTip info={{ kind: "tip", id: "emergency" }} />
        </h3>
        <p className="meta">
          <b className="num">{emergency.left}</b> left for the crew. {emergency.note}
        </p>
        {emergency.inWindow && (
          <DangerButton
            seed="emergency"
            className="meetings__emergency"
            disabled={!emergency.canCall}
            armedLabel="Sure? Tap again to call it"
            onConfirm={() => void send({ type: "callEmergency" }, "Emergency meeting called.")}
          >
            Call an emergency meeting
          </DangerButton>
        )}
      </div>

      <SealedVote view={view} send={send} who={who} />
    </SketchFrame>
  );
}

function SlotPlanner({ view, send, offset, who }: { view: PlayerView; send: Send; offset: number; who: (p: PlayerId) => string }) {
  const planner = plannerOf(view);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const slot = slotFromLocal(value);
  const min = localInputValue(Date.now() + offset);
  const propose = async () => {
    if (!slot) return;
    setBusy(true);
    const r = await send({ type: "proposeMeeting", slot }, "Time proposed.");
    if (r.ok) setValue("");
    setBusy(false);
  };
  return (
    <>
      {planner.proposals.length > 0 ? (
        <ul className="proposals" aria-label="Proposed times">
          {planner.proposals.map((p) => (
            <li key={p.id} className="proposals__row">
              <span className="proposals__what">
                <b>{slotText(p.slot)}</b>
                <span className="meta">
                  {p.by === view.me.id ? "your idea" : `from ${who(p.by)}`} · {p.backers} of {planner.needed} needed
                </span>
              </span>
              <Button variant="small" seed={`back-${p.id}`} disabled={p.backed || !planner.open} onClick={() => void send({ type: "acceptMeeting", proposalId: p.id }, "You backed that time.")}>
                {p.backed ? "Backed" : "Back this time"}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta">Nobody has proposed a time yet. If nobody locks one in, the app picks one when it's due.</p>
      )}
      <div className="slot-form">
        <TextField
          label="Propose a time"
          seed="slot"
          type="datetime-local"
          min={min}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          hint={`Locked in once ${planner.needed} of the crew's people back it (bots' backing doesn't count).`}
        />
        <Button variant="secondary" seed="propose" disabled={!slot || busy || !planner.open} onClick={propose}>
          Propose
        </Button>
      </div>
    </>
  );
}

function SealedVote({ view, send, who }: { view: PlayerView; send: Send; who: (p: PlayerId) => string }) {
  const sealed = view.me.sealedVote;
  const [pick, setPick] = useState<VoteChoice | null>(sealed);
  const [busy, setBusy] = useState(false);
  const seal = async () => {
    if (!pick) return;
    setBusy(true);
    await send({ type: "sealVote", vote: pick }, "Vote sealed.");
    setBusy(false);
  };
  return (
    <details className="meetings__block sealed">
      <summary className="sealed__summary">
        <span className="meetings__sub">Can't make the meeting?</span>
        <span className="meta">{sealed ? `Sealed: ${voteText(sealed, who)}` : "Leave a sealed vote"}</span>
      </summary>
      <p className="meta">It's cast for you when the next meeting opens. Seal again to change it; turn up and you can still vote live. A protected player is still on this list: if they're protected when the meeting opens, your vote counts as a skip.</p>
      <VotePicker view={view} value={pick} onChange={setPick} label="Sealed vote" seed="seal" sealed />
      <Button variant="secondary" seed="seal-go" disabled={!pick || busy || sameVote(pick, sealed)} onClick={seal}>
        {sealed ? "Seal this instead" : "Seal vote"}
      </Button>
    </details>
  );
}

// ---------------------------------------------------------------- the vote window (§11.2)

export function MeetingNow({ view, timers, offset, send }: Props) {
  const m = openMeetingOf(view)!;
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const open = closedFor !== m.meetingId;
  const who = useWho(view);
  const left = useCountdown(timers, `closeMeeting:${m.meetingId}`, offset);
  return (
    <>
      <SketchFrame as="section" seed="game-meeting-now" radius={16} shadow={0.45} fill="var(--card-sand)" className="panel" aria-labelledby="meeting-now-h">
        <div className="panel__head">
          <h2 id="meeting-now-h" className="panel__title">
            <Underline seed="meeting-now">{MEETING_TITLE[m.kind]}</Underline>
          </h2>
          {left && <span className="meta">votes close in {left.text}</span>}
        </div>
        <p>
          Your vote: <b>{voteText(m.mine, who)}</b>.
        </p>
        <Button variant="primary" seed="open-vote" onClick={() => setClosedFor(null)} className="meetings__open">
          {m.mine ? "Change your vote" : "Vote now"}
        </Button>
      </SketchFrame>
      <DialogSheet open={open} onClose={() => setClosedFor(m.meetingId)} seed={`vote-${m.meetingId}`} labelledBy="vote-h">
        <VoteSheet key={m.meetingId} view={view} timers={timers} offset={offset} send={send} onDone={() => setClosedFor(m.meetingId)} />
      </DialogSheet>
    </>
  );
}

/** Why this meeting is on, the emergency pool, and who can't be voted on. design §9.1–§9.3, §9.7 */
function Briefing({ view, kind, who }: { view: PlayerView; kind: MeetingKind; who: (p: PlayerId) => string }) {
  const shielded = protectedPlayers(view);
  return (
    <div className="briefing">
      <p>{MEETING_WHY[kind]}</p>
      <p className="meta">
        Emergency pool: <b className="num">{view.emergencies}</b> left for the crew.
      </p>
      {shielded.length > 0 && (
        <p className="briefing__protected">
          <Shield />
          <span>
            <b>Protected</b> until the next regular meeting, so not on the list: {shielded.map((p) => cap(who(p))).join(", ")}.
          </span>
        </p>
      )}
    </div>
  );
}

function VoteSheet({ view, timers, offset, send, onDone }: Props & { onDone: () => void }) {
  const m = openMeetingOf(view);
  const who = useWho(view);
  const [pick, setPick] = useState<VoteChoice | null>(m?.mine ?? null);
  const [busy, setBusy] = useState(false);
  const left = useCountdown(timers, m ? `closeMeeting:${m.meetingId}` : null, offset);
  const status = useId();
  useEffect(() => {
    // A sealed vote that lands as the window opens becomes the picked option.
    if (m?.mine && pick === null) setPick(m.mine);
  }, [m?.mine, pick]);
  if (!m) return null;
  const changed = pick !== null && !sameVote(pick, m.mine);
  const cast = async () => {
    if (!pick) return;
    setBusy(true);
    await send({ type: "castVote", vote: pick }, m.mine ? "Vote changed." : "Vote cast.");
    setBusy(false);
  };
  return (
    <div className="vote">
      <div className="vote__head">
        <div>
          <p className="kicker vote__kicker">
            {`${MEETING_TITLE[m.kind]}${m.calledBy ? ` · called by ${who(m.calledBy)}` : ""}`}
          </p>
          <h2 id="vote-h" className="vote__title">
            Who's skimming?
          </h2>
        </div>
        {left && (
          <p className="vote__clock">
            <ClockFace ms={left.ms} />
            <span className="meta">
              closes in <b className="num">{left.text}</b>
            </span>
          </p>
        )}
      </div>
      <Briefing view={view} kind={m.kind} who={who} />
      <p className="meta">{MODE_NOTE[m.mode]}</p>
      <VotePicker view={view} value={pick} onChange={setPick} label="Your vote" seed={`vote-${m.meetingId}`} />
      <div className="vote__foot">
        <Button variant="primary" seed="cast" disabled={!changed || busy} onClick={cast} aria-describedby={status}>
          {m.mine && !changed ? "Vote cast" : m.mine ? "Change vote" : "Cast vote"}
        </Button>
        <p id={status} className="meta vote__status" aria-live="polite">
          {m.mine
            ? `Your vote: ${voteText(m.mine, who)}${m.fromSealed ? " (from your sealed vote)" : ""}. You can change it until the window closes.`
            : "Pick someone to shake down, or skip. You can change it until the window closes."}
        </p>
      </div>
      {m.live && (
        <div className="vote__live">
          <h3 className="meetings__sub">Live tally</h3>
          <TallyBars rows={bars(m.live, who)} label="Live tally" />
        </div>
      )}
      {m.ballots.length > 0 && <BallotList rows={m.ballots} who={who} label="Ballots so far" />}
      {m.seen.length > 0 && (
        <div className="vote__seen">
          <h3 className="meetings__sub">Your Check ballot</h3>
          <ul className="ballots" aria-label="Ballots you can see">
            {m.seen.map((b) => (
              <li key={b.player}>
                <b>{cap(who(b.player))}</b>: {voteText(b.vote, who)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button variant="ghost" seed="vote-back" onClick={onDone} className="vote__back">
        Back to the board
      </Button>
    </div>
  );
}

function BallotList({ rows, who, label }: { rows: readonly { player: PlayerId; vote: VoteChoice | null }[]; who: (p: PlayerId) => string; label: string }) {
  return (
    <ul className="ballots" aria-label={label}>
      {rows.map((b) => (
        <li key={b.player}>
          <b>{cap(who(b.player))}</b>: {voteText(b.vote, who)}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- the shakedown window and results (§11.3, §11.4)

/** The window after a passed shakedown. Identical for everyone but a Bail holder's own prompt, so it never tells who holds one. */
export function DecidingPanel({ view, timers, offset, send }: Props) {
  const d = decidingOf(view)!;
  const who = useWho(view);
  const left = useCountdown(timers, `resolveShakedown:${d.meetingId}`, offset);
  const bail = bailPromptOf(view);
  const toast = useToast();
  // design §17.4: the holder is told as the window opens.
  const holder = bail !== null;
  useEffect(() => {
    if (holder) toast("The crew voted to shake you down. Use your Bail, or keep it.", "bad");
  }, [holder, d.meetingId, toast]);
  return (
    <SketchFrame as="section" seed="game-deciding" radius={16} shadow={0.45} fill="var(--card-sand)" className="panel deciding" aria-labelledby="deciding-h" aria-live="polite">
      <div className="panel__head">
        <h2 id="deciding-h" className="panel__title">
          <Underline seed="deciding">The crew is deciding…</Underline>
        </h2>
        {left && (
          <span className="vote__clock">
            <ClockFace ms={left.ms} />
            <span className="meta">
              lands in <b className="num">{left.text}</b>
            </span>
          </span>
        )}
      </div>
      <p>
        The vote went against <b>{who(d.target)}</b>. The shakedown lands when the clock runs out.
      </p>
      {bail && <BailChoice use={bail.use} answered={bail.answered} send={send} />}
    </SketchFrame>
  );
}

/** The target's private Bail choice, before the stash opens; no answer means don't use. design §9.6 */
function BailChoice({ use, answered, send }: { use: boolean; answered: boolean; send: Send }) {
  const [busy, setBusy] = useState(false);
  const choose = async (next: boolean) => {
    setBusy(true);
    await send({ type: "chooseBail", use: next }, next ? "You'll use your Bail." : "You'll keep your Bail.");
    setBusy(false);
  };
  return (
    <div className="bail" role="group" aria-label="Your Bail choice">
      <p>
        <b>Use your Bail?</b> The shakedown falls through and your stash stays closed. Only you see this, and you can change your answer until the clock runs out. No answer means don't use it.
      </p>
      <div className="bail__choices">
        <Button variant="toggle" seed="bail-use" pressed={answered && use} disabled={busy} onClick={() => void choose(true)}>
          Use Bail
        </Button>
        <Button variant="toggle" seed="bail-keep" pressed={!use} disabled={busy} onClick={() => void choose(false)}>
          Don't use it
        </Button>
      </div>
      <p className="meta" aria-live="polite">
        {answered ? `Your answer: ${use ? "use Bail" : "keep it"}.` : "No answer yet: it counts as keeping it."}
      </p>
    </div>
  );
}

const RESULT_TITLE = (o: MeetingOutcome, who: (p: PlayerId) => string, me: PlayerId): string => {
  if (o.cancelled) return "A shakedown fell through";
  switch (o.result.kind) {
    case "shakedown":
      return o.result.target === me ? "You were shaken down" : `${cap(who(o.result.target))} shaken down`;
    case "skipped":
      return "The crew voted to skip";
    case "noMajority":
      return "No majority: nobody is shaken down";
    case "noQuorum":
      return "Too few votes: nothing happens";
  }
};

/** The latest meeting's result, as a taped card: tally, ballots (per vote mode), the shakedown's rows and the protection. design §9.6, §9.7 */
/** The meeting result card to show now, or null: none yet, a newer round has resolved, the Bail window is open, or you closed it. design §9.6 */
export function resultCardOf(view: PlayerView, dismissed: string | null): MeetingOutcome | null {
  const o = latestOutcome(view);
  return o && o.fresh && !o.deciding && dismissed !== o.meetingId ? o : null;
}

export function ResultDialog({ view, pins, dismissed, onDismiss }: { view: PlayerView; pins: PinsChannel; dismissed: string | null; onDismiss: (meetingId: string) => void }) {
  const o = resultCardOf(view, dismissed);
  const who = useWho(view);
  // showModal focuses the first control, an InfoTip whose focus preview would open by itself: start on the primary button.
  const shownId = o?.meetingId ?? null;
  useEffect(() => {
    if (shownId) document.getElementById("results-ok")?.focus();
  }, [shownId]);
  if (!o) return null;
  const s = o.shakedown;
  const target = o.result.kind === "shakedown" ? o.result.target : null;
  const mine = target === view.me.id;
  const leadId = `m.${o.meetingId}`;
  const pinned = pins.pins.has(leadId);
  const close = () => onDismiss(o.meetingId);
  return (
    <DialogSheet open onClose={close} seed={`results-${o.meetingId}`} labelledBy="results-h">
      <div className="result">
        <div className="result__head">
          {target && <Avatar name={plain(who(target))} seat={seatOfPlayer(target)} size={52} bot={view.players.find((p) => p.id === target)?.isBot} />}
          <div>
            <p className="meta">
              {MEETING_TITLE[o.kind]} after R{o.round}
            </p>
            <h2 id="results-h" className="result__title">
              {RESULT_TITLE(o, who, view.me.id)}
            </h2>
          </div>
        </div>
        <TallyBars rows={bars(o.tally, who, o.result)} label="Final tally" />
        {o.ballots ? <BallotList rows={o.ballots} who={who} label="How everyone voted" /> : <p className="meta">{MODE_NOTE.secret}</p>}
        {o.cancelled && <Banner seed="res-cancel" title="Nobody's stash was opened." />}
        {s && (
          <dl className="result__rows" aria-label="The stash">
            <div>
              <dt>
                {mine ? "Your stash" : `${cap(who(s.target))}'s stash`} <InfoTip info={{ kind: "term", id: "stash" }} />
              </dt>
              <dd className="num">{s.stashRevealed}</dd>
            </div>
            <div>
              <dt>
                Share <InfoTip info={{ kind: "term", id: "share" }} />
              </dt>
              <dd className="num">{view.share}</dd>
            </div>
            {s.clean ? (
              <div>
                <dt>Clean: nothing above the share.</dt>
              </div>
            ) : (
              <div>
                <dt>
                  Into the next split <InfoTip info={{ kind: "term", id: "shakedown" }} />
                </dt>
                <dd className="num result__back">+{s.taken}</dd>
              </div>
            )}
          </dl>
        )}
        {target && (s || o.cancelled) && view.protected.includes(target) && <ProtectedBanner seed="res-protected">until the next regular meeting</ProtectedBanner>}
        <div className="result__foot">
          <Button variant="secondary" seed="results-pin" icon={<Pin on={pinned} />} aria-pressed={pinned} disabled={!pins.ready} onClick={() => pins.toggle(leadId)}>
            {pinned ? "Pinned" : "Pin"}
          </Button>
          <Button variant="primary" seed="results-ok" id="results-ok" onClick={close}>
            Back to the bank
          </Button>
        </div>
      </div>
    </DialogSheet>
  );
}

// ---------------------------------------------------------------- your role card

/** Your role at a glance, the Bail chip, and the role card, the rulebook and the roles in play one tap away. */
export function RoleCard({ view, send }: { view: PlayerView; send: Send }) {
  const [open, setOpen] = useState(false);
  const openRules = useContext(MoreInGame);
  const info = roleInfo(view.me.role, rolesOf(view));
  return (
    <SketchFrame as="section" seed="role-card" radius={16} shadow={0.45} fill="var(--card-sand)" className="panel role-card" aria-labelledby="role-h">
      <div className="role-card__head">
        <div>
          <p className="meta">Your role · only you see this</p>
          <div className="role-card__title">
            <h2 id="role-h" className="role-card__name">
              <RoleIcon role={view.me.role} size={28} /> {roleName(view.me.role)}
            </h2>
            <InfoTip info={{ kind: "role", id: view.me.role }} />
          </div>
        </div>
        <span className="role-card__stash">
          <span className="meta">stash</span> <b className="num">{view.me.stash}</b>
        </span>
      </div>
      {info && <p>{info.power}</p>}
      {view.me.roleState.bail && (
        <ul className="role-card__perks" aria-label="Your perks">
          <li>
            <Chip colour="var(--gold)">{PERK_TEXT.bail?.name}</Chip> <InfoTip info={{ kind: "perk", id: "bail" }} />
          </li>
        </ul>
      )}
      <ClaimRole view={view} send={send} />
      <div className="role-card__foot">
        <Button variant="small" seed="role-card-open" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          Role card
        </Button>
        {openRules && (
          <Button variant="small" seed="rules-open" aria-haspopup="dialog" onClick={openRules}>
            Rules
          </Button>
        )}
      </div>
      <RolesInPlay view={view} />
      <RoleCardDialog view={view} open={open} onClose={() => setOpen(false)} send={send} claim={<ClaimRole view={view} send={send} />} />
    </SketchFrame>
  );
}

/** A formal, public, possibly false role claim, once between meetings (R4b; design §8, §12.1). */
function ClaimRole({ view, send }: { view: PlayerView; send: Send }) {
  const claim = claimState(view);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useId();
  if (!claim) return null;
  if (claim.claimed)
    return (
      <p className="meta claim__done">
        You claimed to be the <b>{roleName(claim.claimed)}</b>. One claim between meetings: your next one comes after the next meeting.
      </p>
    );
  const go = async () => {
    if (!role) return;
    setBusy(true);
    const r = await send({ type: "claimRole", role }, "Role claimed.");
    setBusy(false);
    if (r.ok) setOpen(false);
  };
  return (
    <>
      <Button variant="small" seed="claim-role" className="claim__toggle" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
        {open ? "Never mind" : "Claim role"}
      </Button>
      {open && (
        <div id={panel} className="claim">
          <p>
            Tell the crew which role you have. Everyone sees it, it doesn't have to be true, and you get one claim between meetings.
          </p>
          <div className="move__chips" role="group" aria-label="Role to claim">
            {claim.options.map((o) => (
              <Button key={o.id} variant="toggle" seed={`claim-${o.id}`} pressed={role === o.id} onClick={() => setRole(o.id)}>
                {o.name}
              </Button>
            ))}
          </div>
          <Button variant="primary" seed="claim-go" disabled={!role || busy} onClick={go}>
            {role ? `Claim the ${roleName(role)}` : "Pick a role"}
          </Button>
        </div>
      )}
    </>
  );
}
