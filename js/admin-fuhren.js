import { state } from './state.js?v=49';
import { db } from './db.js?v=49';
import { getFeld, getUser, netto, kg2t, fmtDate, fmtTime, showToast, escapeHtml, sorteBadge } from './helpers.js?v=49';
import { getFruchtFarbe } from './frucht.js?v=49';
import { alleLagerOrte, lagerLabel } from './silo.js?v=49';
import { exportFuhrenCSV, exportFuhrenExcel } from './export.js?v=49';
import { isBioFuhre, bioBadge } from './bio.js?v=49';

let _editOpenId = null;
// Filter für die Fuhren-Übersicht (Lieferant/Betrieb + Tag), auch für den Export.
let _fFilterHerkunft = '';
let _fFilterDatum = '';

// Herkunft einer Fuhre: eigener Betrieb (Landgut, Viehmast …) oder Zukauf-Lieferant.
function herkunftVonFuhre(f) {
  const feld = getFeld(f.feldId);
  if((feld.typ||'schlag') === 'lieferant') return feld.name || 'Zukauf';
  if((feld.typ||'schlag') === 'umlagerung') return 'Umlagerung';
  return feld.betrieb || '(ohne Betrieb)';
}
function fuhreImFilter(f) {
  if(_fFilterHerkunft && herkunftVonFuhre(f) !== _fFilterHerkunft) return false;
  if(_fFilterDatum) {
    const d = new Date(f.zeit);
    const iso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    if(iso !== _fFilterDatum) return false;
  }
  return true;
}
// Vom Filter erfasste, abgeschlossene Fuhren (für den Export)
function gefilterteFertige() {
  return state.fuhren.filter(f => f.status==='fertig' && fuhreImFilter(f))
    .sort((a,b)=>new Date(a.zeit)-new Date(b.zeit));
}
export function setFuhrenFilter(feld, wert) {
  if(feld === 'herkunft') _fFilterHerkunft = wert;
  else if(feld === 'datum') _fFilterDatum = wert;
  renderAdminFuhren();
}
export function fuhrenFilterZuruecksetzen() {
  _fFilterHerkunft = ''; _fFilterDatum = '';
  renderAdminFuhren();
}
function filterDateiname() {
  const teile = ['Fuhren'];
  if(_fFilterHerkunft) teile.push(_fFilterHerkunft.replace(/[^\wäöüÄÖÜß -]/g,'').trim().replace(/\s+/g,'_'));
  if(_fFilterDatum) teile.push(_fFilterDatum);
  if(teile.length === 1) teile.push('gefiltert');
  return 'Ernte2026_' + teile.join('_');
}
export function exportGefilterteFuhrenCSV() {
  const f = gefilterteFertige();
  if(!f.length) { showToast('Keine Fuhren im Filter', 'error'); return; }
  exportFuhrenCSV(f, filterDateiname() + '.csv');
  showToast(`✓ ${f.length} Fuhre${f.length>1?'n':''} als CSV exportiert`);
}
export function exportGefilterteFuhrenExcel() {
  const f = gefilterteFertige();
  if(!f.length) { showToast('Keine Fuhren im Filter', 'error'); return; }
  exportFuhrenExcel(f, filterDateiname() + '.xlsx');
}

// Quelle/Ziel-Auswahl für Umlagerungs-Fuhren (nur im Admin-Bearbeiten-Formular).
// Ziel = silo_id der Fuhre (Einlagerung), Quelle löst die automatische Ausbuchung aus.
function lagerSelects(f) {
  if(getFeld(f.feldId).typ !== 'umlagerung') return '';
  const opts = (sel) => '<option value="">— wählen —</option>' + alleLagerOrte()
    .map(o => `<option value="${escapeHtml(o.id)}" ${o.id===sel?'selected':''}>${escapeHtml(o.label)}</option>`).join('');
  return `
    <label style="font-size:11px;color:var(--text2)">Quell-Lager (wird ausgebucht)<select id="ef-quelle-${f.id}" class="input">${opts(f.quelleLagerId)}</select></label>
    <label style="font-size:11px;color:var(--text2)">Ziel-Lager (wird eingelagert)<select id="ef-ziel-${f.id}" class="input">${opts(f.siloId)}</select></label>`;
}

// Hält die automatische Ausgangs-Buchung im Quell-Lager synchron zur Fuhre
// (verknüpft über warenbewegungen.fuhre_id): anlegen, anpassen oder zurücknehmen.
async function syncUmlagerungsAusbuchung(f) {
  const n = netto(f) || 0;
  const zielTxt = f.siloId ? lagerLabel(f.siloId) : '';
  const notiz = 'Umlagerung ' + f.nr + (zielTxt ? ' → ' + zielTxt : '');
  try {
    const vorhanden = state.warenbewegungen.find(w => w.fuhre_id === f.id);
    const passt = vorhanden && vorhanden.silo_von_id === f.quelleLagerId
      && parseFloat(vorhanden.menge_kg) === n && vorhanden.notiz === notiz;
    if(passt) return;
    if(vorhanden) await db.deleteWarenbewegung(vorhanden.id);
    if(f.quelleLagerId && n > 0) {
      await db.insertWarenbewegung({
        typ: 'ausgang', siloVonId: f.quelleLagerId, mengeKg: n,
        notiz, fuhreId: f.id, erstelltVon: state.currentUser?.id || null
      });
      showToast('✓ ' + kg2t(n) + ' aus ' + lagerLabel(f.quelleLagerId) + ' ausgebucht');
    }
    state.warenbewegungen = await db.getWarenbewegungen();
  } catch(e) { showToast('⚠ Ausbuchung: ' + e.message, 'error'); }
}

// Sorte/Partie-Auswahl (Konsum + Vermehrungssorten des Feldes) für die Bearbeiten-Formulare
function sorteEditFeld(f) {
  const verms = state.vermehrungen.filter(v => v.feld_id === f.feldId);
  if(!verms.length && !f.sorte) return '';
  const opts = '<option value=""'+(!f.sorte?' selected':'')+'>Konsum</option>'
    + verms.map(v=>`<option ${v.sorte===f.sorte?'selected':''}>${escapeHtml(v.sorte)}</option>`).join('')
    + (f.sorte && !verms.some(v=>v.sorte===f.sorte) ? `<option selected>${escapeHtml(f.sorte)}</option>` : '');
  return `<label style="font-size:11px;color:var(--text2)">Sorte/Partie<select id="ef-sorte-${f.id}" class="input">${opts}</select></label>`;
}

export function renderAdminFuhren() {
  const fertig = state.fuhren.filter(f=>f.status==='fertig'&&fuhreImFilter(f)).sort((a,b)=>new Date(b.zeit)-new Date(a.zeit));
  const offen = state.fuhren.filter(f=>f.status==='offen'&&fuhreImFilter(f));
  const pending = fertig.filter(f=>!f.verifiziert);
  const verified = fertig.filter(f=>f.verifiziert);
  const filterAktiv = !!(_fFilterHerkunft || _fFilterDatum);
  // Herkünfte für die Auswahl (alle Fuhren, alphabetisch)
  const herkuenfte = [...new Set(state.fuhren.map(herkunftVonFuhre))].sort((a,b)=>a.localeCompare(b,'de'));
  const herkunftOpts = herkuenfte.map(h=>`<option value="${escapeHtml(h)}" ${h===_fFilterHerkunft?'selected':''}>${escapeHtml(h)}</option>`).join('');

  const fuhreRow = (f, showEdit=true) => {
    const feld = getFeld(f.feldId);
    const n = netto(f);
    const isVerified = f.verifiziert;
    const bio = isBioFuhre(f);
    const fr = getFruchtFarbe(f.fruchtart);
    return `<div class="card" style="margin-bottom:10px;border-color:${bio?'var(--color-success)':isVerified?'var(--green)':'var(--border)'};border-left:4px solid ${bio?'var(--color-success)':fr.dot};${bio?'background:var(--color-success-wash)':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="min-width:0">
          <div style="font-size:12px;font-weight:600;color:var(--text)">${f.nr} · ${fmtDate(f.zeit)} ${fmtTime(f.zeit)}${bio?bioBadge(true):''}</div>
          <div style="font-size:11px;margin-top:2px;display:flex;align-items:center;gap:5px;flex-wrap:wrap">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${fr.dot};flex-shrink:0"></span>
            <span style="color:${fr.dot};font-weight:600">${f.fruchtart}</span>
            <span style="color:var(--text3)">· ${feld.name||'?'}</span>${sorteBadge(f)}
          </div>
          <div style="font-size:11px;color:var(--text2)">${getUser(f.drescherId).name} → ${getUser(f.abfahrerId).name}</div>
        </div>
        <div style="flex-shrink:0;text-align:right">
          <div style="font-family:var(--serif);font-size:16px;font-weight:600;color:var(--text)">${n?kg2t(n):'–'}</div>
          <div style="font-size:10px;color:var(--text2)">netto</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:8px">
        <div><span style="font-size:11px;color:var(--text2)">Feuchte </span><span style="font-size:14px;font-weight:600">${f.feuchte??'–'}%</span></div>
        <div><span style="font-size:11px;color:var(--text2)">Protein </span><span style="font-size:14px;font-weight:600">${f.protein??'–'}%</span></div>
        <div><span style="font-size:11px;color:var(--text2)">HL </span><span style="font-size:14px;font-weight:600">${f.hlGewicht??'–'}</span></div>
        ${f.gluten!=null?`<div><span style="font-size:11px;color:var(--text2)">Gluten </span><span style="font-size:14px;font-weight:600">${f.gluten}%</span></div>`:''}
        ${f.oelgehalt!=null?`<div><span style="font-size:11px;color:var(--text2)">Öl </span><span style="font-size:14px;font-weight:600">${f.oelgehalt}%</span></div>`:''}
      </div>
      ${getFeld(f.feldId).typ==='umlagerung'
        ? `<div style="margin-top:6px;font-size:11px;color:var(--blue)">🔄 ${f.quelleLagerId?lagerLabel(f.quelleLagerId):'<span style="color:var(--amber)">Quelle fehlt</span>'} → ${f.siloId?lagerLabel(f.siloId):'<span style="color:var(--amber)">Ziel fehlt</span>'}</div>`
        : (f.siloId?`<div style="margin-top:6px;font-size:11px;color:var(--blue)">🏭 ${lagerLabel(f.siloId)}</div>`:'')}
      ${f.lat!=null&&window.standortText?`<div style="margin-top:4px;font-size:11px;color:var(--text2)">📍 ${window.standortText(f.lat,f.lon)}</div>`:''}
      ${showEdit ? `<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        ${!isVerified ? `
          <button class="btn btn-sm btn-outline" onclick="toggleFuhreEdit(${f.id})">✏ Bearbeiten</button>
          <button class="btn btn-sm" style="background:var(--green);color:var(--text);border:none" onclick="verifiziereFuhre(${f.id})">✓ Bestätigen</button>
        ` : `
          <button class="btn btn-sm btn-outline" onclick="toggleFuhreEdit(${f.id})">✏ Bearbeiten</button>
          <button class="btn btn-sm btn-amber" onclick="verifiziereFuhre(${f.id})">↺ Öffnen</button>
        `}
        <button class="btn btn-sm" style="background:none;border:1px solid var(--red);color:var(--red);margin-left:auto" onclick="deleteFuhre(${f.id})">🗑 Löschen</button>
      </div>` : ''}
      <div id="edit-form-${f.id}" style="display:none"></div>
    </div>`;
  };

  const offenRow = (f) => {
    const feld = getFeld(f.feldId);
    const _fr = getFruchtFarbe(f.fruchtart);
    const bio = isBioFuhre(f);
    return `<div class="card" style="margin-bottom:10px;border-color:var(--amber);border-left:4px solid ${bio?'var(--color-success)':_fr.dot}${bio?';background:var(--color-success-wash)':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;flex-wrap:wrap">
            <span class="badge badge-offen">OFFEN</span>
            <span style="font-size:12px;font-weight:600;color:var(--text)">${f.nr} · ${fmtDate(f.zeit)} ${fmtTime(f.zeit)}</span>${bio?bioBadge(true):''}
          </div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${feld.name||'?'} · ${f.fruchtart}${sorteBadge(f)}</div>
          <div style="font-size:11px;color:var(--text2)">${getUser(f.drescherId).name} → ${getUser(f.abfahrerId).name}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-sm btn-outline" onclick="toggleFuhreEdit(${f.id})">✏ Bearbeiten</button>
        <button class="btn btn-sm" style="background:var(--blue);color:#fff;border:none" onclick="adminAbschliessen(${f.id})">⚖ Abschließen</button>
        <button class="btn btn-sm" style="background:none;border:1px solid var(--red);color:var(--red);margin-left:auto" onclick="deleteFuhre(${f.id})">🗑 Löschen</button>
      </div>
      <div id="edit-form-${f.id}" style="display:none"></div>
    </div>`;
  };

  document.getElementById('admintab').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;flex:1;min-width:240px">
        <div class="stat-box"><div class="stat-val" style="font-size:22px;color:var(--color-warning)">${offen.length}</div><div class="stat-label">offen</div></div>
        <div class="stat-box"><div class="stat-val" style="font-size:18px;color:var(--text)">${pending.length}</div><div class="stat-label">zu prüfen</div></div>
        <div class="stat-box"><div class="stat-val" style="font-size:22px;color:var(--text)">${verified.length}</div><div class="stat-label">bestätigt</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;align-items:center">
        <button class="btn btn-sm" style="background:var(--green);color:#fff;border:none" onclick="exportExcelAuswertung()">📊 Excel-Auswertung</button>
        <button class="btn btn-outline btn-sm" onclick="exportCSV()">⬇ CSV komplett</button>
        <button class="btn btn-outline btn-sm" onclick="exportCSVSeitLetztem()">⬇ CSV neu seit letztem</button>
        <span style="display:inline-flex;gap:4px;align-items:center;font-size:11px;color:var(--text2)">
          <input type="date" id="exp-von" class="input" style="width:auto;padding:4px 6px;font-size:12px">
          <span>–</span>
          <input type="date" id="exp-bis" class="input" style="width:auto;padding:4px 6px;font-size:12px">
          <button class="btn btn-outline btn-sm" onclick="exportCSVZeitraum(document.getElementById('exp-von').value, document.getElementById('exp-bis').value)">⬇ Zeitraum</button>
        </span>
        <button class="btn btn-outline btn-sm" onclick="exportTagesbericht()">📄 Tagesbericht</button>
      </div>
    </div>

    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:14px">
      <span style="font-size:12px;font-weight:700;color:var(--text2);letter-spacing:1px;text-transform:uppercase">🔎 Filter</span>
      <label style="font-size:11px;color:var(--text2);display:inline-flex;align-items:center;gap:4px">Lieferant/Betrieb
        <select class="input" style="width:auto;padding:5px 8px;font-size:13px" onchange="setFuhrenFilter('herkunft', this.value)">
          <option value="">Alle</option>${herkunftOpts}
        </select>
      </label>
      <label style="font-size:11px;color:var(--text2);display:inline-flex;align-items:center;gap:4px">Tag
        <input type="date" class="input" style="width:auto;padding:4px 6px;font-size:13px" value="${_fFilterDatum}" onchange="setFuhrenFilter('datum', this.value)">
      </label>
      ${filterAktiv ? `<button class="btn btn-sm btn-outline" onclick="fuhrenFilterZuruecksetzen()">✕ Filter zurücksetzen</button>` : ''}
      <div style="flex:1"></div>
      <span style="font-size:12px;color:var(--text2)">${fertig.length} abgeschlossen im Filter</span>
      <button class="btn btn-sm btn-outline" onclick="exportGefilterteFuhrenCSV()">⬇ CSV (Filter)</button>
      <button class="btn btn-sm" style="background:var(--green);color:#fff;border:none" onclick="exportGefilterteFuhrenExcel()">📊 Excel (Filter)</button>
    </div>

    ${filterAktiv && !fertig.length && !offen.length ? '<div class="empty-state">Keine Fuhren für diesen Filter.</div>' : ''}
    ${pending.length ? `<div class="section-label" style="color:var(--text)">⚠ Zu bestätigen (${pending.length})</div>${pending.map(f=>fuhreRow(f,true)).join('')}` : ''}
    ${verified.length ? `<div class="section-label" style="margin-top:8px">✓ Bestätigt (${verified.length})</div>${verified.map(f=>fuhreRow(f,true)).join('')}` : ''}
    ${offen.length ? `<div class="section-label" style="margin-top:8px;color:var(--amber)">⚠ Offene Fuhren (${offen.length})</div>${offen.map(offenRow).join('')}` : ''}`;
}

export function toggleFuhreEdit(fId) {
  const el = document.getElementById('edit-form-'+fId);
  if(!el) return;
  if(_editOpenId && _editOpenId !== fId) {
    const prev = document.getElementById('edit-form-'+_editOpenId);
    if(prev) { prev.style.display='none'; prev.innerHTML=''; }
  }
  if(el.style.display==='none') {
    _editOpenId = fId;
    el.style.display='block';
    renderFuhreEditForm(fId);
  } else {
    _editOpenId = null;
    el.style.display='none';
    el.innerHTML='';
  }
}

function renderFuhreEditForm(fId) {
  const f = state.fuhren.find(x=>x.id===fId);
  if(!f) return;
  const el = document.getElementById('edit-form-'+fId);
  if(!el) return;
  const feldOpts = state.felder.map(fd=>`<option value="${fd.id}" ${fd.id===f.feldId?'selected':''}>${fd.name}</option>`).join('');
  const sorten = [...new Set(state.felder.map(f=>f.fruchtart))].sort();
  const sortenOpts = sorten.map(s=>`<option ${s===f.fruchtart?'selected':''}>${s}</option>`).join('');
  const drescher = state.users.filter(u=>u.role==='drescher'||u.role==='admin');
  const abfahrer = state.users.filter(u=>u.role==='abfahrer'||u.role==='admin');
  const drOpts = drescher.map(u=>`<option value="${u.id}" ${u.id===f.drescherId?'selected':''}>${u.name}</option>`).join('');
  const abOpts = abfahrer.map(u=>`<option value="${u.id}" ${u.id===f.abfahrerId?'selected':''}>${u.name}</option>`).join('');
  el.innerHTML = `<div style="margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--card)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <label style="font-size:11px;color:var(--text2)">Feld<select id="ef-feld-${fId}" class="input">${feldOpts}</select></label>
      <label style="font-size:11px;color:var(--text2)">Fruchtart<select id="ef-fa-${fId}" class="input">${sortenOpts}</select></label>
      ${sorteEditFeld(f)}
      ${lagerSelects(f)}
      <label style="font-size:11px;color:var(--text2)">Drescher<select id="ef-dr-${fId}" class="input">${drOpts}</select></label>
      <label style="font-size:11px;color:var(--text2)">Abfahrer<select id="ef-ab-${fId}" class="input">${abOpts}</select></label>
      <label style="font-size:11px;color:var(--text2)">Vollgew. (kg)<input id="ef-voll-${fId}" class="input" type="number" value="${f.vollgewicht||''}"></label>
      <label style="font-size:11px;color:var(--text2)">Leergew. (kg)<input id="ef-leer-${fId}" class="input" type="number" value="${f.leergewicht||''}"></label>
      <label style="font-size:11px;color:var(--text2)">Feuchte %<input id="ef-feuchte-${fId}" class="input" type="number" step="0.1" value="${f.feuchte||''}"></label>
      ${(f.fruchtart||'').toLowerCase().includes('gerste') ? '' : `<label style="font-size:11px;color:var(--text2)">Fallzahl<input id="ef-fz-${fId}" class="input" type="number" value="${f.fallzahl||''}"></label>`}
      <label style="font-size:11px;color:var(--text2)">Protein %<input id="ef-prot-${fId}" class="input" type="number" step="0.1" value="${f.protein||''}"></label>
      <label style="font-size:11px;color:var(--text2)">HL-Gewicht<input id="ef-hl-${fId}" class="input" type="number" step="0.1" value="${f.hlGewicht||''}"></label>
      <label style="font-size:11px;color:var(--text2)">Gluten %<input id="ef-gluten-${fId}" class="input" type="number" step="0.1" value="${f.gluten||''}"></label>
      <label style="font-size:11px;color:var(--text2)">Ölgehalt %<input id="ef-oel-${fId}" class="input" type="number" step="0.1" value="${f.oelgehalt||''}"></label>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-sm" style="background:var(--green);color:var(--text);border:none" onclick="saveFuhreEdit(${fId})">💾 Speichern</button>
      <button class="btn btn-sm btn-outline" onclick="toggleFuhreEdit(${fId})">Abbrechen</button>
    </div>
  </div>`;
}

export async function saveFuhreEdit(fId) {
  const f = state.fuhren.find(x=>x.id===fId);
  if(!f) return;
  const updates = {
    feldIdKorr: parseInt(document.getElementById('ef-feld-'+fId).value),
    fruchtartKorr: document.getElementById('ef-fa-'+fId).value,
    drescherId: parseInt(document.getElementById('ef-dr-'+fId).value),
    abfahrerId: parseInt(document.getElementById('ef-ab-'+fId).value),
    vollgewicht: parseFloat(document.getElementById('ef-voll-'+fId).value)||null,
    leergewicht: parseFloat(document.getElementById('ef-leer-'+fId).value)||null,
    feuchte: parseFloat(document.getElementById('ef-feuchte-'+fId).value)||null,
    fallzahl: parseFloat(document.getElementById('ef-fz-'+fId)?.value)||null,
    protein: parseFloat(document.getElementById('ef-prot-'+fId).value)||null,
    hlGewicht: parseFloat(document.getElementById('ef-hl-'+fId).value)||null,
    gluten: parseFloat(document.getElementById('ef-gluten-'+fId)?.value)||null,
    oelgehalt: parseFloat(document.getElementById('ef-oel-'+fId)?.value)||null,
  };
  const sorteEl = document.getElementById('ef-sorte-'+fId);
  if(sorteEl) updates.sorte = sorteEl.value || null;
  // Umlagerung: Quelle (Ausbuchung) + Ziel (Einlagerung) – nur im Admin-Formular vorhanden
  const quelleEl = document.getElementById('ef-quelle-'+fId);
  const zielEl = document.getElementById('ef-ziel-'+fId);
  if(quelleEl) updates.quelleLagerId = quelleEl.value || null;
  if(zielEl) updates.siloId = zielEl.value || null;
  Object.assign(f, updates, {fruchtart: updates.fruchtartKorr, feldId: updates.feldIdKorr});
  _editOpenId = null;
  renderAdminFuhren();
  try {
    await db.updateFuhre(fId, updates);
    if(quelleEl) await syncUmlagerungsAusbuchung(f);
    showToast('✓ Gespeichert');
  } catch(e) { showToast('⚠ '+e.message, 'error'); }
}

export async function deleteFuhre(fId) {
  const f = state.fuhren.find(x=>x.id===fId);
  if(!f) return;
  const n = netto(f);
  const info = `Fuhre ${f.nr} wirklich löschen?\n\n`
    + `${getFeld(f.feldId).name||'?'} · ${f.fruchtart||''}${f.sorte?' · '+f.sorte:''}\n`
    + `Netto: ${n?kg2t(n):'–'} · ${getUser(f.abfahrerId).name||''}\n\n`
    + `Dies kann nicht rückgängig gemacht werden.`;
  if(!confirm(info)) return;
  const idx = state.fuhren.indexOf(f);
  state.fuhren.splice(idx, 1);
  renderAdminFuhren();
  try {
    await db.deleteFuhre(fId);
    // Automatische Umlagerungs-Ausbuchung dieser Fuhre mit zurücknehmen
    const wb = state.warenbewegungen.find(w => w.fuhre_id === fId);
    if(wb) {
      try { await db.deleteWarenbewegung(wb.id); state.warenbewegungen = state.warenbewegungen.filter(w => w.id !== wb.id); }
      catch(e2) { console.warn('Ausbuchung nicht entfernt:', e2); }
    }
    showToast('🗑 Fuhre '+f.nr+' gelöscht');
  } catch(e) {
    state.fuhren.splice(idx, 0, f); // Rollback bei Fehler
    showToast('⚠ Löschen fehlgeschlagen: '+e.message, 'error');
    renderAdminFuhren();
  }
}

export async function verifiziereFuhre(fId) {
  const f = state.fuhren.find(x=>x.id===fId);
  if(!f) return;
  f.verifiziert = !f.verifiziert;
  renderAdminFuhren();
  try {
    await db.updateFuhre(fId, {verifiziert: f.verifiziert});
    showToast(f.verifiziert ? '✓ Bestätigt' : '↺ Wieder geöffnet');
  } catch(e) { showToast('⚠ '+e.message, 'error'); }
}

export function adminAbschliessen(fId) {
  const f = state.fuhren.find(x=>x.id===fId);
  if(!f) return;
  const el = document.getElementById('edit-form-'+fId);
  if(!el) return;
  if(_editOpenId && _editOpenId !== fId) {
    const prev = document.getElementById('edit-form-'+_editOpenId);
    if(prev) { prev.style.display='none'; prev.innerHTML=''; }
  }
  _editOpenId = fId;
  el.style.display = 'block';
  const feld = getFeld(f.feldId);
  const feldOpts = state.felder.map(fd=>`<option value="${fd.id}" ${fd.id===f.feldId?'selected':''}>${fd.name}</option>`).join('');
  const sorten = [...new Set(state.felder.map(x=>x.fruchtart))].sort();
  const sortenOpts = sorten.map(s=>`<option ${s===f.fruchtart?'selected':''}>${s}</option>`).join('');
  const drescher = state.users.filter(u=>u.role==='drescher'||u.role==='admin');
  const abfahrer = state.users.filter(u=>u.role==='abfahrer'||u.role==='admin');
  const drOpts = drescher.map(u=>`<option value="${u.id}" ${u.id===f.drescherId?'selected':''}>${u.name}</option>`).join('');
  const abOpts = abfahrer.map(u=>`<option value="${u.id}" ${u.id===f.abfahrerId?'selected':''}>${u.name}</option>`).join('');
  el.innerHTML = `<div style="margin-top:10px;padding:12px;border:2px solid var(--blue);border-radius:var(--radius);background:var(--card)">
    <div style="font-size:13px;font-weight:600;color:var(--blue);margin-bottom:10px">⚖ Fuhre abschließen</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <label style="font-size:11px;color:var(--text2)">Feld<select id="ef-feld-${fId}" class="input">${feldOpts}</select></label>
      <label style="font-size:11px;color:var(--text2)">Fruchtart<select id="ef-fa-${fId}" class="input">${sortenOpts}</select></label>
      ${sorteEditFeld(f)}
      ${lagerSelects(f)}
      <label style="font-size:11px;color:var(--text2)">Drescher<select id="ef-dr-${fId}" class="input">${drOpts}</select></label>
      <label style="font-size:11px;color:var(--text2)">Abfahrer<select id="ef-ab-${fId}" class="input">${abOpts}</select></label>
      <label style="font-size:11px;color:var(--text2)">Vollgew. (kg) *<input id="ef-voll-${fId}" class="input" type="number" value="${f.vollgewicht||''}"></label>
      <label style="font-size:11px;color:var(--text2)">Leergew. (kg) *<input id="ef-leer-${fId}" class="input" type="number" value="${f.leergewicht||''}"></label>
      <label style="font-size:11px;color:var(--text2)">Feuchte % *<input id="ef-feuchte-${fId}" class="input" type="number" step="0.1" value="${f.feuchte||''}"></label>
      ${(f.fruchtart||'').toLowerCase().includes('gerste') ? '' : `<label style="font-size:11px;color:var(--text2)">Fallzahl<input id="ef-fz-${fId}" class="input" type="number" value="${f.fallzahl||''}"></label>`}
      <label style="font-size:11px;color:var(--text2)">Protein %<input id="ef-prot-${fId}" class="input" type="number" step="0.1" value="${f.protein||''}"></label>
      <label style="font-size:11px;color:var(--text2)">HL-Gewicht<input id="ef-hl-${fId}" class="input" type="number" step="0.1" value="${f.hlGewicht||''}"></label>
      <label style="font-size:11px;color:var(--text2)">Gluten %<input id="ef-gluten-${fId}" class="input" type="number" step="0.1" value="${f.gluten||''}"></label>
      <label style="font-size:11px;color:var(--text2)">Ölgehalt %<input id="ef-oel-${fId}" class="input" type="number" step="0.1" value="${f.oelgehalt||''}"></label>
    </div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="btn btn-sm" style="background:var(--blue);color:#fff;border:none" onclick="adminFuhreAbschliessenSpeichern(${fId})">✓ Abschließen & Speichern</button>
      <button class="btn btn-outline btn-sm" onclick="toggleFuhreEdit(${fId})">Abbrechen</button>
    </div>
  </div>`;
  setTimeout(()=>el.scrollIntoView({behavior:'smooth',block:'center'}), 50);
}

export async function adminFuhreAbschliessenSpeichern(fId) {
  const v = parseFloat(document.getElementById('ef-voll-'+fId)?.value);
  const l = parseFloat(document.getElementById('ef-leer-'+fId)?.value);
  const feuchte = parseFloat(document.getElementById('ef-feuchte-'+fId)?.value);
  if(!v||!l||v<=l) { alert('Bitte gültige Gewichte eingeben (Vollgew. > Leergew.).'); return; }
  if(!feuchte) { alert('Bitte Feuchte eingeben.'); return; }
  const f = state.fuhren.find(x=>x.id===fId);
  if(!f) return;
  const updates = {
    status: 'fertig',
    feldIdKorr: parseInt(document.getElementById('ef-feld-'+fId).value),
    fruchtartKorr: document.getElementById('ef-fa-'+fId).value,
    drescherId: parseInt(document.getElementById('ef-dr-'+fId).value),
    abfahrerId: parseInt(document.getElementById('ef-ab-'+fId).value),
    vollgewicht: v, leergewicht: l, feuchte,
    fallzahl: parseFloat(document.getElementById('ef-fz-'+fId)?.value)||null,
    protein: parseFloat(document.getElementById('ef-prot-'+fId)?.value)||null,
    hlGewicht: parseFloat(document.getElementById('ef-hl-'+fId)?.value)||null,
    gluten: parseFloat(document.getElementById('ef-gluten-'+fId)?.value)||null,
    oelgehalt: parseFloat(document.getElementById('ef-oel-'+fId)?.value)||null,
  };
  const sorteElA = document.getElementById('ef-sorte-'+fId);
  if(sorteElA) updates.sorte = sorteElA.value || null;
  const quelleElA = document.getElementById('ef-quelle-'+fId);
  const zielElA = document.getElementById('ef-ziel-'+fId);
  if(quelleElA) updates.quelleLagerId = quelleElA.value || null;
  if(zielElA) updates.siloId = zielElA.value || null;
  Object.assign(f, updates, {status:'fertig', fruchtart: updates.fruchtartKorr, feldId: updates.feldIdKorr});
  _editOpenId = null;
  renderAdminFuhren();
  try {
    await db.updateFuhre(fId, updates);
    if(quelleElA) await syncUmlagerungsAusbuchung(f);
    showToast('✓ Fuhre abgeschlossen');
  } catch(e) { showToast('⚠ '+e.message, 'error'); }
}
