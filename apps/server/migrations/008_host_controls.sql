-- Host controls (M2-13, design §15). Server-only, never in the engine log.
-- games.paused_at: set while the host has the game paused. Every deadline row
-- (police moments included) is paused with it, and moves on by the pause.
alter table games add column if not exists paused_at timestamptz;
-- seats.stand_in: the bot personality playing a human seat for its player
-- (replace with a bot); null once the seat is handed back. Human seats only.
alter table seats add column if not exists stand_in text;
