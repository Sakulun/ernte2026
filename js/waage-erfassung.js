import { state } from './state.js?v=45';
import { db } from './db.js?v=45';
import { getFeld, showToast, escapeHtml, kg2t } from './helpers.js?v=45';
import { isBioFeld } from './bio.js?v=45';
import { getQualitaetsfelder } from './quality.js?v=45';
import { parseGewicht } from './abfahrer.js?v=45';

// ── Modul "Fuhre erfassen" ───────────────────────────────────────────────────
// Zwei Modi:
//  • modus 'abschluss' (Admin/Silomeister, Waage-Tablet): Schlag/Sorte/Abfahrer +
//    Gewichte/Qualität → Fuhre direkt mit Status "fertig" anlegen.
//  • modus 'offen' (Abfahrer-Selbsterfassung, mobil): nur Schlag/Sorte wählen
//    (Abfahrer = angemeldeter Nutzer) → offene Fuhre starten, danach im Tab
//    "Offen" wiegen. Ersetzt die frühere Drescher-Zuweisung.

const WID = 'waage';
let _container = null;
let _lockAbfahrer = null;   // feste Abfahrer-ID (Selbsterfassung) oder null = Auswahl
let _modus = 'abschluss';

// GPS-Position beim Einwiegen: für die Zuordnung der Fuhre zum Lagerstandort.
// Darf das Wiegen NIE blockieren – bei fehlendem Empfang/Verweigerung läuft
// alles normal weiter (lat/lon bleiben leer).
let _gpsPos = null; // { lat, lon, ts }
function erfasseGPS(timeoutMs = 6000) {
  return new Promise(resolve => {
    if(!navigator.geolocation) return resolve(_gpsPos);
    let done = false;
    const finish = (p) => { if(!done) { done = true; resolve(p); } };
    const t = setTimeout(() => finish(_gpsPos), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      pos => { clearTimeout(t); _gpsPos = { lat: pos.coords.latitude, lon: pos.coords.longitude, ts: Date.now() }; finish(_gpsPos); },
      ()  => { clearTimeout(t); finish(_gpsPos); },
      { enableHighAccuracy: false, maximumAge: 120000, timeout: timeoutMs }
    );
  });
}

function fruchtartFuerSorte(feldId, sorte) {
  const feld = getFeld(feldId);
  // Umlagerung/Zukauf: Fruchtart liegt nicht fest, sondern wird je Fuhre gewählt
  if((feld.typ || 'schlag') !== 'schlag') {
    return document.getElementById('we-fruchtart-select')?.value || '';
  }
  if(sorte) {
    const v = state.vermehrungen.find(x => x.feld_id === feldId && x.sorte === sorte);
    if(v && v.fruchtart) return v.fruchtart;
  }
  return feld.fruchtart || '';
}

function aktuelleFruchtart() {
  const feldId = parseInt(document.getElementById('we-feld')?.value);
  if(!feldId) return '';
  return fruchtartFuerSorte(feldId, document.getElementById('we-sorte')?.value || '');
}

function renderQualGrid() {
  const grid = document.getElementById('we-qual-grid');
  if(!grid) return;
  const qf = getQualitaetsfelder(aktuelleFruchtart());
  grid.innerHTML = Object.entries(qf).map(([key,q]) =>
    `<div class="form-group"><label>${q.label}</label><input type="number" id="qual-${key}-${WID}" placeholder="${q.ph}" step="${q.step}"></div>`
  ).join('');
}

function formHTML() {
  const aktiv = state.felder.filter(f => f.status === 'aktiv' && (f.typ||'schlag') === 'schlag').sort((a,b)=>a.name.localeCompare(b.name,'de'));
  // Spezialquellen: Umlagerung zwischen Lagern + aktivierte Zukauf-Lieferanten
  const spezial = state.felder.filter(f => f.status === 'aktiv' && (f.typ||'schlag') !== 'schlag')
    .sort((a,b) => a.typ === b.typ ? a.name.localeCompare(b.name,'de') : (a.typ === 'umlagerung' ? -1 : 1));
  const spezialOptions = spezial.map(f =>
    `<option value="${f.id}">${f.typ==='umlagerung' ? '🔄 Umlagerung zwischen Lagern' : '🚚 Zukauf: ' + escapeHtml(f.name)}</option>`).join('');
  const feldOptions = spezialOptions + aktiv.map(f => `<option value="${f.id}">${escapeHtml(f.name)} · ${escapeHtml(f.fruchtart)} (${f.flaeche} ha)</option>`).join('');
  const gesamt = aktiv.length + spezial.length;
  const warn = gesamt ? '' : `<div class="alert alert-warn">&#9888; Keine aktiven Schläge – bitte zuerst Schläge aktivieren.</div>`;

  let abfahrerBlock;
  if(_lockAbfahrer != null) {
    const name = state.users.find(u=>u.id===_lockAbfahrer)?.name || '';
    abfahrerBlock = `<div class="form-group"><label>Abfahrer</label><div class="fruchtart-fixed">${escapeHtml(name)}</div></div>`;
  } else {
    const abfOptions = state.users.filter(u=>u.role==='abfahrer').map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    abfahrerBlock = `<div class="form-group"><label>Abfahrer</label><select id="we-abf"><option value="">— Abfahrer wählen —</option>${abfOptions}</select></div>`;
  }

  const kopf = _modus==='offen'
    ? `<div class="card-title">🚛 Fuhre erfassen</div><div class="card-sub">Schlag &amp; Sorte wählen – danach im Tab „Offen" wiegen</div>`
    : `<div class="card-title">⚖ Fuhre an der Waage erfassen</div><div class="card-sub">Schlag, Sorte, Abfahrer + Gewichte/Qualität – direkt abschließen</div>`;

  const oben = `${warn}
    <div class="card-header"><div>${kopf}</div></div>
    <div class="form-group">
      <label>Schlag (${aktiv.length} aktiv)</label>
      <select id="we-feld" onchange="weFeldWahl()" ${!gesamt?'disabled':''}>
        <option value="">— Schlag wählen —</option>${feldOptions}
      </select>
    </div>
    <div class="form-group">
      <label>Fruchtart</label>
      <div class="fruchtart-fixed" id="we-fruchtart-display">— wird automatisch gesetzt —</div>
    </div>
    <div id="we-sorte-group" style="display:none" class="form-group">
      <label>Partie / Sorte</label>
      <select id="we-sorte" onchange="weSorteWahl()"><option value="">Konsum</option></select>
    </div>
    ${abfahrerBlock}`;

  if(_modus === 'offen') {
    return `${oben}
      <button class="btn btn-primary btn-full" id="we-btn" onclick="weStarten()" ${!gesamt?'disabled style="opacity:.5;cursor:not-allowed"':''}>&#9654; Fuhre starten</button>`;
  }

  const waageWidget = window.waageFuhreWidgetHTML ? window.waageFuhreWidgetHTML(WID) : '';
  return `${oben}
    <div class="section-label">Gewichte</div>
    ${waageWidget}
    <div class="gewicht-grid">
      <div class="form-group">
        <label>Vollgewicht (kg)</label>
        <input type="text" inputmode="numeric" id="voll-${WID}" placeholder="28.400" style="font-size:20px;font-weight:700;letter-spacing:0.5px" oninput="fmtGewicht(this);updNetto('${WID}')">
      </div>
      <div class="form-group">
        <label>Leergewicht (kg)</label>
        <div style="display:flex;gap:6px">
          <input type="text" inputmode="numeric" id="leer-${WID}" placeholder="12.600" style="font-size:20px;font-weight:700;letter-spacing:0.5px;flex:1;min-width:0" oninput="fmtGewicht(this);updNetto('${WID}')">
          <button type="button" onclick="openHaengerzugWahl()" title="Hängerzug wählen – Leergewicht übernehmen"
            style="flex-shrink:0;width:52px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:22px;cursor:pointer">🚛</button>
        </div>
      </div>
    </div>
    <div class="netto-display"><div class="netto-label">Netto</div><div class="netto-val" id="netto-${WID}" style="font-size:28px">—</div><div class="netto-unit">kg</div></div>
    <div class="section-label">Qualität <span style="font-size:10px;color:var(--text2);font-weight:400">– optional, fehlende werden abgefragt</span></div>
    <div class="gewicht-grid" id="we-qual-grid"></div>
    <button class="btn btn-green btn-full" id="we-btn" onclick="weAbschliessen()" ${!gesamt?'disabled style="opacity:.5;cursor:not-allowed"':''}>&#10003; Fuhre abschließen</button>`;
}

export function renderWaageErfassungInto(el, opts = {}) {
  if(!el) return;
  _container = el;
  _lockAbfahrer = (opts.abfahrerId != null) ? opts.abfahrerId : null;
  _modus = opts.modus || 'abschluss';
  el.innerHTML = `<div class="card" style="max-width:560px;margin:0 auto">${formHTML()}</div>`;
  erfasseGPS(8000); // GPS schon beim Öffnen anwärmen (Ergebnis wird gecacht)
}

function reRenderOrClose() {
  if(document.getElementById('we-overlay')) { closeWaageErfassung(); return; }
  if(_modus === 'offen' && state.currentUser?.role === 'abfahrer' && window.setATab) { window.setATab('offen'); return; }
  if(_container) renderWaageErfassungInto(_container, { abfahrerId: _lockAbfahrer, modus: _modus });
}

export function weFeldWahl() {
  const feldEl = document.getElementById('we-feld');
  const el = document.getElementById('we-fruchtart-display');
  const sorteGroup = document.getElementById('we-sorte-group');
  const sorteSelect = document.getElementById('we-sorte');
  if(!feldEl || !el) return;
  const feldId = parseInt(feldEl.value);
  if(!feldId) {
    el.textContent = '— wird automatisch gesetzt —'; el.style.color = 'var(--text3)';
    if(sorteGroup) sorteGroup.style.display = 'none';
    renderQualGrid();
    return;
  }
  const feld = getFeld(feldId);
  // Umlagerung/Zukauf: Fruchtart je Fuhre wählbar (kein fester Anbau).
  // Bei konfigurierten Zukauf-Lieferanten nur deren hinterlegte Fruchtarten.
  if((feld.typ || 'schlag') !== 'schlag') {
    const arten = (feld.zukaufFruchtarten && feld.zukaufFruchtarten.length)
      ? feld.zukaufFruchtarten
      : [...new Set(state.felder.filter(x => (x.typ||'schlag')==='schlag' && x.fruchtart).map(x => x.fruchtart))]
          .sort((a,b) => a.localeCompare(b,'de'));
    el.innerHTML = `<select id="we-fruchtart-select" onchange="weFruchtartWahl()" style="width:100%;border:none;background:none;font:inherit;color:inherit;padding:0">
      <option value="">— Fruchtart wählen —</option>${arten.map(a=>`<option>${escapeHtml(a)}</option>`).join('')}
    </select>`;
    el.style.color = 'var(--gold2)';
    if(sorteGroup) { sorteGroup.style.display = 'none'; if(sorteSelect) sorteSelect.value = ''; }
    // Standard-Abfahrer voreinstellen (falls konfiguriert und Abfahrer wählbar)
    if(feld.zukaufAbfahrerId) { const abf = document.getElementById('we-abf'); if(abf) abf.value = String(feld.zukaufAbfahrerId); }
    renderQualGrid();
    return;
  }
  const bio = isBioFeld(feldId);
  el.innerHTML = (bio ? '<span style="color:var(--color-success);font-weight:700">🌿 BIO</span> · ' : '') + (feld.fruchtart || '–');
  el.style.color = bio ? 'var(--color-success)' : 'var(--gold2)';
  const verms = state.vermehrungen.filter(v => v.feld_id === feldId);
  if(verms.length && sorteGroup && sorteSelect) {
    sorteGroup.style.display = 'block';
    sorteSelect.innerHTML = '<option value="">Konsum (' + escapeHtml(feld.fruchtart) + ')</option>'
      + verms.map(v => `<option value="${escapeHtml(v.sorte)}">🌱 ${escapeHtml(v.sorte)} · ${escapeHtml(v.fruchtart||feld.fruchtart)} (${escapeHtml(v.flaeche)} ha)</option>`).join('');
    sorteSelect.value = '';
  } else if(sorteGroup) {
    sorteGroup.style.display = 'none';
    if(sorteSelect) sorteSelect.value = '';
  }
  renderQualGrid();
}

// Fruchtart-Wahl bei Umlagerung/Zukauf: Qualitätsfelder an die Kultur anpassen
export function weFruchtartWahl() {
  renderQualGrid();
}

export function weSorteWahl() {
  const feldId = parseInt(document.getElementById('we-feld')?.value);
  const el = document.getElementById('we-fruchtart-display');
  if(!feldId || !el) return;
  const sorte = document.getElementById('we-sorte')?.value || '';
  const bio = isBioFeld(feldId);
  el.innerHTML = (bio ? '<span style="color:var(--color-success);font-weight:700">🌿 BIO</span> · ' : '') + (fruchtartFuerSorte(feldId, sorte) || '–');
  el.style.color = bio ? 'var(--color-success)' : 'var(--gold2)';
  renderQualGrid();
}

function leseAbfahrerId() {
  return _lockAbfahrer != null ? _lockAbfahrer : parseInt(document.getElementById('we-abf')?.value);
}
function erfasserDrescherId() {
  // Selbsterfassung durch Abfahrer hat keinen Drescher
  return state.currentUser?.role === 'abfahrer' ? null : (state.currentUser?.id ?? null);
}

// Abfahrer-Selbsterfassung: offene Fuhre starten (wird danach im Tab "Offen" gewogen)
export async function weStarten() {
  const feldId = parseInt(document.getElementById('we-feld')?.value);
  if(!feldId) { alert('Bitte Schlag wählen.'); return; }
  const abfahrerId = leseAbfahrerId();
  if(!abfahrerId) { alert('Bitte Abfahrer wählen.'); return; }
  const sorteEl = document.getElementById('we-sorte');
  const sorte = sorteEl ? (sorteEl.value || null) : null;
  const fruchtart = fruchtartFuerSorte(feldId, sorte);
  if((getFeld(feldId).typ || 'schlag') !== 'schlag' && !fruchtart) { alert('Bitte Fruchtart wählen.'); return; }
  // Fuhren-Nummer wird serverseitig vergeben (nutzerunabhängig eindeutig).
  const newFuhre = { status:'offen', drescherId: erfasserDrescherId(), abfahrerId, feldId, fruchtart: fruchtart||'', sorte,
    lat: _gpsPos?.lat ?? null, lon: _gpsPos?.lon ?? null, zeit: new Date().toISOString() };
  const btn = document.getElementById('we-btn');
  if(btn) { btn.disabled = true; btn.textContent = 'Wird gestartet…'; }
  try {
    const res = await db.insertFuhre(newFuhre);
    newFuhre.id = res.id; newFuhre.nr = res.nr; state.fuhren.push(newFuhre);
    showToast(`✓ Fuhre ${res.nr} gestartet`);
    reRenderOrClose();
  } catch(e) {
    if(btn) { btn.disabled = false; btn.innerHTML = '&#9654; Fuhre starten'; }
    showToast('⚠ Fehler: ' + e.message, 'error');
  }
}

// Waage-Tablet / Abfahrer: prüft Eingaben und zeigt ein Bestätigungs-Popup mit
// allen Werten ("Speichern" / "Bearbeiten") – erst danach wird gespeichert.
let _gpsFuerFuhre = null; // in weAbschliessen erfasst, in weAbschliessenSpeichern gespeichert
export async function weAbschliessen() {
  const feldId = parseInt(document.getElementById('we-feld')?.value);
  const abfahrerId = leseAbfahrerId();
  if(!feldId || !abfahrerId) { alert('Bitte Schlag und Abfahrer wählen.'); return; }
  const v = parseGewicht(document.getElementById('voll-'+WID)?.value);
  const l = parseGewicht(document.getElementById('leer-'+WID)?.value);
  if(!v || !l || v <= l) { alert('Bitte gültige Gewichte eingeben (Vollgew. > Leergew.).'); return; }
  const sorte = document.getElementById('we-sorte')?.value || null;
  const fruchtart = fruchtartFuerSorte(feldId, sorte);
  const feld = getFeld(feldId);
  if((feld.typ || 'schlag') !== 'schlag' && !fruchtart) { alert('Bitte Fruchtart wählen.'); return; }
  const qf = getQualitaetsfelder(fruchtart);
  const qRows = Object.entries(qf).map(([key,o]) => {
    const el = document.getElementById('qual-'+key+'-'+WID);
    const raw = el ? el.value : '';
    return { label:o.label, val: (raw!=='' && raw!=null) ? raw : null };
  });
  const abfName = state.users.find(u=>u.id===abfahrerId)?.name || '';
  // GPS-Position bestimmen (kurzer Timeout; blockiert nie – ohne Empfang gibt es einfach keinen Standort)
  _gpsFuerFuhre = await erfasseGPS(4000);
  zeigeBestaetigung({ feld, fruchtart, sorte, abfName, v, l, qRows, gps: _gpsFuerFuhre });
}

// Tatsächliches Speichern (nach Bestätigung im Popup).
async function weAbschliessenSpeichern() {
  const sbtn = document.getElementById('we-conf-save');
  if(sbtn) { sbtn.disabled = true; sbtn.textContent = 'Speichert…'; }
  const feldId = parseInt(document.getElementById('we-feld')?.value);
  const abfahrerId = leseAbfahrerId();
  const v = parseGewicht(document.getElementById('voll-'+WID)?.value);
  const l = parseGewicht(document.getElementById('leer-'+WID)?.value);
  if(!feldId || !abfahrerId || !v || !l || v <= l) { closeBestaetigung(); showToast('⚠ Eingaben unvollständig', 'error'); return; }
  const sorte = document.getElementById('we-sorte')?.value || null;
  const fruchtart = fruchtartFuerSorte(feldId, sorte);
  const qf = getQualitaetsfelder(fruchtart);
  const q = {};
  for(const key of Object.keys(qf)) { const el = document.getElementById('qual-'+key+'-'+WID); q[key] = el ? (parseFloat(el.value)||null) : null; }
  // Fuhren-Nummer wird serverseitig vergeben (nutzerunabhängig eindeutig).
  const newFuhre = {
    status:'fertig', drescherId: erfasserDrescherId(), abfahrerId, feldId, fruchtart: fruchtart||'', sorte,
    vollgewicht: v, leergewicht: l,
    feuchte: q.feuchte||null, protein: q.protein||null, gluten: q.gluten||null, hlGewicht: q.hl||null, oelgehalt: q.oelgehalt||null,
    lat: _gpsFuerFuhre?.lat ?? null, lon: _gpsFuerFuhre?.lon ?? null,
    zeit: new Date().toISOString()
  };
  try {
    const res = await db.insertFuhreKomplett(newFuhre);
    newFuhre.id = res.id; newFuhre.nr = res.nr; state.fuhren.push(newFuhre);
    const abfName = state.users.find(u => u.id === abfahrerId)?.name || '';
    showToast(`✓ Fuhre ${res.nr} abgeschlossen · ${kg2t(v-l)} · ${abfName}`);
    closeBestaetigung();
    reRenderOrClose();
  } catch(e) {
    if(sbtn) { sbtn.disabled = false; sbtn.innerHTML = '&#10003; Speichern'; }
    showToast('⚠ Fehler: ' + e.message, 'error');
  }
}

function zeigeBestaetigung(d) {
  let ov = document.getElementById('we-confirm-overlay');
  if(!ov) { ov = document.createElement('div'); ov.id = 'we-confirm-overlay'; document.body.appendChild(ov); }
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:7000;display:flex;align-items:center;justify-content:center;padding:18px';
  const n = d.v - d.l;
  const td = 'padding:6px 4px;border-bottom:1px solid var(--color-border)';
  const tdL = td + ';color:var(--text2);width:42%';
  const row = (k,val) => `<tr><td style="${tdL}">${escapeHtml(k)}</td><td style="${td};font-weight:600">${val}</td></tr>`;
  const artZeile = d.feld.typ === 'umlagerung'
    ? row('Art', '🔄 Umlagerung zwischen Lagern')
    : d.feld.typ === 'lieferant'
    ? row('Art', '🚚 Zukauf · ' + escapeHtml(d.feld.name))
    : d.sorte
    ? row('Art', '🌱 Vermehrung · ' + escapeHtml(d.sorte))
    : row('Art', 'Konsum');
  const qHtml = d.qRows.map(q => row(q.label, q.val!=null ? escapeHtml(String(q.val)) : '<span style="color:var(--amber)">— fehlt</span>')).join('');
  const standort = d.gps && window.standortText
    ? '📍 ' + escapeHtml(window.standortText(d.gps.lat, d.gps.lon) || 'erfasst')
    : '<span style="color:var(--text3)">— kein GPS</span>';
  ov.innerHTML = `<div class="card" style="max-width:440px;width:100%;max-height:90vh;overflow:auto">
    <div class="card-header"><div>
      <div class="card-title">Fuhre prüfen &amp; speichern</div>
      <div class="card-sub">Bitte die Werte kontrollieren</div>
    </div></div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:4px 0 8px">
      ${row((d.feld.typ||'schlag')!=='schlag' ? 'Herkunft' : 'Schlag', escapeHtml(d.feld.name||'–'))}
      ${row('Fruchtart', escapeHtml(d.fruchtart||'–'))}
      ${artZeile}
      ${row('Abfahrer', escapeHtml(d.abfName||'–'))}
      ${row('Vollgewicht', d.v.toLocaleString('de-DE') + ' kg')}
      ${row('Leergewicht', d.l.toLocaleString('de-DE') + ' kg')}
      ${row('Netto', '<b>' + n.toLocaleString('de-DE') + ' kg</b> · ' + kg2t(n))}
      ${qHtml}
      ${row('Standort', standort)}
    </table>
    <div style="display:flex;gap:8px;margin-top:6px">
      <button class="btn btn-outline btn-full" id="we-conf-edit">&#9998; Bearbeiten</button>
      <button class="btn btn-green btn-full" id="we-conf-save">&#10003; Speichern</button>
    </div>
  </div>`;
  document.getElementById('we-conf-edit').addEventListener('click', closeBestaetigung);
  document.getElementById('we-conf-save').addEventListener('click', () => weAbschliessenSpeichern());
}

function closeBestaetigung() {
  const ov = document.getElementById('we-confirm-overlay');
  if(ov) ov.remove();
}

// Modal-Variante (für Silomeister): immer Abschluss-Modus mit Abfahrer-Auswahl
export function openWaageErfassung() {
  let ov = document.getElementById('we-overlay');
  if(!ov) { ov = document.createElement('div'); ov.id = 'we-overlay'; document.body.appendChild(ov); }
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:6000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 16px';
  ov.innerHTML = `<div style="position:relative;max-width:600px;width:100%;margin:auto">
      <button onclick="closeWaageErfassung()" aria-label="Schließen"
        style="position:absolute;top:-10px;right:-4px;z-index:1;background:var(--gold);color:#fff;border:none;width:34px;height:34px;border-radius:50%;font-size:18px;cursor:pointer;box-shadow:var(--shadow-lg)">✕</button>
      <div id="we-content"></div>
    </div>`;
  renderWaageErfassungInto(document.getElementById('we-content'), { modus: 'abschluss' });
}

export function closeWaageErfassung() {
  closeBestaetigung();
  closeHaengerzugWahl();
  const ov = document.getElementById('we-overlay');
  if(ov) ov.remove();
}

// ── Hängerzug-Auswahl: festes Leergewicht per Antippen übernehmen ────────────
// Admin & Silomeister können Hängerzüge direkt in der Auswahl anlegen/ändern/löschen.
function renderHaengerzugWahl(editId = null) {
  let ov = document.getElementById('we-hz-overlay');
  if(!ov) { ov = document.createElement('div'); ov.id = 'we-hz-overlay'; document.body.appendChild(ov); }
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:7500;display:flex;align-items:center;justify-content:center;padding:16px';
  const darfVerwalten = ['admin','silomeister'].includes(state.currentUser?.role);
  const hz = state.haengerzuege || [];
  const edit = editId != null ? hz.find(h => h.id === editId) : null;
  const btnStyle = 'flex-shrink:0;width:40px;background:none;border:1px solid var(--color-border);border-radius:var(--radius-sm);cursor:pointer;font-size:15px;color:var(--color-text-muted)';
  const rows = hz.length ? hz.map(h => `
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <button onclick="waehleHaengerzug(${h.id})"
        style="flex:1;min-width:0;display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:14px;cursor:pointer">
        <span style="font-size:16px;font-weight:700;color:var(--color-text);text-align:left">🚛 ${escapeHtml(h.name)}</span>
        <span style="font-size:16px;font-weight:800;color:var(--gold);white-space:nowrap">${h.leergewicht_kg.toLocaleString('de-DE')} kg</span>
      </button>
      ${darfVerwalten ? `
        <button onclick="hzEditStart(${h.id})" title="Bearbeiten" style="${btnStyle}">✎</button>
        <button onclick="hzLoeschen(${h.id})" title="Löschen" style="${btnStyle};color:var(--red)">🗑</button>` : ''}
    </div>`).join('')
    : '<div style="text-align:center;color:var(--color-text-muted);padding:24px 8px;font-size:14px">Noch keine Hängerzüge angelegt.</div>';
  const form = darfVerwalten ? `
    <div style="border-top:1px solid var(--color-border);margin-top:10px;padding-top:12px">
      <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:var(--color-text)">${edit ? '✎ Hängerzug bearbeiten' : '+ Neuer Hängerzug'}</div>
      <div style="display:flex;gap:8px">
        <input id="hz-name" class="input" placeholder="Name (z.B. Fendt + Krampe)" value="${edit ? escapeHtml(edit.name) : ''}" style="flex:2;min-width:0">
        <input id="hz-kg" class="input" type="number" inputmode="numeric" placeholder="Leergew. kg" value="${edit ? edit.leergewicht_kg : ''}" style="flex:1;min-width:0">
        <button class="btn btn-primary" style="flex-shrink:0" onclick="hzSpeichern(${edit ? edit.id : 'null'})">💾</button>
      </div>
    </div>` : '';
  ov.innerHTML = `<div class="card" style="max-width:460px;width:100%;max-height:85vh;overflow:auto">
    <div class="card-header"><div>
      <div class="card-title">🚛 Hängerzug wählen</div>
      <div class="card-sub">Antippen übernimmt das Leergewicht</div>
    </div>
    <button onclick="closeHaengerzugWahl()" aria-label="Schließen" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--color-text-muted)">✕</button></div>
    ${rows}
    ${form}
  </div>`;
}

export function openHaengerzugWahl() { renderHaengerzugWahl(); }
export function closeHaengerzugWahl() { document.getElementById('we-hz-overlay')?.remove(); }

export function waehleHaengerzug(id) {
  const h = (state.haengerzuege || []).find(x => x.id === id);
  const inp = document.getElementById('leer-' + WID);
  if(h && inp) {
    inp.value = h.leergewicht_kg.toLocaleString('de-DE');
    if(window.updNetto) window.updNetto(WID);
    showToast(`🚛 ${h.name} · ${h.leergewicht_kg.toLocaleString('de-DE')} kg übernommen`);
  }
  closeHaengerzugWahl();
}

export function hzEditStart(id) { renderHaengerzugWahl(id); }

export async function hzSpeichern(editId) {
  const name = document.getElementById('hz-name')?.value.trim();
  const kg = parseInt(document.getElementById('hz-kg')?.value);
  if(!name || !kg || kg <= 0) { showToast('Bitte Name und Leergewicht (kg) angeben', 'error'); return; }
  try {
    if(editId) await db.updateHaengerzug(editId, { name, leergewicht_kg: kg });
    else await db.insertHaengerzug(name, kg);
    state.haengerzuege = await db.getHaengerzuege();
    showToast('✓ Hängerzug gespeichert');
    renderHaengerzugWahl();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}

export async function hzLoeschen(id) {
  const h = (state.haengerzuege || []).find(x => x.id === id);
  if(!h) return;
  if(!confirm(`Hängerzug "${h.name}" (${h.leergewicht_kg.toLocaleString('de-DE')} kg) löschen?`)) return;
  try {
    await db.deleteHaengerzug(id);
    state.haengerzuege = await db.getHaengerzuege();
    showToast('🗑 Hängerzug gelöscht');
    renderHaengerzugWahl();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}
