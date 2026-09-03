// §31.8 — a descoberta da conversa direta, na DHT de verdade.
//
// `dm-rede.test.ts` prova o **protocolo**: `Protomux` real, quatro camadas de autenticação,
// os tetos. O que ele não pode provar é a **descoberta**, porque o cabo dele entrega a
// conexão à mão — e foi exatamente ali que o primeiro contato morreu em produção: quem
// recebe não tinha conversa nenhuma, logo não se anunciava, logo o `joinPeer` de quem
// escreve não tinha a que se conectar. Um nó que só é membro entra nos tópicos de §14.1 como
// `client` e nunca anuncia par nenhum, então nem a comunidade o salvava.
//
// Aqui não há host, não há comunidade e não há conexão entregue à mão: dois núcleos de
// produto, um `hyperdht/testnet` local, e a única coisa que os aproxima é a chave de
// identidade (**L-24**). É o mínimo que reproduz o defeito de 2026-09-03.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import createTestnet from 'hyperdht/testnet.js';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { openViewDb } from '../src/l0/view/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import { HyperswarmBackend } from '../src/l0/swarm/hyperswarm.ts';
import { MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import { bootCore, type CoreRuntime } from '../src/composition/boot.ts';
import { dmConversationKey } from '../src/l1/dmCodec/index.ts';
import { tempDir } from './helpers/composition.ts';
import { T0, keypairFromSeed } from './helpers/world.ts';

const DATA_KEY = Buffer.alloc(32, 5);

type Bootstrap = ReadonlyArray<{ readonly host: string; readonly port: number }>;

type No = {
  readonly runtime: CoreRuntime;
  readonly dir: string;
  close(): Promise<void>;
};

/** Um nó de produto **sem comunidade nenhuma**: identidade, swarm real e o subsistema de §31. */
async function no(opts: {
  readonly rotulo: string;
  readonly bootstrap: Bootstrap;
  readonly identity: { publicKey: Buffer; secretKey: Buffer };
  readonly displayName: string;
}): Promise<No> {
  const dir = tempDir(opts.rotulo);
  const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
  const view = openViewDb(path.join(dir, 'view.db'));
  const [coreSide] = MemoryIpcPort.createPair();

  const backend = new HyperswarmBackend({ bootstrap: opts.bootstrap, keyPair: opts.identity });
  const swarm = new Swarm({ backend });

  const runtime = await bootCore({
    dataDir: dir,
    manifest,
    view,
    swarm,
    dataKey: DATA_KEY,
    identity: () => opts.identity,
    identityProfile: () => ({ displayName: opts.displayName, avatarColor: 3 }),
    foldBuildId: 'dm-descoberta',
    ipcPort: coreSide,
    epoch: 1,
    tokenVerifier: { consume: () => true },
    hostTurnSecret: () => Buffer.alloc(32, 7),
    logger: undefined,
    now: () => T0 + 5_000,
    schedule: () => 0,
    cancel: () => {},
  });

  return {
    runtime,
    dir,
    async close() {
      await runtime.close();
      view.close();
      await backend.destroy();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    },
  };
}

async function ate(cond: () => boolean, msg: string, timeoutMs = 30_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`${msg} (esperou ${timeoutMs} ms)`);
}

describe('§31.8 — descoberta na DHT real, sem comunidade nenhuma', { timeout: 180_000 }, () => {
  const ana = keypairFromSeed('ana-dm-descoberta');
  const bea = keypairFromSeed('bea-dm-descoberta');

  let testnet: Awaited<ReturnType<typeof createTestnet>> | null = null;
  const abertos: No[] = [];

  after(async () => {
    for (const n of abertos.reverse()) await n.close();
    await testnet?.destroy();
  });

  it('a primeira mensagem chega a quem nunca teve conversa nenhuma', async () => {
    testnet = await createTestnet(3);

    // A ordem importa e é a de produto: quem recebe já está de pé, sem conversa nenhuma —
    // é o estado em que o anúncio condicionado o tornava invisível.
    const bob = await no({ rotulo: 'dm-bob', bootstrap: testnet.bootstrap, identity: bea, displayName: 'Bea' });
    abertos.push(bob);
    const alice = await no({ rotulo: 'dm-alice', bootstrap: testnet.bootstrap, identity: ana, displayName: 'Ana' });
    abertos.push(alice);

    assert.notEqual(alice.runtime.dm, null, 'o subsistema de §31 não subiu com identidade');
    assert.notEqual(bob.runtime.dm, null, 'o subsistema de §31 não subiu com identidade');

    const conversationId = dmConversationKey(ana.publicKey, bea.publicKey)!.toString('hex');

    const abriu = await alice.runtime.dm!.dm.abrir(bea.publicKey);
    assert.equal(abriu.ok, true, `abrir recusou: ${JSON.stringify(abriu)}`);
    await alice.runtime.dm!.escrever(conversationId, 'dm.message', {
      content: 'oi, achei teu perfil',
    });

    // Nada aqui entrega conexão: o `joinPeer` de Ana só acha Bea se Bea se anunciou.
    await ate(
      () => bob.runtime.dm!.dm.conversa(conversationId)?.state === 'pending-in',
      'o pedido de Ana não chegou a Bea pela DHT',
    );

    const row = bob.runtime.dm!.dm.conversa(conversationId);
    assert.equal(row?.state, 'pending-in');
    // §31.9 regra 1 — aceitar é o que cria o core de Bea. O pedido chega antes disso.
    assert.equal(bob.runtime.dm!.dm.coreDe(conversationId), null);

    // O cabo por onde o pedido chegou continua **de pé** em `pending-in`: é por ele que
    // §31.9 baixa os primeiros registros, e é deles que sai a mensagem que o pedido mostra.
    assert.equal(bob.runtime.dm!.transport.channelCount(), 1, 'o canal do pedido foi derrubado');

    // E o pedido não chega vazio: a primeira mensagem de Ana está nele antes do aceite.
    await ate(() => {
      const c = bob.runtime.dm!.queries.conversations().find((x) => x.conversationId === conversationId);
      return c?.lastMessage?.excerpt === 'oi, achei teu perfil';
    }, 'a mensagem de Ana não apareceu no pedido de Bea');
  });

  it('depois do aceite, a resposta volta pelo mesmo cabo', async () => {
    const bob = abertos[0]!;
    const alice = abertos[1]!;
    const conversationId = dmConversationKey(ana.publicKey, bea.publicKey)!.toString('hex');

    const aceitou = await bob.runtime.dm!.dm.aceitar(conversationId);
    assert.equal(aceitou.ok, true, `aceitar recusou: ${JSON.stringify(aceitou)}`);
    await bob.runtime.dm!.escrever(conversationId, 'dm.message', { content: 'recebi, sim' });

    // Ana não reinicia nada: o aceite muda o estado dos dois lados e a descoberta o segue.
    await ate(() => {
      const { messages } = alice.runtime.dm!.queries.messages({ conversationId });
      return messages.some((m) => m.content === 'recebi, sim');
    }, 'a resposta de Bea não chegou a Ana');
  });
});
