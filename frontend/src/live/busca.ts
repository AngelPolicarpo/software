/**
 * Busca na comunidade (§23.1, §15.6 `query.search`).
 *
 * A normalização e a construção do `MATCH` são do núcleo — inclusive a regra que **desativa
 * a sintaxe de operador do FTS5**, de modo que `AND`, `OR`, `NOT`, `*` e `:` digitados são
 * literais. A tela não pré-processa o texto: reimplementar a normalização aqui criaria uma
 * segunda definição de "mesma consulta", e as duas divergiriam no primeiro caso de
 * diacrítico.
 *
 * `partial` é resposta, não erro. Quatro causas possíveis (§14.5), e a tela nomeia a que
 * veio: um resultado incompleto que se apresenta como completo é o pior desfecho.
 */

import { create } from "zustand";
import { api } from "../ipc/api";
import { useComunidades } from "./comunidades";
import type { SearchResult } from "../ipc/dto";

export const MOTIVO_PARCIAL: Record<string, string> = {
  "host-offline": "o host está offline e só a cópia local foi varrida",
  "catching-up": "a réplica ainda está alcançando o histórico",
  stalled: "a replicação parou de avançar",
  "partial-interpretation": "parte do log usa tipos que esta versão não interpreta",
};

interface Busca {
  termo: string;
  escopoCanal: string | null;
  resultado: SearchResult | null;
  buscando: boolean;
  erro: string | null;

  buscar(termo: string, escopoCanal?: string | null): Promise<void>;
  limpar(): void;
}

let geracao = 0;

export const useBusca = create<Busca>((set) => ({
  termo: "",
  escopoCanal: null,
  resultado: null,
  buscando: false,
  erro: null,

  async buscar(termo, escopoCanal = null) {
    const communityId = useComunidades.getState().ativa;
    set({ termo, escopoCanal });
    if (communityId === null || termo.trim().length === 0) {
      set({ resultado: null, buscando: false, erro: null });
      return;
    }
    // Busca-enquanto-digita: a resposta atrasada de um termo anterior não pode sobrescrever
    // a do termo atual.
    const minha = ++geracao;
    set({ buscando: true, erro: null });
    try {
      const resultado = await api.search({
        communityId,
        query: termo,
        ...(escopoCanal !== null ? { scopeChannelId: escopoCanal } : {}),
      });
      if (minha === geracao) set({ resultado, buscando: false });
    } catch (e) {
      if (minha === geracao) set({ buscando: false, erro: e instanceof Error ? e.message : "falha na busca" });
    }
  },

  limpar() {
    geracao++;
    set({ termo: "", resultado: null, buscando: false, erro: null });
  },
}));
