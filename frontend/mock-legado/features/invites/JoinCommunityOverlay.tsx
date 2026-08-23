import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "../../../src/components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { TextField } from "../../../src/components/ui/TextField";
import { cn } from "../../../src/lib/cn";
import { AVATAR_BG_CLASS, initialsFrom } from "../../lib/avatar";
import { normalizeInviteCode, resolveInvitePreview } from "../../mocks/dataset";
import {
  selectFirstTextChannelId,
  useCommunityStore,
} from "../../store/communityStore";
import { usePendingInviteStore } from "../../store/inviteStore";
import { useUiStore } from "../../store/uiStore";
import type { Community, InvitePreview } from "../../domain/types";

/** §7, 0.3 — debounce da validação ao colar/digitar e do preview. */
const VALIDATE_DEBOUNCE_MS = 400;
const RESOLVE_DELAY_MS = 400;
/** Entrada simulada (§11, A2 passo 5). */
const JOIN_DELAY_MS = 800;

const INVALID_MESSAGE = "Este convite não é válido ou expirou";

function CommunityGlyph({
  name,
  community,
  muted = false,
}: {
  name: string;
  community?: Community;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "grid size-14 shrink-0 place-items-center rounded-lg",
        "text-heading-2 text-surface-app select-none",
        muted || !community
          ? "bg-role-neutral opacity-60"
          : AVATAR_BG_CLASS[community.iconColor],
      )}
      aria-hidden="true"
    >
      {community?.iconEmoji ? (
        <span className="text-[26px]">{community.iconEmoji}</span>
      ) : (
        initialsFrom(name)
      )}
    </span>
  );
}

function PreviewSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-md border border-border-default bg-surface-sidebar p-4">
      <Skeleton className="size-14 shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  );
}

/**
 * 0.3 Entrar via convite + preview — fluxo A2.
 *
 * Nunca entra "às cegas": o preview é sempre visto antes de confirmar. Vira
 * tela cheia quando a pessoa chega por `/invite/:code` sem nenhuma
 * comunidade ainda — não há shell por trás para servir de contexto.
 */
export interface JoinCommunityOverlayProps {
  /** Decidido pelo shell: sem comunidade nenhuma por trás, vira tela cheia. */
  layout: "modal" | "fullscreen";
}

export function JoinCommunityOverlay({ layout }: JoinCommunityOverlayProps) {
  const source = useUiStore((state) => state.joinSource);
  const closeOverlay = useUiStore((state) => state.closeOverlay);

  const pendingInviteCode = usePendingInviteStore(
    (state) => state.pendingInviteCode,
  );
  const clearPendingInvite = usePendingInviteStore(
    (state) => state.clearPendingInvite,
  );

  const joinedCommunityIds = useCommunityStore(
    (state) => state.joinedCommunityIds,
  );
  const bannedCommunityIds = useCommunityStore(
    (state) => state.bannedCommunityIds,
  );
  const joinCommunity = useCommunityStore((state) => state.joinCommunity);
  const setActiveCommunity = useCommunityStore(
    (state) => state.setActiveCommunity,
  );
  const setActiveChannel = useCommunityStore((state) => state.setActiveChannel);

  const fromLink = source === "link";
  const [step, setStep] = useState<"input" | "preview">(
    fromLink ? "preview" : "input",
  );
  const [code, setCode] = useState(fromLink ? (pendingInviteCode ?? "") : "");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [resolving, setResolving] = useState(fromLink);
  const [entering, setEntering] = useState(false);

  const joinTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(joinTimer.current), []);

  // Passo 1: valida ao colar/digitar, com debounce. Código inválido é erro
  // inline junto ao campo (§12); banido e "já é membro" são desfechos de
  // preview, então avançam para o passo 2.
  useEffect(() => {
    if (step !== "input") return;
    const trimmed = code.trim();
    if (!trimmed) {
      setFieldError(undefined);
      setPreview(null);
      return;
    }

    const timer = window.setTimeout(() => {
      const result = resolveInvitePreview(trimmed, {
        joinedCommunityIds,
        bannedCommunityIds,
      });
      setPreview(result.status === "invalid" ? null : result);
      setFieldError(result.status === "invalid" ? INVALID_MESSAGE : undefined);
    }, VALIDATE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [code, step, joinedCommunityIds, bannedCommunityIds]);

  // Passo 2: skeleton no card enquanto o convite resolve.
  useEffect(() => {
    if (step !== "preview") return;
    setResolving(true);
    const timer = window.setTimeout(() => {
      setPreview(
        resolveInvitePreview(code, { joinedCommunityIds, bannedCommunityIds }),
      );
      setResolving(false);
    }, RESOLVE_DELAY_MS);

    return () => window.clearTimeout(timer);
    // Resolve uma vez ao entrar no passo; o código já está congelado aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function handleClose() {
    // A URL do convite já foi consumida; cancelar não deve deixá-la
    // reabrindo o preview em loop.
    if (fromLink) clearPendingInvite();
    closeOverlay();
  }

  function goToCommunity(communityId: string) {
    setActiveCommunity(communityId);
    const state = useCommunityStore.getState();
    if (!state.activeChannelByCommunity[communityId]) {
      const channelId = selectFirstTextChannelId(state, communityId);
      if (channelId) setActiveChannel(communityId, channelId);
    }
    handleClose();
  }

  function handleJoin(community: Community) {
    if (entering) return;
    setEntering(true);
    joinTimer.current = window.setTimeout(() => {
      joinCommunity(community.id);
      goToCommunity(community.id);
    }, JOIN_DELAY_MS);
  }

  const body = (
    <div className="flex flex-col gap-6">
      {step === "input" ? (
        <>
          <TextField
            label="Cole um link ou código de convite"
            value={code}
            onChange={setCode}
            error={fieldError}
            hint="Exemplo: p2p.app/invite/x7K2qM"
            placeholder="p2p.app/invite/… ou X7K2QM"
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />

          <div className="flex flex-col gap-3 tablet:flex-row tablet:justify-end">
            <Button variant="secondary" size="lg" onClick={handleClose}>
              Cancelar
            </Button>
            <Button
              size="lg"
              disabled={preview === null || Boolean(fieldError)}
              onClick={() => setStep("preview")}
            >
              Continuar
            </Button>
          </div>
        </>
      ) : (
        <>
          {resolving || !preview ? (
            <PreviewSkeleton />
          ) : (
            <PreviewCard
              preview={preview}
              code={code}
              entering={entering}
              onJoin={handleJoin}
              onGoTo={goToCommunity}
              onCancel={handleClose}
            />
          )}
        </>
      )}
    </div>
  );

  // Chegada por link sem nenhuma comunidade: não há shell por trás, então o
  // preview ocupa a tela inteira em vez de flutuar sobre o vazio (§7, 0.3).
  if (layout === "fullscreen") {
    return (
      <FullscreenInvite title="Convite para uma comunidade">
        {body}
      </FullscreenInvite>
    );
  }

  return (
    <Modal
      open
      onClose={handleClose}
      title="Entrar numa comunidade"
      size="md"
      guardClose={() => !entering}
    >
      {body}
    </Modal>
  );
}

function FullscreenInvite({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-full items-center justify-center bg-surface-app px-4 py-8 tablet:px-8">
      <div className="w-full max-w-[440px]">
        <h1 className="mb-6 text-heading-1 text-text-primary">{title}</h1>
        {children}
      </div>
    </main>
  );
}

function PreviewCard({
  preview,
  code,
  entering,
  onJoin,
  onGoTo,
  onCancel,
}: {
  preview: InvitePreview;
  code: string;
  entering: boolean;
  onJoin: (community: Community) => void;
  onGoTo: (communityId: string) => void;
  onCancel: () => void;
}) {
  if (preview.status === "invalid") {
    return (
      <>
        <div className="rounded-md border border-feedback-danger bg-surface-sidebar p-4">
          <p className="text-body text-feedback-danger">{INVALID_MESSAGE}</p>
          <p className="mt-1 text-meta text-text-tertiary">
            Código usado: {normalizeInviteCode(code) || "—"}
          </p>
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" size="lg" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </>
    );
  }

  if (preview.status === "banned") {
    return (
      <>
        {/* Sem contagem de membros e sem quem convidou: não vaza informação
            da comunidade para quem foi banido (§7, 0.3). */}
        <div className="flex items-center gap-4 rounded-md border border-border-default bg-surface-sidebar p-4">
          <CommunityGlyph name={preview.communityName} muted />
          <p className="text-body-emphasis text-text-primary">
            Você não pode entrar em {preview.communityName}
          </p>
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" size="lg" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </>
    );
  }

  if (preview.status === "already-member") {
    const { community } = preview;
    return (
      <>
        <div className="flex items-center gap-4 rounded-md border border-border-default bg-surface-sidebar p-4">
          <CommunityGlyph name={community.name} community={community} />
          <p className="text-body-emphasis text-text-primary">
            Você já está em {community.name}
          </p>
        </div>
        <div className="flex justify-end">
          <Button size="lg" onClick={() => onGoTo(community.id)}>
            Ir para a comunidade
          </Button>
        </div>
      </>
    );
  }

  const { community, invitedBy } = preview;
  return (
    <>
      <div className="flex items-center gap-4 rounded-md border border-border-default bg-surface-sidebar p-4">
        <CommunityGlyph name={community.name} community={community} />
        <div className="min-w-0">
          <p className="truncate text-heading-3 text-text-primary">
            {community.name}
          </p>
          <p className="text-meta text-text-secondary">
            {community.memberCount.toLocaleString("pt-BR")} membros
          </p>
          <p className="text-meta text-text-tertiary">
            Convite de {invitedBy.displayName}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 tablet:flex-row tablet:justify-end">
        <Button
          variant="secondary"
          size="lg"
          onClick={onCancel}
          disabled={entering}
        >
          Cancelar
        </Button>
        <Button size="lg" loading={entering} onClick={() => onJoin(community)}>
          Entrar em {community.name}
        </Button>
      </div>
    </>
  );
}
