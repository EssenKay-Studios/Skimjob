-- Tips setting (S3b.3, design §15.6): teaching pop-ups on or off, one field on
-- the user (guest or account), on by default.
alter table users add column if not exists tips boolean not null default true;
