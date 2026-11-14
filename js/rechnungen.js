// Rechnungen & Gutschriften (E-Rechnung ZUGFeRD) – Admin-Bereich "Rechnungen".
// Verkaufskontrakte → Rechnungen aus Auslieferungen (Warenausgänge/Lieferungen).
// Einkaufskontrakte → Gutschriften aus erhaltener Ware (Fuhren mit Einkaufskontrakt).
// Ablauf: Entwurf → Festschreiben (Nummer, GoBD-Sperre, PDF/A-3 + XML archiviert) → Versand.

import { state } from './state.js?v=163';
import { db } from './db.js?v=163';
import { showToast, escapeHtml } from './helpers.js?v=163';
import { FIRMA_NAME } from './config.js?v=163';
import { r2, r3, eur, num, datumDE, isoDatum, pos, summen, regelnAnwenden, partnerSnapshot,
         pruefeBeleg, erzeugePdf, downloadBytes, oeffneBytes, QUALI_FELDER, REGEL_ARTEN,
         EINHEITEN, UST_SAETZE } from './erechnung.js?v=163';

let _view = 'offen';            // 'offen' | 'belege' | 'regeln'
let _belege = [];
let _regeln = [];
let _geladen = false;
let _filter = { art: '', status: '', q: '' };
let _ed = null;                 // offener Beleg-Editor
let _busy = false;

const e = s => escapeHtml(s ?? '');
const zahl = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? null : n; };
const ART_TITEL = { rechnung: 'Rechnung', gutschrift: 'Gutschrift' };
const STATUS = {
  entwurf:         ['Entwurf', 'var(--text3)', 'var(--bg2)'],
  festgeschrieben: ['Festgeschrieben', 'var(--color-info, #4a8ab0)', 'var(--color-info-wash, rgba(74,138,176,.12))'],
  versendet:       ['Versendet', 'var(--green2, #6b8f4e)', 'rgba(107,143,78,.14)'],
  storniert:       ['Storniert', 'var(--red, #b03030)', 'rgba(176,48,48,.12)'],
};
const badge = st => { const [l, c, bg] = STATUS[st] || [st, 'var(--text3)', 'none'];
  return `<span style="font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:${c};background:${bg};padding:2px 7px;border-radius:4px;white-space:nowrap">${l}</span>`; };
const belegTitel = b => b.storno_von_id ? (b.art === 'gutschrift' ? 'Storno-Gutschrift' : 'Stornorechnung') : ART_TITEL[b.art];

// ─── Daten ─────────────────────────────────────────────────────────────────
async function laden() {
  try {
    [_belege, _regeln] = await Promise.all([db.getBelege(), db.getAbzugsregeln()]);
    _geladen = true;
  } catch(err) {
    console.error(err);
    showToast('⚠ Belege konnten nicht geladen werden: ' + err.message, 'error');
  }
}
async function quellenNeuLaden() {
  try {
    const [wb, fu, li] = await Promise.all([db.getWarenbewegungen(), db.getFuhren(), db.getLieferungen()]);
    state.warenbewegungen = wb; state.fuhren = fu; state.lieferungen = li;
  } catch(err) { console.error(err); }
}

const kontraktArt = k => (k?.richtung || 'verkauf') === 'einkauf' ? 'gutschrift' : 'rechnung';
const artikelVon = k => state.artikel.find(a => a.id === k?.artikel_id);
const kontaktVon = id => state.kontakte.find(c => c.id === id);
const fruchtName = k => (artikelVon(k)?.name || k?.fruchtart_text || 'Ware').trim();

function ustFuer(art, kontrakt, kontakt) {
  if(art === 'gutschrift' && kontakt?.ust_modus === 'pauschal24') return 7.8;
  const a = artikelVon(kontrakt);
  return a?.ust_satz != null ? Number(a.ust_satz) : 7;
}

function qualiAusFuhre(f) {
  if(!f) return {};
  return { feuchte: f.feuchte, protein: f.protein, hl_gewicht: f.hlGewicht, fallzahl: f.fallzahl,
    oelgehalt: f.oelgehalt, gluten: f.gluten };
}

// Abrechenbare Lieferungen eines Kontrakts (nicht in anderen Belegen).
function kontraktLieferungen(k, belegId = null) {
  const frei = id => !id || id === belegId;
  const out = [];
  if(kontraktArt(k) === 'rechnung') {
    state.warenbewegungen
      .filter(w => w.typ === 'ausgang' && w.kontrakt_id === k.id && Number(w.menge_kg) > 0 && frei(w.beleg_id))
      .forEach(w => out.push({ key: 'wb:' + w.id, quelle: 'wb', quelle_id: w.id,
        ls: w.lieferschein_nr || ('WB-' + w.id), datum: isoDatum(w.erstellt_am), menge_t: r3(Number(w.menge_kg) / 1000),
        info: [w.kennzeichen, w.spedition].filter(Boolean).join(' · '),
        quali: qualiAusFuhre(w.fuhre_id ? state.fuhren.find(f => f.id === w.fuhre_id) : null) }));
    state.lieferungen
      .filter(l => l.kontrakt_id === k.id && l.status === 'abgeschlossen' && l.vollgewicht && l.leergewicht && frei(l.beleg_id))
      .forEach(l => out.push({ key: 'lief:' + l.id, quelle: 'lief', quelle_id: l.id, ls: l.nr || ('L-' + l.id),
        datum: isoDatum(l.datum), menge_t: r3((l.vollgewicht - l.leergewicht) / 1000),
        info: [l.kennzeichen, l.spedition].filter(Boolean).join(' · '), quali: {} }));
  } else {
    const nr = String(k.nummer || '').trim();
    if(nr) state.fuhren
      .filter(f => String(f.einkaufskontrakt || '').trim() === nr && f.vollgewicht && f.leergewicht != null
        && f.vollgewicht - f.leergewicht > 0 && frei(f.belegId))
      .forEach(f => out.push({ key: 'fuhre:' + f.id, quelle: 'fuhre', quelle_id: f.id, ls: f.nr || ('F-' + f.id),
        datum: isoDatum(f.zeit), menge_t: r3((f.vollgewicht - f.leergewicht) / 1000),
        info: f.kennzeichen || '', quali: qualiAusFuhre(f) }));
  }
  return out.sort((a, b) => a.datum.localeCompare(b.datum) || String(a.ls).localeCompare(String(b.ls)));
}

// ─── Hauptansicht ──────────────────────────────────────────────────────────
export async function renderRechnungen() {
  const el = document.getElementById('admintab');
  if(!el) return;
  if(!_geladen) {
    el.innerHTML = '<div class="empty-state">Lade Belege…</div>';
    await laden();
    if(window.adminTab !== 'rechnungen') return;
  }
  const tabBtn = (v, l) => `<button class="btn btn-sm ${_view === v ? 'btn-primary' : 'btn-outline'}" onclick="rechnungenView('${v}')">${l}</button>`;
  const entwuerfe = _belege.filter(b => b.status === 'entwurf').length;
  const unversendet = _belege.filter(b => b.status === 'festgeschrieben').length;
  let html = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
      ${tabBtn('offen', 'Abzurechnen')}${tabBtn('belege', `Belege${entwuerfe ? ` · ${entwuerfe} Entwurf${entwuerfe > 1 ? 'e' : ''}` : ''}`)}${tabBtn('regeln', 'Abzugsregeln')}
      <div style="flex:1"></div>
      <button class="btn btn-sm btn-outline" onclick="rechnungFreiDialog()">+ Freier Beleg</button>
    </div>`;
  if(_view === 'offen') html += offenHTML();
  else if(_view === 'belege') html += belegeHTML(unversendet);
  else html += regelnHTML();
  el.innerHTML = html;
}
export function rechnungenView(v) { _view = v; renderRechnungen(); }

function offenHTML() {
  const gruppen = { rechnung: [], gutschrift: [] };
  for(const k of state.kontrakte.filter(k => k.status !== 'storniert')) {
    const lief = kontraktLieferungen(k);
    if(!lief.length) continue;
    const menge = lief.reduce((s, l) => s + l.menge_t, 0);
    gruppen[kontraktArt(k)].push({ k, lief, menge, wert: r2(menge * (Number(k.preis_eur) || 0)) });
  }
  const karte = ({ k, lief, menge, wert }) => {
    const kontakt = kontaktVon(k.kontakt_id);
    const art = kontraktArt(k);
    const von = lief[0].datum, bis = lief[lief.length - 1].datum;
    return `<div class="card" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <div style="font-weight:700;color:var(--text)">${e(k.nummer || 'ohne Nr.')} · ${e(kontakt?.name || 'kein Kontakt')}</div>
          <div style="font-size:11px;color:var(--text3)">${e(fruchtName(k))}${k.bio ? ' · Bio' : ''}${k.preis_eur ? ' · ' + num(k.preis_eur, 2, 2) + ' €/t' : ' · <span style="color:var(--red)">kein Preis</span>'}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:4px"><b>${lief.length}</b> ${art === 'rechnung' ? 'Auslieferung' : 'Anlieferung'}${lief.length > 1 ? 'en' : ''} offen · ${num(menge, 3, 3)} t · ${datumDE(von)}${von !== bis ? ' – ' + datumDE(bis) : ''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:15px;font-weight:700;color:var(--gold)">≈ ${eur(wert)}</div>
          <div style="font-size:10px;color:var(--text3)">netto, vor Abzügen</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="rechnungNeu(${k.id})">${art === 'rechnung' ? 'Rechnung' : 'Gutschrift'} erstellen</button>
      </div>
    </div>`;
  };
  const block = (art, titel, leer) => `<div class="section-label" style="margin:6px 0 8px">${titel} (${gruppen[art].length})</div>
    ${gruppen[art].length ? gruppen[art].map(karte).join('') : `<div style="font-size:12px;color:var(--text3);margin-bottom:16px">${leer}</div>`}`;
  const entwuerfe = _belege.filter(b => b.status === 'entwurf');
  return (entwuerfe.length ? `<div class="section-label" style="margin-bottom:8px">Offene Entwürfe (${entwuerfe.length})</div>${entwuerfe.map(belegZeile).join('')}<div style="height:12px"></div>` : '')
    + block('rechnung', 'Verkaufskontrakte → Rechnung', 'Keine unberechneten Auslieferungen.')
    + '<div style="height:10px"></div>'
    + block('gutschrift', 'Einkaufskontrakte → Gutschrift', 'Keine offenen Anlieferungen aus Einkaufskontrakten.');
}

function belegZeile(b) {
  const p = b.empfaenger || {};
  const k = state.kontrakte.find(x => x.id === b.kontrakt_id);
  const akt = [];
  if(b.status === 'entwurf') {
    akt.push(`<button class="btn btn-sm btn-primary" onclick="belegOeffnen(${b.id})">Bearbeiten</button>`);
    akt.push(`<button class="btn btn-sm btn-outline" title="Entwurf löschen" onclick="belegLoeschen(${b.id})">✕</button>`);
  } else {
    if(b.pdf_pfad) akt.push(`<button class="btn btn-sm btn-outline" onclick="belegPdf(${b.id})">PDF</button>`);
    else akt.push(`<button class="btn btn-sm btn-outline" style="color:var(--red)" onclick="belegPdfNeu(${b.id})" title="PDF/XML fehlen – erneut erzeugen und archivieren">PDF erzeugen</button>`);
    if(b.xml) akt.push(`<button class="btn btn-sm btn-outline" onclick="belegXml(${b.id})">XML</button>`);
    if(b.pdf_pfad) akt.push(`<button class="btn btn-sm ${b.status === 'festgeschrieben' ? 'btn-primary' : 'btn-outline'}" onclick="belegSendenDialog(${b.id})">✉ ${b.status === 'versendet' ? 'Erneut senden' : 'Senden'}</button>`);
    if(!b.storno_von_id && b.status !== 'storniert') akt.push(`<button class="btn btn-sm btn-outline" style="color:var(--red)" onclick="belegStornieren(${b.id})">Storno</button>`);
  }
  const negativ = Number(b.brutto) < 0;
  return `<div class="card" style="margin-bottom:6px;${b.status === 'storniert' ? 'opacity:.6' : ''}">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:230px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font-weight:700;color:var(--text);font-family:var(--font-mono, monospace)">${e(b.nummer || 'Entwurf #' + b.id)}</span>
          <span style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:.5px">${belegTitel(b)}</span>
          ${badge(b.status)}
        </div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">${e(p.name || '–')}${k ? ' · Kontrakt ' + e(k.nummer) : ''}${b.datum ? ' · ' + datumDE(b.datum) : ''}</div>
        ${b.versendet_am ? `<div style="font-size:10px;color:var(--text3)">✉ ${e(b.versendet_an || '')} · ${new Date(b.versendet_am).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</div>` : ''}
      </div>
      <div style="text-align:right;min-width:110px">
        <div style="font-weight:700;color:${negativ ? 'var(--red)' : 'var(--text)'}">${eur(b.brutto)}</div>
        <div style="font-size:10px;color:var(--text3)">netto ${eur(b.netto)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${akt.join('')}</div>
    </div>
  </div>`;
}

function belegeHTML(unversendet) {
  const q = _filter.q.toLowerCase();
  const liste = _belege.filter(b => (!_filter.art || b.art === _filter.art) && (!_filter.status || b.status === _filter.status)
    && (!q || [b.nummer, b.empfaenger?.name, state.kontrakte.find(k => k.id === b.kontrakt_id)?.nummer].filter(Boolean).join(' ').toLowerCase().includes(q)));
  const jahr = String(new Date().getFullYear());
  const fest = _belege.filter(b => b.status !== 'entwurf' && b.status !== 'storniert' && !b.storno_von_id && String(b.datum || '').startsWith(jahr));
  const sum = art => fest.filter(b => b.art === art).reduce((s, b) => s + Number(b.netto || 0), 0);
  const sel = (feld, opts) => `<select onchange="belegFilter('${feld}',this.value)" style="font-size:12px;padding:6px 8px">${opts.map(([v, l]) => `<option value="${v}"${_filter[feld] === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:14px">
      <div class="stat-box"><div class="stat-val" style="font-size:18px">${eur(sum('rechnung'))}</div><div class="stat-label">Rechnungen ${jahr} netto</div></div>
      <div class="stat-box"><div class="stat-val" style="font-size:18px">${eur(sum('gutschrift'))}</div><div class="stat-label">Gutschriften ${jahr} netto</div></div>
      <div class="stat-box"><div class="stat-val" style="font-size:18px;color:${unversendet ? 'var(--amber, #b07820)' : 'inherit'}">${unversendet}</div><div class="stat-label">noch nicht versendet</div></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      ${sel('art', [['', 'Alle Arten'], ['rechnung', 'Rechnungen'], ['gutschrift', 'Gutschriften']])}
      ${sel('status', [['', 'Alle Status'], ['entwurf', 'Entwürfe'], ['festgeschrieben', 'Festgeschrieben'], ['versendet', 'Versendet'], ['storniert', 'Storniert']])}
      <input id="beleg-suche" type="search" placeholder="Nr., Partner, Kontrakt…" value="${e(_filter.q)}" oninput="belegFilter('q',this.value)" style="flex:1;min-width:160px;font-size:12px;padding:6px 8px">
    </div>
    ${liste.length ? liste.map(belegZeile).join('') : '<div class="empty-state">Keine Belege gefunden.</div>'}`;
}
export function belegFilter(feld, wert) {
  _filter[feld] = wert;
  renderRechnungen();
  if(feld === 'q') { const i = document.getElementById('beleg-suche'); if(i) { i.focus(); i.setSelectionRange(wert.length, wert.length); } }
}

// ─── Abzugsregeln ──────────────────────────────────────────────────────────
function regelBeschreibung(r) {
  const vz = r.vorzeichen === 'zuschlag' ? 'Zuschlag' : 'Abzug';
  const qf = QUALI_FELDER[r.feld];
  const bed = qf ? `${qf.label} ${r.vergleich === 'unter' ? 'unter' : 'über'} ${num(r.schwelle, 0, 2)} ${qf.einheit}` : '';
  if(r.art === 'gewicht_qualitaet') return `${bed}: ${num(r.wert, 0, 3)} % Gewichts${vz.toLowerCase()} je ${qf?.einheit || 'Einheit'} Abweichung`;
  if(r.art === 'preis_qualitaet') return `${bed}: ${vz} ${num(r.wert, 2, 4)} €/t je ${qf?.einheit || 'Einheit'} Abweichung`;
  if(r.art === 'eur_t') return `${vz} ${num(r.wert, 2, 2)} €/t`;
  return `${vz} pauschal ${eur(r.wert)}`;
}
function regelnHTML() {
  const gilt = { beide: 'Rechnung & Gutschrift', rechnung: 'nur Rechnungen', gutschrift: 'nur Gutschriften' };
  const zeile = r => `<div class="card" style="margin-bottom:6px;opacity:${r.aktiv ? 1 : .5}">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px">
        <div style="font-weight:600;color:var(--text)">${e(r.name)}</div>
        <div style="font-size:12px;color:var(--text2)">${e(regelBeschreibung(r))}</div>
        <div style="font-size:10px;color:var(--text3)">${gilt[r.gilt_fuer]}${r.artikel_id ? ' · ' + e(state.artikel.find(a => a.id === r.artikel_id)?.name || 'Artikel') : ' · alle Artikel'}${r.kontakt_id ? ' · nur ' + e(kontaktVon(r.kontakt_id)?.name || 'Kontakt') : ''}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm btn-outline" onclick="regelDialog(${r.id})">✏</button>
        <button class="btn btn-sm" style="background:none;border:1px solid var(--border2);color:${r.aktiv ? 'var(--red)' : 'var(--green)'}" onclick="regelToggle(${r.id})">${r.aktiv ? 'Deaktivieren' : 'Aktivieren'}</button>
        <button class="btn btn-sm btn-outline" style="color:var(--red)" onclick="regelLoeschen(${r.id})">✕</button>
      </div>
    </div>
  </div>`;
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
      <div style="font-size:12px;color:var(--text2);max-width:640px">Regeln erzeugen beim Erstellen eines Belegs automatisch Abzugs- bzw. Zuschlagspositionen.
      Sie lassen sich im Beleg einzeln abschalten. Qualitätswerte stammen aus der Fuhre oder werden im Beleg eingetragen.</div>
      <button class="btn btn-primary" onclick="regelDialog()">+ Neue Regel</button>
    </div>
    ${_regeln.length ? _regeln.map(zeile).join('') : '<div class="empty-state">Noch keine Regeln.<br><span style="font-size:12px">Beispiel: „Feuchteabzug“ – Feuchte über 14,5 %, 1,5 % Gewichtsabzug je %.</span></div>'}`;
}

export function regelDialog(id) {
  const r = id ? _regeln.find(x => x.id === id) : { art: 'gewicht_qualitaet', feld: 'feuchte', vergleich: 'ueber', schwelle: 14.5, wert: 1.5, vorzeichen: 'abzug', gilt_fuer: 'beide', aktiv: true };
  const opt = (obj, v) => Object.entries(obj).map(([k, l]) => `<option value="${k}"${v === k ? ' selected' : ''}>${l}</option>`).join('');
  const m = document.createElement('div');
  m.id = 'regel-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9600;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  m.innerHTML = `<div style="background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);padding:24px;width:100%;max-width:480px;box-shadow:var(--shadow)">
    <div style="font-family:var(--serif);font-size:18px;font-weight:700;color:var(--text);margin-bottom:16px">${id ? 'Regel bearbeiten' : 'Neue Abzugsregel'}</div>
    <div class="form-group"><label>Name (erscheint auf dem Beleg) *</label><input type="text" id="rg-name" value="${e(r.name || '')}" placeholder="z. B. Feuchteabzug, Fracht, Trocknungskosten"></div>
    <div class="form-group"><label>Art</label><select id="rg-art" onchange="regelArtWechsel()">${opt(REGEL_ARTEN, r.art)}</select></div>
    <div id="rg-quali" style="display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:10px">
      <div class="form-group"><label>Qualitätsmerkmal</label><select id="rg-feld">${opt(Object.fromEntries(Object.entries(QUALI_FELDER).map(([k, v]) => [k, `${v.label} (${v.einheit})`])), r.feld)}</select></div>
      <div class="form-group"><label>wenn Wert</label><select id="rg-vergleich">${opt({ ueber: 'über', unter: 'unter' }, r.vergleich)}</select></div>
      <div class="form-group"><label>Basis/Grenze</label><input type="number" step="0.01" id="rg-schwelle" value="${r.schwelle ?? ''}"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label id="rg-wert-label">Wert</label><input type="number" step="0.0001" min="0" id="rg-wert" value="${r.wert ?? ''}"></div>
      <div class="form-group"><label>Wirkung</label><select id="rg-vorzeichen">${opt({ abzug: 'Abzug (mindert Betrag)', zuschlag: 'Zuschlag (erhöht Betrag)' }, r.vorzeichen)}</select></div>
    </div>
    <div class="form-group"><label>Gilt für</label><select id="rg-gilt">${opt({ beide: 'Rechnungen & Gutschriften', rechnung: 'nur Rechnungen (Verkauf)', gutschrift: 'nur Gutschriften (Einkauf)' }, r.gilt_fuer)}</select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label>Nur für Artikel</label><select id="rg-artikel"><option value="">alle Artikel</option>${state.artikel.filter(a => a.aktiv || a.id === r.artikel_id).map(a => `<option value="${a.id}"${a.id === r.artikel_id ? ' selected' : ''}>${e(a.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Nur für Kontakt</label><select id="rg-kontakt"><option value="">alle Kontakte</option>${state.kontakte.filter(k => k.aktiv || k.id === r.kontakt_id).map(k => `<option value="${k.id}"${k.id === r.kontakt_id ? ' selected' : ''}>${e(k.name)}</option>`).join('')}</select></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-primary" style="flex:1" onclick="regelSpeichern(${id || 'null'})">${id ? 'Speichern' : 'Anlegen'}</button>
      <button class="btn btn-outline" onclick="document.getElementById('regel-modal').remove()">Abbrechen</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  regelArtWechsel();
}
export function regelArtWechsel() {
  const art = document.getElementById('rg-art')?.value;
  const q = document.getElementById('rg-quali');
  if(q) q.style.display = (art === 'gewicht_qualitaet' || art === 'preis_qualitaet') ? 'grid' : 'none';
  const l = document.getElementById('rg-wert-label');
  if(l) l.textContent = { gewicht_qualitaet: '% Gewicht je Einheit Abweichung', preis_qualitaet: '€/t je Einheit Abweichung', eur_t: '€ je Tonne', pauschal: 'Betrag € (netto)' }[art] || 'Wert';
}
export async function regelSpeichern(id) {
  const g = i => document.getElementById(i)?.value;
  const art = g('rg-art');
  const quali = art === 'gewicht_qualitaet' || art === 'preis_qualitaet';
  const r = { id, name: (g('rg-name') || '').trim(), art, feld: quali ? g('rg-feld') : null, vergleich: g('rg-vergleich'),
    schwelle: quali ? zahl(g('rg-schwelle')) : null, wert: zahl(g('rg-wert')), vorzeichen: g('rg-vorzeichen'),
    gilt_fuer: g('rg-gilt'), artikel_id: parseInt(g('rg-artikel')) || null, kontakt_id: parseInt(g('rg-kontakt')) || null,
    aktiv: id ? _regeln.find(x => x.id === id)?.aktiv !== false : true };
  if(!r.name) { showToast('⚠ Name erforderlich', 'error'); return; }
  if(!(r.wert > 0)) { showToast('⚠ Wert muss größer 0 sein', 'error'); return; }
  if(quali && r.schwelle == null) { showToast('⚠ Basis/Grenze angeben', 'error'); return; }
  try {
    await db.saveAbzugsregel(r);
    _regeln = await db.getAbzugsregeln();
    document.getElementById('regel-modal')?.remove();
    showToast('✓ Regel gespeichert');
    renderRechnungen();
  } catch(err) { showToast('⚠ ' + err.message, 'error'); }
}
export async function regelToggle(id) {
  const r = _regeln.find(x => x.id === id); if(!r) return;
  try { await db.saveAbzugsregel({ ...r, aktiv: !r.aktiv }); r.aktiv = !r.aktiv; renderRechnungen(); }
  catch(err) { showToast('⚠ ' + err.message, 'error'); }
}
export async function regelLoeschen(id) {
  const r = _regeln.find(x => x.id === id); if(!r) return;
  if(!confirm(`Regel „${r.name}“ löschen? Bereits festgeschriebene Belege bleiben unverändert.`)) return;
  try { await db.deleteAbzugsregel(id); _regeln = _regeln.filter(x => x.id !== id); renderRechnungen(); }
  catch(err) { showToast('⚠ ' + err.message, 'error'); }
}

// ─── Freier Beleg (ohne Kontrakt) ─────────────────────────────────────────
export function rechnungFreiDialog() {
  const m = document.createElement('div');
  m.id = 'frei-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9600;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `<div style="background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);padding:24px;width:100%;max-width:420px;box-shadow:var(--shadow)">
    <div style="font-family:var(--serif);font-size:18px;font-weight:700;color:var(--text);margin-bottom:6px">Freier Beleg</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:16px">Ohne Kontraktbezug, z. B. für Dienstleistungen oder Einzelverkäufe. Positionen werden frei erfasst.</div>
    <div class="form-group"><label>Art</label><select id="fr-art"><option value="rechnung">Rechnung</option><option value="gutschrift">Gutschrift</option></select></div>
    <div class="form-group"><label>Kontakt</label><select id="fr-kontakt">${state.kontakte.filter(k => k.aktiv).map(k => `<option value="${k.id}">${e(k.name)}</option>`).join('')}</select></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-primary" style="flex:1" onclick="rechnungFreiStart()">Weiter</button>
      <button class="btn btn-outline" onclick="document.getElementById('frei-modal').remove()">Abbrechen</button>
    </div>
  </div>`;
  document.body.appendChild(m);
}
export function rechnungFreiStart() {
  const art = document.getElementById('fr-art')?.value || 'rechnung';
  const kontaktId = parseInt(document.getElementById('fr-kontakt')?.value);
  document.getElementById('frei-modal')?.remove();
  if(!kontaktId) { showToast('⚠ Kontakt wählen', 'error'); return; }
  const kontakt = kontaktVon(kontaktId);
  _ed = { id: null, art, kontaktId, kontraktId: null, datum: isoDatum(new Date()),
    zahlungszielTage: kontakt?.zahlungsziel_tage ?? 14, bemerkung: '', lief: [], deaktiviert: new Set(),
    freie: [{ bezeichnung: '', beschreibung: '', vorz: '+', menge: 1, einheit: 'C62', preis: 0, ust_satz: art === 'gutschrift' && kontakt?.ust_modus === 'pauschal24' ? 7.8 : 19 }] };
  editorRender();
}

// ─── Beleg-Editor ──────────────────────────────────────────────────────────
export function rechnungNeu(kontraktId) {
  const k = state.kontrakte.find(x => x.id === kontraktId);
  if(!k) return;
  if(!k.kontakt_id) { showToast('⚠ Kontrakt hat keinen Kontakt – bitte im Kontrakt hinterlegen', 'error'); return; }
  const art = kontraktArt(k);
  const kontakt = kontaktVon(k.kontakt_id);
  const ust = ustFuer(art, k, kontakt);
  _ed = { id: null, art, kontaktId: k.kontakt_id, kontraktId: k.id, datum: isoDatum(new Date()),
    zahlungszielTage: kontakt?.zahlungsziel_tage ?? 14, bemerkung: '', deaktiviert: new Set(), freie: [],
    lief: kontraktLieferungen(k).map(l => ({ ...l, gewaehlt: true, preis: Number(k.preis_eur) || 0, ust_satz: ust })) };
  editorRender();
}

export function belegOeffnen(id) {
  const b = _belege.find(x => x.id === id);
  if(!b || b.status !== 'entwurf') return;
  const k = state.kontrakte.find(x => x.id === b.kontrakt_id);
  const kontakt = kontaktVon(b.kontakt_id);
  const posL = new Map(b.positionen.filter(p => p.typ === 'lieferung').map(p => [p.quelle + ':' + p.quelle_id, p]));
  const ust = ustFuer(b.art, k, kontakt);
  const lief = k ? kontraktLieferungen(k, b.id).map(l => {
    const p = posL.get(l.key);
    return { ...l, gewaehlt: !!p, preis: p ? p.preis : Number(k.preis_eur) || 0, ust_satz: p ? p.ust_satz : ust, quali: { ...l.quali, ...(p?.quali || {}) } };
  }) : [];
  _ed = { id: b.id, art: b.art, kontaktId: b.kontakt_id, kontraktId: b.kontrakt_id, datum: isoDatum(new Date()),
    zahlungszielTage: b.zahlungsziel_tage ?? 14, bemerkung: b.bemerkung || '', lief, deaktiviert: new Set(),
    freie: b.positionen.filter(p => p.typ === 'frei').map(p => ({ bezeichnung: p.bezeichnung, beschreibung: p.beschreibung,
      vorz: p.menge < 0 ? '-' : '+', menge: Math.abs(p.menge), einheit: p.einheit, preis: p.preis, ust_satz: p.ust_satz })) };
  // Regeln, die im Entwurf keine Zeile hatten, aber jetzt eine erzeugen würden → als abgewählt übernehmen
  const vorhanden = new Set(b.positionen.filter(p => p.typ === 'regel').map(p => p.regel_id));
  const jetzt = new Set(regelPositionen().map(p => p.regel_id));
  jetzt.forEach(rid => { if(!vorhanden.has(rid)) _ed.deaktiviert.add(rid); });
  editorRender();
}

function edKontext() {
  const k = state.kontrakte.find(x => x.id === _ed.kontraktId) || null;
  return { k, kontakt: kontaktVon(_ed.kontaktId), artikel: artikelVon(k) };
}
function liefPositionen() {
  const { k } = edKontext();
  const name = k ? fruchtName(k) + (k.bio ? ' (Bio)' : '') : 'Ware';
  return _ed.lief.filter(l => l.gewaehlt).map(l => {
    const qs = Object.entries(l.quali || {}).filter(([f, v]) => v != null && v !== '' && QUALI_FELDER[f])
      .map(([f, v]) => `${QUALI_FELDER[f].label} ${num(v, 1, 2)} ${QUALI_FELDER[f].einheit}`);
    return pos({ typ: 'lieferung', quelle: l.quelle, quelle_id: l.quelle_id, bezeichnung: name,
      beschreibung: [`LS ${l.ls} vom ${datumDE(l.datum)}`, l.info, qs.join(', ')].filter(Boolean).join(' · '),
      datum: l.datum, menge: l.menge_t, einheit: 'TNE', preis: l.preis, ust_satz: l.ust_satz,
      quali: Object.fromEntries(Object.entries(l.quali || {}).filter(([, v]) => v != null && v !== '')) });
  });
}
function passendeRegeln() {
  const { k } = edKontext();
  return _regeln.filter(r => r.aktiv && (r.gilt_fuer === 'beide' || r.gilt_fuer === _ed.art)
    && (!r.artikel_id || r.artikel_id === k?.artikel_id) && (!r.kontakt_id || r.kontakt_id === _ed.kontaktId));
}
function regelPositionen() {
  const { k } = edKontext();
  if(!k) return [];
  return regelnAnwenden(_regeln, _ed.lief.filter(l => l.gewaehlt), { art: _ed.art, artikelId: k.artikel_id,
    kontaktId: _ed.kontaktId, deaktiviert: _ed.deaktiviert });
}
function freiePositionen() {
  return _ed.freie.filter(f => (f.bezeichnung || '').trim() || Number(f.preis)).map(f => pos({ typ: 'frei',
    bezeichnung: f.bezeichnung, beschreibung: f.beschreibung, menge: (f.vorz === '-' ? -1 : 1) * Math.abs(Number(f.menge) || 0),
    einheit: f.einheit, preis: f.preis, ust_satz: f.ust_satz }));
}
function edBeleg() {
  const { kontakt } = edKontext();
  const positionen = [...liefPositionen(), ...regelPositionen(), ...freiePositionen()];
  const daten = _ed.lief.filter(l => l.gewaehlt).map(l => l.datum).sort();
  const s = summen(positionen);
  return { id: _ed.id, art: _ed.art, kontakt_id: _ed.kontaktId, kontrakt_id: _ed.kontraktId,
    datum: _ed.datum, leistung_von: daten[0] || _ed.datum, leistung_bis: daten[daten.length - 1] || _ed.datum,
    zahlungsziel_tage: _ed.zahlungszielTage, empfaenger: partnerSnapshot(kontakt), positionen,
    steuern: s.steuern, netto: s.netto, ust: s.ust, brutto: s.brutto,
    ust_modus: _ed.art === 'gutschrift' ? (kontakt?.ust_modus || 'regel') : 'regel', bemerkung: _ed.bemerkung || null,
    erstellt_von: state.currentUser?.id || null };
}

function editorRender() {
  document.getElementById('beleg-editor')?.remove();
  const { k, kontakt } = edKontext();
  const titel = ART_TITEL[_ed.art];
  // Qualitätsspalten: alle Merkmale, die passende Regeln verwenden, plus vorhandene Werte.
  const qFelder = [...new Set([
    ...passendeRegeln().filter(r => r.feld && (r.art === 'gewicht_qualitaet' || r.art === 'preis_qualitaet')).map(r => r.feld),
  ])];
  const inpS = 'font-size:12px;padding:5px 6px;border:1px solid var(--color-border);border-radius:var(--radius-xs, 4px);background:var(--color-surface);color:var(--text)';
  const th = (t, r) => `<th style="padding:6px;text-align:${r ? 'right' : 'left'};font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--text3);white-space:nowrap">${t}</th>`;
  const ustOpts = v => UST_SAETZE.map(s => `<option value="${s}"${Number(v) === s ? ' selected' : ''}>${num(s, 0, 1)} %</option>`).join('');

  const liefRows = _ed.lief.map((l, i) => `<tr style="border-top:1px solid var(--color-border);${l.gewaehlt ? '' : 'opacity:.45'}">
      <td style="padding:5px 6px"><input type="checkbox" ${l.gewaehlt ? 'checked' : ''} onchange="edLiefToggle(${i},this.checked)" style="width:16px;height:16px"></td>
      <td style="padding:5px 6px;white-space:nowrap">${datumDE(l.datum)}</td>
      <td style="padding:5px 6px;white-space:nowrap"><b>${e(l.ls)}</b>${l.info ? `<div style="font-size:10px;color:var(--text3)">${e(l.info)}</div>` : ''}</td>
      <td style="padding:5px 6px;text-align:right;white-space:nowrap">${num(l.menge_t, 3, 3)} t</td>
      ${qFelder.map(f => `<td style="padding:5px 6px"><input type="number" step="0.01" value="${l.quali?.[f] ?? ''}" placeholder="–" onchange="edQuali(${i},'${f}',this.value)" style="${inpS};width:70px"></td>`).join('')}
      <td style="padding:5px 6px"><input type="number" step="0.01" min="0" value="${l.preis}" onchange="edLiefFeld(${i},'preis',this.value)" style="${inpS};width:90px"></td>
      <td style="padding:5px 6px"><select onchange="edLiefFeld(${i},'ust_satz',this.value)" style="${inpS}">${ustOpts(l.ust_satz)}</select></td>
      <td id="ed-lb-${i}" style="padding:5px 6px;text-align:right;font-weight:600;white-space:nowrap">${l.gewaehlt ? eur(r2(r3(l.menge_t) * l.preis)) : '–'}</td>
    </tr>`).join('');

  const freieRows = _ed.freie.map((f, i) => `<tr style="border-top:1px solid var(--color-border)">
      <td style="padding:5px 6px"><input type="text" value="${e(f.bezeichnung)}" placeholder="Bezeichnung" onchange="edFreiFeld(${i},'bezeichnung',this.value)" style="${inpS};width:100%;min-width:140px">
        <input type="text" value="${e(f.beschreibung)}" placeholder="Zusatztext (optional)" onchange="edFreiFeld(${i},'beschreibung',this.value)" style="${inpS};width:100%;margin-top:3px;font-size:11px"></td>
      <td style="padding:5px 6px"><select onchange="edFreiFeld(${i},'vorz',this.value)" style="${inpS}"><option value="+"${f.vorz !== '-' ? ' selected' : ''}>+ Zuschlag</option><option value="-"${f.vorz === '-' ? ' selected' : ''}>− Abzug</option></select></td>
      <td style="padding:5px 6px"><input type="number" step="0.001" min="0" value="${f.menge}" onchange="edFreiFeld(${i},'menge',this.value)" style="${inpS};width:80px"></td>
      <td style="padding:5px 6px"><select onchange="edFreiFeld(${i},'einheit',this.value)" style="${inpS}">${Object.entries(EINHEITEN).filter(([c]) => c !== 'LS').map(([c, l]) => `<option value="${c}"${f.einheit === c ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
      <td style="padding:5px 6px"><input type="number" step="0.01" min="0" value="${f.preis}" onchange="edFreiFeld(${i},'preis',this.value)" style="${inpS};width:90px"></td>
      <td style="padding:5px 6px"><select onchange="edFreiFeld(${i},'ust_satz',this.value)" style="${inpS}">${ustOpts(f.ust_satz)}</select></td>
      <td id="ed-fb-${i}" style="padding:5px 6px;text-align:right;font-weight:600;white-space:nowrap"></td>
      <td style="padding:5px 6px"><button class="btn btn-sm btn-outline" onclick="edFreiLoeschen(${i})" title="Position entfernen">✕</button></td>
    </tr>`).join('');

  const m = document.createElement('div');
  m.id = 'beleg-editor';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9500;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';
  m.innerHTML = `<div style="background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);padding:22px;width:100%;max-width:1150px;box-shadow:var(--shadow);margin:auto">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <div>
        <div style="font-family:var(--serif);font-size:20px;font-weight:700;color:var(--text)">${titel} ${_ed.id ? 'bearbeiten (Entwurf)' : 'erstellen'}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:2px"><b>${e(kontakt?.name || '–')}</b>${k ? ` · Kontrakt ${e(k.nummer)} · ${e(fruchtName(k))}${k.preis_eur ? ' · ' + num(k.preis_eur, 2, 2) + ' €/t' : ''}` : ' · ohne Kontrakt'}</div>
        <div style="font-size:11px;color:var(--text3)">${_ed.art === 'gutschrift' ? (kontakt?.ust_modus === 'pauschal24' ? 'Lieferant: Pauschalierer § 24 UStG (7,8 %)' : 'Lieferant: regelbesteuert') : ''}</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div class="form-group" style="margin:0"><label style="font-size:10px">Belegdatum</label><input type="date" value="${_ed.datum}" onchange="edFeld('datum',this.value)" style="${inpS}"></div>
        <div class="form-group" style="margin:0"><label style="font-size:10px">Zahlungsziel (Tage)</label><input type="number" min="0" step="1" value="${_ed.zahlungszielTage}" onchange="edFeld('zahlungszielTage',this.value)" style="${inpS};width:90px"></div>
      </div>
    </div>
    <div id="ed-pruefung"></div>

    ${k ? `<div class="section-label" style="margin:12px 0 6px">${_ed.art === 'rechnung' ? 'Auslieferungen' : 'Anlieferungen'} (${_ed.lief.length})</div>
    ${_ed.lief.length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr>${th(`<input type="checkbox" ${_ed.lief.every(l => l.gewaehlt) ? 'checked' : ''} onchange="edLiefAlle(this.checked)" style="width:16px;height:16px">`)}${th('Datum')}${th('Lieferschein')}${th('Menge', 1)}
        ${qFelder.map(f => th(`${QUALI_FELDER[f].label} ${QUALI_FELDER[f].einheit}`)).join('')}${th('Preis €/t')}${th('USt')}${th('Betrag', 1)}</tr></thead>
      <tbody>${liefRows}</tbody></table></div>` : '<div style="font-size:12px;color:var(--text3)">Keine offenen Lieferungen zu diesem Kontrakt.</div>'}` : ''}

    <div id="ed-regeln"></div>

    <div class="section-label" style="margin:14px 0 6px">Weitere Positionen</div>
    ${_ed.freie.length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr>${th('Bezeichnung')}${th('Art')}${th('Menge')}${th('Einheit')}${th('Preis €')}${th('USt')}${th('Betrag', 1)}${th('')}</tr></thead>
      <tbody>${freieRows}</tbody></table></div>` : ''}
    <button class="btn btn-sm btn-outline" style="margin-top:6px" onclick="edFreiNeu()">+ Position (z. B. Fracht, Lagergeld, Abzug)</button>

    <div style="display:grid;grid-template-columns:1fr minmax(260px,340px);gap:18px;margin-top:16px;align-items:start">
      <div class="form-group" style="margin:0"><label>Bemerkung auf dem Beleg (optional)</label>
        <textarea rows="3" onchange="edFeld('bemerkung',this.value)" style="width:100%;resize:vertical;${inpS}">${e(_ed.bemerkung)}</textarea></div>
      <div id="ed-summen"></div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:18px;border-top:1px solid var(--color-border);padding-top:14px">
      <button class="btn btn-outline" onclick="edSchliessen()">Abbrechen</button>
      <button class="btn btn-outline" onclick="edVorschau()">👁 PDF-Vorschau</button>
      <button class="btn btn-outline" onclick="edSpeichern()">Entwurf speichern</button>
      <button class="btn btn-primary" onclick="edFestschreiben()">Festschreiben &amp; archivieren</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  edAktualisieren();
}

// Berechnete Bereiche aktualisieren, ohne Eingabefelder neu zu rendern.
function edAktualisieren() {
  if(!_ed) return;
  const b = edBeleg();
  _ed.lief.forEach((l, i) => { const c = document.getElementById('ed-lb-' + i); if(c) c.textContent = l.gewaehlt ? eur(r2(r3(l.menge_t) * l.preis)) : '–'; });
  const fp = _ed.freie.map(f => pos({ menge: (f.vorz === '-' ? -1 : 1) * Math.abs(Number(f.menge) || 0), preis: f.preis }));
  fp.forEach((p, i) => { const c = document.getElementById('ed-fb-' + i); if(c) { c.textContent = eur(p.betrag); c.style.color = p.betrag < 0 ? 'var(--red)' : ''; } });

  // Regeln
  const reg = passendeRegeln();
  const rp = regelPositionen();
  const rEl = document.getElementById('ed-regeln');
  if(rEl) rEl.innerHTML = reg.length && _ed.kontraktId ? `<div class="section-label" style="margin:14px 0 6px">Abzüge &amp; Zuschläge aus Regeln</div>
    ${reg.map(r => {
      const zeilen = rp.filter(p => p.regel_id === r.id);
      const aus = _ed.deaktiviert.has(r.id);
      return `<div style="border:1px solid var(--color-border);border-radius:var(--radius-sm, 6px);padding:8px 10px;margin-bottom:6px;${aus ? 'opacity:.5' : ''}">
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer;font-size:12px">
          <input type="checkbox" ${aus ? '' : 'checked'} onchange="edRegelToggle(${r.id},this.checked)" style="width:16px;height:16px">
          <b style="color:var(--text)">${e(r.name)}</b><span style="color:var(--text3)">${e(regelBeschreibung(r))}</span>
          <span style="flex:1"></span><b style="color:${zeilen.reduce((s, p) => s + p.betrag, 0) < 0 ? 'var(--red)' : 'var(--text)'}">${zeilen.length ? eur(zeilen.reduce((s, p) => s + p.betrag, 0)) : (aus ? 'aus' : 'greift nicht')}</b>
        </label>
        ${zeilen.length ? `<div style="font-size:11px;color:var(--text3);margin:4px 0 0 24px">${zeilen.map(p => `${e(p.beschreibung)} → ${num(p.menge, 3, 4)} ${EINHEITEN[p.einheit]} × ${num(p.preis, 2, 4)} € = <b>${eur(p.betrag)}</b>`).join('<br>')}</div>` : ''}
      </div>`;
    }).join('')}` : '';

  // Summen
  const sEl = document.getElementById('ed-summen');
  if(sEl) sEl.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--color-border);border-radius:var(--radius-sm, 6px);padding:12px 14px;font-size:13px">
    <div style="display:flex;justify-content:space-between"><span>Summe netto</span><span>${eur(b.netto)}</span></div>
    ${b.steuern.map(s => `<div style="display:flex;justify-content:space-between;color:var(--text2)"><span>USt ${num(s.satz, 0, 1)} % auf ${eur(s.basis)}</span><span>${eur(s.betrag)}</span></div>`).join('')}
    <div style="display:flex;justify-content:space-between;font-weight:800;font-size:16px;border-top:1px solid var(--border2);margin-top:6px;padding-top:6px;color:var(--gold)">
      <span>${_ed.art === 'gutschrift' ? 'Auszahlung' : 'Gesamt'}</span><span>${eur(b.brutto)}</span></div>
    <div style="font-size:10px;color:var(--text3);margin-top:4px">${b.positionen.length} Position${b.positionen.length === 1 ? '' : 'en'}</div>
  </div>`;

  // Prüfung
  const { fehler, hinweise } = pruefeBeleg(b);
  const pEl = document.getElementById('ed-pruefung');
  if(pEl) pEl.innerHTML = (fehler.length || hinweise.length) ? `<div style="border:1px solid ${fehler.length ? 'var(--red)' : 'var(--color-warning, #b07820)'};border-radius:var(--radius-sm, 6px);padding:8px 12px;margin-bottom:8px;font-size:12px">
    ${fehler.map(f => `<div style="color:var(--red)">✕ ${e(f)}</div>`).join('')}
    ${hinweise.map(h => `<div style="color:var(--color-warning, #b07820)">⚠ ${e(h)}</div>`).join('')}
    ${fehler.length ? `<div style="margin-top:4px"><button class="btn btn-sm btn-outline" onclick="kontaktEditDialog(${_ed.kontaktId})">Kontakt bearbeiten</button> <span style="color:var(--text3);font-size:11px">nach dem Speichern wird der Beleg automatisch aktualisiert</span></div>` : ''}
  </div>` : '';
}

export function edFeld(feld, val) {
  if(!_ed) return;
  if(feld === 'zahlungszielTage') { const n = parseInt(val); _ed.zahlungszielTage = isNaN(n) ? 14 : Math.max(0, n); }
  else _ed[feld] = val;
  edAktualisieren();
}
export function edLiefToggle(i, an) { if(!_ed?.lief[i]) return; _ed.lief[i].gewaehlt = an; editorRender(); }
export function edLiefAlle(an) { if(!_ed) return; _ed.lief.forEach(l => l.gewaehlt = an); editorRender(); }
export function edLiefFeld(i, feld, val) {
  const l = _ed?.lief[i]; if(!l) return;
  l[feld] = Math.max(0, zahl(val) ?? 0);
  // Preis auf alle folgenden gewählten Lieferungen übernehmen? Nein – bewusst je Zeile.
  edAktualisieren();
}
export function edQuali(i, feld, val) {
  const l = _ed?.lief[i]; if(!l) return;
  l.quali = { ...(l.quali || {}), [feld]: zahl(val) };
  edAktualisieren();
}
export function edRegelToggle(id, an) { if(!_ed) return; if(an) _ed.deaktiviert.delete(id); else _ed.deaktiviert.add(id); edAktualisieren(); }
export function edFreiNeu() {
  if(!_ed) return;
  const std = _ed.lief.find(l => l.gewaehlt)?.ust_satz ?? (_ed.art === 'gutschrift' && edKontext().kontakt?.ust_modus === 'pauschal24' ? 7.8 : 19);
  _ed.freie.push({ bezeichnung: '', beschreibung: '', vorz: '+', menge: 1, einheit: 'C62', preis: 0, ust_satz: std });
  editorRender();
}
export function edFreiFeld(i, feld, val) {
  const f = _ed?.freie[i]; if(!f) return;
  f[feld] = ['menge', 'preis', 'ust_satz'].includes(feld) ? Math.max(0, zahl(val) ?? 0) : val;
  edAktualisieren();
}
export function edFreiLoeschen(i) { if(!_ed) return; _ed.freie.splice(i, 1); editorRender(); }
export function edSchliessen() { document.getElementById('beleg-editor')?.remove(); _ed = null; }

export async function edVorschau() {
  if(!_ed) return;
  const b = edBeleg();
  if(!b.positionen.length) { showToast('⚠ Keine Positionen', 'error'); return; }
  try {
    showToast('PDF wird erzeugt…');
    const { bytes } = await erzeugePdf({ ...b, faellig_am: null }, { kontrakt: edKontext().k, entwurf: true });
    oeffneBytes(bytes);
  } catch(err) { console.error(err); showToast('⚠ PDF-Vorschau fehlgeschlagen: ' + err.message, 'error'); }
}

async function entwurfSichern() {
  const b = edBeleg();
  if(!b.empfaenger) throw new Error('Kein Kontakt');
  const saved = await db.saveBelegEntwurf(b);
  _ed.id = saved.id;
  const i = _belege.findIndex(x => x.id === saved.id);
  if(i >= 0) _belege[i] = saved; else _belege.unshift(saved);
  return saved;
}
export async function edSpeichern() {
  if(!_ed || _busy) return;
  _busy = true;
  try {
    await entwurfSichern();
    await quellenNeuLaden();
    showToast('✓ Entwurf gespeichert');
    edSchliessen();
    renderRechnungen();
  } catch(err) { console.error(err); showToast('⚠ ' + err.message, 'error'); }
  finally { _busy = false; }
}

export async function edFestschreiben() {
  if(!_ed || _busy) return;
  const b = edBeleg();
  const { fehler } = pruefeBeleg(b);
  if(fehler.length) { showToast('⚠ ' + fehler[0], 'error'); return; }
  if(!confirm(`${ART_TITEL[b.art]} über ${eur(b.brutto)} an ${b.empfaenger?.name} jetzt festschreiben?\n\nDer Beleg erhält eine fortlaufende Nummer und kann danach nicht mehr geändert, nur noch storniert werden.`)) return;
  _busy = true;
  try {
    await entwurfSichern();
    const fest = await db.festschreibenBeleg(_ed.id, _ed.datum);
    edSchliessen();
    await archivieren(fest);
    await laden();
    await quellenNeuLaden();
    renderRechnungen();
    showToast(`✓ ${fest.nummer} festgeschrieben`);
    belegSendenDialog(fest.id);
  } catch(err) {
    console.error(err);
    showToast('⚠ ' + err.message, 'error');
    await laden(); renderRechnungen();
  } finally { _busy = false; }
}

// PDF/A-3 + XML erzeugen und im Storage archivieren (einmalig je Beleg).
async function archivieren(b) {
  const ctx = belegCtx(b);
  const { bytes, xml } = await erzeugePdf(b, ctx);
  const pfad = `${b.art}/${String(b.datum).slice(0, 4)}/${b.nummer}_${Date.now()}.pdf`;
  await db.uploadBelegPdf(pfad, bytes);
  await db.belegArchivieren(b.id, pfad, xml);
  return bytes;
}
function belegCtx(b) {
  return { kontrakt: state.kontrakte.find(k => k.id === b.kontrakt_id) || null,
    original: b.storno_von_id ? _belege.find(x => x.id === b.storno_von_id) || null : null };
}

// ─── Aktionen auf Belegen ─────────────────────────────────────────────────
export async function belegLoeschen(id) {
  const b = _belege.find(x => x.id === id);
  if(!b || b.status !== 'entwurf') return;
  if(!confirm('Entwurf löschen? Die Lieferungen werden wieder freigegeben.')) return;
  try { await db.deleteBeleg(id); _belege = _belege.filter(x => x.id !== id); await quellenNeuLaden(); renderRechnungen(); showToast('Entwurf gelöscht'); }
  catch(err) { showToast('⚠ ' + err.message, 'error'); }
}
export async function belegPdf(id) {
  const b = _belege.find(x => x.id === id);
  if(!b?.pdf_pfad) return;
  try { const blob = await db.downloadBelegPdf(b.pdf_pfad); oeffneBytes(new Uint8Array(await blob.arrayBuffer())); }
  catch(err) { showToast('⚠ ' + err.message, 'error'); }
}
export function belegXml(id) {
  const b = _belege.find(x => x.id === id);
  if(!b?.xml) return;
  downloadBytes(new TextEncoder().encode(b.xml), `${b.nummer}.xml`, 'application/xml');
}
export async function belegPdfNeu(id) {
  const b = _belege.find(x => x.id === id);
  if(!b || b.status === 'entwurf' || b.pdf_pfad || _busy) return;
  _busy = true;
  try { await archivieren(b); await laden(); renderRechnungen(); showToast('✓ PDF archiviert'); }
  catch(err) { showToast('⚠ ' + err.message, 'error'); }
  finally { _busy = false; }
}
export async function belegStornieren(id) {
  const b = _belege.find(x => x.id === id);
  if(!b || b.status === 'entwurf' || b.status === 'storniert' || _busy) return;
  if(!confirm(`${belegTitel(b)} ${b.nummer} stornieren?\n\nEs wird ein Storno-Beleg mit eigener Nummer und negativen Beträgen erzeugt. Die Lieferungen werden danach wieder zur Abrechnung frei.`)) return;
  _busy = true;
  try {
    const positionen = b.positionen.map(p => pos({ ...p, menge: -Number(p.menge) }));
    const s = summen(positionen);
    const entwurf = await db.saveBelegEntwurf({ art: b.art, kontakt_id: b.kontakt_id, kontrakt_id: b.kontrakt_id,
      storno_von_id: b.id, datum: isoDatum(new Date()), leistung_von: b.leistung_von, leistung_bis: b.leistung_bis,
      zahlungsziel_tage: 0, empfaenger: b.empfaenger, positionen, steuern: s.steuern, netto: s.netto, ust: s.ust,
      brutto: s.brutto, ust_modus: b.ust_modus, bemerkung: null, erstellt_von: state.currentUser?.id || null });
    const fest = await db.festschreibenBeleg(entwurf.id, isoDatum(new Date()));
    await laden();
    await archivieren(fest);
    await laden();
    await quellenNeuLaden();
    renderRechnungen();
    showToast(`✓ Storno ${fest.nummer} erstellt`);
    belegSendenDialog(fest.id);
  } catch(err) { console.error(err); showToast('⚠ ' + err.message, 'error'); await laden(); renderRechnungen(); }
  finally { _busy = false; }
}

export function belegSendenDialog(id) {
  const b = _belege.find(x => x.id === id);
  if(!b || !b.pdf_pfad) return;
  const titel = belegTitel(b);
  const k = state.kontrakte.find(x => x.id === b.kontrakt_id);
  const text = `Sehr geehrte Damen und Herren,

anbei erhalten Sie unsere ${titel} ${b.nummer} vom ${datumDE(b.datum)} über ${eur(b.brutto)}${k ? ` zu Kontrakt ${k.nummer}` : ''}.

Die Datei ist eine elektronische Rechnung im Format ZUGFeRD (EN 16931). Die maschinenlesbaren Rechnungsdaten sind im PDF eingebettet.

Mit freundlichen Grüßen
${FIRMA_NAME}`;
  const m = document.createElement('div');
  m.id = 'senden-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9700;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  m.innerHTML = `<div style="background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);padding:24px;width:100%;max-width:560px;box-shadow:var(--shadow)">
    <div style="font-family:var(--serif);font-size:18px;font-weight:700;color:var(--text);margin-bottom:4px">✉ ${titel} ${e(b.nummer)} versenden</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:14px">${e(b.empfaenger?.name || '')} · ${eur(b.brutto)} · Anhang: ${e(b.nummer)}.pdf (ZUGFeRD)</div>
    ${b.versendet_am ? `<div style="font-size:12px;color:var(--color-warning, #b07820);margin-bottom:10px">⚠ Bereits versendet am ${new Date(b.versendet_am).toLocaleString('de-DE')} an ${e(b.versendet_an || '')}</div>` : ''}
    <div class="form-group"><label>An *</label><input type="text" id="sd-an" value="${e(b.empfaenger?.email || '')}" placeholder="rechnung@kunde.de (mehrere mit Komma)"></div>
    <div class="form-group"><label>CC</label><input type="text" id="sd-cc" value=""></div>
    <div class="form-group"><label>Betreff</label><input type="text" id="sd-betreff" value="${e(`${titel} ${b.nummer} – ${FIRMA_NAME}`)}"></div>
    <div class="form-group"><label>Text</label><textarea id="sd-text" rows="9" style="width:100%;resize:vertical">${e(text)}</textarea></div>
    <div style="font-size:12px;color:var(--text2);background:var(--bg2);border:1px solid var(--color-border);border-radius:var(--radius-sm, 6px);padding:8px 10px;margin-bottom:10px">
      <b>1.</b> „In Outlook öffnen“ lädt <b>${e(b.nummer)}.pdf</b> herunter und öffnet eine vorbereitete Mail.<br>
      <b>2.</b> In Outlook Absender <b>rechnungen@</b> wählen, das PDF aus „Downloads“ anhängen und senden.<br>
      <b>3.</b> Hier „Als versendet markieren“.
    </div>
    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
      <button class="btn btn-primary" style="flex:1" onclick="belegOutlook(${b.id})">In Outlook öffnen</button>
      <button class="btn btn-outline" style="flex:1" id="sd-btn" onclick="belegAlsVersendet(${b.id})">✓ Als versendet markieren</button>
      <button class="btn btn-outline" onclick="document.getElementById('senden-modal').remove()">Später</button>
    </div>
  </div>`;
  document.body.appendChild(m);
}
// PDF herunterladen und eine vorbereitete Mail im Standard-Mailprogramm (Outlook) öffnen.
// Anhänge lassen sich per mailto: nicht übergeben – das PDF hängt der Nutzer selbst an.
export async function belegOutlook(id) {
  const b = _belege.find(x => x.id === id);
  if(!b?.pdf_pfad) return;
  const an = (document.getElementById('sd-an')?.value || '').trim();
  const cc = (document.getElementById('sd-cc')?.value || '').trim();
  const betreff = document.getElementById('sd-betreff')?.value || '';
  const text = document.getElementById('sd-text')?.value || '';
  try {
    const blob = await db.downloadBelegPdf(b.pdf_pfad);
    downloadBytes(new Uint8Array(await blob.arrayBuffer()), `${b.nummer}.pdf`, 'application/pdf');
    const q = [cc ? 'cc=' + encodeURIComponent(cc) : '', 'subject=' + encodeURIComponent(betreff), 'body=' + encodeURIComponent(text)]
      .filter(Boolean).join('&');
    window.location.href = `mailto:${an.replace(/[\s;]+/g, ',').replace(/,+/g, ',')}?${q}`;
  } catch(err) { console.error(err); showToast('⚠ ' + err.message, 'error'); }
}
export async function belegAlsVersendet(id) {
  const b = _belege.find(x => x.id === id);
  if(!b) return;
  const an = [document.getElementById('sd-an')?.value, document.getElementById('sd-cc')?.value]
    .map(s => (s || '').trim()).filter(Boolean).join(', ');
  try {
    await db.belegVersendetMarkieren(id, b.status === 'storniert' ? 'storniert' : 'versendet', an || 'manuell (Outlook)');
    document.getElementById('senden-modal')?.remove();
    showToast('✓ Als versendet markiert');
    await laden(); renderRechnungen();
  } catch(err) { console.error(err); showToast('⚠ ' + err.message, 'error'); }
}

// Nach dem Bearbeiten eines Kontakts (aus dem Editor heraus) Ansicht auffrischen.
export function rechnungKontaktAktualisiert() {
  if(_ed && document.getElementById('beleg-editor')) editorRender();
  else renderRechnungen();
}

// Für onclick-Handler (Registrierung in app.js)
export const RECHNUNGEN_WINDOW = {
  renderRechnungen, rechnungenView, belegFilter, rechnungNeu, rechnungFreiDialog, rechnungFreiStart,
  belegOeffnen, belegLoeschen, belegPdf, belegXml, belegPdfNeu, belegStornieren, belegSendenDialog, belegOutlook, belegAlsVersendet,
  edFeld, edLiefToggle, edLiefAlle, edLiefFeld, edQuali, edRegelToggle, edFreiNeu, edFreiFeld, edFreiLoeschen,
  edSchliessen, edVorschau, edSpeichern, edFestschreiben,
  regelDialog, regelArtWechsel, regelSpeichern, regelToggle, regelLoeschen,
};
