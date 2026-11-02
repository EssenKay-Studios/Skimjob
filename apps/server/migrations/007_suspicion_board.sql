-- Suspicion board (design §12.3, M2-10): each seat's private tags on the other
-- players, with an optional note. Server-only, never in the engine log, and
-- only ever sent to the seat that wrote it. The seat's "last seen" view seq
-- for "while you were away" (§13) is seats.last_seen_seq (001).
create table if not exists suspicion_marks (
  game_id uuid not null references games (id) on delete cascade,
  -- The seat that owns the board.
  player_id text not null,
  -- The player tagged (another seat in the same game).
  subject text not null,
  tag text check (tag in ('trusted', 'unsure', 'suspicious')),
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (game_id, player_id, subject),
  check (tag is not null or note <> '')
);
