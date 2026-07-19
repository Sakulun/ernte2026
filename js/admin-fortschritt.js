import { state } from './state.js?v=52';
import { getFeld, netto, fmtDate, fmtTime, escapeHtml, istErnteFuhre } from './helpers.js?v=52';
import { getFruchtFarbe } from './frucht.js?v=52';
import { getQualitaetsfelder } from './quality.js?v=52';

let fortschrittExpanded = {};
let schlagExpanded = {};

// Detail eines Schlags: Liste aller fertigen Fuhren + Summe + Ø-Qualitätswerte
function schlagFuhrenDetail(feldId, fruchtart) {
  const fuhren = state.fuhren
    .filter(f => f.feldId === feldId && f.status === 'fertig')
    .sort((a,b) => new Date(a.zeit) - new Date(b.zeit));
  if(!fuhren.length) return '<div style="font-size:12px;color:var(--text3);padding:6px 4px">Noch keine abgeschlossenen Fuhren.</div>';
  const qf = getQualitaetsfelder(fruchtart);
  const feldMap = { hl: 'hlGewicht' };
  const sumNetto = fuhren.reduce((s,f) => s + (netto(f)||0), 0);
  const avgs = Object.entries(qf).map(([key,q]) => {
    const field = feldMap[key] || key;
    const vals = fuhren.map(f => f[field]).filter(x => x != null);
    const avg = vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : '–';
    return { label: q.label.replace(/\s*\(.*?\)/,''), avg };
  });
  const fuhrRows = fuhren.map(f => {
    const n = netto(f);
    const qStr = Object.entries(qf).map(([key,q]) => {
      const field = feldMap[key] || key;
      return `${q.label.replace(/\s*\(.*?\)/,'')} ${f[field] ?? '–'}`;
    }).join(' · ');
    return `<div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:baseline;padding:6px 2px;border-top:1px solid var(--color-border)">
      <span style="font-size:13px;color:var(--text)">${f.nr} · ${fmtDate(f.zeit)} ${fmtTime(f.zeit)}${f.sorte?` · <span style="color:var(--color-info)">🌱 ${escapeHtml(f.sorte)}</span>`:''}</span>
      <span style="font-size:13px;font-weight:700;color:var(--gold)">${n?(n/1000).toFixed(2)+' t':'–'}</span>
      <span style="grid-column:1/-1;font-size:11px;color:var(--text2)">${qStr}</span>
    </div>`;
  }).join('');
  return `
    <div style="background:var(--neutral-200);border-radius:7px;padding:8px 10px;margin:2px 0 8px">
      ${fuhrRows}
      <div style="display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:space-between;align-items:baseline;margin-top:8px;padding-top:8px;border-top:2px solid var(--color-border)">
        <span style="font-size:13px;color:var(--text)"><b>${fuhren.length}</b> Fuhren · Summe <b>${(sumNetto/1000).toFixed(2)} t</b></span>
        <span style="font-size:12px;color:var(--text2)">${avgs.map(a=>`Ø ${a.label}: <b style="color:var(--text)">${a.avg}</b>`).join(' · ')}</span>
      </div>
    </div>`;
}

export function renderAdminFortschritt() {
  const kulturen = {};
  // Nur echte Schläge – Umlagerung/Zukauf-Quellen gehören nicht in den Erntefortschritt
  state.felder.filter(f => (f.typ||'schlag')==='schlag').forEach(f => {
    if(!kulturen[f.fruchtart]) kulturen[f.fruchtart] = { ha_gesamt:0, ha_aktiv:0, ha_abgeerntet:0, kg_geerntet:0, fuhren:0, schlaege:{} };
    const k = kulturen[f.fruchtart];
    k.ha_gesamt += f.flaeche;
    if(f.status==='aktiv') k.ha_aktiv += f.flaeche;
    if(f.status==='abgeerntet') k.ha_abgeerntet += f.flaeche;
    if(!k.schlaege[f.id]) k.schlaege[f.id] = { id:f.id, name:f.name, flaeche:f.flaeche, status:f.status, kg:0, fuhren:0, letzte:0 };
  });

  state.fuhren.filter(f=>f.status==='fertig' && istErnteFuhre(f)).forEach(f => {
    const fa = f.fruchtart || getFeld(f.feldId).fruchtart || 'Unbekannt';
    if(!kulturen[fa]) kulturen[fa] = { ha_gesamt:0, ha_aktiv:0, ha_abgeerntet:0, kg_geerntet:0, fuhren:0, schlaege:{} };
    const k = kulturen[fa];
    const kg = netto(f)||0;
    k.kg_geerntet += kg;
    k.fuhren++;
    if(k.schlaege[f.feldId]) {
      const s = k.schlaege[f.feldId];
      s.kg += kg;
      s.fuhren++;
      // Fertigstellung = letzte Fuhre des Schlags (kein eigenes Datum in der DB)
      const t = new Date(f.zeit).getTime();
      if(!isNaN(t) && t > s.letzte) s.letzte = t;
    }
  });

  const gesamtHa = state.felder.reduce((s,f)=>s+f.flaeche,0);
  const abgerntetHa = state.felder.filter(f=>f.status==='abgeerntet').reduce((s,f)=>s+f.flaeche,0);
  const aktivHa = state.felder.filter(f=>f.status==='aktiv').reduce((s,f)=>s+f.flaeche,0);
  const gesamtT = state.fuhren.filter(f=>f.status==='fertig' && istErnteFuhre(f)).reduce((s,f)=>s+(netto(f)||0),0);
  const gesamtPct = gesamtHa>0 ? (abgerntetHa/gesamtHa*100) : 0;

  const sorted = Object.entries(kulturen).sort((a,b)=>b[1].ha_gesamt-a[1].ha_gesamt);

  const rows = sorted.map(([fa, k]) => {
    const ha_offen = Math.max(0, k.ha_gesamt - k.ha_abgeerntet - k.ha_aktiv);
    const pct = k.ha_gesamt>0 ? (k.ha_abgeerntet/k.ha_gesamt*100) : 0;
    const pct_aktiv = k.ha_gesamt>0 ? (k.ha_aktiv/k.ha_gesamt*100) : 0;
    const dtHa = k.ha_abgeerntet>0 ? (k.kg_geerntet/100/k.ha_abgeerntet) : null;
    const statusColor = pct>=100 ? 'var(--green2)' : pct>0 ? 'var(--gold2)' : 'var(--text3)';
    const isOpen = fortschrittExpanded[fa] || false;
    const faKey = fa.replace(/[^a-zA-Z0-9]/g,'_');

    const schlagRows = Object.values(k.schlaege)
      .filter(s => s.kg > 0)
      .sort((a,b) => a.letzte - b.letzte || a.name.localeCompare(b.name,'de'));

    const schlagDetail = schlagRows.length ? `
      <div id="detail-${faKey}" style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px;display:${isOpen?'block':'none'}">
        <div class="fs-head">
          <span>Schlag</span><span>Fläche</span><span>Ertrag</span><span>Gesamt</span>
        </div>
        ${schlagRows.map(s => {
          const dt = s.flaeche>0 ? (s.kg/100/s.flaeche) : 0;
          const sOpen = schlagExpanded[s.id] || false;
          return `<div class="fs-row" onclick="toggleFortschrittSchlag(${s.id})">
            <span class="fs-name">${sOpen?'▲':'▼'} ${escapeHtml(s.name)}${s.letzte?` <span class="fs-datum">${fmtDate(s.letzte)}</span>`:''}</span>
            <span class="fs-flaeche">${s.flaeche.toFixed(1)} ha</span>
            <span class="fs-ertrag">${dt.toFixed(1)} dt/ha</span>
            <span class="fs-gesamt">${(s.kg/1000).toFixed(1)} t</span>
          </div>${sOpen ? schlagFuhrenDetail(s.id, fa) : ''}`;
        }).join('')}
      </div>` : '';

    const chevron = schlagRows.length ? `<span style="font-size:11px;color:var(--text2);margin-left:6px">${isOpen?'▲':'▼'}</span>` : '';
    const clickable = schlagRows.length ? `style="cursor:pointer" onclick="toggleFortschritt('${fa}')"` : '';

    return `<div style="border:1px solid var(--color-border);border-radius:var(--radius);padding:14px 16px;margin-bottom:8px;background:var(--color-surface)">
      <div ${clickable}>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <div style="font-size:13px;font-weight:500;color:var(--text);display:flex;align-items:center">
              ${fa}${chevron}
            </div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px">${k.ha_gesamt.toFixed(1)} ha gesamt · ${k.fuhren} Fuhren</div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:12px">
            <div style="font-family:var(--serif);font-size:18px;font-weight:600;color:${statusColor}">${pct.toFixed(0)}%</div>
            <div style="font-size:10px;color:var(--text2)">abgeerntet</div>
          </div>
        </div>
        <div style="background:var(--neutral-200);border-radius:4px;height:10px;overflow:hidden;margin-bottom:10px;display:flex">
          <div style="width:${pct.toFixed(1)}%;background:var(--green);height:100%"></div>
          <div style="width:${pct_aktiv.toFixed(1)}%;background:var(--gold);height:100%"></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:5px 12px">
          <div style="font-size:11px"><span style="color:var(--text2)">Abgeerntet </span><span style="color:var(--green)">${k.ha_abgeerntet.toFixed(1)} ha</span></div>
          <div style="font-size:11px"><span style="color:var(--text2)">In Arbeit </span><span style="color:var(--text)">${k.ha_aktiv.toFixed(1)} ha</span></div>
          <div style="font-size:11px"><span style="color:var(--text2)">Noch offen </span><span style="color:var(--text)">${ha_offen.toFixed(1)} ha</span></div>
          <div style="font-size:11px"><span style="color:var(--text2)">Geerntet </span><span style="color:var(--text)">${(k.kg_geerntet/1000).toFixed(1)} t</span></div>
        </div>
        ${dtHa !== null ? `
        <div style="margin-top:10px;padding:8px 10px;background:var(--neutral-200);border-radius:7px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:11px;color:var(--text2)">Ø Ertrag bisher</span>
          <span style="font-family:var(--serif);font-size:17px;font-weight:600;color:var(--blue)">${dtHa.toFixed(1)} <span style="font-size:11px;font-family:var(--mono);font-weight:400">dt/ha</span></span>
        </div>` : ''}
      </div>
      ${schlagDetail}
    </div>`;
  }).join('');

  const gesamtDtHa = abgerntetHa>0 ? (gesamtT/100/abgerntetHa).toFixed(1) : '–';

  document.getElementById('admintab').innerHTML = `
    <div class="card">
      <div class="card-header"><div class="card-title">Gesamtfortschritt</div></div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px;color:var(--text)">${abgerntetHa.toFixed(1)} von ${gesamtHa.toFixed(1)} ha abgeerntet</div>
        <div style="font-family:var(--serif);font-size:26px;font-weight:600;color:var(--text)">${gesamtPct.toFixed(1)}%</div>
      </div>
      <div style="background:var(--neutral-200);border-radius:6px;height:14px;overflow:hidden;margin:10px 0;display:flex">
        <div style="width:${(gesamtPct).toFixed(1)}%;background:var(--green);height:100%"></div>
        <div style="width:${gesamtHa>0?(aktivHa/gesamtHa*100).toFixed(1):0}%;background:var(--gold);height:100%"></div>
      </div>
      <div style="display:flex;gap:14px;font-size:11px;color:var(--text2);margin-bottom:14px;flex-wrap:wrap">
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--green);border-radius:2px;margin-right:4px"></span>Abgeerntet</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--gold);border-radius:2px;margin-right:4px"></span>In Arbeit</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--neutral-200);border:1px solid var(--color-border);border-radius:2px;margin-right:4px"></span>Noch offen</span>
      </div>
      <div class="stats-grid" style="margin-bottom:0">
        <div class="stat-box"><div class="stat-val">${(gesamtT/1000).toFixed(1)}</div><div class="stat-label">t gesamt</div></div>
        <div class="stat-box"><div class="stat-val" style="color:var(--text)">${abgerntetHa.toFixed(0)}</div><div class="stat-label">ha fertig</div></div>
        <div class="stat-box"><div class="stat-val" style="color:var(--text2)">${(gesamtHa-abgerntetHa-aktivHa).toFixed(0)}</div><div class="stat-label">ha offen</div></div>
        <div class="stat-box"><div class="stat-val" style="color:var(--blue)">${gesamtDtHa}</div><div class="stat-label">Ø dt/ha</div></div>
      </div>
    </div>
    <div class="section-label" style="margin-top:4px">Nach Kultur — anklicken für Schlag-Details</div>
    ${rows}`;
}

export function toggleFortschritt(fa) {
  fortschrittExpanded[fa] = !fortschrittExpanded[fa];
  renderAdminFortschritt();
}

export function toggleFortschrittSchlag(feldId) {
  schlagExpanded[feldId] = !schlagExpanded[feldId];
  renderAdminFortschritt();
}
