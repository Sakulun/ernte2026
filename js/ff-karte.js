// Fruchtfolge: Kartenansicht (Leaflet). Parzellen in Kulturfarbe des gewählten
// Jahres, Jahres-Umschalter, Legende, Flag-Umrandung, Mini-Historie im Popup.
import { showToast, escapeHtml } from './helpers.js?v=115';
import { ffState, ffLoadParzellen, ffEnsureMatching, ffGefilterteParzellen,
         ffIstPlanjahr, ffSetKultur, ffInvalidateJahr, ffRecompute, renderFruchtfolge,
         ffOffeneFlags } from './fruchtfolge.js?v=115';

let hiddenKulturen = new Set(); // per Legende ausgeblendete kultur_id (0 = ohne Kultur)

export async function renderFFKarte(el) {
  const jahre = ffState.jahre;
  if (!jahre.length) {
    el.innerHTML = '<div class="card"><p>Noch keine Jahre vorhanden – zuerst einen Agrarantrags-Export importieren (Tab „Import").</p></div>';
    return;
  }
  const jahrId = ffState.jahrId || jahre[jahre.length - 1].id;
  ffState.jahrId = jahrId;
  el.innerHTML = `
    <div class="ff-karte-jahre">
      ${jahre.map(j => `<button class="ff-jahr-btn ${j.id === jahrId ? 'active' : ''} ${j.typ === 'plan' ? 'plan' : ''}"
        onclick="ffKarteJahr(${j.id})">${j.jahr}${j.typ === 'plan' ? ' 📝' : ''}</button>`).join('')}
    </div>
    <div style="position:relative">
      <div id="ff-map" class="ff-map"></div>
      <div id="ff-map-legende" class="ff-map-legende"></div>
    </div>`;

  const parzellen = ffGefilterteParzellen(await ffLoadParzellen(jahrId));
  const matching = await ffEnsureMatching(jahrId);
  const neben = ffState.nebenkulturenCache[jahrId] || [];
  const flagsByParzelle = {};
  for (const f of ffOffeneFlags()) {
    if (!flagsByParzelle[f.parzelle_id] || f.schweregrad === 'hoch') flagsByParzelle[f.parzelle_id] = f;
  }

  if (window._ffMap) { window._ffMap.remove(); window._ffMap = null; }
  const map = L.map('ff-map', { preferCanvas: true });
  window._ffMap = map;
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);
  const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: '© Esri World Imagery',
  });
  L.control.layers({ 'OSM': osm, 'Luftbild': esri }, {}, { position: 'topright' }).addTo(map);

  const nebenByParzelle = {};
  for (const n of neben) (nebenByParzelle[n.parzelle_id] ||= []).push(n);
  const matchByLeit = {};
  for (const m of matching) (matchByLeit[m.leit_parzelle_id] ||= []).push(m);

  const bounds = [];
  const planjahr = ffIstPlanjahr(jahrId);
  for (const p of parzellen) {
    if (!p.geojson) continue;
    if (hiddenKulturen.has(p.kultur_id ?? 0)) continue;
    const flag = flagsByParzelle[p.id];
    const layer = L.geoJSON(p.geojson, {
      style: {
        color: flag ? (flag.schweregrad === 'hoch' ? '#e03030' : '#e08a20') : '#222',
        weight: flag ? 3 : 1,
        fillColor: p.kultur_farbe || '#777',
        fillOpacity: 0.55,
      },
    }).addTo(map);
    layer.bindPopup(() => popupHtml(p, nebenByParzelle[p.id], matchByLeit[p.id], flag, planjahr), { maxWidth: 340 });
    const b = layer.getBounds();
    if (b.isValid()) bounds.push(b);
    // Sprung aus der Flag-Übersicht: Parzelle fokussieren und Popup öffnen
    if (window._ffFokusParzelle === p.id) {
      window._ffFokusParzelle = null;
      setTimeout(() => { if (b.isValid()) map.fitBounds(b.pad(0.5)); layer.openPopup(); }, 150);
    }
  }
  if (bounds.length) {
    let all = bounds[0];
    for (const b of bounds.slice(1)) all = all.extend(b);
    map.fitBounds(all.pad(0.05));
  } else {
    map.setView([51.6, 11.8], 11);
  }
  renderLegende(parzellen);
}

function renderLegende(parzellen) {
  const el = document.getElementById('ff-map-legende');
  if (!el) return;
  const nachKultur = new Map();
  for (const p of parzellen) {
    const key = p.kultur_id ?? 0;
    if (!nachKultur.has(key)) {
      nachKultur.set(key, { name: p.kultur_name || 'ohne Kultur', farbe: p.kultur_farbe || '#777', ha: 0 });
    }
    nachKultur.get(key).ha += Number(p.netto_ha) || 0;
  }
  el.innerHTML = [...nachKultur.entries()]
    .sort((a, b) => b[1].ha - a[1].ha)
    .map(([id, k]) => `
      <div class="ff-legende-zeile ${hiddenKulturen.has(id) ? 'aus' : ''}" onclick="ffKarteKulturToggle(${id})"
           title="Klicken zum Ein-/Ausblenden">
        <span class="ff-legende-farbe" style="background:${escapeHtml(k.farbe)}"></span>
        ${escapeHtml(k.name)} <span style="opacity:.6">${k.ha.toFixed(1)} ha</span>
      </div>`).join('');
}

function popupHtml(p, neben, historie, flag, planjahr) {
  const nb = (neben || []).map(n => {
    const k = ffState.kulturen.find(x => x.id === n.kultur_id);
    return `${k ? k.name : 'NC ' + n.nutzungscode}${n.flaeche_ha ? ` (${Number(n.flaeche_ha).toFixed(2)} ha)` : ''}`;
  }).join(', ');
  const jahrById = {};
  for (const j of ffState.jahre) jahrById[j.id] = j.jahr;
  const hist = (historie || [])
    .slice().sort((a, b) => b.jahr - a.jahr)
    .map(m => `<tr><td>${m.jahr}</td><td><span class="ff-legende-farbe" style="background:${escapeHtml(m.kultur_farbe || '#777')}"></span>
      ${escapeHtml(m.kultur_name || '—')}</td><td style="text-align:right">${Math.round(m.anteil_prozent)} %</td></tr>`).join('');
  const kulturWahl = planjahr ? `
    <div style="margin-top:6px">
      <select id="ff-popup-kultur" onchange="ffKarteKulturSetzen(${p.id}, this.value)">
        <option value="">— Kultur wählen —</option>
        ${ffState.kulturen.filter(k => k.aktiv !== false).map(k =>
          `<option value="${k.id}" ${k.id === p.kultur_id ? 'selected' : ''}>${escapeHtml(k.name)}</option>`).join('')}
      </select>
    </div>` : '';
  return `
    <div class="ff-popup">
      <b>${escapeHtml(p.nummer)} ${escapeHtml(p.name || '')}</b><br>
      <span style="opacity:.7">${escapeHtml(p.betrieb_name)} · ${Number(p.netto_ha ?? 0).toFixed(2)} ha</span><br>
      Kultur: <b>${escapeHtml(p.kultur_name || '—')}</b>
      ${p.sorte ? ` · Sorte ${escapeHtml(p.sorte)}` : ''}
      ${p.oer_code ? ` · ÖR ${escapeHtml(p.oer_code)}` : ''}
      ${nb ? `<br>Zwischenfrucht: ${escapeHtml(nb)}` : ''}
      ${flag ? `<br><span class="${flag.schweregrad === 'hoch' ? 'ff-flag-hoch' : 'ff-flag-mittel'}">⚠ ${flag.typ === 'selbstfolge' ? 'Selbstfolge' : 'Anbaupause verletzt'} (${flag.kulturgruppe_name || ''}, ${flag.konflikt_jahr})</span>` : ''}
      ${kulturWahl}
      ${hist ? `<div style="margin-top:6px;font-weight:600">Historie dieser Fläche</div>
        <table class="ff-popup-historie">${hist}</table>` : ''}
    </div>`;
}

export function ffKarteJahr(jahrId) {
  ffState.jahrId = jahrId;
  renderFruchtfolge();
}

export function ffKarteKulturToggle(kulturId) {
  if (hiddenKulturen.has(kulturId)) hiddenKulturen.delete(kulturId);
  else hiddenKulturen.add(kulturId);
  renderFruchtfolge();
}

export async function ffKarteKulturSetzen(parzelleId, kulturIdStr) {
  try {
    await ffSetKultur(parzelleId, kulturIdStr ? parseInt(kulturIdStr) : null);
    ffInvalidateJahr(ffState.jahrId);
    showToast('Kultur gespeichert – Flags werden neu berechnet…');
    await ffRecompute();
    renderFruchtfolge();
  } catch (err) {
    console.error(err);
    showToast('Speichern fehlgeschlagen: ' + err.message);
  }
}
