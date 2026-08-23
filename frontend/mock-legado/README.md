# Mock legado — referência visual, fora do produto

Este diretório é o mock de UX que existia antes de o renderer falar com o núcleo. Ele
**não faz parte do produto** e não é compilado: `tsconfig.app.json` inclui apenas `src`, e
o `oxlint` o ignora. Nada em `src/` importa daqui — a verificação é mecânica e está descrita
abaixo.

## Por que foi movido em vez de apagado

A tentação era apagar: 94 arquivos e ~18 mil linhas que nenhuma tela viva alcança. Mas duas
lacunas reais do produto foram encontradas *lendo* este código, depois que a migração já se
dizia completa:

- **`lib/markdown.tsx`** guardava a única implementação da allowlist de esquema de
  §15.6.1 (T-18) — links fora de `http`/`https`/`mailto` renderizados como texto. A linha de
  mensagem viva mostrava `content` cru. Fechado em `src/live/markdown.ts`.
- **`store/inviteStore.ts`** documentava, no próprio cabeçalho, que um convite chega de fora
  do aplicativo e muitas vezes para quem ainda não tem identidade. Na UI viva os overlays de
  deep link só existiam dentro do `Shell`, que não é montado em `sem-identidade`: o convite
  do primeiro uso era descartado em silêncio. Fechado em `src/live/LiveApp.tsx`.

Enquanto houver superfície não migrada — voz, tela e relay dependem de mídia pela rede real
—, este diretório é a especificação executável do que aquelas telas faziam. Apagar cobra o
preço na fatia seguinte.

## O que tem aqui

| Pasta | Arquivos | O que é |
|---|---|---|
| `features/` | 47 | as telas do mock, incluindo `voice/` — a referência da fatia de mídia |
| `store/` | 11 | as stores Zustand sobre fixtures, substituídas por `src/live/*` |
| `components/ui/` | 15 | primitivos ainda não usados pelo caminho vivo (Modal, Tabs, Toast, Select…) |
| `components/shell/` | 7 | rail e lista de canais do mock |
| `lib/` | 8 | utilitários; o markdown daqui já foi migrado |
| `mocks/dataset.ts` | 1 | as fixtures — o único arquivo que é literalmente "dado de mock" |
| `domain/types.ts` | 1 | o modelo do mock, que **não** é o de §15.6 |
| raiz e `routes/` | 4 | `App.tsx` e as rotas do web app |

## Como ele se relaciona com `src/`

Os imports que apontavam para peças ainda vivas (`components/ui/Button`, `TextField`,
`Spinner`, `StatusBanner`, `lib/cn`, `index.css`) foram reapontados para `../src/...` — 80
no total. Todo import relativo daqui resolve para um arquivo existente; a checagem é um
script de uma passada sobre a árvore, e o resultado está no commit que moveu tudo.

`domain/types.ts` diverge de `src/ipc/dto.ts` de propósito: `HostStatus` aqui tem três
valores, o de §15.6 tem nove; cargo tem `position`, o do fio tem `rank`. **Não** use este
modelo como fonte ao migrar — a fonte é §15.6.

## Quando apagar

Quando `voice.*`, `share.*` e `relay.*` tiverem tela viva. Aí `features/voice/` deixa de ser
referência de nada, e o resto já foi.
