-- Vermehrungsware hat keine Kontrakte – Spalte aus 20261119120000 wieder entfernt
alter table public.kontrakte drop column if exists vermehrung;
