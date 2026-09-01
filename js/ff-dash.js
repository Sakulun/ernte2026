// Fruchtfolge: Anbauverhältnis-Dashboard – Kulturanteile in ha/% je Jahr,
// Kultur-/Gruppen-Ebene, Jahresvergleich, CSV-Export. Diagramme als Inline-SVG.
import { showToast, escapeHtml } from './helpers.js?v=130';
import { ffState, ffLoadParzellen, ffGefilterteParzellen, renderFruchtfolge } from './fruchtfolge.js?v=130';

let ebene = 'kultur';        // 'kultur' | 'gruppe'
let vergleichsJahre = new Set(); // jahr_id für den Jahresvergleich

function anteile(parzellen) {
  const map = new Map();
  for (const p of parzellen) {
    const key = ebene === 'gruppe' ? (p.kulturgruppe_id ?? 0) : (p.kultur_id ?? 0);
    const name = ebene === 'gruppe' ? (p.kulturgruppe_name || 'ohne Gruppe') : (p.kultur_name || 'ohne Kultur');
    const farbe = ebene === 'gruppe' ? (p.kulturgruppe_farbe || '#ffffff') : (p.kultur_farbe || '#ffffff');
    if (!map.has(key)) map.set(key, { name, farbe, ha: 0 });
    map.get(key).ha += Number(p.netto_ha) || 0;
  }
  const sum = [...map.values()].reduce((s, x) => s + x.ha, 0) || 1;
  return [...map.values()].map(x => ({ ...x, prozent: x.ha / sum * 100 })).sort((a, b) => b.ha - a.ha);
}

// Balken als HTML statt SVG: Schrift bleibt in fester, lesbarer Größe,
// egal wie viele Kategorien es gibt oder wie breit der Bildschirm ist.
function balkenHtml(daten) {
  const max = Math.max(...daten.map(d => d.ha), 1);
  return `<div class="ff-db">
    ${daten.map(d => `
      <div class="ff-db-zeile">
        <span class="ff-db-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</span>
        <div class="ff-db-bar"><div style="width:${Math.max(1, d.ha / max * 100).toFixed(1)}%;background:${escapeHtml(d.farbe)}"></div></div>
        <span class="ff-db-wert">${d.ha.toFixed(1)} ha · ${d.prozent.toFixed(1)} %</span>
      </div>`).join('')}
  </div>`;
}

function tortenSvg(daten) {
  const cx = 90, cy = 90, r = 80;
  let winkel = -Math.PI / 2;
  const teile = daten.map(d => {
    const a0 = winkel;
    const a1 = winkel + d.prozent / 100 * Math.PI * 2;
    winkel = a1;
    const gross = (a1 - a0) > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    if (d.prozent >= 99.95) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${escapeHtml(d.farbe)}"><title>${escapeHtml(d.name)}</title></circle>`;
    return `<path d="M${cx} ${cy} L${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${gross} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z"
      fill="${escapeHtml(d.farbe)}" stroke="rgba(0,0,0,.25)" stroke-width="1"><title>${escapeHtml(d.name)}: ${d.prozent.toFixed(1)} %</title></path>`;
  }).join('');
  return `<svg viewBox="0 0 180 180" style="width:180px;height:180px">${teile}</svg>`;
}

export async function renderFFDashboard(el) {
  const jahre = ffState.jahre;
  if (!jahre.length) {
    el.innerHTML = '<div class="card"><p>Noch keine Jahre vorhanden – zuerst importieren.</p></div>';
    return;
  }
  const jahrId = ffState.jahrId || jahre[jahre.length - 1].id;
  ffState.jahrId = jahrId;
  const parzellen = ffGefilterteParzellen(await ffLoadParzellen(jahrId));
  const daten = anteile(parzellen);
  const sumHa = daten.reduce((s, d) => s + d.ha, 0);

  // Jahresvergleich: Daten aller ausgewählten Jahre laden
  const vgl = [...vergleichsJahre].filter(id => jahre.some(j => j.id === id));
  const vglDaten = [];
  for (const id of vgl) {
    vglDaten.push({ jahr: jahre.find(j => j.id === id), daten: anteile(ffGefilterteParzellen(await ffLoadParzellen(id))) });
  }

  let vglHtml = '';
  if (vglDaten.length >= 1) {
    const alleNamen = new Map();
    for (const v of vglDaten) for (const d of v.daten) if (!alleNamen.has(d.name)) alleNamen.set(d.name, d.farbe);
    const namen = [...alleNamen.keys()];
    const maxHa = Math.max(...vglDaten.flatMap(v => v.daten.map(d => d.ha)), 1);
    const gw = 28, gap = 12;
    const gruppenBreite = vglDaten.length * gw + gap;
    const w = Math.max(300, namen.length * gruppenBreite + 40);
    vglHtml = `<div class="card"><h4>Jahresvergleich (${vglDaten.map(v => v.jahr.jahr).join(', ')})</h4>
      <div style="overflow-x:auto"><svg viewBox="0 0 ${w} 240" style="min-width:${w}px;height:240px">
      ${namen.map((name, ni) => {
        const x0 = 20 + ni * gruppenBreite;
        return vglDaten.map((v, vi) => {
          const d = v.daten.find(x => x.name === name);
          const ha = d ? d.ha : 0;
          const bh = ha / maxHa * 160;
          return `<rect x="${x0 + vi * gw}" y="${180 - bh}" width="${gw - 4}" height="${Math.max(1, bh)}" fill="${escapeHtml(alleNamen.get(name))}"
            opacity="${0.55 + 0.45 * (vi + 1) / vglDaten.length}"><title>${escapeHtml(name)} ${v.jahr.jahr}: ${ha.toFixed(1)} ha</title></rect>`;
        }).join('') +
        `<text x="${x0}" y="${196 + (ni % 2) * 13}" font-size="10" fill="currentColor">${escapeHtml(name.slice(0, Math.ceil(gruppenBreite / 6)))}</text>`;
      }).join('')}
      </svg></div>
      <div style="opacity:.7;font-size:12px">Balken je Kategorie von links (ältestes gewähltes Jahr) nach rechts; hellere Balken = frühere Jahre.</div>
    </div>`;
  }

  el.innerHTML = `
    <div class="card">
      <div class="ff-tab-kopf">
        <select onchange="ffDashJahr(parseInt(this.value))">
          ${jahre.map(j => `<option value="${j.id}" ${j.id === jahrId ? 'selected' : ''}>${j.jahr}${j.typ === 'plan' ? ' (Plan)' : ''}</option>`).join('')}
        </select>
        <span class="ff-chip-gruppe">
          <button class="ff-chip ${ebene === 'kultur' ? 'active' : ''}" onclick="ffDashEbene('kultur')">Kulturen</button>
          <button class="ff-chip ${ebene === 'gruppe' ? 'active' : ''}" onclick="ffDashEbene('gruppe')">Kulturgruppen</button>
        </span>
        <button class="btn btn-sm" onclick="ffDashCSV()">CSV-Export</button>
        <span style="opacity:.7">Σ ${sumHa.toFixed(1)} ha (${parzellen.length} Parzellen; Betriebsauswahl über die Filterleiste)</span>
      </div>
      <div class="ff-dash-diagramme">
        <div style="flex:1;min-width:320px">${balkenHtml(daten)}</div>
        <div>${tortenSvg(daten)}</div>
      </div>
      <div class="ff-tabelle-wrap"><table class="ff-tabelle">
        <thead><tr><th>${ebene === 'gruppe' ? 'Kulturgruppe' : 'Kultur'}</th><th style="text-align:right">ha</th><th style="text-align:right">%</th></tr></thead>
        <tbody>${daten.map(d => `<tr>
          <td><span class="ff-legende-farbe" style="background:${escapeHtml(d.farbe)}"></span> ${escapeHtml(d.name)}</td>
          <td style="text-align:right">${d.ha.toFixed(2)}</td>
          <td style="text-align:right">${d.prozent.toFixed(1)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="card">
      <h4>Jahresvergleich</h4>
      <div class="ff-chip-gruppe">
        ${jahre.map(j => `<button class="ff-chip ${vergleichsJahre.has(j.id) ? 'active' : ''}"
          onclick="ffDashVergleich(${j.id})">${j.jahr}${j.typ === 'plan' ? ' 📝' : ''}</button>`).join('')}
      </div>
    </div>
    ${vglHtml}`;
}

export function ffDashJahr(jahrId) { ffState.jahrId = jahrId; renderFruchtfolge(); }
export function ffDashEbene(e) { ebene = e; renderFruchtfolge(); }
export function ffDashVergleich(jahrId) {
  if (vergleichsJahre.has(jahrId)) vergleichsJahre.delete(jahrId);
  else vergleichsJahre.add(jahrId);
  renderFruchtfolge();
}

export function ffDashCSV() {
  const jahr = ffState.jahre.find(j => j.id === ffState.jahrId);
  const parzellen = ffGefilterteParzellen(ffState.parzellenCache[ffState.jahrId] || []);
  const daten = anteile(parzellen);
  const zeilen = [
    ['Jahr', ebene === 'gruppe' ? 'Kulturgruppe' : 'Kultur', 'ha', 'Prozent'],
    ...daten.map(d => [jahr?.jahr ?? '', d.name, d.ha.toFixed(4).replace('.', ','), d.prozent.toFixed(2).replace('.', ',')]),
  ];
  const csv = zeilen.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `anbauverhaeltnis_${jahr?.jahr ?? ''}_${ebene}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('CSV exportiert');
}
