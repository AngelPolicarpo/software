// `corestore` — L0. Ciclo de vida dos cores (§4).
//
// O contrato completo deste módulo — *"namespaces determinísticos"* (§5.3), integração com
// `manifest`, blobs — depende de `manifest` (L0) e de seções que a fase 2 ainda não abre
// (G2 fecha reprojeção+participação+chaves). A fase 2 entregou a **leitura**; a fase 3
// acrescenta a porta de append usada pelo `communityHost`, sem mover a decisão para L0.
//
// Nenhuma decisão sobre **o que** appendar mora aqui (§4, "Não pode: decidir o que
// appendar"). A escrita é exposta apenas como uma porta para `communityHost`; a decisão
// continua em L2.

import Hypercore from 'hypercore';

export type CoreHandle = {
  /** Chave pública do core — o `communityId` em hex (§6.2). */
  readonly key: Buffer;
  readonly length: number;
  /** Bloco `seq`; `null` quando ainda não disponível (replicação em curso, §10.5). */
  get(seq: number): Promise<Uint8Array | null>;
  /** §10.5 passo 6 — reage a `append`. Devolve o desregistro. */
  onAppend(listener: () => void): () => void;
  close(): Promise<void>;
};

export type WritableCoreHandle = CoreHandle & {
  /** §11.5 — um append recebe o grupo inteiro; a resolução é a barreira (§10.7.1). */
  append(blocks: readonly Uint8Array[]): Promise<void>;
};

class CoreHandleImpl implements WritableCoreHandle {
  readonly #core: Hypercore;

  constructor(core: Hypercore) {
    this.#core = core;
  }

  get key(): Buffer {
    const k = this.#core.key;
    if (k === null) throw new Error('core sem chave — não deveria estar pronto');
    return Buffer.from(k);
  }

  get length(): number {
    return this.#core.length;
  }

  async get(seq: number): Promise<Uint8Array | null> {
    return this.#core.get(seq, { wait: false });
  }

  onAppend(listener: () => void): () => void {
    this.#core.on('append', listener);
    return () => this.#core.off('append', listener);
  }

  async close(): Promise<void> {
    await this.#core.close();
  }

  async append(blocks: readonly Uint8Array[]): Promise<void> {
    // Hypercore aceita o lote em runtime; o vendor.d.ts mantém a assinatura escalar da API.
    await this.#core.append(blocks as unknown as Uint8Array);
  }
}

/**
 * Abre (ou cria) o core da comunidade em `storagePath` e devolve o cabo de leitura.
 *
 * `storagePath` é o diretório do core, não o diretório de dados: a derivação de caminho a
 * partir de `<userData>/p2p/cores/` (§10.1) e dos namespaces de §5.3 é parte do ciclo de
 * vida completo, que entra com `manifest` na fase 3.
 */
export async function openCore(storagePath: string, key?: Buffer): Promise<CoreHandle> {
  const core = new Hypercore(storagePath, key !== undefined ? { key } : undefined);
  await core.ready();
  return new CoreHandleImpl(core);
}

/** Cria um core novo com par de chaves determinado — o caso de teste e do host de gênese. */
export async function createCore(
  storagePath: string,
  keyPair: { publicKey: Buffer; secretKey: Buffer },
): Promise<WritableCoreHandle> {
  const core = new Hypercore(storagePath, { key: keyPair.publicKey, keyPair, compat: true });
  await core.ready();
  return new CoreHandleImpl(core);
}

/** Abre um core existente com a chave de escrita do host. */
export async function openWritableCore(
  storagePath: string,
  keyPair: { publicKey: Buffer; secretKey: Buffer },
): Promise<WritableCoreHandle> {
  const core = new Hypercore(storagePath, { key: keyPair.publicKey, keyPair, compat: true });
  await core.ready();
  return new CoreHandleImpl(core);
}
