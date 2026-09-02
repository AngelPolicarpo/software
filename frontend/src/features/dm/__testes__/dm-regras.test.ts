// U-33 — as decisões da conversa direta que não são render.
//
// A maior parte de U-33 é **proibição de texto**, e proibição só é verificável se houver
// uma função a chamar. É por isso que estas regras não moram dentro dos componentes: o
// teste precisa poder afirmar que "não entregue" não vira "ele está offline", e que
// `unauthorized` e `peer-offline` produzem a MESMA frase.

import { describe, expect, it } from "vitest";

import {
  TEXTO_BLOQUEAR_CONVERSA,
  TEXTO_CHAMADA_SEM_RELAY,
  TEXTO_ESQUECER_CONVERSA,
  TEXTO_NOVA_CONVERSA,
  TEXTO_POLITICA_RESTRITA,
  acoesDaConversa,
  acoesDeChamada,
  compararMensagens,
  composerDaConversa,
  descartarFaixaReordenada,
  faixaDeChamada,
  faixaDeSincronizacao,
  lerChaveDeIdentidade,
  marcasDaMensagem,
  mesclarMensagens,
  nomeComHandle,
  rotuloDeEntrega,
  tempoDesdeEscrita,
} from "../dmRegras";
import type { DmMessageDto, DmSync } from "../../../ipc/dto";

const AGORA = 1_800_000_000_000;
const MIN = 60_000;

function msg(over: Partial<DmMessageDto> = {}): DmMessageDto {
  return {
    id: "m1",
    ordSum: 1,
    conversationId: "c",
    author: { key: "aa", displayName: "Ana", handle: "@ana", avatarColor: 0 },
    content: "oi",
    ts: AGORA,
    clockSkewed: false,
    ackAhead: false,
    hasAttachment: false,
    deleted: false,
    ...over,
  };
}

describe("§31.11 — o rótulo de entrega, e o que ele é proibido de dizer", () => {
  it("mensagem do PAR não leva rótulo nenhum: `delivery` só existe nas minhas", () => {
    // Inventar entrega para a mensagem do outro afirmaria o que este nó não observa.
    expect(rotuloDeEntrega(msg({ ts: AGORA }), AGORA)).toBeUndefined();
  });

  it("L-26/L-28 — 'não entregue' traz o TEMPO e nunca a causa", () => {
    const r = rotuloDeEntrega(msg({ delivery: "written", ts: AGORA - 3 * MIN }), AGORA);
    expect(r?.texto).toBe("Não entregue");
    expect(r?.detalhe).toContain("há 3 min");
    // `undelivered` é indistinguível entre par offline e par que bloqueou (§31.9 r. 2).
    const tudo = `${r?.texto} ${r?.detalhe}`.toLowerCase();
    for (const proibida of ["offline", "bloque", "desligad", "ausente", "recusou"]) {
      expect(tudo).not.toContain(proibida);
    }
  });

  it("§31.11 — `delivered` nunca é rotulado 'lido': o `ack` é chegada, não leitura", () => {
    const r = rotuloDeEntrega(msg({ delivery: "delivered" }), AGORA);
    expect(r?.texto).toBe("Entregue");
    expect(`${r?.texto} ${r?.detalhe}`.toLowerCase()).not.toContain("lid");
    // E o detalhe diz explicitamente que não é confirmação de leitura.
    expect(r?.detalhe).toContain("Não é confirmação de leitura");
  });

  it("o tempo desde a escrita degrada de minuto a dia, e nunca é negativo", () => {
    expect(tempoDesdeEscrita(AGORA, AGORA)).toBe("agora mesmo");
    expect(tempoDesdeEscrita(AGORA - 90_000, AGORA)).toBe("há 1 min");
    expect(tempoDesdeEscrita(AGORA - 3 * 3_600_000, AGORA)).toBe("há 3 h");
    expect(tempoDesdeEscrita(AGORA - 2 * 86_400_000, AGORA)).toBe("há 2 dias");
    // Relógio adiantado do outro lado não vira "há -5 min".
    expect(tempoDesdeEscrita(AGORA + 5 * MIN, AGORA)).toBe("agora mesmo");
  });
});

describe("§31.13 — os sete estados, e a igualdade que L-28 exige", () => {
  it("`unauthorized` e `peer-offline` produzem EXATAMENTE a mesma faixa", () => {
    // Esta é a asserção que protege L-28 de vazar por um caminho lateral: os dois estados
    // são distintos no núcleo e têm de ser indistinguíveis na tela. Separá-los diria ao
    // bloqueado que ele foi bloqueado.
    expect(faixaDeSincronizacao("unauthorized")).toEqual(faixaDeSincronizacao("peer-offline"));
    const texto = faixaDeSincronizacao("unauthorized")?.texto ?? "";
    expect(texto.toLowerCase()).not.toContain("recus");
    expect(texto.toLowerCase()).not.toContain("bloque");
  });

  it("`synced` não tem faixa — o estado normal não se anuncia", () => {
    expect(faixaDeSincronizacao("synced")).toBeNull();
  });

  it("só `desynced` e `forked` impedem escrever, e os dois dizem o porquê", () => {
    const todos: DmSync[] = [
      "synced",
      "catching-up",
      "stalled",
      "peer-offline",
      "unauthorized",
      "forked",
      "desynced",
    ];
    const bloqueiam = todos.filter((s) => faixaDeSincronizacao(s)?.podeEscrever === false);
    expect(bloqueiam.sort()).toEqual(["desynced", "forked"]);
    expect(faixaDeSincronizacao("desynced")?.texto).toContain("suspenso");
    expect(faixaDeSincronizacao("forked")?.texto).toContain("suspenso");
  });
});

describe("U-33 — o composer, e a única exceção à regra de §15", () => {
  it("some onde a conversa é histórico: bloqueada, esquecida e pedido", () => {
    expect(composerDaConversa("blocked", "synced").visivel).toBe(false);
    expect(composerDaConversa("left", "synced").visivel).toBe(false);
    // `pending-in` é pedido, não conversa: aceitar é o ato (§31.9 r. 1).
    expect(composerDaConversa("pending-in", "synced").visivel).toBe(false);
  });

  it("`pending-out` escreve: escrever é sempre possível, o que espera é a replicação", () => {
    // §31.10 — não há outbox, e o registro é final assim que escrito. O que o outro lado
    // ainda não aceitou é a conversa, não a escrita.
    expect(composerDaConversa("pending-out", "peer-offline")).toEqual({
      visivel: true,
      habilitado: true,
    });
  });

  it("em `desynced` fica VISÍVEL e desabilitado, com o motivo — a exceção declarada", () => {
    const c = composerDaConversa("accepted", "desynced");
    expect(c.visivel).toBe(true);
    expect(c.habilitado).toBe(false);
    expect(c.motivo).toBeTruthy();
  });
});

describe("L-27 — a ordem provisória é marcada, nunca corrigida", () => {
  it("`ackAhead` vira marca com explicação, e não some da lista", () => {
    const marcas = marcasDaMensagem(msg({ ackAhead: true }));
    expect(marcas.map((m) => m.id)).toEqual(["ordem-provisoria"]);
    expect(marcas[0].detalhe).toContain("não é confirmada");
  });

  it("`clockSkewed` é uma marca à parte — são dois fatos diferentes", () => {
    expect(marcasDaMensagem(msg({ ackAhead: true, clockSkewed: true })).map((m) => m.id)).toEqual([
      "ordem-provisoria",
      "relogio",
    ]);
    expect(marcasDaMensagem(msg())).toEqual([]);
  });
});

describe("§15 — item aparece só quando a ação existe naquele estado", () => {
  it("aceitar e bloquear só em `pending-in`; desbloquear só em `blocked`", () => {
    expect(acoesDaConversa("pending-in")).toEqual(["aceitar", "bloquear", "esquecer"]);
    expect(acoesDaConversa("blocked")).toEqual(["desbloquear", "esquecer"]);
    expect(acoesDaConversa("accepted")).not.toContain("aceitar");
    expect(acoesDaConversa("accepted")).not.toContain("desbloquear");
    expect(acoesDaConversa("pending-out")).not.toContain("aceitar");
  });

  it("`left` não tem ação: a conversa já foi esquecida", () => {
    expect(acoesDaConversa("left")).toEqual([]);
  });
});

describe("§31.6/§31.13 — ordem canônica e a recarga obrigatória", () => {
  it("empate em `ordSum` é desempatado por chave e depois por id", () => {
    // Sem desempate total, as duas réplicas mostrariam ordens diferentes da MESMA conversa.
    const a = msg({ id: "b", ordSum: 5, author: { ...msg().author, key: "01" } });
    const b = msg({ id: "a", ordSum: 5, author: { ...msg().author, key: "02" } });
    expect(compararMensagens(a, b)).toBeLessThan(0);
    const c = msg({ id: "a", ordSum: 5 });
    const d = msg({ id: "b", ordSum: 5 });
    expect(compararMensagens(c, d)).toBeLessThan(0);
  });

  it("mesclar é por `id` e reordena — a chegada por evento não respeita paginação", () => {
    const atuais = [msg({ id: "m1", ordSum: 1 }), msg({ id: "m3", ordSum: 3 })];
    const novas = [msg({ id: "m2", ordSum: 2 }), msg({ id: "m1", ordSum: 1, content: "editada" })];
    const r = mesclarMensagens(atuais, novas);
    expect(r.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    // A versão nova da mesma mensagem vence: `dm.messageUpdated` é reconsulta, não append.
    expect(r[0].content).toBe("editada");
  });

  it("`dm.reordered` descarta a faixa a partir de `fromOrdSum`, e só ela", () => {
    // Mantê-la mostraria uma história que não existe mais, com as novas penduradas no fim.
    const lista = [1, 2, 3, 4, 5].map((n) => msg({ id: `m${n}`, ordSum: n }));
    expect(descartarFaixaReordenada(lista, 3).map((m) => m.ordSum)).toEqual([1, 2]);
    // O que sobra abaixo do corte é a âncora de rolagem que impede o salto na recarga.
    expect(descartarFaixaReordenada(lista, 1)).toEqual([]);
    expect(descartarFaixaReordenada(lista, 99)).toHaveLength(5);
  });
});

describe("§31.24 — os textos obrigatórios", () => {
  it("L-25 — esquecer diz que uma marca PERMANECE no disco", () => {
    // Prometer "apaga tudo" seria mentira verificável: a linha de `dm_conversations`
    // sobrevive para sempre (§31.19 r. 2), senão escrever de novo produziria fork.
    expect(TEXTO_ESQUECER_CONVERSA).toContain("permanece no disco");
    expect(TEXTO_ESQUECER_CONVERSA).toContain("não pode ser desfeito");
  });

  it("L-28 — bloquear diz que o outro NÃO é avisado", () => {
    expect(TEXTO_BLOQUEAR_CONVERSA).toContain("não é avisada");
    expect(TEXTO_BLOQUEAR_CONVERSA).toContain("alguém desligado");
  });

  it("L-29 — a chamada que falha não oferece relay, porque não existe", () => {
    expect(TEXTO_CHAMADA_SEM_RELAY.toLowerCase()).not.toContain("relay");
    expect(TEXTO_CHAMADA_SEM_RELAY).toContain("não há terceiro");
  });
});

describe("§31.16.3 — o par sem `collision`", () => {
  it("o `handle` vai sempre junto do nome (mitigação (a) de L-5)", () => {
    expect(nomeComHandle({ displayName: "Ana", handle: "@ana" })).toBe("Ana @ana");
  });
});

// ─── §31.15 / L-29 — a chamada de dois ────────────────────────────────────────────────

describe("§31.15 — as ações de chamada, e onde elas NÃO existem", () => {
  it("só há chamada numa conversa aceita: antes do aceite o canal de sinalização é recusado", () => {
    for (const estado of ["pending-in", "pending-out", "blocked", "left"] as const) {
      expect(acoesDeChamada(estado, "fora")).toEqual([]);
    }
  });

  it("aceita e fora da chamada: chamar", () => {
    expect(acoesDeChamada("accepted", "fora")).toEqual(["chamar"]);
  });

  it("recebendo: atender ou desligar — e não existe 'recusar com motivo'", () => {
    expect(acoesDeChamada("accepted", "recebendo")).toEqual(["atender", "desligar"]);
  });

  it("chamando e na chamada: só desligar. Não há fila, ocupação nem revogação (§31.15)", () => {
    expect(acoesDeChamada("accepted", "chamando")).toEqual(["desligar"]);
    expect(acoesDeChamada("accepted", "na-chamada")).toEqual(["desligar"]);
  });
});

describe("§31.15 / L-29 — a falha da chamada não pode oferecer relay", () => {
  const falha = faixaDeChamada("chamando", "Nenhum dos dois lados tem endereço público.");

  it("o desfecho traz o diagnóstico de §99 E a frase que declara a ausência de terceiro", () => {
    expect(falha?.texto).toContain("Nenhum dos dois lados tem endereço público.");
    expect(falha?.texto).toContain(TEXTO_CHAMADA_SEM_RELAY);
    expect(falha?.tone).toBe("failed");
  });

  it("a faixa NUNCA oferece relay — §17.7 pressupõe um terceiro, e numa dupla não há", () => {
    expect(falha?.podeOferecerRelay).toBe(false);
    // "não há terceiro para encaminhar" é a **declaração da ausência**; o que a faixa não
    // pode ter é a palavra `relay` ou o convite a recorrer a alguém. Trocar o texto por
    // "peça a alguém da comunidade para encaminhar" derruba este caso — que é o ponto:
    // seria oferecer o caminho de §17.7 numa dupla, onde ele não existe.
    for (const proibido of ["relay", "voluntári", "outro membro", "peça a"]) {
      expect(falha?.texto.toLowerCase()).not.toContain(proibido);
    }
  });

  it("chamando e recebendo são fato LOCAL: não afirmam nada sobre o outro lado", () => {
    expect(faixaDeChamada("chamando", null)?.texto).toBe("Chamando…");
    expect(faixaDeChamada("recebendo", null)?.texto).toBe("Chamada recebida");
    // "Tocando no aparelho dele" exigiria um atestado que o protocolo não dá — a mesma
    // disciplina que impede `delivered` de virar "lido" (§31.11).
    expect(faixaDeChamada("chamando", null)?.texto.toLowerCase()).not.toContain("tocando");
  });

  it("chamada de pé não tem faixa: a faixa é para o que precisa ser dito", () => {
    expect(faixaDeChamada("na-chamada", null)).toBeNull();
    expect(faixaDeChamada("fora", null)).toBeNull();
  });
});

// ─── §31.16.1 `dm.open` — a chave colada ──────────────────────────────────────────────

describe("lerChaveDeIdentidade — a porta de entrada da conversa direta", () => {
  const EU = "aa".repeat(32);
  const OUTRA = "bb".repeat(32);
  const vazio = { euHex: EU, conversas: [] };

  it("aceita a chave crua de 64 hex", () => {
    expect(lerChaveDeIdentidade(OUTRA, vazio)).toEqual({ ok: true, peerKey: OUTRA, jaExiste: null });
  });

  it("espaço, quebra de linha e caixa somem: 64 caracteres copiados de um chat chegam quebrados", () => {
    const colado = `  ${OUTRA.slice(0, 32).toUpperCase()}\n${OUTRA.slice(32)}  `;
    expect(lerChaveDeIdentidade(colado, vazio)).toEqual({ ok: true, peerKey: OUTRA, jaExiste: null });
  });

  it("o que MUDA o valor é recusado: prefixo, comprimento errado e caractere fora do hex", () => {
    for (const ruim of [`0x${OUTRA}`, OUTRA.slice(0, 63), `${OUTRA}0`, OUTRA.replace("b", "z")]) {
      expect(lerChaveDeIdentidade(ruim, vazio).ok).toBe(false);
    }
  });

  it("a rota de deep link NÃO é aceita por antecipação: a gramática de §3.5 é fechada e é B64", () => {
    expect(lerChaveDeIdentidade(`comunidadep2p://u/${OUTRA}`, vazio).ok).toBe(false);
  });

  it("campo vazio pede a chave em vez de reclamar do formato", () => {
    const r = lerChaveDeIdentidade("   ", vazio);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toContain("Cole a chave");
  });

  it("a própria chave é recusada — §31.2 regra 5: `lo = hi` não é conversa", () => {
    const r = lerChaveDeIdentidade(EU, vazio);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toBe("Esta é a sua própria chave.");
  });

  it("sem identidade carregada, nada é afirmado sobre ser a própria chave", () => {
    expect(lerChaveDeIdentidade(EU, { euHex: null, conversas: [] }).ok).toBe(true);
  });

  it("chave de quem já está na lista devolve a conversa existente — `dm.open` é derivado (§31.2 r. 1)", () => {
    const r = lerChaveDeIdentidade(OUTRA.toUpperCase(), {
      euHex: EU,
      conversas: [{ conversationId: "conv-1", peer: { key: OUTRA } }],
    });
    // Sem isto a tela diria "pedido enviado" para uma conversa que já tem histórico.
    expect(r).toEqual({ ok: true, peerKey: OUTRA, jaExiste: "conv-1" });
  });
});

describe("§31.9 regra 5 — o custo da política de contato aparece na UI", () => {
  it("o texto fala da política DESTA máquina e não afirma nada sobre a do outro lado", () => {
    // Afirmar a política do destinatário seria inventar o fato que L-28 recusa dar: o
    // pedido recusado por política e o pedido recusado por bloqueio são o mesmo silêncio.
    for (const proibido of ["ele ", "ela ", "a outra pessoa não", "bloqueou"]) {
      expect(TEXTO_POLITICA_RESTRITA.toLowerCase()).not.toContain(proibido);
    }
    expect(TEXTO_POLITICA_RESTRITA).toContain("impede que pessoas de fora abram uma com você");
  });

  it("L-24 — o texto de abrir conversa diz que não há busca, porque não pode haver", () => {
    expect(TEXTO_NOVA_CONVERSA).toContain("não há busca nem diretório");
  });
});
