/**
 * Sucessão de host — U-18c (`deltas-ux-v2.md`), §18.8 e §18.8.1.
 *
 * Duas superfícies, e as duas saem de `query.community` (§15.6):
 *
 *  - **a oferta**: minha chave está em `successorKeys` e o host está inativo há pelo menos
 *    `INACTIVE_COMMUNITY_DAYS`. `community.assumeHost` é ⏱ e `main-confirmed` — o diálogo
 *    nativo vem antes do quadro, como manda §15.3;
 *  - **as reentradas pendentes**: `pendingReentry` só existe quando esta comunidade é
 *    continuação e a origem está replicada aqui (L-23). Ausente é ausente: a tela não
 *    inventa lista vazia com ar de "ninguém falta".
 *
 * O texto obrigatório de U-18 é reproduzido literalmente. Ele não é decoração: é o que
 * impede a pessoa de assumir achando que leva as pessoas e o histórico junto.
 */

import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { api } from "../../ipc/api";
import { useComunidades } from "../comunidades";
import { useSessao, mensagemDeErro } from "../sessao";

const DIAS_INATIVA = 30;

const TEXTO_OBRIGATORIO =
  "Assumir cria uma continuação da comunidade: canais, cargos e moderação são preservados. " +
  "As pessoas precisam entrar de novo — cada uma entra com a própria chave, por convite, e " +
  "recebe os cargos que tinha. O histórico de mensagens permanece na comunidade original e " +
  "continua acessível para quem já o tem.";

export function Sucessao() {
  const detalhe = useComunidades((s) => s.detalhe);
  const hostStatus = useComunidades((s) => s.hostStatus);
  const recarregarAtiva = useComunidades((s) => s.recarregarAtiva);
  const carregarLista = useComunidades((s) => s.carregarLista);
  const eu = useSessao((s) => s.identidade);

  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (detalhe === null || eu === null) return null;

  const souSucessor = detalhe.successorKeys.includes(eu.key);
  const diasInativo = hostStatus?.inactiveDays;
  // Sem `inactiveDays` não há dias para contar (emenda de §15.6): a oferta não aparece por
  // suposição. `unknown`/ausente nunca vira "inativo há bastante tempo".
  const hostParado = diasInativo !== undefined && diasInativo >= DIAS_INATIVA;
  const ofertaAberta = souSucessor && !detalhe.isHost && hostParado;
  const pendentes = detalhe.pendingReentry;

  if (!ofertaAberta && pendentes === undefined) return null;

  async function assumir(): Promise<void> {
    setOcupado(true);
    setErro(null);
    try {
      await api.communityAssumeHost(detalhe!.id);
      await carregarLista();
      await recarregarAtiva();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-border-subtle bg-surface-sidebar p-4">
      {ofertaAberta && (
        <section>
          <h3 className="text-body-emphasis text-text-primary">Assumir a hospedagem</h3>
          <p className="mt-1 text-meta text-text-secondary">
            O host de <strong>{detalhe.name}</strong> não é visto há {diasInativo} dias e você está na lista de
            sucessores.
          </p>
          <p className="mt-3 rounded-md border border-border-subtle bg-surface-elevated p-3 text-meta text-text-secondary">
            {TEXTO_OBRIGATORIO}
          </p>
          <Button className="mt-3" fullWidth loading={ocupado} onClick={() => void assumir()}>
            Assumir a hospedagem
          </Button>
          {erro !== null && <p className="mt-2 text-meta text-feedback-danger">{erro}</p>}
        </section>
      )}

      {pendentes !== undefined && (
        <section className={ofertaAberta ? "mt-6" : ""}>
          <h3 className="text-body-emphasis text-text-primary">Reentradas pendentes</h3>
          <p className="mt-1 text-meta text-text-secondary">
            Quem estava ativo na comunidade original e ainda não entrou nesta continuação. Cada pessoa entra por
            convite, com a própria chave.
          </p>
          {pendentes.length === 0 ? (
            <p className="mt-3 text-meta text-text-tertiary">Ninguém pendente.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {pendentes.map((p) => (
                <li key={p.key} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="flex size-7 items-center justify-center rounded-full text-caption text-text-on-accent"
                    style={{ backgroundColor: `var(--color-${p.avatarColor}, var(--color-accent-default))` }}
                  >
                    {p.displayName.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-meta text-text-primary">{p.displayName}</span>
                  <span className="text-caption text-text-tertiary">{p.handle}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </aside>
  );
}
