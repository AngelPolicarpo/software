# Sequenciamento pós-fase 0 — qual fase começa agora

**Este documento não é normativo** e não entra na lista de precedência de `backend-v2.md`
§0.2 nem do `CLAUDE.md`. Ele registra a leitura dos artefatos de gate feita em 2026-08-16,
a sequência escolhida e as decisões que ainda dependem de aprovação. Se divergir de
`backend-v2.md`, `adr-v2.md` ou `plano-de-validacao-experimental-v2.md`, o normativo vence.

---

## 1. O que os artefatos declaram, campo por campo

Não o que o `REPORT.md` resume nem o que o `CLAUDE.md` registra: o conteúdo do JSON.

| Gate | `veredito` | `alvo` no artefato | Evidência no segundo alvo | Arquivo |
|---|---|---|---|---|
| G0 | `APROVADO` (11/11) | `linux-x64` | **sim** — `out/gate-G0/windows/*.json`, 4 cenários, `platform: win32`, `arch: x64` | `poc/poc-03-runtime/out/gate-G0/gate-G0.json` |
| G10 | `APROVADO` (10/10) | `linux-x64` | **nenhuma** na leitura original — resolvido depois, ver §15 | `poc/poc-10-identity/out/gate-G10/gate-G10.json` |
| G1 | `confirmado` | Node 22 puro, `linux-x64` | não se aplica (o `fold` é puro, §4) | `poc/poc-01-fold/out/gate-G1/gate-G1.json` |

O que os quatro cenários de Windows de G0 cobrem, lido dos `steps`: `core.ready`,
`addonReport`, `openDbs`, `openCore`, `flushProbe`, `append.1000x256B`, `tx.256`, `tx.2048`,
`fts.index`, `ed25519.1000`, `ipc-r.roundtrip`, `crashHard` e a releitura do dado após
`SIGKILL`. É o caminho funcional inteiro mais as duas fronteiras de IPC. Ficaram só no
Linux: os 100 cold starts de `C2`, a disputa de diretório de `C7`, o addon dentro do `asar`
de `C8` e os três reinícios de `C6`.

## 2. O achado que muda a recomendação anterior

> **Estado em 2026-08-16, depois desta leitura:** o achado abaixo foi **resolvido** — G10
> passou a ter `win32-x64` APROVADO 10/10 e `matriz.json` com `completo: true` (§15). A
> seção fica como está porque é o que fundamentou a escolha de sequência de §3, e porque a
> corrida do Windows confirmou o risco que ela previa: 9 de 10 critérios reprovaram na
> primeira tentativa, por uma divergência de semântica de SO no lock de §10.8.

**G10 não tinha alvo Windows, e o próprio POC dizia isso.**

- `plano-de-validacao-experimental-v2.md:255` — Ambiente de POC-10: *"Windows e Linux — este
  último **com e sem** serviço de secret disponível."*
- `plano-de-validacao-experimental-v2.md:259` — Aprovação: *"100 % de recuperação nos
  **alvos** com secret store"*, no plural.
- `plano-de-validacao-experimental-v2.md:385` — regra composta: *"Um gate só passa quando
  **todos** os seus subcritérios (…) forem aprovados."*
- `poc/poc-10-identity/REPORT.md:103` — *"**O alvo Windows.** Este relatório cobre
  `linux-x64`. G10 exige Windows também."*

Some disso um segundo defeito, menor mas próprio de registro: o campo
`limitacaoDeEvidencia` do artefato de G10 traz apenas `G0-E1` (WSL2). A ausência do alvo
Windows **não está declarada no artefato**, só no `REPORT.md`. O artefato subdeclara a
própria limitação, e é o artefato que sustenta o veredito.

### Por que isso não é formalismo

O que G10 prova e G0 não prova é justamente a parte sensível a semântica de sistema
operacional: `D4`/`D5`/`D6` (lock composto de §10.8, lock órfão) e `D7` (`wipe` retomável de
§18.6). O achado 3.2 do próprio `poc-10-identity/REPORT.md` nasceu de uma colisão de handle
do RocksDB no Linux. No Windows, apagar diretório com handle aberto **falha** onde no Linux
sucede — o estágio `key-wiped` de §18.6 é exatamente esse padrão. É a classe de defeito com
maior chance de existir e menor chance de aparecer sem rodar.

Os quatro cenários de Windows de G0 não cobrem nada disso: `poc-03-runtime` não tem
identidade, `safeStorage`, `wipe`, `export`/`import` nem deep link. As duas POCs são
aplicações separadas, sem sobreposição nessa superfície.

## 3. Decisão de sequência: a fase 2 vem antes da fase 1

`backend-v2.md:4084-4088` e o diagrama de `plano-de-validacao-experimental-v2.md:370-379`:

```
G0 ─┬─ G10 ──▶ fase 1     (fundação de fronteira: IPC-R, IPC-M, identidade, deep link)
    └──▶ G1  ──▶ fase 2     (fold e log)
```

Os dois ramos estão formalmente abertos. Não são, porém, igualmente sustentados:

| | Fase 1 | Fase 2 |
|---|---|---|
| Gate de entrada | G0 **e** G10 | G1 |
| Cobertura do gate na matriz fechada | G0 nos dois alvos; **G10 em um só** | não se aplica — o `fold` é puro (§4) |
| Dependências de runtime | `safeStorage`, lock composto, `wipe`, deep link | `better-sqlite3`, `hypercore` — **provados nos dois alvos** por G0 |
| Buracos de spec abertos dentro do escopo | 1 (`--password-store`, §5.2 abaixo) | 0 |
| Sensibilidade ao layout ainda indefinido | alta: define main/renderer/núcleo, build e empacotamento | baixa: L1 não importa de ninguém (§4) |

A recomendação anterior — começar pela fase 1 porque ela estabelece a fundação de processo —
não está errada como princípio, e continua verdadeira sobre a arquitetura. Ela é derrotada
pelo estado da **evidência**: a fundação que a fase 1 escreveria é precisamente a metade que
G10 não exercitou no segundo alvo da matriz. Escrever lock composto e `wipe` agora é
escrevê-los contra evidência de um sistema operacional só, com a chance de reescrever quando
a evidência do outro chegar. `decision_criteria` #5 (menor retrabalho) e #4 (preservar o que
os POCs validaram) apontam na mesma direção.

A fase 2, em contrapartida, consome direto o desenho que G1 confirmou (`poc-01-fold`,
ADRs A01, A02, A04, A05, A07, A10, A11), roda **na ordem** de §6 pela primeira vez — G1
correu fora dela — e não toca nenhuma das quatro questões abertas.

## 4. Bloqueios reais da fase 1

Nenhum deles bloqueia a fase 2.

| # | Bloqueio | Fundamento | Quem resolve |
|---|---|---|---|
| ~~B1~~ | ~~G10 sem alvo Windows~~ — **resolvido**, ver §15 | `plano…v2.md:255,259,385`; `adr-v2.md:460` (*"G0 precisa passar em todos os alvos da matriz — hoje, os dois"*) | — |
| ~~B2~~ | ~~`--password-store` não está na spec~~ — **resolvido**: A13(5)+(6) e §3.2 emendados, ver §16(b) | `poc-10-identity/REPORT.md` §3.1.1 | — |
| B3 | Layout de repositório indefinido | §4 exige *"regra de lint com fronteira por diretório"* que *"quebra o build"*; nenhum normativo nomeia o diretório-raiz do núcleo | decisão do usuário |

**B3 vale para as duas fases**, mas com pesos diferentes: a fase 2 entrega `fold`, `opCodec`,
`permissions`, `idgen` e `errors`, que por §4 não importam de nenhuma camada acima. Movê-los
depois é `git mv`. A fase 1 entrega L3 e o esqueleto do processo, onde o layout é o próprio
trabalho.

### 4.1 Armadilha operacional ao fechar B1

`poc/poc-10-identity/scripts/run-all.ts:212,220` monta `alvo` a partir de `process.platform`
e grava sempre em `out/gate-G10/gate-G10.json`. Uma corrida `full` no Windows
**sobrescreveria o artefato de `linux-x64`** que hoje sustenta o veredito. `poc-03-runtime`
resolveu isso pondo o resultado de Windows em `out/gate-G0/windows/`; `poc-10-identity` não
tem esse desvio. Ele precisa existir antes da corrida, não depois.

## 5. Pendências que **não** bloqueiam nada agora

| # | Pendência | Por que não bloqueia |
|---|---|---|
| ~~P1~~ | ~~Barreira de durabilidade de §11: `core.flush` não existe em `hypercore@11.35.1` e `core.state.flush()` estoura por dentro~~ — **resolvido em 2026-08-17**: era pergunta de spec, e §10.7.1 a responde (o `append` **é** a barreira; `core.state.flush()` estoura porque o `append` já a chamou). Ver §19.2 | era entrada de **G4 / fase 3**, por `poc-03-runtime/REPORT.md:117-119`. O que sobra em G4 é medição, não indefinição |
| P2 | Patch de A16 sobre os addons de Windows | precisão documental; ver §6.2. Não impede código |
| P3 | 69 `.node` de plataformas fora da matriz no artefato | ajuste de `files` antes do release (`poc-03-runtime/REPORT.md:101-106`) |
| P4 | `communityId` é ou não a chave do core (OBS-01) | é decisão **da** fase 2, não anterior a ela (`poc-03-runtime/REPORT.md:121-124`) |
| P5 | `G0-E1` — alvo Linux validado em WSL2 | já registrada em A16 (`adr-v2.md:471-479`) e no artefato |
| P6 | Justificativa de `asarUnpack` não é funcional, é de integridade de código | motivo real medido, ainda não registrado na spec (`poc-03-runtime/REPORT.md:82-91`) |

## 6. Decisões que dependem de aprovação

### 6.1 Layout do primeiro código de produto (B3)

Nenhum documento normativo nomeia o diretório. `CLAUDE.md` diz apenas *"não presuma que o
núcleo vai morar em `backend/`"*. O que o contrato exige é só que a fronteira entre as
quatro camadas de §4 seja **verificável por diretório** e quebre o build quando violada.

### 6.2 Patch normativo de A16 — addons de Windows

`poc-03-runtime/REPORT.md:131-135` mede que os `.node` de `win32-x64` do artefato de G0 são
os prebuilds publicados no npm, não compilados por nós, por falta de toolchain MSVC. A16
diz *"rebuild por versão de Electron e por alvo é parte do contrato de build"*
(`adr-v2.md:446-447`). Essa parte do contrato **não tem evidência no alvo Windows**.

É a mesma classe de `G0-E1`, que já está escrita em A16 — e está escrita justamente porque
uma limitação de evidência não declarada vira, com o tempo, uma garantia falsa. O texto
proposto está em §7. **Não foi aplicado**: `adr-v2.md` é normativo.

## 7. Texto proposto para A16 (não aplicado)

Inserir como novo item da lista de decisão de `adr-v2.md` §A16, imediatamente após o item
`LIMITAÇÃO DE EVIDÊNCIA (G0-E1)`:

> - **LIMITAÇÃO DE EVIDÊNCIA (`G0-E2`) — os addons do alvo Windows não são compilados por
>   nós.** Medido em G0, 2026-08-16: o artefato `win32-x64` carrega os prebuilds
>   `better-sqlite3`, `sodium-native` e `udx-native` publicados no npm, porque não há
>   toolchain MSVC disponível. Eles são N-API e carregam — provado em quatro cenários no
>   Windows x64 nativo —, mas a cláusula "rebuild por versão de Electron e por alvo" acima
>   **não tem evidência neste alvo**. O que isso não prova: que um upgrade de versão de
>   Electron seja absorvido por rebuild próprio no Windows, e que a cadeia de build do
>   produto seja reprodutível nos dois alvos. Diferente do piso de glibc no Linux, aqui não
>   há piso a violar — o risco é de ABI no upgrade, não de compatibilidade de distribuição.

---

## 8. Sequência resultante

1. **Agora, sem depender de aprovação normativa:** decidir o layout (§6.1) e abrir a fase 2
   pelos módulos puros de L1 — `errors`, `idgen`, `opCodec`, `permissions`, `fold` —, na
   ordem de dependência de §4, com os testes de §28.1 e §28.4 desde o primeiro arquivo.
2. **Em paralelo, sem bloquear o item 1:** rodar o harness de `poc-10-identity` no Windows
   x64, depois do desvio de artefato de §4.1, e fechar B1.
3. **Quando B1 fechar:** decidir B2 (`--password-store`) e abrir a fase 1.
4. ~~**Antes da fase 3:** resolver P1, a barreira de durabilidade de §11.~~ **Resolvido em
   2026-08-17** por §10.7.1; a entrada atual da fase 3 é o contrato emendado de §20.5.

---

## 9. Contradição encontrada em §4, ao implementar a barreira de camadas

`backend-v2.md` §4 abre com a regra: *"Quatro camadas. Uma camada só importa das camadas
abaixo. Importação lateral só onde a tabela declarar. Violação **quebra o build** (regra de
lint com fronteira por diretório)."*

Duas linhas da própria tabela violam essa regra:

| Módulo | Camada | Coluna "Depende de" | Problema |
|---|---|---|---|
| `communityHost` | L2 | `fold`, `corestore`, **`rpcServer`** | `rpcServer` é **L3** |
| `outbox` | L2 | `manifest`, **`rpcClient`** | `rpcClient` é **L3** |

As duas arestas **sobem** de camada. Ou a regra de precedência admite exceção que a §4 não
escreve, ou as duas linhas querem dizer outra coisa — injeção da porta de transporte por
quem monta o grafo, o mais provável, já que §4 também diz que `rpcServer`/`rpcClient` *"não
podem conter regra de negócio"* e dependem de `L2`, o que fecharia um ciclo L2↔L3.

**Não foi resolvido por conta própria.** `core/scripts/check-layers.ts` registra as duas
arestas como contraditórias e recusa a importação com a contradição nomeada, em vez de
escolher uma leitura. Nenhuma linha de L2 existe ainda, então isso não bloqueia nada hoje;
vence quando a fase 3 abrir a `outbox`.

---

## 10. O que já foi executado

- `adr-v2.md` §A16 recebeu a limitação de evidência **`G0-E2`** (§7 acima), aprovada em
  2026-08-16.
- `core/` aberto como pacote do núcleo, Node puro, sem Electron — a decisão de §6.1. A
  fase 1 decide onde mora o shell; L1 não importa de ninguém acima, então mover depois é
  `git mv`.
- `core/scripts/check-layers.ts` implementa a fronteira por diretório que §4 exige. Verificado
  nos dois sentidos: `L0 → L1` é recusado, e a aresta contraditória de §9 também.
- `core/src/l1/errors/` — os 86 códigos de §20.2, gerados do normativo, com teste de
  paridade que relê a tabela a cada corrida. É o único módulo de L1 sem dependências (§4),
  e por isso o primeiro.

---

## 11. B2 — `--password-store`: o que foi medido e o patch recomendado

Nove configurações no artefato empacotado de POC-10, mesma máquina e mesmo `gnome-keyring`.
A tabela completa está em `poc/poc-10-identity/REPORT.md` §3.1.1. O que ela decide:

1. **`getSelectedStorageBackend()` reporta intenção, não capacidade.** Com
   `--password-store=kwallet5` numa máquina sem kwallet, ele devolve `kwallet5` e
   `isEncryptionAvailable()` devolve `false`. O nome do backend não é sinal de segurança.
2. **A autodetecção do Linux tem falso negativo.** Sem `XDG_CURRENT_DESKTOP` reconhecido —
   WSL2, headless, SSH, contêiner —, ela devolve `basic_text` numa máquina cujo chaveiro
   funciona. Só a flag muda, e `isEncryptionAvailable()` vai de `false` a `true`.
3. **Forçar não fabrica segurança.** Sem barramento de sessão, ou com o backend ausente,
   `isEncryptionAvailable()` continua `false`. É a assimetria que torna o probe seguro: ele
   só recupera store que existe.
4. **`appendSwitch('password-store', …)` só tem efeito antes de `app.whenReady()`.** Como
   `isEncryptionAvailable()` só responde depois do ready, tentar outro backend é
   **relançar o processo**, não reconfigurar em voo.

### Por que isso exige emenda, e não é só implementação

A13(5) identifica degradado por `basic_text`. O caso A da medição é uma máquina com chaveiro
funcionando que a spec, como escrita, classificaria como degradada — recusando o boot e
empurrando o usuário para a tela de aceite de modo inseguro **sem necessidade**. A regra
atual não é conservadora: ela produz o resultado errado, e o resultado errado é o que
normaliza aceitar modo inseguro. É defeito de segurança por redação, e por isso vai a patch
em vez de virar decisão de implementação.

### Patch proposto — `adr-v2.md` A13, item 5 (**não aplicado**)

> 5. **Degradado é `safeStorage.isEncryptionAvailable() === false` depois do probe de
>    backend — nunca o nome do backend.** Medido em G10 (2026-08-16):
>    `getSelectedStorageBackend()` devolve o backend **pedido**, não o obtido, e a
>    autodetecção do Linux devolve `basic_text` em máquina com chaveiro funcionando sempre
>    que não há ambiente de desktop reconhecível. Antes de concluir degradado, o app tenta
>    os candidatos explicitamente, na ordem `gnome-libsecret`, `kwallet6`, `kwallet5`, com
>    `app.commandLine.appendSwitch('password-store', …)`. Forçar **não** fabrica segurança:
>    com o serviço ausente, `isEncryptionAvailable()` permanece `false`. Esgotados os
>    candidatos, é degradado de verdade: o núcleo recusa abrir (`E_KEYSTORE_INSECURE`) até
>    um aceite dedicado, e a UI exibe indicador permanente.
> 6. **O probe é um relaunch, e tem ordem obrigatória.** O switch só vale antes de
>    `app.whenReady()`, então cada candidato custa um `app.relaunch()`. O probe roda **antes**
>    do lock composto de §10.8 — senão o processo relançado encontra o próprio lock e morre
>    com `E_CORE_ALREADY_RUNNING` — e **preserva `argv`**, senão o deep link de §3.5(4) se
>    perde no relaunch. O backend aprovado é persistido e reusado no boot seguinte, sem
>    repetir o probe; o custo medido é de ~350 ms por candidato ausente, uma única vez.

Emenda de acompanhamento em `backend-v2.md` §3.2, na LIMITAÇÃO DECLARADA (L-2), trocando
*"No Linux sem serviço de secret, o Electron cai para `basic_text`"* por *"No Linux, o
Electron cai para `basic_text` tanto sem serviço de secret quanto quando não reconhece o
ambiente de desktop; só o probe de A13(5) distingue os dois casos"*.

**Consequência de não aplicar:** a fase 1 implementa o boot de identidade contra uma regra
que recusa máquinas sãs, e o indicador permanente de modo inseguro aparece onde não deveria.

---

## 12. Pendências registradas por fase

| Fase | Pendência | Origem |
|---|---|---|
| ~~1~~ | ~~**B1** — G10 sem alvo Windows~~ — **RESOLVIDO em 2026-08-16**: `win32-x64` APROVADO 10/10, `matriz.json` com `completo: true`. Ver §15 | §4, §2 |
| ~~1~~ | ~~**B2** — patch de A13(5)/§3.2~~ — **APLICADO**, ver §16(b) | §11 |
| ~~3~~ | ~~**Contradição de §4**~~ — **RESOLVIDA** por inversão de dependência, ver §16(c). Não é mais pendência da fase 3 | §9 |
| ~~3~~ | ~~**P1** — barreira de durabilidade de §11 (`core.state.flush()`)~~ — **RESOLVIDO em 2026-08-17** como pergunta de spec: §10.7.1 nomeia a primitiva e mede o alcance dela. O que sobra é medição de G4, não indefinição. Ver §19.2 | §5 |
| pré-release | 69 `.node` fora da matriz no artefato; justificativa real de `asarUnpack` | §5 |
| ~~2~~ | ~~**`RANK_TOP`, `RANK_BOTTOM` e `RANK_GENESIS` sem valor declarado**~~ — **RESOLVIDO**: §27.1 e §6.4.1 emendados, ver §16(a) | §13 |
| ~~2~~ | ~~**H-21 a H-26** — os seis buracos do `projector`~~ — **RESOLVIDOS em 2026-08-17**: §8.0, §8.2, §8.4, §8.5, §10.3, §10.3.1 e §4 emendados, ver §19.1 | §18 |
| ~~2~~ | ~~**H-19, H-20, A-03 a A-06, O-07** — os sete buracos do `fold`~~ — **RESOLVIDOS em 2026-08-17**: §8.1, §8.4, §5.2, §6.4.1, §19.9, §4 e §27.1 emendados, ver §19.4. `A-03` era invariante violada, não ambiguidade | §17 |

Não sobra pendência de **spec** ativa: as duas de fase (`P1` e os seis buracos de §18) viraram
emenda em 2026-08-17. Sobram os dois ajustes de pré-release, e a medição de G4 — que é
trabalho de gate, não indefinição normativa.

---

## 13. Buraco encontrado na fase 2: três constantes de rank sem valor

R-27 (§8.3) prescreve comportamento com três constantes que **nenhuma seção define**:

| Constante | Onde aparece | O que a spec diz | O que falta |
|---|---|---|---|
| `RANK_GENESIS` | R-27(a), §19.1 | "sentinela estritamente maior que qualquer `rank` atribuível a um cargo"; nunca gravado | um valor, ou a regra de comparação |
| `RANK_TOP` | R-27(b) | o `rank` que o cargo Fundador recebe no `seq` 1 | o valor |
| `RANK_BOTTOM` | R-27(b) | o `rank` que o cargo base recebe no `seq` 2 | o valor |

§27.1 declara `RANK_MAX_LEN` (64) e nada mais sobre rank; §6.4.1 define o **tipo** (base62,
lexicográfico, nunca terminando em `0`) mas nenhum valor inicial.

Isso importa porque os três entram em **material assinado ou em decisão determinística do
`fold`**: duas réplicas que escolhessem valores diferentes para `RANK_TOP` produziriam
`DecisionState` divergente já no `seq` 1, e a comunidade se bifurcaria na gênese.

**O que foi feito e o que não foi.** `RANK_GENESIS` não precisa de valor para ser
implementado corretamente: `core/src/l1/permissions/` o representa **fora** do espaço de
strings base62, o que satisfaz "estritamente maior que qualquer rank atribuível" sem
escolher um literal — e como R-27 diz que ele nunca é gravado, nada o observa no fio.
`RANK_TOP` e `RANK_BOTTOM` **não têm essa saída**: são gravados como `rank` de cargo e
viajam. Eles bloqueiam a gênese dentro do `fold`, e não foram inventados.

### 13.1 Determinação: **não são deriváveis** do normativo existente

Quatro fundamentos independentes, cada um suficiente:

**(a) As restrições declaradas são de satisfatibilidade, não de unicidade.** Tudo que o
corpus exige é `RANK_BOTTOM < RANK_TOP`, ambos válidos por §7.2.1 (base62, 1–64 caracteres,
nunca terminando em `0`), com espaço para `midpoint` entre os dois. Os pares `('1','zz')`,
`('1','z')` e `('2','y')` satisfazem §6.4.1, §9.3, §19.9, R-4 e R-27(b) igualmente bem.
Nada no normativo escolhe um. Derivar aqui seria escolher.

**(b) §27.1 diz, por critério próprio, que eles deveriam estar lá — e não estão.** A regra
da seção é explícita: *"se um número decide se uma op tem efeito, ele está aqui"*.
`RANK_TOP` e `RANK_BOTTOM` decidem o `DecisionState` a partir do `seq` 1. A lista traz
`RANK_MAX_LEN` e mais 30 constantes; os dois não aparecem. É omissão pelo próprio critério
do documento, não silêncio proposital.

**(c) `midpoint` também não tem algoritmo, e esse buraco é maior.** §6.4.1 o nomeia e
enuncia propriedades — estritamente entre, determinístico, cresce em comprimento, ~383
inserções consecutivas no fundo estouram `RANK_MAX_LEN` — mas **não define a função**;
§19.9 a usa sem defini-la. Ela governa `role.create`, `role.move`, `channel.create` e
`category.create` por R-20, não só a gênese. Reconstruir o algoritmo a partir do número
"383" seria engenharia reversa de uma medição, não leitura de contrato.

**(d) Os valores são replicados e observáveis.** `rank` entra no `DecisionState` e em
`view.db`, e §6.4.1 manda `role.move` devolver `{rank}`. Duas réplicas com constantes ou
`midpoint` diferentes divergem no `seq` 1 e a comunidade bifurca na gênese. Não é detalhe
de implementação: é contrato de fio.

---

## 14. Proposta de resolução normativa — rank (aguardando aprovação)

### 14.1 O que a definição precisa satisfazer

| # | Requisito | Origem |
|---|---|---|
| N-1 | `RANK_BOTTOM < RANK_TOP` na ordem lexicográfica | §9.3, R-27(b) — o cargo base fica abaixo do Fundador |
| N-2 | Ambos válidos como `rank`: base62 `0-9A-Za-z`, 1–64 caracteres, não terminam em `0` | §7.2.1 |
| N-3 | Cabem **estritamente entre** os dois pelo menos `MAX_ROLES − 2` = 98 ranks distintos | §27.1 + R-4 + §6.4.1 (o Fundador é sempre o topo; todo cargo criado depois entra abaixo dele e acima do base) |
| N-4 | `RANK_GENESIS` é estritamente maior que **todo** rank atribuível e **nunca** é ele próprio atribuível | R-27(a) |
| N-5 | `midpoint(a,b)` é **total** — nunca lança, nem para entrada incoerente (`a ≥ b`, zero à direita) | §8.5 |
| N-6 | `midpoint` é função pura e idêntica em toda réplica, e a renormalização de §6.4.1 produz saída estritamente entre `RANK_BOTTOM` e `RANK_TOP` preservando a ordem, para até `MAX_CHANNELS` (500) itens | §6.4.1, §8.4 |

### 14.2 Recomendação: adotar o que G1 mediu

`poc/poc-01-fold/src/fold/rank.ts` já implementa exatamente isto, e o `CONFIRMADO` de G1
foi obtido **sobre essa álgebra de rank**, em 10⁷ entradas hostis. O próprio POC registrou
o buraco como `HOLE-14` e a escolha como `ASSUMPTION-14` — ou seja, a evidência de G1 é
**condicional a estes valores**:

| Constante | Valor | Por que satisfaz |
|---|---|---|
| `RANK_TOP` | `'zz'` | N-1, N-2; deixa `'2'`…`'zy'` livres entre o base e o topo, muito acima dos 98 de N-3 |
| `RANK_BOTTOM` | `'1'` | N-1, N-2; não é `'0'`, que violaria "nunca termina em `0`" |
| `RANK_GENESIS` | `'z'` × 65 | N-4 com elegância: 65 > `RANK_MAX_LEN` (64), então é lexicograficamente maior que qualquer rank válido **e** nunca pode ser um rank válido — não há como gravá-lo em cargo por acidente |

Mais o `midpoint` de base62 sobre a parte fracionária e a renormalização de dois dígitos
(`'11'`, `'21'`, …), ambos já escritos e exercitados naquele arquivo.

**Por que esta recomendação e não outra:** é a única escolha que **não custa uma nova
corrida de G1**. Qualquer outro par de valores, ou qualquer outro `midpoint`, deixa a
evidência de G1 sem valer para os caminhos de rank — e G1 é o gate que libera a fase 2.

### 14.3 Onde entra

- **§27.1** (constantes de protocolo): acrescentar `RANK_TOP` `'zz'` · `RANK_BOTTOM` `'1'` ·
  `RANK_GENESIS` `'z'×65` à lista, ao lado de `RANK_MAX_LEN`.
- **§6.4.1**: acrescentar a definição de `midpoint` — leitura das chaves como fração em
  base 62, prefixo comum preservado, dígito médio quando há folga, descida quando não há —
  e a forma da renormalização.

### 14.4 Impacto

| Sobre | Impacto de resolver | Impacto de **não** resolver |
|---|---|---|
| **Gênese** | R-27(b) fica implementável: `seq` 1 e 2 recebem os dois valores | **Bloqueio duro** — sem `RANK_TOP`/`RANK_BOTTOM` o `fold` não produz o `DecisionState` do `seq` 1, e **nenhuma comunidade pode ser criada** |
| **`fold`** | R-20 e a renormalização de §6.4.1 ficam implementáveis | `role.create`, `role.move`, `channel.create` e `category.create` ficam sem regra de `rank` — quatro `kind`s sem como decidir |
| **G1** | Adotando 14.2, a evidência transfere sem nova corrida | Escolher outros valores obriga a **reexecutar G1** nos caminhos de rank |
| **Fase 2** | Desbloqueia o miolo | O registry de §7.4 e os `kind`s que não tocam `rank` seguem; a gênese e a ordenação param |

---

## 15. B1 fechado — G10 aprovado nos dois alvos (2026-08-16)

`out/gate-G10/matriz.json` passou a `completo: true`:

| Alvo | Veredito | Artefato | Limitação declarada |
|---|---|---|---|
| `linux-x64` | APROVADO 10/10 | `gate-G10.json` | `G0-E1` — validado em WSL2 (A16) |
| `win32-x64` | APROVADO 10/10 | `windows/gate-G10.json` | `G0-E2` — addons são prebuilds do npm (A16) |

**O que a corrida do Windows achou, e vale para a fase 1.** A primeira tentativa reprovou 9
de 10 critérios com `EPERM: ftruncate` no boot — a etapa 2 do lock composto de §10.8 abria o
arquivo com `'a+'` e truncava em seguida, e **no Windows um descritor em modo append recusa
`ftruncate`**. É a classe de defeito que só aparece no segundo alvo: passa inteiro no Linux,
falha inteiro no Windows. `'w+'` não resolve — truncaria antes do `tryLock`, apagando o PID
do dono exatamente quando §10.8 precisa lê-lo para decidir se o lock é órfão. A forma
portátil é `O_RDWR|O_CREAT`. Detalhe em `poc-10-identity/REPORT.md` §3.1.2.

**Proveniência.** O artefato de `win32-x64` saiu do código já corrigido; o de `linux-x64` é
anterior ao fix. A equivalência das duas variantes no Linux foi **medida** fora do Electron —
arquivo novo, sobrescrita de conteúdo anterior, disputa de lock e legibilidade do dono com
lock ativo, todas idênticas byte a byte — em vez de assumida. Não houve nova corrida do alvo
Linux porque o `login.keyring` da máquina está trancado e o caminho **com** secret store
bloqueia num diálogo de senha; a medição do delta cobre o que a nova corrida provaria.

---

## 16. As três decisões aprovadas foram aplicadas (2026-08-16)

**(a) R-27 — rank.** `backend-v2.md` §27.1 passou a declarar `RANK_TOP` `'zz'`,
`RANK_BOTTOM` `'1'` e `RANK_GENESIS` `'z'`×65, e §6.4.1 ganhou a definição normativa de
`midpoint` e da renormalização. Os valores e o algoritmo são os de `poc-01-fold`, que é o
que torna a evidência de G1 transferível sem nova corrida. §13 e §14 ficam como registro do
porquê.

Verificado no código: `core/test/rank.test.ts` reproduz os vetores de G1, confirma que
`RANK_GENESIS` **não** é um `rank` válido (`isValidRank` o recusa por comprimento) e que o
crescimento no fundo estoura `RANK_MAX_LEN` em ~383 inserções — o número que §6.4.1 cita
como medido.

**(b) B2 — `--password-store`.** `adr-v2.md` A13 teve o item 5 reescrito e ganhou um item 6
(ordem do probe, relaunch, `argv`, persistência do backend). `backend-v2.md` §3.2 teve a
L-2 corrigida: `basic_text` no Linux é ambíguo entre "não há secret store" e "não reconheci
o desktop", e quem decide é `isEncryptionAvailable()`, não o nome do backend. §11 fica como
registro da medição que fundamentou a emenda.

**(c) §4 — a contradição L2 → L3.** Resolvida por **inversão de dependência**, e não por
remoção da relação: §4 ganhou a regra *"quando L2 precisa falar rede"* — o módulo de L2
declara a porta, L3 a implementa, a implementação é injetada no boot, e a direção é sempre
L3 → L2. As linhas de `communityHost` e `outbox` passaram a dizer "**porta** …, implementada
por `rpcServer`/`rpcClient`", com o import explicitamente proibido na coluna "Não pode".

Era a única leitura compatível com o resto de §4, que já faz `rpcServer`/`rpcClient`
dependerem de `L2` e proíbe regra de negócio neles — a aresta original fecharia um ciclo
L2↔L3. `core/scripts/check-layers.ts` deixou de tratar as duas arestas como contradição e
passou a recusá-las com a mensagem correta, porque o erro provável agora é confundir "usa o
transporte" com "importa o transporte". **Sai da lista de pendências da fase 3.**

---

## 17. Buracos de spec levantados ao implementar o `fold` (2026-08-16)

> **Estado: os sete viraram emenda em 2026-08-17.** As tabelas abaixo ficam como registro do
> que o código encontrou e de por que cada leitura foi a escolhida; a resolução normativa de
> cada uma está em §19.4. A de `A-03` mudou de natureza no caminho — não era ambiguidade de
> redação, era uma invariante de §6.4.1 que não valia.

Nenhum destes bloqueou a fase 2 — o `fold` está completo e passa nos 407 testes —, e nenhum
foi **decidido** aqui. Cada um é um ponto em que o normativo não fecha e o código teve de
seguir a única leitura disponível, sempre a mais conservadora. Estão registrados para virar
emenda ou permanecerem como observação, e o critério de precedência é o de sempre: o
documento normativo vence o código.

### 17.1 Bloqueantes se não resolvidos — mas não para a fase 2

| # | Buraco | Onde dói | O que o código faz hoje |
|---|---|---|---|
| **H-19** | **`DecisionState.community` não tem `originFinalSeq`.** R-18(a) manda toda réplica verificar `proof` sobre `BLAKE2b('assume/1' ‖ newCommunityId ‖ originFinalSeq)`, e §5.2 confirma o material. O valor entra no `opt<u64> originFinalSeq` da gênese (§7.4.5), mas o schema de §8.1 só declara `originCommunityId`. | **R-18 não é implementável** sem o campo: não há de onde tirar `originFinalSeq` na hora de `community.assumeHost`. | Campo acrescentado a `CommunityMeta`, gravado no `seq` 0. É derivado do log e tem **uma única origem possível**, então não há segunda leitura — é o mesmo formato de `HOLE-11` (`communityInvalid`), que foi fechado assim. Precisa entrar em §8.1. |
| **H-20** | **§8.4 não tem a forma inversa de `ftsRemoveScope`.** `mod.ban` tira as mensagens do alvo da FTS por escopo; `mod.revokeBan` "reexibe" (§18.1, §18.2) mas não tem como devolvê-las ao índice — reindexar exige o `content`, que o `fold` não guarda (§8.1 só tem metadado de decisão). | Depois de um ban revogado, as mensagens voltam às **listagens** e ficam fora da **busca**, para sempre. A UX de §18.2 promete reversibilidade sem ressalva. | `patchScope {hidden_by_ban: 0}` e nada de FTS. Acrescentar uma quarta forma a `Effect` é "mudança de contrato, com bump de `view_schema_version`" pelo próprio §8.4 — **não é decisão de implementação**. |

### 17.2 Ambiguidades — o código seguiu a leitura conservadora

| # | Ponto | As duas leituras | O que ficou |
|---|---|---|---|
| **A-03** | **§19.9, posição do cargo novo.** *"Criar: `rank` = `midpoint(rank do cargo imediatamente abaixo do topo do autor, próximo abaixo)`"*. §6.4.1 define `midpoint(a, b)` com `a < b`; os dois argumentos de §19.9 estão na ordem inversa (o primeiro é **maior** que o segundo). | (i) literal — argumentos incoerentes, e §6.4.1 manda tratar `a ≥ b` como "entra no fim"; (ii) por intenção — o cargo novo nasce logo abaixo do topo do autor. | (i). É o que `poc-01-fold` faz e o que G1 validou. **Consequência visível:** um cargo criado sem dica nasce **abaixo do cargo base**, então quem o recebe continua com `topRank` = base, e a hierarquia de §9.3 não muda. Quem quer um moderador acima dos membros precisa mandar `afterRank`. Se a intenção era (ii), §19.9 precisa ser reescrita — e a mudança afeta `role.create`, `channel.create` e `category.create`. |
| **A-04** | **§8.1, `threadsByRoot: Map<Id, Id>`.** O nome diz "indexado por raiz"; R-8 precisa resolver `threadId → canal` em O(1) e R-24 precisa de `raiz → existe?`. | (i) `raiz → thread` (o nome) — R-24 fica O(1), R-8 vira varredura; (ii) `thread → raiz` — os dois ficam O(1), porque R-24 passa a usar o `threadId` que §8.1 **já declara** em `MessageMeta`. | (ii), que é a leitura de `poc-01-fold`. É a única em que **toda** regra de §8.3 é implementável com o schema declarado e nada mais. O nome do campo em §8.1 contradiz o uso e deveria ser corrigido. |
| **A-05** | **R-19, prova de posse do relay.** *"`possession` verifica sobre `relayPublicKey` com a chave de identidade do autor"*. §5.2 é "tabela fechada e autoritativa" e **não tem prefixo de domínio** para esta prova. | (i) assinar os 32 bytes crus (literal); (ii) inventar um prefixo `'relay-possession/1'`. | (i). Inventar prefixo é mudar material assinado, que é exatamente o que §5.2 existe para impedir. **É a única assinatura do sistema sem separação de domínio** — §5.2 deveria ganhar a linha, e aí (i) deixa de valer. |
| **A-06** | **`verify` de Ed25519 não tem casa em L1.** §4 dá "verificação" a `identity`, que é **L0**, e dá ao `fold` exatamente quatro dependências: `opCodec`, `permissions`, `idgen`, `errors`. Os estágios 1 e 4 de §8.2 exigem verificar assinatura. | (i) `opCodec` expõe `verifySignature`; (ii) acrescentar `identity` às dependências do `fold` em §4. | (i). `opCodec` já constrói o material assinável de §7.1 (`opSigningHash`, `hostRecordSigningHash`), tem `Depende de` vazio e a única proibição de "validar semântica" — conferir uma curva sobre bytes dados não é semântica. (ii) faria L1 depender de L0 numa aresta que §4 não declara. |

### 17.3 Observações — corretas, mas dizem menos do que parecem

| # | Achado |
|---|---|
| **O-06** | **Os três tetos de bytes de §8.6 são inalcançáveis.** Um code point ocupa no máximo 4 bytes em UTF-8, então: `Message.content` 4000 cp ⇒ ≤ 16 000 B < 16 384 B; `Reaction.emoji` e `Community.iconEmoji` 8 cp ⇒ ≤ 32 B = 32 B. Nenhum dos três chega a disparar — o teto de code points sempre vence. Não é bug (o tamanho real do registro é limitado pelo estágio 13, 32 KiB sem anexo), mas §8.6 os apresenta como restrição ativa. Mesma família de `OBS-05` de G1, onde `ATTACHMENT_MAX_BYTES` (8 GiB) é inalcançável porque `ATTACHMENT_QUOTA_PER_MEMBER` (5 GiB) vence antes. Coberto por teste em `core/test/fold-limits.test.ts`. |
| **O-07** | **§27.1 manda as constantes de protocolo morarem em `protocol/constants.ts`, e §4 não tem módulo `protocol`.** A fronteira de camadas é por diretório de módulo da tabela de §4, então um `src/protocol/` seria violação. Cada constante ficou no módulo de §4 que a **aplica** — `RANK_*` em `permissions`, o resto em `fold` — e nenhuma é transcrita duas vezes. Se §27.1 quiser o módulo próprio, §4 precisa ganhar a linha. |

### 17.4 Bug encontrado pelo próprio teste, e corrigido

**R-15 contava só os registros `APPLIED`.** A primeira versão do pipeline avançava a janela
de cota depois de `applyKind` ter sucesso. R-15 é explícito no contrário: *"Entram em `J` os
registros do autor que **alcançaram o estágio 10**, `APPLIED` ou não — recusar num estágio
posterior **não** devolve a cota"*. Sem isso um autor inunda o log com ops que falham tarde e
não paga nada, que é precisamente o ataque que a regra fecha. Corrigido: o bookkeeping de
`REJECTED` também consome a janela quando o registro atravessou o estágio 10. Coberto por
`fold-pipeline.test.ts` ("recusar num estágio posterior **não** devolve a cota").

---

## 18. Buracos de spec levantados ao implementar o `projector` (2026-08-17)

A fase 2 fechou com o `projector` (§10.5), a reprojeção total, o snapshot de `DecisionState`
(§10.6) e a determinismo de §28.4 em CI. Como no §17, nenhum buraco abaixo foi **decidido**
aqui: cada um é um ponto em que o normativo não fecha e o código seguiu a única leitura
disponível, sempre a mais conservadora. Critério de precedência de sempre: o documento
normativo vence o código.

> **Estado: os seis viraram emenda em 2026-08-17.** As tabelas abaixo ficam como o registro do
> que o código encontrou e de por que cada leitura foi a escolhida — a resolução normativa de
> cada uma está em §19.1, e a partir dela o normativo voltou a vencer o código.

### 18.1 Onde o schema de §10.3 não declara o que o comportamento exige

| # | Buraco | O que o código faz hoje |
|---|---|---|
| **H-21** | **`rejected_records.kind` e `.author_key` não têm fonte.** §10.3 declara as colunas; §8.2 liga a tabela ao desfecho `REJECTED` ("só métrica e, quando aplicável, `rejected_records`"). Mas o `FoldResult` de §8.0 carrega só `decision`/`reason`/`effects`/`next` — sem `kind` nem `author` —, o projector (§4) não pode importar `opCodec` para decodificar o registro, e um registro recusado nos estágios 0–1 **não tem** `kind` nem autor decodificados. O "quando aplicável" de §8.2 não define quando. | As duas colunas ficam `NULL` (o schema as declara anuláveis); `seq` e `reason` saem sempre. Se a intenção for gravar `kind`/autor quando o registro decodifica, §8.0 precisa ganhar os dois campos — a família de `field`/`limit`/`hostTsClamped`, que já são extensões normativamente derivadas da assinatura. |
| **H-22** | **`ds_snapshot.fold_build_id` não está na tabela de §10.3.** §10.6 é explícito — "O snapshot carrega o **hash do binário do `fold`** (`foldBuildId`)" —, mas a linha de `ds_snapshot` declara só `community_id`, `interpreted_seq`, `blob`, `taken_at`. Sem a coluna o requisito de descarte é inexpressável. | Coluna `fold_build_id TEXT NOT NULL` acrescentada ao DDL. Mesma família de `HOLE-11` e `H-19`: comportamento obrigatório, representação única possível. |
| **H-23** | **§10.3 declara só duas chaves de `meta` — o boot precisa de mais duas.** `view_schema_version` e `op_version` são as declaradas. Mas §8.5/§10.5 exigem que um `fold.panic` fique **registrado no boot anterior** (marcador persistente), e §10.3 exige detectar snapshot "ausente ou inconsistente" — o que, depois de um crash entre a cadência de snapshots, só é detectável com o `interpretedSeq` do último lote **commitado** gravado junto com os efeitos. | Chaves `fold_panic:<communityId>` e `interpreted_seq:<communityId>` em `meta` (o esquema é key/value; as chaves são por comunidade porque um `view.db` serve todas). Se a emenda preferir outro lugar para os dois marcadores, o teste de paridade de §10.3 aponta. |
| **H-24** | **`meta.op_version` não tem escritor possível.** O projector é o **único** escritor de `view.db` (§21.1), e §4 dá a ele `fold`, `view` e `corestore` — `OP_VERSION` mora em `opCodec`, que não está na lista. `view` (L0) não pode importar `opCodec` (L1): a barreira quebra o build. | A chave fica sem escrever. Ou §4 ganha `opCodec` na linha do projector, ou `fold` reexporta a constante, ou a chave é escrita por quem compõe o boot (violaria §21.1 como escrito). |

### 18.2 Fórmulas que o normativo nomeia e não define

| # | Buraco | O que o código faz hoje |
|---|---|---|
| **H-25** | **As três contagens de `recount` não têm fórmula.** §10.5 passo 4 manda "recalcula os `recount`"; §8.4 define o `what` (`memberCount`, `roleMemberCount`, `threadReplyCount`) e §10.3 declara as colunas derivadas — mas nenhum texto define a população de cada contagem. Determinismo não exige fórmula específica (qualquer uma fixa converge), mas a semântica é de UI. | Leitura conservadora, documentada em `projector/apply.ts`: `memberCount` = membros com `left_at IS NULL AND banned=0`; `roleMemberCount` = iguais, por cargo; `threadReplyCount` = respostas com `deleted_at IS NULL AND orphaned=0` (o ban escondido é transitório, §18.2, e continua contando). É o mesmo desenho do projetor de `poc-01-fold` para as duas primeiras; a terceira é nova. |
| **H-26** | **`fold.panic{seq, kind}` — o projector não tem o `kind`.** §8.5 manda registrar a métrica com `seq` **e** `kind`, mas o `FoldResult` não carrega `kind`, um fold que lança pode nem ter decodificado o registro, e o projector não pode decodificar (§4). | O gancho `onPanic(seq)` leva só o `seq`; `kind` fica para a emenda de §8.0 que resolver H-21. |

### 18.3 Observações — corretas, mas dizem menos do que parecem

| # | Achado |
|---|---|
| **O-08** | **A FTS5 contentless-delete de §10.3 não aceita `DELETE FROM` e corrompe em remoção repetida.** O comando especial `'delete'` é o único caminho, e remover um `rowid` já removido produz `SQLITE_CORRUPT_VTAB` — o que aconteceria no primeiro `mod.ban` repetido, porque `ftsRemoveScope` alcança mensagens que já passaram por `ftsRemove`. A forma segura é o `'delete'` com guarda de pertença (`rowid IN (SELECT rowid FROM messages_fts)`), idempotente, em **um** comando por escopo — coerente com "o projector traduz cada forma em um `UPDATE ... WHERE`". É desenho de implementação, não buraco de spec; está registrado porque um `DELETE FROM` ingênuo quebra exatamente no cenário de §18.2. |
| **O-09** | **A linha de `communities` em §10.3 escreve "`id TEXT PK`" — PK de uma coluna —, e §10.1 manda `community_id` estar "em **toda** chave primária".** As duas não podem valer juntas. A regra estrutural de §10.1 venceu: `PRIMARY KEY (community_id, id)`, como em toda tabela. O teste de paridade relê §10.1 e confere que **toda** PK de `view.db` inclui `community_id`. |
| **O-10** | **O "byte a byte" de §10.3 é literal, com uma ressalva de relógio.** Com o `now` injetado fixo, dois diretórios limpos projetando o mesmo log produzem o **mesmo arquivo** `view.db` — testado com SHA-256 do arquivo fechado, além do hash de dump de §28.4. O único byte não derivado é o `taken_at` do `ds_snapshot` (§10.6), carimbo de relógio de parede de um **cache**; sem relógio fixo, a divergência entre duas reprojeções fica restrita a esses bytes e o dump ordenado é idêntico do mesmo jeito. |
| **O-11** | **O step 4/5 de §10.5 e os steps 1/4/5 da reprojeção tocam `manifest.db` — e §4 não dá `manifest` ao projector.** `local_read_state` (incremental por lote, com a barreira de dois bancos) e a enumeração de `manifest.communities` para a reprojeção são do algoritmo, mas a coluna "Depende de" do projector é `fold`, `view`, `corestore`. O módulo implementa a parte que o contrato lhe dá e declara a fronteira; a metade de `manifest` é da fase 3 (quem compõe o boot), que é a única leitura compatível com §4 exaustivo. Não é bloqueio: é o mesmo formato da porta de transporte de §4, mas para baixo. |

### 18.4 Barreira de durabilidade — resposta à pergunta da fase 2

**P1 não cruza o projector.** A barreira de §11 ("`await core.append(...)` **e** `await
core.flush()` antes de responder") é da submissão do **host** (§11.4), `communityHost`/`outbox`
— L2, fase 3, entrada de G4. O projector só **lê** o core (`get`/`length`/evento `append`) e
escreve `view.db`, cuja barreira de durabilidade é a transação SQLite por lote (`synchronous
= NORMAL`, §10.4) — nativa, sem `flush`. O caminho de admissão que compartilha o `DS` com o
projetor (§11.4) continua sendo responsabilidade do host na fase 3; ele não muda o que o
projector faz com os efeitos. Confirmação em `poc-03-runtime/REPORT.md`: o buraco é
"entrada obrigatória para quem escrever a outbox" — não para o leitor.

---

## 19. Os buracos de §18 e o P1 viraram emenda (2026-08-17)

Diferente de §17 e §18, **aqui houve decisão**. Cada item abaixo saiu de "o código seguiu a
única leitura disponível" para "o normativo diz, e o código transcreve" — a precedência voltou
ao lugar. Os testes de paridade releem o normativo em tempo de execução, então uma emenda
revertida no documento quebra a suíte antes de quebrar o produto.

### 19.1 As seis emendas

| # | O que o normativo passou a dizer | Onde |
|---|---|---|
| **H-21** | `FoldResult` declara `kind` e `author`, preenchidos **a partir do decode do `Op`** (estágio 2) e ausentes antes dele. O "quando aplicável" de §8.2 passou a significar exatamente isto: `rejected_records.kind`/`.author_key` são `NULL` **só** na recusa do estágio 0, o único desfecho sem decode. `field`, `limit` e `hostTsClamped` — que o código já devolvia por derivação — entraram na assinatura junto, pela mesma razão | `backend-v2.md` §8.0, §8.2, §10.3 |
| **H-22** | `ds_snapshot.fold_build_id TEXT NOT NULL` entra na tabela de §10.3. `NOT NULL` porque snapshot sem procedência **é** snapshot inválido: §10.6 manda descartar o que não bate, e não dá para comparar o que não existe | §10.3, §10.6 |
| **H-23** | §10.3.1, nova, é a lista **fechada** das quatro chaves de `meta`: `view_schema_version`, `op_version`, `fold_panic:<communityId>` e `interpreted_seq:<communityId>`. As duas por comunidade carregam o id no nome porque um `view.db` serve todas (§10.1). §10.6 ganhou de quebra a definição de "snapshot inconsistente", que era prosa: `ds_snapshot.interpreted_seq` ≠ o marcador do último lote commitado | §10.3.1, §10.5, §10.6 |
| **H-24** | `opCodec` entra na coluna "Depende de" do `projector` em §4 — a importação lateral que a própria seção prevê. Só a constante `OP_VERSION`; a coluna "Não pode" ganhou **decodificar registro**, que é o que mantém `kind`/`author` vindo do `FoldResult` e não de um decode do projector. A alternativa (reexportar pelo `fold`) esconderia a aresta em vez de declará-la | §4, §10.3.1 |
| **H-25** | §8.4 define a **população** das três contagens, com a tabela e as duas consequências que ela decide de propósito: `hidden_by_ban` **não** subtrai (a ocultação por ban é reversível, §18.2, e o contador não pode oscilar com ela), `left_at`/`banned` subtraem (quem saiu não aparece na tela que o número legenda) | §8.4, §10.5 |
| **H-26** | O `kind` de `fold.panic{seq, kind}` é o `kind` do `FoldResult`: presente quando a exceção veio **depois** do decode, ausente quando veio antes. Ausente não degrada a métrica — `seq` localiza o registro, o `kind` aponta o handler | §8.5 |

Das quatro observações, duas eram contradição de verdade e viraram texto; duas continuam
sendo o que já eram:

- **O-08** subiu para §10.3: a remoção em FTS5 contentless-delete é normativamente
  **idempotente** (comando `'delete'` com guarda de pertença). Não é preciosismo de
  implementação — a forma ingênua passa no teste feliz e corrompe o índice do usuário no
  segundo `mod.ban`.
- **O-09** foi corrigida na origem: a linha de `communities` em §10.3 dizia `id TEXT PK`,
  contra a regra de §10.1 ("`community_id` em **toda** chave primária"). Agora diz
  **PK `(community_id, id)`**, como todas as outras.
- **O-10** (o "byte a byte" com relógio fixado) e **O-11** (a metade de `manifest` é da fase 3)
  continuam observações. Nenhuma das duas pede emenda: a primeira descreve o que o teste já
  mede, a segunda é a leitura correta de §4.

**No código:** `FoldResult` ganhou `kind`/`author` por um probe preenchido no estágio 2, que
`foldRecord` copia para o resultado **inclusive no caminho de pânico** — é a única forma de o
`kind` de §8.5 existir. O `projector` grava as duas colunas, chama `onPanic(seq, kind)` e
escreve `meta.op_version`. `check-layers.ts` transcreveu a nova linha de §4. Dez testes novos,
443 no total, todos passando; três deles releem o normativo (as colunas de `ds_snapshot`, as
chaves de `meta` e a população dos `recount`).

### 19.2 P1 — a barreira de durabilidade tem primitiva, e ela é uma só

§10.7 mandava `await core.append(...)` **e** `await core.flush()`. A segunda metade não existe,
e o motivo é mais interessante do que "a API mudou de nome":

- `core.flush` não existe na sessão de Hypercore 11.35.1. O que existe é
  `core.state.flush()`, do `SessionState`, e ele **não é** barreira de durabilidade: commita a
  transação de escrita ativa. Chamá-lo depois de um append lança `TypeError` — porque
  `append()` já o chamou, e `_activeTx` voltou a `null`. O "estoura por dentro" registrado em
  §5 era isto.
- `append()` monta a transação, escreve blocos, árvore, bitfield e cabeça, e **só resolve
  depois** de o lote ir ao RocksDB. Quando o `await` volta, o commit aconteceu.

**Medido** (Node 22, WSL2/ext4, `hypercore@11.35.1`): um processo que appenda *N* registros e
se mata com `SIGKILL` imediatamente depois de o último `await` resolver — sem `close`, sem
checkpoint — deixa os *N* legíveis na reabertura. *N* = 1, 50 e 500, 100 % nas três.

O que isso **não** prova, e continua sendo de G4: `fsync`. `rocksdb-native` não expõe
`WriteOptions` no caminho de escrita e o padrão do RocksDB é `sync = false`, então o WAL fica
no cache de página — que um `SIGKILL` não perde e um corte de energia perde. §10.7.1 registra o
piso conservador: a barreira garante durabilidade contra **falha de processo**, não contra
falha de energia, e nenhuma superfície pode prometer mais (§24.1). O eixo otimista de §11.1
continua correto exatamente por isso: a garantia forte é a outbox em `manifest.db` com
`synchronous=FULL`, não o log.

Emendas: §10.7 (a linha), §10.7.1 (nova), §3.3 (`draining` fecha o core, não "flusha"), §11.5 e
§19.1 do normativo (group commit e gênese: uma chamada, não duas), `adr-v2.md` A06(1), e o
POC-07 do plano ganhou a linha "Entrada já fechada" — inclusive o registro de que o ponto de
kill "entre append e flush" **não existe**, porque é o mesmo instante.

### 19.3 O que ainda falta para a fase 2 estar concluída

> **Resolvido em 2026-08-17.** POC-07 foi construído (`poc/poc-07-outbox/`) e G4 saiu
> `CONFIRMADO` nos oito critérios. A fase 2 está **concluída**. O que o gate encontrou no
> caminho está em §20. Após a resolução normativa de §20.5, a fase 3 está liberada para
> implementação, mas o rerun multicanal de `opVersion = 2` ainda é necessário para concluí-la.

**G4.** Era o gate que fechava a fase 2 no diagrama de §6, e ele não tinha artefato. §19.2
fechou a *pergunta de spec* que era entrada dele; o gate em si exigia POC-07: a matriz de kill
de §28.3 inteira, contra o caminho de escrita **completo** — outbox (§11.2), seção crítica do
host (§11.4) e group commit (§11.5). Nada disso existia: é código de L2, fase 3. A ordem do
diagrama (`fase 2 → G4 → fase 3`) e o conteúdo de G4 (que precisa de código de fase 3) só
fechavam de um jeito, e foi o adotado: **o harness de POC-07 é descartável**, como os três de
fase 0, e mede o desenho — não o produto.

**Os buracos de §17 fecharam junto** — ver §19.4. Não sobra buraco de spec aberto em nenhuma
das duas listas; o que falta para a fase 2 é G4, e G4 é medição.

### 19.4 Os sete buracos de §17 também viraram emenda (2026-08-17)

| # | O que o normativo passou a dizer | Onde |
|---|---|---|
| **H-19** | `DecisionState.community` declara `originFinalSeq?: number`, o material que R-18(a) verifica. Vem do `opt<u64>` da gênese (§7.4.5) — derivado do log, origem única, mesmo formato de `HOLE-11` | §8.1 |
| **H-20** | §8.4 ganha **`ftsIndexScope`**, a forma inversa de `ftsRemoveScope`, e com ela `ftsRemoveScope` entra na union — a forma que o `fold` emitia sem o normativo declarar. Nenhuma das duas carrega texto: o `fold` não tem o `content`, e o projector reindexa a partir do `messages.content` que ele mesmo materializou, com o predicado que é o **complemento exato** das três remoções. Custou `view_schema_version` 1 → 2, como o próprio §8.4 exige | §8.4, §10.3 |
| **A-03** | §19.9 reescrita, e §6.4.1 ganha a regra que faltava — ver a nota abaixo, porque não era ambiguidade | §19.9, §6.4.1 |
| **A-04** | `threadsByRoot` vira **`rootOfThread`**, `threadId → raiz`. O nome antigo dizia o inverso do que o schema sustenta: R-8 precisa de `threadId → canal` em O(1), e R-24 já é O(1) pelo `threadId` da própria `MessageMeta` | §8.1 |
| **A-05** | §5.2 ganha `'relay-possession/1'`, e R-19 passa a verificar sobre `BLAKE2b('relay-possession/1' ‖ relayPublicKey)`. Era a **única** assinatura do sistema sobre bytes crus, e §5.2 existe exatamente para que nenhuma seja | §5.2, R-19 |
| **A-06** | §4 diz que `opCodec` faz verificação de assinatura sobre o material que ele mesmo constrói. A alternativa — dar `identity` ao `fold` — criaria uma aresta L1 → L0 não declarada | §4 |
| **O-07** | §27.1 deixa de mandar um módulo `protocol/constants.ts`, que §4 não tem: cada constante fica no módulo que a **aplica**. Um `src/protocol/` seria violação de build, e um módulo só de constantes não teria camada | §27.1 |

**A-03 não era ambiguidade — era invariante violada, e ela mordia.** §6.4.1 afirma que "todo
`rank` gerado por `midpoint` ou por renormalização fica **estritamente entre** `RANK_BOTTOM` e
`RANK_TOP`, o que é o que mantém o cargo base no fundo e o Fundador no topo sem regra
adicional". Medido: a frase é falsa a partir do **sexto** item criado sem dica de posição, e
para **cargos** já no primeiro, porque o cargo base ocupa `RANK_BOTTOM` desde a gênese
(R-27b).

A consequência não é cosmética. Por R-3 todo membro carrega o cargo base; um cargo que nasce
**abaixo** dele não altera o `topRank` de ninguém, e por R-4 quem o recebe não modera nem um
membro comum. Criar "Moderador" com `ban_members` pelo caminho default — que é o caminho que
a UI usa quando não manda `afterRank` — produzia um cargo que não bane ninguém.

A emenda torna a invariante verdadeira **por construção**: onde o vizinho não existe, o limite
é `RANK_BOTTOM` embaixo e `RANK_TOP` em cima, e `midpoint` nunca recebe `null` vindo de um
escopo real. §19.9 passa a dizer que o item entra no fim do escopo *acima do piso*, que para
cargos é a posição mais baixa **útil**. A gênese não se move: `midpoint(RANK_BOTTOM, RANK_TOP)`
é literalmente `midpoint('1','zz')`, o vetor `'V'` que G1 fixou.

A invariante só era verificada para `renormalize`, o caminho que não tinha o defeito. Agora
`rankBetween` tem bloco próprio de teste — criação sucessiva, escopo de gênese, pedido
incoerente e dica válida.

**No código:** `ftsIndexScope` em `Effect` e no projector, com guarda de pertença invertida
(sem ela, escopo reindexado duas vezes duplica linha na FTS); `rankBetween` com os dois
sentinelas; `relayPossessionSigningHash` em `opCodec`; `rootOfThread` renomeado em `fold` e no
snapshot; `VIEW_SCHEMA_VERSION` em `2`. 450 testes passando.

---

## 20. POC-07 / G4 — o que o harness mediu, e os quatro achados (2026-08-17)

O harness está em `poc/poc-07-outbox/`, descartável como os três da fase 0, e o artefato em
`out/gate-G4/`. A leitura consolidada é o `REPORT.md` dele; aqui ficam só os achados que
**tocam o normativo**, porque os quatro precisam de resolução antes de a fase 3 ser escrita.

### 20.1 `ACHADO-01` — o ramo 1 de §11.6 perde dados, e §7.5 já tem a regra certa

§11.6 manda remover o item quando `lastAuthorSeq[eu] >= item.author_seq`. A inferência é
**insegura**: marca d'água alta prova que *algum* `authorSeq` ≥ aquele entrou, não que **este**
entrou. E o log tem buracos por desenho — §7.5 diz, na própria tabela: *"O cliente pode ter
buracos em `authorSeq`? **Sim.** A regra é estritamente crescente, não densa."*

**Medido:** com o host morrendo no meio de uma rajada, o log ficou com os `authorSeq`
`1..7, 13, 14, 15, 20, 21, 24, …, 40`; a marca d'água em 40 removeu **as 40** linhas da fila
com **21** registros no log. Dezenove operações perdidas **e reportadas como entregues** —
exatamente o que §11.3 promete ser impossível.

A correção já está no normativo, em outra seção. §7.5: *"Como o cliente sabe que a op entrou?
Procurando o **`opId`** na própria réplica projetada (§11.6). Não pela palavra do host."*
**§7.5 está certa; o pseudocódigo de §11.6 transcreveu a regra errado.** A marca d'água
continua útil como negativa barata (`<` prova ausência), e é assim que o harness a usa.

### 20.2 `ACHADO-02` — `authorSeq` por autor × ordem por canal: ops que nunca mais entram

**É decisão de arquitetura, e é a mais séria.** §7.5 numera por **autor**; §11.7 ordena por
**canal** e diz que *"um item bloqueado segura o próprio canal e **não os outros**"*. As duas
não valem juntas quando um membro escreve em mais de um canal: o `authorSeq` é atribuído em
ordem global no enfileiramento, então o canal que avança leva a marca d'água adiante e todo
item pendente dos outros canais, com número menor, passa a ser recusado **para sempre** pelo
estágio 6.

**Medido:** 8 canais, rajada de 256 envelopes — **45** entraram no log, **211** foram recusados
como duplicata sem nunca terem sido aceitos.

E §11.3 não oferece saída: `failed → queued` manda *"reenviar o mesmo envelope, mesmo
`authorSeq`, mesmo `opId`"* — o número que o host já recusa.

Três saídas, e escolher é do normativo:

| Saída | O que muda | Custo |
|---|---|---|
| **(a)** `authorSeq` por `(autor, canal)` | §7.1, §7.5, estágio 6 de §8.2 | Muda material assinado e o `DS`; ops sem canal precisam de escopo próprio |
| **(b)** Ordem global por comunidade | §11.7 perde "não os outros" | Um canal bloqueado segura todos — o que §11.7 existe para evitar |
| **(c)** Reenfileirar com `authorSeq` novo ao ser ultrapassado | §11.3 ganha exceção | O `opId` muda; a correlação com a bolha otimista precisa sobreviver à troca |

O harness implementa a **detecção** (`E_AUTHOR_SEQ_OVERTAKEN`, desfecho nomeado em vez de
perda silenciosa) e mede a vazão com **um canal**, que é o caso que a spec vigente sustenta.

### 20.3 `ACHADO-03` — `sending` encalha para sempre depois de um crash

§11.3 tem `sending → queued` para erro transitório, mas o terceiro ramo de §11.6 é
*"indeterminado: mantém"* — e um item que ficou em `sending` porque o **processo morreu** cai
nele. Como o `flush` só pega `queued`, ele nunca mais é tentado: nem entregue, nem descartado.
**Medido:** host morto em `host:before-append`, 36 de 40 itens encalhados, log parado em 4.

Emenda barata: §11.6 devolve `sending → queued` **no boot**, sem consumir tentativa.

### 20.4 `ACHADO-04` — §11.4 e §11.5 não podem ser literais ao mesmo tempo

§11.4 põe o passo 6 ("aguarda o append do grupo") **dentro** da seção crítica. Lido assim, a op
A segura a seção enquanto espera o append e a op B nem decide: **todo grupo tem um registro** e
§11.5 deixa de existir. O harness caiu nisso e **nada acusou** — durabilidade correta, testes
verdes; só a métrica `maiorGrupo = 1` denunciou. Com decisão e `DS` sob a seção e a **resposta**
fora dela, o grupo médio medido passou de 1 para **30,6** (teto 32).

### 20.5 Resolução normativa aplicada em 2026-08-17

Os quatro achados deixam de ser propostas e passam a ter contrato nos documentos
normativos:

| Achado | Resolução |
|---|---|
| `ACHADO-01` | §11.6 consulta `opId` em `observed_ops`, que contém somente `APPLIED`; `lastAuthorSeq` só pode provar ausência quando é menor que o item. |
| `ACHADO-02` | A05 adota `sequenceScope`: canal para as seis ops de mensagem enfileiráveis e `community` para ops sem canal. `opVersion`/`Op.v` passam a 2; retry comum preserva envelope e `opId`. |
| `ACHADO-03` | Boot converte `sending` órfão para `queued`, sem incrementar `attempts`; `awaiting-confirmation` não é convertido. |
| `ACHADO-04` | A seção crítica cobre decisão/reserva, não o append. Há um grupo em voo; `core.append` resolve fora do lock, publica o `DS` ou descarta o grupo inteiro. |

Essa é uma emenda de arquitetura, não uma implementação da outbox. O `core/` e o harness
descartável ainda refletem partes da versão anterior; a fase 3 só deve começar contra o
contrato emendado e deve rerodar G4 com múltiplos canais.

### 20.6 O veredito, e o que ele não cobre

`CONFIRMADO` nos oito critérios — zero perda, zero duplicata, convergência em 9/9 pontos de
kill, adversário detectado, p95 muito dentro do alvo de §26.1. O artefato declara cinco
limitações com id próprio (`G4-E1` a `G4-E5`); a que mais importa é `G4-E1`: **queda de energia
continua fora**, porque `rocksdb-native` não expõe `WriteOptions` e sem `fsync` observado o WAL
fica no cache de página. §10.7.1 já registra esse piso, e o gate não o move.
