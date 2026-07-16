import { state } from './state.js?v=44';
import { getFeld } from './helpers.js?v=44';

// Fallback-Liste der Bio-Betriebe (nur relevant für Altdaten ohne pro-Feld-Bio-Flag).
// Maßgeblich ist das bio-Feld in der felder-Tabelle (aus der Öko-Spalte der Flächenübersicht).
export const BIO_BETRIEBE = ['von Reiche Nikolaus', 'von Reiche Bernhard', 'von Reiche GbR', 'Ackerbau Beesenstedt'];

export function isBioBetrieb(betrieb) {
  return BIO_BETRIEBE.some(b => (betrieb||'').includes(b));
}

export function isBioFeld(feldId) {
  const feld = getFeld(feldId);
  if(!feld) return false;
  // Pro-Feld-Bio-Flag (aus Öko-Spalte der Flächenübersicht) ist maßgeblich;
  // Fallback auf betrieb-basierte Erkennung für Altdaten ohne Flag.
  if(feld.bio !== undefined) return !!feld.bio;
  return isBioBetrieb(feld.betrieb);
}

export function isBioFuhre(f) {
  return isBioFeld(f.feldId);
}

export function getSiloBioStatus(siloId) {
  const fuhren = state.fuhren.filter(f => f.siloId === siloId && f.status === 'fertig');
  if(!fuhren.length) return null;
  const bioCount = fuhren.filter(f => isBioFuhre(f)).length;
  if(bioCount === fuhren.length) return 'bio';
  if(bioCount === 0) return 'konventionell';
  return 'gemischt';
}

export function bioBadge(inline=false) {
  // Kräftig grün hinterlegt (weiße Schrift) für deutliche Kennzeichnung.
  if(inline) return '<span style="display:inline-block;background:var(--color-success);color:#fff;font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;letter-spacing:0.5px;vertical-align:middle;margin-left:4px">🌿 BIO</span>';
  return '<span style="display:inline-block;background:var(--color-success);color:#fff;font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px;letter-spacing:1px">🌿 BIO</span>';
}
