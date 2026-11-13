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
