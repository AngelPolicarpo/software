// O transporte real de §14 e §16.1, ligado ao boot.
//
// O `bootCore` deixou duas costuras abertas de propósito — `attachHostChannel` e
// `attachMemberConnection` — e disse que o boot nunca abre socket. Este arquivo é quem abre:
// ele junta o `Hyperswarm` de L0 ao `Protomux` de L3 e alimenta as duas costuras. Nada
// abaixo dele mudou para que ele existisse.
//
// O que ele decide, e por quê:
//
//   §14.1  o tópico do log é `discoveryKey(coreKey)`; o host anuncia, o membro procura.
//   §14.3(1) antes de abrir o canal, cada nó consulta o próprio `DecisionState`.
//   §14.3(3) o canal de um par recém-banido é fechado no mesmo lote que aplicou o ban.
//   §16.1  um canal `p2p-community/1` por comunidade, chaveado pelo `coreKey`; a replicação
//          do hypercore é outro canal no mesmo mux, e as duas coisas não se atrapalham.
//
// Nenhuma decisão de domínio: a autorização vem de `authorizeReplicationChannel` (L0, pura)
// sobre o `DS` que o `fold` produziu.

import Protomux from 'protomux';

import { authorizeReplicationChannel } from '../l0/swarm/index.ts';
import type { Swarm } from '../l0/swarm/index.ts';
import type { SwarmConnection } from '../l0/swarm/ports.ts';
import {
  muxOf,
  protomuxChannelAcceptor,
  protomuxChannelTransport,
  type ProtomuxTransport,
} from '../l3/rpcServer/protomux.ts';
import type { CoreRuntime, OpenCommunity } from './boot.ts';

/** Um canal de §16.1 vivo: a comunidade, o par e o cabo. */
type LiveChannel = {
  readonly communityId: string;
  readonly peerKeyHex: string;
  readonly transport: ProtomuxTransport;
  readonly detach: (() => void) | null;
};

export type CommunityTransportDeps = {
  readonly runtime: CoreRuntime;
  /** Precisa ter `backend` — sem ele não há rede, e isto recusa em vez de fingir. */
  readonly swarm: Swarm;
  /**
   * Comunidade sem `discoveryKey` no `CoreHandle` (core de memória) não tem o que anunciar.
   * Registrado por aqui em vez de derrubar o boot inteiro.
   */
  onSkipped?(a: { readonly communityId: string; readonly reason: string }): void;
};

export type CommunityTransport = {
  /** Anúncio e consulta concluídos na DHT — útil para o teste e para o `ready` de §3.3. */
  flush(): Promise<void>;
  /** Reavalia §14.3(1) sobre os canais abertos de uma comunidade e fecha os que caíram. */
  refresh(communityId: string): void;
  channelCount(): number;
  stop(): Promise<void>;
};

/**
 * Sobe a rede para as comunidades abertas no `runtime` e mantém os canais de §16.1 vivos.
 */
export function startCommunityTransport(deps: CommunityTransportDeps): CommunityTransport {
  const backend = deps.swarm.backend;
  if (backend === null) throw new Error('transporte real exige um `Swarm` com backend (§14.1)');

  /** `topicHex` → comunidade. É o cruzamento que decide o que uma conexão serve. */
  const porTopico = new Map<string, string>();
  /** Um `Protomux` por stream (§16.1: uma conexão, um mux). */
  const muxes = new WeakMap<object, Protomux>();
  /** `communityId` → `peerKeyHex` → canal. */
  const canais = new Map<string, Map<string, LiveChannel>>();
  /** Cores já em replicação neste stream — `core.replicate` é uma vez por conexão. */
  const replicando = new WeakMap<object, Set<string>>();
  /** Conexões vivas, para reavaliar quando o `DS` mudar. */
  const vivas = new Set<SwarmConnection>();
  /** `communityId:peerKeyHex` → desregistro do lado respondedor (modo host). */
  const aceitando = new Map<string, () => void>();

  /**
   * §14.3(1). `peerKeyHex` é o `remotePublicKey` do Noise, que **é** a chave de identidade
   * do par (§5.1, §5.2, §12.6): é o que torna esta consulta possível sem handshake extra.
   */
  const autorizado = (c: OpenCommunity, peerKeyHex: string): boolean => {
    // Réplica que ainda não interpretou nada não tem `DS` para consultar — e não tem o que
    // proteger: ela não serve bloco nenhum, porque não tem nenhum. Recusar aqui tornaria a
    // primeira replicação impossível (o membro só descobre quem é membro **lendo o log**), e
    // a propriedade de §14.3 continua inteira por simetria: quem tem o dado é quem autoriza,
    // e o outro lado aplica a mesma regra sobre o `DS` dele.
    if (!c.projector.ds.community.exists) return true;
    const membro = c.projector.ds.members.get(peerKeyHex);
    return authorizeReplicationChannel({
      isMemberActive: membro !== undefined && membro.state === 'active',
      banned: membro?.state === 'banned',
    });
  };

  const fecharCanal = (canal: LiveChannel): void => {
    canal.detach?.();
    canal.transport.close();
    canais.get(canal.communityId)?.delete(canal.peerKeyHex);
    aceitando.get(`${canal.communityId}:${canal.peerKeyHex}`)?.();
    aceitando.delete(`${canal.communityId}:${canal.peerKeyHex}`);
  };

  // ── O que uma conexão serve, e em que ordem ────────────────────────────────────────
  //
  // Reavaliável de propósito: chamado quando a conexão chega e de novo a cada lote
  // projetado. Um membro que acabou de entrar não sabe **quem é o host** — isso está no log
  // que ele ainda não tem —, então o canal de §16.1 só pode nascer depois da primeira
  // replicação. Cada passo é idempotente.
  const avaliar = (conn: SwarmConnection): void => {
    const stream = conn.stream as unknown as object;
    const mux = muxes.get(stream) ?? muxOf(conn.stream);
    muxes.set(stream, mux);

    // Quais comunidades esta conexão pode servir. `conn.topicsHex` só vem preenchido do
    // lado que **procurou** o tópico: quem anuncia recebe a conexão sem saber por qual
    // tópico vieram. Por isso a lista vazia significa "qualquer uma das minhas", e não
    // "nenhuma" — quem decide de verdade é §14.3(1), logo abaixo, que é por comunidade e
    // não depende do tópico. Um par que não é membro ativo não passa daqui, venha por onde
    // vier.
    const candidatas =
      conn.topicsHex.length > 0
        ? conn.topicsHex.map((t) => porTopico.get(t)).filter((id): id is string => id !== undefined)
        : [...porTopico.values()];

    for (const communityId of candidatas) {
      const c = deps.runtime.get(communityId);
      if (c === undefined) continue;

      // §14.3(1) — a decisão é do próprio `DS`, antes de abrir qualquer coisa.
      if (!autorizado(c, conn.remotePublicKeyHex)) continue;

      // §14.1 — replicar é explícito: estar conectado a um par não é estar replicando.
      const jaReplica = replicando.get(stream) ?? new Set<string>();
      if (!jaReplica.has(communityId)) {
        c.core.replicate?.(mux);
        // §14.2 — e pedir a faixa: replicar o canal não baixa bloco nenhum por si só.
        c.core.download?.();
        jaReplica.add(communityId);
        replicando.set(stream, jaReplica);
      }

      const daComunidade = canais.get(communityId) ?? new Map<string, LiveChannel>();
      canais.set(communityId, daComunidade);
      if (daComunidade.has(conn.remotePublicKeyHex)) continue;

      const registrar = (transport: ProtomuxTransport, detach: (() => void) | null): void => {
        const canal: LiveChannel = { communityId, peerKeyHex: conn.remotePublicKeyHex, transport, detach };
        daComunidade.set(conn.remotePublicKeyHex, canal);
        // §16.1 reconexão: o canal cai, o cabo sai do mapa, e a avaliação seguinte reabre.
        // Os requests em voo falham com `E_HOST_UNAVAILABLE` e voltam à outbox — isso é do
        // `RpcClient`, que já recebe o `onDown` deste mesmo transporte.
        transport.onDown(() => {
          canal.detach?.();
          if (daComunidade.get(conn.remotePublicKeyHex) === canal) daComunidade.delete(conn.remotePublicKeyHex);
        });
      };

      if (c.isHost) {
        // Host: responde. O canal nasce quando o membro o pedir (§16.1).
        const chave = `${communityId}:${conn.remotePublicKeyHex}`;
        if (aceitando.has(chave)) continue;
        aceitando.set(
          chave,
          protomuxChannelAcceptor(mux, { protocol: 'community', id: c.core.key }, (transport) => {
            const { detach } = deps.runtime.attachMemberConnection({
              communityId,
              peerKeyHex: conn.remotePublicKeyHex,
              transport,
            });
            registrar(transport, detach);
          }),
        );
        continue;
      }

      // Membro: só abre canal para o **host** da comunidade, e só quando o log já disse
      // quem ele é. Dois membros replicam um com o outro (acima) mas não têm o que se
      // pedir — quem admite op e serve mídia é o host.
      if (!c.projector.ds.community.exists) continue;
      if (conn.remotePublicKeyHex !== c.projector.ds.community.hostKey.toString('hex')) continue;

      const transport = protomuxChannelTransport(mux, { protocol: 'community', id: c.core.key });
      if (transport === null) continue;
      deps.runtime.attachHostChannel({ communityId, transport });
      registrar(transport, null);
    }
  };

  const offConnection = backend.onConnection((conn) => {
    vivas.add(conn);
    conn.stream.once('close', () => vivas.delete(conn));
    avaliar(conn);
  });

  // §14.3(3) — o lote que aplicou o ban fecha o canal do banido, aqui. E o mesmo gatilho
  // abre o canal que só era possível depois de saber quem é o host.
  const offProjected = deps.runtime.onProjected((communityId) => refresh(communityId));

  function refresh(communityId: string): void {
    const c = deps.runtime.get(communityId);
    const daComunidade = canais.get(communityId);
    if (daComunidade !== undefined) {
      for (const canal of [...daComunidade.values()]) {
        if (c === undefined || !autorizado(c, canal.peerKeyHex)) fecharCanal(canal);
      }
    }
    for (const conn of vivas) avaliar(conn);
  }

  // ── §14.1: entra nos tópicos das comunidades abertas ────────────────────────────────
  for (const c of deps.runtime.communities()) {
    const discoveryKey = c.core.discoveryKey;
    if (discoveryKey === undefined) {
      deps.onSkipped?.({ communityId: c.communityId, reason: 'E_NO_DISCOVERY_KEY' });
      continue;
    }
    const topicHex = discoveryKey.toString('hex');
    porTopico.set(topicHex, c.communityId);
    // O host anuncia o tópico; quem replica o procura (§14.1).
    deps.swarm.join(topicHex, { topicHex, kind: 'community-log', communityId: c.communityId }, { server: c.isHost, client: !c.isHost });
  }

  return {
    flush: () => deps.swarm.flush(),
    refresh,
    channelCount: () => [...canais.values()].reduce((n, m) => n + m.size, 0),
    async stop(): Promise<void> {
      offConnection();
      offProjected();
      for (const desfazer of aceitando.values()) desfazer();
      aceitando.clear();
      for (const daComunidade of canais.values()) {
        for (const canal of [...daComunidade.values()]) fecharCanal(canal);
      }
      canais.clear();
      vivas.clear();
      for (const topicHex of porTopico.keys()) deps.swarm.leave(topicHex);
      porTopico.clear();
      await backend.destroy();
    },
  };
}
