import { db } from './db.js?v=60';
import { getSb } from './db.js?v=60';

let appReady = false;

export function showLoader(msg) {
  const el = document.getElementById('boot-overlay');
  if(el) el.querySelector('.boot-msg').textContent = msg;
}
export function hideLoader() {
  const el = document.getElementById('boot-overlay');
  if(el) el.style.opacity = '0', setTimeout(()=>el.remove(), 400);
}

export const state = {
  currentUser: null,
  // Nutzer kommen ausschließlich aus der Datenbank (bootApp → db.getNutzer).
  // Keine Zugangsdaten oder Hashes im Code!
  users: [],
  nextUserId: 1,
  felder: [],
  sorten: [
    { id: 1, name: "Erbsen (Markerbse, Schalerbse, Zuckererbse, Futtererbse, Peluschke)" },
    { id: 2, name: "Mais (ohne Silomais NC 411)" },
    { id: 3, name: "Sojabohnen" },
    { id: 4, name: "Sommerdurum  (Hartweizen)" },
    { id: 5, name: "Sommerweichweizen" },
    { id: 6, name: "Sonnenblumen" },
    { id: 7, name: "Winterdurum (Hartweizen)" },
    { id: 8, name: "Wintergerste" },
    { id: 9, name: "Winterraps" },
    { id: 10, name: "Wintertriticale" },
    { id: 11, name: "Winterweichweizen" },
    { id: 12, name: "Zuckerrüben" }
  ],
  fuhren: [],
  silos: [],
  shapes: [],
  lieferungen: [],
  vermehrungen: [],
  nextLieferNr: 1,
  artikel: [],
  warenbewegungen: [],
  kontakte: [],
  kontrakte: [],
  haengerzuege: [],
  umlauf: [],
  waageLive: null,
  nextId: 1, nextNr: 1, lastFeldId: null, lastSorte: null,
};

let _pollTimer = null;
let _lastFuhrenSig = '';
// Polling-Fallback: falls die Realtime-WebSocket-Verbindung im Betriebsnetz
// blockiert ist oder ein Event verloren geht, holt die App regelmäßig die
// Fuhren/Felder nach und rendert NUR bei echter Änderung neu (kein Flackern,
// keine zerstörten Eingaben).
export function startPolling() {
  if(_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(async () => {
    if(!state.currentUser) return;
    if(typeof document !== 'undefined' && document.hidden) return;
    const active = document.activeElement;
    if(active && (active.tagName==='INPUT'||active.tagName==='SELECT'||active.tagName==='TEXTAREA')) return;
    let fuhren;
    try { fuhren = await db.getFuhren(); } catch(e) { return; }
    const sig = JSON.stringify(fuhren.map(f=>[f.id,f.status,f.abfahrerId,f.feldId,f.vollgewicht,f.leergewicht,f.siloId]));
    if(sig === _lastFuhrenSig) return; // keine Änderung -> nicht neu rendern
    _lastFuhrenSig = sig;
    state.fuhren = fuhren;
    const nrs = fuhren.map(f=>parseInt((f.nr||'').replace('F-',''))).filter(n=>!isNaN(n));
    state.nextNr = nrs.length ? Math.max(...nrs)+1 : 1;
    try { state.felder = await db.getFelder(); } catch(e) {}
    const role = state.currentUser.role;
    if(role==='drescher' && window.renderDrescher) window.renderDrescher();
    else if(role==='abfahrer' && window.renderAbfahrer) window.renderAbfahrer();
    else if(role==='admin') {
      if(window.adminTab==='fuhren' && window.renderAdminFuhren) window.renderAdminFuhren();
      else if(window.adminTab==='dashboard' && window.renderAdminDash) window.renderAdminDash();
      else if(window.adminTab==='fortschritt' && window.renderAdminFortschritt) window.renderAdminFortschritt();
    }
  }, 15000);
}

let _subscribed = false;

// Lädt alle Betriebsdaten + startet Echtzeit-Sync. Wird NACH dem Login aufgerufen
// (RLS: Tabellen sind nur für angemeldete Nutzer lesbar, nicht für anon).
export async function loadAppData() {
  try {
    state.felder = await db.getFelder().catch(e => { console.warn('getFelder:', e); return state.felder; });
    state.fuhren = await db.getFuhren().catch(e => { console.warn('getFuhren:', e); return []; });
    state.silos = await db.getSilos().catch(e => { console.warn('getSilos:', e); return []; });
    state.lieferungen = await db.getLieferungen().catch(e => { console.warn('getLieferungen:', e); return []; });
    state.vermehrungen = await db.getVermehrungen().catch(e => { console.warn('getVermehrungen:', e); return []; });
    state.artikel = await db.getArtikel().catch(e => { console.warn('getArtikel:', e); return []; });
    state.warenbewegungen = await db.getWarenbewegungen().catch(e => { console.warn('getWarenbewegungen:', e); return []; });
    state.kontakte = await db.getKontakte().catch(e => { console.warn('getKontakte:', e); return []; });
    state.kontrakte = await db.getKontrakte().catch(e => { console.warn('getKontrakte:', e); return []; });
    state.haengerzuege = await db.getHaengerzuege().catch(e => { console.warn('getHaengerzuege:', e); return []; });
    state.umlauf = await db.getUmlauf().catch(e => { console.warn('getUmlauf:', e); return []; });
    const sb = getSb();
    try { const { data: wlData } = await sb.from('waage_live').select('*').eq('id',1).single(); state.waageLive = wlData || null; } catch(e) { state.waageLive = null; }
    const lnrs = state.lieferungen.map(l=>parseInt((l.nr||'').replace('L-',''))).filter(n=>!isNaN(n));
    state.nextLieferNr = lnrs.length ? Math.max(...lnrs)+1 : 1;

    showLoader('Lade Shapes…');
    try {
      const dbShapes = await db.getShapes();
      if(dbShapes.length > 0) {
        state.shapes = dbShapes.map(s=>({
          feldId: s.feld_id,
          betrieb: s.betrieb||'',
          outer: s.outer_coords,
          holes: s.holes||[]
        }));
      } else {
        state.shapes = typeof GEO_DATA !== 'undefined' ? GEO_DATA : [];
      }
    } catch(e) {
      console.warn('Shapes aus DB nicht geladen:', e);
      state.shapes = typeof GEO_DATA !== 'undefined' ? GEO_DATA : [];
    }

    const nrs = state.fuhren.map(f=>parseInt((f.nr||'').replace('F-',''))).filter(n=>!isNaN(n));
    state.nextNr = nrs.length ? Math.max(...nrs)+1 : 1;

    showLoader('Echtzeit-Sync wird gestartet…');
    try {
      if(!_subscribed) { _subscribed = true;
      db.subscribeAll(async (payload) => {
        const tbl = payload.table;
        if(tbl === 'gps_positionen') {
          const gps = await db.getGPS().catch(()=>[]);
          gps.forEach(g => {
            window._userLocations = window._userLocations || {};
            window._userLocations[g.nutzer_id] = {lat:parseFloat(g.lat), lon:parseFloat(g.lon), ts:new Date(g.aktualisiert_am).getTime()};
          });
          if(window._mapInstance) window.updateGPSMarkers(window._mapInstance);
          return;
        }
        if(tbl === 'silos') { state.silos = await db.getSilos().catch(()=>[]); return; }
        if(tbl === 'warenbewegungen') { state.warenbewegungen = await db.getWarenbewegungen().catch(()=>[]); return; }
        if(tbl === 'umlauf') {
          // Mehrere Waage-Geräte müssen dieselben wartenden Fahrzeuge sehen
          state.umlauf = await db.getUmlauf().catch(()=>state.umlauf);
          // Nicht neu rendern, während jemand ein Gewicht eintippt – sonst wäre
          // die Eingabe weg. Die Liste zieht beim nächsten Klick nach.
          const akt = document.activeElement;
          const tippt = akt && ['INPUT','SELECT','TEXTAREA'].includes(akt.tagName);
          if(!tippt && window.adminTab === 'waage' && window.renderWaageTab) {
            const el = document.getElementById('admintab');
            if(el) window.renderWaageTab(el);
          }
          return;
        }
        if(tbl === 'artikel') { state.artikel = await db.getArtikel().catch(()=>[]); return; }
        if(tbl === 'kontakte') { state.kontakte = await db.getKontakte().catch(()=>[]); return; }
        if(tbl === 'kontrakte') { state.kontrakte = await db.getKontrakte().catch(()=>[]); return; }
        if(tbl === 'waage_live') {
          try { const { data } = await sb.from('waage_live').select('*').eq('id',1).single(); state.waageLive = data || null; } catch(e) {}
          if(window.updateWaageWidget) window.updateWaageWidget();
          if(window.adminTab === 'warenausgang' && window.renderWaageBar) window.renderWaageBar();
          return;
        }
        if(tbl === 'fuhren') {
          state.fuhren = await db.getFuhren().catch(()=>[]);
          const nrs2 = state.fuhren.map(f=>parseInt((f.nr||'').replace('F-',''))).filter(n=>!isNaN(n));
          state.nextNr = nrs2.length ? Math.max(...nrs2)+1 : 1;
        } else if(tbl === 'felder') {
          state.felder = await db.getFelder().catch(()=>state.felder);
          if(window.refreshMapColors) window.refreshMapColors();
        }
        if(!state.currentUser) return;
        // Nur überspringen, wenn der Nutzer gerade aktiv ein Eingabefeld bearbeitet
        // (sonst würde sein Eingabewert beim Re-Render verloren gehen). NICHT pauschal
        // bei Fokus irgendwo in einer .card – das verhinderte sonst alle Live-Updates.
        const active = document.activeElement;
        const isInteracting = active && (
          active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA'
        );
        if(isInteracting) return;
        const role = state.currentUser.role;
        if(role === 'admin') {
          if(window.adminTab === 'dashboard' && window.renderAdminDash) window.renderAdminDash();
          else if(window.adminTab === 'fortschritt' && window.renderAdminFortschritt) window.renderAdminFortschritt();
          else if(window.adminTab === 'fuhren' && window.renderAdminFuhren) window.renderAdminFuhren();
        }
        else if(role === 'drescher') {
          const vorher = state.fuhren.filter(f=>f.drescherId===state.currentUser.id&&f.status==='offen').length;
          if(window.renderDrescher) window.renderDrescher();
          const nachher = state.fuhren.filter(f=>f.drescherId===state.currentUser.id&&f.status==='offen').length;
          if(nachher < vorher && window.showToast) window.showToast('✓ Abfahrer hat Fuhre abgeladen – Abfahrer wieder frei!');
        }
        else if(role === 'abfahrer') {
          const vorher = state.fuhren.filter(f=>f.abfahrerId===state.currentUser.id&&f.status==='offen').length;
          if(window.renderAbfahrer) window.renderAbfahrer();
          const nachher = state.fuhren.filter(f=>f.abfahrerId===state.currentUser.id&&f.status==='offen').length;
          if(nachher > vorher && window.showToast) window.showToast('🚛 Neue Fuhre zugewiesen!');
        }
      });
      }
    } catch(e) { console.warn('Realtime nicht verfügbar:', e); }

    startPolling();
  } catch(err) {
    console.error('loadAppData error:', err);
    throw err;
  }
}

export async function bootApp() {
  showLoader('Verbinde mit Datenbank…');
  try {
    showLoader('Lade Nutzer…');
    state.users = await db.getNutzer().catch(e => { console.warn('getNutzer:', e); return state.users; });

    // Bestehende Auth-Session? → automatisch wieder anmelden (Daten laden + Dashboard)
    try {
      const sb = getSb();
      const { data: { session } } = await sb.auth.getSession();
      const m = session?.user?.email?.match(/^n(\d+)@ernte2026\.local$/);
      const user = m ? state.users.find(u => u.id === parseInt(m[1])) : null;
      if(user) {
        showLoader('Lade Daten…');
        await loadAppData();
        hideLoader();
        appReady = true;
        window.loginUser(user);
        return;
      }
    } catch(e) { console.warn('Session-Restore fehlgeschlagen:', e); }

    hideLoader();
    appReady = true;
    window.renderLogin();
  } catch(err) {
    showLoader('⚠ Fehler: ' + err.message + ' – Seite neu laden?');
    console.error('bootApp error:', err);
  }
}
