-- Journal de mariage (à exécuter une fois dans Supabase > SQL Editor ; déjà inclus dans supabase-tout-en-un.sql).
-- Prérequis : la fonction is_admin() du script principal.

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
