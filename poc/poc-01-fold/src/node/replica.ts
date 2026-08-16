/**
 * Replica — um no que interpreta o log e materializa `view.db`.
 *
 * "Toda replica, ao interpretar: o mesmo `fold`, sobre o registro ja appendado.
 *  Autoridade NORMATIVA — e o que define o estado." (§8.7)
 *
 * A replica NAO tem caminho privilegiado: ela so le o core e roda o `fold`. E o oraculo
 * do gate — o hash de dump de duas replicas quaisquer precisa ser identico (§28.4).
 */
import Hypercore from 'hypercore';
import { emptyState, type DecisionState } from '../fold/state.ts';
import { Projector, type ProjectorOpts } from './projector.ts';
import { dumpHash, dumpText, openViewDb, wipeViewDb, type DB } from './viewdb.ts';
import { foldBuildId, loadSnapshot, saveSnapshot } from './snapshot.ts';

export type ReplicaOpts = ProjectorOpts & { root: string };

export class Replica {
  readonly name: string;
  readonly core: Hypercore;
  readonly db: DB;
  readonly communityId: string;
  readonly communityKey: Buffer;
  projector: Projector;
  ds: DecisionState;
  private opts: ReplicaOpts;

  constructor(name: string, core: Hypercore, dbPath: string, communityKey: Buffer, opts: ReplicaOpts) {
    this.name = name;
    this.core = core;
    this.communityKey = communityKey;
    this.communityId = communityKey.toString('hex');
    this.db = openViewDb(dbPath);
    this.opts = opts;
    this.ds = emptyState(communityKey, this.communityId);
    this.projector = new Projector(this.db, this.communityId, opts);
  }

  private read = async (seq: number): Promise<Uint8Array | null> => {
    const b = await this.core.get(seq, { wait: false });
    return b ?? null;
  };

  /** Interpreta ate a cabeca conhecida do core. */
  async catchUp(): Promise<void> {
    this.ds = await this.projector.run(this.ds, this.read, this.core.length);
  }

  /** §19.2 (boot): snapshot -> `fold` ate `core.length`. */
  async boot(): Promise<void> {
    const snap = loadSnapshot(this.db, this.communityId, foldBuildId(this.opts.root));
    if (snap !== null) this.ds = snap;
    await this.catchUp();
  }

  snapshot(at: number): void {
    saveSnapshot(this.db, this.communityId, this.ds, foldBuildId(this.opts.root), at);
  }

  /** §10.5 — reprojecao total: DROP de `view.db` e `fold` do `seq` 0. */
  async reproject(): Promise<void> {
    wipeViewDb(this.db);
    this.ds = emptyState(this.communityKey, this.communityId);
    this.projector = new Projector(this.db, this.communityId, this.opts);
    await this.catchUp();
  }

  hash(): string {
    return dumpHash(this.db, this.communityId).hash;
  }

  text(): string {
    return dumpText(this.db, this.communityId);
  }

  async close(): Promise<void> {
    this.db.close();
    await this.core.close();
  }
}
