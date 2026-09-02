import { cn } from "../../lib/cn";
import { ChannelList } from "./ChannelList";
import { CommunityRail } from "./CommunityRail";
import { UserBar } from "./UserBar";
import { VoicePanel } from "../../features/voice/VoicePanel";
import type { Channel, Community } from "../../domain/types";

export interface ShellLeftColumnProps {
  community: Community | undefined;
  activeChannel: Channel | undefined;
  /** §16: o conteúdo (ou a grade de voz) é a tela em foco no Mobile. */
  contentPaneVisible: boolean;
  /**
   * A lista de 240px desta coluna existe, mas é montada **fora** dela — o caso da
   * conversa direta (U-33), em que quem desenha a lista é o `DmDestino`. Sem isto, a
   * coluna se julgaria "só o rail" e, no Mobile, deixaria a barra de usuário e o painel
   * de chamada espremidos nos 72px enquanto a conversa está em foco.
   */
  listaExterna?: boolean;
  inVoice: boolean;
  onSelectChannel: (channelId: string) => void;
  onJoinVoice: (channelId: string) => void;
}

/**
 * Coluna da esquerda: rail e lista de canais em cima, barra de usuário
 * (§8, 1.1) atravessando os dois no rodapé. A barra é do shell, não da
 * lista: ela existe mesmo no Hub vazio, onde não há lista nenhuma.
 */
export function ShellLeftColumn({
  community,
  activeChannel,
  contentPaneVisible,
  listaExterna = false,
  inVoice,
  onSelectChannel,
  onJoinVoice,
}: ShellLeftColumnProps) {
  // §16: com o conteúdo em foco a coluna vira só o rail de 72px, e tudo o que
  // depende de largura sai da tela junto.
  const recolhida = (Boolean(community) || listaExterna) && contentPaneVisible;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col tablet:w-auto",
        // §16: no Mobile a coluna da esquerda **é** a tela enquanto a lista
        // de canais está em foco. Sem isto ela encolhia para os 312px de
        // rail + lista e o resto da janela ficava preto — a lista já pedia
        // `w-full`, mas quem precisa da largura agora é a coluna que a
        // embrulha, junto do painel de chamada e da barra de usuário.
        community && !contentPaneVisible ? "w-full" : "w-auto",
      )}
    >
      <div className="flex min-h-0 flex-1">
        <CommunityRail />

        {community && (
          <ChannelList
            community={community}
            activeChannelId={activeChannel?.id}
            onSelectChannel={onSelectChannel}
            onJoinVoice={onJoinVoice}
            className={cn(contentPaneVisible && "hidden tablet:flex")}
          />
        )}
      </div>

      {/* A chamada em curso fica logo acima da barra de usuário e com a
          largura dela (§9, 2.3.1): o que só existe enquanto há chamada.
          Some junto com ela no Mobile, pelo mesmo motivo. */}
      {inVoice && (
        <VoicePanel className={cn(recolhida && "hidden tablet:flex")} />
      )}

      {/* §16: no Mobile a barra acompanha a lista de canais — com o
          conteúdo em foco, a coluna da esquerda é só o rail de 72px, que
          não comporta nome nem controles. */}
      <UserBar className={cn(recolhida && "hidden tablet:flex")} />
    </div>
  );
}
