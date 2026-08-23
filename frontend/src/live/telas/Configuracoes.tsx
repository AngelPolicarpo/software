/**
 * Configurações da comunidade — §15.4 (estrutura, cargos, convites, moderação) e §15.6.
 *
 * Todas as escritas desta tela são ⏱: dependem do host e têm 30 s. Isso não é detalhe de
 * transporte, é o que a tela promete — o botão fica ocupado até o host confirmar, e o erro
 * que volta é o do host, não um "salvo" otimista que a próxima consulta desmente.
 *
 * Três coisas que a spec decide e a tela **não** recalcula:
 *
 *  - a ordem dos cargos é `rank` (§6.4.1), e `role.move` muda só o cargo movido;
 *  - `rank` e as contagens podem vir AUSENTES da resposta quando a projeção local ainda não
 *    alcançou o `seq` confirmado (emenda de 2026-08-22). A tela então recarrega em vez de
 *    inventar o valor;
 *  - `category.delete` tem exatamente duas formas — mover os canais **ou** apagá-los. Pedir
 *    as duas na mesma chamada é `E_VALIDATION`, não uma terceira forma.
 */

import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { api } from "../../ipc/api";
import { useComunidade } from "../comunidade";
import { useComunidades } from "../comunidades";
import { mensagemDeErro } from "../sessao";
import { campoDoErro } from "../../ipc/frames";
import { Avatar, Nome, Secao, Vazio } from "./comuns";
import { EscolhaDeCor } from "./EscolhaDeCor";
import { CORES_DE_CARGO } from "../../ipc/cores";
import { corDe, dataHora } from "./formato";
import type { RoleDto } from "../../ipc/dto";

type Aba = "identidade" | "canais" | "cargos" | "convites" | "moderacao";

const ABAS: Array<[Aba, string]> = [
  ["identidade", "Identidade"],
  ["canais", "Canais"],
  ["cargos", "Cargos"],
  ["convites", "Convites"],
  ["moderacao", "Moderação"],
];


/** §10 — os grupos de permissão da tabela de cargos. */
const PERMISSOES: Array<[string, string[]]> = [
  ["Geral", ["manage_community", "manage_channels", "view_audit_log"]],
  ["Texto", ["send_messages", "attach_files", "add_reactions", "mention_everyone", "pin_messages", "manage_messages"]],
  ["Voz", ["voice_speak", "voice_mute_others", "voice_share_screen"]],
  ["Moderação", ["create_invite", "kick_members", "ban_members", "timeout_members", "manage_roles"]],
];

function useAcao() {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<{ texto: string; campo?: string } | null>(null);
  async function correr(fn: () => Promise<unknown>): Promise<boolean> {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setErro({ texto: mensagemDeErro(e), campo: campoDoErro(e) });
      return false;
    } finally {
      setOcupado(false);
    }
  }
  return { ocupado, erro, correr };
}

function Identidade({ communityId }: { communityId: string }) {
  const detalhe = useComunidades((s) => s.detalhe);
  const recarregar = useComunidades((s) => s.recarregarAtiva);
  const { ocupado, erro, correr } = useAcao();
  const [nome, setNome] = useState(detalhe?.name ?? "");
  const [emoji, setEmoji] = useState(detalhe?.iconEmoji ?? "");
  // §6.4.2 — o fio traz o número; o token só aparece na renderização.
  const [cor, setCor] = useState(Number(detalhe?.iconColor ?? 1));

  const podeGerenciar = detalhe?.myPermissions.includes("manage_community") ?? false;

  return (
    <Secao titulo="Identidade da comunidade">
      {!podeGerenciar && <p className="text-meta text-text-tertiary">Você não tem `manage_community` aqui.</p>}
      <TextField label="Nome" value={nome} onChange={setNome} maxLength={64} disabled={!podeGerenciar} error={erro?.campo === "name" ? erro.texto : undefined} />
      <TextField label="Emoji do ícone" value={emoji} onChange={setEmoji} maxLength={8} disabled={!podeGerenciar} />
      <EscolhaDeCor valor={cor} aoEscolher={setCor} desabilitado={!podeGerenciar} />
      {erro !== null && erro.campo !== "name" && <p className="text-meta text-feedback-danger">{erro.texto}</p>}
      <div>
        <Button
          loading={ocupado}
          disabled={!podeGerenciar}
          onClick={() =>
            void correr(async () => {
              await api.communityUpdate({
                communityId,
                name: nome,
                iconColor: cor,
                ...(emoji.length > 0 ? { iconEmoji: emoji } : {}),
              });
              await recarregar();
            })
          }
        >
          Salvar
        </Button>
      </div>

      <ZonaDeRisco communityId={communityId} />
    </Secao>
  );
}

/**
 * As três saídas de uma comunidade, que são coisas diferentes:
 *
 *  - **sair** (`community.leave`) tem efeito local imediato e enfileira `member.leave` — a
 *    exceção de §11.1, L-22. A réplica fica no disco até `retain_until`;
 *  - **encerrar** (`community.end` ⏱ main-confirmed) é do host e é terminal: leitura segue,
 *    escrita passa a ser recusada, para todo mundo;
 *  - **esquecer** (`community.forget` main-confirmed) apaga a réplica local, e só aceita
 *    comunidade já `left`/`removed` — por isso vem depois de sair, nunca no lugar dela.
 */
function ZonaDeRisco({ communityId }: { communityId: string }) {
  const detalhe = useComunidades((s) => s.detalhe);
  const carregarLista = useComunidades((s) => s.carregarLista);
  const selecionar = useComunidades((s) => s.selecionarComunidade);
  const recarregar = useComunidades((s) => s.recarregarAtiva);
  const { ocupado, erro, correr } = useAcao();
  const [motivo, setMotivo] = useState("");
  const [recado, setRecado] = useState<string | null>(null);

  if (detalhe === null) return null;
  const encerrada = detalhe.endedAt !== undefined;

  return (
    <div className="mt-6 border-t border-border-subtle pt-6">
      <h4 className="text-caption uppercase text-feedback-danger">Zona de risco</h4>

      {detalhe.isHost && !encerrada && (
        <div className="mt-3">
          <TextField label="Motivo do encerramento (opcional)" value={motivo} onChange={setMotivo} />
          <p className="mt-1 text-caption text-text-tertiary">
            Encerrar é definitivo e vale para todo mundo: o histórico continua legível, e nenhuma
            escrita nova é aceita. Não há como reabrir.
          </p>
          <Button
            className="mt-2"
            variant="danger"
            loading={ocupado}
            onClick={() =>
              void correr(async () => {
                const r = await api.communityEnd({
                  communityId,
                  ...(motivo.trim().length > 0 ? { reason: motivo.trim() } : {}),
                });
                setRecado(
                  `Encerrada. O encerramento replicou para ${r.replicatedTo} ${r.replicatedTo === 1 ? "dispositivo" : "dispositivos"} antes de fechar.`,
                );
                await recarregar();
                await carregarLista();
              })
            }
          >
            Encerrar comunidade
          </Button>
        </div>
      )}

      {!detalhe.isHost && (
        <div className="mt-3">
          <p className="text-caption text-text-tertiary">
            Sair tem efeito imediato aqui; o aviso aos outros vai na fila e chega quando o host
            estiver disponível. A cópia local fica no disco até o prazo de retenção — ou até você
            apagá-la.
          </p>
          <Button
            className="mt-2"
            variant="secondary"
            loading={ocupado}
            onClick={() =>
              void correr(async () => {
                const r = await api.communityLeave(communityId);
                setRecado(
                  r.droppedQueued > 0
                    ? `Você saiu. ${r.droppedQueued} ${r.droppedQueued === 1 ? "operação pendente foi descartada" : "operações pendentes foram descartadas"}.`
                    : "Você saiu da comunidade.",
                );
                await carregarLista();
              })
            }
          >
            Sair da comunidade
          </Button>
        </div>
      )}

      <div className="mt-3">
        <p className="text-caption text-text-tertiary">
          Apagar a cópia local só é possível depois de sair (ou de ter sido removida): o núcleo
          recusa esquecer uma comunidade da qual você ainda participa.
        </p>
        <Button
          className="mt-2"
          variant="ghost"
          loading={ocupado}
          onClick={() =>
            void correr(async () => {
              await api.communityForget(communityId);
              await selecionar(null);
              await carregarLista();
            })
          }
        >
          Apagar a cópia local
        </Button>
      </div>

      {recado !== null && <p className="mt-2 text-meta text-feedback-success">{recado}</p>}
      {erro !== null && <p className="mt-2 text-meta text-feedback-danger">{erro.texto}</p>}
    </div>
  );
}

function Canais({ communityId }: { communityId: string }) {
  const estrutura = useComunidades((s) => s.estrutura);
  const recarregar = useComunidades((s) => s.recarregarAtiva);
  const permissoes = useComunidades((s) => s.detalhe?.myPermissions ?? []);
  const { ocupado, erro, correr } = useAcao();
  const [novoCanal, setNovoCanal] = useState("");
  const [categoriaAlvo, setCategoriaAlvo] = useState<string | null>(null);
  const [novaCategoria, setNovaCategoria] = useState("");

  const pode = permissoes.includes("manage_channels");
  const categorias = estrutura?.categories ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Secao titulo="Categorias">
        <ul className="flex flex-col gap-1">
          {categorias.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="flex-1 text-meta text-text-secondary">{c.name}</span>
              {pode && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={ocupado}
                  onClick={() =>
                    void correr(async () => {
                      // Uma das DUAS formas de §15.4; pedir as duas seria `E_VALIDATION`.
                      await api.categoryDelete({ communityId, categoryId: c.id, deleteChannels: true });
                      await recarregar();
                    })
                  }
                >
                  Apagar com os canais
                </Button>
              )}
            </li>
          ))}
        </ul>
        {pode && (
          <div className="flex items-end gap-2">
            <TextField className="flex-1" label="Nova categoria" value={novaCategoria} onChange={setNovaCategoria} />
            <Button
              loading={ocupado}
              disabled={novaCategoria.trim().length === 0}
              onClick={() =>
                void correr(async () => {
                  await api.categoryCreate({ communityId, name: novaCategoria.trim() });
                  setNovaCategoria("");
                  await recarregar();
                })
              }
            >
              Criar
            </Button>
          </div>
        )}
      </Secao>

      <Secao titulo="Canais">
        {categorias.map((c) => (
          <div key={c.id} className="mb-2">
            <h4 className="text-caption uppercase text-text-tertiary">{c.name}</h4>
            <ul>
              {c.channels.map((ch) => (
                <li key={ch.id} className="flex items-center gap-2 py-0.5">
                  <span className="flex-1 text-meta text-text-secondary">#{ch.name}</span>
                  {ch.readOnly && <span className="text-caption text-text-tertiary">somente leitura</span>}
                  {pode && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={ocupado}
                      onClick={() =>
                        void correr(async () => {
                          await api.channelDelete({ communityId, channelId: ch.id });
                          await recarregar();
                        })
                      }
                    >
                      Apagar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {pode && categorias.length > 0 && (
          <div className="flex items-end gap-2">
            <TextField className="flex-1" label="Novo canal" value={novoCanal} onChange={setNovoCanal} />
            <select
              value={categoriaAlvo ?? categorias[0]!.id}
              onChange={(e) => setCategoriaAlvo(e.target.value)}
              className="h-9 rounded-md border border-border-default bg-surface-elevated px-2 text-meta text-text-primary"
            >
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Button
              loading={ocupado}
              disabled={novoCanal.trim().length === 0}
              onClick={() =>
                void correr(async () => {
                  await api.channelCreate({
                    communityId,
                    categoryId: categoriaAlvo ?? categorias[0]!.id,
                    // §6 — 0 é canal de texto; voz entra com a fatia de mídia real.
                    type: 0,
                    name: novoCanal.trim(),
                  });
                  setNovoCanal("");
                  await recarregar();
                })
              }
            >
              Criar
            </Button>
          </div>
        )}
        <p className="text-caption text-text-tertiary">
          Apagar um canal remove-o da interface de todo mundo ao sincronizar; as mensagens continuam
          no registro da comunidade.
        </p>
        {erro !== null && <p className="text-meta text-feedback-danger">{erro.texto}</p>}
      </Secao>
    </div>
  );
}

function Cargos({ communityId }: { communityId: string }) {
  const cargos = useComunidade((s) => s.cargos);
  const carregar = useComunidade((s) => s.carregarCargos);
  const permissoes = useComunidades((s) => s.detalhe?.myPermissions ?? []);
  const { ocupado, erro, correr } = useAcao();
  const [selecionado, setSelecionado] = useState<RoleDto | null>(null);
  const [novo, setNovo] = useState("");

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const pode = permissoes.includes("manage_roles");

  return (
    <div className="flex gap-6">
      <div className="w-56 shrink-0">
        <Secao titulo="Cargos">
          <ul className="flex flex-col gap-0.5">
            {cargos.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelecionado(c)}
                  className={
                    "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-meta " +
                    (selecionado?.id === c.id ? "bg-surface-elevated" : "hover:bg-surface-elevated/60")
                  }
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: corDe(c.color) }} />
                  <span className="flex-1 truncate" style={{ color: corDe(c.color) }}>
                    {c.name}
                  </span>
                  <span className="text-caption text-text-tertiary">{c.memberCount}</span>
                </button>
              </li>
            ))}
          </ul>
          {pode && (
            <div className="flex items-end gap-2">
              <TextField className="flex-1" label="Novo cargo" value={novo} onChange={setNovo} />
              <Button
                size="sm"
                loading={ocupado}
                disabled={novo.trim().length === 0}
                onClick={() =>
                  void correr(async () => {
                    await api.roleCreate({
                      communityId,
                      name: novo.trim(),
                      // 6 é `role-neutral` no catálogo fechado de §6.4.2.
                      color: 6,
                      permissions: [],
                      mentionable: false,
                    });
                    setNovo("");
                    await carregar();
                  })
                }
              >
                Criar
              </Button>
            </div>
          )}
        </Secao>
      </div>

      <div className="min-w-0 flex-1">
        {selecionado === null ? (
          <Vazio>Escolha um cargo para editar.</Vazio>
        ) : (
          <Secao titulo={selecionado.name}>
            {selecionado.isFounder && (
              <p className="text-meta text-text-tertiary">
                O cargo de fundador é imutável e fica sempre no topo — o núcleo recusa alterá-lo.
              </p>
            )}
            {selecionado.isDefault && (
              <p className="text-meta text-text-tertiary">
                Este é o cargo base de todo membro: ele não pode ser apagado.
              </p>
            )}

            {/* §6.4.2 — cargo não recebe `accent`: a paleta é a faixa 0..6. */}
            <EscolhaDeCor
              valor={Number(selecionado.color)}
              paleta={CORES_DE_CARGO}
              desabilitado={!pode || selecionado.isFounder}
              aoEscolher={(n) =>
                void correr(async () => {
                  await api.roleUpdate({ communityId, roleId: selecionado.id, color: n });
                  await carregar();
                })
              }
            />

            {PERMISSOES.map(([grupo, lista]) => (
              <div key={grupo}>
                <h5 className="pb-1 text-caption uppercase text-text-tertiary">{grupo}</h5>
                <ul className="flex flex-col gap-0.5">
                  {lista.map((p) => {
                    const tem = selecionado.permissions.includes(p);
                    return (
                      <li key={p}>
                        <label className="flex items-center gap-2 text-meta text-text-secondary">
                          <input
                            type="checkbox"
                            checked={tem}
                            disabled={!pode || selecionado.isFounder || ocupado}
                            onChange={() =>
                              void correr(async () => {
                                await api.roleUpdate({
                                  communityId,
                                  roleId: selecionado.id,
                                  permissions: tem
                                    ? selecionado.permissions.filter((x) => x !== p)
                                    : [...selecionado.permissions, p],
                                });
                                await carregar();
                                setSelecionado(null);
                              })
                            }
                          />
                          {p}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            <p className="text-caption text-text-tertiary">
              Você não pode conceder permissão que não tem: o núcleo recusa com
              `E_PERMISSION_ESCALATION`.
            </p>

            {pode && !selecionado.isFounder && !selecionado.isDefault && (
              <div>
                <Button
                  variant="danger"
                  loading={ocupado}
                  onClick={() =>
                    void correr(async () => {
                      await api.roleDelete({ communityId, roleId: selecionado.id });
                      setSelecionado(null);
                      await carregar();
                    })
                  }
                >
                  Apagar cargo
                </Button>
              </div>
            )}
            {erro !== null && <p className="text-meta text-feedback-danger">{erro.texto}</p>}
          </Secao>
        )}
      </div>
    </div>
  );
}

function Convites({ communityId }: { communityId: string }) {
  const convites = useComunidade((s) => s.convites);
  const carregar = useComunidade((s) => s.carregarConvites);
  const permissoes = useComunidades((s) => s.detalhe?.myPermissions ?? []);
  const { ocupado, erro, correr } = useAcao();

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const pode = permissoes.includes("create_invite");

  return (
    <Secao
      titulo="Convites"
      acao={
        pode ? (
          <Button
            size="sm"
            loading={ocupado}
            onClick={() =>
              void correr(async () => {
                await api.inviteCreate({ communityId });
                await carregar();
              })
            }
          >
            Criar convite
          </Button>
        ) : undefined
      }
    >
      {convites.length === 0 ? (
        <Vazio>Nenhum convite ativo.</Vazio>
      ) : (
        <ul className="flex flex-col gap-2">
          {convites.map((i) => (
            <li key={i.invitePublicKey} className="rounded-md border border-border-subtle p-2">
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate text-meta text-text-primary">
                  {/* Delta U-04 — o código só existe para quem o criou NESTA instalação. */}
                  {i.code ?? (i.codeAvailable ? "código indisponível aqui" : "criado em outra instalação")}
                </code>
                {i.revokedAt === undefined && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={ocupado}
                    onClick={() =>
                      void correr(async () => {
                        await api.inviteRevoke({ communityId, invitePublicKey: i.invitePublicKey });
                        await carregar();
                      })
                    }
                  >
                    Revogar
                  </Button>
                )}
              </div>
              <p className="mt-1 text-caption text-text-tertiary">
                por <Nome user={i.createdBy} /> · {dataHora(i.createdAt)} · {i.uses}
                {i.maxUses !== undefined ? `/${i.maxUses}` : ""} usos
                {i.expiresAt !== undefined ? ` · expira ${dataHora(i.expiresAt)}` : ""}
                {i.revokedAt !== undefined ? " · revogado" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      {erro !== null && <p className="text-meta text-feedback-danger">{erro.texto}</p>}
    </Secao>
  );
}

function Moderacao() {
  const bans = useComunidade((s) => s.bans);
  const timeouts = useComunidade((s) => s.timeouts);
  const auditoria = useComunidade((s) => s.auditoria);
  const carregarBans = useComunidade((s) => s.carregarBans);
  const carregarTimeouts = useComunidade((s) => s.carregarTimeouts);
  const carregarAuditoria = useComunidade((s) => s.carregarAuditoria);

  useEffect(() => {
    void carregarBans();
    void carregarTimeouts();
    void carregarAuditoria();
  }, [carregarBans, carregarTimeouts, carregarAuditoria]);

  const negado = bans.semPermissao && auditoria.semPermissao;

  return (
    <div className="flex flex-col gap-6">
      {/* L-10 / delta U-07 — a UX precisa dizer que isto é confidencialidade LOCAL. */}
      <p className="rounded-md border border-border-subtle bg-surface-elevated p-3 text-caption text-text-tertiary">
        A replicação da comunidade é integral: estas tabelas estão no disco de todo mundo que
        participa. Restringir a leitura aqui é confidencialidade da interface, não segredo
        criptográfico — um cliente adulterado lê as mesmas linhas.
      </p>

      {negado ? (
        <Vazio>Você não tem permissão para ver o registro de moderação desta comunidade.</Vazio>
      ) : (
        <>
          <Secao titulo="Banimentos">
            {bans.semPermissao ? (
              <Vazio>Sem permissão para esta lista.</Vazio>
            ) : bans.itens.length === 0 ? (
              <Vazio>Ninguém banido.</Vazio>
            ) : (
              <ul className="flex flex-col gap-1">
                {bans.itens.map((b) => (
                  <li key={b.target.key} className="flex items-center gap-2 text-meta">
                    <Avatar user={b.target} size={24} />
                    <Nome user={b.target} className="flex-1 truncate text-text-primary" />
                    <span className="text-caption text-text-tertiary">
                      por <Nome user={b.by} /> · {dataHora(b.at)}
                      {b.reason !== undefined ? ` · ${b.reason}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          <Secao titulo="Silenciamentos">
            {timeouts.semPermissao ? (
              <Vazio>Sem permissão para esta lista.</Vazio>
            ) : timeouts.itens.length === 0 ? (
              <Vazio>Ninguém silenciado.</Vazio>
            ) : (
              <ul className="flex flex-col gap-1">
                {timeouts.itens.map((t) => (
                  <li key={`${t.target.key}-${t.at}`} className="flex items-center gap-2 text-meta">
                    <Avatar user={t.target} size={24} />
                    <Nome user={t.target} className="flex-1 truncate text-text-primary" />
                    <span className="text-caption text-text-tertiary">
                      até {dataHora(t.until)}
                      {t.expired ? " (expirado)" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          <Secao titulo="Registro de moderação">
            {auditoria.semPermissao ? (
              <Vazio>Sem `view_audit_log` nesta comunidade.</Vazio>
            ) : auditoria.itens.length === 0 ? (
              <Vazio>Nada registrado.</Vazio>
            ) : (
              <ul className="flex flex-col gap-1">
                {auditoria.itens.map((a) => (
                  <li key={a.id} className="text-meta text-text-secondary">
                    <span className="text-text-primary">{a.type}</span> — {a.targetLabel ?? "—"} por {a.byLabel}
                    <span className="text-caption text-text-tertiary"> · {dataHora(a.at)}</span>
                    {a.reason !== undefined && <span className="text-caption text-text-tertiary"> · {a.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Secao>
        </>
      )}
    </div>
  );
}

export function Configuracoes({ aoFechar }: { aoFechar: () => void }) {
  const communityId = useComunidades((s) => s.ativa);
  const detalhe = useComunidades((s) => s.detalhe);
  const [aba, setAba] = useState<Aba>("identidade");

  if (communityId === null) return null;

  return (
    <div className="fixed inset-0 z-40 flex bg-surface-app">
      <nav className="w-56 shrink-0 border-r border-border-subtle bg-surface-sidebar p-3">
        <h2 className="truncate px-2 pb-3 text-body-emphasis text-text-primary">{detalhe?.name ?? ""}</h2>
        <ul className="flex flex-col gap-0.5">
          {ABAS.map(([id, rotulo]) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => setAba(id)}
                className={
                  "w-full rounded px-2 py-1.5 text-left text-meta " +
                  (aba === id ? "bg-surface-elevated text-text-primary" : "text-text-secondary hover:bg-surface-elevated/60")
                }
              >
                {rotulo}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 px-2">
          <Button size="sm" variant="ghost" onClick={aoFechar}>
            Voltar
          </Button>
        </div>
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          {aba === "identidade" && <Identidade communityId={communityId} />}
          {aba === "canais" && <Canais communityId={communityId} />}
          {aba === "cargos" && <Cargos communityId={communityId} />}
          {aba === "convites" && <Convites communityId={communityId} />}
          {aba === "moderacao" && <Moderacao />}
        </div>
      </div>
    </div>
  );
}
