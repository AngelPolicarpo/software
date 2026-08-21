// Emulador de NAT user-space (POC-08) — RFC 4787: mapeamento e filtragem dos três
// comportamentos clássicos + injeção de atraso/perda por direção.
//
// Sem sudo neste ambiente não há netns/iptables: a caixa interpõe-se entre o par e o
// servidor (STUN/TURN do host) — o par aponta explicitamente para a interface interna,
// e cada mapeamento ganha uma SOCKET EXTERNA REAL (porta pública própria, observável
// no XOR-MAPPED-ADDRESS). Limitação declarada no artefato: checagens de conectividade
// P2P puras entre dois NATs não atravessam as duas caixas (sem interceptação de kernel);
// os combos usam o caminho que §17.3 garante — direto sem NAT, TURN do host nos demais.

import dgram from 'node:dgram';

export type NatModel = 'full-cone' | 'port-restricted' | 'symmetric';

export interface NatOptions {
  lossPct?: number; // por direção, 0–100
  delayMs?: number; // atraso médio por direção (jitter ±25%)
}

interface Mapping {
  socket: dgram.Socket; // interface externa REAL deste mapeamento
  extPort: number;
  dst: string; // host:port do destino desta entrada (para filtro EDF)
}

export class NatBox {
  readonly internal: dgram.Socket; // lado do par: é este endereço que o par usa como STUN/TURN
  readonly #model: NatModel;
  // perda ajustável em runtime: conecta sem perda e degrada na fase de mídia
  // (modelo "chamada estabelecida, rede piora" — §17.5/share.health)
  #lossPct = 0;
  readonly #delayMs: number;
  readonly #mappings = new Map<string, Mapping>(); // EIM: intPort | EDM: intPort|dst
  #serverAddr: { host: string; port: number } | null = null;
  // um par por caixa neste harness, mas o endereço é aprendido por porta interna
  // para não misturar respostas se mais de uma origem usar a interface interna
  readonly #peerAddrByIntPort = new Map<number, { host: string; port: number }>();
  #closed = false;

  constructor(model: NatModel, opts: NatOptions = {}) {
    this.#model = model;
    this.#delayMs = opts.delayMs ?? 0;
    this.internal = dgram.createSocket('udp4');
  }

  /** Degradação pós-estabelecimento: liga a perda injetada nas duas direções. */
  setLossPct(pct: number): void {
    this.#lossPct = pct;
  }

  async bind(serverAddr: { host: string; port: number }): Promise<number> {
    this.#serverAddr = { ...serverAddr };
    await new Promise<void>((res) => this.internal.bind({ address: '127.0.0.1', port: 0 }, res));
    this.internal.on('message', (msg, rinfo) => this.#onInternal(msg, rinfo));
    return this.internal.address().port;
  }

  /** Porta pública observável pelo servidor para um dado fluxo (EIM vs EDM). */
  async publicAddressFor(intPort: number, dstHost: string, dstPort: number): Promise<{ host: string; port: number }> {
    const m = await this.#ensureMapping(intPort, `${dstHost}:${dstPort}`);
    return { host: '127.0.0.1', port: m.extPort };
  }

  // ── saída do par: cria/reusa mapeamento e encaminha pela socket externa dele ──

  #onInternal(msg: Buffer, rinfo: { address: string; port: number }): void {
    void (async () => {
      if (this.#closed || this.#serverAddr === null) return;
      this.#peerAddrByIntPort.set(rinfo.port, { host: rinfo.address, port: rinfo.port });
      const dst = `${this.#serverAddr.host}:${this.#serverAddr.port}`;
      let mapping: Mapping;
      try {
        mapping = await this.#ensureMapping(rinfo.port, dst);
      } catch {
        return;
      }
      this.#forward(mapping.socket, msg, this.#serverAddr);
    })();
  }

  async #ensureMapping(intPort: number, dst: string): Promise<Mapping> {
    const key = this.#model === 'symmetric' ? `${intPort}|${dst}` : `${intPort}`;
    const existing = this.#mappings.get(key);
    if (existing !== undefined) return existing;
    const socket = dgram.createSocket('udp4');
    await new Promise<void>((res) => socket.bind({ address: '127.0.0.1', port: 0 }, res));
    const mapping: Mapping = { socket, extPort: socket.address().port, dst };
    socket.on('message', (msg, rinfo) => this.#onExternal(msg, rinfo, key));
    this.#mappings.set(key, mapping);
    return mapping;
  }

  // ── entrada do servidor: aplica o FILTRO do modelo antes de entregar ao par ──

  #onExternal(msg: Buffer, rinfo: { address: string; port: number }, key: string): void {
    if (this.#closed) return;
    const src = `${rinfo.address}:${rinfo.port}`;
    const mapping = this.#mappings.get(key);
    if (mapping === undefined) return;
    // full-cone: qualquer origem na porta mapeada passa (endpoint-independent filtering);
    // port-restricted e symmetric: só o destino contatado por esta entrada
    if (this.#model !== 'full-cone' && src !== mapping.dst) return;
    // entrega ao par dono desta entrada (intPort codificado na chave "intPort" ou "intPort|dst")
    const intPort = Number.parseInt(key.split('|')[0]!, 10);
    const peer = this.#peerAddrByIntPort.get(intPort);
    if (peer === undefined) return;
    this.#forward(this.internal, msg, peer);
  }

  // Fila FIFO de atraso: preserva ordem (DTLS é sensível a reordenação) e espaça os
  // envios pelo intervalo de chegada — um único timer drena, sem rajadas no mesmo tick.
  readonly #delayQueue: Array<{ to: dgram.Socket; msg: Buffer; host: string; port: number; at: number }> = [];
  #delayTimer: NodeJS.Timeout | null = null;

  #forward(to: dgram.Socket, msg: Buffer, toAddr: { host?: string; port: number; address?: string }): void {
    if (this.#closed) return;
    const host = toAddr.host ?? toAddr.address ?? '127.0.0.1';
    if (this.#lossPct > 0 && Math.random() * 100 < this.#lossPct) return; // perda injetada
    if (this.#delayMs > 0) {
      this.#delayQueue.push({ to, msg, host, port: toAddr.port, at: Date.now() + this.#delayMs });
      if (this.#delayTimer === null) this.#delayTimer = setTimeout(() => this.#drainDelay(), this.#delayMs);
    } else {
      to.send(msg, toAddr.port, host);
    }
  }

  #drainDelay(): void {
    this.#delayTimer = null;
    const now = Date.now();
    while (this.#delayQueue.length > 0 && this.#delayQueue[0]!.at <= now) {
      const item = this.#delayQueue.shift()!;
      if (!this.#closed) item.to.send(item.msg, item.port, item.host);
    }
    if (this.#delayQueue.length > 0 && !this.#closed) {
      this.#delayTimer = setTimeout(() => this.#drainDelay(), Math.max(1, this.#delayQueue[0]!.at - Date.now()));
    }
  }

  get mappingCount(): number {
    return this.#mappings.size;
  }

  close(): void {
    this.#closed = true;
    try {
      this.internal.close();
    } catch {}
    for (const m of this.#mappings.values()) {
      try {
        m.socket.close();
      } catch {}
    }
  }
}
