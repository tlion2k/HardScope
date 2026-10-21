# Graph Report - HardScope  (2026-10-21)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 325 nodes · 549 edges · 14 communities (11 shown, 1 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 32 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `31a4152e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- app.js
- engine.js
- package.json
- main.js
- hardware.js
- build
- upgrade.js
- profiles.js
- analysis/validate-data.js
- setup.ps1
- report.js
- LineChart

## God Nodes (most connected - your core abstractions)
1. `esc()` - 21 edges
2. `analyze()` - 17 edges
3. `svg()` - 16 edges
4. `renderUpgrade()` - 15 edges
5. `renderProfiles()` - 12 edges
6. `apply()` - 10 edges
7. `findingHtml()` - 10 edges
8. `planUpgrades()` - 10 edges
9. `activate()` - 9 edges
10. `isDev()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `renderLive()` --calls--> `LineChart`  [EXTRACTED]
  src/renderer/app.js → src/renderer/chart.js
- `gpuStep()` --calls--> `gpuChecks()`  [EXTRACTED]
  src/analysis/upgrade.js → src/analysis/checks.js
- `platformStep()` --calls--> `platformChecks()`  [EXTRACTED]
  src/analysis/upgrade.js → src/analysis/checks.js
- `analyze()` --calls--> `cpuCheck()`  [EXTRACTED]
  src/analysis/engine.js → src/analysis/checks.js
- `analyze()` --calls--> `normalizePrefs()`  [EXTRACTED]
  src/analysis/engine.js → src/analysis/upgrade.js

## Import Cycles
- None detected.

## Communities (14 total, 1 thin omitted)

### Community 0 - "app.js"
Cohesion: 0.09
Nodes (60): activate(), activeProfile(), afterBadge(), apiSettings(), apply(), applyProfileDefaults(), applyReanalysis(), applyView() (+52 more)

### Community 1 - "engine.js"
Cohesion: 0.06
Nodes (46): gpuChecks(), platformChecks(), analyze(), analyzePcie(), analyzeRam(), analyzeStorage(), { annotate }, countBy() (+38 more)

### Community 2 - "package.json"
Cohesion: 0.05
Nodes (37): electron, electron-builder, allowScripts, electron@38.8.6, electron-winstaller@5.4.0, author, dependencies, systeminformation (+29 more)

### Community 3 - "main.js"
Cohesion: 0.07
Nodes (28): { collect }, fs, path, MEM_TYPE, asArray(), collect(), { execFile }, { MEM_TYPE, brands } (+20 more)

### Community 4 - "hardware.js"
Cohesion: 0.08
Nodes (19): liveBottleneck(), AMD_SERIES_BASE, AMD_TIER, dataInfo, gpuData, gpuVendor(), identifyCpu(), identifyGpu() (+11 more)

### Community 5 - "build"
Cohesion: 0.09
Nodes (21): build, appId, asarUnpack, directories, files, nsis, portable, productName (+13 more)

### Community 6 - "upgrade.js"
Cohesion: 0.19
Nodes (18): cpuCheck(), boardLabel(), BUDGET_ORDER, buildCompare(), { cpuCheck, gpuChecks, platformChecks }, cpuStep(), gpuMakerLabel(), gpuStep() (+10 more)

### Community 7 - "profiles.js"
Cohesion: 0.16
Nodes (17): dir, files, formatObject(), fs, line(), path, activate(), { app } (+9 more)

### Community 8 - "analysis/validate-data.js"
Cohesion: 0.14
Nodes (14): { errors, warnings }, { validate }, checkMeta(), CONF, defaults, hw, identifyIn(), SEGMENTS (+6 more)

### Community 9 - "setup.ps1"
Cohesion: 0.31
Nodes (6): Fail(), Invoke-Winget(), Ok(), Say(), Update-SessionPath(), Warn()

### Community 10 - "report.js"
Cohesion: 0.43
Nodes (6): buildReport(), checksList(), COLORS, esc(), LABELS, USAGE

## Knowledge Gaps
- **134 isolated node(s):** `BUDGETS`, `COMP`, `LIMITER`, `LIVE_STATES`, `SEV` (+129 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 157 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `build` connect `build` to `package.json`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `analyze()` connect `engine.js` to `main.js`, `hardware.js`, `upgrade.js`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **What connects `BUDGETS`, `COMP`, `LIMITER` to the rest of the system?**
  _134 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09114183307731695 - nodes in this community are weakly interconnected._
- **Should `engine.js` be split into smaller, more focused modules?**
  _Cohesion score 0.059506531204644414 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._
- **Should `main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06612685560053981 - nodes in this community are weakly interconnected._