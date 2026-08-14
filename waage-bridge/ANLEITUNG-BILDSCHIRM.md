# Waage vom Bildschirm ablesen (Bitzer-Anzeige → App)

Die Waage ist per Netzwerk/IP nicht erreichbar, aber das **Bitzer-Tool** zeigt das
Gewicht auf dem Bildschirm des Waagen-PCs an. Dieses Tool liest den Zahlenwert
direkt vom Bildschirm ab (OCR) und schreibt ihn live nach Supabase. Die Ernte-App
zeigt ihn dann unter **„Waage"** an – mit **Übernehmen**-Knopf.

Läuft komplett auf dem Waagen-PC (der hat Internet). Kein Zugriff auf die Waage nötig.

---

## Einmalige Einrichtung

1. **Node.js** installieren (falls noch nicht vorhanden): https://nodejs.org (LTS).
2. Den Ordner `waage-bridge` auf den Waagen-PC kopieren.
3. `.env.example` kopieren und in **`.env`** umbenennen.
4. In `.env` den **`SUPABASE_KEY`** eintragen (Service-Role-Key aus dem Supabase-
   Dashboard → Settings → API). `SUPABASE_URL` ist schon richtig gesetzt.
5. Einmalig im Ordner ein Terminal öffnen und `npm install` ausführen
   (lädt die OCR-Bibliothek – braucht einmal Internet, danach offline nutzbar).

---

## Den richtigen Bildschirmausschnitt finden (Kalibrieren)

Das Tool muss wissen, **wo** auf dem Bildschirm die Gewichtszahl steht.

1. Das **Bitzer-Tool** öffnen, sodass die Gewichtszahl sichtbar ist.
2. Im `waage-bridge`-Ordner ausführen:

   ```
   node screen-ocr.js kalibrieren
   ```

   Das legt eine Datei **`bildschirm.png`** an (Vollbild-Screenshot) und listet die
   Bildschirme auf (bei mehreren Monitoren die passende Nummer in `.env` als
   `MONITOR=` eintragen).
3. `bildschirm.png` in **Paint** öffnen. Paint zeigt unten links die Pixel-Position
   der Maus.
   - Maus auf die **linke obere Ecke** der Gewichtszahl → das sind **`REGION_X`** und **`REGION_Y`**.
   - Maus auf die **rechte untere Ecke** der Zahl → Breite/Höhe berechnen:
     `REGION_W = x_rechts − REGION_X`, `REGION_H = y_unten − REGION_Y`.
   - Etwas Rand lassen, aber möglichst nur die Zahl (keine Beschriftung „kg" nebenan
     nötig – stört aber auch nicht).
4. Diese 4 Werte in `.env` eintragen.

---

## OCR testen (bis der Wert stimmt)

```
node screen-ocr.js test
```

Das erzeugt **`ausschnitt.png`** (genau der Bereich, den das Tool sieht) und gibt aus:

```
OCR-Rohtext:       "40.500"
Erkanntes Gewicht: 40.500 kg
```

- Zeigt `ausschnitt.png` **nur die Zahl** und stimmt der Wert? → fertig.
- Falsch/leer? → `REGION_*` nachjustieren und erneut `test`.
- Helle Schrift auf dunklem Grund? → `OCR_INVERTIEREN=ja`.
- Zahl zu klein/unscharf? → `OCR_SCALE=4`.
- Anzeige in Tonnen (z. B. „40,500")? → `ANZEIGE_EINHEIT=t` und `DEZIMALSTELLEN=3`.

---

## Live-Betrieb

Doppelklick auf **`Waage-Bildschirm.bat`** (oder `node screen-ocr.js`).
Das Fenster offen lassen – solange es läuft, steht das Gewicht live in der App.

In der App unter **„Waage"** erscheint oben die Live-Anzeige. Sobald der Wert
**stabil** ist (mehrere gleiche Messungen), wird der **Übernehmen**-Knopf aktiv und
trägt das Gewicht ins Voll-/Leergewicht ein.

> Tipp: Für Dauerbetrieb die `.bat` in den Autostart legen
> (`Win+R` → `shell:startup` → Verknüpfung hineinlegen).

---

## Stellschrauben (`.env`)

| Einstellung | Bedeutung |
|---|---|
| `REGION_X/Y/W/H` | Bildschirmausschnitt der Zahl (Pixel) |
| `MONITOR` | Bildschirm-Nr. bei mehreren Monitoren (leer = Standard) |
| `POLL_MS` | Takt in ms (1000 = jede Sekunde) |
| `OCR_SCALE` | Ausschnitt vergrößern vor OCR (2–4) |
| `ANZEIGE_EINHEIT` | `kg` oder `t` |
| `DEZIMALSTELLEN` | feste Nachkommastellen der Anzeige |
| `OCR_INVERTIEREN` | `ja` bei heller Schrift auf dunklem Grund |
| `STABIL_AB` | so viele gleiche Messungen = „stabil" |
| `STABIL_TOLERANZ_KG` | erlaubte Schwankung dafür |
| `OFFLINE_NACH` | Fehllesungen in Folge bis Status „offline" |

---

## Wenn möglich genauer: statt OCR direkt auslesen

OCR liest Pixel – meistens zuverlässig, aber nicht 100 %. Falls das Bitzer-Tool das
Gewicht irgendwo **als Text/Datei** bereitstellt (z. B. eine Log-/CSV-Datei, ein
Fenstertitel, eine serielle Schnittstelle), können wir das statt OCR anzapfen –
das wäre fehlerfrei. Wenn du herausfindest, ob Bitzer so etwas kann, sag Bescheid.
