-- Skimjob server schema v1 (M2-1). design §17.5
-- Replay inputs (games.config, game_events.event) are `json`, not `jsonb`:
-- json keeps the text byte for byte, jsonb re-sorts object keys (decisions.md).

create table users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  -- Google account id (M2-12); null for a guest (invite link + nickname).
  google_sub text unique,
  created_at timestamptz not null default now()
);

create table sessions (
  -- SHA-256 of the cookie token. The token itself is never stored.
  token_hash bytea primary key,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on sessions (user_id);

create table games (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'lobby' check (status in ('lobby', 'running', 'ended')),
  host_user_id uuid not null references users (id),
  invite_code text not null unique,
  -- Host's lobby choices (session length, vote mode, ...), incl. server-only ones.
  settings jsonb not null default '{}',
  -- The engine GameConfig, written at start. Holds the seed: never sent to a client.
  config json,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'lobby') = (config is null))
);

create table seats (
  game_id uuid not null references games (id) on delete cascade,
  seat_no int not null check (seat_no >= 0),
  -- Engine PlayerId, made by the server when the game starts.
  player_id text,
  -- A human seat has a user; a bot seat has a personality instead.
  user_id uuid references users (id),
  nickname text not null,
  bot_personality text,
  -- Last view seq this seat has seen ("while you were away", §13). -1 = none.
  last_seen_seq int not null default -1,
  primary key (game_id, seat_no),
  unique (game_id, player_id),
  unique (game_id, user_id),
  check ((user_id is null) <> (bot_personality is null))
);

create table game_events (
  game_id uuid not null references games (id) on delete cascade,
  -- Position in the full log. Server-only: never sent to a client.
  idx int not null check (idx >= 0),
  event json not null,
  primary key (game_id, idx)
);

create table deadlines (
  game_id uuid not null references games (id) on delete cascade,
  -- Names the deadline, e.g. 'round:3' or 'openMeeting:act-1'; one row each.
  key text not null,
  due_at timestamptz not null,
  -- The system command to send to the engine when it falls due.
  command json not null,
  primary key (game_id, key)
);
create index deadlines_due_idx on deadlines (due_at);
