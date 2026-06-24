/* ============================================================
   DISTILL ▲ GRAPH — stats page (figures computed live)
   ============================================================ */
(function () {
  "use strict";
  const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SPECTRAL = [
    "oklch(0.90 0.045 250)", "oklch(0.94 0.030 205)", "oklch(0.97 0.010 250)",
    "oklch(0.95 0.035 95)", "oklch(0.93 0.050 72)", "oklch(0.90 0.060 52)", "oklch(0.88 0.065 34)"
  ];
  const EDGE_META = {
    "depends-on":      { c: "oklch(0.93 0.015 250)", t: "Depends on", d: "needs another pattern to work" },
    "same-repo":       { c: "oklch(0.78 0.07 240)",  t: "Same repo", d: "shipped in the same project" },
    "same-domain":     { c: "oklch(0.82 0.075 150)", t: "Same domain", d: "solves a related problem" },
    "similar-pattern": { c: "oklch(0.86 0.085 75)",  t: "Similar pattern", d: "independent take on the same idea" },
    "alternative-to":  { c: "oklch(0.78 0.10 35)",   t: "Alternative to", d: "a competing approach" }
  };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  Promise.all([
    fetch("graph.json").then((r) => r.json()),
    fetch("domains.json").then((r) => r.json()).catch(() => ({}))
  ]).then(([g]) => render(g)).catch(() => { $(".lede").textContent = "Could not load graph data."; });

  function render(g) {
    const ids = new Set(g.nodes.map((n) => n.id));
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const seen = new Set();
    const edges = [];
    g.edges.forEach((e) => {
      if (!ids.has(e.from) || !ids.has(e.to)) return;
      const k = e.from + ">" + e.to + ">" + e.type;
      if (seen.has(k)) return; seen.add(k); edges.push(e);
    });

    const deg = {}, indep = {};
    g.nodes.forEach((n) => { deg[n.id] = 0; indep[n.id] = 0; });
    const types = {};
    edges.forEach((e) => {
      deg[e.from]++; deg[e.to]++;
      if (e.type === "depends-on") indep[e.to]++;
      types[e.type] = (types[e.type] || 0) + 1;
    });

    const byDomain = {}, byRepo = {};
    g.nodes.forEach((n) => { byDomain[n.domain] = (byDomain[n.domain] || 0) + 1; byRepo[n.repo] = (byRepo[n.repo] || 0) + 1; });
    const repos = Object.keys(byRepo).sort();
    const repoColor = {}; repos.forEach((r, i) => (repoColor[r] = SPECTRAL[i % SPECTRAL.length]));

    const domainCount = Object.keys(byDomain).length;
    const repoCount = repos.length;
    const singleDomains = Object.entries(byDomain).filter(([, c]) => c === 1).length;
    const avg = (Object.values(deg).reduce((a, b) => a + b, 0) / g.nodes.length).toFixed(1);
    const topRepo = Object.entries(byRepo).sort((a, b) => b[1] - a[1])[0];
    const topDomain = Object.entries(byDomain).sort((a, b) => b[1] - a[1])[0];

    // ---- stat strip ----
    const strip = [
      [g.nodes.length, "Patterns"], [domainCount, "Domains"], [repoCount, "Repositories"],
      [seen.size, "Connections"], [avg, "Avg links each"]
    ];
    $("#stat-strip").innerHTML = strip.map(([v, l]) => `<div class="stat-cell"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");

    // ---- narrative numbers ----
    $("#coverage-line").textContent = `${cap(topDomain[0])} runs deepest with ${topDomain[1]} patterns, while ${singleDomains} of the ${domainCount} domains hold a single one.`;
    const pct = Math.round((topRepo[1] / g.nodes.length) * 100);
    $("#sources-line").textContent = `${topRepo[0]} alone accounts for ${topRepo[1]} of ${g.nodes.length} (${pct}%); the leanest repo contributed just one.`;

    // ---- bars ----
    const topConnected = Object.entries(deg).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([id, v], i) => ({ label: byId.get(id).label, value: v, color: repoColor[byId.get(id).repo], rank: i + 1, meta: byId.get(id).repo }));
    bars("#bars-backbone", topConnected, "connections");

    const foundational = Object.entries(indep).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([id, v], i) => ({ label: byId.get(id).label, value: v, color: repoColor[byId.get(id).repo], rank: i + 1, meta: byId.get(id).repo }));
    bars("#bars-foundations", foundational, "depend on it");

    const coverage = Object.entries(byDomain).sort((a, b) => b[1] - a[1])
      .map(([d, v]) => ({ label: cap(d), value: v, color: "oklch(0.9 0.05 80)" }));
    bars("#bars-coverage", coverage, "patterns");

    const sources = Object.entries(byRepo).sort((a, b) => b[1] - a[1])
      .map(([r, v]) => ({ label: r, value: v, color: repoColor[r] }));
    bars("#bars-sources", sources, "patterns");

    // ---- relationship segmented bar ----
    const order = ["depends-on", "same-repo", "same-domain", "similar-pattern", "alternative-to"];
    const total = seen.size;
    $("#seg-relationships").innerHTML = order.filter((t) => types[t]).map((t) =>
      `<div class="seg" data-grow="${types[t]}" style="flex-grow:0;background:${EDGE_META[t].c}"></div>`).join("");
    $("#seg-legend").innerHTML = order.filter((t) => types[t]).map((t) =>
      `<div class="seg-item"><span class="sw" style="background:${EDGE_META[t].c}"></span><div><div class="t">${EDGE_META[t].t}<span class="n">${types[t]} · ${Math.round(types[t] / total * 100)}%</span></div><div class="d">${EDGE_META[t].d}</div></div></div>`).join("");

    // ---- convergent / competing pairs ----
    const pairs = edges.filter((e) => e.type === "similar-pattern" || e.type === "alternative-to").map((e) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      return { a: a.label, ar: a.repo, b: b.label, br: b.repo, type: e.type };
    });
    $("#h-convergent").textContent = `${pairs.length} times, different code solved the same problem`;
    $("#pairs-convergent").innerHTML = pairs.map((p) =>
      `<div class="pair"><span class="a">${esc(p.a)}</span><span class="vs">${p.type === "similar-pattern" ? "similar" : "vs"}</span><span class="b">${esc(p.b)}</span><span class="why">${esc(p.ar)} ${p.type === "alternative-to" ? "vs" : "and"} ${esc(p.br)} ${EDGE_META[p.type].d.includes("competing") ? "take competing approaches" : "land on the same idea independently"}.</span></div>`).join("");

    setupReveal();
  }

  function bars(sel, items, unit) {
    const max = Math.max(...items.map((i) => i.value), 1);
    $(sel).innerHTML = items.map((it) => {
      const w = (it.value / max) * 100;
      const sw = it.color ? `<span class="sw" style="background:${it.color}"></span>` : "";
      const rank = it.rank ? `<span class="rank">${it.rank}</span>` : "";
      const meta = it.meta ? `<span class="bar-meta">${esc(it.meta)}</span>` : "";
      return `<div class="bar-row"><div class="bar-head"><span class="bar-label">${rank}${sw}${esc(it.label)}</span><span class="bar-value">${meta ? meta.replace("bar-meta", "bar-meta") + " · " : ""}${it.value} ${esc(unit)}</span></div>` +
        `<div class="bar-track"><div class="bar-fill" data-w="${w.toFixed(1)}" style="background:${it.color || "var(--ink)"}"></div></div></div>`;
    }).join("");
  }

  function setupReveal() {
    const fillBars = (root) => root.querySelectorAll(".bar-fill").forEach((f) => { f.style.width = f.dataset.w + "%"; });
    const growSegs = (root) => {
      const segs = root.querySelectorAll(".seg");
      segs.forEach((s) => (s.style.flexGrow = s.dataset.grow));
    };
    if (REDUCE || !("IntersectionObserver" in window)) {
      document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
      fillBars(document); growSegs(document); return;
    }
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        fillBars(e.target); growSegs(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0.18, rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

    // toc active state
    const toc = [...document.querySelectorAll(".report-toc a")];
    const secObs = new IntersectionObserver((ents) => {
      ents.forEach((e) => {
        if (!e.isIntersecting) return;
        const id = e.target.id;
        toc.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + id));
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    document.querySelectorAll("main section[id]").forEach((s) => secObs.observe(s));
  }

  function cap(s) { return String(s).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
})();
