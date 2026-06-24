/* ============================================================
   DISTILL ▲ GRAPH — star-map engine v3
   Precision-instrument rendering: crisp stars with bright cores,
   tight sparing glow, soft-shadowed labels, delicate linework,
   dependency arrows only on the focused node.
   ============================================================ */
(function () {
  "use strict";

  const REPO_BASE = "https://github.com/derrick-ships/distill-it/blob/main/";
  const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const EASE = d3.easeExpOut;

  // refined stellar palette: near-white stars with a whisper of temperature
  const SPECTRAL = [
    "oklch(0.90 0.045 250)", // cool blue-white
    "oklch(0.94 0.030 205)", // pale cyan
    "oklch(0.97 0.010 250)", // white
    "oklch(0.95 0.035 95)",  // warm white
    "oklch(0.93 0.050 72)",  // pale gold
    "oklch(0.90 0.060 52)",  // soft amber
    "oklch(0.88 0.065 34)"   // muted coral
  ];

  let nodes, edges, byId, degree, neighbors, domains, repos, repoColor;
  let domainNodes, domainDesc, repoCount, labelRest;
  let svg, defs, gDust, gZoom, gLink, gConst, gNode, zoom, sim;
  let linkSel, nodeSel, constSel;
  let selected = null, activeDomain = null, currentView = "map";
  let currentK = 1;
  let width = window.innerWidth, height = window.innerHeight;
  let hintTimer;

  const $ = (s) => document.querySelector(s);

  Promise.all([
    fetch("graph.json").then((r) => r.json()),
    fetch("domains.json").then((r) => r.json()).catch(() => ({}))
  ]).then(([graph, dd]) => init(graph, dd)).catch(showError);

  function showError() {
    const l = $("#loader");
    if (l) l.querySelector(".loader-sub").textContent = "Could not load graph data";
  }

  function init(data, dd) {
    domainDesc = dd || {};
    const ids = new Set(data.nodes.map((n) => n.id));
    nodes = data.nodes.map((n) => Object.assign({}, n));

    const seen = new Set();
    edges = [];
    data.edges.forEach((e) => {
      if (!ids.has(e.from) || !ids.has(e.to)) return;
      const key = e.from + "->" + e.to + "->" + e.type;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ source: e.from, target: e.to, type: e.type });
    });

    byId = new Map(nodes.map((n) => [n.id, n]));
    degree = {};
    nodes.forEach((n) => (degree[n.id] = 0));
    neighbors = new Map(nodes.map((n) => [n.id, new Set()]));
    edges.forEach((e) => {
      degree[e.source]++; degree[e.target]++;
      neighbors.get(e.source).add(e.target);
      neighbors.get(e.target).add(e.source);
    });

    const dCount = {};
    nodes.forEach((n) => (dCount[n.domain] = (dCount[n.domain] || 0) + 1));
    domains = Object.keys(dCount).sort((a, b) => dCount[b] - dCount[a] || a.localeCompare(b));
    domainNodes = {};
    domains.forEach((d) => (domainNodes[d] = nodes.filter((n) => n.domain === d)));

    repos = [...new Set(nodes.map((n) => n.repo))].sort();
    repoCount = repos.length;
    repoColor = {};
    repos.forEach((r, i) => (repoColor[r] = SPECTRAL[i % SPECTRAL.length]));

    labelRest = new Set(
      nodes.slice().sort((a, b) => degree[b.id] - degree[a.id]).slice(0, 5).map((n) => n.id)
    );

    const sub = $(".loader-sub");
    if (sub) sub.textContent = `Mapping ${nodes.length} patterns across ${repoCount} repositories`;

    buildSky();
    buildDomainRail();
    buildLegend();
    buildIndex();
    wireUI();
    runReveal();
  }

  const radius = (d) => 2.9 + Math.sqrt(degree[d.id]) * 2.0;
  const linkStrength = (t) =>
    t === "same-repo" ? 0.3 : t === "depends-on" ? 0.24 : t === "same-domain" ? 0.14 : t === "alternative-to" ? 0.08 : 0.05;

  function domainAnchors() {
    const cx = width / 2, cy = height / 2;
    const rx = Math.max(width * 0.36, 130), ry = Math.max(height * 0.32, 160);
    const a = {};
    domains.forEach((dom, i) => {
      const ang = (i / domains.length) * Math.PI * 2 - Math.PI / 2;
      a[dom] = { x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) };
    });
    return a;
  }

  function buildSky() {
    svg = d3.select("#sky").attr("viewBox", [0, 0, width, height]);
    svg.selectAll("*").remove();

    defs = svg.append("defs");
    const glow = defs.append("filter").attr("id", "glow").attr("x", "-90%").attr("y", "-90%").attr("width", "280%").attr("height", "280%");
    glow.append("feGaussianBlur").attr("stdDeviation", 1.5);
    const arrow = defs.append("marker").attr("id", "arrow").attr("viewBox", "0 -4 8 8")
      .attr("refX", 7).attr("refY", 0).attr("markerWidth", 4.6).attr("markerHeight", 4.6).attr("orient", "auto");
    arrow.append("path").attr("class", "arrowhead").attr("d", "M0,-3L7,0L0,3");

    gDust = svg.append("g").attr("class", "dust");
    gZoom = svg.append("g");
    gLink = gZoom.append("g");
    gConst = gZoom.append("g");
    gNode = gZoom.append("g");

    drawDust();

    const anchors = domainAnchors();
    sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edges).id((d) => d.id)
        .distance((e) => (e.type === "same-repo" ? 42 : 66))
        .strength((e) => linkStrength(e.type)))
      .force("charge", d3.forceManyBody().strength(-100))
      .force("x", d3.forceX((d) => anchors[d.domain].x).strength(0.16))
      .force("y", d3.forceY((d) => anchors[d.domain].y).strength(0.16))
      .force("collide", d3.forceCollide().radius((d) => radius(d) + 9))
      .alpha(1).alphaDecay(0.03);

    linkSel = gLink.selectAll("line").data(edges).join("line").attr("class", (e) => "edge " + e.type);

    constSel = gConst.selectAll("text").data(domains.filter((d) => domainNodes[d].length >= 2)).join("text")
      .attr("class", "constellation").text((d) => d.replace(/-/g, " "));

    nodeSel = gNode.selectAll("g.node").data(nodes).join("g")
      .attr("class", "node").attr("tabindex", 0).attr("role", "button")
      .attr("aria-label", (d) => `${d.label}, ${d.domain}, from ${d.repo}`)
      .on("click", (e, d) => { e.stopPropagation(); selectNode(d, true); })
      .on("keydown", (e, d) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectNode(d, true); } });

    nodeSel.append("circle").attr("class", "halo").attr("r", (d) => radius(d) * 1.7)
      .attr("filter", "url(#glow)").style("fill", (d) => repoColor[d.repo]);
    nodeSel.append("circle").attr("class", "star").attr("r", radius).style("fill", (d) => repoColor[d.repo]);
    nodeSel.append("circle").attr("class", "core").attr("r", (d) => Math.max(1.05, radius(d) * 0.4));
    nodeSel.append("circle").attr("class", "hit").attr("r", (d) => Math.max(radius(d) + 13, 22));
    nodeSel.append("text").attr("class", "label").attr("dy", (d) => radius(d) + 12).text((d) => d.label);

    nodeSel.classed("show-label", (d) => labelRest.has(d.id));

    sim.on("tick", ticked);

    zoom = d3.zoom().scaleExtent([0.4, 7]).on("zoom", (e) => {
      gZoom.attr("transform", e.transform);
      if (Math.abs(e.transform.k - currentK) > 0.001) { currentK = e.transform.k; refreshLabels(); }
      dismissHint();
    });
    svg.call(zoom).on("dblclick.zoom", null);
    svg.on("dblclick", (e) => svg.transition().duration(420).ease(EASE).call(zoom.scaleBy, 1.7, d3.pointer(e)));
    svg.on("click", (e) => { if (e.target.closest && e.target.closest(".node")) return; clearSelection(); });
  }

  function ticked() {
    linkSel.each(function (d) {
      const sx = d.source.x, sy = d.source.y, tx = d.target.x, ty = d.target.y;
      let dx = tx - sx, dy = ty - sy, L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      const rS = radius(d.source) + 2;
      const rT = radius(d.target) + (d.type === "depends-on" ? 6 : 2);
      this.setAttribute("x1", sx + ux * rS); this.setAttribute("y1", sy + uy * rS);
      this.setAttribute("x2", tx - ux * rT); this.setAttribute("y2", ty - uy * rT);
    });
    nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
    constSel.attr("x", (d) => {
      const ns = domainNodes[d]; let sx = 0; ns.forEach((n) => (sx += n.x)); return sx / ns.length;
    }).attr("y", (d) => {
      const ns = domainNodes[d]; let my = Infinity; ns.forEach((n) => (my = Math.min(my, n.y - radius(n)))); return my - 16;
    });
  }

  function drawDust() {
    gDust.selectAll("*").remove();
    let n = Math.round((width * height) / 6800);
    n = Math.max(70, Math.min(n, 230));
    const data = [];
    for (let i = 0; i < n; i++) data.push({
      x: Math.random() * width, y: Math.random() * height,
      r: 0.3 + Math.random() * 1.0, o: 0.06 + Math.random() * 0.34, d: (Math.random() * 6).toFixed(2)
    });
    gDust.selectAll("circle").data(data).join("circle")
      .attr("cx", (d) => d.x).attr("cy", (d) => d.y).attr("r", (d) => d.r)
      .attr("fill", "oklch(0.97 0.012 250)").attr("opacity", (d) => d.o)
      .style("animation", REDUCE ? null : (d) => `twinkle ${(3 + Math.random() * 4).toFixed(1)}s ease-in-out ${d.d}s infinite`);
  }

  function applyHighlight() {
    if (selected) {
      const nb = neighbors.get(selected.id);
      nodeSel.classed("selected", (d) => d.id === selected.id)
        .classed("lit", (d) => nb.has(d.id))
        .classed("dim", (d) => d.id !== selected.id && !nb.has(d.id));
      linkSel.classed("lit", (e) => e.source.id === selected.id || e.target.id === selected.id)
        .classed("dim", (e) => e.source.id !== selected.id && e.target.id !== selected.id);
    } else if (activeDomain) {
      nodeSel.classed("selected", false)
        .classed("lit", (d) => d.domain === activeDomain)
        .classed("dim", (d) => d.domain !== activeDomain);
      linkSel.classed("lit", (e) => e.source.domain === activeDomain && e.target.domain === activeDomain)
        .classed("dim", (e) => !(e.source.domain === activeDomain && e.target.domain === activeDomain));
    } else {
      nodeSel.classed("selected", false).classed("lit", false).classed("dim", false);
      linkSel.classed("lit", false).classed("dim", false);
    }
    // dependency arrows appear only on the focused node's depends-on edges
    linkSel.each(function (e) {
      if (e.type === "depends-on" && this.classList.contains("lit")) this.setAttribute("marker-end", "url(#arrow)");
      else this.removeAttribute("marker-end");
    });
    refreshLabels();
  }

  function refreshLabels() {
    const zoomedIn = currentK > 1.3;
    nodeSel.classed("show-label", (d) =>
      labelRest.has(d.id) || zoomedIn || (selected && (d.id === selected.id || neighbors.get(selected.id).has(d.id))));
    const showConst = currentK < 0.98 && !selected && !activeDomain;
    constSel
      .classed("active", (d) => d === activeDomain)
      .classed("shown", (d) => showConst)
      .classed("muted", (d) => !!activeDomain && d !== activeDomain);
  }

  function selectNode(d, openSheetToo) {
    selected = d; applyHighlight();
    if (openSheetToo) openSheet(d);
    dismissHint();
  }
  function clearSelection() { selected = null; applyHighlight(); closeSheet(); }

  function setDomain(dom) {
    activeDomain = (activeDomain === dom || dom == null) ? null : dom;
    selected = null; closeSheet();
    document.querySelectorAll(".chip").forEach((c) =>
      c.classList.toggle("active", (activeDomain == null && c.dataset.domain === "__all") || c.dataset.domain === activeDomain));
    showDomainInfo(activeDomain);
    applyHighlight();
    dismissHint();
  }

  function showDomainInfo(dom) {
    const el = $("#domain-info");
    if (!dom) { el.classList.remove("in"); setTimeout(() => (el.hidden = true), 300); return; }
    el.querySelector(".di-name").textContent = dom.replace(/-/g, " ");
    el.querySelector(".di-count").textContent = `${domainNodes[dom].length} patterns`;
    el.querySelector(".di-desc").textContent = domainDesc[dom] || "";
    el.querySelector(".di-dot").style.background = repoColor[domainNodes[dom][0].repo];
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("in"));
  }

  function centerOn(d) {
    if (!zoom || d.x == null) return;
    const t = d3.zoomIdentity.translate(width / 2, height / 2).scale(1.8).translate(-d.x, -d.y);
    svg.transition().duration(REDUCE ? 0 : 640).ease(EASE).call(zoom.transform, t);
  }

  function fitView(animate) {
    if (!nodes.length || nodes[0].x == null) return;
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
    const k = Math.min(2.2, 0.84 / Math.max(w / width, h / height));
    const tx = width / 2 - k * (minX + maxX) / 2, ty = height / 2 - k * (minY + maxY) / 2;
    const t = d3.zoomIdentity.translate(tx, ty).scale(k);
    (animate && !REDUCE ? svg.transition().duration(620).ease(EASE) : svg).call(zoom.transform, t);
  }

  function openSheet(d) {
    const body = $("#sheet-body");
    const study = d.study ? REPO_BASE + d.study : "";
    const build = d.build ? REPO_BASE + d.build : "";
    const conns = Array.from(neighbors.get(d.id)).map((id) => byId.get(id)).sort((a, b) => degree[b.id] - degree[a.id]);

    let cta = "";
    if (study) cta += ctaLink(study, "Study doc");
    if (build) cta += ctaLink(build, "Build spec");
    if (d.source) cta += ctaLink(d.source, "Origin repo");
    if (d.notebooklm) cta += ctaLink(d.notebooklm, "NotebookLM");

    let connHtml = "";
    if (conns.length) {
      connHtml = `<p class="connected-head">Connected · ${conns.length}</p><div class="conn-list">` +
        conns.map((c) => `<button class="conn" data-id="${esc(c.id)}"><span class="sw-dot" style="background:${repoColor[c.repo]}"></span>${esc(c.label)}<em>${esc(c.domain)}</em></button>`).join("") + "</div>";
    }

    body.innerHTML =
      `<span class="sheet-tag"><span class="sw-dot" style="background:${repoColor[d.repo]}"></span>${esc(d.domain)}</span>` +
      `<h2 class="sheet-title">${esc(d.label)}</h2>` +
      `<p class="sheet-from">from <a href="${esc(d.source)}" target="_blank" rel="noopener">${esc(d.repo)}</a></p>` +
      `<p class="sheet-summary">${esc(d.summary)}</p>` +
      `<div class="sheet-rule"></div><div class="cta-row">${cta}</div>${connHtml}`;

    body.querySelectorAll(".conn").forEach((b) => b.addEventListener("click", () => {
      const t = byId.get(b.dataset.id); if (t) { selectNode(t, true); centerOn(t); }
    }));
    body.scrollTop = 0;
    const sheet = $("#sheet"), scrim = $("#scrim");
    scrim.hidden = false; sheet.hidden = false;
    requestAnimationFrame(() => { scrim.classList.add("in"); sheet.classList.add("in"); sheet.setAttribute("tabindex", "-1"); sheet.focus({ preventScroll: true }); });
  }
  const ctaLink = (href, label) => `<a class="cta" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}<i class="arr">↗</i></a>`;

  function closeSheet() {
    const sheet = $("#sheet"), scrim = $("#scrim");
    if (sheet.hidden) return;
    sheet.classList.remove("in"); scrim.classList.remove("in");
    setTimeout(() => { sheet.hidden = true; scrim.hidden = true; }, 380);
  }

  function buildDomainRail() {
    const rail = $("#domain-rail");
    rail.innerHTML = "";
    rail.appendChild(chip("__all", "All ✦", true));
    domains.forEach((dom) => rail.appendChild(chip(dom, dom.replace(/-/g, " "), false)));
  }
  function chip(domVal, text, active) {
    const b = document.createElement("button");
    b.className = "chip" + (active ? " active" : "");
    b.dataset.domain = domVal;
    b.textContent = text;
    b.addEventListener("click", () => setDomain(domVal === "__all" ? null : domVal));
    return b;
  }

  function buildLegend() {
    const lg = $("#legend");
    lg.innerHTML =
      `<p class="legend-h">Source repository</p>` +
      repos.map((r) => `<div class="legend-row"><span class="sw-dot" style="background:${repoColor[r]}"></span>${esc(r)}</div>`).join("") +
      `<p class="legend-h">Relationships</p>` +
      `<div class="legend-row"><span class="sw-line s-depends"></span>depends on <span class="sw-arrow">→</span></div>` +
      `<div class="legend-row"><span class="sw-line"></span>same repo</div>` +
      `<div class="legend-row"><span class="sw-line s-same-domain"></span>same domain</div>` +
      `<div class="legend-row"><span class="sw-line s-alt"></span>alternative to</div>` +
      `<p class="legend-h">Star size</p>` +
      `<div class="legend-row">larger = more connected</div>`;
  }

  function buildIndex() {
    $("#index-stats").textContent = `${nodes.length} patterns · ${domains.length} domains · ${repoCount} repositories`;
    const list = $("#index-list");
    list.innerHTML = "";
    domains.forEach((dom) => {
      const group = document.createElement("div");
      const h = document.createElement("p");
      h.className = "idx-domain";
      h.textContent = dom.replace(/-/g, " ");
      group.appendChild(h);
      domainNodes[dom].slice().sort((a, b) => degree[b.id] - degree[a.id]).forEach((n) => {
        const row = document.createElement("button");
        row.className = "idx-row";
        row.innerHTML = `<span class="idx-label">${esc(n.label)}</span><span class="idx-repo"><span class="sw-dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${repoColor[n.repo]};margin-right:6px"></span>${esc(n.repo)}</span>`;
        row.addEventListener("click", () => { setView("map"); selectNode(n, true); centerOn(n); });
        group.appendChild(row);
      });
      list.appendChild(group);
    });
  }

  function setView(v) {
    currentView = v;
    const isMap = v === "map";
    $("#index-view").hidden = isMap;
    $("#map-view").style.display = isMap ? "" : "none";
    ["#domain-rail", "#zoom-controls", "#legend-btn"].forEach((s) => ($(s).style.display = isMap ? "" : "none"));
    if (!isMap) { $("#legend").hidden = true; $("#hint").classList.add("gone"); $("#domain-info").hidden = true; }
    const btn = $("#view-btn");
    btn.textContent = isMap ? "Index" : "Map";
    btn.setAttribute("aria-pressed", String(!isMap));
    if (!isMap) { closeSheet(); $("#index-view").scrollTop = 0; }
  }

  function wireUI() {
    $("#view-btn").addEventListener("click", () => setView(currentView === "map" ? "index" : "map"));

    const bar = $("#search-bar"), input = $("#search-input");
    $("#search-btn").addEventListener("click", () => { if (currentView !== "map") setView("map"); bar.hidden = false; input.value = ""; input.focus(); });
    $("#search-close").addEventListener("click", () => { bar.hidden = true; runSearch(""); });
    input.addEventListener("input", () => runSearch(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { bar.hidden = true; runSearch(""); }
      if (e.key === "Enter") { const m = matches(input.value); if (m.length === 1) { selectNode(m[0], true); centerOn(m[0]); bar.hidden = true; } }
    });

    $("#zoom-in").addEventListener("click", () => svg.transition().duration(420).ease(EASE).call(zoom.scaleBy, 1.6));
    $("#zoom-out").addEventListener("click", () => svg.transition().duration(420).ease(EASE).call(zoom.scaleBy, 1 / 1.6));
    $("#zoom-reset").addEventListener("click", () => { setDomain(null); fitView(true); });

    $("#legend-btn").addEventListener("click", () => { const lg = $("#legend"); lg.hidden = !lg.hidden; });

    $("#sheet-grip").addEventListener("click", clearSelection);
    $("#scrim").addEventListener("click", clearSelection);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") clearSelection(); });

    let rt;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(onResize, 180); });
  }

  function matches(q) {
    q = q.toLowerCase().trim();
    if (!q) return [];
    return nodes.filter((n) =>
      n.label.toLowerCase().includes(q) || n.domain.toLowerCase().includes(q) ||
      n.repo.toLowerCase().includes(q) || (n.summary && n.summary.toLowerCase().includes(q)));
  }
  function runSearch(q) {
    q = q.trim();
    if (!q) { applyHighlight(); document.querySelector("#search-empty").hidden = true; return; }
    selected = null; activeDomain = null; closeSheet(); showDomainInfo(null);
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.domain === "__all"));
    const set = new Set(matches(q).map((n) => n.id));
    nodeSel.classed("selected", false).classed("lit", (d) => set.has(d.id)).classed("dim", (d) => !set.has(d.id));
    linkSel.classed("lit", false).classed("dim", true).each(function () { this.removeAttribute("marker-end"); });
    nodeSel.classed("show-label", (d) => set.has(d.id));
    constSel.classed("active", false).classed("shown", false).classed("muted", true);
    const se = document.querySelector("#search-empty");
    if (set.size === 0) { se.innerHTML = "No patterns match <b>" + esc(q) + "</b>"; se.hidden = false; } else se.hidden = true;
  }

  function onResize() {
    width = window.innerWidth; height = window.innerHeight;
    svg.attr("viewBox", [0, 0, width, height]);
    drawDust();
    const anchors = domainAnchors();
    sim.force("x", d3.forceX((d) => anchors[d.domain].x).strength(0.16))
      .force("y", d3.forceY((d) => anchors[d.domain].y).strength(0.16));
    sim.alpha(0.4).restart();
  }

  function runReveal() {
    const bar = $("#loader-bar");
    requestAnimationFrame(() => { if (bar) bar.style.width = "100%"; });
    const delay = REDUCE ? 200 : 1050;
    setTimeout(() => { $("#loader").classList.add("gone"); fitView(!REDUCE); refreshLabels(); }, delay);
    hintTimer = setTimeout(dismissHint, 7000);
  }
  function dismissHint() {
    const h = $("#hint");
    if (h && !h.classList.contains("gone")) h.classList.add("gone");
    clearTimeout(hintTimer);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
})();
