// Fruchtfolgemanagement – Modul-Shell, gemeinsamer Zustand und Datenzugriff.
// Nur für die Rolle 'admin' (zusätzlich serverseitig via RLS ff_is_admin()).
import { getSb } from './db.js?v=125';
import { state } from './state.js?v=125';
import { showToast, escapeHtml } from './helpers.js?v=125';

export const ffState = {
  loaded: false,
  view: 'karte',
  betriebe: [], jahre: [], kulturen: [], kulturgruppen: [], nutzungscodes: [],
  flags: [],
  // Globale Filter
  filterBetriebe: null,     // null = alle, sonst Set von betrieb_id
  filterKulturgruppe: null, // null = alle, sonst kulturgruppe_id
  leitjahrId: null,         // Referenzjahr der Matrix (Default: jüngstes Jahr)
  jahrId: null,             // gewähltes Jahr für Karte/Tabelle/Dashboard
  parzellenCache: {},       // jahr_id → Zeilen aus ff_parzellen_info
  nebenkulturenCache: {},   // jahr_id → Zeilen aus parzellen_nebenkulturen (mit parzelle_id)
  matchingCache: {},        // leitjahr_id → Zeilen aus ff_matching_info
};

export function ffIstAdmin() {
  return state.currentUser?.role === 'admin';
}

// ── Datenzugriff ──────────────────────────────────────────────

export async function ffLoadStammdaten(force = false) {
  if (ffState.loaded && !force) return;
  const sb = getSb();
  try {
    const [betriebe, jahre, gruppen, kulturen, ncs] = await Promise.all([
      sb.from('betriebe').select('*').order('name'),
      sb.from('jahre').select('*').order('jahr'),
      sb.from('kulturgruppen').select('*').order('name'),
      sb.from('kulturen').select('*').order('name'),
      sb.from('nutzungscodes').select('*').order('nc'),
    ]);
    for (const r of [betriebe, jahre, gruppen, kulturen, ncs]) if (r.error) throw r.error;
    ffState.betriebe = betriebe.data;
    ffState.jahre = jahre.data;
    ffState.kulturgruppen = gruppen.data;
    ffState.kulturen = kulturen.data;
    ffState.nutzungscodes = ncs.data;
    ffState.flags = await ffFetchAlle(() => sb.from('ff_flags_info').select('*').order('jahr', { ascending: false }).order('id'));
    const jJahre = ffState.jahre;
    if (!ffState.leitjahrId || !jJahre.find(j => j.id === ffState.leitjahrId)) {
      ffState.leitjahrId = jJahre.length ? jJahre[jJahre.length - 1].id : null;
    }
    if (!ffState.jahrId || !jJahre.find(j => j.id === ffState.jahrId)) {
      ffState.jahrId = ffState.leitjahrId;
    }
    ffState.loaded = true;
  } catch (err) {
    console.error(err);
    showToast('Fruchtfolge-Stammdaten konnten nicht geladen werden: ' + err.message);
  }
}

export async function ffLoadParzellen(jahrId, force = false) {
  if (!jahrId) return [];
  if (!force && ffState.parzellenCache[jahrId]) return ffState.parzellenCache[jahrId];
  const sb = getSb();
  try {
    const data = await ffFetchAlle(() => sb.from('ff_parzellen_info').select('*')
      .eq('jahr_id', jahrId).order('betrieb_name').order('nummer').order('id'));
    ffState.parzellenCache[jahrId] = data;
    const ids = data.map(p => p.id);
    const neben = [];
    for (let off = 0; off < ids.length; off += 150) {
      const teil = ids.slice(off, off + 150);
      neben.push(...await ffFetchAlle(() => sb.from('parzellen_nebenkulturen').select('*').in('parzelle_id', teil)));
    }
    ffState.nebenkulturenCache[jahrId] = neben;
    return data;
  } catch (err) {
    console.error(err);
    showToast('Parzellen konnten nicht geladen werden: ' + err.message);
    return [];
  }
}

// Alle Zeilen einer Abfrage holen – PostgREST liefert max. 1000 Zeilen pro
// Request, daher seitenweise nachladen.
async function ffFetchAlle(queryBauen) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await queryBauen().range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

export async function ffLoadMatching(leitjahrId, force = false) {
  if (!leitjahrId) return [];
  if (!force && ffState.matchingCache[leitjahrId]) return ffState.matchingCache[leitjahrId];
  const sb = getSb();
  try {
    // Serverseitig auf die Leitjahr-Parzellen filtern (in 150er-Blöcken wegen URL-Länge)
    const leitIds = (ffState.parzellenCache[leitjahrId] || []).map(p => p.id);
    const rows = [];
    for (let off = 0; off < leitIds.length; off += 150) {
      const teil = leitIds.slice(off, off + 150);
      rows.push(...await ffFetchAlle(() => sb.from('ff_matching_info').select('*').in('leit_parzelle_id', teil)));
    }
    ffState.matchingCache[leitjahrId] = rows;
    return rows;
  } catch (err) {
    console.error(err);
    showToast('Matching konnte nicht geladen werden: ' + err.message);
    return [];
  }
}

// Matching für ein Leitjahr sicherstellen: falls noch nie berechnet, RPC anstoßen
const _matchingComputed = {};
export async function ffEnsureMatching(leitjahrId) {
  if (!leitjahrId) return [];
  await ffLoadParzellen(leitjahrId);
  let rows = await ffLoadMatching(leitjahrId);
  if (!rows.length && ffState.jahre.length > 1 && !_matchingComputed[leitjahrId]) {
    _matchingComputed[leitjahrId] = true;
    try {
      const { error } = await getSb().rpc('ff_recompute_matching', { p_leitjahr_id: leitjahrId });
      if (error) throw error;
      rows = await ffLoadMatching(leitjahrId, true);
    } catch (err) {
      console.error(err);
    }
  }
  return rows;
}

// Matching + Flags neu berechnen (nach Import oder Planänderung)
export async function ffRecompute() {
  const sb = getSb();
  try {
    // Matching für ALLE Jahre neu berechnen – jedes Jahr kann Leitjahr der
    // Matrix sein, sonst blieben ältere Leitjahre nach einem Import veraltet.
    for (const j of ffState.jahre) {
      const { error } = await sb.rpc('ff_recompute_matching', { p_leitjahr_id: j.id });
      if (error) throw error;
    }
    const { error: e2 } = await sb.rpc('ff_recompute_flags', {});
    if (e2) throw e2;
    ffState.matchingCache = {};
    ffState.flags = await ffFetchAlle(() => sb.from('ff_flags_info').select('*').order('jahr', { ascending: false }).order('id'));
  } catch (err) {
    console.error(err);
    showToast('Neuberechnung fehlgeschlagen: ' + err.message);
  }
}

// Kultur einer Parzelle setzen (nur Planjahre) + Caches invalidieren
export async function ffSetKultur(parzelleId, kulturId) {
  const sb = getSb();
  const { error } = await sb.from('parzellen').update({ kultur_id: kulturId || null }).eq('id', parzelleId);
  if (error) throw error;
}

export function ffInvalidateJahr(jahrId) {
  delete ffState.parzellenCache[jahrId];
  ffState.matchingCache = {};
}

// ── Filter-Helfer ──────────────────────────────────────────────

export function ffGefilterteParzellen(rows) {
  let out = rows;
  if (ffState.filterBetriebe && ffState.filterBetriebe.size) {
    out = out.filter(p => ffState.filterBetriebe.has(p.betrieb_id));
  }
  if (ffState.filterKulturgruppe) {
    out = out.filter(p => p.kulturgruppe_id === ffState.filterKulturgruppe);
  }
  return out;
}

export function ffJahr(jahrId) { return ffState.jahre.find(j => j.id === jahrId) || null; }
export function ffIstPlanjahr(jahrId) { return ffJahr(jahrId)?.typ === 'plan'; }
export function ffKultur(id) { return ffState.kulturen.find(k => k.id === id) || null; }
export function ffOffeneFlags() { return ffState.flags.filter(f => f.status === 'offen'); }

// ── Shell ──────────────────────────────────────────────

const FF_VIEWS = [
  ['karte', '🗺', 'Karte'],
  ['matrix', '▦', 'Matrix'],
  ['tabelle', '☰', 'Tabelle'],
  ['dashboard', '◔', 'Anbauverhältnis'],
  ['flags', '⚠', 'Flags'],
  ['plan', '🗓', 'Planjahre'],
  ['import', '⇪', 'Import'],
  ['stammdaten', '⚙', 'Stammdaten'],
];

export async function renderFruchtfolge() {
  const el = document.getElementById('admintab');
  if (!el) return;
  if (!ffIstAdmin()) {
    el.innerHTML = '<div class="card"><p>Das Fruchtfolgemanagement ist nur für Administratoren zugänglich.</p></div>';
    return;
  }
  if (!ffState.loaded) {
    el.innerHTML = '<div class="card"><p>Lade Fruchtfolge-Daten…</p></div>';
    await ffLoadStammdaten();
    if (!ffState.loaded) return;
  }
  const offen = ffOffeneFlags();
  const hoch = offen.filter(f => f.schweregrad === 'hoch').length;
  const flagBadge = offen.length
    ? `<span class="ff-flagbadge" title="${offen.length} offene Flags, davon ${hoch} hoch">${offen.length} offen${hoch ? `, ${hoch} hoch` : ''}</span>`
    : '';
  el.innerHTML = `
    <div class="ff-header">
      <h2 style="margin:0">Fruchtfolge ${flagBadge}</h2>
      <div class="ff-subnav">
        ${FF_VIEWS.map(([v, icon, label]) =>
          `<button class="ff-subnav-btn ${ffState.view === v ? 'active' : ''}" onclick="ffSetView('${v}')">${icon} ${label}</button>`).join('')}
      </div>
      <div class="ff-filterbar" id="ff-filterbar"></div>
    </div>
    <div id="ff-view"></div>`;
  renderFFFilterbar();
  const view = document.getElementById('ff-view');
  if (ffState.view === 'karte' && window.renderFFKarte) await window.renderFFKarte(view);
  else if (ffState.view === 'matrix' && window.renderFFMatrix) await window.renderFFMatrix(view);
  else if (ffState.view === 'tabelle' && window.renderFFTabelle) await window.renderFFTabelle(view);
  else if (ffState.view === 'dashboard' && window.renderFFDashboard) await window.renderFFDashboard(view);
  else if (ffState.view === 'flags' && window.renderFFFlags) await window.renderFFFlags(view);
  else if (ffState.view === 'plan' && window.renderFFPlan) await window.renderFFPlan(view);
  else if (ffState.view === 'import' && window.renderFFImport) await window.renderFFImport(view);
  else if (ffState.view === 'stammdaten' && window.renderFFStammdaten) await window.renderFFStammdaten(view);
}

export function ffSetView(v) {
  ffState.view = v;
  renderFruchtfolge();
}

// Globale Filterleiste: Betriebe (Mehrfachauswahl), Leitjahr, Kulturgruppe
function renderFFFilterbar() {
  const bar = document.getElementById('ff-filterbar');
  if (!bar) return;
  // Für Import/Stammdaten/Plan keine Filter nötig
  if (['import', 'stammdaten', 'plan'].includes(ffState.view)) { bar.innerHTML = ''; return; }
  const jahrOpts = ffState.jahre.map(j =>
    `<option value="${j.id}" ${j.id === ffState.leitjahrId ? 'selected' : ''}>${j.jahr}${j.typ === 'plan' ? ' (Plan)' : ''}</option>`).join('');
  bar.innerHTML = `
    <span class="ff-filterlabel">Betriebe:</span>
    <span class="ff-betriebe-filter">
      <button class="ff-chip ${!ffState.filterBetriebe || !ffState.filterBetriebe.size ? 'active' : ''}" onclick="ffToggleBetrieb(null)">alle</button>
      ${ffState.betriebe.map(b =>
        `<button class="ff-chip ${ffState.filterBetriebe?.has(b.id) ? 'active' : ''}" style="--chipfarbe:${escapeHtml(b.farbe)}"
           onclick="ffToggleBetrieb(${b.id})" title="${escapeHtml(b.name)} (${escapeHtml(b.bnr)})">${escapeHtml(b.kuerzel || b.name)}</button>`).join('')}
    </span>
    <span class="ff-filterlabel">Leitjahr:</span>
    <select onchange="ffSetLeitjahr(parseInt(this.value))">${jahrOpts}</select>
    <span class="ff-filterlabel">Kulturgruppe:</span>
    <select onchange="ffSetKulturgruppeFilter(this.value ? parseInt(this.value) : null)">
      <option value="">alle</option>
      ${ffState.kulturgruppen.map(g =>
        `<option value="${g.id}" ${g.id === ffState.filterKulturgruppe ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
    </select>`;
}

export function ffToggleBetrieb(id) {
  if (id === null) ffState.filterBetriebe = null;
  else {
    if (!ffState.filterBetriebe) ffState.filterBetriebe = new Set();
    if (ffState.filterBetriebe.has(id)) ffState.filterBetriebe.delete(id);
    else ffState.filterBetriebe.add(id);
    if (!ffState.filterBetriebe.size) ffState.filterBetriebe = null;
  }
  renderFruchtfolge();
}

export function ffSetLeitjahr(jahrId) {
  ffState.leitjahrId = jahrId;
  ffState.jahrId = jahrId;
  renderFruchtfolge();
}

export function ffSetKulturgruppeFilter(id) {
  ffState.filterKulturgruppe = id;
  renderFruchtfolge();
}
