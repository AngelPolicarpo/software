# Graph Report - .  (2026-08-11)

## Corpus Check
- 14 files · ~28,197 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 509 nodes · 1147 edges · 21 communities (19 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Primitivos de Botão, Badge e Modal
- Avatar, Popover e Painel Deslizante
- Shell, Rail e Lista de Canais
- Arquitetura P2P e Problemas em Aberto
- Lista de Mensagens, Anexo e Edição
- Dependências de Runtime
- TSConfig da Aplicação
- Entrada do App, Rotas e Toasts
- Configuração de Lint e Build
- Vista do Canal, Thread e Ações
- Dataset Mockado e Convites
- TSConfig do Ambiente Node
- Modelo de Domínio Tipado
- Store de Mensagens e Threads
- Markdown e Corpo da Mensagem
- Composer e Anexo em Envio
- Workflow Graphify via MCP
- Item de Canal e Badge
- Referências de Projeto TypeScript
- Servidor MCP do Graphify

## God Nodes (most connected - your core abstractions)
1. `cn()` - 40 edges
2. `react` - 32 edges
3. `useCommunityStore` - 27 edges
4. `useUiStore` - 19 edges
5. `compilerOptions` - 18 edges
6. `compilerOptions` - 15 edges
7. `useMessageStore` - 14 edges
8. `Comunidade P2P (voz/vídeo/tela) — Project` - 12 edges
9. `findMember()` - 12 edges
10. `Avatar()` - 11 edges

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

### Community 0 - "Primitivos de Botão, Badge e Modal"
Cohesion: 0.06
Nodes (46): BadgeProps, BadgeTone, TONE_CLASS, Button(), ButtonProps, ButtonSize, ButtonVariant, ICON_SIZE_CLASS (+38 more)

### Community 1 - "Avatar, Popover e Painel Deslizante"
Cohesion: 0.06
Nodes (51): Avatar(), AvatarProps, AvatarSize, EMOJI_SIZE_CLASS, PRESENCE_SIZE_CLASS, SIZE_CLASS, Popover(), SlidePanel() (+43 more)

### Community 2 - "Shell, Rail e Lista de Canais"
Cohesion: 0.07
Nodes (47): AppShell(), CategorySectionProps, ChannelList(), ChannelListProps, CommunityRail(), Tooltip(), Category, Permission (+39 more)

### Community 3 - "Arquitetura P2P e Problemas em Aberto"
Cohesion: 0.06
Nodes (44): Keet (Holepunch reference app), Planned P2P Backend Layer, Distribuição de Arquivos Estilo Torrent, File Storage & Torrent-style Distribution, backend/ — Placeholder Backend (lógica P2P depois), Backend (Empty Placeholder — P2P logic deferred), Screen/Video Sharing, Comunidade P2P (voz/vídeo/tela) — Project (+36 more)

### Community 4 - "Lista de Mensagens, Anexo e Edição"
Cohesion: 0.09
Nodes (28): AttachmentKind, AttachmentCard(), AttachmentCardProps, availabilityLabel(), KIND_ICON, MessageEditor(), MessageList(), MessageListProps (+20 more)

### Community 5 - "Dependências de Runtime"
Cohesion: 0.07
Nodes (26): @fontsource-variable/inter, dependencies, @fontsource-variable/inter, lucide-react, react, react-dom, react-router-dom, tailwindcss (+18 more)

### Community 6 - "TSConfig da Aplicação"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 7 - "Entrada do App, Rotas e Toasts"
Cohesion: 0.13
Nodes (17): Ponto de montagem da aplicação (#root), Tema escuro único (dark-only v1), Interface em português do Brasil (lang=pt-BR), App(), ICON, ICON_CLASS, ToastItem(), ToastViewport() (+9 more)

### Community 8 - "Configuração de Lint e Build"
Cohesion: 0.09
Nodes (22): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, devDependencies, oxlint, @types/node (+14 more)

### Community 9 - "Vista do Canal, Thread e Ações"
Cohesion: 0.16
Nodes (19): CommunityIcon(), CommunityIconProps, Community, Composer(), MessageActions(), DeliveryStatus(), ThreadPanel(), ThreadPanelProps (+11 more)

### Community 10 - "Dataset Mockado e Convites"
Cohesion: 0.12
Nodes (17): PreviewCard(), ANA_IDENTITY, AULA_WEBRTC_ATTACHMENT, DEMO_BANNED_CODES, findInviteByCode(), INVITES, MESSAGES_BY_CHANNEL, MODERATION_LOG (+9 more)

### Community 11 - "TSConfig do Ambiente Node"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 12 - "Modelo de Domínio Tipado"
Cohesion: 0.12
Nodes (15): ChannelType, ConnectionHealth, HostStatus, Invite, MeshStatus, MessageDeliveryState, ModerationAction, ModerationActionType (+7 more)

### Community 13 - "Store de Mensagens e Threads"
Cohesion: 0.18
Nodes (8): Reaction, Thread, TypingIndicator(), findChannelMessages(), THREADS, MessageState, SendMessageInput, useTypingIn()

### Community 14 - "Markdown e Corpo da Mensagem"
Cohesion: 0.29
Nodes (10): MessageContent(), MessageContentProps, useMentionTokens(), codeNode(), inlinePattern(), linkNode(), MENTION_CLASS, renderInline() (+2 more)

### Community 15 - "Composer e Anexo em Envio"
Cohesion: 0.22
Nodes (7): Attachment, Message, ActiveMention, attachmentKind(), ComposerProps, toAttachment(), escapeRegExp()

### Community 16 - "Workflow Graphify via MCP"
Cohesion: 0.22
Nodes (10): Consulta Obrigatória ao Graphify (política de workflow), get_community (MCP tool), get_neighbors (MCP tool), get_node (MCP tool), god_nodes (MCP tool), graph_stats (MCP tool), Graphify (grafo de conhecimento via MCP), /graphify . --update (comando de re-sincronização) (+2 more)

### Community 17 - "Item de Canal e Badge"
Cohesion: 0.38
Nodes (6): ChannelListItem(), ChannelListItemProps, Badge(), Channel, findMember(), useLocalMemberId()

## Knowledge Gaps
- **180 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `tsBuildInfoFile` (+175 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Primitivos de Botão, Badge e Modal` to `Avatar, Popover e Painel Deslizante`, `Shell, Rail e Lista de Canais`, `Lista de Mensagens, Anexo e Edição`, `Entrada do App, Rotas e Toasts`, `Configuração de Lint e Build`, `Vista do Canal, Thread e Ações`, `Store de Mensagens e Threads`, `Markdown e Corpo da Mensagem`, `Composer e Anexo em Envio`?**
  _High betweenness centrality (0.333) - this node is a cross-community bridge._
- **Why does `plugins` connect `Configuração de Lint e Build` to `Primitivos de Botão, Badge e Modal`?**
  _High betweenness centrality (0.288) - this node is a cross-community bridge._
- **Why does `typescript` connect `Configuração de Lint e Build` to `Arquitetura P2P e Problemas em Aberto`?**
  _High betweenness centrality (0.275) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _180 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Primitivos de Botão, Badge e Modal` be split into smaller, more focused modules?**
  _Cohesion score 0.05541346973572037 - nodes in this community are weakly interconnected._
- **Should `Avatar, Popover e Painel Deslizante` be split into smaller, more focused modules?**
  _Cohesion score 0.05920745920745921 - nodes in this community are weakly interconnected._
- **Should `Shell, Rail e Lista de Canais` be split into smaller, more focused modules?**
  _Cohesion score 0.07305669199298656 - nodes in this community are weakly interconnected._