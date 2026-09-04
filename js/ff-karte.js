// Fruchtfolge: Kartenansicht (Leaflet). Parzellen in Kulturfarbe des gewählten
// Jahres, Jahres-Umschalter, Legende, Flag-Umrandung, Mini-Historie im Popup.
// Performance: Die Karte lebt in einem persistenten Container weiter und wird
// beim Zurückschalten nur wieder angehängt; alle Parzellen liegen in EINEM
// GeoJSON-Layer; die Matching-Historie lädt erst NACH dem Zeichnen nach.
import { showToast, escapeHtml } from './helpers.js?v=136';
import { ffState, ffLoadParzellen, ffEnsureMatching, ffGefilterteParzellen,
         ffIstPlanjahr, ffSetKultur, ffInvalidateJahr, ffRecompute, renderFruchtfolge,
         ffOffeneFlags } from './fruchtfolge.js?v=136';

let hiddenKulturen = new Set(); // per Legende ausgeblendete kultur_id (0 = ohne Kultur)
let mapWrap = null;             // persistenter DOM-Container mit der Leaflet-Karte
let lastKey = null;             // Zustand, für den die Karte zuletzt gebaut wurde
let matchByLeit = {};           // leit_parzelle_id → Matches (lazy geladen, für Popups)

function renderKey(jahrId, parzellenRef) {
  return [
    jahrId, parzellenRef ? parzellenRef.length : -1,
    [...hiddenKulturen].sort().join(','),
    ffState.filterBetriebe ? [...ffState.filterBetriebe].sort().join(',') : 'alle',
    ffState.filterKulturgruppe ?? 'alle',
    ffState.flags.length,
  ].join('|');
}

let lastDataRef = null; // Referenz des Parzellen-Caches beim letzten Aufbau

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
    <div id="ff-map-slot"></div>`;
  const slot = document.getElementById('ff-map-slot');

  const datenVorher = ffState.parzellenCache[jahrId];
  const key = renderKey(jahrId, datenVorher);

  // Schnellpfad: Daten und Filter unverändert → vorhandene Karte nur wieder anhängen
  if (mapWrap && window._ffMap && lastKey === key && datenVorher && lastDataRef === datenVorher && !window._ffFokusParzelle) {
    slot.replaceWith(mapWrap);
    window._ffMap.invalidateSize();
    return;
  }

  const parzellen = ffGefilterteParzellen(await ffLoadParzellen(jahrId));
  const neben = ffState.nebenkulturenCache[jahrId] || [];
  const flagsByParzelle = {};
  for (const f of ffOffeneFlags()) {
    if (!flagsByParzelle[f.parzelle_id] || f.schweregrad === 'hoch') flagsByParzelle[f.parzelle_id] = f;
  }
  const nebenByParzelle = {};
  for (const n of neben) (nebenByParzelle[n.parzelle_id] ||= []).push(n);

  // Karte (neu) aufbauen – Kartenobjekt und Tile-Layer werden wiederverwendet
  let map = window._ffMap;
  if (!mapWrap || !map) {
    mapWrap = document.createElement('div');
    mapWrap.style.position = 'relative';
    mapWrap.innerHTML = '<div id="ff-map" class="ff-map"></div><div id="ff-map-legende" class="ff-map-legende"></div>';
    slot.replaceWith(mapWrap);
    map = L.map(mapWrap.querySelector('#ff-map'), { preferCanvas: true });
    window._ffMap = map;
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(map);
    const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: '© Esri World Imagery',
    });
    L.control.layers({ 'OSM': osm, 'Luftbild': esri }, {}, { position: 'topright' }).addTo(map);
  } else {
    slot.replaceWith(mapWrap);
    map.invalidateSize();
  }
  if (window._ffParzellenLayer) { map.removeLayer(window._ffParzellenLayer); window._ffParzellenLayer = null; }

  const jahrVorher = lastKey === null ? null : String(lastKey).split('|')[0];
  const jahrGewechselt = jahrVorher !== String(jahrId);
  lastKey = key;
  lastDataRef = ffState.parzellenCache[jahrId];
  matchByLeit = {};

  // EIN GeoJSON-Layer für alle Parzellen (deutlich schneller als je Parzelle einer)
  const planjahr = ffIstPlanjahr(jahrId);
  const byId = {};
  const features = [];
  for (const p of parzellen) {
    if (!p.geojson) continue;
    if (hiddenKulturen.has(p.kultur_id ?? 0)) continue;
    byId[p.id] = p;
    features.push({ type: 'Feature', properties: { id: p.id }, geometry: p.geojson });
  }
  const layer = L.geoJSON({ type: 'FeatureCollection', features }, {
    style: (f) => {
      const p = byId[f.properties.id];
      const flag = flagsByParzelle[p.id];
      return {
        color: flag ? (flag.schweregrad === 'hoch' ? '#e03030' : '#e08a20') : '#222',
        weight: flag ? 3 : 1,
        fillColor: p.kultur_farbe || '#ffffff',
        fillOpacity: p.kultur_farbe ? 0.55 : 0.75,
      };
    },
    onEachFeature: (f, lyr) => {
      const p = byId[f.properties.id];
      lyr.bindPopup(() => popupHtml(p, nebenByParzelle[p.id], matchByLeit[p.id], flagsByParzelle[p.id], planjahr), { maxWidth: 340 });
      // Sprung aus der Flag-Übersicht: Parzelle fokussieren und Popup öffnen
      if (window._ffFokusParzelle === p.id) {
        window._ffFokusParzelle = null;
        setTimeout(() => {
          const b = lyr.getBounds();
          if (b.isValid()) map.fitBounds(b.pad(0.5));
          lyr.openPopup();
        }, 200);
      }
    },
  }).addTo(map);
  window._ffParzellenLayer = layer;

  // Nur bei Jahreswechsel/Erstaufbau neu einpassen – sonst Kartenausschnitt behalten
  const b = layer.getBounds();
  if (b.isValid() && jahrGewechselt) map.fitBounds(b.pad(0.05));
  else if (!b.isValid()) map.setView([51.6, 11.8], 11);

  renderLegende(parzellen);
  // Historie für die Popups NACH dem Zeichnen laden (blockiert den Kartenaufbau nicht)
  ffEnsureMatching(jahrId).then((matching) => {
    matchByLeit = {};
    for (const m of matching) (matchByLeit[m.leit_parzelle_id] ||= []).push(m);
  }).catch((err) => console.error(err));
}

function renderLegende(parzellen) {
  const el = mapWrap?.querySelector('#ff-map-legende');
  if (!el) return;
  const nachKultur = new Map();
  for (const p of parzellen) {
    const key = p.kultur_id ?? 0;
    if (!nachKultur.has(key)) {
      nachKultur.set(key, { name: p.kultur_name || 'ohne Kultur', farbe: p.kultur_farbe || '#ffffff', ha: 0 });
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
  const hist = (historie || [])
    .slice().sort((a, b) => b.jahr - a.jahr)
    .map(m => `<tr><td>${m.jahr}</td><td><span class="ff-legende-farbe" style="background:${escapeHtml(m.kultur_farbe || '#ffffff')}"></span>
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
        <table class="ff-popup-historie">${hist}</table>` : '<div style="margin-top:6px;opacity:.6">Historie lädt… (Popup kurz darauf erneut öffnen)</div>'}
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
