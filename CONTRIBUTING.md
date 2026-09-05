# Contribuindo

## Ambiente local

Requer Node.js ≥ 22. Não há workspace de monorepo na raiz — instale e rode cada pacote
separadamente.

```bash
cd core && npm install
cd ../frontend && npm install
cd ../app && npm install
```

## Rodando testes e validação

```bash
# core
cd core
npm run build       # tsc + barreira de camadas (§4)
npm test
npm run typecheck

# frontend
cd frontend
npm run build        # inclui o typecheck da árvore inteira
npm run lint
npm test

# app
cd app
npm run build
npm run typecheck
xvfb-run -a npm run smoke:fechamento   # ao encostar em app/src/main, app/src/preload ou no guarda de saída do renderer
xvfb-run -a npm run smoke:captura      # ao encostar no caminho de captura de tela
xvfb-run -a npm run smoke:voz          # ao encostar em frontend/src/live/voz.ts, sincronizacao.ts, ou mídia do núcleo
```

Depois de qualquer alteração, rode primeiro a validação mais específica ao que você mudou;
em seguida, a validação completa do pacote afetado.

`core/npm run addons` exige Docker e o ambiente de build com glibc 2.31 — não rode no
host de desenvolvimento e não assuma compatibilidade com o piso do v1 a partir de um build
local.

## Antes de alterar código

1. Consulte o Graphify (`graphify query "<termos>"`, veja `graphify-out/graph.json`) para
   localizar conceitos, relações e arquivos relevantes.
2. Leia diretamente os arquivos identificados para confirmar código, decisões e texto
   normativo — `EXTRACTED` no grafo é evidência forte, `INFERRED`/`AMBIGUOUS` são hipóteses.
3. Antes de implementar uma decisão arquitetural, consulte os documentos normativos (ordem
   de precedência no [`CLAUDE.md`](CLAUDE.md)) e o evidence/report do gate relacionado em
   `poc/*/REPORT.md`.
4. Faça a menor alteração coerente com a arquitetura existente. Não introduza abstrações
   novas sem necessidade.

Se a especificação normativa não responder algo, não invente comportamento — registre como
lacuna de especificação.

## Commits e branches

- Mensagens de commit em português. O título descreve o **efeito** da mudança em prosa —
  não use prefixos como `feat:`/`fix:`.
- Não existe branch `main`. `master` é o scaffold inicial, sem uso ativo. O trabalho
  acontece em `feat/arquitetura-v2`.
- Não altere artefatos de gate versionados, migrações ou evidências históricas de validação
  só para fazer um teste passar.

## Abrindo PR

Descreva o efeito da mudança e, se aplicável, a seção normativa (`docs/backend-v2.md`,
`docs/adr-v2.md`, ...) que ela implementa ou que motivou a decisão. PRs que reabrem decisões
já fechadas devem trazer evidência nova ou apontar um conflito real com a especificação
normativa — não um argumento de preferência.
