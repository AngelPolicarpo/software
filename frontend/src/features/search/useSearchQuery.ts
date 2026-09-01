import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../ipc/api";
import { resultadoDeBusca } from "../../live/adaptadores";
import {
  RESULTS_MAX_PER_GROUP,
  RESULTS_PER_GROUP,
  hasFilters,
} from "./searchIndex";
import type { BuscaResults, SearchFilters } from "./searchIndex";
import type { Channel } from "../../domain/types";

/** §8, 1.2 — debounce da digitação. */
const DEBOUNCE_MS = 250;

const VAZIO: BuscaResults = {
  messages: [],
  channels: [],
  members: [],
  partial: false,
};

export interface SearchQueryParams {
  communityId: string;
  query: string;
  filters: SearchFilters;
  scope: "channel" | "community" | null;
  activeChannel: Channel | undefined;
}

/**
 * A consulta em si (§23.1): debounce, ida ao núcleo e o corte da lista de
 * mensagens. Quem busca é o núcleo (FTS sobre view.db) — a tela só pergunta.
 */
export function useSearchQuery({
  communityId,
  query,
  filters,
  scope,
  activeChannel,
}: SearchQueryParams) {
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<BuscaResults>(VAZIO);
  const [carregando, setCarregando] = useState(false);
  // Termo novo recolhe a expansão: "Ver todos" é sobre ESTA busca, e mantê-la ligada faria
  // a consulta seguinte já nascer pedindo 100 sem ninguém ter pedido.
  //
  // Guardamos PARA QUAL consulta a expansão foi pedida, em vez de desligá-la num efeito.
  // O efeito custava uma consulta a mais em toda troca de termo: ele só rodava depois da
  // pintura, então a busca nova saía uma vez expandida (pedindo o teto de §23.1) e outra
  // recolhida, porque `expandMessages` está nas dependências da consulta.
  const [expandidoPara, setExpandidoPara] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const assinatura = useMemo(
    () => JSON.stringify([debounced, filters, scope]),
    [debounced, filters, scope],
  );
  const expandMessages = expandidoPara === assinatura;
  const setExpandMessages = useCallback(
    (v: boolean) => setExpandidoPara(v ? assinatura : null),
    [assinatura],
  );

  // O token `vivo` descarta a resposta de uma consulta velha que voltou
  // depois da nova.
  useEffect(() => {
    const termo = debounced.trim();
    if (termo === "" && !hasFilters(filters)) {
      setResults(VAZIO);
      setCarregando(false);
      return;
    }
    let vivo = true;
    setCarregando(true);
    api
      .search({
        communityId,
        query: termo,
        filters: {
          ...(filters.authorId ? { authorKey: filters.authorId } : {}),
          ...(filters.channelId ? { channelId: filters.channelId } : {}),
          ...(filters.date ? { date: filters.date } : {}),
          ...(filters.kind ? { kind: filters.kind } : {}),
        },
        ...(scope === "channel" && activeChannel
          ? { scopeChannelId: activeChannel.id }
          : {}),
        // **B12 — `limitPerGroup` nunca era enviado.** Sem ele o núcleo aplicava o default
        // de 20 (§23.1), e daí saíam DOIS defeitos que se escondiam um no outro: "Ver
        // todos" nunca aparecia, porque a condição é `length > 20` e o núcleo nunca
        // devolvia 21; e se aparecesse, expandiria para a mesma lista de 20 que já estava
        // na tela. Pede-se 21 fechado, para saber que há mais, e o teto de §23.1 expandido.
        limitPerGroup: expandMessages ? RESULTS_MAX_PER_GROUP : RESULTS_PER_GROUP + 1,
      })
      .then((r) => {
        if (!vivo) return;
        setResults(resultadoDeBusca(r));
        setCarregando(false);
      })
      .catch(() => {
        if (!vivo) return;
        setCarregando(false);
      });
    return () => {
      vivo = false;
    };
    // `expandMessages` entra nas dependências porque ele MUDA a consulta, não só o corte
    // da lista: expandir é ir buscar o resto, não revelar o que já estava aqui.
  }, [communityId, debounced, filters, scope, activeChannel, expandMessages]);

  const visibleMessages = expandMessages
    ? results.messages
    : results.messages.slice(0, RESULTS_PER_GROUP);

  return {
    debounced,
    results,
    carregando,
    expandMessages,
    setExpandMessages,
    visibleMessages,
  };
}
