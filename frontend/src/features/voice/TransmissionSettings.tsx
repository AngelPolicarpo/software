import { useState } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import {
  useVoiceStore,
  type PerfilDeCaptura,
  type ShareQuality,
} from "../../store/voiceStore";

/**
 * §17.5 — os ajustes da transmissão, **do apresentador e só dele**.
 *
 * Três coisas, e as três decidem o que sai desta máquina: a resolução e a taxa de quadros
 * da captura, que são `applyConstraints` na trilha local (a mesma natureza do mudo efetivo
 * de §17.4 L-12 — quem possui o dispositivo decide o que sai dele), e o perfil de qualidade
 * de §17.5, que é o teto de banda por espectador e passa pelo host.
 *
 * Quem assiste não vê nada disto: o controle dele é ocultar o vídeo, que é sobre a tela de
 * quem aperta o botão, não sobre a transmissão de outra pessoa.
 *
 * **Os presets são pedidos, não garantias.** A fonte aproxima ou ignora, e o que aparece
 * como estado corrente vem de `getSettings()` da trilha — nunca do que foi pedido. Por isso
 * há um "como a fonte entregar", que não é um valor: é a ausência de restrição.
 */

/** Alturas usuais de tela. `null` = sem restrição, que é o padrão de `getDisplayMedia`. */
const RESOLUCOES: Array<{ id: string; label: string; height: number | null }> = [
  { id: "livre", label: "Original", height: null },
  { id: "1080", label: "1080p", height: 1080 },
  { id: "720", label: "720p", height: 720 },
  { id: "480", label: "480p", height: 480 },
];

/** 60 para movimento, 30 padrão, 15 para leitura — texto parado não precisa de quadro. */
const QUADROS: Array<{ id: string; label: string; fps: number | null }> = [
  { id: "livre", label: "Original", fps: null },
  { id: "60", label: "60 fps", fps: 60 },
  { id: "30", label: "30 fps", fps: 30 },
  { id: "15", label: "15 fps", fps: 15 },
];

/** §17.5 — `high` 2500 kbps · `balanced` 1200 · `low` 600. Números do contrato. */
const QUALIDADES: Array<{ id: ShareQuality; label: string; hint: string }> = [
  { id: "high", label: "Alta", hint: "2500 kbps — texto pequeno legível" },
  { id: "balanced", label: "Equilibrada", hint: "1200 kbps — o padrão" },
  { id: "low", label: "Baixa", hint: "600 kbps — conexões apertadas" },
];

/** Faixas de sanidade do campo personalizado. Fora delas o pedido não é enviado. */
const ALTURA_MIN = 144;
const ALTURA_MAX = 2160;
const FPS_MIN = 1;
const FPS_MAX = 120;

function Pill({
  ativo,
  onClick,
  title,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      {...(title !== undefined ? { title } : {})}
      className={cn(
        "rounded-full border px-3 py-1.5 text-meta",
        "transition-colors duration-(--duration-fast) ease-out",
        ativo
          ? "border-border-strong bg-surface-elevated text-text-primary"
          : "border-border-default text-text-secondary hover:border-border-strong",
      )}
    >
      {children}
    </button>
  );
}

/** Um preset casa quando o valor corrente é exatamente o dele; senão, é personalizado. */
function ehPersonalizado(valor: number | null, presets: ReadonlyArray<number | null>): boolean {
  return valor !== null && !presets.includes(valor);
}

export function TransmissionSettings() {
  // A transmissão que EU apresento — os ajustes são dela (§17.5).
  const share = useVoiceStore((state) =>
    state.shares.find((s) => s.presenterId === state.localId),
  );
  const captura = useVoiceStore((state) => state.capturaDaTela);
  const setQuality = useVoiceStore((state) => state.setQuality);
  const definirCaptura = useVoiceStore((state) => state.definirCaptura);

  const [alturaLivre, setAlturaLivre] = useState("");
  const [fpsLivre, setFpsLivre] = useState("");
  const [abrirAltura, setAbrirAltura] = useState(false);
  const [abrirFps, setAbrirFps] = useState(false);

  if (share === undefined) return null;

  const aplicar = (patch: Partial<PerfilDeCaptura>) => definirCaptura(patch);

  const alturaPersonalizada =
    abrirAltura || ehPersonalizado(captura.height, RESOLUCOES.map((r) => r.height));
  const fpsPersonalizado =
    abrirFps || ehPersonalizado(captura.frameRate, QUADROS.map((q) => q.fps));

  const alturaNum = Number(alturaLivre);
  const alturaValida =
    alturaLivre !== "" && Number.isInteger(alturaNum) && alturaNum >= ALTURA_MIN && alturaNum <= ALTURA_MAX;
  const fpsNum = Number(fpsLivre);
  const fpsValido =
    fpsLivre !== "" && Number.isInteger(fpsNum) && fpsNum >= FPS_MIN && fpsNum <= FPS_MAX;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-meta text-text-secondary">Resolução</legend>
        <div className="flex flex-wrap gap-1.5">
          {RESOLUCOES.map((r) => (
            <Pill
              key={r.id}
              ativo={!alturaPersonalizada && captura.height === r.height}
              onClick={() => {
                setAbrirAltura(false);
                void aplicar({ height: r.height });
              }}
            >
              {r.label}
            </Pill>
          ))}
          <Pill ativo={alturaPersonalizada} onClick={() => setAbrirAltura(true)}>
            Personalizado
          </Pill>
        </div>
        {alturaPersonalizada && (
          <div className="flex items-end gap-2">
            <TextField
              label="Altura (px)"
              inputMode="numeric"
              value={alturaLivre}
              onChange={setAlturaLivre}
              placeholder={captura.height === null ? "720" : String(captura.height)}
              {...(alturaLivre !== "" && !alturaValida
                ? { error: `Entre ${ALTURA_MIN} e ${ALTURA_MAX}` }
                : { hint: "A largura acompanha a proporção da fonte" })}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!alturaValida}
              onClick={() => void aplicar({ height: alturaNum })}
            >
              Aplicar
            </Button>
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-meta text-text-secondary">Taxa de quadros</legend>
        <div className="flex flex-wrap gap-1.5">
          {QUADROS.map((q) => (
            <Pill
              key={q.id}
              ativo={!fpsPersonalizado && captura.frameRate === q.fps}
              onClick={() => {
                setAbrirFps(false);
                void aplicar({ frameRate: q.fps });
              }}
            >
              {q.label}
            </Pill>
          ))}
          <Pill ativo={fpsPersonalizado} onClick={() => setAbrirFps(true)}>
            Personalizado
          </Pill>
        </div>
        {fpsPersonalizado && (
          <div className="flex items-end gap-2">
            <TextField
              label="Quadros por segundo"
              inputMode="numeric"
              value={fpsLivre}
              onChange={setFpsLivre}
              placeholder={captura.frameRate === null ? "30" : String(captura.frameRate)}
              {...(fpsLivre !== "" && !fpsValido
                ? { error: `Entre ${FPS_MIN} e ${FPS_MAX}` }
                : {})}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!fpsValido}
              onClick={() => void aplicar({ frameRate: fpsNum })}
            >
              Aplicar
            </Button>
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-meta text-text-secondary">Qualidade</legend>
        <div className="flex flex-wrap gap-1.5">
          {QUALIDADES.map((q) => (
            <Pill
              key={q.id}
              ativo={share.quality === q.id}
              onClick={() => setQuality(q.id)}
              title={q.hint}
            >
              {q.label}
            </Pill>
          ))}
        </div>
        {/*
          §17.5 — a degradação por perda é do sistema e só desce. Dizer isso aqui evita que
          o perfil "voltar sozinho" pareça defeito.
        */}
        <p className="text-meta text-text-tertiary">
          Com perda alta, o sistema baixa o perfil de quem estiver recebendo mal — sem mexer
          nos outros.
        </p>
      </fieldset>

      <p className="text-meta text-text-tertiary">
        Entregando{" "}
        {captura.height === null ? "na resolução da fonte" : `${captura.height}p`}
        {captura.frameRate === null ? "" : ` a ${captura.frameRate} fps`}. A fonte pode
        aproximar o que você pedir.
      </p>
    </div>
  );
}
