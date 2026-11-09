// State is a fold over the event log. design §17.2, CLAUDE.md "Event-sourced"
//
// `applyEvent` is the only way state changes. Command handlers decide which
// events happen (drawing from `state.rng` where needed); folding those events
// rebuilds the same state, including the RNG, on replay.
import { EMERGENCY_POOL } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, MeetingState, Phase, PlayerId, PlayerState, RoleState } from "./types";
import { NO_ROLE_STATE } from "./types";
import { seedRng } from "./rng";

/** Replace one player's state. Throws for players that weren't dealt in. */
function updatePlayer(state: GameState, id: PlayerId, change: (p: PlayerState) => Partial<PlayerState>): GameState {
  const player = state.players[id];
  if (!player) throw new Error(`unknown player ${id}`);
  return { ...state, players: { ...state.players, [id]: { ...player, ...change(player) } } };
}

function mapPlayers(state: GameState, change: (p: PlayerState) => Partial<PlayerState>): GameState {
  const players = Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, { ...p, ...change(p) }]));
  return { ...state, players };
}

const withRoleState = (p: PlayerState, change: Partial<RoleState>): Partial<PlayerState> => ({ roleState: { ...p.roleState, ...change } });

/** design §12: the Check ballots bought since the last meeting opened: buyer → the players whose ballots they see in this one. */
function ballotGrants(checks: GameState["ballotChecks"]): Record<PlayerId, PlayerId[]> {
  const out: Record<PlayerId, PlayerId[]> = {};
  for (const { player, target } of checks) {
    const seen = Object.hasOwn(out, player) ? (out[player] as PlayerId[]) : [];
    if (!seen.includes(target)) out[player] = [...seen, target];
  }
  return out;
}

function openMeeting(state: GameState): MeetingState {
  if (!state.meeting) throw new Error("no meeting is open");
  return state.meeting;
}

/**
 * After a round's result and any meeting: the result window (design §4.2 step
 * 10, §9.3). When the pool is empty, or after an emergency, the handler adds
 * the next `roundStarted` at once.
 */
const resultWindow = (state: GameState): Phase => ({ kind: "result", round: state.resolvedRound });

/** A passed shakedown's Bail choice window (if one was open) ends, and its target is protected until the next regular meeting. design §9.7 */
function afterShakedown(state: GameState, target: PlayerId): GameState {
  const shaken = state.protected.includes(target) ? state : { ...state, protected: [...state.protected, target] };
  return shaken.pendingShakedown ? { ...shaken, pendingShakedown: null, phase: resultWindow(shaken) } : shaken;
}

/** The next regular meeting or briefing's id, numbered from the public `meetingOpened`s (never an RNG draw, STATUS.md). */
export const nextMeetingId = (state: GameState): string =>
  `meeting-${state.log.filter((e) => e.type === "meetingOpened" && e.kind !== "emergency").length + 1}`;

/**
 * design §9.1: thirds of the bank gone at `bank` coins left, out of `start`:
 * 1 at two-thirds or below, 2 at one-third or below.
 */
const thirdsGone = (start: number, bank: number): number => (bank * 3 <= start ? 2 : bank * 3 <= start * 2 ? 1 : 0);

/** The taped-off rooms for which `open` holds reopen, each with its bell back at 0. design §5.3 */
function reopen(state: GameState, open: (room: string) => boolean): GameState {
  const rooms = Object.keys(state.taped).filter(open);
  if (rooms.length === 0) return state;
  const taped = Object.fromEntries(Object.entries(state.taped).filter(([room]) => !rooms.includes(room)));
  return { ...state, taped, bells: { ...state.bells, ...Object.fromEntries(rooms.map((r) => [r, 0])) } };
}

/** The lit bulbs of those `rooms` that still have a bell (a raided room's is off). */
const bellsOf = (state: GameState, rooms: readonly string[]): Record<string, number> =>
  Object.fromEntries(rooms.filter((room) => Object.hasOwn(state.bells, room)).map((room) => [room, state.bells[room] as number]));

/** State before any event: only the host's config is known. */
export function initialState(config: GameConfig): GameState {
  return {
    config,
    rng: { words: [] },
    phase: { kind: "setup" },
    round: 0,
    resolvedRound: 0,
    rooms: [],
    bank: 0,
    bankStart: 0,
    thirds: 0,
    stretch: 1,
    meetingDue: null,
    emergencies: 0,
    protected: [],
    playerOrder: [],
    players: {},
    share: 0,
    kitty: 0,
    setAside: 0,
    reached: 0,
    bells: {},
    taped: {},
    hidden: [],
    dark: [],
    cutsPending: [],
    wanted: 0,
    seized: 0,
    spent: 0,
    card: null,
    moves: {},
    ballotChecks: [],
    proposals: [],
    scheduledMeeting: null,
    pendingEmergency: null,
    meeting: null,
    pendingShakedown: null,
    shop: [],
    log: [],
  };
}

function applyChange(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "gameCreated":
      // design §9.3: the crew's emergency pool by crew size.
      return { ...state, playerOrder: event.players.map((p) => p.id), emergencies: EMERGENCY_POOL[event.players.length] ?? 0 };
    case "rngSeeded":
      return { ...state, rng: seedRng(event.seed) };
    case "rngAdvanced":
      return { ...state, rng: { words: event.words } };
    case "roomsSet":
      // design §5.1: every bell starts dark.
      return { ...state, rooms: event.rooms, bells: Object.fromEntries(event.rooms.map((r) => [r, 0])) };
    case "bankFilled":
      return { ...state, bank: event.coins, bankStart: event.coins };
    case "roleDealt": {
      const seat = state.config.players.find((p) => p.id === event.player);
      if (!seat) throw new Error(`roleDealt: unknown player ${event.player}`);
      const player: PlayerState = {
        id: seat.id,
        name: seat.name,
        isBot: seat.isBot,
        role: event.role,
        stash: 0,
        roleState: NO_ROLE_STATE,
        consecutiveMissedMoves: 0,
        sealedVote: null,
      };
      return { ...state, players: { ...state.players, [seat.id]: player } };
    }
    case "roleListShown":
      return state;
    case "shopDealt":
      return { ...state, shop: event.perks };
    // ------------------------------------------------ round loop. design §5
    case "roundStarted": {
      // design §5.3: a room whose tape has run out reopens with its bell at 0.
      return {
        ...reopen(state, (room) => (state.taped[room] as number) < event.round),
        phase: { kind: "planning", round: event.round },
        round: event.round,
        moves: {},
        card: null,
        // design §11.1: a hidden bell reappears and last round's power cuts end.
        hidden: [],
        dark: [],
      };
    }
    case "moveLocked":
      // Public mark only: the move itself is folded by the `moveSubmitted` that follows. design §5.1
      return state;
    case "moveSubmitted":
      return updatePlayer({ ...state, moves: { ...state.moves, [event.player]: event.move } }, event.player, () => ({
        consecutiveMissedMoves: 0,
      }));
    case "defaultMoveAssigned":
      return updatePlayer(event.move ? { ...state, moves: { ...state.moves, [event.player]: event.move } } : state, event.player, (p) => ({
        consecutiveMissedMoves: p.consecutiveMissedMoves + 1,
      }));
    case "coinsGrabbed":
      return updatePlayer(state, event.player, (p) => ({ stash: p.stash + event.pocket }));
    case "abilityResolved": {
      const { ability } = event;
      const used = (p: PlayerState) => withRoleState(p, { usedThisStretch: p.roleState.usedThisStretch + 1 });
      switch (ability.kind) {
        case "ring":
        case "audit":
        case "absolve":
          return updatePlayer(state, event.player, used);
        case "hide": {
          // design §11.1: the hidden bell's real bulbs, from the Hacker's own result (the public events leave it out).
          const next = updatePlayer(state, event.player, used);
          return ability.bulbs === null ? next : { ...next, bells: { ...next.bells, [ability.room]: ability.bulbs } };
        }
        case "blackout": {
          const next = updatePlayer(state, event.player, used);
          return next.cutsPending.includes(ability.room) ? next : { ...next, cutsPending: [...next.cutsPending, ability.room] };
        }
        case "reopen":
          return updatePlayer(state, event.player, (p) => withRoleState(p, { usedThisGame: p.roleState.usedThisGame + 1 }));
        case "lookout":
        case "detect":
          return state;
      }
    }
    case "abilityAlreadyDone":
      // design §11.4: no effect, and not spent.
      return state;
    case "sinsAbsolved": {
      // design §7.1, §11.1: what the Priest took back is set aside in the duffel for the next split.
      const next = { ...state, setAside: state.setAside + event.taken };
      return updatePlayer(next, event.player, (p) => ({ stash: p.stash - event.taken }));
    }
    case "roomSighting":
    case "roomWatched":
      // Information only; no state changes.
      return state;
    // ------------------------------------------------ bells, raids and Wanted. design §5
    case "bellsRung":
      // design §5.1, §11.1: a hidden bell keeps its bulbs here until its Hacker's result folds in.
      return { ...state, bells: { ...event.bells, ...bellsOf(state, event.hidden) }, hidden: event.hidden };
    case "bellsCooled":
      return { ...state, bells: { ...event.bells, ...bellsOf(state, state.hidden) } };
    case "roomRaided": {
      // design §5.3: the grabs are seized, the room is taped off and its bell goes off; Wanted +1 (§5.4).
      const bells = Object.fromEntries(Object.entries(state.bells).filter(([room]) => room !== event.room));
      const hidden = state.hidden.filter((room) => room !== event.room);
      // design §9.2: a raid calls a police briefing (a regular meeting due after the same round wins, §9.2).
      return {
        ...state,
        bells,
        hidden,
        taped: { ...state.taped, [event.room]: event.closedThrough },
        wanted: event.wanted,
        seized: state.seized + event.seized,
        meetingDue: state.meetingDue ?? "briefing",
      };
    }
    case "roomReopened":
      // design §5.3, §11.1: the Fixer tore the tape off; open from the next round, its bell at 0.
      return reopen(state, (room) => room === event.room);
    case "powerCut":
      // design §11.1: announced as the round starts; dark for this round.
      return { ...state, dark: [...state.dark, event.room], cutsPending: state.cutsPending.filter((room) => room !== event.room) };
    case "duffelSplit":
      // design §7.1–§7.3, §7.6: every stash gets this round's cut; the change is the kitty. Hand-ins and the
      // coins set aside (shakedown returns, §9.6) reach the duffel here and count toward honesty once (§7.5);
      // kitty coins never count again.
      return {
        ...mapPlayers(state, (p) => ({ stash: p.stash + event.cut })),
        share: event.share,
        kitty: event.kitty,
        // A Priest's absolve this round is set aside after the split's own (§7.1, §11.1).
        setAside: state.setAside - event.setAside,
        reached: state.reached + event.handedIn + event.setAside,
      };
    case "roundResolved": {
      // The bank is a public total. Crossing a third of the bank calls a regular meeting (§9.1; crossing
      // both in one round, one meeting); the meeting the round called is awaited, else the result window
      // (§4.2 steps 9–10).
      const thirds = thirdsGone(state.bankStart, event.bank);
      const resolved: GameState = {
        ...state,
        bank: event.bank,
        thirds,
        meetingDue: thirds > state.thirds ? "regular" : state.meetingDue,
        moves: {},
        card: null,
        resolvedRound: event.round,
      };
      return {
        ...resolved,
        phase: resolved.meetingDue ? { kind: "awaitingMeeting", meeting: resolved.meetingDue, meetingId: nextMeetingId(resolved) } : resultWindow(resolved),
      };
    }
    case "gameEnded":
      return { ...state, phase: { kind: "ended", outcome: event.outcome } };
    // ------------------------------------------------ events deck. design §13
    case "eventFlipped":
      return { ...state, card: { round: event.round, id: event.card, room: event.room } };
    case "insideTip":
    case "auditReport":
      return state;
    // design §19.2 seam 5: talk only; handlers read earlier statements from the log.
    case "said":
      return state;
    // ------------------------------------------------ meetings and votes. design §11
    case "meetingProposed": {
      const { proposalId: id, by, slot } = event;
      return { ...state, proposals: [...state.proposals, { id, by, slot, acceptedBy: [by] }] };
    }
    case "meetingProposalAccepted":
      return {
        ...state,
        proposals: state.proposals.map((p) => (p.id === event.proposalId ? { ...p, acceptedBy: [...p.acceptedBy, event.by] } : p)),
      };
    case "meetingScheduled":
      return { ...state, proposals: [], scheduledMeeting: { meetingId: event.meetingId, slot: event.slot } };
    case "emergencyMeetingCalled":
      // design §9.3: spent from the crew's pool, for good.
      return { ...state, pendingEmergency: { meetingId: event.meetingId, by: event.by }, emergencies: state.emergencies - 1 };
    case "meetingOpened": {
      const emergency = event.kind === "emergency";
      const opened: GameState = {
        ...state,
        phase: { kind: "meeting", meetingId: event.meetingId },
        meeting: {
          id: event.meetingId,
          kind: event.kind,
          calledBy: emergency ? (state.pendingEmergency?.by ?? null) : null,
          votes: {},
          ballotGrants: ballotGrants(state.ballotChecks),
        },
        ballotChecks: [],
        scheduledMeeting: emergency ? state.scheduledMeeting : null,
        pendingEmergency: emergency ? null : state.pendingEmergency,
        meetingDue: emergency ? state.meetingDue : null,
      };
      if (event.kind !== "regular") return opened;
      // design §9.1, §9.7, §11.2: a regular meeting starts the next stretch: "once between meetings" powers
      // recharge, and shakedown protection lifts. Briefings and emergencies do neither.
      return { ...mapPlayers(opened, (p) => withRoleState(p, { usedThisStretch: 0 })), stretch: state.stretch + 1, protected: [] };
    }
    case "voteSealed":
      return updatePlayer(state, event.player, () => ({ sealedVote: event.vote }));
    case "voteCast": {
      const meeting = openMeeting(state);
      const next: GameState = { ...state, meeting: { ...meeting, votes: { ...meeting.votes, [event.player]: event.vote } } };
      // A sealed vote is used up once it's cast. design §11.2
      return event.sealed ? updatePlayer(next, event.player, () => ({ sealedVote: null })) : next;
    }
    case "meetingClosed":
      openMeeting(state);
      return { ...state, meeting: null, phase: resultWindow(state) };
    case "shakedownPending":
      return {
        ...state,
        phase: { kind: "shakedownPending", meetingId: event.meetingId, target: event.target },
        pendingShakedown: { meetingId: event.meetingId, kind: event.kind, target: event.target, useBail: false },
      };
    case "shakedownCancelled":
      // design §9.6: the target used Bail, which is spent.
      return updatePlayer(afterShakedown(state, event.target), event.target, (p) => withRoleState(p, { bail: false }));
    case "shakedownResolved": {
      // design §7.1, §9.6: what the shakedown took back is set aside for the next split.
      const next = { ...afterShakedown(state, event.target), setAside: state.setAside + event.taken };
      return updatePlayer(next, event.target, (p) => ({ stash: p.stash - event.taken }));
    }
    // ------------------------------------------------ perks. design §12
    case "perkSold":
      // design §12: the round's nameless notice; the coins already left with `perkBought`.
      return state;
    case "perkBought": {
      // design §7.6, §12: paid from the buyer's stash; Bail is held, a Blackout is announced next round like a
      // power cut, a Check ballot waits for the next meeting. The others act where their rule does (perks.ts).
      const { perk } = event;
      // design §7.7: the coins leave the game.
      const paid = updatePlayer({ ...state, spent: state.spent + event.cost }, event.player, (p) => ({ stash: p.stash - event.cost, ...(perk.kind === "bail" && withRoleState(p, { bail: true })) }));
      if (perk.kind === "blackout") return paid.cutsPending.includes(perk.room) ? paid : { ...paid, cutsPending: [...paid.cutsPending, perk.room] };
      if (perk.kind === "ballot") return { ...paid, ballotChecks: [...paid.ballotChecks, { player: event.player, target: perk.target }] };
      return paid;
    }
    case "bailChosen": {
      // design §9.6: the latest choice counts when the window closes.
      const pending = state.pendingShakedown;
      if (!pending) throw new Error("bailChosen: no shakedown is pending");
      return { ...state, pendingShakedown: { ...pending, useBail: event.use } };
    }
    case "alibiVerified":
      return state;
    default: {
      const unknown: never = event;
      throw new Error(`applyEvent: unknown event ${JSON.stringify(unknown)}`);
    }
  }
}

/** Fold one event into state and append it to the log. */
export function applyEvent(state: GameState, event: GameEvent): GameState {
  const next = applyChange(state, event);
  return { ...next, log: [...state.log, event] };
}

/** Rebuild state from a config and a log. Same log, same state. */
export function replay(config: GameConfig, log: readonly GameEvent[]): GameState {
  return log.reduce(applyEvent, initialState(config));
}
