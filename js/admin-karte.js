import { state } from './state.js?v=67';
import { db } from './db.js?v=67';
import { getUser, netto } from './helpers.js?v=67';

let _mapInstance = null;
let _gpsWatcher = null;
let _gpsMarkers = {};
let _userLocations = {};
let _schlagLayers = {};
let _wakeLock = null;

export function renderAdminKarte() {
  const mapH = `calc(100vh - 49px)`;
  if(!document.getElementById('map-container')) {
    document.getElementById('admintab').innerHTML = `
      <div style="position:relative;height:${mapH};margin:-16px">
        <div id="map-container" style="height:100%;width:100%;border-radius:0"></div>
        <div id="map-legend" style="position:absolute;bottom:20px;left:12px;z-index:1000;background:rgba(44,44,44,0.92);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:10px 12px;font-size:var(--text-xs);color:#fff">
          <div style="font-weight:600;margin-bottom:6px;color:#fff">Legende</div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <div><span style="display:inline-block;width:12px;height:12px;background:#b07820;opacity:0.7;border-radius:2px;margin-right:5px"></span>Aktiv (in Ernte)</div>
            <div><span style="display:inline-block;width:12px;height:12px;background:#6b8f4e;opacity:0.7;border-radius:2px;margin-right:5px"></span>Abgeerntet</div>
            <div><span style="display:inline-block;width:12px;height:12px;background:#8a8a8a;opacity:0.9;border-radius:2px;margin-right:5px"></span>Inaktiv</div>
            <div style="margin-top:4px"><span style="display:inline-block;width:12px;height:12px;background:#b07820;border-radius:50%;margin-right:5px"></span>Drescher</div>
            <div><span style="display:inline-block;width:12px;height:12px;background:#4a9ab0;border-radius:50%;margin-right:5px"></span>Abfahrer</div>
          </div>
        </div>
        <div id="map-gps-status" style="position:absolute;top:12px;right:12px;z-index:1000;background:rgba(44,44,44,0.92);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:8px 12px;font-size:var(--text-xs);color:#ccc">GPS bereit</div>
      </div>`;
    setTimeout(() => initMap(), 50);
  } else if(_mapInstance) {
    setTimeout(() => _mapInstance.invalidateSize(), 50);
  }
}

function getFeldStatus(feldId) {
  const f = state.felder.find(x => x.id === feldId);
  return f ? f.status : 'inaktiv';
}

function getFeldInfo(feldId) {
  return state.felder.find(x => x.id === feldId) || {};
}

export function schlagColor(status) {
  if(status === 'aktiv') return {color:'#b07820', fillColor:'#b07820', fillOpacity:0.35, weight:2};
  if(status === 'abgeerntet') return {color:'#6b8f4e', fillColor:'#6b8f4e', fillOpacity:0.35, weight:2};
  // Pausiert: wie aktiv (Ernte begonnen), aber gestrichelt + blasser
  if(status === 'pausiert') return {color:'#b07820', fillColor:'#b07820', fillOpacity:0.15, weight:2, dashArray:'6,5'};
  return {color:'#8a8a8a', fillColor:'#6a6a6a', fillOpacity:0.45, weight:1.5};
}

function initMap() {
  if(_mapInstance) { _mapInstance.remove(); _mapInstance = null; }
  _schlagLayers = {};

  const map = L.map('map-container', {
    center: [51.495, 11.673],
    zoom: 11,
    zoomControl: true,
  });
  _mapInstance = map;
  window._mapInstance = map;
  window._schlagLayers = _schlagLayers;

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom:19
  });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri', maxZoom:19
  });
  sat.addTo(map);
  L.control.layers({'Satellit':sat,'OpenStreetMap':osm}, {}, {position:'topleft'}).addTo(map);

  // Aktuelle DB-Shapes bevorzugen (richtige Feld-IDs nach Re-Import);
  // GEO_DATA nur als Fallback, falls keine Shapes geladen sind.
  const geoData = (state.shapes && state.shapes.length) ? state.shapes : (typeof GEO_DATA !== 'undefined' ? GEO_DATA : []);
  geoData.forEach(entry => {
    const feld = getFeldInfo(entry.feldId);
    if(!feld.id) return;
    const status = feld.status || 'inaktiv';
    const style = schlagColor(status);

    const latLngs = [entry.outer, ...entry.holes];
    const poly = L.polygon(latLngs, {...style, interactive:true});

    const openFuhren = state.fuhren.filter(f => f.feldId === entry.feldId && f.status === 'offen');
    const fertigFuhren = state.fuhren.filter(f => f.feldId === entry.feldId && f.status === 'fertig');
    const nettoT = fertigFuhren.reduce((s,f) => s+(netto(f)||0), 0) / 1000;

    let popupHtml = `<div style="font-family:var(--font-sans);min-width:180px">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px">${feld.name}</div>
      <div style="color:var(--color-text-subtle);font-size:11px;margin-bottom:6px">${entry.betrieb}</div>
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        <tr><td style="color:var(--color-text-subtle);padding:2px 0">Fruchtart</td><td style="text-align:right">${feld.fruchtart}</td></tr>
        <tr><td style="color:var(--color-text-subtle);padding:2px 0">Fläche</td><td style="text-align:right">${feld.flaeche?.toFixed(2)} ha</td></tr>
        <tr><td style="color:var(--color-text-subtle);padding:2px 0">Status</td><td style="text-align:right;color:${status==='aktiv'?'var(--color-warning)':status==='abgeerntet'?'var(--color-success)':'var(--color-text-subtle)'}">${status.charAt(0).toUpperCase()+status.slice(1)}</td></tr>`;
    if(fertigFuhren.length > 0) popupHtml += `<tr><td style="color:var(--color-text-subtle);padding:2px 0">Geerntet</td><td style="text-align:right">${nettoT.toFixed(2)} t</td></tr>`;
    if(openFuhren.length > 0) {
      const drescher = openFuhren.map(f => getUser(f.drescherId).name).join(', ');
      const abfahrer = openFuhren.map(f => getUser(f.abfahrerId).name).join(', ');
      popupHtml += `<tr><td style="color:var(--color-warning);padding:2px 0">Drescher</td><td style="text-align:right;color:var(--color-warning)">${drescher}</td></tr>
        <tr><td style="color:var(--blue-500);padding:2px 0">Abfahrer</td><td style="text-align:right;color:var(--blue-500)">${abfahrer}</td></tr>`;
    }
    popupHtml += `</table></div>`;

    poly.bindPopup(popupHtml, {className:'schlag-popup', maxWidth:220});
    poly.on('mouseover', function() { this.setStyle({fillOpacity:0.6, weight:3}); });
    poly.on('mouseout', function() { this.setStyle(style); });
    poly.addTo(map);
    _schlagLayers[entry.feldId] = poly;
  });

  db.getGPS().then(gps => {
    gps.forEach(g => {
      _userLocations[g.nutzer_id] = {lat:parseFloat(g.lat), lon:parseFloat(g.lon), ts:new Date(g.aktualisiert_am).getTime()};
    });
    updateGPSMarkers(map);
  });

  startGPS(map);
}

function startGPS(map) {
  if(!navigator.geolocation) {
    document.getElementById('map-gps-status').textContent = 'GPS nicht verfügbar';
    return;
  }
  const statusEl = document.getElementById('map-gps-status');
  if(statusEl) statusEl.textContent = 'GPS wird aktiviert…';

  const user = state.currentUser;

  if(_gpsWatcher) navigator.geolocation.clearWatch(_gpsWatcher);
  _gpsWatcher = navigator.geolocation.watchPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      _userLocations[user.id] = {lat, lon, ts: Date.now()};
      updateGPSMarkers(map);
      if(statusEl) statusEl.innerHTML = `<span style="color:#6b8f4e">● GPS aktiv</span>`;
    },
    err => { if(statusEl) statusEl.textContent = 'GPS: ' + err.message; },
    {enableHighAccuracy:true, maximumAge:5000, timeout:10000}
  );
}

export function getDriverIcon(role) {
  const color = role === 'drescher' ? '#b07820' : '#4a9ab0';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <circle cx="16" cy="14" r="13" fill="${color}" stroke="#fff" stroke-width="2.5"/>
    <polygon points="16,40 8,24 24,24" fill="${color}" stroke="#fff" stroke-width="1"/>
    <circle cx="16" cy="14" r="5" fill="#fff" opacity="0.9"/>
  </svg>`;
  return L.divIcon({
    html: svg, className: '', iconSize:[32,40], iconAnchor:[16,40], popupAnchor:[0,-40]
  });
}

function updateGPSMarkers(map) {
  state.users.filter(u => u.role !== 'admin').forEach(u => {
    const loc = _userLocations[u.id];
    if(!loc) return;
    const latlng = [loc.lat, loc.lon];
    const d = new Date(loc.ts);
    const heute = d.toDateString() === new Date().toDateString();
    const zeitStr = (heute ? 'heute' : d.toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric'}))
      + ', ' + d.toLocaleTimeString('de-DE') + ' Uhr';
    const popupTxt = `<b>${u.name}</b><br>${u.label}<br><span style="color:var(--color-text-subtle);font-size:10px">Zuletzt gesehen: ${zeitStr}</span>`;
    if(_gpsMarkers[u.id]) {
      _gpsMarkers[u.id].setLatLng(latlng);
      _gpsMarkers[u.id].setPopupContent(popupTxt);
    } else {
      const m = L.marker(latlng, {icon: getDriverIcon(u.role), zIndexOffset:1000});
      m.bindPopup(popupTxt, {className:'driver-popup'});
      m.addTo(map);
      _gpsMarkers[u.id] = m;
    }
  });
}

export async function requestWakeLock() {
  if(!('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
    const wlEl = document.getElementById('topbar-wakelock'); if(wlEl) wlEl.style.display='inline';
  } catch(e) {
    console.warn('Wake Lock nicht verfügbar:', e.message);
  }
}

export async function releaseWakeLock() {
  if(_wakeLock) {
    await _wakeLock.release();
    _wakeLock = null;
  }
}

export function shareUserGPS(userId) {
  if(!navigator.geolocation) return;
  requestWakeLock();
  navigator.geolocation.watchPosition(
    pos => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      _userLocations[userId] = {lat, lon, ts: Date.now()};
      db.upsertGPS(userId, lat, lon);
      if(_mapInstance) updateGPSMarkers(_mapInstance);
    },
    ()=>{}, {enableHighAccuracy:true, maximumAge:5000}
  );
}

export function refreshMapColors() {
  if(!_mapInstance) return;
  Object.entries(_schlagLayers).forEach(([feldId, layer]) => {
    const status = getFeldStatus(parseInt(feldId));
    layer.setStyle(schlagColor(status));
  });
}
