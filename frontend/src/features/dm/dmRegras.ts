import { AVATAR_COLORS } from "../../lib/avatar";
import type { AvatarColor } from "../../domain/types";
import type {
  DmConvState,
  DmMessageDto,
  DmSync,
} from "../../ipc/dto";

/**
 * As decisões de U-33 que **não** são render.
 *
 * Elas moram aqui, e não dentro dos componentes, pela mesma razão de
 * `moderation/historico.ts`: são o que o teste afirma, e a maior parte de U-33 é
 * proibição de texto — coisa que só é verificável se existir uma função a chamar. Um
 * componente que monta a frase inline transforma requisito normativo em detalhe de JSX,
 * e a próxima pessoa a mexer não tem como saber que "não entregue" não pode virar
 * "ele está offline".
 *
 * O nome não colide com componente nenhum: `dmRegras.ts` não tem irmão `DmRegras.tsx`
 * (`TS1261` num filesystem que não distingue caixa — a lição de `historico.ts`).
 */

/* ─── Os dois textos obrigatórios de §31.24 ───────────────────────────────── */

/**
 * **L-25**, superfície obrigatória. `dm.forget` está na classe `main-confirmed` de §15.3,
 * então o modal existe de qualquer forma; o que este texto acrescenta é a consequência
 * exata, que é a regra de §15 (nunca um "Tem certeza?" genérico).
 *
 * A segunda frase é a que não pode sumir numa revisão de copy: a linha de
 * `dm_conversations` sobrevive **para sempre** (§31.19 regra 2), porque sem o
 * `self_high_water` escrever de novo para a mesma pessoa produziria fork contra a cópia
 * que ela tem. Prometer "apaga tudo" seria mentira verificável no disco.
 */
export const TEXTO_ESQUECER_CONVERSA =
  "Isto apaga as mensagens desta conversa desta máquina e não pode ser desfeito. " +
  "Uma marca mínima da conversa permanece no disco — sem ela, escrever de novo para " +
  "esta pessoa corromperia a cópia que ela tem. Apagar tudo só é possível apagando a " +
  "identidade.";

/**
 * **L-28**, superfície obrigatória. O bloqueio é silencioso por decisão de segurança
 * (§31.9 regra 2): avisar transformaria o bloqueio num sinal para escalar. Quem bloqueia
 * precisa saber que o silêncio **é** o mecanismo — senão espera um efeito que não vem.
 */
export const TEXTO_BLOQUEAR_CONVERSA =
  "A outra pessoa não é avisada. Para ela, você fica igual a alguém desligado.";

/**
 * **L-29**, superfície obrigatória. O que este texto não pode conter é a oferta de relay:
 * numa dupla não há terceiro, então §17.7 não se aplica (§31.15). Oferecer o caminho de
 * recuperação que a comunidade tem seria pior do que declarar a falha.
 */
export const TEXTO_CHAMADA_SEM_RELAY =
  "A chamada precisa que pelo menos um dos dois esteja alcançável pela rede. " +
  "Numa conversa direta não há terceiro para encaminhar.";

/* ─── Entrega (§31.11) — o que a tela pode e não pode dizer ───────────────── */

export type RotuloDeEntrega = {
  /** O que aparece ao lado da mensagem. */
  readonly texto: string;
  /** `title`/`aria-label` — mais longo, e igualmente proibido de afirmar a causa. */
  readonly detalhe: string;
};

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/** O tempo desde a escrita, que é a **única** informação que §31.24 manda acrescentar. */
export function tempoDesdeEscrita(ts: number, agora: number): string {
  const ms = Math.max(0, agora - ts);
  if (ms < MINUTO) return "agora mesmo";
  if (ms < HORA) return `há ${Math.floor(ms / MINUTO)} min`;
  if (ms < DIA) return `há ${Math.floor(ms / HORA)} h`;
  const dias = Math.floor(ms / DIA);
  return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

/**
 * O rótulo de uma mensagem **própria**. `undefined` para as do par: §31.11 dá `delivery`
 * só nas minhas, e inventar um estado de entrega para a mensagem do outro seria afirmar
 * o que eu não observo.
 *
 * As duas proibições de **L-26** e **L-28**, que são o motivo desta função existir:
 *
 * 1. `undelivered` não diz **por quê**. Ele é, por construção, indistinguível entre o par
 *    offline e o par que bloqueou (§31.9 regra 2) — as duas situações produzem
 *    exatamente o mesmo `ack` parado. Escrever "ele está offline" inventaria o fato que
 *    o protocolo recusa dar.
 * 2. `delivered` não é **"lido"**. O `ack` só avança quando o par **escreve**, então ele
 *    atesta que os registros chegaram, não que alguém os leu; confirmação de leitura não
 *    existe em §31.5, e o rótulo seria inventá-la na camada errada.
 */
export function rotuloDeEntrega(
  mensagem: Pick<DmMessageDto, "delivery" | "ts">,
  agora: number,
): RotuloDeEntrega | undefined {
  if (mensagem.delivery === undefined) return undefined;
  if (mensagem.delivery === "delivered") {
    return {
      texto: "Entregue",
      // "Entregue" e não "visto": o `ack` é atestado de chegada, assinado pelo par.
      detalhe: "O outro lado recebeu esta mensagem. Não é confirmação de leitura.",
    };
  }
  return {
    texto: "Não entregue",
    detalhe: `Escrita ${tempoDesdeEscrita(mensagem.ts, agora)} e ainda não recebida pelo outro lado.`,
  };
}

/* ─── Sincronização (§31.13) — sete estados, seis frases ──────────────────── */

export type FaixaDeSincronizacao = {
  readonly tone: "offline" | "reconnecting" | "degraded" | "failed";
  readonly texto: string;
  /** Escrever é possível? §31.13: `desynced` e `forked` recusam o append. */
  readonly podeEscrever: boolean;
};

/**
 * A frase de cada estado de §31.13 — e a igualdade que é requisito, não descuido:
 * **`unauthorized` devolve exatamente o mesmo texto que `peer-offline`**.
 *
 * Os dois são distintos no núcleo (um é "o par recusou o canal", o outro é "não há
 * conexão"), e precisam ser **indistinguíveis na tela**. Separá-los diria ao bloqueado
 * que ele foi bloqueado, que é precisamente o que **L-28** recusa — e vazaria por um
 * caminho lateral o sinal que §31.9 regra 2 se dá ao trabalho de não emitir.
 *
 * `synced` não tem faixa: o estado normal não se anuncia.
 */
export function faixaDeSincronizacao(sync: DmSync): FaixaDeSincronizacao | null {
  switch (sync) {
    case "synced":
      return null;
    case "catching-up":
      return { tone: "reconnecting", texto: "Recebendo mensagens…", podeEscrever: true };
    case "stalled":
      return {
        tone: "degraded",
        texto: "A sincronização parou. Falta receber parte da conversa.",
        podeEscrever: true,
      };
    case "peer-offline":
    case "unauthorized":
      // MESMA frase, de propósito. Ver o comentário acima antes de "melhorar" isto.
      return {
        tone: "offline",
        texto: "Sem conexão com esta pessoa agora.",
        podeEscrever: true,
      };
    case "desynced":
      return {
        tone: "failed",
        texto:
          "Parte do seu lado desta conversa se perdeu nesta máquina. Escrever está " +
          "suspenso até o próximo contato com a outra pessoa — escrever agora " +
          "corromperia a cópia que ela tem.",
        podeEscrever: false,
      };
    case "forked":
      return {
        tone: "failed",
        texto:
          "Esta conversa foi escrita de duas máquinas ao mesmo tempo e os dois lados " +
          "divergiram. Escrever está suspenso; é preciso escolher qual ramo manter.",
        podeEscrever: false,
      };
  }
}

/**
 * O composer existe? **Some** em `blocked` e `left` — ali a conversa é histórico, e o
 * campo seria decorativo (§15). **Fica visível e desabilitado** em `desynced` e `forked`,
 * que é a única exceção declarada em U-33 à regra de esconder-nunca-desabilitar: o estado
 * é temporário e espera o par (§31.13), e sumir com o campo faria a conversa parecer
 * somente-leitura por natureza.
 */
export function composerDaConversa(
  state: DmConvState,
  sync: DmSync,
): { readonly visivel: boolean; readonly habilitado: boolean; readonly motivo?: string } {
  if (state === "blocked" || state === "left" || state === "pending-in") {
    return { visivel: false, habilitado: false };
  }
  const faixa = faixaDeSincronizacao(sync);
  if (faixa !== null && !faixa.podeEscrever) {
    return { visivel: true, habilitado: false, motivo: faixa.texto };
  }
  return { visivel: true, habilitado: true };
}

/* ─── Marcas na mensagem (L-27 e o relógio) ───────────────────────────────── */

export type MarcaDeMensagem = {
  readonly id: "ordem-provisoria" | "relogio";
  readonly rotulo: string;
  readonly detalhe: string;
};

/**
 * **L-27** — a ordem de uma conversa direta é acordo entre as duas partes, e uma delas
 * pode declarar um `ack` maior do que o que viu. A outra vê isso **marcado**, nunca
 * corrigido e nunca escondido: não há terceiro a enganar numa dupla, e recusar o registro
 * daria a um contador quebrado o poder de parar a conversa (§31.6).
 */
export function marcasDaMensagem(
  mensagem: Pick<DmMessageDto, "ackAhead" | "clockSkewed">,
): MarcaDeMensagem[] {
  const marcas: MarcaDeMensagem[] = [];
  if (mensagem.ackAhead) {
    marcas.push({
      id: "ordem-provisoria",
      rotulo: "ordem provisória",
      detalhe:
        "A posição desta mensagem foi declarada por quem a escreveu e não é confirmada " +
        "pela ordem da conversa.",
    });
  }
  if (mensagem.clockSkewed) {
    marcas.push({
      id: "relogio",
      rotulo: "relógio fora de hora",
      detalhe: "O horário declarado não é coerente com a ordem em que a conversa aconteceu.",
    });
  }
  return marcas;
}

/* ─── Ações por estado (§15: esconder, nunca desabilitar) ─────────────────── */

export type AcaoDeConversa =
  | "aceitar"
  | "bloquear"
  | "desbloquear"
  | "esquecer";

/**
 * Quais ações **renderizam** para cada estado de §31.9. Aceitar e bloquear existem só
 * em `pending-in`; desbloquear só em `blocked`. Nada de botão visível e morto — a regra
 * de §15, e o precedente é U-32.
 *
 * `esquecer` existe em todos, inclusive em `pending-in`: recusar um pedido sem bloquear
 * quem o mandou é um desfecho legítimo, e o teto de §31.9 regra 4 depende de haver como
 * esvaziar a fila.
 */
export function acoesDaConversa(state: DmConvState): AcaoDeConversa[] {
  switch (state) {
    case "pending-in":
      return ["aceitar", "bloquear", "esquecer"];
    case "blocked":
      return ["desbloquear", "esquecer"];
    case "left":
      return [];
    case "pending-out":
    case "accepted":
      return ["bloquear", "esquecer"];
  }
}

/* ─── Ordem canônica e a recarga de `dm.reordered` ────────────────────────── */

/**
 * A ordem de §31.6, e a mesma do cursor de §31.16.3: `(ordSum, authorKey, id)`. O
 * desempate por chave e depois por id é o que a torna total — dois registros podem
 * empatar em `ordSum`, e sem desempate determinístico as duas réplicas mostrariam ordens
 * diferentes da mesma conversa.
 */
export function compararMensagens(a: DmMessageDto, b: DmMessageDto): number {
  if (a.ordSum !== b.ordSum) return a.ordSum - b.ordSum;
  const chave = a.author.key.localeCompare(b.author.key);
  if (chave !== 0) return chave;
  return a.id.localeCompare(b.id);
}

/**
 * Mescla uma página nova na lista, por `id`, e reordena. Página vem do núcleo já
 * ordenada; o que exige a reordenação aqui é a chegada por evento, que não respeita
 * paginação nenhuma.
 */
export function mesclarMensagens(
  atuais: readonly DmMessageDto[],
  novas: readonly DmMessageDto[],
): DmMessageDto[] {
  const porId = new Map(atuais.map((m) => [m.id, m]));
  for (const m of novas) porId.set(m.id, m);
  return [...porId.values()].sort(compararMensagens);
}

/**
 * `dm.reordered` — o **único** dos doze eventos de §31.16.2 que a UI não pode tratar
 * como "reconsultar se quiser".
 *
 * Chegou um registro cujo `ordKey` é menor que o já interpretado (§31.13, inserção
 * retroativa): o projetor reinterpretou dali até as duas cabeças, e a lista renderizada
 * **deixou de ser a corrente** a partir de `fromOrdSum`. Descartar a faixa é obrigatório
 * — mantê-la mostraria uma história que não existe mais, com as mensagens novas
 * penduradas no fim.
 *
 * O que sobra abaixo do corte é mantido de propósito: é a parte que não mudou, e é a
 * âncora de rolagem que impede o salto na recarga.
 */
export function descartarFaixaReordenada(
  mensagens: readonly DmMessageDto[],
  fromOrdSum: number,
): DmMessageDto[] {
  return mensagens.filter((m) => m.ordSum < fromOrdSum);
}

/* ─── A lista (§31.16.3) ──────────────────────────────────────────────────── */

/**
 * O nome exibido de um par, **sempre com o `handle` junto** (§6.1).
 *
 * §31.16.3 não tem `collision`: numa conversa de dois não há conjunto em que colidir. O
 * `handle` continua ao lado mesmo assim, porque a mitigação (a) de **L-5** vale aqui mais
 * forte — para falar com alguém é preciso já ter a chave dele, e é o `handle` que liga o
 * nome escolhido àquela chave.
 */
export function nomeComHandle(peer: { displayName: string; handle: string }): string {
  return `${peer.displayName} ${peer.handle}`;
}

/**
 * A cor do avatar do par. §31.16.3 dá `avatarColor` como **número** — o par o escolhe e o
 * escreve no `dm.profile` —, e a paleta é a de §5.4, curada para contraste. O módulo é o
 * que impede um número arbitrário de virar cor inexistente.
 *
 * Mora aqui, e não no componente, pela regra que `historico.ts` já pagou: um `.tsx` que
 * exporta função além de componente quebra o Fast Refresh.
 */
export function corDoPar(avatarColor: number): AvatarColor {
  return AVATAR_COLORS[Math.abs(Math.trunc(avatarColor)) % AVATAR_COLORS.length];
}

/* ─── §31.15 / U-33 — a chamada de dois, e o que a tela não pode oferecer ─── */

/**
 * Os estados de uma chamada numa conversa direta. São **quatro**, e a lista curta é o
 * ponto: §31.15 remove roster, ocupação, fila e revogação, então não há "3 na chamada",
 * não há "você é o próximo" e não há "sua permissão foi revogada".
 */
export type DmCallState = "fora" | "chamando" | "recebendo" | "na-chamada";

export type AcaoDeChamada = "chamar" | "atender" | "desligar";

/**
 * O que o cabeçalho da conversa oferece, por estado.
 *
 * A chamada só existe em `accepted`: antes do aceite não há core meu (§31.9 regra 1) e o
 * canal de sinalização de §31.15 não está autorizado (`autorizaDm` exige o estado). Um
 * botão de ligar num pedido pendente prometeria um caminho que o transporte recusa.
 */
export function acoesDeChamada(state: DmConvState, chamada: DmCallState): AcaoDeChamada[] {
  if (state !== "accepted") return [];
  switch (chamada) {
    case "fora":
      return ["chamar"];
    case "recebendo":
      return ["atender", "desligar"];
    case "chamando":
    case "na-chamada":
      return ["desligar"];
  }
}

export type FaixaDeChamada = {
  /** Os tons de `StatusBanner` (§6) — os mesmos que a faixa de sincronização usa. */
  readonly tone: "reconnecting" | "degraded" | "failed";
  readonly texto: string;
  /**
   * §17.7 **não se aplica** (§31.15, **L-29**). O campo existe para o teste poder afirmar a
   * ausência: uma faixa de falha que trouxesse `podeOferecerRelay: true` desfaria L-29 na
   * única superfície em que ela é visível.
   */
  readonly podeOferecerRelay: false;
};

/**
 * A faixa da chamada, incluindo o desfecho `conn-failed` de **L-29**.
 *
 * `motivo` é o diagnóstico de rede de §99, tal como a malha o produziu — o mesmo texto que
 * a comunidade mostra. O que muda numa DM é o que vem **depois** dele: na comunidade §17.7
 * oferece o relay voluntário, e aqui não há terceiro a quem recorrer. A frase de
 * `TEXTO_CHAMADA_SEM_RELAY` é o que ocupa esse lugar, e ela não oferece nada.
 */
export function faixaDeChamada(
  chamada: DmCallState,
  falha: string | null,
): FaixaDeChamada | null {
  if (falha !== null) {
    return {
      tone: "failed",
      texto: `${falha} ${TEXTO_CHAMADA_SEM_RELAY}`,
      podeOferecerRelay: false,
    };
  }
  switch (chamada) {
    case "chamando":
      // "Chamando" é fato local: eu entrei e o outro ainda não. Não afirma nada sobre ele —
      // não diz "está tocando lá", que exigiria um atestado que o protocolo não dá.
      return { tone: "reconnecting", texto: "Chamando…", podeOferecerRelay: false };
    case "recebendo":
      return { tone: "reconnecting", texto: "Chamada recebida", podeOferecerRelay: false };
    case "na-chamada":
      return null;
    case "fora":
      return null;
  }
}
