# Parecer Consolidado do Architecture Review Board

## Decisão

# **NOT APPROVED**

A arquitetura **não está tecnicamente pronta para implementação**. A decisão não decorre de uma nova revisão superficial, mas da consolidação dos achados anteriores, do dry run, da matriz de rastreabilidade, do threat model, da auditoria de ADRs e da auditoria experimental.

A evidência disponível mostra três fatos decisivos. Primeiro, existem contradições e impossibilidades de contrato em caminhos centrais: reprojeção e participação, convites delegados, anexos, validação concorrente, durabilidade, deduplicação, IPC, mídia e isolamento de segurança [1] [2] [3] [4] [5] [6]. Segundo, a cadeia UX ↔ backend ainda tem apenas 38 de 117 comportamentos classificados como `COMPLETE`; há 50 `PARTIAL`, 16 `MISSING`, 12 `CONTRADICTORY` e 1 `UNCLEAR` [6]. Terceiro, os PoCs e benchmarks obrigatórios foram especificados, mas **não há resultados executados, artefatos brutos, logs, métricas ou decisão experimental** no corpus. A auditoria experimental declara expressamente que nenhuma meta de latência, escala, recuperação, NAT, mídia ou durabilidade foi validada experimentalmente [5].

> Documentar uma correção, criar um plano de PoC ou afirmar que uma API existe não remove um finding que exige prova de integração, recuperação, segurança ou desempenho.

Não há evidência suficiente para marcar qualquer finding anterior como `RESOLVED` ou `REFUTED`. Os findings abaixo são classificados como **confirmados** quando a lacuna ou contradição está demonstrada pela própria especificação; quando o problema depende de comportamento de runtime, rede ou escala, a classificação registra o finding como confirmado como hipótese/lacuna, mas a consequência empírica permanece inconclusiva e exige PoC. Os poucos `ACCEPTED RISK` são limitações de baixo impacto ou semânticas efêmeras que podem ser aceitas sem alterar a arquitetura; não são considerados correções.

## Base de evidência e critério aplicado

A especificação do backend proíbe que o implementador invente decisões quando o contrato é omisso [1]. O dry run parou antes de concluir a fase 1 e no primeiro módulo da fase 2, com 7 gaps classificados como `BLOCKER`, porque faltavam assinaturas, encodings, origem de IDs, canal de controle, estado de validação e critérios de aceite [4]. A auditoria distribuída identificou cinco casos críticos irreversíveis relacionados à corrida entre validação e projeção, duplicação após crash, ACK antes de durabilidade, `synchronous=NORMAL` e resgate concorrente de convite [3]. O threat model identifica garantias de segurança ausentes que contradizem afirmações explícitas da spec, incluindo revogação de leitura, vínculo da assinatura ao contexto, proteção da chave contra processo local e resiliência da projeção a dado hostil [7].

A auditoria experimental definiu os gates G0–G10, mas não reportou execução de nenhum deles. Portanto, todos os gates obrigatórios permanecem **não passados**: runtime e addons, estado autoritativo, reprojeção, convites, persistência, blobs, IPC, rede, mídia, escala e segurança de identidade [5].

| Gate | Evidência entregue | Situação | Consequência para a decisão |
|---|---|---|---|
| G0 — runtime e artefatos nativos | Apenas plano de teste; nenhum artefato ou matriz por SO/arquitetura | **Não passado** | O caminho Electron/utility process não está validado |
| G1 — estado autoritativo | Nenhum harness executado | **Não passado** | Corridas legítimas ainda podem gerar log venenoso |
| G2 — reprojeção | Nenhum ciclo de apagar/reabrir com manifesto e blobs | **Não passado** | ADR-02 continua contradita |
| G3 — convites | Nenhum teste de convite delegado ou `maxUses=1` | **Não passado** | A entrada do produto continua não executável |
| G4 — persistência/idempotência | Nenhum crash matrix, kill test ou reconciliação | **Não passado** | Não há garantia contra perda confirmada ou duplicata |
| G5 — blobs | Nenhum PoC de ownership, escrita, resume e anúncio | **Não passado** | Anexos continuam sem caminho executável |
| G6 — IPC | Nenhum teste de crash, ack, watermark e resubscribe | **Não passado** | Recuperação do núcleo permanece indefinida |
| G7 — rede | Nenhuma matriz NAT/relay executada | **Não passado** | ADR-06/07/08 permanecem provisórias ou contraditas |
| G8 — mídia | Nenhum teste de codec, relay, reparo e segurança | **Não passado** | Voz/tela não podem ser tratadas como validadas |
| G9 — escala | Nenhum benchmark com percentis e competição | **Não passado** | Limites de §19 continuam hipóteses |
| G10 — segurança de identidade | Nenhum teste de `safeStorage`, lock, wipe e fronteira IPC | **Não passado** | A postura de proteção de chave não está demonstrada |

## Matriz consolidada dos findings anteriores

### Findings F-01 a F-50 — auditoria adversarial

| ID | Situação | Classificação | Correção e efeito introduzido | Evidência/localização resumida |
|---|---|---|---|---|
| F-01 | Confirmado | **BLOCKER** | Nenhuma correção demonstrada; manter SQLite descartável continua perdendo participação e `blobsKey` | `backend.md` §§6.3–6.4, 11.1, 11.4; [2] [5] |
| F-02 | Confirmado | **BLOCKER** | Challenge-response atual não resolve convite criado por não-host; uma solução que envia segredo muda o threat model | `backend.md` §§4.11, 11.4; [2] [5] |
| F-03 | Confirmado | **BLOCKER** | Não há correção; membro não pode escrever no core de blobs do host e upload via host não foi especificado nem medido | `backend.md` §§6.2, 10.2, 11.1, 11.13, 14.1; [2] [5] |
| F-04 | Confirmado | **BLOCKER** | Parar o projetor sem recuperação apenas conserva o brick; não há política de poison record ou replay seguro | `backend.md` §6.4; [2] [3] |
| F-05 | Confirmado | **BLOCKER** | Truncar IDs não foi corrigido; tombstone não remove registro venenoso do log | `backend.md` §§4.4, 4.7, 4.18; [2] [7] |
| F-06 | Confirmado | **BLOCKER** | `member.join` continua sem autor, transporte e payload suficientes | `backend.md` §§5.3, 9.1, 11.4; [2] [4] |
| F-07 | Confirmado | **BLOCKER** | Leitor tolerante e invariantes seguem sem contrato de versão e recuperação | `backend.md` §§5.2, 4.18; [2] [4] |
| F-08 | Confirmado como contradição; impacto empírico inconclusivo | **REQUIRES POC** | Nenhum PoC de qualidade por espectador, SVC ou alternativa foi executado | `backend.md` §§10.8, 11.17; [2] [5] |
| F-09 | Confirmado | **BLOCKER** | Não há canal pré-membro que o candidato consiga endereçar antes do resgate | `backend.md` §§10.5–10.6, 11.4; [2] [4] |
| F-10 | Confirmado | **BLOCKER** | O firewall não foi conciliado com o preview `banned`; documentar o estado não o torna alcançável | `backend.md` §§11.4, 14.3; [2] [3] |
| F-11 | Confirmado como risco de divergência; escala inconclusiva | **REQUIRES DECISION** | Compartilhar TypeScript não resolve configuração, relógio, limites ou ambiente divergentes | `backend.md` §9.2; [2] [5] |
| F-12 | Confirmado | **REQUIRES DECISION** | Auto-save, append-only, rate limit e ausência de fila continuam sem política única | `backend.md` §§9.3, 12.3; [2] [6] |
| F-13 | Confirmado como lacuna; capacidade inconclusiva | **REQUIRES POC** | Nenhum benchmark de fan-out em 340 membros foi executado | `backend.md` §§10.7, 19.1–19.2; [2] [5] |
| F-14 | Confirmado | **BLOCKER** | Não existe política de alocação/degradação para 128 conexões entre comunidades, voz e background replication | `backend.md` §§13.1, 14.2, 19.2; [2] [5] |
| F-15 | Confirmado | **REQUIRES DECISION** | A UI otimista não tem contrato de fila, rollback ou comportamento offline para ações não-mensagem | `backend.md` §10.2; [2] [6] |
| F-16 | Confirmado | **BLOCKER** | `query.outbox` sem schema impede reconstruir a promessa de fila durável | `backend.md` §10.4; [2] [4] [6] |
| F-17 | Confirmado | **BLOCKER** | `ipc.dropped` não cobre eventos sem query ou semântica de reconsulta | `backend.md` §10.1; [2] [4] |
| F-18 | Confirmado | **REQUIRES DECISION** | A distinção espectador/participante segue conflitante entre UX e backend | `frontend.md` §18; `backend.md` §11.17; [2] [6] |
| F-19 | Confirmado como premissa não comprovada | **BLOCKER** | A ponte DHT→ICE precisa de PoC por socket/processo; nenhum foi executado | ADR-06; [2] [5] |
| F-20 | Confirmado | **BLOCKER** | UDX não fornece o protocolo de voz necessário; não existe contrato alternativo | ADR-05/07; [2] [5] |
| F-21 | Confirmado | **BLOCKER** | A lista de convites não pode exibir códigos criados por terceiros com o estado local atual | `backend.md` §§4.11, 10.4; [2] [6] |
| F-22 | Confirmado como decisão condicional; evidência experimental ausente | **BLOCKER** | O spike é requisito de entrada e não tem resultado, matriz de artefatos ou critério executado | ADR-03/04; `backend.md` §23; [2] [4] [5] |
| F-23 | Confirmado | **REQUIRES DECISION** | O número normativo de `kind`s precisa ser fechado antes do codec e dos testes | `backend.md` §§5.3, 23; [2] [4] |
| F-24 | Confirmado | **REQUIRES DECISION** | `community.leave` e `member.leave` continuam sem mapeamento inequívoco | `backend.md` §§5.3, 10.2; [2] [6] |
| F-25 | Confirmado | **REQUIRES DECISION** | Não-lidas não têm modelo único entre coluna materializada, query e reprojeção | `backend.md` §§6.3–6.4, 19.4; [2] [6] |
| F-26 | Confirmado | **BLOCKER** | A regra de `mention_everyone` não possui ponto seguro de enforcement sem alterar assinatura/reducer | `backend.md` §§3.2, 5.3, 8.3; [2] [7] |
| F-27 | Confirmado | **REQUIRES DECISION** | Limites declarados sem enforcement não são contrato operacional | `backend.md` §§9.3, 19.2; [2] |
| F-28 | Confirmado | **REQUIRES DECISION** | O catálogo de erros precisa ser fonte única, inclusive para retry e UX | `backend.md` §16.2; [2] [3] |
| F-29 | Confirmado | **REQUIRES DECISION** | `E_TIMED_OUT`, backoff e idade máxima continuam incompatíveis | `backend.md` §§13.3, 16.3; [2] [3] |
| F-30 | Confirmado | **REQUIRES DECISION** | A semântica de lote da outbox ainda depende de escolha não registrada | `backend.md` §§11.3, 12.3; [2] [3] |
| F-31 | Confirmado | **REQUIRES DECISION** | Tombstones de cargo e referências de canal não têm regra de limpeza/invariante completa | `backend.md` §§4.18, 5.3; [2] |
| F-32 | Confirmado | **REQUIRES DECISION** | `handle` do mock, UX e backend continuam incompatíveis | `frontend.md` §2; `backend.md` §4.2; [2] [6] |
| F-33 | Confirmado | **REQUIRES DECISION** | A âncora temporal exibida pela UX não foi alinhada ao `hostTs`/`authorTs` | `frontend.md` §5.10; `backend.md` §4.7; [2] [6] |
| F-34 | Confirmado | **REQUIRES DECISION** | Sem eventos de convite/auditoria, a atualização em tempo real depende de reconsulta não definida | `backend.md` §§10.3, 17.2; [2] [6] |
| F-35 | Confirmado | **BLOCKER** | Kick/ban não têm ciclo de vida, revogação de leitura ou comportamento do cliente-alvo | `backend.md` §§14.3, 18.1; [2] [7] |
| F-36 | Confirmado | **BLOCKER** | A correção depende de nonce por comunidade ou mudança do ID; nenhuma foi congelada | `backend.md` §§4.7, 5.3, 11.3; [2] [4] |
| F-37 | Confirmado | **REQUIRES DECISION** | Consentimento tardio e reparo de árvore continuam sem política completa | `backend.md` §11.17; [2] [6] |
| F-38 | Confirmado | **BLOCKER** | A regra anti-escalada permite vetor pelo cargo base, que é aplicado automaticamente | `backend.md` §8.3; [2] [7] |
| F-39 | Confirmado | **BLOCKER** | Renumeração em índice UNIQUE pode lançar reducer e produzir registro venenoso | `backend.md` §§4.18, 6.4; [2] [3] |
| F-40 | Confirmado | **BLOCKER** | A invariante de sequência não é compatível com pular registros sem política formal | `backend.md` §§5.2, 6.4; [2] |
| F-41 | Confirmado como lacuna de integridade; PoC ausente | **BLOCKER** | Hash de anexo sem ownership e verificação do conteúdo não protege a projeção | `backend.md` §§11.13–11.14; [2] [5] |
| F-42 | Confirmado como hipótese de capacidade | **REQUIRES POC** | Nenhum benchmark de 200 viewers, latência e relay foi executado | `frontend.md` §2; `backend.md` §19; [2] [5] |
| F-43 | Confirmado | **REQUIRES DECISION** | Não há barreira de replicação antes de desligamento nem tipo normativo de mensagem de sistema | `backend.md` §§6.6, 11.20; [2] [6] |
| F-44 | Confirmado | **REQUIRES DECISION** | Falta correlação estável entre ACK e item de outbox | `backend.md` §§10.1, 11.3; [2] |
| F-45 | Confirmado como hipótese de escala | **REQUIRES POC** | Os alvos de cinco comunidades não validam o limite de 50 | `backend.md` §19; [2] [5] |
| F-46 | Confirmado como inconsistência documental menor | **ACCEPTED RISK** | Não há impacto arquitetural; corrigir referências é desejável, mas sua ausência não impede a implementação | `auditoria-adversarial.md` §verificação de referências; [2] |
| F-47 | Confirmado como estado alcançável sem regra | **REQUIRES DECISION** | O comportamento de reply para conteúdo tombstonado não foi definido | `backend.md` §§4.7, 10.4; `frontend.md` §2.1; [2] |
| F-48 | Confirmado | **REQUIRES DECISION** | `pending_mentions` depende de cargos que mudam sem recálculo definido | `backend.md` §§4.15, 6.3; [2] |
| F-49 | Confirmado | **BLOCKER** | Relay voluntário não tem TTL, cota, autorização ou prova de posse; POC de relay não foi executado | ADR-08; `backend.md` §4.14; [2] [5] [7] |
| F-50 | Confirmado | **BLOCKER** | `identity.wipe` pode falhar ao apagar lock/WAL/cores e não possui estado de falha parcial | `backend.md` §§2.3, 6.1, 10.2, 11.22; [2] [4] |

### Findings DS-01 a DS-31 — sistemas distribuídos e confiabilidade

| ID | Situação | Classificação | Correção e efeito introduzido | Evidência/localização resumida |
|---|---|---|---|---|
| DS-01 | Confirmado | **BLOCKER** | Serializar apenas o append não resolve validação contra projeção atrasada; exige estado autoritativo e PoC | `backend.md` §§6.4, 9.3, 12.1; [3] [5] |
| DS-02 | Confirmado | **BLOCKER** | ACK antes de `flush` e remoção da outbox no ACK continuam sem barreira de durabilidade | `backend.md` §§2.3, 11.3; [3] [5] |
| DS-03 | Confirmado | **BLOCKER** | Nenhuma ordem/reconciliação append↔dedupe foi especificada | `backend.md` §§5.5, 6.6, 9.1; [3] [5] |
| DS-04 | Confirmado | **BLOCKER** | `NORMAL` segue aplicado a dados que carregam entrega e idempotência; nenhum power-loss test foi executado | `backend.md` §6.4; [3] [5] |
| DS-05 | Confirmado | **BLOCKER** | `maxUses` continua dependente de projeção/read-your-writes não garantidos | `backend.md` §11.4; [3] [5] |
| DS-06 | Confirmado | **BLOCKER** | Não há reconciliação outbox↔projeção em boot, ACK perdido ou expiração | `backend.md` §§10.4, 11.3; [3] [5] |
| DS-07 | Confirmado | **REQUIRES DECISION** | Retry pós-restart ainda pode ser descartado com motivo errado; falta política de reconciliação | `backend.md` §§13.3, 16.3; [3] |
| DS-08 | Confirmado | **REQUIRES DECISION** | O mecanismo de ban torna o estado de ban inalcançável ao cliente | `backend.md` §§14.3, 18.1; [3] |
| DS-09 | Confirmado | **REQUIRES DECISION** | Dedupe antes de rate limit preserva custo alto para replay; falta admissão pré-autenticação | `backend.md` §9.1; [3] [7] |
| DS-10 | Confirmado | **REQUIRES DECISION** | Flush pós-reconexão e filas sem profundidade/shedding continuam sem comportamento | `backend.md` §§12.3, 13.3; [3] |
| DS-11 | Confirmado | **BLOCKER** | Buraco de replicação pode congelar projeção indefinidamente sem estado observável | `backend.md` §§6.4, 13.2; [3] [6] |
| DS-12 | Confirmado | **BLOCKER** | `reaction.toggle` depende da deduplicação que falha após crash | `backend.md` §§4.10, 5.5; [3] |
| DS-13 | Confirmado | **REQUIRES DECISION** | `hostTs` e `flags` fora da assinatura permitem linha do tempo não auditável | `backend.md` §5.1; [3] [7] |
| DS-14 | Confirmado | **BLOCKER** | `share.assignment` sem ACK/retry produz subárvore silenciosamente indisponível | `backend.md` §11.17; [3] [6] |
| DS-15 | Confirmado | **REQUIRES DECISION** | Falta distinguir partição parcial de morte antes de reatribuir pais | `backend.md` §§11.17, 13.4; [3] |
| DS-16 | Confirmado | **BLOCKER** | Retry manual com novo `opId` escapa do ADR-12 e pode duplicar efeitos | `backend.md` §§10.2, 11.3; [3] |
| DS-17 | Confirmado | **REQUIRES DECISION** | Catch-up→reativo não tem barreira nem watchdog de cabeça do core | `backend.md` §6.4; [3] |
| DS-18 | Confirmado | **REQUIRES DECISION** | Cache invalidado apenas por evento pode ficar obsoleto após crash | `backend.md` §10.1, §19.4; [3] |
| DS-19 | Confirmado | **BLOCKER** | A reprojeção depende de metadados que apaga e reproduz falhas que deveria curar | `backend.md` §6.4; [3] |
| DS-20 | Confirmado | **REQUIRES DECISION** | Dedupe global sem `community_id`, teto ou limpeza mistura comunidades | `backend.md` §§5.5, 6.3; [3] [7] |
| DS-21 | Confirmado | **REQUIRES DECISION** | Ordenação por relógio de parede não define ordem monotônica local | `backend.md` §11.3; [3] |
| DS-22 | Confirmado | **REQUIRES DECISION** | `blob.stage` não tem resume, remoção ou idempotência de staging | `backend.md` §11.13; [3] |
| DS-23 | Confirmado | **REQUIRES POC** | Conflito de rate limit e lote precisa de carga concorrente; nenhum benchmark foi executado | `backend.md` §§9.3, 12.3; [3] [5] |
| DS-24 | Confirmado | **REQUIRES DECISION** | Circuit breaker pode consumir tentativas sem tentativa real; transições não estão escritas | `backend.md` §13.3; [3] |
| DS-25 | Confirmado | **REQUIRES DECISION** | Cliente incompatível não tem classificação de outbox definida | `backend.md` §§10.2, 16.3; [3] |
| DS-26 | Confirmado | **REQUIRES DECISION** | `submitOps` para no primeiro erro sem estado para itens não tentados | `backend.md` §§11.3, 12.3; [3] |
| DS-27 | Confirmado | **REQUIRES DECISION** | Não há barreira entre existência de blob e entrega da mensagem | `backend.md` §6.6; [3] |
| DS-28 | Confirmado | **REQUIRES DECISION** | Cancelamento durante `sending` não tem semântica segura | `backend.md` §10.2; [3] |
| DS-29 | Confirmado | **REQUIRES DECISION** | Relógio do host pode tornar toda escrita inválida sem diagnóstico | `backend.md` §9.1; [3] |
| DS-30 | Confirmado como semântica efêmera aceitável | **ACCEPTED RISK** | Perda at-most-once é aceitável para presença/typing com TTL; deve ser explicitada, mas não é defeito de durabilidade | `backend.md` §10.7; [3] |
| DS-31 | Confirmado | **REQUIRES DECISION** | ACK e `messages.appended` podem chegar em ordens opostas; a fonte autoritativa não está declarada | `backend.md` §§10.3, 11.3; [3] [6] |

### Findings DR-01 a DR-51 — implementation dry run

| ID | Situação | Classificação | Correção e efeito introduzido | Evidência/localização resumida |
|---|---|---|---|---|
| DR-01 | Confirmado | **BLOCKER** | Fase 0 não fecha sem definição de pronto e regra binária de decisão | `backend.md` §23; [4] [5] |
| DR-02 | Confirmado | **BLOCKER** | Migração web→Electron contradiz “sem tocar componente”; build e empacotamento não têm contrato | `backend.md` §§0.1, 23; `frontend.md` premissa 1; [4] |
| DR-03 | Confirmado | **BLOCKER** | Canal main↔núcleo e trânsito da chave privada são incompatíveis com §7 | `backend.md` §§2.1–2.2, 7, 10; [4] [7] |
| DR-04 | Confirmado | **REQUIRES DECISION** | Deep link com app aberto exige regra distinta do lock do núcleo | `backend.md` §2.3; `frontend.md` §4; [4] |
| DR-05 | Confirmado | **BLOCKER** | `sub/unsub/ev` não define filtro, identidade da assinatura ou correlação | `backend.md` §10.1; [4] |
| DR-06 | Confirmado | **BLOCKER** | High-water de `MessagePort` não tem mecanismo de ack/dreno | `backend.md` §10.1; [4] |
| DR-07 | Confirmado | **BLOCKER** | Crash do núcleo não define novo canal, requests em voo ou resubscribe | `backend.md` §§2.2–2.3, 10.1; [4] |
| DR-08 | Confirmado | **REQUIRES DECISION** | `core.status` e `phase` têm formas contraditórias | `backend.md` §10.3; [4] |
| DR-09 | Confirmado | **REQUIRES DECISION** | Derivação do `handle` não fecha base, truncamento e unicidade | `backend.md` §4.2; [4] [6] |
| DR-10 | Confirmado | **BLOCKER** | Sem registry de encoding, `opCodec` não pode ser escrito sem inventar bytes permanentes | `backend.md` §5.2–5.3; [4] |
| DR-11 | Confirmado | **BLOCKER** | IDs de entidade não têm origem determinística nem campo de payload definido | `backend.md` §§4.4, 5.3; [4] |
| DR-12 | Confirmado | **BLOCKER** | Fundador e cargo base não são distinguíveis no bootstrap | `backend.md` §11.1; [4] |
| DR-13 | Confirmado | **BLOCKER** | Reducer não recebe metadados exigidos por seus efeitos | `backend.md` §§3.2, 6.4; [4] |
| DR-14 | Confirmado | **BLOCKER** | `validator.validate(op, state)` não define tipo nem origem de `state` | `backend.md` §§3.2, 9.1; [4] [3] |
| DR-15 | Confirmado | **REQUIRES DECISION** | Não se sabe quais estágios o cliente executa antes da outbox | `backend.md` §9.1; [4] |
| DR-16 | Confirmado | **REQUIRES DECISION** | Atualização do FTS externo não tem ordem nem rollback | `backend.md` §§6.3–6.4; [4] |
| DR-17 | Confirmado | **REQUIRES DECISION** | Tombstone e `content NOT NULL` são incompatíveis sem regra explícita | `backend.md` §§4.7, 6.3; [4] |
| DR-18 | Confirmado | **REQUIRES DECISION** | O caminho de escrita das próprias ops do host não existe como contrato | `backend.md` §§9.1, 11.3; [4] |
| DR-19 | Confirmado | **BLOCKER** | Há janela de mensagem aceita sem outbox nem projeção; falta critério de autoridade | `backend.md` §11.3; [4] [3] |
| DR-20 | Confirmado | **REQUIRES DECISION** | Tabelas locais não reconstruíveis não têm política de migração | `backend.md` §§5.4, 6.4; [4] |
| DR-21 | Confirmado | **BLOCKER** | Reprojeção apaga a enumeração de comunidades de que depende | `backend.md` §§6.3–6.4; [4] [2] |
| DR-22 | Confirmado | **BLOCKER** | `sending` não tem reconciliação após crash | `backend.md` §11.3; [4] [3] |
| DR-23 | Confirmado | **REQUIRES DECISION** | O conjunto de `kind`s aceitos pela outbox é contraditório | `backend.md` §§10.2, 11.3; [4] |
| DR-24 | Confirmado | **BLOCKER** | Máquina de estados da outbox não tem transições executáveis | `backend.md` §§10.2, 11.3; [4] |
| DR-25 | Confirmado | **REQUIRES DECISION** | Queries e `view_audit_log` não têm enforcement de leitura definido | `backend.md` §§8.1, 10.4; [4] [7] |
| DR-26 | Confirmado | **REQUIRES DECISION** | `manage_community` e `create_invite` divergem quanto à permissão | `backend.md` §§8.1, 10.2; [4] |
| DR-27 | Confirmado | **BLOCKER** | O formato do delta agregado do projetor é inexistente | `backend.md` §§3.2, 6.4; [4] |
| DR-28 | Confirmado | **BLOCKER** | Nenhum módulo pode montar estado de validação sem violar a arquitetura declarada | `backend.md` §§3.1–3.2, 9.1; [4] [3] |
| DR-29 | Confirmado | **REQUIRES DECISION** | `hostStatus` inicial e ausência versus offline não têm enum/semântica | `backend.md` §§10.3, 13.2; [4] |
| DR-30 | Confirmado | **BLOCKER** | Membro banido continua recebendo replicação entre membros sem firewall definido | `backend.md` §§6.2, 14.3; [4] [7] |
| DR-31 | Confirmado | **REQUIRES DECISION** | “Por IP de peer” não é chave suficiente para rate limit do convite | `backend.md` §9.3; [4] |
| DR-32 | Confirmado | **REQUIRES DECISION** | Dono de `recent_channels`/`active_channel_id` é duplo | `backend.md` §6.3; [4] |
| DR-33 | Confirmado | **REQUIRES DECISION** | Enum de `hostStatus` não existe | `backend.md` §10.3; [4] |
| DR-34 | Confirmado | **REQUIRES DECISION** | Parsing de código e link não é normativo | `frontend.md` §4; [4] |
| DR-35 | Confirmado | **BLOCKER** | Ciclo de vida de dados do expulso/banido não é definido | `backend.md` §§14.3, 18.1; [4] [7] |
| DR-36 | Confirmado | **REQUIRES DECISION** | Host encerra swarm antes de garantir replicação da operação final | `backend.md` §11.21; [4] |
| DR-37 | Confirmado | **BLOCKER** | `blob.stage(path)` não consegue provar origem em diálogo do SO | `backend.md` §11.13; [4] [7] |
| DR-38 | Confirmado | **REQUIRES DECISION** | `query.links` não tem fonte, extração ou ordenação | `backend.md` §10.4; [4] [6] |
| DR-39 | Confirmado | **REQUIRES DECISION** | Sintaxe FTS5 e combinação de tokens não estão fechadas | `backend.md` §§10.4, 19.4; [4] |
| DR-40 | Confirmado | **REQUIRES DECISION** | Cache de blobs não possui enum ou retomada após crash | `backend.md` §§6.3, 11.13; [4] |
| DR-41 | Confirmado | **REQUIRES DECISION** | Mapa extensão→`kind` pode ser inventado de modo incompatível com UX/segurança | `backend.md` §4.13; [4] |
| DR-42 | Confirmado | **REQUIRES DECISION** | `speaking` não tem fonte no roster ou evento | `backend.md` §§10.3, 10.7; [4] [6] |
| DR-43 | Confirmado | **BLOCKER** | A árvore não define handshake de aresta, ordem de conexão ou comportamento de filho órfão | `backend.md` §11.17; [4] [5] |
| DR-44 | Confirmado | **REQUIRES DECISION** | `uplinkKbps` não tem regra para nó novo e não foi medido | `backend.md` §11.17; [4] [7] |
| DR-45 | Confirmado | **REQUIRES DECISION** | Mudo, ensurdecer e volume por participante divergem entre UX e backend | `frontend.md` §9; `backend.md` §§10.7, 11.16; [4] [6] |
| DR-46 | Confirmado | **BLOCKER** | Nenhuma das 17 queries tem schema; a leitura não pode ser implementada de forma rastreável | `backend.md` §10.4; [4] [6] |
| DR-47 | Confirmado | **REQUIRES DECISION** | “Quem reagiu” não tem contrato de leitura | `frontend.md` §2.1; `backend.md` §10.4; [4] [6] |
| DR-48 | Confirmado | **REQUIRES DECISION** | Não-lidas de thread não têm persistência/query | `frontend.md` §2.1; `backend.md` §6.3; [4] [6] |
| DR-49 | Confirmado | **REQUIRES DECISION** | Rótulo de autor no log não tem snapshot/regra de leitura | `backend.md` §17.2; [4] |
| DR-50 | Confirmado | **REQUIRES DECISION** | Fixtures de `dev.seedDataset` não têm identidade real compatível | `backend.md` §10.2; [4] |
| DR-51 | Confirmado | **REQUIRES DECISION** | Constantes normativas fora de §20 não têm comportamento para valor inválido | `backend.md` §20; [4] |

### Findings T-01 a T-48 — threat model de segurança

| ID | Situação | Classificação | Correção e efeito introduzido | Evidência/localização resumida |
|---|---|---|---|---|
| T-01 | Confirmado | **BLOCKER** | Falta vincular a assinatura a `communityId`/core; verificar assinatura não impede transplante | `backend.md` §5.1; [7] |
| T-02 | Confirmado | **BLOCKER** | Réplicas só verificam assinatura; autorização e associação não são revalidadas | `backend.md` §§6.4, 9.1; [7] |
| T-03 | Confirmado | **BLOCKER** | A chave de escrita do core permanece fora da proteção atribuída à identidade | `backend.md` §§6.1, 7; [7] |
| T-04 | Confirmado como risco de capability; decisão de produto ausente | **REQUIRES DECISION** | CoreKey como descoberta/capability/leitura perpétua exige limitação explícita ou redesenho | `backend.md` §§4.2, 6.2; [7] |
| T-05 | Confirmado | **BLOCKER** | Replay após janela de dedupe pode produzir colisão de PK permanente | `backend.md` §§4.7, 5.5; [7] [3] |
| T-06 | Confirmado | **BLOCKER** | Prova de convite não vinculada a host/candidato permite retransmissão no tópico | `backend.md` §11.4; [7] |
| T-07 | Confirmado | **REQUIRES DECISION** | Sybil e evasão de ban são consequências não aceitas nem limitadas | `backend.md` §§4.11, 19.3; [7] |
| T-08 | Confirmado | **BLOCKER** | Custo caro antes de rate limit e teto global de conexões permitem DoS de peer não autenticado | `backend.md` §9.1, §19.2; [7] |
| T-09 | Confirmado | **BLOCKER** | Rate limit de ops não é cota de bytes permanentes; falta controle de armazenamento | `backend.md` §§9.3, 19.2; [7] |
| T-10 | Confirmado como risco dependente de plataforma | **REQUIRES POC** | `safeStorage` e proteção contra processo do mesmo usuário não foram testados nos alvos | ADR-19; [5] [7] |
| T-11 | Confirmado | **BLOCKER** | Relay de tela recebe conteúdo decodificável e não autenticado segundo o contrato atual | ADR-08; `backend.md` §10.8; [5] [7] |
| T-12 | Confirmado como risco de integração | **REQUIRES POC** | Fuzzing/codec no renderer não foi executado; sandbox isolada não prova estabilidade do decoder | `backend.md` §§10.8, 18.5; [5] [7] |
| T-13 | Confirmado | **REQUIRES DECISION** | `canRelay`/`uplinkKbps` auto-declarados não podem decidir topologia sem política de confiança | `backend.md` §11.17; [7] |
| T-14 | Confirmado | **BLOCKER** | `relayKey` não exige prova de posse; redirecionamento para terceiro permanece possível | `backend.md` §9.3; [7] |
| T-15 | Confirmado | **BLOCKER** | Sinalização peer-to-peer não tem autorização de roster | `backend.md` §§10.7, 11.16; [7] |
| T-16 | Confirmado | **BLOCKER** | Renderer comprometido pode fornecer caminho arbitrário a `blob.stage` | `backend.md` §11.13; [7] [4] |
| T-17 | Confirmado | **BLOCKER** | Anexo é entregue ao handler do SO sem allowlist/quarentena suficiente | `backend.md` §11.14; [7] |
| T-18 | Confirmado | **BLOCKER** | Markdown não tem allowlist de esquema de URL | `frontend.md` §2.1; [7] [6] |
| T-19 | Confirmado | **BLOCKER** | Gate `NODE_ENV` falha aberto para `dev.*` | `backend.md` §§10.2, 18.5; [7] |
| T-20 | Confirmado | **BLOCKER** | IPC onipotente contradiz renderer não confiável; `identity.wipe` não exige main confirmation | `backend.md` §§10.1–10.2; [7] |
| T-21 | Confirmado | **BLOCKER** | Chave privada precisa cruzar main↔núcleo apesar de §7; cópias não têm ciclo formal | `backend.md` §§2.2, 7; [7] [4] |
| T-22 | Confirmado | **BLOCKER** | Configuração sem integridade permite eclipse e alteração de ambiente/caminhos | `backend.md` §§20, 22; [7] |
| T-23 | Confirmado | **REQUIRES DECISION** | Revogação do emissor não tem efeito sobre convite já emitido | `backend.md` §§4.11, 11.4; [7] |
| T-24 | Confirmado como exposição de metadados; aceitação não declarada | **REQUIRES DECISION** | `invisible` não entrega anonimato; isso precisa ser declarado ou reduzido | `backend.md` §§4.16, 22.1; [7] |
| T-25 | Confirmado | **BLOCKER** | Firewall único por processo atravessa comunidades e mistura ban/moderação | `backend.md` §§6.1, 14.3; [7] |
| T-26 | Confirmado | **REQUIRES DECISION** | Janela de carimbo retroativo e exibição de tempo precisam de regra de confiança | `backend.md` §§4.7, 9.1; [7] |
| T-27 | Confirmado | **BLOCKER** | `hostTs`/`flags` não assinados quebram auditabilidade e determinismo | `backend.md` §5.1; [7] [3] |
| T-28 | Confirmado como lacuna; impacto empírico inconclusivo | **REQUIRES POC** | Nenhum limite/fan-out agregado foi medido | `backend.md` §10.7; [5] [7] |
| T-29 | Confirmado | **REQUIRES DECISION** | `handle` curto e nomes livres não têm política contra personificação | `backend.md` §4.2; `frontend.md` §2; [7] [6] |
| T-30 | Confirmado | **BLOCKER** | IDs globais de 48 bits permitem colisão dirigida atravessando comunidades | `backend.md` §§4.4, 6.1; [7] |
| T-31 | Confirmado | **BLOCKER** | `mention_everyone` não tem enforcement replicável | `backend.md` §§5.3, 8.3; [7] |
| T-32 | Confirmado | **BLOCKER** | Ban/timeout não alcançam conexões diretas de voz/tela | `backend.md` §§10.7, 11.16; [7] |
| T-33 | Confirmado | **REQUIRES DECISION** | Host pode silenciar seletivamente via `retryAfterMs` sem defesa do cliente | `backend.md` §13.3; [7] |
| T-34 | Confirmado | **BLOCKER** | Não há teto antes do decode de request RPC | `backend.md` §§10.5–10.6; [7] |
| T-35 | Confirmado | **BLOCKER** | Cargo base continua fora da regra anti-escalada | `backend.md` §8.3; [7] |
| T-36 | Confirmado | **REQUIRES DECISION** | Conteúdo, `local_*` e chaves de core estão em claro; a spec não aceita nem qualifica a limitação | `backend.md` §6.1; [7] |
| T-37 | Confirmado | **REQUIRES DECISION** | Sanitizar por transformação pode esconder colisões/path traversal em Windows | `backend.md` §11.14; [7] |
| T-38 | Confirmado | **REQUIRES DECISION** | `hello` para não-membro expõe estado sem política de admissão | `backend.md` §§10.5, 11.2; [7] |
| T-39 | Confirmado | **REQUIRES DECISION** | Allowlist de log não cobre todo conteúdo gerado pelo usuário | `backend.md` §17.2; [7] |
| T-40 | Confirmado | **REQUIRES DECISION** | Moderação de voz é conselho sem enforcement entre pares | `backend.md` §10.7; [7] |
| T-41 | Confirmado | **BLOCKER** | Captura de tela pode começar antes de autorização do host/main | `backend.md` §§2.1, 11.16; [7] |
| T-42 | Confirmado | **REQUIRES DECISION** | Não há canal de atualização, integridade de build ou resposta a vulnerabilidade | `backend.md` §22.4; [7] |
| T-43 | Confirmado como limitação de produto não aceita | **REQUIRES DECISION** | Sem recuperação de identidade/sucessão de host, perda de máquina é perda permanente | `backend.md` §§4.2, 7; [7] |
| T-44 | Confirmado | **REQUIRES DECISION** | Queries não aplicam permissão; `view_audit_log` é cosmético em replicação integral | `backend.md` §§8.1–8.2, 10.4; [7] |
| T-45 | Confirmado | **REQUIRES DECISION** | Timeout avaliado pelo relógio do leitor pode divergir entre réplicas | `backend.md` §§4.7, 11.12; [7] |
| T-46 | Confirmado como risco de entrada não autenticada | **REQUIRES DECISION** | Deep link precisa ser restringido a rotas de dados e validado na instância viva | `frontend.md` §4; `backend.md` §23; [7] [4] |
| T-47 | Confirmado, impacto baixo | **ACCEPTED RISK** | Alarme sem pontuação de peer é limitação operacional de baixa severidade; não é defesa efetiva | `backend.md` §17.3; [7] |
| T-48 | Confirmado como risco de decoder | **REQUIRES POC** | Teste de fuzzing e política de tipos não foram executados | `backend.md` §§4.13, 11.14; [5] [7] |

### Findings RT-01 a RT-15 — rastreabilidade UX ↔ backend

| ID | Situação | Classificação | Correção e efeito introduzido | Evidência/localização resumida |
|---|---|---|---|---|
| RT-01 | Confirmado | **BLOCKER** | Seis desfechos de backend e quatro de UX não formam contrato único de preview | `rastreabilidade-ux-backend.md` §2.2; [6] |
| RT-02 | Confirmado | **REQUIRES DECISION** | Preferências têm escrita sem query de leitura; não há estado após reabertura | [6] §2.3 e §5 |
| RT-03 | Confirmado | **REQUIRES DECISION** | `markRead` não define se menções são zeradas nem retorna contador completo | [6] §2.4 |
| RT-04 | Confirmado | **REQUIRES DECISION** | `/m/:code` não tem geração nem resolução no backend | [6] §2.4 |
| RT-05 | Confirmado | **REQUIRES DECISION** | Participantes inline de voz não têm fonte para quem não está na sessão | [6] §2.4 |
| RT-06 | Confirmado | **BLOCKER** | UX exige múltiplos compartilhamentos, backend fixa 0..1 e mock não implementa | [6] §3.2 |
| RT-07 | Confirmado | **REQUIRES DECISION** | Enum de auditoria e tipo de operação auditável têm formas divergentes | [6] §3.3 |
| RT-08 | Confirmado | **REQUIRES DECISION** | Escopo do painel de saúde da árvore diverge entre UX e protocolo | [6] §3.2 |
| RT-09 | Confirmado | **REQUIRES DECISION** | Medidor de microfone é apenas animação local, sem comando/evento real | [6] §5 |
| RT-10 | Confirmado | **REQUIRES DECISION** | Erro de permissão de câmera do SO não tem código ou caminho de UI | [6] §5 |
| RT-11 | Confirmado | **REQUIRES DECISION** | `partial` cobre apenas host offline, não réplica atrasada | [6] §5 |
| RT-12 | Confirmado | **REQUIRES DECISION** | Limites de convite do backend não estão refletidos no formulário | [6] §4.3 |
| RT-13 | Confirmado | **REQUIRES DECISION** | “Mensagem de sistema” não existe no modelo de domínio | [6] §4.3 |
| RT-14 | Confirmado | **REQUIRES DECISION** | Fixtures de handle, convite, espectador/participante e timestamp não são produzíveis pelo backend | [6] §4.3 |
| RT-15 | Confirmado | **REQUIRES DECISION** | Nomes de injeção de falha divergem entre apêndice e mock | [6] §4.3 |

## Avaliação das ADRs e da verificação de APIs

A existência das APIs dos pacotes não valida a propriedade sistêmica pretendida. A auditoria de ADRs encontrou: ADR-02 contradita; a justificativa de ABI universal de ADR-03 contradita; ADR-06, ADR-07 e ADR-08 contraditas ou sem capacidade necessária; e ADR-03/04/20 condicionais ao artefato final e aos crashes [5]. A integração Electron/Node, `safeStorage`, WebRTC/Encoded Transform, Corestore, SQLite/WAL e Hyperswarm continua dependendo de versão travada, empacotamento, configuração, plataforma e teste real [5].

| Decisão | Classificação consolidada | Motivo da não aprovação |
|---|---|---|
| ADR-01 — host como autoridade | **BLOCKER / REQUIRES POC** | Writer único dá ordem, mas não serializa estado de validação, append e projeção |
| ADR-02 — SQLite como view descartável | **BLOCKER** | Participação, namespaces e `blobsKey` não são reconstruíveis como escrito |
| ADR-03/04 — driver nativo e utility process | **REQUIRES POC** | ABI, artefato final, crash/restart e plano Bare não foram exercitados |
| ADR-05 — mídia híbrida | **BLOCKER / REQUIRES POC** | Fallback e forwarding opaco não têm caminho seguro e executável |
| ADR-06/07 — DHT→ICE e UDX para voz | **BLOCKER / REQUIRES POC** | A equivalência por socket e a pilha de mídia não estão demonstradas |
| ADR-08 — relay voluntário blind | **BLOCKER / REQUIRES POC** | UDX não cifra por si e relay de tela recebe conteúdo protegido de forma insuficiente |
| ADR-09 — convite | **BLOCKER** | Entropia é adequada, mas protocolo delegado e consumo atômico não funcionam como escrito |
| ADR-10 — tombstone | **ACCEPTED RISK** | Semântica é coerente com append-only; a UX deve aceitar retenção do log |
| ADR-11/12 — outbox e dedupe | **BLOCKER** | Durabilidade, ACK, crash e dedupe não têm transação/reconciliação suficiente |
| ADR-13 — FTS5 | **REQUIRES POC** | Semântica é plausível, mas latência e filtros não foram medidos |
| ADR-14 — presença/typing efêmeros | **REQUIRES POC** | Semântica pode permanecer, custo de fan-out é desconhecido |
| ADR-15 — não-lidas locais | **ACCEPTED RISK** | Escopo local é coerente; detalhes de watermark ainda requerem teste |
| ADR-16 — replicação em background | **REQUIRES POC** | Teto de conexões, starvation e startup não foram medidos |
| ADR-17 — árvore calculada pelo host | **BLOCKER / REQUIRES POC** | Audiência, handshakes, reparo, qualidade e custo não estão fechados |
| ADR-18 — sem push fechado | **ACCEPTED RISK** | Fora de escopo explícito, sem dependência de runtime emergente |
| ADR-19 — `safeStorage` | **REQUIRES POC** | Proteção é condicional à plataforma e à fronteira main↔núcleo |
| ADR-20 — núcleo único/lock | **REQUIRES POC** | Deep link, crash, wipe e lock composto não foram exercitados |

## Blockers que impedem a aprovação

Os itens abaixo são os blockers objetivos. Eles estão agrupados por causa-raiz apenas quando compartilham a mesma condição de remoção; todos os IDs listados permanecem classificados como `BLOCKER` na matriz acima.

### B1 — Estado autoritativo, validação e projeção não são serializáveis

**Findings:** F-04, F-05, F-07, F-39, F-40, DS-01, DS-11, DS-12, DS-19, DR-13, DR-14, DR-28.

**Evidência:** o host valida contra projeção assíncrona e em lote; reducers podem lançar `E_INVARIANT`; dedupe e append não têm atomicidade comum; reprojeção é o remédio para falhas que ela mesma reproduz [2] [3] [4].

**Localização:** `backend.md` §§5.2, 5.5, 6.4, 6.6, 9.1, 9.3, 12.1–12.4; `auditoria-sistemas-distribuidos.md` DS-01–DS-04, DS-11–DS-19.

**Por que impede implementação:** uma corrida legítima ou retry após crash pode inserir registro permanente que quebra toda réplica, ou confirmar uma operação inexistente. O log append-only torna o defeito não corrigível por migração comum.

**Condição objetiva para remoção:** publicar a fonte autoritativa usada na validação, garantir rejeição antes do append para todos os oito pares de conflito, definir dedupe derivado/reconciliável pelo log, definir tratamento de poison record e passar G1, além da crash matrix de G4, com zero `projector.failed`, zero operação incompatível no log e convergência idêntica.

### B2 — Reprojeção não reconstrói participação, namespaces e blobs

**Findings:** F-01, DR-20, DR-21, DS-19; ADR-02.

**Evidência:** `blobsKey` e a enumeração de comunidades aparecem apenas na projeção/estado local; `corestore.namespace(random)` não é recuperável; a própria reprojeção apaga os dados necessários [2] [5].

**Localização:** `backend.md` §§6.1, 6.3–6.4, 11.1, 11.4; `Auditoria-Experimental-de-Decisões-Arquiteturais.md` POC-02/G2.

**Por que impede implementação:** um schema bump ou perda de `view.db` pode retirar permanentemente comunidades e anexos de uma instalação existente, contrariando ADR-02 e a promessa de recuperação.

**Condição objetiva para remoção:** executar POC-02 com apagar/recriar o SQLite, namespaces aleatórios, host offline, convite perdido, crash e blobs; recuperar 100% das comunidades, chaves, blobs e dump projetado, sem namespace novo, dentro do limite de boot definido. Caso contrário, a spec deve deixar de chamar SQLite de totalmente descartável e declarar o manifesto local autoritativo.

### B3 — Porta de entrada por convite não tem protocolo executável

**Findings:** F-02, F-06, F-09, F-10, F-21, DS-05, RT-01; ADR-09.

**Evidência:** o host não possui o segredo de convite criado por outro membro; `member.join` não tem autoria/payload compatíveis; o candidato não conhece o `coreKey` antes do resgate; `maxUses` lê estado potencialmente atrasado; a UX exige desfechos que o firewall torna inalcançáveis [2] [3] [6].

**Localização:** `backend.md` §§4.11, 5.3, 9.1, 10.5–10.6, 11.4, 14.3; `frontend.md` §§0.3, 3.1b; `rastreabilidade-ux-backend.md` C-1–C-7.

**Por que impede implementação:** convite é a única porta de entrada do produto. Implementar agora exige inventar capability, transporte pré-membro, autoria do join, atomicidade de uso e semântica de ban.

**Condição objetiva para remoção:** publicar protocolo completo e passar o POC de convite delegado: 100% de convites criados por não-host resgatados legitimamente, exatamente um ingresso para `maxUses=1` sob dez resgates concorrentes, replay recusado, e todos os seis desfechos mapeados para UI alcançável.

### B4 — Caminho de escrita e segurança de anexos não existe

**Findings:** F-03, F-41, DR-37, DS-22, T-16, T-17, T-48; ADR-08/POC-06.

**Evidência:** o core de blobs tem escritor único do host, mas `blob.stage` é descrito como escrita local do membro; não há handoff, prova de origem do caminho, resume, ownership, quota ou validação end-to-end do hash [2] [4] [7].

**Localização:** `backend.md` §§6.2, 10.2, 11.13–11.14, 14.1; `Auditoria-Experimental-de-Decisões-Arquiteturais.md` POC-06/G5.

**Por que impede implementação:** qualquer escolha atual é ou criptograficamente impossível, ou monopoliza o host com upload de até 8 GiB, ou permite exfiltração do filesystem. A fase de anexos não tem contrato executável.

**Condição objetiva para remoção:** escolher e publicar ownership, transporte, anúncio, seeding, resume, cancelamento, quota e verificação de hash; provar caminho de arquivo originado pelo diálogo do SO; executar POC-06 nos tamanhos de 1 MiB, 1 GiB e 8 GiB com perda/restart, hash 100% correto e controle p95 dentro do orçamento.

### B5 — Durabilidade da outbox e idempotência não são garantidas

**Findings:** F-16, F-36, DS-02, DS-03, DS-04, DS-06, DS-16, DR-19, DR-22, DR-24; ADR-11/12.

**Evidência:** ACK pode preceder flush; outbox pode ser liberada no ACK; append e dedupe estão em stores sem transação comum; `NORMAL` não sustenta power-loss; retry manual pode gerar novo `opId` [2] [3] [4] [5].

**Localização:** `backend.md` §§2.3, 5.5, 6.4, 6.6, 10.2, 11.3, 12.2; auditoria distribuída DS-02–DS-07, DS-16.

**Por que impede implementação:** produz perda confirmada, mensagem fantasma ou duplicata determinística. Isso viola diretamente a premissa de fila durável da UX.

**Condição objetiva para remoção:** especificar barreira de durabilidade/group commit, critério de liberação ao observar a própria réplica, reconstrução/reconciliação do dedupe e máquina de estados completa; passar G4 com kill antes/depois do append, ACK perdido, crash entre append e dedupe, `FULL/NORMAL` documentados e exatamente dois estados permitidos: entregue ou pendente reconciliável.

### B6 — Runtime, IPC e fronteira da chave privada não têm contrato executável

**Findings:** F-22, DR-01, DR-02, DR-03, DR-05, DR-06, DR-07, T-19, T-20, T-21; ADR-03/04/19/20.

**Evidência:** falta critério de aceite do spike; Electron/Node nativos não têm matriz final; main↔núcleo é contraditório quanto à chave; assinatura de eventos, backpressure e reconexão pós-crash não estão definidos; IPC concede comandos destrutivos a renderer não confiável [4] [5] [7].

**Localização:** `backend.md` §§2.1–2.3, 7, 10.1–10.3, 18.5, 23; `dry-run-implementacao.md` DR-01–DR-07.

**Por que impede implementação:** a fundação do produto não compila como contrato: não se sabe como o renderer recupera o núcleo, como correlaciona assinaturas, quem pode executar `identity.wipe`, nem como a chave é protegida.

**Condição objetiva para remoção:** publicar protocolo main↔núcleo e renderer↔núcleo, autorização de comandos, handshake/ack/watermark/resubscribe, política para requests em voo, lifecycle de deep link e chave, e passar G0/G6/G10 em todos os alvos suportados. Nenhuma chave em claro indevida, nenhuma instância concorrente escrevendo e convergência após crash.

### B7 — Integridade de assinatura e isolamento entre comunidades estão quebrados

**Findings:** T-01, T-02, T-03, T-08, T-09, T-22, T-25, T-27, T-30, T-31, T-34, T-35.

**Evidência:** assinatura não inclui contexto da comunidade; réplicas não revalidam autorização; chave do core e conteúdo não têm proteção declarada; recursos globais misturam comunidades; não há limite de frame antes do decode; cargo base e `mention_everyone` permitem escalada [7].

**Localização:** `backend.md` §§5.1, 6.1, 6.3, 8.3, 9.1, 10.5–10.6, 18.1; `threat-model-seguranca.md` T-01–T-09, T-22, T-25, T-27, T-30–T-35.

**Por que impede implementação:** a propriedade de segurança central — que o host não pode fabricar efeitos atribuídos a membro e que comunidades são isoladas — não é verdadeira como escrita. O ataque pode deixar efeito permanente no log ou atravessar a fronteira de comunidade.

**Condição objetiva para remoção:** incluir contexto da comunidade no material assinado, definir validação/rejeição nas réplicas, separar/scopar IDs, dedupe, firewall e recursos por comunidade, aplicar limites antes do decode e fechar as regras de cargos/menções; passar ST-02, ST-03, ST-04, ST-13, ST-16, ST-40 e ST-41 sem efeito cruzado ou `projector.failed`.

### B8 — Mídia, relay e autorização de voz/tela permanecem contraditórios

**Findings:** F-08, F-19, F-20, F-37, F-42, F-49, DS-14, DR-43, T-11, T-12, T-14, T-15, T-32, T-41, RT-06; ADR-05/06/07/08/17.

**Evidência:** DHT não prova candidato ICE do renderer; UDX não fornece voz; relay não é confidencial por padrão; árvore não tem handshake/reparo/ACK suficientes; sinalização peer-to-peer e ban/timeout de voz não têm enforcement; UX e backend discordam sobre múltiplos compartilhamentos [2] [3] [4] [5] [6] [7].

**Localização:** `backend.md` ADR-05–08, §§10.7–10.8, 11.16–11.17; `frontend.md` §§2.3–2.4, 18; `rastreabilidade-ux-backend.md` V-11–V-20.

**Por que impede implementação:** são requisitos de produto de alta dependência e a arquitetura atual não define nem prova o caminho de conexão, segurança, audience model, reparo ou fallback. Implementar exigiria inventar protocolo de mídia e alterar compromissos de privacidade.

**Condição objetiva para remoção:** reabrir conjuntamente ADR-05/06/07/08/17, decidir escopo de estrela/árvore, participante/espectador, qualidade, fallback e autorização; passar G7/G8, POC-08 e POC-09, com métricas de NAT, latência, perda, CPU, reparo, autenticação e confidencialidade, ou retirar explicitamente as capacidades não aprovadas do v1.

### B9 — Contratos de leitura e UX↔backend não são rastreáveis

**Findings:** F-17, F-34, F-43, DR-27, DR-46, RT-01, RT-06; demais RT/DR classificados como decisão pendente.

**Evidência:** nenhuma das 17 queries tem schema; vários dados exibidos pela UX não são devolvidos; eventos sem reconsulta e estados de erro não têm destino; a matriz registra apenas 38 comportamentos completos [4] [6].

**Localização:** `backend.md` §§10.3–10.4, 16; `rastreabilidade-ux-backend.md` §§1–6.

**Por que impede implementação:** trocar stores por comandos reais sem schemas de resposta, eventos, erros e estados finais força decisões irreversíveis em duas equipes e viola o critério de rastreabilidade solicitado.

**Condição objetiva para remoção:** publicar schema de todas as queries/eventos, mapeamento para `frontend/src/domain/types.ts`, comportamento de drop/reconsulta, catálogo de erros e estado final de cada fluxo crítico; repetir a auditoria e obter zero `MISSING`/`CONTRADICTORY` nos fluxos críticos.

### B10 — Moderação, revogação e recuperação de identidade não têm comportamento seguro

**Findings:** F-26, F-35, F-38, DS-08, DR-30, DR-35, T-23, T-32, T-40, T-43.

**Evidência:** ban/kick não definem lifecycle do alvo nem revogação de leitura; replicação entre membros continua sem firewall completo; cargo base permite escalada; conexões de mídia sobrevivem à moderação; não há sucessão/recuperação de host [2] [3] [4] [7].

**Localização:** `backend.md` §§8.3, 14.3, 18.1; `frontend.md` §3.3; threat model T-23, T-32, T-40, T-43.

**Por que impede implementação:** requisitos críticos de segurança dependem de decisão inventada pelo implementador e a UX promete estados que o sistema não consegue impor ou explicar.

**Condição objetiva para remoção:** declarar explicitamente o que ban/kick revoga e o que não revoga, aplicar enforcement em todos os caminhos ou aceitar a limitação na UX, fechar cargo base/menções, definir desligamento de mídia, e registrar decisão de recuperação/sucessão de host.

## Riscos aceitos e itens que não bloqueiam isoladamente

`F-46`, `DS-30`, `T-47`, ADR-10, ADR-15 e ADR-18 foram tratados como `ACCEPTED RISK` porque o impacto é documental/operacional limitado ou a semântica é explicitamente local/efêmera/fora de escopo. Esses itens não tornam a arquitetura pronta: apenas não são, isoladamente, impedimentos de implementação. A aceitação deve ser registrada pelo responsável de produto/segurança; ela não pode ser inferida como correção.

Todos os itens `REQUIRES DECISION` permanecem pendentes. Eles não foram promovidos individualmente a blocker quando podem ser resolvidos por contrato sem prova estrutural, mas continuam impedindo a aprovação quando afetam um fluxo crítico, segurança, persistência ou rastreabilidade.

## Condições para uma futura reavaliação

A decisão atual não é `APPROVED WITH CONDITIONS`, pois existem blockers ativos e nenhum gate experimental passou. Uma nova submissão deverá conter uma versão de especificação com os contratos corrigidos, os ADRs reabertos onde indicado, os schemas UX↔backend publicados e os artefatos dos gates G0–G10. A reavaliação deve aceitar somente evidência reproduzível com versões, ambiente, carga, injeção de falha, métricas brutas e limiares previamente definidos; um teste local isolado, uma API documentada ou uma correção descrita sem execução não será suficiente [5].

## Referências

[1]: backend.md "Especificação Técnica do Backend"
[2]: auditoria-adversarial.md "Auditoria Adversarial de Arquitetura"
[3]: auditoria-sistemas-distribuidos.md "Auditoria de Sistemas Distribuídos e Confiabilidade"
[4]: dry-run-implementacao.md "Implementation Dry Run"
[5]: auditoria-experimental-de-decisões-arquiteturais.md "Auditoria Experimental de Decisões Arquiteturais"
[6]: rastreabilidade-ux-backend.md "Matriz de Rastreabilidade UX/UI ↔ Backend"
[7]: threat-model-seguranca.md "Threat Model de Segurança"
[8]: relatorio-auditoria-adr.md "Auditoria adversarial de decisões tecnológicas"
[9]: frontend.md "Especificação de UX/UI"
[10]: auditoria-experimental-de-decisões-arquiteturais.md "Gates, PoCs e benchmarks"

*Parecer consolidado do Architecture Review Board — Manus AI.*
