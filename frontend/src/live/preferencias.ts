/**
 * Preferências locais e conta (§15.6 `query.preferences`, §15.4 "Preferências locais" e
 * "Identidade e app").
 *
 * Preferência local **não passa pelo host e não entra na fila** — a tabela de §15.4 diz
 * isso na própria seção. Por isso aqui a escrita pode aplicar o efeito na hora: o comando
 * responde `{}` e o dono do dado é esta máquina. É o oposto exato da fila de mensagem, e a
 * diferença não é de estilo — é de quem decide.
 *
 * `identity.update` é a exceção declarada de §11.1 (segunda, junto com `member.leave`):
 * responde `{queued:[{communityId, opId}]}` porque o nome exibido precisa chegar a cada
 * comunidade pelo log. A tela diz quantas ops foram enfileiradas em vez de fingir que já
 * mudou em todo lugar.
 */

import { create } from "zustand";
import { api, cliente } from "../ipc/api";
import { registrarResync } from "./sessao";
import type { PreferencesDto } from "../ipc/dto";

interface Preferencias {
  dados: PreferencesDto | null;
  carregando: boolean;
  erro: string | null;

  carregar(): Promise<void>;
  setVolume(kind: "input" | "output", value: number): Promise<void>;
  setDispositivo(kind: "microphone" | "camera" | "output", deviceId: string): Promise<void>;
  setNotificacoes(arg: { enabled?: boolean; communityId?: string; level?: string }): Promise<void>;
  setCanalMudo(arg: { communityId: string; channelId: string; muted: boolean }): Promise<void>;
}

export const usePreferencias = create<Preferencias>((set, get) => ({
  dados: null,
  carregando: false,
  erro: null,

  async carregar() {
    set({ carregando: true });
    try {
      const dados = await api.preferences();
      set({ dados, carregando: false, erro: null });
    } catch (e) {
      set({ carregando: false, erro: e instanceof Error ? e.message : "falha ao ler as preferências" });
    }
  },

  async setVolume(kind, value) {
    await api.settingsSetVolume({ kind, value });
    // Sem host no caminho, o efeito é local e imediato; reler seria uma consulta para
    // confirmar o que esta máquina acabou de decidir.
    set((s) =>
      s.dados === null
        ? s
        : {
            dados: {
              ...s.dados,
              device: { ...s.dados.device, [kind === "input" ? "inputVolume" : "outputVolume"]: value },
            },
          },
    );
  },

  async setDispositivo(kind, deviceId) {
    await api.settingsSetDevice({ kind, deviceId });
    const campo = kind === "microphone" ? "microphoneId" : kind === "camera" ? "cameraId" : "outputId";
    set((s) => (s.dados === null ? s : { dados: { ...s.dados, device: { ...s.dados.device, [campo]: deviceId } } }));
  },

  async setNotificacoes(arg) {
    await api.settingsSetNotifications(arg);
    await get().carregar();
  },

  async setCanalMudo(arg) {
    await api.channelSetMuted(arg);
    await get().carregar();
  },
}));

export function assinarPreferencias(): () => void {
  const cancelarResync = registrarResync(() => {
    if (usePreferencias.getState().dados !== null) void usePreferencias.getState().carregar();
  });
  // §25.5 — configuração de rede fora do default é visível (delta U-21); o evento avisa.
  const local = cliente.subscribe("config.nonDefault", (data) => {
    const keys = (data as { keys?: string[] })?.keys ?? [];
    if (keys.length > 0) {
      usePreferencias.setState({
        erro: `Configuração de rede fora do padrão: ${keys.join(", ")}.`,
      });
    }
  });
  return () => {
    cliente.unsubscribe(local);
    cancelarResync();
  };
}
