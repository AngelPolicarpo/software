// Constantes de protocolo aplicadas pelo `dmFold` — §31.18, §31.7.5.
//
// §31.18: "**todos os limites de campo de §31.7.5, que são os de §8.6**. Nenhum número novo:
// reusar é o que mantém uma fonte só para cada limite." Os valores abaixo são exatamente os
// de `fold/constants.ts`, e mudar um deles lá sem mudar aqui é bug.
//
// **Por que os números aparecem duas vezes.** §4 dá a `dmFold` exatamente três dependências
// — `dmCodec`, `idgen`, `errors` —, e `fold` não está entre elas: a conversa direta é um
// módulo irmão do `fold`, não uma extensão dele (§31.0). Importar `fold/constants.ts` daqui é
// importação lateral não declarada e o `check-layers` do `npm run build` quebra. O teste
// `dm-fold-rules` confere valor a valor contra `fold/constants.ts`, que é o que impede a
// segunda cópia de envelhecer.
//
// §1.5 e §27.1 valem sem alteração: **nada aqui é configurável**. Os controles de §31.18 que
// *são* configuráveis (`P2P_DM_*`) são locais, não têm efeito na interpretação, e por isso
// moram em `config` (L0), que §4 proíbe de expor qualquer valor ao `dmFold`.

const KiB = 1024;
const MiB = 1024 * KiB;
const SEGUNDO = 1000;

// ─── Tamanho de registro (§31.7.3 estágios 0 e 10, §31.7.5) ────────────────────────────

/** Teto do registro **sem** anexo. Igual a `MAX_ENVELOPE_BYTES` de §8.6. */
export const DM_MAX_ENVELOPE_BYTES = 32 * KiB;

/** Teto absoluto, conferido no **estágio 0**, antes de qualquer decode ou Ed25519. */
export const DM_MAX_ENVELOPE_BYTES_ATTACHMENT = 64 * KiB;

/**
 * §31.7.5 — `attachment.sizeBytes ∈ [1, DM_ATTACHMENT_MAX_BYTES]`. Emenda de 2026-09-04: o
 * mesmo teto de representação do `fold` (§13.8), não um teto de produto — a conversa direta
 * nunca teve cota, e agora a comunidade também não tem.
 */
export const DM_ATTACHMENT_MAX_BYTES = Number.MAX_SAFE_INTEGER;

// ─── Cardinalidade (RD-9) ──────────────────────────────────────────────────────────────

/** RD-9 — emojis **distintos** por mensagem. `present:true` que estoure é recusada. */
export const DM_MAX_REACTION_EMOJIS = 20;

// ─── Relógio (§31.6, RD-5) ─────────────────────────────────────────────────────────────
//
// **Não há `CLOCK_ACCEPT_MS` aqui, e a ausência é decisão de §31.6:** sem host não existe
// carimbo neutro contra o qual comparar, e recusar por relógio daria a uma parte com relógio
// quebrado o poder de destruir a conversa. R-2 não tem análogo. O que existe é o clamp de
// RD-5 e a marca `clockSkewed`, que é uma impossibilidade **causal** — detectável sem
// relógio externo, e melhor sinal do que a janela fixa de 24 h de R-2.

/**
 * §31.18 lista `CLOCK_SKEW_MS` entre as constantes reusadas. Aqui ele **não** é a margem de
 * uma janela: `clockSkewed` é marcado quando `ts` é menor que o `ts` do registro mais
 * recente que o próprio registro reconhece por `ack` (§31.6), que é comparação exata. A
 * constante fica declarada para a UI de §6.7 e não participa de decisão nenhuma do `dmFold`.
 */
export const DM_CLOCK_SKEW_MS = 60 * SEGUNDO;

// ─── Gênese (RD-1) ─────────────────────────────────────────────────────────────────────

/** RD-1: o índice 0 de todo core de DM é um `dm.hello`. A gênese tem **um** registro. */
export const DM_GENESIS_INDEX = 0;

// ─── Enums numerados que viajam em material assinado ───────────────────────────────────

/** §31.7.5 — `avatarColor ∈ [0, 7]`, igual a §6.4.2. Fora da faixa é `REJECTED`, nunca clampado. */
export const DM_AVATAR_COLOR_MAX = 7;

export function isDmAvatarColor(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= DM_AVATAR_COLOR_MAX;
}

// ─── Limites de campo (§31.7.5, reuso literal de §8.6) ─────────────────────────────────

/**
 * §31.7.5. `cp` conta **code points** (escalares Unicode), `bytes` conta UTF-8. Grafema não
 * aparece em lugar nenhum, pela mesma razão de §8.6: ele depende da tabela do ICU do
 * runtime, e contá-lo faria a interpretação do log ser função do ambiente (§1.5).
 */
export const DM_LIMIT = {
  displayName: { minCp: 2, maxCp: 32 },
  messageContent: { minCp: 1, maxCp: 4000, maxBytes: 16384 },
  reactionEmoji: { minCp: 1, maxCp: 8, maxBytes: 32 },
  attachmentName: { minBytes: 1, maxBytes: 255 },
} as const;
