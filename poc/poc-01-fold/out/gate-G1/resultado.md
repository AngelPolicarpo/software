# Resultado do gate G1 — POC-01

**Decisão: CONFIRMADO**

Executado em 2026-08-16T09:30:31.292Z · perfil `full` · foldBuildId `0a9b7a4aecca7391c473067f1e8d841c` · duração 22.4 min

## Hipótese sob teste

**(a)** Toda corrida legitima entre ops mutuamente incompativeis e resolvida antes do append, com erro nomeado, sem excecao nenhuma.

**(b)** Mesmo quando um registro invalido, hostil ou de versao desconhecida entra no log, toda replica converge para o mesmo estado, sem parar.

ADRs cobertas: A01, A02, A04, A05, A07, A10, A11.

## Critérios de aprovação

| # | Critério | Medido | Situação |
|---|---|---|---|
| A1 | `fold.panic = 0` em TODAS as entradas do fuzzer (>= 10^7) | fold.panic = 0 em 10.000.000 entradas | ATENDIDO |
| A2 | toda entrada mapeada para APPLIED / REJECTED / IGNORED, com `reason` do catalogo de §20.2 | desfechos desconhecidos = 0; reason ausente = 0; codigo fora do catalogo = 0; effects nao vazio sem APPLIED = 0 | ATENDIDO |
| A3 | as oito corridas de §21.1, 10 000 repeticoes cada, projetor pausado e reinicio do host no intervalo; a perdedora e recusada ANTES do append, com erro nomeado | 8 corridas · 80.000 repeticoes · 160.000 ensaios · 0 falhas de oraculo | ATENDIDO |
| A4 | zero divergencia de hash de dump ordenado entre replicas, em TODOS os cenarios | reprojecao identica; 3 replicas (batch 32/256/2048) convergem; snapshot equivalente: true; 380 checagens de replica nas corridas; adversario convergiu: true | ATENDIDO |
| A5 | todo registro do host adversario e REJECTED, IGNORED ou neutralizado por regra deterministica declarada, com o mesmo desfecho em TODA replica, inclusive na do proprio adversario | 15 ataques; 15 com decisao unanime; 1 neutralizado pelo clamp de R-1, sem efeito retroativo | ATENDIDO |
| A6 | nenhuma comunidade em estado irrecuperavel | nenhum cenario terminou com a comunidade sem canal, sem membro ou impossivel de reprojetar; fold.panic somado = 0 | ATENDIDO |
| A7 | §28.1: >= 1 200 casos unitarios de `fold`, cobertura exaustiva de opCodec/permissions/idgen | 1253 casos de fold · 4728 asserts no total · 0 falhas | ATENDIDO |

## Cenário 1 — fuzzer de totalidade (§28.1, §8.5)

Entradas: **10.000.000** · semente `6820421354158752000` · 16 workers · 86.345 entradas/s · 116s

`fold.panic` = **0** · desfecho fora dos três = **0** · `reason` ausente = **0** · efeitos sem APPLIED = **0** · código fora do catálogo de §20.2 = **0**

### Cobertura por estágio de §8.2

| Estágio | Entradas |
|---:|---:|
| 1 | 2.799.569 |
| 2 | 2.295.081 |
| 3 | 399.697 |
| 4 | 399.972 |
| 6 | 958.449 |
| 7 | 367.182 |
| 8 | 576.039 |
| 10 | 11.835 |
| 11 | 1.122.813 |
| 12 | 15.961 |
| 13 | 423.219 |
| 14 | 424.823 |
| 15 | 205.360 |

Estágios 5 (comunidade encerrada) e 9 (timeout) exigem `community.end` e `mod.timeout`,
fora dos 16 `kind`s deste PoC — ver REPORT.md §6.

### Desfecho por estratégia

| Estratégia | n | APPLIED | REJECTED | IGNORED |
|---|---:|---:|---:|---:|
| `raw-bitflip` | 399.967 | 0 | 35 | 399932 |
| `raw-length-inflate` | 399.770 | 0 | 0 | 399770 |
| `raw-random` | 399.947 | 0 | 0 | 399947 |
| `raw-splice` | 400.674 | 0 | 55 | 400619 |
| `raw-truncate` | 400.156 | 0 | 0 | 400156 |
| `raw-zero` | 400.229 | 0 | 0 | 400229 |
| `signed-authorseq-jump` | 400.718 | 34512 | 366206 | 0 |
| `signed-authorseq-regress` | 398.777 | 0 | 398777 | 0 |
| `signed-authorseq-replay` | 400.519 | 0 | 400519 | 0 |
| `signed-bad-author-sig` | 399.972 | 0 | 399972 | 0 |
| `signed-broken-refs` | 399.653 | 33319 | 366334 | 0 |
| `signed-clock-far` | 400.461 | 2 | 400459 | 0 |
| `signed-extreme-fields` | 399.940 | 33222 | 366718 | 0 |
| `signed-flags-random` | 400.257 | 33596 | 366661 | 0 |
| `signed-hostsig-invalid` | 398.916 | 0 | 0 | 398916 |
| `signed-hostts-retro` | 399.936 | 33384 | 366552 | 0 |
| `signed-kind-unimplemented` | 399.724 | 0 | 0 | 399724 |
| `signed-kind-unknown` | 399.757 | 2 | 32 | 399723 |
| `signed-nonmember` | 399.511 | 0 | 399511 | 0 |
| `signed-payload-garbage` | 399.731 | 0 | 695 | 399036 |
| `signed-payload-other-kind` | 400.517 | 4039 | 99748 | 296730 |
| `signed-payload-truncated` | 399.942 | 0 | 0 | 399942 |
| `signed-valid` | 401.303 | 33284 | 368019 | 0 |
| `signed-version-unknown` | 399.926 | 0 | 0 | 399926 |
| `signed-wrong-community` | 399.697 | 0 | 399697 | 0 |

### Motivos observados

| Código | Ocorrências |
|---|---:|
| `E_BAD_HOST_SIGNATURE` | 2.799.569 |
| `E_PERMISSION_DENIED` | 1.122.813 |
| `E_MALFORMED` | 1.095.761 |
| `E_DUPLICATE` | 958.449 |
| `E_UNKNOWN_KIND` | 799.394 |
| `E_NOT_MEMBER` | 576.039 |
| `E_VALIDATION` | 412.733 |
| `E_BAD_SIGNATURE` | 399.972 |
| `E_VERSION_UNSUPPORTED` | 399.926 |
| `E_WRONG_COMMUNITY` | 399.697 |
| `E_CLOCK_UNREASONABLE` | 367.182 |
| `E_GENESIS_MISPLACED` | 170.725 |
| `E_NOT_FOUND` | 95.572 |
| `E_CHANNEL_NOT_FOUND` | 88.783 |
| `E_BASE_ROLE_REQUIRED` | 27.108 |
| `E_MESSAGE_DELETED` | 20.760 |
| `E_CATEGORY_NOT_FOUND` | 14.280 |
| `E_HIERARCHY` | 12.032 |
| `E_QUOTA_EXCEEDED` | 11.835 |
| `E_CHANNEL_NAME_EMPTY` | 7.464 |
| `E_PERMISSION_ESCALATION` | 3.154 |
| `E_ATTACHMENT_TOO_LARGE` | 3.022 |
| `E_INVITE_INVALID` | 2.979 |
| `E_SELF_TARGET` | 2.337 |
| `E_FOUNDER_IMMUNE` | 1.592 |
| `E_FOUNDER_IMMUTABLE` | 1.262 |
| `E_BASE_ROLE_RESTRICTED` | 199 |
| `E_LIMIT_EXCEEDED` | 1 |

## Cenário 2 — as oito corridas de §21.1

Cada repetição roda dois ensaios: **serial** (projetor pausado, op A, reinício do host, op B) e
**paralelo** (as duas na mesma seção crítica, mesmo group commit de §11.5).

| # | Corrida | Rep. | Ensaios | Desfecho de A | Desfecho de B | Δ append | Diverg. | Situação |
|---|---|---:|---:|---|---|---|---:|---|
| C1 | dois moderadores editam o mesmo cargo | 10.000 | 20.000 | `APPLIED`×20.000 | `APPLIED`×20.000 | +2×20.000 | 0 | OK |
| C2 | channel.delete ‖ message.send no mesmo canal | 10.000 | 20.000 | `APPLIED`×20.000 | `E_CHANNEL_NOT_FOUND`×20.000 | +1×20.000 | 0 | OK |
| C3 | channel.create(#x) ‖ channel.create(#x) | 10.000 | 20.000 | `APPLIED`×20.000 | `E_CHANNEL_NAME_TAKEN`×20.000 | +1×20.000 | 0 | OK |
| C4 | role.delete ‖ member.setRoles citando-o | 10.000 | 20.000 | `APPLIED`×20.000 | `APPLIED`×20.000 | +2×20.000 | 0 | OK |
| C5 | category.delete ‖ channel.create naquela categoria | 10.000 | 20.000 | `APPLIED`×20.000 | `E_CATEGORY_NOT_FOUND`×20.000 | +1×20.000 | 0 | OK |
| C6 | message.delete ‖ reaction.set | 10.000 | 20.000 | `APPLIED`×20.000 | `E_MESSAGE_DELETED`×20.000 | +1×20.000 | 0 | OK |
| C7 | channel.delete(ultimo) ‖ channel.delete(penultimo) | 10.000 | 20.000 | `APPLIED`×20.000 | `E_LAST_CHANNEL`×20.000 | +1×20.000 | 0 | OK |
| C8 | ban ‖ op do alvo | 10.000 | 20.000 | `APPLIED`×20.000 | `E_BANNED`×20.000 | +1×20.000 | 0 | OK |

Ops recusadas **antes do append**, somando as oito: **120.000**. Reprojeções totais conferidas: **190**. Réplicas independentes conferidas: **380**. Erros de fixture do harness: **0**.

## Cenário 3 — host adversário (§1.4, §28.5)

| # | Ataque | Regra que decide | Decisão | Motivo | Réplicas concordam | Neutralizado |
|---|---|---|---|---|---|---|
| X1 | envelope colhido do log de A appendado no core de B | §28.5 / §8.2 estagio 3 — E_WRONG_COMMUNITY | `REJECTED` | `E_WRONG_COMMUNITY` | sim | sim |
| X2 | mod.ban autorado por quem nao tem ban_members | §28.5 / §8.2 estagio 11 — E_PERMISSION_DENIED | `REJECTED` | `E_PERMISSION_DENIED` | sim | sim |
| X3a | hostTs retroativo, op.ts na cabeca | R-1 — clamp deterministico, NAO recusa (conflita com o criterio do POC-01) | `APPLIED` | `—` | sim | ver nota |
| X3b | hostTs retroativo com op.ts recuado junto | §8.2 estagio 7 / R-2 — E_CLOCK_UNREASONABLE | `REJECTED` | `E_CLOCK_UNREASONABLE` | sim | sim |
| X4 | hostTs reescrito depois de assinar (hostSig invalida) | §28.5 / §8.2 estagio 1 — E_BAD_HOST_SIGNATURE | `IGNORED` | `E_BAD_HOST_SIGNATURE` | sim | sim |
| X5 | reenvio do MESMO envelope (authorSeq repetido) | §7.5 / §8.2 estagio 6 — E_DUPLICATE | `REJECTED` | `E_DUPLICATE` | sim | sim |
| X6 | authorSeq regredido para 1 | §7.5 / §8.2 estagio 6 — E_DUPLICATE | `REJECTED` | `E_DUPLICATE` | sim | sim |
| X7 | op com autoria do Fundador, assinada por outra chave | §1.4 / §8.2 estagio 4 — E_BAD_SIGNATURE | `REJECTED` | `E_BAD_SIGNATURE` | sim | sim |
| X8 | kind desconhecido | §7.2 regra 4 / estagio 2 — IGNORED + partialInterpretation | `IGNORED` | `E_UNKNOWN_KIND` | sim | sim |
| X9 | opVersion desconhecida | §7.2 regra 5 / estagio 2 — IGNORED + partialInterpretation | `IGNORED` | `E_VERSION_UNSUPPORTED` | sim | sim |
| X10 | payload truncado para o kind declarado | §7.2 regra 4 / estagio 2 — IGNORED / E_MALFORMED | `IGNORED` | `E_MALFORMED` | sim | sim |
| X11 | bytes aleatorios appendados no core | §8.5 — estagio 1, IGNORED | `IGNORED` | `E_BAD_HOST_SIGNATURE` | sim | sim |
| X12 | mod.ban contra o Fundador | R-16 / estagio 12 — E_FOUNDER_IMMUNE | `REJECTED` | `E_FOUNDER_IMMUNE` | sim | sim |
| X13 | cargo base recebendo ban_members | R-11 / estagio 14 — E_BASE_ROLE_RESTRICTED | `REJECTED` | `E_BASE_ROLE_RESTRICTED` | sim | sim |
| X14 | community.create em seq != 0 | §8.4.1 / R-27 — E_GENESIS_MISPLACED | `REJECTED` | `E_GENESIS_MISPLACED` | sim | sim |

> **X3a** — R-1 manda clampar; o registro APLICA com hostTs = lastHostTs. Nenhum efeito retroativo e produzido.

Réplicas: `adversario-self`, `adv-0`, `adv-1` — incluindo a do **próprio host adversário**.

Hash de dump idêntico em todas: **true**. `fold.panic`: **0**.

## Cenário 4 — determinismo do `fold` (§28.4)

Core de referência: **5.202** registros, dos quais **200** deliberadamente inválidos (appendados pelo caminho do adversário — a admissão de §11.4 os recusaria antes do append).

Decisões: APPLIED **5.002** · REJECTED **50** · IGNORED **150**.

**1. Reprojeção idêntica** (§28.4 teste 1): **OK** — `510c4c18de397b0524563f624f069f40…`

**2. Convergência entre réplicas** (§28.4 teste 2), com `PROJECTOR_BATCH` distinto em cada uma:

| Réplica | batch | interpretedSeq | hash do dump ordenado |
|---|---:|---:|---|
| batch-32 | 32 | 5201 | `510c4c18de397b0524563f624f069f40…` |
| batch-256 | 256 | 5201 | `510c4c18de397b0524563f624f069f40…` |
| batch-2048 | 2048 | 5201 | `510c4c18de397b0524563f624f069f40…` |

Convergiram: **true**.

**3. Snapshot equivalente** (§28.4 teste 3):

| Intervalo de snapshot | `DecisionState` igual ao sem snapshot |
|---|---|
| sem snapshot | sim |
| 500 | sim |
| 1000 | sim |
| 5000 | sim |

## Cenário 0 — unitários (§28.1)

| Suíte | Casos | Falhas |
|---|---:|---:|
| opCodec | 1.421 | 0 |
| idgen | 17 | 0 |
| permissions | 30 | 0 |
| rank | 2.007 | 0 |
| fold/estagios §8.2 | 24 | 0 |
| fold/regras R-* | 102 | 0 |
| fold/fronteiras §8.6 | 269 | 0 |
| fold/matriz kind x estagio | 128 | 0 |
| fold/kind desconhecido | 245 | 0 |
| fold/autorizacao §9.4 | 260 | 0 |
| fold/ordem dos estagios §8.2 | 112 | 0 |
| fold/contrato §8.0 | 80 | 0 |
| fold/cota R-15 (estagio 10) | 9 | 0 |
| fold/referencia quebrada §8.4.1 | 24 | 0 |

Casos de `fold`: **1.253** (§28.1 pede ≥ 1 200). `idgen`: **100.000.000** tuplas, **0** colisões de prefixo de 64 bits (uma colisão de 128 bits seria necessariamente também uma de 64, então zero aqui implica zero lá).

## Ambiente e versões

```json
{
  "perfil": "full",
  "executadoEm": "2026-08-16T09:30:31.292Z",
  "host": "Rebis",
  "so": {
    "platform": "linux",
    "release": "6.6.114.1-microsoft-standard-WSL2",
    "arch": "x64",
    "distro": "Ubuntu 26.04 LTS"
  },
  "cpu": {
    "modelo": "AMD Ryzen 7 8700G w/ Radeon 780M Graphics",
    "nucleos": 16
  },
  "memoriaTotalGiB": 15.2,
  "runtime": {
    "node": "v22.22.1",
    "v8": "12.4.254.21-node.35",
    "icu": "78.2",
    "unicode": "17.0"
  },
  "dependencias": {
    "b4a": "1.8.1",
    "better-sqlite3": "11.10.0",
    "compact-encoding": "2.19.2",
    "corestore": "7.12.0",
    "hypercore": "11.35.1",
    "hypercore-crypto": "3.7.0",
    "hyperdht": "6.33.1",
    "sodium-native": "4.3.3",
    "@types/better-sqlite3": "7.6.13",
    "@types/node": "22.20.1",
    "typescript": "5.9.3"
  },
  "lockfile": {
    "arquivo": "package-lock.json",
    "sha256": "1738c1b91bdcb1b0e855d14b4f6517f70bb9f34804fbd0c3a8d10627a5e6be73"
  },
  "foldBuildId": "0a9b7a4aecca7391c473067f1e8d841c"
}
```

## Arquivos do artefato

| Arquivo | Conteúdo |
|---|---|
| `gate-G1.json` | artefato completo, todos os cenários, dado bruto |
| `resultado.md` | este documento (regenerável: `node dist/scripts/render-report.js`) |
| `ambiente.json` | SO, runtime, ICU, dependências, sha256 do lockfile, `foldBuildId` |
| `unitarios.json` · `fuzzer.json` · `corridas.json` · `adversario.json` · `determinismo.json` | por cenário |
| `execucao.log` | log bruto da execução |
| `../../REPORT.md` | leitura da spec, buracos, conflitos e a justificativa da decisão |
