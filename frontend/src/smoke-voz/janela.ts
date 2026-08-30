/**
 * Driver do renderer para o smoke de voz de duas pontas (B45) — `app/scripts/smoke-voz.*`.
 *
 * **O que aqui é REAL: a malha inteira.** A `MalhaDeVoz` é a do produto (`live/voz.ts`) —
 * tickets, anti-glare, repetição de oferta, limpeza de reentrada, ICE restart — sobre o
 * cliente IPC-R real (`ipc/client.ts`) e os comandos reais de §15.4 (`ipc/api.ts`), contra o
 * utility REAL do produto (`dist/utility/index.js`). O `RTCPeerConnection` é o do Chromium.
 * O que é de mentira: o main (sem UI do produto) e o dispositivo de áudio
 * (`--use-fake-device-for-media-stream`).
 *
 * Como no produto, a página é a dona da porta IPC-R: TODO comando (setup e voz) sai daqui.
 * O main comanda a ORDEM por `ipcRenderer` e as marcações de veredito voltam por ele.
 *
 * Este arquivo NÃO entra no bundle do produto: nada do app importa `src/smoke-voz/` — o
 * build dele é separado (`vite.smoke-voz.config.ts`), disparado pelo próprio smoke.
 */
import { MalhaDeVoz } from "../live/voz";
import { api, cliente } from "../ipc/api";
import type { RendererPort } from "../ipc/frames";

const papel = new URLSearchParams(location.search).get("papel") ?? "A";
const rotulo = (marca: string, valor: unknown = "") =>
  console.log(`SMOKE_VOZ:${papel}:${marca}=${valor}`);

/**
 * A forma ESTRUTURAL do `ipcRenderer` — só o que este driver usa. O `@types/electron` não
 * entra no tsconfig do renderer (o produto não fala com o `ipcRenderer` direto: quem faz a
 * ponte é o preload), e arrastá-lo para cá pelo namespace global obrigaria o build do
 * produto a conhecer o Electron por causa de um smoke.
 */
interface CanalDoMain {
  on(canal: string, ouvinte: (ev: { ports: readonly MessagePort[] }, ...args: never[]) => void): void;
  on(canal: string, ouvinte: (ev: unknown, m: OpDoMain) => void): void;
  send(canal: string, ...args: unknown[]): void;
}

interface OpDoMain {
  readonly id: number;
  readonly op: string;
  readonly arg?: Record<string, unknown>;
}

const { ipcRenderer } = (window as unknown as {
  require: (m: string) => { ipcRenderer: CanalDoMain };
}).require("electron");

// ─── A malha real ───────────────────────────────────────────────────────────────────────

const pcsVivos: RTCPeerConnection[] = [];
let pcsCriados = 0;

const midia = {
  capturar: async (deviceId: string) =>
    await navigator.mediaDevices.getUserMedia({
      audio: deviceId === "default" ? true : { deviceId: { exact: deviceId } },
    }),
  conexao: (config: RTCConfiguration) => {
    pcsCriados++;
    const pc = new RTCPeerConnection(config);
    pcsVivos.push(pc);
    return pc;
  },
};

const malha = new MalhaDeVoz(
  {
    join: (a) => api.voiceJoin(a),
    leave: () => api.voiceLeave(),
    signal: (a) => api.voiceSignal(a),
  },
  midia,
  {
    aoMudarPar: (peerHex, estado) => rotulo(`PAR_${estado.toUpperCase()}`, peerHex.slice(0, 8)),
    aoChegarAudio: (peerHex, stream) => tocar(peerHex, stream),
    aoFalhar: (motivo) => rotulo("AOFALHAR", motivo),
    aoSair: () => rotulo("SAIU"),
  },
);

/** O `<audio>` por par — o caminho do produto (`sincronizacao.tocar`), sem `<audio>` inventado. */
function tocar(peerHex: string, stream: MediaStream): void {
  const el = new Audio();
  el.autoplay = true;
  el.srcObject = stream;
  el.dataset.peer = peerHex;
  void el.play().catch(() => undefined);
}

let ultimaIdentidade: string | null = null;

/** Entrar de verdade: o `voice.join` de §15.4 e a malha abrindo contra o roster real. */
async function entrar(communityId: string, channelId: string): Promise<void> {
  if (ultimaIdentidade === null) {
    const ident = await cliente.request("query.identity");
    // §15.6 — `IdentityDto.key` É a chave pública hex que o §15.4 chama de `euHex`
    // (`adaptadores.identidade`: `id: d.key`).
    ultimaIdentidade = (ident as { key?: string }).key ?? null;
  }
  if (ultimaIdentidade === null) throw new Error("sem identidade local");
  await malha.entrar({
    communityId,
    channelId,
    euHex: ultimaIdentidade,
    microfoneId: "default",
    agora: Date.now(),
  });
}

/**
 * Estado ESTRUTURAL da malha nesta ponta. `conectados` lê o `connectionState` real dos
 * PCs: é o que o main usa como veredito de "a chamada fechou" — e o que prova que trocar
 * de canal e reentrar não deixam conexão velha para trás (B45/§97).
 */
function estado(): { pares: number; pcs: number; conectados: number } {
  return {
    pares: malha.pares().length,
    pcs: pcsCriados,
    conectados: pcsVivos.filter((pc) => pc.connectionState === "connected").length,
  };
}

/**
 * Bytes de áudio RECEBIDOS somados sobre os PCs vivos, medidos num intervalo. É o oráculo
 * de "a mídia realmente flui": negociação fechada sem mídia não contam — `inbound-rtp`
 * com bytes crescendo é o som do outro lado chegando (DTLS decifrado, Opus decodado).
 */
async function medirFluxo(): Promise<number> {
  const somar = async (): Promise<number> => {
    let total = 0;
    for (const pc of pcsVivos) {
      if (pc.connectionState !== "connected") continue;
      const relatorio = await pc.getStats();
      relatorio.forEach((s) => {
        const r = s as RTCStats & { type?: string; kind?: string; bytesReceived?: number };
        if (r.type === "inbound-rtp" && r.kind === "audio") total += r.bytesReceived ?? 0;
      });
    }
    return total;
  };
  const antes = await somar();
  await new Promise((r) => setTimeout(r, 3_000));
  const depois = await somar();
  return Math.max(0, depois - antes);
}

// ─── A porta IPC-R e o despacho de operações que o main pede ────────────────────────────

async function executar(op: string, a: Record<string, unknown>): Promise<unknown> {
  switch (op) {
    case "cmd":
      return await cliente.request(a.cmd as string, a.arg);
    case "voz.entrar":
      await entrar(a.communityId as string, a.channelId as string);
      return estado();
    case "voz.estado":
      return estado();
    case "voz.medirFluxo":
      return { bytes: await medirFluxo() };
    default:
      throw new Error(`op desconhecida: ${op}`);
  }
}


/**
 * Os eventos de §15.5 que ALIMENTAM a malha. Sem eles a `MalhaDeVoz` é surda: o `voice.join`
 * responde o roster do instante da entrada, mas quem chega depois só existe no `voice.roster`,
 * a oferta do outro lado só chega por `voice.signal` e sem `voice.tickets` o passo 4 de §17.4
 * recusa abrir a conexão. É a mesma ligação que `sincronizacao.configurarVoz` faz no produto —
 * recortada ao que a malha consome, porque aqui não há store nem tela para atualizar.
 *
 * Assinar depois do `hello` é de propósito: antes dele o cliente ainda não tem época, e é o
 * `attach`/`hello` que define a porta sobre a qual o `sub` viaja.
 */
function assinarVoz(): void {
  cliente.subscribe("voice.roster", (d) => {
    const dado = d as { participants?: Array<{ keyHex: string }> };
    if (!Array.isArray(dado.participants)) return;
    rotulo("ROSTER", dado.participants.map((p) => p.keyHex.slice(0, 8)).join(","));
    malha.aplicarRoster(dado.participants);
  });

  cliente.subscribe("voice.signal", (d) => {
    malha
      .aplicarSinal(d as { peerKey: string; ticketId: string; sdp?: string; ice?: string })
      .catch((e) => rotulo("SINAL_RECUSADO", (e as { code?: string })?.code ?? String(e)));
  });

  cliente.subscribe("voice.tickets", (d) => {
    const dado = d as {
      tickets?: Parameters<typeof malha.aplicarTickets>[0];
      iceServers?: RTCIceServer[];
    };
    if (Array.isArray(dado.tickets)) {
      rotulo("TICKETS", dado.tickets.length);
      malha.aplicarTickets(dado.tickets, Date.now());
    }
    if (Array.isArray(dado.iceServers)) malha.aplicarIceServers(dado.iceServers);
  });

  // §97.1 — a revogação da sessão ANTIGA chega para quem acabou de entrar na NOVA. O recorte
  // por sessão é a correção que este smoke exercita na troca de canal; sem ele, o eco da
  // sessão velha derrubaria a chamada recém-aberta.
  cliente.subscribe("voice.revoked", (d) => {
    const dado = d as { targetKey?: string; sessionId?: string };
    if (dado.sessionId !== undefined && malha.sessionId !== dado.sessionId) return;
    if (malha.entrando) return;
    if (malha.sessionId === null) return;
    const alvo = dado.targetKey?.toLowerCase();
    if (alvo !== undefined && ultimaIdentidade !== null && alvo !== ultimaIdentidade.toLowerCase()) {
      malha.aplicarRoster(malha.pares().filter((p) => p.toLowerCase() !== alvo).map((keyHex) => ({ keyHex })));
      return;
    }
    rotulo("REVOGADA");
    void malha.sair().catch((e) => rotulo("SAIR_FALHOU", String(e)));
  });

  cliente.subscribe("voice.failed", (d) => {
    const dado = d as { reason?: string; sessionId?: string };
    if (dado.sessionId !== undefined && malha.sessionId !== dado.sessionId) return;
    if (dado.sessionId !== undefined && malha.entrando) return;
    rotulo("FALHOU", dado.reason ?? "sem motivo");
    void malha.sair().catch((e) => rotulo("SAIR_FALHOU", String(e)));
  });
}

/**
 * A porta IPC-R chega transferida do main — por `webContents.postMessage`, que no produto o
 * preload repassa ao `window` (bridge.ts). Aqui não há preload: quem recebe o canal é o
 * `ipcRenderer` desta página (nodeIntegration), e a porta que vem em `event.ports` é a
 * mesma `MessagePort` padrão que o `cliente.attach` consome.
 */
ipcRenderer.on("voz-port", (ev) => {
  const porta = ev.ports[0];
  if (porta === undefined) return;
  void ligar(porta);
});

async function ligar(porta: MessagePort): Promise<void> {
  cliente.attach(porta as unknown as RendererPort);
  const hello = await cliente.waitForHello(30_000);
  rotulo("PRONTO", `epoch=${hello.epoch} core=${hello.coreVersion.slice(0, 8)}`);
  assinarVoz();

  ipcRenderer.on(`voz-op-${papel}`, async (_e: unknown, m: OpDoMain) => {
    try {
      const r = await executar(m.op, m.arg ?? {});
      ipcRenderer.send(`voz-resp-${papel}`, { id: m.id, r });
    } catch (err) {
      const code = (err as { code?: string }).code;
      ipcRenderer.send(`voz-resp-${papel}`, { id: m.id, erro: code ?? (err as Error).message });
    }
  });

  // O main só transfere a porta quando a página avisa que está escutando — uma corrida
  // a menos para um smoke que tem de rodar igualzinho no CI.
  ipcRenderer.send("voz-pronto", papel);
  rotulo("OUVINDO");
}

rotulo("PAGINA_VIVA");
ipcRenderer.send("voz-pagina-pronta", papel);
