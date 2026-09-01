import { Button } from "../../components/ui/Button";
import { Slider } from "../../components/ui/Slider";
import { useHasPermission } from "../../store/communityStore";
import { useVoiceStore } from "../../store/voiceStore";

export interface ProfileCallActionsProps {
  communityId: string;
  identityId: string;
}

/**
 * Ações específicas da chamada — só existem enquanto os dois estão nela
 * (§8, 1.4). O volume é por participante e local; silenciar depende de
 * `voice_mute_others` (§8, 1.4 · §15).
 */
export function ProfileCallActions({
  communityId,
  identityId,
}: ProfileCallActionsProps) {
  const volume = useVoiceStore((state) => state.volumeById[identityId] ?? 100);
  const setVolume = useVoiceStore((state) => state.setVolume);
  const participantMuted = useVoiceStore((state) =>
    Boolean(state.participants.find((p) => p.identityId === identityId)?.muted),
  );
  const setParticipantMuted = useVoiceStore(
    (state) => state.setParticipantMuted,
  );
  // §15: ação que a permissão não autoriza não aparece — nunca desabilitada.
  const canMuteOthers = useHasPermission(communityId, "voice_mute_others");

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
      <Slider
        label="Volume nesta chamada"
        value={volume}
        onChange={(value) => setVolume(identityId, value)}
        valueLabel={`${volume}%`}
      />

      {canMuteOthers && (
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          onClick={() => setParticipantMuted(identityId, !participantMuted)}
        >
          {participantMuted
            ? "Reativar microfone nesta chamada"
            : "Silenciar nesta chamada"}
        </Button>
      )}
    </div>
  );
}
