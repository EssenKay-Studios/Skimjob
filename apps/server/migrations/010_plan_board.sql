-- Plan board (S3b.4, design §10): each seat's entry on a round's shared board.
-- Server-only, like chat: not engine events (only the per-round snapshot goes
-- into the log, S3a.9). One row per seat per round; a new round starts empty.
create table if not exists plan_entries (
  game_id uuid not null references games (id) on delete cascade,
  round integer not null,
  player_id text not null,
  -- The seat's room claim.
  room text,
  -- The seat's power claim ("Hacker → Vault"); both columns or neither.
  power_role text,
  power_target text,
  agreed boolean not null default false,
  primary key (game_id, round, player_id),
  check ((power_role is null) = (power_target is null))
);
