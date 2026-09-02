/**
 * Cabo de rede da conversa direta (§31.8) — **`Protomux` de verdade**, DHT nenhuma.
 *
 * O que se quer medir aqui é o handshake e os tetos, não a descoberta: a DHT tem cabo próprio
 * em `transport.test.ts`, e trocá-la por um par de streams não muda nada do que §31.8 decide —
 * a `remotePublicKey` chega igualmente autenticada, porque quem a declara é o cabo, e no
 * produto é o Noise. O que **não** se pode falsear é o `Protomux`: o canal simétrico de
 * `p2p-dm/1` é a única coisa em §16.1 que não tem precedente, e um canal de mentira provaria
 * o cabo, não o protocolo.
 *
 * O `manifest.db` é real, em arquivo. As derivações e os registros são os de produto.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sodium from 'sodium-native';
import SecretStream from '@hyperswarm/secret-stream';
import { Duplex } from 'streamx';

import type { CoreHandle, WritableCoreHandle } from '../../src/l0/corestore/index.ts';
import { openManifestDb, type ManifestDb } from '../../src/l0/manifest/index.ts';
import type { SwarmBackendPort, SwarmConnection } from '../../src/l0/swarm/ports.ts';
import { Swarm } from '../../src/l0/swarm/index.ts';
import {
  DM_KINDS,
  DM_VERSION,
  dmContentKey,
  dmConversationKey,
  dmCorePossessionHash,
  dmOpSigningHash,
  encodeDmEnvelope,
  encodeDmOp,
  encodeDmPayload,
  sealDmPayload,
  type DmHeader,
} from '../../src/l1/dmCodec/index.ts';
import { DirectMessages, type DmCorePort, type DmCriptoPort } from '../../src/l2/directMessages/index.ts';
import { startDmTransport, type DmTransport } from '../../src/composition/dm.ts';

import { dmKeypair, type Keypair } from './dm.ts';

const TEMPS: string[] = [];

export function limparTemps(): void {
  for (const d of TEMPS) fs.rmSync(d, { recursive: true, force: true });
  TEMPS.length = 0;
}

function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-rede-'));
  TEMPS.push(d);
  return d;
}

/** Core em memória que conta `replicate` — é o que mede "uma vez por `(mux, core)`" (§31.13). */
export class CoreDeRede implements WritableCoreHandle {
  readonly key: Buffer;
  readonly blocos: Uint8Array[] = [];
  readonly #ouvintes = new Set<() => void>();
  /** Cada `replicate` visto, na ordem. Duplicata aqui é o defeito que §31.13 nomeia. */
  readonly replicacoes: unknown[] = [];
  readonly downloads: string[] = [];

  constructor(key: Buffer) {
    this.key = key;
  }

  get length(): number {
    return this.blocos.length;
  }

  get(seq: number): Promise<Uint8Array | null> {
    return Promise.resolve(this.blocos[seq] ?? null);
  }

  onAppend(l: () => void): () => void {
    this.#ouvintes.add(l);
    return () => this.#ouvintes.delete(l);
  }

  append(blocks: readonly Uint8Array[]): Promise<void> {
    for (const b of blocks) this.blocos.push(b);
    for (const l of [...this.#ouvintes]) l();
    return Promise.resolve();
  }

  replicate(mux: unknown): void {
    this.replicacoes.push(mux);
  }

  download(): void {
    this.downloads.push('full');
  }

  downloadRange(inicio: number, fim: number): Promise<void> {
    this.downloads.push(`${inicio}..${fim}`);
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** Backend de swarm sem rede: registra o que §31.8 mandou fazer e entrega conexões à mão. */
export class BackendDeMentira implements SwarmBackendPort {
  readonly paresProcurados = new Set<string>();
  readonly paresSoltos: string[] = [];
  anunciou = false;
  readonly #listeners = new Set<(c: SwarmConnection) => void>();

  join(): void {}
  leave(): void {}
  listenSelf(): void {
    this.anunciou = true;
  }
  joinPeer(peerKeyHex: string): void {
    this.paresProcurados.add(peerKeyHex);
  }
  leavePeer(peerKeyHex: string): void {
    this.paresProcurados.delete(peerKeyHex);
    this.paresSoltos.push(peerKeyHex);
  }
  flush(): Promise<void> {
    return Promise.resolve();
  }
  onConnection(l: (c: SwarmConnection) => void): () => void {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }
  connectionCount(): number {
    return 0;
  }
  destroy(): Promise<void> {
    return Promise.resolve();
  }

  entregar(conn: SwarmConnection): void {
    for (const l of [...this.#listeners]) l(conn);
  }
}

export type NoDeRede = {
  readonly rotulo: string;
  readonly identity: Keypair;
  readonly manifest: ManifestDb;
  readonly dm: DirectMessages;
  readonly swarm: Swarm;
  readonly backend: BackendDeMentira;
  readonly cores: Map<string, CoreDeRede>;
  readonly paresAbertos: Map<string, CoreDeRede>;
  readonly eventos: Array<{ topic: string; data: Record<string, unknown> }>;
  transporte: DmTransport | null;
  relogio: { now(): number };
};

function assinar(secretKey: Buffer, digest: Buffer): Buffer {
  const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, digest, secretKey);
  return sig;
}

/** As portas de §4 ligadas ao `dmCodec` de produto, com a identidade local fechada dentro. */
export function criptoDe(identity: Keypair): DmCriptoPort {
  return {
    conversationKey: (peerKey) => dmConversationKey(identity.publicKey, peerKey),
    hello: ({ conversationKey, peerKey, selfCoreKey }) => {
      const contentKey = dmContentKey(identity.secretKey, peerKey, conversationKey);
      assert.notEqual(contentKey, null, 'dmContentKey falhou');
      const header: DmHeader = {
        v: DM_VERSION,
        conversationId: conversationKey,
        kind: DM_KINDS['dm.hello'],
        author: identity.publicKey,
        authorSeq: 1,
        ts: 1_755_000_000_000,
        ack: 0,
      };
      const plaintext = encodeDmPayload('dm.hello', {
        peerKey,
        coreProof: assinar(identity.secretKey, dmCorePossessionHash(conversationKey, selfCoreKey)),
        displayName: 'nome',
        avatarColor: 1,
      });
      const payload = sealDmPayload(contentKey as Buffer, header, plaintext);
      assert.notEqual(payload, null, 'sealDmPayload falhou');
      const opBytes = encodeDmOp({ ...header, payload: payload as Buffer });
      return encodeDmEnvelope({
        op: opBytes,
        sig: assinar(identity.secretKey, dmOpSigningHash(opBytes)),
      });
    },
  };
}

export function noDeRede(rotulo: string, opcoes: { pendingMax?: number } = {}): NoDeRede {
  const identity = dmKeypair(rotulo);
  const manifest = openManifestDb(path.join(tempDir(), 'manifest.db'));
  const backend = new BackendDeMentira();
  const swarm = new Swarm({ backend });
  const cores = new Map<string, CoreDeRede>();
  const paresAbertos = new Map<string, CoreDeRede>();
  const eventos: Array<{ topic: string; data: Record<string, unknown> }> = [];
  let t = 1_755_000_000_000;
  const relogio = {
    now: () => t,
    avancar(ms: number): void {
      t += ms;
    },
  };

  const coresPort: DmCorePort = {
    abrirProprio: ({ conversationId, keyPair }) => {
      const existente = cores.get(conversationId);
      if (existente !== undefined) return Promise.resolve(existente);
      const c = new CoreDeRede(keyPair.publicKey);
      cores.set(conversationId, c);
      return Promise.resolve(c);
    },
    abrirDoPar: ({ conversationId, coreKey }) => {
      const existente = paresAbertos.get(conversationId);
      if (existente !== undefined) return Promise.resolve(existente as CoreHandle);
      const c = new CoreDeRede(coreKey);
      paresAbertos.set(conversationId, c);
      return Promise.resolve(c as CoreHandle);
    },
  };

  const dm = new DirectMessages({
    manifest,
    identity: { publicKey: identity.publicKey, seed: identity.secretKey.subarray(0, 32) },
    cripto: criptoDe(identity),
    cores: coresPort,
    onEvent: (ev) => eventos.push({ topic: ev.topic, data: { ...ev.data } }),
    now: () => relogio.now(),
    ...(opcoes.pendingMax !== undefined ? { pendingMax: opcoes.pendingMax } : {}),
  });

  return {
    rotulo,
    identity,
    manifest,
    dm,
    swarm,
    backend,
    cores,
    paresAbertos,
    eventos,
    transporte: null,
    relogio,
  };
}

/** Sobe o `p2p-dm/1` do nó. Separado do construtor porque §31.8 lê o estado ao subir. */
export function subirTransporte(no: NoDeRede): DmTransport {
  const t = startDmTransport({
    swarm: no.swarm,
    dm: no.dm,
    identity: no.identity,
    onEvent: (topic, data) => no.eventos.push({ topic, data }),
    clock: no.relogio,
  });
  no.transporte = t;
  return t;
}

/** Dois streams `streamx` cruzados — o que o `Protomux` de verdade precisa, e nada mais. */
export function parDeStreams(): [Duplex, Duplex] {
  const a: Duplex = new Duplex({
    write(data: unknown, cb: (err: Error | null) => void) {
      b.push(Buffer.from(data as Uint8Array));
      cb(null);
    },
  });
  const b: Duplex = new Duplex({
    write(data: unknown, cb: (err: Error | null) => void) {
      a.push(Buffer.from(data as Uint8Array));
      cb(null);
    },
  });
  return [a, b];
}

/**
 * Um par de streams com o **Noise de verdade** por cima (`@hyperswarm/secret-stream`), que é
 * o mesmo tipo de stream que o `hyperswarm` entrega no produto.
 *
 * Existe porque um `Duplex` cru não basta para dois clientes: o `hypercore` espera
 * `stream.opened` ao anexar-se ao mux (`Replicator.attachTo`), e sem ele a replicação real
 * quebra. Com o Noise, a `remotePublicKey` de §31.8 camada 1 passa a ser **autenticada de
 * fato**, e não declarada pelo cabo — é a versão mais forte do mesmo teste.
 */
export function parDeStreamsNoise(
  a: Keypair,
  b: Keypair,
): [InstanceType<typeof SecretStream>, InstanceType<typeof SecretStream>] {
  const [ra, rb] = parDeStreams();
  return [
    new SecretStream(true, ra as never, { keyPair: a }),
    new SecretStream(false, rb as never, { keyPair: b }),
  ];
}

/**
 * Liga os dois nós por uma conexão: cada lado recebe a `remotePublicKey` do outro, que no
 * produto vem autenticada pelo Noise (§31.8 camada 1).
 */
export function conectar(a: NoDeRede, b: NoDeRede, opts: { address?: string } = {}): void {
  const [sa, sb] = parDeStreams();
  const conn = (stream: Duplex, peer: NoDeRede): SwarmConnection =>
    ({
      remotePublicKeyHex: peer.identity.publicKey.toString('hex'),
      stream: stream as unknown as SwarmConnection['stream'],
      topicsHex: [],
      ...(opts.address !== undefined ? { remoteAddress: opts.address } : {}),
      close: () => stream.destroy(),
    }) as SwarmConnection;
  a.backend.entregar(conn(sa, b));
  b.backend.entregar(conn(sb, a));
}

/** Espera a condição — o `Protomux` entrega em microtasks, não sincronamente. */
export async function ate(cond: () => boolean, msg: string, limiteMs = 3_000): Promise<void> {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`${msg} (esperou ${limiteMs} ms)`);
}

export { dmKeypair, assinar };
