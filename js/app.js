// Entry Point – importiert alle Module und registriert Funktionen auf window für onclick-Handler

// ─── Foundation ───
import { SB_URL, SB_KEY, LOGO_DATA_URL, FIRMA_NAME, FIRMA_GF, FIRMA_HRB, FIRMA_STNR, FIRMA_UST,
         FIRMA_BANK1, FIRMA_IBAN1, FIRMA_BIC1, FIRMA_BANK2, FIRMA_IBAN2, FIRMA_BIC2 } from './config.js?v=134';
import { db, sb, getSb, initSupabase } from './db.js?v=134';
import { state, bootApp, showLoader, hideLoader } from './state.js?v=134';
import { getFeld, getSorte, getUser, netto, kg2t, fmtTime, fmtDate,
         abfahrerIstFrei, showToast, roleLabel, escapeHtml,
         hashPW, hashPWLegacy, navigiereZuSchlag } from './helpers.js?v=134';

// ─── Domain ───
import { BIO_BETRIEBE, isBioBetrieb, isBioFeld, isBioFuhre, getSiloBioStatus, bioBadge } from './bio.js?v=134';
import { getFruchtFarbe } from './frucht.js?v=134';
import { getQualitaetsfelder, qualitaetsFehlende, feuchteGrenzwert, feuchteZuHoch } from './quality.js?v=134';

// ─── Auth & Routing ───
import { renderLogin, selectLoginUser, loginBack, togglePw, doLogin, loginUser, logout } from './login.js?v=134';
import { renderMain } from './router.js?v=134';

// ─── Dashboards ───
import { renderDrescher, drescherFeldWahl, drescherSorteWahl, drescherZuweisen, setDTab, dTab } from './drescher.js?v=134';
import { renderAbfahrer, fmtGewicht, updNetto, fuhreSpeichern, parseGewicht,
         highlightSchlagNav, filterSchlagNav, aTab, setATab, setAbfFertigTab,
         getVermehrungenForFeld, isVermehrungsFuhre, getFuhreKulturKey } from './abfahrer.js?v=134';
import { renderAdmin, setAdminTab, toggleSidebar, adminTab, sidebarCollapsed } from './admin.js?v=134';

// ─── Admin Detail-Module ───
import { renderAdminDash } from './admin-dash.js?v=134';
import { toggleFahrerDetail } from './admin-fahrer.js?v=134';
import { renderAdminFuhren, toggleFuhreEdit, saveFuhreEdit, verifiziereFuhre, deleteFuhre,
         adminAbschliessen, adminFuhreAbschliessenSpeichern, setLieferungQuelle, toggleLieferungen,
         setFuhrenFilter, fuhrenFilterZuruecksetzen, exportGefilterteFuhrenCSV, exportGefilterteFuhrenExcel } from './admin-fuhren.js?v=134';
import { renderAdminSchlaege, schlagSetStatus, schlagSearchInput, setSchlagFilter } from './admin-schlaege.js?v=134';
import { renderAdminKarte, schlagColor, getDriverIcon, requestWakeLock, releaseWakeLock,
         shareUserGPS, refreshMapColors } from './admin-karte.js?v=134';
import { renderAdminNutzer, nutzerAnlegen, nutzerEditStart, nutzerSpeichern, nutzerLoeschen, alleAbmelden } from './admin-nutzer.js?v=134';
import { renderAdminFortschritt, toggleFortschritt, toggleFortschrittSchlag } from './admin-fortschritt.js?v=134';
import { renderAdminVermehrungen, toggleVermehrung } from './admin-vermehrungen.js?v=134';
import { renderAdminLager, toggleLagerDetail } from './admin-lager.js?v=134';
import { renderWaageErfassungInto, weFeldWahl, weSorteWahl, weFruchtartWahl, weAbschliessen, weStarten,
         weSetHerkunft, weSetZukaufTyp, weDuengerSpeichern, weKontraktWahl, weKontraktAbschliessen,
         weInUmlauf, renderUmlaufEingangAbschluss, weUmlaufNetto, weUmlaufAbschliessen, weUmlaufAktualisieren,
         openWaageErfassung, closeWaageErfassung, erfassungInProgress,
         openHaengerzugWahl, closeHaengerzugWahl, waehleHaengerzug,
         hzEditStart, hzSpeichern, hzLoeschen } from './waage-erfassung.js?v=134';
import { renderAdminZukauf, deleteFremdzukauf } from './admin-zukauf.js?v=134';
import { renderWaage, renderWaageTab, setWaageModus, setAusgangView, waAusgangKundeWahl, waAusgangKontraktWahl,
         waAusgangLagerWahl, waZwischenspeichern, waUmlaufOeffnen, waNetto,
         waUmlaufStornieren, waUmlaufAktualisieren, waAbschliessen, waUmlaufListe } from './waage.js?v=134';
import { lieferscheinDialog, closeLieferscheinDialog, lieferscheinDialogDrucken,
         lieferscheinDrucken, lieferscheinDaten } from './lieferschein-druck.js?v=134';

// ─── Features ───
import { renderSiloManagement, openSiloDetail, closeSiloDetail, removeFuhreFromSilo,
         renderSilomeister, showSiloOverlay, hideSiloOverlay,
         getSiloFill, getSiloAusgang, getSiloBestand, getSiloKultur,
         toggleFuhreSelection, selectAllFuhren, einlagernDialog, einlagernSpeichern,
         setSiloView, lagerLabel, naechstesLager, standortText,
         reinigenDialog, reinigenSpeichern, saatgutVerkaufDialog, saatgutVerkaufSpeichern } from './silo.js?v=134';
import { renderWarenausgang, warenausgangsDialog, wareneingangsDialog, wbSiloInfo, wbKontraktWahl,
         wbSpeichern, auslagernDialog, deleteWarenbewegung, wbEditToggle, wbEditSpeichern, waageWidgetHTML, updateWaageWidget,
         renderWaageBar, gewichtUebernehmen, waageFuhreWidgetHTML, waageLiveBannerHTML,
         neueLieferungDialog, lieferungKontraktWahl, lieferungSpeichern,
         lieferungAbschliessen, lieferungAbschliessenSpeichern } from './waren.js?v=134';
import { startWaageBildschirm, stopWaageBildschirm, waageBildDatei, waageOcrPanelHTML, aktualisierePanel } from './waage-ocr.js?v=134';
import { renderArtikel, artikelNeuDialog, artikelEditDialog, artikelSpeichern, artikelToggleAktiv } from './artikel.js?v=134';
import { renderKontakte, kontaktNeuDialog, kontaktEditDialog, kontaktSpeichern, kontaktToggleAktiv, lieferantFuhrenToggle, zukaufKonfigDialog, zukaufKonfigSpeichern } from './kontakte.js?v=134';
import { renderKontrakte, kontraktNeuDialog, kontraktBearbeiten, kontraktSpeichern, kontraktStatus,
         kontraktPDFDrop, kontraktPDFDatei, getKontraktGeliefertKg,
         toggleKontraktDetail, kontraktFuhreFeld, kontraktLoeschen, kontraktAbfahrerFrei,
         setKontraktFilter, kontraktSucheInput, kontraktFilterReset, setKontraktRichtung } from './kontrakte.js?v=134';
import { showNachrichtenDialog, adminSendNachricht, initNachrichtenListener,
         showNachrichtBanner, requestBrowserNotification } from './nachrichten.js?v=134';
import { showOnboarding, obNext, obPrev, closeOnboarding, checkShowOnboarding } from './onboarding.js?v=134';
import { renderNeuesErntejahr, erntejahrDownloadCSV, erntejahrExcelImport, erntejahrKMLImport, erntejahrSkipKML } from './erntejahr.js?v=134';
import { exportTagesbericht, exportCSV, exportCSVSeitLetztem, exportCSVZeitraum, exportExcelAuswertung, exportSiloCSV, lieferungPDF, exportKontrakteExcel, exportMengenuebersichtExcel, exportFremdzukaufExcel } from './export.js?v=134';

// ─── Fruchtfolgemanagement (nur Admin) ───
import { renderFruchtfolge, ffSetView, ffToggleBetrieb, ffSetLeitjahr, ffSetKulturgruppeFilter } from './fruchtfolge.js?v=134';
import { renderFFImport, ffImportDateien, ffPaketBetrieb, ffPaketEntfernen, ffNcQuickAdd, ffPaketUebernehmen } from './ff-import.js?v=134';
import { renderFFKarte, ffKarteJahr, ffKarteKulturToggle, ffKarteKulturSetzen } from './ff-karte.js?v=134';
import { renderFFMatrix, ffMatrixGruppeToggle, ffMatrixZelleEdit, ffMatrixZelleAbbruch, ffMatrixKulturSetzen } from './ff-matrix.js?v=134';
import { renderFFTabelle, ffTabJahr, ffTabSort, ffTabSuche, ffTabAuswahl, ffTabAlle,
         ffTabKultur, ffTabSorte, ffTabZwischenfrucht, ffTabMassenKultur, ffTabMassenZf } from './ff-tabelle.js?v=134';
import { renderFFDashboard, ffDashJahr, ffDashEbene, ffDashVergleich, ffDashCSV } from './ff-dash.js?v=134';
import { renderFFFlags, ffFlagFilter, ffFlagSort, ffFlagAkzeptieren, ffFlagOeffnen,
         ffFlagsNeuBerechnen, ffFlagZuParzelle, ffFlagsCSV } from './ff-flags.js?v=134';
import { renderFFPlan, ffPlanAnlegen, ffPlanLoeschen, ffPlanNeuAufbauen } from './ff-plan.js?v=134';
import { renderFFStammdaten, ffStammBereich, ffKulturFeld, ffKulturAnlegen, ffKulturLoeschen,
         ffGruppeFeld, ffGruppeAnlegen, ffGruppeLoeschen, ffNcFeld, ffNcAnlegen, ffNcLoeschen,
         ffBetriebFeld } from './ff-stammdaten.js?v=134';

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
  highlightSchlagNav, filterSchlagNav, setATab, setAbfFertigTab,
  getVermehrungenForFeld, isVermehrungsFuhre, getFuhreKulturKey,
  get aTab() { return aTab; },

  // Admin
  renderAdmin, setAdminTab, toggleSidebar,
  get adminTab() { return adminTab; },
  get sidebarCollapsed() { return sidebarCollapsed; },

  // Admin detail
  renderAdminDash, toggleFahrerDetail,
  renderAdminFuhren, toggleFuhreEdit, saveFuhreEdit, verifiziereFuhre, deleteFuhre,
  adminAbschliessen, adminFuhreAbschliessenSpeichern, setLieferungQuelle, toggleLieferungen,
  setFuhrenFilter, fuhrenFilterZuruecksetzen, exportGefilterteFuhrenCSV, exportGefilterteFuhrenExcel,
  renderAdminSchlaege, schlagSetStatus, schlagSearchInput, setSchlagFilter,
  renderWaageErfassungInto, weFeldWahl, weSorteWahl, weFruchtartWahl, weAbschliessen, weStarten,
  weSetHerkunft, weSetZukaufTyp, weDuengerSpeichern, weKontraktWahl, weKontraktAbschliessen, renderAdminZukauf, deleteFremdzukauf,
  weInUmlauf, renderUmlaufEingangAbschluss, weUmlaufNetto, weUmlaufAbschliessen, weUmlaufAktualisieren,
  openWaageErfassung, closeWaageErfassung, erfassungInProgress,
  renderWaage, renderWaageTab, setWaageModus, setAusgangView, waAusgangKundeWahl, waAusgangKontraktWahl, waAusgangLagerWahl,
  waZwischenspeichern, waUmlaufOeffnen, waNetto, waUmlaufStornieren, waUmlaufAktualisieren, waAbschliessen, waUmlaufListe,
  lieferscheinDialog, closeLieferscheinDialog, lieferscheinDialogDrucken, lieferscheinDrucken, lieferscheinDaten,
  openHaengerzugWahl, closeHaengerzugWahl, waehleHaengerzug, hzEditStart, hzSpeichern, hzLoeschen,
  renderAdminKarte, schlagColor, getDriverIcon, requestWakeLock, releaseWakeLock,
  shareUserGPS, refreshMapColors,
  renderAdminNutzer, nutzerAnlegen, nutzerEditStart, nutzerSpeichern, nutzerLoeschen, alleAbmelden,
  renderAdminFortschritt, toggleFortschritt, toggleFortschrittSchlag,
  renderAdminVermehrungen, toggleVermehrung,
  renderAdminLager, toggleLagerDetail,

  // Silo
  renderSiloManagement, openSiloDetail, closeSiloDetail, removeFuhreFromSilo,
  renderSilomeister, showSiloOverlay, hideSiloOverlay,
  getSiloFill, getSiloAusgang, getSiloBestand, getSiloKultur,
  toggleFuhreSelection, selectAllFuhren, einlagernDialog, einlagernSpeichern, setSiloView, lagerLabel, naechstesLager, standortText,
  reinigenDialog, reinigenSpeichern, saatgutVerkaufDialog, saatgutVerkaufSpeichern,

  // Waren
  renderWarenausgang, warenausgangsDialog, wareneingangsDialog, wbSiloInfo, wbKontraktWahl,
  wbSpeichern, auslagernDialog, deleteWarenbewegung, wbEditToggle, wbEditSpeichern, waageWidgetHTML, updateWaageWidget,
  renderWaageBar, gewichtUebernehmen, waageFuhreWidgetHTML, waageLiveBannerHTML,
  neueLieferungDialog, lieferungKontraktWahl, lieferungSpeichern,
  lieferungAbschliessen, lieferungAbschliessenSpeichern,
  startWaageBildschirm, stopWaageBildschirm, waageBildDatei, waageOcrPanelHTML, aktualisierePanel,

  // Artikel / Kontakte
  renderArtikel, artikelNeuDialog, artikelEditDialog, artikelSpeichern, artikelToggleAktiv,
  renderKontakte, kontaktNeuDialog, kontaktEditDialog, kontaktSpeichern, kontaktToggleAktiv, lieferantFuhrenToggle, zukaufKonfigDialog, zukaufKonfigSpeichern,

  // Kontrakte
  renderKontrakte, kontraktNeuDialog, kontraktBearbeiten, kontraktSpeichern, kontraktStatus,
  kontraktPDFDrop, kontraktPDFDatei, getKontraktGeliefertKg,
  toggleKontraktDetail, kontraktFuhreFeld, kontraktLoeschen, kontraktAbfahrerFrei,
  setKontraktFilter, kontraktSucheInput, kontraktFilterReset, setKontraktRichtung,


  // Nachrichten
  showNachrichtenDialog, adminSendNachricht, initNachrichtenListener,
  showNachrichtBanner, requestBrowserNotification,

  // Onboarding
  showOnboarding, obNext, obPrev, closeOnboarding, checkShowOnboarding,

  // Erntejahr
  renderNeuesErntejahr, erntejahrDownloadCSV, erntejahrExcelImport, erntejahrKMLImport, erntejahrSkipKML,

  // Export
  exportTagesbericht, exportCSV, exportCSVSeitLetztem, exportCSVZeitraum, exportExcelAuswertung, exportSiloCSV, lieferungPDF,
  exportKontrakteExcel, exportMengenuebersichtExcel, exportFremdzukaufExcel,

  // Fruchtfolge
  renderFruchtfolge, ffSetView, ffToggleBetrieb, ffSetLeitjahr, ffSetKulturgruppeFilter,
  renderFFImport, ffImportDateien, ffPaketBetrieb, ffPaketEntfernen, ffNcQuickAdd, ffPaketUebernehmen,
  renderFFKarte, ffKarteJahr, ffKarteKulturToggle, ffKarteKulturSetzen,
  renderFFMatrix, ffMatrixGruppeToggle, ffMatrixZelleEdit, ffMatrixZelleAbbruch, ffMatrixKulturSetzen,
  renderFFTabelle, ffTabJahr, ffTabSort, ffTabSuche, ffTabAuswahl, ffTabAlle,
  ffTabKultur, ffTabSorte, ffTabZwischenfrucht, ffTabMassenKultur, ffTabMassenZf,
  renderFFDashboard, ffDashJahr, ffDashEbene, ffDashVergleich, ffDashCSV,
  renderFFFlags, ffFlagFilter, ffFlagSort, ffFlagAkzeptieren, ffFlagOeffnen,
  ffFlagsNeuBerechnen, ffFlagZuParzelle, ffFlagsCSV,
  renderFFPlan, ffPlanAnlegen, ffPlanLoeschen, ffPlanNeuAufbauen,
  renderFFStammdaten, ffStammBereich, ffKulturFeld, ffKulturAnlegen, ffKulturLoeschen,
  ffGruppeFeld, ffGruppeAnlegen, ffGruppeLoeschen, ffNcFeld, ffNcAnlegen, ffNcLoeschen,
  ffBetriebFeld,
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
