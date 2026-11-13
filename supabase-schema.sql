-- Base de données du site de mariage (Supabase > SQL Editor > coller > Run)

create table if not exists admins (email text primary key);
-- Adresse commune des mariés (le lien de connexion arrive dans cette boîte) :
insert into admins(email) values ('cassmattas@gmail.com') on conflict do nothing;

create or replace function is_admin() returns boolean language sql stable security definer as $$
  select exists (select 1 from admins where email = lower(auth.jwt() ->> 'email'));
$$;

create table if not exists reponses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nom text not null check (char_length(nom) between 1 and 60),
  prenom text not null check (char_length(prenom) between 1 and 60),
  presence text not null default 'oui' check (presence in ('oui','non')),
  allergies text not null default '' check (char_length(allergies) <= 500),
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
alter table reponses enable row level security;
alter table gifts enable row level security;

-- Réponses (présence + allergies) : tout le monde peut envoyer, seuls les mariés peuvent lire ou supprimer.
create policy reponses_insert on reponses for insert to anon, authenticated with check (true);
create policy reponses_admin  on reponses for all to authenticated using (is_admin()) with check (is_admin());

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
  select 0, 'Chant de sortie', 'Je suis dans la joie', 'Guy Bahi / Glorious', 'https://www.youtube.com/watch?v=o73hgSR0E_c'
  where not exists (select 1 from songs);

-- Réglages (lien de la cagnotte) : lecture publique, modification par les mariés.
create table if not exists settings (key text primary key, value text not null default '');
alter table settings enable row level security;
create policy settings_read  on settings for select to anon, authenticated using (true);
create policy settings_admin on settings for all to authenticated using (is_admin()) with check (is_admin());

-- Droits d'accès
grant insert on reponses to anon;
grant select, insert, update, delete on reponses, gifts, songs, settings to authenticated;
grant select on songs, settings to anon;
grant select on gifts_public to anon, authenticated;
grant execute on function reserve_gift(uuid, text) to anon, authenticated;

-- Textes modifiables par les mariés : lecture publique, écriture réservée aux mariés.
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
