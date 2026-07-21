import { state } from './state.js?v=57';
import { db } from './db.js?v=57';
import { showToast, roleLabel, hashPW } from './helpers.js?v=57';

let nutzerEditId = null;

export function renderAdminNutzer() {
  const userRows = state.users.map(u => {
    const isSelf = u.id === state.currentUser.id;
    const dotColor = u.role==='drescher'?'var(--amber)':u.role==='abfahrer'?'var(--blue)':'var(--gold)';
    return `<div style="border:1px solid var(--color-border);border-radius:var(--radius);padding:12px 14px;margin-bottom:6px;background:var(--color-surface);display:flex;align-items:center;gap:10px">
      <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0;display:inline-block"></span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500">${u.name}${isSelf?' <span style="font-size:10px;color:var(--text2)">(du)</span>':''}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${roleLabel(u.role)} · PW: ••••••••</div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        <button class="btn btn-sm btn-outline" onclick="nutzerEditStart(${u.id})">&#9998; Bearbeiten</button>
        ${!isSelf ? `<button class="btn btn-sm btn-red" onclick="nutzerLoeschen(${u.id})">&#10005;</button>` : ''}
      </div>
    </div>`;
  }).join('');

  const editForm = nutzerEditId !== null ? buildNutzerForm(nutzerEditId) : '';
  const newForm = nutzerEditId === null ? buildNutzerForm(null) : '';

  document.getElementById('admintab').innerHTML = `
    <div class="card">
      <div class="card-header">
        <div><div class="card-title">Neuen Nutzer anlegen</div></div>
      </div>
      ${newForm}
    </div>
    <div class="section-label">Bestehende Nutzer (${state.users.length})</div>
    ${userRows}
    ${editForm}`;
}

function buildNutzerForm(editId) {
  const u = editId ? state.users.find(x=>x.id===editId) : null;
  const title = u ? `Nutzer bearbeiten: ${u.name}` : '';
  const nameVal = u ? u.name : '';
  const roleVal = u ? u.role : 'drescher';
  const formId = u ? 'edit' : 'new';
  const roles = ['drescher','abfahrer','admin'].map(r =>
    `<option value="${r}" ${roleVal===r?'selected':''}>${roleLabel(r)}</option>`).join('');

  if(u) return `
    <div class="card" style="border-color:var(--gold);margin-top:12px">
      <div class="card-header"><div class="card-title" style="font-size:15px">${title}</div>
        <button class="btn btn-sm btn-outline" onclick="nutzerEditId=null;renderAdminNutzer()">&#10005; Abbrechen</button>
      </div>
      <div class="form-group"><label>Name</label>
        <input type="text" id="${formId}-name" value="${nameVal}" placeholder="Vor- und Nachname"></div>
      <div class="form-group"><label>Rolle</label>
        <select id="${formId}-role">${roles}</select></div>
      <div class="form-group"><label>Neues Passwort <span style="color:var(--text2);font-weight:400">(leer = unverändert)</span></label>
        <input type="text" id="${formId}-pw" placeholder="Leer lassen zum Beibehalten"></div>
      <button class="btn btn-primary btn-full" onclick="nutzerSpeichern(${editId})">&#10003; Änderungen speichern</button>
    </div>`;

  return `
    <div class="form-group"><label>Name</label>
      <input type="text" id="${formId}-name" placeholder="Vor- und Nachname"></div>
    <div class="form-group"><label>Rolle</label>
      <select id="${formId}-role">${roles}</select></div>
    <div class="form-group"><label>Passwort</label>
      <input type="text" id="${formId}-pw" placeholder="Passwort festlegen"></div>
    <button class="btn btn-green btn-full" onclick="nutzerAnlegen()">+ Nutzer anlegen</button>`;
}

export async function nutzerAnlegen() {
  const name = document.getElementById('new-name').value.trim();
  const role = document.getElementById('new-role').value;
  const pw = document.getElementById('new-pw').value.trim();
  if(!name) { alert('Bitte Name eingeben.'); return; }
  if(!pw) { alert('Bitte Passwort eingeben.'); return; }
  if(state.users.find(u=>u.name.toLowerCase()===name.toLowerCase())) {
    alert('Ein Nutzer mit diesem Namen existiert bereits.'); return;
  }
  const pwHash = await hashPW(name, pw);
  const newUser = { name, role, label:roleLabel(role), pw: pwHash };
  try {
    await db.upsertNutzer(newUser);
    state.users = await db.getNutzer();
    state.nextUserId = (state.users.length ? Math.max(...state.users.map(u=>u.id)) : 0) + 1;
    showToast('✓ Nutzer angelegt');
  } catch(e) {
    alert('Fehler: ' + e.message); return;
  }
  renderAdminNutzer();
  if(window.renderLogin) window.renderLogin();
}

export function nutzerEditStart(id) {
  nutzerEditId = id;
  renderAdminNutzer();
  setTimeout(()=>{ const el=document.getElementById('edit-name'); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); },50);
}

export async function nutzerSpeichern(id) {
  const u = state.users.find(x=>x.id===id);
  if(!u) return;
  const name = document.getElementById('edit-name').value.trim();
  const role = document.getElementById('edit-role').value;
  const pw = document.getElementById('edit-pw').value.trim();
  if(!name) { alert('Bitte Name eingeben.'); return; }
  if(state.users.find(x=>x.id!==id && x.name.toLowerCase()===name.toLowerCase())) {
    alert('Dieser Name ist bereits vergeben.'); return;
  }
  u.name = name; u.role = role; u.label = roleLabel(role);
  if(pw) u.pw = await hashPW(name, pw);
  try {
    await db.upsertNutzer(u);
    showToast('✓ Änderungen gespeichert');
  } catch(e) { showToast('⚠ Fehler: '+e.message, 'error'); }
  nutzerEditId = null;
  renderAdminNutzer();
  if(window.renderLogin) window.renderLogin();
}

export async function nutzerLoeschen(id) {
  const u = state.users.find(x=>x.id===id);
  if(!u) return;
  if(!confirm(`Nutzer "${u.name}" wirklich löschen?`)) return;
  try {
    await db.deleteNutzer(id);
    state.users = state.users.filter(x=>x.id!==id);
    showToast('✓ Nutzer gelöscht');
  } catch(e) { showToast('⚠ Fehler: '+e.message, 'error'); return; }
  renderAdminNutzer();
  if(window.renderLogin) window.renderLogin();
}
