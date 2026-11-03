# GTNH Thaumonomicon Research Tree Explorer

Interactive dependency graph and prerequisite solver for all **1,134 Thaumcraft researches** across all **27 tabs** in **GregTech: New Horizons (GTNH)**, parsed from the [GTNH Wiki Thaumonomicon Research Cheatsheet](https://wiki.gtnewhorizons.com/wiki/Thaumonomicon#Research_Cheatsheet).

**Live Web App:** <https://mgomezch.github.io/gtnh-thaumonomicon/>

## Features

- **Instant Fuzzy Search & Filtering**: Search by research name, unique key, Thaumonomicon tab, or puzzle anchor aspect.
- **Full Prerequisite DAG Visualization**: Automatically computes topological ranks and reduces edge crossings for any target research, distinguishing standard same-tab prerequisites (`P`) from hidden cross-tab links (`Ph`) and downstream unlocks.
- **2D Mouse Pan & Cursor-Centered Zoom**: Smooth click-and-drag panning, mouse-wheel zoom anchored to the cursor, Fit Tree, Center Target, and Top-to-Bottom / Left-to-Right layout switching.
- **Ordered Unlock Checklist & Cost Calculator**: Lists the exact topological unlock sequence from *Always Known* roots to the target research, tracking remaining steps, total Research Completer vis cost, cumulative warp severity, and required Thaumometer scans (`SI`, `SE`, `SA`) with `localStorage` persistence.
- **Deep Linking**: Share or bookmark any research tree via URL hash (e.g. `#PLACEMENT_MIRROR`, `#ICHOR`, `#voidGolem`).
