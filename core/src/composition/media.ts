// §17.3 — o serviço STUN/TURN do host, montado sobre a socket que o UDX já usa.
//
// Uma instalação tem UMA socket (§17.3) e pode hospedar VÁRIAS comunidades, cada uma com o
// seu `hostTurnSecret` (§5.2 deriva por comunidade). Este módulo é o que reconcilia as duas
// coisas: um `MediaServer` por processo, e um registro de sessões de voz que diz, para cada
// `sessionId` que chega numa credencial TURN, de qual comunidade ela é.
//
// **A ponte par→endereço, que era o que faltava (B27, fechado em 2026-08-28).** §17.3 manda
// permitir só endereços de pares do roster daquela sessão, e o roster de `voiceCoordinator`
// guarda **chaves**. A ponte tem duas pernas, e as duas são necessárias:
//
//   1. **O transporte.** `SwarmConnection.remoteAddress` é o IP de onde o par abriu a
//      conexão autenticada pelo Noise — o mesmo que §12.6 já usa para a metade por /24 do
//      rate limit pré-membro. Chave → IP, de graça, para todo par conectado.
//   2. **O próprio TURN.** Um Allocate/Refresh que fecha o MESSAGE-INTEGRITY prova que
//      aquela chave está naquele IP **agora**. Cobre o par cujo tráfego de mídia sai por um
//      IP diferente do da conexão do DHT (operadora com pool de saída, máquina com duas
//      WANs) — caso em que a perna (1) daria o IP errado e a permissão seria negada.
//
// A união das duas é o conjunto de IPs da sessão. Por **IP**, não por `host:port`: RFC 5766
// §9 ignora a porta na permissão, e é o que torna a ponte possível — a porta de origem do
// `RTCPeerConnection` é de outra socket, com outro mapeamento NAT, e o host não tem como
// sabê-la.

import { MediaServer, type MediaAddr, type RelayPort } from '../l2/communityHost/stunTurn.ts';
import type { MediaSocketTap } from '../l0/swarm/ports.ts';
import type { IceServer, VoiceHostSessions } from '../l2/voiceCoordinator/index.ts';
import { resolveConfig } from '../l0/config/index.ts';
import { abrirPortaDeRelay, RELAY_PRIMER } from './relayPort.ts';

type ComunidadeHospedada = {
  readonly communityId: string;
  readonly voice: VoiceHostSessions;
  readonly turnSecret: Buffer;
};

/**
 * Perna (1) da ponte: o que o transporte observou. Porta, e não import, porque
 * `CommunityTransport` nasce depois do `MediaHost` e a direção real é composição → os dois.
 */
export type EnderecosObservadosPort = {
  /** IP público de onde o par abriu conexão, ou `null` se ele não está conectado. */
  ipDoPar(peerKeyHex: string): string | null;
};

export type MediaHostOptions = {
  readonly stunDeTerceiros?: readonly string[];
  readonly enderecos?: EnderecosObservadosPort;
};

/**
 * O serviço de mídia do processo. Nasce com a socket; as comunidades hospedadas se
 * registram conforme abrem, e saem quando fecham.
 */
export class MediaHost {
  readonly #tap: MediaSocketTap;
  readonly #hospedadas = new Map<string, ComunidadeHospedada>();
  readonly #server: MediaServer;
  readonly #desinstalar: () => void;

  readonly #terceiros: readonly string[];
  #enderecos: EnderecosObservadosPort | null;
  /** Perna (2): `sessionId` → `peerKeyHex` → IP provado por MESSAGE-INTEGRITY. */
  readonly #observados = new Map<string, Map<string, string>>();

  constructor(tap: MediaSocketTap, realm: string, opts: MediaHostOptions | readonly string[] = {}) {
    // A forma antiga (terceiro parâmetro = lista de STUN) continua aceita: é o que a suíte
    // de §17.2 usa para isolar o `iceServers` do host do de terceiro.
    const o: MediaHostOptions = Array.isArray(opts) ? { stunDeTerceiros: opts as readonly string[] } : (opts as MediaHostOptions);
    this.#terceiros = o.stunDeTerceiros ?? resolveConfig().stunServers;
    this.#enderecos = o.enderecos ?? null;
    this.#tap = tap;
    this.#server = new MediaServer({
      realm,
      hostTurnSecret: (sessionId) => this.#daSessao(sessionId)?.turnSecret ?? null,
      socket: { send: (d, a) => tap.send(d, a) },
      // O endereço relayado de uma alocação é de uma socket NOVA, e o mapeamento externo
      // dela não é o do DHT. Ver `relayPort.ts` para a lacuna de §17.3 e a decisão.
      openRelayPort: () => abrirPortaDeRelay({ stunServers: this.#terceiros }),
      sessionPeerKeys: (sessionId) => this.#daSessao(sessionId)?.voice.participantKeys(sessionId) ?? new Set<string>(),
      rosterAddresses: (sessionId) => this.ipsDaSessao(sessionId),
      primeRelayTo: (relay: RelayPort, peer: MediaAddr) => relay.send(RELAY_PRIMER, peer),
      onPeerObserved: (sessionId, peerKeyHex, addr) => {
        let porSessao = this.#observados.get(sessionId);
        if (porSessao === undefined) {
          porSessao = new Map();
          this.#observados.set(sessionId, porSessao);
        }
        porSessao.set(peerKeyHex, addr.host);
      },
    });
    this.#desinstalar = tap.tap((data, from) => {
      // `udx` volta ao dono da socket; STUN e dados de canal foram consumidos aqui.
      return this.#server.handleDatagram(data, { host: from.host, port: from.port }) !== 'udx';
    });
  }

  /** Perna (1) da ponte, ligada depois do boot: o transporte nasce depois deste objeto. */
  ligarEnderecos(port: EnderecosObservadosPort): void {
    this.#enderecos = port;
  }

  registrar(c: ComunidadeHospedada): void {
    this.#hospedadas.set(c.communityId, c);
  }

  esquecer(communityId: string): void {
    this.#hospedadas.delete(communityId);
  }

  /**
   * O que `voice.join` entrega ao renderer (§17.4). Sem endereço público observado a lista
   * vai vazia — e vazia é honesto: o WebRTC junta só candidato de host e a chamada fecha
   * apenas em rede local. Anunciar um `0.0.0.0` seria pior do que não anunciar nada.
   *
   * O `turn:` sai no MESMO endereço do `stun:` porque §17.3 põe os dois na mesma socket. Ele
   * vai **sem credencial**: quem a tem é a sessão, e é `voiceJoin` que a costura (§17.3 —
   * `turnCredential` é de curta duração e amarrada ao par).
   */
  iceServers(): readonly IceServer[] {
    const addr = this.#tap.publicAddress();
    const doHost: IceServer[] =
      addr === null ? [] : [{ urls: `stun:${addr.host}:${addr.port}` }, { urls: `turn:${addr.host}:${addr.port}?transport=udp` }];
    // §17.2 — o do host vem PRIMEIRO: quando ele resolve, o de terceiro nem é consultado, e
    // o IP de quem entra em chamada não sai da comunidade. O de terceiro é a saída da L-11
    // (§80), não o caminho normal.
    return [...doHost, ...this.#terceiros.map((urls) => ({ urls }))];
  }

  /** §17.2 "com aviso" — a tela precisa saber que um terceiro está no caminho. */
  get usaStunDeTerceiros(): boolean {
    return this.#terceiros.length > 0;
  }

  /** §15.4 `diag.run` — há caminho relayado servível aqui? (`relayAvailable`, B11). */
  get servindoRelay(): boolean {
    return this.#tap.publicAddress() !== null && this.#terceiros.length > 0;
  }

  get counters(): MediaServer['counters'] {
    return this.#server.counters;
  }

  close(): void {
    this.#desinstalar();
    this.#server.close();
    this.#observados.clear();
    this.#hospedadas.clear();
  }

  /**
   * A união das duas pernas da ponte — é o que §17.3 chama de "endereços de pares presentes
   * no roster daquela sessão". Público porque é o conjunto que decide se o caminho relayado
   * abre ou não, e ficar invisível foi o que deixou B27 aberto sem ninguém notar.
   */
  ipsDaSessao(sessionId: string): ReadonlySet<string> {
    const ips = new Set<string>();
    const c = this.#daSessao(sessionId);
    if (c !== null) {
      for (const peerKeyHex of c.voice.participantKeys(sessionId)) {
        const ip = this.#enderecos?.ipDoPar(peerKeyHex) ?? null;
        if (ip !== null) ips.add(ip);
      }
    }
    // Perna (2). Filtrada pelo roster VIVO: quem saiu da sessão perde a permissão junto,
    // que é o que §17.4 exige da revogação — o endereço observado não pode sobreviver a ela.
    const roster = c?.voice.participantKeys(sessionId);
    for (const [peerKeyHex, ip] of this.#observados.get(sessionId) ?? []) {
      if (roster?.has(peerKeyHex) === true) ips.add(ip);
    }
    return ips;
  }

  #daSessao(sessionId: string): ComunidadeHospedada | null {
    for (const c of this.#hospedadas.values()) {
      if (c.voice.participantKeys(sessionId).size > 0) return c;
    }
    return null;
  }
}
