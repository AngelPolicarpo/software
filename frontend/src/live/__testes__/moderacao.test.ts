/**
 * Leituras de moderação de §15.6 no lado do renderer.
 *
 * O que se afirma: as três consultas (`query.auditLog`/`query.bans`/`query.timeouts`)
 * enchem o espelho da store com rótulos e chaves do fio; `E_PERMISSION_DENIED` nas
 * três vira ESTADO (`semPermissao`) — a tela diz o que falta em vez de fingir que
 * nada aconteceu —; timeout expirado fica fora da lista de vigentes (é história, não
 * estado); e um tipo de auditoria desconhecido (host mais novo) não derruba a tela.
 * Verificado por mutação: trocar `every` por `some` na detecção de permissão derruba
 * o caso misto; remover o filtro de expirados derruba o caso correspondente.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcCommandError } from "../../ipc/frames";
import type { AuditItem, BanItem, TimeoutItem, UserRef } from "../../ipc/dto";

const api = vi.hoisted(() => ({
  auditLog: vi.fn<() => Promise<unknown>>(),
  bans: vi.fn<() => Promise<unknown>>(),
  timeouts: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("../../ipc/api", () => ({
  api,
  cliente: { subscribe: vi.fn(), onResync: vi.fn(), handleCoreEpoch: vi.fn() },
}));

vi.mock("../sessao", () => ({ registrarResync: vi.fn(), useSessao: { getState: () => ({ estado: "inicial", iniciar: vi.fn() }) } }));
vi.mock("../../store/downloadStore", () => ({ useDownloadStore: { getState: () => ({}) } }));

import { sincronizarModeracao } from "../sincronizacao";
import { useModerationStore } from "../../store/moderationStore";

const COM = "c1";

function ref(key: string, displayName: string): UserRef {
  return { key, displayName, handle: displayName.toLowerCase(), avatarColor: "blue", collision: false };
}
const AGORA = 1_700_000_000_000;

function audit(parcial: Partial<AuditItem>): AuditItem {
  return {
    id: "a1",
    seq: 9,
    type: "ban",
    targetKey: "aa".repeat(32),
    targetLabel: "Márcia",
    by: ref("bb".repeat(32), "Host"),
    byLabel: "Host",
    at: AGORA,
    ...parcial,
  };
}

function ban(parcial: Partial<BanItem>): BanItem {
  return {
    target: ref("aa".repeat(32), "Márcia"),
    by: ref("bb".repeat(32), "Host"),
    at: AGORA,
    ...parcial,
  };
}

function timeoutDto(parcial: Partial<TimeoutItem>): TimeoutItem {
  return {
    target: ref("cc".repeat(32), "Jorge"),
    by: ref("bb".repeat(32), "Host"),
    at: AGORA,
    until: AGORA + 60_000,
    expired: false,
    ...parcial,
  };
}

function negado(): Error {
  return new IpcCommandError({ code: "E_PERMISSION_DENIED", message: "sem permissão" });
}

beforeEach(() => {
  vi.clearAllMocks();
  useModerationStore.setState({ auditLog: [], bans: [], timeouts: [], semPermissao: false });
});

describe("sincronizarModeracao — as três leituras de §15.6", () => {
  it("enche o espelho com auditoria, banidos vivos e timeouts vigentes", async () => {
    api.auditLog.mockResolvedValue({ items: [audit({ id: "a1" }), audit({ id: "a2", type: "createRole", targetId: "role-1", targetKey: undefined, targetLabel: "Moderador" })] });
    api.bans.mockResolvedValue({ items: [ban({})] });
    api.timeouts.mockResolvedValue({ items: [timeoutDto({}), timeoutDto({ expired: true, until: AGORA - 1, target: ref("dd".repeat(32), "Velho") })] });

    await sincronizarModeracao(COM);

    const s = useModerationStore.getState();
    expect(s.semPermissao).toBe(false);
    expect(s.auditLog).toHaveLength(2);
    expect(s.auditLog[0]).toMatchObject({ communityId: COM, type: "ban", authorLabel: "Host", authorId: "bb".repeat(32) });
    // Alvo não-pessoa (cargo): `targetId` no fio, rótulo congelado no domínio.
    expect(s.auditLog[1]).toMatchObject({ type: "createRole", targetId: "role-1", targetLabel: "Moderador" });
    expect(s.bans).toHaveLength(1);
    expect(s.bans[0]).toMatchObject({ identityId: "aa".repeat(32), label: "Márcia" });
    // O expirado NÃO entra: vigente é um só.
    expect(s.timeouts).toHaveLength(1);
    expect(s.timeouts[0]).toMatchObject({ label: "Jorge" });
  });

  it("recusa E_PERMISSION_DENIED nas três é estado nomeado, não silêncio", async () => {
    api.auditLog.mockRejectedValue(negado());
    api.bans.mockRejectedValue(negado());
    api.timeouts.mockRejectedValue(negado());

    await sincronizarModeracao(COM);

    const s = useModerationStore.getState();
    expect(s.semPermissao).toBe(true);
    expect(s.auditLog).toEqual([]);
    expect(s.bans).toEqual([]);
  });

  it("falha parcial preserva o que veio e não marca sem permissão", async () => {
    useModerationStore.getState().aplicarRemoto({
      auditLog: [{ id: "antiga", communityId: COM, type: "ban", targetId: "x", targetLabel: "X", authorId: "y", timestamp: "" }],
      bans: [],
      timeouts: [],
      semPermissao: false,
    });
    api.auditLog.mockRejectedValue(negado());
    api.bans.mockResolvedValue({ items: [] });
    api.timeouts.mockRejectedValue(new Error("E_HOST_UNAVAILABLE"));

    await sincronizarModeracao(COM);

    const s = useModerationStore.getState();
    expect(s.semPermissao).toBe(false);
    // O que já estava no espelho não é apagado por falha parcial.
    expect(s.auditLog).toHaveLength(1);
  });

  it("tipo de auditoria desconhecido (host mais novo) passa pelo espelho sem derrubar", async () => {
    api.auditLog.mockResolvedValue({ items: [audit({ type: "algoNovoDoFuturo" as never })] });
    api.bans.mockResolvedValue({ items: [] });
    api.timeouts.mockResolvedValue({ items: [] });

    await sincronizarModeracao(COM);
    expect(useModerationStore.getState().auditLog).toHaveLength(1);
  });
});
