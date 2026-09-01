import { state } from './state.js?v=129';
import { getFeld, netto, fmtDate, fmtTime, escapeHtml } from './helpers.js?v=129';
import { getFruchtFarbe } from './frucht.js?v=129';
import { getQualitaetsfelder } from './quality.js?v=129';
import { lagerLabel } from './silo.js?v=129';

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

// Datenbasis der Mengenübersicht (auch für den Excel-Export): je Sorte Rohware,
// Absiebe, Fläche sowie Roh-/Saatware-Silo. Roh-Silo = Quelle der Reinigung (bzw.
// aktueller Standort, solange ungereinigt); Saat-Silo = Ziel der Reinigung.
export function mengenUebersichtDaten() {
  const roh = {}, faOf = {}, absiebe = {}, flaecheOf = {};
  state.fuhren.filter(f => f.status === 'fertig' && f.sorte).forEach(f => {
    roh[f.sorte] = (roh[f.sorte] || 0) + (netto(f) || 0);
    if(!faOf[f.sorte]) faOf[f.sorte] = f.fruchtart || getFeld(f.feldId).fruchtart || '—';
  });
  state.fuhren.filter(f => f.status === 'fertig' && getFeld(f.feldId).typ === 'reinigung').forEach(f => {
    const nm = (getFeld(f.feldId).name || '').replace(/^Reinigungsabgang\s*/i, '').trim();
    const sorten = nm.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
    if(!sorten.length) return;
    const share = (netto(f) || 0) / sorten.length; // Mehrfach-Reinigung: gleichmäßig aufteilen
    sorten.forEach(s => { absiebe[s] = (absiebe[s] || 0) + share; });
  });
  state.vermehrungen.forEach(v => { flaecheOf[v.sorte] = (flaecheOf[v.sorte] || 0) + (parseFloat(v.flaeche) || 0); });

  // Rohware-Silo (Quelle) aus den Reinigungs-Warenbewegungen ("… · Silo <Quelle> → <Ziel>").
  const rohSet = {};
  state.warenbewegungen.filter(w => w.typ === 'ausgang' && /^\s*Reinigungsabgang/i.test(w.notiz || '')).forEach(w => {
    const m = /Reinigungsabgang\s*(.*?)\s*·\s*Silo\s*(.+?)\s*→\s*(.+?)\s*$/i.exec(w.notiz || '');
    if(!m) return;
    m[1].split(/\s*,\s*/).map(s => s.trim()).filter(Boolean).forEach(s => {
      (rohSet[s] = rohSet[s] || new Set()).add(m[2].trim());
    });
  });
  const aktSet = {};
  state.fuhren.filter(f => f.status === 'fertig' && f.sorte && f.siloId).forEach(f => {
    (aktSet[f.sorte] = aktSet[f.sorte] || new Set()).add(f.siloId);
  });
  const siloStr = set => set && set.size ? [...set].map(lagerLabel).join(', ') : '';

  return Object.keys(roh).map(sorte => {
    // Gereinigt, sobald ein Reinigungsabgang existiert (Absiebe > 0). Saatware-Silo =
    // aktueller Standort der (gereinigten) Fuhren; Rohware-Silo = Quelle der Reinigung
    // (aus der Notiz, falls vorhanden), solange ungereinigt = aktueller Standort.
    const cleaned = (absiebe[sorte] || 0) > 0;
    return {
      fruchtart: faOf[sorte] || '—', sorte,
      rohKg: roh[sorte], absiebeKg: absiebe[sorte] || 0, flaeche: flaecheOf[sorte] || 0,
      // Saatware entsteht erst durch die Reinigung: ungereinigt = 0 (nicht die Rohware).
      gereinigtKg: cleaned ? Math.max(0, roh[sorte] - (absiebe[sorte] || 0)) : 0,
      cleaned,
      rohSilo: cleaned ? siloStr(rohSet[sorte]) : siloStr(aktSet[sorte]),
      saatSilo: cleaned ? siloStr(aktSet[sorte]) : '',
    };
  }).sort((a,b) => a.fruchtart.localeCompare(b.fruchtart,'de') || a.sorte.localeCompare(b.sorte,'de'));
}

// Mengenübersicht je Sorte/Kultur als Tabelle: Rohware, dt/ha, gereinigte Ware,
// Absiebe (t + %), Roh-/Saatware-Silo. Summen je Kultur + Gesamtsumme.
function mengenUebersicht() {
  const data = mengenUebersichtDaten();
  if(!data.length) return '';
  const flaecheOf = {};
  const kulturen = {};
  data.forEach(d => {
    flaecheOf[d.sorte] = d.flaeche;
    (kulturen[d.fruchtart] = kulturen[d.fruchtart] || []).push({ sorte: d.sorte, roh: d.rohKg, absiebe: d.absiebeKg, gereinigt: d.gereinigtKg, cleaned: d.cleaned, rohSilo: d.rohSilo, saatSilo: d.saatSilo });
  });
  const faSorted = Object.keys(kulturen).sort((a,b) => a.localeCompare(b,'de'));

  const t = kg => (kg/1000).toFixed(1);
  const pct = (a,r) => r > 0 ? (a/r*100) : 0;
  const pctCol = p => p >= 25 ? 'var(--red)' : p >= 15 ? 'var(--gold2)' : p > 0 ? 'var(--green2)' : 'var(--text3)';
  const numTd = (v,extra='') => `<td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;${extra}">${v}</td>`;
  const dtHa = (kg,ha) => ha > 0 ? (kg/100/ha).toFixed(1) : '–';
  const siloTd = v => `<td style="padding:6px 10px;text-align:left;font-size:12px;color:var(--text2);white-space:nowrap">${escapeHtml(v || '–')}</td>`;

  let gRoh = 0, gAbs = 0, gFla = 0, gGer = 0;
  const body = faSorted.map(fa => {
    const list = kulturen[fa].sort((a,b) => a.sorte.localeCompare(b.sorte,'de'));
    const sRoh = list.reduce((s,x) => s + x.roh, 0);
    const sAbs = list.reduce((s,x) => s + x.absiebe, 0);
    const sGer = list.reduce((s,x) => s + x.gereinigt, 0);
    const sFla = list.reduce((s,x) => s + (flaecheOf[x.sorte] || 0), 0);
    gRoh += sRoh; gAbs += sAbs; gFla += sFla; gGer += sGer;
    const farbe = getFruchtFarbe(fa);
    const zeilen = list.map(x => {
      const p = pct(x.absiebe, x.roh);
      return `<tr style="border-bottom:1px solid var(--color-border)">
        <td style="padding:6px 10px 6px 24px;text-align:left;color:var(--text)">🌱 ${escapeHtml(x.sorte)}</td>
        ${numTd(t(x.roh))}
        ${numTd(dtHa(x.roh, flaecheOf[x.sorte] || 0), 'color:var(--blue)')}
        ${numTd(x.cleaned ? '<b>'+t(x.gereinigt)+'</b>' : '<span style="color:var(--text3)">0</span>')}
        ${numTd(x.absiebe > 0 ? t(x.absiebe) : '–')}
        ${numTd(x.absiebe > 0 ? p.toFixed(1)+' %' : '–', 'color:'+pctCol(p))}
        ${siloTd(x.rohSilo)}${siloTd(x.saatSilo)}
      </tr>`;
    }).join('');
    const kopf = `<tr style="background:var(--neutral-200)">
      <td colspan="8" style="padding:7px 10px;text-align:left;font-weight:700;color:var(--text)">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${farbe.dot};margin-right:6px"></span>${escapeHtml(fa)}</td></tr>`;
    const summe = `<tr style="background:var(--neutral-200);font-weight:700;border-top:1px solid var(--color-border)">
      <td style="padding:6px 10px;text-align:left;color:var(--text2)">Σ ${escapeHtml(fa)}</td>
      ${numTd(t(sRoh))}${numTd(dtHa(sRoh, sFla), 'color:var(--blue)')}${numTd(t(sGer))}${numTd(t(sAbs))}
      ${numTd(pct(sAbs,sRoh).toFixed(1)+' %', 'color:'+pctCol(pct(sAbs,sRoh)))}<td></td><td></td></tr>`;
    return kopf + zeilen + summe;
  }).join('');

  const th = 'padding:8px 10px;text-align:right;font-size:11px;color:var(--text2);font-weight:600;border-bottom:2px solid var(--color-border);letter-spacing:.3px';
  const gesamt = `<tr style="font-weight:800;border-top:2px solid var(--color-primary)">
    <td style="padding:9px 10px;text-align:left;color:var(--text)">Gesamt · alle Kulturen</td>
    ${numTd(t(gRoh))}${numTd(dtHa(gRoh, gFla), 'color:var(--blue)')}${numTd(t(gGer))}${numTd(t(gAbs))}
    ${numTd(pct(gAbs,gRoh).toFixed(1)+' %', 'color:'+pctCol(pct(gAbs,gRoh)))}<td></td><td></td></tr>`;

  return `<div class="card">
    <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div class="card-title">Mengenübersicht je Sorte</div>
      <button class="btn btn-sm btn-outline" onclick="exportMengenuebersichtExcel()">⬇ Excel</button>
    </div>
    <div style="font-size:11px;color:var(--text3);margin:-4px 0 10px">Gereinigt = Rohware − Absiebe · Absiebe % = Absiebe / Rohware · Silos: Rohware = Quelle, Saatware = Ziel der Reinigung</div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:720px">
        <thead><tr>
          <th style="${th};text-align:left">Sorte / Kultur</th>
          <th style="${th}">Rohware</th><th style="${th}">dt/ha</th><th style="${th}">Gereinigt</th>
          <th style="${th}">Absiebe</th><th style="${th}">Absiebe&nbsp;%</th>
          <th style="${th};text-align:left">Silo Rohware</th><th style="${th};text-align:left">Silo Saatware</th>
        </tr>
        <tr><th colspan="8" style="padding:0"></th></tr></thead>
        <tbody>${body}${gesamt}</tbody>
      </table>
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
    ${mengenUebersicht()}
    <div class="section-label" style="margin-top:4px">Sorten — anklicken für Fuhren</div>
    ${daten.length ? cards : '<div class="empty-state">Keine Vermehrungssorten hinterlegt.</div>'}`;
}

export function toggleVermehrung(sorte) {
  vermExpanded[sorte] = !vermExpanded[sorte];
  renderAdminVermehrungen();
}
