// §17.3 — o serviço STUN/TURN do host, montado sobre a socket que o UDX já usa.
//
// Uma instalação tem UMA socket (§17.3) e pode hospedar VÁRIAS comunidades, cada uma com o
// seu `hostTurnSecret` (§5.2 deriva por comunidade). Este módulo é o que reconcilia as duas
// coisas: um `MediaServer` por processo, e um registro de sessões de voz que diz, para cada
// `sessionId` que chega numa credencial TURN, de qual comunidade ela é.
//
// O que ele NÃO faz ainda: permissões TURN. §17.3 manda permitir só endereços de pares
// presentes no roster daquela sessão, e o roster de `voiceCoordinator` guarda chaves, não
// endereços — a ponte par→endereço observado vem do transporte e ainda não existe. Enquanto
// isso `rosterAddresses` devolve vazio, o que faz o TURN recusar CreatePermission: o caminho
// relayado fica indisponível e a chamada depende de conexão direta. É a L-11 declarada, e
// está registrado no backlog.

import { MediaServer } from '../l2/communityHost/stunTurn.ts';
import type { MediaSocketTap } from '../l0/swarm/ports.ts';
import type { IceServer, VoiceHostSessions } from '../l2/voiceCoordinator/index.ts';
import { resolveConfig } from '../l0/config/index.ts';

type ComunidadeHospedada = {
  readonly communityId: string;
  readonly voice: VoiceHostSessions;
  readonly turnSecret: Buffer;
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

  constructor(tap: MediaSocketTap, realm: string, stunDeTerceiros: readonly string[] = resolveConfig().stunServers) {
    this.#terceiros = stunDeTerceiros;
    this.#tap = tap;
    this.#server = new MediaServer({
      realm,
      hostTurnSecret: (sessionId) => this.#daSessao(sessionId)?.turnSecret ?? null,
      socket: { send: (d, a) => tap.send(d, a) },
      openRelayPort: async () => {
        // Sem permissões não há alocação útil; recusar aqui é honesto e não abre porta à toa.
        throw Object.assign(new Error('relay TURN ainda não montado'), { code: 'E_NOT_IMPLEMENTED' });
      },
      sessionPeerKeys: (sessionId) => this.#daSessao(sessionId)?.voice.participantKeys(sessionId) ?? new Set<string>(),
      rosterAddresses: () => new Set<string>(),
    });
    this.#desinstalar = tap.tap((data, from) => {
      // `udx` volta ao dono da socket; STUN e dados de canal foram consumidos aqui.
      return this.#server.handleDatagram(data, { host: from.host, port: from.port }) !== 'udx';
    });
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
   */
  iceServers(): readonly IceServer[] {
    const addr = this.#tap.publicAddress();
    const doHost: IceServer[] = addr === null ? [] : [{ urls: `stun:${addr.host}:${addr.port}` }];
    // §17.2 — o do host vem PRIMEIRO: quando ele resolve, o de terceiro nem é consultado, e
    // o IP de quem entra em chamada não sai da comunidade. O de terceiro é a saída da L-11
    // (§80), não o caminho normal.
    return [...doHost, ...this.#terceiros.map((urls) => ({ urls }))];
  }

  /** §17.2 "com aviso" — a tela precisa saber que um terceiro está no caminho. */
  get usaStunDeTerceiros(): boolean {
    return this.#terceiros.length > 0;
  }

  get counters(): MediaServer['counters'] {
    return this.#server.counters;
  }

  close(): void {
    this.#desinstalar();
    this.#hospedadas.clear();
  }

  #daSessao(sessionId: string): ComunidadeHospedada | null {
    for (const c of this.#hospedadas.values()) {
      if (c.voice.participantKeys(sessionId).size > 0) return c;
    }
    return null;
  }
}
