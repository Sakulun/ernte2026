import { state } from './state.js?v=52';
import { escapeHtml, showToast } from './helpers.js?v=52';
import { renderLieferschein } from './lieferschein.js?v=52';

// Lieferschein zu einer Warenbewegung (Warenausgang) erzeugen und drucken.
// Die Vorlage (js/lieferschein.js) bleibt unverändert – hier wird nur das
// Datenobjekt aus der Warenbewegung zusammengesetzt.

const HERKUNFT_STANDARD = 'DE';

const deZahl = (n, nk = 0) => (n == null || isNaN(n)) ? ''
  : Number(n).toLocaleString('de-DE', { minimumFractionDigits: nk, maximumFractionDigits: nk });

// Immer zweistellig (19.07.2026), nicht 19.7.2026 – so steht es auf der Vorlage.
const DATUM_OPT = { day:'2-digit', month:'2-digit', year:'numeric' };
const datumText = iso => {
  const d = iso ? new Date(iso) : new Date();
  return isNaN(d) ? '' : d.toLocaleDateString('de-DE', DATUM_OPT);
};

function dtText(iso) {
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d)) return '';
  return d.toLocaleDateString('de-DE', DATUM_OPT) + ' ' + d.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'});
}

// Der Kontakt führt die Anschrift als einen Textblock. Für den Lieferschein
// wird zeilenweise aufgeteilt: letzte Zeile = Land, davor PLZ/Ort, davor Straße.
function anschriftAufteilen(adresse) {
  const z = String(adresse || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if(!z.length) return { strasse:'', plzOrt:'', land:'' };
  if(z.length === 1) return { strasse:z[0], plzOrt:'', land:'' };
  if(z.length === 2) return { strasse:z[0], plzOrt:z[1], land:'' };
  return { strasse: z.slice(0, -2).join(', '), plzOrt: z[z.length-2], land: z[z.length-1] };
}

function kontaktZuBewegung(w) {
  const k = state.kontrakte.find(x => x.id === w.kontrakt_id);
  if(k) {
    const kt = state.kontakte.find(c => c.id === k.kontakt_id);
    if(kt) return kt;
  }
  return state.kontakte.find(c => c.name === w.empfaenger) || null;
}

export function lieferscheinDaten(w, override = {}) {
  const kontrakt = state.kontrakte.find(x => x.id === w.kontrakt_id);
  const kontakt  = kontaktZuBewegung(w);
  const artikel  = state.artikel.find(a => a.id === w.artikel_id);
  const adr = anschriftAufteilen(kontakt?.adresse);
  const netto = Number(w.menge_kg) || 0;
  const voll  = w.vollgewicht != null ? Number(w.vollgewicht) : null;
  const leer  = w.leergewicht != null ? Number(w.leergewicht) : null;

  return {
    ls_nummer: w.lieferschein_nr || '',
    datum: datumText(w.erstellt_am),
    empf_name:    kontakt?.name || w.empfaenger || '',
    empf_zusatz:  '',
    empf_strasse: adr.strasse,
    empf_plz_ort: adr.plzOrt,
    empf_land:    adr.land,
    artikel:  artikel?.name || kontrakt?.fruchtart_text || '',
    kontrakt: kontrakt?.nummer || '',
    herkunft: HERKUNFT_STANDARD,
    einheit:  't',
    menge:    deZahl(netto/1000, 3),
    brutto_kg: voll != null ? deZahl(voll) : '',
    tara_kg:   leer != null ? deZahl(leer) : '',
    netto_kg:  deZahl(netto),
    // Nur die Buchung ist zeitlich bekannt – sie gilt als Zweitwiegung.
    zeit_erstwiegung: '',
    zeit_zweitwiegung: dtText(w.erstellt_am),
    waage_nr: '',
    spedition:   w.spedition || '',
    kennzeichen: w.kennzeichen || '',
    sonstige_angaben: w.sonstige_angaben || '',
    // Bio-Kennzeichnung des Kontrakts als Hinweis übernehmen
    istRaps: undefined,
    ...override,
  };
}

// Druck über ein verstecktes iframe – kein Popup-Blocker, kein Tab-Wechsel.
export function lieferscheinDrucken(daten) {
  const alt = document.getElementById('ls-print-frame');
  if(alt) alt.remove();
  const frame = document.createElement('iframe');
  frame.id = 'ls-print-frame';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  frame.srcdoc = renderLieferschein(daten);
  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch(e) {
      showToast('⚠ Druck nicht möglich: ' + e.message, 'error');
    }
  };
}

// ── Dialog vor dem Druck ─────────────────────────────────────────────────────
// Die Anschrift fehlt bei vielen Kontakten; sie wird hier ergänzt/korrigiert,
// ohne den Stammdatensatz zu verändern.
export function lieferscheinDialog(bewegungId) {
  const w = state.warenbewegungen.find(x => x.id === bewegungId);
  if(!w) { showToast('⚠ Warenbewegung nicht gefunden', 'error'); return; }
  const d = lieferscheinDaten(w);
  window._lsAktuell = { w, d };

  let ov = document.getElementById('ls-dialog-overlay');
  if(!ov) { ov = document.createElement('div'); ov.id = 'ls-dialog-overlay'; document.body.appendChild(ov); }
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:8000;display:flex;align-items:center;justify-content:center;padding:18px';
  const feld = (id, label, val, ph = '') =>
    `<div class="form-group"><label>${escapeHtml(label)}</label>
      <input type="text" id="ls-${id}" value="${escapeHtml(val || '')}" placeholder="${escapeHtml(ph)}"></div>`;

  ov.innerHTML = `<div class="card" style="max-width:520px;width:100%;max-height:90vh;overflow:auto">
    <div class="card-header"><div>
      <div class="card-title">🖨 Lieferschein ${escapeHtml(d.ls_nummer)}</div>
      <div class="card-sub">${escapeHtml(d.artikel || '–')} · ${escapeHtml(d.menge)} t${d.kontrakt ? ' · Kontrakt ' + escapeHtml(d.kontrakt) : ''}</div>
    </div>
    <button onclick="closeLieferscheinDialog()" aria-label="Schließen"
      style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--color-text-muted)">✕</button></div>
    ${d.ls_nummer ? '' : `<div class="alert alert-warn" style="margin-bottom:10px">
      &#9888; Für diese ältere Buchung wurde noch keine Lieferschein-Nr. vergeben – bitte eintragen.</div>`}
    ${feld('nummer', 'Lieferschein-Nr.', d.ls_nummer, 'z.B. 26007')}
    <div class="section-label">Lieferanschrift</div>
    ${feld('name', 'Name', d.empf_name)}
    ${feld('zusatz', 'Zusatz', d.empf_zusatz, 'z.B. Werk 2 / z.Hd.')}
    ${feld('strasse', 'Straße', d.empf_strasse)}
    ${feld('plzort', 'PLZ / Ort', d.empf_plz_ort)}
    ${feld('land', 'Land', d.empf_land, 'z.B. Deutschland')}
    <div class="section-label">Transport</div>
    ${feld('spedition', 'Spedition', d.spedition)}
    ${feld('kennzeichen', 'Kennzeichen', d.kennzeichen)}
    ${feld('waage', 'Waage-Nr. / Eichnr.', d.waage_nr)}
    <div class="section-label">Sonstige Angaben</div>
    <div class="form-group">
      <textarea id="ls-sonstiges" rows="3" style="width:100%">${escapeHtml(d.sonstige_angaben)}</textarea>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-outline btn-full" onclick="closeLieferscheinDialog()">Abbrechen</button>
      <button class="btn btn-primary btn-full" onclick="lieferscheinDialogDrucken()">🖨 Drucken</button>
    </div>
  </div>`;
}

export function closeLieferscheinDialog() {
  document.getElementById('ls-dialog-overlay')?.remove();
}

export function lieferscheinDialogDrucken() {
  const akt = window._lsAktuell;
  if(!akt) return;
  const val = id => document.getElementById('ls-'+id)?.value.trim() || '';
  lieferscheinDrucken({
    ...akt.d,
    ls_nummer:    val('nummer'),
    empf_name:    val('name'),
    empf_zusatz:  val('zusatz'),
    empf_strasse: val('strasse'),
    empf_plz_ort: val('plzort'),
    empf_land:    val('land'),
    spedition:    val('spedition'),
    kennzeichen:  val('kennzeichen'),
    waage_nr:     val('waage'),
    sonstige_angaben: document.getElementById('ls-sonstiges')?.value || '',
  });
  closeLieferscheinDialog();
}
