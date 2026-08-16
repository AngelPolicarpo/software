# Graph Report - .  (2026-08-15)

## Corpus Check
- 7 files · ~217,376 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1512 nodes · 3725 edges · 75 communities (68 shown, 7 thin omitted)
- Extraction: 91% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 314 edges (avg confidence: 0.79)
- Token cost: 848,330 input · 0 output

## Community Hubs (Navigation)
- Ameaças e Garantias de Segurança
- Confiabilidade e Sistemas Distribuídos
- Blocos e Bloqueadores de Implementação
- Sujeitos Atacados pela Auditoria
- Avatar e Ícone de Comunidade
- Shell, Rail e Botão
- Popover, Slider e Avatar
- Tipos de Domínio do Frontend
- Rastreabilidade de Canais e Anexos
- Rastreabilidade de Arquivos e Convites
- Modal e Select
- Convite, Preview e Entrada
- Store de Comunidade e Fixtures
- Painel Deslizante e Tabs
- Membros e Índice de Busca
- Mensagem, Reação e Emoji
- Tombstone, Deltas e Estrutura
- Bootstrap do App e DevBar
- Guarda de Saída de Voz
- TSConfig do App
- Dataset de Referência e Fila Offline
- Ações e Log de Moderação
- Menu, Toast e Rail
- Lista de Canais
- TSConfig do Node
- Fluxos Administrativos e Cargos
- Premissas e Fluxos Fundacionais
- Superfícies de UX sem Fonte
- Threads e Store de Mensagens
- Formatação de Data e Relógio
- Contexto do Projeto P2P
- Banner de Status e Palco de Tela
- Identidade, Membro e Cargo
- Anexos e Blobs
- Divergências de Contrato UX↔Backend
- Canal de Texto e Composer
- Log Hypercore e Projeção SQLite
- Dependências do Frontend
- Skeleton, Tooltip e Voz
- Store de Voz e Compartilhamento
- Mídia Híbrida e Árvore de Tela
- Ban, Timeout e Moderação
- Autoridade de Escrita e Outbox
- Dependências de Desenvolvimento
- Compartilhamento de Tela e Saúde P2P
- Preferências e Diagnóstico de Rede
- Convites, Segredo e Resgate
- Voz, Presença e Motion
- Política Graphify e MCP
- Transporte, STUN e Efêmeros
- Configuração do Oxlint
- Scripts do package.json
- IPC, Reducers e Busca FTS5
- Membros, Cargos e Hierarquia
- Problemas Abertos de Multicast
- Estado de Conexão e Host
- Mesh de Voz e Fallback TURN
- Stack e Estrutura do Frontend
- Relay Voluntário
- Bibliotecas do Frontend
- Entidades de Estrutura e Cache Offline
- Checkbox e Consentimento de Repasse
- Convites e Log de Auditoria
- Voz e Saúde da Árvore
- Tokens de Superfície e Accent
- Preferências sem Query de Leitura
- Ações Otimistas de Mensagem
- TSConfig Raiz
- Configuração MCP
- Tokens de Tipografia
- Marcar como Lido e Menções
- Aviso de Saída do Host
- Câmera e Erro de Permissão
- Prioridade de Áudio sobre Vídeo

## God Nodes (most connected - your core abstractions)
1. `useCommunityStore` - 60 edges
2. `react` - 58 edges
3. `cn()` - 56 edges
4. `Status PARTIAL — cadeia perde um elo` - 50 edges
5. `useUiStore` - 41 edges
6. `Status COMPLETE — cadeia inteira verificada` - 38 edges
7. `REQUISITOS QUE PARECEM INCOMPLETOS` - 36 edges
8. `Auditoria de Sistemas Distribuídos e Confiabilidade` - 31 edges
9. `Community` - 23 edges
10. `UNRESOLVED QUESTIONS (Q-1 a Q-18)` - 22 edges

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
- **Camada 0 — entrada e identidade (sequencial e bloqueante)** — docs_frontend_tela_0_1_onboarding_identidade, docs_frontend_tela_0_2_hub_vazio, docs_frontend_tela_0_3_entrar_via_convite, docs_frontend_tela_0_4_criar_comunidade, docs_frontend_rota_raiz, docs_frontend_rota_invite_code [EXTRACTED 1.00]
- **Compartilhamento de tela em árvore — topologia, consentimento e saúde** — docs_frontend_tela_2_4_compartilhamento_de_tela, docs_frontend_tela_2_4_1_consentimento_repasse, docs_frontend_tela_2_4_2_painel_do_apresentador, docs_frontend_fluxo_b5_compartilhar_tela, docs_frontend_fluxo_b6_consentimento_retransmissao, docs_frontend_entidade_screensharesession, docs_frontend_topologia_estrela_vs_arvore, docs_frontend_paleta_saude_de_conexao [EXTRACTED 1.00]
- **Slot único do painel direito — membros, thread e painel do canal** — docs_frontend_tela_1_3_painel_de_membros, docs_frontend_tela_2_2_painel_de_thread, docs_frontend_tela_2_1_2_painel_do_canal, docs_frontend_regra_slot_unico_de_painel, docs_frontend_espacamento_e_grid [EXTRACTED 1.00]
- **Parada permanente da projeção sem recuperação** — docs_auditoria_adversarial_f_04, docs_auditoria_adversarial_f_05, docs_auditoria_adversarial_f_07, docs_auditoria_adversarial_f_39, docs_auditoria_adversarial_f_40, docs_auditoria_adversarial_projetor, docs_auditoria_adversarial_reducer_fail_stop [EXTRACTED 1.00]
- **Entrada de membro sem contrato executável** — docs_auditoria_adversarial_f_02, docs_auditoria_adversarial_f_06, docs_auditoria_adversarial_f_09, docs_auditoria_adversarial_f_21, docs_auditoria_adversarial_prova_de_convite [EXTRACTED 1.00]
- **Modelo de audiência e árvore de compartilhamento indefinidos** — docs_auditoria_adversarial_f_08, docs_auditoria_adversarial_f_18, docs_auditoria_adversarial_f_37, docs_auditoria_adversarial_f_42, docs_auditoria_adversarial_arvore_de_compartilhamento, docs_auditoria_adversarial_consentimento_de_repasse [EXTRACTED 1.00]
- **Casos irreversíveis com a mesma raiz: host sem visão consistente e durável do próprio estado** — docs_auditoria_sistemas_distribuidos_ds_01, docs_auditoria_sistemas_distribuidos_ds_03, docs_auditoria_sistemas_distribuidos_ds_04, docs_auditoria_sistemas_distribuidos_ds_05, docs_auditoria_sistemas_distribuidos_fronteira_log_projecao, docs_auditoria_sistemas_distribuidos_estado_validacao [EXTRACTED 1.00]
- **Cadeia de retry e idempotência (Retry / Idempotency Risks)** — docs_auditoria_sistemas_distribuidos_ds_03, docs_auditoria_sistemas_distribuidos_ds_04, docs_auditoria_sistemas_distribuidos_ds_07, docs_auditoria_sistemas_distribuidos_ds_12, docs_auditoria_sistemas_distribuidos_ds_16, docs_auditoria_sistemas_distribuidos_ds_20, docs_auditoria_sistemas_distribuidos_ds_23, docs_auditoria_sistemas_distribuidos_ds_24, docs_auditoria_sistemas_distribuidos_idempotencia_opid, docs_auditoria_sistemas_distribuidos_dedupe_table [EXTRACTED 1.00]
- **Garantias de sistema distribuído que a spec não define em lugar nenhum** — docs_auditoria_sistemas_distribuidos_barreira_durabilidade_ack, docs_auditoria_sistemas_distribuidos_estado_validacao, docs_auditoria_sistemas_distribuidos_dedupe_reconstrucao_boot, docs_auditoria_sistemas_distribuidos_durabilidade_outbox, docs_auditoria_sistemas_distribuidos_reconciliacao_outbox_projecao, docs_auditoria_sistemas_distribuidos_controle_admissao, docs_auditoria_sistemas_distribuidos_bloco_ausente, docs_auditoria_sistemas_distribuidos_deteccao_falha_por_funcao, docs_auditoria_sistemas_distribuidos_particao_parcial, docs_auditoria_sistemas_distribuidos_retry_manual_usuario, docs_auditoria_sistemas_distribuidos_registro_venenoso, docs_auditoria_sistemas_distribuidos_logrecord_metadados_nao_assinados [EXTRACTED 1.00]
- **As dez ameaças CRITICAL do laudo** — docs_threat_model_seguranca_t_01, docs_threat_model_seguranca_t_02, docs_threat_model_seguranca_t_03, docs_threat_model_seguranca_t_04, docs_threat_model_seguranca_t_05, docs_threat_model_seguranca_t_06, docs_threat_model_seguranca_t_07, docs_threat_model_seguranca_t_08, docs_threat_model_seguranca_t_09, docs_threat_model_seguranca_t_10 [EXTRACTED 1.00]
- **Violações do isolamento entre comunidades no mesmo dispositivo (TBP-7)** — docs_threat_model_seguranca_tbp_7, docs_threat_model_seguranca_t_01, docs_threat_model_seguranca_t_25, docs_threat_model_seguranca_t_30, docs_threat_model_seguranca_t_36, docs_threat_model_seguranca_sup_view_db, docs_threat_model_seguranca_sup_firewall_swarm, docs_threat_model_seguranca_sup_dedupe [EXTRACTED 1.00]
- **Cadeia de ataque da árvore de distribuição de tela** — docs_threat_model_seguranca_t_07, docs_threat_model_seguranca_t_13, docs_threat_model_seguranca_t_11, docs_threat_model_seguranca_t_12, docs_threat_model_seguranca_sup_no_repasse, docs_threat_model_seguranca_mg_10 [INFERRED 0.85]
- **Linhas PARTIAL que perdem o mesmo elo: contrato de leitura, projeção ou evento de invalidação** — docs_rastreabilidade_ux_backend_c_4, docs_rastreabilidade_ux_backend_c_6, docs_rastreabilidade_ux_backend_k_1, docs_rastreabilidade_ux_backend_k_6, docs_rastreabilidade_ux_backend_e_10, docs_rastreabilidade_ux_backend_m_1, docs_rastreabilidade_ux_backend_m_2, docs_rastreabilidade_ux_backend_a_2, docs_rastreabilidade_ux_backend_a_7, docs_rastreabilidade_ux_backend_p_1, docs_rastreabilidade_ux_backend_p_14, docs_rastreabilidade_ux_backend_p_15, docs_rastreabilidade_ux_backend_p_16, docs_rastreabilidade_ux_backend_s_3, docs_rastreabilidade_ux_backend_v_15, docs_rastreabilidade_ux_backend_v_18, docs_rastreabilidade_ux_backend_n_1, docs_rastreabilidade_ux_backend_n_2, docs_rastreabilidade_ux_backend_n_9, docs_rastreabilidade_ux_backend_n_11 [EXTRACTED 1.00]
- **Cinco superfícies que precisam de dado que query nenhuma devolve** — docs_rastreabilidade_ux_backend_rt_02, docs_rastreabilidade_ux_backend_rt_05, docs_rastreabilidade_ux_backend_k_7, docs_rastreabilidade_ux_backend_e_12, docs_rastreabilidade_ux_backend_m_6, docs_rastreabilidade_ux_backend_m_9, docs_rastreabilidade_ux_backend_a_8 [EXTRACTED 1.00]
- **Ações otimistas contra RPC síncrono de 30 s sem rollback (F-15)** — docs_rastreabilidade_ux_backend_m_5, docs_rastreabilidade_ux_backend_m_8, docs_rastreabilidade_ux_backend_m_10, docs_rastreabilidade_ux_backend_m_11 [EXTRACTED 1.00]
- **Mandatory Graphify Knowledge-Graph Consultation Workflow** — claude_consulta_obrigatoria_graphify, claude_query_graph, claude_get_neighbors, claude_shortest_path, claude_graphify_update_command [EXTRACTED 1.00]
- **Holepunch P2P Data Stack (Hyperswarm + Hypercore + Hyperdht)** — claude_hyperswarm, claude_hypercore, claude_hyperdht, claude_holepunch [EXTRACTED 1.00]
- **Tiered Screen/Video Sharing Distribution Strategy (star / multicast tree / TURN fallback)** — claude_compartilhamento_tela_video, claude_estrela_direta, claude_multicast_tree, claude_turn_fallback [INFERRED 0.85]

## Communities (75 total, 7 thin omitted)

### Community 0 - "Ameaças e Garantias de Segurança"
Cohesion: 0.06
Nodes (103): Threat Model de Segurança — Comunidade P2P, MG-1 — Revogação de acesso de leitura (ausente), MG-10 — Autenticidade e confidencialidade ponta a ponta da tela (ausentes), MG-11 — Autorização de sinalização e conexão entre pares (ausente), MG-12 — Integridade da anotação do host (hostTs, flags) (ausente), MG-13 — Isolamento entre comunidades no dispositivo (ausente), MG-14 — Confidencialidade em repouso (ausente), MG-15 — Confidencialidade intracomunidade (ausente) (+95 more)

### Community 1 - "Confiabilidade e Sistemas Distribuídos"
Cohesion: 0.06
Nodes (100): Auditoria de Sistemas Distribuídos e Confiabilidade, Árvore de repasse de tela (fanout e reatribuição), Verificação de assinatura Ed25519 em toda réplica, Entrega at-least-once da op, Efeito at-most-once, Semântica do contador attempts, Backpressure nos caminhos de fila, Barreira de durabilidade antes do ACK (flush/fsync) (+92 more)

### Community 2 - "Blocos e Bloqueadores de Implementação"
Cohesion: 0.05
Nodes (76): Avaliação — NOT READY TO IMPLEMENT, BLOCKERS — impedem começar a implementação, Bloco 0 — Fase 0 (spike) e fundação de projeto, Bloco 1 — Fase 1: ponte IPC, Bloco 2 — Fase 2: log, validação e projeção, Bloco 3 — Fase 3: rede visível, outbox e estados de conexão, Bloco 4 — Fase 4: convites e entrada, Bloco 5 — Fase 5: anexos e busca (+68 more)

### Community 3 - "Sujeitos Atacados pela Auditoria"
Cohesion: 0.07
Nodes (68): ADRs QUE PRECISAM DE VALIDAÇÃO, Árvore de compartilhamento de tela, Auto-save de formulários de edição na UI, Backpressure de IPC e ipc.dropped, blobsKey e o core de blobs, Consentimento de repasse do espectador, Derivação do handle a partir da chave pública, F-01 — blobsKey e comunidades participadas só existem na projeção (+60 more)

### Community 4 - "Avatar e Ícone de Comunidade"
Cohesion: 0.06
Nodes (49): CommunityIcon(), AvatarProps, EMOJI_SIZE_CLASS, PRESENCE_SIZE_CLASS, SIZE_CLASS, Badge(), BadgeProps, BadgeTone (+41 more)

### Community 5 - "Shell, Rail e Botão"
Cohesion: 0.07
Nodes (47): AppShell(), CommunityRail(), Button(), ButtonProps, ButtonSize, ButtonVariant, ICON_SIZE_CLASS, SIZE_CLASS (+39 more)

### Community 6 - "Popover, Slider e Avatar"
Cohesion: 0.10
Nodes (33): Avatar(), Popover(), PopoverProps, Slider(), SliderProps, Spinner(), SpinnerProps, TextField() (+25 more)

### Community 7 - "Tipos de Domínio do Frontend"
Cohesion: 0.09
Nodes (35): Attachment, Category, ChannelType, ConnectionHealth, Invite, MessageDeliveryState, ModerationActionType, Permission (+27 more)

### Community 8 - "Rastreabilidade de Canais e Anexos"
Cohesion: 0.05
Nodes (42): A-3 — Aviso de peer desconectado durante o download, A-4 — Anexo indisponível por ausência de peers, A-9 — Aba Fixados do canal, E-1 — Criar canal com slug ao vivo, E-3 — Mover canal trocando a categoria, E-4 — Excluir canal com confirmação nomeada, E-5 — Excluir canal de voz com gente dentro, E-6 — Criar, renomear e excluir categoria (+34 more)

### Community 9 - "Rastreabilidade de Arquivos e Convites"
Cohesion: 0.08
Nodes (33): A-1 — Anexar arquivo com chip no composer e teto de 8 GB, A-2 — Baixar arquivo estilo torrent com N peers, A-6 — Abrir arquivo e Mostrar na pasta, A-7 — Aba Arquivos do canal, C-3 — Entrar na comunidade por convite, C-8 — Rota /invite/:code resolvendo fora do app, I-2 — Editar nome/cor do avatar, I-4 — Invisível continua recebendo tudo (+25 more)

### Community 10 - "Modal e Select"
Cohesion: 0.11
Nodes (23): Modal(), ModalProps, ModalSize, SIZE_CLASS, Select(), SelectOption, SelectProps, TabItem (+15 more)

### Community 11 - "Convite, Preview e Entrada"
Cohesion: 0.09
Nodes (23): InvitePreview, JoinCommunityOverlay(), JoinCommunityOverlayProps, PreviewCard(), ALL_PERMISSIONS, ANA_IDENTITY, CATEGORIES, CHANNELS (+15 more)

### Community 12 - "Store de Comunidade e Fixtures"
Cohesion: 0.11
Nodes (23): BASE_MEMBER_PERMISSIONS, COMMUNITIES, INVITES, ROLES, CreateCommunityInput, CreateInviteInput, EMPTY_STATE, merged() (+15 more)

### Community 13 - "Painel Deslizante e Tabs"
Cohesion: 0.10
Nodes (20): ChannelListProps, CommunityIconProps, SlidePanel(), SlidePanelProps, Tabs(), TabsProps, Community, ChannelInfoPanel() (+12 more)

### Community 14 - "Membros e Índice de Busca"
Cohesion: 0.14
Nodes (23): Member, MemberRowProps, cutoffFor(), DateFilter, hasFilters(), KindFilter, matchesKind(), normalize() (+15 more)

### Community 15 - "Mensagem, Reação e Emoji"
Cohesion: 0.12
Nodes (21): Message, Reaction, EmojiPicker(), EmojiPickerProps, EMOJIS, MessageContent(), MessageContentProps, useMentionTokens() (+13 more)

### Community 16 - "Tombstone, Deltas e Estrutura"
Cohesion: 0.13
Nodes (24): ADR-10: Deletar e sempre tombstone, ADR-15: Nao-lidas e mencoes sao calculo 100% local por watermark de seq, Delta 1: exclusao nao apaga bytes do log, Delta 10: editar nao apaga o conteudo anterior, Entidade Category, Entidade Channel, Entidade ModerationEntry (log de auditoria), Fluxo: criar canal (D14) (+16 more)

### Community 17 - "Bootstrap do App e DevBar"
Cohesion: 0.14
Nodes (18): Ponto de montagem da aplicação (#root), Tema escuro único (dark-only v1), Interface em português do Brasil (lang=pt-BR), App(), ToastViewport(), DevBar(), decodeMessageRef(), encodeMessageRef() (+10 more)

### Community 18 - "Guarda de Saída de Voz"
Cohesion: 0.12
Nodes (15): AvatarSize, LeaveVoiceGuard, useLeaveVoiceGuard(), LeaveVoiceConfirm(), ShareSourceModal(), ShareSourceModalProps, SOURCES, BarControlProps (+7 more)

### Community 19 - "TSConfig do App"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 20 - "Dataset de Referência e Fila Offline"
Cohesion: 0.13
Nodes (23): Dataset de referência (fixtures mockadas), Attachment, Invite, Message, Reaction, Thread, Fluxo B4 — Host offline, modo cache e reconexão, Fluxo B8 — Download de arquivo estilo torrent (+15 more)

### Community 21 - "Ações e Log de Moderação"
Cohesion: 0.14
Nodes (20): ModerationAction, ModerationDialog(), ACTION_ICON, describe(), ModerationTab(), ModerationTabProps, remaining(), TYPE_FILTERS (+12 more)

### Community 22 - "Menu, Toast e Rail"
Cohesion: 0.18
Nodes (14): Menu(), MenuItem, MenuProps, ICON, ICON_CLASS, ToastItem(), MessageActionsProps, INVITE_LINK_HOST (+6 more)

### Community 23 - "Lista de Canais"
Cohesion: 0.19
Nodes (17): ChannelContextMenu(), CategorySection(), CategorySectionProps, ChannelList(), ChannelListItem(), ChannelListItemProps, useContextMenu(), DeliveryStatus() (+9 more)

### Community 24 - "TSConfig do Node"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 25 - "Fluxos Administrativos e Cargos"
Cohesion: 0.13
Nodes (19): ModerationAction, Fluxo D12 — Moderação rápida + log de auditoria, Fluxo D14 — Criar um canal de texto, Fluxo D15 — Excluir um canal com chamada acontecendo, Paleta de cor de cargo (7 cores curadas), Premissa 11 — Apelido é auto-atribuído por comunidade, Premissa 4 — Convites sem expiração por padrão, configuráveis e revogáveis, Princípio 3 — Honestidade sobre limitações conhecidas (+11 more)

### Community 26 - "Premissas e Fluxos Fundacionais"
Cohesion: 0.16
Nodes (19): Espaçamento e grid do shell, Fluxo A1 — Criar identidade local, Fluxo A2 — Entrar via convite + preview, Fluxo A3 — Criar comunidade / virar host, Premissa 1 — Plataforma-alvo do mock é web (browser), Premissa 2 — Sem descoberta pública de comunidades, Premissa 3 — Identidade é local a um dispositivo, Premissa 7 — Badge de não-lido e mute por canal/comunidade no v1 (+11 more)

### Community 27 - "Superfícies de UX sem Fonte"
Cohesion: 0.16
Nodes (19): A-5 — Anexo corrompido, A-8 — Aba Links do canal, C-5 — Lista de convites ativos com código, E-11 — Copiar link do canal para /m/:code, E-12 — Canal de voz lista participantes inline na sidebar, M-18 — Copiar link da mensagem para /m/:code, M-6 — Hover no chip mostra até 6 nomes de reatores, M-9 — Badge de não-lidas da thread (+11 more)

### Community 28 - "Threads e Store de Mensagens"
Cohesion: 0.16
Nodes (14): Thread, ThreadPanel(), ThreadPanelProps, findChannelMessages(), THREADS, compose(), deliveryOf(), MessageState (+6 more)

### Community 29 - "Formatação de Data e Relógio"
Cohesion: 0.14
Nodes (18): clock, CLOCK_AHEAD_HINT, CLOCK_SKEW_TOLERANCE_MS, daysFromToday(), decimals(), displayDate(), formatClock(), formatDaySeparator() (+10 more)

### Community 30 - "Contexto do Projeto P2P"
Cohesion: 0.18
Nodes (18): Keet (Holepunch reference app), Planned P2P Backend Layer, Distribuição de Arquivos Estilo Torrent, File Storage & Torrent-style Distribution, backend/ — Placeholder Backend (lógica P2P depois), Backend (Empty Placeholder — P2P logic deferred), Comunidade P2P (voz/vídeo/tela) — Project, Dados da Comunidade (mensagens, canais, cargos, moderação) (+10 more)

### Community 31 - "Banner de Status e Palco de Tela"
Cohesion: 0.13
Nodes (15): StatusBanner(), StatusBannerProps, StatusBannerTone, TONE, RelayNode, QUALITY_LABEL, ScreenShareStage(), ScreenShareStageProps (+7 more)

### Community 32 - "Identidade, Membro e Cargo"
Cohesion: 0.17
Nodes (17): ADR-19: Chave privada cifrada com safeStorage do Electron, Entidade Identity, Entidade Member, Entidade Role, Fluxo: sair da identidade, Fluxo: cargos, criar, mover e atribuir (D13), Op identity.update, Op member.leave (+9 more)

### Community 33 - "Anexos e Blobs"
Cohesion: 0.16
Nodes (17): Entidade Attachment, Entidade Message, Entidade Reaction, Entidade Thread, Fluxo: anexar arquivo (upload), Fluxo: baixar arquivo (B8), Modulo blobs (L2), Op message.pin (+9 more)

### Community 34 - "Divergências de Contrato UX↔Backend"
Cohesion: 0.16
Nodes (17): C-1 — Colar código/link com preview antes de entrar, C-2 — Desfecho banido com preview reduzido, C-7 — Código curto de 6 caracteres, E-2 — Editar canal com auto-save e zona de perigo, I-6 — Identificador local exibido @ana, K-3 — Editar metadados da comunidade com auto-save de 800 ms, M-17 — Carimbo de mensagem e relógio adiantado, M-3 — Mensagem pendente na posição cronológica (+9 more)

### Community 35 - "Canal de Texto e Composer"
Cohesion: 0.15
Nodes (11): ChannelContextMenuProps, Channel, ChannelView(), ChannelViewProps, Composer(), MessageList(), MessageListProps, startsNewGroup() (+3 more)

### Community 36 - "Log Hypercore e Projeção SQLite"
Cohesion: 0.19
Nodes (15): ADR-02: Hypercore cru como log + SQLite como view materializada, ADR-03: Driver SQLite = better-sqlite3@13, ADR-16: Toda comunidade participada replica em background, ADR-20: Um unico processo nucleo por instalacao, com lock de diretorio, Entidade Community, Fluxo: boot, abrir e replicar comunidades participadas, Fluxo: criar comunidade / virar host (A3), Fluxo: encerrar comunidade (+7 more)

### Community 37 - "Dependências do Frontend"
Cohesion: 0.13
Nodes (15): @fontsource-variable/inter, dependencies, @fontsource-variable/inter, lucide-react, react, react-dom, react-router-dom, tailwindcss (+7 more)

### Community 38 - "Skeleton, Tooltip e Voz"
Cohesion: 0.16
Nodes (10): Skeleton(), SkeletonProps, Tooltip(), TooltipProps, VoiceParticipant, ChannelHeader(), ChannelHeaderProps, VoiceTile() (+2 more)

### Community 39 - "Store de Voz e Compartilhamento"
Cohesion: 0.17
Nodes (14): MeshStatus, ScreenShareSession, IDS, buildRelays(), canSpeak(), clearAllTimers(), clearShareTimers(), ConsentRequest (+6 more)

### Community 40 - "Mídia Híbrida e Árvore de Tela"
Cohesion: 0.19
Nodes (14): ADR-05: Midia hibrida (WebRTC para voz, WebCodecs sobre UDX para tela), ADR-17: A arvore de distribuicao de tela e calculada pelo host, Delta 6: sem descoberta LAN, Delta 4: mensagem da fila se move ao ser entregue, Delta 11: duas regras novas contra escalada de cargo, Delta 12: ops de estrutura nao entram na fila offline, Delta 8: fixture TELA-04 com 7 espectadores em canal de 3, Delta 3: espectador em arvore fica 1-2 s atras (+6 more)

### Community 41 - "Ban, Timeout e Moderação"
Cohesion: 0.21
Nodes (14): Delta 9: ban oculta mensagens de forma reversivel, Entidade Ban / Timeout, Fluxo: banir (D12), Fluxo: timeout, Op mod.ban, Op mod.removeTimeout, Op mod.revokeBan, Op mod.timeout (+6 more)

### Community 42 - "Autoridade de Escrita e Outbox"
Cohesion: 0.26
Nodes (13): ADR-01: Host e a unica autoridade de escrita, ADR-11: Fila de saida (outbox) duravel em SQLite, ADR-12: Idempotencia por opId = BLAKE2b-256 do envelope canonico, Fluxo: saida do host (3.5), Fluxo: host offline, fila, reconexao e flush (B4), Fluxo: enviar mensagem com host online (C9), Modulo communityHost (L2), Modulo opCodec (L1) (+5 more)

### Community 43 - "Dependências de Desenvolvimento"
Cohesion: 0.15
Nodes (13): devDependencies, oxlint, @types/node, @types/react, @types/react-dom, vite, @vitejs/plugin-react, oxlint (+5 more)

### Community 44 - "Compartilhamento de Tela e Saúde P2P"
Cohesion: 0.24
Nodes (12): ScreenShareSession, Fluxo B5 — Compartilhar tela: estrela, árvore, reparo, Fluxo B6 — Consentimento de retransmissão de upload, Paleta de feedback de sistema, Paleta de saúde de conexão P2P (conn-*), Premissa 9 — Câmera é escopo e vai por mesh, não pela árvore, Princípio 2 — A saúde da conexão é informação de primeira classe, 2.3.2 Câmera (+4 more)

### Community 45 - "Preferências e Diagnóstico de Rede"
Cohesion: 0.18
Nodes (11): DIAGNOSTIC_MS, MOCK_CAMERAS, MOCK_MICROPHONES, MOCK_OUTPUTS, NAT_LABEL, NatType, NOTIFICATION_LABEL, NotificationLevel (+3 more)

### Community 46 - "Convites, Segredo e Resgate"
Cohesion: 0.25
Nodes (11): ADR-09: Convite = segredo de 10 bytes (80 bits) em Crockford Base32, Delta 2: codigo de convite de 6 para 16 caracteres, Delta 5: desfechos novos de preview (unreachable, ended), Entidade Invite, Fluxo: convite emitir, resolver e resgatar (A2), Modulo invites (L2), Op invite.create, Op invite.revoke (+3 more)

### Community 47 - "Voz, Presença e Motion"
Cohesion: 0.24
Nodes (11): Identity (identidade local), Fluxo B7 — Entrar em canal de voz com mesh parcial, Fluxo C11 — Persistência de chamada ao trocar de canal/comunidade, Iconografia (outline, 16/20/24px, Lucide), Indicador de fala ativa (anel + movimento, nunca só cor), Motion (durações, easing, prefers-reduced-motion), Paleta semântica de presença, Regra da presença Invisível ao entrar em canal de voz (+3 more)

### Community 48 - "Política Graphify e MCP"
Cohesion: 0.22
Nodes (10): Consulta Obrigatória ao Graphify (política de workflow), get_community (MCP tool), get_neighbors (MCP tool), get_node (MCP tool), god_nodes (MCP tool), graph_stats (MCP tool), Graphify (grafo de conhecimento via MCP), /graphify . --update (comando de re-sincronização) (+2 more)

### Community 49 - "Transporte, STUN e Efêmeros"
Cohesion: 0.22
Nodes (10): ADR-06: Sem STUN de terceiros por padrao, ADR-07: UDX como fallback universal de transporte, ADR-14: Presenca, digitando e roster de voz sao efemeros, ADR-18: Sem notificacao com o app fechado no v1, Fluxo: entrar em canal de voz (B7), Modulo permissions (L1), Modulo presence (L2), Modulo voiceCoordinator (L2) (+2 more)

### Community 50 - "Configuração do Oxlint"
Cohesion: 0.20
Nodes (9): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, typescript, oxc, warn (+1 more)

### Community 51 - "Scripts do package.json"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, lint, preview, type (+1 more)

### Community 52 - "IPC, Reducers e Busca FTS5"
Cohesion: 0.28
Nodes (9): ADR-04: Nucleo P2P em utilityProcess do Electron, ADR-13: Busca full-text em SQLite FTS5, Fluxo: busca (C10), Modulo ipc (L3), Modulo reducers (L1), Modulo search (L2), Tabela SQLite channels, Tabela SQLite members (+1 more)

### Community 53 - "Membros, Cargos e Hierarquia"
Cohesion: 0.33
Nodes (9): Member, Role (cargo), Fluxo D13 — Gestão de cargos e permissões, Regra de hierarquia de cargos, Regra do slot único de painel deslizante, 1.3 Painel de membros, 1.4 Popover de perfil de membro, 2.2 Painel de thread (+1 more)

### Community 54 - "Problemas Abertos de Multicast"
Cohesion: 0.25
Nodes (8): Problema: Consentimento de Repasse de Upload do Espectador, Application-Layer Multicast em Árvore (audiência maior), P2Cast, Problema: CGNAT impede virar nó de repasse, Open Problem: Consent for Relaying via Viewer Upload, Open Problem: Multicast Tree Repair on Mid-Node Failure, Problema: Reparo de Árvore (nó do meio cai), SplitStream

### Community 55 - "Estado de Conexão e Host"
Cohesion: 0.39
Nodes (6): HostStatus, AULA_WEBRTC_ATTACHMENT, ConnectionState, RECONNECT_DELAY_MS, useConnectionStore, useHostStatus()

### Community 56 - "Mesh de Voz e Fallback TURN"
Cohesion: 0.29
Nodes (7): Screen/Video Sharing, Estrela Direta (≤4-5 espectadores), WebRTC (Media Stack), Fallback TURN (NAT restritivo), Voice: Direct P2P Mesh, Voz — Mesh P2P Direto entre Participantes, WebRTC

### Community 57 - "Stack e Estrutura do Frontend"
Cohesion: 0.33
Nodes (7): Project Structure: frontend/, Frontend Stack: Vite + React + TypeScript, Tailwind CSS, Zustand, App HTML Entry Point (index.html), Oxlint Type-Aware Configuration (oxlint-tsgolint, .oxlintrc.json), React Compiler (not enabled on this template), @vitejs/plugin-react (uses Oxc), @vitejs/plugin-react-swc (uses SWC)

### Community 58 - "Relay Voluntário"
Cohesion: 0.43
Nodes (7): ADR-08: Relay por voluntarios (blind-relay), Delta 7: consentimento de relay voluntario em 3.1 Rede, Entidade RelayVolunteer, Fluxo: relay voluntario, Modulo relay (L2), Op relay.volunteer, Op relay.withdraw

### Community 59 - "Bibliotecas do Frontend"
Cohesion: 0.33
Nodes (6): frontend/ — Frontend App (Vite+React+TS+Tailwind+Zustand), React, Tailwind CSS (@tailwindcss/vite), Vite, zustand, zustand

### Community 60 - "Entidades de Estrutura e Cache Offline"
Cohesion: 0.40
Nodes (6): Category, Channel, Community, ConnectionHealth, VoiceSession, Modo cache local somente-leitura (host offline)

### Community 61 - "Checkbox e Consentimento de Repasse"
Cohesion: 0.47
Nodes (4): Checkbox(), CheckboxProps, RelayConsentModal(), useDocumentVisible()

### Community 62 - "Convites e Log de Auditoria"
Cohesion: 0.50
Nodes (5): C-4 — Criar convite com expiração e limite, C-6 — Revogar convite sem confirmação, P-14 — Log de auditoria em tempo real com filtros, P-15 — Linha do log com rótulo de autor e alvo, RT-07 — Enum do log de auditoria com três formas divergentes

### Community 63 - "Voz e Saúde da Árvore"
Cohesion: 0.40
Nodes (5): RT-08 — Saúde da árvore exclusiva do apresentador na UX, aberta no protocolo, V-15 — Painel do apresentador com saúde da árvore, V-4 — Mudo, ensurdecer e câmera, V-5 — Anel de fala ativa, V-6 — Volume individual por participante

### Community 64 - "Tokens de Superfície e Accent"
Cohesion: 0.50
Nodes (4): Princípio 4 — Dark-only, superfícies por elevação, Raio de borda (radius-sm/md/lg/full), Tokens de accent (violeta/índigo), Tokens de superfície e elevação

### Community 65 - "Preferências sem Query de Leitura"
Cohesion: 1.00
Nodes (4): K-7 — Comunidade silenciada sem traço nem badge, N-11 — Notificações: toggle geral e nível por comunidade, N-9 — Dispositivos e volumes nas preferências, RT-02 — Preferências locais com escrita e sem query de leitura

### Community 66 - "Ações Otimistas de Mensagem"
Cohesion: 1.00
Nodes (4): M-10 — Fixar e desafixar mensagem, M-11 — Editar a própria mensagem, M-5 — Reagir com chip que salta na hora, M-8 — Responder em thread

## Ambiguous Edges - Review These
- `ADR-18: Sem notificacao com o app fechado no v1` → `Modulo presence (L2)`  [AMBIGUOUS]
  docs/backend.md · relation: conceptually_related_to
- `F-20 — ADR-07 (fallback UDX) anula a justificativa da ADR-05 e não tem caminho de mídia` → `Árvore de compartilhamento de tela`  [AMBIGUOUS]
  docs/auditoria-adversarial.md · relation: references
- `F-23 — O catálogo tem 34 kinds, não 29, e o número errado é requisito de teste` → `Ids de entidade truncados em 48 bits`  [AMBIGUOUS]
  docs/auditoria-adversarial.md · relation: references
- `DS-18 — Caches invalidados só por evento, perdido no crash entre commit e emissão` → `Monotonic reads no cliente`  [AMBIGUOUS]
  docs/auditoria-sistemas-distribuidos.md · relation: conceptually_related_to
- `DS-22 — blob.stage interrompido sem retomada, idempotência nem remoção` → `Tabela local_dedupe (opId → seq, janela de 7 dias)`  [AMBIGUOUS]
  docs/auditoria-sistemas-distribuidos.md · relation: conceptually_related_to
- `DS-29 — Host com relógio errado rejeita toda escrita da comunidade` → `Determinismo da reprojeção`  [AMBIGUOUS]
  docs/auditoria-sistemas-distribuidos.md · relation: conceptually_related_to
- `DR-42 — Fala ativa sem fonte: o roster não carrega speaking` → `DR-43 — Árvore atribui pais mas não define o handshake da aresta`  [AMBIGUOUS]
  docs/dry-run-implementacao.md · relation: conceptually_related_to
- `DR-51 — Constantes normativas fora da tabela exaustiva de §20` → `opCodec — registry de encoding por kind`  [AMBIGUOUS]
  docs/dry-run-implementacao.md · relation: conceptually_related_to

## Knowledge Gaps
- **343 isolated node(s):** `CreateInviteInput`, `State`, `AvatarProps`, `PopoverProps`, `ConnectionHealth` (+338 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `ADR-18: Sem notificacao com o app fechado no v1` and `Modulo presence (L2)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `F-20 — ADR-07 (fallback UDX) anula a justificativa da ADR-05 e não tem caminho de mídia` and `Árvore de compartilhamento de tela`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `F-23 — O catálogo tem 34 kinds, não 29, e o número errado é requisito de teste` and `Ids de entidade truncados em 48 bits`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `DS-18 — Caches invalidados só por evento, perdido no crash entre commit e emissão` and `Monotonic reads no cliente`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `DS-22 — blob.stage interrompido sem retomada, idempotência nem remoção` and `Tabela local_dedupe (opId → seq, janela de 7 dias)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `DS-29 — Host com relógio errado rejeita toda escrita da comunidade` and `Determinismo da reprojeção`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `DR-42 — Fala ativa sem fonte: o roster não carrega speaking` and `DR-43 — Árvore atribui pais mas não define o handshake da aresta`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._