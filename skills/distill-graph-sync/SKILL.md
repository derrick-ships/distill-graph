---
name: distill-graph-sync
description: Use when a feature has been added to or changed in the distill-it knowledge graph (via /distill or by editing graph/graph.json) and that change needs to show up in the distill-graph PWA, the star-map visualization deployed at https://distill-graph.vercel.app (repo github.com/derrick-ships/distill-graph). Keeps the mirrored graph.json, the derived domains.json and llms.txt, the stats page, and the offline cache in sync, then redeploys. Triggers: "update distill-graph", "sync the graph PWA", "I added a feature to distill-it", "redeploy the star map", "update the stats page".
---

# Distill-Graph Sync

Keep the **distill-graph** PWA in sync with the **distill-it** knowledge graph after features
are added or changed, and redeploy, without breaking anything.

## Mental model (read this first)

`distill-graph` is a **static, zero-build PWA** that renders `distill-it/graph/graph.json`. It has
three surfaces, and all of them derive from the data at runtime or via one script:

1. **The map** (`/`) an interactive star chart. Computes everything from `graph.json` in the browser.
2. **The stats page** (`/stats`) a data story (backbone, foundations, coverage, sources, relationship
   mix, convergent pairs). Every figure is computed live from `graph.json`; nothing is hardcoded.
3. **`/llms.txt`** the machine-readable representation of the whole graph for AI agents and crawlers.
   Generated from the data by a script.

Adding a feature is almost always: copy `graph.json`, regenerate derived files, validate, deploy.
You rarely touch app code. One command does the first two steps.

## The data contract, graph.json

```jsonc
{
  "nodes": [{
    "id":      "domain/slug--from-repo",   // REQUIRED, unique
    "label":   "Human Title",              // REQUIRED  -> star + sheet title + index + stats + llms.txt
    "domain":  "domain-name",              // REQUIRED  -> constellation, filter, coverage, llms (any string)
    "repo":    "repo-name",                // REQUIRED  -> star color, sources chart, llms (any string)
    "summary": "1-3 sentences.",           // REQUIRED  -> sheet body + llms.txt (plain text; HTML escaped)
    "study":   "features/<domain>/study/<slug>.md",  // optional -> STUDY DOC link + llms.txt
    "build":   "features/<domain>/build/<slug>.md",  // optional -> BUILD SPEC link + llms.txt
    "source":  "https://github.com/owner/repo",      // optional -> ORIGIN REPO link + llms.txt
    "notebooklm": ""                                 // optional -> NOTEBOOKLM link
  }],
  "edges": [{ "from": "<node id>", "to": "<node id>", "type": "depends-on" }]
}
```

- `study` / `build` are repo-relative paths. The app and `llms.txt` prefix them with
  `https://github.com/derrick-ships/distill-it/blob/main/`, so distill-it must be pushed to `main`
  with those files present, or the links 404.
- `edge.type` is one of: `depends-on`, `same-repo`, `same-domain`, `similar-pattern`,
  `alternative-to`. Unknown types still render (safe default in `styles.css`), but the stats page and
  legend only label these five.

## Procedure

1. Make the change in distill-it first. Run `/distill <repo>` or edit `graph/graph.json` and write the
   `features/<domain>/study|build/*.md` docs and the domain's `_domain.md`. Commit and push distill-it
   to `main` (otherwise study/build links 404 in the app AND in llms.txt).

2. Sync, regenerate, validate from the distill-graph repo root:
   ```bash
   ./scripts/update-from-distill-it.sh
   ```
   This copies `graph.json`, runs `scripts/build-derived.js` to regenerate `domains.json` (domain
   descriptions from distill-it `_domain.md`) and `llms.txt` (the full machine-readable graph), then
   validates the data contract. It exits non-zero on hard errors: that is your gate. If distill-it
   lives elsewhere: `DISTILL_IT=/path/to/distill-it ./scripts/update-from-distill-it.sh`

3. Eyeball it (optional): `python3 -m http.server 8080`, then open `/` and `/stats`. The map star
   count, the stats header totals, and the `/llms.txt` "At a glance" block all reflect the new totals,
   because they read the same data.

4. Deploy: `vercel deploy --prod --yes`. Or steps 2 and 4 together:
   `./scripts/update-from-distill-it.sh --deploy`

5. Confirm live at https://distill-graph.vercel.app (map), `/stats` (analysis), and `/llms.txt`
   (machine-readable). All three should agree.

## Derived files, never hand-edit these

| File | Generated from | By |
|---|---|---|
| `graph.json` | distill-it `graph/graph.json` | `update-from-distill-it.sh` (copy) |
| `domains.json` | distill-it `features/*/_domain.md` | `scripts/build-derived.js` |
| `llms.txt` | `graph.json` + `domains.json` | `scripts/build-derived.js` |

The stats page holds no stored numbers; it recomputes on every load. Same for the map.

## Rules, never break these

- Never hand-edit `graph.json`, `domains.json`, or `llms.txt`. Change the source in distill-it and
  re-run the sync script.
- Never hardcode a count or feature list anywhere (map, stats, llms). Compute it from the data. See
  `app.js` (`repoColor`, `labelRest`), `stats.js`, and `build-derived.js` for the pattern.
- Every edge endpoint id must exist in `nodes` (dangling edges are dropped silently).
- Adding a new node field the UI should show? Wire it into `openSheet()` in `app.js`, the relevant
  section of `stats.js`, and `build-derived.js` (for llms.txt). It will not appear on its own.
- Adding a new edge type to style or count? Add a `.edge.<type>` rule in `styles.css`, an `EDGE_META`
  entry in `stats.js`, and an entry in `build-derived.js`.
- If you bump cached assets, raise the `CACHE` version in `sw.js` (currently `distill-graph-v4`).
- Validation is the deploy gate. If the sync script reports a hard error, fix it in distill-it first.

## File map

| File | Role |
|---|---|
| `index.html` / `app.js` / `styles.css` | the interactive star map |
| `stats.html` / `stats.js` / `stats.css` | the live-computed data story at `/stats` |
| `llms.txt` | machine-readable graph for AI agents (derived) |
| `graph.json` / `domains.json` | the data and domain descriptions (derived) |
| `sw.js` / `manifest.webmanifest` | offline service worker + PWA install |
| `scripts/update-from-distill-it.sh` | copy + regenerate + validate (+ `--deploy`) |
| `scripts/build-derived.js` | regenerate `domains.json` and `llms.txt` from the data |

## Design system (do not regress)

Deep OKLCH-tinted near-black; Geist (UI/body), Geist Mono (data), Oswald (display/titles/star labels);
stars colored by source repo with a naturalistic spectral palette; glass chrome with inset highlights;
calm map (labels on hover/select, named constellations, whisper edges). Sentence case for UI labels,
uppercase only for display titles and eyebrow tags. No pure black/white. Do not reintroduce per-domain
rainbow colors or flood every node with a label at once: both were explicit regressions that got fixed.
