// Fruchtfolge: Tabellenansicht eines Jahres mit Sortierung, Volltextsuche,
// Checkbox-Mehrfachauswahl und Massenbearbeitung (nur Planjahre).
import { getSb } from './db.js?v=117';
import { showToast, escapeHtml } from './helpers.js?v=117';
import { ffState, ffLoadParzellen, ffGefilterteParzellen, ffJahr, ffIstPlanjahr,
         ffSetKultur, ffInvalidateJahr, ffRecompute, renderFruchtfolge, ffOffeneFlags } from './fruchtfolge.js?v=117';
import { ffMatrixNebenInvalidate } from './ff-matrix.js?v=117';

let sortCol = 'nummer';
let sortDir = 1;
let suche = '';
let auswahl = new Set();

export async function renderFFTabelle(el) {
  const jahre = ffState.jahre;
  if (!jahre.length) {
    el.innerHTML = '<div class="card"><p>Noch keine Jahre vorhanden – zuerst importieren.</p></div>';
    return;
  }
  const jahrId = ffState.jahrId || jahre[jahre.length - 1].id;
  ffState.jahrId = jahrId;
  const planjahr = ffIstPlanjahr(jahrId);
  const alle = ffGefilterteParzellen(await ffLoadParzellen(jahrId));
  const neben = ffState.nebenkulturenCache[jahrId] || [];
  const nebenByParzelle = {};
  for (const n of neben) (nebenByParzelle[n.parzelle_id] ||= []).push(n);
  const flagsByParzelle = {};
  for (const f of ffOffeneFlags()) (flagsByParzelle[f.parzelle_id] ||= []).push(f);

  const q = suche.trim().toLowerCase();
  let rows = !q ? alle : alle.filter(p =>
    [p.nummer, p.name, p.betrieb_name, p.kultur_name, p.sorte, p.flik]
      .some(v => (v || '').toLowerCase().includes(q)));

  const sortVal = (p) => {
    switch (sortCol) {
      case 'ha': return Number(p.netto_ha) || 0;
      case 'betrieb': return p.betrieb_name || '';
      case 'kultur': return p.kultur_name || '';
      case 'name': return p.name || '';
      case 'flags': return (flagsByParzelle[p.id] || []).length;
      default: return p.nummer || '';
    }
  };
  rows = rows.slice().sort((a, b) => {
    const va = sortVal(a), vb = sortVal(b);
    const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'de', { numeric: true });
    return c * sortDir;
  });

  auswahl = new Set([...auswahl].filter(id => alle.some(p => p.id === id)));
  const kulturOpts = (sel) => ffState.kulturen.filter(k => k.aktiv !== false)
    .map(k => `<option value="${k.id}" ${k.id === sel ? 'selected' : ''}>${escapeHtml(k.name)}</option>`).join('');
  const th = (col, label, right) =>
    `<th ${right ? 'style="text-align:right"' : ''} class="sortierbar" onclick="ffTabSort('${col}')">${label}${sortCol === col ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`;

  const zeilen = rows.map(p => {
    const nb = (nebenByParzelle[p.id] || []).filter(n => n.typ === 'zwischenfrucht');
    const nbKultur = nb.length ? (ffState.kulturen.find(k => k.id === nb[0].kultur_id)?.name || 'NC ' + nb[0].nutzungscode) : '';
    const flags = flagsByParzelle[p.id] || [];
    const flagHtml = flags.map(f =>
      `<span class="${f.schweregrad === 'hoch' ? 'ff-flag-hoch' : 'ff-flag-mittel'}" title="${escapeHtml(f.typ)} vs. ${f.konflikt_jahr}">⚠</span>`).join('');
    return `<tr>
      <td><input type="checkbox" ${auswahl.has(p.id) ? 'checked' : ''} onchange="ffTabAuswahl(${p.id}, this.checked)"></td>
      <td><span style="color:${escapeHtml(p.betrieb_farbe)}">●</span> ${escapeHtml(p.betrieb_kuerzel || p.betrieb_name)}</td>
      <td><b>${escapeHtml(p.nummer)}</b></td>
      <td>${escapeHtml(p.name || '')}</td>
      <td style="text-align:right">${Number(p.netto_ha ?? 0).toFixed(2)}</td>
      <td>${planjahr
        ? `<select onchange="ffTabKultur(${p.id}, this.value)"><option value="">—</option>${kulturOpts(p.kultur_id)}</select>`
        : `<span class="ff-legende-farbe" style="background:${escapeHtml(p.kultur_farbe || '#777')}"></span> ${escapeHtml(p.kultur_name || '—')}`}</td>
      <td>${planjahr
        ? `<select onchange="ffTabZwischenfrucht(${p.id}, this.value)"><option value="">— keine —</option>${kulturOpts(nb[0]?.kultur_id)}</select>`
        : escapeHtml(nbKultur || '—')}</td>
      <td>${planjahr
        ? `<input value="${escapeHtml(p.sorte || '')}" style="width:90px" onchange="ffTabSorte(${p.id}, this.value)">`
        : escapeHtml(p.sorte || '')}</td>
      <td>${flagHtml}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="card">
      <div class="ff-tab-kopf">
        <select onchange="ffTabJahr(parseInt(this.value))">
          ${jahre.map(j => `<option value="${j.id}" ${j.id === jahrId ? 'selected' : ''}>${j.jahr}${j.typ === 'plan' ? ' (Plan)' : ''}</option>`).join('')}
        </select>
        <input id="ff-tab-suche" placeholder="Suche (Nummer, Name, Kultur, FLIK…)" value="${escapeHtml(suche)}"
          oninput="ffTabSuche(this.value)" style="flex:1;min-width:180px">
        <span style="opacity:.7">${rows.length} von ${alle.length} Parzellen · Σ ${rows.reduce((s, p) => s + (Number(p.netto_ha) || 0), 0).toFixed(2)} ha</span>
      </div>
      ${planjahr ? `
      <div class="ff-tab-massen">
        <label><input type="checkbox" onchange="ffTabAlle(this.checked)" ${rows.length && rows.every(p => auswahl.has(p.id)) ? 'checked' : ''}> alle gefilterten</label>
        <span>${auswahl.size} markiert:</span>
        <select id="ff-massen-kultur"><option value="">Kultur…</option>${kulturOpts()}</select>
        <button class="btn btn-sm" onclick="ffTabMassenKultur()">Kultur zuweisen</button>
        <select id="ff-massen-zf"><option value="">Zwischenfrucht…</option>${kulturOpts()}</select>
        <button class="btn btn-sm" onclick="ffTabMassenZf(false)">ZF zuweisen</button>
        <button class="btn btn-sm" onclick="ffTabMassenZf(true)">ZF entfernen</button>
      </div>` : `<div style="opacity:.6;margin:6px 0">Importjahr – schreibgeschützt. Bearbeitung nur in Planjahren.</div>`}
      <div class="ff-tabelle-wrap">
        <table class="ff-tabelle">
          <thead><tr><th></th>${th('betrieb', 'Betrieb')}${th('nummer', 'Nr.')}${th('name', 'Name')}${th('ha', 'ha', true)}${th('kultur', 'Kultur')}<th>Zwischenfrucht</th><th>Sorte</th>${th('flags', 'Flags')}</tr></thead>
          <tbody>${zeilen || '<tr><td colspan="9" style="padding:14px">Keine Parzellen gefunden.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
  const s = document.getElementById('ff-tab-suche');
  if (q) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}

export function ffTabJahr(jahrId) { ffState.jahrId = jahrId; auswahl.clear(); renderFruchtfolge(); }
export function ffTabSort(col) {
  if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = 1; }
  renderFruchtfolge();
}
let sucheTimer = null;
export function ffTabSuche(v) {
  suche = v;
  clearTimeout(sucheTimer);
  sucheTimer = setTimeout(() => renderFruchtfolge(), 250);
}
export function ffTabAuswahl(id, checked) {
  if (checked) auswahl.add(id); else auswahl.delete(id);
}
export function ffTabAlle(checked) {
  const alle = ffGefilterteParzellen(ffState.parzellenCache[ffState.jahrId] || []);
  const q = suche.trim().toLowerCase();
  const rows = !q ? alle : alle.filter(p =>
    [p.nummer, p.name, p.betrieb_name, p.kultur_name, p.sorte, p.flik].some(v => (v || '').toLowerCase().includes(q)));
  if (checked) rows.forEach(p => auswahl.add(p.id));
  else rows.forEach(p => auswahl.delete(p.id));
  renderFruchtfolge();
}

async function nachAenderung() {
  ffInvalidateJahr(ffState.jahrId);
  ffMatrixNebenInvalidate();
  await ffRecompute();
  renderFruchtfolge();
}

export async function ffTabKultur(parzelleId, kulturIdStr) {
  try {
    await ffSetKultur(parzelleId, kulturIdStr ? parseInt(kulturIdStr) : null);
    showToast('Kultur gespeichert');
    await nachAenderung();
  } catch (err) { console.error(err); showToast('Fehler: ' + err.message); }
}

export async function ffTabSorte(parzelleId, sorte) {
  try {
    const { error } = await getSb().from('parzellen').update({ sorte: sorte || null }).eq('id', parzelleId);
    if (error) throw error;
    delete ffState.parzellenCache[ffState.jahrId];
    showToast('Sorte gespeichert');
  } catch (err) { console.error(err); showToast('Fehler: ' + err.message); }
}

async function zwischenfruchtSetzen(parzelleIds, kulturId) {
  const sb = getSb();
  const { error: delErr } = await sb.from('parzellen_nebenkulturen')
    .delete().in('parzelle_id', parzelleIds).eq('typ', 'zwischenfrucht');
  if (delErr) throw delErr;
  if (kulturId) {
    const { error } = await sb.from('parzellen_nebenkulturen')
      .insert(parzelleIds.map(pid => ({ parzelle_id: pid, kultur_id: kulturId, typ: 'zwischenfrucht' })));
    if (error) throw error;
  }
}

export async function ffTabZwischenfrucht(parzelleId, kulturIdStr) {
  try {
    await zwischenfruchtSetzen([parzelleId], kulturIdStr ? parseInt(kulturIdStr) : null);
    showToast('Zwischenfrucht gespeichert');
    await nachAenderung();
  } catch (err) { console.error(err); showToast('Fehler: ' + err.message); }
}

export async function ffTabMassenKultur() {
  const val = document.getElementById('ff-massen-kultur')?.value;
  if (!val) { showToast('Bitte Kultur wählen'); return; }
  if (!auswahl.size) { showToast('Keine Zeilen markiert'); return; }
  try {
    const { error } = await getSb().from('parzellen')
      .update({ kultur_id: parseInt(val) }).in('id', [...auswahl]);
    if (error) throw error;
    showToast(`Kultur für ${auswahl.size} Parzellen gesetzt`);
    await nachAenderung();
  } catch (err) { console.error(err); showToast('Fehler: ' + err.message); }
}

export async function ffTabMassenZf(entfernen) {
  if (!auswahl.size) { showToast('Keine Zeilen markiert'); return; }
  const val = entfernen ? null : document.getElementById('ff-massen-zf')?.value;
  if (!entfernen && !val) { showToast('Bitte Zwischenfrucht wählen'); return; }
  try {
    await zwischenfruchtSetzen([...auswahl], val ? parseInt(val) : null);
    showToast(entfernen ? 'Zwischenfrüchte entfernt' : `Zwischenfrucht für ${auswahl.size} Parzellen gesetzt`);
    await nachAenderung();
  } catch (err) { console.error(err); showToast('Fehler: ' + err.message); }
}
