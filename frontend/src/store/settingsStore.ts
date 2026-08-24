import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Configurações de conta (§10, 3.1) — dispositivos, notificações e o
 * diagnóstico de rede.
 *
 * Dispositivos e notificações são preferência de quem usa: persistem. O
 * diagnóstico de rede não — é uma medição do agora, como toda saúde de
 * conexão nesta spec (§12).
 */

/** §10, 3.1 — "Tudo" / "Só menções" / "Nada" por comunidade. */
export type NotificationLevel = "all" | "mentions" | "none";

export const NOTIFICATION_LABEL: Record<NotificationLevel, string> = {
  all: "Tudo",
  mentions: "Só menções",
  none: "Nada",
};

/**
 * Dispositivos simulados. O mock não chama `enumerateDevices` — pedir
 * permissão de microfone para popular um select que não captura nada seria
 * cobrar um custo real por uma tela falsa.
 */
export const MOCK_MICROPHONES = [
  { value: "default", label: "Padrão do sistema" },
  { value: "usb", label: "Microfone USB (Blue Yeti)" },
  { value: "headset", label: "Headset Bluetooth" },
];

export const MOCK_CAMERAS = [
  { value: "default", label: "Padrão do sistema" },
  { value: "integrated", label: "Câmera integrada (720p)" },
  { value: "none", label: "Nenhuma" },
];

export const MOCK_OUTPUTS = [
  { value: "default", label: "Padrão do sistema" },
  { value: "headset", label: "Headset Bluetooth" },
  { value: "speakers", label: "Alto-falantes" },
];

/** §10, 3.1 — os dois desfechos que o diagnóstico de rede pode dar. */
export type NatType = "moderate" | "cgnat";

export const NAT_LABEL: Record<NatType, string> = {
  moderate: "NAT moderado — conexão direta funciona na maioria dos casos",
  cgnat:
    "CGNAT detectado — você pode ter dificuldade para retransmitir compartilhamentos de tela para outros",
};

/** Duração simulada do diagnóstico (§10, 3.1: skeleton ~1,5s). */
export const DIAGNOSTIC_MS = 1500;

interface SettingsState {
  microphoneId: string;
  cameraId: string;
  outputId: string;
  /** 0-100, §6 (Slider). */
  inputVolume: number;
  outputVolume: number;
  notificationsEnabled: boolean;
  notificationByCommunity: Record<string, NotificationLevel>;

  natType: NatType;
  diagnosticRunning: boolean;
  connectedPeers: number;

  setDevice: (kind: "microphone" | "camera" | "output", id: string) => void;
  setVolume: (kind: "input" | "output", value: number) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setCommunityNotification: (
    communityId: string,
    level: NotificationLevel,
  ) => void;
  runDiagnostic: () => void;
  /** Afinador de §19.1 — o CGNAT de `CLAUDE.md:45` não acontece sozinho. */
  devSetNatType: (type: NatType) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      microphoneId: "default",
      cameraId: "default",
      outputId: "default",
      inputVolume: 80,
      outputVolume: 100,
      notificationsEnabled: true,
      notificationByCommunity: {},

      natType: "moderate",
      diagnosticRunning: false,
      connectedPeers: 12,

      setDevice: (kind, id) =>
        set(
          kind === "microphone"
            ? { microphoneId: id }
            : kind === "camera"
              ? { cameraId: id }
              : { outputId: id },
        ),

      setVolume: (kind, value) =>
        set(kind === "input" ? { inputVolume: value } : { outputVolume: value }),

      setNotificationsEnabled: (notificationsEnabled) =>
        set({ notificationsEnabled }),

      setCommunityNotification: (communityId, level) =>
        set((state) => ({
          notificationByCommunity: {
            ...state.notificationByCommunity,
            [communityId]: level,
          },
        })),

      runDiagnostic: () => {
        set({ diagnosticRunning: true });
        window.setTimeout(() => {
          // A contagem de peers muda a cada medição: é o que ela é, um
          // número do momento, não um dado estável da comunidade.
          set({
            diagnosticRunning: false,
            connectedPeers: 8 + Math.floor(Math.random() * 12),
          });
        }, DIAGNOSTIC_MS);
      },

      devSetNatType: (natType) => set({ natType }),
    }),
    {
      name: "comunidade-p2p:settings",
      version: 1,
      // Diagnóstico é medição do agora (§12): não sobrevive ao reload.
      partialize: ({
        diagnosticRunning: _running,
        connectedPeers: _peers,
        natType: _nat,
        ...rest
      }) => rest,
    },
  ),
);

/** Nível de notificação de uma comunidade — padrão "Tudo" (§10, 3.1). */
export function useCommunityNotification(
  communityId: string,
): NotificationLevel {
  return useSettingsStore(
    (state) => state.notificationByCommunity[communityId] ?? "all",
  );
}
