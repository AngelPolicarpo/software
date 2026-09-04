/**
 * §28.1 — fronteira de cada limite de §8.6: **mín−1, mín, máx, máx+1**.
 *
 * §8.6 é "tabela única e autoritativa", então o teste relê a tabela do normativo e confere os
 * números antes de exercitar as fronteiras: um limite que diverge entre a spec e o código é a
 * mesma classe de bug que dois clientes interpretando o mesmo log de forma diferente.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  LIMIT,
  INVITE_EXPIRY_MAX_MS,
  INVITE_EXPIRY_MIN_MS,
  INVITE_MAX_USES_MAX,
  INVITE_MAX_USES_MIN,
  TIMEOUT_MAX_MS,
  TIMEOUT_MIN_MS,
  checkChannelName,
  codePoints,
  isValidAttachmentName,
  slugChannelName,
} from '../src/l1/fold/index.ts';
import { genesis, joinMember, keypairFromSeed, makeRecord, T0, type Genesis } from './helpers/world.ts';

const TS = T0 + 100;

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'docs', 'backend-v2.md'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('docs/backend-v2.md não encontrado');
}
const SPEC = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');

const rep = (n: number, c = 'a'): string => c.repeat(n);

describe('§8.6 — paridade dos números com o normativo', () => {
  const casos: [string, RegExp][] = [
    ['displayName 2..32', /`Identity\.displayName` \| 2 code points \| 32 code points/],
    ['Community.name 2..40', /`Community\.name` \| 2 \| 40/],
    ['Community.description 0..120', /`Community\.description` \| 0 \| 120/],
    ['iconEmoji 1..8 / 32 B', /`Community\.iconEmoji` \| 1 code point \| 8 code points \/ 32 bytes/],
    ['Category.name 1..32', /`Category\.name` \| 1 \| 32/],
    ['Role.name 1..32', /`Role\.name` \| 1 \| 32/],
    ['nickname 1..32', /`Member\.nickname` \| 1 \| 32/],
    ['content 1..4000 / 16384 B', /`Message\.content` \| 1 \| 4000 code points \/ 16384 bytes/],
    ['mentions 0..64', /`Message\.mentions` \| 0 \| 64 itens/],
    ['emoji 1..8 / 32 B', /`Reaction\.emoji` \| 1 code point \| 8 code points \/ 32 bytes/],
    ['reason 0..200', /`reason` \(moderação\) \| 0 \| 200/],
    ['attachment name 1..255 B', /`Attachment\.name` \| 1 byte \| 255 bytes/],
    ['maxUses 1..10000', /`Invite\.maxUses` \| 1 \| 10000/],
    ['label 0..40', /`Invite\.label` \| 0 \| 40 code points/],
  ];
  for (const [nome, re] of casos) {
    it(nome, () => assert.match(SPEC, re));
  }

  it('as constantes do código são as da tabela', () => {
    assert.deepEqual(LIMIT.displayName, { minCp: 2, maxCp: 32 });
    assert.deepEqual(LIMIT.communityName, { minCp: 2, maxCp: 40 });
    assert.deepEqual(LIMIT.messageContent, { minCp: 1, maxCp: 4000, maxBytes: 16384 });
    assert.deepEqual(LIMIT.reactionEmoji, { minCp: 1, maxCp: 8, maxBytes: 32 });
    assert.deepEqual(LIMIT.attachmentName, { minBytes: 1, maxBytes: 255 });
  });

  it('§8.6 conta code points, e §27.1 declara a unidade', () => {
    assert.match(SPEC, /`TEXT_COUNT_UNIT` = code point/);
    assert.match(SPEC, /O\s*\n?`fold` \*\*não\*\* chama `Intl\.Segmenter`/);
  });
});

/** Envia um `kind` e devolve `{decision, field}` — o resumo que as fronteiras conferem. */
function tenta(g: Genesis, mk: () => ReturnType<typeof makeRecord>) {
  const r = g.world.push(mk());
  return { decision: r.decision, reason: r.reason, field: r.field };
}

describe('§8.6 — fronteiras de `Message.content`', () => {
  const { minCp, maxCp, maxBytes } = LIMIT.messageContent;

  for (const [rotulo, texto, esperado] of [
    ['mín−1 (vazio)', rep(minCp - 1), 'REJECTED'],
    ['mín', rep(minCp), 'APPLIED'],
    ['máx', rep(maxCp), 'APPLIED'],
    ['máx+1', rep(maxCp + 1), 'REJECTED'],
  ] as const) {
    it(rotulo, () => {
      const g = genesis();
      const ana = joinMember(g, 'ana');
      const r = tenta(g, () =>
        makeRecord(g.world.core, {
          kind: 'message.send',
          author: ana,
          authorSeq: g.world.next(ana),
          hostTs: TS,
          payload: { channelId: g.channelId, content: texto, mentions: [] },
        }),
      );
      assert.equal(r.decision, esperado, `${rotulo}: ${r.reason ?? ''} ${r.field ?? ''}`);
      if (esperado === 'REJECTED') assert.equal(r.field, 'content');
    });
  }

  it('o teto de **bytes** de §8.6 é inalcançável: o de code points sempre vence antes', () => {
    // Um code point ocupa no máximo 4 bytes em UTF-8, então 4000 code points cabem em 16000
    // bytes — abaixo dos 16384 declarados. Não existe conteúdo que estoure só os bytes.
    //
    // Não é bug: o teto de bytes é redundante, não errado, e o registro ainda tem o teto de
    // §8.2 (32 KiB sem anexo), que é o que de fato limita o tamanho no fio. Mas §8.6 o
    // apresenta como restrição ativa e ele nunca dispara. Era a mesma família de `OBS-05`
    // de G1 (`ATTACHMENT_MAX_BYTES` inalcançável porque a cota por membro vencia antes) —
    // esse outro caso deixou de existir em 2026-09-04 com a remoção da cota, porque o teto
    // por arquivo virou o de representação e passou a ser o único. Registrado em
    // `docs/sequenciamento-pos-fase-0.md` §17.
    assert.ok(maxCp * 4 <= maxBytes, `${maxCp} code points cabem em ${maxCp * 4} B ≤ ${maxBytes} B`);

    // O maior conteúdo possível em code points, todo em caracteres de 4 bytes: passa.
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const texto = '😀'.repeat(maxCp);
    assert.equal(codePoints(texto), maxCp);
    assert.equal(Buffer.byteLength(texto, 'utf8'), maxCp * 4);
    const r = tenta(g, () =>
      makeRecord(g.world.core, {
        kind: 'message.send',
        author: ana,
        authorSeq: g.world.next(ana),
        hostTs: TS,
        payload: { channelId: g.channelId, content: texto, mentions: [] },
      }),
    );
    // 16000 B de conteúdo ainda cabem no envelope de 32 KiB do estágio 13, então o maior
    // conteúdo possível é aceito e nenhum dos dois tetos de bytes chega a disparar.
    assert.equal(r.decision, 'APPLIED');
  });

  it('o mesmo vale para `Reaction.emoji` e `Community.iconEmoji`: 8 × 4 B = 32 B', () => {
    assert.ok(LIMIT.reactionEmoji.maxCp * 4 <= LIMIT.reactionEmoji.maxBytes);
    assert.ok(LIMIT.communityIconEmoji.maxCp * 4 <= LIMIT.communityIconEmoji.maxBytes);
  });

  it('`trim` no fim preserva quebra de linha interna', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const r = g.world.push(
      makeRecord(g.world.core, {
        kind: 'message.send',
        author: ana,
        authorSeq: g.world.next(ana),
        hostTs: TS,
        payload: { channelId: g.channelId, content: 'uma\nduas   ', mentions: [] },
      }),
    );
    const linha = r.effects.find((e) => e.t === 'upsert' && e.table === 'messages');
    assert.ok(linha?.t === 'upsert');
    assert.equal(linha.row['content'], 'uma\nduas');
  });
});

describe('§8.6 — fronteiras de `Role.name` e `Category.name`', () => {
  for (const [kind, campo, limite] of [
    ['role.create', 'name', LIMIT.roleName],
    ['category.create', 'name', LIMIT.categoryName],
  ] as const) {
    for (const [rotulo, n, esperado] of [
      ['mín−1', limite.minCp - 1, 'REJECTED'],
      ['mín', limite.minCp, 'APPLIED'],
      ['máx', limite.maxCp, 'APPLIED'],
      ['máx+1', limite.maxCp + 1, 'REJECTED'],
    ] as const) {
      it(`${kind} ${rotulo}`, () => {
        const g = genesis();
        const payload =
          kind === 'role.create'
            ? { name: rep(n), color: 1, permissions: [], mentionable: true }
            : { name: rep(n) };
        const r = tenta(g, () =>
          makeRecord(g.world.core, {
            kind,
            author: g.founder,
            authorSeq: g.world.next(g.founder),
            hostTs: TS,
            payload: payload as never,
          }),
        );
        assert.equal(r.decision, esperado, `${r.reason ?? ''} ${r.field ?? ''}`);
        if (esperado === 'REJECTED') assert.equal(r.field, campo);
      });
    }
  }
});

describe('§8.6 — `Reaction.emoji`: code points e bytes', () => {
  it('a família com ZWJ entra — era `OBS-04`, e o teto de 24 bytes a rejeitava', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const seq = g.world.next(ana);
    g.world.push(
      makeRecord(g.world.core, {
        kind: 'message.send',
        author: ana,
        authorSeq: seq,
        hostTs: TS,
        payload: { channelId: g.channelId, content: 'oi', mentions: [] },
      }),
    );
    const msg = g.world.id('message', ana, seq);
    const familia = '👨‍👩‍👧‍👦'; // 7 code points, 25 bytes
    assert.equal(codePoints(familia), 7);
    assert.equal(Buffer.byteLength(familia, 'utf8'), 25);
    const r = tenta(g, () =>
      makeRecord(g.world.core, {
        kind: 'reaction.set',
        author: ana,
        sequenceScope: { kind: 'channel', channelId: g.channelId },
        authorSeq: g.world.next(ana),
        hostTs: TS,
        payload: { messageId: msg, emoji: familia, present: true },
      }),
    );
    assert.equal(r.decision, 'APPLIED');
  });

  it('9 code points estoura, mesmo cabendo em 32 bytes', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const seq = g.world.next(ana);
    g.world.push(
      makeRecord(g.world.core, {
        kind: 'message.send',
        author: ana,
        authorSeq: seq,
        hostTs: TS,
        payload: { channelId: g.channelId, content: 'oi', mentions: [] },
      }),
    );
    const msg = g.world.id('message', ana, seq);
    const nove = rep(9, 'x');
    assert.ok(Buffer.byteLength(nove, 'utf8') <= LIMIT.reactionEmoji.maxBytes);
    const r = tenta(g, () =>
      makeRecord(g.world.core, {
        kind: 'reaction.set',
        author: ana,
        sequenceScope: { kind: 'channel', channelId: g.channelId },
        authorSeq: g.world.next(ana),
        hostTs: TS,
        payload: { messageId: msg, emoji: nove, present: true },
      }),
    );
    assert.equal(r.field, 'emoji');
  });
});

describe('§8.6 — nome de canal: normalizar (texto) e preservar (voz)', () => {
  it('texto vira slug determinístico', () => {
    assert.equal(slugChannelName('Ação  Geral!!'), 'acao-geral');
    assert.equal(slugChannelName('---já---'), 'ja');
    assert.equal(slugChannelName('ÉÊÍ'), 'eei');
  });

  it('nome que a normalização esvazia é `E_CHANNEL_NAME_EMPTY`, não `E_VALIDATION`', () => {
    const g = genesis();
    const r = tenta(g, () =>
      makeRecord(g.world.core, {
        kind: 'channel.create',
        author: g.founder,
        authorSeq: g.world.next(g.founder),
        hostTs: TS,
        payload: { categoryId: g.categoryId, type: 0, name: '###', readOnlyForRoleIds: [] },
      }),
    );
    // §20.2 tem os dois códigos, e a UI de §20.3 precisa distinguir "vazio depois de limpar"
    // de "longo demais".
    assert.equal(r.reason, 'E_CHANNEL_NAME_EMPTY');
  });

  it('voz preserva caixa e espaço', () => {
    const r = checkChannelName('Sala  de Voz', 1);
    assert.ok(r.ok);
    assert.equal(r.value, 'Sala  de Voz');
  });

  it('o slug tem teto de 32 pelo próprio regex de §8.6', () => {
    const r = checkChannelName(rep(33), 0);
    assert.equal(r.ok, false);
  });

  it('`topic` só existe em canal de texto', () => {
    const g = genesis();
    const r = tenta(g, () =>
      makeRecord(g.world.core, {
        kind: 'channel.create',
        author: g.founder,
        authorSeq: g.world.next(g.founder),
        hostTs: TS,
        payload: { categoryId: g.categoryId, type: 1, name: 'Sala', topic: 'x', readOnlyForRoleIds: [] },
      }),
    );
    assert.equal(r.field, 'topic');
  });
});

describe('§8.6 — nome de anexo: rejeitar, não sanitizar', () => {
  it('aceita nome comum', () => {
    assert.equal(isValidAttachmentName('relatório final.pdf'), true);
  });

  it('recusa separador de caminho, nulo e controle', () => {
    for (const mau of ['a/b.txt', 'a\\b.txt', 'a\0b', 'ab', 'ab']) {
      assert.equal(isValidAttachmentName(mau), false, JSON.stringify(mau));
    }
  });

  it('recusa nome reservado do Windows, com e sem extensão', () => {
    for (const mau of ['CON', 'con.txt', 'PRN', 'aux.log', 'NUL', 'COM1', 'lpt9.dat']) {
      assert.equal(isValidAttachmentName(mau), false, mau);
    }
  });

  it('recusa terminação em ponto ou espaço', () => {
    assert.equal(isValidAttachmentName('nota.'), false);
    assert.equal(isValidAttachmentName('nota '), false);
  });

  it('fronteiras de bytes: 0, 1, 255, 256', () => {
    assert.equal(isValidAttachmentName(''), false);
    assert.equal(isValidAttachmentName('a'), true);
    assert.equal(isValidAttachmentName(rep(255)), true);
    assert.equal(isValidAttachmentName(rep(256)), false);
  });

  it('sanitizar era a alternativa, e ela colapsa nomes distintos', () => {
    // v1 removia caracteres: `a/b.txt` e `ab.txt` viravam o mesmo nome, escondendo travessia
    // de caminho (`T-37`). Aqui os dois têm desfechos diferentes.
    assert.equal(isValidAttachmentName('a/b.txt'), false);
    assert.equal(isValidAttachmentName('ab.txt'), true);
  });
});

describe('§8.6 — janelas relativas ao `hostTs`', () => {
  it('`Invite.expiresAt` ∈ [hostTs+60s, hostTs+365d]', () => {
    const g = genesis();
    const casos: [number, string][] = [
      [INVITE_EXPIRY_MIN_MS - 1, 'REJECTED'],
      [INVITE_EXPIRY_MIN_MS, 'APPLIED'],
      [INVITE_EXPIRY_MAX_MS, 'APPLIED'],
      [INVITE_EXPIRY_MAX_MS + 1, 'REJECTED'],
    ];
    casos.forEach(([delta, esperado], i) => {
      const r = tenta(g, () =>
        makeRecord(g.world.core, {
          kind: 'invite.create',
          author: g.founder,
          authorSeq: g.world.next(g.founder),
          hostTs: TS,
          payload: {
            invitePublicKey: keypairFromSeed(`exp-${i}`).publicKey,
            expiresAt: TS + delta,
          },
        }),
      );
      assert.equal(r.decision, esperado, `delta ${delta}`);
      if (esperado === 'REJECTED') assert.equal(r.field, 'expiresAt');
    });
  });

  it('`Invite.maxUses` ∈ [1, 10000]', () => {
    const g = genesis();
    const casos: [number, string][] = [
      [INVITE_MAX_USES_MIN - 1, 'REJECTED'],
      [INVITE_MAX_USES_MIN, 'APPLIED'],
      [INVITE_MAX_USES_MAX, 'APPLIED'],
      [INVITE_MAX_USES_MAX + 1, 'REJECTED'],
    ];
    casos.forEach(([maxUses, esperado], i) => {
      const r = tenta(g, () =>
        makeRecord(g.world.core, {
          kind: 'invite.create',
          author: g.founder,
          authorSeq: g.world.next(g.founder),
          hostTs: TS,
          payload: { invitePublicKey: keypairFromSeed(`use-${i}`).publicKey, maxUses },
        }),
      );
      assert.equal(r.decision, esperado, `maxUses ${maxUses}`);
    });
  });

  it('`Timeout.until` ∈ [hostTs+60s, hostTs+30d]', () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const casos: [number, string][] = [
      [TIMEOUT_MIN_MS - 1, 'REJECTED'],
      [TIMEOUT_MIN_MS, 'APPLIED'],
      [TIMEOUT_MAX_MS, 'APPLIED'],
      [TIMEOUT_MAX_MS + 1, 'REJECTED'],
    ];
    for (const [delta, esperado] of casos) {
      const r = tenta(g, () =>
        makeRecord(g.world.core, {
          kind: 'mod.timeout',
          author: g.founder,
          authorSeq: g.world.next(g.founder),
          hostTs: TS,
          payload: { targetKey: ana.publicKey, until: TS + delta },
        }),
      );
      assert.equal(r.decision, esperado, `delta ${delta}`);
      if (esperado === 'REJECTED') assert.equal(r.field, 'until');
    }
  });
});

describe('§6.4.2 — a faixa de cor é recusada, nunca clampada', () => {
  it('`Role.color` é 0..6: `accent` (7) não é cor de cargo', () => {
    const g = genesis();
    for (const [color, esperado] of [
      [0, 'APPLIED'],
      [6, 'APPLIED'],
      [7, 'REJECTED'],
      [255, 'REJECTED'],
    ] as const) {
      const r = tenta(g, () =>
        makeRecord(g.world.core, {
          kind: 'role.create',
          author: g.founder,
          authorSeq: g.world.next(g.founder),
          hostTs: TS,
          payload: { name: `C${color}`, color, permissions: [], mentionable: true },
        }),
      );
      assert.equal(r.decision, esperado, `color ${color}`);
      if (esperado === 'REJECTED') assert.equal(r.field, 'color');
    }
  });

  it('`avatarColor` vai até 7', () => {
    const g = genesis();
    for (const [cor, esperado] of [
      [7, 'APPLIED'],
      [8, 'REJECTED'],
    ] as const) {
      const r = tenta(g, () =>
        makeRecord(g.world.core, {
          kind: 'identity.update',
          author: g.founder,
          authorSeq: g.world.next(g.founder),
          hostTs: TS,
          payload: { avatarColor: cor },
        }),
      );
      assert.equal(r.decision, esperado, `avatarColor ${cor}`);
    }
  });

  it('clampar faria réplicas com paletas diferentes convergirem para cores diferentes', () => {
    // Por isso a faixa é `E_VALIDATION` e não um `min(cor, MAX)`: o valor viaja em material
    // assinado, e a paleta é constante de protocolo.
    const g = genesis();
    const r = tenta(g, () =>
      makeRecord(g.world.core, {
        kind: 'community.update',
        author: g.founder,
        authorSeq: g.world.next(g.founder),
        hostTs: TS,
        payload: { iconColor: 200 },
      }),
    );
    assert.equal(r.field, 'iconColor');
    assert.equal(g.world.state.community.iconColor, 0, 'nada foi clampado');
  });
});

describe('§6.6 — `type` de canal é enum fechado `{0, 1}`', () => {
  it('valor fora da faixa é `E_VALIDATION.type`', () => {
    const g = genesis();
    for (const [type, esperado] of [
      [0, 'APPLIED'],
      [1, 'APPLIED'],
      [2, 'REJECTED'],
      [255, 'REJECTED'],
    ] as const) {
      const r = tenta(g, () =>
        makeRecord(g.world.core, {
          kind: 'channel.create',
          author: g.founder,
          authorSeq: g.world.next(g.founder),
          hostTs: TS,
          payload: { categoryId: g.categoryId, type, name: `c${type}`, readOnlyForRoleIds: [] },
        }),
      );
      assert.equal(r.decision, esperado, `type ${type}`);
      if (esperado === 'REJECTED') assert.equal(r.field, 'type');
    }
  });
});

describe('§9.1 — número de permissão fora de 0..16', () => {
  it('é `E_VALIDATION.permissions`, nunca ignorado em silêncio', () => {
    const g = genesis();
    for (const p of [17, 99, 255]) {
      const r = tenta(g, () =>
        makeRecord(g.world.core, {
          kind: 'role.create',
          author: g.founder,
          authorSeq: g.world.next(g.founder),
          hostTs: TS,
          payload: { name: 'Cargo', color: 1, permissions: [p], mentionable: true },
        }),
      );
      assert.equal(r.field, 'permissions', `permissão ${p}`);
    }
  });
});
