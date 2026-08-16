# POC-03 / gate G0 — runtime, nativos e empacotamento

**Veredito: APROVADO**, 11/11 critérios, 2026-08-16.
Artefato: `out/gate-G0/gate-G0.json`, com `addons-build.json`, `sbom.cdx.json` e
`windows/*.json` ao lado. Este documento **não é normativo**.

Cobre `adr-v2.md` A16, conforme `plano-de-validacao-experimental-v2.md` §3 POC-03.
Matriz fechada: **Windows x64 e Linux x64 glibc ≥ 2.31**. Não há alvo arm64 no v1.

---

## 1. O que foi construído

Electron **43.4.0** pinado, empacotado com `electron-builder` (`asar` + `asarUnpack`), main
+ núcleo em `utilityProcess`, dois `MessageChannelMain` (IPC-M e IPC-R), dois SQLite com os
PRAGMAs de `backend-v2.md` §10.4, corestore/Hypercore com append, transação longa,
verificação Ed25519 real e heartbeat.

Não foram implementados: domínio, `fold`, `kind`s, outbox, RPC de produto, mídia.

## 2. Resultado por critério

| # | Critério | Resultado |
|---|---|---|
| C1 | Caminho funcional completo, empacotado | `packaged: true`, 12 passos |
| C2 | p95 de boot ≤ 4 s | **379 ms** em 100 cold starts, 0 falhas |
| C3 | 10 000 appends, transações 256/2048, WAL e FTS5 | 96 ms / 0,40 ms / 1,92 ms / 1,92 ms |
| C4 | Exceção nativa não derruba o main | núcleo recusa, main vivo |
| C5 | `SIGKILL` do núcleo | main vivo, núcleo reergue, mesma chave, dado preservado |
| C6 | Três reinícios em 60 s | 3,9 s, log crescendo 0 → 1001 → 2002 |
| C7 | Diretório de dados ocupado | exatamente um abre; o outro morre com erro de lock |
| C8 | Addon **dentro** do asar | funciona: o Electron extrai para `/tmp` |
| C9 | Todo `.node` ≤ glibc 2.31, sem passo manual | 2.29 / 2.14 / 2.14 |
| C10 | IPC-M e IPC-R separadas | renderer fala com o núcleo; volta o `pid` do núcleo |
| C11 | SBOM CycloneDX | 1.6, 67 componentes, 9 nativos |

Números de boot: mínimo 324 ms, mediana 356 ms, p95 379 ms, máximo 401 ms. O núcleo fica
pronto (`core.ready`) em 62 ms na mediana; o resto é subida do Electron.

### Windows x64

Os cenários `smoke`, `smoke-ipcr`, `crash-native` e `crash-hard` foram executados no
**Windows x64 nativo**, a partir do artefato empacotado (`out/gate-G0/windows/`). Todos
aprovados, `platform: win32`, os 7 `.node` de `win32-x64` carregando de
`app.asar.unpacked`, cold start 227 ms, e o dado preservado após `SIGKILL` do núcleo.

## 3. Achados

### 3.1 Os prebuilds do npm violam o piso de glibc declarado

Medido em 2026-08-16, os prebuilds `linux-x64` publicados no npm exigem:

| Pacote | Prebuild do npm | Compilado no container | Piso de A16 |
|---|---|---|---|
| `better-sqlite3` 13.0.3 | **2.34** | 2.29 | 2.31 |
| `sodium-native` 5.1.0 | **2.33** | 2.14 | 2.31 |
| `udx-native` 1.21.0 | 2.14 | 2.14 | 2.31 |

Dois dos três estão **acima** do piso. Um v1 publicado com eles não roda em Debian 11 nem
em Ubuntu 20.04 — máquinas que a matriz promete suportar — e o gate teria passado sem notar,
porque a máquina de build tem glibc 2.43 e lá tudo funciona.

A16 já dizia isso ("o piso de glibc é do host de build"). O que este POC acrescenta é o
número: sem o container, a matriz declarada é falsa hoje, não em tese.

### 3.2 Três sistemas de build diferentes, e `@electron/rebuild` não serve para nenhum

`@electron/rebuild --force --only better-sqlite3,sodium-native,udx-native` termina com
**"Rebuild Complete" sem ter compilado nada**. Os três resolvem o binário por
`node-gyp-build`/`require-addon` e a ferramenta não os toca.

- `better-sqlite3` — tem `binding.gyp`, mas só compila com `--force_build=1`; sem isso o
  `node-gyp` termina "ok" tendo apenas tocado stamps.
- `sodium-native` e `udx-native` — **não têm `binding.gyp`**. São CMake ≥ 3.25 com
  `cmake-bare`/`cmake-fetch`/`cmake-napi`, e exigem `bare-compat-napi` instalado, senão o
  alvo Bare falha com `fatal error: bare.h` e derruba o build inteiro.

O contrato de build está em `build/Dockerfile` + `build/build-addons.sh`, e
`npmRebuild: false` no `electron-builder` impede que o empacotamento recompile no host e
desfaça o trabalho do container.

### 3.3 `asarUnpack` não é necessário para funcionar — e a razão para mantê-lo é outra

Com `asar.smartUnpack: false` e `asarUnpack: []`, **zero** `.node` ficam fora do asar e o
app funciona igual: o Electron extrai cada addon para `/tmp/.org.chromium.Chromium.XXXXXX`
e carrega de lá. O custo de boot é ruído (214 ms contra 218 ms).

Então a justificativa para `asarUnpack` não é funcional: é que sem ele o código nativo é
escrito em `/tmp` a cada início. Para um produto cujo modelo de ameaça se preocupa com
integridade de código, isso é motivo suficiente — mas é um motivo que a spec ainda não
registra.

### 3.4 Os addons carregam preguiçosamente

`better-sqlite3` e o binding do `corestore` só abrem o `.node` na **primeira conexão**, não
no `require`. Uma falha de empacotamento não aparece no boot: aparece ao abrir o banco.

Consequência para o critério "taxa de carga do addon": um teste que só suba o processo mede
a coisa errada. O harness abre os dois bancos e o core antes de declarar carga bem-sucedida.

### 3.5 O artefato carrega 69 `.node` de plataformas fora da matriz

O empacotamento leva junto os prebuilds de `darwin`, `android`, `arm64` e `linuxmusl` de
todas as dependências nativas. A matriz de A16 é inteiramente x64 e tem dois alvos. É peso
morto no instalador e superfície desnecessária. Não reprova nada; fica registrado como
ajuste de `files` a fazer antes do release.

### 3.6 OBS-02 do POC-01, refinada

`core.flush` **não existe** em `hypercore@11.35.1` — confirmado. `core.state.flush`
**existe e é função**, mas chamá-la estoura por dentro do hypercore:

```
TypeError: Cannot read properties of null (reading 'flush')
```

antes e depois de um `append`. A barreira de durabilidade real de §11 continua **em aberto**
e precisa ser resolvida antes da fase 3 / G4. Não é problema de G0 — o gate não depende dela
—, mas é entrada obrigatória para quem escrever a outbox.

### 3.7 OBS-01 do POC-01, registrada

`core.key` foi medido e gravado no artefato em todas as corridas. A decisão sobre
`communityId` ser ou não igual à chave do core permanece da fase 2; aqui só há a medida.

## 4. O que este POC **não** prova

- **`G0-E1` (A16).** O alvo Linux saiu de **WSL2**. Ficam sem evidência: registro de handler
  `xdg-mime`/`.desktop`, o deep link de §3.5 numa sessão gráfica real, cold start com o
  perfil de I/O de um disco nativo, e a entrega do secret store como um desktop a faz.
- **Os addons de Windows não foram compilados por nós.** O artefato `win32-x64` usa os
  prebuilds publicados no npm; compilar exigiria toolchain MSVC, que esta máquina não tem.
  Como são N-API, eles carregam e funcionam — provado em 4 cenários —, mas a parte do
  contrato de A16 que diz "rebuild por versão de Electron e por alvo" **não tem evidência no
  alvo Windows**. É a mesma classe de limitação que `G0-E1`, e merece registro em A16.
- **Assinatura e notarização** não foram exercitadas. O empacotamento usou o alvo `dir`.
- **Upgrade de versão de Electron com rebuild** não foi exercitado.
- **Boot após upgrade** de esquema não foi exercitado.
- G0 inclui SBOM, **não** auditoria de terceiros (§7 do plano).

## 5. Como reproduzir

```bash
cd poc/poc-03-runtime
npm ci
npm run addons                    # container de glibc 2.31 — obrigatório, ver 3.1
npm run build
npm run pack                      # artefato com asarUnpack
npm run pack:unpacked-off         # variante sem, para o critério C8
npm run sbom
POC03_PROFILE=quick node dist/scripts/run-all.js   # ~1 min, escreve out/gate-G0-quick/
POC03_PROFILE=full  node dist/scripts/run-all.js   # o gate, escreve out/gate-G0/
```

O perfil `full` **sobrescreve `out/gate-G0/`**, que é o artefato versionado que sustenta o
veredito. Para o alvo Windows: `npm run pack:win`, copiar `release/win-unpacked` para uma
pasta em `C:` e executar o `.exe` de lá, com `POC03_SCENARIO` e `POC03_RESULT` no ambiente.
