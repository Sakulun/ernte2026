import { state } from './state.js?v=113';
import { db } from './db.js?v=113';
import { showToast, escapeHtml, kg2t, kontaktAnschrift } from './helpers.js?v=113';
import { getSiloBestand, getSiloKultur, lagerGruppen, lagerLabel, istAusgangLager } from './silo.js?v=113';
import { parseGewicht } from './abfahrer.js?v=113';
import { renderWaageErfassungInto } from './waage-erfassung.js?v=113';
import { lieferscheinDaten, lieferscheinDrucken } from './lieferschein-druck.js?v=113';

// ── Waage-Tab (Admin/Silomeister) ────────────────────────────────────────────
// Erste Auswahl: Wareneingang oder Warenausgang.
//  • Wareneingang → bisherige Fuhren-Erfassung (Schlag/Sorte/Abfahrer + Gewichte)
//  • Warenausgang → zweistufig, weil zwischen den Wiegungen beladen wird:
//      1. Leerwiegung: Auftrag + Tara erfassen → zwischenspeichern
//      2. Umlauf: Fahrzeug wählen → dieselbe Maske, alle Werte weiter
//         änderbar, zusätzlich das Vollgewicht → bucht und druckt in einem Schritt.

const WID = 'wa';            // Feld-Suffix (voll-wa / leer-wa)
let _modus = null;           // null | 'eingang' | 'ausgang' | 'umlauf'
let _offenesFahrzeug = null; // umlauf.id (Ausgang), dessen Vollwiegung offen ist
let _offeneEingangUmlauf = null; // umlauf-Eintrag (Eingang), der abgeschlossen wird
let _container = null;

export function setWaageModus(m) {
  _modus = m;
  _offenesFahrzeug = null;
  _offeneEingangUmlauf = null;
  if(_container) renderWaageTab(_container);
}

// Zurück zur Umlauf-Liste (aus einer offenen Zweitwiegung).
export function setAusgangView(v) {
  _offenesFahrzeug = null;
  _offeneEingangUmlauf = null;
  _modus = (v === 'umlauf') ? 'umlauf' : 'ausgang';
  if(_container) renderWaageTab(_container);
}
export function waUmlaufListe() {
  _offenesFahrzeug = null;
  _offeneEingangUmlauf = null;
  _modus = 'umlauf';
  if(_container) renderWaageTab(_container);
}

function wartende() {
  return (state.umlauf || []).filter(u => u.status === 'wartet');
}

function umschalter() {
  const n = wartende().length;
  const btn = (m, icon, label, farbe, badge) => {
    const aktiv = _modus === m;
    const b = (badge !== '' && badge != null)
      ? ` <span style="background:${aktiv?'rgba(255,255,255,.3)':'var(--gold)'};color:${aktiv?'#fff':'#1a1400'};border-radius:8px;padding:0 6px;font-size:11px">${badge}</span>` : '';
    return `<button onclick="setWaageModus('${m}')" style="
      flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;
      padding:14px 6px;cursor:pointer;border-radius:var(--radius-md);
      border:2px solid ${aktiv ? farbe : 'var(--color-border)'};
      background:${aktiv ? farbe : 'var(--color-surface)'};
      color:${aktiv ? '#fff' : 'var(--color-text)'};font-family:inherit">
      <span style="font-size:20px;line-height:1">${icon}</span>
      <span style="font-size:12px;font-weight:700;letter-spacing:.3px">${label}${b}</span>
    </button>`;
  };
  return `<div style="display:flex;gap:8px;margin-bottom:16px">
    ${btn('eingang', '↓', 'Wareneingang', 'var(--green)', '')}
    ${btn('ausgang', '↑', 'Warenausgang', 'var(--amber)', '')}
    ${btn('umlauf', '🅿', 'Umlauf', 'var(--blue-500)', n || '')}
  </div>`;
}

// Eigenständige Ansicht für die Benutzer-Rolle "Waage" (Waagen-Terminal).
export function renderWaage() {
  const mc = document.getElementById('main-content');
  if(!mc) return;
  mc.innerHTML = `<div id="waage-standalone" style="padding:14px 12px"></div>`;
  renderWaageTab(document.getElementById('waage-standalone'));
}

export function renderWaageTab(el) {
  if(!el) return;
  _container = el;
  el.innerHTML = `<div style="max-width:560px;margin:0 auto">
    ${window.waageLiveBannerHTML ? window.waageLiveBannerHTML() : ''}
    ${window.waageOcrPanelHTML ? window.waageOcrPanelHTML() : ''}
    ${umschalter()}
    <div id="waage-body"></div>
  </div>`;
  if(window.aktualisierePanel) window.aktualisierePanel();
  const body = document.getElementById('waage-body');
  if(_modus === 'eingang') {
    renderWaageErfassungInto(body, { modus: 'abschluss' });
  } else if(_modus === 'ausgang') {
    renderAusgang(body);
  } else if(_modus === 'umlauf') {
    renderUmlaufShared(body);
  } else {
    body.innerHTML = `<div class="card" style="text-align:center;padding:30px 18px">
      <div style="font-size:32px;margin-bottom:8px">⚖</div>
      <div style="font-size:15px;font-weight:700;color:var(--color-text);margin-bottom:4px">Waage</div>
      <div style="font-size:13px;color:var(--color-text-muted)">Bitte oben Wareneingang, Warenausgang oder Umlauf wählen.</div>
    </div>`;
  }
}

// ── Gemeinsamer Umlaufspeicher (Ein- & Ausgang) ──────────────────────────────
function renderUmlaufShared(body) {
  if(_offeneEingangUmlauf) {
    if(window.renderUmlaufEingangAbschluss) window.renderUmlaufEingangAbschluss(body, _offeneEingangUmlauf);
    else body.innerHTML = '<div class="card">Eingangs-Abschluss nicht verfügbar.</div>';
    return;
  }
  body.innerHTML = umlaufListeHTML();
}

// ── Warenausgang ─────────────────────────────────────────────────────────────
function renderAusgang(body) {
  const offen = _offenesFahrzeug != null ? wartende().find(u => u.id === _offenesFahrzeug && u.richtung !== 'eingang') : null;
  body.innerHTML = `<div class="card">${formHTML(offen)}</div>`;
  vorbelegen(offen);
}

function lagerOptionen() {
  return lagerGruppen().map(g => {
    const opts = g.lager.map(l => {
      const bestKg = getSiloBestand(l.id);
      // Ausgang-only-Lager (Kuchenlager) immer anbieten – Bestand wird dort nicht geführt.
      if(bestKg <= 0 && !l.ausgangOnly) return '';
      const kultur = getSiloKultur(l.id) || '–';
      const mengeTxt = l.ausgangOnly ? 'nur Ausgang' : (bestKg/1000).toFixed(1) + ' t';
      return `<option value="${escapeHtml(l.id)}">${escapeHtml(l.label)} · ${escapeHtml(kultur)} · ${mengeTxt}</option>`;
    }).filter(Boolean).join('');
    return opts ? `<optgroup label="${escapeHtml(g.ort)}">${opts}</optgroup>` : '';
  }).join('');
}

// Eine Maske für beide Schritte. u = Umlauf-Eintrag bei der Vollwiegung, sonst null.
// Bei der Vollwiegung bleiben alle Felder änderbar – korrigiert wird gebucht.
function formHTML(u) {
  const voll = !!u;
  const kunden = state.kontakte.filter(k => k.aktiv)
    .sort((a,b) => a.name.localeCompare(b.name,'de'))
    .map(k => `<option value="${k.id}">${escapeHtml(k.name)}</option>`).join('');
  const artOpts = state.artikel.filter(a => a.aktiv)
    .map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.einheit)})</option>`).join('');
  const widget = f => window.waageFuhreWidgetHTML ? window.waageFuhreWidgetHTML(WID, f) : '';

  const kopf = voll
    ? `<div class="card-title">↑ Vollwiegung · 🚚 ${escapeHtml(u.kennzeichen)}</div>
       <div class="card-sub">Werte prüfen, Vollgewicht wiegen, abschließen</div>`
    : `<div class="card-title">↑ Warenausgang · Leerwiegung</div>
       <div class="card-sub">Auftrag erfassen und leeres Fahrzeug wiegen</div>`;

  return `
    <div class="card-header"><div>${kopf}</div>
      ${voll ? `<button onclick="setAusgangView('umlauf')" title="Zurück zur Liste"
        style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--color-text-muted)">✕</button>` : ''}
    </div>
    <div class="form-group">
      <label>Kunde *</label>
      <select id="wa-kunde" onchange="waAusgangKundeWahl()">
        <option value="">— Kunde wählen —</option>${kunden}
      </select>
    </div>
    <div id="wa-adresse-warn" style="display:none" class="alert alert-warn"></div>
    <div class="form-group">
      <label>Kontrakt *</label>
      <select id="wa-kontrakt" onchange="waAusgangKontraktWahl()" ${voll?'':'disabled'}>
        <option value="">— zuerst Kunde wählen —</option>
      </select>
    </div>
    <div id="wa-kontrakt-info" style="display:none;font-size:11px;color:var(--gold);margin:-8px 0 12px;line-height:1.6"></div>
    <div class="form-group">
      <label>Lager *</label>
      <select id="wa-lager" onchange="waAusgangLagerWahl()">
        <option value="">— Lager wählen —</option>${lagerOptionen()}
      </select>
    </div>
    <div id="wa-lager-info" style="display:none;font-size:11px;color:var(--gold);margin:-8px 0 12px"></div>
    <div class="form-group">
      <label>Artikel *</label>
      <select id="wa-artikel"><option value="">— wählen —</option>${artOpts}</select>
    </div>
    <div class="section-label">Fahrzeug</div>
    <div class="gewicht-grid">
      <div class="form-group">
        <label>Kennzeichen *</label>
        <input type="text" id="wa-kennzeichen" placeholder="z.B. SK-NU 412" style="text-transform:uppercase">
      </div>
      <div class="form-group">
        <label>Spedition</label>
        <input type="text" id="wa-spedition" placeholder="z.B. Spedition Müller GmbH">
      </div>
    </div>
    <div class="section-label">Gewichte</div>
    ${widget(voll ? 'beide' : 'leer')}
    <div class="${voll ? 'gewicht-grid' : ''}">
      ${voll ? `<div class="form-group">
        <label>Vollgewicht (kg) *</label>
        <input type="text" inputmode="numeric" id="voll-${WID}" placeholder="40.000"
          style="font-size:20px;font-weight:700;letter-spacing:0.5px" oninput="fmtGewicht(this);waNetto()">
      </div>` : ''}
      <div class="form-group">
        <label>Leergewicht (kg) *</label>
        <div style="display:flex;gap:6px">
          <input type="text" inputmode="numeric" id="leer-${WID}" placeholder="12.600"
            style="font-size:20px;font-weight:700;letter-spacing:0.5px;flex:1;min-width:0"
            oninput="fmtGewicht(this);waNetto()">
          <button type="button" onclick="openHaengerzugWahl('${WID}')" title="Hängerzug wählen – Leergewicht übernehmen"
            style="flex-shrink:0;width:52px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:22px;cursor:pointer">🚛</button>
        </div>
      </div>
    </div>
    ${voll ? `<div class="netto-display"><div class="netto-label">Netto</div>
      <div class="netto-val" id="netto-${WID}" style="font-size:28px">—</div>
      <div class="netto-unit">kg</div></div>` : ''}
    <div class="section-label">Sonstige Angaben <span style="font-size:10px;color:var(--text2);font-weight:400">– erscheint auf dem Lieferschein</span></div>
    <div class="form-group">
      <textarea id="wa-sonstiges" rows="2" style="width:100%" placeholder="Freitext, z.B. Probe gezogen"></textarea>
    </div>
    ${voll
      ? `<div style="display:flex;gap:8px">
           <button class="btn btn-outline" style="flex-shrink:0" onclick="waUmlaufStornieren(${u.id})" title="Fahrzeug aus dem Umlauf nehmen">✕</button>
           <button class="btn btn-green btn-full" id="wa-btn" onclick="waAbschliessen(${u.id})">&#10003; Abschließen &amp; drucken</button>
         </div>`
      : `<button class="btn btn-amber btn-full" id="wa-btn" onclick="waZwischenspeichern()">&#128190; Zwischenspeichern</button>`}`;
}

// Vorbelegung der Selects erst nach dem Rendern – die Optionen müssen stehen.
function vorbelegen(u) {
  if(!u) { waAusgangKundeWahl(); return; }
  const set = (id, v) => { const el = document.getElementById(id); if(el && v != null) el.value = String(v); };
  set('wa-kunde', u.kontakt_id);
  waAusgangKundeWahl();                       // baut die Kontrakt-Optionen
  set('wa-kontrakt', u.kontrakt_id);
  waAusgangKontraktWahl();                    // setzt u.a. den Artikel aus dem Kontrakt
  set('wa-lager', u.silo_von_id);
  waAusgangLagerWahl();
  set('wa-artikel', u.artikel_id);            // nach Lager/Kontrakt, damit die Wahl gewinnt
  set('wa-kennzeichen', u.kennzeichen);
  set('wa-spedition', u.spedition || '');
  set('leer-'+WID, Number(u.leergewicht).toLocaleString('de-DE'));
  const t = document.getElementById('wa-sonstiges');
  if(t) t.value = u.sonstige_angaben || '';
  waNetto();
}

export function waNetto() {
  const el = document.getElementById('netto-'+WID);
  if(!el) return;
  const voll = parseGewicht(document.getElementById('voll-'+WID)?.value);
  const leer = parseGewicht(document.getElementById('leer-'+WID)?.value);
  if(voll && leer && voll > leer) {
    el.textContent = (voll-leer).toLocaleString('de-DE');
    el.style.color = 'var(--green2)';
  } else {
    el.textContent = '—';
    el.style.color = 'var(--text3)';
  }
}

export function waAusgangKundeWahl() {
  const kundeId = parseInt(document.getElementById('wa-kunde')?.value);
  const kSel = document.getElementById('wa-kontrakt');
  const info = document.getElementById('wa-kontrakt-info');
  const warn = document.getElementById('wa-adresse-warn');
  if(!kSel) return;
  if(info) info.style.display = 'none';
  // Der Lieferschein druckt die Anschrift aus den Stammdaten – fehlt sie, bleibt
  // das Feld auf dem Beleg leer. Deshalb hier früh darauf hinweisen.
  const kunde = state.kontakte.find(c => c.id === kundeId);
  if(warn) {
    const fehlt = kunde && !kontaktAnschrift(kunde).vorhanden;
    warn.style.display = fehlt ? 'block' : 'none';
    if(fehlt) warn.innerHTML = `&#9888; Für <b>${escapeHtml(kunde.name)}</b> ist keine Anschrift hinterlegt –
      sie bleibt auf dem Lieferschein leer. Unter „Kunden/Lieferanten“ ergänzen.`;
  }
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
  const artSel = document.getElementById('wa-artikel');
  if(artSel && !artSel.value && kultur !== '–') {
    const m = state.artikel.find(a => a.aktiv && a.name.toLowerCase().includes(kultur.split(' ')[0].toLowerCase()));
    if(m) artSel.value = String(m.id);
  }
}

// Liest die Maske aus – identisch für beide Schritte.
function formLesen(mitVoll) {
  const d = {
    kundeId:    parseInt(document.getElementById('wa-kunde')?.value),
    kontraktId: parseInt(document.getElementById('wa-kontrakt')?.value),
    lagerId:    document.getElementById('wa-lager')?.value,
    artikelId:  parseInt(document.getElementById('wa-artikel')?.value),
    kennzeichen:document.getElementById('wa-kennzeichen')?.value.trim().toUpperCase(),
    spedition:  document.getElementById('wa-spedition')?.value.trim() || '',
    sonstiges:  document.getElementById('wa-sonstiges')?.value.trim() || '',
    leer:       parseGewicht(document.getElementById('leer-'+WID)?.value),
    voll:       mitVoll ? parseGewicht(document.getElementById('voll-'+WID)?.value) : null,
  };
  if(!d.kundeId)    return { fehler:'Bitte Kunde wählen.' };
  if(!d.kontraktId) return { fehler:'Bitte Kontrakt wählen.' };
  if(!d.lagerId)    return { fehler:'Bitte Lager wählen.' };
  if(!d.artikelId)  return { fehler:'Bitte Artikel wählen.' };
  if(!d.kennzeichen)return { fehler:'Bitte Kennzeichen eingeben.' };
  if(!d.leer || d.leer <= 0) return { fehler:'Bitte gültiges Leergewicht eingeben.' };
  if(mitVoll && (!d.voll || d.voll <= d.leer))
    return { fehler:'Bitte gültiges Vollgewicht eingeben (größer als das Leergewicht).' };
  return d;
}

// ── Schritt 1: zwischenspeichern ─────────────────────────────────────────────
export async function waZwischenspeichern() {
  const d = formLesen(false);
  if(d.fehler) { alert(d.fehler); return; }
  const btn = document.getElementById('wa-btn');
  if(btn) { btn.disabled = true; btn.textContent = 'Wird gespeichert…'; }
  try {
    const saved = await db.insertUmlauf({
      richtung: 'ausgang', erstgewicht: d.leer, erstTyp: 'leer',
      kennzeichen: d.kennzeichen, spedition: d.spedition, leergewicht: d.leer,
      kontaktId: d.kundeId, kontraktId: d.kontraktId, siloVonId: d.lagerId,
      artikelId: d.artikelId, sonstigeAngaben: d.sonstiges,
      erstelltVon: state.currentUser?.id || null
    });
    state.umlauf = state.umlauf || [];
    state.umlauf.push(saved);
    showToast(`💾 ${d.kennzeichen} zwischengespeichert · Tara ${d.leer.toLocaleString('de-DE')} kg`);
    _offenesFahrzeug = null;
    _modus = 'umlauf';
    if(_container) renderWaageTab(_container);
  } catch(e) {
    if(btn) { btn.disabled = false; btn.innerHTML = '&#128190; Zwischenspeichern'; }
    showToast('⚠ Fehler: ' + e.message, 'error');
  }
}

// ── Schritt 2: Liste der wartenden Fahrzeuge ─────────────────────────────────
function umlaufListeHTML() {
  const liste = wartende();
  if(!liste.length) {
    return `<div class="card" style="text-align:center;padding:26px 18px">
      <div style="font-size:28px;margin-bottom:6px">🚚</div>
      <div style="font-size:14px;font-weight:700;color:var(--color-text);margin-bottom:4px">Kein Fahrzeug zwischengespeichert</div>
      <div style="font-size:12px;color:var(--color-text-muted)">Fahrzeuge erscheinen hier, sobald sie leer verwogen wurden.</div>
    </div>`;
  }
  return liste.map(u => {
    const eingang = u.richtung === 'eingang';
    const seit  = new Date(u.erstwiegung);
    const zeit  = isNaN(seit) ? '' : seit.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'});
    const g     = Number(u.erstgewicht ?? u.leergewicht ?? 0);
    const gTyp  = eingang ? (u.erst_typ === 'voll' ? 'Voll' : 'Leer') : 'Tara';
    const border = eingang ? 'var(--green)' : 'var(--amber)';
    let sub2 = '';
    let sub1 = '';
    if(eingang) {
      const p = u.payload || {};
      sub1 = `<span style="color:var(--green);font-weight:700">↓ Eingang</span> · ${escapeHtml(p.artikel || p.fruchtart || '–')}`;
      sub2 = `${p.lieferant ? escapeHtml(p.lieferant) : (p.herkunftName ? escapeHtml(p.herkunftName) : '')}${u.spedition ? ' · ' + escapeHtml(u.spedition) : ''}`;
    } else {
      const kunde = state.kontakte.find(c => c.id === u.kontakt_id);
      const kontr = state.kontrakte.find(k => k.id === u.kontrakt_id);
      const art   = state.artikel.find(a => a.id === u.artikel_id);
      sub1 = `<span style="color:var(--amber);font-weight:700">↑ Ausgang</span> · ${escapeHtml(kunde?.name || '–')}${kontr ? ' · Kontrakt ' + escapeHtml(kontr.nummer) : ''}`;
      sub2 = `${escapeHtml(art?.name || '–')} · ${escapeHtml(lagerLabel(u.silo_von_id))}${u.spedition ? ' · ' + escapeHtml(u.spedition) : ''}`;
    }
    return `<div class="card" style="margin-bottom:8px;padding:0;overflow:hidden;border-left:4px solid ${border}">
      <div onclick="waUmlaufOeffnen(${u.id})" style="cursor:pointer;padding:12px 14px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div style="min-width:0;flex:1">
          <div style="font-size:15px;font-weight:700;color:var(--color-text)">🚚 ${escapeHtml(u.kennzeichen || '—')}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">${sub1}</div>
          ${sub2 ? `<div style="font-size:11px;color:var(--text3);margin-top:1px">${sub2}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:15px;font-weight:700;color:var(--gold)">${g.toLocaleString('de-DE')} kg</div>
          <div style="font-size:10px;color:var(--text3)">${gTyp} · seit ${zeit}</div>
          <div style="font-size:11px;color:${border};margin-top:3px">${eingang ? 'Zweitwiegung' : 'Vollwiegung'} ›</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// Umlauf-Eintrag öffnen – nach Richtung ins passende Abschluss-Formular routen.
export function waUmlaufOeffnen(id) {
  const u = wartende().find(x => x.id === id);
  if(!u) return;
  if(u.richtung === 'eingang') {
    _offeneEingangUmlauf = u; _offenesFahrzeug = null; _modus = 'umlauf';
  } else {
    _offenesFahrzeug = id; _offeneEingangUmlauf = null; _modus = 'ausgang';
  }
  if(_container) renderWaageTab(_container);
}

export async function waUmlaufStornieren(id) {
  const u = wartende().find(x => x.id === id);
  if(!u) return;
  if(!confirm(`Fahrzeug ${u.kennzeichen} aus dem Umlauf nehmen? Es wird kein Ausgang gebucht.`)) return;
  try {
    await db.umlaufStornieren(id);
    state.umlauf = state.umlauf.filter(x => x.id !== id);
    _offenesFahrzeug = null;
    showToast(`🚚 ${u.kennzeichen} aus dem Umlauf genommen`);
    if(_container) renderWaageTab(_container);
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}

// Bucht den Warenausgang und druckt den Lieferschein in einem Schritt.
// Es gelten die Werte aus der Maske – auch wenn sie beim Vollwiegen geändert wurden.
export async function waAbschliessen(id) {
  const u = wartende().find(x => x.id === id);
  if(!u) return;
  const d = formLesen(true);
  if(d.fehler) { alert(d.fehler); return; }
  const netto = d.voll - d.leer;
  const bestKg = getSiloBestand(d.lagerId);
  // Ausgang-only-Lager (Kuchenlager) führt keinen Bestand – Warnung entfällt.
  if(!istAusgangLager(d.lagerId) && netto > bestKg + 0.01 &&
     !confirm(`Die Menge (${(netto/1000).toFixed(2)} t) übersteigt den Lagerbestand von ${(bestKg/1000).toFixed(2)} t.\n\nTrotzdem buchen?`)) return;

  const kontrakt = state.kontrakte.find(k => k.id === d.kontraktId);
  const kunde    = state.kontakte.find(c => c.id === d.kundeId);
  const btn = document.getElementById('wa-btn');
  if(btn) { btn.disabled = true; btn.textContent = 'Bucht…'; }
  try {
    const saved = await db.insertWarenbewegung({
      typ:'ausgang', artikelId: d.artikelId, siloVonId: d.lagerId, mengeKg: netto,
      vollgewicht: d.voll, leergewicht: d.leer,
      empfaenger: kunde?.name || '', belegNr: '', bio: !!kontrakt?.bio,
      kontraktId: d.kontraktId, notiz: '', erstelltVon: state.currentUser?.id || null,
      spedition: d.spedition, kennzeichen: d.kennzeichen, sonstigeAngaben: d.sonstiges
    });
    state.warenbewegungen.unshift(saved);
    await db.umlaufAbschliessen(id, saved.id);
    state.umlauf = state.umlauf.filter(x => x.id !== id);
    _offenesFahrzeug = null;
    _modus = 'umlauf';

    showToast(`✓ Ausgang gebucht · ${kg2t(netto)} · Lieferschein ${saved.lieferschein_nr || ''}`);
    const ew = new Date(u.erstwiegung);
    lieferscheinDrucken(lieferscheinDaten(saved, {
      zeit_erstwiegung: isNaN(ew) ? '' :
        ew.toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric'})
        + ' ' + ew.toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'}),
    }));
    if(_container) renderWaageTab(_container);
    if(window.renderSiloManagement) window.renderSiloManagement();
  } catch(e) {
    if(btn) { btn.disabled = false; btn.innerHTML = '&#10003; Abschließen &amp; drucken'; }
    showToast('⚠ Fehler: ' + e.message, 'error');
  }
}
