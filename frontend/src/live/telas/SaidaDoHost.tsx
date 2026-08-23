/**
 * Impacto de fechar — U-06 e §18.7.
 *
 * O modal antigo oferecia "avisar quem está online" postando uma mensagem de sistema. A
 * opção foi **removida** (F-43: a mensagem era appendada e o host desligava em seguida,
 * quase certamente antes de ela replicar; RT-13: "mensagem de sistema" não existe no modelo
 * de domínio). O que fica é o que é verdade: quantas pessoas caem e quantas operações ainda
 * não replicaram.
 *
 * `pendingReplication` é o número que muda a decisão — esperar alguns segundos pode ser a
 * diferença entre a operação chegar aos outros dispositivos ou não. Por isso o botão de
 * fechar não é o único, e a contagem fica visível enquanto se decide.
 */

import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../ipc/api";
import { confirmarSaida, ouvirPedidoDeSaida } from "../../ipc/bridge";

type Impacto = Awaited<ReturnType<typeof api.hostExitImpact>>;

export function SaidaDoHost() {
  const [aberto, setAberto] = useState(false);
  const [impacto, setImpacto] = useState<Impacto | null>(null);

  useEffect(() => ouvirPedidoDeSaida(() => setAberto(true)), []);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    const ler = (): void => {
      void api
        .hostExitImpact()
        .then((i) => {
          if (vivo) setImpacto(i);
        })
        .catch(() => {
          if (vivo) setImpacto([]);
        });
    };
    ler();
    // A fila esvazia enquanto a pessoa lê: o número precisa acompanhar, senão ela decide
    // sobre um dado que já não vale.
    const t = setInterval(ler, 1000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [aberto]);

  if (!aberto) return null;

  const afetadas = (impacto ?? []).filter((c) => c.onlineCount > 0 || c.pendingReplication > 0);
  const pessoas = afetadas.reduce((n, c) => n + c.onlineCount, 0);
  const pendentes = afetadas.reduce((n, c) => n + c.pendingReplication, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay-scrim p-6">
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-primary p-6">
        <h2 className="text-h2 text-text-primary">Fechar o aplicativo</h2>

        {impacto === null ? (
          <p className="mt-3 flex items-center gap-2 text-meta text-text-secondary">
            <Spinner /> Verificando o impacto…
          </p>
        ) : afetadas.length === 0 ? (
          <p className="mt-3 text-meta text-text-secondary">
            Você não hospeda nenhuma comunidade com gente conectada e não há operação pendente.
          </p>
        ) : (
          <>
            <p className="mt-3 text-meta text-text-secondary">
              {pessoas > 0
                ? `Fechar agora desconecta ${pessoas} ${pessoas === 1 ? "pessoa" : "pessoas"}.`
                : "Ninguém está conectado agora."}{" "}
              {pendentes > 0
                ? `${pendentes} ${pendentes === 1 ? "operação ainda está sendo enviada" : "operações ainda estão sendo enviadas"} para outros dispositivos — aguarde alguns segundos para não perdê-las.`
                : "Nada pendente de envio."}
            </p>

            <ul className="mt-3 flex flex-col gap-1">
              {afetadas.map((c) => (
                <li key={c.communityId} className="flex justify-between text-caption text-text-tertiary">
                  <span className="truncate">{c.name}</span>
                  <span>
                    {c.onlineCount} online · {c.inCallCount} em chamada · {c.pendingReplication} pendentes
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAberto(false)}>
            Continuar aberto
          </Button>
          <Button variant={pendentes > 0 ? "danger" : "primary"} onClick={() => void confirmarSaida()}>
            Fechar mesmo assim
          </Button>
        </div>
      </div>
    </div>
  );
}
