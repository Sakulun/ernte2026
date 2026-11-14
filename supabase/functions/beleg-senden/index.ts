// Supabase Edge Function "beleg-senden" (deployt im Projekt "Ernte 2026").
// Versendet einen festgeschriebenen Beleg (ZUGFeRD-PDF aus Storage-Bucket "belege") per SMTP.
// Secrets (Supabase Dashboard → Edge Functions → Secrets):
//   SMTP_HOST, SMTP_PORT (587/465), SMTP_USER, SMTP_PASS, SMTP_FROM, optional SMTP_BCC
// Diese Datei ist die Referenzkopie – Änderungen danach erneut deployen.
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const url = Deno.env.get('SUPABASE_URL')!;
    // Client im Namen des Aufrufers: RLS + beleg_berechtigt() greifen.
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: ok, error: rErr } = await userClient.rpc('beleg_berechtigt');
    if (rErr || !ok) return json({ error: 'Keine Berechtigung' }, 403);

    const { beleg_id, an, cc, betreff, text } = await req.json();
    const empf = String(an || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    const ccs = String(cc || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    if (!empf.length || [...empf, ...ccs].some((e) => !EMAIL_RE.test(e))) return json({ error: 'Ungültige Empfängeradresse' }, 400);

    const { data: b, error: bErr } = await userClient.from('belege').select('*').eq('id', beleg_id).single();
    if (bErr || !b) return json({ error: 'Beleg nicht gefunden' }, 404);
    if (b.status === 'entwurf') return json({ error: 'Beleg ist noch nicht festgeschrieben' }, 400);
    if (!b.pdf_pfad) return json({ error: 'Zum Beleg ist noch kein PDF archiviert' }, 400);

    const { data: blob, error: dErr } = await userClient.storage.from('belege').download(b.pdf_pfad);
    if (dErr || !blob) return json({ error: 'PDF konnte nicht geladen werden: ' + (dErr?.message || '') }, 500);
    const pdf = new Uint8Array(await blob.arrayBuffer());

    const host = Deno.env.get('SMTP_HOST');
    const from = Deno.env.get('SMTP_FROM');
    if (!host || !from) return json({ error: 'SMTP ist nicht konfiguriert (Secrets SMTP_HOST/SMTP_FROM fehlen)' }, 500);
    const port = Number(Deno.env.get('SMTP_PORT') || 587);
    const transporter = nodemailer.createTransport({
      host, port, secure: port === 465,
      auth: { user: Deno.env.get('SMTP_USER'), pass: Deno.env.get('SMTP_PASS') },
    });
    const bcc = Deno.env.get('SMTP_BCC') || undefined;
    const info = await transporter.sendMail({
      from, to: empf.join(', '), cc: ccs.length ? ccs.join(', ') : undefined, bcc,
      subject: String(betreff || b.nummer).slice(0, 250),
      text: String(text || ''),
      attachments: [{ filename: `${b.nummer}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });

    const { error: uErr } = await userClient.from('belege').update({
      status: b.status === 'storniert' ? 'storniert' : 'versendet',
      versendet_am: new Date().toISOString(),
      versendet_an: [...empf, ...ccs].join(', '),
    }).eq('id', b.id);
    if (uErr) return json({ ok: true, warnung: 'Gesendet, aber Status nicht gespeichert: ' + uErr.message, messageId: info.messageId });
    return json({ ok: true, messageId: info.messageId });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
