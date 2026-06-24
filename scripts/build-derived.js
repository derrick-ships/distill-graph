#!/usr/bin/env node
/* Regenerate derived artifacts from the graph data:
   - domains.json (domain descriptions, if distill-it is reachable)
   - llms.txt     (full machine-readable graph for AI agents)
   Usage: node scripts/build-derived.js   [DISTILL_IT=/path/to/distill-it]
*/
const fs = require("fs");
const path = require("path");

const PROJ = path.resolve(__dirname, "..");
const DISTILL_IT = process.env.DISTILL_IT || path.resolve(PROJ, "../distill-it");
const APP = "https://distill-graph.vercel.app";
const BLOB = "https://github.com/derrick-ships/distill-it/blob/main/";

const graph = JSON.parse(fs.readFileSync(path.join(PROJ, "graph.json"), "utf8"));
const ids = new Set(graph.nodes.map((n) => n.id));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));

// dedupe edges
const seen = new Set(); const edges = [];
graph.edges.forEach((e) => { if (!ids.has(e.from) || !ids.has(e.to)) return; const k = e.from + ">" + e.to + ">" + e.type; if (seen.has(k)) return; seen.add(k); edges.push(e); });

// ---- domains.json (descriptions from distill-it _domain.md) ----
const domainsPresent = [...new Set(graph.nodes.map((n) => n.domain))].sort();
let domainDesc = {};
const existing = path.join(PROJ, "domains.json");
if (fs.existsSync(existing)) { try { domainDesc = JSON.parse(fs.readFileSync(existing, "utf8")); } catch (e) {} }
const FEAT = path.join(DISTILL_IT, "features");
if (fs.existsSync(FEAT)) {
  const clean = (s) => s.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  const firstDesc = (md) => {
    const lines = md.split("\n"); let buf = [], started = false;
    for (const ln of lines) { const t = ln.trim();
      if (t.startsWith("#")) { if (started) break; continue; }
      if (t.startsWith("|") || t.startsWith("-") || t.startsWith(">")) { if (started) break; continue; }
      if (!t) { if (started) break; else continue; }
      started = true; buf.push(t); }
    let d = clean(buf.join(" ")).replace(/^[A-Z][^:]{0,60}:\s*/, "");
    const sents = d.match(/[^.!?]+[.!?]+/g) || [d]; let out = "";
    for (const s of sents) { if ((out + s).length > 240) break; out += s; }
    return (out || d).trim();
  };
  const fresh = {};
  domainsPresent.forEach((dom) => { const p = path.join(FEAT, dom, "_domain.md"); fresh[dom] = fs.existsSync(p) ? firstDesc(fs.readFileSync(p, "utf8")) : (domainDesc[dom] || ""); });
  domainDesc = fresh;
  fs.writeFileSync(existing, JSON.stringify(domainDesc, null, 2) + "\n");
  console.log("✓ domains.json regenerated from distill-it");
} else {
  console.log("· distill-it not found, keeping existing domains.json");
}

// ---- stats ----
const deg = {}, indep = {}; graph.nodes.forEach((n) => { deg[n.id] = 0; indep[n.id] = 0; });
const types = {};
edges.forEach((e) => { deg[e.from]++; deg[e.to]++; if (e.type === "depends-on") indep[e.to]++; types[e.type] = (types[e.type] || 0) + 1; });
const byDomain = {}, byRepo = {};
graph.nodes.forEach((n) => { byDomain[n.domain] = (byDomain[n.domain] || 0) + 1; byRepo[n.repo] = (byRepo[n.repo] || 0) + 1; });
const repos = Object.entries(byRepo).sort((a, b) => b[1] - a[1]);
const cap = (s) => String(s).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const topConnected = Object.entries(deg).sort((a, b) => b[1] - a[1]).slice(0, 6);
const foundational = Object.entries(indep).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);

// ---- llms.txt ----
let L = [];
L.push("# Distill ▲ Graph");
L.push("");
L.push(`> A knowledge graph of ${graph.nodes.length} reusable engineering patterns, distilled from ${repos.length} open-source repositories into ${domainsPresent.length} domains. This file is the machine-readable representation of the graph for AI agents and crawlers. The visual app at ${APP} renders the same data as an interactive star map.`);
L.push("");
L.push("## At a glance");
L.push(`- Patterns: ${graph.nodes.length}`);
L.push(`- Domains: ${domainsPresent.length}`);
L.push(`- Repositories: ${repos.length}`);
L.push(`- Connections: ${seen.size} (avg ${(Object.values(deg).reduce((a, b) => a + b, 0) / graph.nodes.length).toFixed(1)} per pattern)`);
L.push(`- Source of truth: https://github.com/derrick-ships/distill-it`);
L.push(`- Raw data (JSON): ${APP}/graph.json`);
L.push(`- Visual map: ${APP}  ·  Stats/analysis: ${APP}/stats`);
L.push("");
L.push("## How to read a pattern");
L.push("Each pattern has a label, a domain, a source repository, a one-line summary, a plain-language study doc, and a build spec (a self-contained reimplementation guide). Study and build links point into the distill-it repository.");
L.push("");
L.push("## The backbone (most connected patterns, study these first)");
topConnected.forEach(([id, v], i) => { const n = byId.get(id); L.push(`${i + 1}. ${n.label} (${v} connections) — ${n.domain}, from ${n.repo}`); });
L.push("");
L.push("## Foundations (most depended-upon, highest-leverage to reuse)");
foundational.forEach(([id, v]) => { const n = byId.get(id); L.push(`- ${n.label} (${v} patterns depend on it) — from ${n.repo}`); });
L.push("");
L.push("## Patterns by domain");
domainsPresent.sort((a, b) => byDomain[b] - byDomain[a] || a.localeCompare(b)).forEach((dom) => {
  L.push("");
  L.push(`### ${cap(dom)} (${byDomain[dom]})`);
  if (domainDesc[dom]) L.push(domainDesc[dom]);
  graph.nodes.filter((n) => n.domain === dom).sort((a, b) => deg[b.id] - deg[a.id]).forEach((n) => {
    L.push("");
    L.push(`- **${n.label}** — from ${n.repo}. ${n.summary}`);
    const links = [];
    if (n.study) links.push(`[study](${BLOB}${n.study})`);
    if (n.build) links.push(`[build spec](${BLOB}${n.build})`);
    if (n.source) links.push(`[origin repo](${n.source})`);
    if (links.length) L.push(`  ${links.join(" · ")}`);
  });
});
L.push("");
L.push("## Repositories (by contribution)");
repos.forEach(([r, c]) => L.push(`- ${r}: ${c} pattern${c > 1 ? "s" : ""}`));
L.push("");
L.push("## Relationship types");
const EM = { "depends-on": "one pattern needs another to work", "same-repo": "shipped in the same project", "same-domain": "solves a related problem", "similar-pattern": "an independent take on the same idea", "alternative-to": "a competing approach" };
["depends-on", "same-repo", "same-domain", "similar-pattern", "alternative-to"].forEach((t) => { if (types[t]) L.push(`- ${t} (${types[t]}): ${EM[t]}`); });
L.push("");
L.push("## Convergent solutions (same problem, different repos, worth comparing)");
edges.filter((e) => e.type === "similar-pattern" || e.type === "alternative-to").forEach((e) => {
  L.push(`- ${byId.get(e.from).label} ${e.type === "alternative-to" ? "vs" : "~"} ${byId.get(e.to).label} (${byId.get(e.from).repo} / ${byId.get(e.to).repo})`);
});
L.push("");
fs.writeFileSync(path.join(PROJ, "llms.txt"), L.join("\n"));
console.log(`✓ llms.txt regenerated (${L.length} lines)`);
