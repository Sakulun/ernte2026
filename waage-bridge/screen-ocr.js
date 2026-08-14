/**
 * Waage-Bildschirm-Bridge: Bitzer-Anzeige per OCR → Supabase
 *
 * Der Waagen-PC zeigt das Gewicht über das Bitzer-Tool auf dem Bildschirm an.
 * Da die Waage per IP nicht erreichbar ist, lesen wir den Zahlenwert direkt
 * vom Bildschirm ab: Ein konfigurierter Bildschirmausschnitt wird abfotografiert,
 * per OCR in eine Zahl umgewandelt und in die Supabase-Tabelle `waage_live`
 * geschrieben (id = 1) – dasselbe Schema wie die alte TCP-Bridge (index.js).
 * Die Ernte-App zeigt den Wert dann live an ("Waage").
 *
 * Modi:
 *   node screen-ocr.js kalibrieren   Vollbild-Screenshot -> bildschirm.png
 *   node screen-ocr.js test          Ausschnitt + OCR EINMAL (zum Einstellen)
 *   node screen-ocr.js               Live-Betrieb (schreibt laufend nach Supabase)
 *
 * Konfiguration: .env im selben Verzeichnis (siehe .env.example).
 */

const fs   = require('fs');
const path = require('path');

// ── Konfiguration aus .env laden ──────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('FEHLER: .env-Datei nicht gefunden. Bitte .env.example kopieren -> .env und ausfüllen.');
    process.exit(1);
  }
  const cfg = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) cfg[m[1].trim()] = m[2].trim();
  }
  return cfg;
}

const cfg = loadEnv();
const num = (v, d) => { const n = parseFloat(v); return isNaN(n) ? d : n; };

const REGION = {
  x: Math.round(num(cfg.REGION_X, 0)),
  y: Math.round(num(cfg.REGION_Y, 0)),
  w: Math.round(num(cfg.REGION_W, 400)),
  h: Math.round(num(cfg.REGION_H, 120)),
};
const MONITOR       = cfg.MONITOR != null && cfg.MONITOR !== '' ? cfg.MONITOR : null;
const POLL_MS       = Math.max(300, Math.round(num(cfg.POLL_MS, 1000)));
const OCR_SCALE     = Math.min(6, Math.max(1, num(cfg.OCR_SCALE, 3)));
const EINHEIT       = (cfg.ANZEIGE_EINHEIT || 'kg').toLowerCase() === 't' ? 't' : 'kg';
const DEZIMALSTELLEN= Math.max(0, Math.round(num(cfg.DEZIMALSTELLEN, EINHEIT === 't' ? 3 : 0)));
const STABIL_AB     = Math.max(2, Math.round(num(cfg.STABIL_AB, 3)));
const STABIL_TOL_KG = Math.max(0, num(cfg.STABIL_TOLERANZ_KG, 10));
const OFFLINE_NACH  = Math.max(1, Math.round(num(cfg.OFFLINE_NACH, 5)));
const INVERT        = /^(1|true|ja|yes)$/i.test(cfg.OCR_INVERTIEREN || '');
const SB_URL        = cfg.SUPABASE_URL;
const SB_KEY        = cfg.SUPABASE_KEY;

// ── OCR-Text -> Gewicht in kg ──────────────────────────────────────────────────
// Robust gegen Tausender-/Dezimaltrenner: wir ziehen die längste Ziffernfolge
// heraus und setzen das Komma per fester Stellenzahl (DEZIMALSTELLEN). Das ist
// eindeutig – egal ob die Anzeige "40.500", "40500" oder "40,5" liefert.
function parseGewicht(raw) {
  if (!raw) return null;
  const neg = /-\s*\d/.test(raw) || /\d\s*-/.test(raw);
  const runs = (raw.match(/\d+/g) || []);
  if (!runs.length) return null;
  let digits = runs.join('');              // alle Ziffern zusammen
  if (!digits.length) return null;
  if (digits.length > 9) digits = digits.slice(0, 9); // Ausreißer kappen
  let wert = parseInt(digits, 10);
  if (DEZIMALSTELLEN > 0) wert = wert / Math.pow(10, DEZIMALSTELLEN);
  let kg = EINHEIT === 't' ? wert * 1000 : wert;
  if (neg) kg = -kg;
  return Math.round(kg);
}

// ── Bild aufnehmen & vorbereiten ───────────────────────────────────────────────
async function vollbild() {
  const screenshot = require('screenshot-desktop');
  const opt = { format: 'png' };
  if (MONITOR != null) opt.screen = MONITOR;
  return screenshot(opt); // Buffer (PNG)
}

async function ausschnittBild(vollbildBuffer, speichernAls) {
  const Jimp = require('jimp');
  const img = await Jimp.read(vollbildBuffer);
  const iw = img.bitmap.width, ih = img.bitmap.height;
  const x = Math.min(Math.max(0, REGION.x), iw - 1);
  const y = Math.min(Math.max(0, REGION.y), ih - 1);
  const w = Math.min(REGION.w, iw - x);
  const h = Math.min(REGION.h, ih - y);
  img.crop(x, y, w, h)
     .scale(OCR_SCALE)
     .greyscale()
     .contrast(0.4)
     .normalize();
  if (INVERT) img.invert();
  if (speichernAls) await img.writeAsync(path.join(__dirname, speichernAls));
  return img.getBufferAsync(Jimp.MIME_PNG);
}

// ── OCR-Worker (einmalig) ──────────────────────────────────────────────────────
let _worker = null;
async function ocr(buffer) {
  const { createWorker, PSM } = require('tesseract.js');
  if (!_worker) {
    _worker = await createWorker('eng');
    await _worker.setParameters({
      tessedit_char_whitelist: '0123456789.,- ',
      tessedit_pageseg_mode: PSM ? PSM.SINGLE_LINE : '7',
    });
  }
  const { data } = await _worker.recognize(buffer);
  return (data.text || '').trim();
}

// ── Supabase ───────────────────────────────────────────────────────────────────
let _sb = null;
function sb() {
  if (!_sb) {
    const { createClient } = require('@supabase/supabase-js');
    _sb = createClient(SB_URL, SB_KEY);
  }
  return _sb;
}
async function push(gewicht_kg, status) {
  const { error } = await sb().from('waage_live').upsert({
    id: 1, gewicht_kg, status, einheit: 'kg', aktualisiert: new Date().toISOString(),
  });
  if (error) console.warn('[Supabase]', error.message);
}

// ── Modus: kalibrieren ─────────────────────────────────────────────────────────
async function modusKalibrieren() {
  const screenshot = require('screenshot-desktop');
  try {
    const displays = await screenshot.listDisplays();
    console.log('Bildschirme:');
    displays.forEach((d, i) => console.log(`  [${d.id}] ${d.name || 'Display'} ${d.width}x${d.height}` + (i === 0 ? '  (Standard)' : '')));
  } catch (e) { /* listDisplays optional */ }
  const buf = await vollbild();
  const Jimp = require('jimp');
  const img = await Jimp.read(buf);
  const outFull = path.join(__dirname, 'bildschirm.png');
  await img.writeAsync(outFull);
  console.log(`\nVollbild gespeichert: ${outFull}  (${img.bitmap.width}x${img.bitmap.height})`);
  console.log('\nSo findest du die Zahlen: bildschirm.png in PAINT öffnen.');
  console.log('  • Maus auf die LINKE OBERE Ecke der Gewichtszahl  -> Pixel unten links = REGION_X / REGION_Y');
  console.log('  • Maus auf die RECHTE UNTERE Ecke der Gewichtszahl -> daraus REGION_W / REGION_H berechnen');
  console.log('Werte in .env eintragen, dann:  node screen-ocr.js test');
}

// ── Modus: test (einmal) ───────────────────────────────────────────────────────
async function modusTest() {
  const buf = await vollbild();
  const region = await ausschnittBild(buf, 'ausschnitt.png');
  const text = await ocr(region);
  const kg = parseGewicht(text);
  console.log('Ausschnitt gespeichert: ' + path.join(__dirname, 'ausschnitt.png'));
  console.log('OCR-Rohtext:            ' + JSON.stringify(text));
  console.log('Erkanntes Gewicht:      ' + (kg == null ? '— (nichts erkannt)' : kg.toLocaleString('de-DE') + ' kg'));
  console.log('\nStimmt der Ausschnitt (ausschnitt.png) und der Wert? Sonst REGION_* in .env anpassen und erneut testen.');
  if (_worker) await _worker.terminate();
}

// ── Modus: live ────────────────────────────────────────────────────────────────
async function modusLive() {
  if (!SB_URL || !SB_KEY || /HIER_/.test(SB_KEY)) {
    console.error('FEHLER: SUPABASE_URL / SUPABASE_KEY in .env fehlen.');
    process.exit(1);
  }
  console.log('=== Waage-Bildschirm-Bridge (OCR) ===');
  console.log(`Ausschnitt: x${REGION.x} y${REGION.y} ${REGION.w}x${REGION.h}` + (MONITOR != null ? `  Monitor ${MONITOR}` : ''));
  console.log(`Takt: ${POLL_MS}ms · Einheit: ${EINHEIT} · Dezimalstellen: ${DEZIMALSTELLEN} · stabil ab ${STABIL_AB} gleichen Messungen`);
  console.log(`Supabase: ${SB_URL}\n`);

  const letzte = [];      // letzte erfolgreiche kg-Werte (für Stabilität)
  let fehlzaehler = 0;    // aufeinanderfolgende Fehllesungen
  let letzterStatus = null, letzterWert = null;
  await push(0, 'offline');

  async function tick() {
    let kg = null;
    try {
      const buf = await vollbild();
      const region = await ausschnittBild(buf, null);
      const text = await ocr(region);
      kg = parseGewicht(text);
    } catch (e) {
      console.warn('[OCR] Fehler:', e.message);
    }

    if (kg == null) {
      fehlzaehler++;
      if (fehlzaehler >= OFFLINE_NACH && letzterStatus !== 'offline') {
        await push(0, 'offline');
        letzterStatus = 'offline'; letzterWert = null; letzte.length = 0;
        console.log('○ offline (keine Zahl erkannt)');
      }
      return;
    }
    fehlzaehler = 0;
    letzte.push(kg);
    if (letzte.length > STABIL_AB) letzte.shift();

    const stabil = letzte.length >= STABIL_AB &&
      letzte.every(v => Math.abs(v - kg) <= STABIL_TOL_KG);
    const status = stabil ? 'stable' : 'unstable';

    // Nur schreiben, wenn sich etwas ändert (schont die DB, App bleibt live genug).
    const wertGeaendert = letzterWert == null || Math.abs(kg - letzterWert) > STABIL_TOL_KG;
    if (status !== letzterStatus || wertGeaendert) {
      await push(kg, status);
      letzterStatus = status; letzterWert = kg;
      console.log(`${stabil ? '●' : '○'} ${kg.toLocaleString('de-DE')} kg  [${status}]`);
    }
  }

  await tick();
  setInterval(tick, POLL_MS);
}

// ── Start ──────────────────────────────────────────────────────────────────────
const modus = (process.argv[2] || '').toLowerCase();
(async () => {
  try {
    if (modus === 'kalibrieren' || modus === 'calibrate') await modusKalibrieren();
    else if (modus === 'test') await modusTest();
    else await modusLive();
  } catch (e) {
    if (/Cannot find module/.test(e.message)) {
      console.error('\nFEHLER: Abhängigkeiten fehlen. Bitte einmalig im Ordner ausführen:\n   npm install\n');
    }
    console.error(e.message);
    process.exit(1);
  }
})();

module.exports = { parseGewicht };
