import { create } from "zustand";

import type { DmCallState } from "../features/dm/dmRegras";

/**
 * O estado da chamada de uma conversa direta (§31.15).
 *
 * **Uma conversa por vez**, e não um mapa: §15.4 diz "voz é uma só" e §31.15 não abre
 * exceção — a instalação tem no máximo uma chamada, aqui como numa comunidade. Guardar um
 * mapa deixaria a store aceitar um estado que o núcleo não produz.
 *
 * Repare no que **não** existe aqui: não há roster, não há contagem de ocupação, não há fila
 * e não há "permissão revogada". Cada uma dessas ausências é uma linha da tabela de remoções
 * de §31.15, e uma store que as guardasse permitiria uma tela que as mostrasse.
 */
export interface DmCallStore {
  /** A conversa em chamada, ou `null`. */
  conversationId: string | null;
  estado: DmCallState;
  /** A chave do par — a única "lista" que uma chamada de dois tem. */
  peerKey: string | null;
  /** `connecting | connected | failed` do par, medido localmente pelo WebRTC. */
  estadoDoPar: "connecting" | "connected" | "failed" | null;
  /**
   * O motivo de §99 quando a chamada não fechou. Quem o transforma em texto é
   * `faixaDeChamada`, e é lá que **L-29** proíbe oferecer relay.
   */
  falha: string | null;
  /**
   * §9 (2.3.1) — o mudo do painel de chamada. Fica na store da chamada, e não em ajustes,
   * porque numa DM ele nasce da chamada e morre com ela: a preferência de instalação da
   * barra de usuário continua sendo a da comunidade (`frontend.md` §8 1.1).
   *
   * Ensurdecer **não** existe aqui: numa dupla, "ensurdecer o único par" é desligar.
   */
  mudo: boolean;
  /**
   * §17.2 / §31.15 — a câmera desta máquina nesta chamada.
   *
   * Ela mora aqui e não em `voiceStore` pela razão que a store inteira tem: uma chamada de
   * DM e uma de comunidade não coexistem (§15.4), mas o estado que a **tela da conversa**
   * lê é este, e um campo emprestado do outro store faria a conversa depender de uma
   * comunidade que ela não tem.
   *
   * Não há `cameraOn` a anunciar: §15.4 `voice.setSelf` é aviso ao **host**, e numa DM não
   * há host nem `voiceState` (§109.6). O que o outro lado observa é a trilha chegando.
   */
  cameraLigada: boolean;
  /** O motivo em português de uma câmera que não ligou ou caiu (§20.1). */
  erroDeCamera: string | null;
  /**
   * O par está com a câmera ligada, **medido pela trilha** e por nada mais.
   *
   * Numa comunidade isto vem do roster (`voice.setSelf{cameraOn}` ecoado pelo host). §31.15
   * remove o roster, e nenhuma notificação de §31.8 declara câmera — então a única evidência
   * disponível é local: a trilha chegou, e depois `mute`/`ended` dizem que parou. É a mesma
   * disciplina de `cameraDoParChegou` na comunidade, aqui sem o eco que a confirma.
   */
  parComCamera: boolean;
  /**
   * §31.15 (emenda de 2026-09-03) — a tela desta máquina e a do par.
   *
   * Repare no que **não** existe ao lado: não há `sessionId`, não há contagem de
   * espectadores, não há perfil de qualidade e não há saúde. Cada ausência é uma linha da
   * tabela de remoções, e uma store que as guardasse permitiria uma tela que as mostrasse.
   * A adaptação de banda é do `transport-cc` da própria conexão, e não tem estado aqui.
   */
  telaLigada: boolean;
  parComTela: boolean;
  erroDeTela: string | null;
  /**
   * O aviso de que há `MediaStream` novo em `live/cameraStreams` — mesmo papel do `cameraSeq`
   * de `voiceStore`. Um `MediaStream` não é estado de UI e não mora em store; o que mora é a
   * ordem de ir buscá-lo.
   */
  videoSeq: number;
  definirMudo(mudo: boolean): void;
  cameraMudou(ligada: boolean): void;
  cameraFalhou(motivo: string | null): void;
  /** O mic sumiu e a chamada segue em somente-escuta — aviso local, nunca saída. */
  erroDeMicrofone: string | null;
  microfoneFalhou(motivo: string | null): void;
  cameraDoPar(ligada: boolean): void;
  telaMudou(ligada: boolean): void;
  telaDoPar(ligada: boolean): void;
  telaFalhou(motivo: string): void;
  chamando(a: { conversationId: string; peerKey: string }): void;
  recebendo(a: { conversationId: string; peerKey: string }): void;
  conectou(): void;
  parMudou(estado: "connecting" | "connected" | "failed"): void;
  falhou(motivo: string): void;
  encerrou(): void;
}

const VAZIO = {
  conversationId: null,
  estado: "fora" as DmCallState,
  peerKey: null,
  estadoDoPar: null,
  falha: null,
  mudo: false,
  erroDeMicrofone: null,
  cameraLigada: false,
  erroDeCamera: null,
  parComCamera: false,
  telaLigada: false,
  parComTela: false,
  erroDeTela: null,
};

export const useDmCallStore = create<DmCallStore>((set) => ({
  ...VAZIO,
  videoSeq: 0,
  definirMudo: (mudo) => set({ mudo }),
  // Ligar limpa o erro anterior; desligar não o inventa. O `videoSeq` avança nos dois: o
  // tile precisa soltar o `srcObject` quando a câmera apaga, e não só quando ela acende.
  cameraMudou: (cameraLigada) =>
    set((s) => ({
      cameraLigada,
      videoSeq: s.videoSeq + 1,
      ...(cameraLigada ? { erroDeCamera: null } : {}),
    })),
  // A falha **não** apaga a chamada, pela mesma razão que `falhou`: a faixa precisa ficar.
  cameraFalhou: (erroDeCamera) => set({ erroDeCamera, cameraLigada: false }),
  // Idem para o mic — com uma diferença: não há o que "desligar" aqui, a chamada
  // segue em somente-escuta e a recuperação é a troca de dispositivo em curso.
  microfoneFalhou: (erroDeMicrofone) => set({ erroDeMicrofone }),
  cameraDoPar: (parComCamera) => set((s) => ({ parComCamera, videoSeq: s.videoSeq + 1 })),
  telaMudou: (telaLigada) =>
    set((s) => ({
      telaLigada,
      videoSeq: s.videoSeq + 1,
      ...(telaLigada ? { erroDeTela: null } : {}),
    })),
  telaDoPar: (parComTela) => set((s) => ({ parComTela, videoSeq: s.videoSeq + 1 })),
  telaFalhou: (erroDeTela) => set({ erroDeTela, telaLigada: false }),
  chamando: (a) => set({ ...VAZIO, ...a, estado: "chamando" }),
  recebendo: (a) => set({ ...VAZIO, ...a, estado: "recebendo" }),
  conectou: () => set((s) => (s.conversationId === null ? s : { estado: "na-chamada", falha: null })),
  parMudou: (estadoDoPar) => set({ estadoDoPar }),
  // A falha **não** encerra: a faixa precisa continuar visível com o motivo, e quem sai é a
  // pessoa. Limpar aqui faria o desfecho de §99 piscar e sumir.
  falhou: (falha) => set({ falha }),
  // `videoSeq` **não** volta a zero: ele é um contador de "vá buscar o stream de novo", e
  // zerá-lo entre duas chamadas faria o efeito do tile não rodar quando a segunda começasse
  // no mesmo número em que a primeira parou.
  encerrou: () => set((s) => ({ ...VAZIO, videoSeq: s.videoSeq + 1 })),
}));
