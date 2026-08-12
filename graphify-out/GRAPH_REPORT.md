# Graph Report - .  (2026-08-12)

## Corpus Check
- 20 files · ~60,089 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 772 nodes · 2186 edges · 42 communities (40 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Menus de Canal, Menções e Membros
- Botão e Formulários de Canal
- Lista de Canais e seus Itens
- Entrada do App, Rotas e Conexão
- Shell, Rail e Cabeçalho do Canal
- Convites e Preview de Entrada
- Avatar, Identidade e Presença
- Voz: Participantes e Saída da Chamada
- Painel do Canal e Lista de Mensagens
- Índice e Filtros de Busca
- TSConfig da Aplicação
- Moderação: Log, Banidos e Timeouts
- TSConfig do Ambiente Node
- Checkbox, Toggle e Configurações
- Compartilhamento de Tela e Skeleton
- Dependências de Runtime
- Badge e Spinner
- Painel Deslizante e Banner de Status
- Ícone de Comunidade e Menu de Contexto
- Threads e Fixtures de Mensagem
- Composer e Autocomplete de Menção
- Dependências de Desenvolvimento
- Anexo e Download Estilo Torrent
- Arquitetura P2P: Voz, Tela e Arquivos
- Mensagem, Reações e Emoji
- Consulta Obrigatória ao Graphify
- Regras do Oxlint
- Ações da Mensagem, Exclusão e Saída do Host
- Camada P2P: DHT, Hypercore e Moderação
- Popover e Saúde da Árvore
- Problemas em Aberto do Multicast
- Canal de Texto e Somente-Leitura
- Stack do Frontend e Build
- Tipos de Canal e Itens de Menu
- Markdown e Corpo da Mensagem
- Backend Placeholder e Holepunch
- Metadados do package.json
- Scripts de NPM
- Estrutura do Projeto
- Referências de Projeto TypeScript
- Comunidade 40

## God Nodes (most connected - your core abstractions)
1. `useCommunityStore` - 60 edges
2. `react` - 58 edges
3. `cn()` - 56 edges
4. `useUiStore` - 43 edges
5. `Community` - 23 edges
6. `useMessageStore` - 22 edges
7. `Button()` - 21 edges
8. `findMember()` - 20 edges
9. `Channel` - 19 edges
10. `compilerOptions` - 18 edges

## Surprising Connections (you probably didn't know these)
- `Comunidade P2P (voz/vídeo/tela) — Project` --semantically_similar_to--> `Keet (Holepunch reference app)`  [INFERRED] [semantically similar]
  CLAUDE.md → backend/README.md
- `frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand)` --references--> `zustand`  [EXTRACTED]
  CLAUDE.md → frontend/package.json
- `frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand)` --references--> `typescript`  [EXTRACTED]
  CLAUDE.md → frontend/package.json
- `@vitejs/plugin-react (uses Oxc)` --conceptually_related_to--> `Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand`  [INFERRED]
  frontend/README.md → CLAUDE.md
- `@vitejs/plugin-react-swc (uses SWC)` --conceptually_related_to--> `Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand`  [INFERRED]
  frontend/README.md → CLAUDE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Tiered Screen/Video Sharing Distribution Strategy (star / multicast tree / TURN fallback)** — claude_compartilhamento_tela_video, claude_estrela_direta, claude_multicast_tree, claude_turn_fallback [INFERRED 0.85]
- **Mandatory Graphify Knowledge-Graph Consultation Workflow** — claude_consulta_obrigatoria_graphify, claude_query_graph, claude_get_neighbors, claude_shortest_path, claude_graphify_update_command [EXTRACTED 1.00]
- **Holepunch P2P Data Stack (Hyperswarm + Hypercore + Hyperdht)** — claude_hyperswarm, claude_hypercore, claude_hyperdht, claude_holepunch [EXTRACTED 1.00]

## Communities (42 total, 2 thin omitted)

### Community 0 - "Menus de Canal, Menções e Membros"
Cohesion: 0.06
Nodes (70): ChannelContextMenu(), ChannelList(), Member, filterMentionCandidates(), matches(), memberLabel(), normalize(), PRESENCE_ORDER (+62 more)

### Community 1 - "Botão e Formulários de Canal"
Cohesion: 0.05
Nodes (56): Button(), ButtonProps, ButtonSize, ButtonVariant, ICON_SIZE_CLASS, SIZE_CLASS, VARIANT_CLASS, Modal() (+48 more)

### Community 2 - "Lista de Canais e seus Itens"
Cohesion: 0.08
Nodes (43): CategorySection(), CategorySectionProps, ChannelListProps, ChannelListItem(), CommunityIconProps, useContextMenu(), Category, ChannelType (+35 more)

### Community 3 - "Entrada do App, Rotas e Conexão"
Cohesion: 0.10
Nodes (26): Ponto de montagem da aplicação (#root), Tema escuro único (dark-only v1), Interface em português do Brasil (lang=pt-BR), App(), HostStatus, MessageLinkResolver(), DevBar(), decodeMessageRef() (+18 more)

### Community 4 - "Shell, Rail e Cabeçalho do Canal"
Cohesion: 0.10
Nodes (27): AppShell(), CommunityRail(), ChannelHeader(), ChannelHeaderProps, CategoryNameModal(), ChannelDialogs(), DeleteCategoryDialog(), CreateCommunityModal() (+19 more)

### Community 5 - "Convites e Preview de Entrada"
Cohesion: 0.08
Nodes (25): InvitePreview, JoinCommunityOverlay(), JoinCommunityOverlayProps, PreviewCard(), ALL_PERMISSIONS, ANA_IDENTITY, BASE_MEMBER_PERMISSIONS, CATEGORIES (+17 more)

### Community 6 - "Avatar, Identidade e Presença"
Cohesion: 0.13
Nodes (23): AvatarProps, EMOJI_SIZE_CLASS, PRESENCE_SIZE_CLASS, SIZE_CLASS, AvatarColor, Identity, PresenceStatus, OnboardingScreen() (+15 more)

### Community 7 - "Voz: Participantes e Saída da Chamada"
Cohesion: 0.10
Nodes (23): AvatarSize, MeshStatus, ScreenShareSession, VoiceParticipant, LeaveVoiceGuard, useLeaveVoiceGuard(), LeaveVoiceConfirm(), BarControlProps (+15 more)

### Community 8 - "Painel do Canal e Lista de Mensagens"
Cohesion: 0.10
Nodes (23): ChannelInfoPanel(), EntryHeader(), MessageList(), startsNewGroup(), clock, CLOCK_AHEAD_HINT, CLOCK_SKEW_TOLERANCE_MS, daysFromToday() (+15 more)

### Community 9 - "Índice e Filtros de Busca"
Cohesion: 0.14
Nodes (23): cutoffFor(), DateFilter, hasFilters(), KindFilter, matchesKind(), normalize(), RESULTS_PER_GROUP, search() (+15 more)

### Community 10 - "TSConfig da Aplicação"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 11 - "Moderação: Log, Banidos e Timeouts"
Cohesion: 0.16
Nodes (19): ModerationAction, ACTION_ICON, describe(), ModerationTab(), ModerationTabProps, remaining(), TYPE_FILTERS, useNow() (+11 more)

### Community 12 - "TSConfig do Ambiente Node"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 13 - "Checkbox, Toggle e Configurações"
Cohesion: 0.15
Nodes (11): Avatar(), Checkbox(), CheckboxProps, Toggle(), ToggleProps, RoleColor, MentionAutocompleteProps, MentionCandidate (+3 more)

### Community 14 - "Compartilhamento de Tela e Skeleton"
Cohesion: 0.14
Nodes (13): Skeleton(), SkeletonProps, ScreenShareStage(), ShareSourceModal(), ShareSourceModalProps, SOURCES, ControlProps, VoiceOverlay() (+5 more)

### Community 15 - "Dependências de Runtime"
Cohesion: 0.12
Nodes (17): @fontsource-variable/inter, dependencies, @fontsource-variable/inter, lucide-react, react, react-dom, react-router-dom, tailwindcss (+9 more)

### Community 16 - "Badge e Spinner"
Cohesion: 0.17
Nodes (11): Badge(), BadgeProps, BadgeTone, TONE_CLASS, Spinner(), SpinnerProps, TextField(), TextFieldProps (+3 more)

### Community 17 - "Painel Deslizante e Banner de Status"
Cohesion: 0.15
Nodes (11): SlidePanel(), SlidePanelProps, StatusBanner(), StatusBannerProps, StatusBannerTone, TONE, Tabs(), TabsProps (+3 more)

### Community 18 - "Ícone de Comunidade e Menu de Contexto"
Cohesion: 0.29
Nodes (10): CommunityIcon(), Menu(), MenuProps, Tooltip(), TooltipProps, QUALITY_LABEL, ScreenShareStageProps, useCommunityUnread() (+2 more)

### Community 19 - "Threads e Fixtures de Mensagem"
Cohesion: 0.19
Nodes (10): Thread, ThreadPanel(), ThreadPanelProps, findChannelMessages(), THREADS, compose(), MessageState, SendMessageInput (+2 more)

### Community 20 - "Composer e Autocomplete de Menção"
Cohesion: 0.19
Nodes (9): ActiveMention, attachmentKind(), ComposerProps, toAttachment(), MentionAutocomplete(), mentionToken(), TypingIndicator(), escapeRegExp() (+1 more)

### Community 21 - "Dependências de Desenvolvimento"
Cohesion: 0.15
Nodes (13): devDependencies, oxlint, @types/node, @types/react, @types/react-dom, vite, @vitejs/plugin-react, oxlint (+5 more)

### Community 22 - "Anexo e Download Estilo Torrent"
Cohesion: 0.24
Nodes (10): Attachment, AttachmentKind, AttachmentCard(), AttachmentCardProps, availabilityLabel(), KIND_ICON, DownloadState, timers (+2 more)

### Community 23 - "Arquitetura P2P: Voz, Tela e Arquivos"
Cohesion: 0.22
Nodes (11): Keet (Holepunch reference app), Distribuição de Arquivos Estilo Torrent, File Storage & Torrent-style Distribution, Screen/Video Sharing, Comunidade P2P (voz/vídeo/tela) — Project, Estrela Direta (≤4-5 espectadores), WebRTC (Media Stack), Fallback TURN (NAT restritivo) (+3 more)

### Community 24 - "Mensagem, Reações e Emoji"
Cohesion: 0.24
Nodes (9): Message, Reaction, EmojiPicker(), EmojiPickerProps, EMOJIS, MessageRowProps, ReactionBar(), ReactionBarProps (+1 more)

### Community 25 - "Consulta Obrigatória ao Graphify"
Cohesion: 0.22
Nodes (10): Consulta Obrigatória ao Graphify (política de workflow), get_community (MCP tool), get_neighbors (MCP tool), get_node (MCP tool), god_nodes (MCP tool), graph_stats (MCP tool), Graphify (grafo de conhecimento via MCP), /graphify . --update (comando de re-sincronização) (+2 more)

### Community 26 - "Regras do Oxlint"
Cohesion: 0.20
Nodes (9): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, typescript, oxc, warn (+1 more)

### Community 27 - "Ações da Mensagem, Exclusão e Saída do Host"
Cohesion: 0.27
Nodes (8): MessageActions(), MessageActionsProps, DeleteChannelDialog(), HostExitDialog(), ModerationDialog(), useMessageStore, useThreadForRoot(), useThreadRoots()

### Community 28 - "Camada P2P: DHT, Hypercore e Moderação"
Cohesion: 0.31
Nodes (9): backend/ — Placeholder Backend (lógica P2P depois), Dados da Comunidade (mensagens, canais, cargos, moderação), Descoberta de Peers via DHT, Holepunch, Hypercore, Hyperdht, Hyperswarm, Problema: Moderação em Escala sem Autoridade Central (+1 more)

### Community 29 - "Popover e Saúde da Árvore"
Cohesion: 0.25
Nodes (7): Popover(), PopoverProps, RelayNode, STATUS_CLASS, STATUS_LABEL, TreeHealthPopover(), TreeHealthPopoverProps

### Community 30 - "Problemas em Aberto do Multicast"
Cohesion: 0.25
Nodes (8): Problema: Consentimento de Repasse de Upload do Espectador, Application-Layer Multicast em Árvore (audiência maior), P2Cast, Problema: CGNAT impede virar nó de repasse, Open Problem: Consent for Relaying via Viewer Upload, Open Problem: Multicast Tree Repair on Mid-Node Failure, Problema: Reparo de Árvore (nó do meio cai), SplitStream

### Community 31 - "Canal de Texto e Somente-Leitura"
Cohesion: 0.29
Nodes (6): ChannelView(), ChannelViewProps, Composer(), selectIsChannelReadOnly(), deliveryOf(), useQueuedCount()

### Community 32 - "Stack do Frontend e Build"
Cohesion: 0.33
Nodes (7): Project Structure: frontend/, Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand, App HTML Entry Point (index.html), Oxlint Type-Aware Configuration (oxlint-tsgolint, .oxlintrc.json), React Compiler (not enabled on this template), @vitejs/plugin-react (uses Oxc), @vitejs/plugin-react-swc (uses SWC)

### Community 33 - "Tipos de Canal e Itens de Menu"
Cohesion: 0.33
Nodes (6): ChannelContextMenuProps, ChannelListItemProps, MenuItem, Channel, MessageListProps, INVITE_LINK_HOST

### Community 34 - "Markdown e Corpo da Mensagem"
Cohesion: 0.48
Nodes (6): codeNode(), inlinePattern(), linkNode(), MENTION_CLASS, renderInline(), renderMarkdown()

### Community 35 - "Backend Placeholder e Holepunch"
Cohesion: 0.70
Nodes (5): Planned P2P Backend Layer, Backend (Empty Placeholder — P2P logic deferred), Current State: Frontend-only, Mocked Data, No Real Backend, Project Structure: backend/ (placeholder), Hyperswarm + Hypercore + Hyperdht (Holepunch)

### Community 36 - "Metadados do package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 37 - "Scripts de NPM"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, preview

### Community 38 - "Estrutura do Projeto"
Cohesion: 0.50
Nodes (4): frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand), React, Tailwind CSS (@tailwindcss/vite), Vite

## Knowledge Gaps
- **222 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `tsBuildInfoFile` (+217 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Comunidade P2P (voz/vídeo/tela) — Project` connect `Arquitetura P2P: Voz, Tela e Arquivos` to `Camada P2P: DHT, Hypercore e Moderação`, `Estrutura do Projeto`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **Why does `Application-Layer Multicast em Árvore (audiência maior)` connect `Problemas em Aberto do Multicast` to `Arquitetura P2P: Voz, Tela e Arquivos`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _222 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Menus de Canal, Menções e Membros` be split into smaller, more focused modules?**
  _Cohesion score 0.06296656929568321 - nodes in this community are weakly interconnected._
- **Should `Botão e Formulários de Canal` be split into smaller, more focused modules?**
  _Cohesion score 0.051643192488262914 - nodes in this community are weakly interconnected._
- **Should `Lista de Canais e seus Itens` be split into smaller, more focused modules?**
  _Cohesion score 0.07993966817496229 - nodes in this community are weakly interconnected._
- **Should `Entrada do App, Rotas e Conexão` be split into smaller, more focused modules?**
  _Cohesion score 0.09982174688057041 - nodes in this community are weakly interconnected._