-- The Graveyard: knocked-out teams' farewell roasts, kept as one derived document next to the board.
alter table public.record_docs drop constraint if exists record_docs_key_check;
alter table public.record_docs add constraint record_docs_key_check check (key in ('board', 'fan_names', 'pending', 'graveyard'));
