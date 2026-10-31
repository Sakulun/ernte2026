import { state } from './state.js?v=157';
import { db } from './db.js?v=157';
import { getFeld, showToast, escapeHtml, kg2t, kontaktAnschrift } from './helpers.js?v=157';
import { isBioFeld } from './bio.js?v=157';
import { getQualitaetsfelder } from './quality.js?v=157';
import { parseGewicht } from './abfahrer.js?v=157';
import { lieferscheinDrucken, lieferscheinArtikelName, bioPraefix, oekoZeile } from './lieferschein-druck.js?v=157';

// ── Modul "Ware annehmen / Fuhre erfassen" ───────────────────────────────────
// Zwei Modi:
//  • modus 'abschluss' (Admin/Silomeister, Waage-Tablet): Herkunft wählen
//    (Ernte / Zukauf extern / Umlagerung), Details + Gewichte → direkt abschließen.
//    Zukauf extern verzweigt in Getreide/Ölsaaten (→ Fuhre, Lieferant + Einkaufs-
//    kontrakt) und Dünger/Kalk (→ Fremdzukauf-Liste, Düngerart + Freitext-Lieferant).
//  • modus 'offen' (Abfahrer-Selbsterfassung, mobil): nur Schlag/Sorte wählen.

const WID = 'waage';
let _container = null;
let _lockAbfahrer = null;   // feste Abfahrer-ID (Selbsterfassung) oder null = Auswahl
let _modus = 'abschluss';
let _herkunft = 'ernte';    // 'ernte' | 'zukauf' | 'umlagerung' (nur Abschluss-Modus)
let _zukaufTyp = 'getreide'; // 'getreide' | 'duenger'

// Läuft gerade eine (angefangene) Erfassung in dieser Maske? Wird von den
// Realtime-/Polling-Updates geprüft, damit ein Hintergrund-Neurender die
// halbfertige Eingabe nicht wegwirft (auch ohne Feld-Fokus).
export function erfassungInProgress() {
  const val = id => { const e = document.getElementById(id); return e && String(e.value || '').trim(); };
  if(val('we-feld')) return true;                 // Schlag/Quelle/Lieferant gewählt
  if(val('we-duengerart') || val('we-dg-lieferant')) return true; // Dünger-Zukauf begonnen
  if(val('voll-' + WID) || val('leer-' + WID)) return true;  // Gewicht eingegeben
  if(val('we-kennzeichen') || val('we-ekontrakt') || val('we-kontrakt')) return true;
  return [...document.querySelectorAll('[id^="qual-"][id$="-' + WID + '"]')].some(i => String(i.value || '').trim());
}

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
  grid.innerHTML = qualGridHTML(aktuelleFruchtart());
}
// Qualitätsfelder als Markup (optional vorbelegt) – Erfassung und Zweitwiegung nutzen dasselbe.
function qualGridHTML(fruchtart, werte = {}) {
  const qf = getQualitaetsfelder(fruchtart);
  return Object.entries(qf).map(([key,q]) =>
    `<div class="form-group"><label>${q.label}</label><input type="number" id="qual-${key}-${WID}" placeholder="${q.ph}" step="${q.step}" value="${werte[key] ?? ''}"></div>`
  ).join('');
}
// Qualitätswerte aus dem Grid lesen; fehlt ein Feld im DOM, gilt der Fallback (z.B. Umlauf-Payload).
function leseQualitaeten(fruchtart, fallback = {}) {
  const q = {};
  for(const key of Object.keys(getQualitaetsfelder(fruchtart))) {
    const el = document.getElementById('qual-'+key+'-'+WID);
    q[key] = el ? (parseFloat(el.value) || null) : (fallback[key] ?? null);
  }
  return q;
}

// Abfahrer-Auswahl bzw. fester Abfahrer (Selbsterfassung)
function abfahrerBlockHTML() {
  if(_lockAbfahrer != null) {
    const name = state.users.find(u=>u.id===_lockAbfahrer)?.name || '';
    return `<div class="form-group"><label>Abfahrer</label><div class="fruchtart-fixed">${escapeHtml(name)}</div></div>`;
  }
  // Zukauf extern: der Fahrer ist ein Fremder (Spedition/Lieferant) – kein Abfahrer
  // nötig. Ein beim Lieferanten hinterlegter Standard-Abfahrer wird still übernommen.
  if(_modus === 'abschluss' && _herkunft === 'zukauf') return '';
  const abfOptions = state.users.filter(u=>u.role==='abfahrer').map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  return `<div class="form-group"><label>Abfahrer</label><select id="we-abf"><option value="">— Abfahrer wählen —</option>${abfOptions}</select></div>`;
}

// Gewichts-Block (Voll/Leer + Waage-Widget + Netto)
function gewichteHTML() {
  const waageWidget = window.waageFuhreWidgetHTML ? window.waageFuhreWidgetHTML(WID) : '';
  return `<div class="section-label">Gewichte</div>
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
    <div class="netto-display"><div class="netto-label">Netto</div><div class="netto-val" id="netto-${WID}" style="font-size:28px">—</div><div class="netto-unit">kg</div></div>`;
}

// Segmentierte Umschalter
function segBtn(onclickFn, active, icon, label, small) {
  const pad = small ? '10px 6px' : '12px 6px';
  const fs = small ? '12px' : '13px';
  return `<button type="button" onclick="${onclickFn}" style="flex:1;min-width:0;padding:${pad};border-radius:var(--radius-md);border:2px solid ${active?'var(--gold)':'var(--color-border)'};background:${active?'var(--gold)':'var(--color-surface)'};color:${active?'#1a1400':'var(--color-text)'};font-family:inherit;font-weight:700;font-size:${fs};cursor:pointer;line-height:1.3">${icon} ${label}</button>`;
}
function zukaufTypSel() {
  return `<div style="display:flex;gap:8px;margin-bottom:14px">
    ${segBtn("weSetZukaufTyp('getreide')", _zukaufTyp==='getreide', '🌾', 'Getreide/Ölsaaten', true)}
    ${segBtn("weSetZukaufTyp('duenger')", _zukaufTyp==='duenger', '🧪', 'Dünger/Kalk', true)}
  </div>`;
}

function formHTML() {
  const aktiv = state.felder.filter(f => f.status === 'aktiv' && (f.typ||'schlag') === 'schlag').sort((a,b)=>a.name.localeCompare(b.name,'de'));

  // ── Offen-Modus (Abfahrer-Selbsterfassung): unverändert Schlag/Sorte ──
  if(_modus === 'offen') {
    const spezial = state.felder.filter(f => f.status === 'aktiv' && (f.typ||'schlag') !== 'schlag')
      .sort((a,b) => a.typ === b.typ ? a.name.localeCompare(b.name,'de') : (a.typ === 'umlagerung' ? -1 : 1));
    const spezialOptions = spezial.map(f =>
      `<option value="${f.id}">${f.typ==='umlagerung' ? '🔄 Umlagerung zwischen Lagern' : '🚚 Zukauf: ' + escapeHtml(f.name)}</option>`).join('');
    const feldOptions = spezialOptions + aktiv.map(f => `<option value="${f.id}">${escapeHtml(f.name)} · ${escapeHtml(f.fruchtart)} (${f.flaeche} ha)</option>`).join('');
    const gesamt = aktiv.length + spezial.length;
    const warn = gesamt ? '' : `<div class="alert alert-warn">&#9888; Keine aktiven Schläge – bitte zuerst Schläge aktivieren.</div>`;
    return `${warn}
      <div class="card-header"><div><div class="card-title">🚛 Fuhre erfassen</div><div class="card-sub">Schlag &amp; Sorte wählen – danach im Tab „Offen" wiegen</div></div></div>
      <div class="form-group"><label>Schlag (${aktiv.length} aktiv)</label>
        <select id="we-feld" onchange="weFeldWahl()" ${!gesamt?'disabled':''}><option value="">— Schlag wählen —</option>${feldOptions}</select></div>
      <div class="form-group"><label>Fruchtart</label><div class="fruchtart-fixed" id="we-fruchtart-display">— wird automatisch gesetzt —</div></div>
      <div id="we-sorte-group" style="display:none" class="form-group"><label>Partie / Sorte</label><select id="we-sorte" onchange="weSorteWahl()"><option value="">Konsum</option></select></div>
      ${abfahrerBlockHTML()}
      <button class="btn btn-primary btn-full" id="we-btn" onclick="weStarten()" ${!gesamt?'disabled style="opacity:.5;cursor:not-allowed"':''}>&#9654; Fuhre starten</button>`;
  }

  // ── Abschluss-Modus (Waage-Tablet): Herkunft-Verzweigung ──
  const kopf = `<div class="card-header"><div><div class="card-title">⚖ Ware an der Waage annehmen</div><div class="card-sub">Herkunft wählen → Details → Gewichte</div></div></div>`;
  // Umlagerung ist Teil der Ernte-Schlagauswahl (kein eigener Button mehr).
  if(_herkunft === 'umlagerung') _herkunft = 'ernte';
  // Herkunft-Karten:
  //  • Abfahrer (Selbsterfassung): nur „Ernte" + „Verkauf" (kein Zukauf extern).
  //  • Waage-Tablet/Admin: „Ernte" + „Zukauf extern" (kein Verkauf-Reiter).
  const abfahrerModus = _lockAbfahrer != null;
  const freigeschaltet = state.kontrakte.filter(k => k.abfahrer_frei && k.status === 'aktiv' && (k.richtung||'verkauf') === 'verkauf');
  if(abfahrerModus && _herkunft === 'zukauf') _herkunft = 'ernte';   // Abfahrer kennt kein Zukauf
  if(!abfahrerModus && _herkunft === 'kontrakt') _herkunft = 'ernte'; // andere kennen kein Verkauf
  const herkunftSel = abfahrerModus
    ? `<div style="display:flex;gap:8px;margin-bottom:14px">
        ${segBtn("weSetHerkunft('ernte')", _herkunft==='ernte', '🌾', 'Ernte')}
        ${segBtn("weSetHerkunft('kontrakt')", _herkunft==='kontrakt', '🡒', 'Verkauf')}
      </div>`
    : `<div style="display:flex;gap:8px;margin-bottom:14px">
        ${segBtn("weSetHerkunft('ernte')", _herkunft==='ernte', '🌾', 'Ernte')}
        ${segBtn("weSetHerkunft('zukauf')", _herkunft==='zukauf', '🚚', 'Zukauf extern')}
      </div>`;

  // ─ VERKAUF · Abfahrer liefert selbst an den Kunden → Menge auf den Kontrakt ─
  // Kontrakt wie einen Schlag auswählen; die offene Kontraktmenge wird bewusst
  // NICHT angezeigt.
  if(_herkunft === 'kontrakt') {
    const opts = freigeschaltet.map(k => {
      const kt  = state.kontakte.find(c => c.id === k.kontakt_id);
      const art = state.artikel.find(a => a.id === k.artikel_id);
      const bez = [kt?.name, art?.name || k.fruchtart_text].filter(Boolean).join(' · ');
      return `<option value="${k.id}">${escapeHtml(k.nummer)}${bez ? ' · ' + escapeHtml(bez) : ''}</option>`;
    }).join('');
    const body = freigeschaltet.length
      ? `<div class="form-group"><label>Verkaufskontrakt</label>
          <select id="we-kontrakt" onchange="weKontraktWahl()"><option value="">— Kontrakt wählen —</option>${opts}</select></div>
        <div id="we-kontrakt-info" style="display:none;font-size:12px;color:var(--gold);margin:-6px 0 12px;line-height:1.5"></div>
        <div class="form-group"><label>Kennzeichen</label>
          <input type="text" id="we-kennzeichen" placeholder="z.B. SLK-XY 123" style="text-transform:uppercase"></div>
        ${gewichteHTML()}
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline" style="flex:1;min-width:0" onclick="weKontraktInUmlauf()" title="Mit nur einem Gewicht in den Umlaufspeicher – zweite Wiegung später">🅿 In Umlauf</button>
          <button class="btn btn-green" style="flex:2;min-width:0" id="we-btn" onclick="weKontraktAbschliessen()">&#10003; Abschließen</button>
        </div>`
      : `<div class="alert alert-warn">Zurzeit sind keine Verkaufskontrakte freigeschaltet.</div>`;
    return `${kopf}${herkunftSel}${body}`;
  }

  // ─ ZUKAUF · DÜNGER/KALK → eigene Zukauf-Liste ─
  if(_herkunft === 'zukauf' && _zukaufTyp === 'duenger') {
    const arten = ['Kalk','Kalkammonsalpeter (KAS)','Harnstoff','Schwefelsaurer Ammoniak (SSA)','DAP','NPK-Dünger','Kali','Gülle','Gärrest','Kompost','Sonstiges'];
    return `${kopf}${herkunftSel}${zukaufTypSel()}
      <div class="form-group"><label>Düngerart / Artikel</label>
        <input id="we-duengerart" list="dl-duengerarten" placeholder="z.B. Kalk" autocomplete="off">
        <datalist id="dl-duengerarten">${arten.map(a=>`<option value="${escapeHtml(a)}"></option>`).join('')}</datalist></div>
      <div class="form-group"><label>Lieferant (Freitext)</label>
        <input id="we-dg-lieferant" placeholder="z.B. Raiffeisen / Spedition"></div>
      <div class="form-group"><label>Kennzeichen (optional)</label>
        <input type="text" id="we-kennzeichen" placeholder="z.B. SLK-XY 123" style="text-transform:uppercase"></div>
      ${gewichteHTML()}
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" style="flex:1;min-width:0" onclick="weInUmlauf()" title="Mit nur einem Gewicht in den Umlaufspeicher">🅿 In Umlauf</button>
        <button class="btn btn-green" style="flex:2;min-width:0" id="we-btn" onclick="weDuengerSpeichern()">&#10003; Speichern</button>
      </div>`;
  }

  // ─ ERNTE / UMLAGERUNG / ZUKAUF-GETREIDE (alle → Fuhre) ─
  let quelleBlock = '';
  if(_herkunft !== 'zukauf') { // Ernte – inkl. Umlagerung zwischen Lagern (über die Schlagauswahl)
    // Umlagerung ist ein virtuelles Feld – Status egal, immer als Option anbieten.
    const umlOpts = state.felder.filter(f => f.typ==='umlagerung')
      .map(f => `<option value="${f.id}">🔄 Umlagerung zwischen Lagern</option>`).join('');
    const opts = aktiv.map(f => `<option value="${f.id}">${escapeHtml(f.name)} · ${escapeHtml(f.fruchtart)} (${f.flaeche} ha)</option>`).join('');
    quelleBlock = `<div class="form-group"><label>Schlag${umlOpts?' / Umlagerung':''} (${aktiv.length} aktiv)</label>
      <select id="we-feld" onchange="weFeldWahl()" ${(!aktiv.length && !umlOpts)?'disabled':''}><option value="">— Schlag wählen —</option>${umlOpts}${opts}</select>
      ${aktiv.length?'':'<div style="font-size:11px;color:var(--amber);margin-top:4px">Keine aktiven Schläge.</div>'}</div>`;
  } else { // zukauf getreide/ölsaaten
    const lief = state.felder.filter(f => f.status==='aktiv' && f.typ==='lieferant').sort((a,b)=>a.name.localeCompare(b.name,'de'));
    const opts = lief.map(f => `<option value="${f.id}">🚚 ${escapeHtml(f.name)}</option>`).join('');
    quelleBlock = `${zukaufTypSel()}
      <div class="form-group"><label>Lieferant</label>
        <select id="we-feld" onchange="weFeldWahl()" ${!lief.length?'disabled':''}><option value="">— Lieferant wählen —</option>${opts}</select>
        ${lief.length?'':'<div style="font-size:11px;color:var(--amber);margin-top:4px">Keine Zukauf-Lieferanten aktiviert – unter „Kunden/Lieferanten" freischalten.</div>'}</div>
      <div class="form-group"><label>Einkaufskontrakt <span style="font-size:10px;color:var(--text2);font-weight:400">– optional</span></label>
        <select id="we-ekontrakt-sel" onchange="weEkontraktWahl()">${ekKontraktOptionen(null)}</select>
        <input id="we-ekontrakt" placeholder="Kontrakt-Nr. eingeben" autocomplete="off" style="display:none;margin-top:6px"></div>`;
  }

  const kzVisible = _herkunft === 'zukauf';
  const extraBlock = `
    <div class="form-group"><label>Fruchtart</label><div class="fruchtart-fixed" id="we-fruchtart-display">— wird automatisch gesetzt —</div></div>
    <div id="we-sorte-group" style="display:none" class="form-group"><label>Partie / Sorte</label><select id="we-sorte" onchange="weSorteWahl()"><option value="">Konsum</option></select></div>
    ${abfahrerBlockHTML()}
    <div id="we-kennzeichen-group" style="display:${kzVisible?'block':'none'}" class="form-group"><label>Kennzeichen (Anlieferung)</label>
      <input type="text" id="we-kennzeichen" placeholder="z.B. SLK-XY 123" style="text-transform:uppercase"></div>`;

  return `${kopf}${herkunftSel}${quelleBlock}${extraBlock}
    ${gewichteHTML()}
    <div class="section-label">Qualität <span style="font-size:10px;color:var(--text2);font-weight:400">– optional, fehlende werden abgefragt</span></div>
    <div class="gewicht-grid" id="we-qual-grid"></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-outline" style="flex:1;min-width:0" onclick="weInUmlauf()" title="Mit nur einem Gewicht in den Umlaufspeicher – zweite Wiegung später">🅿 In Umlauf</button>
      <button class="btn btn-green" style="flex:2;min-width:0" id="we-btn" onclick="weAbschliessen()">&#10003; Abschließen</button>
    </div>`;
}

export function renderWaageErfassungInto(el, opts = {}) {
  if(!el) return;
  _container = el;
  _lockAbfahrer = (opts.abfahrerId != null) ? opts.abfahrerId : null;
  _modus = opts.modus || 'abschluss';
  el.innerHTML = `<div class="card" style="max-width:560px;margin:0 auto">${formHTML()}</div>`;
  erfasseGPS(8000); // GPS schon beim Öffnen anwärmen (Ergebnis wird gecacht)
}

// Herkunft/Zukauf-Typ umschalten → Maske neu aufbauen
export function weSetHerkunft(h) {
  _herkunft = h;
  if(h === 'zukauf' && !_zukaufTyp) _zukaufTyp = 'getreide';
  if(_container) renderWaageErfassungInto(_container, { abfahrerId: _lockAbfahrer, modus: _modus });
}
export function weSetZukaufTyp(t) {
  _zukaufTyp = t;
  if(_container) renderWaageErfassungInto(_container, { abfahrerId: _lockAbfahrer, modus: _modus });
}

function reRenderOrClose() {
  if(document.getElementById('we-overlay')) { closeWaageErfassung(); return; }
  if(_modus === 'offen' && state.currentUser?.role === 'abfahrer' && window.setATab) { window.setATab('offen'); return; }
  if(_container) renderWaageErfassungInto(_container, { abfahrerId: _lockAbfahrer, modus: _modus });
}

// ── Einkaufskontrakt (Zukauf Getreide/Ölsaaten) ─────────────────────────────
// Echte Auswahlliste statt <datalist>: die Datalist-Vorschläge erscheinen auf
// Tablet und Waagen-PC oft gar nicht – der Kontrakt war dann "nicht auswählbar".
// Kontrakte des gewählten Lieferanten stehen oben; Freitext bleibt möglich.
// Gespeichert wird weiterhin die Kontrakt-Nummer als Text (fuhren.einkaufskontrakt),
// das versteckte Eingabefeld #we-ekontrakt bleibt dafür die einzige Quelle.
function ekKontrakte() {
  return state.kontrakte
    .filter(k => (k.richtung||'verkauf')==='einkauf' && k.nummer && (k.status||'aktiv')==='aktiv')
    .sort((a,b) => String(a.nummer).localeCompare(String(b.nummer),'de'));
}
function ekOption(k) {
  const kt  = state.kontakte.find(c => c.id === k.kontakt_id);
  const art = state.artikel.find(a => a.id === k.artikel_id);
  const bez = [kt?.name, art?.name || k.fruchtart_text, k.bio ? '🌿 Bio' : ''].filter(Boolean).join(' · ');
  return `<option value="${escapeHtml(k.nummer)}">${escapeHtml(k.nummer)}${bez ? ' · ' + escapeHtml(bez) : ''}</option>`;
}
function ekKontraktOptionen(feld) {
  const alle   = ekKontrakte();
  const eigene = feld?.kontaktId ? alle.filter(k => k.kontakt_id === feld.kontaktId) : [];
  const rest   = eigene.length ? alle.filter(k => !eigene.includes(k)) : alle;
  let html = '<option value="">— kein Kontrakt —</option>';
  if(eigene.length) html += `<optgroup label="Kontrakte des Lieferanten">${eigene.map(ekOption).join('')}</optgroup>`;
  if(rest.length) html += eigene.length
    ? `<optgroup label="Weitere Einkaufskontrakte">${rest.map(ekOption).join('')}</optgroup>`
    : rest.map(ekOption).join('');
  html += '<option value="__frei">✏ Andere Nummer eingeben …</option>';
  return html;
}
// Nach Lieferantenwahl neu aufbauen; genau ein passender Kontrakt wird vorbelegt.
function ekKontraktAktualisieren(feld) {
  const sel = document.getElementById('we-ekontrakt-sel');
  const inp = document.getElementById('we-ekontrakt');
  if(!sel || !inp) return;
  const vorher = sel.value;
  sel.innerHTML = ekKontraktOptionen(feld);
  if(vorher === '__frei') { sel.value = '__frei'; return; } // Freitext bleibt stehen
  const eigene = feld?.kontaktId ? ekKontrakte().filter(k => k.kontakt_id === feld.kontaktId) : [];
  if(vorher && [...sel.options].some(o => o.value === vorher)) sel.value = vorher;
  else if(eigene.length === 1) sel.value = String(eigene[0].nummer);
  else sel.value = '';
  inp.value = sel.value; inp.style.display = 'none';
}
export function weEkontraktWahl() {
  const sel = document.getElementById('we-ekontrakt-sel');
  const inp = document.getElementById('we-ekontrakt');
  if(!sel || !inp) return;
  if(sel.value === '__frei') { inp.value = ''; inp.style.display = 'block'; inp.focus(); }
  else { inp.value = sel.value; inp.style.display = 'none'; }
}

export function weFeldWahl() {
  const feldEl = document.getElementById('we-feld');
  const el = document.getElementById('we-fruchtart-display');
  const sorteGroup = document.getElementById('we-sorte-group');
  const sorteSelect = document.getElementById('we-sorte');
  const kzGroup = document.getElementById('we-kennzeichen-group');
  if(!feldEl || !el) return;
  const feldId = parseInt(feldEl.value);
  if(!feldId) {
    el.textContent = '— wird automatisch gesetzt —'; el.style.color = 'var(--text3)';
    if(sorteGroup) sorteGroup.style.display = 'none';
    if(kzGroup && _herkunft !== 'zukauf') kzGroup.style.display = 'none';
    ekKontraktAktualisieren(null);
    renderQualGrid();
    return;
  }
  const feld = getFeld(feldId);
  // Kennzeichen-Feld bei externer Anlieferung (Zukauf-Lieferant)
  if(kzGroup) kzGroup.style.display = (feld.typ === 'lieferant' && _modus !== 'offen') ? 'block' : (_herkunft==='zukauf'?'block':'none');
  // Umlagerung/Zukauf: Fruchtart je Fuhre wählbar (kein fester Anbau).
  if((feld.typ || 'schlag') !== 'schlag') {
    const eigene = [...new Set(state.felder
      .filter(x => (x.typ||'schlag')==='schlag' && x.fruchtart)
      .map(x => x.fruchtart))];
    const arten = [...new Set([...eigene, ...(feld.zukaufFruchtarten || [])])]
      .sort((a,b) => a.localeCompare(b,'de'));
    el.innerHTML = `<select id="we-fruchtart-select" onchange="weFruchtartWahl()" style="width:100%;border:none;background:none;font:inherit;color:inherit;padding:0">
      <option value="">— Fruchtart wählen —</option>${arten.map(a=>`<option>${escapeHtml(a)}</option>`).join('')}
    </select>`;
    el.style.color = 'var(--gold2)';
    if(sorteGroup) { sorteGroup.style.display = 'none'; if(sorteSelect) sorteSelect.value = ''; }
    if(feld.zukaufAbfahrerId) { const abf = document.getElementById('we-abf'); if(abf) abf.value = String(feld.zukaufAbfahrerId); }
    if(feld.typ === 'lieferant') ekKontraktAktualisieren(feld);
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
  if(_lockAbfahrer != null) return _lockAbfahrer;
  const el = document.getElementById('we-abf');
  if(el) return parseInt(el.value) || null;
  // Keine Abfahrer-Auswahl in der Maske (Zukauf extern): Standard-Abfahrer des
  // Lieferanten übernehmen, sonst ohne Abfahrer speichern (Spalte ist nullable).
  const feld = getFeld(parseInt(document.getElementById('we-feld')?.value));
  return feld?.zukaufAbfahrerId || null;
}
// Abfahrer ist Pflicht, sobald die Maske eine Auswahl anbietet oder fest vorgibt.
function abfahrerPflicht() {
  return _lockAbfahrer != null || !!document.getElementById('we-abf');
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
  if(!abfahrerId && abfahrerPflicht()) { alert('Bitte Abfahrer wählen.'); return; }
  const sorteEl = document.getElementById('we-sorte');
  const sorte = sorteEl ? (sorteEl.value || null) : null;
  const fruchtart = fruchtartFuerSorte(feldId, sorte);
  if((getFeld(feldId).typ || 'schlag') !== 'schlag' && !fruchtart) { alert('Bitte Fruchtart wählen.'); return; }
  const newFuhre = { status:'offen', drescherId: erfasserDrescherId(), abfahrerId: abfahrerId || null, feldId, fruchtart: fruchtart||'', sorte,
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

// ── Dünger/Kalk-Zukauf speichern (Fremdzukauf-Liste, keine Fuhre) ────────────
export async function weDuengerSpeichern() {
  const artikel = (document.getElementById('we-duengerart')?.value || '').trim();
  if(!artikel) { alert('Bitte Düngerart / Artikel angeben.'); return; }
  const lieferant = (document.getElementById('we-dg-lieferant')?.value || '').trim();
  const v = parseGewicht(document.getElementById('voll-'+WID)?.value);
  const l = parseGewicht(document.getElementById('leer-'+WID)?.value);
  if(!v || !l || v <= l) { alert('Bitte gültige Gewichte eingeben (Vollgew. > Leergew.).'); return; }
  const kennzeichen = (document.getElementById('we-kennzeichen')?.value || '').trim().toUpperCase();
  const btn = document.getElementById('we-btn');
  if(btn) { btn.disabled = true; btn.textContent = 'Speichert…'; }
  try {
    const saved = await db.insertFremdzukauf({
      kategorie: 'duenger', artikel, lieferant: lieferant || null,
      vollgewicht: v, leergewicht: l, mengeKg: v - l,
      kennzeichen: kennzeichen || null, erstelltVon: state.currentUser?.id || null
    });
    if(saved) state.fremdzukauf.unshift(saved);
    showToast(`✓ Zukauf gespeichert · ${escapeHtml(artikel)} · ${kg2t(v-l)}`);
    reRenderOrClose();
  } catch(e) {
    if(btn) { btn.disabled = false; btn.innerHTML = '&#10003; Zukauf speichern'; }
    showToast('⚠ Fehler: ' + e.message, 'error');
  }
}

// ── Kontrakt-Selbstlieferung (Abfahrer): kurze Bestätigung (Kunde/Artikel) ────
// Die offene Kontraktmenge wird dem Abfahrer bewusst NICHT angezeigt.
export function weKontraktWahl() {
  const id = parseInt(document.getElementById('we-kontrakt')?.value);
  const info = document.getElementById('we-kontrakt-info');
  if(!info) return;
  const k = state.kontrakte.find(x => x.id === id);
  if(!k) { info.style.display = 'none'; return; }
  const art = state.artikel.find(a => a.id === k.artikel_id);
  const kt  = state.kontakte.find(c => c.id === k.kontakt_id);
  info.style.display = 'block';
  info.innerHTML = `${escapeHtml(kt?.name || '')}${art ? ' · ' + escapeHtml(art.name) : ''}${k.bio ? ' · <span style="color:var(--color-success);font-weight:700">🌿 BIO</span>' : ''}`;
}

// ── Kontrakt-Selbstlieferung abschließen: Menge auf den Kontrakt buchen ───────
// Bucht einen Warenausgang auf den Kontrakt (erscheint in der Kontrakt-Übersicht,
// zählt auf die Liefermenge). Bewusst OHNE Lager/Bestand und ohne Lieferschein –
// Details/Schein macht der Admin später. Lieferschein-Nr. vergibt der DB-Trigger.
export async function weKontraktAbschliessen() {
  const id = parseInt(document.getElementById('we-kontrakt')?.value);
  if(!id) { alert('Bitte Kontrakt wählen.'); return; }
  const k = state.kontrakte.find(x => x.id === id);
  if(!k) { alert('Kontrakt nicht gefunden.'); return; }
  const v = parseGewicht(document.getElementById('voll-'+WID)?.value);
  const l = parseGewicht(document.getElementById('leer-'+WID)?.value);
  if(!v || !l || v <= l) { alert('Bitte gültige Gewichte eingeben (Vollgew. > Leergew.).'); return; }
  const kennzeichen = (document.getElementById('we-kennzeichen')?.value || '').trim().toUpperCase();
  const kunde = state.kontakte.find(c => c.id === k.kontakt_id);
  const btn = document.getElementById('we-btn');
  if(btn) { btn.disabled = true; btn.textContent = 'Speichert…'; }
  try {
    const saved = await db.insertWarenbewegung({
      typ: 'ausgang', kontraktId: k.id, artikelId: k.artikel_id || null,
      mengeKg: v - l, vollgewicht: v, leergewicht: l,
      kennzeichen: kennzeichen || null, empfaenger: kunde?.name || null,
      bio: !!k.bio, erstelltVon: state.currentUser?.id || null
    });
    if(saved) state.warenbewegungen.unshift(saved);
    showToast(`✓ Lieferung gebucht · ${kg2t(v - l)} · Kontrakt ${k.nummer}`);
    reRenderOrClose();
  } catch(e) {
    if(btn) { btn.disabled = false; btn.innerHTML = '&#10003; Abschließen'; }
    showToast('⚠ Fehler: ' + e.message, 'error');
  }
}

// ── Kontrakt-Selbstlieferung zweistufig: Erstwiegung in den Umlaufspeicher ────
// Kennzeichnung über payload.abfahrerVerkauf: Solche Einträge haben kein Lager und
// werden deshalb nicht über die Warenausgangs-Maske der Waage abgeschlossen.
let _verkaufOffenId = null; // geöffneter Eintrag im Umlauf-Tab des Abfahrers

function istAbfahrerVerkauf(u) { return !!u?.payload?.abfahrerVerkauf; }
function verkaufWartend() {
  return (state.umlauf || []).filter(u => u.status === 'wartet' && istAbfahrerVerkauf(u));
}
// Zurück in die passende Liste: Umlauf-Tab des Abfahrers bzw. Umlauf der Waage.
export function weVerkaufUmlaufListe() {
  _verkaufOffenId = null;
  _umlaufEntry = null;
  if(state.currentUser?.role === 'abfahrer' && window.setATab) window.setATab('umlauf');
  else if(window.waUmlaufListe) window.waUmlaufListe();
}

export async function weKontraktInUmlauf() {
  const id = parseInt(document.getElementById('we-kontrakt')?.value);
  if(!id) { alert('Bitte Kontrakt wählen.'); return; }
  const k = state.kontrakte.find(x => x.id === id);
  if(!k) { alert('Kontrakt nicht gefunden.'); return; }
  const kennzeichen = (document.getElementById('we-kennzeichen')?.value || '').trim().toUpperCase();
  if(!kennzeichen) { alert('Bitte Kennzeichen angeben – daran wird das Fahrzeug im Umlauf wiedererkannt.'); return; }
  const v = parseGewicht(document.getElementById('voll-'+WID)?.value);
  const l = parseGewicht(document.getElementById('leer-'+WID)?.value);
  if(!v && !l) { alert('Bitte ein Gewicht (Voll ODER Leer) für den Umlauf eingeben.'); return; }
  if(v && l) { alert('Beide Gewichte vorhanden – dann bitte direkt „Abschließen". Für den Umlauf nur ein Gewicht.'); return; }
  const erstgewicht = v || l;
  const erstTyp = v ? 'voll' : 'leer';
  const btn = document.getElementById('we-btn');
  if(btn) btn.disabled = true;
  try {
    const saved = await db.insertUmlauf({
      richtung: 'ausgang', kennzeichen, erstgewicht, erstTyp, leergewicht: l || null,
      kontaktId: k.kontakt_id, kontraktId: k.id, artikelId: k.artikel_id || null,
      payload: { abfahrerVerkauf: true }, erstelltVon: state.currentUser?.id || null
    });
    state.umlauf = state.umlauf || [];
    if(saved && !state.umlauf.some(x => x.id === saved.id)) state.umlauf.push(saved);
    showToast(`🅿 ${kennzeichen} in den Umlauf · ${erstTyp==='voll'?'Voll':'Leer'} ${erstgewicht.toLocaleString('de-DE')} kg`);
    weVerkaufUmlaufListe();
  } catch(e) {
    if(btn) btn.disabled = false;
    showToast('⚠ Fehler: ' + e.message, 'error');
  }
}

// Umlauf-Tab des Abfahrers: wartende Verkaufs-Erstwiegungen aller Abfahrer – Erst-
// und Zweitwiegung können so auch von verschiedenen Personen erfasst werden.
export function renderAbfahrerUmlauf(el) {
  if(!el) return;
  const liste = verkaufWartend();
  const offen = liste.find(u => u.id === _verkaufOffenId);
  if(offen) { renderUmlaufVerkaufAbschluss(el, offen); return; }
  _verkaufOffenId = null;
  el.innerHTML = `<div id="abf-umlauf" style="max-width:560px;margin:0 auto">${liste.length ? liste.map(u => {
    const k   = state.kontrakte.find(x => x.id === u.kontrakt_id);
    const kt  = state.kontakte.find(c => c.id === u.kontakt_id);
    const art = state.artikel.find(a => a.id === u.artikel_id);
    const d   = new Date(u.erstwiegung);
    const zeit = isNaN(d) ? '' : d.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'});
    return `<div class="card" onclick="weVerkaufUmlaufOeffnen(${u.id})" style="margin-bottom:8px;cursor:pointer;border-left:4px solid var(--amber);display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div style="min-width:0;flex:1">
        <div style="font-size:15px;font-weight:700;color:var(--color-text)">🚚 ${escapeHtml(u.kennzeichen || '—')}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">${escapeHtml(kt?.name || '–')}${k ? ' · Kontrakt ' + escapeHtml(k.nummer) : ''}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:1px">${escapeHtml(art?.name || '–')}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:15px;font-weight:700;color:var(--gold)">${Number(u.erstgewicht || 0).toLocaleString('de-DE')} kg</div>
        <div style="font-size:10px;color:var(--text3)">${u.erst_typ === 'voll' ? 'Voll' : 'Leer'} · seit ${zeit}</div>
        <div style="font-size:11px;color:var(--amber);margin-top:3px">Zweitwiegung ›</div>
      </div>
    </div>`;
  }).join('') : `<div class="empty-state">Kein Fahrzeug im Umlauf.<br>Erstwiegung unter „Fuhre erfassen" → „Verkauf" mit „In Umlauf" speichern.</div>`}</div>`;
}
export function weVerkaufUmlaufOeffnen(id) {
  _verkaufOffenId = id;
  if(window.setATab) window.setATab('umlauf');
}

// Zweitwiegung einer Verkaufs-Erstwiegung – im Umlauf-Tab und an der Waage dieselbe Maske.
export function renderUmlaufVerkaufAbschluss(el, u) {
  if(!el) return;
  _umlaufEntry = u;
  const k   = state.kontrakte.find(x => x.id === u.kontrakt_id);
  const kt  = state.kontakte.find(c => c.id === u.kontakt_id);
  const art = state.artikel.find(a => a.id === u.artikel_id);
  const erstVoll = u.erst_typ === 'voll';
  const zweitId = (erstVoll ? 'leer-' : 'voll-') + WID;
  const widget = window.waageFuhreWidgetHTML ? window.waageFuhreWidgetHTML(WID) : '';
  const row = (kk, val) => `<tr><td style="padding:5px 4px;color:var(--text2);width:44%">${escapeHtml(kk)}</td><td style="padding:5px 4px;font-weight:600">${escapeHtml(val)}</td></tr>`;
  el.innerHTML = `<div class="card" style="max-width:560px;margin:0 auto">
    <div class="card-header"><div>
      <div class="card-title">🡒 Zweitwiegung · 🚚 ${escapeHtml(u.kennzeichen || '—')}</div>
      <div class="card-sub">Verkauf auf Kontrakt abschließen</div></div>
      <button onclick="weVerkaufUmlaufListe()" title="Zurück zur Liste" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--color-text-muted)">✕</button>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:10px">
      ${row('Kontrakt', k?.nummer || '–')}
      ${row('Kunde', kt?.name || '–')}
      ${row('Artikel', art?.name || '–')}
    </table>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <label style="font-size:11px;color:var(--text2)">Kennzeichen<input id="we-kennzeichen" class="input" type="text" value="${escapeHtml(u.kennzeichen||'')}" style="text-transform:uppercase"></label>
      <label style="font-size:11px;color:var(--text2)">${erstVoll ? 'Vollgewicht' : 'Leergewicht'} 1. Wiegung (kg)<input id="we-vk-erst" class="input" type="text" inputmode="numeric" value="${Number(u.erstgewicht||0).toLocaleString('de-DE')}" oninput="fmtGewicht(this);weUmlaufNetto()"></label>
    </div>
    <div class="section-label">${erstVoll ? 'Leergewicht (kg)' : 'Vollgewicht (kg)'} – 2. Wiegung</div>
    ${widget}
    <div class="form-group" style="display:flex;gap:6px">
      <input type="text" inputmode="numeric" id="${zweitId}" placeholder="Gewicht (kg)" style="font-size:20px;font-weight:700;letter-spacing:0.5px;flex:1;min-width:0" oninput="fmtGewicht(this);weUmlaufNetto()">
      ${erstVoll ? `<button type="button" onclick="openHaengerzugWahl('${WID}')" title="Hängerzug wählen" style="flex-shrink:0;width:52px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:22px;cursor:pointer">🚛</button>` : ''}
    </div>
    <div class="netto-display"><div class="netto-label">Netto</div><div class="netto-val" id="netto-${WID}" style="font-size:28px">—</div><div class="netto-unit">kg</div></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-outline" style="flex-shrink:0" onclick="weVerkaufUmlaufStornieren(${u.id})" title="Aus dem Umlauf nehmen">✕</button>
      <button class="btn btn-green btn-full" id="we-btn" onclick="weVerkaufUmlaufAbschliessen(${u.id})">&#10003; Abschließen</button>
    </div>
  </div>`;
}

// Bucht wie die direkte Selbstlieferung einen Warenausgang auf den Kontrakt.
export async function weVerkaufUmlaufAbschliessen(id) {
  const u = verkaufWartend().find(x => x.id === id);
  if(!u) { showToast('⚠ Umlauf-Eintrag nicht gefunden', 'error'); return; }
  const k = state.kontrakte.find(x => x.id === u.kontrakt_id);
  const kennzeichen = (document.getElementById('we-kennzeichen')?.value || '').trim().toUpperCase();
  if(!kennzeichen) { alert('Bitte Kennzeichen angeben.'); return; }
  const erstVoll = u.erst_typ === 'voll';
  const erst  = parseGewicht(document.getElementById('we-vk-erst')?.value);
  const zweit = parseGewicht(document.getElementById((erstVoll ? 'leer-' : 'voll-') + WID)?.value);
  if(!erst)  { alert('Bitte ein gültiges Erstgewicht angeben.'); return; }
  if(!zweit) { alert('Bitte das zweite Gewicht eingeben.'); return; }
  const v = erstVoll ? erst : zweit;
  const l = erstVoll ? zweit : erst;
  if(!(v > l)) { alert('Vollgewicht muss größer als Leergewicht sein.'); return; }
  const kunde = state.kontakte.find(c => c.id === u.kontakt_id);
  const btn = document.getElementById('we-btn');
  if(btn) { btn.disabled = true; btn.textContent = 'Speichert…'; }
  try {
    const saved = await db.insertWarenbewegung({
      typ: 'ausgang', kontraktId: u.kontrakt_id, artikelId: u.artikel_id || null,
      mengeKg: v - l, vollgewicht: v, leergewicht: l,
      kennzeichen, empfaenger: kunde?.name || null,
      bio: !!k?.bio, erstelltVon: state.currentUser?.id || null
    });
    if(saved) state.warenbewegungen.unshift(saved);
    await db.umlaufAbschliessen(id, saved.id);
    state.umlauf = (state.umlauf || []).filter(x => x.id !== id);
    showToast(`✓ Lieferung gebucht · ${kg2t(v - l)}${k ? ' · Kontrakt ' + k.nummer : ''}`);
    weVerkaufUmlaufListe();
  } catch(e) {
    if(btn) { btn.disabled = false; btn.innerHTML = '&#10003; Abschließen'; }
    showToast('⚠ Fehler: ' + e.message, 'error');
  }
}

export async function weVerkaufUmlaufStornieren(id) {
  const u = verkaufWartend().find(x => x.id === id);
  if(!u) return;
  if(!confirm(`Fahrzeug ${u.kennzeichen} aus dem Umlauf nehmen? Es wird keine Lieferung gebucht.`)) return;
  try {
    await db.umlaufStornieren(id);
    state.umlauf = state.umlauf.filter(x => x.id !== id);
    showToast(`🚚 ${u.kennzeichen} aus dem Umlauf genommen`);
    weVerkaufUmlaufListe();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}

// ── In den (gemeinsamen) Umlaufspeicher schicken – mit nur EINEM Gewicht ──────
// Zweite Wiegung erfolgt später über den Umlauf-Bereich.
export async function weInUmlauf() {
  const duenger = _herkunft === 'zukauf' && _zukaufTyp === 'duenger';
  const v = parseGewicht(document.getElementById('voll-'+WID)?.value);
  const l = parseGewicht(document.getElementById('leer-'+WID)?.value);
  const anzahl = (v ? 1 : 0) + (l ? 1 : 0);
  if(anzahl === 0) { alert('Bitte ein Gewicht (Voll ODER Leer) für den Umlauf eingeben.'); return; }
  if(anzahl === 2) { alert('Beide Gewichte vorhanden – dann bitte direkt „Abschließen". Für den Umlauf nur ein Gewicht.'); return; }
  const erstgewicht = v || l;
  const erstTyp = v ? 'voll' : 'leer';
  const kennzeichen = (document.getElementById('we-kennzeichen')?.value || '').trim().toUpperCase();

  let payload;
  if(duenger) {
    const artikel = (document.getElementById('we-duengerart')?.value || '').trim();
    if(!artikel) { alert('Bitte Düngerart / Artikel angeben.'); return; }
    payload = { kategorie: 'duenger', artikel, lieferant: (document.getElementById('we-dg-lieferant')?.value || '').trim() || null };
  } else {
    const feldId = parseInt(document.getElementById('we-feld')?.value);
    if(!feldId) { alert('Bitte Herkunft/Schlag wählen.'); return; }
    const abfahrerId = leseAbfahrerId();
    if(!abfahrerId && abfahrerPflicht()) { alert('Bitte Abfahrer wählen.'); return; }
    const sorte = document.getElementById('we-sorte')?.value || null;
    const fruchtart = fruchtartFuerSorte(feldId, sorte);
    const feld = getFeld(feldId);
    if((feld.typ || 'schlag') !== 'schlag' && !fruchtart) { alert('Bitte Fruchtart wählen.'); return; }
    const einkaufskontrakt = (document.getElementById('we-ekontrakt')?.value || '').trim();
    payload = { feldId, fruchtart: fruchtart || '', sorte, abfahrerId: abfahrerId || null, herkunftName: feld.name || '',
      einkaufskontrakt: (feld.typ === 'lieferant' && einkaufskontrakt) ? einkaufskontrakt : null,
      // Qualitäten mitnehmen – sonst gehen sie zwischen 1. und 2. Wiegung verloren.
      qualitaet: leseQualitaeten(fruchtart) };
  }

  const btn = document.getElementById('we-btn');
  if(btn) btn.disabled = true;
  try {
    const saved = await db.insertUmlauf({
      richtung: 'eingang', kennzeichen: kennzeichen || null,
      erstgewicht, erstTyp, payload, erstelltVon: state.currentUser?.id || null
    });
    state.umlauf = state.umlauf || [];
    if(saved) state.umlauf.push(saved);
    showToast(`🅿 ${kennzeichen || 'Fahrzeug'} in den Umlauf · ${erstTyp==='voll'?'Voll':'Leer'} ${erstgewicht.toLocaleString('de-DE')} kg`);
    if(document.getElementById('we-overlay')) { closeWaageErfassung(); return; }
    if(window.waUmlaufListe) window.waUmlaufListe(); else reRenderOrClose();
  } catch(e) {
    if(btn) btn.disabled = false;
    showToast('⚠ Fehler: ' + e.message, 'error');
  }
}

// ── Zweitwiegung: einen wartenden Eingangs-Umlauf abschließen ─────────────────
let _umlaufEntry = null;
export function renderUmlaufEingangAbschluss(el, u) {
  if(!el) return;
  _umlaufEntry = u;
  const p = u.payload || {};
  const duenger = p.kategorie === 'duenger';
  const lieferantFeld = !duenger && getFeld(p.feldId)?.typ === 'lieferant';
  const erst = Number(u.erstgewicht || 0);
  const erstVoll = u.erst_typ === 'voll';
  const zweitId = erstVoll ? 'leer-' + WID : 'voll-' + WID;
  const artikelBez = duenger ? (p.artikel || 'Dünger') : (p.fruchtart || '–');
  const herkunft = duenger ? (p.lieferant ? 'Lieferant: ' + p.lieferant : 'Zukauf Dünger') : (p.herkunftName || 'Wareneingang');
  const widget = window.waageFuhreWidgetHTML ? window.waageFuhreWidgetHTML(WID) : '';
  const row = (k, val) => `<tr><td style="padding:5px 4px;color:var(--text2);width:44%">${escapeHtml(k)}</td><td style="padding:5px 4px;font-weight:600">${val}</td></tr>`;
  el.innerHTML = `<div class="card">
    <div class="card-header"><div>
      <div class="card-title">↓ Zweitwiegung · 🚚 ${escapeHtml(u.kennzeichen || '—')}</div>
      <div class="card-sub">${duenger ? 'Dünger-Zukauf' : 'Wareneingang'} abschließen</div></div>
      <button onclick="waUmlaufListe()" title="Zurück zur Liste" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--color-text-muted)">✕</button>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:10px">
      ${row(duenger ? 'Artikel' : 'Fruchtart', escapeHtml(artikelBez))}
      ${row('Herkunft', escapeHtml(herkunft))}
    </table>
    <div class="section-label">Fahrzeug bearbeiten <span style="font-size:10px;color:var(--text2);font-weight:400">– speichern ohne Abschluss</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">
      <label style="font-size:11px;color:var(--text2)">Kennzeichen<input id="we-um-kz-${u.id}" class="input" value="${escapeHtml(u.kennzeichen||'')}" style="text-transform:uppercase"></label>
      <label style="font-size:11px;color:var(--text2)">${erstVoll ? 'Vollgewicht' : 'Leergewicht'} 1. Wiegung (kg)<input id="we-um-erst-${u.id}" class="input" type="number" value="${erst||''}"></label>
    </div>
    ${duenger ? '' : `<div class="section-label">Qualität <span style="font-size:10px;color:var(--text2);font-weight:400">– wird mit der Fuhre gespeichert</span></div>
    <div class="gewicht-grid" style="margin-bottom:6px">${qualGridHTML(p.fruchtart || '', p.qualitaet || {})}</div>`}
    <button class="btn btn-outline btn-full" style="margin-bottom:12px" onclick="weUmlaufAktualisieren(${u.id})"
      title="Änderungen speichern und im Umlauf behalten – ohne 2. Wiegung">&#128190; Im Umlauf speichern</button>
    <div class="section-label">${erstVoll ? 'Leergewicht (kg)' : 'Vollgewicht (kg)'} – 2. Wiegung</div>
    ${widget}
    <div class="form-group" style="display:flex;gap:6px">
      <input type="text" inputmode="numeric" id="${zweitId}" placeholder="Gewicht (kg)" style="font-size:20px;font-weight:700;letter-spacing:0.5px;flex:1;min-width:0" oninput="fmtGewicht(this);weUmlaufNetto()">
      ${erstVoll ? `<button type="button" onclick="openHaengerzugWahl('${WID}')" title="Hängerzug wählen" style="flex-shrink:0;width:52px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:22px;cursor:pointer">🚛</button>` : ''}
    </div>
    <div class="netto-display"><div class="netto-label">Netto</div><div class="netto-val" id="netto-${WID}" style="font-size:28px">—</div><div class="netto-unit">kg</div></div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer;margin:10px 0 2px">
      <input type="checkbox" id="we-um-ls" ${(duenger || lieferantFeld) ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--gold);cursor:pointer">
      🖨 Lieferschein für den Fahrer drucken
    </label>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-outline" style="flex-shrink:0" onclick="waUmlaufStornieren(${u.id})" title="Aus dem Umlauf nehmen">✕</button>
      <button class="btn btn-green btn-full" id="we-btn" onclick="weUmlaufAbschliessen(${u.id})">&#10003; Abschließen</button>
    </div>
  </div>`;
}

export function weUmlaufNetto() {
  const el = document.getElementById('netto-' + WID);
  if(!el || !_umlaufEntry) return;
  const erstEl = document.getElementById('we-vk-erst'); // Verkauf: Erstgewicht direkt änderbar
  const erst = erstEl ? parseGewicht(erstEl.value) : Number(_umlaufEntry.erstgewicht || 0);
  const erstVoll = _umlaufEntry.erst_typ === 'voll';
  const zweit = parseGewicht(document.getElementById(erstVoll ? 'leer-' + WID : 'voll-' + WID)?.value);
  const voll = erstVoll ? erst : zweit;
  const leer = erstVoll ? zweit : erst;
  if(voll && leer && voll > leer) { el.textContent = (voll - leer).toLocaleString('de-DE'); el.style.color = 'var(--green2)'; }
  else { el.textContent = '—'; el.style.color = 'var(--text3)'; }
}

// Eingangs-Umlauf bearbeiten (Kennzeichen + Erstgewicht) und im Umlauf behalten –
// ohne die zweite Wiegung / den Abschluss.
export async function weUmlaufAktualisieren(id) {
  const u = (_umlaufEntry && _umlaufEntry.id === id) ? _umlaufEntry : (state.umlauf || []).find(x => x.id === id);
  if(!u) { showToast('⚠ Umlauf-Eintrag nicht gefunden', 'error'); return; }
  const kz = (document.getElementById('we-um-kz-'+id)?.value || '').trim().toUpperCase();
  const erst = parseGewicht(document.getElementById('we-um-erst-'+id)?.value);
  if(!erst || erst <= 0) { alert('Bitte ein gültiges Erstgewicht angeben.'); return; }
  const p = u.payload || {};
  const payload = p.kategorie === 'duenger' ? p : { ...p, qualitaet: leseQualitaeten(p.fruchtart || '', p.qualitaet || {}) };
  try {
    await db.updateUmlauf(id, { kennzeichen: kz || null, erstgewicht: erst, payload });
    u.kennzeichen = kz || null; u.erstgewicht = erst; u.payload = payload;
    showToast(`💾 ${kz || 'Fahrzeug'} im Umlauf gespeichert`);
    if(window.waUmlaufListe) window.waUmlaufListe();
  } catch(e) { showToast('⚠ Fehler: ' + e.message, 'error'); }
}

export async function weUmlaufAbschliessen(id) {
  const u = (_umlaufEntry && _umlaufEntry.id === id) ? _umlaufEntry : (state.umlauf || []).find(x => x.id === id);
  if(!u) { showToast('⚠ Umlauf-Eintrag nicht gefunden', 'error'); return; }
  const p = u.payload || {};
  const erst = Number(u.erstgewicht || 0);
  const erstVoll = u.erst_typ === 'voll';
  const zweit = parseGewicht(document.getElementById(erstVoll ? 'leer-' + WID : 'voll-' + WID)?.value);
  if(!zweit || zweit <= 0) { alert('Bitte das zweite Gewicht eingeben.'); return; }
  const voll = erstVoll ? erst : zweit;
  const leer = erstVoll ? zweit : erst;
  if(!(voll > leer)) { alert('Vollgewicht muss größer als Leergewicht sein.'); return; }
  const drucken = !!document.getElementById('we-um-ls')?.checked; // vor dem Neuzeichnen lesen
  const btn = document.getElementById('we-btn');
  if(btn) { btn.disabled = true; btn.textContent = 'Speichert…'; }
  try {
    if(p.kategorie === 'duenger') {
      const saved = await db.insertFremdzukauf({ kategorie: 'duenger', artikel: p.artikel, lieferant: p.lieferant || null,
        vollgewicht: voll, leergewicht: leer, mengeKg: voll - leer, kennzeichen: u.kennzeichen || null, erstelltVon: state.currentUser?.id || null });
      if(saved) state.fremdzukauf.unshift(saved);
      showToast(`✓ Zukauf gespeichert · ${escapeHtml(p.artikel || '')} · ${kg2t(voll - leer)}`);
      if(drucken) druckeWareneingangLieferschein({ feld: { name: p.lieferant || 'Zukauf Dünger' }, fruchtart: p.artikel || 'Dünger',
        voll, leer, kennzeichen: u.kennzeichen, nr: '', zeitErst: u.erstwiegung, empfName: p.lieferant || '', ohneQualitaet: true });
    } else {
      // Qualitäten: aus der Zweitwiegungs-Maske, sonst aus der Payload der 1. Wiegung.
      const q = leseQualitaeten(p.fruchtart || '', p.qualitaet || {});
      const qual = { feuchte: q.feuchte||null, protein: q.protein||null, gluten: q.gluten||null, hlGewicht: q.hl||null, oelgehalt: q.oelgehalt||null };
      const res = await db.insertFuhreKomplett({
        status: 'fertig', drescherId: state.currentUser?.role === 'abfahrer' ? null : (state.currentUser?.id ?? null),
        abfahrerId: p.abfahrerId || null, feldId: p.feldId, fruchtart: p.fruchtart || '', sorte: p.sorte || null,
        vollgewicht: voll, leergewicht: leer, kennzeichen: u.kennzeichen || null, ...qual,
        einkaufskontrakt: p.einkaufskontrakt || null, zeit: new Date().toISOString()
      });
      state.fuhren.push({ id: res.id, nr: res.nr, status: 'fertig', feldId: p.feldId, fruchtart: p.fruchtart || '', sorte: p.sorte || null,
        abfahrerId: p.abfahrerId || null, vollgewicht: voll, leergewicht: leer, kennzeichen: u.kennzeichen || null, ...qual,
        einkaufskontrakt: p.einkaufskontrakt || null, zeit: new Date().toISOString() });
      showToast(`✓ Fuhre ${res.nr} abgeschlossen · ${kg2t(voll - leer)}`);
      if(drucken) druckeWareneingangLieferschein({ feld: getFeld(p.feldId), fruchtart: p.fruchtart, voll, leer,
        kennzeichen: u.kennzeichen, nr: res.nr, zeitErst: u.erstwiegung, qual: q, einkaufskontrakt: p.einkaufskontrakt });
    }
    await db.umlaufErledigt(id);
    state.umlauf = (state.umlauf || []).filter(x => x.id !== id);
    _umlaufEntry = null;
    if(window.waUmlaufListe) window.waUmlaufListe();
  } catch(e) {
    if(btn) { btn.disabled = false; btn.innerHTML = '&#10003; Abschließen'; }
    showToast('⚠ Fehler: ' + e.message, 'error');
  }
}

// Waage-Tablet: prüft Eingaben und zeigt ein Bestätigungs-Popup ("Speichern"/"Bearbeiten").
let _gpsFuerFuhre = null;
export async function weAbschliessen() {
  const feldId = parseInt(document.getElementById('we-feld')?.value);
  const abfahrerId = leseAbfahrerId();
  if(!feldId) { alert('Bitte Herkunft/Schlag wählen.'); return; }
  if(!abfahrerId && abfahrerPflicht()) { alert('Bitte Abfahrer wählen.'); return; }
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
  const abfName = abfahrerId ? (state.users.find(u=>u.id===abfahrerId)?.name || '') : '';
  const kennzeichen = (document.getElementById('we-kennzeichen')?.value || '').trim().toUpperCase();
  const einkaufskontrakt = (document.getElementById('we-ekontrakt')?.value || '').trim();
  _gpsFuerFuhre = await erfasseGPS(4000);
  zeigeBestaetigung({ feld, fruchtart, sorte, abfName, v, l, qRows, gps: _gpsFuerFuhre, kennzeichen, einkaufskontrakt });
}

// Tatsächliches Speichern (nach Bestätigung im Popup).
async function weAbschliessenSpeichern() {
  const sbtn = document.getElementById('we-conf-save');
  if(sbtn) { sbtn.disabled = true; sbtn.textContent = 'Speichert…'; }
  const feldId = parseInt(document.getElementById('we-feld')?.value);
  const abfahrerId = leseAbfahrerId();
  const v = parseGewicht(document.getElementById('voll-'+WID)?.value);
  const l = parseGewicht(document.getElementById('leer-'+WID)?.value);
  if(!feldId || (!abfahrerId && abfahrerPflicht()) || !v || !l || v <= l) { closeBestaetigung(); showToast('⚠ Eingaben unvollständig', 'error'); return; }
  const sorte = document.getElementById('we-sorte')?.value || null;
  const fruchtart = fruchtartFuerSorte(feldId, sorte);
  const feld = getFeld(feldId);
  const kennzeichen = (document.getElementById('we-kennzeichen')?.value || '').trim().toUpperCase();
  const einkaufskontrakt = (document.getElementById('we-ekontrakt')?.value || '').trim();
  const lieferscheinDrucke = !!document.getElementById('we-conf-ls')?.checked;
  const qf = getQualitaetsfelder(fruchtart);
  const q = {};
  for(const key of Object.keys(qf)) { const el = document.getElementById('qual-'+key+'-'+WID); q[key] = el ? (parseFloat(el.value)||null) : null; }
  const newFuhre = {
    status:'fertig', drescherId: erfasserDrescherId(), abfahrerId: abfahrerId || null, feldId, fruchtart: fruchtart||'', sorte,
    vollgewicht: v, leergewicht: l,
    feuchte: q.feuchte||null, protein: q.protein||null, gluten: q.gluten||null, hlGewicht: q.hl||null, oelgehalt: q.oelgehalt||null,
    kennzeichen: kennzeichen || null,
    einkaufskontrakt: (feld.typ === 'lieferant' && einkaufskontrakt) ? einkaufskontrakt : null,
    lat: _gpsFuerFuhre?.lat ?? null, lon: _gpsFuerFuhre?.lon ?? null,
    zeit: new Date().toISOString()
  };
  try {
    const res = await db.insertFuhreKomplett(newFuhre);
    newFuhre.id = res.id; newFuhre.nr = res.nr; state.fuhren.push(newFuhre);
    const abfName = abfahrerId ? (state.users.find(u => u.id === abfahrerId)?.name || '') : (kennzeichen || 'Zukauf extern');
    showToast(`✓ Fuhre ${res.nr} abgeschlossen · ${kg2t(v-l)} · ${abfName}`);
    closeBestaetigung();
    if(lieferscheinDrucke) druckeWareneingangLieferschein({ feld, fruchtart, voll: v, leer: l, kennzeichen, nr: res.nr,
      qual: q, einkaufskontrakt: newFuhre.einkaufskontrakt });
    reRenderOrClose();
  } catch(e) {
    if(sbtn) { sbtn.disabled = false; sbtn.innerHTML = '&#10003; Speichern'; }
    showToast('⚠ Fehler: ' + e.message, 'error');
  }
}

// Lieferschein/Wiegeschein für eine externe Anlieferung (Zukauf) drucken.
// d: { feld, fruchtart, voll, leer, kennzeichen, nr, zeitErst, zeitZweit, qual, einkaufskontrakt, empfName }
//  zeitErst  = Zeitpunkt der 1. Wiegung (Umlauf), leer bei Direktabschluss
//  zeitZweit = Zeitpunkt des Abschlusses (Standard: jetzt)
//  qual      = { feuchte, oelgehalt, hl, protein, gluten } – nur gefüllte werden gedruckt
function druckeWareneingangLieferschein(d) {
  const feld = d.feld || {};
  const netto = d.voll - d.leer;
  // Lieferant = Kontakt des Zukauf-Lieferanten; bei eigener Ernte der erzeugende
  // Betrieb des Schlags (als Kontakt angelegt, falls vorhanden).
  const istSchlag = (feld.typ || 'schlag') === 'schlag' && !!feld.betrieb;
  const kontakt = feld.kontaktId ? state.kontakte.find(c => c.id === feld.kontaktId)
    : istSchlag ? state.kontakte.find(c => (c.name || '').trim().toLowerCase() === feld.betrieb.trim().toLowerCase()) || null
    : null;
  const adr = kontaktAnschrift(kontakt);
  const istBio = !!(feld.id && isBioFeld(feld.id));
  // EU-Öko-Pflichtangaben (VO (EU) 2018/848 Anh. III Nr. 2): Bio-Bezeichnung,
  // Code-Nr. der Kontrollstelle des Lieferanten, Partie.
  const zertifikate = [];
  if(istBio) {
    const ks = kontakt?.oeko_kontrollstelle || '';
    zertifikate.push(oekoZeile('EU-Öko · Kontrollstelle Lieferant', ks || '________________'));
    if(!ks) showToast('⚠ Öko-Kontrollstelle des Lieferanten fehlt – bitte im Kontakt pflegen (auf dem Schein handschriftlich ergänzen)', 'error');
  }
  const dOpt = { day:'2-digit', month:'2-digit', year:'numeric' };
  const tOpt = { hour:'2-digit', minute:'2-digit' };
  const dt = x => { const t = x ? new Date(x) : null; return (t && !isNaN(t)) ? t.toLocaleDateString('de-DE', dOpt) + ' ' + t.toLocaleTimeString('de-DE', tOpt) : ''; };
  const zweit = d.zeitZweit ? new Date(d.zeitZweit) : new Date();
  const deW = n => Number(n).toLocaleString('de-DE');
  // Qualität als feste Felder: alle Felder der Kultur, fehlende Werte als "–"
  const qualitaet = d.ohneQualitaet ? [] : Object.entries(getQualitaetsfelder(d.fruchtart || '')).map(([key, o]) => {
    const w = d.qual ? d.qual[key] : null;
    return { label: o.label, wert: (w != null && w !== '') ? Number(w).toLocaleString('de-DE') : '–' };
  });
  lieferscheinDrucken({
    ls_nummer: d.nr || '',
    datum: zweit.toLocaleDateString('de-DE', dOpt),
    anschrift_label: 'Lieferant',
    partie: d.nr || '',
    empf_name: d.empfName || kontakt?.name || (istSchlag ? feld.betrieb : feld.name) || '',
    empf_zusatz: '',
    empf_strasse: adr.strasse, empf_plz_ort: adr.plzOrt, empf_land: '',
    artikel: bioPraefix(lieferscheinArtikelName(d.fruchtart || ''), istBio),
    kontrakt: d.einkaufskontrakt || '', herkunft: d.herkunft || kontakt?.herkunft || '', einheit: 't',
    menge: (netto/1000).toLocaleString('de-DE', {minimumFractionDigits:3, maximumFractionDigits:3}),
    brutto_kg: deW(d.voll), tara_kg: deW(d.leer), netto_kg: deW(netto),
    zeit_erstwiegung: dt(d.zeitErst),
    zeit_zweitwiegung: dt(zweit),
    waage_nr: '', spedition: '', kennzeichen: d.kennzeichen || '',
    // Bei eigener Ernte erscheint der Schlag nirgends auf dem Schein – nur der Betrieb.
    sonstige_angaben: 'Wareneingang · Anlieferung' + (!istSchlag && feld.name ? ' von ' + feld.name : ''),
    qualitaet,
    zertifikate,
  });
}

// Lieferschein/Wiegeschein zu einer gespeicherten Fuhre (nach)drucken – z.B. aus dem Fuhren-Tab.
export function fuhreLieferscheinDrucken(fId) {
  const f = state.fuhren.find(x => x.id === fId);
  if(!f) { showToast('⚠ Fuhre nicht gefunden', 'error'); return; }
  if(f.vollgewicht == null || f.leergewicht == null) { showToast('⚠ Gewichte fehlen – Druck erst nach dem Wiegen', 'error'); return; }
  druckeWareneingangLieferschein({
    feld: getFeld(f.feldId), fruchtart: f.fruchtart, voll: f.vollgewicht, leer: f.leergewicht,
    kennzeichen: f.kennzeichen, nr: f.nr, zeitZweit: f.zeit,
    qual: { feuchte: f.feuchte, protein: f.protein, gluten: f.gluten, hl: f.hlGewicht, oelgehalt: f.oelgehalt },
    einkaufskontrakt: f.einkaufskontrakt,
  });
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
  const istLieferant = d.feld.typ === 'lieferant';
  ov.innerHTML = `<div class="card" style="max-width:440px;width:100%;max-height:90vh;overflow:auto">
    <div class="card-header"><div>
      <div class="card-title">Fuhre prüfen &amp; speichern</div>
      <div class="card-sub">Bitte die Werte kontrollieren</div>
    </div></div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:4px 0 8px">
      ${row((d.feld.typ||'schlag')!=='schlag' ? 'Herkunft' : 'Schlag', escapeHtml(d.feld.name||'–'))}
      ${row('Fruchtart', escapeHtml(d.fruchtart||'–'))}
      ${artZeile}
      ${istLieferant && d.einkaufskontrakt ? row('Einkaufskontrakt', escapeHtml(d.einkaufskontrakt)) : ''}
      ${istLieferant && d.kennzeichen ? row('Kennzeichen', escapeHtml(d.kennzeichen)) : ''}
      ${d.abfName ? row('Abfahrer', escapeHtml(d.abfName)) : ''}
      ${row('Vollgewicht', d.v.toLocaleString('de-DE') + ' kg')}
      ${row('Leergewicht', d.l.toLocaleString('de-DE') + ' kg')}
      ${row('Netto', '<b>' + n.toLocaleString('de-DE') + ' kg</b> · ' + kg2t(n))}
      ${qHtml}
      ${row('Standort', standort)}
    </table>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer;margin:2px 0 8px">
      <input type="checkbox" id="we-conf-ls" ${istLieferant ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--gold);cursor:pointer">
      🖨 Lieferschein für den Fahrer drucken
    </label>
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

let _hzTarget = WID;
export function openHaengerzugWahl(targetWid) { _hzTarget = targetWid || WID; renderHaengerzugWahl(); }
export function closeHaengerzugWahl() { document.getElementById('we-hz-overlay')?.remove(); }

export function waehleHaengerzug(id) {
  const h = (state.haengerzuege || []).find(x => x.id === id);
  const inp = document.getElementById('leer-' + _hzTarget);
  if(h && inp) {
    inp.value = h.leergewicht_kg.toLocaleString('de-DE');
    if(window.updNetto) window.updNetto(_hzTarget);
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
