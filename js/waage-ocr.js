import { state } from './state.js?v=121';
import { db } from './db.js?v=121';
import { showToast } from './helpers.js?v=121';

// ── Waage per Bildschirm ablesen (OCR im Browser) ────────────────────────────
// Der Waagen-PC zeigt das Gewicht im Bitzer-Fenster ("0,00 t"). Statt einer
// externen Bridge gibt der Nutzer hier einmal den Bildschirm frei; die App liest
// das Gewicht per OCR und schreibt es nach waage_live (id=1). Alternativ kann ein
// Screenshot direkt eingefügt/hochgeladen werden (einmalige Lesung).
//
// Erwartetes Anzeigeformat: Tonnen mit 2 Nachkommastellen ("0,00").

const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

let _worker = null;
let _stream = null, _video = null, _canvas = null, _loopTimer = null;
let _running = false;
let _lastVals = [];
let _statusText = 'Nicht verbunden';

// Tesseract-UMD einmalig vom CDN laden (window.Tesseract).
function ladeTesseract() {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const s = document.createElement('script');
    s.src = TESS_URL; s.async = true;
    s.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('Tesseract nicht geladen'));
    s.onerror = () => reject(new Error('OCR-Bibliothek konnte nicht geladen werden (Internet?)'));
    document.head.appendChild(s);
  });
}

async function ensureWorker() {
  if (_worker) return _worker;
  const T = await ladeTesseract();
  _worker = await T.createWorker('eng');
  await _worker.setParameters({ tessedit_char_whitelist: '0123456789.,-t ' });
  return _worker;
}

// Aus den erkannten Wörtern die große Gewichtszahl "X,XX" ziehen (größte Schrift
// = Hauptanzeige, nicht die kleine e=/Min/Max-Zeile oder die Uhr/Datum). -> kg.
function extrahiereKg(data) {
  const re = /^\d+[.,]\d{2}$/;
  const cand = (data.words || [])
    .filter(w => w && w.text && w.bbox && re.test(w.text.trim()) && (w.confidence == null || w.confidence >= 55))
    .map(w => ({ text: w.text.trim(), h: w.bbox.y1 - w.bbox.y0 }));
  if (!cand.length) return { kg: null, raw: '' };
  cand.sort((a, b) => b.h - a.h);
  const m = /(\d+)[.,](\d{2})/.exec(cand[0].text);
  const tonnen = parseInt(m[1] + m[2], 10) / 100;
  return { kg: Math.round(tonnen * 1000), raw: cand[0].text };
}

async function leseKg(source) {
  const w = await ensureWorker();
  const { data } = await w.recognize(source);
  return extrahiereKg(data);
}

async function pushLive(kg, status) {
  state.waageLive = { id: 1, gewicht_kg: kg, status, einheit: 'kg', aktualisiert: new Date().toISOString() };
  if (window.updateWaageWidget) window.updateWaageWidget();
  try { await db.setWaageLive(kg, status); } catch (e) { /* lokal reicht, nächster Tick wieder */ }
}

// ── Kontinuierlich: Bildschirm-Freigabe ──────────────────────────────────────
export async function startWaageBildschirm() {
  if (_running) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    showToast('Dieser Browser unterstützt keine Bildschirm-Freigabe.', 'error'); return;
  }
  try {
    _stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: false });
  } catch (e) {
    _statusText = 'Freigabe abgebrochen'; aktualisierePanel(); return;
  }
  _video = document.createElement('video');
  _video.srcObject = _stream; _video.muted = true;
  try { await _video.play(); } catch (e) {}
  _canvas = document.createElement('canvas');
  _running = true; _lastVals = [];
  _statusText = 'Verbunden – lese Gewicht…';
  _stream.getVideoTracks()[0].addEventListener('ended', () => stopWaageBildschirm());
  aktualisierePanel();
  schleife();
}

async function schleife() {
  if (!_running) return;
  try {
    const vw = _video.videoWidth, vh = _video.videoHeight;
    if (vw && vh) {
      _canvas.width = vw; _canvas.height = vh;
      _canvas.getContext('2d').drawImage(_video, 0, 0, vw, vh);
      const { kg, raw } = await leseKg(_canvas);
      if (kg == null) {
        _statusText = 'Keine Gewichtszahl erkannt – Bitzer-Fenster sichtbar?';
      } else {
        _lastVals.push(kg); if (_lastVals.length > 3) _lastVals.shift();
        const stabil = _lastVals.length >= 3 && _lastVals.every(v => Math.abs(v - kg) <= 20);
        _statusText = (stabil ? '● stabil: ' : '◉ liest: ') + kg.toLocaleString('de-DE') + ' kg  (Anzeige „' + raw + '“)';
        await pushLive(kg, stabil ? 'stable' : 'unstable');
      }
      aktualisierePanel();
    }
  } catch (e) { /* Frame überspringen */ }
  if (_running) _loopTimer = setTimeout(schleife, 1200);
}

export function stopWaageBildschirm() {
  _running = false;
  clearTimeout(_loopTimer);
  if (_stream) { try { _stream.getTracks().forEach(t => t.stop()); } catch (e) {} _stream = null; }
  _video = null; _lastVals = [];
  _statusText = 'Getrennt';
  pushLive(0, 'offline');
  aktualisierePanel();
}

// ── Einmalig: Screenshot einfügen / hochladen ────────────────────────────────
async function leseBildQuelle(src, quelleName) {
  _statusText = 'Lese ' + quelleName + '…'; aktualisierePanel();
  try {
    const { kg, raw } = await leseKg(src);
    if (kg == null) { _statusText = 'Keine Zahl erkannt – nur die Gewichtsanzeige zeigen.'; showToast('Keine Gewichtszahl erkannt', 'error'); }
    else { _statusText = 'Erkannt: ' + kg.toLocaleString('de-DE') + ' kg (Anzeige „' + raw + '“)'; await pushLive(kg, 'stable'); showToast('✓ ' + kg.toLocaleString('de-DE') + ' kg übernommen'); }
  } catch (e) { _statusText = 'Fehler: ' + e.message; showToast('⚠ ' + e.message, 'error'); }
  aktualisierePanel();
}

async function bildAusDatei(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  await leseBildQuelle(img, 'Screenshot');
  URL.revokeObjectURL(url);
}

export function waageBildDatei(input) {
  const f = input && input.files && input.files[0];
  if (f) bildAusDatei(f);
}

// Einfügen (Strg+V) auf dem Panel – Screenshot aus der Zwischenablage lesen.
function pasteHandler(e) {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.type && it.type.indexOf('image') === 0) {
      const f = it.getAsFile();
      if (f) { e.preventDefault(); bildAusDatei(f); return; }
    }
  }
}

// ── Panel-UI ─────────────────────────────────────────────────────────────────
export function waageOcrPanelHTML() {
  const btn = _running
    ? `<button class="btn btn-sm" style="background:var(--red,#b03a3a);color:#fff;border:none" onclick="stopWaageBildschirm()">⏹ Trennen</button>`
    : `<button class="btn btn-sm btn-green" onclick="startWaageBildschirm()">🎥 Bildschirm freigeben</button>`;
  const dot = _running ? 'var(--green2)' : 'var(--text3)';
  return `<div id="waage-ocr-panel" style="background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:10px 14px;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:13px;font-weight:700;color:var(--text)">🖥 Waage vom Bildschirm lesen</span>
      <span style="flex:1"></span>
      ${btn}
    </div>
    <div id="waage-ocr-status" style="font-size:11px;color:${dot};margin-top:6px;font-family:var(--mono)">${_statusText}</div>
    <div id="waage-ocr-paste" tabindex="0"
      style="margin-top:8px;border:1px dashed var(--border2);border-radius:8px;padding:8px 10px;font-size:11px;color:var(--text3);cursor:text"
      title="Hier klicken und Screenshot mit Strg+V einfügen">
      📋 Screenshot hier einfügen (klicken + Strg+V) &nbsp;·&nbsp;
      <label style="color:var(--gold);cursor:pointer;text-decoration:underline">Datei wählen
        <input type="file" accept="image/*" style="display:none" onchange="waageBildDatei(this)">
      </label>
    </div>
    <div style="font-size:10px;color:var(--text3);margin-top:6px;line-height:1.5">
      Beim Freigeben das <b>Bitzer-Fenster</b> (oder den ganzen Bildschirm) wählen. Das Fenster mit der App offen lassen – das Gewicht wird laufend gelesen.
    </div>
  </div>`;
}

// Panel-Status live nachziehen (ohne den ganzen Tab neu zu rendern).
export function aktualisierePanel() {
  const st = document.getElementById('waage-ocr-status');
  if (st) { st.textContent = _statusText; st.style.color = _running ? 'var(--green2)' : 'var(--text3)'; }
  const panel = document.getElementById('waage-ocr-panel');
  if (panel && !panel._pasteBound) {
    const pz = document.getElementById('waage-ocr-paste');
    if (pz) { pz.addEventListener('paste', pasteHandler); panel._pasteBound = true; }
  }
}

export function isWaageBildschirmAktiv() { return _running; }
