-- Schritt 2 von 2: Rollen endgültig entfernen. Erst einspielen, wenn der neue App-Stand (Modul-Version 159) online
-- und geprüft ist. Danach gibt es keinen einfachen Weg zurück: Die alte App braucht die Spalte rolle.
-- Ohne Trigger-Neubau würde das Entfernen der Spalte scheitern, weil trg_sync_nutzer_auth daran hängt.

begin;

drop function public.admin_create_nutzer(text, text, text);
drop function public.admin_create_nutzer_bg(text, text, text);
drop function public.admin_update_nutzer(integer, text, text, text);
drop function public.rechte_aus_rolle(text, text);

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
  RETURN json_build_object('id', found_user.id, 'name', found_user.name, 'rechte', found_user.rechte);
END; $$;

-- Anmeldekonten: Rolle fällt aus dem Abgleich und aus den Kontodaten.
create or replace function public.sync_nutzer_auth()
  returns trigger language plpgsql security definer set search_path to 'public', 'auth', 'extensions'
as $$
DECLARE
  v_email text;
  v_uid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM auth.users WHERE email = 'n' || OLD.id || '@ernte2026.local';
    RETURN OLD;
  END IF;
  v_email := 'n' || NEW.id || '@ernte2026.local';
  SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
  IF v_uid IS NULL THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token)
    VALUES ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
      extensions.crypt(NEW.pw, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider','email','providers', jsonb_build_array('email'), 'nutzer_id', NEW.id),
      jsonb_build_object('name', NEW.name), now(), now(),
      '', '', '', '', '', '', '', '');
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_uid, v_uid::text,
      jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now());
  ELSE
    UPDATE auth.users SET
      encrypted_password = extensions.crypt(NEW.pw, extensions.gen_salt('bf')),
      raw_user_meta_data = jsonb_build_object('name', NEW.name),
      updated_at = now()
    WHERE id = v_uid;
  END IF;
  RETURN NEW;
END; $$;

drop trigger trg_sync_nutzer_auth on public.nutzer;
create trigger trg_sync_nutzer_auth
  after insert or delete or update of pw, name on public.nutzer
  for each row execute function public.sync_nutzer_auth();

update auth.users set raw_app_meta_data = raw_app_meta_data - 'rolle'
  where email like 'n%@ernte2026.local' and raw_app_meta_data ? 'rolle';

-- Die Sicht verliert eine Spalte, das geht nur per Neuanlage. id und name bleiben für die Anmeldeseite der
-- Flächenverwaltung. Standardrechte von Supabase wieder einschränken wie in 20261031220000: nur lesen.
drop view public.nutzer_public;
alter table public.nutzer drop column rolle;
create view public.nutzer_public as
  select id, name, erstellt_am, profil, rechte from public.nutzer;
revoke all on public.nutzer_public from anon, authenticated;
grant select on public.nutzer_public to anon, authenticated;

notify pgrst, 'reload schema';

commit;
