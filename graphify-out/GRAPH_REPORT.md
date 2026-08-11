# Graph Report - .  (2026-08-11)

## Corpus Check
- 17 files · ~17,508 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 416 nodes · 817 edges · 18 communities (16 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Mensagens do Canal em Leitura
- Arquitetura P2P e Problemas em Aberto
- Avatar, Presença e Rail de Comunidades
- Primitivos de UI: Botão, Badge e Modal
- Shell, Lista de Canais e Telas da Camada 0
- Dependências de Runtime
- Entrada do App, Rotas e Toasts
- TSConfig da Aplicação
- Configuração de Lint e Build
- Modelo de Domínio Tipado
- TSConfig do Ambiente Node
- Dataset Mockado de Referência
- Estrutura de Comunidades, Cargos e Store
- Cabeçalho e Vista do Canal de Texto
- Workflow Graphify via MCP
- Referências de Projeto TypeScript
- Servidor MCP do Graphify

## God Nodes (most connected - your core abstractions)
1. `cn()` - 29 edges
2. `useCommunityStore` - 22 edges
3. `react` - 18 edges
4. `compilerOptions` - 18 edges
5. `compilerOptions` - 15 edges
6. `Comunidade P2P (voz/vídeo/tela) — Project` - 12 edges
7. `Channel` - 12 edges
8. `useUiStore` - 11 edges
9. `Consulta Obrigatória ao Graphify (política de workflow)` - 10 edges
10. `AvatarColor` - 10 edges

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

## Communities (18 total, 2 thin omitted)

### Community 0 - "Mensagens do Canal em Leitura"
Cohesion: 0.08
Nodes (36): Attachment, AttachmentKind, Message, RoleColor, AttachmentCard(), AttachmentCardProps, availabilityLabel(), KIND_ICON (+28 more)

### Community 1 - "Arquitetura P2P e Problemas em Aberto"
Cohesion: 0.06
Nodes (44): Keet (Holepunch reference app), Planned P2P Backend Layer, Distribuição de Arquivos Estilo Torrent, File Storage & Torrent-style Distribution, backend/ — Placeholder Backend (lógica P2P depois), Backend (Empty Placeholder — P2P logic deferred), Screen/Video Sharing, Comunidade P2P (voz/vídeo/tela) — Project (+36 more)

### Community 2 - "Avatar, Presença e Rail de Comunidades"
Cohesion: 0.09
Nodes (33): CommunityIcon(), CommunityIconProps, Avatar(), AvatarProps, AvatarSize, EMOJI_SIZE_CLASS, PRESENCE_SIZE_CLASS, SIZE_CLASS (+25 more)

### Community 3 - "Primitivos de UI: Botão, Badge e Modal"
Cohesion: 0.07
Nodes (31): ChannelListItem(), Badge(), BadgeProps, BadgeTone, TONE_CLASS, ButtonProps, ButtonSize, ButtonVariant (+23 more)

### Community 4 - "Shell, Lista de Canais e Telas da Camada 0"
Cohesion: 0.14
Nodes (27): AppShell(), CategorySection(), ChannelList(), CommunityRail(), Button(), TextArea(), TextAreaProps, CreateCommunityModal() (+19 more)

### Community 5 - "Dependências de Runtime"
Cohesion: 0.07
Nodes (26): @fontsource-variable/inter, dependencies, @fontsource-variable/inter, lucide-react, react, react-dom, react-router-dom, tailwindcss (+18 more)

### Community 6 - "Entrada do App, Rotas e Toasts"
Cohesion: 0.13
Nodes (19): Ponto de montagem da aplicação (#root), Tema escuro único (dark-only v1), Interface em português do Brasil (lang=pt-BR), App(), ICON, ICON_CLASS, ToastItem(), ToastViewport() (+11 more)

### Community 7 - "TSConfig da Aplicação"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 8 - "Configuração de Lint e Build"
Cohesion: 0.09
Nodes (22): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, devDependencies, oxlint, @types/node (+14 more)

### Community 9 - "Modelo de Domínio Tipado"
Cohesion: 0.10
Nodes (19): ChannelType, ConnectionHealth, HostStatus, Invite, Member, MeshStatus, MessageDeliveryState, ModerationAction (+11 more)

### Community 10 - "TSConfig do Ambiente Node"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 11 - "Dataset Mockado de Referência"
Cohesion: 0.11
Nodes (16): ANA_IDENTITY, AULA_WEBRTC_ATTACHMENT, INVITE_LINK_HOST, INVITES, MEMBERS_BY_COMMUNITY, MESSAGES_BY_CHANNEL, MODERATION_LOG, NO_MESSAGES (+8 more)

### Community 12 - "Estrutura de Comunidades, Cargos e Store"
Cohesion: 0.13
Nodes (16): CategorySectionProps, ChannelListProps, Category, Community, Role, ALL_PERMISSIONS, BASE_MEMBER_PERMISSIONS, CATEGORIES (+8 more)

### Community 13 - "Cabeçalho e Vista do Canal de Texto"
Cohesion: 0.22
Nodes (9): ChannelListItemProps, Channel, ChannelHeader(), ChannelHeaderProps, ChannelView(), ChannelViewProps, MessageListProps, selectIsChannelReadOnly() (+1 more)

### Community 14 - "Workflow Graphify via MCP"
Cohesion: 0.22
Nodes (10): Consulta Obrigatória ao Graphify (política de workflow), get_community (MCP tool), get_neighbors (MCP tool), get_node (MCP tool), god_nodes (MCP tool), graph_stats (MCP tool), Graphify (grafo de conhecimento via MCP), /graphify . --update (comando de re-sincronização) (+2 more)

## Knowledge Gaps
- **154 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `tsBuildInfoFile` (+149 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Entrada do App, Rotas e Toasts` to `Mensagens do Canal em Leitura`, `Avatar, Presença e Rail de Comunidades`, `Primitivos de UI: Botão, Badge e Modal`, `Shell, Lista de Canais e Telas da Camada 0`, `Configuração de Lint e Build`?**
  _High betweenness centrality (0.343) - this node is a cross-community bridge._
- **Why does `plugins` connect `Configuração de Lint e Build` to `Entrada do App, Rotas e Toasts`?**
  _High betweenness centrality (0.321) - this node is a cross-community bridge._
- **Why does `typescript` connect `Configuração de Lint e Build` to `Arquitetura P2P e Problemas em Aberto`?**
  _High betweenness centrality (0.310) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _154 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Mensagens do Canal em Leitura` be split into smaller, more focused modules?**
  _Cohesion score 0.08484848484848485 - nodes in this community are weakly interconnected._
- **Should `Arquitetura P2P e Problemas em Aberto` be split into smaller, more focused modules?**
  _Cohesion score 0.0613107822410148 - nodes in this community are weakly interconnected._
- **Should `Avatar, Presença e Rail de Comunidades` be split into smaller, more focused modules?**
  _Cohesion score 0.09302325581395349 - nodes in this community are weakly interconnected._