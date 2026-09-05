// `succession` — a superfície de produto da sucessão de host (§18.8, §15.4, A23).
//
// Três operações, e nenhuma decisão de transporte ou de armazenamento aqui dentro:
//
//   1. `setSuccessors` — designa até `MAX_SUCCESSORS` sucessores (R-17: só o host) e
//      appenda **um `community.escrow` por sucessor**, com a semente selada para cada um
//      (§18.8). A semente nunca aparece em claro no log.
//   2. `assumeHost` — camada b de R-18 (sucessor autorizado, grace period, origem não
//      encerrada), abre o escrow endereçado a mim, deriva o par de escrita do core ANTIGO
//      pela regra de §5.3 e monta a continuação. O core novo é criado pela porta injetada;
//      **nada é appendado no core antigo** (dois escritores = fork).
//   3. Reentrada assistida (L-23, §18.8.1) — `pendingReentry` diz quem da origem ainda não
//      voltou, e `restoreRolesFor` devolve os cargos a quem voltou. O convite em si é o
//      `invite.create` que já existe: nenhuma superfície nova de convite nasce aqui.
//
// §4: `succession` depende de `corestore`, `identity`, `fold`, `opCodec`, `idgen` e
// `permissions`. Submissão de op e criação de convite chegam por **porta injetada** — o
// mesmo padrão de `relay` e da ponte de §30 —, não por importação lateral.

import sodium from 'sodium-native';

import { deriveCommunityKeyPairs } from '../../l0/corestore/index.ts';
import { HOST_INACTIVITY_MS, MAX_SUCCESSORS, type DecisionState } from '../../l1/fold/index.ts';
import { openSealedSeed, sealSeedFor } from './escrow.ts';
import { planContinuation, type ContinuationPlan } from './continuation.ts';
import { evaluateLayerB, type LayerBRefusal } from './follow.ts';

/** Resultado uniforme das operações que submetem op — a fronteira traduz `code` (§20.2). */
export type SuccessionResult<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly code: string };

/** Caminho ⏱ de §11.1, injetado: sela e submete ao host, devolvendo `{seq}` ou `{code}`. */
export type SubmitSyncPort = (
  communityId: string,
  input: { readonly kindName: string; readonly payload: Readonly<Record<string, unknown>> },
) => Promise<{ readonly ok: true; readonly seq: number } | { readonly ok: false; readonly code: string }>;

/**
 * Cria o core da continuação, appenda o lote inteiro numa chamada (§10.7.1) e **ativa** a
 * comunidade nova: linha em `manifest.communities` com a semente cifrada (§5.3 item 2,
 * antes de criar core), contador de `authorSeq` fixado depois da gênese (§7.5) e abertura
 * no runtime (§19.1 passo 6). Sem a ativação o sucessor gravava blocos num diretório que
 * nem o próprio processo reabria: a continuação nascia órfã e inalcançável na DHT.
 */
export type CreateContinuationCorePort = (args: {
  readonly keyPair: { readonly publicKey: Buffer; readonly secretKey: Buffer };
  readonly records: readonly Buffer[];
  /** Semente de §5.3 da comunidade nova — é dela que o boot rederiva o par de escrita. */
  readonly communitySeed: Buffer;
  /** `ns/blobs/1` da mesma semente; é o que a gênese publicou em `community.create`. */
  readonly blobsKey: Buffer;
  /** Comunidade de origem, para o ponteiro de continuação da linha do manifest. */
  readonly originCommunityId: string;
}) => Promise<void>;

export interface SuccessionDeps {
  /** `DecisionState` da comunidade aberta aqui; `null` quando ela não está aberta. */
  stateFor(communityId: string): DecisionState | null;
  /** Identidade local (§5.5) — `null` sem identidade carregada. */
  identity(): { readonly publicKey: Buffer; readonly secretKey: Buffer } | null;
  /** `communitySeed` do `manifest` (§5.3); `null` quando esta instalação não hospeda. */
  communitySeed(communityId: string): Buffer | null;
  /**
   * `wrappedSeed` do `community.escrow` endereçado à identidade local. O `fold` não guarda
   * escrow no `DS` (§8.1) — quem precisa dele lê o próprio log, e é isso que esta porta faz.
   */
  sealedSeedFor(communityId: string): Promise<Buffer | null>;
  submitSync: SubmitSyncPort;
  createContinuationCore: CreateContinuationCorePort;
  /**
   * §13.1 — core de blobs local do sucessor na comunidade de `communityIdHex`, derivado da
   * identidade. Injetado: a derivação mora em `blobs`, que §4 não lista entre as
   * dependências de `succession`.
   */
  memberBlobsCoreKeyFor(communityIdHex: string): Buffer;
  now(): number;
  /** Grace period de §18.8; default `HOST_INACTIVITY_MS`. */
  inactivityMs?: number;
  /** Semente do core novo — fixa em teste; default aleatória (§18.8 passo 2). */
  newCoreSeed?(): Buffer;
}

/** Camada b recusada → sempre `E_SUCCESSION_DENIED` na fronteira (§15.4). */
const NEGADO: Record<LayerBRefusal, string> = {
  'scope-mismatch': 'E_SUCCESSION_DENIED',
  'not-successor': 'E_SUCCESSION_DENIED',
  'grace-period': 'E_SUCCESSION_DENIED',
  'origin-ended': 'E_SUCCESSION_DENIED',
};

export class SuccessionService {
  readonly #deps: SuccessionDeps;

  constructor(deps: SuccessionDeps) {
    this.#deps = deps;
  }

  /**
   * §15.4 `community.setSuccessors` ⏱ — `{seq}` da op de designação. Os escrows vão em
   * seguida, um por sucessor: sem eles a lista existe e ninguém consegue assumir.
   */
  async setSuccessors(args: {
    readonly communityId: string;
    readonly successorKeys: readonly Buffer[];
  }): Promise<SuccessionResult<{ seq: number; escrowSeqs: readonly number[] }>> {
    const { communityId, successorKeys } = args;
    const state = this.#deps.stateFor(communityId);
    if (state === null) return { ok: false, code: 'E_NOT_FOUND' };
    const me = this.#deps.identity();
    if (me === null) return { ok: false, code: 'E_NO_IDENTITY' };
    // R-17 — só o `hostKey` corrente designa sucessores. A recusa vinculante é do `fold`;
    // esta é a mesma da coluna de erros de §15.4, síncrona e sem gastar `authorSeq`.
    if (!state.community.hostKey.equals(me.publicKey)) return { ok: false, code: 'E_NOT_HOST' };
    if (state.community.endedAt !== undefined) return { ok: false, code: 'E_COMMUNITY_ENDED' };
    if (successorKeys.length > MAX_SUCCESSORS) return { ok: false, code: 'E_VALIDATION' };
    const meHex = me.publicKey.toString('hex');
    const vistos = new Set<string>();
    for (const k of successorKeys) {
      if (k.length !== 32) return { ok: false, code: 'E_VALIDATION' };
      const hex = k.toString('hex');
      // Sucessor de si mesmo não é sucessão, e repetido desperdiça prioridade.
      if (hex === meHex || vistos.has(hex)) return { ok: false, code: 'E_VALIDATION' };
      vistos.add(hex);
    }
    const seed = this.#deps.communitySeed(communityId);
    if (seed === null) return { ok: false, code: 'E_NOT_HOST' };

    const designacao = await this.#deps.submitSync(communityId, {
      kindName: 'community.setSuccessors',
      payload: { successorKeys: successorKeys.map((k) => Buffer.from(k)) },
    });
    if (!designacao.ok) return { ok: false, code: designacao.code };

    const escrowSeqs: number[] = [];
    for (const targetKey of successorKeys) {
      const enviado = await this.#deps.submitSync(communityId, {
        kindName: 'community.escrow',
        payload: { targetKey: Buffer.from(targetKey), wrappedSeed: sealSeedFor(targetKey, seed) },
      });
      // Um escrow que não entra deixa aquele sucessor sem poder assumir; a lista já está no
      // log, então o desfecho é parcial e nomeado, não silencioso.
      if (!enviado.ok) return { ok: false, code: enviado.code };
      escrowSeqs.push(enviado.seq);
    }
    return { ok: true, seq: designacao.seq, escrowSeqs };
  }

  /**
   * §15.4 `community.assumeHost` ⏱ (main-confirmed) — cria a continuação e devolve o id
   * novo. O `seq` é o do `community.assumeHost` dentro do core novo: 6, logo após a gênese
   * de R-27.
   */
  async assumeHost(args: {
    readonly communityId: string;
  }): Promise<SuccessionResult<{ newCommunityId: string; seq: number; plan: ContinuationPlan }>> {
    const origin = this.#deps.stateFor(args.communityId);
    if (origin === null) return { ok: false, code: 'E_NOT_FOUND' };
    const me = this.#deps.identity();
    if (me === null) return { ok: false, code: 'E_NO_IDENTITY' };
    if (!origin.community.exists) return { ok: false, code: 'E_NOT_FOUND' };

    const newCoreSeed = this.#deps.newCoreSeed?.() ?? randomSeed();
    // §5.3 item 3 — o par do log da comunidade nova sai da semente pelo namespace
    // `ns/log/1`, como o de qualquer comunidade criada aqui.
    const novoPar = deriveCommunityKeyPairs(newCoreSeed).log;
    const camadaB = evaluateLayerB({
      claim: {
        communityIdHex: novoPar.publicKey.toString('hex'),
        originCommunityIdHex: origin.communityId,
        originFinalSeq: Math.max(origin.interpretedSeq, 0),
        assumedByHex: me.publicKey.toString('hex'),
      },
      origin: {
        communityIdHex: origin.communityId,
        successorKeysHex: origin.community.successorKeys.map((k) => k.toString('hex')),
        lastHostTs: origin.lastHostTs,
        ...(origin.community.endedAt !== undefined ? { endedAt: origin.community.endedAt } : {}),
      },
      ttlMs: this.#deps.inactivityMs ?? HOST_INACTIVITY_MS,
      now: this.#deps.now(),
    });
    if (!camadaB.ok) return { ok: false, code: NEGADO[camadaB.reason] };

    const wrapped = await this.#deps.sealedSeedFor(args.communityId);
    if (wrapped === null) return { ok: false, code: 'E_SUCCESSION_DENIED' };
    const communitySeed = openSealedSeed(wrapped, me.publicKey, me.secretKey);
    if (communitySeed === null) return { ok: false, code: 'E_SUCCESSION_DENIED' };
    // §5.3: o par de escrita do core antigo sai da semente. É a posse dessa chave que a
    // prova de R-18(a) demonstra — sem escrever uma linha no log antigo.
    const antigo = deriveCommunityKeyPairs(communitySeed).log;
    if (!antigo.publicKey.equals(Buffer.from(origin.communityId, 'hex'))) {
      return { ok: false, code: 'E_SUCCESSION_DENIED' };
    }

    const plan = planContinuation({
      originState: origin,
      originCoreSecretKey: antigo.secretKey,
      successorIdentity: me,
      newCoreSeed,
      successorBlobsCoreKey: this.#deps.memberBlobsCoreKeyFor(novoPar.publicKey.toString('hex')),
      hostTs: this.#deps.now(),
    });
    await this.#deps.createContinuationCore({
      keyPair: plan.newCoreKeyPair,
      records: plan.records,
      communitySeed: newCoreSeed,
      blobsKey: plan.newBlobsKey,
      originCommunityId: origin.communityId,
    });
    return {
      ok: true,
      newCommunityId: plan.newCoreKeyPair.publicKey.toString('hex'),
      seq: GENESIS_LENGTH,
      plan,
    };
  }

  /**
   * §22.2 `succession.check` — o grace period de §18.8 foi atingido para MIM nesta
   * comunidade? Avaliação PURA da camada b de R-18 (sucessor designado, origem viva,
   * `lastHostTs + ttl ≤ agora`), sem efeito colateral nenhum: a OFERTA de assumir é
   * superfície de UI (U-18) e chega com o shell — até lá o resultado só é observável por
   * quem chama este método (o job da raiz, os testes). `null` = pergunta não se aplica
   * (comunidade ausente, sou eu o host).
   */
  checkEligibility(communityId: string): boolean | null {
    const origin = this.#deps.stateFor(communityId);
    if (origin === null || !origin.community.exists) return null;
    const me = this.#deps.identity();
    if (me === null) return null;
    const meHex = me.publicKey.toString('hex');
    if (origin.community.hostKey.toString('hex') === meHex) return null;
    if (!origin.community.successorKeys.some((k) => k.toString('hex') === meHex)) return false;
    if (origin.community.endedAt !== undefined) return false;
    const ttl = this.#deps.inactivityMs ?? HOST_INACTIVITY_MS;
    return origin.lastHostTs + ttl <= this.#deps.now();
  }

  /**
   * L-23 — quem estava **ativo** na origem e ainda não voltou à continuação. Não vira op
   * nenhuma: é o conjunto pendente da tela de sucessão (U-18c) e a lista de quem tem cargo
   * a recuperar. O sucessor nunca está nela — ele é o fundador da continuação.
   */
  pendingReentry(continuationId: string): readonly Buffer[] {
    const continuacao = this.#deps.stateFor(continuationId);
    const originId = continuacao?.community.originCommunityId;
    if (continuacao === null || originId === undefined) return [];
    const origem = this.#deps.stateFor(originId);
    if (origem === null) return [];
    const pendentes: Buffer[] = [];
    for (const [hex, membro] of origem.members) {
      if (membro.state !== 'active') continue;
      if (continuacao.members.get(hex)?.state === 'active') continue;
      pendentes.push(Buffer.from(hex, 'hex'));
    }
    return pendentes;
  }

  /**
   * L-23 — devolve a quem reentrou os cargos que tinha na origem. Chamado pela composição
   * quando um `member.join` da continuação é interpretado; idempotente por construção, já
   * que reaplicar o mesmo conjunto não muda o estado.
   *
   * O casamento origem→continuação é **por nome**, não por id: os ids de entidade são
   * determinísticos por `(kind, coreKey, autor, authorSeq)` (§7.3) e portanto mudam com o
   * core novo. É a mesma correspondência que o lote estendido já usa para categorias e
   * canais duplicados.
   */
  async restoreRolesFor(args: {
    readonly continuationId: string;
    readonly memberKeyHex: string;
  }): Promise<SuccessionResult<{ seq: number; roleIds: readonly string[] } | { skipped: true }>> {
    const continuacao = this.#deps.stateFor(args.continuationId);
    if (continuacao === null) return { ok: false, code: 'E_NOT_FOUND' };
    const originId = continuacao.community.originCommunityId;
    if (originId === undefined) return { ok: false, code: 'E_NOT_FOUND' };
    const origem = this.#deps.stateFor(originId);
    if (origem === null) return { ok: false, code: 'E_NOT_FOUND' };
    if (continuacao.members.get(args.memberKeyHex)?.state !== 'active') {
      return { ok: false, code: 'E_NOT_MEMBER' };
    }
    const naOrigem = origem.members.get(args.memberKeyHex);
    if (naOrigem === undefined || naOrigem.state !== 'active') return { ok: true, skipped: true };

    const porNome = mapRolesByName(origem, continuacao);
    const baseId = baseRoleOf(continuacao);
    const roleIds: string[] = [];
    let alemDoBase = false;
    for (const oldId of naOrigem.roleIds) {
      const novo = porNome.get(oldId);
      if (novo === undefined || roleIds.includes(novo)) continue;
      roleIds.push(novo);
      if (novo !== baseId) alemDoBase = true;
    }
    // Nada além do cargo base: R-3 já o deu no `member.join`, e uma op que só reafirma o
    // base gastaria `authorSeq` e uma entrada de auditoria sem mudar estado nenhum.
    if (!alemDoBase) return { ok: true, skipped: true };
    // R-3 — o conjunto submetido precisa conter o base, mesmo quando a origem não o listava.
    if (baseId !== undefined && !roleIds.includes(baseId)) roleIds.push(baseId);

    const r = await this.#deps.submitSync(args.continuationId, {
      kindName: 'member.setRoles',
      payload: { targetKey: Buffer.from(args.memberKeyHex, 'hex'), roleIds },
    });
    if (!r.ok) return { ok: false, code: r.code };
    return { ok: true, seq: r.seq, roleIds };
  }
}

/** Gênese de R-27 (6 ops) + `community.assumeHost` → o `assumeHost` é o `seq` 6. */
const GENESIS_LENGTH = 6;

function randomSeed(): Buffer {
  const s = Buffer.alloc(sodium.crypto_sign_SEEDBYTES);
  sodium.randombytes_buf(s);
  return s;
}

/**
 * Cargo vivo da origem → cargo vivo da continuação, casado por nome. O cargo base casa pela
 * marca `isDefault`, que a gênese de R-27 garante existir dos dois lados; nome repetido na
 * origem casa com o primeiro equivalente, a mesma regra do lote estendido.
 *
 * O **Fundador não é restaurado**, deliberadamente: na continuação o fundador é o sucessor
 * (R-27), e devolver as 17 permissões e o `RANK_TOP` a quem tinha o cargo na origem — o host
 * antigo, tipicamente — entregaria a comunidade de volta a quem sumiu por `HOST_INACTIVITY_MS`.
 * Quem quiser esse poder de volta recebe por `member.setRoles` explícito do host novo.
 */
function baseRoleOf(state: DecisionState): string | undefined {
  for (const [id, role] of state.roles) {
    if (role.deletedAt === undefined && role.isDefault) return id;
  }
  return undefined;
}

function mapRolesByName(
  origem: DecisionState,
  continuacao: DecisionState,
): ReadonlyMap<string, string> {
  const porNome = new Map<string, string>();
  let base: string | undefined;
  for (const [id, role] of continuacao.roles) {
    if (role.deletedAt !== undefined) continue;
    if (role.isFounder) continue;
    if (role.isDefault) base = id;
    if (!porNome.has(role.name)) porNome.set(role.name, id);
  }
  const mapa = new Map<string, string>();
  for (const [oldId, role] of origem.roles) {
    if (role.deletedAt !== undefined) continue;
    if (role.isFounder) continue; // ver o comentário acima: o Fundador não migra por aqui
    if (role.isDefault) {
      if (base !== undefined) mapa.set(oldId, base);
      continue;
    }
    const novo = porNome.get(role.name);
    if (novo !== undefined) mapa.set(oldId, novo);
  }
  return mapa;
}
