# Resolução Arquitetural v2 — o que mudou, o que foi resolvido, o que falta

> **Papel deste documento.** É a prestação de contas da reescrita: o que mudou em relação a
> v1, quais ADRs foram substituídas, quais requisitos de UX mudaram, a disposição
> **individual** dos 195 achados das cinco auditorias, os riscos aceitos, o que permanece
> `REQUIRES POC`, e o veredito final.
>
> **Data-base:** 2026-08-15 · **Emenda pós-G4:** 2026-08-17 · **Base:** `parecer-consolidado-do-architecture-review-board.md`
> (`NOT APPROVED`) e os blockers B1–B10.
>
> **Documentos produzidos:** `backend-v2.md` (spec normativa), `adr-v2.md` (28 ADRs),
> `plano-de-validacao-experimental-v2.md` (13 gates), `deltas-ux-v2.md` (29 deltas).
>
> **Documentos preservados como história, sem precedência nenhuma:** `backend.md`,
> `auditoria-adversarial.md`, `auditoria-sistemas-distribuidos.md`,
> `dry-run-implementacao.md`, `threat-model-seguranca.md`,
> `rastreabilidade-ux-backend.md`, `relatorio-auditoria-adr.md`,
> `auditoria-experimental-de-decisões-arquiteturais.md`,
> `parecer-consolidado-do-architecture-review-board.md`.

---

## 1. Veredito

# ARCHITECTURE RESOLVED

**Nenhum blocker permanece.** Os dez blockers-raiz B1–B10 estão eliminados por decisão
arquitetural escrita e verificável, não por remendo local. A arquitetura tem **uma única
interpretação normativa** e é específica o bastante para que um implementador a siga sem
inventar decisão de arquitetura, contrato, segurança, consistência ou regra de negócio.

**Isso é diferente de "validada".** Oito decisões dependem de prova experimental antes das
fases que elas habilitam. A diferença em relação a v1 é que **cada uma tem hipótese,
critério de aprovação e consequência objetiva de falha escritos**, e a fase dependente está
explicitamente bloqueada. Uma lacuna com gate declarado não é um blocker; é um plano.

| Classificação | Estado |
|---|---|
| Blockers que impedem implementação | **0** |
| Decisões críticas em aberto | **0** |
| ADRs em estado `BLOCKER` | **0** |
| ADRs `REQUIRES POC` (com gate e consequência definidos) | **8** |
| ADRs `BENCHMARK REQUIRED` | **1** |
| Riscos aceitos, declarados e com superfície de UI obrigatória | **22** |
| Achados de auditoria sem disposição | **0** |

**Condição de partida da implementação:** a fase 0 (runtime) pode começar imediatamente. A
fase 1 exige G0 e G10. Nenhuma fase pode começar sem o gate declarado em
`backend-v2.md` §29.

---

## 2. A mudança que explica todas as outras

v1 falhou por uma razão estrutural, não por falta de detalhe. Ela separava três coisas que
precisam ser a mesma:

| Em v1 | Onde vivia | Consequência |
|---|---|---|
| **Autoridade** | o host | — |
| **Validação** | pipeline de 12 estágios lendo a projeção SQLite | A projeção era assíncrona e em lote → a validação decidia contra estado atrasado (`DS-01`) |
| **Interpretação** | reducers que podiam lançar exceção | Lançar parava a comunidade **em toda réplica, deterministicamente, para sempre** (`F-04`) |
| **Verificação na réplica** | só a assinatura | O host podia fabricar qualquer efeito (`T-02`), inclusive com envelope de outra comunidade (`T-01`) |

v2 colapsa as quatro numa só: **o estado é `fold(log)`** — função pura, **total** e
determinística, com toda a autorização dentro, rodando idêntica em todo nó
(`adr-v2.md` A02).

O que isso resolve de uma vez:

- **Corrida legítima não produz registro venenoso.** A corrida perdida vira `REJECTED`
  determinístico em todo nó. As oito corridas que a auditoria distribuída usou para
  demonstrar `DS-01` estão enumeradas e resolvidas em `backend-v2.md` §21.1.
- **O host não fabrica efeito.** Se ele appendar algo que a função rejeita, a função rejeita
  em toda réplica — inclusive na dele.
- **Não existe brick.** A função nunca lança e nunca para. `E_INVARIANT` e
  `projector.failed` deixaram de existir como estados de runtime.
- **A projeção passa a ser de fato descartável**, porque é a materialização de `fold(log)`.
- **A pergunta "qual é o estado de validação e quem o monta"** (`DR-14`, `DR-28`) tem
  resposta: é `DecisionState`, é argumento e resultado de uma função L1 pura, e nenhuma
  camada precisa violar a regra de dependência para montá-lo.

As outras decisões de v2 são consequências ou complementos disso.

---

## 3. Decisões alteradas — resumo executivo

| # | O que era em v1 | O que é em v2 | Por quê |
|---|---|---|---|
| 1 | Host valida contra a projeção | Host valida contra `DecisionState` em memória, avançado no ponto crítico do append | `DS-01` |
| 2 | Reducers podem lançar → comunidade `degraded` permanente | `fold` **total**: `APPLIED` / `REJECTED` / `IGNORED`, nunca para | `F-04`, `F-05`, `F-39`, `F-40` |
| 3 | Réplica só verifica assinatura | Réplica **reexecuta toda a autorização** | `T-02` |
| 4 | `Op` sem campo de comunidade | `communityId` **dentro do material assinado** | `T-01` |
| 5 | `hostTs`/`flags` fora da assinatura | `HostRecord` assinado pela chave do core | `T-27`, `DS-13` |
| 6 | Um `view.db` com `synchronous=NORMAL` para tudo | Dois bancos: `manifest.db` (`FULL`, autoritativo) e `view.db` (`NORMAL`, derivado) | `DS-04`, `F-01`, `DR-21` |
| 7 | Participação e `blobsKey` só na projeção | Participação em `manifest.db`; `blobsKey` no payload assinado da gênese; namespaces derivados de semente persistida | `F-01`, `DS-19` |
| 8 | Dedupe por `opId` com janela de 7 dias, em store separado | `authorSeq` monotônico assinado por `sequenceScope`; dedupe **derivado do log**, sem janela | `T-05`, `DS-03`, `DS-20`, `F-36`, `ACHADO-02` |
| 9 | ACK antes do flush; outbox liberada no ACK | Barreira de durabilidade + liberação **ao observar a própria réplica** | `DS-02`, `DS-06`, `DS-16` |
| 10 | Convite = hash do segredo + prova de conhecimento | Convite = **par de chaves** derivado do segredo; o host valida com a chave pública | `F-02`, `F-09`, `T-06` |
| 11 | Core de blobs único, escrito pelo host | **Core de blobs por autor**, anunciado no log | `F-03`, `F-41` |
| 12 | `blob.stage(path)` com caminho do renderer | **Ticket emitido pelo main** após diálogo do SO | `T-16`, `DR-37` |
| 13 | `position` inteiro denso e único, renumerado | `rank` fracionário esparso | `F-39` |
| 14 | `reaction.toggle` | `reaction.set{present}` idempotente | `DS-12` |
| 15 | Firewall único por processo, só no host | Autorização de replicação **por comunidade, em todo nó** | `DR-30`, `T-25` |
| 16 | "A chave nunca cruza o IPC" (falso) | Data Key cruza o IPC-M; a chave de identidade nunca sai do núcleo — **declarado** | `T-21`, `DR-03` |
| 17 | IPC com high-water que `MessagePort` não fornece | `epoch` + `subId` + `evSeq` + janela de ack + resync | `DR-05`, `DR-06`, `DR-07` |
| 18 | `dev.*` gated por `NODE_ENV` | Gate de **build**, com eliminação de código morto | `T-19` |
| 19 | IPC onipotente sobre renderer não confiável | Quatro classes, com `main-confirmed` para destrutivos | `T-20` |
| 20 | Candidato ICE derivado do HyperDHT | **Revogado.** ICE padrão com **STUN/TURN servidos pelo host da comunidade** | `F-19` |
| 21 | UDX como fallback universal de voz | **Revogado.** WebRTC para tudo; fallback é TURN | `F-20` |
| 22 | "Blind relay não lê porque UDX é cifrado" (falso) | Relay encaminha **SRTP** que não decifra — verdade por construção | `T-11`, `T-14` |
| 23 | Árvore WebCodecs+UDX no v1, 200 espectadores | **Estrela WebRTC, 8 espectadores.** Árvore especificada e adiada | `DS-14`, `DS-15`, `DR-43`, `F-42` |
| 24 | Sinalização peer-a-peer sem autorização | **Ticket de mídia assinado pelo host**, com revogação | `T-15`, `T-32`, `T-41` |
| 25 | Sem sucessão nem backup de identidade | Escrow + migração para core novo; export/import por frase secreta | `T-43` |
| 26 | Só `message.send` assíncrono; resto síncrono contra UI otimista | **Todo o domínio de mensagem** assíncrono; resto confirma-depois-desenha | `F-15` |
| 27 | Auto-save de 800 ms contra op síncrona com rate limit | **Salvamento explícito** | `F-12` |
| 28 | Limites de validação em variáveis de ambiente | **Constantes de protocolo**, fixas no binário | `F-11` |
| 29 | 17 queries sem schema | **Todas** com schema, mais 6 queries novas | `DR-46` e as 5 superfícies sem fonte |
| 30 | Ids truncados em 48 bits, globais | 128 bits, escopados por comunidade e `sequenceScope`, derivados de `(author, sequenceScope, authorSeq)` | `T-30`, `F-05`, `DR-11` |

---

## 4. ADRs substituídas

O mapa completo, linha a linha, está em `adr-v2.md` §1. Resumo:

| Destino | ADRs de v1 |
|---|---|
| **Revogadas** (nenhum código pode assumi-las) | ADR-06, ADR-07 |
| **Substituídas** (a decisão mudou de conteúdo) | ADR-02, ADR-05, ADR-08, ADR-09, ADR-12, ADR-17 |
| **Reformuladas** (a decisão continua, a justificativa ou o mecanismo mudou) | ADR-01, ADR-03, ADR-04, ADR-11, ADR-14, ADR-15, ADR-19, ADR-20 |
| **Mantidas** | ADR-10, ADR-13, ADR-16, ADR-18 |

**Onze decisões novas** que v1 não tinha: vínculo criptográfico à comunidade (A07), core de
blobs por autor (A09), ordenação fracionária (A10), reação idempotente (A11), autorização
de replicação (A12), contrato de IPC (A14), ticket de anexo (A15), tickets de mídia (A22),
sucessão de host (A23), backup de identidade (A24), eixo otimista único (A25).

---

## 5. Requisitos de UX alterados

A lista completa está em `deltas-ux-v2.md`. Os **29 deltas** por categoria:

**Escopo cortado (4):** código de convite de terceiros na lista · múltiplos
compartilhamentos simultâneos · "avisar quem está online" ao sair · árvore de multicast
e o teto de 200 espectadores (vira 8).

**Escopo acrescentado (7):** backup e restauração de identidade · sucessão de host ·
tela de membro removido/banido · consentimento de relay voluntário em 3.1 → Rede ·
sete estados de sistema sem tela (reprojeção, reinício do núcleo, cliente desatualizado,
swarm degradado, replicação atrasada, comunidade encerrada, fork) · seção de privacidade ·
duas telas de honestidade (divergência de confirmação, configuração de rede não padrão).

**Contrato alterado (9):** eixo otimista único · salvamento explícito no lugar de
auto-save · preview de convite com 6 desfechos · código de convite de 16 caracteres ·
`handle` derivado da chave · carimbo com três campos · ordenação de cargos por `rank` ·
preferências lidas do backend · espectador = participante.

**Honestidade obrigatória (9):** sair com o host offline sai só localmente · ban oculta de forma reversível · deletar não apaga os
bytes · editar não apaga a versão anterior · `view_audit_log` é confidencialidade local ·
"silenciar" é conselho, "remover" é enforcement · sem descoberta LAN · "invisível" não é
anonimato de rede · dados em claro no disco.

**Reconhecimento de trabalho (1):** a migração web → Electron não é "zero toque".

**Fixtures:** 11 correções obrigatórias no dataset de referência
(`deltas-ux-v2.md` §3), sem as quais o teste de paridade de §28.7 não pode passar.

---

## 6. Blockers B1–B10 — condição de remoção e como foi cumprida

O ARB definiu, para cada blocker, uma **condição objetiva de remoção**. Abaixo, a condição
e o que a cumpre. Onde a condição exigia execução de gate, isso está separado do que é
decisão arquitetural — porque o blocker era "não há contrato executável", e o contrato
agora existe.

---

### B1 — Estado autoritativo, validação e projeção não são serializáveis

*Findings: F-04, F-05, F-07, F-39, F-40, DS-01, DS-11, DS-12, DS-19, DR-13, DR-14, DR-28.*

| Condição do ARB | Cumprida por |
|---|---|
| Publicar a fonte autoritativa usada na validação | `DecisionState` em memória (`backend-v2.md` §8.1), avançado na seção crítica do append (§11.4). A projeção **nunca** é consultada para decidir |
| Rejeição antes do append para os oito pares de conflito | §21.1 enumera os oito e mostra a resolução de cada um; §11.4 garante que a decisão precede o append |
| Dedupe derivado/reconciliável pelo log | `authorSeq` por `sequenceScope` no `DecisionState` (§7.5) — derivado por construção |
| Tratamento de poison record | **Deixou de existir a categoria.** O `fold` é total (§8.5); referência quebrada tem resolução determinística (§8.4.1) |
| Passar G1 e a crash matrix de G4 | POC-01 e POC-07 definidos, com fuzzer de 10⁷ entradas exigindo `fold.panic = 0` |

**Estado: eliminado.** O modo de falha "brick determinístico e replicado" não existe mais
na arquitetura, porque o mecanismo que o produzia (reducer que lança) foi removido, não
mitigado.

---

### B2 — Reprojeção não reconstrói participação, namespaces e blobs

*Findings: F-01, DR-20, DR-21, DS-19; ADR-02.*

| Condição do ARB | Cumprida por |
|---|---|
| Recuperar 100 % das comunidades, chaves e blobs | Participação e chaves em `manifest.db`, que a reprojeção **não toca** (A03). A reprojeção lê a enumeração de lá, não da tabela que apaga (§10.5) |
| Namespaces recuperáveis | Derivados de `communitySeed` persistido **antes** de criar qualquer core (§5.3). `corestore.namespace(random)` foi removido |
| `blobsKey` normativo | Está no **payload assinado** de `community.create`; `blobsCoreKey` de cada membro está em `member.join` (§5.3, §13.1) |
| Ou abandonar a afirmação de "SQLite totalmente descartável" | **Mantida e agora verdadeira**, porque só `view.db` é chamado de descartável, e ele de fato é |
| Migração de tabelas locais | `manifest.db` tem migração numerada e transacional (§10.2.1) |
| Passar POC-02/G2 | Definido, com 100 ciclos limpos e 100 com crash injetado |

**Estado: eliminado.**

---

### B3 — O protocolo de convites não é executável

*Findings: F-02, F-06, F-09, F-10, F-21, DS-05, RT-01; ADR-09.*

| Condição do ARB | Cumprida por |
|---|---|
| Convite criado por não-host resgatável | O log guarda a **chave pública** do convite; o host valida sem jamais ter o segredo (A08) |
| Canal pré-membro endereçável antes do resgate | `inviteTopic = BLAKE2b('invite-topic/1' ‖ invitePk)`, e o candidato deriva `invitePk` **só do código** (§12.1) |
| Autoria de `member.join` | Assinada **pelo candidato**, com `joinProof` verificável por toda réplica para sempre (§12.4) |
| `maxUses=1` com dez resgates concorrentes | `uses` é `DecisionState`, avançado na seção crítica — exatamente um entra (§12.4) |
| Replay recusado | Duas provas: `liveProof` amarra host e candidato (mata retransmissão no tópico); `joinProof` é idempotente por `(invitePk, candidatePk)` (§12.3, R-9) |
| Seis desfechos mapeados para UI alcançável | Canal de admissão separado, **sem** firewall de banidos (§12.3, A12) — `banned` passa a ser alcançável. UX atualizada (U-03) |
| Passar POC-05/G3 | Definido |

**Estado: eliminado.** Um item virou corte de produto explícito: o código em claro de
convites de terceiros não existe e não pode existir (U-04).

---

### B4 — Caminho de escrita, ownership e segurança de anexos

*Findings: F-03, F-41, DR-37, DS-22, T-16, T-17, T-48; ADR-08/POC-06.*

| Condição do ARB | Cumprida por |
|---|---|
| Escolher e publicar ownership | **Core de blobs por autor**, derivado da identidade e anunciado no log (A09) |
| Transporte, anúncio, seeding | §13.1–13.4: o leitor sabe de qual core buscar pelo `AttachmentRef`; quem baixa vira seeder |
| Resume e cancelamento | `local_blob_staging` com journal de bytes e retomada no boot (§13.5); estados de download com enum fechado (§13.4) |
| Quota | `R-14` no `fold`, mais cache local com GC (§13.8) |
| Verificação de hash | No **destino**, ao completar, com abort por tamanho excedido (§6.10) |
| Provar caminho originado pelo diálogo do SO | **Ticket emitido pelo main** (A15). O núcleo recusa qualquer caminho vindo do renderer |
| Não monopolizar o host | O host **não recebe os bytes**: caminho de controle e caminho de dado são cores, conexões e orçamentos diferentes |
| Passar POC-06/G5 nos três tamanhos | Definido, com o critério "bytes de anexo no RPC de controle = 0" |

**Estado: eliminado.** `T-17`/`T-48` (entrega ao handler do SO) resolvidos por allowlist,
quarentena e redução da superfície inline a cinco formatos de imagem (§13.6), com G11.

---

### B5 — Durabilidade da outbox e idempotência

*Findings: F-16, F-36, DS-02, DS-03, DS-04, DS-06, DS-16, DR-19, DR-22, DR-24; ADR-11/12.*

| Condição do ARB | Cumprida por |
|---|---|
| Barreira de durabilidade / group commit | ACK só depois da resolução do `append` commitado, agrupados fora da seção crítica (§11.4, §11.5) |
| Critério de liberação ao observar a própria réplica | É a **única** condição de remoção do item (§11.3) |
| Reconstrução/reconciliação do dedupe | Dedupe por `sequenceScope` é derivado do log; a liberação da outbox consulta `observed_ops` por `opId` (§7.5, §11.6) |
| Máquina de estados completa | §11.3, com todas as transições e gatilhos |
| `FULL`/`NORMAL` documentados | Bancos separados, cada um com sua política (§10.4) |
| Exatamente dois estados permitidos | Removido (observado) ou `dropped` com motivo nomeado — e **nenhum descarte por idade sem reconciliação** (§11.6) |
| Passar G4 com a crash matrix | POC-07 definido, incluindo kill entre os commits dos dois bancos e host adversário que confirma sem appendar |

**Estado: eliminado.**

---

### B6 — Runtime, IPC, recuperação e fronteira da chave privada

*Findings: F-22, DR-01, DR-02, DR-03, DR-05, DR-06, DR-07, T-19, T-20, T-21; ADR-03/04/19/20.*

| Condição do ARB | Cumprida por |
|---|---|
| Protocolo main↔núcleo | IPC-M com mensagens tipadas e **nenhum dado de domínio** (§15.7) |
| Protocolo renderer↔núcleo | §15.1: `epoch`, `subId`, `evSeq`, `evAck`, `evStale`, resync |
| Autorização de comandos | Quatro classes, `main-confirmed` com token de uso único após confirmação nativa (§15.3) |
| Handshake / ack / watermark / resubscribe | §15.1 — e o backpressure passa a usar um contador da aplicação, porque `MessagePort` não fornece profundidade de fila |
| Política para requests em voo | `E_CORE_RESTARTED`, **nunca reenviados automaticamente**; a escrita está na outbox e é reconciliada (§15.2) |
| Lifecycle de deep link | Gramática fechada, parse no main, dado estruturado ao núcleo, nunca dispara ação (§3.5) |
| Lifecycle da chave | A Data Key cruza o IPC-M; a chave de identidade nunca sai do núcleo. **Declarado**, não negado (A13) |
| Critério de aceite do spike | POC-03 com **regra de decisão** por número de alvos que falham (fecha `DR-01`) |
| Matriz de plataforma | **Fechada**: Win x64 e Linux x64 glibc ≥ 2.31 — macOS fora por decisão de escopo (A16, 2026-08-16); sem alvo arm64 no v1. Rebuild por alvo é contrato de build |
| Passar G0/G6/G10 | Definidos, com varredura automatizada por material de chave em disco, log e IPC-R |

**Estado: eliminado.**

---

### B7 — Integridade das assinaturas e isolamento entre comunidades

*Findings: T-01, T-02, T-03, T-08, T-09, T-22, T-25, T-27, T-30, T-31, T-34, T-35.*

| Condição do ARB | Cumprida por |
|---|---|
| Contexto da comunidade no material assinado | `communityId` no cabeçalho da `Op` (A07) |
| Validação/rejeição nas réplicas | O `fold` roda em toda réplica com **toda** a autorização (A02) |
| Separar/escopar ids, dedupe, firewall e recursos | Ids de 128 bits derivados de `(communityId, sequenceScope, author, authorSeq)`; dedupe por comunidade e escopo; autorização de replicação por comunidade; PK de toda tabela inclui `community_id` |
| Limites antes do decode | §14.4: teto de bytes → bucket → decode → assinatura → `fold` |
| Regras de cargos e menções | R-4, R-5, **R-11** (cargo base, que era o vetor real), R-13 |
| Proteção da chave de escrita do core | Semente da comunidade cifrada pela mesma Data Key que protege a identidade (A13) |
| Cota de bytes permanentes | R-14 e R-15, determinísticas e no `fold` |
| Integridade de configuração | Valores de rede não vêm de arquivo em produção; desvio do default é visível (§25.5, U-21) |
| Passar os testes de segurança | §28.5 e os cenários 8, 9 e 18 do harness (§28.2) |

**Estado: eliminado.** A propriedade central — "o host não fabrica efeito atribuído a
membro, e comunidades são isoladas" — passa a ser **verdade por construção**, verificável
pelos testes de determinismo e de adversário.

---

### B8 — Mídia, relay e autorização de voz/tela

*Findings: F-08, F-19, F-20, F-37, F-42, F-49, DS-14, DR-43, T-11, T-12, T-14, T-15, T-32, T-41, RT-06; ADR-05/06/07/08/17.*

| Condição do ARB | Cumprida por |
|---|---|
| Reabrir conjuntamente ADR-05/06/07/08/17 | Feito: A17, A18 (revogação), A19, A20, A21, A22 |
| Decidir escopo de estrela/árvore | **Estrela no v1, teto 8.** Árvore especificada por completo e **adiada**, bloqueada por G13 |
| Decidir participante/espectador | Espectador **é** participante do canal de voz (U-12) |
| Decidir qualidade | Funciona por espectador na estrela (`setParameters`); na árvore seria por subárvore, e o comando devolve `{applied:false, reason}` em vez de mentir |
| Decidir fallback | **TURN servido pelo host da comunidade**, com credencial de curta duração. UDX como "fallback de voz" está revogado |
| Decidir autorização | **Ticket de mídia assinado pelo host**, com revogação ativa e expiração em 5 min (A22) |
| Confidencialidade do relay | Real: DTLS-SRTP ponta a ponta. O relay encaminha o que não decifra |
| Passar G7/G8, POC-08 e POC-09 | Redefinidos: POC-08 prova demux STUN/UDX, taxa por classe de NAT e cegueira do relay; POC-09 prova a estrela |
| Ou retirar explicitamente as capacidades não aprovadas do v1 | **Feito**: árvore e 200 espectadores saem do v1, com registro (U-09) |

**Estado: eliminado.** Metade por decisão nova, metade por corte de escopo explícito — que
é exatamente uma das duas saídas que o ARB autorizou.

---

### B9 — Contratos de leitura e rastreabilidade UX ↔ backend

*Findings: F-17, F-34, F-43, DR-27, DR-46, RT-01, RT-06 e os demais RT/DR.*

| Condição do ARB | Cumprida por |
|---|---|
| Schema de todas as queries | §15.6 — **todas**, mais seis novas (`query.reactors`, `query.preferences`, `query.resolveMessageLink`, `query.selfModeration`, `query.links` com fonte real, `query.thread` com não-lidas) |
| Schema de todos os eventos | §15.5, com payload por tópico, incluindo os que faltavam (`invites.changed`, `auditLog.changed`, `voice.occupancyChanged`, `voice.deviceError`, `share.failed`, `community.replication`, `community.accessRevoked`) |
| Mapeamento para `types.ts` | `deltas-ux-v2.md` §4 |
| Comportamento de drop/reconsulta | `evStale` + resync obrigatório (§15.1) |
| Catálogo de erros | §20.2, 86 códigos, fonte única |
| Estado final de cada fluxo crítico | §19 |
| Zero `MISSING`/`CONTRADICTORY` nos fluxos críticos | `deltas-ux-v2.md` §2: as 12 `CONTRADICTORY` e as 16 `MISSING` têm disposição — implementada, cortada ou resolvida por mudança de produto |
| Forma do delta do projetor | `Effect` como tipo fechado (§8.4), fechando `DR-27` |

**Estado: eliminado.**

---

### B10 — Moderação, revogação, recuperação de identidade e continuidade

*Findings: F-26, F-35, F-38, DS-08, DR-30, DR-35, T-23, T-32, T-40, T-43.*

| Condição do ARB | Cumprida por |
|---|---|
| Declarar o que ban/kick revoga e o que não revoga | §18.1: tabela completa por ação, com efeito no log, na projeção, na rede e no cliente do alvo. **L-7** declara o que não revoga |
| Enforcement em todos os caminhos, ou aceitar a limitação na UX | Replicação: A12 (todo par recusa, não só o host). Mídia: A22 (revogação de ticket + expiração). Voz cooperativa: **L-12 aceita e a UX distingue** (U-08) |
| Fechar cargo base e menções | R-11 e R-13 |
| Definir desligamento de mídia | `voice.revoked` + TTL de ticket (§17.4) |
| Registrar decisão de recuperação/sucessão de host | **Ambas existem**: escrow + migração para core novo (A23) e backup de identidade (A24), com L-15 e L-16 declarando o que não é preservado |
| Ciclo de vida do dado do expulso/banido | §18.4 + tela nova (U-16) |
| Revogação de convite do emissor que caiu | R-10, automática no `fold` |

**Estado: eliminado.**

---

## 7. Disposição individual dos 195 achados

Legenda: **R** resolvido por decisão arquitetural · **RE** resolvido por remoção/corte de
escopo explícito · **RD** resolvido por declaração honesta (risco aceito, com superfície de
UI obrigatória) · **P** a decisão está fechada e a **capacidade** depende de gate
experimental.

### 7.1 F-01 a F-50 — auditoria adversarial

| # | Disposição | Onde |
|---|---|---|
| F-01 | **R** | A03 + `blobsKey` no log (§5.3) |
| F-02 | **R** | A08 |
| F-03 | **R** | A09 |
| F-04 | **R** | A02, §8.5 (totalidade) |
| F-05 | **R** | §7.3 (128 bits) + A02 |
| F-06 | **R** | §12.4 (`member.join` assinado pelo candidato) |
| F-07 | **R** | §7.2 regra 5 + P-10 |
| F-08 | **R** | A19 (estrela: bitrate por espectador funciona) |
| F-09 | **R** | A08 (tópico derivado de `invitePk`) + §12.3 |
| F-10 | **R** | A12 (canal de admissão sem firewall de banidos) |
| F-11 | **R** | §1.5 (constantes de protocolo) + §8.7 |
| F-12 | **R** | A25 + U-23 |
| F-13 | **R** + **P** | A27 (desenho) · capacidade em G9/B4 |
| F-14 | **R** + **P** | §14.2 (escalonador, `HOST_MAX_PEERS`) · capacidade em G9/B2 |
| F-15 | **R** | A25 |
| F-16 | **R** | §15.6 `query.outbox` com `preview` |
| F-17 | **R** | A14 (`evStale` + resync) |
| F-18 | **R** | U-12 |
| F-19 | **RE** | A18 (revogação) → A17 |
| F-20 | **RE** | A18 (revogação) → A17 |
| F-21 | **RE** | U-04 (corte de produto) |
| F-22 | **R** | POC-03 com regra de decisão |
| F-23 | **R** | §7.4 — 38 `kind`s, número normativo |
| F-24 | **R** | §6.2 — só `member.leave` |
| F-25 | **R** | A28 (watermark, não acumulador) |
| F-26 | **R** | R-13 |
| F-27 | **R** | §26.2 + R-26 |
| F-28 | **R** | §20.2 (86 códigos, fonte única) |
| F-29 | **R** | §11.6 (reconciliação antes de expirar) |
| F-30 | **R** | §11.9 |
| F-31 | **R** | §8.4.1 (limpeza de referência pendurada) |
| F-32 | **R** | §6.1 + `deltas-ux-v2.md` §3 |
| F-33 | **R** | `MessageDto` com três campos |
| F-34 | **R** | `invites.changed`, `auditLog.changed` |
| F-35 | **R** | §18.4 + U-16 |
| F-36 | **R** | A05 (`authorSeq` por escopo; PK da outbox é `local_seq`) |
| F-37 | **RE** | A20 (fora do v1); desenho fecha o consentimento por promoção |
| F-38 | **R** | R-11 |
| F-39 | **R** | A10 |
| F-40 | **R** | P-10 |
| F-41 | **R** | A09 + verificação no destino |
| F-42 | **RE** + **P** | A19 (teto 8) · capacidade em G8 |
| F-43 | **R** | §18.7 (barreira de replicação) + U-06 |
| F-44 | **R** | `clientRef` em `message.accepted` |
| F-45 | **P** | B2 escala até 50 comunidades |
| F-46 | **RD** | Inconsistência documental de v1; v2 é documento novo, com referências verificadas |
| F-47 | **R** | §15.6.1 (`replyTo.deleted`) |
| F-48 | **R** | A28 (recálculo em `roles.changed`) |
| F-49 | **R** | A21 (prova de posse, TTL, cota) |
| F-50 | **R** | §18.6 (máquina de estados retomável) |

### 7.2 DS-01 a DS-31 — sistemas distribuídos

| # | Disposição | Onde |
|---|---|---|
| DS-01 | **R** | A02 + A04 |
| DS-02 | **R** | A06 |
| DS-03 | **R** | A05 (dedupe derivado do log) |
| DS-04 | **R** | A03 (dois bancos) |
| DS-05 | **R** | A08 + A04 (seção crítica) |
| DS-06 | **R** | §11.6 |
| DS-07 | **R** | §11.6 regra 1 |
| DS-08 | **R** | §11.7 + A12 |
| DS-09 | **R** | §14.4 (ordem de admissão) |
| DS-10 | **R** | §11.8 (jitter, taxa, shedding) |
| DS-11 | **R** | §14.5 (estados observáveis + watchdog) |
| DS-12 | **R** | A11 |
| DS-13 | **R** | A07 |
| DS-14 | **RE** | A20 (fora do v1); desenho exige ACK e prova de recepção |
| DS-15 | **RE** | A20 (fora do v1); desenho distingue partição de morte |
| DS-16 | **R** | A06 regra 4 (mesmo envelope no retry) |
| DS-17 | **R** | §14.5 (watchdog `core.length` × `interpretedSeq`) |
| DS-18 | **R** | §26.4 + reconstrução de cache no boot e após `evStale` |
| DS-19 | **R** | A03 + §10.5 |
| DS-20 | **R** | A05 (escopo por comunidade por construção) |
| DS-21 | **R** | `local_seq` monotônico |
| DS-22 | **R** | §13.5 |
| DS-23 | **R** | §11.9 (lote custa `n`) + §26.3 (calibração conjunta) |
| DS-24 | **R** | §11.8 (transições escritas; tentativa só conta se houve entrega tentada) |
| DS-25 | **R** | §11.6 regra 3 (`client-outdated` terminal) |
| DS-26 | **R** | §11.9 (`E_NOT_ATTEMPTED`) |
| DS-27 | **R** | §13.7 (barreira blob↔mensagem) |
| DS-28 | **R** | §11.7 (`E_ALREADY_SENT`) |
| DS-29 | **R** | §11.4 (clamp + `host.clockSuspect`) |
| DS-30 | **RD** | L-13 (at-most-once declarado) |
| DS-31 | **R** | §19.3 (ordem determinada: `messages.appended` antes de `message.accepted`) |

### 7.3 DR-01 a DR-51 — dry run de implementação

| # | Disposição | Onde |
|---|---|---|
| DR-01 | **R** | POC-03 (regra de decisão por número de alvos) |
| DR-02 | **R** | A16 + U-25 |
| DR-03 | **R** | A13 + §15.7 |
| DR-04 | **R** | §3.5 + §10.8 (ordem única de lock) |
| DR-05 | **R** | A14 (`subId`, `evSeq`) |
| DR-06 | **R** | A14 (janela de ack — `MessagePort` não fornece profundidade) |
| DR-07 | **R** | §15.2 |
| DR-08 | **R** | `CoreStatus` (§15.6) |
| DR-09 | **R** | §6.1 |
| DR-10 | **R** | §7.2.1 + layouts em §7.4 |
| DR-11 | **R** | §7.3 |
| DR-12 | **R** | §19.1 (`founderKey` = autor do `seq` 0; `isFounder`/`isDefault` derivados) |
| DR-13 | **R** | §8.0 (`foldRecord(prev, rec, seq)`) + `Effect` |
| DR-14 | **R** | §8.0 |
| DR-15 | **R** | §8.7 (validação do cliente é advisória) |
| DR-16 | **R** | §10.3 (efeitos FTS explícitos, mesma transação) |
| DR-17 | **R** | `content` nullable |
| DR-18 | **R** | §11.4 (o host usa a mesma fila) |
| DR-19 | **R** | A06 (`awaiting-confirmation`) |
| DR-20 | **R** | §10.2.1 (migração numerada) |
| DR-21 | **R** | §10.5 (lê `manifest.communities`) |
| DR-22 | **R** | §11.6 |
| DR-23 | **R** | A25 + §11.1 |
| DR-24 | **R** | §11.3 |
| DR-25 | **R** | §15.6 (enforcement) + L-10 |
| DR-26 | **R** | `create_invite` cria/revoga o próprio; `manage_community` revoga qualquer um |
| DR-27 | **R** | `Effect` (§8.4) |
| DR-28 | **R** | §8.0/§8.1 |
| DR-29 | **R** | `hostStatus` começa em `unknown` |
| DR-30 | **R** | A12 |
| DR-31 | **R** | §12.6 (chave pública + /24, que é o que existe) |
| DR-32 | **R** | `local_navigation` + `nav.setActive` |
| DR-33 | **R** | Enum de 9 valores |
| DR-34 | **R** | §15.4 (gramática de código e link) |
| DR-35 | **R** | §18.4 |
| DR-36 | **R** | §18.7 (barreira de replicação) |
| DR-37 | **R** | A15 |
| DR-38 | **R** | `message_links` + regra de extração |
| DR-39 | **R** | §23.1 (tokens entre aspas desativam a sintaxe `MATCH`) |
| DR-40 | **R** | §13.4 (enum + retomada) |
| DR-41 | **R** | §13.6 |
| DR-42 | **R** | §6.16 (`speaking` do renderer) |
| DR-43 | **RE** | A20 (fora do v1); desenho tem handshake de aresta |
| DR-44 | **RE** | A20 (fora do v1); elegibilidade por upload medido |
| DR-45 | **R** | `local_participant_volume`; relação mudo/ensurdecer vira contrato do roster |
| DR-46 | **R** | §15.6 |
| DR-47 | **R** | `query.reactors` |
| DR-48 | **R** | A28 (`local_thread_read_state`) |
| DR-49 | **R** | `byLabel` congelado |
| DR-50 | **R** | `deltas-ux-v2.md` §3 (dataset produzível por ops) |
| DR-51 | **R** | §27 (clamp + log + aviso na UI) |

### 7.4 T-01 a T-48 — threat model

| # | Disposição | Onde |
|---|---|---|
| T-01 | **R** | A07 |
| T-02 | **R** | A02 |
| T-03 | **R** | A13 (semente da comunidade sob a mesma Data Key) |
| T-04 | **R** + **RD** | A12 remove a leitura perpétua: conhecer o `coreKey` não basta, é preciso ser membro ativo em todo par. O que resta é L-7 (o que já foi replicado permanece) |
| T-05 | **R** | A05 |
| T-06 | **R** | A08 (`liveProof` amarra host e candidato) |
| T-07 | **RD** | L-8 (Sybil) e L-6 (evasão de ban), com mitigações: rate limit pré-membro por chave e /24, `maxUses`, revogação |
| T-08 | **R** | §14.4 + §12.6 (orçamento pré-membro separado) |
| T-09 | **R** | R-14 e R-15 (cotas determinísticas) |
| T-10 | **RD** + **P** | L-2 (declarada) · G10 |
| T-11 | **R** | A21 (SRTP para voz) e A20 (AEAD para a árvore) |
| T-12 | **RE** + **P** | §13.6 (inline só imagem, 5 formatos) · G11 |
| T-13 | **RE** | A20 (fora do v1); desenho exige upload medido |
| T-14 | **R** | A21 (chave derivada da identidade + prova de posse) |
| T-15 | **R** | A22 |
| T-16 | **R** | A15 |
| T-17 | **R** | §13.6 (allowlist + quarentena) |
| T-18 | **R** | §15.6.1 (allowlist de esquema) |
| T-19 | **R** | §15.3 (gate de build) |
| T-20 | **R** | §15.3 (classes de autorização) |
| T-21 | **R** | A13 (redesenho + declaração honesta) |
| T-22 | **R** | §25.5 + U-21 |
| T-23 | **R** | R-10 (revogação automática) |
| T-24 | **RD** | L-20 + U-27 |
| T-25 | **R** | A12 (firewall por comunidade) |
| T-26 | **R** | R-2 (janela de 24 h, sem retroação de 7 dias) |
| T-27 | **R** | A07 |
| T-28 | **R** + **P** | A27 (agregação e rate limit) · capacidade em G9/B4 |
| T-29 | **RD** | L-5, com mitigação: `handle` sempre visível e `displayNameCollision` |
| T-30 | **R** | §7.3 (128 bits, escopados) |
| T-31 | **R** | R-13 |
| T-32 | **R** | A22 |
| T-33 | **R** | §20.3 regra 4 + U-22 |
| T-34 | **R** | §14.4 |
| T-35 | **R** | R-11 |
| T-36 | **RD** | L-21 + U-28 |
| T-37 | **R** | §8.6 (rejeitar, não sanitizar; nomes reservados do Windows cobertos) |
| T-38 | **R** | §12.5 (`hello` exige autorização; admissão é canal separado) |
| T-39 | **R** | §24.2 (allowlist de campos) |
| T-40 | **RD** | L-12 + A22 (o enforcement real) + U-08 |
| T-41 | **R** | A22 (`captureToken`) |
| T-42 | **RD** | §25.7 + L-19 |
| T-43 | **R** | A23 (sucessão) + A24 (backup) |
| T-44 | **R** + **RD** | §15.6 (enforcement) + L-10 |
| T-45 | **R** | §6.12 (timeout avaliado contra `hostTs` no `fold`) |
| T-46 | **R** | §3.5 |
| T-47 | **RD** | L-18 |
| T-48 | **RE** + **P** | §13.6 · G11 |

### 7.5 RT-01 a RT-15 — rastreabilidade UX ↔ backend

| # | Disposição | Onde |
|---|---|---|
| RT-01 | **R** | U-03 (seis desfechos na UX) |
| RT-02 | **R** | `query.preferences` + U-24 |
| RT-03 | **R** | `channel.markRead` declara os dois contadores |
| RT-04 | **R** + **RD** | `query.resolveMessageLink` (4 desfechos); a **promessa de privacidade cai** e a UX é corrigida |
| RT-05 | **R** | `voice.occupancyChanged` + `query.structure.voice` |
| RT-06 | **RE** | U-10 |
| RT-07 | **R** | Enum único de 20 tipos, 1:1 com as ops auditáveis (§6.13) |
| RT-08 | **R** | `share.health` só ao apresentador, destinatário declarado |
| RT-09 | **R** | §3.4 (a medição de nível é do renderer, declarado) |
| RT-10 | **R** | `E_DEVICE_BLOCKED` + `voice.deviceError` |
| RT-11 | **R** | `partial` com quatro causas (§14.5) |
| RT-12 | **R** | U-05 (limites no formulário) |
| RT-13 | **R** | U-06 (mensagem de sistema removida) |
| RT-14 | **R** | `deltas-ux-v2.md` §3 (11 correções de fixture) |
| RT-15 | **R** | Apêndice B com os nomes reais das ações do mock |

### 7.6 Contagem

| Disposição | Marcações |
|---|---|
| **R** — resolvido por decisão arquitetural | 171 |
| **RE** — resolvido por remoção/corte de escopo explícito | 13 |
| **RD** — resolvido por declaração honesta (risco aceito, com UI obrigatória) | 13 |
| **P** — capacidade depende de gate (a decisão está fechada) | 8 |
| **Achados distintos cobertos** | **195 de 195** |
| **Sem disposição** | **0** |

As marcações somam mais que 195 porque alguns achados têm resolução em duas partes
(decisão + declaração, ou decisão + gate de capacidade) e recebem duas marcas. Cada um dos
195 aparece **exatamente uma vez** como linha nas tabelas §7.1–§7.5 — verificável contando
as linhas por prefixo: 50 `F`, 31 `DS`, 51 `DR`, 48 `T`, 15 `RT`.

---

## 8. Riscos aceitos

São **22**, todos em `backend-v2.md` §25.8, todos com superfície de UI obrigatória em
`deltas-ux-v2.md`. Aceitar um risco aqui significa: a alternativa contradiz o produto, é
tecnicamente impossível, ou custa mais do que vale — **e o usuário é informado**.

| # | Risco | Por que é aceito e não corrigido |
|---|---|---|
| L-1 | Censura por omissão e truncamento pelo host | Um escritor único é a decisão-raiz de ordenação (A01). Impedir omissão exigiria multi-writer com consenso, que é pesquisa. A detecção existe (§25.6) |
| L-2 | `safeStorage` não protege contra processo do mesmo usuário; `basic_text` no Linux | Não há proteção melhor sem senha mestra, que reintroduz "esqueci minha senha" num produto sem servidor. O modo inseguro exige aceite explícito |
| L-3 | Sem rotação da Data Key | Escopo do v1 |
| L-4 | Backup não é multi-dispositivo; hospedar de dois lugares produz fork | Multi-dispositivo exige device linking, fora do v1. O fork é **detectado** |
| L-5 | Personificação | Não existe namespace global em P2P. Mitigado por `handle` sempre visível e alerta de nome duplicado |
| L-6 | Banido volta com identidade nova | Identidade é gratuita por desenho. Heurística de detecção seria pior que o problema |
| L-7 | Ban não retira o que o alvo já replicou | Replicação integral é o que faz o modo offline funcionar. Revogação retroativa exigiria criptografia por membro com rekey, que é outro produto |
| L-8 | Sybil | Custo de entrada contradiz "sem conta central" |
| L-9 | Disponibilidade de anexo depende de seeder | É a natureza de distribuição estilo torrent. A alternativa é o host guardar tudo, que reintroduz o gargalo |
| L-10 | `view_audit_log` é confidencialidade local | Consequência direta de replicação integral |
| L-11 | Host atrás de CGNAT não serve STUN/TURN | Sem infraestrutura de terceiro, não há saída. Mitigado por voluntários (A21) |
| L-12 | `voice_mute_others` é conselho | Quem controla o microfone é quem o possui. O enforcement real (remover do roster) existe |
| L-13 | Presença e digitando são at-most-once | Dado com TTL de segundos não justifica durabilidade |
| L-14 | Relay vê metadados | Inerente a relay |
| L-15 | Sucessão não migra o histórico de mensagens | Migrar reassinado falsificaria autoria; migrar os envelopes exigiria core multi-escritor |
| L-16 | Dois sucessores → duas continuações | Resolução determinística por prioridade; evitar exigiria consenso |
| L-17 | Sem moderação em escala entre comunidades | `CLAUDE.md` já a lista como problema em aberto |
| L-18 | Alarme de assinatura ruim não tem resposta automática | Desconectar por falso positivo tiraria o usuário da comunidade dele |
| L-19 | Sem canal de atualização automático | Consequência direta do princípio 1 |
| L-20 | `invisible` não é anonimato de rede | O endereço precisa ser anunciado para a replicação existir |
| L-21 | Dados em claro no disco | Cifrar o banco exigiria senha mestra (ver L-2) |
| L-22 | Sair com o host offline não avisa os outros até ele voltar | O aviso de saída precisa passar pelo log, e o log só aceita append do host. O efeito **local** é imediato, que é o que o usuário controla |

**Quem precisa aceitar:** L-2, L-7, L-10, L-11, L-21 são de **segurança**; L-4, L-5, L-6,
L-8, L-9, L-12, L-15, L-17, L-19, L-20 são de **produto**; as demais são operacionais. A
aceitação deve ser registrada pelos responsáveis — **ela não pode ser inferida por este
documento**.

---

## 9. O que permanece `REQUIRES POC`

Oito decisões. **Nenhuma delas é uma lacuna**: cada uma tem a decisão fechada e escrita, a
hipótese formulada, o critério de aprovação numérico e a consequência objetiva de falha.

| ADR | Gate | Hipótese em uma linha | Se falhar |
|---|---|---|---|
| **A16** — Electron + `utilityProcess` + `better-sqlite3` | **G0** | Os nativos carregam e operam no artefato empacotado, em toda a matriz fechada | 1 alvo falha → sai da matriz, registrado. 2+ falham → reabrir A16 e avaliar sidecar Bare como variante de arquitetura |
| **A13** — fronteira da chave e `safeStorage` | **G10** | A semente de identidade nunca aparece em disco, log ou IPC-R; lock e `wipe` são recuperáveis | Restringir plataforma, ou exigir frase secreta de sessão no Linux sem secret store |
| **A02/A04** — `fold` total e determinístico | **G1** | 10⁷ entradas mutadas sem uma exceção; réplicas convergem sempre | **Parar a construção de domínio.** É falha de projeto, não de ajuste |
| **A06** — barreira de durabilidade | **G4** | Nenhuma operação confirmada é perdida; nenhuma duplicada | Se for custo: renegociar §26.1. Se for a primitiva de flush: especificar barreira alternativa (journal próprio) |
| **A14** — contrato de IPC | **G6** | Três crashes consecutivos convergem, sem escrita duplicada nem vazamento de memória | Formalizar o que faltou antes de implementar stores |
| **A17/A21/A22** — STUN/TURN comunitário, relay, tickets | **G7** | Demux STUN/UDX funciona; ≥ 95 % de conexão na matriz típica; relay não lê payload | Escolher explicitamente: (a) aceitar STUN/TURN de terceiro como dependência declarada, com ADR nova e aviso de IP; ou (b) restringir a promessa de voz às redes em que funciona |
| **A19** — tela em estrela | **G8** | 8 espectadores dentro de latência e CPU; qualidade por espectador funciona | Reduzir `SHARE_MAX_VIEWERS` até o limiar medido e **publicar o número na UI**. Abaixo de 3, reabrir A19 |
| **A23** — sucessão de host | **G12** | Membros convergem para a mesma continuação, sem fork | Cortar a sucessão do v1 e **declarar na UX** que perder a máquina do host é perder a comunidade |

**Mais um gate de segurança sem ADR própria:** **G11** (superfície de decodificador de
anexo). Se falhar, a allowlist inline encolhe; no limite, remove-se a renderização inline.

**Uma decisão `BENCHMARK REQUIRED`:** **A27** (fan-out efêmero), em **G9/B4**. A semântica
permanece; os limites de §26.1 continuam **provisórios** até medir, e **a UI não pode
anunciar número não medido**.

### 9.1 PoCs obrigatórios antes da implementação

Na ordem de execução de `plano-de-validacao-experimental-v2.md` §6:

| Ordem | PoC | Gate | Bloqueia |
|---|---|---|---|
| 1 | POC-03 — runtime e empacotamento | G0 | tudo |
| 2 | POC-10 — chave, lock e `wipe` | G10 | fase 1 |
| 3 | POC-01 — `fold` total e admissão | G1 | fase 2 |
| 4 | POC-07 — durabilidade e idempotência | G4 | fase 3 |
| 5 | POC-02 — reprojeção e recursos | G2 | fase 4 |
| 6 | POC-04 — IPC e recuperação | G6 | fase 4 |
| 7 | POC-05 — convite delegado | G3 | fase 5 |
| 8 | POC-06 — anexos | G5 | fase 6 |
| 9 | POC-11 — decodificador de anexo | G11 | fase 6 |
| 10 | POC-08 — NAT, STUN/TURN, relay | G7 | fase 7 |
| 11 | POC-09 — tela em estrela | G8 | fase 8 |
| 12 | POC-12 — sucessão | G12 | fase 10 |
| — | Benchmarks B1–B8 | G9 | **release** |
| — | POC-13 — árvore | G13 | fora do v1 |

**Os três primeiros são inegociáveis.** POC-03 e POC-10 fecham o runtime; POC-01 fecha a
decisão-raiz. Se POC-01 reprovar, nada do resto importa.

---

## 10. Ainda existe blocker?

**Não.**

Um blocker, na definição do próprio ARB, é um item que **exige que o implementador invente
decisão de arquitetura, contrato, segurança, consistência ou regra de negócio**. Aplicando
esse teste à v2:

| Pergunta | Resposta |
|---|---|
| O implementador precisa decidir qual é a fonte da verdade do estado? | Não — `fold(log)`, §8 |
| ...como validação e append se serializam? | Não — §11.4 |
| ...o que fazer com um registro que quebra uma invariante? | Não — §8.4.1, e a categoria "poison record" não existe |
| ...como reprojetar sem perder participação e chaves? | Não — §10.5 lê `manifest.db` |
| ...como um convite delegado é validado? | Não — §12 |
| ...quem escreve o anexo e onde? | Não — §13.1 |
| ...quando a outbox libera um item? | Não — §11.3 |
| ...o que acontece com requests em voo num crash do núcleo? | Não — §15.2 |
| ...como a chave privada é protegida e por onde ela passa? | Não — §3.2 |
| ...o que o ban revoga? | Não — §18.1 |
| ...o schema de resposta de uma query? | Não — §15.6 |
| ...qual é o layout de bytes de um `kind`? | Não — §7.2.1 e §7.4 |
| ...o que fazer quando o host está atrás de CGNAT? | Não — L-11 e o caminho de voluntários |
| ...se a árvore de tela entra no v1? | Não — não entra, A20 |
| ...o que acontece se a máquina do host morrer? | Não — A23, com L-15 declarando o limite |

**O que permanece não é blocker, é agenda:** oito gates experimentais com hipótese,
critério e consequência escritos, e uma decisão de capacidade com benchmark. Isso é o
oposto do estado de v1, em que os gates existiam mas a decisão que eles testariam era
contraditória ou inexistente.

### 10.1 O que poderia reabrir um blocker

Honestamente registrado, porque é a informação que mais falta num documento como este:

| Se acontecer | Vira blocker de novo? |
|---|---|
| **POC-01 reprovar** (o `fold` não consegue ser total e determinístico com o `DecisionState` cabendo em memória) | **Sim.** É a decisão-raiz. Não há alternativa conhecida que preserve as propriedades de segurança sem uma autoridade central |
| **POC-07 reprovar por primitiva** (o Hypercore 11 não oferece garantia de durabilidade após `flush`) | **Sim, temporariamente**, até a barreira alternativa ser especificada. A arquitetura sobrevive; o mecanismo muda |
| **POC-08 reprovar** (STUN/TURN comunitário inviável) | **Não** — há duas saídas escritas, e ambas são decisões de produto, não buracos |
| **POC-03 reprovar em 2+ alvos** | **Não** — a saída é sidecar Bare como variante, com POC próprio |
| **POC-12 reprovar** | **Não** — a sucessão sai do v1 com declaração na UX |
| Descobrir uma nona corrida que o `fold` não resolve | **Não** — a totalidade garante que ela vira `REJECTED` determinístico; o que muda é a regra `R-*` correspondente, com bump de `opVersion` |

---

### 10.2 Emenda pós-G4 — outbox e escopo de `authorSeq`

O POC-07 confirmou o gate G4, mas revelou quatro contradições no caminho de escrita. A
resolução normativa é:

| Achado | Decisão |
|---|---|
| `ACHADO-01` | A remoção exige `opId` presente em `observed_ops` (`APPLIED`) na réplica local. Watermark é apenas pré-filtro negativo. |
| `ACHADO-02` | A05 passa a usar `sequenceScope`: canal para ops de mensagem e comunidade para ops sem canal. `opVersion`/`Op.v` passam a 2; o mesmo envelope continua sendo o retry. |
| `ACHADO-03` | Boot transforma todo `sending` órfão em `queued`, sem consumir tentativa; `awaiting-confirmation` continua aguardando reconciliação. |
| `ACHADO-04` | A seção crítica não espera I/O; um único grupo em voo é appendado fora dela, e só o append resolvido publica o `DS` e libera ACKs. |

As decisões eliminam a ambiguidade que bloqueava a escrita da fase 3. O código de produto
ainda não foi implementado; a evidência do POC precisa ser rerodada contra `opVersion = 2`
e o cenário multicanal antes de declarar a fase 3 concluída ou o produto pronto para release.

---

## 11. Como reavaliar

Uma nova submissão ao ARB deveria trazer:

1. **Artefatos dos gates**, na ordem de `plano-de-validacao-experimental-v2.md` §6, com
   código do harness, lockfile, dataset, logs brutos e uma decisão explícita por gate:
   *confirmado*, *confirmado com limite alterado* ou *invalidado*.
2. **O teste de determinismo do `fold`** (§28.4) rodando em CI, com hash de dump publicado.
3. **A matriz de rastreabilidade refeita** contra `deltas-ux-v2.md`, com o critério de zero
   `MISSING`/`CONTRADICTORY` nos fluxos críticos.
4. **A aceitação assinada** dos 21 riscos declarados, pelos responsáveis de produto e
   segurança.

**Critério de evidência, herdado do parecer anterior e mantido:** só é aceita evidência
reproduzível, com versões, ambiente, carga, injeção de falha, métricas brutas e limiares
previamente definidos. Um teste local isolado, uma API documentada ou uma correção descrita
sem execução **não** é suficiente.

---

## 12. Índice dos documentos

| Documento | Papel | Precedência |
|---|---|---|
| `backend-v2.md` | Especificação técnica normativa do backend | **1ª** para backend |
| `adr-v2.md` | 28 decisões arquiteturais, com o mapa de substituição das 20 de v1 | 2ª (justificativa) |
| `plano-de-validacao-experimental-v2.md` | 13 gates, 13 PoCs, 8 benchmarks, 18 testes de falha | Vinculante para ordem de fases |
| `deltas-ux-v2.md` | 29 mudanças de produto e a resolução dos 117 comportamentos | **1ª** para produto onde altera `frontend.md` |
| `resolucao-arquitetural-v2.md` | Este documento: mudanças, disposição dos 195 achados, riscos, veredito | Prestação de contas |
| `frontend.md` | Spec de UX/UI, válida no que os deltas não tocam | 3ª |
| `backend.md` e as cinco auditorias | **História.** Preservados, sem precedência | — |

---

*Resolução Arquitetural v2 — 2026-08-15.*
