import { state } from './state.js?v=66';
import { db } from './db.js?v=66';
import { showToast } from './helpers.js?v=66';
import { isBioFeld, bioBadge } from './bio.js?v=66';

let schlagFilter = 'alle';
let schlagSearch = '';

export function renderAdminSchlaege() {
  const aktiv = state.felder.filter(f=>f.status==='aktiv').length;
  const abg = state.felder.filter(f=>f.status==='abgeerntet').length;
  const inaktiv = state.felder.filter(f=>f.status==='inaktiv').length;

  let felder = state.felder;
  if(schlagFilter==='aktiv') felder=felder.filter(f=>f.status==='aktiv');
  else if(schlagFilter==='inaktiv') felder=felder.filter(f=>f.status==='inaktiv');
  else if(schlagFilter==='abgeerntet') felder=felder.filter(f=>f.status==='abgeerntet');
  if(schlagSearch) felder=felder.filter(f=>f.name.toLowerCase().includes(schlagSearch.toLowerCase())||f.fruchtart.toLowerCase().includes(schlagSearch.toLowerCase()));

  const items = felder.map(f=>{
    const btnAktivieren = f.status==='inaktiv'
      ? `<button class="btn btn-sm btn-amber" onclick="schlagSetStatus(${f.id},'aktiv')">Aktivieren</button>` : '';
    const btnFertig = f.status==='aktiv'
      ? `<button class="btn btn-sm btn-outline" onclick="schlagSetStatus(${f.id},'abgeerntet')">&#10003; Fertig</button>` : '';
    const btnReset = f.status==='abgeerntet'
      ? `<button class="btn btn-sm btn-red" onclick="schlagSetStatus(${f.id},'inaktiv')">&#8635;</button>` : '';
    const statusBadge = f.status==='aktiv'
      ? '<span class="badge badge-aktiv">AKTIV</span>'
      : f.status==='abgeerntet'
      ? '<span class="badge badge-abgeerntet">FERTIG</span>'
      : '<span class="badge badge-inaktiv">INAKTIV</span>';
    const isBio = isBioFeld(f.id);
    const verms = state.vermehrungen.filter(v => v.feld_id === f.id);
    const vermBadge = verms.length
      ? `<span style="display:inline-block;background:var(--color-info-wash);color:var(--color-info);font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px;letter-spacing:0.5px;vertical-align:middle;margin-left:4px">🌱 ${verms.map(v=>v.sorte).join(', ')}</span>`
      : '';
    return `<div class="schlag-item ${f.status}" style="${isBio?'border-left:3px solid var(--color-success)':''}">
      <div class="schlag-info">
        <div class="schlag-name">${f.name}${isBio?bioBadge(true):''}${vermBadge}</div>
        <div class="schlag-detail">${(f.typ||'schlag')!=='schlag' ? (f.typ==='umlagerung'?'🔄 Umlagerung zwischen Lagern – Fruchtart je Fuhre wählbar':'🚚 Zukauf-Quelle (Lieferant) – Fruchtart je Fuhre wählbar') : `${f.fruchtart} · ${f.flaeche} ha${f.betrieb?' · '+f.betrieb:''}`}</div>
      </div>
      ${statusBadge}
      <div class="schlag-actions">${btnAktivieren}${btnFertig}${btnReset}</div>
    </div>`;
  }).join('');

  if(!document.getElementById('schlag-stats')) {
    document.getElementById('admintab').innerHTML=`
      <div id="schlag-stats" class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
        <div class="stat-box"><div class="stat-val" style="font-size:22px;color:var(--text)" id="s-aktiv"></div><div class="stat-label">Aktiv</div></div>
        <div class="stat-box"><div class="stat-val" style="font-size:22px;color:var(--color-warning)" id="s-pausiert"></div><div class="stat-label">Pausiert</div></div>
        <div class="stat-box"><div class="stat-val" style="font-size:22px;color:var(--green)" id="s-abg"></div><div class="stat-label">Abgeerntet</div></div>
        <div class="stat-box"><div class="stat-val" style="font-size:22px;color:var(--text2)" id="s-inaktiv"></div><div class="stat-label">Inaktiv</div></div>
      </div>
      <input type="text" id="schlag-search-input" class="search-input" placeholder="Suche nach Schlag oder Fruchtart…"
        oninput="schlagSearchInput(this.value)">
      <div id="schlag-filter-bar" class="filter-bar"></div>
      <div id="schlag-liste"></div>`;
  }
  renderAdminSchlaegeListe();
}

export function schlagSearchInput(val) {
  schlagSearch = val;
  renderAdminSchlaegeListe();
}

// Filter umschalten (Alle/Aktiv/Inaktiv/Abgeerntet). Muss exportiert + auf window
// registriert sein, da die Filter-Buttons per onclick im globalen Scope laufen.
export function setSchlagFilter(filter) {
  schlagFilter = filter;
  renderAdminSchlaegeListe();
}

function renderAdminSchlaegeListe() {
  const aktiv = state.felder.filter(f=>f.status==='aktiv').length;
  const abg = state.felder.filter(f=>f.status==='abgeerntet').length;
  const inaktiv = state.felder.filter(f=>f.status==='inaktiv').length;
  const pausiert = state.felder.filter(f=>f.status==='pausiert').length;

  let felder = state.felder;
  if(schlagFilter==='aktiv') felder=felder.filter(f=>f.status==='aktiv');
  else if(schlagFilter==='inaktiv') felder=felder.filter(f=>f.status==='inaktiv');
  else if(schlagFilter==='abgeerntet') felder=felder.filter(f=>f.status==='abgeerntet');
  else if(schlagFilter==='pausiert') felder=felder.filter(f=>f.status==='pausiert');
  if(schlagSearch) felder=felder.filter(f=>f.name.toLowerCase().includes(schlagSearch.toLowerCase())||f.fruchtart.toLowerCase().includes(schlagSearch.toLowerCase()));

  const items = felder.map(f=>{
    const btnAktivieren = f.status==='inaktiv'
      ? `<button class="btn btn-sm btn-amber" onclick="schlagSetStatus(${f.id},'aktiv')">Aktivieren</button>` : '';
    // Pausieren: Ernte unterbrochen, Schlag gilt NICHT als fertig (jederzeit fortsetzbar)
    const btnPause = f.status==='aktiv'
      ? `<button class="btn btn-sm btn-outline" title="Ernte unterbrechen – Schlag bleibt offen" onclick="schlagSetStatus(${f.id},'pausiert')">&#9208; Pause</button>` : '';
    const btnFortsetzen = f.status==='pausiert'
      ? `<button class="btn btn-sm btn-amber" onclick="schlagSetStatus(${f.id},'aktiv')">&#9654; Fortsetzen</button>` : '';
    const btnFertig = (f.status==='aktiv' || f.status==='pausiert')
      ? `<button class="btn btn-sm btn-outline" onclick="schlagSetStatus(${f.id},'abgeerntet')">&#10003; Fertig</button>` : '';
    const btnReset = f.status==='abgeerntet'
      ? `<button class="btn btn-sm btn-red" onclick="schlagSetStatus(${f.id},'inaktiv')">&#8635;</button>` : '';
    const statusBadge = f.status==='aktiv'
      ? '<span class="badge badge-aktiv">AKTIV</span>'
      : f.status==='pausiert'
      ? '<span class="badge badge-pausiert">&#9208; PAUSIERT</span>'
      : f.status==='abgeerntet'
      ? '<span class="badge badge-abgeerntet">FERTIG</span>'
      : '<span class="badge badge-inaktiv">INAKTIV</span>';
    const isBio = isBioFeld(f.id);
    const verms = state.vermehrungen.filter(v => v.feld_id === f.id);
    const vermBadge = verms.length
      ? `<span style="display:inline-block;background:var(--color-info-wash);color:var(--color-info);font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px;letter-spacing:0.5px;vertical-align:middle;margin-left:4px">🌱 ${verms.map(v=>v.sorte).join(', ')}</span>`
      : '';
    return `<div class="schlag-item ${f.status}" style="${isBio?'border-left:3px solid var(--color-success)':''}">
      <div class="schlag-info">
        <div class="schlag-name">${f.name}${isBio?bioBadge(true):''}${vermBadge}</div>
        <div class="schlag-detail">${(f.typ||'schlag')!=='schlag' ? (f.typ==='umlagerung'?'🔄 Umlagerung zwischen Lagern – Fruchtart je Fuhre wählbar':'🚚 Zukauf-Quelle (Lieferant) – Fruchtart je Fuhre wählbar') : `${f.fruchtart} · ${f.flaeche} ha${f.betrieb?' · '+f.betrieb:''}`}</div>
      </div>
      ${statusBadge}
      <div class="schlag-actions">${btnAktivieren}${btnFortsetzen}${btnPause}${btnFertig}${btnReset}</div>
    </div>`;
  }).join('');

  const sAktiv = document.getElementById('s-aktiv');
  const sAbg = document.getElementById('s-abg');
  const sInaktiv = document.getElementById('s-inaktiv');
  const sPausiert = document.getElementById('s-pausiert');
  if(sAktiv) sAktiv.textContent = aktiv;
  if(sAbg) sAbg.textContent = abg;
  if(sInaktiv) sInaktiv.textContent = inaktiv;
  if(sPausiert) sPausiert.textContent = pausiert;

  const fb = document.getElementById('schlag-filter-bar');
  if(fb) fb.innerHTML = `
    <button class="filter-btn ${schlagFilter==='alle'?'active':''}" onclick="setSchlagFilter('alle')">Alle (${state.felder.length})</button>
    <button class="filter-btn ${schlagFilter==='aktiv'?'active':''}" onclick="setSchlagFilter('aktiv')">Aktiv (${aktiv})</button>
    <button class="filter-btn ${schlagFilter==='pausiert'?'active':''}" onclick="setSchlagFilter('pausiert')">⏸ Pausiert (${pausiert})</button>
    <button class="filter-btn ${schlagFilter==='inaktiv'?'active':''}" onclick="setSchlagFilter('inaktiv')">Inaktiv (${inaktiv})</button>
    <button class="filter-btn ${schlagFilter==='abgeerntet'?'active':''}" onclick="setSchlagFilter('abgeerntet')">Abgeerntet (${abg})</button>`;

  const liste = document.getElementById('schlag-liste');
  if(liste) liste.innerHTML = felder.length ? items : '<div class="empty-state">Keine Schläge gefunden.</div>';
}

export async function schlagSetStatus(feldId, newStatus) {
  const f = state.felder.find(x=>x.id===feldId);
  if(!f) return;
  f.status = newStatus;
  renderAdminSchlaegeListe();
  if(window.refreshMapColors) window.refreshMapColors();
  try { await db.updateFeldStatus(feldId, newStatus); }
  catch(e) { showToast('⚠ Fehler beim Speichern: '+e.message, 'error'); }
}
