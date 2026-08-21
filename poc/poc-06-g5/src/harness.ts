// Harness G5 — cenários do POC-06 (plano-de-validacao-experimental-v2.md §3 POC-06)
// executados sobre o código de produto da fase 6 (core/src/l2/blobs via core/dist).
// Determinístico: PRNG com semente fixa; nenhum dado de rede real (limitação declarada no artefato).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { loadCore, type CoreApi, type BlobManagerLike, type ManifestDbLike, type SwarmLike } from './core.js';

export type Profile = 'quick' | 'full';

export interface StepResult {
  id: string;
  desc: string;
  ok: boolean;
  ms: number;
  evidence?: Record<string, unknown>;
  error?: string;
}

export interface HarnessResult {
  profile: Profile;
  ok: boolean;
  steps: StepResult[];
  metrics: Record<string, unknown>;
}

const SEED = 20260821;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fillDeterministic(buf: Buffer, rnd: () => number): Buffer {
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(rnd() * 256);
  return buf;
}

function codeOf(e: unknown): string {
  return (e as { code?: string }).code ?? `<sem-code:${String(e).slice(0, 80)}>`;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[idx]!;
}

async function expectReject(fn: () => Promise<unknown> | unknown, expected: string): Promise<string> {
  try {
    await fn();
  } catch (e) {
    const code = codeOf(e);
    if (code !== expected) throw new Error(`código esperado ${expected}, obtido ${code}`);
    return code;
  }
  throw new Error(`esperada recusa ${expected}, chamada teve sucesso`);
}

interface Ctx {
  core: CoreApi;
  rootDir: string;
  manifest: ManifestDbLike;
  swarm: SwarmLike & { calls: Array<{ method: string; bytes: number }> };
  manager: BlobManagerLike;
  identitySeed: Buffer;
  communityId: string;
  dispose(): void;
}

function makeCtx(core: CoreApi, label: string, opts: { clock?: () => number; cacheMaxBytes?: number } = {}): Ctx {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), `poc06-${label}-`));
  const manifest = new core.ManifestDb(path.join(rootDir, 'manifest.db'));
  const calls: Array<{ method: string; bytes: number }> = [];
  const inner = new core.Swarm();
  const swarm = {
    calls,
    join(topicHex: string, topic: unknown): void {
      calls.push({ method: 'join', bytes: Buffer.byteLength(topicHex, 'utf8') + JSON.stringify(topic ?? null).length });
      inner.join(topicHex, topic);
    },
    leave(topicHex: string): void {
      calls.push({ method: 'leave', bytes: Buffer.byteLength(topicHex, 'utf8') });
      inner.leave(topicHex);
    },
    isJoined(topicHex: string): boolean {
      calls.push({ method: 'isJoined', bytes: Buffer.byteLength(topicHex, 'utf8') });
      return inner.isJoined(topicHex);
    },
  };
  const manager = new core.blobs.BlobManager({
    manifest,
    swarm,
    dataDir: path.join(rootDir, 'blobs'),
    ...(opts.clock !== undefined ? { clock: opts.clock } : {}),
    ...(opts.cacheMaxBytes !== undefined ? { cacheMaxBytes: opts.cacheMaxBytes } : {}),
  });
  const rnd = mulberry32(SEED);
  return {
    core,
    rootDir,
    manifest,
    swarm,
    manager,
    identitySeed: fillDeterministic(Buffer.alloc(32), mulberry32(SEED ^ 0x5eed)),
    // §13.1: communityId é hex de 32 bytes (coreKey) — Buffer.from(cid, 'hex') no derivo
    communityId: fillDeterministic(Buffer.alloc(32), rnd).toString('hex'),
    dispose(): void {
      try {
        manifest.close();
      } catch {}
      fs.rmSync(rootDir, { recursive: true, force: true });
    },
  };
}

function writeSource(dir: string, name: string, content: Buffer): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

// ─── S1 — Ownership por autor (A09, §13.1) ────────────────────────────────────

async function s1Ownership(ctx: Ctx): Promise<Record<string, unknown>> {
  const { core, manager, identitySeed, communityId, rootDir } = ctx;
  // segunda comunidade: também hex de 32 bytes (último char alternado)
  const cid2 = communityId.slice(0, 63) + (communityId.endsWith('0') ? '1' : '0');
  const seedB = fillDeterministic(Buffer.alloc(32), mulberry32(SEED ^ 0xb10b));

  const kp1 = core.blobs.deriveMemberBlobsKeypair(identitySeed, communityId);
  const kp1again = core.blobs.deriveMemberBlobsKeypair(identitySeed, communityId);
  if (!kp1.publicKey.equals(kp1again.publicKey)) throw new Error('derivação não é determinística');
  if (core.blobs.deriveMemberBlobsPublicKey(identitySeed, cid2).equals(kp1.publicKey)) throw new Error('outra comunidade produziu a mesma chave');
  if (core.blobs.deriveMemberBlobsPublicKey(seedB, communityId).equals(kp1.publicKey)) throw new Error('outra identidade produziu a mesma chave');

  const content = fillDeterministic(Buffer.alloc(64 * 1024), mulberry32(SEED + 1));
  const src = writeSource(rootDir, 's1-anexo.png', content);
  const ticket = manager.createTicketForMain(communityId, src, content.length);

  // nenhum membro escreve em core sem a chave dele (critério do plano)
  await expectReject(() => manager.stage(ticket.ticketId), 'E_NO_BLOBS_KEY');

  const res = await manager.stage(ticket.ticketId, { identitySeed, communityId });
  if (!res.blobsCoreKey.equals(kp1.publicKey)) throw new Error('stage não usou o core do próprio autor');
  if (!res.hash.equals(core.blobs.hashForBlobContent(content))) throw new Error('hash diverge do conteúdo');

  return {
    deterministica: true,
    chavesDistintasPorComunidadeEIdentidade: true,
    stageSemChaveRecusado: 'E_NO_BLOBS_KEY',
    blobsCoreKeyHex: res.blobsCoreKey.toString('hex').slice(0, 16),
  };
}

// ─── S2 — Ticket: uso único, TTL, escopo, path nunca cruza IPC-R (A15/T-16/DR-37) ──

async function s2Ticket(core: CoreApi): Promise<Record<string, unknown>> {
  const ttl = core.blobs.STAGING_TICKET_TTL_MS_DEFAULT;
  let now = 1_000_000;
  const c = makeCtx(core, 's2', { clock: () => now });
  try {
    const { manager, rootDir, communityId, identitySeed } = c;
    const content = fillDeterministic(Buffer.alloc(1024), mulberry32(SEED + 2));
    const src = writeSource(rootDir, 's2-anexo.pdf', content);

    // o que cruza para o renderer é TicketIssue — sem path, nem em erro, nem em log
    const issue = manager.tickets.issue(communityId, src, content.length);
    if ('path' in issue) throw new Error('TicketIssue expõe path ao renderer');
    if (JSON.stringify(issue).includes(src)) throw new Error('caminho vazou no payload do ticket');

    // uso único no TicketStore
    const t1 = manager.createTicketForMain(communityId, src, content.length);
    if (manager.tickets.peek(t1.ticketId) === null) throw new Error('ticket recém-criado falhou no peek');
    manager.tickets.consume(t1.ticketId, communityId);
    await expectReject(() => manager.tickets.consume(t1.ticketId, communityId), 'E_TICKET_INVALID');

    // uso único no stage: após um stage bem-sucedido (staging done), o mesmo ticketId não stagea de novo.
    // (Retry com staging pendente é a retomada de §13.5, não reuso.)
    const t1b = manager.createTicketForMain(communityId, src, content.length);
    await manager.stage(t1b.ticketId, { identitySeed, communityId });
    await expectReject(() => manager.stage(t1b.ticketId, { identitySeed, communityId }), 'E_TICKET_INVALID');

    // expiração: ticket criado antes do avanço do relógio
    const t3 = manager.createTicketForMain(communityId, src, content.length);
    now += ttl + 1;
    if (manager.tickets.peek(t3.ticketId) !== null) throw new Error('ticket expirado passou no peek');
    await expectReject(() => manager.tickets.consume(t3.ticketId, communityId), 'E_TICKET_INVALID');
    const pruned = manager.tickets.pruneExpired(now);
    if (pruned < 1) throw new Error('pruneExpired não removeu expirados');

    // escopo: ticket de uma comunidade não serve em outra (criado já avançado, dentro do TTL)
    const t4 = manager.createTicketForMain(communityId, src, content.length);
    await expectReject(() => manager.tickets.consume(t4.ticketId, `${communityId}-outra`), 'E_TICKET_INVALID');

    // renderer tentando fornecer caminho arbitrário: stage só aceita ticketId
    await expectReject(() => manager.stage('/etc/passwd', { identitySeed, communityId }), 'E_TICKET_INVALID');
    await expectReject(() => manager.stage('../../secreto.txt', { identitySeed, communityId }), 'E_TICKET_INVALID');
    await expectReject(() => manager.stage('a'.repeat(32), { identitySeed, communityId }), 'E_TICKET_INVALID');

    // ingest forjado via IPC-M recusado
    const forged = { ...manager.createTicketForMain(communityId, src, content.length), ticketId: 'zz' };
    let forgedRejected = false;
    try {
      manager.ingestTicket(forged);
    } catch (e) {
      forgedRejected = codeOf(e) === 'E_TICKET_INVALID';
    }
    if (!forgedRejected) throw new Error('ingest aceitou ticket forjado');

    return {
      ticketIssueSemPath: true,
      usoUnico: true,
      ttlMs: ttl,
      expiradoRecusado: true,
      pruneRemoveuExpirados: pruned,
      escopoComunidade: true,
      caminhoArbitrarioRecusado: ['/etc/passwd', '../../secreto.txt', 'a*32'],
      ingestForjadoRecusado: forgedRejected,
    };
  } finally {
    c.dispose();
  }
}

// ─── S3 — Stage → hash → barreira em ciclos (§13.2, §13.7) ───────────────────

async function s3StageCycles(ctx: Ctx, profile: Profile): Promise<Record<string, unknown>> {
  const { core, manager, identitySeed, communityId, rootDir } = ctx;
  const cycles = profile === 'full' ? 100 : 25;
  const sizes = profile === 'full' ? [64 * 1024, 256 * 1024, 1024 * 1024, 4 * 1024 * 1024, 8 * 1024 * 1024] : [64 * 1024, 256 * 1024, 1024 * 1024];
  const exts = ['png', 'pdf', 'bin', 'webp', 'mp4'];
  const srcDir = path.join(rootDir, 's3-src');
  fs.mkdirSync(srcDir, { recursive: true });

  let passed = 0;
  const t0 = performance.now();
  for (let i = 0; i < cycles; i++) {
    const size = sizes[i % sizes.length]!;
    const content = fillDeterministic(Buffer.alloc(size), mulberry32(SEED + 1000 + i));
    const name = `anexo-${i}.${exts[i % exts.length]}`;
    const src = writeSource(srcDir, name, content);
    const ticket = manager.createTicketForMain(communityId, src, content.length);

    // barreira blob ↔ mensagem antes do stage completo (§13.7)
    let barrierBefore = '';
    try {
      manager.assertReadyForMessage(ticket.ticketId);
      barrierBefore = 'não-recusou';
    } catch (e) {
      barrierBefore = codeOf(e);
    }
    if (barrierBefore !== 'E_BLOB_NOT_STAGED') throw new Error(`barreira antes do stage: ${barrierBefore}`);

    const res = await manager.stage(ticket.ticketId, { identitySeed, communityId });
    const hashOk = res.hash.equals(core.blobs.hashForBlobContent(content));
    const row = manager.staging.get(ticket.ticketId);
    const cacheRow = manager.cache.get(res.blobsCoreKey, res.blobIdHex);
    const storedOk = cacheRow !== null && cacheRow.state === 'downloaded' && cacheRow.path !== null && fs.existsSync(cacheRow.path);
    if (!hashOk || res.sizeBytes !== size || row === null || row.state !== 'done' || row.bytesWritten !== size || !storedOk) {
      throw new Error(`ciclo ${i}: hash=${hashOk} size=${String(res.sizeBytes)}/${String(size)} row=${row?.state ?? 'null'} cache=${cacheRow?.state ?? 'null'}`);
    }
    manager.assertReadyForMessage(ticket.ticketId); // depois: deve passar
    if (!manager.isStagedDone(ticket.ticketId)) throw new Error(`ciclo ${i}: isStagedDone falso`);
    passed++;
  }
  const ms = performance.now() - t0;
  if (passed !== cycles) throw new Error(`${passed}/${cycles} ciclos`);
  return { ciclos: cycles, aprovados: passed, tamanhoMaxBytes: Math.max(...sizes), ms: Math.round(ms) };
}

// ─── S4 — RPC de controle = 0 bytes de anexo + p95 submitOp ≤ 250 ms ─────────

async function s4ControlPlane(ctx: Ctx, profile: Profile): Promise<Record<string, unknown>> {
  const { core, manager, manifest, identitySeed, communityId, rootDir, swarm } = ctx;
  const blobSize = profile === 'full' ? 32 * 1024 * 1024 : 4 * 1024 * 1024;
  const ops = profile === 'full' ? 1000 : 200;
  const content = fillDeterministic(Buffer.alloc(blobSize), mulberry32(SEED + 77));
  const src = writeSource(rootDir, 's4-grande.bin', content);
  const ticket = manager.createTicketForMain(communityId, src, blobSize);

  const recorded: Buffer[] = [];
  const ackedSeqByOpId = new Map<string, number>();
  let ackSeq = 0;
  const outbox = new core.Outbox({
    manifest,
    communityId,
    submit: async (envelopes) => {
      for (const env of envelopes) recorded.push(Buffer.from(env));
      return envelopes.map(() => ({ ok: true as const, seq: ++ackSeq }));
    },
    // o host observa a própria réplica: op acked fica visível e reconcile() remove (§11.6),
    // liberando o canal para o próximo authorSeq — sem isso o canal fica bloqueado por design
    observation: {
      observedOp: (opId) => {
        const seq = ackedSeqByOpId.get(opId);
        return seq === undefined ? null : { seq };
      },
      watermark: () => 0,
      interpretedSeq: () => -1,
    },
    random: () => 0.5,
    maxItems: 50_000,
  });

  const latencies: number[] = [];
  const scope = 'channel:ch-1';
  const submitLoop = (async () => {
    for (let i = 0; i < ops; i++) {
      const t0 = performance.now();
      const authorSeq = outbox.nextAuthorSeq(scope);
      const opId = `op-s4-${i}`;
      const envelope = fillDeterministic(Buffer.alloc(512), mulberry32(SEED + 5000 + i)); // message.send sintético
      const enq = outbox.enqueue(envelope, { opId, channelId: 'ch-1', sequenceScope: scope, kind: 7, authorSeq, clientRef: null });
      if (!enq.enqueued) throw new Error(`enqueue falhou: ${JSON.stringify(enq)}`);
      await outbox.flush();
      ackedSeqByOpId.set(opId, authorSeq); // host appendou; observável pela réplica
      outbox.reconcile();
      latencies.push(performance.now() - t0);
    }
  })();

  const t0 = performance.now();
  const res = await manager.stage(ticket.ticketId, { identitySeed, communityId });
  const stageMs = performance.now() - t0;
  await submitLoop;

  // bytes de anexo atravessando o RPC de controle = 0 (critério do plano):
  // nenhuma fatia do conteúdo aparece em nenhum envelope submetido
  const slices = 8;
  const sliceLen = 48;
  let sliceHits = 0;
  for (let s = 0; s < slices; s++) {
    const off = Math.floor(((content.length - sliceLen) * s) / slices);
    const needle = content.subarray(off, off + sliceLen);
    for (const env of recorded) {
      if (env.indexOf(needle) !== -1) sliceHits++;
    }
  }
  if (sliceHits !== 0) throw new Error(`${sliceHits} fatias do anexo encontradas no RPC de controle`);

  const controlBytes = recorded.reduce((sum, b) => sum + b.length, 0) + swarm.calls.reduce((sum, c) => sum + c.bytes, 0);
  if (controlBytes <= 0) throw new Error('canal de controle não transportou nada — instrumento quebrado');
  if (outbox.metrics['submitted'] !== ops) throw new Error(`submitted ${String(outbox.metrics['submitted'])} != ${String(ops)}`);
  // swarm só carrega tópicos (hex), nunca dados
  for (const c of swarm.calls) {
    if (c.method === 'join' && c.bytes > 4096) throw new Error('swarm.join carregou payload suspeito');
  }

  latencies.sort((a, b) => a - b);
  const p95 = percentile(latencies, 0.95);
  if (p95 > 250) throw new Error(`p95 submitOp ${p95.toFixed(2)}ms > 250ms durante upload nominal`);

  return {
    blobBytes: blobSize,
    controlRpcBytes: controlBytes,
    fatiasDoAnexoNoControle: sliceHits,
    opsSubmetidas: ops,
    p95SubmitOpMs: +p95.toFixed(3),
    maxSubmitOpMs: +latencies[latencies.length - 1]!.toFixed(3),
    stageMs: Math.round(stageMs),
    throughputMBps: +(blobSize / (1024 * 1024) / (stageMs / 1000)).toFixed(1),
    blobsCoreKeyHex: res.blobsCoreKey.toString('hex').slice(0, 16),
  };
}

// ─── S5 — Ataques no leitor: tamanho, hash, indisponibilidade, cancelamento ──

async function s5ReaderAttacks(ctx: Ctx, profile: Profile): Promise<Record<string, unknown>> {
  const { core, manager, identitySeed, communityId, rootDir } = ctx;
  const cycles = profile === 'full' ? 30 : 10;
  const dir = path.join(rootDir, 's5');
  fs.mkdirSync(dir, { recursive: true });
  const ownerBase = path.join(rootDir, 'blobs'); // dataDir do manager
  let passed = 0;

  for (let i = 0; i < cycles; i++) {
    const content = fillDeterministic(Buffer.alloc(256 * 1024), mulberry32(SEED + 9000 + i));
    const src = writeSource(dir, `s5-${i}.bin`, content);
    const ticket = manager.createTicketForMain(communityId, src, content.length);
    const res = await manager.stage(ticket.ticketId, { identitySeed, communityId });
    const key = res.blobsCoreKey;
    const id = res.blobIdHex;

    // download legítimo: hash correto em 100% dos ciclos
    const dl = await manager.download({ blobsCoreKey: key, blobIdHex: id, declaredSize: content.length, hash: res.hash, name: res.name });
    if (!core.blobs.hashForBlobContent(fs.readFileSync(dl.path)).equals(res.hash)) throw new Error(`ciclo ${i}: download divergiu do hash`);
    if (manager.getDownloadState(key, id) !== 'downloaded') throw new Error(`ciclo ${i}: estado pós-download ${String(manager.getDownloadState(key, id))}`);

    // localizar arquivo armazenado do dono (mock da entrega pelo par)
    const ownerDir = path.join(ownerBase, key.toString('hex'));
    const files = fs.readdirSync(ownerDir).filter((f) => f.startsWith(id));
    if (files.length === 0) throw new Error(`ciclo ${i}: blob não encontrado no store do dono`);
    const storePath = path.join(ownerDir, files[0]!);
    const original = Buffer.from(fs.readFileSync(storePath));

    // ataque de tamanho: par entrega mais bytes que o declarado → abortado no leitor
    fs.writeFileSync(storePath, Buffer.concat([original, Buffer.alloc(4096, 7)]));
    await expectReject(
      () => manager.download({ blobsCoreKey: key, blobIdHex: id, declaredSize: content.length, hash: res.hash, name: res.name }),
      'E_BLOB_CORRUPT',
    );
    if (manager.getDownloadState(key, id) !== 'corrupt') throw new Error(`ciclo ${i}: pós-ataque de tamanho ${String(manager.getDownloadState(key, id))}`);

    // ataque de hash: bytes divergem do declarado → abortado no leitor
    const tampered = Buffer.from(original);
    const mid = Math.floor(tampered.length / 2);
    tampered[mid] = (tampered[mid] ?? 0) ^ 0xff;
    fs.writeFileSync(storePath, tampered);
    await expectReject(
      () => manager.download({ blobsCoreKey: key, blobIdHex: id, declaredSize: content.length, hash: res.hash, name: res.name }),
      'E_BLOB_CORRUPT',
    );
    if (manager.getDownloadState(key, id) !== 'corrupt') throw new Error(`ciclo ${i}: pós-ataque de hash ${String(manager.getDownloadState(key, id))}`);

    // restaurar e confirmar recuperação pelo hash
    fs.writeFileSync(storePath, original);
    const dlOk = await manager.download({ blobsCoreKey: key, blobIdHex: id, declaredSize: content.length, hash: res.hash, name: res.name });
    if (!core.blobs.hashForBlobContent(fs.readFileSync(dlOk.path)).equals(res.hash)) throw new Error(`ciclo ${i}: restauração falhou`);

    // indisponibilidade nomeada (L-9): nenhum par tem os blocos
    const ghostKey = fillDeterministic(Buffer.alloc(32), mulberry32(SEED + 42 + i));
    await expectReject(
      () =>
        manager.download({
          blobsCoreKey: ghostKey,
          blobIdHex: 'f'.repeat(32),
          declaredSize: 16,
          hash: core.blobs.hashForBlobContent(Buffer.alloc(0)),
          name: 'fantasma.png',
        }),
      'E_NO_PEERS',
    );
    if (manager.getDownloadState(ghostKey, 'f'.repeat(32)) !== 'unavailable') throw new Error(`ciclo ${i}: indisponível não nomeado`);

    // cancelamento é estado nomeado (DR-40)
    manager.cancelDownload(key, id);
    if (manager.getDownloadState(key, id) !== 'cancelled') throw new Error(`ciclo ${i}: cancelamento não registrado`);

    passed++;
  }
  if (passed !== cycles) throw new Error(`${passed}/${cycles} ciclos de ataque`);
  return {
    ciclos: cycles,
    aprovados: passed,
    ataquesAbortados: ['size→E_BLOB_CORRUPT', 'hash→E_BLOB_CORRUPT'],
    indisponivelNomeado: 'unavailable',
    canceladoNomeado: 'cancelled',
  };
}

// ─── S6 — Retomada após crash, GC de órfão e cota (§13.5, §13.8, §22.4) ──────

async function s6ResumeGcQuota(ctx: Ctx, profile: Profile): Promise<Record<string, unknown>> {
  const { core, manager, identitySeed, communityId, rootDir } = ctx;
  const cycles = profile === 'full' ? 30 : 10;
  const dir = path.join(rootDir, 's6');
  fs.mkdirSync(dir, { recursive: true });

  let resumePassed = 0;
  for (let i = 0; i < cycles; i++) {
    // crash no meio do staging: linha writing com bytesWritten>0 e origem existente → retoma
    const content = fillDeterministic(Buffer.alloc(128 * 1024), mulberry32(SEED + 20000 + i));
    const srcA = writeSource(dir, `resume-a-${i}.bin`, content);
    const t1 = manager.createTicketForMain(communityId, srcA, content.length);
    manager.staging.updateProgress(t1.ticketId, Math.floor(content.length / 2));

    // crash com origem sumida → descarte nomeado E_FILE_UNREADABLE (linha failed)
    const srcB = writeSource(dir, `resume-b-${i}.bin`, content);
    const t2 = manager.createTicketForMain(communityId, srcB, content.length);
    fs.unlinkSync(srcB);
    manager.staging.updateProgress(t2.ticketId, 1024);

    // download interrompido → queued com bytesDownloaded preservado (§13.4)
    const key = core.blobs.deriveMemberBlobsPublicKey(identitySeed, communityId);
    const ghostId = `d${String(i)}`.padEnd(32, '0');
    manager.cache.upsert({ blobsCoreKey: key, blobIdHex: ghostId, state: 'downloading', bytesDownloaded: 1234, declaredSize: 4096 });

    const boot = manager.resumeOnBoot();
    const resumedIds = manager.staging.listByState('writing').map((r) => r.ticketId);
    if (!resumedIds.includes(t1.ticketId) || boot.stagingResumed < 1) throw new Error(`ciclo ${i}: staging writing não retomado`);
    const failedRow = manager.staging.get(t2.ticketId);
    if (failedRow === null || failedRow.state !== 'failed') throw new Error(`ciclo ${i}: origem sumida não virou failed/E_FILE_UNREADABLE`);
    const q = manager.cache.get(key, ghostId);
    if (q === null || q.state !== 'queued' || q.bytesDownloaded !== 1234) throw new Error(`ciclo ${i}: retomada de download perdeu bytesDownloaded`);
    resumePassed++;
  }
  if (resumePassed !== cycles) throw new Error(`retomada ${resumePassed}/${cycles}`);

  // GC de staging órfão: done sem referência após STAGING_ORPHAN_MS → clear+remove; com referência fica
  let now = 5_000_000;
  const clock = (): number => now;
  const gcCtx = makeCtx(ctx.core, 'gc', { clock });
  try {
    const orphanContent = fillDeterministic(Buffer.alloc(2048), mulberry32(SEED + 30000));
    const orphanSrc = writeSource(gcCtx.rootDir, 'orfao.bin', orphanContent);
    const oldTicket = gcCtx.manager.createTicketForMain(gcCtx.communityId, orphanSrc, orphanContent.length);
    now += core.blobs.STAGING_ORPHAN_MS_DEFAULT + 1000;
    const freshTicket = gcCtx.manager.createTicketForMain(gcCtx.communityId, orphanSrc, orphanContent.length);
    gcCtx.manager.staging.markDone(oldTicket.ticketId, core.blobs.hashForBlobContent(orphanContent), orphanContent.length);
    gcCtx.manager.staging.markDone(freshTicket.ticketId, core.blobs.hashForBlobContent(orphanContent), orphanContent.length);

    let cleared = 0;
    const gcNoRef = gcCtx.manager.gcStaging({ hasReference: () => false, clearBlobs: () => cleared++, now });
    if (gcNoRef.removed !== 1 || cleared !== 1) throw new Error(`GC sem referência: ${JSON.stringify(gcNoRef)}`);
    if (gcCtx.manager.staging.get(oldTicket.ticketId) !== null) throw new Error('órfão não removido');
    if (gcCtx.manager.staging.get(freshTicket.ticketId) === null) throw new Error('staging recente removido indevidamente');

    const gcWithRef = gcCtx.manager.gcStaging({ hasReference: () => true, clearBlobs: (): void => {}, now });
    if (gcWithRef.removed !== 0) throw new Error('referenciado foi coletado');
  } finally {
    gcCtx.dispose();
  }

  // cota por membro (R-14) e limite de cache — bordas exatas
  const GiB = 1024 ** 3;
  if (core.blobs.BlobManager.exceedsQuota(5 * GiB - 1, 1) !== false) throw new Error('cota recusou dentro do limite');
  if (core.blobs.BlobManager.exceedsQuota(5 * GiB - 1, 2) !== true) throw new Error('cota aceitou acima do limite');
  if (core.blobs.BlobManager.exceedsCache(100, 60, 40) !== false) throw new Error('cache recusou dentro do limite');
  if (core.blobs.BlobManager.exceedsCache(100, 60, 41) !== true) throw new Error('cache aceitou acima do limite');

  // GC LRU do cache com proteção §13.7 regra 2 (blocos do autor com mensagem viva nunca saem).
  // Linhas protegidas não contam no total do GC: o limiar precisa ser cruzado só pelas desprotegidas.
  const lruCtx = makeCtx(ctx.core, 'lru', { clock, cacheMaxBytes: 1500 });
  try {
    const key = core.blobs.deriveMemberBlobsPublicKey(lruCtx.identitySeed, lruCtx.communityId);
    const mk = (id: string): void => {
      lruCtx.manager.cache.upsert({ blobsCoreKey: key, blobIdHex: id, state: 'downloaded', bytesDownloaded: 1000, declaredSize: 1000, path: `/tmp/${id}` });
      now += 10;
    };
    mk('a'.padEnd(32, '0'));
    mk('b'.padEnd(32, '0'));
    mk('c'.padEnd(32, '0'));
    const protectedId = 'b'.padEnd(32, '0');
    const gc = lruCtx.manager.gcCache({ isProtected: (row) => row.blobIdHex === protectedId, now });
    if (gc.removed !== 1 || gc.freedBytes !== 1000) throw new Error(`LRU: ${JSON.stringify(gc)}`);
    if (lruCtx.manager.cache.get(key, 'a'.padEnd(32, '0')) !== null) throw new Error('mais antigo não coletado primeiro');
    if (lruCtx.manager.cache.get(key, protectedId) === null) throw new Error('blob protegido foi coletado');
  } finally {
    lruCtx.dispose();
  }

  return {
    ciclosRetomada: cycles,
    retomadaAprovada: resumePassed,
    descarteOrigemSumida: 'failed/E_FILE_UNREADABLE',
    gcOrfao: 'done sem referência após STAGING_ORPHAN_MS → clear+remove',
    cotaGiB: 5,
    lruComProtecao: true,
  };
}

// ─── Orquestração ─────────────────────────────────────────────────────────────

export async function runHarness(profile: Profile): Promise<HarnessResult> {
  const core = await loadCore();
  const steps: StepResult[] = [];
  const metrics: Record<string, unknown> = {};

  async function step(
    id: string,
    desc: string,
    fn: (ctx: Ctx) => Promise<Record<string, unknown>> | Record<string, unknown>,
    ctxFactory: () => Ctx,
    skipCtx = false,
  ): Promise<void> {
    const t0 = performance.now();
    const ctx = skipCtx ? makeCtx(core, `${id}-base`) : ctxFactory();
    try {
      const evidence = await fn(ctx);
      steps.push({ id, desc, ok: true, ms: Math.round(performance.now() - t0), evidence });
      Object.assign(metrics, evidence);
      console.log(`  OK   ${id}  ${desc}`);
    } catch (e) {
      const err = e as Error;
      steps.push({ id, desc, ok: false, ms: Math.round(performance.now() - t0), error: err.message });
      console.log(`  FALHA ${id}  ${desc} — ${err.message}`);
    } finally {
      ctx.dispose();
    }
  }

  await step('S1', 'ownership por autor — chave derivada; sem chave não escreve (A09)', s1Ownership, () => makeCtx(core, 's1'));
  await step('S2', 'ticket uso único/TTL/escopo; path nunca cruza IPC-R (A15/T-16/DR-37)', (ctx) => s2Ticket(ctx.core), () => makeCtx(core, 's2'));
  await step('S3', `stage→hash→barreira em ${profile === 'full' ? 100 : 25} ciclos, 100% hash correto`, (ctx) => s3StageCycles(ctx, profile), () => makeCtx(core, 's3'));
  await step('S4', 'RPC de controle = 0 bytes de anexo; p95 submitOp ≤ 250 ms', (ctx) => s4ControlPlane(ctx, profile), () => makeCtx(core, 's4'));
  await step('S5', 'ataques no leitor abortados (tamanho/hash); unavailable/cancelled nomeados', (ctx) => s5ReaderAttacks(ctx, profile), () => makeCtx(core, 's5'));
  await step('S6', 'retomada pós-crash 100%; GC de órfão; cota R-14; LRU protegido', (ctx) => s6ResumeGcQuota(ctx, profile), () => makeCtx(core, 's6'));

  const ok = steps.every((s) => s.ok);
  return { profile, ok, steps, metrics };
}
