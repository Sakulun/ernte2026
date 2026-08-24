import { state } from './state.js?v=121';
import { showToast, escapeHtml, fmtDate, fmtTime } from './helpers.js?v=121';
import { db } from './db.js?v=121';

// ── Zukauf-Liste: fremde Artikel (Dünger/Kalk/Sonstiges) über die Waage ──────
// Erfasst wird an der Waage (Zukauf extern → Dünger). Hier: Übersicht + Export.

export function renderAdminZukauf() {
  const list = (state.fremdzukauf || []).slice().sort((a,b) => new Date(b.erstellt_am) - new Date(a.erstellt_am));
  const totalKg = list.reduce((s,x) => s + (Number(x.menge_kg)||0), 0);

  const byArt = {};
  list.forEach(x => { const a = x.artikel || '–'; byArt[a] = (byArt[a]||0) + (Number(x.menge_kg)||0); });
  const artTiles = Object.entries(byArt).sort((a,b) => b[1]-a[1]).map(([a,kg]) =>
    `<div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:8px 12px;min-width:110px">
      <div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">${escapeHtml(a)}</div>
      <div style="font-size:17px;font-weight:800;color:var(--gold)">${(kg/1000).toFixed(1)} t</div>
    </div>`).join('');

  const rows = list.map(x => {
    const t = (Number(x.menge_kg)||0)/1000;
    return `<tr style="border-bottom:1px solid var(--color-border)">
      <td style="padding:7px 8px;white-space:nowrap;color:var(--text2)">${fmtDate(x.erstellt_am)} ${fmtTime(x.erstellt_am)}</td>
      <td style="padding:7px 8px;font-weight:700;color:var(--text)">${escapeHtml(x.artikel||'–')}</td>
      <td style="padding:7px 8px;color:var(--text)">${escapeHtml(x.lieferant||'–')}</td>
      <td style="padding:7px 8px;color:var(--text2)">${escapeHtml(x.kennzeichen||'')}</td>
      <td style="padding:7px 8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${t.toFixed(2)} t</td>
      <td style="padding:7px 8px;text-align:right"><button onclick="deleteFremdzukauf(${x.id})" title="Löschen"
        style="background:none;border:1px solid var(--color-border);color:var(--color-text-muted);cursor:pointer;font-size:13px;width:28px;height:28px;border-radius:var(--radius-xs)">🗑</button></td>
    </tr>`;
  }).join('');

  document.getElementById('admintab').innerHTML = `
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div class="card-title">Zukauf · Dünger / Kalk / Sonstiges</div>
        ${list.length ? `<button class="btn btn-sm btn-outline" onclick="exportFremdzukaufExcel()">⬇ Excel</button>` : ''}
      </div>
      <div style="font-size:12px;color:var(--text3);margin:-4px 0 12px">Fremde Artikel, die über die Waage angenommen wurden (ohne Kontrakt/Schlag). Erfassung: Waage → „Zukauf extern" → „Dünger".</div>
      ${list.length ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <div style="background:var(--color-surface);border:2px solid var(--color-primary);border-radius:var(--radius-sm);padding:8px 12px;min-width:120px">
          <div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Gesamt</div>
          <div style="font-size:17px;font-weight:800;color:var(--color-text)">${(totalKg/1000).toFixed(1)} t · ${list.length}×</div>
        </div>${artTiles}
      </div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:560px">
        <thead><tr style="border-bottom:2px solid var(--color-border)">
          <th style="padding:8px;text-align:left;font-size:11px;color:var(--text2);font-weight:600">Datum</th>
          <th style="padding:8px;text-align:left;font-size:11px;color:var(--text2);font-weight:600">Artikel</th>
          <th style="padding:8px;text-align:left;font-size:11px;color:var(--text2);font-weight:600">Lieferant</th>
          <th style="padding:8px;text-align:left;font-size:11px;color:var(--text2);font-weight:600">Kennz.</th>
          <th style="padding:8px;text-align:right;font-size:11px;color:var(--text2);font-weight:600">Netto</th>
          <th style="width:36px"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`
      : `<div class="empty-state">Noch kein Zukauf erfasst.</div>`}
    </div>`;
}

export async function deleteFremdzukauf(id) {
  const x = (state.fremdzukauf || []).find(z => z.id === id);
  if(!x) return;
  if(!confirm(`Zukauf „${x.artikel}" (${((Number(x.menge_kg)||0)/1000).toFixed(2)} t) löschen?`)) return;
  try {
    await db.deleteFremdzukauf(id);
    state.fremdzukauf = state.fremdzukauf.filter(z => z.id !== id);
    showToast('🗑 Zukauf gelöscht');
    renderAdminZukauf();
  } catch(e) { showToast('⚠ ' + e.message, 'error'); }
}
