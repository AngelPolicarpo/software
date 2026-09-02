// O protocolo `p2p-dm/1` de §31.8 — o **terceiro** canal `protomux` de §16.1, ao lado de
// `p2p-community/1` e `p2p-admission/1`.
//
// Este arquivo é raiz de composição (§4). A **política** já existe e não mora aqui: os cinco
// estados, o aceite, o bloqueio silencioso, o teto de pendentes e o filtro de contato são de
// `directMessages` (L2, §103), que declara a porta de RPC e não importa transporte. O que se
// compõe aqui é o fio: descoberta, canal, handshake, os tetos de §31.18, a replicação dos
// dois cores no mesmo mux e o `dm.typing` efêmero.
//
// Quatro camadas de autenticação, todas de §31.8, e nenhuma nova:
//
//   1. **Transporte.** O Noise do `hyperdht` já autenticou `remotePublicKey`, e ela **é** a
//      chave de identidade do par (§5.1, §14.3 emenda). Não há handshake de identidade em
//      banda a construir.
//   2. **Vínculo da conversa.** O `conversationId` anunciado tem de ser exatamente
//      `BLAKE2b('dm-conv/1' ‖ min(remotePk, selfPk) ‖ max(remotePk, selfPk))`. Fecha
//      impersonação e transplante de conversa **antes** de qualquer trabalho criptográfico
//      caro — a mesma propriedade que A07 dá ao log.
//   3. **Posse do core.** `coreProof` sobre
//      `BLAKE2b('dm-core-possession/1' ‖ conversationId ‖ coreKey)`, assinado pela chave de
//      identidade do par. Mesma forma de R-19; é a **prova viva**, e o `dm.hello` no índice 0
//      é a prova durável (§31.8(3)).
//   4. **Autorização de canal.** `autorizaDm(par, conversa)` — o predicado de §31.8(4), que
//      mora em `directMessages`. É isso, e só isso, que impede um terceiro de replicar um
//      core de DM cuja chave tenha vazado.
//
// **Descoberta: nenhuma peça nova.** Por **L-24** a chave de identidade é o nó na DHT. O nó
// se anuncia sob o próprio par (`announceSelf`) e procura o par de cada conversa pela chave
// dele (`joinPeer`). **Não há tópico de conversa** — §31.8 recusou o tópico derivado do
// segredo compartilhado porque ele não funciona no primeiro contato.
//
// **O canal é simétrico, e é a única coisa aqui que §16.1 não tinha.** Nos outros dois
// protocolos "quem abre é o membro, quem responde é o host"; numa conversa direta não há
// host, então **os dois lados abrem o canal e os dois respondem** — cada ponta roda um
// `RpcServer` e um `RpcClient` sobre o mesmo cabo. Quem **chama** `dmHello` é quem tem core:
// em `pending-in` não existe o meu core (§31.9 regra 1), logo não existe `coreProof` a
// enviar, e quem quer contato é o outro lado de qualquer forma.

import sodium from 'sodium-native';

import {
  DM_VERSION,
  dmConversationKey,
  dmCorePossessionHash,
  verifyDmSignature,
} from '../l1/dmCodec/index.ts';
import type { CoreHandle } from '../l0/corestore/index.ts';
import type { Swarm } from '../l0/swarm/index.ts';
import type { SwarmConnection } from '../l0/swarm/ports.ts';
import { PreMemberRateLimiter } from '../l2/invites/index.ts';
import {
  P2P_DM_PENDING_MAX_RECORDS,
  type DirectMessages,
  type DmConversationRow,
} from '../l2/directMessages/index.ts';
import { RpcClient } from '../l3/rpcClient/index.ts';
import {
  RPC_FRAME_MAX_BYTES,
  RPC_FRAME_MAX_BYTES_DM_ACCEPTED,
  RpcServer,
} from '../l3/rpcServer/index.ts';
import { muxOf, protomuxChannelTransport, type ProtomuxTransport } from '../l3/rpcServer/protomux.ts';

/** §31.8 — `dm.typing`: efêmero, TTL 5 s, refresh 3 s, teto de 1 / 2 s (números de §17.6). */
export const DM_TYPING_TTL_MS = 5_000;
export const DM_TYPING_REFRESH_MS = 3_000;
const DM_TYPING_RATE_MS = 2_000;

/** §31.18 — bucket por `remotePublicKey`, na coluna que se aplica. */
const BUCKET_DESCONHECIDO = { perPeerMax: 10, perPeerWindowMs: 60_000, perSubnetMax: 30, perSubnetWindowMs: 60_000 };
const BUCKET_ACEITO = { perPeerMax: 40, perPeerWindowMs: 10_000, perSubnetMax: 0, perSubnetWindowMs: 0 };

function b64(b: Uint8Array): string {
  return Buffer.from(b).toString('base64');
}

function unb64(v: unknown): Buffer | null {
  if (typeof v !== 'string') return null;
  const b = Buffer.from(v, 'base64');
  return b.length > 0 ? b : null;
}

function json(v: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(v), 'utf8');
}

function parse(body: Uint8Array): Record<string, unknown> | null {
  try {
    const v = JSON.parse(Buffer.from(body).toString('utf8')) as unknown;
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type DmTransportDeps = {
  readonly swarm: Swarm;
  /** A política de §31.9/§31.13 — L2, já pronta (§103). */
  readonly dm: DirectMessages;
  readonly identity: { readonly publicKey: Buffer; readonly secretKey: Buffer };
  /** §31.16.2 — os eventos saem por aqui; quem os leva ao renderer é B59. */
  readonly onEvent?: (topic: string, data: Record<string, unknown>) => void;
  readonly clock?: { now(): number };
};

export type DmTransport = {
  /**
   * Reavalia descoberta e canais a partir do estado de `directMessages`. Idempotente, e
   * chamável a cada mudança de conversa (aceite, bloqueio, `dm.forget`).
   */
  refresh(): void;
  /** §31.8 — publica `dm.typing`, com o teto de 1 / 2 s por conversa. */
  setTyping(conversationId: string, on: boolean): { ok: true } | { ok: false; code: string };
  /** O par está digitando **agora**, pelo TTL de 5 s. Efêmero, nunca persistido. */
  typingDoPar(conversationId: string): boolean;
  /** Canais `p2p-dm/1` vivos — para métrica e teste. */
  channelCount(): number;
  stop(): Promise<void>;
};

type Canal = {
  readonly conversationId: string;
  readonly peerKeyHex: string;
  /** O stream da conexão — é dele que sai o mux em que os dois cores entram (§31.13). */
  readonly stream: object;
  readonly transport: ProtomuxTransport;
  readonly server: RpcServer;
  readonly client: RpcClient;
  /** `true` depois de um `dmHello` bem-sucedido em qualquer direção. */
  apresentado: boolean;
};

export function startDmTransport(deps: DmTransportDeps): DmTransport {
  const agora = (): number => deps.clock?.now() ?? Date.now();
  const emitir = (topic: string, data: Record<string, unknown>): void => deps.onEvent?.(topic, data);

  /** `stream` → mux (§16.1: uma conexão, um mux). */
  const muxes = new Map<object, unknown>();
  /** `conversationId` → canal vivo. Um por conversa: há um par só do outro lado. */
  const canais = new Map<string, Canal>();
  /** §31.13 — `attachTo` não é idempotente: uma replicação por `(mux, core)`. */
  const replicando = new WeakMap<object, Set<string>>();
  const vivas = new Set<SwarmConnection>();
  /** §31.18 — um limitador por coluna da tabela. */
  const limiteDesconhecido = new PreMemberRateLimiter(BUCKET_DESCONHECIDO);
  const limiteAceito = new PreMemberRateLimiter(BUCKET_ACEITO);
  /** `conversationId` → quando o `dm.typing` do par expira, e quando eu publiquei o meu. */
  const typingDoPar = new Map<string, number>();
  const typingMeu = new Map<string, number>();
  let parado = false;

  // ── Derivações e leitura de estado ─────────────────────────────────────────────────

  const idDoPar = (peerKeyHex: string): string | null => {
    const k = dmConversationKey(deps.identity.publicKey, Buffer.from(peerKeyHex, 'hex'));
    return k === null ? null : k.toString('hex');
  };

  /** §31.18 — a coluna da tabela: par com conversa `accepted` ou par desconhecido. */
  const aceito = (row: DmConversationRow | null): boolean => row?.state === 'accepted';

  // ── §31.8 — descoberta, sem tópico ─────────────────────────────────────────────────

  const refresh = (): void => {
    if (parado) return;
    const linhas = deps.dm.listar();
    // §31.8: quem tem conversa `accepted` ou `pending-out` **anuncia-se**. Em `pending-in` eu
    // não procuro ninguém: o pedido chegou até mim, e ir atrás dele antes de aceitar seria
    // dizer ao remetente que eu existo — que é justamente o que o aceite decide.
    if (linhas.some((r) => r.state === 'accepted' || r.state === 'pending-out')) {
      deps.swarm.announceSelf();
    }
    for (const row of linhas) {
      const peerKeyHex = row.peer_key.toString('hex');
      if (row.state === 'accepted' || row.state === 'pending-out') {
        deps.swarm.joinPeer(peerKeyHex);
      } else {
        // `blocked` é **silencioso**: recuso o canal e paro de conectar, e o bloqueado vê o
        // mesmo que veria se eu estivesse offline (§31.9 regra 2, **L-28**).
        deps.swarm.leavePeer(peerKeyHex);
        fecharCanal(row.conversation_id);
      }
    }
    for (const conn of vivas) avaliar(conn);
    // O aceite cria o meu core **depois** de o canal já existir (§31.9 regra 1), e é o
    // `dmHello` que leva a `coreKey` ao par: sem esta releitura, quem aceitou ficaria com um
    // canal vivo e mudo até a conexão cair, e o outro lado nunca saberia que agora há core.
    for (const canal of canais.values()) {
      if (canal.apresentado) continue;
      if (deps.dm.coreDe(canal.conversationId) === null) continue;
      void chamarHello(canal);
    }
  };

  const fecharCanal = (conversationId: string): void => {
    const canal = canais.get(conversationId);
    if (canal === undefined) return;
    canais.delete(conversationId);
    canal.client.detach();
    canal.transport.close();
  };

  // ── §31.8(3) — a prova de posse, viva ──────────────────────────────────────────────

  const provaDeCorePropria = (conversationKey: Buffer, coreKey: Buffer): Buffer => {
    const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
    sodium.crypto_sign_detached(sig, dmCorePossessionHash(conversationKey, coreKey), deps.identity.secretKey);
    return sig;
  };

  const provaConfere = (a: {
    conversationKey: Buffer;
    coreKey: Buffer;
    coreProof: Buffer;
    peerKey: Buffer;
  }): boolean =>
    verifyDmSignature(a.coreProof, dmCorePossessionHash(a.conversationKey, a.coreKey), a.peerKey);

  // ── O handshake, nas duas direções ─────────────────────────────────────────────────

  /**
   * O corpo do `dmHello` que **eu** envio. `null` quando não tenho core — que é exatamente o
   * caso `pending-in` de §31.9 regra 1: antes do aceite não existe `dm.hello` do meu lado,
   * logo não existe `coreProof` a apresentar.
   */
  const meuHello = (conversationId: string): Record<string, unknown> | null => {
    const core = deps.dm.coreDe(conversationId);
    if (core === null) return null;
    const conversationKey = Buffer.from(conversationId, 'hex');
    return {
      dmVersion: DM_VERSION,
      conversationId,
      coreKey: b64(core.key),
      coreProof: b64(provaDeCorePropria(conversationKey, core.key)),
    };
  };

  /**
   * O lado que **responde**. A ordem das recusas é a de §14.4 (teto → bucket → decode →
   * assinatura → estado), e a última delas é a que §31.9 regra 2 obriga: bloqueado e
   * recusado-por-política devolvem o **mesmo** código, porque distingui-los seria o aviso que
   * o bloqueio silencioso recusa dar.
   */
  const responderHello = async (
    peerKeyHex: string,
    body: Uint8Array,
  ): Promise<Uint8Array | { code: string }> => {
    const req = parse(body);
    if (req === null) return { code: 'E_MALFORMED' };
    if (req['dmVersion'] !== DM_VERSION) return { code: 'E_VERSION_UNSUPPORTED' };

    const peerKey = Buffer.from(peerKeyHex, 'hex');
    const conversationKey = dmConversationKey(deps.identity.publicKey, peerKey);
    if (conversationKey === null) return { code: 'E_VALIDATION' };
    const conversationId = conversationKey.toString('hex');

    // §31.8(2) — o vínculo, **antes** de qualquer trabalho criptográfico caro.
    if (req['conversationId'] !== conversationId) return { code: 'E_DM_NOT_AUTHORIZED' };

    const coreKey = unb64(req['coreKey']);
    const coreProof = unb64(req['coreProof']);
    if (coreKey === null || coreProof === null || coreKey.length !== 32) {
      return { code: 'E_VALIDATION' };
    }
    // §31.8(3) — a prova viva. Sem ela, `coreKey` seria uma afirmação do par sobre si mesmo.
    if (!provaConfere({ conversationKey, coreKey, coreProof, peerKey })) {
      return { code: 'E_DM_NOT_AUTHORIZED' };
    }

    // A política é de L2 (§31.9): aceite, bloqueio, teto de pendentes, filtro de contato,
    // e RD-6 (chave de core imutável).
    const decisao = await deps.dm.receberHello({ peerKey, conversationId, coreKey });
    if (decisao.ok !== true) return { code: decisao.code };

    ligarReplicacao(peerKeyHex, conversationId);
    const resposta: Record<string, unknown> = { dmVersion: DM_VERSION, state: decisao.state };
    if (decisao.selfCoreKey !== null) {
      resposta['coreKey'] = b64(decisao.selfCoreKey);
      resposta['coreProof'] = b64(provaDeCorePropria(conversationKey, decisao.selfCoreKey));
    }
    return json(resposta);
  };

  /** O lado que **chama**. Só chama quem tem core; ver `meuHello`. */
  const chamarHello = async (canal: Canal): Promise<void> => {
    const corpo = meuHello(canal.conversationId);
    if (corpo === null) return;
    const r = await canal.client.call('dmHello', json(corpo));
    if (r.ok !== true) {
      // §31.13 — `unauthorized` **não é distinguível de bloqueio, por desenho** (§31.9
      // regra 2). O evento diz o estado, nunca a causa.
      emitir('dm.sync', { conversationId: canal.conversationId, state: 'unauthorized', lag: 0 });
      return;
    }
    const res = parse(r.body);
    if (res === null || res['dmVersion'] !== DM_VERSION) return;

    const coreKey = unb64(res['coreKey']);
    const coreProof = unb64(res['coreProof']);
    const conversationKey = Buffer.from(canal.conversationId, 'hex');
    if (coreKey !== null && coreProof !== null) {
      const peerKey = Buffer.from(canal.peerKeyHex, 'hex');
      if (!provaConfere({ conversationKey, coreKey, coreProof, peerKey })) return;
      const decisao = await deps.dm.receberHello({
        peerKey,
        conversationId: canal.conversationId,
        coreKey,
      });
      if (decisao.ok !== true) return;
    }
    canal.apresentado = true;
    ligarReplicacao(canal.peerKeyHex, canal.conversationId);
  };

  // ── §31.13 — os dois cores no mesmo mux ────────────────────────────────────────────

  /**
   * "Registrar um core num mux é **uma** operação por `(mux, core)` — o `attachTo` do
   * hypercore não é idempotente. Mesma lição de §13.4."
   *
   * E antes de registrar, §31.8(4): `autorizaDm`. Sem ele, quem obtivesse a `dmPk` — que
   * trafega no handshake e fica em claro no manifesto — replicaria o core alheio.
   */
  const ligarReplicacao = (peerKeyHex: string, conversationId: string): void => {
    const canal = canais.get(conversationId);
    if (canal === undefined) return;
    if (!deps.dm.autorizaDm(Buffer.from(peerKeyHex, 'hex'), conversationId)) {
      fecharCanal(conversationId);
      return;
    }
    const row = deps.dm.conversa(conversationId);
    if (row === null) return;

    const stream = canal.stream;
    const jaLigado = replicando.get(stream) ?? new Set<string>();
    replicando.set(stream, jaLigado);

    const meu = deps.dm.coreDe(conversationId);
    const dele = deps.dm.coreDoPar(conversationId);

    const ligar = (core: CoreHandle | null, baixar: () => void): void => {
      if (core === null) return;
      const chave = core.key.toString('hex');
      if (jaLigado.has(chave)) return;
      core.replicate?.(mux(stream));
      jaLigado.add(chave);
      baixar();
    };

    // O meu core eu **sirvo**; não há o que baixar dele.
    ligar(meu, () => {});
    ligar(dele, () => {
      if (dele === null) return;
      if (row.state === 'pending-in') {
        // §31.9 — em `pending-in` a replicação é **limitada**: no máximo
        // `P2P_DM_PENDING_MAX_RECORDS` registros do core dele. Um pedido não aceito não paga
        // o disco de uma conversa inteira.
        void dele.downloadRange?.(0, P2P_DM_PENDING_MAX_RECORDS - 1);
        return;
      }
      // §14.2 — replicar o canal não baixa bloco nenhum por si só.
      dele.download?.();
    });

    emitir('dm.sync', { conversationId, state: 'catching-up', lag: 0 });
  };

  const mux = (stream: object): unknown => {
    const existente = muxes.get(stream);
    if (existente !== undefined) return existente;
    const novo = muxOf(stream as never);
    muxes.set(stream, novo);
    return novo;
  };

  // ── Uma conexão chegou ─────────────────────────────────────────────────────────────

  const avaliar = (conn: SwarmConnection): void => {
    if (parado) return;
    const conversationId = idDoPar(conn.remotePublicKeyHex);
    // `null` só acontece quando a `remotePublicKey` é a minha própria — `lo = hi` não é
    // conversa (§31.2 regra 5).
    if (conversationId === null) return;
    if (canais.has(conversationId)) return;

    const row = deps.dm.conversa(conversationId);
    // §31.9 regra 2 — bloqueado: recuso o canal e não conecto, **silenciosamente**.
    if (row?.state === 'blocked' || row?.state === 'left') return;

    // §31.18 — a coluna que se aplica, escolhida por conexão. Um par que nunca falou comigo
    // paga o teto do desconhecido, mesmo que já tenha um pedido pendente aqui.
    const parAceito = aceito(row);
    const maxFrameBytes = parAceito ? RPC_FRAME_MAX_BYTES_DM_ACCEPTED : RPC_FRAME_MAX_BYTES.dm;
    const limitador = parAceito ? limiteAceito : limiteDesconhecido;

    const transport = protomuxChannelTransport(mux(conn.stream as unknown as object) as never, {
      protocol: 'dm',
      // A chave do canal é o `conversationId`: dois canais `p2p-dm/1` na mesma conexão são
      // impossíveis (há uma conversa por par, §31.2 regra 3), mas a chave é a que identifica
      // o assunto, como o `coreKey` faz em `p2p-community/1`.
      id: Buffer.from(conversationId, 'hex'),
      maxFrameBytes,
      onClose: () => {
        canais.delete(conversationId);
        typingDoPar.delete(conversationId);
      },
    });
    if (transport === null) return;

    // §14.4, ordem 2 → 3: o bucket **antes** do decode. Quadro limitado não existe para nós.
    //
    // O limitador é consultado **uma vez por quadro**, não uma vez por assinante: neste canal
    // há dois (o `RpcServer` e o `RpcClient`, porque `p2p-dm/1` é simétrico), e envolver cada
    // assinatura no `check` cobraria dois tokens pelo mesmo quadro — o teto de 10 req/60 s de
    // §31.18 viraria 5 sem que nada no código dissesse isso.
    const ouvintes = new Set<(raw: Uint8Array) => void>();
    transport.onFrame((raw) => {
      if (!limitador.check(conn.remotePublicKeyHex, conn.remoteAddress).allowed) return;
      for (const cb of [...ouvintes]) cb(raw);
    });
    const comLimite = {
      send: (frame: Uint8Array) => transport.send(frame),
      onFrame: (cb: (raw: Uint8Array) => void) => {
        ouvintes.add(cb);
      },
      onDown: (cb: () => void) => transport.onDown(cb),
    };

    const server = new RpcServer({ protocol: 'dm', transport: comLimite, maxFrameBytes });
    server.register('dmHello', (body) => responderHello(conn.remotePublicKeyHex, body));

    const client = new RpcClient({
      protocol: 'dm',
      transport: comLimite,
      role: parAceito ? 'member' : 'pre-member',
      maxFrameBytes,
    });
    client.onNotify((topic, body) => {
      if (topic !== 'dm.typing') return;
      const p = parse(body);
      const on = p?.['on'] === true;
      // Efêmero, corrigido por TTL, at-most-once (**L-13**): nada disto é persistido, e uma
      // perda se conserta sozinha em 5 s.
      if (on) typingDoPar.set(conversationId, agora() + DM_TYPING_TTL_MS);
      else typingDoPar.delete(conversationId);
      emitir('dm.typing', { conversationId, on });
    });

    const canal: Canal = {
      conversationId,
      peerKeyHex: conn.remotePublicKeyHex,
      stream: conn.stream as unknown as object,
      transport,
      server,
      client,
      apresentado: false,
    };
    canais.set(conversationId, canal);
    void chamarHello(canal);
  };

  // ── §31.8 — `dm.typing` ────────────────────────────────────────────────────────────

  const setTyping = (conversationId: string, on: boolean): { ok: true } | { ok: false; code: string } => {
    const canal = canais.get(conversationId);
    // Nunca enfileira (§31.16.1): sem canal, a notificação simplesmente não acontece.
    if (canal === undefined) return { ok: true };
    const ultimo = typingMeu.get(conversationId);
    const now = agora();
    if (on && ultimo !== undefined && now - ultimo < DM_TYPING_RATE_MS) {
      return { ok: false, code: 'E_RATE_LIMITED' };
    }
    if (on) typingMeu.set(conversationId, now);
    else typingMeu.delete(conversationId);
    canal.server.notify('dm.typing', json({ on }));
    return { ok: true };
  };

  // ── Ciclo de vida ──────────────────────────────────────────────────────────────────

  const backend = deps.swarm.backend;
  const off =
    backend?.onConnection((conn) => {
      vivas.add(conn);
      avaliar(conn);
    }) ?? null;

  refresh();

  return {
    refresh,
    setTyping,
    typingDoPar(conversationId: string): boolean {
      const ate = typingDoPar.get(conversationId);
      if (ate === undefined) return false;
      if (ate <= agora()) {
        typingDoPar.delete(conversationId);
        return false;
      }
      return true;
    },
    channelCount(): number {
      return canais.size;
    },
    async stop(): Promise<void> {
      parado = true;
      off?.();
      for (const id of [...canais.keys()]) fecharCanal(id);
      vivas.clear();
      muxes.clear();
      await Promise.resolve();
    },
  };
}
