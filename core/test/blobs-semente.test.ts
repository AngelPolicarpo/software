// §48 — a semente do core de blobs do membro é DERIVADA da identidade, não sorteada
// (§13.1, §5.2 `ns/memberblobs/1`, §19.1 passo 3).
//
// A propriedade que estes testes fixam é a de §13.1/§5.5: a chave publicada no `member.join`
// tem de voltar a existir a partir do `identitySeed` sozinho — em qualquer instalação, sem o
// `manifest.db` da máquina anterior. O segundo teste é literalmente esse cenário: o mesmo
// `dataDir`, um manifesto recriado como o `identity.import` o recria (só a linha de
// `communities`), e o boot tem de reabrir o writer e reescrever o atalho de §10.2.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { openViewDb, type ViewDb } from '../src/l0/view/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import { deriveMemberBlobsPublicKey } from '../src/l2/blobs/index.ts';
import { MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import { bootCore, type CoreRuntime } from '../src/composition/boot.ts';
import { manifestCommunitySeedPort, storeCommunitySeed } from '../src/composition/ports.ts';
import { tempDir } from './helpers/composition.ts';
import { T0, keypairFromSeed } from './helpers/world.ts';

const DATA_KEY = Buffer.alloc(32, 48);

type Rig = {
  readonly runtime: CoreRuntime;
  readonly manifest: ManifestDb;
  readonly view: ViewDb;
  request(cmd: string, arg: unknown): Promise<{ ok: boolean; data: unknown; code: string | null }>;
  close(): Promise<void>;
};

/** Um núcleo local, sem rede: `community.create` não depende de swarm (§19.1). */
async function rig(dir: string, identity: { publicKey: Buffer; secretKey: Buffer }): Promise<Rig> {
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
    foldBuildId: 'blobs-semente',
    ipcPort: coreSide,
    epoch: 1,
    tokenVerifier: { consume: () => true },
    hostTurnSecret: () => Buffer.alloc(32, 7),
    now: () => T0 + 1_000,
    schedule: () => 0,
    cancel: () => {},
  });

  async function request(cmd: string, arg: unknown): Promise<{ ok: boolean; data: unknown; code: string | null }> {
    const id = 9000 + Math.floor(Math.random() * 1000);
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
    manifest,
    view,
    request,
    async close() {
      await runtime.close();
      view.close();
      manifest.close();
    },
  };
}

describe('§48 — o core de blobs do membro nasce derivado da identidade', () => {
  it('`community.create` publica no log a chave derivada, e o manifest guarda a MESMA semente', async () => {
    const dir = tempDir('blobs-semente-create');
    const fundador = keypairFromSeed('fundador-48');
    const r = await rig(dir, fundador);
    try {
      const criada = await r.request('community.create', { name: 'Raiz', iconColor: 1 });
      assert.ok(criada.ok, `community.create recusou: ${JSON.stringify(criada)}`);
      const { communityId } = criada.data as { communityId: string };

      const esperada = deriveMemberBlobsPublicKey(fundador.secretKey.subarray(0, 32), communityId);

      // (1) o que o log publicou — dado de réplica, o que todo leitor de anexo enxerga
      const eu = fundador.publicKey.toString('hex');
      const doLog = r.runtime.get(communityId)!.projector.ds.members.get(eu)?.blobsCoreKey;
      assert.ok(doLog !== undefined, 'o `member.join` da gênese saiu sem `blobsCoreKey`');
      assert.ok(doLog.equals(esperada), 'a chave publicada não é a derivada de `ns/memberblobs/1`');

      // (2) o atalho local de §10.2 e (3) o writer que o boot anexou
      assert.ok(Buffer.from(r.manifest.getMemberBlobsCore(communityId)!.coreKey).equals(esperada));
      assert.ok(r.runtime.blobs.localCoreKey(communityId)?.equals(esperada), 'o writer aberto não é o core publicado');
    } finally {
      await r.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sem a linha `member_blobs_core`, o boot reabre o core pela derivação e reescreve o atalho', async () => {
    const dir = tempDir('blobs-semente-restauro');
    const fundador = keypairFromSeed('fundador-48b');
    const primeiro = await rig(dir, fundador);
    let communityId = '';
    let communitySeed: Buffer | null = null;
    let coreKey: Buffer | null = null;
    let blobsKey: Buffer | null = null;
    try {
      const criada = await primeiro.request('community.create', { name: 'Raiz', iconColor: 1 });
      assert.ok(criada.ok, `community.create recusou: ${JSON.stringify(criada)}`);
      communityId = (criada.data as { communityId: string }).communityId;
      communitySeed = manifestCommunitySeedPort(primeiro.manifest, DATA_KEY)(communityId);
      const linha = primeiro.manifest.getCommunity(communityId) as { core_key: Buffer; blobs_key: Buffer };
      coreKey = Buffer.from(linha.core_key);
      blobsKey = Buffer.from(linha.blobs_key);
    } finally {
      await primeiro.close();
    }
    assert.ok(communitySeed !== null, 'a comunidade hospedada ficou sem semente no manifest');

    // O que `identity.import` recria (§5.5): identidade + a lista de comunidades. A semente
    // do core de blobs NÃO está no backup — e é justamente por isso que ela é derivada.
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('manifest.db') || f.startsWith('view.db')) fs.rmSync(path.join(dir, f), { force: true });
    }
    const manifestNovo = new ManifestDb(path.join(dir, 'manifest.db'));
    storeCommunitySeed(
      manifestNovo,
      { communityId, coreKey: coreKey!, blobsKey: blobsKey!, communitySeed, isHost: true, joinedAt: T0 },
      DATA_KEY,
    );
    manifestNovo.close();

    const segundo = await rig(dir, fundador);
    try {
      const esperada = deriveMemberBlobsPublicKey(fundador.secretKey.subarray(0, 32), communityId);
      assert.ok(
        segundo.runtime.blobs.localCoreKey(communityId)?.equals(esperada),
        'a instalação restaurada não reabriu o core de blobs do próprio autor',
      );
      const reescrita = segundo.manifest.getMemberBlobsCore(communityId);
      assert.ok(reescrita !== null, 'o atalho de §10.2 não foi reescrito no boot');
      assert.ok(Buffer.from(reescrita.coreKey).equals(esperada));
    } finally {
      await segundo.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
