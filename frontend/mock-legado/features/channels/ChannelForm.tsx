import { Hash, Volume2 } from "lucide-react";
import { Checkbox } from "../../components/ui/Checkbox";
import { Select } from "../../components/ui/Select";
import { TextArea } from "../../components/ui/TextArea";
import { TextField } from "../../../src/components/ui/TextField";
import { Toggle } from "../../components/ui/Toggle";
import { cn } from "../../../src/lib/cn";
import { channelName } from "../../lib/channelName";
import type { Category, ChannelType, Role } from "../../domain/types";
import { NAME_MAX, NEW_CATEGORY, TOPIC_MAX } from "./channelFormModel";
import type { ChannelFormErrors, ChannelFormValue } from "./channelFormModel";

interface TypeOptionProps {
  type: ChannelType;
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

function TypeOption({ type, active, disabled, onSelect }: TypeOptionProps) {
  const isText = type === "text";
  const Icon = isText ? Hash : Volume2;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 px-3 py-2",
        "text-body-emphasis",
        "transition-colors duration-(--duration-fast) ease-out",
        "focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-default",
        "disabled:cursor-not-allowed disabled:text-text-disabled",
        active
          ? "bg-accent-muted-bg text-text-primary"
          : "text-text-secondary hover:text-text-primary",
      )}
    >
      <Icon size={16} strokeWidth={2} aria-hidden="true" />
      {isText ? "Texto" : "Voz"}
    </button>
  );
}

export interface ChannelFormProps {
  value: ChannelFormValue;
  onChange: (patch: Partial<ChannelFormValue>) => void;
  errors: ChannelFormErrors;
  onBlurName: () => void;
  categories: Category[];
  roles: Role[];
  /** Edição não troca o tipo do canal (Apêndice A). */
  lockType?: boolean;
  disabled?: boolean;
}

/**
 * Corpo compartilhado por "Criar canal" e "Editar canal" (§10, 3.4) — os dois
 * têm os mesmos campos, e só divergem em tipo travado, botão explícito vs.
 * salvamento automático e zona de perigo.
 */
export function ChannelForm({
  value,
  onChange,
  errors,
  onBlurName,
  categories,
  roles,
  lockType = false,
  disabled = false,
}: ChannelFormProps) {
  const isText = value.type === "text";
  const resolved = channelName(value.type, value.name);

  return (
    <div className="flex flex-col gap-6">
      {!lockType && (
        <div className="flex flex-col gap-2">
          <span className="text-caption text-text-secondary uppercase">
            Tipo de canal
          </span>
          <div
            role="radiogroup"
            aria-label="Tipo de canal"
            className="flex overflow-hidden rounded-md border border-border-default"
          >
            <TypeOption
              type="text"
              active={isText}
              disabled={disabled}
              onSelect={() => onChange({ type: "text" })}
            />
            <span className="w-px bg-border-default" aria-hidden="true" />
            <TypeOption
              type="voice"
              active={!isText}
              disabled={disabled}
              onSelect={() => onChange({ type: "voice" })}
            />
          </div>
        </div>
      )}

      <TextField
        label="Nome do canal"
        value={value.name}
        onChange={(name) => onChange({ name })}
        onBlur={onBlurName}
        error={errors.name}
        // A prévia do slug é a explicação do que vai acontecer, e some quando
        // o campo está em erro para não competir com a mensagem (§12).
        hint={
          isText && resolved.length > 0
            ? `Vai aparecer como #${resolved}`
            : !isText
              ? "Canal de voz mantém maiúsculas e espaços."
              : undefined
        }
        placeholder={isText ? "Ex.: Ajuda Design" : "Ex.: Sala de Estudos"}
        maxLength={NAME_MAX}
        counterWarningAt={NAME_MAX - 4}
        showCounter
        autoFocus
        autoComplete="off"
        disabled={disabled}
      />

      <div className="flex flex-col gap-2">
        <Select
          label="Categoria"
          value={value.categoryId}
          onChange={(categoryId) => onChange({ categoryId })}
          disabled={disabled}
          options={[
            ...categories.map((category) => ({
              value: category.id,
              label: category.name,
            })),
            { value: NEW_CATEGORY, label: "+ Nova categoria…" },
          ]}
        />
        {value.categoryId === NEW_CATEGORY && (
          <TextField
            label="Nome da nova categoria"
            value={value.newCategoryName}
            onChange={(newCategoryName) => onChange({ newCategoryName })}
            error={errors.category}
            placeholder="Ex.: PROJETOS"
            maxLength={NAME_MAX}
            autoComplete="off"
            disabled={disabled}
          />
        )}
      </div>

      {/* §2 não dá tópico a canal de voz. */}
      {isText && (
        <TextArea
          label="Tópico (opcional)"
          value={value.topic}
          onChange={(topic) => onChange({ topic })}
          placeholder="Sobre o que se fala aqui?"
          maxLength={TOPIC_MAX}
          counterWarningAt={TOPIC_MAX - 12}
          showCounter
          rows={2}
          disabled={disabled}
        />
      )}

      <div className="flex flex-col gap-3">
        <Toggle
          checked={value.readOnly}
          onChange={(readOnly) => onChange({ readOnly })}
          label="Somente-leitura"
          description="Só os cargos marcados abaixo postam aqui. É assim que um canal de avisos funciona."
          disabled={disabled}
        />

        {value.readOnly && (
          <fieldset className="flex flex-col gap-2 rounded-md border border-border-default p-3">
            <legend className="px-1 text-caption text-text-secondary uppercase">
              Quem pode postar
            </legend>
            {roles.map((role) => (
              <Checkbox
                key={role.id}
                checked={value.canPostRoleIds.includes(role.id)}
                onChange={(checked) =>
                  onChange({
                    canPostRoleIds: checked
                      ? [...value.canPostRoleIds, role.id]
                      : value.canPostRoleIds.filter((id) => id !== role.id),
                  })
                }
                label={role.name}
              />
            ))}
            {value.canPostRoleIds.length === 0 && (
              <p className="text-meta text-feedback-warning">
                Ninguém poderia postar. Marque ao menos um cargo.
              </p>
            )}
          </fieldset>
        )}
      </div>
    </div>
  );
}
