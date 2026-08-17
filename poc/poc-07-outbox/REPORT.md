# POC-07 / G4 — relatório

Leitura consolidada do que o harness mediu e de onde a especificação doeu. O artefato
versionado está em `out/gate-G4/`; este documento é a interpretação dele, e **não é
normativo**. Quando divergir de `backend-v2.md`, o normativo vence — mas três dos achados
abaixo dizem que o normativo precisa mudar antes de a fase 3 ser escrita.

---

## 1. O que o gate perguntou

> Uma operação confirmada não desaparece após queda; uma não confirmada permanece reenviável;
> qualquer retry do mesmo envelope produz **exatamente um** aceite lógico; e nenhum item é
> descartado por idade sem reconciliação.

Três frentes: a matriz de crash de §28.3 com `SIGKILL` em nove pontos, os cenários nomeados do
plano (ACK perdido, host adversário, perda de WAL, expiração, reabertura, RPC duplicado) e a
vazão com o volume do plano.

**Veredito: `CONFIRMADO`**, oito critérios de oito, em 6,7 min.

| | Medido |
|---|---|
| Matriz de crash | 27 casos (9 pontos × 3), **12 com morte real por `SIGKILL`** · 0 perdidas · 0 duplicadas · **27/27 convergiram** |
| Vazão | **100 000** envelopes · 0 perdidas · 0 duplicadas · 1 298 ops/s |
| Latência | p50 0,19 ms · **p95 0,34 ms** · p99 0,38 ms (alvo de §26.1: 60 ms) |
| Group commit | grupo médio **30,8**, teto 32 — §11.5 agrupando de verdade |
| Enfileiramento `FULL` | 0,14 ms/op — ver `OBS-01`, é piso e não teto |
| Cenários nomeados | 9 de 9 |

Os números são de `out/gate-G4/`. O que **não** está neles está na seção 4.

---

## 2. Achados que exigem emenda normativa

### 2.1 `ACHADO-01` — §11.6 ramo 1 perde dados, e contradiz §7.5

**Bloqueante.** O pseudocódigo de §11.6 diz:

```
para cada item em (sending | awaiting-confirmation | failed):
    se ds[community].lastAuthorSeq[eu] >= item.author_seq:
        → a op está no log: remove o item
```

A inferência é **insegura**. `lastAuthorSeq` é uma marca d'água: ela prova que *algum*
`authorSeq` ≥ aquele foi aceito, e não que **este** foi. Basta o log ter buraco na numeração
do autor — e §7.5 declara, na própria tabela, que buracos são esperados: *"O cliente pode ter
buracos em `authorSeq`? **Sim.** A regra é estritamente crescente, não densa."*

**Medido.** Com um host morrendo no meio de uma rajada e o cliente reenviando, o log ficou com
os `authorSeq` `1..7, 13, 14, 15, 20, 21, 24, 27, 29, 30, 31, 33, 34, 35, 40`. A marca d'água
em 40 mandou remover **as 40** linhas da fila, com **21** registros no log. Dezenove operações
foram perdidas *e reportadas como entregues* — exatamente o que §11.3 promete ser impossível:

> "Nunca existe um item entregue e perdido, nem um item perdido reportado como entregue."

**A correção já está no normativo, em outra seção.** §7.5 pergunta e responde:

> "Como o cliente sabe que a op entrou? Procurando o **`opId`** na própria réplica projetada
> (§11.6). Não pela palavra do host."

Ou seja: §7.5 manda testar o `opId`; §11.6 transcreveu a regra como marca d'água. **§7.5 está
certa e §11.6 está errada.** O harness usa o teste exato (`opId` na réplica) e mantém a marca
d'água só como negativa barata — `lastAuthorSeq < author_seq` prova com certeza que a op
**não** está no log, e isso continua válido.

**Emenda proposta:** reescrever o ramo 1 de §11.6 para testar o `opId` observado, com a marca
d'água como pré-filtro opcional, e dizer explicitamente por que a marca d'água sozinha não
serve.

### 2.2 `ACHADO-02` — `authorSeq` por autor × ordem por canal: ops que nunca mais entram

**Bloqueante, e é decisão de arquitetura, não de implementação.**

- §7.5 numera por **autor**: um `uint64` por autor, estritamente crescente, e o estágio 6
  recusa todo `authorSeq ≤ lastAuthorSeq`.
- §11.7 ordena por **canal**: *"Ordem: por `local_seq` dentro do canal; um item bloqueado
  segura o próprio canal e **não os outros**."*

As duas não podem valer juntas quando um membro escreve em mais de um canal. O `authorSeq` é
atribuído no enfileiramento, em ordem global; se o canal `a` está em backoff e o canal `b`
segue — que é o que §11.7 **manda** acontecer —, o host aceita o `authorSeq` maior de `b` e
todo item pendente de `a`, com número menor, passa a ser recusado **para sempre**.

Não é um caso de canto. **Medido:** com 8 canais e uma rajada de 256 envelopes, **45** entraram
no log e **211** foram recusados como duplicata sem nunca terem sido aceitos. É a maioria das
mensagens do usuário.

O que §11.3 oferece não resolve: a transição `failed → queued` diz *"Reenvia **o mesmo
envelope**, mesmo `authorSeq`, mesmo `opId`"* — o mesmo `authorSeq` que o host já recusa. O
item fica insistindo num número queimado.

**Três saídas, e a escolha é do normativo:**

| Saída | O que muda | Custo |
|---|---|---|
| **(a)** `authorSeq` por `(autor, canal)` | §7.1 (envelope), §7.5, estágio 6 de §8.2 | Muda material assinado e o `DS`: `Map<autor, Map<canal, seq>>`. Ops sem canal precisam de um escopo próprio |
| **(b)** Ordem global por comunidade, não por canal | §11.7 perde "não os outros" | Um canal bloqueado passa a segurar todos — exatamente o que §11.7 existe para evitar |
| **(c)** Reenfileirar com `authorSeq` novo ao ser ultrapassado | §11.3 (`failed → queued`) ganha exceção | O `opId` muda, então a correlação com a bolha otimista (`client_ref`) precisa sobreviver à troca |

O harness implementa a **detecção** — o item ultrapassado vira `failed` com
`E_AUTHOR_SEQ_OVERTAKEN`, que é desfecho nomeado em vez de perda silenciosa — e mede a vazão
com **um canal**, que é o caso que a especificação vigente sustenta. Escolher entre (a), (b) e
(c) é emenda, não implementação.

### 2.3 `ACHADO-03` — item em `sending` fica encalhado para sempre depois de um crash

**Bloqueante, e barato de resolver.** §11.3 tem `sending → queued` para "erro transitório", e
§11.6 manda a reconciliação olhar `sending | awaiting-confirmation | failed`. Mas o terceiro
ramo dela é *"indeterminado: mantém, respeitando o backoff"*, e um item que ficou em `sending`
porque o **processo morreu** cai exatamente nele. Como o `flush` só pega `queued`, o item nunca
mais é tentado: nem entregue, nem descartado — de novo contra a frase de §11.3 sobre os dois
estados terminais.

**Medido:** com o host morto em `host:before-append`, 36 de 40 itens ficaram em `sending` e
nenhuma volta de recuperação os moveu. O log parou em 4.

**Emenda proposta:** §11.6 ganha, no boot, a devolução de `sending → queued` para todo item
sem submissão em voo — sem consumir tentativa, porque não houve tentativa concluída (§11.8).
Só no boot: durante a operação normal não há como distinguir "voando" de "órfão" sem um
identificador de processo, e devolver um item em voo dependeria de `E_DUPLICATE` como rede.

### 2.4 `ACHADO-04` — §11.4 e §11.5 não podem ser literais ao mesmo tempo

§11.4 lista dez passos e põe o passo 6 — *"aguarda o append do grupo"* — **dentro** da seção
crítica, com o avanço do `DS` no passo 8 e a liberação no 9. Lido ao pé da letra, a op A segura
a seção enquanto espera o append e a op B nem consegue decidir: **todo grupo tem exatamente um
registro**, e §11.5 deixa de existir.

O harness caiu nisso na primeira versão e **nada acusou** — os testes passavam, a durabilidade
estava certa, e só a métrica `maiorGrupo = 1` denunciou. A leitura adotada preserva as
garantias: decisão, `seq` e avanço do `DS` sob a seção crítica; a **resposta** espera o append,
fora dela; append falho reverte o `DS` do grupo inteiro (passo 7). Com isso o grupo médio
medido passou de 1 para **~30**, com teto de 32.

**Emenda proposta:** §11.4 separa explicitamente o que é serializado (2–4, 8) do que é
esperado fora da seção (6, 10), e §11.5 ganha a frase de que o agrupamento depende disso.

---

## 3. Observações — corretas, mas dizem menos do que parecem

| # | Achado |
|---|---|
| `OBS-01` | **O `fsync` deste ambiente é rápido demais para ser honesto.** Enfileirar em `synchronous=FULL` mediu 0,1–0,2 ms/op, o que não é um fsync de disco real. Em WSL2 sobre ext4 a barreira pode estar sendo absorvida pelo host. O número entra no artefato como **piso**, e a mesma ressalva de `G0-E1` vale aqui: o custo de A06 em hardware real ainda não foi medido. |
| `OBS-02` | **Perder o `-wal` não perde operação.** Apagados os dois `-wal` com os bancos fechados, `manifest.db` e `view.db` mantiveram o conteúdo (o `close` faz checkpoint) e o log seguiu com as 20 ops. O que o cenário mostra não é resiliência do WAL: é que **o log é a verdade** e `view.db` é reconstruível. A assimetria de §10.4 continua justificada, mas por um motivo que não é este. |
| `OBS-03` | **Um `authorSeq` queimado por crash entre a reserva e o commit da fila não é perda.** `nextAuthorSeq` e o `INSERT` na outbox são transações distintas — têm de ser, porque o envelope é assinado com o número antes de existir a linha. Um crash entre as duas queima o número, e §7.5 já abençoa isso ("uma op recusada antes do append queima o número"). O oráculo do harness conta os queimados à parte das perdidas, e a distinção é o que impede um falso positivo. |
| `OBS-04` | **O adversário só é detectável se a comunidade seguir viva.** §11.6 detecta o ACK mentiroso quando `interpretedSeq >= acked_seq`. Um host que mente e **para de appendar** deixa o item em `awaiting-confirmation` indefinidamente: o ramo de expiração exige `acked_seq === null`, então nem expira. Não é perda nem entrega falsa — é limbo. Um escalonamento por tempo em `awaiting-confirmation` fecharia, e não existe hoje. |

---

## 4. O que o gate **não** mede

Declarado no artefato como `limitacaoDeEvidencia`, com id próprio — um artefato que
subdeclara a própria limitação é o defeito que a leitura de G10 encontrou em 2026-08-16.

| # | O que não é medido |
|---|---|
| `G4-E1` | **Queda de energia.** `rocksdb-native` não expõe `WriteOptions`, o padrão do RocksDB é `sync=false`, e sem `fsync` observado o WAL fica no cache de página. `SIGKILL` não perde cache de página; corte de energia perde. §10.7.1 já declara o piso conservador |
| `G4-E2` | **Custo real de `fsync`** — ver `OBS-01` |
| `G4-E3` | **Transporte real.** TCP em loopback, não Noise sobre `hyperdht` (§16.1) |
| `G4-E4` | **Integridade de replicação.** A réplica lê o log por RPC, sem prova de Merkle. O adversário medido mente no ACK, não nos bytes |
| `G4-E5` | **O `fold` completo.** A admissão implementa o estágio 6 de §8.2; as 27 regras e os 38 `kind`s são evidência de G1 |

---

## 5. Leitura para quem for escrever a fase 3

1. **Não transcreva o ramo 1 de §11.6 como está.** Teste o `opId`, como §7.5 manda.
2. **Decida `ACHADO-02` antes de escrever a outbox.** As três saídas mudam coisas diferentes —
   (a) muda material assinado, (b) muda a promessa de isolamento entre canais, (c) muda a
   identidade da op no reenvio. Nenhuma é reversível barato depois.
3. **A seção crítica de §11.4 não cobre o append.** Se cobrir, o group commit morre em silêncio.
4. **`sending` precisa de recuperação no boot.** Sem ela, todo crash durante um envio deixa
   lixo permanente na fila do usuário.
5. **O ACK nunca remove o item.** É a regra que faz todo o resto funcionar, e é a mais fácil de
   "otimizar" por engano.
