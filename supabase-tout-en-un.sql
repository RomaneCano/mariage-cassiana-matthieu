-- SCRIPT TOUT-EN-UN : peut être exécuté plusieurs fois sans erreur.
-- Supabase > SQL Editor > New query > coller > Run.

-- 0. Comptes autorisés (adresse commune des mariés)
create table if not exists admins (email text primary key);
alter table admins enable row level security;
insert into admins(email) values ('cassmattas@gmail.com') on conflict do nothing;

create or replace function is_admin() returns boolean language sql stable security definer as $$
  select exists (select 1 from admins where email = lower(auth.jwt() ->> 'email'));
$$;
grant execute on function is_admin() to anon, authenticated;

-- 1. Réponses des invités (présence + allergies)
do $$ begin
  if to_regclass('public.allergies') is not null and to_regclass('public.reponses') is null then
    alter table allergies rename to reponses;
  end if;
end $$;
create table if not exists reponses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nom text not null check (char_length(nom) between 1 and 60),
  prenom text not null check (char_length(prenom) between 1 and 60),
  presence text not null default 'oui' check (presence in ('oui','non')),
  allergies text not null default '',
  categories text[] not null default '{}'
);
alter table reponses add column if not exists presence text not null default 'oui' check (presence in ('oui','non'));
alter table reponses drop constraint if exists allergies_allergies_check;
alter table reponses drop constraint if exists reponses_allergies_len;
alter table reponses add constraint reponses_allergies_len check (char_length(allergies) <= 500);
alter table reponses alter column allergies set default '';
alter table reponses enable row level security;
drop policy if exists allergies_insert on reponses;
drop policy if exists allergies_admin on reponses;
drop policy if exists reponses_insert on reponses;
drop policy if exists reponses_admin on reponses;
create policy reponses_insert on reponses for insert to anon, authenticated with check (true);
create policy reponses_admin on reponses for all to authenticated using (is_admin()) with check (is_admin());
grant insert on reponses to anon;
grant select, insert, update, delete on reponses to authenticated;

-- 2. Textes et mises en forme modifiables par les mariés
create table if not exists textes (
  key text primary key check (char_length(key) <= 40),
  value text not null check (char_length(value) <= 2000),
  updated_at timestamptz not null default now()
);
alter table textes enable row level security;
drop policy if exists textes_read on textes;
drop policy if exists textes_admin on textes;
create policy textes_read on textes for select to anon, authenticated using (true);
create policy textes_admin on textes for all to authenticated using (is_admin()) with check (is_admin());
grant select on textes to anon;
grant select, insert, update, delete on textes to authenticated;

-- 3. Chants et réglages (cagnotte)
create table if not exists songs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  position int not null default 0,
  moment text not null check (char_length(moment) between 1 and 60),
  title text not null check (char_length(title) between 1 and 100),
  author text check (char_length(author) <= 100),
  audio_url text check (audio_url is null or audio_url = '' or audio_url ~* '^https?://')
);
alter table songs enable row level security;
drop policy if exists songs_read on songs;
drop policy if exists songs_admin on songs;
create policy songs_read on songs for select to anon, authenticated using (true);
create policy songs_admin on songs for all to authenticated using (is_admin()) with check (is_admin());
alter table songs add column if not exists lyrics text check (lyrics is null or char_length(lyrics) <= 6000);
insert into songs(position, moment, title, author, audio_url)
  select 0, 'Chant de sortie', 'Je suis dans la joie', 'Guy Bahi / Glorious', 'https://www.youtube.com/watch?v=o73hgSR0E_c'
  where not exists (select 1 from songs);
update songs set audio_url = 'https://www.youtube.com/watch?v=o73hgSR0E_c'
  where title = 'Je suis dans la joie' and (audio_url is null or audio_url = '');

create table if not exists settings (key text primary key, value text not null default '');
alter table settings enable row level security;
drop policy if exists settings_read on settings;
drop policy if exists settings_admin on settings;
create policy settings_read on settings for select to anon, authenticated using (true);
create policy settings_admin on settings for all to authenticated using (is_admin()) with check (is_admin());

grant select on songs, settings to anon;
grant select, insert, update, delete on songs, settings to authenticated;

-- 4. Questions ajoutées par les mariés
create table if not exists faq_extra (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  position int not null default 0,
  q text not null check (char_length(q) between 1 and 200),
  a text not null check (char_length(a) between 1 and 1000)
);
alter table faq_extra enable row level security;
drop policy if exists faq_extra_read on faq_extra;
drop policy if exists faq_extra_admin on faq_extra;
create policy faq_extra_read on faq_extra for select to anon, authenticated using (true);
create policy faq_extra_admin on faq_extra for all to authenticated using (is_admin()) with check (is_admin());
grant select on faq_extra to anon;
grant select, insert, update, delete on faq_extra to authenticated;

-- 5. Seules les adresses de la table « admins » peuvent créer un compte
create or replace function public.only_admin_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admins where email = lower(new.email)) then
    raise exception 'Inscription réservée aux mariés';
  end if;
  return new;
end $$;
drop trigger if exists only_admin_signup on auth.users;
create trigger only_admin_signup before insert on auth.users
  for each row execute function public.only_admin_signup();
