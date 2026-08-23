/**
 * Hub sem comunidade e criação de comunidade — `community.create` (§15.4).
 *
 * A resposta traz `defaultChannelId`, que é o **primeiro canal criado** (na gênese, `#geral`)
 * — não um canal marcado como padrão em lugar nenhum. A tela usa esse id para abrir a
 * comunidade já dentro de um canal, em vez de deixar a pessoa numa tela vazia recém-criada.
 *
 * A outra porta de entrada é o convite, e ela funciona **antes** de qualquer comunidade
 * existir: `invite.resolve` é classe `open`.
 */

import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { api } from "../../ipc/api";
import { useCanal } from "../canal";
import { useComunidades } from "../comunidades";
import { useDeeplinks } from "../deeplink";
import { mensagemDeErro } from "../sessao";
import { campoDoErro } from "../../ipc/frames";
import { corDe } from "./formato";

const CORES = ["role-gold", "role-blue", "role-green", "role-red", "role-purple", "role-pink", "role-neutral"] as const;

export function CriarComunidade({ aoFechar }: { aoFechar: () => void }) {
  const carregarLista = useComunidades((s) => s.carregarLista);
  const selecionar = useComunidades((s) => s.selecionarComunidade);
  const selecionarCanal = useComunidades((s) => s.selecionarCanal);
  const abrirCanal = useCanal((s) => s.abrir);

  const [nome, setNome] = useState("");
  const [emoji, setEmoji] = useState("");
  const [cor, setCor] = useState<string>(CORES[1]);
  const [descricao, setDescricao] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<{ texto: string; campo?: string } | null>(null);

  async function criar(): Promise<void> {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.communityCreate({
        name: nome.trim(),
        iconColor: cor,
        ...(emoji.length > 0 ? { iconEmoji: emoji } : {}),
        ...(descricao.trim().length > 0 ? { description: descricao.trim() } : {}),
      });
      await carregarLista();
      await selecionar(r.communityId);
      await selecionarCanal(r.defaultChannelId);
      await abrirCanal(r.communityId, r.defaultChannelId);
      aoFechar();
    } catch (e) {
      setErro({ texto: mensagemDeErro(e), campo: campoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay-scrim p-6">
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-primary p-6">
        <h2 className="text-h2 text-text-primary">Criar comunidade</h2>
        <p className="mt-2 text-meta text-text-secondary">
          Ela vai rodar nesta máquina. Enquanto o aplicativo estiver fechado, quem participa lê a
          cópia que já tem e o que escrever fica na fila até você voltar.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <TextField
            label="Nome"
            value={nome}
            onChange={setNome}
            maxLength={64}
            autoFocus
            error={erro?.campo === "name" ? erro.texto : undefined}
          />
          <TextField label="Emoji do ícone (opcional)" value={emoji} onChange={setEmoji} maxLength={8} />
          <div className="flex flex-col gap-2">
            <span className="text-caption uppercase text-text-secondary">Cor</span>
            <div className="flex flex-wrap gap-2">
              {CORES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={cor === c}
                  onClick={() => setCor(c)}
                  className={"size-8 rounded-full border-2 " + (cor === c ? "border-text-primary" : "border-transparent")}
                  style={{ backgroundColor: corDe(c) }}
                />
              ))}
            </div>
          </div>
          <TextField label="Descrição (opcional)" value={descricao} onChange={setDescricao} maxLength={200} />
        </div>

        {erro !== null && erro.campo !== "name" && <p className="mt-3 text-meta text-feedback-danger">{erro.texto}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button loading={ocupado} disabled={nome.trim().length === 0} onClick={() => void criar()}>
            Criar
          </Button>
        </div>
      </div>
    </div>
  );
}

export function EntrarPorConvite({ aoFechar }: { aoFechar: () => void }) {
  const abrirConvite = useDeeplinks((s) => s.abrirConvite);
  const [codigo, setCodigo] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay-scrim p-6">
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-primary p-6">
        <h2 className="text-h2 text-text-primary">Entrar por convite</h2>
        <p className="mt-2 text-meta text-text-secondary">
          Cole o código de 16 caracteres ou o link inteiro. O domínio de um link nunca é acessado —
          só o código importa.
        </p>
        <div className="mt-4">
          <TextField label="Código ou link" value={codigo} onChange={setCodigo} autoFocus />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button
            disabled={codigo.trim().length === 0}
            onClick={() => {
              void abrirConvite(codigo.trim());
              aoFechar();
            }}
          >
            Ver convite
          </Button>
        </div>
      </div>
    </div>
  );
}

/** O que ocupa a área de conteúdo quando não há comunidade nenhuma no rail. */
export function Hub({ aoCriar, aoEntrar }: { aoCriar: () => void; aoEntrar: () => void }) {
  return (
    <section className="flex min-w-0 flex-1 items-center justify-center bg-surface-primary p-6">
      <div className="max-w-md text-center">
        <h2 className="text-h2 text-text-primary">Nenhuma comunidade ainda</h2>
        <p className="mt-2 text-meta text-text-secondary">
          Uma comunidade vive na máquina de quem a criou. Você pode hospedar a sua ou entrar na de
          outra pessoa por convite.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={aoCriar}>Criar comunidade</Button>
          <Button variant="secondary" onClick={aoEntrar}>
            Entrar por convite
          </Button>
        </div>
      </div>
    </section>
  );
}
