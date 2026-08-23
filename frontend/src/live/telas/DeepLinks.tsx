/**
 * Superfícies dos deep links (§3.5, §12.3, §15.6 `query.resolveMessageLink`).
 *
 * `join/<código>`: prévia por `invite.resolve` (classe `open` — resolve antes de existir
 * identidade) e entrada por `invite.redeem`. A prévia é desenhada a partir do que o núcleo
 * devolve, sem campo inventado: o que não vier, não aparece.
 *
 * `m/<MSGREF>`: os cinco desfechos de §15.6 são estados de tela, não erros. `not-member` e
 * `not-synced` são respostas legítimas — a primeira responde sem tocar em nada, e a segunda
 * diz que a mensagem existe mas ainda não chegou aqui.
 */

import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../ipc/api";
import { useDeeplinks } from "../deeplink";
import { useComunidades } from "../comunidades";
import { useCanal } from "../canal";
import { mensagemDeErro } from "../sessao";

function Scrim({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay-scrim p-6">
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-primary p-6">{children}</div>
    </div>
  );
}

/** Campos da prévia que valem mostrar quando o núcleo os traz; o resto fica de fora. */
function linhasDaPrevia(previa: Record<string, unknown>): Array<[string, string]> {
  const rotulos: Record<string, string> = {
    communityName: "Comunidade",
    memberCount: "Membros",
    hostDisplayName: "Host",
    expiresAt: "Expira em",
    usesLeft: "Usos restantes",
  };
  const linhas: Array<[string, string]> = [];
  for (const [k, rotulo] of Object.entries(rotulos)) {
    const v = previa[k];
    if (v === undefined || v === null) continue;
    linhas.push([rotulo, k === "expiresAt" ? new Date(Number(v)).toLocaleString("pt-BR") : String(v)]);
  }
  return linhas;
}

export function ConviteOverlay() {
  const convite = useDeeplinks((s) => s.convite);
  const fechar = useDeeplinks((s) => s.fecharConvite);
  const carregarLista = useComunidades((s) => s.carregarLista);
  const selecionar = useComunidades((s) => s.selecionarComunidade);
  const selecionarCanal = useComunidades((s) => s.selecionarCanal);
  const abrirCanal = useCanal((s) => s.abrir);

  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (convite === null) return null;

  async function entrar(): Promise<void> {
    setEntrando(true);
    setErro(null);
    try {
      const r = await api.inviteRedeem({ codeOrLink: convite!.code });
      await carregarLista();
      await selecionar(r.communityId);
      await selecionarCanal(r.defaultChannelId);
      await abrirCanal(r.communityId, r.defaultChannelId);
      fechar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEntrando(false);
    }
  }

  const previa = (convite.previa ?? {}) as Record<string, unknown>;
  const linhas = linhasDaPrevia(previa);

  return (
    <Scrim>
      <h2 className="text-h2 text-text-primary">Convite</h2>

      {convite.resolvendo && (
        <p className="mt-3 flex items-center gap-2 text-meta text-text-secondary">
          <Spinner /> Resolvendo o convite com o host…
        </p>
      )}

      {convite.erro !== null && <p className="mt-3 text-meta text-feedback-danger">{convite.erro}</p>}

      {convite.previa !== null && (
        <dl className="mt-4 flex flex-col gap-2">
          {linhas.length === 0 && (
            <p className="text-meta text-text-tertiary">O host respondeu sem detalhes adicionais.</p>
          )}
          {linhas.map(([rotulo, valor]) => (
            <div key={rotulo} className="flex justify-between gap-4">
              <dt className="text-meta text-text-tertiary">{rotulo}</dt>
              <dd className="text-meta text-text-primary">{valor}</dd>
            </div>
          ))}
        </dl>
      )}

      {erro !== null && <p className="mt-3 text-meta text-feedback-danger">{erro}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={fechar}>
          Fechar
        </Button>
        <Button loading={entrando} disabled={convite.previa === null} onClick={() => void entrar()}>
          Entrar na comunidade
        </Button>
      </div>
    </Scrim>
  );
}

export function MensagemLinkOverlay() {
  const mensagem = useDeeplinks((s) => s.mensagem);
  const fechar = useDeeplinks((s) => s.fecharMensagem);
  const selecionar = useComunidades((s) => s.selecionarComunidade);
  const selecionarCanal = useComunidades((s) => s.selecionarCanal);
  const abrirCanal = useCanal((s) => s.abrir);

  const r = mensagem?.resultado ?? null;

  // Navegar é efeito, não render: fazê-lo no corpo do componente rodaria duas vezes em
  // StrictMode e dispararia `nav.setActive` em duplicidade.
  useEffect(() => {
    if (r === null || r.status !== "ok") return;
    void selecionar(r.communityId).then(() => {
      void selecionarCanal(r.channelId);
      void abrirCanal(r.communityId, r.channelId);
      fechar();
    });
  }, [r, selecionar, selecionarCanal, abrirCanal, fechar]);

  if (mensagem === null) return null;

  if (r === null) {
    return (
      <Scrim>
        <p className="flex items-center gap-2 text-meta text-text-secondary">
          <Spinner /> Resolvendo o link…
        </p>
      </Scrim>
    );
  }

  // Desfecho feliz: o efeito acima leva ao canal e fecha; não há overlay a mostrar.
  if (r.status === "ok") return null;

  const texto: Record<string, string> = {
    "not-member": "Você não participa desta comunidade, então não há como abrir a mensagem.",
    "not-synced": "A mensagem existe, mas essa parte do histórico ainda não replicou para cá.",
    deleted: "Essa mensagem foi removida da interface.",
    malformed: "O link não tem a forma de uma referência de mensagem.",
  };

  return (
    <Scrim>
      <h2 className="text-h2 text-text-primary">Link de mensagem</h2>
      <p className="mt-3 text-meta text-text-secondary">{texto[r.status]}</p>
      <div className="mt-5 flex justify-end">
        <Button onClick={fechar}>Fechar</Button>
      </div>
    </Scrim>
  );
}
