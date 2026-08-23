/**
 * Primeiro uso (§3.3, §5.5, §15.4 "Identidade e app").
 *
 * O gate é `core.status.phase === 'awaiting-identity'`. Duas saídas: criar identidade nova
 * (`identity.create`, classe `open` — é o comando que tira o núcleo desta fase) ou restaurar
 * um backup (`identity.import`, `main-confirmed`: o diálogo nativo vem antes, e o arquivo
 * nunca cruza o IPC-R — §13.3 r. 5).
 *
 * O erro aparece NO campo que o núcleo nomeou: o roteador já devolve `field` (§15.2), e é
 * por isso que a tela não precisa adivinhar de qual campo a recusa é.
 */

import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { useSessao } from "../sessao";
import { campoDoErro, codigoDoErro, IpcCommandError } from "../../ipc/frames";

/** §5.4 — paleta curada; o núcleo valida, a tela não inventa cor livre. */
const CORES = ["role-gold", "role-blue", "role-green", "role-red", "role-purple", "role-pink", "role-neutral"] as const;

const MOTIVO: Record<string, string> = {
  E_IDENTITY_EXISTS: "Já existe uma identidade nesta instalação.",
  E_VALIDATION: "Valor recusado pelo núcleo.",
  E_KEYSTORE_UNAVAILABLE: "O cofre de chaves do sistema não está disponível.",
  E_KEYSTORE_INSECURE: "O cofre de chaves está em modo inseguro; a criação exige aceite explícito.",
  E_BAD_PASSPHRASE: "Frase secreta incorreta.",
  E_MALFORMED: "O arquivo de backup não foi reconhecido.",
  E_CANCELLED: "Confirmação cancelada.",
};

function descrever(e: unknown): string {
  const code = codigoDoErro(e);
  const conhecido = MOTIVO[code];
  if (conhecido !== undefined) return conhecido;
  return e instanceof IpcCommandError ? `${code} — ${e.message}` : "Falha inesperada.";
}

export function PrimeiroUso() {
  const criar = useSessao((s) => s.criarIdentidade);
  const importar = useSessao((s) => s.importarIdentidade);

  const [aba, setAba] = useState<"criar" | "restaurar">("criar");
  const [displayName, setDisplayName] = useState("");
  const [cor, setCor] = useState<string>(CORES[1]);
  const [passphrase, setPassphrase] = useState("");
  const [erro, setErro] = useState<{ campo?: string; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function acionar(fn: () => Promise<void>): Promise<void> {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
    } catch (e) {
      setErro({ campo: campoDoErro(e), texto: descrever(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-surface-app p-6">
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-primary p-6">
        <h1 className="text-h2 text-text-primary">Sua identidade</h1>
        <p className="mt-2 text-meta text-text-secondary">
          A identidade é um par de chaves que fica nesta máquina. Ela não é registrada em
          servidor nenhum: sem o backup, ninguém a recupera por você.
        </p>

        <div className="mt-5 flex gap-1 rounded-md bg-surface-elevated p-1">
          {(["criar", "restaurar"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setAba(v);
                setErro(null);
              }}
              className={
                "flex-1 rounded px-3 py-1.5 text-body-emphasis transition-colors " +
                (aba === v ? "bg-surface-primary text-text-primary" : "text-text-secondary hover:text-text-primary")
              }
            >
              {v === "criar" ? "Criar" : "Restaurar backup"}
            </button>
          ))}
        </div>

        {aba === "criar" ? (
          <div className="mt-5 flex flex-col gap-4">
            <TextField
              label="Nome de exibição"
              value={displayName}
              onChange={setDisplayName}
              maxLength={32}
              showCounter
              counterWarningAt={28}
              error={erro?.campo === "displayName" ? erro.texto : undefined}
              autoFocus
            />
            <div className="flex flex-col gap-2">
              <span className="text-caption text-text-secondary uppercase">Cor do avatar</span>
              <div className="flex flex-wrap gap-2">
                {CORES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    aria-pressed={cor === c}
                    onClick={() => setCor(c)}
                    className={
                      "size-8 rounded-full border-2 transition-colors " +
                      (cor === c ? "border-text-primary" : "border-transparent")
                    }
                    style={{ backgroundColor: `var(--color-${c})` }}
                  />
                ))}
              </div>
            </div>
            {erro !== null && erro.campo !== "displayName" && (
              <p className="text-meta text-feedback-danger">{erro.texto}</p>
            )}
            <Button
              fullWidth
              size="lg"
              loading={ocupado}
              disabled={displayName.trim().length === 0}
              onClick={() => void acionar(() => criar({ displayName: displayName.trim(), avatarColor: cor }))}
            >
              Criar identidade
            </Button>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-4">
            <p className="text-meta text-text-secondary">
              A restauração pede a confirmação nativa do sistema e abre o seletor de arquivo
              fora desta janela — o backup nunca passa pela interface.
            </p>
            <TextField
              label="Frase secreta do backup"
              type="password"
              value={passphrase}
              onChange={setPassphrase}
              error={erro?.campo === "passphrase" ? erro.texto : undefined}
            />
            {erro !== null && erro.campo !== "passphrase" && (
              <p className="text-meta text-feedback-danger">{erro.texto}</p>
            )}
            <Button
              fullWidth
              size="lg"
              variant="secondary"
              loading={ocupado}
              disabled={passphrase.length === 0}
              onClick={() => void acionar(() => importar(passphrase))}
            >
              Restaurar identidade
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
