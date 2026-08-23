// A superfície de identidade de §15.4/§5.5 e o estado `awaiting-identity` de §3.3 — raiz de
// composição: quem junta o `IdentityManager` (L0), o `manifest` (L0), o keystore via IPC-M
// (§3.2/A13) e a ponte de submissão por comunidade.
//
// Nada aqui decide domínio: validação de campo é a mesma do `fold` (`checkDisplayName`,
// `isAvatarColor`), os erros são os da coluna de §15.4, e o material privado nunca sai do
// processo — o blob de export atravessa IPC-M como bytes, e o caminho de arquivo escolhido
// pelo diálogo do main nunca volta para cá nem segue para o renderer (§13.3, T-16).

import {
  IdentityManager,
  type ExportCommunity,
  type IdentityRecord,
} from '../l0/identity/index.ts';
import type { KeystoreOracle } from '../l0/keystore/index.ts';
import { acceptInsecure, hasAcceptedInsecure } from '../l0/keystore/index.ts';
import type { ManifestDb } from '../l0/manifest/index.ts';
import { isAvatarColor, checkDisplayName } from '../l1/fold/index.ts';

/** Presença local de §6.1 — `offline` nunca é escrito; a tabela é fechada. */
export const PRESENCE_VALUES = ['online', 'idle', 'dnd', 'invisible'] as const;
export type LocalPresence = (typeof PRESENCE_VALUES)[number];

/**
 * O keystore visto pela superfície de identidade. `kind` alimenta `CoreStatus.keystore`
 * (§15.6); `available` é o gate `E_KEYSTORE_UNAVAILABLE` (§3.2 L-2).
 */
export type IdentityKeystorePort = {
  readonly oracle: KeystoreOracle;
  kind(): 'secure' | 'insecure-fallback';
  available(): Promise<boolean>;
};

/** Porta segura quando o shell injeta um oráculo real (safeStorage no main, via IPC-M). */
export function secureKeystorePort(oracle: KeystoreOracle & { isAvailable?(): boolean; keystoreInfo?(): Promise<{ available: boolean }> }): IdentityKeystorePort {
  return {
    oracle,
    kind: () => 'secure',
    available: async () => {
      if (typeof oracle.isAvailable === 'function') return oracle.isAvailable();
      if (typeof oracle.keystoreInfo === 'function') return (await oracle.keystoreInfo()).available;
      return true;
    },
  };
}

/** Porta do fallback inseguro — exige aceite explícito persistido (L-2, poc-10). */
export function insecureFallbackKeystorePort(oracle: KeystoreOracle): IdentityKeystorePort {
  return { oracle, kind: () => 'insecure-fallback', available: async () => true };
}

export type ExportCommunityWire = {
  readonly communityId: string;
  readonly coreKey: string;
  readonly blobsKey: string;
  readonly communitySeed?: string;
};

export type IdentityServiceDeps = {
  readonly manager: IdentityManager;
  readonly manifest: ManifestDb;
  /** `<dataDir>` — onde o aceite inseguro fica persistido. */
  readonly dataDir: string;
  readonly keystore: IdentityKeystorePort;
  /** §5.4 — a Data Key corrente da instalação (a mesma que protege as sementes). */
  dataKey(): Buffer;
  now(): number;
  /**
   * §15.7 `file.save` — o main mostra o diálogo e GRAVA os bytes; daqui sai `{ok}` e
   * nunca um caminho. Ausente → `E_CANCELLED` (sem shell não há para onde gravar).
   */
  saveFile?(a: { suggestedName: string; data: Buffer }): Promise<{ ok: true } | { ok: false; code: string }>;
  /** §5.5 import — o main lê o arquivo escolhido; ausente → `E_CANCELLED`. */
  readFile?(): Promise<Buffer | null>;
};

export type IdentityCreateResult =
  | { readonly ok: true; readonly publicKey: string; readonly handle: string; readonly createdAt: number }
  | { readonly ok: false; readonly code: string; readonly field?: string };

export type IdentityUpdateQueued = {
  readonly communityId: string;
  readonly opId: string;
};

function recordWire(rec: IdentityRecord): { publicKey: string; handle: string; createdAt: number } {
  return { publicKey: rec.publicKeyHex, handle: rec.handle, createdAt: rec.createdAt };
}

/**
 * O serviço que os comandos `identity.*` consomem. Uma instância por núcleo; o mesmo
 * `manager` que o boot usa para `deps.identity()`.
 */
export class IdentityService {
  readonly #deps: IdentityServiceDeps;

  constructor(deps: IdentityServiceDeps) {
    this.#deps = deps;
  }

  get manager(): IdentityManager {
    return this.#deps.manager;
  }

  /** §15.6 `CoreStatus.keystore`. */
  keystoreKind(): 'secure' | 'insecure-fallback' {
    return this.#deps.keystore.kind();
  }

  /** Aceite explícito do modo inseguro (L-2) — lido do arquivo persistido. */
  hasAcceptedInsecure(): boolean {
    return hasAcceptedInsecure(this.#deps.dataDir);
  }

  acceptInsecure(backend: string): void {
    acceptInsecure(this.#deps.dataDir, backend);
  }

  async create(displayName: unknown, avatarColor: unknown): Promise<IdentityCreateResult> {
    if (this.#deps.manager.isLoaded) return { ok: false, code: 'E_IDENTITY_EXISTS' };
    // Coluna Erros de §15.4: E_VALIDATION antes dos gates de keystore (ordem da tabela).
    if (typeof displayName !== 'string') return { ok: false, code: 'E_VALIDATION', field: 'displayName' };
    const nome = checkDisplayName(displayName);
    if (!nome.ok) return { ok: false, code: 'E_VALIDATION', field: 'displayName' };
    if (typeof avatarColor !== 'number' || !isAvatarColor(avatarColor)) {
      return { ok: false, code: 'E_VALIDATION', field: 'avatarColor' };
    }
    if (!(await this.#deps.keystore.available())) return { ok: false, code: 'E_KEYSTORE_UNAVAILABLE' };
    if (this.#deps.keystore.kind() === 'insecure-fallback' && !this.hasAcceptedInsecure()) {
      return { ok: false, code: 'E_KEYSTORE_INSECURE' };
    }
    try {
      const rec = await this.#deps.manager.create(nome.value, avatarColor, undefined, this.#deps.dataKey());
      return { ok: true, ...recordWire(rec) };
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'E_INTERNAL';
      return { ok: false, code } as IdentityCreateResult;
    }
  }

  /** Lista das comunidades participadas para o backup de §5.5 — semente só de hospedeira. */
  exportCommunities(): ExportCommunity[] {
    const rows = this.#deps.manifest.listCommunities() as Array<{
      community_id: string;
      core_key: Uint8Array;
      blobs_key: Uint8Array;
      community_seed_enc?: Uint8Array | null;
      community_seed_nonce?: Uint8Array | null;
      is_host: number;
      left_at: number | null;
    }>;
    const saida: ExportCommunity[] = [];
    for (const r of rows) {
      if (r.left_at !== null) continue;
      saida.push({
        communityId: r.community_id,
        coreKey: Buffer.from(r.core_key),
        blobsKey: Buffer.from(r.blobs_key),
      });
    }
    return saida;
  }

  async export(passphrase: unknown): Promise<{ ok: true } | { ok: false; code: string; field?: string }> {
    if (typeof passphrase !== 'string' || passphrase.length === 0) {
      return { ok: false, code: 'E_VALIDATION', field: 'passphrase' };
    }
    const saveFile = this.#deps.saveFile;
    if (saveFile === undefined) return { ok: false, code: 'E_CANCELLED' };
    let bundle: Buffer;
    try {
      bundle = this.#deps.manager.exportBundle(passphrase, this.exportCommunities());
    } catch (err) {
      return { ok: false, code: (err as { code?: string }).code ?? 'E_NO_IDENTITY' };
    }
    const r = await saveFile({ suggestedName: 'identidade-comunidade.bak', data: bundle });
    if (!r.ok) return { ok: false, code: r.code };
    // §15.4 diz `{savedTo}`; §13.3 regra 5 proíbe caminho de usuário no IPC-R. Emenda
    // datada no normativo alinha a resposta em `{}` — o desfecho da chamada É a confirmação.
    return { ok: true };
  }

  /**
   * §5.5 — decifra, recria a identidade e devolve as comunidades do backup para quem
   * reabre os cores. Só em instalação sem identidade.
   */
  async import(passphrase: unknown): Promise<
    | { ok: true; publicKey: string; handle: string; communities: number; rows: ExportCommunityWire[] }
    | { ok: false; code: string; field?: string }
  > {
    if (typeof passphrase !== 'string' || passphrase.length === 0) {
      return { ok: false, code: 'E_VALIDATION', field: 'passphrase' };
    }
    const readFile = this.#deps.readFile;
    if (readFile === undefined) return { ok: false, code: 'E_CANCELLED' };
    let bundle: Buffer | null = null;
    try {
      bundle = await readFile();
    } catch {
      bundle = null;
    }
    if (bundle === null || bundle.length === 0) return { ok: false, code: 'E_CANCELLED' };
    try {
      const rec = await this.#deps.manager.importBundle(bundle, passphrase, this.#deps.dataKey());
      // As linhas do backup voltam para quem reabre os cores (§5.5 "reabre os cores");
      // a decifragem repete o Argon2id — MODERATE, uma vez por restauração.
      const rows = this.#deps.manager.parseExportedCommunities(bundle, passphrase).map((c) => ({
        communityId: c.communityId,
        coreKey: c.coreKey.toString('hex'),
        blobsKey: c.blobsKey.toString('hex'),
        ...(c.communitySeed !== undefined ? { communitySeed: c.communitySeed.toString('hex') } : {}),
      }));
      return { ok: true, ...recordWire(rec), communities: rows.length, rows };
    } catch (err) {
      return { ok: false, code: (err as { code?: string }).code ?? 'E_MALFORMED' };
    }
  }

  /** §6.1 — presença local; valida contra a tabela fechada. */
  setPresence(presence: unknown): { ok: true; presence: LocalPresence } | { ok: false; code: string } {
    if (typeof presence !== 'string' || !(PRESENCE_VALUES as readonly string[]).includes(presence)) {
      return { ok: false, code: 'E_VALIDATION' };
    }
    try {
      this.#deps.manager.setPresence(presence);
    } catch {
      return { ok: false, code: 'E_NO_IDENTITY' };
    }
    return { ok: true, presence: presence as LocalPresence };
  }
}
