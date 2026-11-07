-- Plan board (S3b.4, design §10): each seat's entry on a round's shared board,
-- and the compact edit history that goes into the round's snapshot (S3a.9).
-- Server-only, like chat: not engine events (only the per-round snapshot goes
-- into the log, S3a.9). One row per seat per round; a new round starts empty.
create table if not exists plan_entries (
  game_id uuid not null references games (id) on delete cascade,
  round integer not null,
  player_id text not null,
  -- Where the crew proposed this avatar goes (anyone may move it).
  placed text,
  -- The seat's own room claim.
  room text,
  -- The seat's power claim ("Hacker → Vault"); both columns or neither.
  power_role text,
  power_target text,
  agreed boolean not null default false,
  primary key (game_id, round, player_id),
  check ((power_role is null) = (power_target is null))
);

-- One row per actor, kind and subject (the latest edit), so a round's history is bounded.
create table if not exists plan_edits (
  game_id uuid not null references games (id) on delete cascade,
  round integer not null,
  actor text not null,
  kind text not null check (kind in ('place', 'room', 'power', 'agree')),
  -- The avatar moved (kind 'place'), else the actor itself.
  subject text not null,
  -- The room, the claimed role, or 'true' / 'false'; null when cleared.
  value text,
  -- A power claim's target.
  target text,
  at timestamptz not null,
  -- Ms left to the round's deadline at the time; null if it had none.
  ms_before_deadline bigint,
  primary key (game_id, round, actor, kind, subject)
);
