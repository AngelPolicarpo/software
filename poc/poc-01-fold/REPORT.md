# POC-01 / gate G1 — leitura, achados e decisão

> Harness descartável. Node puro, sem Electron. Vive em `poc/poc-01-fold/`, fora de
> `backend/`, porque o layout do produto ainda é decisão aberta e este código **não** é a
> primeira versão do produto.
>
> Documentos usados, na precedência de `backend-v2.md` §0.2: `backend-v2.md` §1, §5, §6,
> §7, §8, §9, §10, §11.4, §19.1, §20.2, §21.1, §26.2, §27.1, §28.1, §28.4, §28.5; depois
> `plano-de-validacao-experimental-v2.md` POC-01.
>
> Resultado por cenário, ambiente, versões, lockfile e logs brutos: `out/gate-G1/`.

---

## 0. Decisão

> ## `CONFIRMADO COM LIMITE ALTERADO`
>
> **A02 — "o estado de uma comunidade é `fold(log)`, uma função pura, total e
> determinística" — sobreviveu a todos os testes que POC-01 define.** Nenhuma exceção em
> 10⁷ entradas hostis, nenhuma divergência de hash entre réplicas em nenhum cenário,
> nenhuma corrida aceita nas duas pontas, nenhum registro do host adversário com efeito
> não autorizado.
>
> **O "limite alterado" é um só, e não é do resultado — é da spec.** O critério do POC-01
> exige que *todo* registro adversário seja `REJECTED` ou `IGNORED`, e lista `hostTs`
> retroativo entre eles. **R-1 (§8.3) manda clampar, não recusar.** Os dois não podem
> valer juntos. Seguindo a precedência de §0.2, valeu R-1: o registro é `APPLIED` com
> `hostTs = lastHostTs`, sem nenhum efeito retroativo, e todas as réplicas concordam. O
> ataque não ganha nada — mas o critério, na letra, não é atendido. **CONFLITO-01.**

### O que isso libera e o que não libera

`G1` é a condição de entrada da **fase 2**. Ela está satisfeita **sob as resoluções
declaradas na §2 deste documento**. Quatro delas são contradições entre trechos
normativos e **precisam de decisão explícita antes da fase 1 encostar no `fold`** — não
porque o gate falhou, mas porque foi preciso escolher uma leitura para que ele pudesse
rodar, e essa escolha não é do implementador:

| # | Precisa decidir | Se decidir o contrário |
|---|---|---|
| CONFLITO-01 | `hostTs` retroativo: clampa (R-1) ou recusa (POC-01)? | muda o desfecho de um `kind` × um estágio; sem impacto estrutural |
| CONFLITO-02 | R-27 rejeita 0..5 retroativamente, mas §8.0 não tem lookahead | exige forma de **lote** na assinatura do `fold` — **mudança de contrato** |
| CONFLITO-03 | a gênese de §19.1 não passa por R-4/R-5 como escrito | **nenhuma comunidade pode ser criada**; R-27 precisa suspendê-las |
| CONFLITO-04 | §8.0 diz `next === prev`; §8.2 diz que `interpretedSeq` sempre avança | redação; a semântica de §8.2 é a que sustenta P-10 e §7.5 |
| CONFLITO-05 | §6.3 promete reentrada "pelo mesmo convite"; R-9 a proíbe | muda a defesa anti-Sybil de §12.6 |

Mais **treze buracos de spec** (§3) em que o `fold` precisa de um valor que a spec não dá —
dois deles com **número em material assinado** (HOLE-06, a numeração das 17 permissões;
HOLE-09, o valor de `text`/`voice`) e um com **semântica de contador nunca definida**
(HOLE-05, o `RingCounter` de R-15) — e **um risco
estrutural** à própria tese de convergência (**RISCO-01**: §8.6 conta grafemas, grafema vem
do ICU, e a spec não fixa versão de ICU).

**Nenhum deles invalida A02.** Todos são decisões que precisam existir antes de a fase 1
escrever a versão de produção do `fold`.

---

## 1. O que foi construído

| Módulo | Seção normativa | Arquivo |
|---|---|---|
| Constantes de protocolo | §27.1, §1.5, §26.2 | `src/protocol/constants.ts` |
| Catálogo de erros | §20.2 | `src/protocol/errors.ts` |
| Catálogo de `kind` | §7.4 | `src/protocol/kinds.ts` |
| Permissões, efetiva e hierarquia | §9.1, §9.2, §9.3, §9.4 | `src/protocol/permissions.ts` |
| Primitivos de encoding | §7.2.1 | `src/codec/wire.ts` |
| `opCodec` (Op/Envelope/HostRecord + registry) | §7.1, §7.2, §7.3 | `src/codec/opCodec.ts` |
| `idgen` | §7.3 | `src/codec/idgen.ts` |
| `DecisionState` | §8.1 | `src/fold/state.ts` |
| Limites de campo e normalização | §8.6 | `src/fold/limits.ts` |
| Indexação fracionária | §6.4.1, R-20 | `src/fold/rank.ts` |
| `Effect` (tipo fechado) | §8.4 | `src/fold/effects.ts` |
| **`fold` — os 15 estágios** | §8.0, §8.2, §8.5 | `src/fold/index.ts` |
| Regras `R-*` e efeitos por `kind` | §8.3, §8.4, §8.4.1 | `src/fold/apply.ts` |
| Alvo de hierarquia (estágio 12) | §9.3, R-4, R-16 | `src/fold/targets.ts` |
| `view.db` + hash de dump ordenado | §10.3, §10.4, P-11 | `src/node/viewdb.ts` |
| Projetor pausável | §10.5, §10.7 | `src/node/projector.ts` |
| Snapshot de `DS` e residência | §10.6, §8.1 | `src/node/snapshot.ts` |
| Réplica | §8.7 | `src/node/replica.ts` |
| **Host com fila de admissão serializada** | §11.4, §11.5, §21.3 | `src/host/host.ts` |
| **Host adversário** | §1.4, §28.5 | `src/host/adversary.ts` |
| Cliente (monta e assina op) | §19.3 passo 2 | `src/client/client.ts` |
| Mundo do harness (gênese, convite, 10 clientes) | §19.1, §5.3, §12 | `src/harness/world.ts` |

**Não construído, conforme a instrução e a linha "Não implementar" do POC-01:** renderer,
stores, IPC, mídia, blobs, busca (FTS5), presença, Electron. Os efeitos `ftsIndex` /
`ftsRemove` **são emitidos** pelo `fold` (fazem parte do tipo fechado de §8.4) e o
projetor os ignora — a alternativa seria mutilar o contrato de `Effect`.

### 1.1 `kind`s implementados — 16, não 15

A instrução pedia 15. Foram implementados **16**. O décimo sexto é `invite.create` (50), e
a razão é da própria spec do PoC:

> **SCOPE-DELTA-01.** A linha **"Construir"** do POC-01 exige *"um host, **dez clientes**,
> Hypercore real…"*. Os 15 `kind`s da instrução não contêm nenhum caminho de associação:
> `member.join` (25) exige, por **R-9**, um convite existente, não revogado, não expirado,
> com `uses < maxUses` — e o único `kind` que cria convite é `invite.create` (50). Sem ele
> a comunidade fica com **um** membro (o fundador da gênese) e as corridas C1 ("dois
> moderadores") e C8 ("ban ‖ op do alvo") ficam inexprimíveis. `invite.create` e R-9 estão
> integralmente especificados (§7.4.5, §8.3 R-9, §12); implementá-los é seguir a spec, não
> inventar. Registrado aqui para que a diferença de escopo seja explícita.

Os 16: `community.create` · `role.create` · `role.update` · `role.delete` · `member.join` ·
`member.setRoles` · `category.create` · `category.delete` · `channel.create` ·
`channel.update` · `channel.delete` · `message.send` · `message.delete` · `reaction.set` ·
`mod.ban` · `invite.create`.

Os outros 22 `kind`s normativos **não** entram no registry de payload, o que os torna
`IGNORED` / `E_UNKNOWN_KIND` — exatamente o comportamento que §7.2.1 exige de um `kind`
sem layout declarado ("Regra que fecha `DR-10`"). Isso é testado para os 22, um a um.

### 1.2 As oito corridas — qual leitura foi usada

> **AMBIG-01.** §21.1 tem **treze** linhas e o texto logo abaixo diz *"as oito linhas
> acima"*. §28.2 e POC-01 repetem "as oito corridas de §21.1" sem identificá-las. **Não há
> como saber quais oito a spec quis dizer.**

A leitura usada, e o porquê: das treze linhas, três não são corrida entre ops ("duas
instâncias do app", "projeção e leitura simultâneas", "dois escritores do mesmo core") e
duas exigem `kind`s fora deste harness (`invite.create` **concorrente** para "dois
candidatos no último uso de um convite"; `role.move` para "`role.move` ‖ `role.move`").
Sobram **exatamente oito** — e são elas que estão implementadas:

| # | Corrida (linha de §21.1) | Desfecho normativo |
|---|---|---|
| C1 | dois moderadores editam o mesmo cargo | ambas aplicam; maior `seq` vence campo a campo |
| C2 | `channel.delete` ‖ `message.send` | `E_CHANNEL_NOT_FOUND` antes do append |
| C3 | `channel.create(#x)` ‖ `channel.create(#x)` | `E_CHANNEL_NAME_TAKEN` antes do append (R-6) |
| C4 | `role.delete` ‖ `member.setRoles` citando-o | o `setRoles` posterior **descarta** o id |
| C5 | `category.delete` ‖ `channel.create` | `E_CATEGORY_NOT_FOUND` antes do append |
| C6 | `message.delete` ‖ `reaction.set` | `E_MESSAGE_DELETED` antes do append |
| C7 | `channel.delete`(último) ‖ `channel.delete`(penúltimo) | `E_LAST_CHANNEL` (R-7) |
| C8 | ban ‖ op do alvo | `E_BANNED` antes do append |

**A identificação das oito precisa ser fechada na spec.** Se a intenção era outra lista, o
gate precisa ser reexecutado sobre ela.

Cada repetição roda **dois** ensaios, sobre fixtures independentes:

- **SERIAL** — projetor pausado, op A, **reinício do host**, op B. Depois do reinício o
  `DS` que decide B foi **interpretado a partir do log**, não herdado da admissão. É o
  ensaio que o critério do POC-01 pede ("com o projetor pausado e reinício do host no
  intervalo").
- **PARALELO** — projetor pausado, A e B submetidas no **mesmo turno**. `submit` agenda o
  dreno num microtask, então as duas entram na fila **antes de qualquer decisão** e são
  decididas dentro da **mesma seção crítica**, no mesmo group commit de §11.5. É a forma
  mais forte de "submetida em paralelo": não há janela em que uma já foi decidida e a
  outra ainda não chegou.

Oráculo em ambos, além do código de erro: **`core.length` cresce exatamente o número de
vencedoras**. A perdedora não é appendada — é a diferença entre v1 e v2.

---

## 2. Conflitos entre documentos normativos

Estes não são buracos: são pontos onde **dois trechos normativos se contradizem**. Cada um
exige decisão explícita antes da fase 1. Em todos, a resolução aplicada seguiu a
precedência de §0.2 (`backend-v2.md` acima do plano de validação) e está isolada em uma
linha de código comentada.

### CONFLITO-01 — `hostTs` retroativo: R-1 manda clampar, POC-01 manda rejeitar

- `backend-v2.md` §8.3 **R-1**: *"Se o registro trouxer `hostTs < lastHostTs`, o `fold` usa
  `lastHostTs` no lugar (clamp determinístico) e conta `fold.hostTsClamped`"* — coluna
  "Falha": **"— (clamp, não recusa)"**. §8.2 estágio 5 confirma: a única recusa ali é
  `E_COMMUNITY_ENDED`.
- `plano-de-validacao-experimental-v2.md`, POC-01, **Aprovação**: *"Todo registro
  adversário **REJECTED ou IGNORED** em toda réplica"* — e "hostTs retroativo" está
  listado entre os cenários adversários.

**Não é possível atender aos dois.** Aplicado R-1 (precedência). Medido no cenário X3a: o
registro é `APPLIED`, com `hostTs` clampado para `lastHostTs`, **e nenhum efeito
retroativo é produzido** — a mensagem entra com o carimbo da cabeça do log, não com o
carimbo forjado. Todas as réplicas concordam. O ataque não ganha nada; o critério literal
do plano, ainda assim, não é atendido. **É a razão de a decisão do gate ser "confirmado
com limite alterado" e não "confirmado".**

Nota relacionada, medida em X3b: se o adversário recuar **também** o `op.ts` para casar
com o `hostTs` forjado — que é o que um ataque de forjar histórico faria —, o registro é
`REJECTED` com `E_CLOCK_UNREASONABLE` no estágio 7, porque R-2 compara contra o `hostTs`
**efetivo** (pós-clamp). Ou seja: o clamp de R-1 e a janela de R-2 juntos já matam o ataque
útil. **Decisão pedida:** alinhar o critério do POC-01 ao R-1, ou mudar R-1 para recusar.

### CONFLITO-02 — R-27 exige lookahead que a assinatura de §8.0 não tem

- **R-27**: *"Qualquer desvio … faz **todos** os registros de 0 a 5 serem `REJECTED`"*.
- **§8.0**: `foldRecord(prev: DecisionState, rec: RawRecord, seq: number)` — **um registro
  por vez, sem lookahead**. No `seq` 2 a função ainda não viu os `seq` 3, 4 e 5.

Uma réplica que interpreta incrementalmente (o caso normal: §10.5 lê em lotes a partir de
`interpretedSeq + 1`) **não pode** rejeitar retroativamente um registro que já aplicou.

Implementado: cada registro de `seq` 0..5 é conferido contra a posição que R-27 exige
**dele** (`kind` esperado, `authorSeq` esperado, mesmo autor); o desvio marca
`communityInvalid` e, a partir daí, **todo** registro é `REJECTED` — inclusive os
restantes da gênese e, por §8.4.1, tudo em `seq ≥ 6` (`E_NOT_MEMBER`, porque não há
membro). **Toda réplica concorda**, então não há divergência. O que não acontece é a
rejeição *retroativa* de 0..k−1. **Decisão pedida:** ou R-27 passa a descrever a semântica
por registro, ou §8.0 ganha uma forma de lote para a gênese.

### CONFLITO-03 — a gênese de §19.1 não passa por R-4 e R-5

R-27 suspende **explicitamente** os estágios 8 e 11 (associação e permissão) e R-9. Não
suspende o estágio 12 (hierarquia) nem R-4/R-5 dentro do estágio 14. Mas o lote de gênese
de §19.1:

- `seq 1` cria o cargo Fundador **com as 17 permissões**, e nesse momento o autor não tem
  cargo nenhum → **R-5** ("ninguém concede a um cargo permissão que não possui no conjunto
  efetivo") recusa;
- **R-4** ("nenhum cargo criado pode ter `rank ≥ topRank(autor)`") com `topRank(autor) =
  null` recusa qualquer criação.

**Como está escrito, nenhuma comunidade pode ser criada.** Implementado: a suspensão de
R-27 foi estendida ao estágio 12 e a R-4/R-5 durante `seq` 0..5. É a única leitura que
torna §19.1 executável. **Decisão pedida:** R-27 precisa dizer isso.

### CONFLITO-04 — `next === prev` (§8.0) × `interpretedSeq` avança sempre (§8.2)

- §8.0: *"`next: DecisionState` — sempre presente; **`=== prev` quando não `APPLIED`**"*.
- §8.2: *"Em **todos** os desfechos o estágio final atualiza `interpretedSeq = seq` e,
  quando o registro chegou ao estágio 6, também `lastAuthorSeq[author] = authorSeq` —
  **inclusive em `REJECTED`**"*.

Se `interpretedSeq` avança, `next` **não pode** ser identicamente `prev`. Implementado
conforme §8.2, que é a regra operativa: é dela que dependem P-10 ("não há buraco") e a
propriedade de §7.5 que impede reciclar `authorSeq` após uma recusa. `=== prev` foi lido
como "sem efeito no `CS`". **Decisão pedida:** corrigir a redação de §8.0.

### CONFLITO-05 — reentrar "pelo mesmo convite" é impossível por R-9

- **§6.3**, ficha de `Member`: *"Quem sai e volta **pelo mesmo convite** recupera o
  `Member` com `roleIds` resetado ao cargo base."*
- **R-9**: `member.join` exige que o par *"`(invitePk, author)` ainda **não** usado"*.

Depois de `member.leave`, o par `(invitePk, autor)` **já está em `joinedByInvite`** — então
o mesmo convite nunca mais serve para aquela pessoa. O fluxo que §6.3 descreve como
esperado é recusado com `E_INVITE_INVALID`.

Implementado conforme **R-9**: é a regra operativa, e é dela que depende a defesa anti-Sybil
de §12.6 (sem ela, um convite de `maxUses = 1` pode ser reusado indefinidamente pelo mesmo
candidato entrando e saindo). Consequência: **reentrar exige um convite novo**. Verificado
na suíte `fold/regras R-*` ("R-9 par (convite, autor) já usado"). `member.leave` (`kind`
26) está fora do escopo deste PoC, então o fluxo completo não foi exercitado — só a regra.
**Decisão pedida:** corrigir a redação de §6.3, ou abrir exceção em R-9 para reentrada.

### AMBIG-02 — `lastAuthorSeq[author] = authorSeq` em duplicata regride o contador

§8.2 manda atribuir `lastAuthorSeq[author] = authorSeq` para todo registro que chegou ao
estágio 6, incluindo os `REJECTED`. Aplicado **literalmente** a uma duplicata (que por
definição tem `authorSeq ≤ lastAuthorSeq`), o contador **retrocede** — e o replay que §7.5
fecha reabre na hora seguinte. Implementado como `max(atual, authorSeq)`. É a única leitura
compatível com §7.5 ("ignora todo registro com `authorSeq ≤ lastAuthorSeq[author]`").
Verificado no fuzzer: `signed-authorseq-replay` e `signed-authorseq-regress` somam ~1,25 M
entradas, todas `E_DUPLICATE`, nenhuma regressão de contador.

---

## 3. Buracos de spec — levantados, não inventados

Cada um é um ponto em que **o `fold` precisa de um valor ou de uma regra que a spec não
dá**. Onde foi preciso escolher para o harness rodar, a escolha está marcada
`ASSUMPTION-nn` no código e é **candidata a virar norma**, não decisão tomada.

| # | Buraco | Onde dói | O que o harness fez |
|---|---|---|---|
| **HOLE-04** | **Não existe estágio de teto de envelope.** `MAX_ENVELOPE_BYTES` (32 KiB / 64 KiB) e `E_PAYLOAD_TOO_LARGE` existem em §26.2/§27.1/§20.2, mas §8.2 não tem estágio para eles e §8.6 não tem linha. §14.4 impõe teto **no transporte** — que o host adversário não usa. | Um host adversário appenda um envelope de tamanho arbitrário e **toda réplica aplica**. O teto declarado não vincula ninguém. | Não enforça (a tabela de §8.6 é declarada "única e autoritativa"). **Levantado.** |
| **HOLE-05** | `RingCounter` é citado em §8.1 e **nunca definido**. R-15 descreve a janela em uma linha. | Duas implementações podem contar janelas diferentes → interpretações diferentes do mesmo log. | Janela deslizante sobre `seq`, contando ops e bytes de payload dos registros do autor com `seq > seqCorrente − QUOTA_WINDOW_SEQS`; conta ao **admitir** no estágio 10, mesmo que estágios posteriores recusem (coerente com §7.5, "uma op recusada antes do append queima o número"). |
| **HOLE-06** | O valor numérico de cada uma das 17 permissões. `role.create`/`role.update` carregam `arr<u8>` (§7.4.3) — **número em material assinado**. | Dois clientes com numerações diferentes concedem permissões diferentes lendo o mesmo log. | Ordem de leitura da tabela de §9.1 (0..16). |
| **HOLE-07** | §7.2.1 diz que o tipo `id` é "string de 26 caracteres"; §7.3 define `entityId` como **prefixo + 26**. | Menor: o tipo do registry é `str` com prefixo de tamanho, então não é estrutural. | Segue §7.3 (traz a fórmula). |
| **HOLE-09** | O valor `u8` de `text` e `voice` em `channel.create`. §6.6 fecha o enum por nome, nunca por número. | Número em material assinado. | `text = 0`, `voice = 1`. |
| **HOLE-10** | Não há definição de valores para `RoleColor` / `avatarColor` / `iconColor`, e §8.6 não tem linha para eles. | O `fold` não tem como recusar cor inválida; a UI recebe `u8` arbitrário. | Aceita qualquer `u8` (§8.6 é "tabela única e autoritativa" e não os lista). |
| **HOLE-11** | O estado `invalid` de comunidade, que R-27 e §8.4.1 exigem, **não tem campo** no `DecisionState` de §8.1. | Sem ele R-27 não é implementável. | Campo `communityInvalid: boolean`. |
| **HOLE-12** | O tipo `Effect` de §8.4 é **fechado** e não tem forma em lote. | `mod.ban` de quem tem N mensagens emite **N** `patch` (ocultação de §6.12/§18.2); `channel.delete` idem para `orphaned`. Num canal com 100 k mensagens isso é uma transação de 100 k efeitos. | Emite um `patch` por mensagem. **Custo levantado**; é problema de §26.1/G9. |
| **HOLE-13** | §11.4 diz que o `DS` do host e o do projetor são **a mesma instância** e que o `DS` só avança no passo 8 (dentro da seção crítica) — **e** que "a projeção do host roda pelo mesmo caminho de todo mundo, a partir do log". As duas coisas juntas fariam cada registro ser interpretado duas vezes. | Sem resolução, o host aplica efeitos em dobro ou mantém estado duplicado (que §11.4 proíbe). | O `fold` roda **uma vez**, na admissão; o projetor consome os `Effect` daquela execução. No **reinício**, o `DS` é reconstruído do log pelo caminho de réplica — e o gate compara os dois: hash idêntico em 100 % dos casos. |
| **HOLE-14** | O `rank` do **cargo base** na gênese. §6.4.1 fixa só o do Fundador ("sempre o máximo"). | Com o default natural (novo cargo entra no fim), **todo membro comum passa a superar todo moderador** na hierarquia de §9.3 — a moderação inteira para de funcionar. | Cargo base nasce no **fundo** (`RANK_BOTTOM`). |
| **HOLE-15** | §7.2.1 declara `rank` como "base62, **1–64 caracteres**"; §6.4.1 gera `rank` por `midpoint` **sem cota de comprimento**. | Medido: **a partir de ~383 inserções consecutivas no fundo, a chave passa de 64 caracteres** e sai do tipo declarado. A spec não diz o que acontece: recusar? recompactar? aceitar? | O harness gera sem cota e mede o ponto de estouro. **Levantado.** |
| **HOLE-17** | Durante a gênese, `role.create`, `category.create` e `channel.create` estão marcados **`Aud. = sim`** em §7.4, e R-27 suspende só os estágios 8 e 11 — logo, pela letra, os `seq` 1, 2, 4 e 5 deveriam gerar entrada de auditoria. Mas §6.13 exige `byLabel` **congelado no momento da aplicação**, e nesses `seq` o autor **ainda não é membro** (o `member.join` dele é o `seq` 3): não existe rótulo para congelar. | O log de auditoria de toda comunidade nasceria com quatro entradas cujo `byLabel` é um fragmento de chave em hexadecimal. | **Não emite auditoria durante a gênese** (§19.1 descreve o lote como criação, não como moderação). A leitura oposta é defensável; a spec precisa escolher. |
| **HOLE-16** | `E_FOUNDER_IMMUTABLE` e `E_FOUNDER_TOP` estão no catálogo de §20.2 e são prometidos por §6.4.1, mas o cargo Fundador tem sempre o `rank` **máximo** — então o **estágio 12** (R-4: `rank ≥ topRank(autor)`) recusa antes de o estágio 14 chegar à regra do Fundador, **para todo autor, inclusive o próprio Fundador**. | Dois códigos do catálogo são **inalcançáveis**. O cliente recebe `E_HIERARCHY` onde a spec promete `E_FOUNDER_IMMUTABLE`, e a UI de §20.3 não tem como distinguir. | Segue a ordem de §8.2 (`E_HIERARCHY`) e registra o achado. |

---

## 4. Observações sobre o runtime e sobre limites já fixados

| # | Achado | Consequência |
|---|---|---|
| **OBS-01** | Em `hypercore@11.35.1`, `core.key` é o **hash do manifesto**, não `keyPair.publicKey`. §5.3 ("`communityId = hex(logKeyPair.publicKey)`") e §6.2 ("`coreKey` der = `id`") tratam os dois como a mesma coisa. Só com `compat: true` eles coincidem. | O harness usa `compat: true`. Ou a spec para de equiparar `communityId` à chave do core, ou o produto fica preso a um modo de compatibilidade legado do Hypercore. **É decisão de G0/G2, levantada aqui.** |
| **OBS-02** | §10.7 nomeia `await core.flush()` como barreira de durabilidade do append (`REQUIRES POC — G4`). **O método não existe** em `hypercore@11.35.1**.** `core.state.flush()` existe, mas é flush de transação de sessão e **lança** `TypeError` quando não há transação aberta. Medido: `await core.append(...)` sozinho sobrevive a `close()` + reabertura. | G4 precisa fixar qual é a barreira real. Sobreviver a um `close()` limpo **não** prova sobrevivência a `SIGKILL` (§28.3). |
| **OBS-03** | O snapshot de §10.6 precisa de forma **canônica**. Sem chaves ordenadas, uma entidade que ganha um campo opcional depois (`channel.update` setando `topic` num canal que nasceu sem) serializa numa ordem, e a mesma entidade reconstruída do snapshot serializa noutra. | Conteúdo idêntico, blob diferente. Qualquer verificação sobre o **blob** (hash de snapshot, checksum, comparação entre réplicas) daria falso positivo. §10.6 deveria exigir forma canônica. Corrigido no harness. |
| **OBS-04** | §8.6 limita `Reaction.emoji` a **1 grafema / 24 bytes**. A família com ZWJ (`👨‍👩‍👧‍👦`) é 1 grafema e **25 bytes**. | Emoji ZWJ comuns são **rejeitados**. É consequência de produto, não bug: ou o teto sobe, ou a UX precisa saber. |
| **OBS-05** | §27.1/§26.2 declaram `ATTACHMENT_MAX_BYTES` = **8 GiB** e `ATTACHMENT_QUOTA_PER_MEMBER` = **5 GiB**, e R-14 roda no mesmo registro. | **O teto de 8 GiB é inalcançável.** O máximo efetivo é 5 GiB, e só para quem não tem nenhum outro anexo vivo. `E_ATTACHMENT_TOO_LARGE` nunca dispara antes de `E_QUOTA_EXCEEDED`. |
| **ACHADO-01** | Bug encontrado **pelo próprio fuzzer**, no decodificador deste harness: leitura fora de limite devolvia `Buffer.alloc(n)` com o `n` **pedido**. Um prefixo de tamanho hostil (`uint` = 2³²−1) fazia o `fold` alocar 4 GiB antes de concluir que a entrada é malformada. | Não viola a totalidade de §8.5 (o desfecho continua sendo `IGNORED`), mas é **negação de serviço trivial contra qualquer réplica**. Corrigido. Aponta direto para **HOLE-04**: a spec não tem estágio de teto de bytes antes do decode. |
| **RISCO-01** | §8.6 conta **grafemas**. Grafema é definido pelo ICU do runtime, e a spec **não fixa versão de ICU nem de Unicode**. §1.5 diz que a interpretação do log não pode depender do ambiente. | Duas réplicas em versões diferentes de ICU podem discordar da contagem de grafemas de uma entrada exótica e **divergir de verdade** — a única brecha estrutural encontrada na tese "mesma função em todo nó". O ICU e o Unicode usados estão no artefato (`ambiente.json`). **Precisa virar constante de protocolo, ou a contagem precisa passar a ser por code point / bytes.** |

---

## 5. Como reproduzir

```bash
cd poc/poc-01-fold
npm ci                 # lockfile no artefato, sha256 em out/gate-G1/ambiente.json
npm run build
node --max-old-space-size=10240 dist/scripts/run-all.js        # gate completo
POC01_PROFILE=quick node dist/scripts/run-all.js               # execução curta
POC01_SEED=0x... node dist/scripts/run-all.js                  # semente do fuzzer
```

O fuzzer é determinístico: mesma semente, mesmas 10⁷ entradas. A semente usada está em
`out/gate-G1/fuzzer.json`.

Cenários, isoladamente: `scripts/run-unit.ts` (§28.1) · `scripts/run-fuzz.ts` (totalidade)
· `scripts/run-races.ts` (as oito corridas) · `scripts/run-adversary.ts` (§28.5) ·
`scripts/run-determinism.ts` (§28.4).

---

## 6. Cobertura dos 15 estágios de §8.2 — o que ficou de fora, e por quê

O fuzzer alcança os estágios **1, 2, 3, 4, 6, 7, 8, 10, 11, 12, 13, 14 e 15**. Faltam
**dois**, e os motivos são estruturais, não descuido:

| Estágio | Condição | Por que não aparece |
|---:|---|---|
| **5** | comunidade `ended` | Exige `community.end` (`kind` 42), **fora dos 16 implementados**. Sem ele `endedAt` nunca é setado e a condição é inalcançável. |
| **9** | timeout ativo | Exige `mod.timeout` (`kind` 33), **fora dos 16**. Sem ele `timeoutUntil` nunca é setado. |

O **estágio 10** tem duas regras e cada uma é alcançada de um jeito:

- **R-14** (cota de anexo) — alcançada **pelo fuzzer**: o gerador emite anexo em ~1/4 das
  `message.send`, com `sizeBytes` cruzando `ATTACHMENT_QUOTA_PER_MEMBER` e
  `ATTACHMENT_MAX_BYTES`. Também há caso unitário provando que R-14 **precede** permissão
  (11), hierarquia (12) e limite de campo (13), como §8.2 manda.
- **R-15** (cota de ops) — só aparece **em volume** (2 000 ops do mesmo autor numa janela
  de 10 000 registros), e o fuzzer submete tudo contra o mesmo `prev`, então nunca acumula.
  Coberta na suíte `fold/cota R-15` dos unitários, que mede a fronteira exata: a op nº
  2 001 é a primeira `E_QUOTA_EXCEEDED`, e a cota é **por autor**, não global.

  R-15 também foi confirmada **acidentalmente, em produção do próprio harness**: a primeira
  execução completa das corridas foi interrompida pelo `fold` recusando o *setup* com
  `E_QUOTA_EXCEEDED`, porque a fixture concentrava todas as ops de setup num único autor.
  A regra funciona, e funciona contra quem a escreveu.

Fechar os estágios 5 e 9 no fuzzer exige `community.end` e `mod.timeout`, que estão fora do
escopo declarado deste PoC. **Levantado para o gate seguinte.**

---

## 7. O que este gate **não** prova

Fora do escopo por construção, e portanto **não** coberto por esta decisão:

- **Durabilidade sob `SIGKILL`** — a matriz de crash de §28.3 é de **G4**. Aqui só se
  provou que a decisão acontece antes do append, não que o append sobrevive a queda.
- **Transporte** — a replicação é Hypercore real, por stream em processo. `hyperdht/testnet`,
  NAT, autorização de canal (§14.3) e controle de admissão do transporte (§14.4) são G2/G7.
- **Escala** — o `DecisionState` foi exercitado com centenas de membros e milhares de
  mensagens, não com a escala de referência de §26.2 (340 membros, 100 k mensagens) nem
  com 50 comunidades abertas. O orçamento de memória do `DS`, que POC-01 lista como
  segunda condição para invalidar A02, é **G9** e **não foi medido aqui**.
- **Os outros 22 `kind`s** — provou-se que são `IGNORED` corretamente, não que suas regras
  estão certas.
- **`fold.wouldAccept` no cliente** (§8.7, advisório) e a outbox (§11.2, §11.6) — G4.
