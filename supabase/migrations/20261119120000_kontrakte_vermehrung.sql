-- Massenbilanz: Kontrakt über Vermehrungsware (Z-Saatgut) statt Konsumware
alter table public.kontrakte add column if not exists vermehrung boolean not null default false;
comment on column public.kontrakte.vermehrung is 'Kontrakt über Vermehrungsware (Z-Saatgut) statt Konsumware – für die Massenbilanz';
