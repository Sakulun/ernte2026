import { state } from './state.js?v=60';
import { lagerOrtVon, naechstesLager } from './silo.js?v=60';

// Geo-Helfer: Schlagmittelpunkte, Abladestellen und Näherung der Fahrstrecke.

// Die Luftlinie unterschätzt die reale Strecke über Feld- und Landstraßen.
// 1,3 ist der übliche Umwegfaktor für ländliche Straßennetze.
const UMWEGFAKTOR = 1.3;

// Koordinaten je Standort. Deckt damit auch die geteilten Hallen
// (Thondorf 1/2, Höhnstedt 1/2) und alle Silozellen am Hof mit ab.
const ORT_KOORDINATEN = {
  'Beesenstedt':    { lat: 51.5671, lon: 11.7338 },
  'Anarode':        { lat: 51.5502, lon: 11.4049 },
  'Höhnstedt':      { lat: 51.5016, lon: 11.7410 },
  'Bad Lauchstädt': { lat: 51.3874, lon: 11.8680 },
  'Thondorf':       { lat: 51.5992, lon: 11.5291 },
};

export function haversineKm(a, b) {
  if(!a || !b) return null;
  const R = 6371, rad = Math.PI/180;
  const dLat = (b.lat-a.lat)*rad, dLon = (b.lon-a.lon)*rad;
  const h = Math.sin(dLat/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

// Flächenschwerpunkt eines Polygons (Gauß'sche Trapezformel). Besser als der
// Mittelwert der Eckpunkte, der sich zu dicht vermessenen Rändern hin verzieht.
export function polygonMittelpunkt(coords) {
  if(!coords || !coords.length) return null;
  const mittel = () => ({
    lat: coords.reduce((s,c)=>s+c[0],0)/coords.length,
    lon: coords.reduce((s,c)=>s+c[1],0)/coords.length,
  });
  if(coords.length < 3) return mittel();
  let a2 = 0, sLat = 0, sLon = 0;
  for(let i=0, n=coords.length; i<n; i++) {
    const [lat1, lon1] = coords[i];
    const [lat2, lon2] = coords[(i+1)%n];
    const f = lon1*lat2 - lon2*lat1;
    a2   += f;
    sLon += (lon1+lon2)*f;
    sLat += (lat1+lat2)*f;
  }
  // Entartetes Polygon (Fläche ~ 0) → Eckpunkt-Mittel
  if(Math.abs(a2) < 1e-12) return mittel();
  return { lat: sLat/(3*a2), lon: sLon/(3*a2) };
}

// Mittelpunkte cachen; Cache verwerfen, sobald state.shapes neu geladen wurde.
let _cacheQuelle = null;
let _mpCache = new Map();
export function schlagMittelpunkt(feldId) {
  if(_cacheQuelle !== state.shapes) { _mpCache = new Map(); _cacheQuelle = state.shapes; }
  if(_mpCache.has(feldId)) return _mpCache.get(feldId);
  const shape = state.shapes.find(s => s.feldId === feldId);
  const mp = shape ? polygonMittelpunkt(shape.outer) : null;
  _mpCache.set(feldId, mp);
  return mp;
}

// Abgeladen wird immer an einer Lagerstätte. Eine GPS-Position weiter draußen
// stammt nicht vom Abladen, sondern von einem Gerät ohne echten Fix (z.B. aus
// dem Mobilfunk-Cache) – sie würde die Strecke um hunderte km verfälschen.
const MAX_GPS_ABWEICHUNG_KM = 25;

// Abladestelle einer Fuhre: bevorzugt die beim Wiegen erfasste GPS-Position,
// sonst der Standort des Lagers, in das die Fuhre einsortiert wurde.
export function abladeStelle(f) {
  if(f.lat != null && f.lon != null) {
    const nah = naechstesLager(f.lat, f.lon);
    if(nah && nah.distKm <= MAX_GPS_ABWEICHUNG_KM) return { lat: f.lat, lon: f.lon, quelle: 'gps' };
  }
  if(f.siloId) {
    const k = ORT_KOORDINATEN[lagerOrtVon(f.siloId)];
    if(k) return { lat: k.lat, lon: k.lon, quelle: 'lager' };
  }
  return null;
}

// Genäherte Fahrstrecke Schlag → Abladestelle (einfache Strecke, ohne Rückweg).
// null, wenn kein Schlagumriss existiert (Zukauf, Umlagerung).
export function fuhreKm(f) {
  const von  = schlagMittelpunkt(f.feldId);
  const nach = abladeStelle(f);
  if(!von || !nach) return null;
  const km = haversineKm(von, nach);
  return km == null ? null : km * UMWEGFAKTOR;
}
