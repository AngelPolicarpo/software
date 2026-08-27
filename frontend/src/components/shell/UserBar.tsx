import { useState } from "react";
import { HeadphoneOff, Headphones, Mic, MicOff, Settings } from "lucide-react";
import { cn } from "../../lib/cn";
import { Avatar } from "../ui/Avatar";
import { Tooltip } from "../ui/Tooltip";
import { PRESENCE_LABEL } from "../../lib/avatar";
import { ProfilePopover } from "../../features/members/ProfilePopover";
import { useIdentityStore } from "../../store/identityStore";
import { useUiStore } from "../../store/uiStore";
import { useCommunityStore } from "../../store/communityStore";
import { useSelfAudio, useVoiceStore } from "../../store/voiceStore";

interface ControlProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  pressed: boolean;
}

/**
 * Mudo, ensurdecer e configurações. O estado ligado é vermelho **e** troca o
 * ícone para a versão cortada: §5.4 não aceita cor como pista única.
 */
function Control({ label, icon, onClick, pressed }: ControlProps) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={pressed}
        aria-label={label}
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md",
          "transition-colors duration-(--duration-fast) ease-out",
          pressed
            ? "bg-feedback-danger/15 text-feedback-danger hover:bg-feedback-danger/25"
            : "text-text-secondary hover:bg-surface-primary hover:text-text-primary",
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

export interface UserBarProps {
  className?: string;
}

/**
 * §8, 1.1 — barra de usuário, no rodapé da coluna da esquerda, atravessando
 * o rail e a lista de canais.
 *
 * É a superfície permanente da identidade local: quem eu sou, como estou
 * aparecendo e os dois controles de áudio. Os dois valem **fora** da chamada
 * (preferência persistida no `voiceStore`) — sem isso, "entrar já mudo" não
 * existiria e o único lugar para desligar o microfone seria uma chamada em
 * curso.
 *
 * Substitui o avatar do rodapé do rail como porta de 3.1: o avatar sozinho
 * não dizia nome nem presença, e duas portas para a mesma tela na mesma
 * coluna seriam ruído.
 */
export function UserBar({ className }: UserBarProps) {
  const identity = useIdentityStore((state) => state.identity);
  const openAccountSettings = useUiStore((state) => state.openAccountSettings);
  const activeCommunityId = useCommunityStore(
    (state) => state.activeCommunityId,
  );
  const { muted, deafened } = useSelfAudio();
  const toggleMute = useVoiceStore((state) => state.toggleMute);
  const toggleDeafen = useVoiceStore((state) => state.toggleDeafen);
  const inVoice = useVoiceStore((state) => state.channelId !== null);

  const [profile, setProfile] = useState<DOMRect | null>(null);

  if (!identity) return null;

  return (
    <div
      className={cn(
        "flex h-14 shrink-0 items-center gap-1 px-2",
        "border-t border-border-subtle bg-surface-app",
        className,
      )}
    >
      {/*
        O bloco todo abre o popover do próprio perfil (§8, 1.4): presença,
        apelido e o caminho para 3.1 já moram lá. A engrenagem continua indo
        direto, para quem quer as configurações e não o perfil.
      */}
      <button
        type="button"
        onClick={(event) =>
          setProfile(event.currentTarget.getBoundingClientRect())
        }
        aria-haspopup="dialog"
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left",
          "transition-colors duration-(--duration-fast) ease-out",
          "hover:bg-surface-primary",
        )}
      >
        <Avatar
          name={identity.displayName}
          color={identity.avatarColor}
          size="md"
          presence={identity.presence}
          presenceRingClass="border-surface-app"
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body-emphasis text-text-primary">
            {identity.displayName}
          </span>
          <span className="truncate text-meta text-text-tertiary">
            {PRESENCE_LABEL[identity.presence]}
          </span>
        </span>
      </button>

      <Control
        label={muted ? "Ativar microfone" : "Silenciar microfone"}
        pressed={muted}
        onClick={toggleMute}
        icon={
          muted ? (
            <MicOff size={20} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Mic size={20} strokeWidth={2} aria-hidden="true" />
          )
        }
      />
      <Control
        label={deafened ? "Reativar áudio" : "Ensurdecer"}
        pressed={deafened}
        onClick={toggleDeafen}
        icon={
          deafened ? (
            <HeadphoneOff size={20} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Headphones size={20} strokeWidth={2} aria-hidden="true" />
          )
        }
      />
      <Control
        label="Configurações de conta"
        pressed={false}
        onClick={openAccountSettings}
        icon={<Settings size={20} strokeWidth={2} aria-hidden="true" />}
      />

      {/*
        O popover é do meu perfil NESTA comunidade — apelido é por comunidade
        (§2, Member). Sem comunidade ativa (Hub vazio) não há membro para
        mostrar, e o caminho continua sendo a engrenagem.
      */}
      {profile && activeCommunityId && (
        <ProfilePopover
          communityId={activeCommunityId}
          identityId={identity.id}
          anchor={profile}
          onClose={() => setProfile(null)}
          inCall={inVoice}
        />
      )}
    </div>
  );
}
