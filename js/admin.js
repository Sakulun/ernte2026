import { state } from './state.js?v=158';

export let adminTab = 'schlaege';
export let schlagFilter = 'alle';
export let schlagSearch = '';
export let sidebarCollapsed = false;

// Sidebar-Navigation als Daten (Reihenfolge wie bisher): [tab, icon, label] je Eintrag.
const NAV = [
  { section: null,             items: [['waage','⚖','Waage']] },
  { section: 'Übersicht',      items: [['dashboard','📊','Dashboard'],['fortschritt','📈','Fortschritt'],['karte','🗺','Karte'],['vermehrungen','🌱','Vermeh&shy;rungen']] },
  { section: 'Verwaltung',     items: [['schlaege','🌾','Schläge'],['fuhren','🚛','Fuhren'],['nutzer','👥','Nutzer']] },
  { section: 'Lager',          items: [['lager','📦','Lager&shy;übersicht'],['silos','🏭','Silo&shy;management']] },
  { section: 'Warenwirtschaft',items: [['warenausgang','⇅','Waren&shy;bewegungen'],['kontrakte','📋','Kontrakte'],['zukauf','🧪','Zukauf (Dünger)'],['kontakte','👔','Kunden/&shy;Lieferanten'],['artikel','🗂','Artikel']] },
  { section: 'Flächen',        items: [['fruchtfolge','🌻','Frucht&shy;folge']] },
  { section: 'System',         items: [['erntejahr','🌱','Neues Erntejahr']] },
];
// Liniensymbole je Tab (24er Raster, Strich) für das Theme Flächenverwaltung; das bisherige Design zeigt die Emojis aus NAV.
const NAV_SYMBOLE = {
  waage: 'M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z',
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  fortschritt: 'M3 3v18h18M7 15l4-4 3 3 6-7',
  karte: 'M9 3 3 5.5v15.5l6-2.5 6 2.5 6-2.5V3l-6 2.5zM9 3v15.5M15 5.5V21',
  vermehrungen: 'M12 21v-9M12 12C12 8 9 5 4 5c0 5 3 7 8 7zM12 15c0-3 3-6 8-6 0 5-3 6-8 6z',
  schlaege: 'M4 4l7 2 9-2v16l-9 2-7-2zM11 6v16',
  fuhren: 'M2 6h12v11H2zM14 10h4l4 4v3h-8zM6.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  nutzer: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7M18 14.5a7 7 0 0 1 4 6.5',
  lager: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
  silos: 'M5 8a7 4 0 0 1 14 0v13H5zM5 8h14M5 14h14',
  warenausgang: 'M7 21V4M3 8l4-4 4 4M17 3v17M13 16l4 4 4-4',
  kontrakte: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  zukauf: 'M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7.5 15h9',
  kontakte: 'M3 21V5h11v16M14 10h7v11M7 9h3M7 13h3M7 17h3M17 14h1M17 18h1',
  artikel: 'M3 7h7l2 2h9v11H3zM3 7V4h7l2 3',
  fruchtfolge: 'M12 3a9 9 0 1 1-9 9M12 3l-3-2M12 3 9 6M12 8a4 4 0 1 1-4 4',
  erntejahr: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4M12 13v5M9.5 15.5h5',
};
// Rollen mit eingeschränkter Navigation. Silomeister sieht nur diese Bereiche.
const ROLE_TABS = {
  silomeister: ['waage','fuhren','vermehrungen','silos','zukauf'],
  waage:       ['waage','fuhren','warenausgang','zukauf'],
};
function erlaubteTabs() { return ROLE_TABS[state.currentUser?.role] || null; } // null = alle

export function renderAdmin() {
  const allowed = erlaubteTabs();
  // Aktuellen Tab auf einen erlaubten zwingen (z.B. Silomeister startet auf "Waage").
  if(allowed && !allowed.includes(adminTab)) { adminTab = allowed[0]; window.adminTab = adminTab; }

  if(adminTab !== 'karte' && window._mapInstance) {
    window._mapInstance.remove(); window._mapInstance = null; window._schlagLayers = {};
  }

  // Bei Rollenwechsel (ohne Reload) die Sidebar neu aufbauen, sonst bliebe die alte Navigation stehen.
  const layout = document.getElementById('admin-layout');
  if(layout && layout.dataset.role !== (state.currentUser?.role || '')) layout.remove();

  if(!document.getElementById('admin-layout')) {
    const btn = (tab, icon, label) =>
      `<button class="sidebar-btn ${adminTab===tab?'active':''}" onclick="setAdminTab('${tab}')">
        <span class="sidebar-icon"><span class="icon-emoji">${icon}</span><svg class="icon-linie" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${NAV_SYMBOLE[tab]}"/></svg></span><span class="sidebar-label">${label}</span>
      </button>`;
    const navHtml = NAV.map(grp => {
      const items = grp.items.filter(([tab]) => !allowed || allowed.includes(tab));
      if(!items.length) return '';
      return (grp.section ? `<div class="sidebar-section">${grp.section}</div>` : '') + items.map(it => btn(...it)).join('');
    }).join('');
    document.getElementById('main-content').innerHTML = `
      <div id="sidebar-overlay" onclick="toggleSidebar()"></div>
      <div id="admin-layout" data-role="${state.currentUser?.role || ''}">
        <nav id="admin-sidebar" class="${sidebarCollapsed?'collapsed':''}">
          <button class="sidebar-toggle" onclick="toggleSidebar()">
            <span style="font-size:18px">${sidebarCollapsed?'☰':'✕'}</span>
            <span class="sidebar-label" style="font-family:var(--font-display);color:var(--color-text-on-brand)">Landgut Nuscheler</span>
          </button>
          ${navHtml}
        </nav>
        <div id="admin-main">
          <div id="admin-main-inner">
            <div id="admintab"></div>
          </div>
        </div>
      </div>`;
  } else {
    document.querySelectorAll('.sidebar-btn').forEach(btn => {
      const tab = btn.getAttribute('onclick')?.match(/'(\w+)'/)?.[1];
      btn.classList.toggle('active', tab === adminTab);
    });
    const inner = document.getElementById('admin-main-inner');
    if(inner) inner.style.padding = adminTab==='karte' ? '0' : '16px';
  }

  if(adminTab==='schlaege' && window.renderAdminSchlaege) window.renderAdminSchlaege();
  else if(adminTab==='dashboard' && window.renderAdminDash) window.renderAdminDash();
  else if(adminTab==='fortschritt' && window.renderAdminFortschritt) window.renderAdminFortschritt();
  else if(adminTab==='vermehrungen' && window.renderAdminVermehrungen) window.renderAdminVermehrungen();
  else if(adminTab==='nutzer' && window.renderAdminNutzer) window.renderAdminNutzer();
  else if(adminTab==='karte' && window.renderAdminKarte) window.renderAdminKarte();
  else if(adminTab==='warenausgang' && window.renderWarenausgang) window.renderWarenausgang();
  else if(adminTab==='kontrakte' && window.renderKontrakte) window.renderKontrakte();
  else if(adminTab==='kontakte' && window.renderKontakte) window.renderKontakte();
  else if(adminTab==='lager' && window.renderAdminLager) window.renderAdminLager();
  else if(adminTab==='artikel' && window.renderArtikel) window.renderArtikel();
  else if(adminTab==='zukauf' && window.renderAdminZukauf) window.renderAdminZukauf();
  else if(adminTab==='erntejahr' && window.renderNeuesErntejahr) window.renderNeuesErntejahr();
  else if(adminTab==='fruchtfolge' && window.renderFruchtfolge) window.renderFruchtfolge();
  else if(adminTab==='waage' && window.renderWaageTab) window.renderWaageTab(document.getElementById('admintab'));
  else if(adminTab==='silos') {
    document.getElementById('admintab').innerHTML = '';
    if(window.showSiloOverlay) window.showSiloOverlay();
  }
  else if(window.renderAdminFuhren) window.renderAdminFuhren();
}

export function setAdminTab(tab) {
  if(tab !== 'silos' && window.hideSiloOverlay) window.hideSiloOverlay();
  adminTab = tab;
  window.adminTab = tab;
  const sb = document.getElementById('admin-sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if(sb && window.innerWidth <= 640) {
    sb.classList.remove('mobile-open');
    if(ov) ov.classList.remove('active');
  }
  renderAdmin();
}

export function toggleSidebar() {
  const sb = document.getElementById('admin-sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if(!sb) return;
  if(window.innerWidth <= 640) {
    sb.classList.toggle('mobile-open');
    if(ov) ov.classList.toggle('active');
  } else {
    sidebarCollapsed = !sidebarCollapsed;
    sb.classList.toggle('collapsed', sidebarCollapsed);
    const icon = sb.querySelector('.sidebar-toggle span:first-child');
    if(icon) icon.textContent = sidebarCollapsed ? '☰' : '✕';
    if(adminTab === 'karte' && window._mapInstance) setTimeout(()=>window._mapInstance.invalidateSize(), 220);
  }
}
