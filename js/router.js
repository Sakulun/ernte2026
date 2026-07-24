import { state } from './state.js?v=70';

export function renderMain() {
  const r = state.currentUser.role;
  if(r==='drescher') window.renderDrescher();
  else if(r==='abfahrer') window.renderAbfahrer();
  else if(r==='silomeister') window.renderSilomeister();
  else if(r==='waage') window.renderWaage();
  else window.renderAdmin();
}
