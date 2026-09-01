import { useState } from "react";
import { Settings, Shield, Users } from "lucide-react";
import { SettingsLayout } from "./SettingsLayout";
import { CommunityDangerZone } from "./CommunityDangerZone";
import { CommunityIdentitySection } from "./CommunityIdentitySection";
import { CommunityInvitesSection } from "./CommunityInvitesSection";
import { ModerationTab } from "./ModerationTab";
import { RolesTab } from "./RolesTab";
import { useHasPermission } from "../../store/communityStore";
import { useHostStatus } from "../../store/connectionStore";
import type { Community } from "../../domain/types";

export interface CommunitySettingsProps {
  community: Community;
  onClose: () => void;
}

/**
 * 3.1b Configurações da comunidade — metadados, convites e zona de perigo,
 * mais as abas de cargos (3.2) e moderação (3.3).
 *
 * A aba de moderação só existe para quem tem `view_audit_log`: §15 manda
 * esconder o que a permissão não autoriza, nunca mostrar desabilitado.
 */
export function CommunitySettings({ community, onClose }: CommunitySettingsProps) {
  const canViewAudit = useHasPermission(community.id, "view_audit_log");
  const canManageRoles = useHasPermission(community.id, "manage_roles");
  const canInvite = useHasPermission(community.id, "create_invite");

  const [tab, setTab] = useState("general");
  const hostStatus = useHostStatus(community);
  const semHost = hostStatus !== "online";

  const tabs = [
    { id: "general", label: "Geral", icon: <Settings size={16} strokeWidth={2} /> },
    ...(canManageRoles
      ? [{ id: "roles", label: "Cargos", icon: <Users size={16} strokeWidth={2} /> }]
      : []),
    ...(canViewAudit
      ? [
          {
            id: "moderation",
            label: "Moderação",
            icon: <Shield size={16} strokeWidth={2} />,
          },
        ]
      : []),
  ];

  return (
    <SettingsLayout
      title={community.name}
      items={tabs}
      activeId={tab}
      onSelect={setTab}
      onClose={onClose}
    >
      {tab === "general" && (
        <>
          <CommunityIdentitySection community={community} semHost={semHost} />
          {canInvite && <CommunityInvitesSection community={community} />}
          <CommunityDangerZone
            community={community}
            semHost={semHost}
            onClose={onClose}
          />
        </>
      )}

      {tab === "roles" && <RolesTab community={community} />}
      {tab === "moderation" && <ModerationTab community={community} />}
    </SettingsLayout>
  );
}
