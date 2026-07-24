import { state } from './state.js?v=70';
import { getFeld, getUser, netto, showToast, istErnteFuhre, fuhrenArt } from './helpers.js?v=70';
import { getSiloFill, getSiloKultur } from './silo.js?v=70';
import {
  LOGO_DATA_URL, FIRMA_NAME, FIRMA_GF, FIRMA_HRB, FIRMA_STNR, FIRMA_UST,
  FIRMA_BANK1, FIRMA_IBAN1, FIRMA_BIC1, FIRMA_BANK2, FIRMA_IBAN2, FIRMA_BIC2
} from './config.js?v=70';

// Dezimalzahlen mit Komma ausgeben, damit deutsches Excel sie als Zahl liest
// (Punkt wird sonst als Datum interpretiert, z.B. "10.3" -> "10. März").
const deNum = v => (v === '' || v == null) ? '' : String(v).replace('.', ',');

export function exportTagesbericht() {
  const heute = new Date();
  const datumStr = heute.toLocaleDateString('de-DE', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
  const datumKurz = heute.toLocaleDateString('de-DE');

  const fertig = state.fuhren.filter(f=>f.status==='fertig');
  const heuteFuhren = fertig.filter(f=>{
    const d = new Date(f.zeit);
    return d.toLocaleDateString('de-DE') === datumKurz;
  });
  const gesamtHa = state.felder.reduce((s,f)=>s+f.flaeche,0);
  const abgHa    = state.felder.filter(f=>f.status==='abgeerntet').reduce((s,f)=>s+f.flaeche,0);
  const aktivHa  = state.felder.filter(f=>f.status==='aktiv').reduce((s,f)=>s+f.flaeche,0);
  const gesamtT  = fertig.reduce((s,f)=>s+(netto(f)||0),0)/1000;

  const kulturen = {};
  // Nur echte Schläge/Ernte-Fuhren – Umlagerung/Zukauf verfälschen die Erntebilanz
  state.felder.filter(f => (f.typ||'schlag')==='schlag').forEach(f=>{
    if(!kulturen[f.fruchtart]) kulturen[f.fruchtart]={ha_gesamt:0,ha_abg:0,ha_aktiv:0,kg:0,fuhren:[],feuchten:[],proteine:[],hls:[],oels:[]};
    kulturen[f.fruchtart].ha_gesamt+=f.flaeche;
    if(f.status==='abgeerntet') kulturen[f.fruchtart].ha_abg+=f.flaeche;
    if(f.status==='aktiv') kulturen[f.fruchtart].ha_aktiv+=f.flaeche;
  });
  fertig.filter(istErnteFuhre).forEach(f=>{
    const fa=f.fruchtart||'Unbekannt';
    if(!kulturen[fa]) kulturen[fa]={ha_gesamt:0,ha_abg:0,ha_aktiv:0,kg:0,fuhren:[],feuchten:[],proteine:[],hls:[],oels:[]};
    kulturen[fa].kg+=(netto(f)||0);
    kulturen[fa].fuhren.push(f);
    if(f.feuchte) kulturen[fa].feuchten.push(f.feuchte);
    if(f.protein) kulturen[fa].proteine.push(f.protein);
    if(f.hlGewicht) kulturen[fa].hls.push(f.hlGewicht);
    if(f.oelgehalt) kulturen[fa].oels.push(f.oelgehalt);
  });

  const avg = arr => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : '–';

  const heuteSchlaegeIds = [...new Set(heuteFuhren.map(f=>f.feldId))];
  const heuteSchlaege = state.felder.filter(f=>
    f.status==='abgeerntet' && heuteSchlaegeIds.includes(f.id)
  );

  const kulturRows = Object.entries(kulturen)
    .filter(([,k])=>k.kg>0||k.ha_abg>0)
    .sort((a,b)=>b[1].kg-a[1].kg)
    .map(([fa,k])=>{
      const pct = k.ha_gesamt>0?(k.ha_abg/k.ha_gesamt*100):0;
      const dtHa = k.ha_abg>0?(k.kg/100/k.ha_abg).toFixed(1):'–';
      const ha_offen = Math.max(0,k.ha_gesamt-k.ha_abg-k.ha_aktiv);
      return `<tr>
        <td>${fa}</td>
        <td class="num">${k.ha_gesamt.toFixed(1)}</td>
        <td class="num green">${k.ha_abg.toFixed(1)}</td>
        <td class="num">${ha_offen.toFixed(1)}</td>
        <td class="num bold">${(k.kg/1000).toFixed(1)}</td>
        <td class="num">${dtHa}</td>
        <td class="num">${avg(k.feuchten)}</td>
        <td class="num">${avg(k.proteine)}</td>
        <td class="num">${avg(k.hls)}</td>
        <td class="num">${avg(k.oels)}</td>
        <td class="num">${pct.toFixed(0)}%</td>
      </tr>`;
    }).join('');

  const schlagRows = heuteSchlaege.length ? heuteSchlaege.map(f=>{
    const fuhren = fertig.filter(x=>x.feldId===f.id);
    const totalKg = fuhren.reduce((s,x)=>s+(netto(x)||0),0);
    const avgF = avg(fuhren.filter(x=>x.feuchte).map(x=>x.feuchte));
    const avgP = avg(fuhren.filter(x=>x.protein).map(x=>x.protein));
    return `<tr>
      <td>${f.name}</td>
      <td>${f.fruchtart}</td>
      <td class="num">${f.flaeche.toFixed(2)}</td>
      <td class="num bold">${(totalKg/1000).toFixed(2)}</td>
      <td class="num">${totalKg>0&&f.flaeche>0?(totalKg/100/f.flaeche).toFixed(1):'–'}</td>
      <td class="num">${fuhren.length}</td>
      <td class="num">${avgF}</td>
      <td class="num">${avgP}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" style="text-align:center;color:#888;padding:16px">Keine Schläge heute abgeschlossen</td></tr>';

  const heuteFuhrenRows = heuteFuhren.sort((a,b)=>new Date(a.zeit)-new Date(b.zeit)).map(f=>{
    const n=netto(f);
    return `<tr>
      <td>${f.nr}</td>
      <td>${new Date(f.zeit).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}</td>
      <td>${getFeld(f.feldId).name}</td>
      <td>${f.fruchtart}</td>
      <td>${getUser(f.drescherId).name}</td>
      <td>${getUser(f.abfahrerId).name}</td>
      <td class="num bold">${n?(n/1000).toFixed(2):'–'}</td>
      <td class="num">${f.feuchte??'–'}</td>
      <td class="num">${f.protein??'–'}</td>
      <td class="num">${f.hlGewicht??'–'}</td>
      <td class="num">${f.oelgehalt??'–'}</td>
      <td>${f.siloId||'–'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="12" style="text-align:center;color:#888;padding:16px">Keine Fuhren heute</td></tr>';

  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html lang="de"><head>
  <meta charset="UTF-8">
  <title>Ernte 2026 – Tagesbericht ${datumKurz}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; background: #fff; padding: 20px 24px; }
    h1 { font-size: 20px; font-weight: 700; color: #1a3a1a; margin-bottom: 2px; }
    .subtitle { font-size: 12px; color: #555; margin-bottom: 20px; }
    h2 { font-size: 13px; font-weight: 700; color: #1a3a1a; margin: 20px 0 8px; border-bottom: 2px solid #2d6a2d; padding-bottom: 4px; }
    .kacheln { display: grid; grid-template-columns: repeat(5,1fr); gap: 10px; margin-bottom: 20px; }
    .kachel { background: #f4f9f4; border: 1px solid #c8e0c8; border-radius: 8px; padding: 10px 12px; }
    .kachel-val { font-size: 22px; font-weight: 700; color: #1a5a1a; line-height: 1; }
    .kachel-lbl { font-size: 10px; color: #555; margin-top: 3px; text-transform: uppercase; letter-spacing: .5px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: #1a3a1a; color: #fff; padding: 6px 8px; text-align: left; font-size: 10px; font-weight: 600; }
    td { padding: 5px 8px; border-bottom: 1px solid #e8f0e8; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fbf8; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .bold { font-weight: 700; }
    .green { color: #1a6a1a; font-weight: 600; }
    .fortschritt { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    .bar-wrap { flex: 1; background: #e8f0e8; border-radius: 6px; height: 14px; overflow: hidden; }
    .bar-abg { height: 100%; background: #2d6a2d; border-radius: 6px; display: inline-block; }
    .bar-akt { height: 100%; background: #c8a840; display: inline-block; }
    .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 10px; color: #888; display: flex; justify-content: space-between; }
    @media print {
      body { padding: 12px 16px; }
      @page { margin: 1.5cm; size: A4 landscape; }
      h2 { page-break-after: avoid; }
      table { page-break-inside: avoid; }
    }
  </style>
  </head><body>
  <h1>Ernte 2026 – Tagesbericht</h1>
  <div class="subtitle">${datumStr} &nbsp;|&nbsp; Erstellt: ${heute.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} Uhr</div>

  <div class="kacheln">
    <div class="kachel"><div class="kachel-val">${gesamtT.toFixed(1)}</div><div class="kachel-lbl">t gesamt</div></div>
    <div class="kachel"><div class="kachel-val">${abgHa.toFixed(0)}</div><div class="kachel-lbl">ha abgeerntet</div></div>
    <div class="kachel"><div class="kachel-val">${(gesamtHa-abgHa-aktivHa).toFixed(0)}</div><div class="kachel-lbl">ha noch offen</div></div>
    <div class="kachel"><div class="kachel-val">${fertig.length}</div><div class="kachel-lbl">Fuhren gesamt</div></div>
    <div class="kachel"><div class="kachel-val">${heuteFuhren.length}</div><div class="kachel-lbl">Fuhren heute</div></div>
  </div>

  <div class="fortschritt">
    <span style="font-size:11px;font-weight:600;white-space:nowrap">Gesamtfortschritt</span>
    <div class="bar-wrap">
      <span class="bar-abg" style="width:${(abgHa/gesamtHa*100).toFixed(1)}%"></span><span class="bar-akt" style="width:${(aktivHa/gesamtHa*100).toFixed(1)}%"></span>
    </div>
    <span style="font-size:12px;font-weight:700;color:#1a1a1a;white-space:nowrap">${(abgHa/gesamtHa*100).toFixed(1)}%</span>
    <span style="font-size:10px;color:#555;white-space:nowrap">${abgHa.toFixed(1)} / ${gesamtHa.toFixed(1)} ha</span>
  </div>

  <h2>Erntefortschritt je Kultur</h2>
  <table>
    <thead><tr>
      <th>Kultur</th><th>ha gesamt</th><th>ha geerntet</th><th>ha offen</th>
      <th>t gesamt</th><th>dt/ha</th><th>Ø Feuchte %</th><th>Ø Protein %</th><th>Ø HL</th><th>Ø Öl %</th><th>Fortschritt</th>
    </tr></thead>
    <tbody>${kulturRows}</tbody>
  </table>

  <h2>Heute abgeschlossene Schläge</h2>
  <table>
    <thead><tr>
      <th>Schlag</th><th>Fruchtart</th><th>ha</th><th>t</th><th>dt/ha</th><th>Fuhren</th><th>Ø Feuchte</th><th>Ø Protein</th>
    </tr></thead>
    <tbody>${schlagRows}</tbody>
  </table>

  <h2>Fuhren heute (${heuteFuhren.length})</h2>
  <table>
    <thead><tr>
      <th>Nr</th><th>Zeit</th><th>Schlag</th><th>Fruchtart</th><th>Drescher</th><th>Abfahrer</th>
      <th>t netto</th><th>Feuchte</th><th>Protein</th><th>HL</th><th>Öl</th><th>Silo</th>
    </tr></thead>
    <tbody>${heuteFuhrenRows}</tbody>
  </table>

  <div class="footer">
    <span>Ernte 2026 &ndash; Automatisch generierter Tagesbericht</span>
    <span>${datumStr}</span>
  </div>

  <script>window.onload=()=>{window.print();}<\/script>
  </body></html>`);
  win.document.close();
}

const LS_LAST_EXPORT = 'ernte_lastFuhrenExport';

function buildFuhrenCSV(fuhren) {
  const h=['Nr','Datum','Uhrzeit','Betriebsteil','Schlag','Fruchtart','Sorte','Drescher','Abfahrer','Vollgew_kg','Leergew_kg','Netto_kg','Netto_t','Feuchte_%','Fallzahl','Protein_%','HL_Gew','Gluten_%','Oelgehalt_%','Status','Verifiziert','Silo'];
  const rows=fuhren.map(f=>{
    const d=new Date(f.zeit);const n=netto(f);
    return [f.nr,d.toLocaleDateString('de-DE'),d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),
      getFeld(f.feldId).betrieb||'',getFeld(f.feldId).name||'',f.fruchtart||'',f.sorte||'',getUser(f.drescherId).name||'',getUser(f.abfahrerId).name||'',
      deNum(f.vollgewicht||''),deNum(f.leergewicht||''),deNum(n||''),deNum(n?(n/1000).toFixed(3):''),
      deNum(f.feuchte||''),deNum(f.fallzahl||''),deNum(f.protein||''),deNum(f.hlGewicht||''),deNum(f.gluten||''),deNum(f.oelgehalt||''),f.status,
      f.verifiziert?'Ja':'Nein',f.siloId||''].join(';');
  });
  return '﻿'+[h.join(';'),...rows].join('\n');
}

function downloadCSV(text, filename) {
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));
  a.download=filename; a.click();
}

const sortFuhren = arr => arr.slice().sort((a,b)=>new Date(a.zeit)-new Date(b.zeit));

// Herkunft einer Fuhre: Zukauf-Lieferant (Feldname) oder eigener Betrieb.
const herkunftFuhre = f => {
  const feld = getFeld(f.feldId);
  if((feld.typ||'schlag') === 'lieferant') return feld.name || 'Zukauf';
  if((feld.typ||'schlag') === 'umlagerung') return 'Umlagerung';
  return feld.betrieb || '';
};

// Export einer beliebigen (z.B. gefilterten) Fuhren-Liste als CSV bzw. Excel.
export function exportFuhrenCSV(fuhren, dateiname) {
  downloadCSV(buildFuhrenCSV(sortFuhren(fuhren)), dateiname || 'Ernte2026_Fuhren.csv');
}

export async function exportFuhrenExcel(fuhren, dateiname) {
  try { await ensureXLSX(); } catch(e) { showToast('Excel-Bibliothek konnte nicht geladen werden.', 'error'); return; }
  const XLSX = window.XLSX;
  const rows = sortFuhren(fuhren);
  const head = ['Nr','Datum','Uhrzeit','Lieferant/Betrieb','Schlag','Fruchtart','Art','Sorte','Abfahrer',
                'Vollgew_kg','Leergew_kg','Netto_t','Feuchte_%','Protein_%','HL_Gew','Gluten_%','Ölgehalt_%','Status','Silo'];
  const aoa = [head];
  rows.forEach(f => {
    const feld = getFeld(f.feldId); const n = netto(f) || 0;
    aoa.push([
      f.nr, new Date(f.zeit).toLocaleDateString('de-DE'), new Date(f.zeit).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),
      herkunftFuhre(f), feld.name||'', f.fruchtart||'', f.sorte?'Vermehrung':'Konsum', f.sorte||'', getUser(f.abfahrerId).name||'',
      f.vollgewicht||null, f.leergewicht||null, n? Math.round(n/10)/100 : null,
      f.feuchte??null, f.protein??null, f.hlGewicht??null, f.gluten??null, f.oelgehalt??null, f.status, f.siloId||''
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = head.map((h,i)=>({wch: i===3?20:(i===4?18:(i===8?14:11))}));
  fmtCols(ws, ['J','K','L','M','N','O','P','Q'], 2, aoa.length);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Fuhren');
  XLSX.writeFile(wb, dateiname || 'Ernte2026_Fuhren.xlsx');
  showToast('✓ Excel exportiert');
}

// Kompletter Export aller Fuhren (setzt den Inkrement-Zeiger NICHT zurück)
export function exportCSV() {
  downloadCSV(buildFuhrenCSV(sortFuhren(state.fuhren)), 'Ernte2026_Export.csv');
}

// Fuhren in einem Datumsbereich (von/bis als 'YYYY-MM-DD', beide inklusive; eine Grenze optional).
export function exportCSVZeitraum(vonStr, bisStr) {
  const von = vonStr ? new Date(vonStr + 'T00:00:00') : null;
  const bis = bisStr ? new Date(bisStr + 'T23:59:59.999') : null;
  if(!von && !bis) { showToast('Bitte Von- und/oder Bis-Datum wählen.', 'error'); return; }
  if(von && bis && von > bis) { showToast('„Von" liegt nach „Bis".', 'error'); return; }
  const sel = sortFuhren(state.fuhren.filter(f => {
    const t = new Date(f.zeit).getTime();
    if(von && t < von.getTime()) return false;
    if(bis && t > bis.getTime()) return false;
    return true;
  }));
  if(!sel.length) { showToast('Keine Fuhren im gewählten Zeitraum.', 'error'); return; }
  downloadCSV(buildFuhrenCSV(sel), `Ernte2026_Export_${vonStr||'start'}_bis_${bisStr||'ende'}.csv`);
  showToast(`✓ ${sel.length} Fuhre${sel.length>1?'n':''} exportiert`);
}

// Nur Fuhren, die seit dem letzten Inkrement-Export hinzugekommen sind (nach zeit).
export function exportCSVSeitLetztem() {
  const last = localStorage.getItem(LS_LAST_EXPORT);
  const lastTs = last ? new Date(last).getTime() : 0;
  const neue = sortFuhren(state.fuhren.filter(f => new Date(f.zeit).getTime() > lastTs));
  if(!neue.length) {
    showToast(last ? 'Keine neuen Fuhren seit dem letzten Export.' : 'Noch kein vorheriger Export – nutze „CSV komplett".', 'error');
    return;
  }
  const stamp = new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
  downloadCSV(buildFuhrenCSV(neue), `Ernte2026_Export_neu_${stamp}.csv`);
  localStorage.setItem(LS_LAST_EXPORT, new Date().toISOString());
  showToast(`✓ ${neue.length} neue Fuhre${neue.length>1?'n':''} exportiert`);
}

// ── Excel-Auswertung (.xlsx) mit mehreren Blättern und Formeln ───────────────
function ensureXLSX() {
  if(window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}
const safeSheetName = (n, used) => {
  let name = n.replace(/[:\\/?*\[\]]/g,'').slice(0,31).trim();
  let base = name, i = 2;
  while(used[name]) { name = (base.slice(0,28) + ' ' + i).slice(0,31); i++; }
  used[name] = 1; return name;
};

// Setzt für alle Zahlen-Zellen der angegebenen Spalten das Format "0.00" (2 Nachkommastellen).
function fmtCols(ws, cols, firstRow, lastRow) {
  cols.forEach(c => {
    for(let r=firstRow; r<=lastRow; r++) {
      const cell = ws[c+r];
      if(cell && cell.t === 'n') cell.z = '0.00';
    }
  });
}

// Kontrakte-Übersicht + alle Auslieferungen (Fuhren) mit Abrechnungsstand.
export async function exportKontrakteExcel() {
  try { await ensureXLSX(); } catch(e) { showToast('Excel-Bibliothek konnte nicht geladen werden.', 'error'); return; }
  const XLSX = window.XLSX;
  const kontrakte = state.kontrakte.slice().sort((a,b) => (a.nummer||'').localeCompare(b.nummer||'','de',{numeric:true}));
  if(!kontrakte.length) { showToast('Keine Kontrakte zum Exportieren.', 'error'); return; }
  const artName   = id => state.artikel.find(a => a.id === id)?.name || '';
  const kundeName = id => state.kontakte.find(c => c.id === id)?.name || '';
  const ausOf     = kId => state.warenbewegungen
    .filter(w => w.typ === 'ausgang' && w.kontrakt_id === kId)
    .sort((a,b) => new Date(a.erstellt_am) - new Date(b.erstellt_am));
  const deDat = d => d ? new Date(d).toLocaleDateString('de-DE') : '';
  const wb = XLSX.utils.book_new();

  const ja = b => b ? 'ja' : '';
  // Excel-Spaltenbuchstabe zum 0-basierten Index
  const colLetter = i => { let s=''; i++; while(i>0){ s=String.fromCharCode(65+(i-1)%26)+s; i=Math.floor((i-1)/26); } return s; };

  // Blatt 1: Kontrakte (mit Siegel-Spalten + Autofilter zum Filtern)
  const kHead = ['Nummer','Kunde','Artikel','Menge_t','Geliefert_t','Rest_t','Preis_EUR_t','Parität','Von','Bis','Status','Fuhren','Zu_klären','Nachhaltig','GMP+','EU-Öko'];
  const kAoa = [kHead];
  kontrakte.forEach(k => {
    const fuhren = ausOf(k.id);
    const geliefT = fuhren.reduce((s,w) => s + (Number(w.menge_kg)||0), 0) / 1000;
    const mengeT = parseFloat(k.menge_t) || 0;
    kAoa.push([
      k.nummer||'', kundeName(k.kontakt_id), artName(k.artikel_id)||k.fruchtart_text||'',
      mengeT, Math.round(geliefT*100)/100, Math.round(Math.max(0, mengeT-geliefT)*100)/100,
      k.preis_eur!=null ? parseFloat(k.preis_eur) : null, k.paritaet||'',
      deDat(k.lieferung_von), deDat(k.lieferung_bis), k.status||'',
      fuhren.length, fuhren.filter(w=>w.klaeren).length,
      ja(k.zert_nachhaltig), ja(k.zert_gmp), ja(k.bio)
    ]);
  });
  const wsK = XLSX.utils.aoa_to_sheet(kAoa);
  fmtCols(wsK, ['D','E','F','G'], 2, kAoa.length);
  wsK['!cols'] = [{wch:14},{wch:22},{wch:16},{wch:10},{wch:11},{wch:9},{wch:11},{wch:14},{wch:11},{wch:11},{wch:11},{wch:8},{wch:9},{wch:11},{wch:8},{wch:9}];
  wsK['!autofilter'] = { ref: 'A1:' + colLetter(kHead.length-1) + kAoa.length };
  XLSX.utils.book_append_sheet(wb, wsK, 'Kontrakte');

  // Blatt 2: Fuhren (alle Auslieferungen je Kontrakt) inkl. Abrechnungsstand + Siegel
  const fHead = ['Kontrakt','Kunde','Lieferschein_Nr','Datum','Artikel','Spedition','Kennzeichen','Netto_t','Gutschrift_Nr','Qualitätsabrechnung_Nr','Zu_klären','Bemerkung','Nachhaltig','GMP+','EU-Öko'];
  const fAoa = [fHead];
  kontrakte.forEach(k => {
    ausOf(k.id).forEach(w => {
      fAoa.push([
        k.nummer||'', kundeName(k.kontakt_id), w.lieferschein_nr||'', deDat(w.erstellt_am),
        artName(w.artikel_id), w.spedition||'', w.kennzeichen||'',
        Math.round((Number(w.menge_kg)||0)/10)/100,
        w.gutschrift_nr||'', w.quali_nr||'', w.klaeren?'ja':'', w.bemerkung||'',
        ja(k.zert_nachhaltig), ja(k.zert_gmp), ja(k.bio)
      ]);
    });
  });
  const wsF = XLSX.utils.aoa_to_sheet(fAoa);
  fmtCols(wsF, ['H'], 2, fAoa.length);
  wsF['!cols'] = [{wch:14},{wch:22},{wch:14},{wch:11},{wch:16},{wch:18},{wch:13},{wch:9},{wch:16},{wch:20},{wch:9},{wch:30},{wch:11},{wch:8},{wch:9}];
  wsF['!autofilter'] = { ref: 'A1:' + colLetter(fHead.length-1) + fAoa.length };
  XLSX.utils.book_append_sheet(wb, wsF, 'Fuhren');

  XLSX.writeFile(wb, 'Ernte2026_Kontrakte.xlsx');
  showToast('✓ Kontrakte-Export erstellt');
}

export async function exportExcelAuswertung() {
  try { await ensureXLSX(); } catch(e) { showToast('Excel-Bibliothek konnte nicht geladen werden.', 'error'); return; }
  const fertige = sortFuhren(state.fuhren.filter(f => f.status === 'fertig'));
  if(!fertige.length) { showToast('Keine abgeschlossenen Fuhren für die Auswertung.', 'error'); return; }
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();

  // --- Blatt "Fuhren" (Basis) ---
  // Spalten: A Nr B Datum C Uhrzeit D Anbaubetrieb E Schlag F Fruchtart G Art
  //          H Sorte I Abfahrer J Voll K Leer L Netto_t
  //          M Feuchte N Protein O HL P Gluten Q Ölgehalt R Status S Silo
  // (Gluten NACH HL eingefügt – die SUMIF/AVERAGEIF-Formeln referenzieren nur H,L,M,N,O.)
  const head = ['Nr','Datum','Uhrzeit','Anbaubetrieb','Schlag','Fruchtart','Art','Sorte','Abfahrer',
                'Vollgew_kg','Leergew_kg','Netto_t','Feuchte_%','Protein_%','HL_Gew','Gluten_%','Ölgehalt_%','Status','Silo'];
  const aoa = [head];
  fertige.forEach(f => {
    const feld = getFeld(f.feldId); const n = netto(f) || 0;
    aoa.push([
      f.nr, new Date(f.zeit).toLocaleDateString('de-DE'), new Date(f.zeit).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),
      feld.betrieb||'', feld.name||'', f.fruchtart||'', fuhrenArt(f), f.sorte||'', getUser(f.abfahrerId).name||'',
      f.vollgewicht||null, f.leergewicht||null, n? Math.round(n/10)/100 : null,
      f.feuchte??null, f.protein??null, f.hlGewicht??null, f.gluten??null, f.oelgehalt??null, f.status, f.siloId||''
    ]);
  });
  const wsF = XLSX.utils.aoa_to_sheet(aoa);
  wsF['!cols'] = head.map((h,i)=>({wch: i===4?18:(i===3?22:(i===8?14:11))}));
  const N = aoa.length; // letzte Datenzeile in Excel
  // Gewichte (J,K), Netto_t (L), Qualitäten (M–Q) auf 2 Nachkommastellen
  fmtCols(wsF, ['J','K','L','M','N','O','P','Q'], 2, N);
  XLSX.utils.book_append_sheet(wb, wsF, 'Fuhren');

  // Fertigstellung = Zeitpunkt der letzten Fuhre. Weder 'felder' noch
  // 'vermehrungen' führen ein eigenes Abschlussdatum.
  const letzteFuhre = (filter) => {
    const zeiten = fertige.filter(filter).map(f => new Date(f.zeit).getTime()).filter(t => !isNaN(t));
    return zeiten.length ? new Date(Math.max(...zeiten)) : null;
  };
  const datumZelle = (ws, adr, d) => {
    if(!d) return;
    ws[adr] = { t:'d', v:d, z:'DD.MM.YYYY' };
  };

  // --- Blatt "Vermehrungen" (je Sorte, Formeln auf 'Fuhren') ---
  // Mengen aus Netto_t (Fuhren Spalte L), Kriterium Sorte (Fuhren Spalte H).
  // Spalten: A Sorte B Fruchtart C Anbaubetrieb D Fertig_am E Größe_ha
  //          F Gesamt_t G Ertrag_dt_ha H Ø_Feuchte I Ø_Protein J Ø_HL
  const fertigSorte = {};
  [...new Set(fertige.filter(f=>f.sorte).map(f=>f.sorte))].forEach(s => {
    fertigSorte[s] = letzteFuhre(f => f.sorte === s);
  });
  const sorten = Object.keys(fertigSorte)
    .sort((a,b) => (fertigSorte[a]?.getTime()||0) - (fertigSorte[b]?.getTime()||0) || a.localeCompare(b,'de'));
  const flaecheBySorte = {};
  state.vermehrungen.forEach(v => { flaecheBySorte[v.sorte] = (flaecheBySorte[v.sorte]||0) + (parseFloat(v.flaeche)||0); });
  const vHead = ['Sorte','Fruchtart','Anbaubetrieb','Fertig_am','Größe_ha','Gesamt_t','Ertrag_dt_ha','Ø_Feuchte_%','Ø_Protein_%','Ø_HL'];
  const vAoa = [vHead];
  sorten.forEach(s => {
    const bsp = fertige.find(f => f.sorte === s);
    const feld = bsp ? getFeld(bsp.feldId) : {};
    vAoa.push([s, bsp?.fruchtart||'', feld.betrieb||'', null, Math.round((flaecheBySorte[s]||0)*100)/100, null,null,null,null,null]);
  });
  const wsV = XLSX.utils.aoa_to_sheet(vAoa, {cellDates:true});
  for(let i=0;i<sorten.length;i++){
    const r = i+2;
    datumZelle(wsV, 'D'+r, fertigSorte[sorten[i]]);
    wsV['F'+r] = { t:'n', z:'0.00', f:`SUMIF(Fuhren!$H$2:$H$${N},$A${r},Fuhren!$L$2:$L$${N})` };          // Gesamt_t
    wsV['G'+r] = { t:'n', z:'0.00', f:`IFERROR(F${r}*10/E${r},"")` };                                      // dt/ha = t*10/ha
    wsV['H'+r] = { t:'n', z:'0.00', f:`IFERROR(AVERAGEIF(Fuhren!$H$2:$H$${N},$A${r},Fuhren!$M$2:$M$${N}),"")` };
    wsV['I'+r] = { t:'n', z:'0.00', f:`IFERROR(AVERAGEIF(Fuhren!$H$2:$H$${N},$A${r},Fuhren!$N$2:$N$${N}),"")` };
    wsV['J'+r] = { t:'n', z:'0.00', f:`IFERROR(AVERAGEIF(Fuhren!$H$2:$H$${N},$A${r},Fuhren!$O$2:$O$${N}),"")` };
  }
  fmtCols(wsV, ['E','F','G','H','I','J'], 2, sorten.length+1);
  wsV['!cols'] = [{wch:18},{wch:18},{wch:22},{wch:12},{wch:10},{wch:10},{wch:12},{wch:11},{wch:11},{wch:8}];
  XLSX.utils.book_append_sheet(wb, wsV, 'Vermehrungen');

  // --- Blatt "Schlag-Erträge" (Gesamtertrag je Frucht & Schlag = Vermehrung + Konsum) ---
  // Summiert ALLE Fuhren eines Schlags je Fruchtart (Kriterium Schlag E + Fruchtart F),
  // unabhängig davon ob Konsum oder Vermehrung.
  // Spalten: A Schlag B Fruchtart C Anbaubetrieb D Fertig_am E Fläche_ha
  //          F Gesamt_t G Ertrag_dt_ha H Ø_Feuchte I Ø_Protein J Ø_HL
  const feldIdsFertig = [...new Set(fertige.map(f=>f.feldId))];
  // Abgeerntete Schläge ohne eigene Fuhren gehören mit in den Export: bei einer
  // Mischfuhre wird die Menge auf einen Schlag gebucht, die übrigen bleiben ohne
  // Fuhre, sind aber fertig. Sie stehen mit 0 t und ohne Fertig_am in der Liste.
  const ohneFuhren = state.felder
    .filter(fd => fd.status === 'abgeerntet' && !feldIdsFertig.includes(fd.id))
    .map(fd => fd.id);
  const fertigFeld = {};
  feldIdsFertig.forEach(id => { fertigFeld[id] = letzteFuhre(f => f.feldId === id); });
  const schlaege = [...feldIdsFertig, ...ohneFuhren].map(id => getFeld(id))
    .filter(fd => fd && fd.name && (fd.typ||'schlag')==='schlag')
    .sort((a,b)=> {
      const da = fertigFeld[a.id]?.getTime() ?? null;
      const db = fertigFeld[b.id]?.getTime() ?? null;
      // Schläge ohne Datum ans Ende, statt sie mit 0 nach vorn zu ziehen
      if(da === null || db === null) {
        if(da !== db) return da === null ? 1 : -1;
      } else if(da !== db) return da - db;
      return (a.name||'').localeCompare(b.name||'','de')
          || (a.fruchtart||'').localeCompare(b.fruchtart||'','de');
    });
  const sHead = ['Schlag','Fruchtart','Anbaubetrieb','Fertig_am','Fläche_ha','Gesamt_t','Ertrag_dt_ha','Ø_Feuchte_%','Ø_Protein_%','Ø_HL'];
  const sAoa = [sHead];
  schlaege.forEach(fd => {
    sAoa.push([fd.name||'', fd.fruchtart||'', fd.betrieb||'', null, Math.round((fd.flaeche||0)*100)/100, null,null,null,null,null]);
  });
  const wsS = XLSX.utils.aoa_to_sheet(sAoa, {cellDates:true});
  for(let i=0;i<schlaege.length;i++){
    const r = i+2;
    datumZelle(wsS, 'D'+r, fertigFeld[schlaege[i].id]);
    wsS['F'+r] = { t:'n', z:'0.00', f:`SUMIFS(Fuhren!$L$2:$L$${N},Fuhren!$E$2:$E$${N},$A${r},Fuhren!$F$2:$F$${N},$B${r})` };
    wsS['G'+r] = { t:'n', z:'0.00', f:`IFERROR(F${r}*10/E${r},"")` };
    wsS['H'+r] = { t:'n', z:'0.00', f:`IFERROR(AVERAGEIFS(Fuhren!$M$2:$M$${N},Fuhren!$E$2:$E$${N},$A${r},Fuhren!$F$2:$F$${N},$B${r}),"")` };
    wsS['I'+r] = { t:'n', z:'0.00', f:`IFERROR(AVERAGEIFS(Fuhren!$N$2:$N$${N},Fuhren!$E$2:$E$${N},$A${r},Fuhren!$F$2:$F$${N},$B${r}),"")` };
    wsS['J'+r] = { t:'n', z:'0.00', f:`IFERROR(AVERAGEIFS(Fuhren!$O$2:$O$${N},Fuhren!$E$2:$E$${N},$A${r},Fuhren!$F$2:$F$${N},$B${r}),"")` };
  }
  fmtCols(wsS, ['E','F','G','H','I','J'], 2, schlaege.length+1);
  wsS['!cols'] = [{wch:18},{wch:18},{wch:22},{wch:12},{wch:10},{wch:10},{wch:12},{wch:11},{wch:11},{wch:8}];
  XLSX.utils.book_append_sheet(wb, wsS, 'Schlag-Erträge');

  // --- Je Kultur ein Blatt "Konsum <Kultur>" ---
  const konsum = fertige.filter(f => !f.sorte && istErnteFuhre(f));
  const kulturen = [...new Set(konsum.map(f => f.fruchtart || 'Unbekannt'))].sort((a,b)=>a.localeCompare(b,'de'));
  const used = { 'Fuhren':1, 'Vermehrungen':1, 'Schlag-Erträge':1 };
  kulturen.forEach(fa => {
    const rows = konsum.filter(f => (f.fruchtart||'Unbekannt') === fa);
    const kHead = ['Nr','Datum','Anbaubetrieb','Schlag','Netto_t','Feuchte_%','Protein_%','HL_Gew','Ölgehalt_%'];
    const kAoa = [kHead];
    rows.forEach(f => { const feld = getFeld(f.feldId); const n = netto(f)||0;
      kAoa.push([f.nr, new Date(f.zeit).toLocaleDateString('de-DE'), feld.betrieb||'', feld.name||'',
        n?Math.round(n/10)/100:null, f.feuchte??null, f.protein??null, f.hlGewicht??null, f.oelgehalt??null]);
    });
    const dataLast = kAoa.length; // Excel-Zeile der letzten Datenzeile
    kAoa.push(['Summe / Ø','','','', null,null,null,null,null]);
    const ws = XLSX.utils.aoa_to_sheet(kAoa);
    const t = kAoa.length; // Excel-Zeile der Summenzeile
    if(dataLast >= 2) {
      ws['E'+t] = { t:'n', z:'0.00', f:`SUM(E2:E${dataLast})` };
      ws['F'+t] = { t:'n', z:'0.00', f:`IFERROR(AVERAGE(F2:F${dataLast}),"")` };
      ws['G'+t] = { t:'n', z:'0.00', f:`IFERROR(AVERAGE(G2:G${dataLast}),"")` };
      ws['H'+t] = { t:'n', z:'0.00', f:`IFERROR(AVERAGE(H2:H${dataLast}),"")` };
      ws['I'+t] = { t:'n', z:'0.00', f:`IFERROR(AVERAGE(I2:I${dataLast}),"")` };
    }
    fmtCols(ws, ['E','F','G','H','I'], 2, t);
    ws['!cols'] = [{wch:8},{wch:11},{wch:22},{wch:18},{wch:10},{wch:10},{wch:10},{wch:8},{wch:10}];
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName('Konsum '+fa, used));
  });

  wb.Workbook = { CalcPr: { fullCalcOnLoad: true } }; // Excel rechnet Formeln beim Öffnen neu
  XLSX.writeFile(wb, 'Ernte2026_Auswertung.xlsx');
  showToast('✓ Excel-Auswertung erstellt');
}

export function exportSiloCSV() {
  const avg = (arr,key) => {
    const valid = arr.filter(f=>f[key]!=null);
    return valid.length ? (valid.reduce((s,f)=>s+(f[key]||0),0)/valid.length).toFixed(1) : '';
  };
  const h=['Silo','Kapazitaet_t','Kultur','Befuellt_t','Auslastung_%','Fuhren','Ø_Feuchte_%','Ø_Protein_%','Ø_HL_Gew','Ø_Gluten_%','Ø_Fallzahl','Ø_Oelgehalt_%'];
  const siloRows = state.silos.sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true})).map(s=>{
    const fuhren = state.fuhren.filter(f=>f.siloId===s.id&&f.status==='fertig');
    const fillT = (getSiloFill(s.id)/1000).toFixed(2);
    const pct = (getSiloFill(s.id)/1000/s.kapazitaet_t*100).toFixed(1);
    return [s.id,deNum(s.kapazitaet_t),getSiloKultur(s.id)||'',deNum(fillT),deNum(pct),fuhren.length,
      deNum(avg(fuhren,'feuchte')),deNum(avg(fuhren,'protein')),deNum(avg(fuhren,'hlGewicht')),deNum(avg(fuhren,'gluten')),deNum(avg(fuhren,'fallzahl')),deNum(avg(fuhren,'oelgehalt'))].join(';');
  });
  const lines = [h.join(';'), ...siloRows, '', 'FUHREN JE SILO','Nr;Datum;Schlag;Fruchtart;Netto_t;Feuchte;Protein;HL_Gew;Gluten;Fallzahl;Oelgehalt;Silo'];
  state.silos.sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true})).forEach(s=>{
    const fuhren = state.fuhren.filter(f=>f.siloId===s.id&&f.status==='fertig').sort((a,b)=>new Date(a.zeit)-new Date(b.zeit));
    if(!fuhren.length) return;
    lines.push('=== Silo '+s.id+' ('+( getSiloKultur(s.id)||'leer')+') ===');
    fuhren.forEach(f=>{
      const n=netto(f);
      lines.push([f.nr,new Date(f.zeit).toLocaleDateString('de-DE'),getFeld(f.feldId).name||'',
        f.fruchtart||'',deNum(n?(n/1000).toFixed(3):''),deNum(f.feuchte||''),deNum(f.protein||''),deNum(f.hlGewicht||''),deNum(f.gluten||''),deNum(f.fallzahl||''),deNum(f.oelgehalt||''),s.id].join(';'));
    });
  });
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob(['﻿'+lines.join('\n')],{type:'text/csv;charset=utf-8'}));
  a.download='Ernte2026_Silos.csv';a.click();
}

export function lieferungPDF(id) {
  const l = state.lieferungen.find(x=>x.id===id);
  if(!l) return;
  const datum = new Date(l.datum).toLocaleDateString('de-DE');
  const uhrzeit = new Date(l.datum).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
  const leer = l.leergewicht?l.leergewicht.toLocaleString('de-DE')+' kg':'–';
  const voll = l.vollgewicht?l.vollgewicht.toLocaleString('de-DE')+' kg':'–';
  const nettoStr = (l.vollgewicht&&l.leergewicht)?((l.vollgewicht-l.leergewicht)/1000).toFixed(2)+' t':'–';
  const isBioLief = l.bio;
  const win = window.open('','_blank');
  win.document.write('<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">'
    +'<title>Lieferschein '+l.nr+'</title><style>'
    +'*{box-sizing:border-box;margin:0;padding:0}'
    +'body{font-family:"Segoe UI",Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:24px 32px}'
    +'.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;border-bottom:2px solid #3a7d2c;padding-bottom:14px}'
    +'.firma{font-size:10px;color:#444;margin-top:6px;line-height:1.6}'
    +'.title{font-size:36px;font-weight:900;color:#1a1a1a}'
    +'.meta{border-collapse:collapse;min-width:200px;margin-top:8px;margin-left:auto}'
    +'.meta td{padding:4px 10px;border:1px solid #ccc;font-size:11px}'
    +'.meta td:first-child{color:#555;background:#f8f8f8;width:130px}'
    +'.meta td:last-child{font-weight:600;text-align:right}'
    +'.kaeufer{margin:18px 0 4px;font-size:13px;font-weight:700}'
    +'table.main{width:100%;border-collapse:collapse;margin:18px 0}'
    +'table.main th{background:#3a7d2c;color:#fff;padding:7px 10px;text-align:left;font-size:11px}'
    +'table.main td{padding:8px 10px;border-bottom:1px solid #e0e0e0}'
    +'table.main tr.total td{background:#f0f7ee;font-weight:700;font-size:13px;border-top:2px solid #3a7d2c}'
    +'.sped{display:flex;gap:16px;margin:8px 0 16px}'
    +'.sped .f{flex:1;border:1px solid #ccc;border-radius:4px;padding:8px 12px}'
    +'.sped .f .l{font-size:10px;color:#888;margin-bottom:3px}'
    +'.sped .f .v{font-size:12px;font-weight:600}'
    +'.footer{margin-top:36px;padding-top:12px;border-top:1px solid #ccc;display:flex;justify-content:space-between;gap:20px}'
    +'.sign .line{border-bottom:1px solid #333;height:36px;margin-bottom:4px;}'
    +'.sign .sub{font-size:9px;color:#777}'
    +'.bank{font-size:9px;color:#555;line-height:1.7}'
    +'.bank h4{font-size:10px;font-weight:700;color:#1a1a1a;margin-bottom:3px}'
    +'@media print{body{padding:12px 20px} @page{margin:1.2cm;size:A4 portrait}}'
    +'</style></head><body>'
    +'<div class="hdr"><div>'
    +'<img src="'+LOGO_DATA_URL+'" height="56" alt="Logo">'
    +'<div class="firma">Bahnhofstraße 11 · 06198 Salzatal OT Beesenstedt<br>☎ 03 47 73 - 3 90 01 &nbsp;|&nbsp; ✉ office@landgut-nuscheler.de</div>'
    +'</div><div style="text-align:right"><div class="title">Lieferschein</div>'
    +'<table class="meta"><tr><td>Nummer</td><td>'+l.nr+'</td></tr>'
    +'<tr><td>Datum</td><td>'+datum+'</td></tr>'
    +'<tr><td>Uhrzeit</td><td>'+uhrzeit+' Uhr</td></tr>'
    +(l.kontrakt?'<tr><td>Kontrakt</td><td>'+l.kontrakt+'</td></tr>':'')+(isBioLief?'<tr><td>Öko-Zertifikat</td><td style="color:#16a34a;font-weight:700">DE-ÖKO-006</td></tr>':'')
    +'</table></div></div>'
    +'<div class="kaeufer">'+l.kaeufer_name+'</div>'
    +(l.kaeufer_adresse?'<div style="font-size:11px;color:#444;margin-bottom:16px">'+l.kaeufer_adresse+'</div>':'<div style="margin-bottom:16px"></div>')
    +'<table class="main"><thead><tr>'
    +'<th>Artikel</th><th>Einheit</th><th>Leergewicht</th><th>Vollgewicht</th><th style="text-align:right">Nettomenge</th>'
    +'</tr></thead><tbody>'
    +'<tr><td style="font-weight:600">'+l.fruchtart+(isBioLief?' <span style="color:#16a34a;font-size:10px;font-weight:800;border:1px solid #16a34a;padding:1px 4px;border-radius:3px">BIO</span>':'')+'</td><td>t</td><td>'+leer+'</td><td>'+voll+'</td><td style="text-align:right;font-weight:700;font-size:13px">'+nettoStr+'</td></tr>'
    +'<tr style="height:28px"><td colspan="5"></td></tr>'
    +'<tr style="height:28px"><td colspan="5"></td></tr>'
    +'</tbody><tfoot><tr class="total"><td colspan="4">Gesamt Netto</td><td style="text-align:right">'+nettoStr+'</td></tr></tfoot></table>'
    +'<div class="sped">'
    +'<div class="f"><div class="l">Spedition</div><div class="v">'+(l.spedition||'')+'</div></div>'
    +'<div class="f"><div class="l">Kennzeichen</div><div class="v">'+(l.kennzeichen||'')+'</div></div>'
    +'</div>'
    +'<div style="font-size:11px;margin-bottom:16px">Rückstellmuster: <span style="border-bottom:1px solid #333;display:inline-block;width:200px;margin-left:8px">&nbsp;</span></div>'
    +(l.notiz?'<div style="font-size:11px;color:#555;margin-bottom:8px">Notiz: '+l.notiz+'</div>':'')
    +'<div class="footer">'
    +'<div style="flex:2"><div style="font-size:11px;font-weight:600;margin-bottom:4px">'+FIRMA_NAME+'</div>'
    +'<div style="font-size:9px;color:#666;line-height:1.6;margin-bottom:14px">'+FIRMA_HRB+'<br>'+FIRMA_GF+'<br>'+FIRMA_STNR+'<br>'+FIRMA_UST+'</div>'
    +'<div class="sign"><div class="line"></div><div class="sub">Unterschrift / Stempel Aussteller</div></div></div>'
    +'<div style="flex:1"><div class="sign"><div class="line"></div><div class="sub">Unterschrift Empfänger / Lieferant</div></div></div>'
    +'<div style="flex:1.5"><div class="bank"><h4>Bankverbindungen</h4>'
    +FIRMA_BANK1+'<br>'+FIRMA_IBAN1+'<br>'+FIRMA_BIC1+'<br><br>'
    +FIRMA_BANK2+'<br>'+FIRMA_IBAN2+'<br>'+FIRMA_BIC2+'</div></div>'
    +'</div>'
    +'<script>window.onload=()=>window.print()<\/script>'
    +'</body></html>');
  win.document.close();
}
