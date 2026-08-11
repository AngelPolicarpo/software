# Graph Report - .  (2026-08-11)

## Corpus Check
- 14 files · ~25,170 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 485 nodes · 1057 edges · 22 communities (20 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Item de Canal, Badge e Botões
- Ações da Mensagem, Menu e Reações
- Modelo de Domínio e Dataset
- Shell, Lista de Canais e Camada 0
- Composer e Autocomplete de Menção
- Ícone de Comunidade, Banner e Tooltip
- Dependências de Runtime
- Entrada do App, Rotas e Toasts
- TSConfig da Aplicação
- Configuração de Lint e Build
- Avatar, Presença e Identidade
- TSConfig do Ambiente Node
- Mídia P2P: Voz, Tela e WebRTC
- Workflow Graphify via MCP
- Backend Holepunch e Moderação
- Multicast em Árvore e Problemas Abertos
- Stack e Estrutura do Projeto
- Backend Planejado (placeholder)
- Frontend: Vite, React e Tailwind
- Referências de Projeto TypeScript
- Servidor MCP do Graphify

## God Nodes (most connected - your core abstractions)
1. `cn()` - 36 edges
2. `useCommunityStore` - 30 edges
3. `react` - 29 edges
4. `compilerOptions` - 18 edges
5. `compilerOptions` - 15 edges
6. `findMember()` - 14 edges
7. `Comunidade P2P (voz/vídeo/tela) — Project` - 12 edges
8. `useMessageStore` - 12 edges
9. `Message` - 11 edges
10. `selectCommunity()` - 11 edges

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

## Communities (22 total, 2 thin omitted)

### Community 0 - "Item de Canal, Badge e Botões"
Cohesion: 0.06
Nodes (44): ChannelListItem(), ChannelListItemProps, Avatar(), Badge(), BadgeProps, BadgeTone, TONE_CLASS, Button() (+36 more)

### Community 1 - "Ações da Mensagem, Menu e Reações"
Cohesion: 0.06
Nodes (45): Menu(), MenuItem, MenuProps, Message, Reaction, Composer(), ReplyingTo(), MessageActions() (+37 more)

### Community 2 - "Modelo de Domínio e Dataset"
Cohesion: 0.05
Nodes (42): Attachment, AttachmentKind, ChannelType, ConnectionHealth, Invite, Member, MeshStatus, MessageDeliveryState (+34 more)

### Community 3 - "Shell, Lista de Canais e Camada 0"
Cohesion: 0.10
Nodes (37): AppShell(), CategorySection(), CategorySectionProps, ChannelList(), CommunityRail(), Category, Permission, CreateCommunityModal() (+29 more)

### Community 4 - "Composer e Autocomplete de Menção"
Cohesion: 0.08
Nodes (32): Role, RoleColor, ActiveMention, attachmentKind(), ComposerProps, toAttachment(), MentionAutocomplete(), MentionAutocompleteProps (+24 more)

### Community 5 - "Ícone de Comunidade, Banner e Tooltip"
Cohesion: 0.11
Nodes (21): ChannelListProps, CommunityIcon(), CommunityIconProps, StatusBanner(), StatusBannerProps, StatusBannerTone, TONE, Tooltip() (+13 more)

### Community 6 - "Dependências de Runtime"
Cohesion: 0.07
Nodes (26): @fontsource-variable/inter, dependencies, @fontsource-variable/inter, lucide-react, react, react-dom, react-router-dom, tailwindcss (+18 more)

### Community 7 - "Entrada do App, Rotas e Toasts"
Cohesion: 0.13
Nodes (17): Ponto de montagem da aplicação (#root), Tema escuro único (dark-only v1), Interface em português do Brasil (lang=pt-BR), App(), ICON, ICON_CLASS, ToastItem(), ToastViewport() (+9 more)

### Community 8 - "TSConfig da Aplicação"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 9 - "Configuração de Lint e Build"
Cohesion: 0.09
Nodes (22): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, devDependencies, oxlint, @types/node (+14 more)

### Community 10 - "Avatar, Presença e Identidade"
Cohesion: 0.16
Nodes (17): AvatarProps, AvatarSize, EMOJI_SIZE_CLASS, PRESENCE_SIZE_CLASS, SIZE_CLASS, AvatarColor, Identity, PresenceStatus (+9 more)

### Community 11 - "TSConfig do Ambiente Node"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 12 - "Mídia P2P: Voz, Tela e WebRTC"
Cohesion: 0.22
Nodes (11): Keet (Holepunch reference app), Distribuição de Arquivos Estilo Torrent, File Storage & Torrent-style Distribution, Screen/Video Sharing, Comunidade P2P (voz/vídeo/tela) — Project, Estrela Direta (≤4-5 espectadores), WebRTC (Media Stack), Fallback TURN (NAT restritivo) (+3 more)

### Community 13 - "Workflow Graphify via MCP"
Cohesion: 0.22
Nodes (10): Consulta Obrigatória ao Graphify (política de workflow), get_community (MCP tool), get_neighbors (MCP tool), get_node (MCP tool), god_nodes (MCP tool), graph_stats (MCP tool), Graphify (grafo de conhecimento via MCP), /graphify . --update (comando de re-sincronização) (+2 more)

### Community 14 - "Backend Holepunch e Moderação"
Cohesion: 0.31
Nodes (9): backend/ — Placeholder Backend (lógica P2P depois), Dados da Comunidade (mensagens, canais, cargos, moderação), Descoberta de Peers via DHT, Holepunch, Hypercore, Hyperdht, Hyperswarm, Problema: Moderação em Escala sem Autoridade Central (+1 more)

### Community 15 - "Multicast em Árvore e Problemas Abertos"
Cohesion: 0.25
Nodes (8): Problema: Consentimento de Repasse de Upload do Espectador, Application-Layer Multicast em Árvore (audiência maior), P2Cast, Problema: CGNAT impede virar nó de repasse, Open Problem: Consent for Relaying via Viewer Upload, Open Problem: Multicast Tree Repair on Mid-Node Failure, Problema: Reparo de Árvore (nó do meio cai), SplitStream

### Community 16 - "Stack e Estrutura do Projeto"
Cohesion: 0.33
Nodes (7): Project Structure: frontend/, Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand, App HTML Entry Point (index.html), Oxlint Type-Aware Configuration (oxlint-tsgolint, .oxlintrc.json), React Compiler (not enabled on this template), @vitejs/plugin-react (uses Oxc), @vitejs/plugin-react-swc (uses SWC)

### Community 17 - "Backend Planejado (placeholder)"
Cohesion: 0.70
Nodes (5): Planned P2P Backend Layer, Backend (Empty Placeholder — P2P logic deferred), Current State: Frontend-only, Mocked Data, No Real Backend, Project Structure: backend/ (placeholder), Hyperswarm + Hypercore + Hyperdht (Holepunch)

### Community 18 - "Frontend: Vite, React e Tailwind"
Cohesion: 0.50
Nodes (4): frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand), React, Tailwind CSS (@tailwindcss/vite), Vite

## Knowledge Gaps
- **171 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `tsBuildInfoFile` (+166 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Item de Canal, Badge e Botões` to `Ações da Mensagem, Menu e Reações`, `Shell, Lista de Canais e Camada 0`, `Composer e Autocomplete de Menção`, `Ícone de Comunidade, Banner e Tooltip`, `Entrada do App, Rotas e Toasts`, `Configuração de Lint e Build`?**
  _High betweenness centrality (0.339) - this node is a cross-community bridge._
- **Why does `plugins` connect `Configuração de Lint e Build` to `Item de Canal, Badge e Botões`?**
  _High betweenness centrality (0.297) - this node is a cross-community bridge._
- **Why does `typescript` connect `Configuração de Lint e Build` to `Frontend: Vite, React e Tailwind`?**
  _High betweenness centrality (0.284) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _171 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Item de Canal, Badge e Botões` be split into smaller, more focused modules?**
  _Cohesion score 0.06398730830248546 - nodes in this community are weakly interconnected._
- **Should `Ações da Mensagem, Menu e Reações` be split into smaller, more focused modules?**
  _Cohesion score 0.06253652834599649 - nodes in this community are weakly interconnected._
- **Should `Modelo de Domínio e Dataset` be split into smaller, more focused modules?**
  _Cohesion score 0.0545790934320074 - nodes in this community are weakly interconnected._