import { state } from './state.js?v=39';
import { db } from './db.js?v=39';
import { getFeld, netto, showToast, escapeHtml, sorteBadge } from './helpers.js?v=39';
import { getFruchtFarbe } from './frucht.js?v=39';
import { feuchteZuHoch } from './quality.js?v=39';
import { isBioFuhre, getSiloBioStatus } from './bio.js?v=39';

let _activeSiloId = null;
let _siloView = 'B';
const _selectedFuhren = new Set();

// Flachlager (Hofplatz + Hallen): virtuelle Lagerorte ohne Silo-Zeile in der DB.
// Fuhren werden wie beim Hofplatz über fuhren.silo_id = <Schlüssel> zugeordnet.
// Keine Kapazitäts-/Kulturprüfung – Schüttung auf Fläche.
const FLACHLAGER = {
  HOF:               { toggle: 'Hof',        titel: '🏗 Hofplatz · Zwischenlager', label: 'Hofplatz' },
  HALLE_ANARODE:     { toggle: 'Anarode',    titel: '📦 Halle Anarode',            label: 'Halle Anarode' },
  HALLE_HOEHNSTEDT:  { toggle: 'Höhnstedt',  titel: '📦 Halle Höhnstedt',          label: 'Halle Höhnstedt' },
  HALLE_LAUCHSTAEDT: { toggle: 'Lauchstädt', titel: '📦 Halle Bad Lauchstädt',     label: 'Halle Bad Lauchstädt' },
  // Halle Thondorf ist in zwei Teile unterteilt (kap_t = Kapazität in Tonnen).
  // Der Schlüssel HALLE_THONDORF bleibt Teil 1, damit ggf. bestehende Zuordnungen gültig bleiben.
  HALLE_THONDORF:    { toggle: 'Thondorf 1', titel: '📦 Halle Thondorf · Teil 1',  label: 'Halle Thondorf 1', kap_t: 4000 },
  HALLE_THONDORF2:   { toggle: 'Thondorf 2', titel: '📦 Halle Thondorf · Teil 2',  label: 'Halle Thondorf 2', kap_t: 1500 },
};
// Anzeigename eines Lagerorts: Flachlager-Name oder "Silo <id>"
export function lagerLabel(siloId) {
  return FLACHLAGER[siloId] ? FLACHLAGER[siloId].label : 'Silo ' + siloId;
}
// Herkunft einer Fuhre: eigener Betrieb (Landgut, Viehmast …) oder externer Zukauf-Lieferant.
// Erleichtert die Zuordnung im Silomanagement.
export function fuhreHerkunft(f) {
  const feld = getFeld(f.feldId);
  if((feld.typ||'schlag') === 'lieferant') return '🚚 ' + (feld.name || 'Zukauf');
  if((feld.typ||'schlag') === 'umlagerung') return '🔄 Umlagerung';
  return feld.betrieb || '';
}
// Alle Lagerorte (Flachlager + Silos) für Auswahl-Dropdowns, z.B. Quelle/Ziel bei Umlagerungen
export function alleLagerOrte() {
  return [
    ...Object.entries(FLACHLAGER).map(([k,l]) => ({ id: k, label: l.label })),
    ...state.silos.slice().sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true})).map(s => ({ id: s.id, label: 'Silo ' + s.id }))
  ];
}

// Koordinaten der Lagerstandorte (Ortsmitte genügt – die Standorte liegen
// 10–40 km auseinander). Für die Zuordnung eingewogener Fuhren per GPS.
export const LAGER_STANDORTE = [
  { key: 'BEESENSTEDT',       label: 'Beesenstedt (Hof)', lat: 51.5671, lon: 11.7338 },
  { key: 'HALLE_ANARODE',     label: 'Anarode',           lat: 51.5502, lon: 11.4049 },
  { key: 'HALLE_HOEHNSTEDT',  label: 'Höhnstedt',         lat: 51.5016, lon: 11.7410 },
  { key: 'HALLE_LAUCHSTAEDT', label: 'Bad Lauchstädt',    lat: 51.3874, lon: 11.8680 },
  { key: 'HALLE_THONDORF',    label: 'Thondorf',          lat: 51.5992, lon: 11.5291 },
];

// Nächstgelegener Lagerstandort zu einer GPS-Position (Haversine, km)
export function naechstesLager(lat, lon) {
  if(lat == null || lon == null) return null;
  const R = 6371, rad = Math.PI/180;
  let best = null;
  for(const o of LAGER_STANDORTE) {
    const dLat = (o.lat-lat)*rad, dLon = (o.lon-lon)*rad;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat*rad)*Math.cos(o.lat*rad)*Math.sin(dLon/2)**2;
    const d = 2*R*Math.asin(Math.sqrt(a));
    if(!best || d < best.distKm) best = { ...o, distKm: d };
  }
  return best;
}

// Kurztext für die Anzeige, z.B. "Höhnstedt · 0,8 km" oder "unterwegs (Richtung Thondorf, 14,2 km)"
export function standortText(lat, lon) {
  const o = naechstesLager(lat, lon);
  if(!o) return '';
  const km = o.distKm.toFixed(1).replace('.', ',');
  return o.distKm <= 10 ? `${o.label} · ${km} km` : `unterwegs (Richtung ${o.label}, ${km} km)`;
}

export function setSiloView(v) {
  _siloView = v;
  renderSiloManagement();
}

export function getSiloFill(siloId) {
  return state.fuhren
    .filter(f => f.siloId === siloId && f.status === 'fertig')
    .reduce((s,f) => s+(netto(f)||0), 0);
}
export function getSiloAusgang(siloId) {
  return state.warenbewegungen
    .filter(w => w.silo_von_id === siloId && w.typ === 'ausgang')
    .reduce((s,w) => s+(w.menge_kg||0), 0);
}
export function getSiloBestand(siloId) {
  return Math.max(0, getSiloFill(siloId) - getSiloAusgang(siloId));
}
export function getSiloKultur(siloId) {
  const silo = state.silos.find(s=>s.id===siloId);
  if(silo?.fruchtart) return silo.fruchtart;
  const firstFuhre = state.fuhren.find(f=>f.siloId===siloId&&f.status==='fertig');
  return firstFuhre ? (window.getFuhreKulturKey ? window.getFuhreKulturKey(firstFuhre) : firstFuhre.fruchtart) : null;
}

export function showSiloOverlay() {
  let ov = document.getElementById('silo-overlay');
  if(!ov) {
    ov = document.createElement('div');
    ov.id = 'silo-overlay';
    document.body.appendChild(ov);
  }
  const sb = document.getElementById('admin-sidebar');
  const sbW = sb ? sb.offsetWidth : 220;
  ov.style.cssText = `position:fixed;top:49px;left:${sbW}px;right:0;bottom:0;height:calc(100vh - 49px);background:var(--color-bg);z-index:50;overflow:hidden`;
  renderSiloManagement();
}

export function hideSiloOverlay() {
  const ov = document.getElementById('silo-overlay');
  if(ov) ov.style.display = 'none';
}

function _getKulturKey(f) {
  return window.getFuhreKulturKey ? window.getFuhreKulturKey(f) : f.fruchtart;
}

function _getSelectionKulturKey() {
  if(!_selectedFuhren.size) return null;
  const first = state.fuhren.find(f => _selectedFuhren.has(f.id));
  return first ? _getKulturKey(first) : null;
}

export function toggleFuhreSelection(fId) {
  if(_selectedFuhren.has(fId)) {
    _selectedFuhren.delete(fId);
  } else {
    const f = state.fuhren.find(x => x.id === fId);
    if(!f) return;
    const selKey = _getSelectionKulturKey();
    if(selKey && _getKulturKey(f) !== selKey) return;
    _selectedFuhren.add(fId);
  }
  updateQueueSelection();
}

export function selectAllFuhren() {
  const selKey = _getSelectionKulturKey();
  const unassigned = state.fuhren.filter(f=>f.status==='fertig'&&!f.siloId);
  const compatible = selKey
    ? unassigned.filter(f => _getKulturKey(f) === selKey)
    : unassigned;
  const allSelected = compatible.length > 0 && compatible.every(f => _selectedFuhren.has(f.id));
  if(allSelected) {
    _selectedFuhren.clear();
  } else {
    if(!selKey && compatible.length > 0) {
      const firstKey = _getKulturKey(compatible[0]);
      compatible.filter(f => _getKulturKey(f) === firstKey).forEach(f => _selectedFuhren.add(f.id));
    } else {
      compatible.forEach(f => _selectedFuhren.add(f.id));
    }
  }
  updateQueueSelection();
}

function updateQueueSelection() {
  const selKey = _getSelectionKulturKey();
  document.querySelectorAll('.silo-fuhre-item').forEach(el => {
    const fId = parseInt(el.dataset.fuhreId);
    const cb = el.querySelector('input[type="checkbox"]');
    const isSelected = _selectedFuhren.has(fId);
    const f = state.fuhren.find(x => x.id === fId);
    const compatible = !selKey || (f && _getKulturKey(f) === selKey);
    const disabled = !compatible && !isSelected;
    if(cb) {
      cb.checked = isSelected;
      cb.disabled = disabled;
    }
    el.style.outline = isSelected ? '2px solid var(--gold)' : 'none';
    el.style.opacity = disabled ? '0.35' : '1';
    el.style.pointerEvents = disabled ? 'none' : '';
  });
  const bar = document.getElementById('silo-action-bar');
  const allCb = document.getElementById('silo-select-all');
  const unassigned = state.fuhren.filter(f=>f.status==='fertig'&&!f.siloId);
  const compatibleCount = selKey
    ? unassigned.filter(f => _getKulturKey(f) === selKey).length
    : unassigned.length;
  if(allCb) allCb.checked = compatibleCount > 0 && _selectedFuhren.size === compatibleCount;
  if(bar) {
    if(_selectedFuhren.size > 0) {
      const selFuhren = state.fuhren.filter(f => _selectedFuhren.has(f.id));
      const totalT = (selFuhren.reduce((s,f) => s+(netto(f)||0), 0)/1000).toFixed(2);
      bar.style.display = '';
      bar.innerHTML = `
        <div style="font-size:13px;color:var(--text);font-weight:600">${_selectedFuhren.size} Fuhren · ${totalT} t</div>
        <button class="btn btn-primary" style="font-size:13px;padding:8px 16px" onclick="einlagernDialog()">Einlagern →</button>`;
    } else {
      bar.style.display = 'none';
    }
  }
}

export function einlagernDialog() {
  if(!_selectedFuhren.size) return;
  const selFuhren = state.fuhren.filter(f => _selectedFuhren.has(f.id));
  const totalT = (selFuhren.reduce((s,f) => s+(netto(f)||0), 0)/1000).toFixed(2);
  const kulturen = [...new Set(selFuhren.map(f => window.getFuhreKulturKey ? window.getFuhreKulturKey(f) : f.fruchtart))];
  const kulturStr = kulturen.join(', ');

  const siloOptions = state.silos
    .sort((a,b) => a.id.localeCompare(b.id, undefined, {numeric:true}))
    .map(s => {
      const kultur = getSiloKultur(s.id);
      const bestandT = (getSiloBestand(s.id)/1000).toFixed(1);
      const pct = Math.min(100, (getSiloBestand(s.id)/1000/s.kapazitaet_t)*100).toFixed(0);
      const bioStatus = getSiloBioStatus(s.id);
      const kompatibel = checkSiloKompatibel(s.id, selFuhren);
      const label = `Silo ${s.id} · ${s.kapazitaet_t}t · ${kultur||'leer'} · ${bestandT}t (${pct}%)${bioStatus&&bioStatus!=='leer'?' · '+bioStatus.toUpperCase():''}`;
      // Nicht mehr sperren – nur warnen. Der Bediener entscheidet (gleiche Produkte
      // können unterschiedlich benannt sein, z.B. "Bio Weizen" vs. "Winterweichweizen").
      return `<option value="${s.id}">${kompatibel.ok?'':'⚠ '}${label}${kompatibel.ok?'':' — '+kompatibel.reason}</option>`;
    }).join('');

  document.getElementById('silo-einlagern-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'silo-einlagern-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `
    <div style="background:var(--color-surface);border-radius:var(--radius-xl);padding:var(--space-6);width:100%;max-width:500px;box-shadow:var(--shadow-lg)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-family:var(--font-display);font-size:var(--text-xl);color:var(--color-text)">Fuhren einlagern</div>
        <button onclick="document.getElementById('silo-einlagern-modal').remove()" style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:18px">✕</button>
      </div>
      <div style="background:var(--green-50);border:1px solid var(--green-200);border-radius:var(--radius-md);padding:14px;margin-bottom:16px">
        <div style="font-size:var(--text-md);font-weight:700;color:var(--color-text);margin-bottom:4px">${_selectedFuhren.size} Fuhren ausgewählt</div>
        <div style="font-size:var(--text-base);color:var(--color-text-muted)">${totalT} t · ${kulturStr}</div>
      </div>
      <div class="form-group" style="margin-bottom:16px">
        <label style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:6px;display:block">Ziel-Silo</label>
        <select id="einlagern-silo" class="form-control" style="font-size:13px">
          <option value="">— Lagerort wählen —</option>
          ${Object.entries(FLACHLAGER).map(([k,l])=>`<option value="${k}">${l.titel}${l.kap_t?' ('+l.kap_t.toLocaleString('de-DE')+' t)':''}</option>`).join('')}
          ${siloOptions}
        </select>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" style="flex:1" onclick="einlagernSpeichern()">✓ Einlagern</button>
        <button class="btn btn-outline" onclick="document.getElementById('silo-einlagern-modal').remove()">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(m);
}

function checkSiloKompatibel(siloId, fuhren) {
  const siloKultur = getSiloKultur(siloId);
  const bioStatus = getSiloBioStatus(siloId);

  for(const f of fuhren) {
    const fuhreKultur = window.getFuhreKulturKey ? window.getFuhreKulturKey(f) : f.fruchtart;
    if(siloKultur && siloKultur !== fuhreKultur)
      return { ok: false, reason: 'andere Kultur ('+siloKultur+')' };
    const fuhreIstBio = isBioFuhre(f);
    if(bioStatus === 'bio' && !fuhreIstBio)
      return { ok: false, reason: 'BIO-Silo' };
    if(bioStatus === 'konventionell' && fuhreIstBio)
      return { ok: false, reason: 'konv. Silo' };
  }

  const kulturen = [...new Set(fuhren.map(f => window.getFuhreKulturKey ? window.getFuhreKulturKey(f) : f.fruchtart))];
  if(!siloKultur && kulturen.length > 1)
    return { ok: false, reason: 'verschiedene Kulturen gewählt' };

  return { ok: true };
}

export async function einlagernSpeichern() {
  const sel = document.getElementById('einlagern-silo');
  if(!sel || !sel.value) { showToast('Bitte Silo wählen', 'error'); return; }
  const siloId = sel.value;

  const fuhren = state.fuhren.filter(f => _selectedFuhren.has(f.id));
  if(!fuhren.length) return;

  if(!FLACHLAGER[siloId]) {
    const kompatibel = checkSiloKompatibel(siloId, fuhren);
    if(!kompatibel.ok) {
      // Weiche Warnung statt harter Sperre – der Bediener bestätigt bewusst.
      if(!confirm(`⚠ ${kompatibel.reason}.\n\nFuhren trotzdem in Silo ${siloId} einlagern?`)) return;
    }
  }

  document.getElementById('silo-einlagern-modal')?.remove();

  const silo = state.silos.find(s=>s.id===siloId);
  let errors = 0;
  const isFirstInSilo = !FLACHLAGER[siloId] && !getSiloKultur(siloId);

  for(const f of fuhren) {
    const previousSiloId = f.siloId;
    if(previousSiloId && !FLACHLAGER[previousSiloId] && previousSiloId !== siloId) {
      const oldSilo = state.silos.find(s=>s.id===previousSiloId);
      if(oldSilo) {
        const oldRemaining = state.fuhren.filter(x=>x.siloId===previousSiloId&&x.status==='fertig'&&x.id!==f.id);
        if(oldRemaining.length === 0) {
          oldSilo.fruchtart = null;
          try { await db.updateSilo(previousSiloId, {fruchtart:null}); } catch(e) {}
        }
      }
    }
    f.siloId = siloId;
    try { await db.updateFuhre(f.id, {siloId}); }
    catch(e) { errors++; f.siloId = previousSiloId; }
  }

  if(isFirstInSilo && silo) {
    const fuhreKultur = window.getFuhreKulturKey ? window.getFuhreKulturKey(fuhren[0]) : fuhren[0].fruchtart;
    silo.fruchtart = fuhreKultur;
    try { await db.updateSilo(siloId, {fruchtart: fuhreKultur}); } catch(e) {}
  }

  const ok = fuhren.length - errors;
  const label = lagerLabel(siloId);
  showToast(`✓ ${ok} Fuhre${ok>1?'n':''} → ${label}${errors?' ('+errors+' Fehler)':''}`);
  _selectedFuhren.clear();
  renderSiloManagement();
}

// ── Reinigen: Rohware aus einem A-Silo über den Reiniger in ein leeres Silo ──
// Die Fuhren wandern ins Ziel-Silo (Sorte/Qualität bleiben erhalten), der
// Reinigungsverlust (Roh − gereinigt) wird als Ausgang gebucht. Das Quell-Silo
// ist danach leer und steht für andere Sorten zur Verfügung.
export function reinigenDialog(quelleId) {
  const rohT = getSiloBestand(quelleId) / 1000;
  if(rohT <= 0) { showToast('Silo ist leer', 'error'); return; }
  const kultur = getSiloKultur(quelleId) || '–';
  // Ziel = leeres Silo (A oder Innen), außer dem Quell-Silo
  const ziele = state.silos
    .filter(s => s.id !== quelleId && getSiloBestand(s.id) <= 0)
    .sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
  const zielOpts = ziele.map(s => `<option value="${s.id}">Silo ${s.id} · ${s.kapazitaet_t} t</option>`).join('');

  document.getElementById('silo-reinigen-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'silo-reinigen-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `
    <div style="background:var(--color-surface);border-radius:var(--radius-xl);padding:var(--space-6);width:100%;max-width:460px;box-shadow:var(--shadow-lg)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-family:var(--font-display);font-size:var(--text-xl);color:var(--color-text)">🌀 Reinigen · Silo ${quelleId}</div>
        <button onclick="document.getElementById('silo-reinigen-modal').remove()" style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:18px">✕</button>
      </div>
      <div style="background:var(--green-50);border:1px solid var(--green-200);border-radius:var(--radius-md);padding:14px;margin-bottom:16px">
        <div style="font-size:var(--text-md);font-weight:700;color:var(--color-text)">Rohware: ${rohT.toFixed(2)} t · ${escapeHtml(kultur)}</div>
        <div style="font-size:var(--text-base);color:var(--color-text-muted)">Differenz (Roh − gereinigt) wird als Ausputz ausgebucht</div>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:6px;display:block">Ziel-Silo (leer)</label>
        <select id="reinigen-ziel" class="form-control" style="font-size:13px">
          <option value="">— Silo wählen —</option>${zielOpts}
        </select>
        ${ziele.length ? '' : '<div style="font-size:11px;color:var(--amber);margin-top:4px">Kein leeres Silo verfügbar</div>'}
      </div>
      <div class="form-group" style="margin-bottom:16px">
        <label style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:6px;display:block">Gereinigte Menge (t)</label>
        <input type="number" id="reinigen-menge" class="form-control" min="0.001" step="0.001" value="${rohT.toFixed(3)}" style="font-size:15px;font-weight:700">
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" style="flex:1" onclick="reinigenSpeichern('${quelleId}')">🌀 Reinigen</button>
        <button class="btn btn-outline" onclick="document.getElementById('silo-reinigen-modal').remove()">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(m);
}

export async function reinigenSpeichern(quelleId) {
  const zielId = document.getElementById('reinigen-ziel')?.value;
  const gereinigtT = parseFloat(document.getElementById('reinigen-menge')?.value);
  if(!zielId) { showToast('Bitte Ziel-Silo wählen', 'error'); return; }
  if(isNaN(gereinigtT) || gereinigtT <= 0) { showToast('Bitte gereinigte Menge angeben', 'error'); return; }
  const rohKg = getSiloBestand(quelleId);
  const gereinigtKg = Math.round(gereinigtT * 1000);
  if(gereinigtKg > rohKg + 0.5) { showToast('Gereinigte Menge größer als Rohware ('+(rohKg/1000).toFixed(2)+' t)', 'error'); return; }

  const kultur = getSiloKultur(quelleId);
  const fuhren = state.fuhren.filter(f => f.siloId === quelleId && f.status === 'fertig');
  document.getElementById('silo-reinigen-modal')?.remove();

  try {
    // 1) Fuhren ins Ziel-Silo verschieben (Sorte/Qualität wandern mit)
    for(const f of fuhren) { f.siloId = zielId; await db.updateFuhre(f.id, {siloId: zielId}); }
    // 2) Silo-Kulturen aktualisieren: Ziel bekommt die Kultur, Quelle wird frei
    const zielSilo = state.silos.find(s=>s.id===zielId);
    const quellSilo = state.silos.find(s=>s.id===quelleId);
    if(zielSilo && kultur) { zielSilo.fruchtart = kultur; try { await db.updateSilo(zielId, {fruchtart: kultur}); } catch(e){} }
    if(quellSilo) { quellSilo.fruchtart = null; try { await db.updateSilo(quelleId, {fruchtart: null}); } catch(e){} }
    // 3) Reinigungsverlust (Ausputz) als Ausgang aus dem Ziel-Silo buchen
    const verlustKg = Math.max(0, rohKg - gereinigtKg);
    if(verlustKg >= 1) {
      const wb = await db.insertWarenbewegung({
        typ: 'ausgang', siloVonId: zielId, mengeKg: verlustKg,
        notiz: 'Reinigungsverlust/Ausputz · Reinigung Silo ' + quelleId + ' → ' + zielId,
        erstelltVon: state.currentUser?.id || null
      });
      if(wb) state.warenbewegungen.unshift(wb);
    }
    showToast(`🌀 ${(gereinigtKg/1000).toFixed(2)} t gereinigt → Silo ${zielId} · Silo ${quelleId} ist frei`);
  } catch(e) {
    showToast('⚠ Reinigen fehlgeschlagen: ' + e.message, 'error');
    try { state.fuhren = await db.getFuhren(); state.warenbewegungen = await db.getWarenbewegungen(); } catch(_) {}
  }
  _activeSiloId = null;
  renderSiloManagement();
}

export function renderSiloManagement() {
  const istInnen = s => /^I\d+$/i.test(s.id);
  const bigSilos = state.silos.filter(s=>!istInnen(s)&&s.kapazitaet_t>=1000).sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
  const smallSilos = state.silos.filter(s=>!istInnen(s)&&s.kapazitaet_t<1000).sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
  const innenSilos = state.silos.filter(istInnen).sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
  const unassigned = state.fuhren.filter(f=>f.status==='fertig'&&!f.siloId).sort((a,b)=>new Date(b.zeit)-new Date(a.zeit));
  const totalFertig = state.fuhren.filter(f=>f.status==='fertig').length;
  const totalAssigned = state.fuhren.filter(f=>f.status==='fertig'&&f.siloId).length;
  const view = _siloView;

  // Remove stale selections
  _selectedFuhren.forEach(id => {
    if(!unassigned.find(f=>f.id===id)) _selectedFuhren.delete(id);
  });

  const sc = (s) => {
    // Bestand (Zugang − Ausgänge/Reinigung) statt Brutto-Zugang, damit z.B. ein
    // gereinigtes oder verkauftes Silo auch optisch leer(er) wird.
    const fillKg = getSiloBestand(s.id);
    const fillT = fillKg/1000;
    const pct = Math.min(100,(fillT/s.kapazitaet_t)*100);
    const overfull = fillT > s.kapazitaet_t;
    const kultur = getSiloKultur(s.id);
    const isBig = s.kapazitaet_t >= 1000;
    const sz = isBig ? 150 : 110;
    const r = (sz/2)-9;
    const circ = 2*Math.PI*r;
    const hasFeuchteWarn = state.fuhren.filter(f=>f.siloId===s.id).some(feuchteZuHoch);
    const fc = overfull?'#b03030':pct>85?'#b07820':pct>0?'#6b8f4e':'#c2c9b9';
    const active = _activeSiloId===s.id;
    const sd = (pct/100*circ).toFixed(1)+' '+circ.toFixed(1);
    const cnt = state.fuhren.filter(f=>f.siloId===s.id).length;
    const kl = kultur ? kultur
      .replace('Winterweichweizen','W.Weizen').replace('Wintergerste','W.Gerste')
      .replace('Winterraps','W.Raps').replace('Wintertriticale','W.Triticale')
      .replace('Winterdurum','W.Durum').replace('Winter','W.').replace('Sommer','So.') : '';
    const siloIstBio = getSiloBioStatus(s.id) === 'bio';
    const strokeC = hasFeuchteWarn ? 'var(--color-danger)' : active ? 'var(--gold)' : siloIstBio ? 'var(--color-success)' : '#c2c9b9';
    const strokeW = active ? 3 : 1.5;
    const fillBg = active ? 'var(--green-50)' : 'var(--color-surface)';
    const pctText = pct>0 ? `<text x="${sz/2}" y="${sz/2+22}" text-anchor="middle" fill="#73796c" font-size="${isBig?11:9}" font-family="monospace">${pct.toFixed(0)}%</text>` : '';
    const kulturColor = getFruchtFarbe(kultur).dot;
    const kulturSpan = kl
      ? `<span style="color:${kulturColor};font-size:${isBig?12:10}px;font-weight:600">${kl}</span>`
      : `<span style="color:var(--text2);font-size:${isBig?11:9}px">leer</span>`;
    const cntSpan = cnt ? `<br><span style="color:var(--text2);font-size:${isBig?10:9}px">${cnt} Fhm</span>` : '';
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px;position:relative">
      <button onclick="openSiloDetail('${s.id}')" style="background:none;border:none;padding:0;cursor:pointer;display:block;width:${sz}px;height:${sz}px">
        <svg id="ssvg-${s.id}" width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}" style="transition:filter .2s;display:block">
          <circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="${fillBg}" stroke="${strokeC}" stroke-width="${strokeW}"/>
          <circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="${fc}" stroke-width="${isBig?12:9}"
            stroke-dasharray="${sd}" transform="rotate(-90 ${sz/2} ${sz/2})" style="transition:stroke-dasharray .4s"/>
          <text x="${sz/2}" y="${sz/2-8}" text-anchor="middle" fill="#191c18" font-size="${isBig?18:14}" font-weight="700" font-family="sans-serif">${s.id}</text>
          <text x="${sz/2}" y="${sz/2+10}" text-anchor="middle" fill="${pct>0?fc:'#73796c'}" font-size="${isBig?14:11}" font-family="sans-serif">${pct>0?fillT.toFixed(1)+'t':'leer'}</text>
          ${pctText}
        </svg>
      </button>
      <div style="text-align:center;max-width:${sz}px;line-height:1.5">${kulturSpan}${cntSpan}</div>
    </div>`;
  };

  // Flachlager-Ansicht (Hofplatz/Hallen): Fuhrenliste im gestrichelten Rahmen
  const lagerView = (lagerId) => {
    const lager = FLACHLAGER[lagerId];
    const lagerFuhren = state.fuhren.filter(f=>f.siloId===lagerId&&f.status==='fertig');
    const zugangT = lagerFuhren.reduce((s,f)=>s+(netto(f)||0),0)/1000;
    const ausgangT = getSiloAusgang(lagerId)/1000;
    const bestandT = Math.max(0, zugangT - ausgangT);
    const bestandStr = ausgangT > 0
      ? `${zugangT.toFixed(1)} t − ${ausgangT.toFixed(1)} t Ausgang = <b>${bestandT.toFixed(1)} t Bestand</b>`
      : `${zugangT.toFixed(1)} t`;
    const kapHtml = lager.kap_t ? (() => {
      const pct = Math.min(100, bestandT / lager.kap_t * 100);
      const farbe = pct > 85 ? 'var(--color-warning)' : 'var(--color-primary)';
      return `<div style="margin:-4px 0 12px">
        <div style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:4px">Kapazität ${lager.kap_t.toLocaleString('de-DE')} t · belegt ${bestandT.toFixed(1)} t (${pct.toFixed(0)} %)</div>
        <div style="background:var(--neutral-200);border:1px solid var(--color-border);border-radius:6px;height:12px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${farbe};transition:width .3s"></div></div>
      </div>`;
    })() : '';
    return `<div style="display:flex;flex-direction:column;align-items:center;width:100%;padding:16px">
    <div style="width:100%;max-width:600px">
      <div style="background:var(--green-50);border:2px dashed var(--color-primary);border-radius:var(--radius-lg);min-height:200px;padding:16px;margin-bottom:16px">
        <div style="font-size:var(--text-md);letter-spacing:1px;text-transform:uppercase;color:var(--color-text);margin-bottom:12px">${lager.titel} · ${lagerFuhren.length} Fuhren · ${bestandStr}</div>
        ${kapHtml}
        ${lagerFuhren.length ? lagerFuhren.map(f=>{
          const n=netto(f); const fr=getFruchtFarbe(f.fruchtart);
          return `<div style="display:flex;border-radius:var(--radius-sm);overflow:hidden;margin-bottom:8px;background:var(--color-surface);border:1px solid var(--color-border)">
            <div style="width:5px;flex-shrink:0;background:${fr.dot}"></div>
            <div style="padding:10px 12px;flex:1;display:flex;align-items:center;gap:10px">
              <div style="flex:1">
                <div style="font-size:var(--text-md);font-weight:700;color:var(--color-text)">${f.fruchtart}${sorteBadge(f)}</div>
                <div style="font-size:var(--text-base);color:var(--color-text);font-weight:600">${n?(n/1000).toFixed(2)+' t':'–'}</div>
                <div style="font-size:var(--text-sm);color:var(--color-text-muted)">${getFeld(f.feldId).name||'–'} · ${f.feuchte??'–'}%F</div>
              </div>
              <button onclick="removeFuhreFromSilo(${f.id})" title="Aus ${lager.label} entfernen"
                style="background:none;border:1px solid var(--color-border);color:var(--color-text-muted);cursor:pointer;font-size:14px;width:30px;height:30px;border-radius:var(--radius-xs);flex-shrink:0">✕</button>
            </div>
          </div>`;
        }).join('') : `<div style="text-align:center;padding:32px;color:var(--color-text-subtle);font-size:var(--text-md)">Keine Fuhren in ${lager.label}</div>`}
      </div>
    </div>
  </div>`;
  };

  const bRow = (silos) => `<div style="display:flex;gap:8px;justify-content:center">${silos.map(sc).join('')}</div>`;
  const bList = `<div style="display:flex;flex-direction:column;gap:4px;align-items:center;padding:8px">
    ${bRow(bigSilos.slice(0,2))}
    ${bRow(bigSilos.slice(2,4))}
    ${bRow(bigSilos.slice(4,5))}
  </div>`;

  const colW = 140;
  const col = (arr) => `<div style="display:flex;flex-direction:column;gap:0;width:${colW}px;align-items:center">${arr.map(sc).join('')}</div>`;
  const aGrid = `<div style="display:flex;gap:8px;justify-content:center;padding:8px;align-items:flex-start">${col(smallSilos.slice(0,7))}${col(smallSilos.slice(7,14))}${col(smallSilos.slice(14,21))}</div>`;
  const iGrid = `<div style="display:flex;gap:8px;justify-content:center;padding:8px;align-items:flex-start">${col(innenSilos.slice(0,6))}${col(innenSilos.slice(6,12))}${col(innenSilos.slice(12,17))}</div>`;

  const fi = (f) => {
    const n = netto(f);
    const farbe = getFruchtFarbe(f.fruchtart);
    const verColor = f.verifiziert ? 'var(--color-success)' : 'var(--color-warning)';
    const verIcon = f.verifiziert ? '✓' : '⏳';
    const nettoStr = n ? (n/1000).toFixed(2)+' t' : '– t';
    const datum = new Date(f.zeit).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});
    const feuchteW = feuchteZuHoch(f);
    const selected = _selectedFuhren.has(f.id);
    return `<div class="silo-fuhre-item" data-fuhre-id="${f.id}"
      onclick="toggleFuhreSelection(${f.id})"
      style="display:flex;border-radius:var(--radius-md);overflow:hidden;margin-bottom:8px;cursor:pointer;background:${feuchteW?'var(--color-danger-wash)':'var(--color-surface)'};border:1px solid ${feuchteW?'var(--color-danger)':'var(--color-border)'};outline:${selected?'2px solid var(--color-primary)':'none'};transition:outline .15s">
      <div style="width:6px;flex-shrink:0;background:${feuchteW?'var(--color-danger)':farbe.dot}"></div>
      <div style="padding:10px 12px;flex:1;min-width:0;display:flex;align-items:center;gap:10px">
        <input type="checkbox" ${selected?'checked':''} onclick="event.stopPropagation();toggleFuhreSelection(${f.id})"
          style="width:18px;height:18px;accent-color:var(--gold);cursor:pointer;flex-shrink:0">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
            <span style="font-size:14px;font-weight:700;color:var(--text)">${f.fruchtart}${sorteBadge(f)}</span>
            <span style="font-size:13px;color:${verColor}">${verIcon}</span>
          </div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:2px">${escapeHtml(fuhreHerkunft(f))}</div>
          <div style="font-size:15px;font-weight:800;color:var(--gold);margin-bottom:2px">${nettoStr}</div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;color:var(--text3)">${f.feuchte!=null?f.feuchte+'%F':''}${f.feuchte!=null&&f.protein!=null?' · ':''}${f.protein!=null?f.protein+'%P':''}</span>
            <span style="font-size:11px;color:var(--text3)">${datum}</span>
          </div>
          ${f.lat!=null?`<div style="font-size:11px;color:var(--blue-500);margin-top:2px">📍 ${standortText(f.lat,f.lon)}</div>`:''}
        </div>
      </div>
    </div>`;
  };

  const el = document.getElementById('silo-overlay') || document.getElementById('silo-main');
  if(!el) return;
  const bg = (v) => view===v ? 'var(--gold)' : 'transparent';
  const cl = (v) => view===v ? '#1a1400' : 'var(--text3)';
  const capLbl = view==='B' ? '5 × 1.000 t' : view==='A' ? '21 × 300 t' : view==='I' ? '17 × 150 t · Innensilos' : (FLACHLAGER[view]?.label || '');
  const emptyMsg = totalFertig ? '✓ Alle zugeordnet' : 'Keine fertigen Fuhren';
  const queueHtml = unassigned.length ? unassigned.map(fi).join('') : `<div style="text-align:center;padding:20px 8px;color:var(--text2);font-size:12px">${emptyMsg}</div>`;
  const allChecked = unassigned.length > 0 && _selectedFuhren.size === unassigned.length;
  const actionBarVisible = _selectedFuhren.size > 0;
  const selFuhren = state.fuhren.filter(f => _selectedFuhren.has(f.id));
  const selTotalT = (selFuhren.reduce((s,f) => s+(netto(f)||0), 0)/1000).toFixed(2);

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 49px);overflow:hidden">
      <div style="padding:10px 16px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;background:var(--color-surface)">
        <div style="display:flex;align-items:center;gap:10px">
          <button onclick="setAdminTab('schlaege')" style="background:none;border:1px solid var(--color-border);color:var(--color-text-muted);padding:5px 10px;border-radius:var(--radius-xs);cursor:pointer;font-family:var(--font-sans);font-size:var(--text-sm)">← Zurück</button>
          <div style="font-family:var(--font-display);font-size:16px;color:var(--color-text)">🏭 Silomanagement</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <div style="display:flex;background:var(--neutral-200);border:1px solid var(--color-border);border-radius:var(--radius-pill);padding:3px;gap:2px;flex-wrap:wrap">
            <button onclick="setSiloView('B')" style="padding:8px 16px;border-radius:var(--radius-pill);border:none;cursor:pointer;font-family:var(--font-sans);font-size:14px;font-weight:700;background:${bg('B')};color:${cl('B')}">B</button>
            <button onclick="setSiloView('A')" style="padding:8px 16px;border-radius:var(--radius-pill);border:none;cursor:pointer;font-family:var(--font-sans);font-size:14px;font-weight:700;background:${bg('A')};color:${cl('A')}">A</button>
            <button onclick="setSiloView('I')" style="padding:8px 16px;border-radius:var(--radius-pill);border:none;cursor:pointer;font-family:var(--font-sans);font-size:14px;font-weight:700;background:${bg('I')};color:${cl('I')}">I</button>
            ${Object.entries(FLACHLAGER).map(([k,l]) =>
              `<button onclick="setSiloView('${k}')" style="padding:8px 14px;border-radius:var(--radius-pill);border:none;cursor:pointer;font-family:var(--font-sans);font-size:14px;font-weight:700;background:${bg(k)};color:${cl(k)}">${l.toggle}</button>`
            ).join('')}
          </div>
          <div style="font-size:14px;color:var(--text2)">${capLbl}</div>
          <button class="btn btn-sm btn-outline" onclick="exportSiloCSV()">⬇ CSV</button>
        </div>
      </div>
      <div style="display:flex;flex:1;overflow:hidden">
        <div style="width:320px;flex-shrink:0;border-right:1px solid var(--color-border);display:flex;flex-direction:column">
          <div style="padding:8px 12px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:10px">
            <input type="checkbox" id="silo-select-all" ${allChecked?'checked':''}
              onclick="selectAllFuhren()"
              style="width:18px;height:18px;accent-color:var(--gold);cursor:pointer;flex-shrink:0"
              title="Alle auswählen">
            <div style="flex:1">
              <div style="font-size:15px;font-weight:800;color:var(--text)">Warteschlange</div>
              <div style="font-size:13px;color:var(--text3)">${unassigned.length} offen · ${totalAssigned}/${totalFertig} zugeordnet</div>
            </div>
          </div>
          <div style="flex:1;overflow-y:auto;padding:8px">${queueHtml}</div>
          <div id="silo-action-bar" style="padding:10px 12px;border-top:1px solid var(--color-border);background:var(--green-50);display:${actionBarVisible?'flex':'none'};align-items:center;justify-content:space-between;gap:8px">
            <div style="font-size:13px;color:var(--text);font-weight:600">${_selectedFuhren.size} Fuhren · ${selTotalT} t</div>
            <button class="btn btn-primary" style="font-size:13px;padding:8px 16px" onclick="einlagernDialog()">Einlagern →</button>
          </div>
        </div>
        <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;align-items:center;padding:8px">
          ${view==='B' ? bList : view==='A' ? aGrid : view==='I' ? iGrid : lagerView(view)}
        </div>
        <div id="silo-detail-panel" style="width:360px;flex-shrink:0;border-left:1px solid var(--color-border);display:flex;flex-direction:column;background:var(--color-surface)">
          <div style="padding:14px 16px;border-bottom:1px solid var(--color-border);font-size:16px;color:var(--color-text-subtle);font-weight:600">← Silo anklicken</div>
          <div id="silo-detail-content" style="flex:1;overflow-y:auto;padding:12px"></div>
        </div>
      </div>
    </div>`;

  if(_activeSiloId) renderSiloDetail(_activeSiloId);
}

export function openSiloDetail(siloId) {
  _activeSiloId = siloId;
  renderSiloDetail(siloId);
  document.querySelectorAll('[id^="ssvg-"]').forEach(svg => {
    const id = svg.id.replace('ssvg-','');
    const circles = svg.querySelectorAll('circle');
    if(circles.length > 0) {
      circles[0].style.stroke = id===siloId ? 'var(--gold)' : '#c2c9b9';
      circles[0].style.strokeWidth = id===siloId ? '4' : '2';
      circles[0].style.fill = id===siloId ? 'var(--green-50)' : 'var(--color-surface)';
    }
  });
}

function renderSiloDetail(siloId) {
  const panel = document.getElementById('silo-detail-content');
  const header = document.getElementById('silo-detail-panel')?.querySelector('div');
  if(!panel) return;
  const silo = state.silos.find(s=>s.id===siloId);
  if(!silo) return;
  const assignedFuhren = state.fuhren.filter(f=>f.siloId===siloId&&f.status==='fertig').sort((a,b)=>new Date(b.zeit)-new Date(a.zeit));
  const eingangKg = getSiloFill(siloId);
  const ausgangKg = getSiloAusgang(siloId);
  const bestandKg = Math.max(0, eingangKg - ausgangKg);
  const fillT = bestandKg/1000;
  const pct = Math.min(100,(fillT/silo.kapazitaet_t)*100);
  const kultur = getSiloKultur(siloId);
  const farbe = getFruchtFarbe(kultur);
  const avg = (key) => {
    const valid = assignedFuhren.filter(f=>f[key]!=null);
    return valid.length ? (valid.reduce((s,f)=>s+(f[key]||0),0)/valid.length).toFixed(1) : null;
  };
  const avgFeuchte=avg('feuchte'), avgProtein=avg('protein'), avgHL=avg('hlGewicht'), avgFallzahl=avg('fallzahl'), avgOel=avg('oelgehalt');
  const barColor = pct>100?'#b03030':pct>85?'#b07820':'#6b8f4e';

  const fuhreRow = (f) => {
    const n = netto(f);
    const fr = getFruchtFarbe(f.fruchtart);
    const datum = new Date(f.zeit).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});
    const feuchteWarn = feuchteZuHoch(f);
    const borderColor = feuchteWarn ? 'var(--color-danger)' : 'var(--color-border)';
    const bgColor = feuchteWarn ? 'var(--color-danger-wash)' : 'var(--color-surface)';
    const stripColor = feuchteWarn ? 'var(--color-danger)' : fr.dot;
    const warnBadge = feuchteWarn ? '<span style="font-size:var(--text-xs);font-weight:700;color:var(--color-danger);background:var(--color-danger-wash);padding:2px 8px;border-radius:var(--radius-pill)">&#9888; Feuchte zu hoch</span>' : '';
    const feuchteColor = feuchteWarn ? 'var(--color-danger)' : 'var(--color-text-subtle)';
    const feuchteWeight = feuchteWarn ? '700' : '400';
    const feuchteStr = f.feuchte!=null ? '<span style="color:'+feuchteColor+';font-weight:'+feuchteWeight+'">'+f.feuchte+'%F'+(feuchteWarn?' &#9888;':'')+'</span>' : '';
    const proteinStr = f.protein!=null ? ' <span style="color:var(--text3)">· '+f.protein+'%P</span>' : '';
    const hlStr = f.hlGewicht!=null ? ' <span style="color:var(--text3)">· HL '+f.hlGewicht+'</span>' : '';
    const oelStr = f.oelgehalt!=null ? ' <span style="color:var(--text3)">· Öl '+f.oelgehalt+'%</span>' : '';
    return '<div style="display:flex;border-radius:8px;overflow:hidden;margin-bottom:8px;background:'+bgColor+';border:1px solid '+borderColor+'">'
      +'<div style="width:5px;flex-shrink:0;background:'+stripColor+'"></div>'
      +'<div style="padding:10px 12px;flex:1;min-width:0">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">'
      +'<span style="font-size:15px;font-weight:700;color:var(--gold)">'+(n?(n/1000).toFixed(2)+' t':'–')+'</span>'
      +warnBadge
      +'<button onclick="removeFuhreFromSilo('+f.id+')" title="Aus Silo entfernen" style="background:none;border:1px solid var(--border);color:var(--text2);cursor:pointer;font-size:14px;width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#x2715;</button>'
      +'</div>'
      +'<div style="font-size:13px;color:var(--text2)">'+f.fruchtart+sorteBadge(f)+'</div>'
      +'<div style="font-size:12px;color:var(--text3);margin-top:2px">'+escapeHtml(fuhreHerkunft(f))+' · '+(getFeld(f.feldId).name||'–')+' · '+datum+'</div>'
      +'<div style="font-size:12px;margin-top:1px">'+feuchteStr+proteinStr+hlStr+oelStr+'</div>'
      +'</div></div>';
  };

  panel.innerHTML = `
    <div style="font-family:var(--font-display);font-size:28px;font-weight:700;color:var(--color-text);margin-bottom:2px">Silo ${siloId}</div>
    <div style="font-size:14px;margin-bottom:14px">${silo.kapazitaet_t} t${kultur?` · <span style="color:${farbe.dot};font-weight:600">${kultur}</span>`:' · <span style="color:var(--text2)">leer</span>'}</div>
    <div style="background:var(--green-200);border-radius:var(--radius-xs);height:10px;overflow:hidden;margin-bottom:6px">
      <div style="width:${Math.min(pct,100).toFixed(1)}%;height:100%;background:${barColor};border-radius:6px;transition:width .3s"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:16px">
      <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:var(--radius);padding:8px 10px;text-align:center">
        <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:3px">Eingang</div>
        <div style="font-size:16px;font-weight:700;color:var(--gold)">${(eingangKg/1000).toFixed(1)} t</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:var(--radius);padding:8px 10px;text-align:center">
        <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:3px">Ausgang</div>
        <div style="font-size:16px;font-weight:700;color:var(--red)">${(ausgangKg/1000).toFixed(1)} t</div>
      </div>
      <div style="background:var(--bg3);border:2px solid var(--gold);border-radius:var(--radius);padding:8px 10px;text-align:center">
        <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);margin-bottom:3px">Bestand</div>
        <div style="font-size:16px;font-weight:700;color:#fff">${fillT.toFixed(1)} t</div>
      </div>
    </div>
    ${bestandKg > 0 ? `
    <button class="btn btn-full" style="background:var(--blue);color:#fff;border:none;margin-bottom:10px" onclick="reinigenDialog('${siloId}')">🌀 Reinigen → anderes Silo</button>
    <div style="font-size:10px;color:var(--text3);letter-spacing:1px;margin-bottom:12px;text-align:center">Auslagerungen → Warenwirtschaft › Warenbewegungen</div>` : ''}
    <div style="font-size:12px;color:var(--text3);margin-bottom:4px;text-align:right">${pct.toFixed(0)}% belegt</div>
    ${avgFeuchte ? `
    <div style="background:var(--green-50);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:16px;border:1px solid var(--green-200)">
      <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text2);margin-bottom:10px">Ø Qualität</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><div style="font-size:11px;color:var(--text2);margin-bottom:2px">Feuchte</div><div style="font-size:22px;font-weight:700;color:var(--text)">${avgFeuchte}<span style="font-size:13px;color:var(--text2)">%</span></div></div>
        <div><div style="font-size:11px;color:var(--text2);margin-bottom:2px">Protein</div><div style="font-size:22px;font-weight:700;color:var(--text)">${avgProtein}<span style="font-size:13px;color:var(--text2)">%</span></div></div>
        <div><div style="font-size:11px;color:var(--text2);margin-bottom:2px">HL-Gewicht</div><div style="font-size:22px;font-weight:700;color:var(--text)">${avgHL}</div></div>
        ${avgFallzahl?`<div><div style="font-size:11px;color:var(--text2);margin-bottom:2px">Fallzahl</div><div style="font-size:22px;font-weight:700;color:var(--text)">${avgFallzahl}</div></div>`:''}
        ${avgOel?`<div><div style="font-size:11px;color:var(--text2);margin-bottom:2px">Ölgehalt</div><div style="font-size:22px;font-weight:700;color:var(--text)">${avgOel}<span style="font-size:13px;color:var(--text2)">%</span></div></div>`:''}
      </div>
    </div>` : ''}
    <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text2);margin-bottom:10px">
      ${assignedFuhren.length} Fuhren · ✕ zum Entfernen
    </div>
    ${assignedFuhren.map(fuhreRow).join('')}
    ${!assignedFuhren.length?`<div style="text-align:center;padding:32px 0;color:var(--text);font-size:14px">Leer</div>`:''}`;
}

export async function removeFuhreFromSilo(fId) {
  const f = state.fuhren.find(x=>x.id===fId);
  if(!f) return;
  const previousSiloId = f.siloId;
  f.siloId = null;
  if(!FLACHLAGER[previousSiloId]) {
    const silo = state.silos.find(s=>s.id===previousSiloId);
    const remaining = state.fuhren.filter(x=>x.siloId===previousSiloId&&x.status==='fertig');
    if(silo && remaining.length === 0) {
      silo.fruchtart = null;
      try { await db.updateSilo(previousSiloId, {fruchtart: null}); } catch(e) {}
    }
  }
  renderSiloManagement();
  if(_activeSiloId) renderSiloDetail(_activeSiloId);
  try { await db.updateFuhre(fId, {siloId: null}); showToast('✓ Fuhre wieder in Warteschlange'); }
  catch(e) { f.siloId = previousSiloId; showToast('⚠ '+e.message,'error'); renderSiloManagement(); }
}

export function renderSilomeister() {
  document.getElementById('main-content').innerHTML = '';
  showSiloOverlay();
  // Floating-Button "Fuhre erfassen" (Waage-Tablet) für den Silomeister
  let fab = document.getElementById('we-fab');
  if(!fab) {
    fab = document.createElement('button');
    fab.id = 'we-fab';
    fab.type = 'button';
    fab.innerHTML = '⚖ Fuhre erfassen';
    fab.onclick = () => { if(window.openWaageErfassung) window.openWaageErfassung(); };
    fab.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:200;background:var(--gold);color:#fff;border:none;border-radius:999px;padding:14px 22px;font-size:15px;font-weight:700;box-shadow:var(--shadow-lg);cursor:pointer';
    document.body.appendChild(fab);
  }
  fab.style.display = 'block';
}
