// As consultas de leitura de §15.6 sobre a `view.db` — estrutura, mensagens e derivados.
//
// Raiz de composição (§4): nenhuma regra de domínio nasce aqui. O que estas funções fazem é
// **recortar** o que o `projector` já materializou (§8.4) e juntar três fontes que moram em
// lugares diferentes por desenho:
//
//   - `view.db`   — conteúdo (mensagens, canais, anexos, reações, links, threads);
//   - `DS`        — identidade e cargos de quem aparece (`UserRef`, `readOnly` por cargo);
//   - `manifest`  — o que é **local e não replica**: leitura, mudo, categoria recolhida,
//                   e o estado do cache de blobs (§10.1/§10.2).
//
// Ordenação e paginação seguem §23.2/§23.3 — as duas tabelas são fechadas, e o cursor é
// `base64url({seq,id})`, opaco: forma inválida ou de outro escopo é `E_BAD_CURSOR`, nunca
// resultado errado em silêncio (§15.6.1).

import type { ManifestDb } from '../l0/manifest/index.ts';
import type { ViewDb } from '../l0/view/index.ts';
import type { DecisionState } from '../l1/fold/index.ts';
import type { BlobManager } from '../l2/blobs/index.ts';
import { queryUserRef, type QueryUserRef } from './ports.ts';

// ─── Tetos e recortes de §23.3 (paginação) ──────────────────────────────────────────────

const LIMITE_MENSAGENS = 50;
const LIMITE_LISTAS = 25;
const LIMITE_REATORES = 24;
/** Trecho da citação de `replyTo` — o suficiente para reconhecer, nunca a mensagem inteira. */
const EXCERPT_MAX = 140;

/** §15.6.1 — `MessageDto`, com os campos que têm fonte na `view.db`. */
export interface QueryMessageDto {
  readonly id: string;
  readonly seq: number;
  readonly channelId: string;
  readonly author: QueryUserRef;
  readonly content: string | null;
  readonly authorTs: number;
  readonly hostTs: number;
  readonly clockSkewed: boolean;
  readonly editedAt?: number;
  readonly pinned: boolean;
  /**
   * §15.6.1 — a citação sobrevive à remoção do alvo (`excerpt: null`, `deleted: true`).
   * `author` fica **ausente** no único caso em que não há autor a nomear: a mensagem citada
   * não está projetada aqui (réplica que ainda não a viu, ou `view.db` reprojetando).
   */
  readonly replyTo?: { readonly messageId: string; readonly author?: QueryUserRef; readonly excerpt: string | null; readonly deleted: boolean };
  readonly threadId?: string;
  readonly threadReplyCount?: number;
  readonly mentions: { readonly identityKeys: readonly string[]; readonly roleIds: readonly string[]; readonly everyone: boolean };
  readonly mentionsMe: boolean;
  readonly hasAttachment: boolean;
  readonly deleted: boolean;
  readonly hiddenByBan: boolean;
}

export interface QueryReactionDto {
  readonly emoji: string;
  readonly count: number;
  readonly mine: boolean;
}

export interface QueryAttachmentDto {
  readonly blobsCoreKey: string;
  readonly blobId: { readonly byteOffset: number; readonly blockOffset: number; readonly blockLength: number; readonly byteLength: number };
  readonly name: string;
  readonly sizeBytes: number;
  readonly kind: number;
  readonly hash: string;
  readonly state: string;
  readonly progress: number;
  readonly availablePeers: number;
  readonly hostAvailable: boolean;
  readonly localPath?: string;
}

export type QueryReadDeps = {
  readonly view: ViewDb;
  readonly manifest: ManifestDb;
  stateFor(communityId: string): DecisionState | null;
  selfKeyHex(): string | null;
  replicationOf(communityId: string): { readonly state: string; readonly lag: number };
  /** Estado do cache local de cada anexo (§10.1). Ausente = `AttachmentDto` sem estado vivo. */
  readonly blobs?: BlobManager;
};

type Linha = Record<string, unknown>;

function recusar(code: string): never {
  throw Object.assign(new Error(code), { code });
}

// ─── Cursor de §15.6.1 — `base64url({seq,id})`, opaco ───────────────────────────────────

export function encodeCursor(c: { readonly seq: number; readonly id: string }): string {
  return Buffer.from(JSON.stringify({ seq: c.seq, id: c.id }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { readonly seq: number; readonly id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { seq?: unknown; id?: unknown };
    if (typeof parsed.seq !== 'number' || !Number.isInteger(parsed.seq) || typeof parsed.id !== 'string' || parsed.id.length === 0) {
      recusar('E_BAD_CURSOR');
    }
    return { seq: parsed.seq, id: parsed.id };
  } catch (e) {
    if ((e as { code?: string }).code === 'E_BAD_CURSOR') throw e;
    return recusar('E_BAD_CURSOR');
  }
}

function limite(pedido: unknown, padrao: number): number {
  if (pedido === undefined) return padrao;
  if (typeof pedido !== 'number' || !Number.isInteger(pedido) || pedido < 1) recusar('E_VALIDATION');
  return Math.min(pedido, padrao);
}

// ─── Fábrica ────────────────────────────────────────────────────────────────────────────

export function queryReadPorts(deps: QueryReadDeps) {
  const { view, manifest } = deps;

  function ds(communityId: string): DecisionState {
    const estado = deps.stateFor(communityId);
    if (estado === null || !estado.community.exists) recusar('E_NOT_FOUND');
    return estado;
  }

  function ref(estado: DecisionState, keyHex: string): QueryUserRef {
    const m = estado.members.get(keyHex);
    const base = queryUserRef(keyHex, m);
    return m?.nickname === undefined ? base : { ...base, nickname: m.nickname };
  }

  /** Cargos ativos de quem pergunta — decide `readOnly` do canal e `mentionsMe` por cargo. */
  function meusCargos(estado: DecisionState): ReadonlySet<string> {
    const eu = deps.selfKeyHex();
    const m = eu === null ? undefined : estado.members.get(eu);
    return m === undefined ? new Set<string>() : new Set(m.roleIds);
  }

  function parseMentions(raw: unknown): { identityKeys: string[]; roleIds: string[]; everyone: boolean } {
    const out = { identityKeys: [] as string[], roleIds: [] as string[], everyone: false };
    if (typeof raw !== 'string') return out;
    let lista: unknown;
    try {
      lista = JSON.parse(raw);
    } catch {
      return out;
    }
    if (!Array.isArray(lista)) return out;
    for (const item of lista) {
      if (typeof item !== 'string') continue;
      // A forma decide o destino: `everyone` é o sentinela de R-13; chave é hex de 32 B; o
      // resto é id de cargo (§7.3). Quem valida o alvo é o `fold`, não a leitura.
      if (item === 'everyone') out.everyone = true;
      else if (/^[0-9a-f]{64}$/i.test(item)) out.identityKeys.push(item.toLowerCase());
      else out.roleIds.push(item);
    }
    return out;
  }

  function excerto(content: string | null): string | null {
    if (content === null) return null;
    return content.length <= EXCERPT_MAX ? content : `${content.slice(0, EXCERPT_MAX)}…`;
  }

  function threadReplyCount(communityId: string, threadId: string): number | undefined {
    const row = view.prepare('SELECT reply_count AS replyCount FROM threads WHERE community_id = ? AND id = ?').get(communityId, threadId) as
      | { replyCount: number }
      | undefined;
    return row?.replyCount;
  }

  function temAnexo(communityId: string, messageId: string): boolean {
    return view.prepare('SELECT 1 FROM attachments WHERE community_id = ? AND message_id = ?').get(communityId, messageId) !== undefined;
  }

  function dto(communityId: string, estado: DecisionState, row: Linha, cargos: ReadonlySet<string>): QueryMessageDto {
    const eu = deps.selfKeyHex();
    const mentions = parseMentions(row['mentions']);
    const everyoneEfetivo = Number(row['mentionEveryoneEffective'] ?? 0) === 1;
    const id = String(row['id']);
    const threadId = row['threadId'] === null || row['threadId'] === undefined ? undefined : String(row['threadId']);
    const replyToId = row['replyToId'] === null || row['replyToId'] === undefined ? undefined : String(row['replyToId']);

    let replyTo: QueryMessageDto['replyTo'];
    if (replyToId !== undefined) {
      const alvo = view
        .prepare('SELECT id, author_key AS authorKey, content, deleted_at AS deletedAt FROM messages WHERE community_id = ? AND id = ?')
        .get(communityId, replyToId) as { id: string; authorKey: Uint8Array; content: string | null; deletedAt: number | null } | undefined;
      // F-47/M-7 — a citação de mensagem removida continua existindo, com `excerpt: null`.
      replyTo =
        alvo === undefined
          ? { messageId: replyToId, excerpt: null, deleted: false }
          : {
              messageId: alvo.id,
              author: ref(estado, Buffer.from(alvo.authorKey).toString('hex')),
              excerpt: alvo.deletedAt === null ? excerto(alvo.content) : null,
              deleted: alvo.deletedAt !== null,
            };
    }

    const contagem = threadId === undefined ? undefined : threadReplyCount(communityId, threadId);
    return {
      id,
      seq: Number(row['seq']),
      channelId: String(row['channelId']),
      author: ref(estado, Buffer.from(row['authorKey'] as Uint8Array).toString('hex')),
      content: (row['content'] as string | null) ?? null,
      authorTs: Number(row['authorTs']),
      hostTs: Number(row['hostTs']),
      clockSkewed: Number(row['clockSkewed'] ?? 0) === 1,
      ...(row['editedAt'] === null || row['editedAt'] === undefined ? {} : { editedAt: Number(row['editedAt']) }),
      pinned: Number(row['pinned'] ?? 0) === 1,
      ...(replyTo !== undefined ? { replyTo } : {}),
      ...(threadId !== undefined ? { threadId } : {}),
      ...(contagem !== undefined ? { threadReplyCount: contagem } : {}),
      mentions: { identityKeys: mentions.identityKeys, roleIds: mentions.roleIds, everyone: mentions.everyone },
      // R-13: `everyone` só me menciona quando foi **efetivo** no registro. Cargo mencionado
      // conta pelos cargos que tenho AGORA — o DS é a fonte, como em toda permissão.
      mentionsMe:
        (eu !== null && mentions.identityKeys.includes(eu)) ||
        (mentions.everyone && everyoneEfetivo) ||
        mentions.roleIds.some((r) => cargos.has(r)),
      hasAttachment: temAnexo(communityId, id),
      deleted: row['deletedAt'] !== null && row['deletedAt'] !== undefined,
      hiddenByBan: Number(row['hiddenByBan'] ?? 0) === 1,
    };
  }

  const COLUNAS =
    'id, seq, channel_id AS channelId, author_key AS authorKey, content, author_ts AS authorTs, host_ts AS hostTs, ' +
    'clock_skewed AS clockSkewed, edited_at AS editedAt, pinned, reply_to_id AS replyToId, thread_id AS threadId, ' +
    'mentions, mention_everyone_effective AS mentionEveryoneEffective, deleted_at AS deletedAt, hidden_by_ban AS hiddenByBan';

  function anexoDe(communityId: string, messageId: string): QueryAttachmentDto | null {
    const row = view
      .prepare(
        'SELECT blobs_core_key AS blobsCoreKey, blob_id AS blobIdJson, name, size_bytes AS sizeBytes, kind, hash ' +
          'FROM attachments WHERE community_id = ? AND message_id = ?',
      )
      .get(communityId, messageId) as
      | { blobsCoreKey: Uint8Array; blobIdJson: string; name: string; sizeBytes: number; kind: number; hash: Uint8Array }
      | undefined;
    if (row === undefined) return null;
    const chaveHex = Buffer.from(row.blobsCoreKey).toString('hex');
    const hashHex = Buffer.from(row.hash).toString('hex');
    const cache = deps.blobs?.cache.get(Buffer.from(row.blobsCoreKey), hashHex.slice(0, 32)) ?? null;
    const baixados = cache?.bytesDownloaded ?? 0;
    return {
      blobsCoreKey: chaveHex,
      blobId: JSON.parse(row.blobIdJson) as QueryAttachmentDto['blobId'],
      name: row.name,
      sizeBytes: row.sizeBytes,
      kind: row.kind,
      hash: hashHex,
      state: cache?.state ?? 'not-downloaded',
      progress: row.sizeBytes > 0 ? Math.min(1, baixados / row.sizeBytes) : 0,
      // §13.4 passo 4 — pares e `hostAvailable` são leitura do bitfield **vivo**: fora de um
      // download em curso não há par conectado a este core, e é isso que 0/false dizem.
      availablePeers: 0,
      hostAvailable: false,
      ...(cache?.path != null ? { localPath: cache.path } : {}),
    };
  }

  return {
    /**
     * `query.structure` (§15.6): categorias e canais na ordem de §23.2 (`rank` crescente nos
     * dois níveis), com o que é local por cima — mudo, recolhida e não lidas.
     *
     * `readOnly` é **para quem pergunta**: o canal é somente-leitura quando algum cargo meu
     * está em `read_only_role_ids` (§6.7). `voice` fica ausente enquanto a ocupação não tiver
     * produtor nesta instalação (§15.6 `RT-05`).
     */
    structure(communityId: string) {
      const estado = ds(communityId);
      const cargos = meusCargos(estado);
      const recolhidas = manifest.collapsedCategories(communityId);
      const categorias = view
        .prepare('SELECT id, name, rank FROM categories WHERE community_id = ? AND deleted_at IS NULL ORDER BY rank ASC')
        .all(communityId) as Array<{ id: string; name: string; rank: string }>;
      const canais = view
        .prepare(
          'SELECT id, category_id AS categoryId, type, name, topic, rank, read_only_role_ids AS readOnlyRoleIds ' +
            'FROM channels WHERE community_id = ? AND deleted_at IS NULL ORDER BY rank ASC',
        )
        .all(communityId) as Array<{ id: string; categoryId: string; type: number; name: string; topic: string | null; rank: string; readOnlyRoleIds: string }>;

      const porCategoria = new Map<string, Array<Record<string, unknown>>>();
      for (const c of canais) {
        let somenteLeitura = false;
        try {
          const ids: unknown = JSON.parse(c.readOnlyRoleIds);
          if (Array.isArray(ids)) somenteLeitura = ids.some((r) => typeof r === 'string' && cargos.has(r));
        } catch {
          somenteLeitura = false;
        }
        const leitura = manifest.getReadState(communityId, c.id);
        const lista = porCategoria.get(c.categoryId) ?? [];
        lista.push({
          id: c.id,
          name: c.name,
          type: c.type,
          ...(c.topic !== null ? { topic: c.topic } : {}),
          rank: c.rank,
          readOnly: somenteLeitura,
          muted: manifest.isChannelMuted(c.id),
          unread: { count: leitura.unreadCount, mentions: leitura.pendingMentions },
          ...(leitura.firstUnreadSeq !== null ? { firstUnreadSeq: leitura.firstUnreadSeq } : {}),
        });
        porCategoria.set(c.categoryId, lista);
      }

      return {
        categories: categorias.map((cat) => ({
          id: cat.id,
          name: cat.name,
          rank: cat.rank,
          collapsed: recolhidas.has(cat.id),
          channels: porCategoria.get(cat.id) ?? [],
        })),
      };
    },

    /**
     * `query.messages` (§15.6): página de um canal, `seq` crescente (§23.2), cursor
     * bidirecional por `(seq, id)` e lote de 50 (§23.3). `before` devolve a página **anterior**
     * já reordenada para leitura — a UI não inverte nada.
     */
    messages(a: { communityId: string; channelId: string; cursor?: string; limit?: number; direction?: string }) {
      const estado = ds(a.communityId);
      const cargos = meusCargos(estado);
      const n = limite(a.limit, LIMITE_MENSAGENS);
      const direcao = a.direction ?? 'before';
      if (direcao !== 'before' && direcao !== 'after') recusar('E_VALIDATION');
      const cursor = a.cursor === undefined ? null : decodeCursor(a.cursor);

      // A comparação é sobre o par `(seq, id)` — dois registros nunca compartilham `seq`, mas
      // o par é o que o cursor promete, e é ele que sobrevive a uma reprojeção.
      const condicao =
        cursor === null ? '' : direcao === 'before' ? 'AND (seq < ? OR (seq = ? AND id < ?)) ' : 'AND (seq > ? OR (seq = ? AND id > ?)) ';
      const ordem = direcao === 'before' ? 'DESC' : 'ASC';
      const params: unknown[] = [a.communityId, a.channelId];
      if (cursor !== null) params.push(cursor.seq, cursor.seq, cursor.id);
      const linhas = view
        .prepare(`SELECT ${COLUNAS} FROM messages WHERE community_id = ? AND channel_id = ? ${condicao}ORDER BY seq ${ordem}, id ${ordem} LIMIT ?`)
        .all(...params, n + 1) as Linha[];

      const hasMore = linhas.length > n;
      const pagina = hasMore ? linhas.slice(0, n) : linhas;
      // §23.2 — mensagens de canal sempre saem em `seq` crescente, independente da direção.
      const ordenada = direcao === 'before' ? [...pagina].reverse() : pagina;
      const borda = direcao === 'before' ? ordenada[0] : ordenada[ordenada.length - 1];
      return {
        messages: ordenada.map((r) => dto(a.communityId, estado, r, cargos)),
        ...(hasMore && borda !== undefined ? { nextCursor: encodeCursor({ seq: Number(borda['seq']), id: String(borda['id']) }) } : {}),
        hasMore,
        replication: deps.replicationOf(a.communityId),
      };
    },

    /** `query.message` (§15.6): a mensagem com reações, anexo e a thread que ela enraíza. */
    message(a: { communityId: string; messageId: string }) {
      const estado = ds(a.communityId);
      const cargos = meusCargos(estado);
      const row = view.prepare(`SELECT ${COLUNAS} FROM messages WHERE community_id = ? AND id = ?`).get(a.communityId, a.messageId) as Linha | undefined;
      if (row === undefined) return null;
      const eu = deps.selfKeyHex();
      const reacoes = view
        .prepare(
          'SELECT emoji, COUNT(*) AS total, SUM(CASE WHEN lower(hex(identity_key)) = ? THEN 1 ELSE 0 END) AS minhas ' +
            'FROM reactions WHERE community_id = ? AND message_id = ? GROUP BY emoji ORDER BY total DESC, emoji ASC',
        )
        .all(eu ?? '', a.communityId, a.messageId) as Array<{ emoji: string; total: number; minhas: number }>;
      const anexo = anexoDe(a.communityId, a.messageId);
      const thread = view
        .prepare('SELECT id, root_message_id AS rootMessageId, channel_id AS channelId, reply_count AS replyCount FROM threads WHERE community_id = ? AND root_message_id = ?')
        .get(a.communityId, a.messageId) as { id: string; rootMessageId: string; channelId: string; replyCount: number } | undefined;
      return {
        ...dto(a.communityId, estado, row, cargos),
        reactions: reacoes.map((r): QueryReactionDto => ({ emoji: r.emoji, count: r.total, mine: r.minhas > 0 })),
        ...(anexo !== null ? { attachment: anexo } : {}),
        ...(thread !== undefined ? { thread: { threadId: thread.id, channelId: thread.channelId, replyCount: thread.replyCount } } : {}),
      };
    },

    /** `query.pinned` (§15.6): fixadas do canal, `seq` decrescente (§23.2), lote de 25. */
    pinned(a: { communityId: string; channelId: string; cursor?: string; limit?: number }) {
      const estado = ds(a.communityId);
      const cargos = meusCargos(estado);
      const n = limite(a.limit, LIMITE_LISTAS);
      const cursor = a.cursor === undefined ? null : decodeCursor(a.cursor);
      const params: unknown[] = [a.communityId, a.channelId];
      if (cursor !== null) params.push(cursor.seq, cursor.seq, cursor.id);
      const linhas = view
        .prepare(
          `SELECT ${COLUNAS} FROM messages WHERE community_id = ? AND channel_id = ? AND pinned = 1 ` +
            `${cursor === null ? '' : 'AND (seq < ? OR (seq = ? AND id < ?)) '}ORDER BY seq DESC, id DESC LIMIT ?`,
        )
        .all(...params, n + 1) as Linha[];
      const hasMore = linhas.length > n;
      const pagina = hasMore ? linhas.slice(0, n) : linhas;
      const ultima = pagina[pagina.length - 1];
      return {
        items: pagina.map((r) => dto(a.communityId, estado, r, cargos)),
        ...(hasMore && ultima !== undefined ? { nextCursor: encodeCursor({ seq: Number(ultima['seq']), id: String(ultima['id']) }) } : {}),
        hasMore,
      };
    },

    /** `query.files` (§15.6): anexos do canal, do mais recente para trás (§23.2). */
    files(a: { communityId: string; channelId: string; cursor?: string; limit?: number }) {
      const estado = ds(a.communityId);
      const n = limite(a.limit, LIMITE_LISTAS);
      const cursor = a.cursor === undefined ? null : decodeCursor(a.cursor);
      const params: unknown[] = [a.communityId, a.channelId];
      if (cursor !== null) params.push(cursor.seq, cursor.seq, cursor.id);
      const linhas = view
        .prepare(
          'SELECT m.id, m.seq, m.host_ts AS hostTs, m.author_key AS authorKey FROM messages m ' +
            'JOIN attachments a ON a.community_id = m.community_id AND a.message_id = m.id ' +
            `WHERE m.community_id = ? AND m.channel_id = ? AND m.deleted_at IS NULL ` +
            `${cursor === null ? '' : 'AND (m.seq < ? OR (m.seq = ? AND m.id < ?)) '}ORDER BY m.seq DESC, m.id DESC LIMIT ?`,
        )
        .all(...params, n + 1) as Array<{ id: string; seq: number; hostTs: number; authorKey: Uint8Array }>;
      const hasMore = linhas.length > n;
      const pagina = hasMore ? linhas.slice(0, n) : linhas;
      const ultima = pagina[pagina.length - 1];
      return {
        items: pagina.map((r) => ({
          messageId: r.id,
          at: r.hostTs,
          author: ref(estado, Buffer.from(r.authorKey).toString('hex')),
          attachment: anexoDe(a.communityId, r.id)!,
        })),
        ...(hasMore && ultima !== undefined ? { nextCursor: encodeCursor({ seq: ultima.seq, id: ultima.id }) } : {}),
        hasMore,
      };
    },

    /** `query.links` (§15.6.1): fonte é `message_links`, escrita pelo `fold` (DR-38). */
    links(a: { communityId: string; channelId: string; cursor?: string; limit?: number }) {
      const estado = ds(a.communityId);
      const n = limite(a.limit, LIMITE_LISTAS);
      const cursor = a.cursor === undefined ? null : decodeCursor(a.cursor);
      const params: unknown[] = [a.communityId, a.channelId];
      if (cursor !== null) params.push(cursor.seq, cursor.seq, cursor.id);
      const linhas = view
        .prepare(
          'SELECT l.message_id AS messageId, l.idx, l.url, l.host, l.seq, m.host_ts AS hostTs, m.author_key AS authorKey ' +
            'FROM message_links l JOIN messages m ON m.community_id = l.community_id AND m.id = l.message_id ' +
            `WHERE l.community_id = ? AND m.channel_id = ? AND m.deleted_at IS NULL ` +
            `${cursor === null ? '' : 'AND (l.seq < ? OR (l.seq = ? AND l.message_id < ?)) '}ORDER BY l.seq DESC, l.message_id DESC, l.idx ASC LIMIT ?`,
        )
        .all(...params, n + 1) as Array<{ messageId: string; idx: number; url: string; host: string; seq: number; hostTs: number; authorKey: Uint8Array }>;
      const hasMore = linhas.length > n;
      const pagina = hasMore ? linhas.slice(0, n) : linhas;
      const ultima = pagina[pagina.length - 1];
      return {
        items: pagina.map((r) => ({
          messageId: r.messageId,
          at: r.hostTs,
          author: ref(estado, Buffer.from(r.authorKey).toString('hex')),
          url: r.url,
          host: r.host,
        })),
        ...(hasMore && ultima !== undefined ? { nextCursor: encodeCursor({ seq: ultima.seq, id: ultima.messageId }) } : {}),
        hasMore,
      };
    },

    /** `query.thread` (§15.6, DR-48): raiz + respostas em `seq` crescente, com participantes. */
    thread(a: { communityId: string; threadId: string; cursor?: string; limit?: number }) {
      const estado = ds(a.communityId);
      const cargos = meusCargos(estado);
      const n = limite(a.limit, LIMITE_MENSAGENS);
      const cabeca = view
        .prepare('SELECT root_message_id AS rootMessageId, reply_count AS replyCount FROM threads WHERE community_id = ? AND id = ?')
        .get(a.communityId, a.threadId) as { rootMessageId: string; replyCount: number } | undefined;
      if (cabeca === undefined) return null;
      const raiz = view.prepare(`SELECT ${COLUNAS} FROM messages WHERE community_id = ? AND id = ?`).get(a.communityId, cabeca.rootMessageId) as
        | Linha
        | undefined;
      if (raiz === undefined) return null;
      const cursor = a.cursor === undefined ? null : decodeCursor(a.cursor);
      const params: unknown[] = [a.communityId, a.threadId];
      if (cursor !== null) params.push(cursor.seq, cursor.seq, cursor.id);
      const respostas = view
        .prepare(
          `SELECT ${COLUNAS} FROM messages WHERE community_id = ? AND thread_id = ? ` +
            `${cursor === null ? '' : 'AND (seq > ? OR (seq = ? AND id > ?)) '}ORDER BY seq ASC, id ASC LIMIT ?`,
        )
        .all(...params, n + 1) as Linha[];
      const hasMore = respostas.length > n;
      const pagina = hasMore ? respostas.slice(0, n) : respostas;
      const ultima = pagina[pagina.length - 1];
      const participantes = new Set<string>([Buffer.from(raiz['authorKey'] as Uint8Array).toString('hex')]);
      for (const r of pagina) participantes.add(Buffer.from(r['authorKey'] as Uint8Array).toString('hex'));
      const leitura = manifest.getThreadReadState(a.communityId, a.threadId);
      return {
        root: dto(a.communityId, estado, raiz, cargos),
        replies: pagina.map((r) => dto(a.communityId, estado, r, cargos)),
        ...(hasMore && ultima !== undefined ? { nextCursor: encodeCursor({ seq: Number(ultima['seq']), id: String(ultima['id']) }) } : {}),
        replyCount: cabeca.replyCount,
        participants: [...participantes].map((k) => ref(estado, k)),
        unread: { count: leitura.unreadCount },
      };
    },

    /** `query.reactors` (§15.6, DR-47): quem reagiu com um emoji, teto de 24. */
    reactors(a: { communityId: string; messageId: string; emoji: string; limit?: number }) {
      const estado = ds(a.communityId);
      const n = limite(a.limit, LIMITE_REATORES);
      const total = (
        view.prepare('SELECT COUNT(*) AS total FROM reactions WHERE community_id = ? AND message_id = ? AND emoji = ?').get(a.communityId, a.messageId, a.emoji) as {
          total: number;
        }
      ).total;
      const linhas = view
        .prepare('SELECT identity_key AS identityKey FROM reactions WHERE community_id = ? AND message_id = ? AND emoji = ? ORDER BY at ASC LIMIT ?')
        .all(a.communityId, a.messageId, a.emoji, n) as Array<{ identityKey: Uint8Array }>;
      return { total, users: linhas.map((r) => ref(estado, Buffer.from(r.identityKey).toString('hex'))) };
    },
  };
}
