import { sb, bgState, bgDb, escapeHtml, showToast, renderBgMain } from './bg-app.js?v=122';

// ── Stammdaten (nur Admin): Lieferanten, Schläge, Hängerzüge, Nutzer ─────────

let _stammTab = 'lieferanten';
export function setBgStammTab(t) { _stammTab = t; renderBgMain(); }

async function hashPW(name, pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name.toLowerCase() + ':' + pw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

export function renderBgStammdaten(el) {
  if(bgState.currentUser?.role !== 'admin') { el.innerHTML = '<div class="empty-state">Nur für die Verwaltung.</div>'; return; }
  const tabs = [['lieferanten','Lieferanten'],['felder','Schläge'],['kulturen','Kulturen'],['hz','Hängerzüge'],['nutzer','Nutzer']];
  const tabBar = `<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">${tabs.map(([id,label]) =>
    `<button class="btn btn-sm ${_stammTab===id?'btn-green':'btn-outline'}" onclick="setBgStammTab('${id}')">${label}</button>`).join('')}</div>`;
  let inhalt = '';
  if(_stammTab === 'felder') inhalt = felderHTML();
  else if(_stammTab === 'kulturen') inhalt = kulturenHTML();
  else if(_stammTab === 'hz') inhalt = hzHTML();
  else if(_stammTab === 'nutzer') inhalt = nutzerHTML();
  else inhalt = lieferantenHTML();
  el.innerHTML = tabBar + inhalt;
}

// ── Lieferanten ──────────────────────────────────────────────────────────────
function lieferantenHTML() {
  const rows = bgState.lieferanten.map(l => `
    <div class="fuhre-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px;${l.aktiv?'':'opacity:.5'}">
      <span style="font-weight:700">${escapeHtml(l.name)}${l.aktiv?'':' <span style="font-size:10px;color:var(--text3)">(inaktiv)</span>'}</span>
      <button class="btn btn-sm btn-outline" onclick="bgLieferantToggle(${l.id})">${l.aktiv?'Deaktivieren':'Aktivieren'}</button>
    </div>`).join('');
  return `<div class="card">
    <div class="card-title" style="margin-bottom:10px">Biomasse-Lieferanten</div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <input id="bg-neu-lieferant" placeholder="Name des Lieferanten" style="flex:1">
      <button class="btn btn-green" onclick="bgLieferantSpeichern()">+ Anlegen</button>
    </div>
    ${rows || '<div class="empty-state">Noch keine Lieferanten.</div>'}
  </div>`;
}
export async function bgLieferantSpeichern() {
  const name = (document.getElementById('bg-neu-lieferant')?.value || '').trim();
  if(!name) { showToast('Bitte Namen eingeben', 'error'); return; }
  try {
    const { data, error } = await sb.from('bg_lieferanten').insert({ name }).select().single();
    if(error) throw error;
    bgState.lieferanten.push(data);
    bgState.lieferanten.sort((a,b) => a.name.localeCompare(b.name,'de'));
    showToast('✓ Lieferant angelegt');
    renderBgMain();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}
export async function bgLieferantToggle(id) {
  const l = bgState.lieferanten.find(x => x.id === id);
  if(!l) return;
  try {
    const { error } = await sb.from('bg_lieferanten').update({ aktiv: !l.aktiv }).eq('id', id);
    if(error) throw error;
    l.aktiv = !l.aktiv;
    renderBgMain();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}

// ── Schläge ──────────────────────────────────────────────────────────────────
function felderHTML() {
  const lOpts = bgState.lieferanten.filter(l=>l.aktiv).map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
  const rows = bgState.felder.map(f => {
    const ln = f.lieferant_id ? (bgState.lieferanten.find(l => l.id === f.lieferant_id)?.name || '') : '';
    return `<div class="fuhre-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span><b>${escapeHtml(f.name)}</b>${ln?` <span style="font-size:11px;color:var(--text3)">· ${escapeHtml(ln)}</span>`:' <span style="font-size:11px;color:var(--text3)">· alle Lieferanten</span>'}</span>
      <button class="btn btn-sm btn-outline" style="color:var(--red)" onclick="bgFeldLoeschen(${f.id})">🗑</button>
    </div>`;
  }).join('');
  return `<div class="card">
    <div class="card-title" style="margin-bottom:4px">Schläge</div>
    <div class="card-sub" style="margin-bottom:10px">Einfache Namensliste – optional einem Lieferanten zugeordnet.</div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <input id="bg-neu-feld" placeholder="Schlagname" style="flex:2;min-width:140px">
      <select id="bg-neu-feld-lieferant" style="flex:1;min-width:130px"><option value="">– alle –</option>${lOpts}</select>
      <button class="btn btn-green" onclick="bgFeldSpeichern()">+ Anlegen</button>
    </div>
    ${rows || '<div class="empty-state">Noch keine Schläge.</div>'}
  </div>`;
}
export async function bgFeldSpeichern() {
  const name = (document.getElementById('bg-neu-feld')?.value || '').trim();
  if(!name) { showToast('Bitte Schlagnamen eingeben', 'error'); return; }
  const lieferantId = parseInt(document.getElementById('bg-neu-feld-lieferant')?.value) || null;
  try {
    const { data, error } = await sb.from('bg_felder').insert({ name, lieferant_id: lieferantId }).select().single();
    if(error) throw error;
    bgState.felder.push(data);
    bgState.felder.sort((a,b) => a.name.localeCompare(b.name,'de'));
    showToast('✓ Schlag angelegt');
    renderBgMain();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}
export async function bgFeldLoeschen(id) {
  const f = bgState.felder.find(x => x.id === id);
  if(!f) return;
  if(!confirm(`Schlag „${f.name}" löschen? (Fuhren behalten ihre Daten, verlieren nur die Schlag-Zuordnung)`)) return;
  try {
    const { error } = await sb.from('bg_felder').delete().eq('id', id);
    if(error) throw error;
    bgState.felder = bgState.felder.filter(x => x.id !== id);
    showToast('🗑 Schlag gelöscht');
    renderBgMain();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}

// ── Kulturen ─────────────────────────────────────────────────────────────────
// Vom Admin pflegbar; inaktive Kulturen erscheinen nicht mehr in der Erfassung.
// Bestehende Fuhren behalten ihre Kultur (Text) auch nach dem Deaktivieren.
function kulturenHTML() {
  const rows = bgState.kulturen.map(k => `
    <div class="fuhre-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px;${k.aktiv?'':'opacity:.5'}">
      <span style="font-weight:700">${escapeHtml(k.name)}${k.aktiv?'':' <span style="font-size:10px;color:var(--text3)">(inaktiv)</span>'}</span>
      <button class="btn btn-sm btn-outline" onclick="bgKulturToggle(${k.id})">${k.aktiv?'Deaktivieren':'Aktivieren'}</button>
    </div>`).join('');
  return `<div class="card">
    <div class="card-title" style="margin-bottom:4px">Kulturen</div>
    <div class="card-sub" style="margin-bottom:10px">Inaktive Kulturen sind bei der Erfassung nicht wählbar; alte Fuhren bleiben unverändert.</div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <input id="bg-neu-kultur" placeholder="Name der Kultur (z.B. Zuckerrüben)" style="flex:1">
      <button class="btn btn-green" onclick="bgKulturSpeichern()">+ Anlegen</button>
    </div>
    ${rows || '<div class="empty-state">Noch keine Kulturen.</div>'}
  </div>`;
}
export async function bgKulturSpeichern() {
  const name = (document.getElementById('bg-neu-kultur')?.value || '').trim();
  if(!name) { showToast('Bitte Namen eingeben', 'error'); return; }
  if(bgState.kulturen.some(k => k.name.toLowerCase() === name.toLowerCase())) { showToast('Kultur existiert bereits', 'error'); return; }
  try {
    const { data, error } = await sb.from('bg_kulturen').insert({ name }).select().single();
    if(error) throw error;
    bgState.kulturen.push(data);
    showToast('✓ Kultur angelegt');
    renderBgMain();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}
export async function bgKulturToggle(id) {
  const k = bgState.kulturen.find(x => x.id === id);
  if(!k) return;
  try {
    const { error } = await sb.from('bg_kulturen').update({ aktiv: !k.aktiv }).eq('id', id);
    if(error) throw error;
    k.aktiv = !k.aktiv;
    renderBgMain();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}

// ── Hängerzüge ───────────────────────────────────────────────────────────────
function hzHTML() {
  const rows = bgState.haengerzuege.map(h => `
    <div class="fuhre-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span><b>🚛 ${escapeHtml(h.name)}</b> <span style="color:var(--gold);font-weight:700">${h.leergewicht_kg.toLocaleString('de-DE')} kg</span></span>
      <button class="btn btn-sm btn-outline" style="color:var(--red)" onclick="bgHzLoeschen(${h.id})">🗑</button>
    </div>`).join('');
  return `<div class="card">
    <div class="card-title" style="margin-bottom:4px">Hängerzüge</div>
    <div class="card-sub" style="margin-bottom:10px">Feste Leergewichte – beim Erfassen per Antippen übernehmen.</div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <input id="bg-neu-hz-name" placeholder="Name (z.B. Fendt + Krampe)" style="flex:2;min-width:140px">
      <input id="bg-neu-hz-kg" type="number" inputmode="numeric" placeholder="Leergew. kg" style="flex:1;min-width:110px">
      <button class="btn btn-green" onclick="bgHzSpeichern()">+ Anlegen</button>
    </div>
    ${rows || '<div class="empty-state">Noch keine Hängerzüge.</div>'}
  </div>`;
}
export async function bgHzSpeichern() {
  const name = (document.getElementById('bg-neu-hz-name')?.value || '').trim();
  const kg = parseInt(document.getElementById('bg-neu-hz-kg')?.value);
  if(!name || !kg || kg <= 0) { showToast('Bitte Name und Leergewicht angeben', 'error'); return; }
  try {
    const { data, error } = await sb.from('bg_haengerzuege').insert({ name, leergewicht_kg: kg }).select().single();
    if(error) throw error;
    bgState.haengerzuege.push(data);
    showToast('✓ Hängerzug angelegt');
    renderBgMain();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}
export async function bgHzLoeschen(id) {
  const h = bgState.haengerzuege.find(x => x.id === id);
  if(!h) return;
  if(!confirm(`Hängerzug „${h.name}" (${h.leergewicht_kg.toLocaleString('de-DE')} kg) löschen?`)) return;
  try {
    const { error } = await sb.from('bg_haengerzuege').delete().eq('id', id);
    if(error) throw error;
    bgState.haengerzuege = bgState.haengerzuege.filter(x => x.id !== id);
    showToast('🗑 Hängerzug gelöscht');
    renderBgMain();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}

// ── Nutzer (profil='biogas') ─────────────────────────────────────────────────
function nutzerHTML() {
  const rows = bgState.users.map(u => `
    <div class="fuhre-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span><b>${escapeHtml(u.name)}</b> <span style="font-size:11px;color:var(--text3)">· ${u.role === 'admin' ? 'Verwaltung' : 'Fahrer'}</span></span>
      ${u.id === bgState.currentUser?.id ? '<span style="font-size:10px;color:var(--text3)">(du)</span>'
        : `<button class="btn btn-sm btn-outline" style="color:var(--red)" onclick="bgNutzerLoeschen(${u.id})">🗑</button>`}
    </div>`).join('');
  return `<div class="card">
    <div class="card-title" style="margin-bottom:4px">Nutzer</div>
    <div class="card-sub" style="margin-bottom:10px">Eigene Konten für die Biogas-App (getrennt von der Ernte-App).</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
      <input id="bg-neu-nutzer-name" placeholder="Name">
      <input id="bg-neu-nutzer-pw" type="password" placeholder="Passwort" autocomplete="new-password">
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <select id="bg-neu-nutzer-rolle" style="flex:1">
        <option value="abfahrer">Fahrer</option>
        <option value="admin">Verwaltung (Admin)</option>
      </select>
      <button class="btn btn-green" onclick="bgNutzerSpeichern()">+ Anlegen</button>
    </div>
    ${rows || '<div class="empty-state">Noch keine Nutzer.</div>'}
  </div>`;
}
export async function bgNutzerSpeichern() {
  const name = (document.getElementById('bg-neu-nutzer-name')?.value || '').trim();
  const pw = document.getElementById('bg-neu-nutzer-pw')?.value || '';
  const rolle = document.getElementById('bg-neu-nutzer-rolle')?.value || 'abfahrer';
  if(!name || pw.length < 4) { showToast('Bitte Name und Passwort (min. 4 Zeichen) angeben', 'error'); return; }
  try {
    const hashed = await hashPW(name, pw);
    const { error } = await sb.rpc('admin_create_nutzer_bg', { p_name: name, p_rolle: rolle, p_pw: hashed });
    if(error) throw error;
    bgState.users = await bgDb.ladeNutzer();
    showToast('✓ Nutzer angelegt');
    renderBgMain();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}
export async function bgNutzerLoeschen(id) {
  const u = bgState.users.find(x => x.id === id);
  if(!u) return;
  if(!confirm(`Nutzer „${u.name}" löschen?`)) return;
  try {
    const { error } = await sb.rpc('admin_delete_nutzer', { p_id: id });
    if(error) throw error;
    bgState.users = bgState.users.filter(x => x.id !== id);
    showToast('🗑 Nutzer gelöscht');
    renderBgMain();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}
