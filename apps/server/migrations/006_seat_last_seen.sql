-- Presence (owner decision, 2 Nov): when each human seat last had the game
-- open (set as a socket opens and as the seat's last one closes), for the
-- seats' "last seen". Server-only, never in the engine log.
alter table seats add column if not exists last_seen_at timestamptz;
