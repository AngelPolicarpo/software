// Cliente do transporte. Conecta, envia quadro, resolve na resposta correspondente.
//
// `submit` devolve `null` para "não houve resposta" — que é o que o cliente **de verdade**
// enxerga quando o ACK se perde no caminho (proxy, queda de rede, host morto entre o append e
// a resposta). Essa indistinguibilidade é o ponto do gate: do lado do cliente, "o host não
// respondeu" e "o host appendou e o ACK sumiu" são o mesmo evento, e só a reconciliação
// contra a réplica os separa.

import net from 'node:net';

import { frame, unframe, type Bytes, type Req, type Res } from '../host/server.ts';

/**
 * `Omit` sobre união colapsa os membros num objeto só, e aí `envelope`/`from` deixam de
 * existir. A forma distributiva preserva a união — cada método continua com os campos dele.
 */
type SemId<T> = T extends { id: number } ? Omit<T, 'id'> : never;
type ReqSemId = SemId<Req>;

export type RpcOptions = {
  readonly port: number;
  readonly host?: string;
  /** Tempo máximo por chamada. Estourado, a chamada devolve `null`. */
  readonly timeoutMs?: number;
};

export class Rpc {
  readonly #opts: Required<RpcOptions>;
  #socket: net.Socket | null = null;
  #rest: Bytes = Buffer.alloc(0);
  #proximoId = 1;
  readonly #pendentes = new Map<number, (r: Res | null) => void>();

  constructor(opts: RpcOptions) {
    this.#opts = { host: '127.0.0.1', timeoutMs: 5000, ...opts };
  }

  async connect(): Promise<boolean> {
    if (this.#socket !== null && !this.#socket.destroyed) return true;
    return new Promise<boolean>((resolve) => {
      const s = net.connect({ port: this.#opts.port, host: this.#opts.host });
      s.setNoDelay(true);
      const falhou = (): void => {
        s.destroy();
        this.#socket = null;
        this.#rejeitaTudo();
        resolve(false);
      };
      s.once('error', falhou);
      s.once('connect', () => {
        s.removeListener('error', falhou);
        s.on('error', () => {
          this.#socket = null;
          this.#rejeitaTudo();
        });
        s.on('close', () => {
          this.#socket = null;
          this.#rejeitaTudo();
        });
        s.on('data', (chunk) => {
          this.#rest = unframe(Buffer.concat([this.#rest, chunk]), (m) => {
            const res = m as Res;
            const cb = this.#pendentes.get(res.id);
            if (cb !== undefined) {
              this.#pendentes.delete(res.id);
              cb(res);
            }
          });
        });
        this.#socket = s;
        resolve(true);
      });
    });
  }

  #rejeitaTudo(): void {
    for (const [, cb] of this.#pendentes) cb(null);
    this.#pendentes.clear();
  }

  async #call(req: ReqSemId): Promise<Res | null> {
    if (!(await this.connect())) return null;
    const s = this.#socket;
    if (s === null) return null;
    const id = this.#proximoId++;
    return new Promise<Res | null>((resolve) => {
      const timer = setTimeout(() => {
        this.#pendentes.delete(id);
        resolve(null);
      }, this.#opts.timeoutMs);
      timer.unref?.();
      this.#pendentes.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      s.write(frame({ ...req, id } as Req));
    });
  }

  async submit(envelope: Buffer): Promise<{ ok: true; seq: number } | { ok: false; code: string } | null> {
    const res = await this.#call({ m: 'submitOp', envelope: envelope.toString('hex') });
    if (res === null || !('r' in res)) return null;
    return res.r.ok ? { ok: true, seq: res.r.seq } : { ok: false, code: res.r.code };
  }

  /** §11.9 — `submitOps{envelopes[≤32]}`, com um resultado por envelope. */
  async submitBatch(
    envelopes: readonly Buffer[],
  ): Promise<readonly ({ ok: true; seq: number } | { ok: false; code: string })[] | null> {
    if (envelopes.length === 0) return [];
    const res = await this.#call({ m: 'submitOps', envelopes: envelopes.map((e) => e.toString('hex')) });
    if (res === null || !('rs' in res)) return null;
    return res.rs.map((r) => (r.ok ? { ok: true as const, seq: r.seq } : { ok: false as const, code: r.code }));
  }

  async status(): Promise<{ length: number; admitidos: number; metrics: Record<string, number> } | null> {
    const res = await this.#call({ m: 'status' });
    return res !== null && 'status' in res ? res.status : null;
  }

  /** `LogSource` de §10.5 sobre o transporte — ver o cabeçalho em `client/replica.ts`. */
  logSource(): { length(): Promise<number>; get(seq: number): Promise<Buffer | null> } {
    // Cache de bloco: `catchUp` pede seq a seq, e uma ida ao host por bloco tornaria a
    // projeção de 100 000 registros dominada por round-trip, não por I/O de banco — que é o
    // que o gate quer medir.
    let base = -1;
    let janela: Buffer[] = [];
    const puxa = async (from: number): Promise<number> => {
      const res = await this.#call({ m: 'pull', from, max: 512 });
      if (res === null || !('blocks' in res)) return 0;
      base = from;
      janela = res.blocks.map((h) => Buffer.from(h, 'hex'));
      return res.length;
    };
    return {
      length: async () => {
        const s = await this.status();
        return s?.length ?? 0;
      },
      get: async (seq) => {
        if (base >= 0 && seq >= base && seq < base + janela.length) return janela[seq - base] ?? null;
        await puxa(seq);
        if (seq >= base && seq < base + janela.length) return janela[seq - base] ?? null;
        return null;
      },
    };
  }

  close(): void {
    this.#socket?.destroy();
    this.#socket = null;
  }
}
