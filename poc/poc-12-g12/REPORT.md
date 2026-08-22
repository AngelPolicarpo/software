# POC-12 / G12 — relatório

Leitura consolidada do que o harness mediu. O artefato versionado está em
`out/gate-G12/gate-G12.json` (perfil full; `out/gate-G12-quick/` para o smoke); este
documento é a interpretação dele e **não é normativo**.

---

## 1. O que o gate perguntou

> Um sucessor com escrow válido assume, após o grace period, criar a comunidade de
> continuação, provar autorização e fazer os membros migrarem, sem fork e sem perda de
> estrutura, membros, cargos ou moderação.

O ambiente desta sessão não tem Electron empacotado nem swarm multi-nó, então o padrão
consolidado nos gates G7/G8 foi seguido: evidência **parcial** no escopo Node, com os
`openCriteria` bloqueando release, não decisão.

## 2. O que foi medido (6/6 passos, quick e full)

| | Medido |
|---|---|
| Escrow (S1) | 3 sucessores; cada um abre o PRÓPRIO `wrappedSeed` lido do log bruto (`kind#44` decodificado); intruso e selo adulterado → `null` |
| Grace period (S2) | camada b recusa a `HOST_INACTIVITY_MS − 1`; abre depois; fora da lista → `not-successor`; as chaves do core antigo derivam exatamente da semente escrowada |
| Continuação (S3) | gênese com `originCommunityId`/`originFinalSeq`/`blobsKey` novo + `community.assumeHost` na seq 6 — **todos os registros ACCEPTED pelo fold REAL**; R-18(a): prova verifica contra a chave pública da ORIGEM e não contra a nova; host vira o sucessor |
| Estrutura (S4) | cargos/categorias/canais com nomes idênticos à origem; mensagens/convites/relays vazios na continuação (L-15 verificado) |
| Arbitragem (S5) | duas continuações válidas → réplica segue a de maior prioridade (L-16); claim de fora da lista → `disputed`, não migra; réplica SEM a origem segue a camada a |
| Host que volta (S6) | zero writes no core antigo durante a assunção — log intacto, sem desfazer |

## 3. `ACHADO-G12-01` — membros não são reconstruíveis pelo sucessor

**Bloqueia parcialmente o critério "membros idênticos" do plano.** §18.8 passo 6 manda
reconstruir membros no lote estendido, mas:

1. a membresia criada por `member.join` é a do **próprio autor** do op — é o que a
   estrutura de §7.3/§8.1 determina (autoria → `Member`);
2. a prova de R-9 vincula `(communityId, invitePk, author)` — o communityId NOVO, que o
   sucessor não pode forjar para terceiros;
3. ninguém assina por um terceiro.

Medido: a continuação nasce com exatamente 1 membro (o sucessor, como fundador). Qualquer
zero-form adicional é `E_INVITE_INVALID`. Com o catálogo fechado de 38 kinds
(`opVersion = 2`), "membros idênticos ao estado final" é inalcançável por ops normais.

**Rotas normativas possíveis** (decisão do ARB, não desta sessão):

| Rota | Custo | Consequência |
|---|---|---|
| (i) desacoplar alvo da autoria (`member.join` ganha `targetKey` na forma de sucessão) | payload novo + regra condicional à origem declarada na gênese | bump de `opVersion` ou campo opt compatível; fold passa a aceitar host criando membership de terceiros em continuação |
| (ii) transplante de lote: replay dos envelopes ORIGINAIS (≤ `originFinalSeq`) no core novo | fold precisa aceitar registros com `communityId` antigo escopados ao transplante; hostSig original verifica contra `originCommunityId` | membros/cargos/bans idênticos byte-a-byte; mecanismo maior |
| (iii) reentrada assistida: sucessor publica um convite de uso único por membro ativo; clientes migram e entram sozinhos | nenhuma mudança de protocolo | convergência assíncrona; critério "idêntico" vira "eventual"; UX precisa mostrar pendentes |

Enquanto isso, o produto entrega: continuação com estrutura preservada e convites
preparados — a rota (iii) é a única já implementável hoje.

## 4. Emenda aplicada nesta sessão (§4)

A linha de `succession` em §4 ganhava as dependências mínimas para existir:
`corestore, identity` → `corestore, identity, fold, opCodec, idgen, permissions`.
Sem elas o módulo não consegue ler estado, codificar/assinar registros, prever ids de
entidade nem reproduzir a numeração fechada de permissões ao recriar cargos. Registrada
em `sequenciamento-pos-fase-0.md` §27.

## 5. Limitações (bloqueiam release, não decisão)

1. Sem Hypercore real multi-nó: réplicas são estados em memória no mesmo processo; a
   migração de rail via swarm/corestore fica para a integração.
2. Corrida "host volta durante replicação da continuação" não simulada.
3. Escrow corrompido foi injetado pós-selo; persistência real de selo corrompido no log e
   recusa na leitura ficam para o gate empacotado.
4. Electron/utilityProcess/manifest (§5.3) ausentes — a derivação das chaves a partir da
   semente recuperada aqui usou a mesma construção da fixture.

## 6. Veredito

**Parcial**: todos os passos executáveis passaram nos dois perfis; escrow, grace period,
prova de posse, aceitação pelo fold real, arbitragem de prioridade e integridade do core
antigo estão medidos. O critério de membros depende da decisão normativa sobre
`ACHADO-G12-01` e da integração real — bloqueiam release, não a implementação existente.
