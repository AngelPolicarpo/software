# POC-05 / G3 — Convite delegado e consumo atômico

Harness descartável para `plano-de-validacao-experimental-v2.md` **POC-05 / G3** (A08).

Cobre `backend-v2.md` **§12** (convites), **R-9** (consumo atômico via `DecisionState` na seção crítica), **R-10** (revogação automática), e as 6 defesas de **§12.6**.

Não implementa: comunidade completa, UI, FTS, voz, blobs, DHT pública. O `DecisionState` mínimo e o `HostAdmission` em memória bastam para provar a fronteira admissão→append→interpretação, como em **POC-01**.

## O que foi construído

- Host mínimo com `HostAdmission` (`core/src/l2/communityHost`) — fila de uma via por comunidade, `DecisionState` avançado na seção crítica, `append` fora dela (group commit).
- Criador não-host com `create_invite` (via `role.create` + `member.setRoles`), criador host, 10 candidatos em paralelo.
- Canal de admissão `p2p-admission/1` simulado via `InviteManager` (`core/src/l2/invites`): `liveProof` sobre `BLAKE2b('invite-auth/1' ‖ invitePk ‖ hostPk ‖ candidatePk ‖ challenge)` e `joinProof` sobre `BLAKE2b('invite-join/1' ‖ communityId ‖ invitePk ‖ candidatePk)`, ambos Ed25519 com `invitePk` do log.
- Swarm in-memory (`core/src/l0/swarm`) com `topic = BLAKE2b('invite-topic/1' ‖ invitePk)` e `join/leave` por convite ativo.

## Cenários (§12.6, plano §3 POC-05)

- Preview e resgate por convite delegado (host e não-host)
- 10 resgates simultâneos para `maxUses=1` (projeto pausado não aplicado, mas group commit com `groupMax=1` ainda serializa — prova atomicidade)
- Replay de `liveProof` por terceiro que observa o tópico (amarra `candidatePk` — T-06)
- Replay de `joinProof` já usado (`(invitePk, candidatePk)` idempotente — R-9)
- Challenge repetido (consumo único)
- Emissor banido depois de emitir (R-10)
- Candidato banido pedindo preview (desfecho `banned` alcançável via canal pré-membro sem firewall)
- 6 desfechos de preview (`ok`, `banned`, `already-member`, `invalid`, `ended`, `unreachable` cliente)

## Como reproduzir

```bash
cd poc/poc-05-g3
npm ci
npm run build
POC05_PROFILE=quick node dist/scripts/run-all.js   # escreve out/gate-G3-quick/
POC05_PROFILE=full node dist/scripts/run-all.js    # escreve out/gate-G3/ (artefato do gate)
```

O perfil `full` exercita 100 convites por host/não-host e 10 candidatos concorrentes; `quick` usa 10/10 e 3 repetições para desenvolvimento. A evidência de produto está em `core/test/invites-g3.test.ts` (9 cenários, 524 testes totais).

## Limitações declaradas

- Rede é in-memory; `hyperdht/testnet` e `protomux-rpc` real ficam para o gate empacotado (mesma ressalva de POC-01 que usou Hypercore real mas não DHT).
- Crash entre decisão e append é simulado via `MemoryCore.shouldFail` — não é `SIGKILL` de processo como em POC-07, mas prova que nenhum ACK precede durabilidade e que `DS` não avança em caso de falha (A06).
- Queda de energia e `fsync` seguem `G4-E1` (§10.7.1).
