import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  generateInviteSecret,
  inviteSecretToCode,
  inviteCodeToSecret,
  normalizeInviteCode,
  deriveInviteKeypair,
  deriveInviteSeed,
  deriveInviteTopic,
  deriveInviteTopicHex,
  liveAuthDigest,
  createLiveProof,
  verifyLiveProof,
  joinDigest,
  createJoinProof,
  verifyJoinProof,
  INVITE_SECRET_BYTES,
} from '../src/l2/invites/index.ts';

describe('invites helpers — código e derivação (§12.1)', () => {
  it('roundtrip 10B ↔ 16 chars, 4 grupos (§12.1, §15.4)', () => {
    for (let i = 0; i < 20; i++) {
      const secret = generateInviteSecret();
      assert.equal(secret.length, INVITE_SECRET_BYTES);
      const code = inviteSecretToCode(secret);
      assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      const recovered = inviteCodeToSecret(code);
      assert.ok(recovered !== null && secret.equals(recovered!));
    }
  });

  it('decodificação tolera minúsculas, `-` e espaço, e aliases I→1 L→1 O→0 (§15.4)', () => {
    const secret = Buffer.alloc(10, 0xab);
    const code = inviteSecretToCode(secret); // maiúsculo com hífens
    const lower = code.toLowerCase();
    const spaced = code.replace(/-/g, ' ');
    assert.ok(inviteCodeToSecret(lower)?.equals(secret));
    assert.ok(inviteCodeToSecret(spaced)?.equals(secret));
    // aliases: troca 1→I→L, 0→O e volta
    const aliased = lower.replace(/1/g, 'I').replace(/0/g, 'O');
    assert.ok(inviteCodeToSecret(aliased)?.equals(secret));
  });

  it('link com esquema extrai CODE16 do último segmento (§15.4)', () => {
    const secret = generateInviteSecret();
    const code = inviteSecretToCode(secret);
    const codeBare = code.replace(/-/g, '');
    const link = `https://example.com/invite/${codeBare}`;
    // normalize extrai CODE16 do último segmento, aceitando link
    const norm = normalizeInviteCode(link);
    assert.equal(norm, codeBare);
    // inviteCodeToSecret aceita link via normalize interno (§12.1 randezvous)
    const recovered = inviteCodeToSecret(link);
    assert.ok(recovered !== null && recovered!.equals(secret));
    assert.ok(inviteCodeToSecret(norm!)?.equals(secret));
  });

  it('inviteSeed e keypair são determinísticos do segredo (§12.1)', () => {
    const secret = Buffer.from('0102030405060708090a', 'hex');
    const kp1 = deriveInviteKeypair(secret);
    const kp2 = deriveInviteKeypair(secret);
    assert.ok(kp1.publicKey.equals(kp2.publicKey));
    assert.ok(kp1.secretKey.equals(kp2.secretKey));
    const seed = deriveInviteSeed(secret);
    assert.equal(seed.length, 32);
  });

  it('inviteTopic deriva de invitePk (§12.1)', () => {
    const secret = Buffer.alloc(10, 0x01);
    const { publicKey } = deriveInviteKeypair(secret);
    const topic = deriveInviteTopic(publicKey);
    assert.equal(topic.length, 32);
    assert.equal(deriveInviteTopicHex(publicKey), topic.toString('hex'));
  });

  it('liveProof amarra hostPk + candidatePk + challenge (T-06)', () => {
    const secret = generateInviteSecret();
    const { publicKey: invitePk, secretKey: inviteSk } = deriveInviteKeypair(secret);
    const hostPk = Buffer.alloc(32, 0x02);
    const candPk = Buffer.alloc(32, 0x03);
    const otherCand = Buffer.alloc(32, 0x04);
    const challenge = Buffer.alloc(16, 0x05);
    const proof = createLiveProof(inviteSk, invitePk, hostPk, candPk, challenge);
    assert.ok(verifyLiveProof(invitePk, hostPk, candPk, challenge, proof));
    // mesmo proof não vale para outro candidato (terceiro observando tópico)
    assert.equal(verifyLiveProof(invitePk, hostPk, otherCand, challenge, proof), false);
    // nem para outro host
    const otherHost = Buffer.alloc(32, 0x06);
    assert.equal(verifyLiveProof(invitePk, otherHost, candPk, challenge, proof), false);
    // nem para outro challenge (replay com challenge repetido falha por store, mas cripto tb falha)
    const otherChal = Buffer.alloc(16, 0x07);
    assert.equal(verifyLiveProof(invitePk, hostPk, candPk, otherChal, proof), false);
  });

  it('joinProof amarra communityId + invitePk + candidatePk e é verificável para sempre (§12.4)', () => {
    const secret = generateInviteSecret();
    const { publicKey: invitePk, secretKey: inviteSk } = deriveInviteKeypair(secret);
    const communityId = Buffer.alloc(32, 0x11);
    const candPk = Buffer.alloc(32, 0x22);
    const proof = createJoinProof(inviteSk, communityId, invitePk, candPk);
    assert.ok(verifyJoinProof(communityId, invitePk, candPk, proof));
    assert.equal(verifyJoinProof(Buffer.alloc(32, 0x99), invitePk, candPk, proof), false);
    assert.equal(verifyJoinProof(communityId, invitePk, Buffer.alloc(32, 0x33), proof), false);
    // digest determinístico
    const d1 = joinDigest(communityId, invitePk, candPk);
    const d2 = joinDigest(communityId, invitePk, candPk);
    assert.ok(d1.equals(d2));
    const live = liveAuthDigest(invitePk, Buffer.alloc(32, 0x02), candPk, Buffer.alloc(16, 0x05));
    assert.ok(!d1.equals(live));
  });
});
