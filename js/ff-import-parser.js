// Fruchtfolge: Parser für GAP-Agrarantrags-Exporte (Sachsen-Anhalt, profil inet / data experts)
// Ein Export-ZIP je Betrieb+Jahr enthält:
//   <BNR>.nn.xml                    — Flächenantrag (Primärquelle, GML HTML-escaped, EPSG:25832)
//   <BNR>_flaechenuebersicht.xlsx   — Ergänzung (Netto/Brutto, ÖR, Sorte, Nebennutzungen)
//   <BNR>_parzellen/_teilflaechen.* — Shapefile-Fallback (DBF-Encoding cp1252!)
// Läuft komplett im Browser (JSZip global via CDN); Koordinaten bleiben in 25832,
// die Transformation nach 4326 übernimmt ein DB-Trigger (PostGIS ST_Transform).

const FA_NS = 'http://www.data-experts.de/Flaechen';

// ───────────────────────────── GML ─────────────────────────────

// GML-Surface-String (bereits unescaped) → Array von Polygonen [[ring, ring…]…],
// jeder Ring ist ein Array aus [x, y]-Paaren (EPSG:25832).
export function parseGmlSurface(gml) {
  const doc = new DOMParser().parseFromString(gml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('GML nicht parsebar');
  const patches = [...doc.getElementsByTagNameNS('*', 'PolygonPatch')];
  const polys = [];
  for (const patch of patches) {
    const rings = [];
    const readRing = (el) => {
      const pos = el.getElementsByTagNameNS('*', 'posList')[0];
      if (!pos) return null;
      const nums = pos.textContent.trim().split(/\s+/).map(Number);
      const ring = [];
      for (let i = 0; i + 1 < nums.length; i += 2) ring.push([nums[i], nums[i + 1]]);
      // Ring schließen, falls Start ≠ Ende
      if (ring.length >= 3) {
        const [x0, y0] = ring[0], [xn, yn] = ring[ring.length - 1];
        if (x0 !== xn || y0 !== yn) ring.push([x0, y0]);
      }
      return ring.length >= 4 ? ring : null;
    };
    for (const ext of patch.getElementsByTagNameNS('*', 'exterior')) {
      const r = readRing(ext);
      if (r) rings.push(r);
    }
    for (const int of patch.getElementsByTagNameNS('*', 'interior')) {
      const r = readRing(int);
      if (r) rings.push(r);
    }
    if (rings.length) polys.push(rings);
  }
  if (!polys.length) throw new Error('GML ohne Polygone');
  return polys;
}

// Polygone → EWKT MULTIPOLYGON (SRID 25832) für den PostgREST-Insert
export function polysToEwkt(polys) {
  const ring = (r) => '(' + r.map(([x, y]) => `${x} ${y}`).join(',') + ')';
  const poly = (p) => '(' + p.map(ring).join(',') + ')';
  return 'SRID=25832;MULTIPOLYGON(' + polys.map(poly).join(',') + ')';
}

// ───────────────────────────── Flächenantrag-XML ─────────────────────────────

// <BNR>.nn.xml → { bnr, jahr, parzellen[] }. Geometrie je Hauptnutzungsfläche
// (ohne Landschaftselemente); fa:geometrie ist HTML-escaptes GML → textContent
// liefert bereits den unescapten String.
export function parseFaXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Flächenantrag-XML nicht parsebar');
  const el1 = (parent, name) => parent.getElementsByTagNameNS(FA_NS, name)[0];
  const txt = (parent, name) => el1(parent, name)?.textContent?.trim() ?? '';

  const jahr = parseInt(txt(doc, 'antragsjahr'), 10);
  const bnr = txt(doc, 'bnrzd');
  if (!jahr || !bnr) throw new Error('Antragsjahr oder Betriebsnummer fehlt im XML');

  const parzellen = [];
  const fehler = [];
  for (const gp of doc.getElementsByTagNameNS(FA_NS, 'gesamtparzelle')) {
    const gpNummer = txt(gp, 'gp_nummer');
    const gpName = txt(gp, 'parzellenname');
    const hnfs = [...gp.getElementsByTagNameNS(FA_NS, 'hauptnutzungsflaeche')];
    for (const hnf of hnfs) {
      const tfNummer = txt(hnf, 'teilflaechennummer');
      // Bei mehreren Hauptnutzungsflächen je Gesamtparzelle unterscheidet die
      // Teilflächennummer (z.B. 471.02), sonst gilt die Parzellennummer.
      const nummer = hnfs.length > 1 && tfNummer ? tfNummer : (gpNummer || tfNummer);
      const p = {
        nummer,
        gpNummer,
        name: gpName,
        flik: txt(hnf, 'flik') || null,
        nutzungscode: parseInt(txt(hnf, 'nutzung'), 10) || null,
        groesseHa: txt(hnf, 'groesse') ? Number(txt(hnf, 'groesse')) / 10000 : null, // m² → ha
        vorjahrNummer: txt(hnf, 'tf_parzellennummer_vorjahr') || null,
        oerCode: [...hnf.getElementsByTagNameNS(FA_NS, 'oekoRegelung')].map(o => o.textContent.trim()).filter(Boolean).join(',') || null,
        ewkt: null,
      };
      const geomEl = el1(hnf, 'geometrie') || el1(gp, 'geometrie');
      if (geomEl) {
        try { p.ewkt = polysToEwkt(parseGmlSurface(geomEl.textContent)); }
        catch (e) { fehler.push(`Parzelle ${nummer}: ${e.message}`); }
      } else {
        fehler.push(`Parzelle ${nummer}: keine Geometrie im XML`);
      }
      parzellen.push(p);
    }
  }
  return { bnr, jahr, parzellen, fehler };
}

// ───────────────────────────── XLSX (ohne SheetJS) ─────────────────────────────

const colToIdx = (ref) => {
  let n = 0;
  for (const ch of ref) {
    if (ch >= '0' && ch <= '9') break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
};

// Ein Worksheet-XML → Array von Zeilen (Array je Zelle, Werte als String)
function readSheetRows(sheetXml, shared) {
  const doc = new DOMParser().parseFromString(sheetXml, 'text/xml');
  const rows = [];
  for (const row of doc.getElementsByTagName('row')) {
    const cells = [];
    for (const c of row.getElementsByTagName('c')) {
      const idx = colToIdx(c.getAttribute('r') || '');
      const t = c.getAttribute('t');
      let v = '';
      if (t === 'inlineStr') {
        v = c.textContent ?? '';
      } else {
        const vEl = c.getElementsByTagName('v')[0];
        v = vEl ? vEl.textContent : '';
        if (t === 's') v = shared[parseInt(v, 10)] ?? '';
      }
      if (idx >= 0) cells[idx] = v;
    }
    rows.push(cells);
  }
  return rows;
}

// Zeilen → Objekte anhand der Kopfzeile (erste Zeile mit Inhalt)
function rowsToObjects(rows) {
  const hIdx = rows.findIndex(r => r && r.some(v => (v ?? '').toString().trim() !== ''));
  if (hIdx < 0) return [];
  const header = rows[hIdx].map(v => (v ?? '').toString().trim());
  const out = [];
  for (const r of rows.slice(hIdx + 1)) {
    if (!r || !r.some(v => (v ?? '').toString().trim() !== '')) continue;
    const o = {};
    header.forEach((h, i) => { if (h) o[h] = (r[i] ?? '').toString().trim(); });
    out.push(o);
  }
  return out;
}

// Flächenübersicht-XLSX (als JSZip-Objekt) → { gesamt: [], nebennutzungen: [] }
export async function parseXlsxFlaechen(xlsxZip) {
  const readText = async (path) => {
    const f = xlsxZip.file(path);
    return f ? f.async('string') : null;
  };
  const wbXml = await readText('xl/workbook.xml');
  if (!wbXml) throw new Error('workbook.xml fehlt in der Flächenübersicht');
  const relsXml = await readText('xl/_rels/workbook.xml.rels') || '';
  const ssXml = await readText('xl/sharedStrings.xml');

  const shared = [];
  if (ssXml) {
    const ssDoc = new DOMParser().parseFromString(ssXml, 'text/xml');
    for (const si of ssDoc.getElementsByTagName('si')) shared.push(si.textContent ?? '');
  }
  const relDoc = new DOMParser().parseFromString(relsXml, 'text/xml');
  const relMap = {};
  for (const rel of relDoc.getElementsByTagName('Relationship')) {
    relMap[rel.getAttribute('Id')] = rel.getAttribute('Target').replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/');
  }
  const wbDoc = new DOMParser().parseFromString(wbXml, 'text/xml');
  const sheets = {};
  let sheetNo = 0;
  for (const sh of wbDoc.getElementsByTagName('sheet')) {
    sheetNo++;
    const rid = sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sh.getAttribute('r:id');
    sheets[sh.getAttribute('name')] = relMap[rid] || `xl/worksheets/sheet${sheetNo}.xml`;
  }
  const readSheet = async (nameLike) => {
    const key = Object.keys(sheets).find(n => n.toLowerCase().startsWith(nameLike.toLowerCase()));
    if (!key) return [];
    const xml = await readText(sheets[key]);
    return xml ? rowsToObjects(readSheetRows(xml, shared)) : [];
  };
  return {
    gesamt: await readSheet('Gesamtparzellen'),
    // Tippfehler im Original: "Landschaftslemente"
    landschaftselemente: await readSheet('Landschafts'),
    nebennutzungen: await readSheet('Nebennutzungen'),
  };
}

// ───────────────────────────── DBF / SHP (Fallback) ─────────────────────────────

// DBF → Array von Objekten; Encoding cp1252 (windows-1252), nicht UTF-8!
export function parseDbf(buf) {
  const view = new DataView(buf);
  const dec = new TextDecoder('windows-1252');
  const numRecords = view.getUint32(4, true);
  const headerSize = view.getUint16(8, true);
  const recordSize = view.getUint16(10, true);
  const fields = [];
  for (let off = 32; off < headerSize - 1; off += 32) {
    if (view.getUint8(off) === 0x0d) break;
    const nameBytes = new Uint8Array(buf, off, 11);
    let name = dec.decode(nameBytes);
    const nul = name.indexOf(' ');
    if (nul >= 0) name = name.slice(0, nul);
    fields.push({ name: name.trim(), len: view.getUint8(off + 16) });
  }
  const rows = [];
  for (let i = 0; i < numRecords; i++) {
    let off = headerSize + i * recordSize;
    if (view.getUint8(off) === 0x2a) continue; // gelöschter Datensatz
    off += 1;
    const row = {};
    for (const f of fields) {
      row[f.name] = dec.decode(new Uint8Array(buf, off, f.len)).trim();
      off += f.len;
    }
    rows.push(row);
  }
  return rows;
}

// SHP (Typ 5 Polygon) → Array (Index = Datensatz) von Polygonlisten wie parseGmlSurface.
// Ring-Orientierung: im Shapefile sind äußere Ringe im Uhrzeigersinn, Löcher gegen ihn.
export function parseShp(buf) {
  const view = new DataView(buf);
  const fileLen = view.getInt32(24) * 2;
  const shapes = [];
  let off = 100;
  const ringArea = (ring) => {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) a += (ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]);
    return a / 2; // >0 = gegen Uhrzeigersinn (Loch), <0 = Uhrzeigersinn (Außenring)
  };
  while (off + 8 <= fileLen) {
    const contentLen = view.getInt32(off + 4) * 2;
    const shpType = view.getInt32(off + 8, true);
    if (shpType === 5) {
      const base = off + 8;
      const numParts = view.getInt32(base + 36, true);
      const numPoints = view.getInt32(base + 40, true);
      const partsOff = base + 44;
      const pointsOff = partsOff + numParts * 4;
      const parts = [];
      for (let p = 0; p < numParts; p++) parts.push(view.getInt32(partsOff + p * 4, true));
      parts.push(numPoints);
      const rings = [];
      for (let p = 0; p < numParts; p++) {
        const ring = [];
        for (let i = parts[p]; i < parts[p + 1]; i++) {
          ring.push([view.getFloat64(pointsOff + i * 16, true), view.getFloat64(pointsOff + i * 16 + 8, true)]);
        }
        if (ring.length >= 4) rings.push(ring);
      }
      // Außenringe (cw) sammeln, Löcher (ccw) dem jeweils letzten Außenring zuordnen
      const polys = [];
      for (const r of rings) {
        if (ringArea(r) <= 0 || !polys.length) polys.push([r]);
        else polys[polys.length - 1].push(r);
      }
      shapes.push(polys.length ? polys : null);
    } else {
      shapes.push(null);
    }
    off += 8 + contentLen;
  }
  return shapes;
}

// ───────────────────────────── Haupt-Einstieg ─────────────────────────────

const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const ncNum = (v) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

// Export-ZIP (File/Blob/ArrayBuffer) → normalisiertes Importpaket.
// Wirft bei leerem/unbrauchbarem ZIP eine verständliche Fehlermeldung.
export async function parseAgrarantragZip(fileOrBuffer) {
  if (typeof JSZip === 'undefined') throw new Error('JSZip nicht geladen');
  let zip;
  try { zip = await JSZip.loadAsync(fileOrBuffer); }
  catch (e) { throw new Error('Datei ist kein lesbares ZIP-Archiv'); }

  const find = (re) => Object.keys(zip.files).find(n => re.test(n) && !zip.files[n].dir);
  const xmlName = find(/\.nn\.xml$/i);
  const xlsxName = find(/_flaechenuebersicht\.xlsx$/i);
  const fehler = [];
  let result = null;

  if (xmlName) {
    try {
      const xmlText = await zip.file(xmlName).async('string');
      result = parseFaXml(xmlText);
      result.quelle = 'xml';
      fehler.push(...result.fehler);
    } catch (e) {
      fehler.push(`XML-Import fehlgeschlagen (${e.message}) – versuche Shapefile-Fallback`);
    }
  }

  // Fallback: Shapefiles (wenn XML fehlt oder unbrauchbar, oder Geometrien fehlen)
  if (!result || result.parzellen.every(p => !p.ewkt)) {
    const shpName = find(/_teilflaechen\.shp$/i);
    const dbfName = find(/_teilflaechen\.dbf$/i);
    const pDbfName = find(/_parzellen\.dbf$/i);
    if (!shpName || !dbfName) {
      if (!xmlName) throw new Error('ZIP enthält weder Flächenantrag-XML (<BNR>.nn.xml) noch Teilflächen-Shapefile');
      if (result) { result.fehler = fehler; return finalize(result, null, fehler); }
      throw new Error('Flächenantrag-XML unbrauchbar und kein Shapefile-Fallback vorhanden');
    }
    const [shpBuf, dbfBuf] = await Promise.all([
      zip.file(shpName).async('arraybuffer'),
      zip.file(dbfName).async('arraybuffer'),
    ]);
    const shapes = parseShp(shpBuf);
    const rows = parseDbf(dbfBuf);
    const namen = {};
    if (pDbfName) {
      for (const r of parseDbf(await zip.file(pDbfName).async('arraybuffer'))) {
        namen[String(ncNum(r.NUMMER) ?? r.NUMMER)] = r.NAME || '';
      }
    }
    const bnrFromFile = (shpName.match(/(\d{12})_/) || [])[1] || result?.bnr || '';
    const parzellen = [];
    rows.forEach((r, i) => {
      if ((r.ART || '').toUpperCase() !== 'HNF') return;
      const tf = String(r.NUMMER || '');
      const gpNummer = tf.includes('.') ? tf.split('.')[0] : tf;
      let ewkt = null;
      try { if (shapes[i]) ewkt = polysToEwkt(shapes[i]); }
      catch (e) { fehler.push(`Teilfläche ${tf}: ${e.message}`); }
      parzellen.push({
        nummer: gpNummer, gpNummer, name: namen[gpNummer] || '',
        flik: r.FLIK_FLEK || null,
        nutzungscode: ncNum(r.CODE),
        groesseHa: num(r.FLAECHE),
        vorjahrNummer: null,
        oerCode: r.OER || null,
        sorte: r.SORTE || null,
        ewkt,
      });
    });
    // Mehrere HNF je Parzelle → Teilflächennummer als Unterscheidung
    const counts = {};
    for (const p of parzellen) counts[p.gpNummer] = (counts[p.gpNummer] || 0) + 1;
    rows.filter(r => (r.ART || '').toUpperCase() === 'HNF').forEach((r, j) => {
      if (counts[parzellen[j].gpNummer] > 1) parzellen[j].nummer = String(r.NUMMER);
    });
    result = { bnr: result?.bnr || bnrFromFile, jahr: result?.jahr || null, parzellen, quelle: 'shapefile' };
  }

  // Excel-Ergänzung (Netto/Brutto, ÖR, Sorte, Bezeichnung, Nebennutzungen)
  let xlsx = null;
  if (xlsxName) {
    try {
      const xlsxZip = await JSZip.loadAsync(await zip.file(xlsxName).async('arraybuffer'));
      xlsx = await parseXlsxFlaechen(xlsxZip);
    } catch (e) {
      fehler.push(`Flächenübersicht-XLSX nicht lesbar: ${e.message}`);
    }
  }
  return finalize(result, xlsx, fehler);
}

function finalize(result, xlsx, fehler) {
  const key = (o, like) => {
    const k = Object.keys(o).find(k2 => k2.toLowerCase().replace(/\s/g, '').includes(like));
    return k ? o[k] : undefined;
  };
  const byNummer = {};
  if (xlsx) {
    for (const row of xlsx.gesamt) {
      const nr = String(ncNum(key(row, 'parzellennummer')) ?? key(row, 'parzellennummer') ?? '');
      if (nr) byNummer[nr] = row;
    }
  }
  for (const p of result.parzellen) {
    const row = byNummer[String(p.gpNummer)] || byNummer[String(p.nummer)];
    if (row) {
      p.nettoHa = num(key(row, 'nettofläche'));
      p.bruttoHa = num(key(row, 'bruttofläche'));
      p.oerCode = key(row, 'örcode') || key(row, 'ör-code') || p.oerCode || null;
      p.sorte = key(row, 'sorte') || p.sorte || null;
      p.nutzBezeichnung = key(row, 'nutzungsbezeichnung') || null;
      if (!p.name) p.name = key(row, 'parzellenname') || '';
    }
    if (p.nettoHa == null) p.nettoHa = p.groesseHa;
    if (p.bruttoHa == null) p.bruttoHa = p.groesseHa;
  }
  const nebennutzungen = [];
  if (xlsx) {
    for (const row of xlsx.nebennutzungen) {
      const nc = ncNum(key(row, 'nutzungscode'));
      if (nc == null) continue;
      nebennutzungen.push({
        parzellenNummer: String(ncNum(key(row, 'parzellennummer')) ?? key(row, 'parzellennummer') ?? ''),
        teilflaechenNummer: String(key(row, 'teilflächennummer') ?? ''),
        flaecheHa: num(key(row, 'fläche')),
        nutzungscode: nc,
        sorte: key(row, 'sorte') || null,
      });
    }
  }
  return {
    bnr: result.bnr, jahr: result.jahr, quelle: result.quelle,
    parzellen: result.parzellen, nebennutzungen,
    fehler: [...new Set([...(result.fehler || []), ...fehler])],
  };
}
