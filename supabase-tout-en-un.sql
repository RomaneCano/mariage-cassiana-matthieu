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

-- 7. Organisation du mariage (tâches, budget, prestataires, plan de tables, jour J) : réservé aux mariés
create table if not exists org_tasks (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  done boolean not null default false, title text not null check (char_length(title) between 1 and 300),
  cat text, due date, who text, notes text
);
create table if not exists org_budget (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  cat text, item text not null check (char_length(item) between 1 and 200),
  estimated numeric, actual numeric, paid numeric, vendor text, notes text
);
create table if not exists org_vendors (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 200), role text, status text,
  contact text, phone text, email text, price numeric, deposit numeric, notes text
);
create table if not exists org_tables (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 100), capacity int, guests text, notes text,
  position int not null default 0
);
create table if not exists org_timeline (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  time text not null, title text not null check (char_length(title) between 1 and 300), who text, notes text
);
do $$
declare t text;
begin
  foreach t in array array['org_tasks','org_budget','org_vendors','org_tables','org_timeline'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_admin', t);
    execute format('create policy %I on %I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- 8. Photos du mariage : dépôt par les mariés, galerie publique une fois publiée
create table if not exists photos (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  path text not null, caption text check (caption is null or char_length(caption) <= 120),
  position int not null default 0
);
alter table photos enable row level security;
drop policy if exists photos_read on photos;
drop policy if exists photos_admin on photos;
create policy photos_read on photos for select to anon, authenticated using (true);
create policy photos_admin on photos for all to authenticated using (is_admin()) with check (is_admin());
grant select on photos to anon;
grant select, insert, update, delete on photos to authenticated;

-- 9. Espaces de stockage : « photos » (public, lecture seule pour les invités) et « prive » (images de prière, mariés uniquement)
insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict (id) do update set public = true;
insert into storage.buckets (id, name, public) values ('prive', 'prive', false) on conflict (id) do update set public = false;
drop policy if exists photos_storage_read on storage.objects;
create policy photos_storage_read on storage.objects for select to anon, authenticated using (bucket_id = 'photos');
drop policy if exists photos_storage_admin on storage.objects;
create policy photos_storage_admin on storage.objects for all to authenticated
  using (bucket_id = 'photos' and public.is_admin()) with check (bucket_id = 'photos' and public.is_admin());
drop policy if exists prive_storage_admin on storage.objects;
create policy prive_storage_admin on storage.objects for all to authenticated
  using (bucket_id = 'prive' and public.is_admin()) with check (bucket_id = 'prive' and public.is_admin());

-- 6. Nettoyage : efface d'éventuels textes contenant un lien collé par erreur
delete from textes where value ilike '%google.com/maps%';

-- ============================================================
-- 10. COVOITURAGE (annonces des invités : aller / retour après la soirée)
-- ============================================================
create table if not exists public.covoiturage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null check (type in ('offre','demande')),
  sens text not null check (sens in ('aller','retour','both')),
  prenom text not null check (char_length(prenom) between 1 and 40),
  lieu text not null check (char_length(lieu) between 1 and 80),
  heure text check (heure is null or char_length(heure) <= 20),
  places int not null default 0 check (places between 0 and 8),
  contact text not null check (char_length(contact) between 5 and 80),
  note text check (note is null or char_length(note) <= 200),
  edit_code text not null check (char_length(edit_code) between 16 and 64)
);
alter table public.covoiturage enable row level security;
drop policy if exists covoit_select on public.covoiturage;
drop policy if exists covoit_insert on public.covoiturage;
drop policy if exists covoit_admin_delete on public.covoiturage;
create policy covoit_select on public.covoiturage for select using (true);
create policy covoit_insert on public.covoiturage for insert with check (true);
create policy covoit_admin_delete on public.covoiturage for delete to authenticated using (public.is_admin());
-- le code secret n'est jamais lisible par le public
revoke all on public.covoiturage from anon, authenticated;
grant select (id, created_at, type, sens, prenom, lieu, heure, places, contact, note) on public.covoiturage to anon, authenticated;
grant insert on public.covoiturage to anon, authenticated;
grant delete on public.covoiturage to authenticated;
create or replace function public.covoit_supprimer(p_id uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.covoiturage where id = p_id and edit_code = p_code;
  if not found then raise exception 'code invalide'; end if;
end $$;
create or replace function public.covoit_places(p_id uuid, p_code text, p_places int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_places < 0 or p_places > 8 then raise exception 'places invalides'; end if;
  update public.covoiturage set places = p_places where id = p_id and edit_code = p_code and type = 'offre';
  if not found then raise exception 'code invalide'; end if;
end $$;
grant execute on function public.covoit_supprimer(uuid, text) to anon, authenticated;
grant execute on function public.covoit_places(uuid, text, int) to anon, authenticated;

-- ============================================================
-- 11. PRESTATAIRES (colonnes du tableur) + JEUX
-- ============================================================
alter table public.org_vendors add column if not exists location text;
alter table public.org_vendors add column if not exists distance text;
alter table public.org_vendors add column if not exists availability text;
create table if not exists public.org_games (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  chosen boolean not null default false,
  name text not null,
  people text,
  material text,
  price numeric,
  notes text
);
alter table public.org_games enable row level security;
drop policy if exists org_games_admin on public.org_games;
create policy org_games_admin on public.org_games for all to authenticated using (public.is_admin()) with check (public.is_admin());
