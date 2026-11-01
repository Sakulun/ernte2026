import { state } from './state.js?v=159';
import { db } from './db.js?v=159';
import { showToast, hashPW, escapeHtml } from './helpers.js?v=159';
import { NAV, FAHRER_ANSICHTEN, WEITERE_RECHTE, fahrerLabel } from './rechte.js?v=159';

let nutzerEditId = null;

// Schaltergruppen im Nutzerfenster: Fahrer-Ansichten, die Sidebar-Abschnitte, zuletzt die weiteren Rechte.
function rechteGruppen() {
  return [
    { titel: 'Fahrer-Ansichten', rechte: FAHRER_ANSICHTEN },
    ...NAV.map(g => ({ titel: g.section || 'Waage', rechte: g.items.map(([tab,,label]) => [tab, label.replace(/&shy;/g,'')]) })),
    { titel: 'Weitere Rechte', rechte: WEITERE_RECHTE },
  ];
}
const alleRechte = () => rechteGruppen().flatMap(g => g.rechte);

function rechteKurz(u) {
  const namen = alleRechte().filter(([r]) => (u.rechte||[]).includes(r)).map(([,label]) => label);
  if(!namen.length) return 'Keine Bereiche freigegeben';
  return namen.length > 4 ? `${namen.length} von ${alleRechte().length} Bereichen` : namen.join(', ');
}

export function renderAdminNutzer() {
  const userRows = state.users.map(u => {
    const isSelf = u.id === state.currentUser.id;
    const dotColor = u.rechte.includes('drescher')?'var(--amber)':u.rechte.includes('abfahrer')?'var(--blue)':'var(--gold)';
    return `<div style="border:1px solid var(--color-border);border-radius:var(--radius);padding:12px 14px;margin-bottom:6px;background:var(--color-surface);display:flex;align-items:center;gap:10px">
      <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0;display:inline-block"></span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500">${escapeHtml(u.name)}${isSelf?' <span style="font-size:10px;color:var(--text2)">(du)</span>':''}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${escapeHtml(rechteKurz(u))} · PW: ••••••••</div>
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
    ${editForm}
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--color-border)">
      <button class="btn btn-outline" style="border-color:var(--red);color:var(--red)" onclick="alleAbmelden()">🚪 Alle Benutzer abmelden</button>
      <div style="font-size:11px;color:var(--text2);margin-top:6px">Beendet alle aktiven Sitzungen – auch deine. Jeder muss sich danach neu anmelden.</div>
    </div>`;
}

// Zwangs-Abmeldung aller Benutzer: setzt den Marker in app_control; jeder Client
// (auch der eigene) meldet sich über die Realtime-/Boot-Prüfung selbst ab.
export async function alleAbmelden() {
  if(!confirm('Alle Benutzer werden abgemeldet und müssen sich neu anmelden – auch du.\n\nFortfahren?')) return;
  try {
    await db.setForceLogoutNow();
    showToast('✓ Alle Benutzer werden abgemeldet');
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}

// Das eigene Recht auf die Nutzerverwaltung lässt sich nicht abschalten (Datenbank prüft das ebenso).
function istGesperrt(recht, u) { return recht === 'nutzer' && u && u.id === state.currentUser.id; }

function rechteSchalter(formId, u) {
  const rechte = u ? u.rechte : [];
  const gruppen = rechteGruppen().map(g => `
    <div class="recht-gruppe">${escapeHtml(g.titel)}</div>
    <div class="recht-raster">
      ${g.rechte.map(([recht, label]) => {
        const gesperrt = istGesperrt(recht, u);
        return `<label class="recht-schalter${gesperrt?' gesperrt':''}"${gesperrt?' title="Das eigene Recht auf die Nutzerverwaltung kann nur ein anderer Nutzer entziehen."':''}>
          <input type="checkbox" data-recht="${recht}" ${rechte.includes(recht)?'checked':''} ${gesperrt?'disabled':''}>
          <span class="recht-regler"></span><span>${escapeHtml(label)}</span>
        </label>`;
      }).join('')}
    </div>`).join('');
  const vorlagen = state.users.filter(x => !u || x.id !== u.id)
    .map(x => `<option value="${x.id}">${escapeHtml(x.name)} (${escapeHtml(fahrerLabel(x))})</option>`).join('');
  return `<div class="form-group"><label>Programmbereiche</label>
      <select onchange="nutzerRechteWie('${formId}', this.value)"><option value="">Rechte übernehmen von …</option>${vorlagen}</select>
    </div>
    <div id="${formId}-rechte" style="margin-bottom:14px">${gruppen}</div>`;
}

function leseRechte(formId) {
  return [...document.querySelectorAll(`#${formId}-rechte input[data-recht]:checked`)].map(i => i.dataset.recht);
}

export function nutzerRechteWie(formId, vorlageId) {
  const vorlage = state.users.find(x => x.id === parseInt(vorlageId));
  if(!vorlage) return;
  document.querySelectorAll(`#${formId}-rechte input[data-recht]:not(:disabled)`).forEach(i => {
    i.checked = vorlage.rechte.includes(i.dataset.recht);
  });
}

function buildNutzerForm(editId) {
  const u = editId ? state.users.find(x=>x.id===editId) : null;
  const formId = u ? 'edit' : 'new';

  if(u) return `
    <div class="card" style="border-color:var(--gold);margin-top:12px">
      <div class="card-header"><div class="card-title" style="font-size:15px">Nutzer bearbeiten: ${escapeHtml(u.name)}</div>
        <button class="btn btn-sm btn-outline" onclick="nutzerEditAbbruch()">&#10005; Abbrechen</button>
      </div>
      <div class="form-group"><label>Name</label>
        <input type="text" id="${formId}-name" value="${escapeHtml(u.name)}" placeholder="Vor- und Nachname"></div>
      ${rechteSchalter(formId, u)}
      <div class="form-group"><label>Neues Passwort <span style="color:var(--text2);font-weight:400">(leer = unverändert)</span></label>
        <input type="text" id="${formId}-pw" placeholder="Leer lassen zum Beibehalten"></div>
      <button class="btn btn-primary btn-full" onclick="nutzerSpeichern(${editId})">&#10003; Änderungen speichern</button>
    </div>`;

  return `
    <div class="form-group"><label>Name</label>
      <input type="text" id="${formId}-name" placeholder="Vor- und Nachname"></div>
    ${rechteSchalter(formId, null)}
    <div class="form-group"><label>Passwort</label>
      <input type="text" id="${formId}-pw" placeholder="Passwort festlegen"></div>
    <button class="btn btn-green btn-full" onclick="nutzerAnlegen()">+ Nutzer anlegen</button>`;
}

export async function nutzerAnlegen() {
  const name = document.getElementById('new-name').value.trim();
  const rechte = leseRechte('new');
  const pw = document.getElementById('new-pw').value.trim();
  if(!name) { alert('Bitte Name eingeben.'); return; }
  if(!pw) { alert('Bitte Passwort eingeben.'); return; }
  if(state.users.find(u=>u.name.toLowerCase()===name.toLowerCase())) {
    alert('Ein Nutzer mit diesem Namen existiert bereits.'); return;
  }
  const pwHash = await hashPW(name, pw);
  try {
    await db.upsertNutzer({ name, rechte, pw: pwHash });
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

export function nutzerEditAbbruch() {
  nutzerEditId = null;
  renderAdminNutzer();
}

export async function nutzerSpeichern(id) {
  const u = state.users.find(x=>x.id===id);
  if(!u) return;
  const name = document.getElementById('edit-name').value.trim();
  const rechte = leseRechte('edit');
  const pw = document.getElementById('edit-pw').value.trim();
  if(!name) { alert('Bitte Name eingeben.'); return; }
  if(state.users.find(x=>x.id!==id && x.name.toLowerCase()===name.toLowerCase())) {
    alert('Dieser Name ist bereits vergeben.'); return;
  }
  const pwHash = pw ? await hashPW(name, pw) : null;
  try {
    await db.upsertNutzer({ id, name, rechte, pw: pwHash });
    u.name = name; u.rechte = rechte; u.label = fahrerLabel(u);
    showToast('✓ Änderungen gespeichert');
  } catch(e) { showToast('⚠ Fehler: '+e.message, 'error'); return; }
  nutzerEditId = null;
  // Eigene Rechte geändert: Navigation und Kopfzeile sofort anpassen.
  if(id === state.currentUser.id) { window.renderMain(); window.ansichtAnzeigen(); }
  else renderAdminNutzer();
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
