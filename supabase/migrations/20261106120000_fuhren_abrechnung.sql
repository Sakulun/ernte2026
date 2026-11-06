-- Einkaufskontrakte: Belegprüfung je Zukauf-Fuhre wie bei Verkauf (warenbewegungen).
alter table public.fuhren
  add column if not exists gutschrift_nr text,
  add column if not exists fracht_nr text,
  add column if not exists quali_nr text,
  add column if not exists klaeren boolean not null default false,
  add column if not exists bemerkung text;
