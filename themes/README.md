# Ernte 2026 — Theme Switcher

Three saved themes are available. All are CSS override blocks designed to be appended inside the `<style>` tag in `index.html` (or linked as the last stylesheet).

---

## Available Themes

| Theme | File | Accent | Font | Feel |
|---|---|---|---|---|
| **Agrarmonitor** | `agrarmonitor.css` | Sage green `#6b8f4e` | System UI | Light, clean, professional |
| **Dark** | `dark.css` | Green `#0abc56` | Inter | Near-black, pill shapes, app-like |
| **Industrial** *(active)* | `industrial.css` | Amber `#c8962e` | IBM Plex Mono + Barlow | Dark, dense, raw agrarian |

---

## How to switch themes

### Method 1 — Inline (current approach)

The active theme CSS lives at the **bottom** of the `<style>` block in `index.html` (~line 618 onward). CSS cascade order means later rules win.

To switch:
1. Delete the current theme block (from `/* ══` or `/* ════` comment to just before `</style>`)
2. Paste the contents of the desired theme file in its place
3. Commit and push

### Method 2 — External stylesheet (cleaner)

Add a `<link>` tag as the **last** stylesheet in `<head>`, after all other styles:

```html
<!-- In <head>, after existing <style> or as last <link> -->
<link rel="stylesheet" href="themes/industrial.css">
```

Then swap the `href` to change themes. This requires the app to be served from a web server (not `file://`).

---

## Font dependencies

**Agrarmonitor** — no extra fonts needed (uses system font stack)

**Dark** — requires Inter:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

**Industrial** — requires IBM Plex Mono + Barlow Condensed + Barlow:
```html
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Barlow+Condensed:wght@400;500;600;700&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
```

The current `index.html` already has the Industrial fonts loaded.
