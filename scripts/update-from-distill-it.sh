#!/usr/bin/env bash
# Sync distill-it's knowledge graph into distill-graph, validate the data contract,
# and (optionally) deploy. The PWA derives everything from graph.json at runtime,
# so adding a feature is just: copy → validate → deploy.
#
# Usage:
#   ./scripts/update-from-distill-it.sh            # copy + validate only
#   ./scripts/update-from-distill-it.sh --deploy   # copy + validate + vercel prod deploy
#   DISTILL_IT=/path/to/distill-it ./scripts/update-from-distill-it.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISTILL_IT="${DISTILL_IT:-$(cd "$HERE/../distill-it" 2>/dev/null && pwd || true)}"
SRC="${DISTILL_IT:-}/graph/graph.json"
DEST="$HERE/graph.json"

if [ -z "${DISTILL_IT:-}" ] || [ ! -f "$SRC" ]; then
  echo "✗ Could not find distill-it graph.json."
  echo "  Set DISTILL_IT=/absolute/path/to/distill-it and retry."
  exit 1
fi

cp "$SRC" "$DEST"
echo "✓ Copied $SRC"
echo "        → $DEST"

node - "$DEST" <<'NODE'
const fs = require('fs'); const p = process.argv[2];
let d; try { d = JSON.parse(fs.readFileSync(p, 'utf8')); }
catch (e) { console.error('✗ Invalid JSON:', e.message); process.exit(1); }
if (!Array.isArray(d.nodes) || !Array.isArray(d.edges)) {
  console.error('✗ graph.json must contain nodes[] and edges[]'); process.exit(1);
}
const ids = new Set(); let hard = 0;
const REQ = ['id', 'label', 'domain', 'repo', 'summary'];
d.nodes.forEach((n, i) => {
  REQ.forEach(k => { if (!n[k]) { console.error(`✗ node[${i}] missing required "${k}"`); hard++; } });
  if (n.id) { if (ids.has(n.id)) { console.error(`✗ duplicate node id: ${n.id}`); hard++; } ids.add(n.id); }
});
let dangling = 0;
d.edges.forEach((e) => { if (!ids.has(e.from) || !ids.has(e.to)) dangling++; });
const domains = new Set(d.nodes.map(n => n.domain));
const repos = new Set(d.nodes.map(n => n.repo));
const KNOWN = new Set(['depends-on', 'same-repo', 'same-domain', 'alternative-to', 'similar-pattern']);
const newTypes = [...new Set(d.edges.map(e => e.type))].filter(t => t && !KNOWN.has(t));
console.log(`\n  nodes:   ${d.nodes.length}`);
console.log(`  edges:   ${d.edges.length}   (dangling, auto-dropped by app: ${dangling})`);
console.log(`  domains: ${domains.size}`);
console.log(`  repos:   ${repos.size}`);
if (newTypes.length) console.log(`  ⚠ new edge type(s): ${newTypes.join(', ')} — add a ".edge.<type>" rule in styles.css for a distinct look (renders with a safe faint default otherwise).`);
if (hard) { console.error(`\n✗ ${hard} hard error(s). Fix these in distill-it before deploying.`); process.exit(1); }
console.log('\n✓ Data contract OK — safe to deploy.');
NODE

if [ "${1:-}" = "--deploy" ]; then
  echo ""
  echo "→ Deploying to Vercel (production)…"
  ( cd "$HERE" && vercel deploy --prod --yes )
  echo "✓ Deployed. Confirm the star count + INDEX stats reflect the new total at https://distill-graph.vercel.app"
fi
