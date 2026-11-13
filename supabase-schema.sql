-- Base de données du site de mariage (Supabase > SQL Editor > coller > Run)

create table if not exists admins (email text primary key);
-- Adresse commune des mariés (le lien de connexion arrive dans cette boîte) :
insert into admins(email) values ('cassmattas@gmail.com') on conflict do nothing;

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

-- Chants : lecture publique, modification par les mariés.
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
create policy songs_read  on songs for select to anon, authenticated using (true);
create policy songs_admin on songs for all to authenticated using (is_admin()) with check (is_admin());
insert into songs(position, moment, title, author, audio_url)
  select 0, 'Chant de sortie', 'Je suis dans la joie', 'Guy Bahi / Glorious', ''
  where not exists (select 1 from songs);

-- Réglages (lien de la cagnotte) : lecture publique, modification par les mariés.
create table if not exists settings (key text primary key, value text not null default '');
alter table settings enable row level security;
create policy settings_read  on settings for select to anon, authenticated using (true);
create policy settings_admin on settings for all to authenticated using (is_admin()) with check (is_admin());
