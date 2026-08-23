/**
 * Shell do produto: rail, canais, canal aberto e o painel de sucessão quando há oferta ou
 * reentradas pendentes (U-18c).
 *
 * Nenhuma rota: dentro do Electron não há barra de endereço, e §4 do mock já dizia que
 * comunidade e canal selecionados são estado, não recurso endereçável. Os deep links chegam
 * como evento do main (§3.5), não como URL.
 */

import { useEffect } from "react";
import { Rail } from "./Rail";
import { ListaDeCanais } from "./ListaDeCanais";
import { Canal } from "./Canal";
import { Sucessao } from "./Sucessao";
import { ConviteOverlay, MensagemLinkOverlay } from "./DeepLinks";
import { useComunidades } from "../comunidades";
import { useSessao } from "../sessao";
import { StatusBanner } from "../../components/ui/StatusBanner";

export function Shell() {
  const carregarLista = useComunidades((s) => s.carregarLista);
  const lista = useComunidades((s) => s.lista);
  const ativa = useComunidades((s) => s.ativa);
  const selecionar = useComunidades((s) => s.selecionarComunidade);
  const estado = useSessao((s) => s.estado);
  const status = useSessao((s) => s.status);

  useEffect(() => {
    void carregarLista();
  }, [carregarLista]);

  // Sem escolha explícita, abre a primeira do rail — a ordem de `query.communities` é a de
  // entrada, e é ela que decide, não um critério inventado aqui.
  useEffect(() => {
    if (ativa === null && lista.length > 0) void selecionar(lista[0]!.id);
  }, [ativa, lista, selecionar]);

  return (
    <div className="flex h-full flex-col">
      {estado === "reconectando" && (
        <StatusBanner tone="reconnecting">
          O núcleo reiniciou. As assinaturas e as consultas estão sendo refeitas; nada em voo foi reenviado.
        </StatusBanner>
      )}
      {status?.keystore === "insecure-fallback" && (
        <StatusBanner tone="degraded">
          O cofre de chaves do sistema está em modo inseguro: a chave de identidade não tem a proteção do sistema
          operacional nesta máquina.
        </StatusBanner>
      )}

      <div className="flex min-h-0 flex-1">
        <Rail />
        <ListaDeCanais />
        <Canal />
        <Sucessao />
      </div>

      <ConviteOverlay />
      <MensagemLinkOverlay />
    </div>
  );
}
