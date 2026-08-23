/**
 * Contrato: o cliente do renderer contra o **roteador real** do núcleo (§15.1, §15.4, §15.6).
 *
 * Os outros testes deste diretório falam com uma porta falsa: provam que o cliente cumpre o
 * protocolo, não que a UI chama os comandos **certo**. A diferença não é acadêmica — foi
 * exatamente aí que passou o defeito de cor: §6.4.2 manda `u8` em material assinado, a UI
 * mandava `"role-blue"`, e nenhum dos 20 testes de transporte tinha como notar, porque a
 * porta falsa aceita qualquer coisa.
 *
 * O que se afirma aqui: **para cada comando que a UI usa, o argumento que a UI monta
 * atravessa a fronteira sem ser recusado por forma**. As dependências são um esboço que
 * recusa tudo, então nada tem efeito; o critério é o código do erro. `E_VALIDATION`,
 * `E_MALFORMED` e `E_UNKNOWN_COMMAND` significam "a fronteira recusou o que você mandou";
 * qualquer outro desfecho significa que o argumento chegou ao domínio.
 *
 * **O alcance é menor do que parece, e isso precisa estar escrito.** A validação de tipo não
 * mora toda no roteador: 55 pontos de `commands.ts` recusam com `E_VALIDATION` ali mesmo,
 * mas comandos como `identity.create` apenas encaminham `arg['avatarColor']` e quem confere
 * o tipo é a composição — que aqui é esboço. Para esses, o teste prova que o argumento
 * *chega*, não que ele é aceito. Foi por isso que o defeito de cor sobreviveu em
 * `identity.create` e não em `role.create`: só o segundo é validado na fronteira. Fechar a
 * outra metade exige compor as portas reais, e está registrado como pendência.
 *
 * **Custo declarado:** este arquivo importa `core/dist`, então `npm test` no frontend exige
 * o núcleo compilado (`cd core && npm run build`). É acoplamento de teste, não de bundle: o
 * Vite continua sem saber que o núcleo existe, e nada disto entra no produto.
 */

import { beforeAll, describe, expect, it } from "vitest";
// O núcleo não emite `.d.ts`, e ligar `declaration` mudaria o build dele por causa de um
// teste do renderer. Os dois valores entram sem tipo de propósito: importar os tipos de L3
// reintroduziria pelo TIPO o acoplamento que §58.1 evitou pelo VALOR — o contrato
// compartilhado é o quadro de §15.1, não a classe do núcleo. O teste os converte na hora.
// @ts-expect-error — JS sem declaração, por decisão.
import { IpcServer } from "../../../../core/dist/src/l3/ipcRenderer/index.js";
// @ts-expect-error — idem.
import { registerCoreCommands } from "../../../../core/dist/src/l3/ipcRenderer/commands.js";
import { api, cliente } from "../../ipc/api";
import { CATALOGO } from "../../ipc/cores";
import type { RendererPort } from "../../ipc/frames";

/** Códigos que significam "a fronteira recusou a forma do que você mandou". */
const RECUSA_DE_FORMA = new Set(["E_VALIDATION", "E_MALFORMED", "E_UNKNOWN_COMMAND"]);

const COMUNIDADE = "ab".repeat(32);
const CHAVE = "cd".repeat(32);
const MSG = "msg-1";

/**
 * Esboço recursivo das dependências. Qualquer acesso devolve algo chamável; qualquer chamada
 * recusa com um código próprio. É o suficiente para o argumento atravessar a validação da
 * fronteira e parar logo depois dela, que é onde este teste quer olhar.
 */
function esboco(): unknown {
  const alvo = function () {
    throw Object.assign(new Error("esboço"), { code: "E_ESBOCO" });
  };
  return new Proxy(alvo, {
    get: (_a, prop) => (prop === "then" ? undefined : esboco()),
    apply: () => {
      throw Object.assign(new Error("esboço"), { code: "E_ESBOCO" });
    },
  });
}

/** Par de portas ligando o `IpcPort` do núcleo ao `RendererPort` do renderer. */
function parDePortas(): { nucleo: { postMessage(f: unknown): void; onMessage(l: (f: unknown) => void): void }; renderer: RendererPort } {
  const paraRenderer: Array<(ev: { data: unknown }) => void> = [];
  const paraNucleo: Array<(f: unknown) => void> = [];
  return {
    nucleo: {
      postMessage: (f) => queueMicrotask(() => paraRenderer.forEach((l) => l({ data: f }))),
      onMessage: (l) => paraNucleo.push(l),
    },
    renderer: {
      postMessage: (f) => queueMicrotask(() => paraNucleo.forEach((l) => l(f))),
      addEventListener: (_t, l) => paraRenderer.push(l),
      start: () => undefined,
    },
  };
}

beforeAll(() => {
  const portas = parDePortas();
  const server = new (IpcServer as unknown as new (o: unknown) => { sendHello(): void })({
    epoch: 1,
    port: portas.nucleo,
    // O token é sempre válido aqui: a confirmação nativa é do main, e não é o que se mede.
    tokenVerifier: { consume: () => true },
    identityStatus: { isLoaded: true },
    buildChannel: "prod",
  });
  (registerCoreCommands as unknown as (s: unknown, d: unknown) => void)(server, esboco());

  // `main-confirmed` passa pelo `window.electron` do preload; aqui ele é um duplo.
  (globalThis as unknown as { window: unknown }).window = {
    electron: { requestAuthToken: async () => ({ ok: true, token: "tok" }) },
  };

  cliente.attach(portas.renderer);
  server.sendHello();
});

/** Executa e devolve o código do desfecho — `null` quando deu certo. */
async function codigo(chamada: () => Promise<unknown>): Promise<string | null> {
  try {
    await chamada();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "E_SEM_CODIGO";
  }
}

/** Cada entrada é um comando que a UI usa, com o argumento que a UI monta. */
const CHAMADAS: Array<[string, () => Promise<unknown>]> = [
  ["core.status", () => api.coreStatus()],
  ["query.identity", () => api.identity()],
  ["identity.create", () => api.identityCreate({ displayName: "Ana", avatarColor: 1 })],
  ["identity.update", () => api.identityUpdate({ displayName: "Ana", avatarColor: 2 })],
  ["identity.setPresence", () => api.identitySetPresence("online")],
  ["identity.import", () => api.identityImport({ passphrase: "x".repeat(12) })],
  ["identity.export", () => api.identityExport("x".repeat(12))],
  ["identity.wipe", () => api.identityWipe()],
  ["query.communities", () => api.communities()],
  ["query.community", () => api.community(COMUNIDADE)],
  ["query.structure", () => api.structure(COMUNIDADE)],
  ["query.messages", () => api.messages({ communityId: COMUNIDADE, channelId: "ch", limit: 50, direction: "before" })],
  ["query.message", () => api.message({ communityId: COMUNIDADE, messageId: MSG })],
  ["query.thread", () => api.thread({ communityId: COMUNIDADE, threadId: "th" })],
  ["query.pinned", () => api.pinned({ communityId: COMUNIDADE, channelId: "ch" })],
  ["query.files", () => api.files({ communityId: COMUNIDADE, channelId: "ch" })],
  ["query.links", () => api.links({ communityId: COMUNIDADE, channelId: "ch" })],
  ["query.reactors", () => api.reactors({ communityId: COMUNIDADE, messageId: MSG, emoji: "👍" })],
  ["query.members", () => api.members({ communityId: COMUNIDADE })],
  ["query.members (filtrado)", () => api.membersFiltrados({ communityId: COMUNIDADE, filter: { query: "an" }, limit: 100 })],
  ["query.member", () => api.member({ communityId: COMUNIDADE, identityKey: CHAVE })],
  ["query.roles", () => api.roles(COMUNIDADE)],
  ["query.bans", () => api.bans({ communityId: COMUNIDADE })],
  ["query.timeouts", () => api.timeouts({ communityId: COMUNIDADE })],
  ["query.auditLog", () => api.auditLog({ communityId: COMUNIDADE })],
  ["query.invites", () => api.invites(COMUNIDADE)],
  ["query.outbox", () => api.outbox(COMUNIDADE)],
  ["query.preferences", () => api.preferences()],
  ["query.hostStatus", () => api.hostStatus(COMUNIDADE)],
  ["query.selfModeration", () => api.selfModeration(COMUNIDADE)],
  ["query.resolveMessageLink", () => api.resolveMessageLink("A".repeat(86))],
  ["query.search", () => api.search({ communityId: COMUNIDADE, query: "teste" })],
  ["message.send", () => api.messageSend({ communityId: COMUNIDADE, channelId: "ch", content: "oi", clientRef: "cr" })],
  ["message.edit", () => api.messageEdit({ communityId: COMUNIDADE, messageId: MSG, content: "oi" })],
  ["message.delete", () => api.messageDelete({ communityId: COMUNIDADE, messageId: MSG })],
  ["message.pin", () => api.messagePin({ communityId: COMUNIDADE, messageId: MSG, pinned: true })],
  ["message.react", () => api.messageReact({ communityId: COMUNIDADE, messageId: MSG, emoji: "👍", present: true })],
  ["thread.create", () => api.threadCreate({ communityId: COMUNIDADE, rootMessageId: MSG })],
  ["message.retry", () => api.messageRetry("op-1")],
  ["message.cancelQueued", () => api.messageCancelQueued("op-1")],
  ["channel.markRead", () => api.channelMarkRead({ communityId: COMUNIDADE, channelId: "ch" })],
  ["thread.markRead", () => api.threadMarkRead({ communityId: COMUNIDADE, threadId: "th" })],
  ["channel.subscribeTyping", () => api.channelSubscribeTyping({ communityId: COMUNIDADE, channelId: "ch", on: true })],
  ["channel.setMuted", () => api.channelSetMuted({ communityId: COMUNIDADE, channelId: "ch", muted: true })],
  ["category.setCollapsed", () => api.categorySetCollapsed({ communityId: COMUNIDADE, categoryId: "cat", collapsed: true })],
  ["nav.setActive", () => api.navSetActive({ communityId: COMUNIDADE, channelId: "ch" })],
  ["settings.setDevice", () => api.settingsSetDevice({ kind: "microphone", deviceId: "dev" })],
  ["settings.setVolume", () => api.settingsSetVolume({ kind: "input", value: 80 })],
  ["settings.setNotifications", () => api.settingsSetNotifications({ enabled: true })],
  ["community.create", () => api.communityCreate({ name: "Nova", iconColor: 1 })],
  ["community.update", () => api.communityUpdate({ communityId: COMUNIDADE, name: "N", iconColor: 2 })],
  ["community.activate", () => api.communityActivate(COMUNIDADE)],
  ["community.activate (null)", () => api.communityActivate(null)],
  ["community.leave", () => api.communityLeave(COMUNIDADE)],
  ["community.end", () => api.communityEnd({ communityId: COMUNIDADE, reason: "fim" })],
  ["community.forget", () => api.communityForget(COMUNIDADE)],
  ["community.assumeHost", () => api.communityAssumeHost(COMUNIDADE)],
  ["community.setSuccessors", () => api.communitySetSuccessors({ communityId: COMUNIDADE, successorKeys: [CHAVE] })],
  ["channel.create", () => api.channelCreate({ communityId: COMUNIDADE, categoryId: "cat", type: 0, name: "geral" })],
  ["channel.update", () => api.channelUpdate({ communityId: COMUNIDADE, channelId: "ch", name: "geral" })],
  ["channel.move", () => api.channelMove({ communityId: COMUNIDADE, channelId: "ch", categoryId: "cat" })],
  ["channel.delete", () => api.channelDelete({ communityId: COMUNIDADE, channelId: "ch" })],
  ["category.create", () => api.categoryCreate({ communityId: COMUNIDADE, name: "Geral" })],
  ["category.rename", () => api.categoryRename({ communityId: COMUNIDADE, categoryId: "cat", name: "Geral" })],
  ["category.delete", () => api.categoryDelete({ communityId: COMUNIDADE, categoryId: "cat", deleteChannels: true })],
  ["role.create", () => api.roleCreate({ communityId: COMUNIDADE, name: "Mod", color: 6, permissions: ["kick_members"], mentionable: false })],
  ["role.update", () => api.roleUpdate({ communityId: COMUNIDADE, roleId: "r1", color: 3 })],
  ["role.move", () => api.roleMove({ communityId: COMUNIDADE, roleId: "r1", afterRoleId: "r2" })],
  ["role.delete", () => api.roleDelete({ communityId: COMUNIDADE, roleId: "r1" })],
  ["member.setRoles", () => api.memberSetRoles({ communityId: COMUNIDADE, targetKey: CHAVE, roleIds: ["r1"] })],
  ["member.setNickname", () => api.memberSetNickname({ communityId: COMUNIDADE, nickname: "Aninha" })],
  ["mod.kick", () => api.modKick({ communityId: COMUNIDADE, targetKey: CHAVE, reason: "spam" })],
  ["mod.ban", () => api.modBan({ communityId: COMUNIDADE, targetKey: CHAVE })],
  ["mod.revokeBan", () => api.modRevokeBan({ communityId: COMUNIDADE, targetKey: CHAVE })],
  ["mod.timeout", () => api.modTimeout({ communityId: COMUNIDADE, targetKey: CHAVE, until: Date.now() + 3600_000 })],
  ["mod.removeTimeout", () => api.modRemoveTimeout({ communityId: COMUNIDADE, targetKey: CHAVE })],
  ["invite.create", () => api.inviteCreate({ communityId: COMUNIDADE, maxUses: 5 })],
  ["invite.revoke", () => api.inviteRevoke({ communityId: COMUNIDADE, invitePublicKey: CHAVE })],
  ["invite.resolve", () => api.inviteResolve("0123456789ABCDEF")],
  ["invite.redeem", () => api.inviteRedeem({ codeOrLink: "0123456789ABCDEF" })],
  ["file.pickForAttachment", () => api.filePickForAttachment(COMUNIDADE)],
  ["blob.stage", () => api.blobStage("ticket-1")],
  [
    "blob.download",
    () => api.blobDownload({ communityId: COMUNIDADE, blobsCoreKey: CHAVE, blobId: { byteOffset: 0, blockOffset: 0, blockLength: 1, byteLength: 10 } }),
  ],
  ["blob.cancel", () => api.blobCancel({ blobsCoreKey: CHAVE, blobId: { byteOffset: 0, blockOffset: 0, blockLength: 1, byteLength: 10 } })],
  ["host.exitImpact", () => api.hostExitImpact()],
  ["diag.run", () => api.diagRun()],
  ["diag.snapshot", () => api.diagSnapshot()],
  ["core.reproject", () => api.coreReproject()],
  ["core.shutdown", () => api.coreShutdown()],
];

describe("o roteador real aceita a forma dos argumentos que a UI monta", () => {
  for (const [nome, chamada] of CHAMADAS) {
    it(nome, async () => {
      const c = await codigo(chamada);
      expect(c === null || !RECUSA_DE_FORMA.has(c), `${nome} recusado na fronteira com ${c}`).toBe(true);
    });
  }
});

describe("o teste tem dente", () => {
  it("cor como string em `role.create` é recusada — o defeito que motivou este arquivo", async () => {
    const c = await codigo(() =>
      api.roleCreate({
        communityId: COMUNIDADE,
        name: "Mod",
        // @ts-expect-error — o erro que o tipo agora impede e que o roteador recusava.
        color: "role-neutral",
        permissions: [],
        mentionable: false,
      }),
    );
    expect(c).toBe("E_VALIDATION");
  });

  it("`mentionable` fora do tipo também é recusado na fronteira", async () => {
    const c = await codigo(() =>
      // @ts-expect-error — mesma classe de erro, outro campo.
      api.roleCreate({ communityId: COMUNIDADE, name: "Mod", color: 1, permissions: [], mentionable: "sim" }),
    );
    expect(c).toBe("E_VALIDATION");
  });

  it("a FAIXA de §6.4.2 não é do roteador: 8 passa a fronteira e quem recusa é o fold", async () => {
    // Registrar isto é o ponto: a fronteira confere o tipo, o `fold` confere o valor. Um
    // teste que afirmasse "8 é recusado aqui" estaria descrevendo um núcleo que não existe.
    const c = await codigo(() =>
      api.roleCreate({ communityId: COMUNIDADE, name: "X", color: CATALOGO.length, permissions: [], mentionable: false }),
    );
    expect(c).toBe("E_ESBOCO");
  });

  it("comando inexistente é `E_UNKNOWN_COMMAND`", async () => {
    expect(await codigo(() => cliente.request("nao.existe", {}))).toBe("E_UNKNOWN_COMMAND");
  });
});
