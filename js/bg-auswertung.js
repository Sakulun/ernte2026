import { sb, bgState, escapeHtml, showToast, kg2t, fmtDatum, nettoVon, renderBgMain } from './bg-app.js?v=125';

// ── Übersicht: Tonnage nach Lieferant × Kultur (× Schlag), Fuhrenliste, Export ─

let _openLieferant = null;
export function toggleBgLieferant(id) { _openLieferant = (_openLieferant === id) ? null : id; renderBgMain(); }

const lName = id => bgState.lieferanten.find(l => l.id === id)?.name || '(ohne Lieferant)';
const fName = id => bgState.felder.find(f => f.id === id)?.name || '';
const uName = id => bgState.users.find(u => u.id === id)?.name || '';

// Gruppierung: je Lieferant → je Kultur → je Schlag; Summen + Ø TS (gewichtet nach Netto)
function auswertung() {
  const map = {};
  bgState.fuhren.forEach(f => {
    const n = nettoVon(f);
    if(!n) return;
    const L = (map[f.lieferant_id ?? 0] = map[f.lieferant_id ?? 0] || { lieferantId: f.lieferant_id ?? 0, kg: 0, anz: 0, tsKg: 0, tsSum: 0, kulturen: {} });
    L.kg += n; L.anz++;
    if(f.ts_gehalt != null) { L.tsKg += n; L.tsSum += n * parseFloat(f.ts_gehalt); }
    const K = (L.kulturen[f.kultur || '–'] = L.kulturen[f.kultur || '–'] || { kg: 0, anz: 0, tsKg: 0, tsSum: 0, schlaege: {} });
    K.kg += n; K.anz++;
    if(f.ts_gehalt != null) { K.tsKg += n; K.tsSum += n * parseFloat(f.ts_gehalt); }
    const sKey = f.feld_id || 0;
    const S = (K.schlaege[sKey] = K.schlaege[sKey] || { feldId: f.feld_id, kg: 0, anz: 0, tsKg: 0, tsSum: 0 });
    S.kg += n; S.anz++;
    if(f.ts_gehalt != null) { S.tsKg += n; S.tsSum += n * parseFloat(f.ts_gehalt); }
  });
  return Object.values(map).sort((a,b) => b.kg - a.kg);
}
const avgTs = x => x.tsKg > 0 ? (x.tsSum / x.tsKg).toFixed(1) + ' %' : '–';
const t1 = kg => (kg/1000).toLocaleString('de-DE', {minimumFractionDigits:1, maximumFractionDigits:1});

export function renderBgUebersicht(el) {
  const daten = auswertung();
  const gesamtKg = daten.reduce((s,l) => s + l.kg, 0);
  const gesamtAnz = daten.reduce((s,l) => s + l.anz, 0);
  const gesamtTsKg = daten.reduce((s,l) => s + l.tsKg, 0);
  const gesamtTsSum = daten.reduce((s,l) => s + l.tsSum, 0);

  const lieferantCards = daten.map(L => {
    const open = _openLieferant === L.lieferantId;
    const kulturRows = Object.entries(L.kulturen).sort((a,b) => b[1].kg - a[1].kg).map(([kultur, K]) => {
      const schlagRows = open ? Object.values(K.schlaege).sort((a,b) => b.kg - a.kg).map(S =>
        `<tr style="color:var(--text2)"><td style="padding-left:26px">${S.feldId ? escapeHtml(fName(S.feldId)) : '<i>ohne Schlag</i>'}</td>
          <td>${S.anz}</td><td>${t1(S.kg)}</td><td>${avgTs(S)}</td></tr>`).join('') : '';
      return `<tr><td style="padding-left:12px;font-weight:600">${escapeHtml(kultur)}</td>
        <td>${K.anz}</td><td><b>${t1(K.kg)}</b></td><td>${avgTs(K)}</td></tr>${schlagRows}`;
    }).join('');
    return `<div class="card" style="padding:0;overflow:hidden">
      <div onclick="toggleBgLieferant(${L.lieferantId})" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:13px 16px">
        <div style="font-size:15px;font-weight:700">${open?'▾':'▸'} ${escapeHtml(lName(L.lieferantId))}</div>
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:800;color:var(--gold)">${t1(L.kg)} t</div>
          <div style="font-size:10px;color:var(--text3)">${L.anz} Fuhren · Ø TS ${avgTs(L)}</div>
        </div>
      </div>
      <div style="padding:0 8px 10px"><table class="bg-tbl">
        <thead><tr><th>Kultur${open?' / Schlag':''}</th><th>Fuhren</th><th>t</th><th>Ø TS</th></tr></thead>
        <tbody>${kulturRows}</tbody>
      </table></div>
    </div>`;
  }).join('');

  const fuhren = bgState.fuhren.slice(0, 30);
  const fuhrenListe = fuhren.map(f => fuhreCard(f, true)).join('');

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
      <div class="stat-box"><div class="stat-val">${t1(gesamtKg)}</div><div class="stat-label">t gesamt</div></div>
      <div class="stat-box"><div class="stat-val">${gesamtAnz}</div><div class="stat-label">Fuhren</div></div>
      <div class="stat-box"><div class="stat-val">${gesamtTsKg>0?(gesamtTsSum/gesamtTsKg).toFixed(1)+'%':'–'}</div><div class="stat-label">Ø TS</div></div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn btn-sm btn-outline" onclick="exportBgExcel()">📊 Excel</button>
      <button class="btn btn-sm btn-outline" onclick="exportBgCSV()">⬇ CSV</button>
    </div>
    ${daten.length ? lieferantCards : '<div class="empty-state">Noch keine Fuhren erfasst.</div>'}
    ${fuhren.length ? `<div class="section-label">Letzte Fuhren</div>${fuhrenListe}` : ''}`;
}

function fuhreCard(f, mitLoeschen) {
  const n = nettoVon(f);
  const admin = mitLoeschen && bgState.currentUser?.role === 'admin';
  return `<div class="fuhre-item">
    <div class="fuhre-top"><span class="fuhre-nr">${escapeHtml(f.nr)} · ${fmtDatum(f.zeit)}</span>
      <span style="display:flex;gap:6px;align-items:center">
        <span style="font-size:15px;font-weight:800;color:var(--gold)">${kg2t(n)}</span>
        ${admin ? `<button onclick="bgFuhreEditToggle(${f.id})" title="Bearbeiten" style="background:none;border:1px solid var(--border2);color:var(--text2);border-radius:6px;width:28px;height:28px;cursor:pointer">✏</button>
        <button onclick="bgFuhreLoeschen(${f.id})" title="Löschen" style="background:none;border:1px solid var(--border2);color:var(--red);border-radius:6px;width:28px;height:28px;cursor:pointer">🗑</button>` : ''}
      </span></div>
    <div style="font-size:12px;color:var(--text2)">${escapeHtml(lName(f.lieferant_id))}${f.feld_id?' · '+escapeHtml(fName(f.feld_id)):''} · ${escapeHtml(f.kultur||'–')}${f.ts_gehalt!=null?' · TS '+parseFloat(f.ts_gehalt).toLocaleString('de-DE')+' %':''}</div>
    <div style="font-size:11px;color:var(--text3);margin-top:2px">Voll ${Number(f.vollgewicht).toLocaleString('de-DE')} · Leer ${Number(f.leergewicht).toLocaleString('de-DE')} kg${f.abfahrer_id?' · '+escapeHtml(uName(f.abfahrer_id)):''}</div>
    ${admin && _editOpen === f.id ? editFormHTML(f) : ''}
  </div>`;
}

// ── Fuhre bearbeiten (nur Admin): Lieferant/Schlag/Kultur/Gewichte/TS ────────
let _editOpen = null;
export function bgFuhreEditToggle(id) { _editOpen = (_editOpen === id) ? null : id; renderBgMain(); }

function editFormHTML(f) {
  const lOpts = bgState.lieferanten.map(l => `<option value="${l.id}" ${l.id===f.lieferant_id?'selected':''}>${escapeHtml(l.name)}</option>`).join('');
  const fOpts = '<option value="">— ohne Schlag —</option>' + bgState.felder
    .map(x => `<option value="${x.id}" ${x.id===f.feld_id?'selected':''}>${escapeHtml(x.name)}</option>`).join('');
  // Alle Kulturen wählbar (auch inaktive) + der historische Text, falls nicht in der Liste
  const namen = bgState.kulturen.map(k => k.name);
  if(f.kultur && !namen.includes(f.kultur)) namen.push(f.kultur);
  const kOpts = namen.map(nm => `<option ${nm===f.kultur?'selected':''}>${escapeHtml(nm)}</option>`).join('');
  const lab = (t, inner) => `<label style="font-size:10px;color:var(--text2)">${t}${inner}</label>`;
  return `<div style="margin-top:10px;padding:12px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg2)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${lab('Lieferant', `<select id="bge-lief-${f.id}" class="input">${lOpts}</select>`)}
      ${lab('Schlag', `<select id="bge-feld-${f.id}" class="input">${fOpts}</select>`)}
      ${lab('Kultur', `<select id="bge-kultur-${f.id}" class="input">${kOpts}</select>`)}
      ${lab('TS-Gehalt %', `<input id="bge-ts-${f.id}" class="input" type="number" step="0.1" min="0" max="100" value="${f.ts_gehalt ?? ''}">`)}
      ${lab('Vollgew. (kg)', `<input id="bge-voll-${f.id}" class="input" type="number" value="${f.vollgewicht ?? ''}">`)}
      ${lab('Leergew. (kg)', `<input id="bge-leer-${f.id}" class="input" type="number" value="${f.leergewicht ?? ''}">`)}
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-sm btn-green" onclick="bgFuhreEditSpeichern(${f.id})">💾 Speichern</button>
      <button class="btn btn-sm btn-outline" onclick="bgFuhreEditToggle(${f.id})">Abbrechen</button>
    </div>
  </div>`;
}

export async function bgFuhreEditSpeichern(id) {
  const f = bgState.fuhren.find(x => x.id === id);
  if(!f) return;
  const el = sfx => document.getElementById('bge-'+sfx+'-'+id);
  const voll = parseFloat(el('voll')?.value);
  const leer = parseFloat(el('leer')?.value);
  if(!voll || !leer || voll <= leer) { alert('Bitte gültige Gewichte eingeben (Vollgew. > Leergew.).'); return; }
  const tsRaw = (el('ts')?.value || '').trim();
  const ts = tsRaw !== '' ? parseFloat(tsRaw) : null;
  if(ts != null && (isNaN(ts) || ts < 0 || ts > 100)) { alert('TS-Gehalt bitte zwischen 0 und 100 % angeben.'); return; }
  const upd = {
    lieferant_id: parseInt(el('lief')?.value) || null,
    feld_id: parseInt(el('feld')?.value) || null,
    kultur: el('kultur')?.value || f.kultur,
    vollgewicht: voll, leergewicht: leer, ts_gehalt: ts,
  };
  try {
    const { error } = await sb.from('bg_fuhren').update(upd).eq('id', id);
    if(error) throw error;
    Object.assign(f, upd);
    _editOpen = null;
    showToast('✓ Fuhre ' + escapeHtml(f.nr) + ' gespeichert');
    renderBgMain();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}

export async function bgFuhreLoeschen(id) {
  const f = bgState.fuhren.find(x => x.id === id);
  if(!f) return;
  if(!confirm(`Fuhre ${f.nr} (${kg2t(nettoVon(f))}, ${lName(f.lieferant_id)}) wirklich löschen?`)) return;
  try {
    const { error } = await sb.from('bg_fuhren').delete().eq('id', id);
    if(error) throw error;
    bgState.fuhren = bgState.fuhren.filter(x => x.id !== id);
    showToast('🗑 Fuhre gelöscht');
    renderBgMain();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}

// ── Fahrer-Ansicht: eigene Fuhren ────────────────────────────────────────────
export function renderBgMeineFuhren(el) {
  const uid = bgState.currentUser?.id;
  const meine = bgState.fuhren.filter(f => f.abfahrer_id === uid);
  const kg = meine.reduce((s,f) => s + nettoVon(f), 0);
  el.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="stat-label">Deine Biomasse</div>
      <div style="font-size:34px;font-weight:800;color:var(--gold)">${(kg/1000).toLocaleString('de-DE',{maximumFractionDigits:1})} t</div>
      <div style="font-size:12px;color:var(--text2)">${meine.length} Fuhren</div>
    </div>
    ${meine.length ? meine.slice(0,50).map(f => fuhreCard(f, false)).join('') : '<div class="empty-state">Noch keine Fuhren erfasst.</div>'}`;
}

// ── Export ───────────────────────────────────────────────────────────────────
function exportZeilen() {
  return bgState.fuhren.slice().reverse().map(f => ({
    nr: f.nr, datum: new Date(f.zeit).toLocaleDateString('de-DE'), zeit: new Date(f.zeit).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),
    lieferant: lName(f.lieferant_id), schlag: f.feld_id ? fName(f.feld_id) : '', kultur: f.kultur || '',
    voll: Number(f.vollgewicht)||0, leer: Number(f.leergewicht)||0, netto: nettoVon(f),
    ts: f.ts_gehalt != null ? parseFloat(f.ts_gehalt) : '', fahrer: uName(f.abfahrer_id),
  }));
}

function ensureXLSX() {
  return new Promise((resolve, reject) => {
    if(window.XLSX) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = resolve; s.onerror = () => reject(new Error('XLSX-Bibliothek nicht ladbar'));
    document.head.appendChild(s);
  });
}

export async function exportBgExcel() {
  try { await ensureXLSX(); } catch(e) { showToast('Excel-Bibliothek konnte nicht geladen werden.', 'error'); return; }
  const zeilen = exportZeilen();
  if(!zeilen.length) { showToast('Keine Fuhren vorhanden.', 'error'); return; }
  const aoa = [['Nr','Datum','Zeit','Lieferant','Schlag','Kultur','Voll (kg)','Leer (kg)','Netto (kg)','Netto (t)','TS (%)','Fahrer']];
  zeilen.forEach(z => aoa.push([z.nr, z.datum, z.zeit, z.lieferant, z.schlag, z.kultur, z.voll, z.leer, z.netto, Math.round(z.netto/10)/100, z.ts, z.fahrer]));
  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{wch:8},{wch:10},{wch:6},{wch:22},{wch:18},{wch:14},{wch:10},{wch:10},{wch:10},{wch:9},{wch:7},{wch:16}];
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Fuhren');
  window.XLSX.writeFile(wb, 'Biogas_Fuhren.xlsx');
  showToast('✓ Excel exportiert');
}

export function exportBgCSV() {
  const zeilen = exportZeilen();
  if(!zeilen.length) { showToast('Keine Fuhren vorhanden.', 'error'); return; }
  const esc = v => '"' + String(v).replace(/"/g,'""') + '"';
  const de = v => String(v).replace('.', ',');
  const rows = [['Nr','Datum','Zeit','Lieferant','Schlag','Kultur','Voll (kg)','Leer (kg)','Netto (kg)','TS (%)','Fahrer'].join(';')];
  zeilen.forEach(z => rows.push([z.nr, z.datum, z.zeit, esc(z.lieferant), esc(z.schlag), esc(z.kultur), z.voll, z.leer, z.netto, z.ts!==''?de(z.ts):'', esc(z.fahrer)].join(';')));
  const blob = new Blob(['﻿' + rows.join('\r\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Biogas_Fuhren.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('✓ CSV exportiert');
}
