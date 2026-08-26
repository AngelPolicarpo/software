# Deltas de UX/UI exigidos pela arquitetura v2

> **Papel deste documento.** A arquitetura v2 (`backend-v2.md`) mantém quase toda a
> experiência descrita em `docs/frontend.md`, mas exige mudanças de produto em pontos
> específicos. Este documento é a **lista completa e fechada** dessas mudanças, e a
> resolução dos 117 comportamentos da matriz de rastreabilidade.
>
> **Precedência.** Onde este documento e `docs/frontend.md` discordarem, **este vence**.
> `docs/frontend.md` continua válido em tudo que não está aqui.
>
> **Comparação com v1.** A §25 de `docs/backend.md` (v1) listava 12 deltas. A auditoria de
> rastreabilidade mostrou que sobravam 21 divergências das classes `CONTRADICTORY` e
> `MISSING` sem delta correspondente. Este documento tem **29 deltas** e cobre todas.
>
> **Regra de completude:** toda limitação declarada em `backend-v2.md` §25.8 (L-1 a L-22)
> tem uma superfície de UI obrigatória. Um delta que some daqui sem que a limitação
> correspondente saia de §25.8 é regressão.

---

## 1. Deltas, por classe

### 1.1 Mudanças de escopo de produto (alteram o que o produto faz)

---

**U-01 — Backup e restauração de identidade passam a existir**

| | |
|---|---|
| **Onde** | `frontend.md` premissa 3; §10 (3.1 Configurações de conta) |
| **Hoje** | "Identidade é local a um dispositivo. Sem backup/export/import de chave." |
| **Muda para** | Existe **exportar identidade** (arquivo cifrado por frase secreta) e **importar identidade** (só em instalação sem identidade). Multi-dispositivo continua fora do v1. |
| **Por quê** | `T-43`: sem isso, perder a máquina é perder permanentemente toda comunidade hospedada. O ARB classificou como limitação de produto **não aceita**. `adr-v2.md` A24. |
| **Telas novas** | 3.1 → Identidade: "Fazer backup da identidade" (com aviso de que a frase secreta não tem recuperação) e, na Camada 0, uma terceira porta de entrada em 0.1: "Restaurar identidade a partir de um backup". |
| **Texto obrigatório** | "Se você perder este arquivo **e** a frase secreta, a identidade não pode ser recuperada. Não existe conta, não existe servidor, não existe 'esqueci minha senha'." E: "Usar a mesma identidade em dois computadores ao mesmo tempo, hospedando a mesma comunidade, corrompe a comunidade." |

---

**U-02 — Um único eixo otimista: só mensagem é otimista**

| | |
|---|---|
| **Onde** | `frontend.md` §9 (2.1), §17 (microinterações), §12 (estados transversais) |
| **Hoje** | A Camada 2 inteira é otimista: reagir, fixar, editar e criar thread respondem na hora. |
| **Muda para** | **Otimista, com fila durável:** `enviar`, `editar`, `deletar`, `fixar`, `reagir`, `criar thread`. Estes vão para a fila e mostram estado de entrega. **Confirma-depois-desenha:** tudo de estrutura, cargo, moderação, comunidade e convite. Estes exigem host online, mostram estado de carregamento no controle acionado, e **não** enfileiram. |
| **Por quê** | `F-15`: em v1, reagir/editar/fixar/thread eram RPCs síncronos de 30 s contra uma UI otimista, **sem rollback especificado**. Ou tudo tem fila, ou nada é otimista. `adr-v2.md` A25. |
| **Consequência visível** | O chip de reação passa a ter o mesmo ciclo de entrega da mensagem (pendente → entregue → falhou), em vez de "saltar" e talvez sumir. Com host offline, os botões de estrutura ficam desabilitados com tooltip — o que a spec já faz para canais (`frontend.md:791`) e agora vale para cargos, categorias e moderação. |

---

**U-03 — O preview de convite tem seis desfechos, não quatro**

| | |
|---|---|
| **Onde** | `frontend.md` 0.3; §2 (`InvitePreview`); `frontend/src/domain/types.ts:236-240` |
| **Hoje** | `ok`, `invalid`, `banned`, `already-member`. |
| **Muda para** | Acrescenta `unreachable` (host offline) e `ended` (comunidade encerrada), com telas distintas de `invalid`. |
| **Por quê** | `RT-01`: um convite **perfeitamente válido** era acusado de inválido quando o host estava offline. É o oposto do princípio 3. |
| **Texto obrigatório** | `unreachable`: "Não foi possível falar com quem hospeda esta comunidade agora. O convite pode estar bom — tente de novo mais tarde." Com botão "Tentar novamente". `ended`: "Esta comunidade foi encerrada." |

---

**U-04 — A lista de convites não mostra o código de convites de terceiros**

| | |
|---|---|
| **Onde** | `frontend.md` 3.1b (lista de convites ativos) |
| **Hoje** | A tabela mostra o código de todos os convites ativos, com "copiar link". |
| **Muda para** | Mostra o código **apenas** dos convites criados nesta instalação. Nos demais, a coluna exibe "código não disponível neste dispositivo" e a ação de copiar fica indisponível; todo o resto (quem criou, usos, expiração, revogar) continua. |
| **Por quê** | `F-21`: o segredo do convite nunca entra no log — se entrasse, qualquer membro poderia emitir convite em nome de outro. Não há solução criptográfica para o contrário. `adr-v2.md` A08. |
| **Texto obrigatório** | "Só quem criou um convite consegue ver o código dele. Isso é o que impede alguém de emitir convites em nome de outra pessoa." |

---

**U-05 — Convite: entropia, formato e ausência de aprovação manual**

| | |
|---|---|
| **Onde** | `frontend.md` §2 (dataset), 0.3, 3.1b, §13 |
| **Hoje** | Código de 6 caracteres (`X7K2QM`); o formulário valida só "inteiro ≥ 1" no limite de usos. |
| **Muda para** | Código de **16 caracteres** em 4 grupos (`X7K2-QM9F-RT4B-N8ZP`), alfabeto Crockford Base32. O formulário valida inline `maxUses` 1..10000 e expiração entre 1 minuto e 365 dias. O texto declara que **não há aprovação manual**: a mitigação de link vazado é revogar. |
| **Por quê** | 6 caracteres (~30 bits) é força bruta viável contra um tópico anunciado em DHT. `RT-12` para os limites. |

---

**U-06 — "Avisar quem está online" ao sair como host deixa de existir**

| | |
|---|---|
| **Onde** | `frontend.md` §10 (3.5, aviso de saída do host) |
| **Hoje** | O modal oferece postar uma "mensagem de sistema" no canal padrão de cada comunidade afetada. |
| **Muda para** | A opção é removida. O modal passa a mostrar, além de quantas pessoas caem, **quantas operações ainda não replicaram**, e o app aguarda a barreira de replicação (até 5 s) antes de fechar. |
| **Por quê** | `F-43`: a mensagem era appendada e o host desligava em seguida — quase certamente antes de ela replicar, então ninguém a receberia. `RT-13`: "mensagem de sistema" não existe no modelo de domínio, e inventar um tipo só para isso é pior do que remover. `backend-v2.md` §18.7. |
| **Texto novo** | "Fechar agora desconecta 12 pessoas. 3 operações ainda estão sendo enviadas para outros dispositivos — aguarde alguns segundos para não perdê-las." |

---

**U-07 — O log de auditoria é confidencialidade local, não segredo**

| | |
|---|---|
| **Onde** | `frontend.md` §10 (3.3), permissão `ver log de auditoria` |
| **Muda para** | A tela passa a declarar que a permissão controla **o que a interface mostra**, e que o dado replicado está no dispositivo de todo membro. |
| **Por quê** | `T-44`, `DR-25`: com replicação integral, `view_audit_log` não pode ser segredo criptográfico. Fingir o contrário é a desonestidade que o princípio 3 proíbe. |
| **Texto obrigatório** | "Esta permissão controla quem vê o log nesta interface. Como cada membro guarda uma cópia da comunidade, ela não é um segredo técnico." |

---

**U-08 — "Silenciar nesta chamada" é conselho; "remover da chamada" é enforcement**

| | |
|---|---|
| **Onde** | `frontend.md` §8 (1.4, popover de perfil), §9 (2.3) |
| **Hoje** | "Silenciar nesta chamada" aparece como ação de moderação com `voice_mute_others`. |
| **Muda para** | Duas ações distintas e visualmente distintas: **"Silenciar nesta chamada"** (cooperativa, reversível, com o aviso de que depende do cliente do outro) e **"Remover da chamada"** (efetiva: o host revoga o ticket de mídia e a conexão cai). |
| **Por quê** | `T-40`: quem controla o microfone é quem o possui. `adr-v2.md` A22 dá o mecanismo efetivo. |
| **Texto obrigatório** | Ao silenciar: "Isso pede ao aplicativo da pessoa para silenciar. Para interromper de fato, use 'Remover da chamada'." |

---

**U-09 — Compartilhamento de tela tem teto de 8 espectadores no v1**

| | |
|---|---|
| **Onde** | `frontend.md` §9 (2.4), §18 (edge cases) |
| **Hoje** | Estrela até 5, árvore acima disso, até 200 espectadores. |
| **Muda para** | **Estrela até 8 espectadores. Não há árvore no v1.** O 9º recebe um estado nomeado ("A transmissão está no limite de 8 espectadores"). O teto é exibido no painel do apresentador. |
| **Por quê** | `adr-v2.md` A19/A20: a árvore depende de forwarding opaco cifrado, handshake de aresta, ACK de atribuição e reparo — nada disso especificado nem medido em v1. O desenho está fechado em `backend-v2.md` §17.8 e bloqueado por POC-09. |
| **Ganho colateral** | Como a estrela é WebRTC direto, **o atraso de 1–2 s da árvore some**, e o delta 3 de v1 deixa de ser necessário. Quando a árvore entrar, o delta volta (U-14). |

---

**U-25 — Os controles da transmissão são de quem transmite; o espectador só oculta o vídeo**

| | |
|---|---|
| **Onde** | `frontend.md` §9 (2.4) "Ações"; `frontend.md` observação "Qualidade é de quem assiste"; `backend-v2.md` §17.5 |
| **Hoje** | O seletor de qualidade aparece para **os dois papéis**, com a justificativa de que "ajustar a própria recepção não afeta ninguém". |
| **Muda para** | **Apresentador:** resolução, taxa de quadros e perfil de qualidade — presets e personalizado. **Espectador:** um controle só, "Ocultar vídeo"/"Mostrar vídeo", que para a exibição **local**. |
| **Por quê** | A justificativa antiga é falsa em estrela. Não existe "própria recepção" para ajustar: o perfil de §17.5 é aplicado no `RTCRtpSender` **do apresentador**, então o pedido do espectador gasta o upload de outra pessoa — 8 espectadores em `high` são 20 Mbps de subida numa máquina que não tinha como recusar. É também quem apresenta que vê o que está capturando e sabe se o caso pede texto legível ou movimento fluido. |
| **O que não muda** | A **degradação automática por perda** continua sendo do sistema, por espectador e só para baixo (§17.5): é ela que protege quem assiste numa conexão ruim, e ela nunca precisou de comando. |
| **Telas** | 2.4 ganha o popover "Transmissão" (só para quem apresenta) com os três grupos; o espectador ganha o botão de olho e, com o vídeo oculto, o lugar do vídeo diz "Vídeo oculto — {apresentador} continua transmitindo, só você deixou de ver". |
| **Texto obrigatório** | Ocultar **não** pode ser descrito como "pausar a transmissão" nem "sair da transmissão": as duas coisas afetariam outra pessoa, e esta não afeta. |

---

**U-10 — ~~Compartilhamentos simultâneos no mesmo canal saem do escopo~~ — REVOGADA em 2026-08-26**

| | |
|---|---|
| **Onde** | `frontend.md` §18, edge case 4 |
| **Status** | **Revogada.** O canal aceita **várias transmissões ao mesmo tempo**, uma por apresentador. A UX original de §18 (grade de tiles grandes) volta a valer. |
| **Por que foi revogada** | O "por quê" original não era engenharia: `RT-06` era uma **contradição entre documentos** — a UX pedia várias, o backend de v1 fixava `0..1`, o mock não implementava nenhuma — e a resolução escolheu o que já estava escrito. Não havia restrição por baixo: em estrela, a trilha de tela **pega carona na conexão de voz que já existe** entre cada par, então um segundo apresentador não abre malha nova; e o upload não compõe, porque cada apresentador serve a própria estrela da própria máquina. `SHARE_MAX_VIEWERS` é por sessão. |
| **O que ficou** | `E_ALREADY_SHARING` recusa a **segunda sessão da mesma pessoa** no mesmo canal — não é regra de protocolo, é o renderer: a captura de tela de uma instalação é uma só. |
| **Custo declarado** | Download e decodificação multiplicam por transmissão simultânea, no lado de quem assiste. É limite de máquina, não de protocolo, e não tem teto declarado — registrado como pendência em vez de inventar um número. |

---

**U-11 — Estados de sistema que não tinham tela**

| | |
|---|---|
| **Onde** | `frontend.md` §12 (estados transversais), §5.4 (paletas semânticas) |
| **Faltam** | (a) reprojeção longa com barra de progresso; (b) núcleo reiniciando após crash; (c) cliente desatualizado (somente-leitura numa comunidade); (d) swarm degradado (sem bootstrap/pares) — **diferente** de host offline; (e) replicação atrasada/parada; (f) comunidade encerrada em modo histórico; (g) comunidade em fork. |
| **Muda para** | Sete estados nomeados, com token de cor próprio. `swarm-degraded` e `client-outdated` **não** podem reusar o token de `host-offline`: são causas diferentes com ações diferentes. |
| **Por quê** | `F-17`, `DS-11`, `RT-11`, e as 8 capacidades de backend sem UX da matriz §4.4. |

---

**U-12 — Espectador de tela é participante do canal de voz**

| | |
|---|---|
| **Onde** | `frontend.md` §2 (dataset de referência), fixture `TELA-04` |
| **Hoje** | A fixture tem 7 espectadores num canal de voz com 3 participantes, e `frontend.md:1459` afirma "espectador ≠ participante". |
| **Muda para** | **Espectador é participante.** Não existe audiência fora da chamada. A fixture precisa ter espectadores ⊆ participantes. |
| **Por quê** | `F-18`: a contradição estava entre a UX, o backend e o código, e nenhum dos três cedia. v2 fecha do lado do backend e a fixture segue. |

---

**U-13 — Consentimento de relay voluntário é uma superfície nova**

| | |
|---|---|
| **Onde** | `frontend.md` §10 (3.1 → Rede) |
| **Muda para** | Nova seção "Ajudar outros a se conectarem", com: explicação do que é relay, o que o voluntário **vê** (volume e temporização — não conteúdo) e o que ele **não vê**; cota de banda; botão para ativar/desativar; e um indicador de quanto foi retransmitido. |
| **Por quê** | Usar o upload de alguém para tráfego que **não é** da chamada dela exige pedir. `adr-v2.md` A21, L-14. |
| **Texto obrigatório** | "Quem retransmite não consegue ler nada do que passa: áudio e vídeo são cifrados entre as duas pontas. Mas consegue ver **com quem** você fala, **quando** e **quanto**." |

---

**U-14 — Atraso da árvore (só quando a árvore entrar)**

| | |
|---|---|
| **Onde** | `frontend.md` §9 (2.4) |
| **Muda para** | Quando a árvore for habilitada (pós-POC-09), a interface precisa admitir que espectadores em nível ≥ 2 ficam **1–2 s atrás**, somando por nível. É broadcast, não chamada. |
| **Status** | **Não se aplica ao v1** (U-09). Registrado para não se perder. |

---

**U-15 — Ban oculta mensagens de forma reversível**

| | |
|---|---|
| **Onde** | `frontend.md` §10 (3.3), fluxo D12 |
| **Hoje** | O texto sugere remoção permanente das mensagens do banido. |
| **Muda para** | Revogar o ban **reexibe** as mensagens. O modal de confirmação diz isso. |
| **Por quê** | `backend-v2.md` §18.2. |

---

**U-16 — Ser expulso ou banido tem uma tela**

| | |
|---|---|
| **Onde** | `frontend.md` §12; novo estado na Camada 1 |
| **Hoje** | Não existe. O app do alvo simplesmente pararia de funcionar naquela comunidade. |
| **Muda para** | Ao observar o próprio ban/kick, a comunidade entra em **modo histórico somente leitura**, com um cabeçalho nomeado dizendo o que aconteceu, quem fez e o motivo (quando houver), e por quanto tempo a cópia local será mantida (7 dias) com opção de apagar agora. |
| **Por quê** | `F-35`, `DR-35`: o ciclo de vida do dado no cliente do alvo não existia. `backend-v2.md` §18.4. |

---

**U-17 — Comunidade encerrada tem aparência definida**

| | |
|---|---|
| **Onde** | `frontend.md` §10 (3.1b) e rail |
| **Hoje** | A UX especifica **encerrar**, mas não como a comunidade encerrada aparece depois. |
| **Muda para** | Permanece no rail, em modo histórico legível, com ícone esmaecido e cabeçalho "Esta comunidade foi encerrada em <data>". Sem composer, sem ações de escrita. Opção de removê-la do rail. |

---

**U-18 — Sucessão de host é uma tela nova, com limitação declarada**

| | |
|---|---|
| **Onde** | `frontend.md` §10 (3.1b, novo bloco) |
| **Muda para** | Três superfícies: (a) o host designa até 5 sucessores em ordem de prioridade; (b) o sucessor, após 30 dias de inatividade do host, recebe a oferta de assumir; (c) depois de assumir, uma lista de **reentradas pendentes** — quem da comunidade original ainda não entrou na continuação —, com o convite a distribuir e o estado de cada pessoa. |
| **Texto obrigatório** | "Assumir cria uma continuação da comunidade: canais, cargos e moderação são preservados. **As pessoas precisam entrar de novo** — cada uma entra com a própria chave, por convite, e recebe os cargos que tinha. **O histórico de mensagens permanece na comunidade original** e continua acessível para quem já o tem." |
| **Por quê** | `T-43` na parte de continuidade. `adr-v2.md` A23 e a emenda de 2026-08-22 (`ACHADO-G12-01`), L-15, L-23, `backend-v2.md` §18.8.1. |

---

**U-19 — Editar não apaga o conteúdo anterior**

| | |
|---|---|
| **Onde** | `frontend.md` §9 (2.1, editar mensagem) |
| **Muda para** | A interface não promete que a versão anterior desaparece. O conteúdo antigo fica no log e é recuperável por quem inspecionar a cópia da comunidade. |

---

**U-20 — Deletar não apaga os bytes**

| | |
|---|---|
| **Onde** | `frontend.md` §9 (2.1); D12 |
| **Hoje** | "Removida para todo mundo. Não pode ser desfeito." |
| **Muda para** | Mesma nota de honestidade que a exclusão de canal já tem: some da interface de todo mundo ao sincronizar; os bytes continuam no registro da comunidade. |

---

**U-21 — Configuração de rede não padrão é visível**

| | |
|---|---|
| **Onde** | `frontend.md` §10 (3.1 → Rede) |
| **Muda para** | Quando `P2P_BOOTSTRAP`, `P2P_STUN_SERVERS` ou `P2P_DATA_DIR` estiverem fora do default, a tela exibe um indicador permanente: "Configuração de rede não padrão ativa", listando quais. |
| **Por quê** | `T-22`: configuração sem integridade permite eclipse do DHT e vazamento de IP. Se não dá para impedir, tem que ficar visível. |

---

**U-22 — Divergência entre confirmação e histórico é visível**

| | |
|---|---|
| **Onde** | `frontend.md` §10 (3.1 → Rede) |
| **Muda para** | Se o host confirmar operações que não aparecem no histórico replicado, a tela mostra: "Quem hospeda confirmou N operações suas que não aparecem no histórico da comunidade." |
| **Por quê** | `backend-v2.md` §25.6 — é a única detecção possível de censura por omissão, e escondê-la contradiz o princípio 3. |

---

**U-23 — Auto-save vira salvamento explícito**

| | |
|---|---|
| **Onde** | `frontend.md` §13 (formulários), 3.1b, 3.2, 3.4 |
| **Hoje** | Auto-save com debounce de 800 ms nos formulários de comunidade, canal e cargo, com toast "Alterações salvas". |
| **Muda para** | Botão **"Salvar alterações"** com estado sujo, desabilitado quando não há mudança, e estado de carregamento durante o envio. Desabilitado com tooltip quando o host está offline. |
| **Por quê** | `F-12`: auto-save de 800 ms contra uma operação síncrona, num log append-only, com rate limit de 20/60 s, produz uma operação por tecla e queima o limite. Não é ajuste de debounce: é incompatibilidade de modelo. |

---

**U-24 — Preferências passam a ser lidas do backend**

| | |
|---|---|
| **Onde** | `frontend.md` §10 (3.1 → Dispositivos, Notificações), rail |
| **Hoje** | As telas escrevem preferências e o mock as guarda no renderer. |
| **Muda para** | Ao abrir 3.1, os valores vêm de `query.preferences`. O rail lê `notificationLevel` para decidir traço e badge. |
| **Por quê** | `RT-02`: escrita sem leitura — quatro superfícies exibiam dado sem fonte. |

---

**U-25 — A migração para Electron é trabalho reconhecido**

| | |
|---|---|
| **Onde** | `frontend.md` premissa 1; §4 (navegação) |
| **Hoje** | Premissa 1 diz que o mock é web e que shell de desktop "aparece só como nota de compatibilidade futura". A spec de v1 dizia que substituir fixtures "não toca componente nenhum". |
| **Muda para** | A plataforma-alvo do v1 é **Electron empacotado**, na matriz fechada de A16. A migração inclui: shell, `MemoryRouter`, CSP sem `unsafe-inline` e sem host externo, `contextIsolation`/`sandbox`, empacotamento, assinatura e deep links. Isso **é** trabalho de frontend, e precisa estar no plano. |
| **Por quê** | `DR-02`. |

---

**U-26 — Não há descoberta LAN**

| | |
|---|---|
| **Onde** | `frontend.md` §10 (3.1 → Rede), §12 |
| **Muda para** | Declarar que dois dispositivos na mesma rede, sem internet, **não** se encontram. O produto depende do DHT. |

---

**U-27 — "Invisível" é invisibilidade na interface, não anonimato de rede**

| | |
|---|---|
| **Onde** | `frontend.md` §8 (1.4, seletor de presença), §10 (3.1 → Rede) |
| **Hoje** | "Invisível" é apresentado como equivalente a estar offline para os outros. |
| **Muda para** | Continua verdadeiro **na interface**: quem está invisível não publica presença e aparece como offline. Mas o endereço continua sendo anunciado no DHT e é observável por quem participa dos mesmos tópicos. |
| **Por quê** | `T-24` / `L-20`. Prometer anonimato de rede que a arquitetura não entrega contradiz o princípio 3. |
| **Texto obrigatório** | "Invisível esconde você da lista de membros. Ele **não** esconde que este computador está conectado à comunidade — isso é visível para quem participa da mesma rede de distribuição." |

---

**U-28 — O que está em claro no disco**

| | |
|---|---|
| **Onde** | `frontend.md` §10 (3.1, nova seção "Privacidade") |
| **Hoje** | A UX não fala do assunto. |
| **Muda para** | Uma seção curta declarando que **só a chave privada e as sementes são cifradas em repouso**: mensagens, nomes, anexos e a cópia da comunidade ficam em claro no disco. |
| **Por quê** | `T-36` / `L-21`. Cifrar o banco inteiro exigiria uma senha mestra, que reintroduz "esqueci minha senha" num produto sem servidor — a decisão é **não** cifrar e **dizer**. |
| **Texto obrigatório** | "As comunidades ficam salvas neste computador sem criptografia adicional. Quem tiver acesso a este usuário do sistema consegue ler o histórico. Sua chave de identidade, essa sim, fica protegida pelo cofre do sistema operacional." |

---

**U-29 — Sair da comunidade com o host offline sai localmente, mas os outros podem não saber**

| | |
|---|---|
| **Onde** | `frontend.md` §10 (3.1b, sair da comunidade); §15 (confirmações) |
| **Hoje** | A confirmação de saída não distingue host online de offline. |
| **Muda para** | A saída tem efeito local imediato nos dois casos. Com o host offline, a confirmação avisa que o aviso de saída só chega aos outros quando o host voltar. |
| **Por quê** | `L-22`: `member.leave` é a única op de não-mensagem que enfileira, porque o efeito local não depende do host. Se o host nunca voltar, os demais continuam vendo a pessoa no roster. |
| **Texto obrigatório** | (host offline) "Você vai sair agora neste computador. Como quem hospeda está offline, as outras pessoas só vão ver sua saída quando ela voltar." |

---

**U-30 — O seletor de emoji vira o ponto de aplicação de "uma reação = um emoji"**

| | |
|---|---|
| **Onde** | `frontend.md` §9 2.1 (reações) e §6 (composer); `backend-v2.md` §8.6 (`Reaction.emoji`, `Community.iconEmoji`) |
| **Hoje** | O seletor "não tem spec própria", e §9 2.1 só o descreve como "curado, sem dependência nova nem busca — mesma postura das 7 cores de cargo (§5.4)". O catálogo nunca foi enumerado. A garantia de que uma reação é **um** emoji vinha do `fold`, que recusava tudo que não fosse exatamente **1 grafema**. |
| **Muda para** | O catálogo curado passa a ser **normativo e enumerado**, e é a **única** origem de `emoji` que a interface submete em `reaction.set` e em `community.create`/`community.update` (`iconEmoji`). Não há campo livre, não há busca, não há catálogo completo do sistema — a mesma postura das 7 cores de cargo. |
| **Por quê** | `RISCO-01`: contar grafema dentro do `fold` tornava a interpretação do log função da versão de ICU do runtime, o que §1.5 proíbe. §8.6 passou a contar **code points**, e com isso o `fold` deixou de julgar "emoji-ness": ele aplica tetos determinísticos (1–8 code points, ≤ 32 bytes) e aceitaria `ab` como reação. A garantia migrou para a UI — e garantia sem ponto de aplicação declarado não é garantia. |
| **Catálogo (v1)** | 👍 ❤️ 😂 🎉 🚀 👀 🔥 ✅ 🙏 💡 😅 😮 😢 🤔 👏 💯 🐛 🛠️ 📌 ⚡ 🥳 🤝 ☕ 🌙 — 24 entradas distintas. Medido: máximo de **2 code points** e **7 bytes** por entrada (`❤️` e `🛠️` carregam `U+FE0F`), todas dentro do limite de §8.6. |
| **Renderização** | O chip renderiza **o que está no log**, não o que está no catálogo. Outra réplica pode ter appendado qualquer string dentro do limite de §8.6, o `fold` a aceita, e esconder estado aceito criaria divergência entre o que a réplica sabe e o que ela mostra. A UI não substitui, não trunca o valor e não quebra o layout: o chip tem largura máxima e o excedente é elidido visualmente. |
| **Não é constante de protocolo** | O catálogo **não** entra em §27.1. Ele não decide se uma op tem efeito — quem decide são os tetos de §8.6 —, então acrescentar ou remover emoji é decisão de produto, sem bump de `opVersion` e sem plano de compatibilidade. Duas instalações com catálogos diferentes interoperam: cada uma oferece o seu e ambas renderizam o do log. |

---

**U-31 — macOS sai da matriz de plataforma, e isso é dito**

| | |
|---|---|
| **Onde** | `frontend.md` §10 (3.1, "Sobre"); página/tela de download ou primeira execução; `adr-v2.md` A16 |
| **Hoje** | A UX supõe a matriz de quatro alvos de A16 (Windows x64, macOS arm64, macOS x64, Linux x64) e não fala de plataforma em lugar nenhum. |
| **Muda para** | O v1 roda em **Windows x64 e Linux x64 (glibc ≥ 2.31)**. macOS, Alpine/musl e ARM Linux ficam **fora de suporte**, declarado onde alguém possa tentar instalar. Como não sobrou alvo arm64, **não existe build para Apple Silicon nem para Linux ARM** — e não existe build "não suportado, use por sua conta": não existe build. |
| **Por quê** | A16, 2026-08-16: decisão de escopo, não resultado de gate. Sem máquina Apple não há como produzir nem manter a evidência que G0 exige — build empacotado, assinado, notarizado, 100 cold starts, crash e restart. Anunciar um alvo que ninguém consegue testar é exatamente o que a matriz fechada existe para impedir. |
| **Texto obrigatório** | "Este aplicativo roda em Windows e Linux. Não há versão para Mac." — sem "ainda", sem "em breve" e sem lista de espera, enquanto não houver máquina para sustentar o alvo. |
| **O que não muda** | Nada do produto. macOS nunca teve comportamento próprio na UX: não há tela, atalho ou fluxo que sumam com a remoção. O que sai é a promessa de plataforma. |

---

## 2. Resolução das divergências da matriz de rastreabilidade

A matriz classificou 117 comportamentos: 38 `COMPLETE`, 50 `PARTIAL`, 16 `MISSING`, 12
`CONTRADICTORY`, 1 `UNCLEAR`. Abaixo, a resolução de **todos** os não-`COMPLETE`.

### 2.1 `CONTRADICTORY` (12) — todas resolvidas

| # | Divergência | Resolução |
|---|---|---|
| I-6 | `handle`: três derivações incompatíveis | **Fechado no backend**: `@` + 8 caracteres Crockford-Base32 da chave pública, em 2 grupos (`@k3f9-2mqa`). O mock deixa de derivar do nome; o dataset muda (`@ana` → o handle real da chave da fixture) |
| C-1 | Preview com 6 desfechos × 4 na UX | **U-03** |
| C-2 | Preview `banned` inalcançável pelo firewall | **Resolvido no backend**: canal de admissão separado, sem firewall de banidos (`backend-v2.md` §12.3, §14.3) |
| C-7 | Código de 6 × 16 caracteres | **U-05** |
| K-3, E-2, P-4 | Auto-save × op síncrona × rate limit | **U-23** |
| M-3 | Mensagem pendente assenta ao ser entregue | **Mantido e explicitado**: a bolha é ancorada em `authorTs` enquanto pendente e assenta na posição de `seq` ao ser confirmada. A UI precisa animar a transição, não teleportar |
| M-5 | Reagir otimista sem rollback | **U-02** |
| M-17 | Carimbo: `hostTs` × hora local × mock com um só campo | **Fechado**: `MessageDto` traz `authorTs`, `hostTs` e `clockSkewed`. A UI exibe `authorTs`; com `clockSkewed`, exibe `hostTs` com o aviso. `types.ts` ganha os três campos |
| V-13 | Qualidade de tela inerte | **Resolvido pela estrela** (U-09): em WebRTC direto, o bitrate é por espectador e o comando funciona. **Emenda de 2026-08-26 (U-25):** funciona, e o comando é **de quem apresenta** — o `maxBitrate` mora no `RTCRtpSender` dele, então quem pedia o perfil não era quem pagava por ele |
| V-19 | Múltiplos compartilhamentos | ~~**U-10**~~ → **suportados** desde 2026-08-26; U-10 foi revogada e o requisito de §18 volta a valer |

### 2.2 `MISSING` (16) — resolução

| # | Feature | Resolução |
|---|---|---|
| 1 | Código de convite de terceiros | **Cortada** — U-04 |
| 2 | Rail respeitando "Notificações: Nada" | **Implementada** — `query.preferences` (U-24) |
| 3, 4 | "Copiar link do canal/mensagem" → `/m/:code` | **Implementada com propriedade corrigida**: `query.resolveMessageLink` com quatro desfechos (`ok`, `not-member`, `not-synced`, `deleted`). **A promessa de privacidade cai**: o link contém ids e quem o recebe aprende que aqueles ids existem. A UX precisa parar de afirmar o contrário |
| 5 | Participantes inline do canal de voz | **Implementada** — `voice.occupancyChanged` + `query.structure.voice{count, first[]}` |
| 6 | Quem reagiu (tooltip) | **Implementada** — `query.reactors` |
| 7 | Badge de não-lidas da thread | **Implementada** — `local_thread_read_state` + `query.thread.unread` |
| 8 | Aba Links | **Implementada** — tabela `message_links` com regra de extração fechada (só `http`/`https`, ≤ 8 por mensagem, sem unfurl) |
| 9 | Anel de fala ativa | **Implementada** — `speaking` produzido por VAD no renderer, propagado em `voiceState` e no roster |
| 10 | Anti-escalada de permissão e posição | **Nova na UX**: 3.2 precisa explicar as **três** regras (permissão, posição e cargo base), e desabilitar o que o autor não pode conceder |
| 11 | Atraso de 1–2 s em árvore | **Não se aplica ao v1** — U-09/U-14 |
| 12 | Consentimento de relay voluntário | **Implementada** — U-13 |
| 13 | Sem descoberta LAN | **U-26** |
| 14 | Distinguir rate limit de host offline | **Implementada** — `E_RATE_LIMITED` com `retryAfterMs` tem estado visual próprio (`backend-v2.md` §20.3 regra 4) |
| 15 | "Testar microfone" com medidor real | **Resolvida por fronteira**: a medição é **100 % do renderer** (é o dono da captura). `backend-v2.md` §3.4 declara a exceção explicitamente, então deixa de ser ambiguidade |
| 16 | Anexo corrompido | **Implementada** — evento `attachment.corrupt{cause}` com estado nomeado no card |

### 2.3 `PARTIAL` (50) — o elo que faltava

A matriz observou que 20 das 50 perdiam o **mesmo** elo: contrato de leitura, projeção ou
evento de invalidação. v2 fecha os três de uma vez:

| Elo que faltava | Como v2 fecha |
|---|---|
| Schema das queries | `backend-v2.md` §15.6 — **todas** as queries com schema de resposta e mapeamento para `types.ts` |
| Evento de convite | `invites.changed` |
| Evento de auditoria | `auditLog.changed` |
| `clientRef` no aceite | `message.accepted{opId, clientRef, messageId, seq}` |
| Enum de `hostStatus` | 9 valores fechados, com estado inicial `unknown` |
| Enum de estado de blob | 8 valores fechados, com retomada após crash |
| Reconciliação da outbox | §11.6 — e `query.outbox` devolve `preview` para a UI redesenhar a fila ao reabrir |
| `partial` na busca | 4 causas, devolvidas em `partialReason` |
| Contagem de menções em `markRead` | A resposta declara os dois contadores |
| `replyTo` de mensagem deletada | `{excerpt:null, deleted:true}` — comportamento definido |
| Ciclo de vida do expulso/banido | §18.4 + U-16 |
| Volume por participante | `local_participant_volume` + `settings.setParticipantVolume` |
| Escopo do painel de saúde da árvore | `share.health` **só ao apresentador**, declarado |
| Rótulo do autor no log de auditoria | `byLabel` congelado, como o do alvo |
| Permissão de leitura no log | `query.auditLog` recusa sem `view_audit_log` (+ U-07 sobre o que isso significa) |
| `manage_community` × `create_invite` | Fechado: `create_invite` cria e revoga **o próprio**; `manage_community` revoga **qualquer um** |
| Erro de permissão de câmera do SO | `E_DEVICE_BLOCKED` + `voice.deviceError` |
| Ordenação de cargos | `rank` fracionário; `role.move` devolve `{rank}` |

### 2.4 `UNCLEAR` (1)

| # | Item | Resolução |
|---|---|---|
| V-10 | "Áudio tem prioridade sobre vídeo em rede fraca" | **Decidido**: é comportamento do WebRTC, configurado no renderer via `RTCRtpSender.setParameters({priority})` — áudio em `high`, vídeo em `low`, tela em `medium`. Não há regra de backend; a UX pode manter a promessa porque agora existe o mecanismo |

---

## 3. Mudanças obrigatórias no dataset de referência e nas fixtures

`RT-14` mostrou que o dataset de `frontend.md` §2 — usado por 206 checagens de verificação —
não é produzível pelo modelo real. Correções obrigatórias:

| # | Fixture | Hoje | Precisa virar |
|---|---|---|---|
| 1 | `handle` da Ana | `@ana` (derivado do nome) | `@` + 8 chars Crockford da chave pública da fixture, em 2 grupos |
| 2 | Identificador na lista de banidos | `Usuário#4471` | Nome de exibição + `handle` real |
| 3 | Código de convite | `X7K2QM` (6 chars) | 16 chars em 4 grupos |
| 4 | `InvitePreview` | 4 estados | 6 estados |
| 5 | `MessageDeliveryState` | sem `dropped` | 5 estados: `queued`, `sending`, `awaiting`, `failed`, `dropped` |
| 6 | `Message.timestamp` | um campo | `authorTs`, `hostTs`, `clockSkewed` |
| 7 | Espectadores de tela | 7 espectadores num canal com 3 participantes | Espectadores ⊆ participantes, ≤ 8 |
| 8 | `Reaction.userIds` | lista inline | Passa a vir de `query.reactors` sob demanda |
| 9 | `Role.position` | inteiro | `rank` string |
| 10 | `Channel.voiceParticipantIds` | lista completa | `{count, first[≤5]}` |
| 11 | `ModerationAction.tipo` | 10 tipos (spec) / 11 (código) | **20 tipos**, enum único de `backend-v2.md` §6.13 |

**Critério de aceite:** `dev.seedDataset` precisa produzir o dataset **por ops reais**
passando pelo `fold`. Se uma fixture não for produzível, ela está errada — não o backend.

---

## 4. Mapeamento `types.ts` ↔ contratos de leitura

| Tipo do frontend | Contrato v2 | Mudança |
|---|---|---|
| `Identity` | `query.identity` | `handle` derivado da chave |
| `Community` | `query.communities` / `query.community` | `+ hostStatus`, `+ replication`, `+ partialInterpretation`, `+ notificationLevel`, `+ successorKeys` |
| `Category` | `query.structure` | `position` → `rank` |
| `Channel` | `query.structure` | `position` → `rank`; `voiceParticipantIds` → `voice{count, first[]}` |
| `Role` | `query.roles` | `position` → `rank` |
| `Member` | `query.members` / `query.member` | `+ handle`, `+ collision`, `+ can*` |
| `Message` | `MessageDto` | `timestamp` → `authorTs`/`hostTs`/`clockSkewed`; `content` pode ser `null`; `+ mentionsMe`; `replyTo` estruturado |
| `Thread` | `query.thread` | `+ unread` |
| `Reaction` | `ReactionDto` + `query.reactors` | `userIds` sai do payload principal |
| `Attachment` | `AttachmentDto` | `+ blobsCoreKey`, `+ state` (enum de 8) |
| `Invite` | `query.invites` | `code` opcional; `+ codeAvailable`, `+ label` |
| `ModerationAction` | `query.auditLog` | enum de 19; `+ byLabel` |
| `ConnectionHealth` | `query.hostStatus` + `community.replication` | `hostStatus` com 9 valores; `+ replication` |
| `InvitePreview` | §12.3 | 6 desfechos |
| `MessageDeliveryState` | `query.outbox` | 5 estados |

---

## 5. Custo estimado da mudança no frontend implementado

Registrado porque a matriz apontou que "o custo de reverter não está estimado em documento
nenhum" — e porque é informação necessária para a decisão de produto.

| Área | Impacto | Natureza |
|---|---|---|
| Migração web → Electron | **Alto** | Shell, roteamento, CSP, empacotamento (U-25). Não é "zero toque" |
| Formulários com auto-save → salvamento explícito | **Médio** | 3.1b, 3.2, 3.4 — muda o padrão de interação, não os componentes |
| Eixo otimista de reação/edição/pin/thread | **Médio** | `messageStore` ganha o mesmo ciclo de entrega que `send` já tem |
| `handle`, código de convite, timestamp, `rank` | **Médio** | Toca `types.ts`, fixtures e ~206 checagens de verificação |
| Telas novas (backup, sucessão, removido, relay, estados de sistema) | **Alto** | 7 superfícies novas |
| Queries de leitura substituindo fixtures | **Baixo por tela, alto no total** | É o trabalho já previsto; agora com schema, então é mecânico |
| Cortes (código de terceiros, múltiplos shares, aviso de saída, árvore) | **Negativo** (remove trabalho) | — |

---

## 6. O que **não** muda

Para deixar explícito o que a arquitetura preservou:

Arquitetura de informação em 4 camadas · navegação e rotas (exceto a adição da restauração
de identidade) · design system inteiro (superfícies, cor, tipografia, espaçamento, motion) ·
biblioteca de componentes · canal de texto, thread, busca, painel de membros, perfil ·
CRUD de canais e categorias · gestão de cargos (exceto o modelo de ordenação) ·
moderação (exceto os textos de honestidade) · voz e câmera em mesh · barra de chamada
persistente e continuidade entre canais · fila offline durável e seus estados · modo
cache com host offline · consentimento de repasse · diagnóstico de rede · princípios de
produto, incluindo o princípio 3, que é justamente o que obriga metade dos deltas acima.
