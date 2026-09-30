import { state } from './state.js?v=148';

export const getFeld = id => state.felder.find(f=>f.id===id)||{name:'–',fruchtart:'–',flaeche:0,status:'inaktiv',betrieb:''};
export const getSorte = id => state.sorten.find(s=>s.id===id)||{};
export const getUser = id => state.users.find(u=>u.id===id)||{};
// Leergewicht 0 ist zulässig (z.B. Reinigungsabgang-Fuhre = reines Netto, kein
// Fahrzeug). Daher != null statt truthy – für echte Fuhren (Tara > 0) identisch.
export const netto = f => (f.vollgewicht != null && f.leergewicht != null) ? f.vollgewicht-f.leergewicht : null;
export const kg2t = kg => (kg/1000).toFixed(2)+' t';
export const fmtTime = iso => new Date(iso).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
export const fmtDate = iso => new Date(iso).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});

export function abfahrerIstFrei(uid) {
  return !state.fuhren.some(f=>f.abfahrerId===uid && f.status==='offen');
}

// Echte Ernte-Fuhre (von einem Schlag)? Umlagerungen zwischen Lagern und Zukauf
// von Lieferanten sind eigene Fuhren-Typen und dürfen Ernte-Statistiken
// (t gesamt, dt/ha, Fortschritt) nicht verfälschen.
export function istErnteFuhre(f) {
  return ((getFeld(f.feldId).typ) || 'schlag') === 'schlag';
}
// Kennzeichnung der Fuhren-Art für Anzeigen/Exporte
export function fuhrenArt(f) {
  const typ = getFeld(f.feldId).typ || 'schlag';
  if(typ === 'umlagerung') return 'Umlagerung';
  if(typ === 'lieferant') return 'Zukauf';
  return f.sorte ? 'Vermehrung' : 'Konsum';
}

export function showToast(msg, type='success') {
  const existing = document.getElementById('toast-msg');
  if(existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'toast-msg';
  const bg = type==='error' ? 'var(--color-danger)' : 'var(--color-success)';
  t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:${bg};color:#fff;padding:10px 20px;border-radius:var(--radius-pill);font-size:var(--text-base);font-family:var(--font-sans);z-index:9999;box-shadow:var(--shadow-lg);transition:opacity .3s;white-space:nowrap`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, 2500);
}

export function roleLabel(r) {
  return r==='drescher'?'Drescherfahrer':r==='abfahrer'?'Abfahrer / Waage':r==='silomeister'?'Silomeister':r==='waage'?'Waage':'Admin / Übersicht';
}

export function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Anschrift eines Kontakts. Wird getrennt geführt (strasse/plz/ort); ältere
// Datensätze mit einzeiligem Feld 'adresse' fallen darauf zurück.
export function kontaktAnschrift(k) {
  if(!k) return { strasse:'', plzOrt:'', vorhanden:false };
  const strasse = String(k.strasse||'').trim();
  const plzOrt  = [String(k.plz||'').trim(), String(k.ort||'').trim()].filter(Boolean).join(' ');
  if(strasse || plzOrt) return { strasse, plzOrt, vorhanden:true };
  const alt = String(k.adresse||'').trim();
  return { strasse: alt, plzOrt:'', vorhanden: !!alt };
}
// Einzeilige Schreibweise, z.B. "Klötzerstraße 28-32, 01587 Riesa"
export function kontaktAnschriftZeile(k) {
  const a = kontaktAnschrift(k);
  return [a.strasse, a.plzOrt].filter(Boolean).join(', ');
}

// Badge für Vermehrungssorte einer Fuhre (Z-Saatgut). Leer, wenn Konsum.
export function sorteBadge(f) {
  if(!f || !f.sorte) return '';
  return `<span style="display:inline-block;background:var(--color-info-wash);color:var(--color-info);font-size:10px;font-weight:800;padding:1px 6px;border-radius:4px;letter-spacing:.3px;vertical-align:middle;margin-left:4px;white-space:nowrap">🌱 Vermehrung: ${escapeHtml(f.sorte)}</span>`;
}

export async function hashPW(name, pw) {
  const input = name.toLowerCase() + ':' + pw;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

export async function hashPWLegacy(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

export function navigiereZuSchlag(feldId) {
  const shape = state.shapes.find(s=>s.feldId===feldId);
  let lat, lon;
  if(shape && shape.outer && shape.outer.length > 0) {
    const pts = shape.outer;
    lat = pts.reduce((s,p)=>s+p[0],0)/pts.length;
    lon = pts.reduce((s,p)=>s+p[1],0)/pts.length;
  } else {
    alert('Kein Standort für diesen Schlag hinterlegt.');
    return;
  }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const url = isIOS
    ? `maps://maps.apple.com/?daddr=${lat},${lon}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
  window.open(url, '_blank');
}

// ── Füllzyklus eines Silos/Lagers ────────────────────────────────────────────
// Liefert die Fuhren, die AKTUELL im Lager liegen: alles seit der letzten
// vollständigen Leerung. Ein- (Fuhren) und Ausgänge (Warenbewegungen) werden
// zeitlich sortiert aufsummiert; fällt der Saldo nach einem Ausgang auf ~0, gilt
// das Lager als geleert und ältere Fuhren zählen nicht mehr. Kultur, Bio-Status,
// Qualitäts-Durchschnitte und Feuchtewarnung beziehen sich damit nur auf den
// heutigen Inhalt – nicht auf längst ausgelagerte Ware.
// (Der Bestand selbst wird weiterhin über alle Buchungen gerechnet.)
const LAGER_LEER_TOLERANZ_KG = 100;
export function siloZyklusFuhren(siloId) {
  const fuhren = state.fuhren.filter(f => f.siloId === siloId && f.status === 'fertig');
  if(!fuhren.length) return [];
  const ausgaenge = (state.warenbewegungen || []).filter(w => w.silo_von_id === siloId && w.typ === 'ausgang');
  if(!ausgaenge.length) return fuhren;
  const zugangKg  = fuhren.reduce((sum, f) => sum + (netto(f) || 0), 0);
  const ausgangKg = ausgaenge.reduce((sum, w) => sum + (Number(w.menge_kg) || 0), 0);
  if(zugangKg - ausgangKg <= LAGER_LEER_TOLERANZ_KG) return [];   // heute leer
  const ev = [
    ...fuhren.map(f => ({ t: new Date(f.zeit).getTime() || 0, kg: netto(f) || 0, f })),
    ...ausgaenge.map(w => ({ t: new Date(w.erstellt_am).getTime() || 0, kg: -(Number(w.menge_kg) || 0), f: null })),
  ].sort((a, b) => a.t - b.t || (a.f ? -1 : 1));   // gleiche Zeit: Eingang vor Ausgang
  let saldo = 0, zyklus = [];
  for(const e of ev) {
    saldo += e.kg;
    if(e.f) zyklus.push(e.f);
    else if(saldo <= LAGER_LEER_TOLERANZ_KG) { saldo = 0; zyklus = []; }   // geleert → neuer Zyklus
  }
  return zyklus;
}
