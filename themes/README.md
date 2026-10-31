# Landgut Nuscheler — Themes

## Aktiv: Flächenverwaltung

`themes/flaechenverwaltung.css` übernimmt das Designkonzept des Nuscheler Pachtprogramms: Olivgrün als Hausfarbe,
helle Flächen mit feiner Linie statt Schatten, schmale Symbolleiste links, kompakte Bedienelemente. Die Datei wird
in `index.html` direkt nach dem Inline-`<style>` geladen und überschreibt nur.

## Zurück zum bisherigen Ernte-Design

In `index.html` diese Zeile entfernen:

```html
<link rel="stylesheet" href="themes/flaechenverwaltung.css?v=1">
```

Mehr ist nicht nötig: Das bisherige Design (grüne Sidebar, Emoji-Symbole, Karten mit Schatten) steht unverändert im
Inline-`<style>`. `js/admin.js` rendert beide Symbolarten, das CSS blendet jeweils eine aus. Optional in `index.html`
`<meta name="theme-color">` prüfen; dort steht weiterhin der bisherige Wert `#3d5a28`.

Eine Sicherung des Stands vor der Umstellung liegt in `themes/ernte-bisher/`.

## Ältere Themes (Stand März 2026)

`agrarmonitor.css`, `dark.css` und `industrial.css` sind Override-Blöcke aus der Zeit vor dem Token-System. Sie sind
nicht aktiv und nicht auf den aktuellen Stand gebracht; beim Einbinden wie oben per `<link>` austauschen und prüfen.
