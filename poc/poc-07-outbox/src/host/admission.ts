// Admissão no host — §11.4 (seção crítica) e §11.5 (group commit).
//
// ─── A tensão entre §11.4 e §11.5, e a leitura adotada ─────────────────────────────────
//
// §11.4 lista dez passos e põe o passo 6 — "aguarda o append do grupo" — **dentro** da seção
// crítica, com o avanço do `DS` no passo 8 e a liberação no 9. Lido ao pé da letra, um grupo
// nunca tem mais de um registro: a op A segura a seção enquanto espera o append, e a op B
// fica bloqueada na entrada, então não há o que agrupar. §11.5 deixaria de existir.
//
// A leitura adotada preserva as **garantias**, que é o que os dois textos querem:
//
//   - decisão e avanço do `DS` acontecem sob a seção crítica, então toda op decide contra o
//     `DS` na cabeça do log e nunca contra uma projeção atrasada (a janela de `DS-01`);
//   - o `seq` é atribuído sob a seção crítica, na ordem de chegada;
//   - a **resposta** espera o append do grupo, então nenhum ACK precede a durabilidade —
//     que é a propriedade que §11.4 existe para dar (A06);
//   - se o append falhar, ninguém do grupo é confirmado e o `DS` volta ao que era antes do
//     grupo, que é o "descarta o efeito" do passo 7.
//
// Registrado como achado de spec no REPORT: os dois textos não são simultaneamente literais.

import type Hypercore from 'hypercore';

import { killPoint } from '../harness/kill.ts';
import { GROUP_COMMIT_MAX, GROUP_COMMIT_WINDOW_MS, HOST_QUEUE_DEPTH } from '../protocol/constants.ts';
import { decodeEnvelope, encodeRecord, opIdOf } from '../protocol/envelope.ts';

export type SubmitOk = { readonly ok: true; readonly seq: number; readonly hostTs: number };
export type SubmitErr = { readonly ok: false; readonly code: string; readonly retryAfterMs?: number };
export type SubmitResult = SubmitOk | SubmitErr;

export type HostMetrics = {
  admitidos: number;
  recusados: number;
  duplicatas: number;
  grupos: number;
  registrosAgrupados: number;
  maiorGrupo: number;
  appendFalhas: number;
};

type Pendente = {
  readonly seq: number;
  readonly hostTs: number;
  readonly bytes: Buffer;
  readonly authorHex: string;
  readonly authorSeqAnterior: number;
  resolve(r: SubmitResult): void;
};

/**
 * O `DS` do host, reduzido ao que a idempotência de §7.5 exige. O `fold` completo é evidência
 * de G1; aqui o que decide é o estágio 6 de §8.2, que é a regra que este gate interroga.
 */
export type HostState = {
  interpretedSeq: number;
  lastHostTs: number;
  readonly lastAuthorSeq: Map<string, number>;
};

export class Admission {
  readonly #core: Hypercore;
  readonly #metrics: HostMetrics;
  readonly #state: HostState;
  /** §11.4 — fila de uma via por comunidade. A promessa encadeada **é** a seção crítica. */
  #critical: Promise<void> = Promise.resolve();
  #fila = 0;
  /** §11.5 — o grupo em formação. */
  #grupo: Pendente[] = [];
  #timer: NodeJS.Timeout | null = null;
  #commitEmVoo: Promise<void> = Promise.resolve();
  /** Relógio injetável: o gate precisa de `hostTs` determinístico onde ele entra em hash. */
  readonly #now: () => number;

  constructor(core: Hypercore, opts: { now?: () => number } = {}) {
    this.#core = core;
    this.#now = opts.now ?? Date.now;
    this.#metrics = {
      admitidos: 0,
      recusados: 0,
      duplicatas: 0,
      grupos: 0,
      registrosAgrupados: 0,
      maiorGrupo: 0,
      appendFalhas: 0,
    };
    this.#state = { interpretedSeq: core.length - 1, lastHostTs: 0, lastAuthorSeq: new Map() };
  }

  get metrics(): HostMetrics {
    return this.#metrics;
  }

  get state(): HostState {
    return this.#state;
  }

  /**
   * Reconstrói o `DS` lendo o log do zero. É o que o host faz no boot: a autoridade é o log,
   * nunca um estado guardado à parte — sem isso, um host que morre entre o append e a
   * resposta reabriria sem saber que já aceitou aquele `authorSeq`, e o reenvio do cliente
   * produziria um **segundo** `seq` para o mesmo `(author, authorSeq)`. É a duplicata que o
   * critério de reprovação nomeia.
   */
  async recover(): Promise<void> {
    this.#state.lastAuthorSeq.clear();
    this.#state.lastHostTs = 0;
    for (let seq = 0; seq < this.#core.length; seq++) {
      const raw = await this.#core.get(seq);
      if (raw === null) continue;
      const rec = decodeRecordSafe(raw);
      if (rec === null) continue;
      const env = decodeEnvelope(rec.envelope);
      if (env === null) continue;
      const hex = env.author.toString('hex');
      const atual = this.#state.lastAuthorSeq.get(hex) ?? 0;
      if (env.authorSeq > atual) this.#state.lastAuthorSeq.set(hex, env.authorSeq);
      if (rec.hostTs > this.#state.lastHostTs) this.#state.lastHostTs = rec.hostTs;
    }
    this.#state.interpretedSeq = this.#core.length - 1;
  }

  /** §11.4 passos 1 a 10, com o append do grupo entre o 5 e o 10. */
  async submit(envelope: Buffer): Promise<SubmitResult> {
    // §11.8 — shedding explícito **antes** de qualquer verificação cara.
    if (this.#fila >= HOST_QUEUE_DEPTH) return { ok: false, code: 'E_BUSY', retryAfterMs: 50 };
    this.#fila++;
    try {
      return await this.#underCriticalSection(envelope);
    } finally {
      this.#fila--;
    }
  }

  #underCriticalSection(envelope: Buffer): Promise<SubmitResult> {
    const anterior = this.#critical;
    let liberar!: () => void;
    this.#critical = new Promise<void>((r) => {
      liberar = r;
    });
    return anterior.then(() => {
      try {
        // **Sem `await`.** `#decideAndQueue` não tem `await` antes de entrar no grupo, então
        // decisão, `seq` e avanço do `DS` acontecem aqui, dentro da seção. O que a chamada
        // devolve é a promessa que só resolve no append do grupo — e ela é esperada **fora**.
        //
        // Com `await` aqui, a seção ficaria presa até o append: a op seguinte não conseguiria
        // nem decidir, todo grupo teria exatamente um registro e §11.5 deixaria de existir sem
        // que nada acusasse. Foi o que aconteceu na primeira versão deste arquivo, e só
        // apareceu porque a matriz de crash mediu `maiorGrupo`.
        return this.#decideAndQueue(envelope);
      } finally {
        liberar();
      }
    });
  }

  async #decideAndQueue(envelope: Buffer): Promise<SubmitResult> {
    const env = decodeEnvelope(envelope);
    if (env === null) {
      this.#metrics.recusados++;
      return { ok: false, code: 'E_INTERNAL' };
    }

    // Passo 2 — R-1: o `hostTs` nunca retrocede.
    const hostTs = Math.max(this.#now(), this.#state.lastHostTs);

    // Passo 3/4 — o estágio 6 de §8.2. `E_DUPLICATE` é **sucesso** do ponto de vista do
    // cliente (§11.6): a op já está no log, e reenviar não pode produzir um segundo `seq`.
    const hex = env.author.toString('hex');
    const anterior = this.#state.lastAuthorSeq.get(hex) ?? 0;
    if (env.authorSeq <= anterior) {
      this.#metrics.recusados++;
      this.#metrics.duplicatas++;
      return { ok: false, code: 'E_DUPLICATE' };
    }

    // Passo 8 antecipado: o `DS` avança **sob** a seção crítica, para que a próxima op decida
    // contra a cabeça. O rollback do grupo desfaz isto se o append falhar (passo 7).
    const seq = this.#state.interpretedSeq + 1;
    this.#state.interpretedSeq = seq;
    this.#state.lastHostTs = hostTs;
    this.#state.lastAuthorSeq.set(hex, env.authorSeq);

    const bytes = encodeRecord({ envelope, hostTs });

    // Passo 5 — entra no grupo de commit corrente.
    return new Promise<SubmitResult>((resolve) => {
      this.#grupo.push({ seq, hostTs, bytes, authorHex: hex, authorSeqAnterior: anterior, resolve });
      if (this.#grupo.length >= GROUP_COMMIT_MAX) {
        void this.#flushGrupo();
      } else if (this.#timer === null) {
        this.#timer = setTimeout(() => void this.#flushGrupo(), GROUP_COMMIT_WINDOW_MS);
        this.#timer.unref?.();
      }
    });
  }

  /** §11.5 — **um** `core.append([...])`, que já é o commit (§10.7.1). */
  async #flushGrupo(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#grupo.length === 0) return;
    const grupo = this.#grupo;
    this.#grupo = [];

    // Um append por vez: dois `core.append` concorrentes no mesmo core embaralhariam a ordem
    // que a seção crítica acabou de fixar.
    const anterior = this.#commitEmVoo;
    this.#commitEmVoo = (async () => {
      await anterior.catch(() => {});
      killPoint('host:before-append');
      try {
        await this.#core.append(grupo.map((p) => p.bytes));
        this.#metrics.grupos++;
        this.#metrics.registrosAgrupados += grupo.length;
        this.#metrics.maiorGrupo = Math.max(this.#metrics.maiorGrupo, grupo.length);
        this.#metrics.admitidos += grupo.length;
        // O append resolveu: os registros estão commitados (§10.7.1). Só **agora** o ACK sai.
        killPoint('host:after-append-before-ack');
        for (const p of grupo) p.resolve({ ok: true, seq: p.seq, hostTs: p.hostTs });
      } catch {
        // Passo 7 — descarta o efeito. O `DS` volta ao que era antes do grupo: sem isto, um
        // append falho deixaria o host achando que aceitou `authorSeq` que não existe no log,
        // e o reenvio legítimo do cliente seria recusado como duplicata para sempre.
        this.#metrics.appendFalhas++;
        for (let i = grupo.length - 1; i >= 0; i--) {
          const p = grupo[i] as Pendente;
          if (p.authorSeqAnterior === 0) this.#state.lastAuthorSeq.delete(p.authorHex);
          else this.#state.lastAuthorSeq.set(p.authorHex, p.authorSeqAnterior);
          this.#state.interpretedSeq = Math.min(this.#state.interpretedSeq, p.seq - 1);
        }
        for (const p of grupo) p.resolve({ ok: false, code: 'E_STORAGE_FULL' });
      }
    })();
    await this.#commitEmVoo;
  }

  /** Fecha o grupo pendente — usado no encerramento ordenado do processo host. */
  async drain(): Promise<void> {
    await this.#flushGrupo();
    await this.#commitEmVoo.catch(() => {});
  }

  /** Só para o cenário de host adversário: o `opId` que o log **deveria** conter. */
  static opIdOf(envelope: Buffer): string {
    return opIdOf(envelope);
  }
}

function decodeRecordSafe(raw: Buffer): { envelope: Buffer; hostTs: number } | null {
  try {
    if (raw.length < 12) return null;
    const hostTs = Number(raw.readBigUInt64LE(0));
    const len = raw.readUInt32LE(8);
    if (raw.length < 12 + len) return null;
    return { envelope: raw.subarray(12, 12 + len), hostTs };
  } catch {
    return null;
  }
}
