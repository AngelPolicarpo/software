# Graph Report - .  (2026-08-11)

## Corpus Check
- 27 files · ~49,974 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 686 nodes · 1835 edges · 33 communities (31 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Rail, Ícone de Comunidade e Botão
- Modal, Formulário e Configurações
- Modelo de Domínio e Menções
- Item de Canal, Avatar e Badge
- Shell, Lista de Canais e Canal
- Entrada do App, Toasts e Afinador
- Voz: Barra de Chamada e Saída
- Lista de Mensagens e Formatos
- Busca: Motor e Filtros
- TSConfig da Aplicação
- Thread, Composer e Store de Mensagens
- Composer e Autocomplete de Menção
- Moderação: Log, Banidos e Timeouts
- Convites e Preview de Entrada
- TSConfig do Ambiente Node
- Dependências de Runtime
- Dependências de Desenvolvimento
- Anexo e Download Estilo Torrent
- Arquitetura P2P: Voz, Tela e Arquivos
- Markdown e Corpo da Mensagem
- Consulta Obrigatória ao Graphify
- Regras do Oxlint
- Camada P2P: DHT, Hypercore e Moderação
- Problemas em Aberto do Multicast
- Linha de Mensagem e Reações
- Stack do Frontend e Build
- Backend Placeholder e Holepunch
- Metadados do package.json
- Scripts de NPM
- Estrutura do Projeto
- Referências de Projeto TypeScript
- Servidor MCP do Graphify

## God Nodes (most connected - your core abstractions)
1. `cn()` - 54 edges
2. `react` - 51 edges
3. `useCommunityStore` - 51 edges
4. `useUiStore` - 23 edges
5. `Community` - 21 edges
6. `findMember()` - 20 edges
7. `compilerOptions` - 18 edges
8. `Button()` - 18 edges
9. `compilerOptions` - 15 edges
10. `Avatar()` - 15 edges

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

## Communities (33 total, 2 thin omitted)

### Community 0 - "Rail, Ícone de Comunidade e Botão"
Cohesion: 0.05
Nodes (60): CommunityIcon(), Button(), ButtonProps, ButtonSize, ButtonVariant, ICON_SIZE_CLASS, SIZE_CLASS, VARIANT_CLASS (+52 more)

### Community 1 - "Modal, Formulário e Configurações"
Cohesion: 0.06
Nodes (54): Checkbox(), CheckboxProps, Modal(), ModalProps, ModalSize, SIZE_CLASS, Select(), SelectOption (+46 more)

### Community 2 - "Modelo de Domínio e Menções"
Cohesion: 0.05
Nodes (56): CategorySectionProps, ChannelListProps, CommunityIconProps, Category, Community, Invite, Role, filterMentionCandidates() (+48 more)

### Community 3 - "Item de Canal, Avatar e Badge"
Cohesion: 0.07
Nodes (39): ChannelListItem(), ChannelListItemProps, Avatar(), AvatarProps, EMOJI_SIZE_CLASS, PRESENCE_SIZE_CLASS, SIZE_CLASS, Badge() (+31 more)

### Community 4 - "Shell, Lista de Canais e Canal"
Cohesion: 0.10
Nodes (32): AppShell(), CategorySection(), ChannelList(), CommunityRail(), TextArea(), ChannelHeader(), ChannelView(), ChannelViewProps (+24 more)

### Community 5 - "Entrada do App, Toasts e Afinador"
Cohesion: 0.10
Nodes (23): Ponto de montagem da aplicação (#root), Tema escuro único (dark-only v1), Interface em português do Brasil (lang=pt-BR), App(), ICON, ICON_CLASS, ToastItem(), ToastViewport() (+15 more)

### Community 6 - "Voz: Barra de Chamada e Saída"
Cohesion: 0.10
Nodes (22): AvatarSize, MeshStatus, ScreenShareSession, LeaveVoiceGuard, useLeaveVoiceGuard(), LeaveVoiceConfirm(), BarControlProps, StackProps (+14 more)

### Community 7 - "Lista de Mensagens e Formatos"
Cohesion: 0.13
Nodes (19): Channel, Message, MessageActionsProps, MessageList(), MessageListProps, startsNewGroup(), clock, daysFromToday() (+11 more)

### Community 8 - "Busca: Motor e Filtros"
Cohesion: 0.15
Nodes (21): Member, cutoffFor(), DateFilter, hasFilters(), KindFilter, matchesKind(), normalize(), RESULTS_PER_GROUP (+13 more)

### Community 9 - "TSConfig da Aplicação"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 10 - "Thread, Composer e Store de Mensagens"
Cohesion: 0.15
Nodes (18): SlidePanel(), Reaction, Thread, Composer(), DeliveryStatus(), ThreadPanel(), ThreadPanelProps, findChannelMessages() (+10 more)

### Community 11 - "Composer e Autocomplete de Menção"
Cohesion: 0.13
Nodes (14): AttachmentKind, RoleColor, ActiveMention, attachmentKind(), ComposerProps, toAttachment(), MentionAutocomplete(), MentionAutocompleteProps (+6 more)

### Community 12 - "Moderação: Log, Banidos e Timeouts"
Cohesion: 0.19
Nodes (18): ModerationAction, ACTION_ICON, describe(), ModerationTab(), remaining(), TYPE_FILTERS, useNow(), formatRelativeTime() (+10 more)

### Community 13 - "Convites e Preview de Entrada"
Cohesion: 0.14
Nodes (13): Skeleton(), SkeletonProps, InvitePreview, JoinCommunityOverlay(), JoinCommunityOverlayProps, PreviewCard(), DEMO_BANNED_CODES, findInviteByCode() (+5 more)

### Community 14 - "TSConfig do Ambiente Node"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 15 - "Dependências de Runtime"
Cohesion: 0.12
Nodes (17): @fontsource-variable/inter, dependencies, @fontsource-variable/inter, lucide-react, react, react-dom, react-router-dom, tailwindcss (+9 more)

### Community 16 - "Dependências de Desenvolvimento"
Cohesion: 0.15
Nodes (13): devDependencies, oxlint, @types/node, @types/react, @types/react-dom, vite, @vitejs/plugin-react, oxlint (+5 more)

### Community 17 - "Anexo e Download Estilo Torrent"
Cohesion: 0.27
Nodes (9): Attachment, AttachmentCard(), AttachmentCardProps, availabilityLabel(), KIND_ICON, DownloadState, timers, useDownloadStore (+1 more)

### Community 18 - "Arquitetura P2P: Voz, Tela e Arquivos"
Cohesion: 0.22
Nodes (11): Keet (Holepunch reference app), Distribuição de Arquivos Estilo Torrent, File Storage & Torrent-style Distribution, Screen/Video Sharing, Comunidade P2P (voz/vídeo/tela) — Project, Estrela Direta (≤4-5 espectadores), WebRTC (Media Stack), Fallback TURN (NAT restritivo) (+3 more)

### Community 19 - "Markdown e Corpo da Mensagem"
Cohesion: 0.31
Nodes (9): MessageContent(), MessageContentProps, useMentionTokens(), codeNode(), inlinePattern(), linkNode(), MENTION_CLASS, renderInline() (+1 more)

### Community 20 - "Consulta Obrigatória ao Graphify"
Cohesion: 0.22
Nodes (10): Consulta Obrigatória ao Graphify (política de workflow), get_community (MCP tool), get_neighbors (MCP tool), get_node (MCP tool), god_nodes (MCP tool), graph_stats (MCP tool), Graphify (grafo de conhecimento via MCP), /graphify . --update (comando de re-sincronização) (+2 more)

### Community 21 - "Regras do Oxlint"
Cohesion: 0.20
Nodes (9): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, typescript, oxc, warn (+1 more)

### Community 22 - "Camada P2P: DHT, Hypercore e Moderação"
Cohesion: 0.31
Nodes (9): backend/ — Placeholder Backend (lógica P2P depois), Dados da Comunidade (mensagens, canais, cargos, moderação), Descoberta de Peers via DHT, Holepunch, Hypercore, Hyperdht, Hyperswarm, Problema: Moderação em Escala sem Autoridade Central (+1 more)

### Community 23 - "Problemas em Aberto do Multicast"
Cohesion: 0.25
Nodes (8): Problema: Consentimento de Repasse de Upload do Espectador, Application-Layer Multicast em Árvore (audiência maior), P2Cast, Problema: CGNAT impede virar nó de repasse, Open Problem: Consent for Relaying via Viewer Upload, Open Problem: Multicast Tree Repair on Mid-Node Failure, Problema: Reparo de Árvore (nó do meio cai), SplitStream

### Community 24 - "Linha de Mensagem e Reações"
Cohesion: 0.36
Nodes (7): MessageEditor(), MessageRow(), MessageRowProps, ReplyPreview(), useAuthorLabel(), ReactionBar(), findMember()

### Community 25 - "Stack do Frontend e Build"
Cohesion: 0.33
Nodes (7): Project Structure: frontend/, Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand, App HTML Entry Point (index.html), Oxlint Type-Aware Configuration (oxlint-tsgolint, .oxlintrc.json), React Compiler (not enabled on this template), @vitejs/plugin-react (uses Oxc), @vitejs/plugin-react-swc (uses SWC)

### Community 26 - "Backend Placeholder e Holepunch"
Cohesion: 0.70
Nodes (5): Planned P2P Backend Layer, Backend (Empty Placeholder — P2P logic deferred), Current State: Frontend-only, Mocked Data, No Real Backend, Project Structure: backend/ (placeholder), Hyperswarm + Hypercore + Hyperdht (Holepunch)

### Community 27 - "Metadados do package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 28 - "Scripts de NPM"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, preview

### Community 29 - "Estrutura do Projeto"
Cohesion: 0.50
Nodes (4): frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand), React, Tailwind CSS (@tailwindcss/vite), Vite

## Knowledge Gaps
- **212 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `tsBuildInfoFile` (+207 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Comunidade P2P (voz/vídeo/tela) — Project` connect `Arquitetura P2P: Voz, Tela e Arquivos` to `Estrutura do Projeto`, `Camada P2P: DHT, Hypercore e Moderação`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **Why does `Application-Layer Multicast em Árvore (audiência maior)` connect `Problemas em Aberto do Multicast` to `Arquitetura P2P: Voz, Tela e Arquivos`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _212 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Rail, Ícone de Comunidade e Botão` be split into smaller, more focused modules?**
  _Cohesion score 0.051201671891327065 - nodes in this community are weakly interconnected._
- **Should `Modal, Formulário e Configurações` be split into smaller, more focused modules?**
  _Cohesion score 0.061457418788410885 - nodes in this community are weakly interconnected._
- **Should `Modelo de Domínio e Menções` be split into smaller, more focused modules?**
  _Cohesion score 0.054563492063492064 - nodes in this community are weakly interconnected._
- **Should `Item de Canal, Avatar e Badge` be split into smaller, more focused modules?**
  _Cohesion score 0.07227891156462585 - nodes in this community are weakly interconnected._