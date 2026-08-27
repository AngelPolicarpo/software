# Backlog

O que está aberto, hoje. Uma linha por item: **nome e ponteiro**. A descrição mora na
referência — repetir aqui seria a segunda cópia a envelhecer.

Não normativo. Atualizado em 2026-08-27 (separação por quem executa).

**Como manter.** Item fechado sai daqui e o fechamento é registrado na fatia do
`sequenciamento-pos-fase-0.md` que o fechou. As tabelas "Pendências" até §69 ficam como
histórico; da §72 em diante a lista viva é esta e as fatias não a repetem.

## Como esta lista é dividida

O critério é **o que falta para dar o próximo passo**, não a dificuldade nem o tamanho.

- **Só o operador humano** — o próximo passo exige algo que não está neste repositório nem
  nesta máquina: uma decisão de produto, texto normativo novo, uma credencial, uma máquina
  de outro sistema operacional, uma rede real.
- **O agente pode fazer** — o próximo passo é código, teste ou configuração que já dá para
  escrever **e verificar** aqui.

Duas consequências do critério, e as duas importam na hora de reclassificar:

**Um item atravessa a linha quando o bloqueio muda.** Vários são "o humano decide, o agente
implementa". Enquanto a decisão não existe, o item fica do lado humano — quem está esperando
é quem manda —, e a coluna *O que só o humano tem* diz o que destrava. Depois da decisão ele
muda de lado, e isso é manutenção normal desta lista, não exceção.

**O lado depende da máquina, então confira antes de mover.** B1 está do lado do agente
porque o Docker desta máquina responde e o piso de glibc pode ser montado aqui; num ambiente
sem Docker o mesmo item é humano. Classificar por suposição sobre o ambiente é como esta
divisão apodrece.

## Só o operador humano

### Bloqueia release

| # | Item | O que só o humano tem | Referência |
|---|---|---|---|
| B3 | `.exe` sem assinatura de código — SmartScreen alerta | O certificado: compra, identidade jurídica e custódia da chave privada. Nada disso se resolve em repositório | §71.3 |
| B4 | G7 e G8 têm veredito `parcial`; os `openCriteria` exigem Electron empacotado, `tc/netem` e CGNAT real | As máquinas e a rede: host Windows e Linux de verdade, `NET_ADMIN` para o `tc/netem` e um link de operadora com CGNAT. O harness em si é do agente | §72.3, `poc/poc-08-g7`, `poc/poc-09-g8` |

### Decisão de produto ou texto normativo

Nenhum destes é implementação parada: é a **spec que não responde**. Escrever comportamento
aqui sem decisão seria inventá-lo, que é o que `CLAUDE.md` proíbe.

| # | Item | O que só o humano tem | Referência |
|---|---|---|---|
| B29 | §17.2 diz "configurável" e não diz ONDE. Com o default ligado (§81.5) deixou de bloquear uso, mas desligar ou trocar o servidor ainda exige `P2P_STUN_SERVERS` — §15.4 não tem comando de settings para isso. Lacuna de spec | Onde a configuração mora. Definido isso, o comando de §15.4 e a tela são do agente | §17.2, §81.4 |
| B38 | **Máximo de participantes por canal de voz, escolhido por quem administra.** Os tetos de ocupação saíram do protocolo em §90 (eram números de política, e nenhum media máquina). O que faz sentido no lugar é **configuração de canal**: um campo opcional em `channel.create`/`channel.update`, aplicado pelo host no `voiceJoin` com erro nomeado. Precisa de campo no log (§6.6), superfície em §15.4 e a decisão de o que fazer com quem já está dentro quando o número baixa | O que acontece com quem já está dentro quando o número baixa — e o aval para mexer em §6.6 e §15.4, que são normativos | §90, §17.6, `deltas-ux-v2.md` U-09 |
| B37 | **Transmissões simultâneas sem teto.** O canal aceita várias telas (§87.4) e o custo é de quem assiste — download e decodificação multiplicam. Limite de máquina, não de protocolo; §17.5 é silenciosa e um número inventado seria medida que ninguém tomou | A medida em máquinas reais e, depois dela, a política. O agente monta o cenário; o número não sai de dentro do repositório | §87.5, §17.5 |
| B39 | **§17.5 é silenciosa sobre o áudio da transmissão de tela.** A seção descreve a estrela, os perfis e a saúde, e não diz se a tela leva som, de onde ele vem nem quem pode calá-lo. O produto o implementa como opt-in por fonte (`windowAudio: "window"` + `systemAudio: "exclude"` numa janela; som do sistema numa tela inteira), transmitido no mesmo `MediaStream` do vídeo, e sujeito ao surdo e ao volume por participante de §9 (2.3) | O texto normativo, e a decisão sobre o host ter ou não o que autorizar aqui. O comportamento já existe e está descrito; falta ser **declarado** | §17.5, `frontend/src/live/tela.ts` |
| B41 | **Nada no fio diz se uma trilha de vídeo é a tela ou a câmera.** Do mesmo par chegam as duas (§17.5 estrela e §17.2 malha) e §15.x não declara correlação entre um `MediaStream` e a sessão de tela — mesma família de lacuna de B14. O renderer decide por `classificarVideo` (`live/videoRecebido.ts`), a partir do `share.join` que ELE conseguiu; o que sobra é só a janela em que as duas começam juntas e a trilha da câmera chega primeiro | A forma da correlação em §15.5/§15.6 — é superfície de IPC, não detalhe de implementação | §94.1, §15.5, B14 |
| B13 | Prazo de `invite.resolve` × teto do IPC-R: desfecho certo seria `unreachable`, não `E_TIMEOUT` | O aval para trocar um código de erro de §15.x. A direção já está proposta na referência; falta virar normativa | §62.4 |
| B14 | Correlação `blob.progress` ↔ `AttachmentDto` não é declarada em §15.6 | A forma da correlação em §15.6 — é superfície de IPC, não detalhe de implementação | §58.6 |
| B15 | Divergências de aparência: `hostStatus` 9×3, tombstone, `hiddenByBan`, `clockSkewed`, `createdAt`/`description` sem fonte | Qual é a fonte de cada um desses estados. Hoje a UI mostra o que o mock inventou, e escolher a fonte é decisão de produto | §60.5 |
| B16 | Superfícies `dev.*` — decisão de produto | Se elas existem no produto, e para quem | §57.3 |

### Máquina, rede ou sessão que não existe aqui

| # | Item | O que só o humano tem | Referência |
|---|---|---|---|
| B40 | **Áudio de captura só existe no Windows, e a promessa "só desta janela" não foi medida.** O `audio: 'loopback'` do Electron é do Windows; no Linux a captura sobe muda e a UI diz isso. O recorte por janela é do Chromium (`GetDisplayMediaWindowAudioCapture`) e o pedido é feito, mas nada aqui mediu se ele é honrado | Uma máquina Windows, para conferir que o som transmitido é o do aplicativo e não o da máquina | `app/src/main/captura.ts`, B39 |
| B32 | **O portal PipeWire do Linux não foi exercitado.** Era "dois caminhos"; o do `useSystemPicker` saiu com o seletor de fonte do produto — o Electron só o usa quando `isDisplayMediaSystemPickerAvailable()` responde `true`, e quando usa **não chama o handler**, o que furava a ordem de `T-41`. Sobra o portal do Linux, que ainda só rodou no typecheck | Uma sessão gráfica Linux de verdade, com `xdg-desktop-portal` e gerenciador de janelas. Sob Xvfb o Chromium não enumera janela nenhuma, e `npm run smoke:captura` se declara **não medido** nesse cenário | §83.6, `app/src/main/index.ts` |
| B42 | **A câmera não foi vista entre duas máquinas.** O caminho existe e é o da voz — trilha de vídeo na mesma `RTCPeerConnection`, ligada e desligada em todos os pares (§93). O que não foi medido: imagem chegando de verdade, o custo da malha com várias câmeras ligadas ao mesmo tempo, e a oferta cruzada de §93.3 acontecendo em rede real em vez de em teste | Duas máquinas e duas câmeras. É a mesma prova que B28 e B31 deram para voz e tela | §93, `frontend/src/live/camera.ts` |
| B17 | Host de longa duração deixou de receber conexões (3h22 no smoke; voltou ao reiniciar) | Duas máquinas na DHT pública por horas. Não é observação que caiba num teste desta máquina | §63.4 |

## O agente pode fazer

### Bloqueia release

| # | Item | Referência |
|---|---|---|
| B1 | Addons Linux exigem glibc 2.34/2.33, acima do piso 2.31 de A16 — falta `build/Dockerfile` + `build/build-addons.sh`. O Docker desta máquina responde, então a imagem com o piso se monta e os nativos se recompilam aqui | `poc/poc-03-runtime/REPORT.md` §3.1 |
| B2 | 69 `.node` de plataformas fora da matriz viajam no instalador — é filtro de empacotamento, e o alvo Linux se constrói e se confere aqui | `poc/poc-03-runtime/REPORT.md` §3.5 |

### Caminho do produto, em ordem

| # | Item | Referência |
|---|---|---|
| B27 | Permissões TURN: `rosterAddresses` devolve vazio porque o roster guarda chaves e não endereços — falta a ponte par→endereço observado, que vem do transporte. Sem ela o caminho relayado não existe e a chamada só fecha em conexão direta | §17.3, `composition/media.ts` |
| B30 | **NAT simétrico / CGNAT sem caminho.** Com `srflx` o ICE fura na maioria dos NATs domésticos, mas simétrico dos dois lados não fura. Hoje cai em `conn-failed` nomeado (§80); a resposta da spec é o relay voluntário de §17.7. A implementação é daqui; a **prova** depende do CGNAT real de B4 | §17.7, L-11 |
| B7 | §18.4 lado do alvo: observar o próprio ban/kick e entrar em modo removed | §66.4 |
| B8 | U-17 — remover do rail comunidade encerrada em que ainda sou membro (atenuado, não fechado) | §58.6 |
| B9 | Residência `light` efetiva no projector | §57.3 |
| B10 | Barreira de replicação por confirmação de PARES (§18.7) | §57.3 |
| B11 | Sondas NAT/STUN | §57.3 |
| B12 | Busca: "Ver todos" expandir até 100 (`limitPerGroup` fixo) | §67.2 |

### A observar

Sintomas com repro possível nesta máquina: o próximo passo é investigar, não esperar.

| # | Item | Referência |
|---|---|---|
| B18 | Chips de reação otimistas através de respawn de epoch | §61.4 |
| B19 | Recarga da página não redeliveria a porta IPC-R (F5 do usuário) — o ciclo real roda em Electron sob Xvfb, como os smokes de `app/scripts` | §60.5 |

### Qualidade

| # | Item | Referência |
|---|---|---|
| B20 | Nenhuma tela tem teste de render | §58.6 |
| B21 | Metade da validação fora do alcance do teste de contrato | §58.9 |
| B22 | Migração entre modos do cofre não exercitada — os modos se forçam por `--password-store`, sem depender do chaveiro do sistema | §60.5 |

## Fora do v1

Nem uma coisa nem outra: ninguém executa enquanto o escopo não voltar a se abrir.

| # | Item | Referência |
|---|---|---|
| B23 | Conversa direta entre identidades, sem comunidade — forma em aberto | `adr-v2.md` A29 |
| B24 | Árvore de multicast — especificada e adiada | `adr-v2.md` A20, `backend-v2.md` §17.8 |
