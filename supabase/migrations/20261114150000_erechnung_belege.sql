-- E-Rechnungen (ZUGFeRD): Rechnungen aus Verkaufskontrakten, Gutschriften aus Einkaufskontrakten.
-- Bereits eingespielt am 14.11.2026 (Migrationen erechnung_belege, erechnung_quellen_schutz, erechnung_haertung).

-- Stammdaten-Erweiterungen
alter table kontakte add column if not exists ust_id text,
  add column if not exists steuernummer text,
  add column if not exists land text default 'DE',
  add column if not exists rechnung_email text,
  add column if not exists zahlungsziel_tage integer default 14,
  add column if not exists ust_modus text default 'regel' check (ust_modus in ('regel','pauschal24'));
alter table artikel add column if not exists ust_satz numeric default 7;

-- Berechtigung: wer Kontrakte verwalten darf, darf auch abrechnen
create or replace function beleg_berechtigt() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from nutzer n
    where ('n' || n.id || '@ernte2026.local') = (auth.jwt() ->> 'email')
      and ('kontrakte' = any(n.rechte) or 'rechnungen' = any(n.rechte)));
$$;

-- Abzugs-/Zuschlagsregeln
create table if not exists abzugsregeln (
  id serial primary key,
  name text not null,
  art text not null check (art in ('gewicht_qualitaet','preis_qualitaet','eur_t','pauschal')),
  feld text,
  vergleich text default 'ueber' check (vergleich in ('ueber','unter')),
  schwelle numeric,
  wert numeric not null default 0,
  vorzeichen text not null default 'abzug' check (vorzeichen in ('abzug','zuschlag')),
  gilt_fuer text not null default 'beide' check (gilt_fuer in ('rechnung','gutschrift','beide')),
  artikel_id integer references artikel(id) on delete set null,
  kontakt_id integer references kontakte(id) on delete set null,
  aktiv boolean not null default true,
  erstellt_am timestamptz default now()
);
alter table abzugsregeln enable row level security;
create policy abzugsregeln_berechtigt on abzugsregeln for all to authenticated using (beleg_berechtigt()) with check (beleg_berechtigt());

-- Belege
create table if not exists belege (
  id serial primary key,
  art text not null check (art in ('rechnung','gutschrift')),
  nummer text unique,
  status text not null default 'entwurf' check (status in ('entwurf','festgeschrieben','versendet','storniert')),
  datum date, leistung_von date, leistung_bis date, faellig_am date,
  zahlungsziel_tage integer default 14,
  kontakt_id integer references kontakte(id),
  kontrakt_id integer references kontrakte(id) on delete set null,
  storno_von_id integer references belege(id),
  empfaenger jsonb,
  positionen jsonb not null default '[]'::jsonb,
  steuern jsonb,
  netto numeric(14,2), ust numeric(14,2), brutto numeric(14,2),
  ust_modus text default 'regel',
  bemerkung text, xml text, pdf_pfad text,
  versendet_am timestamptz, versendet_an text,
  erstellt_von integer,
  erstellt_am timestamptz default now(),
  festgeschrieben_am timestamptz
);
create index if not exists belege_kontrakt_idx on belege(kontrakt_id);
alter table belege enable row level security;
create policy belege_berechtigt on belege for all to authenticated using (beleg_berechtigt()) with check (beleg_berechtigt());

alter table warenbewegungen add column if not exists beleg_id integer references belege(id) on delete set null;
alter table fuhren add column if not exists beleg_id integer references belege(id) on delete set null;
alter table lieferungen add column if not exists beleg_id integer references belege(id) on delete set null;

create table if not exists beleg_nummernkreise (
  kreis text not null, jahr integer not null, letzte integer not null default 0,
  primary key (kreis, jahr)
);
alter table beleg_nummernkreise enable row level security;
create policy nk_lesen on beleg_nummernkreise for select to authenticated using (beleg_berechtigt());

-- Festgeschriebene Belege sind unveränderlich (GoBD)
create or replace function belege_schutz() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'entwurf' then raise exception 'Festgeschriebene Belege können nicht gelöscht werden – bitte stornieren.'; end if;
    return old;
  end if;
  if old.status <> 'entwurf' then
    if new.art is distinct from old.art or new.nummer is distinct from old.nummer
       or new.datum is distinct from old.datum or new.positionen is distinct from old.positionen
       or new.netto is distinct from old.netto or new.ust is distinct from old.ust or new.brutto is distinct from old.brutto
       or new.kontakt_id is distinct from old.kontakt_id or new.empfaenger is distinct from old.empfaenger
       or new.steuern is distinct from old.steuern or new.faellig_am is distinct from old.faellig_am
       or new.storno_von_id is distinct from old.storno_von_id
       or (old.xml is not null and new.xml is distinct from old.xml)
       or (old.pdf_pfad is not null and new.pdf_pfad is distinct from old.pdf_pfad)
       or new.status = 'entwurf' then
      raise exception 'Beleg % ist festgeschrieben und kann nicht mehr geändert werden.', old.nummer;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists belege_schutz_trg on belege;
create trigger belege_schutz_trg before update or delete on belege for each row execute function belege_schutz();

-- Abgerechnete Lieferungen mit dem Beleg verknüpfen / lösen
create or replace function belege_quellen_sync() returns trigger language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if tg_op = 'DELETE' then b := old; else b := new; end if;
  update warenbewegungen set beleg_id = null where beleg_id = b.id;
  update fuhren set beleg_id = null where beleg_id = b.id;
  update lieferungen set beleg_id = null where beleg_id = b.id;
  if tg_op <> 'DELETE' and b.status <> 'storniert' and b.storno_von_id is null then
    update warenbewegungen set beleg_id = b.id where id in
      (select (p->>'quelle_id')::int from jsonb_array_elements(b.positionen) p where p->>'quelle' = 'wb')
      and (beleg_id is null or beleg_id in (select id from belege where status = 'entwurf'));
    update fuhren set beleg_id = b.id where id in
      (select (p->>'quelle_id')::int from jsonb_array_elements(b.positionen) p where p->>'quelle' = 'fuhre')
      and (beleg_id is null or beleg_id in (select id from belege where status = 'entwurf'));
    update lieferungen set beleg_id = b.id where id in
      (select (p->>'quelle_id')::int from jsonb_array_elements(b.positionen) p where p->>'quelle' = 'lief')
      and (beleg_id is null or beleg_id in (select id from belege where status = 'entwurf'));
  end if;
  return null;
end $$;
drop trigger if exists belege_quellen_trg on belege;
create trigger belege_quellen_trg after insert or update of positionen, status or delete on belege for each row execute function belege_quellen_sync();

-- Festschreiben: Nummer vergeben, Datum/Fälligkeit setzen, Storno-Original markieren
create or replace function beleg_festschreiben(p_id integer, p_datum date default null)
returns belege language plpgsql security definer set search_path = public as $$
declare b belege; v_kreis text; v_jahr int; v_nr int; v_datum date;
begin
  if not beleg_berechtigt() then raise exception 'Keine Berechtigung'; end if;
  select * into b from belege where id = p_id for update;
  if not found then raise exception 'Beleg nicht gefunden'; end if;
  if b.status <> 'entwurf' then raise exception 'Beleg ist bereits festgeschrieben'; end if;
  if jsonb_array_length(b.positionen) = 0 then raise exception 'Beleg hat keine Positionen'; end if;
  if exists (
    select 1 from jsonb_array_elements(b.positionen) p
    left join warenbewegungen w on p->>'quelle'='wb' and w.id = (p->>'quelle_id')::int
    left join fuhren f on p->>'quelle'='fuhre' and f.id = (p->>'quelle_id')::int
    left join lieferungen l on p->>'quelle'='lief' and l.id = (p->>'quelle_id')::int
    where coalesce(w.beleg_id, f.beleg_id, l.beleg_id, b.id) <> b.id
  ) and b.storno_von_id is null then
    raise exception 'Mindestens eine Lieferung ist bereits in einem anderen Beleg abgerechnet.';
  end if;
  v_datum := coalesce(p_datum, current_date);
  v_jahr := extract(year from v_datum);
  v_kreis := case when b.art = 'rechnung' then 'RE' else 'GS' end;
  insert into beleg_nummernkreise(kreis, jahr, letzte) values (v_kreis, v_jahr, 1)
    on conflict (kreis, jahr) do update set letzte = beleg_nummernkreise.letzte + 1
    returning letzte into v_nr;
  update belege set nummer = v_kreis || '-' || v_jahr || '-' || lpad(v_nr::text, 4, '0'),
    status = 'festgeschrieben', datum = v_datum,
    faellig_am = v_datum + coalesce(zahlungsziel_tage, 14),
    festgeschrieben_am = now()
  where id = p_id returning * into b;
  if b.storno_von_id is not null then
    update belege set status = 'storniert' where id = b.storno_von_id;
  end if;
  return b;
end $$;

revoke execute on function beleg_berechtigt() from anon, public;
revoke execute on function beleg_festschreiben(integer, date) from anon, public;
revoke execute on function belege_quellen_sync() from anon, authenticated, public;
grant execute on function beleg_berechtigt() to authenticated;
grant execute on function beleg_festschreiben(integer, date) to authenticated;

-- Privater Storage-Bucket für archivierte Beleg-PDFs
insert into storage.buckets (id, name, public) values ('belege','belege', false) on conflict (id) do nothing;
create policy belege_storage_lesen on storage.objects for select to authenticated using (bucket_id = 'belege' and beleg_berechtigt());
create policy belege_storage_schreiben on storage.objects for insert to authenticated with check (bucket_id = 'belege' and beleg_berechtigt());

alter publication supabase_realtime add table belege;

-- Recht "rechnungen" (Sidebar-Bereich) allen geben, die Kontrakte verwalten
update nutzer set rechte = array_append(rechte, 'rechnungen')
  where 'kontrakte' = any(rechte) and not ('rechnungen' = any(rechte));
