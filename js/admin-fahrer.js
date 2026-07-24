import { state } from './state.js?v=69';
import { getUser, getFeld, netto, kg2t, fmtDate, fmtTime, escapeHtml } from './helpers.js?v=69';
import { getFruchtFarbe } from './frucht.js?v=69';
import { feuchteZuHoch } from './quality.js?v=69';
import { fuhreKm, abladeStelle } from './geo.js?v=69';
import { lagerLabel } from './silo.js?v=69';

// Fahrer-Ranking: Tonnen je Produkt, Gesamtmenge und genäherte Fahrkilometer.
// Klick auf einen Fahrer klappt seine Fuhren auf (neueste zuerst).

const fmt1 = n => n.toLocaleString('de-DE', {minimumFractionDigits:1, maximumFractionDigits:1});
const fmt0 = n => n.toLocaleString('de-DE', {maximumFractionDigits:0});

let _offenerFahrer = null;

export function toggleFahrerDetail(id) {
  _offenerFahrer = (_offenerFahrer === id) ? null : id;
  if(window.renderAdminDash) window.renderAdminDash();
}

export function fahrerRanking() {
  const fahrer = {};
  state.fuhren.filter(f => f.status === 'fertig' && f.abfahrerId).forEach(f => {
    const r = fahrer[f.abfahrerId] || (fahrer[f.abfahrerId] = {
      id: f.abfahrerId, kg: 0, fuhren: 0, km: 0, kmFehlt: 0, gps: 0, produkte: {}, liste: []
    });
    const kg = netto(f) || 0;
    r.kg += kg;
    r.fuhren++;
    r.liste.push(f);
    const p = f.fruchtart || 'Unbekannt';
    r.produkte[p] = (r.produkte[p] || 0) + kg;
    const km = fuhreKm(f);
    if(km == null) r.kmFehlt++; else r.km += km;
    if(abladeStelle(f)?.quelle === 'gps') r.gps++;
  });
  return Object.values(fahrer).sort((a,b) => b.kg - a.kg);
}

// Aufgeklappte Fuhren-Liste eines Fahrers – neueste zuerst.
function fuhrenDetail(r) {
  const fuhren = r.liste.slice().sort((a,b) => new Date(b.zeit) - new Date(a.zeit));
  const zeilen = fuhren.map(f => {
    const n = netto(f);
    const kultur = window.getFuhreKulturKey ? window.getFuhreKulturKey(f) : (f.fruchtart || '–');
    const fr = getFruchtFarbe(f.fruchtart || '');
    const warn = feuchteZuHoch(f);
    const schlag = getFeld(f.feldId).name || '–';
    const lager = f.siloId ? lagerLabel(f.siloId) : null;
    const q = [
      f.feuchte!=null ? `${f.feuchte}%F` : '',
      f.protein!=null ? `${f.protein}%P` : '',
      f.hlGewicht!=null ? `HL ${f.hlGewicht}` : '',
      f.gluten!=null ? `Gluten ${f.gluten}%` : '',
      f.oelgehalt!=null ? `Öl ${f.oelgehalt}%` : '',
    ].filter(Boolean).join(' · ');
    return `<div style="display:flex;gap:8px;align-items:baseline;padding:7px 0;border-top:1px solid var(--color-border)">
      <span style="width:7px;height:7px;border-radius:50%;background:${warn?'var(--color-danger)':fr.dot};flex-shrink:0;transform:translateY(3px)"></span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;color:var(--text)">
          <b>${escapeHtml(f.nr||'')}</b> · ${escapeHtml(kultur)}
          <span style="color:var(--text3)">· ${escapeHtml(schlag)}</span>${lager?` <span style="color:var(--text3)">→ ${escapeHtml(lager)}</span>`:''}
        </div>
        <div style="font-size:11px;color:var(--text3)">
          ${fmtDate(f.zeit)} ${fmtTime(f.zeit)}${q?' · '+q:''}${warn?' <span style="color:var(--color-danger)">⚠ Feuchte</span>':''}
        </div>
      </div>
      <span style="font-size:13px;font-weight:700;color:var(--gold);white-space:nowrap">${n?kg2t(n):'–'}</span>
    </div>`;
  }).join('');
  return `<div style="margin:6px 0 2px;padding:2px 4px 4px 35px">
    <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text3);margin-bottom:2px">
      ${fuhren.length} Fuhre${fuhren.length===1?'':'n'} · neueste zuerst
    </div>
    ${zeilen}
  </div>`;
}

export function fahrerRankingCard() {
  const rang = fahrerRanking();
  if(!rang.length) {
    return `<div class="card"><div class="card-header"><div class="card-title">Fahrer-Ranking</div></div>
      <div style="color:var(--text2);font-size:12px;padding:8px 0">Noch keine abgeschlossenen Fuhren</div></div>`;
  }

  const maxKg    = rang[0].kg || 1;
  const gesamtKm = rang.reduce((s,r) => s+r.km, 0);
  const gpsAnt   = rang.reduce((s,r) => s+r.gps, 0);
  const fuhrenGes= rang.reduce((s,r) => s+r.fuhren, 0);

  const rows = rang.map((r, i) => {
    const platz = i===0 ? '🥇' : i===1 ? '🥈' : i===2 ? '🥉' : `${i+1}.`;
    const pct   = r.kg / maxKg * 100;
    const offen = _offenerFahrer === r.id;
    const chips = Object.entries(r.produkte)
      .sort((a,b) => b[1]-a[1])
      .map(([p, kg]) => {
        const farbe = getFruchtFarbe(p);
        return `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--neutral-100);border:1px solid var(--color-border);border-radius:10px;padding:2px 7px;font-size:11px;white-space:nowrap">
          <span style="width:7px;height:7px;border-radius:50%;background:${farbe.dot};flex-shrink:0"></span>
          <span style="color:var(--text2)">${escapeHtml(p)}</span>
          <b style="color:var(--text)">${fmt1(kg/1000)} t</b>
        </span>`;
      }).join('');

    return `<div style="padding:10px 0;border-bottom:1px solid var(--color-border)">
      <div onclick="toggleFahrerDetail(${r.id})" style="cursor:pointer">
        <div style="display:flex;align-items:baseline;gap:9px">
          <span style="font-size:14px;width:26px;flex-shrink:0;color:var(--text2)">${platz}</span>
          <span style="font-size:13px;font-weight:700;color:var(--text);flex:1;min-width:0">
            <span style="color:var(--text3);font-weight:400;font-size:11px">${offen?'▾':'▸'}</span> ${escapeHtml(getUser(r.id).name || 'Unbekannt')}
          </span>
          <span style="font-family:var(--serif);font-size:15px;font-weight:700;color:var(--gold);white-space:nowrap">${fmt1(r.kg/1000)} t</span>
        </div>
        <div style="display:flex;align-items:center;gap:9px;margin-top:5px">
          <span style="width:26px;flex-shrink:0"></span>
          <div style="flex:1;background:var(--neutral-200);border-radius:3px;height:6px;overflow:hidden">
            <div style="width:${pct.toFixed(1)}%;height:100%;background:var(--color-primary)"></div>
          </div>
          <span style="font-size:11px;color:var(--text2);white-space:nowrap">${r.fuhren} Fuhre${r.fuhren===1?'':'n'} · ~${fmt0(r.km)} km</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:7px;padding-left:35px">${chips}</div>
        ${r.kmFehlt ? `<div style="font-size:10px;color:var(--text3);margin-top:4px;padding-left:35px">${r.kmFehlt} Fuhre${r.kmFehlt===1?'':'n'} ohne Schlagbezug (Zukauf/Umlagerung) – nicht in den km enthalten</div>` : ''}
      </div>
      ${offen ? fuhrenDetail(r) : ''}
    </div>`;
  }).join('');

  return `<div class="card">
    <div class="card-header"><div class="card-title">Fahrer-Ranking</div>
      <span style="font-size:11px;color:var(--text2)">${fmt0(gesamtKm)} km gesamt · ${fuhrenGes} Fuhren</span>
    </div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Klick auf einen Fahrer zeigt seine Fuhren.</div>
    ${rows}
    <div style="font-size:10px;color:var(--text3);margin-top:9px;line-height:1.5">
      Kilometer genähert: Luftlinie Schlagmittelpunkt → Abladestelle × 1,3 (Umwegfaktor), einfache Strecke ohne Rückweg.
      Abladestelle aus der beim Wiegen erfassten GPS-Position (${gpsAnt} von ${fuhrenGes} Fuhren), sonst aus dem Standort des Lagers.
    </div>
  </div>`;
}
