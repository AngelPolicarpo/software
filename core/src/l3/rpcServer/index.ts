// `rpcServer` — L3. Lado host do transporte RPC P2P (§16, §4: "Transporte e tradução de erro").
//
// §4: L3, depende de L2; não contém regra de negócio — cada método é um handler registrado
// pela composição, que aponta para os módulos de L2 (`communityHost`, `voiceCoordinator`,
// `shareStar`, `presence`). A socket real (protomux-rpc sobre Hyperswarm, §16.1) entra pela
// porta `RpcTransportPort` injetada no boot; este módulo nunca importa transporte.
//
// Contrato de §16.1 aplicado aqui:
//   - dois protocolos com tetos próprios — `p2p-community/1` (frame 64 KiB) e
//     `p2p-admission/1` (frame 4 KiB), medidos **antes** do decode;
//   - frame acima do teto → `E_PAYLOAD_TOO_LARGE`; bytes que não decodificam → `E_MALFORMED`;
//   - método fora da tabela de §16.2 → `E_UNKNOWN_COMMAND`;
//   - handler que recusa lança erro com `.code` do catálogo de §20.2 — só o código cruza a
//     fronteira, jamais texto de domínio (§3.4 regra 2).

export type RpcProtocolName = 'community' | 'admission';

export const RPC_PROTOCOL_ID: Record<RpcProtocolName, string> = {
  community: 'p2p-community/1',
  admission: 'p2p-admission/1',
};

/** Teto de frame antes do decode (§16.1): 64 KiB membro / 4 KiB pré-membro-admission. */
export const RPC_FRAME_MAX_BYTES: Record<RpcProtocolName, number> = {
  community: 64 * 1024,
  admission: 4 * 1024,
};

/** Métodos da tabela de §16.2, fechados por protocolo. */
export const RPC_METHODS: Record<RpcProtocolName, ReadonlySet<string>> = {
  community: new Set([
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
  admission: new Set(['admissionHello', 'inviteResolve', 'inviteRedeem']),
};

/**
 * Porta de transporte bidirecional por mensagens — implementada por L3/composição sobre o
 * stream do Hyperswarm (protomux-rpc). Uma instância por conexão.
 */
export interface RpcTransportPort {
  send(frame: Uint8Array): void;
  onFrame(cb: (frame: Uint8Array) => void): void;
  /** A conexão caiu — o servidor para de responder nela. */
  onDown(cb: () => void): void;
}

export type RpcMethodHandler = (
  body: Uint8Array,
) => Promise<Uint8Array | { readonly code: string }> | Uint8Array | { readonly code: string };

type ReqFrame = { i: number; m: string; b?: string };
type ResFrame = { i: number; ok: true; b?: string } | { i: number; ok: false; e: string };

function encodeRequest(id: number, method: string, body: Uint8Array): Uint8Array {
  const frame: ReqFrame = { i: id, m: method };
  if (body.length > 0) frame.b = Buffer.from(body).toString('base64');
  return Buffer.from(JSON.stringify(frame), 'utf8');
}

function decodeResponse(raw: Uint8Array): ResFrame | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as ResFrame;
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.i !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export class RpcServer {
  readonly #protocol: RpcProtocolName;
  readonly #transport: RpcTransportPort;
  readonly #handlers = new Map<string, RpcMethodHandler>();
  #down = false;

  constructor(opts: { protocol: RpcProtocolName; transport: RpcTransportPort }) {
    this.#protocol = opts.protocol;
    this.#transport = opts.transport;
    opts.transport.onFrame((raw) => void this.#handle(raw));
    opts.transport.onDown(() => {
      this.#down = true;
      this.#handlers.clear();
    });
  }

  get isDown(): boolean {
    return this.#down;
  }

  register(method: string, handler: RpcMethodHandler): void {
    if (!RPC_METHODS[this.#protocol].has(method)) {
      throw new Error(`método '${method}' fora da tabela de §16.2 para ${RPC_PROTOCOL_ID[this.#protocol]}`);
    }
    this.#handlers.set(method, handler);
  }

  async #handle(raw: Uint8Array): Promise<void> {
    // Teto ANTES do decode (§16.1). Sem id correlacionável não há resposta possível — cai.
    if (raw.byteLength > RPC_FRAME_MAX_BYTES[this.#protocol]) return;
    let req: ReqFrame;
    try {
      req = JSON.parse(Buffer.from(raw).toString('utf8')) as ReqFrame;
    } catch {
      return;
    }
    if (typeof req !== 'object' || req === null || typeof req.i !== 'number' || typeof req.m !== 'string') {
      return;
    }
    const handler = this.#handlers.get(req.m);
    if (handler === undefined) {
      this.#reply({ i: req.i, ok: false, e: 'E_UNKNOWN_COMMAND' });
      return;
    }
    const body = Buffer.from(req.b ?? '', 'base64');
    try {
      const result = await handler(new Uint8Array(body));
      if (!Buffer.isBuffer(result) && !(result instanceof Uint8Array)) {
        // recusa nomeada do domínio: {code} do catálogo §20.2
        const code = typeof (result as { code?: string }).code === 'string' ? (result as { code: string }).code : 'E_INTERNAL';
        this.#reply({ i: req.i, ok: false, e: code });
        return;
      }
      const res: ResFrame = { i: req.i, ok: true };
      if (result.byteLength > 0) res.b = Buffer.from(result).toString('base64');
      this.#reply(res);
    } catch (err) {
      const code = (err as { code?: string }).code;
      this.#reply({ i: req.i, ok: false, e: typeof code === 'string' ? code : 'E_INTERNAL' });
    }
  }

  #reply(frame: ResFrame): void {
    if (!this.#down) this.#transport.send(Buffer.from(JSON.stringify(frame), 'utf8'));
  }
}

export { encodeRequest as rpcEncodeRequest, decodeResponse as rpcDecodeResponse };
