import { state } from './state.js?v=37';
import { db } from './db.js?v=37';
import { showToast, escapeHtml } from './helpers.js?v=37';

export function renderArtikel() {
  const kategorien = ['getreide','betriebsmittel','saatgut','sonstige'];
  const katLabel = { getreide:'Getreide / Druschfrüchte', betriebsmittel:'Betriebsmittel', saatgut:'Saatgut', sonstige:'Sonstige' };
  const artRow = (a) =>
    `<div class="card" style="margin-bottom:6px;opacity:${a.aktiv?1:0.5}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="flex:1">
          <div style="font-weight:600;color:var(--text)">${escapeHtml(a.name)}</div>
          <div style="font-size:11px;color:var(--text3);">${a.einheit} · ${katLabel[a.kategorie]||a.kategorie}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-sm btn-outline" onclick="artikelEditDialog(${a.id})">✏</button>
          <button class="btn btn-sm" style="background:none;border:1px solid var(--border2);color:${a.aktiv?'var(--red)':'var(--green)'}" onclick="artikelToggleAktiv(${a.id})">${a.aktiv?'Deaktivieren':'Aktivieren'}</button>
        </div>
      </div>
    </div>`;

  let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    +'<div class="stat-box" style="flex:1;margin-right:8px"><div class="stat-val" style="font-size:22px">'+state.artikel.filter(a=>a.aktiv).length+'</div><div class="stat-label">aktive Artikel</div></div>'
    +'<button class="btn btn-primary" onclick="artikelNeuDialog()">+ Neuer Artikel</button>'
    +'</div>';

  for(const kat of kategorien) {
    const gruppe = state.artikel.filter(a=>a.kategorie===kat);
    if(!gruppe.length) continue;
    html += `<div class="section-label" style="margin-bottom:8px">${katLabel[kat]} (${gruppe.length})</div>`;
    html += gruppe.map(artRow).join('');
  }
  if(!state.artikel.length) html += '<div class="empty-state">Keine Artikel angelegt.</div>';
  document.getElementById('admintab').innerHTML = html;
}

export function artikelNeuDialog(id) {
  const a = id ? state.artikel.find(x=>x.id===id) : null;
  const m = document.createElement('div');
  m.id = 'artikel-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);padding:24px;width:100%;max-width:380px;box-shadow:var(--shadow)">
      <div style="font-family:var(--serif);font-size:18px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text);margin-bottom:20px">${a?'Artikel bearbeiten':'Neuer Artikel'}</div>
      <div class="form-group"><label>Name *</label><input type="text" id="art-name" value="${a?escapeHtml(a.name):''}" placeholder="z.B. Winterweizen"></div>
      <div class="form-group"><label>Einheit</label>
        <select id="art-einheit">
          ${['t','kg','l','Stück'].map(u=>`<option value="${u}"${(a?.einheit||'t')===u?' selected':''}>${u}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Kategorie</label>
        <select id="art-kategorie">
          <option value="getreide"${(!a||a.kategorie==='getreide')?' selected':''}>Getreide / Druschfrüchte</option>
          <option value="betriebsmittel"${a?.kategorie==='betriebsmittel'?' selected':''}>Betriebsmittel</option>
          <option value="saatgut"${a?.kategorie==='saatgut'?' selected':''}>Saatgut</option>
          <option value="sonstige"${a?.kategorie==='sonstige'?' selected':''}>Sonstige</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" style="flex:1" onclick="artikelSpeichern(${a?a.id:'null'})">${a?'Speichern':'Anlegen'}</button>
        <button class="btn btn-outline" onclick="document.getElementById('artikel-modal').remove()">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(m);
}
export function artikelEditDialog(id) { artikelNeuDialog(id); }

export async function artikelSpeichern(id) {
  const name     = document.getElementById('art-name')?.value.trim();
  const einheit  = document.getElementById('art-einheit')?.value;
  const kategorie= document.getElementById('art-kategorie')?.value;
  if(!name) { showToast('⚠ Name erforderlich','error'); return; }
  try {
    if(id) {
      const a = state.artikel.find(x=>x.id===id);
      await db.updateArtikel({...a, name, einheit, kategorie});
      Object.assign(a, {name, einheit, kategorie});
    } else {
      const saved = await db.insertArtikel({name, einheit, kategorie});
      state.artikel.push(saved);
      state.artikel.sort((a,b)=>a.name.localeCompare(b.name));
    }
    document.getElementById('artikel-modal')?.remove();
    showToast('✓ Artikel gespeichert');
    renderArtikel();
  } catch(e) { showToast('⚠ '+e.message,'error'); }
}

export async function artikelToggleAktiv(id) {
  const a = state.artikel.find(x=>x.id===id);
  if(!a) return;
  try {
    await db.updateArtikel({...a, aktiv: !a.aktiv});
    a.aktiv = !a.aktiv;
    renderArtikel();
  } catch(e) { showToast('⚠ '+e.message,'error'); }
}
