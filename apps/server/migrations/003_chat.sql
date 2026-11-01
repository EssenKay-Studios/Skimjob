-- In-game chat (M2-8a). design §12.1. Server-side only: not engine events.
-- Crew messages have to_player null; a DM names its one recipient.
create table chat_messages (
  -- Sent to clients as the message id: random, so ids never count others' DMs.
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games (id) on delete cascade,
  -- Server order (history). Server-only: never sent to a client.
  n bigint generated always as identity,
  from_player text not null,
  to_player text,
  sent_at timestamptz not null,
  -- Exactly one: typed text (unverified) or an evidence card { type, payload } (verified).
  text text,
  card json,
  check ((text is null) <> (card is null))
);
create index chat_messages_game_idx on chat_messages (game_id, n);
