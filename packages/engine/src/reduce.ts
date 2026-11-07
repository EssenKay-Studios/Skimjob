// State is a fold over the event log. design §17.2, CLAUDE.md "Event-sourced"
//
// `applyEvent` is the only way state changes. Command handlers decide which
// events happen (drawing from `state.rng` where needed); folding those events
// rebuilds the same state, including the RNG, on replay.
import type { PerkId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, MeetingState, Phase, PlayerId, PlayerState, ResolvedPerk, RoleState } from "./types";
import { NO_ROLE_STATE } from "./types";
import { seedRng } from "./rng";
import { actOfRound, isLastRoundOfAct } from "./acts";

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
          p.roleState.usedThisAct > 0 ? { usedThisAct: p.roleState.usedThisAct - 1 } : { usedThisGame: Math.max(0, p.roleState.usedThisGame - 1) },
        ),
      );
    case "rig":
      return { ...state, rigs: [...state.rigs, { player, round: perk.round, cards: perk.cards, pick: perk.cards[0] as string }] };
    case "peek":
    case "shield":
    case "alibi":
    case "emergency":
      // Information, or a cancel (or call) announced by its own public event.
      return state;
  }
}

function openMeeting(state: GameState): MeetingState {
  if (!state.meeting) throw new Error("no meeting is open");
  return state.meeting;
}

/**
 * Where the game goes when a meeting closes: back to planning the current
 * round; if that round has resolved, back to its alibis while they're open,
 * else (the act's last round) awaiting the act's meeting. The regular
 * meeting's close then moves on with `roundStarted` or `gameEnded`. design §4.1, §5.4
 */
function phaseAfterMeeting(state: GameState): Phase {
  if (state.resolvedRound !== state.round) return { kind: "planning", round: state.round };
  return state.alibisOpen ? { kind: "alibis", round: state.round } : { kind: "awaitingMeeting", act: actOfRound(state.round) };
}

/** A shakedown window (if one was open) ends: back to where the meeting left the game. design §11.3 */
function afterShakedown(state: GameState): GameState {
  return state.pendingShakedown ? { ...state, pendingShakedown: null, phase: phaseAfterMeeting(state) } : state;
}

/** The taped-off rooms for which `open` holds reopen, each with its bell back at 0. design §5.3 */
function reopen(state: GameState, open: (room: string) => boolean): GameState {
  const rooms = Object.keys(state.taped).filter(open);
  if (rooms.length === 0) return state;
  const taped = Object.fromEntries(Object.entries(state.taped).filter(([room]) => !rooms.includes(room)));
  return { ...state, taped, bells: { ...state.bells, ...Object.fromEntries(rooms.map((r) => [r, 0])) } };
}

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
    playerOrder: [],
    players: {},
    share: 0,
    kitty: 0,
    setAside: 0,
    reached: 0,
    bells: {},
    taped: {},
    wanted: 0,
    seized: 0,
    card: null,
    cardsFlipped: [],
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
      return { ...state, playerOrder: event.players.map((p) => p.id) };
    case "rngSeeded":
      return { ...state, rng: seedRng(event.seed) };
    case "rngAdvanced":
      return { ...state, rng: { words: event.words } };
    case "roomsSet":
      // design §5.1: every bell starts dark.
      return { ...state, rooms: event.rooms, bells: Object.fromEntries(event.rooms.map((r) => [r, 0])) };
    case "bankFilled":
      return { ...state, bank: event.coins };
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
        emergencyMeetingUsed: false,
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
      const next: GameState = {
        ...reopen(state, (room) => (state.taped[room] as number) < event.round),
        phase: { kind: "planning", round: event.round },
        round: event.round,
        moves: {},
        card: null,
        rigs,
      };
      // "Once between meetings" powers start again with each stretch: the next act's first round starts right
      // after the regular meeting closes with its target check; emergency meetings never
      // reach here. extension.md gap-fills "Between meetings"
      return actOfRound(event.round) !== actOfRound(state.round) ? mapPlayers(next, (p) => withRoleState(p, { usedThisAct: 0 })) : next;
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
      switch (ability.kind) {
        case "loopCameras":
        case "ring":
        case "audit":
        case "checkStash":
        case "bless":
          return updatePlayer(state, event.player, (p) => withRoleState(p, { usedThisAct: p.roleState.usedThisAct + 1 }));
        case "reopen":
          return updatePlayer(state, event.player, (p) => withRoleState(p, { usedThisGame: p.roleState.usedThisGame + 1 }));
        case "lookout":
          return state;
      }
    }
    case "roomSighting":
    case "roomWatched":
      // Information only; no state changes.
      return state;
    // ------------------------------------------------ bells, raids and Wanted. design §5
    case "bellsRung":
    case "bellsCooled":
      return { ...state, bells: event.bells };
    case "roomRaided": {
      // design §5.3: the grabs are seized, the room is taped off and its bell goes off; Wanted +1 (§5.4).
      const bells = Object.fromEntries(Object.entries(state.bells).filter(([room]) => room !== event.room));
      return { ...state, bells, taped: { ...state.taped, [event.room]: event.closedThrough }, wanted: event.wanted, seized: state.seized + event.seized };
    }
    case "roomReopened":
      // design §5.3, §11.1: the Fixer tore the tape off; open from the next round, its bell at 0.
      return reopen(state, (room) => room === event.room);
    case "blessingPaid":
      // design §8 (v2 §2): the bank pays the blessed player's compensation, so it goes back into the coins set aside.
      return { ...state, setAside: state.setAside + event.amount };
    case "duffelSplit":
      // design §7.1–§7.3, §7.6: every stash gets this round's cut; the change is the kitty. Hand-ins reach the
      // duffel here and count toward honesty once (§7.5); kitty coins never count again. Set-aside coins
      // earn their credit with the meetings' rules (S3a.5).
      return {
        ...mapPlayers(state, (p) => ({ stash: p.stash + event.cut })),
        share: event.share,
        kitty: event.kitty,
        setAside: 0,
        reached: state.reached + event.handedIn,
      };
    case "roundResolved":
      // The bank is a public total. The round's alibis open (design §5.4); the next
      // round, or after an act's last round its meeting (design §11), waits for their deadline.
      // Tails watched this round (design §8.3); Verified stamps are for the round just ended.
      return {
        ...mapPlayers(state, (p) => (p.roleState.tail === null ? {} : withRoleState(p, { tail: null }))),
        phase: { kind: "alibis", round: event.round },
        bank: event.bank,
        moves: {},
        card: null,
        resolvedRound: event.round,
        alibisOpen: true,
        alibisPosted: [],
        alibisVerified: [],
      };
    case "alibisClosed": {
      // Within an act `roundStarted` follows at once; after its last round the act's meeting is awaited.
      const closed: GameState = { ...state, alibisOpen: false };
      return isLastRoundOfAct(event.round)
        ? { ...closed, phase: { kind: "awaitingMeeting", act: actOfRound(event.round) } }
        : closed;
    }
    case "gameEnded":
      // A round that ends the game has no alibi window (design §5.4, PR #21 QA).
      return { ...state, phase: { kind: "ended", outcome: event.outcome }, alibisOpen: false };
    // ------------------------------------------------ events deck. design §10
    case "eventFlipped":
      return {
        ...state,
        card: { round: event.round, id: event.card, room: event.room },
        cardsFlipped: [...state.cardsFlipped, event.card],
      };
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
      const { proposalId: id, by, act, slot } = event;
      return { ...state, proposals: [...state.proposals, { id, by, act, slot, acceptedBy: [by] }] };
    }
    case "meetingProposalAccepted":
      return {
        ...state,
        proposals: state.proposals.map((p) => (p.id === event.proposalId ? { ...p, acceptedBy: [...p.acceptedBy, event.by] } : p)),
      };
    case "meetingScheduled":
      return { ...state, proposals: [], scheduledMeeting: { meetingId: event.meetingId, act: event.act, slot: event.slot } };
    case "emergencyMeetingCalled":
      return updatePlayer({ ...state, pendingEmergency: { meetingId: event.meetingId, by: event.by } }, event.by, () => ({
        emergencyMeetingUsed: true,
      }));
    case "meetingOpened": {
      const emergency = event.kind === "emergency";
      return {
        ...state,
        phase: { kind: "meeting", meetingId: event.meetingId },
        meeting: {
          id: event.meetingId,
          kind: event.kind,
          act: event.act,
          calledBy: emergency ? (state.pendingEmergency?.by ?? null) : null,
          votes: {},
          extraVotes: [],
          ballotGrants: {},
        },
        scheduledMeeting: emergency ? state.scheduledMeeting : null,
        pendingEmergency: emergency ? null : state.pendingEmergency,
      };
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
      return { ...state, meeting: null, phase: phaseAfterMeeting(state) };
    case "shakedownPending":
      return {
        ...state,
        phase: { kind: "shakedownPending", meetingId: event.meetingId, target: event.target },
        pendingShakedown: { meetingId: event.meetingId, kind: event.kind, act: event.act, target: event.target },
      };
    case "shakedownCancelled":
      return afterShakedown(state);
    case "shakedownResolved": {
      // design §7.1: what the shakedown took back is set aside for the next split.
      const next = { ...afterShakedown(state), setAside: state.setAside + event.taken - event.compensation };
      return updatePlayer(next, event.target, (p) => ({ stash: p.stash - event.taken + event.compensation }));
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
