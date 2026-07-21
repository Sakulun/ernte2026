import { state } from './state.js?v=58';
import { getFeld, getUser, netto, istErnteFuhre } from './helpers.js?v=58';
import { getFruchtFarbe } from './frucht.js?v=58';
import { fahrerRankingCard } from './admin-fahrer.js?v=58';

export function renderAdminDash() {
  // Nur echte Ernte-Fuhren – Umlagerungen/Zukauf würden die Erntemenge verfälschen
  const fertig = state.fuhren.filter(f=>f.status==='fertig' && istErnteFuhre(f));
  const offen  = state.fuhren.filter(f=>f.status==='offen' && istErnteFuhre(f));
  const totalNet = fertig.reduce((s,f)=>s+(netto(f)||0), 0);
  const gesamtHa = state.felder.reduce((s,f)=>s+f.flaeche, 0);
  const abgHa    = state.felder.filter(f=>f.status==='abgeerntet').reduce((s,f)=>s+f.flaeche, 0);

  const kulturen = {};
  state.felder.filter(f => (f.typ||'schlag')==='schlag').forEach(f => {
    if(!kulturen[f.fruchtart]) kulturen[f.fruchtart] = {ha_gesamt:0, ha_abg:0, ha_aktiv:0, kg:0, fuhren:0};
    const k = kulturen[f.fruchtart];
    k.ha_gesamt += f.flaeche;
    if(f.status==='abgeerntet') k.ha_abg += f.flaeche;
    if(f.status==='aktiv')      k.ha_aktiv += f.flaeche;
  });
  fertig.forEach(f => {
    const fa = f.fruchtart||'Unbekannt';
    if(!kulturen[fa]) kulturen[fa] = {ha_gesamt:0, ha_abg:0, ha_aktiv:0, kg:0, fuhren:0};
    kulturen[fa].kg += (netto(f)||0);
    kulturen[fa].fuhren++;
  });

  const sorted = Object.entries(kulturen).sort((a,b)=>b[1].ha_gesamt-a[1].ha_gesamt);

  const kulturRows = sorted.map(([fa, k]) => {
    const ha_offen = Math.max(0, k.ha_gesamt - k.ha_abg - k.ha_aktiv);
    const pct_abg  = k.ha_gesamt > 0 ? (k.ha_abg / k.ha_gesamt * 100) : 0;
    const pct_aktiv= k.ha_gesamt > 0 ? (k.ha_aktiv / k.ha_gesamt * 100) : 0;
    const tStr     = k.kg > 0 ? (k.kg/1000).toFixed(1)+' t' : '–';
    const dtHa     = k.ha_abg > 0 ? (k.kg/100/k.ha_abg).toFixed(1)+' dt/ha' : '–';
    const farbe    = getFruchtFarbe(fa);
    return `<div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">
        <div style="display:flex;align-items:center;gap:7px">
          <span style="width:10px;height:10px;border-radius:50%;background:${farbe.dot};flex-shrink:0;display:inline-block"></span>
          <span style="font-size:13px;font-weight:600;color:var(--text)">${fa}</span>
        </div>
        <span style="font-size:12px;color:var(--text2)">${k.ha_gesamt.toFixed(1)} ha gesamt</span>
      </div>
      <div style="background:var(--neutral-200);border-radius:4px;height:10px;overflow:hidden;display:flex;margin-bottom:5px">
        <div style="width:${pct_abg.toFixed(1)}%;background:var(--green);height:100%;transition:width .3s"></div>
        <div style="width:${pct_aktiv.toFixed(1)}%;background:var(--gold);height:100%"></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;font-size:11px">
        <div><span style="color:var(--green)">✓ ${k.ha_abg.toFixed(1)} ha</span></div>
        <div><span style="color:var(--text)">${k.ha_aktiv>0?'⚙ '+k.ha_aktiv.toFixed(1)+' ha':'–'}</span></div>
        <div><span style="color:var(--text2)">⬜ ${ha_offen.toFixed(1)} ha</span></div>
        <div style="text-align:right"><span style="color:var(--text)">${tStr}</span>${k.ha_abg>0?` <span style="color:var(--text2)">· ${dtHa}</span>`:''}</div>
      </div>
    </div>`;
  }).join('');

  const liveHtml = offen.length ? offen.map(f=>`
    <div class="fuhre-item" style="border-color:var(--amber)">
      <div class="fuhre-top">
        <span style="font-size:12px"><span class="live-dot"></span> ${f.nr} · wartet auf Waage</span>
        <span class="badge badge-offen">OFFEN</span>
      </div>
      <div class="fuhre-info">
        <div class="fuhre-kv"><span class="fk">Schlag </span><span class="fv">${getFeld(f.feldId).name}</span></div>
        <div class="fuhre-kv"><span class="fk">Fruchtart </span><span class="fv">${f.fruchtart}</span></div>
        <div class="fuhre-kv"><span class="fk">Drescher </span><span class="fv">${getUser(f.drescherId).name}</span></div>
        <div class="fuhre-kv"><span class="fk">Abfahrer </span><span class="fv">${getUser(f.abfahrerId).name}</span></div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        <button class="btn btn-sm btn-outline" onclick="adminTab='fuhren';renderAdmin();toggleFuhreEdit(${f.id})">✏ Bearbeiten</button>
        <button class="btn btn-sm" style="background:var(--blue);color:#fff;border:none" onclick="adminTab='fuhren';renderAdmin();adminAbschliessen(${f.id})">⚖ Abschließen</button>
      </div>
    </div>`).join('') : '<div style="color:var(--text2);font-size:12px;padding:8px 0">Keine offenen Fuhren</div>';

  document.getElementById('admintab').innerHTML=`
    <div class="stats-grid" style="margin-bottom:16px">
      <div class="stat-box"><div class="stat-val">${(totalNet/1000).toFixed(1)}</div><div class="stat-label">Tonnen gesamt</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--green)">${abgHa.toFixed(0)}</div><div class="stat-label">ha abgeerntet</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--text2)">${(gesamtHa-abgHa).toFixed(0)}</div><div class="stat-label">ha noch offen</div></div>
      <div class="stat-box"><div class="stat-val">${fertig.length}</div><div class="stat-label">Fuhren fertig</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Erntefortschritt je Kultur</div>
      </div>
      <div style="font-size:11px;color:var(--text2);display:flex;gap:14px;margin-bottom:12px;flex-wrap:wrap">
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--green);border-radius:2px;margin-right:4px"></span>Abgeerntet</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--gold);border-radius:2px;margin-right:4px"></span>Aktiv</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--neutral-200);border:1px solid var(--color-border);border-radius:2px;margin-right:4px"></span>Offen</span>
      </div>
      ${kulturRows || '<div style="color:var(--text2);font-size:12px">Noch keine Daten</div>'}
    </div>
    ${fahrerRankingCard()}
    <div class="card"><div class="card-header"><div class="card-title">Live-Status</div><button class="btn btn-sm btn-outline" onclick="renderAdmin()">&#8635; Refresh</button></div>${liveHtml}</div>`;
}
