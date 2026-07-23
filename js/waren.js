import { state } from './state.js?v=68';
import { db } from './db.js?v=68';
import { showToast, escapeHtml, getFeld, getUser, netto, kontaktAnschriftZeile } from './helpers.js?v=68';
import { getSiloBestand, getSiloKultur, lagerLabel } from './silo.js?v=68';
import { parseGewicht, fmtGewicht } from './abfahrer.js?v=68';

export function warenausgangsDialog(preGewichtKg) {
  const silosAlle = state.silos.sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
  const siloOpts = silosAlle.map(s => {
    const bT = (getSiloBestand(s.id)/1000).toFixed(1);
    const kultur = getSiloKultur(s.id) || '–';
    return `<option value="${s.id}">Silo ${s.id} · ${kultur} · ${bT} t Bestand</option>`;
  }).join('');
  const artOpts = state.artikel.filter(a=>a.aktiv).map(a=>
    `<option value="${a.id}">${escapeHtml(a.name)} (${a.einheit})</option>`).join('');
  const kontraktOpts = state.kontrakte.filter(k=>k.status==='aktiv').map(k=>{
    const kt = state.kontakte.find(c=>c.id===k.kontakt_id);
    return `<option value="${k.id}">${escapeHtml(k.nummer)}${kt?' · '+escapeHtml(kt.name):''}</option>`;
  }).join('');

  const m = document.createElement('div');
  m.id = 'wb-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  m.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);padding:24px;width:100%;max-width:460px;box-shadow:var(--shadow)">
      <div style="font-family:var(--serif);font-size:18px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--amber);margin-bottom:20px">↑ Warenausgang</div>
      <div class="form-group">
        <label>Kontrakt *</label>
        <select id="wb-kontrakt" onchange="wbKontraktWahl('aus')">
          <option value="">– Kontrakt wählen –</option>${kontraktOpts}
        </select>
      </div>
      <div class="form-group">
        <label>Silo *</label>
        <select id="wb-silo" onchange="wbSiloInfo()">
          <option value="">– Silo wählen –</option>${siloOpts}
        </select>
      </div>
      <div id="wb-bestand-info" style="font-size:11px;color:var(--gold);letter-spacing:1px;margin:-8px 0 12px;display:none"></div>
      <div class="form-group">
        <label>Artikel *</label>
        <select id="wb-artikel"><option value="">– wählen –</option>${artOpts}</select>
      </div>
      <div class="form-group">
        <label>Menge (t) *</label>
        <input type="number" id="wb-menge" min="0.001" step="0.001" placeholder="z.B. 50.000"
          value="${preGewichtKg ? (preGewichtKg/1000).toFixed(3) : ''}">
      </div>
      <div class="form-group">
        <label>Empfänger</label>
        <input type="text" id="wb-empfaenger" placeholder="z.B. RWA Magdeburg">
      </div>
      <div class="form-group">
        <label>Beleg-Nr.</label>
        <input type="text" id="wb-beleg" placeholder="z.B. LS-2026-001">
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="wb-bio" style="width:18px;height:18px;accent-color:var(--gold)">
        <label style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--gold);margin:0">Bio-Ware</label>
      </div>
      <div class="form-group">
        <label>Notiz</label>
        <input type="text" id="wb-notiz">
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-amber" style="flex:1" onclick="wbSpeichern('ausgang')">Ausgang buchen</button>
        <button class="btn btn-outline" onclick="document.getElementById('wb-modal').remove()">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(m);
}

export function wareneingangsDialog() {
  const artOpts = state.artikel.filter(a=>a.aktiv).map(a=>
    `<option value="${a.id}">${escapeHtml(a.name)} (${a.einheit})</option>`).join('');
  const kontaktOpts = state.kontakte.filter(k=>k.aktiv).map(k=>
    `<option value="${k.id}">${escapeHtml(k.name)}</option>`).join('');

  const m = document.createElement('div');
  m.id = 'wb-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  m.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);padding:24px;width:100%;max-width:460px;box-shadow:var(--shadow)">
      <div style="font-family:var(--serif);font-size:18px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--gold);margin-bottom:20px">↓ Wareneingang</div>
      <div class="form-group">
        <label>Artikel *</label>
        <select id="wb-artikel"><option value="">– wählen –</option>${artOpts}</select>
      </div>
      <div class="form-group">
        <label>Menge (t) *</label>
        <input type="number" id="wb-menge" min="0.001" step="0.001" placeholder="z.B. 50.000">
      </div>
      <div class="form-group">
        <label>Lieferant</label>
        <select id="wb-kontakt">
          <option value="">– kein Kontakt –</option>${kontaktOpts}
        </select>
      </div>
      <div class="form-group">
        <label>Beleg-Nr.</label>
        <input type="text" id="wb-beleg" placeholder="z.B. RE-2026-001">
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="wb-bio" style="width:18px;height:18px;accent-color:var(--gold)">
        <label style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--gold);margin:0">Bio-Ware</label>
      </div>
      <div class="form-group">
        <label>Notiz</label>
        <input type="text" id="wb-notiz">
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-green" style="flex:1" onclick="wbSpeichern('eingang')">Eingang buchen</button>
        <button class="btn btn-outline" onclick="document.getElementById('wb-modal').remove()">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(m);
}

export function wbSiloInfo() {
  const siloId = document.getElementById('wb-silo')?.value;
  const info   = document.getElementById('wb-bestand-info');
  if(!siloId || !info) return;
  const bT     = (getSiloBestand(siloId)/1000).toFixed(2);
  const kultur = getSiloKultur(siloId) || '–';
  info.style.display = 'block';
  info.textContent   = `Bestand Silo ${siloId}: ${bT} t · ${kultur}`;
  const artSel = document.getElementById('wb-artikel');
  if(artSel && artSel.value === '') {
    const match = state.artikel.find(a=>a.aktiv && kultur && a.name.toLowerCase().includes(kultur.split(' ')[0].toLowerCase()));
    if(match) artSel.value = match.id;
  }
}

export function wbKontraktWahl() {
  const kontraktId = parseInt(document.getElementById('wb-kontrakt')?.value);
  if(!kontraktId) return;
  const k  = state.kontrakte.find(x=>x.id===kontraktId);
  if(!k) return;
  const kt = state.kontakte.find(c=>c.id===k.kontakt_id);
  const empfEl = document.getElementById('wb-empfaenger');
  if(empfEl && kt && !empfEl.value) empfEl.value = kt.name;
  if(k.artikel_id) { const el = document.getElementById('wb-artikel'); if(el) el.value = k.artikel_id; }
  if(k.bio) document.getElementById('wb-bio').checked = true;
}

export async function wbSpeichern(typ) {
  const artikelId  = parseInt(document.getElementById('wb-artikel')?.value);
  const mengeT     = parseFloat(document.getElementById('wb-menge')?.value);
  const bio        = document.getElementById('wb-bio')?.checked || false;
  const belegNr    = document.getElementById('wb-beleg')?.value.trim();
  const notiz      = document.getElementById('wb-notiz')?.value.trim();

  if(!artikelId || isNaN(mengeT) || mengeT <= 0) {
    showToast('⚠ Bitte Artikel und Menge angeben','error'); return;
  }

  let siloId = null, kontraktId = null, empfaenger = '';

  if(typ === 'ausgang') {
    siloId      = document.getElementById('wb-silo')?.value;
    kontraktId  = parseInt(document.getElementById('wb-kontrakt')?.value) || null;
    empfaenger  = document.getElementById('wb-empfaenger')?.value.trim();
    if(!siloId)     { showToast('⚠ Bitte Silo wählen','error'); return; }
    if(!kontraktId) { showToast('⚠ Bitte Kontrakt wählen','error'); return; }
    const bestandKg = getSiloBestand(siloId);
    if(mengeT*1000 > bestandKg + 0.01) {
      showToast('⚠ Menge überschreitet Silo-Bestand von '+(bestandKg/1000).toFixed(2)+' t','error'); return;
    }
  } else {
    const kontaktId = parseInt(document.getElementById('wb-kontakt')?.value) || null;
    const kt = kontaktId ? state.kontakte.find(c=>c.id===kontaktId) : null;
    empfaenger = kt ? kt.name : '';
  }

  const bewegung = { typ, artikelId, siloVonId: siloId, mengeKg: mengeT*1000,
    empfaenger, belegNr, bio, kontraktId, notiz, erstelltVon: state.currentUser?.id||null };
  try {
    const saved = await db.insertWarenbewegung(bewegung);
    state.warenbewegungen.unshift(saved);
    document.getElementById('wb-modal')?.remove();
    showToast('✓ '+mengeT.toFixed(3)+' t als '+typ+' gebucht');
    if(window.adminTab==='warenausgang') renderWarenausgang();
    if(window.renderSiloManagement) window.renderSiloManagement();
  } catch(e) { showToast('⚠ '+e.message,'error'); }
}

export function auslagernDialog(preSiloId) { warenausgangsDialog(); }

export async function deleteWarenbewegung(id) {
  if(!confirm('Warenbewegung wirklich löschen?')) return;
  try {
    await db.deleteWarenbewegung(id);
    state.warenbewegungen = state.warenbewegungen.filter(w=>w.id!==id);
    if(window.adminTab === 'warenausgang') renderWarenausgang();
    showToast('✓ Bewegung gelöscht');
  } catch(e) { showToast('⚠ '+e.message,'error'); }
}

export function waageWidgetHTML(targetField) {
  const w = state.waageLive;
  const isOnline  = w && w.status !== 'offline';
  const isStable  = w && w.status === 'stable';
  const isUnstable= w && w.status === 'unstable';
  const dotColor  = isStable ? 'var(--green2)' : isUnstable ? 'var(--amber)' : 'var(--text3)';
  const dotChar   = isStable ? '●' : isUnstable ? '◉' : '○';
  const gewichtStr= isOnline ? Math.round(w.gewicht_kg).toLocaleString('de-DE')+' kg' : '–';
  const label     = isStable ? 'STABIL' : isUnstable ? 'IN BEWEGUNG' : 'NICHT VERBUNDEN';
  const btnStyle  = isStable
    ? 'background:var(--green);color:#fff;border:none;cursor:pointer'
    : 'background:var(--bg3);color:var(--text3);border:1px solid var(--border2);cursor:not-allowed';
  return `<div id="waage-live-widget-${targetField}" style="display:flex;align-items:center;gap:10px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;padding:8px 12px;margin:-6px 0 12px;font-family:var(--mono)">
    <span style="color:${dotColor};font-size:14px">${dotChar}</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:700;color:var(--text)">${gewichtStr}</div>
      <div style="font-size:9px;letter-spacing:1.5px;color:${dotColor}">${label}</div>
    </div>
    <button class="btn btn-sm" style="${btnStyle};padding:6px 12px;font-size:11px;border-radius:6px;letter-spacing:1px"
      onclick="gewichtUebernehmen('${targetField}')" ${isStable?'':'disabled'}>
      ↕ ÜBERNEHMEN
    </button>
  </div>`;
}

export function updateWaageWidget() {
  ['leer','voll'].forEach(field => {
    const el = document.getElementById('waage-live-widget-'+field);
    if(el) el.outerHTML = waageWidgetHTML(field);
  });
  document.querySelectorAll('[id^="waage-fuhre-widget-"]').forEach(el => {
    const fuhreId = parseInt(el.id.replace('waage-fuhre-widget-',''));
    if(fuhreId) el.outerHTML = waageFuhreWidgetHTML(fuhreId);
  });
}

export function renderWaageBar() {
  const el = document.getElementById('waage-bar');
  if(!el) return;
  const w = state.waageLive;
  const isOnline  = w && w.status !== 'offline';
  const isStable  = w && w.status === 'stable';
  const dotColor  = isStable ? 'var(--green2)' : isOnline ? 'var(--amber)' : 'var(--text3)';
  const dotChar   = isStable ? '●' : isOnline ? '◉' : '○';
  const gewichtStr= isOnline ? Math.round(w.gewicht_kg).toLocaleString('de-DE')+' kg' : 'nicht verbunden';
  const label     = isStable ? 'Stabil' : isOnline ? 'In Bewegung' : 'Waage offline';

  if(isStable) {
    el.innerHTML = `<span style="color:${dotColor}">${dotChar}</span>`
      + ` <span style="color:var(--text);font-weight:700">${gewichtStr}</span>`
      + ` <span style="color:var(--text3);font-size:10px;letter-spacing:1px">${label}</span>`
      + ` <button class="btn btn-sm btn-green" style="margin-left:8px;padding:5px 12px;font-size:11px" onclick="warenausgangsDialog(${Math.round(w.gewicht_kg)})">↕ Übernehmen</button>`;
  } else {
    el.innerHTML = `<span style="color:${dotColor}">${dotChar}</span>`
      + ` <span style="color:var(--text3)">${gewichtStr}</span>`
      + ` <span style="color:var(--text3);font-size:10px;letter-spacing:1px">${label}</span>`
      + (isOnline ? '' : ` <button class="btn btn-sm btn-outline" style="margin-left:8px;padding:5px 12px;font-size:11px" onclick="warenausgangsDialog()">Manuelle Eingabe</button>`);
  }
}

export function gewichtUebernehmen(targetId) {
  if(!state.waageLive || state.waageLive.status !== 'stable') return;
  const inputId = targetId === 'leer' ? 'l-leer' : targetId === 'voll' ? 'l-voll' : targetId;
  const el = document.getElementById(inputId);
  if(el) {
    el.value = Math.round(state.waageLive.gewicht_kg).toLocaleString('de-DE');
    if(window.fmtGewicht) window.fmtGewicht(el);
    el.dispatchEvent(new Event('input'));
  }
  try { if(window.updNetto) window.updNetto('lief'); } catch(e) {}
}

// felder: 'beide' (Standard) | 'voll' | 'leer' – beim zweistufigen Warenausgang
// gibt es je Schritt nur ein Gewichtsfeld, dann wäre der zweite Knopf ohne Ziel.
export function waageFuhreWidgetHTML(fuhreId, felder = 'beide') {
  const w = state.waageLive;
  const isStable   = w && w.status === 'stable';
  const isUnstable = w && w.status === 'unstable';
  const isOnline   = w && w.status !== 'offline';
  const dotColor   = isStable ? 'var(--green2)' : isUnstable ? 'var(--amber)' : 'var(--text3)';
  const dotChar    = isStable ? '●' : isUnstable ? '◉' : '○';
  const gewichtStr = isOnline ? Math.round(w.gewicht_kg).toLocaleString('de-DE')+' kg' : 'nicht verbunden';
  const label      = isStable ? 'STABIL' : isUnstable ? 'IN BEWEGUNG' : 'OFFLINE';
  const btnStyle   = isStable
    ? 'background:var(--green);color:#fff;border:none;cursor:pointer;border-radius:6px;padding:6px 10px;font-size:11px;font-weight:700;letter-spacing:1px'
    : 'background:var(--bg3);color:var(--text3);border:1px solid var(--border2);cursor:not-allowed;border-radius:6px;padding:6px 10px;font-size:11px';
  return `<div id="waage-fuhre-widget-${fuhreId}" style="display:flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;padding:8px 12px;margin-bottom:12px;font-family:var(--mono);flex-wrap:wrap">
    <span style="color:${dotColor}">${dotChar}</span>
    <span style="font-size:13px;font-weight:700;color:var(--text);flex:1">${gewichtStr}</span>
    <span style="font-size:9px;letter-spacing:1.5px;color:${dotColor}">${label}</span>
    ${felder !== 'leer' ? `<button style="${btnStyle}" onclick="gewichtUebernehmen('voll-${fuhreId}')" ${isStable?'':'disabled'}>→ ${felder==='voll'?'ÜBERNEHMEN':'VOLLGEWICHT'}</button>` : ''}
    ${felder !== 'voll' ? `<button style="${btnStyle}" onclick="gewichtUebernehmen('leer-${fuhreId}')" ${isStable?'':'disabled'}>→ ${felder==='leer'?'ÜBERNEHMEN':'LEERGEWICHT'}</button>` : ''}
  </div>`;
}

export function renderWarenausgang() {
  // Reinigungsabgänge sind interne Umbuchungen (Reduktion des Ziel-Silos, dem ein
  // Reinigungsabgang-Fuhre gegenübersteht) – nicht als Warenausgang listen.
  const alle    = state.warenbewegungen
    .filter(w => !(w.notiz||'').startsWith('Reinigungsabgang'))
    .sort((a,b)=>new Date(b.erstellt_am)-new Date(a.erstellt_am));
  const ausgaenge = alle.filter(w=>w.typ==='ausgang');
  const eingaenge = alle.filter(w=>w.typ==='eingang');
  const ausT = ausgaenge.reduce((s,w)=>s+(w.menge_kg||0),0)/1000;
  const einT = eingaenge.reduce((s,w)=>s+(w.menge_kg||0),0)/1000;

  const bRow = (w) => {
    const isAus = w.typ === 'ausgang';
    const art   = state.artikel.find(a=>a.id===w.artikel_id);
    const kontr = state.kontrakte.find(k=>k.id===w.kontrakt_id);
    const mT    = ((w.menge_kg||0)/1000).toFixed(3);
    const datum = new Date(w.erstellt_am).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'2-digit'});
    const pfeil = isAus ? '↑' : '↓';
    const farbe = isAus ? 'var(--amber)' : 'var(--green2)';
    const bordFarbe = isAus ? 'var(--amber)' : 'var(--green)';
    return '<div class="card" style="margin-bottom:6px;border-left:3px solid '+bordFarbe+'">'
      +'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">'
      +'<div style="flex:1;min-width:0">'
      +'<div style="font-size:12px;font-weight:700;letter-spacing:1px;color:'+farbe+';text-transform:uppercase">'
      +pfeil+' '+(isAus?'Ausgang':'Eingang')+(w.silo_von_id?' · '+lagerLabel(w.silo_von_id):'')+(w.bio?' · <span style="color:var(--gold)">BIO</span>':'')+'</div>'
      +'<div style="font-size:13px;font-weight:600;color:var(--text);margin-top:2px">'+(art?escapeHtml(art.name):'–')+'</div>'
      +(kontr?'<div style="font-size:11px;color:var(--gold);margin-top:1px">Kontrakt '+escapeHtml(kontr.nummer)+'</div>':'')
      +'<div style="font-size:11px;color:var(--text3);margin-top:1px">'
      +(w.empfaenger?escapeHtml(w.empfaenger):'')+(w.beleg_nr?' · '+escapeHtml(w.beleg_nr):'')
      +(w.notiz?' · '+escapeHtml(w.notiz):'')+'</div>'
      +'</div>'
      +'<div style="text-align:right;flex-shrink:0">'
      +'<div style="font-size:16px;font-weight:700;color:'+farbe+'">'+mT+' t</div>'
      +'<div style="font-size:10px;color:var(--text3)">'+datum+'</div>'
      +(w.lieferschein_nr?'<div style="font-size:10px;color:var(--text3)">LS '+escapeHtml(w.lieferschein_nr)+'</div>':'')
      +'<div style="display:flex;gap:4px;justify-content:flex-end;margin-top:4px">'
      +(isAus?'<button class="btn btn-sm" style="background:none;border:1px solid var(--border2);color:var(--text2);padding:3px 8px" title="Lieferschein drucken" onclick="lieferscheinDialog('+w.id+')">🖨</button>':'')
      +'<button class="btn btn-sm" style="background:none;border:1px solid var(--border2);color:var(--red);padding:3px 8px" onclick="deleteWarenbewegung('+w.id+')">✕</button>'
      +'</div>'
      +'</div></div></div>';
  };

  document.getElementById('admintab').innerHTML = ''
    +'<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">'
    +'<div class="stat-box"><div class="stat-val" style="font-size:20px;color:var(--gold)">'+einT.toFixed(1)+'</div><div class="stat-label">t Eingang</div></div>'
    +'<div class="stat-box"><div class="stat-val" style="font-size:20px;color:var(--amber)">'+ausT.toFixed(1)+'</div><div class="stat-label">t Ausgang</div></div>'
    +'<div class="stat-box"><div class="stat-val" style="font-size:20px;color:var(--text)">'+(einT-ausT).toFixed(1)+'</div><div class="stat-label">t Saldo</div></div>'
    +'</div>'
    +'<div id="waage-bar" style="display:flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-family:var(--mono);font-size:12px;flex-wrap:wrap"></div>'
    +'<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">'
    +'<button class="btn btn-green" onclick="wareneingangsDialog()">↓ Wareneingang</button>'
    +'<button class="btn btn-amber" onclick="warenausgangsDialog()">↑ Warenausgang</button>'
    +'</div>'
    +(alle.length ? alle.map(bRow).join('') : '<div class="empty-state" style="padding:20px">Noch keine Warenbewegungen erfasst.</div>');
  renderWaageBar();
}

// ─── LIEFERUNGEN ───

export function neueLieferungDialog() {
  const fas = [...new Set(state.felder.map(f=>f.fruchtart))].sort();
  const faOpts = fas.map(fa=>'<option value="'+fa+'">'+fa+'</option>').join('');
  const kontraktOpts = state.kontrakte.filter(k=>k.status==='aktiv').map(k => {
    const kt = state.kontakte.find(c=>c.id===k.kontakt_id);
    return `<option value="${k.id}">${k.nummer}${kt?' · '+kt.name:''}${k.fruchtart_text?' · '+k.fruchtart_text:''}</option>`;
  }).join('');
  const m = document.createElement('div');
  m.id = 'liefer-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  m.innerHTML = '<div style="background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);padding:24px;width:100%;max-width:480px;box-shadow:var(--shadow);max-height:90vh;overflow-y:auto">'
    +'<div style="font-family:var(--serif);font-size:20px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text);margin-bottom:16px">🚛 Neue Lieferung (Waage)</div>'
    +'<div class="form-group"><label>Kontrakt</label>'
    +'<select id="l-kontrakt-id" onchange="lieferungKontraktWahl()"><option value="">– kein Kontrakt –</option>'+kontraktOpts+'</select></div>'
    +'<div class="form-group"><label>Käufer / Empfänger *</label><input type="text" id="l-kaeufer" placeholder="z.B. RWA Magdeburg"></div>'
    +'<div class="form-group"><label>Adresse Käufer</label><input type="text" id="l-adresse" placeholder="Straße, PLZ Ort"></div>'
    +'<div class="form-group"><label>Fruchtart *</label><select id="l-fruchtart"><option value="">– wählen –</option>'+faOpts+'</select></div>'
    +'<div class="form-group"><label>Kennzeichen LKW</label><input type="text" id="l-kz" placeholder="z.B. HAL-XX 123"></div>'
    +'<div class="form-group"><label>Spedition</label><input type="text" id="l-spedition"></div>'
    +'<div class="form-group" style="display:flex;align-items:center;gap:10px">'
    +'<input type="checkbox" id="l-bio" style="width:18px;height:18px;accent-color:var(--gold)">'
    +'<label style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--gold);margin:0">Bio-Ware</label></div>'
    +'<div class="form-group"><label>Leergewicht (kg) *</label><input type="text" inputmode="numeric" id="l-leer" placeholder="14.500" oninput="fmtGewicht(this)"></div>'
    +waageWidgetHTML('leer')
    +'<div class="form-group"><label>Notiz</label><input type="text" id="l-notiz"></div>'
    +'<div style="display:flex;gap:8px;margin-top:8px">'
    +'<button class="btn btn-primary" style="flex:1" onclick="lieferungSpeichern()">Lieferung anlegen</button>'
    +'<button class="btn btn-outline" onclick="document.getElementById(\'liefer-modal\').remove()">Abbrechen</button>'
    +'</div></div>';
  document.body.appendChild(m);
}

export function lieferungKontraktWahl() {
  const id = parseInt(document.getElementById('l-kontrakt-id')?.value);
  if(!id) return;
  const k = state.kontrakte.find(x=>x.id===id);
  if(!k) return;
  const kt = state.kontakte.find(c=>c.id===k.kontakt_id);
  const kaeuferEl = document.getElementById('l-kaeufer');
  if(kaeuferEl && kt && !kaeuferEl.value) kaeuferEl.value = kt.name;
  const adrEl = document.getElementById('l-adresse');
  if(adrEl && kt && !adrEl.value) adrEl.value = kontaktAnschriftZeile(kt);
  const fruchtEl = document.getElementById('l-fruchtart');
  if(fruchtEl && k.fruchtart_text) fruchtEl.value = k.fruchtart_text;
  if(k.bio) document.getElementById('l-bio').checked = true;
}

export async function lieferungSpeichern() {
  const kaeufer = document.getElementById('l-kaeufer').value.trim();
  const fruchtart = document.getElementById('l-fruchtart').value;
  const leer = parseGewicht(document.getElementById('l-leer').value);
  const kontraktId = parseInt(document.getElementById('l-kontrakt-id')?.value) || null;
  const bio = document.getElementById('l-bio')?.checked || false;
  if(!kaeufer||!fruchtart||!leer){alert('Bitte Käufer, Fruchtart und Leergewicht eingeben.');return;}
  const nr = 'L-'+String(state.nextLieferNr).padStart(3,'0');
  state.nextLieferNr++;
  const obj = {
    nr, fruchtart, leergewicht:leer,
    kaeufer_name:kaeufer,
    kaeufer_adresse:document.getElementById('l-adresse').value.trim()||null,
    kennzeichen:document.getElementById('l-kz').value.trim()||null,
    spedition:document.getElementById('l-spedition').value.trim()||null,
    kontrakt: kontraktId ? state.kontrakte.find(k=>k.id===kontraktId)?.nummer||null : null,
    kontrakt_id: kontraktId,
    bio,
    notiz:document.getElementById('l-notiz').value.trim()||null,
    status:'offen', erstellt_von:state.currentUser.id
  };
  document.getElementById('liefer-modal').remove();
  try {
    const saved = await db.insertLieferung(obj);
    state.lieferungen.unshift(saved);
    showToast('✓ Lieferung '+nr+' angelegt');
    renderWarenausgang();
  } catch(e) { showToast('⚠ '+e.message,'error'); state.nextLieferNr--; }
}

export function lieferungAbschliessen(id) {
  const l = state.lieferungen.find(x=>x.id===id);
  if(!l) return;
  const leerStr = l.leergewicht?l.leergewicht.toLocaleString('de-DE'):'–';
  const m = document.createElement('div');
  m.id = 'voll-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = '<div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-xl);padding:24px;width:100%;max-width:400px;box-shadow:var(--shadow-lg)">'
    +'<div style="font-family:var(--font-display);font-size:18px;color:var(--color-text);margin-bottom:4px">⚖ Vollgewicht eingeben</div>'
    +'<div style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:16px">'+l.nr+' · '+l.kaeufer_name+' · '+l.fruchtart+'</div>'
    +'<div style="background:var(--color-surface);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;text-align:center">'
    +'<div style="font-size:11px;color:var(--text2);margin-bottom:4px">Leergewicht</div>'
    +'<div style="font-size:22px;font-weight:700;color:var(--text)">'+leerStr+' kg</div></div>'
    +'<div class="form-group"><label>Vollgewicht (kg) *</label>'
    +'<input type="text" inputmode="numeric" id="l-voll" placeholder="38.500" style="font-size:20px;font-weight:700"'
    +' oninput="fmtGewicht(this);(()=>{const v=parseGewicht(this.value);const el=document.getElementById(\'liefer-netto-val\');if(!el)return;if(v&&'+l.leergewicht+'&&v>'+l.leergewicht+'){el.textContent=((v-'+l.leergewicht+')/1000).toFixed(2)+\' t\';el.style.color=\'var(--green2)\'}else{el.textContent=\'–\';el.style.color=\'var(--text3)\'}})()"></div>'
    +waageWidgetHTML('voll')
    +'<div style="background:var(--neutral-200);border-radius:var(--radius-sm);padding:12px;text-align:center;margin-bottom:16px">'
    +'<div style="font-size:11px;color:var(--text2)">Netto</div>'
    +'<div id="liefer-netto-val" style="font-size:26px;font-weight:700;color:var(--text2)">–</div></div>'
    +'<div style="display:flex;gap:8px">'
    +'<button class="btn btn-primary" style="flex:1" onclick="lieferungAbschliessenSpeichern('+id+')">✓ Abschließen</button>'
    +'<button class="btn btn-outline" onclick="document.getElementById(\'voll-modal\').remove()">Abbrechen</button>'
    +'</div></div>';
  document.body.appendChild(m);
}

export async function lieferungAbschliessenSpeichern(id) {
  const l = state.lieferungen.find(x=>x.id===id);
  if(!l) return;
  const voll = parseGewicht(document.getElementById('l-voll')?.value);
  if(!voll||!l.leergewicht||voll<=l.leergewicht){alert('Bitte gültiges Vollgewicht eingeben (> Leergewicht).');return;}
  l.vollgewicht=voll; l.status='abgeschlossen';
  document.getElementById('voll-modal')?.remove();
  renderWarenausgang();
  try {
    await db.updateLieferung(id,{vollgewicht:voll,status:'abgeschlossen'});
    showToast('✓ '+l.nr+' abgeschlossen · Netto: '+((voll-l.leergewicht)/1000).toFixed(2)+' t');
  } catch(e) { showToast('⚠ '+e.message,'error'); l.vollgewicht=null; l.status='offen'; renderWarenausgang(); }
}
