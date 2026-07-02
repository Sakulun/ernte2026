# CLAUDE.md — Ernte 2026 · Nuscheler Unternehmensgruppe

## Skills

Claude verwendet folgende Skills automatisch, wenn sie relevant sind.
Direkter Aufruf auch per Slash-Command möglich (z.B. `/frontend-design`).

### Dokumente & Dateien

| Skill | Wann automatisch aktiv |
|---|---|
| `docx` | Word-Dokumente erstellen, bearbeiten, Vorlagen, Berichte, Beschlüsse |
| `xlsx` | Excel-Tabellen erstellen oder bearbeiten (.xlsx, .csv, .tsv) |
| `pdf` | PDFs lesen, erstellen, zusammenführen, Formulare ausfüllen |
| `pdf-reading` | Inhalt aus PDF-Uploads lesen und extrahieren |
| `pptx` | PowerPoint-Präsentationen erstellen oder bearbeiten |
| `file-reading` | Beliebige Datei-Uploads lesen (Router für alle Formate) |

### Frontend & Design

| Skill | Wann automatisch aktiv |
|---|---|
| `frontend-design` | Webapps, Dashboards, Landing Pages, UI-Komponenten, HTML/CSS/JS |

### Produktwissen

| Skill | Wann automatisch aktiv |
|---|---|
| `product-self-knowledge` | Fragen zu Claude Code, Claude API, Claude.ai Features/Preisen |

---

## Allgemeine Anweisungen

- Antworte auf Deutsch, wenn der Nutzer auf Deutsch schreibt
- Bevorzuge direkte, effiziente Antworten ohne unnötiges Hin-und-Her
- Bei Code: Erstelle immer vollständige, lauffähige Dateien (keine Fragmente)
- Bei Unsicherheit über Dateiinhalte: Nutze den `file-reading` Skill
- Die App ist modularisiert in **native ES-Module** (`js/`-Verzeichnis) — CSS und HTML-Skeleton bleiben in `index.html`
- JavaScript-Änderungen erfolgen in den jeweiligen Modulen unter `js/`
- Neue Funktionen, die per `onclick` aufgerufen werden, müssen in `js/app.js` auf `window` registriert werden
- Niemals Build-Tools, Frameworks oder npm-Pakete einführen — die App läuft ohne Build-Prozess
- Keine TypeScript-Migration — alles bleibt Vanilla JS

---

## Projektkontext

Dieses Repository gehört zur **Nuscheler Unternehmensgruppe** (Landwirtschaft/Agrarservice).

**Anwendungsname:** Ernte 2026
**Zweck:** Echtzeit-Ernteverwaltung — Koordination von Mähdreschern, Transportfahrzeugen, Silos und Administration während der Erntekampagne.

Typische Aufgaben: Ernte-App, Datenverwaltung, Dokumentenerstellung, DATEV-Workflows.

---

## Repository-Struktur

```
ernteneu/
├── index.html              # CSS + HTML-Skeleton + GEO_DATA (~1.250 Zeilen)
├── js/
│   ├── app.js              # Entry Point: importiert alle Module, registriert window.*
│   ├── config.js           # Supabase-URL/Key, Firmen-Konstanten, Logo
│   ├── db.js               # Supabase-Client (sb), CRUD-Objekt (db), subscribeAll()
│   ├── state.js            # state-Objekt, bootApp(), showLoader/hideLoader
│   ├── helpers.js          # getFeld, getUser, netto, kg2t, fmtDate, showToast, escapeHtml, hashPW
│   ├── bio.js              # BIO_BETRIEBE, isBioBetrieb, isBioFeld, bioBadge
│   ├── frucht.js           # getFruchtFarbe (Kulturfarben)
│   ├── quality.js          # Qualitätsfelder, Feuchtegrenzwerte
│   ├── login.js            # Login-Flow: Benutzerauswahl, Passwort, Session
│   ├── router.js           # renderMain — routet zu rollenspezifischem Dashboard
│   ├── drescher.js         # Drescher-Dashboard: Feldwahl, Zuweisung
│   ├── abfahrer.js         # Abfahrer-Dashboard: Fuhren, Gewichte, Schlagsuche
│   ├── admin.js            # Admin-Shell: Sidebar, Tab-Navigation
│   ├── admin-dash.js       # Admin-Übersichtskacheln
│   ├── admin-fuhren.js     # Fuhrenverwaltung: Edit, Verifizierung, Abschluss
│   ├── admin-schlaege.js   # Schlagverwaltung: Suche, Statuswechsel
│   ├── admin-karte.js      # Kartenansicht: Leaflet, GPS-Tracking, Wake Lock
│   ├── admin-nutzer.js     # Nutzerverwaltung: Anlegen, Bearbeiten, Löschen
│   ├── admin-fortschritt.js# Fortschrittsanalyse
│   ├── silo.js             # Silomanagement: Bestände, Drag&Drop, Silomeister-Dashboard
│   ├── waren.js            # Warenbewegungen: Ein-/Ausgang, Waage-Widget, Lieferungen
│   ├── artikel.js          # Artikelverwaltung
│   ├── kontakte.js         # Kunden/Lieferanten-Verwaltung
│   ├── kontrakte.js        # Kontraktverwaltung, PDF-Import
│   ├── nachrichten.js      # In-App-Nachrichten, Push-Notifications
│   ├── onboarding.js       # Onboarding-Wizard für neue Benutzer
│   ├── erntejahr.js        # Neues Erntejahr: CSV/Excel/KML-Import
│   └── export.js           # CSV-Export, Tagesbericht, Lieferungs-PDF
├── themes/
│   ├── README.md           # Anleitung zum Theme-Wechsel
│   ├── agrarmonitor.css    # Hell-Theme (Salbeigrün)
│   ├── dark.css            # Dunkel-Theme (Neongrün)
│   └── industrial.css      # Industrial-Theme (Bernstein) — AKTIV
├── waage-bridge/
│   ├── index.js            # Node.js TCP→Supabase Bridge für Waage
│   ├── package.json        # Abhängigkeiten (nur @supabase/supabase-js v2)
│   ├── .env.example        # Konfigurationsvorlage
│   └── start.bat           # Windows-Startskript
└── .claude/
    └── launch.json         # Dev-Server: npx serve auf Port 3000
```

---

## Technologie-Stack

### Frontend
- **Vanilla JavaScript** mit **nativen ES-Modulen** (`<script type="module">`) — kein Framework, kein Build-Prozess
- **Leaflet 1.9.4** — Karten & Feldgrenzen (Polygone)
- **PDF.js 3.11.174** — PDF-Anzeige und -Import
- **Google Fonts** — Work Sans (Headlines), Inter (Body)

### Backend / Datenbank
- **Supabase** (PostgreSQL-BaaS)
  - URL: `https://fijfxmjtoexpuxxjqqbf.supabase.co`
  - Echtzeit-Subscriptions auf allen 15 Tabellen via `postgres_changes`
- **Node.js Bridge** (`waage-bridge/`) — TCP↔Supabase-Sync für Schenck Disomat Opus Waage (MinProz-Protokoll)

### Deployment
- Statischer Datei-Server (kein Backend nötig für die Hauptanwendung)
- `waage-bridge` läuft als separater Node.js-Prozess auf dem Betriebsgelände

---

## Datenbank-Schema (Supabase-Tabellen)

| Tabelle | Beschreibung |
|---|---|
| `nutzer` | Benutzerkonten mit Rollen |
| `felder` | Felder / Schläge |
| `fuhren` | Erntefahrten (eine Fuhre = eine Transportfahrt) |
| `lieferungen` | Lieferdatensätze |
| `silos` | Silobestände |
| `vermehrungen` | Saatgutvermehrungen |
| `shapes` | Geospatiale Feldgrenzen (GeoJSON-Polygone) |
| `gps_positionen` | Live-GPS-Positionen der Maschinen |
| `waage_live` | Live-Waagengewichte vom Bridge-Dienst |
| `artikel` | Warenkatalog (Getreide, Sorten etc.) |
| `kontakte` | Kontaktverwaltung (Lieferanten, Kunden) |
| `kontrakte` | Vertragsmanagement |
| `warenbewegungen` | Lagerzu-/abgänge (Eingang & Ausgang) |
| `nachrichten` | In-App-Benachrichtigungen |

---

## Benutzerrollen & Dashboards

| Rolle | Farbe | Hauptfunktionen |
|---|---|---|
| **Drescher** | Bernstein `#c8962e` | Ernteaufträge annehmen, Felder abarbeiten, Abschluss melden |
| **Abfahrer** | Blau `#4a8ab0` | Fuhren mit Voll-/Leergewicht erfassen, Waagenwidget nutzen |
| **Silomeister** | — | Silobestände verwalten, Warenbewegungen buchen |
| **Admin** | Gold `#c8a84b` | Vollzugriff: Dashboard, Fortschritt, Fuhren, Schläge, Nutzer, Kontrakte, KDV |

### Haupt-Render-Funktionen

```
renderLogin()          — Anmeldebildschirm
renderMain()           — Router → rollenspezifisches Dashboard
renderDrescher()       — Drescher-Dashboard
renderAbfahrer()       — Abfahrer-Dashboard (offene Fuhren)
renderAbfahrerOffen()  — Offene Lieferungen
renderAbfahrerFertig() — Abgeschlossene Lieferungen
renderAdmin()          — Admin-Panel mit Sidebar-Navigation
renderSilomeister()    — Silomeister-Dashboard

renderAdminDash()      — Admin-Übersicht
renderAdminFuhren()    — Fuhrenverwaltung
renderAdminSchlaege()  — Schlagverwaltung
renderAdminKarte()     — Kartenansicht aller Felder
renderAdminNutzer()    — Nutzerverwaltung
renderAdminFortschritt() — Fortschrittsanalyse
```

---

## Code-Konventionen

### Supabase-Datenbankzugriff

Immer `try/catch` verwenden — **kein** `.catch()`:

```javascript
// RICHTIG
try {
  const { data, error } = await sb.from('fuhren').select('*').order('id');
  if (error) throw error;
} catch (err) {
  console.error(err);
}

// FALSCH — nicht verwenden
sb.from('fuhren').select('*').then(...).catch(...);
```

### Modul-Architektur

- Jedes Modul exportiert seine Funktionen via `export`
- `app.js` importiert alles und registriert onclick-Funktionen auf `window` via `Object.assign`
- Cross-Modul-Aufrufe erfolgen über `window.functionName()` in Template-Literals
- Mutable Exports (dTab, aTab, adminTab) nutzen Getter: `get dTab() { return dTab; }`
- `GEO_DATA` ist ein globales inline `<script>` in `index.html` (256 KB Geodaten)

### UI-Rendering-Muster

Die App rendert die gesamte UI durch DOM-String-Injection in `#app`:

```javascript
function renderBeispiel() {
  document.getElementById('app').innerHTML = `
    <div class="card">...</div>
  `;
  // Event-Listener danach binden
  document.getElementById('btn-save').addEventListener('click', speichern);
}
```

### Supabase Echtzeit-Subscriptions

```javascript
sb.channel('tabelle-changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'fuhren' }, () => {
    renderAktuelleAnsicht();
  })
  .subscribe();
```

### Stil & CSS

- Inline-`<style>`-Block am Ende von `index.html` — hier CSS-Änderungen vornehmen
- Theme-Overrides in `themes/*.css` — für vollständige Theme-Wechsel
- Aktives Theme: **industrial.css** (Dunkel/Bernstein)
- CSS-Klassen direkt als Strings in Template-Literals — kein CSS-in-JS

---

## Waage-Bridge

Der `waage-bridge/`-Dienst verbindet eine **Schenck Disomat Opus** Waage via TCP (MinProz-Protokoll) mit Supabase.

**Konfiguration (`.env`):**
```
WAAGE_IP=192.168.1.50      # IP der Waage im Netzwerk
WAAGE_PORT=8000             # TCP-Port
POLL_CMD=SI                 # MinProz-Befehl (Stable/Instable)
POLL_MS=2000                # Abfrageintervall in ms
SUPABASE_URL=...
SUPABASE_KEY=...            # Service-Role-Key (nicht Anon-Key!)
```

**Antwortformat der Waage:** `+014500.000 kg ST` (Wert, Einheit, Status ST/US/OL/ER)

**Starten:** `cd waage-bridge && npm install && node index.js`

---

## Entwicklungsworkflow

### Lokale Entwicklung starten
```bash
npx serve . -p 3000
# Anwendung öffnen: http://localhost:3000
```

### Änderungen vornehmen
1. JavaScript: Im jeweiligen Modul unter `js/` editieren
2. Neue onclick-Funktionen: In `js/app.js` importieren und auf `window` registrieren
3. CSS: In `index.html` im `<style>`-Block editieren
4. Browser-Tab neu laden (kein Build nötig)
5. Für Datenbankänderungen: Supabase-Dashboard nutzen

### Theme wechseln
Methode A (Inline): CSS-Block am Ende des `<style>`-Tags in `index.html` durch den Inhalt eines `themes/*.css` ersetzen.
Methode B (Extern): `<link rel="stylesheet" href="themes/industrial.css">` ans Ende des `<head>` anfügen.

### Git-Branches
- `main` — Produktionszweig
- Feature-Branches nach Muster `claude/beschreibung-XXXXX`

---

## Schlüsselkennzahlen

| Kennzahl | Wert |
|---|---|
| HTML/CSS | `index.html` (~1.250 Zeilen, davon ~256 KB GEO_DATA) |
| JS-Module | 25 Dateien in `js/` (~250 Zeilen Durchschnitt) |
| JavaScript-Funktionen | 166+ |
| CSS-Klassen | 507 |
| Supabase-Tabellen | 15 |
| Datenbankoperationen | 132+ |
| Benutzerrollen | 4 |
| Externe Abhängigkeiten | 4 (Supabase JS, Leaflet, PDF.js, Google Fonts) |
| Build-Prozess | Keiner |
