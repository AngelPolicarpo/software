# Auditoria Experimental de Decisões Arquiteturais

## Escopo, método e veredito executivo

Este documento avalia as ADRs 01–20 da especificação técnica do backend como **hipóteses arquiteturais**, não como fatos comprovados. O objetivo não é implementar o produto nem corrigir a especificação por inferência; é determinar quais decisões precisam de evidência experimental antes que o produto seja construído sobre elas.

A conclusão central é que **nenhuma meta de escala, latência, memória, recuperação, conectividade NAT, mídia ou durabilidade pode ser considerada validada apenas pela documentação existente**. Os documentos fornecem desenhos, APIs, limites e alguns testes planejados, mas não fornecem execuções reproduzíveis nos ambientes-alvo. Os achados anteriores também demonstram contradições que precisam ser convertidas em gates experimentais, principalmente na reconstrução da projeção SQLite, no caminho de escrita de blobs, na atomicidade de validação e append, na prova de convite delegado, na durabilidade da outbox, na idempotência e no par ICE/UDX.

> **Regra de decisão:** uma ADR só será considerada validada quando o experimento correspondente produzir evidência reproduzível, com ambiente, versão, carga, injeção de falha e limiar previamente definidos. “O pacote documenta essa API”, “o teste local passou” ou “parece funcionar” não são evidência suficiente da propriedade sistêmica.

A especificação define, entre outros valores, `submitOp` LAN abaixo de 60 ms, projeção de pelo menos 8.000 registros por segundo, boot abaixo de 1,5 s para cinco comunidades e 50 mil mensagens, memória de repouso abaixo de 250 MiB, 128 conexões simultâneas, 340 membros de referência, até 50 comunidades, anexos de até 8 GiB e sessões de tela de até 200 espectadores [1][5]. Esses valores devem permanecer **hipóteses de capacidade** até que os benchmarks abaixo sejam executados.

## Critério de classificação

| Classificação | Uso neste relatório |
|---|---|
| **POC REQUIRED** | A decisão depende de uma capacidade de integração, segurança, recuperação ou rede que pode invalidar a arquitetura ou exigir uma substituição estrutural. |
| **BENCHMARK REQUIRED** | A decisão pode permanecer conceitualmente válida, mas seus limites de throughput, latência, memória, fan-out ou startup não têm evidência. |
| **FAILURE TEST REQUIRED** | A semântica é compreensível, porém a confiança depende de crash, perda, atraso, duplicação, reinício ou reprojeção controlada. |
| **DOCUMENTATION SUFFICIENT** | O escopo da decisão é explícito, pouco acoplado e não depende de uma propriedade emergente que exija experimento prévio. |
| **LOW RISK** | A decisão é local, facilmente substituível e não é um ponto de estrangulamento ou de segurança estrutural. |

## ADR Risk Matrix

A coluna **evidência existente** registra o estado da documentação, não um resultado experimental. Os termos “parcial”, “inferida” e “contradita” refletem o cruzamento entre `backend.md` e as auditorias anexadas [1][2][3][4][5][6][7].

| ADR | Decisão resumida | Impacto se errada | Dificuldade de substituir | Dependência sistêmica | Evidência existente | Benchmark | Integração | Falha | Rede | Classificação |
|---|---|---:|---:|---:|---|---|---|---|---|---|
| **01** | Host como única autoridade de escrita | Crítico: regras concorrentes podem aceitar estado incompatível ou degradar a comunidade | Muito alta | Muito alta | Parcial: Hypercore dá ordem de append, mas não atomicidade entre validação, append e projeção [5] | Sim | Sim | Sim | Sim | **POC REQUIRED** |
| **02** | Hypercore cru + SQLite como view descartável | Crítico: perda da lista de comunidades, `blobsKey`, namespaces ou acesso a anexos após reprojeção | Muito alta | Muito alta | Contradita no desenho atual: participação e `blobsKey` não são reconstruíveis pelo log [2][5] | Sim | Sim | Sim | Sim | **POC REQUIRED** |
| **03** | `better-sqlite3@13` como driver | Alto: falha de distribuição, rebuild ou transação longa bloqueia o produto | Alta | Alta | API síncrona documentada; justificativa de ABI universal Electron–Node contradita [4][5] | Sim | Sim | Sim | Não | **POC REQUIRED** |
| **04** | Núcleo em `utilityProcess` | Alto: crash, restart ou addon nativo podem deixar IPC, locks ou UI em estado falso | Alta | Alta | Isolamento de processo documentado; recuperação semântica e compatibilidade empacotada não demonstradas [4][5] | Sim | Sim | Sim | Sim | **POC REQUIRED** |
| **05** | Mídia híbrida: WebRTC para voz/câmera e WebCodecs+UDX para tela | Crítico: mídia inutilizável, latência incompatível ou necessidade de reescrever transporte | Muito alta | Muito alta | Parcial: WebRTC/WebCodecs são plausíveis, mas o pipeline empacotado e o relay não estão validados [5] | Sim | Sim | Sim | Sim | **POC REQUIRED** |
| **06** | Sem STUN por padrão; endereço HyperDHT como candidato ICE | Crítico: falha de conexão em NAT restritivo, especialmente no limite entre sockets/processos | Alta | Muito alta | Contradita como garantia: endereço DHT não prova candidato ICE válido para o renderer [5] | Sim | Sim | Sim | Sim | **POC REQUIRED** |
| **07** | UDX como fallback universal de voz | Crítico: fallback sem codec, jitter buffer, criptografia, playout ou controle de perda | Muito alta | Muito alta | Contradita como capacidade pronta; UDX não fornece a pilha de mídia [5] | Sim | Sim | Sim | Sim | **POC REQUIRED** |
| **08** | Relay por voluntários, presumido blind e cifrado | Crítico: relay pode ler tela ou operar sem confidencialidade | Alta | Alta | Contradita: UDX não cifra; árvore de tela expõe chunks/configuração ao repassador [5][7] | Sim | Sim | Sim | Sim | **POC REQUIRED** |
| **09** | Convite com segredo de 10 bytes e challenge-response | Alto/crítico: convite delegado não resgata e `maxUses` pode aceitar múltiplos candidatos | Alta | Alta | Entropia é adequada, mas o host não possui o segredo de convite criado por outro membro e a concorrência lê projeção atrasada [2][3] | Sim, limitado | Sim | Sim | Sim | **POC REQUIRED** |
| **10** | Deleção apenas por tombstone | Médio/alto: divergência de histórico, falsa promessa de apagamento e inconsistência em reprojeção | Média | Média | Semântica explícita e compatível com log append-only; retenção dos bytes precisa permanecer honesta [1][5] | Não | Sim | Sim | Sim | **FAILURE TEST REQUIRED** |
| **11** | Outbox durável em SQLite | Crítico: perda de mensagens confirmadas ou falsidade sobre fila offline | Alta | Muito alta | Parcial: SQLite/WAL são conhecidos, mas `NORMAL` não protege a promessa após power loss [3][5] | Sim | Sim | Sim | Sim | **POC REQUIRED** |
| **12** | Idempotência por `opId` com dedupe de sete dias | Crítico: duplicata determinística, colisão de PK ou perda silenciosa após crash entre stores | Alta | Muito alta | Contradita pela ausência de ordem/atomicidade entre Hypercore e `local_dedupe` [3] | Sim | Sim | Sim | Sim | **POC REQUIRED** |
| **13** | FTS5 local com `unicode61` e prefixo | Médio: busca lenta, incorreta ou incompatível com filtros | Média | Média | API e modelo de consulta são documentados; números de latência não foram medidos [1][5] | Sim | Sim | Não | Não | **BENCHMARK REQUIRED** |
| **14** | Presença, typing e roster efêmeros | Médio: fan-out excessivo, atraso ou consumo de memória; sem perda permanente de domínio | Média | Alta | Semântica efêmera é clara; custo em 340 membros e 128 conexões é desconhecido [1][5] | Sim | Sim | Sim | Sim | **BENCHMARK REQUIRED** |
| **15** | Não-lidas e menções calculadas localmente | Baixo/médio: badges incorretos ou reconstrução local inconsistente | Baixa | Média | Decisão de escopo local é explícita; há riscos de watermark e reprojeção, mas sem mudança estrutural obrigatória [1][6] | Não | Sim | Sim | Não | **LOW RISK** |
| **16** | Toda comunidade participada replica em background | Alto/crítico: startup, memória, starvation, fan-out e mídia degradam conforme comunidades crescem | Muito alta | Muito alta | Requisito de produto é claro, mas capacidade de 50 comunidades/128 peers não tem benchmark [1][5] | Sim | Sim | Sim | Sim | **BENCHMARK REQUIRED** |
| **17** | Árvore de tela calculada pelo host | Crítico: arquitetura de distribuição não suporta espectadores, reparo ou churn | Muito alta | Alta | Algoritmo é uma decisão de desenho; custo de relay e convergência são abertos [1][5] | Sim | Sim | Sim | Sim | **POC REQUIRED** |
| **18** | Sem notificações com app fechado no v1 | Baixo: mudança de escopo de produto, não falha de consistência | Baixa | Baixa | Escopo explicitamente fora do v1 [8] | Não | Não | Não | Não | **DOCUMENTATION SUFFICIENT** |
| **19** | Chave privada cifrada por `safeStorage` | Alto/crítico: perda de identidade ou falsa garantia de proteção do segredo | Alta | Muito alta | Parcial: depende de secret store, fallback Linux, empacotamento e fronteira main↔núcleo [4][5][7] | Sim | Sim | Sim | Não | **POC REQUIRED** |
| **20** | Um único núcleo por instalação com lock de diretório | Alto: corrupção por dupla abertura, lock órfão ou incapacidade de recuperar após crash | Alta | Muito alta | Intenção é clara, mas lock composto, deep link e cleanup após `wipe` não foram exercitados [4][5][6] | Sim | Sim | Sim | Não | **POC REQUIRED** |

### Leitura de prioridade

Os riscos de maior prioridade são os que combinam **impacto crítico, substituição difícil e dependência transversal**. Eles devem ser validados antes de qualquer trabalho de domínio ou UI real: ADR-02, ADR-03/04/20, ADR-01, ADR-09/11/12 e ADR-05/06/07/08/17. A ordem não é a ordem de implementação do produto; é a ordem de eliminação de hipóteses capazes de invalidar a arquitetura inteira.

## POCs prioritários

Os POCs seguintes são deliberadamente pequenos. Cada um deve ser um harness isolado, com o mínimo de código para exercer a propriedade de risco. **Não devem virar a primeira versão do produto**, nem ganhar UI, autenticação completa, observabilidade de produção ou abstrações que escondam o comportamento medido.

### POC-01 — Autoridade, validação e append sob concorrência

**ADRs cobertas:** ADR-01; pré-condição para ADR-09, ADR-12 e ADR-17.

| Item | Definição experimental |
|---|---|
| **1. Hipótese** | Se o host serializa o estado autoritativo usado na validação antes do append, operações concorrentes mutuamente incompatíveis são rejeitadas antes de entrarem no log, mesmo quando o projetor SQLite está atrasado. |
| **2. O que construir** | Harness com um host, dez clientes, Hypercore real, uma fila de submissão serializada, um estado autoritativo mínimo e um projetor SQLite pausável. Implementar somente oito tipos de conflito: canal excluído com mensagem, dois canais de mesmo nome, role removida com atribuição, categoria removida com canal, mensagem removida com reação, último canal, ban concorrente e movimento concorrente de cargo. |
| **3. O que não implementar** | Não implementar renderer, stores Zustand, todos os 29 `kind`s, presença, mídia, convites completos ou sistema de permissões visual. O estado mínimo deve servir apenas para provar a fronteira validação→append→projeção. |
| **4. Ambiente** | Node/Electron e versões travadas do backend; `hyperdht/testnet`; SQLite real em WAL; projetor com `P2P_PROJECTOR_BATCH` nos valores 32, 256 e 2048; relógio injetável. |
| **5. Inputs** | 10.000 repetições por par de conflito, 2–10 clientes simultâneos, atrasos de projetor de 0, 10, 100 e 1.000 ms, mensagens duplicadas e reordenação de RPC. |
| **6. Cenários** | Submeter cada par em paralelo; pausar o projetor antes do segundo comando; reiniciar o host no intervalo; repetir com estado autoritativo em memória e com estado derivado apenas da projeção para comparar os modelos. |
| **7. Métricas** | Ops aceitas, ops appendadas, ops rejeitadas antes do append, número de invariantes quebradas, `projector.failed`, comunidades em `degraded`, seqs duplicados, p50/p95/p99 de submissão e backlog do projetor. |
| **8. Threshold de aprovação** | Zero operação incompatível no log; zero `projector.failed`; zero comunidade degradada; todas as rejeições com erro determinístico; convergência idêntica em todas as réplicas. O p95 de `submitOp` deve permanecer dentro de 60 ms em LAN na carga nominal. |
| **9. Threshold de reprovação** | Uma única operação incompatível appendada, uma única exceção de reducer causada por corrida, qualquer divergência entre réplicas ou p95 acima de 250 ms na carga nominal. |
| **10. Resultado que invalida o ADR** | O host não consegue validar contra estado consistente sem sincronizar toda a projeção ou sem introduzir uma nova transação/compare-and-append. Também invalida a formulação atual se o writer único apenas ordenar o log, mas não impedir estado inválido. |
| **11. Resultado que confirma o ADR** | A autoridade única, combinada com o estado de validação especificado, rejeita todas as corridas antes do append e mantém o log e as projeções convergentes sem exigir multi-writer. |
| **12. Se falhar** | Parar a construção do domínio. Escolher explicitamente entre estado autoritativo síncrono no host, compare-and-append no log ou uma transação de domínio diferente. Reabrir ADR-01 e atualizar os contratos antes de qualquer UI otimista. |

### POC-02 — Reprojeção completa, participação e `blobsKey`

**ADR coberta:** ADR-02.

| Item | Definição experimental |
|---|---|
| **1. Hipótese** | Apagar o SQLite e reabrir a instalação recompõe não apenas tabelas projetadas, mas também a enumeração de comunidades, namespaces, `coreKey`, `blobsKey` e acesso aos blobs sem depender de convite antigo ou estado não documentado. |
| **2. O que construir** | Harness de criação e entrada em comunidades com manifesto mínimo de identidade, participação, namespace, chaves de core/blob, `last_projected_seq` e registro de blobs. Implementar reprojeção e reabertura real, não somente um `dump` de tabelas. |
| **3. O que não implementar** | Não implementar UI, FTS, busca, todos os reducers, sincronização de presença, permissões completas ou migrações de produto. O foco é o inventário de recursos necessários para reabrir a instalação. |
| **4. Ambiente** | Corestore/Hypercore/Hyperblobs reais, SQLite em arquivo, 1 host e até 10 membros, namespaces aleatórios e `hyperdht/testnet`. Repetir em Linux, Windows e macOS quando o artefato estiver disponível. |
| **5. Inputs** | 50 comunidades participadas, 5.000 registros por comunidade, 500 blobs de tamanhos variados, 4 GiB de dados de anexos no total, membros host e não host, schema versions consecutivas. |
| **6. Cenários** | Reprojeção limpa; apagar apenas `view.db`; apagar e recriar todo o SQLite; bump de schema; crash durante catch-up; host offline; perda de convite original; namespace aleatório; perda de uma tabela local; reabertura depois de `identity.wipe` abortado. |
| **7. Métricas** | Comunidades recuperadas, `coreKey`/`blobsKey` recuperados, blobs reabertos e verificados por hash, diferença entre dumps ordenados, registros projetados, tempo de boot, erros de namespace e recursos órfãos. |
| **8. Threshold de aprovação** | 100 ciclos limpos e 100 ciclos com crash injetado sem perda de participação ou chave; 100% dos blobs conhecidos acessíveis; hash do dump projetado idêntico; nenhum namespace novo criado para uma comunidade existente; boot dentro de 4 s no dataset de 5 comunidades/50 mil mensagens. |
| **9. Threshold de reprovação** | Uma comunidade não listada, um `blobsKey` perdido, um blob previamente acessível que não pode mais ser aberto, qualquer divergência de dump ou necessidade de convite/rede para reconstruir estado que deveria ser descartável. |
| **10. Resultado que invalida o ADR** | A reconstrução só funciona porque preserva tabelas locais, depende de valores aleatórios não persistidos, ou perde participação e blobs ao apagar o SQLite. Nesse caso, ADR-02 é falsa na forma atual. |
| **11. Resultado que confirma o ADR** | O log e um manifesto autoritativo mínimo são suficientes para reconstruir exatamente a view e todos os recursos necessários, com a separação explícita entre estado replicado e estado local não descartável. |
| **12. Se falhar** | Reabrir ADR-02. Persistir manifesto de participação/namespace/chaves em armazenamento durável separado, tornar `blobsKey` derivável e normativo, ou abandonar a afirmação de SQLite totalmente descartável. Não mascarar a falha duplicando tabelas sem contrato. |

### POC-03 — Matriz nativa, `utilityProcess` e startup

**ADRs cobertas:** ADR-03 e ADR-04.

| Item | Definição experimental |
|---|---|
| **1. Hipótese** | O artefato Electron pinado carrega os addons nativos e executa operações reais de Hypercore, RocksDB/SQLite, sodium e UDX dentro de `utilityProcess`, com cold start e recuperação aceitáveis. |
| **2. O que construir** | Aplicação Electron mínima com main, `utilityProcess`, `MessagePort`, `better-sqlite3`, criação de core, append/flush, transação longa, verificação Ed25519 e heartbeat. Empacotar com a configuração final de `asar`/`asarUnpack`. |
| **3. O que não implementar** | Não implementar domínio, renderer de produto, RPC completo, outbox, mídia, permissões ou navegação. O POC deve exercitar somente carregamento, operação nativa, isolamento e ciclo de vida. |
| **4. Ambiente** | Matriz dos três sistemas operacionais suportados e arquiteturas distribuídas suportadas; Electron/Node/pacotes travados; build empacotado, não apenas `electron .`; CI com artefatos arquivados. |
| **5. Inputs** | 100 cold starts por alvo, 10.000 appends, transações de 256 e 2.048 registros, SQLite WAL/FTS5, crash por exceção nativa e `SIGKILL` do processo filho. |
| **6. Cenários** | Execução em desenvolvimento e empacotada; addon dentro/fora do `asar`; boot sem dados, com dados e após upgrade; crash durante transação, replicação e flush; três reinícios em 60 s; arquivo de dados bloqueado. |
| **7. Métricas** | Taxa de carga, operação nativa concluída, cold start até `core.ready`, p95 de transação, memória do núcleo, crash do main, tempo de restart, erros de ABI, locks órfãos e perda de dados. |
| **8. Threshold de aprovação** | 100% dos testes funcionais em todos os alvos suportados; nenhum rebuild manual pós-empacotamento; p95 de boot até 4 s; nenhum crash do main causado pelo filho; recuperação de dados e lock em 100% dos ciclos. |
| **9. Threshold de reprovação** | Qualquer alvo suportado sem addon funcional, qualquer dependência de intervenção manual, qualquer necessidade de extrair código em produção sem contrato, crash que impede o restart ou perda de dados confirmados. |
| **10. Resultado que invalida o ADR** | N-API não basta para o artefato Electron real, ou `utilityProcess` não oferece recuperação sem redesign de build/protocolo. A justificativa de ABI universal deve ser removida mesmo se o isolamento passar. |
| **11. Resultado que confirma o ADR** | O artefato final carrega e executa os módulos nativos em todos os alvos declarados, o processo filho pode ser reiniciado de forma determinística e os limites de startup/memória são respeitados. |
| **12. Se falhar** | Fixar uma matriz menor de plataformas, adotar rebuild obrigatório por alvo ou migrar para um sidecar Bare com contrato próprio. Não começar a fase de domínio com um runtime apenas “funcionando” em desenvolvimento. |

### POC-04 — Ciclo de vida do IPC e recuperação do núcleo

**ADRs relacionadas:** ADR-04 e ADR-20; risco transversal de IPC.

| Item | Definição experimental |
|---|---|
| **1. Hipótese** | O contrato de `MessagePort` consegue sobreviver a renderer lento, eventos descartados, request em voo e crash do núcleo sem estado visual incorreto, vazamento de memória ou perda silenciosa. |
| **2. O que construir** | Três processos mínimos: main, núcleo e renderer falso. Implementar handshake, `req/res`, assinaturas, contador de sequência, backpressure, re-subscribe e reconsulta de estado. O harness deve conseguir matar e recriar o núcleo. |
| **3. O que não implementar** | Não implementar componentes React, todos os tópicos de evento, regras de domínio ou rede P2P. Um estado artificial com contador, lista e operação idempotente é suficiente. |
| **4. Ambiente** | Electron empacotado, `contextIsolation` e sandbox conforme a especificação, `MessageChannelMain`, renderer artificial com pausas controladas e heap profiling. |
| **5. Inputs** | 100.000 eventos, high-water de 1.000, renderer pausado por 1/10/60 s, duplicação e reordenação de eventos, 1.000 requests em voo e crashes em cada ponto do ciclo. |
| **6. Cenários** | Subscrição duplicada, filtro diferente para o mesmo tópico, evento perdido antes/depois de `ipc.dropped`, request aplicado antes de crash, request não aplicado, renderer reconectado com id monotônico e re-subscribe automático. |
| **7. Métricas** | Memória máxima e após GC, eventos emitidos/dropped, tempo até convergência de query, requests duplicados, requests órfãos, assinaturas recuperadas, loop lag do núcleo e número de processos vivos. |
| **8. Threshold de aprovação** | Após três crashes consecutivos, o renderer converge para a mesma query do núcleo; nenhuma operação aplicada duas vezes; nenhuma assinatura fica silenciosamente perdida; memória retorna a até 20% do baseline após drenagem; `ipc.dropped` sempre provoca reconsulta correta. |
| **9. Threshold de reprovação** | Estado visual divergente após reconsulta, request aplicado duas vezes, assinatura perdida sem reconsulta, crescimento de memória sem limite ou necessidade de fechar/reabrir toda a janela para recuperar. |
| **10. Resultado que invalida o ADR** | O contrato atual não é suficiente para medir drenagem, correlacionar assinatura ou recuperar requests em voo. Isso invalida a confiança na fronteira IPC, ainda que `postMessage` funcione em condições normais. |
| **11. Resultado que confirma o ADR** | Um protocolo mínimo de handshake, ack/watermark e reconsulta mantém convergência e bounded memory sem exigir que eventos sejam fonte de verdade. |
| **12. Se falhar** | Formalizar `subId`, sequência, ack, resubscribe e política de requests em voo antes de implementar stores. Se necessário, mudar o frame `ev`; não esconder a ausência de contrato em utilitários do renderer. |

### POC-05 — Prova de convite delegado e uso concorrente

**ADR coberta:** ADR-09; também valida `INV-10` e as garantias de entrada.

| Item | Definição experimental |
|---|---|
| **1. Hipótese** | Um convite criado por qualquer membro autorizado pode ser validado pelo host sem revelar o segredo no log, e `maxUses` é aplicado atomicamente mesmo com candidatos simultâneos. |
| **2. O que construir** | Host mínimo, criador não host, criador host, dez candidatos, log assinado, armazenamento de convites e RPC de challenge/proof/redeem. Incluir apenas os estados necessários para convite, ban e uso. |
| **3. O que não implementar** | Não implementar comunidade completa, UI, FTS, voz, blobs, DHT pública ou todos os cargos. O objetivo é provar posse do segredo, autorização de criação e consumo atômico. |
| **4. Ambiente** | `hyperdht/testnet`, conexões reais `protomux-rpc`, armazenamento persistente e relógio controlado. Repetir com projetor pausado e host reiniciado. |
| **5. Inputs** | 100 convites criados por host e não host; segredos de 10 bytes; `maxUses` 1, 2 e ilimitado; convites revogados, expirados, banidos e já usados. |
| **6. Cenários** | Preview e redeem por convite delegado; dez redeems simultâneos para `maxUses=1`; crash entre validação e append; replay de proof; challenge repetido; conexão perdida após append; host offline. |
| **7. Métricas** | Taxa de sucesso legítimo, falsos negativos, candidatos aceitos, `member.join` no log, uso contado, provas replayadas aceitas, tempo de validação e conexões fechadas por tentativa inválida. |
| **8. Threshold de aprovação** | 100% dos convites delegados legítimos funcionam; para 10 candidatos e `maxUses=1`, exatamente um entra e nove recebem `E_INVITE_EXHAUSTED`; zero replay aceito; zero entrada após revogação observada pelo estado autoritativo. |
| **9. Threshold de reprovação** | Uma falha de convite delegado, dois membros aceitos para um único uso, qualquer prova replayada aceita ou qualquer resultado que dependa de o projetor já ter atualizado SQLite. |
| **10. Resultado que invalida o ADR** | O host não consegue verificar convite criado por outro membro sem receber o segredo, ou não consegue reservar o uso de modo atômico. A forma atual de ADR-09 e do fluxo de convite é inválida. |
| **11. Resultado que confirma o ADR** | O protocolo fornece uma capability verificável pelo host, sem segredo no log, e o uso é reservado no mesmo estado autoritativo que decide a aceitação. |
| **12. Se falhar** | Escolher um novo desenho: capability assinada pelo host, segredo transferido por canal autenticado ou outro protocolo de convite; separar explicitamente autenticação da contagem de usos. Não corrigir apenas a UI do erro. |

### POC-06 — Caminho de escrita e recuperação de blobs

**ADRs relacionadas:** ADR-02 e ADR-16; risco estrutural independente identificado em F-03.

| Item | Definição experimental |
|---|---|
| **1. Hipótese** | Um membro que anexa arquivo consegue produzir um blob recuperável por peers, com hash verificável, sem escrever localmente em um Hyperblobs cuja chave privada só pertence ao host e sem monopolizar o RPC de operações. |
| **2. O que construir** | Três nós mínimos: host, membro que anexa e peer seeder. Exercitar `blob.stage`, anúncio, replicação, download, cancelamento e resume; medir bytes do RPC separadamente do stream de blob. |
| **3. O que não implementar** | Não implementar composer, mensagens completas, permissões visuais, FTS ou cache LRU completo. Não esconder uma decisão de multi-writer dentro de uma abstração de “blob”. |
| **4. Ambiente** | Hyperblobs/Hypercore/UDX reais, armazenamento em disco, host online/offline, `hyperdht/testnet`, arquivos de 1 MiB, 1 GiB e 8 GiB. O arquivo de 8 GiB pode ser gerado deterministicamente em stream para não depender de dataset externo. |
| **5. Inputs** | Arquivos com hash conhecido, upload concorrente, host com fila de submissão, peer com perda de conexão, reinício do anexador e espaço de cache próximo de 20 GiB. |
| **6. Cenários** | Stage com host desconectado; stage com host online; upload via host, caso essa seja a interpretação escolhida; peer entra no meio; peer cai; anexador reinicia; download parcial; hash incorreto; mensagem enviada enquanto um blob grande é transferido. |
| **7. Métricas** | Sucesso do stage, bytes atravessando RPC, throughput, backpressure, uso de disco/memória, ocupação da fila serializada, p95 de `submitOp`, tempo de resume, peers disponíveis e hash final. |
| **8. Threshold de aprovação** | A arquitetura escolhida é executável e explícita; nenhum membro tenta `put` em core sem sua chave; o blob é recuperado com hash correto em 100% dos ciclos; upload não bloqueia o caminho de controle; p95 de `submitOp` permanece abaixo de 250 ms durante o upload nominal. |
| **9. Threshold de reprovação** | O membro não consegue stage sem uma operação inexistente, o arquivo inteiro precisa atravessar RPC sem backpressure especificado, o host fica indisponível para mensagens ou qualquer blob recuperado diverge do hash. |
| **10. Resultado que invalida o ADR** | A leitura atual continua exigindo que um membro escreva em core de escritor único ou que o host receba 8 GiB na fila de controle. Nesse caso, o caminho de anexos não pode permanecer como está. |
| **11. Resultado que confirma o ADR** | Existe um modelo normativo de ownership e manifestação do blob, com escrita, anúncio, seeding e resume demonstrados; a operação é compatível com os limites de latência e memória. |
| **12. Se falhar** | Reabrir o desenho de blobs: core por membro com manifesto replicado, upload controlado pelo host em canal separado, ou outra topologia de ownership. Atualizar `blobsKey`, RPC, projeção, cache e contratos antes de implementar anexos. |

### POC-07 — Durabilidade da outbox e idempotência após crash

**ADRs cobertas:** ADR-11 e ADR-12.

| Item | Definição experimental |
|---|---|
| **1. Hipótese** | Uma operação confirmada não desaparece após queda, uma operação não confirmada permanece reenviável e qualquer retry do mesmo envelope produz exatamente um aceite lógico, independentemente da ordem entre append e dedupe. |
| **2. O que construir** | Host com Hypercore real e cliente com SQLite outbox; dedupe reconstruível e não reconstruível em duas variantes; injetor de kill entre todos os pontos de persistência e resposta. |
| **3. O que não implementar** | Não implementar UI otimista, todos os tipos de mensagem, busca, mídia ou política completa de backoff. O harness precisa apenas de envelope, append, ack, outbox, dedupe e projeção. |
| **4. Ambiente** | SQLite WAL com `synchronous=FULL` e `NORMAL`, Hypercore persistente, filesystem real, processo separado para host e cliente, `SIGKILL`, bloqueio de flush e proxy que perde ACKs. |
| **5. Inputs** | 100.000 envelopes; kills antes do append, depois do append, antes/depois do dedupe, antes do ACK, depois do ACK e durante checkpoint; retries após 1 s, 1 min, 72 h simuladas e restart. |
| **6. Cenários** | ACK perdido com append durável; ACK positivo antes de flush; dedupe antes do append; dedupe depois do append; perda de WAL; expiração de outbox; host offline; duplicação de RPC; reabertura com `sending`. |
| **7. Métricas** | Operações perdidas, operações duplicadas, seqs por `opId`, itens de outbox desaparecidos, divergência de projeção, tempo de recuperação, fsyncs, p95 de submit, tamanho de WAL e estado após restart. |
| **8. Threshold de aprovação** | Zero perda de operação confirmada; zero duplicata lógica; zero `projector.failed`; todos os envelopes incertos são reconciliados por projeção/dedupe; outbox preserva todos os itens commitados; p95 LAN dentro de 60 ms com group commit ou o custo é explicitamente renegociado. |
| **9. Threshold de reprovação** | Uma mensagem confirmada perdida, uma duplicata que cause colisão ou dois seqs para o mesmo `opId`, qualquer item commitado da outbox perdido ou qualquer dependência de shutdown limpo para durabilidade. |
| **10. Resultado que invalida o ADR** | A idempotência requer transação inexistente entre Hypercore e SQLite, ou `NORMAL` não preserva as garantias de outbox/dedupe. ADR-11/12 precisam ser reescritas ou separadas por armazenamento. |
| **11. Resultado que confirma o ADR** | Dedupe é derivado/reconciliável pelo log, a outbox só é liberada após critério observável e os pontos de crash produzem apenas os dois estados permitidos: entregue ou ainda pendente. |
| **12. Se falhar** | Separar `local.db` de `view.db`, usar `FULL` onde necessário, reconstruir dedupe no boot, mudar o critério de remoção da outbox para observação na réplica e adicionar group commit. |

### POC-08 — ICE por socket, fallback UDX e relay seguro

**ADRs cobertas:** ADR-05, ADR-06, ADR-07 e ADR-08.

| Item | Definição experimental |
|---|---|
| **1. Hipótese** | O candidato obtido pelo núcleo via HyperDHT funciona na socket ICE do renderer; quando ICE falha, o fallback UDX fornece mídia com autenticação, confidencialidade, jitter, perda e latência aceitáveis; relay voluntário não lê o conteúdo. |
| **2. O que construir** | Quatro a seis pares reais com núcleo e renderer Electron, transporte de sinalização mínimo, `RTCPeerConnection`, caminho UDX de dados e uma camada de mídia explicitamente cifrada para o fallback. Instrumentar relay honesto e relay malicioso. |
| **3. O que não implementar** | Não implementar comunidade, permissões, UI de chamada, árvore de tela completa ou serviço TURN de produção. Também não assumir que UDX já fornece codecs, SRTP, AEC, FEC ou criptografia. |
| **4. Ambiente** | Rede controlada com NAT full-cone, port-restricted, symmetric, CGNAT quando disponível, `tc/netem` para atraso/perda e Electron empacotado. Repetir com DHT e STUN de referência apenas como comparação experimental. |
| **5. Inputs** | Voz codificada, câmera e pequenas sessões de tela; bitrate, perda de 0–5%, RTT de 20–300 ms, reconexão, peer relay, relay malicioso e candidatos derivados de sockets diferentes. |
| **6. Cenários** | ICE direto; candidato DHT; NAT restritivo; NAT simétrico; queda de ICE para UDX; relay voluntário; peer banido; troca de chave; perda e reorder; reconexão; observação de payload por relay. |
| **7. Métricas** | Taxa de conexão por classe de NAT, tempo de conexão, p95 de latência, jitter, perda, recuperação, CPU/memória, bytes por relay, integridade/autenticidade, capacidade de ler payload e taxa de reconexão. |
| **8. Threshold de aprovação** | Pelo menos 95% de conexão direta na matriz declarada como “típica”; nenhum caso silenciosamente perdido; taxa global abaixo de 80% reprova a promessa de 95%; fallback com autenticação/confidencialidade verificáveis, áudio com p95 abaixo de 250 ms e perda não recuperável abaixo de 1% no cenário nominal. |
| **9. Threshold de reprovação** | Candidato DHT não funciona para a socket ICE, UDX exige uma pilha de mídia não especificada, relay consegue ler conteúdo, ou fallback não entrega áudio/câmera com limiares definidos. |
| **10. Resultado que invalida o ADR** | A ponte DHT→ICE não funciona ou UDX não pode sustentar o contrato de voz sem uma arquitetura de mídia adicional. ADR-06/07/08 devem ser reabertas conjuntamente. |
| **11. Resultado que confirma o ADR** | Os mapeamentos por socket são compatíveis, o fallback é um protocolo de mídia seguro e mensurável e o relay não possui acesso ao conteúdo protegido. |
| **12. Se falhar** | Reintroduzir STUN/TURN ou outra infraestrutura explicitamente aceita, remover o fallback de voz, limitar a promessa a dados/tela ou especificar uma camada criptográfica e de mídia real antes de manter “UDX universal”. |

### POC-09 — WebCodecs, forwarding opaco e árvore de tela

**ADR coberta:** ADR-17; também valida a parte de tela da ADR-05.

| Item | Definição experimental |
|---|---|
| **1. Hipótese** | Uma árvore calculada pelo host, com fan-out 3 e forwarding sem decodificação, suporta 200 espectadores dentro dos limites de latência, CPU, memória, reparo e qualidade declarados. |
| **2. O que construir** | Presenter Electron com WebCodecs, host que calcula atribuições, oito viewers reais e viewers adicionais simulados, nós de repasse que apenas copiam quadros, heartbeat e reparenting. |
| **3. O que não implementar** | Não implementar chat, cargos, convite, busca, gravação, codec proprietário ou otimizações não medidas. O nó de repasse não pode decodificar “só para facilitar” o POC. |
| **4. Ambiente** | Electron/Chromium empacotado em GPUs/CPUs disponíveis; `STAR_MAX_VIEWERS=5`, `TREE_FANOUT=3`, heartbeat 2 s e dead-after 6 s; `tc/netem` para uplink limitado e perdas. |
| **5. Inputs** | Streams high/balanced/low a 2.500/1.200/600 kbps, keyframe a cada 2 s, entrada tardia, mudança de codecConfig, 8/50/200 espectadores, churn e falha de nós. |
| **6. Cenários** | Estrela abaixo de cinco; transição estrela→árvore; nível 2; queda do pai; queda do relay; novo espectador pedindo keyframe; configuração alterada; uplink insuficiente; host reiniciado. |
| **7. Métricas** | Latência presenter→folha por nível, p95/p99, CPU e memória do relay, bytes enviados/recebidos, frames perdidos, tempo de reparo, depth, número de reatribuições, qualidade e atraso de entrada. |
| **8. Threshold de aprovação** | Folha em estrela abaixo de 800 ms e nível 2 abaixo de 2,5 s; CPU do relay abaixo de 15%; zero decode/reencode no repasse; reparo após 6 s de ausência; perda nominal abaixo de 1% e sem crescimento ilimitado de buffer. |
| **9. Threshold de reprovação** | Latência de nível 2 acima de 2,5 s, CPU de relay acima de 15%, impossibilidade de manter forwarding opaco, churn que impede estabilização ou perda acima de 5% no cenário nominal. |
| **10. Resultado que invalida o ADR** | A árvore não suporta custo de relay, reparo ou compatibilidade WebCodecs dentro dos limites; nesse caso, o produto deve permanecer em estrela limitada ou adotar outra arquitetura. |
| **11. Resultado que confirma o ADR** | O host calcula uma árvore estável, os nós repassam bytes opacos, as folhas permanecem dentro da latência e os reparos não exigem coordenação distribuída adicional. |
| **12. Se falhar** | Manter estrela com limite explícito, reduzir audiência, cortar árvore do v1 ou reabrir ADR-17; não anunciar “árvore” apenas porque o algoritmo produz uma lista de pais. |

### POC-10 — `safeStorage`, identidade e lock composto

**ADRs cobertas:** ADR-19 e ADR-20.

| Item | Definição experimental |
|---|---|
| **1. Hipótese** | A chave privada pode ser armazenada/recuperada de forma compatível nos alvos suportados, e apenas uma instalação abre o núcleo por vez, inclusive após crash, wipe e chegada de deep link. |
| **2. O que construir** | Aplicação Electron mínima com main usando `safeStorage`, núcleo que assina uma mensagem, lock de diretório, segunda instância, `requestSingleInstanceLock`, limpeza e reabertura. |
| **3. O que não implementar** | Não implementar comunidade, RPC, renderer de produto, notificações ou gestão completa de chaves. O objetivo é secret store, lifecycle e exclusão mútua. |
| **4. Ambiente** | Windows, macOS e Linux com secret store disponível e indisponível; artefato empacotado; filesystem local suportado; testes x64/arm64 aplicáveis. |
| **5. Inputs** | Chaves novas e existentes, lock ocupado, lock órfão, crash antes/depois do cleanup, `identity.wipe`, deep link com app aberto e segunda inicialização simultânea. |
| **6. Cenários** | Criar/ler/zerar chave; reiniciar; secret store Linux `basic_text`; dois launches concorrentes; crash do núcleo; crash do main; wipe; upgrade; deep link encaminhado à instância viva. |
| **7. Métricas** | Segredo em claro em disco/log/IPC indevido, sucesso de recuperação, tempo de boot, erro nomeado de segunda instância, lock órfão, perda de identidade e taxa de encaminhamento de deep link. |
| **8. Threshold de aprovação** | Nenhuma chave em claro no caminho declarado; 100% de recuperação nos alvos suportados; segunda instância nunca abre o núcleo; cleanup pós-crash funciona em 100% dos ciclos; fallback sem secret store é explicitamente sinalizado e não tratado como equivalente. |
| **9. Threshold de reprovação** | Segredo em claro, identidade irrecuperável sem ação especificada, duas instâncias escrevendo, lock permanente após crash ou deep link perdido quando o app está aberto. |
| **10. Resultado que invalida o ADR** | O ambiente suportado não fornece proteção de chave compatível ou o lock não pode ser composto com o lifecycle do Electron. A ADR precisa restringir plataformas ou mudar de fronteira de confiança. |
| **11. Resultado que confirma o ADR** | O secret store, o processo principal e o núcleo têm contrato explícito; a única instância é garantida sem corromper dados e o modo degradado é honesto. |
| **12. Se falhar** | Remover o alvo de suporte, adotar sidecar/keystore alternativo, mudar a fronteira de chave, ou transformar `basic_text` em modo explicitamente não protegido. Não manter a frase “safeStorage protege” sem qualificar a plataforma. |

## Benchmarks prioritários

Os benchmarks não substituem os POCs de correção. Eles medem se uma decisão que passou semanticamente consegue atender os limites declarados. Todos devem registrar hardware, sistema operacional, versão do Electron/Node, lockfile, configuração, dataset, número de amostras, warm-up, percentis e artefatos brutos.

| Prioridade | Benchmark | Hipótese | Carga mínima | Métricas | Critério de aceitação |
|---:|---|---|---|---|---|
| **1** | Append, validação, projeção e `submitOp` | Host único mantém ordem e throughput sem transformar o projetor em gargalo | 100 mil ops, 340 membros, lotes 32/256/2048 | ops/s, p95/p99, CPU, fsync, WAL, backlog, `SQLITE_BUSY`, memória | Projeção ≥8.000 reg/s e `submitOp` LAN p95 <60 ms; teto absoluto 3.000 reg/s e 250 ms deve ser reportado como falha de capacidade |
| **2** | Startup, memória e abertura multicomunidade | ADR-16 não causa starvation nem ultrapassa limites ao abrir 50 comunidades | 5 comunidades/50 mil mensagens e escalada até 50 comunidades/100 tópicos | cold/warm boot, `core.ready`, memória, CPU, filas por tópico, tempo de convergência | Dataset nominal: boot <1,5 s, teto 4 s, memória <250 MiB, teto 500 MiB; nenhuma comunidade fica indefinidamente sem serviço |
| **3** | Fan-out efêmero | Presença/typing para 340 membros não degrada operações críticas | 340 membros, presença a cada 30 s, typing a cada 3 s, bursts de 10/100 eventos | mensagens/s, bytes/s, loop lag, drops, backlog RPC, p95/p99 de `submitOp`, memória | Sem starvation de escrita; `submitOp` permanece abaixo do teto; eventos podem ser descartados apenas com reconsulta correta |
| **4** | FTS5 e queries | FTS5, filtros e projeção local atendem a experiência offline | 10 mil e 100 mil mensagens, diacríticos, prefixos, filtros combinados | p50/p95/p99, CPU, cache miss, tamanho FTS/WAL | `query.search` <30 ms no dataset-alvo e <120 ms no teto; `query.messages` <3 ms e <15 ms no teto |
| **5** | IPC e backpressure | Eventos transferíveis não crescem sem limite nem bloqueiam comandos | 100 mil eventos, renderer lento, high-water 1000 | heap, loop lag, dropped/requery, req em voo, tempo de reconexão | Memória retorna próximo do baseline, reconsulta converge e nenhuma operação crítica é perdida ou duplicada |
| **6** | Upload/download de blobs | Blobs grandes não monopolizam controle e podem retomar | 1 MiB, 1 GiB, 8 GiB; 3 peers; perda e restart | throughput, bytes RPC, fila, p95 submit, disco, memória, resume, hash | Hash 100% correto; p95 de controle <250 ms durante carga; se upload via host for necessário, isso deve ser assumido e reorçado explicitamente |
| **7** | Árvore de tela | Fan-out 3 reduz custo sem romper latência e reparo | 8, 50 e 200 viewers; 2.500/1.200/600 kbps | latência por nível, CPU relay, bytes, perda, reparo, churn | Nível 2 <2,5 s, relay <15% CPU, reparo dentro de dead-after e perda nominal <1% |
| **8** | NAT e reconexão | Sem STUN padrão e com fallback voluntário há conectividade mensurável | NAT full-cone, restricted, symmetric, CGNAT; 100 tentativas por classe | sucesso direto, tempo, relay, falhas, reconexão, p95 mídia | ≥95% na matriz declarada como típica; <80% global dispara replanejamento conforme risco da própria spec |

### Regras para não falsear benchmarks

O benchmark deve distinguir **capacidade de uma operação isolada** de **capacidade sob competição**. Por exemplo, projeção rápida em SQLite não valida 50 comunidades em background, e conexão bem-sucedida em LAN não valida NAT simétrico. Cada resultado deve publicar pelo menos uma execução nominal, uma execução no limite e uma execução com falha injetada.

Também é obrigatório medir o custo de checkpoint, garbage collection, flush, verificação Ed25519, replicação e mídia no mesmo processo. O valor médio não deve ser usado para aprovar uma meta definida em p95 ou p99. Se o teto for atingido apenas com uma configuração diferente da configuração de produção, o resultado é reprovação, não otimização futura.

## Failure tests prioritários

| Prioridade | Teste de falha | Ponto de injeção | Oráculo de correção |
|---:|---|---|---|
| **1** | Corrida de validação e projeção | Projetor pausado entre dois appends incompatíveis | Segunda operação é rejeitada antes do log; zero `projector.failed` |
| **2** | Crash antes/depois do append | `SIGKILL` antes do append, após append, antes do ACK e após ACK | Operação fica exatamente em estado entregue ou pendente reconciliável; nunca confirmada e perdida |
| **3** | Crash entre append e dedupe | Kill entre as duas persistências | Um `opId` produz no máximo um efeito lógico; boot reconstrói/reconcilia dedupe |
| **4** | Perda de energia simulada SQLite | WAL com `FULL`/`NORMAL`, flush bloqueado e kill | Nenhum item commitado de outbox/dedupe desaparece; diferença entre modos é documentada |
| **5** | Último uso de convite | Dez redeems simultâneos com `maxUses=1` e projetor parado | Exatamente um `member.join`; nove `E_INVITE_EXHAUSTED` |
| **6** | Prova de convite não criada pelo host | Criador não host gera convite e candidato resgata | Host valida sem segredo inexistente; sucesso legítimo em 100% |
| **7** | Poison record no projetor | Reducer lança; reiniciar e reprojetar | Comunidade não fica permanentemente degradada sem procedimento; registro e recovery são definidos |
| **8** | Apagar e reabrir view | Apagar `view.db`, interromper reprojeção, reiniciar | Comunidades, chaves, blobs e dump final são recuperáveis e idênticos |
| **9** | Crash do núcleo e reconexão IPC | Matar utility process durante request e evento | Renderer recebe novo canal, reconsulta, refaz subscriptions e não duplica escrita |
| **10** | Host offline e ACK perdido | Queda após append e antes da resposta; offline por mais de 72 h | Outbox consulta réplica antes de expirar; não reporta como falha algo já entregue |
| **11** | Peer/relay perdido | Derrubar pai e relay durante voz/tela/blob | Reparo/reconexão dentro do orçamento; falha nomeada sem corrupção de hash ou frame |
| **12** | NAT assimétrico | Bloquear uma direção e manter outra | Estado de cada par é independente; fallback e erro são observáveis, não silenciosos |
| **13** | Lock órfão e wipe | Matar main/núcleo em cada etapa e executar `identity.wipe` | Segunda instância não corrompe; instalação pode reabrir ou exibe erro recuperável |
| **14** | Versão incompatível | Mudar `opVersion`, schema e pacote nativo | Cliente fica somente leitura ou migra de forma definida; nunca escreve dado desconhecido |

## Acceptance criteria

Os critérios seguintes são gates de arquitetura. Um resultado parcial pode produzir uma decisão provisória, mas não autoriza implementar a parte dependente como se estivesse validada.

| Gate | Critério mínimo | Evidência obrigatória | Decisão se não passar |
|---|---|---|---|
| **G0 — Runtime** | Todos os addons e operações reais funcionam no artefato final em cada alvo suportado | Logs de build, hashes do artefato, execução automatizada e relatório por OS/arquitetura | Restringir plataformas, rebuild por alvo ou mudar para sidecar |
| **G1 — Estado autoritativo** | Nenhuma corrida legítima produz log venenoso ou projeção degradada | Harness de concorrência com projetor atrasado e 10 mil repetições por caso | Reabrir ADR-01 e o contrato de validação |
| **G2 — Reprojeção** | Apagar/recriar view preserva dados e recursos que a spec declara recuperáveis | Hash de dumps, manifesto de participação, teste de blobs e crash | Reabrir ADR-02; persistir manifesto ou separar dados locais |
| **G3 — Convites** | Convite delegado funciona; `maxUses=1` admite exatamente um candidato | Log, contagem autoritativa e 10 candidatos simultâneos | Reabrir ADR-09 e o protocolo de capabilities |
| **G4 — Persistência** | Nenhuma operação confirmada é perdida; retry não duplica | Crash matrix, `FULL/NORMAL`, reconciliação de outbox e dedupe | Reabrir ADR-11/12; separar DB ou alterar commit |
| **G5 — Blobs** | Ownership e caminho de escrita são executáveis, retomáveis e verificáveis | Hash, bytes por canal, throughput e host ocupado | Reespecificar blobs antes de anexos |
| **G6 — IPC** | Crash/restart e drop de evento convergem para query correta sem crescimento ilimitado | Teste de canal, heap profile e estado final | Formalizar protocolo de ack/sequence/resubscribe |
| **G7 — Rede** | NAT, reconexão e relay têm taxa e erros honestos | Matriz NAT, `netem`, logs de candidatos e sessões | Reabrir ADR-06/07/08; alterar promessa de conectividade |
| **G8 — Mídia** | Voz e tela atendem latência, perda, CPU, segurança e reparo | Capturas de métricas por sessão, relay e viewer | Cortar fallback/árvore ou adotar arquitetura alternativa |
| **G9 — Escala** | Os limites de §19 passam em carga nominal e no teto sem starvation | Benchmark reproduzível com percentis e dataset versionado | Recalibrar limites, scheduler ou topologia |
| **G10 — Segurança de identidade** | Chave não aparece em claro; lock e wipe são recuperáveis | Teste de filesystem, memória/IPC conforme aplicável e ciclo de crash | Restringir plataforma ou alterar a fronteira de confiança |

### Regra de aprovação composta

Uma ADR classificada como **POC REQUIRED** só passa quando todos os subcritérios funcionais, de falha e de rede associados forem aprovados. Um resultado de desempenho que passe, mas um resultado de durabilidade que falhe, é reprovação da decisão como um todo. Para ADRs classificadas como **BENCHMARK REQUIRED**, a decisão semântica pode permanecer, mas os limites de capacidade devem continuar provisórios até o benchmark passar.

## Architecture decisions that should remain frozen

“Frozen” aqui significa que a direção pode ser usada como contrato de escopo enquanto as provas de integração são executadas; não significa que toda implementação já esteja comprovada.

| Decisão | Por que pode permanecer congelada agora |
|---|---|
| **ADR-10 — tombstone como semântica de deleção** | É consequência direta de log append-only e reprojeção; precisa de teste, mas não há motivo experimental para trocar por truncamento antes de provar o comportamento de histórico. A UX deve declarar que bytes antigos permanecem no log. |
| **ADR-14 — presença/typing fora do log** | A separação semântica entre estado efêmero e domínio persistente é correta e reduz o risco de inflar o core. O que permanece aberto é o custo do fan-out, não a necessidade de registrar typing permanentemente. |
| **ADR-15 — não-lidas locais** | É uma decisão de escopo de dispositivo, facilmente isolável e coerente com a ausência de multi-dispositivo. Deve receber testes de watermark, mas não bloqueia a fundação. |
| **ADR-18 — sem push com app fechado no v1** | É explicitamente fora de escopo; não depende de uma propriedade emergente do runtime. |
| **Princípio de não usar HTTP/servidor central** | É restrição de produto e não uma meta de desempenho. As consequências de conectividade precisam ser honestas, mas a restrição pode permanecer congelada. |
| **Separação conceitual entre replicado, efêmero e local** | A classificação de estado é uma boa fronteira de domínio. O POC de reprojeção deve corrigir os itens mal classificados sem abandonar a separação. |

## Architecture decisions that should remain provisional until validation

| Decisão | Condição para deixar de ser provisória |
|---|---|
| **ADR-01 — autoridade única como solução de consistência** | POC-01 deve demonstrar validação contra estado autoritativo, não apenas ordem de append. |
| **ADR-02 — SQLite totalmente descartável** | POC-02 deve reconstruir participação, namespaces, `blobsKey` e recursos; caso contrário, a formulação precisa ser abandonada. |
| **ADR-03/04/20 — combinação Electron, nativos, utility process e lock** | POCs 03, 04 e 10 devem passar na matriz de artefatos e nos crashes. N-API não deve ser tratada como ABI universal. |
| **ADR-05/06/07/08 — mídia, ICE, UDX e relay** | POC-08 deve provar conectividade por socket, fallback de mídia e confidencialidade real; documentação de API não basta. |
| **ADR-09 — convite completo** | POC-05 deve provar convite delegado e consumo atômico; a entropia de 80 bits, isoladamente, não valida o sistema. |
| **ADR-11/12 — outbox e dedupe** | POC-07 deve eliminar perda confirmada e duplicata após crash, ACK perdido e reabertura. |
| **ADR-13 — limites de FTS5** | Benchmark de busca deve passar em dataset parcial e completo, inclusive diacríticos e filtros combinados. |
| **ADR-16 — replicação de background** | Benchmark multicomunidade deve provar que o requisito de badge não cria starvation, memória excessiva ou startup além do teto. |
| **ADR-17 — árvore calculada pelo host** | POC-09 deve mostrar reparo, latência e custo de relay; uma topologia calculada sem carga não é validação. |
| **Limites de §19 e §20** | Devem ser publicados como resultados medidos por ambiente. Até lá, 340 membros, 128 conexões, 200 espectadores, 8 GiB, 20 GiB, 500 ops/s efetivas e demais números são hipóteses. |
| **Caminho de escrita de blobs** | Deve permanecer explicitamente bloqueado até POC-06 resolver ownership, anúncio, persistência, resume e interação com RPC. |
| **Política de durabilidade SQLite** | `NORMAL`, `FULL`, DB separado ou PRAGMA transitório só pode ser escolhido após POC-07 e benchmark de fsync/checkpoint. |

## Ordem recomendada de execução antes do produto

A sequência mínima é: **POC-03 e POC-10** para fechar o runtime; **POC-01, POC-02 e POC-07** para fechar autoridade, persistência e recuperação; **POC-05 e POC-06** para fechar entrada e anexos; **POC-04** para fechar IPC; e finalmente **POC-08 e POC-09** para fechar rede e mídia. Os benchmarks de escala devem rodar em paralelo somente depois que os POCs estabeleçam uma semântica executável.

Nenhuma fase de implementação deve avançar por mera passagem de um POC de API. O artefato de cada gate deve conter código mínimo do harness, lockfile, configuração, dataset, logs brutos, resultados por cenário, versão do sistema operacional, critérios usados e uma decisão explícita: **confirmado, confirmado com limite alterado ou invalidado**.

## Referências

[1]: backend.md — Especificação Técnica do Backend, especialmente ADRs 01–20, §§ 10–11, 19–21 e 24–26.
[2]: auditoria-adversarial.md — Auditoria Adversarial de Arquitetura, achados F-01–F-50.
[3]: auditoria-sistemas-distribuidos.md — Auditoria de Sistemas Distribuídos e Confiabilidade, achados DS-01–DS-31.
[4]: dry-run-implementacao.md — Implementation Dry Run, gaps DR-01–DR-51.
[5]: relatorio-auditoria-adr.md — Auditoria adversarial de decisões tecnológicas, veredictos e agenda experimental.
[6]: rastreabilidade-ux-backend.md — Matriz de Rastreabilidade UX/UI ↔ Backend.
[7]: threat-model-seguranca.md — Threat Model de Segurança, ameaças T-01–T-48.
[8]: frontend.md — Especificação de UX/UI, premissas e limites de escopo.
