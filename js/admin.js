import { state } from './state.js?v=120';

export let adminTab = 'schlaege';
export let schlagFilter = 'alle';
export let schlagSearch = '';
export let sidebarCollapsed = false;

// Sidebar-Navigation als Daten (Reihenfolge wie bisher): [tab, icon, label] je Eintrag.
const NAV = [
  { section: null,             items: [['waage','⚖','Waage']] },
  { section: 'Übersicht',      items: [['dashboard','📊','Dashboard'],['fortschritt','📈','Fortschritt'],['karte','🗺','Karte'],['vermehrungen','🌱','Vermehrungen']] },
  { section: 'Verwaltung',     items: [['schlaege','🌾','Schläge'],['fuhren','🚛','Fuhren'],['nutzer','👥','Nutzer']] },
  { section: 'Lager',          items: [['lager','📦','Lagerübersicht'],['silos','🏭','Silomanagement']] },
  { section: 'Warenwirtschaft',items: [['warenausgang','⇅','Warenbewegungen'],['kontrakte','📋','Kontrakte'],['zukauf','🧪','Zukauf (Dünger)'],['kontakte','👔','Kunden/Lieferanten'],['artikel','🗂','Artikel']] },
  { section: 'Flächen',        items: [['fruchtfolge','🌻','Fruchtfolge']] },
  { section: 'System',         items: [['erntejahr','🌱','Neues Erntejahr']] },
];
// Rollen mit eingeschränkter Navigation. Silomeister sieht nur diese Bereiche.
const ROLE_TABS = {
  silomeister: ['waage','fuhren','vermehrungen','silos','zukauf'],
  waage:       ['waage','fuhren','zukauf'],
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
        <span class="sidebar-icon">${icon}</span><span class="sidebar-label">${label}</span>
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
