#!/usr/bin/env python3
"""
Parses the GTNH Thaumonomicon Research Cheatsheet from the official wiki
(or a cached HTML snapshot) and exports a structured JSON dependency graph
along with an embedded JS data bundle for the standalone web explorer.

Expands the "All Kami Research" (/iskamiunlocked) prerequisite on ICHOR
into the full set of required pre-Ichor researches across Basic Information,
Thaumaturgy, Alchemy, Artifice, Golemancy, and Thaumic Tinkering, matching
ThaumicTinkerer's KamiResearchItem implementation.
"""

import argparse
import html
import json
import re
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Set

WIKI_URL = "https://wiki.gtnewhorizons.com/wiki/Thaumonomicon"

KEY_ALIASES = {
    "BASICARTIFICE": "BASICARTIFACE",
    "TB.INFUSION": "INFUSION",
    "TB.PRIMPEARL": "PRIMPEARL",
}

# The 6 Thaumonomicon tabs checked by KamiResearchItem in ThaumicTinkerer
KAMI_REQUIRED_TABS = {
    "Basic Information",
    "Thaumaturgy",
    "Alchemy",
    "Artifice",
    "Golemancy",
    "Thaumic Tinkering",
}

SPECIAL_UNLOCK_CONDITIONS: Dict[str, Dict[str, Any]] = {
    "ELDRITCHMINOR": {
        "always_known": False,
        "badge": "⚡ Warp > 25 Event",
        "category": "warp",
        "note": "Unlocked automatically during a Warp event when permanent + sticky Warp exceeds 25. Also reveals the Eldritch tab in the Thaumonomicon and grants Void Seeds.",
    },
    "ELDRITCHMAJOR": {
        "always_known": False,
        "badge": "⚡ Warp > 50 Event",
        "category": "warp",
        "note": "Unlocked automatically during a Warp event when permanent + sticky Warp exceeds 50.",
    },
    "TMELDRITCHMAJOR": {
        "always_known": False,
        "badge": "⚡ Warp > 50 Event",
        "category": "warp",
        "extra_parents": [{"key": "ELDRITCHMAJOR", "type": "Ph"}],
        "note": "Cross-tab mirror of Eldritch Revelation (ELDRITCHMAJOR) on the Eldritch tab; unlocked automatically during a Warp event when permanent + sticky Warp exceeds 50.",
    },
    "BATHSALTS": {
        "badge": "⚡ Warp > 10 Event",
        "category": "warp",
        "note": "Research clue (@BATHSALTS) is granted during a Warp event when permanent + sticky Warp exceeds 10, allowing the Purifying Bath Salts research note to be created.",
    },
    "CRIMSON": {
        "always_known": False,
        "badge": "📖 Read Crimson Rites",
        "category": "event",
        "note": "Unlocked by right-clicking while holding the Crimson Rites book (dropped by Crimson Cult Clerics and Knights).",
    },
    "CRIMSON_PHILOSOPHY": {
        "always_known": False,
        "badge": "📖 Read Crimson Rites",
        "category": "event",
        "note": "Unlocked by right-clicking while holding the Crimson Rites book (dropped by Crimson Cult Clerics and Knights).",
    },
    "ENTEROUTER": {
        "badge": "🌀 Enter Outer Lands",
        "category": "event",
        "note": "Unlocked automatically upon entering an Eldritch Obelisk portal into the Outer Lands dimension (after completing Opening the Eye).",
    },
    "FOCUSPRIMAL": {
        "badge": "🔮 Hold Primal Charm",
        "category": "event",
        "note": "Carrying a Primal Charm in your inventory randomly triggers a free research clue (@FOCUSPRIMAL).",
    },
    "ROD_profane": {
        "badge": "🪄 Break Profane Wand",
        "category": "event",
        "note": "Unlocked automatically when a Profane Wand exhausts its 25,000 vis contract and breaks.",
    },
    "ICHOR": {
        "badge": "✦ All Kami (274)",
        "category": "kami",
        "note": "Requires unlocking all 274 pre-Ichor researches across Basic Information, Thaumaturgy, Alchemy, Artifice, Golemancy, and Thaumic Tinkering (/iskamiunlocked).",
    },
    "ICHORIUM": {
        "badge": "✦ All Kami Tabs",
        "category": "kami",
        "note": "Also requires all pre-Ichor research on the core tabs and the Thaumic Tinkering tab.",
    },
    "WARP_GATE": {
        "badge": "✦ Full TT Tab",
        "category": "kami",
        "note": "If it does not unlock after completing the listed prerequisites, it requires completing the remaining research on the Thaumic Tinkering tab.",
    },
    "CREATION": {
        "badge": "⚠ Legacy / Shard",
        "category": "event",
        "note": "Legacy Tainted Magic stub originally triggered by researching Shard of Creation (replaced by CreationShardGTNH in GTNH).",
    },
    "TMNODES": {
        "extra_parents": [{"key": "NODES", "type": "Ph"}],
        "category": "mirror",
        "note": "Cross-tab mirror of Auras and Nodes (NODES) from the Basic Information tab.",
    },
}


def format_scan_badge(scans: List[Dict[str, str]]) -> str:
    if not scans:
        return ""
    first = scans[0]
    stype = first["type"]
    target = first["target"].replace("Thaumcraft.", "")
    if len(target) > 16:
        target = target[:15].rstrip() + "…"
    prefix = "🔍 Item" if stype == "SI" else ("👁 Mob" if stype == "SE" else "✧ Aspect")
    if len(scans) == 1:
        return f"{prefix}: {target}"
    return f"{prefix}: {target} (+{len(scans) - 1})"



def fetch_wiki_html(source_path: str | None = None) -> str:
    if source_path and Path(source_path).exists():
        return Path(source_path).read_text(encoding="utf-8")
    req = urllib.request.Request(
        WIKI_URL,
        headers={"User-Agent": "GTNH-Thaumonomicon-Parser/1.0 (https://github.com/mgomezch/nh-dev)"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def clean_cell_text(raw_html: str) -> str:
    text = re.sub(r"<sup[^>]*>.*?</sup>", "", raw_html, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    return " ".join(html.unescape(text).split())


def parse_cheatsheet(raw_html: str) -> Dict[str, Any]:
    idx = raw_html.find('id="Research_Cheatsheet"')
    if idx == -1:
        raise ValueError("Could not find Research_Cheatsheet section in HTML.")
    sub = raw_html[idx:]

    sections = re.split(
        r'<div class="mw-heading mw-heading3"><h3 id="([^"]+)">([^<]+)</h3></div>',
        sub,
    )

    tabs: List[str] = []
    researches: List[Dict[str, Any]] = []
    kami_dependent_keys: Set[str] = set()

    for i in range(1, len(sections), 3):
        tab_id = sections[i]
        tab_name = html.unescape(sections[i + 1]).strip()
        body = sections[i + 2]
        tabs.append(tab_name)

        m = re.search(r'<table class="wikitable"[^>]*>(.*?)</table>', body, re.S)
        if not m:
            continue
        tcontent = m.group(1)
        trs = re.findall(r"<tr[^>]*>(.*?)</tr>", tcontent, re.S)

        for tr in trs[1:]:
            tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
            if len(tds) < 6:
                continue

            name = clean_cell_text(tds[0])
            key = clean_cell_text(tds[1])
            warp_str = clean_cell_text(tds[2])
            warp = int(warp_str) if warp_str.isdigit() else 0

            raw_prereqs = re.split(r"</?div[^>]*>|<br\s*/?>", tds[3])
            prereq_lines = [clean_cell_text(p) for p in raw_prereqs if clean_cell_text(p)]

            aspects_str = clean_cell_text(tds[4])
            aspects = [
                a.strip()
                for a in aspects_str.split(",")
                if a.strip() and a.strip().lower() != "none"
            ]

            vis_str = clean_cell_text(tds[5])
            vis = int(vis_str) if vis_str.isdigit() else 0

            always_known = False
            parents: List[Dict[str, str]] = []
            seen_parents: Set[str] = set()
            scans: List[Dict[str, str]] = []
            special_notes: List[str] = []

            for p in prereq_lines:
                if p.lower() == "always known":
                    always_known = True
                elif ":" in p:
                    ptype, pval = [x.strip() for x in p.split(":", 1)]
                    resolved_val = KEY_ALIASES.get(pval, pval)
                    if ptype in ("P", "Ph"):
                        if resolved_val == "All Kami Research":
                            kami_dependent_keys.add(key)
                        else:
                            if resolved_val not in seen_parents:
                                seen_parents.add(resolved_val)
                                parents.append({"key": resolved_val, "type": ptype})
                    elif ptype in ("SI", "SE", "SA"):
                        scans.append({"type": ptype, "target": pval})
                    else:
                        special_notes.append(p)
                else:
                    special_notes.append(p)

            condition_badge = ""
            condition_category = ""
            if key in SPECIAL_UNLOCK_CONDITIONS:
                spec = SPECIAL_UNLOCK_CONDITIONS[key]
                if "always_known" in spec:
                    always_known = bool(spec["always_known"])
                for ep in spec.get("extra_parents", []):
                    if ep["key"] not in seen_parents:
                        seen_parents.add(ep["key"])
                        parents.append({"key": ep["key"], "type": ep["type"]})
                if spec.get("note"):
                    special_notes.append(spec["note"])
                if spec.get("badge"):
                    condition_badge = spec["badge"]
                if spec.get("category"):
                    condition_category = spec["category"]

            if not condition_badge and scans:
                condition_badge = format_scan_badge(scans)
                condition_category = "scan"

            researches.append(
                {
                    "key": key,
                    "name": name,
                    "tab": tab_name,
                    "tab_id": tab_id,
                    "warp": warp,
                    "vis": vis,
                    "aspects": aspects,
                    "always_known": always_known,
                    "parents": parents,
                    "scans": scans,
                    "notes": special_notes,
                    "condition_badge": condition_badge,
                    "condition_category": condition_category,
                }
            )

    by_key = {r["key"]: r for r in researches}

    # Determine all researches that transitively depend on ICHOR (post-Ichor / Kami items)
    post_ichor: Set[str] = set(kami_dependent_keys)
    changed = True
    while changed:
        changed = False
        for r in researches:
            rk = r["key"]
            if rk not in post_ichor:
                if any(p["key"] in post_ichor for p in r["parents"]):
                    post_ichor.add(rk)
                    changed = True

    # Collect all pre-Ichor researches across KAMI_REQUIRED_TABS (matches KamiResearchItem.class)
    kami_prereq_keys: List[str] = []
    for r in researches:
        rk = r["key"]
        if r["tab"] in KAMI_REQUIRED_TABS and rk not in post_ichor:
            if rk.startswith("MINILITH") or rk.endswith("KAMI"):
                continue
            kami_prereq_keys.append(rk)

    kami_prereq_set = set(kami_prereq_keys)

    # Identify which Kami prerequisites are internal dependencies of other Kami prerequisites
    # so we can mark non-terminal edges for optional visual decluttering while keeping all dependencies
    has_dependent_in_kami: Set[str] = set()
    for rk in kami_prereq_keys:
        for p in by_key[rk]["parents"]:
            if p["key"] in kami_prereq_set:
                has_dependent_in_kami.add(p["key"])

    kami_total_vis = sum(by_key[rk]["vis"] for rk in kami_prereq_keys)
    kami_total_warp = sum(by_key[rk]["warp"] for rk in kami_prereq_keys)

    kami_node_parents: List[Dict[str, Any]] = []
    for req_k in kami_prereq_keys:
        req_r = by_key[req_k]
        edge_type = "P" if req_r["tab"] == "Thaumic Tinkering" else "Ph"
        kami_node_parents.append(
            {
                "key": req_k,
                "type": edge_type,
                "via_kami": True,
                "kami_leaf": req_k not in has_dependent_in_kami,
            }
        )

    kami_node: Dict[str, Any] = {
        "key": "KAMI_UNLOCKED",
        "name": "All Kami Research",
        "tab": "Thaumic Tinkering",
        "tab_id": "Thaumic_Tinkering",
        "warp": 0,
        "vis": 0,
        "kami_total_vis": kami_total_vis,
        "kami_total_warp": kami_total_warp,
        "kami_prereq_count": len(kami_prereq_keys),
        "is_kami_bundle": True,
        "aspects": [],
        "always_known": False,
        "parents": kami_node_parents,
        "scans": [],
        "notes": [
            f"Requires completing all {len(kami_prereq_keys)} pre-Ichor researches across Basic Information, Thaumaturgy, Alchemy, Artifice, Golemancy, and Thaumic Tinkering (/iskamiunlocked)."
        ],
        "condition_badge": f"✦ {len(kami_prereq_keys)} Researches",
        "condition_category": "kami",
    }
    researches.append(kami_node)
    by_key["KAMI_UNLOCKED"] = kami_node

    # Expand All Kami Research into explicit prerequisite dependencies on ICHOR,
    # alongside the single-box KAMI_UNLOCKED bundle parent so the UI can toggle between them
    for target_k in kami_dependent_keys:
        target_r = by_key[target_k]
        existing_parent_keys = {p["key"] for p in target_r["parents"]}
        target_r["parents"].insert(
            0,
            {
                "key": "KAMI_UNLOCKED",
                "type": "Ph",
                "is_kami_bundle_edge": True,
            },
        )
        for req_k in kami_prereq_keys:
            if req_k in existing_parent_keys:
                # Already a direct parent (e.g. DIMENSIONSHARDS)
                for p in target_r["parents"]:
                    if p["key"] == req_k:
                        p["via_kami"] = True
                        p["kami_direct"] = True
                        p["kami_leaf"] = req_k not in has_dependent_in_kami
                continue
            req_r = by_key[req_k]
            edge_type = "P" if req_r["tab"] == target_r["tab"] else "Ph"
            target_r["parents"].append(
                {
                    "key": req_k,
                    "type": edge_type,
                    "via_kami": True,
                    "kami_leaf": req_k not in has_dependent_in_kami,
                }
            )

    # Build reverse edges (unlocks / children)
    for r in researches:
        r["unlocks"] = []

    for r in researches:
        for p in r["parents"]:
            pk = p["key"]
            if pk in by_key:
                entry: Dict[str, Any] = {"key": r["key"], "type": p["type"]}
                if p.get("via_kami"):
                    entry["via_kami"] = True
                if p.get("kami_direct"):
                    entry["kami_direct"] = True
                if p.get("kami_leaf"):
                    entry["kami_leaf"] = True
                if p.get("is_kami_bundle_edge"):
                    entry["is_kami_bundle_edge"] = True
                by_key[pk]["unlocks"].append(entry)

    icon_manifest_path = Path(__file__).resolve().parent.parent / "data" / "thaumonomicon_icon_paths.json"
    tab_icons: Dict[str, Any] = {}
    github_bases: Dict[str, str] = {}
    if icon_manifest_path.exists():
        icon_manifest = json.loads(icon_manifest_path.read_text(encoding="utf-8"))
        tab_icons = icon_manifest.get("tab_icons", {})
        github_bases = icon_manifest.get("github_bases", {})
        res_icons = icon_manifest.get("research_icons", {})
        for r in researches:
            ic = res_icons.get(r["key"])
            if ic:
                r["icon"] = ic

    return {
        "source_url": WIKI_URL,
        "total_researches": len(researches),
        "total_tabs": len(tabs),
        "tabs": tabs,
        "tab_icons": tab_icons,
        "github_bases": github_bases,
        "kami_prereq_keys": kami_prereq_keys,
        "researches": researches,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse GTNH Thaumonomicon Research Cheatsheet")
    parser.add_argument("--input", help="Optional path to local HTML file")
    parser.add_argument(
        "--output-json",
        default="data/thaumonomicon_researches.json",
        help="Output JSON path",
    )
    parser.add_argument(
        "--output-js",
        help="Optional output JS path that assigns window.__THAUMONOMICON_DATA__",
    )
    args = parser.parse_args()

    raw_html = fetch_wiki_html(args.input)
    data = parse_cheatsheet(raw_html)

    out_json = Path(args.output_json)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[+] Wrote {data['total_researches']} researches across {data['total_tabs']} tabs to {out_json}")

    if args.output_js:
        out_js = Path(args.output_js)
        out_js.parent.mkdir(parents=True, exist_ok=True)
        js_payload = "window.__THAUMONOMICON_DATA__ = " + json.dumps(data, ensure_ascii=False) + ";\n"
        out_js.write_text(js_payload, encoding="utf-8")
        print(f"[+] Wrote JS data bundle to {out_js}")


if __name__ == "__main__":
    main()
