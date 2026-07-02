import { state } from './state.js?v=27';
import { getFeld, netto, fmtDate, fmtTime, escapeHtml } from './helpers.js?v=27';
import { getFruchtFarbe } from './frucht.js?v=27';
import { getQualitaetsfelder } from './quality.js?v=27';

// ── Übersicht: Vermehrungen ──────────────────────────────────────────────────
// Alle Vermehrungssorten mit Status (geerntet/in Ernte/offen), Mengen & Ø-Qualität.
// Klick auf eine Sorte klappt die einzelnen Fuhren auf.

let vermExpanded = {};
const feldMap = { hl: 'hlGewicht' };

function sorteDaten() {
  // Sorten aus der vermehrungen-Tabelle (Größe, Fruchtart, beteiligte Felder)
  const map = {};
  state.vermehrungen.forEach(v => {
    if(!map[v.sorte]) map[v.sorte] = { sorte: v.sorte, fruchtart: v.fruchtart || '', bio: !!v.bio, flaeche: 0, feldIds: new Set() };
    map[v.sorte].flaeche += parseFloat(v.flaeche) || 0;
    if(v.feld_id) map[v.sorte].feldIds.add(v.feld_id);
  });
  return Object.values(map).map(s => {
    const fuhren = state.fuhren.filter(f => f.status === 'fertig' && f.sorte === s.sorte)
      .sort((a,b)=>new Date(a.zeit)-new Date(b.zeit));
    const kg = fuhren.reduce((sum,f)=>sum+(netto(f)||0), 0);
    const anyAktiv = [...s.feldIds].some(id => getFeld(id).status === 'aktiv');
    const status = fuhren.length ? (anyAktiv ? 'inErnte' : 'geerntet') : 'offen';
    return { ...s, fuhren, kg, status };
  }).sort((a,b)=>a.sorte.localeCompare(b.sorte,'de'));
}

function avgQual(fuhren, fruchtart) {
  const qf = getQualitaetsfelder(fruchtart);
  return Object.entries(qf).map(([key,q]) => {
    const field = feldMap[key] || key;
    const vals = fuhren.map(f=>f[field]).filter(x=>x!=null);
    return { label: q.label.replace(/\s*\(.*?\)/,''), avg: vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : '–' };
  });
}

function fuhrenDetail(s) {
  if(!s.fuhren.length) return '<div style="font-size:12px;color:var(--text3);padding:6px 4px">Noch keine abgeschlossenen Fuhren.</div>';
  const qf = getQualitaetsfelder(s.fruchtart);
  const rows = s.fuhren.map(f => {
    const n = netto(f);
    const qStr = Object.entries(qf).map(([key,q]) => `${q.label.replace(/\s*\(.*?\)/,'')} ${f[feldMap[key]||key] ?? '–'}`).join(' · ');
    return `<div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:baseline;padding:6px 2px;border-top:1px solid var(--color-border)">
      <span style="font-size:13px;color:var(--text)">${f.nr} · ${fmtDate(f.zeit)} ${fmtTime(f.zeit)} · ${escapeHtml(getFeld(f.feldId).name||'?')}</span>
      <span style="font-size:13px;font-weight:700;color:var(--gold)">${n?(n/1000).toFixed(2)+' t':'–'}</span>
      <span style="grid-column:1/-1;font-size:11px;color:var(--text2)">${qStr}</span>
    </div>`;
  }).join('');
  const avgs = avgQual(s.fuhren, s.fruchtart);
  return `<div style="background:var(--neutral-200);border-radius:7px;padding:8px 10px;margin:2px 0 8px">
    ${rows}
    <div style="display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:space-between;align-items:baseline;margin-top:8px;padding-top:8px;border-top:2px solid var(--color-border)">
      <span style="font-size:13px;color:var(--text)"><b>${s.fuhren.length}</b> Fuhren · Summe <b>${(s.kg/1000).toFixed(2)} t</b></span>
      <span style="font-size:12px;color:var(--text2)">${avgs.map(a=>`Ø ${a.label}: <b style="color:var(--text)">${a.avg}</b>`).join(' · ')}</span>
    </div>
  </div>`;
}

export function renderAdminVermehrungen() {
  const daten = sorteDaten();
  const STAT = {
    geerntet: { txt:'Geerntet', cls:'badge-abgeerntet' },
    inErnte:  { txt:'In Ernte', cls:'badge-aktiv' },
    offen:    { txt:'Offen',    cls:'badge-inaktiv' },
  };
  const gesamtHa = daten.reduce((s,d)=>s+d.flaeche,0);
  const gesamtT = daten.reduce((s,d)=>s+d.kg,0)/1000;
  const geerntetN = daten.filter(d=>d.status!=='offen').length;

  const cards = daten.map(s => {
    const fr = getFruchtFarbe(s.fruchtart);
    const dtHa = s.flaeche>0 ? (s.kg/100/s.flaeche) : 0;
    const open = vermExpanded[s.sorte] || false;
    const st = STAT[s.status];
    return `<div style="border:1px solid var(--color-border);border-radius:var(--radius);margin-bottom:8px;background:var(--color-surface);border-left:4px solid ${fr.dot}">
      <div style="cursor:pointer;padding:12px 14px" onclick="toggleVermehrung('${escapeHtml(s.sorte).replace(/'/g,"\\'")}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="min-width:0">
            <div style="font-size:15px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:6px">
              ${open?'▲':'▼'} 🌱 ${escapeHtml(s.sorte)} ${s.bio?'<span style="font-size:9px;font-weight:800;background:var(--color-success-wash);color:var(--color-success);padding:1px 5px;border-radius:4px">BIO</span>':''}
            </div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px">${escapeHtml(s.fruchtart)} · ${s.flaeche.toFixed(1)} ha · ${s.fuhren.length} Fuhren</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <span class="badge ${st.cls}">${st.txt}</span>
            <div style="font-family:var(--serif);font-size:16px;font-weight:600;color:var(--text);margin-top:4px">${(s.kg/1000).toFixed(1)} t</div>
            <div style="font-size:10px;color:var(--blue)">${dtHa>0?dtHa.toFixed(1)+' dt/ha':'–'}</div>
          </div>
        </div>
      </div>
      ${open ? `<div style="padding:0 14px 6px">${fuhrenDetail(s)}</div>` : ''}
    </div>`;
  }).join('');

  document.getElementById('admintab').innerHTML = `
    <div class="card">
      <div class="card-header"><div class="card-title">Vermehrungen (Z-Saatgut)</div></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        <div class="stat-box"><div class="stat-val" style="font-size:20px">${daten.length}</div><div class="stat-label">Sorten</div></div>
        <div class="stat-box"><div class="stat-val" style="font-size:20px;color:var(--green)">${geerntetN}</div><div class="stat-label">in Ernte / geerntet</div></div>
        <div class="stat-box"><div class="stat-val" style="font-size:20px">${gesamtT.toFixed(1)}</div><div class="stat-label">t gesamt · ${gesamtHa.toFixed(0)} ha</div></div>
      </div>
    </div>
    <div class="section-label" style="margin-top:4px">Sorten — anklicken für Fuhren</div>
    ${daten.length ? cards : '<div class="empty-state">Keine Vermehrungssorten hinterlegt.</div>'}`;
}

export function toggleVermehrung(sorte) {
  vermExpanded[sorte] = !vermExpanded[sorte];
  renderAdminVermehrungen();
}
