-- Eingangsbelege des Handels zu Verkaufskontrakten (Gutschriften, Qualitäts- und
-- Frachtabrechnungen). Werden von der Routine "Eingangsrechnungen sortieren" aus
-- rechnungen@ gelesen, den Auslieferungen (warenbewegungen) zugeordnet und geprüft.
-- Die Fuhre trägt weiterhin die Nummer in gutschrift_nr / quali_nr / fracht_nr;
-- Abweichungen setzen dort klaeren + bemerkung.

create table if not exists public.eingangsbelege (
  id            bigserial primary key,
  art           text not null check (art in ('gutschrift','quali','fracht')),
  nummer        text not null,
  kontakt_id    bigint references public.kontakte(id) on delete set null,
  kontrakt_ids  bigint[] not null default '{}',
  datum         date,
  menge_t       numeric,
  netto         numeric,
  ust           numeric,
  brutto        numeric,
  -- [{pos, kontrakt_nr, lieferdatum, kennzeichen, lieferschein_nr, menge_t, preis, betrag,
  --   warenbewegung_id, waage_t, diff_kg, abweichungen:[text]}]
  positionen    jsonb not null default '[]',
  -- Abzüge/Zuschläge auf Belegebene: [{text, betrag}]
  abzuege       jsonb not null default '[]',
  -- Zusammenfassung aller Abweichungen (Texte), leer = alles passt
  abweichungen  jsonb not null default '[]',
  status        text not null default 'ok' check (status in ('ok','abweichung','unzugeordnet','erledigt')),
  pdf_pfad      text,
  upload_token  uuid default gen_random_uuid(),
  upload_bis    timestamptz default now() + interval '2 hours',
  quelle_datei  text,
  ablage_datei  text,
  erstellt_am   timestamptz not null default now(),
  unique (kontakt_id, art, nummer)
);

create index if not exists eingangsbelege_kontrakte_idx on public.eingangsbelege using gin (kontrakt_ids);
create index if not exists eingangsbelege_nummer_idx on public.eingangsbelege (nummer);

alter table public.eingangsbelege enable row level security;
drop policy if exists eingangsbelege_berechtigt on public.eingangsbelege;
create policy eingangsbelege_berechtigt on public.eingangsbelege for all to authenticated
  using (beleg_berechtigt()) with check (beleg_berechtigt());

-- Upload-Token nie an die App ausliefern: App liest nur die übrigen Spalten
-- und darf nur den Status ändern (Abweichung als erledigt markieren).
revoke all on public.eingangsbelege from anon, authenticated;
grant select (id, art, nummer, kontakt_id, kontrakt_ids, datum, menge_t, netto, ust, brutto,
  positionen, abzuege, abweichungen, status, pdf_pfad, quelle_datei, ablage_datei, erstellt_am)
  on public.eingangsbelege to authenticated;
grant update (status) on public.eingangsbelege to authenticated;

-- Privater Bucket für die PDFs; Schreiben nur über die Edge Function
-- eingangsbeleg-upload (Service-Role, prüft das Einmal-Token des Datensatzes).
insert into storage.buckets (id, name, public) values ('eingangsbelege','eingangsbelege', false)
  on conflict (id) do nothing;
drop policy if exists eingangsbelege_storage_lesen on storage.objects;
create policy eingangsbelege_storage_lesen on storage.objects for select to authenticated
  using (bucket_id = 'eingangsbelege' and beleg_berechtigt());
