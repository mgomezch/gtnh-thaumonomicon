/**
 * GTNH Thaumonomicon Research Tree Explorer — Interactive Client Engine
 * Provides fuzzy search, hierarchical DAG layout, SVG Bezier edge rendering,
 * 2D mouse/trackpad zoom & pan via scrollLeft/scrollTop, and unlock order solving.
 */

(function () {
  "use strict";

  const PRESET_GOALS = [
    { key: "INFUSION", label: "Infusion" },
    { key: "ICHOR", label: "Ichor" },
    { key: "ICHORCLOTH_ARMOR", label: "Ichorcloth Armor" },
    { key: "PLACEMENT_MIRROR", label: "Worldshaper's Glass" },
    { key: "PRIMORDRIALPEARL", label: "Primordial Pearl" },
    { key: "NODECATALYZATION", label: "Node Catalyzation" },
    { key: "voidGolem", label: "Voidling Golems" },
    { key: "OUTERREV", label: "Outer Lands" },
  ];

  const NODE_W = 224;
  const NODE_H = 82;
  const GAP_X_TB = 34;
  const GAP_Y_TB = 78;
  const GAP_X_LR = 92;
  const GAP_Y_LR = 26;
  const CANVAS_PAD = 180;

  let rawData = null;
  let byKey = new Map();
  let allResearches = [];

  // Application state
  let targetKey = "NODECATALYZATION";
  let selectedKey = "NODECATALYZATION";
  let graphMode = "both"; // 'prereqs' | 'both' | 'unlocks'
  let layoutDir = "TB"; // 'TB' (Top-to-Bottom) | 'LR' (Left-to-Right)
  let zoomScale = 1.0;
  let completedKeys = new Set();

  // Current rendered graph state
  let currentSubgraph = {
    nodes: [],
    edges: [],
    positions: new Map(),
    unscaledWidth: 2000,
    unscaledHeight: 1500,
    topoPrereqs: [],
  };

  // DOM Elements
  const els = {};

  function loadCompletedState() {
    try {
      const saved = localStorage.getItem("gtnh_thaumonomicon_completed_v1");
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) {
          completedKeys = new Set(arr);
        }
      }
    } catch (_) {
      completedKeys = new Set();
    }
  }

  function saveCompletedState() {
    try {
      localStorage.setItem(
        "gtnh_thaumonomicon_completed_v1",
        JSON.stringify(Array.from(completedKeys))
      );
    } catch (_) {}
  }

  function getWarpSeverityLabel(warp) {
    if (!warp || warp <= 0) return "0 (Harmless)";
    if (warp <= 2) return `${warp} (Minor)`;
    if (warp === 3) return `${warp} (Moderate)`;
    if (warp === 4) return `${warp} (Dangerous)`;
    return `${warp} (Taboo)`;
  }

  async function initData() {
    if (window.__THAUMONOMICON_DATA__) {
      rawData = window.__THAUMONOMICON_DATA__;
    } else {
      const resp = await fetch("/api/thaumonomicon/data");
      rawData = await resp.json();
    }
    allResearches = rawData.researches || [];
    byKey.clear();
    for (const r of allResearches) {
      byKey.set(r.key, r);
    }
  }

  function cacheDom() {
    els.globalStatsPill = document.getElementById("global-stats-pill");
    els.searchInput = document.getElementById("research-search-input");
    els.btnClearSearch = document.getElementById("btn-clear-search");
    els.searchDropdown = document.getElementById("search-results-dropdown");
    els.tabFilterSelect = document.getElementById("tab-filter-select");
    els.directionSelect = document.getElementById("direction-select");
    els.presetChipsContainer = document.getElementById("preset-chips-container");

    els.btnResetCompleted = document.getElementById("btn-reset-completed");
    els.statTotalNodes = document.getElementById("stat-total-nodes");
    els.statRemainingNodes = document.getElementById("stat-remaining-nodes");
    els.statTotalVis = document.getElementById("stat-total-vis");
    els.statTotalWarp = document.getElementById("stat-total-warp");
    els.scanSummaryBox = document.getElementById("scan-summary-box");
    els.scanSummaryList = document.getElementById("scan-summary-list");

    els.checklistCountLabel = document.getElementById("checklist-count-label");
    els.unlockOrderList = document.getElementById("unlock-order-list");

    els.btnOrientation = document.getElementById("btn-orientation");
    els.orientationLabel = document.getElementById("orientation-label");
    els.btnZoomOut = document.getElementById("btn-zoom-out");
    els.btnZoomIn = document.getElementById("btn-zoom-in");
    els.btnZoomFit = document.getElementById("btn-zoom-fit");
    els.btnCenterTarget = document.getElementById("btn-center-target");
    els.btnSavePng = document.getElementById("btn-save-png");
    els.btnCopyPng = document.getElementById("btn-copy-png");
    els.zoomLevelReadout = document.getElementById("zoom-level-readout");

    els.viewport = document.getElementById("tree-viewport");
    els.surface = document.getElementById("tree-surface");
    els.edgesSvg = document.getElementById("tree-edges-svg");
    els.nodesLayer = document.getElementById("tree-nodes-layer");

    els.inspTab = document.getElementById("insp-tab");
    els.btnMakeTarget = document.getElementById("btn-make-target");
    els.inspName = document.getElementById("insp-name");
    els.inspKey = document.getElementById("insp-key");
    els.btnCopyKey = document.getElementById("btn-copy-key");
    els.inspCompletedCheck = document.getElementById("insp-completed-check");
    els.inspVis = document.getElementById("insp-vis");
    els.inspWarp = document.getElementById("insp-warp");
    els.inspAncestors = document.getElementById("insp-ancestors");
    els.inspDependents = document.getElementById("insp-dependents");
    els.inspNotesSection = document.getElementById("insp-notes-section");
    els.inspNotesList = document.getElementById("insp-notes-list");
    els.inspAspectsList = document.getElementById("insp-aspects-list");
    els.inspScansSection = document.getElementById("insp-scans-section");
    els.inspScansList = document.getElementById("insp-scans-list");
    els.inspPrereqsCount = document.getElementById("insp-prereqs-count");
    els.inspPrereqsList = document.getElementById("insp-prereqs-list");
    els.inspUnlocksCount = document.getElementById("insp-unlocks-count");
    els.inspUnlocksList = document.getElementById("insp-unlocks-list");
  }

  function populateTabsAndPresets() {
    els.globalStatsPill.textContent = `${rawData.total_researches.toLocaleString()} researches · ${rawData.total_tabs} tabs`;

    // Populate tabs dropdown
    const countsByTab = new Map();
    for (const r of allResearches) {
      countsByTab.set(r.tab, (countsByTab.get(r.tab) || 0) + 1);
    }
    for (const tab of rawData.tabs || []) {
      const opt = document.createElement("option");
      opt.value = tab;
      opt.textContent = `${tab} (${countsByTab.get(tab) || 0})`;
      els.tabFilterSelect.appendChild(opt);
    }

    // Populate preset chips
    els.presetChipsContainer.innerHTML = "";
    for (const preset of PRESET_GOALS) {
      if (!byKey.has(preset.key)) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "preset-chip";
      btn.dataset.key = preset.key;
      btn.textContent = preset.label;
      btn.addEventListener("click", () => {
        setTargetResearch(preset.key, true);
      });
      els.presetChipsContainer.appendChild(btn);
    }
  }

  /**
   * Computes the full ancestor prerequisite subgraph (and optional downstream unlocks)
   * and assigns hierarchical layer coordinates using a Sugiyama-style barycenter pass.
   */
  function buildSubgraph(rootTargetKey, mode) {
    const targetNode = byKey.get(rootTargetKey);
    if (!targetNode) return null;

    // 1. Collect all prerequisite ancestors via BFS
    const prereqSet = new Set([rootTargetKey]);
    const queue = [rootTargetKey];
    while (queue.length > 0) {
      const curKey = queue.shift();
      const cur = byKey.get(curKey);
      if (!cur) continue;
      for (const p of cur.parents || []) {
        if (byKey.has(p.key) && !prereqSet.has(p.key)) {
          prereqSet.add(p.key);
          queue.push(p.key);
        }
      }
    }

    // 2. Collect downstream unlock nodes according to mode
    const unlockSet = new Set();
    if (mode === "both") {
      // Include direct 1-hop unlocks from target
      for (const u of targetNode.unlocks || []) {
        if (byKey.has(u.key) && !prereqSet.has(u.key)) {
          unlockSet.add(u.key);
        }
      }
    } else if (mode === "unlocks") {
      // Full transitive downstream unlocks from target
      const uQueue = [rootTargetKey];
      while (uQueue.length > 0) {
        const curKey = uQueue.shift();
        const cur = byKey.get(curKey);
        if (!cur) continue;
        for (const u of cur.unlocks || []) {
          if (byKey.has(u.key) && !prereqSet.has(u.key) && !unlockSet.has(u.key)) {
            unlockSet.add(u.key);
            uQueue.push(u.key);
          }
        }
      }
    }

    const activeKeys = new Set([...prereqSet, ...unlockSet]);

    // 3. Build directed edges within activeKeys (from prerequisite -> dependent)
    const edges = [];
    const inParents = new Map();
    const outChildren = new Map();
    for (const k of activeKeys) {
      inParents.set(k, []);
      outChildren.set(k, []);
    }

    for (const k of activeKeys) {
      const r = byKey.get(k);
      if (!r) continue;
      for (const p of r.parents || []) {
        if (activeKeys.has(p.key)) {
          // If this is an expanded /iskamiunlocked prerequisite that already has
          // downstream dependents within the Kami prerequisite set, let its chain
          // flow through those dependents into ICHOR rather than duplicating a redundant
          // transitive edge from every intermediate node directly to ICHOR.
          if (p.via_kami && p.kami_leaf === false) {
            continue;
          }
          edges.push({
            from: p.key,
            to: k,
            type: p.type, // 'P' or 'Ph'
            viaKami: Boolean(p.via_kami),
            isUnlockEdge: unlockSet.has(k),
          });
          inParents.get(k).push(p.key);
          outChildren.get(p.key).push(k);
        }
      }
    }

    // 4. Compute longest-path rank (layer) from roots (0 = no parents in subgraph)
    const rankMap = new Map();
    const inDegree = new Map();
    for (const k of activeKeys) {
      inDegree.set(k, inParents.get(k).length);
      rankMap.set(k, 0);
    }

    const topoQueue = [];
    for (const [k, deg] of inDegree.entries()) {
      if (deg === 0) topoQueue.push(k);
    }
    // Sort roots deterministically by tab then name
    topoQueue.sort((a, b) => {
      const ra = byKey.get(a);
      const rb = byKey.get(b);
      return ra.tab.localeCompare(rb.tab) || ra.name.localeCompare(rb.name);
    });

    const topoOrder = [];
    while (topoQueue.length > 0) {
      const u = topoQueue.shift();
      topoOrder.push(u);
      const uRank = rankMap.get(u) || 0;
      for (const v of outChildren.get(u) || []) {
        if (uRank + 1 > (rankMap.get(v) || 0)) {
          rankMap.set(v, uRank + 1);
        }
        inDegree.set(v, inDegree.get(v) - 1);
        if (inDegree.get(v) === 0) {
          topoQueue.push(v);
        }
      }
    }

    // Fallback in case of any cycle
    for (const k of activeKeys) {
      if (!topoOrder.includes(k)) {
        topoOrder.push(k);
      }
    }

    // Pull root/intermediate prerequisites closer to their children so short branches don't dangle far away
    const targetRank = rankMap.get(rootTargetKey) || 0;
    for (let i = topoOrder.length - 1; i >= 0; i--) {
      const u = topoOrder[i];
      if (u === rootTargetKey) continue;
      const children = outChildren.get(u) || [];
      if (children.length > 0 && prereqSet.has(u)) {
        let minChildRank = Infinity;
        for (const c of children) {
          minChildRank = Math.min(minChildRank, rankMap.get(c));
        }
        if (Number.isFinite(minChildRank) && minChildRank - 1 > rankMap.get(u)) {
          rankMap.set(u, minChildRank - 1);
        }
      }
    }

    // Ensure direct unlock nodes appear strictly after targetRank
    for (const k of unlockSet) {
      if ((rankMap.get(k) || 0) <= targetRank) {
        rankMap.set(k, targetRank + 1);
      }
    }

    // Group by layer rank
    const layersMap = new Map();
    let maxRank = 0;
    for (const [k, rnk] of rankMap.entries()) {
      maxRank = Math.max(maxRank, rnk);
      if (!layersMap.has(rnk)) layersMap.set(rnk, []);
      layersMap.get(rnk).push(k);
    }

    const layers = [];
    for (let r = 0; r <= maxRank; r++) {
      if (layersMap.has(r)) {
        layers.push(layersMap.get(r));
      }
    }

    // 5. Barycenter crossing reduction sweeps (top-down & bottom-up)
    for (const layer of layers) {
      layer.sort((a, b) => {
        const ra = byKey.get(a);
        const rb = byKey.get(b);
        return ra.tab.localeCompare(rb.tab) || ra.name.localeCompare(rb.name);
      });
    }

    const orderIndex = new Map();
    const updateOrderIndices = () => {
      for (const layer of layers) {
        layer.forEach((k, idx) => orderIndex.set(k, idx));
      }
    };
    updateOrderIndices();

    for (let iter = 0; iter < 4; iter++) {
      // Top-down
      for (let l = 1; l < layers.length; l++) {
        const layer = layers[l];
        const bary = new Map();
        layer.forEach((k, idx) => {
          const pars = inParents.get(k) || [];
          if (pars.length === 0) {
            bary.set(k, idx);
          } else {
            const sum = pars.reduce((acc, p) => acc + (orderIndex.get(p) ?? 0), 0);
            bary.set(k, sum / pars.length);
          }
        });
        layer.sort((a, b) => bary.get(a) - bary.get(b));
        updateOrderIndices();
      }
      // Bottom-up
      for (let l = layers.length - 2; l >= 0; l--) {
        const layer = layers[l];
        const bary = new Map();
        layer.forEach((k, idx) => {
          const chs = outChildren.get(k) || [];
          if (chs.length === 0) {
            bary.set(k, idx);
          } else {
            const sum = chs.reduce((acc, c) => acc + (orderIndex.get(c) ?? 0), 0);
            bary.set(k, sum / chs.length);
          }
        });
        layer.sort((a, b) => bary.get(a) - bary.get(b));
        updateOrderIndices();
      }
    }

    // 6. Compute 2D positions according to layoutDir ('TB' or 'LR')
    const positions = new Map();
    const maxNodesInLayer = Math.max(1, ...layers.map((l) => l.length));

    let unscaledWidth = 1200;
    let unscaledHeight = 900;

    if (layoutDir === "TB") {
      const maxSpanW = maxNodesInLayer * NODE_W + (maxNodesInLayer - 1) * GAP_X_TB;
      unscaledWidth = Math.max(1000, maxSpanW + CANVAS_PAD * 2);
      unscaledHeight = Math.max(
        760,
        layers.length * NODE_H + Math.max(0, layers.length - 1) * GAP_Y_TB + CANVAS_PAD * 2
      );

      layers.forEach((layer, lIdx) => {
        const rowW = layer.length * NODE_W + (layer.length - 1) * GAP_X_TB;
        const startX = (unscaledWidth - rowW) / 2;
        const y = CANVAS_PAD + lIdx * (NODE_H + GAP_Y_TB);
        layer.forEach((k, nIdx) => {
          const x = startX + nIdx * (NODE_W + GAP_X_TB);
          positions.set(k, { x, y, layer: lIdx });
        });
      });
    } else {
      // Left-to-Right
      const maxSpanH = maxNodesInLayer * NODE_H + (maxNodesInLayer - 1) * GAP_Y_LR;
      unscaledWidth = Math.max(
        1100,
        layers.length * NODE_W + Math.max(0, layers.length - 1) * GAP_X_LR + CANVAS_PAD * 2
      );
      unscaledHeight = Math.max(760, maxSpanH + CANVAS_PAD * 2);

      layers.forEach((layer, lIdx) => {
        const colH = layer.length * NODE_H + (layer.length - 1) * GAP_Y_LR;
        const startY = (unscaledHeight - colH) / 2;
        const x = CANVAS_PAD + lIdx * (NODE_W + GAP_X_LR);
        layer.forEach((k, nIdx) => {
          const y = startY + nIdx * (NODE_H + GAP_Y_LR);
          positions.set(k, { x, y, layer: lIdx });
        });
      });
    }

    const topoPrereqs = topoOrder.filter((k) => prereqSet.has(k));

    return {
      nodes: Array.from(activeKeys).map((k) => ({
        research: byKey.get(k),
        isTarget: k === rootTargetKey,
        isUnlock: unlockSet.has(k),
        isRoot: (inParents.get(k) || []).length === 0 && prereqSet.has(k),
      })),
      edges,
      positions,
      unscaledWidth,
      unscaledHeight,
      topoPrereqs,
      prereqSet,
    };
  }

  function renderSubgraph() {
    const sg = buildSubgraph(targetKey, graphMode);
    if (!sg) return;
    currentSubgraph = sg;

    applySurfaceDimensions();

    // Render SVG Bezier edges
    const svgNS = "http://www.w3.org/2000/svg";
    els.edgesSvg.setAttribute(
      "viewBox",
      `0 0 ${sg.unscaledWidth} ${sg.unscaledHeight}`
    );
    els.edgesSvg.innerHTML = "";

    // Define arrowhead markers
    const defs = document.createElementNS(svgNS, "defs");
    const markerConfigs = [
      { id: "arrow-p", color: "#a855f7" },
      { id: "arrow-ph", color: "#38bdf8" },
      { id: "arrow-unlock", color: "#0ea5e9" },
      { id: "arrow-hi", color: "#fbbf24" },
    ];
    for (const mc of markerConfigs) {
      const marker = document.createElementNS(svgNS, "marker");
      marker.setAttribute("id", mc.id);
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "8");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "6");
      marker.setAttribute("markerHeight", "6");
      marker.setAttribute("orient", "auto-start-reverse");
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", "M 0 1.5 L 9 5 L 0 8.5 z");
      path.setAttribute("fill", mc.color);
      marker.appendChild(path);
      defs.appendChild(marker);
    }
    els.edgesSvg.appendChild(defs);

    for (const edge of sg.edges) {
      const pFrom = sg.positions.get(edge.from);
      const pTo = sg.positions.get(edge.to);
      if (!pFrom || !pTo) continue;

      let x1, y1, x2, y2, dStr;
      if (layoutDir === "TB") {
        x1 = pFrom.x + NODE_W / 2;
        y1 = pFrom.y + NODE_H;
        x2 = pTo.x + NODE_W / 2;
        y2 = pTo.y;
        const dy = Math.max(36, Math.abs(y2 - y1) * 0.5);
        dStr = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
      } else {
        x1 = pFrom.x + NODE_W;
        y1 = pFrom.y + NODE_H / 2;
        x2 = pTo.x;
        y2 = pTo.y + NODE_H / 2;
        const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
        dStr = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      }

      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", dStr);
      path.dataset.from = edge.from;
      path.dataset.to = edge.to;

      let cls = "edge-path ";
      let markerId = "arrow-p";
      if (edge.isUnlockEdge) {
        cls += "edge-unlock";
        markerId = "arrow-unlock";
      } else if (edge.type === "Ph") {
        cls += "edge-hidden";
        markerId = "arrow-ph";
      } else {
        cls += "edge-standard";
      }
      path.setAttribute("class", cls);
      path.setAttribute("marker-end", `url(#${markerId})`);
      path.dataset.defaultMarker = markerId;
      els.edgesSvg.appendChild(path);
    }

    // Render HTML Node Cards
    els.nodesLayer.innerHTML = "";
    for (const item of sg.nodes) {
      const r = item.research;
      const pos = sg.positions.get(r.key);
      if (!pos) continue;

      const card = document.createElement("div");
      card.className = "tree-node";
      if (item.isTarget) card.classList.add("node-target");
      else if (item.isUnlock) card.classList.add("node-unlock");
      else if (item.isRoot) card.classList.add("node-root");

      if (r.key === selectedKey) card.classList.add("node-selected");
      if (completedKeys.has(r.key)) card.classList.add("node-completed");

      card.style.left = `${pos.x}px`;
      card.style.top = `${pos.y}px`;
      card.dataset.key = r.key;

      // Top bar: Tab + Warp/Scan badges
      const topBar = document.createElement("div");
      topBar.className = "node-top-bar";

      const tabTag = document.createElement("span");
      tabTag.className = "node-tab-tag";
      tabTag.textContent = r.tab;
      topBar.appendChild(tabTag);

      const badges = document.createElement("div");
      badges.className = "node-badges";
      if (r.warp > 0) {
        const wTag = document.createElement("span");
        wTag.className = "node-warp-tag";
        wTag.textContent = `W:${r.warp}`;
        wTag.title = `Warp: ${getWarpSeverityLabel(r.warp)}`;
        badges.appendChild(wTag);
      }
      if (r.scans && r.scans.length > 0) {
        const sTag = document.createElement("span");
        sTag.className = "node-scan-tag";
        sTag.textContent = "Scan";
        sTag.title = r.scans.map((s) => `${s.type}: ${s.target}`).join(", ");
        badges.appendChild(sTag);
      }
      topBar.appendChild(badges);
      card.appendChild(topBar);

      // Middle: Research Name
      const titleEl = document.createElement("div");
      titleEl.className = "node-title";
      titleEl.textContent = r.name;
      card.appendChild(titleEl);

      // Bottom bar: Key + Vis cost
      const botBar = document.createElement("div");
      botBar.className = "node-bottom-bar";

      const keySpan = document.createElement("span");
      keySpan.className = "node-key-text";
      keySpan.textContent = r.key;
      botBar.appendChild(keySpan);

      const visSpan = document.createElement("span");
      visSpan.textContent = r.vis > 0 ? `${r.vis} vis` : "Free";
      botBar.appendChild(visSpan);

      card.appendChild(botBar);

      card.addEventListener("click", (e) => {
        e.stopPropagation();
        selectNode(r.key, false);
      });

      card.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        setTargetResearch(r.key, true);
      });

      card.addEventListener("mouseenter", () => highlightNodeConnections(r.key, true));
      card.addEventListener("mouseleave", () => highlightNodeConnections(r.key, false));

      els.nodesLayer.appendChild(card);
    }

    updateMetricsAndChecklist();
    updatePresetChipHighlight();
  }

  function highlightNodeConnections(hoveredKey, active) {
    const paths = els.edgesSvg.querySelectorAll(".edge-path");
    if (!active) {
      paths.forEach((p) => {
        p.classList.remove("edge-highlighted", "edge-dimmed");
        p.setAttribute("marker-end", `url(#${p.dataset.defaultMarker})`);
      });
      return;
    }
    paths.forEach((p) => {
      if (p.dataset.from === hoveredKey || p.dataset.to === hoveredKey) {
        p.classList.add("edge-highlighted");
        p.classList.remove("edge-dimmed");
        p.setAttribute("marker-end", "url(#arrow-hi)");
      } else {
        p.classList.remove("edge-highlighted");
        p.classList.add("edge-dimmed");
      }
    });
  }

  function updateMetricsAndChecklist() {
    const sg = currentSubgraph;
    if (!sg) return;

    let totalSteps = sg.topoPrereqs.length;
    let remainingSteps = 0;
    let totalVis = 0;
    let totalWarp = 0;
    const scanItems = new Map();

    for (const k of sg.topoPrereqs) {
      const r = byKey.get(k);
      if (!r) continue;
      const isDone = completedKeys.has(k) || r.always_known;
      if (!isDone) {
        remainingSteps++;
        totalVis += r.vis || 0;
        totalWarp += r.warp || 0;
        for (const sc of r.scans || []) {
          const label = `${sc.type}: ${sc.target}`;
          scanItems.set(label, r.name);
        }
      }
    }

    els.statTotalNodes.textContent = totalSteps.toLocaleString();
    els.statRemainingNodes.textContent = remainingSteps.toLocaleString();
    els.statTotalVis.textContent = `${totalVis.toLocaleString()} vis`;
    els.statTotalWarp.textContent = totalWarp.toLocaleString();

    if (scanItems.size > 0) {
      els.scanSummaryBox.hidden = false;
      els.scanSummaryList.innerHTML = "";
      for (const [scanLabel, rName] of scanItems.entries()) {
        const li = document.createElement("li");
        li.className = "scan-badge";
        li.textContent = scanLabel;
        li.title = `Required by ${rName}`;
        els.scanSummaryList.appendChild(li);
      }
    } else {
      els.scanSummaryBox.hidden = true;
    }

    // Render checklist
    els.checklistCountLabel.textContent = `${totalSteps} researches`;
    els.unlockOrderList.innerHTML = "";

    sg.topoPrereqs.forEach((k, idx) => {
      const r = byKey.get(k);
      if (!r) return;
      const isDone = completedKeys.has(k) || r.always_known;

      const li = document.createElement("li");
      li.className = "unlock-item";
      if (k === selectedKey) li.classList.add("selected");
      if (isDone) li.classList.add("completed");
      li.dataset.key = k;

      const stepSpan = document.createElement("span");
      stepSpan.className = "unlock-step-num";
      stepSpan.textContent = `${idx + 1}.`;
      li.appendChild(stepSpan);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isDone;
      checkbox.disabled = r.always_known;
      checkbox.title = r.always_known
        ? "Always known by default"
        : "Mark as already unlocked";
      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
      });
      checkbox.addEventListener("change", () => {
        toggleCompleted(k, checkbox.checked);
      });
      li.appendChild(checkbox);

      const body = document.createElement("div");
      body.className = "unlock-item-body";

      const title = document.createElement("div");
      title.className = "unlock-item-title";
      title.textContent = r.name;
      body.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "unlock-item-meta";
      meta.innerHTML = `<span>${r.tab}</span>`;
      if (r.vis > 0) meta.innerHTML += `<span>· ${r.vis} vis</span>`;
      if (r.warp > 0) meta.innerHTML += `<span style="color:#fda4af;">· ${r.warp} warp</span>`;
      body.appendChild(meta);

      li.appendChild(body);

      li.addEventListener("click", () => {
        selectNode(k, true);
      });

      els.unlockOrderList.appendChild(li);
    });
  }

  function toggleCompleted(key, isDone) {
    if (isDone) {
      completedKeys.add(key);
    } else {
      completedKeys.delete(key);
    }
    saveCompletedState();

    // Update node card class
    const card = els.nodesLayer.querySelector(`.tree-node[data-key="${CSS.escape(key)}"]`);
    if (card) {
      card.classList.toggle("node-completed", isDone);
    }
    if (selectedKey === key) {
      els.inspCompletedCheck.checked = isDone;
    }
    updateMetricsAndChecklist();
  }

  function selectNode(key, panToNode = false) {
    if (!byKey.has(key)) return;
    selectedKey = key;

    // Highlight card
    els.nodesLayer.querySelectorAll(".tree-node").forEach((el) => {
      el.classList.toggle("node-selected", el.dataset.key === key);
    });

    // Highlight checklist item
    els.unlockOrderList.querySelectorAll(".unlock-item").forEach((el) => {
      el.classList.toggle("selected", el.dataset.key === key);
    });

    renderInspector(key);

    if (panToNode) {
      centerOnNode(key);
    }
  }

  function setTargetResearch(key, fitViewAfter = true) {
    if (!byKey.has(key)) return;
    targetKey = key;
    selectedKey = key;

    // Update URL hash without scrolling
    if (history.replaceState) {
      history.replaceState(null, "", `#${encodeURIComponent(key)}`);
    }

    renderSubgraph();
    renderInspector(key);

    if (fitViewAfter) {
      fitGraphToViewport();
    }
  }

  function updatePresetChipHighlight() {
    els.presetChipsContainer.querySelectorAll(".preset-chip").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.key === targetKey);
    });
  }

  function countTransitiveAncestors(key) {
    const visited = new Set();
    const q = [key];
    while (q.length > 0) {
      const cur = q.shift();
      const r = byKey.get(cur);
      if (!r) continue;
      for (const p of r.parents || []) {
        if (byKey.has(p.key) && !visited.has(p.key)) {
          visited.add(p.key);
          q.push(p.key);
        }
      }
    }
    return visited.size;
  }

  function renderInspector(key) {
    const r = byKey.get(key);
    if (!r) return;

    els.inspTab.textContent = r.tab;
    els.inspName.textContent = r.name;
    els.inspKey.textContent = r.key;
    els.btnMakeTarget.disabled = r.key === targetKey;
    els.btnMakeTarget.textContent =
      r.key === targetKey ? "Current target" : "Set as root target";

    const isDone = completedKeys.has(r.key) || r.always_known;
    els.inspCompletedCheck.checked = isDone;
    els.inspCompletedCheck.disabled = r.always_known;

    els.inspVis.textContent = r.vis > 0 ? `${r.vis} vis` : "0 (Always known / free)";
    els.inspWarp.textContent = getWarpSeverityLabel(r.warp);
    els.inspWarp.style.color = r.warp > 0 ? "#fda4af" : "var(--text-main)";
    els.inspAncestors.textContent = countTransitiveAncestors(r.key).toLocaleString();
    els.inspDependents.textContent = (r.unlocks || []).length.toLocaleString();

    // Special notes
    if (r.notes && r.notes.length > 0) {
      els.inspNotesSection.hidden = false;
      els.inspNotesList.innerHTML = "";
      for (const note of r.notes) {
        const li = document.createElement("li");
        li.textContent = note;
        els.inspNotesList.appendChild(li);
      }
    } else {
      els.inspNotesSection.hidden = true;
    }

    // Anchor aspects
    els.inspAspectsList.innerHTML = "";
    if (r.aspects && r.aspects.length > 0) {
      for (const asp of r.aspects) {
        const span = document.createElement("span");
        span.className = "aspect-pill";
        span.textContent = asp;
        els.inspAspectsList.appendChild(span);
      }
    } else {
      const noneSpan = document.createElement("span");
      noneSpan.className = "small-muted";
      noneSpan.textContent = "None (no research table puzzle required)";
      els.inspAspectsList.appendChild(noneSpan);
    }

    // Scans
    if (r.scans && r.scans.length > 0) {
      els.inspScansSection.hidden = false;
      els.inspScansList.innerHTML = "";
      const scanTypeLabels = {
        SI: "Scan item",
        SE: "Scan entity",
        SA: "Scan aspect",
      };
      for (const sc of r.scans) {
        const li = document.createElement("li");
        li.className = "rel-item";
        li.style.cursor = "default";
        li.innerHTML = `
          <div class="rel-item-main">
            <span class="rel-item-name">${sc.target}</span>
            <span class="rel-item-sub">${scanTypeLabels[sc.type] || sc.type}</span>
          </div>
          <span class="scan-badge">${sc.type}</span>
        `;
        els.inspScansList.appendChild(li);
      }
    } else {
      els.inspScansSection.hidden = true;
    }

    // Direct prerequisites
    const parents = r.parents || [];
    els.inspPrereqsCount.textContent = parents.length;
    els.inspPrereqsList.innerHTML = "";
    if (parents.length === 0) {
      const li = document.createElement("li");
      li.className = "small-muted";
      li.textContent = r.always_known
        ? "Always known by default."
        : "No research prerequisites.";
      els.inspPrereqsList.appendChild(li);
    } else {
      for (const p of parents) {
        const pr = byKey.get(p.key);
        const li = document.createElement("li");
        li.className = "rel-item";
        const badgeCls = p.type === "Ph" ? "badge-ph" : "badge-p";
        const badgeText = p.via_kami ? `${p.type} · Kami` : p.type;
        const badgeTitle = p.via_kami
          ? "Required by /iskamiunlocked (All Kami Research)"
          : p.type === "Ph"
          ? "Hidden prerequisite (different tab or non-obvious link)"
          : "Standard prerequisite (same tab)";
        li.innerHTML = `
          <div class="rel-item-main">
            <span class="rel-item-name">${pr ? pr.name : p.key}</span>
            <span class="rel-item-sub">${pr ? pr.tab : ""} · ${p.key}</span>
          </div>
          <span class="rel-badge ${badgeCls}" title="${badgeTitle}">${badgeText}</span>
        `;
        li.addEventListener("click", () => {
          if (currentSubgraph.positions.has(p.key)) {
            selectNode(p.key, true);
          } else {
            setTargetResearch(p.key, true);
          }
        });
        els.inspPrereqsList.appendChild(li);
      }
    }

    // Direct unlocks
    const unlocks = r.unlocks || [];
    els.inspUnlocksCount.textContent = unlocks.length;
    els.inspUnlocksList.innerHTML = "";
    if (unlocks.length === 0) {
      const li = document.createElement("li");
      li.className = "small-muted";
      li.textContent = "Leaf research (does not unlock further researches).";
      els.inspUnlocksList.appendChild(li);
    } else {
      for (const u of unlocks) {
        const ur = byKey.get(u.key);
        const li = document.createElement("li");
        li.className = "rel-item";
        const badgeCls = u.type === "Ph" ? "badge-ph" : "badge-p";
        li.innerHTML = `
          <div class="rel-item-main">
            <span class="rel-item-name">${ur ? ur.name : u.key}</span>
            <span class="rel-item-sub">${ur ? ur.tab : ""} · ${u.key}</span>
          </div>
          <span class="rel-badge ${badgeCls}">${u.type}</span>
        `;
        li.addEventListener("click", () => {
          if (currentSubgraph.positions.has(u.key)) {
            selectNode(u.key, true);
          } else {
            setTargetResearch(u.key, true);
          }
        });
        els.inspUnlocksList.appendChild(li);
      }
    }
  }

  /* ==========================================================================
   * 2D Panning & Zooming Mechanics (scrollLeft / scrollTop + zoom scale)
   * ========================================================================== */

  function formatZoomPercentage(scale) {
    const pct = scale * 100;
    if (pct < 1) return `${pct.toFixed(2)}%`;
    if (pct < 10) return `${pct.toFixed(1)}%`;
    return `${Math.round(pct)}%`;
  }

  function applySurfaceDimensions() {
    const sg = currentSubgraph;
    if (!sg) return;
    els.surface.style.width = `${sg.unscaledWidth * zoomScale}px`;
    els.surface.style.height = `${sg.unscaledHeight * zoomScale}px`;
    els.edgesSvg.style.width = `${sg.unscaledWidth}px`;
    els.edgesSvg.style.height = `${sg.unscaledHeight}px`;
    els.edgesSvg.style.transform = `scale(${zoomScale})`;
    els.edgesSvg.style.transformOrigin = "0 0";

    els.nodesLayer.style.width = `${sg.unscaledWidth}px`;
    els.nodesLayer.style.height = `${sg.unscaledHeight}px`;
    els.nodesLayer.style.transform = `scale(${zoomScale})`;
    els.nodesLayer.style.transformOrigin = "0 0";

    els.zoomLevelReadout.textContent = formatZoomPercentage(zoomScale);
  }

  function setZoom(newScale, focalClientX, focalClientY) {
    const clamped = Math.min(4.0, Math.max(0.005, newScale));
    if (Math.abs(clamped - zoomScale) < 0.0001) return;

    const vp = els.viewport;
    const rect = vp.getBoundingClientRect();
    const fx = focalClientX !== undefined ? focalClientX - rect.left : vp.clientWidth / 2;
    const fy = focalClientY !== undefined ? focalClientY - rect.top : vp.clientHeight / 2;

    // Graph coordinate under focal point before zoom
    const graphX = (vp.scrollLeft + fx) / zoomScale;
    const graphY = (vp.scrollTop + fy) / zoomScale;

    zoomScale = clamped;
    applySurfaceDimensions();

    vp.scrollLeft = graphX * zoomScale - fx;
    vp.scrollTop = graphY * zoomScale - fy;
  }

  function centerOnNode(key) {
    const pos = currentSubgraph.positions.get(key);
    if (!pos) return;
    const vp = els.viewport;
    const cx = (pos.x + NODE_W / 2) * zoomScale;
    const cy = (pos.y + NODE_H / 2) * zoomScale;
    vp.scrollTo({
      left: Math.max(0, cx - vp.clientWidth / 2),
      top: Math.max(0, cy - vp.clientHeight / 2),
      behavior: "smooth",
    });
  }

  function fitGraphToViewport() {
    const sg = currentSubgraph;
    if (!sg || sg.positions.size === 0) return;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const pos of sg.positions.values()) {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + NODE_W);
      maxY = Math.max(maxY, pos.y + NODE_H);
    }

    const boxW = maxX - minX + 120;
    const boxH = maxY - minY + 120;
    const vp = els.viewport;
    const scaleX = vp.clientWidth / boxW;
    const scaleY = vp.clientHeight / boxH;
    zoomScale = Math.min(1.15, Math.max(0.005, Math.min(scaleX, scaleY)));

    applySurfaceDimensions();

    const centerX = ((minX + maxX) / 2) * zoomScale;
    const centerY = ((minY + maxY) / 2) * zoomScale;
    vp.scrollLeft = Math.max(0, centerX - vp.clientWidth / 2);
    vp.scrollTop = Math.max(0, centerY - vp.clientHeight / 2);
  }

  /* ==========================================================================
   * Full-Graph Screenshot Renderer (at Current Zoom Level)
   * ========================================================================== */

  function drawRoundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function truncateCanvasText(ctx, text, maxWidth) {
    if (!text) return "";
    if (ctx.measureText(text).width <= maxWidth) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return text.slice(0, lo) + "…";
  }

  async function renderFullGraphBlob() {
    const sg = currentSubgraph;
    if (!sg || sg.positions.size === 0) return null;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const pos of sg.positions.values()) {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + NODE_W);
      maxY = Math.max(maxY, pos.y + NODE_H);
    }

    const pad = 48;
    const unscaledW = maxX - minX + pad * 2;
    const unscaledH = maxY - minY + pad * 2;
    const offsetX = pad - minX;
    const offsetY = pad - minY;

    // Render at current zoomScale, capped only by browser canvas pixel limits (~16384px)
    const MAX_CANVAS_DIM = 16000;
    const maxAllowedScale = Math.min(
      MAX_CANVAS_DIM / unscaledW,
      MAX_CANVAS_DIM / unscaledH
    );
    const scale = Math.min(zoomScale, maxAllowedScale);

    const width = Math.max(1, Math.round(unscaledW * scale));
    const height = Math.max(1, Math.round(unscaledH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // 1. Background fill & subtle dot grid
    ctx.fillStyle = "#0b0914";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.scale(scale, scale);

    if (scale >= 0.25) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
      const step = 24;
      for (let gx = 12; gx < unscaledW; gx += step) {
        for (let gy = 12; gy < unscaledH; gy += step) {
          ctx.fillRect(gx, gy, 1.2, 1.2);
        }
      }
    }

    // 2. Render Bezier Edges & Arrowheads
    for (const edge of sg.edges) {
      const pFrom = sg.positions.get(edge.from);
      const pTo = sg.positions.get(edge.to);
      if (!pFrom || !pTo) continue;

      const fx = pFrom.x + offsetX;
      const fy = pFrom.y + offsetY;
      const tx = pTo.x + offsetX;
      const ty = pTo.y + offsetY;

      let x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2;
      if (layoutDir === "TB") {
        x1 = fx + NODE_W / 2;
        y1 = fy + NODE_H;
        x2 = tx + NODE_W / 2;
        y2 = ty;
        const dy = Math.max(36, Math.abs(y2 - y1) * 0.5);
        cp1x = x1;
        cp1y = y1 + dy;
        cp2x = x2;
        cp2y = y2 - dy;
      } else {
        x1 = fx + NODE_W;
        y1 = fy + NODE_H / 2;
        x2 = tx;
        y2 = ty + NODE_H / 2;
        const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
        cp1x = x1 + dx;
        cp1y = y1;
        cp2x = x2 - dx;
        cp2y = y2;
      }

      let color = "#7c3aed";
      if (edge.isUnlockEdge) color = "#0ea5e9";
      else if (edge.type === "Ph") color = "#38bdf8";

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = edge.type === "Ph" ? 0.85 : 0.78;
      if (edge.type === "Ph" && !edge.isUnlockEdge) {
        ctx.setLineDash([6, 4]);
      }
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
      ctx.stroke();

      // Arrowhead at (x2, y2) along tangent from cp2 -> p2
      ctx.setLineDash([]);
      const angle = Math.atan2(y2 - cp2y, x2 - cp2x);
      const headLen = 8;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - headLen * Math.cos(angle - Math.PI / 6),
        y2 - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        x2 - headLen * Math.cos(angle + Math.PI / 6),
        y2 - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 3. Render Node Cards
    for (const item of sg.nodes) {
      const r = item.research;
      const pos = sg.positions.get(r.key);
      if (!pos) continue;

      const nx = pos.x + offsetX;
      const ny = pos.y + offsetY;
      const isDone = completedKeys.has(r.key);

      ctx.save();
      if (isDone) ctx.globalAlpha = 0.52;

      // Card fill & border
      let bgFill = "#1b1630";
      let borderStroke = "#3b3066";
      let borderWidth = 1.5;

      if (item.isTarget) {
        bgFill = "#331c19";
        borderStroke = "#f59e0b";
        borderWidth = 2.5;
      } else if (item.isUnlock) {
        bgFill = "#12273d";
        borderStroke = "#38bdf8";
      } else if (item.isRoot) {
        bgFill = "#102b2a";
        borderStroke = "#10b981";
      }

      drawRoundedRect(ctx, nx, ny, NODE_W, NODE_H, 8);
      ctx.fillStyle = bgFill;
      ctx.fill();
      ctx.lineWidth = borderWidth;
      ctx.strokeStyle = borderStroke;
      if (isDone) ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Top bar: Tab tag
      ctx.font = "600 9.5px Inter, sans-serif";
      const tabText = truncateCanvasText(ctx, r.tab, 130);
      const tabW = ctx.measureText(tabText).width + 10;
      drawRoundedRect(ctx, nx + 9, ny + 8, tabW, 15, 4);
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fill();
      ctx.fillStyle = "#b5aed4";
      ctx.textBaseline = "middle";
      ctx.fillText(tabText, nx + 14, ny + 15.5);

      // Warp / Scan badges on top-right
      let rightCursor = nx + NODE_W - 9;
      if (r.scans && r.scans.length > 0) {
        const sText = "Scan";
        const sw = ctx.measureText(sText).width + 8;
        rightCursor -= sw;
        drawRoundedRect(ctx, rightCursor, ny + 8, sw, 15, 4);
        ctx.fillStyle = "rgba(16, 185, 129, 0.22)";
        ctx.fill();
        ctx.fillStyle = "#6ee7b7";
        ctx.fillText(sText, rightCursor + 4, ny + 15.5);
        rightCursor -= 4;
      }
      if (r.warp > 0) {
        const wText = `W:${r.warp}`;
        const ww = ctx.measureText(wText).width + 8;
        rightCursor -= ww;
        drawRoundedRect(ctx, rightCursor, ny + 8, ww, 15, 4);
        ctx.fillStyle = "rgba(244, 63, 94, 0.24)";
        ctx.fill();
        ctx.fillStyle = "#fda4af";
        ctx.fillText(wText, rightCursor + 4, ny + 15.5);
      }

      // Research Name
      ctx.font = "700 11.5px Inter, sans-serif";
      ctx.fillStyle = "#f1effa";
      const nameText = truncateCanvasText(ctx, r.name, NODE_W - 18);
      ctx.fillText(nameText, nx + 9, ny + 41);

      // Bottom bar: Key & Vis cost
      ctx.font = "500 9.5px monospace";
      ctx.fillStyle = "#78709c";
      const keyText = truncateCanvasText(ctx, r.key, 140);
      ctx.fillText(keyText, nx + 9, ny + NODE_H - 12);

      const visText = r.vis > 0 ? `${r.vis} vis` : "Free";
      const visW = ctx.measureText(visText).width;
      ctx.fillText(visText, nx + NODE_W - 9 - visW, ny + NODE_H - 12);

      ctx.restore();
    }

    ctx.restore();

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    });
  }

  async function handleSavePng() {
    const origText = els.btnSavePng.textContent;
    els.btnSavePng.textContent = "Rendering…";
    els.btnSavePng.disabled = true;
    try {
      const blob = await renderFullGraphBlob();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `thaumonomicon-${targetKey}-${Math.round(zoomScale * 100)}pct.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      els.btnSavePng.textContent = "Saved!";
    } catch (err) {
      console.error("Failed to save PNG:", err);
      els.btnSavePng.textContent = "Error";
    } finally {
      setTimeout(() => {
        els.btnSavePng.textContent = origText;
        els.btnSavePng.disabled = false;
      }, 1400);
    }
  }

  async function handleCopyPng() {
    const origText = els.btnCopyPng.textContent;
    els.btnCopyPng.textContent = "Copying…";
    els.btnCopyPng.disabled = true;
    try {
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
        throw new Error("Clipboard API unavailable");
      }
      // Pass a Promise<Blob> directly into ClipboardItem so user gesture activation is preserved
      const item = new ClipboardItem({
        "image/png": renderFullGraphBlob(),
      });
      await navigator.clipboard.write([item]);
      els.btnCopyPng.textContent = "Copied!";
    } catch (err) {
      console.error("Failed to copy PNG to clipboard:", err);
      els.btnCopyPng.textContent = "Copy failed";
    } finally {
      setTimeout(() => {
        els.btnCopyPng.textContent = origText;
        els.btnCopyPng.disabled = false;
      }, 1500);
    }
  }

  function setupCanvasInteractions() {
    const vp = els.viewport;
    let pointerState = null;

    // Mouse / touch drag to pan via scrollLeft & scrollTop
    vp.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".tree-node")) return;
      const rect = vp.getBoundingClientRect();
      if (
        !e.isPrimary ||
        e.button !== 0 ||
        e.clientX - rect.left - vp.clientLeft >= vp.clientWidth ||
        e.clientY - rect.top - vp.clientTop >= vp.clientHeight
      ) {
        return;
      }
      pointerState = { x: e.clientX, y: e.clientY };
      vp.classList.add("dragging");
      vp.setPointerCapture(e.pointerId);
    });

    vp.addEventListener("pointermove", (e) => {
      if (!pointerState) return;
      vp.scrollLeft -= e.clientX - pointerState.x;
      vp.scrollTop -= e.clientY - pointerState.y;
      pointerState = { x: e.clientX, y: e.clientY };
    });

    const endPan = () => {
      pointerState = null;
      vp.classList.remove("dragging");
    };
    vp.addEventListener("pointerup", endPan);
    vp.addEventListener("pointercancel", endPan);

    // Wheel zoom around cursor
    vp.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const zoomFactor = Math.exp(-e.deltaY * 0.0015);
        setZoom(zoomScale * zoomFactor, e.clientX, e.clientY);
      },
      { passive: false }
    );
  }

  /* ==========================================================================
   * Search & Filtering UI
   * ========================================================================== */

  function performSearch(queryText) {
    const q = queryText.trim().toLowerCase();
    const tabFilter = els.tabFilterSelect.value;

    els.btnClearSearch.hidden = q.length === 0;

    if (!q && !tabFilter) {
      els.searchDropdown.hidden = true;
      return;
    }

    const scored = [];
    for (const r of allResearches) {
      if (tabFilter && r.tab !== tabFilter) continue;

      if (!q) {
        scored.push({ r, score: 1 });
        continue;
      }

      const nameLower = r.name.toLowerCase();
      const keyLower = r.key.toLowerCase();
      const tabLower = r.tab.toLowerCase();
      let score = 0;

      if (nameLower === q || keyLower === q) score = 100;
      else if (nameLower.startsWith(q) || keyLower.startsWith(q)) score = 80;
      else if (nameLower.includes(q)) score = 60;
      else if (keyLower.includes(q)) score = 50;
      else if (tabLower.includes(q)) score = 30;
      else if ((r.aspects || []).some((a) => a.toLowerCase().includes(q))) score = 20;

      if (score > 0) {
        scored.push({ r, score });
      }
    }

    scored.sort((a, b) => b.score - a.score || a.r.name.localeCompare(b.r.name));
    const topMatches = scored.slice(0, 30);

    els.searchDropdown.innerHTML = "";
    if (topMatches.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "search-option";
      emptyLi.style.cursor = "default";
      emptyLi.innerHTML = `<span class="small-muted">No matching researches found.</span>`;
      els.searchDropdown.appendChild(emptyLi);
    } else {
      for (const item of topMatches) {
        const r = item.r;
        const li = document.createElement("li");
        li.className = "search-option";
        li.setAttribute("role", "option");
        li.innerHTML = `
          <div class="search-option-top">
            <span class="search-option-name">${r.name}</span>
            <span class="search-option-tab">${r.tab}</span>
          </div>
          <div class="search-option-sub">${r.key} · ${r.parents.length} prereqs · ${r.vis} vis</div>
        `;
        li.addEventListener("click", () => {
          els.searchInput.value = r.name;
          els.btnClearSearch.hidden = false;
          els.searchDropdown.hidden = true;
          setTargetResearch(r.key, true);
        });
        els.searchDropdown.appendChild(li);
      }
    }
    els.searchDropdown.hidden = false;
  }

  function setupUIEvents() {
    els.searchInput.addEventListener("input", () => {
      performSearch(els.searchInput.value);
    });

    els.searchInput.addEventListener("focus", () => {
      if (els.searchInput.value.trim() || els.tabFilterSelect.value) {
        performSearch(els.searchInput.value);
      }
    });

    els.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        els.searchDropdown.hidden = true;
      } else if (e.key === "Enter") {
        const firstOpt = els.searchDropdown.querySelector(".search-option");
        if (firstOpt && !els.searchDropdown.hidden) {
          firstOpt.click();
        }
      }
    });

    els.btnClearSearch.addEventListener("click", () => {
      els.searchInput.value = "";
      els.btnClearSearch.hidden = true;
      els.searchDropdown.hidden = true;
      els.searchInput.focus();
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-wrap") && !e.target.closest("#tab-filter-select")) {
        els.searchDropdown.hidden = true;
      }
    });

    els.tabFilterSelect.addEventListener("change", () => {
      performSearch(els.searchInput.value);
    });

    els.directionSelect.addEventListener("change", () => {
      graphMode = els.directionSelect.value;
      renderSubgraph();
      fitGraphToViewport();
    });

    els.btnResetCompleted.addEventListener("click", () => {
      completedKeys.clear();
      saveCompletedState();
      renderSubgraph();
      renderInspector(selectedKey);
    });

    els.btnOrientation.addEventListener("click", () => {
      layoutDir = layoutDir === "TB" ? "LR" : "TB";
      els.orientationLabel.textContent =
        layoutDir === "TB" ? "Layout: Top → Down" : "Layout: Left → Right";
      renderSubgraph();
      fitGraphToViewport();
    });

    els.btnZoomIn.addEventListener("click", () => setZoom(zoomScale * 1.22));
    els.btnZoomOut.addEventListener("click", () => setZoom(zoomScale / 1.22));
    els.btnZoomFit.addEventListener("click", () => fitGraphToViewport());
    els.btnCenterTarget.addEventListener("click", () => centerOnNode(targetKey));
    els.btnSavePng.addEventListener("click", handleSavePng);
    els.btnCopyPng.addEventListener("click", handleCopyPng);

    els.btnMakeTarget.addEventListener("click", () => {
      if (selectedKey) {
        setTargetResearch(selectedKey, true);
      }
    });

    els.btnCopyKey.addEventListener("click", () => {
      if (!selectedKey) return;
      navigator.clipboard?.writeText(selectedKey);
      els.btnCopyKey.textContent = "Copied!";
      setTimeout(() => {
        els.btnCopyKey.textContent = "Copy";
      }, 1200);
    });

    els.inspCompletedCheck.addEventListener("change", () => {
      if (selectedKey) {
        toggleCompleted(selectedKey, els.inspCompletedCheck.checked);
      }
    });
  }

  async function boot() {
    cacheDom();
    loadCompletedState();
    await initData();
    populateTabsAndPresets();
    setupCanvasInteractions();
    setupUIEvents();

    // Check URL hash for initial target research
    const rawHash = decodeURIComponent(window.location.hash.replace(/^#/, "")).trim();
    if (rawHash && byKey.has(rawHash)) {
      targetKey = rawHash;
      selectedKey = rawHash;
    }

    setTargetResearch(targetKey, true);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
