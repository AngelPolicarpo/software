// Proxy que perde ACKs — o cenário "ACK perdido com append durável" de POC-07.
//
// Fica entre cliente e host, repassa as requisições **intactas** e descarta uma fração das
// respostas. É a única forma honesta de produzir a situação que a hipótese interroga: o host
// appendou de verdade, o registro está durável, e o cliente não tem como saber. Simular
// perdendo do lado do host mediria outra coisa — mediria um host que não responde, e um host
// que não responde pode não ter appendado.
//
// A perda é na **resposta**, nunca na requisição: perder a requisição é o caso trivial (nada
// foi appendado, o retry resolve) e já está coberto pelo cenário de host offline.

import net from 'node:net';

import { unframe, type Bytes } from '../host/server.ts';

export type Proxy = {
  readonly port: number;
  /** Quantas respostas foram descartadas até agora. */
  readonly descartadas: () => number;
  /** Liga/desliga o descarte em tempo de execução. */
  setDropRate(taxa: number): void;
  close(): Promise<void>;
};

export async function startAckDroppingProxy(opts: {
  alvoPort: number;
  /** Fração de respostas descartadas, 0 a 1. */
  dropRate?: number;
  rnd?: () => number;
}): Promise<Proxy> {
  let taxa = opts.dropRate ?? 0;
  const rnd = opts.rnd ?? Math.random;
  let descartadas = 0;

  const server = net.createServer((cliente) => {
    cliente.setNoDelay(true);
    const upstream = net.connect({ port: opts.alvoPort, host: '127.0.0.1' });
    upstream.setNoDelay(true);

    // Requisição: repassa byte a byte, sem tocar.
    cliente.on('data', (c) => {
      if (!upstream.destroyed) upstream.write(c);
    });

    // Resposta: desmonta em quadros para poder descartar **um ACK inteiro**, e não um pedaço
    // dele — meio quadro dessincronizaria o fluxo e mediria corrupção de transporte.
    let rest: Bytes = Buffer.alloc(0);
    upstream.on('data', (c) => {
      rest = unframe(Buffer.concat([rest, c]), (msg) => {
        if (rnd() < taxa) {
          descartadas++;
          return;
        }
        if (!cliente.destroyed) {
          const body = Buffer.from(JSON.stringify(msg), 'utf8');
          const head = Buffer.allocUnsafe(4);
          head.writeUInt32BE(body.length, 0);
          cliente.write(Buffer.concat([head, body]));
        }
      });
    });

    const fecha = (): void => {
      cliente.destroy();
      upstream.destroy();
    };
    cliente.on('error', fecha);
    upstream.on('error', fecha);
    cliente.on('close', fecha);
    upstream.on('close', fecha);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    port: typeof addr === 'object' && addr !== null ? addr.port : 0,
    descartadas: () => descartadas,
    setDropRate: (t) => {
      taxa = t;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
