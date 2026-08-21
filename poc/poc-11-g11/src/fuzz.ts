// Motor de fuzzing G11 — injeta casos na superfície de decisão de anexo do produto
// (core/src/l2/blobs) e verifica os invariantes de §13.6 (T-17/T-48/DR-41) e §8.6.
//
// Invariantes:
//   I0 nenhuma função de decisão lança (crash = reprovação)
//   I1 nome que viola §8.6 é rejeitado por isValidAttachmentName (não chega ao filesystem)
//   I2 extensão executável é bloqueada até para reveal, qualquer kind declarado
//   I3 reveal permitido ⇒ kind ∈ {image,audio,video,document} ∧ ext na tabela §13.6 ∧ não executável
//   I4 inline ⇔ ext ∈ {png,jpg,jpeg,gif,webp} (superfície de decodificador do v1)
//   I5 kindFromExtension coerente com a tabela normativa §13.6

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { loadCore, type BlobsApi, type BlobKindNumber } from './core.js';
import { CaseGenerator, EXECUTABLE_EXTS, type FuzzCase } from './gen.js';

export type Profile = 'quick' | 'full';

export interface FuzzResult {
  ok: boolean;
  totalCases: number;
  byCategory: Record<string, number>;
  crashes: number;
  violations: Record<string, number>;
  violationSamples: string[];
  fsSampled: number;
  fsRejectedAtTicket: number;
  fsStaged: number;
  memory: { baselineHeapMB: number; peakHeapMB: number; finalHeapMB: number; series: Array<{ at: number; heapMB: number }> };
  ms: number;
}

// Tabela normativa §13.6 duplicada como oráculo independente da implementação
const SPEC_KIND_BY_EXT: ReadonlyMap<string, BlobKindNumber> = (() => {
  const m = new Map<string, BlobKindNumber>();
  const table: Array<[BlobKindNumber, string[]]> = [
    [0, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'tiff', 'heic']],
    [1, ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v']],
    [2, ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac']],
    [3, ['pdf', 'txt', 'md', 'csv', 'json', 'xml', 'odt', 'ods', 'odp', 'docx', 'xlsx', 'pptx', 'rtf']],
    [4, ['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar']],
  ];
  for (const [kind, exts] of table) for (const e of exts) m.set(e, kind);
  return m;
})();

const INLINE_SET = new Set<string>(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const REVEAL_KINDS = new Set<BlobKindNumber>([0, 1, 2, 3]); // image, video, audio, document

function extOf(name: string): string {
  const base = name.includes('/') || name.includes('\\') ? name.split(/[\\/]/).pop() ?? '' : name;
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Oráculo §8.6 derivado do texto normativo, independente da implementação. */
export function spec86Valid(name: string): boolean {
  if (Buffer.byteLength(name, 'utf8') < 1 || Buffer.byteLength(name, 'utf8') > 255) return false;
  if (/[/\\\0]/.test(name)) return false;
  for (const ch of name) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp === 0x7f) return false;
  }
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(name)) return false;
  if (name.endsWith('.') || name.endsWith(' ')) return false;
  return true;
}

const ALL_KINDS: readonly BlobKindNumber[] = [0, 1, 2, 3, 4, 5];

interface Violations {
  counts: Record<string, number>;
  samples: string[];
}

function record(v: Violations, id: string, detail: string): void {
  v.counts[id] = (v.counts[id] ?? 0) + 1;
  if (v.samples.length < 20) v.samples.push(`${id}: ${detail}`);
}

function checkInvariants(blobs: BlobsApi, c: FuzzCase, v: Violations): void {
  let nameValid: boolean;
  try {
    // I0 — decisões nunca lançam, qualquer entrada
    nameValid = blobs.isValidAttachmentName(c.name);
    blobs.kindFromFilename(c.name);
    blobs.isExecutableExtension(c.name);
    blobs.isInlineImageAllowed(c.name);
    for (const k of ALL_KINDS) blobs.isRevealAllowed(k, c.name);
  } catch (e) {
    record(v, 'I0-crash', `${JSON.stringify(c.name)} → ${String(e).slice(0, 120)}`);
    return;
  }

  // I1 — §8.6
  const expectedValid = spec86Valid(c.name);
  if (nameValid !== expectedValid) {
    record(v, 'I1-nome86', `isValidAttachmentName=${String(nameValid)} oráculo=${String(expectedValid)} nome=${JSON.stringify(c.name)}`);
  }

  const ext = extOf(c.name);
  const execExpected = EXECUTABLE_EXTS.includes(ext as (typeof EXECUTABLE_EXTS)[number]);

  // I2 — blocklist executável
  if (execExpected && !blobs.isExecutableExtension(c.name)) {
    record(v, 'I2-exec-nao-detectada', `nome=${JSON.stringify(c.name)}`);
  }
  if (execExpected) {
    for (const k of ALL_KINDS) {
      if (blobs.isRevealAllowed(k, c.name)) {
        record(v, 'I2-exec-revelavel', `kind=${String(k)} nome=${JSON.stringify(c.name)}`);
      }
    }
  }

  // I3 — reveal só para kinds image/audio/video/document com extensão da tabela §13.6.
  // A extensão precisa pertencer à união das tabelas dos 4 kinds reveláveis; não precisa
  // coincidir com o kind declarado (a divergência declarada é o próprio ataque testado).
  for (const k of ALL_KINDS) {
    if (!blobs.isRevealAllowed(k, c.name)) continue;
    if (!REVEAL_KINDS.has(k)) record(v, 'I3-kind-fora', `kind=${String(k)} nome=${JSON.stringify(c.name)}`);
    const tabKind = SPEC_KIND_BY_EXT.get(ext);
    if (tabKind === undefined || tabKind === blobs.BLOB_KIND.archive) record(v, 'I3-ext-fora-da-tabela', `kind=${String(k)} ext=${JSON.stringify(ext)}`);
  }

  // I4 — inline restrito aos 5 formatos de imagem
  const inlineExpected = INLINE_SET.has(ext);
  if (blobs.isInlineImageAllowed(c.name) !== inlineExpected) {
    record(v, 'I4-inline', `nome=${JSON.stringify(c.name)} ext=${JSON.stringify(ext)}`);
  }

  // I5 — tabela kind×ext
  const tabKind = SPEC_KIND_BY_EXT.get(ext);
  const gotKind = blobs.kindFromExtension(ext);
  if (tabKind === undefined) {
    if (gotKind !== blobs.BLOB_KIND.other) record(v, 'I5-desconhecida-nao-other', `ext=${JSON.stringify(ext)} kind=${String(gotKind)}`);
  } else if (gotKind !== tabKind) {
    record(v, 'I5-tabela-diverge', `ext=${JSON.stringify(ext)} esperado=${String(tabKind)} obtido=${String(gotKind)}`);
  }
}

export async function runFuzz(profile: Profile): Promise<FuzzResult> {
  const core = await loadCore();
  const blobs = core.blobs;
  const totalTarget = profile === 'full' ? 300_000 : 100_000;
  const sampleEvery = 200;

  const gen = new CaseGenerator(20260821);
  const byCategory: Record<string, number> = {};
  const violations: Violations = { counts: {}, samples: [] };
  let crashes = 0;
  let fsSampled = 0;
  let fsRejectedAtTicket = 0;
  let fsStaged = 0;

  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poc11-'));
  const manifest = new core.ManifestDb(path.join(rootDir, 'manifest.db'));
  const swarm = { join(): void {}, leave(): void {}, isJoined: (): boolean => false };
  const manager = new blobs.BlobManager({ manifest, swarm, dataDir: path.join(rootDir, 'blobs') });
  const identitySeed = Buffer.alloc(32, 0x5e);
  const communityId = 'ab'.repeat(32);
  const key = blobs.deriveMemberBlobsPublicKey(identitySeed, communityId);
  const sampleSrcDir = path.join(rootDir, 'src');
  fs.mkdirSync(sampleSrcDir, { recursive: true });

  const memSeries: Array<{ at: number; heapMB: number }> = [];
  const baselineHeap = process.memoryUsage().heapUsed;
  let peakHeap = baselineHeap;
  const t0 = performance.now();

  try {
    for (let i = 0; i < totalTarget; i++) {
      const c = gen.next();
      byCategory[c.cat] = (byCategory[c.cat] ?? 0) + 1;

      const before = violations.counts['I0-crash'] ?? 0;
      checkInvariants(blobs, c, violations);
      if ((violations.counts['I0-crash'] ?? 0) > before) crashes++;

      // amostragem de filesystem: caminho real ticket→stage→canReveal
      if (i % sampleEvery === 0) {
        fsSampled++;
        const nameValid = spec86Valid(c.name);
        if (!nameValid) {
          // nome rejeitável não chega ao filesystem: a fronteira para nome controlado pelo
          // renderer é blob.download{name} — valida o nome completo antes de qualquer disco
          let rejected = false;
          try {
            await manager.download({
              blobsCoreKey: key,
              blobIdHex: '0'.repeat(32),
              declaredSize: 16,
              hash: blobs.hashForBlobContent(Buffer.alloc(0)),
              name: c.name,
            });
          } catch (e) {
            rejected = (e as { code?: string }).code === 'E_VALIDATION';
          }
          if (!rejected) record(violations, 'FS-invalido-aceito', `nome=${JSON.stringify(c.name)}`);
          else fsRejectedAtTicket++;
        } else {
          const srcPath = path.join(sampleSrcDir, `s-${i}.bin`);
          fs.writeFileSync(srcPath, gen.contentFor(c));
          try {
            const ticket = manager.createTicketForMain(communityId, srcPath, 16);
            const res = await manager.stage(ticket.ticketId, { identitySeed, communityId });
            fsStaged++;
            const storedDir = path.join(rootDir, 'blobs', res.blobsCoreKey.toString('hex'));
            const storedPath = path.join(storedDir, `${res.blobIdHex}-${res.name}`);
            // nenhum arquivo escapa do dataDir (travessia impossível pós-validação §8.6)
            if (!path.resolve(storedPath).startsWith(path.resolve(path.join(rootDir, 'blobs')))) {
              record(violations, 'FS-travessia', `stored=${storedPath}`);
            }
            // canReveal consistente com a allowlist §13.6
            const idHex = `c${String(i % 10)}${''.padEnd(30, '0')}`.slice(0, 32);
            manager.cache.upsert({ blobsCoreKey: key, blobIdHex: idHex, state: 'downloaded', bytesDownloaded: 16, declaredSize: 16, path: storedPath });
            const got = manager.canReveal(key, idHex).allowed;
            const expected = blobs.isRevealAllowed(blobs.kindFromFilename(res.name), res.name);
            if (got !== expected) record(violations, 'FS-canReveal-diverge', `nome=${JSON.stringify(res.name)} got=${String(got)}`);
          } catch (e) {
            record(violations, 'FS-stage-falhou', `nome=${JSON.stringify(c.name)} → ${String(e).slice(0, 120)}`);
          }
        }
      }

      if (i % 10_000 === 0) {
        const heap = process.memoryUsage().heapUsed;
        peakHeap = Math.max(peakHeap, heap);
        memSeries.push({ at: i, heapMB: +(heap / 1024 ** 2).toFixed(1) });
      }
    }
  } finally {
    if (typeof globalThis.gc === 'function') globalThis.gc();
    const finalHeap = process.memoryUsage().heapUsed;
    memSeries.push({ at: totalTarget, heapMB: +(finalHeap / 1024 ** 2).toFixed(1) });
    try {
      manifest.close();
    } catch {}
    fs.rmSync(rootDir, { recursive: true, force: true });

    const ms = Math.round(performance.now() - t0);
    const totalViolations = Object.values(violations.counts).reduce((s, n) => s + n, 0);
    const memoryOk = finalHeap <= baselineHeap + 48 * 1024 ** 2;
    if (!memoryOk) record(violations, 'MEM-nao-retorna', `baseline=${baselineHeap} final=${finalHeap}`);

    return {
      ok: totalViolations === 0 && crashes === 0 && totalTarget >= 100_000,
      totalCases: totalTarget,
      byCategory,
      crashes,
      violations: violations.counts,
      violationSamples: violations.samples,
      fsSampled,
      fsRejectedAtTicket,
      fsStaged,
      memory: {
        baselineHeapMB: +(baselineHeap / 1024 ** 2).toFixed(1),
        peakHeapMB: +(peakHeap / 1024 ** 2).toFixed(1),
        finalHeapMB: +(finalHeap / 1024 ** 2).toFixed(1),
        series: memSeries,
      },
      ms,
    };
  }
}
