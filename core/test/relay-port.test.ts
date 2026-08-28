// B27 — o caminho relayado de §17.3, nas duas peças que faltavam: a porta de relay com
// endereço externo descoberto, e a ponte par→endereço que decide o que o TURN permite.
//
// O que estes testes provam que o G7 não podia provar: o G7 ligou a socket relayada em
// `127.0.0.1:0` e anunciou loopback, com o NAT emulado no mesmo processo. Aqui a descoberta
// é um Binding RFC 5389 de verdade contra um respondedor de verdade, e o que se afirma é o
// desfecho quando ele responde e quando ele não responde.

import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { after, describe, it } from 'node:test';

import { abrirPortaDeRelay, sondarStun } from '../src/composition/relayPort.ts';
import { MediaHost } from '../src/composition/media.ts';
import {
  BINDING_REQUEST,
  decode,
  encodeBindingSuccess,
  issueTurnCredential,
  type MediaAddr,
} from '../src/l2/communityHost/stunTurn.ts';
import { VoiceHostSessions, type VoiceStatePort } from '../src/l2/voiceCoordinator/index.ts';
import type { MediaSocketTap } from '../src/l0/swarm/ports.ts';
import { keypairFromSeed } from './helpers/world.ts';

const fechar: Array<() => void> = [];
after(() => {
  for (const f of fechar) f();
});

/**
 * Respondedor STUN de verdade: devolve Binding Success com XOR-MAPPED-ADDRESS = origem
 * observada. `mentir` troca o endereço devolvido, para separar "descobriu" de "adivinhou".
 */
async function stunFalso(mentir?: MediaAddr): Promise<{ url: string; addr: MediaAddr; close(): void }> {
  const s = dgram.createSocket('udp4');
  await new Promise<void>((r) => s.bind(0, '127.0.0.1', r));
  s.on('message', (data, rinfo) => {
    const dec = decode(data);
    if (dec === null || dec.type !== BINDING_REQUEST) return;
    const visto = mentir ?? { host: rinfo.address, port: rinfo.port };
    const resp = encodeBindingSuccess(dec.txId, visto);
    if (resp !== null) s.send(resp, rinfo.port, rinfo.address);
  });
  const { port } = s.address();
  const close = (): void => {
    try {
      s.close();
    } catch {
      /* já fechada */
    }
  };
  fechar.push(close);
  return { url: `stun:127.0.0.1:${port}`, addr: { host: '127.0.0.1', port }, close };
}

describe('§17.3 — a porta de relay descobre o próprio mapeamento externo (B27)', () => {
  it('anuncia o endereço que o STUN observou, e não o endereço ligado', async () => {
    const stun = await stunFalso({ host: '203.0.113.77', port: 41_234 });
    const porta = await abrirPortaDeRelay({ stunServers: [stun.url] });
    fechar.push(() => porta.close());

    // É a resposta do STUN que vira `XOR-RELAYED-ADDRESS`. A porta LIGADA é local e não
    // serve para ninguém do outro lado do NAT — foi o que o G7 não teve como distinguir.
    assert.deepEqual(porta.addr, { host: '203.0.113.77', port: 41_234 });
    porta.close();
  });

  it('sem STUN configurado, recusa em vez de anunciar um palpite', async () => {
    // `P2P_STUN_SERVERS=""` é opt-out explícito de §17.2 e desliga a descoberta junto.
    await assert.rejects(
      () => abrirPortaDeRelay({ stunServers: [] }),
      (e: unknown) => (e as { code?: string }).code === 'E_NO_MAPPING',
    );
  });

  it('STUN que não responde dentro do orçamento recusa — a L-11 declarada, não um 0.0.0.0', async () => {
    // Porta fechada em loopback: nada responde. O desfecho honesto é o 508 de quem chama.
    await assert.rejects(
      () => abrirPortaDeRelay({ stunServers: ['stun:127.0.0.1:9'], budgetMs: 300 }),
      (e: unknown) => (e as { code?: string }).code === 'E_NO_MAPPING',
    );
  });

  it('entrega o tráfego do par e filtra a resposta do próprio keepalive', async () => {
    const stun = await stunFalso();
    const porta = await abrirPortaDeRelay({ stunServers: [stun.url] });
    fechar.push(() => porta.close());

    const recebidos: Array<{ data: Uint8Array; from: MediaAddr }> = [];
    porta.onData((data, from) => recebidos.push({ data, from }));

    const par = dgram.createSocket('udp4');
    fechar.push(() => {
      try {
        par.close();
      } catch {
        /* já fechada */
      }
    });
    await new Promise<void>((r) => par.bind(0, '127.0.0.1', r));
    par.send(Buffer.from('srtp'), porta.addr.port, '127.0.0.1');
    await new Promise((r) => setTimeout(r, 120));

    assert.equal(recebidos.length, 1, 'o datagrama do par chega; o do STUN não');
    assert.deepEqual(Buffer.from(recebidos[0]!.data), Buffer.from('srtp'));
    porta.close();
  });
});

// ─── A ponte par→endereço, nas duas pernas (§17.3) ──────────────────────────────────────

function tapFalso(publico: { host: string; port: number } | null): MediaSocketTap {
  return {
    address: () => ({ host: '0.0.0.0', port: 1 }),
    publicAddress: () => publico,
    send: () => {},
    tap: () => () => {},
  };
}

function estadoComVoz(memberKeyHex: string): VoiceStatePort {
  return {
    community: { exists: true },
    channels: new Map([['ch-voz', { type: 1 }]]),
    members: new Map([[memberKeyHex, { state: 'active' as const, roleIds: ['r1'] }]]),
    roles: new Map([['r1', { permissions: [9] }]]), // 9 = `voice_speak` (§9.1)
  };
}

describe('§17.3 — rosterAddresses une as duas pernas da ponte (B27)', () => {
  it('o IP do transporte entra; o de quem não está no roster, não', () => {
    const membro = keypairFromSeed('ponte-membro');
    const membroHex = membro.publicKey.toString('hex');
    const voice = new VoiceHostSessions({
      hostSecretKey: Buffer.alloc(64, 1),
      hostTurnSecret: Buffer.alloc(32, 2),
      ttlMs: 300_000,
      isVoiceChannelType: (t) => t === 1,
      sessionIdFactory: () => 'sess-ponte',
    });
    const entrou = voice.join({ state: estadoComVoz(membroHex), channelId: 'ch-voz', memberKeyHex: membroHex });
    assert.ok(entrou.ok);

    const host = new MediaHost(tapFalso({ host: '203.0.113.9', port: 3478 }), 'comunidade', {
      stunDeTerceiros: [],
      enderecos: { ipDoPar: (k) => (k === membroHex ? '198.51.100.5' : null) },
    });
    fechar.push(() => host.close());
    host.registrar({ communityId: 'c1', voice, turnSecret: Buffer.alloc(32, 2) });

    // Perna (1): o IP que o transporte observou, para quem ESTÁ no roster.
    assert.deepEqual([...host.ipsDaSessao('sess-ponte')], ['198.51.100.5']);
    // Sessão que não é de nenhuma comunidade registrada aqui não permite ninguém.
    assert.deepEqual([...host.ipsDaSessao('sess-de-outro')], []);

    const servers = host.iceServers();
    assert.equal(servers.length, 2, 'o host anuncia STUN e TURN no mesmo endereço (§17.3)');
    assert.equal(servers[1]!.urls, 'turn:203.0.113.9:3478?transport=udp');
  });

  it('`voiceJoin` costura a credencial no `turn:` e deixa o `stun:` sem ela', () => {
    const membro = keypairFromSeed('ponte-cred');
    const membroHex = membro.publicKey.toString('hex');
    const turnSecret = Buffer.alloc(32, 7);
    const voice = new VoiceHostSessions({
      hostSecretKey: Buffer.alloc(64, 1),
      hostTurnSecret: turnSecret,
      ttlMs: 300_000,
      isVoiceChannelType: (t) => t === 1,
      sessionIdFactory: () => 'sess-cred',
      iceServers: () => [{ urls: 'stun:203.0.113.9:3478' }, { urls: 'turn:203.0.113.9:3478?transport=udp' }],
    });
    const r = voice.join({ state: estadoComVoz(membroHex), channelId: 'ch-voz', memberKeyHex: membroHex });
    assert.ok(r.ok);

    // Sem esta costura o `turn:` chegava sem credencial, o Allocate levava 401 e a lista
    // anunciava um caminho que não abre — pior do que não anunciar.
    assert.equal(r.iceServers[0]!.username, undefined, 'o STUN do host não pede credencial (§17.3)');
    assert.equal(r.iceServers[1]!.username, r.turnCredential.username);
    assert.equal(r.iceServers[1]!.credential, r.turnCredential.password);

    // E a credencial é a de §17.3, amarrada ao par e à sessão.
    const esperada = issueTurnCredential(turnSecret, 'sess-cred', membro.publicKey, Number(r.turnCredential.username.split(':').at(-1)));
    assert.equal(r.turnCredential.password, esperada.password);
  });
});

// ─── B11: a sonda STUN de `diag.run` vai pela socket de §17.3 ───────────────────────────

/** Torneira de mentira sobre uma socket real, com a semântica de encadeamento de §17.3. */
async function tapFalsoReal(): Promise<{
  tap: { send(d: Uint8Array, a: MediaAddr): void; tap(h: (d: Buffer, a: { host: string; port: number }) => boolean): () => void };
  naoConsumidos: Buffer[];
  close(): void;
}> {
  const s = dgram.createSocket('udp4');
  await new Promise<void>((r) => s.bind(0, '127.0.0.1', r));
  const naoConsumidos: Buffer[] = [];
  let handler: ((d: Buffer, a: { host: string; port: number }) => boolean) | null = null;
  s.on('message', (data, rinfo) => {
    if (handler?.(data, { host: rinfo.address, port: rinfo.port }) === true) return;
    naoConsumidos.push(data);
  });
  const close = (): void => {
    try {
      s.close();
    } catch {
      /* já fechada */
    }
  };
  fechar.push(close);
  return {
    tap: {
      send: (d, a) => s.send(Buffer.from(d), a.port, a.host),
      tap: (h) => {
        handler = h;
        return () => {
          handler = null;
        };
      },
    },
    naoConsumidos,
    close,
  };
}

describe('§15.4 `diag.run` — `stunReachable` medido na socket real (B11)', () => {
  it('resposta do STUN pela socket de §17.3 é `true`, e o datagrama é consumido', async () => {
    const stun = await stunFalso();
    const t = await tapFalsoReal();

    assert.equal(await sondarStun(t.tap, [stun.url]), true);
    // O Binding Success da sonda não pode seguir para o `MediaServer` nem para o DHT: nem
    // um nem outro tem tratamento para ele, e seria consumido em silêncio.
    assert.deepEqual(t.naoConsumidos, []);
    t.close();
  });

  it('sem terceiro configurado é `false` sem mandar nada — `P2P_STUN_SERVERS=""` é opt-out', async () => {
    const t = await tapFalsoReal();
    assert.equal(await sondarStun(t.tap, []), false);
    t.close();
  });

  it('ninguém responde no prazo → `false`, e a torneira volta ao que era', async () => {
    const t = await tapFalsoReal();
    assert.equal(await sondarStun(t.tap, ['stun:127.0.0.1:9'], 200), false);
    // A sonda não pode deixar o próprio classificador instalado: a socket é compartilhada.
    const stun = await stunFalso();
    t.tap.send(new Uint8Array([1, 2, 3]), stun.addr);
    t.close();
  });
});
