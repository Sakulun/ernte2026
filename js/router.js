import { state } from './state.js?v=34';

export function renderMain() {
  const r = state.currentUser.role;
  if(r==='drescher') window.renderDrescher();
  else if(r==='abfahrer') window.renderAbfahrer();
  else if(r==='silomeister') window.renderSilomeister();
  else window.renderAdmin();
}
