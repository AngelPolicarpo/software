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

> ## `CONFIRMADO`
>
> **A02 — "o estado de uma comunidade é `fold(log)`, uma função pura, total e
> determinística" — sobreviveu a todos os testes que POC-01 define.** Nenhuma exceção em
> 10⁷ entradas hostis, nenhuma divergência de hash entre réplicas em nenhum cenário,
> nenhuma corrida aceita nas duas pontas, nenhum registro do host adversário com efeito
> não autorizado.
>
> **Os sete critérios de aprovação foram atendidos, nenhum parcial.** A execução que
> sustenta este veredito é a de **2026-08-16**, `foldBuildId 0a9b7a4a…`, 22,4 min, feita
> **depois** de os cinco conflitos normativos serem decididos **e** de os treze buracos de
> spec de §3 serem fechados — não sobre uma leitura escolhida pelo implementador.

### Histórico do veredito

A primeira execução (2026-08-16T02:54Z, `foldBuildId 3327cf58…`) fechou como **`CONFIRMADO
COM LIMITE ALTERADO`**. A ressalva não era do resultado, era da spec: o critério do POC-01
exigia que *todo* registro adversário fosse `REJECTED` ou `IGNORED` e listava `hostTs`
retroativo entre eles, enquanto **R-1 (§8.3) manda clampar, não recusar**. Os dois não
podiam valer juntos.

Os cinco conflitos foram decididos e os documentos normativos corrigidos
(PATCH-NORMATIVO-01, §2 deste documento). O gate foi então **re-executado inteiro** sobre a
redação vigente, com o `fold` reescrito para ela. A ressalva desapareceu porque a
contradição desapareceu — não porque o critério foi afrouxado: o registro com `hostTs`
retroativo continua sendo clampado, sem efeito retroativo, com desfecho idêntico em toda
réplica.

### O que isso libera e o que não libera

`G1` é a condição de entrada da **fase 2**, e a fase 2 vem **depois** da fase 1, que exige
**G0 e G10** — nenhum dos dois tem artefato. G1 estar confirmado **não** autoriza começar a
fase 2.

Duas limitações de validade deste artefato, que nenhum critério do POC-01 cobre:

1. **Ambiente.** Rodou em **Node 22 puro**, não em Electron empacotado. Para o `fold`, que
   é JS puro, isso é quase sempre irrelevante — a exceção era a contagem de grafemas, que
   dependia do ICU do runtime e que **deixou de existir** com a mudança para code points
   (RISCO-01). Depois dessa mudança, não resta no `fold` nenhuma dependência conhecida do
   runtime, o que é justamente o que torna este resultado transferível para o Electron.
2. **Ordem.** G1 foi executado antes de G0, fora da ordem de §6 do plano. Isso não invalida
   o resultado, mas continua registrado.

Os **treze buracos de spec** de §3 foram fechados em 2026-08-16, inclusive os três que
punham **número em material assinado** (HOLE-06, a numeração das 17 permissões; HOLE-09, o
valor de `text`/`voice`; HOLE-10, a numeração das cores) e o que deixava uma **semântica de
contador nunca definida** (HOLE-05, o `RingCounter` de R-15). Cinco deles mudaram o
comportamento do `fold` — estágio 0 de teto de bytes, faixa de cor, `patchScope`,
renormalização de `rank` e a ordem dentro do estágio 12 —, e por isso este artefato é de
uma execução **posterior** a todos eles.

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

## 2. Conflitos entre documentos normativos — **todos fechados em 2026-08-16**

Estes não eram buracos: eram pontos onde **dois trechos normativos se contradiziam**. Os
cinco foram decididos e os documentos normativos foram corrigidos (PATCH-NORMATIVO-01);
o harness foi reescrito para a redação vigente e o gate foi **re-executado inteiro** sobre
ela. O que segue registra o conflito como encontrado, a decisão tomada e onde ela está.

| # | Decisão | Onde está agora |
|---|---|---|
| CONFLITO-01 | O clamp de R-1 vence; o critério do plano passou a admitir "neutralizado por regra determinística declarada" | `plano-…-v2.md` POC-01, linha "Aprovação" |
| CONFLITO-02 | Verificação **por registro, sem retroação** | `backend-v2.md` R-27(c) e §8.4.1 |
| CONFLITO-03 | **Principal de gênese**: nada é suspenso, o autor é que passa a ter as 17 permissões e `topRank = RANK_GENESIS`; mais a forma normativa dos payloads dos `seq` 1, 2 e 3 | `backend-v2.md` R-27(a)(b), §8.2 estágio 8, §19.1 |
| CONFLITO-04 | §8.2 é a regra operativa; `next` difere de `prev` em `interpretedSeq`, `lastAuthorSeq` e `partialInterpretation` | `backend-v2.md` §8.0 |
| CONFLITO-05 | R-9 vence: reentrar exige convite **novo** | `backend-v2.md` §6.3 |

### CONFLITO-01 — `hostTs` retroativo: R-1 manda clampar, POC-01 manda rejeitar

- `backend-v2.md` §8.3 **R-1**: *"Se o registro trouxer `hostTs < lastHostTs`, o `fold` usa
  `lastHostTs` no lugar (clamp determinístico) e conta `fold.hostTsClamped`"* — coluna
  "Falha": **"— (clamp, não recusa)"**. §8.2 estágio 5 confirma: a única recusa ali é
  `E_COMMUNITY_ENDED`.
- `plano-de-validacao-experimental-v2.md`, POC-01, **Aprovação**: *"Todo registro
  adversário **REJECTED ou IGNORED** em toda réplica"* — e "hostTs retroativo" está
  listado entre os cenários adversários.

**Não era possível atender aos dois.** Aplicado R-1 (precedência). Medido no cenário X3a: o
registro é `APPLIED`, com `hostTs` clampado para `lastHostTs`, **e nenhum efeito
retroativo é produzido** — a mensagem entra com o carimbo da cabeça do log, não com o
carimbo forjado. Todas as réplicas concordam. O ataque não ganha nada.

**Decisão (2026-08-16):** corrigido **o plano**, não R-1 — §0.2 dá precedência a
`backend-v2.md`. O critério de aprovação do POC-01 passou a admitir "REJECTED, IGNORED **ou
neutralizado por regra determinística declarada**", com o mesmo desfecho em toda réplica.
Era a única ressalva que impedia o veredito de ser "confirmado" sem qualificação.

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

**Decisão (2026-08-16):** R-27 passou a descrever a semântica **por registro**, em R-27(c),
e §8.4.1 foi corrigida junto. Cada registro de `seq` 0..5 é conferido contra a posição que
R-27 exige **dele** (`kind`, `authorSeq`, mesmo autor e, agora, forma do payload); o desvio
marca `communityInvalid` e, a partir daí, **todo** registro é `REJECTED` — inclusive os
restantes da gênese e tudo em `seq ≥ 6`. **Toda réplica marca `invalid` no mesmo `seq`**,
então não há divergência. Não há rejeição retroativa de 0..k−1, e o texto normativo agora
diz isso explicitamente. A alternativa — dar forma de lote a §8.0 — foi descartada: seria
**mudança de contrato** do módulo por causa de 6 registros.

### CONFLITO-03 — a gênese de §19.1 não passava por R-4 e R-5 · **FECHADO**

R-27 suspendia **explicitamente** os estágios 8 e 11 (associação e permissão) e R-9. Não
suspendia o estágio 12 (hierarquia) nem R-4/R-5 dentro do estágio 14. Mas o lote de gênese
de §19.1 tinha **três** falhas independentes, não uma:

- **(i)** `seq 1` cria o cargo Fundador **com as 17 permissões**, e nesse momento o autor
  não tem cargo nenhum → **R-5** ("ninguém concede a um cargo permissão que não possui no
  conjunto efetivo") recusava;
- **(ii)** **R-4** ("nenhum cargo criado pode ter `rank ≥ topRank(autor)`") com
  `topRank(autor) = null` recusava qualquer criação;
- **(iii)** o payload de `member.join` (§7.4) **não tem `roleIds`**, e nenhuma regra dava o
  cargo Fundador ao host. Esta sobrevivia à correção de (i) e (ii): a comunidade nasceria,
  e nasceria **permanentemente ingovernável** — o cargo base não pode ter `manage_roles`
  (R-11), o cargo Fundador não é editável (`E_FOUNDER_IMMUTABLE`) e `member.setRoles`
  exigiria permissão que ninguém teria.

Havia ainda uma quarta lacuna adjacente: `isFounder`/`isDefault` são `der` (§6.4) mas
`role.create` não os carrega (§7.4), e a derivação posicional não estava escrita.

**Como estava escrito, nenhuma comunidade podia ser criada.**

**Decisão (2026-08-16): principal de gênese.** Em vez de alongar a lista de exceções — que
foi onde o defeito nasceu, com "8 e 11" escrito e 12, R-4 e R-5 esquecidos —, R-27(a)
define **quem é o autor** durante `seq` 0..5: membro ativo, sem timeout, `efetiva` = as 17
permissões, `topRank = RANK_GENESIS` (sentinela acima de qualquer `rank` atribuível).
Nenhum estágio de §8.2 e nenhuma regra de §8.3 são suspensos; a única exceção que resta é
R-9, inevitável porque o `joinProof` do fundador é zerado por construção.

R-27(b) fecha (iii) e a lacuna adjacente normatizando a forma dos payloads: `seq` 1 carrega
**exatamente** as 17 e vira `isFounder`/`RANK_TOP`; `seq` 2 carrega subconjunto de
`{send_messages, attach_files, add_reactions, voice_speak, pin_messages}` e vira
`isDefault`/`RANK_BOTTOM`; `seq` 3 atribui `roleIds = {Fundador, base}`. Sem (b), suspender
regra sem restringir payload abriria um buraco **novo**: o cargo base poderia nascer com as
17 permissões — R-11 só se aplica a `role.update` —, e todo membro presente, futuro e
reingressante seria administrador. É exatamente o vetor `F-38`/`T-35` que R-11 existe para
fechar, reaberto pela gênese.

Verificado nesta execução: `R-27(a) RANK_GENESIS nunca é gravado como rank de cargo`,
`R-27(b) seq 3 => host tem Fundador E cargo base`, `R-27(b) Fundador sem as 17 =>
E_GENESIS_MISPLACED`, `R-27(b) cargo base com ban_members => E_GENESIS_MISPLACED`.

### CONFLITO-04 — `next === prev` (§8.0) × `interpretedSeq` avança sempre (§8.2)

- §8.0: *"`next: DecisionState` — sempre presente; **`=== prev` quando não `APPLIED`**"*.
- §8.2: *"Em **todos** os desfechos o estágio final atualiza `interpretedSeq = seq` e,
  quando o registro chegou ao estágio 6, também `lastAuthorSeq[author] = authorSeq` —
  **inclusive em `REJECTED`**"*.

Se `interpretedSeq` avança, `next` **não pode** ser identicamente `prev`. Implementado
conforme §8.2, que é a regra operativa: é dela que dependem P-10 ("não há buraco") e a
propriedade de §7.5 que impede reciclar `authorSeq` após uma recusa.

**Decisão (2026-08-16):** corrigida a redação de §8.0 — `next` difere de `prev`, quando não
`APPLIED`, **apenas** em `interpretedSeq`, `lastAuthorSeq` e `partialInterpretation`; o
`CS` não muda. Era divergência de redação: a própria tabela de §8.0 já dizia que `REJECTED`
avança `interpretedSeq`.

### CONFLITO-05 — reentrar "pelo mesmo convite" é impossível por R-9

- **§6.3**, ficha de `Member`: *"Quem sai e volta **pelo mesmo convite** recupera o
  `Member` com `roleIds` resetado ao cargo base."*
- **R-9**: `member.join` exige que o par *"`(invitePk, author)` ainda **não** usado"*.

Depois de `member.leave`, o par `(invitePk, autor)` **já está em `joinedByInvite`** — então
o mesmo convite nunca mais serve para aquela pessoa. O fluxo que §6.3 descreve como
esperado é recusado com `E_INVITE_INVALID`.

**Decisão (2026-08-16):** R-9 vence e §6.3 foi corrigida. É a regra operativa, e é dela que
depende a defesa anti-Sybil de §12.6 — sem ela, um convite de `maxUses = 1` seria reusável
indefinidamente pelo mesmo candidato entrando e saindo. Consequência normativa, agora
escrita: **reentrar exige um convite novo**. Verificado na suíte `fold/regras R-*` ("R-9
par (convite, autor) já usado"). `member.leave` (`kind` 26) segue fora do escopo deste PoC,
então o fluxo completo continua não exercitado — só a regra.

### AMBIG-02 — `lastAuthorSeq[author] = authorSeq` em duplicata regride o contador

§8.2 manda atribuir `lastAuthorSeq[author] = authorSeq` para todo registro que chegou ao
estágio 6, incluindo os `REJECTED`. Aplicado **literalmente** a uma duplicata (que por
definição tem `authorSeq ≤ lastAuthorSeq`), o contador **retrocede** — e o replay que §7.5
fecha reabre na hora seguinte. Implementado como `max(atual, authorSeq)`. É a única leitura
compatível com §7.5 ("ignora todo registro com `authorSeq ≤ lastAuthorSeq[author]`").
Verificado no fuzzer: `signed-authorseq-replay` e `signed-authorseq-regress` somam ~1,25 M
entradas, todas `E_DUPLICATE`, nenhuma regressão de contador.

---

## 3. Buracos de spec — **os treze fechados em 2026-08-16**

Cada um é um ponto em que **o `fold` precisa de um valor ou de uma regra que a spec não
dá**. Onde foi preciso escolher para o harness rodar, a escolha está marcada
`ASSUMPTION-nn` no código e é **candidata a virar norma**, não decisão tomada.

| # | Buraco | Onde dói | O que o harness fez |
|---|---|---|---|
| **HOLE-04** ✅ | **Não existe estágio de teto de envelope.** `MAX_ENVELOPE_BYTES` (32 KiB / 64 KiB) e `E_PAYLOAD_TOO_LARGE` existem em §26.2/§27.1/§20.2, mas §8.2 não tem estágio para eles e §8.6 não tem linha. §14.4 impõe teto **no transporte** — que o host adversário não usa. | Um host adversário appenda um envelope de tamanho arbitrário e **toda réplica aplica**. O teto declarado não vincula ninguém. | **Fechado em 2026-08-16:** §8.2 ganhou o **estágio 0** — teto de bytes antes de qualquer decode ou Ed25519 —, e §8.6 ganhou as duas linhas de registro (32 KiB sem anexo, 64 KiB com). O condicional roda no estágio 13, quando o decode já revelou se há anexo. |
| **HOLE-05** ✅ | `RingCounter` é citado em §8.1 e **nunca definido**. R-15 descreve a janela em uma linha. | Duas implementações podem contar janelas diferentes → interpretações diferentes do mesmo log. | **Fechado em 2026-08-16:** R-15 passou a definir a janela como **função sobre `seq`**, com o conjunto exato que entra nela e a regra de que recusar num estágio posterior não devolve a cota. `RingCounter` virou implementação, não contrato. |
| **HOLE-06** ✅ | O valor numérico de cada uma das 17 permissões. `role.create`/`role.update` carregam `arr<u8>` (§7.4.3) — **número em material assinado**. | Dois clientes com numerações diferentes concedem permissões diferentes lendo o mesmo log. | **Fechado em 2026-08-16:** §9.1 ganhou a coluna `#` com a numeração `0..16` fixa, e `u8` fora da faixa passou a ser `E_VALIDATION.permissions` em vez de ignorado. |
| **HOLE-07** ✅ | §7.2.1 diz que o tipo `id` é "string de 26 caracteres"; §7.3 define `entityId` como **prefixo + 26**. | Menor: o tipo do registry é `str` com prefixo de tamanho, então não é estrutural. | **Fechado em 2026-08-16:** §7.2.1 passou a descrever `id` como prefixo + 26 caracteres, alinhado a §7.3. |
| **HOLE-09** ✅ | O valor `u8` de `text` e `voice` em `channel.create`. §6.6 fecha o enum por nome, nunca por número. | Número em material assinado. | **Fechado em 2026-08-16:** §6.6 fixa `text = 0 · voice = 1` como constante de protocolo. |
| **HOLE-10** ✅ | Não há definição de valores para `RoleColor` / `avatarColor` / `iconColor`, e §8.6 não tem linha para eles. | O `fold` não tem como recusar cor inválida; a UI recebe `u8` arbitrário. | **Fechado em 2026-08-16:** §6.4.2, catálogo de cores numerado — `RoleColor` 0..6, `avatarColor`/`iconColor` 0..7, `accent` (7) não é cor de cargo. Fora da faixa é `E_VALIDATION`, **nunca clampado**. |
| **HOLE-11** ✅ | O estado `invalid` de comunidade, que R-27 e §8.4.1 exigem, **não tinha campo** no `DecisionState` de §8.1. | Sem ele R-27 não é implementável. | **Fechado em 2026-08-16:** `communityInvalid: boolean` entrou no schema de §8.1. |
| **HOLE-12** ✅ | O tipo `Effect` de §8.4 é **fechado** e não tem forma em lote. | `mod.ban` de quem tem N mensagens emite **N** `patch` (ocultação de §6.12/§18.2); `channel.delete` idem para `orphaned`. Num canal com 100 k mensagens isso é uma transação de 100 k efeitos. | **Fechado em 2026-08-16:** §8.4 ganhou `patchScope` e `ftsRemoveScope` sobre um escopo **fechado** de duas formas. Um ban de quem tem 100 k mensagens emite 2 efeitos no lugar de 200 k. |
| **HOLE-13** ✅ | §11.4 diz que o `DS` do host e o do projetor são **a mesma instância** e que o `DS` só avança no passo 8 (dentro da seção crítica) — **e** que "a projeção do host roda pelo mesmo caminho de todo mundo, a partir do log". As duas coisas juntas fariam cada registro ser interpretado duas vezes. | Sem resolução, o host aplica efeitos em dobro ou mantém estado duplicado (que §11.4 proíbe). | **Fechado em 2026-08-16:** §11.4 ganhou a tabela de quantas vezes cada registro é interpretado em cada caminho. O `fold` roda uma vez por `seq` por instalação. |
| **HOLE-14** ✅ | O `rank` do **cargo base** na gênese. §6.4.1 fixava só o do Fundador ("sempre o máximo"). | Com o default natural (novo cargo entra no fim), **todo membro comum passaria a superar todo moderador** na hierarquia de §9.3 — a moderação inteira pararia de funcionar. | **Fechado em 2026-08-16:** R-27(b) fixa `rank = RANK_BOTTOM` para o cargo base e `RANK_TOP` para o Fundador. |
| **HOLE-15** ✅ | §7.2.1 declara `rank` como "base62, **1–64 caracteres**"; §6.4.1 gera `rank` por `midpoint` **sem cota de comprimento**. | Medido: **a partir de ~383 inserções consecutivas no fundo, a chave passa de 64 caracteres** e sai do tipo declarado. A spec não diz o que acontece: recusar? recompactar? aceitar? | **Fechado em 2026-08-16:** §6.4.1 passou a exigir **renormalização determinística** do escopo em vez de recusar. Recusar deixaria a comunidade permanentemente incapaz de reordenar. |
| **HOLE-17** ✅ | Durante a gênese, `role.create`, `category.create` e `channel.create` estão marcados **`Aud. = sim`** em §7.4, e R-27 suspende só os estágios 8 e 11 — logo, pela letra, os `seq` 1, 2, 4 e 5 deveriam gerar entrada de auditoria. Mas §6.13 exige `byLabel` **congelado no momento da aplicação**, e nesses `seq` o autor **ainda não é membro** (o `member.join` dele é o `seq` 3): não existe rótulo para congelar. | O log de auditoria de toda comunidade nasceria com quatro entradas cujo `byLabel` é um fragmento de chave em hexadecimal. | **Fechado em 2026-08-16:** R-27(d) — a gênese **não** emite auditoria; a coluna `Aud.` de §7.4 não se aplica nos `seq` 0..5. |
| **HOLE-16** ✅ | `E_FOUNDER_IMMUTABLE` e `E_FOUNDER_TOP` estão no catálogo de §20.2 e são prometidos por §6.4.1, mas o cargo Fundador tem sempre o `rank` **máximo** — então o **estágio 12** (R-4: `rank ≥ topRank(autor)`) recusa antes de o estágio 14 chegar à regra do Fundador, **para todo autor, inclusive o próprio Fundador**. | Dois códigos do catálogo são **inalcançáveis**. O cliente recebe `E_HIERARCHY` onde a spec promete `E_FOUNDER_IMMUTABLE`, e a UI de §20.3 não tem como distinguir. | **Fechado em 2026-08-16:** §9.3 fixou a ordem dentro do estágio 12 — imunidade do alvo antes da comparação de `rank`. Os dois códigos saíram de inalcançáveis. |

---

## 4. Observações sobre o runtime e sobre limites já fixados

| # | Achado | Consequência |
|---|---|---|
| **OBS-01** | Em `hypercore@11.35.1`, `core.key` é o **hash do manifesto**, não `keyPair.publicKey`. §5.3 ("`communityId = hex(logKeyPair.publicKey)`") e §6.2 ("`coreKey` der = `id`") tratam os dois como a mesma coisa. Só com `compat: true` eles coincidem. | O harness usa `compat: true`. Ou a spec para de equiparar `communityId` à chave do core, ou o produto fica preso a um modo de compatibilidade legado do Hypercore. **É decisão de G0/G2, levantada aqui.** |
| **OBS-02** | §10.7 nomeia `await core.flush()` como barreira de durabilidade do append (`REQUIRES POC — G4`). **O método não existe** em `hypercore@11.35.1**.** `core.state.flush()` existe, mas é flush de transação de sessão e **lança** `TypeError` quando não há transação aberta. Medido: `await core.append(...)` sozinho sobrevive a `close()` + reabertura. | G4 precisa fixar qual é a barreira real. Sobreviver a um `close()` limpo **não** prova sobrevivência a `SIGKILL` (§28.3). |
| **OBS-03** | O snapshot de §10.6 precisa de forma **canônica**. Sem chaves ordenadas, uma entidade que ganha um campo opcional depois (`channel.update` setando `topic` num canal que nasceu sem) serializa numa ordem, e a mesma entidade reconstruída do snapshot serializa noutra. | Conteúdo idêntico, blob diferente. Qualquer verificação sobre o **blob** (hash de snapshot, checksum, comparação entre réplicas) daria falso positivo. §10.6 deveria exigir forma canônica. Corrigido no harness. |
| **OBS-04** ✅ | §8.6 limitava `Reaction.emoji` a **1 grafema / 24 bytes**. A família com ZWJ (`👨‍👩‍👧‍👦`) é 1 grafema e **25 bytes**. | Emoji ZWJ comuns eram **rejeitados**. **Fechado em 2026-08-16 junto com RISCO-01:** o campo passou a `1–8 code points / 32 bytes` e a família ZWJ entra. |
| **OBS-05** | §27.1/§26.2 declaram `ATTACHMENT_MAX_BYTES` = **8 GiB** e `ATTACHMENT_QUOTA_PER_MEMBER` = **5 GiB**, e R-14 roda no mesmo registro. | **O teto de 8 GiB é inalcançável.** O máximo efetivo é 5 GiB, e só para quem não tem nenhum outro anexo vivo. `E_ATTACHMENT_TOO_LARGE` nunca dispara antes de `E_QUOTA_EXCEEDED`. |
| **ACHADO-01** | Bug encontrado **pelo próprio fuzzer**, no decodificador deste harness: leitura fora de limite devolvia `Buffer.alloc(n)` com o `n` **pedido**. Um prefixo de tamanho hostil (`uint` = 2³²−1) fazia o `fold` alocar 4 GiB antes de concluir que a entrada é malformada. | Não viola a totalidade de §8.5 (o desfecho continua sendo `IGNORED`), mas é **negação de serviço trivial contra qualquer réplica**. Corrigido. Aponta direto para **HOLE-04**: a spec não tem estágio de teto de bytes antes do decode. |
| **RISCO-01** ✅ | §8.6 contava **grafemas**. Grafema é definido pelo ICU do runtime, e a spec **não fixava versão de ICU nem de Unicode**. §1.5 diz que a interpretação do log não pode depender do ambiente. | Duas réplicas em versões diferentes de ICU podiam discordar da contagem de grafemas de uma entrada exótica e **divergir de verdade** — era a única brecha estrutural encontrada na tese "mesma função em todo nó". **Fechado em 2026-08-16:** §8.6 passou a contar **code points** (`TEXT_COUNT_UNIT` em §27.1) e o `fold` **não chama `Intl.Segmenter`**. A alternativa — pinar `UNICODE_VERSION` com tabela UAX#29 embarcada — foi descartada: administra a classe de falha em vez de eliminá-la, e põe uma tabela versionada no caminho mais crítico do sistema. Contador grafêmico continua na UI, advisório por §8.7. |

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
