// Fruchtfolge: Stammdaten-CRUD – Kulturen, Kulturgruppen, Nutzungscode-Mapping,
// Betriebe. Farben per Colorpicker, Anbaupausen/Selbstfolge editierbar.
import { getSb } from './db.js?v=118';
import { showToast, escapeHtml } from './helpers.js?v=118';
import { ffState, ffLoadStammdaten, renderFruchtfolge } from './fruchtfolge.js?v=118';

let bereich = 'kulturen'; // kulturen | gruppen | codes | betriebe

export async function renderFFStammdaten(el) {
  const tabs = [
    ['kulturen', 'Kulturen'], ['gruppen', 'Kulturgruppen'], ['codes', 'Nutzungscodes'], ['betriebe', 'Betriebe'],
  ];
  el.innerHTML = `
    <div class="card">
      <div class="ff-chip-gruppe" style="margin-bottom:12px">
        ${tabs.map(([b, l]) => `<button class="ff-chip ${bereich === b ? 'active' : ''}" onclick="ffStammBereich('${b}')">${l}</button>`).join('')}
      </div>
      <div id="ff-stamm-inhalt"></div>
    </div>`;
  const inhalt = document.getElementById('ff-stamm-inhalt');
  if (bereich === 'kulturen') inhalt.innerHTML = kulturenHtml();
  else if (bereich === 'gruppen') inhalt.innerHTML = gruppenHtml();
  else if (bereich === 'codes') inhalt.innerHTML = codesHtml();
  else inhalt.innerHTML = betriebeHtml();
}

export function ffStammBereich(b) { bereich = b; renderFruchtfolge(); }

const gruppeOpts = (sel) => ffState.kulturgruppen.map(g =>
  `<option value="${g.id}" ${g.id === sel ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('');
const kulturOpts = (sel) => ffState.kulturen.map(k =>
  `<option value="${k.id}" ${k.id === sel ? 'selected' : ''}>${escapeHtml(k.name)}</option>`).join('');

function kulturenHtml() {
  return `
    <div class="ff-tabelle-wrap"><table class="ff-tabelle">
      <thead><tr><th>Name</th><th>Kürzel</th><th>Gruppe</th><th>Farbe</th><th>Aktiv</th><th></th></tr></thead>
      <tbody>
        ${ffState.kulturen.map(k => `<tr>
          <td><input value="${escapeHtml(k.name)}" onchange="ffKulturFeld(${k.id}, 'name', this.value)"></td>
          <td><input value="${escapeHtml(k.kuerzel || '')}" style="width:56px" maxlength="4" onchange="ffKulturFeld(${k.id}, 'kuerzel', this.value)"></td>
          <td><select onchange="ffKulturFeld(${k.id}, 'kulturgruppe_id', this.value)"><option value="">—</option>${gruppeOpts(k.kulturgruppe_id)}</select></td>
          <td><input type="color" value="${escapeHtml(k.farbe)}" onchange="ffKulturFeld(${k.id}, 'farbe', this.value)"></td>
          <td><input type="checkbox" ${k.aktiv !== false ? 'checked' : ''} onchange="ffKulturFeld(${k.id}, 'aktiv', this.checked)"></td>
          <td><button class="btn btn-sm" onclick="ffKulturLoeschen(${k.id})">Löschen</button></td>
        </tr>`).join('')}
        <tr>
          <td><input id="ff-neu-kultur-name" placeholder="Neue Kultur…"></td>
          <td><input id="ff-neu-kultur-kuerzel" style="width:56px" maxlength="4" placeholder="Kzl"></td>
          <td><select id="ff-neu-kultur-gruppe"><option value="">Gruppe…</option>${gruppeOpts()}</select></td>
          <td><input type="color" id="ff-neu-kultur-farbe" value="#5ba832"></td>
          <td></td>
          <td><button class="btn btn-sm btn-primary" onclick="ffKulturAnlegen()">Anlegen</button></td>
        </tr>
      </tbody>
    </table></div>`;
}

function gruppenHtml() {
  return `
    <div class="ff-tabelle-wrap"><table class="ff-tabelle">
      <thead><tr><th>Name</th><th>Farbe</th><th title="Mindestjahre bis zum Wiederanbau (0 = keine)">Anbaupause (Jahre)</th><th title="Direktes Folgejahr gleicher Gruppe erlaubt?">Selbstfolge zulässig</th><th title="Kulturen dieser Gruppe werden beim Anlegen eines Planjahres automatisch aus dem Basisjahr übernommen (Brachen, mehrjähriges Feldfutter)">Im Planjahr übernehmen</th><th></th></tr></thead>
      <tbody>
        ${ffState.kulturgruppen.map(g => `<tr>
          <td><input value="${escapeHtml(g.name)}" onchange="ffGruppeFeld(${g.id}, 'name', this.value)"></td>
          <td><input type="color" value="${escapeHtml(g.farbe)}" onchange="ffGruppeFeld(${g.id}, 'farbe', this.value)"></td>
          <td><input type="number" min="0" max="10" value="${g.min_anbaupause_jahre}" style="width:60px" onchange="ffGruppeFeld(${g.id}, 'min_anbaupause_jahre', parseInt(this.value)||0)"></td>
          <td><input type="checkbox" ${g.selbstfolge_zulaessig ? 'checked' : ''} onchange="ffGruppeFeld(${g.id}, 'selbstfolge_zulaessig', this.checked)"></td>
          <td><input type="checkbox" ${g.plan_uebernahme ? 'checked' : ''} onchange="ffGruppeFeld(${g.id}, 'plan_uebernahme', this.checked)"></td>
          <td><button class="btn btn-sm" onclick="ffGruppeLoeschen(${g.id})">Löschen</button></td>
        </tr>`).join('')}
        <tr>
          <td><input id="ff-neu-gruppe-name" placeholder="Neue Gruppe…"></td>
          <td><input type="color" id="ff-neu-gruppe-farbe" value="#888888"></td>
          <td><input type="number" id="ff-neu-gruppe-pause" min="0" max="10" value="0" style="width:60px"></td>
          <td><input type="checkbox" id="ff-neu-gruppe-selbst" checked></td>
          <td><input type="checkbox" id="ff-neu-gruppe-plan"></td>
          <td><button class="btn btn-sm btn-primary" onclick="ffGruppeAnlegen()">Anlegen</button></td>
        </tr>
      </tbody>
    </table></div>
    <p style="opacity:.7;margin-top:8px">Änderungen an Pausen/Selbstfolge wirken bei der nächsten Flag-Neuberechnung (Tab „Flags" → „Neu berechnen").</p>`;
}

function codesHtml() {
  return `
    <div class="ff-tabelle-wrap"><table class="ff-tabelle">
      <thead><tr><th>NC</th><th>Bezeichnung</th><th>Kultur</th><th title="Zählt für Selbstfolge/Anbaupause; Brache/Grünland: nein">FF-relevant</th><th></th></tr></thead>
      <tbody>
        ${ffState.nutzungscodes.map(n => `<tr>
          <td><b>${n.nc}</b></td>
          <td><input value="${escapeHtml(n.bezeichnung)}" onchange="ffNcFeld(${n.nc}, 'bezeichnung', this.value)"></td>
          <td><select onchange="ffNcFeld(${n.nc}, 'kultur_id', this.value)"><option value="">— ungemappt —</option>${kulturOpts(n.kultur_id)}</select></td>
          <td><input type="checkbox" ${n.fruchtfolge_relevant ? 'checked' : ''} onchange="ffNcFeld(${n.nc}, 'fruchtfolge_relevant', this.checked)"></td>
          <td><button class="btn btn-sm" onclick="ffNcLoeschen(${n.nc})">Löschen</button></td>
        </tr>`).join('')}
        <tr>
          <td><input id="ff-neu-nc" type="number" style="width:70px" placeholder="NC"></td>
          <td><input id="ff-neu-nc-bez" placeholder="Bezeichnung"></td>
          <td><select id="ff-neu-nc-kultur"><option value="">Kultur…</option>${kulturOpts()}</select></td>
          <td><input type="checkbox" id="ff-neu-nc-rel" checked></td>
          <td><button class="btn btn-sm btn-primary" onclick="ffNcAnlegen()">Anlegen</button></td>
        </tr>
      </tbody>
    </table></div>`;
}

function betriebeHtml() {
  return `
    <div class="ff-tabelle-wrap"><table class="ff-tabelle">
      <thead><tr><th>BNR</th><th>Name</th><th>Kürzel</th><th>Farbe</th><th></th></tr></thead>
      <tbody>
        ${ffState.betriebe.map(b => `<tr>
          <td><code>${escapeHtml(b.bnr)}</code></td>
          <td><input value="${escapeHtml(b.name)}" onchange="ffBetriebFeld(${b.id}, 'name', this.value)"></td>
          <td><input value="${escapeHtml(b.kuerzel || '')}" style="width:70px" maxlength="8" onchange="ffBetriebFeld(${b.id}, 'kuerzel', this.value)"></td>
          <td><input type="color" value="${escapeHtml(b.farbe)}" onchange="ffBetriebFeld(${b.id}, 'farbe', this.value)"></td>
          <td></td>
        </tr>`).join('') || '<tr><td colspan="5" style="padding:14px">Betriebe entstehen beim Import.</td></tr>'}
      </tbody>
    </table></div>`;
}

// ── Schreiboperationen ──────────────────────────────────────────

async function update(tabelle, match, patch) {
  const sb = getSb();
  let q = sb.from(tabelle).update(patch);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { error } = await q;
  if (error) throw error;
  await ffLoadStammdaten(true);
}

const num = (v) => (v === '' || v === null || v === undefined) ? null : parseInt(v);

export async function ffKulturFeld(id, feld, wert) {
  try {
    await update('kulturen', { id }, { [feld]: feld === 'kulturgruppe_id' ? num(wert) : wert });
    renderFruchtfolge();
  } catch (err) { showToast('Fehler: ' + err.message); }
}
export async function ffKulturAnlegen() {
  const name = document.getElementById('ff-neu-kultur-name')?.value?.trim();
  const kuerzel = document.getElementById('ff-neu-kultur-kuerzel')?.value?.trim();
  const gruppe = document.getElementById('ff-neu-kultur-gruppe')?.value;
  const farbe = document.getElementById('ff-neu-kultur-farbe')?.value;
  if (!name) { showToast('Name fehlt'); return; }
  try {
    const { error } = await getSb().from('kulturen').insert({
      name, kuerzel: kuerzel || name.slice(0, 3), kulturgruppe_id: num(gruppe), farbe: farbe || '#888888',
    });
    if (error) throw error;
    await ffLoadStammdaten(true);
    renderFruchtfolge();
  } catch (err) { showToast('Fehler: ' + err.message); }
}
export async function ffKulturLoeschen(id) {
  if (!confirm('Kultur löschen? Parzellen mit dieser Kultur verlieren die Zuordnung.')) return;
  try {
    const { error } = await getSb().from('kulturen').delete().eq('id', id);
    if (error) throw error;
    await ffLoadStammdaten(true);
    renderFruchtfolge();
  } catch (err) { showToast('Fehler: ' + err.message); }
}

export async function ffGruppeFeld(id, feld, wert) {
  try { await update('kulturgruppen', { id }, { [feld]: wert }); renderFruchtfolge(); }
  catch (err) { showToast('Fehler: ' + err.message); }
}
export async function ffGruppeAnlegen() {
  const name = document.getElementById('ff-neu-gruppe-name')?.value?.trim();
  if (!name) { showToast('Name fehlt'); return; }
  try {
    const { error } = await getSb().from('kulturgruppen').insert({
      name,
      farbe: document.getElementById('ff-neu-gruppe-farbe')?.value || '#888888',
      min_anbaupause_jahre: parseInt(document.getElementById('ff-neu-gruppe-pause')?.value) || 0,
      selbstfolge_zulaessig: document.getElementById('ff-neu-gruppe-selbst')?.checked ?? true,
      plan_uebernahme: document.getElementById('ff-neu-gruppe-plan')?.checked ?? false,
    });
    if (error) throw error;
    await ffLoadStammdaten(true);
    renderFruchtfolge();
  } catch (err) { showToast('Fehler: ' + err.message); }
}
export async function ffGruppeLoeschen(id) {
  if (!confirm('Kulturgruppe löschen? Kulturen dieser Gruppe verlieren die Zuordnung.')) return;
  try {
    const { error } = await getSb().from('kulturgruppen').delete().eq('id', id);
    if (error) throw error;
    await ffLoadStammdaten(true);
    renderFruchtfolge();
  } catch (err) { showToast('Fehler: ' + err.message); }
}

export async function ffNcFeld(nc, feld, wert) {
  try {
    await update('nutzungscodes', { nc }, { [feld]: feld === 'kultur_id' ? num(wert) : wert });
    renderFruchtfolge();
  } catch (err) { showToast('Fehler: ' + err.message); }
}
export async function ffNcAnlegen() {
  const nc = parseInt(document.getElementById('ff-neu-nc')?.value, 10);
  const bez = document.getElementById('ff-neu-nc-bez')?.value?.trim();
  if (!nc || !bez) { showToast('NC und Bezeichnung angeben'); return; }
  try {
    const { error } = await getSb().from('nutzungscodes').insert({
      nc, bezeichnung: bez,
      kultur_id: num(document.getElementById('ff-neu-nc-kultur')?.value),
      fruchtfolge_relevant: document.getElementById('ff-neu-nc-rel')?.checked ?? true,
    });
    if (error) throw error;
    await ffLoadStammdaten(true);
    renderFruchtfolge();
  } catch (err) { showToast('Fehler: ' + err.message); }
}
export async function ffNcLoeschen(nc) {
  if (!confirm(`Nutzungscode ${nc} löschen?`)) return;
  try {
    const { error } = await getSb().from('nutzungscodes').delete().eq('nc', nc);
    if (error) throw error;
    await ffLoadStammdaten(true);
    renderFruchtfolge();
  } catch (err) { showToast('Fehler: ' + err.message); }
}

export async function ffBetriebFeld(id, feld, wert) {
  try { await update('betriebe', { id }, { [feld]: wert }); renderFruchtfolge(); }
  catch (err) { showToast('Fehler: ' + err.message); }
}
