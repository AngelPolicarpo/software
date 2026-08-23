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

Depois do POC-07, `observed_ops` foi acrescentada ao schema derivado e elevou
`view_schema_version` de 2 para 3; essa alteração pertence à resolução de ACHADO-01, não ao
histórico de H-20.

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

Essa é uma emenda de arquitetura seguida pela implementação inicial: `core/` já contém o
codec escopado, `observed_ops`, o manifesto, a outbox e a admissão do host. O harness
descartável continua refletindo a versão anterior; a integração com o produto e o rerun de
G4 com múltiplos canais ainda são necessários.

### 20.6 O veredito, e o que ele não cobre

`CONFIRMADO` nos oito critérios — zero perda, zero duplicata, convergência em 9/9 pontos de
kill, adversário detectado, p95 muito dentro do alvo de §26.1. O artefato declara cinco
limitações com id próprio (`G4-E1` a `G4-E5`); a que mais importa é `G4-E1`: **queda de energia
continua fora**, porque `rocksdb-native` não expõe `WriteOptions` e sem `fsync` observado o WAL
fica no cache de página. §10.7.1 já registra esse piso, e o gate não o move.

---

## 21. Fase 1 — fundação de fronteira (§29, A16, §10.8): implementação inicial 2026-08-20

**Gate de entrada:** G0 e G10 aprovados nos dois alvos (A16) — ver §15. `core/` já tinha
fase 2 (G1) e fase 3 (G4) como código Node puro; a fase 1 fecha o que faltava para o produto
Electron ser montável: IPC-R/IPC-M, autorização, deep link, identidade e wipe.

### 21.1 O que foi entregue

| Entrega | Onde | Seção | Teste |
|---|---|---|---|
| `config`/`clock` | `core/src/l0/config` `clock` | §27.2, §1.5 | `fase1-boundary — Config & Clock` |
| `keystore` | `core/src/l0/keystore` | §3.2, §5.4, A13 | `fase1-boundary — Identity e Keystore` |
| `identity` | `core/src/l0/identity` | §5.1, §5.5, §6.1, A13 | `fase1-boundary — Identity` (`create`, `load`, `sign`, `export`/`import` Argon2id+XChaCha20, `handle`) |
| `ipcMain` | `core/src/l3/ipcMain` | §3.5, §10.8, §15.3, §15.7 | `parseDeepLink` (gramática fechada), `AuthTokenStore` (uso único/TTL 60 s, `main-confirmed`), `ProcessLock` (PID file) |
| `ipcRenderer` | `core/src/l3/ipcRenderer` | §15.1, §15.2, A14 | `IpcServer` (`epoch`/`subId`/`evSeq`, janela 256, `evStale`/`resync`, `E_UNKNOWN_COMMAND`/`E_NO_IDENTITY`/`E_PERMISSION_DENIED`), `MemoryIpcPort` |
| `manifest` | `core/src/l0/manifest` | §10.2, §11.2 | já existia; fase 1 usa `identity.enc`/`datakey.wrapped` em arquivo como base para a migração a `manifest.secrets` |
| `wipe` | `core/test/fase1-wipe-resumption` | §18.6, §10.8 | `wipe_state` gravado **antes** da etapa, sentinela `WIPE` após `manifest-deleted`, `LOCK` por último, retomada de `view-deleted` |

Build e fronteira: `npm run build` = `tsc` + `check-layers.ts` (§4). `§4 ok — 34 arquivo(s), módulos por camada L0:7 L1:6 L2:2 L3:2`. `npm test` = 486 testes, 0 falha (inclui fuzzer de totalidade §8.5).

### 21.2 Como foi validado

Os testes de fase 1 seguem o mesmo padrão da suíte de `core/` — `node --test` em `dist/test`,
sem Electron, sem rede, com `MemoryIpcPort` e `FallbackKeystoreOracle` (`insecure:`). Eles
provam: `epoch` errado é descartado sem resposta (§15.1), `subId` é do servidor, `evSeq`
monotônico por `subId`, janela 256 produz `evStale` e `evAck` retoma, classes `open` /
`standard` (exige identidade) / `main-confirmed` (exige `authToken` de uso único) / `dev`
(gateado por `P2P_BUILD_CHANNEL=prod`), deep link só nas duas formas de §3.5 e
`identity.wipe` como máquina retomável com `SWAP`.

### 21.3 Riscos residuais e o que ainda não é G0/G10 — **fechados em código em 5295f1b, pendente pack**

> **2026-08-20:** os seis riscos abaixo foram transcritos do normativo para código em `5295f1b`,
> seguindo `poc/poc-10-identity` e `poc/poc-03-runtime` como evidência (não cópia). A validação
> empacotada G0/G10/G6 nos dois alvos da matriz A16 permanece pendente, assim como `G4-E1`
> (queda energia sem `fsync` observado §10.7.1). Até o pack, a evidência de release continua
> sendo a dos POCs, não a do produto `app/`.

| Risco | Onde doía | Correção em `5295f1b` (file:line) |
|---|---|---|
| **Shell Electron não empacotado** | `core` com `MemoryIpcPort`, sem `utilityProcess` real §3.1/§3.3 | `app/src/main/index.ts:1-260` + `app/src/utility/index.ts:1-80` + `app/src/preload/index.ts:1-50` — dois `MessageChannelMain`, `requestSingleInstanceLock`+`second-instance` §10.8, probe `--password-store` A13(5)(6), `safeStorage` oráculo, `dialog`/`shell.openPath`/`setDisplayMediaRequestHandler`, ciclo `boot`→`draining` |
| **`ProcessLock` sem `flock`** | PID file com `ftruncate` §10.8, `EPERM` no Windows G10 §3.1.2 | `core/src/l3/ipcMain/index.ts:1-210` `O_RDWR\|O_CREAT` + `fs-native-extensions` `tryLock`/`unlock` (`LockFileEx`), `install_id` persistido, `lock.stolen` |
| **`manifest.secrets` não usado** | `identity.enc` em arquivo, diverge de §10.2 | `core/src/l0/manifest/index.ts:63-340` `secrets`/`communities`/`FULL`; `core/src/l0/identity/index.ts:143-360` injeção `ManifestDb` em `secrets` (`data_key`+`identity_seed`) com fallback arquivo |
| **`safeStorage` real não exercitado** | `FallbackKeystoreOracle` só, L-2 | `core/src/l0/keystore/index.ts:44-210` `ElectronSafeStorageOracle`+`IpcKeystoreOracle` via IPC-M, `isDegraded` por `isEncryptionAvailable()`, probe `gnome-libsecret→kwallet6→kwallet5` com `relaunch` |
| **IPC-M não separado fisicamente** | `MemoryIpcPort.createPair()` simula §3.1 | `app/src/main/index.ts:90-130` cria `ipcM` e `ipcRForUtility`, `core/src/l0/keystore/index.ts:84-147` consome IPC-M |
| **Falta G6 (crash/restart)** | `epoch`/`subId` em teste, sem `SIGKILL` 3×/60s §15.2/§3.3 | `core/src/l3/ipcRenderer/index.ts:273-420` `IpcClient.handleCoreEpoch` (`E_CORE_RESTARTED`, descarta `subId`), `app/src/main/index.ts:150-190` `utility.on('exit')` `epoch++` backoff `1s/4s/10s`; `poc/poc-04-g6` `APROVADO 6/6` em `quick`+`full` (Node) |

Nenhum dos riscos acima bloqueia a fase 2/3 já implementada — `fold`, `projector`, `outbox` e
`communityHost` continuam puros e testados —, mas todos precisam de pack nos dois alvos
(glibc ≥2.31 via container, rebuild por Electron) e rerun `G0`/`G10`/`G6` **empacotado** antes de
fase 1 ser considerada **validada para release**. Até lá a implementação é **em código**,
coberta por `core: npm test` `486/486` + `poc/poc-04-g6` `quick`+`full` (Node), e a evidência
de G0/G10 continua sendo a dos POCs históricos.

### 21.4 G6 — IPC crash/restart (§15.2, A14) — `quick`+`full` (Node) aprovados 2026-08-20

Harness `poc/poc-04-g6` `APROVADO 6/6` em `quick` (10k, 1,5s) e `full` (Node, 100k, 1,6s):
`out/gate-G6-quick/gate-G6.json` e `out/gate-G6/gate-G6.json` `verdict: APROVADO`
`linux-x64` `C1` hello/epoch, `C2` 100k janela 256 com pausa 1s (`evStale`), `C3` 1000 req
sem duplicata (`opId` idempotente), `C4` 3 crashes `epoch 1→4` com replay do log e
convergência (`before:1000`→`after:1000`), `C5` `evStale`→`resync`, `C6` heap `ratio:1.001`
≤1.2. Pendente só `full` **empacotado** (`electron-builder`, `contextIsolation`/`sandbox`,
`MessageChannelMain` nativo, `G6-E1` análoga a `G0-E1`) para fechar G6 e liberar fase 4
junto com G2 `plano-de-validacao-experimental-v2.md:6` `fase3─┬─G2─┐└─G6─┴→fase4`. Detalhe em
`poc/poc-04-g6/REPORT.md:1-80`.

### 21.5 G2 — reprojeção, participação, chaves e blobs (A03, A09) — `quick`+`full` (Node) aprovados 2026-08-20

Harness `poc/poc-02-g2` `APROVADO 9/9` em `quick` (5 comunidades/100 msgs) e `full` (Node,
10 comunidades/1000 msgs, 100 blobs): `out/gate-G2-quick/gate-G2.json` e
`out/gate-G2/gate-G2.json` `verdict: APROVADO` `linux-x64` `C1` comunidades/chaves em
`manifest.communities`, `C2` 100/1000 msgs + `dumpHash`, `C3` reprojeção limpa idêntica
(`viewHash` `dumpBefore`), `C4` sem `ds_snapshot`, `C5` bump `view_schema_version`,
`C6` crash `view.db` vs `manifest.db` com `reproject`, `C7` `coreKey`/`blobsKey`
inalterados, `C8` blobs `verified`, `C9` boot ≤4s. Pendente `G2-E1` escala real
(50 comunidades/5000 msgs, 500 blobs, 4 GiB, 3 SOs A16) e `Hyperblobs`/`hyperdht/testnet`
para fechar G2 e, junto com G6, liberar fase 4 `plano:6`. Detalhe em
`poc/poc-02-g2/REPORT.md:1-70`.

Com G2 e G6 `APROVADO` em `quick`+`full` (Node), **fase 4 está liberada em código**
(contrato `manifest×view` e `epoch/subId/evSeq`). Resta `G2-E1`/`G6-E1` e pack `G0/G10`
nos dois alvos para `validada para release`.

---

## 22. Fase 4 — replicação e rede visível (§29, §14.2/§14.3/§14.5, §6.15, §6.16, §17.6): implementação em código 2026-08-20

**Gate de entrada:** G2+G6 `APROVADO` 9/9 + 6/6 `quick`+`full` (Node) — ver §21.4/§21.5.
`plano:6` `fase3─┬─G2─┐└─G6─┴→fase4`. Fase 4 implementada como módulos puros com relógio
injetável e `Swarm` mockado (sem `hyperdht` real); DHT/Noise e escala multicomunidade
continuam pendentes como `G2-E1`/`G6-E1`/`G0-E1` para `validada para release`.

| Entrega | Onde | Seção | Teste |
|---|---|---|---|
| `swarm` | `core/src/l0/swarm` | §14.1/§14.2/§14.3 | `fase4-replication — §14.2/§14.3` — `allocateConnections` (40% ativa ≥8, 40% host `HOST_MAX_PEERS`, round-robin + `BG_ROTATION_MS` 60 s), `authorizeReplicationChannel` + `firewallShouldRejectConnection` (só quando banido em **todas** as comuns, pré-membro exceto §12.3, fecha T-25), `join`/`leave`/`getStats`/`degraded`, `degraded` via bootstrap |
| `communityClient` | `core/src/l2/communityClient` | §14.5, §6.15 | `fase4-replication — §14.5` — `computeReplicationState` com `HELLO_INTERVAL_MS` 30 s/`REPLICATION_STALL_MS` 20 s/`REPLICATION_WATCH_MS` 5 s, `synced`/`catching-up`/`stalled` (`no-provider`) /`blocked` (`gap`) /`unauthorized` (`accessRevoked`)/`forked`, `watchdogTick` com lag/`reason`, `markHello`/`markUnauthorized`/`markForked`/`markBlocked`; `computeUnreadForChannel` §6.15 com `lastReadSeq`/`hiddenByBan`/`pendingMentions` |
| `presence` | `core/src/l2/presence` | §6.16, §17.6, A27 | `fase4-replication — §6.16/§17.6` — `PresenceManager` com `PRESENCE_TTL` 45 s/`TYPING_TTL` 5 s, rate-limit 5 s presença /2 s typing por canal, `invisible` não publica (§6.16), `subscribeChannel` por interesse (typing só para assinantes), host agrega `presence.changed` delta a cada `PRESENCE_TICK_MS` 2 s, `tick` expira TTL e emite |
| `config` | `core/src/l0/config` | §27.2 | `swarmMaxConnections` 128, `hostMaxPeers` 256, `bgRotationMs` 60k, `replicationWatchMs` 5k, `replicationStallMs` 20k, `helloIntervalMs` 30k, `presenceTickMs` 2k — congelada no boot |

Build e fronteira: `npm run build` = `tsc` + `check-layers.ts` (§4). `§4 ok — 37 arquivo(s), módulos por camada L0:8 L1:6 L2:4 L3:2`. `npm test` = 508 testes, 0 falha (inclui `fase4-replication` 22).

### 22.1 Limitações de evidência que permanecem para `validada para release`

| Limitação | O que ainda não foi medido | Gate/atributo que a fecha |
|---|---|---|
| `G2-E1` | Escala real: 50 comunidades participadas, 5 000 msgs/comunidade, 500 blobs, 4 GiB, 3 SOs A16 + `Hyperblobs`/`hyperdht/testnet` com crash entre `view.db`/`manifest.db` | G2 |
| `G6-E1` | `full` empacotado `electron-builder` com `contextIsolation`/`sandbox` + `MessageChannelMain` nativo, `SWARM` real, `SIGKILL` do `utilityProcess`, heap/v8 + `tc/netem` | G6 |
| `G0-E1`/`G0-E2` | Pack nos dois alvos da matriz A16 (glibc ≥2.31 via container, rebuild por Electron) e rerun `POC03_PROFILE=full`/`POC10_PROFILE=full` | G0/G10 |
| `G9/B2/B4` | Benchmarks `BENCHMARK REQUIRED` (boot multicomunidade, fan-out efêmero) antes de anunciar 340 membros/L-13 | G9 |

`REQUIRES POC`/`BENCHMARK REQUIRED` de `CLAUDE.md:44` continuam bloqueando a fase
seguinte: **G3** (`invite delegado` A08 `p2p-admission/1` com 6 desfechos, `maxUses`
atômico §12) é `REQUIRES POC` antes da fase 5, e **G5+G11** (core de blobs por autor
A09 + `ticket` §13.3 e allowlist `§13.6` com fuzzing §13.6/G11) antes da fase 6.
A UI não anuncia números não medidos (§26.1, §44).

---

## 23. Fase 7 — mídia no núcleo: STUN/TURN do host, credencial curta e tickets de sessão (§17.2–§17.4, A17, A22): implementação em código 2026-08-21

**Gate de entrada:** G7 com evidência parcial em `poc/poc-08-g7/out/gate-G7/gate-G7.json`
(demux 100%, servidor TURN funcional com clientes WebRTC reais, matriz de NAT ≥95%, relay
cego medido, revogação ≤ 5 s). Os `openCriteria` (CGNAT/netem de kernel, Opus/SRTP no
renderer empacotado, CPU dedicada) bloqueiam **release**, não implementação — mesmo padrão
do G4/fase 3. Decisões do harness foram reaproveitadas como decisões; o código do poc é
descartável e nada foi copiado.

| Entrega | Onde | Seção | Teste |
|---|---|---|---|
| Demux da socket compartilhada + codec STUN/TURN | `core/src/l2/communityHost/stunTurn.ts` | §17.3, A17 | `media-stun-turn — demux §17.3` — regra literal (bits `00` + magic cookie + comprimento), adversarial (cookie errado, bits `10`/`11`, length mentirosa), ChannelData (`0x40–0x7F`) roteado ao TURN antes do fallback UDX (ordem validada em G7 C2/C3) |
| Binding RFC 5389 | idem | §17.3 | `media-stun-turn — STUN Binding` — XOR-MAPPED-ADDRESS = origem observada |
| Subconjunto TURN RFC 5766 sobre portas injetadas | idem (`MediaServer`) | §17.3 | `media-stun-turn — Allocate/Refresh/CreatePermission/ChannelBind/Send/Data` — 401 com realm+nonce, 437 mismatch, 442 transporte, MI na resposta; Send/Data e ChannelData nos dois sentidos via porta de relay simulada |
| Credencial TURN de curta duração | idem (`issueTurnCredential`/`turnCredentialPassword`) | §17.3 | `media-stun-turn — turnCredential` — `username=<sessionId>:<expiresAt>`, HMAC-SHA-256 (`crypto_auth`) sobre BLAKE2b('turn-cred/1'‖sessionId‖peerKey‖expiresAt); amarração a par/sessão/validade |
| Controles do TURN do host | idem (`TurnControls` + `MediaServer`) | §17.3, §27.2 | tela recusada (`screen-refused`), `TURN_ALLOC_PER_MEMBER`=2 → 486, permissão só roster → 403, TTL renovável enquanto a sessão viver (credencial expirada recusa o refresh), balde de tokens por `TURN_RATE_KBPS`, teto `TURN_SESSION_MAX_BYTES`, sweep por relógio injetado |
| Tickets de mídia + revogação | `core/src/l2/voiceCoordinator/index.ts` | §17.4, A22 | `media-tickets` — Ed25519(hostKey, BLAKE2b('media-ticket/1'‖sessionId‖channelId‖peerA‖peerB‖expiresAt)), par canônico, forjado/adulterado/expirado → `E_TICKET_INVALID`; `VoiceTicketManager`: aceite/renovação, DTLS só para pares válidos, `revoke()` fecha imediato e bloqueia a sessão por até `MEDIA_TICKET_TTL_MS` (`clearRevocation` destrava pelo roster), `dropSession`/`sweep` |
| Sessões de voz host-side | `core/src/l2/voiceCoordinator/host.ts` | §17.4, §RPC, §17.6 | `voice-host` — `VoiceHostSessions`: `join` valida §17.4 passo 1 contra o `DecisionState` (`voice_speak`, canal de voz, comunidade não ended, membro ativo não banido/timeout) e devolve `{sessionId, roster[], iceServers[], tickets[], turnCredential}`; `leave`/`setSelf{muted?,deafened?,cameraOn?,speaking?}` com `E_VOICE_FULL`/`E_CAMERA_LIMIT`; `renewTicket` par-a-par (`E_TICKET_DENIED`); `sweepAgainst(state)` deriva `voice.revoked` de ban/kick/timeout/`channel.delete`/fim da comunidade; fan-out `VoiceRoster` a cada mudança |
| Constantes | `core/src/l1/fold/constants.ts` + `core/src/l0/config/index.ts` | §27.1, §27.2 | `MEDIA_TICKET_TTL_MS` 5 min, `MAX_VOICE_PARTICIPANTS` 24, `MAX_CAMERAS` 6 no `fold` (protocolo); `turnRateKbps` 512, `turnAllocTtlMs` 600000, `turnAllocPerMember` 2, `turnSessionMaxBytes` 2 GiB, `relayMaxBytesPerDay` 5 GiB, `relayMaxAllocs` 4 como defaults operacionais na `config` L0 com env `P2P_*` |

Build e fronteira: `npm run build` = `tsc` + `check-layers.ts` (§4). `§4 ok — 43
arquivo(s), módulos por camada L0:8 L1:6 L2:7 L3:2`. `npm test` = 580 testes, 0 falha
(inclui `media-stun-turn` 25 + `media-tickets` 14 + `voice-host` 17).

### 23.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| Sem módulo novo `l2/media`: STUN/TURN em `communityHost` e tickets/revogação em `voiceCoordinator` | Tabela de §4 já atribui "roster, STUN/TURN" ao `communityHost` e "tickets de sessão, revogação" ao `voiceCoordinator`; o barreira de build rejeita diretório fora da tabela, e criar módulo seria alterar §4 sem evidência nova |
| `MEDIA_TICKET_TTL_MS` mora no `fold` (§27.1) e chega ao `voiceCoordinator` por injeção | §4 não declara `fold` nas dependências dele; uma constante nunca é transcrita duas vezes |
| Estado do log chega ao host-side pela porta estrutural `VoiceStatePort`, tetos via injeção | §4 também não declara `fold` para leitura de estado — mesmo padrão de `AppendablePort`/portas RPC; o `DecisionState` real satisfaz a porta por estrutura (testado contra gênese real) |
| Defaults `TURN_*`/`RELAY_*` na `config` (L0), não no `fold` | São §27.2 ("como esta instalação usa recursos locais"); o cabeçalho de `fold/constants.ts` fixa a divisão |
| Portas `MediaSocketPort`/`RelayPort` injetadas; nenhum `dgram` no core | §4: quando L2 precisa falar rede, declara a **porta** e L3 implementa no boot |
| MESSAGE-INTEGRITY long-term (HMAC-SHA1 sobre MD5(user:realm:password)) mantida sob a credencial curta | É o que torna a senha emitida compatível com clientes WebRTC reais — decisão validada em G7 C1/C6 (werift) |
| Tela via TURN recusada na camada de decisão, não no fio | REQUESTED-TRANSPORT=UDP é igual para voz e tela; o enforcement real é quem emite credencial (só `voiceJoin` de voz). Mesmo desenho validado em G7 C5 |
| Erros na fronteira só do catálogo §20.2 (`E_TICKET_INVALID`); recusas TURN internas são razões nomeadas que viram códigos RFC (401/403/437/442/486) | O catálogo de erros é fechado e não tem códigos de rejeição TURN |
| Voz: um participante, uma sessão — entrar noutra canal sai da anterior com revogação | Uma chamada por cliente é o modelo do produto (§2.3); sessões múltiplas por membro criariam roster e credenciais ambíguos |
| Renovação da `turnCredential` = re-`join` idempotente (mesma sessão, material fresco) | O `username` carrega `expiresAt` (§17.3), e `voiceTicket` só devolve `{ticketId, ticket, expiresAt}` — sem campo para credencial. A cadência de renovação passa a ser o próprio `voiceJoin` |
| Revogação client-side caduca em `MEDIA_TICKET_TTL_MS` e o roster pode destravar antes (`clearRevocation`) | §17.4 define o pior caso como expiração do ticket; reentrada legítima na mesma sessão precisa de caminho determinístico |
| Permissão removida no meio da sessão não derruba chamada | §17.4 define enforcement por remoção de roster + revogação de ticket; `voice_speak` é validado na entrada (`sweepAgainst` só deriva de estado estrutural do membro/canal/comunidade) |

### 23.2 Limitações que permanecem

| Limitação | O que falta | Quem fecha |
|---|---|---|
| Wiring de produto | Socket UDP real (L3/boot) injetando `MediaSocketPort`/`RelayPort`; roteamento dos fan-outs `voice.revoked`/`VoiceRoster` aos destinatários conectados; livro de endereços `host:port` do roster para as permissões do `MediaServer`; `settings.setDevice`/`device_pref` e evento `voice.deviceError` (superfície local de dispositivos, RT-10) | Fases seguintes de integração (IPC-R/IPC-M, `app/`) |
| `openCriteria` do G7 | CGNAT/netem de kernel, Opus/SRTP nativo no Electron empacotado, CPU dedicada na escala de referência | G7/G8 empacotado — bloqueia release, não código |
| Relay voluntário (A21) | TURN restrito do voluntário com consentimento persistido, `relayPk` derivada, TTL/cota §17.7 | Fase 9, após o núcleo |
| Árvore de multicast (A20) | Especificada e adiada; bloqueada por G13 | §17.8 |
| Números não medidos | CPU 12,4% do harness é limite superior (clientes no mesmo processo); a UI não anuncia | G9 / `BENCHMARK REQUIRED` |

## 24. POC-09 / G8 — camada de decisão da sessão de tela em código puro e evidência parcial em estrela WebRTC Node (§17.4–§17.5, A19/A22): harness 2026-08-21

**Gate de entrada:** nenhum — G8 estava sem evidência. **Resultado:** evidência parcial em
`poc/poc-09-g8/out/gate-G8/gate-G8.json` (perfil full, 13/13; quick 11/11 em
`out/gate-G8-quick/`). Interpretação em `poc/poc-09-g8/REPORT.md`. O harness importa os
artefatos compilados do core (`MediaServer`, `VoiceHostSessions`, `ShareHostSessions`,
`VoiceTicketManager`, `TurnControls`) — nada de mídia/tickets/decisão foi reimplementado,
corrigindo o desvio do poc-08.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| `SHARE_MAX_VIEWERS` como constante de protocolo | `core/src/l1/fold/constants.ts` | §27.1 | injetada na decisão; teto exercitado nos testes e no harness (9º espectador → `E_SESSION_FULL`) |
| Camada de decisão da sessão de tela + captureToken | `core/src/l2/voiceCoordinator/share.ts` (`ShareHostSessions`, `authorizeCapture`, `degradeOnLoss`, perfis §17.5) | §17.4/T-41, §17.5, A19/A22 | `media-share` — matriz de autorização do `share.start`, uma sessão por canal (`E_ALREADY_SHARING`), captureToken recusado forjado/sessão errada/expirado/pós-stop, teto 8 + vaga reaberta, `setQuality` `{applied:true}` com papel espectador literal, ban via `sweepAgainst` encerra sessão e revoga espectadores, tabela de `degradeOnLoss` (>3 %) — 25 testes |
| Estrela WebRTC real sobre a decisão | `poc/poc-09-g8` (werift; descartável) | POC-09/G8 | latência p50/p95 apresentador→espectador (8 espectadores: p95 máx 0,6 ms localhost), perda, bitrate por perfil medido nos receptores (1167/1200), `setQuality` mensurável (razão medida 0,239 vs contratual 0,24), degradação >3 % aplicada e medida (2317→1112 kbps), ban → cessação 0 ms (critério ≤5 s), entrada tardia 153 ms ao 1º quadro, ticket adulterado recusado antes de DTLS, STUN/demux reais |

### 24.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| Decisão host-side da sessão de tela em `voiceCoordinator/share.ts`, não em módulo `shareStar/` | §4 atribui "sessão de tela, autorização" ao `shareStar`, mas esta parte é código puro sem mídia e a instrução registrada desta sessão foi implementá-la no `voiceCoordinator`; o `shareStar` produto (fase 8) consumirá estas classes — migração mecânica se a fase 8 exigir |
| `captureToken` opaco aleatório amarrado à sessão com comparação timing-safe, não ticket assinado | quem valida é o próprio host que o emitiu (`capture.authorize`, IPC-M main→núcleo→main); não há verificador terceiro, então Ed25519 acrescentaria codificação sem propriedade nova — mesmo critério do catálogo fechado de erros de §23.1 |
| Apresentador precisa estar na chamada de voz para `share.start`; fora dela → `E_SESSION_GONE` | A19/§17.5: a sessão vive dentro da chamada ("espectador é participante do canal de voz", `F-18`); erro não catalogado no §RPC para este caso — escolhido estado nomeado existente |
| `setQuality` literal ao papel "espectador" do §RPC: apresentador não muda perfil alheio | coluna Perm. de §RPC; mudança global de qualidade não está especificada |
| Degradação automática só desce um perfil por evento, sem subida automática | §17.5 define apenas "degrada a qualidade automaticamente conforme share.health reporta perda"; limiar 3 % vem do critério G8 do plano (`SHARE_LOSS_DEGRADE_PCT` no módulo, não no `fold` — não decide op) |

### 24.2 Limitações que permanecem

| Limitação | O que falta | Quem fecha |
|---|---|---|
| `openCriteria` do G8 | Chromium empacotado com `getDisplayMedia`/`RTCStatsReport` reais e encoder real; tc/netem (uplink 5/10/25 Mbps), CGNAT; CPU ≤40 % em alvo dedicado; `share.health` do renderer | G8 empacotado — bloqueia release, não a fase 8 |
| Enforcement de bitrate no werift | `setParameters({maxBitrate})` é aceito mas não aplicado pelo werift ("todo impl"); no escopo Node quem aplica é a bomba do apresentador, com efeito medido | produto usa o encoder do Chromium |
| Lacunas normativas | validade do `captureToken` (injetada, 120 s no harness), erro de `share.start` fora da chamada, histerese/subida de qualidade | emenda normativa ou deltas-ux antes da fase 8 |

## 25. Fase 8 — tela em estrela: módulo `shareStar`, entidades efêmeras e saúde ao apresentador (§17.5, §6.16, §RPC `share.*`, A19/A22): implementação em código 2026-08-21

**Gate de entrada:** G8 com evidência parcial (§24) — os `openCriteria` empacotados
bloqueiam release, não implementação, mesmo padrão de G4/fase 3 e G7/fase 7. Entrega da
fase conforme §29: captura autorizada, estrela ≤ 8, qualidade por espectador e saúde ao
apresentador — tudo em decisão host-side, porque o núcleo nunca vê mídia (§17.2); a
estrela em si é WebRTC no renderer.

| Entrega | Onde | Seção | Teste |
|---|---|---|---|
| Módulo `shareStar` (L2 sobre `voiceCoordinator`) | `core/src/l2/shareStar/` | §4 | barreira de camadas: `§4 ok — 46 arquivo(s) … L2:8` |
| Sessões host-side + captureToken + teto + qualidade por espectador | `shareStar/sessions.ts` (`ShareHostSessions`, migrada do `voiceCoordinator` onde nasceu no G8, §24) | §17.5, T-41 | `media-share` — 25+3 testes (matriz de autorização, `E_ALREADY_SHARING`, captureToken forjado/expirado/sessão errada/pós-stop recusados, 9º espectador `E_SESSION_FULL`, `setQuality` `{applied:true}` papel espectador, ban via `sweepAgainst`) |
| Entidade efêmera `ShareSession` + eventos `share.started`/`share.viewersChanged`/`share.stopped` | idem (`topology:'star'`, callback `onSessionEvent`) | §6.16, §RPC eventos | `media-share` — started/viewersChanged/stopped exatamente uma vez; join idempotente não reemite; snapshot carrega topologia e contagem |
| Saúde ao apresentador com degradação automática | `shareStar/health.ts` (`ShareHealthMonitor`: `ingest` → tick consolida → `onHealth`; degradação pelo caminho de sistema `degradeTo`, só desce) | §17.5, §17.6, §6.16, RT-08, critério G8 (>3 %) | `share-health` — 9 testes (consolidação latest-wins, poda de sessão encerrada/espectador que saiu, borda 3 %, nunca sobe, piso low, `not-lower`/`gone`, cadência 2 s exposta) |
| Varredura de permissão compartilhada | `voiceCoordinator/host.ts` exporta `memberHasPermission` (a barreira bloqueou `permissions` direto no `shareStar`: §4 não o declara) | §4, §9.1 | testes existentes de voz e tela |

### 25.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| Migração da decisão do G8 para o módulo próprio executada na fase 8 | §24 antecipou ("migração mecânica"); a linha de §4 atribui a sessão de tela ao `shareStar`, e o registro da barreira já declarava o módulo com dependência só do `voiceCoordinator` |
| `memberHasPermission` exportado pelo `voiceCoordinator` em vez de importar `permissions` no `shareStar` | §4 não lista `permissions` nas dependências do `shareStar` e o script da barreira é transcrição literal da tabela — a varredura mora no módulo que depende de `permissions`, que também a usava duplicada |
| Eventos granulares (`started`/`viewersChanged`/`stopped`) por um único callback `onSessionEvent` | mapeamento direto dos eventos de §RPC/§6.16; o fan-out aos destinatários conectados é da composição, como nos fan-outs `VoiceRoster`/`voice.revoked` da fase 7 |
| `degradeTo` como caminho de **sistema**, separado do comando `share.setQuality` (papel espectador no §RPC) | §17.5 define auto-degradação acionada pela saúde; ela não pode passar pelo comando do espectador nem subir perfil — razões nomeadas internas (`gone`/`not-lower`), precedentes das recusas TURN |
| Monitor consome amostras prontas (`rttMs`/`lossPct`) pela entrada `ingest`; RTCStatsReport fica no renderer | núcleo não vê mídia (§17.2); mesma fronteira de `MediaSocketPort`: números medidos entram por porta, medição é de quem possui o transporte |

### 25.2 Limitações que permanecem

| Limitação | O que falta | Quem fecha |
|---|---|---|
| Wiring de produto | handlers RPC `shareStart`/`shareJoin`/`shareLeave`/`shareSetQuality` (o `rpcServer` ainda não existe como diretório L3); roteamento dos eventos `share.*`/`ShareHealth` aos destinatários; **comando que reporte as amostras do renderer do apresentador ao host** (não catalogado no §RPC — lacuna aberta); handler `capture.authorize` no IPC-M | fases seguintes de integração (IPC-R/IPC-M, `app/`) |
| `share.failed{sessionId, reason}` (fecha V-18) | gatilho normativo de "falha" além do encerramento por stop/ban não está especificado | lacuna registrada; decidir na integração com a UI |
| Histerese/subida de qualidade | normativo só define descida automática; recuperação de perfil é comportamento de UI não especificado | deltas-ux antes da UI de produto |
| `openCriteria` do G8 | Chromium empacotado com `getDisplayMedia`/`RTCStatsReport` reais e encoder real; tc/netem; CGNAT; CPU dedicada | G8 empacotado — bloqueia release, não código |

## 26. Fase 9 — relay voluntário: consentimento, chave derivada, prova de posse, TTL e cota (§17.7, A21, R-19): implementação em código 2026-08-21

**Gate de entrada:** G7 confirmado (§29 libera a fase 9). A metade protocolar do relay já
existia no log desde o fold: `relay.volunteer`/`relay.withdraw` (kinds 60/61), verificação
R-19, estado `relays` e tabela `relay_volunteers`; a config L0 já resolvia os defaults de
§27.2 (`relayMaxBytesPerDay` 5 GiB, `relayMaxAllocs` 4, env `P2P_*`). Esta fase entregou o
módulo L2 que faltava — a decisão de quem voluntaria.

| Entrega | Onde | Seção | Teste |
|---|---|---|---|
| Módulo `relay` (L2 sobre swarm/config — nada importado deles: valores e rede chegam por injeção/porta) | `core/src/l2/relay/` | §4 | barreira: `L2:9` |
| Chave derivada da identidade + prova de posse | `keys.ts` (`deriveRelayKeyPair`, `signPossession`) | §17.7, R-19 | `relay-volunteer` — hash local ≡ `opCodec.relayPossessionSigningHash` byte a byte; verificação idêntica à de `apply.ts`; adulterada recusa; seed curta lança |
| Consentimento explícito e **persistido** antes de ligar | porta `RelayConsentPort` (`local_relay_consent`, §6.15) | §17.7 | sem consentimento → `E_CONSENT_REQUIRED` + pedido à UI (`missing`/`declined`); aceito libera; `forgetConsent` volta a exigir; persistência sobrevive "reinício" |
| Ciclo de vida com TTL renovável | `volunteer.ts` (`RelayVolunteer`: enable/renew/disable/sweep/status por comunidade) | §17.7, §RPC | op submetido com chave/expiração/posse corretos e seq devolvido; `renew` com material fresco; `disable` submete withdraw (no-op nomeado sem voluntariado); expirou → não listado, sweep não reemite |
| Cota do TURN restrito | `quota.ts` (`RelayQuota`) + `tryAllocate`/`releaseAllocation`/`recordRelayBytes` | §17.7, §27.2 | teto de alocações recusa e liberar reabre; bytes na cota suspendem e emitem `relay.stateChanged` uma vez; virada da janela de 24 h limpa a suspensão |

### 26.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| Domínios BLAKE2b reproduzidos em `keys.ts` em vez de importar `opCodec` | §4 declara só `swarm`/`config` para o `relay` e o script da barreira é transcrição literal; a divergência é impossibilitada por teste que cruza os bytes com o hash que o fold verifica |
| Portas `RelayConsentPort`/`RelaySubmitPort` em vez de importar `view`/`outbox` | mesma não-declaração em §4; padrão das portas estruturais (`MediaSocketPort`, `VoiceStatePort`): persistência do consentimento e submissão dos ops são da composição |
| Suspensão por cota mantém `enabled:true` no `stateChanged` | o voluntariado no log continua (op vivo, TTL correndo); quem "para de aceitar" é o TURN restrito local — desligar é `disable` ou expiração |
| Janela de cota = 24 h a partir do primeiro byte, não dia civil | decisão operacional de §27.2, determinística; não decide interpretação de log |
| `alloc-limit` recusa pontual sem suspender; `bytes-quota` suspende até a janela rolar | §17.7 "para de aceitar": pares já admitidos continuam servidos; liberar alocação reabre admissão imediatamente |
| Consentimento `declined` reemite `consentRequested` no novo `enable` | a UI precisa poder perguntar de novo (delta U-13); `missing` × `declined` diferenciam o texto |

### 26.2 Limitações que permanecem

| Limitação | O que falta | Quem fecha |
|---|---|---|
| Wiring de produto | handlers RPC `relay.enable`/`relay.disable`/`relay.respondConsent`; persistência real de `local_relay_consent` (preferências locais); submissão real via outbox/communityHost; socket UDP do TURN restrito na composição (`MediaServer` sob estes controles) | fases seguintes de integração (IPC-R/IPC-M, `app/`) |
| Seleção de relay por menor RTT | decisão de quem consome (`diag.run{relayAvailable}`), fora do módulo | integração/IPC-R |
| Superfície de consentimento | tela 3.1 → Rede e texto com L-14 (voluntário vê metadados) | deltas-ux/frontend |
| Custo real do voluntário | CPU/banda com tráfego DTLS-SRTP real em alvo dedicado | G7/G9 empacotado (`BENCHMARK REQUIRED`) |

## 27. Fase 10 — sucessão de host: módulo `succession` e evidência parcial do G12 (§18.8, A23, R-17/R-18/R-19): implementação e harness 2026-08-21

**Gate de entrada:** G12 sem evidência prévia. O harness `poc/poc-12-g12` produziu a
evidência parcial que libera a implementação (mesmo padrão G7→fase 7, G8→fase 8): escrow,
grace period, prova de posse, continuação aceita pelo fold real e arbitragem — 6/6 passos
nos dois perfis (`out/gate-G12/gate-G12.json`, quick em `out/gate-G12-quick/`). Interpretação
em `poc/poc-12-g12/REPORT.md`.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Escrow da semente | `core/src/l2/succession/escrow.ts` (`sealSeedFor`/`openSealedSeed`, Ed25519→X25519 + sealed box) | §18.8 | `succession.test.ts` + S1 do harness — só o alvo abre; intruso/adulterado → null |
| Relógio de inatividade | `watch.ts` (`InactivityWatch`, ttl injetado = `HOST_INACTIVITY_MS`) | §18.8, R-18b | borda do grace period |
| Construção da continuação | `continuation.ts` (`planContinuation`: gênese com origin*, assumeHost seq 6 com prova `'assume/1'`, lote estendido de cargos/categorias/canais com previsão de ids via `entityId`) | §18.8 passos 2–6, R-27 | fold REAL aplica tudo sem rejeição; R-18(a) verifica contra a chave pública da ORIGEM |
| Camada b + arbitragem | `follow.ts` (`evaluateLayerB`, `chooseContinuation`, `dispositionFor`) | R-18b, L-16 | prioridade da lista decide; disputed não migra; réplica sem origem segue camada a |
| Evidência G12 | `poc/poc-12-g12` (descartável; importa fold/opCodec/succession compilados) | POC-12 | S1–S6 nos dois perfis |

### 27.1 Emendas aplicadas

| Emenda | Justificativa |
|---|---|
| §4 — dependências de `succession`: `corestore, identity` → `+ fold, opCodec, idgen, permissions` | Sem elas o módulo não existe: ler estado (fold), codificar/assinar os registros da continuação (opCodec), prever os ids de entidade novos (idgen) e recriar cargos com a numeração fechada de §9.1 (permissions). A barreira bloqueou cada importação antes da emenda — transcrição atualizada junto com o normativo |

### 27.2 `ACHADO-G12-01` — buraco de spec: membros não são reconstrutíveis — **resolvido em 2026-08-22, ver §31**

§18.8 passo 6 manda reconstruir membros no lote estendido, mas isso é **inalcançável** com
o catálogo fechado de 38 kinds: a membresia criada por `member.join` é a do próprio autor
do op (estrutura de §7.3/§8.1), a prova de R-9 vincula o communityId NOVO (que o sucessor
não forja para terceiros) e ninguém assina por um terceiro. Medido no harness: a
continuação nasce com exatamente 1 membro (o sucessor); qualquer zero-form adicional é
`E_INVITE_INVALID`. Uma emenda preliminar de R-9-sucessão foi descartada durante a
implementação porque não resolvia o caso de terceiros.

Rotas avaliadas: (i) desacoplar alvo da autoria na forma de sucessão; (ii) transplante
de lote assinado da origem; (iii) convergência assíncrona por convites publicados pelo
sucessor. Detalhes e trade-offs em `poc/poc-12-g12/REPORT.md` §3. **A decisão normativa
saiu em 2026-08-22 — rota (iii) mais a emenda de ban sem membresia; ver §31.**

### 27.3 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| Comunidade encerrada (`community.end`) não tem sucessão | §18.5: end é terminal, zero ops novas, modo histórico — assumir por cima contradiz o estado |
| Duplicatas estruturais mapeiam para as equivalentes (GERAL da gênese × GERAL da origem; canal `geral` sob R-6) | Recriar violaria R-6 nos canais e produziria ruído nas categorias; a correspondência old→new fica explícita nos mapas do plano |
| Ids de entidade previstos com `entityId` antes de cada create | §7.3: ids são determinísticos por `(kind, coreKey, autor, authorSeq)`; prever é obrigatório para o lote referenciar cargos/categorias criados no mesmo lote |
| `observedHostTs` do assumeHost = `lastHostTs` da origem | É o que o sucessor observou ao decidir assumir; a camada b confere o grace period contra o mesmo valor |

### 27.4 Limitações que permanecem

| Limitação | O que falta | Quem fecha |
|---|---|---|
| Convergência de membros | ~~decisão sobre ACHADO-G12-01~~ **decidida em 2026-08-22 (§31)**; falta implementar R-28 no `fold`, os bans no lote estendido de `continuation.ts` e a superfície de reentradas pendentes | fase de integração da sucessão |
| Wiring de produto | Hypercore/swarm reais multi-nó, migração de rail, corrida "host volta durante replicação", manifest §5.3 derivando chaves da semente recuperada | fases seguintes de integração |
| openCriteria empacotados | Electron/utilityProcess; escrow corrompido persistido de verdade; escala de referência | G12 empacotado — bloqueia release, não código |

---

## 28. Fase 11 — busca e diagnóstico: módulos `search` e `diagnostics` (§23, §15.4 `diag.*`, RT-11): implementação em código 2026-08-21

**Gate de entrada:** nenhum gate específico de busca. O G5 (`poc/poc-06-g5/out/gate-G5`)
mediu ownership e caminho de escrita de **anexos** — não FTS5; nenhuma conclusão de busca foi
reaproveitada do relatório porque lá não existe uma. A consulta é pura sobre `view.db`
local, sem rede, e não havia `REQUIRES POC` sobre ela. Com esta fase, a tabela de §4 está
completa em módulos: **12 em L2**, barreira `§4 ok — L0:8 L1:6 L2:12 L3:2`; suíte do core
643 → 665 testes, 0 falha.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Pipeline de texto puro | `core/src/l2/search/text.ts` (`normalizeText`, `tokenize`, `buildFtsMatch`) | §23.1, DR-39 | `search.test.ts` — diacríticos; tokens de 1 caractere descartados; operadores FTS5 (`AND`/`OR`/`NOT`/`NEAR`/`*`/`:`) viram literais citados; aspas interna duplicada; prefixo só no último token |
| Consulta FTS5 sobre `CS` | `service.ts` (`SearchService`) | §23.1–§23.3, §15.6 | recência (`seq DESC`); exclusões (`deleted_at`/`hidden_by_ban`/`orphaned`/canal de voz); escopo antes dos filtros; `date` sobre `host_ts`; `kind` attachment/pinned/link; tetos 20→100; isolamento por comunidade; canais/membros só ao texto |
| Diagnóstico assíncrono | `core/src/l2/diagnostics/index.ts` (`Diagnostics`) | §4, §15.4 | `diag.run` → `{natType, peerCount, relayAvailable, stunReachable, ranAt}` exato; sondas em paralelo; estouro de prazo e rejeição absorvidos; `diag.snapshot` passa a métrica de §24.3 |

### 28.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| `snippet` derivado em JavaScript de `messages.content`, não via `snippet()` do FTS5 | `messages_fts` é **contentless por norma** (`content=''`, §10.3): o índice não guarda texto, e `snippet()` nele devolve NULL. Janela fixa com reticências; apresentação fina fica para a UI |
| Canais/membros casam por substring sobre a mesma normalização da etapa 1; tokens de 1 caractere valem para os três grupos | "A mesma função do frontend" (§23.1), transcrita de `frontend/src/features/search/searchIndex.ts`; paridade de comportamento entre mock e núcleo |
| Membros pesquisados = roster ativo (`left_at IS NULL AND banned = 0`), rótulo `nickname ?? displayName` | O índice `idx_members_active` existe para esta enumeração (§10.3); banidos têm superfície própria (§18) |
| `partial`/`partialReason` são **ecoados** da composição, nunca derivados aqui | As quatro causas de RT-11 (§14.5) são estado de replicação/host que `view.db` sozinha não conhece; inventar causa local seria comportamento fora da spec |
| `CHANNEL_TYPE_VOICE = 1` repetido localmente em vez de importar `fold` | §4 não declara `fold` como dependência de `search` e a barreira bloquearia; `channels.type INT` é forma de armazenamento de `CS` |
| `diagnostics` não importa um registro central de métricas — declara a porta `DiagnosticsMetricsPort` | O módulo `metrics` (L0) ainda não existe como código: contadores vivem nos detentores de estado (fold/projector/outbox/host). Criar registro central nesta fase sairia do escopo declarado |
| Falha ou estouro de prazo de sonda **não rejeita**: `stunReachable=false` e `natType='cgnat'` (pior caso assumido) | §15.4 não cataloga erro para `diag.run` — o comando sempre responde; conservadorismo evita otimismo de conectividade |
| Sondas NAT/STUN em portas injetadas, corridas em paralelo sob teto configurável; timer referenciado e limpo no `finally` (sem `unref`) | "Não pode: bloquear o event loop" (§4) — nada síncrono-bloqueante, prazo sempre limita; sem `unref`, o próprio prazo é quem encerra a espera |

### 28.2 Limitações que permanecem

| Limitação | O que falta | Quem fecha |
|---|---|---|
| Wiring IPC-R | `query.search` e `diag.*` expostos ao renderer, montagem das portas no boot | fase de integração |
| Implementações reais das portas de sonda | Probe NAT do HyperDHT, Binding STUN pela socket compartilhada UDX, disponibilidade relay/TURN da instalação | integração L3/composição |
| Números de desempenho de busca | `<30 ms` em 10 k msgs continua hipótese de §26.1 — nada foi medido nesta fase e a UI não anuncia número | G9 |
| Causas `partial` em produção | Dependem de `communityClient`/outbox reais publicando estado de replicação (§14.5) | fases seguintes de integração |

---

## 29. Fase de integração — RPC P2P (§16), superfícies IPC-R (§15.3/§15.4/§15.6) e composição das portas: implementação em código 2026-08-21

**Gate de entrada:** nenhum gate específico — esta fase é a montagem do grafo de §4 ("quem
monta o grafo injeta a implementação no boot") sobre módulos já entregues, com transporte
simulado. Barreira passa para `§4 ok — L0:8 L1:6 L2:12 L3:4`; suíte do core 665 → 678
testes, 0 falha.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Módulos `rpcServer`/`rpcClient` (L3) | `core/src/l3/rpcServer/`, `core/src/l3/rpcClient/` | §16.1, §16.2 | dois protocolos (`p2p-community/1`, `p2p-admission/1`); teto de frame **antes** do decode (64 KiB / 4 KiB); timeouts 15 s membro / 10 s pré-membro (redeem 30 s); orçamento em voo 8/2; queda e timeout → `E_HOST_UNAVAILABLE` |
| Escrita ponta a ponta | `test/integracao.test.ts` | §11.4–§11.9 | outbox real → `submitOps` por RPC → `HostAdmission` real (group commit) → réplica com Projector/view.db reais interpreta → reconciliação por observação remove os itens |
| Registro de comandos IPC-R | `src/l3/ipcRenderer/commands.ts` (`registerCoreCommands`) | §15.3, §15.4, §15.6 | `diag.run`/`diag.snapshot`; `query.search` (open, com `partialReason` da composição); `relay.enable`/`disable`/`respondConsent` (consentimento REAL em manifest.db); `voice.join`/`leave`/`setSelf`/`muteParticipant`; `share.start`/`join`/`setQuality`/`stop` |
| `voice.muteParticipant` no host | `src/l2/voiceCoordinator/host.ts` | §17.4, §9.1 | decisão de host com `voice_mute_others` via `memberHasPermission`; estado efêmero do roster |
| `currentSessionOf` + métodos de consentimento no manifest | `voiceCoordinator/host.ts`; `l0/manifest/index.ts` | §15.4 (`voice.leave` sem sessionId), §6.15 | sessão corrente do membro ("voz é uma só"); `local_relay_consent` já existia no schema — faltavam os acessores |
| Probe STUN de referência | `test/helpers/composition.ts` (`UdpStunProbe`) | §17.3 | Binding Request RFC 5389 codificado pelo codec do núcleo respondido por um `MediaServer` real sobre UDP de loopback — a junta da porta `DiagnosticsStunPort` exercitada de verdade |

### 29.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| `rpcClient` não importa `rpcServer` — tabela de protocolo duplicada com **teste de paridade** | §4 não declara importação lateral entre módulos de L3 e a barreira quebra o build; o teste impede divergência entre as duas cópias |
| Orçamento de requests em voo espera em fila (backpressure), sem recusa | §16.1 declara orçamento, não código de recusa; inventar código fora do catálogo de §20.2 é proibido |
| Timeout sem resposta e queda de conexão viram `E_HOST_UNAVAILABLE` | §16.1 literal — "requests em voo falham com `E_HOST_UNAVAILABLE` e voltam à outbox"; quem decide reenvio é a outbox (§11.6), nunca o transporte |
| `submitOps` devolve um resultado por envelope; só falha de infra interrompe com `E_NOT_ATTEMPTED` nos restantes | §11.9 literal (fecha DS-26) |
| Superfícies de voz/tela atrás da interface `MediaSurfaceDeps` | As decisões são do host (§17.4/§17.5); quando esta instalação não hospeda, o dispatcher remoto sobre `rpcClient` entra pela mesma fronteira sem mudar a forma dos comandos |
| Handshake `hello` exercido no cliente do rig; servidor não bloqueia pré-hello | O fluxo obrigatório é do cliente (§16.2); recusa server-side exigiria código de erro que o catálogo não nomeia |

### 29.2 Limitações que permanecem

| Limitação | O que falta | Quem fecha |
|---|---|---|
| ~~Modo membro de voz/tela via RPC~~ | **implementado em 2026-08-22 — §39** (com duas lacunas de §16.2 registradas lá) | — |
| Superfícies IPC-R da sucessão (`community.setSuccessors`/`assumeHost`) | ~~ponte de submissão assinada de ops na composição~~ (fechada no §30) + criação de gênese via corestore | integração seguinte |
| Transporte real (protomux-rpc sobre Hyperswarm, probe NAT do HyperDHT) | canais em memória cobrem o contrato de §16; sockets reais entram com os gates empacotados | G7/G8/G12 empacotados |
| Handlers de produto para `presencePublish`/`subscribeChannel` no rpcServer | o módulo `presence` (L2) existe; fan-out por conexão depende do transporte real | integração do transporte |
| ~~`file.pickForAttachment`/`blob.*` e `host.exitImpact` no roteador~~ | **implementado em 2026-08-22 — §41** | — |

## 30. Ponte de submissão assinada de ops — caminho de produto "intenção → op codificada → assinatura → envelope → outbox/RPC" 2026-08-22

**Gate de entrada:** nenhum gate específico — item 1 das limitações de §29.2. O caminho
existia só no cabo de teste (`test/helpers/world.ts` `makeRecord`); aqui ele vira produto.
Barreira inalterada (`§4 ok — L0:8 L1:6 L2:12 L3:4`, 63 arquivos); suíte do core
678 → **683 testes, 0 falha**.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Construtor compartilhado e portas da ponte | `core/src/l2/communityClient/submit.ts` | §7.1, §7.3, §19.3 | `SignedOpCodecPort` (`kindNumber`/`encodePayload`/`sealOp`: Op → encode canônico → BLAKE2b('op/1') → Ed25519 detached → Envelope → `opId`); `authorSeq` reservado **antes** de assinar via `outbox.nextAuthorSeq`; escopo por kind (`channelId` direto → alvo `messageId`/`rootMessageId` no DS → `community`) |
| Caminho A — outbox (§11.1) | `CommunityClient.submitQueued` | §11.1–§11.3, §15.4 Mensagens | sela e enfileira com meta completa de §11.2; resposta imediata `{opId, state:'queued'}`; `E_OUTBOX_FULL` no teto da fila |
| Caminho ⏱ — primitiva síncrona | `CommunityClient.submitSync` + porta `HostSubmitPort` sobre `rpcClient.submitOp` | §11.1, §16.2 | devolve `{seq}` ou `{code}`; recusa antes do append queima o número (§7.5); sem porta de host → `E_HOST_UNAVAILABLE` na hora |
| Validação advisória local (§8.7 ponto 1) | `advisoryCheck` em `submit.ts`, tetos injetados | §8.6, R-14/R-15, R-22, §15.4 | produz só a coluna síncrona de §15.4: `E_VALIDATION{field}` (content/mentions/payload/kind/sequenceScope), `E_CHANNEL_READ_ONLY`, `E_QUOTA_EXCEEDED`, `E_UNKNOWN_KIND`; roda antes de consumir `authorSeq` |
| `message.send` no roteador IPC-R | `src/l3/ipcRenderer/commands.ts` (`MessageSurfaceDeps`) | §15.3 standard, §15.4 Mensagens | perm `send_messages` via recorte do DS (`memberHasPermission`); resposta `{opId, state}`; `E_NOT_FOUND` para comunidade fora do recorte |
| Prova de integração com a ponte real | `test/integracao.test.ts` (`submissionRig`), porta real em `test/helpers/composition.ts` (`opCodecSignPort`, `rpcHostSubmitPort`) | §19.3 passos 1–8 | `makeRecord` deixou de ser o caminho de escrita do teste ponta a ponta: `submitQueued` ×4 → flush → HostAdmission real → réplica projeta → reconciliação remove por observação; reconciliação de boot de §7.5 (`max(manifest, log)+1`) exercida no rig |

### 30.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| Codec, ids e material de assinatura chegam por **portas injetadas** (`SignedOpCodecPort`, par Ed25519 da identidade, tetos de §8.6/R-14) | §4 não declara `opCodec`, `idgen` nem `identity` nas dependências de `communityClient` — padrão relay (`seed/sk` por parâmetro) e constantes por injeção; a barreira confere. Nenhum módulo novo, nenhuma emenda de §4 |
| Recorte estrutural do DS (`WriteStatePort`) lido pelo `projector` declarado | Mesmo padrão de `VoiceStatePort`: o `DecisionState` satisfaz a porta por estrutura; nada além do recorte é lido |
| A advisória **não duplica o pipeline do `fold`**: confere tetos de campo, R-22 e janela R-14/R-15 sobre o recorte, e o desfecho vinculante continua sendo o `foldRecord` na admissão (§11.4) e em toda réplica | §8.7: validação do cliente é advisória, pode divergir "e divergir é esperado e inofensivo"; os erros síncronos são exatamente os da coluna de §15.4 |
| Permissão de comando (`send_messages`) na fronteira IPC-R; readOnly do canal (`E_CHANNEL_READ_ONLY`) na ponte | Coluna Cl./Perm. de §15.4 para o comando; R-22 depende de canal+alvo, decisão de domínio da ponte |
| Comunidade desconhecida na ponte → `E_NOT_FOUND`; binding incompleto de comunidade conhecida → `E_INTERNAL` | §20.2: estado genérico para "nada local"; `E_INTERNAL` é bug/composição, nunca fluxo esperado |
| Escopo de alvo não resolúvel no DS recusa com `E_VALIDATION.sequenceScope` sem assinar nem consumir número | §7.1: escopo incompatível com o kind/alvo é `E_VALIDATION` no campo `sequenceScope` e não avança o contador |

### 30.2 Limitações que permanecem

| Limitação | O que falta | Quem fecha |
|---|---|---|
| ~~Demais superfícies de mensagem no roteador (`message.edit/delete/pin/react`, `thread.create`, `retry`, `cancelQueued`)~~ | **implementado em 2026-08-22 — §36** | — |
| ~~`community.leave` pela ponte (exceção de §11.1)~~ | **implementado em 2026-08-22 — §37** | — |
| Desfecho por evento até a UI | ~~emissão dos desfechos pela outbox~~ (fechada no §36); falta `messages.appended` **antes** de `message.accepted` (DS-31) — o evento do lote projetado — e o consumo no renderer | integração seguinte |

---

## 31. Decisão normativa do `ACHADO-G12-01` — o roster não migra na sucessão (2026-08-22)

**Contexto.** §27.2 registrou o buraco: §18.8 passo 6 mandava reconstruir membros no lote
de gênese estendido da continuação, e o G12 mediu que isso é inalcançável — a continuação
nasce com exatamente 1 membro. Nenhum código de produto novo foi escrito nesta sessão; o
que mudou foi o normativo.

**Decisão: rota (iii), reentrada assistida, mais a emenda de ban sem membresia.** Os membros
convergem de forma assíncrona por convites publicados pelo sucessor — cada pessoa entra
assinando o próprio `member.join` —, e o sucessor reatribui cargos com `member.setRoles`
conforme as reentradas chegam. Os **bans migram** no lote estendido.

### 31.1 Por que as outras rotas foram descartadas

| Rota | Por que não |
|---|---|
| (i) `member.join` com `targetKey` na forma de sucessão | Reabre `F-06` — §12.4 fixa que "`member.join` é assinado pelo próprio candidato; o host não fabrica autoria" — e quebra a camada (a) de R-18, que é **self-contained** por construção: uma réplica sem a comunidade de origem não tem como conferir se o roster declarado corresponde a ela, então qualquer chave poderia ser publicada como membro de uma "continuação" forjada. Também derruba a propriedade de §12.4 de que `joinProof` é verificável para sempre por toda réplica |
| (ii) Transplante dos envelopes originais | Exige que o `fold` aceite registros com `communityId` de outro core, isto é, core multi-escritor — exatamente o que A23/L-15 já recusou ao decidir que o histórico de mensagens não migra. O argumento não muda por se tratar de membros em vez de mensagens |
| (iii) Reentrada assistida | **Escolhida.** Nenhuma mudança no catálogo de 38 `kind`s nem no modelo de autoria; o custo é convergência eventual e uma superfície de UX para o conjunto pendente |

### 31.2 O furo que a rota (iii) sozinha deixava, e como foi fechado

Sem os bans no log da continuação, um banido da origem entraria pela porta da frente com um
convite de reentrada: a sucessão **lavaria o ban**, e "perda de ban" é critério de
reprovação do G12. Mas `mod.ban` exigia alvo já membro — `core/src/l1/fold/apply.ts` recusa
com `E_NOT_FOUND` —, e na continuação o banido não é membro de nada.

Daí a emenda **R-28**: `mod.ban` passa a admitir alvo que não é membro, criando a linha em
estado `banned` sem passagem por `active`, sem contar em `memberCount` e sem aparecer no
roster. A regra vale para toda comunidade (ban preventivo), não só para continuações —
restringi-la à continuação exigiria uma regra condicional à origem declarada na gênese, sem
ganho de segurança. A hierarquia de §9.3/R-16 continua valendo: sem `topRank` não há
imunidade de cargo, mas Fundador original e host corrente permanecem inatingíveis.

Isso é emenda de regra do `fold` dentro de `opVersion = 2`, sem bump: nada de produto foi
publicado, e o precedente é o mesmo das emendas de §19 e §27.

### 31.3 Onde a emenda foi registrada

| Documento | O que mudou |
|---|---|
| `docs/backend-v2.md` | §18.8 passo 6 (membros saem do lote, bans entram); **§18.8.1** novo, com a decisão, as alternativas descartadas e a justificativa; **L-23** novo em §18.8 e na tabela de limitações; **L-15** deixa de dizer "membros"; **R-28** novo na tabela de regras; R-9 ganha a nota de que vale sem exceção na continuação; §6.3 ganha a aresta `(não-membro) → banned`; §8.4.1 ganha as duas linhas de alvo não-membro; §18.1 detalha o efeito do ban sem membresia |
| `docs/adr-v2.md` | A23 ganha a emenda de 2026-08-22 e passa a citar L-23/R-28 |
| `docs/plano-de-validacao-experimental-v2.md` | G12: hipótese, aprovação e reprovação reescritas — "membros idênticos" vira convergência por reentrada com recuperação de cargos, e "banido da origem que consegue entrar" passa a ser reprovação explícita |
| `docs/deltas-ux-v2.md` | U-18 ganha a terceira superfície (reentradas pendentes) e o texto obrigatório passa a dizer que as pessoas precisam entrar de novo |
| Código | Só comentários e nome de teste em `core/src/l2/succession/continuation.ts` e `core/test/succession.test.ts`, que diziam "até decisão normativa" |

### 31.4 O que ficou pendente de implementação

| Pendência | Onde | Quem fecha |
|---|---|---|
| ~~R-28 no `fold`~~ | **implementado em 2026-08-22 — §32** | — |
| ~~Bans no lote estendido da continuação~~ | **implementado em 2026-08-22 — §33** | — |
| Convites de reentrada e reatribuição de cargos pelo sucessor | `succession` + superfície IPC-R | mesma fase |
| Superfície de reentradas pendentes (U-18c) | `frontend/` | fase de UI da sucessão |

---

## 32. R-28 no `fold` — ban sem membresia: implementação em código 2026-08-22

**Gate de entrada:** nenhum gate novo — R-28 é regra de `fold`, dentro do escopo do G1. É a
primeira das pendências de §31.4, e a única que a decisão do `ACHADO-G12-01` tornou
**obrigatória**: até aqui o normativo dizia que `mod.ban` aceita não-membro e o código
recusava com `E_NOT_FOUND`. Barreira inalterada (`§4 ok — L0:8 L1:6 L2:12 L3:4`, 63
arquivos); suíte do core 683 → **692 testes, 0 falha**.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Ban sem membresia | `core/src/l1/fold/apply.ts` (`banSemMembresia`, chamado por `modBan` quando o alvo não está no `DS`) | R-28, §18.8.1 | linha nasce em `banned` com `roleIds` vazio, `bannedAt`/`bannedBy` e `preBan`; efeitos = `upsert members` (`banned: 1`) + `upsert bans` + `notify` + `audit` |
| Marca `preBan` no `DS` | `core/src/l1/fold/state.ts` (`Member.preBan`) e `core/src/l1/projector/snapshot.ts` (serializa e desserializa) | R-28, §8.1 | round-trip de snapshot preserva a marca e o `serializeDs` é estável |
| `joinedAt` do join posterior | `apply.ts` (`memberJoin`) | R-28, §6.3 | depois de `mod.revokeBan`, a adesão é a do `member.join`, não o instante do ban |
| Alvo sem hierarquia | `core/src/l1/fold/targets.ts` (comentário; nenhuma mudança de comportamento) | §9.3, R-16 | imunidade de Fundador original e host corrente é resolvida **antes** da busca no `DS`, então continua valendo; alvo inexistente simplesmente não tem `topRank` |
| Projeção | nenhuma mudança no `projector` | §8.4 | o `upsert` já materializa a linha; `member_count` é `SELECT COUNT(*)` com `left_at IS NULL AND banned=0`, então o ban preventivo não o move |
| Testes | `test/fold-rules.test.ts` (bloco R-28, 8 casos), `test/projector.test.ts` (projeção + snapshot) | §28.1 | inclui o caso de §18.8.1: o pré-banido tenta reentrar por convite e leva `E_BANNED` |

### 32.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| A linha nasce com `displayName` = fragmento de 8 hex da chave, `avatarColor` 0 e sem `blobsCoreKey` | Não há nome a congelar: §6.13 pede o rótulo do momento da aplicação, e `labelOf` já usa o mesmo fragmento para quem não é membro. Core de blobs só existe para quem publicou um `member.join` |
| Campo `preBan` no `Member`, e não inferência a partir de `state`/`roleIds` | O `fold` é determinístico e o `DS` entra no snapshot: heurística ("banido sem cargo e sem `leftAt`") divergiria entre réplicas na primeira exceção. A marca é explícita, serializada e some no `member.join` seguinte |
| Sem `recount` de `memberCount`, sem `hideMessagesOf` e sem `revokeInvitesOf` no caminho preventivo | §8.4: a população do contador é `left_at IS NULL AND banned = 0` — quem nunca esteve `active` nunca foi contado. Mensagens e convites exigem membresia para existir, então R-10 não tem o que revogar |
| Só o **ban** ganhou forma sem membresia | §8.4.1: `kick`, `timeout` e os dois inversos continuam `E_NOT_FOUND` — expulsar, silenciar ou desfazer sobre quem não está dentro não tem significado |
| `targets.ts` não mudou de comportamento | R-16 é resolvida antes da busca no `DS`, então Fundador original e host corrente seguem inatingíveis; o resto da hierarquia compara `topRank`, que um não-membro não tem. A permissão `ban_members` continua sendo exigida no estágio 13 |

### 32.2 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~Convites de reentrada e reatribuição de cargos~~ | **implementado em 2026-08-22 — §34** | — |
| Superfície de reentradas pendentes (U-18c) | `frontend/`; o dado já sai de `SuccessionService.pendingReentry` | fase de UI da sucessão |

---

## 33. Bans no lote estendido da continuação: implementação em código 2026-08-22

**Gate de entrada:** R-28 no `fold` (§32). É o passo 2 de §31.4 e a metade que faltava da
decisão do `ACHADO-G12-01`: o roster não migra, mas a moderação sim. Barreira inalterada
(`§4 ok — L0:8 L1:6 L2:12 L3:4`, 63 arquivos); suíte do core 692 → **694 testes, 0 falha**.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Bans da origem no lote | `core/src/l2/succession/continuation.ts` — laço final sobre `origin.members` com `state === 'banned'`, um `mod.ban` por alvo | §18.8.1, R-28 | `succession.test.ts`: o banido da origem nasce `banned` na continuação, com `preBan`, fora do roster |
| `bannedTargets` no plano | mesmo arquivo (`ContinuationPlan`) | §18.8 passo 6 | o conjunto rebanido é exatamente o conjunto banido da origem |
| Prova de que a reentrada não lava o ban | `succession.test.ts` | §18.8.1, L-23 | sucessor publica o convite de reentrada, o banido tenta usá-lo e o `fold` REAL recusa com `E_BANNED`; o roster continua com 1 |

### 33.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| A **razão** do ban não migra | §8.1 guarda `bannedAt`/`bannedBy` no `DecisionState`; o texto vive só em `bans.reason` da projeção (§10.3), que o builder não lê. O ban chega sem motivo declarado, e é isso que a auditoria da continuação registra |
| O sucessor nunca é alvo do lote de bans | R-16: ninguém é alvo de `mod.*` sobre si mesmo, e ele é o host corrente da continuação. Se constava banido na origem, quem decide se podia assumir é a camada (b) de R-18, não este lote |
| Os bans entram **depois** da estrutura | Ordem sem efeito no `fold` — `mod.ban` não referencia cargo, categoria nem canal —, mas mantém o lote legível: primeiro o que a comunidade é, depois o que ela recusa |
| `novoMembros` nos testes passou a contar só `active` | A linha em `banned` existe no `DS` por R-28 e **não** é roster: contá-la faria o teste de L-23 medir a coisa errada |

### 33.2 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~Convites de reentrada e reatribuição de cargos~~ | **implementado em 2026-08-22 — §34** | — |
| ~~Superfícies IPC-R da sucessão~~ | **implementadas em 2026-08-22 — §34** | — |
| Superfície de reentradas pendentes (U-18c) | `frontend/`; o dado já sai de `SuccessionService.pendingReentry` | fase de UI da sucessão |

---

## 34. Sucessão ponta a ponta: serviço, superfícies IPC-R e reentrada assistida 2026-08-22

**Gate de entrada:** G12 parcial (§27) mais a decisão do `ACHADO-G12-01` (§31) e as duas
implementações que ela obrigou (§32, §33). Fecha os passos 3 e 4 de §31.4 e o item de
sucessão de §29.2. Barreira `§4 ok — L0:8 L1:6 L2:12 L3:4` (63 → **64 arquivos**); suíte do
core 694 → **708 testes, 0 falha**.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Derivação de §5.3 em código | `core/src/l0/corestore/index.ts` (`deriveCommunityKeyPairs`) | §5.3 | `logKeyPair`/`blobsKeyPair` por `BLAKE2b('ns/log/1' ‖ seed)` e `'ns/blobs/1'`; é o que torna a comunidade recuperável pela semente do escrow |
| Serviço de sucessão | `core/src/l2/succession/service.ts` (`SuccessionService`) | §18.8, §15.4 | designação com escrow, assunção com camada b, reentrada assistida — tudo sobre o `fold` REAL nos dois lados |
| `community.setSuccessors` | `service.ts` + roteador | R-17, §18.8, §15.4 | appenda a lista **e um `community.escrow` por sucessor**; só o alvo abre a semente; não-host → `E_NOT_HOST` sem gastar op |
| `community.assumeHost` | `service.ts` + roteador | R-18, §18.8 | camada b (sucessor, grace period, origem viva) → escrow aberto → par antigo derivado da semente → `planContinuation` → core novo pela porta; devolve `{newCommunityId, seq: 6}` |
| Superfícies no IPC-R | `core/src/l3/ipcRenderer/commands.ts` | §15.3, §15.4 | `setSuccessors` standard, `assumeHost` **main-confirmed** — sem `authToken` o comando nem chega ao serviço; hex fora de forma é `E_VALIDATION` na fronteira |
| Reentrada assistida | `service.ts` (`pendingReentry`, `restoreRolesFor`) | L-23, §18.8.1 | pendentes = ativos da origem que ainda não voltaram; quem volta recupera os cargos por nome; `query.community` ganha `pendingReentry` no normativo |
| Testes | `core/test/succession-service.test.ts` (14 casos) | §28.1 | designação, recusas de R-17/R-18, continuação aplicada pelo `fold` real, reentrada com convite real e a fronteira IPC-R |

### 34.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| Submissão ⏱, criação do core novo e leitura do escrow entram por **porta injetada** | §4 não declara `communityClient` nem `invites` como dependência de `succession`; é o mesmo padrão de `relay` e da ponte de §30. Nenhuma emenda de §4 foi necessária |
| A porta `sealedSeedFor` lê o `wrappedSeed` do **log**, não do `DS` | §8.1 não guarda escrow: `community.escrow` é registro sem efeito no `DecisionState` (o handler do `fold` diz isso explicitamente). Quem precisa dele relê o próprio log |
| `deriveCommunityKeyPairs` mora em `corestore` (L0), não em `succession` | §5.3 é ciclo de vida de core, e `community.create` vai reusar a mesma função quando o caminho de criação entrar. Derivar chave não é decidir o que appendar (§4) |
| A assunção confere que a semente do escrow **reproduz** o `communityId` da origem | Escrow de outra comunidade, ou semente corrompida, produz par que não bate: recusa como `E_SUCCESSION_DENIED` antes de montar plano nenhum |
| `setSuccessors` recusa lista com repetição, com a própria chave do host ou acima de `MAX_SUCCESSORS` | §18.8 fixa o teto de 5 e a ordem como prioridade; sucessor de si mesmo não é sucessão, e repetido desperdiça posição na lista |
| Um escrow que falha interrompe e devolve o `code` | A lista já entrou no log: seguir em silêncio deixaria um sucessor designado e incapaz de assumir. O desfecho é parcial e **nomeado** |
| Cargos da reentrada casam por **nome**, não por id | Ids de entidade são determinísticos por `(kind, coreKey, autor, authorSeq)` (§7.3) e mudam com o core novo. É a mesma correspondência que o lote estendido já usa para categorias e canais duplicados |
| O cargo **Fundador não é restaurado** a quem reentra | Na continuação o fundador é o sucessor (R-27). Devolver as 17 permissões e o `RANK_TOP` a quem tinha o cargo na origem — o host antigo, tipicamente — entregaria a comunidade a quem sumiu por `HOST_INACTIVITY_MS`. Quem quiser esse poder de volta recebe por `member.setRoles` explícito do host novo |
| Reentrada sem nada além do cargo base não vira op | R-3 já dá o base no `member.join`; uma op que só reafirma o base gastaria `authorSeq` e uma entrada de auditoria sem mudar estado |
| Nenhum comando novo de convite | O convite de reentrada é o `invite.create` que §15.4 já define, com `maxUses` do tamanho do conjunto pendente. Inventar superfície fora da tabela seria comportamento fora da spec |

### 34.2 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~Composição das portas de sucessão no produto~~ | **implementado em 2026-08-22 — §35** | — |
| ~~Migração de rail e modo histórico~~ | **implementado em 2026-08-22 — §37** (a descoberta da continuação pelo transporte continua no G12 empacotado) | — |
| ~~`query.community` com `pendingReentry`~~ | **implementado em 2026-08-22 — §37** (recorte com fonte real; campos sem subsistema ficam ausentes) | — |
| Superfície de reentradas pendentes (U-18c) | `frontend/` | fase de UI da sucessão |
| G12 empacotado | Electron/utilityProcess, swarm multi-nó, corrida "host volta durante replicação" | gate empacotado |

---

## 35. Composição das portas de sucessão no produto: implementação em código 2026-08-22

**Gate de entrada:** G12 parcial (§27) com a decisão do `ACHADO-G12-01` (§31) e suas
implementações (§32–§34). Fecha o item 1 de §34.2: as quatro portas de `SuccessionDeps`
deixam de ser implementadas pelo cabo de `succession-service.test.ts` e passam a ser
compostas dos módulos de produto — a ponte de §30, o `corestore`, o log da origem e o
`manifest`. Nenhum módulo novo em `src/`; barreira inalterada (`§4 ok — L0:8 L1:6 L2:12
L3:4`, 64 arquivos); suíte do core 708 → **709 testes, 0 falha**. Harness do G12
rebuildado e reexecutado nos dois perfis (6/6; artefatos locais regenerados).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Fábricas das quatro portas sobre módulos reais | `core/test/helpers/composition.ts` — `manifestCommunitySeedPort`, `logEscrowPort`, `corestoreContinuationCorePort`, `bridgeSubmitSyncPort`; `storeCommunitySeed` semeia a linha hospedada de §5.3 | §5.3, §8.1, §11.1, §18.8 | nenhuma decisão de domínio nelas: delegação, leitura e cifra de repouso |
| Sucessão ponta a ponta com core e view reais | `core/test/integracao.test.ts` ("as quatro portas compostas") | R-17/R-18/R-28, L-23, §18.8 | host designa pela ponte real (`outbox → rpcClient → HostAdmission → hypercore em disco`; o `seq` devolvido é o bloco do core); escrow encontrado no log real só pelo alvo; réplica só leitura interpreta os mesmos blocos; grace period aberto e fora-da-lista recusam antes de criar core; assunção cria a continuação **em disco** pelo `corestore` e o `fold` REAL a interpreta inteira via Projector próprio |

### 35.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| As fábricas das portas moram no cabo de composição (`test/helpers/composition.ts`), não em módulo novo de `src/` | §4 não declara módulo de composição/boot e criá-lo seria emenda arquitetural sem necessidade agora; é o mesmo padrão das juntas da ponte de §30 (`opCodecSignPort`, `rpcHostSubmitPort`). Quando o boot do utilityProcess existir, injeta estas mesmas formas |
| `communitySeed` lê `communities.community_seed_enc/nonce` e decifra com a Data Key (XChaCha20-Poly1305) | §5.3 passo 2 + §5.4: a semente do host mora cifrada no manifest, nunca em claro; linha ausente, sem semente ou cifra inválida → `null` (o serviço traduz para recusa nomeada) |
| `sealedSeedFor` relê o **log** pelo `CoreHandle` (HostRecord → Envelope → Op), mais recente primeiro | §8.1 não guarda escrow no `DS`: `community.escrow` é registro sem efeito no estado, e quem precisa dele relê o próprio log; comunidade que não é este core ou alvo diferente → `null` |
| `createContinuationCore` usa `createCore` **por chave explícita** (`<dir>/<keyHex>`) e appenda o lote inteiro numa chamada; a comunidade nova é registrada por callback | §5.3 item 5 ("cores abertos por chave explícita, nunca namespace aleatório"); §10.7.1 (um append = barreira do grupo); o registro da comunidade nova (Projector próprio, outbox, cliente) é exatamente o que o boot fará ao receber o cabo |
| A réplica do sucessor abre o mesmo log **somente leitura pela chave pública**, depois da instância do escritor fechar | §5.3 item 5: membro abre core por `{key}`, sem par de escrita; hypercore não admite duas instâncias sobre o mesmo storage, e a cópia de arquivos esbarra na proteção `DEVICE_FILE` — a simulação do swarm fica na herança dos blocos, que é o que a réplica tem |
| O `submitSync` do sucessor fica indisponível (`E_HOST_UNAVAILABLE`) até existir rail para a continuação | Migração de rail é o item seguinte de §34.2; inventar escrita na continuação antes dela seria superfície fora do fluxo de §11.1 |

### 35.2 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~Migração de rail e modo histórico~~ | **implementado em 2026-08-22 — §37** (a descoberta da continuação pelo transporte continua no G12 empacotado) | — |
| ~~`query.community` com `pendingReentry`~~ | **implementado em 2026-08-22 — §37** | — |
| Superfície de reentradas pendentes (U-18c) | `frontend/` | fase de UI da sucessão |
| ~~Boot do utilityProcess~~ | **implementado em 2026-08-22 — §44**: as fábricas mudaram-se para `src/composition/ports.ts` e o `bootCore` as consome | — |
| G12 empacotado | Electron/utilityProcess, swarm multi-nó, corrida "host volta durante replicação" | gate empacotado |

---

## 36. Demais superfícies de mensagem no roteador e desfecho por evento: implementação em código 2026-08-22

**Gate de entrada:** nenhum gate específico — item 1 de §30.2, sobre a ponte de §30. Fecha
o eixo otimista de A25 no núcleo: as seis ops do domínio de mensagem têm comando IPC-R, e
o desfecho chega por evento de §15.5 emitido pela reconciliação e pelas transições da
fila. Nenhum módulo novo; barreira inalterada (`§4 ok — L0:8 L1:6 L2:12 L3:4`, 64
arquivos); suíte do core 709 → **712 testes, 0 falha**; harness do G12 reexecutado nos
dois perfis (6/6).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Comandos enfileiráveis restantes | `core/src/l3/ipcRenderer/commands.ts` — `message.edit`, `message.delete`, `message.pin`, **`message.react`**, `thread.create` | §15.4 Mensagens | forma comum (`enfileira`): recorte do DS, coluna Perm., payload direto à ponte, resposta `{opId,state}` |
| `message.retry` / `message.cancelQueued` | mesmo arquivo, via `MessageSurfaceDeps.retryQueued`/`cancelQueued` | §15.4, §11.3 (DS-16), §11.7 (DS-28) | mesmos códigos da outbox na fronteira: `E_NOT_FOUND`, `E_ALREADY_SENT`, `E_AUTHOR_SEQ_OVERTAKEN`; retry reenfileira o MESMO envelope |
| Desfecho por evento | `core/src/l2/outbox/index.ts` — porta `onOutcome` + `resolveTarget` na observação | §15.5, §11.6, DS-31 | `message.accepted{opId, clientRef, messageId, seq, channelId}` emitido **pela reconciliação**; `message.failed{...,terminal}` nas transições para `failed`; `message.dropped{...,reason}` em todo `#drop` |
| Coluna síncrona dos alvos | `core/src/l2/communityClient/submit.ts` (advisory) | §15.4, R-23, R-24 | `E_MESSAGE_DELETED`, `E_CANNOT_EDIT_OTHERS`, `E_REACTION_LIMIT`, `E_THREAD_EXISTS` produzidos do recorte antes de assinar |

### 36.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| O comando é **`message.react`**, não `reaction.set` | Tabela de §15.4: o kind da op e o nome do comando são coisas distintas; nada fora da tabela |
| A advisória ganhou os códigos de alvo da coluna síncrona | §15.4 declara esses erros como síncronos vindos da validação advisória (§8.7); os dados já estavam no recorte do DS (`authorKey`, `deletedAt`, `reactionEmojis`, `threadId`) e passaram a ser declarados nele |
| Alvo **tombado** agora resolve escopo para o canal dele; alvo **inexistente** continua não-resolúvel (`E_VALIDATION.sequenceScope`) | Tombado tem canal conhecido — quem nomeia o desfecho é a advisória com `E_MESSAGE_DELETED`; e `message.delete` sobre tombado atravessa a ponte para o fold aplicar idempotente. Inexistente segue a decisão registrada em §30 |
| Coluna Perm. inteira na fronteira | Mesmo padrão do `message.send` de §30: permissões nomeadas via `memberHasPermission`; "própria \| manage_messages" do delete resolvida no recorte; hierarquia (`E_HIERARCHY`) permanece vinculante só no fold |
| `resolveTarget` mora na porta de observação, não dentro da outbox | §4 não dá `opCodec`/`idgen` à outbox; o envelope assinado é a fonte, e quem fornece a observação decodifica — o boot injeta esta mesma forma (`envelopeTargetResolver`) |
| `dropped` é terminal também para retry/cancelamento | §11.3: "os dois únicos estados terminais são removido ou dropped" — cancelar de novo duplicaria o desfecho; ressuscitar violaria a terminalidade. Ambos passam a responder `E_NOT_FOUND` |
| `E_REACTION_LIMIT` só para reação que **acréscima** emoji | R-23 literal: "que estoure é recusada" — reafirmar emoji presente não aumenta o conjunto e não pode estourar |

### 36.2 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~`community.leave` pela ponte~~ | **implementado em 2026-08-22 — §37** | — |
| ~~`messages.appended` e fan-out completo até a UI~~ | **implementado em 2026-08-22 — §38** (a ligação com o renderer real é do boot) | — |
| ~~Anexo em `message.send` pelo IPC-R~~ | **implementado em 2026-08-22 — §41** (barreira de §13.7) | — |

---

## 37. Saída local, consulta da comunidade e migração de rail: implementação em código 2026-08-22

**Gate de entrada:** nenhum gate específico — fecha os itens restantes de §30.2 (saída),
§34.2/§35.2 (consulta e rail) e §36.2. Barreira inalterada (`§4 ok — L0:8 L1:6 L2:12 L3:4`,
64 arquivos); suíte do core 712 → **715 testes, 0 falha**; harness do G12 reexecutado nos
dois perfis (6/6).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| `community.leave` pela ponte | `core/src/l3/ipcRenderer/commands.ts` + `communityLeavePort` em `test/helpers/composition.ts`; `Outbox.discardForLeave`, `ManifestDb.markCommunityLeft`, `MEMBER_LEAVE_KIND` na ponte | §15.4, exceção única de §11.1, L-22, §11.7 | `{leftLocally, opId, droppedQueued}`; host não sai (`E_HOST_CANNOT_LEAVE`); fila descartada com motivo `'left-community'` e desfecho por evento; a saída sobrevive na fila e é entregue ao host vivo — o roster a registra como `left` |
| `query.community` com `pendingReentry` | `queryCommunityPort` + comando standard no roteador | §15.6 emendado, L-23, U-18c | recorte montado sobre o DS real; `pendingReentry` só existe para continuação **com origem replicada aqui**, e os nomes vêm do roster da ORIGEM |
| Migração de rail e modo histórico | `migrateRail` sobre `dispositionFor` (L2, já existente) | §18.8 passo 5, L-16, S6 | antes do grace → `disputed` e nada entra no cliente; depois → a continuação entra como comunidade ativa e a origem permanece aberta e legível |

### 37.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| A orquestração da saída mora na composição, não em L2 | §4 não dá `manifest` a `communityClient`: a ponte apenas aceita o kind no caminho A (`MEMBER_LEAVE_KIND`), e quem coordena fila, `left_at` e swarm é quem detém as três peças — o boot injeta esta mesma forma |
| O `member.leave` enfileira ANTES do descarte da fila | §11.1: "é enfileirado para que os demais membros vejam a saída" — enfileirar depois do descarte o mataria junto; a ordem é a única leitura coerente com `{opId, droppedQueued}` |
| `discardForLeave` toca só `queued`/`failed` | Mesma finalidade de `E_ALREADY_SENT` (§11.7): não há cancelamento que o host possa cumprir sobre item já entregue; o motivo nomeado é `'left-community'`, que já estava na tabela de descartes |
| `query.community` entrega só os campos com fonte real; os demais ficam AUSENTES | Inventar zeros para `unread`/`notificationLevel`/`hostStatus`/`inactiveDays` seria mentir à UI; cada campo ausente tem subsistema próprio pendente e está registrado abaixo |
| `pendingReentry` é presença condicional, nunca array vazio decorativo | §15.6: "só existe quando a comunidade é continuação (`originCommunityId` presente) e a origem está replicada aqui" — a condição literal define a presença do campo |
| `migrateRail` decide, mas não descobre | A descoberta da continuação (quem entrega o core novo à réplica) é do transporte — G12 empacotado; a porta aplica `dispositionFor` por réplica e, migrando, acrescenta a continuação ao cliente SEM soltar a origem (S6: se o host voltar, ela ainda interpreta cauda) |
| `disputed` volta para quem detém estado de UI | §18.8 passo 4 manda a réplica marcar e NÃO migrar, sem rejeitar registro nenhum; o enum de replicação (§14.5) não ganhou valor novo — inventá-lo seria superfície fora da tabela |

### 37.2 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| Campos restantes de `query.community` | `memberCount`, `unread`, `notificationLevel`, `hostStatus`, `inactiveDays`, `iconEmoji?`, `partialInterpretation` aguardam seus subsistemas (fiação de §6.15 na consulta, DR-29, preferências LS) | fases seguintes |
| Descoberta da continuação pelo transporte | DHT/swarm multi-nó apontando réplicas para a comunidade nova | G7/G8/G12 empacotados |
| Boot do utilityProcess | consumidor das portas desta seção (`communityLeavePort`, `queryCommunityPort`, `migrateRail`) | integração do transporte |
| Superfície U-18c no frontend | o dado já chega via `query.community.pendingReentry` | fase de UI da sucessão |

---

## 38. Evento do lote projetado e fan-out IPC-R: implementação em código 2026-08-22

**Gate de entrada:** nenhum gate específico — item 2 de §36.2. Fecha `DS-31` no núcleo: o
evento de §15.5 passa a ser do **lote projetado**, e existe um único ponto por onde
projector e outbox entram no `IpcServer`. Um módulo novo em L3 (`ipcRenderer/fanout.ts`);
barreira inalterada em módulos (`§4 ok — L0:8 L1:6 L2:12 L3:4`), 64 → **65 arquivos**;
suíte do core 715 → **721 testes, 0 falha**; harness do G12 reexecutado nos dois perfis
(6/6).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Agregação do lote no projector | `core/src/l1/projector/index.ts` — `coalesceBatch`, aplicada na emissão pós-commit | §15.5, §10.5 passo 5, §10.7, DR-27 | um `messages.appended` por canal por lote, `fromSeq` mínimo, `toSeq` máximo, `hasMention` por disjunção; `members.changed`/`roles.changed`/`community.changed`/`message.updated` por união; faixas contíguas e sem sobreposição com `batch: 3` |
| Ordem `messages.appended` → `message.accepted` | mesma emissão: commit de `observed_ops` e `onEvent` no MESMO passo síncrono | §11.6 regra 2, DS-31 | reconciliação antes de projetar não aceita nada; depois do lote aceita, com `seq` observado na réplica, e o fio mostra `messages.appended` antes de `message.accepted` — projector, `view.db`, `manifest.db` e outbox reais |
| Fan-out IPC-R | `core/src/l3/ipcRenderer/fanout.ts` — `EventFanout.fromProjector` / `fromOutbox(communityId)` | §15.1 regras 2 e 5, §15.5 | filtro casa pela **rota**, não pelo payload; `message.accepted` chega à assinatura da comunidade certa sem ganhar `communityId` no dado; filtro que o evento não sabe responder não casa |

### 38.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| Quem agrega o lote é o **projector**, não o `fold` | §8.0: o `fold` vê um registro por vez e não sabe onde o lote termina. §15.5 declara `fromSeq`/`toSeq` e listas — formas de lote. §10.5 passo 5 põe a emissão depois do commit, e é ali que o recorte do lote existe |
| A chave da agregação é o alvo que o próprio payload de §15.5 nomeia (`channelId`, `messageId`), nunca um predicado novo | O projector "não decide nada" (§8.4): a tabela de §15.5 já diz por qual alvo cada evento é indexado. É o "delta agregado do projetor" de `DR-27`, agora com forma |
| Regra de merge fixa: `fromSeq` mínimo, `toSeq` máximo, lista por união, booleano por disjunção | É a única regra que não perde sinal. Evento é sinal para reconsultar (§15.1 regra 5): agregar reduz contagem de sinais, nunca estado — e alivia a janela `IPC_SUB_WINDOW`, que um lote de 256 registros do mesmo canal estouraria |
| `DS-31` fica fechado por **estrutura**, sem gatilho novo de reconciliação | §11.6 lista os três gatilhos da reconciliação (boot, `host.cameBack`, `OUTBOX_RECONCILE_MS`); acrescentar "depois de cada lote" seria superfície fora da spec. A ordem já cai do fato de o commit de `observed_ops` e a emissão estarem no mesmo passo síncrono: nenhuma reconciliação enxerga a op antes do evento do lote que a projetou |
| A comunidade viaja como **rota**, ao lado do payload | §15.5 fixa `message.accepted{opId, clientRef, messageId, seq, channelId}` — sem `communityId`. Acrescentá-lo ao dado para poder filtrar seria inventar superfície; o filtro de §15.1 regra 2 casa contra a rota |
| Filtro que o evento não sabe responder **não** casa | Entregar seria vazar sinal de outra comunidade para uma assinatura recortada. O custo do inverso é um sinal a menos, que §15.1 regra 5 já cobre com `evStale` e requery |
| `EventFanout` recebe a forma estrutural `{topic, data}`, sem importar `ProjectedEvent` | §4 dá a `ipcRenderer` só `L2`: importar o `projector` (L1) quebraria a barreira. A forma comum é estrutural, e é o boot que liga as duas pontas |
| O teste antigo de §10.7 passou a exigir a faixa do lote | Não é ajuste para "fazer passar": a expectativa "um evento por mensagem" era a leitura anterior de §15.5, e a coluna "Dispara: Lote projetado" é o que o teste agora afirma — com faixas contíguas, provando que nenhuma mensagem fica sem sinal |

### 38.2 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~Ligação do fan-out no boot~~ | **implementada em 2026-08-22 — §44**: `bootCore` aponta `Projector.onEvent` e `Outbox.onOutcome` para o mesmo `EventFanout` | — |
| Eventos sem produtor em código | `presence.changed`, `typing.changed`, `unread.changed`, `host.statusChanged`, `swarm.changed`, `community.replication` e os de mídia/blob dependem dos subsistemas correspondentes | fases seguintes |
| `structure.changed` com `channels[]`/`categories[]` | o `fold` emite `{}`; §15.5 declara as duas listas | quando a UI precisar do recorte |
| Consumo no renderer | o mock do `frontend/` não assina IPC-R | fase de UI |

---

## 39. Modo membro de voz e tela: dispatcher remoto sobre §16.2 2026-08-22

**Gate de entrada:** nenhum gate específico — item 1 de §29.2. As superfícies de voz e tela
já estavam atrás de `MediaSurfaceDeps` desde §29, mas só existia o modo host: quem não
hospeda não tinha por onde perguntar. Agora a mesma fronteira tem dois dispatchers, e o
roteador não sabe em qual modo está. Um módulo novo em L3 (`ipcRenderer/media.ts`);
barreira inalterada em módulos (`§4 ok — L0:8 L1:6 L2:12 L3:4`), 65 → **66 arquivos**;
suíte do core 721 → **727 testes, 0 falha**; harness do G12 reexecutado nos dois perfis
(6/6).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| `MediaDispatcher` — uma fronteira, dois modos | `core/src/l3/ipcRenderer/media.ts`; `MediaSurfaceDeps` reduzida a `{dispatcher}` | §15.4, §17.4/§17.5, §4 | os handlers de `voice.*`/`share.*` do roteador deixaram de conhecer `VoiceHostSessions`/`ShareHostSessions`; a suíte de modo host de §29 passa sem mudança de comportamento |
| Dispatcher local (modo host) | `localMediaDispatcher` | §17.4, §17.5 | extração do que já existia no roteador: recorte do DS, identidade local, sessão do roster vivo |
| Dispatcher remoto (modo membro) | `remoteMediaDispatcher` sobre `RpcCallPort` | §16.2, §16.1 | `voice.join`/`leave`/`setSelf` e `share.start`/`join`/`stop` atravessam `RpcClient`↔`RpcServer` reais; a recusa do host chega com o código do catálogo, sem tradução (`E_CHANNEL_NOT_VOICE`, `E_ALREADY_SHARING`, `E_SESSION_GONE`) |
| Estado de sessão client-side (LS) | mesma função, `currentSessionId`/`forgetSession` | §29.2, §15.4, §17.4 | nasce no `voiceJoin`, morre no `voiceLeave`, e some em `E_SESSION_GONE`/`E_HOST_UNAVAILABLE`; sem sessão, `voice.setSelf` recusa **sem** tocar a rede |
| Codec de fio dos tickets | `mediaWire` (mesmo codec nos dois lados) | §16.2, §17.4 | o ticket Ed25519 devolvido por `voiceJoin` é verificado com `verifyMediaTicket` **depois** da travessia — um byte perdido em `peerA`/`peerB`/`sig` reprova |
| Lado host dos métodos de mídia | `wireHostMediaRpc` em `test/helpers/composition.ts` | §16.2 | a identidade do chamador é fechada no registro, por conexão, e nunca lida do corpo do pedido |

### 39.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| O dispatcher é **assíncrono nos dois modos** | Em modo membro cada superfície é um round-trip de §16.2. Se a fronteira fosse síncrona no modo host e assíncrona no membro, a forma de §15.4 mudaria com o modo — que é exatamente o que §29.1 dizia não poder acontecer |
| A porta de RPC é declarada **estruturalmente** (`RpcCallPort`), não importada | §4 não autoriza importação lateral entre módulos de L3 — é a mesma razão pela qual `rpcClient` não importa `rpcServer`. O `RpcClient` satisfaz a forma, e quem monta o grafo injeta |
| A identidade do chamador vem da **conexão**, nunca do corpo | O `RpcServer` é por conexão e é a conexão que autentica o par; ler `memberKeyHex` do pedido deixaria um membro se declarar outro. Fecha a mesma classe de `T-15` que os tickets fecham na mídia |
| `share.stop` viaja como `shareLeave` | §16.2 não tem `shareStop`; §17.5 e o módulo host já dizem que o apresentador que sai encerra a sessão inteira. Usar o método existente é seguir a tabela; acrescentar um método seria mudá-la |
| A sessão local morre também em `E_HOST_UNAVAILABLE` | §16.1 declara que queda e timeout são indistinguíveis para o cliente. Guardar uma sessão cuja existência depende de um host que não responde é afirmar o que não se sabe; o custo de esquecer é um `voice.join` a mais |
| `voice.muteParticipant` e `share.setQuality` **recusam** em modo membro | Nenhum dos dois tem método em §16.2, e `rpcServer` trata a tabela como fechada (recusa registro fora dela). A recusa é `E_UNKNOWN_COMMAND`, que já é a convenção do roteador para superfície não composta nesta instalação — inventar método de RPC ou código de erro seria mudar superfície normativa |
| `share.start` em modo membro devolve `{sessionId}` sem `captureToken` | §16.2 declara a resposta do host como `{sessionId}`; o cliente não fabrica token que o host não mandou. A divergência com §15.4 está na lacuna 3 abaixo |

### 39.2 Lacunas de especificação abertas (§16.2 × §15.4)

> **Fechadas em 2026-08-22 — §40.** As três foram levadas a decisão e o normativo foi
> emendado. A tabela abaixo fica como registro do que estava aberto.

Nenhuma foi contornada em código: as três estão declaradas na fronteira e cobertas por teste
como recusa ou ausência de campo.

| # | Lacuna | Efeito hoje | O que a spec precisa decidir |
|---|---|---|---|
| 1 | `voice.muteParticipant` é comando de §15.4 (`voice_mute_others`) e **não tem método** em §16.2 | em modo membro, `E_UNKNOWN_COMMAND` | L-12 diz que silenciar é conselho ao cliente do alvo, e só o host alcança o alvo: ou §16.2 ganha o método, ou §15.4 declara o comando como exclusivo do modo host |
| 2 | `share.setQuality` é comando de §15.4 (papel espectador) e **não tem método** em §16.2 | em modo membro, `E_UNKNOWN_COMMAND` | §17.5 põe o efeito no `RTCRtpSender` do apresentador, e o pedido do espectador precisa chegar até ele; hoje não há caminho |
| 3 | `shareStart` responde `{sessionId}` em §16.2 e `{sessionId, captureToken}` em §15.4 | em modo membro o campo simplesmente não vem | T-41 exige `captureToken` antes de `getDisplayMedia`; ou §16.2 passa a devolvê-lo, ou §17.4 declara que o token é cunhado localmente para uma sessão que o host já autorizou |

### 39.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~Escolha do modo no boot~~ | **implementada em 2026-08-22 — §44**: `bootCore` escolhe por `manifest.communities.is_host` | — |
| ~~As três lacunas de §39.2~~ | **decididas em 2026-08-22 — §40** | — |
| `voiceTicket` (renovação de §17.4) | o método existe em §16.2, mas §15.4 não tem comando que o acione; a renovação a cada `MEDIA_TICKET_TTL_MS` não tem dono declarado | spec + integração de mídia |
| `voice.signal` | está em §15.4 e em §15.5, sem método em §16.2 e sem implementação; o transporte da sinalização SDP/ICE não está declarado | spec |
| Handlers de mídia em produto no `rpcServer` | hoje o lado host vive no cabo de composição; em produto precisa da cópia com teste de paridade, como a tabela de protocolo | integração do transporte |
| `IpcClient.request` deixa o timer de 30 s sem `clearTimeout` | defeito pré-existente do cliente de teste: cada arquivo de teste que usa IPC-R paga ~30 s de processo vivo depois do último pedido | limpeza de L3 |

---

## 40. As três lacunas de §39.2, decididas: emenda de §16.2 e do §17.4 2026-08-22

**Gate de entrada:** nenhum gate específico — §39.2. Autorização explícita para emendar o
normativo, com a condição de que cada mudança se sustente como decisão de engenharia.
Barreira inalterada (`§4 ok — L0:8 L1:6 L2:12 L3:4`, 66 arquivos); suíte do core 727 →
**729 testes, 0 falha**; harness do G12 reexecutado nos dois perfis (6/6).

Duas das três viraram método novo em §16.2; a terceira **não** virou campo novo — virou uma
clarificação que tornou o campo desnecessário no fio. É a diferença que importa: só se
acrescenta superfície quando não existe leitura coerente sem ela.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| §16.2 ganha `voiceMute` | `docs/backend-v2.md` §16.2; as duas cópias da tabela de protocolo (`rpcClient`, `rpcServer`) | §16.2, §15.4, §17.4 L-12 | `voice.muteParticipant` atravessa em modo membro e o efeito é a marca no roster do host; sem sessão local não sai da máquina (`E_SESSION_GONE`); o teste de paridade das duas tabelas cobre a adição |
| §16.2 ganha `shareQuality` | idem | §16.2, §15.4, §17.5 | `share.setQuality` do espectador atravessa e o perfil fica registrado no host — que é de onde `share.health` tira o `quality` por espectador |
| §17.4: `captureToken` é capacidade **local** | `docs/backend-v2.md` §17.4; `remoteMediaDispatcher`/`localMediaDispatcher` | §17.4 `T-41`, §15.7, §16.2 | o token é cunhado no núcleo do apresentador quando o host autoriza a sessão; `capture.authorize{sessionId}` resolve contra o estado local; `share.stop` encerra a capacidade junto com a sessão |

### 40.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| `voiceMute{sessionId, targetKey, muted}` é método próprio, e não uma extensão de `voiceState` | `voiceState` é sobre **si mesmo** e não tem alvo; sobrecarregá-lo com um `targetKey` opcional faria um método com duas autorizações diferentes (nenhuma × `voice_mute_others`) — a pior forma de esconder uma decisão de permissão | §15.4 já separa `voice.setSelf` de `voice.muteParticipant`; o transporte espelha a separação que a superfície tem |
| O silenciamento **não** ganhou evento novo | O efeito de L-12 é uma marca no roster, e o roster já é emitido: `voice.roster{participants[]}` carrega `muted` por participante | §15.5 já tem o canal; acrescentar um `voice.muted` seria um segundo caminho para o mesmo fato — e dois caminhos divergem |
| `shareQuality{sessionId, quality}` é método próprio | O pedido do espectador precisa chegar ao host, que é quem conhece a sessão e quem autoriza. Não há caminho espectador→apresentador no v1 fora do host | §15.4 declara `share.setQuality` com papel de espectador e resposta `{applied}`; o método é o transporte disso, sem semântica nova |
| A qualidade pedida **não** ganhou evento novo | `share.health` já é emitido só ao apresentador e já carrega `quality` por espectador — verificado no código: `health.ts` monta cada entrada a partir do perfil corrente da sessão, que é o que `setQuality` escreve | §15.5 (`share.health`) + §17.5 ("cada `RTCRtpSender` tem seu próprio `setParameters`"): o laço fecha sem superfície nova |
| O `captureToken` **não** entra na resposta de `shareStart` | Ele é verificado pelo mesmo processo que o emitiria — trafegá-lo é expor um segredo que nenhum dos dois lados usa como prova. `capture.authorize` (§15.7) carrega só `{sessionId}`: o token nunca sai do núcleo, nem em modo host | §15.7 é a evidência textual: se o token fosse prova de rede, a mensagem que decide a captura o levaria. Ela não leva |
| A propriedade de `T-41` continua inteira | O que `T-41` exige é "não capturar sem autorização do host". Cunhar localmente **no instante** em que o host autoriza preserva isso: sem autorização não existe sessão, e sem sessão não existe token — a condição necessária é a mesma | §17.4: a ordem `share.start → host autoriza → captureToken → getDisplayMedia` fica literal; o que muda é só quem assina o token, e ele nunca foi verificado pelo host |
| A regra do token passou a ser **a mesma nos dois modos** | Em modo host o processo que cunha já era o que verifica; a emenda estende a regra ao modo membro em vez de criar um segundo desenho para o mesmo gate. Um caminho, um teste, uma falha possível | §17.4 emendado |
| A capacidade de captura morre com a sessão | Um token que sobrevive à sessão é uma autorização de captura órfã — o pior resultado possível para o gate que `T-41` existe para fechar | §17.5: `share.stop` encerra a sessão e revoga os espectadores; a capacidade local segue o mesmo tempo de vida |

### 40.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §16.2 | duas linhas novas na tabela de métodos (`voiceMute`, `shareQuality`) e uma nota de emenda datada, dizendo o que **não** precisou de superfície nova |
| `docs/backend-v2.md` §17.4 | parágrafo de emenda datado sob `T-41`: o `captureToken` é capacidade local, não segredo de rede; a resposta de `shareStart` em §16.2 permanece `{sessionId}` |

Nenhuma outra seção mudou. §15.4 não precisou de emenda: os três comandos já estavam lá com
a forma que agora é implementável nos dois modos.

### 40.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~`voiceTicket` (renovação de §17.4)~~ | **decidido em 2026-08-22 — §42**: o dono é o núcleo | — |
| ~~`voice.signal`~~ | **decidido em 2026-08-22 — §42**: o host encaminha (`voiceSignal`) | — |
| ~~Handlers de mídia em produto no `rpcServer`~~ | **implementado em 2026-08-22 — §42** | — |
| `capture.authorize` no `ipcMain` | o dispatcher já responde; falta a mensagem de §15.7 chegar nele | fase do processo main |

---

## 41. Anexos, download e impacto de saída no roteador 2026-08-22

**Gate de entrada:** nenhum gate específico — último item de §29.2 e o de §36.2 sobre anexo.
As seis superfícies de arquivo de §15.4 entram no roteador, e `message.send` ganha a
barreira de §13.7. Nenhum módulo novo; barreira inalterada (`§4 ok — L0:8 L1:6 L2:12 L3:4`,
66 arquivos); suíte do core 729 → **741 testes, 0 falha**; harness do G12 reexecutado nos
dois perfis (6/6).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| `file.pickForAttachment` e `blob.stage` | `core/src/l3/ipcRenderer/commands.ts` + `blobAttachmentPort` em `test/helpers/composition.ts` | §15.4, §13.2, §15.7 | sai ticket, entra ticket: nada que pareça caminho de arquivo atravessa o IPC-R; o `hash` do staging é o BLAKE2b do conteúdo real em disco |
| Barreira blob ↔ mensagem | mesmo arquivo; `BlobManager.stagedResult` | §13.7 regra 1 | `message.send` com anexo antes do staging → `E_BLOB_NOT_STAGED`, e nada é enfileirado; ticket inventado pelo renderer idem |
| `blob.download` / `blob.cancel` / `blob.reveal` | roteador + porta | §13.4, §13.6, §15.3 | `{state}` na hora e progresso por evento; argumento malformado é `E_VALIDATION` antes de qualquer decisão; executável não é revelável nem depois de baixado |
| `host.exitImpact` | roteador + `hostExitImpactPort` | §15.4, §18.7, U-06 | informa por comunidade; não avisa ninguém e não bloqueia a saída |
| `E_BLOB_NOT_STAGED` no catálogo | `docs/backend-v2.md` §20.2; `core/src/l1/errors/codes.ts` | §20.2, §13.7 | o teste de paridade relê §20.2 do normativo: 87 → **88 códigos** |
| `file.pick` em §15.7 | `docs/backend-v2.md` §15.7 | §15.7, §15.4 | a metade que faltava do par: o núcleo pede, o main abre o diálogo, `staging.ticket` volta |

### 41.1 Decisões de implementação registradas

| Decisão | Justificativa normativa |
|---|---|
| `message.send{attachment}` leva **só `{ticketId}`** | §15.4 escreve `attachment?` sem fixar a forma, e §13.7 diz que a barreira é o `blob.stage` ter completado. Quem sabe o que foi escrito é o núcleo: deixar o renderer declarar `blobsCoreKey`/`hash`/`sizeBytes` permitiria apontar a mensagem para qualquer blob do mundo — o mesmo risco que `blob.stage` já fecha ao recusar caminho vindo do renderer (`T-16`, `DR-37`). Campos extras no argumento são ignorados, e há teste para isso |
| `E_BLOB_NOT_STAGED` entrou no catálogo em vez de virar `E_VALIDATION` | §13.7 regra 1 é uma recusa nomeada de ordem, não de forma. O código já era lançado por `blobs` (L2) sem estar em §20.2 — a divergência estava no normativo, não no módulo. §20.2 é fonte única e agora o é de verdade |
| `stagedResult` é memória **em processo**, não coluna nova | `local_blob_staging` (§13.5) guarda o que a retomada precisa; `blobsCoreKey`/`blobId` ligam ticket a blob e só existem depois do `put`. Acrescentar coluna custaria bump de schema para um dado cuja perda tem desfecho correto: sem ele a mensagem recusa e a UI reencena o `blob.stage` |
| A classe de `blob.reveal` é decidida **no handler**, pelo tipo do blob | §15.3 escreve literalmente "`blob.reveal` de `archive`" na linha `main-confirmed`: a classe depende do dado, e o tipo só se conhece olhando o blob. `IpcServer.requireConfirmation` expõe o mesmo caminho de token que a classe estática usa — não há segunda porta de confirmação |
| `blob.download` resolve `name`/`sizeBytes`/`hash` da projeção, não do argumento | §15.4 manda só `{communityId, blobsCoreKey, blobId}`, e §13.4 passos 5–6 precisam do tamanho declarado e do hash para abortar e verificar. Esses são fato da mensagem projetada; aceitar do renderer seria deixá-lo desligar a verificação |
| `file.pick` foi acrescentado a §15.7 em vez de improvisado na composição | §15.4 diz "o main abre o diálogo" e §15.7 só tinha a volta (`staging.ticket`). Os outros dois casos da mesma tabela (`capture.*`, `exit.*`) já são pares pedido/resposta: a emenda usa a forma que a tabela já tinha |
| Anexar exige `attach_files` **além** de `send_messages` | §7.4 linha de `message.send`: "`send_messages` (+`attach_files` se anexo)" |

### 41.2 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| Eventos de blob | `blob.progress`, `blob.completed`, `blob.peerLost`, `blob.unavailable`, `attachment.corrupt` precisam sair do `BlobManager` para o fan-out de §38 | integração de blobs |
| `blobs` com hyperblobs real | o módulo grava em disco e deriva `blobIdHex` do hash; o `blobId` de §7.2.1 só ganha significado com o hyperblobs de verdade | fase de blobs |
| Cota de anexo na fronteira | `E_QUOTA_EXCEEDED` de §15.4 depende de `storage_used_bytes` do DS na hora do `blob.stage` | integração da cota |
| `file.pick`/`staging.ticket` no `ipcMain` | a porta existe e a mensagem está em §15.7; falta o módulo do main | fase do processo main |

---

## 42. Sinalização, renovação de ticket e os handlers de mídia em produto 2026-08-22

**Gate de entrada:** nenhum gate específico — as três pendências de §40.3. Duas eram lacunas
de dono ("existe o mecanismo, falta quem o opere"); a terceira era dívida de arrumação. Um
módulo novo em L3 (`rpcServer/media.ts`); barreira inalterada em módulos
(`§4 ok — L0:8 L1:6 L2:12 L3:4`), 66 → **67 arquivos**; suíte do core 741 → **747 testes,
0 falha**; harness do G12 reexecutado nos dois perfis (6/6).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| §16.2 ganha `voiceSignal`; o host encaminha | `docs/backend-v2.md` §16.2; `registerHostMediaMethods`; `voice.signal` no roteador | §16.2, §15.4, §15.5, §17.4 | a origem do sinal é a da **conexão**, não algo que o remetente declare; par fora da chamada é `E_PEER_UNREACHABLE`; host sem relay composto recusa em vez de fingir entrega |
| A renovação de ticket é do núcleo | `docs/backend-v2.md` §17.4 e §15.5 (`voice.tickets`); `VoiceTicketRenewer` | §17.4, §26.2, §15.1 regra 5 | o ciclo renova por par e empurra tickets **verificáveis** com `verifyMediaTicket`; fora de chamada é no-op; depois do `voice.leave` volta a ser no-op |
| Handlers de mídia em produto | `core/src/l3/rpcServer/media.ts` (era cabo de composição) | §16.2, §4 | o cabo virou um atalho de três linhas sobre o módulo de produto; toda a suíte de modo membro passou sem mudança de expectativa |
| Codec de fio com teste de paridade | `mediaWire` (cliente) × `mediaWireServer` (servidor) | §4, §29.1 | as duas cópias codificam o ticket byte a byte igual, e cada uma decodifica o que a outra codificou de volta ao original |

### 42.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| A sinalização é **encaminhada pelo host**, não trocada par-a-par | Antes de o ICE fechar não existe canal direto entre os dois membros — é justamente o que a sinalização serve para abrir. Quem tem conexão com os dois é o host | §17.2 (o host já é par da comunidade) e §17.4 passo 3 (quem recebe exige ticket válido para o par, e só o host emite ticket) |
| O host **encaminha sem ler** | Um host que interpretasse SDP passaria a ter opinião sobre a mídia, e a promessa de §17.2 é que ele nunca a vê | §17.2: DTLS-SRTP é negociado entre os pares; o relay é cego por propriedade do protocolo, não por promessa |
| `E_PEER_UNREACHABLE` é a recusa quando não há relay ou o destino não está na chamada | O código já existia em §20.2 com o significado "sinalização não chegou" — que **só faz sentido se alguém encaminha**. A emenda torna verdadeira uma linha que já estava lá | §20.2, §15.4 (o comando já declarava este erro) |
| A origem do sinal vem da **conexão**, nunca do corpo | Deixar o remetente declarar `fromPeerKey` permitiria personificar qualquer membro na sinalização — a mesma classe de `T-15` que os tickets fecham | §16.1: o `RpcServer` é por conexão, e é ela que autentica o par |
| A renovação de ticket é do **núcleo**, e §15.4 **não** ganha comando | Um renderer que esquecesse o temporizador perderia a sessão em silêncio, com sintoma a 5 minutos de distância da causa. Prazo é invariante da sessão, não intenção do usuário | §26.2 declara a cadência sem dono; §15.4 é a tabela de **intenções do usuário**, e renovar não é uma |
| A entrega é por evento novo (`voice.tickets`), com `voice.join` como reconsulta | §15.1 regra 5 exige que evento perdido nunca vire estado errado. `voice.join` no mesmo canal "devolve a sessão existente" com material fresco — a reconsulta já existia | §15.1 regra 5, §15.5, e o caminho de renovação que `voiceJoin` já era |
| Falha de renovação **não** emite evento | O ticket velho continua valendo até expirar e a próxima volta tenta de novo; anunciar "renovou" sem ticket seria mentir à UI. Um par que perdeu elegibilidade simplesmente para de renovar, e expira em `MEDIA_TICKET_TTL_MS` — que é a rede de segurança da revogação | §17.4: "o ticket expirado deixa de ser renovado, então mesmo um cliente que ignore o evento perde a sessão em ≤ `MEDIA_TICKET_TTL_MS`" |
| O relógio do renovador é **injetado** | Temporizador dentro do roteador é intestável; com `schedule`/`cancel` injetados, o ciclo é exercitado passo a passo e o teste não espera cinco minutos | §28.1 (nada de relógio de parede no que é testado) |
| O codec de fio é duplicado, com teste de paridade — não extraído para L2 | §4 não declara importação lateral entre módulos de L3 e a barreira quebra o build; empurrar um codec de transporte para L2 seria mover a fronteira para acomodar a ferramenta | §29.1: é exatamente o precedente da tabela de protocolo entre `rpcClient` e `rpcServer` |

### 42.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §16.2 | linha nova `voiceSignal` e nota de emenda datada explicando por que o host é o relay e por que ele não lê |
| `docs/backend-v2.md` §15.5 | evento novo `voice.tickets{communityId, sessionId, tickets[]}` |
| `docs/backend-v2.md` §17.4 | parágrafo de emenda datado: a renovação é do núcleo, e por que §15.4 não deve ter comando para ela |

### 42.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~A outra ponta do `voiceSignal`~~ | **implementada em 2026-08-22 — §43**: §16.3 dá a direção host → membro | — |
| ~~`voice.tickets` até o renderer~~ | **implementado em 2026-08-22 — §43**: `startMediaRuntime` | — |
| ~~Escolha do modo no boot~~ | **implementada em 2026-08-22 — §44** | — |

---

## 43. §16.3 — a direção host → membro, e o runtime de mídia 2026-08-22

**Gate de entrada:** nenhum gate específico — as duas pendências de §42.3. As duas eram a
mesma falta vista de dois ângulos: **§16 só tinha pedido/resposta**, e §15.5 está cheia de
eventos que só o host pode conhecer. Sem a direção host → membro, quem não hospeda nunca
receberia roster, revogação, sinalização ou estado de tela — e a sinalização, recém-decidida
em §42, chegava ao host e parava ali. Um módulo novo em L3 (`rpcServer/media.ts` já existia;
o runtime entrou em `ipcRenderer/media.ts`); barreira inalterada
(`§4 ok — L0:8 L1:6 L2:12 L3:4`, 67 arquivos); suíte do core 747 → **755 testes, 0 falha**;
harness do G12 reexecutado nos dois perfis (6/6).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| §16.3 — notificação host → membro | `docs/backend-v2.md` §16.3; `RpcServer.notify`, `RpcClient.onNotify` | §16.3, §16.1, §15.1 regra 5 | tabela fechada com paridade entre as duas cópias, e um segundo teste que confere que **todo** tópico de §16.3 é um evento de §15.5 de mesmo nome; tópico desconhecido é descartado e a conexão continua servindo pedidos |
| Relay real da sinalização | `peerSignalRelay` em `core/src/l3/rpcServer/media.ts` | §16.2 `voiceSignal`, §16.3, §17.4 | dois membros contra o mesmo host: o SDP sai de um e chega ao outro **pela conexão dele**, com `peerKey` igual à origem da conexão; sem conexão para o destino, `E_PEER_UNREACHABLE` |
| Gate de ticket na entrada | `signalIsAuthorized` | §17.4 passo 3, §16.3 regra 5 | passa só o par com ticket verificável para `(sessionId, esteParDeChaves)`; não passa fora de chamada, nem par estranho, nem o próprio, nem depois de `MEDIA_TICKET_TTL_MS` |
| `startMediaRuntime` — o que o boot liga | `core/src/l3/ipcRenderer/media.ts` | §17.4 emendado, §16.3, §15.5, §38 | cadência de renovação + entrada de notificações desaguando no fan-out, com relógio injetado; `voice.revoked` sobre a própria identidade derruba a sessão local sem round-trip |
| `observeRoster` | `MediaDispatcher` | §16.3 `voice.roster`, §17.4 | um par que entra depois passa a ter ticket na renovação seguinte — sem isso, dois membros que não entraram juntos nunca se autorizariam |

### 43.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| A direção host → membro é uma **segunda forma de quadro no mesmo canal**, não um protocolo novo | Um segundo canal duplicaria autorização, teto de frame, reconexão e circuit breaker — quatro coisas que §16.1 já define uma vez. O quadro sem `id` é a diferença mínima que expressa "não espera resposta" | §16.1 declara **um** canal por comunidade, chaveado pelo `coreKey`; a autorização de §14.3 já vale para ele |
| Entrega **at-most-once**, sem ACK e sem retentativa | ACK e retentativa numa direção cujo conteúdo é sinal só criariam fila e ordem para reconstruir — e §15.1 regra 5 já garante que evento perdido nunca vira estado errado, porque cada tópico tem uma consulta que o reconstrói | §15.1 regra 5; e é a mesma garantia que `DS-30` pedia que fosse declarada para `presence`/`typing`, agora válida para a direção inteira |
| A tabela de tópicos é **fechada**, e desconhecido é descartado em silêncio | Um host mais novo empurrando um tópico futuro não pode derrubar a conexão de um cliente velho | Mesma regra de §7.2 para `kind` desconhecido |
| Notificação que não cabe no teto **não é enviada**, e quem a produziu sabe | Fatiar sinal exigiria remontagem e ordem — estado novo no transporte para um dado que é descartável por desenho. `notify` devolve `false` em vez de fingir | §16.1: o teto de frame vale para o canal, não para uma direção |
| Em `voice.signal` a origem é a da **conexão** | Deixar o remetente declarar `peerKey` permitiria personificar qualquer membro na sinalização, que é a porta de entrada da mídia | §16.1 (o `RpcServer` é por conexão) e `T-15` |
| O ticket é verificado **no núcleo receptor**, não no renderer | O núcleo já tem o ticket do par e a chave do host; o renderer é a camada que fala WebRTC, e sinalização não autorizada não deve chegar até lá. Falha fechada: sem material, nada passa | §17.4 passo 3 — "o cliente SÓ aceita sinalização de um par que apresente ticket válido"; §16.3 regra 5 torna explícito **qual** cliente |
| `observeRoster` existe porque a renovação precisa saber de par novo | `voiceJoin` devolve o roster do instante da entrada. Quem entrou primeiro nunca teria ticket para quem entrou depois, e os dois ficariam eternamente sem se autorizar — um bug que só aparece com três pessoas e ordem de entrada específica | §16.3 `voice.roster` é a única fonte disso em modo membro |
| `voice.revoked` sobre a própria identidade derruba a sessão local | §17.4 manda o cliente fechar **imediatamente**; esperar o round-trip seguinte é manter viva uma sessão que o host já encerrou | §17.4, revogação |
| O runtime existe como peça, e não como código no boot | O boot do utilityProcess ainda não existe, e esta ordem — renovar, receber, filtrar, emitir — não pode ser redescoberta por comunidade. Com relógio e transporte injetados, ela é testável sem processo, sem socket e sem esperar cinco minutos | §4 (quem monta o grafo injeta) e §28.1 |

### 43.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §16.3 | seção nova: tabela fechada de notificações host → membro, com as cinco regras (at-most-once; tabela fechada e descarte silencioso; teto de frame; origem da conexão; ticket verificado por quem recebe) |

### 43.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~Produtores de `presence.changed` / `typing.changed`~~ | ~~os tópicos estão em §16.3, mas os handlers de `presencePublish`/`subscribeChannel` no `rpcServer` continuam sem produto~~ **implementado em 2026-08-23 — §54**: handlers no host sobre o `PresenceManager`, com os tetos de §17.6 e fan-out por assinatura | — |
| ~~`share.*` empurrado pelo host~~ | **implementado em 2026-08-22 — §44**: `onSessionEvent` do `ShareHostSessions` desagua em `notify` pelas conexões vivas | — |
| ~~Registro de conexões vivas~~ | **implementado em 2026-08-22 — §44**: `CoreRuntime.attachMemberConnection` mantém o mapa conexão↔membro | — |
| ~~Escolha do modo no boot~~ | **implementada em 2026-08-22 — §44** | — |

---

## 44. O boot do `utilityProcess` — a raiz de composição 2026-08-22

**Gate de entrada:** nenhum gate específico — as seis linhas de pendência que apontavam para
o boot (§35.2, §37.2, §38.2, §39.3, §42.3, §43.3). Todas as peças existiam e estavam
testadas; faltava o processo que as liga. Um diretório novo **fora da pilha de camadas**
(`core/src/composition/`, 2 arquivos); barreira inalterada em módulos e com regra nova
(`§4 ok — 69 arquivo(s), L0:8 L1:6 L2:12 L3:4 + raiz de composição (2 arquivo(s))`); suíte
do core 755 → **765 testes, 0 falha**; harness do G12 rebuildado e reexecutado nos dois
perfis (6/6).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Raiz de composição declarada e verificada | `docs/backend-v2.md` §4 (emenda); `core/scripts/check-layers.ts` | §4 | a raiz importa qualquer módulo; **módulo de camada que a importe quebra o build** com mensagem própria (verificado ligando o import e vendo a violação) |
| As juntas de produto saíram do cabo de teste | `core/src/composition/ports.ts` — 21 exports: 20 mudadas do cabo de teste (de `opCodecSignPort` a `migrateRail`) e `hostRecordSigner`, nova | §4, §35.1, §36.1, §41 | `test/helpers/composition.ts` reexporta o arquivo e ficou só com a metade simulada (`MemoryRpcChannel`, `swarmNatProbe`, `UdpStunProbe`, `tempDir`); os 755 testes anteriores passam sem alteração |
| `bootCore` / `CoreRuntime` | `core/src/composition/boot.ts` | §3.3 fases `open`…`host-mode`, §4 | 10 testes novos em `core/test/boot.test.ts`, todos sobre as **ligações**, não sobre as peças |
| Fan-out dos dois produtores | `Projector.onEvent = fanout.fromProjector`; `Outbox.onOutcome = fanout.fromOutbox(cid)` | §38.2, §15.5, DS-31 | append no core → `messages.appended{fromSeq,toSeq,channelId}` no renderer; `submitQueued` → flush → reconciliação → `message.accepted`, **depois** do lote |
| Escolha do modo de mídia por comunidade | `is_host` da linha de `manifest.communities` decide entre `localMediaDispatcher` e `remoteMediaDispatcher` | §42.3, §43.3, §10.2 | quem hospeda tem `mode:'host'`, `host ≠ null` e **nenhum** canal de §16.1; quem não hospeda tem `mode:'member'`, `host === null` e `RpcClient` |
| `startMediaRuntime` por comunidade, com relógio real | `bootCore` passa `setInterval`/`clearInterval` e `MEDIA_TICKET_TTL_MS/3` | §17.4 emendado, §26.2 | o temporizador registrado é exatamente `MEDIA_TICKET_TTL_MS/3` |
| Mapa conexão↔membro | `CoreRuntime.attachMemberConnection` / `.detach()`; `peerSignalRelay` lê dele | §43.3, §16.3 regra 4 | dois membros no mesmo host: o SDP sai de um e chega ao outro com `peerKey` igual à origem da conexão; conexão que sai do mapa vira `E_PEER_UNREACHABLE` |
| Push do host: roster, revogação e `share.*` | `onRosterChanged`/`onRevoked` de `VoiceHostSessions` e `onSessionEvent` de `ShareHostSessions` → `RpcServer.notify` nas conexões vivas | §16.3, §15.5, §17.5 | quem não está na chamada **não** recebe o roster |
| Portas de sucessão, saída e consulta | `SuccessionService` composto; `communityLeavePort`, `queryCommunityPort`, `migrateRail` no roteador | §35.2, §37.2, §15.4, §15.6 | `query.community` responde sobre o DS real; `community.leave` marca `left_at` e fecha a comunidade no runtime; o host recusa com `E_HOST_CANNOT_LEAVE` |
| `projector.start()` no boot | `bootCore`, logo após `projector.boot()` | §10.5 passo 6 | sem esta linha o núcleo interpreta o log do boot e fica surdo a `append` — foi o primeiro defeito que o teste do fan-out pegou |
| Reconciliação de boot | `outbox.recoverOnBoot()` por comunidade | §3.3 `reconcile`, §11.6 | `sending` sem desfecho volta a `queued` sem consumir tentativa |

### 44.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| A composição mora **fora** de `src/l*/`, não num módulo `boot` em L3 | Um módulo de L3 com "Depende de: tudo" não é uma linha da tabela de §4 — é a negação dela, e o lint não teria o que verificar. Fora da pilha, há exatamente uma regra a verificar, e ela é a que protege a arquitetura | §4 emendado: a raiz importa qualquer módulo; **nenhum módulo de camada pode importá-la**, com mensagem própria no lint |
| A regra nova é **na direção contrária** das demais | Todas as fronteiras de §4 limitam o que um módulo pode importar. A da raiz limita quem pode importá-la: sem isso, um módulo pegaria uma implementação pronta e a injeção viraria acoplamento com um passo a mais | §4, "quem monta o grafo injeta a implementação no boot" — a injeção é a direção, não um detalhe de estilo |
| O transporte chega **injetado**, e o boot nunca abre socket | É a costura que a fase seguinte (protomux-rpc sobre Hyperswarm, probe NAT do HyperDHT) preenche sem tocar em nada abaixo dela. `attachHostChannel` e `attachMemberConnection` recebem `RpcTransportPort` pronto | §4 (L3 implementa o transporte, a composição injeta) e §16.1 (um canal por comunidade, chaveado pelo `coreKey`) |
| O `MediaRouter` roteia por comunidade sobre um dispatcher só | §15.4 dá ao roteador **um** `MediaDispatcher` e §15.4 `voice.leave` declara que "voz é uma só". As duas coisas juntas definem o objeto: `voiceJoin` fixa a comunidade corrente, e todo comando sem `communityId` vai para a fixada | §15.4, §17.4 |
| `share.*` endereça por `sessionId`, que não nomeia comunidade — o mapa `sessionId → comunidade` é alimentado pelos eventos | Um espectador manda `shareJoin` de uma sessão que ele não abriu: o único lugar onde ele soube dela é o `share.started` de §16.3, que passa pelo runtime de mídia. Sem registro, cai na comunidade da chamada corrente — a única em que §17.5 permite que exista tela | §17.5 (a tela vive dentro de um canal de voz), §16.3 |
| `outboxDe` acha a fila pela linha em `local_outbox`, não varrendo as comunidades | §15.4 manda só o `opId` em `message.retry`/`message.cancelQueued`, e §11.2 dá uma fila por comunidade. A linha do manifest **é** o índice; varrer tocaria filas de outras comunidades para responder sobre uma | §11.2, §15.4, §10.2 |
| Comunidade com `left_at` não é aberta, e `community.leave` a fecha no runtime | §3.3 fase `open` diz "para cada comunidade **listada em `manifest.communities`**", e §11.1 (exceção) faz da saída um efeito local imediato. Deixar a comunidade aberta depois da saída manteria projector, fila e mídia vivos sobre algo de que já se saiu | §3.3, §11.1, L-22 |
| Core ilegível não derruba o boot: vira `host.statusChanged{degraded}` daquela comunidade | É literalmente o que a tabela de §3.3 manda, e é a diferença entre uma comunidade quebrada e um núcleo que não abre | §3.3 fase `open`: "Core ilegível → `degraded` só naquela comunidade; as outras seguem" |
| `hostRecordSigner` entrou na raiz, e não em `communityHost` | §4 não dá `opCodec` a `communityHost`, e a chave de escrita do core é derivada da semente que só o boot lê (§5.3/§5.4). Quem constrói o material assinável e quem tem a chave é quem monta o grafo | §4, §7.1, §11.4 |
| A metade simulada continua em `test/helpers/composition.ts`, que reexporta a de produto | A fronteira entre "junta de produto" e "simulação de teste" fica visível no import, e nenhum rig existente precisou mudar | §28.1 (o transporte simulado é do teste, as decisões são dos módulos reais) |

### 44.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §4 | linha `composition` no diagrama e na tabela de módulos (camada `—`, "Depende de: qualquer módulo", "Não pode: ser importada por qualquer módulo de camada"); parágrafo de emenda datado com as três regras da raiz de composição e a alternativa recusada (módulo `boot` em L3) |

### 44.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~Transporte real~~ | **implementado em 2026-08-22 — §45**: `Hyperswarm` + `protomux` alimentando as duas costuras, com replicação do hypercore no mesmo mux. Probe NAT do HyperDHT e descoberta da continuação pela DHT continuam abertos (§45.3) | — |
| ~~Produtores de `presence.changed` / `typing.changed`~~ | ~~os tópicos estão em §16.3 e o push do host já existe para roster/revogação/tela; faltam os handlers de `presencePublish`/`subscribeChannel` no `rpcServer`~~ **implementado em 2026-08-23 — §54** | — |
| ~~`Diagnostics`, `BlobManager` e `RelayVolunteer` chegam injetados~~ | **BlobManager saiu da lista em 2026-08-22 — §47**: construído no boot sobre o layout de §10.1, com os cores locais por comunidade. `Diagnostics` (sonda de NAT) e `RelayVolunteer` (consentimento) continuam chegando prontos | fase de mídia pela rede |
| ~~Ciclo de vida do processo~~ | ~~lock composto de §10.8, wipe-resume de §18.6, `identity` pelo IPC-M e `draining` de §3.3 continuam no shell de `app/src/utility/index.ts`, hoje stub~~ **implementado em 2026-08-23 — §56**: o utility roda o `bootCore` de verdade sobre as duas portas cruzadas pelo main, com lock flock, retomada de wipe antes de abrir banco, Data Key por IPC-M e draining no quit | — |
| `IpcClient.request` deixa o timer de 30 s sem `clearTimeout` | defeito pré-existente do cliente de teste (registrado desde §39.3); `test/boot.test.ts` não usa `IpcClient` por causa dele | limpeza de L3 |

---

## 45. O transporte real de §14 e §16.1 — Hyperswarm e protomux 2026-08-22

**Gate de entrada:** nenhum gate específico — o primeiro item de §44.3. O boot deixou duas
costuras abertas (`attachHostChannel`, `attachMemberConnection`) e disse que nunca abriria
socket; esta fase é quem abre. Um arquivo novo em L0 (`swarm/hyperswarm.ts` + `swarm/ports.ts`),
um em L3 (`rpcServer/protomux.ts`) e um na raiz de composição (`transport.ts`); barreira
inalterada em módulos (`§4 ok — 73 arquivo(s), L0:8 L1:6 L2:12 L3:4 + raiz de composição
(3 arquivo(s))`); suíte do core 765 → **768 testes, 0 falha**; harness do G12 reexecutado
nos dois perfis (6/6).

Os três testes novos rodam contra uma **DHT local de verdade** (`hyperdht/testnet`), com
sockets, `Hyperswarm`, `protomux` e replicação de `hypercore` reais — em 6 s. Nada sai da
máquina.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Backend real do swarm | `core/src/l0/swarm/hyperswarm.ts` (`HyperswarmBackend`), porta em `swarm/ports.ts` | §14.1, §14.3(4) | a fachada `Swarm` ganhou `backend` opcional: ausente = modo memória (a suíte de §14.2/§14.3 não mudou uma linha), presente = DHT. O firewall de conexão liga-se ao `firewallShouldRejectConnection` que já era puro |
| Canal de §16.1 sobre `protomux` | `core/src/l3/rpcServer/protomux.ts` — `protomuxChannelTransport` (abre) e `protomuxChannelAcceptor` (responde) | §16.1, §14.4 | satisfaz o `RpcTransportPort` que `RpcServer`/`RpcClient` já consomem: **nada** de §16.2/§16.3 mudou por sair do canal de memória para o socket. Teto de frame aplicado antes do decode, nos dois sentidos |
| O transporte ligado ao boot | `core/src/composition/transport.ts` — `startCommunityTransport` | §14.1, §14.3, §16.1 | junta tópico, autorização, replicação e canal; alimenta as duas costuras de §44 |
| Replicação do log | `CoreHandle.replicate?`/`download?` (L0) sobre o mesmo mux | §14.1, §14.2 | o membro descobre o host pela DHT e interpreta o log inteiro; `download({start:0,end:-1})` porque o hypercore é esparso e "estar conectado a um par não é estar replicando" |
| Escrita ponta a ponta pela rede | — | §11.1 caminho A, §16.2 | `submitQueued` → `outbox.flush()` → `submitOps` pelo socket → `HostAdmission` → append → replicação de volta → a réplica projeta a op → `reconcile` limpa a fila |
| §14.3(1) contra um par de verdade | `autorizado` em `transport.ts` | §14.3(1), T-25, DR-30 | um nó com identidade que não está no `DS` acha o tópico, conecta — o firewall de §14.3(4) não o recusa, porque ele não está banido em comum nenhuma — e **não recebe bloco**: o host não replica para ele |
| §14.3(3) no mesmo lote | `CoreRuntime.onProjected` → `refresh` | §14.3(3) | o gatilho é o lote de projeção; o mesmo gatilho abre o canal que só era possível depois de saber quem é o host |
| `DS` em memória avança **com** o commit | `core/src/l1/projector/index.ts` | §10.5, §10.7 | `this.#ds = ds` passou para logo depois do commit do lote, antes da emissão — a mesma invariante que o caminho do bloco ausente já respeitava |

### 45.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| **O keypair do `Hyperswarm` é a identidade de §5.5** | Sem isso, §14.3(1) é inimplementável: `remotePublicKey` não diria nada sobre membro nenhum, e a autorização exigiria um handshake de identidade em banda inventado aqui | §5.2 é a tabela **fechada** de derivações e não tem prefixo para chave de rede; §5.1 declara `remotePublicKey` verificada; §12.6 já a lê como "chave pública do par". Registrado como emenda em §14.3, com `L-24` declarando o metadado que isso expõe |
| **Réplica sem `DS` autoriza qualquer par** | Um nó que nunca interpretou a comunidade não tem bloco para servir, e só descobre quem é membro **lendo o log**. Recusar ali tornaria a primeira replicação impossível — o problema do ovo e da galinha, não uma brecha | §14.3(1) é regra sobre o que **eu** sirvo; a propriedade fica inteira por simetria, porque quem tem o dado aplica a mesma regra sobre o `DS` dele. Emenda registrada em §14.3 |
| **`protomux`, e não `protomux-rpc`** | O que §16.1 pede de `protomux-rpc` são canais distintos por protocolo (isso é `protomux`) e uma tabela de parâmetros que `protomux-rpc` não tem — timeout, requests em voo, teto antes do decode, reconexão, circuit breaker — e que `rpcClient`/`rpcServer` já implementam. E §16.3, cuja tabela fechada de notificações sem `id` não tem equivalente lá | §14.3(1) já diz "canal `protomux`"; §3.1 escreve "protomux(-rpc)". Emenda registrada em §16.1: nenhum parâmetro, método, tópico ou código muda |
| **Quem abre o canal é o membro; o host responde** (`mux.pair`) | Canal aberto contra um par que ainda não o registrou é recusado pelo `protomux` e morre. Quem sabe **quando** o canal faz sentido é o membro, porque é ele que precisa ter lido o log para saber quem é o host. Sem a assimetria, o host abriria e seria recusado em laço | Mesma assimetria do anúncio na DHT (§14.1): o host anuncia, o membro procura. Emenda registrada em §16.1 |
| Conexão sem `topics` serve **qualquer** comunidade deste nó | `peerInfo.topics` só vem preenchido do lado que procurou o tópico; quem anuncia recebe a conexão sem saber por qual tópico vieram. Filtrar por tópico do lado do host descartaria todas as conexões de entrada | Quem decide é §14.3(1), que é por comunidade e não depende do tópico: um par que não é membro ativo não passa, venha por onde vier |
| `onAppend` do `CoreHandle` reage também a `download` | Para o **escritor** `append` é o evento: o bloco existe e é legível no mesmo instante. Para a **réplica** as duas coisas se separam, e o projector para no primeiro buraco esperando um sinal — que com só `append` nunca chegaria num log que veio inteiro de uma vez. Coalescido numa microtask porque a replicação dispara `download` por bloco | §10.5 passo 6: o projector reage ao core; para uma réplica, "há mais para ler" é o download |
| `this.#ds` avança junto com o commit do lote | Quem observa o lote — o fan-out de §15.5 e, por ele, o transporte em §14.3(3) — precisa ver o estado que o lote produziu. Com a atribuição no fim do `#run`, o observador via o estado anterior e o canal só abria na projeção seguinte | É a invariante que o caminho do bloco ausente já respeitava (`this.#ds = ds` antes do `return`): depois de um commit, memória e `view.db` estão no mesmo prefixo |
| O `Swarm` de memória continua sendo o default | As regras de §14.2/§14.3 são puras e precisam continuar testáveis sem rede — é o que §4 diz que a divisão existe para permitir. Nenhum dos 765 testes anteriores mudou | §4, §28.1 |
| `peerCount` com backend real conta **conexões**, não pares por tópico | Um par que traz duas comunidades é uma conexão, e o orçamento de §14.2 é de conexões | §14.2, `F-14` |

### 45.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §14.3 | emenda datada com dois itens: (1) o par de §14.3(1) é o `remotePublicKey` do Noise, que **é** a chave de identidade — com `L-24` declarando o metadado; (2) réplica que ainda não interpretou nada autoriza qualquer par, e por que a propriedade fica inteira por simetria |
| `docs/backend-v2.md` §16.1 | emenda datada: a implementação usa **`protomux`** (a camada sobre a qual `protomux-rpc` é construído, já nomeada em §14.3(1)) carregando os quadros de §16.2/§16.3, com a justificativa item a item; e a assimetria "o membro abre, o host responde" |

### 45.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~Protocolo `p2p-admission/1`~~ | **implementado em 2026-08-22 — §46**: `inviteResolve`/`inviteRedeem` sobre o tópico de convite de §14.1, com o canal pré-membro de §12.3 e os tetos de §12.6 | — |
| Probe de NAT e `Diagnostics` | `diag.*` continua chegando injetado ao boot; o probe real é o `hyperdht` (§24.3) e o `MediaServer` de §17.3 sobre o mesmo socket UDX | fase de mídia pela rede |
| Descoberta da continuação pela DHT | §18.8 passo 5 tem a arbitragem (`migrateRail`) e a porta; falta quem entrega o core novo à réplica | G12 empacotado |
| Escalonador de §14.2 ligado | `allocateConnections` é puro e testado, e `HyperswarmBackend` aceita `maxPeers`; ninguém ainda reprioriza por comunidade ativa nem aplica `BG_ROTATION_MS` | **BENCHMARK REQUIRED — G9** |
| ~~Core de blobs na DHT~~ | ~~tópico de convite~~ entrou em §46; **terceiro tópico implementado em 2026-08-22 — §47**: os três tópicos de §14.1 anunciados/procurados | — |
| ~~Produtores de `presence.changed` / `typing.changed`~~ | ~~os tópicos estão em §16.3 e o push do host já funciona; faltam os handlers no `rpcServer`~~ **implementado em 2026-08-23 — §54** | — |

---

## 46. Nascer, convidar, resolver e resgatar — `community.create` e o protocolo `p2p-admission/1` 2026-08-22

**Gate de entrada:** G3 (`confirmado`, `poc/poc-05-g3/out/gate-G3/gate-G3.json`) para os seis
desfechos de preview e o consumo atômico de `maxUses` — decisões reutilizadas, código do
harness não. As quatro decisões de §45 (keypair de rede = identidade; réplica em branco
autoriza quem consulta; `protomux`; membro abre canal) ficaram intactas. Um arquivo novo em
L2 **não** houve — o `InviteManager` existente ganhou só o papel de anúncio; dois arquivos
novos na raiz de composição (`community.ts`, `admission.ts`); barreira:
`§4 ok — 75 arquivo(s), L0:8 L1:6 L2:12 L3:4 + raiz de composição (5 arquivo(s))`; suíte
768 → **769 testes, 0 falha**; harness do G12 rebuildado e reexecutado nos dois perfis
(6/6).

O teste que fecha a fase roda contra `hyperdht/testnet`: um nó cria a comunidade pelo
comando IPC `community.create`, emite `invite.create`, e o outro — **sem nenhuma linha em
`manifest.communities`** — resolve e resgata pelo código de 16 caracteres, replica o log
inteiro pela mesma conexão da admissão e manda uma op pela outbox que volta projetada.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| `community.create` | `core/src/composition/community.ts` — gênese de R-27 montada com as juntas de §44 (`opCodecSignPort` + `hostRecordSigner`) | §5.3, §19.1, R-27 | semente → linha cifrada no manifest **antes** de criar core → 6 registros num único `core.append`; falha de append descarta linha e core |
| Fronteira dos cinco comandos | `core/src/l3/ipcRenderer/commands.ts` | §15.4 | `community.create` (standard), `invite.create`/`invite.revoke` (⏱ standard), `invite.resolve` (**open**), `invite.redeem` (standard); `code` só na resposta de quem cria |
| Emissão/revogação compostas | `inviteCreate`/`inviteRevoke` em `community.ts` — segredo persistido antes do append, removido se a admissão recusar | §12.2, §7.5 | vale para qualquer membro com `create_invite` (convite delegado, A08), via porta local ou RPC |
| Anúncio reconciliado do DS | gancho `onProjected` → `InviteManager.syncAnnouncements` por comunidade hospedada | §12.2 passo 3 | convite criado por outro membro chega pela replicação e é anunciado; revogado/expirado/esgotado sai no lote que o registrou; papel `server:true` |
| `CoreRuntime.openCommunity(row)` | `boot.ts` — o closure `abrir` virou método | §3.3 | comunidade que nasce depois do boot tem o mesmo caminho do boot, sem reiniciar o processo |
| Fila durável também em modo host | `admissionSubmitPort` em `ports.ts`; outbox criada nos dois ramos do boot | §11.2, §7.5 | o host consome `authorSeq` da mesma fonte persistida e tem reconciliação de boot igual à de membro |
| Tópicos dinâmicos | `transport.ts`: `syncTopicos()` reenumerável + `runtime.onOpen` | §14.1 | comunidade nova é anunciada/procurada no `register`, sem reiniciar nada |
| Canal pré-membro `p2p-admission/1` | protocolo `admission` já tabelado em `rpcServer`/`rpcClient`; `transport.ts` passa a procurar (`seekInviteTopic`) e servir (`serveInviteTopics`) tópicos de convite | §16.1, §12.3 | candidato abre, host responde — mesma assimetria de §16.1 |
| Serviço de admissão | `core/src/composition/admission.ts` — `AdmissionService`, as duas direções numa assinatura só de `onAdmissionChannel` | §16.2 | `admissionHello`/`inviteResolve`/`inviteRedeem`; seis desfechos delegados ao `InviteManager` (G3) |
| Tetos de §12.6 no fio | orçamento de conexões por tópico; rate limit node-level por chave e /24 **antes do decode** (ordem de §14.4) | §12.6, §14.4 | quadro limitado não existe: sem decode, sem resposta, sem consumo de challenge; prova errada fecha a conexão |
| Firewall cede à superfície pré-membro | `HyperswarmBackend.setPreMemberSurface`, assinado pela composição | §14.3(5) | enquanto houver convite hospedado, a porta aceita qualquer par; canais continuam guardados por §14.3(1) |
| Resgate → participação | `redeem` em `admission.ts`: envelope `member.join` selado pelo candidato (F-06), blobs locais gerados e cifrados (§13.1), linha no manifest + `openCommunity` | §12.4, §5.3 | `{seq, communityId, coreKey, blobsKey, defaultChannelId, hostKey}` do host; runtime e tópico do log ganham a comunidade no mesmo tick |
| Teste de fechamento | `core/test/admissao.test.ts` | §19.5 | dois nós, zero linha plantada; op sai da outbox, atravessa §16.2 e volta projetada; reconciliação limpa a fila |

### 46.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| `abrir` virou `CoreRuntime.openCommunity(row)` | Era a sugestão literal e a mais barata: o closure já tinha exatamente as dependências que o runtime guarda. `register` continua separado para que o chamador decida o que fazer com falha (degraded no boot, erro nomeado no create/redeem) | §3.3 fases `open`+`host-mode`; §10.2 (`manifest.communities` é a enumeração autoritativa) |
| **Host também tem outbox** | Sem fila não há `authorSeq` durável (§7.5): a primeira op síncrona do host reusaria o 1 e viraria `E_DUPLICATE` — a gênese consumiu 1..6 fora da ponte. Com fila, o host usa a MESMA ponte de submissão do membro (`submitSync`), com porta local em vez de RPC | §11.2 ("uma outbox por comunidade"); contrato de `CommunityHandle.outbox` já dizia "presente quando a instalação escreve nela" — e agora ela escreve |
| Rate limit pré-membro **uma** vez, node-level, antes do decode | Contar duas vezes (transporte + manager) reduziria pela metade tetos normativos. O manager fica sem o par justamente para não duplicar | §14.4 ordem 1→2; §12.6 declara os valores, não o ponto do fio — emendado |
| Orçamento de conexões **por tópico de convite** | Pré-redeem não há comunidade nomeada para o candidato; o tópico é o agrupador disponível dos dois lados, e cada tópico pertence a uma comunidade só | §12.6 diz "por comunidade hospedada" — emendado com o motivo |
| Firewall de conexão cede enquanto houver convite hospedado | O firewall age antes da conexão existir, e quem anuncia não sabe por qual tópico vieram (`peerInfo.topics` só vem do lado que procurou). Recusar na porta tornava o preview `banned` inalcançável para exatamente o caso que (5) cobre. Autorização por comunidade (1) continua canal a canal — banido não recebe bloco | §14.3(5) declara a exceção do canal; a realização na porta foi emendada com o custo declarado (handshake a mais, dado nenhum) |
| Tópicos são **dica**, não filtro: conexões são reavaliadas contra todas as comunidades | O hyperdht deduplica conexão por par (fonte: `hyperswarm@4.17 index.js` `_connect`/`_handleServerConnection`) — a conexão da admissão É a mesma pela qual, depois do resgate, o log passa. Filtrar por tópico deixaria o resgatado sem primeira replicação | §14.3(1) decide por comunidade, independente de tópico; a emenda da réplica em branco (§45) cobre o resto |
| `replicate(mux)` **exatamente uma vez** por `(mux, comunidade)` — guarda absoluta | `attachTo()` do hypercore não é idempotente (fonte: `hypercore@11.35.1 lib/replicator.js`): rechamar cria peers duplicados que se matam — foi observado como tempestade de `peer-remove`. E o OPEN remoto sem `pair` registrado é **rejeitado sem buffer** (fonte: `protomux@3.11.0 index.js` `_requestSession`) — a corrida "host projeta antes do candidato registrar" é resolvida porque quem abre o canal de replicação do lado do candidato é o `onOpen` no instante do registro, e o par do host sobrevive à rejeição inicial (só sai com `detachFrom` ou stream morto) | §14.1 ("estar conectado a um par não é estar replicando" — e replicar uma vez basta); nenhuma regra exige retentativa |
| Anúncio é **reconciliado do DS**, nunca da ação local | Convite delegado é criado por membro que pode não ser o host: quem anuncia precisa saber do convite PELO LOG, não pela fronteira. O lote projetado é o ponto onde host e réplicas convergem | §12.2 passo 3 pertence ao host; A08 (o host valida pela chave pública e nunca conhece o segredo) |
| `defaultChannelId` = primeiro canal criado | A ordem de inserção de `ds.channels` é a ordem de aplicação do log; a gênese cria #geral primeiro. Campo respondido por §15.4 mas nunca definido | Emenda em §15.4 |
| Linha órfã limpa no boot por **armazenamento do core ausente** | §5.3 manda limpar; o critério honesto é "o core nunca chegou a existir". Só há caminho de produto quando o boot abre disco — com `openCore` injetado (teste) o diretório não prova nada, então a varredura não roda | §5.3 passo 2, literal |
| Perfil do fundador vem da identidade local; sem perfil, `'Fundador'`/0 | `member.join` exige `displayName` (R-27b verifica forma); §15.4 não pede nome no comando, e a identidade já o tem | §8.6 (`displayName` ≥ 2 cp); fallback é forma válida, nunca silêncio |
| `invite.resolve` exige identidade apesar da classe open | O `liveProof` amarra `candidatePk` (T-06): sem par Ed25519 local não há prova. A classe open diz que o comando não muda estado — não que dispense chave | §12.3 passo 3; `E_NO_IDENTITY` do catálogo |

### 46.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §14.3 | emenda datada com a **realização de (5) na porta de conexão**: firewall cede enquanto houver convite ativo hospedado; autorização por comunidade (1) permanece canal a canal, custo declarado |
| `docs/backend-v2.md` §12.6 | emenda datada com três pontos do fio: rate limit node-level único antes do decode; orçamento de conexões por tópico de convite; prova errada fecha sem resposta útil |
| `docs/backend-v2.md` §15.4 | `defaultChannelId` definido na linha de `community.create`: primeiro canal criado (ordem de aplicação do log) |

### 46.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~`query.invites` (§15.6)~~ | **implementada em 2026-08-22 — §49**: DS + `invite_secrets`, com `codeAvailable` | — |
| ~~Job de expiração de convite (§22.2)~~ | **implementado em 2026-08-22 — §49**: `invite.topicSweep` no runner de jobs | — |
| ~~Core de blobs pela rede (§13)~~ | **implementado em 2026-08-22 — §47**: `BlobManager` composto no boot sobre o core local de §13.1; stage appenda fatias no core, download puxa blocos pela replicação com teto e hash; os três tópicos de §14.1 na DHT | — |
| Probe de NAT, descoberta da continuação, escalonador, presença | herdados de §45.3 sem mudança | ver §45.3 |

---

## 47. Anexos ponta a ponta — o core de blobs sai do cabo e entra na rede 2026-08-22

**Gate de entrada:** nenhum gate específico — o terceiro tópico de §14.1, pendente desde
§45.3 e herdado como pendência de §46.3. As peças locais existiam e estavam testadas
(`BlobManager` com ticket/staging/cache, o roteador de anexos com a barreira de §13.7,
`member_blobs_core` gravado no create/redeem); o que não existia era o core de blobs real,
o boot que o constrói e a rede que o replica. Nenhum módulo novo em camada — as portas
entraram em `l2/blobs` e as juntas na raiz de composição; barreira inalterada
(`§4 ok — 75 arquivo(s), L0:8 L1:6 L2:12 L3:4 + raiz de composição (5 arquivo(s))`); suíte
769 → **776 testes, 0 falha** — inclui o teste de fechamento `core/test/anexos-rede.test.ts`:
dois nós em `hyperdht/testnet`, zero linha plantada, pick → stage → `message.send` com
anexo → o outro nó baixa os blocos **do core do autor** pela mesma conexão da comunidade,
com hash verificado. Harness do G12 rebuildado e reexecutado nos dois perfis (6/6).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Portas do core de blobs (`BlobsWriterPort`/`BlobsReaderPort`) | `core/src/l2/blobs/index.ts`; adaptadores Hypercore em `blobCorePorts` (`composition/ports.ts`) | §13.1, §13.4 | armazenamento em `<cores>/blobs/<blobsCoreKeyHex>` (§10.1); writer por semente, reader esparso por chave pública |
| Core local nasce do manifest | `CoreRuntime.openCommunity`: decifra `secret_seed_enc` com `aeadOpenPacked`, deriva o par e só anexa se a chave **for** a publicada no log | §5.2, §10.2, §13.1 | divergência semente↔chave não escreve em core algum; falha de blob não derruba a comunidade |
| Stage entra no core | `BlobManager.stage` resolve o escritor pelo escopo do ticket e appenda fatias de 64 KiB; `blobId` vira o recorte real | §13.2 passo 5 | `attachments.test.ts`: `blockLength = ⌈bytes/65536⌉`, concatenação das fatias = original |
| Tópico de blobs na DHT | `attachLocalCore` anuncia (`server`) ao abrir a comunidade; `download` procura (`client`) | §14.1 linha 2 | `anexos-rede.test.ts` — o candidato encontra o core do autor sem configuração nenhuma |
| Replicação no mux das comunidades | `transport.avaliar` → `blobs.serveMux(mux)`; done-set por `(mux, core)`; `forgetMux` no fechamento do stream | §16.1, §14.1 | blocos chegam pela conexão JÁ VIVA da admissão/log — hyperdht deduplica por par, tópico novo não traz conexão nova |
| Download de verdade | `#baixarPelaRede`: faixa inclusiva traduzida na fronteira L0, teto sobre os bytes recebidos, hash sobre o recorte, arquivo no cache de §10.1 | §13.4 passos 3–7 | unidade (`anexos-core.test.ts`): feliz, teto (`corrupt`/size), hash (`corrupt`/hash), prazo (`unavailable`/`E_NO_PEERS`); rede: bytes idênticos aos originais |
| Eventos de §15.5 do download | porta `onEvent` injetada no manager; rota viaja FORA do payload | §15.5, §15.1 regra 2 | `blob.completed`/`attachment.corrupt`/`blob.unavailable` com os campos exatos da tabela |
| Superfície de anexos composta no boot | `blobAttachmentPort` (agora multi-comunidade via `blobsCoreKeyOf`) + `viewAttachmentResolver` (consulta `attachments` na `view.db`) ligados ao roteador; `pickFile`/`onReveal` injetados em `BootDeps` | §13.3, §13.7, §15.4 | `name`/`sizeBytes`/`hash`/faixa vêm da mensagem projetada, nunca do renderer; caminho nunca cruza IPC-R |
| Defeito latente do roteador corrigido | `commands.ts`: `attachment.blob` levava só o quádruplo — o encode real (`writeBlobRef`) exige a chave e lançaria | §7.2.1, §7.4.1 | payload completo asserido no teste de barreira |
| Defeito latente do resgate corrigido | `admission.ts` derivava o par de blobs com `deriveInviteKeypair` (que deriva de `BLAKE2b(seed)`) — o `core_key` publicado não era recuperável da semente cifrada | §5.2 tabela fechada, §13.1 | `ed25519_keypair_from_seed(seed)` direto; o boot agora reabre o core do resgatado (asserção no teste de rede) |

### 47.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| O conteúdo vive em **blocos do próprio hypercore**, sem `hyperblobs` | Uma dependência nova para representar o mesmo conteúdo que o core já endereça é custo sem propriedade nova; fatia fixa de 64 KiB torna `blockOffset`/`blockLength` determinísticos dos dois lados, sem metadado lateral | §13.2 dizia "hyperblobs.put" sem exigir o pacote; o fio (`AttachmentRef`, §7.2.1) nunca mudou — emenda registrada lá declarando a equivalência e a condição (a faixa devolve os bytes do hash) |
| Quem **tem** o core anuncia; quem quer baixa procura — nada mais entra na DHT | O dono tem tudo desde o boot da comunidade; cliente para quem não precisa seria tráfego e metadado de graça | §14.1: "quem tem, ou quer, algum anexo" — os dois papéis, e só eles |
| Tópico com prefixo de domínio (`blob-discovery/1`) | DiscoveryKeys reais de comunidades já ocupam tópicos; colisão acidental entre um log e um core de blobs misturaria réplicas | §14.1 nomeia `discoveryKey(memberBlobsKey)` como conceito; a forma concreta foi emendada com o mesmo racional do tópico de convite (`invite-topic/1`) |
| A marcação de replicação mora no **manager**, não no transporte | `serveMux` é chamado a cada avaliação de conexão e o leitor pode nascer DEPOIS do mux existir (download pedindo blob de conexão antiga). Um done-set por mux dá o "uma vez por (mux, core)" de graça | Lições de §45: `attachTo()` não é idempotente e OPEN sem pair é rejeitado — replicar uma vez basta e registrar cedo evita a corrida |
| Faixa **inclusiva** na porta, meio-aberta no hypercore | `toLength = end − start` no vendor: pedir `0..N−1` direto deixaria o último bloco de fora com `done()` resolvido — defeito observado, não teorizado | §13.4 passo 3 pede "por range"; a tradução de convenções pertence à fronteira que importa o vendor (L0), não a cada chamador |
| Eventos saem por porta injetada, com rota fora do payload | O manager é L2 e não conhece fan-out; acrescentar `communityId` ao dado inventaria superfície além da tabela | §15.5 é tabela **fechada**; §15.1 regra 2 separa rota de payload |
| `pickFile`/`onReveal` continuam injetados no boot | O diálogo e o `shell.open` são do main via IPC-M; o shell Electron ainda é stub — inventá-los aqui seria fingir fronteira que não existe | §13.3 (ticket nasce no main), §15.7 |
| Falha de blobs não derruba a abertura da comunidade | Log e anexos são cores diferentes por desenho; uma instalação com `member_blobs_core` ilegível ainda lê, projeta e envia texto | §3.3 fase `open` (degradado por comunidade); §13.1 (ownership local, não da comunidade) |

### 47.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §13.2 | emenda datada: `hyperblobs.put` realizado por fatias de 64 KiB appendaris no core do autor; `blobId` = recorte resultante; equivalência declarada com a condição do hash |
| `docs/backend-v2.md` §13.4 | emenda datada: passos 2–3 realizados (tópico com prefixo, dono anuncia/procurador busca, replicação no mux de §16.1 uma vez por `(mux, core)`, faixa inclusiva traduzida na fronteira) |
| `docs/backend-v2.md` §14.1 | emenda datada na tabela: realização da linha "core de blobs" — forma concreta do tópico e papéis server/client |
| `docs/backend-v2.md` §10.2 | nota na linha de `member_blobs_core`: cifra empacotada `nonce‖ciphertext‖tag` (sem coluna de nonce) |

### 47.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~Produtores de `blob.progress` / `blob.peerLost`~~ | **implementados em 2026-08-22 — §49**: bitfield local e remoto por par, loop de 500 ms | — |
| ~~GC de cores de blobs remotos~~ | **implementado em 2026-08-22 — §49**: `gcReaders` no job `blob.gc` | — |
| ~~Cota no `blob.stage` (`E_QUOTA_EXCEEDED`, §15.4)~~ | **implementada em 2026-08-22 — §49**: antecipação advisória de R-14 no stage | — |
| `Diagnostics` e `RelayVolunteer` chegam injetados | resto da linha de §44.3: sonda de NAT real e consentimento; o `BlobManager` saiu dessa lista nesta fase | fase de mídia pela rede |
| ~~Índice para resolver anexo sem comunidade~~ | **criado em 2026-08-22 — §49**: `idx_attachments_ref(blobs_core_key, blob_id)` | — |

---

## 48. A semente do core de blobs volta a ser derivada da identidade 2026-08-22

**Gate de entrada:** nenhum gate específico — achado de §47, registrado só agora. O código
que §46 escreveu (`community.create`) e §47 corrigiu (`invite.redeem`) criava o core de
blobs do membro com **semente aleatória**, selada pela Data Key em
`member_blobs_core.secret_seed_enc`; o normativo (§13.1, §5.2 linha `ns/memberblobs/1`,
§19.1 passo 3) sempre disse **derivada** de `identitySeed ‖ communityId`. A divergência não
era cosmética: com semente sorteada, quem restaurasse a identidade numa instalação nova sem
o `manifest.db` ficaria sem os próprios cores de blobs para sempre — o backup de §5.5
carrega `identitySeed` e a lista de comunidades, e **nunca** carregou essa semente. A
propriedade prometida por §13.1 ("recuperável por ele em qualquer reinstalação a partir do
backup de identidade") simplesmente não valia no código. Nenhum módulo novo em camada;
barreira inalterada (`§4 ok — 75 arquivo(s), L0:8 L1:6 L2:12 L3:4 + raiz de composição
(5 arquivo(s))`); suíte 776 → **778 testes, 0 falha**. Harness do G12 rebuildado e
reexecutado nos dois perfis (6/6).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Derivação única, em um lugar | `memberBlobsKeyPairFor` + `identitySeedOf` em `composition/community.ts`, sobre o `deriveMemberBlobsKeypair` que já existia em `l2/blobs` | §5.2, §13.1 | `identitySeed` = 32 primeiros bytes da secret key Ed25519 (`sodium` guarda `seed ‖ publicKey`), o mesmo valor que §5.5 exporta |
| `community.create` deriva o core do fundador | `createCommunity`: `newKeypairFromRandomSeed` **removido**; a chave que entra no `member.join` da gênese é a derivada | §19.1 passo 3 | `blobs-semente.test.ts` (1): chave publicada no log = `deriveMemberBlobsPublicKey`, e a linha do manifest guarda a mesma semente |
| `invite.redeem` deriva o core de quem entra | `AdmissionService.redeem`: semente derivada no lugar de `randombytes_buf` | §12.4, §13.1 | `admissao.test.ts` e `anexos-rede.test.ts` seguem verdes sem mudança — nenhum dos dois plantava a linha, os dois passam pelo caminho de produto |
| Boot deriva e **repara** o atalho | `CoreRuntime.openCommunity`: semente vem da derivação; guarda passa a comparar com a chave **publicada no log**, com a linha local como cópia enquanto o log ainda não tem a entrada do próprio; linha ausente/ilegível é reescrita | §10.2, §13.1, §3.3 `open` | `blobs-semente.test.ts` (2): mesmo `dataDir`, `manifest.db` e `view.db` apagados e recriados como `identity.import` os recria (só `communities`) — o boot reabre o writer e reescreve a linha |

### 48.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| **Conformar o código ao normativo** (caminho (a)), não emendar §13.1 para legitimar a semente aleatória | Aleatória exige que um segredo local sobreviva a tudo para o dado ser recuperável; derivada não exige nada além do que o backup de identidade já carrega. E o formato de §5.5 — `identitySeed` + `{communityId, coreKey, blobsKey, communitySeed?}` — só fecha se a semente for derivável: emendar o normativo obrigaria a inventar um campo novo no bundle **ou** aceitar perda de dado do usuário | §13.1 e §19.1 passo 3 dizem "deriva"; §5.2 é tabela **fechada** e a linha `ns/memberblobs/1` existia sem nenhum consumidor — texto normativo morto é sintoma, não licença |
| A linha `member_blobs_core` **fica**, como atalho e verificação cruzada | Evita derivar a cada abertura e, principalmente, preserva a coluna que o boot usa para conferir a chave antes de escrever. Removê-la seria mudança de schema numa tabela fechada em §10.2, com emenda própria, sem propriedade nova em troca | §10.2 é tabela fechada; manter o schema é a menor alteração coerente. Emenda datada declara o novo status da linha (derivada, reparável) |
| A guarda do boot passa a comparar com a chave **publicada no log** | A linha local é cópia; a fonte que toda réplica enxerga é o `member.join`/`member.setBlobsCore`. Sem isso, o caminho de restauro (que não tem linha nenhuma) não teria contra o que se defender — e a guarda de §47 contra corrupção local se perderia justamente onde ela passa a importar | §13.1 ("publicado no log … recuperável por toda réplica"); a guarda de §47 não é enfraquecida, é ancorada na fonte mais forte |
| Boot **reescreve** a linha quando ela falta ou não decifra | É reparo de um derivado, não migração de dado: o valor recriado é função da identidade e do `communityId`, então não há decisão a inventar. É este passo que devolve os anexos a quem restaurou a identidade | §5.3 já trata linha órfã por reparo no boot; §13.1 emendada declara o comportamento |
| Chave de blobs determinística da identidade **não** é regressão de privacidade | O correlacionador seria "mesma pessoa em duas comunidades" — mas a chave já é **pública** desde o `member.join`, e continua uma chave distinta por comunidade (o `communityId` entra na derivação). Nada que estava privado passa a ser observável | §13.1 publica `blobsCoreKey` no log por desenho; §5.2 dá namespace por comunidade — a separação de domínio é o que evita a chave única entre comunidades |
| Sem migração para instalações anteriores | Nenhum binário publicado; um diretório de desenvolvimento criado antes desta fase tem no log uma `blobsCoreKey` aleatória que a derivação não reproduz — a guarda recusa o writer, `blob.stage` responde `E_NO_BLOBS_KEY` e o resto da comunidade segue. Recriar o diretório é o caminho | Mesma decisão de §10.2.1: sem release, não se inventa migração |

### 48.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §13.1 | emenda datada: a derivação é a única fonte da semente; a linha `member_blobs_core` é atalho e verificação cruzada; a guarda do boot compara com a chave publicada no log e repara a linha ausente/ilegível; racional de privacidade (a chave já é pública) registrado |
| `docs/backend-v2.md` §10.2 | nota na linha de `member_blobs_core`: linha derivada, recriável pelo boot — não é fonte única |

### 48.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| `identity.import` que realmente reabre as comunidades | §5.5 define o bundle e o `IdentityStore` já exporta/importa a semente; o que não existe é o caminho que recria as linhas de `communities` a partir dele e chama `openCommunity`. O teste de §48 simula esse passo à mão | fase de identidade/superfícies |
| `member.setBlobsCore` sem produtor | o `fold` aplica a op e o boot já compara contra a chave corrente do log, mas nenhuma superfície a emite — trocar de core é hoje só um caminho de leitura | superfícies de comunidade |
| Herdadas de §47.3 | progresso/`peerLost`, GC de readers remotos, cota do `stage`, `Diagnostics`/`RelayVolunteer`, índice de anexo sem comunidade | ver §47.3 |

---

## 49. As pendências pequenas de superfície: convites listáveis, jobs, cota e GC 2026-08-22

**Gate de entrada:** nenhum gate específico — seis pendências nomeadas em §46.3 e §47.3,
todas de baixo custo e alto valor de superfície. Um módulo novo em camada nenhuma: entrou
`core/src/composition/jobs.ts` na raiz de composição (§4 ok — 76 arquivo(s), L0:8 L1:6 L2:12
L3:4 + raiz de composição (6 arquivo(s))); suíte 778 → **787 testes, 0 falha**, com
`core/test/pendencias-superficie.test.ts` cobrindo as seis. G12 rebuildado e reexecutado nos
dois perfis (6/6).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| `query.invites` | `queryInvitesPort` (`composition/ports.ts`) + comando standard em `l3/ipcRenderer/commands.ts` | §15.6, §12.2 | fato do log pelo DS; `code` reconstruído de `manifest.invite_secrets` com `inviteSecretToCode`; `codeAvailable:false` onde o segredo não está (U-04). Comunidade desconhecida é `E_NOT_FOUND` |
| Vida do convite num lugar só | `isInviteLive` em `l2/invites`, usada pelo `syncAnnouncements` do `InviteManager` e pela reconciliação da `AdmissionService` | §12.3, §22.2 | tabela-verdade no teste: revogado, expirado (`<=`), esgotado |
| `invite.topicSweep` (15 min) | `AdmissionService.sweepInviteTopics` + `startJobs` | §22.2 | o job derruba o anúncio do convite vencido **sem lote novo no log** — só o relógio andou |
| Runner de jobs de §22.2 | `composition/jobs.ts`; `runtime.jobs`, parado no `close` | §22.2, §22.5 | rearme após cada execução (o `schedule` de `BootDeps` é de um disparo); `runNow` depois do `stop` não roda |
| `E_QUOTA_EXCEEDED` no `blob.stage` | porta `storageUsedOf` no `BlobManager`, ligada ao `member.storageUsedBytes` do DS | §15.4, §13.8, R-14 | recusa **antes** de gravar (nada vai para o cache nem para o disco); passa quando cabe |
| `blob.progress` / `blob.peerLost` | `rangeStatus` na porta de leitura (bitfield local + bitfield remoto por par), loop de 500 ms em `BlobManager` | §13.4 passo 4, §22.1 | `progress`, `bytesDownloaded`, `peers`, `hostAvailable` de dado real; par que some vira `peerLost{remaining}`; rota fora do payload |
| GC dos leitores esparsos | `BlobManager.gcReaders` no job `blob.gc` | §22.4 | fecha o core alheio ocioso, esquece a marcação por mux, sai do tópico; o download seguinte reabre |
| Protegido do LRU do cache | `anexoProprioVivo` (boot) sobre `attachments ⋈ messages` | §13.7 regra 2, §22.4 | anexo meu com mensagem viva (sem `deleted_at`) nunca é coletado |
| Índice do resolver de anexos | `idx_attachments_ref(blobs_core_key, blob_id)` em `view.db` | §10.3, §15.4 | `EXPLAIN QUERY PLAN` usa o índice; sem `SCAN attachments` |

### 49.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| `query.invites` lista **também** revogado/expirado/esgotado | A resposta de §15.6 carrega `revokedAt`, `expiresAt`, `maxUses` e `uses`: campos que só fazem sentido se o item aparecer. Filtrar aqui esconderia da UI exatamente o que ela precisa desenhar | §15.6 define o schema do item, não um filtro; quem filtra anúncio é §22.2, que é outra coisa |
| `codeAvailable` é campo, não erro | O convite é fato do log em toda réplica; o segredo é local. "Tenho o convite, não tenho o código" é o estado normal de quem replicou a comunidade | §12.2 ("o código só existe na instalação de quem o criou"), delta U-04 |
| `isInviteLive` extraída para `l2/invites` | A mesma regra decidia duas coisas em dois lugares (preview de §12.3 e anúncio na DHT) e já tinha divergido em forma. Uma função, dois chamadores | §4: regra de domínio de convite mora em `invites`, não na raiz de composição |
| O job existe **por causa da expiração**, não da revogação | Revogar e esgotar são registro no log: a reconciliação por lote projetado já os derruba. Expirar é a passagem do tempo — numa comunidade parada, nenhum lote acontece e o tópico ficaria anunciado indefinidamente | §22.2 nomeia o job; a emenda registra qual dos três desfechos realmente depende dele |
| Relógio do sweep é o **local do host** | Quem anuncia é o host, e é o relógio dele que decide o que ele publica. Usar `hostTs` do último registro faria o anúncio depender de haver registro — a própria condição que o job existe para dispensar | §12.3 usa `hostNow` no preview (decisão de admissão, do host); o anúncio é da mesma parte |
| Jobs periódicos por **rearme**, não `setInterval` | O `schedule`/`cancel` de `BootDeps` é o cabo de um disparo que o resto do núcleo já usa (e que o teste injeta como no-op determinístico). Rearmar depois de cada execução dá periodicidade **e** impede sobreposição de graça | §22.2 fixa os períodos; §22.5 exige que nada sobreviva ao escopo — `stop()` no `close` do runtime |
| Cota antecipada no stage é **advisória** | A decisão continua no `fold` (R-14 no `message.send`), onde ela é determinística e verificável por toda réplica. O que a antecipação evita é escrever 5 GiB no core para a mensagem ser recusada depois | §8.7 é exatamente este padrão (validação síncrona antecipa o que o `fold` decide); §15.4 lista `E_QUOTA_EXCEEDED` na linha do `blob.stage` |
| `peers`/`hostAvailable` saem do bitfield, ou não saem | §13.4 é explícito: "dados reais, não estimativa". Leitor sem `rangeStatus` (rig sem replicação) não publica evento nenhum — silêncio é melhor que número inventado | §13.4 passo 4, literal |
| `bytesDownloaded` = blocos locais × 64 KiB, com teto no declarado | A fatia é fixa por §13.2 (emenda de §47), então a conta é exata salvo o último bloco, que é parcial. O teto impede prometer mais bytes do que o anexo tem | §13.2 emendada (fatias de `BLOB_CHUNK_BYTES`); §13.4 passo 5 já trata o teto como limite duro |
| GC fecha leitor, **nunca** o core local | O core local é o que serve a comunidade e sustenta a regra 2 de §13.7; fechá-lo tiraria do ar os anexos do próprio autor | §13.7 regra 2; §22.4 fala de cache e staging, e a emenda estende à mesma família de recurso |
| Ao fechar um leitor, esquecer a marcação por mux | `attachTo` não é idempotente (lição de §45) — mas também não sobrevive ao `close`: sem limpar o done-set, um core reaberto nunca voltaria a replicar | §14.1/§16.1; é o outro lado da mesma lição |
| Índice novo **sem** bump de `VIEW_SCHEMA_VERSION` | `CREATE INDEX IF NOT EXISTS` roda em toda abertura: bases existentes ganham o índice sem reprojetar. O bump é para conteúdo derivado diferente, e nenhum byte derivado mudou | §10.3 lista os índices por tabela; §10.5 define reprojeção por descompasso de schema **de conteúdo** |

### 49.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §22.2 | emenda datada na linha `invite.topicSweep`: revogar/esgotar já saem pela reconciliação do lote; o job existe pela expiração, com o relógio local do host |
| `docs/backend-v2.md` §13.8 | emenda datada: `blob.stage` antecipa R-14 (`E_QUOTA_EXCEEDED`) com `storageUsedBytes` do DS, advisória no sentido de §8.7 |
| `docs/backend-v2.md` §22.4 | emenda datada: GC dos leitores esparsos de cores alheios — o que fecha, o que nunca fecha e por que a marcação por mux é esquecida junto |
| `docs/backend-v2.md` §15.5 | emenda datada nas linhas de blob: o campo viaja como `blobIdHex`; `peers` é contagem |
| `docs/backend-v2.md` §10.3 | `idx_attachments_ref(blobs_core_key, blob_id)` na linha de `attachments` |

### 49.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| `staging.gc` e os demais jobs de §22.2 | `outbox.expire`, `host.inactivity`, `succession.check`, `removed.purge`, `db.maintenance`, `log.rotate`, `ds.snapshot` — o runner existe e recebe cada um como uma linha; falta o corpo de cada job e, no `staging.gc`, o `hasReference` sobre a `view.db` | fase de jobs |
| `blob.progress` de download local | o loop só existe no caminho de rede; o caminho de busca local (rig) resolve antes de qualquer tick | irrelevante em produto; morre quando o caminho local sair |
| `identity.import` que reabre as comunidades | herdada de §48.3, sem mudança | fase de identidade/superfícies |
| `member.setBlobsCore` sem produtor | herdada de §48.3, sem mudança | superfícies de comunidade |
| Escalonador de §14.2, presença, sonda de NAT | herdadas de §45.3/§47.3 | ver §45.3 |

---

## 50. As consultas de leitura de §15.6 — estrutura, mensagens e derivados 2026-08-22

**Gate de entrada:** nenhum gate específico. A lacuna era de tamanho, não de decisão: de ~20
consultas de §15.6 existiam **três** (`query.search`, `query.community`, `query.invites`), e o
`projector` já materializava tudo que as outras precisam. Esta fase entrega a fatia de
**estrutura e mensagens** — oito consultas — e o produtor que faltava para uma delas.
Um módulo novo na raiz de composição (`core/src/composition/queries.ts`) e um em `l1/fold`
(`links.ts`); barreira `§4 ok — 78 arquivo(s), L0:8 L1:6 L2:12 L3:4 + raiz de composição
(7 arquivo(s))`; suíte 787 → **795 testes, 0 falha**, com `core/test/queries-leitura.test.ts`
percorrendo o caminho de produto inteiro (comunidade nasce por `community.create`, mensagens
entram pela outbox, o `projector` materializa, e só então as consultas respondem).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| `query.structure` | `queryReadPorts.structure` | §15.6, §23.2 | categorias e canais em `rank` crescente, `readOnly` calculado para quem pergunta, `muted`/`collapsed`/`unread` vindos do manifest |
| `query.messages` | idem | §15.6, §23.3 | cursor `(seq,id)` bidirecional, lote 50, `hasMore`; a página sai sempre em `seq` crescente |
| `query.message` | idem | §15.6 | reações agregadas com `mine`, anexo com estado do cache, thread enraizada, citação de mensagem removida |
| `query.pinned` / `query.files` / `query.links` | idem | §15.6, §23.2 | `seq` decrescente, cursor de 25 |
| `query.thread` | idem | §15.6 (DR-48) | raiz + respostas em `seq` crescente, `replyCount`, participantes, `unread` local |
| `query.reactors` | idem | §15.6 (DR-47) | total e os 24 primeiros por `at` |
| Extração de links no `fold` | `core/src/l1/fold/links.ts` + efeitos em `message.send`/`edit`/`delete` | §15.6.1 (DR-38) | `message_links` tinha tabela, tipo de efeito e índice — e **nenhum produtor**: `query.links` responderia vazio para sempre |
| Leitura do estado local | `ManifestDb.getReadState`/`getThreadReadState`/`isChannelMuted`/`collapsedCategories` | §10.2 | linha ausente é o estado inicial, não erro |
| `nickname` no `UserRef` | `queryUserRef` (`composition/ports.ts`) | §15.6 | vem do roster do DS; ausente quando não há |
| `VIEW_SCHEMA_VERSION` 3 → 4 | `core/src/l0/view/index.ts` | §10.3, §10.5 | conteúdo derivável mudou: uma `view.db` da versão 3 tem `message_links` vazia para toda mensagem já projetada |

### 50.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| As consultas moram na **raiz de composição**, não em L2 | Cada uma junta três fontes que não se conhecem: `view.db` (conteúdo), DS (quem é quem) e `manifest` (o que é local). Nenhum módulo de camada pode importar as três — é exatamente a definição de raiz de composição | §4 (a raiz importa qualquer módulo e não é importada); §8.4 (quem materializa é o `projector`, quem recorta é quem lê) |
| Ordenação e paginação vêm de §23, não de preferência | As duas tabelas de §23.2/§23.3 são fechadas; a página de mensagens sai em `seq` crescente **mesmo quando pedida para trás**, para a UI não inverter nada | §23.2 linha "Mensagens de canal"; §23.3 "nunca há paginação numerada" |
| Cursor é `base64url({seq,id})` e **opaco** | O par sobrevive a reprojeção (ids são determinísticos, §7.3) e não vaza offset. Forma inválida recusa na hora | §15.6.1, literal: `E_BAD_CURSOR` e a UI recomeça |
| `readOnly` é **para quem pergunta** | O campo é `boolean`, não uma lista: o único sentido possível é "este canal é somente-leitura para mim", calculado sobre os cargos que eu tenho AGORA | §6.7 (`readOnlyForRoleIds`), §15.6 (schema do canal) |
| A extração de links entrou no `fold`, não na consulta | §15.6.1 diz "o `fold` extrai … no efeito de `message.send`/`message.edit`". Calcular na leitura daria resultado diferente por versão de binário e deixaria `message_links` (tabela, efeito e índice já existentes) morta para sempre | §15.6.1 literal; §8.0 (o mesmo registro produz o mesmo estado em toda réplica) |
| `host` é o **hostname**, não o registrable domain | Registrable domain exige PSL, e PSL muda com o tempo: o mesmo log daria estados diferentes em binários diferentes. Entre derivado instável e derivado exato porém mais longo, o `fold` fica com o estável | §8.0 (determinismo é a propriedade central do `fold`); emenda registrada em §15.6.1 |
| Bump de `VIEW_SCHEMA_VERSION` | Aqui o conteúdo **derivável** mudou (links de toda mensagem antiga faltam), que é o critério do bump — diferente do índice de §49, onde nenhum byte derivado mudou | §10.3/§10.5 (descompasso de schema ⇒ reprojeção total no boot) |
| `collision` continua `false`, e isso virou emenda | L-5 manda o `fold` marcar colisão de `displayName`; nem o DS nem a coluna da `view.db` têm produtor. Calcular na leitura seria regra de domínio fora do `fold` | §6.1 L-5; §4 e §8.0 — a lacuna é do `fold` e fecha lá |
| `availablePeers`/`hostAvailable` do `AttachmentDto` fora de download são `0`/`false` | São leitura do bitfield vivo (§13.4 passo 4). Não existe registro persistente de pares, e §13.4 é explícito: dado real, não estimativa | §13.4 passo 4; emenda em §15.6.1 declarando o significado |
| `replyTo.author` é opcional | Há um caso, e um só, em que não há autor a nomear: a mensagem citada não está projetada aqui. `deleted: true` seria mentira — ela pode estar viva e ainda não replicada | §15.6.1 (`excerpt: null`/`deleted` cobrem a remoção, não a ausência) |

### 50.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §15.6.1 | emenda datada na extração de links: `host` é o hostname (com o motivo de determinismo), URL repetida entra uma vez, edição reescreve e tombstone remove |
| `docs/backend-v2.md` §15.6 | emenda datada em `UserRef.collision` (sempre `false` até o `fold` marcar L-5) e em `AttachmentDto.availablePeers`/`hostAvailable` (leitura viva; `0`/`false` fora de download) |

### 50.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~Produtores de `unread`/`muted`/`collapsed`~~ | ~~as quatro tabelas locais de §10.2 são lidas mas ninguém as escreve: faltam `channel.markRead`, `thread.markRead`, `channel.setMuted`, `category.setCollapsed` (§15.4 "Preferências locais")~~ **entregue**, ver §53 | ~~fatia de preferências~~ |
| `voice` em `query.structure` (RT-05) | a ocupação por canal existe no lado host (`VoiceHostSessions`); falta a fonte para quem **não** hospeda | fase de presença |
| Colisão de `displayName` (L-5) | o `fold` precisa marcar `displayNameCollision` no DS e na `view.db`; a consulta já tem o campo | `fold` |
| ~~Comandos estruturais~~ | ~~`channel.create/update/move/delete`, `category.create/rename/delete`, `community.update` — a fatia de **escrita** desta mesma superfície~~ **entregue**, ver §51 | ~~próxima fatia~~ |
| Demais consultas de §15.6 | `query.members/member/roles/bans/timeouts/auditLog` entregues na §52; o estado local do leitor (outbox, communities, preferences, hostStatus, selfModeration, resolveMessageLink) entregue na §53 | ver §53.3 pelo que resta |
| Herdadas | §49.3 sem mudança (jobs restantes, `identity.import`, escalonador de §14.2) | ver §49.3 |

---

## 51. A escrita da estrutura: canais, categorias e `community.update` 2026-08-22

**Gate de entrada:** nenhum gate específico — a segunda metade da fatia de estrutura de §50.
Oito comandos ⏱ passam a existir na fronteira; a regra continua toda no `fold` (R-6, R-7,
R-20, R-26 e os limites de §8.6). Um módulo novo na raiz de composição
(`core/src/composition/structure.ts`); barreira `§4 ok — 79 arquivo(s), L0:8 L1:6 L2:12 L3:4
+ raiz de composição (8 arquivo(s))`; suíte 795 → **801 testes, 0 falha**, com
`core/test/estrutura-comandos.test.ts` conferindo cada comando pela leitura de §50
(`query.structure`), não por consulta de teste.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| `channel.create` / `update` / `move` / `delete` | `composition/structure.ts` | §15.4, §7.4 | id derivado por §7.3; `rank` lido do DS depois da projeção; `E_CHANNEL_NAME_TAKEN`, `E_CATEGORY_NOT_FOUND` e `E_LAST_CHANNEL` vêm do `fold` |
| `category.create` / `rename` / `delete` | idem | §15.4 | as duas formas do delete, com `movedChannels`/`deletedChannels` **lidos** do estado projetado |
| `community.update` | idem | §15.4 | `manage_community`; update sem nenhum campo é `E_VALIDATION` |
| Dica de posição id → rank | `dicasDeRank` | R-20 | "depois de X" vira o par `(rank de X, rank do seguinte)` e cai **entre** os dois |
| `droppedQueued` do `channel.delete` | `Outbox.discardForChannel` | §11.7 | as ops enfileiradas para o canal viram `dropped{channel-deleted}` — o primeiro produtor desse motivo |
| `submitSync` devolve `authorSeq`/`opId` | `l2/communityClient` | §7.3 | é o que permite nomear a entidade criada sem esperar a projeção |
| **Defeito corrigido:** escopo de `authorSeq` escolhido pela forma do payload | `resolveScope` (`l2/communityClient/submit.ts`) | §7.5 | qualquer payload com `channelId` virava escopo de canal — logo `channel.update`/`move`/`delete` eram assinados com escopo errado e o `fold` os recusava com `E_VALIDATION{sequenceScope}`. Agora quem decide é o **kind** |

### 51.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| A fronteira endereça por **id**, a op carrega **rank** — e a conversão é da composição | §15.4 fala `afterChannelId`; §7.4 carrega `afterRank`/`beforeRank`. Converter exige ler o DS, que nem o `opCodec` nem o renderer podem | §15.4 e §7.4, literais; §4 (quem lê o DS e monta a op é a raiz) |
| "Depois de X" manda **os dois** vizinhos | Só `afterRank` faria o item cair no fim do escopo quando o cliente estivesse atrasado; o par é o que `rankBetween` espera para inserir entre X e o seguinte | R-20 (a própria função documenta o caso do cliente atrasado) |
| `rank` e as contagens **esperam a projeção**, e somem se o prazo vencer | São decisão do `fold`. Recalculá-las aqui seria escrever R-20/R-7 uma segunda vez, e as duas cópias divergiriam no primeiro caso de borda | §8.0/§8.4; emenda em §15.4 declarando quando o campo existe |
| O id não espera nada | §7.3 o deriva de `communityId ‖ sequenceScope ‖ authorKey ‖ authorSeq`, e `authorSeq` é conhecido no instante da submissão. É a **mesma** função que o `fold` usa (`entityId`), não uma segunda implementação | §7.3 |
| `category.delete` tem duas formas, não três | §15.4 dá `moveChannelsTo` **ou** `deleteChannels:true`. Pedir as duas é entrada incoerente — e "qual vence" seria comportamento inventado | §15.4; emenda registrando a recusa |
| A lista de kinds escopados por canal existe **duas vezes**, com teste de igualdade | §4 não dá `fold` a `communityClient`, e a barreira recusou o import. Repetir a lista com um teste que compara as duas é mais honesto do que enfraquecer a fronteira | §4 (fronteira de camadas); §7.5 (a regra é uma só) |
| `channel.delete` derruba a fila **local** do canal | O canal deixou de existir: cada op enfileirada para ele viraria `E_CHANNEL_NOT_FOUND` no host, uma por uma, sem motivo nomeado para a UI | §11.7 (`channel-deleted`), que até aqui não tinha produtor |
| Permissão conferida na composição **e** no `fold` | A conferência local é advisória: dá o erro certo sem ida ao host. Quem decide é o `fold`, contra o DS do host no `hostTs` da admissão | §8.7 ponto 1; §7.4 coluna Perm. |

### 51.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §15.4 "Canais e categorias" | emenda datada: `channelId`/`categoryId` sempre presentes (§7.3); `rank` e contagens dependem da projeção local e ficam ausentes se o prazo vencer; `category.delete` tem duas formas e pedir as duas é `E_VALIDATION` |
| `docs/backend-v2.md` §11.7 | emenda datada na linha `channel-deleted`: o produtor é o `channel.delete` local; tombstone feito por outra pessoa ainda não derruba a fila local |

### 51.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| `channel-deleted` por tombstone alheio | quando **outra** pessoa apaga o canal, a fila local segue até o host recusar; o lugar do descarte é o gancho de lote projetado (`notifyProjected`), que já existe | fase de jobs/eventos |
| Ordem de quem nasce sem dica | item criado sem `afterChannelId`/`afterCategoryId` cai no piso da escala de R-20 — que, em `rank` crescente (§23.2), é a **primeira** posição da lista. É o comportamento do `fold` desde G1; se a UX quiser "no fim", quem manda a dica é a UI | UX / `deltas-ux-v2.md` |
| Preferências locais | ~~`channel.markRead`, `thread.markRead`, `channel.setMuted`, `category.setCollapsed` — os produtores do que §50 já lê~~ **entregue**, ver §53 (junto com `nav.setActive` e `settings.*`) | ~~fatia de preferências~~ |
| Demais consultas e comandos de §15.6/§15.4 | membros, cargos e moderação **entregues na §52**; estado local do leitor **entregue na §53**; faltam `community.end`/`forget`/`activate` e `identity.*` | fatias seguintes |
| Herdadas | §50.3 sem mudança | ver §50.3 |

---

## 52. Membros, cargos e moderação — as superfícies de §15.4/§15.6 que decidem quem manda 2026-08-22

**Gate de entrada:** nenhum gate específico — terceira fatia do mesmo programa de §50/§51.
Onze comandos ⏱ de escrita (`role.create/update/move/delete`, `member.setRoles`,
`member.setNickname`, `mod.kick/ban/revokeBan/timeout/removeTimeout`) e seis consultas de
leitura (`query.members/member/roles/bans/timeouts/auditLog`). A regra continua inteira no
`fold`; módulo novo na raiz de composição (`core/src/composition/moderation.ts`) e acréscimo
a `queries.ts`. Barreira `§4 ok — 80 arquivo(s), L0:8 L1:6 L2:12 L3:4 + raiz de composição
(9 arquivo(s))`; suíte 801 → **812 testes, 0 falha**, com
`core/test/moderacao-superficie.test.ts` no caminho de produto inteiro (comunidade por
`community.create`, ops pela ponte ⏱, conferência sempre pela leitura de §15.6). G12
rebuildado nos dois perfis após a mudança.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| `role.create` / `update` / `move` / `delete` | `composition/moderation.ts` | §15.4 | id derivado por §7.3 na hora; `rank` lido do DS depois da projeção; `affectedMembers`/`clearedChannelRefs` são o delta confirmado no estado projetado (F-31) |
| `member.setRoles` / `member.setNickname` | idem | §15.4 | `appliedRoleIds` é o conjunto efetivamente aplicado (§8.4.1 descarta o id desconhecido); apelido limpa com `null` |
| `mod.kick` / `ban` / `revokeBan` / `timeout` / `removeTimeout` | idem | §15.4 | ban de não-membro é APPLIED (R-28); contagens são o delta desta op — re-ban idempotente responde zero; hierarquia nunca duplicada (`E_FOUNDER_IMMUNE` veio do `fold`) |
| Permissões nomeadas → números de protocolo | `permissoesParaNumeros` | §9.1 | nome desconhecido é `E_VALIDATION{permissions}` ANTES de assinar — número inventado no log seria concessão silenciosa |
| `query.roles` | `queryReadPorts.roles` | §15.6, §23.2 | `rank` **decrescente**, permissões como nomes, `memberCount` do projector |
| `query.members` | idem | §15.6, §23.2/§23.3 | grupo pelo cargo de maior `rank`, alfabético por `nickname ?? displayName` com desempate por `handle`; offline agregado; cursor na ordem plana |
| `query.member` | idem | §15.6 | perfil completo; os campos `can*` usam a MESMA resolução de hierarquia do `fold` (`hierarchyTargetOf` + `authorizeOverTarget`), não uma segunda implementação |
| `query.bans` / `timeouts` / `auditLog` | idem | §15.6, §23.2/§23.3 | mais recente primeiro, cursor, lote 25 (teto); `expired` contra o `lastHostTs` interpretado |
| Enforcement de leitura (DR-25/T-44) | `exigir` sobre o DS local | §15.6.1, L-10 | sem `view_audit_log` (ou `ban_members`, para bans) as três listas respondem `E_PERMISSION_DENIED` |

### 52.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| Mesma régua de §51: regra no `fold`, fronteira traduz e recorta | Os campos derivados (`rank`, `appliedRoleIds`, contagens) só existem depois que o `projector` alcança o `seq`; recalculá-los seria escrever R-12/R-16/R-28 uma segunda vez, e as cópias divergem no primeiro caso de borda | §8.0/§8.4; emendas datadas em §15.4 ("Cargos e membros" e "Moderação") declarando quando cada campo existe |
| As contagens de `mod.ban`/`revokeBan` são o **delta** da op | Um re-ban idempotente decide nada: responder "total da história" misturaria ops distintas numa resposta única e mentiria no caso mais comum, o retry | §8.4.1 (idempotência sem janela); emenda datada |
| Ban de não-membro **não é recusado na fronteira** | É ban preventivo — o mecanismo pelo qual a continuação carrega os bans da origem; recusar mataria a função sem ganho nenhum. Os demais `mod.*` de não-membro recusam, e isso veio do `fold` (`E_NOT_FOUND`) | R-28; §8.4.1 |
| Hierarquia NÃO é conferida duas vezes | A fronteira confere a permissão nomeada (erro certo sem ida ao host) mas nunca R-4/R-16: quem recusa com `E_HIERARCHY`/`E_FOUNDER_IMMUNE`/`E_HOST_IMMUNE`/`E_SELF_TARGET` é o `fold`. O teste fixou a ORDEM de §9.3: imunidade do Fundador antes da auto-referência | §8.7 ponto 1; §9.3 (ordem do estágio 12) |
| Permissões viajam como NOMES no IPC e como números na op | O número é constante de protocolo (§27.1) e material assinado; nome desconhecido recusa ANTES de assinar, porque número inventado no log é concessão silenciosa | §9.1 literal ("um `u8` fora de 0..16 é `E_VALIDATION`") |
| Os campos `can*` de `query.member` reusam `hierarchyTargetOf` + `authorizeOverTarget` | É affordance de UI ("posso tentar?"), não decisão — mas chamar a MESMA função do pipeline é a única forma de não implementar R-4/R-16 pela segunda vez. Sem alvo de hierarquia (cargo a si mesmo), "pode tentar" | §9.3; §8.7 (quem decide num comando real é o `fold`) |
| `query.members`: `roleId` filtra para UM grupo de portadores | A pergunta da UI é "quem tem X", não "quem é encabeçado por X"; a regra de agrupamento de §23.2 descreve o roster sem filtro | §23.2 linha "Membros" (sem filtro declarado — decisão registrada) |
| `presence` ausente e `onlyOnline` respondendo vazio | Presença é local e efêmera e não tem produtor desde §44.3. Campo sem fonte fica ausente; filtro sem fonte responde vazio — nunca valor inventado | Precedente §46/§50; §6.1 L-5 análogo (`collision`) |
| Bans/timeouts ordenados por `at` com cursor `{seq: at, id}` | As tabelas não têm `seq`; `at` é monotônico por R-1 e o desempate pela chave do alvo fecha a ordem total. Emendas datadas em §15.6 | §23.2 ("mais recente primeiro" é a propriedade; `seq` era o meio); §20.2 (`E_BAD_CURSOR` intacto) |
| `query.bans` só lista bans vivos | O schema da resposta não declara `revokedAt`; quem foi revogado não está banido (e volta por convite). O histórico completo já está no `auditLog` | §15.6 schema da resposta; §18.2 (reversibilidade) |

### 52.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §15.4 "Cargos e membros" | emenda datada: `roleId` sempre presente (§7.3); `rank`/`appliedRoleIds` dependem da projeção local; `affectedMembers`/`clearedChannelRefs` são delta lido do estado projetado |
| `docs/backend-v2.md` §15.4 "Moderação" | emenda datada: as contagens são o delta desta op; re-ban idempotente responde zero; hierarquia é do `fold` |
| `docs/backend-v2.md` §15.6 | emenda datada: ordenação de bans/timeouts por `at` (cursor `{seq: at, id}`) e `query.bans` só com bans vivos |

### 52.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| Produtor de presença (§6.1/§44.3) | enquanto não existir, `presence` fica ausente, `onlyOnline` responde vazio e `offlineCount === total` | fase de presença |
| Colisão de `displayName` (L-5) | segue `false` até o `fold` marcar; herdado de §50.3 sem mudança | `fold` |
| ~~Demais consultas de §15.6~~ | ~~outbox, preferences, hostStatus, communities, selfModeration, resolveMessageLink~~ **entregues na §53** | — |
| Comandos restantes de §15.4 | `community.end`/`forget`/`activate`, preferências locais, voz/tela/relay além do já entregue | fatias seguintes |
| Herdadas | §50.3/§51.3 sem mudança adicional | ver §51.3 |

---

## 53. O estado local do leitor: não-lidas, preferências, fila e status 2026-08-22

**Gate de entrada:** nenhum gate específico — a fatia que faz a UI parar de mentir. Até
aqui `query.structure` lia `unread`/`muted`/`collapsed` das tabelas de §6.15 e **ninguém as
escrevia**; `channel.markRead`, `nav.setActive` e as consultas de fila/rail eram linhas sem
dono. Nove comandos locais (§15.4 "Preferências locais"), o produtor de não-lidas e seis
consultas (`query.outbox/communities/preferences/hostStatus/selfModeration/
resolveMessageLink`). Módulos novos na raiz de composição: `unread.ts` (o recalcador) e
`preferences.ts`; acessores LS em `l0/manifest`. Barreira `§4 ok — 82 arquivo(s),
L0:8 L1:6 L2:12 L3:4 + raiz de composição (11 arquivo(s))`; suíte 812 → **822 testes,
0 falha**, com `core/test/estado-local.test.ts` no caminho de produto inteiro. G12
rebuildado nos dois perfis.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Recálculo de não-lidas | `composition/unread.ts` + gancho `notifyProjected` | §6.15 (emendada) | contagem pela query de definição no lote projetado; do zero na primeira marca e quando os cargos locais mudam |
| `unread.changed` | idem, via `EventFanout` | §15.5 | payload com os campos exatos da tabela (`communityId`, `channelId?`/`threadId?`, contagens) |
| `channel/thread.markRead` | `preferences.ts` → tracker | §15.4, RT-03 | watermark avança à cabeça; resposta zero **literal** |
| `channel.setMuted` / `category.setCollapsed` / `nav.setActive` / `settings.*` | `preferences.ts` | §15.4, DR-32/DR-45 | escrita direta no LS; navegação dono único (presente define, ausente limpa) |
| `query.outbox` | `queryReadPorts.outbox` | §15.6 (F-16) | preview decodificado do PRÓPRIO envelope (`opCodec`), `kindLabel`, `channelName`, `counts` |
| `query.communities` | idem | §15.6, §23.2 | ordem de entrada (`joined_at`), agregado de não-lidas do LS, `partialInterpretation` |
| `query.preferences` / `query.hostStatus` / `query.selfModeration` | idem | §15.6, §18.4 | LS inteiro para redesenhar telas; replicação como única fonte viva do hostStatus |
| `query.resolveMessageLink` | idem | §15.6 (RT-04) | MSGREF = `communityId ‖ opId` (emenda em §3.5); os cinco status |

### 53.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| O cálculo de não-lidas mora na **raiz de composição**, disparado pelo gancho de lote projetado — não no projector, não no fold | `local_read_state` está no `manifest.db` (outro banco) e é por instalação; o `Effect` de §8.4 é tipo fechado sobre CS, e o mesmo log não pode produzir contagens diferentes por réplica. O gancho dá o gatilho no MESMO passo síncrono do fan-out | §1.3 (as três classes de estado); §8.0; emenda datada em §6.15 substituindo "atualizado pelo projetor" |
| Recontar = canais tocados pelo lote **∪** canais já com linha no LS | Mutação de linha VELHA (edição, tombstone, ocultação/reversão de ban por `patchScope`) não move `seq` — só pode alterar contagem onde existe não-lida, e toda canal ativo ganha linha na primeira varredura. A contagem em si continua sendo a query de definição sobre `seq > lastReadSeq`: acumulador nenhum, logo sem contagem dupla (F-25/F-48) | §6.15 literal ("a contagem É uma query", não um estado incremental); emenda datada |
| Do zero na primeira marca E quando a assinatura dos cargos locais muda | A marca nasce ausente no boot/reprojeção (varre tudo); `pendingMentions` depende dos cargos AGORA, então cargo novo pode transformar menção dormente em pendente — testado ponta a ponta | §6.15 ("recomputado do zero… cargos da identidade local") |
| Linha de thread é criada mesmo com contagem zero | É ela que coloca a thread no conjunto "já conhecido"; sem isso, uma resposta alheia disfarçada depois da projeção ficaria invisível — o teste pegou exatamente este buraco | Consequência direta da regra anterior |
| `markRead` responde zero literal (não promessa) | O comando avança o watermark à cabeça do canal e reconta NA HORA: `{unreadCount: 0, pendingMentions: 0}` é fato medido, não esperança | §15.4 declara os dois campos (fecha RT-03) |
| `nav.setActive`: presente define, ausente limpa | DR-32 manda ser dono ÚNICO — o comando declara o estado inteiro da navegação; "ausente = mantém" criaria um segundo dono parcial | DR-32; decisão registrada |
| `settings.setNotifications` sem `communityId` é flag global em `local_device_pref` | A tabela singleton de dispositivo é o lugar natural de LS para um flag da instalação; nível por comunidade já tem casa (`notificationLevel`) | Micro-emenda datada em §6.15 |
| Preview da fila sai do envelope decodificado | O envelope JÁ está em `local_outbox` (§11.2); um campo de preview no schema seria conteúdo derivado armazenado duas vezes. Envelope ilegível → preview vazio (§8.5: normaliza, não lança) | §15.6 F-16; §11.2 |
| MSGREF = `communityId ‖ opId` | Os dois são estáveis entre réplicas; a primeira metade nomeia a comunidade antes de qualquer procura (`not-member` sem tocar nada); `observed_ops` já indexa o par. Qualquer alternativa inventaria um segundo id de mensagem ou exigiria dado inexistente | Emenda datada em §3.5; §7.3 (ids determinísticos) |
| `not-synced` responde SEM `channelId` | Antes da projeção ninguém sabe o canal da op — responder um canal seria inventá-lo. Campo presente só nos status que conhecem a mensagem | Precedente §46/§50 (campo sem fonte fica ausente); emenda datada em §15.6 |
| Volume padrão 100, id de dispositivo ausente | 100 = "sem atenuação", o neutro honesto para um slider sem escolha; id sem escolha não tem valor para inventar | §15.6 schema vs. precedente de ausência |
| `hostStatus`/`inactiveDays` sem produtor ficam ausentes | Nada acompanha hoje a conexão com o host (DR-29/DR-33 sem dono); a replicação é a única fonte viva | Precedente de §46/§50 |

### 53.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §6.15 | emenda datada: o cálculo de não-lidas mora na raiz de composição, disparada pelo lote projetado (com o algoritmo de escopo); micro-emenda: `notificationsEnabled` em `local_device_pref` |
| `docs/backend-v2.md` §3.5 | emenda datada: MSGREF = base64url(`communityId(32) ‖ opId(32)`) |
| `docs/backend-v2.md` §15.6 | emenda datada: `resolveMessageLink` responde `not-synced` sem `channelId` |

### 53.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~Produtor de presença/typing (§44.3)~~ | ~~`presence.changed`/`typing.changed` continuam sem fonte; `onlyOnline` segue respondendo vazio~~ **implementado em 2026-08-23 — §54**: `presence.changed`/`typing.changed` com produtores, `presence` em `query.members/member`, `onlyOnline` filtrando de verdade. A escolha de presença do próprio usuário (`identity.setPresence`) segue para a fase de identidade | — |
| ~~Acompanhamento de conexão com o host (DR-29/DR-33)~~ | ~~`status`/`lastSeenAt`/`attempt` de `query.hostStatus` e `inactiveDays`/`hostStatus` de `query.communities` aguardam esse produtor; `lastHostSeenAt` segue sem escritor~~ **implementado em 2026-08-23 — §54**: máquina fechada de §15.6 em `composition/hostStatus.ts`, `last_host_seen_at` escrito no contato observado, `inactiveDays` derivado na leitura | — |
| Colisão de `displayName` (L-5) | segue `false` até o `fold` marcar | `fold` |
| Varredura incremental mais fina | o recálculo reconta todo canal com linha a cada lote; correto e barato na escala v1, mas a janela por canal pode ficar mais apertada se a réplica engolir log grande | otimização futura |
| Comandos restantes de §15.4 | `community.end`/`forget`/`activate`, `identity.*` (dependem de shell e IPC-M) | fatias seguintes |
| Herdadas | §50.3/§51.3/§52.3 sem mudança adicional além das entregas riscadas acima | ver §52.3 |

---

## 54. O núcleo vivo: status do host, presença/digitando e os jobs que faltavam 2026-08-23

**Gate de entrada:** nenhum gate específico — a fatia que dá aos campos deixados ausentes
em §53 os seus produtores, e dá corpo aos jobs que o runner de §49 já sabia agendar. Três
frentes que se fecham juntas. Módulo novo na raiz de composição: `hostStatus.ts`; o runner
de `jobs.ts` ganhou o gêmeo `startLoops` para os loops permanentes de §22.1 (mesma
disciplina de rearme pós-execução e cancelamento no `close`, §22.5 — nada de `setInterval`
solto). Barreira `§4 ok — 83 arquivo(s), L0:8 L1:6 L2:12 L3:4 + raiz de composição (12
arquivo(s))`; suíte 822 → **832 testes, 0 falha**, com `core/test/nucleo-vivo.test.ts`
caminhando o produto inteiro (máquina de status, presença ponta a ponta host↔membro sobre
par RPC em memória, e os corpos dos jobs).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| Máquina de §15.6 por comunidade | `composition/hostStatus.ts` | §15.6, DR-29/DR-33 | enum fechado com fontes reais; terminais (`forked`/`unauthorized`/`ended`/`incompatible`) vencem o dinâmico |
| `host.statusChanged` | idem, via `EventFanout` | §15.5 | payload exato da tabela (`communityId`, `status`, `lastSeenAt?`, `attempt?`) |
| `lastHostSeenAt` no LS | `manifest.getLast/setLastHostSeenAt` | §6.15 | escrito no primeiro contato, em cada contato renovado e no nascer do modo hospedeiro |
| `inactiveDays` + job `host.inactivity` | derivação na leitura + travessia do limiar sinalizada | §22.2, §15.6 | rail mostra os dias; travessia de `INACTIVE_COMMUNITY_DAYS` sai por `host.statusChanged`, uma vez |
| `host.cameBack` → reconcile + flush com jitter | `hostStatus.ts` | §11.8, §22.1, §22.3 | reconciliação imediata; flush agendado após `RECONNECT_FLUSH_DELAY_MS + hash(identityKey) mod 2000`, taxado a `FLUSH_RATE_PER_S/s` |
| Handlers `presencePublish`/`subscribeChannel` no host | `ports.wireHostPresenceRpc` | §16.2, §17.6 | tetos 1/5 s e 1/2 s por autor/canal (`E_RATE_LIMITED`); origem é a chave da conexão |
| Push do host: `presence.changed`/`typing.changed` | callbacks do `PresenceManager` → `empurra` | §16.3, §17.6 | delta agregado no tick; typing só a assinantes do canal; payload de §16.3 SEM `communityId`, evento IPC COM |
| Loops de §22.1 | `composition/jobs.ts` (`startLoops`) + corpos no boot | §22.1 | `presence.tick` 2 s (host), `typing.expire` 1 s (host), `presence.refresh` 15 s (todo nó) |
| `presence` em `query.members`/`query.member` | `queryReadPorts` | §15.6, §6.1 | entrada viva → `{presence}`; sem entrada → campo AUSENTE (`offline` nunca é escrito); `onlyOnline` filtra de verdade; `offlineCount = total − vivos` |
| `query.hostStatus`/`query.communities` completos | idem | §15.6 | `status`/`lastSeenAt`/`inactiveDays`/`attempt?` com as ausências da emenda datada |
| Corpos de §22.2 | boot (`startJobs`) | §22.2 | `outbox.expire` reconcilia antes de descartar; `staging.gc` com `hasReference` na `view.db` + fila; `removed.purge` apaga LS+CS+disco; `db.maintenance` (optimize + WAL > 64 MiB); `log.rotate` (§24.1); `succession.check` (avaliação pura); `ds.snapshot` no `draining` |

### 54.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| O status do host mora na raiz de composição, não no DS nem no fold | "O host visto por MIM" é fato POR INSTALAÇÃO: o mesmo log produziria estados diferentes por réplica se fosse dado replicado, e o `Effect` de §8.4 é tipo fechado sobre CS. As fontes (canal de §16.1, resultado de submissão, watchdog de §14.5, DS) já estão nesta raiz | §1.3 (três classes de estado); §8.0; precedente de §53 (não-lidas) |
| Estados terminais avaliados NAS FONTES a cada leitura, não como transições armazenadas | Transição perdida (fork detectado enquanto o tracker dorme) viraria estado mentiroso para sempre; ler `CommunityClient`/DS na hora elimina a classe do bug com custo zero | §14.5 (os estados são deriváveis de métricas observáveis) |
| `incompatible` é pegajoso | Nada nesta fase des-marca: quem entrou em `E_VERSION_UNSUPPORTED` só sai com novo binário (novo processo, novo tracker). Desmarcar dentro da sessão seria fingir renegociação que não existe | §16.3 ("somente-leitura… até nova versão"); §11.6 regra 3 |
| `reconnecting` exige contato anterior; sem nenhum, `offline` | `reconnecting` afirma "estou tentando de novo ALGUÉM QUE EU VI"; sem contato nenhum a frase honesta é outra. Ambos vêm de eventos reais do transporte (`onDown`), nunca de suposição | §16.1 (reconexão na conexão seguinte); precedentes de campo-sem-fonte |
| `cameBack` reconcilia IMEDIATO e flusha com jitter + taxa | A reconciliação primeiro evita o bloqueio de canal por op `awaiting-confirmation` nunca confirmada; o jitter por identidade é o que impede a avalanche de reconexão em fase de §22.3 | §11.8 (fecha DS-10); §22.1; lição de rig de §45–§53 |
| `presencePublish` com o MESMO status dentro da janela de 5 s é no-op, não `E_RATE_LIMITED` | O método carrega presença E typing com tetos independentes; barrar o typing porque a presença repetida não tem informação nova seria trocar a proteção do fio por um bug de UX. Status DIFERENTE continua limitado — é ele que custa fan-out | Emenda datada em §16.2; mapeamento `messageStore.setTyping → presencePublish{typingChannelId}` (deltas-ux/frontend); §17.6 (o teto protege o fio, não a semântica) |
| Delta de presença só com mudanças; expiração sai pela AUSÊNCIA na consulta | A tabela de §15.5 é fechada (`{communityId, entries[]}`): não há `removed[]` no fio, e colocar `status:'offline'` em `entries` violaria §6.1. A UI reconsulta por sinal (§15.1 regra 5) e o TTL corrige em ≤ 45 s (L-13) | §15.5 tabela fechada; §6.1; L-13 declarada |
| `typing.changed` vai só a assinantes; sem assinante, nem sai | É o redesenho de §17.6 (broadcast de canal aberto, não de comunidade). No membro, os quadros são INGERIDOS no estado local e NÃO reemitidos ao renderer — o runtime de mídia já encaminha esses tópicos, e duplicar seria evento repetido | §17.6; §16.3 regra 2; economia de fio medida no G9-pendente |
| `presence` ausente para quem está offline; `onlyOnline` passa a filtrar | Com produtor, o filtro honesto deixa de ser vazio; o VALOR continua não existindo para offline — ausência é a representação, como sempre foi | §6.1 (`offline` nunca é escrito); §23.3 (offline agregado); precedente §52.3 |
| `inactiveDays` derivado na leitura; o job sinaliza a TRAVESSIA do limiar | Armazenar uma função pura de `(agora, lastHostSeenAt)` criaria segunda fonte para o mesmo fato. O trabalho real do job é vigiar o limiar de `INACTIVE_COMMUNITY_DAYS` e avisar por `host.statusChanged` — único sinal da tabela fechada que nomeia o relacionamento com o host | Emenda datada em §22.2; §15.5 tabela fechada; §27.2 |
| `outbox.expire` É uma reconciliação | §11.6 regra 1 proíbe descarte por idade fora dela; o corpo do job é chamar `reconcile()` por comunidade — a regra de idade vive DENTRO do algoritmo, na ordem certa depois das checagens de observação/watermark/mismatch | §11.6 (fecha DS-06/DS-07); §22.2 |
| `staging.gc` confere referência na `view.db` E na fila ativa | Uma op de `message.send` pendente referencia o blob antes de qualquer projeção; varrer o envelope bruto por `(blobsCoreKey, hash)` é conservador na direção certa (mantém em vez de apagar). Staging sem comunidade/core conhecidos é mantido — sem fonte, nenhuma poda. A faixa de blocos escrita no stage (`blob_ranges`) é o que torna o `core.clear` preciso, sem tocar anexos vivos do mesmo core | §13.5; §13.7 regra 1; §22.4 |
| `removed.purge` esquece do runtime ANTES de purgar | Job zumbi escrevendo em banco purgado é exatamente o crash que §22.5 descreve. A ordem é: forget → sair do swarm → LS → CS (+FTS pelo mesmo comando contentless-delete do projector) → disco (core do log e core de blobs local) | §18.4 passo 6; §10.7; §22.5 |
| `log.rotate` roda sem produtores de log | A rotação/retenção/teto de §24.1 é manutenção de arquivos existentes; os PRODUTORES de NDJSON chegam com o shell. Inventar um subsistema de log inteiro nesta fatia iria além do menor passo coerente | §24.1; §27.2 (`LOG_RETENTION_DAYS`, `LOG_MAX_TOTAL_BYTES`) |
| `succession.check` avalia e não oferece ainda | A oferta de assumir é superfície de UI (U-18) que depende do shell; inventar tópico de evento violaria a tabela fechada de §15.5. O corpo existe: `SuccessionService.checkEligibility(cid)` é a camada b de R-18 em forma consultável, chamada pelo runner | §18.8; §22.2; U-18 |
| `ds.snapshot` sem linha no runner | Por contagem já é do projector (§10.6, cadência `DS_SNAPSHOT_INTERVAL`); "no draining" virou o primeiro passo do `close()` do runtime. Período fixo nenhum lhe corresponde — encaixá-lo no runner seria inventar cadência | §10.6 literal; §22.2 ("por contagem e no draining") |

### 54.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §15.5 | emenda datada: `presence.changed{entries[]}` carrega só as mudanças; expiração sai pela ausência na consulta (tabela fechada + §6.1) |
| `docs/backend-v2.md` §16.2 | emenda datada: `presencePublish` com tetos independentes para presença e typing; MESMO status dentro da janela é no-op, status diferente é `E_RATE_LIMITED` |
| `docs/backend-v2.md` §22.2 | emenda datada: `inactiveDays` derivado na leitura; `host.inactivity` sinaliza a travessia do limiar por `host.statusChanged` |
| `docs/backend-v2.md` §15.6 | emenda datada: `query.hostStatus` sem `lastSeenAt`/`inactiveDays` enquanto não há contato observado; `inactiveDays` derivado do LS; `attempt` só acima de zero |

### 54.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~Escolha de presença local~~ | ~~`identity.setPresence{presence}` (§15.4) define o status publicado pelo refresh; hoje o default honesto é `online`, e `invisible` já é respeitado pelo loop~~ **implementado em 2026-08-23 — §56** | — |
| ~~Gatilho de assinatura de typing no membro~~ | ~~quem chama `subscribeChannel{channelId,on}` é a UI quando abre canal; a capacidade existe no serviço e no fio, falta o comando IPC-R que a dispara~~ **implementado em 2026-08-23 — §56**: `channel.subscribeTyping` (emenda datada em §15.4) | — |
| ~~Demais loops de §22.1~~ | ~~`outbox.flush` (1 s), `outbox.reconcile` (30 s), `replication.watchdog` (5 s), `metrics.flush` (10 s) seguem disparados pelos seus gatilhos próprios/manuais~~ **implementados em 2026-08-23 — §55**, exceto `metrics.flush`, que aguarda os produtores de log (§24.3) e continua listado abaixo | — |
| ~~Produtores de log NDJSON~~ | ~~`log.rotate` mantém o layout de §24.1; quem ESCREVE `logs/core-*.ndjson` chega com o shell~~ **implementado em 2026-08-23 — §56**: `NdjsonLogger` com allowlist estrutural de §24.2, produtores nas transições do host, desfechos da fila, watchdog e boot | — |
| Oferta de sucessão (U-18) | `checkEligibility` avalia; o shell e `identity.*` existem desde §56 — falta a TELA de oferta (frontend fora do núcleo) | fase de UI |
| Colisão de `displayName` (L-5) | segue `false` até o `fold` marcar | `fold` |
| Comandos restantes de §15.4 | `community.end`/`forget`/`activate`, resto de `identity.*` | fatias seguintes |
| Herdadas | §50.3–§53.3 sem mudança adicional além das entregas riscadas acima | ver §53.3 |

---

## 55. O núcleo vivo, por completo: os loops de §22.1 que faltavam e o hello 2026-08-23

**Gate de entrada:** nenhum gate específico — a fatia pequena que fecha o que a §54
declarou pendente. Quatro corpos novos no `startLoops` de §54 (`outbox.flush`,
`outbox.reconcile`, `replication.watchdog`, `host.hello`), o `onEvent` do
`CommunityClient` ligado ao fan-out (as transições de §14.5 nunca tinham destino) e o
`Outbox.discardForVersion()` para o fluxo obrigatório de §16.3. Nenhum módulo novo; a
barreira segue `§4 ok — 83 arquivo(s)`. Suíte 832 → **838 testes, 0 falha**, com
`core/test/loops-permanentes.test.ts` montando um nó MEMBRO de verdade sobre o log de
gênese dos helpers (`openCore` injetado devolve um cabo sobre `world.log`) — é a primeira
vez que a suíte exercita o caminho de membro ponta a ponta sem rede. G12 rebuildado em
quick.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| `outbox.flush` (1 s) | loop no boot | §22.1, §11.8 | hospedeiro: entrega → ACK local → projeção → reconcile esvazia com `message.accepted` DEPOIS de `messages.appended`; membro SEM canal: zero tentativa queimada, zero frame enfileirado |
| `outbox.reconcile` (30 s) | idem | §22.1, §11.6 | mesmo teste do flush; cadência de `OUTBOX_RECONCILE_MS` exportada pelo próprio módulo |
| `replication.watchdog` (5 s) | idem + `onEvent` → fan-out | §14.5, §22.1 | gap não servido + relógio parado → `community.replication{state:'stalled', reason:'no-provider'}` capturado pelo renderer |
| `host.hello` (30 s) + hello imediato no anexo | `CoreRuntime.renovarHelos`/`#enviarHello` | §14.5, §16.3, §22.1 emendada | resposta marca `markHello` (synced ALCANÇÁVEL), escreve `last_host_seen_at` e emite `{online}`; `opVersion` divergente → `incompatible` pegajoso + fila inteira `dropped/client-outdated` |

### 55.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| Watchdog como CORPO do runner, não `client.startWatchdog()` | O `startWatchdog` carrega `setInterval` próprio dentro de L2 — fora do relógio injetado e da disciplina de rearme/cancelamento de §22.5. Chamar `watchdogTick()` do loop dá a MESMA transição sob as regras do runner (sem sobreposição, para no `close`, disparável por `runNow`) | §22.5; padrão de "nada de `setInterval` solto" das fatias anteriores |
| O `onEvent` do cliente entra no fan-out NA CONSTRUÇÃO | As transições de §14.5 já eram computadas e descartadas — evento sem destinatário é sinal que ninguém escuta. A rota viaja ao lado (`{communityId}`), payload intacto | §15.5 tabela fechada; §15.1 regra 2 |
| Flush em modo membro SÓ com canal vivo (`connecting`/`online`) | Submeter sem conexão não é tentativa real de entrega: queimaria tentativa/backoff de §11.8 contra um `E_HOST_UNAVAILABLE` garantido E inflaria a fila do `RpcClient` sem destino (um frame por segundo). Hospedeiro flui sempre — a submissão é local (§11.2) | §11.8 ("`attempts` só é incrementado quando houve uma tentativa real"); §16.1 reconexão |
| Hello imediato no anexo do canal, além da cadência | §16.3 exige hello ANTES de qualquer outro método na PRIMEIRA conexão; esperar até 30 s violaria o espírito e atrasaria `synced`. A queda anterior falhou os pendentes e esvaziou a fila do `RpcClient`, então este frame sai primeiro — sem reordenador novo | §16.3 fluxo obrigatório; §16.1 reconexão |
| `opVersion` incompatível: `queued`/`failed` caem agora; itens em voo caem pelo desfecho do host | Forçar `sending`/`awaiting-confirmation` para dropped criaria transição que §11.3 não declara. O desfecho real deles JÁ é terminal com o mesmo motivo (`TERMINAL_DROP_CODES`) — a fila inteira morre, cada item pelo caminho legítimo | §11.3 máquina de estados; §11.6 regra 3; §16.3 ("todo item… vira dropped/client-outdated") |
| `host.hello` na tabela de §22.1 por EMENDA, não por interpretação | A tabela não listava o produtor, mas §14.5 define `synced` POR ele e §27.2 declara a constante para isso — lacuna interna do documento, não liberdade nossa. Emenda datada registra a linha onde ela sempre esteve implícita | §14.5; §27.2; regra de lacuna (decidir + emendar com data) |
| Rig de membro sobre `world.log` com `openCore` injetado | Os blocos de um core de comunidade SÃO registros `HostRecord` — a gênese dos helpers produz exatamente isso. Com `buraco > 0` o cabo anuncia mais do que serve, o gap de §14.5 vira testável sem rede, e o caminho de membro (outbox, reconciliação, hello, watchdog) sai da cobertura zero | §28.1 (testes sem mock de rede); §10.5 passo 6 (parada no buraco) |

### 55.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §22.1 | emenda datada: linha `host.hello` (`P2P_HELLO_INTERVAL_MS`) acrescentada à tabela — o produtor que §14.5/§27.2 pressupunham; hello imediato na primeira conexão |

### 55.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| ~~`metrics.flush` (10 s)~~ | ~~o loop existe na tabela de §22.1, mas os PRODUTORES de métrica/log (§24.3) ainda não — rodaria para nada~~ **implementado em 2026-08-23 — §56**: o loop comete no registro central de §24.3 (profundidade da fila, estado de replicação, pares do swarm) que `diag.snapshot` serve; o destino NÃO é o NDJSON — o formato de §24.1 é fechado e não tem campo para valor | — |
| ~~Escolha de presença local (`identity.setPresence`)~~ | inalterado desde §54.3 — **implementado em 2026-08-23 — §56** | — |
| ~~Gatilho de assinatura de typing no membro~~ | inalterado desde §54.3 — **implementado em 2026-08-23 — §56** (`channel.subscribeTyping`, emenda em §15.4) | — |
| ~~Produtores de log NDJSON~~ | inalterado desde §54.3 — **implementado em 2026-08-23 — §56** | — |
| Oferta de sucessão (U-18) / colisão L-5 / `community.end`-`forget`-`activate` | shell e `identity.*` existem desde §56; o que falta agora é superfície de UI e as ops restantes da tabela | fases seguintes |

---

## 56. O produto acorda: identidade na superfície, o shell de verdade e os produtores de log 2026-08-23

**Gate de entrada:** nenhum gate específico — a fatia que liga o processo real. Três
frentes que se fecham juntas: (1) a superfície `identity.*` + o ciclo do núcleo
(`core.status`/`reproject`/`shutdown`, transição `awaiting-identity → ready`), 100%
testável no core; (2) o shell Electron real — o stub de 99 linhas de `app/src/utility`
vira o boot do `bootCore` sobre as duas portas cruzadas pelo main, com lock composto,
retomada de wipe, Data Key por IPC-M e draining no quit; (3) as pendências pequenas que
dependiam das duas. Módulos novos na raiz de composição: `identity.ts` (serviço + portas
de keystore), `wipe.ts` (máquina retomável de §18.6) e `logger.ts` (NDJSON de §24.1 com
allowlist de §24.2 e o registro central de métricas de §24.3). Barreira
`§4 ok — 86 arquivo(s), L0:8 L1:6 L2:12 L3:4 + raiz de composição (15 arquivo(s))`;
suíte 838 → **851 testes, 0 falha**, com três arquivos novos
(`identidade-superficie.test.ts`, `wipe-backup.test.ts`, `draining-log.test.ts`). A app
compila (`npm run typecheck`/`build`) e o shell foi exercitado ponta a ponta por um smoke
automatizado sob node puro (roteiro abaixo).

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| `identity.create` (open), gates de keystore | `composition/identity.ts` + roteador | §15.4, §3.2 L-2 | coluna Erros na ordem: `E_IDENTITY_EXISTS`, `E_VALIDATION` (mesma régua do `fold`), `E_KEYSTORE_UNAVAILABLE`, `E_KEYSTORE_INSECURE` sem aceite persistido |
| Transição `awaiting-identity → ready` | boot (`setPhase` + fan-out) | §3.3, §15.5 | standard recusa com `E_NO_IDENTITY`; `create` emite `core.ready{phase:'ready', epoch}` e abre as escritas; `core.restarted` quando `epoch > 1` |
| `identity.update` **A**, uma op por comunidade | ponte (`IDENTITY_UPDATE_KIND`) + boot | §15.4, §11.1 emendada | duas comunidades → `{queued:[×2]}`; flush entrega, `fold` aplica nas duas, reconcile esvazia |
| `identity.setPresence` | boot (`runtime.localPresence`) | §6.1, §17.6 | tabela fechada valida; `dnd` publica no refresh; `invisible` para de publicar e expira pelo TTL; escolha persiste no perfil |
| `identity.export` / `identity.import` | serviço + portas IPC-M | §5.5 | export carrega comunidades hospedadas com semente; import recria linhas no manifest e REABRE os cores pelo mesmo caminho do boot; frase errada é `E_BAD_PASSPHRASE` |
| `identity.wipe` — máquina retomável | `composition/wipe.ts` | §18.6 | cada etapa grava o próprio nome ANTES de agir; crash em `view-deleted` retoma pelo `wipe_state`; sentinela `WIPE` cobre pós-`manifest-deleted` sem abrir banco; LOCK sai por último |
| `core.status` completo | boot | §15.6 | `phase/epoch/coreVersion/opVersion/manifestSchemaVersion/viewSchemaVersion/keystore/buildChannel` |
| `core.reproject` (main-confirmed) | boot | §15.2, §10.5 | reprojeção reconstrói a `view.db` do log; mensagens intactas |
| `core.shutdown` — draining com orçamento | `CoreRuntime.shutdown` | §18.7 | resposta honesta `{drainedMs, pendingOps, replicatedTo}`; fase `draining → stopped` |
| Shell real: utility roda `bootCore` | `app/src/utility/index.ts` | §3.1, §3.3 | lock flock antes dos bancos; wipe-resume ANTES de abrir qualquer banco; Data Key unwrap via IPC-M (ou geração na primeira instalação); `identity.load()` decide a fase |
| Lock composto de §10.8 | main + utility | §10.8 | segunda instância recusa com `E_CORE_ALREADY_RUNNING`; saída esperada não vira respawn de crash |
| Crash do núcleo (§15.2) | main (`epoch++`, backoff) + preload | §15.2 | renderer recebe `core-epoch` e refaz subscrições; saída limpa pós-draining NÃO reinicia |
| Draining no quit | main ↔︎ utility handshake | §3.3, §18.7 | quit manda `shutdown`, núcleo responde `{e:'drained'}` com o resumo; teto de 8 s |
| Token main-confirmed nasce NO núcleo | main (diálogo) + utility (`AuthTokenStore`) | §15.3 | diálogo nativo no main; emissão pedida pela IPC-M; consumo síncrono único no roteador |
| Deep links | main (já existia) | §3.5 | `parseDeepLink` + fila até o renderer; `query.resolveMessageLink` pronto desde §53 |
| Gatilho de typing | `channel.subscribeTyping` | §17.6 | host assina no agregador local; membro espelha por §16.2 e chega ao servidor real; sem canal vivo não há frame (§11.8) |
| Produtores NDJSON | `composition/logger.ts` | §24.1, §24.2 | allowlist ESTRUTURAL (campo fora da lista não existe na linha); `debug` só no canal dev; produtores: boot, transições do host, desfechos da fila, watchdog, metrics.flush |
| `metrics.flush` (10 s) | loop de §22.1 + `MetricsRegistry` | §24.3, §22.1 | gauges de profundidade de fila por comunidade, estado de replicação e pares do swarm cometidos no registro central que `diag.snapshot` serve |

### 56.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| `identity.update` enfileira pela PONTE como segunda exceção declarada; a política do `fold` NÃO muda | A classificação `Fila` do `KIND_POLICY` espelha a tabela de §7.4.1 por domínio, e o teste de política compara as duas — o `member.leave` já seguia exatamente esse arranjo (exceção na ponte, `fila:false` na tabela). Duplicar a exceção em dois lugares seria criar segunda fonte para o mesmo fato | §11.1 (emenda datada); §7.4.3; precedente L-22 |
| `identity.export` responde `{}`, sem `savedTo` | O caminho de arquivo do usuário não cruza o IPC-R em NENHUMA direção (T-16); devolvê-lo na resposta violaria a regra 5 de §13.3. O campo da tabela era conflito interno da spec, não liberdade nossa — emenda datada registra a correção | §13.3 regra 5; §5.5 (o blob nunca passa pelo renderer); regra de conflito normativo |
| `channel.subscribeTyping` é comando LOCAL que espelha a assinatura, não uma op | A assinatura é estado efêmero do host (§17.6), nunca entra no log; quem sabe quando ela começa e termina é a UI abrindo/fechando canal. No membro é fire-and-forget por §16.2: sem canal vivo não há frame (efêmero não enfileira, §11.8) e a re-assinatura acontece na reconexão, como toda ressincronização de §15.1 | §17.6; §16.2; §11.8; lacuna interna da tabela fechada resolvida por emenda datada |
| Wipe remove `<dataDir>/cores` na etapa `cores-closed` | Uma limpeza que deixa o LOG INTEIRO de toda comunidade legível no disco contradiria §18.4 (réplica removida sai inteira) e o propósito da máquina; a etapa é a única que nomeia os cores. Fechar e remover é um passo só de desmontagem | §18.6 (etapas); §18.4 passo 6; decisão registrada aqui por ser colocação dentro de etapa existente |
| O wipe-resume mora no SHELL, antes de abrir bancos | Retomar exige NÃO ter banco aberto (pós-`manifest-deleted` não há mais onde ler o estado). O `bootCore` já recebe bancos abertos; quem pode garantir a ordem lock → resume → open é quem monta a sequência — a raiz de composição do shell | §18.6 ("no boot… retoma… antes de qualquer outra coisa"); §10.8 ordem do lock |
| `core.shutdown` corre o orçamento sobre sinais LOCAIS (fila vazia + réplica na cabeça) | A barreira de §18.7 passo 2 pede confirmação de PARES (`min(3, memberCount−1)` com `core.length` igual à cabeça); o transporte ainda não mede quem confirmou o quê. Inventar confirmação seria pior que declarar o limite: a resposta é honesta sobre pendentes | §18.7 passos 2–4; pendência registrada em §56.3 |
| Métricas de §24.3 vão para um REGISTRO central consultável, não para o NDJSON | O formato de §24.1 é fechado (`ts/level/scope/msg` + opcionais) e nenhum campo carrega valor de gauge — escrever valor em `code` ou `seq` seria abuso. O módulo `diagnostics` já declarava esperar "um registro central implementado pela composição" | §24.1 formato fechado; §24.3 taxonomia; comentário contratual de `diagnostics` |
| Allowlist de §24.2 é ESTRUTURAL no logger | Campos fora da lista de §24.1 são descartados antes de tocar o arquivo: redação por construção não depende do produtor lembrar. Teste varre TODAS as linhas produzidas num fluxo real procurando campo estranho, nome de comunidade e conteúdo de mensagem | §24.2 (fecha T-39); §24.1 lista fechada de campos |
| UMA Data Key por instalação: `identity.create` adota a chave que a composição já tem | §5.4 diz que a mesma chave protege `identitySeed`, `communitySeed`s e `escrowSeed`s. Antes desta fatia o manager sorteava uma SEGUNDA chave para a semente de identidade — duas chaves partiriam a promessa de §5.5 (restaurar com o backup + manifest) | §5.4; §5.5; §10.2 (`manifest.secrets.data_key`) |
| Token main-confirmed nasce NO núcleo, main só pede emissão após o diálogo nativo | O roteador consome o token SINCRONAMENTE (§15.2 quadro `req`); validação assíncrona contra o main mentiria por verdadeiro (Promise é truthy). Com o store no consumidor, uso único e TTL ficam onde o token é gasto — e o renderer continua incapaz de fabricá-lo | §15.3 (valor de uso único, TTL 60 s, consumido e invalidado pelo núcleo) |
| `hostTurnSecret(communityId)` derivado por `'ns/hostturn/1' ‖ dataKey ‖ communityId` | §15.7 exige o segredo no boot e nenhuma linha de §5.2 o derivava. Derivar da Data Key mantém o segredo dentro da máquina e recuperável sem estado extra; prefixo novo entra por EMENDA na tabela fechada, não por interpretação | §5.2 (emenda datada); §17.3; regra de lacuna (decidir + emendar) |
| Fase vira EVENTO (`core.ready`/`core.restarted`), não polling | A tabela de §15.5 declara os dois tópicos e ninguém os emitia; `identityStatus.isLoaded` era getter passivo — o renderer teria que adivinhar quando as escritas abrem. Eventos não são replay: quem assina depois lê `core.status` (open) | §15.5; §3.3; §15.6 `CoreStatus.phase` |
| Smoke automatizado do shell sob node puro (parentPort falso) além do typecheck | `npm run dev` depende de gnome-keyring, ABI de addons nativos para Electron e display — nada disso existe no ambiente automatizado. O smoke cruza as DUAS portas como o main faz, fala IPC-R em quadros crus e prova: lock, wipe-resume, unwrap da Data Key, `awaiting-identity`, `create` com wrap, `community.create` com gênese no disco, e reboot nascendo `ready` com identidade persistida. É evidência REAL do caminho do shell, não substituto do smoke manual do Electron | §28.1 (testes sem mock de rede/domínio); CLAUDE.md (não inventar evidência — o roteiro manual segue listado em §56.3) |

**Roteiro do smoke (node ≥ 22, sem display):**

```
node /tmp/opencode/smoke-utility.mjs          # primeira instalação → awaiting-identity → create → ready
SMOKE_REUSE_DIR=<dir> node ...                # reboot no mesmo diretório → nasce ready (persistência)
```

**Roteiro do smoke MANUAL do Electron (`npm run dev`), a executar no ambiente com
gnome-keyring ativo e addons rebuildados para a ABI do Electron:**

1. `cd core && npm run build && cd ../app && npm run build && npm run dev`.
2. Primeiro uso: janela abre, `core.status` responde `awaiting-identity`; criar identidade
   pela UI libera as escritas (evento `core.ready`).
3. Segunda instância: `comunidadep2p://join/<código>` em outra instância foca a janela
   existente; o flock recusa um segundo núcleo.
4. Export: confirmar diálogo nativo e verificar o arquivo gravado; apagar `<userData>/p2p`,
   restaurar por import e conferir comunidade reaberta.
5. Fechar a janela: log `[nucleo] draining:` com contadores e saída limpa (sem respawn).
6. `kill -9` no processo `comunidade-nucleo`: epoch+1, renderer falha pendentes com
   `E_CORE_RESTARTED` e refaz subscrições.

### 56.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §5.2 | emenda datada: linha `'ns/hostturn/1'` (`dataKey ‖ communityId`) na tabela fechada de derivações — o produtor de §15.7/§17.3 que a tabela pressupunha |
| `docs/backend-v2.md` §11.1 | emenda datada: `identity.update` entra como SEGUNDA exceção declarada de fila (contrato já dito pela tabela de §15.4, agora escrito onde a regra única mora) |
| `docs/backend-v2.md` §15.4 | emenda datada em três alinhamentos: `identity.export` responde `{}` (§13.3 regra 5 vence `{savedTo}`); `channel.subscribeTyping {communityId, channelId, on}` (standard) entra na tabela como gatilho local da assinatura de §17.6; `E_WIPE_INCOMPLETE{stage}` viaja em `details.stage` |

### 56.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| Barreira de replicação de §18.7 por confirmação de PARES | o transporte precisa medir quem confirmou `core.length` igual à cabeça; hoje o orçamento do draining corre sobre sinais locais | fase de transporte/mídia real |
| Sondas reais de NAT/STUN no `diag.*` | o default conservador assume `cgnat`/sem STUN sem sonda injetada (pior caso declarado); a injeção é do shell empacotado | fase de empacotamento |
| Smoke manual do Electron | roteiro acima; exige gnome-keyring ativo, addons rebuildados para a ABI do Electron e display — nada disto no ambiente automatizado | ambiente de release |
| Empacotamento (`electron-builder`) e rebuild de addons nativos por versão do Electron, respeitando piso glibc ≥ 2.31 | `npm run pack` da app nunca foi executado nesta árvore | fase de release (G0/G10 regem os nativos) |
| ~~Renderer real~~ | ~~o mock de `frontend/` continua fora do produto; ligá-lo à IPC-R real é fatia própria~~ — **entregue em §58** (transporte, stores e telas mínimas sobre a IPC-R real) | — |
| ~~Oferta de sucessão (U-18)~~ | ~~tela de oferta; `checkEligibility` e o shell existem~~ — **entregue em §58** (U-18c: oferta e reentradas pendentes) | — |
| Colisão de `displayName` (L-5) | segue `false` até o `fold` marcar | `fold` |
| Comandos restantes de §15.4 | `community.end`/`forget`/`activate`; superfícies `dev.*` fora do escopo | fatias seguintes |
| Herdadas | §50.3–§55.3 sem mudança adicional além das entregas riscadas acima | ver §55.3 |

---

## 57. O bloco Comunidade se fecha: end, forget, activate — e a marca de L-5 2026-08-23

**Gate de entrada:** nenhum gate específico — a fatia curta que fecha a última linha em
aberto da tabela de §15.4. Três comandos (`community.end` ⏱ main-confirmed,
`community.forget` main-confirmed, `community.activate` standard), a desmontagem por
comunidade extraída do job `removed.purge` para reuso fora da cadência, a marca
`displayNameCollision` de L-5 no `fold` e a limpeza herdada do timer vazando no
`IpcClient.request` (§39.3/§44.3). Barreira inalterada em módulos
(`§4 ok — 86 arquivo(s)`); suíte 851 → **858 testes, 0 falha**, com
`core/test/ciclo-comunidade.test.ts` cobrindo os três comandos sobre rigs reais (hospedeiro
e membro sobre log de gênese) e a L-5 no fold puro com reprojeção. G12 rebuildado em quick.

| Entrega | Onde | Seção | Teste/evidência |
|---|---|---|---|
| `community.end ⏱` | `composition/community.ts` (`endCommunity`) | §15.4, §18.5, §18.7 | só o host corrente (`E_NOT_HOST` advisório); já encerrada é `E_COMMUNITY_ENDED`; resposta `{seq, replicatedTo}` com orçamento de draining; terminal: leitura segue, escrita recusa |
| `community.forget` | boot + `purgeUmaComunidade` | §18.4 | participada é `E_VALIDATION` (emenda datada); desconhecida `E_NOT_FOUND`; left sai do disco, do LS e do runtime; fluxo de membro real leave→forget sem deixar fila órfã |
| `community.activate {cid \| null}` | `composition/structure.ts` + `manifest.residencyOf` | §8.1 | ativa fixa `full`, `null` volta a `light`, hospedada continua `full` pela regra derivada; escolha LOCAL persistida em `local_navigation` |
| L-5 no fold | `fold/apply.ts` (`recalcularColisoesDeNome`) | §6.1 | NFKC+casefold+colapso colidem; rename e saída desmarcam; reprojeção produz as MESMAS marcas |
| Timer de 30 s sem vazamento | `IpcClient.request` | §15.4 ⏱ | o handle vive dentro do registro pendente e é limpo em TODO desfecho (resposta, epoch bump, timeout) |

### 57.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| O draining de `end` corre sobre sinais LOCAIS, como no `core.shutdown` | A barreira por PARES de §18.7 continua aguardando o transporte medir confirmações (pendência desde §56.3); inventar confirmação seria pior que declarar o limite. O orçamento (`DRAIN_BUDGET_MS`, §27.2) e a ordem são os mesmos dos dois lugares | §18.7 ("o mesmo procedimento vale para community.end"); pendência explícita |
| `forget` recusa participada com `E_VALIDATION`, não código novo | A pré-condição está na própria linha da tabela ("de uma comunidade left/removed"); um terceiro erro para uma recusa de estado seria superfície nova sem necessidade — a emenda datada registra a célula | §15.4 tabela fechada + emenda datada; precedente de erros genéricos nomeados |
| `activate` persiste ESCOLHA local e deriva o resto pela regra de §8.1 | Armazenar residência por comunidade criaria segunda fonte para um fato derivável (host → full; ativa → full). O comando fixa a ATIVA; a regra manda no resto. Carga sob demanda de mensagens em `light` ainda não existe no projector — pendência registrada (a medir em G9) | §8.1 regra de residência literal; DR-32 (navegação é outro dono, outra superfície) |
| L-5 recalculada INTEIRA nas ops que mudam nome ou conjunto ativo | Marca incremental por op seria segunda implementação da mesma definição (e cada atalho uma chance de divergir); O(membros) por op afetada é barato no teto do v1. Escrita só via `draft.mutMember`, para não furar o compartilhamento estrutural do DS | §6.1 L-5 ("o fold marca… todo membro cujo displayName normalizado coincida"); determinismo de §28.4 |
| Colisão normaliza com casefold além do `trimCollapseNFKC` | O texto de L-5 pede "NFKC + casefold + colapso de espaço" — o normalizador de §8.6 sozinho não faz casefold; a marca tem normalização PRÓPRIA, derivada dele, não compartilhada | §6.1 L-5 literal |

### 57.2 O que mudou no normativo

| Documento | Mudança |
|---|---|
| `docs/backend-v2.md` §15.4 | emenda datada na célula de erros de `community.forget`: `E_VALIDATION` para comunidade ainda participada |

### 57.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| Barreira de replicação por confirmação de PARES (§18.7) | inalterada desde §56.3 | fase de transporte/mídia real |
| Residência `light` efetiva no projector | a escolha de `community.activate` é persistida e consultável; carregar `messages` sob demanda conforme §8.1 é trabalho do projector (a medir em G9) | fase de escala/G9 |
| ~~Oferta de sucessão U-18 (tela), renderer real~~, empacotamento e sondas NAT/STUN | ~~oferta e renderer~~ **entregues em §58**; empacotamento e sondas inalterados desde §56.3 | fase de release |
| Superfícies `dev.*` | seguem fora do escopo do v1 | decisão de produto |
| Herdadas | §50.3–§56.3 sem mudança adicional além das entregas riscadas | ver §56.3 |

---

## 58. A UI acorda: o renderer real sobre a IPC-R 2026-08-23

**Gate de entrada:** nenhum gate específico. A fatia liga o `frontend/` à IPC-R que o shell
de §56 já cruza e fecha as pendências de UI que §54–§57 deixaram esperando. Ao ligar,
apareceram **três defeitos de fronteira do shell** que nenhum teste automatizado podia ver —
o smoke do Electron nunca rodou (pendência declarada desde §56.3) — e os três eram fatais
para o passo 3 de §15.1 e para o passo 2 de §15.2. Estão corrigidos aqui.

Núcleo inalterado em superfície: barreira `§4 ok — 86 arquivo(s)`, suíte em **858 testes**.
G12 rebuildado em quick. `frontend/`: `npm run build` e `npm run lint` verdes (não há test
runner ali — §29/`CLAUDE.md`); `app/`: `npm run typecheck` verde.

| Entrega | Onde | Seção | Evidência |
|---|---|---|---|
| Cliente IPC-R do renderer | `frontend/src/ipc/{frames,client,bridge,api,dto}.ts` | §15.1, §15.2, §15.3, §15.6 | quadros da tabela fechada; epoch descarta o resto; `evAck` por evento e `evStale` → resync; timeout 10 s / 30 s nas ⏱; token de §15.3 só do main |
| `hello` passa a existir no produto | `composition/boot.ts` | §15.1 | **era o defeito 1**: nenhum caminho de produção chamava `IpcServer.sendHello` — só rigs. Sem ele o `waitForHello` do renderer nunca resolveria. Sai depois da última linha do roteador e antes de qualquer `ev` |
| A porta chega VIVA ao renderer | `app/src/preload/index.ts` | §3.4 | **era o defeito 2**: a porta era exposta por getter do `contextBridge`, que serializa o que atravessa, e o `start()` era chamado sem listener — o `hello` enfileirado seria descartado. Agora vai por `window.postMessage(..., [port])`, e quem escuta é quem inicia |
| Porta nova a cada núcleo novo | `app/src/main/index.ts` (`entregarPortaAoRenderer`) | §15.2 passo 2 | **era o defeito 3**: a porta 2 só era transferida no `did-finish-load`; num respawn o renderer ficava com a porta do núcleo morto e a recuperação parava no `hello` que não chega |
| Sessão e primeiro uso | `live/sessao.ts`, `live/telas/PrimeiroUso.tsx` | §3.3, §15.4 | gate por `core.status.phase`; `identity.create` (open) e `identity.import` (main-confirmed); o erro aparece no campo que o `field` de §15.2 nomeia |
| Rail, estrutura e canal | `live/comunidades.ts`, `live/canal.ts`, `live/telas/*` | §15.5, §15.6 | eventos como sinal para reconsultar; `hostStatus` pelo enum fechado de nove valores; `inactiveDays` ausente não vira zero |
| Fila honesta de envio | `live/canal.ts` + `telas/Canal.tsx` | §11.1, §11.6, §15.2 | `message.send` responde `{opId, state}` e a mensagem fica NA FILA até `messages.appended`; `accepted`/`failed`/`dropped` são o desfecho; nada é reenviado sozinho, e `query.outbox.preview` redesenha a fila ao reabrir (F-16) |
| Gatilho de typing na UI | `live/canal.ts` | §17.6 + emenda de §15.4 | abrir canal chama `channel.subscribeTyping{on:true}`, sair chama `{on:false}`, e o resync refaz a assinatura |
| Oferta de sucessão U-18c | `live/telas/Sucessao.tsx` | §18.8, §18.8.1, U-18 | oferta só com `successorKeys` ∋ eu **e** `inactiveDays ≥ 30`; `community.assumeHost` main-confirmed; `pendingReentry` ausente ≠ lista vazia; texto obrigatório literal |
| Deep link ponta a ponta | `live/deeplink.ts`, `telas/DeepLinks.tsx` | §3.5, §12.3, §15.6 | `join` → `invite.resolve` + `invite.redeem`; `m/` → `query.resolveMessageLink`, cujos cinco desfechos são estados de tela |
| Base relativa no bundle | `frontend/vite.config.ts` | §3.1 | o renderer é carregado por `loadFile`; em `file://` a base absoluta do default apontaria para a raiz do disco |

### 58.1 Decisões e por que são estas

| Decisão | Justificativa de engenharia | Justificativa normativa |
|---|---|---|
| O cliente IPC-R é **reimplementado** em `frontend/src/ipc/`, não importado de `core/` | O `IpcClient` de `core/src/l3/ipcRenderer` existe para os rigs: fala `onMessage(listener)` de `MemoryIpcPort`, mora num pacote ESM sem `exports` cujo build roda a barreira de camadas, e vem junto com o `IpcServer`. Um `file:../core` faria o build do Vite depender de `core/dist` e arrastaria L0..L2 para o grafo do renderer. O `MessagePort` real precisaria de adaptador de qualquer jeito | O contrato compartilhado é o **quadro** de §15.1, não a classe. §4 separa as camadas justamente para a fronteira não vazar |
| A UI viva não usa `react-router` | Dentro do Electron não há barra de endereço, e os deep links chegam como evento do main já parseado — nunca como URL. O próprio mock já dizia (`App.tsx` §4) que comunidade e canal selecionados são estado, não recurso endereçável | §3.5(2): o main encaminha dado estruturado, nunca a string original |
| A fila de envio é desenhada **como fila**, fora da conversa, e reconciliada por `query.outbox` | Um "otimismo" que insere a mensagem no meio da lista promete `seq` e hora do host que ainda não existem, e mente na hora exata em que a rede falha. A fila é o estado real de §11.1, e o `preview` de §15.6 existe para redesenhá-la ao reabrir | §11.6 r. 2 (`accepted` vem DEPOIS do `appended`); §15.2 passo 5 (a escrita em voo está na outbox, não se reenvia); F-16 |
| Presença é o ÚNICO evento cujo payload vira estado, com TTL local de 45 s | Não há query de presença por comunidade na tabela fechada de §15.6, e o evento é declaradamente um delta do que mudou. Reconsultar não devolveria o dado; guardar com TTL é o que a própria emenda descreve | §15.5 emenda de 2026-08-23; §17.6 (TTL 45 s); §6.1 — `offline` não é publicado, e a tela nunca o escreve |
| O gate de primeiro uso é `core.status.phase`, não `query.identity` | `query.identity` é `standard`: sem identidade ele **recusa** com `E_NO_IDENTITY`. Usar um erro como resposta faria a tela depender de uma recusa continuar significando a mesma coisa | §15.3 (classes) e §3.3 (a fase é o que o núcleo declara) |
| Do mock só `components/ui/` entra no caminho vivo | `src/domain/types.ts` é o modelo das fixtures, com enums próprios (`HostStatus` de três valores, `position` em vez de `rank`). Mapeá-lo nos DTOs de §15.6 seria inventar correspondência campo a campo — exatamente o que o precedente de §46–§57 proíbe. Os componentes de `ui/` não conhecem domínio nenhum e foram reaproveitados inteiros | `CLAUDE.md`: o mock não é a arquitetura final; §15.6 é a fonte dos tipos |
| Voz e tela aparecem como botão **desabilitado com motivo nomeado** | A capacidade existe na spec e some da tela se for escondida; fingir que funciona é pior. O motivo nomeado diz de quem é a fatia | Mídia pela rede real está fora do escopo desta fatia; §17 permanece intocado |

### 58.2 O que mudou no normativo

Nada. A fatia é implementação: as três correções de fronteira do shell fazem o código
cumprir §15.1 e §15.2 como já estavam escritos, e nenhuma tabela fechada ganhou campo ou
tópico.

### 58.3 O que continua pendente

| Pendência | O que falta | Quem fecha |
|---|---|---|
| U-17 — "opção de removê-la do rail" numa comunidade **encerrada em que ainda sou membro** | não há comando único para isso: `community.forget` recusa comunidade ainda participada com `E_VALIDATION` (emenda de §15.4), então o caminho é `community.leave` e depois `forget`. Sair de uma comunidade encerrada para poder esquecê-la é uma sequência que o delta não descreve — a tela não a inventou. O resto de U-17 (permanece no rail, ícone esmaecido, cabeçalho com a data, sem composer) está entregue | decisão de UX + §15.4 |
| Telas do mock não migradas | busca, configurações, cargos, moderação, threads, anexos, menções, voz/tela e os componentes de `features/**` continuam sobre `src/mocks/dataset.ts` e `src/domain/types.ts`, fora do caminho vivo. A migração é por superfície, cada uma contra a query de §15.6 que a alimenta | fatias de UI seguintes |
| ~~Sem cobertura automatizada no renderer~~ | ~~`frontend/` não tem test runner~~ — **resolvido em §58.4**: Vitest entra no `frontend/`, e o cliente de IPC-R tem 20 casos cobrindo epoch, `evStale`, reassinatura e o "nada é reenviado". **Os componentes seguem sem teste** — a fatia cobriu o transporte, não as telas | fatias de UI seguintes |
| Smoke manual do Electron | continua sendo a única evidência possível do caminho ponta a ponta, e continua não executada nesta árvore — as três correções desta fatia **saíram de leitura**, não de execução. Roteiro em §56.1, agora com um passo a mais: com o núcleo vivo, `kill -9` no processo do núcleo deve trocar a porta e refazer as assinaturas sem recarregar a janela | ambiente de release |
| ~~Flake pré-existente de teardown na suíte do core~~ | ~~857/858 com uma falha que muda de arquivo a cada execução~~ — **resolvido em §58.4**, e **não era do teardown**: `BlobManager.close()` devolvia com o core de blobs ainda fechando. Suíte em **859/859**, seis execuções seguidas | — |
| Barreira de replicação por PARES (§18.7), residência `light` no projector, empacotamento, sondas NAT/STUN, `dev.*` | inalterados desde §57.3 | ver §57.3 |

### 58.4 Emenda de 2026-08-23 — os dois passos seguintes, executados

Duas pendências de §58.3 eram acionáveis de imediato e foram fechadas na mesma sessão. A
primeira delas não era o que o nome dizia: perseguir o "flake de teardown" levou a um defeito
de produto no fechamento do núcleo.

**Como a causa apareceu.** Uniformizar o `maxRetries` nos 69 teardowns derrubou a frequência
mas não a falha: uma execução em ~6 seguia com `ENOTEMPTY` em `cores/blobs/<key>/db`, e
ampliar a janela para 1 s não adiantou — o teste que falhou tinha durado 10 s. Janela que não
resolve não é corrida de janela. Um experimento isolado (30 ciclos de abrir, appendar, fechar
e remover um hypercore) fechou 30/30 sem falha nenhuma, o que descartava a biblioteca e
apontava para um core que **nunca era fechado**. Era: o `void detachLocalCore(...)` do
`stop()` da comunidade.

| Entrega | Onde | Evidência |
|---|---|---|
| `BlobManager.close()` passa a esperar o disco | `core/src/l2/blobs/index.ts` | **a causa real do flake, e um defeito de produto**: `OpenCommunity.stop()` é síncrono por contrato e chama `detachLocalCore` sem poder esperá-lo; o detach saía do registro na hora e fechava o core numa promessa que **ninguém segurava**. `close()` iterava um registro já vazio e devolvia com o RocksDB ainda fechando. Agora os fechamentos em voo ficam registrados e `close()` os espera |
| A propriedade fica fixada em teste | `core/test/attachments.test.ts` (§58.4) | dispara `detachLocalCore` sem esperar, como o `stop()` faz, e exige que `close()` só devolva com o core fechado. Verificado por mutação: com a correção revertida, o caso falha |
| Teardown dos rigs segue a convenção já registrada | `core/test/*.ts` | `{ recursive: true, force: true, maxRetries: 5, retryDelay: 20 }` existia em 15 dos 69 `rmSync` recursivos; agora está nos 69. É cinto de segurança, **não** o que resolveu |
| Vitest e a cobertura do cliente de IPC-R | `frontend/package.json`, `frontend/src/ipc/__testes__/client.test.ts` | 20 casos: aperto de mão e epoch, `req` com e sem `authToken`, `field` do erro preservado, quadro de outro epoch descartado, timeout por comando sem handle sobrevivente, `evAck` por evento, as duas obrigações do `evStale`, `unsub` com o `subId` do núcleo, `subOk` atrasado que cancela, e os passos 4a–4d de §15.2 |

**Por que Vitest e não `node:test` como no núcleo.** O `frontend/` é um projeto Vite: o
runner lê o `vite.config.ts` e o `tsconfig` que já existem, sem segunda configuração de
compilação. Reproduzir o caminho do núcleo (`tsc` para `dist/` e `node --test`) exigiria um
tsconfig paralelo só para emitir um pacote que é `noEmit` por definição — mais máquina para
menos alcance, e nada disso serviria aos testes de componente que as fatias de UI seguintes
vão querer. `CLAUDE.md` foi atualizado: a régua do `frontend/` agora é `npm run build`,
`npm run lint` e `npm test`.

**Os testes foram verificados por mutação, não só por passarem.** Removida a reassinatura do
bump de epoch, cai o caso 4b/4c; removido o `evAck` do `evStale`, cai o caso da regra 5;
revertida a correção do `BlobManager`, cai o caso de §58.4. Um teste que não falha quando o
comportamento some não é evidência de nada.

**O que o defeito significava fora da suíte.** `close()` é a barreira em que a máquina de
wipe (§18.6) apaga arquivos e em que o draining (§18.7) declara o núcleo parado. Devolver com
um RocksDB ainda aberto tornava as duas promessas falsas — no wipe, um `E_WIPE_INCOMPLETE`
por diretório ocupado; no quit, a chance de o processo sair no meio do fechamento. A suíte
só era o lugar onde isso ficava visível.
