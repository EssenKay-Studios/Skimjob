-- Scheduler (M2-4): a deadline stops while a meeting is open (design §4.1).
-- Set while paused; on resume due_at moves on by (now - paused_at).
alter table deadlines add column if not exists paused_at timestamptz;
