# Graph Report - .  (2026-08-11)

## Corpus Check
- 10 files · ~31,013 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 538 nodes · 1259 edges · 18 communities (16 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Item de Canal, Badge e Lint
- Shell, Rail e Lista de Canais
- Mensagens: Lista, Ações e Edição
- Modelo de Domínio e Convites
- Arquitetura P2P e Problemas em Aberto
- Popover, Painel e Composer
- Stack, Dependências e Build
- Avatar, Presença e Identidade
- Busca: Motor e Palette
- TSConfig da Aplicação
- Ícone de Comunidade e Banner de Status
- TSConfig do Ambiente Node
- Entrada do App, Rotas e Toasts
- Markdown e Corpo da Mensagem
- Regras do Oxlint
- Referências de Projeto TypeScript
- Servidor MCP do Graphify

## God Nodes (most connected - your core abstractions)
1. `cn()` - 41 edges
2. `useCommunityStore` - 34 edges
3. `react` - 33 edges
4. `useUiStore` - 23 edges
5. `compilerOptions` - 18 edges
6. `compilerOptions` - 15 edges
7. `findMember()` - 15 edges
8. `useMessageStore` - 15 edges
9. `Message` - 13 edges
10. `Comunidade P2P (voz/vídeo/tela) — Project` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Comunidade P2P (voz/vídeo/tela) — Project` --semantically_similar_to--> `Keet (Holepunch reference app)`  [INFERRED] [semantically similar]
  CLAUDE.md → backend/README.md
- `frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand)` --references--> `zustand`  [EXTRACTED]
  CLAUDE.md → frontend/package.json
- `App HTML Entry Point (index.html)` --conceptually_related_to--> `Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand`  [INFERRED]
  frontend/index.html → CLAUDE.md
- `Oxlint Type-Aware Configuration (oxlint-tsgolint, .oxlintrc.json)` --conceptually_related_to--> `Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand`  [INFERRED]
  frontend/README.md → CLAUDE.md
- `React Compiler (not enabled on this template)` --conceptually_related_to--> `Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand`  [INFERRED]
  frontend/README.md → CLAUDE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Tiered Screen/Video Sharing Distribution Strategy (star / multicast tree / TURN fallback)** — claude_compartilhamento_tela_video, claude_estrela_direta, claude_multicast_tree, claude_turn_fallback [INFERRED 0.85]
- **Mandatory Graphify Knowledge-Graph Consultation Workflow** — claude_consulta_obrigatoria_graphify, claude_query_graph, claude_get_neighbors, claude_shortest_path, claude_graphify_update_command [EXTRACTED 1.00]
- **Holepunch P2P Data Stack (Hyperswarm + Hypercore + Hyperdht)** — claude_hyperswarm, claude_hypercore, claude_hyperdht, claude_holepunch [EXTRACTED 1.00]

## Communities (18 total, 2 thin omitted)

### Community 0 - "Item de Canal, Badge e Lint"
Cohesion: 0.06
Nodes (41): plugins, ChannelListItemProps, Badge(), BadgeProps, BadgeTone, TONE_CLASS, ButtonProps, ButtonSize (+33 more)

### Community 1 - "Shell, Rail e Lista de Canais"
Cohesion: 0.08
Nodes (48): AppShell(), CategorySectionProps, ChannelList(), ChannelListProps, ChannelListItem(), CommunityRail(), Button(), Category (+40 more)

### Community 2 - "Mensagens: Lista, Ações e Edição"
Cohesion: 0.07
Nodes (44): Reaction, Thread, Composer(), MessageActions(), MessageEditor(), MessageEditorProps, MessageList(), MessageListProps (+36 more)

### Community 3 - "Modelo de Domínio e Convites"
Cohesion: 0.05
Nodes (44): Attachment, AttachmentKind, ChannelType, ConnectionHealth, HostStatus, Invite, InvitePreview, MeshStatus (+36 more)

### Community 4 - "Arquitetura P2P e Problemas em Aberto"
Cohesion: 0.05
Nodes (50): Keet (Holepunch reference app), Planned P2P Backend Layer, Distribuição de Arquivos Estilo Torrent, File Storage & Torrent-style Distribution, backend/ — Placeholder Backend (lógica P2P depois), Backend (Empty Placeholder — P2P logic deferred), Screen/Video Sharing, Comunidade P2P (voz/vídeo/tela) — Project (+42 more)

### Community 5 - "Popover, Painel e Composer"
Cohesion: 0.07
Nodes (36): Popover(), PopoverProps, SlidePanel(), SlidePanelProps, Role, RoleColor, ActiveMention, attachmentKind() (+28 more)

### Community 6 - "Stack, Dependências e Build"
Cohesion: 0.04
Nodes (45): frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand), React, Tailwind CSS (@tailwindcss/vite), Vite, @fontsource-variable/inter, dependencies, @fontsource-variable/inter, lucide-react (+37 more)

### Community 7 - "Avatar, Presença e Identidade"
Cohesion: 0.13
Nodes (24): Avatar(), AvatarProps, AvatarSize, EMOJI_SIZE_CLASS, PRESENCE_SIZE_CLASS, SIZE_CLASS, AvatarColor, Identity (+16 more)

### Community 8 - "Busca: Motor e Palette"
Cohesion: 0.12
Nodes (25): Skeleton(), SkeletonProps, Member, Message, cutoffFor(), DateFilter, hasFilters(), KindFilter (+17 more)

### Community 9 - "TSConfig da Aplicação"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 10 - "Ícone de Comunidade e Banner de Status"
Cohesion: 0.15
Nodes (14): CommunityIcon(), CommunityIconProps, StatusBanner(), StatusBannerProps, StatusBannerTone, TONE, Community, ChannelViewProps (+6 more)

### Community 11 - "TSConfig do Ambiente Node"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 12 - "Entrada do App, Rotas e Toasts"
Cohesion: 0.16
Nodes (14): Ponto de montagem da aplicação (#root), Tema escuro único (dark-only v1), Interface em português do Brasil (lang=pt-BR), App(), ICON, ICON_CLASS, ToastItem(), ToastViewport() (+6 more)

### Community 13 - "Markdown e Corpo da Mensagem"
Cohesion: 0.31
Nodes (9): MessageContent(), MessageContentProps, useMentionTokens(), codeNode(), inlinePattern(), linkNode(), MENTION_CLASS, renderInline() (+1 more)

### Community 14 - "Regras do Oxlint"
Cohesion: 0.33
Nodes (5): rules, react/only-export-components, react/rules-of-hooks, $schema, warn

## Knowledge Gaps
- **189 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `tsBuildInfoFile` (+184 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Item de Canal, Badge e Lint` to `Shell, Rail e Lista de Canais`, `Mensagens: Lista, Ações e Edição`, `Modelo de Domínio e Convites`, `Popover, Painel e Composer`, `Avatar, Presença e Identidade`, `Busca: Motor e Palette`, `Ícone de Comunidade e Banner de Status`, `Entrada do App, Rotas e Toasts`, `Markdown e Corpo da Mensagem`?**
  _High betweenness centrality (0.322) - this node is a cross-community bridge._
- **Why does `plugins` connect `Item de Canal, Badge e Lint` to `Regras do Oxlint`, `Stack, Dependências e Build`?**
  _High betweenness centrality (0.279) - this node is a cross-community bridge._
- **Why does `typescript` connect `Stack, Dependências e Build` to `Item de Canal, Badge e Lint`?**
  _High betweenness centrality (0.265) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _189 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Item de Canal, Badge e Lint` be split into smaller, more focused modules?**
  _Cohesion score 0.06077694235588972 - nodes in this community are weakly interconnected._
- **Should `Shell, Rail e Lista de Canais` be split into smaller, more focused modules?**
  _Cohesion score 0.07957393483709273 - nodes in this community are weakly interconnected._
- **Should `Mensagens: Lista, Ações e Edição` be split into smaller, more focused modules?**
  _Cohesion score 0.06641604010025062 - nodes in this community are weakly interconnected._