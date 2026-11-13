-- À exécuter une fois (relançable sans risque) : organisation du mariage, photos, stockage.
-- Nécessite que supabase-tout-en-un.sql (au moins la partie « admins / is_admin ») ait déjà été exécuté.

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
