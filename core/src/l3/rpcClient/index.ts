// `rpcClient` — L3. Lado cliente do transporte RPC P2P (§16, §4: "Transporte e tradução de
// erro"). É a implementação da porta que a `outbox` declara (§4: "porta de cliente RPC,
// implementada por rpcClient").
//
// Contrato de §16.1 aplicado aqui:
//   - timeout de request: 15 000 ms membro / 10 000 ms pré-membro (redeem usa 30 000 ms);
//   - requests em voo: orçamento de 8 membro / 2 pré-membro — chamadas além do orçamento
//     esperam em fila (backpressure), não há código de recusa catalogado para isso;
//   - frame máximo antes do envio: 64 KiB / 4 KiB — acima disso a chamada falha localmente
//     com `E_PAYLOAD_TOO_LARGE`, sem tocar a rede;
//   - reconexão: a conexão caiu → requests em voo falham com `E_HOST_UNAVAILABLE` e voltam
//     à outbox (§11.6); o mesmo código cobre timeout sem resposta.
//
// Só `{code}` do catálogo de §20.2 cruza a fronteira — nunca texto de domínio (§3.4).

export type RpcProtocolName = 'community' | 'admission';

/**
 * Transcrição local dos tetos de §16.1 e da tabela fechada de métodos de §16.2 — igual à
 * cópia canônica em `rpcServer`. As duas tabelas NÃO podem divergir: a paridade é conferida
 * por teste (`integracao.test.ts`). A duplicação existe porque §4 não declara importação
 * lateral entre módulos de L3 e a barreira quebra o build.
 */
const PROTOCOL_TABLE: Record<RpcProtocolName, { frameMaxBytes: number; methods: ReadonlySet<string> }> = {
  community: {
    frameMaxBytes: 64 * 1024,
    methods: new Set([
      'hello',
      'submitOp',
      'submitOps',
      'voiceJoin',
      'voiceLeave',
      'voiceState',
      'voiceTicket',
      'voiceMute',
      'voiceSignal',
      // §16.4 (emenda de 2026-08-28) — a fila de karaokê do modo fila.
      'voiceQueueJoin',
      'voiceQueueLeave',
      'voiceQueueModerate',
      'shareStart',
      'shareJoin',
      'shareLeave',
      'shareQuality',
      'shareReport',
      'presencePublish',
      'subscribeChannel',
    ]),
  },
  admission: {
    frameMaxBytes: 4 * 1024,
    methods: new Set(['admissionHello', 'inviteResolve', 'inviteRedeem']),
  },
};

export const PROTOCOL_PARITY_SOURCE = PROTOCOL_TABLE;

/**
 * §16.3 — notificações que o host empurra. Cópia da tabela de `rpcServer`, pela mesma razão
 * de §4 que duplica a tabela de métodos; a paridade é conferida por teste. Tópico fora dela
 * é **descartado em silêncio**: um host mais novo pode empurrar o que este cliente não
 * entende, e isso nunca pode derrubar a conexão.
 */
export const RPC_NOTIFICATIONS: ReadonlySet<string> = new Set([
  'voice.roster',
  'voice.revoked',
  /** §19.8/§15.5, emenda de 2026-08-26 — o encerramento nomeado da sessão inteira. */
  'voice.failed',
  'voice.signal',
  'share.started',
  'share.stopped',
  'share.viewersChanged',
  /** §15.5, emenda de 2026-08-26 — a revogação de UM espectador (§17.5). */
  'share.failed',
  'share.health',
  /** §15.5/§17.6, emenda de 2026-08-26 — a ocupação do canal, a todos os membros conectados. */
  'voice.occupancyChanged',
  // §16.4 (emenda de 2026-08-28) — a fila de karaokê mudou; nível, não sequência.
  'voice.queueChanged',
  'presence.changed',
  'typing.changed',
]);


/** Porta de transporte bidirecional por mensagens — mesma forma do lado servidor. */
export interface RpcTransportPort {
  send(frame: Uint8Array): void;
  onFrame(cb: (frame: Uint8Array) => void): void;
  onDown(cb: () => void): void;
}

export const RPC_TIMEOUT_MEMBER_MS = 15_000;
export const RPC_TIMEOUT_PRE_MEMBER_MS = 10_000;
export const RPC_TIMEOUT_REDEEM_MS = 30_000;
const IN_FLIGHT: Record<RpcProtocolName, { member: number; preMember: number }> = {
  community: { member: 8, preMember: 2 },
  admission: { member: 2, preMember: 2 },
};

export type RpcRole = 'member' | 'pre-member';

export type RpcCallOk = { readonly ok: true; readonly body: Uint8Array };
export type RpcCallErr = { readonly ok: false; readonly code: string };
export type RpcCallResult = RpcCallOk | RpcCallErr;

type Pending = {
  resolve: (result: RpcCallResult) => void;
  timer: NodeJS.Timeout;
};

function encodeRequest(id: number, method: string, body: Uint8Array): Uint8Array {
  const frame: { i: number; m: string; b?: string } = { i: id, m: method };
  if (body.length > 0) frame.b = Buffer.from(body).toString('base64');
  return Buffer.from(JSON.stringify(frame), 'utf8');
}

/**
 * Cliente RPC por conexão. Uma instância por par/protocolo; quando a conexão cai, os
 * pedidos em voo falham e uma nova instância (ou `reattach`) retoma na próxima conexão —
 * nada é reenviado automaticamente (§16.1), quem decide reenvio é a outbox (§11.6).
 */
export class RpcClient {
  readonly #protocol: RpcProtocolName;
  #transport: RpcTransportPort | null;
  #role: RpcRole;
  readonly #pending = new Map<number, Pending>();
  readonly #notifyListeners = new Set<(topic: string, body: Uint8Array) => void>();
  readonly #queue: Array<{
    method: string;
    body: Uint8Array;
    timeoutMs?: number;
    resolve: (result: RpcCallResult) => void;
  }> = [];
  #nextId = 1;

  constructor(opts: { protocol: RpcProtocolName; transport: RpcTransportPort | null; role?: RpcRole }) {
    this.#protocol = opts.protocol;
    this.#transport = opts.transport;
    this.#role = opts.role ?? 'member';
    if (opts.transport !== null) this.#wire(opts.transport);
  }

  get role(): RpcRole {
    return this.#role;
  }

  setRole(role: RpcRole): void {
    this.#role = role;
    this.#pump();
  }

  get inFlight(): number {
    return this.#pending.size;
  }

  get queued(): number {
    return this.#queue.length;
  }

  /** Nova conexão para o mesmo par — os pendentes antigos já foram rejeitados no down. */
  reattach(transport: RpcTransportPort): void {
    this.#transport = transport;
    this.#wire(transport);
    this.#pump();
  }

  detach(): void {
    this.failPending('E_HOST_UNAVAILABLE');
    this.#transport = null;
  }

  call(method: string, body: Uint8Array, opts?: { timeoutMs?: number }): Promise<RpcCallResult> {
    return new Promise((resolve) => {
      // Teto de frame ANTES do envio (§16.1) — falha local, rede nem vê.
      if (body.byteLength > PROTOCOL_TABLE[this.#protocol].frameMaxBytes) {
        resolve({ ok: false, code: 'E_PAYLOAD_TOO_LARGE' });
        return;
      }
      if (!PROTOCOL_TABLE[this.#protocol].methods.has(method)) {
        resolve({ ok: false, code: 'E_UNKNOWN_COMMAND' });
        return;
      }
      // Sem transporte não há fila que ajude: §16.1 manda o pedido de volta à outbox, e é
      // ela que retenta com backoff — não este cliente.
      if (this.#transport === null) {
        resolve({ ok: false, code: 'E_HOST_UNAVAILABLE' });
        return;
      }
      this.#queue.push({ method, body, ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}), resolve });
      this.#pump();
    });
  }

  /**
   * §16.3 — notificações empurradas pelo host. Sem ACK e sem retentativa: quem consome trata
   * como sinal (§15.1 regra 5), nunca como fonte de verdade.
   */
  onNotify(cb: (topic: string, body: Uint8Array) => void): () => void {
    this.#notifyListeners.add(cb);
    return () => this.#notifyListeners.delete(cb);
  }

  /** Falha tudo que está em voo e na fila — queda de conexão ou desanexo (§16.1). */
  failPending(code: string = 'E_HOST_UNAVAILABLE'): void {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, code });
    }
    this.#pending.clear();
    for (const item of this.#queue.splice(0)) item.resolve({ ok: false, code });
  }

  #wire(transport: RpcTransportPort): void {
    transport.onFrame((raw) => this.#handleFrame(raw));
    transport.onDown(() => {
      // §16.1 — requests em voo falham com `E_HOST_UNAVAILABLE` e voltam à outbox. O
      // transporte que caiu também DEIXA de ser o destino: sem isto, o que chegava depois
      // da queda entrava na fila para um cabo morto — o `send` descartava em silêncio e o
      // pedido esperava os 15 s do teto para só então devolver o mesmo erro. Um blip de
      // rede vira 15 s de chamada zumbi, e no modo membro é `voice.failed` espúrio.
      this.#transport = null;
      this.failPending('E_HOST_UNAVAILABLE');
    });
  }

  #handleFrame(raw: Uint8Array): void {
    let res: { i?: number; n?: string; ok?: boolean; b?: string; e?: string };
    try {
      res = JSON.parse(Buffer.from(raw).toString('utf8')) as typeof res;
    } catch {
      return; // quadro estranho na condução nunca derruba o cliente
    }
    if (typeof res.n === 'string') {
      // §16.3 — tópico desconhecido é descartado sem erro (compatibilidade para a frente).
      if (!RPC_NOTIFICATIONS.has(res.n)) return;
      const body = new Uint8Array(Buffer.from(res.b ?? '', 'base64'));
      for (const cb of this.#notifyListeners) cb(res.n, body);
      return;
    }
    if (typeof res.i !== 'number') return;
    const pending = this.#pending.get(res.i);
    if (pending === undefined) return;
    this.#pending.delete(res.i);
    clearTimeout(pending.timer);
    if (res.ok === true) {
      pending.resolve({ ok: true, body: new Uint8Array(Buffer.from(res.b ?? '', 'base64')) });
    } else {
      pending.resolve({ ok: false, code: typeof res.e === 'string' ? res.e : 'E_INTERNAL' });
    }
    this.#pump();
  }

  #pump(): void {
    if (this.#transport === null) return;
    const budget = IN_FLIGHT[this.#protocol][this.#role === 'member' ? 'member' : 'preMember'];
    while (this.#pending.size < budget && this.#queue.length > 0) {
      const item = this.#queue.shift()!;
      const id = this.#nextId++;
      const timeoutMs =
        item.timeoutMs ?? (this.#role === 'member' ? RPC_TIMEOUT_MEMBER_MS : RPC_TIMEOUT_PRE_MEMBER_MS);
      const timer = setTimeout(() => {
        // host não respondeu dentro do contrato — indistinguível de indisponível
        if (this.#pending.delete(id)) item.resolve({ ok: false, code: 'E_HOST_UNAVAILABLE' });
        this.#pump();
      }, timeoutMs);
      this.#pending.set(id, { resolve: item.resolve, timer });
      this.#transport.send(encodeRequest(id, item.method, item.body));
    }
  }
}
