/**
 * `p2p-dm/1` (§31.8, §31.18) — o fio da conversa direta.
 *
 * O teste que fecha o item é o das **quatro camadas de autenticação**, e cada uma tem
 * contrafactual: um `conversationId` que não deriva da `remotePublicKey`, um `coreProof`
 * assinado pela chave errada, e um `coreProof` sobre um `coreKey` diferente do anunciado. Sem
 * as três, `coreKey` seria uma afirmação do par sobre si mesmo, e §31.8 diz o contrário.
 *
 * O `Protomux` é de verdade (`helpers/dmRede.ts`): o canal simétrico é a única peça de §16.1
 * sem precedente — nos outros dois protocolos há host e a assimetria decide quem abre —, e um
 * canal de mentira provaria o cabo, não o protocolo.
 */

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import {
  DM_VERSION,
  dmConversationKey,
  dmCorePossessionHash,
} from '../src/l1/dmCodec/index.ts';
import {
  P2P_DM_PENDING_MAX_RECORDS,
} from '../src/l2/directMessages/index.ts';
import {
  RPC_FRAME_MAX_BYTES,
  RPC_FRAME_MAX_BYTES_DM_ACCEPTED,
  RPC_METHODS,
  RPC_NOTIFICATIONS,
  RPC_NOTIFICATIONS_DM,
  RPC_PROTOCOL_ID,
  RpcServer,
} from '../src/l3/rpcServer/index.ts';
import {
  PROTOCOL_PARITY_SOURCE,
  RpcClient,
  RPC_NOTIFICATIONS_DM as RPC_NOTIFICATIONS_DM_CLIENT,
} from '../src/l3/rpcClient/index.ts';
import { muxOf, protomuxChannelTransport } from '../src/l3/rpcServer/protomux.ts';
import { DM_TYPING_TTL_MS } from '../src/composition/dm.ts';

import {
  assinar,
  ate,
  conectar,
  dmKeypair,
  limparTemps,
  noDeRede,
  parDeStreams,
  subirTransporte,
  type NoDeRede,
} from './helpers/dmRede.ts';

after(() => limparTemps());

const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');

/** O `conversationId` que os dois lados derivam sozinhos (§31.2). */
function idEntre(a: NoDeRede, b: NoDeRede): string {
  const k = dmConversationKey(a.identity.publicKey, b.identity.publicKey);
  assert.notEqual(k, null);
  return (k as Buffer).toString('hex');
}

/**
 * Abre um `p2p-dm/1` **só de cliente** contra o nó alvo, como se fosse `comoQuem`. Quem
 * declara a `remotePublicKey` é o cabo — no produto é o Noise (§31.8 camada 1) —, e é isto
 * que permite mandar o quadro **errado** de propósito: o caminho de produto não constrói um
 * `coreProof` inválido, e um teste que só use o caminho feliz não mede camada nenhuma.
 */
function clienteCru(alvo: NoDeRede, comoQuem: { publicKey: Buffer }): RpcClient {
  const k = dmConversationKey(comoQuem.publicKey, alvo.identity.publicKey);
  assert.notEqual(k, null);
  const [sa, sb] = parDeStreams();
  alvo.backend.entregar({
    remotePublicKeyHex: comoQuem.publicKey.toString('hex'),
    stream: sa as never,
    topicsHex: [],
    close: () => sa.destroy(),
  });
  const transport = protomuxChannelTransport(muxOf(sb), {
    protocol: 'dm',
    id: k as Buffer,
  });
  assert.notEqual(transport, null);
  return new RpcClient({ protocol: 'dm', transport, role: 'pre-member' });
}

type RespostaCrua = { ok: boolean; code?: string; body?: Record<string, unknown> };

async function helloCru(
  alvo: NoDeRede,
  comoQuem: { publicKey: Buffer; secretKey: Buffer },
  corpo: Record<string, unknown>,
  cliente = clienteCru(alvo, comoQuem),
): Promise<RespostaCrua> {
  const r = await cliente.call('dmHello', Buffer.from(JSON.stringify(corpo), 'utf8'), {
    timeoutMs: 1_500,
  });
  if (r.ok !== true) return { ok: false, code: r.code };
  return { ok: true, body: JSON.parse(Buffer.from(r.body).toString('utf8')) as Record<string, unknown> };
}

// ─── As tabelas de protocolo ───────────────────────────────────────────────────────────

describe('§16.1/§31.8 — `p2p-dm/1` entra como terceiro protocolo', () => {
  it('id, métodos e tetos são os de §31.8/§31.18', () => {
    assert.equal(RPC_PROTOCOL_ID.dm, 'p2p-dm/1');
    assert.deepEqual([...RPC_METHODS.dm], ['dmHello']);
    // §31.18 — o default é a coluna do **par desconhecido**; a do par aceito é escolhida por
    // conexão. Um par que nunca falou comigo não paga o teto do par aceito.
    assert.equal(RPC_FRAME_MAX_BYTES.dm, 4 * 1024);
    assert.equal(RPC_FRAME_MAX_BYTES_DM_ACCEPTED, 64 * 1024);
  });

  it('servidor e cliente enxergam a mesma tabela de `p2p-dm/1`', () => {
    assert.equal(PROTOCOL_PARITY_SOURCE.dm.frameMaxBytes, RPC_FRAME_MAX_BYTES.dm);
    assert.deepEqual([...PROTOCOL_PARITY_SOURCE.dm.methods].sort(), [...RPC_METHODS.dm].sort());
    assert.deepEqual([...RPC_NOTIFICATIONS_DM_CLIENT].sort(), [...RPC_NOTIFICATIONS_DM].sort());
  });

  it('a tabela de notificações de §31.8 é separada da de §16.3, e isso é normativo', () => {
    // Fundir as duas tornaria as duas erradas: `dm.typing` não é evento de §15.5, e nenhum
    // tópico de §16.3 existe numa conversa sem host.
    assert.deepEqual([...RPC_NOTIFICATIONS_DM], ['dm.typing']);
    for (const t of RPC_NOTIFICATIONS) assert.ok(!RPC_NOTIFICATIONS_DM.has(t), t);
  });
});

// ─── O handshake, ponta a ponta ────────────────────────────────────────────────────────

describe('§31.8 — o handshake com dois nós reais', () => {
  it('quem abre apresenta o core, quem recebe fica em `pending-in` sem criar o dele', async () => {
    const a = noDeRede('alice');
    const b = noDeRede('bob');
    const id = idEntre(a, b);

    const abriu = await a.dm.abrir(b.identity.publicKey);
    assert.equal(abriu.ok, true);

    subirTransporte(a);
    subirTransporte(b);
    // §31.8 — anuncia-se sob o próprio par e procura o par da conversa. **Sem tópico.**
    assert.equal(a.backend.anunciou, true, '`pending-out` anuncia (§31.8)');
    assert.ok(a.backend.paresProcurados.has(b.identity.publicKey.toString('hex')));
    // `b` não tem conversa nenhuma ainda: não anuncia e não procura.
    assert.equal(b.backend.anunciou, false);
    assert.equal(b.backend.paresProcurados.size, 0);

    conectar(a, b);
    await ate(() => b.dm.conversa(id) !== null, 'o `dmHello` de `alice` não chegou');

    const rowB = b.dm.conversa(id);
    assert.equal(rowB?.state, 'pending-in');
    // §31.9 regra 1 — aceitar é o que cria o meu core. Antes disso, nenhum.
    assert.equal(b.cores.size, 0);
    // RD-6 — a chave do core do par foi vinculada, e vem do `dmHello`, não de adivinhação.
    assert.deepEqual(rowB?.peer_core_key, a.cores.get(id)?.key);
    assert.equal(b.eventos.filter((e) => e.topic === 'dm.requested').length, 1);

    // §31.9 — em `pending-in` a replicação do core dele é **limitada**.
    await ate(() => (b.paresAbertos.get(id)?.downloads.length ?? 0) > 0, 'não replicou o core do par');
    assert.deepEqual(b.paresAbertos.get(id)?.downloads, [`0..${P2P_DM_PENDING_MAX_RECORDS - 1}`]);

    await a.transporte?.stop();
    await b.transporte?.stop();
  });

  it('depois do aceite, os dois cores entram no mux — e **uma vez** por `(mux, core)`', async () => {
    const a = noDeRede('alice');
    const b = noDeRede('bob');
    const id = idEntre(a, b);
    await a.dm.abrir(b.identity.publicKey);
    subirTransporte(a);
    subirTransporte(b);
    conectar(a, b);
    await ate(() => b.dm.conversa(id) !== null, 'sem pedido');

    await b.dm.aceitar(id);
    b.transporte?.refresh();
    // Nova conexão depois do aceite: `b` agora tem core e se apresenta.
    conectar(a, b);
    await ate(() => a.dm.conversa(id)?.peer_core_key !== null, '`alice` não vinculou o core de `bob`');

    // §31.8(4) — os dois autorizam o canal, cada um consultando o próprio estado.
    assert.equal(a.dm.autorizaDm(b.identity.publicKey, id), true);
    assert.equal(b.dm.autorizaDm(a.identity.publicKey, id), true);

    // §31.13 — "registrar um core num mux é UMA operação por `(mux, core)`". Cada core
    // aparece uma vez por mux, mesmo com o handshake repetido na mesma conexão.
    for (const no of [a, b]) {
      for (const core of [no.cores.get(id), no.paresAbertos.get(id)]) {
        if (core === undefined) continue;
        const distintos = new Set(core.replicacoes);
        assert.equal(
          core.replicacoes.length,
          distintos.size,
          `${no.rotulo}: o mesmo mux recebeu o core duas vezes`,
        );
      }
    }
    await a.transporte?.stop();
    await b.transporte?.stop();
  });
});

// ─── Os contrafactuais das camadas de §31.8 ────────────────────────────────────────────

describe('§31.8 — as quatro camadas, cada uma com o seu contrafactual', () => {
  it('(2) `conversationId` que não deriva da `remotePublicKey` é recusado, e nada é criado', async () => {
    const b = noDeRede('bob');
    subirTransporte(b);
    const alice = dmKeypair('alice');
    const carol = dmKeypair('carol');

    // O id da conversa de `carol` com `bob`, anunciado por `alice`: transplante de conversa.
    const idErrado = (dmConversationKey(carol.publicKey, b.identity.publicKey) as Buffer).toString('hex');
    const idCerto = dmConversationKey(alice.publicKey, b.identity.publicKey) as Buffer;
    const core = dmKeypair('core-alice');

    const r = await helloCru(b, alice, {
      dmVersion: DM_VERSION,
      conversationId: idErrado,
      coreKey: b64(core.publicKey),
      coreProof: b64(assinar(alice.secretKey, dmCorePossessionHash(idCerto, core.publicKey))),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'E_DM_NOT_AUTHORIZED');
    assert.equal(b.dm.listar().length, 0, 'um id transplantado não pode criar conversa');
    await b.transporte?.stop();
  });

  it('(3) `coreProof` assinado por outra chave é recusado', async () => {
    const b = noDeRede('bob');
    subirTransporte(b);
    const alice = dmKeypair('alice');
    const impostora = dmKeypair('impostora');
    const idCerto = dmConversationKey(alice.publicKey, b.identity.publicKey) as Buffer;
    const core = dmKeypair('core-alice');

    const r = await helloCru(b, alice, {
      dmVersion: DM_VERSION,
      conversationId: idCerto.toString('hex'),
      coreKey: b64(core.publicKey),
      // A prova fecha sobre o material certo, mas com a chave errada.
      coreProof: b64(assinar(impostora.secretKey, dmCorePossessionHash(idCerto, core.publicKey))),
    });
    assert.equal(r.code, 'E_DM_NOT_AUTHORIZED');
    assert.equal(b.dm.listar().length, 0);
    await b.transporte?.stop();
  });

  it('(3) `coreProof` sobre OUTRO core é recusado — senão `coreKey` seria só uma alegação', async () => {
    const b = noDeRede('bob');
    subirTransporte(b);
    const alice = dmKeypair('alice');
    const idCerto = dmConversationKey(alice.publicKey, b.identity.publicKey) as Buffer;
    const meuCore = dmKeypair('core-alice');
    const outroCore = dmKeypair('core-de-outro');

    const r = await helloCru(b, alice, {
      dmVersion: DM_VERSION,
      conversationId: idCerto.toString('hex'),
      // Anuncia um core; prova a posse de outro. É o caso que separa prova de alegação.
      coreKey: b64(outroCore.publicKey),
      coreProof: b64(assinar(alice.secretKey, dmCorePossessionHash(idCerto, meuCore.publicKey))),
    });
    assert.equal(r.code, 'E_DM_NOT_AUTHORIZED');
    assert.equal(b.dm.listar().length, 0);
    await b.transporte?.stop();
  });

  it('`dmVersion` desconhecida é `E_VERSION_UNSUPPORTED`, e quadro que não decodifica é `E_MALFORMED`', async () => {
    const b = noDeRede('bob');
    subirTransporte(b);
    const alice = dmKeypair('alice');
    const idCerto = dmConversationKey(alice.publicKey, b.identity.publicKey) as Buffer;
    const core = dmKeypair('core-alice');
    const corpo = {
      conversationId: idCerto.toString('hex'),
      coreKey: b64(core.publicKey),
      coreProof: b64(assinar(alice.secretKey, dmCorePossessionHash(idCerto, core.publicKey))),
    };
    assert.equal((await helloCru(b, alice, { ...corpo, dmVersion: 2 })).code, 'E_VERSION_UNSUPPORTED');
    await b.transporte?.stop();
  });

  it('RD-6 no fio: o segundo `dmHello` com outro core é `E_DM_CORE_MISMATCH`', async () => {
    const b = noDeRede('bob');
    subirTransporte(b);
    const alice = dmKeypair('alice');
    const id = dmConversationKey(alice.publicKey, b.identity.publicKey) as Buffer;
    const primeiro = dmKeypair('core-alice');
    const segundo = dmKeypair('core-forjado');
    const hello = (core: { publicKey: Buffer }): Record<string, unknown> => ({
      dmVersion: DM_VERSION,
      conversationId: id.toString('hex'),
      coreKey: b64(core.publicKey),
      coreProof: b64(assinar(alice.secretKey, dmCorePossessionHash(id, core.publicKey))),
    });

    // **Um** cliente para os dois pedidos: há uma conversa por par (§31.2 regra 3), logo um
    // canal `p2p-dm/1` por par, e uma segunda conexão do mesmo par não ganha canal novo.
    const cliente = clienteCru(b, alice);
    assert.equal((await helloCru(b, alice, hello(primeiro), cliente)).ok, true);
    const r = await helloCru(b, alice, hello(segundo), cliente);
    assert.equal(r.code, 'E_DM_CORE_MISMATCH');
    assert.deepEqual(
      b.dm.conversa(id.toString('hex'))?.peer_core_key,
      primeiro.publicKey,
      'nunca sobrescrita (RD-6)',
    );
    await b.transporte?.stop();
  });

  it('bloqueado e recusado-por-política devolvem o MESMO código (§31.9 regra 2)', async () => {
    const b = noDeRede('bob');
    subirTransporte(b);
    const alice = dmKeypair('alice');
    const carol = dmKeypair('carol');
    const helloDe = (quem: { publicKey: Buffer; secretKey: Buffer }): Record<string, unknown> => {
      const id = dmConversationKey(quem.publicKey, b.identity.publicKey) as Buffer;
      const core = dmKeypair(`core-${quem.publicKey.toString('hex').slice(0, 4)}`);
      return {
        dmVersion: DM_VERSION,
        conversationId: id.toString('hex'),
        coreKey: b64(core.publicKey),
        coreProof: b64(assinar(quem.secretKey, dmCorePossessionHash(id, core.publicKey))),
      };
    };

    // `alice` vira pedido e é bloqueada. Um cliente só: um canal por par.
    const clienteAlice = clienteCru(b, alice);
    assert.equal((await helloCru(b, alice, helloDe(alice), clienteAlice)).ok, true);
    const idAlice = (dmConversationKey(alice.publicKey, b.identity.publicKey) as Buffer).toString('hex');
    b.dm.bloquear(idAlice);
    const bloqueada = await helloCru(b, alice, helloDe(alice), clienteAlice);

    // `carol` é recusada pela política de contato, nunca tendo sido bloqueada.
    b.dm.setContactPolicy('shared-community');
    const semComunidade = await helloCru(b, carol, helloDe(carol));

    assert.equal(bloqueada.code, 'E_DM_NOT_AUTHORIZED');
    assert.equal(semComunidade.code, 'E_DM_NOT_AUTHORIZED');
    assert.equal(
      bloqueada.code,
      semComunidade.code,
      'distinguir os dois seria o aviso que o bloqueio silencioso recusa dar (L-28)',
    );
    await b.transporte?.stop();
  });

  it('bloquear solta o par da descoberta e fecha o canal, em silêncio', async () => {
    const a = noDeRede('alice');
    const b = noDeRede('bob');
    const id = idEntre(a, b);
    await a.dm.abrir(b.identity.publicKey);
    subirTransporte(a);
    conectar(a, b);
    await ate(() => (a.transporte?.channelCount() ?? 0) === 1, 'canal não abriu');

    a.dm.bloquear(id);
    a.transporte?.refresh();
    assert.equal(a.transporte?.channelCount(), 0, 'o canal do bloqueado fecha');
    assert.ok(a.backend.paresSoltos.includes(b.identity.publicKey.toString('hex')));
    assert.equal(a.backend.paresProcurados.size, 0, 'paro de conectar');
    await a.transporte?.stop();
  });
});

// ─── §31.18 — os tetos ─────────────────────────────────────────────────────────────────

describe('§31.18 — controle de admissão do transporte', () => {
  it('o teto de frame do par desconhecido é 4 KiB, e é aplicado ANTES do decode', async () => {
    const b = noDeRede('bob');
    subirTransporte(b);
    const alice = dmKeypair('alice');
    const id = dmConversationKey(alice.publicKey, b.identity.publicKey) as Buffer;
    // Um `dmHello` legítimo, inflado com lixo até passar do teto. A chamada nem sai daqui:
    // o cliente aplica o mesmo teto antes do envio (§16.1).
    const r = await helloCru(b, alice, {
      dmVersion: DM_VERSION,
      conversationId: id.toString('hex'),
      coreKey: b64(dmKeypair('core-alice').publicKey),
      coreProof: b64(assinar(alice.secretKey, dmCorePossessionHash(id, dmKeypair('core-alice').publicKey))),
      enchimento: 'x'.repeat(5 * 1024),
    });
    assert.equal(r.code, 'E_PAYLOAD_TOO_LARGE');
    assert.equal(b.dm.listar().length, 0);
    await b.transporte?.stop();
  });

  it('o bucket do par desconhecido é 10 req / 60 s, e o 11º quadro não existe', async () => {
    const b = noDeRede('bob');
    subirTransporte(b);
    const alice = dmKeypair('alice');
    const id = dmConversationKey(alice.publicKey, b.identity.publicKey) as Buffer;
    const core = dmKeypair('core-alice');
    const corpo = {
      dmVersion: DM_VERSION,
      conversationId: id.toString('hex'),
      coreKey: b64(core.publicKey),
      coreProof: b64(assinar(alice.secretKey, dmCorePossessionHash(id, core.publicKey))),
    };
    // Dez passam. O décimo primeiro é descartado no bucket, antes do decode — não há código
    // de recusa a devolver, porque o quadro **não existiu** para nós (§14.4 ordem 2 → 3).
    const cliente = clienteCru(b, alice);
    for (let i = 0; i < 10; i++) assert.equal((await helloCru(b, alice, corpo, cliente)).ok, true);
    const onze = await Promise.race([
      helloCru(b, alice, corpo, cliente),
      new Promise<{ ok: false; code: string }>((r) =>
        setTimeout(() => r({ ok: false, code: 'SEM_RESPOSTA' }), 300),
      ),
    ]);
    assert.equal(onze.ok, false);
    assert.equal(onze.code, 'SEM_RESPOSTA', 'quadro limitado não é respondido, é descartado');
    await b.transporte?.stop();
  });
});

// ─── §31.8 — `dm.typing` ───────────────────────────────────────────────────────────────

describe('§31.8 — `dm.typing`, efêmero e com teto', () => {
  it('chega ao par, expira por TTL de 5 s e respeita 1 publicação / 2 s', async () => {
    const a = noDeRede('alice');
    const b = noDeRede('bob');
    const id = idEntre(a, b);
    await a.dm.abrir(b.identity.publicKey);
    subirTransporte(a);
    subirTransporte(b);
    conectar(a, b);
    await ate(() => b.dm.conversa(id) !== null, 'sem canal');

    assert.deepEqual(a.transporte?.setTyping(id, true), { ok: true });
    await ate(() => b.transporte?.typingDoPar(id) === true, '`dm.typing` não chegou');
    assert.ok(b.eventos.some((e) => e.topic === 'dm.typing' && e.data['on'] === true));

    // Teto de 1 / 2 s por conversa (§17.6, mesmos números).
    assert.deepEqual(a.transporte?.setTyping(id, true), { ok: false, code: 'E_RATE_LIMITED' });

    // TTL: sem refresh, o par para de "digitar" sozinho. Nada disto é persistido (**L-13**).
    (b.relogio as unknown as { avancar(ms: number): void }).avancar(DM_TYPING_TTL_MS + 1);
    assert.equal(b.transporte?.typingDoPar(id), false);

    await a.transporte?.stop();
    await b.transporte?.stop();
  });

  it('sem canal, `dm.typing` não enfileira — ele simplesmente não acontece (§31.16.1)', () => {
    const a = noDeRede('alice');
    subirTransporte(a);
    assert.deepEqual(a.transporte?.setTyping('0'.repeat(64), true), { ok: true });
  });
});

// ─── O canal simétrico ─────────────────────────────────────────────────────────────────

describe('§16.1/§31.1 — o canal simétrico não confunde pedido com resposta', () => {
  it('um pedido do par não resolve uma chamada pendente daqui', async () => {
    // O risco existe porque num canal simétrico os dois lados falam pelo mesmo cabo e os
    // dois numeram pedidos a partir de 1: o quadro `{i:1,m:'dmHello'}` do par tem o mesmo `i`
    // do meu pedido em voo. É `m` que separa pedido de resposta.
    const quadros: Uint8Array[] = [];
    const cabo = {
      send: (f: Uint8Array) => quadros.push(f),
      onFrame: (cb: (raw: Uint8Array) => void) => {
        entregar = cb;
      },
      onDown: () => {},
    };
    let entregar: (raw: Uint8Array) => void = () => {};
    const client = new RpcClient({ protocol: 'dm', transport: cabo });
    const pendente = client.call('dmHello', Buffer.from('{}', 'utf8'), { timeoutMs: 200 });
    assert.equal(client.inFlight, 1);

    // O **pedido** do par, com o mesmo `i`.
    entregar(Buffer.from(JSON.stringify({ i: 1, m: 'dmHello', b: '' }), 'utf8'));
    assert.equal(client.inFlight, 1, 'um pedido não pode resolver a minha chamada');

    // A resposta de verdade, sim.
    entregar(Buffer.from(JSON.stringify({ i: 1, ok: true }), 'utf8'));
    assert.deepEqual((await pendente).ok, true);
  });

  it('o servidor ignora resposta, e o cliente ignora pedido — os dois no mesmo cabo', () => {
    const enviados: Uint8Array[] = [];
    let entregar: (raw: Uint8Array) => void = () => {};
    const cabo = {
      send: (f: Uint8Array) => enviados.push(f),
      onFrame: (cb: (raw: Uint8Array) => void) => {
        entregar = cb;
      },
      onDown: () => {},
    };
    const server = new RpcServer({ protocol: 'dm', transport: cabo });
    server.register('dmHello', () => Buffer.from('ok', 'utf8'));
    // Uma **resposta** chegando ao servidor não vira pedido nem erro.
    entregar(Buffer.from(JSON.stringify({ i: 7, ok: true }), 'utf8'));
    assert.deepEqual(enviados, []);
  });
});
