-- Correctif à exécuter une fois dans Supabase > SQL Editor si un onglet de l'espace des mariés affiche
-- « ce compte n'a pas le droit d'écrire ». Ne supprime ni ne modifie aucune donnée.

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

-- Confidentialité : le public ne peut lire que les réglages d'affichage du site (photos, FAQ, cagnotte).
-- Les notes, le budget, les liens privés (ex. Google Sheet) ne sont plus lisibles que par les mariés connectés.
drop policy if exists settings_read on settings;
create policy settings_read on settings for select to anon, authenticated
  using (key in ('photos_public','photos_link','faq_order','faq_edits','cagnotte_url') or is_admin());
notify pgrst, 'reload schema';
