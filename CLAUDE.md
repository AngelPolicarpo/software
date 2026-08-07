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

## Estado atual

Só `frontend/` em desenvolvimento, com dados mockados, sem backend real.

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
5. Após implementar qualquer alteração, rode `/graphify . --update`
   para re-sincronizar o grafo antes de encerrar a tarefa.

Não pule esses passos mesmo em perguntas simples.
