// Carregador do código de produto (core/dist) — a superfície fuzzada é exatamente a
// publicada pela fase 6. Tipos são duplicatas locais mínimas (o core não emite .d.ts).

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export const CORE_DIST = join(process.cwd(), '..', '..', 'core', 'dist', 'src');

export type BlobKindNumber = 0 | 1 | 2 | 3 | 4 | 5;

export interface BlobsApi {
  BLOB_KIND: { image: 0; video: 1; audio: 2; document: 3; archive: 4; other: 5 };
  kindFromExtension(ext: string): BlobKindNumber;
  kindFromFilename(nameOrPath: string): BlobKindNumber;
  isExecutableExtension(extOrName: string): boolean;
  isInlineImageAllowed(extOrName: string): boolean;
  isRevealAllowed(kind: BlobKindNumber, extOrName: string): boolean;
  isValidAttachmentName(name: string): boolean;
  hashForBlobContent(content: Buffer): Buffer;
  deriveMemberBlobsPublicKey(identitySeed: Buffer, communityId: string | Buffer): Buffer;
  BlobManager: new (opts: {
    manifest: { raw: unknown };
    swarm: { join(t: string, u: unknown): void; leave(t: string): void; isJoined(t: string): boolean };
    dataDir?: string;
    clock?: () => number;
  }) => {
    createTicketForMain(communityId: string, filePath: string, sizeBytes: number): { ticketId: string; name: string };
    download(opts: { blobsCoreKey: Buffer; blobIdHex: string; declaredSize: number; hash: Buffer; name: string }): Promise<{ path: string }>;
    stage(ticketId: string, opts?: { identitySeed?: Buffer; communityId?: string }): Promise<{ blobsCoreKey: Buffer; blobIdHex: string; name: string; hash: Buffer }>;
    cache: {
      upsert(row: { blobsCoreKey: Buffer; blobIdHex: string; state: string; bytesDownloaded?: number; declaredSize?: number | null; path?: string | null }): void;
    };
    canReveal(blobsCoreKey: Buffer | string, blobIdHex: string): { allowed: boolean; reason?: string };
    tickets: {
      issue(communityId: string, filePath: string, sizeBytes: number): { ticketId: string; name: string };
    };
  };
}

export interface ManifestDbLike {
  raw: unknown;
  close(): void;
}

export interface CoreApi {
  blobs: BlobsApi;
  ManifestDb: new (path: string) => ManifestDbLike;
}

async function importCoreModule(rel: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(join(CORE_DIST, rel)).href)) as Record<string, unknown>;
}

/** Carrega os módulos de produto compilados (o run-all roda o build do core antes). */
export async function loadCore(): Promise<CoreApi> {
  const blobs = (await importCoreModule('l2/blobs/index.js')) as unknown as BlobsApi;
  const manifest = await importCoreModule('l0/manifest/index.js');
  return { blobs, ManifestDb: manifest['ManifestDb'] as CoreApi['ManifestDb'] };
}
