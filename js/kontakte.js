import { state } from './state.js?v=26';
import { db } from './db.js?v=26';
import { showToast, escapeHtml } from './helpers.js?v=26';

export function renderKontakte() {
  const typen = [['kunde','Kunden'],['lieferant','Lieferanten'],['beides','Kunden & Lieferanten']];
  const kRow = (k) => `
    <div class="card" style="margin-bottom:6px;opacity:${k.aktiv?1:0.5}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="flex:1">
          <div style="font-weight:600;color:var(--text)">${escapeHtml(k.name)}</div>
          <div style="font-size:10px;color:var(--gold);letter-spacing:1px;text-transform:uppercase">${k.typ==='beides'?'Kunde & Lieferant':k.typ==='lieferant'?'Lieferant':'Kunde'}</div>
          ${k.adresse?`<div style="font-size:11px;color:var(--text3)">${escapeHtml(k.adresse)}</div>`:''}
          ${k.email||k.telefon?`<div style="font-size:11px;color:var(--text3)">${[k.email,k.telefon].filter(Boolean).join(' · ')}</div>`:''}
          ${k.iban?`<div style="font-size:10px;color:var(--text3);font-family:monospace">${escapeHtml(k.iban)}</div>`:''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-sm btn-outline" onclick="kontaktEditDialog(${k.id})">✏</button>
          <button class="btn btn-sm" style="background:none;border:1px solid var(--border2);color:${k.aktiv?'var(--red)':'var(--green)'}" onclick="kontaktToggleAktiv(${k.id})">${k.aktiv?'✕':'✓'}</button>
        </div>
      </div>
    </div>`;
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
    <div class="stat-box" style="flex:1;margin-right:8px"><div class="stat-val" style="font-size:22px">${state.kontakte.filter(k=>k.aktiv).length}</div><div class="stat-label">aktive Kontakte</div></div>
    <button class="btn btn-primary" onclick="kontaktNeuDialog()">+ Neuer Kontakt</button>
  </div>`;
  for(const [typ,label] of typen) {
    const gruppe = state.kontakte.filter(k=>k.typ===typ);
    if(!gruppe.length) continue;
    html += `<div class="section-label" style="margin-bottom:8px">${label} (${gruppe.length})</div>`;
    html += gruppe.map(kRow).join('');
  }
  if(!state.kontakte.length) html += '<div class="empty-state">Noch keine Kontakte angelegt.</div>';
  document.getElementById('admintab').innerHTML = html;
}

export function kontaktNeuDialog(id) {
  const k = id ? state.kontakte.find(x=>x.id===id) : null;
  const m = document.createElement('div');
  m.id = 'kontakt-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  m.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);padding:24px;width:100%;max-width:420px;box-shadow:var(--shadow)">
      <div style="font-family:var(--serif);font-size:18px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text);margin-bottom:20px">${k?'Kontakt bearbeiten':'Neuer Kontakt'}</div>
      <div class="form-group"><label>Name *</label><input type="text" id="kt-name" value="${k?escapeHtml(k.name):''}" placeholder="z.B. RWA Magdeburg GmbH"></div>
      <div class="form-group"><label>Typ</label>
        <select id="kt-typ">
          <option value="kunde"${(!k||k.typ==='kunde')?' selected':''}>Kunde</option>
          <option value="lieferant"${k?.typ==='lieferant'?' selected':''}>Lieferant</option>
          <option value="beides"${k?.typ==='beides'?' selected':''}>Kunde & Lieferant</option>
        </select>
      </div>
      <div class="form-group"><label>Adresse</label><input type="text" id="kt-adresse" value="${k?escapeHtml(k.adresse||''):''}" placeholder="Straße, PLZ Ort"></div>
      <div class="form-group"><label>Telefon</label><input type="text" id="kt-telefon" value="${k?escapeHtml(k.telefon||''):''}" placeholder="+49 345 ..."></div>
      <div class="form-group"><label>E-Mail</label><input type="email" id="kt-email" value="${k?escapeHtml(k.email||''):''}" placeholder="name@firma.de"></div>
      <div class="form-group"><label>IBAN</label><input type="text" id="kt-iban" value="${k?escapeHtml(k.iban||''):''}" placeholder="DE12 3456 7890 1234 5678 90"></div>
      <div class="form-group"><label>Notiz</label><input type="text" id="kt-notiz" value="${k?escapeHtml(k.notiz||''):''}" ></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" style="flex:1" onclick="kontaktSpeichern(${k?k.id:'null'})">${k?'Speichern':'Anlegen'}</button>
        <button class="btn btn-outline" onclick="document.getElementById('kontakt-modal').remove()">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(m);
}
export function kontaktEditDialog(id) { kontaktNeuDialog(id); }

export async function kontaktSpeichern(id) {
  const name = document.getElementById('kt-name')?.value.trim();
  if(!name) { showToast('⚠ Name erforderlich','error'); return; }
  const data = {
    name, typ:document.getElementById('kt-typ').value,
    adresse:document.getElementById('kt-adresse').value.trim()||null,
    telefon:document.getElementById('kt-telefon').value.trim()||null,
    email:document.getElementById('kt-email').value.trim()||null,
    iban:document.getElementById('kt-iban').value.trim()||null,
    notiz:document.getElementById('kt-notiz').value.trim()||null,
  };
  try {
    if(id) {
      const k = state.kontakte.find(x=>x.id===id);
      await db.updateKontakt({...k,...data});
      Object.assign(k, data);
    } else {
      const saved = await db.insertKontakt(data);
      state.kontakte.push(saved);
      state.kontakte.sort((a,b)=>a.name.localeCompare(b.name));
    }
    document.getElementById('kontakt-modal')?.remove();
    showToast('✓ Kontakt gespeichert');
    renderKontakte();
  } catch(e) { showToast('⚠ '+e.message,'error'); }
}

export async function kontaktToggleAktiv(id) {
  const k = state.kontakte.find(x=>x.id===id);
  if(!k) return;
  try {
    await db.updateKontakt({...k, aktiv: !k.aktiv});
    k.aktiv = !k.aktiv;
    renderKontakte();
  } catch(e) { showToast('⚠ '+e.message,'error'); }
}
