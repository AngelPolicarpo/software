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
  definirMudo(mudo: boolean): void;
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
};

export const useDmCallStore = create<DmCallStore>((set) => ({
  ...VAZIO,
  definirMudo: (mudo) => set({ mudo }),
  chamando: (a) => set({ ...VAZIO, ...a, estado: "chamando" }),
  recebendo: (a) => set({ ...VAZIO, ...a, estado: "recebendo" }),
  conectou: () => set((s) => (s.conversationId === null ? s : { estado: "na-chamada", falha: null })),
  parMudou: (estadoDoPar) => set({ estadoDoPar }),
  // A falha **não** encerra: a faixa precisa continuar visível com o motivo, e quem sai é a
  // pessoa. Limpar aqui faria o desfecho de §99 piscar e sumir.
  falhou: (falha) => set({ falha }),
  encerrou: () => set({ ...VAZIO }),
}));
