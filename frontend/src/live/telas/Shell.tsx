/**
 * Shell do produto: rail, canais, canal aberto e o painel de sucessão quando há oferta ou
 * reentradas pendentes (U-18c).
 *
 * Nenhuma rota: dentro do Electron não há barra de endereço, e §4 do mock já dizia que
 * comunidade e canal selecionados são estado, não recurso endereçável. Os deep links chegam
 * como evento do main (§3.5), não como URL.
 */

import { useEffect, useState } from "react";
import { Rail } from "./Rail";
import { ListaDeCanais } from "./ListaDeCanais";
import { Canal } from "./Canal";
import { Sucessao } from "./Sucessao";
import { ConviteOverlay, MensagemLinkOverlay } from "./DeepLinks";
import { PainelDoCanal } from "./PainelDoCanal";
import { Thread } from "./Thread";
import { Perfil } from "./Membros";
import { Configuracoes } from "./Configuracoes";
import { Conta } from "./Conta";
import { SaidaDoHost } from "./SaidaDoHost";
import { CriarComunidade, EntrarPorConvite, Hub } from "./Hub";
import { useComunidades } from "../comunidades";
import { useSessao } from "../sessao";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { Button } from "../../components/ui/Button";
import { Avatar } from "./comuns";

export function Shell() {
  const carregarLista = useComunidades((s) => s.carregarLista);
  const lista = useComunidades((s) => s.lista);
  const ativa = useComunidades((s) => s.ativa);
  const selecionar = useComunidades((s) => s.selecionarComunidade);
  const estado = useSessao((s) => s.estado);
  const status = useSessao((s) => s.status);
  const identidade = useSessao((s) => s.identidade);
  const [tela, setTela] = useState<"nenhuma" | "configuracoes" | "conta" | "criar" | "entrar">("nenhuma");

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
        <Rail aoCriar={() => setTela("criar")} aoEntrar={() => setTela("entrar")} />
        <div className="flex w-60 shrink-0 flex-col">
          <ListaDeCanais />
          {/* Barra da própria pessoa: identidade e as duas telas de configuração. */}
          <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle bg-surface-sidebar px-2 py-2">
            {identidade !== null && (
              <>
                <Avatar user={identidade} size={28} presence={identidade.presence} />
                <span className="min-w-0 flex-1 truncate text-caption text-text-secondary">
                  {identidade.displayName}
                </span>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => setTela("conta")} title="Sua conta">
              Conta
            </Button>
            {ativa !== null && (
              <Button size="sm" variant="ghost" onClick={() => setTela("configuracoes")} title="Configurações da comunidade">
                Ajustes
              </Button>
            )}
          </div>
        </div>
        {ativa === null ? (
          <Hub aoCriar={() => setTela("criar")} aoEntrar={() => setTela("entrar")} />
        ) : (
          <>
            <Canal />
            <PainelDoCanal />
            <Thread />
            <Sucessao />
          </>
        )}
      </div>

      <Perfil />
      <ConviteOverlay />
      <MensagemLinkOverlay />
      {tela === "configuracoes" && <Configuracoes aoFechar={() => setTela("nenhuma")} />}
      {tela === "conta" && <Conta aoFechar={() => setTela("nenhuma")} />}
      {tela === "criar" && <CriarComunidade aoFechar={() => setTela("nenhuma")} />}
      {tela === "entrar" && <EntrarPorConvite aoFechar={() => setTela("nenhuma")} />}
      <SaidaDoHost />
    </div>
  );
}
