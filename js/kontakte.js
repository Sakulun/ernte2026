import { state } from './state.js?v=37';
import { db } from './db.js?v=37';
import { showToast, escapeHtml } from './helpers.js?v=37';

export function renderKontakte() {
  const typen = [['kunde','Kunden'],['lieferant','Lieferanten'],['beides','Kunden & Lieferanten']];
  const kRow = (k) => {
    // Lieferanten können für die Fuhren-Erfassung freigeschaltet werden
    // (erscheinen dann als Zukauf-Quelle im Schlag-Dropdown der Fahrer).
    const istLieferant = k.typ === 'lieferant' || k.typ === 'beides';
    const zukaufFeld = istLieferant ? state.felder.find(f => f.typ === 'lieferant' && f.kontaktId === k.id) : null;
    const zukaufAktiv = zukaufFeld?.status === 'aktiv';
    const zukaufBtn = istLieferant && k.aktiv
      ? `<button class="btn btn-sm" title="Lieferant als Zukauf-Quelle in der Fuhren-Erfassung"
           style="background:${zukaufAktiv?'var(--green)':'none'};border:1px solid ${zukaufAktiv?'var(--green)':'var(--border2)'};color:${zukaufAktiv?'#fff':'var(--text2)'}"
           onclick="lieferantFuhrenToggle(${k.id})">🌾 Fuhren: ${zukaufAktiv?'AKTIV':'aus'}</button>`
      : '';
    const konfigBtn = zukaufAktiv
      ? `<button class="btn btn-sm btn-outline" title="Zukauf-Einstellungen: Fruchtarten & Standard-Abfahrer" onclick="zukaufKonfigDialog(${k.id})">⚙</button>`
      : '';
    const konfigInfo = zukaufAktiv && (zukaufFeld.zukaufFruchtarten?.length || zukaufFeld.zukaufAbfahrerId)
      ? `<div style="font-size:11px;color:var(--text3);margin-top:3px">Zukauf: ${(zukaufFeld.zukaufFruchtarten||[]).map(escapeHtml).join(', ')||'alle Fruchtarten'}${zukaufFeld.zukaufAbfahrerId?' · Fahrer '+escapeHtml(state.users.find(u=>u.id===zukaufFeld.zukaufAbfahrerId)?.name||'?'):''}</div>`
      : '';
    return `
    <div class="card" style="margin-bottom:6px;opacity:${k.aktiv?1:0.5}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="flex:1">
          <div style="font-weight:600;color:var(--text)">${escapeHtml(k.name)}</div>
          <div style="font-size:10px;color:var(--gold);letter-spacing:1px;text-transform:uppercase">${k.typ==='beides'?'Kunde & Lieferant':k.typ==='lieferant'?'Lieferant':'Kunde'}</div>
          ${k.adresse?`<div style="font-size:11px;color:var(--text3)">${escapeHtml(k.adresse)}</div>`:''}
          ${k.email||k.telefon?`<div style="font-size:11px;color:var(--text3)">${[k.email,k.telefon].filter(Boolean).join(' · ')}</div>`:''}
          ${k.iban?`<div style="font-size:10px;color:var(--text3);font-family:monospace">${escapeHtml(k.iban)}</div>`:''}
          ${konfigInfo}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
          ${zukaufBtn}${konfigBtn}
          <button class="btn btn-sm btn-outline" onclick="kontaktEditDialog(${k.id})">✏</button>
          <button class="btn btn-sm" style="background:none;border:1px solid var(--border2);color:${k.aktiv?'var(--red)':'var(--green)'}" onclick="kontaktToggleAktiv(${k.id})">${k.aktiv?'✕':'✓'}</button>
        </div>
      </div>
    </div>`;
  };
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

// Lieferant für die Fuhren-Erfassung an/aus: legt beim ersten Aktivieren ein
// Spezial-"Feld" (typ 'lieferant') an, danach wird nur der Status umgeschaltet.
export async function lieferantFuhrenToggle(kontaktId) {
  const k = state.kontakte.find(x => x.id === kontaktId);
  if(!k) return;
  const feld = state.felder.find(f => f.typ === 'lieferant' && f.kontaktId === kontaktId);
  try {
    if(!feld) {
      const id = await db.insertFeldLieferant(k.name, kontaktId);
      state.felder.push({ id, name: k.name, flaeche: 0, fruchtart: '', status: 'aktiv',
        betrieb: 'Zukauf', bio: false, flik: '', nummer: '', typ: 'lieferant', kontaktId });
      showToast('✓ ' + k.name + ' als Zukauf-Quelle aktiviert');
    } else {
      const neu = feld.status === 'aktiv' ? 'inaktiv' : 'aktiv';
      await db.updateFeldStatus(feld.id, neu);
      feld.status = neu;
      showToast(neu === 'aktiv' ? '✓ Zukauf-Quelle aktiviert' : 'Zukauf-Quelle deaktiviert');
    }
    renderKontakte();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}

// Zukauf-Einstellungen eines aktivierten Lieferanten: welche Fruchtarten er bringt
// (leer = alle) + welcher Abfahrer in der Erfassung voreingestellt wird.
export function zukaufKonfigDialog(kontaktId) {
  const feld = state.felder.find(f => f.typ === 'lieferant' && f.kontaktId === kontaktId);
  if(!feld) return;
  const k = state.kontakte.find(x => x.id === kontaktId);
  const abfOpts = state.users.filter(u => u.role === 'abfahrer')
    .map(u => `<option value="${u.id}" ${u.id===feld.zukaufAbfahrerId?'selected':''}>${escapeHtml(u.name)}</option>`).join('');
  const m = document.createElement('div');
  m.id = 'zukauf-konfig-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  m.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);padding:24px;width:100%;max-width:420px;box-shadow:var(--shadow)">
      <div style="font-family:var(--serif);font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px">🌾 Zukauf-Einstellungen</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:18px">${escapeHtml(k?.name||feld.name)}</div>
      <div class="form-group">
        <label>Fruchtarten (eine pro Zeile)</label>
        <textarea id="zk-fruchtarten" rows="4" placeholder="z.B.\nBio Weizen\nBio Hafer" style="width:100%;resize:vertical">${(feld.zukaufFruchtarten||[]).map(escapeHtml).join('\n')}</textarea>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">Leer = alle Fruchtarten wählbar</div>
      </div>
      <div class="form-group">
        <label>Standard-Abfahrer (voreingestellt)</label>
        <select id="zk-abfahrer"><option value="">— keiner —</option>${abfOpts}</select>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" style="flex:1" onclick="zukaufKonfigSpeichern(${feld.id})">Speichern</button>
        <button class="btn btn-outline" onclick="document.getElementById('zukauf-konfig-modal').remove()">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(m);
}

export async function zukaufKonfigSpeichern(feldId) {
  const feld = state.felder.find(f => f.id === feldId);
  if(!feld) return;
  const fruchtarten = (document.getElementById('zk-fruchtarten')?.value || '')
    .split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  const abfVal = document.getElementById('zk-abfahrer')?.value;
  const abfahrerId = abfVal ? parseInt(abfVal) : null;
  try {
    await db.updateFeldZukauf(feldId, { fruchtarten, abfahrerId });
    feld.zukaufFruchtarten = fruchtarten;
    feld.zukaufAbfahrerId = abfahrerId;
    document.getElementById('zukauf-konfig-modal')?.remove();
    showToast('✓ Zukauf-Einstellungen gespeichert');
    renderKontakte();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
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
