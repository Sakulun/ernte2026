import { state } from './state.js?v=105';
import { db } from './db.js?v=105';
import { showToast, escapeHtml } from './helpers.js?v=105';

let _offenerKontrakt = null;
// PDF-Import-Daten des offenen Dialogs. Werden NICHT über das onclick-Attribut
// uebergeben (Apostrophe im PDF-Text zerbrechen sonst den Handler-String).
let _pdfImport = { name: '', text: '' };

// Filter/Suche der Kontrakt-Liste (wie bei Schlägen).
let _kFilterFruchtart = '';
let _kFilterKunde = '';
let _kSuche = '';
let _kRichtung = 'verkauf'; // 'verkauf' | 'einkauf' – getrennte Ansicht/Anlage

export function setKontraktRichtung(r) { _kRichtung = r; renderKontrakte(); }

// Fruchtart-/Artikelname eines Kontrakts (für Anzeige + Filter + Suche).
function kontraktFruchtart(k) {
  const art = state.artikel.find(a => a.id === k.artikel_id);
  return (art?.name || k.fruchtart_text || '').trim();
}
function kontraktKundeName(k) {
  return (state.kontakte.find(c => c.id === k.kontakt_id)?.name || '').trim();
}
// Trifft ein Kontrakt die aktuellen Filter + die Suche?
function kontraktPasst(k) {
  if(_kFilterFruchtart && kontraktFruchtart(k) !== _kFilterFruchtart) return false;
  if(_kFilterKunde && kontraktKundeName(k) !== _kFilterKunde) return false;
  if(_kSuche) {
    const q = _kSuche.toLowerCase();
    const heu = [k.nummer, kontraktKundeName(k), kontraktFruchtart(k), k.paritaet]
      .filter(Boolean).join(' ').toLowerCase();
    if(!heu.includes(q)) return false;
  }
  return true;
}

export function setKontraktFilter(feld, wert) {
  if(feld === 'fruchtart') _kFilterFruchtart = wert;
  else if(feld === 'kunde') _kFilterKunde = wert;
  renderKontrakte();
}
export function kontraktSucheInput(val) {
  _kSuche = val;
  renderKontrakte();
  // Fokus + Cursor im (neu gerenderten) Suchfeld wiederherstellen.
  const inp = document.getElementById('kontrakt-suche');
  if(inp) { inp.focus(); const p = (val || '').length; inp.setSelectionRange(p, p); }
}
export function kontraktFilterReset() {
  _kFilterFruchtart = ''; _kFilterKunde = ''; _kSuche = '';
  renderKontrakte();
}

export function getKontraktGeliefertKg(kontraktId) {
  const ausKg = state.warenbewegungen
    .filter(w=>w.kontrakt_id===kontraktId && w.typ==='ausgang')
    .reduce((s,w)=>s+(Number(w.menge_kg)||0),0);
  const liefKg = state.lieferungen
    .filter(l=>l.kontrakt_id===kontraktId && l.status==='abgeschlossen' && l.vollgewicht && l.leergewicht)
    .reduce((s,l)=>s+(l.vollgewicht-l.leergewicht),0);
  return ausKg + liefKg;
}

// Auslieferungen (Warenausgänge) eines Kontrakts, älteste zuerst.
export function kontraktFuhren(kId) {
  return state.warenbewegungen
    .filter(w => w.typ==='ausgang' && w.kontrakt_id===kId)
    .sort((a,b) => new Date(a.erstellt_am) - new Date(b.erstellt_am));
}
// Raps-Kontrakt? (dann Zusatzspalte Qualitätsabrechnung)
function istRapsKontrakt(k) {
  const art = state.artikel.find(a=>a.id===k.artikel_id)?.name || '';
  return /raps/i.test(art + ' ' + (k.fruchtart_text||''));
}

export function toggleKontraktDetail(id) {
  _offenerKontrakt = (_offenerKontrakt === id) ? null : id;
  renderKontrakte();
}

// Ein Abrechnungsfeld einer Auslieferung speichern (Gutschrift-Nr., Fracht-Nr., Quali-Nr., Klären, Bemerkung).
export async function kontraktFuhreFeld(id, feld, wert) {
  const w = state.warenbewegungen.find(x => x.id === id);
  if(!w) return;
  w[feld] = wert;
  const keyMap = { gutschrift_nr:'gutschriftNr', fracht_nr:'frachtNr', quali_nr:'qualiNr', klaeren:'klaeren', bemerkung:'bemerkung' };
  try {
    await db.updateWarenbewegungAbrechnung(id, { [keyMap[feld]]: wert });
    // Nur bei "klären" neu rendern (Markierung/Zähler); Textfelder still speichern,
    // um Fokus/Tippfluss nicht zu unterbrechen.
    if(feld === 'klaeren') renderKontrakte();
  } catch(e) { showToast('⚠ '+e.message, 'error'); }
}

function kontraktDetailHTML(k) {
  const fuhren = kontraktFuhren(k.id);
  if(!fuhren.length) return `<div style="padding:10px 2px;font-size:12px;color:var(--text3)">Noch keine Auslieferungen für diesen Kontrakt.</div>`;
  const raps = istRapsKontrakt(k);
  // Frachtabrechnung nur, wenn der Verkäufer die Fracht trägt. Bei Parität
  // "ab Hof" holt der Käufer ab – dann keine Frachtabrechnung.
  const abHof = /\bab\s*hof/i.test(k.paritaet || '');
  const feldInput = (id, feld, val, ph) =>
    `<input type="text" value="${escapeHtml(val||'')}" placeholder="${escapeHtml(ph)}" onchange="kontraktFuhreFeld(${id},'${feld}',this.value)"
      style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--color-border);border-radius:var(--radius-xs);background:var(--color-surface);color:var(--text)">`;
  const rows = fuhren.map(w => {
    const art = state.artikel.find(a=>a.id===w.artikel_id);
    const datum = w.erstellt_am ? new Date(w.erstellt_am).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'}) : '';
    const nettoT = ((Number(w.menge_kg)||0)/1000).toFixed(2);
    const warn = !!w.klaeren;
    return `<div style="border:1px solid ${warn?'var(--color-warning)':'var(--color-border)'};border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:8px;background:${warn?'var(--status-offen-bg)':'var(--color-surface)'}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <div style="font-size:12px;color:var(--text)"><b>LS ${escapeHtml(w.lieferschein_nr||'–')}</b> · ${escapeHtml(datum)}<span style="color:var(--text3)"> · ${escapeHtml(art?.name||'–')}</span></div>
        <div style="font-size:14px;font-weight:700;color:var(--gold)">${nettoT} t</div>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px">🚚 ${escapeHtml(w.spedition||'–')}${w.kennzeichen?' · '+escapeHtml(w.kennzeichen):''}${w.sonstige_angaben?` · <span style="color:var(--gold);font-weight:600" title="Freitexteingabe">📝 ${escapeHtml(w.sonstige_angaben)}</span>`:''}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:8px">
        <div><label style="font-size:10px;color:var(--text2);display:block;margin-bottom:2px">Gutschrift-Nr.</label>${feldInput(w.id,'gutschrift_nr',w.gutschrift_nr,'Nummer')}</div>
        ${abHof?'':`<div><label style="font-size:10px;color:var(--text2);display:block;margin-bottom:2px">Frachtabrechnung-Nr.</label>${feldInput(w.id,'fracht_nr',w.fracht_nr,'Nummer')}</div>`}
        ${raps?`<div><label style="font-size:10px;color:var(--text2);display:block;margin-bottom:2px">Qualitätsabrechnung-Nr.</label>${feldInput(w.id,'quali_nr',w.quali_nr,'Nummer')}</div>`:''}
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:${warn?'700':'400'};color:${warn?'var(--color-warning)':'var(--text2)'};cursor:pointer;white-space:nowrap">
          <input type="checkbox" ${warn?'checked':''} onchange="kontraktFuhreFeld(${w.id},'klaeren',this.checked)" style="width:16px;height:16px;accent-color:var(--color-warning);cursor:pointer">⚠ zu klären
        </label>
        <div style="flex:1;min-width:150px">${feldInput(w.id,'bemerkung',w.bemerkung,'Bemerkung…')}</div>
      </div>
    </div>`;
  }).join('');
  return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--color-border)">
    <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text3);margin-bottom:8px">${fuhren.length} Fuhre${fuhren.length===1?'':'n'} · Abrechnung</div>
    ${rows}
  </div>`;
}

// Übersicht der kontrahierten & gelieferten Mengen je Fruchtart/Artikel.
// Über alle nicht-stornierten Kontrakte (aktiv + erfüllt).
function fruchtartUebersichtHTML() {
  const map = {};
  state.kontrakte.filter(k => k.status !== 'storniert').forEach(k => {
    const art = state.artikel.find(a => a.id === k.artikel_id);
    const name = (art?.name || k.fruchtart_text || 'Ohne Artikel').trim();
    const e = map[name] || (map[name] = { kontrahiert:0, geliefert:0, anzahl:0 });
    e.kontrahiert += (k.menge_t || 0);
    e.geliefert   += getKontraktGeliefertKg(k.id) / 1000;
    e.anzahl      += 1;
  });
  const rows = Object.entries(map).sort((a,b) => b[1].kontrahiert - a[1].kontrahiert);
  if(!rows.length) return '';
  const t0 = n => n.toLocaleString('de-DE', { maximumFractionDigits:0 });
  const t1 = n => n.toLocaleString('de-DE', { minimumFractionDigits:1, maximumFractionDigits:1 });
  const zeile = (name, e, total) => {
    const rest = Math.max(0, e.kontrahiert - e.geliefert);
    const pct  = e.kontrahiert ? Math.min(100, e.geliefert / e.kontrahiert * 100) : 0;
    const bar  = pct>=100 ? 'var(--green2)' : pct>70 ? 'var(--amber)' : 'var(--gold)';
    return `<tr style="${total?'font-weight:700;border-top:2px solid var(--border2)':'border-top:1px solid var(--color-border)'}">
      <td style="padding:7px 8px;color:var(--text)">${escapeHtml(name)}${total?'':` <span style="color:var(--text3);font-weight:400;font-size:11px">· ${e.anzahl}</span>`}</td>
      <td style="padding:7px 8px;text-align:right;color:var(--text)">${t0(e.kontrahiert)} t</td>
      <td style="padding:7px 8px;text-align:right;color:var(--gold)">${t1(e.geliefert)} t</td>
      <td style="padding:7px 8px;text-align:right;color:var(--text2)">${t1(rest)} t</td>
      <td style="padding:7px 8px;width:90px"><div style="background:var(--neutral-200);border-radius:6px;height:8px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${bar}"></div></div></td>
    </tr>`;
  };
  const totK = rows.reduce((s,[,e]) => s+e.kontrahiert, 0);
  const totG = rows.reduce((s,[,e]) => s+e.geliefert, 0);
  return `<div class="section-label" style="margin-bottom:8px">Kontrahiert &amp; geliefert je Fruchtart</div>
  <div style="overflow-x:auto;margin-bottom:16px">
    <table style="width:100%;border-collapse:collapse;font-size:12px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden">
      <thead><tr style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);background:var(--bg2)">
        <th style="padding:7px 8px;text-align:left">Fruchtart</th>
        <th style="padding:7px 8px;text-align:right">Kontrahiert</th>
        <th style="padding:7px 8px;text-align:right">Geliefert</th>
        <th style="padding:7px 8px;text-align:right">Rest</th>
        <th style="padding:7px 8px;text-align:left">Fortschritt</th>
      </tr></thead>
      <tbody>
        ${rows.map(([name,e]) => zeile(name, e, false)).join('')}
        ${zeile('Gesamt', { kontrahiert:totK, geliefert:totG }, true)}
      </tbody>
    </table>
  </div>`;
}

export function renderKontrakte() {
  const alle     = state.kontrakte.filter(k => (k.richtung||'verkauf') === _kRichtung);
  const einkauf  = _kRichtung === 'einkauf';
  const aktiv    = alle.filter(k=>k.status==='aktiv');
  const erfuellt = alle.filter(k=>k.status==='erfuellt');
  const stornier = alle.filter(k=>k.status==='storniert');
  // Summen/Übersicht über alle nicht-stornierten Kontrakte (aktiv + erfüllt),
  // damit bereits erfüllte Lieferungen (z.B. Raps) nicht fehlen.
  const offen    = alle.filter(k=>k.status!=='storniert');
  const gesamtT  = offen.reduce((s,k)=>s+(k.menge_t||0),0);
  const geliefT  = offen.reduce((s,k)=>s+getKontraktGeliefertKg(k.id)/1000,0);

  // Filter/Suche nur auf die angezeigten Listen (Kennzahlen + Übersicht bleiben gesamt).
  const filterAktiv = !!(_kFilterFruchtart || _kFilterKunde || _kSuche);
  const fAktiv    = aktiv.filter(kontraktPasst);
  const fErfuellt = erfuellt.filter(kontraktPasst);
  const fStornier = stornier.filter(kontraktPasst);
  const fruchtarten = [...new Set(alle.map(kontraktFruchtart).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));
  const kunden      = [...new Set(alle.map(kontraktKundeName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));
  const fruchtartOpts = fruchtarten.map(f=>`<option value="${escapeHtml(f)}" ${_kFilterFruchtart===f?'selected':''}>${escapeHtml(f)}</option>`).join('');
  const kundeOpts     = kunden.map(k=>`<option value="${escapeHtml(k)}" ${_kFilterKunde===k?'selected':''}>${escapeHtml(k)}</option>`).join('');

  const kRow = (k) => {
    const geliefKg  = getKontraktGeliefertKg(k.id);
    const geliefT   = geliefKg/1000;
    const restT     = Math.max(0,(k.menge_t||0)-geliefT);
    const pct       = k.menge_t ? Math.min(100,(geliefT/k.menge_t)*100) : 0;
    const barColor  = pct>=100?'var(--green2)':pct>70?'var(--amber)':'var(--gold)';
    const kt        = state.kontakte.find(c=>c.id===k.kontakt_id);
    const art       = state.artikel.find(a=>a.id===k.artikel_id);
    const vonBis    = [k.lieferung_von,k.lieferung_bis].filter(Boolean).map(d=>new Date(d).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})).join('–');
    const fuhren    = kontraktFuhren(k.id);
    const klaerenN  = fuhren.filter(w=>w.klaeren).length;
    const offen     = _offenerKontrakt === k.id;
    return `<div class="card" style="margin-bottom:8px">
      <div onclick="toggleKontraktDetail(${k.id})" style="cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="color:var(--text3);font-size:12px">${offen?'▾':'▸'}</span>
              <div style="font-family:var(--serif);font-size:15px;font-weight:700;color:var(--text)">${escapeHtml(k.nummer)}</div>
              ${k.zert_nachhaltig?'<span class="badge" style="background:var(--green-100,#e6f2e6);color:var(--green2)">♻ Nachhaltig</span>':''}
              ${k.zert_gmp?'<span class="badge" style="background:var(--neutral-200);color:var(--text)">GMP+</span>':''}
              ${k.bio?'<span class="badge badge-aktiv">🌿 EU-Öko</span>':''}
              <span class="badge badge-${k.status==='aktiv'?'aktiv':'inaktiv'}">${k.status.toUpperCase()}</span>
            </div>
            <div style="font-size:12px;color:var(--text2);margin-top:2px">${kt?escapeHtml(kt.name):'–'}${art?' · '+escapeHtml(art.name):k.fruchtart_text?' · '+escapeHtml(k.fruchtart_text):''}</div>
            <div style="font-size:11px;color:var(--text3)">${vonBis||''}${k.paritaet?' · '+escapeHtml(k.paritaet):''}${k.preis_eur?' · '+k.preis_eur.toFixed(2)+' €/t':''}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:3px">🚚 ${fuhren.length} Fuhre${fuhren.length===1?'':'n'}${klaerenN?` · <span style="color:var(--color-warning);font-weight:700">⚠ ${klaerenN} zu klären</span>`:''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:18px;font-weight:700;color:var(--text)">${restT.toFixed(1)} t</div>
            <div style="font-size:10px;color:var(--text3)">noch offen</div>
            <div style="font-size:10px;color:var(--text3);margin-top:1px">${geliefT.toFixed(1)} / ${(k.menge_t||0).toFixed(1)} t</div>
          </div>
        </div>
        <div style="background:var(--bg3);border-radius:2px;height:5px;overflow:hidden;margin-bottom:8px">
          <div style="width:${pct.toFixed(1)}%;height:100%;background:${barColor};border-radius:2px;transition:width .3s"></div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm btn-outline" onclick="kontraktBearbeiten(${k.id})">✏ Bearbeiten</button>
        ${k.status==='aktiv'?`<button class="btn btn-sm" style="background:none;border:1px solid var(--border2);color:var(--gold)" onclick="kontraktStatus(${k.id},'erfuellt')">✓ Als erfüllt markieren</button>`:''}
        ${k.status==='aktiv'?`<button class="btn btn-sm" style="background:none;border:1px solid var(--border2);color:var(--red)" onclick="kontraktStatus(${k.id},'storniert')">✕ Stornieren</button>`:''}
        ${fuhren.length===0?`<button class="btn btn-sm" style="background:none;border:1px solid var(--border2);color:var(--red)" onclick="kontraktLoeschen(${k.id})" title="Nur möglich, solange keine Fuhren hinterlegt sind">🗑 Löschen</button>`:''}
      </div>
      ${offen ? kontraktDetailHTML(k) : ''}
    </div>`;
  };

  const richtBtn = (r, label) => `<button type="button" onclick="setKontraktRichtung('${r}')" style="flex:1;padding:10px;border-radius:var(--radius-md);border:2px solid ${_kRichtung===r?'var(--gold)':'var(--color-border)'};background:${_kRichtung===r?'var(--gold)':'var(--color-surface)'};color:${_kRichtung===r?'#1a1400':'var(--color-text)'};font-family:inherit;font-weight:700;font-size:13px;cursor:pointer">${label}</button>`;
  let html = `
    <div style="display:flex;gap:8px;margin-bottom:14px">
      ${richtBtn('verkauf','🡒 Verkaufskontrakte')}${richtBtn('einkauf','🡐 Einkaufskontrakte')}
    </div>
    ${einkauf ? '' : `<div id="kontrakt-dropzone"
      style="border:2px dashed var(--border2);border-radius:var(--radius);padding:28px;text-align:center;margin-bottom:16px;cursor:pointer;transition:border-color .2s;background:var(--bg2)"
      ondragover="event.preventDefault();this.style.borderColor='var(--gold)'"
      ondragleave="this.style.borderColor='var(--border2)'"
      ondrop="kontraktPDFDrop(event)">
      <div style="font-size:32px;margin-bottom:8px">📄</div>
      <div style="font-family:var(--serif);font-size:15px;font-weight:600;color:var(--text);margin-bottom:4px">Kontrakt-PDF hier ablegen</div>
      <div style="font-size:11px;color:var(--text3)">Kernfelder werden automatisch erkannt · danach zur Prüfung anzeigen</div>
      <input type="file" id="kontrakt-file-input" accept=".pdf" style="display:none" onchange="kontraktPDFDatei(this)">
      <button class="btn btn-sm btn-outline" style="margin-top:12px" onclick="document.getElementById('kontrakt-file-input').click()">Datei wählen</button>
    </div>`}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      <div class="stat-box"><div class="stat-val" style="font-size:22px">${aktiv.length}</div><div class="stat-label">aktive Kontrakte</div></div>
      <div class="stat-box"><div class="stat-val" style="font-size:20px">${gesamtT.toFixed(0)}</div><div class="stat-label">t kontraktiert</div></div>
      <div class="stat-box"><div class="stat-val" style="font-size:20px">${geliefT.toFixed(1)}</div><div class="stat-label">t geliefert</div></div>
    </div>
    ${fruchtartUebersichtHTML()}
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px">
      <button class="btn btn-sm btn-outline" onclick="exportKontrakteExcel()">⬇ Excel</button>
      <button class="btn btn-primary" onclick="kontraktNeuDialog(null)">+ Manuell anlegen</button>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:14px">
      <span style="font-size:12px;font-weight:700;color:var(--text2);letter-spacing:1px;text-transform:uppercase">🔎 Filter</span>
      <input type="text" id="kontrakt-suche" value="${escapeHtml(_kSuche)}" placeholder="Suche: Nummer, Kunde, Artikel…" oninput="kontraktSucheInput(this.value)"
        style="flex:1;min-width:160px;padding:6px 10px;font-size:13px;border:1px solid var(--color-border);border-radius:var(--radius-xs);background:var(--bg2);color:var(--text)">
      <label style="font-size:11px;color:var(--text2);display:inline-flex;align-items:center;gap:4px">Fruchtart
        <select class="input" style="width:auto;padding:5px 8px;font-size:13px" onchange="setKontraktFilter('fruchtart', this.value)">
          <option value="">Alle</option>${fruchtartOpts}
        </select>
      </label>
      <label style="font-size:11px;color:var(--text2);display:inline-flex;align-items:center;gap:4px">Kunde
        <select class="input" style="width:auto;padding:5px 8px;font-size:13px" onchange="setKontraktFilter('kunde', this.value)">
          <option value="">Alle</option>${kundeOpts}
        </select>
      </label>
      ${filterAktiv ? `<button class="btn btn-sm btn-outline" onclick="kontraktFilterReset()">✕ Zurücksetzen</button>` : ''}
    </div>`;

  if(fAktiv.length) {
    html += `<div class="section-label" style="margin-bottom:8px">Aktive Kontrakte (${fAktiv.length}${filterAktiv?' / '+aktiv.length:''})</div>`;
    html += fAktiv.map(kRow).join('');
  }
  if(fErfuellt.length) {
    html += `<div class="section-label" style="margin-top:12px;margin-bottom:8px">Erfüllt (${fErfuellt.length}${filterAktiv?' / '+erfuellt.length:''})</div>`;
    html += fErfuellt.map(kRow).join('');
  }
  if(fStornier.length) {
    html += `<div class="section-label" style="margin-top:12px;margin-bottom:8px">Storniert (${fStornier.length}${filterAktiv?' / '+stornier.length:''})</div>`;
    html += fStornier.map(kRow).join('');
  }
  if(!state.kontrakte.length) html += '<div class="empty-state">Noch keine Kontrakte. PDF ablegen oder manuell anlegen.</div>';
  else if(filterAktiv && !fAktiv.length && !fErfuellt.length && !fStornier.length)
    html += '<div class="empty-state">Kein Kontrakt passt zu Filter/Suche.</div>';
  document.getElementById('admintab').innerHTML = html;
}

// ─── PDF-Parsing ───
async function extractPDFText(file) {
  if(typeof pdfjsLib === 'undefined') {
    throw new Error('PDF.js nicht geladen');
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: buf}).promise;
  let text = '';
  for(let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(s=>s.str).join(' ') + '\n';
  }
  return text;
}

function parseKontraktPDF(text) {
  const t = text.replace(/\s+/g, ' ');

  const numMatch =
    t.match(/(?:Kontrakt[-\s]?(?:Nr|Nummer)[.:)#\s]+)([\w][\w\-\/]+)/i) ||
    t.match(/(?:Kont\.[-\s]?Nr[.:\s]+)([\w][\w\-\/]+)/i) ||
    t.match(/(?:Vertragsnummer[.:\s]+)([\w][\w\-\/]+)/i) ||
    t.match(/(?:Contract[-\s]?No[.:\s]+)([\w][\w\-\/]+)/i);

  const fruchtarten = ['Winterweizen','Sommerweizen','Wintergerste','Sommergerste','Winterraps','Triticale','Roggen','Hafer','Mais','Soja','Ackerbohnen','Erbsen','Weizen','Gerste','Raps'];
  let fruchtartText = null;
  for(const fa of fruchtarten) {
    if(t.includes(fa)) { fruchtartText = fa; break; }
  }
  const artikelMatch = fruchtartText ? state.artikel.find(a=>a.name===fruchtartText||a.name.toLowerCase()===fruchtartText.toLowerCase()) : null;

  const mengeMatch =
    t.match(/(\d[\d.,]+)\s*(?:Tonnen?|MT|t\b)/i) ||
    t.match(/Menge[.:)#\s]+(\d[\d.,]+)/i);
  const mengeRaw = mengeMatch ? mengeMatch[1].replace(/\./g,'').replace(',','.') : null;
  const mengeT = mengeRaw ? parseFloat(mengeRaw) : null;

  const preisMatch =
    t.match(/(\d[\d.,]+)\s*(?:EUR|€)\s*\/?\s*(?:t|Tonne)/i) ||
    t.match(/(?:EUR|€)\s*(\d[\d.,]+)\s*\/\s*(?:t|Tonne)/i) ||
    t.match(/Preis[.:)#\s]+(\d[\d.,]+)/i);
  const preisRaw = preisMatch ? preisMatch[1].replace('.','').replace(',','.') : null;
  const preisEur = preisRaw ? parseFloat(preisRaw) : null;

  const datumPat = /(\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4})/g;
  const allDaten = [...t.matchAll(datumPat)].map(m=>m[1]);
  const lieferungVon = allDaten[0] ? normDate(allDaten[0]) : null;
  const lieferungBis = allDaten[1] ? normDate(allDaten[1]) : null;

  const parMatch =
    t.match(/\b(frei\s+Werk|frei\s+Verladestation|ab\s+Hof|ab\s+Lager|FOB|CIF|DAP|DDP|CPT)\b/i) ||
    t.match(/Parität[.:\s]+([^\n,;.]{4,30})/i) ||
    t.match(/Lieferbedingung[.:\s]+([^\n,;.]{4,30})/i);

  const bio = /\b(?:bio|ökologisch|organic|öko)\b/i.test(t);

  return {
    nummer: numMatch?.[1]?.trim() || '',
    fruchtartText,
    artikelId: artikelMatch?.id || null,
    mengeT,
    preisEur,
    lieferungVon,
    lieferungBis,
    paritaet: parMatch?.[1]?.trim() || '',
    bio
  };
}

function normDate(s) {
  const parts = s.split(/[.\/]/);
  if(parts.length !== 3) return null;
  let [d, mo, y] = parts;
  if(y.length === 2) y = '20'+y;
  return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

export async function kontraktPDFDrop(event) {
  event.preventDefault();
  document.getElementById('kontrakt-dropzone').style.borderColor = 'var(--border2)';
  const file = event.dataTransfer.files[0];
  if(!file || !file.name.endsWith('.pdf')) { showToast('⚠ Bitte eine PDF-Datei ablegen','error'); return; }
  await kontraktPDFVerarbeiten(file);
}

export async function kontraktPDFDatei(input) {
  const file = input.files[0];
  if(!file) return;
  await kontraktPDFVerarbeiten(file);
}

async function kontraktPDFVerarbeiten(file) {
  showToast('⏳ PDF wird gelesen…');
  try {
    const text = await extractPDFText(file);
    const erkannt = parseKontraktPDF(text);
    kontraktNeuDialog(null, erkannt, file.name, text);
  } catch(e) {
    showToast('⚠ PDF-Fehler: '+e.message,'error');
    kontraktNeuDialog(null, {}, file.name, '');
  }
}

export function kontraktNeuDialog(id, prefill={}, pdfName='', pdfText='') {
  const k = id ? state.kontrakte.find(x=>x.id===id) : null;
  const v = k || prefill;
  // PDF-Daten merken (statt sie durch das onclick-Attribut zu schleusen).
  _pdfImport = { name: pdfName || '', text: pdfText || '' };
  const kontaktOpts = state.kontakte.map(c =>
    `<option value="${c.id}"${(v.kontakt_id||v.kontaktId)===c.id?' selected':''}>${escapeHtml(c.name)}</option>`
  ).join('');
  const artOpts = state.artikel.filter(a=>a.aktiv).map(a =>
    `<option value="${a.id}"${(v.artikel_id||v.artikelId)===a.id?' selected':''}>${escapeHtml(a.name)}</option>`
  ).join('');

  const m = document.createElement('div');
  m.id = 'kontrakt-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  m.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);padding:24px;width:100%;max-width:500px;box-shadow:var(--shadow);margin:auto">
      <div style="font-family:var(--serif);font-size:18px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text);margin-bottom:4px">${k?'Kontrakt bearbeiten':'Neuer Kontrakt'}</div>
      ${pdfName?`<div style="font-size:10px;color:var(--text3);margin-bottom:16px">📄 ${escapeHtml(pdfName)}</div>`:'<div style="margin-bottom:16px"></div>'}
      <div class="form-group"><label>Kontraktnummer *</label><input type="text" id="kk-nummer" value="${escapeHtml(v.nummer||k?.nummer||'')}" placeholder="z.B. KT-2026-001"></div>
      <div class="form-group"><label>Kontakt (Käufer/Lieferant)</label>
        <select id="kk-kontakt"><option value="">– kein Kontakt –</option>${kontaktOpts}</select></div>
      <div class="form-group"><label>Artikel</label>
        <select id="kk-artikel"><option value="">– wählen –</option>${artOpts}</select></div>
      <div class="form-group"><label>Fruchtart (Freitext)</label><input type="text" id="kk-fruchtart" value="${escapeHtml(v.fruchtartText||k?.fruchtart_text||'')}" placeholder="z.B. Winterweizen A"></div>
      <div class="form-group"><label>Menge (t) *</label><input type="number" id="kk-menge" value="${v.mengeT||k?.menge_t||''}" step="0.1" min="0"></div>
      <div class="form-group"><label>Preis (€/t)</label><input type="number" id="kk-preis" value="${v.preisEur||k?.preis_eur||''}" step="0.01" min="0"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-group"><label>Lieferung von</label><input type="date" id="kk-von" value="${v.lieferungVon||k?.lieferung_von||''}"></div>
        <div class="form-group"><label>Lieferung bis</label><input type="date" id="kk-bis" value="${v.lieferungBis||k?.lieferung_bis||''}"></div>
      </div>
      <div class="form-group"><label>Parität</label><input type="text" id="kk-paritaet" value="${escapeHtml(v.paritaet||k?.paritaet||'')}" placeholder="z.B. frei Werk"></div>
      <div class="form-group">
        <label>Zertifikate / Siegel <span style="font-size:10px;color:var(--text3);font-weight:400">– bestimmt die Nummern auf dem Lieferschein</span></label>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer"><input type="checkbox" id="kk-nachhaltig" style="width:17px;height:17px;accent-color:var(--gold)" ${(v.zertNachhaltig||k?.zert_nachhaltig)?'checked':''}> ♻ Nachhaltig (REDcert)</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer"><input type="checkbox" id="kk-gmp" style="width:17px;height:17px;accent-color:var(--gold)" ${(v.zertGmp||k?.zert_gmp)?'checked':''}> ✓ GMP+ gesichert</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer"><input type="checkbox" id="kk-bio" style="width:17px;height:17px;accent-color:var(--gold)" ${(v.bio||k?.bio)?'checked':''}> 🌿 EU-Öko-Ware</label>
        </div>
      </div>
      <div class="form-group"><label>Notiz</label><input type="text" id="kk-notiz" value="${escapeHtml(v.notiz||k?.notiz||'')}"></div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary" style="flex:1" onclick="kontraktSpeichern(${k?k.id:'null'})">${k?'Speichern':'Anlegen'}</button>
        <button class="btn btn-outline" onclick="document.getElementById('kontrakt-modal').remove()">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(m);
}

export function kontraktBearbeiten(id) { kontraktNeuDialog(id); }

export async function kontraktSpeichern(id) {
  const nummer    = document.getElementById('kk-nummer')?.value.trim();
  const mengeT    = parseFloat(document.getElementById('kk-menge')?.value);
  if(!nummer || isNaN(mengeT) || mengeT <= 0) { showToast('⚠ Nummer und Menge erforderlich','error'); return; }
  const data = {
    nummer,
    kontaktId: parseInt(document.getElementById('kk-kontakt')?.value)||null,
    artikelId: parseInt(document.getElementById('kk-artikel')?.value)||null,
    fruchtartText: document.getElementById('kk-fruchtart')?.value.trim()||null,
    mengeT,
    preisEur: parseFloat(document.getElementById('kk-preis')?.value)||null,
    lieferungVon: document.getElementById('kk-von')?.value||null,
    lieferungBis: document.getElementById('kk-bis')?.value||null,
    paritaet: document.getElementById('kk-paritaet')?.value.trim()||null,
    bio: document.getElementById('kk-bio')?.checked||false,
    zertNachhaltig: document.getElementById('kk-nachhaltig')?.checked||false,
    zertGmp: document.getElementById('kk-gmp')?.checked||false,
    notiz: document.getElementById('kk-notiz')?.value.trim()||null,
    pdfName: _pdfImport.name || null,
    pdfText: (_pdfImport.text || '').slice(0, 5000) || null,
    richtung: _kRichtung,
  };
  try {
    if(id) {
      const k = state.kontrakte.find(x=>x.id===id);
      await db.updateKontrakt({...k, ...data, artikel_id:data.artikelId, kontakt_id:data.kontaktId,
        fruchtart_text:data.fruchtartText, menge_t:data.mengeT, preis_eur:data.preisEur,
        lieferung_von:data.lieferungVon, lieferung_bis:data.lieferungBis,
        zert_nachhaltig:data.zertNachhaltig, zert_gmp:data.zertGmp});
      Object.assign(k, {nummer:data.nummer, kontakt_id:data.kontaktId, artikel_id:data.artikelId,
        fruchtart_text:data.fruchtartText, menge_t:data.mengeT, preis_eur:data.preisEur,
        lieferung_von:data.lieferungVon, lieferung_bis:data.lieferungBis,
        paritaet:data.paritaet, bio:data.bio, notiz:data.notiz,
        zert_nachhaltig:data.zertNachhaltig, zert_gmp:data.zertGmp});
    } else {
      const saved = await db.insertKontrakt(data);
      state.kontrakte.unshift(saved);
    }
    document.getElementById('kontrakt-modal')?.remove();
    showToast('✓ Kontrakt gespeichert');
    renderKontrakte();
  } catch(e) { showToast('⚠ '+e.message,'error'); }
}

// Kontrakt löschen – nur wenn keine Auslieferungen (Fuhren/Lieferungen) hängen.
export async function kontraktLoeschen(id) {
  const k = state.kontrakte.find(x=>x.id===id);
  if(!k) return;
  const hatFuhren = kontraktFuhren(id).length > 0 || state.lieferungen.some(l=>l.kontrakt_id===id);
  if(hatFuhren) { showToast('⚠ Kontrakt hat Auslieferungen – Löschen nicht möglich','error'); return; }
  if(!confirm(`Kontrakt ${k.nummer} wirklich löschen?`)) return;
  try {
    await db.deleteKontrakt(id);
    state.kontrakte = state.kontrakte.filter(x=>x.id!==id);
    showToast('🗑 Kontrakt gelöscht');
    renderKontrakte();
  } catch(e) { showToast('⚠ '+e.message,'error'); }
}

export async function kontraktStatus(id, newStatus) {
  const k = state.kontrakte.find(x=>x.id===id);
  if(!k) return;
  try {
    await db.updateKontrakt({...k, status:newStatus});
    k.status = newStatus;
    renderKontrakte();
  } catch(e) { showToast('⚠ '+e.message,'error'); }
}
