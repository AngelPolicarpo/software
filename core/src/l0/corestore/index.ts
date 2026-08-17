// `corestore` — L0. Ciclo de vida dos cores (§4).
//
// O contrato completo deste módulo — *"namespaces determinísticos"* (§5.3), integração com
// `manifest`, blobs — depende de `manifest` (L0) e de seções que a fase 2 ainda não abre
// (G2 fecha reprojeção+participação+chaves; a outbox de §11 é fase 3). A fase 2 entrega a
// **leitura**: abrir um core por chave e ler blocos — exatamente a superfície que o
// `projector` de §10.5 consome (lotes de `get`, `length`, reação a `append`).
//
// Nenhuma decisão sobre **o que** appendar mora aqui (§4, "Não pode: decidir o que
// appendar"); nesta fase nada appenda — e é por isso que a barreira de durabilidade de §11
// (`core.flush`, P1) **não** cruza o projector: ele só lê o core e escreve `view.db`.

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

class CoreHandleImpl implements CoreHandle {
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
): Promise<CoreHandle> {
  const core = new Hypercore(storagePath, { key: keyPair.publicKey, keyPair, compat: true });
  await core.ready();
  return new CoreHandleImpl(core);
}
