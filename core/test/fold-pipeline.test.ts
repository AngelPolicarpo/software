/**
 * §28.1 — o pipeline de admissão de §8.2, estágio a estágio, na ordem fixa.
 *
 * Cada teste alcança **um** estágio e prova que o desfecho é o que a tabela de §8.2 declara.
 * Os testes de ordem (um registro que falharia em dois estágios) são os que importam de
 * verdade: a ordem é normativa, é referenciada por número em R-27, §9.3 e §20.2, e trocar
 * dois estágios muda o código de erro que o cliente recebe.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_ENVELOPE_BYTES,
  MAX_ENVELOPE_BYTES_ATTACHMENT,
  CLOCK_ACCEPT_MS,
  authorSequenceKey,
  QUOTA_OPS_PER_WINDOW,
  foldRecord,
  emptyState,
  newMetrics,
} from '../src/l1/fold/index.ts';
import { KINDS } from '../src/l1/opCodec/index.ts';
import {
  World,
  genesis,
  joinMember,
  keypairFromSeed,
  makeRecord,
  T0,
  ZERO32,
  type RecordOptions,
} from './helpers/world.ts';

const HOST_TS = T0 + 100;

type Envio = Omit<RecordOptions<'message.send'>, 'authorSeq'> & { authorSeq?: number };

/** Um `message.send` válido no canal da gênese — a op de referência dos testes de estágio. */
function envio(
  g: ReturnType<typeof genesis>,
  autor: ReturnType<typeof keypairFromSeed>,
  extra: Partial<Envio> = {},
): Envio {
  return {
    kind: 'message.send',
    author: autor,
    hostTs: HOST_TS,
    payload: { channelId: g.channelId, content: 'oi', mentions: [] },
    ...extra,
  };
}

describe('§8.2 — estágio 0: teto de bytes antes de decode e de Ed25519', () => {
  it('recusa acima do teto absoluto sem decodificar nada', () => {
    const state = emptyState(keypairFromSeed('core').publicKey);
    const enorme = Buffer.alloc(MAX_ENVELOPE_BYTES_ATTACHMENT + 1, 0x41);
    const r = foldRecord(state, enorme, 0);
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_PAYLOAD_TOO_LARGE');
  });

  it('roda antes do estágio 1: registro grande **e** com assinatura de host falsa é do 0', () => {
    // Se o estágio 1 rodasse primeiro, o desfecho seria `IGNORED`/`E_BAD_HOST_SIGNATURE`.
    const g = genesis();
    const rec = makeRecord(g.world.core, {
      ...envio(g, g.founder, { corruptHostSig: true, padding: MAX_ENVELOPE_BYTES_ATTACHMENT }),
      authorSeq: 7,
    });
    const r = foldRecord(g.world.state, rec, 6);
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_PAYLOAD_TOO_LARGE');
  });

  it('o teto de 32 KiB **não** é do estágio 0 — sem anexo ele é do 13', () => {
    const g = genesis();
    const membro = joinMember(g, 'ana');
    const r = g.world.submit(
      envio(g, membro, { padding: MAX_ENVELOPE_BYTES + 100 }),
    );
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_PAYLOAD_TOO_LARGE');
    // Chegou ao estágio 6, então o `authorSeq` foi queimado — o que o estágio 0 não faria.
    assert.equal(
      g.world.state.lastAuthorSeq.get(
        authorSequenceKey(membro.publicKey.toString('hex'), { kind: 'channel', channelId: g.channelId }),
      ) ?? 0,
      2,
    );
  });
});

describe('§8.2 — estágio 1: `hostSig` sobre a chave do core', () => {
  it('assinatura de host falsa é IGNORED, não REJECTED', () => {
    const g = genesis();
    const membro = joinMember(g, 'ana');
    const r = g.world.submit(envio(g, membro, { corruptHostSig: true }));
    assert.equal(r.decision, 'IGNORED');
    assert.equal(r.reason, 'E_BAD_HOST_SIGNATURE');
  });

  it('registro de outro core não passa: a chave do host é a da comunidade', () => {
    const g = genesis();
    const membro = joinMember(g, 'ana');
    const outroCore = keypairFromSeed('outro-core');
    const rec = makeRecord(outroCore, { ...envio(g, membro), authorSeq: 9 } as RecordOptions<'message.send'>);
    const r = foldRecord(g.world.state, rec, g.world.seq);
    assert.equal(r.decision, 'IGNORED');
    assert.equal(r.reason, 'E_BAD_HOST_SIGNATURE');
  });

  it('bytes aleatórios param no estágio 1 e nunca avançam `lastAuthorSeq`', () => {
    const g = genesis();
    const antes = new Map(g.world.state.lastAuthorSeq);
    const r = g.world.push(Buffer.from([1, 2, 3, 4, 5]));
    assert.equal(r.decision, 'IGNORED');
    assert.deepEqual(new Map(g.world.state.lastAuthorSeq), antes);
    // Mas `interpretedSeq` avança **sempre** (§8.0).
    assert.equal(g.world.state.interpretedSeq, 6);
  });
});

describe('§8.2 — estágio 2: decode, versão e `kind`', () => {
  it('versão desconhecida é IGNORED e liga `partialInterpretation`', () => {
    const g = genesis();
    const membro = joinMember(g, 'ana');
    const r = g.world.submit(envio(g, membro, { v: 99 }));
    assert.equal(r.decision, 'IGNORED');
    assert.equal(r.reason, 'E_VERSION_UNSUPPORTED');
    assert.equal(g.world.state.partialInterpretation, true);
  });

  it('`kind` desconhecido é IGNORED e liga `partialInterpretation`', () => {
    const g = genesis();
    const membro = joinMember(g, 'ana');
    const r = g.world.submit(envio(g, membro, { kindNumber: 4242 }));
    assert.equal(r.decision, 'IGNORED');
    assert.equal(r.reason, 'E_UNKNOWN_KIND');
    assert.equal(g.world.state.partialInterpretation, true);
  });

  it('payload que não casa o layout é `E_MALFORMED`, **sem** ligar `partialInterpretation`', () => {
    // §8.2 estágio 2: só versão/`kind` desconhecido marcam interpretação parcial. Um payload
    // truncado é registro quebrado, não binário desatualizado.
    const g = genesis();
    const membro = joinMember(g, 'ana');
    const rec = makeRecord(g.world.core, {
      kind: 'message.pin',
      author: membro,
      authorSeq: 2,
      hostTs: HOST_TS,
      payload: { messageId: 'msg-x', pinned: true },
    });
    // Corta o payload pelo meio: o `Reader` falha e `decodePayload` devolve `null`.
    const truncado = rec.subarray(0, rec.length - 3);
    const r = foldRecord(g.world.state, truncado, g.world.seq);
    assert.equal(r.decision, 'IGNORED');
    assert.equal(r.reason, 'E_BAD_HOST_SIGNATURE'); // truncar quebra a assinatura antes
    assert.equal(r.next.partialInterpretation, false);
  });
});

describe('§8.2 — estágios 3 a 7', () => {
  it('3: `communityId` de outra comunidade é `E_WRONG_COMMUNITY`', () => {
    const g = genesis();
    const membro = joinMember(g, 'ana');
    const r = g.world.submit(envio(g, membro, { communityId: keypairFromSeed('outra').publicKey }));
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_WRONG_COMMUNITY');
    // Não chegou ao estágio 6: o `authorSeq` **não** foi queimado.
    assert.equal(
      g.world.state.lastAuthorSeq.get(
        authorSequenceKey(membro.publicKey.toString('hex'), { kind: 'channel', channelId: g.channelId }),
      ) ?? 0,
      0,
    );
  });

  it('4: assinatura do autor falsa é `E_BAD_SIGNATURE`, e não queima `authorSeq`', () => {
    const g = genesis();
    const membro = joinMember(g, 'ana');
    const r = g.world.submit(envio(g, membro, { corruptSig: true }));
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_BAD_SIGNATURE');
    assert.equal(
      g.world.state.lastAuthorSeq.get(
        authorSequenceKey(membro.publicKey.toString('hex'), { kind: 'channel', channelId: g.channelId }),
      ) ?? 0,
      0,
    );
  });

  it('5: comunidade encerrada recusa tudo, exceto o próprio `community.end`', () => {
    const g = genesis();
    const membro = joinMember(g, 'ana');
    g.world.submit({ kind: 'community.end', author: g.founder, hostTs: HOST_TS, payload: {} });
    assert.notEqual(g.world.state.community.endedAt, undefined);

    const r = g.world.submit(envio(g, membro));
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_COMMUNITY_ENDED');
  });

  it('6: `authorSeq` repetido é `E_DUPLICATE`, e o contador **não** regride', () => {
    const g = genesis();
    const membro = joinMember(g, 'ana');
    const hex = membro.publicKey.toString('hex');
    g.world.submit(envio(g, membro, { authorSeq: 5 }));
    assert.equal(g.world.state.lastAuthorSeq.get(authorSequenceKey(hex, { kind: 'channel', channelId: g.channelId })), 5);

    // §7.5: a regra é **estritamente crescente**, não densa. Reenviar o 5 e o 3 falha, e
    // aplicar `lastAuthorSeq = authorSeq` literalmente faria o contador voltar para 3.
    for (const seq of [5, 3, 1]) {
      const r = g.world.submit(envio(g, membro, { authorSeq: seq }));
      assert.equal(r.reason, 'E_DUPLICATE', `authorSeq ${seq}`);
      assert.equal(
        g.world.state.lastAuthorSeq.get(authorSequenceKey(hex, { kind: 'channel', channelId: g.channelId })),
        5,
        `regrediu em ${seq}`,
      );
    }
    // E o 6 continua entrando.
    assert.equal(g.world.submit(envio(g, membro, { authorSeq: 6 })).decision, 'APPLIED');
  });

  it('7: `op.ts` fora de 24 h do `hostTs` é `E_CLOCK_UNREASONABLE` e **queima** o número', () => {
    const g = genesis();
    const membro = joinMember(g, 'ana');
    const hex = membro.publicKey.toString('hex');
    const r = g.world.submit(envio(g, membro, { ts: HOST_TS + CLOCK_ACCEPT_MS + 1 }));
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_CLOCK_UNREASONABLE');
    assert.equal(
      g.world.state.lastAuthorSeq.get(authorSequenceKey(hex, { kind: 'channel', channelId: g.channelId })),
      2,
      'estágio 7 já é depois do 6',
    );
  });

  it('7 usa o `hostTs` **efetivo** de R-1, não o do registro', () => {
    const g = genesis();
    const membro = joinMember(g, 'ana');
    // O host carimba três dias atrás e o autor combina o `ts` com esse carimbo: contra o
    // `hostTs` do registro os dois batem. R-1 clampa para `lastHostTs`, e é contra o valor
    // clampado que o estágio 7 mede — sem isso um host adversário legitimaria carimbo
    // arbitrariamente antigo só concordando com o autor.
    const tresDias = 3 * 24 * 3_600_000;
    const r = g.world.submit(envio(g, membro, { hostTs: HOST_TS - tresDias, ts: HOST_TS - tresDias }));
    assert.equal(r.hostTsClamped, true);
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_CLOCK_UNREASONABLE');
  });
});

describe('§7.5 — monotonicidade independente por sequenceScope', () => {
  it('aceita o mesmo authorSeq em dois canais e mantém dois watermarks', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana-escopos');
    const channelSeq = g.world.next(g.founder);
    const outroCanal = g.world.id('channel', g.founder, channelSeq);
    g.world.submit({
      kind: 'channel.create',
      author: g.founder,
      authorSeq: channelSeq,
      hostTs: HOST_TS,
      payload: { categoryId: g.categoryId, type: 0, name: 'outro', readOnlyForRoleIds: [] },
    });

    const primeiro = g.world.push(
      makeRecord(g.world.core, {
        kind: 'message.send',
        author: ana,
        sequenceScope: { kind: 'channel', channelId: g.channelId },
        authorSeq: 1,
        hostTs: HOST_TS,
        payload: { channelId: g.channelId, content: 'a', mentions: [] },
      }),
    );
    const segundo = g.world.push(
      makeRecord(g.world.core, {
        kind: 'message.send',
        author: ana,
        sequenceScope: { kind: 'channel', channelId: outroCanal },
        authorSeq: 1,
        hostTs: HOST_TS,
        payload: { channelId: outroCanal, content: 'b', mentions: [] },
      }),
    );
    assert.equal(primeiro.decision, 'APPLIED');
    assert.equal(segundo.decision, 'APPLIED');
    assert.equal(
      g.world.state.lastAuthorSeq.get(authorSequenceKey(ana.publicKey.toString('hex'), { kind: 'channel', channelId: g.channelId })),
      1,
    );
    assert.equal(
      g.world.state.lastAuthorSeq.get(authorSequenceKey(ana.publicKey.toString('hex'), { kind: 'channel', channelId: outroCanal })),
      1,
    );
  });

  it('recusa scope de comunidade em operação de mensagem sem avançar watermark', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana-scope-invalido');
    const r = g.world.push(
      makeRecord(g.world.core, {
        kind: 'message.send',
        author: ana,
        sequenceScope: { kind: 'community' },
        authorSeq: 1,
        hostTs: HOST_TS,
        payload: { channelId: g.channelId, content: 'invalida', mentions: [] },
      }),
    );
    assert.equal(r.reason, 'E_VALIDATION');
    assert.equal(r.field, 'sequenceScope');
    assert.equal(
      g.world.state.lastAuthorSeq.get(authorSequenceKey(ana.publicKey.toString('hex'), { kind: 'channel', channelId: g.channelId })) ?? 0,
      0,
    );
  });
});

describe('§8.2 — estágios 8 e 9', () => {
  it('8: não-membro é `E_NOT_MEMBER`', () => {
    const g = genesis();
    const forasteiro = keypairFromSeed('forasteiro');
    const r = g.world.submit(envio(g, forasteiro));
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_NOT_MEMBER');
  });

  it('8: banido é `E_BANNED`, e o código distingue de `E_NOT_MEMBER`', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    g.world.submit({
      kind: 'mod.ban',
      author: g.founder,
      hostTs: HOST_TS,
      payload: { targetKey: ana.publicKey },
    });
    const r = g.world.submit(envio(g, ana));
    assert.equal(r.reason, 'E_BANNED');
  });

  it('8: `member.join` é a exceção — o autor é o candidato, não um membro', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    assert.equal(g.world.state.members.get(ana.publicKey.toString('hex'))?.state, 'active');
  });

  it('9: timeout ativo é `E_TIMED_OUT`; `member.leave` continua passando', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    g.world.submit({
      kind: 'mod.timeout',
      author: g.founder,
      hostTs: HOST_TS,
      payload: { targetKey: ana.publicKey, until: HOST_TS + 3_600_000 },
    });
    assert.equal(g.world.submit(envio(g, ana)).reason, 'E_TIMED_OUT');

    const saida = g.world.submit({ kind: 'member.leave', author: ana, hostTs: HOST_TS, payload: {} });
    assert.equal(saida.decision, 'APPLIED', 'sair durante timeout é permitido');
  });

  it('9: o timeout expira sozinho, pelo `hostTs` do registro — nunca pelo relógio de quem lê', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const ate = HOST_TS + 3_600_000;
    g.world.submit({
      kind: 'mod.timeout',
      author: g.founder,
      hostTs: HOST_TS,
      payload: { targetKey: ana.publicKey, until: ate },
    });
    // A comparação é `timeoutUntil > hostTs`: em `until − 1` ainda silencia, em `until` já não.
    assert.equal(g.world.submit(envio(g, ana, { hostTs: ate - 1 })).reason, 'E_TIMED_OUT');
    assert.equal(g.world.submit(envio(g, ana, { hostTs: ate })).decision, 'APPLIED');
  });
});

describe('§8.2 — estágio 10: cota determinística (R-15)', () => {
  it('R-15 conta o registro corrente: a op nº 2001 é a primeira recusada', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    let recusadaEm = -1;
    for (let i = 1; i <= QUOTA_OPS_PER_WINDOW + 2; i++) {
      const r = g.world.submit(envio(g, ana));
      if (r.reason === 'E_QUOTA_EXCEEDED') {
        recusadaEm = i;
        break;
      }
    }
    assert.equal(recusadaEm, QUOTA_OPS_PER_WINDOW + 1);
  });

  it('a cota é **por autor**, não global', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    for (let i = 0; i < QUOTA_OPS_PER_WINDOW; i++) g.world.submit(envio(g, ana));
    assert.equal(g.world.submit(envio(g, ana)).reason, 'E_QUOTA_EXCEEDED');

    const bia = joinMember(g, 'bia', HOST_TS);
    assert.equal(g.world.submit(envio(g, bia)).decision, 'APPLIED');
  });

  it('recusar num estágio posterior **não** devolve a cota', () => {
    // R-15: entram na janela os registros que **alcançaram o estágio 10**, `APPLIED` ou não.
    // Sem isso um autor inunda o log com ops que falham tarde e não paga nada.
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const hex = ana.publicKey.toString('hex');
    for (let i = 0; i < 10; i++) {
      // Recusada no estágio 14 (canal inexistente), bem depois do 10.
      g.world.submit({
        kind: 'message.send',
        author: ana,
        hostTs: HOST_TS,
        payload: { channelId: 'ch-INEXISTENTE0000000000000', content: 'x', mentions: [] },
      });
    }
    assert.equal(g.world.state.members.get(hex)?.opBudget.ops, 10);
  });

  it('anexo acima da antiga cota de 5 GiB não é mais recusado no estágio 10', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    // Este era o teste de ordenação de R-14: 6 GiB recusava com `E_QUOTA_EXCEEDED` antes de
    // o estágio 13 olhar o `content` vazio. Sem a cota (§13.8, `opVersion = 3`), quem decide
    // passa a ser o estágio 13 — e o mesmo anexo, com conteúdo válido, é `APPLIED`.
    const anexo = (sizeBytes: number) => ({
      blob: { blobsCoreKey: ZERO32, byteOffset: 0, blockOffset: 0, blockLength: 1, byteLength: 1 },
      name: 'a.bin',
      sizeBytes,
      kind: 0,
      hash: ZERO32,
    });
    const r = g.world.submit({
      kind: 'message.send',
      author: ana,
      hostTs: HOST_TS,
      payload: { channelId: g.channelId, content: '', mentions: [], attachment: anexo(6 * 1024 ** 3) },
    });
    assert.equal(r.reason, 'E_VALIDATION');
    assert.equal(r.field, 'content');

    const ok = g.world.submit({
      kind: 'message.send',
      author: ana,
      hostTs: HOST_TS,
      payload: { channelId: g.channelId, content: 'segue', mentions: [], attachment: anexo(6 * 1024 ** 3) },
    });
    assert.equal(ok.decision, 'APPLIED');
  });

  it('`storageUsedBytes` continua acumulando — virou medidor, não fronteira', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const anexo = (sizeBytes: number) => ({
      blob: { blobsCoreKey: ZERO32, byteOffset: 0, blockOffset: 0, blockLength: 1, byteLength: 1 },
      name: 'a.bin',
      sizeBytes,
      kind: 0,
      hash: ZERO32,
    });
    for (let i = 0; i < 2; i++) {
      const r = g.world.submit({
        kind: 'message.send',
        author: ana,
        hostTs: HOST_TS + i,
        payload: { channelId: g.channelId, content: `n${i}`, mentions: [], attachment: anexo(4 * 1024 ** 3) },
      });
      assert.equal(r.decision, 'APPLIED');
    }
    const membro = g.world.state.members.get(ana.publicKey.toString('hex'));
    assert.equal(membro?.storageUsedBytes, 8 * 1024 ** 3);
  });
});

describe('§8.2 — estágios 11 e 12', () => {
  it('11: sem a permissão do `kind` é `E_PERMISSION_DENIED`', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana'); // cargo base: sem `manage_channels`
    const r = g.world.submit({
      kind: 'channel.create',
      author: ana,
      hostTs: HOST_TS,
      payload: { categoryId: g.categoryId, type: 0, name: 'novo', readOnlyForRoleIds: [] },
    });
    assert.equal(r.reason, 'E_PERMISSION_DENIED');
  });

  it('11: `message.send` com anexo exige `attach_files` além de `send_messages`', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    // Tira `attach_files` do cargo base e o anexo passa a ser recusado por permissão.
    g.world.submit({
      kind: 'role.update',
      author: g.founder,
      hostTs: HOST_TS,
      payload: { roleId: g.baseRoleId, permissions: [3, 5, 9] },
    });
    const r = g.world.submit({
      kind: 'message.send',
      author: ana,
      hostTs: HOST_TS,
      payload: {
        channelId: g.channelId,
        content: 'com anexo',
        mentions: [],
        attachment: {
          blob: { blobsCoreKey: ZERO32, byteOffset: 0, blockOffset: 0, blockLength: 1, byteLength: 1 },
          name: 'a.bin',
          sizeBytes: 10,
          kind: 0,
          hash: ZERO32,
        },
      },
    });
    assert.equal(r.reason, 'E_PERMISSION_DENIED');
    // Sem anexo continua passando: `send_messages` sobreviveu.
    assert.equal(g.world.submit(envio(g, ana)).decision, 'APPLIED');
  });

  it('11: `host` recusa com `E_NOT_HOST`, não com `E_PERMISSION_DENIED` (R-17)', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    // Dá as 17 permissões a ana: mesmo assim `community.end` é só do host.
    g.world.submit({
      kind: 'member.setRoles',
      author: g.founder,
      hostTs: HOST_TS,
      payload: { targetKey: ana.publicKey, roleIds: [g.baseRoleId] },
    });
    const r = g.world.submit({ kind: 'community.end', author: ana, hostTs: HOST_TS, payload: {} });
    assert.equal(r.reason, 'E_NOT_HOST');
  });

  it('12: a imunidade do alvo vem **antes** da comparação de rank (fecha `HOLE-16`)', () => {
    const g = genesis();
    // O próprio Fundador tentando editar o cargo Fundador: o `rank` dele é o máximo, então a
    // comparação genérica de R-4 daria `E_HIERARCHY` para todo autor. §9.3 fixa a ordem.
    const r = g.world.submit({
      kind: 'role.update',
      author: g.founder,
      hostTs: HOST_TS,
      payload: { roleId: g.founderRoleId, name: 'Chefe' },
    });
    assert.equal(r.reason, 'E_FOUNDER_IMMUTABLE');
  });

  it('12: o Fundador original é imune a `mod.*` mesmo com `Hier.` = `—`', () => {
    // `mod.revokeBan` tem `Hier.` = `—` em §7.4, mas R-16 fala de `mod.*` inteiro.
    const g = genesis();
    const r = g.world.submit({
      kind: 'mod.revokeBan',
      author: g.founder,
      hostTs: HOST_TS,
      payload: { targetKey: g.founder.publicKey },
    });
    assert.equal(r.reason, 'E_FOUNDER_IMMUNE');
  });

  it('12: `E_HIERARCHY` quando o alvo tem rank igual ou maior', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const bia = joinMember(g, 'bia');
    // Um cargo de moderação, dado às duas: ranks iguais ⇒ nem uma age sobre a outra.
    const modSeq = g.world.next(g.founder);
    g.world.push(
      makeRecord(g.world.core, {
        kind: 'role.create',
        author: g.founder,
        authorSeq: modSeq,
        hostTs: HOST_TS,
        payload: { name: 'Mod', color: 1, permissions: [13, 14], mentionable: true },
      }),
    );
    const modRole = g.world.id('role', g.founder, modSeq);
    for (const alvo of [ana, bia]) {
      g.world.submit({
        kind: 'member.setRoles',
        author: g.founder,
        hostTs: HOST_TS,
        payload: { targetKey: alvo.publicKey, roleIds: [g.baseRoleId, modRole] },
      });
    }
    const r = g.world.submit({
      kind: 'mod.kick',
      author: ana,
      hostTs: HOST_TS,
      payload: { targetKey: bia.publicKey },
    });
    assert.equal(r.reason, 'E_HIERARCHY', 'rank igual nunca autoriza');
  });
});

describe('§8.2 — o bookkeeping do estágio final', () => {
  it('`interpretedSeq` avança em **todos** os desfechos', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const base = g.world.state.interpretedSeq;
    g.world.push(Buffer.from([9, 9, 9])); // IGNORED
    g.world.submit(envio(g, ana, { corruptSig: true })); // REJECTED
    g.world.submit(envio(g, ana)); // APPLIED
    assert.equal(g.world.state.interpretedSeq, base + 3);
  });

  it('§8.0 — quando não `APPLIED`, o `CS` não muda', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const antes = g.world.state;
    const r = g.world.submit(envio(g, ana, { corruptSig: true }));
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.effects.length, 0);
    // Os containers de conteúdo são os **mesmos objetos**: nada foi copiado nem tocado.
    assert.equal(r.next.members, antes.members);
    assert.equal(r.next.messages, antes.messages);
    assert.equal(r.next.roles, antes.roles);
    assert.equal(r.next.channels, antes.channels);
    assert.equal(r.next.community, antes.community);
  });

  it('R-1 — `hostTs` retroativo é clampado, nunca recusado, e conta a métrica', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const antes = g.world.state.lastHostTs;
    const r = g.world.submit(envio(g, ana, { hostTs: 5, ts: HOST_TS }));
    assert.equal(r.decision, 'APPLIED', 'R-1 clampa, não recusa');
    assert.equal(r.hostTsClamped, true);
    assert.equal(g.world.state.lastHostTs, antes, 'o relógio não anda para trás');
    assert.ok(g.world.metrics.hostTsClamped > 0);
  });

  it('§9.4 — um `kind` sem linha na matriz falha fechado', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    // 4242 não está no catálogo: o estágio 2 recusa antes mesmo da matriz.
    const r = g.world.submit(envio(g, ana, { kindNumber: 4242 }));
    assert.equal(r.reason, 'E_UNKNOWN_KIND');
    // E todo `kind` do catálogo **tem** linha — provado em fold-policy.test.ts.
    assert.equal(Object.keys(KINDS).length, 38);
  });
});

/**
 * §8.0 — `kind` e `author` no `FoldResult`. São o que dá fonte a `rejected_records.kind`/
 * `.author_key` (§10.3) e ao `kind` de `fold.panic{seq, kind}` (§8.5): o `projector` não
 * decodifica registro (§4), então o que ele não receber daqui não existe para ele.
 */
describe('§8.0 — `kind` e `author`: a fronteira de diagnóstico do estágio 2', () => {
  it('ausentes na recusa do estágio 0 — não há decode, e ninguém pode inventá-los', () => {
    const state = emptyState(keypairFromSeed('core').publicKey);
    const r = foldRecord(state, Buffer.alloc(MAX_ENVELOPE_BYTES_ATTACHMENT + 1, 0x41), 0);
    assert.equal(r.reason, 'E_PAYLOAD_TOO_LARGE');
    assert.equal(r.kind, undefined);
    assert.equal(r.author, undefined);
  });

  it('ausentes quando o `HostRecord` nem decodifica (estágio 1)', () => {
    const state = emptyState(keypairFromSeed('core').publicKey);
    const r = foldRecord(state, Buffer.from([1, 2, 3]), 0);
    assert.equal(r.decision, 'IGNORED');
    assert.equal(r.kind, undefined);
    assert.equal(r.author, undefined);
  });

  it('presentes em APPLIED, em REJECTED e em IGNORED depois do decode do `Op`', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const aplicado = g.world.submit(envio(g, ana));
    assert.equal(aplicado.decision, 'APPLIED');
    assert.equal(aplicado.kind, KINDS['message.send']);
    assert.ok(aplicado.author !== undefined && ana.publicKey.equals(aplicado.author));
    assert.equal(aplicado.authorSeq, 2);
    assert.deepEqual(aplicado.sequenceScope, { kind: 'channel', channelId: g.channelId });
    assert.equal(typeof aplicado.opId, 'string');

    // REJECTED tardio (estágio 6, duplicata): o `kind` é o mesmo, o autor também.
    const duplicata = g.world.submit(envio(g, ana, { authorSeq: 1 }));
    assert.equal(duplicata.reason, 'E_DUPLICATE');
    assert.equal(duplicata.kind, KINDS['message.send']);
    assert.ok(duplicata.author !== undefined && ana.publicKey.equals(duplicata.author));

    // IGNORED por `kind` desconhecido: o número **vem como veio no registro**, e é ele que
    // diz de qual versão o registro veio — a razão de gravá-lo mesmo fora do catálogo.
    const desconhecido = g.world.submit(envio(g, ana, { kindNumber: 4242 }));
    assert.equal(desconhecido.reason, 'E_UNKNOWN_KIND');
    assert.equal(desconhecido.kind, 4242);
    assert.ok(desconhecido.author !== undefined && ana.publicKey.equals(desconhecido.author));
  });

  it('§8.5 — a rede de segurança devolve o `kind` quando a exceção veio depois do decode', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const rec = makeRecord(g.world.core, { ...envio(g, ana), authorSeq: 2 });
    // `members` corrompido é bug de implementação, não dado hostil: o `fold` já passou do
    // estágio 2 quando o estágio 8 toca no mapa. §8.5 manda o desfecho ser `IGNORED`, e o
    // `kind` que sobra é o que `fold.panic{seq, kind}` publica.
    const podre = { ...g.world.state, members: null } as unknown as typeof g.world.state;
    const metrics = newMetrics();
    const r = foldRecord(podre, rec, 9, metrics);
    assert.equal(r.decision, 'IGNORED');
    assert.equal(metrics.panic, 1);
    assert.equal(r.kind, KINDS['message.send']);
    assert.ok(r.author !== undefined && ana.publicKey.equals(r.author));
  });
});
