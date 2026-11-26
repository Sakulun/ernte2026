import { state } from './state.js?v=179';
import { getFeld, netto, escapeHtml, showToast } from './helpers.js?v=179';
import { getFruchtFarbe, produktVon } from './frucht.js?v=179';
export { produktVon };
import { isBioFuhre } from './bio.js?v=179';
import { getKontraktGeliefertKg, kontraktEingangFuhren } from './kontrakte.js?v=179';
import { ensureXLSX } from './export.js?v=179';
import { BRIEFKOPF_LOGO, FIRMA_NAME } from './config.js?v=179';

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

// ── Körnermais: Umrechnung Nass- auf Trockenware ────────────────────────────
// Formel wie in der Excel-Übersicht Körnermais:  trocken = Menge − Menge × 0,98 × (Feuchte − 14,5) × 1,4 %
// Unter 14,5 % Feuchte wird nichts abgezogen. Fuhren ohne Feuchtewert bekommen die mengengewichtete
// Ø-Feuchte der übrigen Körnermais-Fuhren desselben Bereichs (Bio/konventionell).
export const MAIS_ZIELFEUCHTE = 14.5;
export function maisTrockenKg(kg, feuchte) {
  const ueber = Math.max(0, (Number(feuchte) || 0) - MAIS_ZIELFEUCHTE);
  return kg - kg * 0.98 * ueber * 0.014;
}
const TROCKNEN = new Set(['Körnermais']);

export function massenbilanzDaten() {
  const leer = () => ({ ernteKg:0, zukaufKg:0, absiebeKg:0, ekOffenT:0, kontrahiertT:0, geliefertT:0,
    kontrakte:[], ekKontrakte:[], quellen:{}, betriebe:{}, lieferanten:{}, nass:null });
  const bil = Object.fromEntries(BEREICHE.map(b => [b.key, {}]));
  const zeile = (art, bio, p) => { const t = bil[art + '|' + (bio ? 'bio' : 'konv')]; return t[p] || (t[p] = leer()); };
  const quelle = (z, name, kg) => { z.quellen[name] = (z.quellen[name] || 0) + kg; };
  const fertigeFuhren = state.fuhren.filter(f => f.status === 'fertig' && (netto(f) || 0) > 0
    && (getFeld(f.feldId).typ || 'schlag') !== 'umlagerung');

  // Ø-Feuchte je Bereich für Trocknungs-Kulturen ohne Feuchtewert
  const fGew = {};
  fertigeFuhren.forEach(f => {
    const p = produktVon(f.fruchtart);
    if(!TROCKNEN.has(p) || f.feuchte == null) return;
    const k = (f.sorte ? 'v' : 'k') + (isBioFuhre(f) ? 'b' : 'c') + p;
    const e = fGew[k] || (fGew[k] = { s:0, m:0 });
    e.s += netto(f) * f.feuchte; e.m += netto(f);
  });

  fertigeFuhren.forEach(f => {
    const nassKg = netto(f) || 0;
    const feld = getFeld(f.feldId);
    const typ = feld.typ || 'schlag';
    const p = produktVon(f.fruchtart);
    const bio = isBioFuhre(f);
    const art = f.sorte ? 'vermehrung' : 'konsum';
    // Trocknungs-Kultur: Bilanz rechnet mit Trockenware, Nassware wird daneben mitgeführt
    let kg = nassKg;
    if(TROCKNEN.has(p) && typ !== 'reinigung') {
      const z = zeile(art, bio, p);
      const n = z.nass || (z.nass = { ernteKg:0, zukaufKg:0, feuchteSumme:0, ohneFeuchte:0 });
      const fk = fGew[(f.sorte ? 'v' : 'k') + (bio ? 'b' : 'c') + p];
      let feuchte = f.feuchte;
      if(feuchte == null) { n.ohneFeuchte++; feuchte = fk?.m ? fk.s / fk.m : MAIS_ZIELFEUCHTE; }
      kg = maisTrockenKg(nassKg, feuchte);
      n.feuchteSumme += nassKg * feuchte;
      if(typ === 'lieferant' || f.einkaufskontrakt) n.zukaufKg += nassKg; else n.ernteKg += nassKg;
    }
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
      z.ekKontrakte.push(k);
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
      const nass = z.nass ? { ernteT:z.nass.ernteKg/1000, zukaufT:z.nass.zukaufKg/1000,
        aufkommenT:(z.nass.ernteKg + z.nass.zukaufKg)/1000, ohneFeuchte:z.nass.ohneFeuchte,
        feuchte: (z.nass.ernteKg + z.nass.zukaufKg) ? z.nass.feuchteSumme / (z.nass.ernteKg + z.nass.zukaufKg) : null } : null;
      return { produkt, ...z, nass, ernteT:z.ernteKg/1000, zukaufT:z.zukaufKg/1000, absiebeT:z.absiebeKg/1000,
        aufkommenT, offenT: Math.max(0, z.kontrahiertT - z.geliefertT), freiT: aufkommenT - z.kontrahiertT, ...preisDaten(z.kontrakte) };
    })
    .filter(r => Math.abs(r.aufkommenT) > 0.05 || r.kontrahiertT > 0 || r.ekOffenT > 0 || Math.abs(r.absiebeT) > 0.05)
    .sort((a, b) => (b.aufkommenT + b.kontrahiertT) - (a.aufkommenT + a.kontrahiertT));
  return Object.fromEntries(BEREICHE.map(b => [b.key, fertig(b.key)]));
}

// Ø-Kontraktpreis je Kultur, mengengewichtet über die Verkaufskontrakte mit Preis.
// preisMengeT < kontrahiertT heißt: für einen Teil der Menge fehlt der Preis im Kontrakt.
function preisDaten(kontrakte) {
  const mit = kontrakte.filter(k => Number(k.preis_eur) > 0);
  const preisMengeT = mit.reduce((s, k) => s + (Number(k.menge_t) || 0), 0);
  const avgPreis = preisMengeT > 0 ? mit.reduce((s, k) => s + Number(k.preis_eur) * (Number(k.menge_t) || 0), 0) / preisMengeT : null;
  return { avgPreis, preisMengeT };
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
const eur = n => n == null ? '–' : Number(n).toLocaleString('de-DE', { minimumFractionDigits:2, maximumFractionDigits:2 }) + ' €/t';

// Kontraktzeilen einer Produktzeile (Detailansicht + PDF): Verkaufskontrakte mit Preis,
// gewichteter Ø-Preis (nur Kontrakte mit Preis), danach offene Einkaufskontrakte.
function kontraktZeilenDaten(r) {
  const kunde = k => state.kontakte.find(c => c.id === k.kontakt_id)?.name || '–';
  const preis = k => Number(k.preis_eur) > 0 ? Number(k.preis_eur) : null;
  const vk = [...r.kontrakte].sort((a, b) => (preis(b) || 0) - (preis(a) || 0)).map(k => {
    const mengeT = Number(k.menge_t) || 0, geliefertT = getKontraktGeliefertKg(k.id) / 1000;
    return { ek:false, nummer:k.nummer || '–', partner:kunde(k), preis:preis(k), erfuellt:k.status === 'erfuellt',
      mengeT, geliefertT, offenT:Math.max(0, mengeT - geliefertT) };
  });
  const mitPreis = vk.filter(x => x.preis != null);
  const mengeP = mitPreis.reduce((s, x) => s + x.mengeT, 0);
  const avg = mitPreis.length > 1 && mengeP > 0
    ? { avg:true, preis: mitPreis.reduce((s, x) => s + x.preis * x.mengeT, 0) / mengeP, mengeT:mengeP } : null;
  const ek = r.ekKontrakte.filter(k => k.status !== 'erfuellt').map(k => {
    const mengeT = Number(k.menge_t) || 0, geliefertT = getKontraktGeliefertKg(k.id) / 1000;
    return { ek:true, nummer:k.nummer || '–', partner:kunde(k), preis:preis(k), mengeT, geliefertT, offenT:Math.max(0, mengeT - geliefertT) };
  });
  return { vk, avg, ek };
}
function kontraktZeilen(r) {
  const { vk, avg, ek } = kontraktZeilenDaten(r);
  const td = (v, extra = '') => `<td style="padding:4px 8px;text-align:right;white-space:nowrap;${extra}">${v}</td>`;
  const name = (icon, x) => `<td style="padding:4px 8px 4px 34px;white-space:nowrap;color:var(--text2)">${icon} ${escapeHtml(x.nummer)} · ${escapeHtml(x.partner)}${x.erfuellt?' <span style="color:var(--text3)">· erfüllt</span>':''}
      ${x.ek ? `<b style="color:var(--text);margin-left:6px">${eur(x.preis)}</b>` : ""}</td>`;
  const stil = 'font-size:11.5px;background:var(--bg2)';
  const vkZ = vk.map(x => `<tr style="${stil}">${name('📋', x)}<td colspan="4"></td>
      ${td(t1(x.mengeT))}${td(x.preis == null ? '–' : eur(x.preis).replace(' €/t', ''))}${td(t1(x.geliefertT), 'color:var(--gold)')}${td(t1(x.offenT), 'color:var(--text2)')}<td colspan="3"></td></tr>`).join('');
  const avgZ = avg ? `<tr style="${stil}"><td style="padding:4px 8px 4px 34px;white-space:nowrap;color:var(--text2)">Ø Kontraktpreis (mengengewichtet)
      <b style="color:var(--text);margin-left:6px">${eur(avg.preis)}</b></td><td colspan="4"></td>${td(t1(avg.mengeT), 'font-weight:700')}${td(eur(avg.preis).replace(' €/t', ''), 'font-weight:700')}<td colspan="5"></td></tr>` : '';
  const ekZ = ek.map(x => `<tr style="${stil}">${name('🛒 EK', x)}<td colspan="10"></td>${td(t1(x.offenT), 'color:var(--text3)')}</tr>`).join('');
  return vkZ + avgZ + ekZ;
}
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
          <b>${Number(k.preis_eur) > 0 ? eur(k.preis_eur) + ' · ' : ''}${t1(getKontraktGeliefertKg(k.id)/1000)} / ${t1(Number(k.menge_t)||0)} t</b></div>`).join('')
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
    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${farbe(r.produkt)};margin:0 5px 0 3px"></span><b style="color:var(--text)">${escapeHtml(r.produkt)}</b>${r.nass ? ` <span style="color:var(--text2);font-size:11px" title="Trockenware: Menge − Menge × 0,98 × (Feuchte − 14,5) × 1,4 %">trocken · 14,5 %</span>` : ''}</td>`;
}
// Info-Zeile Nassware über der Trockenzeile (zählt nicht in Summen, Kontrakte laufen auf trocken)
function nassZeile(r, restSpalten) {
  if(!r.nass) return '';
  const n = r.nass, z = v => `<td style="padding:4px 8px;text-align:right;white-space:nowrap;color:var(--text2)">${tZ(v)}</td>`;
  return `<tr style="font-size:11.5px;font-style:italic;border-top:1px solid var(--color-border)">
    <td style="padding:4px 8px 4px 26px;white-space:nowrap;color:var(--text2)">💧 ${escapeHtml(r.produkt)} nass${n.feuchte != null ? ` · Ø ${n.feuchte.toLocaleString('de-DE', { minimumFractionDigits:1, maximumFractionDigits:1 })} % Feuchte` : ''}${n.ohneFeuchte ? ` <span style="color:var(--color-warning)" title="Ohne Feuchtewert – mit der Ø-Feuchte gerechnet">· ${n.ohneFeuchte} ohne Feuchte</span>` : ''}</td>
    ${z(n.ernteT)}${z(n.zukaufT)}${z(0)}${z(n.aufkommenT)}${restSpalten ? `<td colspan="${restSpalten}"></td>` : ''}</tr>`;
}
function abschnitt(b, inhalt, hinweis, aktion = '') {
  return `<div style="margin-bottom:22px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid ${b.bio?GRUEN:'var(--color-primary)'};padding-bottom:5px;margin-bottom:8px;gap:10px;flex-wrap:wrap">
      <div style="font-family:var(--font-display);font-size:17px;color:var(--color-text)">${b.titel}</div>
      <div style="display:flex;align-items:center;gap:10px;font-size:12px;color:var(--text2)">${hinweis}${aktion}</div>
    </div>
    <div style="overflow-x:auto">${inhalt}</div>
  </div>`;
}

// Konsumware: Aufkommen gegen Verkaufskontrakte
function preisZelle(r) {
  if(r.avgPreis == null) return '<span style="color:var(--text3)">–</span>';
  const teil = r.preisMengeT < r.kontrahiertT - 0.05;
  return `<b>${eur(r.avgPreis).replace(' €/t', '')}</b>${teil ? `<span style="color:var(--color-warning)" title="Preis nur für ${t1(r.preisMengeT)} von ${t1(r.kontrahiertT)} t hinterlegt"> *</span>` : ''}`;
}
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
    return `${nassZeile(r, 7)}<tr style="border-top:1px solid var(--color-border);cursor:pointer" data-key="${escapeHtml(key)}" onclick="toggleMassenbilanzZeile(this.dataset.key)">
      ${produktZelle(key, r)}
      ${zelle(tZ(r.ernteT))}${zelle(tZ(r.zukaufT))}${zelle(tZ(r.absiebeT), 'color:var(--text2)')}
      ${zelle(`<b>${t1(r.aufkommenT)}</b>`, 'background:var(--bg2)')}
      ${zelle(tZ(r.kontrahiertT))}${zelle(preisZelle(r))}${zelle(tZ(r.geliefertT), 'color:var(--gold)')}${zelle(tZ(r.offenT), 'color:var(--text2)')}
      ${zelle(frei(r.freiT), 'background:var(--bg2)')}
      <td style="padding:7px 8px;min-width:110px">${bar(r)}</td>
      ${zelle(tZ(r.ekOffenT), 'color:var(--text3)')}
    </tr>${_detail ? betriebsZeilen(r, 9) + kontraktZeilen(r) : ''}${_offen === key ? `<tr><td colspan="12" style="padding:0">${detailHTML(r, true)}</td></tr>` : ''}`;
  };
  const tot = { aufkommenT:sum('aufkommenT'), kontrahiertT:sum('kontrahiertT') };
  return abschnitt(b, `<table style="${tabStil}">
      <thead><tr style="${kopfStil}">
        ${th('Produkt', false)}${th('Ernte')}${th('Zukauf', true, 'Von Dritten angeliefert (Lieferanten, Einkaufskontrakte)')}${th('Absiebe', true, 'Reinigungsabgänge der Vermehrung, in die Konsumware umgebucht')}
        ${th('Aufkommen')}${th('Kontrahiert', true, 'Verkaufskontrakte (aktiv + erfüllt)')}${th('Ø Preis', true, 'Mengengewichteter Durchschnitt der Kontraktpreise (€/t), nur Kontrakte mit Preis')}${th('geliefert')}${th('noch zu liefern')}
        ${th('Frei', true, 'Aufkommen − kontrahiert = noch nicht verkauft')}${th('verkauft', false)}${th('EK offen', true, 'Einkaufskontrakte: noch nicht angelieferte Menge (künftiger Zugang)')}
      </tr></thead>
      <tbody>
        ${rows.map(zeile).join('') || `<tr><td colspan="12" style="padding:12px;color:var(--text3)">Keine Daten.</td></tr>`}
        ${rows.length ? `<tr style="border-top:2px solid var(--border2);font-weight:700">
          <td style="padding:7px 8px">Gesamt</td>
          ${zelle(t1(sum('ernteT')))}${zelle(t1(sum('zukaufT')))}${zelle(tZ(sum('absiebeT')))}
          ${zelle(t1(tot.aufkommenT), 'background:var(--bg2)')}${zelle(t1(tot.kontrahiertT))}${zelle('')}${zelle(t1(sum('geliefertT')))}${zelle(t1(sum('offenT')))}
          ${zelle(frei(sum('freiT')), 'background:var(--bg2)')}<td style="padding:7px 8px">${bar(tot)}</td>${zelle(tZ(sum('ekOffenT')))}
        </tr>` : ''}
      </tbody>
    </table>`, 'Ernte ohne Sorte · Zukauf · Absiebe aus der Reinigung',
    `<button class="btn btn-sm btn-outline" onclick="massenbilanzPdf('${b.key}')" title="Diesen Bereich als PDF (Druckansicht)">📄 PDF</button>`);
}

// Vermehrungsware: nur Aufkommen – keine Kontrakte, nicht für den Konsumverkauf verfügbar
function vermehrungTabelle(b, rows) {
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  const zeile = r => {
    const key = b.key + '|' + r.produkt;
    return `${nassZeile(r, 0)}<tr style="border-top:1px solid var(--color-border);cursor:pointer" data-key="${escapeHtml(key)}" onclick="toggleMassenbilanzZeile(this.dataset.key)">
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
        <button class="btn btn-sm btn-outline" onclick="massenbilanzPdf()" title="Konsumware konventionell + Bio als PDF (Druckansicht)">📄 PDF Konsumware</button>
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
  const aoa = [['Art', 'Bio', 'Produkt', 'Ernte t', 'Zukauf t', 'Absiebe t', 'Aufkommen t', 'Kontrahiert t', 'Ø Preis €/t', 'geliefert t', 'noch zu liefern t', 'Frei t', 'EK offen t']];
  BEREICHE.forEach(b => d[b.key].forEach(r => {
    const konsum = b.art === 'konsum';
    if(r.nass) aoa.push([konsum ? 'Konsum' : 'Vermehrung', b.bio ? 'Bio' : 'konventionell',
      `${r.produkt} nass (Ø ${r.nass.feuchte != null ? (Math.round(r.nass.feuchte * 10) / 10) : '–'} % Feuchte, nur Info)`,
      r1(r.nass.ernteT), r1(r.nass.zukaufT), '', r1(r.nass.aufkommenT), '', '', '', '', '', '']);
    aoa.push([konsum ? 'Konsum' : 'Vermehrung', b.bio ? 'Bio' : 'konventionell', r.produkt + (r.nass ? ' trocken (14,5 %)' : ''), r1(r.ernteT), r1(r.zukaufT), r1(r.absiebeT), r1(r.aufkommenT),
      ...(konsum ? [r1(r.kontrahiertT), r.avgPreis == null ? '' : Math.round(r.avgPreis * 100) / 100, r1(r.geliefertT), r1(r.offenT), r1(r.freiT), r1(r.ekOffenT)] : ['', '', '', '', '', ''])]);
  }));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch:12 }, { wch:14 }, { wch:26 }, ...Array(10).fill({ wch:13 })];
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

// ── PDF-Ansicht Konsumware ───────────────────────────────────────────────────
// Druckansicht in neuem Fenster (A4 quer), "Als PDF speichern" im Druckdialog –
// wie der Tagesbericht. bereich = 'konsum|konv' | 'konsum|bio' | leer = beide.
// Mit aktiver Detailansicht stehen die Betriebe/Lieferanten unter jeder Kultur.
export function massenbilanzPdf(bereich) {
  const d = massenbilanzDaten();
  const bereiche = BEREICHE.filter(b => b.art === 'konsum' && (!bereich || b.key === bereich));
  const esc = escapeHtml;
  const nz = v => Math.abs(v) < 0.05 ? '–' : t1(v);
  const pct = (a, g) => g > 0 ? Math.round(a / g * 100) + ' %' : '';
  const jetzt = new Date();
  const stand = jetzt.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' }) + ', '
    + jetzt.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' }) + ' Uhr';

  const subZeilen = r => {
    const sort = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
    const zeile = (name, ernte, zukauf) => `<tr class="sub"><td>${name}</td><td class="num">${ernte}</td><td class="num">${zukauf}</td><td colspan="9"></td></tr>`;
    return sort(r.betriebe).map(([n, kg]) => zeile(esc(n), t1(kg/1000) + ' t · ' + pct(kg, r.ernteKg), '')).join('')
      + sort(r.lieferanten).map(([n, kg]) => zeile('Zukauf ' + esc(n), '', t1(kg/1000) + ' t · ' + pct(kg, r.zukaufKg))).join('')
      + kontraktPdf(r);
  };
  const kontraktPdf = r => {
    const { vk, avg, ek } = kontraktZeilenDaten(r);
    const nm = (pre, x) => `<td>${pre} ${esc(x.nummer)} · ${esc(x.partner)}${x.erfuellt ? ' · erfüllt' : ''} ${x.ek ? `<b class="preis">${eur(x.preis)}</b>` : ""}</td>`;
    return vk.map(x => `<tr class="sub">${nm('Kontrakt', x)}<td colspan="4"></td><td class="num">${t1(x.mengeT)}</td><td class="num">${x.preis == null ? '–' : eur(x.preis).replace(' €/t', '')}</td><td class="num">${t1(x.geliefertT)}</td><td class="num">${t1(x.offenT)}</td><td colspan="3"></td></tr>`).join('')
      + (avg ? `<tr class="sub"><td>Ø Kontraktpreis (mengengewichtet) <b class="preis">${eur(avg.preis)}</b></td><td colspan="4"></td><td class="num b">${t1(avg.mengeT)}</td><td class="num b">${eur(avg.preis).replace(' €/t', '')}</td><td colspan="5"></td></tr>` : '')
      + ek.map(x => `<tr class="sub">${nm('Einkauf', x)}<td colspan="10"></td><td class="num">${t1(x.offenT)}</td></tr>`).join('');
  };
  const tabelle = b => {
    const rows = d[b.key];
    const sum = k => rows.reduce((s, x) => s + x[k], 0);
    const frei = v => `<span class="${v < -0.05 ? 'rot' : 'gruen'}">${t1(v)}</span>`;
    const nassPdf = r => r.nass ? `<tr class="sub nass"><td>${esc(r.produkt)} nass${r.nass.feuchte != null ? ` · Ø ${r.nass.feuchte.toLocaleString('de-DE', { minimumFractionDigits:1, maximumFractionDigits:1 })} % Feuchte` : ''}${r.nass.ohneFeuchte ? ` · ${r.nass.ohneFeuchte} ohne Feuchte` : ''}</td>
      <td class="num">${nz(r.nass.ernteT)}</td><td class="num">${nz(r.nass.zukaufT)}</td><td class="num">–</td><td class="num">${t1(r.nass.aufkommenT)}</td><td colspan="7"></td></tr>` : '';
    const zeile = (r, gesamt) => `${gesamt ? '' : nassPdf(r)}<tr class="${gesamt ? 'summe' : 'prod'}">
      <td>${gesamt ? 'Gesamt' : esc(r.produkt) + (r.nass ? ' <span style="font-weight:400;color:#555">trocken · 14,5 %</span>' : '')}</td>
      <td class="num">${nz(r.ernteT)}</td><td class="num">${nz(r.zukaufT)}</td><td class="num">${nz(r.absiebeT)}</td>
      <td class="num b">${t1(r.aufkommenT)}</td><td class="num">${nz(r.kontrahiertT)}</td><td class="num b">${gesamt || r.avgPreis == null ? '–' : eur(r.avgPreis).replace(' €/t', '') + (r.preisMengeT < r.kontrahiertT - 0.05 ? ' *' : '')}</td><td class="num">${nz(r.geliefertT)}</td>
      <td class="num">${nz(r.offenT)}</td><td class="num b">${frei(r.freiT)}</td>
      <td class="num">${r.aufkommenT > 0 ? Math.round(r.kontrahiertT / r.aufkommenT * 100) + ' %' : '–'}</td>
      <td class="num">${nz(r.ekOffenT)}</td></tr>`;
    const tot = { ernteT:sum('ernteT'), zukaufT:sum('zukaufT'), absiebeT:sum('absiebeT'), aufkommenT:sum('aufkommenT'),
      kontrahiertT:sum('kontrahiertT'), geliefertT:sum('geliefertT'), offenT:sum('offenT'), freiT:sum('freiT'), ekOffenT:sum('ekOffenT') };
    return `<h2 class="${b.bio ? 'bio' : ''}">${b.bio ? 'Konsumware · Bio' : 'Konsumware · konventionell'}</h2>
      <table>
        <thead><tr><th>Produkt</th><th class="num">Ernte t</th><th class="num">Zukauf t</th><th class="num">Absiebe t</th>
          <th class="num">Aufkommen t</th><th class="num">Kontrahiert t</th><th class="num">Ø Preis €/t</th><th class="num">geliefert t</th><th class="num">noch zu liefern t</th>
          <th class="num">Frei t</th><th class="num">verkauft</th><th class="num">EK offen t</th></tr></thead>
        <tbody>
          ${rows.map(r => zeile(r) + (_detail ? subZeilen(r) : '')).join('') || '<tr><td colspan="12" class="leer">Keine Daten</td></tr>'}
          ${rows.length ? zeile(tot, true) : ''}
        </tbody>
      </table>`;
  };
  const kachel = (wert, lbl, cls = '') => `<div class="kachel"><div class="kv ${cls}">${wert}</div><div class="kl">${lbl}</div></div>`;
  const kacheln = bereiche.map(b => {
    const rows = d[b.key];
    const auf = rows.reduce((s, x) => s + x.aufkommenT, 0), k = rows.reduce((s, x) => s + x.kontrahiertT, 0);
    const art = b.bio ? 'Bio' : 'konv.';
    return kachel(t1(auf) + ' t', 'Aufkommen ' + art) + kachel(t1(k) + ' t', 'kontrahiert ' + art)
      + kachel(t1(auf - k) + ' t', 'frei ' + art, auf - k < -0.05 ? 'rot' : 'gruen');
  }).join('');
  const titel = bereich ? (bereiche[0]?.bio ? 'Massenbilanz Konsumware · Bio' : 'Massenbilanz Konsumware · konventionell') : 'Massenbilanz Konsumware';

  const win = window.open('', '_blank');
  if(!win) { showToast('Pop-up wurde blockiert – bitte für diese Seite erlauben.', 'error'); return; }
  win.document.write(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
  <title>${titel} – ${jetzt.toISOString().slice(0, 10)}</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Segoe UI',Arial,sans-serif; font-size:10.5px; color:#1a1a1a; background:#fff; padding:20px 24px; }
    .kopf { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #3a7d2c; padding-bottom:10px; margin-bottom:14px; }
    h1 { font-size:18px; color:#1a3a1a; margin-bottom:3px; }
    .sub-titel { font-size:11px; color:#555; }
    h2 { font-size:13px; color:#1a3a1a; margin:16px 0 6px; border-bottom:2px solid #2d6a2d; padding-bottom:3px; }
    h2.bio { color:#1d6b2f; border-color:#3f9b4f; }
    .kacheln { display:grid; grid-template-columns:repeat(${Math.min(6, bereiche.length * 3)},1fr); gap:8px; margin-bottom:6px; }
    .kachel { background:#f4f9f4; border:1px solid #c8e0c8; border-radius:6px; padding:7px 10px; }
    .kv { font-size:16px; font-weight:700; color:#1a1a1a; }
    .kl { font-size:9px; color:#555; text-transform:uppercase; letter-spacing:.4px; margin-top:2px; }
    table { width:100%; border-collapse:collapse; margin-bottom:8px; }
    th { background:#1a3a1a; color:#fff; padding:5px 7px; text-align:left; font-size:9.5px; font-weight:600; white-space:nowrap; }
    td { padding:4px 7px; border-bottom:1px solid #e3ece3; white-space:nowrap; }
    tr.prod td:first-child { font-weight:700; }
    tr.sub td { font-size:9.5px; color:#555; background:#f7faf7; }
    tr.sub td:first-child { padding-left:20px; }
    tr.nass td { font-style:italic; }
    .preis { color:#1a1a1a; margin-left:6px; }
    tr.summe td { font-weight:700; border-top:2px solid #1a3a1a; border-bottom:none; }
    .num { text-align:right; font-variant-numeric:tabular-nums; }
    .b { font-weight:700; }
    .gruen { color:#1a6a1a; font-weight:700; } .rot { color:#b3261e; font-weight:700; }
    .leer { text-align:center; color:#888; padding:12px; }
    .hinweis { margin-top:14px; font-size:9px; color:#666; line-height:1.5; }
    .footer { margin-top:16px; padding-top:8px; border-top:1px solid #ddd; font-size:9px; color:#888; display:flex; justify-content:space-between; }
    @media print { body { padding:0; } @page { margin:1.2cm; size:A4 landscape; } h2 { page-break-after:avoid; } tr { page-break-inside:avoid; } }
  </style></head><body>
  <div class="kopf">
    <div><h1>${titel}</h1><div class="sub-titel">Aufkommen (Ernte + Zukauf + Absiebe) gegen Verkaufskontrakte · Stand ${stand}${_detail ? ' · mit Aufteilung je Betrieb und Kontraktpreisen' : ''}${_ohneSilomais ? '' : ' · inkl. Silomais'}</div></div>
    <img src="${new URL(BRIEFKOPF_LOGO, location.href).href}" style="height:42px;width:auto" alt="Saatgut & Agrarservice Beesenstedt">
  </div>
  <div class="kacheln">${kacheln}</div>
  ${bereiche.map(tabelle).join('')}
  <div class="hinweis">Ernte = abgeschlossene Fuhren von eigenen Schlägen ohne Vermehrungssorte · Zukauf = Anlieferungen von Dritten ·
    Absiebe = Reinigungsabgänge der Vermehrung · Körnermais = Trockenware (Menge − Menge × 0,98 × (Feuchte − 14,5) × 1,4 %), Nassware als Info-Zeile · Frei = Aufkommen − kontrahiert · Ø Preis = mengengewichteter Kontraktpreis (* = nicht für alle Kontrakte ein Preis hinterlegt) · EK offen = noch nicht angelieferte Menge aus Einkaufskontrakten.
    Vermehrungsware ist nicht enthalten, sie steht nicht für den Konsumverkauf zur Verfügung. Umlagerungen und Verkäufe ohne Kontrakt zählen nicht.</div>
  <div class="footer"><span>${esc(FIRMA_NAME)} · Landgut Nuscheler</span><span>${stand}</span></div>
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`);
  win.document.close();
}
