// State is a fold over the event log. design §17.2, CLAUDE.md "Event-sourced"
//
// `applyEvent` is the only way state changes. Command handlers decide which
// events happen (drawing from `state.rng` where needed); folding those events
// rebuilds the same state, including the RNG, on replay.
import { EMERGENCY_POOL, type PerkId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, MeetingState, Phase, PlayerId, PlayerState, ResolvedPerk, RoleState } from "./types";
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

/** One `perk` token fewer (the first one held). */
const spendToken = (p: PlayerState, perk: PerkId): Partial<PlayerState> => {
  const i = p.roleState.perks.indexOf(perk);
  if (i < 0) throw new Error(`perkUsed: ${p.id} holds no ${perk}`);
  return withRoleState(p, { perks: [...p.roleState.perks.slice(0, i), ...p.roleState.perks.slice(i + 1)] });
};

/** A spent perk's lasting effect, after its token is gone. design §8.3 */
function perkEffect(state: GameState, player: PlayerId, perk: ResolvedPerk): GameState {
  switch (perk.kind) {
    case "extraVote": {
      const meeting = openMeeting(state);
      return { ...state, meeting: { ...meeting, extraVotes: [...meeting.extraVotes, player] } };
    }
    case "ballot": {
      const meeting = openMeeting(state);
      const seen = Object.hasOwn(meeting.ballotGrants, player) ? (meeting.ballotGrants[player] as readonly PlayerId[]) : [];
      return { ...state, meeting: { ...meeting, ballotGrants: { ...meeting.ballotGrants, [player]: [...seen, perk.target] } } };
    }
    case "tail":
      return updatePlayer(state, player, (p) => withRoleState(p, { tail: perk.room }));
    case "recharge":
      // extension.md gap-fills: one used-up use of the current stretch, else a once-per-game use.
      return updatePlayer(state, player, (p) =>
        withRoleState(
          p,
          p.roleState.usedThisStretch > 0 ? { usedThisStretch: p.roleState.usedThisStretch - 1 } : { usedThisGame: Math.max(0, p.roleState.usedThisGame - 1) },
        ),
      );
    case "rig":
      return { ...state, rigs: [...state.rigs, { player, round: perk.round, cards: perk.cards, pick: perk.cards[0] as string }] };
    case "peek":
    case "shield":
    case "alibi":
      // Information, or a cancel (or call) announced by its own public event.
      return state;
  }
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

/** A passed shakedown's window (if one was open) ends, and its target is protected until the next regular meeting. design §9.7 */
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
    card: null,
    moves: {},
    alibisOpen: false,
    alibisPosted: [],
    alibisVerified: [],
    rigs: [],
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
      // A Rig for this round has been used by its flip (deck.ts). design §8.3
      const rigs = state.rigs.filter((r) => r.round > event.round);
      // design §5.3: a room whose tape has run out reopens with its bell at 0.
      return {
        ...reopen(state, (room) => (state.taped[room] as number) < event.round),
        phase: { kind: "planning", round: event.round },
        round: event.round,
        moves: {},
        card: null,
        rigs,
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
      // The bank is a public total. The round's alibis open (design §5.4); the meeting it called, the
      // result window or the next round waits for their deadline. Crossing a third of the bank calls a
      // regular meeting (§9.1; crossing both in one round, one meeting).
      // Tails watched this round (design §8.3); Verified stamps are for the round just ended.
      const thirds = thirdsGone(state.bankStart, event.bank);
      return {
        ...mapPlayers(state, (p) => (p.roleState.tail === null ? {} : withRoleState(p, { tail: null }))),
        phase: { kind: "alibis", round: event.round },
        bank: event.bank,
        thirds,
        meetingDue: thirds > state.thirds ? "regular" : state.meetingDue,
        moves: {},
        card: null,
        resolvedRound: event.round,
        alibisOpen: true,
        alibisPosted: [],
        alibisVerified: [],
      };
    }
    case "alibisClosed":
      // design §4.2 steps 9–10: the meeting the round called is awaited, else the result window.
      return {
        ...state,
        alibisOpen: false,
        phase: state.meetingDue ? { kind: "awaitingMeeting", meeting: state.meetingDue, meetingId: nextMeetingId(state) } : resultWindow(state),
      };
    case "gameEnded":
      // A round that ends the game has no alibi window (design §5.4, PR #21 QA).
      return { ...state, phase: { kind: "ended", outcome: event.outcome }, alibisOpen: false };
    // ------------------------------------------------ events deck. design §13
    case "eventFlipped":
      return { ...state, card: { round: event.round, id: event.card, room: event.room } };
    case "insideTip":
    case "auditReport":
      return state;
    case "alibiPosted":
      return { ...state, alibisPosted: [...state.alibisPosted, event.player] };
    // design §8, §12.1: talk only; the handler reads earlier claims from the log.
    case "roleClaimed":
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
          extraVotes: [],
          ballotGrants: {},
        },
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
        pendingShakedown: { meetingId: event.meetingId, kind: event.kind, target: event.target },
      };
    case "shakedownCancelled":
      return afterShakedown(state, event.target);
    case "shakedownResolved": {
      // design §7.1, §9.6: what the shakedown took back is set aside for the next split.
      const next = { ...afterShakedown(state, event.target), setAside: state.setAside + event.taken };
      return updatePlayer(next, event.target, (p) => ({ stash: p.stash - event.taken }));
    }
    // ------------------------------------------------ perks. design §8.3
    case "tokenEarned":
      return updatePlayer(state, event.player, (p) => withRoleState(p, { tokens: p.roleState.tokens + 1 }));
    case "perkBought":
      return updatePlayer(state, event.player, (p) => withRoleState(p, { tokens: p.roleState.tokens - event.cost, perks: [...p.roleState.perks, event.perk] }));
    case "perkUsed":
      return perkEffect(updatePlayer(state, event.player, (p) => spendToken(p, event.perk.kind)), event.player, event.perk);
    case "rigPicked": {
      if (!state.rigs.some((r) => r.player === event.player && r.round === event.round)) throw new Error("rigPicked: no rigged card");
      return { ...state, rigs: state.rigs.map((r) => (r.player === event.player && r.round === event.round ? { ...r, pick: event.card } : r)) };
    }
    case "alibiVerified":
      return { ...state, alibisVerified: [...state.alibisVerified, event.player] };
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
