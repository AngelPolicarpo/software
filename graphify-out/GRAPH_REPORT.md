# Graph Report - .  (2026-08-07)

## Corpus Check
- 3 files · ~863 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 155 nodes · 169 edges · 14 communities (12 shown, 2 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- TS App Compiler Config
- TS Node Compiler Config
- P2P Backend & Community Data Vision
- Screen-Share Multicast Architecture
- Oxlint Rules Config
- Frontend Dev Dependencies
- Frontend Runtime Dependencies
- Graphify MCP Workflow Policy
- Frontend Package Scripts
- Frontend Stack & Tooling Notes
- Frontend App & Entry Point
- TS Project References
- Graphify MCP Server Registration

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 18 edges
2. `compilerOptions` - 15 edges
3. `Comunidade P2P (voz/vídeo/tela) — Project` - 12 edges
4. `Consulta Obrigatória ao Graphify (política de workflow)` - 10 edges
5. `Application-Layer Multicast em Árvore (audiência maior)` - 8 edges
6. `frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand)` - 8 edges
7. `Dados da Comunidade (mensagens, canais, cargos, moderação)` - 6 edges
8. `Screen/Video Sharing` - 6 edges
9. `Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand` - 6 edges
10. `scripts` - 5 edges

## Surprising Connections (you probably didn't know these)
- `frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand)` --references--> `zustand`  [EXTRACTED]
  CLAUDE.md → frontend/package.json
- `Comunidade P2P (voz/vídeo/tela) — Project` --semantically_similar_to--> `Keet (Holepunch reference app)`  [INFERRED] [semantically similar]
  CLAUDE.md → backend/README.md
- `frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand)` --references--> `typescript`  [EXTRACTED]
  CLAUDE.md → frontend/package.json
- `App HTML Entry Point (index.html)` --conceptually_related_to--> `Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand`  [INFERRED]
  frontend/index.html → CLAUDE.md
- `Oxlint Type-Aware Configuration (oxlint-tsgolint, .oxlintrc.json)` --conceptually_related_to--> `Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand`  [INFERRED]
  frontend/README.md → CLAUDE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Tiered Screen/Video Sharing Distribution Strategy (star / multicast tree / TURN fallback)** — claude_compartilhamento_tela_video, claude_estrela_direta, claude_multicast_tree, claude_turn_fallback [INFERRED 0.85]
- **Mandatory Graphify Knowledge-Graph Consultation Workflow** — claude_consulta_obrigatoria_graphify, claude_query_graph, claude_get_neighbors, claude_shortest_path, claude_graphify_update_command [EXTRACTED 1.00]
- **Holepunch P2P Data Stack (Hyperswarm + Hypercore + Hyperdht)** — claude_hyperswarm, claude_hypercore, claude_hyperdht, claude_holepunch [EXTRACTED 1.00]

## Communities (14 total, 2 thin omitted)

### Community 0 - "TS App Compiler Config"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 1 - "TS Node Compiler Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 2 - "P2P Backend & Community Data Vision"
Cohesion: 0.18
Nodes (18): Keet (Holepunch reference app), Planned P2P Backend Layer, Distribuição de Arquivos Estilo Torrent, File Storage & Torrent-style Distribution, backend/ — Placeholder Backend (lógica P2P depois), Backend (Empty Placeholder — P2P logic deferred), Comunidade P2P (voz/vídeo/tela) — Project, Dados da Comunidade (mensagens, canais, cargos, moderação) (+10 more)

### Community 3 - "Screen-Share Multicast Architecture"
Cohesion: 0.13
Nodes (15): Screen/Video Sharing, Problema: Consentimento de Repasse de Upload do Espectador, Estrela Direta (≤4-5 espectadores), Application-Layer Multicast em Árvore (audiência maior), P2Cast, Problema: CGNAT impede virar nó de repasse, Open Problem: Consent for Relaying via Viewer Upload, Open Problem: Multicast Tree Repair on Mid-Node Failure (+7 more)

### Community 4 - "Oxlint Rules Config"
Cohesion: 0.15
Nodes (11): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, typescript, App(), oxc (+3 more)

### Community 5 - "Frontend Dev Dependencies"
Cohesion: 0.15
Nodes (13): devDependencies, oxlint, @types/node, @types/react, @types/react-dom, vite, @vitejs/plugin-react, oxlint (+5 more)

### Community 6 - "Frontend Runtime Dependencies"
Cohesion: 0.18
Nodes (11): dependencies, react, react-dom, tailwindcss, @tailwindcss/vite, zustand, react, react-dom (+3 more)

### Community 7 - "Graphify MCP Workflow Policy"
Cohesion: 0.22
Nodes (10): Consulta Obrigatória ao Graphify (política de workflow), get_community (MCP tool), get_neighbors (MCP tool), get_node (MCP tool), god_nodes (MCP tool), graph_stats (MCP tool), Graphify (grafo de conhecimento via MCP), /graphify . --update (comando de re-sincronização) (+2 more)

### Community 8 - "Frontend Package Scripts"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, lint, preview, type (+1 more)

### Community 9 - "Frontend Stack & Tooling Notes"
Cohesion: 0.33
Nodes (7): Project Structure: frontend/, Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand, App HTML Entry Point (index.html), Oxlint Type-Aware Configuration (oxlint-tsgolint, .oxlintrc.json), React Compiler (not enabled on this template), @vitejs/plugin-react (uses Oxc), @vitejs/plugin-react-swc (uses SWC)

### Community 10 - "Frontend App & Entry Point"
Cohesion: 0.47
Nodes (6): frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand), React, Tailwind CSS (@tailwindcss/vite), Vite, frontend/index.html — Vite App Entry Point, #root Mount Div

## Knowledge Gaps
- **78 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `name` (+73 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand)` connect `Frontend App & Entry Point` to `P2P Backend & Community Data Vision`, `Oxlint Rules Config`, `Frontend Runtime Dependencies`?**
  _High betweenness centrality (0.260) - this node is a cross-community bridge._
- **Why does `Comunidade P2P (voz/vídeo/tela) — Project` connect `P2P Backend & Community Data Vision` to `Frontend App & Entry Point`, `Screen-Share Multicast Architecture`, `Graphify MCP Workflow Policy`?**
  _High betweenness centrality (0.235) - this node is a cross-community bridge._
- **Why does `typescript` connect `Oxlint Rules Config` to `Frontend App & Entry Point`?**
  _High betweenness centrality (0.184) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _78 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TS App Compiler Config` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._
- **Should `TS Node Compiler Config` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Screen-Share Multicast Architecture` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._