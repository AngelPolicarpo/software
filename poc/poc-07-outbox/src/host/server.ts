// Transporte do host — §16.1 reduzido ao que G4 precisa.
//
// TCP em loopback com quadro de 4 bytes big-endian + JSON. **Não** é o RPC de produção
// (Noise sobre `hyperdht`, §16.1): o que este gate mede é durabilidade e idempotência do
// caminho de escrita, e trocar o transporte não move nenhum critério. O que o transporte
// precisa dar, e dá, é: processos separados de verdade, entrega ordenada por conexão, e um
// ponto onde o proxy do harness possa **perder o ACK** sem que o host saiba.

import net from 'node:net';

import { Admission, type SubmitResult } from './admission.ts';
import { SUBMIT_BATCH_MAX } from '../protocol/constants.ts';

export type Req =
  | { readonly id: number; readonly m: 'submitOp'; readonly envelope: string }
  | { readonly id: number; readonly m: 'submitOps'; readonly envelopes: readonly string[] }
  | { readonly id: number; readonly m: 'status' }
  /** Leitura do log pela réplica — ver o cabeçalho de `LogSource` em `client/replica.ts`. */
  | { readonly id: number; readonly m: 'pull'; readonly from: number; readonly max: number };

export type Res =
  | { readonly id: number; readonly r: SubmitResult }
  | { readonly id: number; readonly rs: readonly (SubmitResult | { ok: false; code: 'E_NOT_ATTEMPTED' })[] }
  | { readonly id: number; readonly status: { length: number; admitidos: number; metrics: Record<string, number> } }
  | { readonly id: number; readonly blocks: readonly string[]; readonly length: number };

/** Modos adversários de §28.5 — o host modificado que o cliente precisa sobreviver. */
export type AdversaryMode =
  /** Confirma `{seq}` que nunca aparece no log. §11.6 tem de virar `ackMismatch`. */
  | 'ack-without-append'
  /** Nunca responde: o item fica em `sending` até o boot seguinte reconciliar. */
  | 'silent'
  | 'none';

/**
 * `Buffer` sem fixar o backing store: `subarray` devolve `Buffer<ArrayBufferLike>` e
 * `concat` devolve `Buffer<ArrayBuffer>`. Fixar um dos dois faria o desmembramento de quadro
 * não tipar, e o `any` esconderia erro de fatiamento — que é a família de bug mais provável
 * num decodificador de fluxo.
 */
export type Bytes = Buffer<ArrayBufferLike>;

export function frame(obj: unknown): Bytes {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.allocUnsafe(4);
  head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

/** Desmonta o fluxo em mensagens. Devolve o resto que ainda não completou um quadro. */
export function unframe(buf: Bytes, onMessage: (m: unknown) => void): Bytes {
  let b: Bytes = buf;
  for (;;) {
    if (b.length < 4) return b;
    const len = b.readUInt32BE(0);
    if (b.length < 4 + len) return b;
    const body = b.subarray(4, 4 + len);
    b = b.subarray(4 + len);
    try {
      onMessage(JSON.parse(body.toString('utf8')));
    } catch {
      /* quadro corrompido: ignora, como o transporte real faria */
    }
  }
}

export type HostServer = {
  readonly port: number;
  close(): Promise<void>;
};

export async function startHostServer(
  admission: Admission,
  opts: {
    port?: number;
    adversary?: AdversaryMode;
    coreLength: () => number;
    readBlock: (seq: number) => Promise<Buffer | null>;
  },
): Promise<HostServer> {
  const adversary = opts.adversary ?? 'none';
  // O `seq` inventado é **plausível**: começa onde o log está. Um número absurdo (10^6) seria
  // um adversário ruim — §11.6 detecta o mismatch quando o log interpretado passa do
  // `acked_seq`, e um valor inalcançável só faria o item esperar para sempre. O host
  // interessante é o que mente de forma que o cliente **possa** desmentir.
  let fakeSeq = -1;

  const server = net.createServer((socket) => {
    socket.setNoDelay(true);
    let rest: Bytes = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      rest = unframe(Buffer.concat([rest, chunk]), (msg) => {
        void handle(msg as Req).then((res) => {
          if (res !== null && !socket.destroyed) socket.write(frame(res));
        });
      });
    });
    socket.on('error', () => socket.destroy());
  });

  async function handle(req: Req): Promise<Res | null> {
    if (req.m === 'status') {
      return {
        id: req.id,
        status: {
          length: opts.coreLength(),
          admitidos: admission.metrics.admitidos,
          // Métricas do group commit: é por elas que se prova que §11.5 está de fato agrupando.
          metrics: { ...admission.metrics } as unknown as Record<string, number>,
        },
      };
    }
    if (req.m === 'pull') {
      // A leitura do log **não** passa pelo modo adversário: o host que mente no ACK continua
      // servindo o log honestamente, e é exatamente essa combinação que produz o
      // `ackMismatch` de §11.6. Um host que também mentisse no log mediria outra coisa —
      // integridade de replicação, que é prova de Merkle e não é deste gate.
      const fim = Math.min(req.from + req.max, opts.coreLength());
      const blocks: string[] = [];
      for (let s = req.from; s < fim; s++) {
        const b = await opts.readBlock(s);
        if (b === null) break;
        blocks.push(b.toString('hex'));
      }
      return { id: req.id, blocks, length: opts.coreLength() };
    }
    if (adversary === 'silent') return null;
    if (req.m === 'submitOp') {
      if (adversary === 'ack-without-append') {
        // Confirma sem appendar: o `seq` é plausível e o log nunca o terá.
        if (fakeSeq < 0) fakeSeq = opts.coreLength();
        return { id: req.id, r: { ok: true, seq: fakeSeq++, hostTs: Date.now() } };
      }
      const r = await admission.submit(Buffer.from(req.envelope, 'hex'));
      return { id: req.id, r };
    }

    // §11.9 — um resultado por envelope, sempre os N representados.
    const envs = req.envelopes.slice(0, SUBMIT_BATCH_MAX);
    if (adversary === 'ack-without-append') {
      if (fakeSeq < 0) fakeSeq = opts.coreLength();
      return { id: req.id, rs: envs.map(() => ({ ok: true as const, seq: fakeSeq++, hostTs: Date.now() })) };
    }

    // As submissões são **iniciadas todas**, e só então esperadas.
    //
    // `await` uma a uma anularia §11.5: cada op esperaria o append do próprio grupo antes de
    // a seguinte sequer entrar na fila, e todo grupo teria tamanho 1 — o group commit deixaria
    // de existir sem que nada acusasse. A ordem não sofre: `admission.submit` encadeia na
    // seção crítica na ordem da chamada, e chamar em laço síncrono fixa essa ordem.
    const promessas = envs.map((hex) => admission.submit(Buffer.from(hex, 'hex')));
    const resolvidas = await Promise.all(promessas);
    const rs: (SubmitResult | { ok: false; code: 'E_NOT_ATTEMPTED' })[] = [];
    let interrompido = false;
    for (const r of resolvidas) {
      // Só erro de infraestrutura interrompe o lote (§11.9); daí em diante, `E_NOT_ATTEMPTED`.
      if (interrompido) {
        rs.push({ ok: false, code: 'E_NOT_ATTEMPTED' });
        continue;
      }
      rs.push(r);
      if (!r.ok && (r.code === 'E_STORAGE_FULL' || r.code === 'E_BUSY')) interrompido = true;
    }
    return { id: req.id, rs };
  }

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
