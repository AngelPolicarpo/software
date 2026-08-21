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
  readonly rttMs: number;
  readonly lossPct: number;
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
   * Consolida um snapshot por sessão viva, aplica a degradação decretada pela decisão
   * (`degradeTo`, só desce) e devolve os snapshots na forma de `share.health`.
   * Espectador que saiu ou sessão encerrada desde a última amostra são podados aqui.
   */
  tick(now: number = Date.now()): readonly ShareHealthSnapshot[] {
    void now;
    const out: ShareHealthSnapshot[] = [];
    for (const [sessionId, stored] of [...this.#samples]) {
      const snapshot = this.#sessions.snapshotOf(sessionId);
      if (snapshot === null) {
        this.#samples.delete(sessionId);
        continue;
      }
      const currentQuality = new Map(snapshot.viewers.map((v) => [v.keyHex, v.quality] as const));
      for (const keyHex of [...stored.keys()]) {
        if (!currentQuality.has(keyHex)) stored.delete(keyHex);
      }
      if (stored.size === 0) {
        this.#samples.delete(sessionId);
        continue;
      }
      const viewers = [...stored.entries()].map(([keyHex, s]) => {
        let quality = currentQuality.get(keyHex)!;
        const lower = degradeOnLoss(quality, s.lossPct);
        if (lower !== null && this.#sessions.degradeTo({ sessionId, memberKeyHex: keyHex, quality: lower }).ok) {
          quality = lower;
        }
        return { keyHex, rttMs: s.rttMs, lossPct: s.lossPct, quality };
      });
      viewers.sort((a, b) => a.keyHex.localeCompare(b.keyHex));
      out.push({ sessionId, channelId: snapshot.channelId, viewers });
    }
    if (out.length > 0) this.#onHealth(out);
    return out;
  }
}
