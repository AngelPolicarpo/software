# POC-09 / G8 — relatório

Leitura consolidada do que o harness mediu. O artefato versionado está em
`out/gate-G8/gate-G8.json` (perfil full; `out/gate-G8-quick/` para o smoke de 11 passos);
este documento é a interpretação dele e **não é normativo** — quando divergir de
`backend-v2.md`/`adr-v2.md`, o normativo vence.

---

## 1. O que o gate perguntou

> Uma sessão de tela em estrela WebRTC com até 8 espectadores atende latência, perda e CPU
> declaradas, com qualidade por espectador funcionando e captura só após autorização.

O plano (`plano-de-validacao-experimental-v2.md`, POC-09/G8) pede Chromium empacotado,
`getDisplayMedia`/`RTCStatsReport` reais e `tc/netem`. O ambiente desta sessão não permite
pack, então o padrão do G7 foi seguido: evidência **parcial** no escopo disponível, com
`openCriteria` declarados bloqueando **release**, não decisão. A novidade em relação ao
poc-08: nenhum módulo foi reimplementado — o harness importa os artefatos compilados do
core (`MediaServer`, `VoiceHostSessions`, `ShareHostSessions`, `VoiceTicketManager`,
`TurnControls`) e exerce decisões reais sobre portas simuladas.

## 2. O que foi medido (perfil full, 13/13 passos)

| | Medido |
|---|---|
| Estrela cheia (W5) | 8 espectadores · p50 **0,4 ms** · p95 máx **0,6 ms** · perda 0 % · bitrate 1167 kbps medidos vs 1200 contratados (−2,7 %) · 1º quadro ~135–162 ms |
| Perfis simultâneos (W2) | high 2441/2500 e balanced 1171/1200 na mesma sessão, por espectador |
| `setQuality` (W4) | v0 high→low: razão medida **0,239** vs contratual 600/2500 = **0,24**; v1 estável (razão 1,000); `{applied:true}` da decisão real |
| Degradação (W7) | perda injetada 6 % → medida **5,44 %** > 3 % → `degradeOnLoss` devolve `balanced` → aplicada → bitrate cai 2317→1112 kbps; vizinhos sem perda ficam estáveis |
| Ban no meio (W8) | cessação do tráfego **0 ms** após o sweep (critério ≤ 5 s); 0 pacotes recebidos depois |
| Entrada tardia/churn (W6) | 1º quadro do tardio em **153 ms**; saída de um espectador não afeta os demais |
| Teto (S3/W9) | 8 entram; **9º → `E_SESSION_FULL`** na decisão real; leave reabre a vaga |
| Captura (S2/W9) | captura nunca autorizada sem `captureToken` válido da sessão viva — forjado/sessão errada/expirado/pós-stop recusados (`T-41`) |
| Sinalização (W2a) | ticket Ed25519 adulterado recusado nas duas pontas; DTLS nunca inicia sem ticket válido (A22 passos 3–4) |
| STUN/demux (W1) | `MediaServer` real responde Binding com XOR-MAPPED correto; lixo UDX atravessa ao UDX |
| Tela via TURN | recusada na decisão real (`TurnControls.allocate('screen')` → `screen-refused`, §17.3) |
| CPU do apresentador | **13,6 %** durante a estrela cheia — limite superior: processo único hospeda host + 8 clientes |

## 3. Critérios do plano vs o que este gate provou

| Critério de aprovação | Status |
|---|---|
| Latência p95 ≤ 800 ms com 8 espectadores no perfil `balanced` | medida em localhost (p95 0,6 ms) — rede real fica para o gate empacotado |
| CPU do apresentador ≤ 40 % num alvo de referência declarado | limite superior medido (13,6 %); alvo dedicado fica para o empacotado |
| `setQuality` produz mudança de bitrate mensurável por espectador | **provado no escopo Node** (razão 0,239 vs 0,24), com ressalva de enforcement abaixo |
| 9º espectador recebe `E_SESSION_FULL` | **provado** na decisão real, nos dois perfis |
| Captura nunca inicia sem token | **provado** na decisão real (`capture.authorize`) |
| Ban do apresentador encerra a sessão | **provado** com tráfego real: cessação imediata |
| Degradação automática quando a saúde reporta perda > 3 % | **provado**: decisão core + efeito medido no bitrate |

## 4. Limitações declaradas (bloqueiam release, não decisão)

1. **Sem Chromium empacotado**: mídia é sintética (pacotes ~1,1 kB em cadência de vídeo)
   sobre werift. O `setParameters({maxBitrate})` é aceito mas **não aplicado** pelo werift
   ("todo impl" no código dele) — o enforcement no escopo Node é feito pela bomba do
   apresentador, e o efeito é medido nos receptores. No produto, quem aplica maxBitrate é o
   encoder do Chromium.
2. **Sem netem/CGNAT**: localhost direto; a matriz de NAT já foi propriedade do G7.
   Uplink limitado (5/10/25 Mbps) e churn agressivo ficam para o empacotado.
3. **CPU inclui todos os clientes** no mesmo processo — limite superior, como no poc-08.
4. **`share.health` derivado da perda medida nos receptores**: o werift não expõe
   `remote-inbound-rtp/fractionLost` como o RTCStatsReport do renderer fará.
5. Latência absoluta em localhost não equivale à rede real; o critério de 800 ms precisa da
   medição empacotada.

## 5. Decisões de implementação registradas (§24 do sequenciamento)

- Camada de decisão da sessão de tela em `voiceCoordinator/share.ts` (não em `shareStar/`);
- `captureToken` opaco amarrado à sessão, não ticket assinado;
- `SHARE_MAX_VIEWERS` no `fold` (§27.1) chegando por injeção;
- apresentador fora da chamada → `E_SESSION_GONE`;
- `setQuality` literal ao papel "espectador" do §RPC;
- degradação só desce perfil (o normativo não define subida automática).

Detalhes e justificativas normativas em `docs/sequenciamento-pos-fase-0.md` §24.

## 6. Lacunas de especificação encontradas

| Lacuna | Como este harness fechou | Quem fecha definitivamente |
|---|---|---|
| §17.4 não fixa validade do `captureToken` | injetada (`captureTokenTtlMs`; 120 s no harness) | emenda normativa ou decisão de produto antes da fase 8 |
| §RPC `share.start` não cataloga erro para apresentador fora da chamada | `E_SESSION_GONE` (estado nomeado existente) | idem |
| §17.5 diz "a UI degrada automaticamente" sem fixar limiar/histerese | limiar 3 % vem do critério G8 do plano; degradação de um perfil por evento, sem subida automática | deltas-ux antes da UI de produto |

## 7. Veredito

**Parcial**, no mesmo sentido do G7 pós-poc-08: todos os passos executáveis no escopo Node
passaram nos dois perfis (11 quick / 13 full), e os sete critérios de aprovação do plano
têm evidência correspondente no escopo disponível. Os `openCriteria` acima bloqueiam
`validada para release`, não a implementação da fase 8 (`shareStar` produto sobre esta
camada).
