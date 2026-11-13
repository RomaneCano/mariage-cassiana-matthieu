-- À exécuter UNE SEULE FOIS dans le SQL Editor de Supabase.
-- Accès réservé aux mariés : seules les adresses de la table « admins » peuvent créer un compte.
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

-- Questions ajoutées par les mariés : lecture publique, écriture réservée aux mariés.
create table if not exists faq_extra (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  position int not null default 0,
  q text not null check (char_length(q) between 1 and 200),
  a text not null check (char_length(a) between 1 and 1000)
);
alter table faq_extra enable row level security;
create policy faq_extra_read  on faq_extra for select to anon, authenticated using (true);
create policy faq_extra_admin on faq_extra for all to authenticated using (is_admin()) with check (is_admin());
grant select on faq_extra to anon;
grant select, insert, update, delete on faq_extra to authenticated;
