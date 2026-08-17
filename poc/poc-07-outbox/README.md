# `poc-07-outbox` — harness do gate G4

Harness **descartável** de `plano-de-validacao-experimental-v2.md`, POC-07 / G4:
*durabilidade da outbox e idempotência após crash*. Existe para produzir evidência de gate,
não para virar produto — reaproveite o desenho, nunca o código.

O que ele interroga, nas palavras do plano:

> Uma operação confirmada não desaparece após queda; uma não confirmada permanece reenviável;
> qualquer retry do mesmo envelope produz **exatamente um** aceite lógico; e nenhum item é
> descartado por idade sem reconciliação.

## Como rodar

```bash
cd poc/poc-07-outbox && npm ci
npm run build
POC07_PROFILE=quick node dist/scripts/run-all.js   # ~7 min, escreve out/gate-G4-quick/
node dist/scripts/run-all.js                       # o gate; sobrescreve out/gate-G4/
```

O perfil `full` **sobrescreve `out/gate-G4/`**, que é o artefato versionado que sustenta o
veredito. Use `quick` para verificação; só rode o completo com intenção. É a mesma regra dos
outros três POCs, e ela existe porque uma corrida curta já sobrescreveu evidência uma vez.

| Perfil | Envelopes | Matriz de crash | Duração aproximada |
|---|---|---|---|
| `quick` | 3 000 | 9 pontos × 1 | ~7 min |
| `full` | 100 000 | 9 pontos × 3 | ~25 min |

## O desenho

Três processos de verdade, porque `SIGKILL` num objeto do mesmo event loop não mede nada:

```
  cliente (processo)          proxy (opcional)         host (processo)
  ─────────────────           ────────────────         ───────────────
  manifest.db  FULL   ──┐                          ┌── hypercore (RocksDB)
  view.db      NORMAL   ├── TCP loopback ──────────┤   seção crítica §11.4
  outbox §11.3          │   quadro + JSON          │   group commit §11.5
  reconciliação §11.6 ──┘   perde ACK inteiro      └── estágio 6 de §8.2
```

| Arquivo | O que implementa |
|---|---|
| `src/host/admission.ts` | §11.4 (seção crítica) e §11.5 (group commit), com o rollback do passo 7 |
| `src/host/server.ts` | transporte e os dois modos adversários de §28.5 |
| `src/client/manifest.ts` | `local_outbox` de §11.2 em `synchronous=FULL` |
| `src/client/replica.ts` | projeção em `view.db` (`NORMAL`) e a barreira de dois bancos de §10.5 |
| `src/client/outbox.ts` | máquina de estados de §11.3, backoff de §11.8, reconciliação de §11.6 |
| `src/harness/kill.ts` | os nove pontos da matriz de §28.3 |
| `src/harness/proxy.ts` | o proxy que descarta ACKs |
| `src/harness/inspect.ts` | o oráculo, lido **do disco** depois da morte |

**A morte é auto-infligida.** O processo chega ao ponto nomeado e se mata com `SIGKILL`.
Matar de fora não garante a janela entre `await append` e a resposta — e é essa janela que a
hipótese interroga. `POC07_KILL_AT=<ponto>@<n>` mata na n-ésima passagem.

**O veredito sai do disco, não do processo.** Quem morre não escreve linha de saída nenhuma;
o orquestrador reabre os arquivos e pergunta a eles o que sobrou. É o que o usuário teria.

## O que o harness reduz, e por quê

| Reduzido | Por quê |
|---|---|
| Envelope sem assinatura Ed25519 | O estágio 4 de §8.2 é evidência de G1 (10⁷ entradas hostis). Repeti-lo custaria `sodium-native` e não move critério deste gate |
| Admissão só com o estágio 6 | A idempotência interrogada aqui é a de `(author, authorSeq)` |
| Transporte TCP em loopback | Precisa de ordem por conexão e de um ponto onde perder o ACK. Noise sobre `hyperdht` é de G2 |
| Réplica lê o log por RPC | O cliente não pode abrir o RocksDB do host (§10.8 passo 3). Sem prova de Merkle: o adversário medido mente no ACK, não nos bytes |

Cada uma está declarada em `limitacaoDeEvidencia` do artefato, com id próprio (`G4-E1`…`G4-E5`).

## Achados

Estão em `REPORT.md`, e os que tocam o normativo estão em
`docs/sequenciamento-pos-fase-0.md`. O maior deles — a incompatibilidade entre o `authorSeq`
por autor de §7.5 e a ordem por canal de §11.7 — **impede a fase 3 como especificada** e é o
motivo de a medição de vazão usar um canal só.
