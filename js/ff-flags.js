// Fruchtfolge: Flag-Übersicht – filterbare Tabelle aller Selbstfolge-/Anbaupause-
// Konflikte, akzeptieren mit Kommentar, CSV-Export, Sprung zu Matrix/Karte.
import { getSb } from './db.js?v=133';
import { showToast, escapeHtml } from './helpers.js?v=133';
import { ffState, ffLoadStammdaten, renderFruchtfolge, ffRecompute } from './fruchtfolge.js?v=133';

let fBetrieb = null, fJahr = null, fTyp = null, fStatus = 'offen', fGruppe = null;
let sortCol = 'jahr', sortDir = -1;

function gefiltert() {
  let rows = ffState.flags;
  if (fBetrieb) rows = rows.filter(f => f.betrieb_id === fBetrieb);
  if (fJahr) rows = rows.filter(f => f.jahr_id === fJahr);
  if (fTyp === 'hoch' || fTyp === 'mittel') rows = rows.filter(f => f.schweregrad === fTyp);
  else if (fTyp) rows = rows.filter(f => f.typ === fTyp);
  if (fStatus) rows = rows.filter(f => f.status === fStatus);
  if (fGruppe) rows = rows.filter(f => f.kulturgruppe_id === fGruppe);
  const val = (f) => {
    switch (sortCol) {
      case 'betrieb': return f.betrieb_name || '';
      case 'parzelle': return f.nummer || '';
      case 'typ': return f.typ + f.schweregrad;
      case 'ha': return Number(f.ueberlappung_ha) || 0;
      case 'status': return f.status;
      default: return f.jahr || 0;
    }
  };
  return rows.slice().sort((a, b) => {
    const va = val(a), vb = val(b);
    const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'de', { numeric: true });
    return c * sortDir;
  });
}

export async function renderFFFlags(el) {
  const rows = gefiltert();
  const offen = ffState.flags.filter(f => f.status === 'offen');
  const th = (col, label) => `<th class="sortierbar" onclick="ffFlagSort('${col}')">${label}${sortCol === col ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  const sel = (id, val, opts, onchange) =>
    `<select id="${id}" onchange="${onchange}"><option value="">alle</option>${opts}</select>`;
  el.innerHTML = `
    <div class="card">
      <div class="ff-tab-kopf">
        <b>${offen.length} offen, davon ${offen.filter(f => f.schweregrad === 'hoch').length} hoch</b>
        ${sel('ff-fl-betrieb', fBetrieb, ffState.betriebe.map(b => `<option value="${b.id}" ${b.id === fBetrieb ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join(''), 'ffFlagFilter(\'betrieb\', this.value)')}
        ${sel('ff-fl-jahr', fJahr, ffState.jahre.map(j => `<option value="${j.id}" ${j.id === fJahr ? 'selected' : ''}>${j.jahr}</option>`).join(''), 'ffFlagFilter(\'jahr\', this.value)')}
        <select onchange="ffFlagFilter('typ', this.value)">
          <option value="">Typ/Schweregrad: alle</option>
          <option value="selbstfolge" ${fTyp === 'selbstfolge' ? 'selected' : ''}>Selbstfolge</option>
          <option value="anbaupause" ${fTyp === 'anbaupause' ? 'selected' : ''}>Anbaupause</option>
          <option value="hoch" ${fTyp === 'hoch' ? 'selected' : ''}>Schweregrad hoch</option>
          <option value="mittel" ${fTyp === 'mittel' ? 'selected' : ''}>Schweregrad mittel</option>
        </select>
        ${sel('ff-fl-gruppe', fGruppe, ffState.kulturgruppen.map(g => `<option value="${g.id}" ${g.id === fGruppe ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join(''), 'ffFlagFilter(\'gruppe\', this.value)')}
        <select onchange="ffFlagFilter('status', this.value)">
          <option value="" ${!fStatus ? 'selected' : ''}>Status: alle</option>
          <option value="offen" ${fStatus === 'offen' ? 'selected' : ''}>offen</option>
          <option value="akzeptiert" ${fStatus === 'akzeptiert' ? 'selected' : ''}>akzeptiert</option>
        </select>
        <button class="btn btn-sm" onclick="ffFlagsNeuBerechnen()">Neu berechnen</button>
        <button class="btn btn-sm" onclick="ffFlagsCSV()">CSV-Export</button>
      </div>
      <div class="ff-tabelle-wrap"><table class="ff-tabelle">
        <thead><tr>${th('betrieb', 'Betrieb')}${th('parzelle', 'Parzelle')}${th('jahr', 'Jahr')}<th>Konfliktjahr</th><th>Kulturgruppe</th>${th('typ', 'Typ')}${th('ha', 'Überlappung')}${th('status', 'Status')}<th>Kommentar</th><th></th></tr></thead>
        <tbody>${rows.map(f => `
          <tr class="${f.status === 'akzeptiert' ? 'ff-flag-akzeptiert' : ''}">
            <td>${escapeHtml(f.betrieb_kuerzel || f.betrieb_name)}</td>
            <td><a href="#" onclick="ffFlagZuParzelle(${f.jahr_id}, ${f.parzelle_id});return false"><b>${escapeHtml(f.nummer)}</b> ${escapeHtml(f.parzelle_name || '')}</a></td>
            <td>${f.jahr}</td>
            <td>${f.konflikt_jahr} <span style="opacity:.6">(${escapeHtml(f.konflikt_kultur || '')}, Nr. ${escapeHtml(f.konflikt_nummer || '')})</span></td>
            <td>${escapeHtml(f.kulturgruppe_name || '')}</td>
            <td><span class="${f.schweregrad === 'hoch' ? 'ff-flag-hoch' : 'ff-flag-mittel'}">⚠ ${f.typ === 'selbstfolge' ? 'Selbstfolge' : 'Anbaupause'}</span></td>
            <td>${Number(f.ueberlappung_ha ?? 0).toFixed(2)} ha · ${Math.round(f.ueberlappung_prozent ?? 0)} %</td>
            <td>${f.status}</td>
            <td>${escapeHtml(f.kommentar || '')}</td>
            <td>${f.status === 'offen'
              ? `<button class="btn btn-sm" onclick="ffFlagAkzeptieren(${f.id})">Akzeptieren</button>`
              : `<button class="btn btn-sm" onclick="ffFlagOeffnen(${f.id})">Wieder öffnen</button>`}</td>
          </tr>`).join('') || '<tr><td colspan="10" style="padding:14px">Keine Flags für die gewählten Filter. 👍</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

export function ffFlagFilter(feld, val) {
  const v = val ? parseInt(val) : null;
  if (feld === 'betrieb') fBetrieb = v;
  else if (feld === 'jahr') fJahr = v;
  else if (feld === 'gruppe') fGruppe = v;
  else if (feld === 'typ') fTyp = val || null;
  else if (feld === 'status') fStatus = val || null;
  renderFruchtfolge();
}

export function ffFlagSort(col) {
  if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = 1; }
  renderFruchtfolge();
}

export async function ffFlagAkzeptieren(id) {
  const kommentar = prompt('Kommentar zur Akzeptanz (warum ist der Konflikt in Ordnung?):');
  if (kommentar === null) return;
  try {
    const { error } = await getSb().from('flags')
      .update({ status: 'akzeptiert', kommentar: kommentar || null }).eq('id', id);
    if (error) throw error;
    await ffLoadStammdaten(true);
    renderFruchtfolge();
  } catch (err) { console.error(err); showToast('Fehler: ' + err.message); }
}

export async function ffFlagOeffnen(id) {
  try {
    const { error } = await getSb().from('flags').update({ status: 'offen' }).eq('id', id);
    if (error) throw error;
    await ffLoadStammdaten(true);
    renderFruchtfolge();
  } catch (err) { console.error(err); showToast('Fehler: ' + err.message); }
}

export async function ffFlagsNeuBerechnen() {
  showToast('Berechne Flags neu…');
  await ffRecompute();
  renderFruchtfolge();
}

// Klick auf Parzelle → in die Karte des betroffenen Jahres springen
export function ffFlagZuParzelle(jahrId, parzelleId) {
  ffState.jahrId = jahrId;
  ffState.view = 'karte';
  window._ffFokusParzelle = parzelleId;
  renderFruchtfolge();
}

export function ffFlagsCSV() {
  const rows = gefiltert();
  const zeilen = [
    ['Betrieb', 'Parzelle', 'Name', 'Jahr', 'Konfliktjahr', 'Konflikt-Parzelle', 'Kulturgruppe', 'Typ', 'Schweregrad', 'Überlappung ha', 'Überlappung %', 'Status', 'Kommentar'],
    ...rows.map(f => [f.betrieb_name, f.nummer, f.parzelle_name || '', f.jahr, f.konflikt_jahr, f.konflikt_nummer || '',
      f.kulturgruppe_name || '', f.typ, f.schweregrad,
      String(f.ueberlappung_ha ?? '').replace('.', ','), String(f.ueberlappung_prozent ?? '').replace('.', ','),
      f.status, f.kommentar || '']),
  ];
  const csv = zeilen.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'fruchtfolge_flags.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
