# Graph Report - /home/rebis/projetos/software  (2026-08-11)

## Corpus Check
- 19 files · ~7,253 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 276 nodes · 380 edges · 16 communities (14 shown, 2 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Arquitetura P2P e Problemas em Aberto
- Dataset Mockado de Referência
- Modelo de Domínio Tipado
- Primitivos de UI e Onboarding
- Dependências de Desenvolvimento
- Avatar, Presença e Identidade Local
- TSConfig da Aplicação
- TSConfig do Ambiente Node
- Dependências de Runtime
- Entrada do App, Rotas e Convite
- Workflow Graphify via MCP
- Stack e Estrutura do Projeto
- Configuração do Oxlint
- Referências de Projeto TypeScript
- Servidor MCP do Graphify

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 18 edges
2. `compilerOptions` - 15 edges
3. `Comunidade P2P (voz/vídeo/tela) — Project` - 12 edges
4. `cn()` - 11 edges
5. `Consulta Obrigatória ao Graphify (política de workflow)` - 10 edges
6. `Application-Layer Multicast em Árvore (audiência maior)` - 8 edges
7. `frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand)` - 7 edges
8. `AvatarColor` - 7 edges
9. `OnboardingScreen()` - 7 edges
10. `useIdentityStore` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Comunidade P2P (voz/vídeo/tela) — Project` --semantically_similar_to--> `Keet (Holepunch reference app)`  [INFERRED] [semantically similar]
  CLAUDE.md → backend/README.md
- `frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand)` --references--> `zustand`  [EXTRACTED]
  CLAUDE.md → frontend/package.json
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

## Communities (16 total, 2 thin omitted)

### Community 0 - "Arquitetura P2P e Problemas em Aberto"
Cohesion: 0.08
Nodes (37): Keet (Holepunch reference app), Planned P2P Backend Layer, Distribuição de Arquivos Estilo Torrent, File Storage & Torrent-style Distribution, backend/ — Placeholder Backend (lógica P2P depois), Backend (Empty Placeholder — P2P logic deferred), Screen/Video Sharing, Comunidade P2P (voz/vídeo/tela) — Project (+29 more)

### Community 1 - "Dataset Mockado de Referência"
Cohesion: 0.07
Nodes (26): Permission, ALL_PERMISSIONS, ANA_IDENTITY, AULA_WEBRTC_ATTACHMENT, BASE_MEMBER_PERMISSIONS, CATEGORIES, CHANNELS, COMMUNITIES (+18 more)

### Community 2 - "Modelo de Domínio Tipado"
Cohesion: 0.07
Nodes (27): Attachment, AttachmentKind, Category, Channel, ChannelType, Community, ConnectionHealth, HostStatus (+19 more)

### Community 3 - "Primitivos de UI e Onboarding"
Cohesion: 0.14
Nodes (21): plugins, Button(), ButtonProps, ButtonSize, ButtonVariant, ICON_SIZE_CLASS, SIZE_CLASS, VARIANT_CLASS (+13 more)

### Community 4 - "Dependências de Desenvolvimento"
Cohesion: 0.08
Nodes (24): devDependencies, oxlint, @types/node, @types/react, @types/react-dom, typescript, vite, @vitejs/plugin-react (+16 more)

### Community 5 - "Avatar, Presença e Identidade Local"
Cohesion: 0.15
Nodes (19): Avatar(), AvatarProps, AvatarSize, EMOJI_SIZE_CLASS, PRESENCE_SIZE_CLASS, SIZE_CLASS, AvatarColor, Identity (+11 more)

### Community 6 - "TSConfig da Aplicação"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 7 - "TSConfig do Ambiente Node"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 8 - "Dependências de Runtime"
Cohesion: 0.12
Nodes (17): @fontsource-variable/inter, dependencies, @fontsource-variable/inter, lucide-react, react, react-dom, react-router-dom, tailwindcss (+9 more)

### Community 9 - "Entrada do App, Rotas e Convite"
Cohesion: 0.23
Nodes (10): Ponto de montagem da aplicação (#root), Tema escuro único (dark-only v1), Interface em português do Brasil (lang=pt-BR), App(), InviteRoute(), RootRoute(), ShellPlaceholder(), useIdentityStore (+2 more)

### Community 10 - "Workflow Graphify via MCP"
Cohesion: 0.22
Nodes (10): Consulta Obrigatória ao Graphify (política de workflow), get_community (MCP tool), get_neighbors (MCP tool), get_node (MCP tool), god_nodes (MCP tool), graph_stats (MCP tool), Graphify (grafo de conhecimento via MCP), /graphify . --update (comando de re-sincronização) (+2 more)

### Community 11 - "Stack e Estrutura do Projeto"
Cohesion: 0.33
Nodes (7): Project Structure: frontend/, Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand, App HTML Entry Point (index.html), Oxlint Type-Aware Configuration (oxlint-tsgolint, .oxlintrc.json), React Compiler (not enabled on this template), @vitejs/plugin-react (uses Oxc), @vitejs/plugin-react-swc (uses SWC)

### Community 12 - "Configuração do Oxlint"
Cohesion: 0.33
Nodes (5): rules, react/only-export-components, react/rules-of-hooks, $schema, warn

## Knowledge Gaps
- **137 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `tsBuildInfoFile` (+132 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `typescript` connect `Dependências de Desenvolvimento` to `Arquitetura P2P e Problemas em Aberto`, `Primitivos de UI e Onboarding`?**
  _High betweenness centrality (0.353) - this node is a cross-community bridge._
- **Why does `plugins` connect `Primitivos de UI e Onboarding` to `Configuração do Oxlint`, `Dependências de Desenvolvimento`?**
  _High betweenness centrality (0.349) - this node is a cross-community bridge._
- **Why does `react` connect `Primitivos de UI e Onboarding` to `Entrada do App, Rotas e Convite`?**
  _High betweenness centrality (0.344) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _137 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Arquitetura P2P e Problemas em Aberto` be split into smaller, more focused modules?**
  _Cohesion score 0.07507507507507508 - nodes in this community are weakly interconnected._
- **Should `Dataset Mockado de Referência` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `Modelo de Domínio Tipado` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._