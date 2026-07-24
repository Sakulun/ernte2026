import { state } from './state.js?v=70';
import { db } from './db.js?v=70';
import { getFeld, netto, kg2t, fmtTime, showToast, navigiereZuSchlag, sorteBadge } from './helpers.js?v=70';
import { isBioFuhre, bioBadge } from './bio.js?v=70';
import { getFruchtFarbe } from './frucht.js?v=70';
import { getQualitaetsfelder } from './quality.js?v=70';

export let aTab = 'erfassen';
export function setATab(tab) { aTab = tab; renderAbfahrer(); }
let _navMap = null;
let _navLayers = {};
let _navHighlight = null;

export function renderAbfahrer() {
  const uid=state.currentUser.id;
  const fertigAnz=state.fuhren.filter(f=>f.abfahrerId===uid&&f.status==='fertig').length;
  document.getElementById('main-content').innerHTML=`
    <div class="tabs">
      <button class="tab ${aTab==='erfassen'?'active':''}" onclick="setATab('erfassen')">&#9878; Fuhre erfassen</button>
      <button class="tab ${aTab==='fertig'?'active':''}" onclick="setATab('fertig')">Abgeschlossene Fuhren${fertigAnz?' ('+fertigAnz+')':''}</button>
      <button class="tab ${aTab==='felder'?'active':''}" onclick="setATab('felder')">Aktive Felder</button>
    </div>
    <div id="atab"></div>`;
  if(aTab==='fertig') { if(_navMap){_navMap.remove();_navMap=null;} renderAbfahrerFertig(); }
  else if(aTab==='felder') { renderAbfahrerSchlagsuche(); }
  else {
    // Standard: gleiche "Fuhre erfassen"-Maske wie der Admin (Gewichte + Qualität,
    // direkt als "fertig" abschließen). Abfahrer ist fest der angemeldete Nutzer.
    if(_navMap){_navMap.remove();_navMap=null;}
    if(window.renderWaageErfassungInto) window.renderWaageErfassungInto(document.getElementById('atab'), { abfahrerId: uid, modus: 'abschluss' });
  }
}

function renderAbfahrerOffen() {
  const fuhren=state.fuhren.filter(f=>f.abfahrerId===state.currentUser.id&&f.status==='offen').sort((a,b)=>new Date(b.zeit)-new Date(a.zeit));
  const waageWidget = window.waageFuhreWidgetHTML || (()=>'');
  document.getElementById('atab').innerHTML = fuhren.length ? fuhren.map(f=>{ const _fr = getFruchtFarbe(f.fruchtart); return `
    <div class="card" style="border-left:4px solid ${_fr.dot}">
      <div class="card-header" style="${isBioFuhre(f)?'background:var(--color-success-wash);border-bottom:1px solid var(--green-400)':''}">
        <div>
          <div class="card-title">${getFeld(f.feldId).name}${isBioFuhre(f)?bioBadge(true):''}</div>
          <div class="card-sub">${f.fruchtart} · ${f.nr} · ${fmtTime(f.zeit)}</div>
        </div>
        <span class="badge badge-offen">OFFEN</span>
      </div>
      ${isBioFuhre(f) ? '<div style="background:var(--color-success-wash);color:var(--color-text);font-size:var(--text-base);font-weight:700;padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--green-400)"><span style="font-size:18px">🌿</span><div><div>BIO-WARE – zertifizierte Ernte</div><div style="font-size:var(--text-xs);font-weight:400;opacity:0.8">Betrieb: '+getFeld(f.feldId).betrieb+'</div></div></div>' : ''}
      ${f.sorte ? '<div style="background:var(--color-info-wash);color:var(--color-info);font-size:var(--text-base);font-weight:700;padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--blue-500)"><span style="font-size:18px">🌱</span><div><div>Z-SAATGUT · Vermehrung: '+f.sorte+'</div><div style="font-size:var(--text-xs);font-weight:400;opacity:0.8">Bitte separat abladen – eigenes Silo!</div></div></div>' : ''}
      <div class="section-label">Gewichte</div>
      <div class="gewicht-grid">
        <div class="form-group">
          <label>Vollgewicht (kg)</label>
          <input type="text" inputmode="numeric" id="voll-${f.id}" placeholder="28.400"
            style="font-size:20px;font-weight:700;letter-spacing:0.5px"
            oninput="fmtGewicht(this);updNetto(${f.id})">
        </div>
        <div class="form-group">
          <label>Leergewicht (kg)</label>
          <input type="text" inputmode="numeric" id="leer-${f.id}" placeholder="12.600"
            style="font-size:20px;font-weight:700;letter-spacing:0.5px"
            oninput="fmtGewicht(this);updNetto(${f.id})">
        </div>
      </div>
      ${waageWidget(f.id)}
      <div class="netto-display">
        <div class="netto-label">Netto</div>
        <div class="netto-val" id="netto-${f.id}" style="font-size:28px">—</div>
        <div class="netto-unit">kg</div>
      </div>
      <div class="section-label">Qualität <span style="font-size:10px;color:var(--text2);font-weight:400">– alle optional, fehlende Angaben werden abgefragt</span></div>
      <div class="gewicht-grid" id="qual-grid-${f.id}">
        ${(()=>{const qf=getQualitaetsfelder(f.fruchtart);return Object.entries(qf).map(([key,q])=>
          `<div class="form-group"><label>${q.label}</label><input type="number" id="qual-${key}-${f.id}" placeholder="${q.ph}" step="${q.step}"></div>`
        ).join('');})()}
      </div>
      <button class="btn btn-green btn-full" onclick="fuhreSpeichern(${f.id})">&#10003; Fuhre abschließen</button>
    </div>`; }).join('') :
    `<div class="empty-state">Keine offenen Fuhren.<br>Starte eine im Tab „🚛 Fuhre erfassen".</div>`;
}

export function parseGewicht(str) {
  return parseFloat((str||'').replace(/\./g,'').replace(',','.')) || 0;
}

export function fmtGewicht(input) {
  const pos = input.selectionStart;
  const raw = input.value.replace(/\./g,'').replace(/[^0-9]/g,'');
  if(!raw) return;
  const num = parseInt(raw);
  const formatted = num.toLocaleString('de-DE');
  const added = formatted.length - input.value.length;
  input.value = formatted;
  try { input.setSelectionRange(pos+added, pos+added); } catch(e) {}
}

export function updNetto(fId) {
  const v=parseGewicht(document.getElementById('voll-'+fId)?.value);
  const l=parseGewicht(document.getElementById('leer-'+fId)?.value);
  const el=document.getElementById('netto-'+fId);
  if(!el) return;
  if(v&&l&&v>l) {
    el.textContent=(v-l).toLocaleString('de-DE');
    el.style.color='var(--green2)';
  } else {
    el.textContent='—';
    el.style.color='var(--text3)';
  }
}

export async function fuhreSpeichern(fId) {
  const v=parseGewicht(document.getElementById('voll-'+fId)?.value);
  const l=parseGewicht(document.getElementById('leer-'+fId)?.value);
  if(!v||!l||v<=l){alert('Bitte gültige Gewichte eingeben (Vollgew. > Leergew.).');return;}
  const f=state.fuhren.find(x=>x.id===fId);
  if(!f) return;
  const qf = getQualitaetsfelder(f.fruchtart);
  const qualWerte = {};
  for(const key of Object.keys(qf)) {
    const el = document.getElementById('qual-'+key+'-'+fId);
    qualWerte[key] = el ? parseFloat(el.value)||null : null;
  }
  const fehlende = Object.entries(qf)
    .filter(([key]) => !qualWerte[key])
    .map(([,q]) => q.label);
  if(fehlende.length > 0) {
    const fehlendStr = fehlende.join(', ');
    if(!confirm(`Fehlende Angaben: ${fehlendStr}\n\nWirklich ohne ${fehlende.length>1?'diese Werte':'diesen Wert'} abschließen?`)) return;
  }
  const updates = {
    vollgewicht: v, leergewicht: l,
    feuchte: qualWerte.feuchte||null, protein: qualWerte.protein||null,
    gluten: qualWerte.gluten||null, hlGewicht: qualWerte.hl||null,
    oelgehalt: qualWerte.oelgehalt||null, status: 'fertig'
  };
  const prevState = { vollgewicht:f.vollgewicht, leergewicht:f.leergewicht, feuchte:f.feuchte, protein:f.protein, gluten:f.gluten, hlGewicht:f.hlGewicht, oelgehalt:f.oelgehalt, status:f.status };
  Object.assign(f, updates);
  renderAbfahrer();
  try { await db.updateFuhre(fId, updates); showToast('✓ Fuhre gespeichert'); }
  catch(e) { Object.assign(f, prevState); showToast('⚠ Speicherfehler: '+e.message, 'error'); renderAbfahrer(); }
}

function renderAbfahrerFertig() {
  const nrNum2 = f => parseInt((f.nr||'').replace('F-',''))||0;
  const fuhren=state.fuhren.filter(f=>f.abfahrerId===state.currentUser.id&&f.status==='fertig').sort((a,b)=>nrNum2(b)-nrNum2(a));
  const totalKg = fuhren.reduce((s,f)=>s+(netto(f)||0),0);
  const totalT = (totalKg/1000).toFixed(1);
  const summaryHtml = `<div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:20px;margin-bottom:16px;text-align:center">
    <div style="font-size:var(--text-sm);color:var(--color-text-muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:4px">Deine Gesamtleistung</div>
    <div style="font-family:var(--font-display);font-size:40px;font-weight:700;color:var(--color-text)">${totalT} t</div>
    <div style="font-size:var(--text-md);color:var(--color-text-muted);margin-top:4px">${fuhren.length} Fuhren abgeschlossen</div>
  </div>`;
  document.getElementById('atab').innerHTML=fuhren.length?(summaryHtml+fuhren.map(f=>{
    const n=netto(f);
    const fr=getFruchtFarbe(f.fruchtart);
    return `<div class="fuhre-item" style="border-left:4px solid ${fr.dot}">
      <div class="fuhre-top"><span class="fuhre-nr">${f.nr} · ${fmtTime(f.zeit)}</span><span class="badge badge-fertig">FERTIG</span></div>
      ${f.sorte?`<div style="padding:2px 0 4px">${sorteBadge(f)}</div>`:''}
      <div class="fuhre-info">
        <div class="fuhre-kv"><span class="fk">Schlag </span><span class="fv">${getFeld(f.feldId).name||'–'}</span></div>
        <div class="fuhre-kv"><span class="fk">Fruchtart </span><span class="fv">${f.fruchtart||'–'}</span></div>
        <div class="fuhre-kv"><span class="fk">Netto </span><span class="fv">${n?kg2t(n):'–'}</span></div>
        <div class="fuhre-kv"><span class="fk">Feuchte </span><span class="fv">${f.feuchte?f.feuchte+'%':'–'}</span></div>
        ${f.protein?`<div class="fuhre-kv"><span class="fk">Protein </span><span class="fv">${f.protein}%</span></div>`:''}
      </div></div>`;
  }).join('')):'<div class="empty-state">Noch keine abgeschlossenen Fuhren.</div>';
}

function renderAbfahrerSchlagsuche() {
  const felder = state.felder.filter(f=>f.status==='aktiv').sort((a,b)=>a.name.localeCompare(b.name,'de'));
  document.getElementById('atab').innerHTML =
    '<div style="display:flex;flex-direction:column;height:calc(100vh - 140px);overflow:hidden">'
    +'<div style="padding:10px 12px;border-bottom:1px solid var(--color-border);flex-shrink:0">'
    +'<input type="text" id="schlag-nav-search" class="search-input" style="margin:0"'
    +' placeholder="Schlagname oder Fruchtart…" oninput="filterSchlagNav(this.value)" autocomplete="off">'
    +'</div>'
    +'<div id="schlag-nav-liste" style="overflow-y:auto;max-height:240px;flex-shrink:0;border-bottom:1px solid var(--color-border)">'
    +felder.map(f=>schlagNavItem(f)).join('')
    +'</div>'
    +'<div style="flex:1;position:relative;min-height:200px">'
    +'<div id="nav-map-container" style="width:100%;height:100%"></div>'
    +'</div>'
    +'</div>';
  setTimeout(initNavMap, 50);
}

function initNavMap() {
  if(_navMap) { _navMap.remove(); _navMap = null; }
  _navLayers = {};
  const container = document.getElementById('nav-map-container');
  if(!container) return;
  const map = L.map('nav-map-container', {center:[51.495,11.673], zoom:11});
  _navMap = map;
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'© Esri',maxZoom:19});
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19});
  sat.addTo(map);
  L.control.layers({'Satellit':sat,'OSM':osm},{},{position:'topleft'}).addTo(map);
  const shapes = state.shapes.length ? state.shapes : (typeof GEO_DATA!=='undefined'?GEO_DATA:[]);
  shapes.forEach(entry => {
    const feld = state.felder.find(x=>x.id===entry.feldId);
    if(!feld || feld.status !== 'aktiv') return;
    const style = window.schlagColor ? window.schlagColor(feld.status) : {color:'#b07820',fillColor:'#b07820',fillOpacity:0.35,weight:2};
    const poly = L.polygon([entry.outer,...(entry.holes||[])], {...style, interactive:true});
    poly.on('click', () => highlightSchlagNav(feld.id));
    poly.bindTooltip(feld.name, {permanent:false, className:'schlag-popup', direction:'center'});
    poly.addTo(map);
    _navLayers[entry.feldId] = poly;
  });
  const allPts = Object.values(_navLayers);
  if(allPts.length) {
    const group = L.featureGroup(allPts);
    map.fitBounds(group.getBounds(), {padding:[20,20]});
  }
}

export function highlightSchlagNav(feldId) {
  if(_navHighlight && _navLayers[_navHighlight]) {
    const f = state.felder.find(x=>x.id===_navHighlight);
    if(f && window.schlagColor) _navLayers[_navHighlight].setStyle(window.schlagColor(f.status));
  }
  _navHighlight = feldId;
  const layer = _navLayers[feldId];
  if(layer) {
    layer.setStyle({fillColor:'#a8c878',fillOpacity:0.6,color:'#6b8f4e',weight:3});
    _navMap.fitBounds(layer.getBounds(), {padding:[40,40], maxZoom:16});
  }
  const el = document.getElementById('nav-item-'+feldId);
  if(el) el.scrollIntoView({behavior:'smooth', block:'nearest'});
}

function schlagNavItem(f) {
  const shape = state.shapes.find(s=>s.feldId===f.id);
  const hasCoords = shape && shape.outer && shape.outer.length > 0;
  const statusColor = f.status==='aktiv'?'var(--gold2)':f.status==='abgeerntet'?'var(--green)':'var(--text3)';
  const statusLabel = f.status==='aktiv'?'Aktiv':f.status==='abgeerntet'?'Fertig':'Inaktiv';
  const isHighlighted = _navHighlight === f.id;
  return '<div id="nav-item-'+f.id+'" onclick="highlightSchlagNav('+f.id+')"'
    +' style="display:flex;align-items:center;justify-content:space-between;padding:11px 13px;border-bottom:1px solid var(--color-border);gap:8px;cursor:pointer;'
    +(isHighlighted?'background:var(--green-50);border-left:3px solid var(--color-primary);':'')
    +'">'
    +'<div style="min-width:0;flex:1">'
    +'<div style="font-size:var(--text-base);font-weight:600;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+f.name+'</div>'
    +'<div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px">'+f.fruchtart+' · '+f.flaeche+' ha · <span style="color:'+statusColor+'">'+statusLabel+'</span></div>'
    +'</div>'
    +(hasCoords
      ? '<button onclick="event.stopPropagation();navigiereZuSchlag('+f.id+')" style="flex-shrink:0;background:var(--color-primary);color:#fff;border:none;padding:7px 12px;border-radius:var(--radius-sm);cursor:pointer;font-size:var(--text-sm);font-weight:600;white-space:nowrap">🧭 Los</button>'
      : '<span style="flex-shrink:0;font-size:var(--text-xs);color:var(--color-text-muted)">kein GPS</span>')
    +'</div>';
}

export function filterSchlagNav(q) {
  const felder = state.felder
    .filter(f => f.status==='aktiv' && (!q || f.name.toLowerCase().includes(q.toLowerCase()) || f.fruchtart.toLowerCase().includes(q.toLowerCase())))
    .sort((a,b)=>a.name.localeCompare(b.name,'de'));
  document.getElementById('schlag-nav-liste').innerHTML = felder.length
    ? felder.map(f=>schlagNavItem(f)).join('')
    : '<div style="text-align:center;padding:24px;color:var(--text2)">Kein Schlag gefunden</div>';
  if(_navMap) {
    Object.entries(_navLayers).forEach(([id, layer]) => {
      const feld = state.felder.find(x=>x.id===parseInt(id));
      if(!feld) return;
      const matches = !q || feld.name.toLowerCase().includes(q.toLowerCase()) || feld.fruchtart.toLowerCase().includes(q.toLowerCase());
      const style = window.schlagColor ? window.schlagColor(feld.status) : {fillOpacity:0.5};
      layer.setStyle(matches ? {...style, fillOpacity:0.5} : {fillOpacity:0.05, weight:0.5, color:'#333'});
    });
  }
}

export function getVermehrungenForFeld(feldId) {
  return state.vermehrungen.filter(v => v.feld_id === feldId);
}
export function isVermehrungsFuhre(f) {
  return !!f.sorte;
}
export function getFuhreKulturKey(f) {
  if(f.sorte) return 'VERMEHRUNG:' + f.sorte;
  return f.fruchtart || 'Unbekannt';
}
