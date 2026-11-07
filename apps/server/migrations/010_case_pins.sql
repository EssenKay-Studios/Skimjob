-- Case board pins (S3b.5, design §15.3/§15.4): the ids of the leads and facts a seat
-- pinned, private to the seat, kept across rounds, outside the game log.
alter table seats add column if not exists pins jsonb not null default '[]';
