import { SB_URL, SB_KEY } from './config.js?v=123';
import { renderBgErfassen, bgFuhreSpeichern, bgLieferantWahl, bgUpdNetto, bgFmtGewicht,
         openBgHaengerzug, closeBgHaengerzug, waehleBgHaengerzug } from './bg-erfassung.js?v=123';
import { renderBgUebersicht, bgFuhreLoeschen, toggleBgLieferant, exportBgExcel, exportBgCSV,
         renderBgMeineFuhren } from './bg-auswertung.js?v=123';
import { renderBgStammdaten, bgLieferantSpeichern, bgLieferantToggle, bgFeldSpeichern, bgFeldLoeschen,
         bgKulturSpeichern, bgKulturToggle,
         bgHzSpeichern, bgHzLoeschen, bgNutzerSpeichern, bgNutzerLoeschen, setBgStammTab } from './bg-stammdaten.js?v=123';

// ── Biogas-App (Biomasse-Erfassung, Anlage Bayern) ───────────────────────────
// Eigenständiger Einstieg (biogas/index.html) mit eigenem, schlankem Modulsatz.
// Teilt sich Supabase-Projekt + nutzer-Tabelle mit der Ernte-App: Biogas-Nutzer
// haben nutzer.profil='biogas' (Login via check_password_bg), Daten liegen in
// eigenen bg_*-Tabellen. Kein Realtime – Daten werden nach Aktionen neu geladen.

export let sb = null;
export const bgState = {
  currentUser: null,
  users: [],           // nur profil='biogas'
  lieferanten: [],
  felder: [],
  kulturen: [],        // bg_kulturen: vom Admin pflegbar (aktiv/inaktiv)
  haengerzuege: [],
  fuhren: [],
};

// ── kleine Helfer (bewusst lokal, um den Ernte-Modulgraphen nicht mitzuziehen) ─
export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
export function showToast(msg, typ) {
  const t = document.getElementById('toast');
  if(!t) return;
  t.innerHTML = msg;
  t.className = typ === 'error' ? 'error' : '';
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 3200);
}
export const kg2t = kg => (kg/1000).toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' t';
export const fmtDatum = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'}) + ' ' + d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}); };
export const nettoVon = f => (f.vollgewicht && f.leergewicht && f.vollgewicht > f.leergewicht) ? f.vollgewicht - f.leergewicht : 0;

async function hashPW(name, pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name.toLowerCase() + ':' + pw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ── Datenzugriff ─────────────────────────────────────────────────────────────
export const bgDb = {
  async ladeNutzer() {
    const { data, error } = await sb.from('nutzer_public').select('*').eq('profil','biogas').order('id');
    if(error) throw error;
    return (data||[]).map(u => ({ id: u.id, name: u.name, role: u.rolle }));
  },
  async ladeAlles() {
    const [l, f, k, h, fu] = await Promise.all([
      sb.from('bg_lieferanten').select('*').order('name'),
      sb.from('bg_felder').select('*').order('name'),
      sb.from('bg_kulturen').select('*').order('id'),
      sb.from('bg_haengerzuege').select('*').order('name'),
      sb.from('bg_fuhren').select('*').order('zeit', {ascending:false}),
    ]);
    for(const r of [l,f,k,h,fu]) if(r.error) throw r.error;
    bgState.lieferanten  = l.data || [];
    bgState.felder       = f.data || [];
    bgState.kulturen     = k.data || [];
    bgState.haengerzuege = h.data || [];
    bgState.fuhren       = fu.data || [];
  },
};

// ── Login / Logout ───────────────────────────────────────────────────────────
export async function doLogin() {
  const name = (document.getElementById('login-name')?.value || '').trim();
  const pw = document.getElementById('login-pw')?.value || '';
  const errEl = document.getElementById('login-error');
  const fehler = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };
  if(!name || !pw) { fehler('Bitte Name und Passwort eingeben.'); return; }
  try {
    const hashed = await hashPW(name, pw);
    const { data: result, error } = await sb.rpc('check_password_bg', { p_name: name, p_hash: hashed, p_legacy_hash: null });
    if(error) throw error;
    if(!result) { fehler('Benutzername oder Passwort falsch.'); return; }
    // Auth-Session (RLS) – Auth-Konto pflegt der DB-Trigger, Passwort = pw-Hash.
    try {
      const { error: aerr } = await sb.auth.signInWithPassword({ email: `n${result.id}@ernte2026.local`, password: hashed });
      if(aerr) console.warn('Auth-Session nicht aufgebaut:', aerr.message);
    } catch(e) { console.warn('Auth-Session nicht aufgebaut:', e); }
    errEl.style.display = 'block'; errEl.style.color = 'var(--text2)'; errEl.textContent = 'Lade Daten…';
    bgState.users = await bgDb.ladeNutzer();
    await bgDb.ladeAlles();
    errEl.style.display = 'none'; errEl.style.color = '';
    bgState.currentUser = bgState.users.find(u => u.id === result.id) || { id: result.id, name: result.name, role: result.rolle };
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').classList.add('active');
    document.getElementById('topbar-name').textContent = bgState.currentUser.name + ' · ' + (bgState.currentUser.role === 'admin' ? 'Verwaltung' : 'Fahrer');
    renderBgMain();
  } catch(e) {
    errEl.style.color = 'var(--red)';
    fehler('Anmeldefehler: ' + e.message);
  }
}

export function doLogout() {
  try { sb?.auth?.signOut().catch(()=>{}); } catch(e) {}
  bgState.currentUser = null;
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').classList.remove('active');
  const pw = document.getElementById('login-pw'); if(pw) pw.value = '';
}

// ── Tab-Shell ────────────────────────────────────────────────────────────────
let bgTab = 'erfassen';
export function setBgTab(t) { bgTab = t; renderBgMain(); }

export function renderBgMain() {
  const admin = bgState.currentUser?.role === 'admin';
  const tabs = admin
    ? [['erfassen','⚖ Erfassen'], ['uebersicht','📊 Übersicht'], ['stamm','⚙ Stammdaten']]
    : [['erfassen','⚖ Erfassen'], ['meine','🚛 Meine Fuhren']];
  if(!tabs.some(t => t[0] === bgTab)) bgTab = 'erfassen';
  document.getElementById('bg-tabs').innerHTML = tabs.map(([id,label]) =>
    `<button class="tab ${bgTab===id?'active':''}" onclick="setBgTab('${id}')">${label}</button>`).join('');
  const el = document.getElementById('main-content');
  if(bgTab === 'uebersicht') renderBgUebersicht(el);
  else if(bgTab === 'stamm') renderBgStammdaten(el);
  else if(bgTab === 'meine') renderBgMeineFuhren(el);
  else renderBgErfassen(el);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
function initSupabase() {
  if(typeof supabase !== 'undefined' && supabase.createClient) {
    sb = supabase.createClient(SB_URL, SB_KEY);
  } else {
    setTimeout(initSupabase, 50);
  }
}
initSupabase();

Object.assign(window, {
  doLogin, doLogout, setBgTab, renderBgMain,
  renderBgErfassen, bgFuhreSpeichern, bgLieferantWahl, bgUpdNetto, bgFmtGewicht,
  openBgHaengerzug, closeBgHaengerzug, waehleBgHaengerzug,
  renderBgUebersicht, bgFuhreLoeschen, toggleBgLieferant, exportBgExcel, exportBgCSV, renderBgMeineFuhren,
  renderBgStammdaten, bgLieferantSpeichern, bgLieferantToggle, bgFeldSpeichern, bgFeldLoeschen,
  bgKulturSpeichern, bgKulturToggle,
  bgHzSpeichern, bgHzLoeschen, bgNutzerSpeichern, bgNutzerLoeschen, setBgStammTab,
});
