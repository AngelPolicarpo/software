// Extração de links do conteúdo da mensagem — §15.6.1 (fecha `DR-38`).
//
// É regra do `fold`: o efeito nasce do mesmo registro em toda réplica, e o resultado tem de
// ser idêntico em todas elas para sempre (§8.0). Por isso a função é pura, total (nunca
// lança — §8.5) e não consulta nada além da string.

/** §15.6.1, literal: só `http` e `https`, no máximo 2000 caracteres de URL. */
const LINK_RE = /\b(https?):\/\/[^\s<>"']{1,2000}/g;

import { MAX_LINKS_PER_MESSAGE } from './constants.ts';

export type ExtractedLink = { readonly url: string; readonly host: string };

/**
 * Os links do conteúdo, na ordem em que aparecem, sem repetir a mesma URL.
 *
 * `host` é o **hostname**, sem porta e sem credenciais, em minúsculas. §15.6.1 diz
 * "registrable domain"; calcular isso exige uma Public Suffix List, e uma PSL **muda com o
 * tempo** — o mesmo registro produziria estados diferentes em binários diferentes, o que o
 * §8.0 proíbe. Entre um derivado instável e um derivado exato porém mais longo, a escolha é
 * o hostname; a UI é quem encurta para exibição (emenda registrada em §15.6.1).
 */
export function extractLinks(content: string | null | undefined): ExtractedLink[] {
  if (typeof content !== 'string' || content.length === 0) return [];
  const out: ExtractedLink[] = [];
  const vistos = new Set<string>();
  LINK_RE.lastIndex = 0;
  for (const m of content.matchAll(LINK_RE)) {
    const url = m[0];
    if (vistos.has(url)) continue;
    let host: string;
    try {
      // `URL` normaliza porta default, caixa do host e credenciais; entrada que ela recusa
      // não vira link nenhum — silêncio, nunca exceção (§8.5).
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (host.length === 0) continue;
    vistos.add(url);
    out.push({ url, host });
    if (out.length >= MAX_LINKS_PER_MESSAGE) break;
  }
  return out;
}
