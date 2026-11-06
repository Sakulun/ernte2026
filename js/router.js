import { state } from './state.js?v=161';
import { ansichtenVon } from './rechte.js?v=161';

export function renderMain() {
  const ansichten = ansichtenVon(state.currentUser);
  if(!ansichten.includes(state.ansicht)) state.ansicht = ansichten[0] || null;
  if(state.ansicht==='drescher') window.renderDrescher();
  else if(state.ansicht==='abfahrer') window.renderAbfahrer();
  // Alle Tabs der Verwaltung laufen über die Admin-Oberfläche, die Navigation zeigt nur die erlaubten (siehe admin.js).
  else if(state.ansicht==='verwaltung') window.renderAdmin();
  else document.getElementById('main-content').innerHTML = '<div class="empty-state" style="padding:40px 16px">Für dieses Konto sind noch keine Bereiche freigegeben. Bitte an die Verwaltung wenden.</div>';
}
