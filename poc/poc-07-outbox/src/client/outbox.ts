// A outbox — máquina de estados de §11.3, backoff de §11.8, reconciliação de §11.6.
//
// A propriedade que este arquivo existe para sustentar é a frase de §11.3:
//
//   "Nunca existe um item entregue e perdido, nem um item perdido reportado como entregue.
//    Os dois únicos estados terminais são: removido (observado na própria réplica) ou
//    `dropped` com motivo nomeado."
//
// O que a torna verdadeira é uma regra só, e ela é contraintuitiva: **o ACK não remove o
// item**. O ACK é a palavra do host, e o host pode mentir, reordenar ou censurar (§1.4). A
// única evidência aceita é o `authorSeq` do próprio item aparecer na réplica local — que é
// dado que o host não controla depois de replicado.

import { killPoint } from '../harness/kill.ts';
import {
  BACKOFF_BASE_MS,
  BACKOFF_JITTER,
  BACKOFF_MAX_MS,
  BREAKER_OPEN_MS,
  BREAKER_THRESHOLD,
  OUTBOX_MAX_AGE_MS,
  OUTBOX_MAX_ITEMS,
  SUBMIT_BATCH_MAX,
  TERMINAL_ERRORS,
  type DropReason,
} from '../protocol/constants.ts';
import { opIdOf } from '../protocol/envelope.ts';
import type { Manifest, OutboxRow } from './manifest.ts';
import type { Replica } from './replica.ts';

export type OutboxMetrics = {
  enfileirados: number;
  enviados: number;
  ackRecebidos: number;
  removidosPorObservacao: number;
  ackMismatch: number;
  dropped: Record<string, number>;
  tentativas: number;
  breakerAberturas: number;
  /** Itens cujo `authorSeq` foi ultrapassado no log — ver o achado em `reconcile`. */
  ultrapassados: number;
  reconciliacoes: number;
};

export type SubmitOne = { ok: true; seq: number } | { ok: false; code: string };
/**
 * §11.9 — um resultado por envelope, sempre os N representados. `null` no lugar da lista
 * inteira é "não houve resposta": do lado do cliente, host mudo e ACK perdido no caminho são
 * o mesmo evento, e é a reconciliação que os separa.
 */
export type SubmitFn = (envelopes: readonly Buffer[]) => Promise<readonly SubmitOne[] | null>;

export function newOutboxMetrics(): OutboxMetrics {
  return {
    enfileirados: 0,
    enviados: 0,
    ackRecebidos: 0,
    removidosPorObservacao: 0,
    ackMismatch: 0,
    dropped: {},
    tentativas: 0,
    breakerAberturas: 0,
    ultrapassados: 0,
    reconciliacoes: 0,
  };
}

/** §11.8 — `delay = min(1000 · 2^attempts, 60000) ± 20 %`. */
export function backoffMs(attempts: number, rnd: () => number): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_MAX_MS);
  return Math.round(base * (1 + (rnd() * 2 - 1) * BACKOFF_JITTER));
}

export class Outbox {
  readonly #manifest: Manifest;
  readonly #replica: Replica;
  readonly #communityId: string;
  readonly #submit: SubmitFn;
  readonly #now: () => number;
  readonly #rnd: () => number;
  readonly metrics: OutboxMetrics = newOutboxMetrics();

  /** §11.8 — circuit breaker. `attempts` só cresce quando houve tentativa real de entrega. */
  #falhasDeConexao = 0;
  #breakerAte = 0;

  constructor(opts: {
    manifest: Manifest;
    replica: Replica;
    communityId: string;
    submit: SubmitFn;
    now?: () => number;
    rnd?: () => number;
  }) {
    this.#manifest = opts.manifest;
    this.#replica = opts.replica;
    this.#communityId = opts.communityId;
    this.#submit = opts.submit;
    this.#now = opts.now ?? Date.now;
    this.#rnd = opts.rnd ?? Math.random;
  }

  /** §11.3 `→ queued`. `E_OUTBOX_FULL` **na hora**, nunca enfileira às cegas (§11.7). */
  enqueue(envelope: Buffer, meta: { channelId: string | null; kind: number; authorSeq: number; clientRef?: string }):
    { ok: true; opId: string } | { ok: false; code: 'E_OUTBOX_FULL' } {
    if (this.#manifest.countActive(this.#communityId) >= OUTBOX_MAX_ITEMS) {
      return { ok: false, code: 'E_OUTBOX_FULL' };
    }
    const opId = opIdOf(envelope);
    const r = this.#manifest.enqueue({
      opId,
      communityId: this.#communityId,
      channelId: meta.channelId,
      kind: meta.kind,
      authorSeq: meta.authorSeq,
      envelope,
      clientRef: meta.clientRef ?? null,
      now: this.#now(),
    });
    if (r.enfileirado) this.metrics.enfileirados++;
    return { ok: true, opId };
  }

  #breakerAberto(): boolean {
    return this.#now() < this.#breakerAte;
  }

  /**
   * **Boot: devolve à fila os `sending` órfãos.** Buraco de spec, medido aqui.
   *
   * §11.3 tem a transição `sending → queued` para "erro transitório", e §11.6 manda a
   * reconciliação olhar os itens em `sending | awaiting-confirmation | failed`. Mas o terceiro
   * ramo dela é *"indeterminado: mantém, respeitando o backoff"* — e um item que ficou em
   * `sending` porque o **processo morreu** cai exatamente nesse ramo. Como o `flush` só pega
   * `queued` (§11.3, "flush pega o item de menor `local_seq` pronto"), ele nunca mais é
   * tentado: fica encalhado para sempre, sem estar entregue nem descartado — o que contradiz
   * a frase de §11.3 de que só existem dois estados terminais.
   *
   * Medido na matriz de crash: com o host morto em `host:before-append`, 36 de 40 itens
   * ficavam em `sending` e nenhuma volta de recuperação os movia.
   *
   * Só no **boot**: aqui não há submissão em voo, porque o processo acabou de começar. Chamar
   * isto durante a operação normal devolveria à fila um item que está de fato voando, e o
   * reenvio dependeria de `E_DUPLICATE` para não virar duplicata — defensável, mas é rede de
   * segurança, não desenho.
   */
  recoverStranded(): number {
    let n = 0;
    for (const item of this.#manifest.all(this.#communityId)) {
      if (item.state !== 'sending') continue;
      // Sem consumir tentativa: não houve tentativa de entrega concluída (§11.8).
      this.#manifest.setState(item.local_seq, 'queued', { next_attempt_at: this.#now() });
      n++;
    }
    return n;
  }

  /**
   * §11.3 `queued → sending` e o que vem depois. Um item por canal por vez; o breaker aberto
   * **não consome tentativa** de ninguém.
   */
  async flush(lotePorCanal = SUBMIT_BATCH_MAX): Promise<number> {
    if (this.#breakerAberto()) return 0;
    const prontos = this.#manifest.ready(this.#communityId, this.#now(), lotePorCanal);
    let enviados = 0;
    for (const [, lote] of prontos) {
      if (this.#breakerAberto()) break;
      if (lote.length === 0) continue;
      for (const item of lote) this.#manifest.setState(item.local_seq, 'sending');
      this.metrics.enviados += lote.length;
      this.metrics.tentativas++;

      let res: readonly SubmitOne[] | null;
      try {
        res = await this.#submit(lote.map((i) => i.envelope));
      } catch {
        res = null;
      }
      enviados += lote.length;

      if (res === null) {
        // Falha de conexão: o lote inteiro volta a `queued` com backoff, e o breaker conta.
        // Uma falha de conexão é **uma** falha, não N — senão um lote de 32 abriria o breaker
        // sozinho e a curva de §11.8 deixaria de descrever o que acontece.
        this.#falhasDeConexao++;
        if (this.#falhasDeConexao >= BREAKER_THRESHOLD) {
          this.#breakerAte = this.#now() + BREAKER_OPEN_MS;
          this.#falhasDeConexao = 0;
          this.metrics.breakerAberturas++;
        }
        for (const item of lote) this.#voltaParaFila(item, 'E_HOST_UNAVAILABLE');
        continue;
      }
      this.#falhasDeConexao = 0;

      for (let i = 0; i < lote.length; i++) {
        const item = lote[i] as OutboxRow;
        const r = res[i];
        if (r === undefined || (!r.ok && r.code === 'E_NOT_ATTEMPTED')) {
          // §11.9 — não tentado permanece `queued`, sem consumir tentativa.
          this.#manifest.setState(item.local_seq, 'queued');
          continue;
        }
        if (r.ok) {
          this.metrics.ackRecebidos++;
          killPoint('client:after-ack-before-persist');
          // §11.3 — `sending → awaiting-confirmation`. Grava `acked_seq` e **não remove**.
          this.#manifest.setState(item.local_seq, 'awaiting-confirmation', { acked_seq: r.seq });
          killPoint('client:after-persist');
          continue;
        }
        // `E_DUPLICATE` é sucesso do cliente (§11.6): a op já está no log. O item continua
        // aguardando confirmação — quem o remove é a observação na réplica, não este ramo.
        if (r.code === 'E_DUPLICATE') {
          this.#manifest.setState(item.local_seq, 'awaiting-confirmation', { last_error: 'E_DUPLICATE' });
          continue;
        }
        if (TERMINAL_ERRORS.has(r.code)) {
          // §11.6 regra 3 — `E_VERSION_UNSUPPORTED` não queima 72 h de retry.
          this.#drop(item, 'client-outdated');
          continue;
        }
        this.#voltaParaFila(item, r.code);
      }
    }
    return enviados;
  }

  #voltaParaFila(item: OutboxRow, code: string): void {
    const attempts = item.attempts + 1;
    this.#manifest.setState(item.local_seq, 'queued', {
      attempts,
      next_attempt_at: this.#now() + backoffMs(attempts, this.#rnd),
      last_error: code,
    });
  }

  #drop(item: OutboxRow, motivo: DropReason): void {
    this.#manifest.setState(item.local_seq, 'dropped', { dropped_reason: motivo });
    this.metrics.dropped[motivo] = (this.metrics.dropped[motivo] ?? 0) + 1;
  }

  /**
   * §11.6 — o coração do B5. Roda no boot, em `host.cameBack` e a cada `OUTBOX_RECONCILE_MS`.
   *
   * A ordem dos três ramos é a do normativo e importa: observar na réplica vence tudo, porque
   * é a única evidência que não depende da palavra do host.
   */
  reconcile(): { removidos: number; mismatch: number; expirados: number } {
    this.metrics.reconciliacoes++;
    let removidos = 0;
    let mismatch = 0;
    let expirados = 0;
    const agora = this.#now();

    for (const item of this.#manifest.all(this.#communityId)) {
      if (item.state === 'dropped') continue;
      const observado = this.#replica.lastAuthorSeqOf(item.envelope);

      // §11.6 ramo 1, **corrigido**. O normativo diz:
      //
      //     se ds[community].lastAuthorSeq[eu] >= item.author_seq:
      //         → a op está no log: remove o item
      //
      // A inferência é **insegura**. `lastAuthorSeq` é uma marca d'água, e marca d'água alta
      // não prova presença: prova que *algum* `authorSeq` ≥ aquele foi aceito. Basta o log
      // ficar com buraco na numeração do autor para a regra remover item que nunca entrou —
      // e buraco acontece, porque o `authorSeq` é **por autor** enquanto a ordem de envio é
      // **por canal** (§11.7). Dois canais, e o item de um pode ser ultrapassado pelo do
      // outro; ultrapassado, o estágio 6 o recusa para sempre (`E_DUPLICATE`), e a marca
      // d'água manda removê-lo como se estivesse entregue.
      //
      // Medido: com um host morrendo no meio, o log ficou com `authorSeq`
      // `1..7,13,14,15,20,21,24,…,40` e a marca d'água em 40 removeu **as 40** linhas da fila
      // com 21 registros no log. Dezenove operações perdidas e reportadas como entregues —
      // exatamente o que §11.3 promete ser impossível.
      //
      // O teste exato é o `opId` na réplica. A marca d'água continua útil como negativa
      // barata (`observado < author_seq` ⇒ com certeza **não** está no log), e é assim que
      // ela é usada aqui.
      if (observado >= item.author_seq && this.#replica.hasOpId(item.op_id)) {
        // A op está no log: remove e emite `message.accepted{opId, seq}` (§11.6 regra 2, com
        // o `seq` **observado**, nunca o do ACK).
        this.#manifest.remove(item.local_seq);
        this.metrics.removidosPorObservacao++;
        removidos++;
        continue;
      }

      // Ultrapassado: a marca d'água passou do `authorSeq` do item e o `opId` não está no
      // log. O host nunca mais o aceitará (§7.5). Não é perda silenciosa nem espera eterna —
      // é um desfecho nomeado, e o item volta ao usuário com "Tentar novamente" (§11.3
      // `failed`), que reenvia com **outro** `authorSeq`. Ver o achado no REPORT.
      if (observado >= item.author_seq) {
        // Idempotente: reconciliar de novo não reconta o mesmo item.
        if (item.state !== 'failed' || item.last_error !== 'E_AUTHOR_SEQ_OVERTAKEN') {
          this.#manifest.setState(item.local_seq, 'failed', { last_error: 'E_AUTHOR_SEQ_OVERTAKEN' });
          this.metrics.ultrapassados++;
        }
        continue;
      }

      if (item.acked_seq !== null && this.#replica.state.interpretedSeq >= item.acked_seq) {
        // O host disse que appendou, e o log interpretado chegou lá sem conter a op. Ele
        // mentiu, reordenou ou censurou. Volta a `queued` e conta `host.ackMismatch`.
        this.#manifest.setState(item.local_seq, 'queued', {
          acked_seq: null,
          last_error: 'E_ACK_MISMATCH',
          next_attempt_at: agora,
        });
        this.metrics.ackMismatch++;
        mismatch++;
        continue;
      }

      // §11.6 regra 1 — idade **nunca** descarta sozinha. Só aqui, depois de a reconciliação
      // ter olhado o log e não ter encontrado a op, o relógio pode falar.
      if (agora - item.created_at > OUTBOX_MAX_AGE_MS && item.acked_seq === null) {
        this.#drop(item, 'expired');
        expirados++;
        continue;
      }
      // Indeterminado: mantém, respeitando o backoff.
    }
    return { removidos, mismatch, expirados };
  }

  /** §11.7 — `cancelQueued` só alcança `queued` e `failed`; o resto é `E_ALREADY_SENT`. */
  cancelQueued(opId: string): { ok: true } | { ok: false; code: 'E_ALREADY_SENT' | 'E_NOT_FOUND' } {
    const item = this.#manifest.byOpId(opId);
    if (item === undefined) return { ok: false, code: 'E_NOT_FOUND' };
    if (item.state === 'sending' || item.state === 'awaiting-confirmation') {
      return { ok: false, code: 'E_ALREADY_SENT' };
    }
    this.#drop(item, 'cancelled');
    return { ok: true };
  }
}
