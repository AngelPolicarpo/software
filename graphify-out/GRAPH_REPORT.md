# Graph Report - .  (2026-08-11)

## Corpus Check
- 19 files · ~22,415 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 468 nodes · 973 edges · 21 communities (19 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Shell, Lista de Canais e Vista do Canal
- Rail, Botões e Menus
- Arquitetura P2P e Problemas em Aberto
- Lista de Mensagens e Card de Anexo
- Composer e Autocomplete de Menção
- Avatar, Presença e Onboarding
- Dependências de Runtime
- TSConfig da Aplicação
- Configuração de Lint e Build
- Modelo de Domínio Tipado
- TSConfig do Ambiente Node
- Dataset Mockado de Referência
- Entrada do App, Rotas e Toasts
- Convite: Preview e Resolução
- Store de Mensagens e Digitando
- Markdown e Corpo da Mensagem
- Workflow Graphify via MCP
- Item de Canal e Badge
- Referências de Projeto TypeScript
- Servidor MCP do Graphify

## God Nodes (most connected - your core abstractions)
1. `cn()` - 32 edges
2. `useCommunityStore` - 28 edges
3. `react` - 22 edges
4. `compilerOptions` - 18 edges
5. `compilerOptions` - 15 edges
6. `Comunidade P2P (voz/vídeo/tela) — Project` - 12 edges
7. `selectCommunity()` - 11 edges
8. `Consulta Obrigatória ao Graphify (política de workflow)` - 10 edges
9. `AvatarColor` - 10 edges
10. `Channel` - 10 edges

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

## Communities (21 total, 2 thin omitted)

### Community 0 - "Shell, Lista de Canais e Vista do Canal"
Cohesion: 0.08
Nodes (49): AppShell(), CategorySection(), CategorySectionProps, ChannelList(), ChannelListProps, CommunityRail(), Category, Community (+41 more)

### Community 1 - "Rail, Botões e Menus"
Cohesion: 0.07
Nodes (37): CommunityIcon(), CommunityIconProps, Avatar(), Button(), ButtonProps, ButtonSize, ButtonVariant, ICON_SIZE_CLASS (+29 more)

### Community 2 - "Arquitetura P2P e Problemas em Aberto"
Cohesion: 0.06
Nodes (44): Keet (Holepunch reference app), Planned P2P Backend Layer, Distribuição de Arquivos Estilo Torrent, File Storage & Torrent-style Distribution, backend/ — Placeholder Backend (lógica P2P depois), Backend (Empty Placeholder — P2P logic deferred), Screen/Video Sharing, Comunidade P2P (voz/vídeo/tela) — Project (+36 more)

### Community 3 - "Lista de Mensagens e Card de Anexo"
Cohesion: 0.10
Nodes (27): AttachmentKind, AttachmentCard(), AttachmentCardProps, availabilityLabel(), KIND_ICON, MessageList(), MessageListProps, startsNewGroup() (+19 more)

### Community 4 - "Composer e Autocomplete de Menção"
Cohesion: 0.11
Nodes (23): RoleColor, ActiveMention, attachmentKind(), Composer(), ComposerProps, toAttachment(), MentionAutocomplete(), MentionAutocompleteProps (+15 more)

### Community 5 - "Avatar, Presença e Onboarding"
Cohesion: 0.14
Nodes (22): AvatarProps, AvatarSize, EMOJI_SIZE_CLASS, PRESENCE_SIZE_CLASS, SIZE_CLASS, AvatarColor, PresenceStatus, OnboardingScreen() (+14 more)

### Community 6 - "Dependências de Runtime"
Cohesion: 0.07
Nodes (26): @fontsource-variable/inter, dependencies, @fontsource-variable/inter, lucide-react, react, react-dom, react-router-dom, tailwindcss (+18 more)

### Community 7 - "TSConfig da Aplicação"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 8 - "Configuração de Lint e Build"
Cohesion: 0.09
Nodes (22): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, devDependencies, oxlint, @types/node (+14 more)

### Community 9 - "Modelo de Domínio Tipado"
Cohesion: 0.10
Nodes (20): ChannelType, ConnectionHealth, Invite, InvitePreview, Member, MeshStatus, MessageDeliveryState, ModerationAction (+12 more)

### Community 10 - "TSConfig do Ambiente Node"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 11 - "Dataset Mockado de Referência"
Cohesion: 0.11
Nodes (16): Identity, ANA_IDENTITY, AULA_WEBRTC_ATTACHMENT, INVITE_LINK_HOST, INVITES, MESSAGES_BY_CHANNEL, MODERATION_LOG, NO_MESSAGES (+8 more)

### Community 12 - "Entrada do App, Rotas e Toasts"
Cohesion: 0.16
Nodes (14): Ponto de montagem da aplicação (#root), Tema escuro único (dark-only v1), Interface em português do Brasil (lang=pt-BR), App(), ICON, ICON_CLASS, ToastItem(), ToastViewport() (+6 more)

### Community 13 - "Convite: Preview e Resolução"
Cohesion: 0.16
Nodes (11): Skeleton(), SkeletonProps, JoinCommunityOverlayProps, PreviewCard(), DEMO_BANNED_CODES, findInviteByCode(), normalizeInviteCode(), resolveInvitePreview() (+3 more)

### Community 14 - "Store de Mensagens e Digitando"
Cohesion: 0.20
Nodes (8): Attachment, Message, TypingIndicator(), findChannelMessages(), MessageState, selectQueuedChannelIds(), SendMessageInput, useTypingIn()

### Community 15 - "Markdown e Corpo da Mensagem"
Cohesion: 0.31
Nodes (9): MessageContent(), MessageContentProps, useMentionTokens(), codeNode(), inlinePattern(), linkNode(), MENTION_CLASS, renderInline() (+1 more)

### Community 16 - "Workflow Graphify via MCP"
Cohesion: 0.22
Nodes (10): Consulta Obrigatória ao Graphify (política de workflow), get_community (MCP tool), get_neighbors (MCP tool), get_node (MCP tool), god_nodes (MCP tool), graph_stats (MCP tool), Graphify (grafo de conhecimento via MCP), /graphify . --update (comando de re-sincronização) (+2 more)

### Community 17 - "Item de Canal e Badge"
Cohesion: 0.27
Nodes (8): ChannelListItem(), ChannelListItemProps, Badge(), BadgeProps, BadgeTone, TONE_CLASS, Channel, findMember()

## Knowledge Gaps
- **169 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `tsBuildInfoFile` (+164 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Rail, Botões e Menus` to `Shell, Lista de Canais e Vista do Canal`, `Lista de Mensagens e Card de Anexo`, `Composer e Autocomplete de Menção`, `Avatar, Presença e Onboarding`, `Configuração de Lint e Build`, `Entrada do App, Rotas e Toasts`, `Convite: Preview e Resolução`, `Markdown e Corpo da Mensagem`?**
  _High betweenness centrality (0.337) - this node is a cross-community bridge._
- **Why does `plugins` connect `Configuração de Lint e Build` to `Rail, Botões e Menus`?**
  _High betweenness centrality (0.303) - this node is a cross-community bridge._
- **Why does `typescript` connect `Configuração de Lint e Build` to `Arquitetura P2P e Problemas em Aberto`?**
  _High betweenness centrality (0.290) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _169 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Shell, Lista de Canais e Vista do Canal` be split into smaller, more focused modules?**
  _Cohesion score 0.07769423558897243 - nodes in this community are weakly interconnected._
- **Should `Rail, Botões e Menus` be split into smaller, more focused modules?**
  _Cohesion score 0.07256894049346879 - nodes in this community are weakly interconnected._
- **Should `Arquitetura P2P e Problemas em Aberto` be split into smaller, more focused modules?**
  _Cohesion score 0.0613107822410148 - nodes in this community are weakly interconnected._