// Épico 4 — gravação LOCAL do canal (§17.2: mídia nunca toca o núcleo, então gravação é
// assunto do renderer). O que se grava é o que ESTA máquina ouve: os streams de áudio de
// cada par + o próprio microfone, somados num destino único do Web Audio e codificados
// pelo MediaRecorder em Opus/WebM.
//
// **Local é a palavra.** A gravação não sobe, não sinaliza, não consulta o host — e é por
// isso que a UI a trata como escolha pessoal visível só a quem grava (o ícone na barra de
// controles), não como estado de chamada.

export interface GravadorDeCanal {
  /** Liga a captura sobre os streams dados. Chamar de novo reinicia limpo. */
  iniciar(streams: readonly MediaStream[]): void;
  /** Para e devolve o arquivo; `null` se nada foi gravado (sem trilhas, sem dados). */
  parar(): Promise<Blob | null>;
  readonly gravando: boolean;
}

/** MediaRecorder precisa existir; fora do Electron (teste) ele pode não existir. */
export function gravacaoSuportada(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof globalThis.AudioContext === "function";
}

export function criarGravadorDeCanal(): GravadorDeCanal | null {
  if (!gravacaoSuportada()) return null;
  const ctx = new AudioContext();
  const destino = ctx.createMediaStreamDestination();
  const fontes: MediaStreamAudioSourceNode[] = [];
  let recorder: MediaRecorder | null = null;
  const partes: Blob[] = [];

  return {
    get gravando() {
      return recorder?.state === "recording";
    },

    iniciar(streams) {
      recorder?.stop();
      for (const f of fontes) f.disconnect();
      fontes.length = 0;
      partes.length = 0;
      let comAudio = false;
      for (const stream of streams) {
        if (stream.getAudioTracks().length === 0) continue;
        const fonte = ctx.createMediaStreamSource(stream);
        fonte.connect(destino);
        fontes.push(fonte);
        comAudio = true;
      }
      if (!comAudio) return;
      recorder = new MediaRecorder(destino.stream);
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) partes.push(ev.data);
      };
      recorder.start(1_000); // fatia de 1 s: parar devolve rápido e nada se perde
    },

    parar() {
      return new Promise((resolve) => {
        const r = recorder;
        if (r === null || r.state !== "recording") {
          resolve(null);
          return;
        }
        r.onstop = () => resolve(new Blob(partes, { type: r.mimeType || "audio/webm" }));
        r.stop();
      });
    },
  };
}
