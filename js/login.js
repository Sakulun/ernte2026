import { state, loadAppData } from './state.js?v=58';
import { db, getSb } from './db.js?v=58';
import { hashPW, hashPWLegacy } from './helpers.js?v=58';

const _loginAttempts = {};

export function renderLogin() {
  const ul = document.getElementById('user-list');
  if(!ul) return;
  ul.innerHTML = '';
  state.users.forEach(u => {
    const btn = document.createElement('button');
    btn.className = 'user-btn';
    const dc = u.role==='drescher'?'role-drescher':u.role==='abfahrer'?'role-abfahrer':'role-admin';
    const rl = u.role==='drescher'?'Drescherfahrer':u.role==='abfahrer'?'Abfahrer / Waage':u.role==='silomeister'?'Silomeister':'Admin / Übersicht';
    btn.innerHTML = `<span class="role-dot ${dc}"></span><span class="uname" style="flex:1">${u.name}</span><span class="urole">${rl}</span>`;
    btn.onclick = () => selectLoginUser(u);
    ul.appendChild(btn);
  });
}

export function selectLoginUser(u) {
  const dc = u.role==='drescher'?'role-drescher':u.role==='abfahrer'?'role-abfahrer':'role-admin';
  const rl = u.role==='drescher'?'Drescherfahrer':u.role==='abfahrer'?'Abfahrer / Waage':u.role==='silomeister'?'Silomeister':'Admin / Übersicht';
  document.getElementById('login-selected-name').textContent = u.name;
  document.getElementById('login-selected-role').textContent = rl;
  document.getElementById('login-selected-dot').className = 'role-dot ' + dc;
  document.getElementById('login-step-user').style.display = 'none';
  document.getElementById('login-step-pw').style.display = '';
  document.getElementById('login-pw').value = '';
  document.getElementById('login-error').style.display = 'none';
  window._loginSelectedUser = u;
  setTimeout(() => document.getElementById('login-pw').focus(), 80);
}

export function loginBack() {
  window._loginSelectedUser = null;
  document.getElementById('login-step-pw').style.display = 'none';
  document.getElementById('login-step-user').style.display = '';
  document.getElementById('login-error').style.display = 'none';
}

export function togglePw() {
  const inp = document.getElementById('login-pw');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

export async function doLogin() {
  const selectedUser = window._loginSelectedUser;
  const pw = document.getElementById('login-pw').value;
  const errEl = document.getElementById('login-error');
  if(!selectedUser) return;
  if(!pw) { errEl.textContent = 'Bitte Passwort eingeben.'; errEl.style.display = 'block'; return; }
  const name = selectedUser.name;
  const now = Date.now();
  const attempt = _loginAttempts[name.toLowerCase()] || {count:0, until:0};
  if(attempt.until > now) {
    const mins = Math.ceil((attempt.until - now) / 60000);
    errEl.style.display = 'block';
    errEl.textContent = `Zu viele Versuche – bitte ${mins} Minute(n) warten.`;
    return;
  }
  try {
    const hashed = await hashPW(name, pw);
    const legacyHashed = await hashPWLegacy(pw);
    const result = await db.checkPassword(name, hashed, legacyHashed);
    if(!result) {
      const att = _loginAttempts[name.toLowerCase()] || {count:0, until:0};
      att.count++;
      if(att.count >= 5) { att.until = Date.now() + 15*60*1000; att.count = 0; }
      _loginAttempts[name.toLowerCase()] = att;
      errEl.style.display = 'block';
      errEl.textContent = 'Passwort falsch.';
      return;
    }
    const user = state.users.find(u => u.id === result.id);
    if(!user) { errEl.style.display = 'block'; errEl.textContent = 'Benutzer nicht gefunden.'; return; }
    delete _loginAttempts[name.toLowerCase()];

    // Supabase-Auth-Session aufbauen (RLS: Daten sind nur für angemeldete Nutzer
    // lesbar). Auth-Passwort = pw-Hash; check_password hat Legacy-Hashes bereits
    // auf das neue Format migriert, der Trigger hält das Auth-Konto synchron.
    const sb = getSb();
    try {
      let { error } = await sb.auth.signInWithPassword({ email: `n${result.id}@ernte2026.local`, password: hashed });
      if(error && legacyHashed) ({ error } = await sb.auth.signInWithPassword({ email: `n${result.id}@ernte2026.local`, password: legacyHashed }));
      if(error) console.warn('Auth-Session nicht aufgebaut (Übergangsmodus):', error.message);
    } catch(e) { console.warn('Auth-Session nicht aufgebaut (Übergangsmodus):', e); }

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
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('active');
  const dc = user.role==='drescher'?'role-drescher':user.role==='abfahrer'?'role-abfahrer':'role-admin';
  document.getElementById('topbar-dot').className = 'dot '+dc;
  document.getElementById('topbar-name').textContent = user.name+' · '+user.label;
  document.getElementById('topbar-sync').style.display = 'inline-block';
  window.renderMain();
  if(user.role !== "admin" && window.shareUserGPS) window.shareUserGPS(user.id);
  if(window.initNachrichtenListener) window.initNachrichtenListener();
  if(user.role !== 'admin' && window.requestBrowserNotification) window.requestBrowserNotification();
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
