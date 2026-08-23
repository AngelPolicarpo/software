/**
 * Tela dedicada do modo inseguro — §3.2 L-2.
 *
 * A limitação declarada não pede um aviso: pede que **o núcleo recuse abrir** salvo se a
 * pessoa aceitar o modo inseguro *numa tela dedicada*, e que a UI passe a exibir um
 * indicador permanente. As duas metades importam. Esta é a primeira; a segunda é a faixa do
 * shell, que continua acesa depois do aceite — porque aceitar não torna o cofre seguro.
 *
 * O texto diz o que se está aceitando em vez de pedir confirmação de algo vago. O que muda,
 * concretamente: a chave privada da identidade passa a ficar no disco protegida apenas pelas
 * permissões do sistema de arquivos, e qualquer processo rodando com o seu usuário consegue
 * lê-la. `safeStorage` também não protege contra isso quando funciona — mas aqui não há nem
 * a camada do sistema.
 */

import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { useSessao, mensagemDeErro } from "../sessao";

export function CofreInseguro({ aoAceitar }: { aoAceitar: () => void }) {
  const aceitar = useSessao((s) => s.aceitarCofreInseguro);
  const [marcado, setMarcado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div className="rounded-md border border-feedback-warning/40 bg-feedback-warning/10 p-4">
      <h2 className="text-body-emphasis text-text-primary">Esta máquina não tem cofre de chaves</h2>
      <p className="mt-2 text-meta text-text-secondary">
        O sistema não oferece um serviço de segredos que o aplicativo possa usar. Sem ele, a chave
        privada da sua identidade fica no disco protegida apenas pelas permissões de arquivo do seu
        usuário — qualquer programa rodando como você consegue lê-la.
      </p>
      <p className="mt-2 text-meta text-text-secondary">
        Isso não é equivalente à proteção do sistema operacional, e o aplicativo vai continuar
        avisando enquanto durar. No Linux, instalar e destravar o <code>gnome-keyring</code> (ou
        um KWallet) antes de abrir o aplicativo resolve.
      </p>

      <label className="mt-3 flex items-start gap-2 text-meta text-text-primary">
        <input
          type="checkbox"
          checked={marcado}
          onChange={(e) => setMarcado(e.target.checked)}
          className="mt-1"
        />
        Entendo o risco e quero criar a identidade assim mesmo.
      </label>

      {erro !== null && <p className="mt-2 text-meta text-feedback-danger">{erro}</p>}

      <Button
        className="mt-3"
        variant="secondary"
        loading={ocupado}
        disabled={!marcado}
        onClick={() => {
          setOcupado(true);
          setErro(null);
          void aceitar()
            .then(aoAceitar)
            .catch((e: unknown) => setErro(mensagemDeErro(e)))
            .finally(() => setOcupado(false));
        }}
      >
        Aceitar e continuar
      </Button>
    </div>
  );
}
