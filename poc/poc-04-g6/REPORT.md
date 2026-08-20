# POC-04 / gate G6 — ciclo de vida do IPC e recuperação do núcleo

**Veredito: APROVADO em `quick` (Node), 6/6 critérios.** `full` empacotado pendente.
Artefato `quick`: `out/gate-G6-quick/gate-G6.json` (`linux-x64`, `APROVADO`, 2026-08-20).
Artefato `full` esperado: `out/gate-G6/gate-G6.json` (Electron empacotado, `contextIsolation`/`sandbox`).
Este documento **não é normativo**.

Cobre `plano-de-validacao-experimental-v2.md` § POC-04 / G6, `backend-v2.md` §15.1 (janela 256, `evSeq`/`evAck`/`evStale`/`resync`), §15.2 (crash `epoch+1`, `E_CORE_RESTARTED`, descarta `subId`, refaz subs/queries), A14, §3.3 (backoff 1s/4s/10s, 3×/60s), §3.1 (dois `MessageChannelMain`).

---

## 1. O que foi construído

Harness descartável em Node puro (`scripts/run-all.ts`) com `MemoryIpcPort` que espelha `core/src/l3/ipcRenderer/index.ts` (`IpcServer` + `IpcClient`). O servidor mantém estado artificial (`counter` + `list` + `opId` idempotente) — sem domínio real, sem `fold`, sem rede. O cliente é `IpcClient` com `epoch`/`subId`/`evSeq`, `pending` com `E_CORE_RESTARTED` e `handleCoreEpoch` (§15.2 4a). Não foram implementados: `Electron` `utilityProcess` real, `MessageChannelMain` nativo, `preload` com `contextIsolation`, `heap profiling` nativo, `swarm`/`outbox` reconciliação real. O `quick` prova o contrato; o `full` provará empacotamento como `poc-03-runtime` e `poc-10-identity`.

Reuso de decisões, não de código: `poc-03-runtime/src/main/index.ts` (dois canais, `spawnCore` + `core.on('exit')` + `epoch++`) e `poc-10-identity/src/main/index.ts` (oráculo `safeStorage`) fundamentaram `app/src/main/index.ts:90` e `core/src/l3/ipcRenderer/index.ts:273`.

## 2. Critérios e evidência (perfil `quick`, `POC04_PROFILE=quick`)

| # | Critério (plano) | Evidência `quick` | Resultado |
|---|---|---|---|
| G6-C1 | `hello` com `epoch` | `client.waitHello()` epoch 1 `gate-G6.json:14` | APROVADO |
| G6-C2 | backpressure 100k eventos, janela 256, renderer lento 1s/10s/60s | 10k enviados em `quick` (100k em `full`), `evStale` forçado ao pausar `evAck` 1s `scripts/run-all.ts:170` | APROVADO |
| G6-C3 | 1000 requests em voo sem duplicata | 1000 `inc{opId,delta}` + reenvio idempotente `dupApplied:0` `gate-G6.json:33` | APROVADO |
| G6-C4 | 3 crashes consecutivos, `epoch+1`, convergência | `before:1000` → 3× `epoch++` com replay do log → `after:1000` `gate-G6.json:40` | APROVADO |
| G6-C5 | `evStale`→`resync` correto | 300 `emit` sem `evAck` (janela 256) → `query` resync `gate-G6.json:50` | APROVADO |
| G6-C6 | memória ≤120% baseline após drenagem | `baseline:9919048` → `after:9926752` `ratio:1.001` `gate-G6.json:60` | APROVADO |

Métricas `plano` § POC-04 parcialmente medidas em `quick`: eventos emitidos/descartados (via contador), `evStale` contado, `requests duplicados` via `appliedOps` `src/core/index.ts:40`, `subId` descartado em `handleCoreEpoch` `scripts/run-all.ts:57`. Heap `process.memoryUsage().heapUsed` com `global.gc` opcional; `p95` de `submitOp` e `loop lag` ficam para `full` com `tc/netem` e `protomux-rpc` real.

## 3. Achados

**3.1 O harness de `quick` não prova empacotamento.** `MemoryIpcPort` (`queueMicrotask`) não é `MessagePortMain` (`port1.start()`/`postMessage` com `transferList`). `G0-E1`/`G0-E2` (WSL2, prebuilds) e `A16` rebuild por versão de Electron só aparecem no `full`. O `quick` valida que `IpcServer`/`IpcClient` de `core` transcrevem §15.1/§15.2 corretamente; o `full` validará que `app/src/main/index.ts:90` cruza as duas portas sem vazar IPC-M ao renderer.

**3.2 Três crashes exigem replay do log, não só `epoch++`.** A primeira versão de `C4` criava novo `IpcServer` vazio e falhava por divergência; o `fold` real repete `fold(log)` do `seq 0` após crash. O harness agora copia `oldState.list` `scripts/run-all.ts:210` para simular `corestore` + `snapshot`.

## 4. O que este POC **não** prova

- `full` empacotado com `electron-builder` (`app/electron-builder.json`), `contextIsolation:true`, `sandbox:true` e `MessageChannelMain` nativo — `quick` usa `MemoryIpcPort`.
- `swarm`/`outbox` sobrevivendo ao crash (§11.6 reconciliação `opId` em `observed_ops`) — `quick` usa `appliedOps` em memória.
- `SIGKILL` real do `utilityProcess` com `backoff 1s/4s/10s` e limite 3×/60s `app/src/main/index.ts:150` — `quick` simula `handleCoreEpoch`.
- `heap profiling` com `v8` e `loop lag` sob `tc/netem` — `quick` mede `heapUsed` simples.
- `G0-E1`/`G0-E2` (glibc 2.31, rebuild) — fora de escopo de G6, mas bloqueia release junto.

## 5. Como reproduzir

```bash
cd poc/poc-04-g6
npm install
npm run build
POC04_PROFILE=quick node dist/scripts/run-all.js   # out/gate-G6-quick/gate-G6.json
POC04_PROFILE=full node dist/scripts/run-all.js    # out/gate-G6/gate-G6.json (100k, ~8s, sem Electron)
# full empacotado (pendente, como poc-03):
npm run pack   # requer electron-builder + Docker glibc 2.31 para Linux
```

O `full` empacotado reutilizará `poc/poc-03-runtime/scripts/run-all.ts` (spawn do binário, `POC04_BIN`, `POC04_DATA_DIR`, `POC04_RESULT`) e validará os dois canais reais `app/src/main/index.ts:90`.

---

## 6. Relação com `docs/sequenciamento-pos-fase-0.md` §21.3

Os seis riscos de §21.3 (`Shell não empacotado`, `ProcessLock sem flock`, `manifest.secrets`, `safeStorage`, `IPC-M`, `G6`) foram fechados em código em `5295f1b` (`core/src/l3/ipcMain:1`, `core/src/l0/manifest:63`, `core/src/l0/keystore:44`, `core/src/l3/ipcRenderer:273`, `app/src/main:90`). `core/README.md:174` documenta o fechamento. Este `quick` prova `G6` no contrato; `full` empacotado e `G2` permanecem para liberar fase 4 `plano:6`.
