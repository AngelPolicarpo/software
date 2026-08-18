# `core/` — o núcleo

Primeiro código de **produto** do repositório. Tudo que existia antes daqui é especificação
(`docs/`), harness descartável de gate (`poc/`) ou UI com dados mockados (`frontend/`).

Aberto na **fase 2** de `backend-v2.md` §29 — `fold` e log —, liberada por **G1**
(`poc/poc-01-fold/out/gate-G1/`). A implementação inicial da **fase 3** agora também
contém `manifest`, `outbox` e `communityHost`, liberados pelo contrato emendado após G4.
O que ainda falta para concluir a fase 3 está em `docs/sequenciamento-pos-fase-0.md` §20.

## O que o pacote é, e o que ele ainda não é

Node puro, sem Electron. As camadas L2 e L3 de §4 — e com elas o `utilityProcess`, a IPC-R e
a IPC-M — continuam chegando pela composição do produto. Este pacote não presume essa
decisão: o transporte da outbox e do host é recebido por portas, e **nada em L1 importa de
ninguém acima** (§4).

## Camadas (§4)

```
src/l0/  infra      config clock logger metrics keystore identity manifest view corestore swarm
src/l1/  domínio    errors opCodec idgen permissions fold projector
src/l2/  aplicação  communityHost communityClient outbox invites presence …
src/l3/  fronteira  ipcRenderer ipcMain rpcServer rpcClient mediaBridge
```

Um diretório por módulo, com o nome exato da tabela de §4. §4 manda que a violação de
fronteira **quebre o build**, e ela quebra:

```bash
npm run build      # tsc + a barreira de camadas
npm test           # build + node --test
npm run typecheck  # só os tipos
```

`scripts/check-layers.ts` é a regra. Ele transcreve a coluna "Depende de" de §4 e recusa
toda importação relativa que suba de camada ou que a tabela não declare. Rode-o depois de
criar qualquer diretório novo sob `src/`: módulo fora da tabela é violação, não omissão.

## Estado

| Módulo | Camada | Estado |
|---|---|---|
| `errors` | L1 | **pronto** — os 87 códigos de §20.2, com paridade contra o normativo |
| `idgen` | L1 | **pronto** — §7.3 escopado, com determinismo por canal |
| `permissions` | L1 | **pronto** — §9.1 a §9.3, incluindo a ordem de HOLE-16 e R-5/R-11/R-22 |
| `opCodec` | L1 | **pronto** — §7.1, §7.2.1, forma canônica, hashes de §5.2 e os **38 `kind`s** de §7.4 com o registry de payload |
| `fold` | L1 | **pronto** — §8 inteiro: `DecisionState` (§8.1), os 16 estágios de §8.2, as 27 regras `R-*`, os efeitos de §8.4 e os **38 `kind`s** |
| `view` | L0 | **pronto na fase 2** — `view.db`: schema de §10.3, `observed_ops`, PRAGMAs de §10.4, recria no bump de schema, dump ordenado de §28.4. Nenhuma regra de domínio (§4) |
| `corestore` | L0 | **aberto na fase 3** — abre core por chave para leitura e expõe porta de append para o host; não decide o que appendar |
| `manifest` | L0 | **implementado na fase 3** — `manifest.db` com `FULL`, contadores escopados e `local_outbox` durável |
| `projector` | L1→L0 | **pronto** — inclui índice `observed_ops` somente para `APPLIED` |
| `communityHost` | L2 | **implementado na fase 3** — admissão com DS provisório, um grupo em voo e append fora do lock |
| `outbox` | L2 | **implementado na fase 3** — fila por canal, retry, recuperação de `sending` e reconciliação por `opId` |

**Validação da fase 3:** os testes locais cobrem persistência/reabertura do manifesto, escopos
independentes, reconciliação por identidade, recuperação de `sending`, append real em lote e
rollback de group commit. Isto ainda não é G4 do produto: RPC real, SIGKILL da aplicação,
queda de energia, Noise/HyperDHT e escala multicomunidade permanecem conforme `G4-E1` a
`G4-E5` em `docs/sequenciamento-pos-fase-0.md` §20.6.

**A fase 2 tem o `fold` completo.** O bloqueio normativo que faltava caiu: §27.1 passou a
declarar `RANK_TOP`, `RANK_BOTTOM` e `RANK_GENESIS`, e §6.4.1 ganhou a definição de
`midpoint` e da renormalização — com os valores e o algoritmo de `poc-01-fold`, que é o que
mantém a evidência de G1 válida para este código (`docs/sequenciamento-pos-fase-0.md` §16).

O projector fecha o que falta da fase 2: o log agora tem **interpretação e materialização**,
não só interpretação. §28.4 roda em CI com um corpus determinístico de ≥ 5 000 registros
cobrindo os 38 `kind`s e ≥ 200 inválidos — reprojeção idêntica (hash de dump **e** arquivo
byte a byte, com o relógio do snapshot fixado), convergência entre réplicas independentes e
equivalência de snapshot.

Os seis buracos que o projector levantou (`H-21` a `H-26`) **viraram emenda** em 2026-08-17,
e o código transcreve o normativo em vez de escolher por ele:

| Emenda | O que mudou aqui |
|---|---|
| §8.0 — `FoldResult` declara `kind` e `author` | preenchidos a partir do decode do `Op` (estágio 2), inclusive no caminho de pânico de §8.5 |
| §10.3 — `ds_snapshot.fold_build_id` | a coluna passou a existir no normativo, não só no DDL |
| §10.3.1 — as quatro chaves de `meta` | lista fechada; o `projector` escreve `op_version`, e §4 ganhou `opCodec` na linha dele para isso |
| §8.4 — a população dos três `recount` | `hidden_by_ban` não subtrai; `left_at`/`banned` subtraem |
| §8.5 — `fold.panic{seq, kind}` | `onPanic(seq, kind)`, com `kind` `null` quando a exceção veio antes do decode |
| §10.3/§10.6 — FTS5 idempotente, PK de `communities`, "snapshot inconsistente" | as três eram contradição ou prosa; agora são texto |

O histórico de cada um — o que o código fazia antes e por quê — está em
`docs/sequenciamento-pos-fase-0.md` §18/§20; as emendas e a resolução estão no normativo.

O `fold` é um arquivo por responsabilidade, e cada um cita a seção que implementa:

| Arquivo | Seção |
|---|---|
| `index.ts` | §8.0 e §8.2 — a assinatura e os dezesseis estágios, na ordem, com o número no comentário de cada bloco |
| `state.ts` | §8.1 — o schema, mais o copy-on-write que faz `next` custar O(mudança) e não O(estado) |
| `apply.ts` | §8.3 e §8.4 — estágios 13, 14 e 15, um handler por `kind` |
| `policy.ts` | §9.4 — a matriz de enforcement, transcrita das colunas de §7.4 |
| `targets.ts` | §9.3 — quem é o alvo da hierarquia e que imunidade ele carrega |
| `limits.ts` | §8.6 — limites de campo e normalização, em **code points** |
| `effects.ts` | §8.4 — o tipo `Effect` fechado e os 20 tipos de auditoria de §6.13 |
| `constants.ts` | §27.1, §26.2, §6.4.2, §6.6 — nenhuma é configurável |
| `rank.ts` | §6.4.1 — `midpoint`, renormalização e R-20 |

O layout de payload é guardado **na forma textual de §7.4** (`PAYLOAD_LAYOUT`), e tanto os
tipos TypeScript quanto o encode/decode são derivados dele. Não há segunda transcrição a
manter em dia: mudar a linha muda o tipo, e o código que dependia do campo antigo para de
compilar.

Os módulos puros mantêm vetores determinísticos fixos nos testes. Os vetores de identidade
foram atualizados para `opVersion = 2` e `sequenceScope`; o harness de G1 continua sendo
evidência histórica do protocolo anterior, não uma fixture de compatibilidade.

## Testes

`npm test` roda a suíte unitária e de projeção. Dez deles releem `docs/backend-v2.md` **em tempo de
execução** — §20.2, §9.1, §7.4, §8.6, §8.0, §8.4, §10.3, §10.3.1, §10.4 e §27.2 — e comparam
campo a campo com o código: uma segunda transcrição que ninguém confere é como as treze
contradições de 2026-08-16 apareceram. É também o que faz uma emenda revertida no documento
quebrar a suíte antes de quebrar o produto.

O fuzzer de totalidade (§8.5) roda a cada `npm test` com 4 000 entradas por modo e é
determinístico por semente. Para aumentar o volume sem mudar a semente:

```bash
CORE_FUZZ_N=250000 node --test "dist/test/fold-totality.test.js"   # 500 k entradas, ~9 s
```

Ele **não** substitui o de §28.1, que é de 10⁷ entradas e vive em `poc/poc-01-fold` — é a
versão que cabe na suíte unitária e trava a regressão no dia a dia.

Os buracos de spec que a implementação levantou estão registrados em
`docs/sequenciamento-pos-fase-0.md` — §17 (do `fold`) e §18 (do `projector`) —, e **todos os
treze foram resolvidos** em §19: cada um virou emenda normativa, e o código transcreve.

Dois deram trabalho de verdade e vale saber que existiram:

- **H-20** — `mod.revokeBan` devolvia as mensagens às listagens e nunca à busca. §8.4 ganhou
  `ftsIndexScope`, que não carrega texto: o projector reindexa do `messages.content` que ele
  materializou, com o predicado que é o complemento exato das três remoções. Custou
  `view_schema_version` 1 → 2; `observed_ops` elevou a versão a 3.
- **A-03** — não era ambiguidade de redação. A invariante de §6.4.1 ("todo `rank` fica
  estritamente entre `RANK_BOTTOM` e `RANK_TOP`") era **falsa**: um cargo criado sem
  `afterRank` nascia abaixo do base e, por R-3 + R-4, não moderava ninguém. Os dois sentinelas
  passaram a ser os limites, e a invariante virou verdade por construção.

## Regras que valem em todo arquivo daqui

- **`errors`, `opCodec`, `permissions`, `idgen` e `fold` são puros** (§4). Se um deles
  precisar de mock de rede, relógio ou banco para ser testado, a fronteira foi violada — é o
  que torna §28.1 e §28.4 possíveis. O `projector` é **L1→L0**: ele faz I/O por contrato
  (§10.5), e os testes dele usam `view.db` e hypercore reais em diretório temporário, com
  relógio injetável — nunca aleatoriedade.
- **O `projector` é o único escritor de `view.db`** (§21.1) e **não decide nada** (§4).
- **O `fold` não lança exceção, não faz I/O, não lê relógio nem configuração** (§4, §8.5).
  Erro é valor de retorno; por isso `error()` de `l1/errors` nunca lança e as regras de §20.1
  sobre `field` e `retryAfterMs` vivem no **tipo**.
- **Nada aqui formata texto de interface** (§3.4.2). O núcleo devolve código e dado
  estruturado; o português é do renderer. Em `errors` isso é explícito: §4 proíbe texto em
  português no módulo.
- `src/l1/errors/codes.ts` é **gerado** de §20.2 e não se edita à mão. O teste de paridade
  relê a tabela do normativo a cada corrida; se a spec mudar, ele quebra antes do resto.
