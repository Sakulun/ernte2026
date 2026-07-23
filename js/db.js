import { SB_URL, SB_KEY } from './config.js?v=65';

export let sb = null;
export function getSb() { return sb; }

export const db = {
  async getNutzer() {
    const { data, error } = await sb.from('nutzer_public').select('*').order('id');
    if(error) throw error;
    return data.map(u => {
      const lbl = u.rolle==='drescher'?'Drescherfahrer':u.rolle==='abfahrer'?'Abfahrer / Waage':u.rolle==='silomeister'?'Silomeister':'Admin / Übersicht';
      return { id: u.id, name: u.name, role: u.rolle, label: lbl };
    });
  },
  async checkPassword(name, hash, legacyHash) {
    const { data, error } = await sb.rpc('check_password', {
      p_name: name,
      p_hash: hash,
      p_legacy_hash: legacyHash || null
    });
    if(error) throw error;
    return data;
  },
  async upsertNutzer(u) {
    // Schreibzugriffe laufen über SECURITY DEFINER-Funktionen: nutzer hat (zum Schutz
    // der Passwort-Hashes) keine SELECT-Policy, wodurch direkte UPDATE/DELETE via
    // PostgREST 0 Zeilen treffen würden. pw nur übergeben, wenn vergeben (sonst behalten).
    if(u.id) {
      const { error } = await sb.rpc('admin_update_nutzer', {
        p_id: u.id, p_name: u.name, p_rolle: u.role, p_pw: u.pw ?? null
      });
      if(error) throw error;
    } else {
      const { error } = await sb.rpc('admin_create_nutzer', {
        p_name: u.name, p_rolle: u.role, p_pw: u.pw
      });
      if(error) throw error;
    }
  },
  async deleteNutzer(id) {
    const { error } = await sb.rpc('admin_delete_nutzer', { p_id: id });
    if(error) throw error;
  },
  async getFelder() {
    const { data, error } = await sb.from('felder').select('*').order('id');
    if(error) throw error;
    return data
      // Mais & Silomais bis Oktober ausgeblendet (Daten bleiben in der DB).
      // Zum Wieder-Einblenden im Herbst einfach diese .filter-Zeile entfernen.
      .filter(f => !/mais/i.test(f.fruchtart||''))
      .map(f => ({
        id: f.id, name: f.name, flaeche: parseFloat(f.flaeche),
        fruchtart: f.fruchtart, status: f.status, betrieb: f.betrieb||'',
        bio: f.bio||false, flik: f.flik||'', nummer: f.nummer||'',
        typ: f.typ||'schlag', kontaktId: f.kontakt_id||null,
        zukaufFruchtarten: Array.isArray(f.zukauf_fruchtarten) ? f.zukauf_fruchtarten : [],
        zukaufAbfahrerId: f.zukauf_abfahrer_id||null
      }));
  },
  // Spezial-"Feld" für Zukauf von einem Lieferanten (typ 'lieferant')
  async insertFeldLieferant(name, kontaktId) {
    const { data, error } = await sb.from('felder').insert({
      name, fruchtart: '', flaeche: 0, status: 'aktiv', betrieb: 'Zukauf',
      typ: 'lieferant', kontakt_id: kontaktId
    }).select().single();
    if(error) throw error;
    return data.id;
  },
  // Spezial-"Feld" für Reinigungsabgänge (typ 'reinigung'), z.B. "Reinigungsabgang KWS Keitum".
  async insertFeldReinigung(name, fruchtart) {
    const { data, error } = await sb.from('felder').insert({
      name, fruchtart: fruchtart || '', flaeche: 0, status: 'aktiv', betrieb: 'Reinigung',
      typ: 'reinigung'
    }).select().single();
    if(error) throw error;
    return data.id;
  },
  async updateFeldStatus(id, status) {
    const { error } = await sb.from('felder').update({status}).eq('id', id);
    if(error) throw error;
  },
  // Zukauf-Konfig eines Lieferanten-Felds: erlaubte Fruchtarten + Standard-Abfahrer
  async updateFeldZukauf(id, { fruchtarten, abfahrerId }) {
    const { error } = await sb.from('felder')
      .update({ zukauf_fruchtarten: fruchtarten || [], zukauf_abfahrer_id: abfahrerId || null })
      .eq('id', id);
    if(error) throw error;
  },
  async getFuhren() {
    const { data, error } = await sb.from('fuhren').select('*').order('id');
    if(error) throw error;
    return data.map(f => ({
      id: f.id, nr: f.nr, status: f.status,
      drescherId: f.drescher_id, abfahrerId: f.abfahrer_id,
      feldId: f.feld_id, fruchtart: f.fruchtart,
      vollgewicht: f.vollgewicht ? parseFloat(f.vollgewicht) : null,
      leergewicht: f.leergewicht != null ? parseFloat(f.leergewicht) : null,
      feuchte: f.feuchte ? parseFloat(f.feuchte) : null,
      fallzahl: f.fallzahl ? parseFloat(f.fallzahl) : null,
      protein: f.protein ? parseFloat(f.protein) : null,
      hlGewicht: f.hl_gewicht ? parseFloat(f.hl_gewicht) : null,
      gluten: f.gluten ? parseFloat(f.gluten) : null,
      oelgehalt: f.oelgehalt ? parseFloat(f.oelgehalt) : null,
      sorte: f.sorte || null,
      kennzeichen: f.kennzeichen || null,
      lat: f.lat != null ? parseFloat(f.lat) : null,
      lon: f.lon != null ? parseFloat(f.lon) : null,
      quelleLagerId: f.quelle_lager_id || null,
      zeit: f.zeit,
      verifiziert: f.verifiziert || false,
      verifiziertVon: f.verifiziert_von || null,
      siloId: f.silo_id || null,
      feldIdKorr: f.feld_id_korr || null,
      drescherId: f.drescher_id_korr || f.drescher_id,
      abfahrerId: f.abfahrer_id_korr || f.abfahrer_id,
      feldId: f.feld_id_korr || f.feld_id,
      fruchtart: f.fruchtart_korr || f.fruchtart,
    }));
  },
  async insertFuhre(f) {
    // nr wird serverseitig per Trigger/Sequence vergeben (nutzerunabhängig eindeutig).
    // Daher KEINE nr mitsenden – sonst würde die mitgesendete Nummer übernommen.
    const { data, error } = await sb.from('fuhren').insert({
      status: 'offen',
      drescher_id: f.drescherId, abfahrer_id: f.abfahrerId,
      feld_id: f.feldId, fruchtart: f.fruchtart, sorte: f.sorte||null,
      lat: f.lat ?? null, lon: f.lon ?? null,
      zeit: f.zeit
    }).select().single();
    if(error) throw error;
    return { id: data.id, nr: data.nr };
  },
  // Komplette Fuhre inkl. Gewichte/Qualität in einem Rutsch anlegen (Waage-Erfassung)
  async insertFuhreKomplett(f) {
    // nr wird serverseitig vergeben – siehe insertFuhre.
    const { data, error } = await sb.from('fuhren').insert({
      status: f.status || 'fertig',
      drescher_id: f.drescherId, abfahrer_id: f.abfahrerId,
      feld_id: f.feldId, fruchtart: f.fruchtart, sorte: f.sorte||null,
      vollgewicht: f.vollgewicht ?? null, leergewicht: f.leergewicht ?? null,
      feuchte: f.feuchte ?? null, protein: f.protein ?? null, gluten: f.gluten ?? null,
      hl_gewicht: f.hlGewicht ?? null, oelgehalt: f.oelgehalt ?? null, fallzahl: f.fallzahl ?? null,
      kennzeichen: f.kennzeichen || null,
      lat: f.lat ?? null, lon: f.lon ?? null,
      zeit: f.zeit
    }).select().single();
    if(error) throw error;
    return { id: data.id, nr: data.nr };
  },
  async updateFuhre(id, updates) {
    const map = {};
    if(updates.status !== undefined) map.status = updates.status;
    if(updates.vollgewicht !== undefined) map.vollgewicht = updates.vollgewicht;
    if(updates.leergewicht !== undefined) map.leergewicht = updates.leergewicht;
    if(updates.feuchte !== undefined) map.feuchte = updates.feuchte;
    if(updates.sorte !== undefined) map.sorte = updates.sorte;
    if(updates.fallzahl !== undefined) map.fallzahl = updates.fallzahl;
    if(updates.protein !== undefined) map.protein = updates.protein;
    if(updates.hlGewicht !== undefined) map.hl_gewicht = updates.hlGewicht;
    if(updates.gluten !== undefined) map.gluten = updates.gluten;
    if(updates.oelgehalt !== undefined) map.oelgehalt = updates.oelgehalt;
    if(updates.verifiziert !== undefined) map.verifiziert = updates.verifiziert;
    if(updates.verifiziertVon !== undefined) map.verifiziert_von = updates.verifiziertVon;
    if(updates.siloId !== undefined) map.silo_id = updates.siloId;
    if(updates.quelleLagerId !== undefined) map.quelle_lager_id = updates.quelleLagerId;
    if(updates.feldIdKorr !== undefined) { map.feld_id_korr = updates.feldIdKorr; map.feld_id = updates.feldIdKorr; }
    if(updates.drescherId !== undefined) map.drescher_id_korr = updates.drescherId;
    if(updates.abfahrerId !== undefined) map.abfahrer_id_korr = updates.abfahrerId;
    if(updates.fruchtartKorr !== undefined) { map.fruchtart_korr = updates.fruchtartKorr; map.fruchtart = updates.fruchtartKorr; }
    const { error } = await sb.from('fuhren').update(map).eq('id', id);
    if(error) throw error;
  },
  async deleteFuhre(id) {
    const { error } = await sb.from('fuhren').delete().eq('id', id);
    if(error) throw error;
  },
  async getShapes() {
    const { data, error } = await sb.from('shapes').select('*');
    if(error) throw error;
    return data || [];
  },
  async upsertShape(feldId, betrieb, outer, holes) {
    const { error } = await sb.from('shapes').upsert({
      feld_id: feldId, betrieb, outer_coords: outer, holes: holes||[]
    }, {onConflict:'feld_id'});
    if(error) throw error;
  },
  async deleteShape(feldId) {
    const { error } = await sb.from('shapes').delete().eq('feld_id', feldId);
    if(error) throw error;
  },
  async getVermehrungen() {
    const { data, error } = await sb.from('vermehrungen').select('*');
    if(error) throw error;
    return data || [];
  },
  // Hängerzüge mit festem Leergewicht (Auswahl-Button beim Einwiegen)
  async getHaengerzuege() {
    const { data, error } = await sb.from('haengerzuege').select('*').eq('aktiv', true).order('name');
    if(error) throw error;
    return data || [];
  },
  async insertHaengerzug(name, leergewichtKg) {
    const { data, error } = await sb.from('haengerzuege').insert({ name, leergewicht_kg: leergewichtKg }).select().single();
    if(error) throw error;
    return data;
  },
  async updateHaengerzug(id, updates) {
    const { error } = await sb.from('haengerzuege').update(updates).eq('id', id);
    if(error) throw error;
  },
  async deleteHaengerzug(id) {
    const { error } = await sb.from('haengerzuege').delete().eq('id', id);
    if(error) throw error;
  },
  async getLieferungen() {
    const { data, error } = await sb.from('lieferungen').select('*').order('id', {ascending:false});
    if(error) throw error; return data || [];
  },
  async insertLieferung(obj) {
    const { data, error } = await sb.from('lieferungen').insert(obj).select().single();
    if(error) throw error; return data;
  },
  async updateLieferung(id, updates) {
    const { error } = await sb.from('lieferungen').update(updates).eq('id', id);
    if(error) throw error;
  },
  async getSilos() {
    const { data, error } = await sb.from('silos').select('*').order('id');
    if(error) throw error;
    return data || [];
  },
  async updateSilo(id, updates) {
    const { error } = await sb.from('silos').update(updates).eq('id', id);
    if(error) throw error;
  },
  async getArtikel() {
    const { data, error } = await sb.from('artikel').select('*').order('name');
    if(error) throw error;
    return data || [];
  },
  async insertArtikel(a) {
    const { data, error } = await sb.from('artikel').insert({
      name: a.name, einheit: a.einheit, kategorie: a.kategorie, aktiv: true
    }).select().single();
    if(error) throw error;
    return data;
  },
  async updateArtikel(a) {
    const { error } = await sb.from('artikel').update({
      name: a.name, einheit: a.einheit, kategorie: a.kategorie, aktiv: a.aktiv
    }).eq('id', a.id);
    if(error) throw error;
  },
  async getKontakte() {
    const { data, error } = await sb.from('kontakte').select('*').order('name');
    if(error) throw error; return data || [];
  },
  async insertKontakt(k) {
    const { data, error } = await sb.from('kontakte').insert({
      name:k.name, typ:k.typ,
      strasse:k.strasse||null, plz:k.plz||null, ort:k.ort||null,
      telefon:k.telefon||null,
      email:k.email||null, iban:k.iban||null, notiz:k.notiz||null, aktiv:true
    }).select().single();
    if(error) throw error; return data;
  },
  async updateKontakt(k) {
    const { error } = await sb.from('kontakte').update({
      name:k.name, typ:k.typ,
      strasse:k.strasse||null, plz:k.plz||null, ort:k.ort||null,
      telefon:k.telefon||null,
      email:k.email||null, iban:k.iban||null, notiz:k.notiz||null, aktiv:k.aktiv
    }).eq('id', k.id);
    if(error) throw error;
  },
  async getKontrakte() {
    const { data, error } = await sb.from('kontrakte').select('*').order('erstellt_am', {ascending:false});
    if(error) throw error; return data || [];
  },
  async insertKontrakt(k) {
    const { data, error } = await sb.from('kontrakte').insert({
      nummer:k.nummer, kontakt_id:k.kontaktId||null, artikel_id:k.artikelId||null,
      fruchtart_text:k.fruchtartText||null, menge_t:k.mengeT,
      preis_eur:k.preisEur||null, lieferung_von:k.lieferungVon||null,
      lieferung_bis:k.lieferungBis||null, paritaet:k.paritaet||null,
      bio:k.bio||false, zert_nachhaltig:k.zertNachhaltig||false, zert_gmp:k.zertGmp||false,
      notiz:k.notiz||null, pdf_name:k.pdfName||null,
      pdf_text:k.pdfText||null, status:'aktiv'
    }).select().single();
    if(error) throw error; return data;
  },
  async updateKontrakt(k) {
    const { error } = await sb.from('kontrakte').update({
      nummer:k.nummer, kontakt_id:k.kontakt_id||null, artikel_id:k.artikel_id||null,
      fruchtart_text:k.fruchtart_text||null, menge_t:k.menge_t,
      preis_eur:k.preis_eur||null, lieferung_von:k.lieferung_von||null,
      lieferung_bis:k.lieferung_bis||null, paritaet:k.paritaet||null,
      bio:k.bio||false, zert_nachhaltig:k.zert_nachhaltig||false, zert_gmp:k.zert_gmp||false,
      notiz:k.notiz||null, status:k.status
    }).eq('id', k.id);
    if(error) throw error;
  },
  async deleteKontrakt(id) {
    const { error } = await sb.from('kontrakte').delete().eq('id', id);
    if(error) throw error;
  },
  async getWarenbewegungen() {
    const { data, error } = await sb.from('warenbewegungen').select('*').order('erstellt_am', {ascending:false});
    if(error) throw error;
    return data || [];
  },
  async insertWarenbewegung(w) {
    const { data, error } = await sb.from('warenbewegungen').insert({
      typ: w.typ || 'ausgang',
      artikel_id: w.artikelId || null,
      silo_von_id: w.siloVonId || null,
      silo_nach_id: w.siloNachId || null,
      menge_kg: w.mengeKg,
      empfaenger: w.empfaenger || null,
      beleg_nr: w.belegNr || null,
      notiz: w.notiz || null,
      bio: w.bio || false,
      kontrakt_id: w.kontraktId || null,
      fuhre_id: w.fuhreId || null,
      // Lieferschein-Nr. vergibt der Server (Trigger), daher hier nicht senden
      vollgewicht: w.vollgewicht ?? null,
      leergewicht: w.leergewicht ?? null,
      spedition: w.spedition || null,
      kennzeichen: w.kennzeichen || null,
      sonstige_angaben: w.sonstigeAngaben || null,
      erstellt_von: w.erstelltVon || null
    }).select().single();
    if(error) throw error;
    return data;
  },
  async deleteWarenbewegung(id) {
    const { error } = await sb.from('warenbewegungen').delete().eq('id', id);
    if(error) throw error;
  },
  // Abrechnungsfelder einer Auslieferung (Kontrakte-Seite)
  async updateWarenbewegungAbrechnung(id, u) {
    const map = {};
    if(u.gutschriftNr !== undefined) map.gutschrift_nr = u.gutschriftNr || null;
    if(u.qualiNr !== undefined)      map.quali_nr = u.qualiNr || null;
    if(u.klaeren !== undefined)      map.klaeren = !!u.klaeren;
    if(u.bemerkung !== undefined)    map.bemerkung = u.bemerkung || null;
    const { error } = await sb.from('warenbewegungen').update(map).eq('id', id);
    if(error) throw error;
  },
  // ── Umlaufspeicher: leer verwogene Fahrzeuge, die auf Beladung warten ──
  async getUmlauf() {
    const { data, error } = await sb.from('umlauf').select('*')
      .eq('status', 'wartet').order('erstwiegung');
    if(error) throw error;
    return data || [];
  },
  async insertUmlauf(u) {
    const { data, error } = await sb.from('umlauf').insert({
      kennzeichen: u.kennzeichen,
      spedition: u.spedition || null,
      leergewicht: u.leergewicht,
      kontakt_id: u.kontaktId || null,
      kontrakt_id: u.kontraktId || null,
      silo_von_id: u.siloVonId || null,
      artikel_id: u.artikelId || null,
      sonstige_angaben: u.sonstigeAngaben || null,
      erstellt_von: u.erstelltVon || null
    }).select().single();
    if(error) throw error;
    return data;
  },
  // Kein Löschen: der Eintrag bleibt als Nachweis stehen und wechselt nur den Status.
  async umlaufAbschliessen(id, warenbewegungId) {
    const { error } = await sb.from('umlauf')
      .update({ status:'erledigt', erledigt_am:new Date().toISOString(), warenbewegung_id: warenbewegungId })
      .eq('id', id);
    if(error) throw error;
  },
  async umlaufStornieren(id) {
    const { error } = await sb.from('umlauf')
      .update({ status:'storniert', erledigt_am:new Date().toISOString() }).eq('id', id);
    if(error) throw error;
  },
  async upsertGPS(nutzerId, lat, lon) {
    const { error } = await sb.from('gps_positionen').upsert({
      nutzer_id: nutzerId, lat, lon, aktualisiert_am: new Date().toISOString()
    }, {onConflict:'nutzer_id'});
    if(error) console.warn('GPS upsert:', error.message);
  },
  async getGPS() {
    const { data } = await sb.from('gps_positionen').select('*');
    return data || [];
  },
  subscribeAll(onChange) {
    const channelId = 'ernte-changes-' + Math.random().toString(36).slice(2,8);
    const channel = sb.channel(channelId)
      .on('postgres_changes', {event:'*', schema:'public', table:'fuhren'}, onChange)
      .on('postgres_changes', {event:'*', schema:'public', table:'felder'}, onChange)
      .on('postgres_changes', {event:'*', schema:'public', table:'gps_positionen'}, onChange)
      .on('postgres_changes', {event:'*', schema:'public', table:'silos'}, onChange)
      .on('postgres_changes', {event:'*', schema:'public', table:'warenbewegungen'}, onChange)
      .on('postgres_changes', {event:'*', schema:'public', table:'artikel'}, onChange)
      .on('postgres_changes', {event:'*', schema:'public', table:'kontakte'}, onChange)
      .on('postgres_changes', {event:'*', schema:'public', table:'kontrakte'}, onChange)
      .on('postgres_changes', {event:'*', schema:'public', table:'waage_live'}, onChange)
      .on('postgres_changes', {event:'*', schema:'public', table:'umlauf'}, onChange)
      .subscribe((status, err) => {
        const dot = document.getElementById('topbar-sync');
        if(status === 'SUBSCRIBED') {
          if(dot) { dot.style.background='#6b8f4e'; dot.title='Echtzeit aktiv'; }
        } else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if(dot) { dot.style.background='#b03030'; dot.title='Echtzeit-Fehler – neu laden'; }
          setTimeout(() => sb.removeChannel(channel).then(() => db.subscribeAll(onChange)), 3000);
        } else {
          if(dot) { dot.style.background='#b07820'; dot.title='Verbinde…'; }
        }
      });
    return channel;
  }
};

export function initSupabase() {
  if(typeof supabase !== 'undefined' && supabase.createClient) {
    sb = supabase.createClient(SB_URL, SB_KEY);
    window.bootApp();
  } else {
    setTimeout(initSupabase, 50);
  }
}
