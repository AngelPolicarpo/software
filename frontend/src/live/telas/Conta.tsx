/**
 * Conta e preferências locais — §15.4 ("Identidade e app", "Preferências locais") e §15.6
 * `query.preferences`.
 *
 * A diferença de natureza entre as duas metades desta tela é o ponto:
 *
 *  - **preferência local** não passa pelo host e não entra na fila. Responde `{}`, o dono do
 *    dado é esta máquina, e o efeito é imediato;
 *  - **`identity.update`** é a segunda exceção declarada de §11.1: o nome exibido precisa
 *    chegar a cada comunidade pelo log, então a resposta é `{queued:[…]}` — uma op por
 *    comunidade. A tela diz quantas foram enfileiradas em vez de fingir que já mudou em todo
 *    lugar.
 *
 * Export, import e apagar tudo são `main-confirmed` (§15.3): o diálogo nativo vem antes do
 * quadro, e o arquivo de backup **nunca** cruza o IPC-R (§13.3 r. 5) — por isso
 * `identity.export` responde `{}` e não o caminho onde gravou.
 */

import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { api } from "../../ipc/api";
import { usePreferencias } from "../preferencias";
import { useSessao, mensagemDeErro } from "../sessao";
import { Secao } from "./comuns";
import { corDe } from "./formato";
import type { Presence } from "../../ipc/dto";

const CORES = ["role-gold", "role-blue", "role-green", "role-red", "role-purple", "role-pink", "role-neutral"] as const;

/** §6.1 — os quatro valores publicáveis. `offline` não está aqui porque não é publicado. */
const PRESENCAS: Array<[Presence, string]> = [
  ["online", "Disponível"],
  ["idle", "Ausente"],
  ["dnd", "Não perturbe"],
  ["invisible", "Invisível"],
];

export function Conta({ aoFechar }: { aoFechar: () => void }) {
  const identidade = useSessao((s) => s.identidade);
  const status = useSessao((s) => s.status);
  const definirPresenca = useSessao((s) => s.definirPresenca);
  const recarregarSessao = useSessao((s) => s.recarregar);
  const prefs = usePreferencias((s) => s.dados);
  const carregarPrefs = usePreferencias((s) => s.carregar);
  const setVolume = usePreferencias((s) => s.setVolume);
  const setNotificacoes = usePreferencias((s) => s.setNotificacoes);

  const [nome, setNome] = useState(identidade?.displayName ?? "");
  const [cor, setCor] = useState(identidade?.avatarColor ?? CORES[1]);
  const [passphrase, setPassphrase] = useState("");
  const [recado, setRecado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    void carregarPrefs();
  }, [carregarPrefs]);

  async function acao(fn: () => Promise<string | null>): Promise<void> {
    setOcupado(true);
    setErro(null);
    setRecado(null);
    try {
      setRecado(await fn());
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  if (identidade === null) return null;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-surface-app p-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <div className="flex items-center justify-between">
          <h1 className="text-h2 text-text-primary">Sua conta</h1>
          <Button variant="ghost" onClick={aoFechar}>
            Voltar
          </Button>
        </div>

        <Secao titulo="Identidade">
          <p className="text-meta text-text-tertiary">
            {identidade.handle} · chave {identidade.key.slice(0, 16)}…
          </p>
          <TextField label="Nome de exibição" value={nome} onChange={setNome} maxLength={32} showCounter counterWarningAt={28} />
          <div className="flex flex-wrap gap-2">
            {CORES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setCor(c)}
                className={"size-8 rounded-full border-2 " + (cor === c ? "border-text-primary" : "border-transparent")}
                style={{ backgroundColor: corDe(c) }}
              />
            ))}
          </div>
          <div>
            <Button
              loading={ocupado}
              onClick={() =>
                void acao(async () => {
                  const r = await api.identityUpdate({ displayName: nome, avatarColor: cor });
                  await recarregarSessao();
                  // A honestidade está aqui: o nome muda em cada comunidade quando a op dela
                  // for aceita, não agora.
                  return r.queued.length === 0
                    ? "Nada a propagar: você ainda não participa de nenhuma comunidade."
                    : `Enfileirado em ${r.queued.length} ${r.queued.length === 1 ? "comunidade" : "comunidades"}. O nome muda em cada uma quando o host aceitar.`;
                })
              }
            >
              Salvar identidade
            </Button>
          </div>
        </Secao>

        <Secao titulo="Presença">
          <div className="flex flex-wrap gap-2">
            {PRESENCAS.map(([p, rotulo]) => (
              <Button
                key={p}
                size="sm"
                variant={identidade.presence === p ? "primary" : "secondary"}
                onClick={() => void definirPresenca(p)}
              >
                {rotulo}
              </Button>
            ))}
          </div>
          <p className="text-caption text-text-tertiary">
            Invisível não publica presença nenhuma. Para quem olha, é indistinguível de estar fora —
            que é o ponto.
          </p>
        </Secao>

        {prefs !== null && (
          <>
            <Secao titulo="Áudio">
              <label className="flex items-center gap-3 text-meta text-text-secondary">
                <span className="w-28">Entrada</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={prefs.device.inputVolume}
                  onChange={(e) => void setVolume("input", Number(e.target.value))}
                  className="flex-1"
                />
                <span className="w-10 text-right">{prefs.device.inputVolume}</span>
              </label>
              <label className="flex items-center gap-3 text-meta text-text-secondary">
                <span className="w-28">Saída</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={prefs.device.outputVolume}
                  onChange={(e) => void setVolume("output", Number(e.target.value))}
                  className="flex-1"
                />
                <span className="w-10 text-right">{prefs.device.outputVolume}</span>
              </label>
              <p className="text-caption text-text-tertiary">
                A escolha de microfone, câmera e saída entra com a fatia de mídia real, junto com a
                enumeração de dispositivos.
              </p>
            </Secao>

            <Secao titulo="Notificações">
              <label className="flex items-center gap-2 text-meta text-text-secondary">
                <input
                  type="checkbox"
                  checked={prefs.notifications.enabled}
                  onChange={(e) => void setNotificacoes({ enabled: e.target.checked })}
                />
                Notificar nesta máquina
              </label>
            </Secao>
          </>
        )}

        <Secao titulo="Backup da identidade">
          <p className="text-meta text-text-secondary">
            Sem este backup, ninguém recupera sua identidade — não há servidor com uma cópia. O
            arquivo é gravado pelo sistema, fora desta janela, e nunca passa pela interface.
          </p>
          <TextField label="Frase secreta" type="password" value={passphrase} onChange={setPassphrase} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={ocupado}
              disabled={passphrase.length === 0}
              onClick={() =>
                void acao(async () => {
                  await api.identityExport(passphrase);
                  setPassphrase("");
                  return "Backup gravado.";
                })
              }
            >
              Exportar backup
            </Button>
          </div>
        </Secao>

        <Secao titulo="Apagar tudo desta máquina">
          <p className="text-meta text-text-secondary">
            Apaga a identidade, as comunidades replicadas e os anexos baixados desta instalação. O
            que já foi enviado continua na cópia de quem o recebeu — nada aqui alcança as outras
            máquinas.
          </p>
          <div>
            <Button
              variant="danger"
              loading={ocupado}
              onClick={() =>
                void acao(async () => {
                  await api.identityWipe();
                  return "O núcleo está reiniciando.";
                })
              }
            >
              Apagar tudo
            </Button>
          </div>
        </Secao>

        <Secao titulo="Diagnóstico">
          <p className="text-meta text-text-secondary">
            A sondagem de rede mede o que dá para medir daqui. Reprojetar reabre o estado a partir
            do log — é reparo local, não altera o que foi escrito, e congela o núcleo enquanto dura.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={ocupado}
              onClick={() =>
                void acao(async () => {
                  const d = await api.diagRun();
                  return `NAT ${d.natType} · ${d.peerCount} pares · relay ${d.relayAvailable ? "disponível" : "indisponível"} · STUN ${d.stunReachable ? "alcançável" : "inalcançável"}`;
                })
              }
            >
              Sondar a rede
            </Button>
            <Button
              variant="secondary"
              loading={ocupado}
              onClick={() =>
                void acao(async () => {
                  const m = await api.diagSnapshot();
                  const n = Object.keys(m).length;
                  return `${n} ${n === 1 ? "métrica coletada" : "métricas coletadas"} — o instantâneo fica no registro local.`;
                })
              }
            >
              Instantâneo de métricas
            </Button>
            <Button
              variant="secondary"
              loading={ocupado}
              onClick={() =>
                void acao(async () => {
                  await api.coreReproject();
                  return "Estado reprojetado a partir do log.";
                })
              }
            >
              Reprojetar
            </Button>
          </div>
        </Secao>

        {status !== null && (
          <p className="text-caption text-text-tertiary">
            núcleo {status.coreVersion} · op v{status.opVersion} · manifest v
            {status.manifestSchemaVersion} · view v{status.viewSchemaVersion} · cofre{" "}
            {status.keystore === "secure" ? "seguro" : "em modo inseguro"} · canal {status.buildChannel}
          </p>
        )}

        {recado !== null && <p className="text-meta text-feedback-success">{recado}</p>}
        {erro !== null && <p className="text-meta text-feedback-danger">{erro}</p>}
      </div>
    </div>
  );
}
