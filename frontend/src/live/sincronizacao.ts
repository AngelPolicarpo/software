/**
 * O sincronizador: enche o espelho das stores com o que o núcleo responde (§15.6), reage
 * aos eventos de §15.5 e injeta nas stores o canal de **escrita** (§15.4).
 *
 * Este é o único módulo que sabe que existe IPC-R **e** que existem stores. Os componentes
 * continuam lendo as stores como sempre leram; as stores continuam resolvendo
 * `criado[id] ?? espelho[id] + override`. A diferença é que o espelho agora vem do núcleo.
 *
 * Evento é **sinal para reconsultar**, nunca fonte de verdade (§15.1 regra 5). A exceção
 * declarada é o par de desfechos da outbox (`message.accepted`/`message.failed`, §11.6):
 * eles EXISTEM para casar a bolha otimista pelo `clientRef`, e é isso que os handlers
 * fazem — o conteúdo da linha aceita continua vindo de `query.messages`, disparada pelo
 * `messages.appended` que sempre chega antes (DS-31).
 */

import { api, cliente } from "../ipc/api";
import { registrarResync, useSessao } from "./sessao";
import { canal as adaptarCanal, categoria, comunidade, identidade, cargo, membroDeEntrada, bolhaDaFila, reacoes, anexo, entradaDeAuditoria, banido, timeout as adaptarTimeout } from "./adaptadores";
import { codigoDoErro } from "../ipc/frames";
import type { EvMessageAccepted, AuditItem, BanItem, Pagina, TimeoutItem } from "../ipc/dto";
import { useCommunityStore } from "../store/communityStore";
import { useIdentityStore } from "../store/identityStore";
import { useVoiceStore } from "../store/voiceStore";
import { MalhaDeVoz } from "./voz";
import { useMessageStore } from "../store/messageStore";
import { useDownloadStore } from "../store/downloadStore";
import { useModerationStore } from "../store/moderationStore";
import { useSettingsStore } from "../store/settingsStore";
import { mensagem as adaptarMensagem, threadsDaPagina } from "./adaptadores";
import type { Category, Channel, Community, Member, Message, Role } from "../domain/types";

/** Evita consultas concorrentes para a mesma comunidade quando vários eventos chegam juntos. */
const emVoo = new Set<string>();

async function comExclusao<T>(chave: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (emVoo.has(chave)) return undefined;
  emVoo.add(chave);
  try {
    return await fn();
  } finally {
    emVoo.delete(chave);
  }
}

/** `query.identity` → o `Identity` que o mock consome. */
export async function sincronizarIdentidade(): Promise<void> {
  const d = await api.identity().catch(() => null);
  if (d === null) return;
  const eu = identidade(d);
  useIdentityStore.setState({ identity: eu });
  useCommunityStore.getState().aplicarRemoto({ euId: eu.id });
}

/**
 * `query.communities` → rail. A lista chega na ordem de entrada, que é exatamente a ordem
 * que o rail do mock espera — nada é reordenado aqui.
 */
export async function sincronizarComunidades(): Promise<void> {
  const lista = await api.communities().catch(() => null);
  if (lista === null) return;
  const store = useCommunityStore.getState();
  const communities: Record<string, Community> = { ...store.remote.communities };
  for (const c of lista) {
    // Preserva o que a estrutura já preencheu (`categoryIds`), senão trocar de tela
    // esvaziaria a lista de canais até a próxima consulta.
    const anterior = communities[c.id];
    communities[c.id] = {
      ...comunidade(c),
      ...(anterior !== undefined
        ? { categoryIds: anterior.categoryIds, roleIds: anterior.roleIds, hostPeerId: anterior.hostPeerId }
        : {}),
    };
  }
  store.aplicarRemoto({ communities, order: lista.map((c) => c.id) });
  // O rail mostra as comunidades das quais se participa; com dado real, participar É estar
  // na resposta de `query.communities`.
  useCommunityStore.setState((s) => ({
    joinedCommunityIds: lista.map((c) => c.id),
    activeCommunityId: s.activeCommunityId ?? lista[0]?.id ?? null,
  }));
}

/** `query.structure` + `query.community` + `query.roles` → categorias, canais e cargos. */
export async function sincronizarComunidade(communityId: string): Promise<void> {
  await comExclusao(`com:${communityId}`, async () => {
    const [estrutura, detalhe, cargos] = await Promise.all([
      api.structure(communityId).catch(() => null),
      api.community(communityId).catch(() => null),
      api.roles(communityId).catch(() => null),
    ]);
    if (estrutura === null) return;
    const store = useCommunityStore.getState();

    const categories: Record<string, Category> = { ...store.remote.categories };
    const channels: Record<string, Channel> = { ...store.remote.channels };
    for (const cat of estrutura.categories) {
      categories[cat.id] = categoria(communityId, cat);
      for (const ch of cat.channels) channels[ch.id] = adaptarCanal(communityId, cat.id, ch);
    }

    const roles: Record<string, Role> = { ...store.remote.roles };
    // `rank` é índice fracionário e não vira inteiro; a ordem do array (rank DESC) É a
    // hierarquia, então a posição do mock é o ordinal invertido.
    const lista = cargos?.roles ?? [];
    lista.forEach((r, i) => {
      roles[r.id] = cargo(r, lista.length - i);
    });

    const anterior = store.remote.communities[communityId];
    const communities = { ...store.remote.communities };
    if (anterior !== undefined) {
      communities[communityId] = {
        ...anterior,
        categoryIds: estrutura.categories.map((c) => c.id),
        roleIds: lista.map((r) => r.id),
        ...(detalhe !== null ? { hostPeerId: detalhe.hostRef.key, memberCount: detalhe.memberCount } : {}),
      };
    }
    store.aplicarRemoto({ categories, channels, roles, communities });
  });
}

/** `query.members` → roster. Os grupos vêm por cargo; o membro carrega o cargo do grupo. */
export async function sincronizarMembros(communityId: string): Promise<void> {
  const pagina = await api.members({ communityId, limit: 100 }).catch(() => null);
  if (pagina === null) return;
  const membros: Member[] = [];
  for (const g of pagina.groups) {
    for (const m of g.members) membros.push(membroDeEntrada(communityId, m, g.roleId));
  }
  const store = useCommunityStore.getState();
  store.aplicarRemoto({
    membersByCommunity: { ...store.remote.membersByCommunity, [communityId]: membros },
  });
}

/** `query.invites` → convites da comunidade. */
export async function sincronizarConvites(communityId: string): Promise<void> {
  const r = await api.invites(communityId).catch(() => null);
  if (r === null) return;
  const store = useCommunityStore.getState();
  const outras = store.remote.invites.filter((i) => i.communityId !== communityId);
  store.aplicarRemoto({
    invites: [
      ...outras,
      ...r.items.map((i) => ({
        // O mock chaveia convite por `code`; §15.6 só entrega o código a quem o criou NESTA
        // instalação (delta U-04). Sem código, a chave pública é o identificador estável.
        code: i.code ?? i.invitePublicKey,
        communityId,
        createdById: i.createdBy.key,
        createdAt: new Date(i.createdAt).toISOString(),
        ...(i.expiresAt !== undefined ? { expiresAt: new Date(i.expiresAt).toISOString() } : {}),
        ...(i.maxUses !== undefined ? { maxUses: i.maxUses } : {}),
        uses: i.uses,
        revoked: i.revokedAt !== undefined,
      })),
    ],
  });
}

/**
 * Leituras de moderação de §15.6 — `query.auditLog`/`query.bans`/`query.timeouts`.
 * As três exigem `view_audit_log`: a recusa `E_PERMISSION_DENIED` é ESTADO aqui
 * (a tela diz "sem permissão"), não silêncio que fingiria que nada aconteceu.
 */
export async function sincronizarModeracao(communityId: string): Promise<void> {
  await comExclusao(`mod:${communityId}`, async () => {
    const [log, bans, timeouts] = await Promise.all([
      api.auditLog({ communityId, limit: 50 }).catch((e) => e as Pagina<AuditItem> | Error),
      api.bans({ communityId }).catch((e) => e as Pagina<BanItem> | Error),
      api.timeouts({ communityId }).catch((e) => e as Pagina<TimeoutItem> | Error),
    ]);
    // A permissão é UMA para as três: só vale o flag quando TODAS negarem —
    // falha parcial preserva o espelho e não mente sobre permissão.
    const negadas = [log, bans, timeouts].filter((r) => r instanceof Error);
    if (negadas.length > 0 && negadas.every((r) => codigoDoErro(r) === "E_PERMISSION_DENIED")) {
      useModerationStore.getState().aplicarRemoto({
        auditLog: [], bans: [], timeouts: [], semPermissao: true,
      });
      return;
    }
    const store = useModerationStore.getState();
    store.aplicarRemoto({
      semPermissao: false,
      auditLog:
        log instanceof Error
          ? store.auditLog
          : log.items.map((item) => entradaDeAuditoria(item, communityId)),
      bans:
        bans instanceof Error
          ? store.bans
          : bans.items.map((item) => banido(item, communityId)),
      timeouts:
        timeouts instanceof Error
          ? store.timeouts
          : timeouts.items
              .map((item) => adaptarTimeout(item, communityId))
              .filter((t) => t !== null),
    });
  });
}

/**
 * Não-lidas por thread do canal ativo (§9, 2.2) — `query.thread.unread` responde só
 * as com contador acima de zero; ausência no mapa É "lida". Roda nos MESMOS gatilhos
 * da página de mensagens: carregar o canal, resposta que chega, resync e leitura.
 */
export async function sincronizarThreadsNaoLidas(communityId: string, channelId: string): Promise<void> {
  const pagina = await api.threadUnread({ communityId, channelId }).catch(() => null);
  if (pagina === null) return;
  const porThread: Record<string, number> = {};
  for (const item of pagina.items) porThread[item.threadId] = item.unreadCount;
  useMessageStore.getState().aplicarNaoLidasDeThreads(porThread);
}

/** `query.messages` → histórico do canal. */
export async function sincronizarMensagens(communityId: string, channelId: string): Promise<void> {
  await comExclusao(`msg:${channelId}`, async () => {
    const pagina = await api
      .messages({ communityId, channelId, limit: 50, direction: "before" })
      .catch(() => null);
    if (pagina === null) return;
    const eu = useCommunityStore.getState().remote.euId;
    const store = useMessageStore.getState();
    const mensagens: Message[] = pagina.messages.map((m) => adaptarMensagem(m, eu));
    // Threads de OUTRAS instalações que a página revelou (§61.4): sem isto o chip
    // "N respostas" não renderiza e o painel não abre para quem não criou a thread.
    const conhecidas = new Set([...Object.keys(store.remoteThreads), ...Object.keys(store.createdThreads)]);
    const novas = threadsDaPagina(pagina.messages, conhecidas);
    store.aplicarRemoto({
      remoteMessages: { ...store.remoteMessages, [channelId]: mensagens },
      ...(novas.length > 0 ? { remoteThreads: { ...store.remoteThreads, ...Object.fromEntries(novas.map((t) => [t.id, t])) } } : {}),
    });
    // A raiz projetou o `threadId` real? Assenta a criação otimista (§8.x R-24).
    for (const m of mensagens) {
      if (m.threadId !== undefined) store.assentarThreadReal(m.id, m.threadId);
    }
    // §9 2.2 — os badges de thread vivem nos MESMOS gatilhos da página: carregar o
    // canal, resposta que chega (`messages.appended`) e resync passam por aqui.
    await sincronizarThreadsNaoLidas(communityId, channelId);
  });
}

/**
 * `query.outbox` → a fila redesenhada (F-16). Só viram bolhas os itens desta
 * instalação com `clientRef` e preview de conteúdo; o resto da fila (ops de
 * estrutura, reações, de outras janelas) não é linha de canal.
 */
export async function sincronizarFila(communityId: string): Promise<void> {
  await comExclusao(`fila:${communityId}`, async () => {
    const dto = await api.outbox(communityId).catch(() => null);
    if (dto === null) return;
    useMessageStore.getState().aplicarFila(
      dto.items
        .map(bolhaDaFila)
        .filter((b) => b !== null),
    );
  });
}

/** O que a comunidade ativa precisa ter carregado. */
export async function abrirComunidade(communityId: string): Promise<void> {
  await Promise.all([
    sincronizarComunidade(communityId),
    sincronizarMembros(communityId),
    sincronizarConvites(communityId),
    sincronizarFila(communityId),
    sincronizarModeracao(communityId),
  ]);
}

/**
 * O canal de comunidade de um canal de texto, resolvido na hora do despacho.
 * A store não conhece o mapeamento — este módulo sim (é o que ele existe para).
 */
function comunidadeDoCanal(channelId: string): string {
  const canal = useCommunityStore.getState().remote.channels[channelId];
  if (canal === undefined) throw new Error("O canal não pertence a uma comunidade conhecida");
  return canal.communityId;
}

/** Erro de consulta vira falha nomeada; cancelamento nativo não é falha. */
function erroDeEscrita(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * O canal de escrita real (§15.4): cada comando responde `{opId, state}` e o
 * desfecho vem por evento — nada aqui espera entrega. Cancelamento do diálogo
 * nativo (`E_CANCELLED`) não é falha: volta como gesto abortado, sem bolha.
 * Os demais códigos sobem como a mensagem do erro, que é o código de §20.
 */
function configurarEscritaDeMensagem(): void {
  useMessageStore.getState().configurarEscrita({
    async enviar(entrada) {
      try {
        const r = await api.messageSend({
          communityId: entrada.communityId,
          channelId: entrada.channelId,
          content: entrada.content,
          mentions: entrada.mentions,
          clientRef: entrada.clientRef,
          ...(entrada.replyToId !== undefined ? { replyToId: entrada.replyToId } : {}),
          ...(entrada.threadId !== undefined ? { threadId: entrada.threadId } : {}),
          ...(entrada.attachment !== undefined ? { attachment: entrada.attachment } : {}),
        });
        return { opId: r.opId };
      } catch (e) {
        if (codigoDoErro(e) === "E_CANCELLED") return { opId: "", cancelado: true };
        throw erroDeEscrita(e);
      }
    },
    reenviar: (opId) => api.messageRetry(opId).then(() => undefined),
    async editar(entrada) {
      const r = await api.messageEdit({
        communityId: comunidadeDoCanal(entrada.channelId),
        messageId: entrada.messageId,
        content: entrada.content,
        clientRef: entrada.clientRef,
      });
      return { opId: r.opId };
    },
    async apagar(entrada) {
      const r = await api.messageDelete({
        communityId: comunidadeDoCanal(entrada.channelId),
        messageId: entrada.messageId,
        clientRef: entrada.clientRef,
      });
      return { opId: r.opId };
    },
    async fixar(entrada) {
      const r = await api.messagePin({
        communityId: comunidadeDoCanal(entrada.channelId),
        messageId: entrada.messageId,
        pinned: entrada.pinned,
        clientRef: entrada.clientRef,
      });
      return { opId: r.opId };
    },
    async reagir(entrada) {
      const r = await api.messageReact({
        communityId: comunidadeDoCanal(entrada.channelId),
        messageId: entrada.messageId,
        emoji: entrada.emoji,
        present: entrada.present,
        clientRef: entrada.clientRef,
      });
      return { opId: r.opId };
    },
    async abrirThread(entrada) {
      const r = await api.threadCreate({
        communityId: comunidadeDoCanal(entrada.channelId),
        rootMessageId: entrada.rootMessageId,
        clientRef: entrada.clientRef,
      });
      return { opId: r.opId };
    },
    /** §15.6.1 — reações e anexo não viajam na lista; hidratam por demanda. */
    observarReacoes(channelId, messageId) {
      const communityId = comunidadeDoCanal(channelId);
      void api
        .message({ communityId, messageId })
        .then((cheia) => {
          if (cheia === null) return;
          const eu = useCommunityStore.getState().remote.euId;
          const store = useMessageStore.getState();
          store.aplicarReacoesRemotas(messageId, reacoes(cheia.reactions, eu));
          // §13 — o anexo vem na MESMA leitura; o card de download/reveal é dele.
          if (cheia.attachment !== undefined) {
            store.aplicarAnexoRemoto(messageId, anexo(cheia.attachment, communityId));
          }
        })
        .catch(() => {});
    },
    /** §15.6 — respostas além da janela de 50 do canal e o total do fio. */
    observarThread(communityId, threadId) {
      void api
        .thread({ communityId, threadId })
        .then((dto) => {
          if (dto === null) return;
          const eu = useCommunityStore.getState().remote.euId;
          useMessageStore.getState().aplicarThreadRemota(threadId, {
            respostas: dto.replies.map((m) => adaptarMensagem(m, eu)),
            total: dto.replyCount,
          });
        })
        .catch(() => {});
    },
    /** §9 2.2 — a abertura do painel marca leitura; a reconsulta tira o badge. */
    marcarThreadLida(communityId, threadId) {
      void api
        .threadMarkRead({ communityId, threadId })
        .then(() => {
          const cid = useCommunityStore.getState().activeChannelByCommunity[communityId];
          if (cid !== undefined) void sincronizarThreadsNaoLidas(communityId, cid);
        })
        .catch(() => {});
    },
  });
}

/**
 * Assinaturas de §15.5. Cada uma dispara a consulta correspondente — nenhuma aplica payload.
 * Sem filtro de comunidade de propósito: o rail reage a todas, e recortar faria as demais
 * pararem de atualizar.
 */
export function assinarSincronizacao(): void {
  const ativa = (): string | null => useCommunityStore.getState().activeCommunityId;
  const daAtiva = (d: unknown): boolean => (d as { communityId?: string })?.communityId === ativa();

  const recarregarAtiva = (): void => {
    const cid = ativa();
    if (cid !== null) void abrirComunidade(cid);
  };

  cliente.subscribe("community.joined", () => void sincronizarComunidades());
  cliente.subscribe("community.left", () => void sincronizarComunidades());
  cliente.subscribe("community.ended", () => void sincronizarComunidades());
  cliente.subscribe("community.changed", () => {
    void sincronizarComunidades();
    recarregarAtiva();
  });
  cliente.subscribe("community.replication", (d) => {
    const ev = d as { communityId?: string; state?: string };
    void sincronizarComunidades();
    // A PRIMEIRA sincronização da comunidade ativa é o momento em que o log
    // recém-chegado vira estrutura, roster e fila consultáveis — quem entrou
    // por convite abriu a tela contra uma réplica ainda vazia.
    if (ev.state === "synced" && ev.communityId !== undefined && ev.communityId === ativa()) {
      void abrirComunidade(ev.communityId);
    }
  });
  cliente.subscribe("community.replication", () => void sincronizarComunidades());
  cliente.subscribe("host.statusChanged", () => void sincronizarComunidades());
  cliente.subscribe("unread.changed", () => {
    void sincronizarComunidades();
    recarregarAtiva();
  });
  cliente.subscribe("structure.changed", (d) => {
    if (daAtiva(d)) void sincronizarComunidade(ativa()!);
  });
  cliente.subscribe("roles.changed", (d) => {
    if (daAtiva(d)) void sincronizarComunidade(ativa()!);
  });
  cliente.subscribe("members.changed", (d) => {
    if (daAtiva(d)) void sincronizarMembros(ativa()!);
  });
  cliente.subscribe("invites.changed", (d) => {
    if (daAtiva(d)) void sincronizarConvites(ativa()!);
  });
  // §15.5 — o fold notifica TODA auditoria nova (punição, cargo, canal, convite
  // revogado): reconsulta as três leituras de moderação da comunidade ativa.
  cliente.subscribe("auditLog.changed", (d) => {
    if (daAtiva(d)) void sincronizarModeracao(ativa()!);
  });
  cliente.subscribe("messages.appended", (d) => {
    const ev = d as { communityId?: string; channelId?: string };
    if (ev.communityId !== undefined && ev.channelId !== undefined) {
      void sincronizarMensagens(ev.communityId, ev.channelId);
    }
  });
  cliente.subscribe("message.updated", (d) => {
    const ev = d as { communityId?: string; channelId?: string };
    if (ev.communityId !== undefined && ev.channelId !== undefined) {
      void sincronizarMensagens(ev.communityId, ev.channelId);
    }
  });

  // ── Desfechos da outbox (§11.6/§11.7) — casam a bolha pelo clientRef ───────
  const refDo = (ev: { clientRef?: string; opId: string }): string => ev.clientRef ?? ev.opId;
  cliente.subscribe("message.accepted", (d) => {
    const ev = d as EvMessageAccepted;
    useMessageStore.getState().assentarAceita(refDo(ev), ev.messageId);
  });
  cliente.subscribe("message.failed", (d) => {
    const ev = d as { opId: string; clientRef?: string; code: string };
    // `retryInMs` com erro transitório NÃO é falha para a UI: a outbox volta a
    // retentar sozinha (§11.3), e a bolha segue no estado que `query.outbox` disser.
    useMessageStore.getState().marcarFalha(refDo(ev), ev.code);
  });
  cliente.subscribe("message.dropped", (d) => {
    const ev = d as { opId: string; clientRef?: string; reason: string };
    useMessageStore.getState().marcarFalha(refDo(ev), `descartada (${ev.reason})`);
  });
  cliente.subscribe("outbox.changed", (d) => {
    const communityId = (d as { communityId?: string }).communityId;
    if (typeof communityId === "string") void sincronizarFila(communityId);
  });

  // ── Downloads (§13.4) — a chave do fio é o blobIdHex (emenda de 2026-08-22) ──
  const downloads = useDownloadStore.getState();
  cliente.subscribe("blob.progress", (d) => {
    const ev = d as { blobIdHex?: string; progress?: number; peers?: number; hostAvailable?: boolean };
    if (typeof ev.blobIdHex === "string" && typeof ev.progress === "number") {
      downloads.aplicarProgresso(ev.blobIdHex, Math.round(ev.progress * 100), ev.peers ?? 0, ev.hostAvailable === true);
    }
  });
  cliente.subscribe("blob.completed", (d) => {
    const blobIdHex = (d as { blobIdHex?: string }).blobIdHex;
    if (typeof blobIdHex === "string") downloads.aplicarConcluido(blobIdHex);
  });
  cliente.subscribe("blob.peerLost", (d) => {
    const ev = d as { blobIdHex?: string; remaining?: number };
    if (typeof ev.blobIdHex === "string" && typeof ev.remaining === "number") {
      downloads.aplicarPeerLost(ev.blobIdHex, ev.remaining);
    }
  });
  cliente.subscribe("blob.unavailable", (d) => {
    const blobIdHex = (d as { blobIdHex?: string }).blobIdHex;
    if (typeof blobIdHex === "string") downloads.aplicarIndisponivel(blobIdHex);
  });
  cliente.subscribe("attachment.corrupt", (d) => {
    const ev = d as { blobIdHex?: string; cause?: string };
    if (typeof ev.blobIdHex === "string") downloads.aplicarCorrompido(ev.blobIdHex, ev.cause ?? "hash");
  });

  cliente.subscribe("core.ready", () => {
    void sincronizarIdentidade().then(() => sincronizarComunidades());
  });

  // §15.2 4d — depois de um reinício do núcleo, tudo que está na tela é reconsultado.
  registrarResync(() => {
    void sincronizarIdentidade();
    void sincronizarComunidades();
    recarregarAtiva();
    const cid = ativa();
    const chid = cid !== null ? useCommunityStore.getState().activeChannelByCommunity[cid] : undefined;
    if (cid !== null && chid !== undefined) void sincronizarMensagens(cid, chid);
    if (cid !== null) void sincronizarFila(cid);
    if (cid !== null) void sincronizarModeracao(cid);
  });
}

/** Sobe a sessão, injeta a escrita e carrega o primeiro lote. Chamada uma vez, na raiz. */
/**
 * Preferências locais de §15.4 — "escrita direta no LS, sem host e sem fila".
 * As ações das stores continuam síncronas (o LS é delas); a porta injetada
 * replica a MESMA decisão para o núcleo persistir, sem fila nem retentativa.
 */
function configurarEscritaDePreferencias(): void {
  useSettingsStore.getState().configurarEscrita({
    setDevice: (kind, deviceId) => api.settingsSetDevice({ kind, deviceId }),
    setVolume: (kind, value) => api.settingsSetVolume({ kind, value }),
    setNotifications: (arg) => api.settingsSetNotifications(arg),
  });
  useCommunityStore.getState().configurarPreferencias({
    setMuted: async (channelId, muted) => {
      // O canal sabe a comunidade dele; o fio de §15.4 exige as duas chaves.
      const cid = useCommunityStore.getState().remote.channels[channelId]?.communityId;
      if (cid === undefined) return;
      await api.channelSetMuted({ communityId: cid, channelId, muted });
    },
    setCollapsed: async (communityId, categoryId, collapsed) =>
      api.categorySetCollapsed({ communityId, categoryId, collapsed }),
  });
}

/** `query.preferences` → dispositivos/volumes/notificações. Uma leitura no boot; mute/recolher já vêm na `query.structure`. */
export async function sincronizarPreferencias(): Promise<void> {
  const p = await api.preferences().catch(() => null);
  if (p === null) return;
  useSettingsStore.getState().aplicarRemoto(p);
}


/**
 * §17.2/§17.4 — a malha de voz ligada ao store. A separação: `MalhaDeVoz` fala WebRTC e não
 * sabe o que é uma tela; o `voiceStore` guarda o estado que a tela lê e não sabe o que é um
 * `RTCPeerConnection`. Este é o único lugar onde os dois se encontram.
 *
 * Os quatro eventos de §15.5 entram aqui. `voice.signal` **já veio autorizado** pelo núcleo
 * (§17.4 passo 3, `signalIsAuthorized`), então o que a malha faz com ele é só negociar.
 */
function configurarVoz(): void {
  const malha = new MalhaDeVoz(
    {
      join: (a) =>
        api.voiceJoin(a).then((r) => ({
          sessionId: r.sessionId,
          roster: r.roster,
          iceServers: r.iceServers,
          tickets: r.tickets,
        })),
      leave: () => api.voiceLeave(),
      signal: (a) => api.voiceSignal(a),
    },
    {
      capturar: async (deviceId) =>
        await navigator.mediaDevices.getUserMedia({
          // `default` é o padrão do sistema: mandar o id literal recusaria a captura.
          audio: deviceId === "default" ? true : { deviceId: { exact: deviceId } },
        }),
      conexao: (config) => new RTCPeerConnection(config),
    },
    {
      aoMudarPar: (peerHex, estado) => {
        const mapa: Record<string, "ok" | "degraded" | "failed"> = {
          connected: "ok",
          completed: "ok",
          connecting: "degraded",
          new: "degraded",
          disconnected: "degraded",
          failed: "failed",
          closed: "failed",
        };
        useVoiceStore.getState().aplicarEstadoDoPar(peerHex, mapa[estado] ?? "degraded");
      },
      aoChegarAudio: (peerHex, stream) => tocar(peerHex, stream),
      aoSair: () => pararTudo(),
    },
  );

  useVoiceStore.getState().configurarVoz({
    entrar: async (a) => {
      const eu = useIdentityStore.getState().identity?.id ?? a.localId;
      const microfoneId = useSettingsStore.getState().microphoneId;
      await malha.entrar({ ...a, euHex: eu, microfoneId, agora: Date.now() });
    },
    sair: () => malha.sair(),
    mudarSelf: (patch) => void api.voiceSetSelf(patch).catch(() => undefined),
  });

  cliente.subscribe("voice.roster", (d) => {
    const dado = d as { participants?: Array<{ keyHex: string }> };
    if (!Array.isArray(dado.participants)) return;
    useVoiceStore.getState().aplicarRoster(dado.participants);
    malha.aplicarRoster(dado.participants);
  });

  cliente.subscribe("voice.signal", (d) => {
    void malha.aplicarSinal(d as { peerKey: string; ticketId: string; sdp?: string; ice?: string });
  });

  cliente.subscribe("voice.tickets", (d) => {
    const dado = d as { tickets?: Parameters<typeof malha.aplicarTickets>[0] };
    if (Array.isArray(dado.tickets)) malha.aplicarTickets(dado.tickets, Date.now());
  });

  cliente.subscribe("voice.revoked", (d) => {
    // §17.4 — a revogação nomeia UM alvo. Se for outra pessoa, quem sai é ela: derrubar a
    // própria chamada porque alguém saiu era o efeito de ignorar `targetKey`.
    const alvo = (d as { targetKey?: string }).targetKey?.toLowerCase();
    const eu = useIdentityStore.getState().identity?.id?.toLowerCase();
    if (alvo !== undefined && eu !== undefined && alvo !== eu) {
      const restantes = useVoiceStore
        .getState()
        .participants.filter((p) => p.identityId.toLowerCase() !== alvo)
        .map((p) => ({ keyHex: p.identityId }));
      useVoiceStore.getState().aplicarRoster(restantes);
      malha.aplicarRoster(restantes);
      return;
    }
    void malha.sair();
    useVoiceStore.getState().encerradaPeloHost();
  });

  // §15.5 — a ocupação do CANAL, para quem está de fora da chamada. É o que faz a sidebar
  // mostrar quem já está na sala antes de entrar (RT-05).
  cliente.subscribe("voice.occupancyChanged", (d) => {
    const dado = d as { communityId?: string; channelId?: string; firstKeys?: string[] };
    if (typeof dado.channelId !== "string" || !Array.isArray(dado.firstKeys)) return;
    useCommunityStore.getState().aplicarOcupacaoDeVoz(dado.channelId, dado.firstKeys);
  });
}

/**
 * O áudio dos outros. Um `<audio>` por par, fora da árvore do React: o elemento precisa
 * sobreviver a re-render, e um par que troca de tile não pode perder o som por causa disso.
 */
const audios = new Map<string, HTMLAudioElement>();

function tocar(peerHex: string, stream: MediaStream): void {
  let el = audios.get(peerHex);
  if (el === undefined) {
    el = new Audio();
    el.autoplay = true;
    audios.set(peerHex, el);
  }
  el.srcObject = stream;
  void el.play().catch(() => undefined);
}

function pararTudo(): void {
  for (const el of audios.values()) {
    el.pause();
    el.srcObject = null;
  }
  audios.clear();
}

export async function iniciarSincronizacao(): Promise<void> {
  await useSessao.getState().iniciar();
  const estado = useSessao.getState().estado;
  if (estado === "sem-shell" || estado === "falhou") return;
  configurarEscritaDeMensagem();
  configurarEscritaDePreferencias();
  configurarVoz();
  assinarSincronizacao();
  await sincronizarIdentidade();
  await sincronizarComunidades();
  void sincronizarPreferencias();
  const cid = useCommunityStore.getState().activeCommunityId;
  if (cid !== null) await abrirComunidade(cid);
}
