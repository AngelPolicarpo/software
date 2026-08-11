# Graph Report - .  (2026-08-11)

## Corpus Check
- 23 files · ~40,335 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 603 nodes · 1467 edges · 41 communities (39 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Composer, Menções e Ações na Mensagem
- Shell, Rail e Lista de Canais
- Comunidades, Convites e Dataset
- Item de Canal, Badge e Barra de Chamada
- Busca: Motor e Filtros
- TSConfig da Aplicação
- TSConfig do Ambiente Node
- Entrada do App, Rotas e Toasts
- Dependências de Runtime
- Ícone de Comunidade, Menu e Tooltip
- Grade de Voz e Tiles de Participante
- Dependências de Desenvolvimento
- Avatar e Autocomplete de Menção
- Modal, Saída da Chamada e Fonte de Tela
- Modelo de Domínio
- Anexo e Download Estilo Torrent
- Arquitetura P2P: Voz, Tela e Arquivos
- Perfil, Slider e Cor de Cargo
- Markdown e Corpo da Mensagem
- Consulta Obrigatória ao Graphify
- Regras do Oxlint
- Botão e Spinner
- Painel de Membros
- Banner de Status e Palco de Compartilhamento
- Camada P2P: DHT, Hypercore e Moderação
- Onboarding e Identidade Local
- Popover e Saúde da Árvore de Distribuição
- Painel Deslizante e Campos de Texto
- Problemas em Aberto do Multicast
- Cargos e Candidatos a Menção
- Avatar: Cores, Iniciais e Presença
- Stack do Frontend e Build
- Checkbox e Consentimento de Repasse
- Identidade, Presença e Store
- Backend Placeholder e Holepunch
- Metadados do package.json
- Scripts de NPM
- Estrutura do Projeto
- Referências de Projeto TypeScript
- Servidor MCP do Graphify

## God Nodes (most connected - your core abstractions)
1. `cn()` - 48 edges
2. `react` - 40 edges
3. `useCommunityStore` - 35 edges
4. `useUiStore` - 21 edges
5. `findMember()` - 20 edges
6. `compilerOptions` - 18 edges
7. `compilerOptions` - 15 edges
8. `useMessageStore` - 14 edges
9. `Button()` - 13 edges
10. `Message` - 13 edges

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

## Communities (41 total, 2 thin omitted)

### Community 0 - "Composer, Menções e Ações na Mensagem"
Cohesion: 0.05
Nodes (54): MenuItem, ActiveMention, attachmentKind(), Composer(), ComposerProps, toAttachment(), EmojiPicker(), EmojiPickerProps (+46 more)

### Community 1 - "Shell, Rail e Lista de Canais"
Cohesion: 0.07
Nodes (51): CategorySectionProps, ChannelList(), ChannelListProps, CommunityRail(), TextArea(), TextAreaProps, Category, Permission (+43 more)

### Community 2 - "Comunidades, Convites e Dataset"
Cohesion: 0.07
Nodes (32): Community, HostStatus, InvitePreview, JoinCommunityOverlayProps, PreviewCard(), ANA_IDENTITY, AULA_WEBRTC_ATTACHMENT, DEMO_BANNED_CODES (+24 more)

### Community 3 - "Item de Canal, Badge e Barra de Chamada"
Cohesion: 0.08
Nodes (26): ChannelListItem(), ChannelListItemProps, AvatarSize, Badge(), BadgeProps, BadgeTone, TONE_CLASS, MeshStatus (+18 more)

### Community 4 - "Busca: Motor e Filtros"
Cohesion: 0.13
Nodes (24): Channel, Member, Message, cutoffFor(), DateFilter, hasFilters(), KindFilter, matchesKind() (+16 more)

### Community 5 - "TSConfig da Aplicação"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 6 - "TSConfig do Ambiente Node"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 7 - "Entrada do App, Rotas e Toasts"
Cohesion: 0.15
Nodes (15): Ponto de montagem da aplicação (#root), Tema escuro único (dark-only v1), Interface em português do Brasil (lang=pt-BR), App(), ICON, ICON_CLASS, ToastItem(), ToastViewport() (+7 more)

### Community 8 - "Dependências de Runtime"
Cohesion: 0.12
Nodes (17): @fontsource-variable/inter, dependencies, @fontsource-variable/inter, lucide-react, react, react-dom, react-router-dom, tailwindcss (+9 more)

### Community 9 - "Ícone de Comunidade, Menu e Tooltip"
Cohesion: 0.23
Nodes (8): CommunityIcon(), CommunityIconProps, Menu(), MenuProps, Tooltip(), TooltipProps, ChannelHeaderProps, ClassValue

### Community 10 - "Grade de Voz e Tiles de Participante"
Cohesion: 0.20
Nodes (10): Skeleton(), SkeletonProps, useLeaveVoiceGuard(), ControlProps, VoiceOverlay(), VoiceTile(), VoiceTileProps, VoiceTileSkeleton() (+2 more)

### Community 11 - "Dependências de Desenvolvimento"
Cohesion: 0.15
Nodes (13): devDependencies, oxlint, @types/node, @types/react, @types/react-dom, vite, @vitejs/plugin-react, oxlint (+5 more)

### Community 12 - "Avatar e Autocomplete de Menção"
Cohesion: 0.19
Nodes (9): Avatar(), AvatarProps, EMOJI_SIZE_CLASS, PRESENCE_SIZE_CLASS, SIZE_CLASS, MentionAutocomplete(), MentionAutocompleteProps, MentionCandidate (+1 more)

### Community 13 - "Modal, Saída da Chamada e Fonte de Tela"
Cohesion: 0.19
Nodes (9): Modal(), ModalProps, ModalSize, SIZE_CLASS, LeaveVoiceGuard, LeaveVoiceConfirm(), ShareSourceModal(), ShareSourceModalProps (+1 more)

### Community 14 - "Modelo de Domínio"
Cohesion: 0.15
Nodes (12): ChannelType, ConnectionHealth, Invite, MessageDeliveryState, ModerationAction, ModerationActionType, PermissionGroup, Reaction (+4 more)

### Community 15 - "Anexo e Download Estilo Torrent"
Cohesion: 0.24
Nodes (10): Attachment, AttachmentKind, AttachmentCard(), AttachmentCardProps, availabilityLabel(), KIND_ICON, DownloadState, timers (+2 more)

### Community 16 - "Arquitetura P2P: Voz, Tela e Arquivos"
Cohesion: 0.22
Nodes (11): Keet (Holepunch reference app), Distribuição de Arquivos Estilo Torrent, File Storage & Torrent-style Distribution, Screen/Video Sharing, Comunidade P2P (voz/vídeo/tela) — Project, Estrela Direta (≤4-5 espectadores), WebRTC (Media Stack), Fallback TURN (NAT restritivo) (+3 more)

### Community 17 - "Perfil, Slider e Cor de Cargo"
Cohesion: 0.22
Nodes (8): Slider(), SliderProps, RoleColor, joinedFormat, ProfilePopover(), ProfilePopoverProps, PRESENCE_LABEL, ROLE_TEXT_CLASS

### Community 18 - "Markdown e Corpo da Mensagem"
Cohesion: 0.31
Nodes (9): MessageContent(), MessageContentProps, useMentionTokens(), codeNode(), inlinePattern(), linkNode(), MENTION_CLASS, renderInline() (+1 more)

### Community 19 - "Consulta Obrigatória ao Graphify"
Cohesion: 0.22
Nodes (10): Consulta Obrigatória ao Graphify (política de workflow), get_community (MCP tool), get_neighbors (MCP tool), get_node (MCP tool), god_nodes (MCP tool), graph_stats (MCP tool), Graphify (grafo de conhecimento via MCP), /graphify . --update (comando de re-sincronização) (+2 more)

### Community 20 - "Regras do Oxlint"
Cohesion: 0.20
Nodes (9): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, typescript, oxc, warn (+1 more)

### Community 21 - "Botão e Spinner"
Cohesion: 0.22
Nodes (8): ButtonProps, ButtonSize, ButtonVariant, ICON_SIZE_CLASS, SIZE_CLASS, VARIANT_CLASS, Spinner(), SpinnerProps

### Community 22 - "Painel de Membros"
Cohesion: 0.24
Nodes (8): SlidePanel(), inVoiceIds(), MemberRowProps, MembersPanel(), MembersPanelProps, normalize(), CHANNELS, VALE_OFFLINE_MEMBER_COUNT

### Community 23 - "Banner de Status e Palco de Compartilhamento"
Cohesion: 0.24
Nodes (8): StatusBanner(), StatusBannerProps, StatusBannerTone, TONE, QUALITY_LABEL, ScreenShareStage(), ScreenShareStageProps, ActiveShare

### Community 24 - "Camada P2P: DHT, Hypercore e Moderação"
Cohesion: 0.31
Nodes (9): backend/ — Placeholder Backend (lógica P2P depois), Dados da Comunidade (mensagens, canais, cargos, moderação), Descoberta de Peers via DHT, Holepunch, Hypercore, Hyperdht, Hyperswarm, Problema: Moderação em Escala sem Autoridade Central (+1 more)

### Community 25 - "Onboarding e Identidade Local"
Cohesion: 0.39
Nodes (7): AppShell(), OnboardingScreen(), Phase, validate(), avatarColorFromSeed(), nextAvatarColor(), useIdentityStore

### Community 26 - "Popover e Saúde da Árvore de Distribuição"
Cohesion: 0.25
Nodes (7): Popover(), PopoverProps, RelayNode, STATUS_CLASS, STATUS_LABEL, TreeHealthPopover(), TreeHealthPopoverProps

### Community 27 - "Painel Deslizante e Campos de Texto"
Cohesion: 0.31
Nodes (6): SlidePanelProps, TextField(), TextFieldProps, MessageEditorProps, cn(), react

### Community 28 - "Problemas em Aberto do Multicast"
Cohesion: 0.25
Nodes (8): Problema: Consentimento de Repasse de Upload do Espectador, Application-Layer Multicast em Árvore (audiência maior), P2Cast, Problema: CGNAT impede virar nó de repasse, Open Problem: Consent for Relaying via Viewer Upload, Open Problem: Multicast Tree Repair on Mid-Node Failure, Problema: Reparo de Árvore (nó do meio cai), SplitStream

### Community 29 - "Cargos e Candidatos a Menção"
Cohesion: 0.32
Nodes (7): Role, filterMentionCandidates(), matches(), mentionToken(), normalize(), PRESENCE_ORDER, MEMBERS_BY_COMMUNITY

### Community 30 - "Avatar: Cores, Iniciais e Presença"
Cohesion: 0.36
Nodes (6): AVATAR_COLORS, handleFromDisplayName(), IGNORED_WORDS, initialsFrom(), PRESENCE_BG_CLASS, stripDiacritics()

### Community 31 - "Stack do Frontend e Build"
Cohesion: 0.33
Nodes (7): Project Structure: frontend/, Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand, App HTML Entry Point (index.html), Oxlint Type-Aware Configuration (oxlint-tsgolint, .oxlintrc.json), React Compiler (not enabled on this template), @vitejs/plugin-react (uses Oxc), @vitejs/plugin-react-swc (uses SWC)

### Community 32 - "Checkbox e Consentimento de Repasse"
Cohesion: 0.38
Nodes (5): Button(), Checkbox(), CheckboxProps, RelayConsentModal(), useDocumentVisible()

### Community 33 - "Identidade, Presença e Store"
Cohesion: 0.43
Nodes (5): AvatarColor, Identity, PresenceStatus, CreateIdentityInput, IdentityState

### Community 34 - "Backend Placeholder e Holepunch"
Cohesion: 0.70
Nodes (5): Planned P2P Backend Layer, Backend (Empty Placeholder — P2P logic deferred), Current State: Frontend-only, Mocked Data, No Real Backend, Project Structure: backend/ (placeholder), Hyperswarm + Hypercore + Hyperdht (Holepunch)

### Community 35 - "Metadados do package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 36 - "Scripts de NPM"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, preview

### Community 37 - "Estrutura do Projeto"
Cohesion: 0.50
Nodes (4): frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand), React, Tailwind CSS (@tailwindcss/vite), Vite

## Knowledge Gaps
- **204 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `tsBuildInfoFile` (+199 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Comunidade P2P (voz/vídeo/tela) — Project` connect `Arquitetura P2P: Voz, Tela e Arquivos` to `Camada P2P: DHT, Hypercore e Moderação`, `Estrutura do Projeto`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **Why does `Application-Layer Multicast em Árvore (audiência maior)` connect `Problemas em Aberto do Multicast` to `Arquitetura P2P: Voz, Tela e Arquivos`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _204 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Composer, Menções e Ações na Mensagem` be split into smaller, more focused modules?**
  _Cohesion score 0.0547945205479452 - nodes in this community are weakly interconnected._
- **Should `Shell, Rail e Lista de Canais` be split into smaller, more focused modules?**
  _Cohesion score 0.06663141195134849 - nodes in this community are weakly interconnected._
- **Should `Comunidades, Convites e Dataset` be split into smaller, more focused modules?**
  _Cohesion score 0.07087486157253599 - nodes in this community are weakly interconnected._
- **Should `Item de Canal, Badge e Barra de Chamada` be split into smaller, more focused modules?**
  _Cohesion score 0.07661290322580645 - nodes in this community are weakly interconnected._