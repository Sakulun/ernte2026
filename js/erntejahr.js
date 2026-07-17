import { state } from './state.js?v=46';
import { db, sb } from './db.js?v=46';

let _erntejahrStep = 0;

export function erntejahrSkipKML() {
  _erntejahrStep = 3;
  renderNeuesErntejahr();
}

export function renderNeuesErntejahr() {
  document.getElementById('admintab').innerHTML = `
    <div class="card" style="border-color:var(--amber);max-width:640px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <span style="font-size:32px">🌱</span>
        <div>
          <div style="font-family:var(--serif);font-size:20px;color:var(--text)">Neues Erntejahr anlegen</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">Stammdaten aktualisieren für die neue Saison</div>
        </div>
      </div>

      <div style="background:var(--color-warning-wash);border:1px solid var(--color-warning);border-radius:10px;padding:16px;margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:var(--amber);margin-bottom:8px">⚠ Wichtiger Hinweis</div>
        <div style="font-size:12px;color:var(--text);line-height:1.7">
          Dieser Vorgang setzt <strong>alle 156 Schläge</strong> auf "inaktiv" zurück
          und aktualisiert Flächen und Fruchtarten aus der neuen Excel-Datei.<br>
          <strong>Alle Fuhren und Silo-Zuordnungen bleiben erhalten</strong> – sie werden nicht gelöscht.<br>
          Dieser Vorgang kann <strong style="color:var(--amber)">nicht rückgängig gemacht werden.</strong>
        </div>
      </div>

      <!-- Schritt 1: CSV herunterladen -->
      <div style="border:1px solid var(--color-border);border-radius:10px;padding:16px;margin-bottom:12px;background:var(--color-surface)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:28px;height:28px;border-radius:50%;background:${_erntejahrStep>=1?'var(--green)':'var(--amber)'};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0">${_erntejahrStep>=1?'✓':'1'}</div>
          <div style="font-size:13px;font-weight:600;color:var(--text)">Aktuellen Fuhren-Export herunterladen</div>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:12px;padding-left:38px">
          Lade zuerst die vollständige Liste aller bisherigen Fuhren herunter und speichere sie sicher ab. Das ist deine Datensicherung.
        </div>
        <div style="padding-left:38px">
          <button class="btn btn-primary" onclick="erntejahrDownloadCSV()" ${_erntejahrStep>=1?'style="opacity:.5"':''}>
            ⬇ Fuhren-CSV jetzt herunterladen
          </button>
          ${_erntejahrStep>=1?'<span style="font-size:12px;color:var(--green);margin-left:10px">✓ Heruntergeladen</span>':''}
        </div>
      </div>

      <!-- Schritt 2: Excel importieren -->
      <div style="border:1px solid var(--color-border);border-radius:10px;padding:16px;margin-bottom:12px;background:var(--color-surface);opacity:${_erntejahrStep>=1?1:0.4};pointer-events:${_erntejahrStep>=1?'auto':'none'}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:28px;height:28px;border-radius:50%;background:${_erntejahrStep>=2?'var(--green)':_erntejahrStep>=1?'var(--blue)':'var(--bg3)'};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0">${_erntejahrStep>=2?'✓':'2'}</div>
          <div style="font-size:13px;font-weight:600;color:var(--text)">Neue Flächenübersicht importieren (Excel)</div>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:12px;padding-left:38px">
          Lade die Flächenübersicht der neuen Saison hoch. Die App liest Schlagname, Fläche und Fruchtart automatisch aus.
        </div>
        <div style="padding-left:38px">
          <label style="display:inline-block;background:var(--neutral-200);border:1px solid var(--color-border);border-radius:8px;padding:8px 16px;cursor:pointer;font-size:12px;color:var(--text)">
            📊 Excel-Datei auswählen (.xlsx)
            <input type="file" id="import-excel" accept=".xlsx,.xls" style="display:none" onchange="erntejahrExcelImport(this)">
          </label>
          <div id="excel-status" style="font-size:11px;margin-top:8px;color:var(--text2)"></div>
        </div>
      </div>

      <!-- Schritt 3: KML importieren -->
      <div style="border:1px solid var(--color-border);border-radius:10px;padding:16px;margin-bottom:20px;background:var(--color-surface);opacity:${_erntejahrStep>=2?1:0.4};pointer-events:${_erntejahrStep>=2?'auto':'none'}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:28px;height:28px;border-radius:50%;background:${_erntejahrStep>=3?'var(--green)':_erntejahrStep>=2?'var(--blue)':'var(--bg3)'};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0">${_erntejahrStep>=3?'✓':'3'}</div>
          <div style="font-size:13px;font-weight:600;color:var(--text)">Neue Schlaggrenzen importieren (KML) <span style="font-size:11px;color:var(--text2);font-weight:400">– optional</span></div>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:12px;padding-left:38px">
          Falls sich Schlaggrenzen geändert haben, lade die neuen KML-Dateien hoch. Mehrere Dateien gleichzeitig möglich.
        </div>
        <div style="padding-left:38px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <label style="display:inline-block;background:var(--neutral-200);border:1px solid var(--color-border);border-radius:8px;padding:8px 16px;cursor:pointer;font-size:12px;color:var(--text)">
            🗺 KML-Dateien auswählen
            <input type="file" id="import-kml" accept=".kml" multiple style="display:none" onchange="erntejahrKMLImport(this)">
          </label>
          <button class="btn btn-sm btn-outline" onclick="erntejahrSkipKML()">Überspringen →</button>
          <div id="kml-status" style="font-size:11px;margin-top:8px;color:var(--text2);width:100%"></div>
        </div>
      </div>

      ${_erntejahrStep>=3?`
      <div style="background:var(--color-success-wash);border:1px solid var(--color-success);border-radius:10px;padding:16px;text-align:center">
        <div style="font-size:14px;color:var(--green);font-weight:600;margin-bottom:4px">✓ Neues Erntejahr ist bereit</div>
        <div style="font-size:12px;color:var(--text2)">Alle Schläge wurden aktualisiert und auf inaktiv gesetzt. Du kannst jetzt mit der Erntekampagne beginnen.</div>
      </div>`:''}
    </div>`;
}

export function erntejahrDownloadCSV() {
  window.exportCSV();
  _erntejahrStep = 1;
  renderNeuesErntejahr();
}

export async function erntejahrExcelImport(input) {
  const file = input.files[0];
  if(!file) return;
  const statusEl = document.getElementById('excel-status');
  statusEl.textContent = 'Lese Datei…';
  statusEl.style.color = 'var(--text3)';
  try {
    if(!window.XLSX) {
      await new Promise((res,rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload=res; s.onerror=rej; document.head.appendChild(s);
      });
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, {type:'array'});
    let ws=null, sheetName='';
    for(const name of wb.SheetNames) {
      const s=wb.Sheets[name];
      const range=XLSX.utils.decode_range(s['!ref']||'A1:A1');
      if(range.e.r>2){ws=s;sheetName=name;break;}
    }
    if(!ws) throw new Error('Kein passendes Blatt gefunden');
    const rows = XLSX.utils.sheet_to_json(ws,{defval:''});
    statusEl.textContent = `${rows.length} Zeilen in "${sheetName}" gefunden…`;

    const norm = s => s.toString().toLowerCase().replace(/[^a-z0-9]/g,'');
    const get = (row,candidates) => {
      for(const c of candidates){const k=Object.keys(row).find(k=>norm(k).includes(norm(c)));if(k&&row[k])return row[k].toString().trim();}
      return '';
    };
    const ernteCode=[112,113,115,116,131,156,171,210,311,320,330,603];
    const mapped=[];
    for(const row of rows){
      const name=get(row,['bezeichnung','name','schlag']);
      const flaeche=parseFloat(get(row,['aktflaeche','aktfläche','flaeche','fläche']).replace(',','.'));
      const fruchtart=get(row,['beschreibung','fruchtart','nutzung','kultur']);
      const nutzcode=parseInt(get(row,['nutz_code','nutzcode','code'])||'0');
      if(name&&flaeche>0&&fruchtart&&(ernteCode.includes(nutzcode)||nutzcode===0))
        mapped.push({name,flaeche:Math.round(flaeche*10000)/10000,fruchtart});
    }
    if(mapped.length===0) throw new Error('Keine Schläge gefunden – Spalten BEZEICHNUNG, FLAECHE, FRUCHTART vorhanden?');
    statusEl.textContent = `${mapped.length} Schläge gefunden. Aktualisiere Datenbank…`;

    const normName = s => s.toLowerCase().replace(/[äöüß]/g,c=>({ä:'ae',ö:'oe',ü:'ue',ß:'ss'}[c]||c)).replace(/[^a-z0-9]/g,'');
    let updated=0,added=0,errors=0;
    for(const m of mapped){
      const existing=state.felder.find(f=>normName(f.name)===normName(m.name));
      if(existing){
        existing.flaeche=m.flaeche; existing.fruchtart=m.fruchtart; existing.status='inaktiv';
        try{await sb.from('felder').update({flaeche:m.flaeche,fruchtart:m.fruchtart,status:'inaktiv'}).eq('id',existing.id);updated++;}
        catch(e){errors++;}
      } else {
        try{
          const{data}=await sb.from('felder').insert({name:m.name,flaeche:m.flaeche,fruchtart:m.fruchtart,status:'inaktiv'}).select().single();
          if(data){state.felder.push({id:data.id,...m,status:'inaktiv'});added++;}
        }catch(e){errors++;}
      }
    }
    statusEl.style.color='var(--green)';
    statusEl.textContent=`✓ ${updated} aktualisiert · ${added} neu angelegt${errors?' · '+errors+' Fehler':''}`;
    _erntejahrStep=2;
    renderNeuesErntejahr();
  } catch(e) {
    statusEl.style.color='var(--red)';
    statusEl.textContent='⚠ '+e.message;
  }
}

export async function erntejahrKMLImport(input) {
  const files=Array.from(input.files);
  if(!files.length) return;
  const statusEl=document.getElementById('kml-status');
  statusEl.textContent=`${files.length} Dateien werden verarbeitet…`;
  statusEl.style.color='var(--text3)';
  const norm=s=>{const n=s.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9/]/g,'');return n;};
  const cons=s=>norm(s).replace(/[aeiou]/g,'');
  let matched=0,skipped=0;
  const parser=new DOMParser();
  for(const file of files){
    const betrieb=file.name.replace('Parzellen_','').replace('.kml','').replace(/_/g,' ');
    const doc=parser.parseFromString(await file.text(),'text/xml');
    for(const pm of doc.querySelectorAll('Placemark')){
      const name=pm.querySelector('name')?.textContent?.trim()||'';
      const coordsEl=pm.querySelector('outerBoundaryIs coordinates');
      if(!name||!coordsEl) continue;
      const outer=coordsEl.textContent.trim().split(/\s+/).map(pt=>{const p=pt.split(',');return p.length>=2?[Math.round(parseFloat(p[1])*100000)/100000,Math.round(parseFloat(p[0])*100000)/100000]:null;}).filter(Boolean);
      if(outer.length<3) continue;
      const holes=[];
      pm.querySelectorAll('innerBoundaryIs coordinates').forEach(el=>{
        const h=el.textContent.trim().split(/\s+/).map(pt=>{const p=pt.split(',');return p.length>=2?[Math.round(parseFloat(p[1])*100000)/100000,Math.round(parseFloat(p[0])*100000)/100000]:null;}).filter(Boolean);
        if(h.length>=3)holes.push(h);
      });
      const feld=state.felder.find(f=>cons(f.name)===cons(name))||state.felder.find(f=>norm(f.name)===norm(name));
      if(!feld){skipped++;continue;}
      const ex=state.shapes.find(s=>s.feldId===feld.id);
      if(ex){ex.outer=outer;ex.holes=holes;ex.betrieb=betrieb;}
      else state.shapes.push({feldId:feld.id,betrieb,outer,holes});
      try{await db.upsertShape(feld.id,betrieb,outer,holes);matched++;}catch(e){skipped++;}
    }
  }
  if(window._mapInstance){window._mapInstance.remove();window._mapInstance=null;window._schlagLayers={};}
  statusEl.style.color=matched>0?'var(--green)':'var(--amber)';
  statusEl.textContent=`✓ ${matched} Schläge aktualisiert${skipped?' · '+skipped+' nicht gefunden':''}`;
  _erntejahrStep=3;
  renderNeuesErntejahr();
}
