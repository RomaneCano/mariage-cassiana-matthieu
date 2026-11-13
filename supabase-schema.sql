-- Base de données du site de mariage (Supabase > SQL Editor > coller > Run)

create table if not exists admins (email text primary key);
-- Remplacez par les vraies adresses de Cassiana et Matthieu :
insert into admins(email) values ('cassiana@exemple.fr'), ('matthieu@exemple.fr') on conflict do nothing;

create or replace function is_admin() returns boolean language sql stable security definer as $$
  select exists (select 1 from admins where email = lower(auth.jwt() ->> 'email'));
$$;

create table if not exists allergies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nom text not null check (char_length(nom) between 1 and 60),
  prenom text not null check (char_length(prenom) between 1 and 60),
  allergies text not null check (char_length(allergies) between 1 and 500),
  categories text[] not null default '{}'
);

create table if not exists gifts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null check (char_length(title) between 1 and 80),
  description text check (char_length(description) <= 240),
  price numeric check (price >= 0),
  link text check (link ~* '^https?://'),
  reserved boolean not null default false,
  reserved_by text not null default ''
);

alter table admins enable row level security;
alter table allergies enable row level security;
alter table gifts enable row level security;

-- Allergies : tout le monde peut envoyer, seuls les mariés peuvent lire ou supprimer.
create policy allergies_insert on allergies for insert to anon, authenticated with check (true);
create policy allergies_admin  on allergies for all to authenticated using (is_admin()) with check (is_admin());

-- Cadeaux : seuls les mariés accèdent à la table complète.
create policy gifts_admin on gifts for all to authenticated using (is_admin()) with check (is_admin());

-- Vue publique sans le nom de la personne qui offre.
create or replace view gifts_public as
  select id, created_at, title, description, price, link, reserved from gifts;
grant select on gifts_public to anon, authenticated;

-- Réservation par un invité.
create or replace function reserve_gift(gift_id uuid, who text) returns void
language sql security definer as $$
  update gifts set reserved = true, reserved_by = left(who, 80)
  where id = gift_id and reserved = false;
$$;
grant execute on function reserve_gift(uuid, text) to anon, authenticated;
