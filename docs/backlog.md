# Backlog

O que está aberto, hoje. Uma linha por item: **nome e ponteiro**. A descrição mora na
referência — repetir aqui seria a segunda cópia a envelhecer.

Não normativo. Atualizado em 2026-08-26 (§86.10).

**Como manter.** Item fechado sai daqui e o fechamento é registrado na fatia do
`sequenciamento-pos-fase-0.md` que o fechou. As tabelas "Pendências" até §69 ficam como
histórico; da §72 em diante a lista viva é esta e as fatias não a repetem.

## Bloqueia release

| # | Item | Referência |
|---|---|---|
| B1 | Addons Linux exigem glibc 2.34/2.33, acima do piso 2.31 de A16 — falta `build/Dockerfile` + `build/build-addons.sh` | `poc/poc-03-runtime/REPORT.md` §3.1 |
| B2 | 69 `.node` de plataformas fora da matriz viajam no instalador | `poc/poc-03-runtime/REPORT.md` §3.5 |
| B3 | `.exe` sem assinatura de código — SmartScreen alerta | §71.3 |
| B4 | G7 e G8 têm veredito `parcial`; os `openCriteria` exigem Electron empacotado, `tc/netem` e CGNAT real | §72.3, `poc/poc-08-g7`, `poc/poc-09-g8` |

## Caminho do produto, em ordem

| # | Item | Referência |
|---|---|---|
| B27 | Permissões TURN: `rosterAddresses` devolve vazio porque o roster guarda chaves e não endereços — falta a ponte par→endereço observado, que vem do transporte. Sem ela o caminho relayado não existe e a chamada só fecha em conexão direta | §17.3, `composition/media.ts` |
| B29 | §17.2 diz "configurável" e não diz ONDE. Com o default ligado (§81.5) deixou de bloquear uso, mas desligar ou trocar o servidor ainda exige `P2P_STUN_SERVERS` — §15.4 não tem comando de settings para isso. Lacuna de spec | §17.2, §81.4 |
| B28 | **Voz entre provedores: qualidade não medida.** A chamada fecha (§82), mas latência, perda e CPU não foram medidas em rede real — os números de G8 são de localhost | §82, `poc/poc-09-g8` |
| B31 | **Tela: conectividade confirmada, qualidade não medida.** A tela fechou entre provedores diferentes (§85.1); latência, taxa de quadros e o comportamento com 8 espectadores de verdade continuam sem número (§83, §84); latência, taxa de quadros e o comportamento com 8 espectadores de verdade não foram medidos. O G8 mediu a estrela como desenho, não esta implementação | §83.6, `poc/poc-09-g8` |
| B32 | **Dois caminhos de captura não exercitados.** O seletor do sistema (`useSystemPicker`, Windows/macOS) e o portal PipeWire do Linux são caminhos diferentes dentro do mesmo `setDisplayMediaRequestHandler`; nenhum dos dois rodou fora do typecheck | §83.6, `app/src/main/index.ts` |
| B30 | **NAT simétrico / CGNAT sem caminho.** Com `srflx` o ICE fura na maioria dos NATs domésticos, mas simétrico dos dois lados não fura. Hoje cai em `conn-failed` nomeado (§80); a resposta da spec é o relay voluntário de §17.7 | §17.7, L-11 |
| B7 | §18.4 lado do alvo: observar o próprio ban/kick e entrar em modo removed | §66.4 |
| B8 | U-17 — remover do rail comunidade encerrada em que ainda sou membro (atenuado, não fechado) | §58.6 |
| B9 | Residência `light` efetiva no projector | §57.3 |
| B10 | Barreira de replicação por confirmação de PARES (§18.7) | §57.3 |
| B11 | Sondas NAT/STUN | §57.3 |
| B12 | Busca: "Ver todos" expandir até 100 (`limitPerGroup` fixo) | §67.2 |

## Lacunas de spec e decisões pendentes

| # | Item | Referência |
|---|---|---|
| B13 | Prazo de `invite.resolve` × teto do IPC-R: desfecho certo seria `unreachable`, não `E_TIMEOUT` | §62.4 |
| B14 | Correlação `blob.progress` ↔ `AttachmentDto` não é declarada em §15.6 | §58.6 |
| B15 | Divergências de aparência: `hostStatus` 9×3, tombstone, `hiddenByBan`, `clockSkewed`, `createdAt`/`description` sem fonte | §60.5 |
| B16 | Superfícies `dev.*` — decisão de produto | §57.3 |

## A observar

| # | Item | Referência |
|---|---|---|
| B17 | Host de longa duração deixou de receber conexões (3h22 no smoke; voltou ao reiniciar) | §63.4 |
| B18 | Chips de reação otimistas através de respawn de epoch | §61.4 |
| B19 | Recarga da página não redeliveria a porta IPC-R (F5 do usuário) | §60.5 |

## Qualidade

| # | Item | Referência |
|---|---|---|
| B20 | Nenhuma tela tem teste de render | §58.6 |
| B21 | Metade da validação fora do alcance do teste de contrato | §58.9 |
| B22 | Migração entre modos do cofre não exercitada | §60.5 |

## Fora do v1

| # | Item | Referência |
|---|---|---|
| B23 | Conversa direta entre identidades, sem comunidade — forma em aberto | `adr-v2.md` A29 |
| B24 | Árvore de multicast — especificada e adiada | `adr-v2.md` A20, `backend-v2.md` §17.8 |
