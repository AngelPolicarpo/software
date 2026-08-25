import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { TextField } from "../../components/ui/TextField";
import { channelName } from "../../lib/channelName";
import { useAutoSaveToast } from "../settings/useAutoSave";
import {
  useCategories,
  useCategory,
  useChannel,
  useChannelCount,
  useChannels,
  useCommunityStore,
  useRoles,
} from "../../store/communityStore";
import { useMessageStore } from "../../store/messageStore";
import { useToastStore } from "../../store/toastStore";
import { useUiStore } from "../../store/uiStore";
import { useVoiceChannelParticipantIds, useVoiceStore } from "../../store/voiceStore";
import { ChannelForm } from "./ChannelForm";
import {
  NAME_MAX,
  NEW_CATEGORY,
  validateChannelForm,
} from "./channelFormModel";
import type { ChannelFormErrors, ChannelFormValue } from "./channelFormModel";
import type { Channel, Community, Role } from "../../domain/types";

/** Criação simulada, no mesmo ritmo de 0.4 (§11, A3). */
const CREATE_DELAY_MS = 400;

/** Cargos que já vêm marcados como "pode postar" ao ligar somente-leitura. */
function moderatorRoleIds(roles: Role[]): string[] {
  return roles
    .filter(
      (role) =>
        role.isFounder ||
        role.permissions.includes("manage_messages") ||
        role.permissions.includes("manage_community"),
    )
    .map((role) => role.id);
}

/**
 * Nomes de canal já usados na comunidade — base da checagem de duplicidade
 * de §13, que aqui é bloqueante porque o nome é o endereço do canal.
 */
function useExistingNames(communityId: string, exceptId?: string): string[] {
  const categories = useCategories(communityId);
  const channelIds = useMemo(
    () => categories.flatMap((category) => category.channelIds),
    [categories],
  );
  const channels = useChannels(channelIds);
  return channels
    .filter((channel) => channel.id !== exceptId)
    .map((channel) => channel.name);
}

/* ─── Criar canal ─────────────────────────────────────────────────── */

interface CreateChannelModalProps {
  community: Community;
  categoryId?: string;
}

function CreateChannelModal({ community, categoryId }: CreateChannelModalProps) {
  const close = useUiStore((state) => state.closeChannelDialog);
  const categories = useCategories(community.id);
  const roles = useRoles(community.id);
  const createChannel = useCommunityStore((state) => state.createChannel);
  const createCategory = useCommunityStore((state) => state.createCategory);
  const setActiveChannel = useCommunityStore((state) => state.setActiveChannel);
  const existing = useExistingNames(community.id);

  const [value, setValue] = useState<ChannelFormValue>(() => ({
    type: "text",
    name: "",
    topic: "",
    categoryId: categoryId ?? categories[0]?.id ?? NEW_CATEGORY,
    newCategoryName: "",
    readOnly: false,
    canPostRoleIds: moderatorRoleIds(roles),
  }));
  const [errors, setErrors] = useState<ChannelFormErrors>({});
  const [creating, setCreating] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const takenNames = existing.map((name) => name.toLowerCase());
  const isDirty = value.name.trim().length > 0 || value.topic.trim().length > 0;

  function patch(next: Partial<ChannelFormValue>) {
    setValue((current) => ({ ...current, ...next }));
    // Tipo e nome mudam como o nome é normalizado, então o erro deixa de
    // valer na hora — não espera o próximo blur (§12).
    if ((next.name !== undefined || next.type) && errors.name)
      setErrors((current) => ({ ...current, name: undefined }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;

    const found = validateChannelForm(value, takenNames);
    if (found.name || found.category) {
      setErrors(found);
      return;
    }
    if (value.readOnly && value.canPostRoleIds.length === 0) return;

    setCreating(true);
    window.setTimeout(() => {
      // "+ Nova categoria…" cria categoria e canal na mesma confirmação (D14).
      let targetCategoryId = value.categoryId;
      if (targetCategoryId === NEW_CATEGORY) {
        targetCategoryId = createCategory(community.id, value.newCategoryName);
      }

      const resolved = channelName(value.type, value.name);
      const channelId = createChannel({
        communityId: community.id,
        categoryId: targetCategoryId,
        type: value.type,
        name: resolved,
        topic: value.topic,
        readOnlyForRoleIds: value.readOnly
          ? roles
              .filter((role) => !value.canPostRoleIds.includes(role.id))
              .map((role) => role.id)
          : undefined,
      });

      // Canal de texto novo vira o ativo; o de voz não troca o conteúdo (§4).
      if (value.type === "text") setActiveChannel(community.id, channelId);
      close();
    }, CREATE_DELAY_MS);
  }

  function guardClose() {
    if (creating) return false;
    if (!isDirty) return true;
    setConfirmingDiscard(true);
    return false;
  }

  return (
    <>
      <Modal
        open
        onClose={close}
        title="Criar canal"
        size="md"
        guardClose={guardClose}
      >
        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
          <ChannelForm
            value={value}
            onChange={patch}
            errors={errors}
            onBlurName={() =>
              setErrors(validateChannelForm(value, takenNames))
            }
            categories={categories}
            roles={roles}
            disabled={creating}
          />

          <div className="flex flex-col gap-3 tablet:flex-row tablet:justify-end">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => (guardClose() ? close() : undefined)}
              disabled={creating}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="lg"
              loading={creating}
              disabled={value.name.trim().length === 0}
            >
              Criar canal
            </Button>
          </div>
        </form>
      </Modal>

      {confirmingDiscard && (
        <Modal
          open
          onClose={() => setConfirmingDiscard(false)}
          title="Descartar este canal?"
          size="sm"
        >
          <p className="text-body text-text-secondary">
            O canal ainda não foi criado. Fechar agora descarta o que você
            preencheu.
          </p>
          <div className="mt-6 flex flex-col gap-3 tablet:flex-row tablet:justify-end">
            <Button
              variant="secondary"
              onClick={() => setConfirmingDiscard(false)}
            >
              Continuar editando
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmingDiscard(false);
                close();
              }}
            >
              Descartar
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ─── Editar canal ────────────────────────────────────────────────── */

interface EditChannelModalProps {
  community: Community;
  channel: Channel;
}

function EditChannelModal({ community, channel }: EditChannelModalProps) {
  const close = useUiStore((state) => state.closeChannelDialog);
  const openDialog = useUiStore((state) => state.openChannelDialog);
  const categories = useCategories(community.id);
  const roles = useRoles(community.id);
  const updateChannel = useCommunityStore((state) => state.updateChannel);
  const moveChannel = useCommunityStore((state) => state.moveChannel);
  const channelCount = useChannelCount(community.id);
  const existing = useExistingNames(community.id, channel.id);

  const readOnlyIds = channel.readOnlyForRoleIds ?? [];
  const [value, setValue] = useState<ChannelFormValue>(() => ({
    type: channel.type,
    name: channel.name,
    topic: channel.topic ?? "",
    categoryId: channel.categoryId,
    newCategoryName: "",
    readOnly: readOnlyIds.length > 0,
    canPostRoleIds: roles
      .filter((role) => !readOnlyIds.includes(role.id))
      .map((role) => role.id),
  }));
  const [errors, setErrors] = useState<ChannelFormErrors>({});

  const takenNames = existing.map((name) => name.toLowerCase());
  const isLastChannel = channelCount <= 1;

  // §13 — edição salva sozinha; a chave inclui tudo que é gravado.
  useAutoSaveToast(
    `${channel.name}|${channel.topic ?? ""}|${channel.categoryId}|${readOnlyIds.join(",")}`,
  );

  function patch(next: Partial<ChannelFormValue>) {
    const merged = { ...value, ...next };
    setValue(merged);

    const found = validateChannelForm(merged, takenNames);
    setErrors(found);
    // Só grava o que está válido: um nome em erro não pode vazar pra lista.
    if (found.name) return;

    const resolved = channelName(merged.type, merged.name);
    if (resolved !== channel.name) updateChannel(channel.id, { name: resolved });
    if ((merged.topic.trim() || undefined) !== channel.topic)
      updateChannel(channel.id, { topic: merged.topic.trim() || undefined });
    if (merged.categoryId !== channel.categoryId && merged.categoryId !== NEW_CATEGORY)
      moveChannel(channel.id, merged.categoryId);

    if (!merged.readOnly && readOnlyIds.length > 0)
      updateChannel(channel.id, { readOnlyForRoleIds: undefined });
    else if (merged.readOnly && merged.canPostRoleIds.length > 0)
      updateChannel(channel.id, {
        readOnlyForRoleIds: roles
          .filter((role) => !merged.canPostRoleIds.includes(role.id))
          .map((role) => role.id),
      });
  }

  return (
    <Modal open onClose={close} title="Editar canal" size="md">
      <div className="flex flex-col gap-6">
        <ChannelForm
          value={value}
          onChange={patch}
          errors={errors}
          onBlurName={() => setErrors(validateChannelForm(value, takenNames))}
          categories={categories}
          roles={roles}
          lockType
        />

        {/* Zona de perigo, igual à de 3.1b. */}
        <div className="flex flex-col gap-3 border-t border-border-default pt-6">
          <h3 className="text-heading-3 text-text-primary">Zona de perigo</h3>
          {isLastChannel ? (
            <p className="text-meta text-text-tertiary">
              Toda comunidade precisa de pelo menos um canal.
            </p>
          ) : (
            <>
              <p className="text-meta text-text-secondary">
                Excluir remove o canal para todo mundo. Não pode ser desfeito.
              </p>
              <Button
                variant="danger"
                onClick={() =>
                  openDialog({ kind: "delete-channel", channelId: channel.id })
                }
              >
                Excluir canal
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ─── Excluir canal ───────────────────────────────────────────────── */

function DeleteChannelDialog({
  community,
  channel,
}: {
  community: Community;
  channel: Channel;
}) {
  const close = useUiStore((state) => state.closeChannelDialog);
  const deleteChannel = useCommunityStore((state) => state.deleteChannel);
  const showToast = useToastStore((state) => state.showToast);
  const participantIds = useVoiceChannelParticipantIds(channel);
  const leaveVoice = useVoiceStore((state) => state.leave);
  const descartarCanal = useMessageStore((state) => state.descartarCanal);
  const voiceChannelId = useVoiceStore((state) => state.channelId);
  const [deleting, setDeleting] = useState(false);

  const label = channel.type === "text" ? `#${channel.name}` : channel.name;
  const inCall = channel.type === "voice" ? participantIds.length : 0;

  function handleDelete() {
    setDeleting(true);
    // Excluir o canal de voz derruba a chamada — inclusive a nossa (D15).
    if (voiceChannelId === channel.id) leaveVoice();
    // §18: mensagem pendente num canal que deixou de existir é descartada
    // com aviso nomeado — nunca some calada nem fica pendente para sempre.
    // (Quando `channel.delete` estiver ligado ao núcleo, quem conta é a
    // resposta dele, `{seq, droppedQueued}` — o mesmo aviso, outra fonte.)
    const dropped = descartarCanal([channel.id]);
    deleteChannel(community.id, channel.id);
    showToast(
      dropped > 0
        ? `${label} foi excluído · ${dropped} ${dropped === 1 ? "mensagem não foi enviada" : "mensagens não foram enviadas"}`
        : `${label} foi excluído`,
      dropped > 0 ? "error" : undefined,
    );
    close();
  }

  return (
    <Modal open onClose={close} title={`Excluir ${label}?`} size="sm">
      <div className="flex flex-col gap-4">
        {inCall > 0 ? (
          <p className="text-body text-text-secondary">
            {inCall === 1
              ? "1 pessoa está nesta chamada agora. Excluir tira ela da chamada."
              : `${inCall} pessoas estão em ${label} agora. Excluir tira todas da chamada.`}
          </p>
        ) : (
          <p className="text-body text-text-secondary">
            As mensagens deste canal somem para todo mundo. Não pode ser
            desfeito.
          </p>
        )}

        {/* Nota de honestidade P2P, no mesmo espírito da nota de banimento. */}
        <p className="rounded-md border border-border-default bg-surface-sidebar p-3 text-meta text-text-tertiary">
          Quem estiver offline agora só vê o canal sumir ao reconectar — até
          lá, a réplica local dessa pessoa ainda tem as mensagens.
        </p>

        <div className="flex flex-col gap-3 tablet:flex-row tablet:justify-end">
          <Button variant="secondary" onClick={close} disabled={deleting}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={handleDelete} loading={deleting}>
            Excluir canal
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Categorias ──────────────────────────────────────────────────── */

function CategoryNameModal({
  community,
  categoryId,
}: {
  community: Community;
  categoryId?: string;
}) {
  const close = useUiStore((state) => state.closeChannelDialog);
  const category = useCategory(categoryId ?? null);
  const createCategory = useCommunityStore((state) => state.createCategory);
  const renameCategory = useCommunityStore((state) => state.renameCategory);

  const [name, setName] = useState(category?.name ?? "");
  const [error, setError] = useState<string | undefined>();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length === 0) {
      setError("Digite um nome para a categoria.");
      return;
    }

    if (category) renameCategory(category.id, name);
    else createCategory(community.id, name);
    close();
  }

  return (
    <Modal
      open
      onClose={close}
      title={category ? "Renomear categoria" : "Criar categoria"}
      size="sm"
    >
      <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
        <TextField
          label="Nome da categoria"
          value={name}
          onChange={(value) => {
            setName(value);
            if (error) setError(undefined);
          }}
          error={error}
          placeholder="Ex.: PROJETOS"
          maxLength={NAME_MAX}
          autoFocus
          autoComplete="off"
        />
        <div className="flex flex-col gap-3 tablet:flex-row tablet:justify-end">
          <Button variant="secondary" onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" disabled={name.trim().length === 0}>
            {category ? "Salvar" : "Criar categoria"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteCategoryDialog({
  community,
  categoryId,
}: {
  community: Community;
  categoryId: string;
}) {
  const close = useUiStore((state) => state.closeChannelDialog);
  const category = useCategory(categoryId);
  const categories = useCategories(community.id);
  const channelCount = useChannelCount(community.id);
  const deleteCategory = useCommunityStore((state) => state.deleteCategory);

  const others = categories.filter((item) => item.id !== categoryId);
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? "");

  if (!category) return null;

  const inside = category.channelIds.length;
  // Excluir tudo não pode levar junto o último canal da comunidade (§18).
  const wouldEmptyCommunity = channelCount - inside <= 0;

  function finish(moveChannelsToId?: string) {
    deleteCategory(community.id, categoryId, moveChannelsToId);
    close();
  }

  return (
    <Modal open onClose={close} title={`Excluir ${category.name}?`} size="sm">
      <div className="flex flex-col gap-5">
        <p className="text-body text-text-secondary">
          {inside === 0
            ? "A categoria está vazia."
            : inside === 1
              ? "Há 1 canal nesta categoria. Ele pode ir para outra em vez de sumir junto."
              : `Há ${inside} canais nesta categoria. Eles podem ir para outra em vez de sumir junto.`}
        </p>

        {inside > 0 && others.length > 0 && (
          <Select
            label="Mover os canais para"
            value={moveTo}
            onChange={setMoveTo}
            options={others.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
        )}

        <div className="flex flex-col gap-3">
          {inside > 0 && others.length > 0 && (
            <Button onClick={() => finish(moveTo)}>
              Mover os canais e excluir a categoria
            </Button>
          )}
          <Button
            variant="danger"
            disabled={inside > 0 && wouldEmptyCommunity}
            onClick={() => finish()}
          >
            {inside === 0
              ? "Excluir categoria"
              : `Excluir a categoria e os ${inside} canais`}
          </Button>
          {inside > 0 && wouldEmptyCommunity && (
            <p className="text-meta text-text-tertiary">
              Toda comunidade precisa de pelo menos um canal — crie outra
              categoria com um canal antes de excluir esta.
            </p>
          )}
          <Button variant="secondary" onClick={close}>
            Cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Router ──────────────────────────────────────────────────────── */

/**
 * §10, 3.4 — os seis diálogos de gestão de canal e categoria. Ficam num
 * componente só porque compartilham o mesmo slot de estado (`channelDialog`)
 * e nunca aparecem dois ao mesmo tempo.
 */
export function ChannelDialogs({ community }: { community: Community }) {
  const dialog = useUiStore((state) => state.channelDialog);
  const channelId =
    dialog && "channelId" in dialog ? dialog.channelId : null;
  const channel = useChannel(channelId);

  if (!dialog) return null;

  switch (dialog.kind) {
    case "create-channel":
      return (
        <CreateChannelModal
          community={community}
          categoryId={dialog.categoryId}
        />
      );
    case "edit-channel":
      return channel ? (
        <EditChannelModal community={community} channel={channel} />
      ) : null;
    case "delete-channel":
      return channel ? (
        <DeleteChannelDialog community={community} channel={channel} />
      ) : null;
    case "create-category":
      return <CategoryNameModal community={community} />;
    case "rename-category":
      return (
        <CategoryNameModal community={community} categoryId={dialog.categoryId} />
      );
    case "delete-category":
      return (
        <DeleteCategoryDialog
          community={community}
          categoryId={dialog.categoryId}
        />
      );
  }
}
