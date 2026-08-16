# Comunidade P2P (voz/vídeo/tela)

App de comunidade — canais de texto/voz, cargos, moderação e histórico pesquisável —
100% P2P, sem servidor central. Cada comunidade é hospedada pela máquina de quem a criou.

## Arquitetura

- **Dados**: mensagens, canais, cargos e moderação ficam na máquina do host; descoberta via DHT.
- **Voz**: mesh P2P direto entre participantes.
- **Tela/vídeo**: até ~4-5 espectadores em estrela direta; audiências maiores usam
  multicast em árvore na camada de aplicação (linha SplitStream/P2Cast); TURN apenas
  quando a conexão direta falhar por NAT restritivo.
- **Arquivos**: ficam no host; arquivos grandes podem ser distribuídos entre quem já baixou.

## Stack e estado

- Media: WebRTC.
- Descoberta/replicação: Hyperswarm + Hypercore + Hyperdht (Holepunch).
- Frontend: Vite + React + TypeScript + Tailwind CSS (`@tailwindcss/vite`) + Zustand.
- Backend: placeholder; a lógica P2P entra depois de o frontend ser validado.
- Atualmente só `frontend/` está em desenvolvimento, com dados mockados. A implementação
  começa pela fase 0 (runtime) de `docs/backend-v2.md` §29, após os gates G0 e G10.

## Documentos normativos e precedência

A arquitetura v2 foi reescrita em 2026-08-15 após parecer `NOT APPROVED` sobre a v1.
Somente estes documentos são contrato, nesta ordem:

1. `docs/backend-v2.md`
2. `docs/adr-v2.md`
3. `docs/plano-de-validacao-experimental-v2.md`
4. `docs/deltas-ux-v2.md` — vence `docs/frontend.md` quando houver conflito
5. `docs/frontend.md`
6. `docs/resolucao-arquitetural-v2.md`

`docs/backend.md` e as auditorias (`auditoria-*.md`, `dry-run-implementacao.md`,
`threat-model-seguranca.md`, `rastreabilidade-ux-backend.md`, `relatorio-auditoria-adr.md`
e `parecer-consolidado-do-architecture-review-board.md`) são história, sem precedência.
Se algo não estiver nos documentos normativos, levante o buraco de especificação; não invente.
Se a especificação marcar `REQUIRES POC`, não implemente a parte dependente antes do gate passar.


## Graphify: uso e precedência

Graphify é a primeira camada de navegação estrutural deste repositório. Como o código e os
documentos normativos foram extraídos semanticamente, consulte primeiro o grafo para localizar
conceitos, relações, dependências, documentos relevantes e caminhos de implementação antes de
ler arquivos diretamente.

Use o MCP (`query_graph`, `get_node`, `get_neighbors`, `get_community`, `god_nodes`,
`graph_stats`, `shortest_path`) ou, na ausência do MCP, o CLI:

```bash
graphify query "<pergunta>" --graph graphify-out/graph.json
graphify path "<A>" "<B>" --graph graphify-out/graph.json
graphify explain "<conceito>" --graph graphify-out/graph.json
```

Use o Graphify primeiro para orientação e descoberta. Leia diretamente os arquivos somente
quando precisar confirmar o texto exato de uma decisão, validar uma hipótese, verificar o
estado atual da implementação ou resolver uma divergência.

Os documentos normativos continuam sendo a autoridade final para decisões arquiteturais.
Se o grafo divergir de `docs/backend-v2.md`, `docs/adr-v2.md`,
`docs/plano-de-validacao-experimental-v2.md`, `docs/deltas-ux-v2.md`, `docs/frontend.md`
ou `docs/resolucao-arquitetural-v2.md`, prevalece o documento normativo; registre a
inconsistência e considere atualizar o grafo.

Use relações `EXTRACTED` como evidência mais forte. Trate relações `INFERRED` e `AMBIGUOUS`
como hipóteses que podem exigir confirmação no documento ou no código. Registre `arquivo:linha`
quando uma conclusão depender de uma relação do grafo.

Use `graphify-out/GRAPH_REPORT.md` para orientação arquitetural ampla e consultas `query`,
`path` ou `explain` para perguntas específicas. Não faça extração completa no início de uma
sessão nem para perguntas simples ou não relacionadas ao código.

## Atualização do grafo sem custo de nuvem

| Situação | Fluxo | Regra |
|---|---|---|
| Alteração somente em código | `graphify update . --no-cluster` | AST local; não chama LLM |
| Código sem documentos | `graphify extract . --code-only --update --no-viz` | AST local; não chama LLM |
| Alteração em `docs/` ou `CLAUDE.md` | Extração Ollama abaixo, sem `--code-only` | Inclui passe semântico local |
| Pergunta sobre grafo existente | MCP ou `query/path/explain` | Não reconstrói o grafo |

Não execute `graphify extract`, `/graphify . --update`, `graphify claude install` ou hooks
automaticamente. São operações explícitas que podem consumir recursos ou alterar arquivos de
configuração. Não use Claude, `claude-cli`, subagentes ou APIs de nuvem para extração sem
autorização explícita. Não use `--force` rotineiramente; reserve-o para reconstruções intencionais.

## Extração semântica local com Ollama

Quando documentos precisarem entrar no grafo, execute a partir da raiz do projeto:

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

Não adicione `--code-only` nesse fluxo, pois ele exclui `docs/` e outros conteúdos que exigem
extração semântica. O `--out` acima cria o diretório canônico:
`/home/rebis/projetos/software/graphify-out/`, contendo `graph.json` e `GRAPH_REPORT.md`.

`OLLAMA_API_KEY=ollama` é somente compatibilidade local, não segredo de nuvem. O backend deve
permanecer explicitamente `ollama`, mesmo que chaves de outros provedores existam no ambiente.
O processamento local evita custo de API, mas consome CPU/GPU, VRAM, energia e tempo.

### Ajuste e verificação

Comece com `GRAPHIFY_OLLAMA_NUM_CTX=8192`. Se houver truncamento, JSON inválido, respostas
vazias ou falta de VRAM, reduza o tamanho dos chunks e a concorrência:

```bash
graphify extract ./docs \
  --out /home/rebis/projetos/software \
  --backend ollama \
  --model qwen2.5-coder:7b \
  --token-budget 4000 \
  --max-concurrency 2 \
  --no-viz
```

Não aumente o contexto indiscriminadamente. Confirme `graphify --version` e a disponibilidade
do modelo no Ollama antes de repetir uma falha. Não substitua um grafo válido por saída parcial.
Depois de atualizar:

```bash
test -s /home/rebis/projetos/software/graphify-out/graph.json
test -s /home/rebis/projetos/software/graphify-out/GRAPH_REPORT.md
graphify explain "<símbolo conhecido>" \
  --graph /home/rebis/projetos/software/graphify-out/graph.json
```

Se houver `.claudeignore`, ignore artefatos gerados para evitar reuploads desnecessários:

```text
graphify-out/
graph.json
```

Ainda é permitido ler explicitamente `GRAPH_REPORT.md` e consultar `graph.json` quando a tarefa exigir.

## Ordem operacional

1. Para arquitetura v2, leia primeiro os documentos normativos.
2. Para código, consulte o grafo aplicável e depois leia apenas os arquivos necessários.
3. Após alterações de código, atualize somente por AST local.
4. Após alterações em documentos, faça extração semântica apenas se o grafo precisar refletir a mudança.
5. Quando necessário, use exclusivamente o comando Ollama local acima, sem subagentes.
6. Valide os artefatos antes de consultar o grafo atualizado.
7. Não invente decisões ausentes da especificação.
