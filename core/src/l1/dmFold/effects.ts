// `DmEffect` — §31.7.6. Tipo **fechado**, quatro formas.
//
// O `dmFold` emite `DmEffect[]`; o projetor aplica a lista **na ordem**, dentro de **uma
// transação por lote**, e emite os `notify` **depois do commit** (§10.7). Ele não decide
// nada.
//
// Quatro formas contra as doze de §8.4, e cada ausência tem razão declarada em §31.7.6:
//
// | Ausente                    | Por quê                                                      |
// |----------------------------|--------------------------------------------------------------|
// | `patchScope`               | Não há ban que oculte N mensagens nem canal apagado que orfanize N — os dois casos que o obrigaram a existir |
// | `ftsIndex` / `ftsRemove`   | Sem FTS para DM no v1 (§31.12)                               |
// | `audit`                    | Não há moderação numa conversa de dois (§31.5)               |
// | `recount`                  | Não há contagem derivada de população                        |

export type DmPrimitive = string | number | null | Buffer;

/**
 * As tabelas de conteúdo de DM em `view.db` (§31.12) alcançadas pelos 6 `kind`s de §31.5.
 *
 * `dm_ds_snapshot` não está aqui: ela é do projetor, não de efeito. `dm_rejected_records`
 * também não: ela é diagnóstico e o projetor a escreve a partir do `DmFoldResult`, pelo mesmo
 * arranjo que `rejected_records` já usa em §10.3.
 */
export type DmTable = 'dm_messages' | 'dm_reactions' | 'dm_attachments' | 'dm_participants';

/**
 * Chave primária da linha, **sem** `conversation_id`: quem projeta já sabe a conversa.
 * §31.4: "Chave primária de toda tabela de conteúdo de DM é `(conversation_id, id)`."
 */
export type DmEntityKey = readonly DmPrimitive[];

/** Tópico de §31.16.2. O `dmFold` só produz os que decorrem de um registro do log. */
export type DmEventTopic =
  | 'dm.appended'
  | 'dm.messageUpdated'
  | 'dm.conversationChanged'
  | 'dm.partialInterpretation';

export type DmEffect =
  | {
      readonly t: 'upsert';
      readonly table: DmTable;
      readonly key: DmEntityKey;
      readonly row: Readonly<Record<string, DmPrimitive>>;
    }
  | {
      readonly t: 'patch';
      readonly table: DmTable;
      readonly key: DmEntityKey;
      readonly fields: Readonly<Record<string, DmPrimitive>>;
    }
  | { readonly t: 'delete'; readonly table: DmTable; readonly key: DmEntityKey }
  | { readonly t: 'notify'; readonly topic: DmEventTopic; readonly data: object };
