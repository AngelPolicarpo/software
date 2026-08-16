// `errors` — L1, taxonomia fechada de §20. Não depende de nada (§4).
//
// Duas regras de §4 moldam este arquivo:
//
//   1. `errors` **não pode conter texto em português**. Os comentários explicam; toda
//      string que atravessa fronteira é inglesa, como §20.1 manda.
//   2. `fold` **não pode lançar exceção**, e o `fold` constrói erros. Então nada aqui
//      valida em runtime: as regras de §20.1 sobre quando `field` e `retryAfterMs`
//      existem estão no **tipo**. Uso errado quebra o build, não a corrida.

import { ERROR_CATALOG, type ErrorClass, type ErrorCode, type RetryPolicy } from './codes.ts';

export {
  ERROR_CATALOG,
  ERROR_CODES,
  type ErrorClass,
  type ErrorCode,
  type ErrorSpec,
  type RetryPolicy,
} from './codes.ts';

/** A forma de §20.1. `code` é o contrato; o resto é acessório. */
export type AppError = {
  readonly code: ErrorCode;
  /** §20.1: inglês, para log e depuração. O português é do renderer. */
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  /** §20.1: nomeia o campo, para o erro inline de formulário. */
  readonly field?: string;
  readonly retryAfterMs?: number;
};

/** §20.1: os códigos que **sempre** carregam `retryAfterMs`. */
export type RetryAfterRequired = 'E_RATE_LIMITED' | 'E_BUSY' | 'E_QUOTA_EXCEEDED';

/** Códigos que a outbox retenta (§20.2, coluna R) e podem trazer um prazo conhecido. */
type RetryAfterOptional = {
  [C in ErrorCode]: (typeof ERROR_CATALOG)[C]['retry'] extends 'no' | 'n/a' ? never : C;
}[ErrorCode];

type Details<C extends ErrorCode> = C extends 'E_LIMIT_EXCEEDED'
  ? // §20.2: "traz `limit`".
    Readonly<{ limit: number } & Record<string, unknown>>
  : C extends 'E_WIPE_INCOMPLETE'
    ? // §20.2: "traz `stage`".
      Readonly<{ stage: string } & Record<string, unknown>>
    : Readonly<Record<string, unknown>>;

type FieldOf<C extends ErrorCode> = C extends 'E_VALIDATION'
  ? { readonly field: string }
  : { readonly field?: never };

type RetryAfterOf<C extends ErrorCode> = C extends RetryAfterRequired
  ? { readonly retryAfterMs: number }
  : C extends RetryAfterOptional
    ? { readonly retryAfterMs?: number }
    : { readonly retryAfterMs?: never };

type Base<C extends ErrorCode> = {
  /** Sobrescreve a mensagem padrão do catálogo. Inglês (§20.1). */
  readonly message?: string;
  readonly details?: Details<C>;
};

export type ErrorOptions<C extends ErrorCode> = Base<C> & FieldOf<C> & RetryAfterOf<C>;

// Nenhum argumento quando o código não exige nada — `error('E_BANNED')` compila.
type Args<C extends ErrorCode> =
  Record<string, never> extends ErrorOptions<C> ? [options?: ErrorOptions<C>] : [options: ErrorOptions<C>];

/**
 * Constrói um erro do catálogo. **Nunca lança**: é chamável de dentro do `fold` (§4, §8.5).
 *
 * ```ts
 * error('E_BANNED')
 * error('E_VALIDATION', { field: 'content' })
 * error('E_RATE_LIMITED', { retryAfterMs: 2_000 })
 * ```
 */
export function error<const C extends ErrorCode>(code: C, ...args: Args<C>): AppError {
  const o = args[0] as (Base<C> & { field?: string; retryAfterMs?: number }) | undefined;
  const e: {
    code: ErrorCode;
    message: string;
    details?: Readonly<Record<string, unknown>>;
    field?: string;
    retryAfterMs?: number;
  } = { code, message: o?.message ?? ERROR_CATALOG[code].message };
  if (o?.details !== undefined) e.details = o.details;
  if (o?.field !== undefined) e.field = o.field;
  if (o?.retryAfterMs !== undefined) e.retryAfterMs = o.retryAfterMs;
  return e;
}

export function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === 'string' && Object.hasOwn(ERROR_CATALOG, v);
}

export function isAppError(v: unknown): v is AppError {
  return (
    typeof v === 'object' &&
    v !== null &&
    isErrorCode((v as { code?: unknown }).code) &&
    typeof (v as { message?: unknown }).message === 'string'
  );
}

export function classOf(code: ErrorCode): ErrorClass {
  return ERROR_CATALOG[code].class;
}

export function retryPolicyOf(code: ErrorCode): RetryPolicy {
  return ERROR_CATALOG[code].retry;
}

/**
 * §20.2 coluna R. `E_DUPLICATE` é `n/a` — sucesso para o cliente (§20.3.7), não entra na
 * fila —, então não é retentável nem terminal.
 */
export function isRetryable(code: ErrorCode): boolean {
  const r = ERROR_CATALOG[code].retry;
  return r === 'yes' || r === 'after-until' || r === 'once';
}

/** §20.3.5: erro terminal em op enfileirada vira `dropped` com motivo nomeado. */
export function isTerminalForOutbox(code: ErrorCode): boolean {
  return ERROR_CATALOG[code].retry === 'no';
}

/**
 * §20.3.1: erro nunca vaza stack trace pelo IPC — a stack vai para o log.
 *
 * Carrega um `AppError` por um caminho que só sabe lançar. A stack fica no objeto `Error`
 * e **não** no `AppError`; quem serializa para a fronteira manda `.error`, nunca `this`.
 */
export class AppErrorException extends Error {
  override readonly name = 'AppErrorException';
  readonly error: AppError;

  constructor(error: AppError) {
    super(`${error.code}: ${error.message}`);
    this.error = error;
  }
}

/**
 * Reduz qualquer coisa capturada a um `AppError` sem stack, para atravessar a fronteira.
 * O que não for reconhecível vira `E_INTERNAL`, que §20.3.2 trata como bug até prova em
 * contrário. A causa original **não** entra em `details`: ela vai para o log.
 */
export function toAppError(thrown: unknown): AppError {
  if (thrown instanceof AppErrorException) return thrown.error;
  if (isAppError(thrown)) return thrown;
  return error('E_INTERNAL');
}
