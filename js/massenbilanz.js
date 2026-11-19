import { state } from './state.js?v=170';
import { getFeld, netto, escapeHtml, showToast } from './helpers.js?v=170';
import { getFruchtFarbe } from './frucht.js?v=170';
import { isBioFuhre } from './bio.js?v=170';
import { getKontraktGeliefertKg, kontraktEingangFuhren } from './kontrakte.js?v=170';
import { ensureXLSX } from './export.js?v=170';

// ── Massenbilanz ─────────────────────────────────────────────────────────────
// Je Produkt das Aufkommen (eigene Ernte + Zukauf von Dritten) gegen die Mengen,
// die über Verkaufskontrakte bereits gebunden sind – getrennt nach Bio/konventionell.
// Vermehrungsware wird gesondert ausgewiesen: sie steht nicht für den Konsumverkauf
// (z. B. an die Mühle) zur Verfügung, und es gibt für sie keine Kontrakte.
//
// Quellen:
//   Ernte     = abgeschlossene Fuhren von Schlägen (Feldtyp 'schlag'). Vermehrung = Fuhre mit Sorte.
//   Zukauf    = abgeschlossene Fuhren von Lieferanten (Feldtyp 'lieferant' oder mit Einkaufskontrakt).
//   Absiebe   = Reinigungsabgänge der Vermehrung (Feldtyp 'reinigung'): gehen von der Vermehrungs-
//               in die Konsumware über (Vermehrung −, Konsum +), die Summe bleibt gleich.
//   Verkauft  = nicht stornierte Verkaufskontrakte (Menge), davon geliefert wie im Kontrakte-Tab.
//               Bio/konventionell über den Schalter „EU-Öko-Ware“ am Kontrakt.
//   EK offen  = Einkaufskontrakte: kontrahierte, noch nicht angelieferte Menge (künftiger Zugang).
// Bio/konventionell der Fuhren über das Bio-Kennzeichen der Fläche (isBioFuhre).
// Umlagerungen sind interne Bewegungen und zählen nicht.

let _offen = null;          // aufgeklappte Zeile 'konsum|bio|Weizen'
let _ohneSilomais = true;   // Silomais (Biogas) standardmäßig ausblenden
let _detail = false;        // Detailansicht: jede Kultur aufgeklappt nach Betrieben

// Produktgruppen: Fuhren-Fruchtarten ("Winterweichweizen") und Artikel ("Winterweizen")
// laufen auf denselben Namen. Reihenfolge zählt (Silomais vor Mais, Öl vor Sonnenblumen …).
const PRODUKTE = [
  ['Umstellungsweizen', /umstell/i],
  // Nur wenn die Kultur MIT Silomais beginnt – "Mais (ohne Silomais NC 411)" ist Körnermais!
  ['Silomais', /^s*silomais/i],
  ['Durum', /durum|hartweizen/i],
  ['Weizen', /weizen/i],
  ['Gerste', /gerste/i],
  ['Triticale', /triticale/i],
  ['Roggen', /roggen/i],
  ['Hafer', /hafer/i],
  ['Raps', /raps/i],
  ['Sonnenblumenöl', /sonnenblumen\s*-?öl/i],
  ['Sonnenblumenpresskuchen', /presskuchen/i],
  ['Sonnenblumen', /sonnenblume/i],
  ['Sojabohnen', /soja/i],
  ['Körnermais', /mais/i],
  ['Erbsen', /erbse/i],
  ['Ackerbohnen', /ackerbohne/i],
  ['Zuckerrüben', /zuckerr/i],
];
export function produktVon(name) {
  const n = (name || '').trim();
  if(!n) return 'Ohne Zuordnung';
  const p = PRODUKTE.find(([, re]) => re.test(n));
  return p ? p[0] : n;
}
// Farbe der Produktzeile aus der passenden Kultur
const FARB_KULTUR = { Weizen:'Winterweichweizen', Durum:'Winterdurum (Hartweizen)', Gerste:'Wintergerste',
  Triticale:'Wintertriticale', Raps:'Winterraps', 'Körnermais':'Mais (ohne Silomais NC 411)', Sojabohnen:'Sojabohnen' };
const farbe = p => getFruchtFarbe(FARB_KULTUR[p] || p).dot;

function kontraktName(k) {
  const art = state.artikel.find(a => a.id === k.artikel_id);
  return (art?.name || k.fruchtart_text || '').trim();
}

// Die vier Bereiche der Bilanz (Reihenfolge = Anzeige)
export const BEREICHE = [
  { key:'konsum|konv',     art:'konsum',     bio:false, titel:'🌾 Konsumware · konventionell' },
  { key:'konsum|bio',      art:'konsum',     bio:true,  titel:'🌿 Konsumware · Bio' },
  { key:'vermehrung|konv', art:'vermehrung', bio:false, titel:'🌱 Vermehrungsware · konventionell' },
  { key:'vermehrung|bio',  art:'vermehrung', bio:true,  titel:'🌱 Vermehrungsware · Bio' },
];

export function massenbilanzDaten() {
  const leer = () => ({ ernteKg:0, zukaufKg:0, absiebeKg:0, ekOffenT:0, kontrahiertT:0, geliefertT:0,
    kontrakte:[], quellen:{}, betriebe:{}, lieferanten:{} });
  const bil = Object.fromEntries(BEREICHE.map(b => [b.key, {}]));
  const zeile = (art, bio, p) => { const t = bil[art + '|' + (bio ? 'bio' : 'konv')]; return t[p] || (t[p] = leer()); };
  const quelle = (z, name, kg) => { z.quellen[name] = (z.quellen[name] || 0) + kg; };

  state.fuhren.filter(f => f.status === 'fertig').forEach(f => {
    const kg = netto(f) || 0;
    if(kg <= 0) return;
    const feld = getFeld(f.feldId);
    const typ = feld.typ || 'schlag';
    if(typ === 'umlagerung') return;           // intern, zählt nicht
    const p = produktVon(f.fruchtart);
    const bio = isBioFuhre(f);
    const art = f.sorte ? 'vermehrung' : 'konsum';
    if(typ === 'lieferant' || f.einkaufskontrakt) {
      const l = feld.name || 'Lieferant';
      const z = zeile(art, bio, p); z.zukaufKg += kg; quelle(z, '🚚 Zukauf · ' + l, kg);
      z.lieferanten[l] = (z.lieferanten[l] || 0) + kg;
    } else if(typ === 'reinigung') {
      // Absiebe aus der Saatgutreinigung: aus der Vermehrung in die Konsumware (nicht je Sorte aufteilen)
      const n = '🌀 Absiebe aus der Reinigung';
      const zk = zeile('konsum', bio, p); zk.absiebeKg += kg; quelle(zk, n, kg);
      const zv = zeile('vermehrung', bio, p); zv.absiebeKg -= kg; quelle(zv, n, -kg);
    } else if(typ === 'schlag') {
      // Ernte je eigenem Betrieb (Betrieb des Schlags)
      const be = (feld.betrieb || '').trim() || 'Ohne Betrieb';
      const z = zeile(art, bio, p); z.ernteKg += kg; quelle(z, '🏡 ' + be, kg);
      z.betriebe[be] = (z.betriebe[be] || 0) + kg;
    }
  });

  // Kontrakte gibt es nur für Konsumware
  state.kontrakte.filter(k => k.status !== 'storniert').forEach(k => {
    const einkauf = (k.richtung || 'verkauf') === 'einkauf';
    const name = kontraktName(k) || (einkauf ? (kontraktEingangFuhren(k)[0]?.fruchtart || '') : '');
    const z = zeile('konsum', !!k.bio, produktVon(name));
    const geliefertT = getKontraktGeliefertKg(k.id) / 1000;
    if(einkauf) {
      z.ekOffenT += k.status === 'erfuellt' ? 0 : Math.max(0, (Number(k.menge_t) || 0) - geliefertT);
    } else {
      z.kontrahiertT += Number(k.menge_t) || 0;
      z.geliefertT += geliefertT;
      z.kontrakte.push(k);
    }
  });

  const fertig = key => Object.entries(bil[key])
    .filter(([p]) => !(_ohneSilomais && p === 'Silomais'))
    .map(([produkt, z]) => {
      const aufkommenT = (z.ernteKg + z.zukaufKg + z.absiebeKg) / 1000;
      return { produkt, ...z, ernteT:z.ernteKg/1000, zukaufT:z.zukaufKg/1000, absiebeT:z.absiebeKg/1000,
        aufkommenT, offenT: Math.max(0, z.kontrahiertT - z.geliefertT), freiT: aufkommenT - z.kontrahiertT };
    })
    .filter(r => Math.abs(r.aufkommenT) > 0.05 || r.kontrahiertT > 0 || r.ekOffenT > 0 || Math.abs(r.absiebeT) > 0.05)
    .sort((a, b) => (b.aufkommenT + b.kontrahiertT) - (a.aufkommenT + a.kontrahiertT));
  return Object.fromEntries(BEREICHE.map(b => [b.key, fertig(b.key)]));
}

export function toggleMassenbilanzZeile(key) { _offen = _offen === key ? null : key; renderMassenbilanz(); }
export function massenbilanzSilomais(an) { _ohneSilomais = !an; renderMassenbilanz(); }
export function massenbilanzDetail() { _detail = !_detail; renderMassenbilanz(); }

// Detailansicht: Unterzeilen je eigenem Betrieb (Spalte Ernte) und je Lieferant (Spalte Zukauf).
// spalten = Anzahl Zellen nach "Ernte" und "Zukauf" bis Tabellenende.
function betriebsZeilen(r, restSpalten) {
  const sortiert = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
  const anteil = (kg, ges) => ges > 0 ? `<span style="color:var(--text3);font-weight:400"> · ${Math.round(kg / ges * 100)} %</span>` : '';
  const sub = (name, ernte, zukauf) => `<tr style="font-size:11.5px;background:var(--bg2)">
      <td style="padding:4px 8px 4px 34px;color:var(--text2);white-space:nowrap">${name}</td>
      <td style="padding:4px 8px;text-align:right;white-space:nowrap;color:var(--text)">${ernte}</td>
      <td style="padding:4px 8px;text-align:right;white-space:nowrap;color:var(--text)">${zukauf}</td>
      <td colspan="${restSpalten}"></td></tr>`;
  const b = sortiert(r.betriebe).map(([n, kg]) => sub('🏡 ' + escapeHtml(n), `${t1(kg/1000)}${anteil(kg, r.ernteKg)}`, ''));
  const l = sortiert(r.lieferanten).map(([n, kg]) => sub('🚚 ' + escapeHtml(n), '', `${t1(kg/1000)}${anteil(kg, r.zukaufKg)}`));
  return b.join('') + l.join('');
}

const t1 = n => (Math.abs(n) < 0.05 ? 0 : n).toLocaleString('de-DE', { minimumFractionDigits:1, maximumFractionDigits:1 });
const tZ = n => Math.abs(n) < 0.05 ? '<span style="color:var(--text3)">–</span>' : t1(n);
const GRUEN = 'var(--color-success, var(--color-primary))';

function detailHTML(z, mitKontrakten) {
  const quellen = Object.entries(z.quellen).sort((a, b) => b[1] - a[1]);
  const kontrakte = [...z.kontrakte].sort((a, b) => (b.menge_t || 0) - (a.menge_t || 0));
  const kunde = k => state.kontakte.find(c => c.id === k.kontakt_id)?.name || '–';
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;padding:10px 12px;background:var(--bg2)">
    <div>
      <div class="mb-detail-titel">Herkunft</div>
      ${quellen.length ? quellen.map(([n, kg]) => `<div class="mb-detail-zeile"><span>${escapeHtml(n)}</span><b>${t1(kg/1000)} t</b></div>`).join('')
        : '<div style="font-size:12px;color:var(--text3)">Keine Ernte oder Zukauf erfasst.</div>'}
    </div>
    ${mitKontrakten ? `<div>
      <div class="mb-detail-titel">Verkaufskontrakte</div>
      ${kontrakte.length ? kontrakte.map(k => `<div class="mb-detail-zeile">
          <span><b>${escapeHtml(k.nummer || '–')}</b> · ${escapeHtml(kunde(k))}<span style="color:var(--text3)"> · ${escapeHtml(kontraktName(k))}${k.status==='erfuellt'?' · erfüllt':''}</span></span>
          <b>${t1(getKontraktGeliefertKg(k.id)/1000)} / ${t1(Number(k.menge_t)||0)} t</b></div>`).join('')
        : '<div style="font-size:12px;color:var(--text3)">Noch keine Verkaufskontrakte.</div>'}
    </div>` : ''}
  </div>`;
}

const th = (t, r = true, title = '') => `<th style="padding:7px 8px;text-align:${r?'right':'left'};white-space:nowrap"${title?` title="${title}"`:''}>${t}</th>`;
const zelle = (v, extra = '') => `<td style="padding:7px 8px;text-align:right;white-space:nowrap;${extra}">${v}</td>`;
const tabStil = 'width:100%;border-collapse:collapse;font-size:12px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden';
const kopfStil = 'font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);background:var(--bg2)';

function produktZelle(key, r) {
  return `<td style="padding:7px 8px;white-space:nowrap"><span style="color:var(--text3);font-size:11px">${_offen===key?'▾':'▸'}</span>
    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${farbe(r.produkt)};margin:0 5px 0 3px"></span><b style="color:var(--text)">${escapeHtml(r.produkt)}</b></td>`;
}
function abschnitt(b, inhalt, hinweis) {
  return `<div style="margin-bottom:22px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid ${b.bio?GRUEN:'var(--color-primary)'};padding-bottom:5px;margin-bottom:8px;gap:10px;flex-wrap:wrap">
      <div style="font-family:var(--font-display);font-size:17px;color:var(--color-text)">${b.titel}</div>
      <div style="font-size:12px;color:var(--text2)">${hinweis}</div>
    </div>
    <div style="overflow-x:auto">${inhalt}</div>
  </div>`;
}

// Konsumware: Aufkommen gegen Verkaufskontrakte
function konsumTabelle(b, rows) {
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  const bar = r => {
    if(r.aufkommenT <= 0) return '';
    const pct = Math.min(100, r.kontrahiertT / r.aufkommenT * 100);
    const c = r.kontrahiertT > r.aufkommenT + 0.05 ? 'var(--red)' : pct > 90 ? GRUEN : 'var(--gold)';
    return `<div style="display:flex;align-items:center;gap:6px"><div style="flex:1;background:var(--neutral-200);border-radius:6px;height:8px;overflow:hidden;min-width:50px"><div style="width:${pct}%;height:100%;background:${c}"></div></div><span style="font-size:11px;color:var(--text2);width:34px;text-align:right">${Math.round(r.kontrahiertT / r.aufkommenT * 100)}%</span></div>`;
  };
  const frei = v => v < -0.05
    ? `<span style="color:var(--red);font-weight:700" title="Mehr kontrahiert als vorhanden">${t1(v)}</span>`
    : `<span style="color:${GRUEN};font-weight:700">${t1(v)}</span>`;
  const zeile = r => {
    const key = b.key + '|' + r.produkt;
    return `<tr style="border-top:1px solid var(--color-border);cursor:pointer" data-key="${escapeHtml(key)}" onclick="toggleMassenbilanzZeile(this.dataset.key)">
      ${produktZelle(key, r)}
      ${zelle(tZ(r.ernteT))}${zelle(tZ(r.zukaufT))}${zelle(tZ(r.absiebeT), 'color:var(--text2)')}
      ${zelle(`<b>${t1(r.aufkommenT)}</b>`, 'background:var(--bg2)')}
      ${zelle(tZ(r.kontrahiertT))}${zelle(tZ(r.geliefertT), 'color:var(--gold)')}${zelle(tZ(r.offenT), 'color:var(--text2)')}
      ${zelle(frei(r.freiT), 'background:var(--bg2)')}
      <td style="padding:7px 8px;min-width:110px">${bar(r)}</td>
      ${zelle(tZ(r.ekOffenT), 'color:var(--text3)')}
    </tr>${_detail ? betriebsZeilen(r, 8) : ''}${_offen === key ? `<tr><td colspan="11" style="padding:0">${detailHTML(r, true)}</td></tr>` : ''}`;
  };
  const tot = { aufkommenT:sum('aufkommenT'), kontrahiertT:sum('kontrahiertT') };
  return abschnitt(b, `<table style="${tabStil}">
      <thead><tr style="${kopfStil}">
        ${th('Produkt', false)}${th('Ernte')}${th('Zukauf', true, 'Von Dritten angeliefert (Lieferanten, Einkaufskontrakte)')}${th('Absiebe', true, 'Reinigungsabgänge der Vermehrung, in die Konsumware umgebucht')}
        ${th('Aufkommen')}${th('Kontrahiert', true, 'Verkaufskontrakte (aktiv + erfüllt)')}${th('geliefert')}${th('noch zu liefern')}
        ${th('Frei', true, 'Aufkommen − kontrahiert = noch nicht verkauft')}${th('verkauft', false)}${th('EK offen', true, 'Einkaufskontrakte: noch nicht angelieferte Menge (künftiger Zugang)')}
      </tr></thead>
      <tbody>
        ${rows.map(zeile).join('') || `<tr><td colspan="11" style="padding:12px;color:var(--text3)">Keine Daten.</td></tr>`}
        ${rows.length ? `<tr style="border-top:2px solid var(--border2);font-weight:700">
          <td style="padding:7px 8px">Gesamt</td>
          ${zelle(t1(sum('ernteT')))}${zelle(t1(sum('zukaufT')))}${zelle(tZ(sum('absiebeT')))}
          ${zelle(t1(tot.aufkommenT), 'background:var(--bg2)')}${zelle(t1(tot.kontrahiertT))}${zelle(t1(sum('geliefertT')))}${zelle(t1(sum('offenT')))}
          ${zelle(frei(sum('freiT')), 'background:var(--bg2)')}<td style="padding:7px 8px">${bar(tot)}</td>${zelle(tZ(sum('ekOffenT')))}
        </tr>` : ''}
      </tbody>
    </table>`, 'Ernte ohne Sorte · Zukauf · Absiebe aus der Reinigung');
}

// Vermehrungsware: nur Aufkommen – keine Kontrakte, nicht für den Konsumverkauf verfügbar
function vermehrungTabelle(b, rows) {
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  const zeile = r => {
    const key = b.key + '|' + r.produkt;
    return `<tr style="border-top:1px solid var(--color-border);cursor:pointer" data-key="${escapeHtml(key)}" onclick="toggleMassenbilanzZeile(this.dataset.key)">
      ${produktZelle(key, r)}
      ${zelle(tZ(r.ernteT))}${zelle(tZ(r.zukaufT))}${zelle(tZ(r.absiebeT), 'color:var(--text2)')}
      ${zelle(`<b>${t1(r.aufkommenT)}</b>`, 'background:var(--bg2)')}
    </tr>${_detail ? betriebsZeilen(r, 2) : ''}${_offen === key ? `<tr><td colspan="5" style="padding:0">${detailHTML(r, false)}</td></tr>` : ''}`;
  };
  return abschnitt(b, `<table style="${tabStil};max-width:640px">
      <thead><tr style="${kopfStil}">
        ${th('Produkt', false)}${th('Ernte')}${th('Zukauf')}${th('Absiebe', true, 'Reinigungsabgänge: an die Konsumware abgegeben')}${th('Bestand Vermehrung')}
      </tr></thead>
      <tbody>
        ${rows.map(zeile).join('')}
        <tr style="border-top:2px solid var(--border2);font-weight:700">
          <td style="padding:7px 8px">Gesamt</td>
          ${zelle(t1(sum('ernteT')))}${zelle(tZ(sum('zukaufT')))}${zelle(tZ(sum('absiebeT')))}${zelle(t1(sum('aufkommenT')), 'background:var(--bg2)')}
        </tr>
      </tbody>
    </table>`, 'nicht für den Konsumverkauf verfügbar');
}

export function renderMassenbilanz() {
  const el = document.getElementById('admintab');
  if(!el) return;
  const d = massenbilanzDaten();
  const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
  const konsum = bio => d['konsum|' + (bio ? 'bio' : 'konv')];
  const verm = [...d['vermehrung|konv'], ...d['vermehrung|bio']];
  const kachel = (wert, label, farbe) => `<div class="stat-box"><div class="stat-val" style="color:${farbe}">${wert}</div><div class="stat-label">${label}</div></div>`;
  const kachelZeile = bio => {
    const rows = konsum(bio);
    const auf = sum(rows, 'aufkommenT'), k = sum(rows, 'kontrahiertT');
    return [kachel(t1(auf), `t Konsum ${bio?'Bio':'konv.'}`, 'var(--text)'),
      kachel(t1(k), 't kontrahiert', 'var(--gold)'),
      kachel(t1(auf - k), 't frei', auf - k < -0.05 ? 'var(--red)' : GRUEN)].join('');
  };
  const ueber = [...konsum(false), ...konsum(true)].filter(r => r.freiT < -0.05).length;
  el.innerHTML = `
    <style>
      .mb-detail-titel{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text3);margin-bottom:6px}
      .mb-detail-zeile{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--text);padding:4px 0;border-bottom:1px solid var(--color-border)}
      .mb-detail-zeile b{white-space:nowrap}
    </style>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:8px">${kachelZeile(false)}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:8px">${kachelZeile(true)}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:14px">
      ${kachel(t1(sum(verm, 'aufkommenT')), 't Vermehrung (gesondert)', 'var(--color-info, var(--text))')}
      ${kachel(ueber, 'überverkauft', ueber ? 'var(--red)' : 'var(--text)')}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      <label style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" ${_ohneSilomais?'':'checked'} onchange="massenbilanzSilomais(this.checked)" style="width:16px;height:16px;accent-color:var(--gold)"> Silomais einbeziehen
      </label>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm ${_detail?'btn-primary':'btn-outline'}" onclick="massenbilanzDetail()" title="Jede Kultur aufklappen: Menge je Betrieb und je Lieferant">${_detail?'▾ Detailansicht aus':'▸ Detailansicht'}</button>
        <button class="btn btn-sm btn-outline" onclick="exportMassenbilanzExcel()">⬇ Excel</button>
      </div>
    </div>
    ${BEREICHE.map(b => {
      const rows = d[b.key];
      if(b.art === 'konsum') return konsumTabelle(b, rows);
      return rows.length ? vermehrungTabelle(b, rows) : '';
    }).join('')}
    <div style="font-size:11px;color:var(--text3);line-height:1.6">
      Klick auf ein Produkt zeigt Herkunft und Kontrakte. Bio/konventionell nach dem Bio-Kennzeichen der Fläche bzw. dem Schalter „EU-Öko-Ware“ am Kontrakt.
      Vermehrungsware (Fuhren mit Sorte) ist gesondert ausgewiesen und steht nicht für den Konsumverkauf zur Verfügung; ihre Absiebe aus der Reinigung gehen in die Konsumware über.
      Umlagerungen zählen nicht. Verkäufe ohne Kontrakt sind nicht enthalten.
    </div>`;
}

export async function exportMassenbilanzExcel() {
  try { await ensureXLSX(); } catch(e) { showToast('Excel-Bibliothek konnte nicht geladen werden.', 'error'); return; }
  const XLSX = window.XLSX;
  const d = massenbilanzDaten();
  const r1 = n => Math.round(n * 10) / 10;
  const aoa = [['Art', 'Bio', 'Produkt', 'Ernte t', 'Zukauf t', 'Absiebe t', 'Aufkommen t', 'Kontrahiert t', 'geliefert t', 'noch zu liefern t', 'Frei t', 'EK offen t']];
  BEREICHE.forEach(b => d[b.key].forEach(r => {
    const konsum = b.art === 'konsum';
    aoa.push([konsum ? 'Konsum' : 'Vermehrung', b.bio ? 'Bio' : 'konventionell', r.produkt, r1(r.ernteT), r1(r.zukaufT), r1(r.absiebeT), r1(r.aufkommenT),
      ...(konsum ? [r1(r.kontrahiertT), r1(r.geliefertT), r1(r.offenT), r1(r.freiT), r1(r.ekOffenT)] : ['', '', '', '', ''])]);
  }));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch:12 }, { wch:14 }, { wch:26 }, ...Array(9).fill({ wch:13 })];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Massenbilanz');
  const det = [['Art', 'Bio', 'Produkt', 'Herkunft', 'Betrieb / Lieferant', 't', 'Anteil %']];
  BEREICHE.forEach(b => d[b.key].forEach(r => {
    const art = b.art === 'konsum' ? 'Konsum' : 'Vermehrung', bio = b.bio ? 'Bio' : 'konventionell';
    Object.entries(r.betriebe).sort((a, c) => c[1] - a[1]).forEach(([n, kg]) =>
      det.push([art, bio, r.produkt, 'Ernte', n, r1(kg/1000), r.ernteKg ? Math.round(kg / r.ernteKg * 100) : '']));
    Object.entries(r.lieferanten).sort((a, c) => c[1] - a[1]).forEach(([n, kg]) =>
      det.push([art, bio, r.produkt, 'Zukauf', n, r1(kg/1000), r.zukaufKg ? Math.round(kg / r.zukaufKg * 100) : '']));
  }));
  const ws2 = XLSX.utils.aoa_to_sheet(det);
  ws2['!cols'] = [{ wch:12 }, { wch:14 }, { wch:22 }, { wch:9 }, { wch:30 }, { wch:10 }, { wch:9 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Je Betrieb');
  XLSX.writeFile(wb, `Massenbilanz_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
