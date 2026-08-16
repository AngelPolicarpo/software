# POC-01 / gate G1 — harness do `fold`

Harness experimental do gate **G1**, definido em
`docs/plano-de-validacao-experimental-v2.md` (POC-01) e implementado contra
`docs/backend-v2.md` §1, §7, §8, §9, §11.4, §19.1, §21.1, §28.1, §28.4 e §28.5.

**Isto é descartável.** Node puro, sem Electron, fora de `backend/`, porque o layout do
produto ainda é decisão aberta e este código **não deve** virar a primeira versão do
produto. O que sobrevive ao gate é a *evidência*, não o harness.

- **Leitura, buracos de spec, conflitos e a decisão:** [`REPORT.md`](./REPORT.md)
- **Resultado por cenário, ambiente, versões, logs brutos:** `out/gate-G1/`

## Rodar

```bash
npm ci
npm run build
node --max-old-space-size=10240 dist/scripts/run-all.js     # gate completo
POC01_PROFILE=quick node dist/scripts/run-all.js            # execução curta (~1 min)
npm run typecheck
```

O fuzzer é determinístico: `POC01_SEED=0x...` reproduz exatamente as mesmas entradas.

## Estrutura

```
src/
  protocol/   constantes (§27.1), erros (§20.2), kinds (§7.4), permissões (§9)
  codec/      primitivos de fio (§7.2.1), opCodec (§7.1–§7.3), idgen (§7.3)
  crypto/     Ed25519, BLAKE2b, separação de domínio (§5.1, §5.2)
  fold/       o fold: 15 estágios (§8.2), regras R-* (§8.3), efeitos (§8.4),
              DecisionState (§8.1), limites (§8.6), rank fracionário (§6.4.1)
  node/       view.db (§10.3), projetor pausável (§10.5), snapshot (§10.6), réplica
  host/       fila de admissão serializada (§11.4), host adversário (§28.5)
  client/     monta e assina op, consome authorSeq (§7.5, §19.3)
  harness/    mundo (gênese + convite + 10 clientes), as oito corridas, corpus, fuzzer
scripts/      run-unit · run-fuzz · run-races · run-adversary · run-determinism · run-all
```

## Cenários do gate

| # | Cenário | Seção | Script |
|---|---|---|---|
| 0 | Unitários dos módulos puros | §28.1 | `run-unit.ts` |
| 1 | Fuzzer de totalidade (10⁷ entradas) | §28.1, §8.5 | `run-fuzz.ts` + `fuzz-worker.ts` |
| 2 | As oito corridas de §21.1 | §21.1, §28.2 | `run-races.ts` |
| 3 | Host adversário | §1.4, §28.5 | `run-adversary.ts` |
| 4 | Determinismo do `fold` | §28.4 | `run-determinism.ts` |

## Fora do escopo

Renderer, stores, IPC, mídia, blobs, busca, presença, convites além de `invite.create`,
os outros 22 `kind`s, Electron. Ver `REPORT.md` §6 para o que este gate **não** prova.
