// Meetings and voting on the game screen (docs/m2-plan.md M2-7): the slot
// planner, the emergency button and the sealed vote; the vote dialog; the
// shakedown window ("the crew is deciding…"); the results banner; and your
// role card with its meeting-time abilities. Everything reads the player's own
// view through game/meeting.ts. design §11.1–§11.5, ui-style "Vote window"
import { useEffect, useId, useState } from "react";
import { PERKS } from "@skimjob/content";
import type { PlayerId, PlayerView, VoteChoice } from "@skimjob/engine";
import { Avatar } from "../components/Avatar";
import { Button, DangerButton } from "../components/Button";
import { Chip } from "../components/Chip";
import { Banner, ClockFace, DialogSheet, TallyBars, type TallyBar } from "../components/MeetingKit";
import { SketchFrame } from "../components/SketchFrame";
import { TextField } from "../components/TextField";
import { MyRoleFacts, RoleList, RulebookButton, Tokens } from "../components/Extension";
import { Underline } from "../components/Underline";
import { roleName } from "../game/describeEvent";
import { namesOf, type Timer } from "../game/hud";
import {
  abilityOffers,
  claimState,
  decidingOf,
  emergencyOf,
  latestOutcome,
  localInputValue,
  MEETING_TITLE,
  MODE_NAME,
  MODE_NOTE,
  openMeetingOf,
  perksHeld,
  plannerOf,
  sameVote,
  slotFromLocal,
  slotText,
  tallyRows,
  voteTargets,
  type AbilityOffer,
  type MeetingOutcome,
  type Tally,
} from "../game/meeting";
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
function VotePicker({ view, value, onChange, label, seed }: { view: PlayerView; value: VoteChoice | null; onChange: (v: VoteChoice) => void; label: string; seed: string }) {
  return (
    <div className="vote-picker" role="group" aria-label={label}>
      {voteTargets(view).map((t) => (
        <Button
          key={t.id}
          variant="toggle"
          seed={`${seed}-${t.id}`}
          className="vote-pick"
          pressed={value?.kind === "shakedown" && value.target === t.id}
          icon={<Avatar name={plain(t.name)} size={26} bot={t.isBot} />}
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
        <h3 className="meetings__sub">Emergency meeting</h3>
        <p className="meta">{emergency.note}</p>
        <DangerButton
          seed="emergency"
          className="meetings__emergency"
          disabled={!emergency.canCall}
          armedLabel="Sure? Tap again to call it"
          onConfirm={() => void send({ type: "callEmergency" }, "Emergency meeting called.")}
        >
          Call an emergency meeting
        </DangerButton>
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
      <p className="meta">It's cast for you when the next meeting opens. Seal again to change it; turn up and you can still vote live.</p>
      <VotePicker view={view} value={pick} onChange={setPick} label="Sealed vote" seed="seal" />
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
          <h3 className="meetings__sub">Your Ballot perk</h3>
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

/** The window after a passed shakedown. Identical for everyone, whether or not anyone can act in it. */
export function DecidingPanel({ view, timers, offset }: Omit<Props, "send">) {
  const d = decidingOf(view)!;
  const who = useWho(view);
  const left = useCountdown(timers, `resolveShakedown:${d.meetingId}`, offset);
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
    </SketchFrame>
  );
}

const RESULT_TITLE = (o: MeetingOutcome, who: (p: PlayerId) => string, me: PlayerId): string => {
  switch (o.result.kind) {
    case "shakedown":
      return o.result.target === me ? "The crew voted to shake you down" : `The crew voted to shake down ${who(o.result.target)}`;
    case "skipped":
      return "The crew voted to skip";
    case "noMajority":
      return "No majority: nobody is shaken down";
    case "noQuorum":
      return "Too few votes: nothing happens";
  }
};

/** The latest meeting's result: tally, ballots (per vote mode), and the shakedown. */
export function ResultsBanner({ view }: { view: PlayerView }) {
  const o = latestOutcome(view);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const who = useWho(view);
  if (!o || !o.fresh || o.deciding || dismissed === o.meetingId) return null;
  const s = o.shakedown;
  const target = s ? cap(who(s.target)) : "";
  const are = s?.target === view.me.id ? "were" : "was";
  return (
    <SketchFrame as="section" seed={`results-${o.meetingId}`} radius={18} shadow={0.5} tape fill="var(--manilla)" className="panel results enter-sheet" aria-labelledby="results-h">
      <p className="kicker results__kicker">{MEETING_TITLE[o.kind]} · result</p>
      <h2 id="results-h" className="results__title">
        {RESULT_TITLE(o, who, view.me.id)}
      </h2>
      <TallyBars rows={bars(o.tally, who, o.result)} label="Final tally" />
      {o.ballots ? <BallotList rows={o.ballots} who={who} label="How everyone voted" /> : <p className="meta">{MODE_NOTE.secret}</p>}
      {o.cancelled && (
        <Banner seed="res-cancel" title="The shakedown was called off.">
          Nobody's stash was touched.
        </Banner>
      )}
      {s &&
        (s.clean ? (
          <Banner tone="bad" seed="res-clean" title={`Clean! ${target} ${are} holding ${s.stashRevealed}.`}>
            Nothing above the share: nothing taken.
          </Banner>
        ) : (
          <Banner tone="good" seed="res-dirty" title={`Caught! ${target} ${are} holding ${s.stashRevealed}.`}>
            {s.taken} set aside for the next split.
          </Banner>
        ))}
      <Button variant="secondary" seed="results-ok" onClick={() => setDismissed(o.meetingId)} className="results__ok">
        Got it
      </Button>
    </SketchFrame>
  );
}

// ---------------------------------------------------------------- your role card and its abilities

export function RoleCard({ view, send, claim = true }: { view: PlayerView; send: Send; claim?: boolean }) {
  const offers = abilityOffers(view);
  const perks = perksHeld(view);
  const [open, setOpen] = useState(false);
  const panel = useId();
  const show = open && offers.length > 0;
  return (
    <SketchFrame as="section" seed="role-card" radius={16} shadow={0.45} fill="var(--card-sand)" className="panel role-card" aria-labelledby="role-h">
      <div className="role-card__head">
        <div>
          <p className="meta">Your role · only you see this</p>
          <h2 id="role-h" className="role-card__name">
            {roleName(view.me.role)}
          </h2>
        </div>
        <span className="role-card__stash">
          <span className="meta">stash</span> <b className="num">{view.me.stash}</b>
        </span>
      </div>
      <MyRoleFacts view={view} />
      <Tokens view={view} send={send} />
      {perks.length > 0 && (
        <ul className="role-card__perks" aria-label="Your perks">
          {perks.map((p) => (
            <li key={p.id} title={PERKS[p.id]?.effect}>
              <Chip colour="var(--gold)">
                {p.name}
                {p.count > 1 ? ` ×${p.count}` : ""}
              </Chip>
            </li>
          ))}
        </ul>
      )}
      {claim && <ClaimRole view={view} send={send} where="card" />}
      {offers.length > 0 && (
        <Button variant="small" seed="use-ability" aria-expanded={show} aria-controls={panel} onClick={() => setOpen(!open)} className="role-card__use">
          {show ? "Hide abilities" : "Use ability"}
        </Button>
      )}
      {show && (
        <div id={panel} className="abilities">
          {offers.map((o) => (
            <AbilityRow key={o.kind} view={view} offer={o} send={send} done={() => setOpen(false)} />
          ))}
        </div>
      )}
      <div className="role-card__foot">
        <RoleList view={view} />
        <RulebookButton view={view} />
      </div>
    </SketchFrame>
  );
}

function AbilityRow({ view, offer, send, done }: { view: PlayerView; offer: AbilityOffer; send: Send; done: () => void }) {
  const who = useWho(view);
  const [target, setTarget] = useState<PlayerId | null>(null);
  const use = async (ability: Parameters<Send>[0] & { type: "useAbility" }, msg: string) => {
    const r = await send(ability, msg);
    if (r.ok) done();
  };
  const targets = (ids: readonly PlayerId[], label: string) => (
    <div className="move__chips" role="group" aria-label={label}>
      {ids.map((id) => (
        <Button key={id} variant="toggle" seed={`ab-${offer.kind}-${id}`} pressed={target === id} onClick={() => setTarget(id)}>
          {cap(who(id))}
        </Button>
      ))}
    </div>
  );
  switch (offer.kind) {
    case "extraVote":
      return (
        <div className="ability">
          <p>
            <b>{PERKS.extraVote.name}:</b> {PERKS.extraVote.effect}
          </p>
          <Button variant="secondary" seed="ab-extra" onClick={() => void use({ type: "useAbility", ability: { kind: "extraVote" } }, "+Vote spent.")}>
            Spend +Vote
          </Button>
        </div>
      );
    case "ballot":
      return (
        <div className="ability">
          <p>
            <b>{PERKS.ballot.name}:</b> {PERKS.ballot.effect}
          </p>
          {targets(offer.targets, "Ballot to watch")}
          <Button variant="secondary" seed="ab-ballot" disabled={!target} onClick={() => target && void use({ type: "useAbility", ability: { kind: "ballot", target } }, "You're watching that ballot.")}>
            Watch ballot
          </Button>
        </div>
      );
  }
}

/** A formal, public, possibly false role claim, once between meetings (R4b; design §8, §12.1). */
export function ClaimRole({ view, send, where }: { view: PlayerView; send: Send; where: "alibi" | "card" }) {
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
      <Button variant={where === "card" ? "small" : "secondary"} seed={`claim-role-${where}`} className="claim__toggle" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
        {open ? "Never mind" : "Claim role"}
      </Button>
      {open && (
        <div id={panel} className="claim">
          <p>
            Tell the crew which role you have. Everyone sees it, it doesn't have to be true, and you get one claim between meetings.
          </p>
          <div className="move__chips" role="group" aria-label="Role to claim">
            {claim.options.map((o) => (
              <Button key={o.id} variant="toggle" seed={`claim-${where}-${o.id}`} pressed={role === o.id} onClick={() => setRole(o.id)}>
                {o.name}
              </Button>
            ))}
          </div>
          <Button variant="primary" seed={`claim-go-${where}`} disabled={!role || busy} onClick={go}>
            {role ? `Claim the ${roleName(role)}` : "Pick a role"}
          </Button>
        </div>
      )}
    </>
  );
}
