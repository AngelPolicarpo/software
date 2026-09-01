// O transporte real de §14 e §16.1, ligado ao boot.
//
// O `bootCore` deixou duas costuras abertas de propósito — `attachHostChannel` e
// `attachMemberConnection` — e disse que o boot nunca abre socket. Este arquivo é quem abre:
// ele junta o `Hyperswarm` de L0 ao `Protomux` de L3 e alimenta as duas costuras. Nada
// abaixo dele mudou para que ele existisse.
//
// O que ele decide, e por quê:
//
//   §14.1  o tópico do log é `discoveryKey(coreKey)`; o host anuncia, o membro procura. O
//          mesmo vale para o tópico de convite (`BLAKE2b('invite-topic/1' ‖ invitePk)`):
//          o host anuncia, o candidato procura — e uma comunidade que nasce DEPOIS do boot
//          entra na rotação por `runtime.onOpen`, sem reiniciar nada.
//   §14.3(1) antes de abrir o canal, cada nó consulta o próprio `DecisionState`.
//   §14.3(3) o canal de um par recém-banido é fechado no mesmo lote que aplicou o ban.
//   §14.3(5) o canal pré-membro é exceto do firewall e aceita qualquer par — quem aplica os
//            tetos de §12.6 aqui é o serviço de admissão, não este arquivo.
//   §16.1  um canal `p2p-community/1` por comunidade, chaveado pelo `coreKey`; um canal
//          `p2p-admission/1` por convite, chaveado pelo tópico do convite. A replicação do
//          hypercore é outro canal no mesmo mux, e as três coisas não se atrapalham.
//
// A assimetria de §16.1 ("quem abre o canal é o membro; o host responde") vale também para
// o pré-membro: o candidato abre contra o host, que registrou o par `(protocolo, id)` para
// cada convite ativo — ele sabe os tópicos porque são derivados do DS dele.
//
// Nenhuma decisão de domínio: a autorização vem de `authorizeReplicationChannel` (L0, pura)
// sobre o `DS` que o `fold` produziu, e o que circula nos canais de admissão é decidido
// pelo serviço composto em `admission.ts`.

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

/** Um canal `p2p-admission/1` que acabou de nascer, em qualquer direção. */
export type AdmissionChannelInfo = {
  readonly transport: ProtomuxTransport;
  /** Tópico do convite (`BLAKE2b('invite-topic/1' ‖ invitePk)`) que trouxe o canal. */
  readonly topicHex: string;
  /** `remotePublicKey` do Noise — a chave de identidade do par (§14.3 emenda). */
  readonly peerKeyHex: string;
  /** Endereço UDP observado, quando o backend o entrega — metade /24 do rate limit. */
  readonly address?: string;
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
  /**
   * §17.3 — perna do transporte da ponte par→endereço observado (B27). O IP de onde o par
   * abriu a conexão autenticada pelo Noise é o mesmo dado que §12.6 já lê para a metade por
   * /24 do rate limit pré-membro; aqui ele vira o destino que o TURN do host aceita
   * permitir. `null` quando o par não está conectado ou o backend não entrega endereço —
   * e aí a permissão depende da outra perna, o Allocate autenticado.
   */
  ipDoPar(peerKeyHex: string): string | null;
  /**
   * §18.4 passo 1 — "sai do swarm daquela comunidade". Sai do tópico, fecha os canais de
   * §16.1 dela e esquece o cruzamento tópico→comunidade, para que a conexão seguinte não a
   * reabra. As demais comunidades desta instalação seguem intactas: a conexão só cai se ela
   * não servir mais nenhuma, que é a mesma régua de §14.3(4).
   */
  leaveCommunity(communityId: string): void;
  /** Reavalia os pares vivos contra as comunidades atuais — usado quando uma nasce. */
  channelCount(): number;
  /**
   * Candidato (§14.1): passa a **procurar** o tópico do convite. Quando uma conexão chegar
   * por ele, o canal `p2p-admission/1` é aberto contra o host e entregue ao assinante de
   * `onAdmissionChannel`.
   */
  seekInviteTopic(topicHex: string): void;
  releaseInviteTopic(topicHex: string): void;
  /**
   * Host (§12.2 passo 3): declara quais tópicos de convite estão ativos AGORA. Cada um vira
   * um `mux.pair` por conexão — o host responde, o candidato abre. Chame de novo quando a
   * lista mudar; canais de convites retirados deixam de ser registrados em conexões novas.
   */
  serveInviteTopics(topicsHex: readonly string[]): void;
  /**
   * Entrega os canais de admissão que nasceram. Devolver `false` recusa o canal (orçamento
   * de §12.6 esgotado, por exemplo) e o fecha na hora.
   */
  onAdmissionChannel(cb: (info: AdmissionChannelInfo) => boolean): () => void;
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
  const muxes = new Map<object, Protomux>();
  /** `communityId` → `peerKeyHex` → canal. */
  const canais = new Map<string, Map<string, LiveChannel>>();
  /** Cores já em replicação neste stream — `core.replicate` é uma vez por conexão. */
  const replicando = new WeakMap<object, Set<string>>();
  /** Canais de admissão já abertos por stream — um por tópico por conexão. */
  const admissaoPorStream = new WeakMap<object, Set<string>>();
  /** Aceitadores de admissão já registrados por stream — um por tópico por conexão. */
  const aceitadoresPorStream = new WeakMap<object, Set<string>>();
  /** Conexões vivas, para reavaliar quando o `DS` mudar. */
  const vivas = new Set<SwarmConnection>();
  /**
   * `communityId:peerKeyHex` → aceitador do lado respondedor (modo host). O desregistro é
   * do MUX em que o par foi registrado — a entrada carrega o stream junto, porque o mux
   * morre com a conexão e o par tem de renascer na conexão seguinte (§65).
   */
  const aceitando = new Map<string, { readonly stream: object; readonly unpair: () => void }>();
  /** Tópicos de convite procurados (este nó é candidato) e servidos (este nó hospeda). */
  const procurados = new Set<string>();
  let servidos: readonly string[] = [];
  let canalCb: ((info: AdmissionChannelInfo) => boolean) | null = null;

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
    aceitando.get(`${canal.communityId}:${canal.peerKeyHex}`)?.unpair();
    aceitando.delete(`${canal.communityId}:${canal.peerKeyHex}`);
  };

  /**
   * O `info.peer.address` do hyperswarm vem ora como IP puro, ora como `ip:porta`. O que o
   * TURN precisa é o IP: RFC 5766 §9 casa permissão por endereço, e a porta que viria aqui
   * seria a da socket do DHT, que não é a do `RTCPeerConnection` de ninguém.
   */
  const soIp = (endereco: string): string | null => {
    const sem = endereco.startsWith('[') ? endereco.slice(1, endereco.indexOf(']')) : endereco.split(':')[0];
    return sem !== undefined && sem.length > 0 ? sem : null;
  };

  const infoDe = (conn: SwarmConnection, topicHex: string, transport: ProtomuxTransport): AdmissionChannelInfo => ({
    transport,
    topicHex,
    peerKeyHex: conn.remotePublicKeyHex,
    ...(conn.remoteAddress !== undefined ? { address: conn.remoteAddress } : {}),
  });

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

    // §13.4/§14.1 — os cores de blobs conhecidos (o local desta instalação e os que já
    // estão em download) entram no MESMO mux das comunidades; o hypercore abre canal
    // próprio para cada um, e o manager marca uma replicação por (mux, core).
    deps.runtime.blobs.serveMux(mux);

    // Quais comunidades esta conexão pode servir. `conn.topicsHex` só vem preenchido do
    // lado que **procurou** o tópico, e o hyperdht deduplica conexão por par — a conexão da
    // admissão (§12.3) é a MESMA pela qual, depois do resgate, o log passa a replicar. Por
    // isso o tópico é dica de prioridade, não filtro: quem decide o que esta conexão serve
    // é §14.3(1), por comunidade e independente de tópico. Um par que não é membro ativo de
    // uma comunidade não a recebe nem dela baixa, venha por onde vier.
    const casando =
      conn.topicsHex.length > 0
        ? conn.topicsHex.map((t) => porTopico.get(t)).filter((id): id is string => id !== undefined)
        : [];
    const candidatas = casando.length > 0 ? [...casando, ...porTopico.values()] : [...porTopico.values()];

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
      // Entrada velha cuja queda não foi notificada (ordem de eventos, stream morto sem
      // `onDown` a tempo) não pode bloquear a reabertura: cabo caído é canal ausente.
      const existente = daComunidade.get(conn.remotePublicKeyHex);
      if (existente !== undefined) {
        if (!existente.transport.down) continue;
        fecharCanal(existente);
      }

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
        // Host: responde. O canal nasce quando o membro o pedir (§16.1). O registro é POR
        // CONEXÃO: se já existe aceitador para este par mas em OUTRO stream, é resquício
        // de uma conexão morta — sai daí e registra no mux vivo, senão o protomux recusa
        // todo open deste membro até o host reiniciar (defeto irmão do smoke de §63.4).
        const chave = `${communityId}:${conn.remotePublicKeyHex}`;
        const anterior = aceitando.get(chave);
        if (anterior !== undefined) {
          if (anterior.stream === stream) continue;
          anterior.unpair();
        }
        aceitando.set(
          chave,
          {
            stream,
            unpair: protomuxChannelAcceptor(mux, { protocol: 'community', id: c.core.key }, (transport) => {
              // A recusa de anexo ("não é hospedada aqui", par banido entre o pair e o open)
              // é normal na vida do host — e o callback corre dentro do processamento do
              // stream do hyperswarm. Um throw aí escapa para o protomux com o processo no
              // caminho; fechar o transporte é o desfecho correto e suficiente.
              try {
                const { detach } = deps.runtime.attachMemberConnection({
                  communityId,
                  peerKeyHex: conn.remotePublicKeyHex,
                  transport,
                });
                registrar(transport, detach);
              } catch {
                transport.close();
              }
            }),
          },
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
      // Mesma disciplina do aceitador: anexo que recusa fecha o canal, nunca propaga.
      try {
        deps.runtime.attachHostChannel({ communityId, transport });
      } catch {
        transport.close();
        continue;
      }
      registrar(transport, null);
    }

    // ── Canal pré-membro `p2p-admission/1` (§12.3, §16.1) ────────────────────────────
    // Candidato: a conexão chegou por um tópico de convite que este nó procura → abre o
    // canal contra o host. Um por tópico por conexão; quem decide o que fazer com o canal
    // é o serviço de admissão (tetos de §12.6, seis desfechos).
    const jaAdmissao = admissaoPorStream.get(stream) ?? new Set<string>();
    for (const topicHex of conn.topicsHex) {
      if (!procurados.has(topicHex) || jaAdmissao.has(topicHex)) continue;
      jaAdmissao.add(topicHex);
      admissaoPorStream.set(stream, jaAdmissao);
      const transport = protomuxChannelTransport(mux, { protocol: 'admission', id: Buffer.from(topicHex, 'hex') });
      if (transport === null) continue;
      if (canalCb === null || !canalCb(infoDe(conn, topicHex, transport))) {
        transport.close();
        jaAdmissao.delete(topicHex);
      }
    }

    // Host: registra o par `(protocolo, id)` para cada convite ativo — é o que permite o
    // candidato abrir o canal (mesma assimetria de §16.1). Registrado por conexão; convite
    // que sai da lista não é registrado em conexões novas, e um canal já aberto continua
    // sujeito aos tetos e à validação por request do serviço de admissão.
    const jaAceita = aceitadoresPorStream.get(stream) ?? new Set<string>();
    for (const topicHex of servidos) {
      if (jaAceita.has(topicHex)) continue;
      jaAceita.add(topicHex);
      aceitadoresPorStream.set(stream, jaAceita);
      protomuxChannelAcceptor(mux, { protocol: 'admission', id: Buffer.from(topicHex, 'hex') }, (transport) => {
        if (canalCb === null || !canalCb(infoDe(conn, topicHex, transport))) transport.close();
      });
    }
  };

  // §12.3 — um par com quem já falamos passou a anunciar um tópico de convite novo. O
  // hyperswarm não emite `connection` de novo para quem já está conectado, então sem este
  // gancho o canal de admissão do SEGUNDO convite do mesmo host nunca abria: o candidato
  // esperava as quatro rodadas de §12.3 e caía em `E_HOST_UNAVAILABLE` — que, atrás do
  // prazo do renderer, aparece como `E_TIMEOUT`. `avaliar` é idempotente por stream.
  const offPeerTopics = backend.onPeerTopics?.((conn) => avaliar(conn)) ?? (() => {});

  const offConnection = backend.onConnection((conn) => {
    vivas.add(conn);
    const stream = conn.stream as unknown as object;
    conn.stream.once('close', () => {
      vivas.delete(conn);
      // O manager esquece as marcações de replicação deste mux — se o par voltar, será
      // outro stream, e `replicate` tem de poder acontecer de novo.
      const mux = muxes.get(stream);
      if (mux !== undefined) deps.runtime.blobs.forgetMux(mux);
      muxes.delete(stream);
      // E os aceitadores registrados NESTE stream morrem com ele: a entrada global do par
      // não pode sobreviver apontando para um mux morto (§65).
      for (const [chave, registro] of [...aceitando]) {
        if (registro.stream === stream) {
          registro.unpair();
          aceitando.delete(chave);
        }
      }
    });
    avaliar(conn);
  });

  // §14.3(3) — o lote que aplicou o ban fecha o canal do banido, aqui. E o mesmo gatilho
  // abre o canal que só era possível depois de saber quem é o host.
  const offProjected = deps.runtime.onProjected((communityId) => refresh(communityId));

  function refresh(communityId: string): void {
    const c = deps.runtime.get(communityId);
    const daComunidade = canais.get(communityId);
    const cortados: string[] = [];
    if (daComunidade !== undefined) {
      for (const canal of [...daComunidade.values()]) {
        if (c === undefined || !autorizado(c, canal.peerKeyHex)) {
          fecharCanal(canal);
          cortados.push(canal.peerKeyHex);
        }
      }
    }
    for (const conn of vivas) avaliar(conn);
    // §18.1 (`mod.ban`/`mod.kick`) — "canais de replicação fechados; conexões
    // derrubadas": fechar só o canal RPC deixa o hypercore replicando bloco novo
    // para quem saiu da comunidade. A conexão cai INTEIRA quando o par não tem
    // NENHUMA outra comunidade em comum autorizada — a mesma régua do firewall de
    // §14.3(4), que mantém a porta aberta para comunidades onde ele ainda é membro.
    for (const peerKeyHex of cortados) {
      if (temComumAutorizada(peerKeyHex)) continue;
      for (const conn of [...vivas]) {
        if (conn.remotePublicKeyHex === peerKeyHex) conn.close();
      }
    }
  }

  /** O par ainda é membro ativo de alguma outra comunidade aberta aqui? */
  function temComumAutorizada(peerKeyHex: string): boolean {
    return [...deps.runtime.communities()].some(
      (outra) => outra.projector.ds.community.exists && autorizado(outra, peerKeyHex),
    );
  }

  // ── §14.1: entra nos tópicos das comunidades abertas ────────────────────────────────
  //
  // Reenumerável: uma comunidade que nasce depois do boot (`community.create`,
  // `invite.redeem`, continuação descoberta) é anunciada/procurada pelo gancho `onOpen`,
  // sem reiniciar o processo.
  function syncTopicos(): void {
    for (const c of deps.runtime.communities()) {
      const discoveryKey = c.core.discoveryKey;
      if (discoveryKey === undefined) {
        deps.onSkipped?.({ communityId: c.communityId, reason: 'E_NO_DISCOVERY_KEY' });
        continue;
      }
      const topicHex = discoveryKey.toString('hex');
      if (porTopico.has(topicHex)) continue;
      porTopico.set(topicHex, c.communityId);
      // O host anuncia o tópico; quem replica o procura (§14.1).
      deps.swarm.join(topicHex, { topicHex, kind: 'community-log', communityId: c.communityId }, { server: c.isHost, client: !c.isHost });
    }
  }

  syncTopicos();
  const offOpen = deps.runtime.onOpen((communityId) => {
    syncTopicos();
    // Comunidade que nasce depois do boot: liga o core novo às conexões **já vivas** — a
    // mesma do canal de admissão, no caso do resgate (o hyperdht deduplica conexão por
    // par, então tópico novo não traz conexão nova). Sem isto, o core nunca entraria num
    // mux existente e a primeira replicação não começaria.
    refresh(communityId);
  });

  const transporte: CommunityTransport = {
    flush: () => deps.swarm.flush(),
    refresh,
    leaveCommunity(communityId: string): void {
      for (const [topicHex, cid] of [...porTopico]) {
        if (cid !== communityId) continue;
        porTopico.delete(topicHex);
        deps.swarm.leave(topicHex);
      }
      const daComunidade = canais.get(communityId);
      if (daComunidade !== undefined) {
        for (const canal of [...daComunidade.values()]) fecharCanal(canal);
        canais.delete(communityId);
      }
    },
    ipDoPar(peerKeyHex: string): string | null {
      for (const conn of vivas) {
        if (conn.remotePublicKeyHex !== peerKeyHex) continue;
        if (conn.remoteAddress === undefined) continue;
        const ip = soIp(conn.remoteAddress);
        if (ip !== null) return ip;
      }
      return null;
    },
    channelCount: () => [...canais.values()].reduce((n, m) => n + m.size, 0),
    seekInviteTopic(topicHex: string): void {
      if (procurados.has(topicHex)) return;
      procurados.add(topicHex);
      deps.swarm.join(topicHex, { topicHex, kind: 'invite', communityId: null }, { server: false, client: true });
      // Kick na DHT: a consulta não precisa estar concluída para isto resolver, mas não
      // deve esperar o próximo tick do escalonador para começar.
      void deps.swarm.flush().catch(() => {});
    },
    releaseInviteTopic(topicHex: string): void {
      if (!procurados.delete(topicHex)) return;
      deps.swarm.leave(topicHex);
    },
    serveInviteTopics(topicsHex: readonly string[]): void {
      servidos = [...topicsHex];
      // Conexões já vivas passam a aceitar os convites novos na próxima avaliação.
      for (const conn of vivas) avaliar(conn);
    },
    onAdmissionChannel(cb: (info: AdmissionChannelInfo) => boolean): () => void {
      canalCb = cb;
      return () => {
        if (canalCb === cb) canalCb = null;
      };
    },
    async stop(): Promise<void> {
      offConnection();
      offPeerTopics();
      offProjected();
      offOpen();
      for (const registro of aceitando.values()) registro.unpair();
      aceitando.clear();
      for (const daComunidade of canais.values()) {
        for (const canal of [...daComunidade.values()]) fecharCanal(canal);
      }
      canais.clear();
      vivas.clear();
      for (const mux of muxes.values()) deps.runtime.blobs.forgetMux(mux);
      muxes.clear();
      for (const topicHex of porTopico.keys()) deps.swarm.leave(topicHex);
      porTopico.clear();
      for (const topicHex of procurados) deps.swarm.leave(topicHex);
      procurados.clear();
      servidos = [];
      await backend.destroy();
    },
  };
  // O transporte se registra no runtime: as superfícies que precisam dele — hoje, o
  // `p2p-admission/1` — esperam por este anexo (`CoreRuntime.whenTransport`).
  deps.runtime.attachTransport(transporte);
  return transporte;
}
