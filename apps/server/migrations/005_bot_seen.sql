-- Bots (PR #22 review): hash of the last view each bot seat acted on, so a
-- restarted server neither acts again on it nor skips a change. Bot seats only.
alter table seats add column if not exists bot_seen text;
