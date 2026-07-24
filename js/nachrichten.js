import { state } from './state.js?v=70';
import { sb } from './db.js?v=70';
import { showToast } from './helpers.js?v=70';

export async function adminSendNachricht(text, empfaenger='alle') {
  try {
    await sb.from('nachrichten').insert({
      text,
      empfaenger,
      von: state.currentUser.id,
      von_name: state.currentUser.name,
      gelesen: false,
      zeit: new Date().toISOString()
    });
    showToast('✓ Nachricht gesendet');
    document.getElementById('nachricht-input')?.value !== undefined &&
      (document.getElementById('nachricht-input').value = '');
    renderNachrichtenDialog();
  } catch(e) {
    showToast('⚠ Fehler: '+e.message, 'error');
  }
}

export function showNachrichtenDialog() {
  document.getElementById('nachricht-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'nachricht-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `
    <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:14px;padding:24px;width:100%;max-width:480px;box-shadow:var(--shadow);max-height:90vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-family:var(--serif);font-size:20px;color:var(--text)">📢 Nachricht senden</div>
        <button onclick="document.getElementById('nachricht-modal').remove()" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:18px">✕</button>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label>Empfänger</label>
        <select id="nachricht-empfaenger" class="form-control">
          <option value="alle">👥 Alle Fahrer</option>
          <option value="drescher">🌾 Nur Drescherfahrer</option>
          <option value="abfahrer">🚛 Nur Abfahrer</option>
          ${state.users.filter(u=>u.role==='drescher'||u.role==='abfahrer').map(u=>
            `<option value="${u.id}">${u.name} (${u.label})</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:8px">
        <label>Nachricht</label>
        <textarea id="nachricht-input" style="width:100%;background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;color:var(--text);padding:10px 12px;font-family:var(--mono);font-size:13px;resize:vertical;min-height:80px" placeholder="z.B. Kurze Pause – Schlag Pfingstwiese 1 ist fertig. Bitte weiterfahren zu..."></textarea>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
        <div style="font-size:11px;color:var(--text2);width:100%;margin-bottom:4px">Schnellnachrichten:</div>
        ${[
          '🛑 Kurze Pause – bitte warten',
          '✅ Schlag fertig – weiterfahren',
          '⛽ Tankstopp – 15 Minuten',
          '🌧 Wetterwarnung – Ernte pausiert',
          '🔧 Maschinenausfall – bitte Bescheid geben',
          '📍 Treffpunkt Hofeinfahrt'
        ].map(t=>`<button onclick="document.getElementById('nachricht-input').value='${t}'"
          style="background:var(--neutral-200);border:1px solid var(--color-border);color:var(--text);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:11px">${t}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" style="flex:1" onclick="adminSendNachricht(document.getElementById('nachricht-input').value, document.getElementById('nachricht-empfaenger').value)">
          📢 Jetzt senden
        </button>
        <button class="btn btn-outline" onclick="document.getElementById('nachricht-modal').remove()">Abbrechen</button>
      </div>
      <div id="nachricht-verlauf" style="margin-top:16px;border-top:1px solid var(--color-border);padding-top:12px">
        <div style="font-size:12px;color:var(--text2);margin-bottom:8px">Letzte Nachrichten</div>
        <div id="nachricht-liste" style="font-size:12px;color:var(--text2)">Lädt…</div>
      </div>
    </div>`;
  document.body.appendChild(m);
  loadNachrichtenVerlauf();
}

async function loadNachrichtenVerlauf() {
  try {
    const { data } = await sb.from('nachrichten').select('*').order('zeit', {ascending:false}).limit(5);
    const el = document.getElementById('nachricht-liste');
    if(!el) return;
    if(!data?.length) { el.textContent = 'Keine Nachrichten'; return; }
    el.innerHTML = data.map(n => `
      <div style="padding:8px 0;border-bottom:1px solid var(--color-border)">
        <div style="display:flex;justify-content:space-between;margin-bottom:2px">
          <span style="color:var(--text);font-weight:600">${n.text}</span>
          <span style="color:var(--text2);font-size:10px">${new Date(n.zeit).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        <div style="color:var(--text2);font-size:10px">→ ${n.empfaenger==='alle'?'Alle':n.empfaenger==='drescher'?'Drescher':n.empfaenger==='abfahrer'?'Abfahrer':'Einzeln'}</div>
      </div>`).join('');
  } catch(e) {}
}

export function renderNachrichtenDialog() {
  loadNachrichtenVerlauf();
}

export function initNachrichtenListener() {
  sb.channel('nachrichten-'+Math.random().toString(36).slice(2))
    .on('postgres_changes', {event:'INSERT', schema:'public', table:'nachrichten'}, (payload) => {
      const n = payload.new;
      if(!state.currentUser) return;
      const uid = state.currentUser.id;
      const role = state.currentUser.role;
      const relevant = n.empfaenger === 'alle'
        || n.empfaenger === role
        || n.empfaenger == uid;
      if(!relevant) return;
      showNachrichtBanner(n.text, n.von_name);
      if(Notification.permission === 'granted') {
        new Notification('📢 Ernte 2026 – ' + n.von_name, {
          body: n.text,
          icon: '/ernteneu/icon.svg',
          tag: 'ernte-nachricht'
        });
      }
    })
    .subscribe();
}

export function showNachrichtBanner(text, vonName) {
  document.getElementById('nachricht-banner')?.remove();
  const b = document.createElement('div');
  b.id = 'nachricht-banner';
  b.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:8000;background:var(--color-surface);border:none;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.15);padding:14px 20px;box-shadow:0 8px 32px rgba(0,0,0,0.5);width:calc(100vw - 32px);max-width:480px;animation:ob-slide-in 0.3s ease forwards;display:flex;align-items:flex-start;gap:12px';
  b.innerHTML = `
    <span style="font-size:24px;flex-shrink:0">📢</span>
    <div style="flex:1">
      <div style="font-size:11px;color:var(--text2);margin-bottom:3px">Nachricht von ${vonName}</div>
      <div style="font-size:14px;font-weight:600;color:var(--text)">${text}</div>
    </div>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:16px;flex-shrink:0">✕</button>`;
  document.body.appendChild(b);
}

export async function requestBrowserNotification() {
  if('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}
