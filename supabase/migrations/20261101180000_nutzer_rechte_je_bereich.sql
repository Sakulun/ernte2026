-- Schritt 1 von 2: Rechte je Programmbereich statt Rollen. Rein ergänzend, die Spalte rolle bleibt vorerst stehen.
-- Der alte App-Stand läuft danach unverändert weiter, der neue App-Stand braucht diese Datei. Reihenfolge daher:
--   1. diese Datei einspielen   2. App ausrollen   3. Schritt 2 (20261101180100_nutzer_rolle_entfernen.sql)
-- Das UPDATE weiter unten setzt nur rechte. Der Trigger trg_sync_nutzer_auth hört auf pw, rolle und name und feuert
-- nicht, die Anmeldekonten (auth.users) bleiben also unberührt.

begin;

alter table public.nutzer
  add column rechte text[] not null default '{}';
alter table public.nutzer
  alter column rolle set default 'abfahrer'; -- Neue Nutzer aus der neuen App (Rechte kommen getrennt), bis Schritt 2

-- Übergang: dieselbe Zuordnung für den Bestand und für Änderungen aus noch offenen alten App-Fenstern.
create function public.rechte_aus_rolle(p_rolle text, p_profil text)
  returns text[] language sql immutable set search_path = ''
as $$
  select case
    when p_profil = 'biogas' then case when p_rolle = 'admin' then array['biogas_verwaltung'] else '{}'::text[] end
    when p_rolle = 'admin' then array[
      'waage','dashboard','fortschritt','karte','vermehrungen','schlaege','fuhren','nutzer','lager','silos',
      'warenausgang','kontrakte','zukauf','kontakte','artikel','fruchtfolge','erntejahr','nachrichten','haengerzuege']
    when p_rolle = 'silomeister' then array['waage','fuhren','vermehrungen','silos','zukauf','haengerzuege','standort']
    when p_rolle = 'waage' then array['waage','fuhren','warenausgang','zukauf']
    when p_rolle = 'abfahrer' then array['abfahrer','standort']
    when p_rolle = 'drescher' then array['drescher','standort']
    else '{}'::text[]
  end;
$$;

update public.nutzer set rechte = public.rechte_aus_rolle(rolle, profil);

-- Prüfung des angemeldeten Nutzers. Konto n<id>@ernte2026.local gehört zu nutzer.id = <id>.
create function public.nutzer_id_aus_jwt()
  returns integer language sql stable set search_path = ''
as $$
  select (substring(auth.jwt() ->> 'email' from '^n(\d+)@ernte2026\.local$'))::integer;
$$;

create function public.hat_recht(p_recht text)
  returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.nutzer n
    where n.id = public.nutzer_id_aus_jwt() and p_recht = any (n.rechte)
  );
$$;

-- Name bleibt, weil die RLS-Regeln und ff_-Funktionen ihn nutzen. Gemeint ist nur noch die Fruchtfolge.
-- Die beiden Biogas-Verwalter kamen bisher über ihre Rolle admin auch hier durch, ohne dass die App das nutzt.
-- Läuft je Zeile in den RLS-Regeln, darum dieselbe Abfrageform wie bisher statt eines Aufrufs von hat_recht().
create or replace function public.ff_is_admin()
  returns boolean language sql stable security definer set search_path to 'public', 'extensions'
as $$
  select exists (
    select 1 from nutzer n
    where ('n' || n.id || '@ernte2026.local') = (auth.jwt() ->> 'email')
      and 'fruchtfolge' = any (n.rechte)
  );
$$;

-- Schutz vor Aussperren: Der letzte Ernte-Nutzer mit Nutzerverwaltung bleibt, auch bei direktem Zugriff.
create function public.nutzer_letzte_verwaltung_schuetzen()
  returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if 'nutzer' = any (old.rechte) and (tg_op = 'DELETE' or not ('nutzer' = any (new.rechte))) then
    perform pg_advisory_xact_lock(hashtext('nutzer_letzte_verwaltung')); -- zwei gleichzeitige Änderungen nacheinander
    if not exists (select 1 from public.nutzer n
                   where n.id <> old.id and n.profil = 'ernte' and 'nutzer' = any (n.rechte)) then
      raise exception 'Mindestens ein Nutzer muss die Nutzerverwaltung behalten.';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

create trigger trg_nutzer_letzte_verwaltung
  before update of rechte or delete on public.nutzer
  for each row execute function public.nutzer_letzte_verwaltung_schuetzen();

-- Neue Funktionen für den neuen App-Stand (PostgREST wählt anhand der Parameternamen).
create function public.admin_create_nutzer(p_name text, p_rechte text[], p_pw text)
  returns integer language plpgsql security definer set search_path to 'public'
as $$
declare new_id integer;
begin
  if not public.hat_recht('nutzer') and session_user <> 'postgres' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Keine Berechtigung für die Nutzerverwaltung';
  end if;
  if 'biogas_verwaltung' = any (p_rechte) then
    raise exception 'Dieses Recht gehört zur Biogas-App';
  end if;
  insert into nutzer (name, rechte, pw) values (p_name, p_rechte, p_pw) returning id into new_id;
  return new_id;
end $$;

create function public.admin_update_nutzer(p_id integer, p_name text, p_rechte text[], p_pw text default null::text)
  returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.hat_recht('nutzer') and session_user <> 'postgres' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Keine Berechtigung für die Nutzerverwaltung';
  end if;
  if 'biogas_verwaltung' = any (p_rechte) then
    raise exception 'Dieses Recht gehört zur Biogas-App';
  end if;
  if p_id = public.nutzer_id_aus_jwt() and not ('nutzer' = any (p_rechte)) then
    raise exception 'Das eigene Recht auf die Nutzerverwaltung kann nur ein anderer Nutzer entziehen.';
  end if;
  update nutzer set name = p_name, rechte = p_rechte, pw = coalesce(p_pw, pw) where id = p_id and profil = 'ernte';
  if not found then
    raise exception 'Nutzer nicht gefunden';
  end if;
end $$;

create function public.admin_create_nutzer_bg(p_name text, p_verwaltung boolean, p_pw text)
  returns integer language plpgsql security definer set search_path to 'public'
as $$
declare new_id integer;
begin
  if not public.hat_recht('biogas_verwaltung') and session_user <> 'postgres' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Keine Berechtigung für die Biogas-Verwaltung';
  end if;
  insert into nutzer (name, rechte, pw, profil)
    values (p_name, case when p_verwaltung then array['biogas_verwaltung'] else '{}'::text[] end, p_pw, 'biogas')
    returning id into new_id;
  return new_id;
end $$;

-- Gemeinsam für beide Apps: Jede darf nur ihre eigenen Konten löschen, niemand das eigene.
create or replace function public.admin_delete_nutzer(p_id integer)
  returns void language plpgsql security definer set search_path to 'public'
as $$
declare v_profil text;
begin
  select profil into v_profil from nutzer where id = p_id;
  if not public.hat_recht(case when v_profil = 'biogas' then 'biogas_verwaltung' else 'nutzer' end)
     and session_user <> 'postgres' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Keine Berechtigung für die Nutzerverwaltung';
  end if;
  if p_id = public.nutzer_id_aus_jwt() then
    raise exception 'Das eigene Konto kann nur ein anderer Nutzer löschen.';
  end if;
  delete from nutzer where id = p_id;
end $$;

-- Alte Funktionen bleiben für offene alte App-Fenster bis Schritt 2, prüfen aber schon die neuen Rechte.
create or replace function public.admin_create_nutzer(p_name text, p_rolle text, p_pw text)
  returns integer language plpgsql security definer set search_path to 'public'
as $$
declare new_id integer;
begin
  if not public.hat_recht('nutzer') and session_user <> 'postgres' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Nur Admins';
  end if;
  insert into nutzer (name, rolle, rechte, pw)
    values (p_name, p_rolle, public.rechte_aus_rolle(p_rolle, 'ernte'), p_pw) returning id into new_id;
  return new_id;
end $$;

create or replace function public.admin_create_nutzer_bg(p_name text, p_rolle text, p_pw text)
  returns integer language plpgsql security definer set search_path to 'public'
as $$
declare new_id integer;
begin
  if not public.hat_recht('biogas_verwaltung') and session_user <> 'postgres' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Nur Admins';
  end if;
  insert into nutzer (name, rolle, rechte, pw, profil)
    values (p_name, p_rolle, public.rechte_aus_rolle(p_rolle, 'biogas'), p_pw, 'biogas') returning id into new_id;
  return new_id;
end $$;

create or replace function public.admin_update_nutzer(p_id integer, p_name text, p_rolle text, p_pw text default null::text)
  returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.hat_recht('nutzer') and session_user <> 'postgres' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Nur Admins';
  end if;
  update nutzer set
    name = p_name,
    rechte = case when rolle is distinct from p_rolle then public.rechte_aus_rolle(p_rolle, profil) else rechte end,
    rolle = p_rolle,
    pw = coalesce(p_pw, pw)
  where id = p_id;
end $$;

-- Anmeldung liefert zusätzlich die Rechte.
create or replace function public.check_password(p_name text, p_hash text, p_legacy_hash text default null::text)
  returns json language plpgsql security definer set search_path to 'public'
as $$
DECLARE
  found_user record;
BEGIN
  -- Try current hash
  SELECT * INTO found_user FROM public.nutzer
    WHERE lower(name) = lower(p_name) AND pw = p_hash;

  -- Try legacy hash if provided
  IF found_user IS NULL AND p_legacy_hash IS NOT NULL THEN
    SELECT * INTO found_user FROM public.nutzer
      WHERE lower(name) = lower(p_name) AND pw = p_legacy_hash;
    -- Migrate to new hash format
    IF found_user IS NOT NULL THEN
      UPDATE public.nutzer SET pw = p_hash WHERE id = found_user.id;
    END IF;
  END IF;

  IF found_user IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'id', found_user.id,
    'name', found_user.name,
    'rolle', found_user.rolle,
    'rechte', found_user.rechte
  );
END;
$$;

create or replace function public.check_password_bg(p_name text, p_hash text, p_legacy_hash text default null::text)
  returns json language plpgsql security definer set search_path to 'public'
as $$
DECLARE found_user record;
BEGIN
  SELECT * INTO found_user FROM public.nutzer
    WHERE lower(name)=lower(p_name) AND pw=p_hash AND profil='biogas';
  IF found_user IS NULL AND p_legacy_hash IS NOT NULL THEN
    SELECT * INTO found_user FROM public.nutzer
      WHERE lower(name)=lower(p_name) AND pw=p_legacy_hash AND profil='biogas';
    IF found_user IS NOT NULL THEN
      UPDATE public.nutzer SET pw=p_hash WHERE id=found_user.id;
    END IF;
  END IF;
  IF found_user IS NULL THEN RETURN NULL; END IF;
  RETURN json_build_object('id', found_user.id, 'name', found_user.name, 'rolle', found_user.rolle, 'rechte', found_user.rechte);
END; $$;

-- Sicht: ergänzt um rechte. Die Anmeldeseiten lesen sie weiter ohne Anmeldung, wie bisher rolle.
create or replace view public.nutzer_public as
  select id, name, rolle, erstellt_am, profil, rechte from public.nutzer;

-- Supabase vergibt für neue Funktionen standardmäßig Ausführungsrechte an alle. Wie in 20261031220000 einschränken.
revoke execute on function
  public.admin_create_nutzer(text, text[], text),
  public.admin_update_nutzer(integer, text, text[], text),
  public.admin_create_nutzer_bg(text, boolean, text),
  public.nutzer_letzte_verwaltung_schuetzen(),
  public.rechte_aus_rolle(text, text)
from public, anon, authenticated;
grant execute on function
  public.admin_create_nutzer(text, text[], text),
  public.admin_update_nutzer(integer, text, text[], text),
  public.admin_create_nutzer_bg(text, boolean, text)
to authenticated, service_role;

-- Keine Abweichung zwischen Rolle und Rechten, sonst bricht alles ab und nichts ist geändert.
do $$
declare v_falsch integer;
begin
  select count(*) into v_falsch from public.nutzer where rechte is distinct from public.rechte_aus_rolle(rolle, profil);
  if v_falsch > 0 then
    raise exception '% Nutzer ohne passende Rechte', v_falsch;
  end if;
  if not exists (select 1 from public.nutzer where profil = 'ernte' and 'nutzer' = any (rechte)) then
    raise exception 'Niemand hätte die Nutzerverwaltung';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- Rückbau, solange Schritt 2 nicht lief (nur zusammen mit dem alten App-Stand):
--   ff_is_admin() wieder auf n.rolle = 'admin' und die alten Funktionen wieder auf ff_is_admin() stellen, siehe
--   20261031220000_public_nutzer_admin_absichern.sql; neue Funktionen, Trigger, Sicht-Spalte und Spalte rechte entfernen.
