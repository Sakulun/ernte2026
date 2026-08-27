import { state, loadAppData } from './state.js?v=126';
import { db, getSb } from './db.js?v=126';
import { hashPW, hashPWLegacy } from './helpers.js?v=126';

const _loginAttempts = {};

// Anmeldung per Benutzername-Eingabe (Liste entfällt): Felder leeren + fokussieren.
export function renderLogin() {
  const nameEl = document.getElementById('login-name');
  const pwEl = document.getElementById('login-pw');
  const errEl = document.getElementById('login-error');
  if(nameEl) nameEl.value = '';
  if(pwEl) pwEl.value = '';
  if(errEl) { errEl.style.display = 'none'; errEl.style.color = ''; }
  if(nameEl) setTimeout(() => nameEl.focus(), 80);
}

// Alt-Flow (Benutzerauswahl aus Liste) entfällt – Stubs für Kompatibilität der window-Registrierung.
export function selectLoginUser() {}
export function loginBack() {}

export function togglePw() {
  const inp = document.getElementById('login-pw');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

export async function doLogin() {
  const nameInput = (document.getElementById('login-name')?.value || '').trim();
  const pw = document.getElementById('login-pw').value;
  const errEl = document.getElementById('login-error');
  const zeigeFehler = (msg) => { errEl.style.color = 'var(--red)'; errEl.textContent = msg; errEl.style.display = 'block'; };
  if(!nameInput) { zeigeFehler('Bitte Benutzernamen eingeben.'); document.getElementById('login-name')?.focus(); return; }
  if(!pw) { zeigeFehler('Bitte Passwort eingeben.'); return; }
  // Benutzer anhand des eingegebenen Namens finden (Groß-/Kleinschreibung egal).
  const selectedUser = state.users.find(u => (u.name||'').trim().toLowerCase() === nameInput.toLowerCase());
  const name = selectedUser ? selectedUser.name : nameInput;
  const key = nameInput.toLowerCase();
  const now = Date.now();
  const attempt = _loginAttempts[key] || {count:0, until:0};
  if(attempt.until > now) {
    const mins = Math.ceil((attempt.until - now) / 60000);
    zeigeFehler(`Zu viele Versuche – bitte ${mins} Minute(n) warten.`);
    return;
  }
  // Unbekannter Benutzername → gleiche Meldung wie falsches Passwort (keine Preisgabe gültiger Namen).
  if(!selectedUser) {
    const att = _loginAttempts[key] || {count:0, until:0};
    att.count++;
    if(att.count >= 5) { att.until = Date.now() + 15*60*1000; att.count = 0; }
    _loginAttempts[key] = att;
    zeigeFehler('Benutzername oder Passwort falsch.');
    return;
  }
  try {
    const hashed = await hashPW(name, pw);
    const legacyHashed = await hashPWLegacy(pw);
    const result = await db.checkPassword(name, hashed, legacyHashed);
    if(!result) {
      const att = _loginAttempts[key] || {count:0, until:0};
      att.count++;
      if(att.count >= 5) { att.until = Date.now() + 15*60*1000; att.count = 0; }
      _loginAttempts[key] = att;
      zeigeFehler('Benutzername oder Passwort falsch.');
      return;
    }
    const user = state.users.find(u => u.id === result.id);
    if(!user) { zeigeFehler('Benutzer nicht gefunden.'); return; }
    delete _loginAttempts[key];

    // Supabase-Auth-Session aufbauen (RLS: Daten sind nur für angemeldete Nutzer
    // lesbar). Auth-Passwort = pw-Hash; check_password hat Legacy-Hashes bereits
    // auf das neue Format migriert, der Trigger hält das Auth-Konto synchron.
    const sb = getSb();
    try {
      let { error } = await sb.auth.signInWithPassword({ email: `n${result.id}@ernte2026.local`, password: hashed });
      if(error && legacyHashed) ({ error } = await sb.auth.signInWithPassword({ email: `n${result.id}@ernte2026.local`, password: legacyHashed }));
      if(error) console.warn('Auth-Session nicht aufgebaut (Übergangsmodus):', error.message);
    } catch(e) { console.warn('Auth-Session nicht aufgebaut (Übergangsmodus):', e); }

    // Login-Zeitpunkt merken – Abgleich mit einer späteren Zwangs-Abmeldung (Admin).
    try { localStorage.setItem('ernte_login_ts', String(Date.now())); } catch(e) {}

    errEl.style.display = 'block';
    errEl.style.color = 'var(--text2)';
    errEl.textContent = 'Lade Daten…';
    try { await loadAppData(); }
    catch(e) { errEl.style.color = ''; errEl.textContent = 'Daten konnten nicht geladen werden: ' + e.message; return; }
    errEl.style.display = 'none';
    errEl.style.color = '';
    loginUser(user);
  } catch(e) {
    errEl.style.display = 'block';
    errEl.textContent = 'Anmeldefehler: ' + e.message;
  }
}

export function loginUser(user) {
  state.currentUser = user;
  // Login-Zeit (Original, auch bei Session-Wiederherstellung aus localStorage).
  state.sessionStartMs = parseInt(localStorage.getItem('ernte_login_ts')) || Date.now();
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('active');
  const dc = user.role==='drescher'?'role-drescher':user.role==='abfahrer'?'role-abfahrer':'role-admin';
  document.getElementById('topbar-dot').className = 'dot '+dc;
  document.getElementById('topbar-name').textContent = user.name+' · '+user.label;
  document.getElementById('topbar-sync').style.display = 'inline-block';
  window.renderMain();
  // Waage = stationäres Terminal: kein GPS-Tracking, keine Benachrichtigungs-Prompts.
  const mobileRolle = user.role !== 'admin' && user.role !== 'waage';
  if(mobileRolle && window.shareUserGPS) window.shareUserGPS(user.id);
  if(window.initNachrichtenListener) window.initNachrichtenListener();
  if(mobileRolle && window.requestBrowserNotification) window.requestBrowserNotification();
  const nb = document.getElementById('topbar-nachricht-btn');
  const hb = document.getElementById('topbar-hilfe-btn');
  if(nb) nb.style.display = user.role === 'admin' ? 'block' : 'none';
  if(hb) hb.style.display = (user.role === 'drescher' || user.role === 'abfahrer') ? 'block' : 'none';
  if(window.checkShowOnboarding) window.checkShowOnboarding(user.role);
  if(user.role === 'admin' && window.innerWidth <= 1024 && window.innerWidth > 640) {
    window.sidebarCollapsed = true;
  }
}

export function logout() {
  try { const sb = getSb(); if(sb?.auth) sb.auth.signOut().catch(()=>{}); } catch(e) {}
  if(window.hideSiloOverlay) window.hideSiloOverlay();
  if(window.closeWaageErfassung) window.closeWaageErfassung();
  const _fab = document.getElementById('we-fab'); if(_fab) _fab.remove();
  if(window._gpsWatcher) { navigator.geolocation.clearWatch(window._gpsWatcher); window._gpsWatcher = null; }
  if(window.releaseWakeLock) window.releaseWakeLock();
  if(window._drescherMap){window._drescherMap.remove();window._drescherMap=null;}
  if(window._mapInstance){window._mapInstance.remove();window._mapInstance=null;}
  state.currentUser = null;
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').classList.remove('active');
}
