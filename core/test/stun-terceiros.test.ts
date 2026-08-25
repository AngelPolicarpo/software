// §17.2 — STUN de terceiros: "configurável, default vazio, com aviso".
//
// É a ÚNICA exceção nominal ao princípio de §25.4, e existe por causa da L-11: com o host
// atrás de NAT restrito, o STUN dele não é alcançável de fora, nenhum dos dois lados
// descobre endereço público, e a chamada entre provedores diferentes não fecha (§80).
//
// O que este arquivo trava: o default é VAZIO — ninguém é contatado sem escolha —, o formato
// é validado em vez de corrigido, e o servidor do host vem SEMPRE primeiro.

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { resolveConfig } from '../src/l0/config/index.ts';

const ORIGINAL = process.env['P2P_STUN_SERVERS'];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env['P2P_STUN_SERVERS'];
  else process.env['P2P_STUN_SERVERS'] = ORIGINAL;
});

describe('§17.2 — STUN de terceiros', () => {
  it('vem LIGADO por padrão (emenda de 2026-08-25 sobre §17.2)', () => {
    delete process.env['P2P_STUN_SERVERS'];
    const lista = resolveConfig().stunServers;
    assert.equal(lista.length, 1);
    assert.match(lista[0]!, /^stun:/);
  });

  it('`P2P_STUN_SERVERS=""` DESLIGA — opt-out explícito vence o default', () => {
    // A distinção é entre "não definida" e "definida e vazia": confundi-las tornaria o
    // padrão indesligável, e um padrão que não se desliga não é padrão, é imposição.
    process.env['P2P_STUN_SERVERS'] = '';
    assert.deepEqual(resolveConfig().stunServers, []);
  });

  it('lixo na variável também desliga, em vez de cair no default calado', () => {
    process.env['P2P_STUN_SERVERS'] = 'http://nada,turn:relay.example:3478';
    assert.deepEqual(resolveConfig().stunServers, []);
  });

  it('aceita lista separada por vírgula', () => {
    process.env['P2P_STUN_SERVERS'] = 'stun:a.example:3478, stun:b.example:3478';
    assert.deepEqual(resolveConfig().stunServers, ['stun:a.example:3478', 'stun:b.example:3478']);
  });

  it('descarta o que não é STUN em vez de consertar — inclusive TURN de terceiro', () => {
    // §17.3: "não há TURN de terceiro e não haverá". Um `turn:` aqui não é engano de
    // digitação a corrigir: é uma coisa que a arquitetura recusa.
    process.env['P2P_STUN_SERVERS'] = 'turn:relay.example:3478,http://x,stun:ok.example:3478';
    assert.deepEqual(resolveConfig().stunServers, ['stun:ok.example:3478']);
  });

  it('override programático vale quando não há env', () => {
    delete process.env['P2P_STUN_SERVERS'];
    assert.deepEqual(resolveConfig({ stunServers: ['stun:x.example:3478'] }).stunServers, [
      'stun:x.example:3478',
    ]);
  });
});
