// E-Rechnung: Berechnung, ZUGFeRD-XML (CII, Profil EN 16931) und PDF/A-3 mit
// eingebetteter factur-x.xml. Keine UI – die liegt in rechnungen.js.
//
// Beleg-Positionen (belege.positionen, jsonb):
//   { typ:'lieferung'|'regel'|'frei', quelle:'wb'|'fuhre'|'lief'|null, quelle_id,
//     regel_id, bezeichnung, beschreibung, datum, menge, einheit:'TNE'|'KGM'|'C62',
//     preis (>= 0), ust_satz, betrag }
// Abzüge haben eine NEGATIVE Menge bei positivem Preis (EN 16931: BR-27 verbietet
// negative Preise).

// Auf Belegen gilt die Firmen-Schreibweise aus DATEV (FIRMA_NAME_RECHNUNG).
import { FIRMA_NAME_RECHNUNG as FIRMA_NAME, FIRMA_GF_NAME, FIRMA_REGISTER, FIRMA_STRASSE, FIRMA_PLZ,
         FIRMA_ORT, FIRMA_LAND, FIRMA_TEL, FIRMA_EMAIL, FIRMA_ANSPRECHPARTNER, FIRMA_USTID_ROH,
         FIRMA_STNR_ROH, FIRMA_IBAN_ROH, FIRMA_BIC_ROH, FIRMA_BANK_NAME, FIRMA_OEKO_KONTROLLSTELLE,
         RECHNUNG_LOGO } from './config.js?v=165';

// ─── Steuerfälle ───────────────────────────────────────────────────────────
// belege.ust_modus: Rechnungen 'regel' | 'ig' (innergemeinschaftl. Lieferung) | 'ausfuhr' (Drittland);
// Gutschriften 'regel' | 'pauschal24' (§ 24 UStG).
export const EU_LAENDER = ['AT','BE','BG','CY','CZ','DK','EE','ES','FI','FR','GR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK'];
export const STEUERFAELLE = {
  regel:   'Inland (Umsatzsteuer lt. Artikel)',
  ig:      'Innergemeinschaftliche Lieferung (steuerfrei, EU)',
  ausfuhr: 'Ausfuhrlieferung (steuerfrei, Drittland)',
};
export function steuerfallVorschlag(kontakt) {
  const land = (kontakt?.land || 'DE').toUpperCase();
  if(land === 'DE') return 'regel';
  return EU_LAENDER.includes(land) ? 'ig' : 'ausfuhr';
}
// Ländernamen für die Anschrift (Auslandsadressen enden mit dem Land in Klarschrift).
const LAENDER = { AT: 'Österreich', BE: 'Belgien', BG: 'Bulgarien', CH: 'Schweiz', CZ: 'Tschechien', DK: 'Dänemark',
  EE: 'Estland', ES: 'Spanien', FI: 'Finnland', FR: 'Frankreich', GB: 'Vereinigtes Königreich', GR: 'Griechenland',
  HR: 'Kroatien', HU: 'Ungarn', IE: 'Irland', IT: 'Italien', LT: 'Litauen', LU: 'Luxemburg', LV: 'Lettland',
  NL: 'Niederlande', NO: 'Norwegen', PL: 'Polen', PT: 'Portugal', RO: 'Rumänien', SE: 'Schweden', SI: 'Slowenien',
  SK: 'Slowakei', UA: 'Ukraine' };
export const landName = code => LAENDER[code] || code;
export const istSteuerfrei = modus => modus === 'ig' || modus === 'ausfuhr';
const BEFREIUNG = {
  ig:      { kat: 'K', code: 'VATEX-EU-IC', text: p => `Umsatzsteuerfrei aufgrund innergemeinschaftlicher Lieferung (§ 4 Nr. 1b i. V. m. § 6a UStG). Ihre USt-IdNr.: ${p.ust_id || ''}` },
  ausfuhr: { kat: 'G', code: 'VATEX-EU-G',  text: () => 'Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1a i. V. m. § 6 UStG).' },
};

// ─── Zahlen & Formate ──────────────────────────────────────────────────────
export const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const r3 = n => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
export const r4 = n => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
export const eur = n => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
export const num = (n, min = 0, max = 3) => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max });
export const datumDE = d => d ? new Date(String(d).length <= 10 ? d + 'T12:00:00' : d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
export const isoDatum = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
const d102 = iso => String(iso).slice(0, 10).replace(/-/g, '');

export const EINHEITEN = { TNE: 't', KGM: 'kg', C62: 'Stk.', LS: 'pausch.' };
export const UST_SAETZE = [7, 19, 7.8, 0];

export const QUALI_FELDER = {
  feuchte:    { label: 'Feuchte',     einheit: '%' },
  protein:    { label: 'Protein',     einheit: '%' },
  hl_gewicht: { label: 'hl-Gewicht',  einheit: 'kg/hl' },
  fallzahl:   { label: 'Fallzahl',    einheit: 's' },
  oelgehalt:  { label: 'Ölgehalt',    einheit: '%' },
  gluten:     { label: 'Feuchtkleber',einheit: '%' },
  besatz:     { label: 'Besatz',      einheit: '%' },
};

export const REGEL_ARTEN = {
  gewicht_qualitaet: 'Gewichtsabzug je Qualitätsabweichung (% Gewicht je Einheit)',
  preis_qualitaet:   'Preisabzug/-zuschlag je Qualitätsabweichung (€/t je Einheit)',
  eur_t:             'Fester Betrag je Tonne (€/t), z. B. Fracht, Trocknung',
  pauschal:          'Pauschalbetrag je Beleg (€)',
};

// ─── Regeln anwenden ───────────────────────────────────────────────────────
// lieferungen: [{ quelle, quelle_id, ls, datum, menge_t, preis, ust_satz, quali:{} }]
export function regelnAnwenden(regeln, lieferungen, ctx) {
  const out = [];
  const passend = regeln.filter(r => r.aktiv
    && (r.gilt_fuer === 'beide' || r.gilt_fuer === ctx.art)
    && (!r.artikel_id || r.artikel_id === ctx.artikelId)
    && (!r.kontakt_id || r.kontakt_id === ctx.kontaktId)
    && !ctx.deaktiviert.has(r.id));
  for(const r of passend) {
    const sign = r.vorzeichen === 'zuschlag' ? 1 : -1;
    const wort = r.vorzeichen === 'zuschlag' ? 'Zuschlag' : 'Abzug';
    if(r.art === 'pauschal') {
      if(!lieferungen.length || !(Number(r.wert) > 0)) continue;
      out.push(pos({ typ: 'regel', regel_id: r.id, bezeichnung: r.name, beschreibung: `${wort} pauschal`,
        menge: sign, einheit: 'C62', preis: r4(r.wert), ust_satz: lieferungen[0].ust_satz }));
      continue;
    }
    for(const l of lieferungen) {
      if(r.art === 'eur_t') {
        if(!(Number(r.wert) > 0)) continue;
        out.push(pos({ typ: 'regel', regel_id: r.id, bezeichnung: r.name,
          beschreibung: `${wort} ${num(r.wert, 2, 2)} €/t auf ${num(l.menge_t, 3, 3)} t · LS ${l.ls}`,
          menge: r3(sign * l.menge_t), einheit: 'TNE', preis: r4(r.wert), ust_satz: l.ust_satz }));
        continue;
      }
      const qf = QUALI_FELDER[r.feld];
      const v = l.quali?.[r.feld];
      if(!qf || v == null || v === '' || isNaN(Number(v)) || r.schwelle == null) continue;
      const abw = r.vergleich === 'unter' ? Number(r.schwelle) - Number(v) : Number(v) - Number(r.schwelle);
      if(!(abw > 0)) continue;
      const qText = `${qf.label} ${num(v, 1, 2)} ${qf.einheit} (Basis ${num(r.schwelle, 1, 2)} ${qf.einheit})`;
      if(r.art === 'gewicht_qualitaet') {
        const prozent = abw * Number(r.wert);
        const t = r3(l.menge_t * prozent / 100);
        if(!t) continue;
        out.push(pos({ typ: 'regel', regel_id: r.id, bezeichnung: r.name,
          beschreibung: `LS ${l.ls}: ${qText} → ${num(prozent, 2, 2)} % von ${num(l.menge_t, 3, 3)} t`,
          menge: sign * t, einheit: 'TNE', preis: r4(l.preis), ust_satz: l.ust_satz }));
      } else if(r.art === 'preis_qualitaet') {
        const p = r4(abw * Number(r.wert));
        if(!p) continue;
        out.push(pos({ typ: 'regel', regel_id: r.id, bezeichnung: r.name,
          beschreibung: `LS ${l.ls}: ${qText} → ${num(p, 2, 4)} €/t`,
          menge: r3(sign * l.menge_t), einheit: 'TNE', preis: p, ust_satz: l.ust_satz }));
      }
    }
  }
  return out;
}

// Position normalisieren (Betrag berechnen, Preis nie negativ).
export function pos(p) {
  let menge = Number(p.menge) || 0, preis = Number(p.preis) || 0;
  if(preis < 0) { preis = -preis; menge = -menge; }
  return { typ: p.typ || 'frei', quelle: p.quelle || null, quelle_id: p.quelle_id ?? null,
    regel_id: p.regel_id ?? null, bezeichnung: String(p.bezeichnung || '').trim() || 'Position',
    beschreibung: p.beschreibung || '', datum: p.datum || null, menge: r4(menge),
    einheit: p.einheit || 'TNE', preis: r4(preis), ust_satz: Number(p.ust_satz ?? 7),
    betrag: r2(r4(menge) * r4(preis)), quali: p.quali || undefined, ls: p.ls || undefined };
}
// Lieferscheinnummern eines Belegs (für Kopfzeile "Kontrakt: … || Lieferschein: …")
export function belegLieferscheine(b) {
  return [...new Set((b.positionen || []).filter(p => p.typ === 'lieferung' && p.ls).map(p => p.ls))].join(', ');
}

export function summen(positionen) {
  const map = new Map();
  for(const p of positionen) {
    const s = Number(p.ust_satz);
    map.set(s, r2((map.get(s) || 0) + Number(p.betrag)));
  }
  const steuern = [...map.entries()].sort((a, b) => b[0] - a[0])
    .map(([satz, basis]) => ({ satz, basis, betrag: r2(basis * satz / 100) }));
  const netto = r2(steuern.reduce((s, x) => s + x.basis, 0));
  const ust = r2(steuern.reduce((s, x) => s + x.betrag, 0));
  return { steuern, netto, ust, brutto: r2(netto + ust) };
}

// ─── Partner / Rollen ──────────────────────────────────────────────────────
export function firmaPartei() {
  return { name: FIRMA_NAME, strasse: FIRMA_STRASSE, plz: FIRMA_PLZ, ort: FIRMA_ORT, land: FIRMA_LAND,
    ust_id: FIRMA_USTID_ROH, steuernummer: FIRMA_STNR_ROH, email: FIRMA_EMAIL, telefon: FIRMA_TEL };
}
// Kunden-/Lieferantennummer auf dem Beleg: DATEV-Debitor/-Kreditor, sonst interne Kontakt-ID.
export const partnerNr = p => String(p?.kundennummer || p?.kontakt_id || '');
export function partnerSnapshot(k) {
  if(!k) return null;
  return { kontakt_id: k.id, kundennummer: (k.kundennummer || '').trim(), name: k.name, strasse: (k.strasse || k.adresse || '').trim(), plz: (k.plz || '').trim(),
    ort: (k.ort || '').trim(), land: (k.land || 'DE').toUpperCase(), ust_id: k.ust_id || '', steuernummer: k.steuernummer || '',
    email: k.rechnung_email || k.email || '', iban: (k.iban || '').replace(/\s+/g, '').toUpperCase(), telefon: k.telefon || '',
    oeko_kontrollstelle: k.oeko_kontrollstelle || '' };
}

// Pflichtangaben prüfen. Gibt { fehler:[], hinweise:[] } zurück.
export function pruefeBeleg(b) {
  const fehler = [], hinweise = [];
  const p = b.empfaenger || {};
  if(!p.name) fehler.push('Partner hat keinen Namen.');
  if(!p.strasse || !p.plz || !p.ort) fehler.push('Anschrift des Partners unvollständig (Straße, PLZ, Ort) – bitte im Kontakt ergänzen.');
  if(!/^[A-Z]{2}$/.test(p.land || '')) fehler.push('Land des Partners fehlt (2-stelliger Code, z. B. DE).');
  if(b.art === 'gutschrift' && !p.ust_id && !p.steuernummer)
    fehler.push('Für Gutschriften ist die Steuernummer oder USt-IdNr. des Lieferanten Pflicht (§ 14 Abs. 4 Nr. 2 UStG).');
  if(b.art === 'gutschrift' && !p.iban) hinweise.push('Keine IBAN beim Lieferanten hinterlegt – Auszahlungskonto fehlt auf der Gutschrift.');
  if(!b.positionen?.length) fehler.push('Keine Positionen.');
  if(b.positionen?.some(x => !(Number(x.preis) >= 0))) fehler.push('Preise dürfen nicht negativ sein.');
  if(b.positionen?.some(x => x.typ === 'lieferung' && !(Number(x.preis) > 0))) hinweise.push('Mindestens eine Lieferung hat keinen Preis.');
  if(b.art === 'rechnung' && b.ust_modus === 'ig') {
    if(!p.ust_id) fehler.push('Innergemeinschaftliche Lieferung: USt-IdNr. des Kunden ist Pflicht (§ 14a Abs. 3 UStG) – bitte im Kontakt ergänzen.');
    if(!EU_LAENDER.includes(p.land)) fehler.push('Innergemeinschaftliche Lieferung nur an Kunden in einem anderen EU-Land.');
    hinweise.push('Gelangensbestätigung bzw. CMR für den Nachweis der Beförderung ins EU-Ausland aufbewahren; Lieferung in der Zusammenfassenden Meldung angeben.');
  }
  if(b.art === 'rechnung' && b.ust_modus === 'ausfuhr') hinweise.push('Ausfuhrlieferung: Ausfuhrnachweis (z. B. Ausgangsvermerk ATLAS) aufbewahren.');
  if(b.art === 'rechnung' && b.ust_modus === 'regel' && p.land && p.land !== 'DE') hinweise.push('Kunde sitzt im Ausland, Steuerfall ist „Inland“ – bitte prüfen.');
  if(b.art === 'gutschrift' && p.land && p.land !== 'DE') hinweise.push('Auslandslieferant: innergemeinschaftlicher Erwerb/Reverse-Charge wird nicht automatisch behandelt – Steuersätze prüfen.');
  if(!p.email) hinweise.push('Keine E-Mail-Adresse beim Partner – Versand nur nach manueller Eingabe.');
  return { fehler, hinweise };
}

// ─── ZUGFeRD / Factur-X XML (CII D16B, EN 16931) ──────────────────────────
const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const a2 = n => r2(n).toFixed(2);
// Mengen/Preise: 2–4 Nachkommastellen ("12.50", "12.345", "0.1234")
const a4 = n => r4(n).toFixed(4).replace(/0{1,2}$/, '');

function parteiXml(tag, p, opts = {}) {
  const reg = [];
  if(p.ust_id) reg.push(`<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(p.ust_id)}</ram:ID></ram:SpecifiedTaxRegistration>`);
  if(p.steuernummer) reg.push(`<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${x(p.steuernummer)}</ram:ID></ram:SpecifiedTaxRegistration>`);
  const kontakt = opts.kontakt && (p.telefon || p.email)
    ? `<ram:DefinedTradeContact><ram:PersonName>${x(opts.kontakt)}</ram:PersonName>`
      + (p.telefon ? `<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${x(p.telefon)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>` : '')
      + (p.email ? `<ram:EmailURIUniversalCommunication><ram:URIID>${x(p.email)}</ram:URIID></ram:EmailURIUniversalCommunication>` : '')
      + `</ram:DefinedTradeContact>` : '';
  return `<ram:${tag}>`
    + (opts.id ? `<ram:ID>${x(opts.id)}</ram:ID>` : '')
    + `<ram:Name>${x(p.name)}</ram:Name>`
    + kontakt
    + `<ram:PostalTradeAddress>`
      + (p.plz ? `<ram:PostcodeCode>${x(p.plz)}</ram:PostcodeCode>` : '')
      + (p.strasse ? `<ram:LineOne>${x(p.strasse)}</ram:LineOne>` : '')
      + (p.ort ? `<ram:CityName>${x(p.ort)}</ram:CityName>` : '')
      + `<ram:CountryID>${x(p.land || 'DE')}</ram:CountryID></ram:PostalTradeAddress>`
    + (p.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(p.email)}</ram:URIID></ram:URIUniversalCommunication>` : '')
    + reg.join('')
    + `</ram:${tag}>`;
}

// Steuerkategorie (UNTDID 5305): S Standard, K innergemeinschaftlich, G Ausfuhr, E befreit
function steuerKat(b, satz) {
  if(b.art === 'rechnung' && BEFREIUNG[b.ust_modus]) return BEFREIUNG[b.ust_modus].kat;
  return Number(satz) === 0 ? 'E' : 'S';
}
// Hinweistext zur Steuerbefreiung (PDF + XML), sonst ''
export function befreiungsText(b) {
  return b.art === 'rechnung' && BEFREIUNG[b.ust_modus] ? BEFREIUNG[b.ust_modus].text(b.empfaenger || {}) : '';
}

// ctx: { kontrakt, original (Storno-Bezug), titel }
export function erzeugeXml(b, ctx = {}) {
  const gut = b.art === 'gutschrift';
  const firma = firmaPartei();
  const partner = b.empfaenger || {};
  const bef = !gut ? BEFREIUNG[b.ust_modus] : null;
  const seller = gut ? partner : firma;
  const buyer = gut ? firma : partner;
  const sums = summen(b.positionen);
  const typeCode = gut ? '389' : '380';
  const notes = [];
  if(ctx.original) notes.push(`${gut ? 'Storno-Gutschrift' : 'Stornorechnung'} zu ${ctx.original.nummer} vom ${datumDE(ctx.original.datum)}.`);
  if(gut) notes.push('Gutschrift (Abrechnung durch den Leistungsempfänger, § 14 Abs. 2 Satz 2 UStG).');
  if(b.ust_modus === 'pauschal24' && gut) notes.push('Umsatzsteuer nach Durchschnittssatz gemäß § 24 Abs. 1 UStG.');
  if(ctx.kontrakt?.bio) notes.push(`Öko-Kontrollstelle: ${FIRMA_OEKO_KONTROLLSTELLE}.`);
  if(b.bemerkung) notes.push(b.bemerkung);
  const lsListe = belegLieferscheine(b);
  if(ctx.kontrakt?.nummer || lsListe) notes.unshift([ctx.kontrakt?.nummer ? `Kontrakt: ${ctx.kontrakt.nummer}` : '', lsListe ? `Lieferschein: ${lsListe}` : ''].filter(Boolean).join(' || '));
  const regNote = `${FIRMA_NAME} · ${FIRMA_STRASSE} · ${FIRMA_PLZ} ${FIRMA_ORT} · Geschäftsführer: ${FIRMA_GF_NAME} · ${FIRMA_REGISTER}`;

  const lines = b.positionen.map((p, i) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID>${p.beschreibung ? `<ram:IncludedNote><ram:Content>${x(p.beschreibung)}</ram:Content></ram:IncludedNote>` : ''}</ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${x(p.bezeichnung)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${a4(p.preis)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${x(p.einheit || 'C62')}">${a4(p.menge)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${steuerKat(b, p.ust_satz)}</ram:CategoryCode><ram:RateApplicablePercent>${a2(p.ust_satz)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${a2(p.betrag)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`).join('');

  const taxes = sums.steuern.map(s => {
    const kat = steuerKat(b, s.satz);
    const grund = bef ? bef.text(partner) : kat === 'E' ? 'Steuerfreie Lieferung' : '';
    return `
      <ram:ApplicableTradeTax><ram:CalculatedAmount>${a2(s.betrag)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${grund ? `<ram:ExemptionReason>${x(grund)}</ram:ExemptionReason>` : ''}<ram:BasisAmount>${a2(s.basis)}</ram:BasisAmount><ram:CategoryCode>${kat}</ram:CategoryCode>${bef ? `<ram:ExemptionReasonCode>${bef.code}</ram:ExemptionReasonCode>` : ''}<ram:RateApplicablePercent>${a2(s.satz)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`;
  }).join('');
  // Lieferanschrift: bei steuerfreien Auslandslieferungen Pflicht (BR-IC-12)
  const shipTo = bef ? `<ram:ShipToTradeParty><ram:Name>${x(partner.name)}</ram:Name><ram:PostalTradeAddress>`
    + (partner.plz ? `<ram:PostcodeCode>${x(partner.plz)}</ram:PostcodeCode>` : '')
    + (partner.strasse ? `<ram:LineOne>${x(partner.strasse)}</ram:LineOne>` : '')
    + (partner.ort ? `<ram:CityName>${x(partner.ort)}</ram:CityName>` : '')
    + `<ram:CountryID>${x(partner.land)}</ram:CountryID></ram:PostalTradeAddress></ram:ShipToTradeParty>` : '';

  // Zahlungsweg: Rechnung → unser Konto; Gutschrift → Konto des Lieferanten.
  const iban = gut ? partner.iban : FIRMA_IBAN_ROH;
  const zahlung = iban
    ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${x(iban)}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>${!gut ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${x(FIRMA_BIC_ROH)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}</ram:SpecifiedTradeSettlementPaymentMeans>`
    : `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>1</ram:TypeCode></ram:SpecifiedTradeSettlementPaymentMeans>`;
  const zahlText = zahlungsText(b);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${x(b.nummer)}</ram:ID>
    <ram:TypeCode>${typeCode}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${d102(b.datum)}</udt:DateTimeString></ram:IssueDateTime>
    ${notes.map(n => `<ram:IncludedNote><ram:Content>${x(n)}</ram:Content><ram:SubjectCode>AAI</ram:SubjectCode></ram:IncludedNote>`).join('')}
    <ram:IncludedNote><ram:Content>${x(regNote)}</ram:Content><ram:SubjectCode>REG</ram:SubjectCode></ram:IncludedNote>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>${x(ctx.kontrakt?.nummer || b.nummer)}</ram:BuyerReference>
      ${parteiXml('SellerTradeParty', seller, gut ? { id: partnerNr(partner) } : { kontakt: FIRMA_ANSPRECHPARTNER })}
      ${parteiXml('BuyerTradeParty', buyer, gut ? { kontakt: FIRMA_ANSPRECHPARTNER } : { id: partnerNr(partner) })}
      ${ctx.kontrakt?.nummer ? `<ram:ContractReferencedDocument><ram:IssuerAssignedID>${x(ctx.kontrakt.nummer)}</ram:IssuerAssignedID></ram:ContractReferencedDocument>` : ''}
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      ${shipTo}${b.leistung_bis ? `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${d102(b.leistung_bis)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>` : ''}
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:PaymentReference>${x(b.nummer)}</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      ${zahlung}${taxes}
      ${b.leistung_von && b.leistung_bis ? `<ram:BillingSpecifiedPeriod><ram:StartDateTime><udt:DateTimeString format="102">${d102(b.leistung_von)}</udt:DateTimeString></ram:StartDateTime><ram:EndDateTime><udt:DateTimeString format="102">${d102(b.leistung_bis)}</udt:DateTimeString></ram:EndDateTime></ram:BillingSpecifiedPeriod>` : ''}
      <ram:SpecifiedTradePaymentTerms><ram:Description>${x(zahlText)}</ram:Description>${b.faellig_am ? `<ram:DueDateDateTime><udt:DateTimeString format="102">${d102(b.faellig_am)}</udt:DateTimeString></ram:DueDateDateTime>` : ''}</ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${a2(sums.netto)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${a2(sums.netto)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${a2(sums.ust)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${a2(sums.brutto)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${a2(sums.brutto)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
      ${ctx.original ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${x(ctx.original.nummer)}</ram:IssuerAssignedID><ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${d102(ctx.original.datum)}</qdt:DateTimeString></ram:FormattedIssueDateTime></ram:InvoiceReferencedDocument>` : ''}
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

export function zahlungsText(b) {
  const faellig = b.faellig_am ? datumDE(b.faellig_am) : `${b.zahlungsziel_tage ?? 14} Tage nach Belegdatum`;
  const brutto = Number(b.brutto) || 0;
  if(brutto < 0) return b.art === 'gutschrift'
    ? 'Der Betrag wird mit künftigen Zahlungen verrechnet bzw. ist zurückzuzahlen.'
    : 'Der Betrag wird Ihnen erstattet bzw. mit offenen Posten verrechnet.';
  const sofort = Number(b.zahlungsziel_tage) === 0;
  if(b.art === 'gutschrift') {
    const iban = b.empfaenger?.iban;
    const wann = sofort ? 'umgehend' : `bis ${faellig}`;
    return iban ? `Auszahlung ${wann} auf Ihr Konto ${ibanFormat(iban)}.` : `Auszahlung ${wann}.`;
  }
  const konto = `${FIRMA_BANK_NAME}, IBAN ${ibanFormat(FIRMA_IBAN_ROH)}, BIC ${FIRMA_BIC_ROH}. Verwendungszweck: ${b.nummer || ''}`;
  return sofort ? `Ohne Abzug sofort fällig. Zahlung auf ${konto}`
                : `Zahlbar ohne Abzug bis ${faellig} auf ${konto}`;
}
export const ibanFormat = i => String(i || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();

// ─── PDF/A-3 (ZUGFeRD) ─────────────────────────────────────────────────────
let _libs = null;
async function libs() {
  if(_libs) return _libs;
  const [pdfLib, fk] = await Promise.all([
    import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm'),
    import('https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/+esm'),
  ]);
  const holen = async p => { const r = await fetch(p); if(!r.ok) throw new Error('Datei fehlt: ' + p); return new Uint8Array(await r.arrayBuffer()); };
  // Logo Saatgutservice (JPEG, RGB, 720×246 – unverändert aus der DATEV-Rechnung übernommen)
  const [reg, semi, bold, icc, logo] = await Promise.all([
    holen('assets/rechnung/Inter-Regular.ttf'), holen('assets/rechnung/Inter-SemiBold.ttf'),
    holen('assets/rechnung/Inter-Bold.ttf'), holen('assets/rechnung/sRGB-v2-magic.icc'),
    holen(RECHNUNG_LOGO).catch(() => null),
  ]);
  _libs = { L: pdfLib, fontkit: fk.default || fk, fonts: { reg, semi, bold }, icc, logo };
  return _libs;
}

const MM = 2.8346;
const GRUEN = [0.227, 0.49, 0.173];

// b: Beleg (mit nummer/datum, oder Entwurf), ctx: { kontrakt, original, entwurf }
export async function erzeugePdf(b, ctx = {}) {
  b = { ...b, datum: b.datum || isoDatum(new Date()) };
  if(ctx.entwurf) b.nummer = 'ENTWURF';
  const { L, fontkit, fonts, icc, logo } = await libs();
  const { PDFDocument, rgb, PDFName, PDFString, PDFHexString } = L;
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  // Vollständig einbetten: das Subsetting von @pdf-lib/fontkit verliert bei
  // Inter Glyphen (Text unsichtbar). PDF/A verlangt ohnehin eingebettete Fonts.
  const fR = await doc.embedFont(fonts.reg, { subset: false });
  const fS = await doc.embedFont(fonts.semi, { subset: false });
  const fB = await doc.embedFont(fonts.bold, { subset: false });
  const logoImg = logo ? await doc.embedJpg(logo) : null;

  const gut = b.art === 'gutschrift';
  const storno = !!ctx.original;
  const titel = storno ? (gut ? 'Storno-Gutschrift' : 'Stornorechnung') : (gut ? 'Gutschrift' : 'Rechnung');
  const nummer = ctx.entwurf ? 'ENTWURF' : b.nummer;
  const sums = summen(b.positionen);
  const p = b.empfaenger || {};
  const W = 595.28, H = 841.89, LM = 25 * MM, RM = W - 20 * MM;
  const C = { text: rgb(0.12, 0.14, 0.12), grau: rgb(0.42, 0.45, 0.42), linie: rgb(0.8, 0.82, 0.8), gruen: rgb(...GRUEN), hell: rgb(0.95, 0.97, 0.94) };

  const tw = (t, f, s) => f.widthOfTextAtSize(String(t), s);
  const txt = (pg, t, xx, yy, o = {}) => {
    const f = o.f || fR, s = o.s || 9;
    let xp = xx;
    if(o.align === 'right') xp = xx - tw(t, f, s);
    pg.drawText(String(t), { x: xp, y: yy, size: s, font: f, color: o.c || C.text });
  };
  const umbruch = (t, f, s, breite) => {
    const out = [];
    for(const absatz of String(t || '').split('\n')) {
      let zeile = '';
      for(const w of absatz.split(/\s+/)) {
        const test = zeile ? zeile + ' ' + w : w;
        if(tw(test, f, s) > breite && zeile) { out.push(zeile); zeile = w; } else zeile = test;
      }
      out.push(zeile);
    }
    return out;
  };

  const seiten = [];
  const neueSeite = () => {
    const pg = doc.addPage([W, H]); seiten.push(pg);
    // Wasserzeichen zuerst zeichnen, damit es unter dem Inhalt liegt.
    if(ctx.entwurf) pg.drawText('ENTWURF', { x: 150, y: 330, size: 90, font: fB, color: rgb(0.93, 0.93, 0.93), rotate: L.degrees(35) });
    return pg;
  };
  let pg = neueSeite();

  // Kopf
  if(logoImg) {
    const lw = 165, lh = lw * logoImg.height / logoImg.width;
    pg.drawImage(logoImg, { x: LM - 18, y: H - 12 * MM - lh, width: lw, height: lh });
  } else {
    txt(pg, 'SAATGUT & AGRARSERVICE BEESENSTEDT GmbH', LM, H - 22 * MM, { s: 12, f: fB, c: C.gruen });
  }
  const kopfR = [FIRMA_NAME, FIRMA_STRASSE, `${FIRMA_PLZ} ${FIRMA_ORT}`, `Tel. ${FIRMA_TEL}`, FIRMA_EMAIL];
  kopfR.forEach((t, i) => txt(pg, t, RM, H - 17 * MM - i * 11, { align: 'right', s: i ? 8 : 9, f: i ? fR : fS, c: i ? C.grau : C.text }));

  // Anschriftfeld (DIN 5008, Form B)
  let y = H - 50 * MM;
  const absZeile = `${FIRMA_NAME} · ${FIRMA_STRASSE} · ${FIRMA_PLZ} ${FIRMA_ORT}`;
  txt(pg, absZeile, LM, y, { s: Math.min(6.5, 6.5 * (85 * MM) / tw(absZeile, fR, 6.5)), c: C.grau });
  y -= 16;
  [p.name, p.strasse, [p.plz, p.ort].filter(Boolean).join(' '), p.land && p.land !== 'DE' ? landName(p.land) : '']
    .filter(Boolean).forEach((t, i) => { txt(pg, t, LM, y - i * 13, { s: 10, f: i ? fR : fS }); });

  // Infoblock
  const info = [
    [`${titel}-Nr.`, nummer],
    [gut ? 'Lieferantennummer' : 'Kundennummer', partnerNr(p)],
    p.ust_id ? [gut ? 'USt-IdNr. Lieferant' : 'Ihre USt-IdNr.', p.ust_id] : null,
    ['Belegdatum', datumDE(b.datum || isoDatum(new Date()))],
    ctx.kontrakt?.nummer ? ['Kontrakt', ctx.kontrakt.nummer] : null,
    b.leistung_von ? ['Liefer-/Leistungsdatum', b.leistung_von === b.leistung_bis ? datumDE(b.leistung_von) : `${datumDE(b.leistung_von)} – ${datumDE(b.leistung_bis)}`] : null,
    gut && !p.ust_id && p.steuernummer ? ['St.-Nr. Lieferant', p.steuernummer] : null,
    ['Unsere USt-IdNr.', FIRMA_USTID_ROH],
  ].filter(Boolean);
  const ix = 125 * MM;
  info.forEach(([k, v], i) => {
    txt(pg, k, ix, H - 50 * MM - i * 12, { s: 8, c: C.grau });
    txt(pg, v, RM, H - 50 * MM - i * 12, { s: 8.5, f: fS, align: 'right' });
  });

  // Titel
  y = H - 103 * MM;
  txt(pg, `${titel} ${nummer}`, LM, y, { s: 16, f: fB, c: C.gruen });
  if(ctx.entwurf) txt(pg, 'Vorschau – kein gültiger Beleg', RM, y + 2, { s: 9, f: fS, c: rgb(0.75, 0.2, 0.2), align: 'right' });
  y -= 18;
  const intro = storno
    ? `Hiermit stornieren wir ${gut ? 'die Gutschrift' : 'die Rechnung'} ${ctx.original.nummer} vom ${datumDE(ctx.original.datum)} vollständig.`
    : gut
      ? `Für die${ctx.kontrakt?.nummer ? ' aus Kontrakt ' + ctx.kontrakt.nummer : ''} von Ihnen erhaltene Ware schreiben wir Ihnen gut:`
      : `Für die Lieferungen${ctx.kontrakt?.nummer ? ' aus Kontrakt ' + ctx.kontrakt.nummer : ''} berechnen wir Ihnen:`;
  for(const z of umbruch(intro, fR, 9.5, RM - LM)) { txt(pg, z, LM, y, { s: 9.5 }); y -= 13; }
  // Bezugszeile wie in DATEV: "Kontrakt: … || Lieferschein: …"
  const lsListe = belegLieferscheine(b);
  const bezug = [ctx.kontrakt?.nummer ? `Kontrakt: ${ctx.kontrakt.nummer}` : '', lsListe ? `Lieferschein: ${lsListe}` : ''].filter(Boolean).join(' || ');
  if(bezug) for(const z of umbruch(bezug, fR, 8.5, RM - LM)) { txt(pg, z, LM, y, { s: 8.5, c: C.grau }); y -= 12; }
  y -= 6;

  // Tabelle
  const sp = { pos: LM, bez: LM + 22, menge: LM + 268, einh: LM + 274, preis: LM + 350, ust: LM + 362, betrag: RM };
  const kopfzeile = () => {
    pg.drawRectangle({ x: LM - 4, y: y - 5, width: RM - LM + 8, height: 17, color: C.hell });
    txt(pg, 'Pos', sp.pos, y, { s: 7.5, f: fS, c: C.grau });
    txt(pg, 'Bezeichnung', sp.bez, y, { s: 7.5, f: fS, c: C.grau });
    txt(pg, 'Menge', sp.menge, y, { s: 7.5, f: fS, c: C.grau, align: 'right' });
    txt(pg, 'Einh.', sp.einh, y, { s: 7.5, f: fS, c: C.grau });
    txt(pg, 'Preis €', sp.preis, y, { s: 7.5, f: fS, c: C.grau, align: 'right' });
    txt(pg, 'USt', sp.ust, y, { s: 7.5, f: fS, c: C.grau });
    txt(pg, 'Betrag €', sp.betrag, y, { s: 7.5, f: fS, c: C.grau, align: 'right' });
    y -= 18;
  };
  const UNTEN = 34 * MM;
  const platz = h => { if(y - h < UNTEN) { pg = neueSeite(); y = H - 25 * MM; kopfzeile(); } };
  kopfzeile();
  b.positionen.forEach((ps, i) => {
    const bezZ = umbruch(ps.bezeichnung, fS, 8.5, sp.menge - sp.bez - 50);
    // Zusatztext darf bis zur Preisspalte laufen (steht unter der Zahlenzeile).
    const besZ = ps.beschreibung ? umbruch(ps.beschreibung, fR, 7.5, sp.preis - sp.bez - 45) : [];
    const h = bezZ.length * 11 + besZ.length * 9.5 + 8;
    platz(h);
    txt(pg, String(i + 1), sp.pos, y, { s: 8.5, c: C.grau });
    bezZ.forEach((z, j) => txt(pg, z, sp.bez, y - j * 11, { s: 8.5, f: fS }));
    besZ.forEach((z, j) => txt(pg, z, sp.bez, y - bezZ.length * 11 - j * 9.5 + 1, { s: 7.5, c: C.grau }));
    txt(pg, num(ps.menge, ps.einheit === 'TNE' ? 3 : 0, 4), sp.menge, y, { s: 8.5, align: 'right' });
    txt(pg, EINHEITEN[ps.einheit] || ps.einheit, sp.einh, y, { s: 8.5 });
    txt(pg, num(ps.preis, 2, 4), sp.preis, y, { s: 8.5, align: 'right' });
    txt(pg, num(ps.ust_satz, 0, 1) + ' %', sp.ust, y, { s: 8.5 });
    txt(pg, num(ps.betrag, 2, 2), sp.betrag, y, { s: 8.5, f: fS, align: 'right' });
    y -= h;
    pg.drawLine({ start: { x: LM - 4, y: y + 8 }, end: { x: RM + 4, y: y + 8 }, thickness: 0.4, color: C.linie });
  });

  // Summen
  platz(30 + sums.steuern.length * 13 + 26);
  y -= 6;
  const sx = LM + 215;
  txt(pg, 'Summe netto', sx, y, { s: 9 }); txt(pg, eur(sums.netto), RM, y, { s: 9, align: 'right' }); y -= 13;
  for(const s of sums.steuern) {
    const lbl = s.satz === 0 ? 'Umsatzsteuer 0 % (steuerfrei)'
      : `USt ${num(s.satz, 0, 1)} %${Number(s.satz) === 7.8 && gut ? ' (§ 24 UStG)' : ''} auf ${eur(s.basis)}`;
    txt(pg, lbl, sx, y, { s: 9 }); txt(pg, eur(s.betrag), RM, y, { s: 9, align: 'right' }); y -= 13;
  }
  pg.drawLine({ start: { x: sx, y: y + 8 }, end: { x: RM, y: y + 8 }, thickness: 0.8, color: C.text });
  y -= 4;
  txt(pg, gut ? 'Auszahlungsbetrag' : 'Rechnungsbetrag', sx, y, { s: 11, f: fB }); txt(pg, eur(sums.brutto), RM, y, { s: 11, f: fB, align: 'right' });
  y -= 24;

  // Hinweise
  const hinweise = [];
  const befText = befreiungsText(b);
  if(befText) hinweise.push(befText);
  hinweise.push('Bitte beachten Sie unsere Zahlungsbedingung: ' + zahlungsText({ ...b, brutto: sums.brutto }));
  if(gut) hinweise.push('Abrechnung im Gutschriftverfahren (§ 14 Abs. 2 Satz 2 UStG). Sofern Sie mit der Gutschrift nicht einverstanden sind, widersprechen Sie bitte innerhalb von 14 Tagen.');
  if(gut && b.ust_modus === 'pauschal24') hinweise.push('Umsatzsteuer nach Durchschnittssatz gemäß § 24 Abs. 1 UStG (land- und forstwirtschaftlicher Betrieb).');
  if(ctx.kontrakt?.bio) hinweise.push(`Bio-Ware. Öko-Kontrollstelle: ${FIRMA_OEKO_KONTROLLSTELLE}${p.oeko_kontrollstelle && gut ? ' · Lieferant: ' + p.oeko_kontrollstelle : ''}.`);
  hinweise.push(storno ? '' : 'Das Lieferdatum entspricht dem jeweils angegebenen Lieferscheindatum.');
  if(b.bemerkung) hinweise.push(b.bemerkung);
  hinweise.push('Elektronische Rechnung im Format ZUGFeRD/Factur-X (EN 16931). Maßgeblich sind die eingebetteten XML-Daten (factur-x.xml).');
  for(const h of hinweise.filter(Boolean)) {
    const zs = umbruch(h, fR, 8, RM - LM);
    platz(zs.length * 11 + 4);
    zs.forEach(z => { txt(pg, z, LM, y, { s: 8, c: C.text }); y -= 11; });
    y -= 4;
  }

  // Fußzeile + Seitenzahlen
  // Fußzeile in vier Spalten wie die DATEV-Ausgangsrechnungen (Pflichtangaben § 35a GmbHG, § 14 UStG)
  const fussSpalten = [
    [0,   [FIRMA_NAME, FIRMA_STRASSE, `${FIRMA_PLZ} ${FIRMA_ORT}`]],
    [133, [`Tel.: ${FIRMA_TEL}`, FIRMA_EMAIL, FIRMA_REGISTER, `Geschäftsführer: ${FIRMA_GF_NAME}`]],
    [258, [`Steuernummer: ${FIRMA_STNR_ROH}`, `USt-IdNr.: ${FIRMA_USTID_ROH}`]],
    [350, [FIRMA_BANK_NAME, `IBAN: ${ibanFormat(FIRMA_IBAN_ROH)}`, `BIC: ${FIRMA_BIC_ROH}`]],
  ];
  seiten.forEach((s, i) => {
    s.drawLine({ start: { x: LM, y: 22 * MM }, end: { x: RM, y: 22 * MM }, thickness: 0.5, color: C.linie });
    for(const [dx, zeilen] of fussSpalten) zeilen.forEach((t, j) =>
      s.drawText(t, { x: LM + dx, y: 22 * MM - 10 - j * 8.5, size: 6.3, font: fR, color: C.grau }));
    const st = `Seite ${i + 1} von ${seiten.length}`;
    s.drawText(st, { x: RM - tw(st, fR, 7), y: 22 * MM + 6, size: 7, font: fR, color: C.grau });
  });

  // ── PDF/A-3b + Factur-X: Metadaten, OutputIntent, eingebettete XML ──
  const jetzt = new Date();
  const xml = ctx.xml || erzeugeXml({ ...b, nummer }, ctx);
  const titelDoc = `${titel} ${nummer}`;
  const subject = `${titel} ${nummer} – ${p.name || ''}`;
  doc.setTitle(titelDoc); doc.setAuthor(FIRMA_NAME); doc.setSubject(subject);
  doc.setCreator('Landgut Nuscheler'); doc.setProducer('Landgut Nuscheler E-Rechnung (pdf-lib)');
  doc.setCreationDate(jetzt); doc.setModificationDate(jetzt);
  doc.setLanguage('de-DE');

  const ctxPdf = doc.context;
  const enc = new TextEncoder();
  const xmlBytes = enc.encode(xml);
  const efStream = ctxPdf.flateStream(xmlBytes, {
    Type: 'EmbeddedFile', Subtype: 'text/xml',
    Params: { Size: xmlBytes.length, ModDate: PDFString.fromDate(jetzt) },
  });
  const efRef = ctxPdf.register(efStream);
  const fsDict = ctxPdf.obj({
    Type: 'Filespec', F: PDFString.of('factur-x.xml'), UF: PDFHexString.fromText('factur-x.xml'),
    Desc: PDFString.of('Factur-X/ZUGFeRD Rechnungsdaten'), AFRelationship: 'Alternative',
    EF: { F: efRef, UF: efRef },
  });
  const fsRef = ctxPdf.register(fsDict);
  const cat = doc.catalog;
  cat.set(PDFName.of('Names'), ctxPdf.obj({ EmbeddedFiles: { Names: [PDFString.of('factur-x.xml'), fsRef] } }));
  cat.set(PDFName.of('AF'), ctxPdf.obj([fsRef]));

  const iccStream = ctxPdf.flateStream(icc, { N: 3 });
  const iccRef = ctxPdf.register(iccStream);
  cat.set(PDFName.of('OutputIntents'), ctxPdf.obj([ctxPdf.obj({
    Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB'),
    Info: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: iccRef,
  })]));

  const isoZ = jetzt.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const xmp = xmpMetadaten({ titel: titelDoc, autor: FIRMA_NAME, subject, creator: 'Landgut Nuscheler',
    producer: 'Landgut Nuscheler E-Rechnung (pdf-lib)', datum: isoZ });
  const metaStream = ctxPdf.stream(enc.encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  cat.set(PDFName.of('Metadata'), ctxPdf.register(metaStream));

  const id = [...crypto.getRandomValues(new Uint8Array(16))].map(v => v.toString(16).padStart(2, '0')).join('');
  ctxPdf.trailerInfo.ID = ctxPdf.obj([PDFHexString.of(id), PDFHexString.of(id)]);

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, xml };
}

function xmpMetadaten(m) {
  const e = s => x(s);
  const prop = (n, d) => `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${n}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${d}</pdfaProperty:description></rdf:li>`;
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${e(m.titel)}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${e(m.autor)}</rdf:li></rdf:Seq></dc:creator>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${e(m.subject)}</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>${e(m.producer)}</pdf:Producer></rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>${e(m.creator)}</xmp:CreatorTool><xmp:CreateDate>${m.datum}</xmp:CreateDate><xmp:ModifyDate>${m.datum}</xmp:ModifyDate><xmp:MetadataDate>${m.datum}</xmp:MetadataDate></rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">
    <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
    <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
    <pdfaSchema:prefix>fx</pdfaSchema:prefix>
    <pdfaSchema:property><rdf:Seq>
     ${prop('DocumentFileName', 'Name of the embedded XML invoice file')}
     ${prop('DocumentType', 'INVOICE')}
     ${prop('Version', 'The actual version of the Factur-X XML schema')}
     ${prop('ConformanceLevel', 'The conformance level of the embedded Factur-X data')}
    </rdf:Seq></pdfaSchema:property>
   </rdf:li></rdf:Bag></pdfaExtension:schemas>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel></rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export function downloadBytes(bytes, name, typ) {
  const url = URL.createObjectURL(new Blob([bytes], { type: typ }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export function oeffneBytes(bytes, typ = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type: typ }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
