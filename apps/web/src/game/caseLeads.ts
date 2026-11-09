// The case board's adapter (design §15.4): your own view in, the leads, their ⚠
// and the suspect out. It reads only what `viewFor` gave you, the public ledger
// and your own case file, never the end-of-game reveal: nothing hidden is
// revealed, only shown better. Ids are stable between views (a lead is its round
// and subject; a fact adds its seq in your view), so pins survive new events.
import type { RoleId, RoomId } from "@skimjob/content";
import { eventsFor, type CaseFileEvent, type GameEvent, type LoggedEvent, type PlayerId, type PlayerView, type PublicEvent } from "@skimjob/engine";
import { suspectOf, type CaseData, type Fact, type Lead, type Trust, type Warning } from "./caseBoard";
import { bellChecks, overClaimed, storyChecks, type CheckContext, type RoomRound, type RoundFacts } from "./caseChecks";
import { cardName, describeEvent, perkName, roleName, roomName } from "./describeEvent";
import { jobOf, namesOf, seatsOf, setupOf } from "./hud";
import { MEETING_TITLE, slotText } from "./meeting";

interface Draft {
  readonly id: string;
  readonly round: number;
  title: string;
  summary: string[];
  bell: boolean;
  readonly names: Set<PlayerId>;
  readonly facts: Fact[];
  readonly warnings: Warning[];
}

interface MutableRoom {
  rings: number | null;
  /** The lit bulbs `rings` came to (for a bell whose start you never saw). */
  lit: number | null;
  hidden: boolean;
  raided: boolean;
  seized: number;
  dark: boolean;
  watched: boolean;
  seen: Map<PlayerId, "room" | "feed">;
  myCoins: number | null;
}

interface MutableRound {
  card: RoundFacts["card"];
  readonly rooms: Map<RoomId, MutableRoom>;
  readonly plan: Map<PlayerId, RoomId>;
  readonly alibis: Map<PlayerId, RoomId>;
  bankEmptied: boolean;
}

/** Public or private, by where the event sits (design §15.4 trust levels): said, a game fact, or seen by you. */
const trustOf = (e: GameEvent): Trust => (e.visibility.kind === "public" ? (e.type === "said" ? "said" : "fact") : "seen");

export function caseData(view: PlayerView, pins: ReadonlySet<string>): CaseData {
  const me = view.me.id;
  const name = namesOf(view);
  const describe = (e: GameEvent) => describeEvent(e, { me, name, slot: slotText });
  const who = (p: PlayerId) => (p === me ? "you" : name(p));
  const job = jobOf(view);

  const drafts = new Map<string, Draft>();
  const lead = (id: string, round: number, title: string): Draft => {
    let d = drafts.get(id);
    if (!d) drafts.set(id, (d = { id, round, title, summary: [], bell: false, names: new Set(), facts: [], warnings: [] }));
    return d;
  };
  const fact = (d: Draft, id: string, text: string, trust: Trust, names: readonly PlayerId[] = []) => {
    d.facts.push({ id: `${d.id}:${id}`, text, trust });
    for (const p of names) if (p !== me) d.names.add(p);
  };
  const roomLead = (round: number, room: RoomId) => lead(`r${round}.room.${room}`, round, roomName(room));
  const meetingLead = (round: number, meetingId: string) => lead(`m.${meetingId}`, round, "Meeting");
  const crewLead = (round: number) => lead(`r${round}.crew`, round, "Crew");

  const rounds = new Map<number, MutableRound>();
  const roundOf = (r: number): MutableRound => {
    let x = rounds.get(r);
    if (!x) rounds.set(r, (x = { card: null, rooms: new Map(), plan: new Map(), alibis: new Map(), bankEmptied: false }));
    return x;
  };
  const roomOf = (r: number, room: RoomId): MutableRoom => {
    const rr = roundOf(r).rooms;
    let x = rr.get(room);
    if (!x) rr.set(room, (x = { rings: null, lit: null, hidden: false, raided: false, seized: 0, dark: false, watched: false, seen: new Map(), myCoins: null }));
    return x;
  };
  /** Lit bulbs as last seen per room; a room missing has an unknown bell (hidden, or off). */
  let known = new Map<RoomId, number>(view.rooms.map((r) => [r, 0]));
  /** Rooms whose bell went off (a raid) or was reopened: back at 0 when they ring again. */
  const atZero = new Set<RoomId>();
  const sold = new Map<string, number>();
  const bought = new Map<string, number>();
  const count = (m: Map<string, number>, round: number, perk: string) => m.set(`${round}:${perk}`, (m.get(`${round}:${perk}`) ?? 0) + 1);
  const claims = new Map<PlayerId, { role: RoleId; round: number }>();
  /** Your own Plant evidence: "round:room" → the player you put on its feeds. You know that sighting is fake. */
  const myPlants = new Map<string, PlayerId>();
  let round = 0;

  const all: LoggedEvent<PublicEvent | CaseFileEvent>[] = [...view.ledger, ...view.caseFile].sort((a, b) => a.seq - b.seq);
  for (const { seq, event: e } of all) {
    const trust = trustOf(e);
    const text = () => describe(e);
    switch (e.type) {
      case "roundStarted":
        round = e.round;
        break;
      case "eventFlipped": {
        roundOf(e.round).card = { round: e.round, id: e.card, room: e.room };
        const d = lead(`r${e.round}.event`, e.round, cardName(e.card));
        if (e.room) d.summary.push(`${roomName(e.room)} closed`);
        fact(d, `${seq}`, text(), trust);
        break;
      }
      case "auditReport":
      case "insideTip": {
        const d = e.type === "insideTip" ? crewLead(e.round) : lead(`r${e.round}.event`, e.round, "Audit");
        fact(d, `${seq}`, text(), trust, e.type === "insideTip" ? [e.subject] : []);
        break;
      }
      case "powerCut": {
        roomOf(e.round, e.room).dark = true;
        fact(roomLead(e.round, e.room), `${seq}`, text(), trust);
        break;
      }
      case "coinsGrabbed": {
        roomOf(e.round, e.room).myCoins = e.duffel + e.pocket + e.seized;
        fact(roomLead(e.round, e.room), `${seq}`, text(), trust);
        break;
      }
      case "defaultMoveAssigned":
      case "duffelSplit":
        fact(lead(`r${e.round}.haul`, e.round, "Haul"), `${seq}`, text(), trust);
        break;
      case "roundResolved": {
        roundOf(e.round).bankEmptied = e.bank === 0;
        const d = lead(`r${e.round}.haul`, e.round, "Haul");
        if (e.missing > 0) {
          d.title = "Missing";
          d.summary.push(`${e.missing} ${e.missing === 1 ? "coin" : "coins"} never reached the duffel`);
        } else d.summary.push(`${e.taken} taken · none missing`);
        fact(d, `${seq}`, text(), trust);
        break;
      }
      case "bellsRung": {
        for (const room of e.hidden) {
          const rr = roomOf(e.round, room);
          rr.hidden = true;
          fact(roomLead(e.round, room), `${seq}.hidden`, "The bell is hidden: it shows ?.", trust);
        }
        for (const [room, lit] of Object.entries(e.bells)) {
          const rr = roomOf(e.round, room);
          const before = known.get(room) ?? (atZero.has(room) ? 0 : undefined);
          atZero.delete(room);
          rr.lit = lit;
          rr.rings = before === undefined ? null : lit - before;
          if (rr.rings === 0) continue;
          const d = roomLead(e.round, room);
          d.bell = true;
          fact(d, `${seq}.bell`, rr.rings === null ? `The bell shows ${lit} lit.` : `The bell rang ${rr.rings === 1 ? "once" : `${rr.rings} times`} (${lit} lit).`, trust);
        }
        break;
      }
      case "roomRaided": {
        const rr = roomOf(e.round, e.room);
        rr.raided = true;
        rr.seized = e.seized;
        known.delete(e.room);
        atZero.add(e.room);
        const d = roomLead(e.round, e.room);
        d.bell = true;
        fact(d, `${seq}`, text(), trust);
        fact(lead(`r${e.round}.wanted`, e.round, "Wanted"), `${seq}`, `Wanted rose to ${e.wanted} of ${job.alarm.bustStars}.`, trust);
        break;
      }
      case "bellsCooled":
        known = new Map(Object.entries(e.bells));
        break;
      case "roomReopened":
        atZero.add(e.room);
        fact(roomLead(e.round, e.room), `${seq}`, text(), trust);
        break;
      case "roomSighting": {
        const rr = roomOf(e.round, e.room);
        rr.watched ||= !rr.dark;
        for (const p of e.others) rr.seen.set(p, "room");
        fact(roomLead(e.round, e.room), `${seq}`, text(), trust, e.others);
        break;
      }
      case "roomWatched": {
        const rr = roomOf(e.round, e.room);
        if (!e.offline) {
          rr.watched = true;
          for (const p of e.seen) if (!rr.seen.has(p)) rr.seen.set(p, "feed");
        }
        fact(roomLead(e.round, e.room), `${seq}`, text(), trust, e.seen);
        break;
      }
      case "alibiVerified":
        fact(roomLead(e.round, e.room), `${seq}`, text(), trust, [e.player]);
        break;
      case "said": {
        const s = e.statement;
        if (s.kind === "alibi") {
          roundOf(s.round).alibis.set(s.player, s.room);
          fact(roomLead(s.round, s.room), `${seq}`, text(), trust, [s.player]);
        } else if (s.kind === "role") {
          if (s.player !== me) claims.set(s.player, { role: s.role, round });
          fact(crewLead(round), `${seq}`, text(), trust, [s.player]);
        } else {
          // design §10: the plan snapshot, one said line per spot and per pledge.
          for (const p of s.plan.entries) {
            if (p.room !== null) {
              roundOf(s.round).plan.set(p.player, p.room);
              fact(roomLead(s.round, p.room), `${seq}.${p.player}`, `Plan: ${who(p.player)} → ${roomName(p.room)}`, trust, [p.player]);
            }
            if (p.power !== null) {
              const target = p.power.target;
              const onRoom = Object.hasOwn(job.rooms, target);
              const d = onRoom ? roomLead(s.round, target) : crewLead(s.round);
              fact(d, `${seq}.${p.player}.power`, `Plan: ${who(p.player)} ${roleName(p.power.role)} → ${onRoom ? roomName(target) : who(target)}`, trust, onRoom ? [p.player] : [p.player, target]);
            }
          }
        }
        break;
      }
      case "abilityResolved": {
        const a = e.ability;
        if (a.kind === "lookout") break; // its feeds are the roomWatched lines
        if (a.kind === "detect" || a.kind === "absolve") fact(crewLead(a.kind === "detect" ? a.round : e.round), `${seq}`, text(), trust, [a.target]);
        else fact(roomLead(a.kind === "audit" ? a.round : e.round, a.room), `${seq}`, text(), trust);
        break;
      }
      case "abilityAlreadyDone":
      case "sinsAbsolved":
        fact(crewLead(e.round), `${seq}`, text(), trust);
        break;
      case "perkSold":
      case "perkBought": {
        const perk = e.type === "perkSold" ? e.perk : e.perk.kind;
        if (e.type === "perkBought" && e.perk.kind === "plantEvidence") myPlants.set(`${e.round}:${e.perk.room}`, e.perk.target);
        count(e.type === "perkSold" ? sold : bought, e.round, perk);
        const d = lead(`r${e.round}.market`, e.round, "Black market");
        if (e.type === "perkSold") d.summary.push(`Someone bought ${perkName(perk)} · ${e.cost}`);
        fact(d, `${seq}`, text(), trust);
        break;
      }
      case "voteSealed":
        fact(crewLead(round), `${seq}`, text(), trust);
        break;
      case "meetingScheduled":
      case "emergencyMeetingCalled":
      case "meetingOpened":
      case "voteCast":
      case "meetingClosed":
      case "shakedownPending":
      case "shakedownCancelled":
      case "shakedownResolved":
      case "bailChosen": {
        const d = meetingLead(round, e.meetingId);
        const names: PlayerId[] = [];
        if (e.type === "meetingOpened") d.title = MEETING_TITLE[e.kind];
        if (e.type === "emergencyMeetingCalled") {
          d.title = MEETING_TITLE.emergency;
          d.summary.push(`called by ${who(e.by)}`);
          names.push(e.by);
        }
        if (e.type === "meetingScheduled") d.summary.push(`set for ${slotText(e.slot)}`);
        if (e.type === "voteCast") names.push(e.player);
        if (e.type === "meetingClosed") {
          const r = e.result;
          d.summary = [r.kind === "shakedown" ? `${who(r.target)} voted out` : r.kind === "skipped" ? "skipped" : r.kind === "noMajority" ? "no majority" : "too few votes"];
          if (r.kind === "shakedown") names.push(r.target);
        }
        if (e.type === "shakedownResolved") d.summary = [`${who(e.target)} shaken down · ${e.taken} back`];
        if (e.type === "shakedownCancelled") d.summary = ["a shakedown fell through"];
        fact(d, `${seq}`, text(), trust, names);
        break;
      }
      case "gameEnded":
        fact(lead("end", round, "The end"), `${seq}`, text(), trust, e.outcome.winners);
        break;
      // Housekeeping (setup, lock-ins, your own move edits, meeting-time proposals) lives on the seats and the panels.
      case "gameCreated":
      case "roomsSet":
      case "bankFilled":
      case "roleDealt":
      case "roleListShown":
      case "shopDealt":
      case "moveLocked":
      case "moveSubmitted":
      case "meetingProposed":
      case "meetingProposalAccepted":
        break;
      default: {
        const unknown: never = e;
        void unknown;
      }
    }
  }

  // design §12: a feed sighting you planted yourself isn't evidence (a real one from your own room stays).
  for (const [key, target] of myPlants) {
    const [r, room] = [Number(key.slice(0, key.indexOf(":"))), key.slice(key.indexOf(":") + 1)];
    const rr = rounds.get(r)?.rooms.get(room);
    if (rr?.seen.get(target) === "feed") rr.seen.delete(target);
  }

  // design §15.4: the ⚠ checks, each round as your view shows it.
  const setup = setupOf(view);
  const ctx: CheckContext = {
    me,
    myRole: view.me.role,
    job,
    events: eventsFor({ contentOverrides: setup?.contentOverrides ?? null }),
    roleList: view.roleList,
    crewSize: view.players.length + 1,
  };
  const n = (m: Map<string, number>, r: number, perk: string) => m.get(`${r}:${perk}`) ?? 0;
  const found = [...rounds].flatMap(([r, x]) => {
    const facts: RoundFacts = {
      round: r,
      card: x.card,
      rooms: new Map<RoomId, RoomRound>(x.rooms),
      plan: x.plan,
      alibis: x.alibis,
      softShoes: n(sold, r - 1, "softShoes") - n(bought, r - 1, "softShoes"),
      planted: n(sold, r, "plantEvidence") - n(bought, r, "plantEvidence"),
      mySoftShoes: n(bought, r - 1, "softShoes") > 0,
      bankEmptied: x.bankEmptied,
    };
    return [...storyChecks(facts, me, name), ...bellChecks(facts, ctx, name)];
  });
  for (const f of [...found, ...overClaimed(claims, ctx, name)]) {
    const d = f.room === null ? crewLead(f.round) : roomLead(f.round, f.room);
    d.warnings.push(f.warning);
    for (const p of f.warning.names) d.names.add(p);
  }

  // Room summaries, from the round as gathered.
  for (const [r, x] of rounds)
    for (const [room, rr] of x.rooms) {
      const d = drafts.get(`r${r}.room.${room}`);
      if (!d) continue;
      const seen = [...rr.seen.keys()].map(who);
      const claimed = [...new Set([...x.plan, ...x.alibis].filter(([, at]) => at === room).map(([p]) => p))].map(who);
      d.summary = [
        rr.raided ? `raid · ${rr.seized} seized` : rr.hidden ? "bell ?" : rr.rings ? `rang ${rr.rings === 1 ? "once" : rr.rings}` : null,
        // design §11.1, §18: the announcement's own form, never a bare "power cut" (the dropped R6 card's name).
        rr.dark ? `Power cut in the ${roomName(room)}` : null,
        seen.length ? `seen ${seen.join(", ")}` : null,
        claimed.length ? `claimed ${claimed.join(", ")}` : rr.rings ? "claimed nobody" : null,
      ].filter((s): s is string => s !== null);
    }

  const leads: Lead[] = [...drafts.values()].map((d) => ({
    id: d.id,
    round: d.round,
    title: d.title,
    ...(d.summary.length ? { summary: d.summary.join(" · ") } : {}),
    bell: d.bell,
    warnings: d.warnings,
    names: [...d.names],
    facts: d.facts,
  }));
  return { leads, suspect: suspectOf(leads, pins, me, seatsOf(view).map((s) => s.id)) };
}
