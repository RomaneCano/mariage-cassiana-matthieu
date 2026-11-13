-- À exécuter UNE SEULE FOIS si vous aviez déjà lancé supabase-schema.sql avant l'ajout de la présence.
alter table allergies rename to reponses;
alter policy allergies_insert on reponses rename to reponses_insert;
alter policy allergies_admin on reponses rename to reponses_admin;
alter table reponses add column if not exists presence text not null default 'oui' check (presence in ('oui','non'));
alter table reponses drop constraint if exists allergies_allergies_check;
alter table reponses add constraint reponses_allergies_len check (char_length(allergies) <= 500);
alter table reponses alter column allergies set default '';
grant insert on reponses to anon;
grant select, insert, update, delete on reponses to authenticated;
