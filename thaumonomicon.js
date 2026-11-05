/**
 * GTNH Thaumonomicon Research Tree Explorer — Interactive Client Engine
 * Provides fuzzy search, hierarchical DAG layout, SVG Bezier edge rendering,
 * 2D mouse/trackpad zoom & pan via scrollLeft/scrollTop, and unlock order solving.
 */

(function () {
  "use strict";

  const PRESET_GOALS = [
    { key: "INFUSION", label: "Infusion" },
    { key: "ELDRITCHMAJOR", label: "Eldritch Revelation" },
    { key: "PRIMPEARL", label: "Primordial Pearl" },
    { key: "OUTERREV", label: "Outer Lands" },
    { key: "KAMI_UNLOCKED", label: "KAMI" },
    { key: "ICHOR", label: "Ichor" },
    { key: "ICHORCLOTH_ARMOR", label: "Ichorcloth Armor" },
    { key: "PLACEMENT_MIRROR", label: "Worldshaper's Glass" },
    { key: "NODECATALYZATION", label: "Node Catalyzation" },
    { key: "voidGolem", label: "Voidling Golems" },
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
  let collapseKami = true;
  let kamiTargetForceCollapsed = false;
  let completedKeys = new Set();

  // Sidebar & Mobile layout state
  let leftSidebarWidth = 340;
  let rightSidebarWidth = 340;
  let leftCollapsed = false;
  let rightCollapsed = false;
  let mobileActivePanel = "canvas"; // 'left' | 'canvas' | 'right'

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

  function isMobileViewport() {
    return window.innerWidth <= 860;
  }

  function loadCompletedState() {
    try {
      const saved = localStorage.getItem("gtnh_thaumonomicon_completed_v1");
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) {
          completedKeys = new Set(arr);
        }
      }
      const savedCollapse = localStorage.getItem("gtnh_thaumonomicon_collapse_kami_v1");
      if (savedCollapse !== null) {
        collapseKami = savedCollapse === "true";
      }
      const savedLayout = localStorage.getItem("gtnh_thaumonomicon_layout_v1");
      if (savedLayout) {
        const obj = JSON.parse(savedLayout);
        if (typeof obj.leftW === "number") leftSidebarWidth = Math.max(220, Math.min(620, obj.leftW));
        if (typeof obj.rightW === "number") rightSidebarWidth = Math.max(220, Math.min(620, obj.rightW));
        if (typeof obj.leftCollapsed === "boolean") leftCollapsed = obj.leftCollapsed;
        if (typeof obj.rightCollapsed === "boolean") rightCollapsed = obj.rightCollapsed;
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
      localStorage.setItem(
        "gtnh_thaumonomicon_collapse_kami_v1",
        String(collapseKami)
      );
    } catch (_) {}
  }

  function saveLayoutState() {
    try {
      localStorage.setItem(
        "gtnh_thaumonomicon_layout_v1",
        JSON.stringify({
          leftW: leftSidebarWidth,
          rightW: rightSidebarWidth,
          leftCollapsed,
          rightCollapsed,
        })
      );
    } catch (_) {}
  }

  function applySidebarLayout() {
    document.documentElement.style.setProperty("--left-sidebar-w", `${leftSidebarWidth}px`);
    document.documentElement.style.setProperty("--right-sidebar-w", `${rightSidebarWidth}px`);

    if (els.leftSidebar) {
      els.leftSidebar.classList.toggle("collapsed", leftCollapsed);
    }
    if (els.rightSidebar) {
      els.rightSidebar.classList.toggle("collapsed", rightCollapsed);
    }
    if (els.leftResizer) {
      els.leftResizer.classList.toggle("hidden", leftCollapsed);
    }
    if (els.rightResizer) {
      els.rightResizer.classList.toggle("hidden", rightCollapsed);
    }
    if (els.btnExpandLeft) {
      els.btnExpandLeft.hidden = !leftCollapsed;
    }
    if (els.btnExpandRight) {
      els.btnExpandRight.hidden = !rightCollapsed;
    }
  }

  function setSidebarCollapsed(side, collapsed) {
    if (isMobileViewport()) {
      setMobilePanel("canvas");
      return;
    }
    if (side === "left") {
      leftCollapsed = collapsed;
    } else {
      rightCollapsed = collapsed;
    }
    applySidebarLayout();
    saveLayoutState();
  }

  function setMobilePanel(panel) {
    mobileActivePanel = panel;
    if (els.leftSidebar) {
      els.leftSidebar.classList.toggle("mobile-open", panel === "left");
    }
    if (els.rightSidebar) {
      els.rightSidebar.classList.toggle("mobile-open", panel === "right");
    }
    if (els.mobileBackdrop) {
      els.mobileBackdrop.hidden = panel === "canvas";
    }
    if (els.mobileTabBar) {
      els.mobileTabBar.querySelectorAll(".mobile-tab-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.mobilePanel === panel);
      });
    }
  }

  function getEffectiveParents(r, rootTargetKey) {
    if (!r || !r.parents) return [];
    const shouldCollapse =
      rootTargetKey === "KAMI_UNLOCKED" ? kamiTargetForceCollapsed : collapseKami;
    if (r.is_kami_bundle) {
      return shouldCollapse ? [] : r.parents;
    }
    if (shouldCollapse) {
      return r.parents.filter((p) => !p.via_kami);
    }
    return r.parents.filter((p) => !p.is_kami_bundle_edge);
  }

  function getEffectiveUnlocks(r, rootTargetKey) {
    if (!r || !r.unlocks) return [];
    const shouldCollapse =
      rootTargetKey === "KAMI_UNLOCKED" ? kamiTargetForceCollapsed : collapseKami;
    return r.unlocks.filter((u) => {
      if (shouldCollapse) {
        if (u.via_kami && !u.kami_direct) return false;
        return true;
      } else {
        if (u.key === "KAMI_UNLOCKED") return false;
        if (u.via_kami && !u.kami_leaf && !u.kami_direct) return false;
        return true;
      }
    });
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
    els.leftSidebar = document.getElementById("left-sidebar");
    els.rightSidebar = document.getElementById("inspector-sidebar");
    els.leftResizer = document.getElementById("left-resizer");
    els.rightResizer = document.getElementById("right-resizer");
    els.btnCollapseLeft = document.getElementById("btn-collapse-left");
    els.btnCollapseRight = document.getElementById("btn-collapse-right");
    els.btnExpandLeft = document.getElementById("btn-expand-left");
    els.btnExpandRight = document.getElementById("btn-expand-right");
    els.mobileTabBar = document.getElementById("mobile-tab-bar");
    els.mobileBackdrop = document.getElementById("mobile-backdrop");
    els.btnOpenAbout = document.getElementById("btn-open-about");
    els.aboutDialog = document.getElementById("about-dialog");
    els.btnCloseAbout = document.getElementById("btn-close-about");
    els.btnDismissAbout = document.getElementById("btn-dismiss-about");

    els.btnOpenTextures = document.getElementById("btn-open-textures");
    els.texturesStatusDot = document.getElementById("textures-status-dot");
    els.texturesBtnLabel = document.getElementById("textures-btn-label");
    els.texturesDialog = document.getElementById("textures-dialog");
    els.btnCloseTextures = document.getElementById("btn-close-textures");
    els.btnDismissTextures = document.getElementById("btn-dismiss-textures");
    els.texturesCacheSummary = document.getElementById("textures-cache-summary");
    els.texturesCacheBadge = document.getElementById("textures-cache-badge");
    els.texturesProgressTrack = document.getElementById("textures-progress-track");
    els.texturesProgressFill = document.getElementById("textures-progress-fill");
    els.texturesStatusDetail = document.getElementById("textures-status-detail");
    els.texturesDropzone = document.getElementById("textures-dropzone");
    els.btnPickModsDir = document.getElementById("btn-pick-mods-dir");
    els.btnPickJarFiles = document.getElementById("btn-pick-jar-files");
    els.inputModsDir = document.getElementById("input-mods-dir");
    els.inputJarFiles = document.getElementById("input-jar-files");
    els.checkFetchMissingOnline = document.getElementById("check-fetch-missing-online");
    els.btnFetchGithubTextures = document.getElementById("btn-fetch-github-textures");
    els.btnReloadTextures = document.getElementById("btn-reload-textures");
    els.btnClearTextures = document.getElementById("btn-clear-textures");

    els.searchInput = document.getElementById("research-search-input");
    els.btnClearSearch = document.getElementById("btn-clear-search");
    els.searchDropdown = document.getElementById("search-results-dropdown");
    els.tabFilterSelect = document.getElementById("tab-filter-select");
    els.directionSelect = document.getElementById("direction-select");
    els.collapseKamiCheck = document.getElementById("collapse-kami-check");
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
    els.inspIconImg = document.getElementById("insp-icon-img");
    els.inspName = document.getElementById("insp-name");
    els.inspKey = document.getElementById("insp-key");
    els.btnCopyKey = document.getElementById("insp-copy-key") || document.getElementById("btn-copy-key");
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
    if (els.collapseKamiCheck) {
      els.collapseKamiCheck.checked = collapseKami;
    }

    // Populate tabs dropdown (only if not yet populated)
    if (els.tabFilterSelect.options.length <= 1) {
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
    }

    // Populate preset chips
    els.presetChipsContainer.innerHTML = "";
    for (const preset of PRESET_GOALS) {
      const r = byKey.get(preset.key);
      if (!r) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "preset-chip";
      if (preset.key === targetKey) btn.classList.add("active");
      btn.dataset.key = preset.key;
      const iconUrl = getResearchIconDataUrl(r);
      if (iconUrl) {
        const img = document.createElement("img");
        img.className = "preset-chip-icon";
        img.src = iconUrl;
        img.alt = "";
        btn.appendChild(img);
      }
      const span = document.createElement("span");
      span.textContent = preset.label;
      btn.appendChild(span);
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

    // 1. Collect all prerequisite ancestors via BFS using effective parents
    const prereqSet = new Set([rootTargetKey]);
    const queue = [rootTargetKey];
    while (queue.length > 0) {
      const curKey = queue.shift();
      const cur = byKey.get(curKey);
      if (!cur) continue;
      for (const p of getEffectiveParents(cur, rootTargetKey)) {
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
      for (const u of getEffectiveUnlocks(targetNode, rootTargetKey)) {
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
        for (const u of getEffectiveUnlocks(cur, rootTargetKey)) {
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
      for (const p of getEffectiveParents(r, rootTargetKey)) {
        if (activeKeys.has(p.key)) {
          // If this is an expanded /iskamiunlocked prerequisite that already has
          // downstream dependents within the Kami prerequisite set, let its chain
          // flow through those dependents into ICHOR / KAMI_UNLOCKED rather than duplicating
          // a redundant transitive edge from every intermediate node directly.
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

      // Top bar: Tab + Warp/Condition/Scan badges
      const topBar = document.createElement("div");
      topBar.className = "node-top-bar";

      const tabTag = document.createElement("span");
      tabTag.className = "node-tab-tag";
      tabTag.textContent = r.tab;
      topBar.appendChild(tabTag);

      const badges = document.createElement("div");
      badges.className = "node-badges";
      const displayWarp = r.is_kami_bundle ? r.kami_total_warp || 0 : r.warp || 0;
      if (displayWarp > 0) {
        const wTag = document.createElement("span");
        wTag.className = "node-warp-tag";
        wTag.textContent = `W:${displayWarp}`;
        wTag.title = r.is_kami_bundle
          ? `Cumulative Warp across ${r.kami_prereq_count} KAMI prerequisites: ${displayWarp}`
          : `Warp: ${getWarpSeverityLabel(r.warp)}`;
        badges.appendChild(wTag);
      }
      if (r.condition_badge) {
        const cTag = document.createElement("span");
        cTag.className = `node-cond-tag cond-${r.condition_category || "scan"}`;
        cTag.textContent = r.condition_badge;
        const tooltipParts = [];
        if (r.notes && r.notes.length > 0) tooltipParts.push(...r.notes);
        if (r.scans && r.scans.length > 0) {
          tooltipParts.push(
            "Scan (any 1): " + r.scans.map((s) => `${s.type}: ${s.target}`).join(", ")
          );
        }
        cTag.title = tooltipParts.join(" | ") || r.condition_badge;
        badges.appendChild(cTag);
      }
      topBar.appendChild(badges);
      card.appendChild(topBar);

      // Middle: Icon + Research Name
      const mainRow = document.createElement("div");
      mainRow.className = "node-main-row";

      const iconUrl = getResearchIconDataUrl(r);
      if (iconUrl) {
        const iconImg = document.createElement("img");
        iconImg.className = "node-icon-img";
        iconImg.src = iconUrl;
        iconImg.alt = "";
        mainRow.appendChild(iconImg);
      }

      const titleEl = document.createElement("div");
      titleEl.className = "node-title";
      titleEl.textContent = r.name;
      mainRow.appendChild(titleEl);
      card.appendChild(mainRow);

      // Bottom bar: Key + Vis cost
      const botBar = document.createElement("div");
      botBar.className = "node-bottom-bar";

      const keySpan = document.createElement("span");
      keySpan.className = "node-key-text";
      keySpan.textContent = r.key;
      botBar.appendChild(keySpan);

      const visSpan = document.createElement("span");
      if (r.is_kami_bundle) {
        visSpan.textContent = `${(r.kami_total_vis || 0).toLocaleString()} vis`;
        visSpan.style.color = "#e9d5ff";
      } else if (r.vis > 0) {
        visSpan.textContent = `${r.vis} vis`;
      } else if (r.condition_category === "warp" || r.condition_category === "event") {
        visSpan.textContent = "Event unlock";
        visSpan.style.color = "#fde68a";
      } else if (r.always_known) {
        visSpan.textContent = "Always known";
      } else {
        visSpan.textContent = "Free";
      }
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
    const conditionEntries = [];
    const seenConditionIds = new Set();

    const scanTypePrefix = {
      SI: "🔍 Scan Item",
      SE: "👁 Scan Mob",
      SA: "✧ Scan Aspect",
    };

    for (const k of sg.topoPrereqs) {
      const r = byKey.get(k);
      if (!r) continue;
      const isDone = completedKeys.has(k) || r.always_known;
      if (!isDone) {
        remainingSteps++;
        if (r.is_kami_bundle && getEffectiveParents(r, targetKey).length === 0) {
          // Single-box collapsed mode: sum any KAMI prerequisites not already in sg.prereqSet or completedKeys
          for (const p of r.parents || []) {
            if (!sg.prereqSet.has(p.key) && !completedKeys.has(p.key)) {
              const pr = byKey.get(p.key);
              if (pr && !pr.always_known) {
                totalVis += pr.vis || 0;
                totalWarp += pr.warp || 0;
              }
            }
          }
        } else {
          totalVis += r.vis || 0;
          totalWarp += r.warp || 0;
        }

        if (r.notes && r.notes.length > 0 && r.condition_badge) {
          const cid = `cond:${r.key}`;
          if (!seenConditionIds.has(cid)) {
            seenConditionIds.add(cid);
            conditionEntries.push({
              key: r.key,
              label: `${r.condition_badge} · ${r.name}`,
              category: r.condition_category || "event",
              tooltip: `${r.name} (${r.key}): ${r.notes.join(" ")}`,
            });
          }
        }

        for (const sc of r.scans || []) {
          const cleanTarget = sc.target.replace(/^Thaumcraft\./, "");
          const cid = `scan:${sc.type}:${cleanTarget}:${r.key}`;
          if (!seenConditionIds.has(cid)) {
            seenConditionIds.add(cid);
            conditionEntries.push({
              key: r.key,
              label: `${scanTypePrefix[sc.type] || sc.type}: ${cleanTarget}`,
              category: "scan",
              tooltip: `Required by ${r.name} (${r.key}) — click to focus node`,
            });
          }
        }
      }
    }

    els.statTotalNodes.textContent = totalSteps.toLocaleString();
    els.statRemainingNodes.textContent = remainingSteps.toLocaleString();
    els.statTotalVis.textContent = `${totalVis.toLocaleString()} vis`;
    els.statTotalWarp.textContent = totalWarp.toLocaleString();

    if (conditionEntries.length > 0) {
      els.scanSummaryBox.hidden = false;
      els.scanSummaryList.innerHTML = "";
      for (const entry of conditionEntries) {
        const li = document.createElement("li");
        li.className = `scan-badge cond-${entry.category}`;
        li.textContent = entry.label;
        li.title = entry.tooltip;
        li.addEventListener("click", () => {
          selectNode(entry.key, true);
        });
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

      const iconUrl = getResearchIconDataUrl(r);
      if (iconUrl) {
        const iconImg = document.createElement("img");
        iconImg.className = "unlock-item-icon";
        iconImg.src = iconUrl;
        iconImg.alt = "";
        li.appendChild(iconImg);
      }

      const body = document.createElement("div");
      body.className = "unlock-item-body";

      const title = document.createElement("div");
      title.className = "unlock-item-title";
      title.textContent = r.name;
      body.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "unlock-item-meta";
      meta.innerHTML = `<span>${r.tab}</span>`;
      const itemVis = r.is_kami_bundle ? r.kami_total_vis || 0 : r.vis || 0;
      const itemWarp = r.is_kami_bundle ? r.kami_total_warp || 0 : r.warp || 0;
      if (itemVis > 0) meta.innerHTML += `<span>· ${itemVis.toLocaleString()} vis</span>`;
      if (itemWarp > 0) meta.innerHTML += `<span style="color:#fda4af;">· ${itemWarp} warp</span>`;
      if (r.condition_badge) {
        meta.innerHTML += `<span style="color:#fde68a;">· ${r.condition_badge}</span>`;
      }
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
      if (isMobileViewport()) {
        setMobilePanel("canvas");
      }
      centerOnNode(key);
    }
  }

  function setTargetResearch(key, fitViewAfter = true) {
    if (!byKey.has(key)) return;
    targetKey = key;
    selectedKey = key;
    if (key === "KAMI_UNLOCKED") {
      kamiTargetForceCollapsed = false;
    }

    if (isMobileViewport()) {
      setMobilePanel("canvas");
    }

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
      const parents = cur === "KAMI_UNLOCKED" ? r.parents || [] : getEffectiveParents(r, key);
      for (const p of parents) {
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
    if (els.inspIconImg) {
      const iconUrl = getResearchIconDataUrl(r);
      if (iconUrl) {
        els.inspIconImg.src = iconUrl;
        els.inspIconImg.hidden = false;
      } else {
        els.inspIconImg.hidden = true;
      }
    }
    els.btnMakeTarget.disabled = r.key === targetKey;
    els.btnMakeTarget.textContent =
      r.key === targetKey ? "Current target" : "Set as root target";

    const isDone = completedKeys.has(r.key) || r.always_known;
    els.inspCompletedCheck.checked = isDone;
    els.inspCompletedCheck.disabled = r.always_known;

    if (r.is_kami_bundle) {
      els.inspVis.textContent = `${(r.kami_total_vis || 0).toLocaleString()} vis (${r.kami_prereq_count} researches)`;
      els.inspWarp.textContent = `${r.kami_total_warp || 0} cumulative`;
      els.inspWarp.style.color = "#fda4af";
    } else {
      if (r.vis > 0) {
        els.inspVis.textContent = `${r.vis} vis`;
      } else if (r.condition_category === "warp" || r.condition_category === "event") {
        els.inspVis.textContent = "0 (Unlocked by in-game event)";
      } else if (r.always_known) {
        els.inspVis.textContent = "0 (Always known)";
      } else {
        els.inspVis.textContent = "0 (Free)";
      }
      els.inspWarp.textContent = getWarpSeverityLabel(r.warp);
      els.inspWarp.style.color = r.warp > 0 ? "#fda4af" : "var(--text-main)";
    }
    els.inspAncestors.textContent = countTransitiveAncestors(r.key).toLocaleString();
    const effectiveUnlocks = getEffectiveUnlocks(r, targetKey);
    els.inspDependents.textContent = effectiveUnlocks.length.toLocaleString();

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
        SI: "Scan specific item with Thaumometer",
        SE: "Scan specific mob / entity with Thaumometer",
        SA: "Scan any item or mob containing this aspect",
      };
      for (const sc of r.scans) {
        const li = document.createElement("li");
        li.className = "rel-item";
        li.style.cursor = "default";
        li.innerHTML = `
          <div class="rel-item-main">
            <span class="rel-item-name">${sc.target.replace(/^Thaumcraft\./, "")}</span>
            <span class="rel-item-sub">${scanTypeLabels[sc.type] || sc.type}</span>
          </div>
          <span class="scan-badge">${sc.type}</span>
        `;
        els.inspScansList.appendChild(li);
      }
    } else {
      els.inspScansSection.hidden = true;
    }

    // Direct prerequisites (for KAMI_UNLOCKED, always list all 274 researches in the inspector)
    const parents = r.is_kami_bundle ? r.parents || [] : getEffectiveParents(r, targetKey);
    els.inspPrereqsCount.textContent = parents.length;
    els.inspPrereqsList.innerHTML = "";
    if (parents.length === 0) {
      const li = document.createElement("li");
      li.className = "small-muted";
      if (r.always_known) {
        li.textContent = "Always known by default.";
      } else if (r.notes && r.notes.length > 0) {
        li.textContent = "Unlocked via special game condition (see above).";
      } else if (r.scans && r.scans.length > 0) {
        li.textContent = "Unlocked by scanning the required target above.";
      } else {
        li.textContent = "No research prerequisites.";
      }
      els.inspPrereqsList.appendChild(li);
    } else {
      for (const p of parents) {
        const pr = byKey.get(p.key);
        const li = document.createElement("li");
        li.className = "rel-item";
        const badgeCls = p.type === "Ph" ? "badge-ph" : "badge-p";
        const badgeText = p.is_kami_bundle_edge
          ? "Ph · 274"
          : p.via_kami
          ? `${p.type} · Kami`
          : p.type;
        const badgeTitle = p.is_kami_bundle_edge
          ? "All 274 pre-Ichor researches required by /iskamiunlocked"
          : p.via_kami
          ? "Required by /iskamiunlocked (All Kami Research)"
          : p.type === "Ph"
          ? "Hidden prerequisite (different tab or non-obvious link)"
          : "Standard prerequisite (same tab)";
        const pIconUrl = pr ? getResearchIconDataUrl(pr) : null;
        const pIconHtml = pIconUrl
          ? `<img class="rel-item-icon" src="${pIconUrl}" alt="">`
          : "";
        li.innerHTML = `
          <div class="rel-item-left">
            ${pIconHtml}
            <div class="rel-item-main">
              <span class="rel-item-name">${pr ? pr.name : p.key}</span>
              <span class="rel-item-sub">${pr ? pr.tab : ""} · ${p.key}</span>
            </div>
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
    const unlocks = effectiveUnlocks;
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
        const uIconUrl = ur ? getResearchIconDataUrl(ur) : null;
        const uIconHtml = uIconUrl
          ? `<img class="rel-item-icon" src="${uIconUrl}" alt="">`
          : "";
        li.innerHTML = `
          <div class="rel-item-left">
            ${uIconHtml}
            <div class="rel-item-main">
              <span class="rel-item-name">${ur ? ur.name : u.key}</span>
              <span class="rel-item-sub">${ur ? ur.tab : ""} · ${u.key}</span>
            </div>
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
      const tabMaxW = r.condition_badge ? 92 : 130;
      const tabText = truncateCanvasText(ctx, r.tab, tabMaxW);
      const tabW = ctx.measureText(tabText).width + 10;
      drawRoundedRect(ctx, nx + 9, ny + 8, tabW, 15, 4);
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fill();
      ctx.fillStyle = "#b5aed4";
      ctx.textBaseline = "middle";
      ctx.fillText(tabText, nx + 14, ny + 15.5);

      // Warp / Condition badges on top-right
      let rightCursor = nx + NODE_W - 9;
      if (r.condition_badge) {
        const sText = truncateCanvasText(ctx, r.condition_badge, 108);
        const sw = ctx.measureText(sText).width + 8;
        rightCursor -= sw;
        drawRoundedRect(ctx, rightCursor, ny + 8, sw, 15, 4);
        const cat = r.condition_category || "scan";
        if (cat === "warp") {
          ctx.fillStyle = "rgba(244, 63, 94, 0.24)";
          ctx.fill();
          ctx.fillStyle = "#fda4af";
        } else if (cat === "event") {
          ctx.fillStyle = "rgba(245, 158, 11, 0.24)";
          ctx.fill();
          ctx.fillStyle = "#fcd34d";
        } else if (cat === "kami") {
          ctx.fillStyle = "rgba(168, 85, 247, 0.26)";
          ctx.fill();
          ctx.fillStyle = "#e9d5ff";
        } else {
          ctx.fillStyle = "rgba(16, 185, 129, 0.22)";
          ctx.fill();
          ctx.fillStyle = "#6ee7b7";
        }
        ctx.fillText(sText, rightCursor + 4, ny + 15.5);
        rightCursor -= 4;
      }
      const displayWarp = r.is_kami_bundle ? r.kami_total_warp || 0 : r.warp || 0;
      if (displayWarp > 0) {
        const wText = `W:${displayWarp}`;
        const ww = ctx.measureText(wText).width + 8;
        rightCursor -= ww;
        drawRoundedRect(ctx, rightCursor, ny + 8, ww, 15, 4);
        ctx.fillStyle = "rgba(244, 63, 94, 0.24)";
        ctx.fill();
        ctx.fillStyle = "#fda4af";
        ctx.fillText(wText, rightCursor + 4, ny + 15.5);
      }

      // Research Icon & Name
      const iconImg = getResearchIconImageEl(r);
      let nameStartX = nx + 9;
      let nameMaxW = NODE_W - 18;
      if (iconImg && iconImg.complete && iconImg.naturalWidth > 0) {
        drawRoundedRect(ctx, nx + 9, ny + 28, 24, 24, 4);
        ctx.fillStyle = "rgba(11, 9, 20, 0.65)";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
        ctx.stroke();
        const prevSmooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(iconImg, nx + 11, ny + 30, 20, 20);
        ctx.imageSmoothingEnabled = prevSmooth;
        nameStartX = nx + 38;
        nameMaxW = NODE_W - 47;
      }

      ctx.font = "700 11.5px Inter, sans-serif";
      ctx.fillStyle = "#f1effa";
      const nameText = truncateCanvasText(ctx, r.name, nameMaxW);
      ctx.fillText(nameText, nameStartX, ny + 41);

      // Bottom bar: Key & Vis cost
      ctx.font = "500 9.5px monospace";
      ctx.fillStyle = "#78709c";
      const keyText = truncateCanvasText(ctx, r.key, 130);
      ctx.fillText(keyText, nx + 9, ny + NODE_H - 12);

      let visText = "Free";
      if (r.is_kami_bundle) {
        visText = `${(r.kami_total_vis || 0).toLocaleString()} vis`;
      } else if (r.vis > 0) {
        visText = `${r.vis} vis`;
      } else if (r.always_known) {
        visText = "Always known";
      } else if (r.condition_category === "warp" || r.condition_category === "event") {
        visText = "Event unlock";
      }
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
    const activePointers = new Map();
    let lastPinchDist = null;
    let lastPinchMid = null;

    vp.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".tree-node")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const rect = vp.getBoundingClientRect();
      if (
        e.clientX - rect.left - vp.clientLeft >= vp.clientWidth ||
        e.clientY - rect.top - vp.clientTop >= vp.clientHeight
      ) {
        return;
      }
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      vp.classList.add("dragging");
      try {
        vp.setPointerCapture(e.pointerId);
      } catch (_) {}

      if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        lastPinchMid = {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2,
        };
      } else {
        lastPinchDist = null;
        lastPinchMid = null;
      }
    });

    vp.addEventListener("pointermove", (e) => {
      if (!activePointers.has(e.pointerId)) return;
      const prev = activePointers.get(e.pointerId);
      const cur = { x: e.clientX, y: e.clientY };
      activePointers.set(e.pointerId, cur);

      if (activePointers.size === 1) {
        vp.scrollLeft -= cur.x - prev.x;
        vp.scrollTop -= cur.y - prev.y;
      } else if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const mid = {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2,
        };
        if (lastPinchMid) {
          vp.scrollLeft -= mid.x - lastPinchMid.x;
          vp.scrollTop -= mid.y - lastPinchMid.y;
        }
        if (lastPinchDist && lastPinchDist > 8 && dist > 8) {
          const factor = dist / lastPinchDist;
          setZoom(zoomScale * factor, mid.x, mid.y);
        }
        lastPinchDist = dist;
        lastPinchMid = mid;
      }
    });

    const endPointer = (e) => {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) {
        lastPinchDist = null;
        lastPinchMid = null;
      }
      if (activePointers.size === 0) {
        vp.classList.remove("dragging");
      }
    };
    vp.addEventListener("pointerup", endPointer);
    vp.addEventListener("pointercancel", endPointer);

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

  function setupSidebarResizing() {
    const bindResizer = (resizerEl, side) => {
      if (!resizerEl) return;
      let dragging = false;

      resizerEl.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragging = true;
        resizerEl.classList.add("active");
        document.body.classList.add("resizing-sidebars");
        resizerEl.setPointerCapture(e.pointerId);
      });

      resizerEl.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        if (side === "left") {
          const newW = Math.max(220, Math.min(620, Math.round(e.clientX)));
          leftSidebarWidth = newW;
        } else {
          const newW = Math.max(220, Math.min(620, Math.round(window.innerWidth - e.clientX)));
          rightSidebarWidth = newW;
        }
        applySidebarLayout();
      });

      const endResize = () => {
        if (!dragging) return;
        dragging = false;
        resizerEl.classList.remove("active");
        document.body.classList.remove("resizing-sidebars");
        saveLayoutState();
      };
      resizerEl.addEventListener("pointerup", endResize);
      resizerEl.addEventListener("pointercancel", endResize);

      resizerEl.addEventListener("dblclick", () => {
        if (side === "left") {
          leftSidebarWidth = 340;
        } else {
          rightSidebarWidth = 340;
        }
        applySidebarLayout();
        saveLayoutState();
      });
    };

    bindResizer(els.leftResizer, "left");
    bindResizer(els.rightResizer, "right");
  }

  /* ==========================================================================
   * Client-Side Mod JAR / Online Texture Extraction & IndexedDB Caching
   * ========================================================================== */

  const TEXTURE_IDB_NAME = "gtnh_thaumonomicon_textures_v1";
  const TEXTURE_IDB_VERSION = 1;
  const TEXTURE_META_STORAGE_KEY = "gtnh_thaumonomicon_tex_meta_v1";

  // rawPngCache: lowercaseAssetPath -> data:image/png;base64,...
  const rawPngCache = new Map();
  // iconDataUrlCache: iconSignature -> data:image/png;base64,... (32x32 composited)
  const iconDataUrlCache = new Map();
  // iconImgElementCache: iconSignature -> HTMLImageElement
  const iconImgElementCache = new Map();

  let lastSelectedFiles = null;
  let lastTextureSourceMode = null; // 'local' | 'github'
  let isTextureJobRunning = false;

  function getIconSignature(icon) {
    if (!icon || !icon.path) return null;
    return [
      icon.path.toLowerCase(),
      icon.tint || "",
      (icon.overlay || "").toLowerCase(),
      icon.overlay_tint || "",
    ].join("|");
  }

  function getResearchIconDataUrl(r) {
    if (!r || !r.icon) return null;
    const sig = getIconSignature(r.icon);
    return sig ? iconDataUrlCache.get(sig) || null : null;
  }

  function getResearchIconImageEl(r) {
    if (!r || !r.icon) return null;
    const sig = getIconSignature(r.icon);
    return sig ? iconImgElementCache.get(sig) || null : null;
  }

  function registerCompositeIcon(sig, dataUrl) {
    iconDataUrlCache.set(sig, dataUrl);
    const img = new Image();
    img.src = dataUrl;
    iconImgElementCache.set(sig, img);
  }

  function openTextureDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(TEXTURE_IDB_NAME, TEXTURE_IDB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("raw_pngs")) {
          db.createObjectStore("raw_pngs");
        }
        if (!db.objectStoreNames.contains("icons")) {
          db.createObjectStore("icons");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB"));
    });
  }

  async function loadCachedTexturesFromStorage() {
    try {
      const db = await openTextureDb();
      await new Promise((resolve) => {
        const tx = db.transaction(["raw_pngs", "icons"], "readonly");
        const rawStore = tx.objectStore("raw_pngs");
        const iconStore = tx.objectStore("icons");

        const rawCursor = rawStore.openCursor();
        rawCursor.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            rawPngCache.set(cursor.key, cursor.value);
            cursor.continue();
          }
        };

        const iconCursor = iconStore.openCursor();
        iconCursor.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            registerCompositeIcon(cursor.key, cursor.value);
            cursor.continue();
          }
        };

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      });
    } catch (_) {
      // Fallback to localStorage if IndexedDB is blocked
      try {
        const savedIcons = localStorage.getItem("gtnh_thaumonomicon_icons_fallback_v1");
        if (savedIcons) {
          const obj = JSON.parse(savedIcons);
          for (const [k, v] of Object.entries(obj)) {
            registerCompositeIcon(k, v);
          }
        }
      } catch (_err) {}
    }

    try {
      const metaStr = localStorage.getItem(TEXTURE_META_STORAGE_KEY);
      if (metaStr) {
        const meta = JSON.parse(metaStr);
        if (meta && meta.lastSource) {
          lastTextureSourceMode = meta.lastSource;
        }
      }
    } catch (_) {}

    updateTexturesStatusUI();
  }

  async function saveTexturesToStorage() {
    try {
      const db = await openTextureDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["raw_pngs", "icons"], "readwrite");
        const rawStore = tx.objectStore("raw_pngs");
        const iconStore = tx.objectStore("icons");
        for (const [k, v] of rawPngCache.entries()) {
          rawStore.put(v, k);
        }
        for (const [k, v] of iconDataUrlCache.entries()) {
          iconStore.put(v, k);
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } catch (_) {
      try {
        const obj = {};
        for (const [k, v] of iconDataUrlCache.entries()) {
          obj[k] = v;
        }
        localStorage.setItem("gtnh_thaumonomicon_icons_fallback_v1", JSON.stringify(obj));
      } catch (_err) {}
    }

    try {
      const { resolvedResearches, totalResearches } = countResolvedResearchIcons();
      localStorage.setItem(
        TEXTURE_META_STORAGE_KEY,
        JSON.stringify({
          resolvedResearches,
          totalResearches,
          lastSource: lastTextureSourceMode,
          updatedAt: new Date().toISOString(),
        })
      );
    } catch (_) {}
  }

  async function clearCachedTextures() {
    rawPngCache.clear();
    iconDataUrlCache.clear();
    iconImgElementCache.clear();
    lastSelectedFiles = null;
    lastTextureSourceMode = null;

    try {
      localStorage.removeItem(TEXTURE_META_STORAGE_KEY);
      localStorage.removeItem("gtnh_thaumonomicon_icons_fallback_v1");
    } catch (_) {}

    try {
      const db = await openTextureDb();
      await new Promise((resolve) => {
        const tx = db.transaction(["raw_pngs", "icons"], "readwrite");
        tx.objectStore("raw_pngs").clear();
        tx.objectStore("icons").clear();
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      });
    } catch (_) {}

    updateTexturesStatusUI("Cleared all cached textures from browser storage.");
    refreshAllViewsWithIcons();
  }

  function countResolvedResearchIcons() {
    let resolvedResearches = 0;
    const totalResearches = allResearches.length;
    for (const r of allResearches) {
      if (getResearchIconDataUrl(r)) {
        resolvedResearches++;
      }
    }
    return { resolvedResearches, totalResearches };
  }

  function updateTexturesStatusUI(customDetailText) {
    const { resolvedResearches, totalResearches } = countResolvedResearchIcons();

    if (els.texturesCacheSummary) {
      els.texturesCacheSummary.textContent = `${resolvedResearches.toLocaleString()} / ${totalResearches.toLocaleString()} research icons cached`;
    }

    if (els.texturesStatusDot && els.texturesBtnLabel && els.texturesCacheBadge) {
      els.texturesStatusDot.classList.remove("partial", "loaded");
      els.texturesCacheBadge.classList.remove("partial", "loaded");

      if (resolvedResearches === 0) {
        els.texturesBtnLabel.textContent = "Load textures";
        els.texturesCacheBadge.textContent = "Not loaded";
      } else if (resolvedResearches >= totalResearches) {
        els.texturesStatusDot.classList.add("loaded");
        els.texturesCacheBadge.classList.add("loaded");
        els.texturesBtnLabel.textContent = "Textures (100%)";
        els.texturesCacheBadge.textContent = "100% cached";
      } else {
        const pct = Math.round((resolvedResearches / Math.max(1, totalResearches)) * 100);
        els.texturesStatusDot.classList.add("partial");
        els.texturesCacheBadge.classList.add("partial");
        els.texturesBtnLabel.textContent = `Textures (${pct}%)`;
        els.texturesCacheBadge.textContent = `${pct}% cached`;
      }
    }

    if (els.texturesStatusDetail) {
      if (customDetailText) {
        els.texturesStatusDetail.textContent = customDetailText;
      } else if (resolvedResearches === 0) {
        els.texturesStatusDetail.textContent =
          "No textures are currently cached in browser storage. Choose a source below to load icons.";
      } else if (resolvedResearches >= totalResearches) {
        els.texturesStatusDetail.textContent =
          "All 1,135 research icons are cached in browser storage and ready for offline use.";
      } else {
        els.texturesStatusDetail.textContent = `${resolvedResearches.toLocaleString()} icons cached in browser storage. Select a local GTNH mods/ directory to load any remaining closed-source mod icons.`;
      }
    }
  }

  function setTextureProgress(visible, fraction, detailText) {
    if (els.texturesProgressTrack && els.texturesProgressFill) {
      els.texturesProgressTrack.hidden = !visible;
      const pct = Math.max(0, Math.min(100, Math.round((fraction || 0) * 100)));
      els.texturesProgressFill.style.width = `${pct}%`;
    }
    if (detailText && els.texturesStatusDetail) {
      els.texturesStatusDetail.textContent = detailText;
    }
  }

  function collectAllNeededAssetPaths() {
    // Returns Map<lowercasePath, { path: originalPath, jar: referenceJar }>
    const needed = new Map();
    const addEntry = (pathStr, jarStr) => {
      if (!pathStr) return;
      const key = pathStr.toLowerCase();
      if (!needed.has(key)) {
        needed.set(key, { path: pathStr, jar: jarStr || "" });
      }
    };
    for (const r of allResearches) {
      if (r.icon) {
        addEntry(r.icon.path, r.icon.jar);
        if (r.icon.overlay) {
          addEntry(r.icon.overlay, r.icon.jar);
        }
      }
    }
    if (rawData && rawData.tab_icons) {
      for (const ti of Object.values(rawData.tab_icons)) {
        if (ti && ti.path) {
          addEntry(ti.path, ti.jar);
        }
      }
    }
    return needed;
  }

  function uint8ToBase64DataUrl(bytes, mime = "image/png") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const sub = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, sub);
    }
    return `data:${mime};base64,${btoa(binary)}`;
  }

  async function inflateRawBytes(compressedBytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("DecompressionStream API is required to read compressed JAR entries");
    }
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([compressedBytes]).stream().pipeThrough(ds);
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  /**
   * Scans a single ZIP/JAR Blob using only its End-of-Central-Directory (EOCD)
   * and Central Directory slice, extracting only entries matching neededPaths
   * (or nested mod JARs if scanning a modpack .zip archive).
   */
  async function extractMatchingEntriesFromZipBlob(blob, neededLowerSet, nestedJarPrefixes, depth = 0) {
    const size = blob.size;
    if (size < 22) return 0;

    const tailLen = Math.min(size, 65558);
    const tailBuf = await blob.slice(size - tailLen, size).arrayBuffer();
    const tailView = new DataView(tailBuf);

    let eocdPos = -1;
    for (let p = tailLen - 22; p >= 0; p--) {
      if (tailView.getUint32(p, true) === 0x06054b50) {
        eocdPos = p;
        break;
      }
    }
    if (eocdPos < 0) return 0;

    const cdSize = tailView.getUint32(eocdPos + 12, true);
    const cdOffset = tailView.getUint32(eocdPos + 16, true);
    if (cdOffset + cdSize > size) return 0;

    const cdBuf = await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
    const cdView = new DataView(cdBuf);
    const decoder = new TextDecoder("utf-8");

    const matchingEntries = [];
    const nestedJars = [];
    let ptr = 0;

    while (ptr + 46 <= cdSize) {
      if (cdView.getUint32(ptr, true) !== 0x02014b50) break;
      const method = cdView.getUint16(ptr + 10, true);
      const compSize = cdView.getUint32(ptr + 20, true);
      const nameLen = cdView.getUint16(ptr + 28, true);
      const extraLen = cdView.getUint16(ptr + 30, true);
      const commentLen = cdView.getUint16(ptr + 32, true);
      const localHeaderOffset = cdView.getUint32(ptr + 42, true);

      if (ptr + 46 + nameLen > cdSize) break;
      const rawName = decoder.decode(new Uint8Array(cdBuf, ptr + 46, nameLen));
      const normLower = rawName.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();

      if (
        (method === 0 || method === 8) &&
        neededLowerSet.has(normLower) &&
        !rawPngCache.has(normLower)
      ) {
        matchingEntries.push({ normLower, method, compSize, nameLen, localHeaderOffset });
      } else if (
        depth === 0 &&
        (method === 0 || method === 8) &&
        normLower.endsWith(".jar")
      ) {
        const baseJar = normLower.split("/").pop();
        if (nestedJarPrefixes.some((pref) => baseJar.startsWith(pref))) {
          nestedJars.push({ baseJar, method, compSize, nameLen, localHeaderOffset });
        }
      }

      ptr += 46 + nameLen + extraLen + commentLen;
    }

    let extractedCount = 0;

    const readEntryBytes = async (entry) => {
      const readLen = 30 + entry.nameLen + 256 + entry.compSize;
      const lfBuf = await blob
        .slice(entry.localHeaderOffset, Math.min(size, entry.localHeaderOffset + readLen))
        .arrayBuffer();
      const lfView = new DataView(lfBuf);
      if (lfView.getUint32(0, true) !== 0x04034b50) return null;
      const lfNameLen = lfView.getUint16(26, true);
      const lfExtraLen = lfView.getUint16(28, true);
      const dataStart = 30 + lfNameLen + lfExtraLen;
      if (dataStart + entry.compSize > lfBuf.byteLength) {
        const exactBuf = await blob
          .slice(
            entry.localHeaderOffset + dataStart,
            entry.localHeaderOffset + dataStart + entry.compSize
          )
          .arrayBuffer();
        const compBytes = new Uint8Array(exactBuf);
        return entry.method === 0 ? compBytes : await inflateRawBytes(compBytes);
      }
      const compBytes = new Uint8Array(lfBuf, dataStart, entry.compSize);
      return entry.method === 0 ? compBytes : await inflateRawBytes(compBytes);
    };

    for (const entry of matchingEntries) {
      try {
        const rawBytes = await readEntryBytes(entry);
        if (rawBytes && rawBytes.length > 0) {
          rawPngCache.set(entry.normLower, uint8ToBase64DataUrl(rawBytes, "image/png"));
          extractedCount++;
        }
      } catch (_) {}
    }

    // If the user selected a modpack .zip that contains nested mods/*.jar, scan those too
    for (const nested of nestedJars) {
      if (rawPngCache.size >= neededLowerSet.size) break;
      try {
        const jarBytes = await readEntryBytes(nested);
        if (jarBytes && jarBytes.length > 22) {
          const nestedBlob = new Blob([jarBytes]);
          extractedCount += await extractMatchingEntriesFromZipBlob(
            nestedBlob,
            neededLowerSet,
            nestedJarPrefixes,
            depth + 1
          );
        }
      } catch (_) {}
    }

    return extractedCount;
  }

  function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = dataUrl;
    });
  }

  function parseHexRgb(hexStr) {
    if (!hexStr) return null;
    const clean = hexStr.replace(/^#/, "").trim();
    if (clean.length !== 6) return null;
    const num = parseInt(clean, 16);
    if (Number.isNaN(num)) return null;
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function drawLayerToCanvas32(targetCtx, img, tintHex) {
    const srcW = Math.max(1, img.naturalWidth || img.width || 16);
    const srcH = Math.max(1, img.naturalHeight || img.height || 16);
    // Minecraft animated textures are vertical strips (height is a multiple of width); crop frame 0
    const cropW = srcW;
    const cropH = srcH > srcW && srcH % srcW === 0 ? srcW : srcH;

    const rgb = parseHexRgb(tintHex);
    if (!rgb) {
      targetCtx.imageSmoothingEnabled = false;
      targetCtx.drawImage(img, 0, 0, cropW, cropH, 0, 0, 32, 32);
      return;
    }

    // Apply OpenGL GL_MODULATE per-pixel RGB tint multiplication
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = 32;
    tmpCanvas.height = 32;
    const tmpCtx = tmpCanvas.getContext("2d");
    tmpCtx.imageSmoothingEnabled = false;
    tmpCtx.drawImage(img, 0, 0, cropW, cropH, 0, 0, 32, 32);

    const imgData = tmpCtx.getImageData(0, 0, 32, 32);
    const data = imgData.data;
    const [tr, tg, tb] = rgb;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) {
        data[i] = Math.round((data[i] * tr) / 255);
        data[i + 1] = Math.round((data[i + 1] * tg) / 255);
        data[i + 2] = Math.round((data[i + 2] * tb) / 255);
      }
    }
    tmpCtx.putImageData(imgData, 0, 0);
    targetCtx.drawImage(tmpCanvas, 0, 0);
  }

  async function rebuildCompositeIconsFromRawPngs() {
    const uniqueIcons = new Map();
    for (const r of allResearches) {
      if (r.icon && r.icon.path) {
        const sig = getIconSignature(r.icon);
        if (sig && !uniqueIcons.has(sig)) {
          uniqueIcons.set(sig, r.icon);
        }
      }
    }
    if (rawData && rawData.tab_icons) {
      for (const ti of Object.values(rawData.tab_icons)) {
        if (ti && ti.path) {
          const sig = getIconSignature(ti);
          if (sig && !uniqueIcons.has(sig)) {
            uniqueIcons.set(sig, ti);
          }
        }
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");

    for (const [sig, icon] of uniqueIcons.entries()) {
      const baseKey = icon.path.toLowerCase();
      if (!rawPngCache.has(baseKey)) continue;
      if (icon.overlay && !rawPngCache.has(icon.overlay.toLowerCase())) {
        // Still allow rendering base if overlay is missing, or composite overlay if present
      }
      try {
        const baseImg = await loadImageFromDataUrl(rawPngCache.get(baseKey));
        ctx.clearRect(0, 0, 32, 32);
        drawLayerToCanvas32(ctx, baseImg, icon.tint);

        if (icon.overlay) {
          const overKey = icon.overlay.toLowerCase();
          if (rawPngCache.has(overKey)) {
            const overImg = await loadImageFromDataUrl(rawPngCache.get(overKey));
            drawLayerToCanvas32(ctx, overImg, icon.overlay_tint);
          }
        }

        const finalDataUrl = canvas.toDataURL("image/png");
        registerCompositeIcon(sig, finalDataUrl);
      } catch (_) {}
    }
  }

  async function fetchMissingTexturesFromGitHub(onlyMissing = true) {
    if (!rawData || !rawData.github_bases) return 0;
    const neededMap = collectAllNeededAssetPaths();
    const ghBases = rawData.github_bases;

    const tasks = [];
    for (const [lowerPath, info] of neededMap.entries()) {
      if (onlyMissing && rawPngCache.has(lowerPath)) continue;
      const baseUrl = ghBases[info.jar];
      if (!baseUrl) continue;
      tasks.push({
        lowerPath,
        url: `${baseUrl}/${info.path}`,
      });
    }

    if (tasks.length === 0) return 0;

    let completed = 0;
    let fetched = 0;
    const total = tasks.length;
    const CONCURRENCY = 12;
    let idx = 0;

    const worker = async () => {
      while (idx < total) {
        const cur = tasks[idx++];
        try {
          const resp = await fetch(cur.url);
          if (resp.ok) {
            const ab = await resp.arrayBuffer();
            const bytes = new Uint8Array(ab);
            if (bytes.length > 0) {
              rawPngCache.set(cur.lowerPath, uint8ToBase64DataUrl(bytes, "image/png"));
              fetched++;
            }
          }
        } catch (_) {}
        completed++;
        if (completed % 5 === 0 || completed === total) {
          setTextureProgress(
            true,
            completed / total,
            `Fetching open-source textures from GitHub (${completed} / ${total})…`
          );
        }
      }
    };

    const workers = [];
    for (let w = 0; w < Math.min(CONCURRENCY, total); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return fetched;
  }

  async function processSelectedFilesForTextures(fileList) {
    if (!fileList || fileList.length === 0 || isTextureJobRunning) return;
    isTextureJobRunning = true;
    lastSelectedFiles = Array.from(fileList);
    lastTextureSourceMode = "local";

    try {
      const neededMap = collectAllNeededAssetPaths();
      const neededLowerSet = new Set(neededMap.keys());

      // Collect known JAR filename prefixes (lowercase, first 8 chars) to prioritize relevant mod JARs
      const knownJarPrefixes = [];
      const seenPref = new Set();
      for (const info of neededMap.values()) {
        if (info.jar) {
          const pref = info.jar.toLowerCase().slice(0, 7);
          if (pref && !seenPref.has(pref)) {
            seenPref.add(pref);
            knownJarPrefixes.push(pref);
          }
        }
      }

      const directPngFiles = [];
      const priorityArchives = [];
      const otherArchives = [];

      for (const file of lastSelectedFiles) {
        const nameLower = (file.name || "").toLowerCase();
        const relPath = (file.webkitRelativePath || file.name || "")
          .replace(/\\/g, "/")
          .toLowerCase();

        if (nameLower.endsWith(".png")) {
          const assetsIdx = relPath.indexOf("assets/");
          if (assetsIdx >= 0) {
            const subPath = relPath.slice(assetsIdx);
            if (neededLowerSet.has(subPath)) {
              directPngFiles.push({ file, subPath });
            }
          }
        } else if (nameLower.endsWith(".jar") || nameLower.endsWith(".zip")) {
          if (knownJarPrefixes.some((p) => nameLower.startsWith(p))) {
            priorityArchives.push(file);
          } else {
            otherArchives.push(file);
          }
        }
      }

      const archivesToScan = [...priorityArchives, ...otherArchives];
      const totalItems = directPngFiles.length + archivesToScan.length;

      if (totalItems === 0) {
        updateTexturesStatusUI(
          "No .jar, .zip, or assets/ .png files found in selection. Please select your GTNH mods/ folder."
        );
        return;
      }

      let processed = 0;
      let newlyExtracted = 0;

      setTextureProgress(true, 0.02, `Scanning ${totalItems} local files…`);

      for (const item of directPngFiles) {
        try {
          const ab = await item.file.arrayBuffer();
          rawPngCache.set(item.subPath, uint8ToBase64DataUrl(new Uint8Array(ab), "image/png"));
          newlyExtracted++;
        } catch (_) {}
        processed++;
      }

      for (const jarFile of archivesToScan) {
        if (rawPngCache.size >= neededLowerSet.size) break;
        processed++;
        if (processed % 3 === 0 || processed === totalItems) {
          setTextureProgress(
            true,
            processed / totalItems,
            `Scanning ${jarFile.name} (${rawPngCache.size} / ${neededLowerSet.size} textures found)…`
          );
        }
        newlyExtracted += await extractMatchingEntriesFromZipBlob(
          jarFile,
          neededLowerSet,
          knownJarPrefixes
        );
      }

      // Optionally fetch missing vanilla 1.7.10 or open-source icons from GitHub
      if (
        els.checkFetchMissingOnline &&
        els.checkFetchMissingOnline.checked &&
        rawPngCache.size < neededLowerSet.size
      ) {
        newlyExtracted += await fetchMissingTexturesFromGitHub(true);
      }

      setTextureProgress(true, 0.95, "Compositing icons and caching in browser storage…");
      await rebuildCompositeIconsFromRawPngs();
      await saveTexturesToStorage();

      setTextureProgress(false, 1.0);
      const { resolvedResearches, totalResearches } = countResolvedResearchIcons();
      updateTexturesStatusUI(
        `Extracted ${newlyExtracted} new textures. ${resolvedResearches.toLocaleString()} / ${totalResearches.toLocaleString()} research icons are now cached in browser storage.`
      );
      refreshAllViewsWithIcons();
    } catch (err) {
      console.error("Texture extraction error:", err);
      setTextureProgress(false, 0);
      updateTexturesStatusUI(`Error extracting textures: ${err.message || err}`);
    } finally {
      isTextureJobRunning = false;
    }
  }

  async function handleFetchGitHubTexturesClick() {
    if (isTextureJobRunning) return;
    isTextureJobRunning = true;
    lastTextureSourceMode = "github";
    try {
      setTextureProgress(true, 0.02, "Connecting to GitHub raw asset repositories…");
      const fetched = await fetchMissingTexturesFromGitHub(true);
      setTextureProgress(true, 0.95, "Compositing icons and caching in browser storage…");
      await rebuildCompositeIconsFromRawPngs();
      await saveTexturesToStorage();
      setTextureProgress(false, 1.0);
      const { resolvedResearches, totalResearches } = countResolvedResearchIcons();
      updateTexturesStatusUI(
        `Fetched ${fetched} open-source textures from GitHub. ${resolvedResearches.toLocaleString()} / ${totalResearches.toLocaleString()} research icons cached.`
      );
      refreshAllViewsWithIcons();
    } catch (err) {
      console.error("GitHub texture fetch error:", err);
      setTextureProgress(false, 0);
      updateTexturesStatusUI(`Error fetching textures: ${err.message || err}`);
    } finally {
      isTextureJobRunning = false;
    }
  }

  async function handleReloadTexturesClick() {
    if (isTextureJobRunning) return;
    if (lastSelectedFiles && lastSelectedFiles.length > 0) {
      rawPngCache.clear();
      iconDataUrlCache.clear();
      iconImgElementCache.clear();
      await processSelectedFilesForTextures(lastSelectedFiles);
      return;
    }
    if (lastTextureSourceMode === "github" || rawPngCache.size === 0) {
      await handleFetchGitHubTexturesClick();
      return;
    }
    isTextureJobRunning = true;
    try {
      setTextureProgress(true, 0.5, "Re-compositing cached textures…");
      await rebuildCompositeIconsFromRawPngs();
      await saveTexturesToStorage();
      setTextureProgress(false, 1.0);
      updateTexturesStatusUI("Reloaded and re-composited all cached textures.");
      refreshAllViewsWithIcons();
    } finally {
      isTextureJobRunning = false;
    }
  }

  function refreshAllViewsWithIcons() {
    populateTabsAndPresets();
    renderSubgraph();
    renderInspector(selectedKey);
    if (els.searchDropdown && !els.searchDropdown.hidden) {
      performSearch(els.searchInput.value);
    }
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
        const dispVis = r.is_kami_bundle ? r.kami_total_vis || 0 : r.vis || 0;
        const dispPrereqs = r.is_kami_bundle
          ? r.kami_prereq_count || r.parents.length
          : getEffectiveParents(r, r.key).length;
        const sIconUrl = getResearchIconDataUrl(r);
        const sIconHtml = sIconUrl
          ? `<img class="search-option-icon" src="${sIconUrl}" alt="">`
          : "";
        li.innerHTML = `
          <div class="search-option-top">
            <span style="display:inline-flex;align-items:center;gap:0.4rem;min-width:0;">
              ${sIconHtml}
              <span class="search-option-name">${r.name}</span>
            </span>
            <span class="search-option-tab">${r.tab}</span>
          </div>
          <div class="search-option-sub">${r.key} · ${dispPrereqs} prereqs · ${dispVis.toLocaleString()} vis</div>
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

    if (els.collapseKamiCheck) {
      els.collapseKamiCheck.addEventListener("change", () => {
        collapseKami = els.collapseKamiCheck.checked;
        if (targetKey === "KAMI_UNLOCKED") {
          kamiTargetForceCollapsed = collapseKami;
        }
        saveCompletedState();
        renderSubgraph();
        renderInspector(selectedKey);
        fitGraphToViewport();
      });
    }

    if (els.btnCollapseLeft) {
      els.btnCollapseLeft.addEventListener("click", () => setSidebarCollapsed("left", true));
    }
    if (els.btnExpandLeft) {
      els.btnExpandLeft.addEventListener("click", () => setSidebarCollapsed("left", false));
    }
    if (els.btnCollapseRight) {
      els.btnCollapseRight.addEventListener("click", () => setSidebarCollapsed("right", true));
    }
    if (els.btnExpandRight) {
      els.btnExpandRight.addEventListener("click", () => setSidebarCollapsed("right", false));
    }

    if (els.mobileTabBar) {
      els.mobileTabBar.querySelectorAll(".mobile-tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const targetPanel = btn.dataset.mobilePanel || "canvas";
          // Toggle back to canvas if tapping the already open drawer tab
          if (targetPanel !== "canvas" && mobileActivePanel === targetPanel) {
            setMobilePanel("canvas");
          } else {
            setMobilePanel(targetPanel);
          }
        });
      });
    }

    if (els.mobileBackdrop) {
      els.mobileBackdrop.addEventListener("click", () => setMobilePanel("canvas"));
    }

    const openAboutDialog = () => {
      if (!els.aboutDialog) return;
      if (typeof els.aboutDialog.showModal === "function") {
        if (!els.aboutDialog.open) els.aboutDialog.showModal();
      } else {
        els.aboutDialog.setAttribute("open", "");
      }
    };

    const closeAboutDialog = () => {
      if (!els.aboutDialog) return;
      if (typeof els.aboutDialog.close === "function") {
        if (els.aboutDialog.open) els.aboutDialog.close();
      } else {
        els.aboutDialog.removeAttribute("open");
      }
    };

    if (els.btnOpenAbout) {
      els.btnOpenAbout.addEventListener("click", openAboutDialog);
    }
    if (els.btnCloseAbout) {
      els.btnCloseAbout.addEventListener("click", closeAboutDialog);
    }
    if (els.btnDismissAbout) {
      els.btnDismissAbout.addEventListener("click", closeAboutDialog);
    }
    if (els.aboutDialog) {
      els.aboutDialog.addEventListener("click", (e) => {
        if (e.target === els.aboutDialog) {
          closeAboutDialog();
        }
      });
    }

    // Textures Dialog Events
    const openTexturesDialog = () => {
      if (!els.texturesDialog) return;
      updateTexturesStatusUI();
      if (typeof els.texturesDialog.showModal === "function") {
        if (!els.texturesDialog.open) els.texturesDialog.showModal();
      } else {
        els.texturesDialog.setAttribute("open", "");
      }
    };

    const closeTexturesDialog = () => {
      if (!els.texturesDialog) return;
      if (typeof els.texturesDialog.close === "function") {
        if (els.texturesDialog.open) els.texturesDialog.close();
      } else {
        els.texturesDialog.removeAttribute("open");
      }
    };

    if (els.btnOpenTextures) {
      els.btnOpenTextures.addEventListener("click", openTexturesDialog);
    }
    if (els.btnCloseTextures) {
      els.btnCloseTextures.addEventListener("click", closeTexturesDialog);
    }
    if (els.btnDismissTextures) {
      els.btnDismissTextures.addEventListener("click", closeTexturesDialog);
    }
    if (els.texturesDialog) {
      els.texturesDialog.addEventListener("click", (e) => {
        if (e.target === els.texturesDialog) {
          closeTexturesDialog();
        }
      });
    }

    if (els.btnPickModsDir && els.inputModsDir) {
      els.btnPickModsDir.addEventListener("click", () => {
        els.inputModsDir.value = "";
        els.inputModsDir.click();
      });
      els.inputModsDir.addEventListener("change", () => {
        if (els.inputModsDir.files && els.inputModsDir.files.length > 0) {
          processSelectedFilesForTextures(els.inputModsDir.files);
        }
      });
    }

    if (els.btnPickJarFiles && els.inputJarFiles) {
      els.btnPickJarFiles.addEventListener("click", () => {
        els.inputJarFiles.value = "";
        els.inputJarFiles.click();
      });
      els.inputJarFiles.addEventListener("change", () => {
        if (els.inputJarFiles.files && els.inputJarFiles.files.length > 0) {
          processSelectedFilesForTextures(els.inputJarFiles.files);
        }
      });
    }

    if (els.texturesDropzone) {
      els.texturesDropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        els.texturesDropzone.classList.add("drag-over");
      });
      els.texturesDropzone.addEventListener("dragleave", () => {
        els.texturesDropzone.classList.remove("drag-over");
      });
      els.texturesDropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        els.texturesDropzone.classList.remove("drag-over");
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          processSelectedFilesForTextures(e.dataTransfer.files);
        }
      });
    }

    if (els.btnFetchGithubTextures) {
      els.btnFetchGithubTextures.addEventListener("click", handleFetchGitHubTexturesClick);
    }
    if (els.btnReloadTextures) {
      els.btnReloadTextures.addEventListener("click", handleReloadTexturesClick);
    }
    if (els.btnClearTextures) {
      els.btnClearTextures.addEventListener("click", clearCachedTextures);
    }

    document.addEventListener("keydown", (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "?") {
        if (els.aboutDialog && els.aboutDialog.open) {
          closeAboutDialog();
        } else {
          openAboutDialog();
        }
      } else if (e.key === "[") {
        setSidebarCollapsed("left", !leftCollapsed);
      } else if (e.key === "]") {
        setSidebarCollapsed("right", !rightCollapsed);
      } else if (e.key === "f" || e.key === "F") {
        fitGraphToViewport();
      } else if (e.key === "c" || e.key === "C") {
        centerOnNode(targetKey);
      }
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
    applySidebarLayout();
    await initData();
    await loadCachedTexturesFromStorage();
    populateTabsAndPresets();
    setupCanvasInteractions();
    setupSidebarResizing();
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
