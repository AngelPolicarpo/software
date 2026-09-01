# POC-14 / G14 — relatório

Leitura consolidada do que o harness mediu. O artefato versionado está em
`out/gate-G14/gate-G14.json` (perfil full; `out/gate-G14-quick/` para o smoke); este
documento é a interpretação dele e **não é normativo**.

---

## 1. O que o gate perguntou

> O estado de uma conversa direta é uma função pura, total e determinística do **par** de
> logs de escritor único: dois nós que recebam os mesmos dois logs em ordens de replicação
> diferentes convergem para o mesmo estado, e nenhuma entrada — inclusive hostil — faz o
> `dmFold` lançar.

Cinco medidas, e §31.26 declara o que **cada reprovação causa**: (1) ou (3) reabrem A29; (2)
é bug de implementação; (4) torna `desynced` terminal e dá a **L-25** uma segunda metade; (5)
obriga uma fila durável em `manifest.db` e uma emenda a A29.

## 2. O que é do produto e o que é do harness

Essa linha é o que separa um gate de uma tautologia.

| Peça | De onde vem |
|---|---|
| `dmFold`, o pipeline de 13 estágios, RD-1..RD-11 | **produto** — `core/dist/src/l1/dmFold` (B54) |
| O merge de §31.6 (`mergeRecords`, `ordSum`, `ordKey`) | **produto** — `core/dist/src/l1/dmFold/order.js` |
| Envelope, assinatura, AEAD, `peekDmHeader` | **produto** — `core/dist/src/l1/dmCodec` |
| O cabo que **escreve** o registro | `core/dist/test/helpers/dm.js` — o mesmo do ensaio de unidade, para que o corpus fale do mesmo material |
| Projetor, tabelas `dm_*`, `dm_ds_snapshot`, reinterpretação | **harness, descartável** — é B56, e B56 está bloqueado por este gate |
| `self_high_water` em `manifest.db` (`FULL`) e a regra de boot | **harness, descartável** — é B57, pelo mesmo motivo |

## 3. O que foi medido (7/7 passos, quick e full)

| | Medido |
|---|---|
| **S1** — determinismo do merge | O par do roteiro (escrita concorrente, `ack` mentiroso, `ts` retroativo, referência quebrada e quatro registros hostis **dentro** dos logs) entregue em N ordens de intercalação, mais o nó que recebe os dois logs prontos: **um único hash de dump**. E o `ordSum` de cada `(origin, index)` é o mesmo em todo prefixo do par — um registro nunca muda de chave |
| **S2** — inserção retroativa | Duas formas. **Do começo** (o log do par chega inteiro depois): o ponto de inserção é a gênese do par, não existe snapshot anterior a ele e a reinterpretação parte do zero — correto, não falha. **Do meio** (o nó já tem prefixo dos dois lados): a reinterpretação recarrega o snapshot mais recente ≤ ao ponto, descarta os acima e refaz dali. Seis cadências de snapshot, todas com o mesmo hash da referência; `dm.reordered{fromOrdSum}` depois do commit; `fold_build_id` trocado descarta tudo e recomeça do zero (§10.6) |
| **S-FUZZ** — totalidade | 10⁷ registros hostis no perfil full, doze sabotagens (uma por estágio de §31.7.3), PRNG determinístico. `dmFold.panic = 0`, zero desfecho fora dos três, zero `APPLIED`, zero recusa sem código de §31.7.3, zero efeito emitido em recusa. Bordas: 0 bytes, 1 byte, o teto exato e um byte acima |
| **S-CUSTO** | A curva de reinterpretar do zero, e o tamanho da janela de `ts` com e sem `ack` do par (**ACHADO-G14-04**) |
| **S3** — partição | Dois nós reais numa `hyperdht/testnet`, quatro cores de verdade, os dois cores de cada nó no mesmo socket. Escrita dos dois lados **durante** a partição (hashes divergentes enquanto ela dura), reconciliação sem intervenção: hash do nó A = hash do nó B = referência, zero fork |
| **S4** — core encurtado | A detecção de §31.13 antes de qualquer append; a pergunta `REQUIRES POC` (**ACHADO-G14-01**); e o contrafactual do append prematuro (**ACHADO-G14-02**) |
| **S5** — `SIGKILL` | Quatro pontos do caminho de append (antes do `self_high_water`, entre ele e o append, com o append **em voo**, e depois dele), com o par replicando a cada volta. Zero fork; o caminho de escrita se recusa a appendar em `desynced` por conta própria (**ACHADO-G14-05**) |

## 3.1 Os números do perfil full

Ambiente e versões estão no artefato; o que segue é o que sustenta o veredito.

| Medida | Valor |
|---|---|
| Ordens de entrega em S1 | **240** intercalações + o nó que recebe os dois logs prontos → **1** hash de dump distinto |
| Par de logs | 11 + 10 registros; 17 aplicados, 4 recusados |
| `ordSum` estável em todo prefixo | `true` |
| Reinterpretação **do começo** (log do par inteiro depois) | parte de `zero`, 21 registros, 1.138 ms |
| Reinterpretação **do meio** | parte de `snapshot`, 25 registros, 3 snapshots descartados, 1.366 ms |
| Fuzzer | **10 000 000** registros, 2 000 lotes de 5 000, 30 720 reg/s |
| `dmFold.panic` | **0** |
| Desfecho fora de `APPLIED`/`REJECTED`/`IGNORED` | **0** |
| `APPLIED` no corpus hostil | **0** (6 666 366 `REJECTED`, 3 333 634 `IGNORED`) |
| Recusa sem código de §31.7.3 · efeito emitido em recusa | **0** · **0** |
| Partição: hash do nó A = nó B = referência | `true` (12+12 registros escritos durante a partição; divergiam enquanto ela durava: `true`) |
| Core encurtado: `core.length` × `self_high_water` | 9 × 24 → `desynced`, 0 append |
| Recomposição a partir do par (`hypercore@11.35.2`) | recompôs `true` em 16.628 ms; blocos byte a byte `true`; append posterior `true`; par leu o bloco novo `true`; forks 0 |
| Append prematuro | conflito `true` em [escritor-divergente, par] |
| `SIGKILL` | **24** mortes em 4 pontos; forks **0**; recusas de append em `desynced` 11; appends após `desynced` **0**; par convergiu `true` |

A curva de `ACHADO-G14-04`, medida numa conversa viva (os dois lados reconhecendo):

| Registros | ms | ms/registro | Janela `ts` lo/hi |
|---:|---:|---:|---:|
| 2 000 | 241.52 | 0.1208 | 1/2 |
| 4 000 | 681.34 | 0.1703 | 1/2 |
| 8 000 | 2894.17 | 0.3618 | 1/2 |
| 16 000 | 12908.26 | 0.8068 | 1/2 |

Log ×8 → ms/registro ×6.68. A janela de `ts` fica em duas entradas
ao longo de toda a curva enquanto o par reconhece; sem `ack` do par ela é do tamanho do log
(`true`).

## 4. Os achados

### `ACHADO-G14-01` — a pergunta aberta de §31.13 tem resposta: **sim**

§31.13 marca `REQUIRES POC` a afirmação de que um escritor pode recompor o próprio core a
partir de um par, sem antes appendar, e proíbe implementar a saída automática de `desynced`
antes de medi-la.

**Medido:** o escritor reabre com `core.length` abaixo do `self_high_water`, conecta ao par,
e o `download` traz os blocos que faltam — assinados pela própria chave dele. Os blocos
conferem **byte a byte**, o append seguinte é aceito no índice certo, o par lê o bloco novo, e
nenhum conflito aparece em lado nenhum.

**Consequência:** a saída (1) de §31.13 — restauração por replicação — **se sustenta**.
`desynced` **não** vira terminal e **L-25 não ganha a segunda metade**. A implementação de
B57 fica condicionada às duas coisas que o gate mediu junto: recompor **antes** de qualquer
append, e manter a barreira do `self_high_water`. O resultado vale para a versão exata de
`hypercore` registrada no artefato, não em geral.

### `ACHADO-G14-02` — o contrafactual: appendar antes de recompor é o fork

O mesmo escritor curto, appendando **antes** de recompor, produz dois blocos diferentes no
mesmo índice assinados pela mesma chave. O `hypercore` não mescla e não escolhe: as duas
pontas emitem `conflict` e fecham a sessão. É a evidência direta de que a ordem "grava
`self_high_water`, compara, só então appenda" não é conservadorismo — é a única coisa entre o
produto e o pior desfecho que §31.13 nomeia.

### `ACHADO-G14-03` — o snapshot é custo, não semântica

Com `snapshotEvery = 0` a reinterpretação parte do zero e refaz a conversa inteira; com
snapshot ela parte do ponto anterior à inserção. **Os dois convergem para o mesmo hash.**
E há um caso em que o snapshot não ajuda por definição: quando a inserção retroativa é o log
do par chegando **inteiro** depois, o ponto de inserção é o começo da conversa e não existe
snapshot anterior a ele. B56 escolhe a cadência sabendo disso.

### `ACHADO-G14-04` — reinterpretar do zero é super-linear

A cópia-na-escrita do `DmDraft` é por **container**: o registro que toca `messages` clona o
`Map` inteiro. Isso é O(estado) por registro, então reinterpretar `n` registros do zero cresce
mais que linear no `n`. **Não é desvio de §31.7.2** — é o preço do arranjo que ela escolhe, o
mesmo do `fold` de §8 — e nenhum critério de §31.26 reprova por isso. A janela de `ts`, medida
junto, fica limitada enquanto o par reconhece (RD-4 poda) e passa a ser do tamanho do log
quando o par nunca escreve, que é a conversa de uma pessoa só e é normal.

**Nada foi corrigido em `core/` por causa disto**: o gate não reprovou, e `core/` não se
altera para um gate passar. É entrada para B56 — é justamente o que o snapshot de
`dm_ds_snapshot` existe para não deixar aparecer no boot.

### `ACHADO-G14-05` — `desynced` sem perda nenhuma

`self_high_water` é gravado **antes** do append. Um `SIGKILL` na janela entre as duas coisas
deixa `core.length = self_high_water − 1`, e a regra de boot de §31.13 lê isso como
`desynced` — mas **nada se perdeu**: o bloco nunca chegou a existir, e o par também não o
tem. A saída (1) do mesmo parágrafo (restauração por replicação, medida em
`ACHADO-G14-01`) **não resolve este caso**, porque não há de onde restaurar.

O critério 5 passa: nenhum fork existiu, e o caminho de escrita se recusou a appendar por
conta própria. O que o gate acrescenta é que a regra é conservadora **demais** nessa janela.
É decisão de **B57**, não deste gate: ou o boot distingue "append pendente que não landou"
(`core.length === self_high_water − 1` com o par não adiante) de uma perda de verdade, ou o
`self_high_water` passa a ser gravado de outra forma. **Registrado, não decidido.**

## 5. O que este gate NÃO decidiu

**B66 e B67** continuam abertas. São as lacunas de especificação que B54 deixou — RD-11 não é
verificável como está escrita, e §31.7.1/§31.7.2 não carregam dois campos que RD-1 e RD-5
exigem. O harness mede o **efeito** delas (o corpus passa por RD-11 e por `clockSkewed` a
cada corrida); ele não pode decidir texto normativo, e não decidiu.

## 5.1 Uma nota sobre o próprio harness

O corpus precisou **garantir** o desvio em três geradores, não sorteá-lo: `content` acima do
teto de §31.7.5, gênese com `authorSeq`/`ack` forçados fora da forma de RD-1, e truncar ao
menos um byte. Sorteados, os três às vezes produziam um registro **válido** — e um registro
válido não é sabotagem, então o critério "todo registro hostil termina em `REJECTED` ou
`IGNORED`" deixava de ser verificável. Foi assim que dois `APPLIED` apareceram numa corrida de
10⁷ antes de a última dessas linhas existir. O PRNG também precisou devolver os bits
**altos**: os baixos de um LCG têm período curto, e `% 12` sobre o valor cru concentrava o
corpus em três das doze sabotagens.

Nenhuma dessas correções tocou `core/`. Um fuzzer que mede o próprio gerador não mede o
`dmFold`, e isso fica registrado porque é o modo de falha que faz um gate parecer verde sem
ter medido nada.

## 6. Limitações (bloqueiam release, não decisão)

1. **Electron empacotado** (matriz de A16) ausente: os cinco cenários rodaram em Node puro.
   `utilityProcess`, preload e o caminho IPC-R de §31.16 são da fase 11.
2. **Queda de energia** não medida. `SIGKILL` mata o processo e não toca o page cache do SO;
   o cenário 5 mede falha de **processo**, que é o que §10.7.1 diz que `await core.append`
   cobre. A outra metade é G4, e §31.10 já declara que ela falta.
3. A recomposição do critério 4 foi medida com o par **online** e com o prefixo perdido
   íntegro. Par offline, e prefixo **corrompido** em vez de curto, não estão medidos — e o
   segundo não é `desynced`, é `forked` (§18.9), que este gate não exercita.
4. A perda local foi reproduzida com um storage novo e a mesma `keyPair` (o prefixo é byte a
   byte o do par, porque Ed25519 é determinístico). Truncar um storage do RocksDB no meio de
   uma escrita é outra falha, e o `device-file` do próprio hypercore a recusa.
5. O projetor, o snapshot e as tabelas `dm_*` daqui **não** são os de §31.12: são estruturas
   do harness. O projetor real, a barreira `view.db` → `manifest.db` → eventos e o
   `dm.reordered` no fio são **B56**.
6. A partição do cenário 3 é a queda do socket. Partição assimétrica, NAT e relay são G5/G8.

## 7. Veredito

**Parcial** — os cinco critérios de §31.26 estão **aprovados** no escopo medido, e os
`openCriteria` de §6 bloqueiam release, não a implementação.

O que isso libera, e o que não libera:

- **A29 não reabre.** Os critérios (1) e (3) passaram: o merge de §31.6 converge sob ordens
  de entrega permutadas e depois de partição real, com hash de dump idêntico.
- **`desynced` não é terminal** e **L-25 não ganha a segunda metade** — `ACHADO-G14-01`.
- **A barreira de §31.10 basta** para falha de processo: nenhum fork sob `SIGKILL`. A emenda
  a A29 que o critério 5 ameaçava exigir **não** é necessária.
- **B56 e B57 destravam**, com três coisas na bagagem: a cadência de snapshot é escolha de
  custo (`ACHADO-G14-03`, `ACHADO-G14-04`), a restauração automática de `desynced` é
  implementável **desde que antes de qualquer append** (`ACHADO-G14-01`, `ACHADO-G14-02`), e a
  janela entre o `self_high_water` e o append precisa de uma decisão (`ACHADO-G14-05`).
