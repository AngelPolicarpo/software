/**
 * Raiz do renderer real.
 *
 * O ciclo de §3.3 chega à UI como quatro telas: sem shell, conectando, primeiro uso e
 * produto. O gate é `core.status.phase` — a fase que o núcleo declara, não uma inferência a
 * partir de erro de query.
 */

import { useEffect, useRef } from "react";
import { Spinner } from "../components/ui/Spinner";
import { Button } from "../components/ui/Button";
import { assinarCicloDoNucleo, useSessao } from "./sessao";
import { assinarComunidades } from "./comunidades";
import { assinarCanal } from "./canal";
import { assinarDeepLinks } from "./deeplink";
import { PrimeiroUso } from "./telas/PrimeiroUso";
import { Shell } from "./telas/Shell";

function Centro({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-surface-app p-6">
      <div className="max-w-md text-center">{children}</div>
    </div>
  );
}

export function LiveApp() {
  const estado = useSessao((s) => s.estado);
  const motivo = useSessao((s) => s.motivo);
  const iniciar = useSessao((s) => s.iniciar);

  useEffect(() => {
    void iniciar();
  }, [iniciar]);

  // As assinaturas só podem sair depois da porta existir; antes disso o `sub` não teria
  // para onde ir. Uma vez só, e sem cancelamento: elas duram o que a janela durar, e o
  // cliente já refaz as dele no bump de epoch (§15.2 4c).
  const assinado = useRef(false);
  useEffect(() => {
    if (assinado.current) return;
    if (estado !== "pronto" && estado !== "sem-identidade" && estado !== "reconectando") return;
    assinado.current = true;
    assinarCicloDoNucleo();
    assinarComunidades();
    assinarCanal();
    assinarDeepLinks();
  }, [estado]);

  switch (estado) {
    case "sem-shell":
      return (
        <Centro>
          <h1 className="text-h2 text-text-primary">Sem núcleo</h1>
          <p className="mt-2 text-meta text-text-secondary">{motivo}</p>
        </Centro>
      );
    case "falhou":
      return (
        <Centro>
          <h1 className="text-h2 text-text-primary">O núcleo não respondeu</h1>
          <p className="mt-2 text-meta text-text-secondary">{motivo}</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>
            Tentar de novo
          </Button>
        </Centro>
      );
    case "sem-identidade":
      return <PrimeiroUso />;
    case "pronto":
    case "reconectando":
      return <Shell />;
    default:
      return (
        <Centro>
          <p className="flex items-center justify-center gap-2 text-meta text-text-secondary">
            <Spinner /> Conectando ao núcleo…
          </p>
        </Centro>
      );
  }
}
