# Graph Report - /home/rebis/projetos/software  (2026-08-11)

## Corpus Check
- 20 files · ~13,531 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 349 nodes · 615 edges · 19 communities (16 shown, 3 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Arquitetura P2P e Problemas em Aberto
- Configuração de Lint e Build
- Primitivos de Botão e Formulário
- Avatar, Presença e Ícone de Comunidade
- Entrada do App, Rotas e Toasts
- Shell, Rail e Telas da Camada 0
- TSConfig da Aplicação
- Modelo de Domínio Tipado
- TSConfig do Ambiente Node
- Modal, Menu e Skeleton
- Estrutura de Comunidades e Cargos
- Dataset Mockado de Referência
- Dependências de Runtime
- Workflow Graphify via MCP
- Stack e Estrutura do Projeto
- Placeholder do Workspace (temporário)
- Referências de Projeto TypeScript
- Servidor MCP do Graphify

## God Nodes (most connected - your core abstractions)
1. `cn()` - 20 edges
2. `compilerOptions` - 18 edges
3. `react` - 16 edges
4. `compilerOptions` - 15 edges
5. `useCommunityStore` - 13 edges
6. `Comunidade P2P (voz/vídeo/tela) — Project` - 12 edges
7. `useUiStore` - 11 edges
8. `Consulta Obrigatória ao Graphify (política de workflow)` - 10 edges
9. `AvatarColor` - 9 edges
10. `Application-Layer Multicast em Árvore (audiência maior)` - 8 edges

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

## Communities (19 total, 3 thin omitted)

### Community 0 - "Arquitetura P2P e Problemas em Aberto"
Cohesion: 0.08
Nodes (37): Keet (Holepunch reference app), Planned P2P Backend Layer, Distribuição de Arquivos Estilo Torrent, File Storage & Torrent-style Distribution, backend/ — Placeholder Backend (lógica P2P depois), Backend (Empty Placeholder — P2P logic deferred), Screen/Video Sharing, Comunidade P2P (voz/vídeo/tela) — Project (+29 more)

### Community 1 - "Configuração de Lint e Build"
Cohesion: 0.06
Nodes (31): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, devDependencies, oxlint, @types/node (+23 more)

### Community 2 - "Primitivos de Botão e Formulário"
Cohesion: 0.11
Nodes (24): Button(), ButtonProps, ButtonSize, ButtonVariant, ICON_SIZE_CLASS, SIZE_CLASS, VARIANT_CLASS, Menu() (+16 more)

### Community 3 - "Avatar, Presença e Ícone de Comunidade"
Cohesion: 0.12
Nodes (22): CommunityIcon(), CommunityIconProps, AvatarProps, AvatarSize, EMOJI_SIZE_CLASS, PRESENCE_SIZE_CLASS, SIZE_CLASS, Tooltip() (+14 more)

### Community 4 - "Entrada do App, Rotas e Toasts"
Cohesion: 0.13
Nodes (19): Ponto de montagem da aplicação (#root), Tema escuro único (dark-only v1), Interface em português do Brasil (lang=pt-BR), App(), ICON, ICON_CLASS, ToastItem(), ToastViewport() (+11 more)

### Community 5 - "Shell, Rail e Telas da Camada 0"
Cohesion: 0.21
Nodes (19): AppShell(), CommunityRail(), Avatar(), CreateCommunityModal(), Phase, validate(), EmptyHub(), JoinCommunityOverlay() (+11 more)

### Community 6 - "TSConfig da Aplicação"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 7 - "Modelo de Domínio Tipado"
Cohesion: 0.09
Nodes (22): Attachment, AttachmentKind, ChannelType, ConnectionHealth, HostStatus, Invite, Member, MeshStatus (+14 more)

### Community 8 - "TSConfig do Ambiente Node"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 9 - "Modal, Menu e Skeleton"
Cohesion: 0.13
Nodes (13): Modal(), ModalProps, ModalSize, SIZE_CLASS, Skeleton(), SkeletonProps, InvitePreview, JoinCommunityOverlayProps (+5 more)

### Community 10 - "Estrutura de Comunidades e Cargos"
Cohesion: 0.11
Nodes (16): Category, Channel, Role, ALL_PERMISSIONS, BASE_MEMBER_PERMISSIONS, CATEGORIES, CHANNELS, COMMUNITIES (+8 more)

### Community 11 - "Dataset Mockado de Referência"
Cohesion: 0.11
Nodes (16): Thread, ANA_IDENTITY, AULA_WEBRTC_ATTACHMENT, INVITE_LINK_HOST, INVITES, MEMBERS_BY_COMMUNITY, MESSAGES_BY_CHANNEL, MODERATION_LOG (+8 more)

### Community 12 - "Dependências de Runtime"
Cohesion: 0.12
Nodes (17): @fontsource-variable/inter, dependencies, @fontsource-variable/inter, lucide-react, react, react-dom, react-router-dom, tailwindcss (+9 more)

### Community 13 - "Workflow Graphify via MCP"
Cohesion: 0.22
Nodes (10): Consulta Obrigatória ao Graphify (política de workflow), get_community (MCP tool), get_neighbors (MCP tool), get_node (MCP tool), god_nodes (MCP tool), graph_stats (MCP tool), Graphify (grafo de conhecimento via MCP), /graphify . --update (comando de re-sincronização) (+2 more)

### Community 14 - "Stack e Estrutura do Projeto"
Cohesion: 0.33
Nodes (7): Project Structure: frontend/, Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand, App HTML Entry Point (index.html), Oxlint Type-Aware Configuration (oxlint-tsgolint, .oxlintrc.json), React Compiler (not enabled on this template), @vitejs/plugin-react (uses Oxc), @vitejs/plugin-react-swc (uses SWC)

## Knowledge Gaps
- **149 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `tsBuildInfoFile` (+144 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Entrada do App, Rotas e Toasts` to `Configuração de Lint e Build`, `Primitivos de Botão e Formulário`, `Avatar, Presença e Ícone de Comunidade`, `Shell, Rail e Telas da Camada 0`, `Modal, Menu e Skeleton`?**
  _High betweenness centrality (0.356) - this node is a cross-community bridge._
- **Why does `plugins` connect `Configuração de Lint e Build` to `Entrada do App, Rotas e Toasts`?**
  _High betweenness centrality (0.342) - this node is a cross-community bridge._
- **Why does `typescript` connect `Configuração de Lint e Build` to `Arquitetura P2P e Problemas em Aberto`?**
  _High betweenness centrality (0.335) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _149 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Arquitetura P2P e Problemas em Aberto` be split into smaller, more focused modules?**
  _Cohesion score 0.07507507507507508 - nodes in this community are weakly interconnected._
- **Should `Configuração de Lint e Build` be split into smaller, more focused modules?**
  _Cohesion score 0.06060606060606061 - nodes in this community are weakly interconnected._
- **Should `Primitivos de Botão e Formulário` be split into smaller, more focused modules?**
  _Cohesion score 0.10685483870967742 - nodes in this community are weakly interconnected._