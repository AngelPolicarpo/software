import { useEffect } from "react";

import { cn } from "../../lib/cn";
import { SettingsSection } from "../settings/SettingsLayout";
import { definirPoliticaDeContato, sincronizarPrefsDm } from "../../live/dm";
import { useDmStore } from "../../store/dmStore";

/**
 * §31.9 regra 5 — a política local de contato, em §10 3.1.
 *
 * O custo aparece **junto da opção**, e é requisito, não cortesia: com
 * `shared-community` ligada, ninguém de fora consegue falar com você pela primeira vez.
 * A regra é explícita quanto a isso ("o custo, e ele precisa aparecer na UI"), porque é
 * a única defesa real contra Sybil num sistema em que identidade é gratuita (**L-8**) e
 * quem a liga precisa saber o que está trocando.
 *
 * Ela é **local**: não vai para log nenhum, não muda o protocolo e ninguém do outro lado
 * a observa — dizer o contrário faria a DM parecer depender de comunidade, que é
 * exatamente o que §31.9 nega.
 */
const OPCOES = [
  {
    id: "anyone" as const,
    titulo: "Qualquer pessoa",
    detalhe: "Quem tiver a sua chave pode mandar um pedido de conversa.",
  },
  {
    id: "shared-community" as const,
    titulo: "Só quem tem comunidade em comum",
    detalhe:
      "Ninguém de fora consegue falar com você pela primeira vez — nem alguém que você " +
      "queira encontrar. A escolha é sua, e vale só nesta máquina.",
  },
];

export function DmContactPolicySection() {
  const policy = useDmStore((s) => s.contactPolicy);

  useEffect(() => {
    void sincronizarPrefsDm();
  }, []);

  return (
    <SettingsSection
      title="Conversas diretas"
      description="Quem pode abrir uma conversa com você. Preferência desta instalação."
    >
      <div className="flex flex-col gap-2">
        {OPCOES.map((opcao) => (
          <button
            key={opcao.id}
            type="button"
            aria-pressed={policy === opcao.id}
            onClick={() => void definirPoliticaDeContato(opcao.id)}
            className={cn(
              "rounded-md border p-3 text-left",
              "transition-colors duration-(--duration-fast) ease-out",
              policy === opcao.id
                ? "border-accent-default bg-accent-muted-bg"
                : "border-border-default hover:border-border-strong",
            )}
          >
            <span className="block text-body-emphasis text-text-primary">{opcao.titulo}</span>
            <span className="mt-0.5 block text-meta text-text-secondary">{opcao.detalhe}</span>
          </button>
        ))}
      </div>
    </SettingsSection>
  );
}
