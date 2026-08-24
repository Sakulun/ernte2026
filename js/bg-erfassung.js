import { sb, bgState, bgDb, KULTUREN, escapeHtml, showToast, kg2t, renderBgMain } from './bg-app.js?v=121';

// ── Fuhre erfassen: Lieferant → (Schlag) → Kultur → Gewichte + TS % ──────────

export function bgFmtGewicht(input) {
  const pos = input.selectionStart;
  const raw = input.value.replace(/\./g,'').replace(/[^0-9]/g,'');
  if(!raw) return;
  const formatted = parseInt(raw).toLocaleString('de-DE');
  const added = formatted.length - input.value.length;
  input.value = formatted;
  try { input.setSelectionRange(pos+added, pos+added); } catch(e) {}
}
const parseGewicht = str => parseFloat((str||'').replace(/\./g,'').replace(',','.')) || 0;

export function bgUpdNetto() {
  const v = parseGewicht(document.getElementById('bg-voll')?.value);
  const l = parseGewicht(document.getElementById('bg-leer')?.value);
  const el = document.getElementById('bg-netto');
  if(!el) return;
  if(v && l && v > l) { el.textContent = (v-l).toLocaleString('de-DE'); el.style.color = 'var(--green2)'; }
  else { el.textContent = '—'; el.style.color = 'var(--text3)'; }
}

// Schlag-Auswahl an den Lieferanten anpassen (Schläge des Lieferanten + freie)
export function bgLieferantWahl() {
  const lid = parseInt(document.getElementById('bg-lieferant')?.value);
  const sel = document.getElementById('bg-feld');
  if(!sel) return;
  const passend = bgState.felder.filter(f => f.aktiv && (!f.lieferant_id || f.lieferant_id === lid));
  sel.innerHTML = '<option value="">— ohne Schlag —</option>'
    + passend.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
}

export function renderBgErfassen(el) {
  const lieferanten = bgState.lieferanten.filter(l => l.aktiv);
  const lOpts = lieferanten.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
  const kOpts = KULTUREN.map(k => `<option>${escapeHtml(k)}</option>`).join('');
  el.innerHTML = `<div class="card">
    <div class="card-header"><div>
      <div class="card-title">⚖ Fuhre erfassen</div>
      <div class="card-sub">Lieferant → Kultur → Gewichte → TS-Gehalt</div>
    </div></div>
    ${lieferanten.length ? '' : '<div style="font-size:13px;color:var(--amber);margin-bottom:10px">⚠ Noch keine Lieferanten angelegt – unter „Stammdaten" anlegen.</div>'}
    <div class="form-group"><label>Lieferant *</label>
      <select id="bg-lieferant" onchange="bgLieferantWahl()"><option value="">— Lieferant wählen —</option>${lOpts}</select></div>
    <div class="form-group"><label>Schlag (optional)</label>
      <select id="bg-feld"><option value="">— ohne Schlag —</option></select></div>
    <div class="form-group"><label>Kultur *</label>
      <select id="bg-kultur"><option value="">— Kultur wählen —</option>${kOpts}</select></div>
    <div class="section-label">Gewichte</div>
    <div class="gewicht-grid">
      <div class="form-group"><label>Vollgewicht (kg) *</label>
        <input type="text" inputmode="numeric" id="bg-voll" placeholder="24.500" style="font-size:20px;font-weight:700" oninput="bgFmtGewicht(this);bgUpdNetto()"></div>
      <div class="form-group"><label>Leergewicht (kg) *</label>
        <div style="display:flex;gap:6px">
          <input type="text" inputmode="numeric" id="bg-leer" placeholder="12.600" style="font-size:20px;font-weight:700;flex:1;min-width:0" oninput="bgFmtGewicht(this);bgUpdNetto()">
          <button type="button" onclick="openBgHaengerzug()" title="Hängerzug wählen – Tara übernehmen"
            style="flex-shrink:0;width:52px;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--radius-sm);font-size:22px;cursor:pointer">🚛</button>
        </div></div>
    </div>
    <div class="netto-display"><span class="netto-label">Netto</span><span class="netto-val" id="bg-netto">—</span><span class="netto-unit">kg</span></div>
    <div class="form-group"><label>TS-Gehalt % (optional)</label>
      <input type="number" id="bg-ts" step="0.1" min="0" max="100" placeholder="z.B. 32,5"></div>
    <button class="btn btn-green btn-full" id="bg-btn" onclick="bgFuhreSpeichern()">&#10003; Fuhre speichern</button>
  </div>`;
}

export async function bgFuhreSpeichern() {
  const lieferantId = parseInt(document.getElementById('bg-lieferant')?.value);
  if(!lieferantId) { alert('Bitte Lieferant wählen.'); return; }
  const kultur = document.getElementById('bg-kultur')?.value || '';
  if(!kultur) { alert('Bitte Kultur wählen.'); return; }
  const v = parseGewicht(document.getElementById('bg-voll')?.value);
  const l = parseGewicht(document.getElementById('bg-leer')?.value);
  if(!v || !l || v <= l) { alert('Bitte gültige Gewichte eingeben (Vollgew. > Leergew.).'); return; }
  const feldId = parseInt(document.getElementById('bg-feld')?.value) || null;
  const tsRaw = (document.getElementById('bg-ts')?.value || '').replace(',','.');
  const ts = tsRaw !== '' ? parseFloat(tsRaw) : null;
  if(ts != null && (isNaN(ts) || ts < 0 || ts > 100)) { alert('TS-Gehalt bitte zwischen 0 und 100 % angeben.'); return; }
  const btn = document.getElementById('bg-btn');
  if(btn) { btn.disabled = true; btn.textContent = 'Speichert…'; }
  try {
    const { data, error } = await sb.from('bg_fuhren').insert({
      lieferant_id: lieferantId, feld_id: feldId, kultur,
      vollgewicht: v, leergewicht: l, ts_gehalt: ts,
      abfahrer_id: bgState.currentUser?.id || null,
      erstellt_von: bgState.currentUser?.id || null,
      zeit: new Date().toISOString(),
    }).select().single();
    if(error) throw error;
    bgState.fuhren.unshift(data);
    const lName = bgState.lieferanten.find(x => x.id === lieferantId)?.name || '';
    showToast(`✓ ${data.nr} gespeichert · ${kg2t(v-l)} · ${escapeHtml(lName)}`);
    renderBgMain();
  } catch(e) {
    if(btn) { btn.disabled = false; btn.innerHTML = '&#10003; Fuhre speichern'; }
    showToast('⚠ ' + e.message, 'error');
  }
}

// ── Hängerzug-Auswahl (Tara antippen) ────────────────────────────────────────
export function openBgHaengerzug() {
  let ov = document.getElementById('bg-hz-overlay');
  if(!ov) { ov = document.createElement('div'); ov.id = 'bg-hz-overlay'; document.body.appendChild(ov); }
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:7000;display:flex;align-items:center;justify-content:center;padding:16px';
  const hz = bgState.haengerzuege;
  const rows = hz.length ? hz.map(h => `
    <button onclick="waehleBgHaengerzug(${h.id})"
      style="width:100%;display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--radius-md);padding:14px;cursor:pointer;margin-bottom:8px">
      <span style="font-size:16px;font-weight:700;color:var(--text)">🚛 ${escapeHtml(h.name)}</span>
      <span style="font-size:16px;font-weight:800;color:var(--gold)">${h.leergewicht_kg.toLocaleString('de-DE')} kg</span>
    </button>`).join('')
    : '<div class="empty-state">Noch keine Hängerzüge – unter „Stammdaten" anlegen.</div>';
  ov.innerHTML = `<div class="card" style="max-width:420px;width:100%;max-height:80vh;overflow:auto">
    <div class="card-header"><div>
      <div class="card-title">🚛 Hängerzug wählen</div>
      <div class="card-sub">Antippen übernimmt das Leergewicht</div></div>
      <button onclick="closeBgHaengerzug()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text2)">✕</button>
    </div>
    ${rows}
  </div>`;
}
export function closeBgHaengerzug() { document.getElementById('bg-hz-overlay')?.remove(); }
export function waehleBgHaengerzug(id) {
  const h = bgState.haengerzuege.find(x => x.id === id);
  const inp = document.getElementById('bg-leer');
  if(h && inp) { inp.value = h.leergewicht_kg.toLocaleString('de-DE'); bgUpdNetto(); showToast(`🚛 ${escapeHtml(h.name)} · ${h.leergewicht_kg.toLocaleString('de-DE')} kg übernommen`); }
  closeBgHaengerzug();
}
