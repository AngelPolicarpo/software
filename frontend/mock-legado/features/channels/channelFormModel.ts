import { channelName } from "../../lib/channelName";
import type { ChannelType } from "../../domain/types";

/** §13 — nome 1-32, tópico até 120. */
export const NAME_MAX = 32;
export const TOPIC_MAX = 120;

/** Opção final do select de categoria, que abre o campo de nome inline. */
export const NEW_CATEGORY = "__new__";

export interface ChannelFormValue {
  type: ChannelType;
  name: string;
  topic: string;
  categoryId: string;
  newCategoryName: string;
  readOnly: boolean;
  /** Cargos que **podem** postar; o inverso vira `readOnlyForRoleIds` (§2). */
  canPostRoleIds: string[];
}

export interface ChannelFormErrors {
  name?: string;
  category?: string;
}

/**
 * §13 — nome obrigatório, e em canal de texto ele não pode normalizar pra
 * vazio (o nome é o endereço do canal). Duplicidade é bloqueante dentro da
 * mesma comunidade, diferente do nome de comunidade, onde duplicar só avisa.
 */
export function validateChannelForm(
  value: ChannelFormValue,
  takenNames: string[],
): ChannelFormErrors {
  const errors: ChannelFormErrors = {};
  const resolved = channelName(value.type, value.name);

  if (value.name.trim().length === 0)
    errors.name = "Digite um nome para o canal.";
  else if (resolved.length === 0)
    errors.name = "Use ao menos uma letra ou número.";
  else if (takenNames.includes(resolved.toLowerCase()))
    errors.name =
      value.type === "text"
        ? `Já existe um canal #${resolved} nesta comunidade.`
        : `Já existe um canal ${resolved} nesta comunidade.`;

  if (
    value.categoryId === NEW_CATEGORY &&
    value.newCategoryName.trim().length === 0
  )
    errors.category = "Digite um nome para a categoria.";

  return errors;
}
