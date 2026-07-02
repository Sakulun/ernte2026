/**
 * Waage-Bridge: Schenck Disomat Opus → Supabase
 *
 * Verbindet per TCP mit dem Disomat Opus (MinProz-Protokoll),
 * liest alle POLL_MS Millisekunden das aktuelle Gewicht,
 * und schreibt den Wert in die Supabase-Tabelle `waage_live`.
 *
 * Konfiguration: .env-Datei im selben Verzeichnis (siehe .env.example)
 */

const net  = require('net');
const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ── Konfiguration aus .env laden ──────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('FEHLER: .env-Datei nicht gefunden. Bitte .env.example kopieren und ausfüllen.');
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const cfg   = {};
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) cfg[m[1].trim()] = m[2].trim();
  }
  return cfg;
}

const cfg = loadEnv();
const WAAGE_IP    = cfg.WAAGE_IP    || '192.168.1.50';
const WAAGE_PORT  = parseInt(cfg.WAAGE_PORT  || '8000');
const POLL_MS     = parseInt(cfg.POLL_MS     || '2000');
const POLL_CMD    = (cfg.POLL_CMD   || 'SI') + '\r\n';   // MinProz: SI = Stable/Instant
const SB_URL      = cfg.SUPABASE_URL;
const SB_KEY      = cfg.SUPABASE_KEY;

if (!SB_URL || !SB_KEY) {
  console.error('FEHLER: SUPABASE_URL und SUPABASE_KEY müssen in .env gesetzt sein.');
  process.exit(1);
}

const sb = createClient(SB_URL, SB_KEY);

// ── MinProz-Antwort parsen ─────────────────────────────────────────────────────
// Typisches Format: " +014500.000 kg ST\r\n"
// ST = Stable, US = Unstable, OL = Overload, ER = Error
function parseMinProz(line) {
  const trimmed = line.trim();
  const m = trimmed.match(/([+-]?\d+\.?\d*)\s*(kg|t|lb)/i);
  if (!m) return null;

  let gewicht_kg = parseFloat(m[1]);
  if (m[2].toLowerCase() === 't')  gewicht_kg *= 1000;
  if (m[2].toLowerCase() === 'lb') gewicht_kg *= 0.453592;

  const upperLine = trimmed.toUpperCase();
  let status = 'unstable';
  if (upperLine.includes(' ST'))       status = 'stable';
  else if (upperLine.includes(' OL'))  status = 'overload';
  else if (upperLine.includes(' ER'))  status = 'error';

  return { gewicht_kg: Math.round(gewicht_kg), status, einheit: 'kg' };
}

// ── Supabase-Schreibfunktion ───────────────────────────────────────────────────
async function pushToSupabase(data) {
  const { error } = await sb.from('waage_live').upsert({
    id: 1,
    ...data,
    aktualisiert: new Date().toISOString()
  });
  if (error) console.warn('[Supabase]', error.message);
}

async function setOffline() {
  await pushToSupabase({ gewicht_kg: 0, status: 'offline', einheit: 'kg' });
}

// ── TCP-Verbindung mit automatischem Reconnect ────────────────────────────────
let client = null;
let buffer = '';
let pollTimer = null;
let offlineTimer = null;

function connect() {
  console.log(`[Waage] Verbinde mit ${WAAGE_IP}:${WAAGE_PORT}...`);
  client = new net.Socket();

  client.connect(WAAGE_PORT, WAAGE_IP, () => {
    console.log(`[Waage] Verbunden ✓  (polling alle ${POLL_MS}ms)`);
    clearTimeout(offlineTimer);
    poll();
  });

  client.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // letztes Fragment behalten
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = parseMinProz(line);
      if (parsed) {
        const sign = parsed.status === 'stable' ? '●' : '○';
        console.log(`[Waage] ${sign} ${parsed.gewicht_kg.toLocaleString('de-DE')} kg  [${parsed.status}]`);
        pushToSupabase(parsed);
      } else {
        console.debug('[Waage] Rohdaten:', JSON.stringify(line));
      }
    }
  });

  client.on('error', (err) => {
    console.warn(`[Waage] Verbindungsfehler: ${err.message}`);
  });

  client.on('close', () => {
    console.warn('[Waage] Verbindung getrennt. Reconnect in 5s...');
    clearInterval(pollTimer);
    offlineTimer = setTimeout(async () => {
      await setOffline();
      console.log('[Waage] Status: offline');
    }, 10000);
    setTimeout(connect, 5000);
  });
}

function poll() {
  pollTimer = setInterval(() => {
    if (client && !client.destroyed) {
      client.write(POLL_CMD);
    }
  }, POLL_MS);
}

// ── Start ─────────────────────────────────────────────────────────────────────
console.log('=== Waage-Bridge gestartet ===');
console.log(`Waage:    ${WAAGE_IP}:${WAAGE_PORT}  (Befehl: ${POLL_CMD.trim()})`);
console.log(`Supabase: ${SB_URL}`);
console.log('');
setOffline().then(() => connect());
