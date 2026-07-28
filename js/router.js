import { state } from './state.js?v=79';

export function renderMain() {
  const r = state.currentUser.role;
  if(r==='drescher') window.renderDrescher();
  else if(r==='abfahrer') window.renderAbfahrer();
  else if(r==='waage') window.renderWaage();
  // Silomeister nutzt die Admin-Oberfläche mit eingeschränkter Navigation (siehe admin.js).
  else window.renderAdmin();
}
