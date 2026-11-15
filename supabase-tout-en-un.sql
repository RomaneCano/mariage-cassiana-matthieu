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

-- (aucune suppression de données dans ce script : il ne fait qu'ajouter ou mettre à jour la structure)

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

-- ============================================================
-- 12. COVOITURAGE : prendre une place (réservations)
-- ============================================================
create table if not exists public.covoit_reservations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  offer_id uuid not null references public.covoiturage(id) on delete cascade,
  prenom text not null check (char_length(prenom) between 1 and 40),
  contact text not null check (char_length(contact) between 5 and 80)
);
alter table public.covoit_reservations enable row level security;
revoke all on public.covoit_reservations from anon, authenticated;
grant select, delete on public.covoit_reservations to authenticated;
drop policy if exists covoit_res_admin on public.covoit_reservations;
create policy covoit_res_admin on public.covoit_reservations for all to authenticated using (public.is_admin()) with check (public.is_admin());
alter table public.covoit_reservations add column if not exists nb int not null default 1 check (nb between 1 and 8);
drop function if exists public.covoit_prendre(uuid, text, text);
drop function if exists public.covoit_passagers(uuid, text);
create or replace function public.covoit_prendre(p_id uuid, p_prenom text, p_contact text, p_nb int default 1) returns void
language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(p_prenom,'')) not between 1 and 40 or char_length(coalesce(p_contact,'')) not between 5 and 80 then raise exception 'informations invalides'; end if;
  if p_nb is null or p_nb < 1 or p_nb > 8 then raise exception 'nombre de places invalide'; end if;
  update public.covoiturage set places = places - p_nb where id = p_id and type = 'offre' and places >= p_nb;
  if not found then raise exception 'plus assez de places'; end if;
  insert into public.covoit_reservations (offer_id, prenom, contact, nb) values (p_id, p_prenom, p_contact, p_nb);
end $$;
create or replace function public.covoit_passagers(p_id uuid, p_code text) returns table (prenom text, contact text, created_at timestamptz, nb int)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.covoiturage where id = p_id and edit_code = p_code) then raise exception 'code invalide'; end if;
  return query select r.prenom, r.contact, r.created_at, r.nb from public.covoit_reservations r where r.offer_id = p_id order by r.created_at;
end $$;
grant execute on function public.covoit_prendre(uuid, text, text, int) to anon, authenticated;
grant execute on function public.covoit_passagers(uuid, text) to anon, authenticated;

-- ============================================================
-- 13. BUDGET : part prise en charge par la famille
-- ============================================================
alter table public.org_budget add column if not exists family numeric;

-- ============================================================
-- 14. PLAN DE TABLES : forme des tables
-- ============================================================
alter table public.org_tables add column if not exists shape text;

-- ============================================================
-- 15. INVITÉS (liste des mariés) + confirmation automatique de présence
-- ============================================================
create table if not exists public.org_guests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  position int not null default 0,
  nom text,
  prenom text not null,
  tel text,
  presence text not null default 'ATT' check (presence in ('ATT','OUI','NON')),
  allergie text,
  adresse text,
  envoi text,
  age text,
  notes text,
  responded_at timestamptz
);
alter table public.org_guests enable row level security;
drop policy if exists org_guests_admin on public.org_guests;
create policy org_guests_admin on public.org_guests for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.org_guests from anon;

-- normalisation : minuscules, sans accents ni ponctuation
create or replace function public.norm_letters(t text) returns text language sql immutable as $$
  select regexp_replace(translate(lower(coalesce(t,'')), 'àâäáãåéèêëíìîïóòôöõúùûüýÿçñœæ', 'aaaaaaeeeeiiiiooooouuuuyycnoa'), '[^a-z0-9]', '', 'g')
$$;
create or replace function public.norm_words(t text) returns text language sql immutable as $$
  select trim(regexp_replace(translate(lower(coalesce(t,'')), 'àâäáãåéèêëíìîïóòôöõúùûüýÿçñœæ', 'aaaaaaeeeeiiiiooooouuuuyycnoa'), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Appelée par le formulaire du site : retrouve l'invité (nom + prénom) et met à jour sa présence et ses allergies.
-- Renvoie 'ok', 'ambigu' (plusieurs personnes possibles) ou 'inconnu'. Ne révèle jamais la liste.
create or replace function public.rsvp_guest(p_nom text, p_prenom text, p_presence text, p_allergies text)
returns text language plpgsql security definer set search_path = public as $$
declare
  n text := public.norm_letters(p_nom);
  pw text := public.norm_words(p_prenom);
  pres text := case when lower(coalesce(p_presence,'')) in ('oui','yes') then 'OUI' else 'NON' end;
  al text := left(trim(coalesce(p_allergies,'')), 300);
  ids uuid[];
  gid uuid;
begin
  if pw = '' or n = '' then return 'inconnu'; end if;
  -- 1) nom et prénom identiques
  select array_agg(id) into ids from public.org_guests where public.norm_letters(nom) = n and public.norm_words(prenom) = pw;
  if coalesce(array_length(ids,1),0) > 1 then return 'ambigu'; end if;
  -- 2) prénom contenu dans la ligne (« Papy Robert », « Tata Lydie »…) avec le même nom (ou sans nom de famille)
  if coalesce(array_length(ids,1),0) = 0 then
    select array_agg(id) into ids from public.org_guests
      where (' ' || public.norm_words(prenom) || ' ') like ('% ' || pw || ' %')
        and (public.norm_letters(nom) = n or coalesce(nom,'') = '' or (length(n) >= 4 and public.norm_letters(nom) like '%' || n || '%'));
    if coalesce(array_length(ids,1),0) > 1 then
      select array_agg(id) into ids from public.org_guests where public.norm_words(prenom) = pw and (public.norm_letters(nom) = n or coalesce(nom,'') = '');
    end if;
    if coalesce(array_length(ids,1),0) > 1 then return 'ambigu'; end if;
  end if;
  if coalesce(array_length(ids,1),0) = 0 then return 'inconnu'; end if;
  gid := ids[1];
  update public.org_guests set
    presence = pres,
    responded_at = now(),
    allergie = case
      when pres = 'OUI' and al <> '' then
        case when coalesce(allergie,'') = '' then al
             when position(lower(al) in lower(allergie)) > 0 then allergie
             else allergie || ', ' || al end
      else allergie end
  where id = gid;
  return 'ok';
end $$;
grant execute on function public.rsvp_guest(text, text, text, text) to anon, authenticated;

-- ============================================================
-- 16. BUDGET : lien d'achat
-- ============================================================
alter table public.org_budget add column if not exists link text;

-- ============================================================
-- 17. INVITÉS : e-mail et suivi de l'envoi du lien d'invitation
-- ============================================================
alter table public.org_guests add column if not exists email text;
alter table public.org_guests add column if not exists invite_sent_at timestamptz;

-- ============================================================
-- 18. DÉCORATION ET PAPETERIE (petites dépenses en quantité)
-- ============================================================
create table if not exists public.org_deco (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  link text,
  unit numeric,
  qty numeric default 1,
  notes text
);
alter table public.org_deco enable row level security;
drop policy if exists org_deco_admin on public.org_deco;
create policy org_deco_admin on public.org_deco for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.org_deco from anon;

-- ============================================================
-- 19. DÉCORATION ET PAPETERIE : montant payé
-- ============================================================
alter table public.org_deco add column if not exists paid numeric;
alter table public.org_tasks add column if not exists status text;
alter table public.org_games add column if not exists moment text;
alter table public.org_games add column if not exists start_time text;
alter table public.org_games add column if not exists duration int;
alter table public.org_games add column if not exists place text;
alter table public.org_games add column if not exists owner text;
alter table public.org_games add column if not exists ready boolean not null default false;
alter table public.org_games add column if not exists prize text;
alter table public.org_games add column if not exists rules text;
alter table public.org_timeline add column if not exists end_time text;
alter table public.org_timeline add column if not exists kind text;
alter table public.org_timeline add column if not exists place text;
alter table public.org_timeline add column if not exists game text;

-- ============================================================
-- 20. COVOITURAGE : trajets depuis / vers d'autres villes
-- ============================================================
alter table public.covoiturage drop constraint if exists covoiturage_sens_check;
alter table public.covoiturage add constraint covoiturage_sens_check check (sens in ('aller','retour','both','venir','rentrer'));

-- ============================================================
-- 21. JOURNAL DE MARIAGE : un espace par marié, protégé par un code,
--     révélé automatiquement le 9 octobre 2027.
--     Les tables ne sont lisibles par personne en direct : tout passe par les fonctions ci-dessous.
-- ============================================================
create table if not exists public.journal_codes (
  author text primary key check (author in ('cassiana','matthieu')),
  salt text not null, code_hash text not null
);
create table if not exists public.org_journal (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  author text not null,
  entry_date date not null default current_date,
  kind text not null default 'Pensée' check (kind in ('Pensée','À faire','Surprise','Souvenir','Lettre','Mémo')),
  title text check (title is null or char_length(title) <= 120),
  body text not null check (char_length(body) between 1 and 8000),
  done boolean not null default false
);
alter table public.org_journal drop constraint if exists org_journal_author_check;
alter table public.org_journal add constraint org_journal_author_check check (author in ('cassiana','matthieu','commun'));
alter table public.journal_codes enable row level security;
alter table public.org_journal enable row level security;
revoke all on public.journal_codes from anon, authenticated;
revoke all on public.org_journal from anon, authenticated;

create or replace function public.journal_unlocked() returns boolean language sql stable as $$
  select now() >= timestamptz '2027-10-09 00:00:00+02';
$$;

-- vérifie le droit d'accès : retourne null si OK, sinon un motif ('code', 'nocode')
create or replace function public.journal_gate(p_author text, p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare c public.journal_codes%rowtype;
begin
  if not is_admin() then raise exception 'accès refusé'; end if;
  if p_author not in ('cassiana','matthieu','commun') then raise exception 'auteur invalide'; end if;
  if p_author = 'commun' or journal_unlocked() then return null; end if;   -- les notes communes n'ont pas de code
  select * into c from public.journal_codes where author = p_author;
  if not found then return 'nocode'; end if;
  if c.code_hash = encode(sha256(convert_to(c.salt || coalesce(p_code, ''), 'UTF8')), 'hex') then return null; end if;
  return 'code';
end $$;

create or replace function public.journal_status() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'accès refusé'; end if;
  return jsonb_build_object(
    'cassiana', exists (select 1 from public.journal_codes where author = 'cassiana'),
    'matthieu', exists (select 1 from public.journal_codes where author = 'matthieu'),
    'unlocked', journal_unlocked());
end $$;

-- crée le code (première fois) ou le change (ancien code requis, sauf après la révélation)
create or replace function public.journal_set_code(p_author text, p_new text, p_old text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s text; g text;
begin
  if not is_admin() then raise exception 'accès refusé'; end if;
  if p_author not in ('cassiana','matthieu') then raise exception 'auteur invalide'; end if;
  if p_new is null or char_length(p_new) < 4 or char_length(p_new) > 60 then return jsonb_build_object('ok', false, 'error', 'court'); end if;
  if exists (select 1 from public.journal_codes where author = p_author) then
    g := journal_gate(p_author, p_old);
    if g is not null then return jsonb_build_object('ok', false, 'error', g); end if;
  end if;
  s := replace(gen_random_uuid()::text, '-', '');
  insert into public.journal_codes(author, salt, code_hash)
  values (p_author, s, encode(sha256(convert_to(s || p_new, 'UTF8')), 'hex'))
  on conflict (author) do update set salt = excluded.salt, code_hash = excluded.code_hash;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.journal_list(p_author text, p_code text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g text;
begin
  g := journal_gate(p_author, p_code);
  if g is not null then return jsonb_build_object('ok', false, 'error', g); end if;
  return jsonb_build_object('ok', true, 'entries', coalesce((
    select jsonb_agg(to_jsonb(e) - 'author' order by e.entry_date desc, e.created_at desc)
      from public.org_journal e where e.author = p_author), '[]'::jsonb));
end $$;

create or replace function public.journal_save(p_author text, p_code text, p_id uuid, p_date date, p_kind text, p_title text, p_body text, p_done boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g text; nid uuid;
begin
  g := journal_gate(p_author, p_code);
  if g is not null then return jsonb_build_object('ok', false, 'error', g); end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then return jsonb_build_object('ok', false, 'error', 'vide'); end if;
  if p_id is null then
    insert into public.org_journal(author, entry_date, kind, title, body, done)
    values (p_author, coalesce(p_date, current_date), coalesce(p_kind, 'Pensée'), nullif(btrim(coalesce(p_title, '')), ''), p_body, coalesce(p_done, false))
    returning id into nid;
  else
    update public.org_journal set entry_date = coalesce(p_date, entry_date), kind = coalesce(p_kind, kind),
           title = nullif(btrim(coalesce(p_title, '')), ''), body = p_body, done = coalesce(p_done, false)
     where id = p_id and author = p_author returning id into nid;
    if nid is null then return jsonb_build_object('ok', false, 'error', 'introuvable'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

create or replace function public.journal_delete(p_author text, p_code text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g text;
begin
  g := journal_gate(p_author, p_code);
  if g is not null then return jsonb_build_object('ok', false, 'error', g); end if;
  delete from public.org_journal where id = p_id and author = p_author;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.journal_gate(text, text) from public, anon, authenticated;
grant execute on function public.journal_unlocked() to authenticated;
grant execute on function public.journal_status() to authenticated;
grant execute on function public.journal_set_code(text, text, text) to authenticated;
grant execute on function public.journal_list(text, text) to authenticated;
grant execute on function public.journal_save(text, text, uuid, date, text, text, text, boolean) to authenticated;
grant execute on function public.journal_delete(text, text, uuid) to authenticated;
revoke execute on function public.journal_status() from public, anon;
revoke execute on function public.journal_set_code(text, text, text) from public, anon;
revoke execute on function public.journal_list(text, text) from public, anon;
revoke execute on function public.journal_save(text, text, uuid, date, text, text, text, boolean) from public, anon;
revoke execute on function public.journal_delete(text, text, uuid) from public, anon;
notify pgrst, 'reload schema';

-- ============================================================
-- 22. DROITS D'ACCÈS EXPLICITES (indispensable sur les projets récents de Supabase,
--     où les nouvelles tables ne sont plus accessibles automatiquement : sans ces lignes,
--     l'onglet affiche « ce compte n'a pas le droit d'écrire »).
--     Les politiques de sécurité (RLS) ci-dessus restent en vigueur : seuls les mariés connectés ont accès.
-- ============================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.org_tasks, public.org_budget, public.org_vendors, public.org_tables, public.org_timeline,
  public.org_guests, public.org_deco, public.org_games to authenticated;
grant select, insert, update, delete on public.reponses, public.textes, public.songs, public.settings, public.faq_extra, public.photos to authenticated;
grant select on public.songs, public.settings, public.textes, public.faq_extra, public.photos to anon;
grant insert on public.reponses to anon;
notify pgrst, 'reload schema';
