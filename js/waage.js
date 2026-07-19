import { state } from './state.js?v=52';
import { db } from './db.js?v=52';
import { showToast, escapeHtml, kg2t } from './helpers.js?v=52';
import { getSiloBestand, getSiloKultur, lagerGruppen } from './silo.js?v=52';
import { parseGewicht } from './abfahrer.js?v=52';
import { renderWaageErfassungInto } from './waage-erfassung.js?v=52';

// ── Waage-Tab (Admin/Silomeister) ────────────────────────────────────────────
// Erste Auswahl: Wareneingang oder Warenausgang.
//  • Wareneingang → bisherige Fuhren-Erfassung (Schlag/Sorte/Abfahrer + Gewichte)
//  • Warenausgang → Kunde → Kontrakt → Lager → Voll-/Leergewicht → Ausgang buchen

const WID = 'wa-aus';
let _modus = null;      // null = noch nichts gewählt, 'eingang' | 'ausgang'
let _container = null;

export function setWaageModus(m) {
  _modus = m;
  if(_container) renderWaageTab(_container);
}

function umschalter() {
  const btn = (m, icon, label, farbe) => {
    const aktiv = _modus === m;
    return `<button onclick="setWaageModus('${m}')" style="
      flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;
      padding:16px 10px;cursor:pointer;border-radius:var(--radius-md);
      border:2px solid ${aktiv ? farbe : 'var(--color-border)'};
      background:${aktiv ? farbe : 'var(--color-surface)'};
      color:${aktiv ? '#fff' : 'var(--color-text)'};font-family:inherit">
      <span style="font-size:22px;line-height:1">${icon}</span>
      <span style="font-size:13px;font-weight:700;letter-spacing:.5px">${label}</span>
    </button>`;
  };
  return `<div style="display:flex;gap:10px;margin-bottom:16px">
    ${btn('eingang', '↓', 'Wareneingang', 'var(--green)')}
    ${btn('ausgang', '↑', 'Warenausgang', 'var(--amber)')}
  </div>`;
}

export function renderWaageTab(el) {
  if(!el) return;
  _container = el;
  el.innerHTML = `<div style="max-width:560px;margin:0 auto">
    ${umschalter()}
    <div id="waage-body"></div>
  </div>`;
  const body = document.getElementById('waage-body');
  if(_modus === 'eingang') {
    renderWaageErfassungInto(body, { modus: 'abschluss' });
  } else if(_modus === 'ausgang') {
    body.innerHTML = `<div class="card">${ausgangFormHTML()}</div>`;
    waAusgangKundeWahl();
  } else {
    body.innerHTML = `<div class="card" style="text-align:center;padding:30px 18px">
      <div style="font-size:32px;margin-bottom:8px">⚖</div>
      <div style="font-size:15px;font-weight:700;color:var(--color-text);margin-bottom:4px">Waage</div>
      <div style="font-size:13px;color:var(--color-text-muted)">Bitte oben Wareneingang oder Warenausgang wählen.</div>
    </div>`;
  }
}

// ── Warenausgang ─────────────────────────────────────────────────────────────

function lagerOptionen() {
  return lagerGruppen().map(g => {
    const opts = g.lager.map(l => {
      const bestKg = getSiloBestand(l.id);
      if(bestKg <= 0) return '';
      const kultur = getSiloKultur(l.id) || '–';
      return `<option value="${escapeHtml(l.id)}">${escapeHtml(l.label)} · ${escapeHtml(kultur)} · ${(bestKg/1000).toFixed(1)} t</option>`;
    }).filter(Boolean).join('');
    return opts ? `<optgroup label="${escapeHtml(g.ort)}">${opts}</optgroup>` : '';
  }).join('');
}

function ausgangFormHTML() {
  const kunden = state.kontakte.filter(k => k.aktiv)
    .sort((a,b) => a.name.localeCompare(b.name,'de'))
    .map(k => `<option value="${k.id}">${escapeHtml(k.name)}</option>`).join('');
  const artOpts = state.artikel.filter(a => a.aktiv)
    .map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.einheit)})</option>`).join('');
  const lagerOpts = lagerOptionen();
  const waageWidget = window.waageFuhreWidgetHTML ? window.waageFuhreWidgetHTML(WID) : '';

  return `
    <div class="card-header"><div>
      <div class="card-title">↑ Warenausgang an der Waage</div>
      <div class="card-sub">Kunde &amp; Kontrakt wählen, Lager angeben, LKW wiegen</div>
    </div></div>
    <div class="form-group">
      <label>Kunde *</label>
      <select id="wa-kunde" onchange="waAusgangKundeWahl()">
        <option value="">— Kunde wählen —</option>${kunden}
      </select>
    </div>
    <div class="form-group">
      <label>Kontrakt *</label>
      <select id="wa-kontrakt" onchange="waAusgangKontraktWahl()" disabled>
        <option value="">— zuerst Kunde wählen —</option>
      </select>
    </div>
    <div id="wa-kontrakt-info" style="display:none;font-size:11px;color:var(--gold);margin:-8px 0 12px;line-height:1.6"></div>
    <div class="form-group">
      <label>Lager *</label>
      <select id="wa-lager" onchange="waAusgangLagerWahl()">
        <option value="">— Lager wählen —</option>${lagerOpts}
      </select>
    </div>
    <div id="wa-lager-info" style="display:none;font-size:11px;color:var(--gold);margin:-8px 0 12px"></div>
    <div class="form-group">
      <label>Artikel *</label>
      <select id="wa-artikel"><option value="">— wählen —</option>${artOpts}</select>
    </div>
    <div class="section-label">Gewichte</div>
    ${waageWidget}
    <div class="gewicht-grid">
      <div class="form-group">
        <label>Vollgewicht (kg)</label>
        <input type="text" inputmode="numeric" id="voll-${WID}" placeholder="28.400"
          style="font-size:20px;font-weight:700;letter-spacing:0.5px" oninput="fmtGewicht(this);updNetto('${WID}')">
      </div>
      <div class="form-group">
        <label>Leergewicht (kg)</label>
        <div style="display:flex;gap:6px">
          <input type="text" inputmode="numeric" id="leer-${WID}" placeholder="12.600"
            style="font-size:20px;font-weight:700;letter-spacing:0.5px;flex:1;min-width:0" oninput="fmtGewicht(this);updNetto('${WID}')">
          <button type="button" onclick="openHaengerzugWahl('${WID}')" title="Hängerzug wählen – Leergewicht übernehmen"
            style="flex-shrink:0;width:52px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:22px;cursor:pointer">🚛</button>
        </div>
      </div>
    </div>
    <div class="netto-display"><div class="netto-label">Netto</div><div class="netto-val" id="netto-${WID}" style="font-size:28px">—</div><div class="netto-unit">kg</div></div>
    <div class="section-label">Transport <span style="font-size:10px;color:var(--text2);font-weight:400">– für den Lieferschein</span></div>
    <div class="gewicht-grid">
      <div class="form-group">
        <label>Spedition</label>
        <input type="text" id="wa-spedition" placeholder="z.B. Spedition Müller GmbH">
      </div>
      <div class="form-group">
        <label>Kennzeichen</label>
        <input type="text" id="wa-kennzeichen" placeholder="z.B. SK-NU 412">
      </div>
    </div>
    <div class="form-group">
      <label>Beleg-Nr.</label>
      <input type="text" id="wa-beleg" placeholder="z.B. LS-2026-001">
    </div>
    <button class="btn btn-amber btn-full" id="wa-btn" onclick="waAusgangBuchen()">&#10003; Warenausgang buchen</button>`;
}

export function waAusgangKundeWahl() {
  const kundeId = parseInt(document.getElementById('wa-kunde')?.value);
  const kSel = document.getElementById('wa-kontrakt');
  const info = document.getElementById('wa-kontrakt-info');
  if(!kSel) return;
  if(info) info.style.display = 'none';
  if(!kundeId) {
    kSel.disabled = true;
    kSel.innerHTML = '<option value="">— zuerst Kunde wählen —</option>';
    return;
  }
  const kontrakte = state.kontrakte.filter(k => k.kontakt_id === kundeId && k.status === 'aktiv');
  kSel.disabled = !kontrakte.length;
  if(!kontrakte.length) {
    kSel.innerHTML = '<option value="">— kein aktiver Kontrakt für diesen Kunden —</option>';
    return;
  }
  kSel.innerHTML = '<option value="">— Kontrakt wählen —</option>' + kontrakte.map(k => {
    const art = state.artikel.find(a => a.id === k.artikel_id);
    const bez = art ? art.name : (k.fruchtart_text || '');
    return `<option value="${k.id}">${escapeHtml(k.nummer)}${bez ? ' · ' + escapeHtml(bez) : ''}${k.menge_t ? ' · ' + k.menge_t + ' t' : ''}</option>`;
  }).join('');
  // Bei nur einem Kontrakt direkt vorwählen – spart an der Waage einen Klick
  if(kontrakte.length === 1) { kSel.value = String(kontrakte[0].id); waAusgangKontraktWahl(); }
}

export function waAusgangKontraktWahl() {
  const kId = parseInt(document.getElementById('wa-kontrakt')?.value);
  const info = document.getElementById('wa-kontrakt-info');
  if(!info) return;
  const k = state.kontrakte.find(x => x.id === kId);
  if(!k) { info.style.display = 'none'; return; }
  // Artikel aus dem Kontrakt übernehmen (bleibt änderbar, falls nicht hinterlegt)
  if(k.artikel_id) { const el = document.getElementById('wa-artikel'); if(el) el.value = String(k.artikel_id); }
  const geliefKg = window.getKontraktGeliefertKg ? window.getKontraktGeliefertKg(k.id) : 0;
  const restT = Math.max(0, (parseFloat(k.menge_t)||0) - geliefKg/1000);
  info.style.display = 'block';
  info.innerHTML = `Kontrakt ${escapeHtml(k.nummer)}${k.bio ? ' · <span style="color:var(--color-success);font-weight:700">🌿 BIO</span>' : ''}<br>
    Menge ${(parseFloat(k.menge_t)||0).toFixed(1)} t · geliefert ${(geliefKg/1000).toFixed(1)} t · <b>Rest ${restT.toFixed(1)} t</b>`;
}

export function waAusgangLagerWahl() {
  const id = document.getElementById('wa-lager')?.value;
  const info = document.getElementById('wa-lager-info');
  if(!info) return;
  if(!id) { info.style.display = 'none'; return; }
  const bestKg = getSiloBestand(id);
  const kultur = getSiloKultur(id) || '–';
  info.style.display = 'block';
  info.textContent = `Bestand: ${(bestKg/1000).toFixed(2)} t · ${kultur}`;
  // Artikel aus der Lagerkultur vorschlagen, wenn noch keiner gesetzt ist
  const artSel = document.getElementById('wa-artikel');
  if(artSel && !artSel.value && kultur !== '–') {
    const m = state.artikel.find(a => a.aktiv && a.name.toLowerCase().includes(kultur.split(' ')[0].toLowerCase()));
    if(m) artSel.value = String(m.id);
  }
}

export function waAusgangBuchen() {
  const kundeId  = parseInt(document.getElementById('wa-kunde')?.value);
  const kId      = parseInt(document.getElementById('wa-kontrakt')?.value);
  const lagerId  = document.getElementById('wa-lager')?.value;
  const artikelId= parseInt(document.getElementById('wa-artikel')?.value);
  const v = parseGewicht(document.getElementById('voll-'+WID)?.value);
  const l = parseGewicht(document.getElementById('leer-'+WID)?.value);

  if(!kundeId)  { alert('Bitte Kunde wählen.'); return; }
  if(!kId)      { alert('Bitte Kontrakt wählen.'); return; }
  if(!lagerId)  { alert('Bitte Lager wählen.'); return; }
  if(!artikelId){ alert('Bitte Artikel wählen.'); return; }
  if(!v || !l || v <= l) { alert('Bitte gültige Gewichte eingeben (Vollgew. > Leergew.).'); return; }

  const netto = v - l;
  const kunde = state.kontakte.find(c => c.id === kundeId);
  const k = state.kontrakte.find(x => x.id === kId);
  const bestKg = getSiloBestand(lagerId);
  zeigeAusgangBestaetigung({ kunde, k, lagerId, artikelId, v, l, netto, bestKg,
    belegNr:     document.getElementById('wa-beleg')?.value.trim() || '',
    spedition:   document.getElementById('wa-spedition')?.value.trim() || '',
    kennzeichen: document.getElementById('wa-kennzeichen')?.value.trim() || '' });
}

function zeigeAusgangBestaetigung(d) {
  let ov = document.getElementById('wa-confirm-overlay');
  if(!ov) { ov = document.createElement('div'); ov.id = 'wa-confirm-overlay'; document.body.appendChild(ov); }
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:7000;display:flex;align-items:center;justify-content:center;padding:18px';
  const td = 'padding:6px 4px;border-bottom:1px solid var(--color-border)';
  const tdL = td + ';color:var(--text2);width:42%';
  const row = (k,val) => `<tr><td style="${tdL}">${escapeHtml(k)}</td><td style="${td};font-weight:600">${val}</td></tr>`;
  const art = state.artikel.find(a => a.id === d.artikelId);
  const kultur = getSiloKultur(d.lagerId) || '–';
  // Bestand nur warnen, nicht blockieren – die Buchung kann trotzdem richtig sein
  const warn = d.netto > d.bestKg + 0.01
    ? `<div class="alert alert-warn" style="margin:8px 0">&#9888; Menge übersteigt den Lagerbestand von ${(d.bestKg/1000).toFixed(2)} t.</div>` : '';
  ov.innerHTML = `<div class="card" style="max-width:440px;width:100%;max-height:90vh;overflow:auto">
    <div class="card-header"><div>
      <div class="card-title">Warenausgang prüfen &amp; buchen</div>
      <div class="card-sub">Bitte die Werte kontrollieren</div>
    </div></div>
    ${warn}
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:4px 0 8px">
      ${row('Kunde', escapeHtml(d.kunde?.name || '–'))}
      ${row('Kontrakt', escapeHtml(d.k?.nummer || '–'))}
      ${row('Lager', escapeHtml(window.lagerLabel ? window.lagerLabel(d.lagerId) : d.lagerId) + ' · ' + escapeHtml(kultur))}
      ${row('Artikel', escapeHtml(art?.name || '–'))}
      ${row('Vollgewicht', d.v.toLocaleString('de-DE') + ' kg')}
      ${row('Leergewicht', d.l.toLocaleString('de-DE') + ' kg')}
      ${row('Netto', '<b>' + d.netto.toLocaleString('de-DE') + ' kg</b> · ' + kg2t(d.netto))}
      ${d.belegNr ? row('Beleg-Nr.', escapeHtml(d.belegNr)) : ''}
    </table>
    <div style="display:flex;gap:8px;margin-top:6px">
      <button class="btn btn-outline btn-full" id="wa-conf-edit">&#9998; Bearbeiten</button>
      <button class="btn btn-amber btn-full" id="wa-conf-save">&#10003; Buchen</button>
    </div>
  </div>`;
  document.getElementById('wa-conf-edit').addEventListener('click', closeAusgangBestaetigung);
  document.getElementById('wa-conf-save').addEventListener('click', () => ausgangSpeichern(d));
}

function closeAusgangBestaetigung() { document.getElementById('wa-confirm-overlay')?.remove(); }

async function ausgangSpeichern(d) {
  const btn = document.getElementById('wa-conf-save');
  if(btn) { btn.disabled = true; btn.textContent = 'Bucht…'; }
  const bewegung = {
    typ: 'ausgang', artikelId: d.artikelId, siloVonId: d.lagerId, mengeKg: d.netto,
    vollgewicht: d.v, leergewicht: d.l,
    empfaenger: d.kunde?.name || '', belegNr: d.belegNr, bio: !!d.k?.bio,
    kontraktId: d.k?.id || null, notiz: '', erstelltVon: state.currentUser?.id || null,
    spedition: d.spedition, kennzeichen: d.kennzeichen
  };
  try {
    const saved = await db.insertWarenbewegung(bewegung);
    state.warenbewegungen.unshift(saved);
    closeAusgangBestaetigung();
    showToast(`✓ Warenausgang gebucht · ${kg2t(d.netto)} · ${d.kunde?.name || ''}`);
    if(_container) renderWaageTab(_container);
    if(window.renderSiloManagement) window.renderSiloManagement();
    // Lieferschein direkt anbieten – an der Waage wird er sofort gebraucht
    if(window.lieferscheinDialog) window.lieferscheinDialog(saved.id);
  } catch(e) {
    if(btn) { btn.disabled = false; btn.innerHTML = '&#10003; Buchen'; }
    showToast('⚠ Fehler: ' + e.message, 'error');
  }
}
