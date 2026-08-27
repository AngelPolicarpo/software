/**
 * Tela ou câmera? — a classificação de uma trilha de vídeo que chega de um par.
 *
 * Do mesmo par chegam duas coisas como trilha de vídeo, pela MESMA
 * `RTCPeerConnection`: a **tela** (§17.5, estrela) e a **câmera** (§17.2, malha). §15.x não
 * declara correlação nenhuma entre um `MediaStream` e a sessão de tela — não existe campo no
 * fio dizendo "este `msid` é a sessão S", e o `MediaStream.id` é gerado pelo navegador de
 * quem envia, sem que ninguém possa escolhê-lo. É a lacuna **B41**.
 *
 * O que existe é estado que quem recebe **conquistou por conta própria**, e é com ele que se
 * decide. A regra, em ordem:
 *
 * 1. `msid` já ligado à tela daquele par → **tela**. É a segunda trilha da mesma captura: o
 *    som de §17.5 chega assim, no mesmo `MediaStream` do vídeo.
 * 2. `msid` já ligado à câmera daquele par → **câmera**, pela mesma razão.
 * 3. Eu **entrei** numa transmissão daquele par (`share.join` aceito pelo host) e ainda não
 *    tenho imagem dela → **tela**.
 * 4. Qualquer outro caso → **câmera**.
 *
 * **A regra 3 é sobre `share.join`, não sobre "existe transmissão".** A diferença não é
 * sutil: `share.started` chega a **todos** os da chamada, inclusive a quem não pode assistir
 * — e o apresentador só manda a trilha de tela a quem o host listou em `share.health`, isto
 * é, a quem entrou. Decidir por "existe transmissão viva" classificava como tela a câmera de
 * um par cujo `share.join` tinha sido **recusado**, e ali não havia janela estreita nenhuma:
 * o erro era certo, e permanente.
 *
 * O que sobra de B41 é a janela em que as duas coisas começam juntas: entrar numa
 * transmissão e o apresentador ligar a câmera no mesmo instante, com a trilha da câmera
 * chegando primeiro. Fechá-la exige campo no fio, que é decisão normativa e não de código.
 */

export type OrigemDoVideo = "tela" | "camera";

export interface EstadoDoPar {
  /** `msid` já ligado à tela deste par, se houver. */
  idDaTela: string | null;
  /** `msid` já ligado à câmera deste par, se houver. */
  idDaCamera: string | null;
  /** `share.join` aceito pelo host para uma transmissão viva deste par. */
  assinouTela: boolean;
}

export function classificarVideo(streamId: string, par: EstadoDoPar): OrigemDoVideo {
  if (par.idDaTela === streamId) return "tela";
  if (par.idDaCamera === streamId) return "camera";
  return par.assinouTela && par.idDaTela === null ? "tela" : "camera";
}
