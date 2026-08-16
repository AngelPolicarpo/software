# Graphify — operação do grafo de conhecimento

Runbook operacional. As regras que valem em **toda** sessão (consultar o grafo primeiro,
precedência do documento normativo, proibição de extração automática) estão no `CLAUDE.md`;
aqui ficam os comandos, que são executados **explicitamente**, sob decisão do usuário.

Saída canônica: `/home/rebis/projetos/software/graphify-out/`.

## Consulta

MCP (`graphify` em `.mcp.json`): `query_graph`, `get_node`, `get_neighbors`, `get_community`,
`god_nodes`, `graph_stats`, `shortest_path`. Sem MCP, o CLI:

```bash
graphify query   "<pergunta>" --graph graphify-out/graph.json
graphify path    "<A>" "<B>"  --graph graphify-out/graph.json
graphify explain "<conceito>" --graph graphify-out/graph.json
```

`query` trunca em ~2000 tokens e avisa quantos nós ficaram de fora; suba `--budget` ou
estreite a pergunta em vez de tirar conclusão da lista truncada.

## Qual fluxo de atualização usar

| Situação | Fluxo | Custo |
|---|---|---|
| Alteração somente em código | `graphify update . --no-cluster` | AST local, sem LLM |
| Código sem documentos | `graphify extract . --code-only --update --no-viz` | AST local, sem LLM |
| Alteração em `docs/`, `CLAUDE.md` ou `poc/**/*.md` | Extração Ollama abaixo, **sem** `--code-only` | CPU/GPU local |
| Pergunta sobre grafo existente | MCP ou `query`/`path`/`explain` | Não reconstrói nada |

`--code-only` exclui `docs/` e o resto do conteúdo que exige passe semântico — não o use no
fluxo de documentos. Não use `--force` rotineiramente; ele é para reconstrução intencional.

## Extração semântica local com Ollama

Sem chamada de nuvem. A partir da raiz do projeto:

```bash
cd /home/rebis/projetos/software && \
export OLLAMA_BASE_URL=http://127.0.0.1:11434/v1 && \
export OLLAMA_MODEL=qwen2.5-coder:7b && \
export OLLAMA_API_KEY=ollama && \
export GRAPHIFY_OLLAMA_NUM_CTX=8192 && \
export GRAPHIFY_API_TIMEOUT=600 && \
graphify extract . \
  --out /home/rebis/projetos/software \
  --backend ollama \
  --model qwen2.5-coder:7b \
  --update \
  --no-viz
```

`OLLAMA_API_KEY=ollama` é compatibilidade local, não segredo de nuvem. O backend deve
permanecer explicitamente `ollama` mesmo que chaves de outros provedores existam no ambiente.

### Quando falhar

Truncamento, JSON inválido, resposta vazia ou falta de VRAM → reduza chunk e concorrência
em vez de aumentar o contexto:

```bash
graphify extract ./docs \
  --out /home/rebis/projetos/software \
  --backend ollama \
  --model qwen2.5-coder:7b \
  --token-budget 4000 \
  --max-concurrency 2 \
  --no-viz
```

Antes de repetir uma falha, confirme `graphify --version` e se o modelo está disponível no
Ollama. **Não substitua um grafo válido por saída parcial.**

### Verificação depois de atualizar

```bash
test -s /home/rebis/projetos/software/graphify-out/graph.json
test -s /home/rebis/projetos/software/graphify-out/GRAPH_REPORT.md
graphify explain "<símbolo conhecido>" \
  --graph /home/rebis/projetos/software/graphify-out/graph.json
```

## Artefatos e higiene do repositório

- `graphify-out/graph.json` e `manifest.json` são reescritos a cada extração.
- `graphify-out/<data>/` são os backups datados que o graphify grava antes de sobrescrever.
- `graphify-out/GRAPH_REPORT.md` **só é regravado no passe de clustering** — ele fica para
  trás de `graph.json` depois de um `--update`. Confira as datas antes de citá-lo.
- `graphify-out/` inteiro está no `.gitignore`: é derivado do repositório e reconstruível,
  e versioná-lo trocava ~9 MB de JSON gerado a cada extração. Num clone novo o grafo não
  existe até alguém rodar a extração local.
- `docs/graphify-out/` está ignorado à parte: é o destino errado de uma extração sem `--out`.
- `.graphifyignore` mantém `poc/poc-01-fold/{src,scripts,types}` fora do grafo de propósito —
  é implementação de teste, e indexá-la faria o grafo responder "como funciona o `fold`?"
  com suposições marcadas `EXTRACTED`. O `README.md` e o `REPORT.md` do PoC ficam dentro.
