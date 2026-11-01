// Rechte je Programmbereich: nutzer.rechte (text[]) enthält die Schlüssel, die ein Nutzer sehen darf.
// Die Oberfläche blendet damit nur aus. Geprüft wird in der Datenbank über hat_recht() nur
// Nutzerverwaltung, Fruchtfolge und Biogas-Verwaltung, die übrigen Tabellen sind für alle Angemeldeten offen.

// Sidebar-Navigation als Daten (Reihenfolge wie bisher): [tab, icon, label] je Eintrag.
// Jeder Tab ist zugleich ein Recht – neue Einträge erscheinen automatisch als Schalter im Nutzerfenster.
export const NAV = [
  { section: null,             items: [['waage','⚖','Waage']] },
  { section: 'Übersicht',      items: [['dashboard','📊','Dashboard'],['fortschritt','📈','Fortschritt'],['karte','🗺','Karte'],['vermehrungen','🌱','Vermeh&shy;rungen']] },
  { section: 'Verwaltung',     items: [['schlaege','🌾','Schläge'],['fuhren','🚛','Fuhren'],['nutzer','👥','Nutzer']] },
  { section: 'Lager',          items: [['lager','📦','Lager&shy;übersicht'],['silos','🏭','Silo&shy;management']] },
  { section: 'Warenwirtschaft',items: [['warenausgang','⇅','Waren&shy;bewegungen'],['kontrakte','📋','Kontrakte'],['zukauf','🧪','Zukauf (Dünger)'],['kontakte','👔','Kunden/&shy;Lieferanten'],['artikel','🗂','Artikel']] },
  { section: 'Flächen',        items: [['fruchtfolge','🌻','Frucht&shy;folge']] },
  { section: 'System',         items: [['erntejahr','🌱','Neues Erntejahr']] },
];

// Eigene Vollbild-Ansichten für Fahrer (ohne Sidebar).
export const FAHRER_ANSICHTEN = [['abfahrer','Abfahrer-Ansicht'],['drescher','Drescher-Ansicht']];

// Rechte, die kein eigener Bereich sind.
export const WEITERE_RECHTE = [
  ['nachrichten','Nachrichten senden'],
  ['haengerzuege','Hängerzüge verwalten'],
  ['standort','Standort teilen (GPS, Karte)'],
];

export function hatRecht(u, recht) { return !!u?.rechte?.includes(recht); }

export function erlaubteTabs(u) {
  return NAV.flatMap(g => g.items.map(it => it[0])).filter(tab => hatRecht(u, tab));
}

// Hauptansichten eines Nutzers. Die erste ist der Start, mehrere lassen sich in der Kopfzeile umschalten.
export function ansichtenVon(u) {
  return [
    erlaubteTabs(u).length ? 'verwaltung' : null,
    hatRecht(u, 'abfahrer') ? 'abfahrer' : null,
    hatRecht(u, 'drescher') ? 'drescher' : null,
  ].filter(Boolean);
}

// Wer die Nutzer verwaltet, gilt als Verwaltung: er steht in den Fahrer-Auswahllisten der Fuhrenbearbeitung.
export function istVerwaltung(u) { return hatRecht(u, 'nutzer'); }

export function fahrerLabel(u) {
  return hatRecht(u, 'drescher') ? 'Drescherfahrer' : hatRecht(u, 'abfahrer') ? 'Abfahrer / Waage' : 'Verwaltung';
}
