# Backlog

O que está aberto, hoje. Uma linha por item: **nome e ponteiro**. A descrição mora na
referência — repetir aqui seria a segunda cópia a envelhecer.

Não normativo. Atualizado em 2026-09-01 (a conversa direta fechou a forma **e entrou no v1**
como a fase 11 de §29 — decisão do operador. B23 sai de "Fora do v1" e vira o caminho
B54..B62 e B65; do lado humano ficam só B63 — duas perguntas de navegação e política — e
B64, a rota de deep link para chave de identidade).

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
| B4 | G7 e G8 têm veredito `parcial`; os `openCriteria` exigem Electron empacotado, `tc/netem` e CGNAT real. **§99 preparou a medida**: o diagnóstico agora separa host-inalcançável de membro-sem-furo, e o prazo de `conn-failed` deixou de vencer antes de o `relay` poder existir — sem isso a medida mediria o relógio. O roteiro de duas máquinas está em §99.11 | As máquinas e a rede: host Windows e Linux de verdade, `NET_ADMIN` para o `tc/netem` e um link de operadora com CGNAT. O harness em si é do agente | §72.3, §99.11, `poc/poc-08-g7`, `poc/poc-09-g8` |

### Decisão de produto ou texto normativo

Nenhum destes é implementação parada: é a **spec que não responde**. Escrever comportamento
aqui sem decisão seria inventá-lo, que é o que `CLAUDE.md` proíbe.

| # | Item | O que só o humano tem | Referência |
|---|---|---|---|
| B43 | **Reentrada automática de voz pós-respawn/queda.** O núcleo reinicia no meio da chamada (epoch novo): o renderer re-assina eventos e re-consulta mensagens, mas a sessão de voz morre sem evento nenhum — o lado de cá continua mostrando a chamada de pé, surdo e mudo. §17.4 declara expressamente que **não decide** reentrada ("comportamento novo e precisa de emenda própria") | O texto normativo que decide a reentrada. Proposto: no resync de §15.2(4d) com chamada ativa, reexecutar o `voice.join` idempotente (nova sessão) — definido isso, a implementação é do agente | §97.4, §17.4 |
| B44 | **`voice.meshChanged` é um tópico morto.** Declarado em §15.5 ("falha assimétrica"), não tem produtor no núcleo nem consumidor no renderer — o renderer mede o par localmente por `connectionState`, que é melhor. É a família do defeito recorrente de §82.3: evento declarado, sem linha na tabela fechada de §16.3 | Remover do §15.5 ou ligar via §16.3 — mudança de superfície normative é do operador | §97.4, §15.5, §82.3 |
| B49 | **`voice.deviceError` sem produtor no núcleo.** Declarado em §15.5 (fecha `RT-10`) e agora com assinante na UI, mas ninguém o emite: a captura de dispositivo é do renderer, que conhece a falha direto pelo `DOMException` da própria captura | A forma: um produtor no núcleo (para que falha?) ou a remoção do tópico de §15.5 | §97.4, §15.5 |
| B29 | §17.2 diz "configurável" e não diz ONDE. Com o default ligado (§81.5) deixou de bloquear uso, mas desligar ou trocar o servidor ainda exige `P2P_STUN_SERVERS` — §15.4 não tem comando de settings para isso. Lacuna de spec | Onde a configuração mora. Definido isso, o comando de §15.4 e a tela são do agente. **Menos urgente depois de §99.13**: a coleta em duas fases faz o terceiro só ser consultado quando o host não resolve, então o default ligado deixou de significar "o terceiro vê o IP em toda chamada" | §17.2, §81.4, §99.13 |
| B38 | **Máximo de participantes por canal de voz, escolhido por quem administra.** Os tetos de ocupação saíram do protocolo em §90 (eram números de política, e nenhum media máquina). O que faz sentido no lugar é **configuração de canal**: um campo opcional em `channel.create`/`channel.update`, aplicado pelo host no `voiceJoin` com erro nomeado. Precisa de campo no log (§6.6), superfície em §15.4 e a decisão de o que fazer com quem já está dentro quando o número baixa | O que acontece com quem já está dentro quando o número baixa — e o aval para mexer em §6.6 e §15.4, que são normativos | §90, §17.6, `deltas-ux-v2.md` U-09 |
| B37 | **Transmissões simultâneas sem teto.** O canal aceita várias telas (§87.4) e o custo é de quem assiste — download e decodificação multiplicam. Limite de máquina, não de protocolo; §17.5 é silenciosa e um número inventado seria medida que ninguém tomou | A medida em máquinas reais e, depois dela, a política. O agente monta o cenário; o número não sai de dentro do repositório | §87.5, §17.5 |
| B39 | **§17.5 é silenciosa sobre o áudio da transmissão de tela.** A seção descreve a estrela, os perfis e a saúde, e não diz se a tela leva som, de onde ele vem nem quem pode calá-lo. O produto o implementa como opt-in por fonte (`windowAudio: "window"` + `systemAudio: "exclude"` numa janela; som do sistema numa tela inteira), transmitido no mesmo `MediaStream` do vídeo, e sujeito ao surdo e ao volume por participante de §9 (2.3) | O texto normativo, e a decisão sobre o host ter ou não o que autorizar aqui. O comportamento já existe e está descrito; falta ser **declarado** | §17.5, `frontend/src/live/tela.ts` |
| B41 | **Nada no fio diz se uma trilha de vídeo é a tela ou a câmera.** Do mesmo par chegam as duas (§17.5 estrela e §17.2 malha) e §15.x não declara correlação entre um `MediaStream` e a sessão de tela — mesma família de lacuna de B14. O renderer decide por `classificarVideo` (`live/videoRecebido.ts`), a partir do `share.join` que ELE conseguiu; o que sobra é só a janela em que as duas começam juntas e a trilha da câmera chega primeiro | A forma da correlação em §15.5/§15.6 — é superfície de IPC, não detalhe de implementação | §94.1, §15.5, B14 |
| B52 | **TURN sobre a conexão UDX que já atravessa — a resposta comum às três lacunas de B30.** O produto já mantém, entre cada membro e o host, um canal autenticado que atravessa NAT e CGNAT (é por ele que passa a sinalização de voz); §17.3 o ignora e pede ao renderer que abra um caminho novo pela via que não funciona. A proposta: TURN em `127.0.0.1` servido pelo núcleo local, encapsulado na UDX até o host. Endereço e credencial **deixam de existir** como problema, e o RTT para seleção já é observado. Custa um salto a mais, e faz o núcleo encaminhar ciphertext — o que muda o sentido de uma frase de §17.2 ("o núcleo nunca vê mídia"), embora não a propriedade (DTLS-SRTP segue ponta a ponta) | O aval para mexer em §17.2/§17.7 e a decisão sobre o custo do salto. A proposta está escrita e argumentada; falta ser decidida | §99, §17.7, B30 |
| B51 | **O serviço STUN/TURN do host é IPv4-only, e IPv6 é a travessia de CGNAT que não custa servidor.** `xorAddress` escreve família `0x01` fixa, o decodificador recusa `0x02`, o parser faz `split('.')` e a socket relayada abre `udp4`. A restrição não nasce ali: o endereço público vem de `dht.host`/`dht.port` do `hyperdht`, que é IPv4. Um par IPv6↔IPv6 já fecha sem nada disso — o que não existe é o host **servindo** em IPv6, e o Brasil passou de 50% de adoção | A decisão de escopo. **Verificado em §99**: `dht-rpc` fixa `family: 4` em `localIP()` e em `lookup()`, então servir em IPv6 exige mexer no transporte upstream — não é correção neste repositório | §99.5, L-15, §17.3 |
| B30 | **O voluntário de relay não tem endereço nem credencial no protocolo.** A parte implementável saiu em §95: consentimento persistido, kinds 60/61 no log, `DecisionState.relays` com entradas. O que sobra são **três decisões de protocolo**: §6.14 carrega chave/prazo/posse e nenhum endereço; §16.3 tem tabela fechada sem tópico de relay; e a credencial do TURN do host deriva do `hostTurnSecret`, que o voluntário não tem. "Seleção por menor RTT" pressupõe a lista de candidatos com endereço, que é o que falta | A forma dos três em §17.7/§16.3 — é superfície de protocolo, não detalhe de implementação. A **prova**, depois disso, continua dependendo do CGNAT de B4. **`B52` propõe uma resposta comum às três**, aproveitando a conexão UDX que já atravessa | §17.7, §6.14, §16.3, L-11, B52 |
| B13 | Prazo de `invite.resolve` × teto do IPC-R: desfecho certo seria `unreachable`, não `E_TIMEOUT` | O aval para trocar um código de erro de §15.x. A direção já está proposta na referência; falta virar normativa | §62.4 |
| B14 | Correlação `blob.progress` ↔ `AttachmentDto` não é declarada em §15.6 | A forma da correlação em §15.6 — é superfície de IPC, não detalhe de implementação | §58.6 |
| B15 | Divergências de aparência: `hostStatus` 9×3, tombstone, `hiddenByBan`, `clockSkewed`, `createdAt`/`description` sem fonte | Qual é a fonte de cada um desses estados. Hoje a UI mostra o que o mock inventou, e escolher a fonte é decisão de produto | §60.5 |
| B63 | **Duas decisões de navegação e política que a conversa direta não deriva.** (a) **Onde a DM mora**: o rail é a lista de comunidades (`AppShell`, `ChannelList`) e nada em §31 nem em `frontend.md` diz se a conversa é uma entrada no rail, uma visão de topo separada ou parte do hub. *Proposto: entrada no topo do rail, que troca a sidebar pela lista de conversas e o painel principal pela conversa — reusa o `AppShell` sem layout novo.* (b) **Notificação**: `settings.setNotifications` é por comunidade (`local_community_pref.notificationLevel`) e uma DM não tem uma. *Proposto: o flag global de `local_device_pref.notificationsEnabled` mais um silenciar por conversa, espelhando `local_channel_pref.muted`.* Não bloqueia B65; o resto de U-33 se escreve com este campo em aberto | A escolha entre as formas. As duas propostas estão escritas e nenhuma tem critério técnico que a decida — é preferência de produto | `frontend.md` §3.1, `backend-v2.md` §6.15, §31.16 |
| B64 | **Não há como trocar chave de identidade pela interface.** `dm.open` recebe um hex64 cru e a gramática de §3.5 é **fechada**, com duas rotas que não carregam identidade — então o único caminho para abrir uma conversa é colar 64 caracteres. Proposto: `comunidadep2p://u/<KEY64>`, com a regra 3 de §3.5 valendo igual (deep link nunca dispara ação, só posiciona a UI numa confirmação). Não bloqueia o v1; degrada a entrada | O aval para mexer numa gramática normativa fechada, e a decisão sobre a tela de confirmação. A proposta está escrita; falta ser decidida | §3.5, §31.16.1 |

### Máquina, rede ou sessão que não existe aqui

| # | Item | O que só o humano tem | Referência |
|---|---|---|---|
| B40 | **Áudio de captura só existe no Windows, e a promessa "só desta janela" não foi medida.** O `audio: 'loopback'` do Electron é do Windows; no Linux a captura sobe muda e a UI diz isso. O recorte por janela é do Chromium (`GetDisplayMediaWindowAudioCapture`) e o pedido é feito, mas nada aqui mediu se ele é honrado | Uma máquina Windows, para conferir que o som transmitido é o do aplicativo e não o da máquina | `app/src/main/captura.ts`, B39 |
| B32 | **O portal do Linux: o caminho existe, a travessia não foi medida.** O loop de duas caixas do portal foi achado em uso real e fechado em §96 — no Wayland o seletor do produto sai de cena e a caixa do sistema é a escolha, uma vez só. O que continua sem medida é a captura **subindo** por esse caminho: que a fonte concedida é a que a pessoa apontou no portal, e que a trilha chega ao outro lado | Uma sessão gráfica Linux de verdade, com `xdg-desktop-portal` e gerenciador de janelas. Sob Xvfb o Chromium não enumera janela nenhuma, e `npm run smoke:captura` se declara **não medido** nesse cenário | §96, §83.6, `app/src/main/captura.ts` |
| B42 | **A câmera não foi vista entre duas máquinas.** O caminho existe e é o da voz — trilha de vídeo na mesma `RTCPeerConnection`, ligada e desligada em todos os pares (§93). O que não foi medido: imagem chegando de verdade, o custo da malha com várias câmeras ligadas ao mesmo tempo, e a oferta cruzada de §93.3 acontecendo em rede real em vez de em teste | Duas máquinas e duas câmeras. É a mesma prova que B28 e B31 deram para voz e tela | §93, `frontend/src/live/camera.ts` |
| B17 | Host de longa duração deixou de receber conexões (3h22 no smoke; voltou ao reiniciar). §97 eliminou os acumuladores concretos encontrados (`#observados` sem poda, `unsub` IPC-R que matava assinatura viva) e ligou os knobs `P2P_TURN_*` ignorados — o sintoma continua exigindo a observação de longa duração | Duas máquinas na DHT pública por horas. Não é observação que caiba num teste desta máquina | §63.4, §97.4 |

## O agente pode fazer

### Bloqueia release

| # | Item | Referência |
|---|---|---|
| B1 | Addons Linux exigem glibc 2.34/2.33, acima do piso 2.31 de A16 — falta `build/Dockerfile` + `build/build-addons.sh`. O Docker desta máquina responde, então a imagem com o piso se monta e os nativos se recompilam aqui | `poc/poc-03-runtime/REPORT.md` §3.1 |
| B2 | 69 `.node` de plataformas fora da matriz viajam no instalador — é filtro de empacotamento, e o alvo Linux se constrói e se confere aqui | `poc/poc-03-runtime/REPORT.md` §3.5 |

### Caminho do produto, em ordem

**A conversa direta (§31), que é a fase 11 do v1.** B27, B11, B10, B7, B8 e B12 fecharam em
§95; B16 fechou por decisão do operador e B30 atravessou para o lado humano. O caminho ficou
vazio até 2026-09-01, quando o operador trouxe a DM para o v1 (A29, `backend-v2.md` §29).

A ordem abaixo **é a ordem**, e ela não é preferência: cada item só é testável depois do
anterior. **B55 é o gate** — reprovar nele reabre A29 (`plano-de-validacao-experimental-v2.md`
POC-14), e é por isso que ele vem antes de qualquer coisa que dependa do merge convergir.
B65 escreve o delta de UX e B60 constrói as telas; do lado humano sobra só B63, que são
duas perguntas de navegação e política — e nem elas param B65, que deixa o campo em
aberto. B61 e B62 herdam fase 6 e G7/G8, que já existem.

| # | Item | Referência |
|---|---|---|
| B54 | **`dmCodec` e `dmFold`, L1 puros.** Envelope e registry de `DM_VERSION = 1`; os 6 `kind`s; o merge por soma de relógio vetorial de duas posições; o pipeline de 13 estágios; RD-1..RD-11; os quatro `DmEffect`. Sem rede, sem banco, sem relógio — é o que torna B55 possível | §31.4, §31.5, §31.6, §31.7 |
| B55 | **G14 — `poc/poc-14-g14`.** As cinco medidas de §31.26: determinismo do merge sob ordens de entrega permutadas, totalidade sob fuzzer, convergência após partição, detecção de core encurtado antes do append, e ausência de fork sob `SIGKILL`. **Bloqueia B56 em diante** | `plano-de-validacao-experimental-v2.md` POC-14, §31.26 |
| B56 | **`dmProjector` e a persistência.** As três tabelas de `manifest.db` e as seis de `view.db`; snapshot por `ord_sum` com `fold_build_id`; a reinterpretação por inserção retroativa e o `dm.reordered` que ela emite; a barreira `view.db` → `manifest.db` → eventos | §31.12, §31.13 |
| B57 | **`directMessages` (L2).** Derivação de `conversationId`, do core e da chave de conteúdo; `self_high_water` gravado **antes** de cada append e a detecção de `desynced`; os cinco estados de conversa; aceite, bloqueio silencioso e a política local de contato | §31.2, §31.3, §31.9, §31.13 |
| B58 | **`p2p-dm/1`.** `dmHello` com prova de posse e conferência do `conversationId` contra a `remotePublicKey`; `autorizaDm` canal a canal; replicação dos dois cores no mesmo mux; os tetos de admissão e o `dm.typing` efêmero | §31.8, §31.18 |
| B59 | **Superfície IPC-R.** Os 14 comandos, os 12 eventos e as 5 queries, com o cursor por `(ordSum, authorKey, id)`. `dm.send` responde **síncrono** com o registro já no log — é a terceira classe de escrita de §31.10, e o cliente de IPC do renderer precisa refletir isso | §31.16, §31.10 |
| B65 | **Escrever U-33 em `deltas-ux-v2.md`.** A superfície de DM na forma de U-16/U-17 (Onde / Hoje / Muda para / Por quê), derivada do que §31 já fixa: os cinco estados de conversa, o pedido não aceito, os rótulos de entrega — que **não podem** afirmar a causa (L-26, L-28) —, a marca de ordem provisória (L-27), o texto de esquecer (L-25) e o de voz sem relay (L-29). Cinco dessas superfícies **já são obrigatórias por norma** em §31.24: não são escolha, são requisito. O campo "onde mora" fica em aberto apontando para B63 | §31.16, §31.24, `deltas-ux-v2.md` |
| B60 | **UI da conversa direta.** Lista, pedidos, bloqueio, "não entregue", ordem provisória, recarga por `dm.reordered`. Reusa `components/ui` e `components/shell`; verifica com `npm run build`, `npm run lint` e Vitest. Depende de **B65**; a colocação final na navegação depende de **B63(a)**, e até lá vale a proposta declarada lá | §31.16, B65, B63 |
| B61 | **Anexos em conversa direta.** `ns/dmblobs/1`, RD-11 e o reuso de §13 sem alteração. Herda a fase 6, que já existe | §31.14 |
| B62 | **Mídia em conversa direta.** Sinalização pelo próprio `p2p-dm/1` (sem host encaminhando), sem ticket, STUN/TURN simétrico com `ns/dmturn/1`. Herda G7/G8 | §31.15 |

### Bloqueado por medida

Nem humano nem agente: é implementável aqui, e a **justificativa** é hipótese que ninguém
mediu. Implementar antes da medida é pagar o custo sem saber se há ganho.

| # | Item | O que destrava | Referência |
|---|---|---|---|
| B46 | **Teto de conexões do host.** O escalonador de §14.2 (`allocateForCommunities`) é código sem chamador, e o `maxPeers` que o backend de hyperswarm aceita nunca é passado — conexões sem teto num host de longa duração é o candidato estrutural de B17. O número é política de capacidade sem medida nenhuma | A medida em máquina real (quantas conexões o host sustenta com o gasto de memória/CPU medido); depois dela, o valor e onde a política mora | §97.4, §14.2, `poc/poc-03-runtime/REPORT.md` |
| B9 | Residência `light` efetiva no projector. Exige um `MessageLookup` injetado no `fold` — que hoje não existe — e mexe na assinatura do módulo mais puro e mais testado do sistema, com o teste de determinismo de §28.4 no caminho | A medida de G9. §8.1 estima 24 MiB por 200 mil mensagens e marca "a medir em G9"; nada mais no caminho depende disto | §8.1, §57.3 |

### A observar

Sintomas com repro possível nesta máquina: o próximo passo é investigar, não esperar.

| # | Item | Referência |
|---|---|---|
| B48 | Fila de karaokê pós-respawn do host: a fila é efêmera (§6.16) e ninguém a re-anuncia — quem estava no turno fica "todos mudos" sem evento nomeado explicando. Repro: respawn do núcleo host com canal em modo fila | §97.4, §6.16, §16.4 |
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
| B24 | Árvore de multicast — especificada e adiada | `adr-v2.md` A20, `backend-v2.md` §17.8 |
