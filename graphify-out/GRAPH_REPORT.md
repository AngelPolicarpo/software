# Graph Report - software  (2026-08-15)

## Corpus Check
- 121 files · ~237,170 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1510 nodes · 3533 edges · 100 communities (92 shown, 8 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 135 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `52f87d48`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ChannelDialogs.tsx
- auditoria-sistemas-distribuidos.md
- HIGH
- REQUISITOS QUE PARECEM INCOMPLETOS
- Avatar.tsx
- AppShell.tsx
- ProfilePopover.tsx
- types.ts
- Status COMPLETE — cadeia inteira verificada
- Status PARTIAL — cadeia perde um elo
- RolesTab.tsx
- dataset.ts
- communityStore.ts
- Community
- SearchPanel.tsx
- markdown.tsx
- Entidade ModerationEntry (log de auditoria)
- inviteStore.ts
- VoiceOverlay.tsx
- compilerOptions
- 2.1 Canal de texto
- Auditoria Experimental de Decisões Arquiteturais
- useCommunityStore
- ChannelList.tsx
- compilerOptions
- 3.4 Gestão de canais e categorias
- 1.1 Shell principal
- Status MISSING — nenhum contrato de backend cobre
- messageStore.ts
- ChannelInfoPanel.tsx
- Comunidade P2P (voz/vídeo/tela) — Project
- cn
- Entidade Member
- Entidade Message
- Status CONTRADICTORY — documentos se contradizem
- Message
- Entidade Community
- dependencies
- JoinCommunityOverlay.tsx
- voiceStore.ts
- Deltas obrigatorios na spec de UX/UI (§25)
- Entidade Ban / Timeout
- Modulo communityHost (L2)
- devDependencies
- 2.4 Compartilhamento de tela/vídeo
- AccountSettings.tsx
- Entidade Invite
- 2.3 Canal de voz
- Consulta Obrigatória ao Graphify (política de workflow)
- Modulo voiceCoordinator (L2)
- plugins
- package.json
- Modulo ipc (L3)
- 1.4 Popover de perfil de membro
- Application-Layer Multicast em Árvore (audiência maior)
- DevBar.tsx
- Blockers que impedem a aprovação
- Current State: Frontend-only, Mocked Data, No Real Backend
- Entidade RelayVolunteer
- frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand)
- Channel
- 3. Achados que pressionam a arquitetura
- C-4 — Criar convite com expiração e limite
- V-5 — Anel de fala ativa
- Tokens de superfície e elevação
- K-7 — Comunidade silenciada sem traço nem badge
- M-10 — Fixar e desafixar mensagem
- tsconfig.json
- graphify
- Tipografia (Inter, 3 pesos, 7 degraus)
- E-10 — Marcar canal como lido zerando contador e menções
- N-6 — Avisar quem está online antes de sair
- V-9 — Câmera com tile de vídeo e teto de 6
- Status UNCLEAR — regra não especificada
- Bloco 2 — Fase 2: log, validação e projeção
- dry-run-implementacao.md
- Consolidação
- MEDIUM
- mentions.ts
- HIGH
- Composer.tsx
- CRITICAL
- MEDIUM
- Button.tsx
- Consolidação por categoria
- Decisões que precisam ser congeladas antes da implementação
- uiStore.ts
- MessageRow.tsx
- Bloco 1 — Fase 1: ponte IPC
- Bloco 3 — Fase 3: rede visível, outbox e estados de conexão
- Bloco 5 — Fase 5: anexos e busca
- Bloco 7 — Contratos de leitura e o que a UI exige
- Consolidação
- Bloco 0 — Fase 0 (spike) e fundação de projeto
- Bloco 6 — Fases 6 e 7: voz, câmera e tela
- Bloco 4 — Fase 4: convites e entrada
- LOW
- React + TypeScript + Vite
- backend/README.md

## God Nodes (most connected - your core abstractions)
1. `cn()` - 114 edges
2. `useCommunityStore` - 82 edges
3. `react` - 58 edges
4. `Status PARTIAL — cadeia perde um elo` - 50 edges
5. `useUiStore` - 43 edges
6. `findMember()` - 40 edges
7. `Status COMPLETE — cadeia inteira verificada` - 38 edges
8. `REQUISITOS QUE PARECEM INCOMPLETOS` - 36 edges
9. `Community` - 31 edges
10. `Channel` - 29 edges

## Surprising Connections (you probably didn't know these)
- `frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand)` --references--> `zustand`  [EXTRACTED]
  CLAUDE.md → frontend/package.json
- `frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand)` --references--> `typescript`  [EXTRACTED]
  CLAUDE.md → frontend/package.json
- `App HTML Entry Point (index.html)` --conceptually_related_to--> `Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand`  [INFERRED]
  frontend/index.html → CLAUDE.md
- `ChannelListProps` --references--> `Community`  [EXTRACTED]
  frontend/src/components/shell/ChannelList.tsx → frontend/src/domain/types.ts
- `ChannelListItemProps` --references--> `Channel`  [EXTRACTED]
  frontend/src/components/shell/ChannelListItem.tsx → frontend/src/domain/types.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Modelo de audiência e árvore de compartilhamento indefinidos** — docs_auditoria_adversarial_f_08, docs_auditoria_adversarial_f_18, docs_auditoria_adversarial_f_37, docs_auditoria_adversarial_f_42, docs_auditoria_adversarial_arvore_de_compartilhamento, docs_auditoria_adversarial_consentimento_de_repasse [EXTRACTED 1.00]
- **Entrada de membro sem contrato executável** — docs_auditoria_adversarial_f_02, docs_auditoria_adversarial_f_06, docs_auditoria_adversarial_f_09, docs_auditoria_adversarial_f_21, docs_auditoria_adversarial_prova_de_convite [EXTRACTED 1.00]
- **Parada permanente da projeção sem recuperação** — docs_auditoria_adversarial_f_04, docs_auditoria_adversarial_f_05, docs_auditoria_adversarial_f_07, docs_auditoria_adversarial_f_39, docs_auditoria_adversarial_f_40, docs_auditoria_adversarial_projetor, docs_auditoria_adversarial_reducer_fail_stop [EXTRACTED 1.00]
- **Camada 0 — entrada e identidade (sequencial e bloqueante)** — docs_frontend_tela_0_1_onboarding_identidade, docs_frontend_tela_0_2_hub_vazio, docs_frontend_tela_0_3_entrar_via_convite, docs_frontend_tela_0_4_criar_comunidade, docs_frontend_rota_raiz, docs_frontend_rota_invite_code [EXTRACTED 1.00]
- **Compartilhamento de tela em árvore — topologia, consentimento e saúde** — docs_frontend_tela_2_4_compartilhamento_de_tela, docs_frontend_tela_2_4_1_consentimento_repasse, docs_frontend_tela_2_4_2_painel_do_apresentador, docs_frontend_fluxo_b5_compartilhar_tela, docs_frontend_fluxo_b6_consentimento_retransmissao, docs_frontend_entidade_screensharesession, docs_frontend_topologia_estrela_vs_arvore, docs_frontend_paleta_saude_de_conexao [EXTRACTED 1.00]
- **Slot único do painel direito — membros, thread e painel do canal** — docs_frontend_tela_1_3_painel_de_membros, docs_frontend_tela_2_2_painel_de_thread, docs_frontend_tela_2_1_2_painel_do_canal, docs_frontend_regra_slot_unico_de_painel, docs_frontend_espacamento_e_grid [EXTRACTED 1.00]
- **Cinco superfícies que precisam de dado que query nenhuma devolve** — docs_rastreabilidade_ux_backend_rt_02, docs_rastreabilidade_ux_backend_rt_05, docs_rastreabilidade_ux_backend_k_7, docs_rastreabilidade_ux_backend_e_12, docs_rastreabilidade_ux_backend_m_6, docs_rastreabilidade_ux_backend_m_9, docs_rastreabilidade_ux_backend_a_8 [EXTRACTED 1.00]
- **Ações otimistas contra RPC síncrono de 30 s sem rollback (F-15)** — docs_rastreabilidade_ux_backend_m_5, docs_rastreabilidade_ux_backend_m_8, docs_rastreabilidade_ux_backend_m_10, docs_rastreabilidade_ux_backend_m_11 [EXTRACTED 1.00]
- **Linhas PARTIAL que perdem o mesmo elo: contrato de leitura, projeção ou evento de invalidação** — docs_rastreabilidade_ux_backend_c_4, docs_rastreabilidade_ux_backend_c_6, docs_rastreabilidade_ux_backend_k_1, docs_rastreabilidade_ux_backend_k_6, docs_rastreabilidade_ux_backend_e_10, docs_rastreabilidade_ux_backend_m_1, docs_rastreabilidade_ux_backend_m_2, docs_rastreabilidade_ux_backend_a_2, docs_rastreabilidade_ux_backend_a_7, docs_rastreabilidade_ux_backend_p_1, docs_rastreabilidade_ux_backend_p_14, docs_rastreabilidade_ux_backend_p_15, docs_rastreabilidade_ux_backend_p_16, docs_rastreabilidade_ux_backend_s_3, docs_rastreabilidade_ux_backend_v_15, docs_rastreabilidade_ux_backend_v_18, docs_rastreabilidade_ux_backend_n_1, docs_rastreabilidade_ux_backend_n_2, docs_rastreabilidade_ux_backend_n_9, docs_rastreabilidade_ux_backend_n_11 [EXTRACTED 1.00]
- **Mandatory Graphify Knowledge-Graph Consultation Workflow** — claude_consulta_obrigatoria_graphify, claude_query_graph, claude_get_neighbors, claude_shortest_path, claude_graphify_update_command [EXTRACTED 1.00]
- **Holepunch P2P Data Stack (Hyperswarm + Hypercore + Hyperdht)** — claude_hyperswarm, claude_hypercore, claude_hyperdht, claude_holepunch [EXTRACTED 1.00]
- **Tiered Screen/Video Sharing Distribution Strategy (star / multicast tree / TURN fallback)** — claude_compartilhamento_tela_video, claude_estrela_direta, claude_multicast_tree, claude_turn_fallback [INFERRED 0.85]

## Communities (100 total, 8 thin omitted)

### Community 0 - "ChannelDialogs.tsx"
Cohesion: 0.17
Nodes (24): Select(), SelectOption, SelectProps, ChannelType, Role, CreateChannelModal(), EditChannelModal(), moderatorRoleIds() (+16 more)

### Community 1 - "auditoria-sistemas-distribuidos.md"
Cohesion: 0.14
Nodes (13): Auditoria de Sistemas Distribuídos e Confiabilidade — Comunidade P2P, Convenções, CRITICAL, DS-01 — A validação lê a projeção, que está atrás do log em que o próprio host acabou de appendar, DS-02 — `submitOp` confirma antes de a escrita ser durável, e o cliente libera a outbox na palavra do host, DS-03 — A tabela de dedupe não tem ordenação definida com o append, e os dois ordenamentos possíveis são ambos catastróficos, DS-04 — `synchronous=NORMAL` é justificado pela projeção descartável e aplicado às tabelas que carregam as garantias de entrega e de idempotência, DS-05 — Dois resgates concorrentes do último uso de um convite: a serialização por comunidade não impede que os dois entrem (+5 more)

### Community 2 - "HIGH"
Cohesion: 0.08
Nodes (26): HIGH, T-11 — O nó de repasse da árvore de tela recebe o quadro decodificável e não autenticado: ele vê o conteúdo e pode substituí-lo, T-12 — `codecConfig` e chunks de origem não confiável alimentam o decodificador do renderer, T-13 — `canRelay` e `uplinkKbps` chegam auto-declarados no RPC, e a árvore é a posição de ataque mais valiosa da sessão, T-14 — `relay.volunteer` não exige prova de posse da `relayKey`: qualquer membro redireciona o tráfego da comunidade para um terceiro, T-15 — A sinalização WebRTC é peer-a-peer e não tem autorização: qualquer chave conhecida abre conexão com qualquer membro, T-16 — `blob.stage(path)` não tem como comprovar a origem do caminho: renderer comprometido exfiltra qualquer arquivo do usuário, T-17 — Anexo de terceiro é entregue ao handler default do SO sem allowlist de tipo nem marca de origem (+18 more)

### Community 3 - "REQUISITOS QUE PARECEM INCOMPLETOS"
Cohesion: 0.07
Nodes (68): ADRs QUE PRECISAM DE VALIDAÇÃO, Árvore de compartilhamento de tela, Auto-save de formulários de edição na UI, Backpressure de IPC e ipc.dropped, blobsKey e o core de blobs, Consentimento de repasse do espectador, Derivação do handle a partir da chave pública, F-01 — blobsKey e comunidades participadas só existem na projeção (+60 more)

### Community 4 - "Avatar.tsx"
Cohesion: 0.11
Nodes (30): Avatar(), AvatarProps, EMOJI_SIZE_CLASS, PRESENCE_SIZE_CLASS, SIZE_CLASS, TextField(), TextFieldProps, AvatarColor (+22 more)

### Community 5 - "AppShell.tsx"
Cohesion: 0.19
Nodes (22): AppShell(), CommunityRail(), MessageLinkResolver(), ChannelDialogs(), CreateCommunityModal(), validate(), HostedImpact, useBeforeUnloadWarning() (+14 more)

### Community 6 - "ProfilePopover.tsx"
Cohesion: 0.14
Nodes (24): EntryHeader(), ReplyingTo(), copyToClipboard(), MessageActions(), MessageContent(), useMentionTokens(), joinedFormat, PRESENCE_OPTIONS (+16 more)

### Community 7 - "types.ts"
Cohesion: 0.12
Nodes (23): Attachment, AttachmentKind, ConnectionHealth, InvitePreview, MessageDeliveryState, ModerationActionType, Permission, PermissionGroup (+15 more)

### Community 8 - "Status COMPLETE — cadeia inteira verificada"
Cohesion: 0.05
Nodes (42): A-3 — Aviso de peer desconectado durante o download, A-4 — Anexo indisponível por ausência de peers, A-9 — Aba Fixados do canal, E-1 — Criar canal com slug ao vivo, E-3 — Mover canal trocando a categoria, E-4 — Excluir canal com confirmação nomeada, E-5 — Excluir canal de voz com gente dentro, E-6 — Criar, renomear e excluir categoria (+34 more)

### Community 9 - "Status PARTIAL — cadeia perde um elo"
Cohesion: 0.08
Nodes (33): A-1 — Anexar arquivo com chip no composer e teto de 8 GB, A-2 — Baixar arquivo estilo torrent com N peers, A-6 — Abrir arquivo e Mostrar na pasta, A-7 — Aba Arquivos do canal, C-3 — Entrar na comunidade por convite, C-8 — Rota /invite/:code resolvendo fora do app, I-2 — Editar nome/cor do avatar, I-4 — Invisível continua recebendo tudo (+25 more)

### Community 10 - "RolesTab.tsx"
Cohesion: 0.10
Nodes (28): Button(), Checkbox(), CheckboxProps, Modal(), ModalProps, ModalSize, SIZE_CLASS, TabItem (+20 more)

### Community 11 - "dataset.ts"
Cohesion: 0.06
Nodes (50): ModerationAction, PreviewCard(), inVoiceIds(), MemberRow(), MembersPanel(), MembersPanelProps, normalize(), ACTION_ICON (+42 more)

### Community 12 - "communityStore.ts"
Cohesion: 0.10
Nodes (29): memberLabel(), useMentionCandidates(), useLeaveVoiceGuard(), BarControl(), BarControlProps, ParticipantStack(), VoiceCallBar(), VoiceCallBarProps (+21 more)

### Community 13 - "Community"
Cohesion: 0.14
Nodes (18): ChannelContextMenuProps, CommunityIconProps, Channel, Community, Invite, ChannelHeaderProps, ChannelInfoPanelProps, ChannelView() (+10 more)

### Community 14 - "SearchPanel.tsx"
Cohesion: 0.15
Nodes (23): Member, MemberRowProps, cutoffFor(), DateFilter, hasFilters(), KindFilter, matchesKind(), normalize() (+15 more)

### Community 15 - "markdown.tsx"
Cohesion: 0.48
Nodes (6): codeNode(), inlinePattern(), linkNode(), MENTION_CLASS, renderInline(), renderMarkdown()

### Community 16 - "Entidade ModerationEntry (log de auditoria)"
Cohesion: 0.13
Nodes (24): ADR-10: Deletar e sempre tombstone, ADR-15: Nao-lidas e mencoes sao calculo 100% local por watermark de seq, Delta 1: exclusao nao apaga bytes do log, Delta 10: editar nao apaga o conteudo anterior, Entidade Category, Entidade Channel, Entidade ModerationEntry (log de auditoria), Fluxo: criar canal (D14) (+16 more)

### Community 17 - "inviteStore.ts"
Cohesion: 0.11
Nodes (22): Ponto de montagem da aplicação (#root), Tema escuro único (dark-only v1), Interface em português do Brasil (lang=pt-BR), App(), ICON, ICON_CLASS, ToastItem(), ToastViewport() (+14 more)

### Community 18 - "VoiceOverlay.tsx"
Cohesion: 0.18
Nodes (11): LeaveVoiceGuard, LeaveVoiceConfirm(), ShareSourceModal(), ShareSourceModalProps, SOURCES, Control(), ControlProps, VoiceTile() (+3 more)

### Community 19 - "compilerOptions"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 20 - "2.1 Canal de texto"
Cohesion: 0.13
Nodes (23): Dataset de referência (fixtures mockadas), Attachment, Invite, Message, Reaction, Thread, Fluxo B4 — Host offline, modo cache e reconexão, Fluxo B8 — Download de arquivo estilo torrent (+15 more)

### Community 21 - "Auditoria Experimental de Decisões Arquiteturais"
Cohesion: 0.08
Nodes (25): Acceptance criteria, ADR Risk Matrix, Architecture decisions that should remain frozen, Architecture decisions that should remain provisional until validation, Auditoria Experimental de Decisões Arquiteturais, Benchmarks prioritários, Critério de classificação, Escopo, método e veredito executivo (+17 more)

### Community 22 - "useCommunityStore"
Cohesion: 0.29
Nodes (11): ChannelContextMenu(), CategoryNameModal(), DeleteCategoryDialog(), DeleteChannelDialog(), categoryPatch(), channelPatch(), randomId(), useCategory() (+3 more)

### Community 23 - "ChannelList.tsx"
Cohesion: 0.27
Nodes (10): CategorySection(), CategorySectionProps, ChannelList(), ChannelListProps, ChannelListItem(), ChannelListItemProps, useContextMenu(), Category (+2 more)

### Community 24 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 25 - "3.4 Gestão de canais e categorias"
Cohesion: 0.13
Nodes (19): ModerationAction, Fluxo D12 — Moderação rápida + log de auditoria, Fluxo D14 — Criar um canal de texto, Fluxo D15 — Excluir um canal com chamada acontecendo, Paleta de cor de cargo (7 cores curadas), Premissa 11 — Apelido é auto-atribuído por comunidade, Premissa 4 — Convites sem expiração por padrão, configuráveis e revogáveis, Princípio 3 — Honestidade sobre limitações conhecidas (+11 more)

### Community 26 - "1.1 Shell principal"
Cohesion: 0.16
Nodes (19): Espaçamento e grid do shell, Fluxo A1 — Criar identidade local, Fluxo A2 — Entrar via convite + preview, Fluxo A3 — Criar comunidade / virar host, Premissa 1 — Plataforma-alvo do mock é web (browser), Premissa 2 — Sem descoberta pública de comunidades, Premissa 3 — Identidade é local a um dispositivo, Premissa 7 — Badge de não-lido e mute por canal/comunidade no v1 (+11 more)

### Community 27 - "Status MISSING — nenhum contrato de backend cobre"
Cohesion: 0.16
Nodes (19): A-5 — Anexo corrompido, A-8 — Aba Links do canal, C-5 — Lista de convites ativos com código, E-11 — Copiar link do canal para /m/:code, E-12 — Canal de voz lista participantes inline na sidebar, M-18 — Copiar link da mensagem para /m/:code, M-6 — Hover no chip mostra até 6 nomes de reatores, M-9 — Badge de não-lidas da thread (+11 more)

### Community 28 - "messageStore.ts"
Cohesion: 0.25
Nodes (16): Thread, ThreadPanel(), findChannelMessages(), compose(), deliveryOf(), messageId(), MessageState, toggled() (+8 more)

### Community 29 - "ChannelInfoPanel.tsx"
Cohesion: 0.13
Nodes (18): SlidePanel(), SlidePanelProps, ChannelInfoPanel(), clock, CLOCK_AHEAD_HINT, CLOCK_SKEW_TOLERANCE_MS, daysFromToday(), decimals() (+10 more)

### Community 30 - "Comunidade P2P (voz/vídeo/tela) — Project"
Cohesion: 0.24
Nodes (12): Distribuição de Arquivos Estilo Torrent, File Storage & Torrent-style Distribution, backend/ — Placeholder Backend (lógica P2P depois), Comunidade P2P (voz/vídeo/tela) — Project, Dados da Comunidade (mensagens, canais, cargos, moderação), Descoberta de Peers via DHT, Holepunch, Hypercore (+4 more)

### Community 31 - "cn"
Cohesion: 0.11
Nodes (33): CommunityIcon(), Badge(), BadgeProps, BadgeTone, TONE_CLASS, Menu(), MenuItem, MenuProps (+25 more)

### Community 32 - "Entidade Member"
Cohesion: 0.17
Nodes (17): ADR-19: Chave privada cifrada com safeStorage do Electron, Entidade Identity, Entidade Member, Entidade Role, Fluxo: sair da identidade, Fluxo: cargos, criar, mover e atribuir (D13), Op identity.update, Op member.leave (+9 more)

### Community 33 - "Entidade Message"
Cohesion: 0.16
Nodes (17): Entidade Attachment, Entidade Message, Entidade Reaction, Entidade Thread, Fluxo: anexar arquivo (upload), Fluxo: baixar arquivo (B8), Modulo blobs (L2), Op message.pin (+9 more)

### Community 34 - "Status CONTRADICTORY — documentos se contradizem"
Cohesion: 0.16
Nodes (17): C-1 — Colar código/link com preview antes de entrar, C-2 — Desfecho banido com preview reduzido, C-7 — Código curto de 6 caracteres, E-2 — Editar canal com auto-save e zona de perigo, I-6 — Identificador local exibido @ana, K-3 — Editar metadados da comunidade com auto-save de 800 ms, M-17 — Carimbo de mensagem e relógio adiantado, M-3 — Mensagem pendente na posição cronológica (+9 more)

### Community 35 - "Message"
Cohesion: 0.14
Nodes (13): Message, EntryHeaderProps, LinkEntry, MessageActionsProps, MessageContentProps, MessageEditorProps, MessageList(), MessageListProps (+5 more)

### Community 36 - "Entidade Community"
Cohesion: 0.19
Nodes (15): ADR-02: Hypercore cru como log + SQLite como view materializada, ADR-03: Driver SQLite = better-sqlite3@13, ADR-16: Toda comunidade participada replica em background, ADR-20: Um unico processo nucleo por instalacao, com lock de diretorio, Entidade Community, Fluxo: boot, abrir e replicar comunidades participadas, Fluxo: criar comunidade / virar host (A3), Fluxo: encerrar comunidade (+7 more)

### Community 37 - "dependencies"
Cohesion: 0.13
Nodes (15): @fontsource-variable/inter, dependencies, @fontsource-variable/inter, lucide-react, react, react-dom, react-router-dom, tailwindcss (+7 more)

### Community 38 - "JoinCommunityOverlay.tsx"
Cohesion: 0.33
Nodes (3): Skeleton(), SkeletonProps, JoinCommunityOverlayProps

### Community 39 - "voiceStore.ts"
Cohesion: 0.11
Nodes (22): AvatarSize, MeshStatus, RelayNode, ScreenShareSession, VoiceParticipant, ScreenShareStageProps, TreeHealthPopoverProps, StackProps (+14 more)

### Community 40 - "Deltas obrigatorios na spec de UX/UI (§25)"
Cohesion: 0.19
Nodes (14): ADR-05: Midia hibrida (WebRTC para voz, WebCodecs sobre UDX para tela), ADR-17: A arvore de distribuicao de tela e calculada pelo host, Delta 6: sem descoberta LAN, Delta 4: mensagem da fila se move ao ser entregue, Delta 11: duas regras novas contra escalada de cargo, Delta 12: ops de estrutura nao entram na fila offline, Delta 8: fixture TELA-04 com 7 espectadores em canal de 3, Delta 3: espectador em arvore fica 1-2 s atras (+6 more)

### Community 41 - "Entidade Ban / Timeout"
Cohesion: 0.21
Nodes (14): Delta 9: ban oculta mensagens de forma reversivel, Entidade Ban / Timeout, Fluxo: banir (D12), Fluxo: timeout, Op mod.ban, Op mod.removeTimeout, Op mod.revokeBan, Op mod.timeout (+6 more)

### Community 42 - "Modulo communityHost (L2)"
Cohesion: 0.26
Nodes (13): ADR-01: Host e a unica autoridade de escrita, ADR-11: Fila de saida (outbox) duravel em SQLite, ADR-12: Idempotencia por opId = BLAKE2b-256 do envelope canonico, Fluxo: saida do host (3.5), Fluxo: host offline, fila, reconexao e flush (B4), Fluxo: enviar mensagem com host online (C9), Modulo communityHost (L2), Modulo opCodec (L1) (+5 more)

### Community 43 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, oxlint, @types/node, @types/react, @types/react-dom, vite, @vitejs/plugin-react, oxlint (+5 more)

### Community 44 - "2.4 Compartilhamento de tela/vídeo"
Cohesion: 0.24
Nodes (12): ScreenShareSession, Fluxo B5 — Compartilhar tela: estrela, árvore, reparo, Fluxo B6 — Consentimento de retransmissão de upload, Paleta de feedback de sistema, Paleta de saúde de conexão P2P (conn-*), Premissa 9 — Câmera é escopo e vai por mesh, não pela árvore, Princípio 2 — A saúde da conexão é informação de primeira classe, 2.3.2 Câmera (+4 more)

### Community 45 - "AccountSettings.tsx"
Cohesion: 0.12
Nodes (19): Slider(), SliderProps, Toggle(), ToggleProps, AccountSettings(), AccountSettingsProps, LEVELS, TABS (+11 more)

### Community 46 - "Entidade Invite"
Cohesion: 0.25
Nodes (11): ADR-09: Convite = segredo de 10 bytes (80 bits) em Crockford Base32, Delta 2: codigo de convite de 6 para 16 caracteres, Delta 5: desfechos novos de preview (unreachable, ended), Entidade Invite, Fluxo: convite emitir, resolver e resgatar (A2), Modulo invites (L2), Op invite.create, Op invite.revoke (+3 more)

### Community 47 - "2.3 Canal de voz"
Cohesion: 0.24
Nodes (11): Identity (identidade local), Fluxo B7 — Entrar em canal de voz com mesh parcial, Fluxo C11 — Persistência de chamada ao trocar de canal/comunidade, Iconografia (outline, 16/20/24px, Lucide), Indicador de fala ativa (anel + movimento, nunca só cor), Motion (durações, easing, prefers-reduced-motion), Paleta semântica de presença, Regra da presença Invisível ao entrar em canal de voz (+3 more)

### Community 48 - "Consulta Obrigatória ao Graphify (política de workflow)"
Cohesion: 0.22
Nodes (10): Consulta Obrigatória ao Graphify (política de workflow), get_community (MCP tool), get_neighbors (MCP tool), get_node (MCP tool), god_nodes (MCP tool), graph_stats (MCP tool), Graphify (grafo de conhecimento via MCP), /graphify . --update (comando de re-sincronização) (+2 more)

### Community 49 - "Modulo voiceCoordinator (L2)"
Cohesion: 0.22
Nodes (10): ADR-06: Sem STUN de terceiros por padrao, ADR-07: UDX como fallback universal de transporte, ADR-14: Presenca, digitando e roster de voz sao efemeros, ADR-18: Sem notificacao com o app fechado no v1, Fluxo: entrar em canal de voz (B7), Modulo permissions (L1), Modulo presence (L2), Modulo voiceCoordinator (L2) (+2 more)

### Community 50 - "plugins"
Cohesion: 0.22
Nodes (8): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, typescript, warn

### Community 51 - "package.json"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, lint, preview, type (+1 more)

### Community 52 - "Modulo ipc (L3)"
Cohesion: 0.28
Nodes (9): ADR-04: Nucleo P2P em utilityProcess do Electron, ADR-13: Busca full-text em SQLite FTS5, Fluxo: busca (C10), Modulo ipc (L3), Modulo reducers (L1), Modulo search (L2), Tabela SQLite channels, Tabela SQLite members (+1 more)

### Community 53 - "1.4 Popover de perfil de membro"
Cohesion: 0.33
Nodes (9): Member, Role (cargo), Fluxo D13 — Gestão de cargos e permissões, Regra de hierarquia de cargos, Regra do slot único de painel deslizante, 1.3 Painel de membros, 1.4 Popover de perfil de membro, 2.2 Painel de thread (+1 more)

### Community 54 - "Application-Layer Multicast em Árvore (audiência maior)"
Cohesion: 0.13
Nodes (15): Screen/Video Sharing, Problema: Consentimento de Repasse de Upload do Espectador, Estrela Direta (≤4-5 espectadores), Application-Layer Multicast em Árvore (audiência maior), P2Cast, Problema: CGNAT impede virar nó de repasse, Open Problem: Consent for Relaying via Viewer Upload, Open Problem: Multicast Tree Repair on Mid-Node Failure (+7 more)

### Community 55 - "DevBar.tsx"
Cohesion: 0.38
Nodes (8): HostStatus, DevBar(), AULA_WEBRTC_ATTACHMENT, ConnectionState, RECONNECT_DELAY_MS, useConnectionStore, useHostStatus(), selectQueuedChannelIds()

### Community 56 - "Blockers que impedem a aprovação"
Cohesion: 0.09
Nodes (23): Avaliação das ADRs e da verificação de APIs, B10 — Moderação, revogação e recuperação de identidade não têm comportamento seguro, B1 — Estado autoritativo, validação e projeção não são serializáveis, B2 — Reprojeção não reconstrói participação, namespaces e blobs, B3 — Porta de entrada por convite não tem protocolo executável, B4 — Caminho de escrita e segurança de anexos não existe, B5 — Durabilidade da outbox e idempotência não são garantidas, B6 — Runtime, IPC e fronteira da chave privada não têm contrato executável (+15 more)

### Community 57 - "Current State: Frontend-only, Mocked Data, No Real Backend"
Cohesion: 0.33
Nodes (7): Backend (Empty Placeholder — P2P logic deferred), Current State: Frontend-only, Mocked Data, No Real Backend, Project Structure: backend/ (placeholder), Project Structure: frontend/, Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand, Hyperswarm + Hypercore + Hyperdht (Holepunch), App HTML Entry Point (index.html)

### Community 58 - "Entidade RelayVolunteer"
Cohesion: 0.43
Nodes (7): ADR-08: Relay por voluntarios (blind-relay), Delta 7: consentimento de relay voluntario em 3.1 Rede, Entidade RelayVolunteer, Fluxo: relay voluntario, Modulo relay (L2), Op relay.volunteer, Op relay.withdraw

### Community 59 - "frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand)"
Cohesion: 0.25
Nodes (8): frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand), React, Tailwind CSS (@tailwindcss/vite), Vite, zustand, typescript, typescript, zustand

### Community 60 - "Channel"
Cohesion: 0.40
Nodes (6): Category, Channel, Community, ConnectionHealth, VoiceSession, Modo cache local somente-leitura (host offline)

### Community 61 - "3. Achados que pressionam a arquitetura"
Cohesion: 0.10
Nodes (21): 1. Método e taxonomia de evidência, 2. Resultado executivo, 3.10 Segurança e distribuição — `safeStorage` e deep links têm condições de plataforma, 3.1 ADR-01 — autoridade única resolve ordem, não serializabilidade, 3.2 ADR-02 — a view SQLite não é reconstruível como especificada, 3.3 ADR-03 e ADR-04 — N-API reduz risco, não cria ABI universal Electron–Node, 3.4 ADR-05 a ADR-07 — a ponte DHT→ICE e o fallback de voz não estão comprovados, 3.5 WebRTC e WebCodecs — o absoluto sobre reencode já não é defensável, mas suporte continua incerto (+13 more)

### Community 62 - "C-4 — Criar convite com expiração e limite"
Cohesion: 0.50
Nodes (5): C-4 — Criar convite com expiração e limite, C-6 — Revogar convite sem confirmação, P-14 — Log de auditoria em tempo real com filtros, P-15 — Linha do log com rótulo de autor e alvo, RT-07 — Enum do log de auditoria com três formas divergentes

### Community 63 - "V-5 — Anel de fala ativa"
Cohesion: 0.40
Nodes (5): RT-08 — Saúde da árvore exclusiva do apresentador na UX, aberta no protocolo, V-15 — Painel do apresentador com saúde da árvore, V-4 — Mudo, ensurdecer e câmera, V-5 — Anel de fala ativa, V-6 — Volume individual por participante

### Community 64 - "Tokens de superfície e elevação"
Cohesion: 0.50
Nodes (4): Princípio 4 — Dark-only, superfícies por elevação, Raio de borda (radius-sm/md/lg/full), Tokens de accent (violeta/índigo), Tokens de superfície e elevação

### Community 65 - "K-7 — Comunidade silenciada sem traço nem badge"
Cohesion: 1.00
Nodes (4): K-7 — Comunidade silenciada sem traço nem badge, N-11 — Notificações: toggle geral e nível por comunidade, N-9 — Dispositivos e volumes nas preferências, RT-02 — Preferências locais com escrita e sem query de leitura

### Community 66 - "M-10 — Fixar e desafixar mensagem"
Cohesion: 1.00
Nodes (4): M-10 — Fixar e desafixar mensagem, M-11 — Editar a própria mensagem, M-5 — Reagir com chip que salta na hora, M-8 — Responder em thread

### Community 75 - "Bloco 2 — Fase 2: log, validação e projeção"
Cohesion: 0.10
Nodes (20): Bloco 2 — Fase 2: log, validação e projeção, GAP DR-10 — Não existe o layout de encoding de nenhum `kind`: `opCodec` não pode ser escrito, GAP DR-11 — Ids de cargo, categoria e canal não têm origem: o payload não os carrega e "gerado pelo host" quebra a reprojeção determinística, GAP DR-12 — O lote de bootstrap não distingue o cargo Fundador do cargo base, GAP DR-13 — `reducers.apply(op, tx)` não recebe `seq`, `hostTs` nem `flags`, que quase todo reducer precisa, GAP DR-14 — `validator.validate(op, state)` não define o que é `state` — o módulo não tem assinatura, GAP DR-15 — Não está definido quais estágios do pipeline rodam no cliente, GAP DR-16 — A manutenção do índice FTS5 externo não está especificada (+12 more)

### Community 76 - "dry-run-implementacao.md"
Cohesion: 0.12
Nodes (14): Avaliação, Bloco 8 — Configuração, observabilidade e transversais, GAP DR-51 — Três constantes normativas ficam fora da tabela de configuração, que se declara exaustiva, Implementation Dry Run — Comunidade P2P, Método, **NOT READY TO IMPLEMENT**, Perguntas para o arquiteto, Relação com a auditoria adversarial existente (+6 more)

### Community 77 - "Consolidação"
Cohesion: 0.13
Nodes (15): A. Integridade do log e da projeção, B. Convites e admissão, C. Rede, DoS e recursos, Consolidação, Critical Threats, D. Identidade, chaves e dispositivo, E. Mídia, voz e tela, F. Conteúdo e superfícies do cliente (+7 more)

### Community 78 - "MEDIUM"
Cohesion: 0.14
Nodes (14): DS-17 — A transição de catch-up para modo reativo não tem barreira, e não há watchdog comparando `core.length` com `last_projected_seq`, DS-18 — Todos os caches de §19.4 são invalidados exclusivamente por evento, e nenhum evento sobrevive a um crash entre o commit e a emissão, DS-19 — Reprojeção total: depende de `meta`, que ela apaga, e é o remédio especificado para uma falha que ela reproduz, DS-20 — `local_dedupe` não tem `community_id`, teto, nem limpeza ao sair de uma comunidade, DS-21 — A ordem da outbox é por `created_at` — relógio de parede — em vez de sequência monotônica local, DS-22 — `blob.stage` interrompido não tem retomada, idempotência nem remoção: os bytes ficam no core de blobs para sempre, DS-23 — O rate limit de `message.send` e o lote de `submitOps` foram calibrados para objetivos opostos e se encontram no pior momento, DS-24 — O circuit breaker consome tentativas da outbox sem tentar entregar nada (+6 more)

### Community 79 - "mentions.ts"
Cohesion: 0.21
Nodes (10): CandidateRow(), MentionAutocomplete(), MentionAutocompleteProps, filterMentionCandidates(), matches(), MentionCandidate, normalize(), PRESENCE_ORDER (+2 more)

### Community 80 - "HIGH"
Cohesion: 0.17
Nodes (12): DS-06 — Não existe reconciliação entre a outbox e a projeção: um item entregue e depois expirado é reportado ao usuário como não enviado, DS-07 — Retry fora da janela de dedupe transforma uma op já aplicada em descarte terminal com motivo errado, DS-08 — `banned` e `community-ended` são motivos de descarte inalcançáveis: o mecanismo que os torna verdadeiros é o mesmo que impede o cliente de descobri-los, DS-09 — O dedupe (estágio 5) roda antes do rate limit (estágio 9) e depois da verificação Ed25519 (estágio 3): replay de envelope é o caminho mais barato de produzir e o mais caro de processar, DS-10 — O flush imediato em `host.cameBack` reintroduz exatamente a avalanche que o jitter de §13.3 existe para evitar, e a fila do host não tem profundidade nem shedding, DS-11 — Um buraco de replicação congela a projeção indefinidamente, sem timeout, sem estado e sem evento, DS-12 — `reaction.toggle` é a única op não comutativa do catálogo, e sua correção depende inteiramente da durabilidade do dedupe, DS-13 — `hostTs` e `flags` estão fora da assinatura: o host reescreve carimbo e `clockSkewed` de qualquer registro sem que nenhuma réplica possa detectar (+4 more)

### Community 81 - "Composer.tsx"
Cohesion: 0.29
Nodes (9): ActiveMention, attachmentKind(), Composer(), findMentionQuery(), toAttachment(), mentionToken(), TypingIndicator(), escapeRegExp() (+1 more)

### Community 82 - "CRITICAL"
Cohesion: 0.18
Nodes (11): CRITICAL, T-01 — A `Op` não é vinculada à comunidade: uma assinatura genuína vale em toda comunidade onde o autor exista, T-02 — A réplica verifica assinatura e nada mais: permissão, hierarquia, associação e limites existem só no host, T-03 — A chave de escrita do core não tem a proteção que a ADR-19 dá à identidade, T-04 — O `coreKey` é ao mesmo tempo identificador, tópico de descoberta e capacidade de leitura perpétua — e vaza por uma funcionalidade de UI, T-05 — Replay do próprio envelope depois da janela de dedupe produz colisão determinística de chave primária e para a projeção de todas as réplicas, para sempre, T-06 — A prova de convite não é vinculada nem ao host nem ao candidato: quem estiver no tópico rouba o convite por retransmissão, T-07 — Identidade é gratuita, `inviteRedeem` não tem rate limit, e não há nenhum custo de entrada: Sybil, raide e evasão de ban são industrializáveis (+3 more)

### Community 83 - "MEDIUM"
Cohesion: 0.18
Nodes (11): MEDIUM, T-36 — Nada em disco é cifrado além da chave, e as tabelas `local_*` nunca são reconstruídas, T-37 — A sanitização de nome de anexo remove em vez de rejeitar, e não cobre as peculiaridades do Windows, T-38 — `hello` responde a quem não é membro, T-39 — A redação obrigatória de log não cobre todo o conteúdo gerado por usuário, T-40 — A moderação de voz é conselho, não enforcement, T-41 — A captura de tela começa antes da autorização do host, e não há requisito de indicador local, T-42 — Não existe canal de atualização especificado: não há como distribuir correção de segurança (+3 more)

### Community 84 - "Button.tsx"
Cohesion: 0.22
Nodes (8): ButtonProps, ButtonSize, ButtonVariant, ICON_SIZE_CLASS, SIZE_CLASS, VARIANT_CLASS, Spinner(), SpinnerProps

### Community 85 - "Consolidação por categoria"
Cohesion: 0.22
Nodes (9): Consistency Risks, Consolidação por categoria, Critical Failure Cases, Failure Scenarios, Missing Distributed-System Guarantees, Ordering Risks, Partition / Offline Risks, Recovery Risks (+1 more)

### Community 86 - "Decisões que precisam ser congeladas antes da implementação"
Cohesion: 0.22
Nodes (9): Antes da fase 0 terminar, Antes da fase 3, Antes da fase 4, Antes da fase 5, Antes da fase 7, Antes da primeira linha da fase 1, Antes da primeira linha da fase 2, Contínuo, mas antes de trocar qualquer store (+1 more)

### Community 87 - "uiStore.ts"
Cohesion: 0.22
Nodes (8): ChannelDialog, HIGHLIGHT_MS, JoinSource, MobilePane, OverlayKind, RightPanel, SearchScope, UiState

### Community 88 - "MessageRow.tsx"
Cohesion: 0.43
Nodes (7): DeliveryStatus(), MessageRow(), ReplyPreview(), useAuthorLabel(), formatClock(), formatFullTimestamp(), selectHighestRole()

### Community 89 - "Bloco 1 — Fase 1: ponte IPC"
Cohesion: 0.33
Nodes (6): Bloco 1 — Fase 1: ponte IPC, GAP DR-05 — `sub`/`unsub` não têm semântica: não há como correlacionar um `ev` com a assinatura que o pediu, GAP DR-06 — O backpressure de IPC não tem mecanismo: `MessagePort` não informa quantos quadros não foram drenados, GAP DR-07 — Não há procedimento de reconexão do IPC depois do crash do núcleo, GAP DR-08 — `core.status` tem duas formas contraditórias, e o enum de `phase` não existe, GAP DR-09 — A derivação do `handle` não diz qual base32 nem como truncar

### Community 90 - "Bloco 3 — Fase 3: rede visível, outbox e estados de conexão"
Cohesion: 0.33
Nodes (6): Bloco 3 — Fase 3: rede visível, outbox e estados de conexão, GAP DR-29 — O estado inicial de `hostStatus` não existe, e "2 falhas consecutivas" não se aplica a quem nunca conectou, GAP DR-30 — Membros replicam entre si, e o `firewall` só existe no host: o banido continua lendo, GAP DR-31 — O rate limit de `inviteResolve` é "por IP de peer", e o IP não é a chave disponível, GAP DR-32 — `recent_channels` e `active_channel_id` têm dois donos, GAP DR-33 — O enum de `hostStatus` não está definido em lugar nenhum

### Community 91 - "Bloco 5 — Fase 5: anexos e busca"
Cohesion: 0.33
Nodes (6): Bloco 5 — Fase 5: anexos e busca, GAP DR-37 — Não há mecanismo para o núcleo verificar que o caminho de `blob.stage` veio de um diálogo do SO, GAP DR-38 — `query.links` não tem tabela, regra de extração nem ordenação, GAP DR-39 — A consulta FTS5 não define combinação de tokens nem tratamento dos operadores da sintaxe MATCH, GAP DR-40 — `local_blob_cache.state` não tem enum, e não há retomada de download após crash, GAP DR-41 — O mapa extensão → `kind` de anexo não existe

### Community 92 - "Bloco 7 — Contratos de leitura e o que a UI exige"
Cohesion: 0.33
Nodes (6): Bloco 7 — Contratos de leitura e o que a UI exige, GAP DR-46 — Nenhuma query de §10.4 tem schema de resposta, e não há mapeamento para os tipos que o frontend já usa, GAP DR-47 — Quem reagiu não tem contrato de leitura, e a UI mostra até 6 nomes, GAP DR-48 — Não-lidas de thread não têm tabela local nem query, GAP DR-49 — No log de auditoria, o rótulo do **alvo** é congelado, mas o do **autor** não, GAP DR-50 — `dev.seedDataset` não tem origem para as identidades do dataset de referência

### Community 93 - "Consolidação"
Cohesion: 0.40
Nodes (5): BLOCKERS — impedem começar a implementação, Consolidação, HIGH — provocariam retrabalho, LOW, MEDIUM

### Community 94 - "Bloco 0 — Fase 0 (spike) e fundação de projeto"
Cohesion: 0.40
Nodes (5): Bloco 0 — Fase 0 (spike) e fundação de projeto, GAP DR-01 — O spike da fase 0 não tem critério de aceite nem regra de decisão, GAP DR-02 — Não há especificação de repositório, build e empacotamento — e a migração do frontend web → Electron contradiz "não toca componente nenhum", GAP DR-03 — O canal main↔núcleo não tem contrato, e a chave privada precisa atravessá-lo apesar de §7 proibir, GAP DR-04 — Deep link `comunidadep2p://` e instância única colidem com o modo de falha da ADR-20

### Community 95 - "Bloco 6 — Fases 6 e 7: voz, câmera e tela"
Cohesion: 0.40
Nodes (5): Bloco 6 — Fases 6 e 7: voz, câmera e tela, GAP DR-42 — "Fala ativa" não tem fonte: o roster do host não carrega `speaking`, GAP DR-43 — A árvore atribui pais, mas não define como pai e filho se conectam, GAP DR-44 — `uplinkKbps` é "medido", mas quem acaba de entrar não tem medição, GAP DR-45 — Relação mudo/ensurdecer e persistência do volume por participante

### Community 96 - "Bloco 4 — Fase 4: convites e entrada"
Cohesion: 0.50
Nodes (4): Bloco 4 — Fase 4: convites e entrada, GAP DR-34 — O parsing do código e do link de convite não tem regra, GAP DR-35 — Sair, ser expulso ou ser banido não tem ciclo de vida de dado definido no cliente do alvo, GAP DR-36 — `community.end` sai do swarm como servidor antes de garantir que a op foi replicada

### Community 97 - "LOW"
Cohesion: 0.50
Nodes (4): LOW, T-46 — O deep link `comunidadep2p://` é um canal de comando não autenticado vindo do SO e da web, T-47 — `projector.badSignature` é declarado alarme de segurança e não tem resposta; não há pontuação de peers, T-48 — `kind` de anexo vem da extensão, e a renderização inline é superfície de decodificador

### Community 98 - "React + TypeScript + Vite"
Cohesion: 0.50
Nodes (3): Expanding the Oxlint configuration, React Compiler, React + TypeScript + Vite

## Ambiguous Edges - Review These
- `Árvore de compartilhamento de tela` → `F-20 — ADR-07 (fallback UDX) anula a justificativa da ADR-05 e não tem caminho de mídia`  [AMBIGUOUS]
  docs/auditoria-adversarial.md · relation: references
- `Ids de entidade truncados em 48 bits` → `F-23 — O catálogo tem 34 kinds, não 29, e o número errado é requisito de teste`  [AMBIGUOUS]
  docs/auditoria-adversarial.md · relation: references
- `ADR-18: Sem notificacao com o app fechado no v1` → `Modulo presence (L2)`  [AMBIGUOUS]
  docs/backend.md · relation: conceptually_related_to

## Knowledge Gaps
- **552 isolated node(s):** `/home/rebis/.local/share/uv/tools/graphifyy/bin/python`, `$schema`, `typescript`, `oxc`, `react/rules-of-hooks` (+547 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Árvore de compartilhamento de tela` and `F-20 — ADR-07 (fallback UDX) anula a justificativa da ADR-05 e não tem caminho de mídia`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Ids de entidade truncados em 48 bits` and `F-23 — O catálogo tem 34 kinds, não 29, e o número errado é requisito de teste`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `ADR-18: Sem notificacao com o app fechado no v1` and `Modulo presence (L2)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `cn()` connect `cn` to `ChannelDialogs.tsx`, `Avatar.tsx`, `AppShell.tsx`, `ProfilePopover.tsx`, `types.ts`, `RolesTab.tsx`, `dataset.ts`, `communityStore.ts`, `Community`, `SearchPanel.tsx`, `markdown.tsx`, `inviteStore.ts`, `VoiceOverlay.tsx`, `ChannelList.tsx`, `ChannelInfoPanel.tsx`, `JoinCommunityOverlay.tsx`, `AccountSettings.tsx`, `mentions.ts`, `Composer.tsx`, `Button.tsx`, `MessageRow.tsx`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `react` connect `cn` to `ChannelDialogs.tsx`, `Avatar.tsx`, `AppShell.tsx`, `ProfilePopover.tsx`, `types.ts`, `RolesTab.tsx`, `dataset.ts`, `Community`, `SearchPanel.tsx`, `markdown.tsx`, `inviteStore.ts`, `VoiceOverlay.tsx`, `useCommunityStore`, `ChannelList.tsx`, `messageStore.ts`, `ChannelInfoPanel.tsx`, `Message`, `JoinCommunityOverlay.tsx`, `AccountSettings.tsx`, `plugins`, `DevBar.tsx`, `mentions.ts`, `Composer.tsx`, `Button.tsx`, `MessageRow.tsx`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `useCommunityStore` connect `useCommunityStore` to `ChannelDialogs.tsx`, `Avatar.tsx`, `AppShell.tsx`, `ProfilePopover.tsx`, `RolesTab.tsx`, `dataset.ts`, `communityStore.ts`, `Community`, `SearchPanel.tsx`, `VoiceOverlay.tsx`, `ChannelList.tsx`, `ChannelInfoPanel.tsx`, `cn`, `JoinCommunityOverlay.tsx`, `AccountSettings.tsx`, `DevBar.tsx`, `mentions.ts`, `Composer.tsx`, `MessageRow.tsx`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `/home/rebis/.local/share/uv/tools/graphifyy/bin/python`, `$schema`, `typescript` to the rest of the system?**
  _552 weakly-connected nodes found - possible documentation gaps or missing edges._