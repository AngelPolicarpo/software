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
import { canal as adaptarCanal, categoria, comunidade, identidade, cargo, membroDeEntrada, bolhaDaFila } from "./adaptadores";
import { codigoDoErro } from "../ipc/frames";
import type { EvMessageAccepted } from "../ipc/dto";
import { useCommunityStore } from "../store/communityStore";
import { useIdentityStore } from "../store/identityStore";
import { useMessageStore } from "../store/messageStore";
import { mensagem as adaptarMensagem } from "./adaptadores";
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
    store.aplicarRemoto({ remoteMessages: { ...store.remoteMessages, [channelId]: mensagens } });
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
  ]);
}

/**
 * O canal de escrita real (§15.4): `message.send` responde `{opId, state}` e o
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
        });
        return { opId: r.opId };
      } catch (e) {
        if (codigoDoErro(e) === "E_CANCELLED") return { opId: "", cancelado: true };
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
    reenviar: (opId) => api.messageRetry(opId).then(() => undefined),
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

  cliente.subscribe("core.ready", () => {
    void sincronizarIdentidade().then(() => sincronizarComunidades());
  });

  // §15.2 4d — depois de um reinício do núcleo, tudo que está na tela é reconsultado.
  registrarResync(() => {
    void sincronizarIdentidade();
    void sincronizarComunidades();
    recarregarAtiva();
    const cid = ativa();
    if (cid !== null) void sincronizarFila(cid);
  });
}

/** Sobe a sessão, injeta a escrita e carrega o primeiro lote. Chamada uma vez, na raiz. */
export async function iniciarSincronizacao(): Promise<void> {
  await useSessao.getState().iniciar();
  const estado = useSessao.getState().estado;
  if (estado === "sem-shell" || estado === "falhou") return;
  configurarEscritaDeMensagem();
  assinarSincronizacao();
  await sincronizarIdentidade();
  await sincronizarComunidades();
  const cid = useCommunityStore.getState().activeCommunityId;
  if (cid !== null) await abrirComunidade(cid);
}
