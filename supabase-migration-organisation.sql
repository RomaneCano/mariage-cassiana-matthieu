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
alter table public.org_guests add column if not exists a_verifier boolean not null default false;
-- Une réponse d'une personne absente de la liste (ou dont le nom est ambigu) est ajoutée aux invités, marquée « à vérifier ».
create or replace function public.rsvp_add_unknown(p_nom text, p_prenom text, p_pres text, p_al text, p_result text) returns text
language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  select id into gid from public.org_guests
   where a_verifier and public.norm_letters(nom) = public.norm_letters(p_nom) and public.norm_words(prenom) = public.norm_words(p_prenom) limit 1;
  if gid is not null then
    update public.org_guests set presence = p_pres, responded_at = now(), allergie = nullif(p_al, '') where id = gid;
  else
    insert into public.org_guests (nom, prenom, presence, allergie, a_verifier, notes, responded_at, position)
    values (left(trim(coalesce(p_nom,'')), 80), left(trim(coalesce(p_prenom,'')), 80), p_pres, nullif(p_al, ''), true,
            case when p_result = 'ajoute_ambigu' then 'Réponse du site : plusieurs invités portent ce nom, à rapprocher à la main' else 'Réponse du site : personne absente de la liste d''invités' end, now(), (select coalesce(max(position), 0) + 1 from public.org_guests));
  end if;
  return p_result;
end $$;
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
  if coalesce(array_length(ids,1),0) > 1 then return public.rsvp_add_unknown(p_nom, p_prenom, pres, al, 'ajoute_ambigu'); end if;
  -- 2) prénom contenu dans la ligne (« Papy Robert », « Tata Lydie »…) avec le même nom (ou sans nom de famille)
  if coalesce(array_length(ids,1),0) = 0 then
    select array_agg(id) into ids from public.org_guests
      where (' ' || public.norm_words(prenom) || ' ') like ('% ' || pw || ' %')
        and (public.norm_letters(nom) = n or coalesce(nom,'') = '' or (length(n) >= 4 and public.norm_letters(nom) like '%' || n || '%'));
    if coalesce(array_length(ids,1),0) > 1 then
      select array_agg(id) into ids from public.org_guests where public.norm_words(prenom) = pw and (public.norm_letters(nom) = n or coalesce(nom,'') = '');
    end if;
    if coalesce(array_length(ids,1),0) > 1 then return public.rsvp_add_unknown(p_nom, p_prenom, pres, al, 'ajoute_ambigu'); end if;
  end if;
  if coalesce(array_length(ids,1),0) = 0 then return public.rsvp_add_unknown(p_nom, p_prenom, pres, al, 'ajoute'); end if;
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
alter table public.org_tables add column if not exists ends int;
alter table public.org_tables alter column ends drop not null;
alter table public.org_tables alter column ends drop default;
-- valeur vide ou 0 : aucune place en bout de table ; 1 ou 2 : places à ajouter aux petits côtés des tables rectangulaires
update public.org_tables set ends = null where ends = 2 and not exists (select 1 from public.settings where key = 'ends_reset_v2');
insert into public.settings(key, value) values ('ends_reset_v2', '1') on conflict (key) do nothing;
alter table public.org_guests add column if not exists famille text;
alter table public.org_guests add column if not exists enfant_de text;
alter table public.org_deco add column if not exists for_sale boolean not null default false;
alter table public.org_deco add column if not exists sale_price numeric;
alter table public.org_deco add column if not exists sold boolean not null default false;
alter table public.org_deco add column if not exists sold_price numeric;
alter table public.org_deco add column if not exists sold_to text;
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
-- 24. VOYAGE DE NOCES : réservations, itinéraire, à faire / valise, idées (une seule table, rangée par type)
-- ============================================================
create table if not exists public.org_trip (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  kind text not null default 'Étape',
  title text not null check (char_length(title) between 1 and 300),
  date date, time text, end_date date, due date,
  place text, price numeric, paid numeric, ref text, link text,
  done boolean not null default false, notes text
);
alter table public.org_trip enable row level security;
drop policy if exists org_trip_admin on public.org_trip;
create policy org_trip_admin on public.org_trip for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.org_trip from anon;
grant select, insert, update, delete on public.org_trip to authenticated;
notify pgrst, 'reload schema';

-- ============================================================
-- 25. APRÈS LE MARIAGE : démarches administratives, remerciements, souvenirs
-- ============================================================
create table if not exists public.org_after (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  done boolean not null default false,
  title text not null check (char_length(title) between 1 and 300),
  cat text, who text, due date, link text, notes text
);
alter table public.org_after add column if not exists phase text;
alter table public.org_after add column if not exists instructions text;
alter table public.org_after add column if not exists docs text;
alter table public.org_after add column if not exists contact text;
alter table public.org_after add column if not exists phone text;
alter table public.org_after add column if not exists email text;
alter table public.org_after add column if not exists address text;
alter table public.org_after add column if not exists ref text;
alter table public.org_after add column if not exists cost numeric;
alter table public.org_after add column if not exists paid numeric;
alter table public.org_after add column if not exists files jsonb;
alter table public.org_after enable row level security;
drop policy if exists org_after_admin on public.org_after;
create policy org_after_admin on public.org_after for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.org_after from anon;
grant select, insert, update, delete on public.org_after to authenticated;
notify pgrst, 'reload schema';

-- 26. Présence à la mairie + feuilles de route (déroulé du jour J par invité ou par profil)
alter table public.org_guests add column if not exists presence_mairie text;
create table if not exists public.org_roadmaps (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 200),
  kind text not null default 'guest', guest_id uuid, profile text,
  status text not null default 'À faire', sent boolean not null default false, sent_at date,
  message text, notes text
);
alter table public.org_roadmaps enable row level security;
drop policy if exists org_roadmaps_admin on public.org_roadmaps;
create policy org_roadmaps_admin on public.org_roadmaps for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.org_roadmaps from anon;
grant select, insert, update, delete on public.org_roadmaps to authenticated;
alter table public.org_timeline add column if not exists roadmap_id uuid references public.org_roadmaps(id) on delete cascade;
notify pgrst, 'reload schema';
