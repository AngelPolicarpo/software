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

/**
 * Porta de escrita das preferências no núcleo (§15.4 "sem host, sem fila") —
 * injetada pelo sincronizador, porque esta store não conhece IPC-R. A escrita
 * local é síncrona e imediata (o LS é dela); o núcleo persiste a MESMA decisão
 * para sobreviver ao reload — dono duplicado do ESTADO não há: quem manda é a
 * última escrita, e `query.preferences` hidrata só no boot.
 */
export interface PortaDeEscritaPreferencias {
  setDevice(kind: "microphone" | "camera" | "output", deviceId: string): Promise<unknown>;
  setVolume(kind: "input" | "output", value: number): Promise<unknown>;
  setNotifications(arg: { enabled?: boolean; communityId?: string; level?: string }): Promise<unknown>;
}

let portaDeEscrita: PortaDeEscritaPreferencias | null = null;

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

  configurarEscrita: (porta: PortaDeEscritaPreferencias | null) => void;
  /** `query.preferences` → espelho. Só no boot; depois, a palavra é da tela. */
  aplicarRemoto: (prefs: {
    device?: { microphoneId?: string; cameraId?: string; outputId?: string; inputVolume?: number; outputVolume?: number };
    notifications?: { enabled: boolean; byCommunity: Array<{ communityId: string; level: string }> };
  }) => void;

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

      configurarEscrita: (porta) => {
        portaDeEscrita = porta;
      },

      aplicarRemoto: (prefs) =>
        set(() => ({
          ...(prefs.device?.microphoneId !== undefined ? { microphoneId: prefs.device.microphoneId } : {}),
          ...(prefs.device?.cameraId !== undefined ? { cameraId: prefs.device.cameraId } : {}),
          ...(prefs.device?.outputId !== undefined ? { outputId: prefs.device.outputId } : {}),
          ...(prefs.device?.inputVolume !== undefined ? { inputVolume: prefs.device.inputVolume } : {}),
          ...(prefs.device?.outputVolume !== undefined ? { outputVolume: prefs.device.outputVolume } : {}),
          ...(prefs.notifications !== undefined ? { notificationsEnabled: prefs.notifications.enabled } : {}),
          ...(prefs.notifications !== undefined
            ? {
                notificationByCommunity: Object.fromEntries(
                  prefs.notifications.byCommunity.map((n) => [n.communityId, n.level as NotificationLevel]),
                ),
              }
            : {}),
        })),

      setDevice: (kind, id) => {
        set(
          kind === "microphone"
            ? { microphoneId: id }
            : kind === "camera"
              ? { cameraId: id }
              : { outputId: id },
        );
        void portaDeEscrita?.setDevice(kind, id).catch(() => {});
      },

      setVolume: (kind, value) => {
        set(kind === "input" ? { inputVolume: value } : { outputVolume: value });
        void portaDeEscrita?.setVolume(kind, value).catch(() => {});
      },

      setNotificationsEnabled: (notificationsEnabled) => {
        set({ notificationsEnabled });
        void portaDeEscrita?.setNotifications({ enabled: notificationsEnabled }).catch(() => {});
      },

      setCommunityNotification: (communityId, level) => {
        set((state) => ({
          notificationByCommunity: {
            ...state.notificationByCommunity,
            [communityId]: level,
          },
        }));
        void portaDeEscrita
          ?.setNotifications({ communityId, level })
          .catch(() => {});
      },

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
