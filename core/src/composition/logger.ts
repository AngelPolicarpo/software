// O log estruturado de §24.1 e o registro central de métricas de §24.3 — raiz de
// composição: junta o formato do arquivo, a redação obrigatória de §24.2 e os contadores
// que vivem espalhados pelos detentores de estado.
//
// §24.2 é **allowlist**, não blocklist: um campo novo não aparece no log até entrar na
// lista. O formato de linha é fechado (`ts`, `level`, `scope`, `msg` + opcionais), então a
// redação aqui é estrutural — não há como um chamador inventar campo.
//
// As métricas de §24.3 não têm campo no formato de §24.1 (a tabela é fechada), então o
// destino delas NÃO é o NDJSON: é o registro em memória que `diag.snapshot`/`diag.run`
// servem (§15.4) — o "registro central" que o módulo `diagnostics` declarou esperar da
// composição. `metrics.flush` (§22.1) é quem comete nele o estado dos detentores.

import fs from 'node:fs';
import path from 'node:path';

import type { HistogramSummary, MetricsSnapshot } from '../l2/diagnostics/index.ts';

export type { MetricsSnapshot };

/** Níveis de §24.1. `debug` fica desligado em produção; `trace` não tem produtor nesta fase. */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVELS: Readonly<Record<LogLevel, number>> = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * Campos opcionais de §24.1 — a allowlist INTEIRA. Qualquer outra chave passada por um
 * produtor é descartada antes de tocar o arquivo: blocklist esquece o campo novo (T-39),
 * allowlist não.
 */
const ALLOWED_FIELDS = ['communityId', 'channelId', 'opId', 'kind', 'seq', 'durMs', 'code', 'epoch'] as const;

export type LogFields = Partial<Record<(typeof ALLOWED_FIELDS)[number], string | number>>;

/** A porta que os produtores recebem — nunca o arquivo nem o caminho dele. */
export interface LoggerPort {
  log(level: LogLevel, scope: string, msg: string, fields?: LogFields): void;
  error(scope: string, msg: string, fields?: LogFields): void;
  warn(scope: string, msg: string, fields?: LogFields): void;
  info(scope: string, msg: string, fields?: LogFields): void;
  close(): void;
}

export class NdjsonLogger implements LoggerPort {
  readonly #dir: string;
  readonly #now: () => number;
  readonly #minLevel: number;

  constructor(a: { dir: string; now?: () => number; buildChannel?: string }) {
    this.#dir = a.dir;
    this.#now = a.now ?? Date.now;
    // §24.1 — debug desligado em produção; o canal dev liga.
    this.#minLevel = LEVELS.info + (a.buildChannel === 'dev' ? 1 : 0);
  }

  error(scope: string, msg: string, fields?: LogFields): void {
    this.log('error', scope, msg, fields);
  }
  warn(scope: string, msg: string, fields?: LogFields): void {
    this.log('warn', scope, msg, fields);
  }
  info(scope: string, msg: string, fields?: LogFields): void {
    this.log('info', scope, msg, fields);
  }
  debug(scope: string, msg: string, fields?: LogFields): void {
    this.log('debug', scope, msg, fields);
  }

  log(level: LogLevel, scope: string, msg: string, fields?: LogFields): void {
    if (LEVELS[level] > this.#minLevel) return;
    // Allowlist de §24.2 — só campos da lista entram na linha, só valores primitivos.
    const permitidos: Record<string, string | number> = {};
    if (fields !== undefined) {
      for (const k of ALLOWED_FIELDS) {
        const v = fields[k];
        if (typeof v === 'string' || typeof v === 'number') permitidos[k] = v;
      }
    }
    const linha = JSON.stringify({ ts: this.#now(), level, scope, msg, ...permitidos });
    try {
      fs.mkdirSync(this.#dir, { recursive: true });
      // Rotação diária implícita do escritor (o nome É a data); retenção e teto são do job
      // `log.rotate` de §22.2.
      const nome = `core-${new Date(this.#now()).toISOString().slice(0, 10)}.ndjson`;
      fs.appendFileSync(path.join(this.#dir, nome), `${linha}\n`, 'utf8');
    } catch {
      // Falha de log nunca derruba o núcleo (§22.5).
    }
  }

  close(): void {}
}

/** Logger silencioso para rigs — mesma porta, nenhum disco. */
export function silentLogger(): LoggerPort {
  return {
    log() {},
    error() {},
    warn() {},
    info() {},
    close() {},
  };
}

/**
 * Registro central das métricas de §24.3 — o que `diagnostics` pediu à composição. Chaves
 * livres no formato `<nome>.<recorte>`; a taxonomia fechada é a tabela de §24.3.
 */
export class MetricsRegistry {
  readonly #gauges = new Map<string, number>();
  readonly #counters = new Map<string, number>();
  readonly #histograms = new Map<string, { count: number; sum: number; max: number }>();

  setGauge(name: string, value: number): void {
    this.#gauges.set(name, value);
  }

  inc(name: string, by = 1): void {
    this.#counters.set(name, (this.#counters.get(name) ?? 0) + by);
  }

  observe(name: string, value: number): void {
    const h = this.#histograms.get(name) ?? { count: 0, sum: 0, max: 0 };
    h.count += 1;
    h.sum += value;
    h.max = Math.max(h.max, value);
    this.#histograms.set(name, h);
  }

  snapshot(): MetricsSnapshot {
    const histograms: Record<string, HistogramSummary> = {};
    for (const [k, v] of this.#histograms) histograms[k] = { ...v };
    return {
      gauges: Object.fromEntries(this.#gauges),
      counters: Object.fromEntries(this.#counters),
      histograms,
    };
  }
}

/** Recorte hex8 de chave pública para chaves de série — §24.2 ("chaves truncadas em 8 hex"). */
export function serieId(communityId: string): string {
  return communityId.slice(0, 8);
}
