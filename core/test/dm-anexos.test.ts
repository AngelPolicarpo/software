// B61 — anexos numa conversa direta (§31.14).
//
// §31.14 é uma tabela de **reusos**: `AttachmentRef`, o core de blobs por autor, o ticket de
// staging do main, os fluxos de upload e download, a barreira blob↔mensagem, a abertura e a
// quarentena — tudo de §13, sem alteração. O que muda é uma derivação, uma cota que **não**
// se aplica, e uma regra a mais (RD-11).
//
// É exatamente isso que este arquivo mede: que a derivação é a de §31.3 e separa o que tem
// de separar; que a cota R-14 não morde numa conversa; e que as duas guardas da escrita —
// "o `blobsCoreKey` é o meu" (RD-11) e "o blob existe aqui" (§13.7 regra 1) — recusam antes
// de o registro entrar no log.

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { openViewDb } from '../src/l0/view/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import { deriveDmBlobsKeyPair, deriveDmCoreKeyPair } from '../src/l0/corestore/index.ts';
import { deriveMemberBlobsPublicKey } from '../src/l2/blobs/index.ts';
import { dmConversationKey } from '../src/l1/dmCodec/index.ts';
import { MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import { bootCore, type CoreRuntime } from '../src/composition/boot.ts';
import { tempDir } from './helpers/composition.ts';
import { T0, keypairFromSeed } from './helpers/world.ts';

const DATA_KEY = Buffer.alloc(32, 61);

// ─── §31.3 — a derivação, e o que ela separa ───────────────────────────────────────────

describe('§31.3/§31.14 — `dmBlobsSeed` é derivada, por conversa', () => {
  const seed = Buffer.alloc(32, 3);
  const conversaA = Buffer.alloc(32, 10);
  const conversaB = Buffer.alloc(32, 11);

  it('é determinística: a mesma identidade e a mesma conversa dão a mesma chave', () => {
    // É o que torna o anexo recuperável pelo backup de §5.5 sem campo novo: quem restaura a
    // identidade reconstrói o core de blobs de toda conversa.
    assert.deepEqual(
      deriveDmBlobsKeyPair(seed, conversaA).publicKey,
      deriveDmBlobsKeyPair(seed, conversaA).publicKey,
    );
  });

  it('um core de blobs POR CONVERSA — escopo de replicação = escopo de confidencialidade', () => {
    // §31.1. Um core só para todas as conversas faria o tópico de §13.4 ligar entre si
    // pessoas sem relação nenhuma: quem baixasse um anexo meu numa conversa passaria a
    // anunciar interesse no mesmo core que serve outra.
    assert.notDeepEqual(
      deriveDmBlobsKeyPair(seed, conversaA).publicKey,
      deriveDmBlobsKeyPair(seed, conversaB).publicKey,
    );
  });

  it('não colide com o core de LOG da mesma conversa — domínios separados de §5.2', () => {
    // `ns/dmblobs/1` vs `ns/dm/1`, mesma identidade e mesma conversa. Se colidissem, o log
    // e os blobs seriam o mesmo core e um anexo grande atrasaria a conversa inteira.
    assert.notDeepEqual(
      deriveDmBlobsKeyPair(seed, conversaA).publicKey,
      deriveDmCoreKeyPair(seed, conversaA).publicKey,
    );
  });

  it('não colide com o core de blobs de COMUNIDADE de mesmo id — `ns/memberblobs/1`', () => {
    // O `communityId` e o `conversationId` são os dois 32 bytes; sem a separação de domínio,
    // uma conversa e uma comunidade de mesmo identificador serviriam o mesmo core.
    assert.notDeepEqual(
      deriveDmBlobsKeyPair(seed, conversaA).publicKey,
      deriveMemberBlobsPublicKey(seed, conversaA),
    );
  });

  it('recusa entradas fora da forma em vez de derivar de lixo', () => {
    assert.throws(() => deriveDmBlobsKeyPair(Buffer.alloc(31), conversaA));
    assert.throws(() => deriveDmBlobsKeyPair(seed, Buffer.alloc(16)));
  });
});

// ─── A pilha: o core nasce com a conversa, e as duas guardas da escrita ─────────────────

type Rig = {
  readonly runtime: CoreRuntime;
  request(cmd: string, arg: unknown): Promise<{ ok: boolean; data: unknown; code: string | null }>;
  close(): Promise<void>;
};

async function rig(nome: string, identity: { publicKey: Buffer; secretKey: Buffer }): Promise<Rig> {
  const dir = tempDir(nome);
  const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
  const view = openViewDb(path.join(dir, 'view.db'));
  const [coreSide, rendererSide] = MemoryIpcPort.createPair();
  const runtime = await bootCore({
    dataDir: dir,
    manifest,
    view,
    swarm: new Swarm(),
    dataKey: DATA_KEY,
    identity: () => identity,
    identityProfile: () => ({ displayName: 'Dona', avatarColor: 2 }),
    foldBuildId: 'dm-anexos',
    ipcPort: coreSide,
    epoch: 1,
    tokenVerifier: { consume: () => true },
    hostTurnSecret: () => Buffer.alloc(32, 7),
    now: () => T0 + 1_000,
    schedule: () => 0,
    cancel: () => {},
  });

  let proximo = 0;
  async function request(cmd: string, arg: unknown): Promise<{ ok: boolean; data: unknown; code: string | null }> {
    const id = ++proximo;
    const resposta = new Promise<{ ok: boolean; data: unknown; code: string | null }>((resolve) => {
      rendererSide.onMessage((frame) => {
        if (frame.t === 'res' && frame.id === id) resolve({ ok: frame.ok, data: frame.data, code: frame.err?.code ?? null });
      });
    });
    rendererSide.postMessage({ t: 'req', epoch: 1, id, cmd, arg, authToken: 'ok' });
    return await resposta;
  }

  return {
    runtime,
    request,
    async close() {
      await runtime.close();
      view.close();
      manifest.close();
    },
  };
}

/** Um `attachment` na forma do fio de §31.16.1, com a chave e o hash que o caso quer. */
function anexoDoFio(blobsCoreKey: Buffer, hash: Buffer) {
  // A forma é a de `blob.stage` (§15.4): chave e hash em hex, `blobId` como o quádruplo de
  // §7.2.1 — `Buffer` não atravessa JSON (§15.1).
  return {
    blobsCoreKey: blobsCoreKey.toString('hex'),
    blobId: { byteOffset: 0, blockOffset: 0, blockLength: 1, byteLength: 9 },
    name: 'nota.txt',
    sizeBytes: 9,
    kind: 0,
    hash: hash.toString('hex'),
  };
}

describe('§31.14 — o core de blobs da conversa, e as guardas da escrita', () => {
  it('o core de blobs nasce COM a conversa, na chave derivada de §31.3', async () => {
    // Esperar o primeiro `blob.stage` deixaria a janela em que o par pede um anexo no
    // tópico de §13.4 e ninguém responde: quem anuncia é o dono do core.
    const eu = keypairFromSeed('anexos-eu');
    const par = keypairFromSeed('anexos-par');
    const r = await rig('dm-anexos-nasce', eu);
    try {
      const aberta = await r.request('dm.open', { peerKey: par.publicKey.toString('hex') });
      assert.equal(aberta.ok, true, `dm.open recusou: ${aberta.code}`);
      const { conversationId } = aberta.data as { conversationId: string };

      const esperada = deriveDmBlobsKeyPair(
        eu.secretKey.subarray(0, 32),
        Buffer.from(conversationId, 'hex'),
      ).publicKey;
      await ate(
        () => r.runtime.dm?.blobsCoreKeyOf(conversationId)?.equals(esperada) === true,
        'o core de blobs da conversa não foi anexado',
      );
    } finally {
      await r.close();
    }
  });

  it('RD-11 — anexo com `blobsCoreKey` que não é o meu é recusado antes do log', async () => {
    // A metade que ESTE nó controla é total: um anexo apontando para um core arbitrário
    // faria o par buscar bytes onde ninguém os tem. A outra metade — o primeiro anexo do
    // PAR — é B66, e não se inventa aqui.
    const eu = keypairFromSeed('anexos-eu-2');
    const par = keypairFromSeed('anexos-par-2');
    const r = await rig('dm-anexos-rd11', eu);
    try {
      const aberta = await r.request('dm.open', { peerKey: par.publicKey.toString('hex') });
      const { conversationId } = aberta.data as { conversationId: string };
      await ate(() => r.runtime.dm?.blobsCoreKeyOf(conversationId) !== null, 'sem core de blobs');

      const alheio = Buffer.alloc(32, 0xab);
      const recusa = await r.request('dm.send', {
        conversationId,
        content: 'olha o arquivo',
        attachment: anexoDoFio(alheio, Buffer.alloc(32, 0xcd)),
      });
      assert.equal(recusa.ok, false);
      assert.equal(recusa.code, 'E_VALIDATION');
    } finally {
      await r.close();
    }
  });

  it('anexo enviado ANTES de o core de blobs resolver não vira `E_VALIDATION` espúrio', async () => {
    // O core de blobs nasce numa promessa que `montarProjetor` dispara sem aguardar. A guarda
    // de RD-11 caía na janela entre a montagem e a resolução e devolvia `E_VALIDATION` — o
    // mesmo código de um anexo apontando para o core de outra pessoa, indistinguível dele.
    // Sem `await` nenhum entre o `dm.open` e o `dm.send`, o desfecho tem de ser o da regra
    // seguinte (`E_BLOB_NOT_STAGED`), não o da guarda que a janela enganava.
    const eu = keypairFromSeed('anexos-eu-janela');
    const par = keypairFromSeed('anexos-par-janela');
    const r = await rig('dm-anexos-janela', eu);
    try {
      const aberta = await r.request('dm.open', { peerKey: par.publicKey.toString('hex') });
      const { conversationId } = aberta.data as { conversationId: string };
      const minha = deriveDmBlobsKeyPair(
        eu.secretKey.subarray(0, 32),
        Buffer.from(conversationId, 'hex'),
      ).publicKey;

      const resposta = await r.request('dm.send', {
        conversationId,
        content: 'olha o arquivo',
        attachment: anexoDoFio(minha, Buffer.alloc(32, 0xcd)),
      });
      assert.equal(resposta.ok, false);
      assert.equal(resposta.code, 'E_BLOB_NOT_STAGED', `veio ${resposta.code}`);
    } finally {
      await r.close();
    }
  });

  it('§13.7 regra 1 — chave certa, mas blob não staged: `E_BLOB_NOT_STAGED`', async () => {
    // `dm.send` recebe o `attachment` inteiro no argumento (§31.16.1), diferente de
    // `message.send`, que manda só o `ticketId`. A regra é a mesma nos dois: nada que
    // descreva o blob vale sem confronto com o que este núcleo escreveu.
    const eu = keypairFromSeed('anexos-eu-3');
    const par = keypairFromSeed('anexos-par-3');
    const r = await rig('dm-anexos-staged', eu);
    try {
      const aberta = await r.request('dm.open', { peerKey: par.publicKey.toString('hex') });
      const { conversationId } = aberta.data as { conversationId: string };
      await ate(() => r.runtime.dm?.blobsCoreKeyOf(conversationId) !== null, 'sem core de blobs');
      const minha = r.runtime.dm?.blobsCoreKeyOf(conversationId) as Buffer;

      const recusa = await r.request('dm.send', {
        conversationId,
        content: 'olha o arquivo',
        attachment: anexoDoFio(minha, Buffer.alloc(32, 0xef)),
      });
      assert.equal(recusa.ok, false);
      assert.equal(recusa.code, 'E_BLOB_NOT_STAGED');
    } finally {
      await r.close();
    }
  });

  it('sem anexo, a mesma conversa escreve normalmente — as guardas não pegam o caminho comum', async () => {
    const eu = keypairFromSeed('anexos-eu-4');
    const par = keypairFromSeed('anexos-par-4');
    const r = await rig('dm-anexos-comum', eu);
    try {
      const aberta = await r.request('dm.open', { peerKey: par.publicKey.toString('hex') });
      const { conversationId } = aberta.data as { conversationId: string };
      const enviada = await r.request('dm.send', { conversationId, content: 'sem anexo' });
      assert.equal(enviada.ok, true, `dm.send recusou: ${enviada.code}`);
    } finally {
      await r.close();
    }
  });
});

/** O `conversationId` de §31.2, para os casos que precisam dele antes do `dm.open`. */
export function idEntre(a: Buffer, b: Buffer): string {
  const k = dmConversationKey(a, b);
  assert.notEqual(k, null);
  return (k as Buffer).toString('hex');
}

async function ate(cond: () => boolean, msg: string, limiteMs = 5_000): Promise<void> {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`${msg} (esperou ${limiteMs} ms)`);
}
