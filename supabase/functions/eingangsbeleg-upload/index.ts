// Supabase Edge Function "eingangsbeleg-upload" (deployt im Projekt "Ernte 2026", verify_jwt = false).
// Nimmt das PDF eines Eingangsbelegs (Händler-Gutschrift, Quali-/Frachtabrechnung) entgegen und
// legt es im privaten Bucket "eingangsbelege" ab. Aufrufer ist die Routine "Eingangsrechnungen
// sortieren": Sie legt den Datensatz per SQL an, erhält dabei das Einmal-Token (upload_token,
// gültig bis upload_bis) und lädt dann hoch:
//   curl -sS -X POST --data-binary @datei.pdf -H 'Content-Type: application/pdf' \
//     "https://fijfxmjtoexpuxxjqqbf.supabase.co/functions/v1/eingangsbeleg-upload?id=<id>&token=<uuid>"
// Das Token wird nach erfolgreichem Upload gelöscht. Kein dauerhaftes Geheimnis nötig.
// Diese Datei ist die Referenzkopie – Änderungen danach erneut deployen.
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 15 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  try {
    const u = new URL(req.url);
    const id = Number(u.searchParams.get('id'));
    const token = u.searchParams.get('token') || '';
    if (!Number.isInteger(id) || id <= 0 || !UUID_RE.test(token)) return json({ error: 'id/token fehlt oder ungültig' }, 400);

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: b, error } = await sb.from('eingangsbelege')
      .select('id, art, nummer, kontakt_id, upload_token, upload_bis').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!b || !b.upload_token || b.upload_token !== token) return json({ error: 'Token ungültig' }, 403);
    if (!b.upload_bis || new Date(b.upload_bis).getTime() < Date.now()) return json({ error: 'Token abgelaufen' }, 403);

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) return json({ error: 'Datei leer oder zu groß' }, 400);
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') return json({ error: 'Keine PDF-Datei' }, 400);

    const sauber = (s: string) => String(s || '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80);
    const pfad = `${b.kontakt_id ?? 0}/${b.art}_${sauber(b.nummer)}_${b.id}.pdf`;
    const { error: upErr } = await sb.storage.from('eingangsbelege')
      .upload(pfad, bytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) throw upErr;

    const { error: updErr } = await sb.from('eingangsbelege')
      .update({ pdf_pfad: pfad, upload_token: null, upload_bis: null }).eq('id', id);
    if (updErr) throw updErr;
    return json({ ok: true, pdf_pfad: pfad, bytes: bytes.length });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
