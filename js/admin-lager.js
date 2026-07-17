import { state } from './state.js?v=46';
import { getFeld, netto, kg2t, fmtDate, fmtTime, escapeHtml, sorteBadge } from './helpers.js?v=46';
import { getFruchtFarbe } from './frucht.js?v=46';
import { getSiloBioStatus, bioBadge } from './bio.js?v=46';
import { feuchteZuHoch } from './quality.js?v=46';
import { lagerGruppen, getSiloAusgang, fuhreHerkunft } from './silo.js?v=46';

// Lagerübersicht: alle Lagerstätten nach Orten getrennt. Je Lager zunächst nur
// Produkt, Ø-Qualität und Herkunft (Schläge) – Klick klappt die Einzelfuhren auf.

let _offenesLager = null;

export function toggleLagerDetail(id) {
  _offenesLager = (_offenesLager === id) ? null : id;
  renderAdminLager();
}

function lagerDaten(l) {
  const fuhren = state.fuhren
    .filter(f => f.siloId === l.id && f.status === 'fertig')
    .sort((a,b) => new Date(b.zeit) - new Date(a.zeit));
  const zugangKg  = fuhren.reduce((s,f) => s+(netto(f)||0), 0);
  const ausgangKg = getSiloAusgang(l.id);
  const bestandKg = Math.max(0, zugangKg - ausgangKg);
  const avg = key => {
    const v = fuhren.filter(f => f[key] != null);
    return v.length ? (v.reduce((s,f) => s+f[key], 0)/v.length).toFixed(1) : null;
  };
  const kulturen = [...new Set(fuhren.map(f => window.getFuhreKulturKey ? window.getFuhreKulturKey(f) : f.fruchtart))];
  const schlaege = [...new Set(fuhren.map(f => getFeld(f.feldId).name || '–'))];
  const betriebe = [...new Set(fuhren.map(fuhreHerkunft).filter(Boolean))];
  return { fuhren, zugangKg, ausgangKg, bestandKg, avg, kulturen, schlaege, betriebe };
}

function qualiText(d) {
  const teile = [];
  const f = d.avg('feuchte'), p = d.avg('protein'), h = d.avg('hlGewicht'), g = d.avg('gluten'), o = d.avg('oelgehalt');
  if(f) teile.push(`Feuchte ${f}%`);
  if(p) teile.push(`Protein ${p}%`);
  if(h) teile.push(`HL ${h}`);
  if(g) teile.push(`Gluten ${g}%`);
  if(o) teile.push(`Öl ${o}%`);
  return teile.join(' · ');
}

function fuhrenListe(d) {
  return `<div style="border-top:1px solid var(--color-border);margin-top:10px;padding-top:10px">
    <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text2);margin-bottom:8px">
      ${d.fuhren.length} Fuhre${d.fuhren.length===1?'':'n'}
    </div>
    ${d.fuhren.map(f => {
      const n = netto(f);
      const fr = getFruchtFarbe(f.fruchtart);
      const warn = feuchteZuHoch(f);
      const q = [
        f.feuchte!=null ? `${f.feuchte}%F` : '',
        f.protein!=null ? `${f.protein}%P` : '',
        f.hlGewicht!=null ? `HL ${f.hlGewicht}` : '',
        f.gluten!=null ? `Gluten ${f.gluten}%` : '',
        f.oelgehalt!=null ? `Öl ${f.oelgehalt}%` : '',
      ].filter(Boolean).join(' · ');
      return `<div style="display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--color-border)">
        <span style="width:6px;height:6px;border-radius:50%;background:${warn?'var(--color-danger)':fr.dot};flex-shrink:0"></span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;color:var(--text)">
            <b>${escapeHtml(f.nr)}</b> · ${escapeHtml(getFeld(f.feldId).name||'–')}${sorteBadge(f)}
            <span style="color:var(--text3)"> · ${escapeHtml(fuhreHerkunft(f))}</span>
          </div>
          <div style="font-size:11px;color:var(--text3)">${fmtDate(f.zeit)} ${fmtTime(f.zeit)}${q?' · '+q:''}${warn?' <span style="color:var(--color-danger)">⚠ Feuchte</span>':''}</div>
        </div>
        <div style="font-size:13px;font-weight:700;color:var(--gold);white-space:nowrap">${n?kg2t(n):'–'}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function lagerKarte(l) {
  const d = lagerDaten(l);
  const leer = d.bestandKg <= 0 && !d.fuhren.length;
  const offen = _offenesLager === l.id;
  const bestandT = d.bestandKg/1000;
  const pct = l.kapT ? Math.min(100, bestandT/l.kapT*100) : null;
  const barFarbe = pct==null ? 'var(--color-primary)' : pct>85 ? 'var(--color-warning)' : 'var(--color-primary)';
  const bio = getSiloBioStatus(l.id) === 'bio';
  const kulturFarbe = getFruchtFarbe(d.kulturen[0]||'').dot;

  if(leer) {
    return `<div class="card" style="margin-bottom:6px;opacity:.5;display:flex;justify-content:space-between;align-items:center;padding:10px 14px">
      <span style="font-size:13px;color:var(--text2)">${escapeHtml(l.label)}</span>
      <span style="font-size:12px;color:var(--text3)">leer${l.kapT?` · ${l.kapT.toLocaleString('de-DE')} t frei`:''}</span>
    </div>`;
  }

  return `<div class="card" style="margin-bottom:8px;padding:0;overflow:hidden;border-left:4px solid ${kulturFarbe}">
    <div onclick="toggleLagerDetail('${escapeHtml(l.id)}')" style="cursor:pointer;padding:12px 14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div style="min-width:0;flex:1">
          <div style="font-size:14px;font-weight:700;color:var(--text)">
            ${offen?'▾':'▸'} ${escapeHtml(l.label)}${bio?bioBadge(true):''}
          </div>
          <div style="font-size:13px;font-weight:600;color:${kulturFarbe};margin-top:2px">
            ${escapeHtml(d.kulturen.join(', ') || '–')}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:var(--serif);font-size:17px;font-weight:700;color:var(--text)">${bestandT.toFixed(1)} t</div>
          <div style="font-size:10px;color:var(--text3)">${l.kapT ? `von ${l.kapT.toLocaleString('de-DE')} t · ${pct.toFixed(0)}%` : `${d.fuhren.length} Fuhren`}</div>
        </div>
      </div>
      ${l.kapT ? `<div style="background:var(--neutral-200);border-radius:4px;height:6px;overflow:hidden;margin-top:8px">
        <div style="width:${pct.toFixed(1)}%;height:100%;background:${barFarbe}"></div>
      </div>` : ''}
      ${qualiText(d) ? `<div style="font-size:11px;color:var(--text2);margin-top:8px">Ø ${qualiText(d)}</div>` : ''}
      <div style="font-size:11px;color:var(--text3);margin-top:3px">
        Herkunft: ${escapeHtml(d.schlaege.slice(0,4).join(', '))}${d.schlaege.length>4?` +${d.schlaege.length-4} weitere`:''}
      </div>
      ${d.ausgangKg > 0 ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">Zugang ${(d.zugangKg/1000).toFixed(1)} t − Ausgang ${(d.ausgangKg/1000).toFixed(1)} t</div>` : ''}
    </div>
    ${offen ? `<div style="padding:0 14px 12px">${fuhrenListe(d)}</div>` : ''}
  </div>`;
}

export function renderAdminLager() {
  const gruppen = lagerGruppen();
  // Kennzahlen über alle Lager
  let gesamtKg = 0, belegte = 0;
  gruppen.forEach(g => g.lager.forEach(l => {
    const d = lagerDaten(l);
    gesamtKg += d.bestandKg;
    if(d.bestandKg > 0 || d.fuhren.length) belegte++;
  }));

  const ortBlock = (g) => {
    const daten = g.lager.map(l => ({ l, d: lagerDaten(l) }));
    const ortKg = daten.reduce((s,x) => s+x.d.bestandKg, 0);
    const belegt = daten.filter(x => x.d.bestandKg > 0 || x.d.fuhren.length);
    const leer = daten.filter(x => !(x.d.bestandKg > 0 || x.d.fuhren.length));
    return `<div style="margin-bottom:22px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid var(--color-primary);padding-bottom:5px;margin-bottom:10px">
        <div style="font-family:var(--font-display);font-size:17px;color:var(--color-text)">📍 ${escapeHtml(g.ort)}</div>
        <div style="font-size:12px;color:var(--text2)">${belegt.length} belegt · <b style="color:var(--text)">${(ortKg/1000).toFixed(1)} t</b></div>
      </div>
      ${belegt.map(x => lagerKarte(x.l)).join('') || '<div style="font-size:12px;color:var(--text3);padding:4px 0 8px">Keine belegten Lager an diesem Standort.</div>'}
      ${leer.length ? `<div style="font-size:11px;color:var(--text3);margin-top:4px">Leer: ${leer.map(x=>escapeHtml(x.l.label)).join(' · ')}</div>` : ''}
    </div>`;
  };

  document.getElementById('admintab').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:18px">
      <div class="stat-box"><div class="stat-val" style="color:var(--gold)">${(gesamtKg/1000).toFixed(1)}</div><div class="stat-label">t im Lager</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--text)">${belegte}</div><div class="stat-label">belegte Lager</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--text)">${gruppen.length}</div><div class="stat-label">Standorte</div></div>
    </div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:12px">Klick auf ein Lager zeigt die einzelnen Fuhren.</div>
    ${gruppen.map(ortBlock).join('')}`;
}
