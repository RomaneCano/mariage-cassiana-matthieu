-- À exécuter UNE SEULE FOIS : active la modification des textes par les mariés.
create table if not exists textes (
  key text primary key check (char_length(key) <= 40),
  value text not null check (char_length(value) <= 2000),
  updated_at timestamptz not null default now()
);
alter table textes enable row level security;
create policy textes_read  on textes for select to anon, authenticated using (true);
create policy textes_admin on textes for all to authenticated using (is_admin()) with check (is_admin());
grant select on textes to anon;
grant select, insert, update, delete on textes to authenticated;
grant execute on function is_admin() to anon, authenticated;
