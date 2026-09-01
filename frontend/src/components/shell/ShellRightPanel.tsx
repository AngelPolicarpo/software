import { ChannelInfoPanel } from "../../features/channel/ChannelInfoPanel";
import { ThreadPanel } from "../../features/channel/ThreadPanel";
import { MembersPanel } from "../../features/members/MembersPanel";
import { useUiStore } from "../../store/uiStore";
import type { Channel, Community } from "../../domain/types";

export interface ShellRightPanelProps {
  community: Community;
  activeChannel: Channel | undefined;
  /** §9, 2.1 — o composer da thread herda o somente-leitura do canal. */
  activeChannelReadOnly: boolean;
}

/** Slot único à direita: abrir um fecha o outro (§6, §15). */
export function ShellRightPanel({
  community,
  activeChannel,
  activeChannelReadOnly,
}: ShellRightPanelProps) {
  const rightPanel = useUiStore((state) => state.rightPanel);
  const closeRightPanel = useUiStore((state) => state.closeRightPanel);

  if (rightPanel?.kind === "members")
    return <MembersPanel community={community} onClose={closeRightPanel} />;

  if (rightPanel?.kind === "channel-info" && activeChannel)
    return (
      <ChannelInfoPanel
        community={community}
        channel={activeChannel}
        onClose={closeRightPanel}
      />
    );

  if (rightPanel?.kind === "thread" && activeChannel)
    return (
      <ThreadPanel
        channel={activeChannel}
        rootMessageId={rightPanel.rootMessageId}
        readOnly={activeChannelReadOnly}
        onClose={closeRightPanel}
      />
    );

  return null;
}
