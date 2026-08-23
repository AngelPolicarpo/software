/**
 * Modo histórico por moderação — §18.4 e delta U-16.
 *
 * Ao observar o próprio ban ou kick, a comunidade não some nem quebra: ela entra em leitura
 * histórica, com um cabeçalho que diz o que aconteceu, quem fez e por quê (quando há motivo),
 * e por quanto tempo a cópia local fica. O ciclo de vida do dado no cliente do alvo é
 * justamente o que não existia (F-35, DR-35).
 */

import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { api } from "../../ipc/api";
import { useComunidade } from "../comunidade";
import { useComunidades } from "../comunidades";
import { mensagemDeErro } from "../sessao";
import { dataHora } from "./formato";

/** §18.4 — a cópia local de uma comunidade perdida é mantida por 7 dias. */
const DIAS_RETIDOS = 7;

export function ModeracaoPropria() {
  const self = useComunidade((s) => s.selfModeration);
  const detalhe = useComunidades((s) => s.detalhe);
  const carregarLista = useComunidades((s) => s.carregarLista);
  const selecionar = useComunidades((s) => s.selecionarComunidade);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (self === null || detalhe === null) return null;
  if (!self.banned && !self.kicked) return null;

  const acao = self.banned ? "banida" : "expulsa";

  return (
    <div className="border-b border-border-subtle bg-conn-failed/15 px-4 py-3">
      <p className="text-body-emphasis text-text-primary">
        Você foi {acao} de {detalhe.name}
        {self.byLabel !== undefined ? ` por ${self.byLabel}` : ""}.
      </p>
      {self.reason !== undefined && <p className="text-meta text-text-secondary">Motivo: {self.reason}</p>}
      {self.bannedAt !== undefined && (
        <p className="text-caption text-text-tertiary">Em {dataHora(self.bannedAt)}.</p>
      )}
      <p className="mt-1 text-meta text-text-secondary">
        A comunidade fica em leitura histórica: você continua vendo o que já tinha, e não há escrita.
        A cópia local é mantida por {DIAS_RETIDOS} dias.
      </p>
      <div className="mt-2">
        <Button
          size="sm"
          variant="secondary"
          loading={ocupado}
          onClick={() => {
            // Ban e kick já deixam a comunidade em `removed`, que é exatamente o estado que
            // `community.forget` aceita (§15.4). É `main-confirmed`: o diálogo nativo vem
            // antes, porque isto apaga bytes do disco e não tem volta.
            setOcupado(true);
            setErro(null);
            void api
              .communityForget(detalhe.id)
              .then(async () => {
                await selecionar(null);
                await carregarLista();
              })
              .catch((e: unknown) => setErro(mensagemDeErro(e)))
              .finally(() => setOcupado(false));
          }}
        >
          Apagar a cópia local agora
        </Button>
      </div>
      {erro !== null && <p className="mt-1 text-caption text-feedback-danger">{erro}</p>}
    </div>
  );
}
