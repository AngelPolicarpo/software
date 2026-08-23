/**
 * Rail, comunidade ativa e estrutura — §15.6 (`query.communities`, `query.community`,
 * `query.structure`, `query.hostStatus`) com os eventos de §15.5 como **sinal para
 * reconsultar**, nunca como fonte de verdade (§15.1 r. 5).
 *
 * Presença tem regra própria e é a única coisa que esta store guarda a partir do evento:
 * `presence.changed` é um DELTA das presenças que mudaram no tick, e `offline` nunca é
 * publicado (§6.1). Não existe query de presença por comunidade na tabela de §15.6 — o
 * roster vem em `query.members`, e o rail só precisa saber quem está de pé. Guardar o mapa
 * com TTL de 45 s (§17.6, L-13) é o que a emenda de 2026-08-23 manda fazer: quem expirou
 * simplesmente some, e ausência é que significa offline. Nada aqui escreve o valor
 * `offline`.
 */

import { create } from "zustand";
import { api, cliente } from "../ipc/api";
import { registrarResync } from "./sessao";
import type {
  CommunityDetail,
  CommunityListItem,
  EvHostStatusChanged,
  EvPresenceChanged,
  HostStatusDto,
  Presence,
  StructureDto,
} from "../ipc/dto";

/** §17.6 — TTL de presença: 45 s. Passado isso, a entrada some (e some = offline). */
const PRESENCE_TTL_MS = 45_000;

export interface PresencaViva {
  status: Presence;
  lastSeenAt: number;
  /** Momento local em que o delta chegou — o TTL corre sobre ele, não sobre `lastSeenAt`. */
  recebidoEm: number;
}

interface Comunidades {
  lista: CommunityListItem[];
  ativa: string | null;
  canalAtivo: string | null;
  detalhe: CommunityDetail | null;
  estrutura: StructureDto | null;
  hostStatus: HostStatusDto | null;
  presencas: Record<string, PresencaViva>;
  carregando: boolean;
  erro: string | null;

  carregarLista(): Promise<void>;
  selecionarComunidade(communityId: string | null): Promise<void>;
  selecionarCanal(channelId: string | null): Promise<void>;
  recarregarAtiva(): Promise<void>;
  presencaDe(key: string): Presence | undefined;
}

export const useComunidades = create<Comunidades>((set, get) => ({
  lista: [],
  ativa: null,
  canalAtivo: null,
  detalhe: null,
  estrutura: null,
  hostStatus: null,
  presencas: {},
  carregando: false,
  erro: null,

  async carregarLista() {
    try {
      const lista = await api.communities();
      set({ lista, erro: null });
    } catch (e) {
      set({ erro: e instanceof Error ? e.message : "falha ao ler as comunidades" });
    }
  },

  async selecionarComunidade(communityId) {
    if (get().ativa === communityId) return;
    set({
      ativa: communityId,
      canalAtivo: null,
      detalhe: null,
      estrutura: null,
      hostStatus: null,
      // A presença é por comunidade; trocar de comunidade não herda quem estava de pé na
      // anterior.
      presencas: {},
      carregando: communityId !== null,
    });
    if (communityId === null) {
      // §8.1 — sem ativa, todas as não hospedadas voltam a `light`.
      await api.communityActivate(null).catch(() => undefined);
      await api.navSetActive({}).catch(() => undefined);
      return;
    }
    // §8.1 residência e DR-32 navegação são dois donos distintos: os dois são avisados.
    await api.communityActivate(communityId).catch(() => undefined);
    await api.navSetActive({ communityId }).catch(() => undefined);
    await get().recarregarAtiva();
  },

  async selecionarCanal(channelId) {
    const { ativa } = get();
    set({ canalAtivo: channelId });
    if (ativa !== null) {
      await api
        .navSetActive(channelId === null ? { communityId: ativa } : { communityId: ativa, channelId })
        .catch(() => undefined);
    }
  },

  async recarregarAtiva() {
    const communityId = get().ativa;
    if (communityId === null) return;
    set({ carregando: true });
    try {
      const [detalhe, estrutura, hostStatus] = await Promise.all([
        api.community(communityId),
        api.structure(communityId),
        api.hostStatus(communityId),
      ]);
      // A comunidade pode ter trocado enquanto as três respostas voltavam.
      if (get().ativa !== communityId) return;
      set({ detalhe, estrutura, hostStatus, carregando: false, erro: null });
    } catch (e) {
      if (get().ativa !== communityId) return;
      set({ carregando: false, erro: e instanceof Error ? e.message : "falha ao abrir a comunidade" });
    }
  },

  presencaDe(key) {
    const p = get().presencas[key];
    if (p === undefined) return undefined;
    if (Date.now() - p.recebidoEm > PRESENCE_TTL_MS) return undefined;
    return p.status;
  },
}));

/**
 * Assinaturas de §15.5 desta store. Chamada uma vez, depois da porta existir.
 *
 * Os filtros ficam ausentes de propósito: o rail mostra TODAS as comunidades, e recortar a
 * assinatura por comunidade ativa faria o rail parar de reagir às outras.
 */
export function assinarComunidades(): () => void {
  const store = useComunidades;

  const recarregarLista = (): void => {
    void store.getState().carregarLista();
  };
  const recarregarAtiva = (): void => {
    void store.getState().recarregarAtiva();
  };
  const daAtiva = (data: unknown): boolean => {
    const cid = (data as { communityId?: string })?.communityId;
    return cid === undefined || cid === store.getState().ativa;
  };

  const locais = [
    // Lista do rail: entrada, saída, encerramento, nome/ícone, replicação, não-lidas.
    cliente.subscribe("community.joined", recarregarLista),
    cliente.subscribe("community.left", recarregarLista),
    cliente.subscribe("community.ended", () => {
      recarregarLista();
      recarregarAtiva();
    }),
    cliente.subscribe("community.changed", () => {
      recarregarLista();
      recarregarAtiva();
    }),
    cliente.subscribe("community.replication", recarregarLista),
    cliente.subscribe("community.accessRevoked", () => {
      recarregarLista();
      recarregarAtiva();
    }),
    cliente.subscribe("unread.changed", () => {
      recarregarLista();
      recarregarAtiva();
    }),
    // Estrutura, cargos e membros mudam o que a comunidade ativa mostra.
    cliente.subscribe("structure.changed", (d) => {
      if (daAtiva(d)) recarregarAtiva();
    }),
    cliente.subscribe("roles.changed", (d) => {
      if (daAtiva(d)) recarregarAtiva();
    }),
    cliente.subscribe("members.changed", (d) => {
      if (daAtiva(d)) recarregarAtiva();
      recarregarLista();
    }),
    cliente.subscribe("invites.changed", (d) => {
      if (daAtiva(d)) recarregarAtiva();
    }),
    // §15.5 — o enum fechado de `hostStatus` chega inteiro no evento, mas o `replication` e
    // o `inactiveDays` do rail não: por isso o sinal reconsulta em vez de aplicar o payload.
    cliente.subscribe("host.statusChanged", (data) => {
      const ev = data as EvHostStatusChanged;
      recarregarLista();
      if (ev.communityId === store.getState().ativa) {
        void api
          .hostStatus(ev.communityId)
          .then((hostStatus) => {
            if (store.getState().ativa === ev.communityId) store.setState({ hostStatus });
          })
          .catch(() => undefined);
      }
    }),
    // Presença: delta aplicado, com TTL. Único evento cujo payload vira estado.
    cliente.subscribe("presence.changed", (data) => {
      const ev = data as EvPresenceChanged;
      if (ev.communityId !== store.getState().ativa) return;
      const agora = Date.now();
      store.setState((s) => {
        const presencas: Record<string, PresencaViva> = {};
        // Poda o que expirou no mesmo passo: sem isso o mapa só cresce.
        for (const [k, v] of Object.entries(s.presencas)) {
          if (agora - v.recebidoEm <= PRESENCE_TTL_MS) presencas[k] = v;
        }
        for (const e of ev.entries ?? []) {
          presencas[e.identityKey] = { status: e.status, lastSeenAt: e.lastSeenAt, recebidoEm: agora };
        }
        return { presencas };
      });
    }),
  ];

  const cancelarResync = registrarResync(() => {
    recarregarLista();
    recarregarAtiva();
  });

  return () => {
    for (const l of locais) cliente.unsubscribe(l);
    cancelarResync();
  };
}
