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
      'shareStart',
      'shareJoin',
      'shareLeave',
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
      this.#queue.push({ method, body, ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}), resolve });
      this.#pump();
    });
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
    transport.onDown(() => this.failPending('E_HOST_UNAVAILABLE'));
  }

  #handleFrame(raw: Uint8Array): void {
    let res: { i?: number; ok?: boolean; b?: string; e?: string };
    try {
      res = JSON.parse(Buffer.from(raw).toString('utf8')) as typeof res;
    } catch {
      return; // quadro estranho na condução nunca derruba o cliente
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
