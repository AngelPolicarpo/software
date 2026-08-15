# Comunidade P2P (voz/vídeo/tela)

App de comunidade — canais de texto/voz, cargos, moderação, histórico
pesquisável — 100% P2P, sem servidor central. Cada comunidade é hospedada
pela máquina de quem a criou.

## Arquitetura

- **Dados da comunidade** (mensagens, canais, cargos, moderação): mantidos
  na máquina do host. Descoberta de peers via DHT.
- **Voz**: mesh P2P direto entre participantes.
- **Compartilhamento de tela/vídeo**:
  - ≤ ~4-5 espectadores: estrela direta.
  - Audiência maior: application-layer multicast em árvore (linha
    SplitStream/P2Cast) — quem compartilha envia a um grupo inicial que
    repassa adiante; upload do host não cresce com o tamanho da
    audiência. Máquina do host da comunidade prioriza os primeiros
    níveis da árvore.
  - Fallback TURN só quando a conexão direta falha por NAT restritivo.
- **Arquivos**: ficam no host; arquivos grandes se distribuem entre quem
  já baixou (estilo torrent).

## Stack

- Media: WebRTC.
- Descoberta/replicação de dados: Hyperswarm + Hypercore + Hyperdht
  (Holepunch).
- Frontend: Vite + React + TypeScript, Tailwind CSS (`@tailwindcss/vite`),
  Zustand.
- Backend: vazio por enquanto — lógica P2P entra depois do frontend
  validado.

## Documentos normativos (precedência)

A arquitetura foi reescrita em 2026-08-15 (v2), depois de um parecer `NOT APPROVED` do
Architecture Review Board sobre a v1. **Só estes documentos são contrato:**

1. `docs/backend-v2.md` — especificação técnica do backend (normativa)
2. `docs/adr-v2.md` — 28 decisões arquiteturais, com o mapa de substituição das 20 de v1
3. `docs/plano-de-validacao-experimental-v2.md` — gates, PoCs e benchmarks obrigatórios
4. `docs/deltas-ux-v2.md` — mudanças de produto; vence `docs/frontend.md` onde discordarem
5. `docs/frontend.md` — UX/UI, no que os deltas não tocam
6. `docs/resolucao-arquitetural-v2.md` — o que mudou, riscos aceitos e veredito

`docs/backend.md` e as cinco auditorias (`auditoria-*.md`, `dry-run-implementacao.md`,
`threat-model-seguranca.md`, `rastreabilidade-ux-backend.md`, `relatorio-auditoria-adr.md`,
`parecer-consolidado-do-architecture-review-board.md`) são **história**: preservados, sem
precedência, nunca citados como decisão.

**Regra:** se algo não estiver nos documentos normativos, é buraco de spec e deve ser
levantado — não inventado. Onde a spec marcar `REQUIRES POC`, a parte dependente não pode
ser implementada antes do gate correspondente passar.

## Estado atual

Só `frontend/` em desenvolvimento, com dados mockados, sem backend real. `backend/` é
placeholder. A implementação começa pela fase 0 (runtime) de `backend-v2.md` §29, que
depende dos gates G0 e G10.

## Estrutura

- `frontend/` — app Vite + React + TS + Tailwind + Zustand.
- `backend/` — placeholder; lógica P2P (Hyperswarm/Hypercore/Hyperdht)
  entra depois.

## Problemas em aberto

- CGNAT impede parte dos usuários de virar nó de repasse na árvore.
- Reparo de árvore quando um nó do meio cai (detecção + reconexão sob
  estresse).
- Consentimento de usar upload de espectador para repassar a outros.
- Moderação em escala sem autoridade central.

## Consulta obrigatória ao Graphify

Antes de responder qualquer pergunta ou implementar qualquer mudança
neste repositório, consulte primeiro o grafo de conhecimento via MCP
do graphify (tools: `query_graph`, `get_node`, `get_neighbors`,
`get_community`, `god_nodes`, `graph_stats`, `shortest_path`):

1. Use `query_graph`, `get_node` ou `get_neighbors` para localizar os
   componentes relevantes antes de propor código.
2. Baseie a resposta nas relações marcadas EXTRACTED; trate INFERRED
   e AMBIGUOUS como hipóteses a validar, não como fato.
3. Cite sempre `arquivo:linha` das relações usadas.
4. Antes de alterar algo, use `get_neighbors`/`shortest_path` para
   entender o que depende do código que será modificado.
5. Depois de alterar qualquer coisa, atualize o grafo — mas pelo
   caminho certo, ver "Como atualizar sem degradar o grafo" abaixo.

Não pule esses passos mesmo em perguntas simples.

### O grafo está desatualizado para a arquitetura v2

**O grafo não contém nenhum documento da v2.** Ele tem a `backend.md`
v1 inteira, que está revogada, e não tem `backend-v2.md`, `adr-v2.md`,
`plano-de-validacao-experimental-v2.md`, `deltas-ux-v2.md` nem
`resolucao-arquitetural-v2.md`.

Consequência prática: para qualquer pergunta de arquitetura, o grafo
responde com a v1 e a resposta sai errada. **Leia os documentos
normativos direto do disco** e use o grafo para código do `frontend/`.

Oito documentos estão fora: os três de auditoria pendentes desde o
commit `3e6eb0d` e os cinco da v2.

### Como atualizar sem degradar o grafo

Dois caminhos, e eles não são intercambiáveis:

| Caminho | O que faz | Quando usar |
|---|---|---|
| `graphify update --no-cluster` (CLI) | Re-extrai **só código**, por AST, sem LLM | Mudança em `frontend/` ou `backend/` |
| `/graphify . --update` (skill, no assistente) | Extração **semântica** com LLM; é o único que cobre documento | Mudança em `docs/` ou `CLAUDE.md` |

Regras que evitam repetir o estrago revertido em `3e6eb0d`:

- **Nunca use o `graphify update` de CLI para atualizar documento.** Ele
  é code-only por construção, e diz isso ao terminar: *"For doc/paper/
  image changes run /graphify --update in your AI assistant"*.
- **Sempre passe `--no-cluster`** no `update` de CLI.
  `.graphify_labels.json` é indexado por **id numérico de comunidade**;
  re-clusterizar move os ids, e a comunidade cujo id novo não bate com o
  salvo cai no fallback derivado do hub (o `existing_labels.get(cid,
  hub_labels[cid])` em `cli.py`), virando nomes como "plugins" e
  "Entidade Member". Foi assim que os 75 nomes curados se perderam.
- A extração semântica **exige** `GEMINI_API_KEY` ou `GOOGLE_API_KEY`
  no ambiente. Sem chave ela simplesmente não acontece.
- Quando a clusterização precisar mudar de propósito — por exemplo ao
  trazer os oito documentos que faltam —, regere os nomes com
  `graphify label`, deliberadamente, em vez de deixar cair no fallback.
- O graphify guarda backup datado antes de sobrescrever, em
  `graphify-out/<data>/`. Se o grafo degradar, restaure de lá.

Mover documento de diretório **não** resolve nenhum dos dois problemas:
o modo de extração depende do comando, não do caminho, e o
desalinhamento de rótulo depende de quanto a topologia mudou.
