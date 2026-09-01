// Fruchtfolge: Matrix – Zeilen = Parzellen des Leitjahres (nach Betrieb gruppiert),
// Spalten = alle Jahre. Zellen aus dem geometrischen Matching, farbcodiert nach Kultur.
import { getSb } from './db.js?v=130';
import { showToast, escapeHtml } from './helpers.js?v=130';
import { ffState, ffLoadParzellen, ffEnsureMatching, ffGefilterteParzellen, ffJahr,
         ffIstPlanjahr, ffSetKultur, ffInvalidateJahr, ffRecompute, renderFruchtfolge,
         ffOffeneFlags } from './fruchtfolge.js?v=130';

let zugeklappt = new Set(); // eingeklappte betrieb_id
let alleNeben = null;       // parzelle_id → [nebenkulturen]

async function ladeAlleNeben() {
  if (alleNeben) return alleNeben;
  try {
    alleNeben = {};
    // Seitenweise laden – PostgREST liefert max. 1000 Zeilen pro Request
    for (let from = 0; ; from += 1000) {
      const { data, error } = await getSb().from('parzellen_nebenkulturen')
        .select('*').order('id').range(from, from + 999);
      if (error) throw error;
      for (const n of data) (alleNeben[n.parzelle_id] ||= []).push(n);
      if (data.length < 1000) break;
    }
  } catch (err) { console.error(err); alleNeben = {}; }
  return alleNeben;
}
export function ffMatrixNebenInvalidate() { alleNeben = null; }

// Helle Schrift auf dunklen Kulturfarben (relative Luminanz der Hex-Farbe)
function istDunkel(hex) {
  let h = String(hex || '').replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/i.test(h)) return false;
  const n = parseInt(h, 16);
  const luma = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return luma < 140;
}

export async function renderFFMatrix(el) {
  const jahre = ffState.jahre;
  if (!jahre.length) {
    el.innerHTML = '<div class="card"><p>Noch keine Jahre vorhanden – zuerst importieren.</p></div>';
    return;
  }
  const leitId = ffState.leitjahrId;
  el.innerHTML = '<div class="card"><p>Berechne Matrix…</p></div>';
  const [parzellen, matching, neben] = [
    ffGefilterteParzellen(await ffLoadParzellen(leitId)),
    await ffEnsureMatching(leitId),
    await ladeAlleNeben(),
  ];

  // Matching nach (leitParzelle, jahr) bündeln
  const zellen = {}; // `${leitId}:${jahrId}` → [match…]
  for (const m of matching) (zellen[`${m.leit_parzelle_id}:${m.jahr_id}`] ||= []).push(m);

  const offeneFlags = ffOffeneFlags();
  const flagsByParzelle = {};
  for (const f of offeneFlags) (flagsByParzelle[f.parzelle_id] ||= []).push(f);

  // Nach Betrieb gruppieren
  const gruppen = new Map();
  for (const p of parzellen) {
    if (!gruppen.has(p.betrieb_id)) gruppen.set(p.betrieb_id, { name: p.betrieb_name, farbe: p.betrieb_farbe, rows: [] });
    gruppen.get(p.betrieb_id).rows.push(p);
  }

  const jahrCols = jahre;
  const kopf = `<tr><th class="ff-mx-parzelle">Parzelle (${ffJahr(leitId)?.jahr ?? ''})</th>` +
    jahrCols.map(j => `<th class="${j.typ === 'plan' ? 'ff-mx-plan' : ''} ${j.id === leitId ? 'ff-mx-leit' : ''}">${j.jahr}${j.typ === 'plan' ? ' 📝' : ''}</th>`).join('') + '</tr>';

  const zelleHtml = (p, j) => {
    // Leitjahr-Spalte: die Parzelle selbst; andere Jahre: gematchte Parzellen
    let eintraege;
    if (j.id === leitId) {
      eintraege = [{ parzelle_id: p.id, kultur_id: p.kultur_id, kultur_name: p.kultur_name,
        kultur_kuerzel: p.kultur_kuerzel, kultur_farbe: p.kultur_farbe, anteil_prozent: 100, nummer: p.nummer, sorte: p.sorte }];
    } else {
      eintraege = (zellen[`${p.id}:${j.id}`] || []).slice().sort((a, b) => b.anteil_prozent - a.anteil_prozent);
    }
    if (!eintraege.length) return `<td class="ff-mx-zelle leer ${j.typ === 'plan' ? 'ff-mx-plan' : ''}"></td>`;
    const dom = eintraege[0];
    const farbe = dom.kultur_farbe || '#ffffff';
    let bg = `background:${farbe}`;
    if (eintraege.length > 1 && eintraege[1].kultur_id !== dom.kultur_id) {
      const f2 = eintraege[1].kultur_farbe || '#ffffff';
      const cut = Math.max(20, Math.min(80, Math.round(dom.anteil_prozent)));
      bg = `background:linear-gradient(90deg, ${farbe} ${cut}%, ${f2} ${cut}%)`;
    }
    const flagList = eintraege.flatMap(e => flagsByParzelle[e.parzelle_id] || []);
    const flag = flagList.find(f => f.schweregrad === 'hoch') || flagList[0];
    const nb = eintraege.flatMap(e => neben[e.parzelle_id] || []);
    const tip = eintraege.map(e =>
      `${e.nummer ? e.nummer + ' ' : ''}${e.kultur_name || 'ohne Kultur'} (${Math.round(e.anteil_prozent)} %)${e.sorte ? ', ' + e.sorte : ''}`).join(' | ')
      + (nb.length ? ' | ZF: ' + nb.map(n => ffState.kulturen.find(k => k.id === n.kultur_id)?.name || ('NC ' + n.nutzungscode)).join(', ') : '')
      + (flag ? ` | ⚠ ${flag.typ === 'selbstfolge' ? 'Selbstfolge' : 'Anbaupause'} vs. ${flag.konflikt_jahr}` : '');
    const planbar = j.typ === 'plan';
    const zielParzelle = j.id === leitId ? p.id : (eintraege.length === 1 ? eintraege[0].parzelle_id : null);
    const onclick = planbar && zielParzelle ? `onclick="ffMatrixZelleEdit(this, ${zielParzelle}, ${j.id})"` : '';
    return `<td class="ff-mx-zelle ${planbar ? 'ff-mx-plan planbar' : ''}" style="${bg}" title="${escapeHtml(tip)}" ${onclick}>
      <span class="ff-mx-kuerzel" style="color:${istDunkel(farbe) ? '#fff' : 'rgba(0,0,0,.82)'}">${escapeHtml(dom.kultur_kuerzel || (dom.kultur_name || '').slice(0, 3) || '—')}</span>
      ${eintraege.length > 1 ? `<span class="ff-mx-mix">${eintraege.length}</span>` : ''}
      ${nb.length ? '<span class="ff-mx-zf" title="Zwischenfrucht"></span>' : ''}
      ${flag ? `<span class="ff-mx-flag ${flag.schweregrad === 'hoch' ? 'hoch' : 'mittel'}">⚠</span>` : ''}
    </td>`;
  };

  let body = '';
  for (const [bid, g] of gruppen) {
    const zu = zugeklappt.has(bid);
    const sumHa = g.rows.reduce((s, p) => s + (Number(p.netto_ha) || 0), 0);
    body += `<tr class="ff-mx-gruppe" onclick="ffMatrixGruppeToggle(${bid})">
      <td class="ff-mx-parzelle"><span style="color:${escapeHtml(g.farbe)}">●</span> ${zu ? '▸' : '▾'} <b>${escapeHtml(g.name)}</b>
        <span style="opacity:.6">${g.rows.length} Parzellen · ${sumHa.toFixed(0)} ha</span></td>
      <td colspan="${jahrCols.length}"></td></tr>`;
    if (zu) continue;
    for (const p of g.rows) {
      body += `<tr class="ff-mx-zeile">
        <td class="ff-mx-parzelle"><b>${escapeHtml(p.nummer)}</b> ${escapeHtml(p.name || '')}
          <span style="opacity:.6;white-space:nowrap">${Number(p.netto_ha ?? 0).toFixed(2)} ha</span></td>
        ${jahrCols.map(j => zelleHtml(p, j)).join('')}
      </tr>`;
    }
  }

  el.innerHTML = `
    <div class="ff-mx-wrap">
      <table class="ff-mx">
        <thead>${kopf}</thead>
        <tbody>${body || `<tr><td colspan="${jahrCols.length + 1}" style="padding:16px">Keine Parzellen im Leitjahr (Filter prüfen).</td></tr>`}</tbody>
      </table>
    </div>
    <div class="ff-mx-hinweis">⚠ rot = Selbstfolge · ⚠ orange = Anbaupause verletzt · schmaler Streifen = Zwischenfrucht ·
      Planjahr-Zellen anklicken, um die Kultur zu setzen.</div>`;
}

export function ffMatrixGruppeToggle(betriebId) {
  if (zugeklappt.has(betriebId)) zugeklappt.delete(betriebId);
  else zugeklappt.add(betriebId);
  renderFruchtfolge();
}

// Klick auf Planjahr-Zelle → Inline-Kulturauswahl mit Suche
export function ffMatrixZelleEdit(td, parzelleId, jahrId) {
  if (td.querySelector('select')) return;
  const alt = td.innerHTML;
  const opts = ffState.kulturen.filter(k => k.aktiv !== false)
    .map(k => `<option value="${k.id}">${escapeHtml(k.name)}</option>`).join('');
  td.innerHTML = `<select onchange="ffMatrixKulturSetzen(${parzelleId}, ${jahrId}, this.value)"
      onblur="ffMatrixZelleAbbruch(this, ${JSON.stringify(alt).replace(/"/g, '&quot;')})">
    <option value="">— Kultur —</option>${opts}</select>`;
  td.querySelector('select').focus();
}

export function ffMatrixZelleAbbruch(sel, altHtml) {
  if (sel.value === '') sel.closest('td').innerHTML = altHtml;
}

export async function ffMatrixKulturSetzen(parzelleId, jahrId, kulturIdStr) {
  if (!kulturIdStr) return;
  try {
    await ffSetKultur(parzelleId, parseInt(kulturIdStr));
    ffInvalidateJahr(jahrId);
    showToast('Kultur gespeichert – Flags werden neu berechnet…');
    await ffRecompute();
    renderFruchtfolge();
  } catch (err) {
    console.error(err);
    showToast('Speichern fehlgeschlagen: ' + err.message);
  }
}
