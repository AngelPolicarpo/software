# Comunidade P2P (voz/vídeo/tela)

App de comunidade — canais de texto/voz, cargos, moderação e histórico pesquisável —
100 % P2P, sem servidor central. Cada comunidade é hospedada pela máquina de quem a criou.

## Estado real do repositório

Quase todo o valor deste repositório hoje é **especificação**, não código de produto.

| Diretório | O que é |
|---|---|
| `frontend/` | Vite + React + TS + Tailwind + Zustand, **dados mockados** (`src/mocks/dataset.ts`). Roda isolado no navegador; nenhuma linha de P2P. |
| `poc/poc-01-fold/` | Harness **descartável** do gate G1, Node 22 puro. |
| `poc/poc-03-runtime/` | Harness **descartável** do gate G0. Electron empacotado, `utilityProcess`, nativos, `asar`. |
| `poc/poc-10-identity/` | Harness **descartável** do gate G10. `safeStorage`, lock composto, `wipe`, deep link. |
| `poc/poc-07-outbox/` | Harness **descartável** do gate G4. Outbox durável, group commit, matriz de crash, host adversário. |
| `backend/` | Só um README. Vazio. |
| `docs/` | A arquitetura v2 e as auditorias da v1. |

Os quatro `poc/` são **descartáveis por definição**: existem para produzir evidência de gate,
não para virar produto. Reaproveite o desenho, nunca o código.

**O layout do produto continua sendo decisão aberta**, e agora ela venceu: a fase 0 terminou
em 2026-08-16 e a fase 1 é o primeiro código de produto. Não presuma que o núcleo vai morar
em `backend/`.

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
`threat-model-seguranca.md`, `rastreabilidade-ux-backend.md`, `relatorio-auditoria-adr.md`,
`parecer-consolidado-do-architecture-review-board.md`) são história, **sem precedência**.

Os quatro `poc/**/REPORT.md` também não são normativos, mas são a leitura consolidada de onde
a spec doeu e do que foi medido. Consulte antes de reabrir a discussão:

- `poc-01-fold/REPORT.md` — gênese, R-27, totalidade do `fold`, as oito corridas de §21.1.
- `poc-03-runtime/REPORT.md` — glibc dos nativos, `asarUnpack`, carga preguiçosa de addon.
- `poc-10-identity/REPORT.md` — seleção de backend do `safeStorage`, ordem da retomada do
  `wipe`, as duas barreiras de §10.8.
- `poc-07-outbox/REPORT.md` — os quatro defeitos de §11, o custo real do `synchronous=FULL`, e
  por que a vazão foi medida com um canal só.

Se algo não estiver nos documentos normativos, **levante o buraco de especificação; não
invente**. Foi assim que os treze buracos e as cinco contradições de 2026-08-16 apareceram.

## Arquitetura decidida — o que ainda não está no código

O repositório é web puro; a spec não é. Antes de escrever código de produto:

- **Electron**, não web app: main + núcleo em `utilityProcess` + renderer, com IPC-R
  (renderer) e IPC-M (main) como fronteiras distintas — `adr-v2.md` A16, `backend-v2.md` §29.
  A migração do `frontend/` atual é trabalho previsto, não regressão.
- **Estado da comunidade = `fold(log)`**, função pura, total e determinística sobre um
  Hypercore append-only (A02, `backend-v2.md` §8). Decisão acontece **antes** do append.
- **Matriz de plataforma do v1, fechada:** Windows x64 e Linux x64 com glibc ≥ 2.31.
  macOS, Alpine/musl e ARM estão **fora de suporte** — o v1 não tem nenhum alvo arm64 (A16).
- Addons nativos exigem **rebuild por versão de Electron**, e o piso de glibc é do host de
  **build**, não do host de teste (A16). **Medido em G0:** os prebuilds do npm exigem glibc
  2.34 e 2.33, acima do piso 2.31 — compilar no container de glibc 2.31 não é higiene, é o
  que torna a matriz verdadeira. Contrato em `poc/poc-03-runtime/build/`.
- **Dados** ficam na máquina do host; descoberta via DHT. **Voz** é mesh P2P direto.
  **Tela** é estrela WebRTC com `SHARE_MAX_VIEWERS = 8` (A19); o multicast em árvore que
  sustentaria audiência maior está **adiado, fora do v1** (G13). TURN só quando o NAT
  impedir conexão direta.

## Gates: o que está liberado

`backend-v2.md` §29 e `plano-de-validacao-experimental-v2.md` §6. **Nenhuma fase começa
antes do gate que a precede.**

**A fase 0 terminou em 2026-08-16.** Ela não tinha gate de entrada e produziu os dois que
faltavam:

| Gate | Estado | Artefato | Libera |
|---|---|---|---|
| G0 | `APROVADO` (11/11) | `poc/poc-03-runtime/out/gate-G0/` | fase 1 |
| G10 | `APROVADO` (10/10) **nos dois alvos** | `poc/poc-10-identity/out/gate-G10/` + `windows/`, consolidados em `matriz.json` | fase 1 |
| G1 | `CONFIRMADO` | `poc/poc-01-fold/out/gate-G1/` | fase 2 |
| G4 | `CONFIRMADO` (8/8) | `poc/poc-07-outbox/out/gate-G4/` | fase 3 — **com ressalva**, ver abaixo |

O diagrama de §6 bifurca a partir de G0 — `G0 → G10 → fase 1` e `G0 → G1 → fase 2 → G4 →
fase 3` —, então **fase 1, fase 2 e fase 3 estão liberadas**. Todo gate daí em diante (G2, G3,
G5, G6, G7, G8, G11, G12) continua sem artefato.

**A fase 3 está liberada por gate, mas não está pronta para ser escrita.** G4 passou nos oito
critérios e, no caminho, encontrou quatro defeitos no §11 — dois deles perdem mensagem do
usuário. Antes de escrever a outbox, leia `poc/poc-07-outbox/REPORT.md` e
`docs/sequenciamento-pos-fase-0.md` §20. Em especial:

- **`ACHADO-01`** — o ramo 1 de §11.6 remove item da fila por marca d'água, o que perde
  operação e a **reporta como entregue**. §7.5 já tem a regra certa (testar o `opId`); é §11.6
  que transcreveu errado. Não transcreva o pseudocódigo como está.
- **`ACHADO-02`** — o `authorSeq` **por autor** de §7.5 é incompatível com a ordem **por
  canal** de §11.7: com mais de um canal, o item ultrapassado é recusado para sempre. Medido:
  8 canais, 256 envelopes, 45 entram e 211 são recusados. **É decisão de arquitetura e precisa
  de emenda antes da fase 3** — há três saídas, e todas mudam coisa diferente.

O que os gates **não** provaram, e não pode ser assumido:

- G1 rodou em Node 22 puro, fora da ordem de §6, e não prova durabilidade sob `SIGKILL`,
  transporte, escala nem as regras dos outros 22 `kind`s.
- `G0-E1` (A16): o alvo Linux saiu de **WSL2**. Sem evidência de sessão gráfica real —
  handler `xdg-mime`/`.desktop`, deep link de §3.5 fora do app, I/O de disco nativo.
- Os addons de **Windows** são os prebuilds do npm, não compilados por nós; falta toolchain
  MSVC. Registrado em A16 como `G0-E2` desde 2026-08-16.
- ~~A barreira de durabilidade de §11 continua **indefinida**.~~ **Fechada como pergunta de
  spec em 2026-08-17** (§10.7.1): `core.flush` não existe em `hypercore@11.35.1` e
  `core.state.flush()` estoura **porque o `append` já o chamou** — o `append` resolvido *é* a
  barreira, e foi medido durável a `SIGKILL` de processo. O que continua sendo de G4 é o
  alcance: `fsync`, queda de energia e a matriz de §28.3 contra o caminho de escrita completo
  (outbox + host + group commit), que é código de fase 3.
- ~~No Linux, `safeStorage` cai em `basic_text` por falha de detecção de ambiente.~~
  **Fechado em 2026-08-16:** A13 ganhou os itens 5 e 6 — degradado é
  `isEncryptionAvailable() === false` **depois** do probe de backend, nunca o nome do
  backend; o probe tenta `gnome-libsecret`, `kwallet6`, `kwallet5` via `appendSwitch`, que
  só vale antes de `app.whenReady()` e portanto custa um relaunch por candidato, **antes**
  do lock de §10.8 e preservando `argv`.
- Marcações `REQUIRES POC` e `BENCHMARK REQUIRED` na spec: não implemente a parte dependente
  antes do gate passar, e a UI não anuncia número que não foi medido.

## Comandos

```bash
# frontend
cd frontend && npm run dev      # Vite
npm run build                   # tsc -b && vite build — é o typecheck do projeto
npm run lint                    # oxlint
```

Não há test runner no `frontend/`. A validação disponível é `npm run build` + `npm run lint`.

```bash
# gate G1
cd poc/poc-01-fold && npm ci && npm run build    # npm run typecheck para só checar tipos
POC01_PROFILE=quick node dist/scripts/run-all.js                     # ~1 min, escreve out/gate-G1-quick/
node --max-old-space-size=10240 dist/scripts/run-all.js              # gate completo, ~22 min
```

O perfil `full` **sobrescreve `out/gate-G1/`**, que é o artefato versionado que sustenta o
veredito. Use `POC01_PROFILE=quick` para verificação; só rode o gate completo com intenção.
O fuzzer é determinístico — `POC01_SEED=0x...` reproduz as mesmas 10⁷ entradas.

```bash
# gate G4 — Node puro, sem Docker e sem Electron
cd poc/poc-07-outbox && npm ci && npm run build
POC07_PROFILE=quick node dist/scripts/run-all.js   # ~3 min, escreve out/gate-G4-quick/
node dist/scripts/run-all.js                       # o gate; sobrescreve out/gate-G4/
```

```bash
# gates G0 e G10 — mesmo formato nos dois
cd poc/poc-03-runtime && npm ci
npm run addons        # compila os nativos no container de glibc 2.31 — OBRIGATÓRIO, ver A16
npm run build && npm run pack
POC03_PROFILE=quick node dist/scripts/run-all.js    # ~1 min
POC03_PROFILE=full  node dist/scripts/run-all.js    # o gate; sobrescreve out/gate-G0/
```

`npm run addons` exige Docker. Compilar no host **não serve**: esta máquina é glibc 2.43 e o
binário resultante não roda no piso declarado. `poc-10-identity` segue o mesmo roteiro com
`POC10_PROFILE`; no Linux ele precisa de `gnome-keyring` rodando e destravado para exercitar
o caminho **com** secret store — sem sessão gráfica isso não acontece sozinho:

```bash
printf '<senha>' | gnome-keyring-daemon --unlock --components=secrets,pkcs11 --daemonize
```

## Convenções

- **Português** em documentação, comentários e mensagens de commit.
- Título de commit é **prosa descrevendo o efeito** ("O carimbo da última consulta para de
  sujar a árvore"), nunca `feat:`/`fix:`. O corpo explica o porquê da mudança.
- **Não existe branch `main`** — a ferramenta pode afirmar que existe. `master` parou no
  scaffold inicial; todo o trabalho está em `feat/arquitetura-v2`, o único branch publicado.
  Um diff contra `master` traz o projeto inteiro, não a mudança.
- `.claude/` está no `.gitignore`: é ambiente de quem edita, não contrato do projeto —
  regra colocada lá não é compartilhada com ninguém.

## Graphify

Grafo de conhecimento do repositório em `graphify-out/graph.json`, cobrindo código **e**
documentos. Use-o para localizar conceitos, relações e caminhos **antes** de ler arquivos;
leia o arquivo direto para confirmar o texto exato de uma decisão ou resolver divergência.

`graphify-out/` **não é versionado** — é derivado e reconstruível. Num clone novo o grafo
não existe até alguém rodar a extração local; até lá, leia os arquivos direto.

Comandos, fluxos de atualização e o runbook de extração local com Ollama estão em
[`GRAPHIFY.md`](./GRAPHIFY.md). Três regras valem sempre:

1. **O documento normativo vence o grafo**, sempre. Se divergirem, registre a inconsistência
   e considere atualizar o grafo — não a decisão.
2. **O grafo não conhece precedência.** `dry-run-implementacao.md`, `backend.md` e as
   auditorias estão indexados lado a lado com a v2 e **dominam** os resultados de perguntas
   sobre fases, implementação e gaps. Confira a origem (`src=`) de cada nó antes de citá-lo;
   um `GAP DR-nn` ou um `T-nn` é achado histórico da v1, não pendência atual.
3. **Nunca execute extração automaticamente.** `graphify extract`, `/graphify . --update`,
   `graphify claude install` e hooks são operações explícitas do usuário. Nada de Claude,
   `claude-cli`, subagentes ou API de nuvem para extração sem autorização.

Relações `EXTRACTED` são a evidência mais forte; `INFERRED` e `AMBIGUOUS` são hipóteses a
confirmar no documento ou no código. Registre `arquivo:linha` quando a conclusão depender do
grafo.
