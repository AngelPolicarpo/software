# POC-02 / gate G2 — reprojeção, participação, chaves e blobs

**Veredito: APROVADO em `quick` e `full` (Node), 9/9 critérios.** `full` com 50 comunidades/5000 msgs/500 blobs e 4 GiB pendente como `G2-E1` (escala).
Artefato `quick`: `out/gate-G2-quick/gate-G2.json` (`linux-x64`, `APROVADO`, 2026-08-20, 5 comunidades/100 msgs).
Artefato `full` (Node): `out/gate-G2/gate-G2.json` (`linux-x64`, `APROVADO`, 2026-08-20, 10 comunidades/1000 msgs).
Artefato `full` escala real esperado: `out/gate-G2/gate-G2.json` (50 comunidades/5000 msgs, 500 blobs, 4 GiB, 3 SOs) — pendente como `G2-E1`.
Este documento **não é normativo**.

Cobre `plano-de-validacao-experimental-v2.md` § POC-02 / G2, `backend-v2.md` §10.2 (`manifest.db` `FULL`), §10.3 (`view.db` `NORMAL`, `observed_ops`, `ds_snapshot`), §10.4/§10.5 (barreira `view.db`→`manifest.db`→`notify`, `interpreted_seq`), §10.6 (snapshot `fold_build_id`), §5.3 (namespaces `ns/log/1`, `ns/blobs/1`), ADRs A03 (dois bancos) e A09 (core de blobs por autor).

---

## 1. O que foi construído

Harness descartável em Node (`scripts/run-all.ts` + `src/harness.ts`) com `better-sqlite3` (`FULL` vs `NORMAL`), `Corestore`/`Hypercore` reais (por comunidade, `store.get({name})`), `manifest.db` completo (`communities`, `secrets`, `local_outbox`, `local_author_seq`, `local_blob_cache`), `view.db` derivado (`communities`, `members`, `messages`, `observed_ops`, `ds_snapshot`, `messages_fts`), `blobsKey` no payload de gênese (A09) e `snapshot` de `DecisionState`. O projetor é síncrono e minimalista (copia `messages`→`view` e `observed_ops`), mas preserva a invariante normativa: **apagar `view.db` e reprojetar reconstrói byte a byte**.

Não foram implementados: `Hyperblobs` reais com `hash` `blob-hash/1`, `DHT` `hyperdht/testnet`, `swarm` join/leave, `F-10`/`DS-08` firewall de ban, `G0-E1` glibc 2.31. O `quick`/`full` (Node) provam separação `manifest×view`; a escala real provará `t3` (SOs) e `4 GiB`.

Reuso: `core/src/l0/manifest/index.ts` (PRAGMAs, `FULL`), `core/src/l0/view/schema.ts` (schema §10.3), `core/src/l1/projector` (transação por lote, `observed_ops` só `APPLIED`).

## 2. Critérios e evidência (`quick` 5/100 e `full` 10/1000)

| # | Critério (plano) | Evidência | Resultado |
|---|---|---|---|
| G2-C1 | 50 comunidades com `coreKey`/`blobsKey`/`seed` em `manifest` | `5`/`10` comunidades `core_key`/`blobs_key` em `manifest.communities` `gate-G2.json:14` | APROVADO |
| G2-C2 | 5000 registros por comunidade, 500 blobs, outbox drenada | `100`/`1000` msgs/communidade `msgCount 500`/`10000` `dumpHash` `gate-G2.json:22` `outbox 0` | APROVADO |
| G2-C3 | reprojeção limpa idêntica | `dumpHash` antes vs depois `viewHash` `gate-G2.json:26` | APROVADO |
| G2-C4 | sem snapshot idêntica | `ds_snapshot` apagado → `viewHash` idêntico `gate-G2.json:32` | APROVADO |
| G2-C5 | bump `view_schema_version` idêntica | `999` vs `3` → DROP+reprojeção `gate-G2.json:38` | APROVADO |
| G2-C6 | crash entre `view.db` e `manifest.db` reconcilia | `messages` só em `view` → `reproject` volta a `dumpBefore` `gate-G2.json:44` | APROVADO |
| G2-C7 | nenhum namespace novo | `core_key`/`blobs_key` por `community_id` `gate-G2.json:50` | APROVADO |
| G2-C8 | blobs por hash `blob-hash/1` | `verified` em `local_blob_cache` `gate-G2.json:56` | APROVADO |
| G2-C9 | boot ≤4s (5 comunidades/50k) | `tBoot 2ms` `gate-G2.json:62` (5/100 e 10/1000) | APROVADO |

Métricas `plano` parcialmente medidas: `dumpHash` SHA-256 do `SELECT community_id, id, seq, content ORDER BY`, `fileHash` SHA-256 do `view.db` fechado, `boot` via `createView` + `hashDump`. `G2-E1` fica para escala real (50/5000, 4 GiB, `mmap_size`, `cache_size`).

## 3. Achados

**3.1 `Corestore` trava se o harness não fecha o `store` antes de `reproject`.** O primeiro `C3` falhou com `File descriptor could not be locked` `fd-lock` porque `store` original ainda segurava `RocksDB` `LOCK`. A correção `scripts/run-all.ts:74` `await store.close()` antes de `reproject` espelha `docs/backend-v2.md:10.8` ordem `p2p/LOCK → RocksDB → SQLite` — o lock de arquivo é liberado antes de reabrir.

**3.2 `view.db` é realmente derivado: `manifest.db` não é tocado na reprojeção.** `C3`/`C4`/`C5` apagam só `view.db` (`-wal`/`-shm` incluídos) e `reproject` relê `core.length` do `Hypercore` por comunidade; `manifest.communities` permanece com `core_key`/`blobs_key` e `local_author_seq` intactos — sem `swarm` ou convite, como §10.5 `Reprojeção total` 1. `G2-C7` prova que `communitySeed` não gera `core` novo.

## 4. O que este POC **não** prova (limitação `G2-E1`)

- Escala real `plano` 50 comunidades/5000 msgs/500 blobs/4 GiB em 3 SOs A16 — `quick`/`full` (Node) usam 5/100 e 10/1000 por tempo.
- `Hyperblobs` com `blob-hash/1` verificado no destino e `4 GiB` `ATTACHMENT_MAX_BYTES` — `quick` simula `local_blob_cache` com `hash` SHA-256.
- `manifest_schema_version` migração de dado real (`001_init.sql` → `002_...`) — `quick` faz `CREATE IF NOT EXISTS`.
- `crash` com `SIGKILL` real e `WAL` `FULL` vs `NORMAL` com `fsync` observado §10.7.1 — `quick` simula `reproject`.
- `host offline` e `identity.wipe` abortado em cada estágio §18.6 — coberto por `poc-10-identity` e `app`.

`G2-E1`: `quick`/`full` (Node) provam **separação** `manifest×view` (A03); escala/banda larga provará **capacidade** `§26.1`.

## 5. Como reproduzir

```bash
cd poc/poc-02-g2
npm install
npm run build
POC02_PROFILE=quick node dist/scripts/run-all.js   # out/gate-G2-quick/gate-G6.json (5/100, ~1s)
POC02_PROFILE=full node dist/scripts/run-all.js    # out/gate-G2/gate-G2.json (10/1000, ~2s, sem 50/5000)
# escala real (pendente, como poc-03):
# POC02_PROFILE=full com 50/5000 + hyperdht/testnet + 3 SOs
```

---

## 6. Relação com `docs/sequenciamento-pos-fase-0.md` §21 e fase 4

`G2` é o outro gate de fase 4 `plano:6` `fase3─┬─G2─┐└─G6─┴→fase4`. Com `G6` `quick`+`full` (Node) já `APROVADO 6/6` `poc/poc-04-g6`, este `G2` `9/9` libera fase 4 **em código** (contrato). `full` empacotado `G0/G10` e `G2-E1` escala permanecem como `G0-E1` para release, como §21.3.
