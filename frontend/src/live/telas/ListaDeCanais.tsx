/**
 * Lista de canais da comunidade ativa — `query.structure` (§15.6).
 *
 * A estrutura vem pronta do núcleo: categorias em `rank`, canais em `rank`, `unread`,
 * `muted`, `readOnly` e a ocupação de voz por canal (`voice`, que fecha `RT-05`). A tela não
 * reordena e não recalcula nada disso — ordenar aqui seria escrever a regra de `rank` uma
 * segunda vez, fora do `fold`.
 */

import { useComunidades } from "../comunidades";
import { useCanal } from "../canal";

export function ListaDeCanais() {
  const estrutura = useComunidades((s) => s.estrutura);
  const detalhe = useComunidades((s) => s.detalhe);
  const ativa = useComunidades((s) => s.ativa);
  const canalAtivo = useComunidades((s) => s.canalAtivo);
  const selecionarCanal = useComunidades((s) => s.selecionarCanal);
  const abrir = useCanal((s) => s.abrir);

  if (ativa === null) return null;

  const encerrada = detalhe?.endedAt !== undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-sidebar">
      <header className="flex h-12 shrink-0 items-center border-b border-border-subtle px-4">
        <h2 className="truncate text-body-emphasis text-text-primary">{detalhe?.name ?? "…"}</h2>
      </header>

      {encerrada && (
        <p className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">
          Encerrada — somente leitura
        </p>
      )}

      <div className="flex flex-col gap-4 py-3">
        {(estrutura?.categories ?? []).map((cat) => (
          <section key={cat.id}>
            <h3 className="px-4 pb-1 text-caption uppercase text-text-tertiary">{cat.name}</h3>
            <ul>
              {cat.channels.map((ch) => {
                const selecionado = canalAtivo === ch.id;
                return (
                  <li key={ch.id}>
                    <button
                      type="button"
                      onClick={() => {
                        void selecionarCanal(ch.id);
                        void abrir(ativa, ch.id);
                      }}
                      className={
                        "flex w-full items-center gap-2 px-4 py-1.5 text-left transition-colors " +
                        (selecionado
                          ? "bg-surface-elevated text-text-primary"
                          : "text-text-secondary hover:bg-surface-elevated/60 hover:text-text-primary")
                      }
                    >
                      <span aria-hidden className="text-text-tertiary">
                        #
                      </span>
                      <span className={"flex-1 truncate " + (ch.muted ? "opacity-50" : "")}>{ch.name}</span>

                      {/* `voice.count` é do próprio `query.structure`; não há segunda fonte. */}
                      {ch.voice !== undefined && ch.voice.count > 0 && (
                        <span className="text-caption text-text-tertiary">{ch.voice.count} na voz</span>
                      )}

                      {ch.unread.count > 0 && (
                        <span
                          className={
                            "min-w-5 rounded-full px-1 text-center text-caption text-text-on-accent " +
                            (ch.unread.mentions > 0 ? "bg-feedback-danger" : "bg-accent-default")
                          }
                        >
                          {ch.unread.mentions > 0 ? ch.unread.mentions : ch.unread.count}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
