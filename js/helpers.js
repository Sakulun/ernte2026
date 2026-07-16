import { state } from './state.js?v=45';

export const getFeld = id => state.felder.find(f=>f.id===id)||{name:'–',fruchtart:'–',flaeche:0,status:'inaktiv',betrieb:''};
export const getSorte = id => state.sorten.find(s=>s.id===id)||{};
export const getUser = id => state.users.find(u=>u.id===id)||{};
export const netto = f => (f.vollgewicht&&f.leergewicht) ? f.vollgewicht-f.leergewicht : null;
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
  return r==='drescher'?'Drescherfahrer':r==='abfahrer'?'Abfahrer / Waage':r==='silomeister'?'Silomeister':'Admin / Übersicht';
}

export function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
