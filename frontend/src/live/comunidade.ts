/**
 * Administração da comunidade ativa — cargos, roster, convites e moderação (§15.6, §15.4).
 *
 * Tudo aqui é sob demanda: são painéis que a maioria das sessões nunca abre, e manter as
 * quatro listas quentes o tempo todo custaria consulta por evento sem ninguém olhando. Cada
 * painel carrega ao abrir e recarrega no sinal que lhe diz respeito.
 *
 * Duas leituras têm **enforcement de permissão** (§15.6.1, DR-25/T-44): `query.bans`,
 * `query.timeouts` e `query.auditLog` recusam com `E_PERMISSION_DENIED` para quem não tem
 * `view_audit_log`. A recusa não é erro de tela — é a resposta —, e a UI diz que a aba não
 * está disponível em vez de mostrar um vermelho de falha. E, por L-10, a UI precisa dizer
 * que isso é confidencialidade **local**: replicação é integral, e um cliente adulterado lê
 * as mesmas tabelas do próprio disco (delta U-07).
 *
 * **Presença não recarrega o roster.** O delta de `presence.changed` chega a cada
 * `PRESENCE_TICK_MS` (2 s); refazer `query.members` a cada tick seria uma consulta por
 * segundo para mover um pontinho. O roster traz a presença do instante em que foi lido, e a
 * tela sobrepõe o mapa vivo que `comunidades.ts` já mantém com TTL.
 */

import { create } from "zustand";
import { api, cliente } from "../ipc/api";
import { codigoDoErro } from "../ipc/frames";
import { registrarResync } from "./sessao";
import { useComunidades } from "./comunidades";
import type {
  AuditItem,
  BanItem,
  InviteItem,
  MemberDetail,
  MembersPage,
  RoleDto,
  SelfModeration,
  TimeoutItem,
} from "../ipc/dto";

/** Uma lista que pode estar indisponível por permissão — estado, não falha. */
export interface ListaRestrita<T> {
  itens: T[];
  carregando: boolean;
  semPermissao: boolean;
  erro: string | null;
}

const vazia = <T,>(): ListaRestrita<T> => ({ itens: [], carregando: false, semPermissao: false, erro: null });

interface Comunidade {
  cargos: RoleDto[];
  roster: MembersPage | null;
  filtroRoster: { query?: string; roleId?: string; onlyOnline?: boolean };
  perfil: MemberDetail | null;
  convites: InviteItem[];
  bans: ListaRestrita<BanItem>;
  timeouts: ListaRestrita<TimeoutItem>;
  auditoria: ListaRestrita<AuditItem>;
  selfModeration: SelfModeration | null;

  carregarCargos(): Promise<void>;
  carregarRoster(filtro?: Comunidade["filtroRoster"]): Promise<void>;
  abrirPerfil(identityKey: string): Promise<void>;
  fecharPerfil(): void;
  carregarConvites(): Promise<void>;
  carregarBans(): Promise<void>;
  carregarTimeouts(): Promise<void>;
  carregarAuditoria(): Promise<void>;
  carregarSelfModeration(): Promise<void>;
  limpar(): void;
}

function ativa(): string | null {
  return useComunidades.getState().ativa;
}

/** Envolve uma leitura restrita: `E_PERMISSION_DENIED` vira "indisponível", não erro. */
async function restrita<T>(
  ler: () => Promise<{ items: T[] }>,
  aplicar: (l: ListaRestrita<T>) => void,
): Promise<void> {
  aplicar({ itens: [], carregando: true, semPermissao: false, erro: null });
  try {
    const r = await ler();
    aplicar({ itens: r.items, carregando: false, semPermissao: false, erro: null });
  } catch (e) {
    if (codigoDoErro(e) === "E_PERMISSION_DENIED") {
      aplicar({ itens: [], carregando: false, semPermissao: true, erro: null });
      return;
    }
    aplicar({ itens: [], carregando: false, semPermissao: false, erro: e instanceof Error ? e.message : "falha" });
  }
}

export const useComunidade = create<Comunidade>((set, get) => ({
  cargos: [],
  roster: null,
  filtroRoster: {},
  perfil: null,
  convites: [],
  bans: vazia<BanItem>(),
  timeouts: vazia<TimeoutItem>(),
  auditoria: vazia<AuditItem>(),
  selfModeration: null,

  async carregarCargos() {
    const communityId = ativa();
    if (communityId === null) return;
    const r = await api.roles(communityId).catch(() => null);
    if (r !== null && ativa() === communityId) set({ cargos: r.roles });
  },

  async carregarRoster(filtro) {
    const communityId = ativa();
    if (communityId === null) return;
    const f = filtro ?? get().filtroRoster;
    set({ filtroRoster: f });
    const r = await api.membersFiltrados({ communityId, filter: f, limit: 100 }).catch(() => null);
    if (r !== null && ativa() === communityId) set({ roster: r });
  },

  async abrirPerfil(identityKey) {
    const communityId = ativa();
    if (communityId === null) return;
    const r = await api.member({ communityId, identityKey }).catch(() => null);
    if (ativa() === communityId) set({ perfil: r });
  },

  fecharPerfil() {
    set({ perfil: null });
  },

  async carregarConvites() {
    const communityId = ativa();
    if (communityId === null) return;
    const r = await api.invites(communityId).catch(() => null);
    if (r !== null && ativa() === communityId) set({ convites: r.items });
  },

  async carregarBans() {
    const communityId = ativa();
    if (communityId === null) return;
    await restrita<BanItem>(
      () => api.bans({ communityId }),
      (bans) => set({ bans }),
    );
  },

  async carregarTimeouts() {
    const communityId = ativa();
    if (communityId === null) return;
    await restrita<TimeoutItem>(
      () => api.timeouts({ communityId }),
      (timeouts) => set({ timeouts }),
    );
  },

  async carregarAuditoria() {
    const communityId = ativa();
    if (communityId === null) return;
    await restrita<AuditItem>(
      () => api.auditLog({ communityId }),
      (auditoria) => set({ auditoria }),
    );
  },

  async carregarSelfModeration() {
    const communityId = ativa();
    if (communityId === null) return;
    const r = await api.selfModeration(communityId).catch(() => null);
    if (ativa() === communityId) set({ selfModeration: r });
  },

  limpar() {
    set({
      cargos: [],
      roster: null,
      perfil: null,
      convites: [],
      bans: vazia<BanItem>(),
      timeouts: vazia<TimeoutItem>(),
      auditoria: vazia<AuditItem>(),
      selfModeration: null,
    });
  },
}));

export function assinarComunidade(): () => void {
  const store = useComunidade;
  const daAtiva = (d: unknown): boolean => (d as { communityId?: string })?.communityId === ativa();
  /** Recarrega só o que já está carregado: painel fechado não vira consulta. */
  const seCarregado = <T,>(atual: T[] | null | undefined, recarregar: () => void): void => {
    if (atual !== null && atual !== undefined && atual.length > 0) recarregar();
  };

  const locais = [
    cliente.subscribe("roles.changed", (d) => {
      if (daAtiva(d)) seCarregado(store.getState().cargos, () => void store.getState().carregarCargos());
    }),
    cliente.subscribe("members.changed", (d) => {
      if (!daAtiva(d)) return;
      const s = store.getState();
      if (s.roster !== null) void s.carregarRoster();
      // O perfil aberto pode ser justamente de quem mudou de cargo, apelido ou estado.
      if (s.perfil !== null) void s.abrirPerfil(s.perfil.key);
      if (s.selfModeration !== null) void s.carregarSelfModeration();
    }),
    cliente.subscribe("invites.changed", (d) => {
      if (daAtiva(d)) seCarregado(store.getState().convites, () => void store.getState().carregarConvites());
    }),
    cliente.subscribe("auditLog.changed", (d) => {
      if (!daAtiva(d)) return;
      const s = store.getState();
      if (s.auditoria.itens.length > 0 || s.auditoria.semPermissao) void s.carregarAuditoria();
      if (s.bans.itens.length > 0) void s.carregarBans();
      if (s.timeouts.itens.length > 0) void s.carregarTimeouts();
    }),
    // §18.4 — o próprio ban/kick é o gatilho da tela de modo histórico.
    cliente.subscribe("community.accessRevoked", (d) => {
      if (daAtiva(d)) void store.getState().carregarSelfModeration();
    }),
  ];

  const cancelarResync = registrarResync(() => {
    const s = store.getState();
    if (s.cargos.length > 0) void s.carregarCargos();
    if (s.roster !== null) void s.carregarRoster();
    if (s.convites.length > 0) void s.carregarConvites();
    if (s.selfModeration !== null) void s.carregarSelfModeration();
  });

  return () => {
    for (const l of locais) cliente.unsubscribe(l);
    cancelarResync();
  };
}
