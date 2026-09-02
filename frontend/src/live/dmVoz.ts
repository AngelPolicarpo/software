import { api, cliente } from "../ipc/api";
import { MalhaDeVoz } from "./voz";
import { useDmCallStore } from "../store/dmCallStore";
import { useIdentityStore } from "../store/identityStore";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";

/**
 * §31.15 — a chamada de uma conversa direta.
 *
 * **A malha é a mesma de §17.2**, e isso não é reaproveitamento oportunista: §31.15 abre
 * dizendo que §17.2 vale sem alteração — WebRTC no renderer, ponta a ponta, DTLS-SRTP, e o
 * núcleo nunca vê mídia. O que muda é tudo o que estava em volta, e o arquivo se lê pela
 * lista do que **não** está aqui:
 *
 *   - **Nenhum ticket.** `autorizacaoPorTransporte` diz à malha que quem autoriza é o cabo:
 *     o `p2p-dm/1` foi autenticado por Noise contra exatamente a chave do par. Não há
 *     `voice.tickets`, não há renovação e não há passo 3 de §17.4 a repetir.
 *   - **Nenhum roster.** A única pergunta que o roster respondia numa dupla é "o outro está
 *     aqui?", e ela é `dm.callState{on}`.
 *   - **Nenhuma ocupação, fila ou revogação.** §17.6/§16.4/§17.4 não têm análogo aqui.
 *   - **Nenhum relay a oferecer** (**L-29**). Quando a chamada falha, o desfecho é
 *     `conn-failed` com o diagnóstico de §99 e a frase de `TEXTO_CHAMADA_SEM_RELAY` — e o
 *     texto mora em `dmRegras.ts`, onde o teste o alcança.
 *
 * **"Voz é uma só" (§15.4) continua valendo.** A instalação tem no máximo uma chamada, e a
 * store guarda uma conversa, não um mapa. Uma chamada de DM e uma de comunidade ao mesmo
 * tempo seriam dois microfones abertos na mesma máquina.
 *
 * **Por que a malha só sobe quando o outro atende.** §99.13 dá a garantia de §17.2 pela
 * coleta em duas fases: a `RTCPeerConnection` nasce só com o que o *host* serve, e o
 * terceiro entra por escalada. Numa DM quem faz esse papel é o par — e antes de ele atender
 * o serviço dele não existe. Subir a malha ali entregaria o STUN de terceiro ao agente na
 * primeira coleta, que é exatamente o que a fase 1 existe para evitar. Antes do atendimento
 * também não há com quem negociar: o estado é `chamando`, e nada mais.
 */

/** O `<audio>` do par, fora da árvore do React — mesma razão do mapa da comunidade. */
let audioDoPar: HTMLAudioElement | null = null;

function tocar(stream: MediaStream): void {
  const el = audioDoPar ?? new Audio();
  el.autoplay = true;
  audioDoPar = el;
  el.srcObject = stream;
  aplicarSaida(el);
  void el.play().catch(() => undefined);
}

/**
 * B47 — a saída e o volume geral da tela de ajustes. **Não** há volume por participante nem
 * ensurdecer aqui: os dois são superfície da chamada de comunidade (§9, 2.3), e numa dupla
 * "ensurdecer o único par" é desligar.
 */
function aplicarSaida(el: HTMLAudioElement): void {
  const ajustes = useSettingsStore.getState();
  const saida = ajustes.outputId || "default";
  if ((el.dataset.sinkId ?? "default") !== saida) {
    el.dataset.sinkId = saida;
    void el.setSinkId(saida === "default" ? "" : saida).catch(() => undefined);
  }
  el.volume = Math.max(0, Math.min(100, ajustes.outputVolume)) / 100;
}

function pararAudio(): void {
  if (audioDoPar === null) return;
  audioDoPar.srcObject = null;
  audioDoPar = null;
}

/** A conversa e o par da chamada corrente, para a porta e para o filtro de eventos. */
let corrente: { conversationId: string; peerKey: string } | null = null;

const malha = new MalhaDeVoz(
  {
    /**
     * `communityId` e `channelId` carregam o **`conversationId`**, pela mesma substituição
     * que §31.14 fez no escopo de blob: o que a malha chama de sessão é o escopo da chamada,
     * e numa DM ele é a conversa (§31.1). `dm.callJoin` é idempotente.
     */
    join: async (a) => {
      const r = await api.dmCallJoin(a.communityId);
      return {
        sessionId: r.sessionId,
        // O roster de uma chamada de dois é a conversa. Uma entrada, sempre.
        roster: [{ keyHex: r.peerKey }],
        iceServers: r.iceServers,
        // §31.15 — o ticket de §17.4 **não existe**; a `remotePublicKey` é a autorização.
        tickets: [],
        autorizacaoPorTransporte: true,
      };
    },
    leave: () => (corrente === null ? Promise.resolve({}) : api.dmCallLeave(corrente.conversationId)),
    // O `ticketId` que a malha passa vem vazio e é descartado aqui: não há ticket a citar, e
    // `dm.signal` não tem campo para ele (§31.16.1).
    signal: (a) =>
      corrente === null
        ? Promise.resolve({})
        : api.dmSignal({
            conversationId: corrente.conversationId,
            ...(a.sdp !== undefined ? { sdp: a.sdp } : {}),
            ...(a.ice !== undefined ? { ice: a.ice } : {}),
          }),
  },
  {
    capturar: async (deviceId) =>
      await navigator.mediaDevices.getUserMedia({
        audio:
          deviceId === "default"
            ? {
                echoCancellation: useSettingsStore.getState().processamentoVoz,
                noiseSuppression: useSettingsStore.getState().processamentoVoz,
                autoGainControl: useSettingsStore.getState().processamentoVoz,
              }
            : {
                deviceId: { exact: deviceId },
                echoCancellation: useSettingsStore.getState().processamentoVoz,
                noiseSuppression: useSettingsStore.getState().processamentoVoz,
                autoGainControl: useSettingsStore.getState().processamentoVoz,
              },
      }),
    conexao: (config) => new RTCPeerConnection(config),
  },
  {
    aoMudarPar: (_peerHex, estado) => {
      const mapa: Record<string, "connecting" | "connected" | "failed"> = {
        connected: "connected",
        completed: "connected",
        connecting: "connecting",
        new: "connecting",
        disconnected: "connecting",
        failed: "failed",
        closed: "failed",
      };
      const traduzido = mapa[estado] ?? "connecting";
      useDmCallStore.getState().parMudou(traduzido);
      if (traduzido === "connected") useDmCallStore.getState().conectou();
    },
    aoChegarAudio: (_peerHex, stream) => tocar(stream),
    // §99 — o motivo nomeado. O que a tela faz com ele é `faixaDeChamada`, e é lá que L-29
    // proíbe oferecer o relay que a comunidade oferece.
    aoFalhar: (motivo) => useDmCallStore.getState().falhou(motivo),
    aoSair: () => pararAudio(),
  },
);

/** A malha sobe agora: o par está do outro lado e o serviço dele já chegou. */
async function subirMalha(conversationId: string): Promise<void> {
  const eu = useIdentityStore.getState().identity?.id ?? "";
  try {
    await malha.entrar({
      communityId: conversationId,
      channelId: conversationId,
      euHex: eu,
      microfoneId: useSettingsStore.getState().microphoneId,
      agora: Date.now(),
      volumeEntrada: useSettingsStore.getState().inputVolume,
    });
    useDmCallStore.getState().conectou();
  } catch {
    // A captura pode falhar DEPOIS do join (permissão do sistema, dispositivo sumido). A
    // malha já desfez o próprio estado; o que falta é não deixar a conversa em "na chamada".
    useToastStore.getState().showToast("Não foi possível abrir o microfone", "error");
    await desligar();
  }
}

/**
 * §9 (2.3.1) / **L-12** — o mudo do próprio microfone é **efetivo**, não conselho: quem
 * controla o microfone é quem o possui. E numa DM não há host a quem contá-lo, então ele não
 * sai da máquina: não existe `voiceState` aqui, e inventá-lo seria mecanismo sem destinatário.
 */
export function definirMudo(mudo: boolean): void {
  useDmCallStore.getState().definirMudo(mudo);
  malha.definirMudo(mudo);
}

/** Chamar, ou atender: os dois são `dm.callJoin` — não há convite a aceitar (§31.15). */
export async function chamar(conversationId: string): Promise<void> {
  const store = useDmCallStore.getState();
  if (store.conversationId !== null && store.conversationId !== conversationId) {
    // §15.4 "voz é uma só".
    useToastStore.getState().showToast("Você já está numa chamada", "error");
    return;
  }
  try {
    const r = await api.dmCallJoin(conversationId);
    corrente = { conversationId, peerKey: r.peerKey };
    if (r.peerOnCall) {
      useDmCallStore.getState().chamando({ conversationId, peerKey: r.peerKey });
      await subirMalha(conversationId);
      return;
    }
    useDmCallStore.getState().chamando({ conversationId, peerKey: r.peerKey });
  } catch {
    useToastStore.getState().showToast("Não foi possível iniciar a chamada", "error");
  }
}

export async function desligar(): Promise<void> {
  const id = corrente?.conversationId ?? useDmCallStore.getState().conversationId;
  corrente = null;
  useDmCallStore.getState().encerrou();
  malha.definirMudo(false);
  pararAudio();
  await malha.sair().catch(() => undefined);
  if (id !== null) await api.dmCallLeave(id).catch(() => undefined);
}

/**
 * §31.16.2 — os dois eventos de mídia. Ambos são **ordem**, não sinal para reconsultar: não
 * existe query que reconstrua uma negociação WebRTC, e §15.1 regra 5 não se aplica a quadro
 * de sinalização — a mesma exceção que `voice.signal` sempre teve em §15.5.
 */
export function assinarDmVoz(): void {
  cliente.subscribe("dm.signal", (d) => {
    const ev = d as { conversationId: string; peerKey: string; sdp?: string; ice?: string };
    // Sinal de uma conversa que não é a da chamada corrente é descartado. Sem isto, um par
    // que ligou enquanto eu falo com outra pessoa entraria na negociação em curso.
    if (corrente === null || ev.conversationId !== corrente.conversationId) return;
    void malha.aplicarSinal({
      peerKey: ev.peerKey,
      ticketId: "",
      ...(ev.sdp !== undefined ? { sdp: ev.sdp } : {}),
      ...(ev.ice !== undefined ? { ice: ev.ice } : {}),
    });
  });

  cliente.subscribe("dm.callState", (d) => {
    const ev = d as {
      conversationId: string;
      peerKey: string;
      on: boolean;
      iceServers?: RTCIceServer[];
    };
    const store = useDmCallStore.getState();
    if (!ev.on) {
      // Ele saiu, caiu ou bloqueou — e os três são indistinguíveis (§31.9 regra 2, L-28).
      // A tela encerra sem afirmar a causa, exatamente como "não entregue" não a afirma.
      if (store.conversationId === ev.conversationId) void desligar();
      return;
    }
    if (store.conversationId === null) {
      // Ninguém pediu esta chamada deste lado: é o outro ligando.
      corrente = { conversationId: ev.conversationId, peerKey: ev.peerKey };
      useDmCallStore
        .getState()
        .recebendo({ conversationId: ev.conversationId, peerKey: ev.peerKey });
      return;
    }
    if (store.conversationId !== ev.conversationId) return;
    // Eu já estava chamando e ele atendeu: agora existe serviço do outro lado, e é agora que
    // a coleta de §99.13 pode começar na fase 1.
    if (store.estado === "chamando") {
      void subirMalha(ev.conversationId);
      return;
    }
    // Chamada já de pé e a lista mudou (ele reanunciou): renova sem renegociar.
    if (ev.iceServers !== undefined) malha.aplicarIceServers(ev.iceServers);
  });
}
