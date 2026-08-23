/**
 * Cartão de anexo (§13, §15.6.1 `AttachmentDto`).
 *
 * Os números do cartão são os do fio, e o que eles significam está na emenda de 2026-08-22:
 * `availablePeers`/`hostAvailable` são leitura do **bitfield vivo**, então `0`/`false` fora
 * de um download em curso não é "ninguém tem o arquivo" — é "não há par conectado àquele
 * core agora". A tela diz isso com essas palavras em vez de traduzir para uma promessa que
 * o dado não faz.
 *
 * `progress` da consulta é a foto do instante; o progresso VIVO chega por `blob.progress` a
 * cada 500 ms, e é o único caso em que o payload do evento vira estado — não há query de
 * progresso na tabela de §15.6.
 */

import { Button } from "../../components/ui/Button";
import { useMensagens } from "../mensagem";
import { tamanho } from "./formato";
import type { AttachmentDto } from "../../ipc/dto";

/** §13.2 — `kind` é numérico no fio; o rótulo é de apresentação. */
const KIND: Record<number, string> = { 0: "Arquivo", 1: "Imagem", 2: "Vídeo", 3: "Áudio", 4: "Documento", 5: "Arquivo compactado" };

/**
 * O evento e o DTO identificam o mesmo blob por caminhos DIFERENTES: `blob.progress` traz
 * `blobIdHex` (o id de 16 bytes, chave do cache local — emenda de 2026-08-22 em §15.5),
 * enquanto `AttachmentDto` traz o quádruplo de §7.2.1 e o `hash` completo. §15.6 não declara
 * a ponte entre os dois; ela existe no núcleo, que usa os 32 primeiros caracteres do hash
 * como id do cache. A tela repete essa derivação porque é a única correlação possível — e
 * fica registrada como pendência de spec (§58.5), já que uma correlação não declarada é uma
 * que pode mudar sem aviso.
 */
function chaveDeProgresso(a: AttachmentDto): string {
  return a.hash.slice(0, 32);
}

export function Anexo({ a }: { a: AttachmentDto }) {
  const baixar = useMensagens((s) => s.baixar);
  const cancelar = useMensagens((s) => s.cancelarDownload);
  const revelar = useMensagens((s) => s.revelar);
  const vivo = useMensagens((s) => s.progresso[chaveDeProgresso(a)]);

  const baixado = a.localPath !== undefined;
  const progresso = vivo?.progress ?? a.progress;
  const baixando = !baixado && progresso > 0 && progresso < 1;
  const pares = vivo?.peers ?? a.availablePeers;
  const hostTem = vivo?.hostAvailable ?? a.hostAvailable;

  return (
    <div className="mt-1 max-w-lg rounded-md border border-border-subtle bg-surface-elevated p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-emphasis text-text-primary">{a.name}</p>
          <p className="text-caption text-text-tertiary">
            {KIND[a.kind] ?? "Arquivo"} · {tamanho(a.sizeBytes)}
          </p>
        </div>
        {baixado ? (
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" onClick={() => void revelar(a, "open")}>
              Abrir
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void revelar(a, "folder")}>
              Na pasta
            </Button>
          </div>
        ) : baixando ? (
          <Button size="sm" variant="ghost" onClick={() => void cancelar(a)}>
            Cancelar
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void baixar(a)}>
            Baixar
          </Button>
        )}
      </div>

      {baixando && (
        <div className="mt-2">
          <div className="h-1 overflow-hidden rounded-full bg-surface-primary">
            <div className="h-full bg-accent-default" style={{ width: `${Math.round(progresso * 100)}%` }} />
          </div>
          <p className="mt-1 text-caption text-text-tertiary">
            {Math.round(progresso * 100)}% · {pares} {pares === 1 ? "par conectado" : "pares conectados"}
            {hostTem ? " · o host tem os bytes" : ""}
          </p>
        </div>
      )}

      {!baixado && !baixando && (
        <p className="mt-2 text-caption text-text-tertiary">
          {pares === 0 && !hostTem
            ? "Nenhum par conectado a este arquivo agora — o que não quer dizer que ninguém o tenha."
            : `${pares} ${pares === 1 ? "par conectado" : "pares conectados"}${hostTem ? " · o host tem os bytes" : ""}`}
        </p>
      )}
    </div>
  );
}
