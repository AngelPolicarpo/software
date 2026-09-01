import { useEffect, useState } from "react";
import {
  Crown,
  SkipForward,
  Timer,
  UserMinus,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Tooltip } from "../../components/ui/Tooltip";

/* ─── §16.4 (emenda de 2026-08-28) — a fila de karaokê ──────────────────────────────── */

interface FilaEstadoUI {
  channelId: string;
  open: boolean;
  items: Array<{ keyHex: string; queuedAt: number }>;
  turn: { keyHex: string; endsAt: number } | null;
}

interface FilaKaraokêProps {
  fila: FilaEstadoUI | null;
  motivo: string | null;
  communityId: string;
  localId: string;
  podeModerar: boolean;
  entrarNaFila: () => void;
  sairDaFila: () => void;
  moderar: (a: { action: "promote" | "skip" | "remove" | "addTime" | "open" | "close"; targetKey?: string; seconds?: number }) => Promise<void>;
  findMember: (communityId: string, identityId: string) => { displayName: string } | undefined;
}

/** Relógio de 1 s para a contagem do turno — a UI não decide nada, só desenha. */
function useAgora(): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  return agora;
}

/**
 * Ação de lista da fila — o mesmo corpo do botão de sair do painel da chamada (2.3.1):
 * 44px de alvo de toque no Mobile, 32px onde há ponteiro, e sempre Tooltip, porque o
 * ícone sozinho não nomeia nada (§5.4). Os tons seguem os de §6: aviso para pular a vez
 * de alguém, perigo para tirar da fila.
 */
function AcaoDeFila({
  label,
  onClick,
  tone = "default",
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: "default" | "warning" | "danger";
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-md tablet:size-8",
          "transition-colors duration-(--duration-fast) ease-out",
          tone === "danger"
            ? "text-feedback-danger hover:bg-feedback-danger/15"
            : tone === "warning"
              ? "text-feedback-warning hover:bg-surface-primary hover:text-text-primary"
              : "text-text-secondary hover:bg-surface-primary hover:text-text-primary",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function FilaKaraokê({
  fila,
  motivo,
  communityId,
  localId,
  podeModerar,
  entrarNaFila,
  sairDaFila,
  moderar,
  findMember,
}: FilaKaraokêProps) {
  const agora = useAgora();
  const nomeDe = (keyHex: string): string =>
    findMember(communityId, keyHex)?.displayName ?? keyHex.slice(0, 8);

  const euNaFila = fila?.items.findIndex((i) => i.keyHex === localId) ?? -1;
  const souTitular = fila?.turn?.keyHex === localId;
  const segundosRestantes =
    fila?.turn === null || fila?.turn === undefined
      ? null
      : Math.max(0, Math.ceil((fila.turn.endsAt - agora) / 1000));

  return (
    <div className="shrink-0 border-t border-border-subtle p-3">
      {/* Cabeçalho: o rótulo segue o padrão de campo (caption caixa-alta) e o estado de
          fila fechada é pill no tom de aviso, lavado a 15% como o StatusBanner de §5.4. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-text-secondary uppercase">Fila (karaokê)</span>
        {!fila?.open && (
          <span className="rounded-full bg-feedback-warning/15 px-1.5 py-px text-caption uppercase text-feedback-warning">
            fila fechada
          </span>
        )}
        <span className="flex-1" />
        {souTitular ? (
          <span className="text-meta text-feedback-warning">É a sua vez — o palco é seu!</span>
        ) : euNaFila >= 0 ? (
          <span className="text-meta text-text-secondary">Você é o nº {euNaFila + 1} da fila</span>
        ) : (
          // §15 — fila fechada não é permissão, é estado: o botão some e a pill acima
          // diz o porquê. Botão visível e morto seria decorativa.
          fila?.open && (
            <Button variant="secondary" size="sm" onClick={entrarNaFila}>
              Entrar na fila
            </Button>
          )
        )}
        {(souTitular || euNaFila >= 0) && (
          <Button variant="ghost" size="sm" onClick={sairDaFila}>
            Sair da fila
          </Button>
        )}
      </div>

      {motivo !== null && (
        <p role="alert" className="mt-1 text-meta text-feedback-danger">
          {motivo}
        </p>
      )}

      {/* O palco: quem tem a vez, com contagem regressiva em tabular-nums (números que
          não dançam a cada segundo) e os controles do moderador. */}
      {fila?.turn != null && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border-default bg-surface-elevated p-2">
          <span className="min-w-0 truncate text-body-emphasis text-text-primary">
            {nomeDe(fila.turn.keyHex)}
          </span>
          <span className="text-meta text-text-tertiary">
            {fila.turn.keyHex === localId ? "cantando agora" : "no palco"}
          </span>
          {segundosRestantes !== null && (
            <span className="text-meta tabular-nums text-text-secondary">
              {Math.floor(segundosRestantes / 60)}:{String(segundosRestantes % 60).padStart(2, "0")}
            </span>
          )}
          <span className="flex-1" />
          {podeModerar && (
            <>
              <AcaoDeFila
                label="A plateia gostou: somar 1 minuto ao turno"
                onClick={() => void moderar({ action: "addTime", seconds: 60 })}
              >
                <Timer size={16} strokeWidth={2} aria-hidden="true" />
              </AcaoDeFila>
              <AcaoDeFila
                label="Pular a vez de quem está no palco"
                tone="warning"
                onClick={() => void moderar({ action: "skip" })}
              >
                <SkipForward size={16} strokeWidth={2} aria-hidden="true" />
              </AcaoDeFila>
            </>
          )}
        </div>
      )}

      {/* A fila de espera, na ordem — a lista segue o padrão de participantes da sidebar
          (§8, 1.1): um por linha, truncado, o meu destacado. */}
      {fila !== null && fila.items.length > 0 && (
        <ol className="mt-2 flex flex-col">
          {fila.items.map((item, i) => (
            <li
              key={item.keyHex}
              className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-primary"
            >
              <span className="w-5 text-right text-meta tabular-nums text-text-tertiary">
                {i + 1}.
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-meta",
                  item.keyHex === localId ? "text-text-primary" : "text-text-secondary",
                )}
              >
                {nomeDe(item.keyHex)}
              </span>
              {podeModerar && (
                <>
                  <AcaoDeFila
                    label={`Dar a vez a ${nomeDe(item.keyHex)}`}
                    onClick={() => void moderar({ action: "promote", targetKey: item.keyHex })}
                  >
                    <Crown size={16} strokeWidth={2} aria-hidden="true" />
                  </AcaoDeFila>
                  <AcaoDeFila
                    label={`Tirar ${nomeDe(item.keyHex)} da fila`}
                    tone="danger"
                    onClick={() => void moderar({ action: "remove", targetKey: item.keyHex })}
                  >
                    <UserMinus size={16} strokeWidth={2} aria-hidden="true" />
                  </AcaoDeFila>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

