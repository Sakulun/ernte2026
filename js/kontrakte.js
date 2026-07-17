import { state } from './state.js?v=49';
import { db } from './db.js?v=49';
import { showToast, escapeHtml } from './helpers.js?v=49';

export function getKontraktGeliefertKg(kontraktId) {
  const ausKg = state.warenbewegungen
    .filter(w=>w.kontrakt_id===kontraktId && w.typ==='ausgang')
    .reduce((s,w)=>s+(w.menge_kg||0),0);
  const liefKg = state.lieferungen
    .filter(l=>l.kontrakt_id===kontraktId && l.status==='abgeschlossen' && l.vollgewicht && l.leergewicht)
    .reduce((s,l)=>s+(l.vollgewicht-l.leergewicht),0);
  return ausKg + liefKg;
}

export function renderKontrakte() {
  const aktiv    = state.kontrakte.filter(k=>k.status==='aktiv');
  const erfuellt = state.kontrakte.filter(k=>k.status==='erfuellt');
  const stornier = state.kontrakte.filter(k=>k.status==='storniert');
  const gesamtT  = aktiv.reduce((s,k)=>s+(k.menge_t||0),0);
  const geliefT  = aktiv.reduce((s,k)=>s+getKontraktGeliefertKg(k.id)/1000,0);

  const kRow = (k) => {
    const geliefKg  = getKontraktGeliefertKg(k.id);
    const geliefT   = geliefKg/1000;
    const restT     = Math.max(0,(k.menge_t||0)-geliefT);
    const pct       = k.menge_t ? Math.min(100,(geliefT/k.menge_t)*100) : 0;
    const barColor  = pct>=100?'var(--green2)':pct>70?'var(--amber)':'var(--gold)';
    const kt        = state.kontakte.find(c=>c.id===k.kontakt_id);
    const art       = state.artikel.find(a=>a.id===k.artikel_id);
    const vonBis    = [k.lieferung_von,k.lieferung_bis].filter(Boolean).map(d=>new Date(d).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})).join('–');
    return `<div class="card" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div style="font-family:var(--serif);font-size:15px;font-weight:700;color:var(--text)">${escapeHtml(k.nummer)}</div>
            ${k.bio?'<span class="badge badge-aktiv">BIO</span>':''}
            <span class="badge badge-${k.status==='aktiv'?'aktiv':'inaktiv'}">${k.status.toUpperCase()}</span>
          </div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">${kt?escapeHtml(kt.name):'–'}${art?' · '+escapeHtml(art.name):k.fruchtart_text?' · '+escapeHtml(k.fruchtart_text):''}</div>
          <div style="font-size:11px;color:var(--text3)">${vonBis||''}${k.paritaet?' · '+escapeHtml(k.paritaet):''}${k.preis_eur?' · '+k.preis_eur.toFixed(2)+' €/t':''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:18px;font-weight:700;color:var(--text)">${restT.toFixed(1)} t</div>
          <div style="font-size:10px;color:var(--text3)">noch offen</div>
          <div style="font-size:10px;color:var(--text3);margin-top:1px">${geliefT.toFixed(1)} / ${(k.menge_t||0).toFixed(1)} t</div>
        </div>
      </div>
      <div style="background:var(--bg3);border-radius:2px;height:5px;overflow:hidden;margin-bottom:8px">
        <div style="width:${pct.toFixed(1)}%;height:100%;background:${barColor};border-radius:2px;transition:width .3s"></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm btn-outline" onclick="kontraktBearbeiten(${k.id})">✏ Bearbeiten</button>
        ${k.status==='aktiv'?`<button class="btn btn-sm" style="background:none;border:1px solid var(--border2);color:var(--gold)" onclick="kontraktStatus(${k.id},'erfuellt')">✓ Als erfüllt markieren</button>`:''}
        ${k.status==='aktiv'?`<button class="btn btn-sm" style="background:none;border:1px solid var(--border2);color:var(--red)" onclick="kontraktStatus(${k.id},'storniert')">✕ Stornieren</button>`:''}
      </div>
    </div>`;
  };

  let html = `
    <div id="kontrakt-dropzone"
      style="border:2px dashed var(--border2);border-radius:var(--radius);padding:28px;text-align:center;margin-bottom:16px;cursor:pointer;transition:border-color .2s;background:var(--bg2)"
      ondragover="event.preventDefault();this.style.borderColor='var(--gold)'"
      ondragleave="this.style.borderColor='var(--border2)'"
      ondrop="kontraktPDFDrop(event)">
      <div style="font-size:32px;margin-bottom:8px">📄</div>
      <div style="font-family:var(--serif);font-size:15px;font-weight:600;color:var(--text);margin-bottom:4px">Kontrakt-PDF hier ablegen</div>
      <div style="font-size:11px;color:var(--text3)">Kernfelder werden automatisch erkannt · danach zur Prüfung anzeigen</div>
      <input type="file" id="kontrakt-file-input" accept=".pdf" style="display:none" onchange="kontraktPDFDatei(this)">
      <button class="btn btn-sm btn-outline" style="margin-top:12px" onclick="document.getElementById('kontrakt-file-input').click()">Datei wählen</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      <div class="stat-box"><div class="stat-val" style="font-size:22px">${aktiv.length}</div><div class="stat-label">aktive Kontrakte</div></div>
      <div class="stat-box"><div class="stat-val" style="font-size:20px">${gesamtT.toFixed(0)}</div><div class="stat-label">t kontraktiert</div></div>
      <div class="stat-box"><div class="stat-val" style="font-size:20px">${geliefT.toFixed(1)}</div><div class="stat-label">t geliefert</div></div>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button class="btn btn-primary" onclick="kontraktNeuDialog(null)">+ Manuell anlegen</button>
    </div>`;

  if(aktiv.length) {
    html += `<div class="section-label" style="margin-bottom:8px">Aktive Kontrakte (${aktiv.length})</div>`;
    html += aktiv.map(kRow).join('');
  }
  if(erfuellt.length) {
    html += `<div class="section-label" style="margin-top:12px;margin-bottom:8px">Erfüllt (${erfuellt.length})</div>`;
    html += erfuellt.map(kRow).join('');
  }
  if(stornier.length) {
    html += `<div class="section-label" style="margin-top:12px;margin-bottom:8px">Storniert (${stornier.length})</div>`;
    html += stornier.map(kRow).join('');
  }
  if(!state.kontrakte.length) html += '<div class="empty-state">Noch keine Kontrakte. PDF ablegen oder manuell anlegen.</div>';
  document.getElementById('admintab').innerHTML = html;
}

// ─── PDF-Parsing ───
async function extractPDFText(file) {
  if(typeof pdfjsLib === 'undefined') {
    throw new Error('PDF.js nicht geladen');
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: buf}).promise;
  let text = '';
  for(let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(s=>s.str).join(' ') + '\n';
  }
  return text;
}

function parseKontraktPDF(text) {
  const t = text.replace(/\s+/g, ' ');

  const numMatch =
    t.match(/(?:Kontrakt[-\s]?(?:Nr|Nummer)[.:)#\s]+)([\w][\w\-\/]+)/i) ||
    t.match(/(?:Kont\.[-\s]?Nr[.:\s]+)([\w][\w\-\/]+)/i) ||
    t.match(/(?:Vertragsnummer[.:\s]+)([\w][\w\-\/]+)/i) ||
    t.match(/(?:Contract[-\s]?No[.:\s]+)([\w][\w\-\/]+)/i);

  const fruchtarten = ['Winterweizen','Sommerweizen','Wintergerste','Sommergerste','Winterraps','Triticale','Roggen','Hafer','Mais','Soja','Ackerbohnen','Erbsen','Weizen','Gerste','Raps'];
  let fruchtartText = null;
  for(const fa of fruchtarten) {
    if(t.includes(fa)) { fruchtartText = fa; break; }
  }
  const artikelMatch = fruchtartText ? state.artikel.find(a=>a.name===fruchtartText||a.name.toLowerCase()===fruchtartText.toLowerCase()) : null;

  const mengeMatch =
    t.match(/(\d[\d.,]+)\s*(?:Tonnen?|MT|t\b)/i) ||
    t.match(/Menge[.:)#\s]+(\d[\d.,]+)/i);
  const mengeRaw = mengeMatch ? mengeMatch[1].replace(/\./g,'').replace(',','.') : null;
  const mengeT = mengeRaw ? parseFloat(mengeRaw) : null;

  const preisMatch =
    t.match(/(\d[\d.,]+)\s*(?:EUR|€)\s*\/?\s*(?:t|Tonne)/i) ||
    t.match(/(?:EUR|€)\s*(\d[\d.,]+)\s*\/\s*(?:t|Tonne)/i) ||
    t.match(/Preis[.:)#\s]+(\d[\d.,]+)/i);
  const preisRaw = preisMatch ? preisMatch[1].replace('.','').replace(',','.') : null;
  const preisEur = preisRaw ? parseFloat(preisRaw) : null;

  const datumPat = /(\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4})/g;
  const allDaten = [...t.matchAll(datumPat)].map(m=>m[1]);
  const lieferungVon = allDaten[0] ? normDate(allDaten[0]) : null;
  const lieferungBis = allDaten[1] ? normDate(allDaten[1]) : null;

  const parMatch =
    t.match(/\b(frei\s+Werk|frei\s+Verladestation|ab\s+Hof|ab\s+Lager|FOB|CIF|DAP|DDP|CPT)\b/i) ||
    t.match(/Parität[.:\s]+([^\n,;.]{4,30})/i) ||
    t.match(/Lieferbedingung[.:\s]+([^\n,;.]{4,30})/i);

  const bio = /\b(?:bio|ökologisch|organic|öko)\b/i.test(t);

  return {
    nummer: numMatch?.[1]?.trim() || '',
    fruchtartText,
    artikelId: artikelMatch?.id || null,
    mengeT,
    preisEur,
    lieferungVon,
    lieferungBis,
    paritaet: parMatch?.[1]?.trim() || '',
    bio
  };
}

function normDate(s) {
  const parts = s.split(/[.\/]/);
  if(parts.length !== 3) return null;
  let [d, mo, y] = parts;
  if(y.length === 2) y = '20'+y;
  return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

export async function kontraktPDFDrop(event) {
  event.preventDefault();
  document.getElementById('kontrakt-dropzone').style.borderColor = 'var(--border2)';
  const file = event.dataTransfer.files[0];
  if(!file || !file.name.endsWith('.pdf')) { showToast('⚠ Bitte eine PDF-Datei ablegen','error'); return; }
  await kontraktPDFVerarbeiten(file);
}

export async function kontraktPDFDatei(input) {
  const file = input.files[0];
  if(!file) return;
  await kontraktPDFVerarbeiten(file);
}

async function kontraktPDFVerarbeiten(file) {
  showToast('⏳ PDF wird gelesen…');
  try {
    const text = await extractPDFText(file);
    const erkannt = parseKontraktPDF(text);
    kontraktNeuDialog(null, erkannt, file.name, text);
  } catch(e) {
    showToast('⚠ PDF-Fehler: '+e.message,'error');
    kontraktNeuDialog(null, {}, file.name, '');
  }
}

export function kontraktNeuDialog(id, prefill={}, pdfName='', pdfText='') {
  const k = id ? state.kontrakte.find(x=>x.id===id) : null;
  const v = k || prefill;
  const kontaktOpts = state.kontakte.map(c =>
    `<option value="${c.id}"${(v.kontakt_id||v.kontaktId)===c.id?' selected':''}>${escapeHtml(c.name)}</option>`
  ).join('');
  const artOpts = state.artikel.filter(a=>a.aktiv).map(a =>
    `<option value="${a.id}"${(v.artikel_id||v.artikelId)===a.id?' selected':''}>${escapeHtml(a.name)}</option>`
  ).join('');

  const m = document.createElement('div');
  m.id = 'kontrakt-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  m.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);padding:24px;width:100%;max-width:500px;box-shadow:var(--shadow);margin:auto">
      <div style="font-family:var(--serif);font-size:18px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text);margin-bottom:4px">${k?'Kontrakt bearbeiten':'Neuer Kontrakt'}</div>
      ${pdfName?`<div style="font-size:10px;color:var(--text3);margin-bottom:16px">📄 ${escapeHtml(pdfName)}</div>`:'<div style="margin-bottom:16px"></div>'}
      <div class="form-group"><label>Kontraktnummer *</label><input type="text" id="kk-nummer" value="${escapeHtml(v.nummer||k?.nummer||'')}" placeholder="z.B. KT-2026-001"></div>
      <div class="form-group"><label>Kontakt (Käufer/Lieferant)</label>
        <select id="kk-kontakt"><option value="">– kein Kontakt –</option>${kontaktOpts}</select></div>
      <div class="form-group"><label>Artikel</label>
        <select id="kk-artikel"><option value="">– wählen –</option>${artOpts}</select></div>
      <div class="form-group"><label>Fruchtart (Freitext)</label><input type="text" id="kk-fruchtart" value="${escapeHtml(v.fruchtartText||k?.fruchtart_text||'')}" placeholder="z.B. Winterweizen A"></div>
      <div class="form-group"><label>Menge (t) *</label><input type="number" id="kk-menge" value="${v.mengeT||k?.menge_t||''}" step="0.1" min="0"></div>
      <div class="form-group"><label>Preis (€/t)</label><input type="number" id="kk-preis" value="${v.preisEur||k?.preis_eur||''}" step="0.01" min="0"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-group"><label>Lieferung von</label><input type="date" id="kk-von" value="${v.lieferungVon||k?.lieferung_von||''}"></div>
        <div class="form-group"><label>Lieferung bis</label><input type="date" id="kk-bis" value="${v.lieferungBis||k?.lieferung_bis||''}"></div>
      </div>
      <div class="form-group"><label>Parität</label><input type="text" id="kk-paritaet" value="${escapeHtml(v.paritaet||k?.paritaet||'')}" placeholder="z.B. frei Werk"></div>
      <div class="form-group" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="kk-bio" style="width:18px;height:18px;accent-color:var(--gold)" ${(v.bio||k?.bio)?'checked':''}>
        <label style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--gold);margin:0">Bio-Kontrakt</label>
      </div>
      <div class="form-group"><label>Notiz</label><input type="text" id="kk-notiz" value="${escapeHtml(v.notiz||k?.notiz||'')}"></div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary" style="flex:1" onclick="kontraktSpeichern(${k?k.id:'null'},'${encodeURIComponent(pdfName)}','${encodeURIComponent(pdfText.slice(0,5000))}')">${k?'Speichern':'Anlegen'}</button>
        <button class="btn btn-outline" onclick="document.getElementById('kontrakt-modal').remove()">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(m);
}

export function kontraktBearbeiten(id) { kontraktNeuDialog(id); }

export async function kontraktSpeichern(id, pdfNameEnc='', pdfTextEnc='') {
  const nummer    = document.getElementById('kk-nummer')?.value.trim();
  const mengeT    = parseFloat(document.getElementById('kk-menge')?.value);
  if(!nummer || isNaN(mengeT) || mengeT <= 0) { showToast('⚠ Nummer und Menge erforderlich','error'); return; }
  const data = {
    nummer,
    kontaktId: parseInt(document.getElementById('kk-kontakt')?.value)||null,
    artikelId: parseInt(document.getElementById('kk-artikel')?.value)||null,
    fruchtartText: document.getElementById('kk-fruchtart')?.value.trim()||null,
    mengeT,
    preisEur: parseFloat(document.getElementById('kk-preis')?.value)||null,
    lieferungVon: document.getElementById('kk-von')?.value||null,
    lieferungBis: document.getElementById('kk-bis')?.value||null,
    paritaet: document.getElementById('kk-paritaet')?.value.trim()||null,
    bio: document.getElementById('kk-bio')?.checked||false,
    notiz: document.getElementById('kk-notiz')?.value.trim()||null,
    pdfName: decodeURIComponent(pdfNameEnc)||null,
    pdfText: decodeURIComponent(pdfTextEnc)||null,
  };
  try {
    if(id) {
      const k = state.kontrakte.find(x=>x.id===id);
      await db.updateKontrakt({...k, ...data, artikel_id:data.artikelId, kontakt_id:data.kontaktId,
        fruchtart_text:data.fruchtartText, menge_t:data.mengeT, preis_eur:data.preisEur,
        lieferung_von:data.lieferungVon, lieferung_bis:data.lieferungBis});
      Object.assign(k, {nummer:data.nummer, kontakt_id:data.kontaktId, artikel_id:data.artikelId,
        fruchtart_text:data.fruchtartText, menge_t:data.mengeT, preis_eur:data.preisEur,
        lieferung_von:data.lieferungVon, lieferung_bis:data.lieferungBis,
        paritaet:data.paritaet, bio:data.bio, notiz:data.notiz});
    } else {
      const saved = await db.insertKontrakt(data);
      state.kontrakte.unshift(saved);
    }
    document.getElementById('kontrakt-modal')?.remove();
    showToast('✓ Kontrakt gespeichert');
    renderKontrakte();
  } catch(e) { showToast('⚠ '+e.message,'error'); }
}

export async function kontraktStatus(id, newStatus) {
  const k = state.kontrakte.find(x=>x.id===id);
  if(!k) return;
  try {
    await db.updateKontrakt({...k, status:newStatus});
    k.status = newStatus;
    renderKontrakte();
  } catch(e) { showToast('⚠ '+e.message,'error'); }
}
