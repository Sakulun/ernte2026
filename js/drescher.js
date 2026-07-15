import { state } from './state.js?v=40';
import { db } from './db.js?v=40';
import { getFeld, getUser, netto, kg2t, fmtTime, fmtDate, abfahrerIstFrei, showToast, escapeHtml, sorteBadge } from './helpers.js?v=40';
import { isBioFeld } from './bio.js?v=40';

export let dTab = 'meine';
let _drescherMap = null;
let _drescherMapLayers = {};

export function setDTab(tab) { dTab = tab; renderDrescher(); }

export function renderDrescher() {
  const uid = state.currentUser.id;
  const mf = state.fuhren.filter(f=>f.drescherId===uid);
  const aktiveFelder = state.felder.filter(f=>f.status==='aktiv');
  const abfahrer = state.users.filter(u=>u.role==='abfahrer');
  const freieAbfahrer = abfahrer.filter(a=>abfahrerIstFrei(a.id));

  if(!document.getElementById('drescher-layout')) {
    document.getElementById('main-content').innerHTML = `
      <div id="drescher-layout">
        <div id="drescher-panel">
          <div class="tabs" style="margin-bottom:12px">
            <button class="tab active" onclick="setDTab('meine')">Meine Fuhren (${mf.length})</button>
          </div>
          <div id="dtab"></div>
        </div>
        <div id="drescher-map-panel">
          <div id="drescher-map-container"></div>
        </div>
      </div>`;
    setTimeout(() => initDrescherMap(), 80);
  } else {
    const tabBtn = document.querySelector('#drescher-panel .tab');
    if(tabBtn) tabBtn.textContent = `Meine Fuhren (${mf.length})`;
  }

  if(false) {
    const noFelder = aktiveFelder.length===0;
    const noAbfahrer = freieAbfahrer.length===0;
    let warn = '';
    if(noFelder) warn += `<div class="alert alert-warn">&#9888; Keine aktiven Schläge – der Betriebsleiter muss Schläge aktivieren.</div>`;
    if(noAbfahrer && !noFelder) warn += `<div class="alert alert-warn">&#9888; Alle Abfahrer haben aktuell eine offene Fuhre – bitte warten.</div>`;

    const feldOptions = aktiveFelder.map(f =>
      `<option value="${f.id}">${f.name} · ${f.fruchtart} (${f.flaeche} ha)</option>`).join('');
    const abfahrerOptions = abfahrer.map(a => {
      const frei = abfahrerIstFrei(a.id);
      return `<option value="${a.id}" ${!frei?'disabled':''}>
        ${a.name}${!frei?' — beladen':''}
      </option>`;
    }).join('');

    document.getElementById('dtab').innerHTML = `${warn}
      <div class="card">
        <div class="card-header"><div>
          <div class="card-title">Neue Fuhre zuweisen</div>
          <div class="card-sub">Nur aktive Schläge · Fruchtart ist festgelegt</div>
        </div></div>
        <div class="form-group">
          <label>Schlag (${aktiveFelder.length} aktiv)</label>
          <select id="d-feld" onchange="drescherFeldWahl()" ${noFelder?'disabled':''}>
            <option value="">— Schlag wählen —</option>
            ${feldOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Fruchtart</label>
          <div class="fruchtart-fixed" id="d-fruchtart-display">— wird automatisch gesetzt —</div>
        </div>
        <div id="d-sorte-group" style="display:none" class="form-group">
          <label>Partie / Sorte</label>
          <select id="d-sorte" onchange="drescherSorteWahl()">
            <option value="">Konsum</option>
          </select>
        </div>
        <div class="form-group">
          <label>Abfahrer (${freieAbfahrer.length} verfügbar)</label>
          <select id="d-abf" ${noAbfahrer||noFelder?'disabled':''}>
            <option value="">— Abfahrer wählen —</option>
            ${abfahrerOptions}
          </select>
        </div>
        <button class="btn btn-primary btn-full" id="d-start-btn" onclick="if(!this.disabled){this.disabled=true;this.textContent='Wird gespeichert…';drescherZuweisen().finally(()=>{this.disabled=false;this.innerHTML='&#9654; Fuhre starten';})}" ${noFelder||noAbfahrer?'disabled style="opacity:.5;cursor:not-allowed"':''}>&#9654; Fuhre starten</button>
      </div>`;
    setTimeout(()=>{
      const sel = document.getElementById('d-feld');
      if(sel && state.lastFeldId) {
        sel.value = state.lastFeldId;
        drescherFeldWahl();
      }
    }, 0);
  } else {
    const nrNum = f => parseInt((f.nr||'').replace('F-',''))||0;
    const fuhren = state.fuhren.filter(f=>f.drescherId===uid).sort((a,b)=>nrNum(b)-nrNum(a));
    const infoBanner = `<div style="background:var(--color-info-wash);border:1px solid var(--blue-500);color:var(--color-text);border-radius:var(--radius-md);padding:10px 14px;margin-bottom:12px;font-size:var(--text-sm)">ℹ️ Die Fuhren-Zuweisung ist deaktiviert. Die Abfahrer erfassen ihre Fuhren jetzt selbst.</div>`;
    document.getElementById('dtab').innerHTML = infoBanner + (fuhren.length ? fuhren.map(f=>{
      const n=netto(f);
      const bStyle = f.status==="offen" ? "border-color:var(--amber)" : "";
      return `<div class="fuhre-item" style="${bStyle}">
        <div class="fuhre-top"><span class="fuhre-nr">${f.nr} · ${fmtDate(f.zeit)} ${fmtTime(f.zeit)}</span><span class="badge badge-${f.status}">${f.status.toUpperCase()}</span></div>
        <div class="fuhre-info">
          <div class="fuhre-kv"><span class="fk">Schlag </span><span class="fv">${getFeld(f.feldId).name||'–'}</span></div>
          <div class="fuhre-kv"><span class="fk">Fruchtart </span><span class="fv">${f.fruchtart||'–'}${sorteBadge(f)}</span></div>
          <div class="fuhre-kv"><span class="fk">Abfahrer </span><span class="fv">${getUser(f.abfahrerId).name||'–'}</span></div>
          <div class="fuhre-kv"><span class="fk">Netto </span><span class="fv">${n?kg2t(n):'–'}</span></div>
        </div></div>`;
    }).join('') : '<div class="empty-state">Noch keine Fuhren.</div>');
  }
}

export function drescherFeldWahl() {
  const feldId = parseInt(document.getElementById('d-feld').value);
  if(feldId) state.lastFeldId = feldId;
  const el = document.getElementById('d-fruchtart-display');
  if(feldId) {
    const feld = getFeld(feldId);
    const bio = isBioFeld(feldId);
    el.innerHTML = (bio ? '<span style="color:var(--color-success);font-weight:700">🌿 BIO</span> · ' : '') + (feld.fruchtart || '–');
    el.style.color = bio ? 'var(--color-success)' : 'var(--gold2)';
    const verms = window.getVermehrungenForFeld ? window.getVermehrungenForFeld(feldId) : [];
    const sorteGroup = document.getElementById('d-sorte-group');
    const sorteSelect = document.getElementById('d-sorte');
    if(verms.length > 0 && sorteGroup && sorteSelect) {
      sorteGroup.style.display = 'block';
      sorteSelect.innerHTML = '<option value="">Konsum (' + escapeHtml(feld.fruchtart) + ')</option>'
        + verms.map(v => `<option value="${escapeHtml(v.sorte)}">🌱 ${escapeHtml(v.sorte)} · ${escapeHtml(v.fruchtart||feld.fruchtart)} (${escapeHtml(v.flaeche)} ha)</option>`).join('');
      // zuletzt gewählte Sorte vorauswählen, falls sie für dieses Feld existiert
      sorteSelect.value = [...sorteSelect.options].some(o=>o.value===state.lastSorte) ? state.lastSorte : '';
      drescherSorteWahl();
    } else if(sorteGroup) {
      sorteGroup.style.display = 'none';
      if(sorteSelect) sorteSelect.value = '';
    }
  } else {
    el.textContent = '— wird automatisch gesetzt —';
    el.style.color = 'var(--text3)';
    const sg = document.getElementById('d-sorte-group');
    if(sg) sg.style.display = 'none';
  }
}

// Liefert die Fruchtart für die aktuell gewählte Sorte: bei Vermehrung deren
// eigene Frucht (z.B. Gerste auf einem Weizen-Konsumschlag), sonst Konsumfrucht.
function fruchtartFuerSorte(feldId, sorte) {
  const feld = getFeld(feldId);
  if(sorte) {
    const verms = window.getVermehrungenForFeld ? window.getVermehrungenForFeld(feldId) : [];
    const v = verms.find(x => x.sorte === sorte);
    if(v && v.fruchtart) return v.fruchtart;
  }
  return feld.fruchtart || '';
}

export function drescherSorteWahl() {
  const feldId = parseInt(document.getElementById('d-feld').value);
  const el = document.getElementById('d-fruchtart-display');
  if(!feldId || !el) return;
  const sorteEl = document.getElementById('d-sorte');
  const sorte = sorteEl ? sorteEl.value : '';
  const bio = isBioFeld(feldId);
  const fruchtart = fruchtartFuerSorte(feldId, sorte) || '–';
  el.innerHTML = (bio ? '<span style="color:var(--color-success);font-weight:700">🌿 BIO</span> · ' : '') + fruchtart;
  el.style.color = bio ? 'var(--color-success)' : 'var(--gold2)';
}

export async function drescherZuweisen() {
  const feldId = parseInt(document.getElementById('d-feld').value);
  const abfahrerId = parseInt(document.getElementById('d-abf').value);
  if(isNaN(feldId)||isNaN(abfahrerId)||!feldId||!abfahrerId) { alert('Bitte alle Felder ausfüllen.'); return; }
  if(!abfahrerIstFrei(abfahrerId)) { alert('Dieser Abfahrer hat noch eine offene Fuhre!'); return; }
  const feld = getFeld(feldId);
  const sorteEl = document.getElementById('d-sorte');
  const sorte = sorteEl ? (sorteEl.value || null) : null;
  const fruchtart = fruchtartFuerSorte(feldId, sorte);
  // nr wird serverseitig vergeben (nutzerunabhängig eindeutig) – bis dahin Platzhalter.
  const newFuhre = {
    id: state.nextId++, nr: '…', status:'offen',
    drescherId: state.currentUser.id, abfahrerId,
    feldId, fruchtart: fruchtart||'', sorte,
    vollgewicht:null, leergewicht:null,
    feuchte:null, fallzahl:null, protein:null, hlGewicht:null,
    zeit: new Date().toISOString()
  };
  state.fuhren.push(newFuhre);
  state.lastFeldId = feldId;
  state.lastSorte = sorte;
  dTab='meine'; renderDrescher();
  try {
    const res = await db.insertFuhre(newFuhre);
    newFuhre.id = res.id; newFuhre.nr = res.nr;
    renderDrescher();
  } catch(e) {
    state.fuhren.splice(state.fuhren.indexOf(newFuhre), 1);
    showToast('⚠ Fuhre nicht gespeichert: '+e.message, 'error');
    renderDrescher();
  }
}

function initDrescherMap() {
  if(_drescherMap) { _drescherMap.remove(); _drescherMap = null; }
  _drescherMapLayers = {};
  const container = document.getElementById('drescher-map-container');
  if(!container) return;
  const map = L.map('drescher-map-container', { center:[51.495,11.673], zoom:11 });
  _drescherMap = map;
  window._drescherMap = map;
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {attribution:'© Esri', maxZoom:19});
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution:'© OpenStreetMap', maxZoom:19});
  sat.addTo(map);
  L.control.layers({'Satellit':sat,'OSM':osm},{},{position:'topleft'}).addTo(map);

  const shapes = state.shapes.length ? state.shapes : (typeof GEO_DATA!=='undefined'?GEO_DATA:[]);
  shapes.forEach(entry => {
    const feld = state.felder.find(x=>x.id===entry.feldId);
    if(!feld) return;
    const style = window.schlagColor ? window.schlagColor(feld.status) : {color:'#8a8a8a',fillColor:'#6a6a6a',fillOpacity:0.45,weight:1.5};
    const poly = L.polygon([entry.outer,...(entry.holes||[])], {...style, interactive:true});
    const openFuhren = state.fuhren.filter(f=>f.feldId===entry.feldId&&f.status==='offen');
    let popupHtml = `<div style="font-family:var(--font-sans);min-width:160px">
      <div style="font-weight:600;font-size:var(--text-base)">${feld.name}</div>
      <div style="color:var(--color-text-subtle);font-size:var(--text-xs);margin:2px 0 6px">${feld.fruchtart} · ${feld.flaeche?.toFixed(1)} ha</div>
      <div style="font-size:var(--text-xs);color:${feld.status==='aktiv'?'var(--color-warning)':feld.status==='abgeerntet'?'var(--color-success)':'var(--color-text-subtle)'}">${feld.status.charAt(0).toUpperCase()+feld.status.slice(1)}</div>
      ${openFuhren.length?`<div style="margin-top:6px;font-size:var(--text-xs);color:var(--blue-500)">Abfahrer: ${openFuhren.map(f=>getUser(f.abfahrerId).name).join(', ')}</div>`:''}
    </div>`;
    poly.bindPopup(popupHtml, {className:'schlag-popup', maxWidth:200});
    poly.on('mouseover', function(){ this.setStyle({fillOpacity:0.6,weight:3}); });
    poly.on('mouseout', function(){ this.setStyle(style); });
    poly.addTo(map);
    _drescherMapLayers[entry.feldId] = poly;
  });

  if(window.shareUserGPS) window.shareUserGPS(state.currentUser.id);
  db.getGPS().then(gps => {
    window._userLocations = window._userLocations || {};
    gps.forEach(g => { window._userLocations[g.nutzer_id]={lat:parseFloat(g.lat),lon:parseFloat(g.lon),ts:new Date(g.aktualisiert_am).getTime()}; });
    if(window.updateAllDriverMarkers) window.updateAllDriverMarkers(map, _drescherMapLayers);
  });
}
