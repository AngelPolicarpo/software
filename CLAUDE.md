# Project instructions

## Purpose

Comunidade P2P de voz, vídeo e tela, sem servidor central. Cada comunidade é hospedada pela máquina de quem a criou.

O repositório está em transição de especificação para implementação. O `core/` é o primeiro código de produto; `frontend/` é atualmente apenas um mock.

## Repository map

- `core/`: código de produto do núcleo (`fold`, `projector`, `view`, `opCodec`, `idgen`, `permissions`, `manifest`, `outbox`, `communityHost`).
- `frontend/`: Vite + React + TypeScript + Tailwind + Zustand; dados mockados; não contém P2P.
- `poc/`: harnesses descartáveis usados para produzir evidência dos gates. Reaproveite decisões e evidências, não o código.
- `docs/`: arquitetura v2, ADRs, plano de validação e auditorias.
- `backend/`: remanescente do layout antigo; o núcleo não fica aqui.
- `graphify-out/`: grafo derivado do repositório; não é versionado.

## Source of truth

Quando houver conflito, a precedência normativa é:

1. `docs/backend-v2.md`
2. `docs/adr-v2.md`
3. `docs/plano-de-validacao-experimental-v2.md`
4. `docs/deltas-ux-v2.md`
5. `docs/frontend.md`
6. `docs/resolucao-arquitetural-v2.md`

Os documentos históricos (`docs/backend.md`, auditorias e pareceres) não têm precedência.

Os `poc/**/REPORT.md` não são normativos, mas devem ser consultados antes de reabrir decisões já validadas experimentalmente.

Se a especificação normativa não responder algo, não invente comportamento. Registre o problema como lacuna de especificação e siga a investigação apropriada.

## Architecture constraints

- O produto é Electron, não um web app: main + `utilityProcess` + renderer, com IPC-R e IPC-M como fronteiras distintas.
- O estado da comunidade é `fold(log)`: função pura, total e determinística sobre o log append-only.
- O v1 suporta somente Windows x64 e Linux x64 com glibc >= 2.31. macOS, Alpine/musl e ARM estão fora de escopo.
- Addons nativos exigem rebuild por versão de Electron. No Linux, o build deve respeitar o piso de glibc declarado.
- Dados permanecem na máquina do host e são descobertos via DHT.
- Voz é mesh P2P direto. Tela usa WebRTC em estrela, com `SHARE_MAX_VIEWERS = 8`; multicast em árvore está fora do v1.
- TURN só entra quando NAT impedir conexão direta.
- Marcações `REQUIRES POC` e `BENCHMARK REQUIRED` bloqueiam a implementação da parte dependente até existir evidência correspondente. A UI não anuncia números que ainda não foram medidos.

## Gates and evidence

Fases e gates liberados no estado atual:

- G0: aprovado; libera fase 1.
- G10: aprovado nos dois alvos; libera fase 1.
- G1: confirmado; libera fase 2.
- G4: confirmado no harness anterior; o contrato foi emendado e a implementação deve seguir a spec v2, não copiar o harness. A fase 3 está liberada para implementação, mas ainda não está validada para release.

Não assuma que um gate provou propriedades fora do seu escopo. Consulte os respectivos `REPORT.md` antes de reutilizar conclusões experimentais.

Para G4, em especial, consulte `poc/poc-07-outbox/REPORT.md` e `docs/sequenciamento-pos-fase-0.md` antes de modificar a outbox.

## Workflow

1. Antes de alterar código, consulte o Graphify para localizar conceitos, relações e arquivos relevantes.
2. Leia diretamente os arquivos identificados pelo grafo para confirmar código, decisões e texto normativo.
3. Antes de implementar uma decisão arquitetural, consulte os documentos normativos e o evidence/report do gate relacionado.
4. Faça a menor alteração coerente com a arquitetura existente. Não introduza abstrações novas sem necessidade.
5. Depois da alteração, execute primeiro a validação mais específica; em seguida, execute a validação completa aplicável.
6. Não altere artefatos de gate versionados, migrações/evidências históricas ou outros artefatos de validação apenas para "fazer passar" um teste.
7. Não publique, faça operações destrutivas ou altere decisões arquiteturais sem confirmação explícita.

## Commands

### Frontend

```bash
cd frontend
npm run dev
npm run build
npm run lint
```

Não há test runner no `frontend/`. `npm run build` e `npm run lint` são a validação disponível.

### Core

```bash
cd core
npm run build
npm test
npm run typecheck
```

`npm run build` inclui a barreira de camadas definida pela arquitetura.

### G1

```bash
cd poc/poc-01-fold
npm ci
npm run build
POC01_PROFILE=quick node dist/scripts/run-all.js
```

O gate completo sobrescreve `out/gate-G1/`; execute-o somente quando a intenção for produzir/atualizar a evidência do gate. O fuzzer é determinístico com `POC01_SEED`.

### G4

```bash
cd poc/poc-07-outbox
npm ci
npm run build
POC07_PROFILE=quick node dist/scripts/run-all.js
node dist/scripts/run-all.js
```

O perfil completo sobrescreve `out/gate-G4/`.

### G0 / G10

```bash
cd poc/poc-03-runtime
npm ci
npm run addons
npm run build
npm run pack
POC03_PROFILE=quick node dist/scripts/run-all.js
POC03_PROFILE=full node dist/scripts/run-all.js
```

`npm run addons` exige Docker e deve ser executado no ambiente de build com glibc 2.31. Não compile esses nativos no host atual e assuma compatibilidade com o piso do v1.

`poc-10-identity` segue o mesmo roteiro, usando `POC10_PROFILE`. No Linux, a validação do caminho com secret store requer `gnome-keyring` em execução e desbloqueado.

## Conventions

- Documentação, comentários e mensagens de commit são em português.
- Títulos de commit descrevem o efeito da mudança em prosa; não use `feat:`/`fix:`.
- Não existe branch `main`. `master` pertence ao scaffold inicial. O trabalho está em `feat/arquitetura-v2`.
- `.claude/` está no `.gitignore`; portanto, regras colocadas ali são locais e não devem ser tratadas como contrato compartilhado.

## Graphify

Antes de ler arquivos para compreender o repositório, consulte `graphify-out/graph.json`.

Use:

```bash
graphify query "<termos>"
graphify path "<A>" "<B>"
graphify explain "<conceito>"
```

A busca é literal em relação ao vocabulário do grafo. Quando necessário, consulte `graphify-out/.vocab.txt` e use os termos existentes. Prefira consultas curtas e específicas; use `--budget N` para ampliar o contexto.

Use o resultado para decidir quais arquivos realmente precisam ser lidos. Em seguida, abra esses arquivos diretamente para confirmar detalhes.

`EXTRACTED` é evidência forte. `INFERRED` e `AMBIGUOUS` são hipóteses e devem ser confirmadas na fonte.

## Boundaries

- `poc/` é descartável por definição; não transforme harness em código de produto.
- Não confunda o estado atual do mock frontend com a arquitetura final do produto.
- Não trate resultados de um gate como prova de propriedades que o gate não mediu.
- Não reabra decisões já fechadas sem evidência nova ou conflito real com a especificação normativa.
