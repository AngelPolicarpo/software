# Especificação Técnica do Backend — Comunidade P2P — **v2**

> **Status normativo:** esta é a **única** fonte de verdade para a arquitetura e para a
> implementação do backend. Ela **substitui integralmente** `docs/backend.md` (v1), que
> passa a ser documento histórico.
>
> **Data:** 2026-08-17 · **Versão de protocolo:** `opVersion = 2` (emenda pós-G4;
> `opVersion = 1` foi o protocolo experimental anterior, sem migração de dado de produto)
>
> **Origem:** reescrita completa motivada pelo parecer `NOT APPROVED` do Architecture
> Review Board (`parecer-consolidado-do-architecture-review-board.md`) e pelos blockers
> B1–B10 lá consolidados. A disposição individual de cada um dos 195 achados
> (`F-01..F-50`, `DS-01..DS-31`, `DR-01..DR-51`, `T-01..T-48`, `RT-01..RT-15`) está em
> `docs/resolucao-arquitetural-v2.md`.
>
> **Documentos que acompanham este:**
>
> | Documento | Papel |
> |---|---|
> | `docs/adr-v2.md` | Registro de decisões arquiteturais v2 (ADR-A01..A28), com o mapa de substituição das ADR-01..20 de v1 |
> | `docs/plano-de-validacao-experimental-v2.md` | PoCs e benchmarks obrigatórios, com hipótese, critério de aprovação e consequência objetiva de falha |
> | `docs/deltas-ux-v2.md` | Mudanças de produto/UX exigidas por esta arquitetura, e a resolução dos 117 comportamentos da matriz de rastreabilidade |
> | `docs/resolucao-arquitetural-v2.md` | O que mudou, o que foi resolvido, o que virou risco aceito, o que continua `REQUIRES POC`, e o veredito final |
>
> **Regra de leitura:** onde este documento e qualquer outro discordarem, este vence para
> backend. Onde este documento for **omisso**, isso é buraco desta spec e deve ser
> levantado — **o implementador não decide arquitetura, contrato, consistência, segurança
> ou regra de negócio por conta própria.** Onde este documento marcar `REQUIRES POC`, a
> parte dependente **não pode ser implementada** antes do gate correspondente passar.

---

## 0. Como usar este documento

### 0.1 Escopo

Cobre tudo que roda fora do renderer React: o processo núcleo P2P, o log replicado, a
interpretação determinística desse log, a projeção local, o RPC entre pares, o transporte
de mídia, os jobs, a observabilidade e a configuração. Não cobre componentes de interface
— esses estão em `docs/frontend.md`, corrigido pelos deltas de `docs/deltas-ux-v2.md`.

### 0.2 Precedência entre documentos (v2)

1. **Este documento** — dado, regra, contrato, consistência, erro, segurança de backend.
2. **`docs/adr-v2.md`** — justificativa e status de cada decisão; se uma ADR e este
   documento discordarem no *conteúdo* da decisão, este documento vence e a ADR é bug.
3. **`docs/deltas-ux-v2.md`** — produto/UX, onde altera `docs/frontend.md`.
4. **`docs/frontend.md`** — produto/UX no que os deltas não tocam.
5. **`CLAUDE.md`** — intenção de produto.
6. **O código do frontend** — registro do que já foi validado na prática, **não** contrato.

`docs/backend.md` (v1) e as cinco auditorias são **história**. Não têm precedência nenhuma
e não devem ser citados como contrato.

### 0.3 O que "API" significa aqui

Não existe HTTP, servidor, porta escutando em `localhost` nem REST. Existem **três**
superfícies de chamada:

| Superfície | Quem chama | Quem atende | Transporte | Seção |
|---|---|---|---|---|
| **IPC-R** | renderer (React) | núcleo P2P | `MessagePort` sobre `MessageChannelMain` | §15 |
| **IPC-M** | Electron main ↔ núcleo | mútuo | `MessagePort` privado, **nunca compartilhado com o renderer** | §3.2 |
| **RPC P2P** | núcleo de um par | núcleo de outro par | `protomux-rpc` sobre stream Hyperswarm | §16 |

### 0.4 Convenções

| Convenção | Regra |
|---|---|
| Identificadores de entidade | `string` ASCII; formato fechado em §7.3. Chaves públicas são `bytes[32]`; no IPC viram hex minúsculo de 64 caracteres. |
| Tempo | epoch em **milissegundos UTC** (`uint64`). Nunca string, nunca fuso. |
| Tamanhos | bytes; base 1000 na apresentação, base 1024 nunca aparece na UI. |
| Nomes de campo | `camelCase` em IPC/RPC; `snake_case` em SQLite. O tradutor é o módulo `projector`. |
| Nomes de comando | `dominio.acao` (`message.send`). Nomes de evento: `dominio.fato` no passado. |
| Ausência | `undefined` nunca cruza fronteira. Campo opcional ausente é **omitido**; `null` significa "explicitamente vazio". |
| Ordenação canônica | `seq` do registro no log da comunidade (§7). Nenhum outro critério é canônico. |
| Texto | UTF-8. Limites em **bytes UTF-8**, salvo onde a tabela disser "code points" — escalares Unicode, nunca grafemas (§8.6). |
| `REQUIRES POC` | A decisão está tomada e escrita, mas **não pode ser implementada** antes do gate citado passar. |
| `LIMITAÇÃO DECLARADA` | Propriedade que o sistema **não** entrega, registrada aqui e obrigatoriamente comunicada na UI. |

---

## 1. O modelo arquitetural

Esta seção é a mudança conceitual de v1 para v2. Tudo no resto do documento decorre dela.
Ler primeiro.

### 1.1 O erro central de v1

Em v1, três coisas diferentes ocupavam o mesmo lugar sem contrato entre si:

- **Autoridade** (quem decide o que entra) — o host.
- **Validação** (o que é aceitável) — um pipeline que lia a projeção SQLite.
- **Interpretação** (o que o log significa) — reducers que podiam lançar exceção.

A projeção era assíncrona e em lote, então a validação decidia contra um estado atrasado; o
reducer, que recebia o resultado, podia lançar; e lançar parava a comunidade **em toda
réplica, deterministicamente e para sempre**. Uma corrida legítima entre `channel.delete` e
`message.send` — duas ações comuns — bastava para destruir a comunidade. Ao mesmo tempo, a
réplica só verificava assinatura: qualquer coisa que o host appendasse virava verdade,
inclusive envelope transplantado de outra comunidade.

### 1.2 A decisão de v2: Interpretação Determinística do Log (DLI)

> **O estado de uma comunidade é, por definição, `fold(log)`: uma função pura, total e
> determinística sobre a sequência de registros do log daquela comunidade.**
>
> **Toda** regra de autorização, hierarquia, associação, limite, cota, unicidade e
> integridade vive **dentro** dessa função. Não existe regra fora dela.

Consequências, todas normativas:

| Propriedade | Como decorre |
|---|---|
| **O host não é a fonte da verdade; ele é a fonte da ordem.** | O host escolhe *quais* registros entram e *em que ordem*. O que cada registro *significa* é decidido pela função, igual em todo nó. |
| **O host não consegue fabricar efeito não autorizado.** | Se o host appendar um registro que a função rejeita, a função rejeita em toda réplica — inclusive na dele. O ataque vira ruído contado no `seq`. |
| **Não existe registro venenoso.** | A função é **total**: definida para toda entrada, inclusive bytes hostis, `kind` desconhecido, referência a entidade inexistente. Ela nunca lança, nunca para. §8.5. |
| **Réplicas nunca divergem.** | Mesma entrada, mesma função, mesma saída. Divergência só é possível por bug, e o teste de §28.4 a detecta por hash de dump. |
| **A projeção SQLite é de fato descartável.** | Ela é a materialização de `fold(log)`. Apagar e refazer produz o mesmo byte. §10.5. |
| **A corrida validação↔projeção deixa de existir.** | A validação do host roda contra o **Estado de Decisão** em memória, avançado no mesmo ponto crítico do append. A projeção é consumidora pura, nunca consultada por decisão. §8.2. |

### 1.3 As três classes de estado (fronteira inviolável)

| Classe | Onde vive | Quem escreve | Sobrevive a | Exemplos |
|---|---|---|---|---|
| **Estado de Decisão** (`DS`) | memória de todo nó, com snapshot em `view.db` | só o `fold` | reprojeção (é recomputado) | membros, cargos, permissões efetivas, metadados de canal, bans, timeouts, contadores de convite, `lastAuthorSeq`, cotas |
| **Estado de Conteúdo** (`CS`) | `view.db` (SQLite + FTS5) | só o `projector`, aplicando os efeitos que o `fold` emitiu | reprojeção (é recomputado) | mensagens, reações, anexos, log de auditoria, threads, links |
| **Estado Local** (`LS`) | `manifest.db` (SQLite, `synchronous=FULL`) | módulos locais | **tudo**, inclusive reprojeção e mudança de schema de `view.db` | participação em comunidades, sementes/chaves, outbox, não-lidas, preferências, consentimentos, cache de blobs, contador `authorSeq` |

**Regras que o build precisa garantir (lint de fronteira por diretório):**

1. O `fold` **nunca** lê `view.db` nem `manifest.db`. Ele recebe `DS` como argumento.
2. O `fold` **nunca** lê configuração de ambiente. Ver §1.5.
3. Nenhum módulo além do `projector` escreve em tabela de `CS`.
4. Nenhuma decisão de autorização, unicidade ou limite acontece fora do `fold`.
5. `manifest.db` e `view.db` são **arquivos separados**, com PRAGMAs separados (§10.4).

Confundir as três classes é o erro mais caro possível neste projeto. `muted` de canal é
`LS`; `readOnlyForRoleIds` do mesmo canal é `DS`; o texto da mensagem é `CS`.

### 1.4 O que o host pode e o que não pode (v2)

| O host **pode** | O host **não pode** |
|---|---|
| Omitir uma op que recebeu (censura por omissão) | Fabricar autoria: a assinatura do autor é verificada por toda réplica |
| Escolher a ordem de append | Fazer valer um efeito que o `fold` rejeita |
| Carimbar `hostTs` | Carimbar `hostTs` retroativo abaixo do registro anterior (o `fold` clampa, §8.3) |
| Truncar o próprio core (detectável) | Transplantar envelope de outra comunidade (o `communityId` está dentro do material assinado, §7.1) |
| Recusar conexão e aplicar rate limit | Silenciar seletivamente sem que o cliente perceba: `E_RATE_LIMITED` e `E_HOST_UNAVAILABLE` são estados distintos e visíveis (§20, delta de UX) |

**LIMITAÇÃO DECLARADA (L-1):** censura por omissão e truncamento são **detectáveis, não
impedíveis**. §25.6 define a detecção e a superfície de UI.

### 1.5 Constantes de protocolo × configuração operacional

Em v1, limites usados na validação estavam em variáveis de ambiente. Isso tornava a
interpretação do log função do ambiente local — duas réplicas com configuração diferente
divergiriam. v2 separa:

| Categoria | Regra |
|---|---|
| **Constantes de protocolo** (§27.1) | Fazem parte de `opVersion`. **Fixas no binário**, não configuráveis por env, arquivo ou flag. Mudar qualquer uma exige bump de `opVersion`. Toda entrada do `fold` sai daqui. |
| **Configuração operacional** (§27.2) | Local, sem efeito nenhum sobre a interpretação do log. Caminhos, verbosidade, tetos de recurso local, janelas de retry, orçamentos de conexão. |

**Nenhum valor pode estar nas duas listas.** Se um número influencia se uma op tem efeito,
ele é constante de protocolo. Fim da discussão.

---

## 2. Decisões de arquitetura

O registro completo, com contexto, alternativas descartadas, status e mapa de substituição
das ADRs de v1, está em **`docs/adr-v2.md`**. Resumo de uma linha por decisão, para
orientação:

| # | Decisão | Status |
|---|---|---|
| **A01** | Um Hypercore por comunidade, appendado só pelo host; o host dá **ordem**, não verdade | Aceita |
| **A02** | **Interpretação Determinística do Log (DLI)**: estado = `fold(log)`, função pura e total, com autorização dentro | Aceita — é a decisão-raiz de v2 |
| **A03** | **Dois bancos**: `manifest.db` (`FULL`, autoritativo local, nunca descartável) e `view.db` (`NORMAL`, derivado, descartável) | Aceita |
| **A04** | Estado de Decisão em memória, avançado no mesmo ponto crítico do append; projeção é consumidora pura | Aceita |
| **A05** | Idempotência por `(author, sequenceScope, authorSeq)` monotônico assinado — sem janela de dedupe | Aceita, emendada pós-G4 |
| **A06** | Barreira de durabilidade: ACK só depois de o append estar commitado (§10.7.1); outbox só libera ao **observar a própria réplica** | Aceita |
| **A07** | `communityId` dentro do material assinado; `hostTs`/`flags` num `HostRecord` assinado pelo host | Aceita |
| **A08** | Convite = par de chaves derivado do segredo; o host valida com a **chave pública** que está no log | Aceita |
| **A09** | Anexos em **core de blobs por autor**, anunciado no log | Aceita |
| **A10** | Ordenação de cargos por **chave fracionária esparsa**, sem renumeração | Aceita |
| **A11** | `reaction.set{present}` idempotente no lugar de `reaction.toggle` | Aceita |
| **A12** | Autorização de replicação por comunidade: replicar exige ser membro não banido | Aceita |
| **A13** | Fronteira da chave: geração e assinatura **só no núcleo**; `safeStorage` como oráculo de wrap/unwrap | Aceita |
| **A14** | IPC com `epoch`, `subId`, `evSeq`, ack de janela, resync e classes de autorização de comando | Aceita |
| **A15** | Caminho de anexo por **ticket emitido pelo main** após diálogo do SO; renderer nunca fornece caminho | Aceita |
| **A16** | Electron + `utilityProcess` + `better-sqlite3`, com matriz de plataforma **fechada** e rebuild por alvo obrigatório | Aceita, **condicionada a G0** |
| **A17** | Voz e câmera: WebRTC no renderer, com **STUN/TURN servidos pelo host da comunidade** | Aceita, **REQUIRES POC** (G7/G8) |
| **A18** | ADR-06/07 de v1 (candidato ICE via DHT; UDX como fallback de voz) **revogadas** | Revogada |
| **A19** | Compartilhamento de tela no v1 é **estrela WebRTC com teto de 8 espectadores** | Aceita |
| **A20** | Árvore de multicast de tela **especificada e adiada** para além do v1, bloqueada por POC-09 | Adiada, **REQUIRES POC** |
| **A21** | Relay voluntário retransmite **TURN/SRTP opaco**, com prova de posse, TTL e cota | Aceita, **REQUIRES POC** |
| **A22** | Autorização de mídia por **ticket assinado pelo host**; ban/kick revogam tickets | Aceita |
| **A23** | Sucessão de host por **escrow de semente + migração para core novo** | Aceita |
| **A24** | Backup/exportação de identidade protegida por frase secreta | Aceita — **muda a premissa 3 da UX** |
| **A25** | Toda operação de domínio de mensagem é **assíncrona por contrato** (outbox); estrutura/moderação é síncrona e não enfileira | Aceita — **muda o eixo otimista da UX** |
| **A26** | Tombstone continua sendo a semântica de deleção | Aceita (herda ADR-10) |
| **A27** | Presença/digitando efêmeros, com agregação e assinatura por interesse | Aceita, **BENCHMARK REQUIRED** |
| **A28** | Não-lidas e menções calculadas localmente, por watermark, com estado por canal **e por thread** | Aceita |

---

## 3. Topologia de execução e fronteiras

### 3.1 Processos e canais

```
┌─ Electron main ───────────────────────────────────────────────────────┐
│ janela · ciclo de vida · deep links (parse + validação, §3.5)         │
│ safeStorage (wrap/unwrap do Data Key, §5.4)                           │
│ dialog.showOpenDialog → emite ticket de anexo (§13.3)                 │
│ setDisplayMediaRequestHandler (só depois de autorização do host, §17) │
│ shell.openPath (só com allowlist de tipo, §13.6)                      │
│ confirmação nativa para comandos destrutivos (§15.3)                  │
│ cria os DOIS MessageChannelMain e cruza as portas                     │
└───────┬──────────────────────────────────────┬────────────────────────┘
        │ IPC-M (privado, nunca ao renderer)   │ (só entrega a porta)
┌───────▼──────────────────────────┐  ┌────────▼───────────────────────┐
│  NÚCLEO P2P (utilityProcess)     │  │ RENDERER (React, sandbox)      │
│  identity (Ed25519) · fold       │◀▶│  WebRTC (voz/câmera/tela)      │
│  corestore · hypercore · swarm   │  │  stores Zustand → cliente IPC  │
│  hyperblobs (próprio + de pares) │  │  captura, codec, decode        │
│  protomux(-rpc) · udx            │  │                                │
│  better-sqlite3 × 2 (manifest,   │  │                                │
│  view+FTS5) · outbox · projector │  │                                │
│  STUN/TURN comunitário (§17.3)   │  │                                │
└──────────────────────────────────┘  └────────────────────────────────┘
                    ▲  IPC-R (MessagePort direto)  ▲
                    └──────────────────────────────┘
```

**Por que o main não fica no meio do IPC-R:** custo de duas cópias e um salto de event loop
no processo que desenha a janela. O main cria os canais e sai do caminho de dado.

**Por que existe um IPC-M separado:** o canal main↔núcleo carrega material sensível (Data
Key, tickets de anexo, tokens de confirmação). Ele **nunca** é transferido ao renderer e
**nunca** transporta payload de domínio.

### 3.2 Fronteira da chave privada — declaração honesta

v1 afirmava "a chave privada nunca cruza o IPC" e ao mesmo tempo exigia que o main a
decifrasse. As duas coisas não cabem juntas. v2 decide e declara:

1. **A chave privada de identidade é gerada dentro do núcleo** e nunca sai dele em claro,
   exceto no passo 3 abaixo, na direção oposta.
2. O núcleo cifra a chave com uma **Data Key** simétrica de 32 bytes (XChaCha20-Poly1305).
3. A **Data Key** — e só ela — atravessa o IPC-M para ser embrulhada/desembrulhada por
   `safeStorage` no main. `safeStorage.encryptString(base64(dataKey))` no primeiro boot;
   `decryptString` nos seguintes. O main **nunca** vê a chave de identidade.
4. Os dois lados zeram o `Buffer` da Data Key (`buf.fill(0)`) imediatamente após o uso, e
   no shutdown.
5. **Nenhum comando IPC-R devolve, deriva ou expõe material de chave**, em nenhuma forma,
   nem truncado, nem em erro, nem em log.
6. A mesma Data Key protege as **sementes de comunidade** (§5.3), o que dá à chave de
   escrita do core exatamente a mesma proteção que a identidade tem.

**LIMITAÇÃO DECLARADA (L-2):** `safeStorage` não protege contra outro processo do **mesmo
usuário** já em execução, nem contra memória do processo. No Linux o Electron cai para
`basic_text` — que **não protege nada** — tanto **sem serviço de secret** quanto **quando
não reconhece o ambiente de desktop**; só o probe de backend de A13(5) distingue os dois
casos, e é `isEncryptionAvailable()`, não o nome do backend, que decide. v2 trata o
degradado **confirmado pelo probe** como modo explícito: o núcleo recusa abrir
(`E_KEYSTORE_INSECURE`) salvo se o usuário aceitar o modo inseguro numa tela dedicada, e a
UI passa a exibir um indicador permanente. Não é equivalente a proteção. Medido em G10.

### 3.3 Ciclo de vida do núcleo

| Fase | O que acontece | Falha e reação |
|---|---|---|
| `boot` | Adquire o lock composto (§10.8). Abre `manifest.db`, aplica migrações **de dado** (§10.2.1). | Lock ocupado → `E_CORE_ALREADY_RUNNING`, encerra. `manifest.db` à frente do binário → `E_SCHEMA_AHEAD`, encerra. |
| `wipe-resume` | Se `manifest.wipe_state` ≠ `none`, retoma a limpeza de §18.6 do ponto onde parou. | Falha → `E_WIPE_INCOMPLETE` com estado nomeado e caminho de retentativa. |
| `identity` | Pede unwrap da Data Key ao main; decifra a chave. Sem identidade → `awaiting-identity`, só aceita `identity.create` e `identity.import`. | Sem secret store → §3.2 item L-2. |
| `view` | Abre `view.db`; se `schema_version` ≠ binário, agenda reprojeção total (§10.5). | `view.db` corrompido → apaga e reprojeta; é derivado. |
| `open` | Para cada comunidade **listada em `manifest.communities`**: abre o core pela chave gravada, carrega o snapshot de `DS` e recompõe o `fold` até `core.length`. | Core ilegível → `degraded` só naquela comunidade; as outras seguem. |
| `swarm` | `join` do tópico de cada comunidade participada e dos cores de blobs referenciados por anexos abertos localmente (§13.4). | Bootstrap inalcançável → `swarm.degraded`, backoff (§22.3). |
| `reconcile` | Reconciliação da outbox (§11.6) e do staging de blobs (§13.5). | — |
| `ready` | Emite `core.ready`. Escritas aceitas. Jobs periódicos começam. | — |
| `host-mode` | Para cada comunidade hospedada: sobe `rpcServer`, roster, serviço STUN/TURN (§17.3). | Indisponível → `hosting-degraded`: replica leitura, recusa ops com `E_HOST_UNAVAILABLE`. |
| `draining` | `core.shutdown`: para de aceitar ops, aplica a barreira de replicação de §18.7, **fecha** cada core (o append já commitou — §10.7.1; o que falta é liberar o armazenamento), `wal_checkpoint(TRUNCATE)` nos dois bancos. | Estouro do orçamento → `shutdown.forced` com contagem, encerra. |
| `stopped` | Libera o lock. | — |

**Crash do núcleo:** o main reinicia até 3 vezes em 60 s (backoff 1 s / 4 s / 10 s), cada
reinício incrementando o `epoch` do IPC (§15.1). Na quarta falha, erro terminal e não
reinicia mais. O renderer trata cada `epoch` novo pelo procedimento de §15.2.

### 3.4 Regras de fronteira (invioláveis)

1. **O renderer nunca toca disco nem rede para dado de domínio.** Sem `fetch`, sem `fs`,
   sem socket próprio. Exceções, e são só estas duas, ambas declaradas: (a) o
   `RTCPeerConnection` de mídia, que por definição abre socket; (b) a captura e o
   *decode* de mídia. Nenhuma delas transporta dado replicado.
2. **O núcleo nunca formata texto de interface.** Devolve código de erro e dado
   estruturado. Não há exceção: a "mensagem de sistema" de v1 foi removida (§18.7).
3. **O núcleo devolve permissões efetivas; a UI decide o que esconder.** Esconder nunca é
   enforcement.
4. **Nenhum estado de domínio vive no renderer.** As stores guardam estado de sessão de
   interface e um cache de leitura invalidado por evento.
5. **O renderer nunca recebe caminho de arquivo do usuário, nem fornece um.** §13.3.

### 3.5 Deep links

Rota de protocolo `comunidadep2p://`. **Gramática fechada, tudo fora dela é recusado sem
processamento:**

```
comunidadep2p://join/<CODE16>                  CODE16 = 16 chars Crockford Base32
comunidadep2p://m/<MSGREF>                     MSGREF = base64url, 64 bytes exatos (§15.6)
```

Regras normativas:

1. O **main** faz o parse e a validação sintática. Uma URL que não case exatamente com a
   gramática é descartada com log `deeplink.rejected` e **nada** é encaminhado.
2. O main encaminha ao núcleo **dado estruturado já parseado** (`{route:'join', code}`),
   nunca a string original.
3. Deep link **nunca dispara ação**: ele só posiciona a UI numa tela de confirmação. Entrar
   numa comunidade sempre exige um clique explícito depois do preview.
4. Com o app já aberto, `second-instance` encaminha à instância viva
   (`requestSingleInstanceLock`); o lock de dado (§10.8) e o lock de instância são
   **checados na mesma ordem em todo caminho**: instância primeiro, dado depois.
5. No Linux o handler só funciona com o app empacotado. Fora disso a rota é
   inexistente e a UI oferece colar o código. `REQUIRES POC` — G0.

---

## 4. Módulos e camadas

Quatro camadas. Uma camada só importa das camadas abaixo. Importação lateral só onde a
tabela declarar. Violação **quebra o build** (regra de lint com fronteira por diretório).

**Quando L2 precisa falar rede, quem depende de quem (fecha `HOLE-18`).** `communityHost` e
`outbox` precisam de transporte RPC, mas `rpcServer`/`rpcClient` são L3 e já dependem de L2 —
declarar a dependência nos dois sentidos seria ciclo, e contradiria a regra de precedência
acima. A direção é **sempre L3 → L2**: o módulo de L2 declara a **porta** de que precisa
(interface própria, sem tipo de transporte), L3 a implementa, e quem monta o grafo injeta a
implementação no boot. Nenhuma linha da tabela abaixo cria dependência de L2 para L3.

```
L3  fronteira      ipcRenderer · ipcMain · rpcServer · rpcClient · mediaBridge
L2  aplicação      communityHost · communityClient · outbox · invites · presence
                   voiceCoordinator · shareStar · relay · search · blobs · diagnostics
                   succession
L1  domínio        fold (decisionState + admission + effects) · opCodec · permissions
                   idgen · errors
L0  infra          identity · keystore · manifest(SQLite) · view(SQLite) · corestore
                   swarm · logger · config · clock · metrics
```

| Módulo | Camada | Responsabilidade | Depende de | **Não pode** |
|---|---|---|---|---|
| `config` | L0 | Resolver e congelar a **configuração operacional** (§27.2) no boot | — | Expor qualquer valor ao `fold`; ser hot-reload |
| `clock` | L0 | Única fonte de "agora", injetável | — | Ser lido pelo `fold` (o `fold` usa `hostTs` do registro) |
| `logger` | L0 | NDJSON com **allowlist** de campos (§24.2) | `config` | Registrar conteúdo, segredo, caminho de arquivo do usuário ou material de chave |
| `metrics` | L0 | Contadores/histogramas em memória | `clock` | Persistir |
| `keystore` | L0 | Ponte IPC-M para wrap/unwrap da Data Key | — | Ver a chave de identidade |
| `identity` | L0 | Par Ed25519, assinatura, verificação, export/import (§5.5) | `keystore` | Expor material privado por IPC-R, log ou erro |
| `manifest` | L0 | `manifest.db`: abre, migra **preservando dado**, transação | `config` | Conter regra de domínio |
| `view` | L0 | `view.db`: abre, **recria** no bump de schema, transação | `config` | Conter regra de domínio |
| `corestore` | L0 | Ciclo de vida dos cores, **namespaces determinísticos** (§5.3) | `config`, `manifest` | Decidir o que appendar |
| `swarm` | L0 | Um `Hyperswarm`; join/leave; orçamento de conexão (§14.4) | `config` | Interpretar payload |
| `errors` | L1 | Taxonomia fechada (§20) | — | Conter texto em português |
| `opCodec` | L1 | Encode/decode de `Op`, `Envelope`, `HostRecord` por versão; forma canônica; **verificação de assinatura** sobre material que ele mesmo constrói (§7.1) | — | Validar semântica |
| `idgen` | L1 | Derivação determinística de todo id de entidade (§7.3) | — | Usar aleatoriedade ou relógio |
| `permissions` | L1 | Permissão efetiva e hierarquia — função pura sobre `DS` | — | Ler banco |
| `fold` | L1 | **A interpretação normativa**: `DS`, admissão, efeitos (§8) | `opCodec`, `permissions`, `idgen`, `errors` | Fazer I/O, ler relógio, ler configuração, lançar exceção |
| `projector` | L1→L0 | Aplicar os efeitos que o `fold` emitiu em `view.db`, em transação | `fold`, `opCodec`, `view`, `corestore` | Decidir qualquer coisa; **decodificar registro**; emitir evento IPC direto |
| `communityHost` | L2 | Autoridade de ordem: fila de admissão, append, `DS` de host, roster, STUN/TURN | `fold`, `corestore` · **porta** de servidor RPC, implementada por `rpcServer` | Existir quando não hospeda; **importar `rpcServer`** |
| `communityClient` | L2 | Replicar, rodar `fold`+`projector`, enviar ops, emitir eventos | `swarm`, `corestore`, `projector`, `outbox` | Appendar no core |
| `outbox` | L2 | Fila durável, backoff, reconciliação (§11) | `manifest` · **porta** de cliente RPC, implementada por `rpcClient` | Reordenar ops do mesmo canal; **importar `rpcClient`** |
| `invites` | L2 | Emitir, anunciar, resolver, resgatar (§12) | `swarm`, `identity`, `communityHost` | Vazar dado de comunidade para banido além do previsto em §12.5 |
| `blobs` | L2 | Core de blobs próprio, staging, download, seeding, GC (§13) | `corestore`, `swarm`, `manifest` | Aceitar caminho vindo do renderer |
| `presence` | L2 | Presença, digitando, roster — efêmeros, com assinatura por interesse (§17.6) | `swarm`, `clock` | Persistir |
| `voiceCoordinator` | L2 | Roster de voz, **tickets de sessão**, revogação (§17.4) | `communityHost`/`Client`, `permissions` | Ver mídia |
| `shareStar` | L2 | Sessão de tela em estrela, autorização, qualidade por espectador (§17.5) | `voiceCoordinator` | Rodar fora do host para autorização |
| `relay` | L2 | Voluntariado TURN: prova de posse, TTL, cota (§17.7) | `swarm`, `config` | Ligar sem consentimento persistido |
| `succession` | L2 | Escrow, detecção de inatividade, migração de comunidade (§18.8) | `corestore`, `identity`, `fold`, `opCodec`, `idgen`, `permissions` | Assumir host sem o grace period |
| `search` | L2 | FTS5 sobre `CS` (§23) | `view` | Consultar a rede |
| `diagnostics` | L2 | NAT, peers, snapshot de métricas | `swarm`, `metrics` | Bloquear o event loop |
| `mediaBridge` | L3 | Ponte de chunks renderer↔núcleo (só usada pela árvore adiada, §17.8) | `swarm` | Inspecionar payload |
| `rpcServer` / `rpcClient` | L3 | Transporte e tradução de erro | L2 | Conter regra de negócio |
| `ipcRenderer` / `ipcMain` | L3 | Roteamento, autorização de comando, forma da fronteira | L2 | Conter regra de negócio |

**Onde mora o `verify` de Ed25519 (fecha `A-06`).** Os estágios 1 e 4 de §8.2 exigem
verificar assinatura, e o `fold` tem exatamente quatro dependências — nenhuma delas é
`identity`, que é L0 e cuja "verificação" a tabela acima nomeia. A operação fica em
`opCodec`: ele **já** constrói o material assinável de §7.1 (`opSigningHash`,
`hostRecordSigningHash`), e conferir uma curva sobre bytes dados não é "validar semântica" —
é a outra metade do mesmo codec. A alternativa, acrescentar `identity` às dependências do
`fold`, criaria uma aresta L1 → L0 que esta tabela não declara e que faria o módulo mais puro
do sistema depender de infra.

**`opCodec` no `projector`, e só a constante.** A importação lateral existe por um motivo
único: `meta.op_version` (§10.3.1) precisa de escritor, e o único escritor de `view.db` é o
`projector` (§21.1) — `view` é L0 e não pode importar L1. O que o `projector` pode tirar de
`opCodec` é a **constante** `OP_VERSION`; decodificar registro continua proibido, e é por isso
que `kind`/`author` de `rejected_records` e de `fold.panic` chegam pelo `FoldResult` (§8.0).
Sem a linha, a alternativa seria reexportar a constante pelo `fold` — o que esconderia a
aresta em vez de declará-la, contra a regra desta seção.

**Regra de teste que a divisão existe para permitir:** `fold`, `opCodec`, `permissions` e
`idgen` são **puros**. Se um deles precisar de mock de rede, relógio ou banco para ser
testado, a fronteira foi violada. É o que torna §28.1 e §28.4 possíveis.

---

## 5. Identidade, chaves e criptografia

### 5.1 Primitivas

| Uso | Primitiva | Biblioteca |
|---|---|---|
| Identidade e assinatura de op | Ed25519 | `hypercore-crypto` / `sodium-native` |
| Assinatura de `HostRecord` | Ed25519 (chave do core) | `hypercore-crypto` |
| Hash de op, convite, anexo, id | BLAKE2b-256 (128 para id) | `sodium-native` |
| Cifra simétrica em repouso | XChaCha20-Poly1305 | `sodium-native` |
| Derivação de chave por frase secreta | Argon2id (`crypto_pwhash`, `MODERATE`) | `sodium-native` |
| Cifra para um destinatário (escrow, chave de sessão de tela) | `crypto_box_seal` sobre X25519 convertido da Ed25519 | `sodium-native` |
| Transporte P2P | Noise (`hyperdht`), `remotePublicKey` verificada | `hyperdht` |
| Mídia | DTLS-SRTP (WebRTC) — ponta a ponta entre pares | navegador |
| Aleatoriedade | `sodium.randombytes_buf` — **nunca** `Math.random` | `sodium-native` |

### 5.2 Separação de domínio (tabela fechada e autoritativa)

Todo hash e toda derivação usam prefixo de string. Reaproveitar um prefixo em dois
contextos é bug de segurança.

| Prefixo | Entrada | Saída |
|---|---|---|
| `'op/1'` | material assinável da `Op` (§7.1) | hash assinado pelo autor |
| `'hostrec/1'` | material assinável do `HostRecord` (§7.1) | hash assinado pelo host |
| `'opid/1'` | envelope canônico | `opId` (32 B) — correlação de cliente |
| `'id/<entidade>/2'` | `communityId ‖ sequenceScope ‖ authorKey ‖ authorSeq` | id de entidade (16 B) — §7.3 |
| `'ns/log/1'` / `'ns/blobs/1'` | `communitySeed` | semente de par de chaves do core |
| `'ns/memberblobs/1'` | `identitySeed ‖ communityId` | semente do core de blobs do membro |
| `'invite-seed/1'` | `inviteSecret` (10 B) | semente do par de chaves do convite |
| `'invite-topic/1'` | `invitePublicKey` | tópico DHT do convite |
| `'invite-auth/1'` | `invitePk ‖ hostPk ‖ candidatePk ‖ challenge` | prova viva (RPC) |
| `'invite-join/1'` | `communityId ‖ invitePk ‖ candidatePk` | prova de adesão (no log, verificável para sempre) |
| `'relay-possession/1'` | `relayPublicKey` | prova de posse do relay (R-19) — fecha `A-05` |
| `'blob-hash/1'` | conteúdo do arquivo | hash do anexo |
| `'media-ticket/1'` | `sessionId ‖ channelId ‖ peerA ‖ peerB ‖ expiresAt` | ticket de mídia assinado pelo host |
| `'turn-cred/1'` | `sessionId ‖ peerKey ‖ expiresAt` | credencial TURN de curta duração |
| `'share-key/1'` | (aleatório por sessão) | chave AEAD de sessão de tela (§17.8) |
| `'escrow/1'` | `communitySeed` | payload cifrado ao sucessor (§18.8) |
| `'assume/1'` | `newCommunityId ‖ originFinalSeq` | prova de sucessão, assinada com a chave do core de origem (§18.8) |
| `'identity-export/1'` | `identitySeed` | payload de backup (§5.5) |

### 5.3 Semente de comunidade e namespaces determinísticos

v1 usava `corestore.namespace(random)`, que não é recuperável. v2:

1. Ao criar uma comunidade, o núcleo gera `communitySeed` = 32 bytes aleatórios.
2. **Grava `communitySeed` cifrado (Data Key) em `manifest.communities` com
   `synchronous=FULL`, antes de criar qualquer core.** Se o processo morrer aqui, nada foi
   criado e a linha órfã é limpa no boot.
3. Deriva:
   - `logKeyPair = keyPairFromSeed(BLAKE2b('ns/log/1' ‖ communitySeed))`
   - `blobsKeyPair = keyPairFromSeed(BLAKE2b('ns/blobs/1' ‖ communitySeed))`
   - `communityId = hex(logKeyPair.publicKey)`
4. `blobsPublicKey` entra **no payload assinado de `community.create`** (§7.4) — portanto é
   dado do log, recuperável por toda réplica, para sempre. Isso é o que mata a
   irrecuperabilidade de `blobsKey` que reprovou a ADR-02 de v1.
5. Cores são abertos por chave explícita (`corestore.get({keyPair})` no host,
   `corestore.get({key})` no membro), **nunca** por namespace aleatório.

Para um membro que entra por convite, `coreKey` vem do resgate (§12.4) e é gravado no
manifesto na mesma transação em que a participação é registrada.

### 5.4 Data Key

`dataKey` = 32 bytes aleatórios, gerados no primeiro boot, embrulhados por `safeStorage`
via IPC-M e gravados em `manifest.secrets`. Protege: `identitySeed`, todo `communitySeed`,
todo `escrowSeed`. Rotação: fora de escopo do v1 (`LIMITAÇÃO DECLARADA L-3`).

### 5.5 Backup e restauração de identidade

**Muda a premissa 3 da spec de UX** (registrado em `deltas-ux-v2.md`, delta U-01).
Motivo: sem isso, perder a máquina é perder permanentemente toda comunidade hospedada, o
que o ARB classificou como limitação de produto não aceita (T-43).

| Comando | Comportamento |
|---|---|
| `identity.export{passphrase}` | Deriva `kek = Argon2id(passphrase, salt, MODERATE)`; devolve um blob `identity-export/1` contendo `identitySeed`, `displayName`, `avatarColor` e a lista de `{communityId, coreKey, blobsKey, communitySeed?}` das comunidades participadas. `communitySeed` só entra para comunidades hospedadas. O main grava o arquivo por `dialog.showSaveDialog`; o blob **nunca** passa pelo renderer. |
| `identity.import{ticket, passphrase}` | Só em instalação **sem** identidade. Deriva a chave, decifra, recria o manifesto e reabre os cores. |

**LIMITAÇÃO DECLARADA (L-4):** o backup não é multi-dispositivo. Se duas instalações
usarem a mesma identidade e **hospedarem a mesma comunidade**, os dois escritores produzem
um fork do Hypercore. O núcleo **detecta** o fork (bloco conflitante ao replicar), marca a
comunidade `forked`, **para de appendar** e exige resolução manual (§18.9). Não há merge
automático. Frase secreta perdida = backup perdido; não há recuperação.

---

## 6. Modelo de domínio

### 6.0 Convenções das fichas

Legenda de obrigatoriedade: `req` obrigatório · `opt` opcional · `der` derivado pelo `fold`
(nunca vem em op) · `host` escrito pelo host no `HostRecord` · `local` só na instalação de
quem lê, nunca trafega.

### 6.1 Identity

**Responsabilidade:** provar autoria. É a única credencial do produto.

| Atributo | Tipo | Obrig. | Regra |
|---|---|---|---|
| `publicKey` | `bytes[32]` | req | Ed25519. **É o id global da pessoa.** |
| `secretKey` | `bytes[64]` | req | Nunca sai do núcleo (§3.2) |
| `displayName` | `string` | req | 2–32 code points após `trim` |
| `avatarColor` | `enum` | req | `role-gold = 0 · role-blue = 1 · role-green = 2 · role-red = 3 · role-purple = 4 · role-pink = 5 · role-neutral = 6 · accent = 7`. Ver **§6.4.2** |
| `handle` | `string` | der | `@` + 8 caracteres Crockford-Base32 minúsculos da `publicKey`, exibidos em 2 grupos de 4 (`@k3f9-2mqa`). **Não é único.** |
| `presence` | `enum` | local | `online · idle · dnd · invisible`. `offline` nunca é escrito. |
| `createdAt` | `ms` | req | — |

**Restrições:** no máximo uma Identity por instalação. `displayName` não tem unicidade —
não existe namespace global em P2P.

**LIMITAÇÃO DECLARADA (L-5) — personificação:** com nome livre e `handle` de 40 bits,
personificação é possível. Mitigações normativas: (a) o `handle` é exibido **junto** do
nome em perfil, log de moderação, lista de banidos e preview de convite; (b) o `fold`
marca `displayNameCollision = true` em todo membro cujo `displayName` normalizado
(NFKC + casefold + colapso de espaço) coincida com o de outro membro **ativo** da mesma
comunidade, e a UI é obrigada a mostrar o aviso. Não há bloqueio de nome duplicado.

**Ciclo:** `(nenhuma) → identity.create|identity.import → active → identity.wipe → (nenhuma)`.

**Operações:** `identity.create`, `identity.update`, `identity.setPresence` (efêmera),
`identity.export`, `identity.import`, `identity.wipe`.

### 6.2 Community

| Atributo | Tipo | Obrig. | Regra |
|---|---|---|---|
| `id` | `string` | der | hex64 da chave pública do core do log |
| `coreKey` | `bytes[32]` | der | = `id` |
| `blobsKey` | `bytes[32]` | req | **Payload de `community.create`** — dado do log (§5.3) |
| `hostKey` | `bytes[32]` | der | Chave pública do host **corrente**; muda por `community.assumeHost` (§18.8) |
| `originCommunityId` | `string` | opt | Presente quando a comunidade é continuação de outra (§18.8) |
| `name` | `string` | req | 2–40 code points |
| `iconEmoji` | `string` | opt | 1–8 code points, ≤ 32 bytes |
| `iconColor` | `enum` | req | Mesmo conjunto de `avatarColor`: `0..7` (§6.4.2) |
| `description` | `string` | opt | ≤ 120 code points |
| `createdAt` | `ms` | host | `hostTs` do registro `seq=0` |
| `memberCount` | `int` | der | Membros ativos não banidos |
| `endedAt` | `ms` | der | `community.end` |
| `successorKeys` | `bytes[32][]` | der | Ordem = prioridade (§18.8). Máx. 5 |
| `isHostedByMe` | `bool` | local | `hostKey === identity.publicKey` |
| `lastHostSeenAt` | `ms` | local | Alimenta "Inativa há muito tempo" |

**Restrições:**
- Toda comunidade nasce com 1 categoria (`GERAL`), 1 canal de texto (`#geral`), 2 cargos
  (Fundador e cargo base `Membro`) e 1 membro (o host, com Fundador). Isso é o **lote de
  gênese**, appendado como uma única chamada `core.append([...])` (§19.1).
- Nunca fica sem canal (§8.3, regra R-7).
- Nome duplicado entre comunidades é permitido.
- Comunidade `ended` não aceita op nenhuma; o core fica em leitura.

**Operações:** `community.create`, `community.update`, `community.end`,
`community.setSuccessors`, `community.escrow`, `community.assumeHost`, `member.leave`.
Não existe `kind` `community.leave` — a saída é `member.leave` (fecha `F-24`). O host não
pode `member.leave`: `E_HOST_CANNOT_LEAVE`.

### 6.3 Member

| Atributo | Tipo | Obrig. | Regra |
|---|---|---|---|
| `identityKey` | `bytes[32]` | req | — |
| `communityId` | `string` | req | Do cabeçalho da op |
| `displayName` / `avatarColor` | — | der | Último `identity.update` desta pessoa nesta comunidade |
| `nickname` | `string \| null` | der | 1–32 code points; auto-atribuído |
| `roleIds` | `string[]` | der | Sempre contém o cargo base. Máx. 24 |
| `blobsCoreKey` | `bytes[32]` | der | Core de blobs do membro (§13.1); vem em `member.join` ou `member.setBlobsCore` |
| `joinedAt` / `leftAt` | `ms` | der | — |
| `banned` | `bool` | der | Ban ativo não revogado |
| `timeoutUntil` | `ms \| null` | der | — |
| `displayNameCollision` | `bool` | der | §6.1, L-5 |
| `storageUsedBytes` | `int` | der | Soma de `sizeBytes` dos anexos vivos do membro (cota, §8.3 R-14) |

**Restrições:**
- `(communityId, identityKey)` é único.
- Todo membro ativo tem o cargo base (`R-3`).
- O **Fundador original** e o **host corrente** nunca são alvo de `mod.*`
  (`E_FOUNDER_IMMUNE` / `E_HOST_IMMUNE`).
- Quem sai e volta recupera o `Member` com `roleIds` **resetado ao cargo base**. A volta
  exige um convite **novo**: R-9 registra o par `(invitePk, autor)` em `joinedByInvite` e
  nunca o aceita duas vezes — sem isso, um convite de `maxUses = 1` seria reusável
  indefinidamente pela mesma pessoa entrando e saindo (§12.6).

**LIMITAÇÃO DECLARADA (L-6):** um banido que volta com identidade nova é indistinguível de
um membro novo. O backend **não** tenta heurística.

**Ciclo:**
```
(não-membro) ─member.join─▶ active ─member.leave|mod.kick─▶ left ─member.join─▶ active
                              ├─mod.timeout──▶ silenced (expira sozinho)
                              └─mod.ban──────▶ banned ─mod.revokeBan─▶ left
```

### 6.4 Role

| Atributo | Tipo | Obrig. | Regra |
|---|---|---|---|
| `id` | `string` | der | §7.3 |
| `name` | `string` | req | 1–32 code points |
| `color` | `enum` | req | Uma das 7 de `RoleColor`: `0..6` (§6.4.2). **`accent` (7) não é cor de cargo** |
| `rank` | `string` | req | **Chave fracionária esparsa** (§6.4.1). Único por comunidade |
| `permissions` | `Permission[]` | req | Subconjunto das 17 (§9.1); pode ser vazio |
| `mentionable` | `bool` | req | Default `true`; cargo base nasce `false` |
| `isFounder` / `isDefault` | `bool` | der | Exatamente um de cada por comunidade |
| `memberCount` | `int` | der | — |
| `deletedAt` | `ms` | der | Tombstone |

#### 6.4.1 Ordenação por chave fracionária

v1 usava `position` inteiro **denso e único**, renumerado a cada `role.move` dentro de um
índice `UNIQUE` — o que produzia violação de índice sob concorrência (`F-39`) e obrigava a
reescrever N linhas por movimento.

v2: `rank` é uma string na base 62 (`0-9A-Za-z`), ordenada lexicograficamente, gerada por
**indexação fracionária**: mover um cargo entre `A` e `B` gera uma chave estritamente entre
as duas (`midpoint(A,B)`), sem tocar em nenhum outro registro.

#### Valores de fronteira (constantes de protocolo, §27.1)

| Constante | Valor | Papel |
|---|---|---|
| `RANK_TOP` | `'zz'` | `rank` do cargo Fundador, atribuído no `seq` 1 da gênese (R-27b). O Fundador é sempre o topo |
| `RANK_BOTTOM` | `'1'` | `rank` do cargo base, atribuído no `seq` 2 (R-27b). Não é `'0'` porque `rank` nunca termina em `0` |
| `RANK_GENESIS` | `'z'` repetido **65** vezes | `topRank` do principal de gênese (R-27a). 65 > `RANK_MAX_LEN`, então é maior que qualquer `rank` válido **e nunca é ele próprio um `rank` válido** — não há como gravá-lo em cargo por acidente |

Todo `rank` gerado por `midpoint` ou por renormalização fica **estritamente entre**
`RANK_BOTTOM` e `RANK_TOP`, o que é o que mantém o cargo base no fundo e o Fundador no topo
sem regra adicional.

**Os dois sentinelas são os limites, e é isso que torna a frase acima verdadeira.** Quando o
vizinho de que o cálculo precisa não existe, o limite é `RANK_BOTTOM` embaixo e `RANK_TOP` em
cima — **`midpoint` nunca recebe `null` vindo de um escopo real**. Sem essa regra a invariante
é falsa, e não por um caso de canto: com o limite inferior aberto, o sexto item criado sem
dica de posição cai exatamente em `RANK_BOTTOM` e o sétimo abaixo dele. Para **cargos** isso
acontece já no primeiro, porque o cargo base ocupa `RANK_BOTTOM` desde a gênese (R-27b) — e um
cargo abaixo do base é pior do que fora de ordem: por R-3 todo membro carrega o base, então o
`topRank` de quem recebe o cargo novo continua sendo o do base, e por R-4 ele **não modera
ninguém**, nem um membro comum. Um "Moderador" criado pelo caminho default nasceria com
`ban_members` e sem poder banir.

O piso é limite, não vizinho: o cargo base não entra no cálculo como item do escopo, ele *é* a
fronteira de baixo. Pedir posição abaixo dela é entrada incoerente e normaliza para o fim do
escopo, como toda dica inutilizável — o `fold` não recusa (§8.5).

#### `midpoint(a, b)` — definição normativa

`a` e `b` são lidos como a **parte fracionária** de um número em base 62 com os dígitos
`0-9A-Za-z` nessa ordem. `a = null` é o limite inferior; `b = null`, o superior. A função é
**total**: entrada incoerente (`a ≥ b`, zero à direita) é normalizada, nunca recusada — o
`fold` não lança (§8.5).

```
canônica(s)  = s sem os '0' finais            // senão midpoint não termina
dígito(c)    = índice de c em '0-9A-Za-z'     // 0..61

mid(a, b):
  a ← canônica(a)
  se b ≠ null:
    b ← canônica(b)
    se b = '' ou a ≥ b:  devolve mid(a, null)          // incoerente: entra no fim
    n ← tamanho do prefixo comum, tratando a[i] ausente como '0'
    se n > 0: devolve b[0..n) ‖ mid(a[n..), b[n..))    // preserva o prefixo comum
  dA ← a ≠ '' ? dígito(a[0]) : 0
  dB ← b ≠ null ? dígito(b[0]) : 62
  se dB − dA > 1:      devolve dígito⁻¹(round((dA + dB) / 2))
  se b ≠ null e |b| > 1: devolve b[0..1)
  devolve dígito⁻¹(dA) ‖ mid(a[1..), null)
```

`round` é o arredondamento para o inteiro mais próximo, meio para cima — a única escolha que
mantém a função determinística entre réplicas.

**Renormalização.** Quando o `midpoint` excederia `RANK_MAX_LEN`, o escopo inteiro é
reespaçado com **dois dígitos base 62, ambos de índice ≥ 1**: o item `i` (base 0) recebe
`dígito⁻¹(1 + ⌊i/60⌋) ‖ dígito⁻¹(1 + (i mod 60))`. Nunca termina em `0`, cabe em
`MAX_CHANNELS` (500), e todo valor fica estritamente entre `RANK_BOTTOM` e `RANK_TOP`.

Regras normativas:
- `role.move` carrega `{roleId, afterRank?, beforeRank?}` — as chaves **vizinhas
  observadas pelo cliente**, não uma posição absoluta.
- O `fold` recalcula `rank = midpoint(prevRank, nextRank)` usando os vizinhos **reais** no
  seu `DS` no momento do registro, ignorando os que o cliente enviou se estiverem
  desatualizados. Determinístico.
- Colisão de `rank` (só possível por bug) é resolvida por desempate em `roleId` ascendente.
  O `fold` **nunca** falha por causa disso.
- **Renormalização determinística (fecha `HOLE-15`).** `midpoint` cresce em comprimento a
  cada inserção sucessiva na mesma extremidade: medido, a partir de ~383 inserções
  consecutivas no fundo a chave passa de `RANK_MAX_LEN` (64) e sai do tipo declarado em
  §7.2.1. Quando o `midpoint` que o `fold` calcularia excederia `RANK_MAX_LEN`, o `fold`
  **não recusa a op**: ele **renormaliza o escopo inteiro** no mesmo registro — todos os
  itens vivos daquele escopo (cargos da comunidade, canais da categoria, categorias da
  comunidade) recebem `rank` reespaçado uniformemente, **preservando a ordem corrente**, e
  o item novo entra na posição pedida. A renormalização é função pura do `DS` no momento
  do registro, então **toda réplica produz exatamente os mesmos `rank`**, e emite um
  `upsert` por item do escopo — limitado por §27.1 (`MAX_ROLES` 100, `MAX_CHANNELS` 500,
  `MAX_CATEGORIES` 50). Recusar era a alternativa e foi descartada: deixaria a comunidade
  permanentemente incapaz de reordenar, sem caminho de volta e por um detalhe de
  representação que o usuário não tem como perceber nem corrigir.
- A ordem exibida é `rank DESC` (topo primeiro). `position` inteiro **não existe mais** em
  contrato nenhum.

**Restrições:** Fundador tem sempre o `rank` máximo e é imutável (`E_FOUNDER_IMMUTABLE`,
`E_FOUNDER_TOP`). Cargo base não é deletável (`E_BASE_ROLE_REQUIRED`) mas suas permissões
são editáveis **dentro dos limites de R-11 e R-12** (§8.3). `role.delete` nunca remove
membros; o `fold` tira o `roleId` de todos e **limpa toda referência pendurada**, inclusive
`channel.readOnlyForRoleIds` (fecha `F-31`).

#### 6.4.2 Catálogo de cores (fecha `HOLE-10`)

Cor viaja como `u8` em material assinado (`role.create`/`role.update`, `identity.update`,
`community.create`/`community.update`), então o número é **constante de protocolo**
(§27.1), não escolha de tema. A paleta é a mesma que o frontend já implementa (§5.4 de
`frontend.md`): curada, fechada, sem cor livre.

| # | Nome | `RoleColor` | `avatarColor` / `iconColor` |
|---:|---|:---:|:---:|
| 0 | `role-gold` | ✅ | ✅ |
| 1 | `role-blue` | ✅ | ✅ |
| 2 | `role-green` | ✅ | ✅ |
| 3 | `role-red` | ✅ | ✅ |
| 4 | `role-purple` | ✅ | ✅ |
| 5 | `role-pink` | ✅ | ✅ |
| 6 | `role-neutral` | ✅ | ✅ |
| 7 | `accent` | — | ✅ |

`accent` é a cor da própria identidade visual do app e **não** é atribuível a cargo: um
cargo com `accent` se confundiria com elemento de sistema na lista de membros. Daí a
faixa de `Role.color` ser `0..6` e a de `avatarColor`/`iconColor` ser `0..7`.

Valor fora da faixa é `REJECTED` no estágio 13 com `E_VALIDATION` no campo correspondente.
**Não é clampado nem substituído por um default:** clampar faria duas réplicas com
paletas de tamanhos diferentes convergirem para cores diferentes a partir do mesmo log.

### 6.5 Category

`id` (§7.3) · `name` 1–32 code points · `rank` (mesma indexação fracionária de §6.4.1) ·
`deletedAt`. `collapsed` é **local**. Exatamente dois níveis: categoria contém canal.
`category.delete` carrega exatamente um de `moveChannelsTo` / `deleteChannels`.

### 6.6 Channel

| Atributo | Tipo | Obrig. | Regra |
|---|---|---|---|
| `id` | `string` | der | §7.3 |
| `categoryId` | `string` | req | Categoria da mesma comunidade |
| `type` | `enum` | req | `text = 0 · voice = 1`. **Imutável.** O número é constante de protocolo (§27.1): viaja como `u8` em `channel.create` (§7.4.2), dentro de material assinado. `u8` fora de `{0,1}` é `E_VALIDATION.type` |
| `name` | `string` | req | Texto: slug `^[a-z0-9][a-z0-9-]{0,31}$`. Voz: 1–32 code points livres |
| `topic` | `string` | opt | ≤ 120 code points; só em texto |
| `rank` | `string` | der | Indexação fracionária dentro da categoria |
| `readOnlyForRoleIds` | `string[]` | opt | Cargos que **não** postam; ≥ 1 cargo precisa ficar de fora |
| `deletedAt` | `ms` | der | — |
| `unreadCount`, `pendingMentions`, `muted`, `firstUnreadSeq` | — | local | §6.15 |

`(communityId, type, name)` é único entre canais não deletados. Excluir o último canal é
recusado (`R-7`). Excluir canal de voz com gente dentro é permitido e derruba a sessão.

### 6.7 Message

| Atributo | Tipo | Obrig. | Regra |
|---|---|---|---|
| `id` | `string` | der | §7.3 — determinístico, reprojetar produz o mesmo |
| `seq` | `int` | der | Posição no log. **Ordem canônica** |
| `channelId` | `string` | req | Canal de texto, existente, não deletado |
| `authorKey` | `bytes[32]` | der | Do cabeçalho da `Op` (não vai no payload) |
| `content` | `string \| null` | req | 1–4000 code points, ≤ 16384 bytes UTF-8. `NULL` quando tombstonada |
| `authorTs` | `ms` | req | `op.ts` — relógio do autor |
| `hostTs` | `ms` | host | Carimbo do host, monotônico (§8.3 R-1) |
| `clockSkewed` | `bool` | der | `|authorTs − hostTs| > CLOCK_SKEW_MS` |
| `edited`, `editedAt` | — | der | — |
| `pinned` | `bool` | der | Maior `seq` vence |
| `replyToId`, `threadId` | `string` | opt | Do **mesmo canal** |
| `mentions` | `string[]` | opt | ≤ 64: hex64 de identidade, id de cargo, ou `everyone` |
| `mentionEveryoneEffective` | `bool` | der | §8.3 R-13 |
| `attachment` | `AttachmentRef` | opt | Máx. 1 no v1 |
| `deletedAt` | `ms` | der | Tombstone |
| `hiddenByBan` | `bool` | der | Reversível (§18.2) |
| `orphaned` | `bool` | der | §8.4 — canal-alvo tombstonado depois; a mensagem existe, mas não é listada |

**Regras de edição/deleção:** editar só a própria (`E_CANNOT_EDIT_OTHERS` sempre para
terceiros — moderação apaga, não reescreve). Deletar a própria, ou `manage_messages` +
hierarquia. Deletar já deletada é sucesso idempotente sem nova entrada de auditoria.

**Relógio (fecha `F-33`, `T-26`, `M-17`):** o `fold` **não** corrige `authorTs`. A UI exibe
`authorTs`; se `clockSkewed`, exibe `hostTs` com o aviso. `authorTs` fora de
`[hostTs − 24 h, hostTs + 24 h]` faz a op **não ter efeito** (`R-2`) — carimbo retroativo
de sete dias, que v1 aceitava, foi removido.

**Ciclo (o `fold` só conhece dois estados; os outros quatro são do cliente):**
```
cliente:  composer → queued → sending → awaiting-confirmation → (removido)
                       └──────────────┴──▶ failed → queued | dropped(motivo)
log:      sent(seq) ──edit──▶ sent(edited) ──delete──▶ deleted(tombstone)
```

### 6.8 Thread

`id` (§7.3) · `rootMessageId` · `channelId` (der) · `replyCount` (der) ·
`participantKeys` (der) · `unreadCount` (**local**, tabela própria — fecha `DR-48`).
Uma thread por raiz. Deletar a raiz **não** deleta as respostas; a thread deixa de ser
alcançável pelo indicador e o `fold` marca `rootDeleted = true`.

### 6.9 Reaction

PK `(communityId, messageId, emoji, identityKey)`. `emoji` = 1–8 code points, ≤ 32 bytes.
Máx. 20 emojis distintos por mensagem, 1 reação por pessoa por emoji.

**Mudança normativa (fecha `DS-12`):** a op é `reaction.set{messageId, emoji, present}` —
**idempotente e convergente por último `seq`**. `reaction.toggle` não existe mais. Isso
elimina a única op não comutativa do catálogo e remove a dependência de durabilidade de
dedupe para correção.

Mensagem deletada → reações somem na mesma transação, sem estado zumbi.

### 6.10 Attachment

| Atributo | Tipo | Obrig. | Regra |
|---|---|---|---|
| `ownerKey` | `bytes[32]` | der | = autor da mensagem |
| `blobsCoreKey` | `bytes[32]` | req | Core de blobs **do autor** (§13.1) |
| `blobId` | `{byteOffset,blockOffset,blockLength,byteLength}` | req | Devolvido por `hyperblobs.put` |
| `name` | `string` | req | 1–255 bytes, sem `/ \ \0` nem controle |
| `sizeBytes` | `int` | req | 1 .. `ATTACHMENT_MAX_BYTES` |
| `kind` | `enum` | req | `image · video · audio · document · archive · other` — tabela de extensão em §13.6 |
| `hash` | `bytes[32]` | req | `BLAKE2b('blob-hash/1' ‖ conteúdo)`. **Verificado no destino** |
| `downloadProgress`, `availablePeers`, `hostAvailable`, `state` | — | local | §13.4 |

**Regras:**
- `sizeBytes` **não** é revalidado pelo host (o host não tem os bytes). O **leitor** aborta
  o download se os bytes recebidos ultrapassarem `sizeBytes` e emite `attachment.corrupt`.
  Isso fecha o ataque "declara 1 KB, entrega 8 GB" no ponto certo.
- O `hash` é verificado ao completar. Falha → arquivo descartado, `attachment.corrupt`.
  **Nenhum byte não verificado vira arquivo final no disco do usuário.**
- Deletar a mensagem não apaga o blob do core do autor. A projeção esconde a referência; o
  GC local (§22.4) limpa o cache.
- Cota por membro: `R-14`.

### 6.11 Invite

| Atributo | Tipo | Obrig. | Regra |
|---|---|---|---|
| `invitePublicKey` | `bytes[32]` | req | **No log.** Derivada do segredo (§12.1) |
| `secret` | `bytes[10]` | local | Só na instalação de quem criou |
| `createdByKey` | `bytes[32]` | der | Precisa de `create_invite` |
| `createdAt` | `ms` | der | `hostTs` |
| `expiresAt` | `ms` | opt | `> hostTs`, ≤ 365 d à frente. Ausente = nunca |
| `maxUses` | `int` | opt | 1..10000. Ausente = ilimitado |
| `uses` | `int` | der | Contado pelo `fold` |
| `revokedAt` | `ms` | der | Explícito, ou automático por `R-10` |
| `label` | `string` | opt | ≤ 40 code points, para a lista de 3.1b |

**O segredo nunca entra no log.** O log guarda a **chave pública** do convite; o host
valida com ela. É isso que torna convite delegado executável (§12).

**Revogação automática (`R-10`, fecha `T-23`):** o `fold` revoga todo convite de um membro
no instante em que esse membro é banido, expulso, sai, ou perde `create_invite`.

**MUDANÇA DE PRODUTO (delta U-04):** o código em claro de um convite **só existe na
instalação de quem o criou**. `query.invites` devolve `codeAvailable:false` para os
demais. Não há solução criptográfica para o contrário sem colocar o segredo no log.

**Ciclo:** `active → (revoked | expired | exhausted)`, todos terminais; o registro fica.

### 6.12 Ban / Timeout

`targetKey` · `byKey` · `at` (`hostTs`) · `reason` (≤ 200 code points) · `until` (timeout:
`> hostTs`, ≤ 30 d) · `revokedAt` (ban).

**O que o ban faz, exatamente:**

| Efeito | Alcance | Momento |
|---|---|---|
| Recusa de op | Total, em toda réplica | Imediato pelo `fold` |
| Ocultação de mensagens do alvo | Projeção, **reversível** | Mesma transação do ban |
| Recusa de replicação a partir dos pares | Todo membro que já projetou o ban | Ao aplicar o ban (§14.3) |
| Queda das conexões ativas do alvo | Comunidade banida apenas | Imediato |
| Revogação de tickets de mídia | Sessões de voz/tela | Imediato (§17.4) |
| Revogação dos convites emitidos pelo alvo | `R-10` | Imediato pelo `fold` |
| Preview de convite devolve `banned` | Canal pré-membro (§12.5) | Sempre |

**LIMITAÇÃO DECLARADA (L-7) — revogação de leitura:** o ban impede replicação **futura**.
Ele **não** retira do alvo o que ele já replicou. A UI é obrigada a dizer isso no modal de
confirmação de ban.

**Timeout** expira **sozinho**, por comparação `until > hostTs do registro corrente` dentro
do `fold` — nunca pelo relógio de quem lê. Isso fecha `T-45`: réplicas não divergem.
Consequência: um timeout só "expira" quando algum registro novo entra no log; para a UI, a
contagem regressiva é local e cosmética, e o `fold` é a verdade.

### 6.13 ModerationEntry (log de auditoria)

**Não é um `kind`** — é projeção derivada de qualquer op auditável.

| Atributo | Regra |
|---|---|
| `id` | §7.3 |
| `seq` | Do registro |
| `type` | Enum fechado e **único** (fecha `RT-07`): `kick · ban · revokeBan · timeout · removeTimeout · deleteMessage · createRole · updateRole · deleteRole · createChannel · updateChannel · deleteChannel · createCategory · renameCategory · deleteCategory · updateCommunity · endCommunity · assumeHost · setSuccessors · revokeInvite` (**20**). Há exatamente um valor para cada linha marcada `Aud. = sim` em §7.4 — a correspondência é 1:1 e verificável por teste |
| `targetId` / `targetKey` | — |
| `targetLabel` | **Congelado no momento da aplicação** |
| `byKey` | — |
| `byLabel` | **Congelado também** (fecha `DR-49`) |
| `reason` | — |
| `at` | `hostTs` |

Reprojetar reconstrói exatamente as mesmas entradas, com os mesmos ids.

### 6.14 RelayVolunteer

`identityKey` · `relayPublicKey` (derivada da identidade, §17.7) · `since` · `expiresAt`
(TTL obrigatório, `RELAY_TTL_MS`) · `withdrawnAt` · `rttMs` (**local**).
Exige prova de posse (§17.7) e consentimento persistido.

### 6.15 Estado local (`LS` — nunca replica, nunca é apagado por reprojeção)

| Tabela | Chave | Campos |
|---|---|---|
| `local_read_state` | `(communityId, channelId)` | `lastReadSeq`, `firstUnreadSeq`, `unreadCount`, `pendingMentions` |
| `local_thread_read_state` | `(communityId, threadId)` | `lastReadSeq`, `unreadCount` — fecha `DR-48` |
| `local_channel_pref` | `channelId` | `muted` |
| `local_community_pref` | `communityId` | `notificationLevel`, `collapsedCategories[]`, `recentChannels[]`, `lastHostSeenAt` |
| `local_navigation` | singleton | `activeCommunityId`, `activeChannelId` — **dono único** (fecha `DR-32`) |
| `local_relay_consent` | `communityId` | `decision`, `at` |
| `local_device_pref` | singleton | `microphoneId`, `cameraId`, `outputId`, `inputVolume`, `outputVolume` |
| `local_participant_volume` | `(communityId, identityKey)` | `volume` 0..100 — fecha `DR-45`/`V-6` |
| `local_blob_cache` | `(blobsCoreKey, blobIdHex)` | `bytesDownloaded`, `state`, `path`, `verifiedAt`, `declaredSize` |
| `local_blob_staging` | `ticketId` | `path`, `bytesWritten`, `rollingHashState`, `state` |
| `local_outbox` | `localSeq` | §11.2 |
| `local_author_seq` | `(communityId, sequenceScope)` | `nextAuthorSeq` — §7.3 |

**Cálculo de não-lidas (fechado):** por canal, `unreadCount` = mensagens com
`seq > lastReadSeq` cujo autor não é a identidade local, não deletadas e não
`hiddenByBan`; `pendingMentions` = subconjunto que menciona a identidade, um cargo dela ou
`everyone` efetivo — **e menção conta mesmo em canal silenciado**. `firstUnreadSeq` é o
menor `seq` do conjunto. `lastReadSeq` avança com o canal aberto e rolado até o fim, ou por
`channel.markRead`.

**Recálculo (fecha `F-25`, `F-48`):** `local_read_state` é atualizado **incrementalmente**
pelo projetor a cada lote e **recomputado do zero** em duas situações, ambas dentro da
mesma transação: reprojeção total, e `roles.changed` que afete os cargos da identidade
local (porque `pendingMentions` depende deles). Nunca há contagem dupla porque
`lastReadSeq` é o watermark e a contagem é uma query sobre `seq > lastReadSeq`, não um
acumulador.

### 6.16 Entidades efêmeras (nunca persistem)

| Entidade | TTL | Fan-out | Campos |
|---|---|---|---|
| `Presence` | 45 s, refresh 15 s | host agrega e emite delta a cada `PRESENCE_TICK_MS` | `identityKey`, `status` |
| `Typing` | 5 s, refresh 3 s | host → **só assinantes do canal** | `identityKey`, `channelId` |
| `VoiceOccupancy` | enquanto a sessão vive | host → **todos os membros conectados** | `channelId`, `count`, `firstKeys[≤5]` — fecha `RT-05` |
| `VoiceRoster` | enquanto a sessão vive | host → **participantes** | `channelId`, `participants[{key,muted,deafened,cameraOn,sharing,speaking}]` — `speaking` fecha `DR-42` |
| `ShareSession` | enquanto transmite | host → participantes | `sessionId`, `presenterKey`, `channelId`, `topology`, `viewerCount` |
| `ShareHealth` | idem | host → **só o apresentador** | `viewers[{key, rttMs, lossPct, quality}]` — destinatário declarado, fecha `RT-08` |

`invisible` **não publica** presença e continua recebendo tudo. Exceção declarada: entrar
em canal de voz publica presença mesmo com `invisible` — voz é presença por definição; a UI
avisa.

**`speaking`** é **produzido pelo renderer** (VAD local sobre o próprio microfone), enviado
ao host em `voiceState{speaking}` com histerese de 200 ms, e reemitido no roster. Não é
inferido pelo núcleo, que não vê mídia.

### 6.17 Invariantes — o que elas são em v2

Em v1, violar invariante abortava a projeção e parava a comunidade. Em v2 isso é
**proibido**: o `fold` é total (§8.5) e as invariantes são **propriedades verificáveis**,
não guardas de execução.

| # | Propriedade (verificada em teste e em `dev`, contada como métrica em produção) |
|---|---|
| P-1 | Toda comunidade tem ≥ 1 canal não deletado |
| P-2 | Exatamente 1 cargo `isFounder` e 1 `isDefault` por comunidade |
| P-3 | Todo membro ativo tem o cargo base |
| P-4 | `rank` de cargo é único dentro da comunidade; o Fundador é o máximo |
| P-5 | Todo canal aponta para categoria não deletada da mesma comunidade |
| P-6 | Toda mensagem **listável** aponta para canal de texto não deletado |
| P-7 | `replyToId` e `threadId` são do mesmo canal |
| P-8 | Nenhuma reação visível aponta para mensagem deletada |
| P-9 | `memberCount` = membros ativos não banidos; `memberCount` de cargo = membros ativos com o cargo |
| P-10 | `interpretedSeq` = maior `seq` interpretado; **não há buraco**, porque todo registro é interpretado-ou-explicitamente-ignorado, e ambos avançam o contador (fecha `F-40`) |
| P-11 | Reprojetar do `seq` 0 produz `CS` byte-a-byte idêntico (hash de dump ordenado) |

**Em produção**, uma violação de P-1..P-9 incrementa `fold.propertyViolation{p}` e **não
interrompe nada**. Uma violação é bug do `fold` e deve ser corrigida com um `opVersion`
novo, não com uma parada de emergência.

---

## 7. Log de operações

### 7.1 Estruturas assinadas

```
Op         = { v:uint8, communityId:bytes[32], kind:uint16, author:bytes[32],
               sequenceScope:Scope, authorSeq:uint64, ts:uint64, payload:bytes }
Envelope   = { op:bytes, sig:bytes[64] }      sig = Ed25519(author, BLAKE2b('op/1' ‖ op))
HostRecord = { envelope:bytes, hostTs:uint64, flags:uint8, hostSig:bytes[64] }
              hostSig = Ed25519(coreKeyPair, BLAKE2b('hostrec/1' ‖ envelope ‖ hostTs ‖ flags))
```

`Scope = community | channel(channelId)`. `sequenceScope` faz parte do material assinado e
tem encoding canônico. As seis operações de domínio de mensagem enfileiráveis usam
`channel(channelId)`; `message.edit`, `message.delete`, `message.pin`, `reaction.set` e
`thread.create` carregam um escopo que o `fold` confere contra o alvo. Operações sem canal,
inclusive a gênese e a exceção `member.leave`, usam `community`. Escopo incompatível com o
`kind` ou com o alvo é `E_VALIDATION` no campo `sequenceScope` e não avança o contador.

`HostRecord` é o que é appendado. `seq` é implícito (índice no core).

**Três mudanças em relação a v1, todas normativas:**

1. **`communityId` está dentro do material assinado.** Um envelope colhido do log de A não
   tem efeito nenhum no log de B: o `fold` de B recusa no estágio 3 (§8.2). Fecha `T-01`.
2. **`authorSeq` substitui `nonce`.** Contador monotônico estritamente crescente por
   `(author, communityId, sequenceScope)`, mantido em `manifest.local_author_seq` e
   reconciliado no boot por escopo com `max(local, lastAuthorSeq observado no log) + 1`.
   Fecha `T-05`, `DS-03`, `DS-20`, `F-36` e elimina a janela de dedupe de 7 dias (§7.5).
3. **`hostTs` e `flags` são assinados pelo host.** Um host não pode reescrever carimbo nem
   `clockSkewed` sem que a assinatura falhe. Fecha `T-27`, `DS-13`.

`flags`: bit 0 `clockSkewed`; bits 1–7 reservados. Leitores ignoram bits desconhecidos.

### 7.2 Encoding

`compact-encoding`, com **registry versionado por `kind`**. `kind` é um `uint16` de um
enum fechado (§7.4) — nunca uma string no fio. A versão está no cabeçalho da `Op`.
Na versão de produto desta emenda, `v = 2`; `v = 1` pertence ao protocolo experimental
anterior e não é reinterpretado como se tivesse `sequenceScope`.

Regras invioláveis:

1. Dentro de um mesmo `v`, campo **nunca** é removido nem tem o tipo trocado. Acrescentar
   campo opcional **no fim** é a única evolução permitida.
2. **Leitor tolerante:** bytes sobrando no fim do payload são ignorados.
3. **Escritor estrito:** o cliente só escreve `v` que conhece por inteiro.
4. `v` desconhecido, `kind` desconhecido, ou payload que não decodifica → o registro é
   `IGNORED` (§8.2 estágio 2), contado no `seq`, sem efeito, com métrica. **Nunca** para a
   projeção.
5. Uma comunidade com ≥ 1 registro `IGNORED` por versão desconhecida entra no estado
   `partialInterpretation = true`: **as escritas locais naquela comunidade são bloqueadas**
   com `E_VERSION_UNSUPPORTED` e a UI exibe "seu cliente está desatualizado". Fecha `F-07`
   (o leitor tolerante deixa de destruir as propriedades) e `DS-25`.

**Forma canônica** (para `opId`): campos na ordem declarada, sem padding, campo opcional
ausente não é escrito.

#### 7.2.1 Layout dos tipos primitivos do registry

| Tipo do registry | Encoding |
|---|---|
| `u8`, `u16`, `u32`, `u64` | `compact-encoding` `uint8/16/32/64`, little-endian |
| `Scope` | `u8` tag `0` para `community`; tag `1` seguido de `str channelId` para `channel` |
| `key` | `fixed32` |
| `sig` | `fixed64` |
| `str` | `string` (uint prefixado, UTF-8) |
| `id` | `string` — **prefixo de entidade + 26 caracteres** Crockford-Base32 (§7.3), 29 a 32 caracteres no total conforme o prefixo |
| `rank` | `string` base62 (`0-9A-Za-z`), 1–`RANK_MAX_LEN` (64) caracteres; nunca termina em `0` (§6.4.1) |
| `bool` | `uint8` 0/1 |
| `opt<T>` | `uint8` presente(1)/ausente(0) seguido de `T` quando presente |
| `arr<T>` | `uint` de contagem seguido de `T` repetido |
| `bytes` | `buffer` (uint prefixado) |
| `blobref` | `key blobsCoreKey · u64 byteOffset · u64 blockOffset · u64 blockLength · u64 byteLength` |

**Regra que fecha `DR-10`:** nenhum `kind` pode ser implementado sem sua linha de payload
em §7.4. Um `kind` sem layout declarado é `E_UNKNOWN_KIND` na escrita e `IGNORED` na
leitura.

### 7.3 Identificadores determinísticos

```
opId          = BLAKE2b-256('opid/1' ‖ envelopeCanônico)                 → 32 B, hex
entityId(t)   = 'PREFIXO' + crockford32(BLAKE2b-128('id/' ‖ t ‖ '/2'
                              ‖ communityId ‖ sequenceScope ‖ author ‖ authorSeq)) → prefixo + 26 chars
```

| Entidade | `t` | Prefixo | Exemplo |
|---|---|---|---|
| Message | `message` | `msg-` | `msg-8g3k...` (26 chars) |
| Channel | `channel` | `ch-` | — |
| Category | `category` | `cat-` | — |
| Role | `role` | `role-` | — |
| Thread | `thread` | `thr-` | — |
| ModerationEntry | `modentry` | `mod-` | — |

**Propriedades que isso garante e que v1 não tinha:**
- 128 bits, não 48 → colisão dirigida deixa de ser viável (fecha `T-30`, `F-05`).
- Escopado por comunidade → não atravessa fronteira (fecha `T-30`).
- Derivado de `(author, sequenceScope, authorSeq)`, que é único por construção → **duas ops
  distintas não podem produzir o mesmo id**, e a mesma op reproduz o mesmo id em toda
  reprojeção (fecha `DR-11`).
- Nenhum id é "gerado pelo host" — o que quebrava reprojeção determinística em v1.

Chave primária de toda tabela de `CS` é `(community_id, id)`.

### 7.4 Catálogo de ops

`Perm.` = permissão exigida · `Hier.` = exige hierarquia estrita sobre o alvo · `Aud.` =
gera entrada de auditoria · `Fila` = pode ser enfileirada na outbox (§11.1).

#### 7.4.1 Mensagem — domínio enfileirável

| `kind` | # | Payload | Perm. | Hier. | Aud. | Fila |
|---|---:|---|---|---|---|---|
| `message.send` | 1 | `id channelId · str content · arr<str> mentions · opt<blobref+meta> attachment · opt<id> replyToId · opt<id> threadId` | `send_messages` (+`attach_files` se anexo) | — | — | **sim** |
| `message.edit` | 2 | `id messageId · str content` | própria | — | — | **sim** |
| `message.delete` | 3 | `id messageId · opt<str> reason` | própria \| `manage_messages` | se de outro | se de outro | **sim** |
| `message.pin` | 4 | `id messageId · bool pinned` | `pin_messages` | — | — | **sim** |
| `reaction.set` | 5 | `id messageId · str emoji · bool present` | `add_reactions` | — | — | **sim** |
| `thread.create` | 6 | `id rootMessageId` | `send_messages` | — | — | **sim** |

`attachment` completo: `blobref · str name · u64 sizeBytes · u8 kind · key hash`.

#### 7.4.2 Estrutura — síncrona, não enfileirável

| `kind` | # | Payload | Perm. | Aud. |
|---|---:|---|---|---|
| `channel.create` | 10 | `id categoryId · u8 type · str name · opt<str> topic · arr<id> readOnlyForRoleIds · opt<rank> afterRank · opt<rank> beforeRank` | `manage_channels` | sim |
| `channel.update` | 11 | `id channelId · opt<str> name · opt<str> topic · opt<arr<id>> readOnlyForRoleIds` | `manage_channels` | sim |
| `channel.move` | 12 | `id channelId · id categoryId · opt<rank> afterRank · opt<rank> beforeRank` | `manage_channels` | — |
| `channel.delete` | 13 | `id channelId` | `manage_channels` | sim |
| `category.create` | 14 | `str name · opt<rank> afterRank · opt<rank> beforeRank` | `manage_channels` | sim |
| `category.rename` | 15 | `id categoryId · str name` | `manage_channels` | sim |
| `category.delete` | 16 | `id categoryId · opt<id> moveChannelsTo · bool deleteChannels` | `manage_channels` | sim |

#### 7.4.3 Cargos e membros — síncrona

| `kind` | # | Payload | Perm. | Hier. | Aud. |
|---|---:|---|---|---|---|
| `role.create` | 20 | `str name · u8 color · arr<u8> permissions · bool mentionable · opt<rank> afterRank · opt<rank> beforeRank` | `manage_roles` | — | sim |
| `role.update` | 21 | `id roleId · opt<str> name · opt<u8> color · opt<arr<u8>> permissions · opt<bool> mentionable` | `manage_roles` | sim | sim |
| `role.move` | 22 | `id roleId · opt<rank> afterRank · opt<rank> beforeRank` | `manage_roles` | sim | — |
| `role.delete` | 23 | `id roleId` | `manage_roles` | sim | sim |
| `member.setRoles` | 24 | `key targetKey · arr<id> roleIds` | `manage_roles` | sim | — |
| `member.join` | 25 | `key invitePublicKey · sig joinProof · str displayName · u8 avatarColor · key blobsCoreKey` | — (autorizado pelo convite) | — | — |
| `member.leave` | 26 | *(vazio)* | — | — | — |
| `member.setNickname` | 27 | `opt<str> nickname` | — (só o próprio) | — | — |
| `member.setBlobsCore` | 28 | `key blobsCoreKey` | — (só o próprio) | — | — |
| `identity.update` | 29 | `opt<str> displayName · opt<u8> avatarColor` | — | — | — |

#### 7.4.4 Moderação — síncrona

| `kind` | # | Payload | Perm. | Hier. | Aud. |
|---|---:|---|---|---|---|
| `mod.kick` | 30 | `key targetKey · opt<str> reason` | `kick_members` | sim | sim |
| `mod.ban` | 31 | `key targetKey · opt<str> reason` | `ban_members` | sim | sim |
| `mod.revokeBan` | 32 | `key targetKey` | `ban_members` | — | sim |
| `mod.timeout` | 33 | `key targetKey · u64 until · opt<str> reason` | `timeout_members` | sim | sim |
| `mod.removeTimeout` | 34 | `key targetKey` | `timeout_members` | — | sim |

#### 7.4.5 Comunidade, convite, rede — síncrona

| `kind` | # | Payload | Perm. | Aud. |
|---|---:|---|---|---|
| `community.create` | 40 | `str name · opt<str> iconEmoji · u8 iconColor · opt<str> description · key blobsKey · opt<str> originCommunityId · opt<u64> originFinalSeq` | — (gênese) | — |
| `community.update` | 41 | `opt<str> name · opt<str> iconEmoji · opt<u8> iconColor · opt<str> description` | `manage_community` | sim |
| `community.end` | 42 | `opt<str> reason` | host | sim |
| `community.setSuccessors` | 43 | `arr<key> successorKeys` | host | sim |
| `community.escrow` | 44 | `key targetKey · bytes wrappedSeed` | host | — |
| `community.assumeHost` | 45 | `key newHostKey · u64 observedHostTs · sig proof` | sucessor (§18.8) | sim |
| `invite.create` | 50 | `key invitePublicKey · opt<u64> expiresAt · opt<u32> maxUses · opt<str> label` | `create_invite` | — |
| `invite.revoke` | 51 | `key invitePublicKey` | autor do convite \| `manage_community` | sim |
| `relay.volunteer` | 60 | `key relayPublicKey · u64 expiresAt · sig possession` | — | — |
| `relay.withdraw` | 61 | *(vazio)* | — | — |

**Total: 38 `kind`s.** O número é normativo e fechado para `opVersion = 2`. Fecha `F-23`.

Para os `kind`s com `Fila = sim`, `sequenceScope` é o canal referido pela operação. Os
`kind`s sem canal usam `sequenceScope = community`; isso inclui as operações síncronas e o
`member.leave`, que é a única exceção não-mensagem enfileirada (§11.1). A escolha do escopo
não é uma propriedade local da outbox: ela é validada pelo `fold` em toda réplica.

### 7.5 Idempotência sem janela

v1 dependia de uma tabela `dedupe(opId)` com janela de 7 dias, num store sem transação
comum com o log — a origem de `DS-03`, `T-05`, `DS-12` e metade de `B5`.

v2:

| Questão | Resposta |
|---|---|
| O que impede duplicata? | `(author, sequenceScope, authorSeq)`. O `fold` mantém `lastAuthorSeq[author, sequenceScope]` no `DS` e **ignora** todo registro com `authorSeq ≤ lastAuthorSeq[author, sequenceScope]` (§8.2 estágio 6). |
| Isso é durável? | Sim, por construção: é derivado do log, não de um store paralelo. Crash não pode dessincronizar. |
| E depois de N dias? | Não há janela. Um envelope de dois anos atrás, reenviado, continua sendo ignorado. |
| Custo de memória? | `O(autores × escopos usados)` por comunidade: um `uint64` por par autor/escopo. |
| O cliente pode ter buracos em `authorSeq`? | Sim. A regra é **estritamente crescente**, não densa. Uma op recusada antes do append queima o número. |
| Como o cliente sabe que a op entrou? | Procurando o `opId` entre as operações `APPLIED` da própria réplica projetada (§11.6). Não pela palavra do host nem por uma marca d'água. |
| E se o cliente perder o contador? | Boot reconcilia por `(communityId, sequenceScope)`: `next = max(manifest, lastAuthorSeq no log) + 1`. |
| Reenvio produz o mesmo `opId`? | Sim — o envelope é armazenado assinado e **nunca reassinado**. |

**Ordem canônica:** o `seq` do registro no core do host. Não há relógio vetorial, não há
reordenação retroativa. "Última escrita vence" = maior `seq`.

---

## 8. O `fold` — a interpretação normativa

Esta é a seção mais importante do documento. Ela substitui, de uma vez, o "pipeline de
validação" (§9 de v1), os "reducers" (§3.2/§6.4 de v1) e a "concorrência" (§12 de v1).

### 8.0 Assinatura do módulo

```ts
// L1, puro. Sem I/O, sem relógio, sem configuração, sem exceção.
type FoldResult = {
  decision: 'APPLIED' | 'REJECTED' | 'IGNORED'
  reason?: ErrorCode           // presente quando REJECTED ou IGNORED
  field?: string               // §20.1 — presente em E_VALIDATION
  limit?: number               // §20.2 — presente em E_LIMIT_EXCEEDED
  hostTsClamped?: boolean      // R-1 — o registro trouxe hostTs retroativo e foi clampado
  kind?: number                // §7.4 — presente a partir do decode do `Op` (estágio 2)
  author?: Key                 // §7.1 — idem; é `op.author`, tal como decodificado
  opId?: string                // presente em APPLIED; chave de `observed_ops` (§10.3)
  authorSeq?: uint64            // presente em APPLIED; metadado do mesmo decode
  sequenceScope?: Scope        // presente em APPLIED; metadado do mesmo decode
  effects: Effect[]            // vazio quando não APPLIED
  next: DecisionState          // sempre presente; quando não APPLIED difere de `prev`
                               // apenas em `interpretedSeq`, `lastAuthorSeq` e
                               // `partialInterpretation` (§8.2). O `CS` não muda.
}

function foldRecord(prev: DecisionState, rec: RawRecord, seq: number): FoldResult
```

Isso fecha `DR-14` (a assinatura de `validate` não existia) e `DR-28` (nenhuma camada podia
montar o estado de validação): o estado é `DecisionState`, ele é argumento e resultado, e o
módulo é L1 puro. Nenhuma camada precisa violar a regra de dependência.

**`kind` e `author` — a fonte do diagnóstico (fecha `H-21` e `H-26`).** Os dois são
preenchidos **exatamente a partir do momento em que o `Op` decodifica**, dentro do estágio 2
de §8.2, e ficam ausentes em todo desfecho anterior a esse ponto — um registro recusado no
estágio 0 (teto de bytes, antes de qualquer decode) não tem `kind` nem autor, e nenhuma
camada pode inventá-los. `kind` é o número de §7.4 **como veio no registro**, inclusive
quando é desconhecido deste binário (o desfecho aí é `IGNORED`, e o número é o que permite
diagnosticar de qual versão ele veio).

São **metadado de desfecho, não decisão**: não entram no `DecisionState`, não influenciam
nenhum estágio e nenhuma regra `R-*`, e removê-los não muda uma única interpretação. Estão
na assinatura pela mesma razão que `field`, `limit` e `hostTsClamped`: existe requisito
normativo que os consome e não havia de onde tirá-los. São eles que dão fonte a

`opId`, `authorSeq` e `sequenceScope` têm a mesma origem, mas são exigidos somente no
desfecho `APPLIED`: o projector precisa materializar `observed_ops` sem decodificar o
registro. Os três também são metadados, não entram no `DecisionState` nem alteram o desfecho.

- `rejected_records.kind` e `.author_key` (§10.3) — o "quando aplicável" da tabela de
  desfechos abaixo passa a significar **isto**, e nada mais; e
- o `kind` de `fold.panic{seq, kind}` (§8.5), que o `projector` não tem como obter de outro
  jeito: ele **não decodifica registro** (§4), e um `fold` que lança pode ter lançado antes
  do decode.

Três desfechos, e só três:

| Desfecho | Significado | Efeito no `CS` | Avança `interpretedSeq` |
|---|---|---|---|
| `APPLIED` | O registro é válido e autorizado | Sim | Sim |
| `REJECTED` | Sintaxe válida, mas o `fold` recusa (autorização, limite, unicidade, duplicata) | Não (só métrica e `rejected_records`; `kind`/`author_key` presentes sse o `Op` decodificou) | Sim |
| `IGNORED` | O registro não é interpretável por este binário (versão/`kind`/decode) | Não | Sim, e marca `partialInterpretation` |

**Não existe um quarto desfecho.** Não existe "abortar", "parar", "degradar a comunidade"
nem "lançar". §8.5.

### 8.1 `DecisionState` — schema exato

Estrutura em memória, por comunidade. Tudo aqui é derivado do log e recomputável.

```ts
type DecisionState = {
  communityId: string
  interpretedSeq: number            // −1 antes do primeiro registro
  opVersionSeen: number
  partialInterpretation: boolean
  communityInvalid: boolean         // gênese fora da forma de R-27; absorvente
  lastHostTs: number                // monotonicidade (R-1)

  community: {
    exists: boolean
    hostKey: Key
    founderKey: Key                 // imutável: autor do lote de gênese
    blobsKey: Key
    name: string; iconEmoji?: string; iconColor: number; description?: string
    createdAt: number; endedAt?: number
    successorKeys: Key[]
    originCommunityId?: string
    originFinalSeq?: number         // R-18(a) — material da prova de sucessão (fecha `H-19`)
  }

  members: Map<KeyHex, {
    state: 'active' | 'left' | 'banned'
    roleIds: Set<Id>
    displayName: string; avatarColor: number; nickname?: string
    blobsCoreKey?: Key
    joinedAt: number; leftAt?: number
    timeoutUntil?: number
    bannedAt?: number; bannedBy?: Key
    storageUsedBytes: number
    opBudget: RingCounter           // R-15
    byteBudget: RingCounter         // R-15
  }>

  roles: Map<Id, { name, color, rank, permissions: Set<Perm>,
                   mentionable, isFounder, isDefault, deletedAt? }>
  categories: Map<Id, { name, rank, deletedAt? }>
  channels:  Map<Id, { categoryId, type, name, topic?, rank,
                       readOnlyForRoleIds: Set<Id>, deletedAt? }>
  channelNameIndex: Map<`${type}:${name}`, Id>   // unicidade (R-6)

  messages: Map<Id, { channelId, authorKey, deletedAt?, pinned,
                      threadId?, hasAttachment, attachmentBytes,
                      reactionEmojis: Set<string>, hiddenByBan }>
  rootOfThread: Map<Id, Id>         // threadId → mensagem raiz (fecha `A-04`)

  invites: Map<KeyHex, { createdBy: Key, createdAt, expiresAt?, maxUses?,
                         uses: number, revokedAt? }>
  joinedByInvite: Set<`${invitePkHex}:${candidateHex}`>   // R-9

  lastAuthorSeq: Map<`${KeyHex}:${sequenceScope}`, number> // §7.5

  relays: Map<KeyHex, { relayPublicKey: Key, expiresAt: number, withdrawnAt?: number }>
}
```

**`rootOfThread`, e por que a direção é essa (fecha `A-04`).** O campo se chamava
`threadsByRoot`, indexado pela raiz — e o nome contradizia todo uso que §8.3 faz dele. R-8
precisa resolver `threadId → canal` em O(1) a cada `message.send` numa thread; R-24 ("uma
thread por mensagem raiz") **já** é O(1) sem índice nenhum, porque a `MessageMeta` da raiz
carrega o `threadId` da própria thread. Indexado por raiz, R-24 ficava barato e R-8 virava
varredura do mapa inteiro. `threadId → raiz` é a única direção em que **toda** regra de §8.3 é
implementável com o schema declarado e nada mais.

**Custo de memória (ordem de grandeza, a medir em G9):** dominado por `members` e
`messages`. `messages` guarda só metadados de decisão (~120 B/mensagem). Uma comunidade com
200 000 mensagens ≈ 24 MiB. Com 50 comunidades abertas isso não fecha, então:

> **Regra de residência do `DS` (normativa):** `messages` e `rootOfThread` são carregados
> sob demanda a partir de `view.db` (que os materializa) **apenas** para as comunidades com
> `residency = 'full'`. Comunidades em `residency = 'light'` mantêm o resto do `DS` (que é
> `O(membros + canais + cargos)`, alguns KiB) e resolvem consultas de mensagem por lookup
> indexado em `view.db` **dentro da mesma transação de projeção**. O lookup é uma leitura de
> chave primária, determinística e local, e por isso **não** reintroduz a corrida de v1: ele
> lê o estado já projetado do **mesmo prefixo** que o `fold` já interpretou, nunca um estado
> atrasado.
>
> `residency = 'full'` para a comunidade ativa e para toda comunidade em modo host.
> `'light'` para as demais. A troca acontece em `community.activate` (§15.4).

Isso é a única leitura de banco que o `fold` faz, é explicitamente delimitada, é
determinística, e é a razão pela qual a assinatura real do módulo recebe um
`MessageLookup` injetado — uma função pura do prefixo já interpretado.

### 8.2 Pipeline de admissão (ordem fixa, determinística)

Roda **idêntico** em toda réplica, para todo registro, sempre. É a única definição de
"válido" que existe no sistema.

| # | Estágio | Desfecho da falha |
|---:|---|---|
| **0** | **Teto de bytes do registro**, antes de qualquer decode ou verificação de assinatura: `len(rec) ≤ MAX_ENVELOPE_BYTES_ATTACHMENT` (64 KiB, o teto absoluto). Custo O(1) | `REJECTED` — `E_PAYLOAD_TOO_LARGE` |
| 1 | `HostRecord` decodifica; `hostSig` válida sobre a chave do core | `IGNORED` — `E_BAD_HOST_SIGNATURE` |
| 2 | `Envelope`/`Op` decodificam; `v` e `kind` conhecidos; payload casa o layout de §7.4 | `IGNORED` — `E_MALFORMED` / `E_UNKNOWN_KIND`; liga `partialInterpretation` só no caso de versão/`kind` desconhecido |
| 3 | `op.communityId === state.communityId` | `REJECTED` — `E_WRONG_COMMUNITY` |
| 4 | `sig` válida sobre `BLAKE2b('op/1' ‖ op)` com `op.author` | `REJECTED` — `E_BAD_SIGNATURE` |
| 5 | `hostTs ≥ state.lastHostTs` (senão clampa, R-1) e comunidade não `ended` (exceto o próprio `community.end`) | `REJECTED` — `E_COMMUNITY_ENDED` |
| 6 | `authorSeq > lastAuthorSeq[author, sequenceScope]` e `sequenceScope` compatível com o `kind`/alvo | `REJECTED` — `E_DUPLICATE` ou `E_VALIDATION` em `sequenceScope` (é **sucesso** do ponto de vista do cliente só no primeiro caso, §11.6) |
| 7 | `|op.ts − hostTs| ≤ CLOCK_ACCEPT_MS` (24 h) | `REJECTED` — `E_CLOCK_UNREASONABLE` |
| 8 | Autor é membro ativo não banido — exceto `member.join` (o autor é o candidato). Durante a gênese o **principal de gênese** de R-27(a) satisfaz este estágio por construção; não há suspensão | `REJECTED` — `E_NOT_MEMBER` / `E_BANNED` |
| 9 | Sem timeout ativo (`timeoutUntil > hostTs`), exceto `member.leave` | `REJECTED` — `E_TIMED_OUT` |
| 10 | Cotas determinísticas do autor (R-14, R-15) | `REJECTED` — `E_QUOTA_EXCEEDED` |
| 11 | Permissão do `kind` (§9.4) | `REJECTED` — `E_PERMISSION_DENIED` |
| 12 | Hierarquia sobre o alvo, quando aplicável (§9.3) | `REJECTED` — `E_HIERARCHY` / `E_FOUNDER_IMMUNE` / `E_HOST_IMMUNE` |
| 13 | Limites de campo (§8.6) | `REJECTED` — `E_VALIDATION` + `field` |
| 14 | Regras estruturais do `kind` (§8.3) | `REJECTED` — código específico da regra |
| 15 | Emissão de efeitos (§8.4) e avanço do `DS` | `APPLIED` |

Em **todos** os desfechos o estágio final atualiza `interpretedSeq = seq` e, quando o
registro chegou ao estágio 6, também `lastAuthorSeq[author, sequenceScope] = authorSeq` —
inclusive em `REJECTED`. Isso é o que impede um autor de reciclar o número dentro daquele
escopo depois de uma recusa; uma recusa em um canal não avança o contador de outro canal.

O estágio 2 é também a **fronteira de diagnóstico**: assim que o `Op` decodifica, o
`FoldResult` passa a carregar `kind` e `author` (§8.0), em qualquer desfecho posterior. Antes
dele — ou seja, só no estágio 0, o único que recusa sem decodificar — os dois são ausentes, e
é por isso que `rejected_records` os declara anuláveis (§10.3).

**Por que existe um estágio 0 (fecha `HOLE-04`).** `MAX_ENVELOPE_BYTES` e
`E_PAYLOAD_TOO_LARGE` existiam em §26.2/§27.1/§20.2 sem nenhum ponto de aplicação no
`fold`: §14.4 impõe teto **no transporte**, e o host adversário de §1.4 não passa pelo
transporte — ele appenda direto. O teto declarado não vinculava ninguém, e um prefixo de
tamanho hostil fazia o decodificador alocar antes de concluir que a entrada é malformada.
O estágio 0 roda **antes** do estágio 1 justamente para que nem o decode nem o Ed25519
sejam pagos por um registro que já é grande demais; a numeração começa em 0 para **não**
renumerar os quinze estágios existentes, que são referenciados por número em R-27, §9.3,
§20.2 e no plano de validação.

**Ordem que fecha `DS-09` e `T-08` no host:** os estágios 1–7 são baratos. O trabalho caro
por conexão (Ed25519 no estágio 4) roda depois do **controle de admissão do transporte**
(§14.4), que é onde estão o teto de bytes, o token bucket por par e o orçamento de
conexão. O `fold` em si não faz controle de admissão de rede — ele é puro.

### 8.3 Regras estruturais (`R-*`), determinísticas e completas

Toda regra abaixo é decidida **só** com `DecisionState`. Nenhuma consulta relógio, rede,
configuração ou banco fora do `MessageLookup` de §8.1.

| # | Regra | Aplica a | Falha |
|---|---|---|---|
| R-1 | `hostTs` é monotônico não decrescente. Se o registro trouxer `hostTs < lastHostTs`, o `fold` usa `lastHostTs` no lugar (clamp determinístico) e conta `fold.hostTsClamped` | todos | — (clamp, não recusa) |
| R-2 | `|op.ts − hostTsEfetivo| ≤ 24 h` | todos | `E_CLOCK_UNREASONABLE` |
| R-3 | Todo membro ativo contém o cargo base em `roleIds`; remover o base é recusado | `member.setRoles` | `E_BASE_ROLE_REQUIRED` |
| R-4 | Nenhum cargo do alvo pode ter `rank ≥ topRank(autor)`; nenhum cargo atribuído pode ter `rank ≥ topRank(autor)` | `member.setRoles`, `role.*` | `E_HIERARCHY` |
| R-5 | Ninguém concede a um cargo permissão que não possui no conjunto efetivo | `role.create`, `role.update` | `E_PERMISSION_ESCALATION` |
| R-6 | `(type, name)` de canal é único entre não deletados. **O `fold` resolve a corrida pela ordem do log**: o primeiro `APPLIED` fica com o nome; o segundo é `REJECTED` | `channel.create`, `channel.update` | `E_CHANNEL_NAME_TAKEN` |
| R-7 | A comunidade nunca fica sem canal de texto não deletado | `channel.delete`, `category.delete` | `E_LAST_CHANNEL` |
| R-8 | `replyToId`/`threadId` existem, não estão deletados e são do mesmo canal do `channelId` da mensagem | `message.send` | `E_VALIDATION.replyToId` / `.threadId` |
| R-9 | `member.join`: `joinProof` verifica com `invitePublicKey` sobre `BLAKE2b('invite-join/1' ‖ communityId ‖ invitePk ‖ author)`; convite existe, não revogado, não expirado (`hostTs`), `uses < maxUses`; `(invitePk, author)` ainda não usado. Incrementa `uses` **no mesmo passo**. A forma zerada fica restrita ao fundador em gênese (R-27) — ver o buraco de reconstrução de membros da sucessão em §18.8/`sequenciamento` §27 | `member.join` | `E_INVITE_INVALID` / `E_INVITE_EXHAUSTED` |
| R-10 | Ban, kick, saída ou perda de `create_invite` de um membro revogam **todos** os convites que ele criou, no mesmo registro | `mod.ban`, `mod.kick`, `member.leave`, `member.setRoles`, `role.update`, `role.delete` | — (efeito, não recusa) |
| R-11 | O **cargo base** nunca pode conter nenhuma de: `manage_community`, `manage_channels`, `manage_roles`, `manage_messages`, `ban_members`, `kick_members`, `timeout_members`, `mention_everyone`, `view_audit_log`, `voice_mute_others`, `create_invite` | `role.update` sobre `isDefault` | `E_BASE_ROLE_RESTRICTED` |
| R-12 | O cargo base nunca é deletado nem tem `isDefault` removido | `role.delete`, `role.update` | `E_BASE_ROLE_REQUIRED` |
| R-13 | `everyone` na lista de menções só produz `mentionEveryoneEffective = true` se o autor tiver `mention_everyone` **no momento do registro**. Sem a permissão, a mensagem é `APPLIED` com a flag em `false`; o conteúdo não é alterado | `message.send` | — (efeito) |
| R-14 | `member.storageUsedBytes + attachment.sizeBytes ≤ ATTACHMENT_QUOTA_PER_MEMBER` | `message.send` com anexo | `E_QUOTA_EXCEEDED` |
| R-15 | **Cotas de escrita determinísticas por autor** (fecha `HOLE-05`, define o `RingCounter` de §8.1). Seja `S` o `seq` do registro corrente e `J = {r : r.author = autor, S − QUOTA_WINDOW_SEQS < seq(r) ≤ S}` a janela **sobre `seq`, não sobre tempo**. Entram em `J` os registros do autor que **alcançaram o estágio 10**, `APPLIED` ou não — recusar num estágio posterior **não** devolve a cota, pela mesma razão de §7.5 ("uma op recusada antes do append queima o número"): sem isso, um autor inunda o log com ops que falham tarde e não paga nada. O registro corrente **conta na própria verificação**: recusa quando `|J| > QUOTA_OPS_PER_WINDOW` ou `Σ len(payload) sobre J > QUOTA_BYTES_PER_WINDOW`. `RingCounter` é **implementação** dessa função, não contrato — qualquer estrutura que compute o mesmo par (ops, bytes) sobre a mesma janela é conforme | todos exceto `member.join` | `E_QUOTA_EXCEEDED` |
| R-16 | O Fundador original e o host corrente nunca são alvo de `mod.*`; ninguém é alvo de `mod.*` sobre si mesmo | `mod.*` | `E_FOUNDER_IMMUNE` / `E_HOST_IMMUNE` / `E_SELF_TARGET` |
| R-17 | Só o `hostKey` corrente pode `community.end`, `community.setSuccessors`, `community.escrow` | — | `E_NOT_HOST` |
| R-18 | `community.assumeHost` tem **duas camadas de verificação**. **(a) Universal**, feita por toda réplica sem precisar da comunidade de origem: `proof` verifica com `originCommunityId` (que é a chave pública do core antigo, e está no payload da gênese) sobre `BLAKE2b('assume/1' ‖ newCommunityId ‖ originFinalSeq)`. Falhou → `REJECTED`. **(b) Condicional**, feita só por quem tem a comunidade de origem replicada: o autor está em `successorKeys` da origem; `hostTs − lastHostTs(origem) ≥ HOST_INACTIVITY_MS`; e nenhum sucessor de prioridade maior apresentou prova válida. Falhou → o cliente **não migra** e marca a continuação como `disputed`, sem rejeitar o registro (ele não tem base para isso na comunidade nova) | `community.assumeHost` | `E_SUCCESSION_DENIED` (camada a) |
| R-19 | `relay.volunteer`: `possession` verifica sobre `BLAKE2b('relay-possession/1' ‖ relayPublicKey)` com a chave de identidade do autor (§5.2); `expiresAt ≤ hostTs + RELAY_TTL_MS` | `relay.volunteer` | `E_VALIDATION` |
| R-20 | `role.move`, `channel.move`, `role.create`, `channel.create` e `category.create`: `rank` é recalculado pelo `fold` a partir dos vizinhos **no `DS`**, ignorando os enviados quando desatualizados (§6.4.1). **Não existe `category.move`**: a ordem de categoria é definida na criação e não é reordenável no v1 | ops de ordenação | — (efeito) |
| R-21 | `readOnlyForRoleIds` precisa deixar ≥ 1 cargo não deletado de fora, e todos os ids precisam existir | `channel.create`, `channel.update` | `E_VALIDATION.readOnlyForRoleIds` |
| R-22 | `message.send` num canal em que **todos** os cargos do autor estão em `readOnlyForRoleIds` é recusada | `message.send` | `E_CHANNEL_READ_ONLY` |
| R-23 | Máx. 20 emojis distintos por mensagem; `reaction.set{present:true}` que estoure é recusada; `present:false` nunca é recusada | `reaction.set` | `E_REACTION_LIMIT` |
| R-24 | Uma thread por mensagem raiz | `thread.create` | `E_THREAD_EXISTS` |
| R-25 | `category.delete` carrega exatamente um de `moveChannelsTo`/`deleteChannels`; o destino existe e é da mesma comunidade | `category.delete` | `E_VALIDATION` |
| R-26 | Limites de cardinalidade de §26.2 (canais, categorias, cargos, cargos por membro, convites ativos) | ops de criação | `E_LIMIT_EXCEEDED` + `limit` |
| **R-27** | **Lote de gênese.** Os registros de `seq` 0 a 5 formam a gênese: todos precisam ser autorados **pela mesma chave** (que passa a ser `founderKey`), com `authorSeq` 1..6, e com `kind` exatamente na ordem `community.create · role.create · role.create · member.join · category.create · channel.create` (§19.1). **(a) Principal de gênese.** Enquanto `seq ≤ 5` e a comunidade não está `invalid`, o autor do lote é avaliado pelo pipeline de §8.2 como **membro ativo, não banido, sem timeout**, com `efetiva(autor)` = as 17 permissões de §9.1 e `topRank(autor) = RANK_GENESIS` — sentinela estritamente maior que qualquer `rank` atribuível a um cargo. O principal de gênese vale **só** nos `seq` 0..5, não é gravado no `DecisionState` nem em `view.db`, e `RANK_GENESIS` nunca é gravado como `rank` de cargo. **Nenhum estágio de §8.2 e nenhuma regra de §8.3 são suspensos**, exceto **R-9**, que não se aplica ao `member.join` do fundador, o qual carrega `invitePublicKey` e `joinProof` zerados. **(b) Forma dos payloads, verificada pelo `fold`.** `seq` 1 é o cargo Fundador: carrega **exatamente as 17** permissões, recebe `isFounder = true` e `rank = RANK_TOP`. `seq` 2 é o cargo base: carrega um subconjunto de `{send_messages, attach_files, add_reactions, voice_speak, pin_messages}` (R-11 vale desde a criação), recebe `isDefault = true` e `rank = RANK_BOTTOM`. `seq` 3 atribui ao autor `roleIds = {Fundador, base}`. **(d) A gênese não emite auditoria** (fecha `HOLE-17`): `role.create`, `category.create` e `channel.create` estão marcados `Aud. = sim` em §7.4, mas a coluna **não se aplica nos `seq` 0..5**. §6.13 exige `byLabel` congelado no momento da aplicação, e nos `seq` 1, 2, 4 e 5 o autor ainda não é membro — o `member.join` dele é o `seq` 3 —, então o log de auditoria de **toda** comunidade nasceria com quatro entradas cujo `byLabel` é um fragmento de chave em hexadecimal. O lote de gênese é a comunidade vindo a existir, não moderação dentro dela; quem quiser auditar a criação tem os `seq` 0..5 no próprio log. **(c) Verificação por registro, sem retroação.** Cada registro de 0..5 é conferido contra a posição que R-27 exige **dele**. Qualquer desvio — ordem errada, autor diferente, `kind` inesperado, `authorSeq` fora de 1..6, payload fora da forma de (b), `seq` 0 que não seja `community.create` — faz **aquele** registro ser `REJECTED` e marca a comunidade `invalid`; a partir daí **todo** registro do core é `REJECTED`, inclusive os `seq` restantes da gênese e todo `seq ≥ 6`. Registros de `seq` menor já `APPLIED` **não** são revogados: o `fold` interpreta um registro por vez (§8.0) e não tem retroação. A garantia é que toda réplica marca `invalid` no **mesmo** `seq` e a comunidade fica inútil — o cliente recusa abri-la e não entra no swarm dela | `seq` 0..5 | `E_GENESIS_MISPLACED` |

### 8.4 Efeitos e resolução determinística de referência quebrada

O `fold` emite `Effect[]`, que o `projector` aplica em `view.db`. O `Effect` é um tipo
fechado — isso fecha `DR-27` ("o delta agregado do projetor não tem forma"):

```ts
type Effect =
  | { t:'upsert', table: CsTable, key: EntityKey, row: Record<string, Primitive> }
  | { t:'patch',  table: CsTable, key: EntityKey, fields: Record<string, Primitive> }
  | { t:'delete', table: CsTable, key: EntityKey }
  // Formas em lote — escopo FECHADO, não é linguagem de consulta (fecha `HOLE-12`)
  | { t:'patchScope',     scope: EffectScope, fields: Record<string, Primitive> }
  | { t:'ftsRemoveScope', scope: EffectScope }   // ban, canal apagado
  | { t:'ftsIndexScope',  scope: EffectScope }   // ban revogado — fecha `H-20`
  | { t:'ftsIndex',   messageId: Id, content: string }
  | { t:'ftsRemove',  messageId: Id }
  | { t:'audit', entry: ModerationEntry }
  | { t:'recount', what: 'memberCount'|'roleMemberCount'|'threadReplyCount', key: EntityKey }
  | { t:'notify', topic: EventTopic, data: object }   // vira evento IPC (§15.5)
```

O `projector` aplica a lista **na ordem**, dentro de **uma transação por lote**, e emite os
`notify` **depois do commit** (§10.7). Ele não decide nada.

**`patchScope` e por que o escopo é fechado (fecha `HOLE-12`).** Sem forma em lote, um
`mod.ban` de quem tem N mensagens emitia **N** `patch` de ocultação (§6.12, §18.2), e um
`channel.delete` emitia N `patch` de `orphaned`: num canal com 100 k mensagens, uma
transação de 100 k efeitos e uma lista de 100 k itens em memória, por **um** registro. O
escopo é um enum de **três** formas, exatamente as que o v1 precisa — não um predicado
livre, porque um predicado livre viraria linguagem de consulta dentro de material
determinístico, e duas implementações a avaliariam diferente:

```ts
type EffectScope =
  | { s:'messagesOfAuthor',  authorKey: Key }        // mod.ban / mod.revokeBan → hidden_by_ban
  | { s:'messagesOfChannel', channelId: Id }         // channel.delete → orphaned
```

**As duas formas de escopo da FTS, e por que nenhuma carrega texto (fecha `H-20`).**
`ftsRemoveScope` tira do índice tudo o que casa o escopo; `ftsIndexScope` devolve. A segunda
não transporta `content` porque o `fold` não o tem — §8.1 guarda metadado de decisão, não
texto —, e não precisa: o `projector` reindexa a partir do `messages.content` que ele mesmo
materializou, com o predicado que é o **complemento exato** das três remoções (tombstone,
canal apagado, ban). Reindexar não pode ressuscitar o que outra regra tirou.

Sem a forma inversa, `mod.ban` seguido de `mod.revokeBan` devolvia as mensagens às listagens
(`hidden_by_ban = 0`) e as deixava **fora da busca para sempre** — §18.2 promete
reversibilidade sem ressalva, e entregava metade dela. As duas são idempotentes por guarda de
pertença, nos dois sentidos (§10.3), porque o mesmo escopo é alcançado de novo a cada ban
repetido e a cada revogação repetida.

**População de cada `recount` (fecha `H-25`).** O `recount` nomeia *o que* recontar e a
chave da linha que recebe o número; a **população** contada é esta tabela, e nenhuma outra.
O `projector` a calcula a partir das tabelas de `CS` **dentro da mesma transação do lote**
(§10.5 passo 4), depois de todos os `upsert`/`patch`/`patchScope` daquele lote:

| `what` | Linha atualizada | População contada |
|---|---|---|
| `memberCount` | `communities.member_count` | membros da comunidade com `left_at IS NULL` **e** `banned = 0` |
| `roleMemberCount` | `roles.member_count` | os **mesmos** membros, restritos aos que têm o cargo em `member_roles` |
| `threadReplyCount` | `threads.reply_count` | mensagens com `thread_id` = a thread, `deleted_at IS NULL` **e** `orphaned = 0` |

Duas consequências que a tabela decide de propósito:

- **`hidden_by_ban` não subtrai.** A ocultação por ban é reversível (§18.2, `mod.revokeBan`),
  e um contador que oscilasse com ela mostraria a thread perdendo respostas que voltam. Sair
  da listagem é assunto da query, não do contador.
- **`left_at`/`banned` subtraem.** Quem saiu ou foi banido não aparece nas listagens de
  membros nem nas de cargo (§18.1), e um contador que os incluísse contradiria a tela que ele
  legenda.

O determinismo não depende desta escolha — qualquer fórmula fixa converge em toda réplica —,
mas a **semântica** depende, e sem ela cada implementação legendaria a mesma tela com um
número diferente.

A renormalização de §6.4.1 **não** usa `patchScope`: cada item do escopo recebe um `rank`
**diferente**, e uma forma em lote só transporta o mesmo valor para todas as linhas. Ela
emite um `patch` por item, e é aceitável porque o escopo é limitado por §27.1 (≤ 500) e o
evento é raro — ao contrário da ocultação por ban, que é ilimitada no número de mensagens.

O `projector` traduz cada forma em **um** `UPDATE ... WHERE` sobre índice existente. O
`fold` **não** enumera as linhas: `patchScope` não depende de o `DecisionState` conhecer
todas as mensagens, e é isso que mantém o `DS` dentro do orçamento de §26.1. O efeito sobre
o `DS` continua sendo calculado pelo `fold`; o que muda é **como o delta é transportado**
até `view.db`. Acrescentar uma forma nova é mudança de contrato, com bump de
`view_schema_version` — foi o que `ftsIndexScope` custou (`view_schema_version` 1 → **2**), e
o preço é uma reprojeção total no primeiro boot, que §10.5 já sabe fazer.

#### 8.4.1 Referência quebrada — a política que substitui "reducer que lança"

Em v1 uma referência inconsistente lançava e parava a comunidade. Em v2 cada caso tem
**resolução determinística**, e nenhuma delas é uma parada:

| Situação | Resolução determinística |
|---|---|
| `message.send` para canal que o `DS` não conhece ou que está deletado | `REJECTED` no estágio 14 — nunca chega ao efeito |
| Canal deletado **depois** de mensagens existentes | As mensagens ficam com `orphaned = 1`, saem das listagens e da FTS, **não são apagadas** e voltam se o canal for restaurado (não existe restauração no v1, então na prática é permanente) |
| `role.delete` com o cargo referenciado em `channel.readOnlyForRoleIds` | O `fold` remove o id de todas as listas, no mesmo registro (R-10 análogo) |
| `role.delete` com membros | Membros mantidos; o id sai de `roleIds`; se o membro ficar sem cargo, recebe o base |
| `member.setRoles` citando cargo inexistente/deletado | Ids desconhecidos são **descartados** do conjunto (não recusa a op inteira); se sobrar vazio, recebe o base |
| `reaction.set` sobre mensagem deletada | `REJECTED` (`E_MESSAGE_DELETED`) |
| `message.delete` de mensagem já deletada | `APPLIED` idempotente, sem efeito e sem auditoria |
| `mod.ban` de já banido | `APPLIED` idempotente, sem segunda entrada de auditoria |
| Colisão de `rank` | Desempate por id ascendente |
| Colisão de `entityId` | Impossível por construção (§7.3). Se ocorrer, é bug: o segundo é `REJECTED` com `E_ID_COLLISION` e conta `fold.idCollision` |
| `thread.create` sobre raiz deletada | `REJECTED` |
| `community.create` em `seq ≠ 0`, ou gênese fora da forma de R-27 | O registro que desvia é `REJECTED` (`E_GENESIS_MISPLACED`) e a comunidade é marcada `invalid`; a partir daí **todo** registro é `REJECTED`, inclusive os `seq` restantes da gênese. Sem retroação sobre os `seq` já `APPLIED` — R-27(c) |
| Op em `seq ≥ 6` numa comunidade cuja gênese foi rejeitada | `REJECTED` (`E_NOT_MEMBER`) — não há membro nenhum |

### 8.5 Totalidade — a regra que elimina a classe inteira de brick

> **O `fold` nunca lança, nunca aborta, nunca para, e não tem estado `degraded` causado por
> dado.** Toda entrada possível — inclusive bytes aleatórios, `kind` desconhecido, payload
> truncado, referência inexistente, assinatura falsa, ordem impossível — mapeia para
> `APPLIED`, `REJECTED` ou `IGNORED`.

Consequências normativas:

1. `projector.failed` **não existe mais** como estado. O que existe é
   `fold.rejected{reason}` e `fold.ignored{reason}` como métricas.
2. `E_INVARIANT` **não existe mais** como erro de runtime. Virou `fold.propertyViolation`
   (§6.17), que é métrica de bug e não interrompe nada.
3. Uma exceção lançada de dentro do `fold` é **bug de implementação de severidade máxima**.
   O `projector` a captura, registra `fold.panic{seq, kind}`, trata o registro como
   `IGNORED` e **continua**. Isso não é o comportamento pretendido; é a rede de segurança
   para que um bug nunca vire perda de comunidade. O CI de §28.1 tem um fuzzer dedicado a
   provar que ela nunca é acionada.
   O `kind` da métrica é o `kind` do `FoldResult` (§8.0) — presente quando a exceção veio
   **depois** do decode do `Op`, ausente quando veio antes dele, que é o caso em que nenhuma
   camada tem como saber qual era a op. Ausente não é degradação da métrica: `seq` sozinho já
   localiza o registro no core, e o `kind` é o que aponta o handler suspeito.
4. A comunidade só tem dois estados de saúde derivados de dado: `ok` e
   `partialInterpretation` (versão desconhecida, §7.2 regra 5). O estado `degraded` de v1
   passa a significar **exclusivamente** condição de rede/replicação (§14.5).

Isso fecha `F-04`, `F-05`, `F-07`, `F-39`, `F-40`, `DS-01`, `DS-11`, `DS-12`, `DS-19`,
`DR-13`, `DR-14`, `DR-28`.

### 8.6 Limites de campo (tabela única e autoritativa)

Todos são **constantes de protocolo** (§27.1). Nenhum é configurável.

**Unidade de contagem.** Onde a tabela diz **code points**, conta-se escalares Unicode
(`[...string].length`), **nunca grafemas**. Grafema é definido pela tabela de segmentação
do ICU do runtime; ICU tem versão, a versão muda com o Node/Electron e pode ser tailorizada
por locale — o que faria a interpretação do log função do ambiente e violaria §1.5. O
`fold` **não** chama `Intl.Segmenter`. Contagem de grafema é assunto de UI: o contador de
caracteres do formulário pode ser grafêmico, e é advisório por §8.7.

**Consequência para `Reaction.emoji` e `Community.iconEmoji`.** Os limites abaixo são tetos
determinísticos, não um julgamento de "isto é um emoji" — o `fold` aceita qualquer string
dentro deles. A semântica "uma reação é **um** emoji" passa a ser garantida pelo **seletor
curado** da interface, que é a única origem desses campos na UI
(`deltas-ux-v2.md` **U-30**). Toda réplica precisa **renderizar** o que estiver no log,
mesmo fora do catálogo dela: o registro foi aceito, e esconder estado aceito é divergência.

| Campo | Mín | Máx | Normalização | Erro |
|---|---|---|---|---|
| `Identity.displayName` | 2 code points | 32 code points | `trim`, colapsa espaço interno, NFKC | `E_VALIDATION.displayName` |
| `Community.name` | 2 | 40 | `trim`, NFKC | `.name` |
| `Community.description` | 0 | 120 | `trim` | `.description` |
| `Community.iconEmoji` | 1 code point | 8 code points / 32 bytes | — | `.iconEmoji` |
| `Category.name` | 1 | 32 | `trim`, NFKC | `.name` |
| `Channel.name` (texto) | 1 | 32 | NFD → remove diacrítico → minúsculo → espaço vira `-` → descarta o resto → colapsa `-` repetido → `trim('-')`. Resultado precisa casar `^[a-z0-9][a-z0-9-]{0,31}$` | `.name` / `E_CHANNEL_NAME_EMPTY` |
| `Channel.name` (voz) | 1 | 32 | `trim`, preserva caixa e espaço, NFKC | `.name` |
| `Channel.topic` | 0 | 120 | `trim`; só em texto | `.topic` |
| `Role.name` | 1 | 32 | `trim`, NFKC | `.name` |
| `Member.nickname` | 1 | 32 | `trim`; vazio ⇒ `null` (remover, não erro) | `.nickname` |
| `Message.content` | 1 | 4000 code points / 16384 bytes | `trim` no fim; preserva quebra de linha | `.content` |
| `Message.mentions` | 0 | 64 itens | ids duplicados colapsam | `.mentions` |
| `Reaction.emoji` | 1 code point | 8 code points / 32 bytes | — | `.emoji` |
| `reason` (moderação) | 0 | 200 | `trim` | `.reason` |
| `Attachment.name` | 1 byte | 255 bytes | **Rejeita** (não remove) se contiver `/ \ \0`, controle, ou casar `^(CON\|PRN\|AUX\|NUL\|COM[1-9]\|LPT[1-9])(\..*)?$` case-insensitive, ou terminar em `.` ou espaço | `.name` |
| `Attachment.sizeBytes` | 1 | `ATTACHMENT_MAX_BYTES` (8 GiB) | — | `E_ATTACHMENT_TOO_LARGE` |
| Registro **sem** anexo | — | `MAX_ENVELOPE_BYTES` (32 KiB) | Conferido no estágio 13, depois do decode revelar se há anexo | `E_PAYLOAD_TOO_LARGE` |
| Registro **com** anexo | — | `MAX_ENVELOPE_BYTES_ATTACHMENT` (64 KiB) | Teto absoluto, já conferido no **estágio 0** | `E_PAYLOAD_TOO_LARGE` |
| `Invite.maxUses` | 1 | 10000 | inteiro | `.maxUses` |
| `Invite.expiresAt` | `hostTs+60s` | `hostTs+365d` | — | `.expiresAt` |
| `Invite.label` | 0 | 40 code points | `trim` | `.label` |
| `Timeout.until` | `hostTs+60s` | `hostTs+30d` | — | `.until` |
| `successorKeys` | 0 | 5 | sem duplicata, sem o próprio host | `.successorKeys` |

**Nome de anexo: rejeitar, não sanitizar.** v1 removia caracteres, o que pode fazer dois
nomes distintos colapsarem no mesmo e esconder travessia de caminho (`T-37`). v2 rejeita na
origem e, no disco, o arquivo é gravado como `<blobIdHex>-<nome>` — o prefixo garante
unicidade mesmo com nomes iguais.

### 8.7 Onde a validação acontece, e o que isso significa

| Ponto | Papel | Autoridade |
|---|---|---|
| **Cliente, antes de enfileirar** | `fold.wouldAccept(localDS, opCandidata)` — erro inline no formulário | **Advisória.** Pode divergir do host por estar atrás. Divergir é esperado e inofensivo |
| **Host, antes do append** | O mesmo `fold`, contra o `DS` do host **na cabeça do log**, dentro da seção crítica de §11.4 | **Preditiva e vinculante para o append.** Se recusa, nada é appendado e o cliente recebe o erro tipado |
| **Toda réplica, ao interpretar** | O mesmo `fold`, sobre o registro já appendado | **Normativa.** É o que define o estado |

Como é a mesma função e o host valida contra a cabeça, os dois últimos concordam sempre —
exceto se o host for adversário, e é exatamente aí que o terceiro ponto protege.

**Fecha `F-11` e a §9.2 de v1:** "compartilhar o mesmo TypeScript impede divergência" era
falso. v2 não depende disso: depende de o `fold` **não ler configuração nem relógio**
(§1.5), o que torna a convergência estrutural, e de a validação do cliente ser
explicitamente advisória.

---

## 9. Autorização e permissões

### 9.1 Catálogo (17 permissões, fechado)

Idêntico ao que o frontend já implementa. O backend não acrescenta nem remove nenhuma.

O número da coluna `#` é **constante de protocolo** (§27.1): é ele que viaja em
`arr<u8> permissions` de `role.create`/`role.update` (§7.4.3), dentro de **material
assinado**. Dois clientes com numerações diferentes concederiam permissões diferentes
lendo o mesmo log. A numeração é a ordem desta tabela, é fixa, e **nenhum número é
reaproveitado**: uma permissão futura recebe o próximo inteiro livre, nunca o de uma
removida.

| # | Grupo | Permissão | Autoriza |
|---:|---|---|---|
| 0 | Geral | `manage_community` | `community.update`; revogar qualquer convite; ver 3.1b |
| 1 | | `manage_channels` | Todas as ops de `channel.*` e `category.*` |
| 2 | | `view_audit_log` | Ler `moderation_log`, `bans`, `timeouts` (§15.6, enforcement real) |
| 3 | Texto | `send_messages` | `message.send`, `thread.create` |
| 4 | | `attach_files` | Anexo em `message.send` |
| 5 | | `add_reactions` | `reaction.set` |
| 6 | | `mention_everyone` | `mentionEveryoneEffective` (R-13) |
| 7 | | `pin_messages` | `message.pin` |
| 8 | | `manage_messages` | `message.delete` de outro autor |
| 9 | Voz | `voice_speak` | Entrar em canal de voz |
| 10 | | `voice_mute_others` | Silenciar outro participante na chamada |
| 11 | | `voice_share_screen` | `share.start` |
| 12 | Moderação | `create_invite` | `invite.create`; revogar o próprio |
| 13 | | `kick_members` | `mod.kick` |
| 14 | | `ban_members` | `mod.ban`, `mod.revokeBan` |
| 15 | | `timeout_members` | `mod.timeout`, `mod.removeTimeout` |
| 16 | | `manage_roles` | `role.*`, `member.setRoles` |

Um `u8` fora de `0..16` em `permissions` é `REJECTED` com `E_VALIDATION.permissions` no
estágio 13 — não é ignorado silenciosamente, senão um cliente futuro concederia uma
permissão que este binário não vê e as duas réplicas discordariam do conjunto efetivo.

### 9.2 Permissão efetiva

`efetiva(membro) = união das permissões de todos os cargos ativos`. Sem negação, sem
override por canal, sem herança. Única exceção por canal: `readOnlyForRoleIds` (R-22) — o
membro perde `send_messages` naquele canal se **todos** os seus cargos estiverem na lista.

O host é `Fundador` e o `Fundador` tem as 17. Não há superusuário fora do sistema de cargos.

### 9.3 Hierarquia

`topRank(membro)` = maior `rank` entre os cargos ativos, na ordenação lexicográfica de
§6.4.1.

**Regra única:** o autor só age sobre alvo cujo `topRank` seja **estritamente menor** que o
seu. Nunca igual, nunca maior. Fundador original e host corrente nunca são alvo.

**Ordem dentro do estágio 12 (fecha `HOLE-16`).** A imunidade do alvo é conferida
**antes** da comparação de `rank`, nesta ordem:

1. alvo é o cargo Fundador → `E_FOUNDER_IMMUTABLE`; alvo é `role.move` que levaria um
   cargo a `rank ≥` o do Fundador → `E_FOUNDER_TOP`;
2. alvo é o Fundador original → `E_FOUNDER_IMMUNE`; alvo é o host corrente →
   `E_HOST_IMMUNE`; alvo é o próprio autor em `mod.*` → `E_SELF_TARGET` (R-16);
3. só então `topRank(alvo) < topRank(autor)` → senão `E_HIERARCHY`.

Sem essa ordem, `E_FOUNDER_IMMUTABLE` e `E_FOUNDER_TOP` eram **inalcançáveis**: o cargo
Fundador tem sempre o `rank` máximo, então a comparação genérica de R-4 recusava antes,
com `E_HIERARCHY`, **para todo autor — inclusive o próprio Fundador**. Dois códigos do
catálogo de §20.2 nunca apareciam, e a UI de §20.3 não tinha como dizer "este cargo não é
editável" em vez de "você não tem hierarquia sobre ele". A alternativa era remover os dois
códigos do catálogo, e foi descartada: a mensagem específica é a que o usuário consegue
agir sobre.

**Três regras de anti-escalada** (v1 tinha duas e nenhuma cobria o cargo base — `F-38`,
`T-35`):

- **R-5** ninguém concede permissão que não tem;
- **R-4** ninguém cria, edita ou move cargo para `rank ≥` o próprio topo;
- **R-11** o cargo base nunca pode ter permissão de gestão, moderação ou menção global.

R-11 é a que fecha o vetor real: sem ela, editar o cargo base — que **todo membro presente,
futuro e reingressante recebe automaticamente** — concedia moderação a toda a comunidade.

### 9.4 Matriz de enforcement por `kind`

Consolidada nas colunas `Perm.`/`Hier.` de §7.4. O `fold` lê **dessa tabela**,
declarativamente. Um `kind` sem linha na tabela falha fechado com `E_UNKNOWN_KIND`.

### 9.5 Os pontos de enforcement (v2)

| Ponto | O que faz | Natureza |
|---|---|---|
| **Controle de admissão do transporte** (§14.4) | Teto de bytes, orçamento de conexão, token bucket por par, antes de qualquer trabalho caro | Proteção de recurso, **não** autorização |
| **Autorização de canal de replicação** (§14.3) | Um par só replica o core de uma comunidade se for membro ativo não banido segundo o `DS` local | Autorização, distribuída |
| **`fold` no host, antes do append** | Recusa a op | Preditivo |
| **`fold` em toda réplica** | Decide o efeito | **Normativo** |
| **Queries com escopo de permissão** (§15.6) | `view_audit_log`, `manage_community` e afins filtram a resposta | Confidencialidade local |
| **UI** | Esconde o botão | Cosmético |

A UI esconder nunca é enforcement. Um cliente adulterado que mostre todos os botões
consegue exatamente nada.

---

## 10. Persistência

### 10.1 Layout em disco

Tudo sob `<userData>/p2p/` (sobrescrevível por `P2P_DATA_DIR`, §27.2):

```
p2p/
  LOCK                          lock composto (§10.8)
  manifest.db  (+ -wal/-shm)    LS — autoritativo local, synchronous=FULL
  view.db      (+ -wal/-shm)    DS snapshot + CS + FTS5, synchronous=NORMAL
  cores/                        corestore (RocksDB): log e blobs
  blobs/<blobsCoreKeyHex>/      cache local de anexos verificados
  staging/<ticketId>            staging de upload retomável (§13.5)
  logs/core-YYYY-MM-DD.ndjson   log estruturado
```

**Decisão:** um `view.db` para todas as comunidades (busca global e não-lidas cruzam
comunidades), com isolamento por coluna `community_id` **indexada em toda tabela** e
presente em **toda** chave primária. Isso é o que impede o vazamento entre comunidades que
`T-30`/`T-25` exploravam.

### 10.2 `manifest.db` — schema

**Nunca é apagado por reprojeção. Nunca é reconstruído a partir do log.** É a resposta
direta ao blocker B2.

| Tabela | Colunas | Notas |
|---|---|---|
| `meta` | `key TEXT PK`, `value TEXT` | `manifest_schema_version`, `identity_public_key`, `wipe_state`, `install_id` |
| `secrets` | `name TEXT PK`, `ciphertext BLOB`, `nonce BLOB` | `data_key` (embrulhada por `safeStorage`), `identity_seed` (cifrada pela Data Key) |
| `communities` | `community_id TEXT PK`, `core_key BLOB NOT NULL`, `blobs_key BLOB NOT NULL`, `community_seed_enc BLOB`, `community_seed_nonce BLOB`, `is_host INT NOT NULL`, `joined_at INT NOT NULL`, `left_at INT`, `removed_reason TEXT`, `retain_until INT`, `origin_community_id TEXT` | `community_seed_enc` só existe para comunidades hospedadas. **Esta tabela é a enumeração autoritativa de participação** |
| `member_blobs_core` | `community_id TEXT PK`, `core_key BLOB`, `secret_seed_enc BLOB` | Core de blobs local por comunidade (§13.1) |
| `local_author_seq` | `community_id TEXT`, `sequence_scope TEXT`, `next_author_seq INT NOT NULL` · **PK `(community_id, sequence_scope)`** | §7.5 |
| `local_outbox` | §11.2 | — |
| `local_read_state`, `local_thread_read_state`, `local_channel_pref`, `local_community_pref`, `local_navigation`, `local_relay_consent`, `local_device_pref`, `local_participant_volume`, `local_blob_cache`, `local_blob_staging` | §6.15 | — |
| `invite_secrets` | `invite_public_key BLOB PK`, `community_id TEXT`, `secret BLOB`, `label TEXT` | Só dos convites criados nesta instalação |

#### 10.2.1 Migração de `manifest.db`

`manifest.db` **não** é descartável, então tem migração de verdade: uma sequência numerada
de scripts idempotentes (`001_init.sql`, `002_...`), aplicados em transação, com
`manifest_schema_version` avançado na mesma transação. Downgrade não é suportado
(`E_SCHEMA_AHEAD`). Fecha `DR-20` ("tabelas locais preservadas na reprojeção não têm
caminho de migração").

A emenda de `sequenceScope` exige migração do schema de `local_author_seq` e de
`local_outbox`, mas **não** reinterpreta envelopes da versão experimental 1. Como nenhum
binário de produto foi publicado com ela, as fixtures e os diretórios de desenvolvimento
anteriores são recriados; uma migração de comunidades já publicadas exigiria contrato
próprio e não é inventada nesta fase. A tabela derivada `observed_ops` incrementa
`view_schema_version`; o schema de produto desta emenda é **3** e a tabela é recriada junto
com as demais tabelas de `view.db`.

### 10.3 `view.db` — schema

**Totalmente derivado.** Apagar e reprojetar reconstrói byte a byte. Toda PK inclui
`community_id`.

#### Estado de Decisão (snapshot)

| Tabela | Colunas | Notas |
|---|---|---|
| `ds_snapshot` | `community_id TEXT PK`, `interpreted_seq INT`, `blob BLOB`, `fold_build_id TEXT NOT NULL`, `taken_at INT` | Serialização do `DecisionState` **exceto** `messages`/`rootOfThread`. Acelera o boot; se ausente ou inconsistente, o `fold` recomeça do `seq` 0 (§10.6) |

**`fold_build_id` (fecha `H-22`).** §10.6 exige que o snapshot carregue o hash do binário do
`fold` e seja descartado quando ele não bate; sem a coluna o requisito é inexpressável, e a
única representação possível é esta — a mesma família de `HOLE-11` e `H-19`. `TEXT NOT NULL`
porque um snapshot sem procedência **é** um snapshot inválido: quem não sabe qual `fold`
produziu o estado não pode herdá-lo.

#### Estado de Conteúdo

| Tabela | Colunas (tipo, restrição) | Índices |
|---|---|---|
| `communities` | `id TEXT NOT NULL` · `core_key BLOB NOT NULL` · `blobs_key BLOB NOT NULL` · `host_key BLOB NOT NULL` · `founder_key BLOB NOT NULL` · `name TEXT NOT NULL` · `icon_emoji TEXT` · `icon_color TEXT NOT NULL` · `description TEXT` · `created_at INT NOT NULL` · `member_count INT NOT NULL DEFAULT 0` · `ended_at INT` · `origin_community_id TEXT` · `successor_keys TEXT` — **PK `(community_id, id)`** | — |
| `members` | `community_id TEXT` · `identity_key BLOB` · `display_name TEXT NOT NULL` · `avatar_color TEXT NOT NULL` · `nickname TEXT` · `blobs_core_key BLOB` · `joined_at INT NOT NULL` · `left_at INT` · `banned INT NOT NULL DEFAULT 0` · `timeout_until INT` · `storage_used_bytes INT NOT NULL DEFAULT 0` · `display_name_collision INT NOT NULL DEFAULT 0` — **PK `(community_id, identity_key)`** | `idx_members_active(community_id, left_at, banned)` |
| `member_roles` | `community_id` · `identity_key` · `role_id` — PK dos três | `idx_member_roles_role(community_id, role_id)` |
| `roles` | `community_id TEXT` · `id TEXT` · `name` · `color` · `rank TEXT NOT NULL` · `permissions TEXT NOT NULL` (JSON) · `mentionable INT` · `is_founder INT` · `is_default INT` · `member_count INT` · `deleted_at INT` — **PK `(community_id, id)`** | `idx_roles_rank(community_id, rank DESC)` |
| `categories` | `community_id` · `id` · `name` · `rank TEXT` · `deleted_at` — PK `(community_id, id)` | `idx_categories_rank(community_id, rank)` |
| `channels` | `community_id` · `id` · `category_id` · `type` · `name` · `topic` · `rank TEXT` · `read_only_role_ids TEXT` (JSON) · `deleted_at` — PK `(community_id, id)` | `uniq_channels_name(community_id, type, name) WHERE deleted_at IS NULL`; `idx_channels_cat(community_id, category_id, rank)` |
| `observed_ops` | `community_id` · `op_id` · `seq INT NOT NULL` · `author_key BLOB NOT NULL` · `sequence_scope TEXT NOT NULL` · `author_seq INT NOT NULL` — **PK `(community_id, op_id)`** | `idx_observed_ops_seq(community_id, seq)`; contém somente registros `APPLIED` e é o índice derivado consultado pela reconciliação (§11.6) |
| `messages` | `community_id` · `id` · `seq INT NOT NULL` · `channel_id` · `author_key BLOB` · `content TEXT` (**NULL quando tombstonada** — fecha `DR-17`) · `author_ts INT` · `host_ts INT` · `clock_skewed INT` · `edited_at INT` · `pinned INT` · `reply_to_id TEXT` · `thread_id TEXT` · `mentions TEXT` (JSON) · `mention_everyone_effective INT` · `deleted_at INT` · `hidden_by_ban INT` · `orphaned INT` — PK `(community_id, id)` | `idx_messages_channel(community_id, channel_id, seq DESC)`; `idx_messages_author(community_id, author_key)`; `idx_messages_pinned(community_id, channel_id) WHERE pinned=1`; `idx_messages_thread(community_id, thread_id, seq)` |
| `messages_fts` | FTS5 **contentless-delete** (`content=''`), colunas `content`, com `rowid = messages.rowid`, `tokenize='unicode61 remove_diacritics 2'`, `prefix='2 3'` | — |
| `message_links` | `community_id` · `message_id` · `idx INT` · `url TEXT` · `host TEXT` · `seq INT` — PK `(community_id, message_id, idx)` | `idx_links_channel(community_id, message_id)` — fecha `DR-38` |
| `attachments` | `community_id` · `message_id` · `owner_key BLOB` · `blobs_core_key BLOB` · `blob_id TEXT` (JSON) · `name` · `size_bytes INT` · `kind` · `hash BLOB` — PK `(community_id, message_id)` | `idx_attachments_owner(community_id, owner_key)` |
| `reactions` | `community_id` · `message_id` · `emoji` · `identity_key BLOB` · `at INT` — PK dos quatro | `idx_reactions_message(community_id, message_id)` |
| `threads` | `community_id` · `id` · `root_message_id` · `channel_id` · `reply_count INT` · `root_deleted INT` — PK `(community_id, id)`; `UNIQUE(community_id, root_message_id)` | — |
| `invites` | `community_id` · `invite_public_key BLOB` · `created_by BLOB` · `created_at INT` · `expires_at INT` · `max_uses INT` · `uses INT` · `revoked_at INT` · `label TEXT` — PK `(community_id, invite_public_key)` | `idx_invites_community(community_id, revoked_at)` |
| `bans` | `community_id` · `target_key BLOB` · `by_key BLOB` · `at INT` · `reason` · `revoked_at INT` — PK `(community_id, target_key)` | — |
| `timeouts` | `community_id` · `target_key BLOB` · `by_key BLOB` · `at INT` · `until INT` · `reason` — PK `(community_id, target_key)` | `idx_timeouts_until(community_id, until)` |
| `moderation_log` | `community_id` · `id` · `seq INT` · `type` · `target_id` · `target_label` · `by_key BLOB` · `by_label TEXT` · `reason` · `at INT` — PK `(community_id, id)` | `idx_modlog(community_id, seq DESC)`; `idx_modlog_type(community_id, type, seq DESC)` |
| `relay_volunteers` | `community_id` · `identity_key BLOB` · `relay_public_key BLOB` · `since INT` · `expires_at INT` · `withdrawn_at INT` — PK `(community_id, identity_key)` | — |
| `rejected_records` | `community_id` · `seq INT` · `kind INT` · `author_key BLOB` · `reason TEXT` — PK `(community_id, seq)` | Só para diagnóstico; podado acima de `REJECTED_LOG_MAX` linhas por comunidade. `kind`/`author_key` vêm do `FoldResult` (§8.0) e são **`NULL` exatamente** quando o `Op` não decodificou — ou seja, só na recusa do estágio 0 |
| `meta` | `key TEXT PK` · `value TEXT` | Chaves em §10.3.1 |

**FTS5 (fecha `DR-16`):** o índice **não** usa triggers de external-content. O `projector`
emite `ftsIndex`/`ftsRemove` explicitamente, aplicados **na mesma transação** que o
`upsert`/`patch` da mensagem, sempre depois dele. Reprojeção reconstrói o índice do zero
junto com a tabela. Sem ordem implícita, sem rollback parcial.

**Remoção em contentless-delete é por comando, e precisa de guarda.** Uma tabela FTS5 com
`content=''` não aceita `DELETE FROM`: a única remoção é o comando especial `'delete'`, e
mandá-lo para um `rowid` **já removido** corrompe o índice (`SQLITE_CORRUPT_VTAB`) — não é
no-op. Como o escopo de um ban alcança mensagens que já saíram do índice por `message.delete`,
e um `mod.ban` repetido alcança o mesmo conjunto de novo, a remoção é normativamente
**idempotente**: o `'delete'` roda com guarda de pertença (`rowid` que ainda está no índice),
em **um** comando por escopo, coerente com "cada forma vira um `UPDATE … WHERE`" de §8.4.
Está aqui, e não na implementação, porque a forma ingênua não falha no teste feliz: ela
corrompe o índice do usuário no segundo ban.

#### 10.3.1 Chaves de `meta` — lista fechada (fecha `H-23` e `H-24`)

`view_schema_version` e `op_version` sozinhas não sustentam o boot: §8.5 e §10.5 exigem um
marcador de `fold.panic` que **sobreviva ao processo**, e §10.3 exige detectar snapshot
"ausente ou inconsistente" — o que, depois de um crash entre duas cadências de snapshot, só é
decidível com o `interpretedSeq` do último lote **commitado**. Nenhum dos dois marcadores
cabe numa tabela derivada de `CS`: eles são estado da própria interpretação.

Um `view.db` serve **todas** as comunidades (§10.1), então toda chave por comunidade carrega
o `communityId` no nome. Quem escreve é sempre o `projector`, único escritor de `view.db`
(§21.1). A lista é fechada:

| Chave | Valor | Quando é escrita |
|---|---|---|
| `view_schema_version` | versão de schema do binário | na criação e na recria do schema (§10.5) |
| `op_version` | `OP_VERSION` de `opCodec` (§7.2) | idem — é a versão de protocolo que materializou esta `view.db` |
| `fold_panic:<communityId>` | `seq` do registro que fez o `fold` lançar (§8.5) | na **mesma transação** do lote em que o pânico aconteceu; some no `wipe` da reprojeção |
| `interpreted_seq:<communityId>` | `interpretedSeq` do último lote commitado | na **mesma transação** dos efeitos de cada lote (§10.5 passo 4) |

**Por que `op_version` obriga uma emenda em §4.** A constante mora em `opCodec` (L1), o
`projector` é o único que pode escrevê-la (§21.1) e `view` (L0) não pode importar L1 — a
barreira de camadas quebra o build antes. A resolução é a que §4 já prevê para o caso:
**declarar a importação lateral**, e `opCodec` entra na coluna "Depende de" do `projector`.
Só a constante: o `projector` continua proibido de decodificar registro, e é por isso que
`kind`/`author` chegam pelo `FoldResult` (§8.0) e não por um decode dele.

### 10.4 PRAGMAs e durabilidade

| Banco | PRAGMAs |
|---|---|
| `manifest.db` | `journal_mode=WAL` · **`synchronous=FULL`** · `foreign_keys=OFF` · `busy_timeout=5000` · `temp_store=MEMORY` · `cache_size=-8000` |
| `view.db` | `journal_mode=WAL` · **`synchronous=NORMAL`** · `foreign_keys=OFF` · `busy_timeout=5000` · `temp_store=MEMORY` · `mmap_size=268435456` · `cache_size=-32000` |

**Por que dois bancos e não um (fecha `DS-04`, `B5`):** `NORMAL` é aceitável para dado
reconstruível e inaceitável para outbox, contadores `authorSeq`, sementes e participação.
v1 aplicava `NORMAL` aos dois. v2 separa fisicamente, porque `synchronous` é por conexão de
banco, não por tabela.

`foreign_keys=OFF` é deliberado: a integridade referencial é do `fold`; tombstone lógico
não combina com FK, e uma FK que dispara mid-transação reintroduziria o "reducer que
lança".

### 10.5 Projetor e reprojeção

**Algoritmo, por comunidade:**

1. Carrega `DecisionState` (§10.6).
2. Lê do core em lotes de `PROJECTOR_BATCH` registros a partir de `interpretedSeq + 1`.
3. Para cada registro: `foldRecord(ds, rec, seq)`.
4. **Uma transação `view.db` por lote.** Dentro dela: aplica todos os `Effect` **na ordem**,
   registra em `observed_ops` cada registro `APPLIED`, recalcula os `recount` (a população de
   cada um está em §8.4), atualiza `local_read_state` (que vive em `manifest.db` — ver a
   barreira abaixo) e grava o `interpretedSeq` do lote em `meta.interpreted_seq:<communityId>`
   (§10.3.1). Registros `REJECTED` e `IGNORED` nunca entram em `observed_ops`.
5. Commit. **Depois do commit**, emite os `notify` como eventos IPC.
6. Repete até `core.length`; depois reage a `append`.

**Barreira entre os dois bancos (fecha `DS-18`):** `local_read_state` está em
`manifest.db`, e não há transação distribuída entre dois arquivos SQLite. A ordem é
normativa: **primeiro commita `view.db`, depois commita `manifest.db`, depois emite os
eventos.** Um crash entre os dois deixa o read state atrasado, o que é reconciliável e
inofensivo: no boot, `local_read_state` é **recomputado** para todo canal cujo
`last_read_seq > interpretedSeq` ou cujo `unread_count` não bata com a query — uma varredura
indexada barata. Nenhum cache depende de um evento que pode ter se perdido: o boot sempre
reconsulta.

**Reprojeção total** dispara quando `view_schema_version` ≠ binário, por
`core.reproject`, por `fold.panic` (§8.5) registrado no boot anterior
(`meta.fold_panic:<communityId>`, §10.3.1), ou quando o snapshot está ausente ou
inconsistente (§10.6).

Procedimento (fecha `DR-21`, `DS-19`):

1. **Lê a lista de comunidades de `manifest.communities`** — não de `view.db`.
2. `DROP`/recria **todas** as tabelas de `view.db` (`DS` snapshot, `CS`, FTS).
3. Para cada comunidade, `fold` do `seq` 0 até `core.length`.
4. Recomputa `local_read_state` e `local_thread_read_state` do zero.
5. Nada em `manifest.db` além do read state é tocado.

Acima de `REPROJECT_PROGRESS_SEQ` registros, emite `core.reprojecting{done,total}` e a UI
mostra barra (**a UX precisa dessa tela** — delta U-11).

### 10.6 Snapshot de `DecisionState`

Boot precisa ser rápido; refazer o `fold` de 200 000 registros a cada abertura não fecha
com o alvo de §26.1.

- A cada `DS_SNAPSHOT_INTERVAL` registros interpretados, e no `draining`, o `projector`
  serializa o `DecisionState` (exceto `messages`/`rootOfThread`) em `ds_snapshot`.
- No boot, carrega o snapshot e continua do `interpreted_seq` gravado.
- O snapshot carrega o **hash do binário do `fold`** (`foldBuildId`, coluna
  `ds_snapshot.fold_build_id` de §10.3). Se não bater, é descartado e o `fold` recomeça do 0.
  Isso garante que uma mudança na função de interpretação nunca herde estado interpretado
  pela versão anterior.
- **"Inconsistente" tem definição.** O snapshot é gravado a cada `DS_SNAPSHOT_INTERVAL`
  registros, mas o `interpretedSeq` do último lote **commitado** é gravado a cada lote
  (§10.3.1). Um crash entre duas cadências deixa `view.db` adiante do snapshot, e retomar
  dele reaplicaria efeitos já materializados. Então o snapshot só é aproveitável quando
  `ds_snapshot.interpreted_seq` == `meta.interpreted_seq:<communityId>`; qualquer outra
  combinação — incluindo marcador ausente — é inconsistente, e o `fold` recomeça do `seq` 0.
- O snapshot é **cache**, não verdade: sua perda custa tempo de boot, nunca dado.

### 10.7 Transações e barreiras — tabela normativa

| Escopo | Garantia | Como |
|---|---|---|
| Lote de projeção (`view.db`) | Atômico | Uma transação por lote |
| `local_read_state` (`manifest.db`) | Atômico por lote, **depois** do commit de `view.db` | §10.5, com reconciliação no boot |
| Emissão de eventos IPC | **Sempre depois** de ambos os commits | Evento é sinal, nunca fonte |
| Append no host | O grupo é todo commitado ou nenhum ACK é liberado; a decisão fica provisória até o commit | Reserva sob a seção crítica de §11.4; append fora dela |
| Durabilidade do append | `await core.append(...)` — a resolução da promessa **é** a barreira | §11.4 e §10.7.1. `REQUIRES POC` — G4 mede o que sobra: queda de energia e a matriz de §28.3 |
| Gênese da comunidade | Atômica no log | Um único `core.append([...6 registros])` (§19.1) |
| Resgate de convite | Serializado por comunidade | Mesma fila de §11.4; `uses` é `DS` |
| Enfileirar na outbox | Atômico e durável (`FULL`) | Transação em `manifest.db` |
| Blob e mensagem | **Não** transacional, com barreira explícita | §13.7 |
| Escrita local (prefs, read state) | Atômico por operação | Transação implícita |

#### 10.7.1 A barreira do append não é uma segunda chamada (fecha `P1`)

A linha acima dizia `await core.append(...)` **e** `await core.flush()`. A segunda metade não
é implementável em `hypercore@11.35.1`, e a razão importa:

- **`core.flush` não existe** na sessão de Hypercore. O que existe é `core.state.flush()`, do
  `SessionState`, e ele **não** é uma barreira de durabilidade: ele commita a transação de
  escrita ativa (`_activeTx`). Chamá-lo depois de um append lança `TypeError` — porque
  `append()` **já o chamou**, e `_activeTx` voltou a ser `null`.
- É esse o ponto: `append()` monta a transação, escreve blocos, árvore, bitfield e cabeça, e
  só resolve **depois** de `View.flush()` levar o lote ao motor de armazenamento (RocksDB).
  Quando o `await` volta, a escrita já foi commitada. Não há segunda chamada a fazer, e
  pedi-la no normativo era pedir um erro em tempo de execução.

**O que foi medido** (2026-08-17, Node 22 / WSL2 / ext4, `hypercore@11.35.1`): um processo que
appenda *N* registros e se mata com `SIGKILL` **imediatamente** depois de o último `await`
resolver — sem `close`, sem checkpoint — deixa os *N* registros legíveis na reabertura.
Reproduzido com *N* = 1, 50 e 500, 100 % em todas.

**O que continua aberto, e é de G4.** A medida acima cobre **morte de processo**, que é o
oráculo de §28.3 (`SIGKILL` em cada ponto da matriz). Ela **não** cobre queda de energia nem
pânico de kernel, e não há como concluí-lo por leitura: `rocksdb-native` não expõe
`WriteOptions` no caminho de escrita — `rocksdb_write()` é chamado sem opções —, e o padrão do
RocksDB é `sync = false`, o que deixa o WAL no cache de página do sistema sem `fsync`. Um
`SIGKILL` não perde cache de página; um corte de energia perde. Enquanto G4 não medir com
`fsync` observado, vale o piso conservador:

> **Regra normativa:** a barreira do append garante durabilidade contra **falha de processo**,
> não contra falha de energia. Nenhuma superfície pode prometer mais do que isso ao usuário
> (§24.1), e o eixo otimista de §11.1 continua correto justamente porque a outbox de §11.2
> vive em `manifest.db` com `synchronous=FULL` — a fila é a garantia forte, o log não precisa
> ser.

G4 mede a matriz de §28.3 inteira contra o caminho de escrita **completo** (outbox +
`communityHost` + grupo de commit de §11.5), que é código da fase 3; o que está fechado aqui é
só a pergunta "qual é a primitiva", que era o bloqueio de spec.

---

### 10.8 Lock composto e instância única

Um único processo núcleo por diretório de dados. O lock é **composto** e adquirido nesta
ordem exata, sempre:

1. `app.requestSingleInstanceLock()` no main (instância de aplicação).
2. Lock exclusivo de arquivo em `p2p/LOCK` (`flock`/`LockFileEx`), mantido pelo **núcleo**,
   com o PID e o `install_id` gravados dentro.
3. Abertura do RocksDB do corestore (que tem lock próprio).
4. Abertura de `manifest.db` e `view.db`.

Regras:

- Falha em (1) → o main encaminha o argv à instância viva e encerra silenciosamente.
- Falha em (2) → `E_CORE_ALREADY_RUNNING` com o PID; **lock órfão** (PID inexistente ou de
  outro `install_id`) é quebrado automaticamente, com log `lock.stolen`.
- Falha em (3) ou (4) → libera (2) antes de encerrar; nunca deixa lock pendurado.
- `identity.wipe` só roda com (2) em mãos e usa a máquina de estados de §18.6.

`REQUIRES POC` — G0/G10 (lock órfão, crash em cada etapa, `wipe`, deep link com app aberto).

---

## 11. Caminho de escrita: outbox, submissão, durabilidade, reconciliação

Resposta direta ao blocker B5.

### 11.1 A regra única do eixo otimista

v1 tinha duas regras conflitantes: `message.send` assíncrono e todo o resto síncrono de
30 s, enquanto a UX era otimista na Camada 2 inteira (`F-15`). v2 fecha:

> **Toda op do domínio de mensagem (`message.send`, `message.edit`, `message.delete`,
> `message.pin`, `reaction.set`, `thread.create`) é assíncrona por contrato: vai para a
> outbox durável, o comando IPC retorna `{opId, state}` imediatamente, e o desfecho chega
> por evento.**
>
> **Toda op de estrutura, cargo, moderação, comunidade e convite é síncrona: exige host
> online, não enfileira, e falha na hora com `E_HOST_UNAVAILABLE`.**

Isso é o que torna a UI otimista defensável: ela só é otimista onde existe fila durável e
reconciliação. Nas demais, é confirma-depois-desenha. Registrado como delta U-02.

**Exceção única e declarada — `member.leave`.** Sair de uma comunidade é a única op de
não-mensagem cujo efeito **local** não depende do host: o cliente sai do swarm, marca
`left_at` em `manifest.communities` e descarta a outbox daquela comunidade
**imediatamente**, com host online ou offline. O `member.leave` é **enfileirado** para que
os demais membros vejam a saída. Se ele nunca for entregue (host que nunca volta), os
outros continuam vendo a pessoa no roster — **LIMITAÇÃO DECLARADA (L-22)**, com o texto
correspondente na confirmação de saída. Nenhuma outra op de estrutura, cargo, moderação,
comunidade ou convite enfileira.

### 11.2 `local_outbox` (em `manifest.db`, `synchronous=FULL`)

| Coluna | Tipo | Notas |
|---|---|---|
| `local_seq` | `INTEGER PRIMARY KEY AUTOINCREMENT` | **Ordem de entrega**; monotônico local, não relógio de parede (fecha `DS-21`) |
| `op_id` | `TEXT UNIQUE NOT NULL` | hex do `opId`; enfileirar o mesmo envelope duas vezes é no-op |
| `community_id` | `TEXT NOT NULL` | — |
| `channel_id` | `TEXT` | Nulo para ops sem canal; permite descarte por canal |
| `sequence_scope` | `TEXT NOT NULL` | `community` ou o `channelId` assinado no envelope; chave do contador de `authorSeq` |
| `kind` | `INT NOT NULL` | — |
| `author_seq` | `INT NOT NULL` | Consumido no enfileiramento, nunca reatribuído |
| `envelope` | `BLOB NOT NULL` | Já assinado. **Nunca reassinado** |
| `client_ref` | `TEXT` | Correlação com a bolha otimista (fecha `F-44`) |
| `created_at` | `INT NOT NULL` | Informativo |
| `attempts` | `INT NOT NULL DEFAULT 0` | — |
| `next_attempt_at` | `INT NOT NULL` | — |
| `state` | `TEXT NOT NULL` | §11.3 |
| `acked_seq` | `INT` | `seq` informado pelo host no ACK, quando houve |
| `last_error` | `TEXT` | Código de §20 |
| `dropped_reason` | `TEXT` | Motivo nomeado (§11.7) |

Índices: `idx_outbox_ready(community_id, state, next_attempt_at)`,
`idx_outbox_channel(community_id, channel_id)`.

### 11.3 Máquina de estados da outbox (fecha `DR-24`)

```
            enqueue
               │
               ▼
           ┌────────┐  flush   ┌─────────┐  ACK{seq}  ┌───────────────────────┐
           │ queued │─────────▶│ sending │───────────▶│ awaiting-confirmation │
           └────────┘          └─────────┘            └───────────┬───────────┘
             ▲   ▲                  │                             │ opId observado
             │   │  erro            │ erro terminal               │ na própria réplica
             │   │  transitório     │ / rejeição do fold          ▼
             │   └──────────────────┤                        (removido)
             │                      ▼
             │                 ┌─────────┐   usuário/canal/comunidade
             └── retry ────────│ failed  │──────────────────────▶ dropped(motivo)
                               └─────────┘
```

| Transição | Gatilho | Regra |
|---|---|---|
| `→ queued` | `enqueue` | Consome `authorSeq` no `sequenceScope`, grava com `FULL`, responde ao renderer |
| `queued → sending` | `flush` pega o item de menor `local_seq` pronto do canal | Um item `sending` por canal por vez |
| `sending → awaiting-confirmation` | ACK do host com `{seq, hostTs}` | Grava `acked_seq`. **Não remove** |
| `awaiting-confirmation → removido` | O projetor local observa o `opId` do item em `observed_ops` | **É a única condição de remoção**; `lastAuthorSeq` sozinho nunca basta |
| `sending → queued` | Erro transitório (§20) | Backoff (§22.3) |
| `sending → failed` | Erro terminal | `last_error` preenchido; item continua visível na UI com "Tentar novamente" |
| `failed → queued` | `message.retry{opId}` | **Reenvia o mesmo envelope**, mesmo `authorSeq`, mesmo `opId` (fecha `DS-16`) |
| `sending → queued` | Boot após crash do processo | Todos os `sending` órfãos voltam a `queued`, sem consumir tentativa e sem limpar o envelope |
| `qualquer → dropped` | Canal/comunidade sumiu, banido, expiração reconciliada | §11.7 |

**Nunca existe um item entregue e perdido, nem um item perdido reportado como entregue.**
Os dois únicos estados terminais são: removido (observado na própria réplica) ou
`dropped` com motivo nomeado.

**Recuperação de processo:** no boot, depois de abrir `manifest.db` e antes do primeiro
`flush`, todo item em `sending` é tratado como órfão do processo anterior e volta a
`queued`, com `next_attempt_at = agora` e sem incrementar `attempts`. O envelope, `opId`,
`client_ref` e `sequence_scope` permanecem idênticos. Se o host já o tiver appendado, o
reenvio do mesmo envelope produz `E_DUPLICATE` e a remoção ainda depende de `observed_ops`;
se não tiver, a tentativa normal o entrega. `awaiting-confirmation` não é convertido: ele
segue para reconciliação.

### 11.4 Submissão no host — a seção crítica

`communityHost` mantém **uma fila de uma via por comunidade**. A seção crítica cobre somente
a decisão, a atribuição da ordem e a reserva do estado do grupo; ela **nunca espera I/O do
core**. O contrato é:

1. Sob a seção crítica, calcula `hostTs`, executa `foldRecord` contra o `DS` committed mais
   o estado provisório do grupo corrente e recusa sem reservar quando o desfecho não é
   `APPLIED`.
2. Para `APPLIED`, fixa o `seq` relativo ao grupo, monta o `HostRecord` e adiciona a decisão
   ao grupo corrente. O `DS` provisório é visível somente para decisões do mesmo grupo.
3. Libera a seção crítica enquanto a janela de group commit (§11.5) coleta as submissões.
   Há no máximo **um grupo em append** por comunidade; nenhuma decisão de um grupo seguinte
   pode observar uma reserva cujo resultado ainda não foi decidido.
4. Fora da seção crítica, faz uma única chamada `core.append([...])`. A resolução da promessa
   é a barreira de durabilidade (§10.7.1); não existe chamada posterior de `core.flush()`.
5. Se o append resolver, publica o `DS` provisório como `DS` committed e só então resolve as
   promessas com `{seq, hostTs}`. Se falhar, descarta o grupo inteiro, restaura o `DS` anterior
   e resolve todos os itens com `E_STORAGE_FULL` ou `E_INTERNAL`; nenhum ACK é emitido.

**Propriedades que isso dá, e que v1 não tinha:**

- A validação lê `ds` **na cabeça do log**, não uma projeção atrasada. A janela de `DS-01`
  deixa de existir.
- O avanço do `DS` só é publicado depois do append resolvido; não há estado de um grupo
  falho visível para um grupo seguinte.
- Se o append falhar, a reserva provisória é descartada como uma unidade: nada é ACKado e
  nenhum `seq` fantasma fica no estado do host.
- A projeção do host roda pelo mesmo caminho de todo mundo, a partir do log. O `DS` do
  `communityHost` e o `DS` do `projector` são **a mesma instância** — o host não tem
  caminho privilegiado nem estado duplicado. Fecha `DR-18`.

**Quantas vezes cada registro é interpretado, no host (fecha `HOLE-13`).** "Mesma
instância de `DS`" e "a projeção do host roda pelo mesmo caminho de todo mundo, a partir
do log" lidos juntos sugeriam que o host interpretaria cada registro **duas** vezes — uma
na admissão, outra ao projetar —, o que duplicaria efeitos ou exigiria o estado duplicado
que o próprio §11.4 proíbe. A regra é:

| Momento | Quem roda o `fold` | O que o projetor faz |
|---|---|---|
| **Op local admitida** | O `communityHost`, **uma vez**, no passo 3 | Consome os `Effect` **daquela** execução. Não reinterpreta |
| **Registro vindo da rede** (réplica, ou host em catch-up) | O projetor, uma vez, no caminho de réplica | Aplica os `Effect` que ele mesmo produziu |
| **Reinício** | O `DS` é reconstruído do log pelo caminho de réplica, do snapshot em diante | Idem |

O host não tem atalho: o caminho de admissão e o de réplica executam **o mesmo**
`foldRecord`. O que não acontece é o mesmo `seq` passar duas vezes pelo `fold` na mesma
instalação. POC-01 mede exatamente isso: o `DS` de admissão e o `DS` reconstruído do log
produzem hash de dump idêntico em 100 % dos cenários.

Na admissão local, consumir os `Effect` inclui materializar a linha correspondente em
`observed_ops` na projeção do host; na réplica, o projetor faz a mesma materialização ao
aplicar o lote. A origem da linha é sempre uma execução `APPLIED` do mesmo `fold`, nunca um
ACK ou uma marca d'água.

**Relógio quebrado no host (fecha `DS-29`):** se `clock.now() < ds.lastHostTs −
HOST_CLOCK_ALARM_MS`, o host **não** para de aceitar (isso mataria a comunidade); ele usa
`lastHostTs` (R-1), emite `host.clockSuspect` e a UI do host exibe um aviso acionável.
Nenhuma escrita é perdida por causa de um relógio errado.

### 11.5 Group commit

Submissões concorrentes são agrupadas: o host acumula registros por até
`GROUP_COMMIT_WINDOW_MS` (default 4 ms) ou `GROUP_COMMIT_MAX` (default 64) registros, faz
**um** `core.append([...])` — que já é o commit, §10.7.1 — e só então responde a todos do
grupo.

O agrupamento só existe porque a espera do append está **fora** da seção crítica de §11.4.
Durante um append há no máximo um grupo em voo por comunidade; novas decisões aguardam o
resultado sem segurar o lock. Se o append falhar, o grupo inteiro é rejeitado e seu `DS`
provisório é descartado. O limite 64 é o contrato; o POC-07 observou no máximo 32 porque o
seu tráfego usou `submitOps` de 32, e isso não altera o limite normativo.

Isso é o que amortiza o custo do commit durável e ainda permite mirar o alvo de `submitOp`
p95. A existência e o custo de `fsync` no caminho do core continuam limitados pela evidência
de §10.7.1. **`BENCHMARK REQUIRED` — G9/B1.** Se o benchmark reprovar, a decisão objetiva
está em §26.1: o alvo de latência é renegociado, **nunca** a barreira de durabilidade.

### 11.6 Reconciliação (o coração do B5)

Roda no boot, em `host.cameBack`, e a cada `OUTBOX_RECONCILE_MS`.

```
para cada item em (sending | awaiting-confirmation | failed):
    observado := replica.observed_ops[item.op_id]
    se observado existe:
        → a op está APPLIED na réplica: remove o item,
          emite message.accepted{opId, observado.seq, clientRef}
    senão se watermark(author, sequenceScope) >= item.author_seq:
        → a marca d'água não prova esta op; mantém `failed` com
          E_AUTHOR_SEQ_OVERTAKEN e não reporta entrega
    senão se item.acked_seq != null e ds.interpretedSeq >= item.acked_seq:
        → o host disse que appendou, mas o log interpretado não contém: o host mentiu,
           reordenou ou censurou. Item volta a `queued` e conta `host.ackMismatch`
    senão:
        → indeterminado: mantém, respeitando o backoff
```

`watermark < item.author_seq` é apenas uma negativa barata. O ramo de remoção exige a
presença do `opId` em `observed_ops`, que registra somente `APPLIED`; um registro
`REJECTED`/`IGNORED`, um ACK e uma marca d'água alta nunca confirmam entrega. Em uma outbox
conforme a `sequenceScope`, `E_AUTHOR_SEQ_OVERTAKEN` é inalcançável: se aparecer, indica
incompatibilidade de protocolo, corrupção ou violação do escalonador e deixa o item visível
como `failed` para diagnóstico, sem reenvio automático de um envelope que o host já recusará.
Esse estado não é elegível para `message.retry`; só uma correção de compatibilidade ou
reconstrução autorizada da fila pode removê-lo, sem reassinar silenciosamente a operação.

Regras normativas que decorrem:

1. **Um item nunca é descartado por idade sem reconciliação.** `OUTBOX_MAX_AGE_MS` só pode
   produzir `dropped/expired` depois de uma reconciliação com `interpretedSeq ≥ acked_seq`
   (ou sem nenhum ACK) — fecha `DS-06`, `DS-07`.
2. O `seq` que a UI exibe é sempre o **observado na réplica**, nunca o do ACK. Fecha
   `DS-31`: `message.accepted` passa a ser emitido **pela reconciliação**, ou seja,
   **depois** de `messages.appended`. A ordem entre os dois eventos é determinada e
   documentada.
3. `E_VERSION_UNSUPPORTED` é **classificado como terminal** e vira `dropped` com motivo
   `client-outdated`, não fica 72 h queimando retry. Fecha `DS-25`.

### 11.7 Descarte com motivo nomeado

| Motivo | Quando | Alcançável? |
|---|---|---|
| `channel-deleted` | O canal foi tombstonado | Sim |
| `community-ended` | `community.end` projetado | Sim |
| `left-community` | `member.leave` local | Sim |
| `banned` / `kicked` | O `fold` local observou `mod.ban`/`mod.kick` sobre a identidade local | **Sim** — em v2 o alvo continua replicando até aplicar o ban, então ele *vê* o próprio ban antes de perder acesso (§14.3). Fecha `DS-08`/`F-10` |
| `permission-lost` | O `fold` recusou com `E_PERMISSION_DENIED` de forma terminal | Sim |
| `expired` | Reconciliado e ausente do log por mais de `OUTBOX_MAX_AGE_MS` | Sim |
| `client-outdated` | `E_VERSION_UNSUPPORTED` | Sim |
| `cancelled` | `message.cancelQueued` sobre item em `queued` ou `failed` | Sim |

`message.cancelQueued` sobre item em `sending` ou `awaiting-confirmation` devolve
`E_ALREADY_SENT` — **não há promessa de cancelamento que o host não pode cumprir**. Fecha
`DS-28`.

**Limites da outbox:** `OUTBOX_MAX_ITEMS` (500 por comunidade) → `E_OUTBOX_FULL` na hora,
nunca enfileira às cegas. **Ordem:** por `local_seq` **dentro do canal**; um item bloqueado
segura o próprio canal e não os outros. Isso é compatível com a deduplicação porque cada canal
tem `sequenceScope` próprio; nenhum avanço de `authorSeq` em um canal pode ultrapassar uma
operação pendente de outro canal.

### 11.8 Backoff, circuit breaker e avalanche

- Curva única: `delay = min(1000 · 2^attempts, 60000) ± 20 %` de jitter.
- **Circuit breaker (fecha `DS-24`):** 5 falhas **de conexão** consecutivas → estado `open`
  por 30 s ± jitter. Enquanto `open`, o `flush` **não consome tentativa** de nenhum item:
  `attempts` só é incrementado quando houve uma tentativa real de entrega. Transições
  escritas: `closed → open` (5 falhas de conexão), `open → half-open` (após a pausa),
  `half-open → closed` (uma entrega bem-sucedida), `half-open → open` (falha).
- **Flush pós-reconexão (fecha `DS-10`):** o flush em `host.cameBack` **não** é imediato
  para todos. Ele começa após `RECONNECT_FLUSH_DELAY_MS` com jitter proporcional a
  `hash(identityKey) mod 2000 ms`, e a taxa é limitada a `FLUSH_RATE_PER_S` itens por
  segundo por comunidade. Sem isso, 340 membros reconectam em fase e produzem avalanche
  exatamente no pior momento.
- **Fila do host (fecha `DS-10`):** a fila de admissão do host tem profundidade
  `HOST_QUEUE_DEPTH` (default 512) por comunidade. Cheia → `E_BUSY` com `retryAfterMs`,
  **antes** de qualquer verificação cara. Isso é shedding explícito, não backlog infinito.

### 11.9 `submitOps` em lote

`submitOps{envelopes[≤32]}` devolve **um resultado por envelope**, sempre com os 32 itens
representados:

```
[{ index, ok:true, seq, hostTs } | { index, ok:false, code, retryAfterMs? }
 | { index, ok:false, code:'E_NOT_ATTEMPTED' }]
```

O host processa na ordem, **não para no primeiro erro**: um erro terminal marca aquele item
e continua com os seguintes. Só um erro de infraestrutura (`E_STORAGE_FULL`, breaker do
próprio host) interrompe, e aí todos os restantes voltam como `E_NOT_ATTEMPTED` e
permanecem `queued`. Fecha `DS-26`.

**Conflito com o rate limit (fecha `DS-23`):** o controle de taxa por autor é aplicado
**ao lote inteiro como um só evento de custo `n`**, não `n` eventos de custo 1. Um lote que
excede o budget devolve `E_RATE_LIMITED` para o excedente com `retryAfterMs`, mantendo os
aceitos aplicados. O tamanho máximo do lote (32) e o burst do bucket (§26.3) são calibrados
juntos, na mesma linha da tabela, e não em seções diferentes.

---

## 12. Convites e admissão

Resposta direta ao blocker B3.

### 12.1 Derivação

```
inviteSecret   = 10 bytes aleatórios                      (80 bits)
código exibido = Crockford-Base32(inviteSecret)           16 chars, 4 grupos de 4
inviteSeed     = BLAKE2b-256('invite-seed/1' ‖ inviteSecret)
(invitePk, inviteSk) = ed25519_keypair_from_seed(inviteSeed)
inviteTopic    = BLAKE2b-256('invite-topic/1' ‖ invitePk)
```

**A propriedade que resolve o convite delegado:** o log guarda `invitePk`. Qualquer membro
pode criar um convite; o host valida usando a **chave pública** que está no log e **nunca
precisa conhecer o segredo**. É a razão de o esquema de v1 (hash do segredo +
challenge-response de conhecimento) ser inexecutável e este não ser.

**A propriedade que resolve o rendezvous pré-membro (`F-09`):** o candidato deriva
`invitePk` **só do código**, e daí o tópico. Ele não precisa saber `communityId`, `coreKey`
nem quem hospeda antes de conectar. O código curto de 16 caracteres é auto-suficiente; o
link é conveniência.

### 12.2 Emissão

1. `invite.create` gera `inviteSecret`, deriva `invitePk`, grava
   `manifest.invite_secrets` (`FULL`).
2. Appenda `invite.create{invitePublicKey, expiresAt?, maxUses?, label?}` — op síncrona,
   exige host online e `create_invite`.
3. O **host** faz `swarm.join(inviteTopic, {server:true})` para cada convite ativo, e sai
   do tópico quando o convite expira, esgota ou é revogado (job de §22.2).

### 12.3 Preview (`inviteResolve`)

Canal **pré-membro** (§14.4), com o orçamento e os tetos mais restritos do sistema.

```
1. candidato → host:  hello{clientOpVersion}
2. host      → cand:  challenge{16 bytes aleatórios, hostPk}
3. candidato → host:  resolve{ invitePk, candidatePk,
                               liveProof = Ed25519(inviteSk,
                                 BLAKE2b('invite-auth/1' ‖ invitePk ‖ hostPk
                                         ‖ candidatePk ‖ challenge)) }
4. host verifica liveProof com invitePk  →  falha: fecha a conexão, sem segunda tentativa
5. host avalia, nesta ordem:
     comunidade ended?              → { status:'ended', communityName }
     candidato banido?              → { status:'banned', communityName }   // sem contagem, sem convidador
     já é membro?                   → { status:'already-member', community }
     convite revogado/expirado/esgotado? → { status:'invalid' }
     senão                          → { status:'ok', community{id,name,iconEmoji,iconColor,memberCount},
                                         invitedBy{key, displayName, handle} }
6. host offline / inalcançável (decidido pelo cliente) → { status:'unreachable', hint }
```

**Seis desfechos, normativos.** A UX tem quatro — delta U-03.

**`liveProof` fecha `T-06`:** ele amarra `hostPk` e `candidatePk`, então quem observa o
tópico e captura a prova não consegue reusá-la para si nem contra outro host.

**Por que `banned` é alcançável agora (fecha `F-10`, `DS-08`, `C-2`):** o canal pré-membro
**não** aplica o firewall de banidos. Ele aplica teto de bytes, rate limit por par e
fechamento de conexão a cada prova errada. O firewall de banidos vale para o canal de
**replicação** (§14.3), não para o de admissão.

### 12.4 Resgate (`inviteRedeem`)

```
1. candidato monta a Op member.join:
     payload = { invitePublicKey, joinProof, displayName, avatarColor, blobsCoreKey }
     joinProof = Ed25519(inviteSk,
                   BLAKE2b('invite-join/1' ‖ communityId ‖ invitePk ‖ candidatePk))
   → o candidato precisa do communityId, que o host devolveu no preview (status ok)
   → a Op é assinada pela identidade do candidato (author = candidatePk)
2. candidato → host: redeem{ envelope, liveProof }
3. host revalida liveProof, e entrega o envelope à MESMA fila de admissão de §11.4
4. o fold aplica R-9: verifica joinProof com invitePk, checa revogação/expiração/uses,
   registra (invitePk, candidatePk) em joinedByInvite e incrementa uses — TUDO no mesmo
   passo atômico da seção crítica
5. host responde { seq, communityId, coreKey, blobsKey, defaultChannelId, hostKey }
6. candidato grava a participação em manifest.communities (FULL), faz swarm.join dos
   cores e projeta do seq 0
```

**Consumo atômico de `maxUses` (fecha `DS-05`, `F-02`):** `uses` é campo do
`DecisionState`, avançado dentro da seção crítica, na mesma operação que decide a admissão.
Dez candidatos simultâneos com `maxUses=1` produzem **exatamente um** `member.join` e nove
`E_INVITE_EXHAUSTED`. Não há leitura de projeção atrasada em lugar nenhum do caminho.

**`joinProof` é verificável para sempre por toda réplica** — ele não depende do challenge
efêmero. É isso que permite ao `fold` de um membro que entrou depois confirmar que aquele
join foi autorizado.

**`member.join` é assinado pelo próprio candidato** (fecha `F-06`): o host não fabrica
autoria; ele só decide se o registro entra.

### 12.5 O que o preview vaza, e o que não vaza

| Desfecho | Devolve | Não devolve |
|---|---|---|
| `ok` | nome, ícone, cor, `memberCount`, quem convidou (nome + `handle`) | nada além disso |
| `already-member` | nome, ícone, cor | `memberCount`, convidador |
| `banned` | **só** o nome da comunidade | contagem, convidador, ícone |
| `invalid` / `unreachable` | nada | — |
| `ended` | só o nome | — |

`hello` **não** responde a quem não é membro e não está num fluxo de convite (fecha
`T-38`): o handshake de replicação exige autorização (§14.3); o canal pré-membro só expõe
`inviteResolve`/`inviteRedeem`.

### 12.6 Defesa contra força bruta e Sybil

| Controle | Valor |
|---|---|
| Entropia do segredo | 80 bits |
| Prova errada | **Fecha a conexão**; sem segunda tentativa na mesma conexão |
| Rate limit pré-membro | Por chave pública do par **e** por prefixo /24 do endereço observado (`INVITE_RATE_PER_PEER`, `INVITE_RATE_PER_SUBNET`) — fecha `DR-31`, que apontava que "IP do peer" não é a chave disponível: o que existe é a `remotePublicKey` do Noise e o endereço UDP observado, e v2 usa os dois |
| Orçamento de conexão pré-membro | `PREMEMBER_CONN_BUDGET` (default 8 simultâneas por comunidade hospedada), separado do orçamento de membros — fecha `T-08` |
| Teto de bytes antes do decode | `PREMEMBER_MAX_FRAME_BYTES` (4 KiB) — fecha `T-34` |
| Convites ativos por comunidade | 50 |

**LIMITAÇÃO DECLARADA (L-8) — Sybil:** identidade é gratuita e não há custo de entrada. O
convite limita **quem entra**, não **quantas identidades uma pessoa tem**. Um convite
vazado com `maxUses` alto permite raide; a mitigação é revogar e usar `maxUses` baixo. O
produto **não** implementa aprovação manual (corte de escopo herdado da UX) — delta U-05
registra que o texto de 0.3 precisa dizer isso.

---

## 13. Anexos e blobs

Resposta direta ao blocker B4.

### 13.1 Ownership: um core de blobs por autor

v1 tinha um único `hyperblobs` por comunidade, com escritor único do host, e ao mesmo tempo
mandava o membro fazer `blob.stage` local — criptograficamente impossível (`F-03`).

v2:

| Core | Chave | Escrito por | Replicado por |
|---|---|---|---|
| `log` | `coreKey` = id da comunidade | host | todos os membros, integral |
| `blobs` do **membro X** | `memberBlobsKey(X, community)` | **X** | quem baixou algum anexo de X (sparse) |
| `blobs` da **comunidade** | `blobsKey` (§5.3) | host | opcional; usado só por `community.*` no futuro. **Sem uso no v1** |

```
memberBlobsSeed = BLAKE2b-256('ns/memberblobs/1' ‖ identitySeed ‖ communityId)
(memberBlobsPk, memberBlobsSk) = ed25519_keypair_from_seed(memberBlobsSeed)
```

- Derivável só pelo dono, recuperável por ele em qualquer reinstalação a partir do backup
  de identidade (§5.5).
- **Publicado no log**: em `member.join` (campo `blobsCoreKey`) e alterável por
  `member.setBlobsCore`. Portanto é dado do log, recuperável por toda réplica — fecha o
  lado de anexos do B2.
- O `AttachmentRef` na mensagem carrega `blobsCoreKey`, então o leitor sabe **de qual core**
  buscar sem consultar ninguém.

**O host nunca recebe os bytes do anexo.** O caminho de controle (RPC de ops) e o caminho
de dado (replicação de blobs) são cores diferentes, conexões diferentes e orçamentos
diferentes. Fecha `F-03` e o cenário de 8 GiB monopolizando o RPC.

### 13.2 Fluxo de upload

```
1. renderer: file.pickForAttachment{communityId}
2. main: dialog.showOpenDialog  →  path
3. main → núcleo (IPC-M): stagingTicket{ticketId, path, sizeBytes, communityId}
   main → renderer: {ticketId, name, sizeBytes, kind}      // renderer NUNCA vê o path
4. renderer: blob.stage{ticketId}
5. núcleo: abre o core de blobs local da comunidade; lê o arquivo em stream;
   calcula BLAKE2b('blob-hash/1' ‖ conteúdo) na mesma passada;
   hyperblobs.put em chunks, journalando bytesWritten em manifest.local_blob_staging
6. núcleo → renderer: {blobId, hash, sizeBytes, kind}
7. renderer: message.send{ ..., attachment:{blobsCoreKey, blobId, name, sizeBytes, kind, hash} }
```

### 13.3 Origem do caminho — ticket, nunca string

**O núcleo recusa qualquer `path` vindo do renderer, sempre.** O único caminho aceito é o
que chegou pelo IPC-M dentro de um ticket emitido pelo main após um diálogo do SO.

Propriedades do ticket:

| Propriedade | Valor |
|---|---|
| `ticketId` | 16 bytes aleatórios |
| Validade | `STAGING_TICKET_TTL_MS` (default 15 min) |
| Uso | **uma vez**; consumido no `blob.stage` |
| Escopo | um `communityId`, um caminho |
| Visibilidade | o `path` **nunca** cruza o IPC-R, nem em resposta, nem em erro, nem em log |

Fecha `T-16` e `DR-37`: um renderer comprometido não consegue exfiltrar arquivo arbitrário,
porque não existe superfície que aceite caminho dele.

### 13.4 Download

```
1. blob.download{blobsCoreKey, blobId}
2. swarm.join(discoveryKey(blobsCoreKey))            // se ainda não estiver
3. hyperblobs.get por range, sparse
4. progresso a cada 500 ms: blob.progress{progress, peers, hostAvailable, bytesDownloaded}
5. abort se bytesRecebidos > declaredSize          → attachment.corrupt (§6.10)
6. ao completar: verifica hash → falha → descarta, attachment.corrupt
7. grava em blobs/<blobsCoreKeyHex>/<blobIdHex>-<name>  →  blob.completed{path}
```

**Estados de `local_blob_cache.state` (enum fechado — fecha `DR-40`):**

`not-downloaded` · `queued` · `downloading` · `verifying` · `downloaded` · `corrupt` ·
`unavailable` · `cancelled`

Retomada após crash: no boot, todo item em `downloading`/`verifying` volta para `queued`
com `bytesDownloaded` preservado; o Hypercore retoma pelo bitfield, sem reiniciar.

`availablePeers` = pares conectados que **anunciam ter** os blocos do range (leitura do
bitfield). `hostAvailable` = o `hostKey` está entre eles. **Dados reais, não estimativa.**
`blob.unavailable` só quando os dois zeram.

### 13.5 Retomada e limpeza do staging (fecha `DS-22`)

`manifest.local_blob_staging` guarda `{ticketId, path, bytesWritten, rollingHashState,
state}`. No boot:

- `state = 'writing'` → retoma do `bytesWritten` (o arquivo de origem ainda existe? se não,
  `E_FILE_UNREADABLE` e o staging é descartado);
- `state = 'done'` e sem mensagem referenciando em `STAGING_ORPHAN_MS` (24 h) → `core.clear`
  dos blocos locais e remoção da linha. Como o core é **do próprio membro**, um staging
  abandonado custa disco dele, não da comunidade.

### 13.6 Abertura, tipo e quarentena

**Mapa extensão → `kind` (normativo, fecha `DR-41`):**

| `kind` | Extensões |
|---|---|
| `image` | `png jpg jpeg gif webp avif bmp tiff heic` |
| `video` | `mp4 mkv webm mov avi m4v` |
| `audio` | `mp3 wav flac ogg opus m4a aac` |
| `document` | `pdf txt md csv json xml odt ods odp docx xlsx pptx rtf` |
| `archive` | `zip tar gz bz2 xz 7z rar` |
| `other` | qualquer outra, **inclusive extensão ausente** |

**Regras de segurança (fecham `T-17`, `T-48`, `DR-41`):**

1. `blob.reveal` (abrir com o handler do SO) é permitido **apenas** para `image`, `audio`,
   `video`, `document` e **apenas** para as extensões da tabela. Todo o resto oferece
   somente "Mostrar na pasta".
2. Uma allowlist de extensões executáveis/roteiráveis (`exe bat cmd com scr ps1 sh msi
   dll app pkg dmg deb rpm jar vbs js wsf lnk`) é **bloqueada até para revelar**: o arquivo
   é gravado com a extensão preservada, mas a UI mostra aviso de origem e não oferece ação
   de abertura.
3. Onde o SO suportar, o arquivo baixado recebe a marca de origem — na matriz de A16, só
   o Windows suporta (`Zone.Identifier`). **No Linux não há marca de origem padrão e
   nenhuma é aplicada**, o que precisa ser tratado como ausência de defesa, não como
   defesa silenciosa.
4. **Renderização inline no v1 é só para `image` nas extensões `png jpg jpeg gif webp`.**
   Vídeo e áudio **não** tocam inline no v1: exigem download explícito e abertura pelo SO.
   Isso reduz a superfície de decodificador do renderer a um decoder de imagem já
   sandboxado. `REQUIRES POC` — G11 (fuzzing) antes de qualquer ampliação.

### 13.7 Barreira blob ↔ mensagem (fecha `DS-27`, `F-43`)

Anexar e enviar não são transacionais — e não podem ser. A ordem é normativa: **o blob
primeiro, a mensagem depois.** A ordem inversa produziria mensagem apontando para blob
inexistente, que é pior.

A barreira que v1 não tinha:

1. `message.send` com anexo **só é enfileirada** depois que o `blob.stage` completou e o
   `hyperblobs.put` foi `flush`ado no core local.
2. O autor **mantém os blocos** do anexo enquanto a mensagem existir e não estiver
   tombstonada: o GC local (§22.4) **nunca** limpa blocos de anexos enviados pela
   identidade local que ainda tenham mensagem viva.
3. Se a mensagem for entregue e o autor sumir para sempre sem outro seeder, o leitor recebe
   `blob.unavailable` — estado nomeado, desenhado, e não silêncio. **LIMITAÇÃO DECLARADA
   (L-9):** a disponibilidade de um anexo depende de haver ao menos um par com os blocos.

### 13.8 Cota e GC

- **Cota por membro:** `R-14`, `ATTACHMENT_QUOTA_PER_MEMBER` (default 5 GiB por
  comunidade). É constante de protocolo e o `fold` a aplica. Fecha o lado de anexos de
  `T-09`.
- **Cache local:** `BLOB_CACHE_MAX_BYTES` (20 GiB, configuração operacional), LRU por
  `verified_at`, **exceto** blocos protegidos pela regra 2 de §13.7.
- Blobs de comunidade que a identidade deixou: removidos ao expirar `retain_until`
  (§18.4).

---

## 14. Replicação, autorização e isolamento

Resposta direta ao blocker B7 na parte de isolamento, e ao B10 na parte de revogação.

### 14.1 O que replica

| Recurso | Tópico DHT | Quem entra |
|---|---|---|
| Log da comunidade | `discoveryKey(coreKey)` | Membros ativos não banidos |
| Core de blobs de um membro | `discoveryKey(memberBlobsKey)` | Quem tem, ou quer, algum anexo daquele membro |
| Tópico de convite | `BLAKE2b('invite-topic/1' ‖ invitePk)` | Host (server) e candidatos (client) |

`swarm.join(coreKey)` e o join dos cores de blobs relevantes são feitos explicitamente:
**estar conectado a um par não é estar replicando um core** — precisa ser código, não
suposição.

### 14.2 ADR-16 continua: toda comunidade participada replica em background

É requisito de produto (traço de não-lida no rail de comunidades fechadas). O que v1 não
tinha, e v2 tem, é o **escalonador**:

| Regra | Valor |
|---|---|
| Orçamento total de conexões | `SWARM_MAX_CONNECTIONS` (default 128) |
| Reserva para a comunidade ativa | 40 % do orçamento, mínimo 8 |
| Reserva para modo host | 40 % do orçamento em cada comunidade hospedada, com o teto `HOST_MAX_PEERS` |
| Restante | Round-robin entre as comunidades de background |
| **Garantia anti-starvation** | Toda comunidade de background recebe ao menos uma janela de replicação a cada `BG_ROTATION_MS` (default 60 s), mesmo que o orçamento esteja saturado |
| Prioridade de event loop | 1) RPC de entrada · 2) `fold`+projeção · 3) outbox · 4) replicação de background · 5) blobs · 6) jobs · 7) GC |
| Cessão de event loop | O `fold` cede a cada `PROJECTOR_BATCH` registros; o GC e a reprojeção longa cedem sempre |

Fecha `F-14` (o teto de 128 não é "conexões por membro da comunidade": um membro comum
mantém poucas conexões; quem precisa de muitas é o host, e o teto dele é separado) e
`DS-10`. **`BENCHMARK REQUIRED` — G9.**

### 14.3 Autorização de replicação (fecha `DR-30`, parte de `T-25` e do B10)

Em v1 o `firewall` existia **só no host**, então dois membros continuavam replicando entre
si e o banido continuava lendo.

v2:

1. Ao abrir um canal `protomux` de replicação para o core de uma comunidade, **cada nó**
   consulta o próprio `DecisionState` daquela comunidade:
   - o par é membro ativo não banido? → abre;
   - senão → **recusa o canal** com `E_NOT_AUTHORIZED_FOR_COMMUNITY` e não replica nada.
2. Como o `fold` é determinístico, todos os nós convergem para a mesma decisão assim que
   projetam o ban. Não há autoridade central para isso, e não precisa haver.
3. O nó **fecha canais já abertos** para um par que acabou de ser banido, no mesmo lote de
   projeção que aplicou o ban.
4. O **firewall de conexão** (`hyperswarm.firewall`) continua existindo, mas com escopo
   corrigido: ele só recusa a conexão TCP/UDX quando o par está banido em **todas** as
   comunidades que este nó tem em comum com ele. Um par banido em A e membro de B **abre
   conexão** e replica só B. Isso fecha `T-25` — o firewall por processo de v1 atravessava
   comunidades e vazava estado de moderação.
5. O canal **pré-membro** (§12.3) é exceto de (4): ele aceita qualquer par, com o orçamento
   e os tetos de §12.6, para que o preview `banned` seja alcançável.

**Consequência para o alvo do ban (fecha `DS-08`):** o banido replica o registro do próprio
ban antes de perder acesso — porque quem o baniu só fecha o canal **depois** de appendar, e
a op é replicada. Se ele estiver offline no momento, ele descobre na reconexão seguinte,
quando algum par ainda não projetou o ban, ou pelo próprio host no canal pré-membro. Se
nem isso acontecer, o cliente cai em `E_NOT_AUTHORIZED_FOR_COMMUNITY` na replicação, que é
um estado nomeado e desenhado (§18.4).

### 14.4 Controle de admissão do transporte

Aplicado **antes** de qualquer trabalho criptográfico ou de decode (fecha `T-08`, `T-34`,
`DS-09`):

| Controle | Membro | Pré-membro |
|---|---|---|
| Teto de frame antes do decode | `RPC_MAX_FRAME_BYTES` = 64 KiB | `PREMEMBER_MAX_FRAME_BYTES` = 4 KiB |
| Requests em voo por par | 8 | 2 |
| Token bucket por `remotePublicKey` | 40 req / 10 s | 10 req / 60 s |
| Token bucket por prefixo de rede /24 | — | 30 req / 60 s |
| Orçamento de conexões | `HOST_MAX_PEERS` | `PREMEMBER_CONN_BUDGET` = 8 |
| Custo do handshake Noise | Pago pelo `hyperdht` antes de qualquer coisa nossa | idem |

Ordem por request: **(1)** teto de bytes → **(2)** bucket → **(3)** decode → **(4)**
verificação de assinatura → **(5)** `fold`. Nunca o contrário.

### 14.5 Estados de replicação observáveis (fecha `DS-11`, `DS-17`, `RT-11`)

Um buraco de replicação em v1 congelava a projeção sem estado, sem timeout e sem evento.
v2 torna isso um estado de primeira classe:

| Estado | Condição | Evento |
|---|---|---|
| `synced` | `interpretedSeq === core.length − 1` e o par host respondeu no último `HELLO_INTERVAL_MS` | — |
| `catching-up` | `core.length − interpretedSeq > 0` e avançando | `community.replication{state, lag, etaMs}` |
| `stalled` | `lag > 0` e sem avanço por `REPLICATION_STALL_MS` (default 20 s) | idem, com `reason:'no-provider'` |
| `blocked` | O core anuncia comprimento maior do que o disponível em qualquer par | idem, com `reason:'gap'` |
| `unauthorized` | Todos os pares recusaram o canal (§14.3) | `community.accessRevoked` |
| `forked` | Bloco conflitante detectado (§5.5, L-4) | `community.forked` |

**Watchdog obrigatório:** um loop de `REPLICATION_WATCH_MS` compara `core.length` com
`interpretedSeq` em toda comunidade aberta e publica a transição. Fecha `DS-17` (não havia
barreira entre catch-up e modo reativo, nem watchdog).

**`partial` na busca (fecha `RT-11`):** `query.search` devolve `partial: true` quando o
estado de replicação **não** é `synced`, **ou** o host está offline, **ou** a comunidade
está em `partialInterpretation`. Não é mais só "host offline".

---

## 15. Contratos IPC

Resposta direta aos blockers B6 (contrato executável) e B9 (rastreabilidade de leitura).

### 15.1 IPC-R — transporte e envelope

**Transporte:** `MessagePort` direto renderer↔núcleo. **Todo** quadro carrega `epoch`.

| Quadro | Campos | Direção |
|---|---|---|
| `hello` | `t:"hello"`, `epoch:uint32`, `coreVersion`, `opVersion`, `schemaVersion` | núcleo → renderer, primeiro quadro de todo canal |
| `req` | `t:"req"`, `epoch`, `id:uint32`, `cmd:string`, `arg:object`, `authToken?:string` | renderer → núcleo |
| `res` | `t:"res"`, `epoch`, `id`, `ok:true`, `data` \| `ok:false`, `err:{code,message,details?,field?,retryAfterMs?}` | núcleo → renderer |
| `sub` | `t:"sub"`, `epoch`, `id`, `topic:string`, `filter?:object` | renderer → núcleo |
| `subOk` | `t:"subOk"`, `epoch`, `id`, `subId:uint32` | núcleo → renderer |
| `unsub` | `t:"unsub"`, `epoch`, `subId` | renderer → núcleo |
| `ev` | `t:"ev"`, `epoch`, `subId`, `evSeq:uint32`, `topic`, `data` | núcleo → renderer |
| `evAck` | `t:"evAck"`, `epoch`, `subId`, `evSeq` | renderer → núcleo |
| `evStale` | `t:"evStale"`, `epoch`, `subId`, `fromSeq`, `toSeq`, `dropped:uint32` | núcleo → renderer |
| `chunk` | `t:"chunk"`, `epoch`, `sessionId`, `seq`, `meta`, `payload:ArrayBuffer` (transferível) | ambos — só usado pela árvore adiada (§17.8) |

**Regras normativas (fecham `DR-05`, `DR-06`, `DR-07`, `T-20`):**

1. **`epoch`** é atribuído pelo núcleo no `hello` e incrementa a cada processo núcleo novo.
   Um quadro com `epoch` diferente do corrente é **descartado sem resposta** dos dois
   lados. É isso que impede um `res` do núcleo antigo ser aplicado depois de um crash.
2. **`subId`** é atribuído pelo núcleo, não pelo renderer. Duas assinaturas do mesmo
   `topic` com filtros diferentes recebem `subId` distintos e são independentes.
3. **`evSeq`** é monotônico **por `subId`**. Isso dá correlação e detecção de perda.
4. **Controle de fluxo no nível da aplicação:** o núcleo para de emitir para um `subId`
   quando há mais de `IPC_SUB_WINDOW` (default 256) eventos não confirmados por `evAck`.
   Passado `IPC_STALE_MS` (default 3 s) nesse estado, ele emite `evStale` com a contagem
   descartada e marca a assinatura **stale**. `MessagePort` não informa profundidade de
   fila, então esse contador é a **única** fonte de backpressure — v1 dependia de uma
   informação que a API não fornece.
5. **Assinatura stale:** o renderer é obrigado a (a) refazer a query correspondente e (b)
   mandar `evAck` com o último `evSeq` recebido. O núcleo retoma a emissão. **Evento
   perdido nunca vira estado errado**, porque evento é sinal para reconsultar, nunca fonte
   de verdade.
6. **Timeouts:** default 10 000 ms. Comandos síncronos que dependem do host: 30 000 ms
   (marcados ⏱). Estouro → `E_TIMEOUT` no renderer, e o núcleo **continua** processando.
   Como toda escrita é idempotente por `(author, communityId, sequenceScope, authorSeq)`, repetir é seguro.
7. **`E_TIMEOUT` não é motivo para o renderer reemitir a mesma ação com dado novo.** Fecha
   `DS-16`: a UI oferece "Tentar novamente", e "tentar novamente" reenvia o **mesmo `opId`**
   pela outbox, nunca constrói uma op nova.
8. Comando desconhecido → `E_UNKNOWN_COMMAND`. Argumento com forma errada → `E_MALFORMED`
   **antes** de chegar em L2.

### 15.2 Recuperação de crash do núcleo (procedimento normativo)

```
1. main detecta exit do utilityProcess
2. main cria MessageChannelMain novo, sobe o núcleo, cruza as portas
3. núcleo emite hello{epoch: N+1}
4. renderer, ao ver epoch novo:
     a. falha TODAS as requests em voo com E_CORE_RESTARTED (NUNCA as reenvia
        automaticamente)
     b. descarta todos os subId antigos
     c. refaz todas as assinaturas (o cliente IPC mantém a lista declarativa)
     d. refaz todas as queries ativas
     e. mostra o estado conn-reconnecting durante (c) e (d)
5. escrita em voo perdida: nada a fazer — ela está na outbox (manifest.db, FULL) e será
   reconciliada por §11.6. Nenhuma escrita é reenviada pelo renderer.
```

**Convergência garantida:** depois de (d), o estado da UI é derivado só de queries, e as
queries leem `view.db`, que é derivado do log. Três crashes seguidos convergem para o mesmo
estado. `REQUIRES POC` — G6.

### 15.3 Classes de autorização de comando (fecha `T-20`, `T-19`)

| Classe | Quem pode | Comandos |
|---|---|---|
| `open` | Renderer, sempre | Todas as queries, `core.status` |
| `standard` | Renderer, com identidade criada | Escritas de domínio, mídia, preferências, blobs |
| `main-confirmed` | Renderer **com `authToken`** emitido pelo main após confirmação nativa | `identity.wipe`, `identity.export`, `identity.import`, `community.end`, `core.reproject`, `blob.reveal` de `archive`, `community.assumeHost` |
| `dev` | **Só existe em build `dev`** | `dev.*` |

- O `authToken` é um valor de 32 bytes, de uso único, com TTL de 60 s, emitido pelo main via
  IPC-M depois de um diálogo nativo (`dialog.showMessageBox` com botão destrutivo). O núcleo
  o consome e invalida. O renderer **não pode fabricá-lo**.
- **Comandos `dev` são removidos do roteador em tempo de build.** O gate é
  `P2P_BUILD_CHANNEL`, uma constante substituída no bundle, com eliminação de código morto —
  não `NODE_ENV`, que falha aberto. Em produção o roteador **não contém** as entradas, e uma
  chamada devolve `E_UNKNOWN_COMMAND` indistinguível de um comando inexistente.

### 15.4 IPC-R — comandos de escrita

Coluna **Cl.** = classe de autorização · **A** = assíncrono por contrato (outbox, §11.1) ·
**⏱** = síncrono com o host, timeout de 30 s.

#### Identidade e app

| Comando | Argumento | Cl. | Resposta | Erros |
|---|---|---|---|---|
| `identity.create` | `{displayName, avatarColor}` | open | `{publicKey, handle, createdAt}` | `E_IDENTITY_EXISTS`, `E_VALIDATION`, `E_KEYSTORE_UNAVAILABLE`, `E_KEYSTORE_INSECURE` |
| `identity.update` | `{displayName?, avatarColor?}` | standard | `{queued:[{communityId, opId}]}` — **A**, uma op por comunidade | `E_VALIDATION` |
| `identity.setPresence` | `{presence}` | standard | `{}` | `E_VALIDATION` |
| `identity.export` | `{passphrase}` | main-confirmed | `{savedTo}` — o main grava o arquivo | `E_VALIDATION.passphrase`, `E_CANCELLED` |
| `identity.import` | `{passphrase}` | main-confirmed | `{publicKey, handle, communities:int}` | `E_IDENTITY_EXISTS`, `E_BAD_PASSPHRASE`, `E_MALFORMED` |
| `identity.wipe` | `{}` | main-confirmed | `{}` (o núcleo reinicia) | `E_WIPE_INCOMPLETE` |
| `core.status` | `{}` | open | §15.6 `CoreStatus` | — |
| `core.reproject` | `{communityId?}` | main-confirmed | `{}` | `E_BUSY` |
| `core.shutdown` | `{}` | standard | `{drainedMs, pendingOps, replicatedTo}` | — |

#### Comunidade

| Comando | Argumento | Cl. | Resposta | Erros |
|---|---|---|---|---|
| `community.create` | `{name, iconEmoji?, iconColor, description?}` | standard | `{communityId, defaultChannelId}` | `E_VALIDATION`, `E_STORAGE_FULL`, `E_LIMIT_EXCEEDED` |
| `community.activate` | `{communityId \| null}` | standard | `{residency}` — troca o `residency` do `DS` (§8.1) | `E_NOT_FOUND` |
| `community.update` ⏱ | `{communityId, name?, iconEmoji?, iconColor?, description?}` | standard | `{seq}` | `E_PERMISSION_DENIED`, `E_HOST_UNAVAILABLE`, `E_VALIDATION` |
| `community.end` ⏱ | `{communityId, reason?}` | main-confirmed | `{seq, replicatedTo}` | `E_NOT_HOST`, `E_COMMUNITY_ENDED` |
| `community.leave` | `{communityId}` | standard | `{leftLocally:true, opId, droppedQueued}` — efeito local imediato; o `kind` `member.leave` é enfileirado (exceção de §11.1, L-22) | `E_HOST_CANNOT_LEAVE` |
| `community.setSuccessors` ⏱ | `{communityId, successorKeys[]}` | standard | `{seq}` | `E_NOT_HOST`, `E_VALIDATION` |
| `community.assumeHost` ⏱ | `{communityId}` | main-confirmed | `{newCommunityId, seq}` | `E_SUCCESSION_DENIED` |
| `community.forget` | `{communityId}` | main-confirmed | `{}` — apaga a réplica local de uma comunidade `left`/`removed` antes do `retain_until` | `E_NOT_FOUND` |

#### Canais e categorias — todas ⏱, `manage_channels`

| Comando | Argumento | Resposta | Erros |
|---|---|---|---|
| `channel.create` | `{communityId, categoryId, type, name, topic?, readOnlyForRoleIds?, afterChannelId?}` | `{channelId, seq, rank}` | `E_CHANNEL_NAME_TAKEN`, `E_CHANNEL_NAME_EMPTY`, `E_LIMIT_EXCEEDED`, `E_HOST_UNAVAILABLE` |
| `channel.update` | `{communityId, channelId, name?, topic?, readOnlyForRoleIds?}` | `{seq}` | idem |
| `channel.move` | `{communityId, channelId, categoryId, afterChannelId?}` | `{seq, rank}` | `E_CATEGORY_NOT_FOUND` |
| `channel.delete` | `{communityId, channelId}` | `{seq, droppedQueued}` | `E_LAST_CHANNEL` |
| `category.create` | `{communityId, name, afterCategoryId?}` | `{categoryId, seq, rank}` | `E_VALIDATION`, `E_LIMIT_EXCEEDED` |
| `category.rename` | `{communityId, categoryId, name}` | `{seq}` | — |
| `category.delete` | `{communityId, categoryId, moveChannelsTo?} \| {..., deleteChannels:true}` | `{seq, movedChannels, deletedChannels}` | `E_VALIDATION`, `E_LAST_CHANNEL` |

#### Preferências locais (sem host, sem fila)

| Comando | Argumento | Resposta |
|---|---|---|
| `channel.setMuted` | `{communityId, channelId, muted}` | `{}` |
| `channel.markRead` | `{communityId, channelId}` | `{unreadCount:0, pendingMentions:0}` — **declara os dois** (fecha `RT-03`) |
| `thread.markRead` | `{communityId, threadId}` | `{unreadCount:0}` |
| `category.setCollapsed` | `{communityId, categoryId, collapsed}` | `{}` |
| `nav.setActive` | `{communityId?, channelId?}` | `{}` — **dono único** de navegação (fecha `DR-32`) |
| `settings.setDevice` | `{kind:'microphone'\|'camera'\|'output', deviceId}` | `{}` |
| `settings.setVolume` | `{kind:'input'\|'output', value:0..100}` | `{}` |
| `settings.setParticipantVolume` | `{communityId, identityKey, volume:0..100}` | `{}` |
| `settings.setNotifications` | `{enabled?, communityId?, level?}` | `{}` |

#### Cargos e membros — todas ⏱

| Comando | Argumento | Perm. | Resposta | Erros |
|---|---|---|---|---|
| `role.create` | `{communityId, name, color, permissions[], mentionable, afterRoleId?}` | `manage_roles` | `{roleId, seq, rank}` | `E_PERMISSION_ESCALATION`, `E_HIERARCHY`, `E_LIMIT_EXCEEDED` |
| `role.update` | `{communityId, roleId, name?, color?, permissions?, mentionable?}` | `manage_roles` | `{seq}` | `E_FOUNDER_IMMUTABLE`, `E_PERMISSION_ESCALATION`, `E_BASE_ROLE_RESTRICTED` |
| `role.move` | `{communityId, roleId, afterRoleId?, beforeRoleId?}` | `manage_roles` | `{seq, rank}` — **só o cargo movido muda** (§6.4.1) | `E_FOUNDER_TOP`, `E_HIERARCHY` |
| `role.delete` | `{communityId, roleId}` | `manage_roles` | `{seq, affectedMembers, clearedChannelRefs}` | `E_BASE_ROLE_REQUIRED`, `E_FOUNDER_IMMUTABLE` |
| `member.setRoles` | `{communityId, targetKey, roleIds[]}` | `manage_roles` | `{seq, appliedRoleIds[]}` — devolve o conjunto **efetivamente aplicado** após §8.4.1 | `E_HIERARCHY`, `E_BASE_ROLE_REQUIRED` |
| `member.setNickname` | `{communityId, nickname\|null}` | — | `{seq}` | `E_NICKNAME_SELF_ONLY` |

#### Mensagens — todas **A** (assíncronas por contrato)

| Comando | Argumento | Perm. | Resposta | Erros síncronos |
|---|---|---|---|---|
| `message.send` | `{communityId, channelId, content, mentions[], attachment?, replyToId?, threadId?, clientRef}` | `send_messages` | `{opId, state:'queued'}` | `E_VALIDATION`, `E_CHANNEL_READ_ONLY`, `E_OUTBOX_FULL`, `E_QUOTA_EXCEEDED` |
| `message.edit` | `{communityId, messageId, content, clientRef}` | própria | `{opId, state}` | `E_CANNOT_EDIT_OTHERS`, `E_MESSAGE_DELETED`, `E_VALIDATION` |
| `message.delete` | `{communityId, messageId, reason?, clientRef}` | própria \| `manage_messages` | `{opId, state}` | `E_PERMISSION_DENIED`, `E_HIERARCHY` |
| `message.pin` | `{communityId, messageId, pinned, clientRef}` | `pin_messages` | `{opId, state}` | `E_PERMISSION_DENIED` |
| `message.react` | `{communityId, messageId, emoji, present, clientRef}` | `add_reactions` | `{opId, state}` | `E_REACTION_LIMIT`, `E_MESSAGE_DELETED` |
| `thread.create` | `{communityId, rootMessageId, clientRef}` | `send_messages` | `{opId, state}` | `E_THREAD_EXISTS` |
| `message.retry` | `{opId}` | — | `{state}` — **mesmo envelope** | `E_NOT_FOUND` |
| `message.cancelQueued` | `{opId}` | — | `{}` | `E_NOT_FOUND`, `E_ALREADY_SENT` |

Os erros da coluna são **síncronos** e vêm da validação advisória local (§8.7). O desfecho
real chega por `message.accepted` / `message.failed` / `message.dropped`.

#### Moderação — todas ⏱

| Comando | Argumento | Perm. | Resposta | Erros |
|---|---|---|---|---|
| `mod.kick` | `{communityId, targetKey, reason?}` | `kick_members` | `{seq}` | `E_HIERARCHY`, `E_FOUNDER_IMMUNE`, `E_HOST_IMMUNE`, `E_SELF_TARGET` |
| `mod.ban` | `{communityId, targetKey, reason?}` | `ban_members` | `{seq, hiddenMessages, revokedInvites}` | idem |
| `mod.revokeBan` | `{communityId, targetKey}` | `ban_members` | `{seq, restoredMessages}` | `E_NOT_BANNED` |
| `mod.timeout` | `{communityId, targetKey, until, reason?}` | `timeout_members` | `{seq}` | `E_VALIDATION.until` |
| `mod.removeTimeout` | `{communityId, targetKey}` | `timeout_members` | `{seq}` | — |

#### Convites — todas ⏱

| Comando | Argumento | Perm. | Resposta | Erros |
|---|---|---|---|---|
| `invite.create` | `{communityId, expiresInDays?, maxUses?, label?}` | `create_invite` | `{invitePublicKey, code, expiresAt?, maxUses?, seq}` — **`code` só aqui e só para quem cria** | `E_LIMIT_EXCEEDED`, `E_VALIDATION` |
| `invite.revoke` | `{communityId, invitePublicKey}` | autor \| `manage_community` | `{seq}` | `E_NOT_FOUND`, `E_PERMISSION_DENIED` |
| `invite.resolve` | `{codeOrLink}` | open | `InvitePreview` (§15.6) | `E_MALFORMED` |
| `invite.redeem` | `{codeOrLink, displayName?, avatarColor?}` | standard | `{communityId, defaultChannelId, seq}` | `E_INVITE_INVALID`, `E_INVITE_EXHAUSTED`, `E_BANNED`, `E_HOST_UNAVAILABLE`, `E_LIMIT_EXCEEDED` |

**Gramática de `codeOrLink` (fecha `DR-34`), normativa:**

```
entrada := codigo | link
codigo  := 16 caracteres do alfabeto Crockford Base32 (0-9 A-H J-N P-T V-Z),
           case-insensitive, aceitando '-' e espaço como separadores ignorados
link    := 'comunidadep2p://join/' codigo
         | scheme '://' host '/invite/' codigo        (qualquer host — o host do link
                                                       é ignorado e nunca contactado)
```

Normalização: remove espaços e `-`, maiúsculas, aplica o mapeamento Crockford
(`I,L → 1`, `O → 0`), exige exatamente 16 símbolos válidos. Qualquer outra coisa →
`E_MALFORMED`. **O domínio do link nunca é resolvido nem acessado** — não há requisição
HTTP em lugar nenhum.

#### Voz, tela e relay

| Comando | Argumento | Perm. | Resposta | Erros |
|---|---|---|---|---|
| `voice.join` ⏱ | `{communityId, channelId}` | `voice_speak` | `{sessionId, roster[], iceServers[], tickets[]}` (§17.4) | `E_HOST_UNAVAILABLE`, `E_CHANNEL_NOT_VOICE`, `E_PERMISSION_DENIED`, `E_VOICE_FULL` |
| `voice.leave` | `{}` | — | `{}` | — |
| `voice.setSelf` | `{muted?, deafened?, cameraOn?, speaking?}` | — | `{}` | `E_CAMERA_LIMIT` |
| `voice.muteParticipant` | `{communityId, identityKey, muted}` | `voice_mute_others` | `{}` | `E_PERMISSION_DENIED` |
| `voice.signal` | `{peerKey, ticketId, sdp?, ice?}` | — | `{}` | `E_PEER_UNREACHABLE`, `E_TICKET_INVALID` |
| `share.start` ⏱ | `{communityId, channelId, quality}` | `voice_share_screen` | `{sessionId, captureToken}` (§17.5) | `E_ALREADY_SHARING`, `E_PERMISSION_DENIED` |
| `share.stop` | `{sessionId}` | apresentador | `{}` | — |
| `share.setQuality` | `{sessionId, quality}` | espectador | `{applied:bool}` (§17.5) | `E_SESSION_GONE` |
| `share.join` ⏱ | `{sessionId}` | participante da voz | `{ticketId, presenterKey}` | `E_SESSION_GONE`, `E_SESSION_FULL` |
| `relay.enable` ⏱ | `{communityId}` | — | `{relayPublicKey, seq, expiresAt}` | `E_CONSENT_REQUIRED` |
| `relay.disable` ⏱ | `{communityId}` | — | `{seq}` | — |
| `relay.respondConsent` | `{communityId, accept, remember}` | — | `{}` | — |

#### Arquivos e diagnóstico

| Comando | Argumento | Cl. | Resposta | Erros |
|---|---|---|---|---|
| `file.pickForAttachment` | `{communityId}` | standard | `{ticketId, name, sizeBytes, kind}` — o main abre o diálogo | `E_CANCELLED`, `E_ATTACHMENT_TOO_LARGE`, `E_VALIDATION.name` |
| `blob.stage` | `{ticketId}` | standard | `{blobsCoreKey, blobId, name, sizeBytes, kind, hash}` | `E_TICKET_INVALID`, `E_FILE_UNREADABLE`, `E_QUOTA_EXCEEDED` |
| `blob.download` | `{communityId, blobsCoreKey, blobId}` | standard | `{state}` | `E_NO_PEERS` |
| `blob.cancel` | `{blobsCoreKey, blobId}` | standard | `{}` | — |
| `blob.reveal` | `{blobsCoreKey, blobId, mode:'open'\|'folder'}` | standard / main-confirmed | `{}` | `E_NOT_DOWNLOADED`, `E_TYPE_NOT_OPENABLE` |
| `diag.run` | `{}` | standard | `{natType, peerCount, relayAvailable, stunReachable, ranAt}` | — |
| `diag.snapshot` | `{}` | standard | Métricas de §24.3 | — |
| `host.exitImpact` | `{}` | standard | `[{communityId, name, onlineCount, inCallCount, pendingReplication}]` | — |

**`host.notifyBeforeExit` foi removido.** Ver §18.7 e delta U-06.

#### Injeção de falha (só em build `dev`)

`dev.hostOffline` · `dev.hostOnline` · `dev.failNextSubmit` · `dev.dropBlobPeer` ·
`dev.setPeerMesh` · `dev.failVoiceJoin` · `dev.startRemoteShare` · `dev.addViewer` ·
`dev.clearViewers` · `dev.forceRelay` · `dev.failShare` · `dev.forgetConsent` ·
`dev.setNatType` · `dev.seedDataset` · `dev.stallReplication` · `dev.corruptNextBlob` ·
`dev.resetAll`

O mapa botão↔comando está no Apêndice B, agora **com os nomes reais das ações do mock**
(fecha `RT-15`).

### 15.5 IPC-R — eventos

Cada evento é **sinal para reconsultar**, com o mínimo para a UI decidir se precisa.
`communityId` está sempre presente quando aplicável.

| Topic | Payload | Dispara |
|---|---|---|
| `core.ready` | `{phase, epoch}` | Núcleo pronto |
| `core.restarted` | `{epoch, attempt}` | Reinício após crash |
| `core.reprojecting` | `{communityId, done, total}` | Reprojeção longa |
| `core.clockSuspect` | `{communityId, skewMs}` | §11.4 |
| `community.joined` / `community.left` | `{communityId, reason?}` | — |
| `community.changed` | `{communityId, fields[]}` | `community.update`, `assumeHost` |
| `community.ended` | `{communityId}` | — |
| `community.replication` | `{communityId, state, lag, etaMs?, reason?}` | §14.5 |
| `community.accessRevoked` | `{communityId, cause:'banned'\|'kicked'\|'unauthorized'}` | §14.3, §18.4 |
| `community.forked` | `{communityId}` | §5.5 L-4 |
| `community.partialInterpretation` | `{communityId, unknownKinds[], unknownVersions[]}` | §7.2 regra 5 |
| `structure.changed` | `{communityId, channels[], categories[]}` | Qualquer op de estrutura |
| `roles.changed` | `{communityId, roleIds[]}` | Qualquer op de cargo |
| `members.changed` | `{communityId, identityKeys[]}` | Roster, cargos, apelido, ban, timeout |
| `messages.appended` | `{communityId, channelId, fromSeq, toSeq, hasMention}` | Lote projetado |
| `message.updated` | `{communityId, messageId, channelId, fields[]}` | Edição, pin, reação, delete |
| `message.accepted` | `{opId, clientRef, messageId, seq, channelId}` | **Emitido pela reconciliação** (§11.6), depois de `messages.appended` |
| `message.failed` | `{opId, clientRef, code, retryInMs?, terminal:bool}` | — |
| `message.dropped` | `{opId, clientRef, reason, channelId}` | §11.7 |
| `outbox.changed` | `{communityId, queued, sending, failed}` | — |
| `outbox.flushed` | `{communityId, delivered}` | Fila esvaziou |
| `invites.changed` | `{communityId, invitePublicKeys[]}` | **Novo** — fecha `F-34`/`C-4`/`C-6` |
| `auditLog.changed` | `{communityId, fromSeq, toSeq}` | **Novo** — fecha `F-34`/`P-14` |
| `host.statusChanged` | `{communityId, status, lastSeenAt, attempt?}` | Enum fechado de `hostStatus` (§15.6) — fecha `DR-29`/`DR-33` |
| `swarm.changed` | `{peerCount, degraded, byCommunity:[{communityId, peers}]}` | — |
| `nat.detected` | `{natType}` | — |
| `presence.changed` | `{communityId, entries[]}` | Delta agregado a cada `PRESENCE_TICK_MS` |
| `typing.changed` | `{communityId, channelId, identityKeys[]}` | TTL 5 s |
| `unread.changed` | `{communityId, channelId?, threadId?, unreadCount, pendingMentions}` | Recalculado |
| `voice.occupancyChanged` | `{communityId, channelId, count, firstKeys[]}` | **Novo** — alimenta a sidebar (fecha `RT-05`) |
| `voice.roster` | `{communityId, channelId, participants[]}` | Só a participantes |
| `voice.meshChanged` | `{peerKey, status}` | Falha assimétrica |
| `voice.failed` | `{reason}` | Falha total |
| `voice.revoked` | `{communityId, targetKey, sessionId}` | Moderação (§17.4) |
| `voice.signal` | `{peerKey, ticketId, sdp?, ice?}` | Sinalização recebida |
| `voice.deviceError` | `{kind:'microphone'\|'camera', code}` | **Novo** — fecha `RT-10` |
| `share.started` / `share.stopped` | `{sessionId, presenterKey, channelId}` | — |
| `share.viewersChanged` | `{sessionId, viewerCount}` | — |
| `share.health` | `{sessionId, viewers[{key, rttMs, lossPct, quality}]}` | **Só ao apresentador** (fecha `RT-08`) |
| `share.failed` | `{sessionId, reason}` | **Agora está na tabela** (fecha `V-18`) |
| `relay.consentRequested` | `{communityId, reason}` | §17.7 |
| `relay.stateChanged` | `{communityId, enabled, expiresAt, bytesRelayed}` | — |
| `blob.progress` | `{blobsCoreKey, blobId, progress, bytesDownloaded, peers, hostAvailable}` | A cada 500 ms |
| `blob.completed` | `{blobsCoreKey, blobId, path}` | Verificado |
| `blob.peerLost` | `{blobsCoreKey, blobId, remaining}` | — |
| `blob.unavailable` | `{blobsCoreKey, blobId}` | Zero pares |
| `attachment.corrupt` | `{blobsCoreKey, blobId, cause:'hash'\|'size'}` | Fecha `A-5` |
| `config.nonDefault` | `{keys[]}` | Configuração de rede fora do default (§25.5) |

### 15.6 IPC-R — queries, **com schema de resposta**

Fecha `DR-46` (nenhuma das 17 queries tinha schema) e as cinco superfícies sem fonte de
dado (`RT-02`, `RT-05`, `DR-47`, `DR-48`, `DR-38`).

Tipos compartilhados (mapeiam 1:1 para `frontend/src/domain/types.ts` — a correspondência
completa está em `deltas-ux-v2.md` §4):

```ts
type Key       = string   // hex64
type Ms        = number
type Cursor    = string   // base64url opaco, {seq, id}
type Rank      = string

type UserRef   = { key: Key, displayName: string, handle: string,
                   avatarColor: string, nickname?: string,
                   collision: boolean }                      // §6.1 L-5

type HostStatus = 'unknown' | 'connecting' | 'online' | 'reconnecting'
                | 'offline' | 'ended' | 'unauthorized' | 'incompatible' | 'forked'

type ReplicationState = 'synced' | 'catching-up' | 'stalled' | 'blocked'
                      | 'unauthorized' | 'forked'

type CoreStatus = {
  phase: 'boot'|'awaiting-identity'|'opening'|'ready'|'draining'|'stopped'
  epoch: number, coreVersion: string, opVersion: number
  manifestSchemaVersion: number, viewSchemaVersion: number
  keystore: 'secure' | 'insecure-fallback'
  buildChannel: 'prod' | 'dev'
}
```

| Query | Argumento | Resposta |
|---|---|---|
| `query.identity` | `{}` | `{key, displayName, handle, avatarColor, presence, createdAt} \| null` |
| `query.communities` | `{}` | `[{ id, name, iconEmoji?, iconColor, memberCount, isHostedByMe, hostStatus: HostStatus, replication: {state, lag}, unread:{count, mentions}, notificationLevel, endedAt?, inactiveDays, partialInterpretation }]` na ordem de entrada |
| `query.community` | `{communityId}` | `{ ...community, myPermissions: string[], myRoleIds: string[], myTopRank: Rank, isHost, hostRef: UserRef, successorKeys: Key[], replication, partialInterpretation }` |
| `query.structure` | `{communityId}` | `{ categories: [{ id, name, rank, collapsed, channels: [{ id, name, type, topic?, rank, readOnly: boolean, muted, unread:{count,mentions}, firstUnreadSeq?, voice?: {count, first: UserRef[]} }] }] }` — `voice` fecha `RT-05` |
| `query.messages` | `{communityId, channelId, cursor?, limit=50, direction:'before'\|'after'}` | `{ messages: MessageDto[], nextCursor?, hasMore, replication: ReplicationState }` |
| `query.message` | `{communityId, messageId}` | `MessageDto & { reactions: ReactionDto[], attachment?: AttachmentDto, thread?: ThreadRefDto } \| null` |
| `query.reactors` | `{communityId, messageId, emoji, limit=24}` | `{ total, users: UserRef[] }` — fecha `DR-47` |
| `query.thread` | `{communityId, threadId, cursor?, limit=50}` | `{ root: MessageDto, replies: MessageDto[], nextCursor?, replyCount, participants: UserRef[], unread:{count} }` — fecha `DR-48` |
| `query.pinned` | `{communityId, channelId, cursor?, limit=25}` | `{ items: MessageDto[], nextCursor?, hasMore }` |
| `query.files` | `{communityId, channelId, cursor?, limit=25}` | `{ items: [{ messageId, at, author: UserRef, attachment: AttachmentDto }], nextCursor?, hasMore }` |
| `query.links` | `{communityId, channelId, cursor?, limit=25}` | `{ items: [{ messageId, at, author: UserRef, url, host }], nextCursor?, hasMore }` — fonte: `message_links` (§15.6.1) |
| `query.members` | `{communityId, filter?:{query?, roleId?, onlyOnline?}, cursor?, limit=100}` | `{ groups: [{ roleId, roleName, roleColor, rank, members: (UserRef & {presence, joinedAt})[] }], offlineCount, total, nextCursor? }` |
| `query.member` | `{communityId, identityKey}` | `{ ...UserRef, roleIds, roles: [{id,name,color,rank}], joinedAt, presence, banned, timeoutUntil?, canModerate, canKick, canBan, canTimeout, canSetRoles, storageUsedBytes }` |
| `query.roles` | `{communityId}` | `{ roles: [{ id, name, color, rank, permissions, mentionable, isFounder, isDefault, memberCount }] }` ordenado por `rank DESC` |
| `query.invites` | `{communityId}` | `{ items: [{ invitePublicKey, code?: string, codeAvailable: boolean, label?, createdBy: UserRef, createdAt, expiresAt?, maxUses?, uses, revokedAt? }] }` — `code` só nos criados nesta instalação (delta U-04) |
| `query.auditLog` | `{communityId, type?, byKey?, from?, to?, cursor?, limit=25}` | `{ items: [{ id, seq, type, targetId?, targetKey?, targetLabel, by: UserRef, byLabel, reason?, at }], nextCursor?, hasMore }` — **exige `view_audit_log`**, senão `E_PERMISSION_DENIED` |
| `query.bans` | `{communityId, cursor?, limit=25}` | `{ items: [{ target: UserRef, by: UserRef, at, reason? }], nextCursor?, hasMore }` — exige `view_audit_log` ou `ban_members` |
| `query.timeouts` | `{communityId, cursor?, limit=25}` | `{ items: [{ target: UserRef, by: UserRef, at, until, reason?, expired: boolean }], nextCursor?, hasMore }` — `expired` é calculado contra o `hostTs` do último registro |
| `query.search` | §23.1 | `{ messages: [{...MessageDto, channelId, channelName, snippet}], channels: [...], members: UserRef[], partial: boolean, partialReason?: 'host-offline'\|'catching-up'\|'stalled'\|'partial-interpretation' }` |
| `query.outbox` | `{communityId?}` | `{ items: [{ opId, clientRef?, communityId, channelId?, channelName?, kind, kindLabel, state, attempts, nextAttemptAt, lastError?, droppedReason?, preview: { content?: string, emoji?: string, targetMessageId?: string } }], counts:{queued,sending,failed} }` — **`preview` é o que permite a UI redesenhar a fila ao reabrir** (fecha `F-16`) |
| `query.preferences` | `{}` | `{ device:{microphoneId?, cameraId?, outputId?, inputVolume, outputVolume}, notifications:{enabled, byCommunity:[{communityId, level}]}, channels:[{channelId, muted}], relayConsent:[{communityId, decision, at}], participantVolumes:[{communityId, identityKey, volume}] }` — fecha `RT-02` |
| `query.hostStatus` | `{communityId}` | `{ status: HostStatus, lastSeenAt?, inactiveDays, replication: {state, lag}, attempt? }` |
| `query.resolveMessageLink` | `{ref}` | `{ status:'ok', communityId, channelId, messageId, seq } \| { status:'not-member', communityId } \| { status:'not-synced', communityId, channelId } \| { status:'deleted' } \| { status:'malformed' }` — fecha `RT-04` |
| `query.selfModeration` | `{communityId}` | `{ banned: boolean, bannedAt?, kicked: boolean, timeoutUntil?, byLabel?, reason? }` — alimenta a tela de §18.4 |

#### 15.6.1 `MessageDto` e derivados

```ts
type MessageDto = {
  id: string, seq: number, channelId: string
  author: UserRef
  content: string | null                     // null quando tombstonada
  authorTs: Ms, hostTs: Ms, clockSkewed: boolean   // fecha F-33/M-17
  editedAt?: Ms, pinned: boolean
  replyTo?: { messageId, author: UserRef, excerpt: string | null, deleted: boolean }
  threadId?: string, threadReplyCount?: number
  mentions: { identityKeys: Key[], roleIds: string[], everyone: boolean }
  mentionsMe: boolean
  hasAttachment: boolean
  deleted: boolean, hiddenByBan: boolean
}
type ReactionDto   = { emoji: string, count: number, mine: boolean }
type AttachmentDto = { blobsCoreKey: Key, blobId: object, name, sizeBytes, kind, hash,
                       state: BlobState, progress: number, availablePeers: number,
                       hostAvailable: boolean, localPath?: string }
```

**`replyTo` para mensagem deletada (fecha `F-47`/`M-7`):** a resposta continua existindo,
com `excerpt: null` e `deleted: true`. A UI exibe "mensagem removida" no lugar da citação.
Comportamento definido, não inventado.

**Extração de links (fecha `DR-38`):** o `fold` extrai do `content`, no efeito de
`message.send`/`message.edit`, todas as ocorrências que casem
`\b(https?):\/\/[^\s<>"']{1,2000}` — **só `http` e `https`**, no máximo 8 por mensagem, na
ordem de aparição, gravando `url` e `host` (o registrable domain, sem porta e sem
credenciais). Sem unfurl, nunca — buscar a página vazaria o IP de todo mundo. A mesma
allowlist de esquema vale para o renderizador de markdown (fecha `T-18`): links com
esquema fora de `http`/`https`/`mailto` são renderizados como **texto**, não como âncora.

**Cursor:** `base64url({seq, id})`, opaco. Inválido, de outra tabela ou de outra
comunidade → `E_BAD_CURSOR`, e a UI recomeça do início. Nunca resultado errado em silêncio.

**Enforcement de leitura (fecha `DR-25`, `T-44`):** `query.auditLog`, `query.bans` e
`query.timeouts` exigem a permissão e devolvem `E_PERMISSION_DENIED` sem ela.
**LIMITAÇÃO DECLARADA (L-10):** como a replicação é integral, um cliente adulterado
consegue ler as tabelas do próprio disco. `view_audit_log` é confidencialidade **local**,
não segredo criptográfico. A UX precisa dizer isso (delta U-07).

### 15.7 IPC-M — main ↔ núcleo

| Mensagem | Direção | Payload |
|---|---|---|
| `key.wrap` / `key.wrapped` | núcleo → main → núcleo | `{plaintextB64}` / `{ciphertextB64}` |
| `key.unwrap` / `key.unwrapped` | núcleo → main → núcleo | `{ciphertextB64}` / `{plaintextB64}` |
| `staging.ticket` | main → núcleo | `{ticketId, path, sizeBytes, communityId}` |
| `auth.token` | main → núcleo | `{token, cmd, expiresAt}` |
| `deeplink` | main → núcleo | `{route:'join'\|'message', code \| ref}` (já parseado, §3.5) |
| `capture.authorize` / `capture.decision` | main → núcleo → main | `{sessionId}` / `{allowed, sourceTypes}` (§17.5) |
| `exit.impact` / `exit.impactResult` | main → núcleo → main | `{}` / `[{communityId, name, onlineCount, inCallCount, pendingReplication}]` |
| `file.save` | núcleo → main | `{suggestedName, dataRef}` — usado por `identity.export` |
| `shell.open` | núcleo → main | `{path, mode}` — só depois da allowlist de §13.6 |

**Nenhuma mensagem de IPC-M carrega dado de domínio.** Nenhuma delas é acessível ao
renderer, direta ou indiretamente.

---

## 16. Contratos RPC P2P

### 16.1 Transporte

`protomux-rpc` sobre o stream do Hyperswarm. **Dois protocolos distintos, com canais
distintos:**

| Protocolo | Uso | Autorização |
|---|---|---|
| `p2p-community/1` | Ops, roster, mídia, blobs — um canal por comunidade, chaveado pelo `coreKey` | §14.3 — o canal só abre se o par for membro ativo não banido |
| `p2p-admission/1` | `inviteResolve`, `inviteRedeem` | Nenhuma; tetos e cotas de §12.6 |

| Parâmetro | Membro | Pré-membro |
|---|---|---|
| Timeout de request | 15 000 ms (30 000 ms para `redeem`) | 10 000 ms |
| Requests em voo | 8 | 2 |
| Frame máximo antes do decode | 64 KiB | 4 KiB |
| Reconexão | `rpcClient` reabre na conexão seguinte; requests em voo falham com `E_HOST_UNAVAILABLE` e voltam à outbox | — |
| Circuit breaker | §11.8 | — |

### 16.2 Métodos

| Método | Protocolo | Request | Response | Erros |
|---|---|---|---|---|
| `hello` | community | `{clientVersion, opVersion}` | `{hostVersion, opVersion, coreLength, memberCount, capabilities[]}` | `E_VERSION_UNSUPPORTED`, `E_NOT_AUTHORIZED_FOR_COMMUNITY` |
| `submitOp` | community | `{envelope}` | `{seq, hostTs}` | Todos os de §8.2 |
| `submitOps` | community | `{envelopes[≤32]}` | §11.9 | — |
| `admissionHello` | admission | `{clientOpVersion}` | `{challenge, hostPk, hostOpVersion}` | `E_VERSION_UNSUPPORTED` |
| `inviteResolve` | admission | `{invitePk, candidatePk, liveProof}` | `InvitePreview` | `E_INVITE_INVALID` |
| `inviteRedeem` | admission | `{envelope, liveProof}` | `{seq, communityId, coreKey, blobsKey, hostKey, defaultChannelId}` | `E_INVITE_EXHAUSTED`, `E_BANNED`, `E_INVITE_INVALID` |
| `voiceJoin` | community | `{channelId}` | `{sessionId, roster[], iceServers[], tickets[], turnCredential}` | `E_PERMISSION_DENIED`, `E_VOICE_FULL` |
| `voiceLeave` | community | `{sessionId}` | `{}` | — |
| `voiceState` | community | `{muted, deafened, cameraOn, speaking}` | `{}` | — |
| `voiceTicket` | community | `{sessionId, peerKey}` | `{ticketId, ticket, expiresAt}` | `E_TICKET_DENIED` |
| `shareStart` | community | `{channelId, quality}` | `{sessionId}` | `E_PERMISSION_DENIED`, `E_ALREADY_SHARING` |
| `shareJoin` | community | `{sessionId}` | `{ticketId, presenterKey}` | `E_SESSION_GONE`, `E_SESSION_FULL` |
| `shareLeave` | community | `{sessionId}` | `{}` | — |
| `presencePublish` | community | `{status, typingChannelId?}` | `{}` | `E_RATE_LIMITED` |
| `subscribeChannel` | community | `{channelId, on:bool}` | `{}` | — assinatura de interesse para `typing` (§17.6) |
| `stunBinding` | community (mesmo socket UDX) | Pacote STUN RFC 5389 | Binding Response | — §17.3 |

**Fluxo obrigatório na primeira conexão:** `hello` antes de qualquer outro método.
`opVersion` incompatível → o cliente entra em **somente-leitura** naquela comunidade,
emite `host.statusChanged{status:'incompatible'}`, e todo item de outbox daquela comunidade
vira `dropped/client-outdated` (§11.6). Nunca envia op que o host não entende.

---

## 17. Mídia: voz, câmera e tela

Resposta direta ao blocker B8. Esta seção **revoga** ADR-05/06/07/08/17 de v1 e as
substitui.

### 17.1 O que foi revogado e por quê

| Decisão de v1 | Por que caiu |
|---|---|
| "O endereço do HyperDHT é injetado como candidato ICE" (ADR-06) | O mapeamento NAT é **por socket**. A socket que o núcleo usa no DHT não é a socket que o `RTCPeerConnection` do renderer cria. Sob NAT dependente de porta ou de destino, o candidato derivado é inválido. Não é uma otimização arriscada: é uma premissa falsa (`F-19`) |
| "UDX é o fallback universal de voz" (ADR-07) | UDX declara "no handshakes, no encryption, no features". Não fornece ICE, DTLS-SRTP, jitter buffer, PLC, AEC, FEC, codec nem `MediaStreamTrack`. "Cair para UDX" significa **construir uma pilha de mídia**, que é exatamente o que ADR-05 existia para evitar (`F-20`) |
| "Blind relay não lê porque UDX é cifrado" (ADR-08) | UDX não cifra. A afirmação de confidencialidade era falsa (`T-11`) |
| Árvore WebCodecs+UDX no v1 (ADR-17) | Exige, junto: forwarding opaco, uma camada criptográfica autenticada própria, handshake de aresta, ACK de atribuição e reparo — nada disso especificado nem medido (`DS-14`, `DR-43`, `T-11`, `T-13`) |
| Sinalização peer-a-peer sem autorização | Qualquer chave conhecida abria conexão com qualquer membro (`T-15`) |

### 17.2 A arquitetura de mídia v2

> **Toda mídia do v1 — voz, câmera e tela — é WebRTC no renderer, ponta a ponta, com
> DTLS-SRTP. O núcleo nunca vê mídia. A conectividade é resolvida por ICE, com os serviços
> STUN e TURN prestados pelo *host da própria comunidade*, que já é um par dela.**

Por que isso é coerente com "sem servidor central": o host **já** é a autoridade daquela
comunidade, já precisa estar online para a voz existir (`VOZ-09`), e já é alcançável. Ele
não é um terceiro. Nenhum endereço de membro vaza para fora da comunidade.

Por que isso é honesto: DTLS-SRTP é negociado **entre os pares**. Um relay TURN encaminha
pacotes que não consegue decifrar. "Relay cego" deixa de ser uma afirmação e passa a ser
uma propriedade do protocolo.

| Camada | v1 | v2 |
|---|---|---|
| Voz e câmera | WebRTC mesh | **WebRTC mesh** (mantido) |
| Descoberta de endereço | Candidato do DHT | **STUN servido pelo host** (§17.3) |
| Fallback de conectividade | UDX "universal" | **TURN servido pelo host, e por voluntários** (§17.3, §17.7) |
| Autorização de sessão | Nenhuma | **Ticket assinado pelo host** (§17.4) |
| Tela | WebCodecs + UDX + árvore | **WebRTC estrela, ≤ 8 espectadores** (§17.5) |
| Árvore de multicast | v1 | **Adiada, especificada, bloqueada por POC-09** (§17.8) |
| STUN de terceiros | Configurável, default vazio | **Configurável, default vazio, com aviso** (mantido) |

### 17.3 STUN e TURN comunitários

O núcleo do host escuta STUN/TURN **na mesma socket UDP do UDX**, demultiplexando pelo
cabeçalho (os dois primeiros bits `00` e o magic cookie `0x2112A442` identificam STUN; o
resto é UDX). Isso é a prática padrão de multiplexação ICE.

| Serviço | Escopo | Credencial |
|---|---|---|
| **STUN** (RFC 5389, Binding) | Aberto a qualquer par que já tenha conexão autenticada com o host | Nenhuma |
| **TURN** (RFC 5766, subconjunto: Allocate, Refresh, CreatePermission, Send/Data, ChannelBind) | Só membros com sessão de voz ativa | `turnCredential` de curta duração emitida em `voiceJoin`: `username = <sessionId>:<expiresAt>`, `password = HMAC(hostTurnSecret, BLAKE2b('turn-cred/1' ‖ sessionId ‖ peerKey ‖ expiresAt))` |

Controles obrigatórios do TURN do host:

| Controle | Constante |
|---|---|
| Vida da alocação | `TURN_ALLOC_TTL_MS` (10 min, renovável enquanto a sessão viver) |
| Alocações simultâneas por membro | `TURN_ALLOC_PER_MEMBER` (2) |
| Taxa por alocação | `TURN_RATE_KBPS` (default 512 kbps para voz; tela via TURN é **recusada** no v1) |
| Bytes por sessão | `TURN_SESSION_MAX_BYTES` |
| Permissões | Só para endereços de pares presentes no roster daquela sessão |

O endereço público do host é obtido do próprio `hyperdht` (ele é um servidor DHT) e
entregue em `voiceJoin` na lista `iceServers`.

**`REQUIRES POC` — G7/G8 (POC-V1).** O que precisa ser provado antes de implementar:
demultiplexação STUN/UDX numa socket compartilhada; taxa de conexão direta por classe de
NAT (full-cone, port-restricted, symmetric, CGNAT); latência e perda no caminho TURN; custo
de CPU e banda do host. Critérios e consequências em
`plano-de-validacao-experimental-v2.md`.

**LIMITAÇÃO DECLARADA (L-11):** se o host estiver atrás de CGNAT sem porta alcançável, o
serviço STUN/TURN dele não funciona para quem precisa dele. Nesse caso a voz depende dos
voluntários de relay (§17.7); sem voluntário, a conexão falha com `conn-failed`, que é um
estado desenhado. Não há TURN de terceiro e não haverá.

### 17.4 Autorização de sessão de mídia — tickets

Fecha `T-15`, `T-32`, `T-41`, `DS-15` (na parte de autorização) e `T-40` (declarando o que
é enforcement e o que é conselho).

```
1. voice.join → o host valida voice_speak, canal de voz, comunidade não ended,
   membro ativo não banido nem em timeout
2. o host emite, para cada par do roster, um ticket:
      ticket = Ed25519(hostKey, BLAKE2b('media-ticket/1' ‖ sessionId ‖ channelId
                                        ‖ peerA ‖ peerB ‖ expiresAt))
   com expiresAt = now + MEDIA_TICKET_TTL_MS (default 5 min, renovado por voiceTicket)
3. o cliente SÓ aceita sinalização (SDP/ICE) de um par que apresente ticket válido
   para (sessionId, esteParDeChaves). Sem ticket → E_TICKET_INVALID, conexão recusada
4. o cliente SÓ inicia DTLS com pares que passaram (3)
```

**Revogação:** `mod.ban`, `mod.kick`, `mod.timeout`, `channel.delete` e `voice.leave`
fazem o host emitir `voice.revoked{targetKey, sessionId}` a todos os participantes. Ao
receber, **cada cliente é obrigado a fechar imediatamente** a `RTCPeerConnection` com
aquela chave e a parar de renovar o ticket. O ticket expirado deixa de ser renovado, então
mesmo um cliente que ignore o evento perde a sessão em ≤ `MEDIA_TICKET_TTL_MS`.

**Isso é o que faz ban alcançar mídia** (`T-32`): em v1 a sessão direta sobrevivia ao ban
indefinidamente; em v2 ela morre por revogação ativa e, no pior caso, por expiração de
ticket em 5 minutos.

**LIMITAÇÃO DECLARADA (L-12) — `voice_mute_others`:** silenciar outro participante é
**conselho ao cliente do alvo**, não enforcement de mídia: quem controla o microfone é
quem o possui. O que é enforcement é a **remoção do roster e a revogação de ticket**. A UI
precisa distinguir "silenciado nesta chamada" (reversível, cooperativo) de "removido da
chamada" (efetivo). Delta U-08.

**Captura de tela só depois da autorização (`T-41`):** o `setDisplayMediaRequestHandler` do
main **consulta o núcleo** (`capture.authorize`) e só concede se existir uma sessão
`share.start` autorizada pelo host com `captureToken` válido. A ordem é: `share.start` →
host autoriza → `captureToken` → `getDisplayMedia`. Nunca o contrário.

### 17.5 Compartilhamento de tela no v1 — estrela

| Parâmetro | Valor |
|---|---|
| Topologia | **Estrela WebRTC**: o apresentador mantém uma `RTCPeerConnection` por espectador |
| Teto de espectadores | `SHARE_MAX_VIEWERS` = **8** (constante de protocolo; a UI exibe o teto) |
| Além do teto | `E_SESSION_FULL` — estado nomeado e desenhado (delta U-09) |
| Sessões por canal | **Exatamente 1** — `E_ALREADY_SHARING` (delta U-10 retira o edge case de múltiplos compartilhamentos) |
| Quem pode assistir | **Participante do canal de voz.** Não existe audiência fora da chamada (fecha `F-18`; a fixture precisa mudar — delta U-12) |
| Qualidade por espectador | **Funciona**: em estrela, cada `RTCRtpSender` tem seu próprio `setParameters({encodings:[{maxBitrate}]})`. `share.setQuality` devolve `{applied:true}`. Fecha `F-08`/`V-13`, que existia porque o repasse opaco tornava o comando inerte |
| Perfis | `high` 2500 kbps · `balanced` 1200 · `low` 600 |
| Latência esperada | Sub-segundo, como qualquer WebRTC direto. **Sem os 1–2 s de árvore** — o delta 3 de v1 deixa de ser necessário no v1 |
| Saúde | `share.health` só ao apresentador, com `rttMs`/`lossPct`/`quality` por espectador, obtidos de `RTCStatsReport` no renderer do apresentador |

**Por que 8 e não 200:** 8 conexões de 2500 kbps são 20 Mbps de upload, que já é mais do
que a maioria das conexões residenciais entrega. O teto real depende de upload medido, e a
UI **degrada a qualidade automaticamente** conforme `share.health` reporta perda, antes de
recusar espectador. O teto de 200 espectadores de v1 dependia da árvore, que está adiada.

### 17.6 Presença, digitando e roster

Fecha `F-13` e `T-28` na parte de arquitetura; a capacidade continua `BENCHMARK REQUIRED`.

| Sinal | Fan-out | Controle |
|---|---|---|
| `presence` | O host agrega e emite **um delta consolidado** a cada `PRESENCE_TICK_MS` (2 s), só para membros com conexão ativa. Não há reemissão por evento individual | TTL 45 s, refresh 15 s; rate limit por autor: 1 publicação / 5 s |
| `typing` | Só para quem chamou `subscribeChannel{channelId, on:true}` — tipicamente as pessoas com aquele canal aberto | TTL 5 s, refresh 3 s; rate limit por autor: 1 / 2 s por canal |
| `voiceOccupancy` | A **todos** os membros conectados, agregado por canal (contagem + até 5 chaves) — é o que alimenta os avatares inline da sidebar | Emitido a cada mudança, coalescido em 1 s |
| `voiceRoster` | Só a participantes da sessão | A cada mudança |
| `shareHealth` | **Só ao apresentador** | 2 s |

**Custo (a medir em G9):** com 340 membros, presença agregada a cada 2 s é ~170
mensagens/s de saída no host no pior caso (todos conectados), contra os ~11 000/s que o
fan-out ingênuo de v1 produziria em rajada. `typing` deixa de ser broadcast de comunidade e
passa a ser broadcast de canal aberto.

**LIMITAÇÃO DECLARADA (L-13):** presença e digitando são **at-most-once**. Perder um
evento efêmero é aceitável e esperado; o TTL corrige em ≤ 45 s. Isso é declarado e não é
defeito de durabilidade (fecha `DS-30`).

### 17.7 Relay voluntário (v2)

O voluntário passa a rodar **um TURN restrito**, não um repasse de bytes de aplicação.
Isso é o que torna "cego" verdadeiro: ele encaminha SRTP que não decifra.

| Regra | Valor |
|---|---|
| Consentimento | Explícito e **persistido** (`local_relay_consent`); sem ele, `E_CONSENT_REQUIRED` |
| Chave de relay | **Derivada da identidade**: `relayPk = keyPairFromSeed(BLAKE2b('ns/relay/1' ‖ identitySeed ‖ communityId)).publicKey`. Não é possível apontar para um terceiro |
| Prova de posse | `relay.volunteer` carrega `Ed25519(identitySk, relayPk)`; o `fold` verifica (R-19). Fecha `T-14` |
| TTL | `expiresAt ≤ hostTs + RELAY_TTL_MS` (default 24 h). Expirado = não listado. Fecha o `relayKey` permanente no log de `F-49` |
| Cota | `RELAY_MAX_BYTES_PER_DAY` (default 5 GiB) e `RELAY_MAX_ALLOCS` (default 4); atingido, o voluntário para de aceitar e emite `relay.stateChanged` |
| Seleção | Por menor RTT medido localmente por quem vai usar; o host entra na lista automaticamente se for capaz |
| Superfície de UX | **Nova tela em 3.1 → Rede**, irmã do modal de consentimento de repasse (delta U-13) |
| Confidencialidade | Real: DTLS-SRTP ponta a ponta. O voluntário vê volume e temporização, não conteúdo |

**LIMITAÇÃO DECLARADA (L-14):** o voluntário observa **metadados** — com quem, quando,
quanto. Isso é inerente a relay e precisa estar no texto de consentimento.

### 17.8 Árvore de multicast — especificada e adiada

`CLAUDE.md` pede multicast em árvore para audiência grande. A decisão v2 é: **o desenho
existe e está fechado aqui; a implementação está bloqueada até POC-09 passar; o v1 não a
inclui.** Isso separa o que está decidido do que depende de validação experimental, que é
exatamente o que o ARB exigiu.

Desenho normativo, para quando for implementada:

| Item | Decisão |
|---|---|
| Transporte | WebCodecs no renderer + stream UDX dedicado por aresta, via `mediaBridge` |
| **Confidencialidade** | O apresentador gera `shareKey` (32 B) por sessão e a entrega **a cada espectador autorizado**, cifrada com `crypto_box_seal` para a chave de identidade dele, pelo RPC do host. Cada quadro é `XChaCha20-Poly1305(shareKey, nonce = sessionId ‖ seq)`. O nó de repasse encaminha **ciphertext** e não tem a chave. Fecha `T-11` |
| **Autenticidade** | O AEAD já autentica; um relay não consegue substituir quadro |
| Handshake de aresta | `treeConnect{sessionId, ticketId}` → o filho apresenta o ticket do host; o pai valida antes de abrir o stream. Fecha `DR-43` |
| ACK de atribuição | `share.assignment` exige `assignmentAck{sessionId, assignmentId}` em ≤ 2 s; sem ACK, o host reatribui. Fecha `DS-14` |
| Prova de recepção | Cada nó reporta `framesReceived` no heartbeat; uma subárvore com `framesReceived` parado é **reparada**, e `treeHealth` reflete isso — nunca fica `ok` com subárvore escura |
| Partição × morte (fecha `DS-15`) | O host distingue "não me responde" de "não recebe quadro" usando o heartbeat **dos filhos** do nó suspeito. Só reatribui pais quando os filhos também param. Um nó reatribuído recebe `assignmentRevoked` e **precisa** derrubar os streams antigos antes de abrir novos, para não existirem dois pais alimentando os mesmos filhos |
| Elegibilidade de repasse | Consentimento aceito **e** upload medido pelo UDX numa janela de 10 s **e** NAT não-CGNAT. Auto-declaração (`canRelay`, `uplinkKbps` de v1) **não** é aceita. Fecha `T-13`, `DR-44` |
| Qualidade | Por **subárvore**, não por espectador: um nó de repasse copia bytes. `share.setQuality` devolve `{applied:false, reason:'tree-topology'}` e a UI explica |
| Latência declarada | 1–2 s, somando por nível — a UX precisa admitir (delta U-14, só quando a árvore entrar) |
| Consentimento | Pedido na transição estrela→árvore **e** sempre que um nó for promovido a repasse pela primeira vez naquela sessão; nunca assumido por timeout (fecha `F-37`) |

---

## 18. Moderação, revogação, remoção e continuidade

Resposta direta ao blocker B10.

### 18.1 O que cada ação de moderação faz — tabela completa

| Ação | Efeito no log | Efeito na projeção | Efeito na rede | Efeito no cliente do alvo |
|---|---|---|---|---|
| `mod.timeout` | Registro | `timeouts` | Nenhum | Ops recusadas com `E_TIMED_OUT` até `until`; **continua lendo**; tickets de mídia revogados |
| `mod.kick` | Registro | `members.left_at`; convites do alvo revogados (R-10) | Canais de replicação fechados por quem projetou | §18.4 — modo `removed` |
| `mod.ban` | Registro | `bans`; `banned=1`; `hidden_by_ban=1` nas mensagens; `member_count−−`; convites revogados | Canais de replicação fechados; conexões derrubadas; tickets revogados | §18.4 — modo `removed`, causa `banned` |
| `mod.revokeBan` | Registro | `revoked_at`; `hidden_by_ban=0` — **reexibe** | Replicação volta a ser autorizada | O alvo volta a `left`; precisa de convite válido para reentrar |

### 18.2 Ocultação reversível

Ban oculta as mensagens do alvo; revogar o ban as reexibe. Isso é decisão fechada e a UX de
v1 sugeria remoção permanente — delta U-15.

### 18.3 O que o ban **não** faz

**LIMITAÇÃO DECLARADA (L-7, repetida aqui por ser a mais mal compreendida):** o ban não
retira do alvo o que ele já replicou. Ele impede leitura **futura**. O modal de confirmação
é obrigado a dizer isso, junto com a nota de honestidade que já existe sobre identidade
nova (L-6).

### 18.4 Ciclo de vida do dado no cliente do alvo (fecha `F-35`, `DR-35`)

Ao observar no próprio `fold` um `mod.ban`/`mod.kick` cujo alvo é a identidade local, ou ao
receber `E_NOT_AUTHORIZED_FOR_COMMUNITY` de todos os pares:

```
1. para o rpcClient e sai do swarm daquela comunidade
2. marca manifest.communities.removed_reason = 'banned' | 'kicked' | 'unauthorized'
   e retain_until = now + REMOVED_RETENTION_DAYS (default 7)
3. descarta itens de outbox daquela comunidade com motivo 'banned'/'kicked'
4. emite community.accessRevoked{cause}
5. a comunidade continua no rail, em MODO HISTÓRICO SOMENTE LEITURA, com um cabeçalho
   nomeado que diz o que aconteceu, por quem e com que motivo (query.selfModeration)
6. em retain_until, ou por community.forget, a réplica local é apagada
```

Isso é uma tela nova na UX (delta U-16) e é a diferença entre "o app quebra" e "o app
explica".

`member.leave` voluntário segue o mesmo caminho com `removed_reason = 'left'`.

### 18.5 Comunidade encerrada

`community.end` só pelo `hostKey` corrente. A comunidade fica terminal: zero ops novas, core
mantido em leitura, membros veem `community.ended` e a comunidade permanece no rail em modo
histórico — **a UX precisa especificar essa aparência** (delta U-17).

### 18.6 `identity.wipe` — máquina de estados retomável

v1 declarava `identity.wipe` sem nenhum erro possível, apesar de ele apagar o `LOCK` que o
próprio processo segurava (`F-50`). v2:

```
none → requested → swarm-down → cores-closed → view-deleted → manifest-deleted
     → key-wiped → done → none
```

- O estado vive em `manifest.meta.wipe_state`, gravado com `FULL` **antes** de cada etapa.
- `manifest-deleted` grava o estado num arquivo sentinela `p2p/WIPE` antes de remover o
  banco, porque a partir daí não há mais banco onde gravar.
- No boot, se `wipe_state ≠ none` (ou o sentinela existir), a limpeza **retoma** de onde
  parou, antes de qualquer outra coisa (§3.3).
- O `LOCK` é o **último** recurso liberado, e só depois de `key-wiped`.
- Erros possíveis, todos nomeados: `E_WIPE_INCOMPLETE{stage}` com caminho de retentativa na
  UI. Nunca "sem erro possível".
- Classe `main-confirmed` (§15.3): o renderer sozinho não consegue disparar.

### 18.7 Saída do host

`host.exitImpact` devolve, por comunidade hospedada, `{onlineCount, inCallCount,
pendingReplication}` lidos do roster **efêmero** e do estado de replicação.

**Mudança normativa (fecha `F-43`, `DR-36`, `RT-13`):** a opção "avisar quem está online"
de v1 appendava uma mensagem assinada pelo host e desligava em seguida — quase certamente
antes de ela replicar, e usando um tipo de "mensagem de sistema" que não existe no modelo.
v2 remove essa mensagem. No lugar:

1. O modal de saída mostra quantas pessoas caem e **quantas ops ainda não replicaram**.
2. O `draining` aplica a **barreira de replicação**: o host permanece no swarm até que
   `min(3, memberCount − 1)` pares confirmem `core.length` igual à cabeça, ou até
   `DRAIN_BUDGET_MS` (default 5 000 ms), o que vier primeiro.
3. Estourado o orçamento, registra `shutdown.forced{pendingReplication}` e encerra. Segurar
   o fechamento indefinidamente é pior: o usuário mata o processo e nada é gravado.
4. `core.shutdown` devolve `{drainedMs, pendingOps, replicatedTo}` para a UI ser honesta.

O mesmo procedimento vale para `community.end` (§18.5), com o mesmo orçamento.

### 18.8 Sucessão de host e continuidade da comunidade

Fecha `T-43` na parte de continuidade. Sem isso, a máquina do host morrer é a comunidade
morrer, o que o ARB registrou como limitação de produto não aceita.

**Escrow.** O host designa até 5 sucessores em ordem de prioridade
(`community.setSuccessors`). Para cada um, appenda `community.escrow{targetKey,
wrappedSeed}` com `crypto_box_seal(communitySeed, x25519(targetKey))`. Só o sucessor
consegue abrir. O `communitySeed` **nunca** aparece em claro no log.

**Assunção.** Depois de `HOST_INACTIVITY_MS` (default 30 dias) sem novo registro no log,
o sucessor de maior prioridade pode assumir. A assunção **não** appenda no core antigo —
isso produziria dois escritores e um fork. Em vez disso:

```
1. o sucessor decifra communitySeed do escrow
2. cria uma comunidade NOVA, cujo lote de gênese é:
     community.create{ ..., originCommunityId, originFinalSeq, blobsKey novo }
   assinada pela identidade dele, e com o core derivado de um seed NOVO
3. appenda community.assumeHost{ newHostKey, observedHostTs,
     proof = Ed25519(logSecretKeyDoCoreAntigo,
                     BLAKE2b('assume/1' ‖ newCommunityId ‖ originFinalSeq)) }
   — no core NOVO, como seq 6 (logo após a gênese de R-27). A prova demonstra posse da
   chave de escrita antiga, portanto autorização legítima, SEM exigir escrita no core
   antigo — que é o que evita o fork
4. toda réplica verifica a camada (a) de R-18 usando originCommunityId, que É a chave
   pública do core antigo e está na gênese: verificação self-contained, sem precisar ter
   a comunidade de origem. Quem TEM a origem replicada verifica também a camada (b)
   (sucessor autorizado, grace period, prioridade) e, se ela falhar, marca a continuação
   como `disputed` e NÃO migra
5. os membros seguem o ponteiro: o cliente que tem a comunidade antiga e vê um
   community.assumeHost válido apontando para ela migra o rail para a nova, mantendo
   a antiga em modo histórico
6. o estado inicial da comunidade nova é reconstruído pelo sucessor a partir do
   log antigo, appendado como um lote de gênese estendido (membros, cargos, canais,
   categorias, bans) — mensagens NÃO são migradas
```

**LIMITAÇÃO DECLARADA (L-15):** a sucessão preserva estrutura, membros, cargos e
moderação. **O histórico de mensagens permanece na comunidade antiga**, acessível em modo
histórico para quem já o replicou. Migrar milhões de mensagens reassinadas pelo sucessor
falsificaria autoria; migrar os envelopes originais exigiria um core multi-escritor. Nenhum
dos dois é aceitável. A UX precisa dizer isso na tela de sucessão (delta U-18).

**LIMITAÇÃO DECLARADA (L-16):** se dois sucessores assumirem em janelas próximas, existem
duas comunidades novas. `R-18` faz cada réplica seguir a de **maior prioridade** entre as
que apresentarem prova válida; a outra fica órfã. Determinístico, mas visível.

`REQUIRES POC` — G12.

### 18.9 Fork detectado

Se o Hypercore reportar bloco conflitante (dois escritores com a mesma chave — §5.5 L-4), o
núcleo: para de appendar naquela comunidade; marca `forked`; emite `community.forked`;
oferece **exportar** a réplica local e **escolher** qual ramo seguir. Não há merge
automático, e não haverá.

### 18.10 Moderação em escala

`CLAUDE.md` lista "moderação em escala sem autoridade central" como problema em aberto.
v2 **não** o resolve e declara o escopo: moderação é **por comunidade**, via cargos e
permissões, sem reputação, sem lista compartilhada, sem federação. **LIMITAÇÃO DECLARADA
(L-17).**

---

## 19. Fluxos

Template: **Entrada · Sequência · Regras · Persistência · Resultado · Falhas.**

### 19.1 Criar comunidade / virar host

**Entrada:** identidade existe; `community.create` válido.
**Sequência:**
1. Gera `communitySeed`; grava em `manifest.communities` com `FULL` (§5.3).
2. Deriva os dois pares de chaves; cria os cores por chave explícita.
3. Deriva o core de blobs local do membro (§13.1) e grava em `manifest.member_blobs_core`.
4. Monta o **lote de gênese** (forma normativa em **R-27**): 6 ops assinadas pela mesma
   chave, `sequenceScope = community` e `authorSeq` 1..6, nesta ordem exata — `community.create` (com `blobsKey`),
   `role.create`(Fundador), `role.create`(Membro, base), `member.join`(o host, com
   `blobsCoreKey`, e com `invitePublicKey`/`joinProof` **zerados**),
   `category.create`(GERAL), `channel.create`(#geral). A chave que assina o `seq` 0 vira o
   `founderKey`. Durante a gênese o `fold` **não suspende estágio nenhum**: quem torna o
   lote admissível é o **principal de gênese** de R-27(a) — o autor é avaliado como membro
   ativo, com as 17 permissões e `topRank = RANK_GENESIS`. A única regra que não se aplica
   é R-9, porque o `member.join` do fundador não tem convite. Os payloads dos `seq` 1, 2 e
   3 têm forma normativa, verificada pelo `fold` — **R-27(b)**.
5. `core.append(lote)` — **uma chamada**, que já commita (§10.7.1). Ou os 6 entram, ou nenhum.
6. `swarm.join(coreKey, {server:true})`; sobe `rpcServer`, roster e STUN/TURN.
7. Projeta os 6 registros pelo caminho normal. O host **não** tem atalho.

**Regras:** `founderKey` = autor do `seq` 0, imutável para sempre. O Fundador recebe as 17
permissões; o cargo base recebe `send_messages`, `attach_files`, `add_reactions`,
`voice_speak` — e **nunca** pode receber mais que isso além de `pin_messages` (R-11).
**Falhas:** disco cheio no append → `E_STORAGE_FULL`, os cores e a linha de manifesto são
descartados. `swarm.join` falhar **não impede** a criação: a comunidade existe e funciona
localmente, em `hosting-degraded`. **Criar comunidade nunca depende de rede.**

### 19.2 Boot

Fase `open` de §3.3. Para cada linha de `manifest.communities` sem `left_at`, com
concorrência `OPEN_CONCURRENCY`: abre o core pela chave gravada → carrega `ds_snapshot` →
`fold` até `core.length` → `swarm.join`. A comunidade ativa (`local_navigation`) é aberta
**primeiro** e com `residency:'full'`.

**Uma comunidade quebrada nunca impede o app de abrir.**

### 19.3 Enviar mensagem

1. `fold.wouldAccept` local (advisório) → falhou: `E_VALIDATION` **síncrono**, nada
   enfileirado, erro inline.
2. Consome `authorSeq` no `sequenceScope` do canal, monta a `Op` (com `communityId`),
   assina, calcula `opId`.
3. `INSERT` em `local_outbox` (`FULL`) com `clientRef`. Responde `{opId, state:'queued'}`.
4. A UI desenha a bolha otimista, ancorada em `authorTs`.
5. `outbox.flush` → `sending` → `rpcClient.submitOp`.
6. Host: §11.4 → `{seq, hostTs}` → item vai a `awaiting-confirmation`.
7. A replicação traz o registro; o `fold` local o interpreta; `messages.appended` é
   emitido; a reconciliação (§11.6) remove o item e emite
   `message.accepted{opId, clientRef, messageId, seq}`.
8. A UI casa pelo `clientRef` e **assenta a bolha na posição de `seq`**.

**Ordem determinada:** `messages.appended` **antes** de `message.accepted`, sempre (fecha
`DS-31`). A UI nunca precisa lidar com as duas ordens.

### 19.4 Host offline → fila → reconexão → flush

`host.statusChanged{status:'offline'}` após **2 falhas consecutivas** de conexão (uma falha
isolada é ruído e piscaria o banner). Escritas de mensagem enfileiram; escritas de
estrutura/moderação falham na hora com `E_HOST_UNAVAILABLE`; leitura segue normal da
réplica local. Volta → `reconnecting` → `hello` → `online` → flush com jitter e limite de
taxa (§11.8) → `outbox.flushed{delivered}`.

`voice.join` com host offline é bloqueado com `E_HOST_UNAVAILABLE` **antes** de tocar em
mídia — o host é o rendezvous, o autorizador e o STUN/TURN.

### 19.5 Convite: emitir → resolver → resgatar

§12.2 → §12.3 → §12.4.

### 19.6 Anexar e baixar

§13.2 → §13.4.

### 19.7 Banir

1. Valida (não é Fundador, não é host, não é o próprio, hierarquia estrita).
2. `submitOp` → §11.4 → append.
3. O `fold`, em **uma** transação de projeção: insere em `bans`; `members.banned=1`;
   `hidden_by_ban=1` nas mensagens do alvo; remove-as da FTS; `member_count−−`; revoga os
   convites do alvo (R-10); insere no `moderation_log`.
4. O host fecha os canais de replicação com o alvo e derruba a conexão daquela comunidade.
5. Revoga tickets de mídia e emite `voice.revoked`.
6. Todo outro membro faz (4) e (5) ao projetar o mesmo registro.

### 19.8 Excluir canal com chamada acontecendo

Valida (não é o último canal) → appenda → o host encerra a sessão de voz imediatamente,
emitindo `voice.failed{reason:'channel-deleted'}` e `voice.revoked` a cada participante →
projeta o tombstone → `structure.changed` → a outbox descarta os itens daquele canal com
motivo `channel-deleted`. A exclusão **prevalece** sobre quem entra no mesmo instante,
porque as duas ops passam pela mesma fila serializada.

### 19.9 Cargos: criar, mover, atribuir

Criar: sem dica de posição, o cargo entra no **fim do escopo** —
`rank` = `midpoint(RANK_BOTTOM, menor rank existente acima de RANK_BOTTOM)`, ou
`midpoint(RANK_BOTTOM, RANK_TOP)` se não houver nenhum. Numa comunidade recém-criada isso é
entre o cargo base e o Fundador, que é a posição mais baixa **útil**: o cargo já modera quem
só tem o base, e não modera mais ninguém. Com dica, `role.create{afterRank?, beforeRank?}`
segue a mesma regra de vizinhança de `role.move`.

> A redação anterior era `midpoint(rank do cargo imediatamente abaixo do topo do autor,
> próximo abaixo)`, com os dois argumentos na ordem **inversa** da definição de §6.4.1
> (`midpoint(a, b)` exige `a < b`, e o primeiro argumento ali é o **maior**). Lida ao pé da
> letra ela caía no ramo de entrada incoerente e produzia cargo abaixo do base — inerte por
> R-3 + R-4. A regra acima é a que §6.4.1 sustenta, e o piso é o que a torna correta.

Mover: `role.move{afterRoleId, beforeRoleId}` → **uma única linha muda**; a
resposta devolve só o `rank` novo (não uma lista de renumeração). Atribuir:
`member.setRoles` com a lista completa; a resposta devolve `appliedRoleIds` após o
descarte de ids desconhecidos (§8.4.1), para a UI não ficar com uma expectativa errada.

### 19.10 Editar e deletar mensagem

Editar: só o autor. Conteúdo vazio é recusado; esvaziar se resolve deletando. O conteúdo
antigo **fica no log** e é recuperável por quem inspecionar o core — a UX precisa evitar
prometer o contrário (delta U-19).

Deletar: própria, ou `manage_messages` + hierarquia. Uma transação: `deleted_at`,
`content = NULL`, apaga reações, `ftsRemove`, sai de Fixados. O registro continua no log.
"Não pode ser desfeito" é verdade para a interface, não para os bytes (delta U-20).

---

## 20. Erros

### 20.1 Forma

`{code, message, details?, field?, retryAfterMs?}`.

- `code`: da tabela abaixo. **É o contrato.**
- `message`: em inglês, para log e depuração. O texto em português é do renderer.
- `field`: presente em `E_VALIDATION`; nomeia o campo, para o erro inline de formulário.
- `retryAfterMs`: presente em `E_RATE_LIMITED`, `E_BUSY` e nas falhas transitórias com
  backoff conhecido.

### 20.2 Catálogo completo

Coluna **R** = a outbox retenta.

| Código | Classe | HTTP eq. | R | Significado |
|---|---|---|---|---|
| `E_MALFORMED` | cliente | 400 | não | Quadro/payload não decodifica |
| `E_VALIDATION` | cliente | 400 | não | Campo fora dos limites de §8.6 |
| `E_UNKNOWN_COMMAND` | cliente | 404 | não | Comando IPC inexistente |
| `E_UNKNOWN_KIND` | cliente | 400 | não | `kind` de op desconhecido |
| `E_BAD_CURSOR` | cliente | 400 | não | Cursor inválido ou de outro escopo |
| `E_BAD_SIGNATURE` | segurança | 401 | não | Assinatura do autor inválida |
| `E_BAD_HOST_SIGNATURE` | segurança | 401 | não | `hostSig` inválida |
| `E_WRONG_COMMUNITY` | segurança | 400 | não | `op.communityId` ≠ core |
| `E_AUTHOR_MISMATCH` | segurança | 401 | não | `op.author` ≠ chave do par |
| `E_DUPLICATE` | idempotência | 200 | — | `authorSeq` já visto — **sucesso** para o cliente |
| `E_AUTHOR_SEQ_OVERTAKEN` | bug | 409 | não | A `sequenceScope` avançou sem o `opId` correspondente na réplica; falha de protocolo/escalonador, nunca entrega |
| `E_NOT_MEMBER` | autorização | 403 | não | Autor não é membro ativo |
| `E_BANNED` | autorização | 403 | não | Autor banido |
| `E_TIMED_OUT` | autorização | 403 | **sim**, após `until` | Timeout ativo |
| `E_PERMISSION_DENIED` | autorização | 403 | não | Falta permissão |
| `E_HIERARCHY` | autorização | 403 | não | Alvo com `rank ≥` o do autor |
| `E_FOUNDER_IMMUNE` | autorização | 403 | não | Alvo é o Fundador |
| `E_HOST_IMMUNE` | autorização | 403 | não | Alvo é o host corrente |
| `E_SELF_TARGET` | autorização | 403 | não | Moderação sobre si mesmo |
| `E_FOUNDER_IMMUTABLE` | autorização | 403 | não | Cargo Fundador não é editável |
| `E_FOUNDER_TOP` | autorização | 403 | não | Fundador é sempre o topo |
| `E_PERMISSION_ESCALATION` | autorização | 403 | não | Conceder permissão que não tem (R-5) |
| `E_BASE_ROLE_REQUIRED` | regra | 409 | não | Cargo base obrigatório / indeletável |
| `E_BASE_ROLE_RESTRICTED` | segurança | 403 | não | Permissão proibida no cargo base (R-11) |
| `E_NOT_HOST` | autorização | 403 | não | Só o host pode |
| `E_HOST_CANNOT_LEAVE` | regra | 409 | não | Host encerra ou sucede, não sai |
| `E_NICKNAME_SELF_ONLY` | regra | 403 | não | Apelido é auto-atribuído |
| `E_CANNOT_EDIT_OTHERS` | regra | 403 | não | Moderação apaga, não reescreve |
| `E_NOT_FOUND` | estado | 404 | não | Genérico |
| `E_CHANNEL_NOT_FOUND` | estado | 404 | não | Canal sumiu |
| `E_CHANNEL_NOT_VOICE` | estado | 409 | não | Canal errado para voz |
| `E_CATEGORY_NOT_FOUND` | estado | 404 | não | — |
| `E_MESSAGE_DELETED` | estado | 409 | não | — |
| `E_COMMUNITY_ENDED` | estado | 410 | não | Comunidade encerrada |
| `E_NOT_BANNED` | estado | 409 | não | Revogar ban inexistente |
| `E_CHANNEL_NAME_TAKEN` | conflito | 409 | não | Nome duplicado (R-6) |
| `E_CHANNEL_NAME_EMPTY` | validação | 400 | não | Slug vazio após normalização |
| `E_LAST_CHANNEL` | regra | 409 | não | Último canal (R-7) |
| `E_THREAD_EXISTS` | conflito | 409 | não | Já há thread na raiz |
| `E_REACTION_LIMIT` | regra | 409 | não | > 20 emojis distintos |
| `E_CHANNEL_READ_ONLY` | autorização | 403 | não | Somente-leitura para os cargos do autor |
| `E_LIMIT_EXCEEDED` | regra | 409 | não | Limite de cardinalidade de §26.2 — traz `limit` |
| `E_QUOTA_EXCEEDED` | proteção | 429 | **sim** | Cota determinística (R-14/R-15) — traz `retryAfterMs` estimado |
| `E_INVITE_INVALID` | estado | 404 | não | Inválido, revogado ou expirado |
| `E_INVITE_EXHAUSTED` | estado | 409 | não | `maxUses` atingido |
| `E_ATTACHMENT_TOO_LARGE` | validação | 413 | não | > `ATTACHMENT_MAX_BYTES` |
| `E_PAYLOAD_TOO_LARGE` | validação | 413 | não | Envelope acima do teto |
| `E_FILE_UNREADABLE` | infra | 400 | não | Arquivo local ilegível |
| `E_TICKET_INVALID` | segurança | 403 | não | Ticket de staging ou de mídia inválido/expirado |
| `E_TICKET_DENIED` | autorização | 403 | não | Host recusou emitir ticket de mídia |
| `E_TYPE_NOT_OPENABLE` | segurança | 403 | não | Tipo fora da allowlist de §13.6 |
| `E_NOT_DOWNLOADED` | estado | 409 | não | Abrir antes de baixar |
| `E_NO_PEERS` | rede | 503 | **sim** | Zero pares com o blob |
| `E_RATE_LIMITED` | proteção | 429 | **sim** | + `retryAfterMs` |
| `E_OUTBOX_FULL` | proteção | 429 | não | Fila cheia |
| `E_ALREADY_SENT` | estado | 409 | não | Cancelar item já em voo |
| `E_HOST_UNAVAILABLE` | rede | 503 | **sim** | Host offline/inalcançável |
| `E_SWARM_DEGRADED` | rede | 503 | **sim** | Sem bootstrap/pares |
| `E_PEER_UNREACHABLE` | rede | 503 | **sim** | Sinalização não chegou |
| `E_TIMEOUT` | rede | 504 | **sim** | Estouro de prazo |
| `E_BUSY` | proteção | 429 | **sim** | Fila do host cheia / concorrência máxima |
| `E_NOT_ATTEMPTED` | lote | 202 | **sim** | Item de `submitOps` que o host não chegou a processar; permanece `queued` (§11.9) |
| `E_NOT_AUTHORIZED_FOR_COMMUNITY` | autorização | 403 | não | Canal de replicação recusado (§14.3) |
| `E_SESSION_GONE` | estado | 410 | não | Sessão de mídia acabou |
| `E_SESSION_FULL` | regra | 409 | não | Teto de espectadores (§17.5) |
| `E_VOICE_FULL` | regra | 409 | não | Teto de participantes de voz |
| `E_ALREADY_SHARING` | conflito | 409 | não | Já há compartilhamento no canal |
| `E_CAMERA_LIMIT` | regra | 409 | não | > 6 câmeras |
| `E_DEVICE_BLOCKED` | infra | 403 | não | **Novo** — o SO negou microfone/câmera (fecha `RT-10`) |
| `E_CONSENT_REQUIRED` | regra | 403 | não | Relay sem consentimento |
| `E_VERSION_UNSUPPORTED` | compat. | 426 | não | `opVersion` incompatível — **terminal** na outbox |
| `E_CLOCK_UNREASONABLE` | validação | 400 | não | `op.ts` fora da janela (R-2) |
| `E_GENESIS_MISPLACED` | regra | 409 | não | `community.create` fora do `seq` 0 |
| `E_ID_COLLISION` | bug | 500 | não | Colisão de id determinístico |
| `E_SUCCESSION_DENIED` | autorização | 403 | não | Assunção de host não autorizada (R-18) |
| `E_IDENTITY_EXISTS` | conflito | 409 | não | Já há identidade |
| `E_BAD_PASSPHRASE` | cliente | 401 | não | Frase secreta de import errada |
| `E_CANCELLED` | cliente | 499 | não | Usuário cancelou diálogo do SO |
| `E_KEYSTORE_UNAVAILABLE` | infra | 500 | não | `safeStorage` indisponível |
| `E_KEYSTORE_INSECURE` | segurança | 500 | não | Fallback `basic_text` sem aceite explícito (§3.2 L-2) |
| `E_CORE_ALREADY_RUNNING` | infra | 409 | não | Lock ocupado |
| `E_CORE_RESTARTED` | infra | 503 | não | Request perdido por crash do núcleo (§15.2) |
| `E_CORE_CORRUPT` | infra | 500 | não | Core ilegível |
| `E_SCHEMA_AHEAD` | infra | 500 | não | Banco de versão futura |
| `E_STORAGE_FULL` | infra | 507 | não | Disco cheio |
| `E_WIPE_INCOMPLETE` | infra | 500 | não | `identity.wipe` parcial (§18.6) — traz `stage` |
| `E_INTERNAL` | bug | 500 | **sim** (1×) | Não classificado |

**87 códigos.** O catálogo é **fonte única**: nenhum código pode aparecer em qualquer parte
deste documento sem estar nesta tabela (fecha `F-28`).

### 20.3 Regras de tratamento

1. Erro nunca vaza stack trace pelo IPC. A stack vai para o log.
2. `E_INTERNAL` é bug até prova em contrário e sempre gera log em `error`.
3. **Erro de rede nunca vira erro de validação**, e o inverso também não. Confundir os dois
   faz o usuário achar que digitou errado quando a rede caiu.
4. **`E_RATE_LIMITED` e `E_HOST_UNAVAILABLE` são visualmente distintos na UI**, com o
   `retryAfterMs` exibido. Fecha `T-33`: um host que silencie seletivamente via
   `retryAfterMs` fica visível para o usuário, em vez de parecer bug.
5. Erro terminal em op enfileirada vira `dropped` com motivo nomeado, nunca some calado.
6. Falha parcial é reportada **por item** (§11.9).
7. `E_DUPLICATE` **não** é erro na UI: é confirmação de que a op já estava aplicada.

---

## 21. Concorrência, ordenação e idempotência

### 21.1 Onde há concorrência de verdade, e como cada caso resolve

| Cenário | Resolução |
|---|---|
| Dois moderadores editam o mesmo cargo | Ordem de chegada na fila do host; maior `seq` vence, campo a campo (o payload de `role.update` carrega só os campos alterados). Sem merge, sem conflito visível |
| Dois candidatos no último uso de um convite | Seção crítica de §11.4; `uses` é `DS`. Um entra, o outro recebe `E_INVITE_EXHAUSTED`. **Nunca os dois** |
| `channel.delete` ‖ `message.send` no mesmo canal | Ambos passam pela mesma fila serializada. Se o delete chegou antes, a mensagem é `REJECTED` com `E_CHANNEL_NOT_FOUND` **antes do append**. Se chegou depois, a mensagem existe e o canal é tombstonado — a mensagem fica `orphaned` (§8.4.1). **Nenhum dos dois caminhos produz brick** |
| `channel.create(#x)` ‖ `channel.create(#x)` | R-6: o primeiro fica, o segundo é `REJECTED` antes do append |
| `role.delete` ‖ `member.setRoles` citando-o | O `setRoles` posterior descarta o id desconhecido (§8.4.1) |
| `role.move` ‖ `role.move` | Chave fracionária: os dois aplicam, sem colisão de índice (§6.4.1) |
| `category.delete` ‖ `channel.create` naquela categoria | O create posterior é `REJECTED` (`E_CATEGORY_NOT_FOUND`) |
| `message.delete` ‖ `reaction.set` | A reação posterior é `REJECTED` (`E_MESSAGE_DELETED`) |
| `channel.delete`(último) ‖ `channel.delete`(penúltimo) | R-7 recusa o que deixaria a comunidade sem canal |
| Ban ‖ op do alvo | A op que chega depois do ban é `REJECTED` com `E_BANNED`; a que chega antes é aplicada e depois **ocultada** pela projeção do ban |
| Duas instâncias do app | Impossível: lock composto (§10.8) |
| Projeção e leitura simultâneas | WAL: leitor não bloqueia escritor. O `projector` é o **único** escritor de `view.db` |
| Dois escritores do mesmo core (identidade importada) | Fork detectado (§18.9) |

**A afirmação central de v2 (e o que ela substitui):** v1 dizia "com um só escritor não
existe conflito de escrita". Isso era verdade para o *log* e falso para o *estado*. v2 diz:

> Existe **uma ordem** (o `seq`) e **uma interpretação** (o `fold`). Toda corrida se
> resolve determinaticamente, no mesmo ponto, em todo nó. As oito corridas que a auditoria
> distribuída usou para demonstrar `DS-01` são exatamente as oito linhas acima, e nenhuma
> delas produz registro venenoso.

### 21.2 Idempotência

| Operação | Chave | Reenvio |
|---|---|---|
| Qualquer op | `(author, communityId, sequenceScope, authorSeq)` | `E_DUPLICATE` = sucesso, sem novo efeito |
| `message.delete` de já deletada | — | Sucesso, sem auditoria nova |
| `mod.ban` de já banido | — | Sucesso, sem entrada nova |
| `mod.removeTimeout` sem timeout | — | Sucesso |
| `invite.revoke` de já revogado | — | Sucesso |
| `relay.withdraw` sem voluntariado | — | Sucesso |
| `reaction.set{present}` | Estado final | Convergente por maior `seq` |
| `blob.download` já baixado | — | `blob.completed` imediato |
| `channel.markRead` | — | Sucesso |
| `voice.join` no mesmo canal | — | Devolve a sessão existente |

### 21.3 Reentrância proibida

- O `fold`/`projector` **nunca** é reentrante: um lote por comunidade por vez, garantido por
  flag. Um `append` durante um lote entra no lote seguinte.
- O `fold` **nunca** chama outro `fold`, nem enfileira op, nem faz I/O.
- Um handler de evento IPC **nunca** dispara comando de escrita no núcleo.

---

## 22. Jobs, loops e cancelamento

### 22.1 Loops permanentes

| Loop | Período | Onde |
|---|---|---|
| `projector` | reativo a `append`, com lote | todo nó |
| `outbox.flush` | 1 s, ou disparado por `host.cameBack` com jitter (§11.8) | todo nó |
| `outbox.recover` | uma vez no boot, antes do primeiro flush | todo nó — `sending → queued`, sem consumir tentativa (§11.3) |
| `outbox.reconcile` | `OUTBOX_RECONCILE_MS` (30 s), no boot e em `host.cameBack` | todo nó |
| `replication.watchdog` | `REPLICATION_WATCH_MS` (5 s) | todo nó — §14.5 |
| `presence.refresh` | 15 s | todo nó |
| `presence.tick` | `PRESENCE_TICK_MS` (2 s) | host |
| `typing.expire` | 1 s | host |
| `media.ticketRenew` | `MEDIA_TICKET_TTL_MS / 3` | participante de mídia |
| `blob.progress` | 500 ms | quem baixa |
| `metrics.flush` | 10 s | todo nó |

### 22.2 Jobs periódicos

| Job | Período | O que faz |
|---|---|---|
| `outbox.expire` | 5 min | Marca `dropped/expired` **só depois de reconciliar** (§11.6) |
| `invite.topicSweep` | 15 min | Sai do tópico DHT de convites expirados/esgotados/revogados |
| `host.inactivity` | 6 h | Atualiza `inactiveDays`; ≥ `INACTIVE_COMMUNITY_DAYS` alimenta o rótulo do rail |
| `succession.check` | 24 h | Verifica se o grace period de §18.8 foi atingido; oferece assumir ao sucessor |
| `blob.gc` | 24 h | §22.4 |
| `staging.gc` | 24 h | §13.5 |
| `removed.purge` | 24 h | Apaga réplicas de comunidades com `retain_until` vencido (§18.4) |
| `db.maintenance` | 24 h | `PRAGMA optimize`; `wal_checkpoint(TRUNCATE)` acima de 64 MiB |
| `ds.snapshot` | por contagem (`DS_SNAPSHOT_INTERVAL`) e no `draining` | §10.6 |
| `log.rotate` | 24 h | §24.1 |

### 22.3 Backoff

Curva única para reconexão de swarm, RPC e outbox:
`delay = min(1000 · 2^n, 60000) ± 20 %`. O jitter não é enfeite: sem ele, 340 membros
reconectam em fase depois de o host voltar e produzem avalanche exatamente no pior momento.

### 22.4 GC de blobs

| Regra | Valor |
|---|---|
| Blob **enviado por mim** com mensagem viva | **Nunca** coletado (§13.7 regra 2) |
| Blob baixado, cache acima de `BLOB_CACHE_MAX_BYTES` | LRU por `verified_at` |
| Blob de comunidade removida | Apagado com o `removed.purge` |
| Staging órfão > `STAGING_ORPHAN_MS` | `core.clear` dos blocos + remove a linha |

`core.clear()` libera **blocos locais**; não apaga o dado da rede.

### 22.5 Cancelamento

Todo job e todo loop recebe um `AbortSignal` do ciclo de vida da comunidade. Fechar uma
comunidade (sair, encerrar, ser removido, `wipe`) aborta tudo dela em ≤ 100 ms. Nenhum job
sobrevive ao fechamento do seu escopo — é o que impede o "job zumbi escrevendo em banco
fechado", causa clássica de crash no shutdown.

---

## 23. Busca, filtros, ordenação, paginação

### 23.1 Consulta

`query.search{communityId, query, filters:{authorKey?, channelId?, date?, kind?},
scopeChannelId?, limitPerGroup=20}`.

| Etapa | Regra normativa |
|---|---|
| Normalização | NFD → remove diacrítico → minúsculo (a mesma função do frontend) |
| Tokenização | Split por não-alfanumérico; tokens de 1 caractere são descartados |
| **Construção do `MATCH` (fecha `DR-39`)** | Cada token vira `"token"` (aspas duplas, escapando `"` interno por duplicação) — **isso desativa toda a sintaxe de operador do FTS5**, então `AND`, `OR`, `NOT`, `NEAR`, `*`, `^`, `:` digitados pelo usuário são literais, nunca operadores. Os tokens são unidos por `AND` implícito. **Exceção única:** o último token recebe `*` de prefixo (`"revis"*`) para busca-enquanto-digita |
| `date` | `today` = início do dia local do leitor; `7d`/`30d` = janela a partir de agora. Aplicado sobre `host_ts` |
| `kind` | `attachment` = tem anexo · `pinned` = `pinned=1` · `link` = existe linha em `message_links` |
| Escopo | `scopeChannelId` restringe **antes** dos filtros |
| Exclusões | Deletadas, `hidden_by_ban` e `orphaned` nunca aparecem; canais de voz não são varridos |
| Canais e membros | Respondem **só ao texto**; filtros de autor/anexo/data não se aplicam a eles |
| `partial` | §14.5 — quatro causas possíveis, devolvidas em `partialReason` |

### 23.2 Ordenação (fechada, por lista)

| Lista | Ordem |
|---|---|
| Mensagens de canal | `seq` crescente |
| Resultados de busca | `seq` **decrescente** — recência, não relevância |
| Canais dentro de categoria | `rank` crescente |
| Categorias | `rank` crescente |
| Cargos | `rank` **decrescente** (topo primeiro) |
| Membros | Grupo pelo cargo de maior `rank`; alfabético dentro do grupo por `nickname ?? displayName`, com desempate por `handle` |
| Comunidades no rail | Ordem de entrada (`joined_at`), nunca alfabética |
| Log de auditoria / banidos / timeouts / fixados | `seq` decrescente |

### 23.3 Paginação

| Superfície | Estratégia | Lote |
|---|---|---|
| Mensagens | Cursor por `(seq, id)`, bidirecional | 50 |
| Busca | Teto de 20 por grupo, "ver todos" expande até 100 | 20/100 |
| Membros | Cursor; offline vem como **contagem agregada** | 100 |
| Auditoria / banidos / timeouts / fixados / arquivos / links | Cursor | 25 |

**Nunca há paginação numerada.** Cursor inválido → `E_BAD_CURSOR` e a UI recomeça do início.

---

## 24. Logs e observabilidade

### 24.1 Log estruturado

NDJSON, uma linha por evento, em `logs/core-YYYY-MM-DD.ndjson`. Campos obrigatórios: `ts`,
`level`, `scope`, `msg`. Opcionais: `communityId`, `channelId`, `opId`, `kind`, `seq`,
`durMs`, `code`, `epoch`.

Níveis: `error` · `warn` · `info` · `debug` (desligado em produção) · `trace`.
Rotação diária; retenção `LOG_RETENTION_DAYS` (7); teto `LOG_MAX_TOTAL_BYTES` (200 MiB).

### 24.2 Redação obrigatória — allowlist, não blocklist

O `logger` só escreve campos que estão numa **allowlist explícita** por escopo. Um campo
novo não aparece no log até ser adicionado. Blocklist esquece o campo novo (fecha `T-39`).

**Nunca aparecem, em nível nenhum:** conteúdo de mensagem, nome de anexo, tópico de canal,
nome de canal, `displayName`, `nickname`, apelido, motivo de moderação, `label` de convite,
segredo/código de convite, **qualquer caminho de arquivo do usuário**, material de chave,
payload de mídia, frase secreta.

**Aparecem:** chaves públicas truncadas em 8 hex, ids de entidade, `seq`, `opId`, tamanhos,
contagens, códigos de erro, durações, `epoch`, `subId`.

### 24.3 Métricas

| Métrica | Tipo | Uso |
|---|---|---|
| `swarm.peers` (por comunidade) | gauge | "N pares conectados" |
| `swarm.natType` | gauge | `open`/`moderate`/`cgnat` |
| `swarm.directConnectRate` | ratio | Mede a promessa de conectividade de verdade |
| `rpc.latency` / `rpc.errors` | histograma / counter por código | — |
| `fold.applied` / `fold.rejected` / `fold.ignored` | counter por `kind`/razão | `rejected` alto = cliente adulterado ou bug |
| `fold.panic` | counter | **> 0 é bug de severidade máxima** (§8.5) |
| `fold.propertyViolation` | counter por propriedade | §6.17 |
| `fold.hostTsClamped` | counter | R-1 |
| `fold.idCollision` | counter | Deve ser sempre 0 |
| `projector.lag` / `projector.rate` | gauge | `core.length − interpretedSeq` |
| `replication.state` | gauge por comunidade | §14.5 |
| `outbox.depth` / `outbox.dropped` / `outbox.ackMismatch` | gauge / counter | `ackMismatch` > 0 = host suspeito (§11.6) |
| `commit.groupSize` / `commit.flushMs` | histograma | §11.5 |
| `blob.throughput` / `blob.hashFailures` | gauge / counter | — |
| `media.ticketsIssued` / `media.ticketsRevoked` | counter | — |
| `turn.allocations` / `turn.bytesRelayed` | gauge / counter | Custo do host |
| `db.txDuration` (por banco) | histograma | — |
| `ipc.evDropped` / `ipc.staleSubs` | counter / gauge | §15.1 |

### 24.4 Health

`core.status` devolve `phase` global; `query.communities` devolve saúde por comunidade. Uma
comunidade é **saudável** quando: `replication.state = 'synced'` **e** host alcançável (ou é
o próprio) **e** nenhum item de outbox com `attempts > 5` **e**
`partialInterpretation = false`.

### 24.5 Resposta a alarme de segurança (fecha `T-47` parcialmente)

`fold.rejected{reason:'E_BAD_SIGNATURE'}` ou `E_BAD_HOST_SIGNATURE` > 0 numa comunidade é
sinal de host adversário ou de corrupção. A resposta normativa: (a) registrar em `warn` com
`seq` e `kind`; (b) expor a contagem em 3.1 → Rede; (c) **não** desconectar automaticamente
— um falso positivo desconectaria o usuário da comunidade dele. **LIMITAÇÃO DECLARADA
(L-18):** não há pontuação de pares nem banimento automático de peer. É alarme, não defesa.

---

## 25. Segurança

### 25.1 Modelo de ameaça v2

| Adversário | Consegue | Não consegue | Onde está a mitigação |
|---|---|---|---|
| Membro comum malicioso | Enviar ops que sua permissão autoriza; spam até a cota | Escalar permissão; agir acima da hierarquia; forjar autoria; usar o cargo base como vetor | §9.3 (R-4, R-5, R-11), §8.2, R-15 |
| Cliente adulterado | Mandar payload arbitrário | Passar pelo `fold` — em nó nenhum | §8 |
| Ex-membro banido | Reconectar ao canal pré-membro; criar identidade nova | Continuar replicando; ler dado novo; usar mídia | §14.3, §17.4, L-6 |
| **Host malicioso** | Omitir, reordenar, truncar (detectável) | **Forjar autoria; fabricar efeito não autorizado; transplantar envelope de outra comunidade; reescrever carimbo** | §7.1 (`communityId` assinado, `hostSig`), §8 (o `fold` roda em toda réplica) |
| Observador do DHT | Ver que um tópico existe e quem conecta | Derivar o código de convite; ler tráfego | §12.1, Noise, DTLS-SRTP |
| Voluntário de relay | Ver volume e temporização | Ler conteúdo de mídia | DTLS-SRTP ponta a ponta (§17.7) |
| Nó de repasse da árvore (quando existir) | Ver volume e temporização | Ler ou forjar quadro | AEAD por sessão (§17.8) |
| Renderer comprometido | Tudo que a UI pode fazer | Ler arquivo arbitrário do disco; obter material de chave; executar comando destrutivo sem confirmação nativa; ligar `dev.*` | §13.3, §3.2, §15.3 |
| Processo local do mesmo usuário | Ler `view.db`, `manifest.db` e o corestore | Ler a chave privada — **se e só se** o secret store do SO estiver disponível | §3.2 e **L-2** |
| Par não autenticado | Abrir conexão e gastar o orçamento pré-membro | Consumir CPU de verificação; passar do teto de bytes; enumerar convite | §14.4, §12.6 |

### 25.2 Superfície de rede

O núcleo **não escuta em porta TCP/HTTP local**. Não há servidor local, WebSocket ou porta
de debug em produção. As entradas são: o socket UDP do `hyperdht`/UDX (que também
multiplexa STUN/TURN quando em modo host) e as sockets do `RTCPeerConnection` no renderer.

### 25.3 Validação de entrada não confiável

| Entrada | Regra |
|---|---|
| Frame RPC | Teto de bytes **antes** do decode (§14.4) |
| Envelope | `fold` §8.2, estágios 1–2 |
| Nome de anexo | **Rejeitado**, não sanitizado (§8.6); no disco vira `<blobIdHex>-<nome>` |
| `content` de mensagem | Guardado cru; markdown renderizado em elementos React, nunca por `innerHTML` |
| URL em mensagem | Allowlist de esquema `http`/`https`/`mailto`; o resto vira texto (§15.6.1) |
| Caminho de arquivo | **Só por ticket do main** (§13.3) |
| Emoji de reação | 1–8 code points, ≤ 32 bytes (§8.6) |
| Cursor | Decodificado e validado; escopo conferido |
| Deep link | Gramática fechada, parse no main (§3.5) |
| Mídia recebida | Decodificada pelo pipeline do Chromium; **só imagem inline** no v1 (§13.6) |

### 25.4 Regras permanentes

1. Nenhum `eval`, `Function` ou `require` dinâmico com string vinda de dado.
2. Nenhuma dependência nova sem versão travada (`package-lock` commitado), SBOM gerado no
   build e revisão de transitivas.
3. `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true` no renderer.
4. CSP sem `unsafe-inline` e sem host externo.
5. Nenhum dado sai do dispositivo a não ser para um par da comunidade: **zero telemetria,
   zero analytics, zero crash reporter externo**.
6. Builds assinados (Authenticode no Windows). Hash do artefato publicado junto do release.
   Notarização era exigência de macOS e saiu com ele da matriz (A16).

### 25.5 Integridade de configuração (fecha `T-22`)

- **Nada que afete interpretação do log vem de configuração** (§1.5). Um arquivo adulterado
  não muda o estado da comunidade.
- **Valores de rede sensíveis** (`P2P_BOOTSTRAP`, `P2P_STUN_SERVERS`, `P2P_DATA_DIR`) **não
  são lidos de `config.json`** em build de produção. Só de variável de ambiente ou flag de
  linha de comando explícita.
- Quando qualquer um deles estiver fora do default, o núcleo emite `config.nonDefault` e a
  UI exibe um indicador permanente em 3.1 → Rede: "configuração de rede não padrão ativa".
  Delta U-21.

### 25.6 Detecção de censura e de reescrita (`L-1`)

- **Omissão:** o cliente sabe o que enviou (`local_outbox` + `local_author_seq`). A
  reconciliação (§11.6) procura o `opId` em `observed_ops`, detecta ACK sem registro
  correspondente e conta `outbox.ackMismatch`.
  Uma contagem persistente é exibida em 3.1 → Rede como "o host confirmou N operações que
  não aparecem no histórico". Delta U-22.
- **Truncamento:** o Hypercore assina o comprimento; truncar muda a chave de comprimento e é
  **detectável por toda réplica**. O núcleo emite `community.forked` e para de appendar.
- Nenhuma das duas é **impedível**. Está declarado.

### 25.7 Distribuição e resposta a vulnerabilidade (fecha `T-42`)

| Item | Decisão v1 |
|---|---|
| Canal de atualização | Manual: o app **não** se atualiza sozinho e **não** fala com host próprio (isso contradiria o princípio 1). Ele **verifica** a versão corrente contra uma constante embutida e, quando o `hello` de um host reportar `coreVersion` maior, exibe "há uma versão mais nova" com instrução de download manual |
| Integridade | Build assinado; hash publicado; SBOM |
| Aviso de segurança | `opVersion` pode ser usado para forçar clientes vulneráveis a somente-leitura: um host atualizado recusa `opVersion` antiga, o que **para a escrita** de clientes desatualizados sem parar a leitura |
| Prazo | Correção de severidade crítica: nova build em ≤ 7 dias, com bump de `opVersion` quando aplicável |

**LIMITAÇÃO DECLARADA (L-19):** sem canal de atualização automático, a janela de exposição
depende do usuário atualizar. É consequência direta do princípio 1 e está aceita.

### 25.8 Limitações declaradas — lista consolidada

Esta é a lista **completa e fechada** do que a arquitetura **não** entrega. Toda linha aqui
é um risco aceito, não um buraco: ela existe porque a alternativa contradiz o produto, é
tecnicamente impossível, ou custa mais do que vale. **Cada uma tem obrigação de aparecer na
interface**, na superfície indicada.

| # | Limitação | Onde | Superfície de UI obrigatória |
|---|---|---|---|
| **L-1** | Censura por omissão e truncamento pelo host são **detectáveis, não impedíveis** | §1.4, §25.6 | 3.1 → Rede (contagem de divergência) |
| **L-2** | `safeStorage` não protege contra processo do mesmo usuário nem contra memória; no Linux sem secret store o fallback `basic_text` **não protege nada** | §3.2 | Tela de aceite do modo inseguro + indicador permanente |
| **L-3** | Não há rotação da Data Key no v1 | §5.4 | — (registrado, sem superfície) |
| **L-4** | O backup de identidade **não** é multi-dispositivo; duas instalações hospedando a mesma comunidade produzem fork | §5.5 | Texto no fluxo de backup e de restauração |
| **L-5** | Personificação é possível: nome livre, `handle` de 40 bits | §6.1 | `handle` sempre junto do nome; aviso de nome duplicado |
| **L-6** | Banido que volta com identidade nova é indistinguível de membro novo | §6.3 | Nota de honestidade no modal de ban |
| **L-7** | Ban impede leitura **futura**; não retira o que o alvo já replicou | §6.12, §18.3 | Modal de confirmação de ban |
| **L-8** | Identidade é gratuita: convite limita quem entra, não quantas identidades uma pessoa tem | §12.6 | Texto em 0.3 e em 3.1b |
| **L-9** | Disponibilidade de anexo depende de haver ao menos um par com os blocos | §13.7 | Estado `unavailable` no card do anexo |
| **L-10** | `view_audit_log` é confidencialidade **local**, não segredo criptográfico | §15.6 | Texto em 3.3 |
| **L-11** | Host atrás de CGNAT sem porta alcançável não serve STUN/TURN | §17.3 | Diagnóstico de rede + estado `conn-failed` |
| **L-12** | `voice_mute_others` é **conselho** ao cliente do alvo; o enforcement é remover do roster | §17.4 | Dois controles distintos (U-08) |
| **L-13** | Presença e digitando são **at-most-once** | §17.6 | — (comportamento, sem superfície) |
| **L-14** | O voluntário de relay observa **metadados**: com quem, quando, quanto | §17.7 | Texto de consentimento (U-13) |
| **L-15** | A sucessão preserva estrutura, membros, cargos e moderação; **o histórico de mensagens não migra** | §18.8 | Tela de sucessão (U-18) |
| **L-16** | Dois sucessores em janelas próximas produzem duas continuações; cada réplica segue a de maior prioridade | §18.8 | Tela de sucessão |
| **L-17** | Moderação é **por comunidade**: sem reputação, sem lista compartilhada, sem federação | §18.10 | — (escopo declarado) |
| **L-18** | `fold.rejected` por assinatura ruim é **alarme, não defesa**: não há pontuação de pares nem banimento automático de peer | §24.5 | 3.1 → Rede |
| **L-19** | Sem canal de atualização automático, a janela de exposição depende do usuário | §25.7 | Aviso de versão nova |
| **L-20** | `invisible` **não** entrega anonimato de rede: o endereço é anunciado no DHT e observável por quem participa dos mesmos tópicos. Ele entrega apenas invisibilidade **na interface** | §6.16, §25.1 | Texto no seletor de presença e em 3.1 → Rede |
| **L-21** | Só material de chave é cifrado em repouso. `view.db`, `manifest.db` (exceto os campos de segredo) e o corestore ficam **em claro** no disco: conteúdo de mensagem, nomes e anexos são legíveis por qualquer processo do mesmo usuário e por quem tiver acesso físico ao disco | §10.1, §10.2 | Texto em 3.1 → Privacidade |
| **L-22** | Sair de uma comunidade tem efeito **local imediato**, mas o `member.leave` depende do host para chegar aos outros. Com o host permanentemente offline, os demais continuam vendo a pessoa no roster | §11.1 | Texto na confirmação de saída |

**Regra:** uma limitação que não está nesta lista **não é aceita** — é buraco de spec e
deve ser levantada. Acrescentar uma linha aqui é decisão de produto e segurança, não de
implementação.

---

## 26. Performance, limites e cache

> **Toda a §26.1 é hipótese até o benchmark correspondente passar.** Nenhum número aqui é
> fato. Isso é a aplicação direta da recomendação 5 da auditoria de ADRs.

### 26.1 Alvos (hipóteses, medidas em G9)

| Operação | Alvo | Teto aceitável | Consequência objetiva se o teto for estourado |
|---|---|---|---|
| `query.messages` (50) | < 3 ms | 15 ms | Revisar índice; **não** relaxar o alvo sem registro |
| `query.structure` | < 2 ms | 10 ms | idem |
| `query.search` (10 k msgs) | < 30 ms | 120 ms | Reduzir `limitPerGroup` ou cortar prefixo do último token |
| `fold` de uma op (host) | < 150 µs | 600 µs | Perfilar; a verificação Ed25519 domina e **não** é pulável |
| `submitOp` ponta a ponta (LAN) | < 60 ms | 250 ms | **Renegociar o alvo, nunca a barreira de durabilidade** (§11.5) |
| Interpretação + projeção | ≥ 8 000 reg/s | 3 000 reg/s | Abaixo do teto: reduzir o dataset de referência ou paralelizar a verificação em lote |
| Boot até `core.ready` (5 comunidades, 50 k msgs) | < 1,5 s | 4 s | Reduzir `DS_SNAPSHOT_INTERVAL` |
| Memória do núcleo em repouso (5 comunidades) | < 250 MiB | 500 MiB | Reduzir comunidades com `residency:'full'` |
| Latência de tela (estrela WebRTC) | < 400 ms | 800 ms | Reduzir `SHARE_MAX_VIEWERS` |
| Latência de voz p95 | < 200 ms | 400 ms | — |

O POC-07 mediu `submitOp` em **um canal**, com p95 de 0,34 ms e 1.298 ops/s, além de
group commit médio 30,8 e máximo observado 32. Isso é evidência do harness, não aprovação
do alvo de produção: o limite normativo do grupo continua 64 e o cenário multicanal da
emenda de A05 ainda precisa ser medido no código da fase 3/G9.

### 26.2 Limites do sistema

**Constantes de protocolo** (o `fold` as aplica; mudar exige bump de `opVersion`):

| Limite | Valor | Erro |
|---|---|---|
| Canais por comunidade | 500 | `E_LIMIT_EXCEEDED` |
| Categorias por comunidade | 50 | idem |
| Cargos por comunidade | 100 | idem |
| Cargos por membro | 24 | idem |
| Convites ativos por comunidade | 50 | idem |
| Emojis distintos por mensagem | 20 | `E_REACTION_LIMIT` |
| Menções por mensagem | 64 | `E_VALIDATION` |
| Anexos por mensagem | 1 | `E_VALIDATION` |
| Links extraídos por mensagem | 8 | — (truncado) |
| Sucessores | 5 | `E_VALIDATION` |
| `ATTACHMENT_MAX_BYTES` | 8 GiB | `E_ATTACHMENT_TOO_LARGE` |
| `ATTACHMENT_QUOTA_PER_MEMBER` | 5 GiB por comunidade | `E_QUOTA_EXCEEDED` |
| `QUOTA_WINDOW_SEQS` / `QUOTA_OPS_PER_WINDOW` / `QUOTA_BYTES_PER_WINDOW` | 10 000 / 2 000 / 64 MiB | `E_QUOTA_EXCEEDED` |
| `SHARE_MAX_VIEWERS` | 8 | `E_SESSION_FULL` |
| Câmeras simultâneas por chamada | 6 | `E_CAMERA_LIMIT` |
| Participantes por canal de voz | 24 | `E_VOICE_FULL` |
| `MAX_ENVELOPE_BYTES` / `MAX_ENVELOPE_BYTES_ATTACHMENT` | 32 KiB sem anexo, 64 KiB com anexo. Aplicado no `fold`: estágio 0 (teto absoluto) e estágio 13 (o condicional) | `E_PAYLOAD_TOO_LARGE` |

**Limites operacionais** (locais, sem efeito na interpretação): comunidades participadas
(50), conexões de swarm (128), itens de outbox por comunidade (500), cache de blobs
(20 GiB). Estourar comunidades participadas devolve `E_LIMIT_EXCEEDED` no `invite.redeem`.

**Escala de referência:** 340 membros. Um escritor e muitos leitores é o caso fácil do
Hypercore; o gargalo é o **fan-out de conexões no host**, não o log. `HOST_MAX_PEERS`
(default 256) e a política de §14.2 existem para isso. **`BENCHMARK REQUIRED` — G9.**

### 26.3 Rate limiting no host (proteção, não interpretação)

Token bucket por autor e por comunidade, aplicado **antes** do `fold`. É proteção de
recurso do host; **não** substitui as cotas determinísticas de R-14/R-15, que são o que
vincula um host adversário.

| Escopo | Taxa | Burst | Nota |
|---|---|---|---|
| Todas as ops | 20 / 10 s | 40 | Um `submitOps` de `n` custa `n` (§11.9) |
| `message.send` | 10 / 10 s | 24 | Burst calibrado com o lote máximo de 32 |
| `reaction.set` | 30 / 10 s | 45 | — |
| `message.edit` | 10 / 60 s | 15 | — |
| Ops de estrutura/cargo | 20 / 60 s | 30 | Compatível com **salvamento explícito** (§26.5) |
| `invite.create` | 5 / 1 h | 5 | — |
| `mod.*` | 30 / 60 s | 40 | — |
| `presencePublish` | 1 / 5 s (presença), 1 / 2 s por canal (typing) | — | §17.6 |
| Pré-membro | §12.6 | — | Por chave e por /24 |

### 26.4 Cache

Cada cache tem invalidação explícita, nunca TTL cego sobre dado replicado. **E nenhum cache
depende de um evento que pode ter se perdido:** todo cache é reconstruído no boot e após
`evStale` (§15.1).

| Cache | Chave | Invalidado por | Tamanho |
|---|---|---|---|
| Permissões efetivas | `(communityId, identityKey)` | `roles.changed`, `members.changed`, boot | 2 000 LRU |
| Cargos por comunidade | `communityId` | `roles.changed`, boot | por comunidade aberta |
| Estrutura | `communityId` | `structure.changed`, boot | por comunidade aberta |
| Página de mensagens | `(channelId, cursor)` | `messages.appended`, `message.updated`, boot | 20 páginas LRU |
| Disponibilidade de blob | `(blobsCoreKey, blobId)` | evento de par **e** TTL 5 s | 500 |
| Statements SQLite | SQL | nunca | todos |

**Sem cache, de propósito:** contagem de não-lidas (query indexada de < 1 ms), roster de
voz (efêmero), resultado de busca.

### 26.5 Decisões de performance já tomadas

- Statements preparados e reutilizados.
- **Uma transação por lote**, não por op.
- **Group commit** no host (§11.5) — é o que permite `synchronous` seguro e latência
  aceitável ao mesmo tempo.
- Verificação Ed25519 é o custo dominante e **não** é opcional. Se virar gargalo, a
  otimização permitida é verificação em lote, nunca pular.
- `ArrayBuffer` transferível para chunk de mídia (só na árvore adiada).
- **Salvamento explícito no lugar de auto-save** (fecha `F-12`, `K-3`, `E-2`, `P-4`): os
  formulários de comunidade, canal e cargo passam a ter botão "Salvar alterações" com
  estado sujo, em vez de debounce de 800 ms. Auto-save contra uma op síncrona, com rate
  limit de 20/60 s e log append-only, produz uma op por tecla e é indefensável. Delta U-23.

---

## 27. Configuração

### 27.1 Constantes de protocolo (**não configuráveis**)

Fazem parte de `opVersion = 2`. Mudar qualquer uma exige bump de versão de protocolo e um
plano de compatibilidade. Nenhuma lê `env`.

**Onde elas moram (fecha `O-07`).** Cada constante fica no módulo de §4 que a **aplica** —
`RANK_*` em `permissions`, o resto em `fold` —, e nenhuma é transcrita duas vezes. A redação
anterior mandava um módulo `protocol/constants.ts`, que §4 não tem: a fronteira de camadas é
por diretório de módulo da tabela de §4, então um `src/protocol/` seria violação de build, não
organização. Um módulo só de constantes também não teria camada — ele seria importado por L1 e
por L2 ao mesmo tempo.

`CLOCK_ACCEPT_MS` 86 400 000 · `CLOCK_SKEW_MS` 60 000 · `ATTACHMENT_MAX_BYTES` 8 GiB ·
`ATTACHMENT_QUOTA_PER_MEMBER` 5 GiB · `QUOTA_WINDOW_SEQS` 10 000 ·
`QUOTA_OPS_PER_WINDOW` 2 000 · `QUOTA_BYTES_PER_WINDOW` 64 MiB · `MAX_ENVELOPE_BYTES`
32 KiB · `MAX_ENVELOPE_BYTES_ATTACHMENT` 64 KiB · `RANK_MAX_LEN` 64 ·
`RANK_TOP` `'zz'` · `RANK_BOTTOM` `'1'` · `RANK_GENESIS` `'z'` × 65 ·
`PERM_COUNT` 17 (numeração fechada em §9.1) · `COLOR_COUNT` 8 (catálogo em §6.4.2) ·
`MAX_CHANNELS` 500 · `MAX_CATEGORIES` 50 · `MAX_ROLES` 100 ·
`MAX_ROLES_PER_MEMBER` 24 · `MAX_ACTIVE_INVITES` 50 · `MAX_REACTION_EMOJIS` 20 ·
`MAX_MENTIONS` 64 · `MAX_ATTACHMENTS_PER_MESSAGE` 1 · `MAX_LINKS_PER_MESSAGE` 8 ·
`MAX_SUCCESSORS` 5 · `SHARE_MAX_VIEWERS` 8 · `MAX_CAMERAS` 6 · `MAX_VOICE_PARTICIPANTS`
24 · `INVITE_SECRET_BYTES` 10 · `HOST_INACTIVITY_MS` 30 d · `RELAY_TTL_MS` 24 h ·
`MEDIA_TICKET_TTL_MS` 5 min · `TEXT_COUNT_UNIT` = code point (escalar Unicode; §8.6) ·
e todos os limites de campo de §8.6.

**Regra:** se um número decide se uma op tem efeito, ele está aqui. Se decide como esta
instalação usa recursos locais, está em §27.2. Nunca nos dois.

### 27.2 Configuração operacional

Precedência: variável de ambiente > `config.json` em `userData` > default. Resolvida uma
vez no boot e **congelada**. Valor fora da faixa é **clampado** para o limite mais próximo,
com log `config.invalid{key, given, used}` e um aviso na UI de 3.1 (fecha `DR-51`).

| Variável | Default | Faixa | Efeito |
|---|---|---|---|
| `P2P_DATA_DIR` | `<userData>/p2p` | caminho | Raiz de dados — **só env/flag** (§25.5) |
| `P2P_BOOTSTRAP` | default do `hyperdht` | lista `host:port` | Bootstrap do DHT — **só env/flag** |
| `P2P_STUN_SERVERS` | *(vazio)* | lista | STUN de terceiro — **só env/flag**; ligar expõe o IP a um terceiro e a UI avisa |
| `P2P_LOG_LEVEL` | `info` | `error`…`trace` | — |
| `P2P_LOG_RETENTION_DAYS` | 7 | 1–90 | — |
| `P2P_LOG_MAX_TOTAL_BYTES` | 200 MiB | ≥ 10 MiB | — |
| `P2P_DHT_PERSIST` | `true` | bool | Cache de nós do DHT |
| `P2P_SWARM_MAX_CONNECTIONS` | 128 | 8–512 | §14.2 |
| `P2P_HOST_MAX_PEERS` | 256 | 16–1024 | §14.2 |
| `P2P_PREMEMBER_CONN_BUDGET` | 8 | 1–64 | §12.6 |
| `P2P_BG_ROTATION_MS` | 60 000 | 5 000–600 000 | Anti-starvation |
| `P2P_PROJECTOR_BATCH` | 256 | 32–2048 | Registros por transação |
| `P2P_DS_SNAPSHOT_INTERVAL` | 5 000 | 500–100 000 | §10.6 |
| `P2P_REPROJECT_PROGRESS_SEQ` | 100 000 | ≥ 1 000 | Mostra barra a partir daí |
| `P2P_OPEN_CONCURRENCY` | 4 | 1–16 | — |
| `P2P_OUTBOX_MAX_ITEMS` | 500 | 10–5 000 | Por comunidade |
| `P2P_OUTBOX_MAX_AGE_MS` | 72 h | ≥ 1 h | Só após reconciliação (§11.6) |
| `P2P_OUTBOX_RECONCILE_MS` | 30 000 | 5 000–600 000 | — |
| `P2P_GROUP_COMMIT_WINDOW_MS` | 4 | 0–50 | §11.5 |
| `P2P_GROUP_COMMIT_MAX` | 64 | 1–512 | — |
| `P2P_HOST_QUEUE_DEPTH` | 512 | 32–8 192 | Shedding (§11.8) |
| `P2P_FLUSH_RATE_PER_S` | 20 | 1–500 | Anti-avalanche |
| `P2P_RECONNECT_FLUSH_DELAY_MS` | 1 000 | 0–30 000 | — |
| `P2P_REPLICATION_WATCH_MS` | 5 000 | 1 000–60 000 | §14.5 |
| `P2P_REPLICATION_STALL_MS` | 20 000 | 5 000–300 000 | — |
| `P2P_IPC_SUB_WINDOW` | 256 | 16–4 096 | §15.1 |
| `P2P_IPC_STALE_MS` | 3 000 | 500–30 000 | — |
| `P2P_BLOB_CACHE_MAX_BYTES` | 20 GiB | ≥ 1 GiB | GC |
| `P2P_STAGING_TICKET_TTL_MS` | 900 000 | 60 000–3 600 000 | §13.3 |
| `P2P_DRAIN_BUDGET_MS` | 5 000 | 1 000–60 000 | §18.7 |
| `P2P_REMOVED_RETENTION_DAYS` | 7 | 0–365 | §18.4 |
| `P2P_INACTIVE_COMMUNITY_DAYS` | 30 | 1–365 | Rótulo do rail |
| `P2P_PRESENCE_TICK_MS` | 2 000 | 500–30 000 | §17.6 |
| `P2P_TURN_RATE_KBPS` | 512 | 64–4 096 | §17.3 |
| `P2P_RELAY_MAX_BYTES_PER_DAY` | 5 GiB | ≥ 100 MiB | §17.7 |
| `P2P_TESTNET` | `false` | bool | `hyperdht/testnet`; **nunca** a DHT pública em teste |
| `P2P_BUILD_CHANNEL` | `prod` | `prod`/`dev` | **Constante de build**, não runtime (§15.3) |
| `P2P_RPC_MAX_FRAME_BYTES` | 65 536 | ≥ `MAX_ENVELOPE_BYTES` | Teto antes do decode, membro (§14.4) |
| `P2P_PREMEMBER_MAX_FRAME_BYTES` | 4 096 | 1 024–65 536 | Teto antes do decode, pré-membro (§12.6) |
| `P2P_INVITE_RATE_PER_PEER` | `10 / 60 s` | — | Rate limit de admissão por `remotePublicKey` (§12.6) |
| `P2P_INVITE_RATE_PER_SUBNET` | `30 / 60 s` | — | Rate limit de admissão por prefixo /24 (§12.6) |
| `P2P_HELLO_INTERVAL_MS` | 30 000 | 5 000–300 000 | Frequência do `hello` que alimenta `synced` (§14.5) |
| `P2P_HOST_CLOCK_ALARM_MS` | 300 000 | 60 000–3 600 000 | Limiar de `host.clockSuspect` (§11.4) |
| `P2P_STAGING_ORPHAN_MS` | 86 400 000 | ≥ 1 h | Coleta de staging abandonado (§13.5) |
| `P2P_REJECTED_LOG_MAX` | 2 000 | 0–100 000 | Linhas de `rejected_records` por comunidade (§10.3) |
| `P2P_TURN_ALLOC_TTL_MS` | 600 000 | 60 000–3 600 000 | Vida da alocação TURN (§17.3) |
| `P2P_TURN_ALLOC_PER_MEMBER` | 2 | 1–8 | Alocações simultâneas por membro (§17.3) |
| `P2P_TURN_SESSION_MAX_BYTES` | 2 GiB | ≥ 64 MiB | Teto de bytes por sessão TURN (§17.3) |
| `P2P_RELAY_MAX_ALLOCS` | 4 | 1–32 | Alocações simultâneas aceitas por um voluntário (§17.7) |

**Verificação obrigatória em CI:** um teste percorre a spec e falha se existir qualquer
constante `SCREAMING_SNAKE` citada no texto que não esteja em §27.1 ou §27.2, e vice-versa.
É o que impede a regressão que `DR-51` descreveu.

---

## 28. Estratégia de testes

### 28.1 Unitários — os módulos puros

`fold`, `opCodec`, `permissions`, `idgen` recebem cobertura exaustiva, não amostral.

- **`fold`**: tabela de casos por `kind` × cada estágio de §8.2 × cada regra `R-*` ×
  fronteira de cada limite de §8.6 (mín−1, mín, máx, máx+1). ≥ 1 200 casos, síncronos,
  sem I/O; inclui monotonicidade independente de `lastAuthorSeq` por `sequenceScope` e
  rejeição de escopo incompatível sem avanço do contador.
- **`fold` — fuzzer de totalidade (obrigatório):** ≥ 10⁷ entradas aleatórias e mutadas
  (bytes aleatórios, envelopes truncados, `kind` inválido, `seq` fora de ordem, payload de
  outro `kind`) provando que **nenhuma** lança e que toda uma delas mapeia para um dos três
  desfechos. `fold.panic` precisa ser 0. Este teste é o que sustenta §8.5.
- **`permissions`**: 17 permissões × cargos do dataset × hierarquia (acima/igual/abaixo/
  Fundador/host) × os três casos de anti-escalada.
- **`opCodec`**: round-trip dos 38 `kind`s com `sequenceScope`; forma canônica estável (mesmo
  input ⇒ mesmo `opId`, byte a byte); assinatura cobre o escopo; tolerância a bytes extras;
  rejeição de `v` desconhecido e de `v = 1` sem escopo.
- **`idgen`**: determinismo, ausência de colisão em 10⁸ tuplas e ids distintos para o mesmo
  `(communityId, author, authorSeq)` em `community` e em dois canais diferentes.

**Meta:** ≥ 98 % de linha nesses quatro. Fora deles, cobertura não é meta.

### 28.2 Harness multi-instância

N núcleos no mesmo processo de teste, sobre `hyperdht/testnet`. **Nunca toca a DHT
pública.** Cenários obrigatórios, todos vindos de risco real:

1. As **oito corridas** de §21.1, com projeção atrasada e reinício do host no meio →
   nenhuma produz registro inaplicável nem divergência.
2. Host cai no meio de um envio → a mensagem fica na fila e é entregue no retorno.
3. Membro volta depois de 1 000 mensagens → interpreta o atraso todo sem buraco.
4. Banido tenta replicar → todo par recusa o canal, não só o host.
5. Convite delegado (criador ≠ host) resgatado com o host **sem o segredo** → 100 %.
6. `maxUses=1` com 10 candidatos simultâneos → exatamente um `member.join`.
7. Reenvio do mesmo envelope 3× → um `seq`, `E_DUPLICATE` nas repetições.
8. Envelope colhido do log de A appendado no core de B → `REJECTED` com
   `E_WRONG_COMMUNITY` em toda réplica de B.
9. Host adversário appenda `mod.ban` autorado por quem não tem `ban_members` → `REJECTED`
   em toda réplica, inclusive na do próprio host.
10. Timeout aplicado durante envio → `E_TIMED_OUT`; expira e volta a passar.
11. Host sai com `draining` → barreira de replicação cumprida ou `shutdown.forced` honesto.
12. `opVersion` incompatível → somente-leitura, outbox drenada como `client-outdated`.
13. Sucessão: host some por `HOST_INACTIVITY_MS` → sucessor assume, membros migram.
14. Um autor enfileira mensagens em pelo menos 8 canais com atrasos independentes → todos os
    envelopes são aceitos uma vez, sem `E_DUPLICATE` para uma operação nunca observada e sem
    `E_AUTHOR_SEQ_OVERTAKEN`; cada contador é monotônico dentro de seu `sequenceScope`.
15. Log com buracos e watermark acima de um item ausente → a reconciliação consulta o
    `opId` em `observed_ops` e mantém o item; nunca o reporta como entregue.
16. Kill com itens em `sending` antes do append e depois do append/antes do ACK → boot os
    devolve a `queued`, preserva `attempts`, e o reenvio produz no máximo um efeito lógico.
17. Grupo com 32/64 submissões concorrentes e falha de append → há mais de um registro no
    grupo nominal, nenhum ACK parcial e o `DS` provisório inteiro é descartado na falha.

### 28.3 Injeção de falha real

Cada botão do DevBar derruba, atrasa ou degrada algo de verdade no núcleo (Apêndice B). Em
produção o roteador `dev.*` **não existe** (§15.3).

Matriz de crash obrigatória: `SIGKILL` antes do append, depois do append/commit e antes do
ACK, depois do ACK, entre o commit de `view.db` e o de
`manifest.db`, durante a reprojeção, durante o `wipe` em cada estágio, durante o staging de
blob. Oráculo: **nenhuma operação confirmada é perdida; nenhuma é duplicada; o boot sempre
converge.**

### 28.4 Determinismo do `fold`

Três testes, todos em CI, contra um core de referência com ≥ 5 000 registros cobrindo os 38
`kind`s **e** ≥ 200 registros deliberadamente inválidos:

1. **Reprojeção idêntica:** apagar `view.db` e reprojetar do `seq` 0 produz o mesmo hash de
   dump ordenado.
2. **Convergência entre réplicas:** N réplicas independentes produzem o mesmo hash.
3. **Snapshot equivalente:** interpretar com snapshot a cada K registros produz o mesmo
   `DecisionState` que interpretar sem snapshot.

**É o teste que protege a decisão-raiz A02.** Se ele quebrar, a arquitetura deixou de ser
verdade e precisa ser reavaliada, não remendada.

### 28.5 Adversário

- Host modificado que appenda op com autoria alheia → toda réplica recusa.
- Host modificado que appenda op de outra comunidade → `E_WRONG_COMMUNITY`.
- Host modificado que reescreve `hostTs` → `E_BAD_HOST_SIGNATURE`.
- Cliente que manda payload fora dos limites → recusado no estágio certo.
- Força bruta de convite: 10 000 tentativas em 60 s → todas recusadas, conexão fechada por
  tentativa, rate limit por chave e por /24 mordendo.
- Renderer que tenta `blob.stage` com caminho arbitrário → não existe superfície.
- Renderer que tenta `identity.wipe` sem token → `E_PERMISSION_DENIED`.

### 28.6 Performance

Benchmarks com **assert de limite** (falham o CI), contra §26.1. Dataset sintético: 3
comunidades, 100 k mensagens, 340 membros, 500 anexos. Cada execução publica ambiente,
versões, lockfile, dataset, amostras, warm-up e percentis.

### 28.7 Paridade com as fixtures

Os fluxos de `frontend.md` §11 rodados contra o backend real, com o dataset de referência
recriado por `dev.seedDataset` **a partir de ops reais** — o que exige que o dataset seja
produzível pelo modelo (`RT-14`, `DR-50`). As quatro divergências estão resolvidas em
`deltas-ux-v2.md` §3. **Se um fluxo precisa de estado que o backend não produz, é buraco de
backend, não de UI.**

---

## 29. Fases de implementação e gates

**Nenhuma fase começa antes do gate que a precede.** A definição completa de cada gate,
com hipótese, critério e consequência de falha, está em
`plano-de-validacao-experimental-v2.md`.

| # | Fase | Entrega | Gate de entrada |
|---|---|---|---|
| **0** | **Runtime** | Electron empacotado com `better-sqlite3`, `hypercore`, `sodium-native`, `udx-native` em `utilityProcess`, na matriz de plataforma fechada; lock composto; `safeStorage`; crash/restart | — |
| **1** | **Fundação de fronteira** | IPC-R com `epoch`/`subId`/`evSeq`/ack/resync; IPC-M; classes de autorização; deep link; identidade; export/import | **G0**, **G10** |
| **2** | **`fold` e log** | Os 38 `kind`s, `DecisionState`, pipeline de admissão, efeitos, projeção, reprojeção, snapshot, determinismo em CI | **G1** |
| **3** | **Escrita durável** | Outbox, group commit, barreira de durabilidade, reconciliação, máquina de estados, descarte nomeado | **G4** |
| **4** | **Replicação e rede visível** | Autorização de canal, escalonador multicomunidade, estados de replicação, presença/typing agregados, não-lidas | **G2**, **G6** |
| **5** | **Convites e entrada** | Canal de admissão, preview de 6 desfechos, resgate atômico, revogação | **G3** |
| **6** | **Busca e anexos** | FTS5, core de blobs por autor, ticket de staging, download, seeding, cotas, allowlist de tipo | **G5** |
| **7** | **Voz e câmera** | WebRTC mesh, STUN/TURN comunitário, tickets, revogação, dispositivos | **G7** |
| **8** | **Tela (estrela)** | Captura autorizada, estrela ≤ 8, qualidade por espectador, saúde ao apresentador | **G8** |
| **9** | **Relay voluntário** | TURN voluntário com prova de posse, TTL, cota, consentimento | **G7** |
| **10** | **Continuidade** | Escrow, sucessão, migração, detecção de fork | **G12** |
| **— (fora do v1)** | **Árvore de multicast** | §17.8 | **G13 / POC-09** |

**Estado pós-G4:** a fase 3 está liberada para implementação contra esta redação emendada.
O artefato G4 anterior confirma a mecânica de crash da versão pré-emenda, mas não substitui
o rerun multicanal de `opVersion = 2`; a fase 3 não é considerada concluída nem liberada
para release antes desse rerun e das limitações de evidência de G4-E1/E2.

Fases 2 e 3 juntas derrubam quase todas as fixtures. **A fase 10 é cortável do v1 sem
quebrar o produto** — sem ela, a limitação L-15 vira "não há sucessão", o que precisa ser
dito na UX.

---

## 30. Ambiguidades

### 30.1 Fechadas por este documento

Fonte da verdade do estado · atomicidade validação↔append · política de registro inválido ·
reprojeção completa e o que ela preserva · origem de todo id · dedupe sem janela ·
escopo do `authorSeq` por canal e comunidade · índice de `opId` observado para reconciliação ·
durabilidade e critério de liberação da outbox · protocolo de convite delegado ·
consumo atômico de `maxUses` · alcançabilidade dos seis desfechos de preview · ownership e
caminho de escrita de anexos · origem do caminho de arquivo · retomada de staging ·
contrato de IPC com crash, backpressure e reconexão · fronteira da chave privada ·
autorização de comando · vínculo da assinatura à comunidade · assinatura de `hostTs` ·
isolamento entre comunidades · autorização de replicação · cargo base na anti-escalada ·
ponto de aplicação de `mention_everyone` · enum de `hostStatus` · schema de todas as
queries · quem reagiu · não-lidas de thread · aba Links · preferências legíveis ·
participantes de voz na sidebar · fala ativa · `/m/:code` · carimbo exibido · `handle` ·
ordenação de cargos · reação idempotente · ciclo de vida do expulso/banido · revogação de
mídia · saída do host · sucessão · detecção de fork · catálogo de erros completo ·
constantes de protocolo × configuração.

### 30.2 Ainda abertas, com dono e prazo

| # | Ambiguidade | Por que continua aberta | Quando decide |
|---|---|---|---|
| A-1 | Taxa real de conexão direta por classe de NAT | Não há medida; o "95 %" de v1 era auto-reportado | **G7**, antes da fase 7 |
| A-2 | Teto real de membros por comunidade | Depende do fan-out de conexões no host | **G9**, antes de anunciar 340 |
| A-3 | Custo do host como STUN/TURN | Só medível com carga real | **G7** |
| A-4 | Multi-dispositivo | Fora do v1; o backup de §5.5 é import em instalação nova, não sincronização | Depois do v1 |
| A-5 | Disponibilidade com host offline | `blind-peering` replicaria cifrado sem ler; não escolhido | Se o SPOF do host virar reclamação recorrente |
| A-6 | Notificação com app fechado | Fora do v1 | Depois do v1 |
| A-7 | Árvore de multicast | §17.8 | **G13/POC-09** |
| A-8 | Rotação da Data Key | Fora do v1 (L-3) | Depois do v1 |

---

## Apêndice A — Mapa store → comando IPC

A assinatura da ação no frontend **não muda** — só o corpo. As linhas marcadas **⚠**
mudaram de contrato em relação a v1 e exigem ajuste no componente; estão detalhadas em
`deltas-ux-v2.md`.

| Store / ação | Comando IPC | Observação |
|---|---|---|
| `identityStore.createIdentity` | `identity.create` | — |
| `identityStore.setPresence` | `identity.setPresence` | Efêmero |
| `identityStore.updateIdentity` | `identity.update` | **⚠** assíncrono: devolve `queued[]` |
| `identityStore.clearIdentity` | `identity.wipe` | **⚠** exige token de confirmação nativa |
| *(novo)* | `identity.export` / `identity.import` | **⚠** telas novas (U-01) |
| `communityStore.createCommunity` | `community.create` | Lote de gênese |
| `communityStore.joinCommunity` | `invite.redeem` | — |
| `communityStore.updateCommunity` | `community.update` | **⚠** salvamento explícito (U-23) |
| `communityStore.leaveCommunity` | `community.leave` → `kind` `member.leave` | — |
| `communityStore.endCommunity` | `community.end` | **⚠** token de confirmação |
| `communityStore.createInvite` | `invite.create` | `code` só para quem cria |
| `communityStore.revokeInvite` | `invite.revoke` | — |
| `communityStore.createRole` / `updateRole` / `deleteRole` | `role.create` / `.update` / `.delete` | **⚠** salvamento explícito |
| `communityStore.moveRole` | `role.move` | **⚠** devolve `{rank}`, não `positions[]` |
| `communityStore.setMemberRoles` | `member.setRoles` | **⚠** devolve `appliedRoleIds` |
| `communityStore.setMemberNickname` | `member.setNickname` | — |
| `communityStore.createChannel` … `deleteCategory` | `channel.*` / `category.*` | **⚠** `afterChannelId` no lugar de `position` |
| `communityStore.toggleChannelMuted` | `channel.setMuted` | Local |
| `communityStore.markChannelRead` | `channel.markRead` | **⚠** devolve menções também |
| `communityStore.toggleCategoryCollapsed` | `category.setCollapsed` | Local |
| `communityStore.setActiveChannel` | `nav.setActive` | **⚠** o núcleo é o dono |
| `communityStore.setLocalRoleOverride` | *(some)* | — |
| `messageStore.send` | `message.send` | Assíncrono |
| `messageStore.retrySend` | `message.retry` | **Mesmo `opId`** |
| `messageStore.flushQueued` / `dropQueued` | *(some)* | Vira evento |
| `messageStore.toggleReaction` | `message.react{present}` | **⚠** deixa de ser toggle |
| `messageStore.setPinned` / `editMessage` / `deleteMessage` / `createThread` | `message.pin` / `.edit` / `.delete` / `thread.create` | **⚠** todos assíncronos agora (U-02) |
| `messageStore.setTyping` | `presencePublish{typingChannelId}` | Efêmero |
| `moderationStore.ban` / `revokeBan` / `kick` / `applyTimeout` / `removeTimeout` | `mod.*` | — |
| `moderationStore.log` | `query.auditLog` + `auditLog.changed` | **⚠** evento novo |
| `voiceStore.join` / `leave` | `voice.join` / `voice.leave` | **⚠** devolve `iceServers` e `tickets` |
| `voiceStore.toggleMute/Deafen/Camera` | `voice.setSelf` | — |
| `voiceStore.setVolume` | `settings.setParticipantVolume` | **⚠** agora persiste |
| `voiceStore.setParticipantMuted` | `voice.muteParticipant` | **⚠** declarado como conselho (U-08) |
| `voiceStore.startShare` / `stopShare` | `share.start` / `share.stop` | **⚠** `captureToken` antes de capturar |
| `voiceStore.setQuality` | `share.setQuality` | **⚠** agora funciona (estrela) |
| `voiceStore.respondConsent` | `relay.respondConsent` | — |
| `downloadStore.start` | `blob.download` | **⚠** exige `blobsCoreKey` |
| *(novo)* | `file.pickForAttachment` | **⚠** substitui o caminho local |
| `connectionStore.setHostStatus` | *(evento)* | `host.statusChanged` com enum fechado |
| `settingsStore.setDevice` / `setVolume` | `settings.*` | — |
| *(novo)* | `query.preferences` | **⚠** fecha a leitura que faltava (U-24) |
| `settingsStore.runDiagnostic` | `diag.run` | — |
| `searchIndex.search` | `query.search` | FTS5 no núcleo |
| Todos os `select*` | `query.*` | Colapsam fixture+override numa camada só |

**Regra de migração:** cada store deixa de guardar dado de domínio e passa a guardar
**cache de leitura invalidado por evento**, reconstruído no boot e após `evStale`.

---

## Apêndice B — Mapa DevBar → injeção de falha real

Nomes reais das ações do mock à esquerda, comando do núcleo à direita (fecha `RT-15`).

| Ação do mock | Comando | Efeito real |
|---|---|---|
| `connectionStore.setHostStatus('offline')` | `dev.hostOffline` | Fecha o stream RPC e recusa reconexão |
| `connectionStore.setHostStatus('online')` | `dev.hostOnline` | Libera; dispara flush com jitter |
| `messageStore.setFailNextSend` | `dev.failNextSubmit` | O host recusa a próxima op com `E_INTERNAL` |
| `downloadStore.devDropPeer` | `dev.dropBlobPeer` | Remove um par do range; `blob.peerLost` |
| `voiceStore.devSetPeerMesh` | `dev.setPeerMesh` | Marca a aresta como `degraded` |
| `voiceStore.devFailVoiceJoin` | `dev.failVoiceJoin` | `voiceJoin` devolve erro |
| `voiceStore.devStartRemoteShare` | `dev.startRemoteShare` | Sessão sintética com apresentador remoto |
| `voiceStore.devAddViewer` / `devClearViewers` | `dev.addViewer` / `dev.clearViewers` | Muda o roster da sessão |
| `voiceStore.devSetTurnFallback` | `dev.forceRelay` | Força o caminho TURN |
| `voiceStore.devRepairTree` | *(removido do v1)* | A árvore está adiada (§17.8) |
| `voiceStore.devFailShare` | `dev.failShare` | Encerra a sessão com `share.failed` |
| `voiceStore.devForgetConsent` | `dev.forgetConsent` | Apaga `local_relay_consent` |
| `settingsStore.devSetNatType` | `dev.setNatType` | Força `swarm.natType` |
| *(novo)* | `dev.stallReplication` | Congela a replicação de uma comunidade → `stalled` |
| *(novo)* | `dev.corruptNextBlob` | Corrompe um bloco → `attachment.corrupt` |
| `dataset seed` | `dev.seedDataset` | Cria o dataset de referência **por ops reais** |
| `resetAll` | `dev.resetAll` | Equivale a `identity.wipe` sem confirmação |

---

*Fim da Especificação Técnica do Backend v2.*
