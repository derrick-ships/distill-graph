---
name: distill-graph-sync
description: Use when a feature has been added to or changed in the distill-it knowledge graph (via /distill or by editing graph/graph.json) and that change needs to show up in the distill-graph PWA — the SpaceX-style star-map visualization deployed at https://distill-graph.vercel.app (repo github.com/derrick-ships/distill-graph). Keeps the mirrored graph.json in sync, validates the data contract, and redeploys without breaking the app. Triggers: "update distill-graph", "sync the graph PWA", "I added a feature to distill-it", "redeploy the star map", "push the new node to the visualization".
---

# Distill-Graph Sync

Keep the **distill-graph** PWA in sync with the **distill-it** knowledge graph after features
are added/changed, and redeploy — without breaking anything.

## Mental model (read this first)

`distill-graph` is a **static, zero-build PWA** that renders `distill-it/graph/graph.json` as a
monochrome star map. **The app derives EVERYTHING from graph.json at runtime** — node/edge/domain/
repo counts, the force layout, which stars get labels, the domain filter chips, and the INDEX list.

There are **no hardcoded feature lists or counts** anywhere. Because of that, adding a feature is
almost always just three steps: **copy `graph.json` → validate → deploy.** You rarely touch app code.

## The data contract — `graph.json`

```jsonc
{
  "nodes": [{
    "id":      "domain/slug--from-repo",   // REQUIRED, unique
    "label":   "Human Title",              // REQUIRED  → star label + sheet title + index row
    "domain":  "domain-name",              // REQUIRED  → constellation group + filter chip + index section (any string)
    "repo":    "repo-name",                // REQUIRED  → "FROM <repo>", repo count (any string)
    "summary": "1–3 sentences.",           // REQUIRED  → sheet body (plain text; HTML auto-escaped)
    "study":   "features/<domain>/study/<slug>.md",  // optional → "STUDY DOC" link
    "build":   "features/<domain>/build/<slug>.md",  // optional → "BUILD SPEC" link
    "source":  "https://github.com/owner/repo",      // optional → "ORIGIN REPO" link
    "notebooklm": ""                                 // optional → "NOTEBOOKLM" link
  }],
  "edges": [{ "from": "<node id>", "to": "<node id>", "type": "depends-on" }]
}
```

- `study` / `build` are **repo-relative paths**. The app prefixes them with
  `https://github.com/derrick-ships/distill-it/blob/main/` — so **distill-it must be pushed to
  `main`** with those files present, or the links 404.
- `edge.type` is one of: `depends-on` · `same-repo` · `same-domain` · `alternative-to` ·
  `similar-pattern`. **Unknown types still render** (safe faint default in `styles.css`), but add a
  `.edge.<type>` rule if you want a distinct dash/opacity.

## How the app stays safe automatically

- Edges with an endpoint that isn't a node are **silently dropped**.
- Duplicate edges are **de-duped**.
- Missing optional fields just **omit that button** — no crash.
- Counts/labels/filters **recompute** from the data.

## Procedure

1. **Make the change in distill-it first.** Run `/distill <repo>` or edit
   `distill-it/graph/graph.json` and write the `features/<domain>/study|build/*.md` docs.
   **Commit and push distill-it to `main`** (otherwise STUDY/BUILD links 404).

2. **Sync + validate** (from the distill-graph repo root):
   ```bash
   ./scripts/update-from-distill-it.sh
   ```
   This copies `graph.json` over and runs a data-contract check (required fields, unique ids,
   dangling edges, new edge types). **It exits non-zero on hard errors — that is your gate.**
   If distill-it lives elsewhere: `DISTILL_IT=/path/to/distill-it ./scripts/update-from-distill-it.sh`

3. **Eyeball it locally** (optional but recommended):
   ```bash
   python3 -m http.server 8080    # open http://localhost:8080
   ```
   The star count should match the new node total; tap a new star and confirm the sheet + links.

4. **Deploy to production:**
   ```bash
   vercel deploy --prod --yes     # logged in as the project owner
   ```
   Or do steps 2+4 in one shot: `./scripts/update-from-distill-it.sh --deploy`

5. **Confirm live** at https://distill-graph.vercel.app — the INDEX header stats
   (`N PATTERNS · M DOMAINS · K REPOSITORIES`) should reflect the new totals.

## Rules — never break these

- **Never hand-edit `distill-graph/graph.json`.** It is a mirror; the source of truth is
  `distill-it/graph/graph.json`. Always sync via the script.
- **Never hardcode a count or feature list.** If you need a count, compute it from the data
  (see `repoCount` / `labelRest` in `app.js` for the pattern).
- **Every edge endpoint id must exist in `nodes`.**
- **Adding a new node field the UI should show?** Wire it into `openSheet()` in `app.js` — it
  won't appear on its own.
- **Adding a new edge type you want styled?** Add `.edge.<type>` in `styles.css`.
- **Validation is the deploy gate.** If `update-from-distill-it.sh` reports a hard error, fix it
  in distill-it before deploying.

## Where things live

| File | Role |
|---|---|
| `graph.json` | mirrored data — **do not hand-edit** |
| `app.js` | star-map engine: `init()`, `openSheet()`, `buildIndex()`, `buildDomainRail()`, force layout |
| `styles.css` | design tokens + `.edge.<type>` styles + responsive layout |
| `index.html` | app shell (nav, loader, sheet, index) |
| `sw.js` / `manifest.webmanifest` | offline service worker + PWA install |
| `vendor/d3.v7.min.js` | vendored D3 (offline-safe) |
| `scripts/update-from-distill-it.sh` | copy + validate (+ `--deploy`) |

## If you change the design system

The look is defined by `DESIGN-spacex.md` (pure black, white D-DIN display, **zero accent color**).
The monochrome rule is load-bearing: domains are encoded via the filter rail + light-up, **not**
color. Don't reintroduce per-domain colors without an explicit ask — it breaks the system.
