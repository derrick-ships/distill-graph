/* ============================================================
   DISTILL ▲ GRAPH — star-map engine
   Renders graph.json as a monochrome celestial chart.
   Vanilla + D3 v7. No build step.
   ============================================================ */
(function () {
  "use strict";

  var REPO_BASE = "https://github.com/derrick-ships/distill-it/blob/main/";
  var REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- state ----
  var nodes, edges, byId, degree, neighbors, domains, repoCount, labelRest;
  var svg, gDust, gIntro, gZoom, gLink, gNode, zoom, sim;
  var linkSel, nodeSel;
  var selected = null, activeDomain = null, currentView = "map";
  var currentK = 1;
  var width = window.innerWidth, height = window.innerHeight;
  var hintTimer;

  var $ = function (s) { return document.querySelector(s); };

  fetch("graph.json")
    .then(function (r) { return r.json(); })
    .then(init)
    .catch(showError);

  function showError() {
    var l = $("#loader");
    if (l) l.querySelector(".loader-sub").textContent = "COULD NOT LOAD GRAPH DATA";
  }

  // =====================================================
  function init(data) {
    var ids = new Set(data.nodes.map(function (n) { return n.id; }));

    nodes = data.nodes.map(function (n) { return Object.assign({}, n); });

    // de-dupe edges (the source has a few repeats) + keep only valid endpoints
    var seen = new Set();
    edges = [];
    data.edges.forEach(function (e) {
      if (!ids.has(e.from) || !ids.has(e.to)) return;
      var key = e.from + "→" + e.to + "→" + e.type;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ source: e.from, target: e.to, type: e.type });
    });

    byId = new Map(nodes.map(function (n) { return [n.id, n]; }));

    degree = {};
    nodes.forEach(function (n) { degree[n.id] = 0; });
    neighbors = new Map(nodes.map(function (n) { return [n.id, new Set()]; }));
    edges.forEach(function (e) {
      degree[e.source]++; degree[e.target]++;
      neighbors.get(e.source).add(e.target);
      neighbors.get(e.target).add(e.source);
    });

    // domains, ordered by frequency (biggest constellations first)
    var counts = {};
    nodes.forEach(function (n) { counts[n.domain] = (counts[n.domain] || 0) + 1; });
    domains = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || a.localeCompare(b);
    });

    repoCount = new Set(nodes.map(function (n) { return n.repo; })).size;

    // only the busiest hubs carry a label at rest; the rest reveal on zoom/select
    labelRest = new Set(
      nodes.slice().sort(function (a, b) { return degree[b.id] - degree[a.id]; })
        .slice(0, 7).map(function (n) { return n.id; })
    );

    var sub = document.querySelector(".loader-sub");
    if (sub) sub.textContent = "MAPPING " + nodes.length + " PATTERNS · " + repoCount + " REPOSITORIES";

    buildSky();
    buildDomainRail();
    buildIndex();
    wireUI();
    runReveal();
  }

  function radius(d) { return 2.6 + Math.sqrt(degree[d.id]) * 2.05; }
  function hitRadius(d) { return Math.max(radius(d) + 12, 22); }
  function linkStrength(t) {
    return t === "same-repo" ? 0.26
      : t === "depends-on" ? 0.22
      : t === "same-domain" ? 0.12
      : t === "alternative-to" ? 0.08
      : 0.05;
  }

  // domain "constellation" anchors on an ellipse sized to the viewport
  function domainAnchors() {
    var cx = width / 2, cy = height / 2;
    var rx = Math.max(width * 0.34, 120);
    var ry = Math.max(height * 0.30, 150);
    var a = {};
    domains.forEach(function (dom, i) {
      var ang = (i / domains.length) * Math.PI * 2 - Math.PI / 2;
      a[dom] = { x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) };
    });
    return a;
  }

  // =====================================================
  function buildSky() {
    svg = d3.select("#sky").attr("viewBox", [0, 0, width, height]);
    svg.selectAll("*").remove();

    gDust = svg.append("g").attr("class", "dust");
    gIntro = svg.append("g");
    gZoom = gIntro.append("g");
    gLink = gZoom.append("g");
    gNode = gZoom.append("g");

    drawDust();

    var anchors = domainAnchors();

    sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edges).id(function (d) { return d.id; })
        .distance(function (e) { return e.type === "same-repo" ? 42 : 62; })
        .strength(function (e) { return linkStrength(e.type); }))
      .force("charge", d3.forceManyBody().strength(-78))
      .force("x", d3.forceX(function (d) { return anchors[d.domain].x; }).strength(0.10))
      .force("y", d3.forceY(function (d) { return anchors[d.domain].y; }).strength(0.10))
      .force("collide", d3.forceCollide().radius(function (d) { return radius(d) + 7; }))
      .alpha(1).alphaDecay(0.028);

    linkSel = gLink.selectAll("line")
      .data(edges).join("line")
      .attr("class", function (e) { return "edge " + e.type; });

    nodeSel = gNode.selectAll("g.node")
      .data(nodes).join("g")
      .attr("class", "node")
      .classed("show-label", function (d) { return labelRest.has(d.id); })
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", function (d) { return d.label + ", " + d.domain; })
      .on("click", function (e, d) { e.stopPropagation(); selectNode(d, true); })
      .on("keydown", function (e, d) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectNode(d, true); }
      });

    nodeSel.append("circle").attr("class", "halo").attr("r", function (d) { return radius(d) * 3.4; });
    nodeSel.append("circle").attr("class", "star").attr("r", radius);
    nodeSel.append("circle").attr("class", "hit").attr("r", hitRadius);
    nodeSel.append("text").attr("class", "label")
      .attr("dy", function (d) { return radius(d) + 11; })
      .text(function (d) { return d.label; });

    sim.on("tick", ticked);

    // zoom / pan (touch-enabled)
    zoom = d3.zoom().scaleExtent([0.45, 6]).on("zoom", function (e) {
      gZoom.attr("transform", e.transform);
      if (Math.abs(e.transform.k - currentK) > 0.001) {
        currentK = e.transform.k;
        updateLabels();
      }
      dismissHint();
    });
    svg.call(zoom).on("dblclick.zoom", null);

    // tap empty sky → clear
    svg.on("click", function (e) {
      if (e.target.closest && e.target.closest(".node")) return;
      clearSelection();
    });
  }

  function ticked() {
    linkSel
      .attr("x1", function (d) { return d.source.x; })
      .attr("y1", function (d) { return d.source.y; })
      .attr("x2", function (d) { return d.target.x; })
      .attr("y2", function (d) { return d.target.y; });
    nodeSel.attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; });
  }

  function drawDust() {
    gDust.selectAll("*").remove();
    var n = Math.round((width * height) / 7000);
    n = Math.max(60, Math.min(n, 220));
    var data = [];
    for (var i = 0; i < n; i++) {
      data.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 0.3 + Math.random() * 1.0,
        o: 0.08 + Math.random() * 0.42,
        d: (Math.random() * 6).toFixed(2)
      });
    }
    gDust.selectAll("circle").data(data).join("circle")
      .attr("cx", function (d) { return d.x; })
      .attr("cy", function (d) { return d.y; })
      .attr("r", function (d) { return d.r; })
      .attr("fill", "#fff")
      .attr("opacity", function (d) { return d.o; })
      .style("animation", REDUCE ? null : function (d) {
        return "twinkle " + (3 + Math.random() * 4).toFixed(1) + "s ease-in-out " + d.d + "s infinite";
      });
  }

  // =====================================================
  // highlight state machine
  function applyHighlight() {
    if (selected) {
      var nb = neighbors.get(selected.id);
      nodeSel
        .classed("selected", function (d) { return d.id === selected.id; })
        .classed("lit", function (d) { return nb.has(d.id); })
        .classed("dim", function (d) { return d.id !== selected.id && !nb.has(d.id); });
      linkSel
        .classed("lit", function (e) { return e.source.id === selected.id || e.target.id === selected.id; })
        .classed("dim", function (e) { return e.source.id !== selected.id && e.target.id !== selected.id; });
    } else if (activeDomain) {
      nodeSel
        .classed("selected", false)
        .classed("lit", function (d) { return d.domain === activeDomain; })
        .classed("dim", function (d) { return d.domain !== activeDomain; });
      linkSel
        .classed("lit", function (e) { return e.source.domain === activeDomain && e.target.domain === activeDomain; })
        .classed("dim", function (e) { return !(e.source.domain === activeDomain && e.target.domain === activeDomain); });
    } else {
      nodeSel.classed("selected", false).classed("lit", false).classed("dim", false);
      linkSel.classed("lit", false).classed("dim", false);
    }
    updateLabels();
  }

  function updateLabels() {
    var zoomedIn = currentK > 1.55;
    nodeSel.classed("show-label", function (d) {
      return labelRest.has(d.id) || zoomedIn;
    });
  }

  function selectNode(d, openSheetToo) {
    selected = d;
    applyHighlight();
    if (openSheetToo) openSheet(d);
    dismissHint();
  }

  function clearSelection() {
    selected = null;
    applyHighlight();
    closeSheet();
  }

  function setDomain(dom) {
    activeDomain = (activeDomain === dom || dom == null) ? null : dom;
    selected = null;
    closeSheet();
    document.querySelectorAll(".chip").forEach(function (c) {
      c.classList.toggle("active",
        (activeDomain == null && c.dataset.domain === "__all") ||
        c.dataset.domain === activeDomain);
    });
    applyHighlight();
    dismissHint();
  }

  function centerOn(d) {
    if (!zoom || d.x == null) return;
    var t = d3.zoomIdentity.translate(width / 2, height / 2).scale(1.5).translate(-d.x, -d.y);
    svg.transition().duration(REDUCE ? 0 : 650).call(zoom.transform, t);
  }

  // =====================================================
  // detail sheet
  function openSheet(d) {
    var body = $("#sheet-body");
    var study = d.study ? REPO_BASE + d.study : "";
    var build = d.build ? REPO_BASE + d.build : "";

    var conns = Array.from(neighbors.get(d.id)).map(function (id) { return byId.get(id); });
    conns.sort(function (a, b) { return degree[b.id] - degree[a.id]; });

    var cta = "";
    if (study) cta += ctaLink(study, "STUDY DOC");
    if (build) cta += ctaLink(build, "BUILD SPEC");
    if (d.source) cta += ctaLink(d.source, "ORIGIN REPO");
    if (d.notebooklm) cta += ctaLink(d.notebooklm, "NOTEBOOKLM");

    var connHtml = "";
    if (conns.length) {
      connHtml = '<p class="connected-head">CONNECTED · ' + conns.length + "</p><div class='conn-list'>" +
        conns.map(function (c) {
          return '<button class="conn" data-id="' + esc(c.id) + '">' +
            esc(c.label) + "<em>" + esc(c.domain) + "</em></button>";
        }).join("") + "</div>";
    }

    body.innerHTML =
      '<p class="sheet-eyebrow">' + esc(d.domain) + "</p>" +
      '<h2 class="sheet-title">' + esc(d.label) + "</h2>" +
      '<p class="sheet-from">FROM <a href="' + esc(d.source) + '" target="_blank" rel="noopener">' + esc(d.repo) + "</a></p>" +
      '<p class="sheet-summary">' + esc(d.summary) + "</p>" +
      '<div class="sheet-rule"></div>' +
      '<div class="cta-row">' + cta + "</div>" +
      connHtml;

    body.querySelectorAll(".conn").forEach(function (b) {
      b.addEventListener("click", function () {
        var t = byId.get(b.dataset.id);
        if (t) { selectNode(t, true); centerOn(t); }
      });
    });

    body.scrollTop = 0;
    var sheet = $("#sheet"), scrim = $("#scrim");
    scrim.hidden = false; sheet.hidden = false;
    requestAnimationFrame(function () { scrim.classList.add("in"); sheet.classList.add("in"); });
  }

  function ctaLink(href, label) {
    return '<a class="cta" href="' + esc(href) + '" target="_blank" rel="noopener">' +
      esc(label) + '<i class="arr">↗</i></a>';
  }

  function closeSheet() {
    var sheet = $("#sheet"), scrim = $("#scrim");
    if (sheet.hidden) return;
    sheet.classList.remove("in"); scrim.classList.remove("in");
    setTimeout(function () { sheet.hidden = true; scrim.hidden = true; }, 320);
  }

  // =====================================================
  // constellation filter rail
  function buildDomainRail() {
    var rail = $("#domain-rail");
    rail.innerHTML = "";
    rail.appendChild(chip("__all", "ALL ✦", true));
    domains.forEach(function (dom) { rail.appendChild(chip(dom, dom.replace(/-/g, " "), false)); });
  }
  function chip(domVal, text, active) {
    var b = document.createElement("button");
    b.className = "chip" + (active ? " active" : "");
    b.dataset.domain = domVal;
    b.textContent = text;
    b.addEventListener("click", function () { setDomain(domVal === "__all" ? null : domVal); });
    return b;
  }

  // =====================================================
  // index (manifest) view — full keyboard/no-touch access
  function buildIndex() {
    $("#index-stats").textContent =
      nodes.length + " PATTERNS · " + domains.length + " DOMAINS · " + repoCount + " REPOSITORIES";
    var list = $("#index-list");
    list.innerHTML = "";
    domains.forEach(function (dom) {
      var group = document.createElement("div");
      group.className = "idx-group";
      var h = document.createElement("p");
      h.className = "idx-domain";
      h.textContent = dom.replace(/-/g, " ");
      group.appendChild(h);
      nodes.filter(function (n) { return n.domain === dom; })
        .sort(function (a, b) { return degree[b.id] - degree[a.id]; })
        .forEach(function (n) {
          var row = document.createElement("button");
          row.className = "idx-row";
          row.innerHTML = '<span class="idx-label">' + esc(n.label) + "</span>" +
            '<span class="idx-repo">' + esc(n.repo) + "</span>";
          row.addEventListener("click", function () {
            setView("map");
            selectNode(n, true);
            centerOn(n);
          });
          group.appendChild(row);
        });
      list.appendChild(group);
    });
  }

  // =====================================================
  function setView(v) {
    currentView = v;
    var isMap = v === "map";
    $("#index-view").hidden = isMap;
    $("#map-view").style.display = isMap ? "" : "none";
    $("#domain-rail").style.display = isMap ? "" : "none";
    $("#legend-btn").style.display = isMap ? "" : "none";
    if (!isMap) { $("#legend").hidden = true; $("#hint").classList.add("gone"); }
    var btn = $("#view-btn");
    btn.textContent = isMap ? "INDEX" : "MAP";
    btn.setAttribute("aria-pressed", String(!isMap));
    if (!isMap) { closeSheet(); $("#index-view").scrollTop = 0; }
  }

  // =====================================================
  function wireUI() {
    $("#view-btn").addEventListener("click", function () {
      setView(currentView === "map" ? "index" : "map");
    });

    // search
    var bar = $("#search-bar"), input = $("#search-input");
    $("#search-btn").addEventListener("click", function () {
      if (currentView !== "map") setView("map");
      bar.hidden = false; input.value = ""; input.focus();
    });
    $("#search-close").addEventListener("click", function () {
      bar.hidden = true; runSearch("");
    });
    input.addEventListener("input", function () { runSearch(input.value); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { bar.hidden = true; runSearch(""); }
      if (e.key === "Enter") {
        var m = matches(input.value);
        if (m.length === 1) { selectNode(m[0], true); centerOn(m[0]); bar.hidden = true; }
      }
    });

    // legend
    $("#legend-btn").addEventListener("click", function () {
      var lg = $("#legend"); lg.hidden = !lg.hidden;
    });

    // sheet dismiss
    $("#sheet-grip").addEventListener("click", clearSelection);
    $("#scrim").addEventListener("click", clearSelection);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") clearSelection();
    });

    // resize
    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(onResize, 180);
    });
  }

  function matches(q) {
    q = q.toLowerCase().trim();
    if (!q) return [];
    return nodes.filter(function (n) {
      return n.label.toLowerCase().indexOf(q) >= 0 ||
        n.domain.toLowerCase().indexOf(q) >= 0 ||
        n.repo.toLowerCase().indexOf(q) >= 0 ||
        (n.summary && n.summary.toLowerCase().indexOf(q) >= 0);
    });
  }

  function runSearch(q) {
    q = q.trim();
    if (!q) { applyHighlight(); return; }
    selected = null; activeDomain = null; closeSheet();
    document.querySelectorAll(".chip").forEach(function (c) {
      c.classList.toggle("active", c.dataset.domain === "__all");
    });
    var set = new Set(matches(q).map(function (n) { return n.id; }));
    nodeSel
      .classed("selected", false)
      .classed("lit", function (d) { return set.has(d.id); })
      .classed("dim", function (d) { return !set.has(d.id); });
    linkSel.classed("lit", false).classed("dim", true);
    nodeSel.classed("show-label", function (d) { return set.has(d.id); });
  }

  function onResize() {
    width = window.innerWidth; height = window.innerHeight;
    svg.attr("viewBox", [0, 0, width, height]);
    drawDust();
    var anchors = domainAnchors();
    sim.force("x", d3.forceX(function (d) { return anchors[d.domain].x; }).strength(0.10))
      .force("y", d3.forceY(function (d) { return anchors[d.domain].y; }).strength(0.10));
    sim.alpha(0.4).restart();
  }

  // =====================================================
  function runReveal() {
    var bar = $("#loader-bar");
    requestAnimationFrame(function () { if (bar) bar.style.width = "100%"; });

    // intro: the constellation settles in
    if (!REDUCE) {
      var cx = width / 2, cy = height / 2;
      gIntro.attr("transform", "translate(" + cx + "," + cy + ") scale(0.93) translate(" + (-cx) + "," + (-cy) + ")")
        .attr("opacity", 0.0);
    }

    var delay = REDUCE ? 200 : 1050;
    setTimeout(function () {
      $("#loader").classList.add("gone");
      if (!REDUCE) {
        gIntro.transition().duration(800).ease(d3.easeCubicOut)
          .attr("transform", "translate(0,0) scale(1)")
          .attr("opacity", 1);
      } else {
        gIntro.attr("opacity", 1);
      }
    }, delay);

    // hint auto-fades
    hintTimer = setTimeout(dismissHint, 6500);
  }

  function dismissHint() {
    var h = $("#hint");
    if (h && !h.classList.contains("gone")) h.classList.add("gone");
    clearTimeout(hintTimer);
  }

  // =====================================================
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
})();
