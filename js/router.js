import { state } from './state.js?v=124';

export function renderMain() {
  const r = state.currentUser.role;
  if(r==='drescher') window.renderDrescher();
  else if(r==='abfahrer') window.renderAbfahrer();
  // Waage & Silomeister nutzen die Admin-Oberfläche mit eingeschränkter Navigation (siehe admin.js).
  else window.renderAdmin();
}
