// Testes do monitor de `share.health` — consolidação §17.6 e degradação automática
// §17.5 sobre a decisão real do `shareStar` (RT-08, critério G8 de perda > 3%).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MEDIA_TICKET_TTL_MS } from '../src/l1/fold/constants.ts';
import { ShareHealthMonitor, type ShareHealthSnapshot } from '../src/l2/shareStar/index.ts';
import { ShareHostSessions } from '../src/l2/shareStar/index.ts';
import { keypairFromSeed } from './helpers/world.ts';

const HOST = keypairFromSeed('host-health');
const PRESENTER = keypairFromSeed('hp-apresentador');

function hex(label: string): string {
  return keypairFromSeed(label).publicKey.toString('hex');
}

function fakeClock(): { now(): number; advance(ms: number): void } {
  let t = 1_700_000_000_000;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

interface Rig {
  clock: ReturnType<typeof fakeClock>;
  sessions: ShareHostSessions;
  monitor: ShareHealthMonitor;
  healths: readonly ShareHealthSnapshot[];
  sessionId: string;
}

function rig(quality: 'high' | 'balanced' | 'low', viewers: string[]): Rig {
  const presenterHex = PRESENTER.publicKey.toString('hex');
  const calls = new Map([['ch-voz', new Set([presenterHex, ...viewers.map((v) => hex(v))])]]);
  const members = new Map<string, { state: 'active'; roleIds: string[] }>();
  members.set(presenterHex, { state: 'active', roleIds: ['r-1'] });
  for (const v of viewers) members.set(hex(v), { state: 'active', roleIds: ['r-1'] });
  const state = {
    community: { exists: true },
    channels: new Map([['ch-voz', { type: 1, speechMode: 0 }]]),
    members,
    roles: new Map([['r-1', { permissions: [9, 11] }]]),
  };

  const clock = fakeClock();
  const sessions = new ShareHostSessions({
    hostSecretKey: HOST.secretKey,
    clock,
    ttlMs: MEDIA_TICKET_TTL_MS,
    captureTokenTtlMs: 60_000,
    isVoiceChannelType: (type) => type === 1,
    voiceParticipants: (channelId) => calls.get(channelId) ?? null,
  });

  const started = sessions.start({ state, channelId: 'ch-voz', presenterKeyHex: presenterHex, quality });
  if (!started.ok) throw new Error('start deveria passar');
  for (const v of viewers) {
    const joined = sessions.join({ sessionId: started.sessionId, memberKeyHex: hex(v) });
    if (!joined.ok) throw new Error(`join deveria passar: ${joined.code}`);
  }

  const healths: ShareHealthSnapshot[] = [];
  const monitor = new ShareHealthMonitor({
    sessions,
    tickMs: 2_000,
    onHealth: (snapshots) => healths.push(...snapshots),
  });
  return { clock, sessions, monitor, healths, sessionId: started.sessionId };
}

describe('ShareHealthMonitor — ingest e consolidação (§17.6)', () => {
  it('o snapshot lista a AUDIÊNCIA autorizada, medida ou não — é dela que o apresentador aprende a quem servir', () => {
    const v0 = hex('hv0');
    const v1 = hex('hv1');
    const r = rig('balanced', ['hv0', 'hv1']);
    r.monitor.ingest({ sessionId: r.sessionId, viewerKeyHex: v0, rttMs: 40, lossPct: 0 });
    const out = r.monitor.tick();
    assert.equal(out.length, 1);
    assert.deepEqual(r.healths, out);
    assert.equal(out[0]!.sessionId, r.sessionId);
    assert.equal(out[0]!.channelId, 'ch-voz');
    // Os DOIS espectadores aparecem: quem passou pelo `join` e coube no teto está na lista
    // desde o primeiro tick. Antes só quem já tinha amostra entrava, e o apresentador — o
    // único destinatário de `share.health` (RT-08) — não descobria a quem devia servir.
    assert.equal(out[0]!.viewers.length, 2);
    assert.deepEqual(out[0]!.viewers.find((v) => v.keyHex === v0), {
      keyHex: v0,
      rttMs: 40,
      lossPct: 0,
      quality: 'balanced',
    });
    // Sem medida, os números são OMITIDOS — zerá-los faria a UI mostrar "0 ms · 0,0%" como
    // se fosse medida, e a degradação leria uma perda que ninguém observou.
    assert.deepEqual(out[0]!.viewers.find((v) => v.keyHex === v1), { keyHex: v1, quality: 'balanced' });
  });

  it('sessão viva sem amostra nenhuma AINDA emite: é assim que a audiência chega ao apresentador', () => {
    const r = rig('balanced', ['hz0']);
    const out = r.monitor.tick();
    assert.equal(out.length, 1);
    assert.deepEqual(out[0]!.viewers, [{ keyHex: hex('hz0'), quality: 'balanced' }]);
  });

  it('amostra é latest-wins por espectador', () => {
    const v0 = hex('hw0');
    const r = rig('balanced', ['hw0']);
    r.monitor.ingest({ sessionId: r.sessionId, viewerKeyHex: v0, rttMs: 90, lossPct: 5 });
    r.monitor.ingest({ sessionId: r.sessionId, viewerKeyHex: v0, rttMs: 25, lossPct: 0.2 });
    const out = r.monitor.tick();
    assert.deepEqual(out[0]!.viewers[0], { keyHex: v0, rttMs: 25, lossPct: 0.2, quality: 'balanced' });
  });

  it('amostra inválida (NaN) e de sessão desconhecida são ignoradas', () => {
    const r = rig('balanced', ['hi0']);
    r.monitor.ingest({ sessionId: 'nada', viewerKeyHex: hex('hi0'), rttMs: 10, lossPct: 50 });
    r.monitor.ingest({ sessionId: r.sessionId, viewerKeyHex: hex('hi0'), rttMs: Number.NaN, lossPct: 1 });
    // A sessão continua viva, então o snapshot sai — mas SEM número nenhum, porque nenhuma
    // amostra válida entrou.
    const out = r.monitor.tick();
    assert.deepEqual(out[0]!.viewers, [{ keyHex: hex('hi0'), quality: 'balanced' }]);
  });
});

describe('degradação automática — perda > 3% desce o perfil pelo caminho de sistema', () => {
  it('perda acima do limiar aplica degradeTo e o payload reflete a nova qualidade', () => {
    const v0 = hex('hd0');
    const r = rig('high', ['hd0']);
    r.monitor.ingest({ sessionId: r.sessionId, viewerKeyHex: v0, rttMs: 30, lossPct: 5.5 });
    const out = r.monitor.tick();
    assert.equal(out[0]!.viewers[0]!.quality, 'balanced');
    assert.equal(r.sessions.viewerQuality(r.sessionId, v0), 'balanced');
  });

  it('na borda (3%) e abaixo nada acontece; só desce um perfil por tick', () => {
    const vBorda = hex('hb-borda');
    const vAlta = hex('hb-alta');
    const r = rig('high', ['hb-borda', 'hb-alta']);
    r.monitor.ingest({ sessionId: r.sessionId, viewerKeyHex: vBorda, rttMs: 20, lossPct: 3 });
    r.monitor.ingest({ sessionId: r.sessionId, viewerKeyHex: vAlta, rttMs: 20, lossPct: 40 });
    const out = r.monitor.tick();
    assert.equal(r.sessions.viewerQuality(r.sessionId, vBorda), 'high'); // 3% é a borda
    assert.equal(r.sessions.viewerQuality(r.sessionId, vAlta), 'balanced'); // desceu UM perfil
    assert.ok(out[0]!.viewers.find((v) => v.keyHex === vAlta)!.lossPct! > 3);
  });

  it('nunca sobe: perda zerada mantém o perfil degradado; no piso low fica low', () => {
    const v0 = hex('hn0');
    const r = rig('high', ['hn0']);
    r.monitor.ingest({ sessionId: r.sessionId, viewerKeyHex: v0, rttMs: 20, lossPct: 8 });
    r.monitor.tick();
    assert.equal(r.sessions.viewerQuality(r.sessionId, v0), 'balanced');
    r.monitor.ingest({ sessionId: r.sessionId, viewerKeyHex: v0, rttMs: 12, lossPct: 0 });
    r.monitor.tick();
    assert.equal(r.sessions.viewerQuality(r.sessionId, v0), 'balanced'); // sem subida automática
    r.monitor.ingest({ sessionId: r.sessionId, viewerKeyHex: v0, rttMs: 12, lossPct: 99 });
    r.monitor.tick(); // balanced → low
    r.monitor.ingest({ sessionId: r.sessionId, viewerKeyHex: v0, rttMs: 12, lossPct: 99 });
    r.monitor.tick(); // já no piso
    assert.equal(r.sessions.viewerQuality(r.sessionId, v0), 'low');
  });
});

describe('poda e caminho de sistema degradeTo', () => {
  it('sessão encerrada poda as amostras no tick; espectador que saiu some do snapshot', () => {
    const v0 = hex('hp0');
    const v1 = hex('hp1');
    const r = rig('balanced', ['hp0', 'hp1']);
    r.monitor.ingest({ sessionId: r.sessionId, viewerKeyHex: v0, rttMs: 10, lossPct: 0 });
    r.monitor.ingest({ sessionId: r.sessionId, viewerKeyHex: v1, rttMs: 10, lossPct: 0 });

    assert.equal(r.sessions.stop({ sessionId: r.sessionId, memberKeyHex: PRESENTER.publicKey.toString('hex') }).ok, true);
    assert.deepEqual(r.monitor.tick(), []);
    assert.deepEqual(r.healths, []);

    const r2 = rig('balanced', ['hq0', 'hq1']);
    r2.monitor.ingest({ sessionId: r2.sessionId, viewerKeyHex: hex('hq0'), rttMs: 10, lossPct: 0 });
    r2.monitor.ingest({ sessionId: r2.sessionId, viewerKeyHex: hex('hq1'), rttMs: 10, lossPct: 0 });
    r2.sessions.leave({ sessionId: r2.sessionId, memberKeyHex: hex('hq0') });
    const out = r2.monitor.tick();
    assert.equal(out[0]!.viewers.length, 1);
    assert.equal(out[0]!.viewers[0]!.keyHex, hex('hq1'));
  });

  it('degradeTo recusa subida (not-lower) e sessão inexistente (gone)', () => {
    const v0 = hex('ht0');
    const r = rig('balanced', ['ht0']);
    assert.deepEqual(r.sessions.degradeTo({ sessionId: r.sessionId, memberKeyHex: v0, quality: 'high' }), {
      ok: false,
      reason: 'not-lower',
    });
    assert.deepEqual(r.sessions.degradeTo({ sessionId: 'nada', memberKeyHex: v0, quality: 'low' }), {
      ok: false,
      reason: 'gone',
    });
    assert.deepEqual(r.sessions.degradeTo({ sessionId: r.sessionId, memberKeyHex: v0, quality: 'low' }), {
      ok: true,
      applied: true,
      quality: 'low',
    });
  });

  it('cadência normativa exposta para a composição agendar (§17.6: 2 s)', () => {
    const r = rig('balanced', ['hu0']);
    assert.equal(r.monitor.tickMs, 2_000);
  });
});
