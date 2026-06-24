# DISTILL ▲ GRAPH

A responsive, installable PWA that renders the [distill-it](https://github.com/derrick-ships/distill-it)
knowledge graph as a **monochrome star chart**.

33 engineering patterns, distilled from 6 open-source repositories, plotted as stars across
19 domain constellations. Tap a star to read its summary and jump to the study doc, build spec,
and origin repo.

## Design

Built to the SpaceX-inspired brief in `DESIGN-spacex.md`: pure black canvas, white uppercase
D-DIN display type, zero accent color. The graph itself is the "full-bleed photography" —
brighter stars are more connected; constellations light up on demand via the domain rail.

## Stack

Vanilla HTML/CSS/JS + D3 v7 (vendored locally). No build step. Deploys as a static site.

- `index.html` — app shell
- `styles.css` — design tokens + layout
- `app.js` — star-map engine (force layout, selection, search, index view)
- `graph.json` — the data (mirrored from distill-it)
- `sw.js` + `manifest.webmanifest` — offline-capable, installable PWA

## Run locally

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed URL.

## Data

Source of truth lives in [distill-it](https://github.com/derrick-ships/distill-it).
To refresh, copy `graph/graph.json` over `graph.json` here and redeploy.

---

*Built with Claude Code.*
