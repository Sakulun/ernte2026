#!/usr/bin/env node
// Prüfvermerk der Ernte-App auf eine Händler-Gutschrift / Quali- / Frachtabrechnung setzen.
// Setzt oben rechts auf Seite 1 einen PDF-Kommentar (FreeText-Annotation mit eigener
// Darstellung, druckbar). Der Seiteninhalt des Belegs selbst bleibt unverändert.
//
// Aufruf:  node _pruefvermerk.js <eingang.pdf> <ausgang.pdf> <vermerk.json>
// vermerk.json:
//   { "status": "ok" | "abweichung" | "unzugeordnet",
//     "datum": "26.11.2026",                       // optional, sonst heute
//     "zusammenfassung": "2 von 2 Fuhren zugeordnet",
//     "abweichungen": ["LS 26211 SK-RV 334: Gewicht +70 kg", ...] }
//
// Benötigt _pdf-lib.min.js (pdf-lib 1.17.1, UMD) im selben Ordner.
// Referenzkopie: ernteneu/tools/pruefvermerk/ – Kopie liegt im Ordner "Eingangsrechnungen aus DATEV".
'use strict';
const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName, PDFString, PDFHexString, StandardFonts } = require(path.join(__dirname, '_pdf-lib.min.js'));

const [, , inPfad, outPfad, jsonPfad] = process.argv;
if(!inPfad || !outPfad || !jsonPfad) {
  console.error('Aufruf: node _pruefvermerk.js <eingang.pdf> <ausgang.pdf> <vermerk.json>');
  process.exit(2);
}

// Helvetica (WinAnsi) kann keine Sonderzeichen wie ✓/⚠ – auf Sicheres abbilden.
const winAnsi = s => String(s ?? '')
  .replace(/[✓✔]/g, 'OK').replace(/[⚠❗]/g, '!').replace(/[–—]/g, '-').replace(/[„“”]/g, '"').replace(/[‚‘’]/g, "'")
  .replace(/±/g, '+/-').replace(/\s*€/g, ' EUR').replace(/…/g, '...').replace(/\s+/g, ' ')
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?').trim();

async function main() {
  const v = JSON.parse(fs.readFileSync(jsonPfad, 'utf8'));
  const ok = v.status === 'ok';
  const heute = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' });
  const abw = (v.abweichungen || []).map(winAnsi).filter(Boolean);

  const pdf = await PDFDocument.load(fs.readFileSync(inPfad), { updateMetadata: false });
  const page = pdf.getPage(0);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Text umbrechen
  const breite = 210, rand = 6, gr = 7.5, grT = 8.5, zeilenH = 9.6;
  const umbrechen = (text, f, size) => {
    const out = []; let z = '';
    for(const wort of text.split(' ')) {
      const t = z ? z + ' ' + wort : wort;
      if(f.widthOfTextAtSize(t, size) <= breite - 2 * rand) z = t;
      else { if(z) out.push(z); z = wort; }
    }
    if(z) out.push(z);
    return out;
  };
  const titel = winAnsi(`Geprüft Ernte-App ${v.datum || heute}`);
  const kopf = ok ? 'OK - keine Abweichung' : (v.status === 'unzugeordnet' ? 'BITTE PRÜFEN - nicht alles zugeordnet' : `BITTE PRÜFEN - ${abw.length} Abweichung${abw.length === 1 ? '' : 'en'}`);
  const zeilen = [];
  if(v.zusammenfassung) zeilen.push(...umbrechen(winAnsi(v.zusammenfassung), font, gr).map(t => ({ t, f: font })));
  const MAX = 9;
  for(const a of abw) {
    for(const [i, t] of umbrechen('- ' + a, font, gr).entries()) zeilen.push({ t: i ? '  ' + t : t, f: font });
  }
  if(zeilen.length > MAX) { zeilen.length = MAX - 1; zeilen.push({ t: '... weitere Details in der Ernte-App', f: font }); }

  const hoehe = rand * 2 + grT + 2 + zeilenH * (1 + zeilen.length);
  // Oben rechts innerhalb der sichtbaren Seite (CropBox), 14 pt Abstand vom Rand.
  const box = page.getCropBox();
  const x1 = box.x + box.width - 14, y1 = box.y + box.height - 14;
  const x0 = x1 - breite, y0 = y1 - hoehe;

  // Farben: grün = geprüft ok, gelb/orange = bitte prüfen
  const fill = ok ? [0.88, 0.95, 0.86] : [1.0, 0.93, 0.70];
  const rahmen = ok ? [0.20, 0.50, 0.20] : [0.80, 0.45, 0.00];
  const textF = ok ? [0.10, 0.30, 0.10] : [0.55, 0.25, 0.00];

  // Darstellung (Appearance Stream) im Koordinatensystem der Box
  const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const ops = [];
  ops.push(`${fill.join(' ')} rg ${rahmen.join(' ')} RG 1 w 0.5 0.5 ${breite - 1} ${hoehe - 1} re B`);
  let y = hoehe - rand - grT;
  ops.push(`BT /FB ${grT} Tf ${textF.join(' ')} rg ${rand} ${y} Td (${esc(titel)}) Tj ET`);
  y -= zeilenH + 2;
  ops.push(`BT /FB ${gr} Tf ${textF.join(' ')} rg ${rand} ${y} Td (${esc(winAnsi(kopf))}) Tj ET`);
  for(const z of zeilen) {
    y -= zeilenH;
    ops.push(`BT /${z.f === fontB ? 'FB' : 'F'} ${gr} Tf 0.15 0.15 0.15 rg ${rand} ${y} Td (${esc(z.t)}) Tj ET`);
  }
  const inhalt = ops.join('\n');
  const ap = pdf.context.flateStream(inhalt, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, breite, hoehe],
    Resources: { Font: { F: font.ref, FB: fontB.ref } },
  });
  const apRef = pdf.context.register(ap);

  const volltext = [titel, winAnsi(kopf), ...(v.zusammenfassung ? [winAnsi(v.zusammenfassung)] : []), ...abw.map(a => '- ' + a)].join('\n');
  const annot = pdf.context.obj({
    Type: 'Annot', Subtype: 'FreeText',
    Rect: [x0, y0, x1, y1],
    Contents: PDFHexString.fromText(volltext),
    T: PDFHexString.fromText('Ernte-App Prüfung'),
    NM: PDFString.of('ernte-app-pruefvermerk'),
    M: PDFString.fromDate(new Date()),
    F: 4, // druckbar
    C: fill,
    DA: PDFString.of(`/Helv ${gr} Tf 0 g`),
    AP: { N: apRef },
  });
  const annotRef = pdf.context.register(annot);
  // Ein evtl. vorhandener alter Vermerk (gleicher NM) wird ersetzt
  const annots = page.node.lookup(PDFName.of('Annots'));
  if(annots) {
    for(let i = annots.size() - 1; i >= 0; i--) {
      const a = annots.lookup(i);
      const nm = a?.get?.(PDFName.of('NM'));
      if(nm && nm.decodeText?.() === 'ernte-app-pruefvermerk') annots.remove(i);
    }
    annots.push(annotRef);
  } else {
    page.node.set(PDFName.of('Annots'), pdf.context.obj([annotRef]));
  }

  fs.writeFileSync(outPfad, await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }));
  console.log(JSON.stringify({ ok: true, status: v.status, zeilen: zeilen.length + 2 }));
}

main().catch(e => { console.error('FEHLER Prüfvermerk:', e.message); process.exit(1); });
