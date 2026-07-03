import { state } from './state.js?v=29';

export let adminTab = 'schlaege';
export let schlagFilter = 'alle';
export let schlagSearch = '';
export let sidebarCollapsed = false;

export function renderAdmin() {
  if(adminTab !== 'karte' && window._mapInstance) {
    window._mapInstance.remove(); window._mapInstance = null; window._schlagLayers = {};
  }

  if(!document.getElementById('admin-layout')) {
    document.getElementById('main-content').innerHTML = `
      <div id="sidebar-overlay" onclick="toggleSidebar()"></div>
      <div id="admin-layout">
        <nav id="admin-sidebar" class="${sidebarCollapsed?'collapsed':''}">
          <button class="sidebar-toggle" onclick="toggleSidebar()">
            <span style="font-size:18px">${sidebarCollapsed?'☰':'✕'}</span>
            <span class="sidebar-label" style="font-family:var(--font-display);color:var(--color-text-on-brand)">Ernte 2026</span>
          </button>
          <div class="sidebar-section">Übersicht</div>
          <button class="sidebar-btn ${adminTab==='dashboard'?'active':''}" onclick="setAdminTab('dashboard')">
            <span class="sidebar-icon">📊</span><span class="sidebar-label">Dashboard</span>
          </button>
          <button class="sidebar-btn ${adminTab==='fortschritt'?'active':''}" onclick="setAdminTab('fortschritt')">
            <span class="sidebar-icon">📈</span><span class="sidebar-label">Fortschritt</span>
          </button>
          <button class="sidebar-btn ${adminTab==='karte'?'active':''}" onclick="setAdminTab('karte')">
            <span class="sidebar-icon">🗺</span><span class="sidebar-label">Karte</span>
          </button>
          <button class="sidebar-btn ${adminTab==='vermehrungen'?'active':''}" onclick="setAdminTab('vermehrungen')">
            <span class="sidebar-icon">🌱</span><span class="sidebar-label">Vermehrungen</span>
          </button>
          <div class="sidebar-section">Verwaltung</div>
          <button class="sidebar-btn ${adminTab==='schlaege'?'active':''}" onclick="setAdminTab('schlaege')">
            <span class="sidebar-icon">🌾</span><span class="sidebar-label">Schläge</span>
          </button>
          <button class="sidebar-btn ${adminTab==='fuhren'?'active':''}" onclick="setAdminTab('fuhren')">
            <span class="sidebar-icon">🚛</span><span class="sidebar-label">Fuhren</span>
          </button>
          <button class="sidebar-btn ${adminTab==='waage'?'active':''}" onclick="setAdminTab('waage')">
            <span class="sidebar-icon">⚖</span><span class="sidebar-label">Fuhre erfassen</span>
          </button>
          <button class="sidebar-btn ${adminTab==='nutzer'?'active':''}" onclick="setAdminTab('nutzer')">
            <span class="sidebar-icon">👥</span><span class="sidebar-label">Nutzer</span>
          </button>
          <div class="sidebar-section">Lager</div>
          <button class="sidebar-btn ${adminTab==='silos'?'active':''}" onclick="setAdminTab('silos')">
            <span class="sidebar-icon">🏭</span><span class="sidebar-label">Silomanagement</span>
          </button>
          <div class="sidebar-section">Warenwirtschaft</div>
          <button class="sidebar-btn ${adminTab==='warenausgang'?'active':''}" onclick="setAdminTab('warenausgang')">
            <span class="sidebar-icon">⇅</span><span class="sidebar-label">Warenbewegungen</span>
          </button>
          <button class="sidebar-btn ${adminTab==='kontrakte'?'active':''}" onclick="setAdminTab('kontrakte')">
            <span class="sidebar-icon">📋</span><span class="sidebar-label">Kontrakte</span>
          </button>
          <button class="sidebar-btn ${adminTab==='kontakte'?'active':''}" onclick="setAdminTab('kontakte')">
            <span class="sidebar-icon">👔</span><span class="sidebar-label">Kunden/Lieferanten</span>
          </button>
          <button class="sidebar-btn ${adminTab==='artikel'?'active':''}" onclick="setAdminTab('artikel')">
            <span class="sidebar-icon">🗂</span><span class="sidebar-label">Artikel</span>
          </button>
          <div class="sidebar-section">System</div>
          <button class="sidebar-btn ${adminTab==='erntejahr'?'active':''}" onclick="setAdminTab('erntejahr')">
            <span class="sidebar-icon">🌱</span><span class="sidebar-label">Neues Erntejahr</span>
          </button>
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
  else if(adminTab==='artikel' && window.renderArtikel) window.renderArtikel();
  else if(adminTab==='erntejahr' && window.renderNeuesErntejahr) window.renderNeuesErntejahr();
  else if(adminTab==='waage' && window.renderWaageErfassungInto) window.renderWaageErfassungInto(document.getElementById('admintab'));
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
