import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Network, RefreshCw } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { cn } from "../../lib/cn";
import { avatarColorFromSeed, nextAvatarColor } from "../../lib/avatar";
import { useIdentityStore } from "../../store/identityStore";
import type { AvatarColor } from "../../domain/types";

/** §13 — Nome: obrigatório, 2-32 caracteres, sem checagem de unicidade. */
const NAME_MIN = 2;
const NAME_MAX = 32;
/** Acima disto o contador vira `feedback-warning` (§7, 0.1). */
const NAME_WARNING_AT = 28;

/** Geração do par de chaves simulada (§11, A1 passo 4). */
const CREATE_DELAY_MS = 600;
/** Casado com `--duration-slow` (§5.9) — transição de tela cheia. */
const SUCCESS_TRANSITION_MS = 320;

type Phase = "editing" | "submitting" | "success";

function validate(rawName: string): string | undefined {
  const name = rawName.trim();
  if (name.length === 0) return "Digite um nome de exibição.";
  if (name.length < NAME_MIN)
    return `O nome precisa ter pelo menos ${NAME_MIN} caracteres.`;
  return undefined;
}

/**
 * 0.1 Onboarding / criar identidade local — fluxo A1.
 *
 * Primeira coisa que qualquer instalação nova mostra: sem chrome de
 * navegação, sem "voltar", nada existe antes disso.
 */
export function OnboardingScreen() {
  const createIdentity = useIdentityStore((state) => state.createIdentity);

  const [name, setName] = useState("");
  const [avatarColor, setAvatarColor] = useState<AvatarColor>(() =>
    avatarColorFromSeed(crypto.randomUUID()),
  );
  const [error, setError] = useState<string | undefined>();
  const [phase, setPhase] = useState<Phase>("editing");

  const inputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(window.clearTimeout);
  }, []);

  const isValid = validate(name) === undefined;

  function handleNameChange(value: string) {
    setName(value);
    // Erro some assim que o campo volta a ser válido; o contador é a
    // validação em tempo real, o erro é do submit/blur (§7, 0.1).
    if (error && validate(value) === undefined) setError(undefined);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== "editing") return;

    const validationError = validate(name);
    if (validationError) {
      setError(validationError);
      inputRef.current?.focus();
      return;
    }

    setPhase("submitting");
    timers.current.push(
      window.setTimeout(() => {
        setPhase("success");
        timers.current.push(
          window.setTimeout(() => {
            // Só aqui a rota `/` passa a resolver para o shell — assim a
            // transição de saída chega a ser vista (§7, 0.1).
            createIdentity({ displayName: name, avatarColor });
          }, SUCCESS_TRANSITION_MS),
        );
      }, CREATE_DELAY_MS),
    );
  }

  /**
   * Enter com campo inválido mostra o mesmo erro inline, sem navegar
   * (§11, A1 exceções) — o submit implícito não dispara com o botão
   * primário desabilitado, então tratamos aqui.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || isValid) return;
    event.preventDefault();
    setError(validate(name));
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-surface-app px-4 py-8 tablet:px-8">
      <div
        className={cn(
          "w-full max-w-[420px] transition-all ease-in duration-(--duration-slow)",
          phase === "success" && "-translate-y-2 opacity-0",
        )}
      >
        <div className="mb-8 flex items-center gap-2">
          <span
            className="grid size-8 place-items-center rounded-lg bg-accent-default text-text-on-accent"
            aria-hidden="true"
          >
            <Network size={18} strokeWidth={2} />
          </span>
          <span className="text-body-emphasis text-text-secondary">
            Comunidade P2P
          </span>
        </div>

        <h1 className="text-heading-1 text-text-primary">Crie sua identidade</h1>
        <p className="mt-2 text-body text-text-secondary">
          Não existe conta nem servidor central aqui. Sua identidade é um par de
          chaves gerado agora e guardado só neste dispositivo.
        </p>

        <form className="mt-6 flex flex-col gap-6" onSubmit={handleSubmit}>
          <TextField
            ref={inputRef}
            label="Nome de exibição"
            value={name}
            onChange={handleNameChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setError(validate(name))}
            error={error}
            placeholder="Como as pessoas vão te ver"
            maxLength={NAME_MAX}
            counterWarningAt={NAME_WARNING_AT}
            showCounter
            autoFocus
            autoComplete="off"
            spellCheck={false}
            disabled={phase !== "editing"}
          />

          <div className="flex items-center gap-4 rounded-md border border-border-default bg-surface-sidebar p-4">
            <Avatar
              name={name}
              color={avatarColor}
              size="lg"
              presenceRingClass="border-surface-sidebar"
            />
            <div className="flex min-w-0 flex-col items-start gap-2">
              <p className="text-body-emphasis text-text-primary">Seu avatar</p>
              <p className="text-meta text-text-tertiary">
                As iniciais do seu nome sobre uma cor sorteada. Sem upload de
                imagem nesta versão.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAvatarColor(nextAvatarColor(avatarColor))}
                disabled={phase !== "editing"}
                leadingIcon={<RefreshCw size={16} strokeWidth={2} />}
              >
                Gerar outra cor
              </Button>
            </div>
          </div>

          <Button
            type="submit"
            size="lg"
            fullWidth
            disabled={!isValid}
            loading={phase !== "editing"}
          >
            Criar identidade
          </Button>
        </form>

        <p className="mt-6 text-meta text-text-tertiary">
          A chave privada nunca sai deste dispositivo — e não há como
          recuperá-la em outro lugar.
        </p>
      </div>
    </main>
  );
}
