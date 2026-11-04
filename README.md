# GTNH Thaumonomicon Research Tree Explorer

Interactive dependency graph and prerequisite solver for all **1,134 Thaumcraft researches** across all **27 tabs** in **GregTech: New Horizons (GTNH)**, parsed from the [GTNH Wiki Thaumonomicon Research Cheatsheet](https://wiki.gtnewhorizons.com/wiki/Thaumonomicon#Research_Cheatsheet).

**Live Web App:** <https://mgomezch.github.io/gtnh-thaumonomicon/>

## Features

- **Instant Fuzzy Search & Filtering**: Search by research name, unique key, Thaumonomicon tab, or puzzle anchor aspect.
- **Full Prerequisite DAG Visualization**: Automatically computes topological ranks and reduces edge crossings for any target research, distinguishing standard same-tab prerequisites (`P`) from hidden cross-tab links (`Ph`) and downstream unlocks.
- **KAMI Prerequisite Expansion & Single-Box Toggle**: Switch between treating `/iskamiunlocked` (`All Kami Research`) as a single summary box or expanding all 274 underlying pre-Ichor researches across Basic Information, Thaumaturgy, Alchemy, Artifice, Golemancy, and Thaumic Tinkering.
- **Special Unlock Conditions & Scan Clues**: Surfaces Warp event thresholds (`BATHSALTS` > 10, `ELDRITCHMINOR` > 25, `ELDRITCHMAJOR` > 50), item/portal triggers (*Crimson Rites*, *Outer Lands* portal, *Primal Charm*, *Profane Wand*), and all 52 Thaumometer scan requirements (`SI`, `SE`, `SA`).
- **2D Mouse & Touch Pan, Pinch-Zoom & Full-Graph PNG Export**: Smooth click-and-drag or touch panning, cursor-centered wheel/pinch zoom, collapsible and drag-resizable desktop sidebars, mobile drawer navigation, and one-click full-graph PNG download/clipboard export.
- **Ordered Unlock Checklist & Cost Calculator**: Lists the exact topological unlock sequence from *Always Known* roots to the target research, tracking remaining steps, total Research Completer vis cost, and cumulative warp severity with `localStorage` persistence.

## Attribution

- Book icon (`favicon.png`): ["Black open book"](https://commons.wikimedia.org/wiki/File:Black_open_book.png) by **Wiki test 0001** via Wikimedia Commons, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
