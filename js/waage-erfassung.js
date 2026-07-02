import { state } from './state.js?v=26';
import { db } from './db.js?v=26';
import { getFeld, showToast, escapeHtml, kg2t } from './helpers.js?v=26';
import { isBioFeld } from './bio.js?v=26';
import { getQualitaetsfelder } from './quality.js?v=26';
import { parseGewicht } from './abfahrer.js?v=26';

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

function fruchtartFuerSorte(feldId, sorte) {
  const feld = getFeld(feldId);
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
  const aktiv = state.felder.filter(f => f.status === 'aktiv').sort((a,b)=>a.name.localeCompare(b.name,'de'));
  const feldOptions = aktiv.map(f => `<option value="${f.id}">${escapeHtml(f.name)} · ${escapeHtml(f.fruchtart)} (${f.flaeche} ha)</option>`).join('');
  const warn = aktiv.length ? '' : `<div class="alert alert-warn">&#9888; Keine aktiven Schläge – bitte zuerst Schläge aktivieren.</div>`;

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
      <select id="we-feld" onchange="weFeldWahl()" ${!aktiv.length?'disabled':''}>
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
      <button class="btn btn-primary btn-full" id="we-btn" onclick="weStarten()" ${!aktiv.length?'disabled style="opacity:.5;cursor:not-allowed"':''}>&#9654; Fuhre starten</button>`;
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
        <input type="text" inputmode="numeric" id="leer-${WID}" placeholder="12.600" style="font-size:20px;font-weight:700;letter-spacing:0.5px" oninput="fmtGewicht(this);updNetto('${WID}')">
      </div>
    </div>
    <div class="netto-display"><div class="netto-label">Netto</div><div class="netto-val" id="netto-${WID}" style="font-size:28px">—</div><div class="netto-unit">kg</div></div>
    <div class="section-label">Qualität <span style="font-size:10px;color:var(--text2);font-weight:400">– optional, fehlende werden abgefragt</span></div>
    <div class="gewicht-grid" id="we-qual-grid"></div>
    <button class="btn btn-green btn-full" id="we-btn" onclick="weAbschliessen()" ${!aktiv.length?'disabled style="opacity:.5;cursor:not-allowed"':''}>&#10003; Fuhre abschließen</button>`;
}

export function renderWaageErfassungInto(el, opts = {}) {
  if(!el) return;
  _container = el;
  _lockAbfahrer = (opts.abfahrerId != null) ? opts.abfahrerId : null;
  _modus = opts.modus || 'abschluss';
  el.innerHTML = `<div class="card" style="max-width:560px;margin:0 auto">${formHTML()}</div>`;
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
  // Fuhren-Nummer wird serverseitig vergeben (nutzerunabhängig eindeutig).
  const newFuhre = { status:'offen', drescherId: erfasserDrescherId(), abfahrerId, feldId, fruchtart: fruchtart||'', sorte, zeit: new Date().toISOString() };
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
export function weAbschliessen() {
  const feldId = parseInt(document.getElementById('we-feld')?.value);
  const abfahrerId = leseAbfahrerId();
  if(!feldId || !abfahrerId) { alert('Bitte Schlag und Abfahrer wählen.'); return; }
  const v = parseGewicht(document.getElementById('voll-'+WID)?.value);
  const l = parseGewicht(document.getElementById('leer-'+WID)?.value);
  if(!v || !l || v <= l) { alert('Bitte gültige Gewichte eingeben (Vollgew. > Leergew.).'); return; }
  const sorte = document.getElementById('we-sorte')?.value || null;
  const fruchtart = fruchtartFuerSorte(feldId, sorte);
  const feld = getFeld(feldId);
  const qf = getQualitaetsfelder(fruchtart);
  const qRows = Object.entries(qf).map(([key,o]) => {
    const el = document.getElementById('qual-'+key+'-'+WID);
    const raw = el ? el.value : '';
    return { label:o.label, val: (raw!=='' && raw!=null) ? raw : null };
  });
  const abfName = state.users.find(u=>u.id===abfahrerId)?.name || '';
  zeigeBestaetigung({ feld, fruchtart, sorte, abfName, v, l, qRows });
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
  const artZeile = d.sorte
    ? row('Art', '🌱 Vermehrung · ' + escapeHtml(d.sorte))
    : row('Art', 'Konsum');
  const qHtml = d.qRows.map(q => row(q.label, q.val!=null ? escapeHtml(String(q.val)) : '<span style="color:var(--amber)">— fehlt</span>')).join('');
  ov.innerHTML = `<div class="card" style="max-width:440px;width:100%;max-height:90vh;overflow:auto">
    <div class="card-header"><div>
      <div class="card-title">Fuhre prüfen &amp; speichern</div>
      <div class="card-sub">Bitte die Werte kontrollieren</div>
    </div></div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:4px 0 8px">
      ${row('Schlag', escapeHtml(d.feld.name||'–'))}
      ${row('Fruchtart', escapeHtml(d.fruchtart||'–'))}
      ${artZeile}
      ${row('Abfahrer', escapeHtml(d.abfName||'–'))}
      ${row('Vollgewicht', d.v.toLocaleString('de-DE') + ' kg')}
      ${row('Leergewicht', d.l.toLocaleString('de-DE') + ' kg')}
      ${row('Netto', '<b>' + n.toLocaleString('de-DE') + ' kg</b> · ' + kg2t(n))}
      ${qHtml}
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
  const ov = document.getElementById('we-overlay');
  if(ov) ov.remove();
}
