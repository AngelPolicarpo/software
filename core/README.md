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
| `fold` | L1 | **em curso** — `rank.ts` (§6.4.1, R-20) pronto com paridade a G1. Falta §8: `DecisionState`, pipeline de admissão, efeitos, R-27 |
| `projector` | L1→L0 | a fazer — §10.5 |

**As quatro dependências que §4 declara para o `fold` estão completas**, e o bloqueio
normativo que faltava caiu: §27.1 passou a declarar `RANK_TOP`, `RANK_BOTTOM` e
`RANK_GENESIS`, e §6.4.1 ganhou a definição de `midpoint` e da renormalização — com os
valores e o algoritmo de `poc-01-fold`, que é o que mantém a evidência de G1 válida para
este código (`docs/sequenciamento-pos-fase-0.md` §16).

O layout de payload é guardado **na forma textual de §7.4** (`PAYLOAD_LAYOUT`), e tanto os
tipos TypeScript quanto o encode/decode são derivados dele. Não há segunda transcrição a
manter em dia: mudar a linha muda o tipo, e o código que dependia do campo antigo para de
compilar.

Dois módulos amarram em **vetores de `poc-01-fold`**, a implementação que sustenta o
`CONFIRMADO` de G1 sobre 10⁷ entradas hostis: se o produto divergir dela, a evidência do
gate deixa de valer para este código. Por isso os valores estão fixos nos testes, não
recalculados.

## Regras que valem em todo arquivo daqui

- **`errors`, `opCodec`, `permissions`, `idgen` e `fold` são puros** (§4). Se um deles
  precisar de mock de rede, relógio ou banco para ser testado, a fronteira foi violada — é o
  que torna §28.1 e §28.4 possíveis.
- **O `fold` não lança exceção, não faz I/O, não lê relógio nem configuração** (§4, §8.5).
  Erro é valor de retorno; por isso `error()` de `l1/errors` nunca lança e as regras de §20.1
  sobre `field` e `retryAfterMs` vivem no **tipo**.
- **Nada aqui formata texto de interface** (§3.4.2). O núcleo devolve código e dado
  estruturado; o português é do renderer. Em `errors` isso é explícito: §4 proíbe texto em
  português no módulo.
- `src/l1/errors/codes.ts` é **gerado** de §20.2 e não se edita à mão. O teste de paridade
  relê a tabela do normativo a cada corrida; se a spec mudar, ele quebra antes do resto.
