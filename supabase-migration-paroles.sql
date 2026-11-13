-- Ajoute la colonne des paroles de chants. Peut être relancé sans risque.
alter table songs add column if not exists lyrics text check (lyrics is null or char_length(lyrics) <= 6000);
