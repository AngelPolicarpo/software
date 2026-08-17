# `core/` — o núcleo

Primeiro código de **produto** do repositório. Tudo que existia antes daqui é especificação
(`docs/`), harness descartável de gate (`poc/`) ou UI com dados mockados (`frontend/`).

Aberto na **fase 2** de `backend-v2.md` §29 — `fold` e log —, liberada por **G1**
(`poc/poc-01-fold/out/gate-G1/`). Por que a fase 2 e não a fase 1, quais bloqueios a fase 1
ainda tem e o que falta em cada gate: `docs/sequenciamento-pos-fase-0.md`.

## O que o pacote é, e o que ele ainda não é

Node puro, sem Electron. As camadas L2 e L3 de §4 — e com elas o `utilityProcess`, a IPC-R e
a IPC-M — chegam na fase 1, junto com a decisão de onde mora o shell Electron. Este pacote
não presume essa decisão: **nada em L1 importa de ninguém acima** (§4), então mover a árvore
depois é `git mv`.

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
| `errors` | L1 | **pronto** — os 86 códigos de §20.2, com paridade contra o normativo |
| `idgen` | L1 | **pronto** — §7.3, com paridade contra os vetores de G1 |
| `permissions` | L1 | **pronto** — §9.1 a §9.3, incluindo a ordem de HOLE-16 e R-5/R-11/R-22 |
| `opCodec` | L1 | **pronto** — §7.1, §7.2.1, forma canônica, hashes de §5.2 e os **38 `kind`s** de §7.4 com o registry de payload |
| `fold` | L1 | **pronto** — §8 inteiro: `DecisionState` (§8.1), os 16 estágios de §8.2, as 27 regras `R-*`, os efeitos de §8.4 e os **38 `kind`s** |
| `view` | L0 | **aberto na fase 2** — `view.db`: schema de §10.3, PRAGMAs de §10.4, recria no bump de schema, dump ordenado de §28.4. Nenhuma regra de domínio (§4) |
| `corestore` | L0 | **aberto na fase 2, só-leitura** — abre um core por chave e lê blocos; o ciclo de vida completo (namespaces de §5.3, `manifest`, escrita) é fase 3 |
| `projector` | L1→L0 | **pronto** — §10.5 (lotes, reprojeção total, reação a `append`), §10.6 (snapshot com `foldBuildId`), §8.4 (efeitos → SQL), §8.5 (rede de segurança), §21.3 (não reentrante) |

**A fase 2 tem o `fold` completo.** O bloqueio normativo que faltava caiu: §27.1 passou a
declarar `RANK_TOP`, `RANK_BOTTOM` e `RANK_GENESIS`, e §6.4.1 ganhou a definição de
`midpoint` e da renormalização — com os valores e o algoritmo de `poc-01-fold`, que é o que
mantém a evidência de G1 válida para este código (`docs/sequenciamento-pos-fase-0.md` §16).

O projector fecha o que falta da fase 2: o log agora tem **interpretação e materialização**,
não só interpretação. §28.4 roda em CI com um corpus determinístico de ≥ 5 000 registros
cobrindo os 38 `kind`s e ≥ 200 inválidos — reprojeção idêntica (hash de dump **e** arquivo
byte a byte, com o relógio do snapshot fixado), convergência entre réplicas independentes e
equivalência de snapshot. Buracos de spec novos: `docs/sequenciamento-pos-fase-0.md` §18.

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

Dois módulos amarram em **vetores de `poc-01-fold`**, a implementação que sustenta o
`CONFIRMADO` de G1 sobre 10⁷ entradas hostis: se o produto divergir dela, a evidência do
gate deixa de valer para este código. Por isso os valores estão fixos nos testes, não
recalculados.

## Testes

`npm test` roda 432 casos em ~40 s. Sete deles releem `docs/backend-v2.md` **em tempo de
execução** — §20.2, §9.1, §7.4, §8.6, §10.3, §10.4, §8.4 e §27.2 — e comparam campo a campo
com o código: uma segunda transcrição que ninguém confere é como as treze contradições de
2026-08-16 apareceram.

O fuzzer de totalidade (§8.5) roda a cada `npm test` com 4 000 entradas por modo e é
determinístico por semente. Para aumentar o volume sem mudar a semente:

```bash
CORE_FUZZ_N=250000 node --test "dist/test/fold-totality.test.js"   # 500 k entradas, ~9 s
```

Ele **não** substitui o de §28.1, que é de 10⁷ entradas e vive em `poc/poc-01-fold` — é a
versão que cabe na suíte unitária e trava a regressão no dia a dia.

Buracos de spec levantados ao implementar §8, e a leitura que cada um recebeu:
`docs/sequenciamento-pos-fase-0.md` §17. Os levantados ao implementar o `projector`
estão em §18 do mesmo documento.

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
