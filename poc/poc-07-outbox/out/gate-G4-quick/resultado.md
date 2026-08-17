# G4 / POC-07 — resultado

**Decisão: CONFIRMADO**

Perfil `quick` · Ubuntu 26.04 LTS · Node v22.22.1 · 3.3 min · ADRs A03, A05, A06

## Hipótese

- **(a)** Uma operação confirmada não desaparece após queda.
- **(b)** Uma não confirmada permanece reenviável.
- **(c)** Qualquer retry do mesmo envelope produz exatamente um aceite lógico.
- **(d)** Nenhum item é descartado por idade sem reconciliação.

## Critérios

| | Critério | Medido |
|---|---|---|
| **OK** A1 | **zero** perda de operação confirmada, em todos os pontos de kill e na vazão | matriz: 0 perdidas em 9 casos (4 com morte real) · vazão: 0 perdidas em 3000 |
| **OK** A2 | **zero** duplicata lógica — nunca dois `seq` para o mesmo `(author, authorSeq)` | matriz: 0 · vazão: 0 · reenvio do mesmo envelope 3× produz um seq só |
| **OK** A3 | todo envelope incerto reconciliado por **observação da própria réplica** | ACK perdido: 1 ACKs descartados · log=10 pares=10 fila=0 |
| **OK** A4 | nenhum item commitado da outbox perdido em **nenhum** ponto de kill; o boot sempre converge | 9/9 convergiram · queimados por crash entre reserva e commit: 0 (§7.5 permite) |
| **OK** A5 | o host adversário produz `ackMismatch > 0` e o item volta a `queued` — **nunca** reportado como entregue | acked=5 mismatch=5 estados={"queued":5} removidos-como-entregues=0 |
| **OK** A6 | p95 de submissão dentro de 60 ms com group commit (§26.1; se falhar, renegocia-se o alvo, nunca a barreira) | p50=0.1875ms p95=0.34375ms p99=0.40625ms · grupo médio 30.6, máx 32 · enfileiramento FULL 0.162ms/op · WAL manifest 4148872B |
| **OK** A7 | nenhuma dependência de shutdown limpo para durabilidade — todo caso é `SIGKILL` | 4 casos com morte real por SIGKILL, todos recuperados sem close nem checkpoint |
| **OK** A8 | os cenários nomeados de POC-07, todos com oráculo explícito | 9/9 cenários |

## Limitação de evidência

O veredito vale exatamente até onde a evidência vai.

| # | O que não é medido | Por quê |
|---|---|---|
| `G4-E1` | Queda de energia não é medida — só morte de processo (`SIGKILL`). | `rocksdb-native` não expõe `WriteOptions` e o padrão do RocksDB é `sync=false`; sem `fsync` observado, o WAL fica no cache de página. `SIGKILL` não perde cache de página, corte de energia perde. §10.7.1 já declara o piso conservador. |
| `G4-E2` | Ambiente é WSL2 sobre ext4, e o custo de `fsync` medido pode não ser honesto. | O enfileiramento em `synchronous=FULL` mediu 0,1–0,2 ms/op, rápido demais para um fsync real de disco. O número de latência vale como piso, não como teto — a mesma ressalva de `G0-E1`. |
| `G4-E3` | Transporte é TCP em loopback, não Noise sobre `hyperdht` (§16.1). | O gate mede durabilidade e idempotência do caminho de escrita. O transporte precisa entregar ordem por conexão e permitir perder o ACK — as duas coisas o loopback dá. |
| `G4-E4` | A réplica lê o log por RPC do host, sem verificar prova de Merkle. | O adversário medido é o que mente no **ACK**, não o que mente nos **bytes**. Integridade de replicação é de G2, não deste gate. |
| `G4-E5` | A admissão implementa o estágio 6 de §8.2, não o `fold` completo. | A idempotência que este gate interroga é a de `(author, authorSeq)`. As 27 regras e os 38 `kind`s são evidência de G1, com 10⁷ entradas hostis. |

## Matriz de crash (§28.3)

| Ponto de kill | Morreu | Perdidas | Duplicadas | No log | Na fila | Convergiu |
|---|---|---|---|---|---|---|
| `sem-kill` | false | 0 | 0 | 40 | 0 | true |
| `host:before-append` | true | 0 | 0 | 40 | 0 | true |
| `host:after-append-before-ack` | true | 0 | 0 | 40 | 0 | true |
| `client:after-ack-before-persist` | true | 0 | 0 | 40 | 0 | true |
| `client:after-persist` | true | 0 | 0 | 40 | 0 | true |
| `client:between-view-and-manifest` | false | 0 | 0 | 40 | 0 | true |
| `client:during-checkpoint` | false | 0 | 0 | 40 | 0 | true |
| `client:before-enqueue-commit` | false | 0 | 0 | 40 | 0 | true |
| `client:after-enqueue-commit` | false | 0 | 0 | 40 | 0 | true |

## Cenários nomeados

| | Cenário | Pergunta | Medido |
|---|---|---|---|
| **OK** | ACK perdido, append durável | a op entra uma vez só e a fila esvazia sem ACK? | 1 ACKs descartados · log=10 pares=10 fila=0 |
| **OK** | ACK positivo antes do commit (impossível) | existe ACK positivo cujo registro não está no log? | itens com acked_seq=0 · registros no log=8 (host morto entre append e ACK) |
| **OK** | perda de WAL (FULL vs NORMAL) | o que sobrevive em cada banco, e a op se perde? | manifest: fila 0→0 · view: 20→20 · log=20 (o log é a verdade; view.db é derivado e reprojeta) |
| **OK** | expiração só depois de reconciliar (§11.6 r1) | idade sozinha descarta? | dropped antes=0 · depois de 1 reconciliação=3 motivo=expired expirados=3 |
| **OK** | host offline | a fila segura tudo, sem perder e sem descartar? | estados={"queued":12} perdidos=0 |
| **OK** | reenvio do mesmo envelope 3× | um `seq` só, `E_DUPLICATE` nas repetições? | seq=0 · E_DUPLICATE · E_DUPLICATE · log=1 |
| **OK** | host adversário: ACK sem append | vira `ackMismatch` e volta a `queued`, nunca "entregue"? | acked=5 mismatch=5 estados={"queued":5} removidos-como-entregues=0 |
| **OK** | reabertura com sending e awaiting-confirmation | os seis chegam ao log e a fila esvazia? | encalhados recuperados=3 ackMismatch=0 log=6 fila=0 |
| **OK** | authorSeq ultrapassado entre canais | o item ultrapassado tem desfecho nomeado, ou some? | log=1 (só o canal b) · item do canal a no log=false · estado=failed erro=E_AUTHOR_SEQ_OVERTAKEN ultrapassados=1 |

## Vazão

```json
{
  "envelopes": 3000,
  "noLog": 3000,
  "duplicadas": 0,
  "perdidas": 0,
  "p50Ms": 0.1875,
  "p95Ms": 0.34375,
  "p99Ms": 0.40625,
  "opsPorSegundo": 1123,
  "grupos": 98,
  "maiorGrupo": 32,
  "grupoMedio": 30.6,
  "walBytes": {
    "manifest": 4148872,
    "view": 4280712
  },
  "enqueueMsPorOp": 0.162,
  "ms": 2672,
  "ok": true
}
```
