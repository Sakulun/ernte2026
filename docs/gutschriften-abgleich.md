GUTSCHRIFTEN-ABGLEICH ERNTE-APP (Anweisung von Lukas, 26.11.2026)

Zusätzlicher Schritt für jede gelesene PDF, BEVOR sie abgelegt wird (nach "2. Lesen", vor "3. Zielordner und Dateinamen bestimmen"). Die Ablage (Zielordner, Dateiname, _zu_loeschen.txt, Protokoll) bleibt unverändert – nur die abgelegte Datei ist die PDF mit Prüfvermerk (Schritt 6b). Supabase-Projekt: fijfxmjtoexpuxxjqqbf (Supabase-Connector, execute_sql).
Diese Datei (_gutschriften_abgleich.md) sowie _pruefvermerk.js und _pdf-lib.min.js im Hauptordner sind Werkzeuge, keine Belege: nie ändern, verschieben oder löschen. Quelle: ernteneu/docs/gutschriften-abgleich.md.

WANN: Der Beleg ist eine Gutschrift, Qualitätsabrechnung oder Frachtabrechnung eines HÄNDLERS über Getreide/Raps/Mais etc., das wir verkauft haben (Self-Billing), und der Absender steht in der App als Kontakt mit Verkaufskontrakt:
  select k.id, k.name, k.ust_id from kontakte k where exists (select 1 from kontrakte c where c.kontakt_id = k.id and coalesce(c.richtung,'verkauf') = 'verkauf');
Händler über USt-IdNr. oder Namen zuordnen (z. B. "Cargill GmbH" → Cargill GmbH Salzgitter bzw. Riesa, je nach Kontrakt). Nicht gemeint: Strom-/Biogas-Gutschriften (SKVE, BayWa r.e., Einspeisung), Vieh (Schmäing), Gutschriften für Einkäufe. Im Zweifel: kein Abgleich, nur wie bisher ablegen.

Bisher bekannte Self-Billing-Händler: Cargill (Salzgitter/Riesa), Saalemühle Alsleben, P. Krücken Organic, BAT Agrar. Bei AFG, Bio Eichenmühle, Röblingen, Vogtland, Wiesbauer schreiben WIR die Rechnung – deren Eingänge sind keine Gutschriften (dort steht in gutschrift_nr unsere eigene RE-Nr.; nie überschreiben).

ART: 'gutschrift' (Gutschrift/Rechnung über die Ware) · 'quali' (Qualitätsabrechnung, z. B. Cargill Raps Ölgehalt) · 'fracht' (Frachtabrechnung zu unseren Auslieferungen). Feld an der Fuhre: gutschrift_nr / quali_nr / fracht_nr.
  Cargill-Sonderfall (heißt immer "Qualitätsabrechnung", maßgeblich ist der Inhalt):
  - PDF für die App (Anweisung von Lukas, 27.11.2026): immer die echte Gutschrift "Cargill Gutschrift_<nr>_<datum>_….pdf" hochladen, NIE ein "Quality Statement"/eine Qualitätsabrechnung als Beleg-PDF. Ist ein Beleg schon mit einer Qualitätsabrechnung als PDF erfasst und kommt die echte Gutschrift nach: neues Token holen (Schritt 7) und die echte Gutschrift hochladen (ersetzt die PDF).
  - Art P = Duplikat der Waren-Gutschrift gleicher Nummer → kein eigener Beleg; ist die Gutschrift schon erfasst: nur "Abgleich: Duplikat zu GS <nr>" protokollieren; sonst wie die Gutschrift (art 'gutschrift') behandeln, als PDF aber erst die echte Gutschrift verwenden, sobald sie da ist.
  - Art F mit "Vorhergehende Abrechnung" > 0 → art 'quali', Nummer = die Nr. hinter "Gutschrift:" auf diesem Beleg.
  - Art F mit "Vorhergehende Abrechnung" = 0 → art 'gutschrift'.
  - Cargill-Quali-Beträge sind normalerweise Zuschläge (Ölbonus) = keine Abweichung. Zeilenbezeichnung und Betrag im PDF-Layout (pdftotext -layout) sorgfältig zuordnen; bei Unklarheit nicht als Abzug werten, sondern als Abweichung "Qualitätszeile nicht eindeutig lesbar".

SCHON VERARBEITET? select id from eingangsbelege where kontakt_id = <id> and art = '<art>' and nummer = '<nr>'; → vorhanden: nichts tun, im Protokoll "Abgleich: bereits erfasst".

1. KONTRAKT finden: Kontraktnummer auf dem Beleg (z. B. "2100416530/10" → 2100416530) gegen kontrakte.nummer (Vergleich ohne Leerzeichen, Präfix-/Suffix-tolerant), nur Verkaufskontrakte dieses Kontakts. Keine Kontraktnr. auf dem Beleg → alle Verkaufskontrakte des Kontakts mit passender Frucht als Kandidaten.

2. FUHREN-KANDIDATEN (Auslieferungen):
  select w.id, w.lieferschein_nr, (w.erstellt_am at time zone 'Europe/Berlin')::date as datum, w.kennzeichen, w.menge_kg,
         w.gutschrift_nr, w.quali_nr, w.fracht_nr, w.klaeren, w.bemerkung, w.kontrakt_id, c.nummer, c.preis_eur
  from warenbewegungen w join kontrakte c on c.id = w.kontrakt_id where w.kontrakt_id in (<kontrakt_ids>) order by w.erstellt_am;

3. JEDE POSITION einer Fuhre zuordnen – in STUFEN. Jede Stufe läuft erst über ALLE noch offenen Positionen des Belegs, bevor die nächste Stufe beginnt; jede Fuhre wird pro Beleg nur einmal vergeben.
  Begriffe:
  - Kennzeichen normalisieren: Großbuchstaben, nur A–Z und 0–9 ("SK-RV 334" → SKRV334). Beleg-Kennzeichen sind oft mehrere ("Per: SKRV334/SKV370" = Zugmaschine/Hänger) oder zusammengeschrieben ("GDA75383ZLO101A"). Treffer, wenn ein normalisiertes DB-Kennzeichen einem Beleg-Kennzeichen gleicht ODER als Teil darin vorkommt (z. B. ZLO101A in GDA75383ZLO101A). Ein DB-Kennzeichen ohne Ziffern (z. B. "ASL JG") oder leer gilt als KEIN Kennzeichen.
  - Datum: Lieferdatum des Belegs innerhalb ±1 Tag von w.datum (Händler buchen oft auf den Ankunftstag).
  - Gewicht: Beleg-Menge in kg gegen w.menge_kg. Maßgeblich ist das ANLIEFER-/Nettogewicht VOR Besatz-/Feuchte-Abzug (Saalemühle: "Anliefergewicht", nicht "Abrechnungsgewicht").
  Stufen:
  S1) Lieferschein-Nr. auf dem Beleg = w.lieferschein_nr (unsere Nr.; Ladeschein-/Wiegeschein-Nr. des Händlers zählen NICHT).
  S2) Kennzeichen-Treffer + Datum + Gewicht ≤ 40 kg.
  S3) Datum + Gewicht ≤ 40 kg (Kennzeichen abweichend, Tippfehler oder fehlend) → zuordnen, aber Hinweis in positionen ("Kennzeichen Beleg SKRV248 ≠ App SK-RV 348"), KEINE Abweichung.
  S4) Kennzeichen-Treffer + Datum + Gewicht ≤ 500 kg.
  S5) Datum + Gewicht ≤ 200 kg.
  Mehrere Kandidaten in einer Stufe → die Fuhre mit der geringsten Gewichtsdifferenz, bevorzugt eine, die für diese Art noch keine Nummer hat. Gleichstand → zuerst das genauere Datum (gleicher Tag vor ±1 Tag), dann die Fuhre, die schon genau diese Nummer trägt; bleibt es gleich → nicht zuordnen.
  Differenz > 1 t → NIE zuordnen.
  Teillieferung: Mehrere Positionen gleichen Lieferdatums, die einzeln nicht passen, deren Summe aber innerhalb ±200 kg einer Fuhre (Kennzeichen-Treffer oder einzige Fuhre des Tages) liegt → gemeinsam dieser Fuhre zuordnen (Hinweis "Teillieferung"), Gewichtsprüfung gegen die Summe. Sonst nicht zuordnen.
  Kein Treffer → Position "nicht zugeordnet" (Abweichung), NICHTS raten.

4. PRÜFEN je zugeordneter Position (nur das ist eine Abweichung):
  - Gewicht: |Anliefergewicht in kg − w.menge_kg| > 40 kg (Besatz-/Feuchte-Abzug in kg ist ein Abzug, keine Gewichtsabweichung) → "Gewicht: Gutschrift 28,400 t, Waage 28,330 t (+70 kg)".
  - Preis: Positionspreis ≠ Kontraktpreis c.preis_eur (Toleranz 0,01 €/t) → "Preis: 520,00 €/t statt Kontrakt 528,00 €/t". Kontraktpreis leer → "Preis: Kontrakt ohne Preis, Gutschrift 528,00 €/t".
  - VEREINBARTE KONDITIONEN zählen NICHT als Abweichung: Vorher den Kontrakttext lesen (select pdf_text, notiz from kontrakte where id in (<kontrakt_ids>)). Steht dort ausdrücklich eine Preisstaffel (z. B. Saalemühle: Rohprotein-Stufen mit "Preis in €/t 205 / 215 / 225") oder ein Abschlag mit Höhe (z. B. "Frachtabschlag €/t 7", "Feuchte % Abzug ab 14,6", "Besatz lt. Tabelle"), dann gilt:
      · Preis = die Staffelstufe, die zur auf dem Beleg ausgewiesenen Qualität (z. B. Protein) passt → keine Abweichung. Passt die Stufe nicht zur Qualität → Abweichung "Preis 215 €/t, laut Staffel bei Protein 12,6 % aber 225 €/t".
      · Abzug genau in vereinbarter Höhe (Fracht 7 €/t) bzw. nach vereinbarter Regel (Feuchteabzug nur über 14,6 %; Besatz "lt. Tabelle" bei ausgewiesenem Besatz) → keine Abweichung, nur in positionen/abzuege speichern.
      · Alles, was im Kontrakttext nicht ausdrücklich steht (z. B. hl-Abzug ohne Regel im Kontrakt), oder abweicht → Abweichung.
    Kontrakt ohne Text und ohne Preis → Preis-Abweichung wie unten.
  - Abzüge: jede (nicht vereinbarte, s. o.) Abzugs-/Kostenzeile (Feuchte, Besatz, Bruchkorn, Qualität, Trocknung, Reinigung, Fracht, Lagergeld, Gebühren, Umlagen, Analysen …) mit Betrag → "Abzug: Feuchte 15,2 % −84,30 €". Zuschläge (positiv, z. B. Ölbonus) sind KEINE Abweichung, nur in positionen speichern.
  - Bereits abgerechnet: Fuhre hat im Feld dieser Art schon eine ANDERE Nummer → "bereits auf <alt> abgerechnet", Feld NICHT überschreiben.
  Je Beleg zusätzlich: Summe der Positionen ≠ Netto (±0,05 €), USt ≠ Netto × Satz (±0,05 €) oder unplausibler Satz (Getreide/Raps i. d. R. 7 %, bei Pauschalierung anders – nur melden, wenn rechnerisch falsch) → Abweichung auf Belegebene.

5. SCHREIBEN (je zugeordneter Position, nur wenn das Feld leer ist oder schon dieselbe Nummer trägt):
  update warenbewegungen set <feld> = '<nr>' where id = <w.id> and coalesce(<feld>,'') in ('', '<nr>');
  Bei Abweichungen dieser Fuhre zusätzlich:
  update warenbewegungen set klaeren = true,
    bemerkung = concat_ws(' | ', nullif(bemerkung,''), '[Auto <GS|QA|FA> <nr>] <Abweichungstexte; getrennt>')
  where id = <w.id>;
  Fuhren ohne Abweichung: klaeren und bemerkung NICHT anfassen.

6. BELEG ERFASSEN:
  insert into eingangsbelege (art, nummer, kontakt_id, kontrakt_ids, datum, menge_t, netto, ust, brutto,
    positionen, abzuege, abweichungen, status, quelle_datei, ablage_datei)
  values (...) on conflict (kontakt_id, art, nummer) do nothing returning id, upload_token;
  positionen = JSON-Array je Position: {"pos":1,"kontrakt_nr":"2100416530","referenz":"2000049364/2000191042/2027","lieferdatum":"2026-10-13","kennzeichen":"SKRV334/SKV370","lieferschein_nr":null,"menge_t":28.4,"preis":528,"betrag":14995.2,"warenbewegung_id":233,"waage_t":28.38,"diff_kg":20,"abweichungen":[]}
  (nicht zugeordnet: warenbewegung_id null). abzuege = [{"text":"…","betrag":-84.3}] für Zeilen auf Belegebene. abweichungen = alle Abweichungstexte des Belegs (leer = alles passt).
  status: 'unzugeordnet' wenn mind. eine Position ohne Fuhre, sonst 'abweichung' wenn abweichungen nicht leer, sonst 'ok'.
  Alle Strings in SQL korrekt escapen (' → '').

6b. PRÜFVERMERK AUF DIE PDF (Anweisung von Lukas, 26.11.2026): Bevor die PDF in den Zielordner (Rechnungseingang bzw. bei Qualitätsabrechnungen "Keine Rechnung") geschrieben wird, oben rechts auf Seite 1 einen Prüfvermerk als PDF-Kommentar setzen – so sieht man ihn auch in DATEV. Der Seiteninhalt bleibt unverändert.
  Werkzeug: _pruefvermerk.js und _pdf-lib.min.js im Hauptordner (beide mit device_stage_files in die Sandbox holen, NIE ändern oder löschen; sie sind keine Belege). Aufruf in der Sandbox (beide Dateien im selben Ordner):
    node _pruefvermerk.js <eingang.pdf> <ausgang.pdf> <vermerk.json>
  vermerk.json: {"status":"ok|abweichung|unzugeordnet","zusammenfassung":"2 von 2 Fuhren zugeordnet (Kontrakt 2100416530)","abweichungen":["LS 26211 SK-RV 334: Gewicht Gutschrift 28,400 t, Waage 28,330 t (+70 kg)", ...]}
  Abweichungstexte kurz und mit LS-Nr./Kennzeichen, damit man die Fuhre findet. Status ok → grüner Kasten "Geprüft Ernte-App <Datum> · OK - keine Abweichung"; sonst gelber Kasten "BITTE PRÜFEN" mit den Abweichungen.
  Die Ausgabedatei mit Vermerk ist die Datei, die abgelegt (Größenprüfung gegen diese Datei) UND in Schritt 7 hochgeladen wird. Bei Lieferschein-Zusammenfügung den Vermerk auf die zusammengefügte PDF setzen.
  Scheitert das Skript (kein node, Fehlermeldung): Original ohne Vermerk ablegen, im Protokoll "⚠️ Prüfvermerk fehlt (<Grund>)" vermerken und in der Tages-E-Mail nennen.

7. PDF HOCHLADEN (die PDF mit Prüfvermerk aus 6b):
  curl -sS -X POST --data-binary @"<pfad.pdf>" -H 'Content-Type: application/pdf' "https://fijfxmjtoexpuxxjqqbf.supabase.co/functions/v1/eingangsbeleg-upload?id=<id>&token=<upload_token>"
  Antwort {"ok":true,...} = fertig. Fehler → einmal neues Token holen (update eingangsbelege set upload_token = gen_random_uuid(), upload_bis = now() + interval '2 hours' where id = <id> returning upload_token;) und erneut versuchen; scheitert es wieder, im Protokoll "⚠️ PDF-Upload fehlgeschlagen" vermerken (Beleg bleibt ohne PDF).

8. PROTOKOLL: am Beleg-Eintrag in _Protokoll.txt "Abgleich: <n> Fuhren zugeordnet, <m> Abweichungen[, <k> nicht zugeordnet]" ergänzen.

TAGES-E-MAIL: eigener Abschnitt "Gutschriften-Abgleich Ernte-App" direkt nach "Braucht Aufmerksamkeit": je verarbeitetem Beleg Händler, Art, Nummer, Anzahl zugeordneter Fuhren, Status; Abweichungen einzeln mit Lieferschein-Nr., Kennzeichen und Text. Belege ohne Abweichung nur als eine Zeile. Abweichungen und nicht zugeordnete Positionen zusätzlich in der Push-Nachricht nennen.

Im Zweifel (Händler, Kontrakt oder Fuhre nicht eindeutig): nicht zuordnen, als Abweichung erfassen statt raten.
