// A máquina de estados retomável do `identity.wipe` (§18.6) — raiz de composição: quem
// tem as mãos em TODOS os recursos que a máquina toca (swarm, runtime, view, manifest,
// identidade e lock) é esta raiz; nenhum módulo de camada poderia fechá-la sozinho.
//
//   none → requested → swarm-down → cores-closed → view-deleted → manifest-deleted
//        → key-wiped → done → none
//
// O estado vive em `manifest.meta.wipe_state`, gravado com FULL **antes** de cada etapa.
// `manifest-deleted` grava o sentinela `<dataDir>/WIPE` antes de remover o banco — a partir
// daí não há mais onde gravar. No boot, estado ≠ none ou sentinela presente retoma de onde
// parou ANTES de qualquer outra coisa (§3.3). O LOCK é o último recurso liberado, e só
// depois de `key-wiped`.

import fs from 'node:fs';
import path from 'node:path';

import type { Swarm } from '../l0/swarm/index.ts';
import type { ViewDb } from '../l0/view/index.ts';
import type { ManifestDb } from '../l0/manifest/index.ts';
import { WIPE_STAGES, type WipeStage } from '../l3/ipcMain/index.ts';

export const WIPE_SENTINEL = 'WIPE';

/** As etapas que a máquina executa, na ordem — sem o `none` inicial nem o `done` final. */
const STAGES = WIPE_STAGES.filter((s) => s !== 'none') as readonly WipeStage[];

export type WipeResourceDeps = {
  readonly dataDir: string;
  readonly swarm: Pick<Swarm, 'listTopics' | 'leave' | 'flush'>;
  /** Fecha cores, jobs, loops e blobs — a etapa `cores-closed`. */
  closeRuntime(): Promise<void>;
  readonly view: ViewDb;
  readonly manifest: ManifestDb;
  wipeIdentity(): void;
  /** §10.8 — o LOCK é o último recurso liberado, só depois de `key-wiped`. */
  releaseLock?(): void;
};

export type WipeOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'E_WIPE_INCOMPLETE'; readonly stage: WipeStage };

function apagarBanco(caminho: string): void {
  for (const sufixo of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${caminho}${sufixo}`, { force: true });
    } catch {}
  }
}

/** Executa UMA etapa do switch — o mesmo corpo para executar e para retomar. */
async function executarEtapa(etapa: WipeStage, deps: WipeResourceDeps): Promise<void> {
  switch (etapa) {
    case 'requested':
      break;
    case 'swarm-down':
      for (const topico of deps.swarm.listTopics()) deps.swarm.leave(topico.topicHex);
      await deps.swarm.flush().catch(() => {});
      break;
    case 'cores-closed':
      await deps.closeRuntime();
      // Fechado, o armazenamento dos cores sai do disco: uma limpeza que deixa o log de
      // toda comunidade legível em `<dataDir>/cores` contradiria §18.4 (réplica removida
      // sai inteira) e o propósito da máquina. É a etapa que nomeia os cores.
      try {
        await fs.promises.rm(path.join(deps.dataDir, 'cores'), { recursive: true, force: true });
      } catch {}
      break;
    case 'view-deleted':
      deps.view.close();
      apagarBanco(path.join(deps.dataDir, 'view.db'));
      break;
    case 'manifest-deleted':
      // Sentinela ANTES de remover o único lugar onde o estado vivia.
      fs.writeFileSync(path.join(deps.dataDir, WIPE_SENTINEL), 'manifest-deleted', 'utf8');
      apagarBanco(deps.manifest.path);
      break;
    case 'key-wiped':
      deps.wipeIdentity();
      break;
    case 'done':
      try {
        fs.rmSync(path.join(deps.dataDir, WIPE_SENTINEL), { force: true });
      } catch {}
      deps.releaseLock?.();
      break;
    default:
      break;
  }
}

/**
 * Executa (ou retoma) a máquina inteira sobre recursos vivos. Cada etapa grava o próprio
 * nome ANTES de agir: um crash em qualquer ponto deixa o próximo boot exatamente um passo
 * atrás. Falha nomeada carrega a etapa (`E_WIPE_INCOMPLETE{stage}`).
 */
export async function executeWipe(deps: WipeResourceDeps): Promise<WipeOutcome> {
  try {
    const corrente = deps.manifest.getWipeState() as WipeStage;
    const inicio = corrente === 'none' ? 0 : Math.max(0, STAGES.indexOf(corrente));
    for (let i = inicio; i < STAGES.length; i++) {
      const etapa = STAGES[i] as WipeStage;
      // FULL antes da etapa — exceto quando já não há mais banco onde gravar.
      if (etapa !== 'manifest-deleted' && etapa !== 'key-wiped' && etapa !== 'done') {
        deps.manifest.setWipeState(etapa);
      }
      await executarEtapa(etapa, deps);
    }
    return { ok: true };
  } catch {
    return { ok: false, code: 'E_WIPE_INCOMPLETE', stage: (deps.manifest.getWipeState() as WipeStage) || 'requested' };
  }
}

/**
 * §3.3/§18.6 — chamado PELO SHELL no boot, antes de abrir qualquer banco: se a limpeza
 * ficou pela metade, termina aqui. Depois de `manifest-deleted` o estado mora no sentinela
 * e os bancos nem reabrem; antes disso, retoma pelo banco ainda abrível. Devolve `true`
 * quando havia limpeza pendente (o boot segue com instalação zerada).
 */
export async function resumePendingWipe(
  deps: {
    readonly dataDir: string;
    readonly swarm: Pick<Swarm, 'listTopics' | 'leave' | 'flush'>;
    /** Abre o manifest.db existente, se houver e for abrível. */
    openManifest(): ManifestDb | null;
    /** Abre a view.db existente, se houver e for abrível. */
    openView(): ViewDb | null;
    wipeIdentity(): void;
    releaseLock?(): void;
  },
): Promise<boolean> {
  const sentinela = path.join(deps.dataDir, WIPE_SENTINEL);
  let temSentinela = false;
  try {
    temSentinela = fs.existsSync(sentinela);
  } catch {}

  const manifest = temSentinela ? null : deps.openManifest();
  const estado = manifest?.getWipeState() ?? 'none';
  if (!temSentinela && estado === 'none') return false;

  // Sentinela presente: chegamos ao menos ao `manifest-deleted`. Bancos vão embora (se
  // sobreviveram a um crash entre sentinela e rm) e a máquina termina sem eles.
  if (temSentinela) {
    apagarBanco(path.join(deps.dataDir, 'view.db'));
    apagarBanco(path.join(deps.dataDir, 'manifest.db'));
    try {
      await fs.promises.rm(path.join(deps.dataDir, 'cores'), { recursive: true, force: true });
    } catch {}
    deps.wipeIdentity();
    try {
      fs.rmSync(sentinela, { force: true });
    } catch {}
    deps.releaseLock?.();
    return true;
  }

  // Antes do `manifest-deleted`: retoma com os bancos ainda abríveis. Runtime não existe
  // neste ponto do boot — fechar de novo é no-op por construção. A view só reabre quando
  // ainda há etapa que a toque; depois de `view-deleted`, no-op.
  const PRECISA_VIEW: readonly string[] = ['requested', 'swarm-down', 'cores-closed', 'view-deleted'];
  const view = PRECISA_VIEW.includes(estado) ? deps.openView() : null;
  await executeWipe({
    dataDir: deps.dataDir,
    swarm: deps.swarm,
    closeRuntime: async () => {},
    view: (view ?? { close() {} }) as ViewDb,
    manifest: manifest as ManifestDb,
    wipeIdentity: deps.wipeIdentity,
    ...(deps.releaseLock !== undefined ? { releaseLock: deps.releaseLock } : {}),
  });
  return true;
}
