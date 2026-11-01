-- Identity (M2-2). One external-account key per user, prefixed by its
-- sign-in provider ('google:<sub>', 'dev:<name>'), so providers never collide.
-- Null for a guest (invite link + nickname).
alter table users rename column google_sub to external_id;
