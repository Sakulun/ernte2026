// Fruchtfolge: Import der Agrarantrags-Export-ZIPs (UI + Übernahme nach Supabase)
import { getSb } from './db.js?v=129';
import { showToast, escapeHtml } from './helpers.js?v=129';
import { ffState, ffLoadStammdaten, ffRecompute, ffInvalidateJahr, renderFruchtfolge } from './fruchtfolge.js?v=129';
import { parseAgrarantragZip } from './ff-import-parser.js?v=129';

// Geparste, noch nicht übernommene Pakete (Index = Anzeige-Reihenfolge)
let pakete = [];

export async function renderFFImport(el) {
  el.innerHTML = `
    <div class="card">
      <h3>Agrarantrags-Export importieren</h3>
      <p style="opacity:.75;margin-top:4px">Ein ZIP je Betrieb und Antragsjahr (profil inet Export: <code>&lt;BNR&gt;.nn.xml</code>,
      Flächenübersicht-XLSX, Shapefiles). Mehrere ZIPs gleichzeitig möglich.</p>
      <div class="ff-dropzone" id="ff-dropzone">
        <div style="font-size:28px">⇪</div>
        <div>ZIP-Dateien hierher ziehen oder klicken zum Auswählen</div>
        <input type="file" id="ff-import-files" accept=".zip" multiple style="display:none">
      </div>
    </div>
    <div id="ff-import-pakete">${pakete.map((p, i) => paketHtml(p, i)).join('')}</div>`;

  const dz = document.getElementById('ff-dropzone');
  const inp = document.getElementById('ff-import-files');
  dz.addEventListener('click', () => inp.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('drag');
    ffImportDateien([...e.dataTransfer.files]);
  });
  inp.addEventListener('change', (e) => ffImportDateien([...e.target.files]));
}

export async function ffImportDateien(files) {
  for (const f of files) {
    if (!/\.zip$/i.test(f.name)) { showToast(`${f.name}: keine ZIP-Datei`); continue; }
    try {
      const parsed = await parseAgrarantragZip(f);
      pakete.push({
        datei: f.name,
        parsed,
        jahr: parsed.jahr,
        betriebId: ffState.betriebe.find(b => b.bnr === parsed.bnr)?.id || null,
        neuBetrieb: { name: '', kuerzel: '', farbe: '#4a8ab0' },
        status: 'vorschau',
      });
    } catch (e) {
      pakete.push({ datei: f.name, fehler: e.message, status: 'fehler' });
    }
  }
  renderFruchtfolge();
}

function unbekannteNCs(parsed) {
  const bekannt = new Set(ffState.nutzungscodes.map(n => n.nc));
  const ncs = new Map();
  for (const p of parsed.parzellen) {
    if (p.nutzungscode != null && !bekannt.has(p.nutzungscode)) {
      ncs.set(p.nutzungscode, p.nutzBezeichnung || '');
    }
  }
  for (const n of parsed.nebennutzungen) {
    if (n.nutzungscode != null && !bekannt.has(n.nutzungscode)) {
      if (!ncs.has(n.nutzungscode)) ncs.set(n.nutzungscode, '');
    }
  }
  return [...ncs.entries()].sort((a, b) => a[0] - b[0]);
}

function paketHtml(p, i) {
  if (p.status === 'fehler') {
    return `<div class="card ff-paket"><b>${escapeHtml(p.datei)}</b>
      <div class="ff-import-fehler">Import nicht möglich: ${escapeHtml(p.fehler)}</div>
      <button class="btn" onclick="ffPaketEntfernen(${i})">Entfernen</button></div>`;
  }
  if (p.status === 'fertig') {
    return `<div class="card ff-paket"><b>${escapeHtml(p.datei)}</b>
      <div style="color:var(--green,#6b8f4e)">✔ Übernommen: ${p.parsed.parzellen.length} Parzellen für ${p.jahr}</div></div>`;
  }
  const parsed = p.parsed;
  const summe = parsed.parzellen.reduce((s, x) => s + (x.nettoHa || 0), 0);
  const mitGeom = parsed.parzellen.filter(x => x.ewkt).length;
  const unbekannt = unbekannteNCs(parsed);
  const betriebOpts = ffState.betriebe.map(b =>
    `<option value="${b.id}" ${b.id === p.betriebId ? 'selected' : ''}>${escapeHtml(b.name)} (${escapeHtml(b.bnr)})</option>`).join('');
  const ncName = (nc) => {
    const k = ffState.nutzungscodes.find(n => n.nc === nc);
    return k ? (ffState.kulturen.find(x => x.id === k.kultur_id)?.name || k.bezeichnung) : null;
  };
  const zeilen = parsed.parzellen.map(x => `
    <tr>
      <td>${escapeHtml(x.nummer)}</td>
      <td>${escapeHtml(x.name || '')}</td>
      <td style="text-align:right">${(x.nettoHa ?? 0).toFixed(4)}</td>
      <td>${x.nutzungscode ?? ''}</td>
      <td>${escapeHtml(ncName(x.nutzungscode) || x.nutzBezeichnung || '')}${x.nutzungscode != null && !ncName(x.nutzungscode) ? ' <span class="ff-nc-unbekannt">unbekannt</span>' : ''}</td>
      <td>${x.ewkt ? '✔' : '<span class="ff-nc-unbekannt">fehlt</span>'}</td>
    </tr>`).join('');
  return `
  <div class="card ff-paket" id="ff-paket-${i}">
    <div class="ff-paket-kopf">
      <b>${escapeHtml(p.datei)}</b>
      <span>BNR <code>${escapeHtml(parsed.bnr)}</code> · Quelle: ${parsed.quelle === 'xml' ? 'Flächenantrag-XML' : 'Shapefile-Fallback'}</span>
    </div>
    <div class="ff-paket-form">
      <label>Betrieb:
        <select id="ff-betrieb-${i}" onchange="ffPaketBetrieb(${i}, this.value)">
          <option value="">— Neuen Betrieb anlegen —</option>${betriebOpts}
        </select>
      </label>
      ${!p.betriebId ? `
        <span class="ff-neubetrieb">
          <input id="ff-nb-name-${i}" placeholder="Betriebsname" value="${escapeHtml(p.neuBetrieb.name)}">
          <input id="ff-nb-kuerzel-${i}" placeholder="Kürzel" maxlength="8" style="width:70px" value="${escapeHtml(p.neuBetrieb.kuerzel)}">
          <input id="ff-nb-farbe-${i}" type="color" value="${escapeHtml(p.neuBetrieb.farbe)}" title="Betriebsfarbe">
        </span>` : ''}
      <label>Antragsjahr:
        <input id="ff-jahr-${i}" type="number" min="2000" max="2100" value="${p.jahr ?? ''}" style="width:90px"
          ${parsed.quelle === 'xml' ? 'readonly title="aus XML erkannt"' : ''}>
      </label>
    </div>
    <div class="ff-paket-summen">
      ${parsed.parzellen.length} Parzellen · Σ ${summe.toFixed(2)} ha netto · ${mitGeom} Geometrien
      ${parsed.nebennutzungen.length ? ` · ${parsed.nebennutzungen.length} Nebennutzungen` : ''}
    </div>
    ${parsed.fehler?.length ? `<div class="ff-import-fehler">${parsed.fehler.map(escapeHtml).join('<br>')}</div>` : ''}
    ${unbekannt.length ? `
      <div class="ff-nc-quickadd">
        <b>Unbekannte Nutzungscodes</b> — vor der Übernahme anlegen:
        ${unbekannt.map(([nc, bez]) => `
          <div class="ff-nc-zeile" id="ff-nc-${i}-${nc}">
            <code>${nc}</code>
            <input id="ff-ncbez-${i}-${nc}" placeholder="Bezeichnung" value="${escapeHtml(bez)}">
            <select id="ff-nckultur-${i}-${nc}">
              <option value="">Kultur zuordnen…</option>
              ${ffState.kulturen.map(k => `<option value="${k.id}">${escapeHtml(k.name)}</option>`).join('')}
            </select>
            <label title="Zählt für Selbstfolge/Anbaupause"><input type="checkbox" id="ff-ncrel-${i}-${nc}" checked> FF-relevant</label>
            <button class="btn btn-sm" onclick="ffNcQuickAdd(${i}, ${nc})">Anlegen</button>
          </div>`).join('')}
      </div>` : ''}
    <details style="margin-top:8px"><summary>Parzellen-Vorschau (${parsed.parzellen.length})</summary>
      <div class="ff-tabelle-wrap"><table class="ff-tabelle">
        <thead><tr><th>Nr.</th><th>Name</th><th style="text-align:right">Netto ha</th><th>NC</th><th>Nutzung</th><th>Geom.</th></tr></thead>
        <tbody>${zeilen}</tbody>
      </table></div>
    </details>
    <div style="margin-top:10px;display:flex;gap:8px">
      <button class="btn btn-primary" onclick="ffPaketUebernehmen(${i})" ${unbekannt.length ? 'disabled title="Erst unbekannte Nutzungscodes anlegen"' : ''}>Übernehmen</button>
      <button class="btn" onclick="ffPaketEntfernen(${i})">Verwerfen</button>
    </div>
  </div>`;
}

export function ffPaketBetrieb(i, val) {
  pakete[i].betriebId = val ? parseInt(val) : null;
  renderFruchtfolge();
}

export function ffPaketEntfernen(i) {
  pakete.splice(i, 1);
  renderFruchtfolge();
}

// Unbekannten Nutzungscode direkt aus der Vorschau anlegen
export async function ffNcQuickAdd(i, nc) {
  const bez = document.getElementById(`ff-ncbez-${i}-${nc}`)?.value?.trim();
  const kulturId = document.getElementById(`ff-nckultur-${i}-${nc}`)?.value;
  const relevant = document.getElementById(`ff-ncrel-${i}-${nc}`)?.checked ?? true;
  if (!bez) { showToast('Bitte Bezeichnung angeben'); return; }
  if (!kulturId) { showToast('Bitte eine Kultur zuordnen (ggf. unter Stammdaten neue Kultur anlegen)'); return; }
  const sb = getSb();
  try {
    const { error } = await sb.from('nutzungscodes').insert({
      nc, bezeichnung: bez, kultur_id: parseInt(kulturId), fruchtfolge_relevant: relevant,
    });
    if (error) throw error;
    await ffLoadStammdaten(true);
    showToast(`Nutzungscode ${nc} angelegt`);
    renderFruchtfolge();
  } catch (err) {
    console.error(err);
    showToast('Anlegen fehlgeschlagen: ' + err.message);
  }
}

export async function ffPaketUebernehmen(i) {
  const p = pakete[i];
  // Doppelklick-Schutz: eine laufende Übernahme desselben Pakets nicht erneut
  // starten – sonst entstehen doppelte Parzellen (Count-Prüfung sähe noch 0).
  if (p.laeuft || p.status === 'fertig') return;
  p.laeuft = true;
  const btn = document.querySelector(`#ff-paket-${i} .btn-primary`);
  if (btn) { btn.disabled = true; btn.textContent = 'Übernehme…'; }
  const fertigMachen = () => {
    p.laeuft = false;
    if (btn && document.body.contains(btn)) { btn.disabled = false; btn.textContent = 'Übernehmen'; }
  };
  const parsed = p.parsed;
  const sb = getSb();
  const jahrVal = parseInt(document.getElementById(`ff-jahr-${i}`)?.value, 10);
  if (!jahrVal || jahrVal < 2000 || jahrVal > 2100) { showToast('Bitte gültiges Antragsjahr angeben'); fertigMachen(); return; }

  try {
    // 1) Betrieb ermitteln oder anlegen
    let betriebId = p.betriebId;
    if (!betriebId) {
      const name = document.getElementById(`ff-nb-name-${i}`)?.value?.trim();
      const kuerzel = document.getElementById(`ff-nb-kuerzel-${i}`)?.value?.trim();
      const farbe = document.getElementById(`ff-nb-farbe-${i}`)?.value || '#4a8ab0';
      if (!name) { showToast('Bitte Namen für den neuen Betrieb angeben'); return; }
      const { data, error } = await sb.from('betriebe')
        .insert({ bnr: parsed.bnr, name, kuerzel: kuerzel || name.slice(0, 4), farbe }).select().single();
      if (error) throw error;
      betriebId = data.id;
    }

    // 2) Jahr ermitteln oder anlegen; Planjahr-Kollision abfragen
    let { data: jahrRow, error: je } = await sb.from('jahre').select('*').eq('jahr', jahrVal).maybeSingle();
    if (je) throw je;
    if (jahrRow?.typ === 'plan') {
      if (!confirm(`Für ${jahrVal} existiert ein Planjahr. Soll der Plan für diesen Betrieb durch den Import ersetzt werden?\n(Das Jahr wird zum Antragsjahr; geplante Kulturen dieses Betriebs gehen verloren.)`)) { fertigMachen(); return; }
      const { error } = await sb.from('jahre').update({ typ: 'antrag', quelle_jahr_id: null }).eq('id', jahrRow.id);
      if (error) throw error;
      jahrRow.typ = 'antrag';
    }
    if (!jahrRow) {
      const { data, error } = await sb.from('jahre').insert({ jahr: jahrVal, typ: 'antrag' }).select().single();
      if (error) throw error;
      jahrRow = data;
    }

    // 3) Bestehenden Import (Betrieb, Jahr) ersetzen? → Rückfrage, dann löschen
    const { count, error: ce } = await sb.from('parzellen')
      .select('id', { count: 'exact', head: true })
      .eq('betrieb_id', betriebId).eq('jahr_id', jahrRow.id);
    if (ce) throw ce;
    if (count > 0) {
      if (!confirm(`Für diesen Betrieb existieren bereits ${count} Parzellen im Jahr ${jahrVal}. Import komplett ersetzen?`)) { fertigMachen(); return; }
      const { error } = await sb.from('parzellen').delete().eq('betrieb_id', betriebId).eq('jahr_id', jahrRow.id);
      if (error) throw error;
    }

    // 4) Parzellen einfügen (Geometrie als EWKT, Transformation macht der DB-Trigger)
    const ncMap = {};
    for (const n of ffState.nutzungscodes) ncMap[n.nc] = n.kultur_id;
    const rows = parsed.parzellen.map(x => ({
      betrieb_id: betriebId, jahr_id: jahrRow.id,
      nummer: x.nummer, name: x.name || '', flik: x.flik,
      brutto_ha: x.bruttoHa, netto_ha: x.nettoHa,
      nutzungscode: x.nutzungscode, kultur_id: x.nutzungscode != null ? (ncMap[x.nutzungscode] ?? null) : null,
      oer_code: x.oerCode, sorte: x.sorte, vorjahr_nummer: x.vorjahrNummer,
      geom_25832: x.ewkt, quelle: 'import',
    }));
    const idByNummer = {};
    for (let off = 0; off < rows.length; off += 25) {
      const chunk = rows.slice(off, off + 25);
      const { data, error } = await sb.from('parzellen').insert(chunk).select('id,nummer');
      if (error) throw error;
      for (const d of data) idByNummer[d.nummer] = d.id;
    }

    // 5) Nebennutzungen (Zwischenfrüchte/Zweitkulturen)
    const nbRows = parsed.nebennutzungen
      .map(n => {
        const pid = idByNummer[n.parzellenNummer] || idByNummer[n.teilflaechenNummer];
        if (!pid) return null;
        return {
          parzelle_id: pid, kultur_id: ncMap[n.nutzungscode] ?? null,
          nutzungscode: n.nutzungscode, flaeche_ha: n.flaecheHa, typ: 'zwischenfrucht',
        };
      }).filter(Boolean);
    if (nbRows.length) {
      const { error } = await sb.from('parzellen_nebenkulturen').insert(nbRows);
      if (error) throw error;
    }

    // 6) Bestehende Planjahre um diesen Betrieb ergänzen, falls er dort noch fehlt
    //    (z.B. Import kam erst nach dem Anlegen des Planjahres)
    let planErgaenzt = 0;
    try {
      const { data: ext, error: extErr } = await sb.rpc('ff_extend_planjahre', { p_betrieb_id: betriebId });
      if (extErr) throw extErr;
      planErgaenzt = ext || 0;
    } catch (e) { console.error('Planjahr-Ergänzung:', e); }

    // 7) Neu berechnen + Caches leeren
    p.status = 'fertig';
    p.jahr = jahrVal;
    ffInvalidateJahr(jahrRow.id);
    if (planErgaenzt) ffState.parzellenCache = {};
    await ffLoadStammdaten(true);
    showToast(`Import übernommen: ${rows.length} Parzellen (${jahrVal})` +
      (planErgaenzt ? ` – ${planErgaenzt} Parzellen ins Planjahr ergänzt` : ''));
    renderFruchtfolge();
    await ffRecompute();
    renderFruchtfolge();
  } catch (err) {
    console.error(err);
    showToast('Übernahme fehlgeschlagen: ' + err.message);
  } finally {
    fertigMachen();
  }
}
