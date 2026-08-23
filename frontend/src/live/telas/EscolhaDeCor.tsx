/**
 * Seletor da paleta curada de §6.4.2.
 *
 * O valor é o **número** do catálogo, que é o que viaja no fio; o token de tema só aparece
 * no `background`. A paleta é fechada e não há color-picker livre — cor fora da faixa é
 * `E_VALIDATION`, e oferecer o que o núcleo recusa seria desenhar uma promessa falsa.
 */

import { CATALOGO, type TokenDeCor } from "../../ipc/cores";
import { corDe } from "./formato";

export function EscolhaDeCor({
  valor,
  aoEscolher,
  paleta = CATALOGO,
  desabilitado = false,
}: {
  valor: number;
  aoEscolher: (n: number) => void;
  /** `CORES_DE_CARGO` onde `accent` não é atribuível (cargo); o catálogo inteiro no resto. */
  paleta?: readonly TokenDeCor[];
  desabilitado?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {paleta.map((token, n) => (
        <button
          key={token}
          type="button"
          aria-label={token}
          aria-pressed={valor === n}
          disabled={desabilitado}
          onClick={() => aoEscolher(n)}
          className={
            "size-8 rounded-full border-2 disabled:opacity-50 " +
            (valor === n ? "border-text-primary" : "border-transparent")
          }
          style={{ backgroundColor: corDe(n) }}
        />
      ))}
    </div>
  );
}
