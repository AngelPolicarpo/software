/**
 * Rail de comunidades — `query.communities` (§15.6) e U-17 (`deltas-ux-v2.md`).
 *
 * Três coisas que a tabela permite e a tela usa: `unread` (contagem e menções),
 * `hostStatus` (enum fechado de nove valores) e `inactiveDays`. Duas que ela NÃO permite e
 * a tela não finge:
 *
 *  - `inactiveDays` fica **ausente** enquanto não houver contato observado com o host
 *    (emenda de 2026-08-23 em §15.6). Ausente não é zero: o rótulo simplesmente não aparece.
 *  - Presença não é campo de comunidade. Quem está de pé vem por `presence.changed`, e
 *    ausência é offline — o rail nunca desenha o valor `offline`, porque §6.1 não o publica.
 *
 * U-17: a comunidade encerrada permanece no rail, esmaecida. A aparência do modo histórico
 * é da tela do canal.
 */

import { useComunidades } from "../comunidades";
import type { CommunityListItem, HostStatus } from "../../ipc/dto";

/** §27.1 `INACTIVE_COMMUNITY_DAYS` — o rótulo do rail começa aqui. */
const DIAS_INATIVA = 30;

/** O enum é fechado (§15.6): cada valor tem cor e nome, e nenhum vira "offline" por descuido. */
const HOST: Record<HostStatus, { cor: string; rotulo: string }> = {
  unknown: { cor: "var(--color-presence-offline)", rotulo: "sem informação do host" },
  connecting: { cor: "var(--color-conn-reconnecting)", rotulo: "conectando ao host" },
  online: { cor: "var(--color-conn-ok)", rotulo: "host online" },
  reconnecting: { cor: "var(--color-conn-reconnecting)", rotulo: "reconectando ao host" },
  offline: { cor: "var(--color-conn-offline)", rotulo: "host offline" },
  ended: { cor: "var(--color-text-disabled)", rotulo: "comunidade encerrada" },
  unauthorized: { cor: "var(--color-conn-failed)", rotulo: "acesso revogado" },
  incompatible: { cor: "var(--color-conn-failed)", rotulo: "versão incompatível" },
  forked: { cor: "var(--color-conn-failed)", rotulo: "histórico bifurcado" },
};

function Icone({ c }: { c: CommunityListItem }) {
  const encerrada = c.endedAt !== undefined;
  return (
    <span
      className={
        "flex size-12 items-center justify-center rounded-2xl text-body-emphasis transition-all " +
        (encerrada ? "opacity-40 grayscale" : "")
      }
      style={{ backgroundColor: `var(--color-${c.iconColor}, var(--color-surface-elevated))` }}
    >
      {c.iconEmoji ?? c.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function Rail() {
  const lista = useComunidades((s) => s.lista);
  const ativa = useComunidades((s) => s.ativa);
  const selecionar = useComunidades((s) => s.selecionarComunidade);

  return (
    <nav
      aria-label="Comunidades"
      className="flex h-full w-20 shrink-0 flex-col items-center gap-2 overflow-y-auto bg-surface-sidebar py-3"
    >
      {lista.length === 0 && <p className="px-2 text-center text-caption text-text-tertiary">Nenhuma comunidade</p>}

      {lista.map((c) => {
        const host = HOST[c.hostStatus] ?? HOST.unknown;
        const inativa = c.inactiveDays !== undefined && c.inactiveDays >= DIAS_INATIVA;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => void selecionar(c.id)}
            title={`${c.name} — ${host.rotulo}${inativa ? ` · inativa há ${c.inactiveDays} dias` : ""}`}
            className={
              "relative rounded-2xl outline-offset-2 " + (ativa === c.id ? "outline outline-2 outline-accent-default" : "")
            }
          >
            <Icone c={c} />

            {/* Ponto do host: cor do enum fechado, nunca inferida. */}
            <span
              aria-hidden
              className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-surface-sidebar"
              style={{ backgroundColor: host.cor }}
            />

            {c.unread.count > 0 && (
              <span
                className={
                  "absolute -right-1 -top-1 min-w-5 rounded-full px-1 text-caption text-text-on-accent " +
                  (c.unread.mentions > 0 ? "bg-feedback-danger" : "bg-accent-default")
                }
              >
                {c.unread.mentions > 0 ? c.unread.mentions : c.unread.count}
              </span>
            )}

            {inativa && (
              <span className="absolute -left-1 bottom-3 rounded bg-surface-elevated px-1 text-caption text-text-tertiary">
                {c.inactiveDays}d
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
