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
create or replace function public.covoit_prendre(p_id uuid, p_prenom text, p_contact text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(p_prenom,'')) not between 1 and 40 or char_length(coalesce(p_contact,'')) not between 5 and 80 then raise exception 'informations invalides'; end if;
  update public.covoiturage set places = places - 1 where id = p_id and type = 'offre' and places > 0;
  if not found then raise exception 'plus de place'; end if;
  insert into public.covoit_reservations (offer_id, prenom, contact) values (p_id, p_prenom, p_contact);
end $$;
create or replace function public.covoit_passagers(p_id uuid, p_code text) returns table (prenom text, contact text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.covoiturage where id = p_id and edit_code = p_code) then raise exception 'code invalide'; end if;
  return query select r.prenom, r.contact, r.created_at from public.covoit_reservations r where r.offer_id = p_id order by r.created_at;
end $$;
grant execute on function public.covoit_prendre(uuid, text, text) to anon, authenticated;
grant execute on function public.covoit_passagers(uuid, text) to anon, authenticated;
