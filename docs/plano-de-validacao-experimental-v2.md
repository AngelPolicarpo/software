# Plano de Validação Experimental — v2

> **Papel deste documento.** A arquitetura v2 (`backend-v2.md`, `adr-v2.md`) fecha as
> decisões. Este documento define **o que precisa ser provado experimentalmente antes de
> cada fase de implementação**, e o que acontece — objetivamente — quando a prova falha.
>
> **Regra de decisão.** Uma decisão marcada `REQUIRES POC` só é considerada validada quando
> o experimento correspondente produzir evidência **reproduzível**, com ambiente, versões,
> lockfile, carga, injeção de falha e limiar **previamente definidos**. "O pacote documenta
> essa API", "o teste local passou" ou "parece funcionar" **não são evidência**.
>
> **Nenhum gate foi executado.** Este é o plano, não o resultado. A fase dependente de um
> gate **não pode começar** antes do artefato do gate existir.
>
> **Artefato obrigatório de todo gate:** código mínimo do harness, lockfile, configuração,
> dataset, logs brutos, resultado por cenário, versão do SO e do runtime, critérios usados
> e uma decisão explícita — **confirmado**, **confirmado com limite alterado** ou
> **invalidado**.

---

## 1. O que mudou em relação ao plano de v1

A auditoria experimental de v1 definiu G0–G10 e POC-01..POC-10 corretamente. v2 mantém o
método e muda o **conteúdo**, porque metade dos PoCs de v1 existia para testar decisões que
v2 revogou ou reformulou.

| PoC v1 | Destino |
|---|---|
| **POC-01** — autoridade, validação e append sob concorrência | **Absorvido por G1**, com escopo maior: não basta rejeitar antes do append, é preciso provar que a interpretação é **total e determinística** mesmo quando um registro ruim entra |
| **POC-02** — reprojeção, participação e `blobsKey` | **Mantido (G2)**, com hipótese diferente: v2 já não afirma que o log sozinho reconstrói participação; o que precisa ser provado é a separação `manifest.db` × `view.db` |
| **POC-03/04/10** — runtime, IPC, `safeStorage`, lock | **Mantidos (G0, G6, G10)**, com critério de aceite e regra de decisão que v1 não tinha (`DR-01`) |
| **POC-05** — convite delegado e uso concorrente | **Mantido (G3)**, agora testando o protocolo de par de chaves de A08, não o challenge-response impossível de v1 |
| **POC-06** — caminho de escrita de blobs | **Mantido (G5)**, agora testando core por autor (A09), não "membro escreve no core do host" |
| **POC-07** — durabilidade da outbox e idempotência | **Mantido (G4)**, agora com `authorSeq` por `sequenceScope`, liberação por `opId` observado na própria réplica e recuperação de `sending` no boot |
| **POC-08** — ICE por socket, fallback UDX, relay | **Substituído (G7)**: ADR-06/07 estão revogadas. O que se prova agora é STUN/TURN comunitário |
| **POC-09** — WebCodecs, forwarding opaco, árvore | **Adiado (G13)**, fora do v1. G8 prova a estrela |
| — | **Novos:** G11 (superfície de decodificador de anexo), G12 (sucessão) |

---

## 2. Gates

Um gate é uma **condição de entrada de fase**, não um relatório. A fase da direita não
começa sem o artefato do gate.

| Gate | Prova | Bloqueia a fase |
|---|---|---|
| **G0** | Runtime, nativos, empacotamento, matriz de plataforma | 0 → 1 |
| **G10** | `safeStorage`, fronteira da chave, lock composto, `wipe` | 0 → 1 |
| **G1** | `fold` determinístico, total, e admissão serializada | 1 → 2 |
| **G4** | Durabilidade da outbox e idempotência sob crash | 2 → 3 |
| **G2** | Reprojeção, participação, chaves e blobs | 3 → 4 |
| **G6** | IPC: crash, backpressure, resync, convergência | 3 → 4 |
| **G3** | Convite delegado e consumo atômico | 4 → 5 |
| **G5** | Ownership e caminho de escrita de anexos | 5 → 6 |
| **G11** | Superfície de decodificador de anexo | 5 → 6 |
| **G7** | NAT, STUN/TURN comunitário, relay voluntário | 6 → 7 |
| **G8** | Voz, câmera e tela em estrela: latência, perda, CPU, segurança | 7 → 8 |
| **G9** | Escala: throughput, memória, boot, fan-out, multicomunidade | roda em paralelo a 4–8; **obrigatório antes do release** |
| **G12** | Sucessão de host | 9 → 10 |
| **G13** | Árvore de multicast | fora do v1 |
| **G14** | Conversa direta: determinismo do `dmFold` e do merge de duas vias | 10 → 11 |

---

## 3. PoCs

### POC-01 / G1 — `fold` determinístico, total e admissão serializada

**ADRs cobertas:** A01, A02, A04, A05, A07, A10, A11.

| Item | Definição |
|---|---|
| **Hipótese** | (a) Toda corrida legítima entre ops mutuamente incompatíveis é resolvida antes do append, com erro nomeado, sem exceção nenhuma. (b) Mesmo quando um registro inválido, hostil ou de versão desconhecida entra no log, toda réplica converge para o mesmo estado, sem parar. |
| **Construir** | Harness com um host, dez clientes, Hypercore real, fila de admissão serializada, `DecisionState` em memória e projetor SQLite **pausável**. Um segundo binário de host **adversário**, capaz de appendar registros arbitrários sem passar pela admissão. |
| **Não implementar** | Renderer, stores, mídia, blobs, busca, presença. O `DecisionState` mínimo basta para provar a fronteira admissão→append→interpretação. |
| **Ambiente** | Node/Electron com versões travadas; `hyperdht/testnet`; SQLite real em WAL; `PROJECTOR_BATCH` em 32, 256 e 2048; relógio injetável; pausa forçada do projetor. |
| **Inputs** | 10 000 repetições por par de conflito; 2–10 clientes simultâneos; atrasos de projetor de 0, 10, 100 e 1 000 ms; 10⁷ registros mutados no fuzzer de totalidade. |
| **Cenários** | As **oito corridas** de `backend-v2.md` §21.1, cada uma submetida em paralelo com o projetor pausado e com reinício do host no intervalo. Mais: envelope de outra comunidade appendado; `mod.ban` autorado por quem não tem a permissão; `hostTs` retroativo; `hostSig` inválida; `kind` desconhecido; `v` desconhecido; payload truncado; `authorSeq` repetido e regredido. |
| **Métricas** | Ops aceitas, appendadas, rejeitadas antes do append; `fold.panic`; `fold.propertyViolation`; divergência entre réplicas (hash de dump); p50/p95/p99 de submissão; backlog do projetor. |
| **Aprovação** | `fold.panic = 0` em **todas** as 10⁷ entradas do fuzzer. Zero divergência entre réplicas em todos os cenários. Toda corrida rejeitada **antes** do append, com erro determinístico. Todo registro adversário `REJECTED`, `IGNORED` **ou neutralizado por regra determinística declarada** — `hostTs` retroativo é clampado por R-1 e não produz efeito retroativo em réplica nenhuma —, com o mesmo desfecho em **toda** réplica, inclusive na do host adversário. Nenhuma comunidade em estado irrecuperável. |
| **Reprovação** | Uma única exceção não capturada dentro do `fold`; uma única divergência de dump entre réplicas; uma corrida aceita nas duas pontas; um registro adversário com efeito. |
| **Invalida A02 se** | Não for possível manter o `fold` total sem sacrificar determinismo, **ou** o `DecisionState` em memória não couber no orçamento de §26.1 na escala de referência. |
| **Se falhar** | **Parar toda a construção de domínio.** Reabrir A02. A única alternativa conhecida é reintroduzir uma autoridade central de validação, o que contradiz o produto — então a falha aqui é uma falha de projeto, não de ajuste. |

---

### POC-02 / G2 — Reprojeção, participação, chaves e blobs

**ADRs cobertas:** A03, A09.

| Item | Definição |
|---|---|
| **Hipótese** | Apagar `view.db` inteiro e reabrir recompõe a projeção byte a byte, e **nenhuma** comunidade, chave, namespace ou anexo é perdido, porque tudo isso está em `manifest.db` ou no log. |
| **Construir** | Harness de criação e entrada em comunidades, com `manifest.db` completo, cores derivados de semente, `blobsKey` no payload de gênese, core de blobs por autor, snapshot de `DecisionState` e reprojeção real — não um `dump` de tabelas. |
| **Não implementar** | UI, FTS, presença, mídia, permissões completas. |
| **Ambiente** | Corestore/Hypercore/Hyperblobs reais; SQLite em arquivo; 1 host e até 10 membros; `hyperdht/testnet`; repetir nos três SOs da matriz de A16. |
| **Inputs** | 50 comunidades participadas; 5 000 registros por comunidade; 500 blobs; 4 GiB de anexos; versões de schema consecutivas de **ambos** os bancos. |
| **Cenários** | Reprojeção limpa; apagar só `view.db`; apagar `view.db` e o snapshot; bump de `view_schema_version`; bump de `manifest_schema_version` (migração de dado); crash durante o catch-up; crash **entre** o commit de `view.db` e o de `manifest.db`; host offline; convite original perdido; reabertura depois de `identity.wipe` abortado em cada estágio. |
| **Métricas** | Comunidades recuperadas; `coreKey`/`blobsKey`/`blobsCoreKey` recuperados; blobs reabertos e verificados por hash; hash do dump ordenado; tempo de boot; namespaces criados; recursos órfãos; itens de outbox preservados. |
| **Aprovação** | 100 ciclos limpos e 100 com crash injetado, **sem perda de participação, chave, outbox ou `authorSeq`**; 100 % dos blobs conhecidos acessíveis; hash do dump idêntico em todos os ciclos; **nenhum namespace novo** criado para comunidade existente; boot ≤ 4 s no dataset de 5 comunidades / 50 k mensagens. |
| **Reprovação** | Uma comunidade não listada; uma chave perdida; um blob antes acessível que não abre; qualquer divergência de dump; qualquer necessidade de rede ou convite para reconstruir o que a spec diz ser local. |
| **Invalida A03 se** | A separação em dois bancos não bastar — por exemplo, se a reconciliação do read state entre commits não convergir. |
| **Se falhar** | Reabrir A03. Não mascarar duplicando tabelas sem contrato. |

---

### POC-03 / G0 — Runtime, nativos, empacotamento

**ADR coberta:** A16.

| Item | Definição |
|---|---|
| **Hipótese** | O artefato Electron pinado carrega `better-sqlite3`, `hypercore`, `sodium-native` e `udx-native` dentro do `utilityProcess`, executa operações reais e sobrevive a crash e restart, em **todos** os alvos da matriz fechada de A16. |
| **Construir** | Aplicação Electron mínima: main, `utilityProcess`, dois `MessageChannelMain`, dois SQLite com PRAGMAs distintos, criação de core, append como barreira de commit, transação longa, verificação Ed25519, heartbeat. Empacotada com a configuração final de `asar`/`asarUnpack` e assinatura. |
| **Não implementar** | Domínio, renderer de produto, RPC, outbox, mídia. |
| **Ambiente** | **Matriz fechada:** Windows x64 e Linux x64 glibc ≥ 2.31 — macOS saiu da matriz por decisão de escopo (A16, 2026-08-16), então **não há alvo arm64 no v1**. Build empacotado, **não** `electron .`. CI com artefatos arquivados e hashes publicados. |
| **Ambiente Linux (decisão de 2026-08-16)** | O alvo Linux é **executado em WSL2** (Ubuntu 26.04, kernel `microsoft-standard-WSL2`, WSLg). Condições obrigatórias para o resultado contar: **(a)** o diretório de dados fica no ext4 do próprio WSL, **nunca** em `/mnt/c` — DrvFs não dá semântica de `flock`/`fcntl` confiável e invalidaria o lock composto de §10.8; **(b)** os addons nativos são compilados num **container de glibc 2.31**, não no host — ver A16 e `G0-E1`; **(c)** o caso "Linux **com** secret store" exige `gnome-keyring` instalado e destravado na sessão, senão só o caminho degradado é exercitado. |
| **Inputs** | 100 cold starts por alvo; 10 000 appends; transações de 256 e 2 048 registros; WAL e FTS5; crash por exceção nativa e `SIGKILL` do filho. |
| **Cenários** | Dev e empacotado; addon dentro e fora do `asar`; boot sem dados, com dados e após upgrade; crash durante transação, replicação e flush; três reinícios em 60 s; arquivo de dados bloqueado; upgrade de versão de Electron com rebuild. |
| **Métricas** | Taxa de carga do addon; operação nativa concluída; cold start até `core.ready`; p95 de transação; memória; crash do main causado pelo filho; tempo de restart; erros de ABI; locks órfãos; perda de dado. |
| **Aprovação** | 100 % dos testes funcionais em **todos** os alvos da matriz; **nenhum rebuild manual pós-empacotamento**; p95 de boot ≤ 4 s; **zero** crash do main causado pelo filho; recuperação de dado e de lock em 100 % dos ciclos. |
| **Reprovação** | Qualquer alvo da matriz sem addon funcional; qualquer dependência de intervenção manual; crash que impeça o restart; perda de dado confirmado. |
| **Regra de decisão (fecha `DR-01`)** | Falha em **um** alvo → aquele alvo **sai da matriz** e a remoção é registrada em A16 e na UX. Falha em **dois ou mais** → **reabrir A16** e avaliar sidecar Bare como variante de arquitetura, com novo POC. Falha do `utilityProcess` como mecanismo → reabrir A16 antes da fase 1. |
| **Se falhar** | Não começar a fase 1 com um runtime que só funciona em desenvolvimento. |

---

### POC-04 / G6 — Ciclo de vida do IPC e recuperação do núcleo

**ADR coberta:** A14.

| Item | Definição |
|---|---|
| **Hipótese** | O contrato de `epoch`/`subId`/`evSeq`/`evAck`/`evStale` sobrevive a renderer lento, eventos descartados, request em voo e crash do núcleo, sem estado visual incorreto, sem vazamento de memória e sem escrita duplicada. |
| **Construir** | Três processos: main, núcleo e renderer falso. Handshake, `req/res`, assinaturas com id do servidor, janela de ack, resync, e um harness capaz de matar e recriar o núcleo em qualquer ponto. |
| **Não implementar** | Componentes React, regras de domínio, rede P2P. Um estado artificial com contador, lista e operação idempotente basta. |
| **Ambiente** | Electron empacotado, `contextIsolation` e `sandbox` conforme a spec, `MessageChannelMain`, renderer artificial com pausas controladas, heap profiling. |
| **Inputs** | 100 000 eventos; janela de 256; renderer pausado por 1 / 10 / 60 s; duplicação e reordenação; 1 000 requests em voo; crash em cada ponto do ciclo. |
| **Cenários** | Assinatura duplicada; filtros diferentes no mesmo tópico; evento perdido antes e depois de `evStale`; request aplicado antes do crash; request não aplicado; renderer reconectado com `epoch` novo; resync automático. |
| **Métricas** | Memória máxima e após GC; eventos emitidos/descartados; tempo até convergência da query; requests duplicados e órfãos; assinaturas perdidas; loop lag; número de processos vivos. |
| **Aprovação** | Após **três crashes consecutivos**, o renderer converge para o mesmo estado que uma query fresca; **nenhuma operação aplicada duas vezes**; nenhuma assinatura perdida em silêncio; memória volta a ≤ 120 % do baseline após drenagem; todo `evStale` provoca resync correto. |
| **Reprovação** | Estado divergente após resync; request aplicado duas vezes; assinatura perdida sem resync; crescimento de memória sem limite; necessidade de fechar e reabrir a janela para recuperar. |
| **Se falhar** | Formalizar o que faltou **antes** de implementar stores. Se necessário, trocar o quadro `ev`; não esconder ausência de contrato em utilitários do renderer. |

---

### POC-05 / G3 — Convite delegado e consumo atômico

**ADR coberta:** A08.

| Item | Definição |
|---|---|
| **Hipótese** | Um convite criado por **qualquer membro autorizado** é validado pelo host **sem que o host jamais conheça o segredo**, e `maxUses` é aplicado atomicamente mesmo com candidatos simultâneos e projetor pausado. |
| **Construir** | Host mínimo; criador não-host; criador host; dez candidatos; log assinado; canal de admissão `p2p-admission/1` separado; RPC de challenge/liveProof/redeem; `joinProof` no log. |
| **Não implementar** | Comunidade completa, UI, FTS, voz, blobs, DHT pública. |
| **Ambiente** | `hyperdht/testnet`; `protomux-rpc` real; armazenamento persistente; relógio controlado; projetor pausável; host reiniciável. |
| **Inputs** | 100 convites criados por host e por não-host; segredos de 10 B; `maxUses` 1, 2 e ilimitado; convites revogados, expirados, esgotados; candidatos banidos. |
| **Cenários** | Preview e resgate por convite delegado; **dez resgates simultâneos para `maxUses=1`**; crash entre a decisão do `fold` e o append; replay de `liveProof` por um terceiro que observa o tópico; replay de `joinProof` já usado; challenge repetido; conexão perdida após o append; host offline; emissor banido depois de emitir (R-10); candidato banido pedindo preview. |
| **Métricas** | Sucesso legítimo; falsos negativos; candidatos aceitos por convite; `member.join` no log; `uses` contado; provas replayadas aceitas; tempo de validação; conexões fechadas por tentativa inválida. |
| **Aprovação** | **100 %** dos convites delegados legítimos funcionam. Para 10 candidatos e `maxUses=1`: **exatamente um** entra, nove recebem `E_INVITE_EXHAUSTED`. **Zero** replay aceito, inclusive por terceiro no tópico. Zero entrada após revogação observada. **Os seis desfechos de preview alcançáveis**, inclusive `banned`. Nenhum resultado depende de o projetor ter atualizado o SQLite. |
| **Reprovação** | Uma falha de convite delegado; dois membros aceitos para um uso; qualquer prova replayada aceita; um desfecho de preview inalcançável. |
| **Invalida A08 se** | O host não conseguir verificar sem o segredo, **ou** o candidato não conseguir alcançar o host só com o código de 16 caracteres. |
| **Se falhar** | Reabrir A08. Não corrigir só a UI do erro. |

---

### POC-06 / G5 — Ownership e caminho de escrita de anexos

**ADR coberta:** A09; ticket de A15.

| Item | Definição |
|---|---|
| **Hipótese** | Um membro escreve num core de blobs **próprio**, o anuncia no log, e o anexo é recuperável por pares com hash verificável, **sem** que o host receba os bytes e **sem** que o caminho do arquivo passe pelo renderer. |
| **Construir** | Três nós: host, membro que anexa, par seeder. Exercitar `file.pickForAttachment` → ticket → `blob.stage` → `message.send` → anúncio → replicação → download → cancelamento → retomada. Medir bytes do RPC de controle **separadamente** do stream de blob. |
| **Não implementar** | Composer, mensagens completas, permissões visuais, FTS, LRU completo. **Não esconder decisão de ownership dentro de uma abstração de "blob".** |
| **Ambiente** | Hyperblobs/Hypercore/UDX reais; disco real; host online e offline; `hyperdht/testnet`; arquivos de 1 MiB, 1 GiB e 8 GiB gerados deterministicamente em stream. |
| **Inputs** | Arquivos com hash conhecido; upload concorrente; host com fila de submissão ocupada; par com perda de conexão; reinício do anexador no meio do staging; cache perto de 20 GiB; um par malicioso que anuncia 1 KB e entrega 8 GB. |
| **Cenários** | Stage com host desconectado; stage com host online; par entra no meio; par cai; anexador reinicia; download parcial; hash incorreto; tamanho maior que o declarado; mensagem enviada enquanto um blob grande transfere; staging abandonado; renderer tentando fornecer caminho arbitrário. |
| **Métricas** | Sucesso do stage; **bytes atravessando o RPC de controle**; throughput; backpressure; disco e memória; ocupação da fila serializada; p95 de `submitOp` durante o upload; tempo de retomada; pares disponíveis; hash final. |
| **Aprovação** | Nenhum membro tenta escrever em core sem a chave dele. **Bytes de anexo atravessando o RPC de controle = 0.** Blob recuperado com hash correto em 100 % dos ciclos. Ataque de tamanho abortado no leitor. Retomada após crash em 100 % dos ciclos. **p95 de `submitOp` ≤ 250 ms durante o upload nominal.** O renderer não consegue fornecer caminho em nenhum caminho de código. |
| **Reprovação** | O membro não consegue anexar sem uma operação inexistente; o arquivo inteiro precisa atravessar o RPC; o host fica indisponível para mensagens; qualquer blob recuperado diverge do hash; caminho arbitrário aceito. |
| **Se falhar** | Reabrir A09 e A15 antes de implementar anexos. |

---

### POC-07 / G4 — Durabilidade da outbox e idempotência após crash

**ADRs cobertas:** A03, A05, A06.

| Item | Definição |
|---|---|
| **Hipótese** | Uma operação confirmada não desaparece após queda; uma não confirmada permanece reenviável; qualquer retry do mesmo envelope produz **exatamente um** aceite lógico; canais independentes não ultrapassam `authorSeq` uns dos outros; itens `sending` são recuperados no boot; e nenhum item é descartado por idade sem reconciliação. |
| **Construir** | Host com Hypercore real e group commit; cliente com `manifest.db` (`FULL`) e `view.db` (`NORMAL`); injetor de `SIGKILL` em **todos** os pontos de persistência e resposta; proxy que perde ACKs; host adversário que confirma sem appendar. |
| **Não implementar** | UI otimista, mídia, busca. |
| **Ambiente** | SQLite WAL nos dois modos, para **documentar a diferença**; Hypercore persistente; filesystem real; processos separados; injeção de falha no commit/append. |
| **Inputs** | 100 000 envelopes; kills antes do append, depois do append/commit e antes do ACK, depois do ACK, entre o commit de `view.db` e o de `manifest.db`, e durante checkpoint; retries após 1 s, 1 min, 72 h simuladas e restart; oito canais com um autor. |
| **Cenários** | ACK perdido com append durável; ACK positivo antes do append resolvido (deve ser impossível por construção — provar); perda de WAL; expiração de outbox com e sem reconciliação; host offline; duplicação de RPC; reabertura com itens em `sending` e em `awaiting-confirmation`; host que confirma `seq` que nunca aparece no log; watermark com buracos e `opId` ausente; submissão multicanal sem ultrapassagem de escopo. |
| **Métricas** | Operações perdidas; duplicadas; `seq` por `(author, communityId, sequenceScope, authorSeq)`; itens de outbox desaparecidos; remoções sem `opId` observado; `E_AUTHOR_SEQ_OVERTAKEN`; divergência de projeção; tempo de recuperação; fsyncs; p95 de submit; tamanho de WAL; `outbox.ackMismatch`; tamanho e falha de grupos. |
| **Aprovação** | **Zero** perda de operação confirmada. **Zero** duplicata lógica. Todo envelope incerto reconciliado por `opId` observado na própria réplica. **Nenhum item commitado da outbox perdido em nenhum ponto de kill.** O host adversário produz `outbox.ackMismatch > 0` e o item volta a `queued` — nunca é reportado como entregue. Em cenário multicanal conforme, zero `E_AUTHOR_SEQ_OVERTAKEN`. Itens `sending` não permanecem presos após boot. p95 LAN dentro de 60 ms com group commit, **ou** o custo é explicitamente renegociado em §26.1. |
| **Reprovação** | Uma mensagem confirmada perdida; dois `seq` para o mesmo `(author, communityId, sequenceScope, authorSeq)`; qualquer item commitado perdido; qualquer dependência de shutdown limpo para durabilidade. |
| **Entrada já fechada** | *Qual* é a primitiva — `backend-v2.md` §10.7.1 (2026-08-17). `core.flush()` não existe em `hypercore@11.35.1`; o `append` **é** a barreira e só resolve depois do commit, medido durável a `SIGKILL` de processo (N = 1, 50, 500). O que G4 ainda precisa medir é o alcance: `fsync` observado, queda de energia e a matriz de §28.3 sobre o caminho de escrita completo. Não existe ponto distinto entre append e flush. |
| **Invalida A06 se** | O commit do Hypercore 11 não oferecer a garantia de durabilidade assumida sob a matriz de kill completa, **ou** o custo tornar a arquitetura inviável mesmo com group commit. |
| **Se falhar** | Se for o custo: renegociar §26.1, **nunca** a barreira. Se for a primitiva: reabrir A06 e especificar uma barreira alternativa (por exemplo, journal próprio antes do append). |

---

### POC-08 / G7 — NAT, STUN/TURN comunitário e relay voluntário

**ADRs cobertas:** A17, A21, A22.

| Item | Definição |
|---|---|
| **Hipótese** | (a) O núcleo consegue servir STUN e um subconjunto de TURN na **mesma socket UDP** do UDX, com demultiplexação correta. (b) Com o host como STUN/TURN, a taxa de conexão direta e a qualidade de mídia atendem os limiares por classe de NAT. (c) O relay voluntário encaminha SRTP que **não** consegue ler. |
| **Construir** | 4 a 6 pares reais com núcleo e renderer Electron; STUN responder e TURN mínimo (Allocate, Refresh, CreatePermission, Send/Data, ChannelBind) sobre a socket UDX; `RTCPeerConnection` real; um relay **honesto** e um **malicioso** instrumentado para tentar ler payload; emissão e revogação de tickets. |
| **Não implementar** | Comunidade completa, permissões, UI de chamada, árvore de tela, TURN de produção com todas as extensões. |
| **Ambiente** | Rede controlada com NAT full-cone, port-restricted, symmetric e CGNAT quando disponível; `tc/netem` para atraso e perda; Electron empacotado. STUN público de referência usado **só como comparação experimental**. |
| **Inputs** | Voz codificada; câmera; sessões de tela pequenas; perda de 0–5 %; RTT de 20–300 ms; reconexão; par banido no meio da sessão; ticket expirado; ticket forjado. |
| **Cenários** | ICE direto; ICE com STUN do host; ICE com TURN do host; ICE com TURN de voluntário; NAT simétrico dos dois lados; host atrás de CGNAT; queda e reconexão; ban durante a chamada; timeout durante a chamada; canal de voz excluído durante a chamada; tentativa de sinalização sem ticket. |
| **Métricas** | Taxa de conexão por classe de NAT; tempo até conectar; p95 de latência de áudio; jitter; perda; CPU e memória do host servindo STUN/TURN; bytes relayados; taxa de reconexão; tempo entre a revogação e o fim efetivo da sessão; capacidade do relay de ler payload. |
| **Aprovação** | Demux STUN/UDX correto em 100 % dos pacotes de teste (nenhum pacote UDX interpretado como STUN, nem o contrário). **≥ 95 %** de conexão bem-sucedida (direta ou via TURN do host) na matriz declarada como típica — **taxa global abaixo de 80 % reprova a promessa de conectividade**. Áudio com p95 ≤ 250 ms e perda não recuperável < 1 % no cenário nominal. **O relay malicioso não consegue ler nem forjar payload** — verificado por inspeção de captura. Sinalização sem ticket válido é sempre recusada. Ban encerra a sessão em ≤ 5 s (revogação) e, com o evento suprimido, em ≤ `MEDIA_TICKET_TTL_MS`. |
| **Reprovação** | Demux incorreto; taxa global < 80 %; áudio fora dos limiares; relay lendo payload; sessão sobrevivendo ao ban além do TTL de ticket; CPU do host acima de 20 % só para servir STUN/TURN na escala de referência. |
| **Invalida A17 se** | A multiplexação STUN na socket UDX não for viável com as bibliotecas escolhidas, **ou** a taxa de conectividade com o host como único provedor ficar abaixo de 80 %. |
| **Se falhar** | Duas saídas objetivas, e é preciso escolher uma explicitamente: **(a)** aceitar STUN/TURN de terceiro como dependência declarada, com aviso de vazamento de IP na UI e ADR nova; **(b)** restringir a promessa de voz às redes em que funciona, exibindo o diagnóstico de NAT como pré-requisito. Não é aceitável manter a promessa sem uma das duas. |

---

### POC-09 / G8 — Voz, câmera e tela em estrela

**ADRs cobertas:** A19, A22.

| Item | Definição |
|---|---|
| **Hipótese** | Uma sessão de tela em estrela WebRTC com até 8 espectadores atende latência, perda e CPU declaradas, com qualidade por espectador funcionando e captura só após autorização. |
| **Construir** | Presenter Electron com `getDisplayMedia` gated por `captureToken`; 8 espectadores reais; controle de bitrate por `RTCRtpSender.setParameters`; coleta de `RTCStatsReport`; `share.health` só ao apresentador. |
| **Não implementar** | Chat, cargos, convite, busca, gravação, árvore. |
| **Ambiente** | Electron/Chromium empacotado, em GPUs e CPUs disponíveis; `tc/netem` para uplink limitado e perda. |
| **Inputs** | Perfis de 2 500 / 1 200 / 600 kbps; entrada tardia; 2, 5 e 8 espectadores; uplink do apresentador limitado a 5, 10 e 25 Mbps; churn. |
| **Cenários** | Estrela cheia; espectador entra tarde; espectador muda a qualidade; uplink insuficiente; apresentador com CGNAT; 9º espectador; captura tentada sem `captureToken`; ban do apresentador no meio. |
| **Métricas** | Latência apresentador→espectador (p50/p95); CPU e memória do apresentador; bytes enviados por espectador; frames perdidos; efeito real de `setQuality`; tempo de recuperação após perda; tentativa de captura não autorizada. |
| **Aprovação** | Latência p95 ≤ 800 ms com 8 espectadores no perfil `balanced`. CPU do apresentador ≤ 40 % num alvo de referência declarado. `setQuality` produz mudança de bitrate mensurável **por espectador**. Captura **nunca** inicia sem token. Ban do apresentador encerra a sessão. Degradação automática de qualidade quando `share.health` reporta perda > 3 %. **Emenda de 2026-08-26 (§90):** saiu o critério "9º espectador recebe `E_SESSION_FULL`" — o teto de audiência deixou de existir, e um critério sobre uma recusa que o produto não faz mais não mede nada. Os oito espectadores continuam sendo a **carga** do cenário, que é o que o gate sempre quis dizer; o que mudou é que passar dela não é mais recusado. |
| **Reprovação** | Latência p95 > 800 ms; CPU acima do orçamento; `setQuality` inerte; captura iniciando sem autorização. |
| **Se falhar** | Publicar o limiar medido e oferecê-lo como **teto por canal, escolhido por quem administra** (`backlog.md` B38): desde §90 não há constante de protocolo a reduzir, e um número que a máquina do apresentador desmente não é limite, é palpite. Se o limiar cair abaixo de 3, reabrir A19. |

---

### POC-10 / G10 — `safeStorage`, fronteira da chave e lock composto

**ADRs cobertas:** A13, A16.

| Item | Definição |
|---|---|
| **Hipótese** | A Data Key é embrulhada e recuperada nos alvos suportados; a chave de identidade **nunca** existe em claro fora do núcleo; e apenas uma instalação abre o núcleo por vez, inclusive após crash, `wipe` e deep link. |
| **Construir** | Electron mínimo com main usando `safeStorage` só para a Data Key; núcleo que gera a identidade, cifra a semente e assina; lock composto de 4 etapas; segunda instância; `identity.wipe` com máquina de estados retomável; `identity.export`/`import`. |
| **Não implementar** | Comunidade, RPC, renderer de produto. |
| **Ambiente** | Windows e Linux — este último **com e sem** serviço de secret disponível. Artefato empacotado. **Só x64**: a matriz de A16 não tem alvo arm64. |
| **Inputs** | Chaves novas e existentes; lock ocupado; lock órfão; crash antes e depois de cada etapa do lock e do `wipe`; deep link com app aberto e fechado; duas inicializações simultâneas; export/import com frase certa e errada. |
| **Cenários** | Criar/ler/zerar identidade; reiniciar; Linux em `basic_text`; dois launches concorrentes; crash do núcleo; crash do main; `wipe` interrompido em cada estágio; upgrade; deep link encaminhado à instância viva; import em instalação que já tem identidade. |
| **Métricas** | **Varredura de disco, log e quadros de IPC-R por material de chave** (busca por padrão de bytes da semente conhecida); sucesso de recuperação; tempo de boot; erro nomeado de segunda instância; lock órfão; perda de identidade; taxa de encaminhamento de deep link; estágio de `wipe` retomado. |
| **Aprovação** | **Zero** ocorrência da semente de identidade em disco não cifrado, em log, ou em qualquer quadro de IPC-R — verificado por varredura automatizada. 100 % de recuperação nos alvos com secret store. Segunda instância **nunca** abre o núcleo. Cleanup pós-crash em 100 % dos ciclos. `wipe` retoma e completa a partir de **todos** os estágios. `basic_text` recusa abrir sem aceite explícito, e o aceite é persistido e exibido. |
| **Reprovação** | Qualquer material de chave em claro no caminho declarado; identidade irrecuperável sem ação especificada; duas instâncias escrevendo; lock permanente após crash; deep link perdido com o app aberto; `wipe` que não retoma. |
| **Se falhar** | Restringir plataforma, ou mudar a fronteira de confiança (por exemplo, exigir frase secreta de sessão no Linux sem secret store). **Não** manter "safeStorage protege" sem qualificar a plataforma. |

---

### POC-11 / G11 — Superfície de decodificador de anexo

**Cobre:** §13.6, `T-17`, `T-48`, `DR-41`.

| Item | Definição |
|---|---|
| **Hipótese** | A superfície de decodificação exposta a conteúdo de terceiro no v1 (imagem inline em 5 formatos) não produz travamento, uso de memória sem limite nem execução, e a allowlist de abertura pelo SO impede entrega de tipo perigoso. |
| **Construir** | Harness que injeta arquivos malformados no caminho de renderização inline e no caminho de `blob.reveal`. |
| **Ambiente** | Renderer empacotado com `sandbox:true` e CSP final. |
| **Inputs** | ≥ 10⁵ arquivos gerados por fuzzing (PNG, JPEG, GIF, WEBP malformados; extensões trocadas; nomes com travessia, com nomes reservados do Windows, com terminação em ponto e espaço). |
| **Aprovação** | Zero crash do renderer que derrube a janela; memória volta ao baseline; **nenhum arquivo fora da allowlist é entregue ao handler do SO**; **nenhum nome rejeitável de §8.6 chega ao filesystem**; marca de origem aplicada onde o SO suporta. |
| **Reprovação** | Qualquer crash não contido; qualquer entrega fora da allowlist; qualquer travessia de caminho. |
| **Se falhar** | Reduzir a allowlist inline; no limite, remover renderização inline e deixar só download explícito. |

---

### POC-12 / G12 — Sucessão de host

**ADR coberta:** A23.

| Item | Definição |
|---|---|
| **Hipótese** | Um sucessor com escrow válido consegue, após o grace period, criar a comunidade de continuação, provar autorização e fazer os membros migrarem, sem fork e sem perda de estrutura, cargos ou moderação. |
| **Construir** | Host, 3 sucessores com prioridades distintas, 10 membros. Escrow, detecção de inatividade, gênese estendida, prova de posse, migração de rail. |
| **Não implementar** | Mensagens (só a estrutura migra), mídia, busca. |
| **Inputs** | Grace period comprimido; host que volta **depois** da sucessão; dois sucessores assumindo em janelas próximas; sucessor com escrow corrompido; membro offline durante toda a sucessão. |
| **Aprovação** | 100 % dos membros convergem para **a mesma** comunidade de continuação, escolhida pela prioridade; **estrutura (cargos, categorias, canais) e bans idênticos** ao estado final da comunidade antiga; **o roster converge por reentrada assistida** — todo membro que aceitar o convite publicado pelo sucessor entra com a própria chave e recupera os cargos que tinha na origem (L-23, §18.8.1), e um banido da origem que tente reentrar é recusado pelo ban migrado (R-28); a comunidade antiga fica em modo histórico legível; escrow corrompido é recusado com erro nomeado; host que volta depois não consegue "desfazer" a sucessão nem produzir divergência entre réplicas. |
| **Reprovação** | Membros divididos entre duas continuações sem regra; perda de cargo após a reentrada, ou perda de ban; banido da origem que consegue entrar na continuação; fork do core antigo; réplicas divergentes. |
| **Se falhar** | Cortar a sucessão do v1 e **declarar na UX** que perder a máquina do host é perder a comunidade. Não deixar meio implementado. |

---

### POC-13 / G13 — Árvore de multicast (fora do v1)

**ADR coberta:** A20.

| Item | Definição |
|---|---|
| **Hipótese** | Uma árvore calculada pelo host, com fan-out 3, forwarding **cifrado e opaco**, ACK de atribuição e prova de recepção, suporta 200 espectadores dentro dos limites de latência, CPU, reparo e segurança. |
| **Construir** | Presenter com WebCodecs e AEAD por sessão; host que calcula atribuições e exige ACK; 8 viewers reais e simulados adicionais; nós de repasse que **só copiam ciphertext**; heartbeat com `framesReceived`; reparenting com revogação. |
| **Não implementar** | Chat, cargos, convite, busca, codec proprietário. **O nó de repasse não pode decifrar "só para facilitar o POC".** |
| **Ambiente** | Electron empacotado; `tc/netem`; `TREE_FANOUT=3`; heartbeat 2 s; dead-after 6 s. |
| **Inputs** | 2 500 / 1 200 / 600 kbps; keyframe a cada 2 s; entrada tardia; 8 / 50 / 200 espectadores; churn; falha de nós; **nó de repasse malicioso** tentando ler e substituir quadro; **nó particionado só do host**. |
| **Aprovação** | Folha em nível 2 ≤ 2,5 s; CPU do relay ≤ 15 %; **zero decode/reencode no repasse**; **relay malicioso não lê nem substitui quadro**; reparo dentro do dead-after; **nenhuma subárvore escurece com `treeHealth: ok`**; nó particionado não gera dois pais alimentando os mesmos filhos; perda nominal < 1 %. |
| **Reprovação** | Latência de nível 2 > 2,5 s; CPU > 15 %; impossibilidade de manter forwarding opaco; subárvore escura com saúde `ok`; churn que impeça estabilização. |
| **Se falhar** | Manter estrela com o teto medido em G8 e **declarar que o produto não faz broadcast de audiência grande no v1**. Não anunciar "árvore" porque o algoritmo produz uma lista de pais. |

---

### POC-14 / G14 — Conversa direta: determinismo do `dmFold` e do merge

**ADRs cobertas:** A29. **Seções:** `backend-v2.md` §31, com o escopo declarado em §31.26.

| Item | Definição |
|---|---|
| **Hipótese** | O estado de uma conversa direta é uma função pura, total e determinística do **par** de logs de escritor único: dois nós que recebam os mesmos dois logs em ordens de replicação diferentes convergem para o mesmo estado, e nenhuma entrada — inclusive hostil — faz o `dmFold` lançar. |
| **Construir** | Harness com dois nós reais, cada um com o próprio core de DM (§31.3), o merge de §31.6, o pipeline de 13 estágios de §31.7.3 e as regras RD-1..RD-11; dump ordenado do estado projetado com hash; injeção de partição e de `SIGKILL`; fuzzer de registro. |
| **Não implementar** | Comunidade, convite, cargo, outbox, mídia, UI. O gate mede o `dmFold` e o merge, não o produto. |
| **Ambiente** | Node/Electron da matriz de A16, `hyperdht/testnet` (**nunca** a DHT pública), disco local real. |
| **Inputs** | Pares de logs gerados por escrita concorrente; ordens de entrega permutadas; registros com `kind` desconhecido, `DM_VERSION` desconhecida, payload truncado, AEAD que não abre, `authorSeq` fora de RD-3, `ack` maior que o log do par, `ts` retroativo, envelope de outra conversa, autor que não é o dono do core. |
| **Cenários** | (1) mesma dupla de logs entregue em ordens diferentes; (2) inserção retroativa forçando a reinterpretação de §31.13 a partir de snapshot; (3) partição com escrita dos dois lados e reconciliação; (4) escritor que perdeu blocos do próprio core reabrindo com `core.length < self_high_water`; (5) `SIGKILL` em cada ponto do caminho de append. |
| **Métricas** | Hash de dump do estado projetado por nó e por ordem de entrega; contagem de `dmFold.panic` (precisa ser **zero**); desfecho de cada registro hostil; `ordSum` atribuído a cada registro; número de reinterpretações e o custo delas; existência ou não de fork após crash. |
| **Aprovação** | **(1)** Hash de dump **idêntico** entre nós e entre ordens de entrega, em 100 % dos cenários, inclusive com inserção retroativa. **(2)** Zero exceções do `dmFold` sobre o corpus do fuzzer; todo registro hostil termina em `REJECTED` ou `IGNORED` com o código de §31.7.3. **(3)** Convergência após partição, sem intervenção. **(4)** Um core encurtado é detectado como `desynced` **antes** de qualquer append, e nenhum fork é criado. **(5)** `SIGKILL` em qualquer ponto não produz fork nem estado divergente. |
| **Reprovação** | Qualquer divergência de hash entre nós ou entre ordens; qualquer exceção do `dmFold`; fork criado por crash ou por core encurtado. |
| **Se falhar** | Em **(1)** ou **(3)**, o merge de §31.6 não é a solução e **A29 reabre** — a alternativa registrada lá é a comunidade degenerada, com os quatro custos que a ADR enumera. Em **(2)**, é bug de implementação, não de desenho. Em **(4)**, `desynced` vira estado **terminal**: a saída automática por restauração some, sobra o aceite explícito de perda, e **L-25** ganha a segunda metade. Em **(5)**, a barreira de §31.10 não basta e a escrita de DM precisa de fila durável em `manifest.db`, o que reintroduz parte de §11 e exige emenda própria a A29. |

**Pergunta aberta que este gate responde, e que a spec não pode assumir (§31.13):** se o
`hypercore@11.x` permite a um escritor **recompor o próprio core** a partir de um par, sem
antes appendar. Enquanto não medido, a saída de `desynced` **não pode ser implementada**
como restauração automática.

---

## 4. Benchmarks

Todos registram hardware, SO, versão de Electron/Node, lockfile, configuração, dataset,
número de amostras, warm-up, percentis e artefatos brutos.

| # | Benchmark | Hipótese | Carga mínima | Métricas | Critério |
|---:|---|---|---|---|---|
| **B1** | Admissão, group commit e projeção | O host mantém ordem e throughput com durabilidade real, inclusive com autores em vários canais | 100 k ops, 340 membros, lotes 32/256/2048, group commit 0/4/16 ms, múltiplos canais | ops/s, p95/p99 de `submitOp`, `commit.groupSize`, `commit.flushMs`, fsync/s, CPU, WAL, backlog, `E_AUTHOR_SEQ_OVERTAKEN` | Projeção ≥ 8 000 reg/s, `submitOp` LAN p95 < 60 ms e zero ultrapassagem em cenário conforme. **Abaixo de 3 000 reg/s ou acima de 250 ms é falha de capacidade e deve ser reportada como tal**, não otimizada depois |
| **B2** | Boot, memória e multicomunidade | O escalonador de §14.2 não causa starvation nem estoura memória | 5 comunidades / 50 k mensagens, escalando a 50 comunidades | cold/warm boot, `core.ready`, memória, CPU, filas por tópico, tempo até `synced` por comunidade | Boot < 1,5 s (teto 4 s); memória < 250 MiB (teto 500 MiB); **nenhuma comunidade fica sem janela de replicação por mais de `BG_ROTATION_MS`** |
| **B3** | `DecisionState` em memória | O `DS` cabe no orçamento na escala de referência | 50 comunidades, 340 membros, 200 k mensagens na ativa | bytes do `DS` por comunidade em `light` e `full`, tempo de carga de snapshot | `light` ≤ 512 KiB por comunidade; `full` ≤ 40 MiB; boot com snapshot ≤ 1/5 do boot sem |
| **B4** | Fan-out efêmero | Presença e typing agregados não degradam a escrita | 340 membros, presença a cada 15 s, typing a cada 3 s, rajadas de 10 e 100 | mensagens/s, bytes/s, loop lag, drops, backlog RPC, p95 de `submitOp` | Sem starvation de escrita; `submitOp` dentro do teto; eventos descartados apenas com resync correto |
| **B5** | FTS5 e queries | A busca e as queries atendem a experiência offline | 10 k e 100 k mensagens; diacríticos; prefixos; filtros combinados | p50/p95/p99, CPU, tamanho do índice | `query.search` < 30 ms no alvo e < 120 ms no teto; `query.messages` < 3 ms e < 15 ms |
| **B6** | IPC e backpressure | A janela de ack limita memória sem perder convergência | 100 k eventos, renderer lento, janela 256 | heap, loop lag, `evStale`, tempo de resync | Memória volta perto do baseline; resync converge; nenhuma operação crítica perdida ou duplicada |
| **B7** | Blobs | Anexos grandes não monopolizam o controle e retomam | 1 MiB, 1 GiB, 8 GiB; 3 pares; perda e restart | throughput, **bytes no RPC de controle**, p95 de `submitOp`, disco, memória, tempo de retomada, hash | Bytes de anexo no RPC de controle = 0; hash 100 % correto; p95 de controle < 250 ms |
| **B8** | Host como STUN/TURN | Servir STUN/TURN não inviabiliza o host | 24 participantes de voz, 50 % via TURN | CPU, memória, banda de saída, p95 de `submitOp` durante a chamada | CPU adicional ≤ 20 %; `submitOp` dentro do teto; banda de saída dentro do orçamento declarado |

### Regras para não falsear benchmark

Distinguir **capacidade isolada** de **capacidade sob competição**: projeção rápida em
SQLite não valida 50 comunidades em background, e conexão em LAN não valida NAT simétrico.
Cada resultado publica pelo menos uma execução nominal, uma no limite e uma com falha
injetada. É obrigatório medir checkpoint, GC, flush, verificação Ed25519, replicação e
mídia **no mesmo processo**. **Média não aprova meta definida em p95 ou p99.** Se o teto só
for atingido com configuração diferente da de produção, o resultado é **reprovação**, não
otimização futura.

---

## 5. Testes de falha obrigatórios

| # | Teste | Ponto de injeção | Oráculo |
|---:|---|---|---|
| 1 | Corrida de admissão | Projetor pausado entre dois appends incompatíveis | Segunda op rejeitada antes do log; zero exceção; réplicas idênticas |
| 2 | Registro hostil no log | Host adversário appenda diretamente | `REJECTED`/`IGNORED` em toda réplica; `seq` avança; nada para |
| 3 | Crash antes/depois do append | `SIGKILL` antes do append, depois do commit e antes do ACK, e após o ACK | Op fica entregue ou pendente reconciliável; nunca confirmada e perdida |
| 4 | Crash entre os dois bancos | Kill entre commit de `view.db` e de `manifest.db` | Read state reconciliado no boot; nenhum item de outbox perdido |
| 5 | Power loss simulado | Commit/fsync bloqueado + kill, nos dois modos de `synchronous` | Nada commitado em `manifest.db` desaparece; a diferença entre os modos é **documentada** |
| 6 | Último uso de convite | 10 resgates simultâneos, `maxUses=1`, projetor parado | Exatamente um `member.join` |
| 7 | Convite não criado pelo host | Criador não-host, host sem o segredo | Sucesso legítimo em 100 % |
| 8 | Fuzzer de totalidade | 10⁷ registros mutados | `fold.panic = 0` |
| 9 | Apagar e reabrir a view | Apagar `view.db`, interromper a reprojeção, reiniciar | Comunidades, chaves, blobs e dump idênticos |
| 10 | Crash do núcleo e IPC | Matar o `utilityProcess` durante request e evento | `epoch` novo, resync, convergência, zero escrita duplicada |
| 11 | Host offline e ACK perdido | Queda após append e antes da resposta; offline > 72 h | Reconciliação antes de expirar; nada entregue é reportado como falho |
| 12 | Host que confirma sem appendar | Host adversário | `outbox.ackMismatch > 0`; item volta a `queued`; alarme visível |
| 13 | Par/relay perdido | Derrubar par durante voz e download | Reconexão no orçamento; falha nomeada; hash intacto |
| 14 | NAT assimétrico | Bloquear uma direção | Estado por par independente; fallback e erro observáveis |
| 15 | Lock órfão e `wipe` | Matar main/núcleo em cada etapa e executar `wipe` | Segunda instância não corrompe; `wipe` retoma; erro nomeado |
| 16 | Versão incompatível | Mudar `opVersion` | Cliente em somente-leitura; outbox drenada como `client-outdated`; **nunca escreve dado desconhecido** |
| 17 | Ban durante chamada | Banir participante em voz | Sessão encerrada por revogação em ≤ 5 s, e por TTL em ≤ 5 min mesmo com o evento suprimido |
| 18 | Replicação para banido | Banido tenta replicar de um par qualquer | Todo par recusa o canal, não só o host |
| 19 | Escopos de `authorSeq` | Um autor envia em 8 canais com backoff independente | Todos os envelopes são aceitos uma vez; nenhum item nunca aceito vira `E_DUPLICATE` |
| 20 | Reconciliação por identidade | Watermark acima de item ausente, com `opId` não observado | Item não é removido nem reportado como entregue; `E_AUTHOR_SEQ_OVERTAKEN` fica nomeado |
| 21 | Recuperação de `sending` | Kill antes do append e entre commit e ACK; reabrir | Todo `sending` volta a `queued` no boot sem incremento de tentativa; zero duplicata |
| 22 | Group commit fora do lock | 32/64 submissões concorrentes e append falho | Grupo maior que 1 no caso nominal; nenhum ACK parcial; rollback integral do `DS` provisório |

---

## 6. Ordem de execução

```
G0 ─┬─ G10 ──▶ fase 1
    │
    └──▶ G1 ──▶ fase 2 ──▶ G4 ──▶ fase 3 ──┬─ G2 ─┐
                                            └─ G6 ─┴─▶ fase 4 ──▶ G3 ──▶ fase 5
                                                                        │
                                        ┌───────────────────────────────┘
                                        └─ G5 + G11 ──▶ fase 6 ──▶ G7 ──▶ fase 7
                                                                    │
                                        ┌───────────────────────────┘
                                        └─ G8 ──▶ fase 8 ──▶ fase 9 ──▶ G12 ──▶ fase 10 ──▶ G14 ──▶ fase 11

G9 (benchmarks) roda em paralelo a partir da fase 4 e é OBRIGATÓRIO antes do release.
G14 pode ser EXECUTADO a partir da fase 2 — `dmCodec` e `dmFold` são L1 puros e não
dependem de rede, banco nem relógio —, mas continua bloqueando a entrada da fase 11.
G13 fica fora do v1.
```

**Regra composta de aprovação.** Um gate só passa quando **todos** os seus subcritérios
funcionais, de falha e de rede forem aprovados. Um resultado de desempenho que passe com um
resultado de durabilidade que falhe é **reprovação do gate inteiro**. Para as decisões
`BENCHMARK REQUIRED`, a semântica pode permanecer, mas os limites de §26.1 continuam
**provisórios** até o benchmark passar — e a UI não pode anunciar um número não medido.

---

## 7. O que este plano **não** prova

Registrado para que ninguém confunda cobertura com garantia:

- **Não prova** que a arquitetura é a melhor possível — prova que ela é executável e que as
  propriedades declaradas se sustentam sob as falhas testadas.
- **Não prova** comportamento em escalas acima das testadas. 340 membros é a escala de
  referência; acima disso, os números de §26.1 continuam sem evidência.
- **Não prova** segurança contra um adversário com capacidade de rede global, nem contra
  comprometimento do dispositivo. As limitações L-1 a L-19 de `backend-v2.md` descrevem o
  que fica de fora.
- **Não substitui** revisão de código nem análise de dependências. G0 inclui SBOM, mas não
  auditoria de terceiros.
- **Não prova o alvo Linux num desktop nativo** (`G0-E1`, A16). O artefato de G0 para Linux
  sai de **WSL2**, por decisão de 2026-08-16. Ficam sem evidência: registro de handler
  `xdg-mime`/`.desktop` e o caminho de deep link de §3.5 numa sessão de desktop real, cold
  start com o perfil de I/O de um disco nativo, e a entrega do secret store como um desktop
  a faz. Seguem provados em WSL2, porque não dependem de sessão gráfica: carga dos addons,
  operação nativa, transação longa, crash e restart do `utilityProcess`, `SIGKILL` do
  filho, lock composto e recuperação de lock órfão.
