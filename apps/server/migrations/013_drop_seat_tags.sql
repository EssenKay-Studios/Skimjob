-- Seat tags are gone (#202, design §15.3): the private board keeps only notes.
-- Dropping the column drops its checks; a mark without a note goes with it.
delete from suspicion_marks where note = '';
alter table suspicion_marks drop column tag;
alter table suspicion_marks add check (note <> '');
