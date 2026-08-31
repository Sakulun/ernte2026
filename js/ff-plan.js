// Fruchtfolge: Planjahre verwalten – anlegen (Kopie eines Basisjahres),
// löschen, auf anderem Basisjahr neu aufbauen.
import { getSb } from './db.js?v=128';
import { showToast, escapeHtml } from './helpers.js?v=128';
import { ffState, ffLoadStammdaten, ffRecompute, renderFruchtfolge } from './fruchtfolge.js?v=128';

export async function renderFFPlan(el) {
  const jahre = ffState.jahre;
  const antragsJahre = jahre.filter(j => j.typ === 'antrag');
  const planJahre = jahre.filter(j => j.typ === 'plan');
  const maxJahr = jahre.length ? Math.max(...jahre.map(j => j.jahr)) : new Date().getFullYear();
  const basisDefault = jahre.length ? jahre[jahre.length - 1].id : null;
  el.innerHTML = `
    <div class="card">
      <h3>Neues Planjahr</h3>
      ${jahre.length ? `
      <div class="ff-paket-form" style="margin-top:8px">
        <label>Jahr: <input id="ff-plan-jahr" type="number" min="2000" max="2100" value="${maxJahr + 1}" style="width:90px"></label>
        <label>Geometrie-Basisjahr:
          <select id="ff-plan-basis">
            ${jahre.map(j => `<option value="${j.id}" ${j.id === basisDefault ? 'selected' : ''}>${j.jahr}${j.typ === 'plan' ? ' (Plan)' : ''}</option>`).join('')}
          </select>
        </label>
        <label><input type="checkbox" id="ff-plan-kultur"> Kulturen des Basisjahres übernehmen</label>
        <button class="btn btn-primary" onclick="ffPlanAnlegen()">Planjahr anlegen</button>
      </div>
      <p style="opacity:.7">Die Parzellen (Geometrie, Nummer, Name, ha, Betrieb) werden aus dem Basisjahr kopiert;
      Betriebe ohne Daten im Basisjahr kommen aus ihrem jeweils jüngsten Jahr dazu, spätere
      Importe ergänzen bestehende Planjahre automatisch. Brachen/Stilllegungen und mehrjähriges
      Feldfutter werden automatisch übernommen (einstellbar je Kulturgruppe unter Stammdaten).
      Übrige Kulturen über Matrix, Tabelle (Massenbearbeitung) oder Karte zuweisen –
      Flags werden dabei sofort berechnet.</p>` : '<p>Zuerst ein Antragsjahr importieren.</p>'}
    </div>
    <div class="card">
      <h3>Vorhandene Jahre</h3>
      <div class="ff-tabelle-wrap"><table class="ff-tabelle">
        <thead><tr><th>Jahr</th><th>Typ</th><th>Basisjahr</th><th></th></tr></thead>
        <tbody>
          ${jahre.slice().reverse().map(j => {
            const basis = j.quelle_jahr_id ? jahre.find(x => x.id === j.quelle_jahr_id) : null;
            return `<tr>
              <td><b>${j.jahr}</b></td>
              <td>${j.typ === 'plan' ? '📝 Planjahr' : 'Antragsjahr (schreibgeschützt)'}</td>
              <td>${basis ? basis.jahr : ''}</td>
              <td>${j.typ === 'plan' ? `
                <button class="btn btn-sm" onclick="ffPlanNeuAufbauen(${j.id}, ${j.jahr})">Neu aufbauen…</button>
                <button class="btn btn-sm" onclick="ffPlanLoeschen(${j.id}, ${j.jahr})">Löschen</button>` : ''}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="4" style="padding:14px">Noch keine Jahre.</td></tr>'}
        </tbody>
      </table></div>
      ${antragsJahre.length ? `<p style="opacity:.7">Wird später der echte Antrag für ein Planjahr importiert,
      fragt der Import, ob das Planjahr ersetzt werden soll.</p>` : ''}
    </div>`;
}

export async function ffPlanAnlegen() {
  const jahr = parseInt(document.getElementById('ff-plan-jahr')?.value, 10);
  const basisId = parseInt(document.getElementById('ff-plan-basis')?.value, 10);
  const kulturUebernehmen = document.getElementById('ff-plan-kultur')?.checked || false;
  if (!jahr || jahr < 2000 || jahr > 2100) { showToast('Bitte gültiges Jahr angeben'); return; }
  if (ffState.jahre.some(j => j.jahr === jahr)) { showToast(`Jahr ${jahr} existiert bereits`); return; }
  try {
    const { error } = await getSb().rpc('ff_create_planjahr', {
      p_jahr: jahr, p_basis_jahr_id: basisId, p_kultur_uebernehmen: kulturUebernehmen,
    });
    if (error) throw error;
    await ffLoadStammdaten(true);
    ffState.parzellenCache = {};
    ffState.matchingCache = {};
    showToast(`Planjahr ${jahr} angelegt`);
    renderFruchtfolge();
    if (kulturUebernehmen) { await ffRecompute(); renderFruchtfolge(); }
  } catch (err) { console.error(err); showToast('Anlegen fehlgeschlagen: ' + err.message); }
}

export async function ffPlanLoeschen(jahrId, jahr) {
  if (!confirm(`Planjahr ${jahr} mit allen geplanten Kulturen unwiderruflich löschen?`)) return;
  try {
    const { error } = await getSb().rpc('ff_delete_planjahr', { p_jahr_id: jahrId });
    if (error) throw error;
    await ffLoadStammdaten(true);
    ffState.parzellenCache = {};
    ffState.matchingCache = {};
    await ffRecompute();
    showToast(`Planjahr ${jahr} gelöscht`);
    renderFruchtfolge();
  } catch (err) { console.error(err); showToast('Löschen fehlgeschlagen: ' + err.message); }
}

export async function ffPlanNeuAufbauen(jahrId, jahr) {
  const basisJahre = ffState.jahre.filter(j => j.id !== jahrId);
  const auswahl = prompt(
    `Planjahr ${jahr} neu aufbauen – alle geplanten Kulturen gehen verloren!\n` +
    `Basisjahr eingeben (${basisJahre.map(j => j.jahr).join(', ')}):`,
    String(basisJahre[basisJahre.length - 1]?.jahr ?? ''));
  if (auswahl === null) return;
  const basis = basisJahre.find(j => j.jahr === parseInt(auswahl, 10));
  if (!basis) { showToast('Unbekanntes Basisjahr'); return; }
  try {
    const sb = getSb();
    const { error: delErr } = await sb.rpc('ff_delete_planjahr', { p_jahr_id: jahrId });
    if (delErr) throw delErr;
    const { error } = await sb.rpc('ff_create_planjahr', {
      p_jahr: jahr, p_basis_jahr_id: basis.id, p_kultur_uebernehmen: false,
    });
    if (error) throw error;
    await ffLoadStammdaten(true);
    ffState.parzellenCache = {};
    ffState.matchingCache = {};
    await ffRecompute();
    showToast(`Planjahr ${jahr} neu aufgebaut (Basis ${basis.jahr})`);
    renderFruchtfolge();
  } catch (err) { console.error(err); showToast('Neu aufbauen fehlgeschlagen: ' + err.message); }
}
