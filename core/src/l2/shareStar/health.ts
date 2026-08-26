// `shareStar` — monitor de `share.health` (§17.5, §17.6, §6.16, RT-08).
//
// O apresentador mede `rttMs`/`lossPct` por espectador no **RTCStatsReport do renderer**
// e a composição entrega as amostras aqui pela entrada `ingest` — como a socket UDP entra
// no `MediaServer` por porta injetada: o núcleo continua sem ver mídia, só números já
// medidos. A cada tick (§17.6: 2 s) o monitor consolida um snapshot por sessão viva com a
// qualidade corrente de cada espectador e entrega ao callback `onHealth`, que a
// composição mapeia para a mensagem `ShareHealth`/`share.health` — **só ao apresentador**
// (RT-08). No mesmo tick, perda estritamente acima de `SHARE_LOSS_DEGRADE_PCT` desce o
// perfil do espectador pelo caminho de sistema (`degradeTo`), que nunca sobe.
//
// Amostra é *latest-wins* por espectador: o tick usa o valor mais recente de cada campo.

import type { ShareHostSessions, ShareQuality } from './sessions.ts';
import { degradeOnLoss } from './sessions.ts';

type KeyHex = string;

/** Uma amostra de saúde de um espectador, medida no renderer do apresentador. */
export interface ShareSampleInput {
  readonly sessionId: string;
  readonly viewerKeyHex: KeyHex;
  readonly rttMs: number;
  readonly lossPct: number;
}

export interface ShareViewerHealth {
  readonly keyHex: KeyHex;
  /**
   * Ausentes enquanto o apresentador ainda não mediu este espectador — quem acabou de ser
   * autorizado aparece na lista **antes** de render amostra. Zerar seria pior que omitir:
   * a UI mostraria "0 ms · 0,0%" como se fosse medida, e a degradação de §17.5 leria uma
   * perda que ninguém observou.
   */
  readonly rttMs?: number;
  readonly lossPct?: number;
  /** Qualidade corrente após eventual degradação aplicada neste tick. */
  readonly quality: ShareQuality;
}

/** Payload consolidado da mensagem `share.health` (§RPC eventos, §6.16). */
export interface ShareHealthSnapshot {
  readonly sessionId: string;
  readonly channelId: string;
  readonly viewers: readonly ShareViewerHealth[];
}

interface StoredSample {
  rttMs: number;
  lossPct: number;
}

/**
 * Saúde corrente das sessões de tela. Estado efêmero; morre com o processo do host.
 * A cadência de disparo do `tick` é da composição (§17.6: 2 s); o monitor só consolida.
 */
export class ShareHealthMonitor {
  readonly #sessions: ShareHostSessions;
  readonly #tickMs: number;
  readonly #onHealth: (snapshots: readonly ShareHealthSnapshot[]) => void;
  readonly #samples = new Map<string, Map<KeyHex, StoredSample>>(); // sessionId → viewer → amostra

  constructor(opts: {
    sessions: ShareHostSessions;
    /** Cadência normativa de §17.6 para `shareHealth`; exposta para a composição agendar. */
    tickMs?: number;
    onHealth?: (snapshots: readonly ShareHealthSnapshot[]) => void;
  }) {
    this.#sessions = opts.sessions;
    this.#tickMs = opts.tickMs ?? 2_000;
    this.#onHealth = opts.onHealth ?? (() => {});
  }

  get tickMs(): number {
    return this.#tickMs;
  }

  /** Entrada de amostra (latest-wins). Sessão desconhecida é ignorada defensivamente. */
  ingest(sample: ShareSampleInput): void {
    if (!Number.isFinite(sample.rttMs) || !Number.isFinite(sample.lossPct)) return;
    if (this.#sessions.snapshotOf(sample.sessionId) === null) return;
    let bySession = this.#samples.get(sample.sessionId);
    if (bySession === undefined) {
      bySession = new Map();
      this.#samples.set(sample.sessionId, bySession);
    }
    bySession.set(sample.viewerKeyHex, { rttMs: sample.rttMs, lossPct: sample.lossPct });
  }

  /**
   * Consolida um snapshot por **sessão viva**, aplica a degradação decretada pela decisão
   * (`degradeTo`, só desce) e devolve os snapshots na forma de `share.health`.
   *
   * **A lista é a da audiência autorizada, não a de quem já rendeu amostra.** Antes esta
   * volta iterava `#samples`, e isso tinha duas consequências ruins: uma sessão sem amostra
   * nenhuma não emitia evento, e o apresentador — o único destinatário de `share.health`
   * (RT-08) — não tinha por onde descobrir A QUEM deve servir. §15.5 declara `viewers[]`
   * como a audiência da sessão; quem passou pelo `join` e coube no teto está nela desde o
   * primeiro tick, medido ou não.
   *
   * Amostra de quem não é mais espectador é podada aqui.
   */
  tick(now: number = Date.now()): readonly ShareHealthSnapshot[] {
    void now;
    const out: ShareHealthSnapshot[] = [];
    const vivas = new Set<string>();

    for (const snapshot of this.#sessions.liveSessions()) {
      vivas.add(snapshot.sessionId);
      const stored = this.#samples.get(snapshot.sessionId);
      const viewers = snapshot.viewers.map((v) => {
        const amostra = stored?.get(v.keyHex);
        if (amostra === undefined) return { keyHex: v.keyHex, quality: v.quality };
        let quality = v.quality;
        const lower = degradeOnLoss(quality, amostra.lossPct);
        if (lower !== null && this.#sessions.degradeTo({ sessionId: snapshot.sessionId, memberKeyHex: v.keyHex, quality: lower }).ok) {
          quality = lower;
        }
        return { keyHex: v.keyHex, rttMs: amostra.rttMs, lossPct: amostra.lossPct, quality };
      });
      // Amostra de quem saiu da sessão não sobrevive ao tick.
      if (stored !== undefined) {
        const atuais = new Set(snapshot.viewers.map((v) => v.keyHex));
        for (const keyHex of [...stored.keys()]) if (!atuais.has(keyHex)) stored.delete(keyHex);
      }
      viewers.sort((a, b) => a.keyHex.localeCompare(b.keyHex));
      out.push({ sessionId: snapshot.sessionId, channelId: snapshot.channelId, viewers });
    }

    // Sessão encerrada desde o último tick não deixa amostra pendurada.
    for (const sessionId of [...this.#samples.keys()]) {
      if (!vivas.has(sessionId)) this.#samples.delete(sessionId);
    }

    if (out.length > 0) this.#onHealth(out);
    return out;
  }
}
