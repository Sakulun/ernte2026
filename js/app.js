// Entry Point – importiert alle Module und registriert Funktionen auf window für onclick-Handler

// ─── Foundation ───
import { SB_URL, SB_KEY, LOGO_DATA_URL, FIRMA_NAME, FIRMA_GF, FIRMA_HRB, FIRMA_STNR, FIRMA_UST,
         FIRMA_BANK1, FIRMA_IBAN1, FIRMA_BIC1, FIRMA_BANK2, FIRMA_IBAN2, FIRMA_BIC2 } from './config.js?v=56';
import { db, sb, getSb, initSupabase } from './db.js?v=56';
import { state, bootApp, showLoader, hideLoader } from './state.js?v=56';
import { getFeld, getSorte, getUser, netto, kg2t, fmtTime, fmtDate,
         abfahrerIstFrei, showToast, roleLabel, escapeHtml,
         hashPW, hashPWLegacy, navigiereZuSchlag } from './helpers.js?v=56';

// ─── Domain ───
import { BIO_BETRIEBE, isBioBetrieb, isBioFeld, isBioFuhre, getSiloBioStatus, bioBadge } from './bio.js?v=56';
import { getFruchtFarbe } from './frucht.js?v=56';
import { getQualitaetsfelder, qualitaetsFehlende, feuchteGrenzwert, feuchteZuHoch } from './quality.js?v=56';

// ─── Auth & Routing ───
import { renderLogin, selectLoginUser, loginBack, togglePw, doLogin, loginUser, logout } from './login.js?v=56';
import { renderMain } from './router.js?v=56';

// ─── Dashboards ───
import { renderDrescher, drescherFeldWahl, drescherSorteWahl, drescherZuweisen, setDTab, dTab } from './drescher.js?v=56';
import { renderAbfahrer, fmtGewicht, updNetto, fuhreSpeichern, parseGewicht,
         highlightSchlagNav, filterSchlagNav, aTab, setATab,
         getVermehrungenForFeld, isVermehrungsFuhre, getFuhreKulturKey } from './abfahrer.js?v=56';
import { renderAdmin, setAdminTab, toggleSidebar, adminTab, sidebarCollapsed } from './admin.js?v=56';

// ─── Admin Detail-Module ───
import { renderAdminDash } from './admin-dash.js?v=56';
import { renderAdminFuhren, toggleFuhreEdit, saveFuhreEdit, verifiziereFuhre, deleteFuhre,
         adminAbschliessen, adminFuhreAbschliessenSpeichern,
         setFuhrenFilter, fuhrenFilterZuruecksetzen, exportGefilterteFuhrenCSV, exportGefilterteFuhrenExcel } from './admin-fuhren.js?v=56';
import { renderAdminSchlaege, schlagSetStatus, schlagSearchInput, setSchlagFilter } from './admin-schlaege.js?v=56';
import { renderAdminKarte, schlagColor, getDriverIcon, requestWakeLock, releaseWakeLock,
         shareUserGPS, refreshMapColors } from './admin-karte.js?v=56';
import { renderAdminNutzer, nutzerAnlegen, nutzerEditStart, nutzerSpeichern, nutzerLoeschen } from './admin-nutzer.js?v=56';
import { renderAdminFortschritt, toggleFortschritt, toggleFortschrittSchlag } from './admin-fortschritt.js?v=56';
import { renderAdminVermehrungen, toggleVermehrung } from './admin-vermehrungen.js?v=56';
import { renderAdminLager, toggleLagerDetail } from './admin-lager.js?v=56';
import { renderWaageErfassungInto, weFeldWahl, weSorteWahl, weFruchtartWahl, weAbschliessen, weStarten,
         openWaageErfassung, closeWaageErfassung,
         openHaengerzugWahl, closeHaengerzugWahl, waehleHaengerzug,
         hzEditStart, hzSpeichern, hzLoeschen } from './waage-erfassung.js?v=56';
import { renderWaageTab, setWaageModus, setAusgangView, waAusgangKundeWahl, waAusgangKontraktWahl,
         waAusgangLagerWahl, waZwischenspeichern, waUmlaufOeffnen, waNetto,
         waUmlaufStornieren, waAbschliessen } from './waage.js?v=56';
import { lieferscheinDialog, closeLieferscheinDialog, lieferscheinDialogDrucken,
         lieferscheinDrucken, lieferscheinDaten } from './lieferschein-druck.js?v=56';

// ─── Features ───
import { renderSiloManagement, openSiloDetail, removeFuhreFromSilo,
         renderSilomeister, showSiloOverlay, hideSiloOverlay,
         getSiloFill, getSiloAusgang, getSiloBestand, getSiloKultur,
         toggleFuhreSelection, selectAllFuhren, einlagernDialog, einlagernSpeichern,
         setSiloView, lagerLabel, naechstesLager, standortText,
         reinigenDialog, reinigenSpeichern } from './silo.js?v=56';
import { renderWarenausgang, warenausgangsDialog, wareneingangsDialog, wbSiloInfo, wbKontraktWahl,
         wbSpeichern, auslagernDialog, deleteWarenbewegung, waageWidgetHTML, updateWaageWidget,
         renderWaageBar, gewichtUebernehmen, waageFuhreWidgetHTML,
         neueLieferungDialog, lieferungKontraktWahl, lieferungSpeichern,
         lieferungAbschliessen, lieferungAbschliessenSpeichern } from './waren.js?v=56';
import { renderArtikel, artikelNeuDialog, artikelEditDialog, artikelSpeichern, artikelToggleAktiv } from './artikel.js?v=56';
import { renderKontakte, kontaktNeuDialog, kontaktEditDialog, kontaktSpeichern, kontaktToggleAktiv, lieferantFuhrenToggle, zukaufKonfigDialog, zukaufKonfigSpeichern } from './kontakte.js?v=56';
import { renderKontrakte, kontraktNeuDialog, kontraktBearbeiten, kontraktSpeichern, kontraktStatus,
         kontraktPDFDrop, kontraktPDFDatei, getKontraktGeliefertKg } from './kontrakte.js?v=56';
import { showNachrichtenDialog, adminSendNachricht, initNachrichtenListener,
         showNachrichtBanner, requestBrowserNotification } from './nachrichten.js?v=56';
import { showOnboarding, obNext, obPrev, closeOnboarding, checkShowOnboarding } from './onboarding.js?v=56';
import { renderNeuesErntejahr, erntejahrDownloadCSV, erntejahrExcelImport, erntejahrKMLImport, erntejahrSkipKML } from './erntejahr.js?v=56';
import { exportTagesbericht, exportCSV, exportCSVSeitLetztem, exportCSVZeitraum, exportExcelAuswertung, exportSiloCSV, lieferungPDF } from './export.js?v=56';

// ─── Auf window registrieren für onclick-Handler ───
Object.assign(window, {
  // Config
  SB_URL, SB_KEY, LOGO_DATA_URL, FIRMA_NAME, FIRMA_GF, FIRMA_HRB, FIRMA_STNR, FIRMA_UST,
  FIRMA_BANK1, FIRMA_IBAN1, FIRMA_BIC1, FIRMA_BANK2, FIRMA_IBAN2, FIRMA_BIC2,

  // Foundation
  db, state, bootApp, showLoader, hideLoader,
  getFeld, getSorte, getUser, netto, kg2t, fmtTime, fmtDate,
  abfahrerIstFrei, showToast, roleLabel, escapeHtml,
  hashPW, hashPWLegacy, navigiereZuSchlag,

  // Domain
  BIO_BETRIEBE, isBioBetrieb, isBioFeld, isBioFuhre, getSiloBioStatus, bioBadge,
  getFruchtFarbe,
  getQualitaetsfelder, qualitaetsFehlende, feuchteGrenzwert, feuchteZuHoch,

  // Auth
  renderLogin, selectLoginUser, loginBack, togglePw, doLogin, loginUser, logout,
  renderMain,

  // Drescher
  renderDrescher, drescherFeldWahl, drescherSorteWahl, drescherZuweisen, setDTab,
  get dTab() { return dTab; },

  // Abfahrer
  renderAbfahrer, fmtGewicht, updNetto, fuhreSpeichern, parseGewicht,
  highlightSchlagNav, filterSchlagNav, setATab,
  getVermehrungenForFeld, isVermehrungsFuhre, getFuhreKulturKey,
  get aTab() { return aTab; },

  // Admin
  renderAdmin, setAdminTab, toggleSidebar,
  get adminTab() { return adminTab; },
  get sidebarCollapsed() { return sidebarCollapsed; },

  // Admin detail
  renderAdminDash,
  renderAdminFuhren, toggleFuhreEdit, saveFuhreEdit, verifiziereFuhre, deleteFuhre,
  adminAbschliessen, adminFuhreAbschliessenSpeichern,
  setFuhrenFilter, fuhrenFilterZuruecksetzen, exportGefilterteFuhrenCSV, exportGefilterteFuhrenExcel,
  renderAdminSchlaege, schlagSetStatus, schlagSearchInput, setSchlagFilter,
  renderWaageErfassungInto, weFeldWahl, weSorteWahl, weFruchtartWahl, weAbschliessen, weStarten, openWaageErfassung, closeWaageErfassung,
  renderWaageTab, setWaageModus, setAusgangView, waAusgangKundeWahl, waAusgangKontraktWahl, waAusgangLagerWahl,
  waZwischenspeichern, waUmlaufOeffnen, waNetto, waUmlaufStornieren, waAbschliessen,
  lieferscheinDialog, closeLieferscheinDialog, lieferscheinDialogDrucken, lieferscheinDrucken, lieferscheinDaten,
  openHaengerzugWahl, closeHaengerzugWahl, waehleHaengerzug, hzEditStart, hzSpeichern, hzLoeschen,
  renderAdminKarte, schlagColor, getDriverIcon, requestWakeLock, releaseWakeLock,
  shareUserGPS, refreshMapColors,
  renderAdminNutzer, nutzerAnlegen, nutzerEditStart, nutzerSpeichern, nutzerLoeschen,
  renderAdminFortschritt, toggleFortschritt, toggleFortschrittSchlag,
  renderAdminVermehrungen, toggleVermehrung,
  renderAdminLager, toggleLagerDetail,

  // Silo
  renderSiloManagement, openSiloDetail, removeFuhreFromSilo,
  renderSilomeister, showSiloOverlay, hideSiloOverlay,
  getSiloFill, getSiloAusgang, getSiloBestand, getSiloKultur,
  toggleFuhreSelection, selectAllFuhren, einlagernDialog, einlagernSpeichern, setSiloView, lagerLabel, naechstesLager, standortText,
  reinigenDialog, reinigenSpeichern,

  // Waren
  renderWarenausgang, warenausgangsDialog, wareneingangsDialog, wbSiloInfo, wbKontraktWahl,
  wbSpeichern, auslagernDialog, deleteWarenbewegung, waageWidgetHTML, updateWaageWidget,
  renderWaageBar, gewichtUebernehmen, waageFuhreWidgetHTML,
  neueLieferungDialog, lieferungKontraktWahl, lieferungSpeichern,
  lieferungAbschliessen, lieferungAbschliessenSpeichern,

  // Artikel / Kontakte
  renderArtikel, artikelNeuDialog, artikelEditDialog, artikelSpeichern, artikelToggleAktiv,
  renderKontakte, kontaktNeuDialog, kontaktEditDialog, kontaktSpeichern, kontaktToggleAktiv, lieferantFuhrenToggle, zukaufKonfigDialog, zukaufKonfigSpeichern,

  // Kontrakte
  renderKontrakte, kontraktNeuDialog, kontraktBearbeiten, kontraktSpeichern, kontraktStatus,
  kontraktPDFDrop, kontraktPDFDatei, getKontraktGeliefertKg,


  // Nachrichten
  showNachrichtenDialog, adminSendNachricht, initNachrichtenListener,
  showNachrichtBanner, requestBrowserNotification,

  // Onboarding
  showOnboarding, obNext, obPrev, closeOnboarding, checkShowOnboarding,

  // Erntejahr
  renderNeuesErntejahr, erntejahrDownloadCSV, erntejahrExcelImport, erntejahrKMLImport, erntejahrSkipKML,

  // Export
  exportTagesbericht, exportCSV, exportCSVSeitLetztem, exportCSVZeitraum, exportExcelAuswertung, exportSiloCSV, lieferungPDF,
});

Object.defineProperty(window, 'sb', { get() { return sb; }, configurable: true });

// ─── Visibility Change (wake lock re-acquire) ───
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible' && state.currentUser) {
    requestWakeLock();
  }
});

// ─── Boot ───
initSupabase();

// ─── Service Worker ───
if('serviceWorker' in navigator) {
  const swCode = `
    const CACHE = 'ernte2026-v1';
    self.addEventListener('install', e => {
      e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', location.href])));
      self.skipWaiting();
    });
    self.addEventListener('fetch', e => {
      e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
      );
    });
  `;
  const blob = new Blob([swCode], {type:'application/javascript'});
  const swUrl = URL.createObjectURL(blob);
  navigator.serviceWorker.register(swUrl).catch(()=>{});
}
